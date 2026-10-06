// デザイン案 v19（ツールを開いたら、まず大学のアカウントでログイン：ドライブへの保存を必須にする）を画像に書き出す。
// 学生用ツールに、案ごとの部品を仮に足して撮る（まだ作っていない部品は、この撮影のためだけに足す）。
// 使い方: node scripts/mockup-shots-v19.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { stubConfig } from './e2e/configStub.mjs'
import { withEdge } from './poc/edge.mjs'

const OUT = 'mockups/v19/screens'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Google のログインのボタンに付ける「G」の印
const G = `<svg class="v19-g" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`

const T = {
  lead: '大学の Google アカウントでログインしてください。原稿は、あなたの Google ドライブ（「卒業制作報告書」フォルダ）に自動で保存されます。',
  button: `<button class="v19-login">${G}大学のアカウントでログイン</button>`,
  note: '@bunka-wu.ac.jp のアカウントを選んでください。このツールが見られるのは、このツールで作ったファイルだけです。学科や先生が、あなたのドライブを見ることはありません。',
  again: '2回目からは、Google の小さな窓が一瞬出て閉じるだけです。',
}

const CSS = `
  .guide { display: none !important; }
  .v19-g { width: 20px; height: 20px; flex: none; }
  .v19-login { display: flex; align-items: center; justify-content: center; gap: 12px; width: 100%; padding: 13px 16px; border-radius: 10px; border: 1px solid #c9cdd6; background: #fff; color: #1f1f1f; font-size: 15px; font-weight: 700; font-family: inherit; box-shadow: 0 1px 2px rgba(0,0,0,0.08); cursor: pointer; }
  .v19-small { font-size: 11.5px; color: var(--muted); line-height: 1.7; margin: 12px 0 0; }
  .v19-mark { width: 44px; height: 44px; border-radius: 12px; border: 1.5px solid var(--accent); color: var(--accent); display: grid; place-items: center; font-family: 'BIZ UDMincho', serif; font-size: 22px; }
  .v19-brand { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  .v19-brand b { display: block; font-family: 'BIZ UDMincho', serif; font-weight: 400; font-size: 21px; letter-spacing: 0.12em; }
  .v19-brand span { font-size: 12px; color: var(--muted); letter-spacing: 0.06em; }
  .v19-brand span.v19-mark { font-size: 22px; color: var(--accent); letter-spacing: 0; }
  .v19-page .intro .v19-brand span.v19-mark { color: #fff; }
  .v19-card { box-sizing: border-box; background: #fff; border-radius: 18px; padding: 26px 28px 22px; box-shadow: 0 18px 50px rgba(20, 20, 30, 0.28); width: 420px; font-size: 14px; }
  .v19-card p.lead { font-size: 13.5px; line-height: 1.8; margin: 0 0 18px; color: #3f4249; }
  /* 案A：紙面の上に重ねる */
  .v19-over { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; background: rgba(236, 233, 228, 0.72); backdrop-filter: blur(3px); }
  /* 案B：ログインだけの入口の画面 */
  .v19-page { position: fixed; inset: 0; z-index: 60; background: #f4f2ee; display: grid; grid-template-columns: 1.1fr 1fr; }
  .v19-page .intro { padding: 70px 64px; display: flex; flex-direction: column; justify-content: center; background: linear-gradient(160deg, #2f3e75, #24305c); color: #fff; }
  .v19-page .intro .v19-mark { border-color: #fff; color: #fff; }
  .v19-page .intro .v19-brand span { color: #c9d0ea; }
  .v19-page .intro h1 { font-family: 'BIZ UDMincho', serif; font-weight: 400; font-size: 30px; letter-spacing: 0.1em; margin: 26px 0 14px; line-height: 1.5; }
  .v19-page .intro ul { margin: 6px 0 0; padding-left: 20px; line-height: 2.1; font-size: 14.5px; color: #e4e8f6; }
  .v19-page .intro .dl { margin-top: 28px; font-size: 13px; color: #c9d0ea; }
  .v19-page .intro .dl b { font-size: 20px; color: #fff; margin: 0 4px; }
  .v19-page .side-l { display: grid; place-items: center; }
  .v19-page .v19-card { box-shadow: 0 8px 30px rgba(20, 20, 30, 0.12); }
  .v19-page .v19-card h2 { font-size: 18px; margin: 0 0 10px; }
  /* 案C：表紙の案内の1つめ */
  .v19-tip-wrap { position: fixed; inset: 0; z-index: 60; background: rgba(22, 22, 28, 0.5); }
  .v19-tip { position: absolute; width: 380px; background: #fff; border-radius: 16px; padding: 18px 20px 16px; box-shadow: 0 16px 48px rgba(0, 0, 0, 0.28); }
  .v19-tip .g-steps { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 11px; color: var(--muted); margin-bottom: 10px; }
  .v19-tip .g-steps .on { color: var(--accent); font-weight: 700; }
  .v19-tip h2 { font-family: 'BIZ UDMincho', serif; font-weight: 400; font-size: 19px; letter-spacing: 0.04em; margin: 0 0 6px; }
  .v19-tip p { margin: 0 0 14px; font-size: 12.5px; line-height: 1.8; color: #4a4d54; }
  /* 共通の状態 */
  .v19-progress { height: 6px; border-radius: 3px; background: #ecebe8; overflow: hidden; margin: 6px 0 4px; }
  .v19-progress i { display: block; height: 100%; width: 42%; background: var(--accent); border-radius: 3px; }
  .v19-spin { display: flex; align-items: center; gap: 10px; font-weight: 700; margin-bottom: 8px; }
  .v19-spin::before { content: ''; width: 16px; height: 16px; border-radius: 50%; border: 2.5px solid var(--accent-soft); border-top-color: var(--accent); }
  .v19-err { background: var(--error-soft); color: var(--error); border-radius: 10px; padding: 10px 12px; font-size: 13px; line-height: 1.7; margin: 0 0 14px; }
  .v19-err small { display: block; color: #8b4a4a; font-size: 11.5px; }
  .v19-warn { background: #fbf0d9; color: #87590a; border-radius: 10px; padding: 10px 12px; font-size: 13px; line-height: 1.7; margin: 0 0 14px; }
  .v19-login[disabled] { opacity: 0.45; }
  .modal .v19-small { margin-top: 4px; }
  /* スマホ */
  @media (max-width: 600px) { .v19-card { width: calc(100vw - 32px); padding: 22px 20px 18px; } }
  .v19-page.narrow { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .v19-page.narrow .intro { padding: 34px 24px 26px; }
  .v19-page.narrow .intro h1 { font-size: 22px; margin: 16px 0 6px; }
  .v19-page.narrow .intro ul { font-size: 13px; line-height: 1.9; }
  .v19-page.narrow .intro .dl { margin-top: 12px; }
  .v19-page.narrow .side-l { align-items: start; padding-top: 18px; }
  .v19-page.narrow .v19-card { width: calc(100vw - 32px); }
`

const brand = '<div class="v19-brand"><span class="v19-mark">卒</span><div><b>卒業制作報告書</b><span>2026年度　作成ツール</span></div></div>'

const VARIANTS = {
  // 案A：紙面の上に、ログインの窓を重ねる（後ろにツールが見える）
  a: (T, brand) => {
    const el = document.createElement('div')
    el.className = 'v19-over'
    el.innerHTML = `<div class="v19-card">${brand}<p class="lead">${T.lead}</p>${T.button}<p class="v19-small">${T.note}</p></div>`
    document.body.append(el)
  },
  // 案B：ログインだけの入口の画面（ツールの説明と締切も出す）
  b: (T, brand, narrow) => {
    const el = document.createElement('div')
    el.className = `v19-page${narrow ? ' narrow' : ''}`
    el.innerHTML = `<div class="intro">${brand}<h1>卒業制作報告書を、<br>ここで書いて提出します</h1><ul><li>表紙から作品写真まで、決まった形のまま書ける</li><li>手順書に合っているかを、その場で確かめられる</li><li>原稿はあなたのドライブに自動で保存</li></ul><div class="dl">最終締切まで<b>107</b>日（2027年1月20日）</div></div>
      <div class="side-l"><div class="v19-card"><h2>ログイン</h2><p class="lead">${T.lead}</p>${T.button}<p class="v19-small">${T.note}</p></div></div>`
    document.body.append(el)
  },
  // 案C：表紙の案内の1つめを「ログイン」にする
  c: (T, brand, narrow) => {
    const el = document.createElement('div')
    el.className = 'v19-tip-wrap'
    const page = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current')?.getBoundingClientRect()
    const left = narrow ? 12 : page ? page.left + page.width / 2 - 190 : 500
    const top = narrow ? 150 : page ? page.top + 150 : 200
    el.innerHTML = `<div class="v19-tip" style="left:${left}px;top:${top}px;${narrow ? 'width:calc(100vw - 24px)' : ''}"><div class="g-steps"><span class="on">1 ログイン</span><span>2 コース</span><span>3 学籍番号</span><span>4 氏名</span><span>5 サブタイトル</span></div><h2>はじめに、大学のアカウントでログインしてください</h2><p>${T.lead}</p>${T.button}<p class="v19-small">${T.note}</p></div>`
    document.body.append(el)
  },
}

// 共通の状態（案Aの形で撮る。どの案でも、窓の中身は同じ）
const STATES = {
  loading: (T, brand) => {
    const el = document.createElement('div')
    el.className = 'v19-over'
    el.innerHTML = `<div class="v19-card">${brand}<div class="v19-spin">ドライブから原稿を読み込んでいます…</div><div class="v19-progress"><i></i></div><p class="v19-small" style="margin-top:4px">写真 5 / 12 枚（写真が多いと、少し時間がかかります）</p></div>`
    document.body.append(el)
  },
  error: (T, brand) => {
    const el = document.createElement('div')
    el.className = 'v19-over'
    el.innerHTML = `<div class="v19-card">${brand}<div class="v19-err">ログインできませんでした。大学のアカウント（@bunka-wu.ac.jp）を選んでください。<small>ログインの窓が開かないときは、ブラウザのポップアップを許可してください</small></div>${T.button.replace('大学のアカウントでログイン', 'もう一度ログインする')}<p class="v19-small">${T.note}</p></div>`
    document.body.append(el)
  },
  offline: (T, brand) => {
    const el = document.createElement('div')
    el.className = 'v19-over'
    el.innerHTML = `<div class="v19-card">${brand}<div class="v19-warn">インターネットにつながっていません。つながると、ログインできるようになります。</div>${T.button.replace('<button', '<button disabled')}<p class="v19-small">原稿はドライブに保存するため、ログインしてから書きます。</p></div>`
    document.body.append(el)
  },
  relogin: () => {
    const back = document.createElement('div')
    back.className = 'modal-backdrop'
    back.innerHTML = `<div class="modal"><header><h2>もう一度ログインしてください</h2></header>
      <p class="lead">ドライブへの保存を続けるため、ログインし直してください（Google の決まりで、1時間ごとに必要です）。</p>
      <p class="v19-small">押すまでのあいだも、書いた内容はこの端末に保存しています。</p>
      <div class="row-buttons"><span class="spacer"></span><button class="primary" style="display:flex;align-items:center;gap:8px">ログインし直す</button></div></div>`
    document.body.append(back)
  },
}

const ready = (page, phone) =>
  page.waitForFunction(
    (phone) => {
      const s = window.__editor?.getSnapshot()
      return s?.layout && (!phone || s.sheet) && !s.rendering && !s.turning && !document.querySelector('.loading')
    },
    { timeout: 120000 },
    phone,
  )

async function open(browser, { phone = false } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  if (phone) await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  else await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 })
  await stubConfig(page)
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 90000 })
  await ready(page, phone)
  await page.addStyleTag({ content: CSS })
  return { context, page }
}

await withEdge(async (browser) => {
  for (const phone of [false, true]) {
    for (const [key, inject] of Object.entries(VARIANTS)) {
      const { context, page } = await open(browser, { phone })
      await page.evaluate(inject, T, brand, phone)
      await sleep(300)
      const name = `${OUT}/${key}${phone ? '-phone' : ''}.png`
      await page.screenshot({ path: name })
      console.log(name)
      await context.close()
    }
  }
  for (const [key, inject] of Object.entries(STATES)) {
    const { context, page } = await open(browser)
    if (key === 'relogin') {
      await page.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, studentId: '23FA0123', name: '文化　花子', subtitleInput: 'シンドバッド' } })))
      await sleep(400)
      await ready(page)
    }
    await page.evaluate(inject, T, brand)
    await sleep(300)
    await page.screenshot({ path: `${OUT}/state-${key}.png` })
    console.log(`${OUT}/state-${key}.png`)
    await context.close()
  }

  // 一覧のページ
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 })
  await page.goto('http://localhost:5173/mockups/v19/login.html', { waitUntil: 'networkidle0' })
  await page.screenshot({ path: `${OUT}/login.png`, fullPage: true })
  console.log(`${OUT}/login.png`)
})
