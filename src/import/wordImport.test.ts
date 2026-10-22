import { DOMParser } from '@xmldom/xmldom'
import { zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { br, emfHeader, floatingImage, inlineImage, makeDocx, numbered, p, png, rid, styled, tab, table, textBox } from '../../scripts/e2e/fixtures/docx.mjs'
import { currentConfig, type TemplateBlock, type YearConfig } from '../config'
import { templateProblems } from '../config/validate'
import { contentToText, numbering } from '../editor/reportOps'
import { createReport } from '../model/newReport'
import type { Chapter, FigureRowBlock, ParagraphBlock, TableBlock } from '../model/types'
import type { WordImportResult } from './types'
import { isPlaceholderOnly, isWriting, parseCaptionLine } from './wordImport'
import { headingFromText } from '../model/headingText'
import { applyWordImport, chapterOrder, lostByImport, readWordFiles, subtitleFromWord, WordImportError } from './wordImport'
import { imageInfo, prepareImage } from './wordImages'

// 単体テストはブラウザの外で動くので、XML を読む道具（ブラウザの DOMParser）の代わりを置く
;(globalThis as { DOMParser?: unknown }).DOMParser = DOMParser

// ファイルを読む道具（ブラウザの外だけで使う。型はブラウザ用の設定にないので、ここで書く）
const fs: { existsSync(p: string): boolean; readFileSync(p: string): Uint8Array; readdirSync(p: string): string[] } = await import(/* @vite-ignore */ `node:${'fs'}`)

const COURSE = 'film-stage-costume'
const context = { config: currentConfig, courseId: COURSE }
/**
 * 公開中の設定の写し（通しテストで使うもの）。コースのひな形（template）がなく、標準のひな形（小見出しなし）になる。
 * ツールに入っている設定（2026.json）とは、ひな形の見出しが違うので、両方で同じに読めるかを確かめる
 */
const publishedConfig = JSON.parse(new TextDecoder().decode(fs.readFileSync('scripts/e2e/config-fixture.json'))) as YearConfig
const CONFIGS: [string, { config: YearConfig; courseId: string }][] = [
  ['ツールに入っている設定（コースのひな形あり）', context],
  ['公開中の設定の写し（コースのひな形なし）', { config: publishedConfig, courseId: publishedConfig.courses[0].id }],
]

const file = (bytes: Uint8Array, name = '04_本文.docx') => new File([bytes.slice()], name)
const read = (body: Uint8Array, cover?: Uint8Array, ctx = context): Promise<WordImportResult> =>
  readWordFiles({ body: file(body), ...(cover ? { cover: file(cover, '01_表紙.docx') } : {}) }, ctx)

const blocksOf = (chapter: Chapter) => chapter.blocks
const textOf = (body: Chapter[], b: ParagraphBlock) => contentToText(b.content, numbering({ body }))
const paragraphs = (body: Chapter[], chapter = 0) =>
  blocksOf(body[chapter])
    .filter((b): b is ParagraphBlock => b.type === 'paragraph')
    .map((b) => textOf(body, b))
const figureRows = (body: Chapter[]) => body.flatMap((c) => c.blocks).filter((b): b is FigureRowBlock => b.type === 'figureRow')
const tables = (body: Chapter[]) => body.flatMap((c) => c.blocks).filter((b): b is TableBlock => b.type === 'table')
const kinds = (chapter: Chapter) => chapter.blocks.map((b) => (b.type === 'subheading' ? `s:${b.title}` : b.type))

const LONG_TILDE = '～'.repeat(40)
const DESIGN = png(120, 160)
const BACK = png(120, 160, { figure: [140, 60, 50] })
const SWATCH = png(40, 40, { draw: () => [200, 30, 30] })

/** 学科のひな形（04_本文.docx）と同じつくりで、1章を書いた見本（2章はひな形のまま） */
function templateLikeBody() {
  return makeDocx({
    media: { 'image1.png': DESIGN, 'image2.png': BACK, 'image3.png': SWATCH },
    body: [
      p('Ⅰ．企画・立案'),
      p('ⅰ．担当衣装のキャラクター'),
      p('　筆者が担当したのは、主人公のシンドバッドである。七つの海を旅する船乗りで、明るく好奇心の強い人物である。'),
      p(),
      p('ⅱ．デザイン説明'),
      p('　', 'デザインは、中世のペルシャの船乗りの装いをもとにした（図1）。後ろ姿は図2に示す。'),
      // ひな形と同じく、浮かせた画像と、文字の枠のタイトル（新旧2通りで2回入る）を、空の段落に置く。2枚は横に並ぶ
      p(floatingImage(rid('image1.png'), { x: 702473, cx: 1447165 }), floatingImage(rid('image2.png'), { x: 3014508, cx: 1447165 }), '<w:r><w:br w:type="page"/></w:r>'),
      p(),
      p(),
      // タイトルの枠は、書いた順が逆（右の図2が先）でも、横の位置で組にする
      p(textBox(['図2　デザイン画（後ろ）'], { x: 2365538 }), textBox(['図1　デザイン画（前）'], { x: 53503 })),
      p('ⅲ．使用', '素材'),
      p(textBox('表1　使用材料表'), '　表', '1', 'に使用した素材をまとめる。'),
      p(),
      table([
        ['名称', '使用箇所', '生地見本'],
        ['綿ブロード', '上着', { images: [rid('image3.png')] }],
        ['サテン', '帯', ''],
        ['', '', ''],
        ['', '', ''],
      ]),
      p('<w:r><w:br w:type="page"/></w:r>'),
      p('Ⅱ', '．制作過程'),
      p('ⅰ．〇〇〇〇'),
      p(`　${LONG_TILDE}（図3）。`),
      p(`${LONG_TILDE}（図4）。`),
      p(),
      p('ⅱ．〇〇〇〇'),
      p(LONG_TILDE),
    ].join(''),
  })
}

afterEach(() => {
  delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap
  delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas
})

describe('文字の見分け方', () => {
  it('行の頭のローマ数字で、大見出し・小見出しを見分け、番号を除く', () => {
    expect(headingFromText('Ⅰ．企画・立案')).toEqual({ level: 1, title: '企画・立案' })
    expect(headingFromText('Ⅱ　制作過程')).toEqual({ level: 1, title: '制作過程' })
    expect(headingFromText('II. 制作過程')).toEqual({ level: 1, title: '制作過程' })
    expect(headingFromText('ⅰ．担当衣装のキャラクター')).toEqual({ level: 2, title: '担当衣装のキャラクター' })
    expect(headingFromText('iii.使用素材')).toEqual({ level: 2, title: '使用素材' })
    expect(headingFromText('ｉｉ．デザイン説明')).toEqual({ level: 2, title: 'デザイン説明' })
    // 英語の文や、ふつうの文は見出しにしない
    expect(headingFromText('I think so.')).toBeNull()
    expect(headingFromText('In this report')).toBeNull()
    expect(headingFromText('筆者が担当したのは、')).toBeNull()
  })

  it('図・表のタイトルの行（番号は全角・半角、2つ並んだもの）と、図を指す文を見分ける', () => {
    expect(parseCaptionLine('図1　デザイン画')).toMatchObject([{ kind: '図', number: 1, name: 'デザイン画' }])
    expect(parseCaptionLine('図１．デザイン画')).toMatchObject([{ kind: '図', number: 1, name: 'デザイン画' }])
    expect(parseCaptionLine('表1 使用材料表')).toMatchObject([{ kind: '表', number: 1, name: '使用材料表' }])
    expect(parseCaptionLine('図2　トワル（前）　　図3　トワル（後ろ）')).toMatchObject([
      { number: 2, name: 'トワル（前）' },
      { number: 3, name: 'トワル（後ろ）' },
    ])
    expect(parseCaptionLine('図2　〇〇〇〇')).toMatchObject([{ number: 2, name: '' }])
    expect(parseCaptionLine('図1に示すように、袖を広げた。')).toBeNull()
    expect(parseCaptionLine('図1は、デザイン画である。')).toBeNull()
    expect(parseCaptionLine('表1に使用した素材をまとめる。')).toBeNull()
  })

  it('仮の文字だけの行と、学生が書いた文を見分ける', () => {
    expect(isPlaceholderOnly(`　${LONG_TILDE}（図1）。`)).toBe(true)
    expect(isPlaceholderOnly('〇〇〇〇')).toBe(true)
    expect(isPlaceholderOnly('')).toBe(false)
    expect(isPlaceholderOnly('筆者が担当したのは、～～～')).toBe(false)
    // ひな形にもとからある文だけなら、書いたことにしない
    expect(isWriting('筆者が担当したのは、～～～～～')).toBe(false)
    expect(isWriting('　表1に使用した素材をまとめる。')).toBe(false)
    expect(isWriting('筆者が担当したのは、シンドバッドである。')).toBe(true)
  })
})

describe('ひな形と同じつくりの Word', () => {
  it('見出し・段落・図（2枚並び）・表を写し、まだ書いていない章はツールのひな形で続ける', async () => {
    const result = await read(templateLikeBody())
    const { body } = result
    // Ⅱ（制作過程）は「〇〇〇〇」「～～～」のままなので写さず、ひな形の「制作過程」「まとめ」で続ける
    expect(body.map((c) => c.title)).toEqual(['企画・立案', '制作過程', 'まとめ'])
    expect(kinds(body[0])).toEqual(['s:担当衣装のキャラクター', 'paragraph', 's:デザイン説明', 'paragraph', 'figureRow', 's:使用素材', 'paragraph', 'table'])
    // 段落の頭の空白は除く。（図1）・図2・表1 は、図・表へのつながりになる
    expect(paragraphs(body)).toEqual([
      '筆者が担当したのは、主人公のシンドバッドである。七つの海を旅する船乗りで、明るく好奇心の強い人物である。',
      'デザインは、中世のペルシャの船乗りの装いをもとにした（図1）。後ろ姿は図2に示す。',
      '表1に使用した素材をまとめる。',
    ])
    const design = body[0].blocks[3] as ParagraphBlock
    const [row] = figureRows(body)
    expect(design.content.filter((n) => n.type === 'ref').map((n) => n.type === 'ref' && n.targetId)).toEqual(row.figures.map((f) => f.id))
    // 2枚並びの図は1つの並びにし、タイトルは横の位置で組にする（文字の枠の中の文字は、2回入っていても1回だけ）
    expect(row.figures.map((f) => f.caption)).toEqual(['デザイン画（前）', 'デザイン画（後ろ）'])
    expect(row.figures.every((f) => f.imageId)).toBe(true)
    const [front, back] = row.figures.map((f) => result.images.find((i) => i.id === f.imageId))
    expect(front).toMatchObject({ widthPx: 120, heightPx: 160 })
    expect(back?.id).not.toBe(front?.id)
    // 表：1行目は見出しの行、生地見本の画像はセルの画像。空の行は写さない
    const [t] = tables(body)
    expect(t.caption).toBe('使用材料表')
    expect(t.rows.map((r) => r.cells.map((c) => c.text))).toEqual([
      ['名称', '使用箇所', '生地見本'],
      ['綿ブロード', '上着', ''],
      ['サテン', '帯', ''],
    ])
    expect(t.rows[1].cells[2].imageId).toBeTruthy()
    // 列の幅・行の高さ・左端の列は、今までどおり（そろえる・中身に合わせる・ほかとそろえる）
    expect(t).toMatchObject({ widths: 'equal', heights: 'auto' })
    expect(t.labelColumn).toBeUndefined()
    expect(result.images).toHaveLength(3)
    // 確認の窓に出すもの
    expect(result.counts).toEqual({ chapters: 1, subheadings: 3, paragraphs: 3, figures: 2, tables: 1 })
    expect(result.outline).toEqual([
      { level: 1, title: '企画・立案', paragraphs: 0, figures: [], tables: [] },
      { level: 2, title: '担当衣装のキャラクター', paragraphs: 1, figures: [], tables: [] },
      { level: 2, title: 'デザイン説明', paragraphs: 1, figures: ['図1', '図2'], tables: [] },
      { level: 2, title: '使用素材', paragraphs: 1, figures: [], tables: ['表1'] },
      { level: 1, title: '制作過程', paragraphs: 0, figures: [], tables: [], fromTemplate: true },
      { level: 1, title: 'まとめ', paragraphs: 0, figures: [], tables: [], fromTemplate: true },
    ])
    expect(result.figures).toEqual([
      { label: '図1', caption: 'デザイン画（前）', imageId: front?.id },
      { label: '図2', caption: 'デザイン画（後ろ）', imageId: back?.id },
    ])
    expect(result.tables).toEqual([{ label: '表1', caption: '使用材料表', rows: 2 }])
    // 「ⅰ．〇〇〇〇」「～～～（図3）。」「～～～（図4）。」「ⅱ．〇〇〇〇」「～～～」の5行
    expect(result.skippedPlaceholders).toBe(5)
    expect(result.problems).toEqual([])
    // ひな形から続けた章は、ひな形どおり（説明の付いた空の段落）
    expect(body[1].blocks[0]).toMatchObject({ type: 'paragraph', hint: 'パターン・縫製・装飾など、作った順に工夫した点を書く' })
  })

  it('写すと、本文が入れ替わり、表紙の読み取れた項目が入る（抄録・作品写真・引用参考文献はそのまま）', async () => {
    const result = await read(templateLikeBody())
    const report = { ...createReport(currentConfig, COURSE), references: [{ type: 'book' as const, id: 'b1', author: 'a', title: 't', publisher: 'p', year: '2020', pages: '1' }] }
    report.basicInfo.name = '前の名前'
    const applied = applyWordImport(report, { ...result, cover: { studentId: '00ZZ0123' } })
    expect(applied.body).toBe(result.body)
    expect(applied.basicInfo).toEqual({ ...report.basicInfo, studentId: '00ZZ0123' })
    expect(applied.abstract).toBe(report.abstract)
    expect(applied.workPhotos).toBe(report.workPhotos)
    expect(applied.references).toBe(report.references)
  })

  it('読み込むと消える、ツールで書いた本文を、章の名前と段落の数で知らせる（Word から写したままの段落は数えない）', async () => {
    const fresh = createReport(currentConfig, COURSE)
    const result = await read(templateLikeBody())
    // はじめて写すとき（ひな形のまま）は、消えるものはない
    expect(lostByImport(fresh, result.body)).toEqual([])
    // 写したあと、Word でまだ書いていない「Ⅱ．制作過程」を、ツールで3段落書いた
    const imported = applyWordImport(fresh, result)
    const written = (text: string): ParagraphBlock => ({ type: 'paragraph', id: text, content: [{ type: 'text', text }] })
    const report = {
      ...imported,
      body: imported.body.map((c) => (c.title === '制作過程' ? { ...c, blocks: [written('型紙を引いた。'), written('仮縫いをした。'), written('本縫いをした。')] } : c)),
    }
    // 同じ Word を読み込み直す：Ⅰ は Word のままなので数えず、ツールで書いた Ⅱ の3段落が消える
    const again = await read(templateLikeBody())
    expect(lostByImport(report, again.body)).toEqual([{ heading: 'Ⅱ．制作過程', title: '制作過程', paragraphs: 3, figures: 0, tables: 0 }])
  })

  it('Word で行を高くしてあった表（素材表の写真の枠）は、行の高さを「写真が入る高さ」にする。ふつうの高さ・「自動」の高さの表は、中身に合わせる', async () => {
    const rows = [
      ['名称', '使用箇所', '生地見本'],
      ['綿ブロード', '上着', ''],
      ['サテン', '帯', ''],
    ]
    const body = (...tbls: string[]) =>
      makeDocx({ body: [p('Ⅰ．企画・立案'), p('ⅲ．使用素材'), p('表1に使用した素材をまとめる。'), ...tbls.flatMap((t, i) => [p(`表${i + 1}　使用材料表${i + 1}`), t])].join('') })
    const result = await read(
      body(
        // 学科の Word の素材表と同じ高さ（見出しの行 345twip、ほかは 1904〜2062twip）
        table(rows, { heights: [345, 1904, 2062] }),
        table(rows, { heights: [345, 400, 400] }),
        table(rows),
        table(rows, { heights: [345, 1957, 1957], hRule: 'auto' }),
      ),
    )
    expect(tables(result.body).map((t) => t.heights)).toEqual(['photo', 'auto', 'auto', 'auto'])
  })
})

describe('学生の書き方の違い', () => {
  it('段落の頭の空白がない・半角・タブ、手で入れた改行（字下げで始まる行は新しい段落）', async () => {
    const result = await read(
      makeDocx({
        body: [
          p('Ⅰ．企画・立案'),
          p('空白なしで始まる段落である。'),
          p(' 半角の空白で始まる段落である。'),
          p(tab, 'タブで始まる段落である。'),
          p('　1行目の途中で', br, '改行した段落である。'),
          p('　1つ目の段落である。', br, '　2つ目の段落を改行で分けた。'),
          p('English words', br, 'continue here.'),
        ].join(''),
      }),
    )
    expect(paragraphs(result.body)).toEqual([
      '空白なしで始まる段落である。',
      '半角の空白で始まる段落である。',
      'タブで始まる段落である。',
      '1行目の途中で改行した段落である。',
      '1つ目の段落である。',
      '2つ目の段落を改行で分けた。',
      'English words continue here.',
    ])
  })

  it('見出しのスタイル（Word の日本語版の「見出し 1」、Google ドキュメントの Heading1）の見出しも読み、番号は除く', async () => {
    const styles =
      '<w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>' +
      '<w:style w:type="paragraph" w:styleId="MyHeading"><w:name w:val="自分の見出し"/><w:basedOn w:val="Heading2"/></w:style>'
    const result = await read(
      makeDocx({
        styles,
        body: [styled('1', '企画・立案'), styled('Heading2', 'ⅰ．担当衣装のキャラクター'), p('段落である。'), styled('MyHeading', '2. デザイン説明'), p('段落である。'), styled('1', '第2章　制作過程'), p('段落である。')].join(''),
      }),
    )
    expect(result.body.slice(0, 2).map((c) => [c.title, ...kinds(c)])).toEqual([
      ['企画・立案', 's:担当衣装のキャラクター', 'paragraph', 's:デザイン説明', 'paragraph'],
      ['制作過程', 'paragraph'],
    ])
  })

  it('「1．企画・立案」「第2章　制作過程」や番号のない行でも、名前がコースのひな形の見出しと同じなら見出しにする', async () => {
    const result = await read(
      makeDocx({
        body: [p('1．企画・立案'), p('担当衣装のキャラクター'), p('段落である。'), p('第2章　制作過程'), p('段落である。'), p('まとめ'), p('段落である。'), p('3. 考察')].join(''),
      }),
    )
    expect(result.body.map((c) => [c.title, ...kinds(c)])).toEqual([
      ['企画・立案', 's:担当衣装のキャラクター', 'paragraph'],
      ['制作過程', 'paragraph'],
      ['まとめ', 'paragraph', 'paragraph'],
    ])
    // ひな形にない名前は、見出しにせず知らせる
    expect(result.problems.map((x) => x.message)).toEqual(['見出しの形でない行があります：「3. 考察」'])
  })

  it('Word の自動の段落番号：ローマ数字は見出しにし、ほかの番号・箇条書きは段落の頭に付ける', async () => {
    const level = (ilvl: number, fmt: string, text: string) => `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/></w:lvl>`
    const numberingXml =
      `<w:abstractNum w:abstractNumId="0">${level(0, 'upperRoman', '%1．')}${level(1, 'lowerRoman', '%2．')}</w:abstractNum>` +
      `<w:abstractNum w:abstractNumId="1">${level(0, 'decimal', '%1.')}</w:abstractNum>` +
      `<w:abstractNum w:abstractNumId="2">${level(0, 'bullet', '')}</w:abstractNum>` +
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="3"><w:abstractNumId w:val="2"/></w:num>'
    const result = await read(
      makeDocx({
        numbering: numberingXml,
        body: [numbered(1, 0, '企画・立案'), numbered(1, 1, '担当衣装のキャラクター'), p('作った順は次のとおりである。'), numbered(2, 0, '布を裁つ。'), numbered(2, 0, '縫う。'), numbered(3, 0, '綿の布')].join(''),
      }),
    )
    expect(result.body[0].title).toBe('企画・立案')
    expect(kinds(result.body[0])[0]).toBe('s:担当衣装のキャラクター')
    expect(paragraphs(result.body)).toEqual(['作った順は次のとおりである。', '1.　布を裁つ。', '2.　縫う。', '・綿の布'])
  })

  it('行内に置いた図と、段落に書いたタイトル（画像と同じ段落の改行の後ろ、次の段落）', async () => {
    const result = await read(
      makeDocx({
        media: { 'a.png': DESIGN, 'b.png': BACK },
        body: [
          p('Ⅰ．企画・立案'),
          p('デザイン画を図1に示す。'),
          p(inlineImage(rid('a.png'))),
          p('図1　デザイン画'),
          p('トワルを組んだ（図２）。'),
          p(inlineImage(rid('b.png')), br, '図2 トワル'),
        ].join(''),
      }),
    )
    const { body } = result
    expect(kinds(body[0])).toEqual(['paragraph', 'figureRow', 'paragraph', 'figureRow'])
    expect(figureRows(body).map((r) => r.figures.map((f) => f.caption))).toEqual([['デザイン画'], ['トワル']])
    // 全角の番号の（図２）も、つながりにする
    expect(paragraphs(body)).toEqual(['デザイン画を図1に示す。', 'トワルを組んだ（図2）。'])
    expect((body[0].blocks[2] as ParagraphBlock).content.some((n) => n.type === 'ref')).toBe(true)
    expect(result.problems).toEqual([])
  })

  it('2枚並びの図：位置の基準が「段」と「余白」に分かれていても、タイトルが「右寄せ」で置いてあっても、左右の位置で組にする（過去の卒業生の Word）', async () => {
    const FRONT = png(120, 160)
    const REAR = png(130, 170)
    const TIE = png(160, 120)
    const SHIRT = png(110, 150)
    const result = await read(
      makeDocx({
        media: { 'front.png': FRONT, 'rear.png': REAR, 'tie.png': TIE, 'shirt.png': SHIRT },
        sectPr: '<w:pgSz w:w="11906" w:h="16838" w:code="9"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1985" w:header="851" w:footer="624" w:gutter="0"/>',
        body: [
          p('Ⅰ．制作過程'),
          p('ジャケットの前である（図1）。後ろは図2に示す。'),
          // 右の画像（後ろ）が先に書いてあり、基準は「段」。左の画像（前）の基準は「余白」
          p(floatingImage(rid('rear.png'), { x: 3048635, cx: 1442720, from: 'column' }), floatingImage(rid('front.png'), { x: 703580, cx: 1447165 })),
          p(textBox(['図1　ジャケット前'], { x: 53503 }), textBox(['図2　ジャケット後ろ'], { x: 2365538 })),
          p('シャツである（図3）。タイは図4に示す。'),
          // 右の画像（タイ）が先。左のタイトルは位置の数、右のタイトルは「右寄せ」
          p(floatingImage(rid('tie.png'), { x: 3113405, cx: 1912620 }), floatingImage(rid('shirt.png'), { x: 751205, cx: 1356360 })),
          p(textBox(['図3　シャツ'], { x: 38100 }), textBox(['図4　アスコットタイ'], { align: 'right' })),
        ].join(''),
      }),
    )
    // 画像のある図の並び（ひな形の章の、写真を入れる前の枠は除く）
    const rows = figureRows(result.body)
      .filter((r) => r.figures.some((f) => f.imageId))
      .map((r) => r.figures.map((f) => [f.caption, result.images.find((i) => i.id === f.imageId)?.widthPx]))
    expect(rows).toEqual([
      [
        ['ジャケット前', 120],
        ['ジャケット後ろ', 130],
      ],
      [
        ['シャツ', 110],
        ['アスコットタイ', 160],
      ],
    ])
  })

  it('浮かせた画像とタイトルの枠が、別の段落に付いていても組にする', async () => {
    const result = await read(
      makeDocx({
        media: { 'a.png': DESIGN },
        body: [p('Ⅰ．企画・立案'), p('デザインを示す（図1）。', floatingImage(rid('a.png'))), p('袖は広くした。', textBox('図1　デザイン画'))].join(''),
      }),
    )
    const blocks = result.body[0].blocks
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'figureRow', 'paragraph'])
    expect((blocks[1] as FigureRowBlock).figures[0].caption).toBe('デザイン画')
  })

  it('画像を並べるための表（画像とタイトルだけの表）は、図にする', async () => {
    const result = await read(
      makeDocx({
        media: { 'a.png': DESIGN, 'b.png': BACK },
        body: [
          p('Ⅰ．企画・立案'),
          p('トワルを前と後ろから見た（図1）（図2）。'),
          table([
            [{ images: [rid('a.png')] }, { images: [rid('b.png')] }],
            ['図1　トワル（前）', '図2　トワル（後ろ）'],
          ]),
        ].join(''),
      }),
    )
    expect(tables(result.body)).toHaveLength(0)
    expect(figureRows(result.body).map((r) => r.figures.map((f) => f.caption))).toEqual([['トワル（前）', 'トワル（後ろ）']])
  })

  it('表のタイトルが表の下・表の中の1行目にあっても読み、結合したセルは分けて知らせる', async () => {
    const result = await read(
      makeDocx({
        body: [
          p('Ⅰ．企画・立案'),
          p('素材を表1に、道具を表2にまとめる。'),
          table([
            ['名称', '使用箇所'],
            ['綿', '上着'],
          ]),
          p('表1　使用材料表'),
          table([
            [{ text: '表2　道具', span: 2 }],
            ['道具', '使い方'],
            [{ text: 'ミシン', vMerge: 'restart' }, '縫う'],
            [{ text: '', vMerge: 'continue' }, '端の始末'],
          ]),
        ].join(''),
      }),
    )
    const [t1, t2] = tables(result.body)
    expect(t1.caption).toBe('使用材料表')
    expect(t2.caption).toBe('道具')
    expect(t2.rows.map((r) => r.cells.map((c) => c.text))).toEqual([
      ['道具', '使い方'],
      ['ミシン', '縫う'],
      ['', '端の始末'],
    ])
    expect(result.problems.map((x) => x.message)).toEqual(['表2の結合したセルは、分けて写しました'])
  })

  it('読み取れなかったところ（タイトルのない図・画像のないタイトル・使えない形の画像・見出しの形でない行）を知らせる', async () => {
    const result = await read(
      makeDocx({
        media: { 'a.png': DESIGN, 'b.png': BACK, 'c.emf': emfHeader() },
        body: [
          p('Ⅰ．企画・立案'),
          p('ⅰ．トワル組み'),
          p('トワルを組んだ（図1）（図2）（図3）。'),
          p(inlineImage(rid('a.png'))),
          p('図1　トワル（前）'),
          p('次に後ろを組んだ。'),
          p(inlineImage(rid('b.png'))),
          p('次に、袖を作った。'),
          p('図3　袖'),
          p('2. パターン'),
          p('型紙を作った。'),
          p(inlineImage(rid('c.emf'))),
          p('図4　型紙'),
        ].join(''),
      }),
    )
    expect(figureRows(result.body).map((r) => r.figures.map((f) => [f.caption, !!f.imageId]))).toEqual([
      [['トワル（前）', true]],
      [['', true]],
      [['袖', false]],
      [['型紙', false]],
    ])
    expect(result.problems).toEqual([
      expect.objectContaining({ message: '図2のタイトルが見つかりませんでした', where: 'Ⅰ．企画・立案　ⅰ．トワル組み' }),
      expect.objectContaining({ message: '図3の画像が見つかりませんでした' }),
      expect.objectContaining({ message: '図4の画像は、ツールで使えない形（EMF）でした' }),
      expect.objectContaining({ message: '見出しの形でない行があります：「2. パターン」' }),
    ])
    expect(result.problems[0].detail).toContain('タイトルを空けて写します')
    expect(result.outline.find((o) => o.title === 'トワル組み')).toMatchObject({ problem: true, figures: ['図1', '図2', '図3', '図4'] })
    // 「（図3）」は、タイトルが「図3」の図（画像なし）につながる
    const refs = (result.body[0].blocks[1] as ParagraphBlock).content.filter((n) => n.type === 'ref')
    const ids = figureRows(result.body).flatMap((r) => r.figures.map((f) => f.id))
    expect(refs.map((n) => n.type === 'ref' && n.targetId)).toEqual(ids.slice(0, 3))
  })

  it('本文の（図1）は、Word のタイトルの番号のとおりにつなぐ（番号の合わないものは文字のまま）', async () => {
    const result = await read(
      makeDocx({
        media: { 'a.png': DESIGN, 'b.png': BACK },
        body: [
          p('Ⅰ．企画・立案'),
          p('前を図1に、後ろを（図3）に示す。存在しない（図5）もある。'),
          p(floatingImage(rid('a.png'), { x: 0, cx: 1400000 }), floatingImage(rid('b.png'), { x: 3000000, cx: 1400000 })),
          p(textBox('図1　前', { x: 0, cx: 1400000 }), textBox('図3　後ろ', { x: 3000000, cx: 1400000 })),
        ].join(''),
      }),
    )
    const [row] = figureRows(result.body)
    const content = (result.body[0].blocks[0] as ParagraphBlock).content
    expect(content.filter((n) => n.type === 'ref').map((n) => n.type === 'ref' && n.targetId)).toEqual([row.figures[0].id, row.figures[1].id])
    // ツールでは番号が振り直される（Word の図3 はツールの図2）。図5 は文字のまま（ツールのセルフチェックが知らせる）
    expect(paragraphs(result.body)).toEqual(['前を図1に、後ろを（図2）に示す。存在しない（図5）もある。'])
  })

  it('ひな形の仮の画像（「デザイン画を挿入する」）のままの図は、画像を空けて写す', async () => {
    // ひな形の仮の画像（灰色の JPEG）は公開の場所に置けないので、試しの画像を、仮の画像として扱わせる
    const { TEMPLATE_IMAGE_FINGERPRINTS, imageFingerprint } = await import('./wordImages')
    const mark = imageFingerprint(BACK)
    TEMPLATE_IMAGE_FINGERPRINTS.add(mark)
    try {
      const body = (texts: string[]) =>
        makeDocx({ media: { 'a.png': BACK }, body: [p('Ⅰ．企画・立案'), p('ⅱ．デザイン説明'), ...texts.map((t) => p(t)), p(floatingImage(rid('a.png')), textBox('図1　デザイン画'))].join('') })
      // 文を書いた章：図は枠だけ（画像を空ける）にして、知らせる
      const written = await read(body(['デザインは、船乗りの装いをもとにした（図1）。']))
      expect(figureRows(written.body).map((r) => r.figures.map((f) => [f.caption, f.imageId]))).toEqual([[['デザイン画', '']]])
      expect(written.images).toEqual([])
      expect(written.problems.map((x) => x.message)).toEqual(['図1は、ひな形の仮の画像のままでした'])
      // 仮の文字と仮の画像だけの章は、書いていない章
      const blank = await read(body([`　${LONG_TILDE}（図1）。`]))
      expect(blank.outline.every((o) => o.fromTemplate)).toBe(true)
    } finally {
      TEMPLATE_IMAGE_FINGERPRINTS.delete(mark)
    }
  })

  it('変更履歴（削除した文字は読まない）・隠し文字・ふりがな', async () => {
    const result = await read(
      makeDocx({
        body: [
          p('Ⅰ．企画・立案'),
          '<w:p><w:r><w:t>袖を</w:t></w:r><w:del w:id="1" w:author="a"><w:r><w:delText>短く</w:delText></w:r></w:del><w:ins w:id="2" w:author="a"><w:r><w:t>長く</w:t></w:r></w:ins>' +
            '<w:r><w:rPr><w:vanish/></w:rPr><w:t>隠した文字</w:t></w:r><w:r><w:t>し、</w:t></w:r>' +
            '<w:r><w:ruby><w:rubyPr/><w:rt><w:r><w:t>えり</w:t></w:r></w:rt><w:rubyBase><w:r><w:t>衿</w:t></w:r></w:rubyBase></w:ruby></w:r><w:r><w:t>を立てた。</w:t></w:r></w:p>',
        ].join(''),
      }),
    )
    expect(paragraphs(result.body)).toEqual(['袖を長くし、衿を立てた。'])
  })

  it('グループ化した図形（画像とタイトルの枠をまとめたもの）も、1つの図として読む', async () => {
    const wpg = 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup'
    const caption = '<w:txbxContent><w:p><w:r><w:t>図1　デザイン画</w:t></w:r></w:p></w:txbxContent>'
    const group =
      '<w:r><mc:AlternateContent><mc:Choice Requires="wpg"><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
      '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:posOffset>100</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
      '<wp:extent cx="2000000" cy="3000000"/><wp:wrapNone/><wp:docPr id="99" name="グループ"/>' +
      `<a:graphic><a:graphicData uri="${wpg}"><wpg:wgp xmlns:wpg="${wpg}"><wpg:cNvGrpSpPr/><wpg:grpSpPr/>` +
      `<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="x"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid('a.png')}"/></pic:blipFill><pic:spPr/></pic:pic>` +
      `<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr/><wps:txbx>${caption}</wps:txbx><wps:bodyPr/></wps:wsp></wpg:wgp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>` +
      `<mc:Fallback><w:pict><v:group><v:shape><v:imagedata r:id="${rid('a.png')}"/></v:shape><v:shape><v:textbox>${caption}</v:textbox></v:shape></v:group></w:pict></mc:Fallback></mc:AlternateContent></w:r>`
    const result = await read(makeDocx({ media: { 'a.png': DESIGN }, body: [p('Ⅰ．企画・立案'), p('デザイン画を示す（図1）。'), p(group)].join('') }))
    expect(figureRows(result.body).map((r) => r.figures.map((f) => [f.caption, !!f.imageId]))).toEqual([[['デザイン画', true]]])
    expect(result.images).toHaveLength(1)
  })

  it('Word の新しい保存形式（Strict）でも読む', async () => {
    const result = await read(makeDocx({ strict: true, body: [p('Ⅰ．企画・立案'), p('段落である。')].join('') }))
    expect(result.body[0].title).toBe('企画・立案')
    expect(paragraphs(result.body)).toEqual(['段落である。'])
  })

  it('最初の大見出しより前の文は、名前のない大見出しに入れて知らせる。図形の中の文・脚注も知らせる', async () => {
    const result = await read(
      makeDocx({
        body: [
          p('はじめに書いた文である。'),
          p('Ⅰ．企画・立案'),
          p('段落である。', textBox('ここが袖口'), '<w:r><w:footnoteReference w:id="1"/></w:r>'),
        ].join(''),
      }),
    )
    expect(result.body.slice(0, 2).map((c) => c.title)).toEqual(['', '企画・立案'])
    expect(result.problems.map((x) => [x.message, x.where])).toEqual([
      ['最初の大見出しより前に、文があります', 'Ⅰ．（名前のない大見出し）'],
      ['図形の中の文字（「ここが袖口」）は写していません', 'Ⅱ．企画・立案'],
      ['脚注は写していません', 'Ⅱ．企画・立案'],
    ])
  })
})

describe.each(CONFIGS)('仮の文字だけの章（%s）', (_, ctx) => {
  it('書いていない章（「〇〇〇〇」「～～～」・ひな形にもとからある文・仮の画像だけ）は写さず、ひな形の章で続ける', async () => {
    const result = await read(
      makeDocx({
        body: [
          p('Ⅰ．企画・立案'),
          p('ⅰ．担当衣装のキャラクター'),
          p(`　筆者が担当したのは、${LONG_TILDE}`),
          p('ⅱ．デザイン説明'),
          p(`　${LONG_TILDE}（図1）。`),
          p('ⅲ．使用素材'),
          p('　表1に使用した素材をまとめる。'),
          table([
            ['名称', '使用箇所', '生地見本'],
            ['', '', ''],
          ]),
          p('Ⅱ．制作過程'),
          p('ⅰ．〇〇〇〇'),
          p(LONG_TILDE),
          p('Ⅲ．考察'),
          p('ⅰ．〇〇〇〇'),
          p(LONG_TILDE),
        ].join(''),
      }),
      undefined,
      ctx,
    )
    // Ⅲ「考察」は、ひな形にない名前の章なので、書いた章として写す（中の仮の小見出しは写さない）。
    // 同じ3番目のひな形の章（まとめ）の代わりに入れる（前は、いちばん前に入り、まとめも残って章が4つになっていた）
    expect(result.body.map((c) => c.title)).toEqual(['企画・立案', '制作過程', '考察'])
    expect(result.outline.map((o) => [o.title, !!o.fromTemplate])).toEqual([
      ['企画・立案', true],
      ['制作過程', true],
      ['考察', false],
    ])
    expect(result.problems.map((x) => [x.where, x.message])).toContainEqual(['Ⅲ．考察', 'ひな形の「まとめ」の章の代わりに、Word の「考察」の章を入れます'])
    // 「～～～（図1）。」「ⅰ．〇〇〇〇」「～～～」（Ⅱ）、「ⅰ．〇〇〇〇」「～～～」（Ⅲ）
    expect(result.skippedPlaceholders).toBe(5)
    expect(result.counts).toEqual({ chapters: 1, subheadings: 0, paragraphs: 0, figures: 0, tables: 0 })
  })

  it('どの章も書いていなければ、本文はツールのひな形になり、そのことを知らせる', async () => {
    const result = await read(makeDocx({ body: [p('Ⅰ．企画・立案'), p('ⅰ．〇〇〇〇'), p(LONG_TILDE)].join('') }), undefined, ctx)
    expect(result.body.map((c) => c.title)).toEqual(['企画・立案', '制作過程', 'まとめ'])
    expect(result.outline.every((o) => o.fromTemplate)).toBe(true)
    expect(result.problems.map((x) => x.message)).toEqual(['Word に書いた本文が見つかりませんでした'])
  })
})

describe('章の並び（Word で書いた章と、ツールのひな形の章）', () => {
  it('同じ名前・同じ番目で組にし、ひな形の順に並べる。組にならない Word の章は、前の章のすぐ後ろ', () => {
    const template = ['企画・立案', '制作過程', 'まとめ']
    const order = (word: [string, number][]) => {
      const { slots, renamed } = chapterOrder(
        word.map(([title, position]) => ({ title, position })),
        template,
      )
      return { slots: slots.map((s) => ('word' in s ? word[s.word][0] : `(${template[s.template]})`)), renamed: renamed.map((r) => `${word[r.word][0]}→${template[r.template]}`) }
    }
    // Ⅱ を書いていなければ、ひな形の Ⅱ は Ⅰ と Ⅲ の間に（前は、いちばん後ろに回っていた）
    expect(order([['企画・立案', 0], ['まとめ', 2]])).toEqual({ slots: ['企画・立案', '(制作過程)', 'まとめ'], renamed: [] })
    // 名前を変えた章は、同じ番目のひな形の章の代わりに
    expect(order([['企画・立案', 0], ['衣装の制作', 1]])).toEqual({ slots: ['企画・立案', '衣装の制作', '(まとめ)'], renamed: ['衣装の制作→制作過程'] })
    // 学生が足した章は、組にならず、前の章のすぐ後ろ
    expect(order([['企画・立案', 0], ['制作過程', 1], ['考察', 2], ['まとめ', 3]])).toEqual({ slots: ['企画・立案', '制作過程', '考察', 'まとめ'], renamed: [] })
    // 大見出しより前の部分（-1）は、いちばん前
    expect(order([['', -1], ['企画・立案', 0]])).toEqual({ slots: ['', '企画・立案', '(制作過程)', '(まとめ)'], renamed: [] })
    // 何も書いていなければ、ひな形のまま
    expect(order([])).toEqual({ slots: ['(企画・立案)', '(制作過程)', '(まとめ)'], renamed: [] })
  })

  it('Ⅰ・Ⅲ だけ書いたとき、ひな形の Ⅱ を間に入れ、確認の窓の場所も読み込んだあとの番号で出す', async () => {
    const result = await read(
      makeDocx({
        body: [
          p('Ⅰ．企画・立案'),
          p('　筆者が担当したのは、主人公のシンドバッドである。'),
          p('Ⅱ．制作過程'),
          p(LONG_TILDE),
          p('Ⅲ．まとめ'),
          p('　本制作では、舞台の上での見え方を考えた。'),
          // タイトルのない表（確認の窓に「表1のタイトルが見つかりませんでした」が出る。その場所の番号を確かめる）
          table([
            ['名称', '使用箇所'],
            ['綿ブロード', '上着'],
          ]),
        ].join(''),
      }),
    )
    expect(result.body.map((c) => c.title)).toEqual(['企画・立案', '制作過程', 'まとめ'])
    expect(result.outline.filter((o) => o.level === 1).map((o) => [o.title, !!o.fromTemplate])).toEqual([
      ['企画・立案', false],
      ['制作過程', true],
      ['まとめ', false],
    ])
    expect(result.problems.map((x) => [x.where, x.message])).toContainEqual(['Ⅲ．まとめ', '表1のタイトルが見つかりませんでした'])
  })

  it('先生がひな形の章の名前を変えていても、同じ番目の章として入れ、章が2つにならない（そのことを知らせる）', async () => {
    const config: YearConfig = {
      ...currentConfig,
      courses: currentConfig.courses.map((c) =>
        c.id === COURSE
          ? {
              ...c,
              template: [
                { type: 'chapter', title: '企画・立案' },
                { type: 'paragraph', hint: '企画を書く' },
                { type: 'chapter', title: '制作の流れ' },
                { type: 'paragraph', hint: '流れを書く' },
                { type: 'chapter', title: 'まとめ' },
                { type: 'paragraph', hint: 'まとめを書く' },
              ],
            }
          : c,
      ),
    }
    const result = await read(
      makeDocx({ body: [p('Ⅰ．企画・立案'), p('　筆者が担当したのは、主人公である。'), p('Ⅱ．制作過程'), p('　仮縫いを2回行った。'), p('Ⅲ．まとめ'), p(LONG_TILDE)].join('') }),
      undefined,
      { config, courseId: COURSE },
    )
    expect(result.body.map((c) => c.title)).toEqual(['企画・立案', '制作過程', 'まとめ'])
    expect(result.problems.map((x) => [x.where, x.message])).toContainEqual(['Ⅱ．制作過程', 'ひな形の「制作の流れ」の章の代わりに、Word の「制作過程」の章を入れます'])
  })

  it('ひな形に「〇〇〇〇」の小見出し・図があっても（学科の Word のひな形に合わせたもの）、Word の「〇〇〇〇」だけの行を見出しにしない', async () => {
    // 映画・舞台衣装デザイナーコースのひな形（依頼者の依頼 2026-10-22：学科の Word のひな形に合わせる。Ⅱ の小見出しは2つ）
    const template: TemplateBlock[] = [
      { type: 'chapter', title: '企画・立案' },
      { type: 'subheading', title: '担当衣装のキャラクター' },
      { type: 'paragraph', hint: '「筆者が担当したのは、」から書き始め、担当したキャラクターの性格や、物語の中での役割を書く' },
      { type: 'subheading', title: 'デザイン説明' },
      { type: 'paragraph', hint: 'デザインのもとにした時代・地域の装いと、込めた意図を書く。文中に「（図1）」と書く' },
      { type: 'figure', caption: 'デザイン画' },
      { type: 'subheading', title: '使用素材' },
      { type: 'paragraph', hint: '使った素材と使った場所を表1にまとめ、文中に「表1」と書く' },
      { type: 'materialTable', caption: '使用材料表' },
      { type: 'chapter', title: '制作過程' },
      { type: 'subheading', title: '〇〇〇〇' },
      { type: 'paragraph', hint: '小見出しの〇〇〇〇を作業の名前に直し、作った順に工夫した点を書く。写真は図として入れ、文中に「（図2）」と書く' },
      { type: 'figure', caption: '〇〇〇〇' },
      { type: 'figure', caption: '〇〇〇〇' },
      { type: 'subheading', title: '〇〇〇〇' },
      { type: 'paragraph', hint: '次の作業について書く。小見出しが足りなければ、道具の「小見出し」で足す' },
      { type: 'chapter', title: 'まとめ' },
      { type: 'paragraph', hint: '完成した衣装を振り返り、できたこと・課題を書く' },
    ]
    expect(templateProblems(template)).toEqual([])
    const config: YearConfig = { ...currentConfig, courses: currentConfig.courses.map((c) => (c.id === COURSE ? { ...c, template } : c)) }
    const result = await read(
      makeDocx({ body: [p('Ⅰ．企画・立案'), p('　筆者が担当したのは、主人公である。'), p('〇〇〇〇'), p('　衣装は青を基調にした。'), p('Ⅱ．制作過程'), p('ⅰ．〇〇〇〇'), p(LONG_TILDE)].join('') }),
      undefined,
      { config, courseId: COURSE },
    )
    expect(result.body.map((c) => c.title)).toEqual(['企画・立案', '制作過程', 'まとめ'])
    // 「〇〇〇〇」だけの行は見出しにせず、Ⅰ の段落も1つの章のまま
    expect(kinds(result.body[0]).filter((k) => k.startsWith('s:'))).toEqual([])
    // Ⅱ は書いていないので、ひな形の Ⅱ（〇〇〇〇 の小見出し2つと、図の枠2つ）が入る（ひな形の図の枠は、1つずつの行になる）
    expect(kinds(result.body[1])).toEqual(['s:〇〇〇〇', 'paragraph', 'figureRow', 'figureRow', 's:〇〇〇〇', 'paragraph'])
  })

  it('名前を入れていない大見出し（〇〇〇〇）の下に書いていれば、同じ番目のひな形の章の名前にする', async () => {
    const result = await read(makeDocx({ body: [p('Ⅰ．企画・立案'), p('　筆者が担当したのは、主人公である。'), p('Ⅱ．〇〇〇〇'), p('　仮縫いを2回行った。')].join('') }))
    expect(result.body.map((c) => c.title)).toEqual(['企画・立案', '制作過程', 'まとめ'])
    expect(paragraphs(result.body, 1)).toEqual(['仮縫いを2回行った。'])
    expect(result.problems.map((x) => [x.where, x.message])).toContainEqual(['Ⅱ．制作過程', '大見出しの名前を、ひな形の「制作過程」にしました'])
  })
})

describe('表紙', () => {
  /** 学科のひな形（01_表紙.docx）と同じく、表のセルに分けて書いた表紙 */
  const cover = (id: string, name: string, subtitle: string) =>
    makeDocx({
      body: [
        p(),
        table([
          ['２０２６年度'],
          ['卒 業 研 究'],
          ['', '研究題目', ''],
          ['', '卒業イベント「シンドバッド」について', ''],
          ['', subtitle, ''],
          ['', '国際文化学部・国際ファッション文化学科', ''],
          ['', '映画・舞台衣装デザイナー', 'コース'],
          ['', '学籍番号　', id],
          ['', '氏　　名', '：', name],
          ['', '文 化 学 園 大 学', ''],
        ]),
      ].join(''),
    })

  it('学籍番号（全角は半角・大文字に）・氏名・サブタイトル（コースの形から入れる部分だけ）を読む', async () => {
    const result = await read(templateLikeBody(), cover('００ｚｚ０１２３', '文化　花子', '―シンドバッドの衣装制作―'))
    expect(result.cover).toEqual({ studentId: '00ZZ0123', name: '文化　花子', subtitleInput: 'シンドバッド' })
    expect(result.problems).toEqual([])
  })

  it('1行に書いた表紙（「氏名：」の後ろ）、長音で打ったサブタイトルの線も読む', async () => {
    const result = await read(
      templateLikeBody(),
      makeDocx({ body: [p('学籍番号　00ZZ0123　氏名：文化　花子'), p('ージーニーの衣装制作ー')].join('') }),
    )
    expect(result.cover).toEqual({ studentId: '00ZZ0123', name: '文化　花子', subtitleInput: 'ジーニー' })
  })

  it('ひな形のまま（●●●）の項目は入れず、読み取れなかったことを知らせる', async () => {
    const result = await read(templateLikeBody(), cover('23FA●●●', '●●　●●●', '―●●●●の衣装制作―'))
    expect(result.cover).toEqual({})
    expect(result.problems).toEqual([expect.objectContaining({ message: '表紙の学籍番号・氏名・サブタイトルを読み取れませんでした', where: '表紙' })])
    // 読み取れなかった項目は、原稿の今の値のまま
    const report = createReport(currentConfig, COURSE)
    report.basicInfo.name = '文化　花子'
    expect(applyWordImport(report, result).basicInfo.name).toBe('文化　花子')
  })

  it('表紙に本文のファイルを選んだら知らせる', async () => {
    await expect(read(templateLikeBody(), templateLikeBody())).rejects.toThrow('表紙に選んだ「01_表紙.docx」は、表紙のファイルではないようです')
  })

  /** 公開中の設定の写し（コースが3つ）で読む。表紙のコースの欄だけを変えた表紙 */
  const threeCourses = { config: publishedConfig, courseId: publishedConfig.courses.find((c) => c.name.startsWith('スタイリスト'))!.id }
  const coverOf = (course: string, subtitle = '―シンドバッドの衣装制作―', id = '00ZZ0123', name = '文化　花子') =>
    makeDocx({
      body: table([
        ['２０２６年度'],
        ['', '研究題目', ''],
        ['', subtitle, ''],
        ['', course, 'コース'],
        ['', '学籍番号　', id],
        ['', '氏　　名', '：', name],
      ]),
    })

  it('表紙に書いたコースを読む（原稿のコースは変えない。違うかどうかは、確認の窓で学生が選ぶ）', async () => {
    const film = publishedConfig.courses.find((c) => c.name === '映画・舞台衣装デザイナー')!.id
    const result = await read(templateLikeBody(), coverOf('映画・舞台衣装デザイナー'), threeCourses)
    expect(result.coverCourseId).toBe(film)
    expect(result.cover).toEqual({ studentId: '00ZZ0123', name: '文化　花子', subtitleInput: 'シンドバッド' })
    // 同じコースでも、書いてあれば読む
    expect((await read(templateLikeBody(), coverOf('スタイリスト・コーディネーター'), threeCourses)).coverCourseId).toBe(threeCourses.courseId)
    // ひな形のまま（●●●）の表紙は、ひな形のコースが書いてあるだけなので、コースを読まない
    expect((await read(templateLikeBody(), coverOf('映画・舞台衣装デザイナー', '―●●●●の衣装制作―', '23FA●●●', '●●　●●●'), threeCourses)).coverCourseId).toBeUndefined()
    // コースの名前がなければ省く
    expect((await read(templateLikeBody(), coverOf('〇〇〇〇'), threeCourses)).coverCourseId).toBeUndefined()
    // 表紙を選ばなければ省く
    expect((await read(templateLikeBody(), undefined, threeCourses)).coverCourseId).toBeUndefined()
  })

  it('サブタイトルがコースの決まった形と合わないときは、Word の行を知らせ、線を除いた中身を入れる（決まった文句を二重にしない）', async () => {
    const off = await read(templateLikeBody(), coverOf('映画・舞台衣装デザイナー', '―主人公のスタイリング提案―'))
    expect(off.cover.subtitleInput).toBe('主人公のスタイリング提案')
    expect(off.subtitleOffForm).toBe('―主人公のスタイリング提案―')
    // 合っていれば省く
    const fits = await read(templateLikeBody(), coverOf('映画・舞台衣装デザイナー', '―シンドバッドの衣装制作―'))
    expect(fits.subtitleOffForm).toBeUndefined()
    // 「の衣装制作」まで書いた行を「の制作」のコースで読むと、合わない（そのまま入れて、知らせる）
    const producer = { config: publishedConfig, courseId: publishedConfig.courses.find((c) => c.subtitleTemplate === '―{input}の制作―')!.id }
    const other = await read(templateLikeBody(), coverOf('プロデューサー・ジャーナリスト', '―海の王女の衣装制作―'), producer)
    expect(other.cover.subtitleInput).toBe('海の王女の衣装制作')
    expect(other.subtitleOffForm).toBe('―海の王女の衣装制作―')
  })

  it('サブタイトルの行から、入れる部分を取り出す（決まった形の前後は、合っている所だけを取る）', () => {
    expect(subtitleFromWord('―シンドバッドの衣装制作―', '―{input}の衣装制作―')).toEqual({ input: 'シンドバッド', fits: true })
    expect(subtitleFromWord('ーシンドバッドの衣装制作ー', '―{input}の衣装制作―')).toEqual({ input: 'シンドバッド', fits: true })
    expect(subtitleFromWord('―主人公のスタイリング提案―', '―{input}の衣装制作―')).toEqual({ input: '主人公のスタイリング提案', fits: false })
    expect(subtitleFromWord('―海の王女―', '―{input}―')).toEqual({ input: '海の王女', fits: true })
    // 決まった文句だけの行（入れる部分がない）は、取らずに残す
    expect(subtitleFromWord('―の衣装制作―', '―{input}の衣装制作―')).toEqual({ input: 'の衣装制作', fits: false })
  })

  it('写すときに、表紙の Word のコースに変えられる（本文は読み込んだ本文のまま。抄録をまだ書いていなければ、書き出しの例もそのコースのものに）', async () => {
    const film = publishedConfig.courses.find((c) => c.name === '映画・舞台衣装デザイナー')!.id
    const result = await read(templateLikeBody(), coverOf('映画・舞台衣装デザイナー'), { config: publishedConfig, courseId: film })
    const report = createReport(publishedConfig, threeCourses.courseId)
    const switched = applyWordImport(report, result, { courseId: film, config: publishedConfig })
    expect(switched.basicInfo.courseId).toBe(film)
    expect(switched.body).toBe(result.body)
    expect(switched.basicInfo.name).toBe('文化　花子')
    // コースを変えないとき（今のコースのまま・同じコース）は、今までどおり
    expect(applyWordImport(report, result).basicInfo.courseId).toBe(threeCourses.courseId)
    expect(applyWordImport(report, result, { courseId: threeCourses.courseId, config: publishedConfig }).abstract).toBe(report.abstract)
  })
})

describe('読めないファイル', () => {
  const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0])

  it('Word 97-2003 の形（.doc）は、学生に分かる言葉で知らせる', async () => {
    const error = await readWordFiles({ body: file(OLE, '04_本文.doc') }, context).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WordImportError)
    expect((error as Error).message).toBe(
      '本文に選んだ「04_本文.doc」は Word 97-2003 の形（.doc）のため読めません。Word で開いて「名前を付けて保存」で「Word 文書（*.docx）」にしてから選んでください。',
    )
    // .docx なのにこの形：パスワードがかかっている
    await expect(readWordFiles({ body: file(OLE, '04_本文.docx') }, context)).rejects.toThrow('パスワードがかかっているか')
  })

  it('Word でないファイル・壊れたファイル・空のファイル・表紙や目次を本文に選んだとき', async () => {
    const text = (s: string) => new TextEncoder().encode(s)
    await expect(readWordFiles({ body: file(text('%PDF-1.7'), 'a.pdf') }, context)).rejects.toThrow('PDF のため読めません')
    await expect(readWordFiles({ body: file(text('hello'), 'a.txt') }, context)).rejects.toThrow('Word のファイル（.docx）ではないため読めません')
    await expect(readWordFiles({ body: file(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), 'a.docx') }, context)).rejects.toThrow('ファイルが壊れている')
    await expect(readWordFiles({ body: file(new Uint8Array(), 'a.docx') }, context)).rejects.toThrow('空のファイル')
    await expect(readWordFiles({ body: file(zipSync({ 'a.txt': text('x') }), 'a.docx') }, context)).rejects.toThrow('Word のファイル（.docx）ではない')
    await expect(read(makeDocx({ body: p() }))).rejects.toThrow('何も書かれていません')
    await expect(read(makeDocx({ body: [p('目次'), p('Ⅰ．企画・立案・・・・1')].join('') }))).rejects.toThrow('目次のファイルのようです')
    await expect(read(makeDocx({ body: table([['研究題目'], ['学籍番号', '00ZZ0123']]) }))).rejects.toThrow('表紙のファイルのようです')
  })
})

describe('画像', () => {
  it('形と大きさをファイルの頭から読む', () => {
    expect(imageInfo(png(30, 20))).toEqual({ kind: 'png', width: 30, height: 20 })
    expect(imageInfo(emfHeader()).kind).toBe('emf')
    expect(imageInfo(new Uint8Array([0x49, 0x49, 0x2a, 0])).kind).toBe('tiff')
  })

  it('大きすぎる画像は長い辺 1600px まで縮め、Word の切り抜きのとおりに切り抜く', async () => {
    const drawn: number[][] = []
    ;(globalThis as Record<string, unknown>).createImageBitmap = async () => ({ width: 4000, height: 3000, close() {} })
    ;(globalThis as Record<string, unknown>).OffscreenCanvas = class {
      width: number
      height: number
      constructor(width: number, height: number) {
        this.width = width
        this.height = height
      }
      getContext() {
        return { fillRect() {}, drawImage: (...args: number[]) => drawn.push(args.slice(1)), fillStyle: '' }
      }
      async convertToBlob() {
        return new Blob(['jpeg'], { type: 'image/jpeg' })
      }
    }
    const whole = await prepareImage(png(4, 3), 'img-1')
    expect(whole).toMatchObject({ id: 'img-1', widthPx: 1600, heightPx: 1200 })
    // 左右を 25% ずつ切り抜く：2000×3000 → 1067×1600
    const cropped = await prepareImage(png(4, 3), 'img-2', { left: 0.25, right: 0.25, top: 0, bottom: 0 })
    expect(cropped).toMatchObject({ widthPx: 1067, heightPx: 1600 })
    expect(drawn[1]).toEqual([1000, 0, 2000, 3000, 0, 0, 1067, 1600])
  })
})

describe.each(CONFIGS)('通しテスト用の見本（scripts/e2e/fixtures/word-sample-*.docx。%s）', (_, ctx) => {
  it('読み込むと、大見出し1・小見出し3・段落3・図2・表1、表紙は 00ZZ0123・文化　花子・シンドバッド', async () => {
    const dir = 'scripts/e2e/fixtures'
    const result = await read(fs.readFileSync(`${dir}/word-sample-body.docx`), fs.readFileSync(`${dir}/word-sample-cover.docx`), ctx)
    expect(result.counts).toEqual({ chapters: 1, subheadings: 3, paragraphs: 3, figures: 2, tables: 1 })
    expect(result.body.map((c) => c.title)).toEqual(['企画・立案', '制作過程', 'まとめ'])
    expect(result.cover).toEqual({ studentId: '00ZZ0123', name: '文化　花子', subtitleInput: 'シンドバッド' })
    expect(result.figures.map((f) => [f.label, f.caption, !!f.imageId])).toEqual([
      ['図1', 'デザイン画（前）', true],
      ['図2', 'デザイン画（後ろ）', true],
    ])
    expect(result.tables).toEqual([{ label: '表1', caption: '使用材料表', rows: 3 }])
    expect(result.images.map((i) => [i.widthPx, i.heightPx])).toEqual([
      [240, 320],
      [240, 320],
    ])
    expect(result.skippedPlaceholders).toBe(5)
    expect(result.problems).toEqual([])
  })
})

/** 手元にある学科のひな形・学生の Word（公開の場所にはない。ないときは飛ばす） */
const TEMPLATE_BODY = '../04_本文.docx'
const TEMPLATE_COVER = '../01_表紙.docx'
const STUDENT_DIR = '../試し用_学生のWord'

describe.skipIf(!fs.existsSync(TEMPLATE_BODY)).each(CONFIGS)('学科のひな形（手元の 04_本文.docx・01_表紙.docx。%s）', (_, ctx) => {
  it('ひな形のままなら、どの章も写さず、ツールのひな形の本文になる', async () => {
    const result = await readWordFiles(
      { body: new File([fs.readFileSync(TEMPLATE_BODY).slice()], '04_本文.docx'), ...(fs.existsSync(TEMPLATE_COVER) ? { cover: new File([fs.readFileSync(TEMPLATE_COVER).slice()], '01_表紙.docx') } : {}) },
      ctx,
    )
    expect(result.body.map((c) => c.title)).toEqual(['企画・立案', '制作過程', 'まとめ'])
    expect(result.outline.every((o) => o.fromTemplate)).toBe(true)
    expect(result.counts).toEqual({ chapters: 0, subheadings: 0, paragraphs: 0, figures: 0, tables: 0 })
    expect(result.images).toEqual([])
    expect(result.skippedPlaceholders).toBeGreaterThan(0)
    expect(result.skippedPlaceholders).toBe(6)
    expect(result.problems.map((x) => x.message)).toEqual([
      'Word に書いた本文が見つかりませんでした',
      ...(fs.existsSync(TEMPLATE_COVER) ? ['表紙の学籍番号・氏名・サブタイトルを読み取れませんでした'] : []),
    ])
    if (fs.existsSync(TEMPLATE_COVER)) expect(result.cover).toEqual({})
  })
})

const studentFiles = fs.existsSync(STUDENT_DIR) ? fs.readdirSync(STUDENT_DIR).filter((n) => /\.docx$/i.test(n) && !n.startsWith('~$')) : []

describe.skipIf(studentFiles.length === 0)('学生の Word（手元の 試し用_学生のWord）', () => {
  it.each(studentFiles)('%s を読める（読めないときは、学生に分かる言葉で知らせる）', async (name) => {
    const bytes = fs.readFileSync(`${STUDENT_DIR}/${name}`)
    let result: WordImportResult
    try {
      result = await readWordFiles({ body: new File([bytes.slice()], name) }, context)
    } catch (e) {
      // 表紙のファイルなら、表紙として読む
      expect(e).toBeInstanceOf(WordImportError)
      if (!String((e as Error).message).includes('表紙のファイル')) throw e
      const cover = await readWordFiles({ body: new File([templateLikeBody().slice()], '04_本文.docx'), cover: new File([bytes.slice()], name) }, context)
      expect(Object.keys(cover.cover).length).toBeGreaterThan(0)
      return
    }
    expect(result.body.length).toBeGreaterThan(0)
    // 図表の番号・つながりが壊れていない（つながりの先がある）
    const num = numbering({ body: result.body })
    for (const b of result.body.flatMap((c) => c.blocks)) {
      if (b.type === 'paragraph') for (const n of b.content) if (n.type === 'ref') expect(num.numbers.has(n.targetId)).toBe(true)
    }
    const used = new Set(result.images.map((i) => i.id))
    for (const f of result.figures) if (f.imageId) expect(used.has(f.imageId)).toBe(true)
  })
})
