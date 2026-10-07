// デザイン案 v24（今年度だけ：Word で書き始めた分をツールに写す「Wordから読み込む」）を画像に書き出す。
// 学生用ツールに、案ごとの部品を仮に足して撮る（まだ作っていない部品は、撮影のためだけに足す。ツール本体は変えない）。
// 使い方: EDGE_PORT=9355 node scripts/mockup-shots-v24.mjs [項目の番号…]（開発サーバーが http://localhost:5173 で動いていること）
//   例: node scripts/mockup-shots-v24.mjs 2 4 → ②と④だけ撮り直す。番号を付けなければ全部と一覧のページ
// 中身の例：学科の Word のひな形（04_本文.docx・01_表紙.docx）に、学生が1章ぶん書いた想定（人名・学籍番号は架空）
import { mkdirSync } from 'node:fs'
import { stubConfig } from './e2e/configStub.mjs'
import { withEdge } from './poc/edge.mjs'

const OUT = 'mockups/v24/screens'
mkdirSync(OUT, { recursive: true })
const ONLY = process.argv.slice(2)
const want = (key) => ONLY.length === 0 || ONLY.includes(key)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const URL = 'http://localhost:5173/?nodrive'
const PC = { width: 1440, height: 900, deviceScaleFactor: 1.5 }
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

// ---- アイコン（src/app/icons.tsx と同じ線の太さ。word は撮影のために足したもの：書類に W） ----
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const IC = {
  word: svg('<path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4"/><path d="M8.6 11.2l1.3 5.6 1.6-4.2 1.6 4.2 1.3-5.6"/>'),
  undo: svg('<path d="M9 7.5L5 11.5l4 4M5 11.5h9.5a4.5 4.5 0 010 9H12"/>'),
  table: svg('<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M4 14.5h16M10 10v9M15 10v9"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  keep: svg('<path d="M5 4.5h14v15H5zM9 4.5v5h6v-5M8.5 14h7M8.5 17h5"/>'),
}

const CSS = `
  /* はじめての案内は、①案C の撮影のときだけ出す */
  .v24-noguide .guide { display: none !important; }
  /* 撮影用に同時に開くページどうしで「別のタブで開いています」が出ることがあるので、出さない（案とは関係ない） */
  .login-over.tab-locked { display: none !important; }
  /* 試験用の設定にある「（自動テスト用）」のお知らせは、案と関係ないので出さない */
  .side .notice, .sheet .notice { display: none !important; }

  /* ファイル名：BIZ UDPゴシックは小さい字で「_」が消えるので、英数字だけ Segoe UI で出す */
  .v24-fn { font-family: "Segoe UI", "BIZ UDPGothic", sans-serif; }

  /* ---- ① 案A：右の欄に「Wordで書き始めた人へ」の小さな枠 ---- */
  .v24-card { margin: 0 20px 14px; padding: 11px 13px 12px; border-radius: 10px; background: var(--accent-soft); font-size: 12px; line-height: 1.65; color: var(--ink); }
  .v24-card .hd { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 12.5px; color: var(--accent); }
  .v24-card .hd svg { width: 17px; height: 17px; flex: none; }
  .v24-card .hd em { margin-left: auto; font-style: normal; font-weight: 400; font-size: 10.5px; color: var(--muted); background: #fff; border-radius: 999px; padding: 1px 8px; white-space: nowrap; }
  .v24-card p { margin: 4px 0 9px; }
  .v24-card button { width: 100%; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 0; border: 1px solid var(--accent); border-radius: var(--r-md); background: #fff; color: var(--accent); font-size: 13px; font-weight: 700; }
  .v24-card button svg { width: 17px; height: 17px; }
  .sheet-body .v24-card { margin: 12px 0 0; }
  .sheet-body .v24-card button { padding: 11px 0; font-size: 14px; }

  /* ---- ① 案B：バックアップの窓の中 ---- */
  .modal .v24-bsec { padding: 10px 14px 12px; border-radius: 10px; border: 1px solid var(--line); background: #f6f4ef; font-size: 13px; line-height: 1.7; }
  .modal .v24-bsec p { margin: 0 0 8px; }
  .modal .v24-bsec button { display: inline-flex; align-items: center; gap: 6px; }
  .modal .v24-bsec button svg { width: 17px; height: 17px; color: var(--accent); }

  /* ---- ① 案C：はじめての案内で聞く ---- */
  .v24-gword { margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); font-size: 12px; line-height: 1.7; color: #3f4249; }
  .v24-gword b { display: flex; align-items: center; gap: 6px; color: var(--accent); font-size: 12.5px; margin-bottom: 2px; }
  .v24-gword svg { width: 17px; height: 17px; flex: none; }
  .g-tip.v24-center::before { display: none; }
  .g-opts button.v24-opt { display: flex; align-items: flex-start; gap: 10px; }
  .g-opts button.v24-opt svg { width: 22px; height: 22px; flex: none; margin-top: 1px; }
  .g-opts button.v24-opt small { display: block; font-size: 11.5px; font-weight: 400; color: var(--muted); margin-top: 2px; line-height: 1.5; }
  .g-opts button.v24-opt.yes { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); font-weight: 700; }
  .g-opts button.v24-opt.no { padding-left: 46px; }
  /* 右の欄・スマホのメニューの、小さなリンク（「引用・参考文献を入れる」と同じ形） */
  .v24-link { display: inline-flex; align-items: center; gap: 5px; margin: 12px 0 0; padding: 0; border: 0; background: none; color: var(--accent); font-size: 12px; text-decoration: underline; text-underline-offset: 3px; }
  .v24-link svg { width: 16px; height: 16px; flex: none; }
  .sheet-body .v24-link { margin: 0 0 4px; font-size: 13.5px; }

  /* ---- ② 窓（ファイルを選ぶ・中身を確かめる） ---- */
  .modal.v24-modal { width: min(800px, calc(100vw - 32px)); }
  .modal.v24-mid { width: min(600px, calc(100vw - 32px)); }
  .modal.v24-modal h3, .modal.v24-mid h3 { margin: 0 0 6px; }
  .modal button:disabled { opacity: 0.45; }
  .v24-files { display: grid; gap: 8px; margin: 0 0 12px; }
  .v24-file { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; }
  .v24-file.req { border-color: #c3c9de; }
  .v24-file .ic { width: 34px; height: 40px; display: grid; place-items: center; border-radius: 6px; background: var(--accent-soft); color: var(--accent); }
  .v24-file .ic svg { width: 24px; height: 24px; }
  .v24-file b { display: block; font-size: 14px; }
  .v24-file b em { font-style: normal; font-weight: 400; font-size: 11px; color: var(--muted); margin-left: 6px; background: var(--chip-bg); padding: 1px 8px; border-radius: 999px; }
  .v24-file b em.must { color: var(--accent); background: var(--accent-soft); }
  .v24-file small { display: block; font-size: 12px; color: var(--muted); line-height: 1.6; }
  .v24-hint { margin: 0 0 8px; padding: 10px 12px; border-radius: 10px; background: #f6f4ef; font-size: 12.5px; line-height: 1.75; color: #3f4249; }
  .v24-hint b { color: var(--ink); }
  .v24-hint p { margin: 0; }
  .v24-hint p + p { margin-top: 4px; }
  .v24-picked { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; margin: 0 0 12px; font-size: 12.5px; color: var(--muted); }
  .v24-picked > span { display: inline-flex; align-items: center; gap: 5px; }
  .v24-picked svg { width: 16px; height: 16px; color: var(--accent); }
  .v24-picked b { color: var(--ink); }
  .v24-count { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 14px; }
  .v24-count span { padding: 4px 11px; border-radius: 999px; background: var(--chip-bg); font-size: 12.5px; color: var(--muted); }
  .v24-count b { color: var(--ink); font-size: 14px; margin-left: 3px; }
  .v24-cols { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 18px; }
  .v24-outline { list-style: none; margin: 0; padding: 4px 12px; border: 1px solid var(--line); border-radius: 10px; font-size: 13.5px; }
  .v24-outline li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; padding: 6px 0; border-bottom: 1px dashed var(--line); font-family: 'BIZ UDMincho', serif; }
  .v24-outline li:last-child { border-bottom: 0; }
  .v24-outline li.ch { font-weight: 700; font-size: 14px; }
  .v24-outline li.sh { padding-left: 16px; }
  .v24-outline li.odd { padding-left: 16px; font-family: 'BIZ UDPGothic', sans-serif; font-size: 12.5px; color: var(--warn); }
  .v24-outline .cnt { margin-left: auto; padding-left: 8px; font-family: 'BIZ UDPGothic', sans-serif; font-size: 11.5px; color: var(--muted); white-space: nowrap; }
  .v24-outline .cnt.ng { color: var(--warn); font-weight: 700; }
  .v24-skip { margin: 6px 2px 0; font-size: 11.5px; line-height: 1.6; color: var(--muted); }
  .v24-cover { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 3px 12px; margin: 0 0 14px; padding: 9px 12px; border-radius: 10px; background: #f6f4ef; font-size: 13.5px; }
  .v24-cover dt { color: var(--muted); font-size: 12px; padding-top: 1px; }
  .v24-cover dd { margin: 0; font-weight: 700; }
  .v24-figs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin: 0 0 8px; }
  .v24-figs figure { margin: 0; }
  .v24-figs img { width: 100%; aspect-ratio: 3 / 4; object-fit: cover; border-radius: 6px; border: 1px solid var(--line); display: block; }
  .v24-figs figcaption { font-size: 11px; line-height: 1.45; margin-top: 4px; font-family: 'BIZ UDMincho', serif; }
  .v24-figs .ng img { outline: 2px solid var(--warn); outline-offset: 1px; }
  .v24-figs .ng figcaption { color: var(--warn); font-family: 'BIZ UDPGothic', sans-serif; font-weight: 700; }
  .v24-tbl { display: flex; align-items: center; gap: 6px; font-size: 12.5px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px; }
  .v24-tbl svg { width: 18px; height: 18px; color: var(--accent); flex: none; }
  .v24-tbl small { margin-left: auto; color: var(--muted); font-size: 11.5px; }
  .v24-keep { display: flex; gap: 10px; margin: 16px 0 0; padding: 10px 14px; border-radius: 10px; background: var(--accent-soft); font-size: 12.5px; line-height: 1.7; }
  .v24-keep svg { width: 20px; height: 20px; flex: none; color: var(--accent); margin-top: 2px; }
  .v24-keep b { display: block; font-size: 13px; color: var(--accent); }
  .v24-warn { margin: 0 0 14px; padding: 10px 14px; border-radius: 10px; background: var(--warn-soft); font-size: 12.5px; line-height: 1.7; color: #4a3d22; }
  .v24-warn > b { display: block; color: var(--warn); font-size: 13.5px; }
  .v24-warn ul { list-style: none; margin: 6px 0 0; padding: 0; display: grid; gap: 6px; }
  .v24-warn li { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 8px; }
  .v24-warn li b { display: block; color: var(--ink); }
  .v24-dia { width: 16px; height: 16px; margin-top: 3px; border-radius: 3px; background: var(--warn); transform: rotate(45deg) scale(0.82); display: grid; place-items: center; color: #fff; font-size: 11px; font-weight: 700; font-style: normal; line-height: 1; }
  .v24-dia::before { content: '!'; transform: rotate(-45deg); }
  .v24-outline .v24-dia { display: inline-grid; width: 13px; height: 13px; font-size: 9px; margin: 0 2px 0 0; vertical-align: -1px; }
  /* 案B：紙面の縮小 */
  .v24-pages { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin: 2px 0 14px; padding: 16px; border-radius: 12px; background: var(--stage-bg); }
  .v24-pages figure { margin: 0; text-align: center; font-size: 11.5px; color: var(--muted); }
  .v24-pages img { width: 100%; display: block; margin-bottom: 6px; background: #fff; box-shadow: 0 1px 2px rgba(30, 25, 20, 0.08), 0 6px 16px rgba(30, 25, 20, 0.12); }
  /* 案C：要約だけ */
  .v24-brief { width: 100%; border-collapse: collapse; margin: 0 0 4px; font-size: 13.5px; }
  .v24-brief th { text-align: left; font-weight: 400; color: var(--muted); font-size: 12.5px; padding: 9px 14px 9px 0; white-space: nowrap; vertical-align: top; border-bottom: 1px solid var(--line); }
  .v24-brief td { padding: 9px 0; border-bottom: 1px solid var(--line); font-weight: 700; line-height: 1.6; }
  .v24-brief td.ok { color: var(--ok); }
  .modal button.v24-more { margin-top: 8px; font-size: 12.5px; }

  /* ---- ③ 写したあと ---- */
  .v24-next { margin: 0; padding: 0; list-style: none; counter-reset: n; display: grid; gap: 12px; }
  .v24-next li { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 10px; font-size: 13px; line-height: 1.7; }
  .v24-next li::before { counter-increment: n; content: counter(n); width: 26px; height: 26px; border-radius: 50%; background: var(--accent); color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 13px; }
  .v24-next li b { display: block; font-size: 14px; }
  .v24-next li span { color: var(--muted); }
  .v24-next li em { font-style: normal; color: var(--error); font-weight: 700; }
  .v24-okh { display: flex; align-items: center; gap: 8px; }
  .v24-okh i { width: 26px; height: 26px; flex: none; border-radius: 50%; background: var(--ok); color: #fff; display: grid; place-items: center; }
  .v24-okh i svg { width: 17px; height: 17px; }
  /* 案B：右の欄（スマホはチェックの欄）に残る「つぎにすること」 */
  .v24-todo { margin: 0 20px 14px; padding: 11px 13px 12px; border-radius: 12px; background: #fff; border: 1.5px solid var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); font-size: 12px; line-height: 1.6; }
  .v24-todo .hd { display: flex; align-items: center; gap: 6px; }
  .v24-todo .hd b { display: flex; align-items: center; gap: 5px; font-size: 13px; color: var(--accent); }
  .v24-todo .hd svg { width: 17px; height: 17px; flex: none; }
  .v24-todo .hd span { font-size: 11px; color: var(--muted); }
  .v24-todo .hd .x { margin-left: auto; border: 0; background: none; font-size: 18px; color: var(--muted); padding: 0 2px; line-height: 1; }
  .v24-todo > p { margin: 2px 0 8px; color: var(--muted); }
  .v24-todo ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .v24-todo li { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; gap: 8px; align-items: start; }
  .v24-todo li .box { width: 16px; height: 16px; margin-top: 1px; border: 1.5px solid #aeb3c2; border-radius: 4px; display: grid; place-items: center; color: #fff; }
  .v24-todo li .box svg { width: 12px; height: 12px; stroke-width: 2.4; }
  .v24-todo li.done .box { background: var(--ok); border-color: var(--ok); }
  .v24-todo li.done b { color: var(--muted); }
  .v24-todo li b { display: block; font-size: 12.5px; }
  .v24-todo li small { display: block; font-size: 11.5px; color: var(--muted); }
  .v24-todo li small em { font-style: normal; color: var(--error); font-weight: 700; }
  .v24-todo li .go { align-self: center; border: 1px solid var(--accent); background: transparent; color: var(--accent); border-radius: 999px; padding: 2px 10px; font-size: 11.5px; white-space: nowrap; }
  .v24-todo .undo { display: inline-flex; align-items: center; gap: 4px; margin-top: 10px; padding: 0; border: 0; background: none; color: var(--muted); font-size: 11.5px; text-decoration: underline; text-underline-offset: 3px; }
  .v24-todo .undo svg { width: 15px; height: 15px; }
  .sheet-body .v24-todo { margin: 2px 0 12px; font-size: 12.5px; }
  .sheet-body .v24-todo li b { font-size: 13.5px; }
  .sheet-body .v24-todo li small { font-size: 12px; }
  .sheet-body .v24-todo li .go { padding: 5px 12px; font-size: 12.5px; }
  /* 案C：画面の下の知らせと、紙面の図の札 */
  .v24-toast { position: fixed; z-index: 35; bottom: 22px; display: flex; align-items: center; gap: 10px; padding: 9px 9px 9px 16px; border-radius: 12px; background: #2b2e36; color: #fff; font-size: 13.5px; box-shadow: 0 10px 28px rgba(20, 20, 30, 0.3); white-space: nowrap; transform: translateX(-50%); }
  .v24-toast button { display: flex; align-items: center; gap: 5px; border: 0; border-radius: 8px; padding: 7px 12px; background: #fff; color: var(--accent); font-size: 13px; font-weight: 700; }
  .v24-toast button.sub { background: rgba(255, 255, 255, 0.12); color: #fff; font-weight: 400; }
  .v24-toast button svg { width: 16px; height: 16px; }
  .v24-ftag { position: relative; outline: calc(2px / var(--s)) dashed #8a5e0f !important; outline-offset: calc(4px / var(--s)); }
  .v24-ftag::after { content: '位置を確かめる'; position: absolute; z-index: 5; right: calc(-6px / var(--s)); top: calc(-6px / var(--s)); transform: translateY(-100%); padding: calc(2px / var(--s)) calc(8px / var(--s)); border-radius: calc(5px / var(--s)); background: #8a5e0f; color: #fff; font-family: 'BIZ UDPGothic', sans-serif; font-size: calc(11px / var(--s)); font-weight: 700; line-height: 1.4; text-indent: 0; white-space: nowrap; }

  /* ---- スマホ（窓の中を1列に） ---- */
  @media (max-width: 600px) {
    .v24-cols { grid-template-columns: minmax(0, 1fr); gap: 14px; }
    .v24-file { grid-template-columns: 34px minmax(0, 1fr); }
    .v24-file button { grid-column: 1 / -1; padding: 10px 14px !important; font-size: 14px !important; }
    .modal.v24-modal, .modal.v24-mid { padding: 18px 18px 20px; max-height: calc(100vh - 24px); }
    .v24-figs figcaption { font-size: 11.5px; }
    .v24-count { gap: 4px; }
    .v24-count span { padding: 3px 8px; font-size: 12px; }
    .v24-count b { font-size: 13px; margin-left: 2px; }
  }
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

/**
 * 原稿を用意する（ページの中で動かす）。
 * before：Word を読み込む前のツールの原稿（コースを選び、学籍番号だけ自動で入った、ひな形のまま）
 * imported：Word から写したあとの原稿（大見出し2・小見出し4・段落9・図3・表1、表紙の学籍番号・氏名・サブタイトル）
 * どちらでも、図の画像（デザイン画・トワル）と生地見本を作り、窓に出す小さな画像（data URL）を window.__v24 に置く
 */
async function setupState(state) {
  const { DEFAULT_TEMPLATE, bodyFromTemplate } = await import('/src/model/template.ts')
  const { fromMaterialTable } = await import('/src/model/table.ts')
  const make = async (id, w, h, draw) => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    draw(c.getContext('2d'), w, h)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
    return { image: { id, blob, widthPx: w, heightPx: h }, url: c.toDataURL('image/jpeg', 0.82) }
  }
  // 人の形の絵（デザイン画・トワルの写真の代わり。mockup-shots-v23 と同じ描き方）
  const person = (bg1, bg2, cloth, accent, skirt = '#f1ece2') => (g, w, h) => {
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
    g.fillStyle = skirt
    g.beginPath(); g.moveTo(cx - 12 * u, 58 * u); g.lineTo(cx + 12 * u, 58 * u); g.lineTo(cx + 11 * u, 88 * u); g.lineTo(cx + 2 * u, 88 * u); g.lineTo(cx, 66 * u); g.lineTo(cx - 2 * u, 88 * u); g.lineTo(cx - 11 * u, 88 * u); g.closePath(); g.fill()
    g.fillStyle = accent
    g.fillRect(cx - 12 * u, 44 * u, 24 * u, 5 * u)
    g.fillStyle = '#e6c3a0'
    g.beginPath(); g.arc(cx, 16 * u, 5.5 * u, 0, Math.PI * 2); g.fill()
    g.fillStyle = accent
    g.beginPath(); g.ellipse(cx, 12.5 * u, 7 * u, 4.5 * u, 0, Math.PI, 0); g.fill()
  }
  // 生地見本（色と、光の筋）
  const swatch = (base, line) => (g, w, h) => {
    g.fillStyle = base
    g.fillRect(0, 0, w, h)
    g.strokeStyle = line
    g.lineWidth = 3
    for (let x = -h; x < w; x += 14) {
      g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.stroke()
    }
  }
  if (!window.__v24) {
    const made = await Promise.all([
      make('v24-f1', 600, 800, person('#f8f4ec', '#ece3d1', '#2f4f8a', '#c8a24a')),
      make('v24-f2', 900, 1200, person('#d9d5cc', '#aaa395', '#ece4d0', '#cdbf9f', '#e6dcc4')),
      make('v24-f3', 900, 1200, person('#cfcac0', '#9c958a', '#e8dfc9', '#bfb091', '#e3d8bf')),
      make('v24-s1', 240, 240, swatch('#22335c', 'rgba(255,255,255,0.10)')),
      make('v24-s2', 240, 240, swatch('#9cc3dc', 'rgba(255,255,255,0.28)')),
      make('v24-s3', 240, 240, swatch('#f4f1ea', 'rgba(0,0,0,0.05)')),
    ])
    window.__editor.addImages(made.map((m) => m.image))
    window.__v24 = { urls: Object.fromEntries(made.map((m) => [m.image.id, m.url])) }
  }
  const r0 = window.__editor.getSnapshot().report
  const t = (text) => ({ type: 'text', text })
  const ref = (targetId, withParens = true) => ({ type: 'ref', targetId, withParens })
  const p = (id, ...content) => ({ type: 'paragraph', id, content: content.map((c) => (typeof c === 'string' ? t(c) : c)) })
  if (state === 'before') {
    window.__editor.replace({
      ...r0,
      basicInfo: { studentId: '00ZZ0123', name: '', courseId: 'film-stage-costume', subtitleInput: '' },
      abstract: { ...r0.abstract, started: false },
      body: bodyFromTemplate(DEFAULT_TEMPLATE),
      references: [],
      workPhotos: { layout: 1, imageIds: [] },
    })
    return
  }
  // Word から写した原稿（見出しの番号「Ⅰ．」「ⅰ．」と段落の頭の全角の空白は、ツールが付けるので外してある）
  window.__editor.replace({
    ...r0,
    basicInfo: { studentId: '00ZZ0123', name: '文化　花子', courseId: 'film-stage-costume', subtitleInput: 'シンドバッド' },
    abstract: { ...r0.abstract, started: false },
    body: [
      {
        id: 'c1',
        title: '企画・立案',
        blocks: [
          { type: 'subheading', id: 's1', title: '担当衣装のキャラクター' },
          p('p1', '筆者が担当したのは、物語の主人公である船乗りシンドバッドの衣装である。シンドバッドは七つの航海を経て成長していく人物であり、場面ごとに異なる表情を見せる。'),
          p('p2', '本制作では、旅立ちの場面の若々しさと、帰還の場面の頼もしさの両方を、一着の衣装で表すことを目標とした。'),
          { type: 'subheading', id: 's2', title: 'デザイン説明' },
          p('p3', '中東の伝統的な装いをもとに、航海の力強さと冒険心を表すデザインを考えた', ref('f1'), '。キーワードは自由、勇気、海である。'),
          { type: 'figureRow', id: 'r1', figures: [{ id: 'f1', imageId: 'v24-f1', caption: 'デザイン画' }] },
          p('p4', '袖は風をはらむように大きく膨らませ、腰には幅の広い帯を巻いた。帯には波の模様を刺繍で入れ、海の青と砂の金を配色の軸とした。'),
          { type: 'subheading', id: 's3', title: '使用素材' },
          p('p5', ref('t1', false), 'に使用した素材をまとめる。'),
          fromMaterialTable({
            id: 't1',
            caption: '使用材料表',
            rows: [
              { id: 'm1', name: 'コットンサテン', usage: 'ジャケット', swatchImageId: 'v24-s1' },
              { id: 'm2', name: 'シルクシフォン', usage: '袖\n帯', swatchImageId: 'v24-s2' },
              { id: 'm3', name: 'ブロード', usage: 'シャツ', swatchImageId: 'v24-s3' },
            ],
          }),
        ],
      },
      {
        id: 'c2',
        title: '制作過程',
        blocks: [
          { type: 'subheading', id: 's4', title: 'トワル組み' },
          p('p6', 'デザイン画をもとに、まずシーチングでトワルを組んだ', ref('f2'), ref('f3'), '。'),
          { type: 'figureRow', id: 'r2', figures: [{ id: 'f2', imageId: 'v24-f2', caption: 'トワル（前）' }, { id: 'f3', imageId: 'v24-f3', caption: 'トワル（後ろ）' }] },
          p('p7', '一回目の仮縫いでは、袖の膨らみが大きすぎて、腕を上げたときに肩が引きつれた。そこで袖山を３cm下げ、袖幅も細くした。'),
          p('p8', '前身頃は、見頃の丈を5㎝長くし、裾に向かって広がる形に直した。'),
          p('p9', '二回目の仮縫いでは、実際に舞台の上で歩いたり腕を回したりして、動きやすさを確かめた。'),
        ],
      },
    ],
    references: [],
    workPhotos: { layout: 1, imageIds: [] },
  })
}

/** 学生用ツールを開く。state：before（読み込む前）・imported（写したあと）・fresh（はじめて開いたまま。案内を出す） */
async function open(browser, { phone = false, state = 'before', dpr } = {}) {
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
  if (state === 'fresh') {
    await page.waitForSelector('.g-tip', { timeout: 20000 })
  } else {
    await page.evaluate(() => document.documentElement.classList.add('v24-noguide'))
    await page.evaluate(setupState, state)
    await sleep(800)
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

const goTo = async (page, blockId, phone) => {
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), blockId)
  await sleep(300)
  await ready(page, phone)
}

/** 窓のまわりを切り抜く範囲 */
const aroundModal = (page, pad = { x: 50, y: 40 }) =>
  page.evaluate((pad) => {
    const r = document.querySelector('.modal').getBoundingClientRect()
    const x = Math.max(0, r.left - pad.x)
    const y = Math.max(0, r.top - pad.y)
    return { x, y, width: Math.min(innerWidth - x, r.width + pad.x * 2), height: Math.min(innerHeight - y, r.height + pad.y * 2) }
  }, pad)

/** 窓を出す（ツールの Modal と同じ形） */
const modal = (title, body, cls = 'v24-modal') =>
  `<div class="modal-backdrop"><div class="modal ${cls}" role="dialog"><header><h2>${title}</h2><button class="close" aria-label="閉じる">×</button></header>${body}</div></div>`
const addModal = (page, html) => page.evaluate((html) => document.body.insertAdjacentHTML('beforeend', html), html)

// ---- 窓の中身 ----

/** 「Wordから読み込む」を押したところ（ファイルを選ぶ。どの案も同じ）。phone：スマホ（iPhone）の説明にする */
const startBody = (phone) => `
  <p class="lead">学科のひな形（Word）に書いた分を、このツールに写します。見出し・段落・図・表と、表紙の学籍番号・氏名・サブタイトルを写します（Word の文字の大きさや配置は写さず、ツールの決まった形で組み直します）。</p>
  <div class="v24-files">
    <div class="v24-file req"><span class="ic">${IC.word}</span><div><b>本文の Word<em class="must">必ず</em></b><small>例：<span class="v24-fn">04_本文.docx</span></small></div><button class="primary">ファイルを選ぶ</button></div>
    <div class="v24-file"><span class="ic">${IC.word}</span><div><b>表紙の Word<em>書いていれば</em></b><small>例：<span class="v24-fn">01_表紙.docx</span>（学籍番号・氏名・サブタイトルを写します）</small></div><button>ファイルを選ぶ</button></div>
  </div>
  <div class="v24-hint">${
    phone
      ? '<p><b>OneDrive・Google ドライブ・iCloud Drive にあるとき</b>：「ファイルを選ぶ」で開く画面の下の「ブラウズ」から、その場所を選びます（OneDrive・Google ドライブは、アプリを入れていると出ます）。</p>'
      : '<p><b>OneDrive・Google ドライブにあるとき</b>：「ファイルを選ぶ」で開く画面で、OneDrive などのフォルダを選びます。ブラウザでしか開けない場所にあるときは、先にパソコンへダウンロードしてください。</p>'
  }<p>Google ドキュメントに変えたものではなく、Word（.docx）のファイルを選びます。ファイルは、この端末のブラウザの中だけで読み取ります（どこにも送りません）。</p></div>
  <div class="row-buttons"><span class="spacer"></span><button>やめる</button><button class="primary" disabled>中身を確かめる</button></div>`

const PICKED = `<div class="v24-picked"><span>${IC.word}本文：<b><span class="v24-fn">04_本文.docx</span></b></span><span>${IC.word}表紙：<b><span class="v24-fn">01_表紙.docx</span></b></span><button class="link">選び直す</button></div>`
const COUNT = (para = 9) => `<div class="v24-count"><span>大見出し<b>2</b></span><span>小見出し<b>4</b></span><span>段落<b>${para}</b></span><span>図<b>3</b></span><span>表<b>1</b></span></div>`
const KEEP = `<div class="v24-keep">${IC.keep}<div><b>いまのツールの原稿は「自動の控え」に残します</b>本文は Word の中身に入れ替わり、表紙の学籍番号・氏名・サブタイトルも Word のものになります（抄録・作品写真・引用・参考文献はそのまま）。元に戻したいときは「バックアップ」から戻せます。</div></div>`
const BUTTONS = `<div class="row-buttons"><span class="spacer"></span><button>やめる</button><button class="primary">読み込む</button></div>`

/** 案A：一覧で見せる。problem：読み取れなかったところがあるとき */
const confirmA = (urls, problem) => `
  ${PICKED}
  ${
    problem
      ? `<div class="v24-warn"><b>うまく読み取れなかったところが 2つあります</b>このまま読み込めます。読み込んだあと、ツールで直してください。
          <ul>
            <li><i class="v24-dia"></i><div><b>図2のタイトルが見つかりません</b>写真のすぐ下に「図2　〇〇」の行がないため、タイトルを空にして写します。</div></li>
            <li><i class="v24-dia"></i><div><b>見出しの形でない行があります：「２．パターン」</b>「ⅱ．」の形でないため、ふつうの段落として写します。小見出しにするときは、ツールで直してください。</div></li>
          </ul></div>`
      : ''
  }
  ${COUNT(problem ? 11 : 9)}
  <div class="v24-cols">
    <section>
      <h3>本文の組み立て</h3>
      <ol class="v24-outline">
        <li class="ch">Ⅰ．企画・立案</li>
        <li class="sh">ⅰ．担当衣装のキャラクター<span class="cnt">段落 2</span></li>
        <li class="sh">ⅱ．デザイン説明<span class="cnt">段落 2・図1</span></li>
        <li class="sh">ⅲ．使用素材<span class="cnt">段落 1・表1</span></li>
        <li class="ch">Ⅱ．制作過程</li>
        <li class="sh">ⅰ．トワル組み${problem ? '<span class="cnt ng"><i class="v24-dia"></i>段落 4・図2（タイトルなし）・図3</span>' : '<span class="cnt">段落 4・図2・図3</span>'}</li>
        ${problem ? '<li class="odd"><i class="v24-dia"></i>「２．パターン」→ 段落として写す<span class="cnt">段落 2</span></li>' : ''}
      </ol>
      <p class="v24-skip">ひな形のままの行（「〇〇〇〇」「～～～～」だけの行）${problem ? '7行' : '6行'}は写しません。</p>
    </section>
    <section>
      <h3>表紙</h3>
      <dl class="v24-cover"><dt>学籍番号</dt><dd>00ZZ0123</dd><dt>氏名</dt><dd>文化　花子</dd><dt>サブタイトル</dt><dd>―シンドバッドの衣装制作―</dd></dl>
      <h3>図・表</h3>
      <div class="v24-figs">
        <figure><img src="${urls['v24-f1']}" alt=""><figcaption>図1　デザイン画</figcaption></figure>
        <figure${problem ? ' class="ng"' : ''}><img src="${urls['v24-f2']}" alt=""><figcaption>${problem ? '図2　（タイトルなし）' : '図2　トワル（前）'}</figcaption></figure>
        <figure><img src="${urls['v24-f3']}" alt=""><figcaption>図3　トワル（後ろ）</figcaption></figure>
      </div>
      <div class="v24-tbl">${IC.table}表1　使用材料表<small>素材 3つ</small></div>
    </section>
  </div>
  ${KEEP}
  ${BUTTONS}`

/** 案B：紙面の縮小で見せる（pages：表紙と本文のページの画像） */
const confirmB = (pages) => `
  ${PICKED}
  <p class="lead" style="margin-bottom:8px">Word の中身を、ツールの決まった形で組んだところです（表紙と、本文 ${pages.length - 1}ページ）。</p>
  <div class="v24-pages">${pages.map((pg) => `<figure><img src="${pg.url}" alt="">${pg.label}</figure>`).join('')}</div>
  ${COUNT()}
  ${KEEP}
  ${BUTTONS}`

/** 案C：要約だけ */
const confirmC = `
  <p class="lead"><span class="v24-fn">04_本文.docx</span> と <span class="v24-fn">01_表紙.docx</span> から、次のものを写します。</p>
  <table class="v24-brief">
    <tr><th>表紙</th><td>学籍番号・氏名・サブタイトル</td></tr>
    <tr><th>本文</th><td>大見出し 2・小見出し 4・段落 9・図 3・表 1</td></tr>
    <tr><th>読み取れなかったところ</th><td class="ok">ありません</td></tr>
  </table>
  <button class="v24-more link">中身の一覧を見る ▸</button>
  ${KEEP}
  ${BUTTONS}`

/** ③ 案A：写したあとの窓 */
const afterA = (n) => `
  <p class="lead">大見出し 2・小見出し 4・段落 9・図 3・表 1 と、表紙の学籍番号・氏名・サブタイトルを写しました。続けて、次の順に確かめてください。</p>
  <ol class="v24-next">
    <li><div><b>セルフチェックの指摘を直す</b><span>エラー <em>${n.errors}件</em>・警告 ${n.warnings}件。Word では気づかなかった、手順書のルールに合わないところです。</span></div></li>
    <li><div><b>図の位置を確かめる</b><span>ツールでは、図は「（図1）」と書いた段落のすぐ後ろに入ります。ページに入りきらないときは、次のページの上に移ります。</span></div></li>
    <li><div><b>表紙を確かめる</b><span>コース・学籍番号・氏名・サブタイトルが合っているか。</span></div></li>
  </ol>
  <p class="drive-small" style="margin-top:14px">元に戻すとき：「バックアップ」→ 自動の控えの「10月7日 14:32（Wordから読み込む前）」</p>
  <div class="row-buttons"><span class="spacer"></span><button>閉じる</button><button class="primary">セルフチェックを見る</button></div>`

/** ③ 案B：右の欄（スマホはチェックの欄）に残す「つぎにすること」 */
const afterB = (n) => `<div class="v24-todo">
  <div class="hd"><b>${IC.word}Word から写しました</b><button class="x" aria-label="閉じる">×</button></div>
  <p>10月7日 14:32 に写しました。次の3つを確かめたら、移しかえは終わりです。</p>
  <ul>
    <li><i class="box"></i><div><b>セルフチェックのエラーを直す</b><small>あと <em>${n.errors}件</em>（下の一覧）</small></div><span></span></li>
    <li><i class="box"></i><div><b>図の位置を確かめる</b><small>図1〜図3（3枚）</small></div><button class="go">図1へ</button></li>
    <li class="done"><i class="box">${IC.check}</i><div><b>表紙を確かめる</b><small>表紙のページを開いたので、済みにしました</small></div><span></span></li>
  </ul>
  <button class="undo">${IC.undo}読み込む前の原稿に戻す</button>
</div>`

/** 写したあとの指摘の数 */
const counts = (page) =>
  page.evaluate(() => {
    const f = window.__editor.getSnapshot().findings
    const errors = f.filter((x) => x.severity === 'error').length
    return { errors, warnings: f.length - errors }
  })

// ---- ① 案C：はじめての案内 ----
const STEPS = (on) =>
  ['コース', 'Word', '学籍番号', '氏名', 'サブタイトル'].map((label, i) => `<span class="${i === on ? 'on' : i < on ? 'past' : ''}">${i + 1} ${label}</span>`).join('')
/** コースを選ぶ段階に「Wordで書き始めている人へ」を足す */
const guideCourse = (page) =>
  page.evaluate(
    (steps, word) => {
      const tip = document.querySelector('.g-tip')
      const before = tip.getBoundingClientRect()
      document.querySelector('.g-steps').innerHTML = steps
      document
        .querySelector('.g-note')
        .insertAdjacentHTML('afterend', `<div class="v24-gword"><b>${word}Word のひな形で書き始めている人へ</b>まずコースを選んでください。次の画面で、書いた Word を読み込めます（学籍番号・氏名・サブタイトルも写ります）。</div>`)
      // PC で案内がコース欄の上に出ているときは、下の端（矢印の位置）をそのままにして、上へ伸ばす（コース欄を隠さない）
      if (tip.classList.contains('above') && !document.querySelector('.guide.narrow')) tip.style.top = `${before.bottom - tip.offsetHeight}px`
    },
    STEPS(0),
    IC.word,
  )
/** コースを選んだあとの段階「Wordで書き始めていますか？」 */
const guideWord = (page, phone) =>
  page.evaluate(
    (steps, word, phone) => {
      const guide = document.querySelector('.guide')
      guide.classList.remove('step-course')
      guide.classList.add('step-done') // スマホでは画面の下に出す（今の「表紙ができました」と同じ置き方）
      guide.querySelector('.g-spot')?.remove()
      if (!guide.querySelector('.g-dim')) guide.insertAdjacentHTML('afterbegin', '<div class="g-dim"></div>')
      const tip = guide.querySelector('.g-tip')
      tip.innerHTML = `<div class="g-steps">${steps}</div>
        <h2>Word で書き始めていますか？</h2>
        <p>学科が配った Word のひな形（<span class="v24-fn">04_本文.docx</span> など）に書いた分があれば、このツールに写せます。</p>
        <div class="g-opts">
          <button class="v24-opt yes">${word}<span>はい、Word から読み込む<small>本文の Word と、書いていれば表紙の Word を選びます</small></span></button>
          <button class="v24-opt no"><span>いいえ、ここから書き始める<small>学籍番号・氏名・サブタイトルを順に案内します</small></span></button>
        </div>
        <span class="g-note">あとからでも、${phone ? 'メニュー' : '右の欄'}の「Word で書いた分を読み込む」から読み込めます（今年度だけ）。</span>`
      if (!phone) {
        tip.classList.remove('above')
        tip.classList.add('v24-center')
        tip.style.left = `${(innerWidth - tip.offsetWidth) / 2}px`
        tip.style.top = `${(innerHeight - tip.offsetHeight) / 2}px`
      }
    },
    STEPS(1),
    IC.word,
    phone,
  )

/**
 * コースを選んだあと（後ろの表紙・右の欄を、コースを選んだ原稿にする）。案内の段階はそのまま（中身だけ、次の段階に書きかえる）。
 * 学籍番号は、ログインしたアカウントから自動で入る（ドライブ保存のとき）
 */
const chooseCourse = async (page, phone) => {
  await page.evaluate(setupState, 'before')
  await sleep(800)
  await ready(page, phone)
}

/** ① 案A の枠 */
const CARD = `<div class="v24-card"><div class="hd">${IC.word}Word で書き始めた人へ<em>今年度だけ</em></div><p>学科のひな形（Word）に書いた分を、このツールに写せます。11月の途中点検の前に移しましょう。</p><button>${IC.word}Wordから読み込む</button></div>`
/** ① 案C の小さなリンク */
const LINK = `<button class="v24-link">${IC.word}Word で書いた分を読み込む（今年度だけ）</button>`

/** スマホのメニューを開く */
const openMenu = async (page) => {
  await page.click('.p-top .icon-btn')
  await page.waitForSelector('.sheet .sheet-body')
  await page.mouse.move(5, 5)
  await sleep(500)
}

/** 本文と表紙のページの画像（②案B の窓に出す）。写したあとの原稿を開いて、ページごとに撮る */
async function pageImages(browser) {
  const { context, page } = await open(browser, { state: 'imported', dpr: 1.5 })
  const kinds = await page.evaluate(() => window.__editor.getSnapshot().layout.kinds)
  const pick = [0, ...kinds.map((k, i) => (k === 'body' ? i : -1)).filter((i) => i >= 0).slice(0, 3)]
  const out = []
  let body = 0
  for (const i of pick) {
    await page.evaluate((i) => window.__editor.goToPage(i, 'none'), i)
    await sleep(300)
    await ready(page)
    await sleep(300)
    const b64 = await (await page.$(CUR)).screenshot({ encoding: 'base64', type: 'jpeg', quality: 85 })
    out.push({ url: `data:image/jpeg;base64,${b64}`, label: kinds[i] === 'cover' ? '表紙' : `本文 ${++body}` })
  }
  await context.close()
  return out
}

await withEdge(async (browser) => {
  // ================= ① 入り口（どこから読み込むか） =================
  if (want('1')) {
    // 案A：右の欄に小さな枠／スマホはメニューの中
    {
      const { context, page } = await open(browser)
      await page.evaluate((html) => document.querySelector('.side .side-head').insertAdjacentHTML('afterend', html), CARD)
      await shot(page, '1-a-pc')
      await shot(page, '1-a-side', { el: '.side', wait: 50 })
      await context.close()
    }
    {
      const { context, page } = await open(browser, { phone: true })
      await openMenu(page)
      await page.evaluate((html) => document.querySelector('.sheet-body .links').insertAdjacentHTML('afterend', html), CARD)
      await shot(page, '1-a-phone')
      await context.close()
    }
    // 案B：バックアップの窓の中
    const backupSection = `<h3>Word から読み込む（今年度だけ）</h3><div class="v24-bsec"><p>学科のひな形（Word）で書き始めた人は、書いた分をこのツールに写せます。いまの原稿は、写す前に自動の控えに残します。</p><button>${IC.word}Word を選んで読み込む</button></div>`
    for (const phone of [false, true]) {
      const { context, page } = await open(browser, { phone })
      if (phone) {
        await openMenu(page)
        await page.evaluate(() => [...document.querySelectorAll('.sheet .links button')].find((b) => b.textContent.includes('バックアップ')).click())
      } else {
        await page.evaluate(() => [...document.querySelectorAll('.side .links button')].find((b) => b.textContent.includes('バックアップ')).click())
      }
      await page.waitForSelector('.modal .backup-actions')
      await sleep(300)
      await page.evaluate((html) => document.querySelector('.modal .backup-actions').insertAdjacentHTML('afterend', html), backupSection)
      if (phone) await shot(page, '1-b-phone')
      else {
        // 右の欄の「バックアップ」の場所と、窓の両方が見えるよう、窓から右の欄までを切り抜く
        const clip = await page.evaluate(() => {
          const m = document.querySelector('.modal').getBoundingClientRect()
          const s = document.querySelector('.side').getBoundingClientRect()
          return { x: m.left - 40, y: 0, width: s.right - (m.left - 40), height: Math.min(innerHeight, m.bottom + 40) }
        })
        await shot(page, '1-b-pc', { clip })
      }
      await context.close()
    }
    // 案C：はじめての案内（コースを選ぶ）で聞く／あとからは右の欄（スマホはメニュー）の小さなリンク
    {
      const { context, page } = await open(browser, { state: 'fresh' })
      await guideCourse(page)
      await shot(page, '1-c-guide')
      await chooseCourse(page)
      await guideWord(page, false)
      await shot(page, '1-c-next')
      await context.close()
    }
    {
      const { context, page } = await open(browser)
      await page.evaluate((html) => document.querySelector('.side .side-head .links').insertAdjacentHTML('afterend', html), LINK)
      await shot(page, '1-c-side', { el: '.side' })
      await context.close()
    }
    {
      const { context, page } = await open(browser, { phone: true, state: 'fresh' })
      await guideCourse(page)
      await shot(page, '1-c-phone')
      await context.close()
    }
  }

  // ================= ② 写す前の確認の窓 =================
  if (want('2')) {
    // 「Wordから読み込む」を押したところ（どの案も同じ）
    {
      const { context, page } = await open(browser)
      await addModal(page, modal('Word から読み込む（今年度だけ）', startBody(false), 'v24-mid'))
      await shot(page, '2-start', { clip: await aroundModal(page) })
      await context.close()
    }
    // 案A：一覧で見せる（ふつう・読み取れなかったところがあるとき）
    for (const problem of [false, true]) {
      const { context, page } = await open(browser)
      const urls = await page.evaluate(() => window.__v24.urls)
      await addModal(page, modal('Word の中身を確かめてください', confirmA(urls, problem)))
      await shot(page, problem ? '2-a-problem' : '2-a', { clip: await aroundModal(page, { x: 40, y: 24 }) })
      await context.close()
    }
    // 案B：紙面の縮小で見せる
    {
      const pages = await pageImages(browser)
      const { context, page } = await open(browser)
      await addModal(page, modal('読み込むと、こうなります', confirmB(pages)))
      await sleep(500)
      await shot(page, '2-b', { clip: await aroundModal(page, { x: 40, y: 24 }) })
      await context.close()
    }
    // 案C：要約だけ
    {
      const { context, page } = await open(browser)
      await addModal(page, modal('Word から読み込みますか？', confirmC, 'v24-mid'))
      await shot(page, '2-c', { clip: await aroundModal(page) })
      await context.close()
    }
  }

  // ================= ③ 写したあとの知らせ =================
  if (want('3')) {
    // 案A：窓で、次にすることを伝える
    {
      const { context, page } = await open(browser, { state: 'imported' })
      await page.evaluate(() => window.__editor.goToArea('body'))
      await ready(page)
      const n = await counts(page)
      console.log('findings after import', JSON.stringify(n))
      await addModal(
        page,
        modal(`<span class="v24-okh"><i>${IC.check}</i>Word から写しました</span>`, afterA(n), 'v24-mid'),
      )
      await shot(page, '3-a')
      await context.close()
    }
    // 案B：右の欄に「つぎにすること」を残す
    {
      const { context, page } = await open(browser, { state: 'imported' })
      await page.evaluate(() => window.__editor.goToArea('body'))
      await ready(page)
      const n = await counts(page)
      await page.evaluate((html) => document.querySelector('.side .side-head').insertAdjacentHTML('afterend', html), afterB(n))
      await shot(page, '3-b')
      await shot(page, '3-b-side', { el: '.side', wait: 50 })
      await context.close()
    }
    // 案C：画面の下に短い知らせ、紙面の図に「位置を確かめる」の札
    {
      const { context, page } = await open(browser, { state: 'imported' })
      await goTo(page, 'p3')
      await page.evaluate(
        (CUR, IC) => {
          for (const f of document.querySelectorAll(`${CUR} figure[data-figure-id]`)) f.classList.add('v24-ftag')
          const stage = document.querySelector('.stage').getBoundingClientRect()
          document.body.insertAdjacentHTML(
            'beforeend',
            `<div class="v24-toast" style="left:${stage.left + stage.width / 2}px"><span>Word から写しました。指摘と図の位置を確かめましょう</span><button class="sub">セルフチェックを見る</button><button>${IC.undo}元に戻す</button></div>`,
          )
        },
        CUR,
        IC,
      )
      await shot(page, '3-c')
      await context.close()
    }
  }

  // ================= ④ スマホの見え方（おすすめの組み合わせ） =================
  if (want('4')) {
    // 入り口：案内の「Wordで書き始めていますか？」・メニューのリンク
    {
      const { context, page } = await open(browser, { phone: true, state: 'fresh' })
      await chooseCourse(page, true)
      await guideWord(page, true)
      await shot(page, '4-guide-next')
      await context.close()
    }
    {
      const { context, page } = await open(browser, { phone: true })
      await openMenu(page)
      await page.evaluate((html) => document.querySelector('.sheet-body .links').insertAdjacentHTML('afterend', html), LINK)
      await shot(page, '4-menu')
      await context.close()
    }
    // ファイルを選ぶ窓
    {
      const { context, page } = await open(browser, { phone: true })
      await addModal(page, modal('Word から読み込む（今年度だけ）', startBody(true), 'v24-mid'))
      await shot(page, '4-start')
      await context.close()
    }
    // 確かめる窓（案A）：上・下までずらしたところ・読み取れなかったところがあるとき
    for (const problem of [false, true]) {
      const { context, page } = await open(browser, { phone: true })
      const urls = await page.evaluate(() => window.__v24.urls)
      await addModal(page, modal('Word の中身を確かめてください', confirmA(urls, problem)))
      await shot(page, problem ? '4-problem' : '4-confirm-top')
      if (!problem) {
        await page.evaluate(() => {
          const m = document.querySelector('.modal')
          m.scrollTop = m.scrollHeight
        })
        await shot(page, '4-confirm-bottom')
      }
      await context.close()
    }
    // 写したあと（案B）：チェックの欄の上に「つぎにすること」
    {
      const { context, page } = await open(browser, { phone: true, state: 'imported' })
      await page.evaluate(() => window.__editor.goToArea('body'))
      await ready(page, true)
      const n = await counts(page)
      await page.click('.p-nav button:nth-child(3)')
      await page.waitForSelector('.sheet .sheet-body')
      await page.mouse.move(5, 5)
      await sleep(500)
      await page.evaluate((html) => document.querySelector('.sheet-body').insertAdjacentHTML('afterbegin', html), afterB(n))
      await shot(page, '4-after')
      await context.close()
    }
  }

  // 一覧のページ
  if (ONLY.length === 0 || ONLY.includes('review')) {
    const page = await browser.newPage()
    await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 })
    await page.goto('http://localhost:5173/mockups/v24/review.html', { waitUntil: 'networkidle0' })
    await page.screenshot({ path: `${OUT}/review.png`, fullPage: true })
    console.log(`${OUT}/review.png`)
  }
})
