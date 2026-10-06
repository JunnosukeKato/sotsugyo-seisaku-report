import { describe, expect, it } from 'vitest'
import { demoReport } from '../model/demoReport'
import type { Report } from '../model/types'
import * as ops from './reportOps'

const report = demoReport()
const text = (r: Report, id: string) => ops.findEditable(r, id)?.text

describe('editables', () => {
  it('表紙の項目・抄録・本文・図表のタイトル・表のセルを順に並べる', () => {
    const kinds = ops.editables(report).map((e) => e.kind)
    expect(kinds.slice(0, 3)).toEqual(['field', 'field', 'field'])
    expect(kinds).toContain('abstractParagraph')
    expect(kinds).toContain('figureCaption')
    expect(kinds).toContain('tableCell')
    expect(kinds.indexOf('abstractParagraph')).toBeLessThan(kinds.indexOf('chapter'))
  })

  it('↑↓の移動は表紙の項目と表のセルを飛ばす', () => {
    expect(ops.neighbor(report, 'p3', 'next')?.id).toBe('t1')
    expect(ops.neighbor(report, 't1', 'next')?.id).toBe('c2')
  })
})

describe('setText', () => {
  it('表紙の項目を書き換える（前後の空白と改行は除く）', () => {
    const next = ops.setText(report, 'basic:name', ' 文化　太郎\n')
    expect(next.basicInfo.name).toBe('文化　太郎')
    expect(report.basicInfo.name).toBe('文化　花子')
  })

  it('抄録の段落を書き換える（先頭の空白は除く）', () => {
    expect(text(ops.setText(report, 'a3', '　学んだ。'), 'a3')).toBe('学んだ。')
  })

  it('表のセルは改行を残す', () => {
    const next = ops.setText(report, 'm2:usage', '袖\n帯\nリボン')
    expect(text(next, 'm2:usage')).toBe('袖\n帯\nリボン')
  })
})

describe('図表の参照', () => {
  it('「（図1）」は図へのリンクとして保存される', () => {
    const p2 = report.body[0].blocks.find((b) => b.id === 'p2')
    expect(p2?.type).toBe('paragraph')
    const next = ops.setText(report, 'p2', 'デザインを考えた（図1）。表1も見よ。')
    const block = next.body[0].blocks.find((b) => b.id === 'p2')
    expect(block?.type === 'paragraph' && block.content).toEqual([
      { type: 'text', text: 'デザインを考えた' },
      { type: 'ref', targetId: 'f1', withParens: true },
      { type: 'text', text: '。' },
      { type: 'ref', targetId: 't1', withParens: false },
      { type: 'text', text: 'も見よ。' },
    ])
  })

  it('前に図を追加すると、参照の番号が自動で振り直される', () => {
    const linked = ops.setText(report, 'p2', 'デザインを考えた（図1）。')
    const added = ops.insertAfter(linked, 'p1', { type: 'figureRow', id: 'r0', figures: [{ id: 'f0', imageId: '', caption: '全身' }] })
    expect(text(added, 'p2')).toBe('デザインを考えた（図2）。')
  })

  it('存在しない番号や語の一部（設計図1枚）はリンクにしない', () => {
    const next = ops.setText(report, 'p2', '（図9）と設計図1枚。')
    const block = next.body[0].blocks.find((b) => b.id === 'p2')
    expect(block?.type === 'paragraph' && block.content).toEqual([{ type: 'text', text: '（図9）と設計図1枚。' }])
  })

  it('参照先の図を削除すると「図?」になる（チェックで指摘される）', () => {
    const linked = ops.setText(report, 'p2', '考えた（図1）。')
    expect(text(ops.removeBlock(linked, 'f1'), 'p2')).toBe('考えた（図?）。')
  })
})

describe('split / mergeBackward / replaceWithParagraphs', () => {
  it('抄録でも段落を分けたりつなげたりできる', () => {
    const { report: splitted, newId } = ops.split(report, 'a3', '制作を通して、', '学んだ。')
    expect(text(splitted, newId)).toBe('学んだ。')
    const merged = ops.mergeBackward(splitted, newId, '学んだ。')!
    expect(merged.targetId).toBe('a3')
    expect(text(merged.report, 'a3')).toBe('制作を通して、学んだ。')
  })

  it('抄録の最初の段落ではつなげない', () => {
    expect(ops.mergeBackward(report, 'a1', 'x')).toBeNull()
  })

  it('本文の段落を分けても、参照のリンクは保たれる', () => {
    const linked = ops.setText(report, 'p2', '考えた（図1）。次の文。')
    const { report: splitted, newId } = ops.split(linked, 'p2', '考えた（図1）。', '次の文。')
    expect(text(splitted, 'p2')).toBe('考えた（図1）。')
    expect(text(splitted, newId)).toBe('次の文。')
  })

  it('複数行の貼り付けは行ごとの段落になる', () => {
    const { report: pasted, lastId } = ops.replaceWithParagraphs(report, 'p6', ['一。', '二。', '三。'])
    expect(text(pasted, 'p6')).toBe('一。')
    expect(text(pasted, lastId)).toBe('三。')
  })
})

describe('ブロックの追加と削除', () => {
  it('図の並びから1枚だけ消せる。最後の1枚なら並びごと消える', () => {
    const two = ops.insertAfter(report, 'p1', { type: 'figureRow', id: 'r9', figures: [{ id: 'fa', imageId: '', caption: 'A' }, { id: 'fb', imageId: '', caption: 'B' }] })
    const one = ops.removeBlock(two, 'fa')
    expect(ops.findEditable(one, 'fb')).toBeDefined()
    expect(ops.findEditable(one, 'fa')).toBeUndefined()
    const none = ops.removeBlock(one, 'fb')
    expect(none.body[0].blocks.some((b) => b.id === 'r9')).toBe(false)
  })

  it('章を後ろに追加・削除できる', () => {
    const added = ops.insertChapterAfter(report, 'p4', { id: 'cx', title: '追加', blocks: [] })
    expect(added.body.map((c) => c.id)).toEqual(['c1', 'c2', 'cx', 'c3'])
    expect(ops.removeChapter(added, 'cx').body.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
  })
})

describe('図を入れる（書いている位置に（図n）、段落の下に図）', () => {
  const base = (): Report => ({
    ...demoReport(),
    body: [
      {
        id: 'c1',
        title: '企画',
        blocks: [
          { type: 'paragraph', id: 'pa', content: [{ type: 'text', text: '袖を大きくした。帯を巻いた。' }] },
          { type: 'paragraph', id: 'pb', content: [{ type: 'text', text: '次の段落。' }] },
        ],
      },
    ],
  })
  const fig = (id: string) => ({ id, imageId: `img-${id}`, caption: '' })
  const paraText = (r: Report, id: string) => ops.findEditable(r, id)?.text

  it('文末の「。」の直後で入れると「〜（図1）。」になり、段落のすぐ下に図が入る', () => {
    let r = ops.insertRef(base(), 'pa', 8, 'f1')
    r = ops.addFigureBelow(r, 'pa', fig('f1'))
    expect(paraText(r, 'pa')).toBe('袖を大きくした（図1）。帯を巻いた。')
    expect(r.body[0].blocks.map((b) => b.type)).toEqual(['paragraph', 'figureRow', 'paragraph'])
    expect(ops.refEnd(r, 'pa', 'f1')).toBe('袖を大きくした（図1）'.length)
  })

  it('同じ段落から入れた図はひとまとまりにし、段落の中で参照している順に並べる', () => {
    let r = ops.insertRef(base(), 'pa', 14, 'f1') // 「帯を巻いた。」の後ろ
    r = ops.addFigureBelow(r, 'pa', fig('f1'))
    r = ops.insertRef(r, 'pa', 8, 'f2') // 「袖を大きくした。」の後ろ（f1 より前）
    r = ops.addFigureBelow(r, 'pa', fig('f2'))
    const row = r.body[0].blocks[1]
    expect(row.type === 'figureRow' && row.figures.map((f) => f.id)).toEqual(['f2', 'f1'])
    // 番号は図の並び順で付くので、本文の中の番号も前から順になる
    expect(paraText(r, 'pa')).toBe('袖を大きくした（図1）。帯を巻いた（図2）。')
  })

  it('「もう1枚」は、図のすぐ後ろに加え、本文の参照のすぐ後ろに参照を足す', () => {
    let r = ops.insertRef(base(), 'pa', 8, 'f1')
    r = ops.addFigureBelow(r, 'pa', fig('f1'))
    r = ops.addFigureAfter(r, 'f1', fig('f2'))
    r = ops.insertRefAfterRef(r, 'f1', 'f2')
    expect(paraText(r, 'pa')).toBe('袖を大きくした（図1）（図2）。帯を巻いた。')
  })

  it('図を消すと、本文のその図への参照も消える', () => {
    let r = ops.insertRef(base(), 'pa', 8, 'f1')
    r = ops.addFigureBelow(r, 'pa', fig('f1'))
    r = ops.removeFigure(r, 'f1')
    expect(paraText(r, 'pa')).toBe('袖を大きくした。帯を巻いた。')
    expect(r.body[0].blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph'])
  })
})

describe('表を入れる・Enter で段落を分ける（段落の下の図・表）', () => {
  const base = (): Report => ({
    ...demoReport(),
    body: [
      {
        id: 'c1',
        title: '企画',
        blocks: [
          { type: 'paragraph', id: 'pa', content: [{ type: 'text', text: '袖を大きくした。帯を巻いた。' }] },
          { type: 'paragraph', id: 'pb', content: [{ type: 'text', text: '次の段落。' }] },
        ],
      },
    ],
  })
  const table = (id: string) => ({ type: 'materialTable' as const, id, caption: '', rows: [] })
  const types = (r: Report) => r.body[0].blocks.map((b) => b.type)

  it('表は、段落のすぐ下（すでにある図の後ろ）に入り、本文に（表n）が入る', () => {
    let r = ops.insertRef(base(), 'pa', 8, 'f1')
    r = ops.addFigureBelow(r, 'pa', { id: 'f1', imageId: 'i', caption: '' })
    r = ops.insertRef(r, 'pa', 14 + 4, 't1')
    r = ops.addTableBelow(r, 'pa', table('t1'))
    expect(types(r)).toEqual(['paragraph', 'figureRow', 'materialTable', 'paragraph'])
    expect(ops.findEditable(r, 'pa')?.text).toBe('袖を大きくした（図1）。帯を巻いた（表1）。')
  })

  it('段落の終わりで Enter：新しい段落は、その段落の下の図の後ろにできる（図は参照している段落に付いたまま）', () => {
    let r = ops.insertRef(base(), 'pa', 8, 'f1')
    r = ops.addFigureBelow(r, 'pa', { id: 'f1', imageId: 'i', caption: '' })
    const all = ops.findEditable(r, 'pa')!.text
    r = ops.split(r, 'pa', all, '').report
    expect(types(r)).toEqual(['paragraph', 'figureRow', 'paragraph', 'paragraph'])
  })

  it('参照より前で分けたときは、図は参照のある後ろの段落に付く', () => {
    let r = ops.insertRef(base(), 'pa', 14, 'f1') // 「帯を巻いた（図1）。」
    r = ops.addFigureBelow(r, 'pa', { id: 'f1', imageId: 'i', caption: '' })
    const all = ops.findEditable(r, 'pa')!.text
    r = ops.split(r, 'pa', all.slice(0, 8), all.slice(8)).report
    expect(types(r)).toEqual(['paragraph', 'paragraph', 'figureRow', 'paragraph'])
  })

  it('図・表のタイトルで Enter：そのまとまり（表）の下に段落ができる', () => {
    let r = ops.addFigureBelow(base(), 'pa', { id: 'f1', imageId: 'i', caption: 'デザイン画' })
    r = ops.split(r, 'f1', 'デザイン画', '').report
    expect(types(r)).toEqual(['paragraph', 'figureRow', 'paragraph', 'paragraph'])
    expect(ops.findEditable(r, 'f1')?.text).toBe('デザイン画')
  })
})
