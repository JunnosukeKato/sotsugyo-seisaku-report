// デザイン案 v26（学生用の使い方の手引きを軽く・枚数を少なく：案C1 両面1枚／案C2 片面1枚）の見本を作る。
//   1. pdf    … 案ごとの HTML（mockups/v26/c1.html・c2.html。手で書く）を Edge で PDF にし（mockups/v26/c1.pdf など）、
//               PDF をページごとの画像にする（mockups/v26/shots/c1-1.png など。白黒は c1-1-gray.png）。
//               ページごとの文字数（日本語の字。記号の「」。なども数える）・用紙からのはみ出し・いちばん小さい文字の大きさも確かめる
//   2. review … 案を並べた一覧のページ（mockups/v26/review.html。文字数は 1 で測ったもの）を作り、画像にする（mockups/v26/shots/review.png）
// 使い方: node scripts/mockup-shots-v26.mjs [pdf] [review]（何も付けなければ両方。開発サーバーが http://localhost:5173 で動いていること）
//   画面の画像は、手引きの本番と同じもの（docs/guide-images/g-*.jpg。node scripts/make-guides.mjs で撮る）を使う。撮り直さない
//   Edge は EDGE_PORT（ふだんは 9380）で起動する。同じフォルダの教員用の案（t-*.html）には触らない
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

// ほかの確かめと同時に動かしても Edge がぶつからないよう、別のポートを使う（edge.mjs は読み込んだときにポートを決めるので、先に決める）
process.env.EDGE_PORT ??= '9380'
const { withEdge } = await import('./poc/edge.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const V = 'mockups/v26'
const SHOTS = `${V}/shots`
mkdirSync(SHOTS, { recursive: true })
const ARGS = process.argv.slice(2)
const want = (k) => ARGS.length === 0 || ARGS.includes(k)

/** 案ごとの名前と、1ページの文字数の目安 */
// （はじめに作りかけた案A「1ページ1つのこと」a.html は、依頼者の判断で見送り。ここでは作らない）
const DESIGNS = [
  { key: 'c1', name: '案C1「両面1枚」', note: '表：はじめてから提出までの5つの手順（写真つき）と URL・QR。裏：保存（共用のパソコン）と困ったとき6つ、先生に相談', limit: 300 },
  {
    key: 'c2',
    name: '案C2「片面1枚」',
    note: '1ページに URL・QR、5つの手順（1行ずつ・小さな写真）、保存と共用のパソコン、困ったとき3つ、先生に相談',
    help: 'ヘルプができたら：ツールに「？（使い方）」の欄と、はじめて開いたときの案内（指さしのツアー）を足す前提の案です。紙から外した説明（端末ごとの PDF の保存のしかた、別の端末・2つのタブ・控えから戻すなどの困ったとき、セルフチェックの見方、抄録の許可、図・表の入れ方）は、その「？」の中に入れます。',
    limit: 350,
  },
]
/** 本文の文字の大きさの下限（pt）。柱・ページ番号・英字の飾りの見出し・画像の上の番号は除く */
const MIN_PT = 10.5
const MIN_EXEMPT = '.folio, .edge, .hero-top, .kick2, .year, .shot .mk'
/** 数える字：ひらがな・カタカナ・漢字と、全角の記号（「」。、など）。英数字・URL は数えない */
const JP = /[　-ヿ一-鿿＀-￯]/g

async function makePdfs(browser) {
  const results = {}
  // まだ作っていない案は飛ばす
  for (const d of DESIGNS.filter((d) => existsSync(`${V}/${d.key}.html`))) {
    const page = await browser.newPage()
    const failed = []
    page.on('pageerror', (e) => failed.push(`ページのエラー：${e.message}`))
    page.on('requestfailed', (r) => failed.push(`読み込めなかったもの：${r.url()}`))
    await page.setViewport({ width: 1000, height: 1200 })
    await page.emulateMediaType('print')
    await page.goto(pathToFileURL(resolve(`${V}/${d.key}.html`)).href, { waitUntil: 'networkidle0' })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForFunction(() => document.body.dataset.ready === 'true', { timeout: 30000 })
    const check = await page.evaluate(
      (exempt, jp) => {
        const re = new RegExp(jp, 'g')
        const sheets = [...document.querySelectorAll('.sheet')]
        const pages = sheets.map((s, i) => {
          const r = s.getBoundingClientRect()
          let worst = { px: 0, who: '' }
          for (const e of s.querySelectorAll('*')) {
            if (e.closest('.bleed, svg')) continue
            const q = e.getBoundingClientRect()
            if (!q.width || !q.height) continue
            const px = Math.max(q.bottom - r.bottom, q.right - r.right, r.left - q.left)
            if (px > worst.px) worst = { px: Math.round(px), who: `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}「${e.textContent.trim().slice(0, 14)}」` }
          }
          return { page: i + 1, chars: (s.innerText.match(re) ?? []).length, over: worst }
        })
        let min = { pt: 99, who: '' }
        const small = []
        for (const e of document.querySelectorAll('.sheet *')) {
          if (e.closest('svg') || e.closest(exempt)) continue
          if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue
          const pt = Math.round(parseFloat(getComputedStyle(e).fontSize) * 0.75 * 10) / 10
          const who = `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}「${e.textContent.trim().slice(0, 12)}」`
          if (pt < min.pt) min = { pt, who }
          if (pt < 10.5) small.push(`${pt}pt ${who}`)
        }
        const missing = [...document.querySelectorAll('figure[data-shot]')].filter((f) => !f.querySelector('img')).map((f) => f.dataset.shot)
        const images = [...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.getAttribute('src'))
        return { pages, min, small, missing, images }
      },
      MIN_EXEMPT,
      JP.source,
    )
    const pdf = `${V}/${d.key}.pdf`
    await page.pdf({ path: pdf, printBackground: true, preferCSSPageSize: true })
    await page.close()
    const doc = await getDocument({ data: new Uint8Array(readFileSync(pdf)), useSystemFonts: false, verbosity: 0 }).promise
    const problems = [...failed]
    if (doc.numPages !== check.pages.length) problems.push(`PDF のページ数（${doc.numPages}）が、HTML のページ数（${check.pages.length}）と違います`)
    for (const p of check.pages) if (p.over.px > 0) problems.push(`${p.page}ページ：用紙から ${p.over.px}px はみ出しています（${p.over.who}）`)
    for (const p of check.pages) if (p.chars > d.limit) problems.push(`${p.page}ページ：${p.chars}字（目安 ${d.limit}字まで）`)
    if (check.small.length) problems.push(`${MIN_PT}pt より小さい文字：${check.small.slice(0, 6).join('　')}`)
    if (check.missing.length) problems.push(`画面の画像がありません：${check.missing.join(', ')}`)
    if (check.images.length) problems.push(`読み込めなかった画像：${check.images.join(', ')}`)
    console.log(`  ${pdf}（${doc.numPages}ページ）文字数：${check.pages.map((p) => p.chars).join('・')}字　いちばん小さい文字 ${check.min.pt}pt（${check.min.who}）`)
    for (const p of problems) console.log(`！ ${d.key}：${p}`)
    if (problems.length) process.exitCode = 1

    // PDF をページごとの画像にする（scripts/poc/pdf-shots.mjs と同じ、pdf.js で描いたもの）。白黒で印刷したときの見え方も作る
    const view = await browser.newPage()
    await view.setViewport({ width: 1300, height: 1800, deviceScaleFactor: 1 })
    await view.goto(`${APP}/poc-pdf.html?file=${encodeURIComponent(pdf)}&scale=1.4`, { waitUntil: 'networkidle0' })
    await view.waitForFunction(() => document.body.dataset.rendered === 'true', { timeout: 120000 })
    const canvases = await view.$$('canvas')
    for (const [i, c] of canvases.entries()) await c.screenshot({ path: `${SHOTS}/${d.key}-${i + 1}.png` })
    await view.addStyleTag({ content: 'canvas { filter: grayscale(1); }' })
    for (const [i, c] of canvases.entries()) await c.screenshot({ path: `${SHOTS}/${d.key}-${i + 1}-gray.png` })
    console.log(`  ${SHOTS}/${d.key}-1〜${canvases.length}.png（白黒：-gray.png）`)
    await view.close()
    results[d.key] = { pages: doc.numPages, chars: check.pages.map((p) => p.chars), minPt: check.min.pt }
  }
  writeFileSync(`${SHOTS}/counts.json`, JSON.stringify(results, null, 1))
  return results
}

/** 3案を並べた一覧のページ（ページの画像と、ページごとの文字数） */
function writeReview(results) {
  const now = [320, 726, 907, 760]
  const col = (d) => {
    const r = results[d.key]
    const total = r.chars.reduce((a, b) => a + b, 0)
    return `<section class="col">
  <h2>${d.name}</h2>
  <p class="meta"><b>${r.pages}ページ</b>　ページごとの文字数 <b>${r.chars.join('・')}</b>（合計 ${total}字・目安 ${d.limit}字まで）　本文の文字 ${r.minPt}pt 以上</p>
  <p class="note">${d.note}</p>${d.help ? `
  <p class="help">${d.help}</p>` : ''}
  <div class="pages">${r.chars.map((c, i) => `<figure><img src="shots/${d.key}-${i + 1}.png" alt=""><figcaption>${i + 1}ページ　${c}字</figcaption></figure>`).join('')}</div>
</section>`
  }
  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>v26 学生用の手引きを1枚に（2案）</title>
<!-- node scripts/mockup-shots-v26.mjs review で作る（手で直さない） -->
<link rel="stylesheet" href="../../node_modules/@fontsource/biz-udpgothic/400.css">
<link rel="stylesheet" href="../../node_modules/@fontsource/biz-udpgothic/700.css">
<style>
  body { margin: 0; padding: 24px 28px 40px; background: #e9e6e0; color: #15171c; font-family: 'BIZ UDPGothic', sans-serif; font-size: 14px; line-height: 1.6; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  .lead { margin: 0 0 18px; color: #50545d; }
  .col { margin-bottom: 26px; padding: 16px 18px 18px; background: #fff; border-radius: 8px; }
  .col h2 { margin: 0; font-size: 19px; }
  .meta { margin: 4px 0 0; }
  .meta b { color: #1f2b5b; }
  .note { margin: 2px 0 12px; color: #50545d; }
  .help { margin: -6px 0 12px; padding: 8px 12px; border-left: 4px solid #f2b632; background: #fdf3d9; }
  .pages { display: flex; flex-wrap: wrap; gap: 14px; }
  figure { margin: 0; }
  figure img { display: block; width: 300px; border: 1px solid #dedad2; box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
  figcaption { margin-top: 4px; font-size: 13px; color: #50545d; text-align: center; }
</style>
</head>
<body>
<h1>学生用の使い方の手引きを1枚に（v26・案C1／C2）</h1>
<p class="lead">今の手引き：4ページ、ページごとの文字数 ${now.join('・')}字。どの案も、本文の文字は 10.5pt 以上・1つの項目は2行（40字ほど）まで。画面の写真は本番と同じもの。</p>
${DESIGNS.filter((d) => results[d.key]).map(col).join('\n')}
</body>
</html>
`
  writeFileSync(`${V}/review.html`, html)
  console.log(`  ${V}/review.html`)
}

await withEdge(async (browser) => {
  let results
  if (want('pdf')) {
    console.log('PDF とページの画像を作ります')
    results = await makePdfs(browser)
  } else {
    results = JSON.parse(readFileSync(`${SHOTS}/counts.json`, 'utf8'))
  }
  if (want('review')) {
    writeReview(results)
    const page = await browser.newPage()
    await page.setViewport({ width: 2000, height: 900, deviceScaleFactor: 1 })
    await page.goto(`${APP}/${V}/review.html`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${SHOTS}/review.png`, fullPage: true })
    console.log(`  ${SHOTS}/review.png`)
  }
})
