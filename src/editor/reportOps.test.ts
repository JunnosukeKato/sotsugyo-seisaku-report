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
