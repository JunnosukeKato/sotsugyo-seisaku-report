// デザイン案 v26（教員用の手引きを軽くする案）の見本を作る。
//   案C1：先生用は両面1枚（2ページ）＋管理者用は別に2ページ（mockups/v26/t-c1.html）
//   案C2：先生用は片面1枚＋管理者用は片面1枚。くわしいことは、ツールと管理ページの中のヘルプに移す想定（mockups/v26/t-c2.html）
//   1. pdf    … HTML を Edge で PDF にする（先生用と管理者用を別の PDF に分ける：mockups/v26/t-c1-先生用.pdf など）。
//               用紙からのはみ出し・書体・画像・文字の大きさ（日本語の文字は 10.5pt 以上）・ページごとの字数（目標以下か）・
//               1つの項目の字数（40字まで）と行数（2行まで。見出しの行は別）を確かめる
//   2. shots  … PDF をページごとの画像にする（mockups/v26/shots-teacher/t-c1-1.png など）
//   3. review … 一覧のページ（mockups/v26/review-teacher.html）を、測った字数を入れて書き出し、画像にする（shots-teacher/review-teacher.png）
// 使い方: node scripts/mockup-shots-v26-teacher.mjs [pdf] [shots] [review]（何も付けなければ全部。開発サーバーが http://localhost:5173 で動いていること）
//   Edge は EDGE_PORT（ふだんは 9392）で起動する。
//   字数の数え方：ページの文字から、空白（全角の空白も）と半角の英数字・記号を除いた数（タグ・画像の中の字は数えない）
// 同じフォルダの a.html・b.html・c1.html・c2.html・review.html・shots/ などは学生用の案（別の作業）なので、ここでは読み書きしない
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

// ほかの確かめと同時に動かしても Edge がぶつからないよう、別のポートを使う（edge.mjs は読み込んだときにポートを決めるので、先に決める）
process.env.EDGE_PORT ??= '9392'
const { withEdge } = await import('./poc/edge.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const V = 'mockups/v26'
const SHOTS = `${V}/shots-teacher`
const COUNTS = `${SHOTS}/counts.json`
mkdirSync(SHOTS, { recursive: true })
const ARGS = process.argv.slice(2)
const want = (k) => ARGS.length === 0 || ARGS.includes(k)
const MIN_PT = 10.5
const MAX_ITEM = 40

/** 案ごとの、HTML・字数の目標・分けて作る PDF（ページの範囲） */
const DESIGNS = [
  {
    key: 't-c1',
    name: '案C1',
    title: '先生用は両面1枚、管理者用は別に2ページ',
    target: 300,
    parts: [
      { label: '先生用', pages: [1, 2], names: ['先生用 おもて', '先生用 うら'] },
      { label: '管理者用', pages: [3, 4], names: ['管理者用 1', '管理者用 2'] },
    ],
  },
  {
    key: 't-c2',
    name: '案C2',
    title: '先生用は片面1枚、管理者用も片面1枚（くわしくはアプリの中のヘルプ）',
    target: 350,
    parts: [
      { label: '先生用', pages: [1], names: ['先生用'] },
      { label: '管理者用', pages: [2], names: ['管理者用'] },
    ],
  },
]

/** ページの中で動かす：はみ出し・文字の大きさ・字数・項目ごとの字数と行数 */
function inspect({ MIN_PT, MAX_ITEM }) {
  // 空白と ASCII（\x00-\x7F）を除いた字数で数える
  // oxlint-disable-next-line no-control-regex
  const jp = (s) => s.replace(/[\s\x00-\x7F]/g, '').length
  // oxlint-disable-next-line no-control-regex
  const hasJp = (s) => /[^\s\x00-\x7F]/.test(s)
  const name = (e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}「${e.textContent.trim().replace(/\s+/g, ' ').slice(0, 16)}」`
  const fonts = ['BIZ UDPGothic'].filter((f) => !document.fonts.check(`16px "${f}"`))
  const images = [...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.getAttribute('src'))
  const pages = [...document.querySelectorAll('.sheet')].map((s, i) => {
    const r = s.getBoundingClientRect()
    const problems = []
    // 用紙からのはみ出し（わざと用紙の端まで伸ばすもの .bleed は除く）
    for (const e of s.querySelectorAll('*')) {
      if (e.closest('.bleed, svg')) continue
      const q = e.getBoundingClientRect()
      if (!q.width || !q.height) continue
      if (q.bottom > r.bottom + 0.5) problems.push(`用紙の下から ${Math.round(q.bottom - r.bottom)}px はみ出し：${name(e)}`)
      if (q.right > r.right + 0.5) problems.push(`用紙の右から ${Math.round(q.right - r.right)}px はみ出し：${name(e)}`)
      if (q.left < r.left - 0.5) problems.push(`用紙の左から ${Math.round(r.left - q.left)}px はみ出し：${name(e)}`)
    }
    // 枠からのはみ出し（折り返さないボタンの名前など）
    for (const e of s.querySelectorAll('.btn')) {
      const box = e.parentElement.closest('p, li, td, th, small, b, div')
      if (!box) continue
      const q = e.getBoundingClientRect()
      const b = box.getBoundingClientRect()
      if (q.right > b.right + 1) problems.push(`ボタンの名前が枠から ${Math.round(q.right - b.right)}px はみ出し：${name(e)}`)
    }
    // 下の柱（ページ番号）と、すぐ上の中身が重なっていないか
    const folio = s.querySelector('.folio')
    let room = null
    if (folio) {
      const f = folio.getBoundingClientRect()
      let bottom = 0
      for (const c of s.children) {
        if (c === folio || c.classList.contains('bleed')) continue
        bottom = Math.max(bottom, c.getBoundingClientRect().bottom)
      }
      room = Math.round(((f.top - bottom) / 96) * 25.4 * 10) / 10 // mm
      if (room < 0) problems.push(`下の柱と中身が ${-room}mm 重なっています`)
    }
    // 文字の大きさ：日本語の文字を含むものは MIN_PT 以上（画像の上の番号は除く）
    let minJp = 99
    let minJpWho = ''
    for (const e of s.querySelectorAll('*')) {
      if (e.closest('svg, .shot')) continue
      const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('')
      if (!hasJp(own)) continue
      const pt = Math.round(parseFloat(getComputedStyle(e).fontSize) * 0.75 * 10) / 10
      if (pt < minJp) {
        minJp = pt
        minJpWho = name(e)
      }
      if (pt < MIN_PT) problems.push(`文字が小さい（${pt}pt）：${name(e)}`)
    }
    // 項目ごとの字数と行数（.d の飾りの番号は数えない）
    const lines = (el, skipTitle) => {
      const tops = []
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.textContent.trim()) continue
        const p = n.parentElement
        if (p.closest('.d, .no, .shot')) continue
        if (skipTitle && p.closest('b, .tt, h3, .who')) continue
        const range = document.createRange()
        range.selectNodeContents(n)
        for (const q of range.getClientRects()) {
          if (q.width < 1) continue
          const mid = q.top + q.height / 2
          if (!tops.some((t) => Math.abs(t - mid) < q.height * 0.5)) tops.push(mid)
        }
      }
      return tops.length
    }
    const items = []
    for (const e of s.querySelectorAll('li, td, th, .cap, .wall2, .help, .note p, .who-for, p.tt + p')) {
      if (e.closest('.bleed') && !e.matches('.who-for')) continue
      if (e.querySelector('li')) continue
      if (e.closest('thead')) continue
      const n = jp(e.textContent)
      if (!n) continue
      // 見出しの行（b・.tt）を持つ項目は、見出しの行を除いて数える
      const titled = e.matches('.chain li, .look li, .nums li, .cap')
      const ln = lines(e, titled)
      items.push({ n, ln, who: name(e) })
      if (n > MAX_ITEM) problems.push(`項目の字数が多い（${n}字）：${name(e)}`)
      if (ln > 2) problems.push(`項目が ${ln} 行（見出しの行を除く）：${name(e)}`)
    }
    return { page: i + 1, chars: jp(s.textContent), minJp, minJpWho, room, problems, items }
  })
  return { fonts, images, pages }
}

async function makePdfs(browser) {
  const result = {}
  for (const d of DESIGNS) {
    const html = `${V}/${d.key}.html`
    const page = await browser.newPage()
    page.on('pageerror', (e) => console.log('pageerror:', e.message))
    page.on('requestfailed', (r) => console.log('読み込めなかったもの:', r.url()))
    await page.setViewport({ width: 1000, height: 1200 })
    await page.emulateMediaType('print')
    await page.goto(pathToFileURL(resolve(html)).href, { waitUntil: 'networkidle0' })
    await page.waitForFunction(() => document.body.dataset.ready === 'true', { timeout: 60000 })
    await page.evaluate(() => document.fonts.ready)
    const check = await page.evaluate(inspect, { MIN_PT, MAX_ITEM })
    if (check.fonts.length) console.log(`！ ${d.key}：書体を読み込めませんでした：${check.fonts.join(', ')}`)
    if (check.images.length) console.log(`！ ${d.key}：読み込めなかった画像：${check.images.join(', ')}`)
    const total = d.parts.reduce((n, p) => n + p.pages.length, 0)
    if (check.pages.length !== total) console.log(`！ ${d.key}：${total}ページのはずが ${check.pages.length}ページ`)
    for (const p of check.pages) {
      const over = p.chars > d.target ? `　！目標 ${d.target}字を超えています` : ''
      console.log(`  ${d.key} ${p.page}ページ：${p.chars}字（目標 ${d.target}字以下）。日本語のいちばん小さい文字 ${p.minJp}pt。下の余白 ${p.room}mm${over}`)
      for (const x of p.problems) console.log(`    ！ ${x}`)
    }
    // 先生用と管理者用を、別の PDF にする
    const pdfs = []
    for (const part of d.parts) {
      const pdf = `${V}/${d.key}-${part.label}.pdf`
      await page.pdf({ path: pdf, printBackground: true, preferCSSPageSize: true, pageRanges: `${part.pages[0]}-${part.pages.at(-1)}` })
      const doc = await getDocument({ data: new Uint8Array(readFileSync(pdf)), useSystemFonts: false, verbosity: 0 }).promise
      if (doc.numPages !== part.pages.length) console.log(`！ ${pdf}：${part.pages.length}ページのはずが ${doc.numPages}ページ`)
      console.log(`  ${pdf}（${doc.numPages}ページ）`)
      pdfs.push({ ...part, pdf })
    }
    await page.close()
    result[d.key] = { pages: check.pages.map(({ page, chars, minJp, room, problems }) => ({ page, chars, minJp, room, problems })), pdfs }
  }
  writeFileSync(COUNTS, JSON.stringify(result, null, 1))
  return result
}

/** PDF をページごとの画像にする（scripts/poc/pdf-shots.mjs と同じ、pdf.js で描いたもの） */
async function makeShots(browser, result) {
  for (const d of DESIGNS) {
    for (const part of result[d.key].pdfs) {
      const view = await browser.newPage()
      await view.setViewport({ width: 1300, height: 1800, deviceScaleFactor: 1 })
      await view.goto(`${APP}/poc-pdf.html?file=${encodeURIComponent(part.pdf)}&scale=2`, { waitUntil: 'networkidle0' })
      await view.waitForFunction(() => document.body.dataset.rendered === 'true', { timeout: 120000 })
      const canvases = await view.$$('canvas')
      for (const [i, c] of canvases.entries()) {
        const out = `${SHOTS}/${d.key}-${part.pages[i]}.png`
        await c.screenshot({ path: out })
        console.log(`  ${out}`)
      }
      await view.close()
    }
  }
}

// =====================================================================
// 一覧のページ（review-teacher.html）
// =====================================================================
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')

function reviewHtml(result) {
  const c1 = result['t-c1']
  const c2 = result['t-c2']
  const chars = (r) => r.pages.map((p) => p.chars)
  const head = (d, r) => {
    const n = r.pages.length
    const per = d.parts.map((part) => `${part.label} ${part.pages.length}ページ`).join('＋')
    const cs = chars(r)
    return `<div class="hd"><b>${d.name}</b><span class="pc">${n}ページ（${per}）</span><span class="cc">1ページの字数：<em>${cs.join('・')}</em>字（目標 ${d.target}字以下・最大 ${Math.max(...cs)}字）</span><span class="t">${esc(d.title)}</span></div>`
  }
  const pg = (key, r, i, label) => {
    const p = r.pages[i - 1]
    return `<div class="pg"><a href="shots-teacher/${key}-${i}.png"><img src="shots-teacher/${key}-${i}.png" alt="${esc(label)}"></a><small><b>${esc(label)}</b>${p.chars}字</small></div>`
  }
  const [D1, D2] = DESIGNS
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>デザイン案 v26：教員用の手引きを軽くする（案C1・案C2）</title>
<!-- node scripts/mockup-shots-v26-teacher.mjs が書き出す（字数は PDF を作るときに測った数）。直すときはスクリプトの reviewHtml を直す -->
<style>
  body { margin: 0; padding: 26px 28px 40px; background: #eceae6; font-family: 'BIZ UDPGothic', 'Yu Gothic UI', sans-serif; color: #24262b; }
  h1 { font-size: 22px; margin: 0 0 6px; letter-spacing: 0.04em; }
  h2 { font-size: 17px; margin: 30px 0 8px; letter-spacing: 0.04em; }
  .lead { margin: 0 0 14px; font-size: 14px; color: #4b4e56; line-height: 1.8; max-width: 1300px; }
  .box { margin: 0 0 12px; padding: 12px 18px; max-width: 1300px; background: #fff; border-radius: 12px; box-shadow: 0 1px 6px rgba(0, 0, 0, 0.06); font-size: 14px; line-height: 1.85; }
  .box b { color: #1f2b5b; }
  .box ul { margin: 4px 0 0; padding-left: 20px; }
  .box.help { border-left: 4px solid #a9b8e8; }
  .box.help h3 { margin: 0 0 4px; font-size: 15px; }
  /* 2つの案を横に並べる：左が案C1（2列）、右が案C2（1列） */
  .grid { display: grid; grid-template-columns: 1fr 1fr 1px 1fr; gap: 0 14px; align-items: start; }
  .grid .sep { grid-row: 1 / span 5; grid-column: 3; align-self: stretch; background: #c9c5bd; }
  .hd { padding: 10px 14px 9px; background: #fff; border-radius: 12px; box-shadow: 0 1px 6px rgba(0, 0, 0, 0.06); }
  .hd b { font-size: 19px; margin-right: 10px; }
  .hd .pc { font-size: 15px; font-weight: 700; color: #1f2b5b; }
  .hd .cc { display: block; margin-top: 2px; font-size: 14px; }
  .hd .cc em { font-style: normal; font-weight: 700; font-size: 16px; color: #1f2b5b; }
  .hd .t { display: block; font-size: 13px; color: #5d6068; }
  .c1h { grid-column: 1 / span 2; }
  .c2h { grid-column: 4; }
  .row { grid-column: 1 / -1; margin: 18px 0 6px; font-size: 15px; font-weight: 700; letter-spacing: 0.06em; }
  .row span { display: inline-block; padding: 2px 12px; background: #15171c; color: #fff; }
  .row.adm span { background: #f2b632; color: #15171c; }
  .pg a { display: block; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18); background: #fff; }
  .pg img { display: block; width: 100%; }
  .pg small { display: block; padding: 6px 2px 0; font-size: 13px; color: #5d6068; }
  .pg small b { color: #24262b; margin-right: 8px; }
  .empty { align-self: stretch; display: grid; place-items: center; border: 2px dashed #c9c5bd; border-radius: 10px; color: #8a8d94; font-size: 14px; min-height: 120px; }
  .pdf { margin-top: 10px; font-size: 13.5px; }
  .pdf a { color: #1f2b5b; }
  .why { margin: 22px 0 8px; padding: 12px 16px; border-left: 4px solid #1f2b5b; background: #f6f5f2; border-radius: 0 10px 10px 0; font-size: 14px; line-height: 1.85; max-width: 1300px; }
  .why b { color: #1f2b5b; }
</style>
</head>
<body>
  <h1>教員用の手引き：もっと軽くする案（v26）</h1>
  <p class="lead">いまの教員用の手引き（8ページ、1ページに300〜1200字）を、先生がすぐ読める量に減らした2案です。見た目は今の冊子（雑誌風・黒と水色・大きな番号・本物の画面）のままで、<b>文を減らし、画面の画像を大きく</b>しました。本文の文字は 10.5pt 以上、1つの項目は2行（40字）までです。ほとんどの先生は「先生」の役割（ひな形・お知らせ・書き間違えやすい語を直す、学生を指導する）なので、<b>先生用と管理者用（1〜2人）を分けました</b>。画像を押すと大きく見られます。</p>
  <div class="box"><b>字数の数え方</b>：ページの中の文字から、空白と半角の英数字・記号を除いた数（画面の画像の中の字は数えません）。いまの冊子は 297〜1197字／ページです。</div>

  <div class="grid">
    ${head(D1, c1).replace('class="hd"', 'class="hd c1h"')}
    <div class="sep"></div>
    ${head(D2, c2).replace('class="hd"', 'class="hd c2h"')}

    <div class="row"><span>先生用（先生全員に配る）</span></div>
    ${pg('t-c1', c1, 1, '先生用 おもて')}
    ${pg('t-c1', c1, 2, '先生用 うら')}
    <div></div>
    ${pg('t-c2', c2, 1, '先生用（片面）')}

    <div class="row adm"><span>管理者用（管理者 1〜2人に配る）</span></div>
    ${pg('t-c1', c1, 3, '管理者用 1')}
    ${pg('t-c1', c1, 4, '管理者用 2')}
    <div></div>
    ${pg('t-c2', c2, 2, '管理者用（片面）')}

    <p class="pdf" style="grid-column: 1 / span 2">PDF：${c1.pdfs.map((p) => `<a href="${p.pdf.replace(`${V}/`, '')}">${p.pdf.replace(`${V}/`, '')}</a>`).join('　')}</p>
    <p class="pdf" style="grid-column: 4">PDF：${c2.pdfs.map((p) => `<a href="${p.pdf.replace(`${V}/`, '')}">${p.pdf.replace(`${V}/`, '')}</a>`).join('　')}</p>
  </div>

  <h2>2つの案のちがい</h2>
  <div class="box">
    <ul>
      <li><b>案C1</b>：先生用は両面1枚。おもてに「しくみの図・学生の1年・指導で見るところ」、うらに「管理ページの開き方・ひな形とお知らせの直し方・困ったとき（5つ）」。管理者用は別の2ページで、年度の設定・毎年の準備と公開・先生の登録・変更履歴・Google の障害のとき・セキュリティ・引き継ぎ。<b>紙だけで足ります</b>（ツールに手を入れなくてよい）。</li>
      <li><b>案C2</b>：先生用も管理者用も片面1枚ずつ。くわしいこと（困ったとき・年度の設定の各欄・書き間違えやすい語の決まりなど）は、<b>ツールと管理ページの中のヘルプ（？）に移す</b>想定です。紙は「全体の流れ」と「どこを押すか」だけ。</li>
    </ul>
  </div>
  <div class="box help">
    <h3>ヘルプができたら（案C2）</h3>
    案C2 は、管理ページと学生用ツールに「？（使い方）」のヘルプ欄ができることが前提です。ヘルプができるまでは、紙から外したこと（困ったときの表、年度の設定の各欄の説明、書き間違えやすい語の決まり、登録の細かい決まりなど）は、今の8ページの冊子か、案C1 の紙で補います。
  </div>
</body>
</html>
`
}

// Edge は1回だけ起動する（続けて起動し直すと、閉じかけの Edge に接続しようとして失敗することがあるため）
await withEdge(async (browser) => {
  let result = existsSync(COUNTS) ? JSON.parse(readFileSync(COUNTS, 'utf8')) : null
  if (want('pdf') || !result) {
    console.log('PDF を作り、確かめます')
    result = await makePdfs(browser)
  }
  if (want('shots')) {
    console.log('ページの画像を作ります')
    await makeShots(browser, result)
  }
  if (want('review')) {
    writeFileSync(`${V}/review-teacher.html`, reviewHtml(result))
    console.log(`  ${V}/review-teacher.html`)
    const page = await browser.newPage()
    await page.setViewport({ width: 1900, height: 1000, deviceScaleFactor: 1 })
    await page.goto(`${APP}/${V}/review-teacher.html`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${SHOTS}/review-teacher.png`, fullPage: true })
    console.log(`  ${SHOTS}/review-teacher.png`)
  }
})
