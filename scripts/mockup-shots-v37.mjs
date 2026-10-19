// デザイン案 v37（右の欄のゆとり：「右の欄に書かれているものが詰まって見える。レイアウトのバランスを見直してほしい」）を画像に書き出す。
// 本物の学生用ツール（開発サーバーの /?nodrive。ログインなし）を開き、はじめたばかりの原稿と、書いている途中の原稿（見本の原稿 scripts/e2e/sampleReport.mjs の setupWriting に、
// 書き間違いを3つ入れたもの）で、右の欄を案ごとに書き換えて写す（src/ は変えない）。まだのところ・直すところの行と数は、本物のツールが出したもの。
// できるもの：mockups/v37/shots/*.png（案の画面）と、shots/review-panel-spacing.png（一覧のページ mockups/v37/review.html の写し）
// 使い方: node scripts/mockup-shots-v37.mjs [panel] [review]（何も付けなければ全部。開発サーバーが http://localhost:5173 で動いていること）
//   panel ：右の欄の、いま・案A・案B・案C。はじめたばかり・書いている途中の2つの時点で、1366×768 と 1920×1080。
//           おすすめの案（REC）は画面全体と、欄を広げたとき（312 → 340px）も。案C は「メニュー」を開いたところも
//           数（1366・1920）を付けると、その画面の大きさだけ
//   review：一覧のページ（mockups/v37/review.html）を画像にする
//   Edge は EDGE_PORT（ふだんは 9725）で起動する
import { mkdirSync } from 'node:fs'

process.env.EDGE_PORT ??= '9725'
const { withEdge } = await import('./poc/edge.mjs')
const { stubConfig } = await import('./e2e/configStub.mjs')
const { setupWriting } = await import('./e2e/sampleReport.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const DIR = 'mockups/v37'
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })
const ARGS = process.argv.slice(2)
/** 画面の大きさだけ選ぶとき（例：node scripts/mockup-shots-v37.mjs panel 1366） */
const SIZE_ONLY = ARGS.filter((a) => /^\d+$/.test(a)).map(Number)
const ONLY = ARGS.filter((a) => !/^\d+$/.test(a))
const want = (k) => ONLY.length === 0 || ONLY.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** パソコンの画面の大きさ（ノートパソコンと、大きい画面）。どちらも 1.5 倍の細かさで写す（一覧で並べたとき、右の欄の絵の細かさをそろえる。並び方は倍率で変わらない） */
const SIZES = {
  1366: { width: 1366, height: 768, deviceScaleFactor: 1.5 },
  1920: { width: 1920, height: 1080, deviceScaleFactor: 1.5 },
}
/** おすすめの案（画面全体と、欄を広げたときも写す） */
const REC = 'c'
/** 欄を広げたときの幅（いまの既定は 312px。src/app/usePanelWidths.ts の PANEL_DEFAULTS） */
const WIDE = 340
/** コースからのお知らせの文（例）。自動テスト用の設定の文は短すぎるので、ありそうな長さの例にする（どの案でも、いまでも同じ文） */
const NOTICE = '中間発表（12月4日）までに、本文を3ページ以上書いておきましょう。'

// ---- アイコン（src/app/icons.tsx と同じ線） ----
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const IC = {
  /** メニュー（横線3本） */
  menu: svg('<path d="M5 7h14M5 12h14M5 17h14"/>'),
  help: svg('<circle cx="12" cy="12" r="8.6"/><path d="M9.6 9.7a2.45 2.45 0 014.75.85c0 1.65-2.35 1.95-2.35 3.5"/><path d="M12 16.9v.15" stroke-width="2.3"/>'),
  backup: svg('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 17v2.5h14V17"/>'),
}

/** 案の部品の見た目。色と書体は src/tokens.css・src/index.css のもの */
const CSS = `
  .v37-x { font-family: 'BIZ UDPGothic', sans-serif; box-sizing: border-box; }
  [data-v37-hidden] { display: none !important; }
  /* ドライブの保存のようす（ログインしているときの見た目。撮影は /?nodrive なので似せて描く） */
  .chip.v37-drive { color: var(--ink); background: #fff; box-shadow: inset 0 0 0 1px var(--line); }
  .chip.v37-drive .drive-ic { color: var(--ok); width: 14px; height: 14px; }
  .chip.v37-drive .caret { font-size: 9px; color: var(--muted); margin-left: -2px; }

  /* ===== 案A（案B・案C も同じ字の大きさ）：字を大きく・行の間を広く・小さな説明の字を減らす・まとまりの間に線 ===== */
  .side.v37-air .side-head { padding: 14px 18px 14px; }
  .side.v37-air .brand-row .mark { width: 30px; height: 30px; font-size: 15px; }
  .side.v37-air .brand-name { font-size: 15.5px; }
  .side.v37-air .brand-sub { font-size: 12px; }
  .side.v37-air .meta { flex-wrap: nowrap; margin-top: 10px; }
  .side.v37-air .meta .chip { padding: 4px 10px; font-size: 12px; white-space: nowrap; }
  .side.v37-air .meta .chip.deadline { padding: 0; font-size: 12.5px; }
  .side.v37-air .meta .chip.deadline b { font-size: 15px; }
  .side.v37-air .links { gap: 8px; margin-top: 10px; }
  .side.v37-air .link-btn { padding: 7px 0; font-size: 13px; }
  .side.v37-air .link-btn svg { width: 16px; height: 16px; }
  .side.v37-air .word-link { margin-top: 10px; font-size: 12.5px; }
  .side.v37-air .word-link svg { width: 15px; height: 15px; }
  .side.v37-air .notice { margin: 0 18px 14px; padding: 9px 12px; font-size: 12.5px; line-height: 1.65; }
  .side.v37-air .notice b { font-size: 12px; margin-bottom: 1px; }
  /* まとまりの間の線（いまより少し濃く） */
  .side.v37-air .sec { padding: 16px 18px 16px; border-top: 1px solid #dcd7cf; }
  .side.v37-air .side-foot { padding: 14px 18px 14px; border-top: 1px solid #dcd7cf; }
  .side.v37-air .sec-h { margin-bottom: 12px; font-size: 14.5px; }
  .side.v37-air .sec-h > span:first-child { letter-spacing: 0.1em; }
  /* 小見出し「まだのところ」「直すところ」：右の小さな説明の字は出さず（マウスを乗せると出る）、数を横に */
  .side.v37-air .check-sub { justify-content: flex-start; align-items: center; gap: 8px; margin: 0 0 6px; font-size: 13.5px; }
  .side.v37-air .check-sub b { letter-spacing: 0.06em; }
  .side.v37-air .check-sub.fix { margin-top: 16px; }
  .v37-n { display: inline-grid; place-items: center; min-width: 22px; height: 20px; padding: 0 7px; border-radius: 10px; background: var(--chip-bg); font-size: 13px; font-weight: 700; color: var(--ink); }
  .v37-n.e { background: var(--error-soft); color: var(--error); }
  /* まだのところの行：14px、行の高さ 約38px（いまは 12.5px・約29px） */
  .side.v37-air .check-prog { padding-bottom: 12px; border-bottom-color: #dcd7cf; }
  .side.v37-air .check-prog .row { grid-template-columns: 18px minmax(0, 1fr) auto; column-gap: 10px; padding: 7px 4px; font-size: 14px; }
  .side.v37-air .check-prog .row > i { width: 18px; height: 18px; }
  .side.v37-air .check-prog .row > i svg { width: 12px; height: 12px; }
  .side.v37-air .check-prog .v { font-size: 13px; }
  .side.v37-air .check-prog li.todo .v b { font-size: 14.5px; }
  .side.v37-air .check-prog .bar { height: 5px; margin-top: 6px; }
  .side.v37-air .check-none { margin-top: 4px; font-size: 14px; }
  .side.v37-air .sev-legend { margin-top: 6px; padding: 8px 12px; font-size: 12.5px; }
  .side.v37-air .igroup { margin-top: 14px; }
  .side.v37-air .ig-h { margin-bottom: 2px; font-size: 12.5px; }
  .side.v37-air .issue { grid-template-columns: 18px 1fr auto; padding: 11px 4px; }
  .side.v37-air .issue .dot { width: 18px; height: 18px; font-size: 12px; }
  .side.v37-air .issue .ttl { font-size: 14px; }
  .side.v37-air .issue .detail { margin-top: 3px; font-size: 13px; }
  /* PDF のボタンは、いまのまま（14px）。下のひとことだけ 12 → 13px */
  .side.v37-air .side-foot p { margin-top: 9px; font-size: 13px; }
  .side.v37-air .source-notice { margin-top: 6px; font-size: 11px; }

  /* ===== 案B：まとまりごとに白いカード（薄い灰色の台の上） ===== */
  .side.v37-b { background: #efece7; }
  .side.v37-b .v37-top { padding: 14px 16px 12px; }
  .side.v37-b .v37-top .brand-row > div { display: block; min-width: 0; }
  .side.v37-b .v37-top .brand-sub { margin-top: 2px; }
  .side.v37-b .v37-top .v37-help { flex: none; margin-left: auto; padding: 5px 12px; font-size: 13px; }
  .side.v37-b .v37-card { margin: 0 12px 8px; padding: 12px 13px 13px; background: #fff; border: 1px solid #e2ddd5; border-radius: 12px; box-shadow: 0 1px 2px rgba(30, 25, 20, 0.04); }
  .side.v37-b .v37-h { margin: 0 0 10px; font-size: 14px; font-weight: 700; letter-spacing: 0.1em; color: var(--ink); }
  .side.v37-b .v37-card .meta { margin-top: 0; }
  .side.v37-b .v37-hrow { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin: 0 0 10px; }
  .side.v37-b .v37-hrow .v37-h { margin: 0; }
  .side.v37-b .v37-hrow .chip.deadline { padding: 0; background: none; font-size: 12.5px; }
  .side.v37-b .v37-hrow .chip.deadline b { font-size: 15px; }
  .side.v37-b .v37-card .links { margin-top: 12px; }
  .side.v37-b .v37-card .word-link { margin-top: 11px; font-size: 12px; }
  .side.v37-b .v37-notice .v37-h { margin-bottom: 6px; color: var(--accent); }
  .side.v37-b .v37-notice p { margin: 0; font-size: 13px; line-height: 1.65; white-space: pre-wrap; }
  .side.v37-b .sec.check { margin: 0 12px; padding: 12px 13px 13px; background: #fff; border: 1px solid #e2ddd5; border-radius: 12px; box-shadow: 0 1px 2px rgba(30, 25, 20, 0.04); }
  .side.v37-b .sec-h { margin-bottom: 12px; font-size: 14px; }
  .side.v37-b .side-foot { padding: 12px 12px 12px; border-top: 0; }

  /* ===== 案C：上の物を減らす（「バックアップ・作り直す」「使い方」「Word で書いた分を読み込む」を「メニュー」に）。あとは案Aと同じ ===== */
  .side.v37-c .side-head { position: relative; }
  .side.v37-c .brand-row > div:first-of-type { display: block; }
  .side.v37-c .brand-sub { margin-top: 2px; }
  .side.v37-c .v37-menu-btn { flex: none; display: inline-flex; align-items: center; gap: 5px; margin-left: auto; padding: 6px 10px 6px 9px; border: 1px solid #c9cfe6; border-radius: var(--r-md); background: #fff; color: var(--accent); font: inherit; font-size: 13px; }
  .side.v37-c .v37-menu-btn svg { width: 16px; height: 16px; }
  .side.v37-c .v37-menu-btn .caret { font-size: 9px; color: var(--muted); }
  .side.v37-c .v37-menu-btn.on { background: var(--accent-soft); }
  .v37-menu { position: absolute; z-index: 40; right: 14px; width: 262px; padding: 6px; background: #fff; border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 12px 32px rgba(30, 25, 20, 0.2); display: grid; gap: 2px; }
  .v37-menu button { display: flex; align-items: center; gap: 9px; width: 100%; padding: 10px 10px; border: 0; border-radius: 8px; background: none; font: inherit; font-size: 13.5px; color: var(--ink); text-align: left; line-height: 1.4; }
  .v37-menu button svg { flex: none; width: 17px; height: 17px; color: var(--muted); }
  .v37-menu button.v37-mhelp { color: var(--accent); }
  .v37-menu button.v37-mhelp svg { color: var(--accent); }
  .v37-menu button.hover { background: var(--accent-soft); }
  .v37-menu hr { width: 100%; margin: 2px 0; border: 0; border-top: 1px solid var(--line); }
  .v37-menu small { display: block; font-size: 12px; color: var(--muted); }
`

/** ページの中で使う道具（部品を足す・隠す・元に戻す） */
async function installKit(page) {
  await page.evaluate((css) => {
    const style = document.createElement('style')
    style.id = 'v37-style'
    style.textContent = css
    document.head.append(style)
    window.__v37 = {
      /** 本物の部品を隠して、すぐ後ろに案の部品を置く（あとで clear で元に戻す） */
      swap(el, html) {
        el.setAttribute('data-v37-hidden', '')
        el.insertAdjacentHTML('afterend', html)
        return el.nextElementSibling
      },
      /** 本物の部品を隠す */
      hide(el) {
        el?.setAttribute('data-v37-hidden', '')
      },
      /** 本物の部品のすぐ後ろ（before：前）に、案の部品を足す */
      after(el, html, before = false) {
        el.insertAdjacentHTML(before ? 'beforebegin' : 'afterend', html)
        return before ? el.previousElementSibling : el.nextElementSibling
      },
      /** 本物の部品に、案の見た目の印（class）を付ける（clear で外す） */
      mark(el, cls) {
        el.classList.add(cls)
        el.setAttribute('data-v37-cls', `${el.getAttribute('data-v37-cls') ?? ''} ${cls}`.trim())
      },
      /** 本物の部品の字を書き換える（clear で戻す） */
      text(el, text) {
        if (!el.hasAttribute('data-v37-text')) el.setAttribute('data-v37-text', el.innerHTML)
        el.innerHTML = text
      },
      /** 案の部品を全部外し、隠した本物を戻す（字の書き換え keepText は残す） */
      clear(keepText = true) {
        document.querySelectorAll('.v37-x').forEach((e) => e.remove())
        document.querySelectorAll('[data-v37-hidden]').forEach((e) => e.removeAttribute('data-v37-hidden'))
        document.querySelectorAll('[data-v37-cls]').forEach((e) => {
          e.classList.remove(...e.getAttribute('data-v37-cls').split(' '))
          e.removeAttribute('data-v37-cls')
        })
        if (keepText) return
        document.querySelectorAll('[data-v37-text]').forEach((e) => {
          e.innerHTML = e.getAttribute('data-v37-text')
          e.removeAttribute('data-v37-text')
        })
      },
    }
  }, CSS)
}

const ready = (page) =>
  page.waitForFunction(() => {
    const s = window.__editor?.getSnapshot()
    return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading')
  }, { timeout: 120000 })

/** 学生用ツールを開く（はじめての案内は、コースを選び、Word は「いいえ」まで進める）。right：右の欄の幅（なければ既定の 312px） */
async function openTool(browser, vp, right) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  // 本物の確かめの窓が出たら、必ず「キャンセル」
  page.on('dialog', (d) => d.dismiss())
  // 開発サーバーの即時反映をつながない（撮っている途中に src/ が直されても、画面が入れ替わらないように）。指差し確認は見たことにする。
  // 右の欄の幅は、欄の境目を動かしたときに覚えておく値（src/app/usePanelWidths.ts）で決める
  await page.evaluateOnNewDocument((right) => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
      if (right) localStorage.setItem('sotsugyo-seisaku-report-panels', JSON.stringify({ left: 124, right }))
    } catch {}
  }, right ?? 0)
  await stubConfig(page)
  await page.setViewport(vp)
  // 開発サーバーが一時的にエラーを出していたら（ほかの人が src/ を直している途中）、少し待って開き直す
  for (let i = 0; ; i++) {
    try {
      await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0', timeout: 90000 })
      await ready(page)
      await page.waitForSelector('.guide.step-course .g-opts button', { timeout: 60000 })
      break
    } catch (e) {
      if (i >= 3) throw e
      console.log('  …開き直します：', e.message)
      await sleep(8000)
    }
  }
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
async function openFresh(browser, vp, right) {
  const { context, page } = await openTool(browser, vp, right)
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

/**
 * 書いている途中の原稿：見本の原稿から「まとめ」の章を外し（本文4ページ）、作品写真はまだ、抄録は先生の許可の前。
 * 「制作過程」の段落に、本物の書き間違いを3つ入れる（「です」・「私」・「先生」）
 */
async function openMid(browser, vp, right) {
  const { context, page } = await openTool(browser, vp, right)
  await closeGuide(page)
  await page.evaluate(setupWriting)
  await sleep(600)
  await ready(page)
  await page.evaluate(async () => {
    const ops = await import('/src/editor/reportOps.ts')
    window.__editor.update((r) => {
      let x = { ...r, basicInfo: { ...r.basicInfo, studentId: '00ZZ0123' }, body: r.body.slice(0, 2), abstract: { ...r.abstract, started: false }, workPhotos: { layout: 1, imageIds: [] } }
      x = ops.setText(x, 'p6', 'デザイン画をもとにパターンを引き、シーチングで仮縫いをした。一回目の仮縫いでは、袖の膨らみが大きすぎて、腕を上げたときに肩が引きつれたので、袖山を下げたのです。')
      x = ops.setText(x, 'p7', '二回目の仮縫いでは、私が実際に舞台の上で歩いたり腕を回したりして、動きやすさを確かめた。指導の田中先生にも見ていただいた。')
      return x
    })
  })
  await sleep(600)
  await ready(page)
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('p6'), 'none'))
  await ready(page)
  await sleep(300)
  await installKit(page)
  return { context, page }
}

/**
 * どの写しでも同じ下ごしらえ：保存のようすを、ドライブに保存しているときの見た目にする（学生はふだんログインして使う。撮影は /?nodrive のため似せて描く）。
 * コースからのお知らせの文を、ありそうな長さの例にする
 */
const CLOUD = '<svg class="drive-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18.5h10.5a4 4 0 0 0 .7-7.94A6 6 0 0 0 6.6 9.6 4.5 4.5 0 0 0 7 18.5z"/><path d="M9.4 13.7l2 2 3.6-3.7"/></svg>'
const prepare = (page) =>
  page.evaluate(
    ({ cloud, notice }) => {
      const k = window.__v37
      for (const chip of document.querySelectorAll('.side .meta .chip.saved')) {
        const time = chip.textContent.match(/\d{1,2}:\d{2}/)?.[0] ?? '11:38'
        k.swap(chip, `<span class="v37-x chip v37-drive" title="原稿は、この端末とあなたの Google ドライブに保存されます">${cloud}ドライブに保存 ${time}<span class="caret">▾</span></span>`)
      }
      const p = document.querySelector('.side .notice p')
      if (p) k.text(p, notice)
    },
    { cloud: CLOUD, notice: NOTICE },
  )

/**
 * 右の欄を案ごとに書き換える（opt：'a'・'b'・'c'。中身の行と数は本物のまま。並べ方と字の大きさだけ変える）
 * どの案でも：字を大きく（本文 14px）、小見出しの右の小さな説明の字（「押すと、その場所へ」「書いた文の間違い」）は出さない（マウスを乗せると出す）、
 * 「直すところ 3　まだ 2」の数は、それぞれの小見出しの横へ
 */
async function drawPanel(page, opt) {
  await page.evaluate(
    ({ opt, IC }) => {
      const k = window.__v37
      const side = document.querySelector('.side')
      const head = side.querySelector('.side-head')
      const sec = side.querySelector('.sec.check')
      k.mark(side, 'v37-air')

      // ---- 数を小見出しの横へ（直すところ：赤い数。0 のときは出さない） ----
      const tally = sec.querySelector('.sec-h .tally')
      const [fix, notYet] = [...tally.querySelectorAll('b')].map((b) => b.textContent.trim())
      k.hide(tally)
      for (const sub of sec.querySelectorAll('.check-sub')) {
        k.hide(sub.querySelector('span'))
        const isFix = sub.classList.contains('fix')
        const n = isFix ? fix : notYet
        if (n !== '0') k.after(sub.querySelector('b'), `<span class="v37-x v37-n${isFix ? ' e' : ''}">${n}</span>`)
      }

      if (opt === 'b') {
        // ---- まとまりごとに白いカード：上に名前と「使い方」、その下に「保存・締切」「コースからのお知らせ」「セルフチェック」 ----
        k.mark(side, 'v37-b')
        const brand = head.querySelector('.brand-row')
        const help = head.querySelector('.help-btn')
        const backup = head.querySelector('.backup-btn')
        const word = head.querySelector('.word-link')
        const meta = head.querySelector('.meta')
        const deadline = meta.querySelector('.chip.deadline')
        // 保存のようすだけ（締切は見出しの右へ）
        const chips = [...meta.children].filter((c) => c !== deadline).map((c) => c.outerHTML).join('')
        const notice = side.querySelector('.notice')
        k.hide(head)
        if (notice) k.hide(notice)
        k.after(
          head,
          `<div class="v37-x v37-top"><div class="brand-row">${brand.innerHTML}<button class="link-btn help-btn v37-help">${help.innerHTML}</button></div></div>` +
            `<section class="v37-x v37-card"><div class="v37-hrow"><h3 class="v37-h">保存・締切</h3>${deadline.outerHTML}</div><div class="meta">${chips}</div><div class="links">${backup.outerHTML}</div>${word ? word.outerHTML : ''}</section>` +
            (notice ? `<section class="v37-x v37-card v37-notice"><h3 class="v37-h">コースからのお知らせ</h3><p>${notice.querySelector('p').innerHTML}</p></section>` : ''),
        )
      }

      if (opt === 'c') {
        // ---- 上の物を減らす：「バックアップ・作り直す」「使い方」「Word で書いた分を読み込む」は、名前の横の「メニュー」の中へ ----
        k.mark(side, 'v37-c')
        k.hide(head.querySelector('.links'))
        k.hide(head.querySelector('.word-link'))
        k.after(head.querySelector('.brand-row > div'), `<button class="v37-x v37-menu-btn" title="使い方・バックアップ・作り直す・Word の読み込み">${IC.menu}メニュー<span class="caret">▾</span></button>`)
      }
    },
    { opt, IC },
  )
}

/** 案C の「メニュー」を開いたところ（中身は、いま上に並んでいるもの。手順書の URL が設定されていれば、手順書もここへ） */
async function openMenu(page) {
  await page.evaluate((IC) => {
    const k = window.__v37
    const head = document.querySelector('.side .side-head')
    const btn = head.querySelector('.v37-menu-btn')
    k.mark(btn, 'on')
    const word = head.querySelector('.word-link svg')?.outerHTML ?? ''
    const top = btn.getBoundingClientRect().bottom - head.getBoundingClientRect().top + 6
    head.insertAdjacentHTML(
      'beforeend',
      `<div class="v37-x v37-menu" style="top:${top}px"><button class="v37-mhelp hover">${IC.help}使い方</button><hr><button>${IC.backup}バックアップ・作り直す</button>${word ? `<button>${word}<span>Word で書いた分を読み込む<small>今年度だけ</small></span></button>` : ''}</div>`,
    )
  }, IC)
}

/** 確かめ：右の欄の中で、上下に動く（スクロールが要る）か・文字がボタンからはみ出していないか・字が欄の外に出ていないか */
const measure = (page) =>
  page.evaluate(() => {
    const side = document.querySelector('.side')
    const sec = side.querySelector('.sec.check')
    const sr = side.getBoundingClientRect()
    const over = []
    for (const el of side.querySelectorAll('.link-btn, .export, .v37-x button:not(.word-link), .v37-menu-btn, .chip')) {
      if (el.offsetWidth && el.scrollWidth > el.clientWidth + 1) over.push(el.textContent.trim().slice(0, 20))
    }
    for (const el of side.querySelectorAll('.check-prog .row, .ig-h, .check-sub, .brand-row, .meta, .v37-hrow')) {
      if (!el.offsetWidth) continue
      for (const c of el.children) {
        const r = c.getBoundingClientRect()
        if (r.width && (r.right > sr.right - 8 || r.left < sr.left + 4)) over.push(`欄の端：${c.textContent.trim().slice(0, 16)}`)
      }
    }
    // まだのところの1行の高さ（進み具合の棒のない行）と、セルフチェックの欄より上の高さ
    const row = [...side.querySelectorAll('.check-prog .row')].find((r) => r.offsetHeight && !r.querySelector('.bar'))
    const top = sec ? Math.round(sec.getBoundingClientRect().top - sr.top) : 0
    return { scroll: sec ? Math.max(0, sec.scrollHeight - sec.clientHeight) : 0, secH: sec?.clientHeight ?? 0, rowH: row ? Math.round(row.getBoundingClientRect().height) : 0, top, over }
  })

/** 撮ったときの確かめの結果（一覧のページの説明に使う） */
const LOG = []

/** 撮る。clip：写す範囲（ページの中で求める関数。なければ画面全体） */
async function shot(page, name, clip) {
  await page.evaluate(() => document.fonts.ready)
  await sleep(300)
  const m = await measure(page)
  const box = clip ? await page.evaluate(clip) : undefined
  await page.screenshot({ path: `${OUT}/${name}.png`, captureBeyondViewport: false, ...(box ? { clip: box } : {}) })
  const line = `${name}：${m.scroll ? `セルフチェックの欄が ${m.scroll}px 上下に動く（欄の高さ ${m.secH}px）` : `上下に動かない（欄の高さ ${m.secH}px）`}　欄より上 ${m.top}px・行の高さ ${m.rowH}px${m.over.length ? `　！はみ出す：${m.over.join('／')}` : ''}`
  LOG.push(line)
  console.log('✓', line)
  return m
}

/** 写す範囲：右の欄（PC）の全体 */
const SIDE = () => {
  const r = document.querySelector('.side').getBoundingClientRect()
  return { x: r.left, y: 0, width: r.width, height: innerHeight }
}

/** 紙面の幅（右の欄を広げたときに、紙が小さくなるかを確かめる） */
const paperWidth = (page) => page.evaluate(() => Math.round(window.__editor.pageElements()[window.__editor.getSnapshot().page].getBoundingClientRect().width))

/** 画面の外（何もない所）にマウスを置く（ボタンの上に乗ったままにしない） */
const parkMouse = (page) => page.mouse.move(5, 5)

async function panelShots(browser) {
  for (const size of [1366, 1920].filter((s) => !SIZE_ONLY.length || SIZE_ONLY.includes(s))) {
    for (const [tag, opener] of [
      [1, openFresh],
      [2, openMid],
    ]) {
      // ---- いまの幅（312px）：いま・案A・案B・案C ----
      {
        const { context, page } = await opener(browser, SIZES[size])
        await page.evaluate(() => window.__editor.finishEditing())
        await ready(page)
        await prepare(page)
        await parkMouse(page)
        await shot(page, `panel-now-${tag}-${size}`, SIDE)
        // 画面全体：いまは、ノートパソコンの書いている途中だけ（おすすめの案と比べる）。おすすめの案は、ノートパソコンの2つと、大きい画面の書いている途中
        if (size === 1366 && tag === 2) await shot(page, `full-now-${tag}-${size}`)
        const paper = await paperWidth(page)
        for (const opt of ['a', 'b', 'c']) {
          await drawPanel(page, opt)
          await page.evaluate(() => document.querySelector('.side .sec.check').scrollTo(0, 0))
          await shot(page, `panel-${opt}-${tag}-${size}`, SIDE)
          if (opt === REC && (size === 1366 || tag === 2)) await shot(page, `full-${opt}-${tag}-${size}`)
          if (opt === 'c' && tag === 1 && size === 1366) {
            await openMenu(page)
            await shot(page, 'panel-c-menu-1366', SIDE)
          }
          await page.evaluate(() => window.__v37.clear())
          await prepare(page)
        }
        LOG.push(`紙面の幅（${size}・${tag}・欄 312px）：${paper}px`)
        await context.close()
      }
      // ---- 欄を広げたとき（340px）：おすすめの案だけ ----
      {
        const { context, page } = await opener(browser, SIZES[size], WIDE)
        await page.evaluate(() => window.__editor.finishEditing())
        await ready(page)
        await prepare(page)
        await parkMouse(page)
        await drawPanel(page, REC)
        await shot(page, `panel-${REC}-${tag}-${size}-w${WIDE}`, SIDE)
        LOG.push(`紙面の幅（${size}・${tag}・欄 ${WIDE}px）：${await paperWidth(page)}px`)
        await context.close()
      }
    }
  }
  console.log('\n---- 確かめの結果 ----\n' + LOG.join('\n'))
}

// =====================================================================
// 一覧のページ（mockups/v37/review.html）を画像にする（shots/review-panel-spacing.png）
// =====================================================================
async function reviewShots(browser) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1300, height: 900, deviceScaleFactor: 1 })
  await page.goto(`${APP}/${DIR}/review.html`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  await sleep(500)
  const el = await page.$('#panel')
  await el.screenshot({ path: `${OUT}/review-panel-spacing.png` })
  console.log('✓ review-panel-spacing')
  await page.close()
}

await withEdge(async (browser) => {
  if (want('panel')) await panelShots(browser)
  if (want('review')) await reviewShots(browser)
})
