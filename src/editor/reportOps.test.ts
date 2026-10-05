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
