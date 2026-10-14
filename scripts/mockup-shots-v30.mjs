// デザイン案 v30（新しいページ「提出前チェック」：Word で書いた報告書を確かめて、1つの PDF にまとめる）を画像に書き出す。
// 案の画面は mockups/v30/ の静的な HTML（a.html・b.html・c.html・c2.html・errors.html。中身は v30.js が ?state= などで描き分ける）。ツール本体（src/）は変えない。
// 使い方: node scripts/mockup-shots-v30.mjs [pages] [shots] [review]（何も付けなければ shots と review。開発サーバーが http://localhost:5173 で動いていること）
//   pages  ：ページの小さな絵（mockups/v30/pages/*.jpg）を、本物の学生用ツールの紙面から撮り直す（ふだんは要らない）
//            見本の原稿（10ページ）と、章を足した長い原稿（本文 12ページ。long-*.jpg）
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
  /** 今の紙面を1ページずつ撮る。only：その名前で始まるページだけを残す（長い原稿は、目次と本文だけ使う） */
  const capture = async (prefix, only) => {
    const total = await page.evaluate(() => window.__editor.pageElements().filter((p) => !p.classList.contains('print-skip')).length)
    // 表紙・抄録・目次・本文（残り）・作品写真（最後）
    const names = Array.from({ length: total }, (_, i) => (i === 0 ? 'cover' : i === 1 ? 'abstract' : i === 2 ? 'toc' : i === total - 1 ? 'photo' : `body-${i - 2}`))
    for (let i = 0; i < total; i++) {
      if (only && !only.some((o) => names[i].startsWith(o))) continue
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
      await page.screenshot({ path: `${PAGES}/${prefix}${names[i]}.jpg`, type: 'jpeg', quality: 88, clip: { x: 0, y: 0, width: PAGE_W, height: PAGE_H } })
      console.log(`  ${PAGES}/${prefix}${names[i]}.jpg`)
    }
    await page.evaluate(() => document.querySelector('#v30-cap')?.remove())
  }
  await capture('')

  // ---- 長い原稿（本文 12ページほど）：見本の原稿に、章を3つ足して撮る（案C・C2 の「長いとき」の絵に使う） ----
  await page.evaluate(() => {
    const p = (id, text) => ({ type: 'paragraph', id, content: [{ type: 'text', text }] })
    const sub = (id, title) => ({ type: 'subheading', id, title })
    const fig = (id, imageId, caption) => ({ type: 'figureRow', id: `r-${id}`, figures: [{ id, imageId, caption }] })
    const T = [
      '身頃は、仮縫いで直したパターンをもとに、コットンサテンを裁断した。布目が曲がると光沢の向きがそろわないため、裁断の前に地直しをして、布の耳と平行になるように型紙を置いた。',
      '縫い代は、ほつれやすい素材であることを考えて、ふだんより5mm広くとった。裁断したあとは、すぐにロックミシンで端を始末し、作業の途中で布がほどけないようにした。',
      '衿ぐりは、見返しを付けて始末した。見返しには薄い接着芯を貼り、着たときに衿ぐりが伸びないようにした。表から縫い目が見えないよう、見返しの端は手でまつった。',
      '袖は、袖山にギャザーを寄せて身頃に付けた。ギャザーが片寄らないよう、袖山を四つに分けて合い印を付け、それぞれの間で均等に寄せた。袖口にはカフスを付け、ボタンで留める形にした。',
      '重ね布のシルクシフォンは、すべりやすく縫いにくい素材である。そこで、薄い紙を下に敷いていっしょに縫い、縫い終えてから紙を破って取り除いた。端は三つ折りにして、細く縫った。',
      '舞台では、客席から衣装までの距離が遠い。近くで見てきれいな仕上がりでも、離れると印象が弱くなることがある。そこで、節目ごとに5m離れた位置から全体を見て、形と色のバランスを確かめた。',
      '照明の色によって、布の色は大きく変わって見える。稽古場の蛍光灯の下では落ち着いた藍色に見えた布が、舞台の照明の下では明るい青に見えた。本番と同じ照明で確かめることの大切さを知った。',
      '演者からは、腕を大きく回す振り付けのときに、袖が顔にかかるという意見が出た。そこで、袖口のカフスを少しきつくし、重ね布の長さを3cm短くした。直したあとは、動きを妨げなくなった。',
      '早替えの場面に合わせて、帯は結ばずに留められるよう、面ファスナーを縫い付けた。結び目は別に作って帯の上から付け、見た目は結んでいるように見せた。着替えにかかる時間は半分ほどになった。',
      '小道具との組み合わせも確かめた。腰に下げる短剣のさやが帯に当たって音を立てたため、帯の内側に当て布を足した。靴は、舞台の床で滑らないよう、底にゴムを貼った。',
    ]
    const chapter = (k, title, subs, images, caps) => ({
      id: `x${k}`,
      title,
      blocks: [
        sub(`x${k}s1`, subs[0]),
        p(`x${k}p1`, T[(k * 3) % 10]),
        p(`x${k}p2`, T[(k * 3 + 1) % 10]),
        fig(`x${k}f1`, images[0], caps[0]),
        p(`x${k}p3`, T[(k * 3 + 2) % 10]),
        p(`x${k}p4`, T[(k * 3 + 3) % 10]),
        sub(`x${k}s2`, subs[1]),
        p(`x${k}p5`, T[(k * 3 + 4) % 10]),
        p(`x${k}p6`, T[(k * 3 + 5) % 10]),
        p(`x${k}p7`, T[(k * 3 + 6) % 10]),
        fig(`x${k}f2`, images[1], caps[1]),
        p(`x${k}p8`, T[(k * 3 + 7) % 10]),
        p(`x${k}p9`, T[(k * 3 + 8) % 10]),
        p(`x${k}p10`, T[(k * 3 + 9) % 10]),
      ],
    })
    const extra = [
      chapter(1, 'ブラウスの縫製', ['裁断と身頃', '袖と重ね布'], ['g-satin', 'g-chiffon'], ['コットンサテンの表面', '重ね布のシルクシフォン']),
      chapter(2, '舞台での確かめ', ['客席からの見え方', '演者の動き'], ['g-photo1', 'g-broad'], ['照明の下での見え方', 'ズボンのコットンブロード']),
      chapter(3, '本番に向けた直し', ['早替えの工夫', '小道具との組み合わせ'], ['g-mood', 'g-process'], ['色を決めたときの資料', '仕上げの刺繍']),
    ]
    window.__editor.update((r) => ({ ...r, body: [...r.body.slice(0, 2), ...extra, ...r.body.slice(2)] }))
  })
  await sleep(1500)
  await ready(page)
  await sleep(800)
  await capture('long-', ['toc', 'body'])
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
        // スマホの案C2 は、ページの絵の行（.pp-strip）だけを横に動かす作りなので、その行の中は見ない
        if (el.closest('.pp-strip')) continue
        if (r.right > innerWidth + 1 || r.left < -1) bad.push(`画面の外：${el.className || el.tagName}`)
        // 名前が長いファイルは「…」で省く作りなので、そこは見ない
        if (cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1 && !el.matches('.fn, .r-l, .modal, .mini')) bad.push(`切れている：${el.className || el.tagName}`)
        if (phone && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(cs.fontSize) < 12.9 && !el.closest('figcaption, .src, .kd, .brand small')) small.add(`${el.className || el.tagName} ${cs.fontSize}`)
      }
      if (small.size) bad.push(`字が小さい：${[...small].join(' / ')}`)
      return [...new Set(bad)].slice(0, 8)
    }, phone)
    .then((bad) => bad.length && console.log(`  ！${name}：${bad.join(' ／ ')}`))

/**
 * 撮る。
 * full：画面より縦に長いときは、画面の高さをページに合わせて全部を撮る（下に固定した帯は、いちばん下に来る）
 * quiet：縦に長くても知らせない（窓が画面に重なる場面・最初の1画面だけを撮る場面）
 * 戻り値：画面より縦に長かったか
 */
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
  return tall
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
  // 画面の作り：案A・B・C を、開いたところ・入れたところ・保存したところで
  for (const layout of ['a', 'b', 'c'])
    for (const state of ['empty', 'loaded', 'done']) {
      await open(pc, layout, `state=${state}`)
      await snap(pc, `${layout}-${state}-pc`, { full: true })
    }
  // はじめに Word だけ入れたとき（PDF はまだ）
  await open(pc, 'a', 'state=word')
  await snap(pc, 'a-word-pc', { full: true })
  // Word を入れなかったとき（PDF だけ）：要らない決まり（決定）／要る決まり
  await open(pc, 'a', 'state=pdfonly')
  await snap(pc, 'a-pdfonly-pc', { full: true })
  await open(pc, 'a', 'state=pdfonly&req=1')
  await snap(pc, 'a-pdfonly-req-pc', { full: true })

  // 案C2（ページを見せる＋指摘は右に）：開いたところ・Word だけ・入れたところ・確かめの窓・保存したところ
  for (const [name, query] of [['empty', 'state=empty'], ['word', 'state=word'], ['loaded', 'state=loaded'], ['confirm', 'state=loaded&confirm=1'], ['done', 'state=done']]) {
    await open(pc, 'c2', query)
    await snap(pc, `c2-${name}-pc`, { full: true })
  }
  // 長い原稿（本文 12ページ、18 エラー・6 警告）：案C と案C2 を、最初の1画面で比べる。縦に長ければ、全部も撮る
  for (const layout of ['c', 'c2']) {
    await open(pc, layout, 'state=loaded&case=long')
    const tall = await snap(pc, `${layout}-long-pc`, { quiet: true })
    console.log(`    ${layout}：${tall ? '1画面に収まらない（縦に動かす）' : '1画面に収まる'}`)
    if (tall) await snap(pc, `${layout}-long-full-pc`, { full: true })
  }

  // エラーが残っているとき：まとめる所だけを、3つの決まりで（決まったのは (c)）
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

  // ---- スマホ ----
  const ph = await browser.newPage()
  ph.on('pageerror', (e) => console.log('pageerror:', e.message))
  await ph.setUserAgent(UA_IPHONE)
  await ph.setViewport(PHONE)
  // 案A
  for (const [state, query] of [['empty', 'state=empty'], ['loaded', 'state=loaded'], ['done', 'state=done&result=iphone'], ['pdfonly', 'state=pdfonly']]) {
    await open(ph, 'a', query)
    // 保存したあとの窓は、画面の高さのまま撮る（窓は画面に重なる）
    await snap(ph, `a-${state}-ph`, { full: state !== 'done', quiet: state === 'done', phone: true })
  }
  // 案C2：入れたところ・保存したところ
  for (const [state, query] of [['loaded', 'state=loaded'], ['done', 'state=done&result=iphone']]) {
    await open(ph, 'c2', query)
    await snap(ph, `c2-${state}-ph`, { full: true, phone: true })
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
  const fixed = '<em class="rec fixed">決定</em>'
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
  :root { --ink: #24262b; --muted: #5d6068; --accent: #2f3e75; --line: #ecebe8; --ok: #3f7a55; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px 32px 48px; background: #eceae6; font-family: 'BIZ UDPGothic', 'Yu Gothic UI', sans-serif; color: var(--ink); }
  h1 { font-size: 21px; margin: 0 0 4px; letter-spacing: 0.04em; }
  h2 { font-size: 18px; margin: 36px 0 6px; letter-spacing: 0.04em; }
  h2 small { margin-left: 8px; font-size: 13px; font-weight: 400; color: var(--muted); letter-spacing: 0; }
  .lead { margin: 0 0 16px; font-size: 13.5px; color: var(--muted); line-height: 1.8; max-width: 1180px; }
  .ask { margin: 0 0 8px; padding: 14px 18px 12px; background: #fff; border-radius: 14px; box-shadow: 0 2px 10px rgba(0,0,0,0.08); max-width: 1180px; }
  .ask h2 { margin: 0 0 6px; font-size: 15px; }
  .ask ol, .ask ul { margin: 0; padding-left: 22px; font-size: 13.5px; line-height: 2; }
  .ask em { font-style: normal; color: var(--accent); font-weight: 700; }
  .ask.decided { box-shadow: inset 4px 0 0 var(--ok), 0 2px 10px rgba(0,0,0,0.08); }
  .ask.decided h2 { color: var(--ok); }
  .ask.decided em { color: var(--ink); }
  .flow { margin: 0 0 8px; padding: 10px 18px; background: #fff; border-radius: 14px; box-shadow: 0 2px 10px rgba(0,0,0,0.08); max-width: 1180px; font-size: 13px; line-height: 1.9; }
  .flow b { color: var(--accent); }
  .fn { font-family: 'Segoe UI', 'BIZ UDPGothic', sans-serif; }
  figure { margin: 0 0 18px; background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.08); }
  figure.is-rec { box-shadow: 0 0 0 2.5px var(--accent), 0 2px 10px rgba(0,0,0,0.08); }
  figcaption { padding: 12px 16px 10px; border-bottom: 1px solid var(--line); }
  figcaption b { display: block; font-size: 15.5px; margin-bottom: 3px; }
  figcaption span { font-size: 13px; color: var(--muted); line-height: 1.7; }
  .rec { display: inline-block; margin-left: 8px; padding: 1px 9px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 11.5px; font-style: normal; font-weight: 700; letter-spacing: 0.06em; vertical-align: 2px; }
  .rec.fixed { background: var(--ok); }
  img { display: block; width: 100%; }
  .strip { display: grid; gap: 1px; background: var(--line); align-items: start; }
  .strip + .strip { border-top: 1px solid var(--line); }
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
  .mg.is-fixed { box-shadow: inset 0 0 0 2.5px var(--ok); }
  .cell-rec { box-shadow: inset 0 0 0 2.5px var(--accent); }
  .note-cell { padding: 14px 16px; font-size: 13px; line-height: 1.8; color: #3f4249; }
  .note-cell p { margin: 0 0 8px; }
  .note-cell ul { margin: 0; padding-left: 18px; }
  .pw { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--line); border-top: 1px solid var(--line); }
  .pw > div { background: #fff; padding: 10px 16px 12px; font-size: 13px; line-height: 1.75; }
  .pw b { font-size: 12.5px; letter-spacing: 0.06em; }
  .pw .good b { color: #3f7a55; }
  .pw .weak b { color: #b5443b; }
  .pw ul { margin: 4px 0 0; padding-left: 18px; }
  .diff { background: #fff; border-radius: 14px; padding: 12px 18px; box-shadow: 0 2px 10px rgba(0,0,0,0.08); max-width: 1180px; margin: 0 0 10px; font-size: 13.5px; line-height: 1.9; }
  .diff ul { margin: 0; padding-left: 20px; }
  .diff b { color: var(--accent); }
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
  <p class="lead">Word のひな形（<span class="fn">01_表紙</span>〜<span class="fn">04_本文</span>）で書いている学生のためのページです。Word を確かめ（作成ツールと同じセルフチェック）、Word から保存した PDF と作品写真を、1つの PDF にまとめます。ファイルは学生の端末の中だけで読み、外には送りません。ログインも要りません。どの画面も、見た目だけの試作です（まだ作っていません）。例は、文化花子（00ZZ0123。架空）の原稿です。</p>
  <div class="ask decided">
    <h2>決まったこと</h2>
    <ul>
      <li>エラーが残っているとき：<em>確かめの窓を出して、そのまままとめる</em>（透かしなし。ファイル名もそのまま）</li>
      <li>Word：<em>入れなくても、まとめられる</em>（「Word を入れていないので、チェックしていません」と知らせる）</li>
    </ul>
  </div>
  <div class="ask">
    <h2>この v30 で決めていただきたいこと</h2>
    <ol>
      <li>画面の作り：案A／B／C／C2　<em>おすすめ：案C を選ぶなら、案C2「ページを見せる＋指摘は右に」</em></li>
      <li>スマホの形（案C2 は、パートを縦に並べる形。下の「案C2 のスマホ」）でよいか</li>
      <li>確かめの窓の言葉（「エラーが5件残っています。このまままとめますか？」）でよいか</li>
    </ol>
  </div>
  <div class="flow"><b>流れ</b>：ファイルを入れる（Word・PDF・作品写真を、まとめて）→ 名前を見て、5つの場所（表紙・抄録・目次・本文・作品写真）に自動で分ける → Word を読んで、直すところを出す → 学生が Word で直し、PDF にして、もう一度入れる →「1つの PDF にまとめる」→「<span class="fn">2026_卒業制作報告書_学籍番号_氏名.pdf</span>」を保存。</div>
  <div class="flow"><b>できないこと</b>：書式を直すこと（直すのは Word で）／ Word を PDF にすること（Word の「名前を付けて保存」で）／ パスワードの付いた PDF をまとめること。</div>

  <h2>案C を選ぶ場合：C と C2 の比べ</h2>
  <p class="lead">案C は、指摘が増えると弱点が出ます。そこで、指摘を右の一覧に移した「案C2」を足しました。下は、長い原稿（本文 12ページ、18 エラー・6 警告）を入れたときの、パソコンの最初の1画面です。</p>
  <figure>
    <figcaption><b>長い原稿を入れたとき（最初の1画面）</b><span>左：案C（指摘はページの下）　右：案C2（指摘は右の一覧）</span></figcaption>
    <div class="strip pc2">
      ${img('c-long-pc', '<b>案C</b>：見えるのは、9ページ目までと、指摘 24件のうち14件。続きは、画面を下に動かす')}
      ${img('c2-long-pc', `<b>案C2${rec}</b>：15ページと作品写真の枠が、全部見える。指摘は 24件のうち6件。続きは、右の欄の中だけを動かす`, 'cell-rec')}
    </div>
    <div class="strip pc12">
      ${img('c-long-full-pc', '<b>案C を下まで動かした全体</b>（縦に約1.8画面）')}
      <div class="note-cell"><p><b>案C で起きること</b></p><ul><li>指摘の札が、ページとページの間に入るので、原稿の続き（10ページ目から先と、作品写真の空の枠）が画面の外に出ます。</li><li>札は3列に並びます。一度に多く見えますが、どの順に読むかが分かりにくくなります。</li><li>直して入れ直すたびに、札の数が変わり、ページの位置も上下に動きます。</li></ul></div>
    </div>
  </figure>
  <div class="diff">
    <ul>
      <li><b>1画面に入る量</b>：案C は、9ページ目までと、指摘 24件のうち14件。案C2 は、全部のページと、指摘 6件。案C2 の残りの指摘は、右の欄を動かして読みます（欄3つ分ほどの長さ。ページは動きません）。</li>
      <li><b>ページの絵の大きさ</b>：案C2 は、右に一覧を置く分、案C より2割ほど小さくなります（幅 136 → 108。短い原稿のときは、案C と同じくらい）。どちらも字は読めず、図・写真の位置とページの数を見るための絵です。</li>
      <li><b>指摘の読みやすさ</b>：案C2 は案A と同じ1列の一覧で、文が折れにくく、押すとそのページに枠が付きます。案C は、一度に見える件数が多い代わりに、札が狭くて文が折れ、3列をどの順に読むかが分かりにくくなります。</li>
      <li><b>どちらにも残る弱点</b>：「どのページか」は、Word の文を PDF の中から探して出すので、分からない指摘が残ります（案C2 は札が「本文」だけになります）。Word だけを入れた段階では、ページの枠は空のままです。</li>
    </ul>
  </div>
  <p class="why"><b>おすすめ：案C を選ぶなら案C2</b>。案C の良さ（まとめた PDF をページで見せる・足りない所が空の枠で分かる）はそのままで、指摘が増えても画面がくずれません。Word だけを入れた段階でも、右の一覧は使えます。</p>

  <figure class="is-rec">
    <figcaption><b>案C2　ページを見せる＋指摘は右に${rec}</b><span>左に、まとめた PDF のページ（5つのパートの見出しの下に、入っているファイルの名前）。右に、チェックの結果（どこの指摘かの札つき）。下に「まとめる」</span></figcaption>
    <div class="strip pc3">
      ${img('c2-empty-pc', '<b>開いたところ</b>：空の枠が、できあがりの順に並ぶ')}
      ${img('c2-word-pc', '<b>Word だけ入れたとき</b>：枠は空のまま。指摘は右に出る（札はパートだけ）')}
      ${img('c2-loaded-pc', '<b>入れたところ</b>（5 エラー・1 警告）：選んだ指摘のページに枠。赤い丸は、そのページの指摘の数')}
    </div>
    <div class="strip pc3">
      ${img('c2-confirm-pc', '<b>エラーが残ったまま「まとめる」を押したとき</b>：確かめの窓（はじめは「戻って直す」）')}
      ${img('c2-done-pc', '<b>保存した</b>：上に結果、下に全ページ')}
      <div class="note-cell"><ul><li>札は、ページが分かれば「本文 3ページ目」、分からなければ「本文」だけ。</li><li>外す：ファイルの名前の右の ×。入れ替える：同じ場所にもう一度入れる。</li><li>ページの絵は、画面に収まる範囲で、できるだけ大きくします（ページが少ないほど大きい）。</li><li>「Word のほうが新しい」の知らせと、作品写真の空の枠は、案C と同じです。</li></ul></div>
    </div>
    <div class="strip ph4">
      ${img('c2-loaded-ph', '<b>案C2 のスマホ：入れたところ</b>', 'ph')}
      ${img('c2-done-ph', '<b>案C2 のスマホ：できた</b>（iPhone は「保存する」をもう一度押す）', 'ph')}
      <div class="note-cell" style="grid-column: span 2"><p><b>スマホ</b></p><ul><li>パートを縦に並べます。ページの絵は、その行の中だけで横に動かします（画面全体は横に動きません）。</li><li>チェックの結果は、その下に続けます。札（「本文 3ページ目」）と、ページの赤い丸で、場所が分かります。</li><li>「まとめる」は、下に固定します。</li></ul></div>
    </div>
    ${pros(['まとめた PDF の順とページの数が、ひと目で分かる。足りない所は空の枠', '指摘は案A と同じ読みやすい一覧。数が増えても、ページの並びは動かない', '指摘とページが結び付く（押すと枠・ページに数の丸）'], ['案A より作る物が多い（全ページの絵を作る・Word の文を PDF から探す）', 'ページの絵は、案C より少し小さい', 'ファイルの名前は小さな字になる（長い名前は「…」で省く）'])}
  </figure>

  <h2>これまでの案：A・B・C<small>（エラーが残っているときの決まりを、決定に合わせて直してあります）</small></h2>
  <p class="lead">3つの案を、「開いたところ」「ファイルを入れたところ（5 エラー・1 警告。作品写真はまだ。本文は Word のほうが新しい）」「保存したところ」で並べます。ファイルを入れる所は、どの案も1つです。</p>
  <figure>
    <figcaption><b>案A　一覧</b><span>左に5つの置き場所（Word はチェック用、PDF はまとめる用）、右にチェックの結果、下に「まとめる」。1つの画面で全部が見える</span></figcaption>
    <div class="strip pc3">
      ${img('a-empty-pc', '<b>開いたところ</b>：入れる所と、空の置き場所')}
      ${img('a-loaded-pc', '<b>入れたところ</b>：置き場所の知らせ（本文・作品写真）と、指摘の一覧')}
      ${img('a-done-pc', '<b>保存した</b>：窓に、ページが順に並ぶ（作成ツールと同じ形）')}
    </div>
    <div class="strip pc12">
      ${img('a-word-pc', '<b>はじめに Word だけ入れたとき</b>（PDF はまだ）')}
      <div class="note-cell"><p>多くの学生は、まず Word だけを入れて確かめるはずです。</p><p>PDF の所には「PDF がまだありません」と出し、下に PDF の作り方を1行で出します。</p><p>外す：ファイルの右の ×。入れ替える：同じ場所にもう一度入れる。</p></div>
    </div>
    <div class="strip ph4">
      ${img('a-empty-ph', '<b>案A のスマホ：開いたところ</b>', 'ph')}
      ${img('a-loaded-ph', '<b>入れたところ</b>', 'ph')}
      ${img('a-done-ph', '<b>できた</b>（iPhone）', 'ph')}
      ${img('a-pdfonly-ph', '<b>PDF だけ入れたとき</b>', 'ph')}
    </div>
    ${pros(['置き場所と指摘が同時に見える。直して入れ直しても、画面が変わらない', '作成ツールと同じ並び（右がチェック、下が書き出し）', 'いちばん少ない手間で作れる'], ['1つの画面にのる物が多い', 'ページの見た目は、小さな絵（1ページ目）と、保存したあとの窓だけ'])}
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
    ${pros(['できあがりの順とページの数が、ひと目で分かる', '足りない所が、空の枠で分かる', 'ページの絵が、いちばん大きい'], ['指摘が増えると、縦に長くなり、原稿の続きが画面の外に出る（上の比べ）', '指摘の札が狭く、文が折れて読みにくい。ファイル名も見えない', 'Word だけ入れた段階では、枠が空のまま。スマホでは横に並べられない'])}
  </figure>
  <p class="why">はじめのおすすめは<b>案A</b> でした（「直す → PDF にする → 入れ直す」をくり返す画面なので、置き場所と指摘が同じ画面にある形がよい、という理由です）。案C2 は、この案A の良さ（右の一覧・下の「まとめる」）を引き継いで、左をページの並びに替えたものです。</p>

  <h2>決まったこと（控え）</h2>
  <figure>
    <figcaption><b>エラーが残っているときの「まとめる」</b><span>3つの決まりを比べた図です。決まったのは (c)</span></figcaption>
    <div class="strip pc3">
      ${img('err-a', '<b>(a) まとめられない</b>エラーを0件にしてから', 'mg')}
      ${img('err-b', '<b>(b)「下書き」の透かしを入れてまとめる</b>ファイル名に「<span class="fn">_下書き</span>」。今の作成ツールと同じ決まり', 'mg')}
      ${img('err-c', `<b>(c) 確かめの窓を出して、そのまままとめる${fixed}</b>透かしは入らない。ファイル名もそのまま`, 'mg is-fixed')}
    </div>
  </figure>
  <p class="care"><b>ご承知おきください</b>：(c) では、まとめた PDF に、エラーが残っていたかどうかの印は付きません（受け取った先生の側では、見分けられません）。作成ツールの「下書き」の決まりとは、違う決まりになります。</p>
  <figure>
    <figcaption><b>Word を入れなかったとき</b><span>PDF と作品写真だけを入れた画面（案A の形で撮っています）。PDF から分かること（ページの数・A4）は確かめる</span></figcaption>
    <div class="strip pc2">
      ${img('a-pdfonly-pc', `<b>入れなくてもよい${fixed}</b>：「Word を入れていないので、チェックしていません」と知らせて、まとめられる`)}
      ${img('a-pdfonly-req-pc', '<b>必ず入れる</b>（選ばなかった案）：Word を入れるまで、まとめられない')}
    </div>
  </figure>

  <h2>作る前に、知っておいていただきたいこと</h2>
  <div class="test">
    <ul>
      <li>チェックの決まり（エラーと警告の分け方、言い回し）は、作成ツールと同じにします。画面の指摘は、例です。</li>
      <li>ファイルは、名前（<span class="fn">01_表紙</span> など）で分けます。名前を変えている学生のために、違う場所に入ったファイルを、手で移せるようにします。</li>
      <li>学籍番号と氏名は、表紙から読み取ります。読めないときは、手で入れる欄を出します。</li>
      <li>作品写真が2枚以上のときの置き方（1枚ずつ1ページ／1ページに並べる）は、作るときに決めます。</li>
      <li>Word の読み取りと、「どのページの指摘か」を探す仕組みは、これから実際の学生のファイルで試します。</li>
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
