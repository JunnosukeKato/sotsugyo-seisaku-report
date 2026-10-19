// デザイン案 v35（5つ：右の欄の見せ方／表の大きさを最初に選ぶ／見開き表示／「元に戻す」「やり直す」の置き場所／エラー0件のときの下書き PDF と透かし）を画像に書き出す。
// 本物の学生用ツール（開発サーバーの /?nodrive。ログインなし）を開き、はじめたばかりの原稿や、見本の原稿（scripts/e2e/sampleReport.mjs の setupWriting。衣装コースの架空の学生）を入れて、
// 右の欄・道具・窓などを、案ごとに書き換えて写す（src/ は変えない）。指摘の数や中身は、本物のツールが出したもの。
// できるもの：mockups/v35/shots/*.png（案の画面）と、shots/review-panel.png などの一覧の写し（mockups/v35/review.html を質問ごとに写したもの）
// 使い方: node scripts/mockup-shots-v35.mjs [panel] [table] [spread] [undo] [draft] [review]（何も付けなければ全部。開発サーバーが http://localhost:5173 で動いていること）
//   panel ：① 右の欄（セルフチェック）の見せ方。はじめたばかり・書いている途中の2つの時点で、いま・案A・案B・案C。案Aのスマホの「チェック」の欄。使い方の「引用・参考文献」
//   table ：② 表の大きさを最初に選ぶ。パソコン（ます目で選ぶ）とスマホ（列・行の［−］［＋］）
//   spread：③ 見開き表示（パソコン 1366×768 と 1920×1080。別のボタンにする案も）
//   undo  ：④ 「元に戻す」「やり直す」の置き場所（パソコンの3案と、スマホの書く欄）
//   draft ：⑤ エラー0件のときの下書き PDF（窓の3案）と、下書きの透かし（3案）
//   review：一覧のページ（mockups/v35/review.html）を質問ごとに画像にする
//   Edge は EDGE_PORT（ふだんは 9721）で起動する
import { mkdirSync } from 'node:fs'

process.env.EDGE_PORT ??= '9721'
const { withEdge } = await import('./poc/edge.mjs')
const { stubConfig } = await import('./e2e/configStub.mjs')
const { setupWriting } = await import('./e2e/sampleReport.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const DIR = 'mockups/v35'
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })
const ONLY = process.argv.slice(2)
const want = (k) => ONLY.length === 0 || ONLY.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PC = { width: 1366, height: 768, deviceScaleFactor: 1.5 }
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

// ---- アイコン（src/app/icons.tsx・DriveUi.tsx と同じ線） ----
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const IC = {
  undo: svg('<path d="M9 7.5L5 11.5l4 4M5 11.5h9.5a4.5 4.5 0 010 9H12"/>'),
  /** やり直す（「元に戻す」の矢印を左右反対にしたもの） */
  redo: svg('<path d="M15 7.5l4 4-4 4M19 11.5H9.5a4.5 4.5 0 000 9H12"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  table: svg('<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M4 14.5h16M10 10v9M15 10v9"/>'),
  fit: svg('<rect x="6" y="3.5" width="12" height="17" rx="1.5"/>'),
  /** 見開き（紙が2枚並ぶ） */
  spread: svg('<rect x="2.8" y="4.5" width="8.6" height="15" rx="1.2"/><rect x="12.6" y="4.5" width="8.6" height="15" rx="1.2"/>'),
  zoom: svg('<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5L20 20M11 8.5v5M8.5 11h5"/>'),
  refs: svg('<path d="M6 4.5h12v15H6zM9 8.5h6M9 12h6M9 15.5h4"/>'),
  pdf: svg('<path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4M12 11v6M9.5 14.5L12 17l2.5-2.5"/>'),
  next: svg('<path d="M9.5 5l7 7-7 7"/>'),
  minus: svg('<path d="M6 12h12"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  /** ドライブに保存した（雲に ✓。DriveUi.tsx の cloud(true)） */
  cloud: '<svg class="drive-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18.5h10.5a4 4 0 0 0 .7-7.94A6 6 0 0 0 6.6 9.6 4.5 4.5 0 0 0 7 18.5z"/><path d="M9.4 13.7l2 2 3.6-3.7"/></svg>',
}
/** 説明用の矢印（マウスのカーソル） */
const CURSOR = '<path d="M3 2l15 8.2-6.6 1.6L8.6 18z" fill="#fff" stroke="#23262b" stroke-width="1.4" stroke-linejoin="round"/>'

/** 案の部品の見た目。色と書体は src/tokens.css・src/index.css のもの */
const CSS = `
  .v35-x { font-family: 'BIZ UDPGothic', sans-serif; box-sizing: border-box; }
  /* 見開きの複製のページの中には効かせない（組版エンジンの寸法が崩れる） */
  .v35-x *:not(.v35-spread *) { box-sizing: border-box; }
  .v35-fixed { position: fixed; z-index: 60; }
  [data-v35-hidden] { display: none !important; }
  .v35-cursor { width: 22px; height: 22px; z-index: 61; pointer-events: none; }
  /* 説明の吹き出し（マウスを乗せたときの名前） */
  .v35-tip { padding: 6px 10px; border-radius: 7px; background: #2b2e36; color: #fff; font-size: 12px; line-height: 1.5; white-space: nowrap; box-shadow: 0 6px 16px rgba(20, 20, 30, 0.25); }

  /* ===== ① どの案でも：右の欄の上半分を詰める ===== */
  .side.v35-compact .side-head { padding: 12px 16px 10px; }
  .side.v35-compact .brand-row { gap: 9px; }
  .side.v35-compact .mark { width: 28px; height: 28px; font-size: 14px; border-radius: 8px; }
  .side.v35-compact .brand-name { font-size: 14.5px; }
  .side.v35-compact .brand-row > div { display: flex; align-items: baseline; gap: 8px; }
  .side.v35-compact .brand-sub { margin: 0; font-size: 11px; }
  /* 保存のようすと締切を1行に（締切はチップにせず、右に寄せた字だけ） */
  .side.v35-compact .meta { flex-wrap: nowrap; align-items: center; margin-top: 9px; gap: 6px; }
  .side.v35-compact .meta .chip { padding: 3px 9px; font-size: 11.5px; white-space: nowrap; }
  .side.v35-compact .meta .chip.deadline { margin-left: auto; padding: 0; background: none; }
  .side.v35-compact .meta .chip.deadline b { font-size: 12.5px; }
  .side.v35-compact .links { margin-top: 8px; gap: 6px; }
  .side.v35-compact .link-btn { padding: 5px 0; font-size: 12px; }
  .side.v35-compact .link-btn svg { width: 15px; height: 15px; }
  .side.v35-compact .word-link { margin-top: 8px; font-size: 11px; color: var(--muted); }
  .side.v35-compact .word-link svg { width: 14px; height: 14px; }
  .side.v35-compact .notice { margin: 0 16px 10px; padding: 6px 10px; font-size: 11px; line-height: 1.5; }
  .side.v35-compact .notice b { font-size: 10.5px; }
  .side.v35-compact .sec { padding: 12px 16px 14px; }
  .side.v35-compact .side-foot { padding: 12px 16px 12px; }
  /* ドライブの保存のようす（ログインしているときの見た目。撮影は /?nodrive なので似せて描く） */
  .chip.v35-drive { color: var(--ink); background: #fff; box-shadow: inset 0 0 0 1px var(--line); }
  .chip.v35-drive .drive-ic { color: var(--ok); }
  .chip.v35-drive .caret { font-size: 9px; color: var(--muted); margin-left: -2px; }

  /* ===== ① 案A：「まだのところ」（進み具合）と「直すところ」を分ける ===== */
  .tally.v35-t2 { font-size: 11.5px; }
  .tally.v35-t2 b { font-size: 15px; }
  .tally.v35-t2 b.m { color: var(--ink); }
  .v35-sub { display: flex; justify-content: space-between; align-items: baseline; margin: 6px 0 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; color: var(--ink); }
  .v35-sub span { font-weight: 400; color: var(--muted); letter-spacing: 0; }
  .v35-sub.fix { margin-top: 14px; }
  .v35-prog { list-style: none; margin: 0; padding: 0 0 8px; border-bottom: 1px solid var(--line); }
  .v35-prog li { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; column-gap: 9px; align-items: center; padding: 5px 0; font-size: 12.5px; color: var(--ink); }
  .v35-prog li > i { width: 16px; height: 16px; border-radius: 50%; border: 1.5px solid #aeaaa3; display: grid; place-items: center; color: #fff; }
  .v35-prog li > i svg { width: 11px; height: 11px; stroke-width: 2.6; }
  .v35-prog li.done > i { border-color: var(--ok); background: var(--ok); }
  .v35-prog li.wait > i { border-style: dashed; border-color: #c4c0b9; }
  .v35-prog li.info > i { border: 0; }
  .v35-prog li.info > i::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: #c4c0b9; }
  .v35-prog .v { font-size: 12px; color: var(--muted); text-align: right; white-space: nowrap; }
  .v35-prog li.done .v { color: var(--ok); }
  .v35-prog li.todo .v b { color: var(--ink); font-size: 12.5px; }
  .v35-prog .bar { grid-column: 2 / 4; height: 4px; margin-top: 4px; border-radius: 2px; background: var(--chip-bg); overflow: hidden; }
  .v35-prog .bar i { display: block; height: 100%; border-radius: 2px; background: #9aa1b9; }
  .v35-none { margin: 6px 0 0; font-size: 12.5px; color: var(--ok); }
  .side-foot p.v35-foot, .sheet-body p.v35-foot { color: var(--ink); }
  .sheet-body p.v35-foot { margin: 8px 0 0; font-size: 13px; text-align: center; }
  /* スマホ：字を少し大きく */
  .sheet-body .v35-prog li { font-size: 14px; padding: 7px 0; }
  .sheet-body .v35-prog .v { font-size: 13px; }
  .sheet-body .v35-prog li.todo .v b { font-size: 14px; }
  .sheet-body .v35-sub { font-size: 12px; }
  .sheet-body .v35-none { font-size: 14px; }
  .sheet-head .tally.v35-t2 { font-size: 12px; }

  /* ===== ① 案B：いまのページの指摘を先に ===== */
  .v35-here { margin: 12px -8px 0; padding: 8px 8px 2px; border-radius: 10px; background: var(--accent-soft); }
  .v35-here .ig-h { color: var(--accent); }
  .v35-here .issue { border-bottom-color: rgba(47, 62, 117, 0.12); }
  .v35-here .issue:last-child { border-bottom: 0; }
  .v35-fold { display: flex; align-items: center; gap: 8px; width: 100%; margin: 10px 0 0; padding: 9px 10px; border: 1px solid var(--line); border-radius: 9px; background: #fff; text-align: left; color: var(--ink); font: inherit; }
  .v35-fold .l { flex: 1; min-width: 0; }
  .v35-fold .l b { display: block; font-size: 12px; letter-spacing: 0.06em; }
  .v35-fold .l small { display: block; margin-top: 2px; font-size: 12px; color: var(--muted); line-height: 1.5; }
  .v35-fold .chev { flex: none; font-size: 12px; color: var(--accent); }
  .v35-wait { display: flex; justify-content: space-between; margin: 8px 0 0; padding: 0 2px; font-size: 12px; color: var(--muted); }
  .v35-wait b { font-weight: 700; color: #4a4d54; letter-spacing: 0.06em; font-size: 11.5px; }
  .meter .row b.v35-gray { color: var(--muted); font-weight: 400; }

  /* ===== ① 案C：「次にやること」を1つだけ大きく ===== */
  .v35-next { margin: 2px 0 0; padding: 14px 14px 14px; border-radius: 12px; background: #fff; border: 1px solid var(--line); box-shadow: 0 2px 10px rgba(30, 25, 20, 0.06); }
  .v35-next .k { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; letter-spacing: 0.1em; color: var(--accent); }
  .v35-next .k .where { margin-left: auto; font-weight: 400; letter-spacing: 0; color: var(--muted); }
  .v35-next .t { display: flex; gap: 8px; align-items: flex-start; margin: 8px 0 0; font-size: 16px; font-weight: 700; line-height: 1.5; color: var(--ink); }
  .v35-next .t .dot { flex: none; margin-top: 4px; }
  .v35-next .d { margin: 4px 0 0; font-size: 12px; color: var(--muted); line-height: 1.6; }
  .v35-next .go2 { display: flex; align-items: center; justify-content: center; gap: 4px; width: 100%; margin-top: 12px; padding: 9px 0; border: 0; border-radius: 9px; background: var(--accent); color: #fff; font: inherit; font-size: 13px; font-weight: 700; letter-spacing: 0.04em; }
  .v35-next .go2 svg { width: 15px; height: 15px; stroke-width: 2; }
  .v35-next .dot { width: 18px; height: 18px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-size: 11px; font-weight: 700; font-style: normal; background: var(--error); }
  .v35-next .dot::before { content: '×'; }
  .v35-next .dot.todo { background: none; border: 1.5px solid #aeaaa3; }
  .v35-next .dot.todo::before { content: ''; }
  .v35-more { display: flex; justify-content: space-between; align-items: center; width: 100%; margin: 8px 0 12px; padding: 8px 4px; border: 0; border-bottom: 1px solid var(--line); background: none; font: inherit; font-size: 12.5px; color: var(--ink); text-align: left; }
  .v35-more span { color: var(--accent); font-size: 12px; }

  /* 使い方の項目の中のボタン（「引用・参考文献を入れる」） */
  .help-topic .v35-help-btn { display: inline-flex; align-items: center; gap: 6px; }
  .help-topic .v35-help-btn svg { width: 17px; height: 17px; }

  /* ===== ② 表の大きさ：パソコンは、ます目で選ぶ（いまの「どの表を入れますか」のメニューの中） ===== */
  .side-menu.v35-tmenu { min-width: 0; width: 186px; padding: 9px 10px 6px; }
  .v35-tmenu .side-menu-title { padding: 0 0 7px; font-size: 11px; }
  .v35-grid { display: grid; grid-template-columns: repeat(6, 19px); gap: 4px; width: max-content; margin: 0 auto; }
  .v35-grid i { width: 19px; height: 19px; border: 1px solid #d3cfc8; border-radius: 3px; background: #fff; }
  .v35-grid i.on { border-color: var(--accent); background: var(--accent-soft); }
  .v35-grid i.on.h { background: #c3cbe6; }
  .v35-gl { margin: 9px 0 2px; text-align: center; font-size: 13.5px; font-weight: 700; color: var(--accent); }
  .v35-gl small { display: block; margin-top: 2px; font-size: 11px; font-weight: 400; color: var(--muted); }
  .v35-tmenu .v35-sep { height: 1px; margin: 8px -4px 4px; background: var(--line); }
  .side-menu.v35-tmenu button { width: 100%; padding: 7px 6px; font-size: 12.5px; line-height: 1.45; }
  .side-menu.v35-tmenu button small { display: block; font-size: 11px; color: var(--muted); }

  /* ===== ② スマホ：書く欄の「表を入れる」から出る欄（列・行の［−］［＋］） ===== */
  .es-tools button.v35-on { background: var(--accent-soft); color: var(--accent); font-weight: 700; }
  .v35-tsheet .sheet-body { padding-bottom: 20px; }
  .v35-step { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); }
  .v35-step .l { flex: 1; font-size: 16px; font-weight: 700; }
  .v35-step .l small { display: block; margin-top: 1px; font-size: 12.5px; font-weight: 400; color: var(--muted); }
  .v35-step button { width: 46px; height: 46px; flex: none; border: 1px solid var(--line); border-radius: 12px; background: #fff; color: var(--accent); display: grid; place-items: center; }
  .v35-step button svg { width: 22px; height: 22px; stroke-width: 2; }
  .v35-step b { min-width: 34px; text-align: center; font-size: 24px; }
  .v35-prev { display: grid; gap: 3px; width: 168px; margin: 14px auto 2px; }
  .v35-prev i { height: 16px; border-radius: 2px; background: #fff; border: 1px solid #c9c6c0; }
  .v35-prev i.h { background: #d7ddef; border-color: #aab3d3; }
  .v35-prevnote { margin: 4px 0 0; text-align: center; font-size: 12.5px; color: var(--muted); }
  .v35-tsheet .export { margin-top: 14px; }
  .v35-mat { display: block; width: 100%; margin-top: 10px; padding: 12px 10px; border: 1px solid var(--line); border-radius: 10px; background: #fff; font: inherit; font-size: 14px; color: var(--ink); text-align: center; }
  .v35-mat small { display: block; margin-top: 2px; font-size: 12px; color: var(--muted); }

  /* ===== ③ 見開き：いまのページと次のページを並べる（本物のページを複製して並べる） ===== */
  .stage.v35-spr .page-scroller, .stage.v35-spr #overlay-layer { opacity: 0; }
  .stage.v35-spr .palette { left: 12px; top: 18px; }
  .stage.v35-spr .arrow.prev { left: 31px; top: auto; bottom: 20px; translate: none; }
  .stage.v35-spr .arrow.next { left: auto; right: 31px; top: auto; bottom: 68px; translate: none; }
  .v35-spread { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
  .v35-pg { position: absolute; overflow: hidden; background: #fff; box-shadow: 0 1px 2px rgba(30, 25, 20, 0.06), 0 8px 24px rgba(30, 25, 20, 0.1); }
  .v35-pg > .v35-pgc { display: block !important; position: absolute !important; left: 0 !important; top: 0 !important; margin: 0 !important; transform-origin: 0 0 !important; box-shadow: none !important; }
  /* 案B：「見開き」を、全体／拡大とは別の切り替えのボタンにする */
  .v35-sprt { position: absolute; z-index: 10; bottom: 16px; display: flex; padding: 3px; background: rgba(255, 255, 255, 0.88); border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--float-shadow); }
  .v35-sprt button { display: flex; align-items: center; gap: 6px; border: 0; background: none; border-radius: 7px; padding: 5px 10px 5px 8px; font: inherit; font-size: 12px; color: var(--muted); }
  .v35-sprt button.on { background: var(--accent-soft); color: var(--accent); font-weight: 700; }
  .v35-sprt .sw { position: relative; width: 26px; height: 15px; border-radius: 8px; background: #c9c6c0; }
  .v35-sprt .sw::after { content: ''; position: absolute; top: 2px; left: 2px; width: 11px; height: 11px; border-radius: 50%; background: #fff; }
  .v35-sprt button.on .sw { background: var(--accent); }
  .v35-sprt button.on .sw::after { left: 13px; }

  /* ===== ④ 「元に戻す」「やり直す」 ===== */
  /* 案A：左の道具のいちばん下に、2つ並べる */
  .palette .group.v35-ur { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-left: -4px; margin-right: -4px; }
  .palette .v35-ur .tb { padding: 8px 0 7px; font-size: 9.5px; letter-spacing: -0.06em; white-space: nowrap; }
  .palette .v35-ur .tb svg { width: 20px; height: 20px; }
  .tb.v35-hover { background: var(--palette-hover); color: var(--accent); }
  /* 案B：紙面の右下（全体／拡大の左） */
  .v35-urb { position: absolute; z-index: 10; bottom: 16px; display: flex; gap: 2px; padding: 3px; background: rgba(255, 255, 255, 0.88); border: 1px solid var(--line); border-radius: 10px; box-shadow: var(--float-shadow); }
  .v35-urb button { display: flex; align-items: center; gap: 4px; border: 0; background: none; border-radius: 7px; padding: 5px 10px 5px 7px; font: inherit; font-size: 12px; color: var(--ink); }
  .v35-urb button svg { width: 16px; height: 16px; }
  .v35-urb button.v35-hover { background: var(--palette-hover); color: var(--accent); }
  /* 案C：紙面の左上に、小さく（Word と同じ形。字は出さず、マウスを乗せると名前が出る） */
  .v35-urc { position: absolute; z-index: 10; top: 18px; display: flex; gap: 2px; padding: 3px; background: rgba(255, 255, 255, 0.96); border: 1px solid var(--palette-line); border-radius: 10px; box-shadow: var(--float-shadow); }
  .v35-urc button { width: 34px; height: 30px; display: grid; place-items: center; border: 0; background: none; border-radius: 7px; color: var(--palette-ink); }
  .v35-urc button svg { width: 19px; height: 19px; }
  .v35-urc button.v35-hover { background: var(--palette-hover); color: var(--accent); }
  .v35-tip::before { content: ''; position: absolute; top: -4px; left: var(--ax, 50%); width: 9px; height: 9px; margin-left: -4.5px; background: #2b2e36; transform: rotate(45deg); }
  .v35-tip.up::before { top: auto; bottom: -4px; }

  /* ===== ⑤ エラー0件のときの下書きの PDF ===== */
  .modal .v35-tabs { display: flex; margin: 0 0 14px; border-bottom: 1px solid var(--line); }
  .modal .v35-tabs button { margin-bottom: -1px; padding: 8px 16px 7px; border: 0; border-bottom: 2.5px solid transparent; border-radius: 0; background: none; font-size: 13.5px; color: var(--muted); }
  .modal .v35-tabs button.on { border-bottom-color: var(--accent); color: var(--accent); font-weight: 700; }
  .modal .draft-box.v35-x .pdf-draft { display: block; margin-top: 8px; }
  .modal .v35-links { display: flex; flex-direction: column; align-items: flex-start; gap: 9px; }
  .modal .v35-links button.link { font-size: 12.5px; }
  .modal .v35-links button.link.v35-strong { font-size: 13px; font-weight: 700; }
`

/** ページの中で使う道具（位置を測る・部品を足す・隠す・元に戻す） */
async function installKit(page) {
  await page.evaluate((css) => {
    const style = document.createElement('style')
    style.id = 'v35-style'
    style.textContent = css
    document.head.append(style)
    window.__v35 = {
      /** 部品を足す（body の直下） */
      add(html) {
        document.body.insertAdjacentHTML('beforeend', html)
        return document.body.lastElementChild
      },
      /** 本物の部品を隠して、すぐ後ろに案の部品を置く（あとで clear で元に戻す） */
      swap(el, html) {
        el.setAttribute('data-v35-hidden', '')
        el.insertAdjacentHTML('afterend', html)
        return el.nextElementSibling
      },
      /** 本物の部品を隠す */
      hide(el) {
        el?.setAttribute('data-v35-hidden', '')
      },
      /** 本物の部品のすぐ後ろ（before：前）に、案の部品を足す */
      after(el, html, before = false) {
        el.insertAdjacentHTML(before ? 'beforebegin' : 'afterend', html)
        return before ? el.previousElementSibling : el.nextElementSibling
      },
      /** 本物の部品に、案の見た目の印（class）を付ける（clear で外す） */
      mark(el, cls) {
        el.classList.add(cls)
        el.setAttribute('data-v35-cls', `${el.getAttribute('data-v35-cls') ?? ''} ${cls}`.trim())
      },
      /** 本物の部品の字を書き換える（clear で戻す） */
      text(el, text) {
        if (!el.hasAttribute('data-v35-text')) el.setAttribute('data-v35-text', el.innerHTML)
        el.innerHTML = text
      },
      /** 説明用の矢印（x, y は矢印の先） */
      cursor(x, y) {
        return this.add(`<svg class="v35-x v35-fixed v35-cursor" style="left:${x - 3}px;top:${y - 2}px" viewBox="0 0 24 24">${window.__v35CursorPath}</svg>`)
      },
      /** 案の部品を全部外し、隠した本物を戻す */
      clear() {
        document.querySelectorAll('.v35-x').forEach((e) => e.remove())
        document.querySelectorAll('[data-v35-hidden]').forEach((e) => e.removeAttribute('data-v35-hidden'))
        document.querySelectorAll('[data-v35-cls]').forEach((e) => {
          e.classList.remove(...e.getAttribute('data-v35-cls').split(' '))
          e.removeAttribute('data-v35-cls')
        })
        document.querySelectorAll('[data-v35-text]').forEach((e) => {
          e.innerHTML = e.getAttribute('data-v35-text')
          e.removeAttribute('data-v35-text')
        })
      },
    }
  }, CSS)
  await page.evaluate((p) => (window.__v35CursorPath = p), CURSOR)
}

const ready = (page) =>
  page.waitForFunction(() => {
    const s = window.__editor?.getSnapshot()
    return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading')
  }, { timeout: 120000 })

/** 学生用ツールを開く（はじめての案内は、コースを選び、Word は「いいえ」まで進める） */
async function openTool(browser, vp) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  // 本物の確かめの窓が出たら、必ず「キャンセル」
  page.on('dialog', (d) => d.dismiss())
  // 開発サーバーの即時反映をつながない（撮っている途中に src/ が直されても、画面が入れ替わらないように。scripts/e2e/smoke.mjs の noHotReload と同じ）。指差し確認は見たことにする
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
  await stubConfig(page)
  if (vp.isMobile) await page.setUserAgent(UA_IPHONE)
  await page.setViewport(vp)
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0', timeout: 90000 })
  await ready(page)
  await page.waitForSelector('.guide.step-course .g-opts button', { timeout: 60000 })
  await page.evaluate(() => [...document.querySelectorAll('.guide .g-opts button')].find((b) => b.textContent.includes('映画・舞台衣装')).click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no', { timeout: 60000 })
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.guide .g-later', { timeout: 60000 })
  return { context, page }
}

/** 案内を閉じて、書いていない状態にする */
async function closeGuide(page) {
  await page.evaluate(() => document.querySelector('.guide .g-later').click())
  await page.evaluate(() => window.__editor.finishEditing())
  await ready(page)
}

/**
 * はじめたばかりの原稿：コースを選び、Word は「いいえ」、学籍番号だけ入れて、氏名・サブタイトルは空のまま案内を終え、本文の最初のページへ
 * （案内の最後の「本文へ進む」と同じ。ログインして使うときは、学籍番号は自動で入る）
 */
async function openFresh(browser, vp) {
  const { context, page } = await openTool(browser, vp)
  await closeGuide(page)
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, studentId: '00ZZ0123' } })))
  await sleep(300)
  await ready(page)
  await page.evaluate(() => window.__editor.goToArea('body'))
  await sleep(600)
  await ready(page)
  await installKit(page)
  return { context, page }
}

/** 見本の原稿（指摘0件）を入れる */
async function openSample(browser, vp) {
  const { context, page } = await openTool(browser, vp)
  await closeGuide(page)
  await page.evaluate(setupWriting)
  await sleep(600)
  await ready(page)
  // 表紙の学籍番号も入れる（指摘が出ないように）
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, studentId: '00ZZ0123' } })))
  await sleep(300)
  await ready(page)
  await installKit(page)
  return { context, page }
}

/**
 * 書いている途中の原稿：見本の原稿から「まとめ」の章を外し（本文4ページ）、作品写真はまだ、抄録は先生の許可の前。
 * 「制作過程」の段落に、本物の書き間違いを3つ入れる（「です」・「私」・「先生」）
 */
async function openMid(browser, vp) {
  const { context, page } = await openSample(browser, vp)
  await page.evaluate(async () => {
    const ops = await import('/src/editor/reportOps.ts')
    window.__editor.update((r) => {
      let x = { ...r, body: r.body.slice(0, 2), abstract: { ...r.abstract, started: false }, workPhotos: { layout: 1, imageIds: [] } }
      x = ops.setText(x, 'p6', 'デザイン画をもとにパターンを引き、シーチングで仮縫いをした。一回目の仮縫いでは、袖の膨らみが大きすぎて、腕を上げたときに肩が引きつれたので、袖山を下げたのです。')
      x = ops.setText(x, 'p7', '二回目の仮縫いでは、私が実際に舞台の上で歩いたり腕を回したりして、動きやすさを確かめた。指導の田中先生にも見ていただいた。')
      return x
    })
  })
  await sleep(600)
  await ready(page)
  await showBlock(page, 'p6')
  return { context, page }
}

/** その段落・図があるページを出す */
async function showBlock(page, id) {
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), id)
  await ready(page)
  await sleep(300)
}

/** 確かめ：横にはみ出していないか・案の部品が画面の外に出ていないか・文字がボタンからはみ出していないか */
const audit = (page, name) =>
  page
    .evaluate(() => {
      const bad = []
      if (document.documentElement.scrollWidth > innerWidth + 1) bad.push(`横にはみ出している（${document.documentElement.scrollWidth}px）`)
      for (const el of document.querySelectorAll('.v35-x')) {
        const r = el.getBoundingClientRect()
        if (!r.width) continue
        if (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1 || r.top < -1) bad.push(`画面の外：${el.className}`)
      }
      for (const el of document.querySelectorAll('.link-btn, .modal button:not(.close), .tb, .zoom button, .es-tools button, .v35-x button:not(.close)')) {
        if (el.offsetWidth && el.scrollWidth > el.clientWidth + 1) bad.push(`文字がはみ出す：${el.textContent}`)
      }
      for (const el of document.querySelectorAll('.modal')) {
        if (el.offsetHeight && el.scrollHeight > el.clientHeight + 1) bad.push(`窓の中が上下に動く：${el.scrollHeight}/${el.clientHeight}`)
      }
      return bad
    })
    .then((bad) => bad.length && console.log(`  ！${name}：${bad.join(' ／ ')}`))

/** 撮る。clip：写す範囲（画面の座標。ページの中で求める関数か式の文字列でもよい。なければ画面全体） */
async function shot(page, name, clip) {
  await page.evaluate(() => document.fonts.ready)
  await sleep(300)
  await audit(page, name)
  const box = typeof clip === 'function' || typeof clip === 'string' ? await page.evaluate(clip) : clip
  // captureBeyondViewport: false：写すときに画面の大きさを変えない
  await page.screenshot({ path: `${OUT}/${name}.png`, captureBeyondViewport: false, ...(box ? { clip: box } : {}) })
  console.log('✓', name)
}

/** 写す範囲：右の欄（PC）の全体 */
const SIDE = () => {
  const r = document.querySelector('.side').getBoundingClientRect()
  return { x: r.left, y: 0, width: r.width, height: innerHeight }
}

/** 画面の外（何もない所）にマウスを置く（ボタンの上に乗ったままにしない） */
const parkMouse = (page) => page.mouse.move(5, 5)

// =====================================================================
// ① 右の欄（セルフチェック）の見せ方
// =====================================================================

/** 保存のようすを、ドライブに保存しているときの見た目にする（学生はふだんログインして使う。撮影は /?nodrive のため似せて描く） */
const driveChip = (page) =>
  page.evaluate((cloud) => {
    const k = window.__v35
    for (const chip of document.querySelectorAll('.meta .chip.saved')) {
      const time = chip.textContent.match(/\d{1,2}:\d{2}/)?.[0] ?? '11:38'
      k.swap(chip, `<span class="v35-x chip v35-drive" title="原稿は、この端末とあなたの Google ドライブに保存されます">${cloud}ドライブに保存 ${time}<span class="caret">▾</span></span>`)
    }
  }, IC.cloud)

/**
 * 右の欄を案ごとに書き換える（どの案でも、上半分を詰め、「引用・参考文献」を外し、抄録は許可の前なら灰色の「先生の許可のあと」）。
 * 指摘は本物（window.__editor の findings）を、「まだのところ」（まだ書いていないだけ）と「直すところ」（書いた文の間違い）に分けて使う。
 * where：'side'（PC の右の欄）・'sheet'（スマホの「チェック」の欄。案Aだけ）
 */
async function drawPanel(page, opt, where = 'side') {
  await page.evaluate(
    async ({ opt, where, IC }) => {
      const k = window.__v35
      const { AREA_LABELS, AREA_ORDER, pageLabels } = await import('/src/app/labels.ts')
      const ed = window.__editor
      const snap = ed.getSnapshot()
      const { report, layout, findings } = snap
      const config = window.__v35Config
      const labels = pageLabels(layout.kinds)
      const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      // ---- 指摘を分ける ----
      const NOT_YET = new Set(['required-field', 'body-pages', 'abstract-not-started', 'photos-required'])
      const notYet = (f) => NOT_YET.has(f.ruleId) || (f.ruleId === 'paragraph-empty' && f.title.startsWith('まだ書いていない'))
      const mistakes = findings.filter((f) => !notYet(f))
      const counted = findings.filter((f) => f.ruleId !== 'abstract-not-started')
      // ---- 本物と同じ形の指摘の一覧 ----
      const issue = (f, active = false) =>
        `<li class="issue ${f.severity}${active ? ' active here' : ''}"><i class="dot"></i><button type="button" class="go"><span class="ttl">${esc(f.title)}</span>${f.detail ? `<span class="detail">${esc(f.detail)}</span>` : ''}</button></li>`
      const legend = `<p class="sev-legend"><span><i class="dot"></i><span><b class="e">エラー</b>：直してから出す</span></span><span><i class="dot warning"></i><span><b class="w">要確認</b>：確かめて、必要なら直す</span></span></p>`
      const groups = (list, label = (a) => AREA_LABELS[a]) =>
        AREA_ORDER.map((area) => {
          const items = list.filter((f) => f.area === area)
          if (!items.length) return ''
          return `<div class="igroup"><div class="ig-h">${label(area)}<span>${items.length}件</span></div><ul class="issues">${items.map((f) => issue(f)).join('')}</ul></div>`
        }).join('')
      // ---- 本物のメーター（案B・案C で使う。抄録は、許可の前なら灰色） ----
      const bodyPages = layout.bodyPages
      const min = config.body.minPages
      const figures = report.body.flatMap((c) => c.blocks).reduce((n, b) => n + (b.type === 'figureRow' ? b.figures.length : 0), 0)
      const figureMax = Math.max(1, bodyPages * config.body.imagesPerPageGuide)
      const meter = (label, value, ok, ratio, gray = false) =>
        `<div class="meter"><div class="row"><span>${label}</span><b class="${gray ? 'v35-gray' : ok ? 'ok' : 'ng'}">${value}</b></div><div class="bar"><i class="${ok ? 'ok' : 'ng'}" style="width:${Math.max(2, Math.min(100, ratio * 100))}%"></i></div></div>`
      const meters = () =>
        `<div class="meters">${meter('本文のページ数', `${bodyPages} / ${min}ページ以上`, bodyPages >= min, bodyPages / min)}${report.abstract.started === false ? meter('抄録', '先生の許可のあと', true, 0, true) : ''}${meter('図の枚数', `${figures}枚（目安 ${figureMax}枚まで）`, figures <= figureMax, figures / figureMax)}</div>`

      // ---- どの案でも：上半分を詰め、「引用・参考文献」を外す（使い方から入れる） ----
      if (where === 'side') {
        const side = document.querySelector('.side')
        k.mark(side, 'v35-compact')
        k.hide(side.querySelector('.refs-link'))
        const notice = side.querySelector('.notice b')
        if (notice) k.text(notice, 'コースからのお知らせ')
      }
      const sec = where === 'side' ? document.querySelector('.side .sec.check') : document.querySelector('.sheet')
      const tally = sec.querySelector('.tally')
      const body = where === 'side' ? sec : sec.querySelector('.sheet-body')
      // CheckBody の中身（メーターと一覧）を隠す
      const realParts = where === 'side' ? [...sec.children].filter((e) => !e.matches('.sec-h')) : [...body.children].filter((e) => !e.matches('.export'))
      realParts.forEach((e) => k.hide(e))
      const anchor = where === 'side' ? sec.querySelector('.sec-h') : body.querySelector('.export')
      const put = (html) => (where === 'side' ? k.after(anchor, html) : k.after(anchor, html, true))
      const foot = where === 'side' ? document.querySelector('.side-foot p') : null

      if (opt === 'a') {
        // ---- 進み具合（まだ書いていないだけのもの。赤くしない） ----
        const empty = findings.filter((f) => f.ruleId === 'paragraph-empty' && f.title.startsWith('まだ書いていない')).length
        const b = report.basicInfo
        const missing = [!b.studentId.trim() && '学籍番号', !b.name.trim() && '氏名', !b.subtitleInput.trim() && 'サブタイトル'].filter(Boolean)
        const photos = report.workPhotos.imageIds.slice(0, report.workPhotos.layout).filter(Boolean).length
        const rows = [
          missing.length ? { s: 'todo', l: '表紙', v: `${missing.join('・')}がまだ` } : { s: 'done', l: '表紙', v: '入れました' },
          bodyPages >= min
            ? { s: 'done', l: '本文のページ', v: `${bodyPages} / ${min}ページ` }
            : { s: 'todo', l: '本文のページ', v: `${bodyPages} / ${min}ページ　あと<b>${min - bodyPages}</b>`, bar: bodyPages / min },
          empty ? { s: 'todo', l: '本文の段落', v: `書いていない段落 <b>${empty}</b>` } : { s: 'done', l: '本文の段落', v: 'すべて書きました' },
          photos ? { s: 'done', l: '作品写真', v: `${photos}枚` } : { s: 'todo', l: '作品写真', v: 'まだ' },
          report.abstract.started === false ? { s: 'wait', l: '抄録', v: '先生の許可のあと' } : { s: 'done', l: '抄録', v: '書いています' },
          { s: 'info', l: '図の枚数', v: `${figures}枚（目安 ${figureMax}枚まで）` },
        ]
        const todo = rows.filter((r) => r.s === 'todo').length
        const list = rows
          .map((r) => `<li class="${r.s}"><i>${r.s === 'done' ? IC.check : ''}</i><span class="l">${r.l}</span><span class="v">${r.v}</span>${r.bar !== undefined ? `<span class="bar"><i style="width:${Math.max(3, r.bar * 100)}%"></i></span>` : ''}</li>`)
          .join('')
        k.swap(tally, `<span class="v35-x tally v35-t2">直すところ <b class="${mistakes.length ? 'e' : 'm'}">${mistakes.length}</b>　まだ <b class="m">${todo}</b></span>`)
        const fix = mistakes.length ? `${legend}${groups(mistakes)}` : '<p class="v35-none">✓ いま直すところはありません</p>'
        put(`<div class="v35-x"><div class="v35-sub"><span style="font-weight:700;color:var(--ink);letter-spacing:0.08em">まだのところ</span><span>押すと、その場所へ</span></div><ul class="v35-prog">${list}</ul><div class="v35-sub fix"><span style="font-weight:700;color:var(--ink);letter-spacing:0.08em">直すところ</span><span>書いた文の間違い</span></div>${fix}</div>`)
        const note = [mistakes.length && `直すところが${mistakes.length}つ`, todo && `まだのところが${todo}つ`].filter(Boolean).join('、')
        const text = note ? `${note}あります` : '提出用のPDFを書き出せます'
        if (foot) k.swap(foot, `<p class="v35-x v35-foot">${text}</p>`)
        else k.after(body.querySelector('.export'), `<p class="v35-x v35-foot">${text}</p>`)
      }

      if (opt === 'b') {
        // ---- いま見ているページの指摘だけ開き、ほかのページは閉じておく ----
        const errors = counted.filter((f) => f.severity === 'error').length
        k.swap(tally, `<span class="v35-x tally"><b class="e">${errors}</b> エラー　<b class="w">${counted.length - errors}</b> 要確認</span>`)
        const here = counted.filter((f) => ed.pageOfFinding(f) === snap.page)
        const others = counted.filter((f) => ed.pageOfFinding(f) !== snap.page)
        const summary = AREA_ORDER.map((a) => {
          const n = others.filter((f) => f.area === a).length
          return n ? `${AREA_LABELS[a]} ${n}件` : ''
        })
          .filter(Boolean)
          .join('・')
        const hereHtml = here.length
          ? `<div class="v35-here"><div class="ig-h">このページ（${labels[snap.page]}）<span>${here.length}件</span></div><ul class="issues">${here.map((f) => issue(f)).join('')}</ul></div>`
          : `<div class="v35-here"><div class="ig-h">このページ（${labels[snap.page]}）<span>0件</span></div><p class="v35-none" style="margin:6px 0 8px">✓ このページに指摘はありません</p></div>`
        // 抄録（許可の前）は、上のメーターに灰色で出す。エラーと要確認の意味（凡例）は、使い方の「セルフチェック」に任せて、ここでは出さない（このページの指摘とほかのページが、ノートパソコンの画面に入るように）
        put(`<div class="v35-x">${meters()}${hereHtml}${others.length ? `<button class="v35-fold"><span class="l"><b>ほかのページ　${others.length}件</b><small>${summary}</small></span><span class="chev">開く ▸</span></button>` : ''}</div>`)
        if (foot) k.swap(foot, `<p class="v35-x">${errors ? `エラーが${errors}件あります。0にしてから書き出しましょう` : '提出用のPDFを書き出せます'}</p>`)
      }

      if (opt === 'c') {
        // ---- 次にやることを1つだけ。直すところ（エラー→要確認）を先に、そのあと、まだのところをページの順に ----
        const order = (f) => (notYet(f) ? 2 : f.severity === 'error' ? 0 : 1)
        const list = [...counted].sort((a, b) => order(a) - order(b) || ed.pageOfFinding(a) - ed.pageOfFinding(b))
        const first = list[0]
        const ACTION = {
          'required-field': (f) => (f.title.includes('氏名') ? '表紙の氏名を入れる' : f.title.includes('サブタイトル') ? '表紙のサブタイトルを入れる' : '表紙の学籍番号を入れる'),
          'body-pages': () => `本文をあと${min - bodyPages}ページ書く`,
          'paragraph-empty': () => 'まだ書いていない段落を書く',
          'photos-required': () => '作品写真を入れる',
        }
        k.swap(tally, `<span class="v35-x tally">全部で ${counted.length}件</span>`)
        const card = first
          ? `<div class="v35-next"><div class="k">次にやること<span class="where">${labels[ed.pageOfFinding(first)] ?? ''}</span></div><div class="t"><i class="dot${notYet(first) ? ' todo' : ''}"></i><span>${esc(ACTION[first.ruleId]?.(first) ?? first.title)}</span></div>${!notYet(first) && first.detail ? `<p class="d">${esc(first.detail)}</p>` : notYet(first) && first.detail && first.ruleId === 'paragraph-empty' ? `<p class="d">${esc(first.detail)}</p>` : ''}<button class="go2">そこへ移る${IC.next}</button></div>`
          : '<p class="v35-none">✓ 指摘はありません。PDFを書き出せます。</p>'
        const more = list.length > 1 ? `<button class="v35-more">ほかに ${list.length - 1}件<span>一覧を開く ▸</span></button>` : ''
        put(`<div class="v35-x">${card}${more}${meters()}</div>`)
        const errors = counted.filter((f) => f.severity === 'error').length
        if (foot) k.swap(foot, `<p class="v35-x">${errors ? `エラーが${errors}件あります。0にしてから書き出しましょう` : '提出用のPDFを書き出せます'}</p>`)
      }
    },
    { opt, where, IC },
  )
}

/** 学科の設定（本文のページ数・図の目安）を、ページの中で使えるようにする */
async function loadConfig(page) {
  await page.evaluate(async () => {
    const res = await fetch('/scripts/e2e/config-fixture.json')
    window.__v35Config = await res.json()
  })
}

/** 右の欄の、いま・案A・案B・案C を撮る（tag：1＝はじめたばかり、2＝書いている途中） */
async function panelSet(page, tag) {
  await loadConfig(page)
  await page.evaluate(() => window.__editor.finishEditing())
  await ready(page)
  await driveChip(page)
  await parkMouse(page)
  await shot(page, `panel-now-${tag}`, SIDE)
  await shot(page, `panel-now-${tag}-full`)
  for (const opt of ['a', 'b', 'c']) {
    await drawPanel(page, opt)
    await page.evaluate(() => document.querySelector('.side .sec.check').scrollTo(0, 0))
    await shot(page, `panel-${opt}-${tag}`, SIDE)
    if (opt === 'a') await shot(page, `panel-a-${tag}-full`)
    await page.evaluate(() => window.__v35.clear())
    await driveChip(page)
  }
}

async function panelShots(browser) {
  // ---- はじめたばかり（表紙の案内を終えて、本文の最初のページ） ----
  {
    const { context, page } = await openFresh(browser, PC)
    await panelSet(page, 1)
    // 使い方の「引用・参考文献」に、入れるボタンを足したところ（右の欄から外す代わり）
    await page.evaluate(() => window.__v35.clear())
    await page.evaluate(() => document.querySelector('.side .help-btn').click())
    await page.waitForSelector('.help-list button[data-topic="references"]', { timeout: 30000 })
    await page.evaluate(() => document.querySelector('.help-list button[data-topic="references"]').click())
    await page.waitForSelector('.help-topic', { timeout: 30000 })
    await page.evaluate(() => document.activeElement?.blur())
    await page.evaluate((icon) => {
      const k = window.__v35
      const t = document.querySelector('.help-topic')
      k.text(t.querySelector('.help-lead'), '使うときだけ、下のボタンから入れます。')
      k.after(t.querySelector('.help-steps'), `<button class="v35-x help-action v35-help-btn">${icon}引用・参考文献を入れる</button>`)
    }, IC.refs)
    await parkMouse(page)
    await shot(page, 'panel-help-refs', SIDE)
    await context.close()
  }
  // ---- 書いている途中（本文4ページ、作品写真はまだ、抄録は許可の前。書き間違いが3つ） ----
  {
    const { context, page } = await openMid(browser, PC)
    await panelSet(page, 2)
    await context.close()
  }
  // ---- スマホの「チェック」の欄（案Aだけ） ----
  for (const [tag, opener] of [
    [1, openFresh],
    [2, openMid],
  ]) {
    const { context, page } = await opener(browser, PHONE)
    await loadConfig(page)
    await page.evaluate(() => window.__editor.finishEditing())
    await ready(page)
    await page.evaluate(() => document.querySelector('.nav-check').click())
    await page.waitForSelector('.sheet .sheet-body', { timeout: 30000 })
    await page.evaluate(() => document.activeElement?.blur())
    await sleep(500)
    await shot(page, `ph-panel-now-${tag}`)
    await drawPanel(page, 'a', 'sheet')
    await sleep(200)
    await shot(page, `ph-panel-a-${tag}`)
    await context.close()
  }
}

// =====================================================================
// ② 表の大きさを最初に選ぶ（パソコン：ます目、スマホ：列・行の［−］［＋］）
// =====================================================================

/** 写す範囲：左の道具と、その右に開くメニュー・紙面の左の部分 */
const PALETTE_AREA = () => {
  const p = document.querySelector('.palette').getBoundingClientRect()
  const x = Math.max(0, p.left - 18)
  return { x, y: 0, width: Math.min(innerWidth - x, 600), height: innerHeight }
}

async function tableShots(browser) {
  // ---- パソコン ----
  {
    const { context, page } = await openSample(browser, PC)
    await showBlock(page, 'p9')
    // 「袖の刺繍」の段落の1文目の終わりにカーソル（ここに「（表n）」が入る）
    await page.evaluate(() => window.__editor.openEditor('p9', 27))
    await sleep(500)
    const openMenu = () => page.evaluate(() => [...document.querySelectorAll('.palette .tb')].find((b) => b.textContent.includes('表を入れる')).click())
    await openMenu()
    await page.waitForSelector('.side-menu', { timeout: 10000 })
    await parkMouse(page)
    await shot(page, 'table-pc-now', PALETTE_AREA)
    // 案：メニューの中に、ます目（6列×10行まで）。3列×4行に乗せたところ
    await page.evaluate(() => {
      const k = window.__v35
      const menu = document.querySelector('.side-menu')
      const cells = []
      for (let r = 0; r < 10; r++) for (let c = 0; c < 6; c++) cells.push(`<i class="${c < 3 && r < 4 ? `on${r === 0 ? ' h' : ''}` : ''}"></i>`)
      const m = k.swap(
        menu,
        `<div class="v35-x side-menu v35-tmenu"><div class="side-menu-title">表の大きさを選ぶ</div><div class="v35-grid">${cells.join('')}</div><div class="v35-gl">3列×4行<small>1行目は見出し</small></div><div class="v35-sep"></div><button>素材表<small>名称・使用箇所・生地見本</small></button></div>`,
      )
      const cell = m.querySelectorAll('.v35-grid i')[3 * 6 + 2].getBoundingClientRect()
      k.cursor(cell.left + cell.width * 0.55, cell.top + cell.height * 0.5)
    })
    await shot(page, 'table-pc-grid', PALETTE_AREA)
    await page.evaluate(() => window.__v35.clear())
    await openMenu()
    // 押したあと：3列×4行（1行目は見出し）の表が入る（本物の表。いまの「行を足す」「列を足す」で同じ形にしたもの）
    await page.evaluate(async () => {
      const ed = window.__editor
      ed.addTable('blank')
      await new Promise((r) => setTimeout(r, 600))
      const id = ed.tableIdOf(ed.getSnapshot().editingId)
      ed.addTableColumn(id)
      await new Promise((r) => setTimeout(r, 400))
      ed.addTableRow(id)
      await new Promise((r) => setTimeout(r, 400))
      ed.addTableRow(id)
      await new Promise((r) => setTimeout(r, 400))
      ed.finishEditing()
    })
    await sleep(800)
    await ready(page)
    await parkMouse(page)
    await shot(page, 'table-pc-after', () => {
      const cur = window.__editor.pageElements()[window.__editor.getSnapshot().page].getBoundingClientRect()
      return { x: cur.left - 8, y: Math.max(0, cur.top + cur.height * 0.45), width: cur.width + 16, height: cur.height * 0.47 }
    })
    await context.close()
  }
  // ---- スマホ ----
  {
    const { context, page } = await openSample(browser, PHONE)
    await showBlock(page, 'p9')
    await page.evaluate(() => window.__editor.openEditor('p9', 27))
    await sleep(800)
    await shot(page, 'table-ph-now')
    // 案：書く欄の道具は「図を入れる」「表を入れる」（素材表は、表を入れるの欄の中へ）。「表を入れる」を押すと、下から小さな欄
    await page.evaluate(() => {
      const k = window.__v35
      const tools = [...document.querySelectorAll('.es-tools button')]
      k.hide(tools.find((b) => b.textContent.includes('素材表')))
    })
    await shot(page, 'table-ph-tools')
    await page.evaluate(() => {
      const tools = [...document.querySelectorAll('.es-tools button')]
      window.__v35.mark(tools.find((b) => b.textContent.includes('表を入れる')), 'v35-on')
    })
    await page.evaluate(
      ({ IC }) => {
        const k = window.__v35
        const cols = 3
        const rows = 4
        const prev = Array.from({ length: rows * cols }, (_, i) => `<i class="${i < cols ? 'h' : ''}"></i>`).join('')
        k.add(
          `<div class="v35-x scrim"></div><section class="v35-x sheet v35-tsheet" role="dialog"><div class="grab"></div><header class="sheet-head"><h2>表を入れる</h2><button class="sheet-close close">×</button></header><div class="sheet-body">` +
            `<div class="v35-step"><span class="l">列<small>横に並ぶ数</small></span><button>${IC.minus}</button><b>${cols}</b><button>${IC.plus}</button></div>` +
            `<div class="v35-step"><span class="l">行<small>縦に並ぶ数（1行目は見出し）</small></span><button>${IC.minus}</button><b>${rows}</b><button>${IC.plus}</button></div>` +
            `<div class="v35-prev" style="grid-template-columns:repeat(${cols},1fr)">${prev}</div><p class="v35-prevnote">${cols}列×${rows}行（色の付いた行が見出し）</p>` +
            `<button class="export">${IC.table}入れる</button>` +
            `<button class="v35-mat">素材表を入れる<small>名称・使用箇所・生地見本の3列</small></button>` +
            `</div></section>`,
        )
      },
      { IC },
    )
    await sleep(300)
    await shot(page, 'table-ph-sheet')
    await context.close()
  }
}

// =====================================================================
// ③ 見開き表示（いまのページと次のページを並べる。1–2、3–4…と2ページずつめくる）
// =====================================================================

/**
 * 紙面を見開きにする（本物のページを複製して並べる。src/app/SidePanel.tsx のページ一覧の複製と同じやり方）。
 * variant：'a'（右下の切り替えを「全体／見開き／拡大」の3つにする）・'b'（「見開き」を別の切り替えのボタンにする）
 */
async function drawSpread(page, variant) {
  await page.evaluate(
    ({ variant, IC }) => {
      const k = window.__v35
      const ed = window.__editor
      const snap = ed.getSnapshot()
      const stage = document.querySelector('.stage')
      const W = stage.clientWidth
      const pages = ed.pageElements()
      const first = snap.page - (snap.page % 2)
      const pair = [pages[first], pages[first + 1]].filter(Boolean)
      // 親から受け継ぐ文字の設定（SidePanel.tsx の INHERITED・ENGINE_VARS と同じ）
      const INHERITED = ['font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'font-feature-settings', 'font-kerning', 'line-height', 'letter-spacing', 'word-spacing', 'white-space', 'text-align', 'text-align-last', 'text-indent', 'text-transform', 'color', 'word-break', 'line-break', 'overflow-wrap', 'hyphens', 'writing-mode', 'direction', 'text-orientation', '--viv-layoutUnitAdj', '--viv-outputScale']
      const copy = (from, to) => {
        const cs = getComputedStyle(from)
        for (const n of INHERITED) {
          const v = cs.getPropertyValue(n)
          if (v) to.style.setProperty(n, v)
        }
      }
      // 大きさ：左は道具（拡大のときと同じく台の左端）、右は少し空ける。上は今と同じ 18px
      const PW = 793.701
      const PH = 1122.52
      const GAP = 14
      const left = 110
      const right = 24
      const s = Math.min((W - left - right - GAP) / 2 / PW, (stage.clientHeight - 18 - 72) / PH)
      const w = PW * s
      const x0 = left + (W - left - right - (w * 2 + GAP)) / 2
      k.mark(stage, 'v35-spr')
      const wrap = document.createElement('div')
      wrap.className = 'v35-x v35-spread'
      pair.forEach((p, i) => {
        // 中の ID は外さない（組版エンジンの文字の大きさ・行の幅は、ID に結び付いた設定で決まるため。撮るだけの複製なので、ID が2つになってもよい）
        const clone = p.cloneNode(true)
        copy(p, clone)
        clone.className = 'v35-pgc'
        clone.style.setProperty('transform', `scale(${s})`, 'important')
        const box = document.createElement('div')
        box.className = 'v35-pg'
        box.style.cssText = `left:${x0 + i * (w + GAP)}px;top:18px;width:${w}px;height:${PH * s}px`
        box.append(clone)
        wrap.append(box)
      })
      stage.append(wrap)
      // ページの一覧：2ページとも選んでいる印にし、番号は「5–6 / 9」
      document.querySelectorAll('.thumb-list .t').forEach((t, i) => {
        if (i === first || i === first + 1) k.mark(t, 'on')
      })
      const pc = document.querySelector('.thumbs-col .pcount')
      if (pc) k.text(pc, `<b>${first + 1}–${first + 2}</b> / ${snap.pageCount}`)
      // 右下の切り替え
      const zoom = stage.querySelector('.zoom')
      if (variant === 'a') {
        k.swap(zoom, `<div class="v35-x zoom" role="group"><button>${IC.fit}全体</button><button class="on">${IC.spread}見開き</button><button>${IC.zoom}拡大</button></div>`)
      } else {
        const z = zoom.getBoundingClientRect()
        const sr = stage.getBoundingClientRect()
        k.add(`<div class="v35-x v35-sprt" style="position:fixed;right:${innerWidth - z.left + 8}px;bottom:${innerHeight - z.bottom}px"><button class="on"><span class="sw"></span>見開き</button></div>`)
        void sr
      }
    },
    { variant, IC },
  )
}

async function spreadShots(browser) {
  for (const [vp, tag] of [
    [PC, '1366'],
    [{ width: 1920, height: 1080, deviceScaleFactor: 1 }, '1920'],
  ]) {
    const { context, page } = await openSample(browser, vp)
    // 本文2・本文3（5–6ページ目）を出す
    await page.evaluate(() => window.__editor.goToPage(4, 'none'))
    await ready(page)
    await sleep(600)
    await parkMouse(page)
    await shot(page, `spread-now-${tag}`)
    await drawSpread(page, 'a')
    await sleep(400)
    await shot(page, `spread-a-${tag}`)
    if (tag === '1366') {
      await page.evaluate(() => window.__v35.clear())
      await drawSpread(page, 'b')
      await sleep(400)
      await shot(page, 'spread-b-1366', () => {
        const r = document.querySelector('.stage').getBoundingClientRect()
        return { x: r.right - 430, y: innerHeight - 120, width: 430, height: 120 }
      })
      await page.evaluate(() => window.__v35.clear())
      await drawSpread(page, 'a')
    }
    // 画面で実際に見える文字の大きさ（拡大・縮小しない写し）。右のページ（本文3）の上の、文の部分
    const TEXT = (r) => ({ x: Math.round(r.left + r.width * 0.14), y: Math.round(r.top + r.height * 0.08), width: Math.round(r.width * 0.77), height: Math.round(r.height * 0.18) })
    if (vp.deviceScaleFactor !== 1) await page.setViewport({ ...vp, deviceScaleFactor: 1 })
    await sleep(800)
    await shot(page, `spread-real-${tag}`, `(${TEXT})(document.querySelectorAll('.v35-pg')[1].getBoundingClientRect())`)
    // いま（1ページずつ）の文字の大きさも、同じ所を同じ形で
    await page.evaluate(() => window.__v35.clear())
    await page.evaluate(() => window.__editor.goToPage(5, 'none'))
    await ready(page)
    await sleep(600)
    await shot(page, `spread-real-now-${tag}`, `(${TEXT})(window.__editor.pageElements()[5].getBoundingClientRect())`)
    await context.close()
  }
}

// =====================================================================
// ④ 「元に戻す」「やり直す」の置き場所
// =====================================================================

/** 写す範囲：画面の左の部分（左の道具） */
const LEFT_AREA = () => ({ x: 120, y: 0, width: 520, height: innerHeight })
/** 写す範囲：画面の右下（紙面の下の切り替え） */
const BR_AREA = () => {
  const r = document.querySelector('.stage').getBoundingClientRect()
  return { x: r.right - 520, y: innerHeight - 240, width: 520, height: 240 }
}

async function undoShots(browser) {
  // ---- パソコン ----
  {
    const { context, page } = await openSample(browser, PC)
    await showBlock(page, 'p9')
    await page.evaluate(() => window.__editor.openEditor('p9', 27))
    await sleep(500)
    await parkMouse(page)
    await shot(page, 'undo-pc-now', LEFT_AREA)
    await shot(page, 'undo-pc-now-full')
    // 案A：左の道具のいちばん下に「戻す」「やり直す」を並べる
    await page.evaluate(
      ({ IC }) => {
        const k = window.__v35
        const groups = [...document.querySelectorAll('.palette > .group')]
        const g = groups[groups.length - 1]
        const ur = k.swap(g, `<div class="v35-x group v35-ur"><button class="tb" title="元に戻す（Ctrl+Z）">${IC.undo}<span>元に戻す</span></button><button class="tb v35-hover" title="やり直す（Ctrl+Y）">${IC.redo}<span>やり直す</span></button></div>`)
        const b = ur.querySelector('.v35-hover').getBoundingClientRect()
        const tip = k.add('<div class="v35-x v35-fixed v35-tip">やり直す（Ctrl+Y）<br>Mac は ⌘+Shift+Z</div>')
        tip.style.left = `${b.right + 10}px`
        tip.style.top = `${b.top + b.height / 2 - tip.offsetHeight / 2}px`
        tip.style.setProperty('--ax', '0px')
        k.cursor(b.left + b.width * 0.78, b.top + b.height * 0.3)
      },
      { IC },
    )
    await shot(page, 'undo-pc-a')
    await shot(page, 'undo-pc-a-zoom', LEFT_AREA)
    await page.evaluate(() => window.__v35.clear())
    // 案B：紙面の右下、「全体／拡大」の左に
    await page.evaluate(
      ({ IC }) => {
        const k = window.__v35
        const groups = [...document.querySelectorAll('.palette > .group')]
        k.hide(groups[groups.length - 1])
        const stage = document.querySelector('.stage')
        const z = stage.querySelector('.zoom')
        const zr = z.getBoundingClientRect()
        const sr = stage.getBoundingClientRect()
        const g = k.after(z, `<div class="v35-x v35-urb" style="right:${sr.right - zr.left + 8}px"><button title="元に戻す（Ctrl+Z）">${IC.undo}元に戻す</button><button class="v35-hover" title="やり直す（Ctrl+Y）">${IC.redo}やり直す</button></div>`)
        const b = g.querySelector('.v35-hover').getBoundingClientRect()
        const tip = k.add('<div class="v35-x v35-fixed v35-tip up">やり直す（Ctrl+Y・Mac は ⌘+Shift+Z）</div>')
        tip.style.left = `${Math.min(innerWidth - tip.offsetWidth - 8, b.left + b.width / 2 - tip.offsetWidth / 2)}px`
        tip.style.top = `${b.top - tip.offsetHeight - 10}px`
        tip.style.setProperty('--ax', `${b.left + b.width / 2 - parseFloat(tip.style.left)}px`)
        k.cursor(b.right - 8, b.bottom - 6)
      },
      { IC },
    )
    await shot(page, 'undo-pc-b')
    await shot(page, 'undo-pc-b-zoom', BR_AREA)
    await page.evaluate(() => window.__v35.clear())
    // 案C：紙面の左上に小さく（字は出さない。マウスを乗せると名前が出る）
    await page.evaluate(
      ({ IC }) => {
        const k = window.__v35
        const groups = [...document.querySelectorAll('.palette > .group')]
        k.hide(groups[groups.length - 1])
        const stage = document.querySelector('.stage')
        const pal = document.querySelector('.palette')
        const g = k.after(pal, `<div class="v35-x v35-urc" style="left:14px"><button title="元に戻す（Ctrl+Z）">${IC.undo}</button><button class="v35-hover" title="やり直す（Ctrl+Y）">${IC.redo}</button></div>`)
        void stage
        const b = g.querySelector('.v35-hover').getBoundingClientRect()
        const tip = k.add('<div class="v35-x v35-fixed v35-tip">やり直す（Ctrl+Y）<br>Mac は ⌘+Shift+Z</div>')
        tip.style.left = `${b.left - 10}px`
        tip.style.top = `${b.bottom + 10}px`
        tip.style.setProperty('--ax', `${b.width / 2 + 10}px`)
        k.cursor(b.right - 6, b.bottom - 5)
      },
      { IC },
    )
    await shot(page, 'undo-pc-c')
    await shot(page, 'undo-pc-c-zoom', LEFT_AREA)
    await page.evaluate(() => window.__v35.clear())
    await context.close()
  }
  // ---- スマホ：書く欄の「戻す」の横に「やり直す」 ----
  {
    const { context, page } = await openSample(browser, PHONE)
    await showBlock(page, 'p9')
    await page.evaluate(() => window.__editor.openEditor('p9', 27))
    await sleep(800)
    await shot(page, 'undo-ph-now')
    await page.evaluate(
      ({ IC }) => {
        const k = window.__v35
        const back = [...document.querySelectorAll('.es-tools button')].find((b) => b.textContent.includes('戻す'))
        k.after(back, `<button class="v35-x">${IC.redo}やり直す</button>`)
      },
      { IC },
    )
    await sleep(200)
    await shot(page, 'undo-ph-a')
    await context.close()
  }
}

// =====================================================================
// ⑤ エラー0件のときの下書きの PDF ／ 下書きの透かし
// =====================================================================

/** 写す範囲：窓のまわり */
const MODAL = () => {
  const r = document.querySelector('.modal').getBoundingClientRect()
  const left = Math.max(0, r.left - 24)
  const top = Math.max(0, r.top - 14)
  const right = Math.min(innerWidth, r.right + 24)
  const bottom = Math.min(innerHeight, r.bottom + 14)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** 「PDFを書き出す」を押して、提出用の窓（エラー0件）を開く */
async function openExport(page) {
  await page.evaluate(() => document.querySelector('.side .export').click())
  await page.waitForFunction(() => document.querySelector('.modal h2')?.textContent.includes('提出用'), { timeout: 60000 })
  await page.evaluate(() => document.activeElement?.blur())
  await sleep(400)
}

async function draftShots(browser) {
  // ---- 窓 ----
  {
    const { context, page } = await openSample(browser, PC)
    await openExport(page)
    await parkMouse(page)
    await shot(page, 'draft-now', MODAL)
    // 案A：チェックの下に、エラーがあるときと同じ「下書き」の欄
    await page.evaluate(() => {
      const k = window.__v35
      const m = document.querySelector('.modal')
      k.after(
        m.querySelector('.row-buttons'),
        '<div class="v35-x draft-box"><b>先生に途中経過を見せるとき</b>どのページにも「下書き」の透かしが入った PDF を保存できます（提出には使えません。上の3つのチェックは要りません）。<button class="pdf-draft">下書きの PDF を保存する</button></div>',
        true,
      )
    })
    await shot(page, 'draft-a', MODAL)
    await page.evaluate(() => window.__v35.clear())
    // 案B：窓の上に「提出用｜下書き（先生に見せる）」のタブ
    const tabs = (on) =>
      page.evaluate((on) => {
        const k = window.__v35
        const m = document.querySelector('.modal')
        k.text(m.querySelector('header h2'), 'PDFを書き出す')
        k.after(m.querySelector('header'), `<div class="v35-x v35-tabs" role="tablist"><button class="${on === 0 ? 'on' : ''}">提出用</button><button class="${on === 1 ? 'on' : ''}">下書き（先生に見せる）</button></div>`)
      }, on)
    await tabs(0)
    await shot(page, 'draft-b-1', MODAL)
    await page.evaluate(() => window.__v35.clear())
    await tabs(1)
    await page.evaluate((pdfIcon) => {
      const k = window.__v35
      const m = document.querySelector('.modal')
      const name = m.querySelector('.pdf-file .fn').textContent.replace(/\.pdf$/, '_下書き.pdf')
      for (const el of m.querySelectorAll(':scope > :not(header):not(.v35-tabs)')) k.hide(el)
      m.insertAdjacentHTML(
        'beforeend',
        `<div class="v35-x"><p class="lead">途中まででも保存できます。どのページにも「下書き」の透かしが入ります（提出には使えません）。</p><div class="pdf-file draft">${pdfIcon}<div><b class="fn">${name}</b><small>「ダウンロード」のフォルダに保存します</small></div></div><div class="row-buttons"><span class="spacer"></span><button>やめる</button><button class="primary">下書きの PDF を保存する</button></div></div>`,
      )
    }, IC.pdf)
    await shot(page, 'draft-b-2', MODAL)
    await page.evaluate(() => window.__v35.clear())
    // 案C：窓の左下に、小さな字のボタン
    await page.evaluate(() => {
      const k = window.__v35
      const m = document.querySelector('.modal')
      const fallback = m.querySelector('.row-buttons .pdf-fallback')
      k.swap(fallback, '<div class="v35-x v35-links"><button class="link v35-strong">下書きの PDF を保存する（先生に見せるとき）</button><button class="link">うまくいかないとき：印刷の画面から保存</button></div>')
    })
    await shot(page, 'draft-c', MODAL)
    await page.evaluate(() => window.__v35.clear())
    await context.close()
  }
  // ---- 透かし（本物の本文のページに、PDF と同じ透かしを重ねる。赤い線と字は、先生の赤ペンの例） ----
  {
    const { context, page } = await openSample(browser, { width: 1366, height: 900, deviceScaleFactor: 2 })
    await page.evaluate(() => window.__editor.goToPage(3, 'none'))
    await ready(page)
    await sleep(600)
    await parkMouse(page)
    for (const v of ['a', 'b', 'c']) {
      await page.evaluate((v) => {
        const k = window.__v35
        const ed = window.__editor
        const pageEl = ed.pageElements()[ed.getSnapshot().page]
        if (getComputedStyle(pageEl).position === 'static') pageEl.style.position = 'relative'
        // 透かし（src/pdf/pagesToPdf.ts の watermark と同じ形。色だけ案ごとに変える）
        const color = v === 'a' ? 'rgba(181,68,59,0.14)' : 'rgba(40,40,40,0.10)'
        pageEl.insertAdjacentHTML(
          'beforeend',
          `<div class="v35-x" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-32deg);font-family:'BIZ UDPGothic',sans-serif;font-weight:700;font-size:96pt;line-height:normal;letter-spacing:0.3em;color:${color};white-space:nowrap;pointer-events:none;z-index:10">下書き</div>`,
        )
        // 案C：ページの下に、書き出した日時
        if (v === 'c')
          pageEl.insertAdjacentHTML(
            'beforeend',
            `<div class="v35-x" style="position:absolute;right:94px;bottom:18px;font-family:'BIZ UDPGothic',sans-serif;font-size:8.5pt;letter-spacing:0.04em;color:rgba(40,40,40,0.55);z-index:10">下書き（提出用ではありません）　書き出し 2026/10/19 11:30</div>`,
          )
        // 先生の赤ペンの例（丸で囲む・線を引く・ひとこと）。紙面の文字の位置に合わせる
        const pr = pageEl.getBoundingClientRect()
        const s = pr.width / 793.701
        const find = (text) => {
          const walker = document.createTreeWalker(pageEl, NodeFilter.SHOW_TEXT)
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const i = n.textContent.indexOf(text)
            if (i >= 0) {
              const r = document.createRange()
              r.setStart(n, i)
              r.setEnd(n, i + text.length)
              const b = [...r.getClientRects()][0]
              return { x: (b.left - pr.left) / s, y: (b.top - pr.top) / s, w: b.width / s, h: b.height / s }
            }
          }
          return null
        }
        const a = find('動きの大きさと素材の光り方')
        const b = find('航海の力強さと冒険心')
        let marks = ''
        // 丸で囲み、左の余白に「具体的に！」
        if (a) marks += `<ellipse cx="${a.x + a.w / 2}" cy="${a.y + a.h / 2}" rx="${a.w / 2 + 10}" ry="${a.h / 2 + 7}" fill="none" stroke="#d3262b" stroke-width="2.4" transform="rotate(-2 ${a.x + a.w / 2} ${a.y + a.h / 2})"/><text x="14" y="${a.y + a.h / 2 + 4}" fill="#d3262b" font-size="19" font-family="'BIZ UDPGothic',sans-serif" font-weight="700" transform="rotate(-8 60 ${a.y + a.h / 2})">具体的に！</text>`
        // 波線と、右の余白に「◎」
        if (b) marks += `<path d="M${b.x - 2} ${b.y + b.h + 3} q ${b.w / 8} 6 ${b.w / 4} 0 t ${b.w / 4} 0 t ${b.w / 4} 0 t ${b.w / 4 + 4} 0" fill="none" stroke="#d3262b" stroke-width="2.2"/><text x="${b.x + b.w + 6}" y="${b.y - 4}" fill="#d3262b" font-size="22" font-family="'BIZ UDPGothic',sans-serif" font-weight="700">◎</text>`
        pageEl.insertAdjacentHTML('beforeend', `<svg class="v35-x" style="position:absolute;left:0;top:0;width:793.701px;height:1122.52px;z-index:11;pointer-events:none;overflow:visible" viewBox="0 0 793.701 1122.52">${marks}</svg>`)
        void k
        return { a: !!a, b: !!b }
      }, v).then((r) => (!r.a || !r.b) && console.log('  ！赤ペンの位置が見つからない', r))
      await shot(page, `draft-wm-${v}`, () => {
        const r = window.__editor.pageElements()[window.__editor.getSnapshot().page].getBoundingClientRect()
        return { x: r.left, y: r.top, width: r.width, height: r.height }
      })
      await page.evaluate(() => window.__v35.clear())
    }
    await context.close()
  }
}

// =====================================================================
// 一覧のページ（mockups/v35/review.html）を、質問ごとに画像にする（shots/review-panel.png など）
// =====================================================================
async function reviewShots(browser) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1300, height: 900, deviceScaleFactor: 1 })
  await page.goto(`${APP}/${DIR}/review.html`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  for (const id of ['panel', 'table', 'spread', 'undo', 'draft']) {
    const el = await page.$(`#${id}`)
    if (!el) continue
    await el.screenshot({ path: `${OUT}/review-${id}.png` })
    console.log('✓', `review-${id}`)
  }
  await page.close()
}

await withEdge(async (browser) => {
  if (want('panel')) await panelShots(browser)
  if (want('table')) await tableShots(browser)
  if (want('spread')) await spreadShots(browser)
  if (want('undo')) await undoShots(browser)
  if (want('draft')) await draftShots(browser)
  if (want('review')) await reviewShots(browser)
})
