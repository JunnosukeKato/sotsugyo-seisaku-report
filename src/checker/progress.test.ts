import { describe, expect, it } from 'vitest'
import { currentConfig, type YearConfig } from '../config'
import * as ops from '../editor/reportOps'
import type { LayoutInfo } from '../layout/measure'
import { createReport } from '../model/newReport'
import type { Report } from '../model/types'
import { exportNote, notYetCount, NOT_YET_RULES, progressRows, splitFindings } from './progress'
import { checkReportDetailed } from './reportChecks'

const layout = (over: Partial<LayoutInfo> = {}): LayoutInfo => ({
  kinds: [],
  bodyPages: 3,
  abstractPages: 1,
  abstractLines: 1,
  tocPageNumbers: {},
  figuresPerBodyPage: [],
  pageBreaks: [],
  ...over,
})

/** 標準のひな形（大見出しと段落だけ。図の枠・素材表なし）のコース */
const plainConfig: YearConfig = { ...currentConfig, courses: currentConfig.courses.map((c) => ({ ...c, template: undefined })) }

/**
 * 書き始めたばかりの原稿（コースを選び、学籍番号だけ入れた。氏名・サブタイトルは空、抄録は先生の許可の前）。
 * 同梱の設定のコース（映画・舞台衣装）は、ひな形に図の枠（デザイン画）と素材表がある
 */
function fresh(config: YearConfig = currentConfig): Report {
  const course = config.courses.find((c) => !c.hidden)!.id
  const r = createReport(config, course)
  return { ...r, basicInfo: { ...r.basicInfo, studentId: '00ZZ0123' } }
}

const findingsOf = (r: Report, l: LayoutInfo | null = layout(), config = currentConfig) => checkReportDetailed(r, config, l).findings
const split = (r: Report, l: LayoutInfo | null = layout(), config = currentConfig) => splitFindings(findingsOf(r, l, config), { report: r, config, layout: l })
const rows = (r: Report, l: LayoutInfo | null = layout(), pending = false, config = currentConfig) => progressRows(findingsOf(r, l, config), { report: r, config, layout: l }, pending)
const row = (r: Report, id: string, l: LayoutInfo | null = layout()) => rows(r, l).find((x) => x.id === id)!

const blocksOf = (r: Report) => r.body.flatMap((c) => c.blocks)
/** ひな形の段落（書くことの説明がある段落） */
const templateParagraphs = (r: Report) => blocksOf(r).flatMap((b) => (b.type === 'paragraph' && b.hint ? [b.id] : []))

describe('まだのところ・直すところに分ける（mockups/v35 ① 案A）', () => {
  it('書き始めたばかりの原稿は、直すところが0（赤い指摘が出ない）。指摘は全部まだのところ（標準のひな形）', () => {
    const r = fresh(plainConfig)
    const { notYet, fixes } = split(r, layout(), plainConfig)
    expect(fixes).toEqual([])
    expect(new Set(notYet.map((f) => f.ruleId))).toEqual(new Set(['required-field', 'body-pages', 'paragraph-empty', 'photos-required', 'abstract-not-started']))
  })

  it('ひな形に図の枠と素材表があるコースでも、書き始めたばかりなら直すところは0（写真・セル・「図1」はまだのところ）', () => {
    const r = fresh()
    const { notYet, fixes } = split(r)
    expect(fixes).toEqual([])
    expect(notYet.map((f) => f.ruleId)).toEqual(expect.arrayContaining(['figure-image', 'figure-unreferenced', 'table-unreferenced', 'swatch-image', 'table-cell-empty']))
  })

  it('図のすぐ前の段落を書いたのに「図1」がなければ、直すところ（エラー）', () => {
    const r0 = fresh()
    const blocks = blocksOf(r0)
    const figureAt = blocks.findIndex((b) => b.type === 'figureRow')
    const before = blocks.slice(0, figureAt).reverse().find((b) => b.type === 'paragraph')!.id
    const r = ops.setText(r0, before, '筆者は、十八世紀の船乗りの装いをもとにデザインした。')
    const { fixes } = split(r)
    expect(fixes.map((f) => [f.ruleId, f.severity])).toContainEqual(['figure-unreferenced', 'error'])
    expect(fixes.some((f) => f.ruleId === 'table-unreferenced')).toBe(false)
  })

  it('コースの設定「表の空の行」が「空のままでよい」なら、ひな形で用意した素材表の枠（6行）のまるごと空の行は数えない。書き始めた行の空欄（生地見本の写真など）は、まだのところ。どの行も空なら、まだのところ。設定のないコースは、空の行も数える', () => {
    const okConfig: YearConfig = { ...currentConfig, courses: currentConfig.courses.map((c) => ({ ...c, blankRowsOk: true })) }
    const r0 = fresh()
    const table = blocksOf(r0).find((b) => b.type === 'table')!
    const cell = (id: string, text = '', imageId: string | null = null) => ({ id, text, imageId })
    const withRows = (rows: [string, string, string | null][]): Report => ({
      ...r0,
      body: r0.body.map((c) => ({
        ...c,
        blocks: c.blocks.map((b) =>
          b.id === table.id && b.type === 'table'
            ? { ...b, rows: [b.rows[0], ...rows.map(([name, use, img], i) => ({ id: `r${i}`, cells: [cell(`r${i}a`, name), cell(`r${i}b`, use), cell(`r${i}c`, '', img)] }))] }
            : b,
        ),
      })),
    })
    const empty: [string, string, string | null] = ['', '', null]
    const holes = (r: Report, config = okConfig) => findingsOf(r, layout(), config).filter((f) => f.ruleId === 'table-cell-empty' || f.ruleId === 'swatch-image').map((f) => `${f.ruleId}:${f.blockId}`)
    // 2行を書いて、4行は空：空の4行は数えない
    expect(holes(withRows([['コットンサテン', 'ブラウス', 'img1'], ['シルクシフォン', '袖', 'img2'], empty, empty, empty, empty]))).toEqual([])
    // 書き始めた行の、生地見本の写真がない・使用箇所が空：知らせる（空の行は数えない）
    expect(holes(withRows([['コットンサテン', 'ブラウス', 'img1'], ['シルクシフォン', '', null], empty, empty, empty, empty]))).toEqual(['table-cell-empty:r1b', 'table-cell-empty:r1c', 'swatch-image:r1c'])
    // どの行も空：今までどおり、空いている所
    expect(holes(withRows([empty, empty, empty, empty, empty, empty]))).toHaveLength(6 * 3 + 6)
    // 設定のないコース：空の4行も、空いている所（セル 4×3・生地見本の写真 4）
    expect(holes(withRows([['コットンサテン', 'ブラウス', 'img1'], ['シルクシフォン', '袖', 'img2'], empty, empty, empty, empty]), currentConfig)).toHaveLength(4 * 3 + 4)
  })

  it('書いた文の間違いは、直すところ（エラー・要確認のまま）', () => {
    const r0 = fresh(plainConfig)
    const r = ops.setText(r0, templateParagraphs(r0)[0], '私が担当したのは、衣装です。')
    const { fixes } = split(r, layout(), plainConfig)
    expect(fixes.map((f) => f.ruleId)).toEqual(expect.arrayContaining(['first-person', 'desu-masu']))
    expect(fixes.some((f) => NOT_YET_RULES.includes(f.ruleId as never))).toBe(false)
  })

  it('説明のない空の段落（Enter で残ったもの）は直すところ、ひな形の段落はまだのところ', () => {
    const r0 = fresh(plainConfig)
    const id = templateParagraphs(r0)[0]
    const r = ops.insertAfter(r0, id, { type: 'paragraph', id: 'pe', content: [{ type: 'text', text: '' }] })
    const { notYet, fixes } = split(r, layout(), plainConfig)
    expect(fixes.find((f) => f.blockId === 'pe')).toMatchObject({ ruleId: 'paragraph-empty', title: '空の段落がある' })
    expect(notYet.find((f) => f.blockId === id)).toMatchObject({ ruleId: 'paragraph-empty', title: 'まだ書いていない段落がある' })
  })

  it('書き始めた抄録が短いうちはまだのところ。多すぎるときは直すところ', () => {
    const started = (text: string): Report => ({ ...fresh(plainConfig), abstract: { paragraphs: [{ type: 'paragraph', id: 'a1', content: [{ type: 'text', text }] }], started: true } })
    const short = split(started('あ'.repeat(100) + 'である。'), layout(), plainConfig)
    expect(short.notYet.map((f) => f.ruleId)).toEqual(expect.arrayContaining(['abstract-length', 'abstract-lines']))
    expect(short.fixes.some((f) => f.ruleId.startsWith('abstract'))).toBe(false)
    const over = split(started(('あ'.repeat(80) + 'である。').repeat(12)), layout({ abstractLines: 30 }), plainConfig)
    expect(over.fixes.map((f) => f.ruleId)).toEqual(expect.arrayContaining(['abstract-length', 'abstract-lines']))
    expect(over.notYet.some((f) => f.ruleId.startsWith('abstract'))).toBe(false)
  })
})

describe('まだのところの行', () => {
  it('書き始めたばかり（標準のひな形）：表紙・本文のページ・本文の段落・作品写真がまだ（4つ）。抄録は「先生の許可のあと」。図の枚数の行はない', () => {
    const r = fresh(plainConfig)
    const list = rows(r, layout(), false, plainConfig)
    expect(list.map((x) => [x.id, x.state])).toEqual([
      ['cover', 'todo'],
      ['bodyPages', 'todo'],
      ['paragraphs', 'todo'],
      ['photos', 'todo'],
      ['abstract', 'wait'],
    ])
    expect(notYetCount(list)).toBe(4)
    const min = plainConfig.body.minPages
    expect(list[0].value).toBe('氏名・サブタイトルがまだ')
    expect(list[1]).toMatchObject({ value: `3 / ${min}ページ　あと`, strong: String(min - 3), target: { kind: 'area', area: 'body', last: true } })
    expect(list[1].bar).toBeCloseTo(3 / min)
    expect(list[2]).toMatchObject({ value: '書いていない段落 ', strong: String(templateParagraphs(r).length) })
    expect(list[3].value).toBe('まだ')
    expect(list[4]).toMatchObject({ value: '先生の許可のあと', target: { kind: 'area', area: 'abstract' } })
    // 図の枚数の行は出さない（依頼者の判断。2026-10-19）
    expect(list.some((x) => x.label === '図の枚数')).toBe(false)
  })

  it('図の枠・表のセルが空いているときだけ「図・表」の行（空いている枠・セルの数。同じセルは1つ）', () => {
    const r = fresh()
    const list = rows(r)
    expect(list.map((x) => x.id)).toEqual(['cover', 'bodyPages', 'paragraphs', 'figuresTables', 'photos', 'abstract'])
    // 図の枠1つと、素材表の1行目（名称・使用箇所・生地見本）の3つのセル
    expect(list[3]).toMatchObject({ state: 'todo', value: '空いている所 ', strong: '4', target: { kind: 'finding', finding: { ruleId: 'figure-image' } } })
    expect(notYetCount(list)).toBe(5)
    // 写真とセルを入れると、行はなくなる（済んだ行としては出さない）
    let filled = r
    for (const b of blocksOf(r)) {
      if (b.type === 'figureRow') filled = { ...filled, body: filled.body.map((c) => ({ ...c, blocks: c.blocks.map((x) => (x.id === b.id && x.type === 'figureRow' ? { ...x, figures: x.figures.map((g) => ({ ...g, imageId: 'img' })) } : x)) })) }
      if (b.type === 'table') filled = { ...filled, body: filled.body.map((c) => ({ ...c, blocks: c.blocks.map((x) => (x.id === b.id && x.type === 'table' ? { ...x, rows: x.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => ({ ...cell, text: cell.text || 'サテン', imageId: 'sw' })) })) } : x)) })) }
    }
    expect(rows(filled).map((x) => x.id)).not.toContain('figuresTables')
  })

  it('まだの行を押すと、その指摘の箇所へ移る（表紙は最初の空の項目、段落は最初の書いていない段落）', () => {
    const r = fresh(plainConfig)
    const list = rows(r, layout(), false, plainConfig)
    expect(list[0].target).toMatchObject({ kind: 'finding', finding: { ruleId: 'required-field', blockId: 'basic:name' } })
    expect(list[2].target).toMatchObject({ kind: 'finding', finding: { ruleId: 'paragraph-empty', blockId: templateParagraphs(r)[0] } })
  })

  it('済んだ行は緑の ✓（入れました・すべて書きました・枚数）', () => {
    const r0 = fresh(plainConfig)
    let r: Report = { ...r0, basicInfo: { ...r0.basicInfo, name: '文化　花子', subtitleInput: '海の王女' }, workPhotos: [{ layout: 2, imageIds: ['p1', 'p2'] }] }
    for (const id of templateParagraphs(r)) r = ops.setText(r, id, '筆者は衣装を制作した。')
    const min = plainConfig.body.minPages
    const list = rows(r, layout({ bodyPages: min }), false, plainConfig)
    expect(list.slice(0, 4).map((x) => [x.state, x.value])).toEqual([
      ['done', '入れました'],
      ['done', `${min} / ${min}ページ`],
      ['done', 'すべて書きました'],
      ['done', '2枚'],
    ])
    expect(notYetCount(list)).toBe(0)
  })

  it('紙面を確かめている途中は、本文のページを「確かめています…」にして数えない', () => {
    const list = rows(fresh(plainConfig), null, true, plainConfig)
    expect(list.find((x) => x.id === 'bodyPages')).toMatchObject({ state: 'pending', value: '確かめています…' })
    expect(notYetCount(list)).toBe(3)
  })

  it('書き始めた抄録が短いうちは「あと◯字」', () => {
    const r: Report = { ...fresh(), abstract: { paragraphs: [{ type: 'paragraph', id: 'a1', content: [{ type: 'text', text: 'あ'.repeat(96) + 'である。' }] }], started: true } }
    const min = currentConfig.abstract.minChars
    expect(row(r, 'abstract')).toMatchObject({ state: 'todo', value: `100 / ${min}字　あと`, strong: String(min - 100), target: { kind: 'finding', finding: { ruleId: 'abstract-length' } } })
  })
})

describe('「PDFを書き出す」の下のひとこと', () => {
  const note = (fix: number, notYet: number, pending = false, abstractWaiting = false) => exportNote({ fix, notYet, pending, abstractWaiting })
  it('まだのところ・直すところの数を言う', () => {
    expect(note(0, 4)).toBe('まだのところが4つあります')
    expect(note(3, 2)).toBe('直すところが3つ、まだのところが2つあります')
    expect(note(1, 0)).toBe('直すところが1つあります')
    // 10からは「〜か所」（「16つ」とは言わない。学生の試し 2026-10-24）
    expect(note(16, 9)).toBe('直すところが16か所、まだのところが9つあります')
    expect(note(0, 10)).toBe('まだのところが10か所あります')
  })
  it('どちらも0なら「ありません」。抄録（先生の許可のあと）だけが残っているときは、あとは抄録（PDF は1つだけ。いつでも書き出せる）', () => {
    expect(note(0, 0)).toBe('直すところ・まだのところはありません')
    expect(note(0, 0, true)).toBe('紙面を確かめています…')
    expect(note(0, 0, false, true)).toBe('あとは抄録です（先生の許可のあと）')
  })
})

describe('作品写真が何ページかあるとき（mockups/v38 案A）', () => {
  const done = (workPhotos: Report['workPhotos']) => {
    const r0 = fresh(plainConfig)
    let r: Report = { ...r0, basicInfo: { ...r0.basicInfo, name: '文化　花子', subtitleInput: '海の王女' }, workPhotos }
    for (const id of templateParagraphs(r)) r = ops.setText(r, id, '筆者は衣装を制作した。')
    return rows(r, layout({ bodyPages: plainConfig.body.minPages }), false, plainConfig).find((x) => x.id === 'photos')!
  }

  it('済んだ行は「6枚（2ページ）」（1ページだけなら今までどおり「6枚」ではなく枚数だけ）', () => {
    expect(done([{ layout: 4, imageIds: ['a', 'b', 'c', 'd'] }, { layout: 2, imageIds: ['e', 'f'] }])).toMatchObject({ state: 'done', value: '6枚（2ページ）' })
    expect(done([{ layout: 4, imageIds: ['a', 'b', 'c', 'd'] }])).toMatchObject({ state: 'done', value: '4枚' })
  })

  it('写真のないページがあれば、まだのところ「2ページ目が空です」（押すと、そのページへ）。赤くしない', () => {
    const row = done([{ layout: 4, imageIds: ['a', 'b', 'c', 'd'] }, { layout: 4, imageIds: [] }])
    expect(row).toMatchObject({ state: 'todo', value: '2ページ目が空です', target: { kind: 'finding', finding: { ruleId: 'photos-empty-page', photoPage: 1 } } })
    expect(done([{ layout: 1, imageIds: [] }, { layout: 1, imageIds: ['a'] }, { layout: 1, imageIds: [] }])).toMatchObject({ value: '1・3ページ目が空です' })
    expect(NOT_YET_RULES).toContain('photos-empty-page')
  })

  it('どのページにも写真がなければ、今までどおり「まだ」', () => {
    expect(done([{ layout: 4, imageIds: [] }, { layout: 1, imageIds: [] }])).toMatchObject({ state: 'todo', value: 'まだ' })
  })
})
