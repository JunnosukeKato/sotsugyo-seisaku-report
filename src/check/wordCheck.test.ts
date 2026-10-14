import { DOMParser } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'
import { br, floatingImage, makeDocx, normalStyle, p, png, rid, sectPr, textBox } from '../../scripts/e2e/fixtures/docx.mjs'
import { currentConfig } from '../config'
import { documentContext, readDocument } from '../import/wordDocument'
import { readWordFiles } from '../import/wordImport'
import { openWordFile } from '../import/wordPackage'
import { bodyFontSizes, mainFontSize, templateFindings } from './docxSettings'
import type { CheckFinding } from './parts'
import { readWord, sniffWord, wordFindings } from './wordCheck'
import { abstractParagraphs, bodyHeadings, headingDifference, sniffWordBlocks, tocHeadings } from './wordParts'

// 単体テストはブラウザの外で動くので、XML を読む道具（ブラウザの DOMParser）の代わりを置く
;(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser

// ファイルを読む道具（ブラウザの外だけで使う。型はブラウザ用の設定にないので、ここで書く）
const fs: { readFileSync(p: string): Uint8Array } = await import(/* @vite-ignore */ `node:${'fs'}`)

const FIX = 'scripts/e2e/fixtures'
const config = currentConfig
const file = (bytes: Uint8Array, name: string) => new File([bytes.slice()], name)
const fixture = (part: string, name = `${part}.docx`) => file(new Uint8Array(fs.readFileSync(`${FIX}/word-sample-${part}.docx`)), name)
const blocks = async (bytes: Uint8Array) => {
  const pkg = await openWordFile(file(bytes, 'x.docx'), 'Word')
  return readDocument(pkg.document, documentContext(pkg.styles, pkg.numbering))
}
const by = (list: CheckFinding[], ruleId: string) => list.filter((f) => f.ruleId === ruleId)

/** 抄録の見出しの行（02_抄録.docx と同じ並び） */
const ABSTRACT_HEAD = ['2026年度　卒業研究　抄録', '国際文化学部　国際ファッション文化学科　映画・舞台衣装デザイナーコース', '学籍番号　00ZZ0123　氏名　文化　花子', '（指導教員　梶田　貴子）', '卒業イベント「シンドバッド」について', '―シンドバッドの衣装制作―']

describe('どのパートの Word か（名前で分からないとき、中身から）', () => {
  it('見本の4つ（表紙・抄録・目次・本文）を見分ける', async () => {
    expect(await sniffWord(fixture('cover', 'a.docx'))).toBe('cover')
    expect(await sniffWord(fixture('abstract', 'b.docx'))).toBe('abstract')
    expect(await sniffWord(fixture('toc', 'c.docx'))).toBe('toc')
    expect(await sniffWord(fixture('body', 'd.docx'))).toBe('body')
  })
  it('Word でないファイルは null（読み取りのときに、理由を知らせる）', async () => {
    expect(await sniffWord(file(new TextEncoder().encode('%PDF-1.7'), 'x.docx'))).toBeNull()
  })
  it('大見出しのある文書は、「抄録」という言葉があっても本文', async () => {
    expect(sniffWordBlocks(await blocks(makeDocx({ body: [p('Ⅰ．企画・立案'), p('抄録の書き方を学んだ。')].join('') })))).toBe('body')
  })
})

describe('抄録の本文（02_抄録.docx の、上の決まった行より下）', () => {
  it('サブタイトル（「―…―」）の行より下の段落。仮の文字だけの段落は入れない', async () => {
    const b = await blocks(makeDocx({ body: [...ABSTRACT_HEAD.map((t) => p(t)), p(), p('　本制作報告書は、筆者が制作した衣装についてである。'), p('～～～～'), p('　二つ目の段落である。')].join('') }))
    expect(abstractParagraphs(b, config)).toEqual(['　本制作報告書は、筆者が制作した衣装についてである。', '　二つ目の段落である。'])
  })
  it('サブタイトルの行がなければ、決まった形の行（年度・学部学科・学籍番号・題目）を上から飛ばす', async () => {
    const head = ABSTRACT_HEAD.slice(0, 5)
    const b = await blocks(makeDocx({ body: [...head.map((t) => p(t)), p('　本文の一つ目の段落である。')].join('') }))
    expect(abstractParagraphs(b, config)).toEqual(['　本文の一つ目の段落である。'])
  })
  it('手で入れた改行で分かれた行は、1つの段落にする（字下げで始まる行だけ、新しい段落）', async () => {
    const b = await blocks(makeDocx({ body: [...ABSTRACT_HEAD.map((t) => p(t)), p('　一つ目の段落の途中で', br, '改行した文である。', br, '　二つ目の段落である。')].join('') }))
    expect(abstractParagraphs(b, config)).toEqual(['　一つ目の段落の途中で改行した文である。', '　二つ目の段落である。'])
  })
})

describe('目次と本文の見出し', () => {
  it('目次の行から、点線とページ番号を除いて見出しにする（仮の名前は除く）', async () => {
    const b = await blocks(makeDocx({ body: [p('目次'), p('Ⅰ．企画・立案・・・・・・1'), p('ⅰ．担当衣装のキャラクター'), p('Ⅱ．制作過程……3'), p('ⅰ．〇〇〇〇'), p('Ⅲ．まとめ\t5')].join('') }))
    expect(tocHeadings(b)).toEqual([
      { level: 1, title: '企画・立案' },
      { level: 2, title: '担当衣装のキャラクター' },
      { level: 1, title: '制作過程' },
      { level: 1, title: 'まとめ' },
    ])
  })
  it('目次にだけある見出し・本文にだけある見出しを挙げる。目次に見出しがなければ確かめない', () => {
    const toc = [{ level: 1 as const, title: '企画・立案' }, { level: 1 as const, title: 'まとめ' }]
    const body = [{ level: 1 as const, title: '企画 ・立案' }, { level: 1 as const, title: '制作過程' }]
    expect(headingDifference(toc, body)).toEqual({ onlyToc: ['まとめ'], onlyBody: ['制作過程'] })
    expect(headingDifference([], body)).toBeNull()
  })
  it('本文の見出し（「Ⅰ．」「ⅰ．」で始まる行）', async () => {
    expect(bodyHeadings(await blocks(fs.readFileSync(`${FIX}/word-sample-body.docx`))).map((h) => h.title)).toEqual(['企画・立案', '担当衣装のキャラクター', 'デザイン説明', '使用素材', '制作過程'])
  })
})

describe('ページ設定がひな形のままか', () => {
  const settings = async (part: 'cover' | 'abstract' | 'toc' | 'body', bytes: Uint8Array) => {
    const pkg = await openWordFile(file(bytes, 'x.docx'), 'Word')
    return templateFindings(part, pkg.document, pkg.styles)
  }
  const LONG = '　筆者が担当したのは、主人公のシンドバッドである。シンドバッドは七つの海を旅する船乗りで、明るく好奇心の強い人物として描かれている。'
  const bodyText = [p('Ⅰ．企画・立案'), p(LONG), p(LONG), p(LONG)].join('')
  it('ひな形のまま（余白・38字×38行・11pt）なら、指摘しない。±1mm のずれは見逃す', async () => {
    expect(await settings('body', makeDocx({ body: bodyText, styles: normalStyle(22), sectPr: sectPr() }))).toEqual([])
    expect(await settings('body', makeDocx({ body: bodyText, styles: normalStyle(22), sectPr: sectPr({ margins: [1440, 1418, 1400, 1985] }) }))).toEqual([])
  })
  it('余白が違えば、どこが何 mm かと、直し方を出す（エラー・手順書）', async () => {
    const [f] = await settings('body', makeDocx({ body: bodyText, styles: normalStyle(22), sectPr: sectPr({ margins: [1418, 1418, 1418, 1701] }) }))
    expect(f).toMatchObject({ ruleId: 'template-margins', severity: 'error', source: 'guide', title: '余白は、ひな形のまま（上・下・右 25mm、左 35mm）にする' })
    expect(f.detail).toBe('今は 左 30mm。Word の「レイアウト → ページ設定」の「余白」で直す')
  })
  it('表紙のひな形の余白は、上下左右 25mm', async () => {
    expect(await settings('cover', makeDocx({ body: p('表紙'), sectPr: sectPr({ margins: [1418, 1418, 1418, 1418], grid: null }) }))).toEqual([])
    const [f] = await settings('cover', makeDocx({ body: p('表紙'), sectPr: sectPr({ grid: null }) }))
    expect(f).toMatchObject({ ruleId: 'template-margins', title: '余白は、ひな形のまま（上下左右 25mm）にする', detail: expect.stringContaining('左 35mm') })
  })
  it('文字数と行数（「文字数と行数を指定する」と、ひな形の行送り・字送り）', async () => {
    const none = await settings('body', makeDocx({ body: bodyText, styles: normalStyle(22), sectPr: sectPr({ grid: null }) }))
    expect(none.map((f) => f.ruleId)).toEqual(['template-grid'])
    expect(none[0]).toMatchObject({ title: '文字数と行数は、ひな形のまま（38字×38行）にする', detail: expect.stringContaining('「文字数と行数」') })
    const other = await settings('abstract', makeDocx({ body: bodyText, styles: normalStyle(21), sectPr: sectPr({ grid: [368, 770] }) }))
    expect(other.map((f) => f.title)).toEqual(['文字数と行数は、ひな形のまま（40字×30行）にする'])
  })
  it('本文の文字の大きさ（いちばん多い大きさ）が 11pt でなければ指摘する。見出しや短い行は数えない', async () => {
    const small = await settings('body', makeDocx({ body: bodyText, styles: normalStyle(21), sectPr: sectPr() }))
    expect(small.map((f) => [f.ruleId, f.detail])).toEqual([['template-font-size', '今は 10.5ポイント。文字を選んで、「ホーム」の文字の大きさを 11 にする']])
    // 段落に直接付けた大きさ（w:sz）も読む
    const run = (text: string, size: number) => `<w:r><w:rPr><w:sz w:val="${size}"/></w:rPr><w:t>${text}</w:t></w:r>`
    const direct = makeDocx({ body: [`<w:p>${run('Ⅰ．企画・立案', 32)}</w:p>`, `<w:p>${run(LONG, 24)}</w:p>`, `<w:p>${run(LONG, 24)}</w:p>`].join(''), styles: normalStyle(22), sectPr: sectPr() })
    const pkg = await openWordFile(file(direct, 'x.docx'), 'Word')
    expect(mainFontSize(bodyFontSizes(pkg.document, pkg.styles))).toBe(24)
    // スタイルが分からない Word（大きさが分からない）は、確かめない
    expect(await settings('body', makeDocx({ body: bodyText, sectPr: sectPr() }))).toEqual([])
  })
})

describe('Word のチェック（学生用ツールのセルフチェックと同じ決まり）', () => {
  const all = () => ({ cover: fixture('cover', '01_表紙.docx'), abstract: fixture('abstract', '02_抄録.docx'), toc: fixture('toc', '03_目次.docx'), body: fixture('body', '04_本文.docx') })

  it('4つの Word を読み、学籍番号・氏名を表紙から読む', async () => {
    const reading = await readWord(all(), config)
    expect(reading.errors).toEqual({})
    expect(reading.has).toEqual({ cover: true, abstract: true, toc: true, body: true })
    expect(reading).toMatchObject({ studentId: '00ZZ0123', name: '文化　花子' })
    expect(reading.report.basicInfo.courseId).toBe('film-stage-costume')
    // Word で書いた章だけ（ツールのひな形から続ける「まとめ」などは入れない）
    expect(reading.report.body.map((c) => c.title)).toEqual(['企画・立案'])
    expect(reading.report.abstract.paragraphs).toHaveLength(3)
  })

  it('抄録の字数・文の書き方・本文のページの数・目次の見出し・ページ設定を指摘する', async () => {
    const reading = await readWord(all(), config)
    const { findings, covered } = wordFindings(reading, config, { bodyPages: 3, abstractPages: 1, abstractLines: 9 })
    expect(by(findings, 'abstract-length')[0]).toMatchObject({ part: 'abstract', severity: 'error', title: '抄録は600〜900字にする', detail: expect.stringMatching(/^現在 \d+字（あと\d+字）$/) })
    expect(by(findings, 'abstract-lines')[0]).toMatchObject({ part: 'abstract', detail: '現在 9行' })
    // 抄録の「ました」：指摘した文字のまわりと、Word の文を PDF から探すための文字
    const desu = by(findings, 'desu-masu')[0]
    expect(desu).toMatchObject({ part: 'abstract', title: '「です・ます」ではなく「である」調で書く', detail: '「ました」を「である」調に直す' })
    expect(desu.quote?.[1]).toBe('ました')
    expect(desu.quote?.[0]).toMatch(/^…/)
    expect(desu.snippets?.[0]).toContain('帯を巻きました')
    expect(by(findings, 'body-pages')[0]).toMatchObject({ part: 'body', detail: '現在 3ページ（PDF のページの数）' })
    expect(by(findings, 'swatch-image')).toHaveLength(3)
    expect(by(findings, 'swatch-image').map((f) => f.snippets)).toEqual([['綿ブロード上着'], ['サテン帯'], ['麻ズボン']])
    expect(by(findings, 'template-margins')).toEqual([expect.objectContaining({ part: 'toc', detail: expect.stringContaining('左 30mm') })])
    expect(by(findings, 'toc-headings')).toEqual([expect.objectContaining({ part: 'toc', severity: 'warning', detail: '目次にだけある：「まとめ」' })])
    expect(covered).toEqual(new Set(['body-pages', 'figures-per-page', 'abstract-one-page']))
  })

  it('ツールの中でしか意味のない指摘は出さない（抄録はまだ書いていない・作品写真・コース・「直す」でつなげる）', async () => {
    const reading = await readWord({ body: fixture('body', '04_本文.docx') }, config)
    const ids = wordFindings(reading, config, {}).findings.map((f) => f.ruleId)
    for (const dropped of ['abstract-not-started', 'photos-required', 'photos-empty-slot', 'manual-ref', 'paragraph-empty', 'required-field'])
      expect(ids).not.toContain(dropped)
    // PDF がなければ、ページの数の指摘はしない
    expect(ids).not.toContain('body-pages')
  })

  it('表紙の Word があるときだけ、表紙の空欄を指摘する（読み取れなかったと分かるように）', async () => {
    const cover = makeDocx({ body: [p('学籍番号　00ZZ0123'), p('―シンドバッドの衣装制作―')].join(''), sectPr: sectPr({ margins: [1418, 1418, 1418, 1418], grid: null }) })
    const reading = await readWord({ cover: file(cover, '01_表紙.docx') }, config)
    const required = by(wordFindings(reading, config, {}).findings, 'required-field')
    expect(required).toEqual([expect.objectContaining({ part: 'cover', title: '表紙の氏名が入力されていない', detail: '表紙の Word から読み取れませんでした' })])
  })

  it('読めない Word は、そのパートだけ知らせて、ほかは確かめる', async () => {
    const reading = await readWord({ body: file(new TextEncoder().encode('%PDF-1.7'), '04_本文.docx'), abstract: fixture('abstract', '02_抄録.docx') }, config)
    expect(reading.errors.body).toContain('PDF')
    expect(reading.errors.body).toContain('入れた')
    expect(reading.has).toMatchObject({ body: false, abstract: true })
  })

  it('本文に入れたファイルが表紙なら、そのことを知らせる', async () => {
    const reading = await readWord({ body: fixture('cover', '04_本文.docx') }, config)
    expect(reading.errors.body).toContain('表紙のファイルのようです')
  })

  it('グラフ・Word の図形の図は、Word に画像があるので「画像が入っていない」と言わない', async () => {
    const emf = new Uint8Array(88)
    emf.set([1, 0, 0, 0], 0)
    emf.set(new TextEncoder().encode(' EMF'), 40)
    const body = makeDocx({
      media: { 'image1.emf': emf, 'image2.png': png(40, 40) },
      body: [p('Ⅰ．企画・立案'), p('　デザイン画である（図1）。写真である（図2）。'), p(floatingImage(rid('image1.emf'))), p(textBox('図1　デザイン画')), p(floatingImage(rid('image2.png'), { x: 3000000 })), p(textBox('図2　写真', { x: 3000000 }))].join(''),
    })
    const reading = await readWord({ body: file(body, '04_本文.docx') }, config)
    expect(reading.imagesInWord).toEqual(new Set(['図1']))
    expect(by(wordFindings(reading, config, {}).findings, 'figure-image')).toEqual([])
  })
})

describe('「Word から読み込む」の読み取り（画像を縮めない）', () => {
  it('images: false：図に画像があることだけを残し、画像は取り出さない', async () => {
    const result = await readWordFiles({ body: fixture('body', '04_本文.docx') }, { config, courseId: 'film-stage-costume', images: false })
    const figures = result.body.flatMap((c) => c.blocks).flatMap((b) => (b.type === 'figureRow' ? b.figures : []))
    expect(figures).toHaveLength(2)
    expect(figures.every((f) => f.imageId)).toBe(true)
    expect(result.images).toEqual([])
  })
})
