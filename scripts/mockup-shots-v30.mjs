// デザイン案 v30（新しいページ「提出前チェック」：Word で書いた報告書を確かめて、1つの PDF にまとめる）を画像に書き出す。
// 案の画面は mockups/v30/ の静的な HTML（a.html・b.html・c.html・errors.html。中身は v30.js が ?state= で描き分ける）。ツール本体（src/）は変えない。
// 使い方: node scripts/mockup-shots-v30.mjs [pages] [shots] [review]（何も付けなければ shots と review。開発サーバーが http://localhost:5173 で動いていること）
//   pages  ：ページの小さな絵（mockups/v30/pages/*.jpg）を、本物の学生用ツールの紙面から撮り直す（ふだんは要らない）
//   shots  ：案の画面（mockups/v30/shots/*.png）
//   review ：一覧のページ（mockups/v30/review.html と shots/review.png）
//   Edge は EDGE_PORT（ふだんは 9420）で起動する
// pages のときだけ、学生用ツールを開く。Google のログインとドライブは偽物（scripts/e2e/fakeGoogle.mjs）に差し替える。本物の Google にはつながない。
// 中身の例：衣装コースの学生（文化花子・00ZZ0123。架空）。見本の画像は docs/guide-images/sample/（読むだけ）
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

process.env.EDGE_PORT ??= '9420'
const { withEdge } = await import('./poc/edge.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const DIR = 'mockups/v30'
const OUT = `${DIR}/shots`
const PAGES = `${DIR}/pages`
mkdirSync(OUT, { recursive: true })
mkdirSync(PAGES, { recursive: true })
const ARGS = process.argv.slice(2)
const want = (k) => (ARGS.length === 0 ? k !== 'pages' : ARGS.includes(k))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PC = { width: 1440, height: 900, deviceScaleFactor: 1.5 }
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

// =====================================================================
// pages：本物の紙面（見本の原稿）を、1ページずつ小さな絵にする
// =====================================================================

const EMAIL = '00zz0123@bunka-wu.ac.jp'
/** 絵の大きさ（A4 を 0.6 倍。画面の点で 476×673、画像は 1.5 倍の 714×1010） */
const PAGE_SCALE = 0.6
const PAGE_W = 476
const PAGE_H = 673

async function capturePages(browser) {
  const { fakeDrive, routeGoogle } = await import('./e2e/fakeGoogle.mjs')
  const { setupWriting } = await import('./e2e/sampleReport.mjs')
  const config = JSON.parse(readFileSync('scripts/e2e/config-fixture.json', 'utf8'))
  for (const c of config.courses) delete c.notice
  const ready = (page) =>
    page.waitForFunction(() => {
      const s = window.__editor?.getSnapshot()
      return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading')
    }, { timeout: 120000 })

  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  page.on('dialog', (d) => d.accept())
  await page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  })
  await page.setViewport(PC)
  await routeGoogle(page, fakeDrive(EMAIL), config)
  await page.goto(`${APP}/`, { waitUntil: 'networkidle0', timeout: 90000 })
  await page.waitForSelector('.login-over .login-btn', { timeout: 60000 })
  await sleep(300)
  await page.evaluate(() => document.querySelector('.login-over .login-btn').click())
  await page.waitForFunction(() => !document.querySelector('.login-over'), { timeout: 60000 })
  await page.waitForSelector('.guide.step-course .g-opts button', { timeout: 60000 })
  await page.evaluate(() => [...document.querySelectorAll('.guide .g-opts button')].find((b) => b.textContent.includes('映画・舞台衣装')).click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no', { timeout: 60000 })
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.guide .g-later', { timeout: 60000 })
  await page.evaluate(() => document.querySelector('.guide .g-later').click())
  await page.evaluate(() => window.__editor.finishEditing())
  await ready(page)
  await page.evaluate(setupWriting)
  await sleep(800)
  await ready(page)
  await sleep(600)
  await page.addStyleTag({
    content: `
    #v30-cap { position: fixed; left: 0; top: 0; z-index: 99999; width: ${PAGE_W}px; height: ${PAGE_H}px; overflow: hidden; background: #fff; }
    #v30-cap .v30-page { display: block !important; position: absolute !important; left: 0; top: 0; margin: 0 !important; transform-origin: 0 0; box-shadow: none !important; }`,
  })
  const total = await page.evaluate(() => window.__editor.pageElements().filter((p) => !p.classList.contains('print-skip')).length)
  // 表紙・抄録・目次・本文（残り）・作品写真（最後）
  const names = Array.from({ length: total }, (_, i) => (i === 0 ? 'cover' : i === 1 ? 'abstract' : i === 2 ? 'toc' : i === total - 1 ? 'photo' : `body-${i - 2}`))
  for (let i = 0; i < total; i++) {
    await page.evaluate((i, scale) => {
      document.querySelector('#v30-cap')?.remove()
      const p = window.__editor.pageElements().filter((p) => !p.classList.contains('print-skip'))[i]
      const clone = p.cloneNode(true)
      clone.removeAttribute('id')
      for (const el of clone.querySelectorAll('[id]')) el.removeAttribute('id')
      clone.className = 'v30-page'
      clone.style.transform = `scale(${scale})`
      const box = document.createElement('div')
      box.id = 'v30-cap'
      box.appendChild(clone)
      document.body.appendChild(box)
    }, i, PAGE_SCALE)
    await sleep(250)
    await page.screenshot({ path: `${PAGES}/${names[i]}.jpg`, type: 'jpeg', quality: 88, clip: { x: 0, y: 0, width: PAGE_W, height: PAGE_H } })
    console.log(`  ${PAGES}/${names[i]}.jpg`)
  }
  await context.close()
}

// =====================================================================
// shots：案の画面を撮る
// =====================================================================

/** 字と絵が読み込まれるのを待つ */
const settle = (page) =>
  page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all([...document.images].map((im) => (im.complete ? 0 : new Promise((r) => (im.onload = im.onerror = r)))))
  })

/** 確かめ：字が読み込まれたか・横にはみ出していないか・切れていないか・（スマホ）字が小さすぎないか */
const audit = (page, name, { phone = false } = {}) =>
  page
    .evaluate((phone) => {
      const bad = []
      for (const f of ['14px "BIZ UDPGothic"', '700 14px "BIZ UDPGothic"', '14px "BIZ UDMincho"']) if (!document.fonts.check(f)) bad.push(`字が読み込まれていない：${f}`)
      for (const im of document.images) if (!im.naturalWidth) bad.push(`絵が読み込まれていない：${im.getAttribute('src')}`)
      if (document.documentElement.scrollWidth > innerWidth + 1) bad.push(`横にはみ出している（${document.documentElement.scrollWidth}px）`)
      const small = new Set()
      for (const el of document.body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect()
        if (!r.width || !r.height) continue
        const cs = getComputedStyle(el)
        if (r.right > innerWidth + 1 || r.left < -1) bad.push(`画面の外：${el.className || el.tagName}`)
        // 名前が長いファイルは「…」で省く作りなので、そこは見ない
        if (cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1 && !el.matches('.fn, .r-l, .modal, .mini')) bad.push(`切れている：${el.className || el.tagName}`)
        if (phone && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(cs.fontSize) < 12.9 && !el.closest('figcaption, .src, .kd, .brand small')) small.add(`${el.className || el.tagName} ${cs.fontSize}`)
      }
      if (small.size) bad.push(`字が小さい：${[...small].join(' / ')}`)
      return [...new Set(bad)].slice(0, 8)
    }, phone)
    .then((bad) => bad.length && console.log(`  ！${name}：${bad.join(' ／ ')}`))

/** 撮る。full：画面より縦に長いときは、画面の高さをページに合わせて全部を撮る（下に固定した帯は、いちばん下に来る） */
async function snap(page, name, { full = false, phone = false, quiet = false } = {}) {
  await settle(page)
  await sleep(250)
  await audit(page, name, { phone })
  const vp = page.viewport()
  const h = await page.evaluate(() => document.documentElement.scrollHeight)
  const tall = h > vp.height + 1
  if (tall && !full && !quiet) console.log(`  ！${name}：画面より縦に長い（${h}px）`)
  if (tall && full) {
    await page.setViewport({ ...vp, height: h })
    await sleep(250)
  }
  await page.screenshot({ path: `${OUT}/${name}.png`, captureBeyondViewport: false })
  if (tall && full) await page.setViewport(vp)
  console.log(`  ${OUT}/${name}.png${tall && full ? `（縦 ${h}px）` : ''}`)
}

async function shots(browser) {
  const open = async (page, file, query) => {
    await page.goto(`${APP}/${DIR}/${file}.html?${query}`, { waitUntil: 'networkidle0', timeout: 90000 })
    await page.waitForSelector('html[data-ready]')
  }
  // ---- パソコン ----
  const pc = await browser.newPage()
  pc.on('pageerror', (e) => console.log('pageerror:', e.message))
  await pc.setViewport(PC)
  // ① 画面の作り：案A・B・C を、開いたところ・入れたところ・保存したところで
  for (const layout of ['a', 'b', 'c'])
    for (const state of ['empty', 'loaded', 'done']) {
      await open(pc, layout, `state=${state}`)
      await snap(pc, `${layout}-${state}-pc`, { full: true })
    }
  // はじめに Word だけ入れたとき（PDF はまだ）
  await open(pc, 'a', 'state=word')
  await snap(pc, 'a-word-pc', { full: true })
  // ③ Word を入れなかったとき（PDF だけ）：要らない決まり／要る決まり
  await open(pc, 'a', 'state=pdfonly')
  await snap(pc, 'a-pdfonly-pc', { full: true })
  await open(pc, 'a', 'state=pdfonly&req=1')
  await snap(pc, 'a-pdfonly-req-pc', { full: true })
  // ② エラーが残っているとき：まとめる所だけを、3つの決まりで
  await open(pc, 'errors', '')
  await settle(pc)
  await sleep(250)
  await audit(pc, 'errors')
  for (const k of ['a', 'b', 'c']) {
    const el = await pc.$(`#err-${k}`)
    await el.screenshot({ path: `${OUT}/err-${k}.png` })
    console.log(`  ${OUT}/err-${k}.png`)
  }
  await pc.close()

  // ---- スマホ（おすすめの案A） ----
  const ph = await browser.newPage()
  ph.on('pageerror', (e) => console.log('pageerror:', e.message))
  await ph.setUserAgent(UA_IPHONE)
  await ph.setViewport(PHONE)
  for (const [state, query] of [['empty', 'state=empty'], ['loaded', 'state=loaded'], ['done', 'state=done&result=iphone'], ['pdfonly', 'state=pdfonly']]) {
    await open(ph, 'a', query)
    // 保存したあとの窓は、画面の高さのまま撮る（窓は画面に重なる）
    await snap(ph, `a-${state}-ph`, { full: state !== 'done', quiet: state === 'done', phone: true })
  }
  await ph.close()
}

// =====================================================================
// review：一覧のページ（mockups/v30/review.html）
// =====================================================================

function reviewHtml() {
  const img = (f, cap, cls = '') => `<div class="${cls}"><a href="shots/${f}.png" target="_blank"><img src="shots/${f}.png" alt="" loading="lazy"></a><small>${cap}</small></div>`
  const list = (items) => `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>`
  const pros = (good, weak) => `<div class="pw"><div class="good"><b>良い点</b>${list(good)}</div><div class="weak"><b>弱い点</b>${list(weak)}</div></div>`
  const rec = '<em class="rec">おすすめ</em>'
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>v30 提出前チェック</title>
<!-- node scripts/mockup-shots-v30.mjs review で作る（手で直さない） -->
<link rel="stylesheet" href="../../node_modules/@fontsource/biz-udpgothic/400.css">
<link rel="stylesheet" href="../../node_modules/@fontsource/biz-udpgothic/700.css">
<style>
  :root { --ink: #24262b; --muted: #5d6068; --accent: #2f3e75; --line: #ecebe8; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px 32px 48px; background: #eceae6; font-family: 'BIZ UDPGothic', 'Yu Gothic UI', sans-serif; color: var(--ink); }
  h1 { font-size: 21px; margin: 0 0 4px; letter-spacing: 0.04em; }
  h2 { font-size: 18px; margin: 36px 0 6px; letter-spacing: 0.04em; }
  .lead { margin: 0 0 16px; font-size: 13.5px; color: var(--muted); line-height: 1.8; max-width: 1180px; }
  .ask { margin: 0 0 8px; padding: 14px 18px 12px; background: #fff; border-radius: 14px; box-shadow: 0 2px 10px rgba(0,0,0,0.08); max-width: 1180px; }
  .ask h2 { margin: 0 0 6px; font-size: 15px; }
  .ask ol { margin: 0; padding-left: 22px; font-size: 13.5px; line-height: 2; }
  .ask em { font-style: normal; color: var(--accent); font-weight: 700; }
  .flow { margin: 0 0 8px; padding: 10px 18px; background: #fff; border-radius: 14px; box-shadow: 0 2px 10px rgba(0,0,0,0.08); max-width: 1180px; font-size: 13px; line-height: 1.9; }
  .flow b { color: var(--accent); }
  .fn { font-family: 'Segoe UI', 'BIZ UDPGothic', sans-serif; }
  figure { margin: 0 0 18px; background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.08); }
  figure.is-rec { box-shadow: 0 0 0 2.5px var(--accent), 0 2px 10px rgba(0,0,0,0.08); }
  figcaption { padding: 12px 16px 10px; border-bottom: 1px solid var(--line); }
  figcaption b { display: block; font-size: 15.5px; margin-bottom: 3px; }
  figcaption span { font-size: 13px; color: var(--muted); line-height: 1.7; }
  .rec { display: inline-block; margin-left: 8px; padding: 1px 9px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 11.5px; font-style: normal; font-weight: 700; letter-spacing: 0.06em; vertical-align: 2px; }
  img { display: block; width: 100%; }
  .strip { display: grid; gap: 1px; background: var(--line); align-items: start; }
  .strip > div { background: #fff; align-self: stretch; }
  .strip small { display: block; padding: 6px 12px 9px; font-size: 12.5px; color: var(--muted); line-height: 1.6; }
  .strip small b { color: var(--ink); }
  .pc3 { grid-template-columns: repeat(3, 1fr); }
  .pc2 { grid-template-columns: repeat(2, 1fr); }
  .pc12 { grid-template-columns: 1fr 2fr; }
  .ph4 { grid-template-columns: repeat(4, 1fr); }
  .ph { padding: 10px; background: #faf9f7 !important; }
  .ph img { border-radius: 12px; border: 1px solid #ddd; }
  .mg { padding: 14px 14px 4px; background: #ebe8e3 !important; }
  .mg img { border-radius: 10px; }
  .mg small { padding: 10px 2px 10px; color: #3f4249; }
  .mg small b { display: block; font-size: 13.5px; }
  .mg.is-rec { box-shadow: inset 0 0 0 2.5px var(--accent); }
  .note-cell { padding: 14px 16px; font-size: 13px; line-height: 1.8; color: #3f4249; }
  .note-cell p { margin: 0 0 8px; }
  .pw { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--line); border-top: 1px solid var(--line); }
  .pw > div { background: #fff; padding: 10px 16px 12px; font-size: 13px; line-height: 1.75; }
  .pw b { font-size: 12.5px; letter-spacing: 0.06em; }
  .pw .good b { color: #3f7a55; }
  .pw .weak b { color: #b5443b; }
  .pw ul { margin: 4px 0 0; padding-left: 18px; }
  .pw3 { grid-template-columns: repeat(3, 1fr); }
  .pw3 > div b.g { color: #3f7a55; }
  .pw3 > div b.w { color: #b5443b; }
  .why { margin: 2px 0 10px; padding: 11px 15px; border-left: 3px solid var(--accent); background: #f6f5f2; border-radius: 0 10px 10px 0; font-size: 13.5px; line-height: 1.85; max-width: 1180px; }
  .why b { color: var(--accent); }
  .care { margin: 2px 0 10px; padding: 11px 15px; border-left: 3px solid #8a5e0f; background: #f6f0e3; border-radius: 0 10px 10px 0; font-size: 13.5px; line-height: 1.85; max-width: 1180px; }
  .care b { color: #8a5e0f; }
  .test { background: #fff; border-radius: 14px; padding: 12px 18px; box-shadow: 0 2px 10px rgba(0,0,0,0.08); max-width: 1180px; font-size: 13.5px; line-height: 1.9; }
  .test ul { margin: 0; padding-left: 20px; }
</style>
</head>
<body>
  <h1>新しいページ「提出前チェック」：画面の案（v30）</h1>
  <p class="lead">Word のひな形（<span class="fn">01_表紙</span>〜<span class="fn">04_本文</span>）で書いている学生のためのページです。Word を確かめ（作成ツールと同じセルフチェック）、Word から保存した PDF と作品写真を、1つの PDF にまとめます。ファイルは学生の端末の中だけで読み、外には送りません。ログインも要りません。どの画面も、見た目だけの試作です（まだ作っていません）。例は、文化花子（00ZZ0123。架空）の原稿です。<b>おすすめ</b>の案には印を付けています。</p>
  <div class="ask">
    <h2>この v30 で決めていただきたいこと</h2>
    <ol>
      <li>画面の作り：案A／B／C　<em>おすすめ：案A「一覧」</em></li>
      <li>エラーが残っているとき：まとめられない／「下書き」の透かし／確かめの窓　<em>おすすめ：「下書き」の透かし（作成ツールと同じ）</em></li>
      <li>Word を必ず入れてもらうか　<em>おすすめ：入れなくても、まとめられる（知らせを出す）</em></li>
      <li>スマホは、案A を縦に並べた形でよいか</li>
    </ol>
  </div>
  <div class="flow"><b>流れ</b>：ファイルを入れる（Word・PDF・作品写真を、まとめて）→ 名前を見て、5つの場所（表紙・抄録・目次・本文・作品写真）に自動で分ける → Word を読んで、直すところを出す → 学生が Word で直し、PDF にして、もう一度入れる →「1つの PDF にまとめる」→「<span class="fn">2026_卒業制作報告書_学籍番号_氏名.pdf</span>」を保存。</div>
  <div class="flow"><b>できないこと</b>：書式を直すこと（直すのは Word で）／ Word を PDF にすること（Word の「名前を付けて保存」で）／ パスワードの付いた PDF をまとめること。</div>

  <h2>① 画面の作り</h2>
  <p class="lead">3つの案を、「開いたところ」「ファイルを入れたところ（5 エラー・1 警告。作品写真はまだ。本文は Word のほうが新しい）」「保存したところ」で並べます。ファイルを入れる所は、どの案も1つです。</p>
  <figure class="is-rec">
    <figcaption><b>案A　一覧${rec}</b><span>左に5つの置き場所（Word はチェック用、PDF はまとめる用）、右にチェックの結果、下に「まとめる」。1つの画面で全部が見える</span></figcaption>
    <div class="strip pc3">
      ${img('a-empty-pc', '<b>開いたところ</b>：入れる所と、空の置き場所')}
      ${img('a-loaded-pc', '<b>入れたところ</b>：置き場所の知らせ（本文・作品写真）と、指摘の一覧')}
      ${img('a-done-pc', '<b>保存した</b>：窓に、ページが順に並ぶ（作成ツールと同じ形）')}
    </div>
    <div class="strip pc12" style="border-top:1px solid var(--line)">
      ${img('a-word-pc', '<b>はじめに Word だけ入れたとき</b>（PDF はまだ）')}
      <div class="note-cell"><p>多くの学生は、まず Word だけを入れて確かめるはずです。</p><p>PDF の所には「PDF がまだありません」と出し、下に PDF の作り方を1行で出します。</p><p>外す：ファイルの右の ×。入れ替える：同じ場所にもう一度入れる。</p></div>
    </div>
    ${pros(['置き場所と指摘が同時に見える。直して入れ直しても、画面が変わらない', '作成ツールと同じ並び（右がチェック、下が書き出し）', 'Word だけの段階でも、画面が空かない'], ['1つの画面にのる物が多い', 'ページの見た目は、小さな絵（1ページ目）と、保存したあとの窓だけ'])}
  </figure>

  <figure>
    <figcaption><b>案B　手順</b><span>① ファイルを入れる → ② チェックを直す → ③ 1つにまとめる。今の段だけを開く</span></figcaption>
    <div class="strip pc3">
      ${img('b-empty-pc', '<b>開いたところ</b>：① だけが開いている')}
      ${img('b-loaded-pc', '<b>入れたところ</b>：② が開き、① は1行にたたむ')}
      ${img('b-done-pc', '<b>保存した</b>：③ の中に結果')}
    </div>
    ${pros(['今することが1つだけ見える。初めてでも迷いにくい', '字が少なく見える'], ['直したあと ① に戻って入れ直す、の行き来が増える', 'たたんだ段の中（どのファイルが入っているか）が見えない', '縦に長い（スマホでは、さらに長い）'])}
  </figure>

  <figure>
    <figcaption><b>案C　ページを見せる</b><span>まとめた PDF のページを、順に並べる。5つの見出しが置き場所。足りない所は空の枠、指摘はそのパートの下に付ける</span></figcaption>
    <div class="strip pc3">
      ${img('c-empty-pc', '<b>開いたところ</b>：空の枠が、できあがりの順に並ぶ')}
      ${img('c-loaded-pc', '<b>入れたところ</b>：ページの絵と、パートごとの指摘（赤い丸は、そのページの指摘の数）')}
      ${img('c-done-pc', '<b>保存した</b>：上に結果、下に全ページ')}
    </div>
    ${pros(['できあがりの順とページの数が、ひと目で分かる', '足りない所が、空の枠で分かる', '指摘が、どのパート・どのページかと結び付く'], ['Word だけ入れた段階では、枠が空のまま（PDF がないと絵を出せない）', '指摘の札が狭く、文が折れて読みにくい。ファイル名も見えない', 'スマホでは横に並べられない', '「どのページか」を出すには、PDF の中の文と突き合わせる仕組みが要る'])}
  </figure>
  <p class="why"><b>おすすめは案A</b>：このページは「直す → PDF にする → 入れ直す」を何度もくり返して使います。置き場所と指摘が同じ画面にある案A が、行き来がいちばん少なくて済みます。最初は Word だけを入れる学生が多く、そのとき案C はページの枠が空のままになります。案C の良さ（ページを順に見せる）は、案A の「保存しました」の窓に入れてあります。</p>

  <h2>② エラーが残っているとき</h2>
  <p class="lead">「まとめる」所だけを、3つの決まりで並べます（例：エラーが5件）。</p>
  <figure>
    <figcaption><b>エラーが残っているときの「まとめる」</b><span>(a) まとめられない ／ (b)「下書き」の透かしを入れてまとめる ／ (c) 確かめの窓を出して、そのまままとめる</span></figcaption>
    <div class="strip pc3">
      ${img('err-a', '<b>(a) まとめられない</b>エラーを0件にしてから', 'mg')}
      ${img('err-b', `<b>(b)「下書き」の透かしを入れてまとめる${rec}</b>ファイル名に「<span class="fn">_下書き</span>」。今の作成ツールと同じ決まり`, 'mg is-rec')}
      ${img('err-c', '<b>(c) 確かめの窓を出して、そのまままとめる</b>透かしは入らない', 'mg')}
    </div>
    <div class="pw pw3">
      <div><b class="g">良い点</b>${list(['提出される PDF は、必ずエラー0件'])}<b class="w">弱い点</b>${list(['先生に途中を見せる PDF が作れない', 'チェックの読みまちがいがあると、提出できなくなる'])}</div>
      <div><b class="g">良い点</b>${list(['作成ツールと同じ決まりで、学生が迷わない', '途中の PDF を先生に見せられる'])}<b class="w">弱い点</b>${list(['透かしを消すには、エラーを0件にする必要がある'])}</div>
      <div><b class="g">良い点</b>${list(['いつでも、まとめられる'])}<b class="w">弱い点</b>${list(['エラーが残った PDF と、直した PDF の見分けが付かない', '作成ツールと決まりが違ってしまう'])}</div>
    </div>
  </figure>
  <p class="why"><b>おすすめは (b)</b>：作成ツールと同じ決まりにそろえられます。エラーが残っていても、途中経過を先生に見せられます。</p>

  <h2>③ Word を必ず入れてもらうか</h2>
  <p class="lead">PDF と作品写真だけを入れたときの画面です（Word は入れていない）。</p>
  <figure>
    <figcaption><b>Word を入れなかったとき</b><span>どちらも、PDF から分かること（ページの数・A4）は確かめる</span></figcaption>
    <div class="strip pc2">
      ${img('a-pdfonly-pc', `<b>入れなくてもよい${rec}</b>：「Word を入れていないので、チェックしていません」と知らせて、まとめられる`)}
      ${img('a-pdfonly-req-pc', '<b>必ず入れる</b>：Word を入れるまで、まとめられない')}
    </div>
  </figure>
  <p class="why"><b>おすすめは「入れなくてもよい」</b>：Word を読む仕組みは、まだ実際の学生のファイルで試していません。読めないファイルがあっても、その学生が提出できるようにしておきます。</p>
  <p class="care"><b>ご注意</b>：② を「下書きの透かし」、③ を「入れなくてもよい」にすると、Word を外せば、透かしなしでまとめられます。このページは「通らないと出せない関所」ではなく、学生が自分で確かめる道具になります。</p>

  <h2>④ スマホ（案A）</h2>
  <figure>
    <figcaption><b>スマホ：案A を縦に並べる</b><span>上から、入れる所 → 5つの置き場所 → チェックの結果。「まとめる」は下に固定。そろった所は1行にたたみ、気を付ける所（本文・作品写真）だけ開く</span></figcaption>
    <div class="strip ph4">
      ${img('a-empty-ph', '<b>開いたところ</b>', 'ph')}
      ${img('a-loaded-ph', '<b>入れたところ</b>（5 エラー・1 警告）', 'ph')}
      ${img('a-done-ph', '<b>できた</b>：iPhone は「保存する」をもう一度押す（作成ツールと同じ）', 'ph')}
      ${img('a-pdfonly-ph', '<b>PDF だけ入れたとき</b>（③ のおすすめ）', 'ph')}
    </div>
  </figure>

  <h2>⑤ 作る前に、知っておいていただきたいこと</h2>
  <div class="test">
    <ul>
      <li>チェックの決まり（エラーと警告の分け方、言い回し）は、作成ツールと同じにします。画面の指摘は、例です。</li>
      <li>ファイルは、名前（<span class="fn">01_表紙</span> など）で分けます。名前を変えている学生のために、違う場所に入ったファイルを、手で移せるようにします。</li>
      <li>学籍番号と氏名は、表紙から読み取ります。読めないときは、手で入れる欄を出します。</li>
      <li>作品写真が2枚以上のときの置き方（1枚ずつ1ページ／1ページに並べる）は、作るときに決めます。</li>
      <li>Word の読み取りは、これから実際の学生のファイルで試します（③ のおすすめの理由）。</li>
    </ul>
  </div>
</body>
</html>
`
}

await withEdge(async (browser) => {
  if (want('pages')) {
    console.log('ページの小さな絵')
    await capturePages(browser)
  }
  if (want('shots')) {
    console.log('画面')
    await shots(browser)
  }
  if (want('review')) {
    writeFileSync(`${DIR}/review.html`, reviewHtml())
    console.log(`  ${DIR}/review.html`)
    const page = await browser.newPage()
    await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 })
    await page.goto(`${APP}/${DIR}/review.html`, { waitUntil: 'networkidle0' })
    await page.evaluate(async () => {
      for (const im of document.images) {
        im.loading = 'eager'
        if (!im.complete) await new Promise((r) => (im.onload = im.onerror = r))
      }
      await document.fonts.ready
    })
    await page.screenshot({ path: `${OUT}/review.png`, fullPage: true })
    console.log(`  ${OUT}/review.png`)
  }
})
