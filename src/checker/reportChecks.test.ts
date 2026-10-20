import { describe, expect, it } from 'vitest'
import { currentConfig } from '../config'
import * as ops from '../editor/reportOps'
import type { LayoutInfo } from '../layout/measure'
import { demoReport } from '../model/demoReport'
import type { Report } from '../model/types'
import { abstractCharCount, checkReport, checkReportDetailed } from './reportChecks'

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
    workPhotos: [{ layout: 2, imageIds: ['ph1', 'ph2'] }],
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

  it('氏名に数字や「学籍番号」が入っていたらエラー（2行ぶんを氏名の欄に貼り付けたときなど）', () => {
    const withName = (name: string) => ({ ...cleanReport(), basicInfo: { ...cleanReport().basicInfo, name } })
    const f = checkReport(withName('文化　花子学籍番号　00ZZ0123'), currentConfig, layout()).find((x) => x.ruleId === 'name-text')
    expect(f).toMatchObject({ severity: 'error', area: 'cover', blockId: 'basic:name', title: '氏名に数字や「学籍番号」が入っている' })
    expect(ids(withName('文化　花子１'), layout())).toContain('name-text')
    expect(ids(withName('文化　花子　学 籍 番 号'), layout())).toContain('name-text')
    expect(ids(withName('文化　花子'), layout())).not.toContain('name-text')
  })

  it('表紙の学籍番号・氏名が、欄（下線の幅）からはみ出すときはエラー（組んだ紙面で測った結果から判定する）', () => {
    const r = cleanReport()
    const over = layout({ coverFields: { name: { ratio: 1.4, chars: 20, fitChars: 13 }, studentId: { ratio: 0.6, chars: 8, fitChars: 13 } } })
    const found = checkReport(r, currentConfig, over).filter((x) => x.ruleId === 'cover-field-fit')
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ severity: 'error', area: 'cover', blockId: 'basic:name', title: '表紙の氏名が長く、欄に入りません', start: 0, end: r.basicInfo.name.length })
    expect(found[0].detail).toContain('今 20字・13字くらいまで入ります')
    const idOver = layout({ coverFields: { studentId: { ratio: 1.2, chars: 14, fitChars: 11 } } })
    expect(checkReport(r, currentConfig, idOver).find((x) => x.ruleId === 'cover-field-fit')?.title).toBe('表紙の学籍番号が長く、欄に入りません')
    // 測った誤差くらいのはみ出し・組版の結果がないときは見ない
    expect(ids(r, layout({ coverFields: { name: { ratio: 1.001, chars: 5, fitChars: 5 } } }))).not.toContain('cover-field-fit')
    expect(ids(r)).not.toContain('cover-field-fit')
  })

  it('氏名の姓と名の間が半角の空白なら、全角にするように知らせる', () => {
    const r = { ...cleanReport(), basicInfo: { ...cleanReport().basicInfo, name: '文化 花子' } }
    const f = checkReport(r, currentConfig, layout()).find((x) => x.ruleId === 'name-space')
    expect(f).toMatchObject({ blockId: 'basic:name', start: 2, end: 3, detail: '半角の空白 → 全角の空白（例：文化　花子）' })
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

  it('抄録に図表の番号（「図1」「（表２）」）があれば、書き直してもらう（要確認。本文は見ない。書き始める前は見ない）', () => {
    const r = cleanReport()
    expect(ids(r, layout())).not.toContain('abstract-figure-ref')
    const text = '図1に示すように袖を膨らませた。素材は表にまとめた（表２）。地図1枚を参考にした。'
    const withRefs = { ...r, abstract: { paragraphs: [{ type: 'paragraph' as const, id: 'a1', content: [{ type: 'text' as const, text }] }] } }
    const found = checkReport(withRefs, currentConfig, layout()).filter((f) => f.ruleId === 'abstract-figure-ref')
    expect(found.map((f) => [text.slice(f.start, f.end), f.severity, f.area, f.detail])).toEqual([
      ['図1', 'warning', 'abstract', '抄録には図表を入れません。「図1」の入った文を書き直してください'],
      ['（表２）', 'warning', 'abstract', '抄録には図表を入れません。「表2」の入った文を書き直してください'],
    ])
    expect(ids({ ...withRefs, abstract: { ...withRefs.abstract, started: false } }, layout())).not.toContain('abstract-figure-ref')
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

  it('参照していない図表の指摘は、直し方（「図1に示す」のように書く）を言う', () => {
    const fig = checkReport(ops.setText(cleanReport(), 'p2', 'デザインを考えた。'), currentConfig, layout()).find((f) => f.ruleId === 'figure-unreferenced')
    expect(fig?.detail).toBe('図の前の段落に「図1に示す」のように書く')
    const table = checkReport(ops.setText(cleanReport(), 'p3', '使用した素材をまとめる。'), currentConfig, layout()).find((f) => f.ruleId === 'table-unreferenced')
    expect(table?.detail).toBe('表の前の段落に「表1に示す」のように書く')
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

  it('ひな形の改ページで、その前にまだ書いていないひな形の段落があるうちは出さない（書いたら出す）', () => {
    const base = demoReport()
    const chapter = base.body[0]
    const withBreak = (text: string): Report => ({
      ...base,
      body: [
        {
          ...chapter,
          blocks: [
            ...chapter.blocks,
            { type: 'paragraph', id: 'tp1', hint: '工夫した点を書く', content: text ? [{ type: 'text', text }] : [] },
            { type: 'pageBreak', id: 'pb1' },
          ],
        },
        ...base.body.slice(1),
      ],
    })
    const gap = layout({ pageBreaks: [{ id: 'pb1', page: 4, emptyRatio: 0.7 }] })
    expect(ids(withBreak(''), gap)).not.toContain('page-break-gap')
    expect(ids(withBreak('袖の刺繍を工夫した。'), gap)).toContain('page-break-gap')
  })
})

describe('手で書いた図表の番号', () => {
  it('図とつながっていない（図n）はエラー。その番号の図があれば、番号を半角で打ち直すとつながる（直し方を detail に書く）', () => {
    let r = demoReport()
    // 全角の数字で書くと、図とつながらずに文字のまま残る
    r = ops.setText(r, 'p1', '袖を大きくした（図１）。')
    const f = checkReport(r, currentConfig).find((x) => x.ruleId === 'manual-ref')
    expect(f?.severity).toBe('error')
    expect(f?.detail).toBe('番号を半角の数字で打ち直すと、図1とつながります（つながると、図を足したり消したりしても番号が自動でそろいます）')
    // 学生が番号を半角にして書くと、図へのつながりになる
    const fixed = ops.setText(r, 'p1', '袖を大きくした（図1）。')
    expect(fixed.body.flatMap((c) => c.blocks).find((b) => b.id === 'p1')).toMatchObject({ content: expect.arrayContaining([expect.objectContaining({ type: 'ref' })]) })
    expect(checkReport(fixed, currentConfig).some((x) => x.ruleId === 'manual-ref' && x.blockId === 'p1')).toBe(false)
  })

  it('ない番号の（図n）は「図がない」と知らせ、図を入れるよう案内する', () => {
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

  it('書き間違えやすい語のエラーは「このままにする」にできない（前に確認済みにしていても隠れず、エラーに数える）。注意の語はできる', () => {
    const config = {
      ...currentConfig,
      wordChecks: [
        { wrong: '見頃', right: '身頃', severity: 'error' as const },
        { wrong: '記事', right: '生地', severity: 'warning' as const },
      ],
    }
    const r = ops.setText(demoReport(), 'p1', '前見頃の記事を選んだ。')
    const before = checkReport(r, config).filter((f) => f.blockId === 'p1')
    const error = before.find((f) => f.ruleId === 'word-見頃')
    const warning = before.find((f) => f.ruleId === 'word-記事')
    expect(error).toMatchObject({ severity: 'error', source: 'supplementary', replacement: '身頃' })
    expect(error?.key).toBeUndefined()
    expect(error).not.toHaveProperty('locked')
    expect(warning?.key).toBe('word-記事|p1|記事')
    // 前の版で「確認済み」にした目印（同じ形）が原稿に残っていても、エラーの語は隠れない
    const acked = { ...r, acknowledged: ['word-見頃|p1|見頃', warning!.key!] }
    const { findings, acknowledged } = checkReportDetailed(acked, config)
    expect(findings.filter((f) => f.blockId === 'p1' && f.ruleId.startsWith('word-')).map((f) => f.ruleId)).toEqual(['word-見頃'])
    expect(acknowledged.map((f) => f.ruleId)).toEqual(['word-記事'])
    expect(checkReport(acked, config).some((f) => f.ruleId === 'word-見頃' && f.severity === 'error')).toBe(true)
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
  it('文の中の参照は「図?」として残り、エラーになる（直すところに残る）', () => {
    // 手で書いた「図1」が図につながってから、図を消した
    const linked = ops.setText(cleanReport(), 'p2', 'デザイン画を図1に示す。')
    const removed = ops.removeFigure(linked, 'f1')
    expect(ops.findEditable(removed, 'p2')?.text).toBe('デザイン画を図?に示す。')
    const missing = checkReport(removed, currentConfig, layout()).find((f) => f.ruleId === 'reference-missing')
    expect(missing).toMatchObject({ severity: 'error', blockId: 'p2', start: 6, end: 8 })
    expect(missing?.detail).toContain('消した図を指していた所')
  })
})

describe('図表の番号の二重（ツールで書いているときだけの指摘）', () => {
  it('同じ段落に同じ表への参照が2つあると、エラーにする。添えてあるだけの（表1）に下線を引き、それを消すように書く', () => {
    const r = ops.setText(cleanReport(), 'p3', '使用した素材を（表1）に示す（表1）。')
    const f = checkReportDetailed(r, currentConfig, layout()).findings.find((x) => x.ruleId === 'duplicate-ref')
    expect(f).toMatchObject({ severity: 'error', blockId: 'p3', start: 14, end: 18, key: 'duplicate-ref|p3|t1' })
    expect(f).not.toHaveProperty('replacement')
    expect(f?.title).toBe('同じ段落に「表1」が2つある')
    expect(f?.detail).toContain('下線の（表1）を消して1つにします')
    // 学生が、下線の（表1）を消す
    const text = ops.findEditable(r, 'p3')!.text
    const fixed = ops.setText(r, 'p3', text.slice(0, f!.start!) + text.slice(f!.end!))
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

  it('サブタイトルに決まり文句まで入力していたら、エラーにして、残す部分を detail に書く', () => {
    const r = { ...cleanReport(), basicInfo: { ...cleanReport().basicInfo, subtitleInput: '―海の王女の衣装制作―' } }
    const f = checkReportDetailed(r, currentConfig, layout()).findings.find((x) => x.ruleId === 'subtitle-fixed-text')
    expect(f).toMatchObject({ severity: 'error', area: 'cover', blockId: 'basic:subtitleInput', start: 0, end: 11 })
    expect(f?.detail).toContain('「―〇〇の衣装制作―」')
    expect(f?.detail).toContain('「海の王女」だけを残し')
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

describe('見出しに手で書いた番号（自動で付く「ⅰ．」と二重になる。ツールで書いているときだけの指摘）', () => {
  const finding = (r: Report, id: string) => checkReportDetailed(r, currentConfig, layout()).findings.find((x) => x.ruleId === 'heading-number' && x.blockId === id)

  it('小見出し・大見出しの初めの「（1）」「1.」「①」「ⅰ．」「Ⅰ．」「第1章」などを警告し、消す番号を detail に書く（下線は後ろの空白まで）', () => {
    for (const [title, rest] of [
      ['（1）担当衣装のキャラクター', '担当衣装のキャラクター'],
      ['(2) デザイン説明', 'デザイン説明'],
      ['1. 使用素材', '使用素材'],
      ['１．使用素材', '使用素材'],
      ['1.2 使用素材', '使用素材'],
      ['①使用素材', '使用素材'],
      ['ⅰ．使用素材', '使用素材'],
      ['ii) 使用素材', '使用素材'],
      ['一、使用素材', '使用素材'],
    ]) {
      const r = ops.setText(cleanReport(), 's1', title)
      const f = finding(r, 's1')
      expect(f, title).toMatchObject({ severity: 'warning', source: 'supplementary', area: 'body', start: 0, title: '小見出しに番号を手で書いている' })
      expect(f?.detail, title).toContain(`「${title.slice(0, f!.end!).trim()}」を消します`)
      // 下線のところを消すと、番号のない見出しになる
      expect(title.slice(f!.end!), title).toBe(rest)
    }
    const chapter = finding(ops.setText(cleanReport(), 'c1', '第1章　企画・立案'), 'c1')
    expect(chapter).toMatchObject({ title: '大見出しに番号を手で書いている', end: 4 })
    expect(chapter?.detail).toContain('「第1章」を消します')
    expect(finding(ops.setText(cleanReport(), 'c1', 'Ⅰ．企画・立案'), 'c1')?.detail).toContain('（Ⅰ．）は自動で付く')
  })

  it('番号ではない数・語の初めは指摘しない（「3.5mm」「100円」「2026年」「CAD」など）', () => {
    for (const title of ['3.5mm のパイピング', '100円ショップの素材', '2026年の公演', '（CAD）で型紙を作る', '1日目の工程', 'Vivid な配色', '使用素材（1）']) {
      expect(finding(ops.setText(cleanReport(), 's1', title), 's1'), title).toBeUndefined()
    }
  })

  it('確認済みにできる。提出前チェック（checkReport を直接使う）には出さない', () => {
    const r = ops.setText(cleanReport(), 's1', '（1）担当衣装のキャラクター')
    const f = finding(r, 's1')!
    expect(finding({ ...r, acknowledged: [f.key!] }, 's1')).toBeUndefined()
    expect(checkReport(r, currentConfig, layout()).some((x) => x.ruleId === 'heading-number')).toBe(false)
  })
})

describe('空の段落（Enter を押して何も書かなかったときなどに残るもの）', () => {
  it('ひな形の説明のない空の段落は「空の段落がある」（「削除」で消すように書く）、説明のある段落は「まだ書いていない段落がある」', () => {
    let r = ops.insertAfter(cleanReport(), 'p4', { type: 'paragraph', id: 'pe', content: [{ type: 'text', text: '' }] })
    r = ops.insertAfter(r, 'pe', { type: 'paragraph', id: 'ph', content: [{ type: 'text', text: '' }], hint: '工夫した点を書く' })
    const found = checkReport(r, currentConfig, layout()).filter((f) => f.ruleId === 'paragraph-empty')
    expect(found.find((f) => f.blockId === 'pe')).toMatchObject({ title: '空の段落がある', detail: '「削除」で、この空の段落を消します' })
    const hinted = found.find((f) => f.blockId === 'ph')
    expect(hinted).toMatchObject({ title: 'まだ書いていない段落がある', detail: '工夫した点を書く' })
  })
})

describe('作品写真が何ページかあるときの指摘（mockups/v38 案A）', () => {
  const photoFindings = (workPhotos: Report['workPhotos']) =>
    checkReport({ ...cleanReport(), workPhotos }, currentConfig).filter((f) => f.area === 'photos').map((f) => ({ ruleId: f.ruleId, detail: f.detail, photoPage: f.photoPage }))

  it('空いている枠は、写真の入っているページごとに「2ページ目：4枚の配置に3枚」。写真のないページは「作品写真の2ページ目が空」', () => {
    expect(photoFindings([{ layout: 4, imageIds: ['a', 'b', 'c'] }, { layout: 4, imageIds: [] }, { layout: 2, imageIds: ['x', 'y'] }])).toEqual([
      { ruleId: 'photos-empty-slot', detail: '1ページ目：4枚の配置に3枚', photoPage: 0 },
      { ruleId: 'photos-empty-page', detail: '写真を入れるか、このページを消す（空のページは PDF に入りません）', photoPage: 1 },
    ])
  })

  it('1ページだけなら今までどおり（ページの番号を付けない）。どのページにも写真がなければ「作品写真を入れる」だけ', () => {
    expect(photoFindings([{ layout: 4, imageIds: ['a'] }])).toEqual([{ ruleId: 'photos-empty-slot', detail: '4枚の配置に1枚', photoPage: undefined }])
    expect(photoFindings([{ layout: 4, imageIds: [] }, { layout: 1, imageIds: [] }]).map((f) => f.ruleId)).toEqual(['photos-required'])
  })
})

describe('本文の段落に、見出しの形で打っている途中（「Ⅲ．まとめ」。Enter・書き終えると見出しになる）', () => {
  const machine = (r: Report, id: string, text: string) =>
    checkReport(r, currentConfig, layout())
      .filter((f) => f.ruleId === 'machine-dependent' && f.blockId === id)
      .map((f) => text.slice(f.start, f.end))
  const body = (text: string) => machine(ops.setText(cleanReport(), 'p5', text), 'p5', text)

  it('行の頭の番号（Ⅲ・ⅱ）には「機種依存文字を使わない」を出さない（見出しになると、番号は組版で付く）', () => {
    expect(body('Ⅲ．まとめ')).toEqual([])
    expect(body('ⅱ．袖の刺繍')).toEqual([])
    expect(body('　Ⅳ　制作を終えて')).toEqual([])
    // 名前を打ち始める前（番号と区切りだけ）も、打っている途中なので出さない
    expect(body('Ⅲ')).toEqual([])
    expect(body('Ⅲ．')).toEqual([])
  })

  it('番号のほかの機種依存文字・見出しにならない文・抄録の段落は、今までどおり指摘する', () => {
    expect(body('Ⅲ．①の工程')).toEqual(['①'])
    expect(body('Ⅲ．これは見出しではなく、文として書いたものである。')).toEqual(['Ⅲ'])
    expect(body('工程はⅢ段階に分けた。')).toEqual(['Ⅲ'])
    const r = cleanReport()
    const abstract = { ...r, abstract: { paragraphs: [{ type: 'paragraph' as const, id: 'a1', content: [{ type: 'text' as const, text: 'Ⅲ．まとめ' }] }] } }
    expect(machine(abstract, 'a1', 'Ⅲ．まとめ')).toEqual(['Ⅲ'])
  })
})
