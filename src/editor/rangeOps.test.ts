import { describe, expect, it } from 'vitest'
import { demoReport } from '../model/demoReport'
import type { BodyBlock, ParagraphBlock, Report } from '../model/types'
import * as ops from './reportOps'
import { copyRange, deleteRange, pasteClip, rangePieces, resolveRange, sameClipText, type ModelPoint } from './rangeOps'

/** 見本の原稿（p2 の「（図1）」と p3 の「表1」を、図表へのリンクにしておく） */
function sample(): Report {
  let r = demoReport()
  r = ops.setText(r, 'p2', ops.findEditable(r, 'p2')!.text)
  r = ops.setText(r, 'p3', ops.findEditable(r, 'p3')!.text)
  return r
}
const blocks = (r: Report): BodyBlock[] => r.body.flatMap((c) => c.blocks)
const block = (r: Report, id: string) => blocks(r).find((b) => b.id === id)
const text = (r: Report, id: string) => ops.findEditable(r, id)?.text
const pt = (id: string, offset: number, whole = false): ModelPoint => ({ id, offset, whole })
const range = (r: Report, a: ModelPoint, b: ModelPoint) => {
  const x = resolveRange(r, a, b)
  if (!x) throw new Error('範囲が求まらない')
  return x
}

describe('選んだ範囲を求める', () => {
  const r = sample()
  it('始めと終わりの順は問わない', () => {
    expect(range(r, pt('p3', 2), pt('p1', 5))).toEqual(range(r, pt('p1', 5), pt('p3', 2)))
  })
  it('本文と抄録をまたぐ・表紙・何も選んでいないときは、範囲にしない', () => {
    expect(resolveRange(r, pt('a1', 3), pt('p1', 3))).toBeNull()
    expect(resolveRange(r, pt('basic:name', 0), pt('p1', 3))).toBeNull()
    expect(resolveRange(r, pt('p1', 3), pt('p1', 3))).toBeNull()
  })
  it('表のセルは、その表を指す。図・表は少しでもかかればまるごと', () => {
    const x = range(r, pt('p3', 2), pt('m2:usage', 1))
    const pieces = rangePieces(r, x)
    expect(pieces.map((p) => `${p.item.kind}:${p.item.id}:${p.whole}`)).toEqual(['paragraph:p3:false', 'table:t1:true'])
  })
  it('選び終わりが次の段落の始めなら、その段落は入れない', () => {
    const pieces = rangePieces(r, range(r, pt('p1', 5), pt('s2', 0)))
    expect(pieces.map((p) => p.item.id)).toEqual(['p1'])
  })
})

describe('コピー', () => {
  const r = sample()
  it('段落の途中から、見出し・段落・図を通って、段落の途中まで：まとまりとして持ち、ふつうの文字は改行で分ける', () => {
    const clip = copyRange(r, range(r, pt('p1', 5), pt('p3', 3)))
    expect(clip.kind).toBe('blocks')
    expect(clip.blocks.map((b) => b.type)).toEqual(['paragraph', 'subheading', 'paragraph', 'figureRow', 'subheading', 'paragraph'])
    expect(clip.openStart && clip.openEnd).toBe(true)
    const lines = clip.text.split('\n')
    expect(lines[0]).toBe(text(r, 'p1')!.slice(5))
    expect(lines[1]).toBe('ⅱ．デザイン説明')
    expect(lines[3]).toBe('図1.デザイン画')
    expect(lines.at(-1)).toBe('表1に')
    // ひな形の説明は持っていかない。参照は図へのリンクのまま
    const p2 = clip.blocks[2] as ParagraphBlock
    expect(p2.content.some((n) => n.type === 'ref' && n.targetId === 'f1')).toBe(true)
  })
  it('1つの段落の中だけ：文字だけ（参照も含む）', () => {
    const at = text(r, 'p2')!.indexOf('考えた')
    const clip = copyRange(r, range(r, pt('p2', at), pt('p2', at + 8)))
    expect(clip.kind).toBe('inline')
    expect(clip.text).toBe('考えた（図1）。')
    expect(clip.inline.some((n) => n.type === 'ref')).toBe(true)
  })
  it('大見出しをまたぐ：ふつうの文字には番号付きの見出しを入れ、まとまりには入れない', () => {
    const clip = copyRange(r, range(r, pt('p3', 0), pt('p4', 3)))
    expect(clip.chapters).toBe(1)
    expect(clip.text.split('\n')).toContain('Ⅱ．制作過程')
    expect(clip.blocks.some((b) => (b as { type: string }).type === 'chapter')).toBe(false)
    // 表は、タイトルの行と、セルをタブで区切った行
    expect(clip.text).toContain('表1.使用素材表')
    expect(clip.text).toContain('コットンサテン\tジャケット')
  })
  it('図のタイトルの中だけ：タイトルの文字だけ。写真から選んだときは図ごと', () => {
    expect(copyRange(r, range(r, pt('f1', 1), pt('f1', 3))).text).toBe('ザイ')
    const whole = copyRange(r, range(r, pt('f1', 0, true), pt('f1', 2)))
    expect(whole.kind).toBe('blocks')
    expect(whole.blocks[0].type).toBe('figureRow')
  })
})

describe('削除・切り取り', () => {
  it('段落の途中から段落の途中まで：間の見出し・段落・図を消し、前と後ろの残りを1つの段落につなぐ', () => {
    const r = sample()
    const head = text(r, 'p1')!.slice(0, 5)
    const tail = text(r, 'p3')!.slice(3)
    const out = deleteRange(r, range(r, pt('p1', 5), pt('p3', 3)))
    expect(out.figures).toEqual(['f1'])
    expect(text(out.report, 'p1')).toBe(head + tail)
    for (const id of ['s2', 'p2', 'r1', 's3', 'p3']) expect(block(out.report, id)).toBeUndefined()
    expect(block(out.report, 't1')).toBeDefined()
    expect(out.keptChapters).toBe(false)
    // 図の番号：図がなくなる
    expect(ops.numbering(out.report).figureByNumber.size).toBe(0)
  })
  it('前の段落をまるごと選んだときは、つないだ段落は後ろの段落（切り取って貼り付けると、前の段落が同じ ID のまま戻る）', () => {
    const r = sample()
    const out = deleteRange(r, range(r, pt('p4', 0), pt('p5', 4)))
    expect(block(out.report, 'p4')).toBeUndefined()
    expect(text(out.report, 'p5')).toBe(text(r, 'p5')!.slice(4))
  })
  it('大見出しをまたぐ：大見出しは残し、前の章と後ろの章の残りはつながない。消した表への文の中の参照は「表?」', () => {
    const r = sample()
    const out = deleteRange(r, range(r, pt('p3', 3), pt('p4', 4)))
    expect(out.keptChapters).toBe(true)
    expect(out.report.body.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
    expect(out.report.body[1].title).toBe('制作過程')
    expect(block(out.report, 't1')).toBeUndefined()
    expect(block(out.report, 's4')).toBeUndefined()
    expect(text(out.report, 'p3')).toBe('表?に')
    expect(text(out.report, 'p4')).toBe(text(r, 'p4')!.slice(4))
  })
  it('まるごと選んだ段落を消すと、空の段落を残さない', () => {
    const r = sample()
    const out = deleteRange(r, range(r, pt('p4', 0), pt('p5', text(r, 'p5')!.length)))
    expect(block(out.report, 'p4')).toBeUndefined()
    expect(block(out.report, 'p5')).toBeUndefined()
    expect(out.report.body[1].blocks.map((b) => b.id)).toEqual(['s4'])
  })
  it('1つの欄の中：文字だけを消す（図のタイトルも）', () => {
    const r = sample()
    expect(text(deleteRange(r, range(r, pt('p6', 0), pt('p6', 2))).report, 'p6')).toBe(text(r, 'p6')!.slice(2))
    expect(text(deleteRange(r, range(r, pt('f1', 0), pt('f1', 4))).report, 'f1')).toBe('画')
    expect(text(deleteRange(r, range(r, pt('c3', 0), pt('c3', 2))).report, 'c3')).toBe('め')
  })
  it('抄録の段落をまたいで消すと、つながる（最後の1段落は残す）', () => {
    const r = sample()
    const out = deleteRange(r, range(r, pt('a1', 3), pt('a2', 2)))
    expect(out.report.abstract.paragraphs.map((p) => p.id)).toEqual(['a1', 'a3'])
    expect(text(out.report, 'a1')).toBe(text(r, 'a1')!.slice(0, 3) + text(r, 'a2')!.slice(2))
    const all = deleteRange(r, range(r, pt('a1', 0), pt('a3', text(r, 'a3')!.length)))
    expect(all.report.abstract.paragraphs.length).toBe(1)
  })
})

describe('貼り付け', () => {
  it('段落と図をコピーして別の段落の途中に貼り付ける：段落を分けて間に入れ、図は新しい ID、番号は振り直し、文の中の参照は貼り付けた図を指す', () => {
    const r = sample()
    const clip = copyRange(r, range(r, pt('p2', 0), pt('f1', 0, true)))
    expect(clip.blocks.map((b) => b.type)).toEqual(['paragraph', 'figureRow'])
    const out = pasteClip(r, 'p6', 5, clip)
    const c3 = out.report.body[2].blocks
    expect(c3.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'figureRow', 'paragraph'])
    expect(c3[0].id).toBe('p6')
    expect(text(out.report, 'p6')).toBe(text(r, 'p6')!.slice(0, 5))
    const row = c3[2]
    const pasted = c3[1] as ParagraphBlock
    expect(row.type === 'figureRow' && row.figures[0].id).not.toBe('f1')
    const newFigure = row.type === 'figureRow' ? row.figures[0].id : ''
    expect(pasted.content.some((n) => n.type === 'ref' && n.targetId === newFigure)).toBe(true)
    const num = ops.numbering(out.report)
    expect(num.numbers.get(newFigure)).toBe(2)
    expect(text(out.report, pasted.id)).toContain('（図2）')
    // カーソルは、分けた後ろの段落の始め
    expect(out.caret).toEqual({ id: c3[3].id, offset: 0 })
    expect(text(out.report, c3[3].id)).toBe(text(r, 'p6')!.slice(5))
  })
  it('切り取って貼り付ける（動かす）：同じ ID のまま入り、参照も元の図を指す', () => {
    const r = sample()
    const x = range(r, pt('p2', 0), pt('f1', 0, true))
    const clip = copyRange(r, x)
    const cut = deleteRange(r, x)
    const out = pasteClip(cut.report, 'p6', text(cut.report, 'p6')!.length, clip)
    const c3 = out.report.body[2].blocks
    expect(c3.map((b) => b.id)).toEqual(['p6', 'p2', 'r1'])
    expect(text(out.report, 'p2')).toContain('（図1）')
    // 図・表で終わり、後ろに文がない：書く欄は図の後ろで続けない
    expect(out.caret).toBeNull()
  })
  it('途中から途中までのまとまり：前の文と最初の段落、最後の段落と後ろの文をつなぐ', () => {
    const r = sample()
    const clip = copyRange(r, range(r, pt('p4', 5), pt('p5', 4)))
    const out = pasteClip(r, 'p6', 3, clip)
    const c3 = out.report.body[2].blocks as ParagraphBlock[]
    expect(c3.length).toBe(2)
    expect(text(out.report, 'p6')).toBe(text(r, 'p6')!.slice(0, 3) + text(r, 'p4')!.slice(5))
    expect(text(out.report, c3[1].id)).toBe(text(r, 'p5')!.slice(0, 4) + text(r, 'p6')!.slice(3))
    expect(out.caret).toEqual({ id: c3[1].id, offset: 4 })
  })
  it('文字だけ：カーソルの位置にそのまま入れる', () => {
    const r = sample()
    const at = text(r, 'p2')!.indexOf('考えた')
    const clip = copyRange(r, range(r, pt('p2', at), pt('p2', at + 8)))
    const out = pasteClip(r, 'p6', 2, clip)
    expect(text(out.report, 'p6')).toBe(text(r, 'p6')!.slice(0, 2) + '考えた（図1）。' + text(r, 'p6')!.slice(2))
    expect(out.caret).toEqual({ id: 'p6', offset: 10 })
  })
  it('大見出しは貼り付けない', () => {
    const r = sample()
    const clip = copyRange(r, range(r, pt('p5', 3), pt('p6', 4)))
    const out = pasteClip(r, 'p1', 2, clip)
    expect(out.skippedChapters).toBe(true)
    expect(out.report.body.length).toBe(3)
  })
  it('抄録には文だけを入れる（参照は、コピーしたときの番号の文字）', () => {
    const r = sample()
    const clip = copyRange(r, range(r, pt('p2', 0), pt('s3', 2)))
    const out = pasteClip(r, 'a3', 0, clip)
    expect(out.droppedForAbstract).toBe(true)
    const a = out.report.abstract.paragraphs
    expect(a.map((p) => p.content.every((n) => n.type === 'text'))).toEqual(a.map(() => true))
    expect(a.some((p) => ops.contentToText(p.content, ops.numbering(out.report)).includes('（図1）'))).toBe(true)
  })
  it('クリップボードの文字は、改行の違い・最後の改行を見ない', () => {
    expect(sameClipText('あ\r\nい\r\n', 'あ\nい')).toBe(true)
    expect(sameClipText('あ\nう', 'あ\nい')).toBe(false)
  })
})
