// デザイン案 v28（「PDFを書き出す」で、印刷の画面を通さずに PDF をそのまま保存する）を画像に書き出す。
// 本物の学生用ツールに、案の部品（窓・進み具合の帯）を仮に重ねて撮る（ツール本体は変えない）。
// PDF はツールの中で作る（src/pdf/pagesToPdf.ts：紙面の各ページを画像にして PDF にまとめる）。印刷の画面は「うまくいかないとき」の予備に残す。
// 使い方: node scripts/mockup-shots-v28.mjs [shots] [review]（何も付けなければ全部。開発サーバーが http://localhost:5173 で動いていること）
//   Edge は EDGE_PORT（ふだんは 9408）で起動する
// 学生用ツールは Google のログインとドライブを偽物（scripts/e2e/fakeGoogle.mjs）に差し替える。本物の Google にはつながない。
// 中身の例：衣装コースの学生（文化花子・00ZZ0123。架空）。見本の画像は docs/guide-images/sample/（読むだけ）
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

process.env.EDGE_PORT ??= '9408'
const { withEdge } = await import('./poc/edge.mjs')
const { fakeDrive, routeGoogle } = await import('./e2e/fakeGoogle.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const DIR = 'mockups/v28'
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })
const ONLY = process.argv.slice(2)
const want = (k) => ONLY.length === 0 || ONLY.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PC = { width: 1440, height: 900, deviceScaleFactor: 1.5 }
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
}
const EMAIL = '00zz0123@bunka-wu.ac.jp'
const config = JSON.parse(readFileSync('scripts/e2e/config-fixture.json', 'utf8'))
for (const c of config.courses) delete c.notice

/** ファイル名（今の書き出しと同じ：年度_報告書の名前_学籍番号_氏名。下書きは _下書き） */
const FILE = (draft) => `2026_卒業制作報告書_00ZZ0123_文化花子${draft ? '_下書き' : ''}.pdf`

// ---- アイコン（src/app/icons.tsx と同じ線の太さ） ----
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const IC = {
  pdf: svg('<path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4M12 11v6M9.5 14.5L12 17l2.5-2.5"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  share: svg('<path d="M12 3.5v11M8 7.5l4-4 4 4M6.5 11H5v9.5h14V11h-1.5"/>'),
  warn: svg('<path d="M12 4l9 16H3zM12 10v4.5M12 17.2v.1"/>'),
  open: svg('<path d="M14 4.5h5.5V10M19.5 4.5L11 13M17 13.5v6H4.5V7H11"/>'),
}

const CSS = `
  /* 撮影のために足す部品（案の部品）。色と書体は src/index.css のもの */
  .v28-layer { z-index: 55; }
  .modal.v28 { width: min(580px, calc(100vw - 32px)); }
  .modal.v28.wide { width: min(760px, calc(100vw - 32px)); }
  .modal.v28 h2 { display: flex; align-items: center; gap: 8px; }
  .v28-ok { width: 26px; height: 26px; flex: none; display: grid; place-items: center; border-radius: 50%; background: var(--ok); color: #fff; }
  .v28-ok svg { width: 17px; height: 17px; stroke-width: 2.2; }
  .v28-ng { width: 26px; height: 26px; flex: none; display: grid; place-items: center; color: var(--error); }
  .v28-ng svg { width: 24px; height: 24px; }
  /* 保存するファイル */
  .v28-file { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 10px; align-items: center; margin: 4px 0 14px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel-bg); }
  .v28-file > svg { width: 28px; height: 28px; color: var(--accent); }
  .v28-file b { display: block; font-size: 13.5px; font-family: 'Segoe UI', 'BIZ UDPGothic', sans-serif; overflow-wrap: anywhere; }
  .v28-file small { display: block; margin-top: 1px; font-size: 12px; line-height: 1.6; color: var(--muted); }
  .v28-file.draft > svg { color: var(--error); }
  /* 予備：印刷の画面から保存（小さなリンク） */
  .modal .row-buttons .v28-fallback { font-size: 12px; color: var(--muted); }
  .draft-box .v28-fallback { display: block; margin-top: 8px; font-size: 12px; color: var(--muted); text-decoration: underline; text-underline-offset: 3px; border: 0; background: none; padding: 0; }
  /* 進み具合 */
  .v28-progress { display: flex; align-items: center; gap: 12px; margin: 6px 0 8px; }
  .v28-bar { flex: 1; height: 8px; border-radius: 4px; background: var(--chip-bg); overflow: hidden; }
  .v28-bar i { display: block; height: 100%; border-radius: 4px; background: var(--accent); }
  .v28-progress span { font-size: 13px; color: var(--muted); white-space: nowrap; }
  .v28-progress span b { font-size: 16px; color: var(--ink); }
  .v28-small { margin: 0; font-size: 12px; line-height: 1.7; color: var(--muted); }
  /* iPhone：2回目のタップ「保存する」 */
  .modal button.v28-big { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 13px 0; font-size: 16px; border-radius: 12px; }
  .modal button.v28-big svg { width: 20px; height: 20px; }
  .modal .v28-btn { display: inline-flex; align-items: center; gap: 6px; }
  .modal .v28-btn svg { width: 17px; height: 17px; }
  /* できたページの縮小（案C） */
  .v28-thumbs { display: grid; grid-template-columns: repeat(var(--cols, 6), minmax(0, 1fr)); gap: 10px 8px; margin: 4px 0 12px; padding: 12px; border-radius: 12px; background: var(--stage-bg); }
  .v28-thumbs figure { margin: 0; text-align: center; font-size: 10.5px; color: var(--muted); }
  .v28-tile { position: relative; width: 100%; aspect-ratio: 1 / 1.4142; overflow: hidden; background: #fff; box-shadow: 0 1px 2px rgba(30, 25, 20, 0.1); margin-bottom: 3px; }
  .v28-tile .mini-page { display: block !important; position: absolute !important; left: 0; top: 0; margin: 0 !important; transform-origin: 0 0; }
  .v28-tile.wait { background: #f4f2ee; box-shadow: inset 0 0 0 1px #e2ded7; }
  .v28-tile.now { background: #fff; box-shadow: inset 0 0 0 2px var(--accent); }
  /* 下書き：どのページにも透かし（PDF の画像と同じ見た目を、縮小の絵にも出す） */
  .v28-thumbs.draft .v28-tile::after { content: '下書き'; position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) rotate(-32deg); font-weight: 700; font-size: 13px; letter-spacing: 0.2em; color: rgba(181, 68, 59, 0.35); white-space: nowrap; }
  .v28-tile.now::after { content: ''; position: absolute; left: 50%; top: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; border: 2.5px solid var(--accent-soft); border-top-color: var(--accent); }
  /* 案B：進み具合の帯（PC は下、スマホは上） */
  .v28-strip { position: fixed; z-index: 35; display: flex; align-items: center; gap: 12px; padding: 10px 10px 10px 16px; border-radius: 14px; background: #fff; border: 1px solid var(--line); box-shadow: 0 12px 32px rgba(20, 20, 30, 0.22); font-size: 13.5px; color: var(--ink); }
  .v28-strip .t { display: grid; gap: 4px; min-width: 0; flex: 1; }
  .v28-strip .t b { font-size: 14px; }
  .v28-strip .t small { font-size: 11.5px; color: var(--muted); font-family: 'Segoe UI', 'BIZ UDPGothic', sans-serif; overflow-wrap: anywhere; }
  .v28-strip .v28-bar { height: 6px; }
  .v28-strip button { flex: none; display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; background: #fff; color: var(--ink); font: inherit; font-size: 13px; white-space: nowrap; }
  .v28-strip button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 700; }
  .v28-strip button svg { width: 17px; height: 17px; }
  .v28-strip button.x { border: 0; padding: 4px 6px; font-size: 18px; color: var(--muted); }
  .v28-strip .ic { flex: none; }
  .v28-strip.ng { border-color: #e6c5c1; }
  .v28-strip.ng .t b { color: var(--error); }
  .v28-strip.narrow { flex-wrap: wrap; gap: 8px 10px; padding: 10px 10px 10px 14px; }
  .v28-strip.narrow .t { flex-basis: 100%; }
  .v28-strip.narrow .acts { display: flex; gap: 8px; margin-left: auto; }
  /* 書けない間、紙面に重ねる薄い幕（案B：作っている間は見るだけ） */
  .v28-lockpaper .page-viewport.front { opacity: 0.55; }
  @media (max-width: 600px) {
    .modal.v28, .modal.v28.wide { padding: 18px 18px 20px; }
    .modal .row-buttons .v28-fallback { flex-basis: 100%; order: 9; text-align: left; margin-top: 4px; }
  }
`

/** 窓（ツールの Modal と同じ形） */
const modal = (title, body, cls = '') => `<div class="modal-backdrop v28-layer"><div class="modal v28 ${cls}" role="dialog"><header><h2>${title}</h2><button class="close" aria-label="閉じる">×</button></header>${body}</div></div>`

/** 端末ごとの、印刷の画面での選び方（今の書き出しの窓と同じ文） */
const PRINT_STEPS = {
  pc: ['送信先：<b>PDF として保存</b>', '用紙サイズ：<b>A4</b>　／　倍率：<b>既定（100%）</b>', '詳細設定の「ヘッダーとフッター」：<b>オフ</b>　「背景のグラフィック」：<b>オン</b>'],
  iphone: ['印刷の画面の右上（または下）の <b>共有のボタン（四角に上向きの矢印）</b> を押し、<b>「"ファイル"に保存」</b> を選ぶ', '保存する場所を選んで「保存」'],
  android: ['上のプリンターを <b>「PDF 形式で保存」</b> にする', '用紙サイズ：<b>A4</b>　→　<b>PDF のボタン</b> を押して保存'],
}
const DEVICE_NAME = { pc: 'Windows・Edge', iphone: 'iPhone・Safari', android: 'Android・Chrome' }

const CHECKS = ['タイトル（サブタイトルを含む）は、以前提出した申告書と同じにした', '作品写真は、自分で撮影した写真だけを使った', '指導教員に内容を見てもらい、了承を得た']

/** ① 3つを確かめる（今と同じ）。ボタンは PC・Android「PDF を保存する」、iPhone「PDF を作る」（保存は、できたあとにもう一度押す） */
const confirmBody = (device) => `
  <p class="lead">エラーはありません。最後に、次のことを確認してください。</p>
  <div class="checklist">${CHECKS.map((c) => `<label><input type="checkbox" checked> ${c}</label>`).join('')}</div>
  <div class="v28-file">${IC.pdf}<div><b>${FILE(false)}</b><small>${
    device === 'iphone' ? 'できたら「保存する」を押し、「"ファイル"に保存」を選びます' : '「ダウンロード」のフォルダに保存します'
  }</small></div></div>
  <div class="row-buttons"><button class="link v28-fallback">うまくいかないとき：印刷の画面から保存</button><span class="spacer"></span><button>やめる</button><button class="primary">${device === 'iphone' ? 'PDF を作る' : 'PDF を保存する'}</button></div>`

/** エラーが残っているとき（今の窓の「下書きの PDF」を、そのまま保存にする） */
const draftEntryBody = (device) => `
  <p class="lead">手順書のルールに合っていない箇所（エラー）が <b class="ng">2件</b> あります。エラーを0件にすると、提出用のPDFを書き出せます。</p>
  <ul class="error-list">
    <li><button class="link">本文：「見頃」ではなく「身頃」と書く</button><span class="detail">（「見頃」→「身頃」（服の胴の部分））</span></li>
    <li><button class="link">本文：「です・ます」ではなく「である」調で書く</button><span class="detail">（「です」→「である」）</span></li>
  </ul>
  <div class="draft-box"><b>先生に途中経過を見せるとき</b>エラーが残っていても、どのページにも「下書き」の透かしが入った PDF を保存できます（提出には使えません）。<br>
    <button class="primary">${device === 'iphone' ? '下書きの PDF を作る' : '下書きの PDF を保存する'}</button>
    <button class="v28-fallback">うまくいかないとき：印刷の画面から保存</button></div>
  <div class="row-buttons"><span class="spacer"></span><button class="primary">直しに戻る</button></div>`

/** ② 作っている（progress：できたページの数、total：全部のページの数） */
const buildBody = (done, total, { thumbs = '', draft = false } = {}) => `
  <p class="lead">この画面のまま、お待ちください。${draft ? '（下書きの透かしを入れています）' : ''}</p>
  <div class="v28-progress"><div class="v28-bar"><i style="width:${Math.round((done / total) * 100)}%"></i></div><span><b>${done}</b> / ${total}ページ</span></div>
  ${thumbs}
  <p class="v28-small">写真が多いと、少し時間がかかります（20ページで10秒ほど。スマホはもう少し）。</p>
  <div class="row-buttons"><span class="spacer"></span><button>やめる</button></div>`

/** ③ できた・保存した */
const doneBody = (device, total, { thumbs = '', draft = false } = {}) => {
  const size = `${total}ページ・2.9MB`
  if (device === 'iphone')
    return `
  <div class="v28-file${draft ? ' draft' : ''}">${IC.pdf}<div><b>${FILE(draft)}</b><small>${size}</small></div></div>
  ${thumbs}
  <p class="lead">「保存する」を押して、「"ファイル"に保存」を選んでください。</p>
  <button class="primary v28-big">${IC.share}保存する</button>
  <div class="row-buttons"><span class="spacer"></span><button>閉じる</button></div>`
  return `
  <div class="v28-file${draft ? ' draft' : ''}">${IC.pdf}<div><b>${FILE(draft)}</b><small>${size}　「ダウンロード」のフォルダ</small></div></div>
  ${thumbs}
  <p class="lead">${draft ? 'どのページにも「下書き」の透かしが入っています（提出には使えません）。' : '開いて、ページの数と写真を確かめてください。'}</p>
  <div class="row-buttons"><span class="spacer"></span><button>閉じる</button><button class="primary v28-btn">${IC.open}PDF を開く</button></div>`
}

/** ④ 作れなかった：印刷の画面から保存（予備） */
const errorBody = (device) => `
  <p class="lead">この端末では、ツールの中で PDF を作れませんでした（メモリが足りないなど）。印刷の画面から保存してください。</p>
  <div class="print-guide"><b>印刷の画面で、次のように選んでください（${DEVICE_NAME[device]}）</b><ul>${PRINT_STEPS[device].map((s) => `<li>${s}</li>`).join('')}</ul>ファイル名は「<span class="fn">${FILE(false)}</span>」になります。</div>
  <div class="row-buttons"><span class="spacer"></span><button>もう一度作る</button><button class="primary">印刷の画面を開く</button></div>`

const TITLE = {
  confirm: '提出用のPDFを書き出す',
  draftEntry: 'PDFを書き出す前に',
  build: 'PDF を作っています',
  buildDraft: '下書きの PDF を作っています',
  donePc: `<span class="v28-ok">${IC.check}</span>保存しました`,
  doneDraftPc: `<span class="v28-ok">${IC.check}</span>下書きの PDF を保存しました`,
  doneIphone: 'PDF ができました',
  error: `<span class="v28-ng">${IC.warn}</span>PDF を作れませんでした`,
}

/** ページの中で、紙面のページを複製して、縮小の絵を作る（案C）。done：できたページの数（その次は「作っている」、残りは空） */
function thumbsHtml(done, cols, tileW) {
  const pages = window.__editor.pageElements().filter((p) => !p.classList.contains('print-skip'))
  const scale = tileW / 793.7
  const tiles = pages.map((p, i) => {
    if (i >= done) return `<figure><div class="v28-tile ${i === done ? 'now' : 'wait'}"></div>${i + 1}</figure>`
    const clone = p.cloneNode(true)
    clone.className = 'mini-page'
    clone.removeAttribute('id')
    for (const el of clone.querySelectorAll('[id]')) el.removeAttribute('id')
    clone.style.transform = `scale(${scale})`
    return `<figure><div class="v28-tile">${clone.outerHTML}</div>${i + 1}</figure>`
  })
  return `<div class="v28-thumbs" style="--cols:${cols}">${tiles.join('')}</div>`
}

// =====================================================================
// 学生用ツールを開く（v27 と同じ。指差し確認は見たことにしておく）
// =====================================================================

const noHotReload = (page) =>
  page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  })

const ready = (page) =>
  page.waitForFunction(() => {
    const s = window.__editor?.getSnapshot()
    return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading')
  }, { timeout: 120000 })
const driveSaved = (page) =>
  page.waitForFunction(() => [...document.querySelectorAll('.chip.ok')].some((c) => /ドライブに保存|\d+:\d+/.test(c.textContent)) && !document.querySelector('.chip .dot.busy'), { timeout: 60000 })

/** 見本の原稿（本文5ページ・図3枚・素材表・作品写真1枚・抄録）。make-help-images.mjs と同じもの */
const setupWriting = readFileSync('scripts/make-help-images.mjs', 'utf8').match(/async function setupWriting\(\) \{[\s\S]*?\n\}\n/)[0]

async function openStudent(browser, { device }) {
  const phone = device !== 'pc'
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  page.on('dialog', (d) => d.accept())
  await noHotReload(page)
  if (phone) await page.setUserAgent(UA[device])
  await page.setViewport(phone ? PHONE : PC)
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
  await page.evaluate(`(${setupWriting.replace(/^async function setupWriting\(\)/, 'async () =>')})()`)
  await sleep(800)
  await ready(page)
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('p3'), 'none'))
  await sleep(600)
  await ready(page)
  await driveSaved(page)
  await page.addStyleTag({ content: CSS })
  await page.mouse.move(5, 5)
  await page.bringToFront()
  return { context, page }
}

/** 段落の文を書き換える（下書きの道：わざと誤りを入れる） */
const setParagraph = (page, id, text) =>
  page.evaluate((id, text) => window.__editor.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === id ? { ...b, content: [{ type: 'text', text }] } : b)) })) })), id, text)

const clear = (page) => page.evaluate(() => {
  for (const el of document.querySelectorAll('.v28-layer, .v28-strip')) el.remove()
  document.documentElement.classList.remove('v28-lockpaper')
})
const add = (page, html) => page.evaluate((html) => document.body.insertAdjacentHTML('beforeend', html), html)
const shot = async (page, name) => {
  await sleep(350)
  await page.screenshot({ path: `${OUT}/${name}.png`, captureBeyondViewport: false })
  console.log(`  ${OUT}/${name}.png`)
}
/** 窓が画面の中に収まっているか（はみ出しの確かめ） */
const fits = (page, name) =>
  page.evaluate(() => {
    const bad = []
    // 縮小した紙面の中（目次の点線など）は、紙面のままなので見ない
    for (const el of [...document.querySelectorAll('.v28, .v28 *, .v28-strip, .v28-strip *')].filter((e) => !e.closest('.v28-tile'))) {
      const r = el.getBoundingClientRect()
      if (r.width && (r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1)) bad.push(el.className || el.tagName)
      const cs = getComputedStyle(el)
      if (cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1 && !el.classList.contains('modal')) bad.push(`${el.className}:横`)
    }
    const m = document.querySelector('.modal.v28')
    if (m && m.scrollHeight > m.clientHeight + 1) bad.push('窓の中が縦に長い（動かして読む）')
    return [...new Set(bad)].slice(0, 6)
  }).then((bad) => bad.length && console.log(`  ！${name}：${bad.join(' / ')}`))

/** 案B の帯（PC は紙面の下のまん中、スマホは上の帯のすぐ下） */
async function strip(page, html, { narrow, ng = false }) {
  const pos = await page.evaluate((narrow) => {
    if (narrow) return 'left:8px;right:8px;top:56px'
    const s = document.querySelector('.stage').getBoundingClientRect()
    const w = 560
    return `left:${s.left + (s.width - w) / 2}px;width:${w}px;bottom:22px`
  }, narrow)
  await add(page, `<div class="v28-strip${narrow ? ' narrow' : ''}${ng ? ' ng' : ''}" style="${pos}">${html}</div>`)
}

// =====================================================================
// 撮る
// =====================================================================

async function shots(browser) {
  for (const device of ['pc', 'iphone', 'android']) {
    const { context, page } = await openStudent(browser, { device })
    const narrow = device !== 'pc'
    const d = device === 'pc' ? 'pc' : device === 'iphone' ? 'ph' : 'an'
    const total = await page.evaluate(() => window.__editor.pageElements().filter((p) => !p.classList.contains('print-skip')).length)
    const mid = Math.min(3, total - 1)
    console.log(`  ${device}：${total}ページ`)
    const cols = narrow ? 5 : 6
    const tileW = narrow ? 54 : 96

    if (device !== 'android') {
      // ---- どの案も同じ：3つを確かめる・エラーが残っているとき ----
      await add(page, modal(TITLE.confirm, confirmBody(device)))
      await fits(page, `common-confirm-${d}`)
      await shot(page, `common-confirm-${d}`)
      await clear(page)

      // ---- 案A：窓の中で、確かめる → 作る → 保存した ----
      await add(page, modal(TITLE.build, buildBody(mid, total)))
      await fits(page, `a-build-${d}`)
      await shot(page, `a-build-${d}`)
      await clear(page)
      await add(page, modal(device === 'pc' ? TITLE.donePc : TITLE.doneIphone, doneBody(device, total)))
      await fits(page, `a-done-${d}`)
      await shot(page, `a-done-${d}`)
      await clear(page)
      await add(page, modal(TITLE.error, errorBody(device)))
      await fits(page, `a-error-${d}`)
      await shot(page, `a-error-${d}`)
      await clear(page)

      // ---- 案B：窓を閉じて、小さな帯で知らせる ----
      await page.evaluate(() => document.documentElement.classList.add('v28-lockpaper'))
      await strip(
        page,
        `<div class="t"><b>PDF を作っています　${mid} / ${total}ページ</b><div class="v28-bar"><i style="width:${Math.round((mid / total) * 100)}%"></i></div><small>作っている間は、書けません（見ることはできます）</small></div>${narrow ? '<div class="acts"><button>やめる</button></div>' : '<button>やめる</button>'}`,
        { narrow },
      )
      await fits(page, `b-build-${d}`)
      await shot(page, `b-build-${d}`)
      await clear(page)
      await strip(
        page,
        device === 'pc'
          ? `<span class="v28-ok ic">${IC.check}</span><div class="t"><b>保存しました（「ダウンロード」のフォルダ）</b><small>${FILE(false)}</small></div><button class="primary">${IC.open}開く</button><button class="x" aria-label="閉じる">×</button>`
          : `<div class="t"><b>PDF ができました（${total}ページ）</b><small>押して、「"ファイル"に保存」を選びます</small></div><div class="acts"><button class="x" aria-label="閉じる">×</button><button class="primary">${IC.share}保存する</button></div>`,
        { narrow },
      )
      await fits(page, `b-done-${d}`)
      await shot(page, `b-done-${d}`)
      await clear(page)
      await strip(
        page,
        `<span class="v28-ng ic">${IC.warn}</span><div class="t"><b>PDF を作れませんでした</b><small>印刷の画面から保存できます</small></div>${narrow ? '<div class="acts"><button>もう一度</button><button class="primary">印刷の画面から保存</button></div>' : '<button>もう一度</button><button class="primary">印刷の画面から保存</button>'}`,
        { narrow, ng: true },
      )
      await fits(page, `b-error-${d}`)
      await shot(page, `b-error-${d}`)
      await clear(page)
    }

    // ---- 案C：窓の中で、できたページを小さな絵で見せる ----
    {
      const t1 = await page.evaluate(thumbsHtml, mid, cols, tileW)
      if (device !== 'android') {
        await add(page, modal(TITLE.build, buildBody(mid, total, { thumbs: t1 }), 'wide'))
        await fits(page, `c-build-${d}`)
        await shot(page, `c-build-${d}`)
        await clear(page)
      }
      const t2 = await page.evaluate(thumbsHtml, total, cols, tileW)
      const title = device === 'iphone' ? TITLE.doneIphone : TITLE.donePc
      await add(page, modal(title, doneBody(device, total, { thumbs: t2 }), 'wide'))
      await fits(page, `c-done-${d}`)
      await shot(page, `c-done-${d}`)
      await clear(page)
    }

    // ---- 下書きの道（エラーが残っているとき）：どの案も、入口は同じ。PC は案A・C、スマホは案C で、できたところまで ----
    if (device !== 'android') {
      await setParagraph(page, 'p7', '二回目の仮縫いでは、前見頃の丈を2cm短くした。袖の記事が重く、腕が下がって見えたためです。')
      await sleep(600)
      await ready(page)
      await add(page, modal(TITLE.draftEntry, draftEntryBody(device)))
      await fits(page, `common-draft-${d}`)
      await shot(page, `common-draft-${d}`)
      await clear(page)
      const t3 = (await page.evaluate(thumbsHtml, total, cols, tileW)).replace('class="v28-thumbs"', 'class="v28-thumbs draft"')
      await add(page, modal(device === 'iphone' ? '下書きの PDF ができました' : TITLE.doneDraftPc, doneBody(device, total, { thumbs: t3, draft: true }), 'wide'))
      await fits(page, `c-draftdone-${d}`)
      await shot(page, `c-draftdone-${d}`)
      await clear(page)
    }
    await context.close()
  }
}

// =====================================================================
// 一覧のページ（mockups/v28/review.html）
// =====================================================================

function reviewHtml() {
  const img = (f, cap, cls = '') => `<div class="${cls}"><a href="shots/${f}.png" target="_blank"><img src="shots/${f}.png" alt="" loading="lazy"></a><small>${cap}</small></div>`
  const pros = (good, weak) => `<div class="pw"><div class="good"><b>良い点</b><ul>${good.map((x) => `<li>${x}</li>`).join('')}</ul></div><div class="weak"><b>弱い点</b><ul>${weak.map((x) => `<li>${x}</li>`).join('')}</ul></div></div>`
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>v28 PDF をそのまま保存する</title>
<!-- node scripts/mockup-shots-v28.mjs review で作る（手で直さない） -->
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
  .ph4 { grid-template-columns: repeat(4, 1fr); }
  .ph3 { grid-template-columns: repeat(3, 1fr) 1.4fr; }
  .ph { padding: 10px; background: #faf9f7 !important; }
  .ph img { border-radius: 12px; border: 1px solid #ddd; }
  .note-cell { padding: 14px 16px; font-size: 13px; line-height: 1.8; color: #3f4249; }
  .note-cell p { margin: 0 0 8px; }
  .pw { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--line); border-top: 1px solid var(--line); }
  .pw > div { background: #fff; padding: 10px 16px 12px; font-size: 13px; line-height: 1.75; }
  .pw b { font-size: 12.5px; letter-spacing: 0.06em; }
  .pw .good b { color: #3f7a55; }
  .pw .weak b { color: #b5443b; }
  .pw ul { margin: 4px 0 0; padding-left: 18px; }
  .why { margin: 2px 0 10px; padding: 11px 15px; border-left: 3px solid var(--accent); background: #f6f5f2; border-radius: 0 10px 10px 0; font-size: 13.5px; line-height: 1.85; max-width: 1180px; }
  .why b { color: var(--accent); }
  .test { background: #fff; border-radius: 14px; padding: 14px 18px; box-shadow: 0 2px 10px rgba(0,0,0,0.08); max-width: 1180px; font-size: 13.5px; line-height: 1.85; }
  .test h3 { margin: 6px 0 4px; font-size: 14px; }
  .test ul { margin: 0 0 6px; padding-left: 20px; }
</style>
</head>
<body>
  <h1>「PDFを書き出す」で、PDF をそのまま保存する：画面の案（v28）</h1>
  <p class="lead">今は「印刷の画面」を開いて、学生が端末ごとに選び方を変えて PDF に保存しています。これを、ツールの中で PDF を作って（紙面の各ページを画像にして1つの PDF にまとめる。試作の src/pdf/pagesToPdf.ts）、そのまま保存するようにします。PDF の文字は画像になるので選べませんが、見た目は印刷と同じです。印刷の画面は「うまくいかないとき」の予備に残します。どの画面も、本物のツールに案の部品を仮に重ねて撮っています（まだツールには入っていません）。中身の例は、衣装コースの学生（文化花子・00ZZ0123。架空）の原稿です。<b>おすすめ</b>の案には印を付けています。</p>
  <div class="ask">
    <h2>この v28 で決めていただきたいこと</h2>
    <ol>
      <li>作っている間と、できたあとの見せ方：案A／B／C　<em>おすすめ：案C「できたページを見せる」</em></li>
      <li>予備の「印刷の画面から保存」の置き場所（いちばん下の小さなリンク・作れなかったときの窓）でよいか</li>
      <li>iPhone は「PDF を作る」→ できたら「保存する」の2回押しでよいか（下の「実際の端末で確かめてほしいこと」）</li>
    </ol>
  </div>
  <div class="flow"><b>流れ</b>：「PDFを書き出す」→ 3つを確かめる（今と同じ）→「PDF を保存する」（iPhone は「PDF を作る」）→ ページを1枚ずつ画像にする（進み具合「3 / 10ページ」。パソコンで10ページ3秒・20ページ8秒ほど、スマホはもう少し）→ パソコン・Android：そのまま「ダウンロード」に保存（「PDF を開く」で確かめる）／ iPhone：「保存する」をもう一度押す →「"ファイル"に保存」。ファイル名は今と同じ「2026_卒業制作報告書_学籍番号_氏名.pdf」（下書きは「_下書き」を付け、どのページにも透かし）。</div>

  <h2>① どの案も同じところ</h2>
  <p class="lead">3つの確かめは今と同じです。印刷の画面での選び方の説明（端末ごと）はなくなり、代わりに保存するファイル名と、どこに保存されるかを1行で出します。予備の「印刷の画面から保存」は、窓のいちばん下の左に小さく置きます。エラーが残っているときの「下書きの PDF」も、同じように保存します。</p>
  <figure>
    <figcaption><b>3つを確かめる・エラーが残っているとき（下書き）</b><span>ボタンは、パソコン・Android は「PDF を保存する」、iPhone は「PDF を作る」（保存はできたあとに押す）。下書きのボタンは「下書きの PDF を保存する」</span></figcaption>
    <div class="strip pc2">
      ${img('common-confirm-pc', '<b>パソコン：3つを確かめる</b>（左下に小さく「うまくいかないとき：印刷の画面から保存」）')}
      ${img('common-draft-pc', '<b>パソコン：エラーが残っているとき</b>（下書きの PDF を保存する）')}
    </div>
    <div class="strip ph3" style="border-top:1px solid var(--line)">
      ${img('common-confirm-ph', '<b>iPhone：3つを確かめる</b>（ボタンは「PDF を作る」）', 'ph')}
      ${img('common-draft-ph', '<b>iPhone：エラーが残っているとき</b>', 'ph')}
      ${img('a-error-ph', '<b>作れなかったとき</b>（案A・C）：印刷の画面から保存', 'ph')}
      <div class="note-cell"><p><b>作れなかったとき</b>（メモリが足りない・古いブラウザなど）は、「PDF を作れませんでした」と出し、今の書き出しと同じ「印刷の画面での選び方」（その端末の分）と「印刷の画面を開く」を出します。</p><p>パソコンの同じ窓は、案A の段にあります。</p></div>
    </div>
  </figure>

  <h2>② 作っている間と、できたあと</h2>
  <figure>
    <figcaption><b>案A　窓の中で進める</b><span>「PDF を保存する」を押すと、同じ窓のまま進み具合（棒と「3 / 10ページ」）を出し、できたら「保存しました」に変わる。iPhone は「PDF ができました」と大きな「保存する」</span></figcaption>
    <div class="strip pc3">
      ${img('a-build-pc', '<b>作っている</b>：進み具合と「やめる」')}
      ${img('a-done-pc', '<b>保存した</b>：ファイル名・ページの数・大きさと「PDF を開く」')}
      ${img('a-error-pc', '<b>作れなかった</b>：印刷の画面から保存')}
    </div>
    <div class="strip ph3" style="border-top:1px solid var(--line)">
      ${img('a-build-ph', '<b>iPhone：作っている</b>', 'ph')}
      ${img('a-done-ph', '<b>iPhone：できた</b> →「保存する」', 'ph')}
      ${img('a-error-ph', '<b>iPhone：作れなかった</b>', 'ph')}
      <div class="note-cell"><p>「保存する」を押すと、iPhone の共有の画面が開きます。そこで「"ファイル"に保存」を選びます。</p></div>
    </div>
    ${pros(['今の書き出しの窓のまま進むので、迷わない', '作っている間は窓が前にあるので、原稿を書き換えてしまわない（PDF が古い原稿にならない）', 'iPhone の2回目の「保存する」も、同じ窓の中で自然に押せる'], ['数秒〜十数秒、棒が進むのを見ているだけになる', '保存したあと、ページの数と写真を確かめるには、PDF を開く必要がある（iPhone は「ファイル」アプリから開く手間がある）'])}
  </figure>

  <figure>
    <figcaption><b>案B　窓を閉じて、小さな帯で知らせる</b><span>3つを確かめたら窓を閉じ、パソコンは紙面の下、スマホは上の帯のすぐ下に、進み具合の帯を出す。できたら「保存しました［開く］」（iPhone は「PDF ができました［保存する］」）。作っている間は、紙面を見ることはできるが書けない</span></figcaption>
    <div class="strip pc3">
      ${img('b-build-pc', '<b>作っている</b>：紙面の下の帯（紙面は薄くして、書けない）')}
      ${img('b-done-pc', '<b>保存した</b>：帯に「開く」')}
      ${img('b-error-pc', '<b>作れなかった</b>：帯に「印刷の画面から保存」')}
    </div>
    <div class="strip ph3" style="border-top:1px solid var(--line)">
      ${img('b-build-ph', '<b>iPhone：作っている</b>（上の帯の下）', 'ph')}
      ${img('b-done-ph', '<b>iPhone：できた</b> →「保存する」', 'ph')}
      ${img('b-error-ph', '<b>iPhone：作れなかった</b>', 'ph')}
      <div class="note-cell"><p>帯は、閉じる（×）か次の操作をするまで残します。</p></div>
    </div>
    ${pros(['窓が消えるので、待っている間も紙面が見える', '保存したことが、帯で短く伝わる'], ['作っている間に書くと PDF が古い原稿になるため、結局は書けないようにする必要がある（見えるのに書けない、が分かりにくい）', '帯は小さく、iPhone の「保存する」を見落とすと、保存されないまま終わる', '作れなかったときの、印刷の画面での選び方を書く場所がない（帯から、改めて窓を開くことになる）'])}
  </figure>

  <figure class="is-rec">
    <figcaption><b>案C　窓の中で、できたページを見せる<em class="rec">おすすめ</em></b><span>案Aと同じく窓の中で進めるが、進み具合を「できたページの小さな絵」で見せる（1枚ずつ増える）。できたら全ページの絵が並ぶので、ページの数と写真を、PDF を開かずに確かめられる。iPhone は「保存する」、Android はパソコンと同じく「保存しました」</span></figcaption>
    <div class="strip pc2">
      ${img('c-build-pc', '<b>作っている</b>：できたページが1枚ずつ並ぶ（いま作っているページに枠）')}
      ${img('c-done-pc', '<b>保存した</b>：全ページの小さな絵と「PDF を開く」')}
    </div>
    <div class="strip ph4" style="border-top:1px solid var(--line)">
      ${img('c-build-ph', '<b>iPhone：作っている</b>', 'ph')}
      ${img('c-done-ph', '<b>iPhone：できた</b> →「保存する」', 'ph')}
      ${img('c-done-an', '<b>Android：保存した</b>（そのまま「ダウンロード」）', 'ph')}
      ${img('c-draftdone-ph', '<b>iPhone：下書きの PDF</b>（ファイル名に「_下書き」）', 'ph')}
    </div>
    <div class="strip pc2" style="border-top:1px solid var(--line)">
      ${img('c-draftdone-pc', '<b>パソコン：下書きの PDF を保存した</b>（どのページにも透かし）')}
      <div class="note-cell"><p>小さな絵は、PDF に入れるのと同じ画像を縮めたもの（作る途中で1枚ずつできるので、時間はほとんど増えません）。</p><p>作れなかったときは、案Aと同じ窓（① の右下・案A の段）。</p></div>
    </div>
    ${pros(['待っている間に、ページが1枚ずつ並ぶので、進んでいることが分かりやすい', '今の「保存したら PDF を開いて、ページの数と写真を確かめる」を、窓の中でそのまま済ませられる（iPhone で PDF を開き直す手間が要らない）', '案Aと同じく、作っている間に原稿を書き換えない'], ['窓が少し大きくなる（スマホは、ページが多いと窓の中を上下に動かす）', '小さな絵は字が読めないので、文の誤りは確かめられない（ページの数・図と写真の位置を見るため）'])}
  </figure>
  <p class="why"><b>おすすめは案C</b>：今の窓の流れ（確かめる → 保存する）のまま、待ち時間を「できたページが並んでいく」時間にでき、そのまま「ページの数と写真を確かめる」ことまで済みます。iPhone では、保存した PDF を「ファイル」アプリから開いて確かめるのが手間なので、窓の中で見られる利点が大きいです。案Aはいちばん簡単に作れますが、確かめのために PDF を開く手間が残ります。案Bは紙面が見える代わりに、作っている間は書けないことが分かりにくく、iPhone の「保存する」を見落としやすくなります。</p>

  <h2>③ 実際の端末で確かめてほしいこと</h2>
  <div class="test">
    <h3>iPhone（Safari）</h3>
    <ul>
      <li>「保存する」を押すと共有の画面が開き、「"ファイル"に保存」で PDF が保存できるか。保存した PDF の名前が「2026_卒業制作報告書_学籍番号_氏名.pdf」になっているか</li>
      <li>作るのに時間がかかったあとでも、「保存する」の1回のタップで共有の画面が開くか（作り終えてから押すので、開くはずです）</li>
      <li>ページの多い原稿（20ページ・写真多め）で、途中で止まったり、ページが再読み込みされたりしないか（メモリ）。かかった時間</li>
      <li>共有の画面で「×」でやめたとき、もう一度「保存する」を押せるか</li>
      <li>iPad でも同じように保存できるか</li>
    </ul>
    <h3>Android（Chrome）</h3>
    <ul>
      <li>「PDF を保存する」で、そのまま「ダウンロード」に保存され、通知から開けるか（共有の画面を使わずに済むか）</li>
      <li>ファイル名が化けたり、「.pdf」が付かなかったりしないか</li>
      <li>LINE などのアプリの中のブラウザで開いたときは、保存できないことがある（その場合は「作れませんでした」と同じく、Chrome で開き直す案内が要るか）</li>
    </ul>
    <h3>パソコン</h3>
    <ul>
      <li>ブラウザの設定で「保存する場所を毎回聞く」になっていると、保存の窓が出る（その場合も保存できるか）</li>
      <li>Mac の Safari で、ファイル名と保存先が正しいか</li>
      <li>大学の共用のパソコンで、「ダウンロード」に保存したあと、学生が自分のドライブや USB に移せるか（今の印刷からの保存と同じ）</li>
    </ul>
  </div>
</body>
</html>
`
}

await withEdge(async (browser) => {
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
    })
    await page.screenshot({ path: `${OUT}/review.png`, fullPage: true })
    console.log(`  ${OUT}/review.png`)
  }
})
