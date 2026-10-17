import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { describe, expect, it } from 'vitest'
import { png } from '../../scripts/e2e/fixtures/docx.mjs'
import { currentConfig } from '../config'
import { mergeParts, mergeProblem } from './merge'
import { abstractLines, bodyPages, classifyPdf, isA4, pdfFindings, pdfLooksLike, pdfOks, readPdf, type PdfFacts, type PdfPageFacts } from './pdfFacts'

// ファイルを読む道具（ブラウザの外だけで使う。型はブラウザ用の設定にないので、ここで書く）
const fs: { readFileSync(p: string): Uint8Array } = await import(/* @vite-ignore */ `node:${'fs'}`)

const FIX = 'scripts/e2e/fixtures'
const A4: [number, number] = [595.28, 841.89]
const LETTER: [number, number] = [612, 792]

interface PageSpec {
  size?: [number, number]
  /** 下の端の文字（ページ番号） */
  footer?: string
  /** 上の端の文字 */
  header?: string
  text?: string
  images?: number
  /** 小さな飾りの画像（数えない） */
  tiny?: number
}

/** 試しの PDF（pdf-lib で作る。文字は英数字だけ） */
async function makePdf(pages: PageSpec[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const image = await doc.embedPng(png(64, 64))
  const tiny = await doc.embedPng(png(8, 8))
  for (const spec of pages) {
    const [w, h] = spec.size ?? A4
    const page = doc.addPage([w, h])
    if (spec.header) page.drawText(spec.header, { x: w / 2, y: h - 40, size: 10.5, font })
    if (spec.text) page.drawText(spec.text, { x: 90, y: h - 110, size: 11, font })
    if (spec.footer) page.drawText(spec.footer, { x: w / 2, y: 40, size: 10.5, font })
    for (let i = 0; i < (spec.images ?? 0); i++) page.drawImage(image, { x: 90 + i * 80, y: 400, width: 64, height: 64 })
    for (let i = 0; i < (spec.tiny ?? 0); i++) page.drawImage(tiny, { x: 90 + i * 20, y: 300, width: 8, height: 8 })
  }
  return doc.save()
}

const facts = async (bytes: Uint8Array): Promise<PdfFacts> => {
  const { doc, facts } = await readPdf(bytes, pdfjs)
  await doc.loadingTask.destroy()
  return facts
}

const fakePage = (lines: string[], extra: Partial<PdfPageFacts> = {}): PdfPageFacts => ({
  widthPt: A4[0],
  heightPt: A4[1],
  lines: lines.map((text, i) => ({ text, top: 0.1 + i * 0.03, size: 11 })),
  search: lines.join(''),
  pageNumber: null,
  images: 0,
  ...extra,
})

describe('PDF から分かること（pdf-lib で作った PDF）', () => {
  it('ページの数・A4・下のページ番号・ページの文字', async () => {
    const f = await facts(await makePdf([1, 2, 3].map((n) => ({ text: `Body page ${n}`, footer: String(n) }))))
    expect(f.pages).toHaveLength(3)
    expect(f.pages.every(isA4)).toBe(true)
    expect(f.pages.map((p) => p.pageNumber)).toEqual(['1', '2', '3'])
    expect(f.pages[1].search).toContain('Bodypage2')
  })
  it('上の端のページ番号（「- 2 -」の形）も見つける。ページ番号のないページは null', async () => {
    const f = await facts(await makePdf([{ text: 'Cover', header: '- 2 -' }, { text: 'No number here' }]))
    expect(f.pages.map((p) => p.pageNumber)).toEqual(['-2-', null])
  })
  it('A4 でない用紙（レター）を見分け、横向きの A4 は A4 とみなす', async () => {
    const f = await facts(await makePdf([{ size: LETTER }, { size: [A4[1], A4[0]] }]))
    expect(f.pages.map(isA4)).toEqual([false, true])
  })
  it('ページごとの画像の数（小さな飾りは数えない）', async () => {
    const f = await facts(await makePdf([{ images: 3, tiny: 2 }, { images: 0 }]))
    expect(f.pages.map((p) => p.images)).toEqual([3, 0])
  })
  it('PDF でないもの・壊れたものは、学生に分かる言葉で知らせる', async () => {
    await expect(readPdf(new TextEncoder().encode('これは PDF ではありません'), pdfjs)).rejects.toMatchObject({ name: 'PdfReadError', message: expect.stringContaining('PDF に保存し直して') })
  })
})

describe('学科の見本と同じつくりの PDF（scripts/e2e/fixtures/word-sample-*.pdf。架空の原稿）', () => {
  const load = (name: string) => facts(new Uint8Array(fs.readFileSync(`${FIX}/word-sample-${name}.pdf`)))
  it('1ページ目の文字から、どのパートかを見分ける（表紙・抄録・目次・本文）', async () => {
    expect(classifyPdf(await load('cover'))).toBe('cover')
    expect(classifyPdf(await load('abstract'))).toBe('abstract')
    expect(classifyPdf(await load('toc'))).toBe('toc')
    expect(classifyPdf(await load('body'))).toBe('body')
  })
  it('入れた場所と比べるときは、はっきり分かるものだけ（本文は、1ページ目にページ番号があるとき）', async () => {
    for (const name of ['cover', 'abstract', 'toc', 'body'] as const) expect(pdfLooksLike(await load(name))).toBe(name)
    // どれとも言えないページ（ページ番号もない）は null（本文とは言わない）
    expect(pdfLooksLike({ pages: [fakePage(['2026年度', '卒業研究'])] })).toBeNull()
  })
  it('本文は3ページで、下にページ番号 1〜3。表紙・抄録・目次にはページ番号がない', async () => {
    const body = await load('body')
    expect(body.pages.map((p) => p.pageNumber)).toEqual(['1', '2', '3'])
    expect(bodyPages(body)).toEqual({ count: 3, referencesFrom: null })
    for (const name of ['cover', 'abstract', 'toc']) expect((await load(name)).pages.map((p) => p.pageNumber)).toEqual([null])
    // 図1・図2（画像2枚）は1ページ目
    expect(body.pages.map((p) => p.images)).toEqual([2, 0, 0])
  })
  it('抄録の本文の行の数（サブタイトルの行より下）', async () => {
    const lines = abstractLines(await load('abstract'))
    expect(lines).toBeGreaterThanOrEqual(6)
    expect(lines).toBeLessThanOrEqual(12)
  })
  it('ページの文字に、Word の文が入っている（指摘の場所を探せる）', async () => {
    const body = await load('body')
    expect(body.pages[0].search).toContain('筆者が担当したのは、主人公のシンドバッドである。')
    expect(body.pages[1].search).toContain('綿ブロード')
  })
})

describe('本文のページの数と、PDF から分かる指摘', () => {
  const config = currentConfig
  it('「引用・参考文献」の見出しから後ろのページは、本文に数えない（ページの途中にあれば、そのページは数える）', () => {
    const top = { pages: [fakePage(['Ⅰ．企画']), fakePage(['本文']), fakePage(['引用・参考文献', '・浜松隆志'])] }
    expect(bodyPages(top)).toEqual({ count: 2, referencesFrom: 3 })
    const middle = { pages: [fakePage(['Ⅰ．企画']), fakePage(['まとめの文。', 'Ⅳ．参考文献', '・浜松'])] }
    expect(bodyPages(middle)).toEqual({ count: 2, referencesFrom: 2 })
  })
  it('用紙・ページ番号・本文のページの数・抄録のページの数・画像の数・作品写真', () => {
    const body = { pages: [fakePage(['a'], { pageNumber: '1', images: 3 }), fakePage(['b'], { pageNumber: null, images: 4 }), fakePage(['c'], { widthPt: 612, heightPt: 792, pageNumber: '3' })] }
    const cover = { pages: [fakePage(['表紙'], { pageNumber: '1' })] }
    const abstract = { pages: [fakePage(['抄録']), fakePage(['つづき'])] }
    const photo = { pages: [fakePage([]), fakePage([])] }
    const list = pdfFindings({ body, cover, abstract, photo }, config)
    const by = (part: string, ruleId: string) => list.find((f) => f.part === part && f.ruleId === ruleId)
    expect(by('body', 'pdf-a4')).toMatchObject({ severity: 'error', page: 3, detail: 'A4 でないページ：3ページ目（216×279mm）' })
    expect(by('body', 'page-number-missing')).toMatchObject({ severity: 'warning', page: 2 })
    expect(by('cover', 'page-number-extra')).toMatchObject({ severity: 'warning', title: '表紙にはページ番号を付けない' })
    expect(by('body', 'body-pages')).toMatchObject({ severity: 'error', title: '本文はA4で5ページ以上にする', detail: '現在 3ページ（PDF のページの数）' })
    expect(by('body', 'figures-per-page')).toMatchObject({ severity: 'warning', detail: '画像 7枚・本文 3ページ（目安は6枚まで）' })
    expect(by('abstract', 'abstract-one-page')).toMatchObject({ severity: 'error', detail: '現在 2ページ' })
    expect(by('photo', 'photo-one-page')).toMatchObject({ severity: 'error' })
    // 表紙は1ページ（4つを1つにまとめた PDF を入れたとき）
    expect(by('cover', 'cover-one-page')).toBeUndefined()
    const merged = pdfFindings({ cover: { pages: [fakePage(['表紙']), fakePage(['抄録']), fakePage(['目次'])] } }, config)
    expect(merged.find((x) => x.ruleId === 'cover-one-page')).toMatchObject({ severity: 'error', detail: '今 3ページ。1つにまとめた PDF ではなく、表紙だけの PDF を入れる' })
    // Word のチェックで出した指摘（ページの数）は、ここでは出さない
    const covered = pdfFindings({ body, abstract }, config, new Set(['body-pages', 'figures-per-page', 'abstract-one-page']))
    expect(covered.map((f) => f.ruleId).sort()).toEqual(['page-number-missing', 'pdf-a4'])
  })
  it('PDF だけのとき：そろっていることの一覧', () => {
    const body = { pages: [1, 2, 3, 4, 5].map((n) => fakePage([`p${n}`], { pageNumber: String(n) })) }
    const abstract = { pages: [fakePage(['抄録'])] }
    expect(pdfOks({ body, abstract }, config)).toEqual([
      { label: '本文のページの数', value: '5ページ（5ページ以上）' },
      { label: '本文のページ番号', value: 'どのページにもあります' },
      { label: '抄録のページの数', value: '1ページ' },
      { label: '用紙の大きさ', value: 'どのページも A4' },
    ])
  })
})

describe('1つの PDF にまとめる', () => {
  it('表紙 → 抄録 → 目次 → 本文 → 作品写真 の順に、全部のページをまとめる', async () => {
    const one = (name: string) => makePdf([{ text: name }])
    const body = await makePdf([1, 2, 3].map((n) => ({ text: `BODY${n}`, footer: String(n) })))
    const photo = png(30, 40)
    const { bytes, pageCount } = await mergeParts(
      [
        { type: 'pdf', bytes: await one('COVER') },
        { type: 'pdf', bytes: await one('ABSTRACT') },
        { type: 'pdf', bytes: await one('TOC') },
        { type: 'pdf', bytes: body },
        { type: 'image', bytes: photo, format: 'png', width: 30, height: 40 },
      ],
      '2026_卒業制作報告書_00ZZ0123_文化花子',
    )
    expect(pageCount).toBe(7)
    const merged = await PDFDocument.load(bytes)
    expect(merged.getPageCount()).toBe(7)
    expect(merged.getTitle()).toBe('2026_卒業制作報告書_00ZZ0123_文化花子')
    const f = await facts(bytes)
    expect(f.pages.map((p) => p.lines[0]?.text ?? '')).toEqual(['COVER', 'ABSTRACT', 'TOC', 'BODY1', 'BODY2', 'BODY3', ''])
    // 作品写真：A4 の1ページ、写真は1枚、透かしなどの文字はない
    expect(isA4(f.pages[6])).toBe(true)
    expect(f.pages[6]).toMatchObject({ images: 1, search: '' })
  })
  it('パスワード（保護）の付いた PDF・壊れた PDF は、まとめられない理由を返す', async () => {
    const doc = await PDFDocument.create()
    doc.addPage()
    doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: PDFName.of('Standard'), V: 2, R: 3 })
    expect(await mergeProblem(await doc.save())).toContain('パスワード')
    expect(await mergeProblem(new TextEncoder().encode('これは PDF ではありません'))).toContain('壊れている')
    expect(await mergeProblem(await makePdf([{ text: 'ok' }]))).toBeNull()
  })
})
