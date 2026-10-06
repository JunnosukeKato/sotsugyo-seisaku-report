// デザイン案 v23（見直しの残り：表紙のサブタイトル・共用パソコンのログイン・学籍番号の確かめ・キーボードの目印・色と文字の大きさ・
// スマホの書く欄の道具・スマホの「戻す」・作品写真を外す）を画像に書き出す。
// 学生用ツールに、案ごとの部品を仮に足して撮る（まだ作っていない部品は、撮影のためだけに足す。ツール本体は変えない）。
// 使い方: EDGE_PORT=9345 node scripts/mockup-shots-v23.mjs [項目の番号…]（開発サーバーが http://localhost:5173 で動いていること）
//   例: node scripts/mockup-shots-v23.mjs 1 6 → ①と⑥だけ撮り直す。番号を付けなければ全部と一覧のページ
import { mkdirSync } from 'node:fs'
import { stubConfig } from './e2e/configStub.mjs'
import { withEdge } from './poc/edge.mjs'

const OUT = 'mockups/v23/screens'
mkdirSync(OUT, { recursive: true })
const ONLY = process.argv.slice(2)
const want = (key) => ONLY.length === 0 || ONLY.includes(key)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const URL = 'http://localhost:5173/?nodrive'
const PC = { width: 1440, height: 900, deviceScaleFactor: 1.5 }
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

// ---- アイコン（src/app/icons.tsx と同じ形） ----
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const IC = {
  replace: svg('<rect x="4" y="6" width="12" height="11" rx="1.5"/><path d="M14 4.5h5.5V10M19.5 4.5l-6 6"/>'),
  remove: svg('<path d="M5 7h14M10 7V5.5h4V7M7 7l.9 12h8.2L17 7"/>'),
  undo: svg('<path d="M9 7.5L5 11.5l4 4M5 11.5h9.5a4.5 4.5 0 010 9H12"/>'),
  more: svg('<circle cx="6" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18" cy="12" r="1.3" fill="currentColor"/>'),
  table: svg('<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M4 14.5h16M10 10v9M15 10v9"/>'),
  figure: svg('<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9.5" cy="10" r="1.5"/><path d="M5 17.5l4.5-4.5 3 3 2-2 4.5 4.5"/>'),
}
// Google のログインのボタンに付ける「G」の印（src/app/DriveUi.tsx と同じ）
const G = `<svg class="login-g" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`

const CSS = `
  .guide { display: none !important; }
  /* 撮影用に同時に開くページどうしで「別のタブで開いています」が出ることがあるので、出さない（案とは関係ない） */
  .login-over.tab-locked { display: none !important; }
  /* 試験用の設定にある「（自動テスト用）」のお知らせは、案と関係ないので出さない */
  .side .notice, .sheet .notice { display: none !important; }
  /* ①表紙のサブタイトル：下限でも入らない */
  .v23-over { color: #b71c1c; }
  .v23-over [data-block-id] { background: rgba(198, 40, 40, 0.16); text-decoration: underline 2px solid #b5443b; text-underline-offset: 3px; }
  .v23-issue-new { animation: none; }
  /* ②共用パソコン：ログインの窓 */
  .v23-acct { flex-direction: row; justify-content: flex-start; text-align: left; padding: 11px 16px; }
  .v23-acct .who { display: grid; gap: 1px; min-width: 0; }
  .v23-acct .who b { font-size: 15px; overflow-wrap: anywhere; }
  .v23-acct .who small { font-size: 12px; font-weight: 400; color: #5d6068; }
  .v23-acct .go { margin-left: auto; color: var(--accent); font-size: 18px; }
  .v23-other { display: block; width: 100%; margin-top: 8px; padding: 10px 16px; border-radius: 10px; border: 1px solid var(--line); background: #fff; color: var(--ink); font-size: 13.5px; }
  .v23-shared { margin: 12px 0 0; padding: 8px 10px; border-radius: 8px; background: #f6f4ef; font-size: 11.5px; line-height: 1.7; color: #4a4d54; }
  /* 案A：後ろは無地 */
  .login-over.v23-plain { background: var(--stage-bg); backdrop-filter: none; -webkit-backdrop-filter: none; }
  .login-over.v23-plain .login-card { box-shadow: 0 1px 2px rgba(30,25,20,0.05), 0 14px 40px rgba(30,25,20,0.12); }
  /* 案B：表紙のような画面 */
  .v23-gate { position: fixed; inset: 0; z-index: 60; overflow: auto; display: grid; grid-template-columns: minmax(0, 1fr); place-items: center; padding: 18px 16px; background: var(--stage-bg); box-sizing: border-box; }
  .v23-gate * { box-sizing: border-box; }
  .v23-paper { width: min(600px, 100%); background: #fff; padding: 22px; box-shadow: 0 1px 3px rgba(30,25,20,0.08), 0 20px 60px rgba(30,25,20,0.16); }
  .v23-frame { border: 1px solid #23262b; padding: 34px 44px 26px; display: flex; flex-direction: column; align-items: center; text-align: center; }
  .v23-frame .yr { font-size: 15px; letter-spacing: 0.08em; color: #3f4249; }
  .v23-frame .hd { font-family: 'BIZ UDMincho', serif; font-size: 34px; letter-spacing: 0.3em; margin: 14px 0 4px; padding-left: 0.3em; }
  .v23-frame .tl { font-size: 13px; color: var(--muted); letter-spacing: 0.3em; }
  .v23-frame hr { width: 100%; border: 0; border-top: 1px solid #23262b; margin: 22px 0 16px; }
  .v23-frame .desc { list-style: none; margin: 0 0 20px; padding: 0; font-size: 13px; line-height: 2; color: #3f4249; }
  .v23-frame .area { width: 100%; max-width: 380px; text-align: left; }
  .v23-frame .area .login-lead { margin-bottom: 12px; text-align: left; }
  .v23-frame .univ { margin-top: 22px; padding-top: 12px; width: 100%; border-top: 2px solid #23262b; font-size: 17px; letter-spacing: 0.5em; padding-left: 0.5em; }
  .v23-gate.narrow .v23-paper { padding: 10px; }
  .v23-gate.narrow .v23-frame { padding: 22px 16px 16px; }
  .v23-gate.narrow .v23-frame .hd { font-size: 24px; letter-spacing: 0.2em; }
  .v23-gate.narrow .v23-acct { padding: 10px 12px; gap: 10px; }
  .v23-gate.narrow .v23-acct .who b { font-size: 13.5px; overflow-wrap: normal; white-space: nowrap; }
  .v23-gate.narrow .v23-frame .desc { font-size: 12px; line-height: 1.8; text-align: left; }
  /* 案C：窓は今のまま、後ろの原稿は出さない（紙面・ページ一覧・右の欄を空にする） */
  .v23-skel .page-viewport [data-vivliostyle-page-container] > *, .v23-skel .mini > *, .v23-skel .side .check > *, .v23-skel .side .meta, .v23-skel .side .notice, .v23-skel .side-foot p,
  .v23-skel .p-title .sub, .v23-skel .p-top .chip, .v23-skel .pager .lbl { visibility: hidden !important; }
  .login-over.v23-strong { background: rgba(236, 233, 228, 0.45); }
  .v23-skel .thumb-list .t.has-error::after, .v23-skel .p-nav .badge { display: none !important; }
  /* ③学籍番号の確かめ */
  .modal .v23-id { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 0 0 14px; padding: 10px 14px; border-radius: 10px; background: #f6f4ef; font-size: 13.5px; }
  .modal .v23-id span { color: var(--muted); font-size: 12.5px; }
  .modal .v23-id b.ng { color: var(--error); }
  .modal .v23-choices { display: grid; gap: 8px; margin-top: 16px; }
  .modal .v23-choices button { text-align: left; padding: 10px 14px; font-size: 13.5px; }
  .modal .v23-choices button small { display: block; font-size: 11.5px; font-weight: 400; opacity: 0.8; margin-top: 1px; }
  /* ④紙面の欄にキーボードで移ったときの目印（紙面は縮小しているので、--s で割って画面での太さにする） */
  .v23-fa { outline: calc(2px / var(--s)) solid #2f3e75 !important; outline-offset: calc(3px / var(--s)); }
  .v23-fb { background-color: rgba(47, 62, 117, 0.09) !important; box-shadow: inset 0 calc(-2.5px / var(--s)) 0 #2f3e75; }
  figure.v23-fb { box-shadow: 0 calc(3px / var(--s)) 0 #2f3e75; background-color: rgba(47, 62, 117, 0.09) !important; }
  .v23-fc { position: relative; outline: calc(2px / var(--s)) solid #2f3e75 !important; outline-offset: calc(5px / var(--s)); border-radius: calc(5px / var(--s)); }
  span.v23-fc { display: inline-block; }
  .v23-fc::after { content: attr(data-v23-tag); position: absolute; right: calc(-5px / var(--s)); bottom: calc(100% + 9px / var(--s)); padding: calc(3px / var(--s)) calc(8px / var(--s)); border-radius: calc(5px / var(--s)); background: #2f3e75; color: #fff; font-family: 'BIZ UDPGothic', sans-serif; font-size: calc(11px / var(--s)); font-weight: 700; line-height: 1.3; letter-spacing: 0.04em; text-indent: 0; white-space: nowrap; }
  /* ⑤まだ薄い色と小さい文字 */
  .v23-ca { --ok: #3f7a55; --warn: #8a5e0f; }
  .v23-ca .page-viewport [data-block-id]:empty:not(.has-issue)::before { color: #767676; }
  .v23-ca .page-viewport .figure-slot::before, .v23-ca .page-viewport td.swatch:empty::before, .v23-ca .page-viewport [data-photo-slot]:empty::before { color: #767676; }
  .v23-ca .p-nav button { font-size: 12px; }
  .v23-ca .p-title .sub, .v23-ca .p-top .chip { font-size: 12px; }
  .v23-ca .thumb-list .t { font-size: 11px; }
  .v23-ca .thumbs-col .thumb-list .t { font-size: 11.5px; }
  .v23-cb { --ok: #3f7a55; --warn: #8a5e0f; }
  .v23-cb .page-viewport [data-block-id]:empty:not(.has-issue)::before { color: #5f6b95; }
  .v23-cb .page-viewport .figure-slot::before, .v23-cb .page-viewport td.swatch:empty::before, .v23-cb .page-viewport [data-photo-slot]:empty::before { color: #5f6b95; }
  .v23-cb .p-nav button { font-size: 13px; gap: 2px; }
  .v23-cb .p-nav svg { width: 22px; height: 22px; }
  .v23-cb .p-title .title { font-size: 14.5px; }
  .v23-cb .p-title .sub, .v23-cb .p-top .chip { font-size: 12.5px; }
  .v23-cb .thumb-list .t { font-size: 12px; }
  .v23-cb .sheet-body .thumb-list { grid-template-columns: repeat(4, 1fr); }
  .v23-cb .sheet-body .mini { width: 52px; height: 73.5px; }
  .v23-cb .sheet-body .mini .mini-page { transform: scale(0.06552); }
  .v23-cb .thumbs-col .thumb-list .t { font-size: 12px; }
  /* ⑥スマホの書く欄の道具 */
  .v23-ta .es-tools { flex-wrap: wrap; overflow: visible; row-gap: 2px; padding-bottom: 6px; }
  .v23-ta .es-tools button { height: 34px; padding: 0 9px; }
  .v23-tb .edit-sheet { overflow: hidden; }
  .v23-more { position: absolute; right: 0; width: 64px; display: flex; align-items: center; justify-content: flex-end; padding-right: 6px; pointer-events: none; background: linear-gradient(to right, rgba(255,255,255,0), #fff 62%); }
  .v23-more span { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); font-size: 18px; font-weight: 700; line-height: 1; }
  .v23-tc .es-tools { overflow: visible; position: relative; }
  .v23-tc .es-tools .v23-hide { display: none; }
  .v23-tc .es-tools .v23-other-btn { margin-left: auto; background: var(--chip-bg); }
  .v23-tc .es-tools .v23-other-btn svg { width: 18px; height: 18px; }
  .v23-menu { position: absolute; right: 8px; bottom: calc(100% + 6px); z-index: 5; min-width: 190px; display: grid; padding: 6px; background: #fff; border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 10px 28px rgba(30,25,20,0.2); }
  .v23-menu button { display: flex; align-items: center; gap: 8px; height: 40px !important; width: 100%; justify-content: flex-start; }
  .v23-menu .t { font-size: 11px; color: var(--muted); padding: 2px 10px 4px; }
  /* ⑦スマホで削除したあとの「戻す」 */
  .v23-toast { position: fixed; z-index: 35; left: 12px; right: 12px; bottom: calc(62px + 12px); display: flex; align-items: center; gap: 10px; padding: 10px 10px 10px 16px; border-radius: 12px; background: #2b2e36; color: #fff; font-size: 13.5px; box-shadow: 0 10px 28px rgba(20,20,30,0.3); }
  .v23-toast button { margin-left: auto; display: flex; align-items: center; gap: 5px; border: 0; border-radius: 8px; padding: 8px 14px; background: #fff; color: var(--accent); font-size: 13.5px; font-weight: 700; }
  .v23-toast button svg { width: 17px; height: 17px; }
  .v23-toast small { display: block; color: #c7c9d1; font-size: 11px; }
  .sel-bar .v23-undo-sep { width: 1px; align-self: stretch; margin: 4px 4px; background: var(--line); }
  .sel-bar .v23-done { font-size: 12.5px; color: var(--muted); padding: 0 8px 0 6px; white-space: nowrap; }
  .p-top .v23-undo { width: auto; padding: 0 8px; gap: 3px; display: flex; font-size: 11px; color: var(--accent); flex-direction: column; justify-content: center; height: 42px; }
  .p-top .v23-undo svg { width: 20px; height: 20px; }
  /* ⑧作品写真を外す */
  .v23-photo-on::before { content: ''; position: absolute; inset: 0; z-index: 3; border: calc(4px / var(--s)) solid #2f3e75; box-shadow: inset 0 0 0 calc(2px / var(--s)) #fff; pointer-events: none; }
  .v23-photo-on::after { content: attr(data-v23-n); position: absolute; z-index: 4; left: calc(8px / var(--s)); top: calc(8px / var(--s)); padding: calc(3px / var(--s)) calc(9px / var(--s)); border-radius: 999px; background: #2f3e75; color: #fff; font-family: 'BIZ UDPGothic', sans-serif; font-size: calc(12px / var(--s)); font-weight: 700; }
  .v23-unset { display: block; width: calc(100% - 8px); margin: 6px 4px 4px; padding: 7px 2px; border: 1px solid #e3c4c0; background: #fff; border-radius: 8px; color: var(--error); font-size: 10.5px; line-height: 1.35; }
  .v23-unset small { display: block; color: var(--muted); font-size: 9.5px; }
  .sel-bar.v23-stack { flex-direction: column; align-items: center; gap: 6px; }
  .sel-bar .v23-unset-bar { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 12px; background: #fff; border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--float-shadow); font-size: 12.5px; }
  .sel-bar .v23-unset-bar button { border: 1px solid #e3c4c0; background: #fff; color: var(--error); border-radius: 8px; padding: 6px 12px; font-size: 12.5px; display: flex; align-items: center; gap: 4px; }
  .sel-bar .v23-unset-bar button svg { width: 17px; height: 17px; }
`

const ready = (page, phone) =>
  page.waitForFunction(
    (phone) => {
      const s = window.__editor?.getSnapshot()
      return s?.layout && (!phone || s.sheet) && !s.rendering && !s.turning && !document.querySelector('.loading')
    },
    { timeout: 120000 },
    phone,
  )

/** 見本の原稿（src/model/demoReport.ts）に、図と作品写真の画像を入れる */
async function loadDemo(options) {
  const { demoReport } = await import('/src/model/demoReport.ts')
  // 人の形の絵（デザイン画・作品写真の代わり）
  const art = async (id, w, h, bg1, bg2, cloth, accent) => {
    const c = new OffscreenCanvas(w, h)
    const g = c.getContext('2d')
    const grd = g.createLinearGradient(0, 0, w * 0.6, h)
    grd.addColorStop(0, bg1)
    grd.addColorStop(1, bg2)
    g.fillStyle = grd
    g.fillRect(0, 0, w, h)
    const cx = w / 2
    const u = h / 100
    g.fillStyle = 'rgba(0,0,0,0.16)'
    g.beginPath(); g.ellipse(cx, 90 * u, 22 * u, 2.5 * u, 0, 0, Math.PI * 2); g.fill()
    g.fillStyle = cloth
    g.beginPath(); g.ellipse(cx - 14 * u, 36 * u, 6 * u, 12 * u, 0.35, 0, Math.PI * 2); g.fill()
    g.beginPath(); g.ellipse(cx + 14 * u, 36 * u, 6 * u, 12 * u, -0.35, 0, Math.PI * 2); g.fill()
    g.beginPath(); g.moveTo(cx - 9 * u, 23 * u); g.lineTo(cx + 9 * u, 23 * u); g.lineTo(cx + 13 * u, 58 * u); g.lineTo(cx - 13 * u, 58 * u); g.closePath(); g.fill()
    g.fillStyle = '#f1ece2'
    g.beginPath(); g.moveTo(cx - 12 * u, 58 * u); g.lineTo(cx + 12 * u, 58 * u); g.lineTo(cx + 11 * u, 88 * u); g.lineTo(cx + 2 * u, 88 * u); g.lineTo(cx, 66 * u); g.lineTo(cx - 2 * u, 88 * u); g.lineTo(cx - 11 * u, 88 * u); g.closePath(); g.fill()
    g.fillStyle = accent
    g.fillRect(cx - 12 * u, 44 * u, 24 * u, 5 * u)
    g.fillStyle = '#e6c3a0'
    g.beginPath(); g.arc(cx, 16 * u, 5.5 * u, 0, Math.PI * 2); g.fill()
    g.fillStyle = accent
    g.beginPath(); g.ellipse(cx, 12.5 * u, 7 * u, 4.5 * u, 0, Math.PI, 0); g.fill()
    return { id, blob: await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 }), widthPx: w, heightPx: h }
  }
  const images = await Promise.all([
    art('v23-fig', 600, 800, '#f8f4ec', '#ece3d1', '#2f4f8a', '#c8a24a'),
    art('v23-p1', 900, 1200, '#2c4d63', '#0f1d26', '#b5443b', '#e1b75a'),
    art('v23-p2', 900, 1200, '#4a3660', '#1b1226', '#2f6db0', '#e9d27a'),
    art('v23-p3', 900, 1200, '#9a7a56', '#3a2a1c', '#f3efe6', '#2f3e75'),
    art('v23-p4', 900, 1200, '#355a47', '#10241a', '#d98c3a', '#5b2a6e'),
  ])
  window.__editor.addImages(images)
  const r = demoReport()
  r.body = r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.type === 'figureRow' ? { ...b, figures: b.figures.map((f) => ({ ...f, imageId: 'v23-fig' })) } : b)) }))
  r.workPhotos = { layout: 4, columns: 2, imageIds: ['v23-p1', 'v23-p2', 'v23-p3', 'v23-p4'] }
  // 学籍番号は、実在しない形のもの（00ZZ…）にそろえる
  r.basicInfo = { ...r.basicInfo, studentId: '00ZZ0123', ...(options?.basic ?? {}) }
  window.__editor.replace(r)
}

/** 学生用ツールを開く。demo なら見本の原稿（図・表・作品写真あり）にする */
async function open(browser, { phone = false, demo = true, dpr, basic } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  // ほかの作業者が src/ を直すたびに画面が自動で入れ替わる（開発サーバーの即時反映）と、撮影の途中で足した部品が消えるため、
  // この撮影のページだけ即時反映をつながないようにする（開いた時点の最新のツールで撮る）
  await page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
  })
  if (phone) await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36')
  await page.setViewport(phone ? PHONE : { ...PC, deviceScaleFactor: dpr ?? PC.deviceScaleFactor })
  await stubConfig(page)
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 90000 })
  await ready(page, phone)
  await page.addStyleTag({ content: CSS })
  if (demo) {
    await page.evaluate(loadDemo, { basic })
    await sleep(700)
    await ready(page, phone)
  }
  await page.bringToFront()
  return { context, page }
}

const shot = async (page, name, opts = {}) => {
  await sleep(opts.wait ?? 400)
  const path = `${OUT}/${name}.png`
  if (opts.el) await (await page.$(opts.el)).screenshot({ path })
  else if (opts.clip) await page.screenshot({ path, clip: opts.clip })
  else await page.screenshot({ path })
  console.log(path)
}

/** 表示しているページ（紙面）の要素 */
const CUR = '.page-viewport.front [data-vivliostyle-page-container].is-current'

/** 要素のまわりを切り抜く範囲（画面の座標） */
const around = (page, selector, pad = { x: 30, top: 30, bottom: 30 }, union) =>
  page.evaluate(
    (selector, pad, union, CUR) => {
      const pick = (s) => [...document.querySelectorAll(s)].find((e) => e.getBoundingClientRect().width > 0)
      const a = pick(selector).getBoundingClientRect()
      const b = union ? pick(union).getBoundingClientRect() : a
      const pageRect = document.querySelector(CUR).getBoundingClientRect()
      const left = pad.full ? pageRect.left - 8 : Math.min(a.left, b.left) - pad.x
      const right = pad.full ? pageRect.right + 8 : Math.max(a.right, b.right) + pad.x
      return { x: Math.max(0, left), y: Math.max(0, Math.min(a.top, b.top) - pad.top), width: right - Math.max(0, left), height: Math.max(a.bottom, b.bottom) + pad.bottom - Math.max(0, Math.min(a.top, b.top) - pad.top) }
    },
    selector,
    pad,
    union,
    CUR,
  )

const goTo = async (page, blockId, phone) => {
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), blockId)
  await sleep(300)
  await ready(page, phone)
}

await withEdge(async (browser) => {
  // ================= ① 表紙のサブタイトルが長いとき =================
  if (want('1')) {
    const LENGTHS = {
      s: 'アラビアンナイト', // 8字
      m: 'オペラ『魔笛』に登場する夜の女王', // 16字
      l: '映画『千夜一夜物語』に登場する砂漠の王子シンドバッド', // 26字
    }
    const MIN_PT = 11
    const results = {}
    const { context, page } = await open(browser, { dpr: 2 })
    for (const [len, text] of Object.entries(LENGTHS)) {
      await page.evaluate((text) => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, subtitleInput: text } })), text)
      await sleep(700)
      await page.evaluate(() => window.__editor.goToPage(0, 'none'))
      await ready(page)
      for (const variant of ['now', 'a', 'b', 'c']) {
        const res = await page.evaluate(
          (variant, MIN_PT, CUR) => {
            const el = document.querySelector(`${CUR} .cover .subtitle`)
            const input = el.querySelector('[data-block-id]')
            // 組版エンジンは、文字の大きさなどを要素に直接書き込むので、最初の値を覚えておいて戻す
            if (el.dataset.v23Fs === undefined) {
              el.dataset.v23Fs = el.style.fontSize
              el.dataset.v23Ls = el.style.letterSpacing
            }
            el.style.fontSize = el.dataset.v23Fs
            el.style.letterSpacing = el.dataset.v23Ls
            input.style.fontSize = ''
            el.classList.remove('v23-over')
            const fits = () => {
              const range = document.createRange()
              range.selectNodeContents(el)
              return range.getBoundingClientRect().width <= el.getBoundingClientRect().width + 0.5
            }
            let pt = 22
            let ls = 0
            if (variant === 'a') while (!fits() && pt > MIN_PT) el.style.fontSize = `${(pt -= 0.5)}pt`
            if (variant === 'b') while (!fits() && pt > MIN_PT) input.style.fontSize = `${(pt -= 0.5)}pt`
            if (variant === 'c') {
              while (!fits() && ls > -0.1 + 1e-9) el.style.letterSpacing = `${(ls = Math.round((ls - 0.02) * 100) / 100)}em`
              while (!fits() && pt > MIN_PT) el.style.fontSize = `${(pt -= 0.5)}pt`
            }
            const over = !fits()
            if (over && variant !== 'now') el.classList.add('v23-over')
            return { pt, ls, over, chars: [...input.textContent].length }
          },
          variant,
          MIN_PT,
          CUR,
        )
        results[`${len}-${variant}`] = res
        const clip = await page.evaluate((CUR) => {
          const p = document.querySelector(CUR).getBoundingClientRect()
          const top = document.querySelector(`${CUR} .cover .label`).getBoundingClientRect().top
          const bottom = document.querySelector(`${CUR} .cover .rule.subtitle-rule`).getBoundingClientRect().bottom
          return { x: p.left - 20, y: top - 14, width: p.width + 40, height: bottom - top + 30 }
        }, CUR)
        await shot(page, `1-${variant}-${len}`, { clip, wait: 150 })
      }
    }
    console.log(JSON.stringify(results))
    await context.close()

    // 下限でも入らないとき（案A の形で、右の欄のエラー）
    {
      const { context, page } = await open(browser)
      const long = '映画『千夜一夜物語』に登場する砂漠の王子シンドバッドと船乗りたち'
      await page.evaluate((text) => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, subtitleInput: text } })), long)
      await sleep(700)
      await page.evaluate(() => window.__editor.goToPage(0, 'none'))
      await ready(page)
      const info = await page.evaluate(
        (MIN_PT, CUR) => {
          const el = document.querySelector(`${CUR} .cover .subtitle`)
          const input = el.querySelector('[data-block-id]')
          el.style.fontSize = `${MIN_PT}pt`
          el.classList.add('v23-over')
          const range = document.createRange()
          range.selectNodeContents(el)
          const ratio = el.getBoundingClientRect().width / range.getBoundingClientRect().width
          const chars = [...input.textContent].length
          const total = [...el.textContent].length
          // 入る字数（決まり文句も含めた全体の字数から逆算）
          const fitTotal = Math.floor(total * ratio)
          const fitInput = fitTotal - (total - chars)
          // 右の欄に、表紙のエラーを足す
          const list = document.querySelector('.side .check > div:last-child') ?? document.querySelector('.side .check')
          const html = `<div class="igroup"><div class="ig-h">表紙<span>1件</span></div><ul class="issues"><li class="issue error"><i class="dot"></i><div><div class="ttl">サブタイトルが長く、表紙の1行に入りません<span class="src">手順書</span></div><div class="detail">いちばん小さい文字（${MIN_PT}pt）にしても、枠からはみ出します。あと${chars - fitInput}字ほど短くしてください（今 ${chars}字・${fitInput}字くらいまで入ります）。</div></div><span></span></li></ul></div>`
          const first = list.querySelector('.igroup')
          if (first) first.insertAdjacentHTML('beforebegin', html)
          else list.insertAdjacentHTML('beforeend', html)
          const tally = document.querySelector('.side .tally b.e')
          if (tally) tally.textContent = String(Number(tally.textContent) + 1)
          const foot = document.querySelector('.side-foot p')
          if (foot) foot.textContent = foot.textContent.replace(/\d+/,(n) => String(Number(n) + 1))
          return { chars, fitInput }
        },
        MIN_PT,
        CUR,
      )
      console.log('1-error', JSON.stringify(info))
      await shot(page, '1-error')
      await context.close()
    }
  }

  // ================= ② 共用パソコン：ログインの窓 =================
  if (want('2')) {
    const ACCOUNT = '00zz0123@bunka-wu.ac.jp'
    const brand = '<div class="login-brand"><span class="login-mark">卒</span><div><b>卒業制作報告書</b><span>2026年度　作成ツール</span></div></div>'
    const note = '<p class="login-small">@bunka-wu.ac.jp のアカウントを選んでください。このツールが見られるのは、このツールで作ったファイルだけです。学科や先生が、あなたのドライブを見ることはありません。</p>'
    const loginArea = (prev) =>
      prev
        ? `<p class="login-lead">前回この端末で使ったアカウントです。自分のアカウントなら、そのまま続けてください。</p>
           <button class="login-btn v23-acct">${G}<span class="who"><b>${ACCOUNT}</b><small>このアカウントで続ける</small></span><span class="go">›</span></button>
           <button class="v23-other">別のアカウントでログイン</button>
           <p class="v23-shared">大学のパソコン室など共用のパソコンでは、前の人のアカウントが出ていることがあります。自分のでなければ「別のアカウントでログイン」を押してください。</p>`
        : `<p class="login-lead">大学の Google アカウントでログインしてください。原稿は、あなたの Google ドライブ（「卒業制作報告書」フォルダ）に自動で保存されます。</p>
           <button class="login-btn">${G}大学のアカウントでログイン</button>${note}`
    const VARIANTS = {
      a: (prev) => `<div class="login-over v23-plain"><div class="login-card">${brand}${loginArea(prev)}</div></div>`,
      b: (prev, narrow) => `<div class="v23-gate${narrow ? ' narrow' : ''}"><div class="v23-paper"><div class="v23-frame">
          <div class="yr">2026年度</div><div class="hd">卒業制作報告書</div><div class="tl">作成ツール</div><hr>
          <ul class="desc"><li>表紙から作品写真まで、決まった形のまま書けます</li><li>手順書に合っているかを、その場で確かめられます</li><li>原稿は、あなたの Google ドライブに保存されます</li></ul>
          <div class="area">${loginArea(prev)}</div>
          <div class="univ">文化学園大学</div></div></div></div>`,
      c: (prev) => `<div class="login-over v23-strong"><div class="login-card">${brand}${loginArea(prev)}</div></div>`,
    }
    for (const phone of [false, true]) {
      for (const [key, html] of Object.entries(VARIANTS)) {
        for (const prev of phone ? [true] : [true, false]) {
          const { context, page } = await open(browser, { phone })
          await page.evaluate(
            (key, markup) => {
              if (key === 'c') document.querySelector('.app').classList.add('v23-skel')
              document.body.insertAdjacentHTML('beforeend', markup)
            },
            key,
            html(prev, phone),
          )
          // PC は、窓のまわり（後ろの見え方が分かる範囲）を切り抜く
          await shot(page, `2-${key}-${phone ? 'phone' : prev ? 'prev' : 'none'}`, phone ? {} : { clip: { x: 200, y: 50, width: 1040, height: 800 } })
          await context.close()
        }
      }
    }
  }

  // ================= ③ 表紙の学籍番号とログインしたアカウントが違うとき =================
  if (want('3')) {
    const ACCOUNT = '00zz0123@bunka-wu.ac.jp'
    const VARIANTS = {
      a: `<div class="modal-backdrop"><div class="modal" role="dialog">
          <header><h2>表紙の学籍番号と、ログインしたアカウントが違います</h2></header>
          <div class="v23-id"><span>表紙の学籍番号</span><b class="ng">00ZZ0132</b><span>ログインしたアカウント</span><b>${ACCOUNT}</b></div>
          <p class="lead">共用のパソコンで、ほかの人の原稿を開いているかもしれません。どれに当たるかを選んでください。</p>
          <p class="drive-small">学籍番号は、提出された PDF がだれのものかを確かめるのに使います。</p>
          <div class="v23-choices"><button class="primary">学籍番号を 00ZZ0123 に直す<small>自分の原稿で、学籍番号を打ち間違えていたとき</small></button><button>別のアカウントでログインし直す<small>ほかの人の原稿だったとき（自分のアカウントで開き直す）</small></button><button>このまま続ける<small>学籍番号が合っているとき</small></button></div>
        </div></div>`,
      b: `<div class="modal-backdrop"><div class="modal" role="dialog">
          <header><h2>表紙の学籍番号は「00ZZ0132」で合っていますか？</h2></header>
          <p class="lead">ログインしているアカウント（${ACCOUNT}）の学籍番号は「00ZZ0123」です。打ち間違いかもしれません。</p>
          <p class="drive-small">学籍番号は、提出された PDF がだれのものかを確かめるのに使います。この原稿が自分のものでないときは、右の欄の保存のようすから、別のアカウントでログインし直せます。</p>
          <div class="row-buttons"><span class="spacer"></span><button>合っている（このまま）</button><button class="primary">00ZZ0123 に直す</button></div>
        </div></div>`,
    }
    for (const [key, html] of Object.entries(VARIANTS)) {
      const { context, page } = await open(browser, { basic: { studentId: '00ZZ0132' } })
      await page.evaluate((markup) => document.body.insertAdjacentHTML('beforeend', markup), html)
      // 文言を読み比べられるよう、窓のまわりを切り抜く
      const clip = await page.evaluate(() => {
        const r = document.querySelector('.modal').getBoundingClientRect()
        return { x: r.left - 60, y: r.top - 50, width: r.width + 120, height: r.height + 100 }
      })
      await shot(page, `3-${key}`, { clip })
      await context.close()
    }
  }

  // ================= ④ 紙面の欄にキーボードで移ったときの目印 =================
  if (want('4')) {
    const { context, page } = await open(browser, { dpr: 2 })
    const targets = [
      { key: 'field', block: null, sel: `${CUR} [data-block-id="basic:name"]`, tag: 'Enterで書く', crop: { sel: `${CUR} .cover .name-label`, union: `${CUR} .cover .rule.name-rule`, pad: { x: 40, top: 92, bottom: 30 } } },
      { key: 'para', block: 'p1', sel: `${CUR} [data-block-id="p1"]`, tag: 'Enterで書く', crop: { sel: `${CUR} [data-block-id="s1"]`, union: `${CUR} [data-block-id="p1"]`, pad: { x: 24, top: 30, bottom: 30 } } },
      { key: 'figure', block: 'p2', sel: `${CUR} figure[data-figure-id="f1"]`, tag: 'Enterで選ぶ', crop: { sel: `${CUR} figure[data-figure-id="f1"]`, pad: { x: 90, top: 40, bottom: 20 } } },
    ]
    for (const t of targets) {
      if (t.block) await goTo(page, t.block)
      else {
        await page.evaluate(() => window.__editor.goToPage(0, 'none'))
        await ready(page)
      }
      for (const variant of ['a', 'b', 'c']) {
        await page.evaluate(
          (sel, variant, tag) => {
            for (const el of document.querySelectorAll('.v23-fa, .v23-fb, .v23-fc')) el.classList.remove('v23-fa', 'v23-fb', 'v23-fc')
            const el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0)
            el.classList.add(`v23-f${variant}`)
            el.dataset.v23Tag = tag
          },
          t.sel,
          variant,
          t.tag,
        )
        const clip = await around(page, t.crop.sel, t.crop.pad, t.crop.union)
        await shot(page, `4-${variant}-${t.key}`, { clip, wait: 200 })
      }
    }
    await context.close()
  }

  // ================= ⑤ まだ薄い色と小さい文字（今・案A・案B） =================
  if (want('5')) {
    // 「何を書くか」の薄い字が出る、書き始めの原稿（ひな形の説明・図の枠・素材表）
    const blank = () =>
      window.__editor.update((r) => {
        const p = (id, hint) => ({ type: 'paragraph', id, hint, content: [{ type: 'text', text: '' }] })
        const chapter = {
          id: 'v23c1',
          title: '企画・立案',
          blocks: [
            { type: 'subheading', id: 'v23s1', title: '担当衣装のキャラクター' },
            p('v23p1', 'キャラクターの性格や、物語の中での役割を書く'),
            { type: 'subheading', id: 'v23s2', title: 'デザイン説明' },
            p('v23p2', 'デザインの考え方と、参考にしたもの・工夫した点を書く'),
            { type: 'figureRow', id: 'v23r1', figures: [{ id: 'v23f1', imageId: '', caption: 'デザイン画' }] },
          ],
        }
        return { ...r, basicInfo: { ...r.basicInfo, studentId: '00ZZ0123', name: '文化　花子', courseId: 'film-stage-costume', subtitleInput: 'シンドバッド' }, body: [chapter, ...r.body.slice(1)] }
      })
    for (const variant of ['now', 'a', 'b']) {
      // PC：右の欄（緑・茶）と紙面の薄い字
      {
        const { context, page } = await open(browser, { dpr: 2 })
        if (variant !== 'now') await page.evaluate((v) => document.querySelector('.app').classList.add(`v23-c${v}`), variant)
        await page.evaluate(() => {
          // 茶の字（薄茶の背景の上）を比べるため、ドライブ保存を止めているときの知らせを出す
          document.querySelector('.side-head .meta').insertAdjacentHTML('afterend', '<div class="drive-stopped">いまはドライブへの保存を止めています（学科の判断）。原稿はこの端末にだけ保存されます。</div>')
          window.__editor.goToArea('body')
        })
        await ready(page)
        await shot(page, `5-side-${variant}`, { el: '.side' })
        await page.evaluate(blank)
        await sleep(700)
        await ready(page)
        await goTo(page, 'v23p1')
        // 本文の欄（大見出しから図の枠まで）を大きく切り抜く
        const clip = await page.evaluate((CUR) => {
          const r = (s) => document.querySelector(`${CUR} ${s}`).getBoundingClientRect()
          const head = r('[data-block-id="v23s1"]')
          const hint = r('[data-block-id="v23p2"]')
          const fig = r('figure[data-figure-id="v23f1"]')
          const left = head.left - 40
          return { x: left, y: head.top - 50, width: hint.right + 24 - left, height: fig.bottom + 16 - (head.top - 50) }
        }, CUR)
        await shot(page, `5-page-${variant}`, { clip })
        await context.close()
      }
      // スマホ：上の帯・下のタブ・ページ一覧
      {
        const { context, page } = await open(browser, { phone: true })
        if (variant !== 'now') await page.evaluate((v) => document.querySelector('.app').classList.add(`v23-c${v}`), variant)
        await page.evaluate(() => window.__editor.goToArea('body'))
        await ready(page, true)
        // 上の帯と下のタブだけを切り抜く（違いが分かる大きさで見せるため）
        await shot(page, `5-ptop-${variant}`, { clip: { x: 0, y: 0, width: 390, height: 48 } })
        await shot(page, `5-ptabs-${variant}`, { clip: { x: 0, y: 844 - 62, width: 390, height: 62 }, wait: 50 })
        await page.click('.p-nav button:first-child')
        await page.waitForSelector('.sheet .thumb-list')
        await page.mouse.move(5, 5)
        await sleep(600)
        await shot(page, `5-thumbs-${variant}`, { el: '.sheet' })
        await context.close()
      }
    }
  }

  // ================= ⑥ スマホ：書く欄の道具が画面の外に隠れる =================
  if (want('6')) {
    for (const ctx of ['para', 'table']) {
      for (const variant of ['now', 'a', 'b', 'c']) {
        const { context, page } = await open(browser, { phone: true })
        const id = await page.evaluate((ctx) => {
          const blocks = window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks)
          return ctx === 'para' ? 'p2' : blocks.find((b) => b.type === 'table').rows[1].cells[0].id
        }, ctx)
        // 「戻す」が押せる状態にする（書いている途中のつもり）
        await page.evaluate(() => window.__editor.update((r) => ({ ...r })))
        await sleep(300)
        await goTo(page, ctx === 'para' ? 'p2' : 't1', true)
        const at = await page.evaluate((id) => {
          const el = [...document.querySelectorAll(`.page-viewport.front [data-block-id="${id}"], .page-viewport.front [data-cell-id="${id}"]`)].find((e) => e.getBoundingClientRect().width > 0)
          const r = el.getBoundingClientRect()
          return { x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2 }
        }, id)
        await page.touchscreen.tap(at.x, at.y)
        await page.waitForFunction(() => document.querySelector('.edit-sheet.open'), { timeout: 20000 })
        await sleep(900)
        await ready(page, true)
        await page.evaluate(
          (variant, ctx, IC) => {
            const app = document.querySelector('.app')
            const tools = document.querySelector('.edit-sheet .es-tools')
            const buttons = [...tools.querySelectorAll('button')]
            const byText = (t) => buttons.find((b) => b.textContent.trim().startsWith(t))
            if (variant === 'a') app.classList.add('v23-ta')
            if (variant === 'b') {
              app.classList.add('v23-tb')
              const sheet = document.querySelector('.edit-sheet')
              const s = sheet.getBoundingClientRect()
              const r = tools.getBoundingClientRect()
              const more = document.createElement('div')
              more.className = 'v23-more'
              more.style.top = `${r.top - s.top}px`
              more.style.height = `${r.height - 6}px`
              more.innerHTML = '<span>›</span>'
              sheet.append(more)
            }
            if (variant === 'c') {
              app.classList.add('v23-tc')
              const keep = ctx === 'para' ? ['図を入れる', '表を入れる', '削除', '戻す'] : ['行', '列', '戻す']
              const hidden = []
              for (const b of buttons) {
                const t = b.textContent.trim()
                const keepIt = keep.some((k) => (k === '行' || k === '列' ? t === k : t.startsWith(k)))
                if (!keepIt) {
                  b.classList.add('v23-hide')
                  hidden.push(b)
                }
              }
              if (ctx === 'table') {
                // 「その他」を押したところ
                const other = document.createElement('button')
                other.className = 'v23-other-btn'
                other.innerHTML = `${IC.more}その他`
                tools.append(other)
                const menu = document.createElement('div')
                menu.className = 'v23-menu'
                menu.innerHTML = '<div class="t">この表</div>' + hidden.map((b) => `<button class="${b.className.replace('v23-hide', '')}">${b.innerHTML}</button>`).join('')
                tools.append(menu)
              } else if (ctx === 'para') {
                // 「表を入れる」を押すと、空の表か素材表かを選ぶ（PC と同じ）
                const t = byText('表を入れる')
                if (t) t.innerHTML = `${IC.table}表を入れる ▾`
              }
            }
          },
          variant,
          ctx,
          IC,
        )
        const clip = await page.evaluate(() => {
          const sheet = document.querySelector('.edit-sheet').getBoundingClientRect().top
          const menu = document.querySelector('.v23-menu')?.getBoundingClientRect().top ?? Infinity
          const top = Math.max(0, Math.min(sheet, menu) - 70)
          return { x: 0, y: top, width: innerWidth, height: innerHeight - top }
        })
        await shot(page, `6-${variant}-${ctx}`, { clip })
        await context.close()
      }
    }
  }

  // ================= ⑦ スマホ：図・表・改ページを削除したあとの「戻す」 =================
  if (want('7')) {
    for (const variant of ['now', 'a', 'b', 'c']) {
      const { context, page } = await open(browser, { phone: true })
      await goTo(page, 'p2', true)
      await page.evaluate(() => window.__editor.select({ kind: 'figure', id: 'f1' }))
      await sleep(400)
      if (variant === 'b') {
        // 選んだ物の道具の右端にも「戻す」（削除の前）
        await page.evaluate((IC) => document.querySelector('.sel-bar .group.ctx').insertAdjacentHTML('beforeend', `<span class="v23-undo-sep"></span><button class="tb">${IC.undo}<span>戻す</span></button>`), IC)
        await shot(page, '7-b-before')
      }
      await page.evaluate(() => window.__editor.removeSelected())
      await sleep(800)
      await ready(page, true)
      await page.evaluate(
        (variant, IC) => {
          if (variant === 'a') document.body.insertAdjacentHTML('beforeend', `<div class="v23-toast"><span>図を削除しました</span><button>${IC.undo}戻す</button></div>`)
          if (variant === 'b')
            document.body.insertAdjacentHTML('beforeend', `<div class="sel-bar"><div class="group ctx"><span class="v23-done">図を削除しました</span><span class="v23-undo-sep"></span><button class="tb">${IC.undo}<span>戻す</span></button></div></div>`)
          if (variant === 'c') document.querySelector('.p-top .icon-btn').insertAdjacentHTML('beforebegin', `<button class="icon-btn v23-undo" aria-label="戻す">${IC.undo}戻す</button>`)
        },
        variant,
        IC,
      )
      await shot(page, `7-${variant}`)
      await context.close()
    }
  }

  // ================= ⑧ 作品写真を外す =================
  if (want('8')) {
    for (const phone of [false, true]) {
      for (const variant of ['a', 'b']) {
        const { context, page } = await open(browser, { phone })
        await page.evaluate(() => window.__editor.goToArea('photos'))
        await ready(page, phone)
        await page.evaluate(() => window.__editor.select({ kind: 'photos' }))
        await sleep(400)
        await page.evaluate(
          (variant, phone, IC, CUR) => {
            const slot = document.querySelector(`${CUR} [data-photo-slot="0"]`)
            slot.classList.add('v23-photo-on')
            slot.dataset.v23N = '1枚目'
            const group = document.querySelector(phone ? '.sel-bar .group.ctx' : '.palette .group.ctx')
            const tool = (label, icon, danger) => `<button class="tb${danger ? ' danger' : ''}">${icon}<span>${label}</span></button>`
            if (variant === 'a') {
              if (phone) {
                group.innerHTML = `<div class="ctx-label">この写真（1枚目）</div>${tool('差し替え', IC.replace)}${tool('外す', IC.remove, true)}`
              } else {
                group.insertAdjacentHTML('beforebegin', `<div class="group ctx v23-photo-group"><div class="ctx-label">この写真</div>${tool('差し替え', IC.replace)}${tool('外す', IC.remove, true)}</div>`)
              }
            } else if (phone) {
              const bar = document.querySelector('.sel-bar')
              bar.classList.add('v23-stack')
              bar.insertAdjacentHTML('afterbegin', `<div class="v23-unset-bar">1枚目の写真を選んでいます<button>${IC.remove}この写真を外す</button></div>`)
            } else {
              group.querySelector('.ctx-note').insertAdjacentHTML('afterend', `<button class="v23-unset">この写真を外す<small>枠を空にする</small></button>`)
            }
          },
          variant,
          phone,
          IC,
          CUR,
        )
        if (phone) await shot(page, `8-${variant}-phone`)
        else {
          const clip = await page.evaluate((CUR) => {
            const pal = document.querySelector('.palette').getBoundingClientRect()
            const p = document.querySelector(CUR).getBoundingClientRect()
            return { x: pal.left - 16, y: 0, width: p.left + p.width * 0.56 - (pal.left - 16), height: Math.max(pal.bottom + 16, p.top + p.height * 0.56) }
          }, CUR)
          await shot(page, `8-${variant}-pc`, { clip })
        }
        await context.close()
      }
    }
  }

  // 一覧のページ
  if (ONLY.length === 0 || ONLY.includes('review')) {
    const page = await browser.newPage()
    await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 })
    await page.goto('http://localhost:5173/mockups/v23/review.html', { waitUntil: 'networkidle0' })
    await page.screenshot({ path: `${OUT}/review.png`, fullPage: true })
    console.log(`${OUT}/review.png`)
  }
})
