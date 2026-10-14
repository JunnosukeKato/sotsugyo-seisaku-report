// 通しテスト用の見本の Word（「Wordから読み込む」と「提出前チェック」で使う）と、その PDF を作る。中身は架空（文化 花子・00ZZ0123・「―シンドバッドの衣装制作―」）。
// 学科のひな形（04_本文.docx・01_表紙.docx・02_抄録.docx・03_目次.docx）と同じつくりにする：
// - 本文：1章ぶん（Ⅰ．企画・立案）を書き、2章（Ⅱ．制作過程）はひな形のまま（「〇〇〇〇」「～～～」）。
//   図は2枚（浮かせた画像を横に並べ、タイトルは文字の枠「図1 …」）、表は1つ（タイトルは文字の枠「表1 …」）
// - 表紙：表のセルに分けて書いた旧形式（「卒 業 研 究」「研究題目」）
// - 抄録（提出前チェック用）：上の決まった行と、本文の段落（字数は 600字に足りない。「ました」が1つある）
// - 目次（提出前チェック用）：本文にない「Ⅲ．まとめ」がある。余白の左を 30mm にしてある（ひな形と違う、の確かめ）
// 読み込むと：大見出し1・小見出し3・段落3・図2・表1、ひな形から「制作過程」「まとめ」が続く。仮の文字だけの行は5行
// ページ設定（余白・文字数と行数）と「標準」の文字の大きさは、学科のひな形と同じ（目次の左の余白だけ違う）
//
// PDF（提出前チェック用）は、Word から保存した PDF の代わりに、同じ文の HTML を Edge で PDF にしたもの（A4・余白はひな形と同じ）。
// 本文は3ページ（下にページ番号）。書体は BIZ UD 明朝（@fontsource。外のサイトからは読まない）
// 使い方: node scripts/e2e/fixtures/make-word-sample.mjs（EDGE_PORT で Edge のポートを変えられる）
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { withEdge } from '../../poc/edge.mjs'
import { floatingImage, makeDocx, normalStyle, p, pageBreak, png, rid, sectPr, table, textBox } from './docx.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const TILDES = '～'.repeat(60)

const front = png(240, 320, { figure: [47, 62, 117] })
const back = png(240, 320, { figure: [140, 60, 50] })

// ---- 本文 ----
const BODY = {
  ch1: 'Ⅰ．企画・立案',
  s1: 'ⅰ．担当衣装のキャラクター',
  p1: '　筆者が担当したのは、主人公のシンドバッドである。シンドバッドは七つの海を旅する船乗りで、明るく好奇心の強い人物として描かれている。物語の中では、困難に出会っても知恵と勇気で乗り越える役割を担う。',
  s2: 'ⅱ．デザイン説明',
  p2: '　デザインは、中世のペルシャの船乗りの装いをもとにした（図1）。動きやすさを考えて上着は短い丈にし、腰には幅の広い帯を巻いた。後ろ姿では、帯の結び目が見えるようにした（図2）。',
  cap1: '図1　デザイン画（前）',
  cap2: '図2　デザイン画（後ろ）',
  s3: 'ⅲ．使用素材',
  tcap: '表1　使用材料表',
  p3: '　表1に使用した素材をまとめる。',
  rows: [
    ['名称', '使用箇所', '生地見本'],
    ['綿ブロード', '上着', ''],
    ['サテン', '帯', ''],
    ['麻', 'ズボン', ''],
    ['', '', ''],
    ['', '', ''],
    ['', '', ''],
  ],
  ch2: 'Ⅱ．制作過程',
}

const body = makeDocx({
  media: { 'image1.png': front, 'image2.png': back },
  styles: normalStyle(22),
  sectPr: sectPr(),
  body: [
    p(BODY.ch1),
    p(BODY.s1),
    p(BODY.p1),
    p(),
    p(BODY.s2),
    p(BODY.p2),
    // ひな形と同じく、空の段落に浮かせた画像を2枚並べ、下の段落にタイトルの文字の枠を2つ置く
    p(floatingImage(rid('image1.png'), { x: 702473, cx: 1447165, cy: 2045970 }), floatingImage(rid('image2.png'), { x: 3014508, cx: 1447165, cy: 2045970 })),
    p(),
    p(),
    p(),
    p(textBox(BODY.cap1, { x: 53503 }), textBox(BODY.cap2, { x: 2365538 }), pageBreak),
    p(BODY.s3),
    p(textBox(BODY.tcap, { x: 1412875, y: 46990 }), BODY.p3),
    p(),
    table(BODY.rows),
    p(pageBreak),
    p(BODY.ch2),
    p('ⅰ．〇〇〇〇'),
    p(`　${TILDES}（図3）。`),
    p(`${TILDES}（図4）。`),
    p(),
    p('ⅱ．〇〇〇〇'),
    p(TILDES),
  ].join(''),
})

// ---- 表紙 ----
const cover = makeDocx({
  sectPr: sectPr({ margins: [1418, 1418, 1418, 1418], grid: null }),
  body: [
    p(),
    table([
      [''],
      ['２０２６年度'],
      [''],
      ['卒 業 研 究'],
      ['', '研究題目', ''],
      ['', '卒業イベント「シンドバッド」について', ''],
      ['', '―シンドバッドの衣装制作―', ''],
      ['', '国際文化学部・国際ファッション文化学科', ''],
      ['', '映画・舞台衣装デザイナー', 'コース'],
      ['', '学籍番号　', '00ZZ0123'],
      ['', '氏　　名', '：', '文化　花子'],
      ['', '文 化 学 園 大 学', ''],
    ]),
    p(),
  ].join(''),
})

// ---- 抄録（字数は 600字に足りない。2段落目に「ました」がある） ----
const ABSTRACT = {
  head: ['2026年度　卒業研究　抄録', '国際文化学部　国際ファッション文化学科　映画・舞台衣装デザイナーコース', '学籍番号　00ZZ0123　氏名　文化　花子', '（指導教員　梶田　貴子、佐藤　綾、加藤　淳之介）', '卒業イベント「シンドバッド」について', '―シンドバッドの衣装制作―'],
  body: [
    '　本制作報告書は、卒業イベント「シンドバッド」において、筆者が制作したシンドバッドの衣装についてである。シンドバッドは七つの海を旅する船乗りで、明るく好奇心の強い人物である。',
    '　デザインは、中世のペルシャの船乗りの装いをもとにした。動きやすさを考えて上着は短い丈にし、腰には幅の広い帯を巻きました。素材には綿ブロードとサテンと麻を使い、舞台の照明の下で色が沈まないように、帯には光沢のある生地を選んだ。',
    '　制作では、型紙を三度作り直し、仮縫いで腕の動きを確かめた。完成した衣装は、舞台の上で大きく動いても形が崩れず、物語の明るさを伝えることができた。今後は、装飾の手間を減らす工夫を学びたい。',
  ],
}
const abstract = makeDocx({
  styles: normalStyle(21),
  sectPr: sectPr({ grid: [460, 527] }),
  body: [...ABSTRACT.head.map((t) => p(t)), p(), ...ABSTRACT.body.map((t) => p(t))].join(''),
})

// ---- 目次（本文にない「Ⅲ．まとめ」がある。左の余白を 30mm にしてある） ----
const TOC = ['目次', '', 'Ⅰ．企画・立案・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・1', 'ⅰ．担当衣装のキャラクター', 'ⅱ．デザイン説明', 'ⅲ．使用素材', 'Ⅱ．制作過程・・・・・・・・・・・・・・・・・・・・・・・・・・・・・3', 'Ⅲ．まとめ・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・・3']
const toc = makeDocx({ styles: normalStyle(22), sectPr: sectPr({ margins: [1418, 1418, 1418, 1701] }), body: TOC.map((t) => p(t)).join('') })

writeFileSync(join(here, 'word-sample-body.docx'), body)
writeFileSync(join(here, 'word-sample-cover.docx'), cover)
writeFileSync(join(here, 'word-sample-abstract.docx'), abstract)
writeFileSync(join(here, 'word-sample-toc.docx'), toc)
console.log(`word-sample-body.docx（${body.length}）・cover（${cover.length}）・abstract（${abstract.length}）・toc（${toc.length} バイト）を作りました`)

// ---- PDF（Word から保存した PDF の代わり） ----

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const dataUrl = (bytes) => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`
const page = (inner, cls = '') => `<section class="page ${cls}">${inner}</section>`
const CSS = `
  @page { size: A4; margin: 25mm 25mm 25mm 35mm; }
  body { margin: 0; font-family: 'BIZ UDMincho', serif; font-size: 11pt; line-height: 18.4pt; }
  .page { break-after: page; }
  .page:last-child { break-after: auto; }
  p { margin: 0; }
  h1, h2 { margin: 0; font: inherit; }
  .cover { text-align: center; padding-top: 20mm; }
  .cover .year { font-size: 22pt; line-height: 1.6; }
  .cover .big { font-size: 40pt; line-height: 1.6; margin: 12mm 0; letter-spacing: 0.3em; }
  .cover .title { font-size: 22pt; line-height: 1.6; margin-top: 8mm; }
  .cover .sub { font-size: 20pt; line-height: 1.6; }
  .cover .info { font-size: 16pt; line-height: 2; margin-top: 20mm; }
  .cover .univ { font-size: 22pt; margin-top: 20mm; }
  .abstract { font-size: 10.5pt; line-height: 23pt; }
  .abstract .h { font-size: 10pt; }
  .abstract .h1 { font-size: 14pt; text-align: center; }
  .abstract .t { font-size: 14pt; text-align: center; }
  .abstract .s { font-size: 12pt; text-align: center; }
  .toc p { white-space: nowrap; overflow: hidden; }
  .toc .l2 { padding-left: 2em; }
  figure { margin: 6mm 0; display: flex; justify-content: center; gap: 12mm; }
  figure div { text-align: center; }
  figure img { width: 38mm; display: block; margin: 0 auto 2mm; }
  table { border-collapse: collapse; margin: 3mm auto; }
  td { border: 1px solid #000; padding: 1mm 4mm; width: 40mm; height: 8mm; }
  .cap { text-align: center; }
`
const PAGES = {
  cover: page(
    `<p class="year">2026年度</p><p class="big">卒業研究</p><p>研究題目</p><p class="title">卒業イベント「シンドバッド」について</p><p class="sub">―シンドバッドの衣装制作―</p>` +
      `<div class="info"><p>国際文化学部・国際ファッション文化学科</p><p>映画・舞台衣装デザイナーコース</p><p>学籍番号　00ZZ0123</p><p>氏名：文化　花子</p></div><p class="univ">文化学園大学</p>`,
    'cover',
  ),
  abstract: page(
    `<p class="h1">${esc(ABSTRACT.head[0])}</p>${ABSTRACT.head.slice(1, 4).map((t) => `<p class="h">${esc(t)}</p>`).join('')}<p class="t">${esc(ABSTRACT.head[4])}</p><p class="s">${esc(ABSTRACT.head[5])}</p><p>&nbsp;</p>` +
      ABSTRACT.body.map((t) => `<p>${esc(t)}</p>`).join(''),
    'abstract',
  ),
  toc: page(TOC.map((t) => `<p class="${/^[ⅰ-ⅹ]/.test(t) ? 'l2' : ''}">${t ? esc(t) : '&nbsp;'}</p>`).join(''), 'toc'),
  body:
    page(
      `<h1>${BODY.ch1}</h1><h2>${BODY.s1}</h2><p>${BODY.p1}</p><h2>${BODY.s2}</h2><p>${BODY.p2}</p>` +
        `<figure><div><img src="${dataUrl(front)}"><span>${BODY.cap1}</span></div><div><img src="${dataUrl(back)}"><span>${BODY.cap2}</span></div></figure>`,
    ) +
    page(`<h2>${BODY.s3}</h2><p class="cap">${BODY.tcap}</p><p>${BODY.p3}</p><table>${BODY.rows.slice(0, 4).map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`) +
    page(`<h1>${BODY.ch2}</h1><h2>ⅰ．〇〇〇〇</h2><p>${TILDES}（図3）。</p>`),
}

// 書体（@fontsource）は、この見本を作るときだけ、手元のファイルから渡す（外のサイトには取りに行かない）
const FONT_DIR = resolve(here, '../../../node_modules/@fontsource/biz-udmincho')
const ORIGIN = 'http://sample.test'
const FOOTER = `<div style="width:100%;text-align:center;font-size:10pt;font-family:serif;"><span class="pageNumber"></span></div>`

await withEdge(async (browser) => {
  const tab = await browser.newPage()
  await tab.setRequestInterception(true)
  let html = ''
  tab.on('request', (req) => {
    const url = req.url()
    if (url === `${ORIGIN}/doc.html`) return req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
    if (url.startsWith(`${ORIGIN}/font/`)) {
      const file = join(FONT_DIR, decodeURIComponent(url.slice(`${ORIGIN}/font/`.length)))
      return req.respond({ status: 200, contentType: file.endsWith('.css') ? 'text/css' : 'font/woff2', body: readFileSync(file) })
    }
    if (url.startsWith('data:')) return req.continue()
    return req.abort()
  })
  for (const [name, inner] of Object.entries(PAGES)) {
    html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><link rel="stylesheet" href="${ORIGIN}/font/400.css"><style>${CSS}</style></head><body>${inner}</body></html>`
    await tab.goto(`${ORIGIN}/doc.html`, { waitUntil: 'networkidle0' })
    await tab.evaluate(() => document.fonts.ready)
    const pdf = await tab.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      // 本文だけ、下にページ番号を付ける（ひな形の本文と同じ。表紙・抄録・目次には付けない）
      displayHeaderFooter: name === 'body',
      headerTemplate: '<span></span>',
      footerTemplate: FOOTER,
    })
    writeFileSync(join(here, `word-sample-${name}.pdf`), pdf)
    console.log(`word-sample-${name}.pdf（${pdf.length} バイト）を作りました`)
  }
})
