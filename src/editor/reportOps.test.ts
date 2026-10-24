import { describe, expect, it } from 'vitest'
import { blankTable } from '../model/table'
import { demoReport as demoForTable } from '../model/demoReport'

describe('表を消す', () => {
  it('本文のその表への参照「（表n）」も一緒に消す（「（図?）」が残らない）', async () => {
    const ops = await import('./reportOps')
    let r = ops.setText(demoForTable(), 'p1', '素材をまとめた。')
    r = ops.insertRef(r, 'p1', 6, 't9')
    r = ops.addTableBelow(r, 'p1', blankTable('t9', ops.newId))
    const removed = ops.removeTable(r, 't9')
    const p1 = removed.body.flatMap((c) => c.blocks).find((b) => b.id === 'p1')
    expect(p1?.type === 'paragraph' && p1.content.some((n) => n.type === 'ref')).toBe(false)
    expect(removed.body.flatMap((c) => c.blocks).some((b) => b.id === 't9')).toBe(false)
  })
})
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
  it('抄録でも段落を分けたりつなげたりできる（分けた前の段落の終わりは「。」にする）', () => {
    const { report: splitted, newId } = ops.split(report, 'a3', '制作を通して、', '学んだ。')
    expect(text(splitted, 'a3')).toBe('制作を通して。')
    expect(text(splitted, newId)).toBe('学んだ。')
    const merged = ops.mergeBackward(splitted, newId, '学んだ。')!
    expect(merged.targetId).toBe('a3')
    expect(text(merged.report, 'a3')).toBe('制作を通して。学んだ。')
  })

  it('Enter で分けると、前の段落に「。」がなければ付ける。続いた「。」は1つにする', () => {
    const r = ops.split(report, 'a3', '袖を大きくした', '帯を巻いた。').report
    expect(text(r, 'a3')).toBe('袖を大きくした。')
    expect(text(ops.setText(report, 'a3', '袖を大きくした。。'), 'a3')).toBe('袖を大きくした。')
    expect(ops.withPeriod('本当に？')).toBe('本当に？')
    expect(ops.withPeriod('')).toBe('')
  })

  it('文末（「。」のない段落の終わり）に図を入れると、後ろに「。」を付ける', () => {
    const r = ops.insertRef(ops.setText(report, 'p4', '袖を大きくした'), 'p4', 7, 'f1')
    expect(text(r, 'p4')).toBe('袖を大きくした（図1）。')
  })

  it('空の段落・小見出し・大見出しで Backspace（前とつなげられない）：消して、前の欄の終わりへ移る。字がある・抄録・中身のある章は消さない', () => {
    const blocks = report.body.flatMap((c) => c.blocks)
    // 見出し・図などのすぐ後ろ（前とつなげられない）の段落を空にする
    const after = report.body.flatMap((c) => c.blocks.filter((x, i) => x.type === 'paragraph' && i > 0 && c.blocks[i - 1].type !== 'paragraph'))[0]
    const withEmpty = ops.setText(report, after.id, '')
    const r1 = ops.removeEmptyBackward(withEmpty, after.id, '')!
    expect(r1.what).toBe('段落')
    expect(r1.report.body.flatMap((c) => c.blocks).some((b) => b.id === after.id)).toBe(false)
    expect(r1.targetId).toBe(ops.neighbor(withEmpty, after.id, 'prev')!.id)
    expect(r1.caret).toBe(ops.neighbor(withEmpty, after.id, 'prev')!.text.length)
    expect(ops.removeEmptyBackward(withEmpty, after.id, 'x')).toBeNull()
    // 空の小見出し
    const sub = blocks.find((b) => b.type === 'subheading')!
    const r2 = ops.removeEmptyBackward(ops.setText(report, sub.id, ''), sub.id, '')!
    expect(r2.what).toBe('小見出し')
    // 大見出し：中身のある章は消さない。空の段落だけの章は消す
    const c2 = report.body[1]
    expect(ops.removeEmptyBackward(ops.setText(report, c2.id, ''), c2.id, '')).toBeNull()
    const emptyChapter = { ...report, body: [...report.body, { id: 'cx', title: '', blocks: [{ type: 'paragraph' as const, id: 'px', content: [] }] }] }
    const r3 = ops.removeEmptyBackward(emptyChapter, 'cx', '')!
    expect(r3.what).toBe('大見出し（章）')
    expect(r3.report.body.some((c) => c.id === 'cx')).toBe(false)
    // ひな形の段落（ここに書くことの説明が付いた段落）は消さない
    const hinted = { ...withEmpty, body: withEmpty.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === after.id && b.type === 'paragraph' ? { ...b, hint: '何を書くか' } : b)) })) }
    expect(ops.removeEmptyBackward(hinted, after.id, '')).toBeNull()
    // 抄録の段落は消さない
    expect(ops.removeEmptyBackward(ops.setText(report, 'a2', ''), 'a2', '')).toBeNull()
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

  it('手で書いた「（図１）」は、全角の数字・括弧の内側の空白でも、図につながる（依頼者の指摘 2026-10-24）', () => {
    for (const written of ['考えた（図１）。', '考えた（ 図 1 ）。', '考えた(図１)。']) {
      const r = ops.setText(report, 'p2', written)
      const b = r.body.flatMap((c) => c.blocks).find((x) => x.id === 'p2')
      expect(b?.type === 'paragraph' && b.content.some((n) => n.type === 'ref' && n.targetId === 'f1'), written).toBe(true)
      expect(text(r, 'p2'), written).toBe('考えた（図1）。')
    }
    // 「設計図１枚」のような語の一部はつながない
    const word = ops.setText(report, 'p2', '設計図１枚を描いた。')
    expect(text(word, 'p2')).toBe('設計図１枚を描いた。')
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
  const table = (id: string) => ({ type: 'table' as const, id, caption: '', widths: 'equal' as const, heights: 'auto' as const, rows: [] })
  const types = (r: Report) => r.body[0].blocks.map((b) => b.type)

  it('表は、段落のすぐ下（すでにある図の後ろ）に入り、本文に（表n）が入る', () => {
    let r = ops.insertRef(base(), 'pa', 8, 'f1')
    r = ops.addFigureBelow(r, 'pa', { id: 'f1', imageId: 'i', caption: '' })
    r = ops.insertRef(r, 'pa', 14 + 4, 't1')
    r = ops.addTableBelow(r, 'pa', table('t1'))
    expect(types(r)).toEqual(['paragraph', 'figureRow', 'table', 'paragraph'])
    expect(ops.findEditable(r, 'pa')?.text).toBe('袖を大きくした（図1）。帯を巻いた（表1）。')
  })

  it('段落の終わりで Enter：Word と同じく、新しい段落はすぐ下（図・表の上）にできる（依頼者の選択 2026-10-23）', () => {
    let r = ops.insertRef(base(), 'pa', 8, 'f1')
    r = ops.addFigureBelow(r, 'pa', { id: 'f1', imageId: 'i', caption: '' })
    r = ops.addTableBelow(r, 'pa', table('t1'))
    const all = ops.findEditable(r, 'pa')!.text
    const { report: splitted, newId } = ops.split(r, 'pa', all, '')
    expect(types(splitted)).toEqual(['paragraph', 'paragraph', 'figureRow', 'table', 'paragraph'])
    expect(splitted.body[0].blocks[1].id).toBe(newId)
  })

  it('途中で分けて、後ろの部分が図を参照していなければ、図は前の部分に付いたまま', () => {
    let r = ops.insertRef(base(), 'pa', 8, 'f1') // 「袖を大きくした（図1）。」
    r = ops.addFigureBelow(r, 'pa', { id: 'f1', imageId: 'i', caption: '' })
    const all = ops.findEditable(r, 'pa')!.text
    r = ops.split(r, 'pa', all.slice(0, 12), all.slice(12)).report
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

describe('図・表の後ろに段落を作る（「＋ ここに続きを書く」・タイトルで Enter。mockups/v32 ① 案A）', () => {
  const base = (): Report => ({
    ...demoReport(),
    body: [
      { id: 'c1', title: '企画', blocks: [{ type: 'paragraph', id: 'pa', content: [{ type: 'text', text: '袖を大きくした。' }] }] },
      { id: 'c2', title: '制作', blocks: [{ type: 'paragraph', id: 'pc', content: [{ type: 'text', text: '縫った。' }] }] },
    ],
  })
  const ids = (r: Report) => r.body.map((c) => c.blocks.map((b) => b.id))

  it('並んだ図のどれを指しても、図のまとまりのすぐ後ろ（同じ章の中）に空の段落ができる', () => {
    let r = ops.addFigureBelow(base(), 'pa', { id: 'f1', imageId: 'i', caption: '' })
    r = ops.addFigureAfter(r, 'f1', { id: 'f2', imageId: 'j', caption: '' })
    const row = r.body[0].blocks[1].id
    const made = ops.paragraphAfter(r, 'f1', 'pn')!
    expect(ids(made.report)).toEqual([['pa', row, 'pn'], ['pc']])
    expect(made.newId).toBe('pn')
    expect(ops.findEditable(made.report, 'pn')).toEqual({ id: 'pn', kind: 'paragraph', text: '' })
    expect(ids(ops.paragraphAfter(r, 'f2', 'pn')!.report)).toEqual([['pa', row, 'pn'], ['pc']])
  })

  it('表は、表のすぐ後ろ（表のあとに段落があっても、その前）に作る', () => {
    let r = ops.addTableBelow(base(), 'pa', blankTable('t1', ops.newId))
    r = ops.insertAfter(r, 't1', { type: 'paragraph', id: 'pb', content: [{ type: 'text', text: '次。' }] })
    expect(ids(ops.paragraphAfter(r, 't1', 'pn')!.report)).toEqual([['pa', 't1', 'pn', 'pb'], ['pc']])
  })

  it('図・表でないもの・ないものを指したら null（元の原稿は変えない）', () => {
    const r = base()
    expect(ops.paragraphAfter(r, 'pa')).toBeNull()
    expect(ops.paragraphAfter(r, 'nothing')).toBeNull()
    expect(ids(r)).toEqual([['pa'], ['pc']])
  })

  it('見出しの後ろ（「＋ ここに続きを書く」）：小見出しはそのすぐ後ろ、大見出しは章のいちばん初めに空の段落ができる', () => {
    const r = ops.insertAfter(base(), 'pa', { type: 'subheading', id: 's1', title: '素材の選定' })
    expect(ids(ops.paragraphBelow(r, 's1', 'pn')!.report)).toEqual([['pa', 's1', 'pn'], ['pc']])
    const empty: Report = { ...r, body: [...r.body, { id: 'c3', title: 'まとめ', blocks: [] }] }
    expect(ids(ops.paragraphBelow(empty, 'c3', 'pn')!.report)).toEqual([['pa', 's1'], ['pc'], ['pn']])
    // 図・表は paragraphAfter と同じ。段落・ないものは null
    const fig = ops.addFigureBelow(base(), 'pa', { id: 'f1', imageId: 'i', caption: '' })
    expect(ids(ops.paragraphBelow(fig, 'f1', 'pn')!.report)).toEqual([['pa', fig.body[0].blocks[1].id, 'pn'], ['pc']])
    expect(ops.paragraphBelow(r, 'pa')).toBeNull()
    expect(ops.paragraphBelow(r, 'nothing')).toBeNull()
  })

  it('見出しが章のいちばん最後か（大見出しは、章の中に何もないとき）', () => {
    const r = ops.insertAfter(base(), 'pa', { type: 'subheading', id: 's1', title: '素材の選定' })
    expect(ops.headingEndsChapter(r, 's1')).toBe(true)
    expect(ops.headingEndsChapter(ops.insertAfter(r, 's1', { type: 'paragraph', id: 'pb', content: [{ type: 'text', text: '' }] }), 's1')).toBe(false)
    expect(ops.headingEndsChapter(r, 'c1')).toBe(false)
    expect(ops.headingEndsChapter({ ...r, body: [...r.body, { id: 'c3', title: '', blocks: [] }] }, 'c3')).toBe(true)
    expect(ops.headingEndsChapter(r, 'pa')).toBe(false)
  })
})

describe('見出しで Enter を押したときに移る、すぐ後ろの空の段落', () => {
  const blank = (id: string, hint?: string) => ({ type: 'paragraph' as const, id, content: [{ type: 'text' as const, text: '' }], ...(hint ? { hint } : {}) })
  const r: Report = {
    ...demoReport(),
    body: [
      { id: 'c1', title: '追加の大見出し', blocks: [blank('p1'), { type: 'subheading', id: 's1', title: '素材' }, blank('p2')] },
      { id: 'c2', title: 'まとめ', blocks: [blank('p3', '振り返りを書く'), { type: 'subheading', id: 's2', title: '' }, { type: 'paragraph', id: 'p4', content: [{ type: 'text', text: '書いた。' }] }] },
    ],
  }

  it('大見出しは章の最初、小見出しはすぐ後ろの段落が、何も書いていない（説明もない）ならその ID', () => {
    expect(ops.blankParagraphAfterHeading(r, 'c1')).toBe('p1')
    expect(ops.blankParagraphAfterHeading(r, 's1')).toBe('p2')
  })

  it('ひな形の説明がある段落・書いてある段落・段落でないもののときは null', () => {
    expect(ops.blankParagraphAfterHeading(r, 'c2')).toBeNull()
    expect(ops.blankParagraphAfterHeading(r, 's2')).toBeNull()
    expect(ops.blankParagraphAfterHeading(r, 'p1')).toBeNull()
  })
})

describe('図・表を消したときの本文の参照（文を崩さない）', () => {
  const base = (text: string): Report => ({
    ...demoReport(),
    body: [{ id: 'c1', title: '企画', blocks: [{ type: 'paragraph', id: 'pa', content: [{ type: 'text', text }] }] }],
  })
  const fig = (id: string) => ({ id, imageId: `img-${id}`, caption: 'デザイン画' })
  const paraText = (r: Report, id: string) => ops.findEditable(r, id)?.text

  it('文の中で使っている「図1」は、消さずに「図?」の文字にして残す（「デザイン画をに示す。」にしない）', () => {
    // 「直す」で手で書いた「図1」を図につなげたあと、図を消した
    let r = ops.addFigureBelow(base('デザイン画を図1に示す。'), 'pa', fig('f1'))
    r = ops.setText(r, 'pa', 'デザイン画を図1に示す。')
    expect(r.body[0].blocks[0].type === 'paragraph' && r.body[0].blocks[0].content.some((n) => n.type === 'ref')).toBe(true)
    const removed = ops.removeFigure(r, 'f1')
    expect(paraText(removed, 'pa')).toBe('デザイン画を図?に示す。')
    // 元の原稿はそのまま（元に戻すと、図も文も戻る）
    expect(paraText(r, 'pa')).toBe('デザイン画を図1に示す。')
  })

  it('文末に添えた「（図1）」は括弧ごと消す。「（図1）に示す」のように文の中の括弧付きは「（図?）」にする', () => {
    let r = ops.insertRef(base('袖を大きくした。'), 'pa', 8, 'f1')
    r = ops.addFigureBelow(r, 'pa', fig('f1'))
    expect(paraText(ops.removeFigure(r, 'f1'), 'pa')).toBe('袖を大きくした。')
    const inside = ops.setText(ops.addFigureBelow(base('x'), 'pa', fig('f1')), 'pa', '（図1）に示すように、袖を大きくした。')
    expect(paraText(ops.removeFigure(inside, 'f1'), 'pa')).toBe('（図?）に示すように、袖を大きくした。')
  })

  it('表を消したときも同じ。文の中の「表1」は「表?」になる（「図?」にはしない）', () => {
    let r = ops.addTableBelow(base('x'), 'pa', blankTable('t1', ops.newId))
    r = ops.setText(r, 'pa', '使用した素材を表1に示す。')
    expect(paraText(ops.removeTable(r, 't1'), 'pa')).toBe('使用した素材を表?に示す。')
  })
})

describe('図表の番号を手で書いていたとき（二重にしない）', () => {
  const base = (text: string): Report => ({
    ...demoReport(),
    body: [{ id: 'c1', title: '企画', blocks: [{ type: 'paragraph', id: 'pa', content: [{ type: 'text', text }] }] }],
  })
  const paraText = (r: Report, id: string) => ops.findEditable(r, id)?.text
  const refs = (r: Report, id: string) => {
    const b = r.body.flatMap((c) => c.blocks).find((x) => x.id === id)
    return b?.type === 'paragraph' ? b.content.filter((n) => n.type === 'ref') : []
  }

  it('図を入れたとき、段落にその番号を手で書いていれば（図1）は足さず、書いた「図1」を図につなげる', () => {
    let r = ops.insertRef(base('デザイン画を図1に示す。'), 'pa', 12, 'f1')
    r = ops.addFigureBelow(r, 'pa', { id: 'f1', imageId: 'i', caption: '' })
    expect(paraText(r, 'pa')).toBe('デザイン画を図1に示す（図1）。')
    const linked = ops.linkWrittenRef(r, 'pa', 'f1')!
    expect(paraText(linked, 'pa')).toBe('デザイン画を図1に示す。')
    expect(refs(linked, 'pa')).toEqual([{ type: 'ref', targetId: 'f1', withParens: false }])
  })

  it('表も同じ（全角の数字で書いていても）。番号を書いていなければ null（自動の（表1）のまま）', () => {
    let r = ops.insertRef(base('使用した素材を表１に示す。'), 'pa', 13, 't1')
    r = ops.addTableBelow(r, 'pa', blankTable('t1', ops.newId))
    expect(paraText(ops.linkWrittenRef(r, 'pa', 't1')!, 'pa')).toBe('使用した素材を表1に示す。')
    let plain = ops.insertRef(base('素材をまとめた。'), 'pa', 8, 't1')
    plain = ops.addTableBelow(plain, 'pa', blankTable('t1', ops.newId))
    expect(ops.linkWrittenRef(plain, 'pa', 't1')).toBeNull()
  })
})

describe('ひな形の説明（hint）と、抄録を書き始めたか（started）を保つ', () => {
  const withHint = (): Report => ({
    ...demoReport(),
    abstract: { ...demoReport().abstract, started: true },
    body: [{ id: 'c1', title: '企画', blocks: [{ type: 'paragraph', id: 'ph', content: [{ type: 'text', text: '' }], hint: '制作の目的を書く' }] }],
  })
  const hintOf = (r: Report, id: string) => r.body.flatMap((c) => c.blocks).find((b) => b.id === id && b.type === 'paragraph')
  const hint = (r: Report, id: string) => {
    const b = hintOf(r, id)
    return b?.type === 'paragraph' ? b.hint : undefined
  }

  it('空の段落を開いて、何も書かずに閉じても（空のまま確定しても）、説明は消えない。書いて消したときも戻る', () => {
    expect(hint(ops.setText(withHint(), 'ph', ''), 'ph')).toBe('制作の目的を書く')
    const written = ops.setText(withHint(), 'ph', '目的を書いた。')
    expect(hint(ops.setText(written, 'ph', ''), 'ph')).toBe('制作の目的を書く')
  })

  it('Enter で分けたときは、前の段落に説明を残す（新しい段落には付けない）', () => {
    const { report: r, newId } = ops.split(withHint(), 'ph', '', '')
    expect(hint(r, 'ph')).toBe('制作の目的を書く')
    expect(hint(r, newId)).toBeUndefined()
  })

  it('抄録の段落を書き換えても・分けても・つなげても、書き始めたこと（started）は消えない', () => {
    const r = withHint()
    expect(ops.setText(r, 'a3', '学んだ。').abstract.started).toBe(true)
    const splitted = ops.split(r, 'a3', '学んだ。', '次。')
    expect(splitted.report.abstract.started).toBe(true)
    expect(ops.mergeBackward(splitted.report, splitted.newId, '次。')?.report.abstract.started).toBe(true)
    expect(ops.replaceWithParagraphs(r, 'a3', ['一。', '二。']).report.abstract.started).toBe(true)
  })
})

describe('図・表の参照は、カーソルのある文の終わりに入れる', () => {
  const base = (text: string): Report => ({
    ...demoReport(),
    body: [{ id: 'c1', title: '企画', blocks: [{ type: 'paragraph', id: 'pa', content: [{ type: 'text', text }] }] }],
  })
  const ref = (text: string, offset: number) => {
    let r = ops.insertRef(base(text), 'pa', offset, 'f1')
    r = ops.addFigureBelow(r, 'pa', { id: 'f1', imageId: 'i', caption: '' })
    return ops.findEditable(r, 'pa')?.text
  }

  it('文の途中で入れると、その文の「。」の前に入る（「確かめ（図1）、汚れや…」にしない）', () => {
    expect(ref('生地の色を確かめ、汚れや傷がないかを見た。次に裁断した。', 8)).toBe('生地の色を確かめ、汚れや傷がないかを見た（図1）。次に裁断した。')
    expect(ref('生地の色を確かめ、汚れや傷がないかを見た。次に裁断した。', 24)).toBe('生地の色を確かめ、汚れや傷がないかを見た。次に裁断した（図1）。')
  })

  it('文末の「。」の直後なら、その文に。後ろに「。」がなければ段落の終わりに入れ、「。」を付ける', () => {
    expect(ref('袖を大きくした。帯を巻いた。', 8)).toBe('袖を大きくした（図1）。帯を巻いた。')
    expect(ref('袖を大きくした。帯を巻いた', 10)).toBe('袖を大きくした。帯を巻いた（図1）。')
  })

  it('段落に手で書いた「図1」があれば、自動の（図1）は足さずにつなげる（前と同じ）', () => {
    let r = ops.insertRef(base('デザイン画を図1に示す。生地も選んだ。'), 'pa', 3, 'f1')
    r = ops.addFigureBelow(r, 'pa', { id: 'f1', imageId: 'i', caption: '' })
    r = ops.linkWrittenRef(r, 'pa', 'f1') ?? r
    expect(ops.findEditable(r, 'pa')?.text).toBe('デザイン画を図1に示す。生地も選んだ。')
  })
})

describe('空の段落と置き換える（小見出し・図・表を、何も書いていない段落で入れたとき）', () => {
  const base = (): Report => ({
    ...demoReport(),
    body: [
      {
        id: 'c1',
        title: '企画',
        blocks: [
          { type: 'paragraph', id: 'pa', content: [{ type: 'text', text: '袖を大きくした。' }] },
          { type: 'paragraph', id: 'pe', content: [{ type: 'text', text: '' }] },
          { type: 'paragraph', id: 'ph', content: [{ type: 'text', text: '' }], hint: '工夫した点を書く' },
        ],
      },
    ],
  })

  it('何も書いていない・説明もない段落だけが置き換えの対象（説明のある段落・書いてある段落は対象にしない）', () => {
    expect(ops.isBlankParagraph(base(), 'pe')).toBe(true)
    expect(ops.isBlankParagraph(base(), 'ph')).toBe(false)
    expect(ops.paragraphEmpty(base(), 'ph')).toBe(true)
    expect(ops.isBlankParagraph(base(), 'pa')).toBe(false)
  })

  it('置き換えると同じ位置に入り、空の段落は残らない', () => {
    const r = ops.replaceBlock(base(), 'pe', { type: 'subheading', id: 's9', title: '' })
    expect(r.body[0].blocks.map((b) => b.id)).toEqual(['pa', 's9', 'ph'])
  })

  it('本文の章・ブロック・図・表のセルは、足す位置の目印になる（抄録・表紙はならない）', () => {
    const r = demoReport()
    expect(ops.inBody(r, 'c1')).toBe(true)
    expect(ops.inBody(r, 'p1')).toBe(true)
    expect(ops.inBody(r, 'f1')).toBe(true)
    expect(ops.inBody(r, 'm2:usage')).toBe(true)
    expect(ops.inBody(r, 'a1')).toBe(false)
    expect(ops.inBody(r, 'basic:name')).toBe(false)
  })
})

describe('段落に打った見出し（paragraphToHeading・headingLabel）', () => {
  /** c2：小見出し s4、段落 p4・p5。段落 px を p4 と p5 の間に足した原稿 */
  const withTyped = (text: string, hint?: string): Report => {
    const r = demoReport()
    return {
      ...r,
      body: r.body.map((c) => (c.id === 'c2' ? { ...c, blocks: [c.blocks[0], c.blocks[1], { type: 'paragraph', id: 'px', content: [{ type: 'text', text }], ...(hint ? { hint } : {}) }, c.blocks[2]] } : c)),
    }
  }
  const ids = (r: Report) => r.body.map((c) => `${c.id}:${c.blocks.map((b) => b.id).join(',')}`)

  it('大見出し：そこから新しい章を始め、同じ章の後ろのブロックは新しい章に入る（番号は自動で付く）', () => {
    const r = withTyped('Ⅴ．仕上げ')
    const result = ops.paragraphToHeading(r, 'px', { level: 1, title: '仕上げ' })!
    const body = result.report.body
    expect(body.map((c) => c.title)).toEqual(['企画・立案', '制作過程', '仕上げ', 'まとめ'])
    expect(body[1].blocks.map((b) => b.id)).toEqual(['s4', 'p4'])
    expect(body[2]).toMatchObject({ id: result.headingId, title: '仕上げ' })
    expect(body[2].blocks.map((b) => b.id)).toEqual(['p5'])
    expect(result.nextId).toBeNull()
    // 打った「Ⅴ」ではなく、3つ目の章の番号
    expect(ops.headingLabel(result.report, result.headingId)).toBe('Ⅲ．仕上げ')
    // 元の原稿は変えない
    expect(ids(r)).toEqual(['c1:s1,p1,s2,p2,r1,s3,p3,t1', 'c2:s4,p4,px,p5', 'c3:p6'])
  })

  it('大見出しで Enter（rest）：見出しのすぐ後ろに段落を作り、その後ろに章の残りが続く。ひな形の説明は、その段落に移す', () => {
    const r = withTyped('Ⅲ．仕上げあとの文', 'ここに仕上げを書く')
    const result = ops.paragraphToHeading(r, 'px', { level: 1, title: '仕上げ' }, 'あとの文')!
    const added = result.report.body[2]
    expect(added.blocks.map((b) => b.id)).toEqual([result.nextId, 'p5'])
    expect(added.blocks[0]).toMatchObject({ type: 'paragraph', content: [{ type: 'text', text: 'あとの文' }], hint: 'ここに仕上げを書く' })
  })

  it('章の最初の段落を大見出しにすると、前の章は空になり、章の中身はすべて新しい章に入る', () => {
    const r = demoReport()
    const result = ops.paragraphToHeading(r, 'p6', { level: 1, title: '振り返り' }, '')!
    expect(result.report.body.map((c) => c.blocks.length)).toEqual([8, 3, 0, 1])
    expect(ops.headingLabel(result.report, result.headingId)).toBe('Ⅳ．振り返り')
  })

  it('小見出し：その位置に入り（番号は章ごとに自動）、rest があればすぐ後ろに段落を作る', () => {
    const r = withTyped('ⅴ．縫製')
    const result = ops.paragraphToHeading(r, 'px', { level: 2, title: '縫製' }, '')!
    expect(ids(result.report)[1]).toBe(`c2:s4,p4,${result.headingId},${result.nextId},p5`)
    expect(result.report.body[1].blocks[2]).toEqual({ type: 'subheading', id: result.headingId, title: '縫製' })
    expect(ops.headingLabel(result.report, result.headingId)).toBe('ⅱ．縫製')
    expect(result.report.body).toHaveLength(3)
  })

  it('段落と、その下の図・表の間で打った見出しは、図・表の後ろに置く（図・表を説明の段落から離さない。2026-10-23）', () => {
    const r = demoReport()
    // c1：… s2, p2, r1, s3, p3, t1。p2 と図 r1 の間に、見出しの形の段落を打った
    const typed: Report = { ...r, body: r.body.map((c) => (c.id === 'c1' ? { ...c, blocks: c.blocks.flatMap((b) => (b.id === 'p2' ? [b, { type: 'paragraph' as const, id: 'px', content: [{ type: 'text' as const, text: 'ⅲ．スカート' }] }] : [b])) } : c)) }
    const sub = ops.paragraphToHeading(typed, 'px', { level: 2, title: 'スカート' }, '')!
    expect(ids(sub.report)[0]).toBe(`c1:s1,p1,s2,p2,r1,${sub.headingId},${sub.nextId},s3,p3,t1`)
    const chapter = ops.paragraphToHeading(typed, 'px', { level: 1, title: '仕上げ' }, '')!
    expect(ids(chapter.report).slice(0, 2)).toEqual(['c1:s1,p1,s2,p2,r1', `${chapter.headingId}:${chapter.nextId},s3,p3,t1`])
  })

  it('本文の段落でなければ（抄録・見出し・図・表）null', () => {
    const r = demoReport()
    for (const id of ['a1', 's1', 'c1', 'f1', 't1', 'nothing']) expect(ops.paragraphToHeading(r, id, { level: 1, title: 'x' }), id).toBeNull()
  })

  it('headingLabel：大見出しは章の番号、小見出しは章の中の番号。見出しでなければ null', () => {
    const r = demoReport()
    expect(ops.headingLabel(r, 'c3')).toBe('Ⅲ．まとめ')
    expect(ops.headingLabel(r, 's3')).toBe('ⅲ．使用素材')
    expect(ops.headingLabel(r, 's4')).toBe('ⅰ．ジャケット')
    expect(ops.headingLabel(r, 'p1')).toBeNull()
  })

  it('何行かの貼り付け：行ごとの段落の ID を返す（1行目は今の段落）', () => {
    const { ids: pasted } = ops.replaceWithParagraphs(demoReport(), 'p6', ['Ⅳ．振り返り', '本文。'])
    expect(pasted).toHaveLength(2)
    expect(pasted[0]).toBe('p6')
  })
})

describe('図の置き場所（「小見出しの終わりへ」「段落の下へ戻す」：依頼者の選択 2026-10-22 案A）', () => {
  const t = (text: string) => ({ type: 'text' as const, text })
  const p = (id: string, ref?: string) => ({ type: 'paragraph' as const, id, content: ref ? [t('…'), { type: 'ref' as const, targetId: ref, withParens: true }, t('。')] : [t(id)] })
  const row = (id: string, ...figs: string[]) => ({ type: 'figureRow' as const, id, figures: figs.map((f) => ({ id: f, imageId: '', caption: f })) })
  const report = (blocks: Report['body'][number]['blocks']): Report => ({ ...demoReport(), body: [{ id: 'c1', title: '企画・立案', blocks }] })
  const order = (r: Report) => r.body[0].blocks.map((b) => b.id)

  it('小見出しのまとまりのいちばん下へ動かす（まとまりの終わりの改ページの手前）。動かしたあとは「段落の下へ戻す」で元の所へ', () => {
    const r0 = report([{ type: 'subheading', id: 's2', title: 'デザイン説明' }, p('p1', 'f1'), row('r1', 'f1'), p('p2'), p('p3'), { type: 'pageBreak', id: 'pb' }, { type: 'subheading', id: 's3', title: '使用素材' }, p('p4')])
    expect(ops.figurePlacement(r0, 'f1')).toMatchObject({ toSectionEnd: true, toParagraph: false })
    const r1 = ops.moveFigureRow(r0, 'f1', 'sectionEnd')
    expect(order(r1)).toEqual(['s2', 'p1', 'p2', 'p3', 'r1', 'pb', 's3', 'p4'])
    expect(ops.figurePlacement(r1, 'f1')).toMatchObject({ toSectionEnd: false, toParagraph: true })
    const r2 = ops.moveFigureRow(r1, 'f1', 'paragraph')
    expect(order(r2)).toEqual(order(r0))
  })

  it('動かす先がいまの所なら、同じ原稿（段落が小見出しのまとまりの最後なら、どちらも出さない）。2枚並べた図は、まとめて動かす', () => {
    const r0 = report([{ type: 'subheading', id: 's1', title: 'a' }, p('p1'), p('p2', 'f1'), row('r1', 'f1', 'f2'), { type: 'subheading', id: 's2', title: 'b' }])
    expect(ops.figurePlacement(r0, 'f2')).toMatchObject({ toSectionEnd: false, toParagraph: false })
    expect(ops.moveFigureRow(r0, 'f2', 'sectionEnd')).toBe(r0)
    const r1 = report([{ type: 'subheading', id: 's1', title: 'a' }, p('p1', 'f1'), row('r1', 'f1', 'f2'), p('p2'), { type: 'subheading', id: 's2', title: 'b' }])
    expect(order(ops.moveFigureRow(r1, 'f2', 'sectionEnd'))).toEqual(['s1', 'p1', 'p2', 'r1', 's2'])
  })

  it('図の後ろに図・表しか続かないなら、もう終わりにあるとみなす（「段落の下へ戻す」を出す）', () => {
    const r0 = report([{ type: 'subheading', id: 's1', title: 'a' }, p('p1', 'f1'), p('p2', 'f2'), p('p3'), row('r1', 'f1'), row('r2', 'f2'), { type: 'subheading', id: 's2', title: 'b' }])
    expect(ops.figurePlacement(r0, 'f1')).toMatchObject({ toSectionEnd: false, toParagraph: true })
    expect(ops.moveFigureRow(r0, 'f1', 'sectionEnd')).toBe(r0)
    expect(order(ops.moveFigureRow(r0, 'f1', 'paragraph'))).toEqual(['s1', 'p1', 'r1', 'p2', 'p3', 'r2', 's2'])
  })

  it('「上へ」「下へ」：前・後ろの1つと入れ替える。章（小見出し）の終わりでは、それ以上動かない（依頼者の選択 2026-10-23）', () => {
    const r0 = report([{ type: 'subheading', id: 's1', title: 'a' }, p('p1', 'f1'), row('r1', 'f1', 'f2'), p('p2'), { type: 'table', id: 't1', caption: '', rows: [] } as never, p('p3')])
    expect(ops.figurePlacement(r0, 'f2')).toMatchObject({ down: true })
    let down = r0
    for (let i = 0; i < 3; i++) down = ops.moveFigureRow(down, 'f1', 'down')
    expect(order(down)).toEqual(['s1', 'p1', 'p2', 't1', 'p3', 'r1'])
    expect(ops.figurePlacement(down, 'f1')).toMatchObject({ up: true, down: false })
    expect(ops.moveFigureRow(down, 'f1', 'down')).toBe(down)
    const up = ops.moveFigureRow(down, 'f2', 'up')
    expect(order(up)).toEqual(['s1', 'p1', 'p2', 't1', 'r1', 'p3'])
  })

  it('「上へ」は、本文の（図n）がある段落より上には動かない。参照が前の章・ない図は章のはじめまで、後ろの章にしかない図は動かない（2026-10-24）', () => {
    // 同じ章に参照：その段落のすぐ下まで
    const r0 = report([{ type: 'subheading', id: 's1', title: 'a' }, p('p1', 'f1'), p('p2'), row('r1', 'f1'), p('p3')])
    expect(ops.figurePlacement(r0, 'f1')).toMatchObject({ up: true })
    const r1 = ops.moveFigureRow(r0, 'f1', 'up')
    expect(order(r1)).toEqual(['s1', 'p1', 'r1', 'p2', 'p3'])
    expect(ops.figurePlacement(r1, 'f1')).toMatchObject({ up: false, down: true })
    expect(ops.moveFigureRow(r1, 'f1', 'up')).toBe(r1)
    // 2枚並びは、どちらかの図を参照している最初の段落より下
    const two = report([p('pa', 'f2'), p('pb'), row('r2', 'f1', 'f2')])
    expect(order(ops.moveFigureRow(two, 'f1', 'up'))).toEqual(['pa', 'r2', 'pb'])
    // 参照が前の章：この章のはじめまで（章はまたがない）
    const chapters = (c1: Report['body'][number]['blocks'], c2: Report['body'][number]['blocks']): Report => ({ ...demoReport(), body: [{ id: 'c1', title: '企画', blocks: c1 }, { id: 'c2', title: '制作', blocks: c2 }] })
    const earlier = chapters([p('p1', 'f1')], [p('p2'), row('r1', 'f1')])
    const e1 = ops.moveFigureRow(earlier, 'f1', 'up')
    expect(e1.body.map((c) => c.blocks.map((b) => b.id))).toEqual([['p1'], ['r1', 'p2']])
    expect(ops.figurePlacement(e1, 'f1')).toMatchObject({ up: false })
    // 参照のない図も、章のはじめまで
    expect(ops.figurePlacement(chapters([p('p1')], [p('p2'), row('r1', 'f1')]), 'f1')).toMatchObject({ up: true })
    // 参照が後ろの章にしかない：上へは動かない（下へは動く）
    const later = chapters([p('p1'), row('r1', 'f1'), p('p2')], [p('p3', 'f1')])
    expect(ops.figurePlacement(later, 'f1')).toMatchObject({ up: false, down: true })
  })

  it('「上へ」「下へ」で、本文で出てくる順が入れ替わるようには、ほかの図を越えない（入れ替わりを直す向きには越える。2026-10-24）', () => {
    // 本文：図A（fa）が先、図B（fb）があと。紙面も A・B の順
    const r0 = report([p('p1', 'fa'), p('p2', 'fb'), row('ra', 'fa'), row('rb', 'fb'), p('p3')])
    expect(ops.figurePlacement(r0, 'fa')).toMatchObject({ down: false })
    expect(ops.figurePlacement(r0, 'fb')).toMatchObject({ up: false, down: true })
    // 紙面が B・A の順（入れ替わっている）なら、直す向きには動く
    const r1 = report([p('p1', 'fa'), p('p2', 'fb'), row('rb', 'fb'), row('ra', 'fa'), p('p3')])
    expect(ops.figurePlacement(r1, 'fa')).toMatchObject({ up: true })
    expect(order(ops.moveFigureRow(r1, 'fb', 'down'))).toEqual(['p1', 'p2', 'ra', 'rb', 'p3'])
    // 本文に出てこない図とは、どちらの向きにも越える
    const r2 = report([p('p1', 'fa'), row('ra', 'fa'), row('rx', 'fx'), p('p2')])
    expect(ops.figurePlacement(r2, 'fa')).toMatchObject({ down: true })
  })

  it('並びから外す：並んだ図を1枚ずつにする（順番はそのまま）。横に並べる：すぐ上・下の1枚だけの図と並べる（2026-10-24）', () => {
    const rows = (r: Report) => r.body[0].blocks.filter((b) => b.type === 'figureRow').map((b) => (b.type === 'figureRow' ? b.figures.map((f) => f.id).join('+') : ''))
    const r0 = report([p('p1', 'fa'), row('r1', 'fa', 'fb'), p('p2')])
    expect(ops.figurePairing(r0, 'fb')).toEqual({ split: true, join: null })
    const split = ops.splitFigureRow(r0, 'fb')
    expect(rows(split)).toEqual(['fa', 'fb'])
    expect(split.body[0].blocks[1].id).toBe('r1')
    expect(ops.splitFigureRow(r0, 'fa')).toMatchObject({ body: [{ blocks: expect.arrayContaining([expect.objectContaining({ id: 'r1', figures: [expect.objectContaining({ id: 'fa' })] })]) }] })
    // 分けた2枚は、どちらからでも横に並べ直せる（上を先に見る）
    expect(ops.figurePairing(split, 'fb')).toEqual({ split: false, join: 'above' })
    expect(ops.figurePairing(split, 'fa')).toEqual({ split: false, join: 'below' })
    expect(rows(ops.joinFigureRow(split, 'fb'))).toEqual(['fa+fb'])
    expect(rows(ops.joinFigureRow(split, 'fa'))).toEqual(['fa+fb'])
    // 3枚並びの真ん中を外すと、前・その図・後ろの3つに分かれる
    expect(rows(ops.splitFigureRow(report([row('r3', 'f1', 'f2', 'f3')]), 'f2'))).toEqual(['f1', 'f2', 'f3'])
    // 間に段落がある・相手が2枚並びなら、横に並べない
    const apart = report([row('ra', 'fa'), p('p1'), row('rb', 'fb')])
    expect(ops.figurePairing(apart, 'fb').join).toBeNull()
    expect(ops.joinFigureRow(apart, 'fb')).toBe(apart)
    expect(ops.figurePairing(report([row('ra', 'fa', 'fx'), row('rb', 'fb')]), 'fb').join).toBeNull()
  })

  it('「上へ」「下へ」は、小見出しの境を越えない（小見出しの中だけ。依頼者の選択 2026-10-24）', () => {
    const r0 = report([{ type: 'subheading', id: 's1', title: 'a' }, p('p1', 'f1'), row('r1', 'f1'), p('p2'), { type: 'subheading', id: 's2', title: 'b' }, p('p3')])
    const r1 = ops.moveFigureRow(r0, 'f1', 'down')
    expect(order(r1)).toEqual(['s1', 'p1', 'p2', 'r1', 's2', 'p3'])
    expect(ops.figurePlacement(r1, 'f1')).toMatchObject({ up: true, down: false })
    expect(ops.moveFigureRow(r1, 'f1', 'down')).toBe(r1)
    // 参照のない図も、小見出しの上へは動かない
    const top = report([{ type: 'subheading', id: 's1', title: 'a' }, p('p1'), { type: 'subheading', id: 's2', title: 'b' }, row('r2', 'f2'), p('p2')])
    expect(ops.figurePlacement(top, 'f2')).toMatchObject({ up: false, down: true })
  })

  it('終わりに、本文で後に出てくる図がすでにあれば、その前に入れる（図の番号が本文で出てくる順のまま）', () => {
    const r0 = report([{ type: 'subheading', id: 's1', title: 'a' }, p('p1', 'f1'), row('r1', 'f1'), p('p2'), p('p3', 'f2'), row('r2', 'f2'), { type: 'subheading', id: 's2', title: 'b' }])
    expect(ops.figurePlacement(r0, 'f1')).toMatchObject({ toSectionEnd: true, toParagraph: false })
    const r1 = ops.moveFigureRow(r0, 'f1', 'sectionEnd')
    expect(order(r1)).toEqual(['s1', 'p1', 'p2', 'p3', 'r1', 'r2', 's2'])
    expect(ops.figurePlacement(r1, 'f1')).toMatchObject({ toSectionEnd: false, toParagraph: true })
    expect(ops.figurePlacement(r1, 'f2')).toMatchObject({ toSectionEnd: false, toParagraph: false })
    expect(order(ops.moveFigureRow(r1, 'f1', 'paragraph'))).toEqual(order(r0))
  })

  it('大見出しのはじめの部分（最初の小見出しの前）の図は、最初の小見出しの前まで。小見出しがなければ章の終わりまで', () => {
    const r0 = report([p('p1', 'f1'), row('r1', 'f1'), p('p2'), { type: 'subheading', id: 's1', title: 'a' }, p('p3')])
    expect(order(ops.moveFigureRow(r0, 'f1', 'sectionEnd'))).toEqual(['p1', 'p2', 'r1', 's1', 'p3'])
    const r1 = report([p('p1', 'f1'), row('r1', 'f1'), p('p2'), p('p3')])
    expect(order(ops.moveFigureRow(r1, 'f1', 'sectionEnd'))).toEqual(['p1', 'p2', 'p3', 'r1'])
  })
})
