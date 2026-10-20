import { describe, expect, it } from 'vitest'
import config2026 from '../config/2026.json'
import { currentConfig, type TemplateBlock, type YearConfig } from '../config'
import { LIMITS, repairConfig, templateProblems, validateConfig } from '../config/validate'
import { templateSummary } from '../admin/templateText'
import { numbering, contentToText, split } from '../editor/reportOps'
import { createReport } from '../model/newReport'
import { bodyFromTemplate, DEFAULT_TEMPLATE } from '../model/template'
import type { ParagraphBlock, Report, TableBlock } from '../model/types'
import { abstractPlaceholder, templateBody, templateFromReport, templateIssues, templateReport } from './convert'
import { isAllowedParentOrigin, newNonce, NONCE_PATTERN, readInitPayload, receivedProblems, templateToolUrls } from './protocol'

const config = currentConfig
const FILM = (config2026 as YearConfig).courses.find((c) => c.id === 'film-stage-costume')!

/** 部品の種類をすべて使ったひな形（ふつうの表は、行の数・列の幅・行の高さ・左端の列も） */
const ALL_KINDS: TemplateBlock[] = [
  { type: 'chapter', title: '企画・立案' },
  { type: 'subheading', title: '担当衣装' },
  { type: 'paragraph', hint: '担当した衣装を書く' },
  { type: 'figure', caption: 'デザイン画' },
  { type: 'pageBreak' },
  { type: 'materialTable', caption: '使用素材表' },
  { type: 'chapter', title: '制作過程' },
  { type: 'paragraph', hint: '' },
  { type: 'table', caption: '寸法表', header: ['部位', '寸法', ''], rows: 3, widths: 'custom', colWidths: [20, 30, 50], heights: 'equal' },
  { type: 'table', caption: '工程表', header: ['工程'], labelColumn: true, widths: 'auto' },
  { type: 'chapter', title: 'まとめ' },
]

/** ひな形 → ひな形を作る画面の原稿 → ひな形 */
const roundTrip = (template: TemplateBlock[], example = '') => templateFromReport(templateReport(config, FILM.id, template, example))

describe('ひな形の形を広げた（改ページ・ふつうの表。mockups/v44）', () => {
  it('改ページとふつうの表は、正しいひな形として通る', () => {
    expect(templateProblems(ALL_KINDS)).toEqual([])
    expect(templateProblems([{ type: 'chapter', title: 'A' }, { type: 'pageBreak' }, { type: 'table', caption: '表', header: ['a'] }])).toEqual([])
  })

  it('いまあるひな形（2026年度の初期値・標準のひな形）は、そのまま正しい', () => {
    for (const c of (config2026 as YearConfig).courses) if (c.template) expect(templateProblems(c.template)).toEqual([])
    expect(templateProblems(DEFAULT_TEMPLATE)).toEqual([])
    expect(validateConfig(config2026 as YearConfig).filter((p) => p.severity === 'error')).toEqual([])
    expect(repairConfig(config2026 as YearConfig)).toEqual(config2026)
  })

  it('崩れたふつうの表は、形の問題になる（列は1〜6、行は1〜9、切り替えは決まった値）', () => {
    const chapter = { type: 'chapter', title: 'A' }
    const table = (extra: object) => [chapter, { type: 'table', caption: '表', header: ['a', 'b'], ...extra }]
    const shape = ['の2行目の表の形が正しくありません']
    expect(templateProblems(table({ header: [] }))).toEqual(shape)
    expect(templateProblems(table({ header: 'a' }))).toEqual(shape)
    expect(templateProblems(table({ header: Array(LIMITS.tableColumns + 1).fill('a') }))).toEqual(shape)
    expect(templateProblems(table({ header: ['a', 1] }))).toEqual(shape)
    expect(templateProblems(table({ rows: 0 }))).toEqual(shape)
    expect(templateProblems(table({ rows: LIMITS.tableRows + 1 }))).toEqual(shape)
    expect(templateProblems(table({ rows: 1.5 }))).toEqual(shape)
    expect(templateProblems(table({ widths: 'wide' }))).toEqual(shape)
    expect(templateProblems(table({ heights: 'tall' }))).toEqual(shape)
    expect(templateProblems(table({ labelColumn: 'yes' }))).toEqual(shape)
    expect(templateProblems(table({ colWidths: [50] }))).toEqual(shape)
    expect(templateProblems(table({ colWidths: [50, -1] }))).toEqual(shape)
    expect(templateProblems([chapter, { type: 'table', header: ['a'] }])).toEqual(shape)
    expect(templateProblems([chapter, { type: 'table', caption: ' ', header: ['a'] }])).toEqual(['に、名前が空の表があります'])
    expect(templateProblems(table({ header: ['a', 'あ'.repeat(101)] }))).toEqual(['の2行目の表「表」の見出しの2列目が長すぎます（100字まで。今は101字）'])
    // 崩れたひな形は、学生のツールでは使わない（標準のひな形になる）
    const broken = { ...config, courses: [{ ...FILM, template: table({ rows: 0 }) as TemplateBlock[] }] }
    expect(repairConfig(broken).courses[0].template).toBeUndefined()
  })

  it('学生の新しい原稿に、改ページとふつうの表（見出しの行と、空の行）が入る', () => {
    const body = bodyFromTemplate(ALL_KINDS)
    expect(body.map((c) => c.title)).toEqual(['企画・立案', '制作過程', 'まとめ'])
    expect(body[0].blocks.map((b) => b.type)).toEqual(['subheading', 'paragraph', 'figureRow', 'pageBreak', 'table'])
    const tables = body.flatMap((c) => c.blocks).filter((b): b is TableBlock => b.type === 'table')
    expect(tables.map((t) => t.rows[0].cells.map((c) => c.text))).toEqual([['名称', '使用箇所', '生地見本'], ['部位', '寸法', ''], ['工程']])
    expect(tables.map((t) => t.rows.length)).toEqual([2, 4, 2])
    expect(tables[1]).toMatchObject({ caption: '寸法表', widths: 'custom', colWidths: [20, 30, 50], heights: 'equal' })
    expect(tables[1].rows.slice(1).every((r) => r.cells.every((c) => c.text === '' && c.imageId === null))).toBe(true)
    expect(tables[2]).toMatchObject({ widths: 'auto', heights: 'auto', labelColumn: true })
    // 空の大見出しには、空の段落が入る（今までと同じ）
    expect(body[2].blocks).toHaveLength(1)
    // 学生の原稿でも、作ったばかりなら「書き始めていない」
    const report = createReport({ ...config, courses: [{ ...FILM, template: ALL_KINDS }] }, FILM.id)
    expect(report.body.flatMap((c) => c.blocks).some((b) => b.type === 'pageBreak')).toBe(true)
  })

  it('崩れたふつうの表でも、学生のツールは止まらない（いつもの値にする）', () => {
    const body = bodyFromTemplate([{ type: 'chapter', title: 'A' }, { type: 'table', caption: 1, header: 'x', rows: 99, widths: 'x', colWidths: [1] } as unknown as TemplateBlock])
    const table = body[0].blocks[0] as TableBlock
    expect(table).toMatchObject({ caption: '', widths: 'equal', heights: 'auto' })
    expect(table.rows[0].cells.map((c) => c.text)).toEqual(['', ''])
    expect(table.rows).toHaveLength(10)
    expect(table.colWidths).toBeUndefined()
  })

  it('コースのカードの要約に、改ページと表の数も出る', () => {
    expect(templateSummary({ ...FILM, template: [...FILM.template!, { type: 'pageBreak' }, { type: 'table', caption: '表', header: ['a'] }] })).toBe('大見出し3・小見出し3・説明5・図の枠1・素材表1・改ページ1・表1')
    expect(templateSummary(FILM)).toBe('大見出し3・小見出し3・説明5・図の枠1・素材表1')
  })
})

describe('ひな形 ⇄ ひな形を作る画面の原稿', () => {
  it('どの種類の部品も、行き来して元のひな形に戻る', () => {
    expect(roundTrip(ALL_KINDS, '本制作報告書は、').template).toEqual(ALL_KINDS)
  })

  it('いまあるひな形と標準のひな形も、行き来して変わらない', () => {
    expect(roundTrip(FILM.template!, FILM.abstractExample)).toMatchObject({ template: FILM.template, abstractExample: FILM.abstractExample })
    expect(roundTrip(DEFAULT_TEMPLATE).template).toEqual(DEFAULT_TEMPLATE)
    // 空のひな形（標準のひな形を使う）は、標準のひな形で開く
    expect(roundTrip([]).template).toEqual(DEFAULT_TEMPLATE)
  })

  it('原稿では、段落の字が「ここに書くこと」、抄録の字が書き出し例。学生の項目は空', () => {
    const report = templateReport(config, FILM.id, FILM.template!, '本制作報告書は、')
    const paragraphs = report.body.flatMap((c) => c.blocks).filter((b) => b.type === 'paragraph')
    expect(paragraphs.map((p) => (p.type === 'paragraph' ? p.content.map((n) => (n.type === 'text' ? n.text : '')).join('') : ''))).toEqual(FILM.template!.filter((b) => b.type === 'paragraph').map((b) => (b.type === 'paragraph' ? b.hint : '')))
    expect(paragraphs.every((p) => p.type === 'paragraph' && p.hint === undefined)).toBe(true)
    expect(report.abstract).toMatchObject({ started: true, paragraphs: [{ content: [{ type: 'text', text: '本制作報告書は、' }], hint: abstractPlaceholder(config) }] })
    expect(report.basicInfo).toMatchObject({ studentId: '', name: '', subtitleInput: '', courseId: FILM.id })
    expect(report.references).toEqual([])
  })

  it('直したもの（説明・小見出し・表の見出し・行の数・改ページ）が、ひな形に戻る', () => {
    const report = templateReport(config, FILM.id, DEFAULT_TEMPLATE, '')
    const [first] = report.body
    const p = first.blocks[0] as ParagraphBlock
    const table: TableBlock = { type: 'table', id: 't1', caption: '寸法表', widths: 'equal', heights: 'auto', rows: [0, 1, 2].map((r) => ({ id: `r${r}`, cells: [0, 1].map((c) => ({ id: `c${r}${c}`, text: r === 0 ? ['部位', '寸法'][c] : '', imageId: null })) })) }
    const edited: Report = {
      ...report,
      body: [{ ...first, blocks: [{ type: 'subheading', id: 's1', title: '目的' }, { ...p, content: [{ type: 'text', text: '目的を書く' }] }, table, { type: 'pageBreak', id: 'pb1' }] }, ...report.body.slice(1)],
    }
    const result = templateFromReport(edited)
    expect(result.template.slice(0, 5)).toEqual([
      { type: 'chapter', title: '企画・立案' },
      { type: 'subheading', title: '目的' },
      { type: 'paragraph', hint: '目的を書く' },
      { type: 'table', caption: '寸法表', header: ['部位', '寸法'], rows: 2 },
      { type: 'pageBreak' },
    ])
    expect(result.ids.slice(0, 5)).toEqual([first.id, 's1', p.id, 't1', 'pb1'])
    expect(result.abstractExample).toBe('')
  })

  it('本文の「表1」「（図1）」は、説明の字のまま戻る（図表への参照になっても）', () => {
    const report = templateReport(config, FILM.id, FILM.template!, '')
    const num = numbering(report)
    const hint = '使った素材と使った場所を表1にまとめ、文中に「表1」と書く'
    const withRef = report.body.flatMap((c) => c.blocks).find((b) => b.type === 'paragraph' && contentToText(b.content, num) === hint)
    expect(withRef).toBeTruthy()
    expect(templateFromReport(report).template).toContainEqual({ type: 'paragraph', hint })
  })

  it('素材表は、見出し・行・幅をいつものままにしたときだけ素材表に戻る（変えたら、ふつうの表）', () => {
    const report = templateReport(config, FILM.id, [{ type: 'chapter', title: 'A' }, { type: 'materialTable', caption: '使用素材表' }], '')
    const table = report.body[0].blocks[0] as TableBlock
    expect(templateFromReport(report).template[1]).toEqual({ type: 'materialTable', caption: '使用素材表' })
    const widened = { ...report, body: [{ ...report.body[0], blocks: [{ ...table, widths: 'auto' as const }] }] }
    expect(templateFromReport(widened).template[1]).toEqual({ type: 'table', caption: '使用素材表', header: ['名称', '使用箇所', '生地見本'], widths: 'auto' })
  })

  it('ひな形を作る画面では、段落を分けても「。」を付けない（学生の原稿では付ける）', () => {
    const report = templateReport(config, FILM.id, DEFAULT_TEMPLATE, '')
    const id = report.body[0].blocks[0].id
    const text = (r: Report) => contentToText((r.body[0].blocks[0] as ParagraphBlock).content, numbering(r))
    expect(text(split(report, id, '目的を書く', '').report)).toBe('目的を書く。')
    expect(text(split(report, id, '目的を書く', '', { period: false }).report)).toBe('目的を書く')
  })

  it('標準のひな形の本文（「標準のひな形に戻す」）は、説明が字になっている', () => {
    const body = templateBody(DEFAULT_TEMPLATE)
    expect(body.map((c) => c.blocks[0])).toMatchObject(DEFAULT_TEMPLATE.filter((b) => b.type === 'paragraph').map((b) => ({ type: 'paragraph', content: [{ type: 'text', text: b.type === 'paragraph' ? b.hint : '' }] })))
  })
})

describe('「管理ページに戻して反映」の前の確かめ', () => {
  const issues = (template: TemplateBlock[], abstractExample = '') => templateIssues({ template, abstractExample, ids: template.map((_, i) => `id${i}`), abstractId: 'abs' })

  it('問題がなければ空', () => {
    expect(issues(ALL_KINDS)).toEqual([])
    expect(issues(FILM.template!, FILM.abstractExample)).toEqual([])
  })

  it('空の名前・長すぎる字を、紙面の番号で示し、その欄に移れる', () => {
    expect(
      issues([
        { type: 'chapter', title: 'A' },
        { type: 'subheading', title: '' },
        { type: 'chapter', title: ' ' },
        { type: 'paragraph', hint: 'あ'.repeat(301) },
        { type: 'figure', caption: '' },
        { type: 'table', caption: '表', header: ['a', 'い'.repeat(101)] },
        { type: 'materialTable', caption: '' },
      ]),
    ).toEqual([
      { id: 'id1', text: '小見出し「Ⅰ．ⅰ．」の名前が空です' },
      { id: 'id2', text: '大見出し「Ⅱ．」の名前が空です' },
      { id: 'id3', text: '「Ⅱ．」の中の説明が長すぎます（300字まで。今は301字）' },
      { id: 'id4', text: '図1のタイトルが空です' },
      { id: 'id5', text: '表1の見出しの2列目が長すぎます（100字まで。今は101字）' },
      { id: 'id6', text: '表2のタイトルが空です' },
    ])
  })

  it('大見出しの終わりの改ページ・続いた改ページは、学生の原稿に空のページを作るので知らせる', () => {
    const chapter = (title: string) => ({ type: 'chapter', title }) as TemplateBlock
    const brk = { type: 'pageBreak' } as TemplateBlock
    const p = { type: 'paragraph', hint: '' } as TemplateBlock
    expect(issues([chapter('A'), p, brk, chapter('B'), p, brk])).toEqual([
      { id: 'id2', text: '「Ⅰ．」の終わりの改ページは要りません（大見出しは、いつも新しいページから始まります）' },
      { id: 'id5', text: '「Ⅱ．」の終わりの改ページは要りません（大見出しは、いつも新しいページから始まります）' },
    ])
    expect(issues([chapter('A'), p, brk, brk, p])).toEqual([{ id: 'id2', text: '改ページが続いています（空のページができます）' }])
    expect(issues([chapter('A'), p, brk, p])).toEqual([])
  })

  it('抄録の書き出し例・部品の数の上限', () => {
    expect(issues(DEFAULT_TEMPLATE, 'あ'.repeat(501))).toEqual([{ id: 'abs', text: '抄録の書き出し例が長すぎます（500字まで。今は501字）' }])
    expect(issues([])).toEqual([{ id: null, text: '大見出しを1つ以上入れてください' }])
    const many = Array.from({ length: 101 }, () => ({ type: 'chapter', title: 'A' }) as TemplateBlock)
    expect(issues(many)).toEqual([{ id: null, text: '見出し・説明・図表・改ページが多すぎます（あわせて100個まで。今は101個）' }])
  })
})

describe('管理ページとのやり取り（postMessage）', () => {
  it('ツールが init を受け取ってよいのは、Apps Script の枠（googleusercontent.com）と、開発中の手元だけ', () => {
    expect(isAllowedParentOrigin('https://n-abc123-0lu-script.googleusercontent.com', false)).toBe(true)
    expect(isAllowedParentOrigin('https://script.googleusercontent.com', false)).toBe(true)
    expect(isAllowedParentOrigin('http://n-abc-script.googleusercontent.com', false)).toBe(false)
    expect(isAllowedParentOrigin('https://googleusercontent.com', false)).toBe(false)
    expect(isAllowedParentOrigin('https://evil.googleusercontent.com.example.com', false)).toBe(false)
    expect(isAllowedParentOrigin('https://evilgoogleusercontent.com', false)).toBe(false)
    expect(isAllowedParentOrigin('https://script.google.com', false)).toBe(false)
    expect(isAllowedParentOrigin('null', false)).toBe(false)
    expect(isAllowedParentOrigin('https://x.googleusercontent.com/path', false)).toBe(false)
    expect(isAllowedParentOrigin('http://localhost:5173', false)).toBe(false)
    expect(isAllowedParentOrigin('http://localhost:5173', true)).toBe(true)
    expect(isAllowedParentOrigin('http://127.0.0.1:5174', true)).toBe(true)
    expect(isAllowedParentOrigin('http://other.localhost:5173', true)).toBe(false)
    expect(isAllowedParentOrigin('https://junnosukekato.github.io', true)).toBe(false)
  })

  it('iframe に開く URL と場所（?template=1。ほかの印は付けない）', () => {
    expect(templateToolUrls('https://junnosukekato.github.io/sotsugyo-seisaku-report/')).toEqual({ src: 'https://junnosukekato.github.io/sotsugyo-seisaku-report/?template=1', origin: 'https://junnosukekato.github.io' })
    expect(templateToolUrls('http://localhost:5173/?nodrive#x')).toEqual({ src: 'http://localhost:5173/?template=1', origin: 'http://localhost:5173' })
  })

  it('合言葉は開くたびに違う32字の16進', () => {
    const a = newNonce()
    expect(a).toMatch(NONCE_PATTERN)
    expect(newNonce()).not.toBe(a)
  })

  it('init の中身の形を確かめる', () => {
    const ok = { courseId: 'c', courseName: '衣装', template: [], abstractExample: '', config: {}, status: '公開中' }
    expect(readInitPayload(ok)).toMatchObject({ courseId: 'c', status: '公開中' })
    expect(readInitPayload({ ...ok, status: 'x' })).toBeNull()
    expect(readInitPayload({ ...ok, template: 'x' })).toBeNull()
    expect(readInitPayload({ ...ok, config: null })).toBeNull()
    expect(readInitPayload('x')).toBeNull()
  })

  it('管理ページは、受け取ったひな形をサーバーと同じ決まりで確かめる', () => {
    expect(receivedProblems(ALL_KINDS, '')).toEqual([])
    expect(receivedProblems([], '')).toEqual(['ひな形が空です'])
    expect(receivedProblems('x', '')).toEqual(['ひな形が空です'])
    expect(receivedProblems([{ type: 'paragraph', hint: 'a' }], 1)).toEqual(['ひな形は、大見出しから始めてください', 'ひな形に大見出しがありません', '抄録の書き出し例の形が正しくありません'])
    expect(receivedProblems(DEFAULT_TEMPLATE, 'あ'.repeat(501))).toEqual(['抄録の書き出し例が長すぎます（500字まで。今は501字）'])
  })
})
