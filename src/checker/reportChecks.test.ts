import { describe, expect, it } from 'vitest'
import { currentConfig } from '../config'
import * as ops from '../editor/reportOps'
import type { LayoutInfo } from '../layout/measure'
import { demoReport } from '../model/demoReport'
import type { Report } from '../model/types'
import { abstractCharCount, checkReport, checkReportDetailed } from './reportChecks'
import { applyFix } from './textRules'

const layout = (over: Partial<LayoutInfo> = {}): LayoutInfo => ({
  kinds: [],
  bodyPages: 5,
  abstractPages: 1,
  abstractLines: 18,
  tocPageNumbers: {},
  figuresPerBodyPage: [],
  pageBreaks: [],
  ...over,
})

const ids = (r: Report, l?: LayoutInfo) => checkReport(r, currentConfig, l).map((f) => f.ruleId)

/** 画像や参照などを満たした「指摘のない」報告書 */
function cleanReport(): Report {
  let r = demoReport()
  r = ops.setText(r, 'p1', '筆者が担当したのは、主人公の衣装である。')
  r = ops.setText(r, 'p2', 'デザインを考えた（図1）。')
  // 本文の「表1」は、確定すると表へのつながりになる（見本のデータは文字のままなので、書いて確定したときと同じにする）
  r = ops.setText(r, 'p3', '表1に使用した素材をまとめる。')
  r = ops.setText(r, 'p4', '前身頃には金のブレードを縫い付けた。')
  r = ops.setText(r, 'p5', '袖口には細かいピンタックを施した。')
  r = {
    ...r,
    // 抄録は704字（1文は88字。150字より長い文は「1文が長すぎる」の指摘になる）
    abstract: { paragraphs: [{ type: 'paragraph', id: 'a1', content: [{ type: 'text', text: ('あ'.repeat(84) + 'である。').repeat(8) }] }] },
    body: r.body.map((c) => ({
      ...c,
      blocks: c.blocks.map((b) =>
        b.type === 'figureRow'
          ? { ...b, figures: b.figures.map((f) => ({ ...f, imageId: 'img1' })) }
          : b.type === 'table'
            ? { ...b, rows: b.rows.map((row, i) => (i === 0 ? row : { ...row, cells: row.cells.map((c, k) => (k === 2 ? { ...c, imageId: 'sw' } : c)) })) }
            : b,
      ),
    })),
    workPhotos: { layout: 2, imageIds: ['ph1', 'ph2'] },
  }
  return r
}

describe('checkReport', () => {
  it('条件を満たした報告書には指摘がない', () => {
    expect(checkReport(cleanReport(), currentConfig, layout())).toEqual([])
  })

  it('架空の見本の誤りを見つける（文章のルールには紙面上の位置が付く）', () => {
    const findings = checkReport(demoReport(), currentConfig, layout())
    const firstPerson = findings.find((f) => f.ruleId === 'first-person')
    expect(firstPerson).toMatchObject({ area: 'body', blockId: 'p1', severity: 'error' })
    expect(findings.map((f) => f.ruleId)).toEqual(expect.arrayContaining(['digit-fullwidth', 'desu-masu', 'seisaku', 'choon-dash', 'figure-image', 'photos-required']))
  })

  it('表紙の未入力の項目とコースを指摘する', () => {
    const r = { ...cleanReport(), basicInfo: { studentId: '', name: '', courseId: 'none', subtitleInput: '' } }
    expect(ids(r, layout()).filter((x) => x === 'required-field')).toHaveLength(4)
  })

  it('表紙のサブタイトルが、いちばん小さい文字でも枠からはみ出すときはエラー（組んだ紙面で測った結果から判定する）', () => {
    const r = cleanReport()
    const over = layout({ coverSubtitle: { fontPt: 11, ratio: 1.1, chars: 32, fitChars: 29 } })
    const f = checkReport(r, currentConfig, over).find((x) => x.ruleId === 'cover-subtitle-fit')
    expect(f).toMatchObject({ severity: 'error', source: 'guide', area: 'cover', blockId: 'basic:subtitleInput', start: 0, end: r.basicInfo.subtitleInput.length })
    expect(f?.title).toBe('サブタイトルが長く、表紙の1行に入りません')
    expect(f?.detail).toContain('いちばん小さい文字（11pt）にしても、枠からはみ出します（今 32字・29字くらいまで入ります）')
    // 題目は申告書と同じにするので、「短くする」とは言わない
    expect(f?.detail).toContain('申告書')
    expect(f?.detail).not.toContain('短く')
    // 入っている（測った誤差くらいのはみ出しは見ない）・組版の結果がない
    expect(ids(r, layout({ coverSubtitle: { fontPt: 17.5, ratio: 0.98, chars: 16, fitChars: 16 } }))).not.toContain('cover-subtitle-fit')
    expect(ids(r, layout({ coverSubtitle: { fontPt: 22, ratio: 1.001, chars: 10, fitChars: 10 } }))).not.toContain('cover-subtitle-fit')
    expect(ids(r)).not.toContain('cover-subtitle-fit')
  })

  it('氏名の姓と名の間が半角の空白なら、全角に直せる', () => {
    const r = { ...cleanReport(), basicInfo: { ...cleanReport().basicInfo, name: '文化 花子' } }
    const f = checkReport(r, currentConfig, layout()).find((x) => x.ruleId === 'name-space')
    expect(f).toMatchObject({ blockId: 'basic:name', start: 2, end: 3, replacement: '　' })
    expect(ids({ ...r, basicInfo: { ...r.basicInfo, name: '文化　花子' } }, layout())).not.toContain('name-space')
  })

  it('抄録の字数・行数・ページ数を判定する', () => {
    const r = cleanReport()
    expect(abstractCharCount(r)).toBe(704)
    const short = { ...r, abstract: { paragraphs: [{ type: 'paragraph' as const, id: 'a1', content: [{ type: 'text' as const, text: '短い。' }] }] } }
    const finding = checkReport(short, currentConfig, layout()).find((f) => f.ruleId === 'abstract-length')
    expect(finding?.detail).toBe('現在 3字（あと597字）')
    expect(ids(r, layout({ abstractLines: 24 }))).toContain('abstract-lines')
    expect(ids(r, layout({ abstractPages: 2 }))).toContain('abstract-one-page')
  })

  it('本文が5ページ未満ならエラー。組版の結果がなければページ数は判定しない', () => {
    expect(ids(cleanReport(), layout({ bodyPages: 4 }))).toContain('body-pages')
    expect(ids(cleanReport())).not.toContain('body-pages')
  })

  it('本文から参照されていない図表を指摘する', () => {
    const r = ops.setText(cleanReport(), 'p2', 'デザインを考えた。')
    expect(ids(r, layout())).toContain('figure-unreferenced')
    expect(ids(r, layout())).not.toContain('table-unreferenced')
  })

  it('存在しない図の番号を指摘する', () => {
    const r = ops.setText(cleanReport(), 'p4', '縫い付けた（図9）。')
    const finding = checkReport(r, currentConfig, layout()).find((f) => f.ruleId === 'reference-missing')
    expect(finding).toMatchObject({ blockId: 'p4', start: 5, end: 9 })
  })

  it('引用・参考文献の未入力の項目を指摘する', () => {
    const r = { ...cleanReport(), references: [{ type: 'web' as const, id: 'w', siteTitle: 'サイト', url: '', accessedOn: '' }] }
    expect(ids(r, layout()).filter((x) => x === 'reference-field')).toHaveLength(2)
  })

  it('出版年が西暦の4桁にならないときは指摘する（和暦は西暦に直せるので指摘しない）', () => {
    const book = (year: string) => ({ ...cleanReport(), references: [{ type: 'book' as const, id: 'b', author: '著者', title: '書名', publisher: '出版社', year, pages: '' }] })
    expect(ids(book('2019'), layout())).not.toContain('reference-year')
    expect(ids(book('令和3年'), layout())).not.toContain('reference-year')
    expect(ids(book('19'), layout())).toContain('reference-year')
    expect(ids(book('R3'), layout())).toContain('reference-year')
  })

  it('画像が1ページあたりの目安より多いと警告する', () => {
    expect(ids(cleanReport(), layout({ bodyPages: 0 }))).toContain('figures-per-page')
  })
})

describe('改ページ', () => {
  it('改ページでページの半分以上が空いていると注意を出す（半分より少なければ出さない）', () => {
    const report = demoReport()
    expect(ids(report, layout({ pageBreaks: [{ id: 'pb1', page: 4, emptyRatio: 0.7 }] }))).toContain('page-break-gap')
    expect(ids(report, layout({ pageBreaks: [{ id: 'pb1', page: 4, emptyRatio: 0.3 }] }))).not.toContain('page-break-gap')
  })
})

describe('手で書いた図表の番号', () => {
  it('図とつながっていない（図n）はエラー。その番号の図があれば「直す」でつなげられる', () => {
    let r = demoReport()
    // 全角の数字で書くと、図とつながらずに文字のまま残る
    r = ops.setText(r, 'p1', '袖を大きくした（図１）。')
    const f = checkReport(r, currentConfig).find((x) => x.ruleId === 'manual-ref')
    expect(f?.severity).toBe('error')
    expect(f?.replacement).toBe('（図1）')
    // 「直す」：番号を半角にして確定すると、図へのつながりになる
    const fixed = ops.setText(r, 'p1', '袖を大きくした（図1）。')
    expect(fixed.body.flatMap((c) => c.blocks).find((b) => b.id === 'p1')).toMatchObject({ content: expect.arrayContaining([expect.objectContaining({ type: 'ref' })]) })
    expect(checkReport(fixed, currentConfig).some((x) => x.ruleId === 'manual-ref' && x.blockId === 'p1')).toBe(false)
  })

  it('ない番号の（図n）は「図がない」と知らせ、図を入れるよう案内する（「直す」はない）', () => {
    const r = ops.setText(demoReport(), 'p1', '袖を大きくした（図9）。')
    const findings = checkReport(r, currentConfig).filter((x) => x.blockId === 'p1')
    const missing = findings.find((x) => x.ruleId === 'reference-missing')
    expect(missing?.detail).toContain('図を入れる')
    expect(missing?.replacement).toBeUndefined()
    expect(findings.some((x) => x.ruleId === 'manual-ref')).toBe(false)
  })
})

describe('確認済み（補助の指摘を、学生がこのままにする）', () => {
  it('補助の指摘だけに目印が付き、確認済みにするとエラーに数えない（手順書のルールの指摘は外せない）', () => {
    // 文末の「。」がない（補助）と、「です」（手順書のルール）
    const r = ops.setText(demoReport(), 'p1', '衣装を作ったのです')
    const before = checkReport(r, currentConfig).filter((f) => f.blockId === 'p1')
    const sentenceEnd = before.find((f) => f.ruleId === 'sentence-end')
    expect(sentenceEnd?.key).toBe('sentence-end|p1|す')
    expect(before.find((f) => f.ruleId === 'desu-masu')?.key).toBeUndefined()
    const acked = { ...r, acknowledged: [sentenceEnd!.key!] }
    const { findings, acknowledged } = checkReportDetailed(acked, currentConfig)
    expect(findings.some((f) => f.ruleId === 'sentence-end' && f.blockId === 'p1')).toBe(false)
    expect(findings.some((f) => f.ruleId === 'desu-masu' && f.blockId === 'p1')).toBe(true)
    expect(acknowledged.map((f) => f.ruleId)).toEqual(['sentence-end'])
  })
})

describe('絵文字・1文の長さ（補助のチェック）', () => {
  it('絵文字は、表紙・本文・図のタイトル・引用・参考文献のどこでもエラーにする（確認済みにもできる）', () => {
    let r = ops.setText(cleanReport(), 'p1', '筆者が担当したのは、主人公の衣装である😊。')
    r = ops.setText(r, 'f1', 'デザイン画✨')
    r = { ...r, basicInfo: { ...r.basicInfo, name: '文化　花子🌸' } }
    r = { ...r, references: [{ type: 'web', id: 'ref2', siteTitle: '衣装の歴史👗まとめ', url: 'https://example.com/', accessedOn: '2026-08-18' }] }
    const emoji = checkReport(r, currentConfig, layout()).filter((f) => f.ruleId === 'emoji')
    expect(emoji.every((f) => f.severity === 'error' && f.source === 'supplementary' && f.title === '絵文字は使わない' && f.key)).toBe(true)
    expect(emoji.map((f) => [f.area, f.blockId, f.detail])).toEqual([
      ['cover', 'basic:name', '「🌸」を消す'],
      ['body', 'p1', '「😊」を消す'],
      ['body', 'f1', '「✨」を消す'],
      ['references', undefined, '1つ目の文献の「👗」を消す'],
    ])
    const acked = { ...r, acknowledged: emoji.map((f) => f.key!) }
    expect(checkReport(acked, currentConfig, layout()).some((f) => f.ruleId === 'emoji')).toBe(false)
  })

  it('150字より長い文は、段落だけで警告する（見出し・図のタイトルには当てない）', () => {
    const long = `${'あ'.repeat(160)}である。`
    let r = ops.setText(cleanReport(), 'p4', `前身頃には金のブレードを縫い付けた。${long}`)
    r = ops.setText(r, 's1', long)
    r = ops.setText(r, 'f1', long)
    const found = checkReport(r, currentConfig, layout()).filter((f) => f.ruleId === 'long-sentence')
    expect(found).toEqual([
      expect.objectContaining({ severity: 'warning', source: 'supplementary', area: 'body', blockId: 'p4', start: 18, end: 182, title: '1文が長すぎる（164字）。「。」で区切る' }),
    ])
  })
})

describe('書き間違えやすい語', () => {
  it('年度の設定に一覧があればそれを使い、なければツールに入っている一覧を使う', () => {
    const r = ops.setText(demoReport(), 'p1', '前見頃に芯地を貼った。')
    const words = (config: typeof currentConfig) => checkReport(r, config).filter((x) => x.blockId === 'p1' && x.ruleId.startsWith('word-')).map((x) => x.ruleId)
    expect(words({ ...currentConfig, wordChecks: undefined })).toEqual(['word-見頃'])
    expect(words({ ...currentConfig, wordChecks: [{ wrong: '芯地', right: '接着芯', severity: 'warning' }] })).toEqual(['word-芯地'])
    expect(words({ ...currentConfig, wordChecks: [] })).toEqual([])
  })
})

describe('図・表を消したあとの本文（文が崩れたまま0件にしない）', () => {
  it('文の中の参照は「図?」として残り、エラーになる（提出用の PDF を書き出せない）', () => {
    // 「直す」で手で書いた「図1」を図につなげてから、図を消した
    const linked = ops.setText(cleanReport(), 'p2', 'デザイン画を図1に示す。')
    const removed = ops.removeFigure(linked, 'f1')
    expect(ops.findEditable(removed, 'p2')?.text).toBe('デザイン画を図?に示す。')
    const missing = checkReport(removed, currentConfig, layout()).find((f) => f.ruleId === 'reference-missing')
    expect(missing).toMatchObject({ severity: 'error', blockId: 'p2', start: 6, end: 8 })
    expect(missing?.detail).toContain('消した図を指していた所')
  })
})

describe('図表の番号の二重（ツールで書いているときだけの指摘）', () => {
  it('「直す」は、手で書いた形のままつなげる（「表1に示す」を「（表1）に示す」にしない）', () => {
    let r = cleanReport()
    r = { ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === 'p3' ? { ...b, content: [{ type: 'text' as const, text: '表１に使用した素材をまとめる。' }] } : b)) })) }
    expect(checkReport(r, currentConfig).find((x) => x.ruleId === 'manual-ref')?.replacement).toBe('表1')
  })

  it('同じ段落に同じ表への参照が2つあると、エラーにする。「直す」で添えてあるだけの（表1）を取る', () => {
    const r = ops.setText(cleanReport(), 'p3', '使用した素材を（表1）に示す（表1）。')
    const f = checkReportDetailed(r, currentConfig, layout()).findings.find((x) => x.ruleId === 'duplicate-ref')
    expect(f).toMatchObject({ severity: 'error', blockId: 'p3', start: 14, end: 18, replacement: '', key: 'duplicate-ref|p3|t1' })
    expect(f?.title).toBe('同じ段落に「表1」が2つある')
    const fixed = ops.setText(r, 'p3', applyFix(ops.findEditable(r, 'p3')!.text, { ...f!, start: f!.start!, end: f!.end! }))
    expect(ops.findEditable(fixed, 'p3')?.text).toBe('使用した素材を（表1）に示す。')
    expect(checkReportDetailed(fixed, currentConfig, layout()).findings.some((x) => x.ruleId === 'duplicate-ref')).toBe(false)
  })

  it('文の中の「図1」を2回書くのは、書き手が2回指しているので指摘しない。確認済みにもできる', () => {
    const twice = ops.setText(cleanReport(), 'p2', '図1の左は袖である。図1の右は帯である（図1）。')
    const f = checkReportDetailed(twice, currentConfig, layout()).findings.find((x) => x.ruleId === 'duplicate-ref')
    expect(f).toBeDefined()
    const acked = { ...twice, acknowledged: [f!.key!] }
    expect(checkReportDetailed(acked, currentConfig, layout()).findings.some((x) => x.ruleId === 'duplicate-ref')).toBe(false)
    const plain = ops.setText(cleanReport(), 'p2', '図1の左は袖である。図1の右は帯である。')
    expect(checkReportDetailed(plain, currentConfig, layout()).findings.some((x) => x.ruleId === 'duplicate-ref')).toBe(false)
  })

  it('サブタイトルに決まり文句まで入力していたら、エラーにして「直す」で取る', () => {
    const r = { ...cleanReport(), basicInfo: { ...cleanReport().basicInfo, subtitleInput: '―海の王女の衣装制作―' } }
    const f = checkReportDetailed(r, currentConfig, layout()).findings.find((x) => x.ruleId === 'subtitle-fixed-text')
    expect(f).toMatchObject({ severity: 'error', area: 'cover', blockId: 'basic:subtitleInput', start: 0, end: 11, replacement: '海の王女' })
    expect(f?.detail).toContain('「―〇〇の衣装制作―」')
    const ok = { ...r, basicInfo: { ...r.basicInfo, subtitleInput: '海の王女' } }
    expect(checkReportDetailed(ok, currentConfig, layout()).findings).toEqual([])
  })

  it('提出前チェック（checkReport を直接使う）には、ツールだけの指摘を出さない', () => {
    const r = { ...ops.setText(cleanReport(), 'p3', '素材を（表1）に示す（表1）。'), basicInfo: { ...cleanReport().basicInfo, subtitleInput: '―海の王女の衣装制作―' } }
    const ruleIds = checkReport(r, currentConfig, layout()).map((x) => x.ruleId)
    expect(ruleIds).not.toContain('duplicate-ref')
    expect(ruleIds).not.toContain('subtitle-fixed-text')
  })
})
