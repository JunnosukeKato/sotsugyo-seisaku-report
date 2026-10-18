// デザイン案 v34（「新しく始める」「最初から作り直す」の場所が分からない。いまは「バックアップ」の窓のいちばん下にしかない）を画像に書き出す。
// 本物の学生用ツール（開発サーバーの /?nodrive。ログインなし）に見本の原稿（scripts/e2e/sampleReport.mjs の setupWriting。衣装コースの架空の学生）を入れ、
// 右の欄・「バックアップ」の窓・スマホのメニューなどを、案ごとに書き換えて写す（src/ は変えない）。
// 「最初から作り直す」を押したときの確かめは、ブラウザの確かめの窓（confirm）で、撮影用の Edge では写せないため、似せて描いたもの。
// できるもの：mockups/v34/shots/*.png（案の画面）と、shots/review-startover.png（一覧のページ mockups/v34/review.html の写し）
// 使い方: node scripts/mockup-shots-v34.mjs [pc] [guide] [phone] [review]（何も付けなければ全部。開発サーバーが http://localhost:5173 で動いていること）
//   pc    ：パソコン（1366×768）。いま（画面全体と「バックアップ」の窓）、案A・案B・案C の右の欄・窓・確かめの窓・使い方で探したところ
//   guide ：パソコン。はじめての案内の最後（「表紙ができました」）に、案C のひとことを足したところ
//   phone ：スマホ（390×844）。いま・案A・案B のメニュー、案A の「バックアップ」の窓、案C の使い方で探したところ
//   review：一覧のページ（mockups/v34/review.html）を画像にする
//   Edge は EDGE_PORT（ふだんは 9711）で起動する
import { mkdirSync } from 'node:fs'

process.env.EDGE_PORT ??= '9711'
const { withEdge } = await import('./poc/edge.mjs')
const { stubConfig } = await import('./e2e/configStub.mjs')
const { setupWriting } = await import('./e2e/sampleReport.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const DIR = 'mockups/v34'
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })
const ONLY = process.argv.slice(2)
const want = (k) => ONLY.length === 0 || ONLY.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PC = { width: 1366, height: 768, deviceScaleFactor: 1.5 }
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

// ---- アイコン（src/app/icons.tsx と同じ線） ----
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const IC = {
  /** 最初から作り直す（ぐるりと戻る矢印） */
  restart: svg('<path d="M4.5 12a7.5 7.5 0 1 0 2.3-5.4"/><path d="M4.5 4.8v4.2h4.2"/>'),
}

/** 「最初から作り直す」を押したときの確かめ（いまの文。App.tsx の confirm と同じ） */
const CONFIRM_NOW = '今の原稿を消して、最初から作り直しますか？\n（今の原稿は自動の控えに残します）'
/** 案B：「バックアップ」の窓を通らずに開くため、戻し方も1行足す */
const CONFIRM_B = '今の原稿を消して、最初から作り直しますか？\n（今の原稿は自動の控えに残します。戻すときは「バックアップ」から）'

/** 案の部品の見た目。色と書体は src/tokens.css・src/index.css のもの */
const CSS = `
  .v34-x { font-family: 'BIZ UDPGothic', sans-serif; box-sizing: border-box; }
  .v34-x * { box-sizing: border-box; }
  .v34-fixed { position: fixed; z-index: 60; }
  [data-v34-hidden] { display: none !important; }
  /* 案A：右の欄・メニューの「バックアップ・作り直す」。名前が長い分、となりの「使い方」より広くする */
  .link-btn.v34-both { flex: 1.6; white-space: nowrap; }
  .link-btn.v34-both svg { flex: none; }
  /* 案A：窓のいちばん下の「最初から作り直す」の区切り */
  .modal .v34-sec { margin-top: 20px; padding-top: 4px; border-top: 1px solid var(--line); }
  .modal .v34-sec h3 { margin-top: 14px; }
  .modal .v34-sec .row { display: flex; align-items: center; gap: 12px; }
  .modal .v34-sec .row p { flex: 1; margin: 0; font-size: 13px; line-height: 1.7; color: var(--ink); word-break: auto-phrase; }
  /* 自動の控えの一覧：控えが3つでも、撮影用の Edge では上下に動かす棒が出てしまう（いちばん下の「この時点に戻す」の押せる範囲が、一覧の下にはみ出すため）。
     いま・3案とも同じ所なので、棒は出さずに写す */
  .modal .snapshots { scrollbar-width: none; }
  .modal .v34-sec button.danger { flex: none; display: inline-flex; align-items: center; gap: 6px; border-color: #e7c3bf; }
  .modal .v34-sec button.danger svg { width: 16px; height: 16px; }
  .modal .v34-close { margin-top: 14px; }
  /* 案B：「バックアップ」「使い方」の下の小さな文字のボタン（Word の読み込みのリンクと同じ形。色は灰色） */
  .v34-link { position: relative; display: inline-flex; align-items: center; gap: 5px; margin: 10px 0 0; padding: 0; border: 0; background: none; color: var(--muted); font: inherit; font-size: 12px; text-align: left; text-decoration: underline; text-underline-offset: 3px; }
  .v34-link svg { width: 15px; height: 15px; flex: none; }
  .side-head .v34-link { display: flex; }
  .sheet-body .v34-link { display: flex; margin: 4px 0 12px; padding: 4px 0; font-size: 13.5px; }
  .sheet-body .v34-link svg { width: 17px; height: 17px; }
  /* 案C：「バックアップ」に指を乗せたときの吹き出し */
  .v34-tip { padding: 7px 11px; border-radius: 7px; background: #2b2e36; color: #fff; font-size: 12.5px; line-height: 1.55; white-space: nowrap; box-shadow: 0 6px 16px rgba(20, 20, 30, 0.25); }
  .v34-tip::before { content: ''; position: absolute; top: -4px; left: var(--ax, 50%); width: 9px; height: 9px; margin-left: -4.5px; background: #2b2e36; transform: rotate(45deg); }
  .v34-cursor { width: 22px; height: 22px; z-index: 61; pointer-events: none; }
  .link-btn.v34-hover { border-color: var(--accent); color: var(--accent); }
  /* 案C：使い方で探したときの、いちばん上のひとこと */
  .v34-quick { margin: 12px 0 4px; padding: 10px 12px; border-radius: 10px; background: var(--accent-soft); font-size: 12.5px; line-height: 1.7; color: #3f4249; word-break: auto-phrase; }
  .v34-quick b { display: flex; align-items: flex-start; gap: 6px; margin-bottom: 3px; font-size: 13.5px; line-height: 1.5; color: var(--accent); }
  .v34-quick b svg { width: 16px; height: 16px; flex: none; margin-top: 2px; }
  /* 案C：はじめての案内の最後のひとこと */
  .g-tip .v34-gnote { display: flex; gap: 6px; align-items: flex-start; margin: -2px 0 14px; padding: 8px 10px; border-radius: 8px; background: var(--accent-soft); font-size: 12px; line-height: 1.65; color: #3f4249; }
  .g-tip .v34-gnote svg { width: 15px; height: 15px; flex: none; margin-top: 2px; color: var(--accent); }
  .g-tip .v34-gnote b { color: var(--accent); }
  /* ブラウザの確かめの窓（confirm）に似せたもの（撮影用の Edge では本物を写せないため） */
  .v34-native { z-index: 100; top: 12px; left: 50%; transform: translateX(-50%); width: 448px; padding: 20px 24px 18px; border-radius: 8px; background: #fff; box-shadow: 0 10px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(0, 0, 0, 0.08); font-family: 'Yu Gothic UI', 'Segoe UI', sans-serif; color: #1b1b1b; }
  .v34-native .h { margin-bottom: 12px; font-size: 15px; font-weight: 600; }
  .v34-native p { margin: 0 0 22px; font-size: 13.5px; line-height: 1.65; white-space: pre-line; }
  .v34-native .b { display: flex; justify-content: flex-end; gap: 8px; }
  .v34-native button { min-width: 84px; height: 32px; padding: 0 14px; border: 1px solid #c4c4c4; border-radius: 4px; background: #fff; color: #1b1b1b; font: inherit; font-size: 13px; }
  .v34-native button.ok { border-color: #0f6cbd; background: #0f6cbd; color: #fff; }
  /* スマホの紙面のスクロールバーは出さない（iPhone では重ねて出て、すぐ消えるため。撮影用の Edge だけ、いつも出てしまう） */
  .app.phone .page-scroller { scrollbar-width: none; }
`

/** ページの中で使う道具（位置を測る・部品を足す・隠す・元に戻す） */
async function installKit(page) {
  await page.evaluate((css) => {
    const style = document.createElement('style')
    style.id = 'v34-style'
    style.textContent = css
    document.head.append(style)
    window.__v34 = {
      /** 画面での位置 */
      box(sel) {
        const el = typeof sel === 'string' ? document.querySelector(sel) : sel
        const r = el.getBoundingClientRect()
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
      },
      /** 部品を足す（body の直下） */
      add(html) {
        document.body.insertAdjacentHTML('beforeend', html)
        return document.body.lastElementChild
      },
      /** 本物の部品を隠して、すぐ後ろに案の部品を置く（あとで clear で元に戻す） */
      swap(el, html) {
        el.setAttribute('data-v34-hidden', '')
        el.insertAdjacentHTML('afterend', html)
        return el.nextElementSibling
      },
      /** 本物の部品のすぐ後ろ（before：前）に、案の部品を足す */
      after(el, html, before = false) {
        el.insertAdjacentHTML(before ? 'beforebegin' : 'afterend', html)
        return before ? el.previousElementSibling : el.nextElementSibling
      },
      /** 本物のボタンを、名前（と印）を変えた複製に置き換える */
      relabel(el, label, cls = '') {
        const c = el.cloneNode(true)
        c.classList.add('v34-x', ...cls.split(' ').filter(Boolean))
        const icon = c.querySelector('svg')
        c.textContent = ''
        if (icon) c.append(icon)
        c.append(label)
        el.setAttribute('data-v34-hidden', '')
        el.after(c)
        return c
      },
      /** 案の部品を全部外し、隠した本物を戻す */
      clear() {
        document.querySelectorAll('.v34-x').forEach((e) => e.remove())
        document.querySelectorAll('[data-v34-hidden]').forEach((e) => e.removeAttribute('data-v34-hidden'))
        document.querySelectorAll('.v34-hover').forEach((e) => e.classList.remove('v34-hover'))
      },
      /** ブラウザの確かめの窓に似せたもの */
      native(text) {
        return this.add(`<div class="v34-x v34-fixed v34-native" role="alertdialog"><div class="h">このページの内容</div><p></p><div class="b"><button class="ok">OK</button><button>キャンセル</button></div></div>`).querySelector('p').append(text)
      },
    }
  }, CSS)
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
  // 本物の確かめの窓が出たら、必ず「キャンセル」（原稿を作り直さない）
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
  return { context, page }
}

/** 学生用ツールを開き、はじめての案内を閉じて、見本の原稿と自動の控え（3つ）を入れる */
async function open(browser, vp) {
  const { context, page } = await openTool(browser, vp)
  await page.waitForSelector('.guide .g-later', { timeout: 60000 })
  await page.evaluate(() => document.querySelector('.guide .g-later').click())
  await page.evaluate(() => window.__editor.finishEditing())
  await ready(page)
  await page.evaluate(setupWriting)
  await sleep(600)
  await ready(page)
  // 表紙の学籍番号も入れる（指摘が出ないように）
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, studentId: '00ZZ0123' } })))
  await sleep(300)
  await ready(page)
  // 自動の控え（10分ごと）：書いている日の1つと、前の日の1つ（開いたときにツールが作る、いまの時刻の控えと合わせて3つ）
  await page.evaluate(async () => {
    const { saveSnapshot } = await import('/src/model/storage.ts')
    const report = window.__editor.getSnapshot().report
    for (const at of ['2026-10-17T16:50:00+09:00', '2026-10-18T14:30:00+09:00']) await saveSnapshot(report, new Date(at).toISOString())
  })
  await installKit(page)
  return { context, page }
}

/** 確かめ：横にはみ出していないか・案の部品が画面の外に出ていないか・文字がボタンからはみ出していないか */
const audit = (page, name) =>
  page
    .evaluate(() => {
      const bad = []
      if (document.documentElement.scrollWidth > innerWidth + 1) bad.push(`横にはみ出している（${document.documentElement.scrollWidth}px）`)
      for (const el of document.querySelectorAll('.v34-x')) {
        const r = el.getBoundingClientRect()
        if (!r.width) continue
        if (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1 || r.top < -1) bad.push(`画面の外：${el.className}`)
      }
      for (const el of document.querySelectorAll('.link-btn, .v34-link, .modal button')) {
        if (el.offsetWidth && el.scrollWidth > el.clientWidth + 1) bad.push(`文字がはみ出す：${el.textContent}`)
      }
      for (const el of document.querySelectorAll('.modal, .sheet-body, .help-body, .side')) {
        if (el.offsetHeight && el.scrollHeight > el.clientHeight + 1 && el.matches('.modal')) bad.push(`窓の中が上下に動く：${el.scrollHeight}/${el.clientHeight}`)
      }
      return bad
    })
    .then((bad) => bad.length && console.log(`  ！${name}：${bad.join(' ／ ')}`))

/** 撮る。clip：写す範囲（画面の座標。なければ画面全体） */
async function shot(page, name, clip) {
  await page.evaluate(() => document.fonts.ready)
  await sleep(300)
  await audit(page, name)
  const box = typeof clip === 'function' ? await page.evaluate(clip) : clip
  // captureBeyondViewport: false：写すときに画面の大きさを変えない
  await page.screenshot({ path: `${OUT}/${name}.png`, captureBeyondViewport: false, ...(box ? { clip: box } : {}) })
  console.log('✓', name)
}

/**
 * 写す範囲：右の欄（PC）の上の部分（高さ 456px ほど。一覧で、ボタンの字が読める大きさに出すため）。
 * セルフチェックのメーターが途中で切れるときは、そのメーターの上で切る
 */
const SIDE = () => {
  const r = document.querySelector('.side').getBoundingClientRect()
  const cut = [...document.querySelectorAll('.side .meter')].map((m) => m.getBoundingClientRect()).find((m) => m.bottom > 456)
  return { x: r.left, y: 0, width: r.width, height: cut && cut.top < 456 ? cut.top - 4 : 456 }
}
/** 写す範囲：窓（と、上に重なるブラウザの確かめの窓）のまわり */
const MODAL = () => {
  const els = [...document.querySelectorAll('.modal, .v34-native')].map((e) => e.getBoundingClientRect())
  const left = Math.max(0, Math.min(...els.map((r) => r.left)) - 28)
  const top = Math.max(0, Math.min(...els.map((r) => r.top)) - 12)
  const right = Math.min(innerWidth, Math.max(...els.map((r) => r.right)) + 28)
  const bottom = Math.min(innerHeight, Math.max(...els.map((r) => r.bottom)) + 18)
  return { x: left, y: top, width: right - left, height: bottom - top }
}
/** 写す範囲：ブラウザの確かめの窓と、その下の紙面のあたり（案B。窓を通らずに出る） */
const NATIVE_TOP = () => {
  const r = document.querySelector('.v34-native').getBoundingClientRect()
  const left = Math.max(0, r.left - 24)
  return { x: left, y: 0, width: innerWidth - left, height: 430 }
}

/** 画面の外（何もない所）にマウスを置く（ボタンの上に乗ったままにしない） */
const parkMouse = (page) => page.mouse.move(5, 760)

/** 「バックアップ」の窓を開く（本物のボタンを押す） */
async function openBackup(page) {
  await page.evaluate(() => [...document.querySelectorAll('.link-btn')].find((b) => b.textContent.includes('バックアップ') && b.offsetWidth).click())
  await page.waitForSelector('.modal .snapshots li', { timeout: 30000 })
  // マウスで押したときの見た目にする（窓の最初のボタンに、キーボードで移ったときの枠を出さない）
  await page.evaluate(() => document.activeElement?.blur())
  await sleep(300)
}
const closeBackup = async (page) => {
  await page.evaluate(() => document.querySelector('.modal .close').click())
  await sleep(300)
}

// ---- 案A：窓の「最初から作り直す」を、いちばん下の区切った所にする（ひとこと付き）。窓の名前もボタンに合わせる ----
const dialogA = (page, icon) =>
  page.evaluate((icon) => {
    const k = window.__v34
    const m = document.querySelector('.modal')
    k.swap(m.querySelector('header h2'), '<h2 class="v34-x">バックアップ・作り直す</h2>')
    k.swap(
      m.querySelector('.row-buttons'),
      `<div class="v34-x v34-sec"><h3>最初から作り直す（新しく始める）</h3><div class="row"><p>いまの原稿は自動の控えに残ります</p><button class="danger">${icon}最初から作り直す</button></div></div>`,
    )
    m.querySelector('.v34-sec').insertAdjacentHTML('afterend', '<div class="v34-x row-buttons v34-close"><span class="spacer"></span><button>閉じる</button></div>')
  }, icon)

// =====================================================================
// パソコン
// =====================================================================
async function pcShots(browser) {
  const { context, page } = await open(browser, PC)
  await parkMouse(page)
  // ---- いま ----
  await shot(page, 'pc-now-full')
  await openBackup(page)
  await parkMouse(page)
  await shot(page, 'pc-now-dialog', MODAL)
  await closeBackup(page)

  // ---- 案A：右の欄の「バックアップ・作り直す」と、窓のいちばん下の区切り ----
  await page.evaluate(() => window.__v34.relabel([...document.querySelectorAll('.side .link-btn')].find((b) => b.textContent.includes('バックアップ')), 'バックアップ・作り直す', 'v34-both'))
  await shot(page, 'pc-a-panel', SIDE)
  await page.evaluate(() => window.__v34.clear())
  await openBackup(page)
  await parkMouse(page)
  await dialogA(page, IC.restart)
  await shot(page, 'pc-a-dialog', MODAL)
  await page.evaluate((t) => window.__v34.native(t), CONFIRM_NOW)
  await shot(page, 'pc-a-confirm', MODAL)
  await page.evaluate(() => window.__v34.clear())
  await closeBackup(page)

  // ---- 案B：「バックアップ」「使い方」の下に、小さな「最初から作り直す」。押すと、すぐ確かめの窓 ----
  const linkB = () =>
    page.evaluate((icon) => {
      const head = document.querySelector('.side-head')
      // Word の読み込みのリンクがあれば、その下
      const anchor = head.querySelector('.word-link') ?? head.querySelector('.links')
      window.__v34.after(anchor, `<button class="v34-x v34-link">${icon}最初から作り直す（新しく始める）</button>`)
    }, IC.restart)
  await linkB()
  await shot(page, 'pc-b-panel', SIDE)
  // 押したところ（矢印は説明用の印）
  await page.evaluate(() => {
    const r = document.querySelector('.v34-link').getBoundingClientRect()
    window.__v34.add(`<svg class="v34-x v34-fixed v34-cursor" style="left:${r.left + r.width * 0.55}px;top:${r.top + r.height * 0.5}px" viewBox="0 0 24 24"><path d="M3 2l15 8.2-6.6 1.6L8.6 18z" fill="#fff" stroke="#23262b" stroke-width="1.4" stroke-linejoin="round"/></svg>`)
  })
  await page.evaluate((t) => window.__v34.native(t), CONFIRM_B)
  await shot(page, 'pc-b-confirm', NATIVE_TOP)
  await page.evaluate(() => window.__v34.clear())

  // ---- 案C：ボタンはそのまま。「バックアップ」に指を乗せると吹き出し ----
  await page.evaluate(() => {
    const k = window.__v34
    const b = [...document.querySelectorAll('.side .link-btn')].find((x) => x.textContent.includes('バックアップ'))
    b.classList.add('v34-hover')
    const r = b.getBoundingClientRect()
    const side = document.querySelector('.side').getBoundingClientRect()
    const tip = k.add('<div class="v34-x v34-fixed v34-tip">バックアップファイルの保存・復元<br>自動の控え・最初から作り直す</div>')
    const left = Math.max(side.left + 8, Math.min(side.right - 8 - tip.offsetWidth, r.left + r.width / 2 - tip.offsetWidth / 2))
    tip.style.left = `${left}px`
    tip.style.top = `${r.bottom + 10}px`
    tip.style.setProperty('--ax', `${r.left + r.width / 2 - left}px`)
    const x = r.left + r.width * 0.84
    const y = r.top + r.height * 0.5
    k.add(`<svg class="v34-x v34-fixed v34-cursor" style="left:${x}px;top:${y}px" viewBox="0 0 24 24"><path d="M3 2l15 8.2-6.6 1.6L8.6 18z" fill="#fff" stroke="#23262b" stroke-width="1.4" stroke-linejoin="round"/></svg>`)
  })
  await shot(page, 'pc-c-panel', SIDE)
  await page.evaluate(() => window.__v34.clear())
  // 案C：使い方で「新しく」と探したところ。いちばん上に、ひとこと
  await page.evaluate(() => document.querySelector('.side .help-btn').click())
  await page.waitForSelector('.help-search input', { timeout: 30000 })
  await page.type('.help-search input', '新しく')
  await page.waitForSelector('.help-results li', { timeout: 30000 })
  await parkMouse(page)
  await page.evaluate((icon) => {
    window.__v34.after(document.querySelector('.help-count'), `<div class="v34-x v34-quick"><b>${icon}<span>最初から作り直すときは、<br>「バックアップ」から</span></b>右の欄の「バックアップ」→「最初から作り直す」。いまの原稿は自動の控えに残ります。</div>`, true)
  }, IC.restart)
  await shot(page, 'pc-c-help', SIDE)
  await page.evaluate(() => window.__v34.clear())
  await context.close()
}

// =====================================================================
// パソコン：はじめての案内の最後（案C）
// =====================================================================
async function guideShots(browser) {
  const { context, page } = await openTool(browser, PC)
  // 学籍番号・氏名・サブタイトルを、本物の案内のとおりに入れて進む（入れて Enter で次へ）
  for (const [step, text] of [['studentId', '00ZZ0123'], ['name', '文化　花子'], ['subtitle', 'シンドバッド']]) {
    await page.waitForSelector(`.guide.step-${step}`, { timeout: 60000 })
    await page.waitForFunction(() => window.__editor.getSnapshot().editingId, { timeout: 30000 })
    await sleep(400)
    await page.keyboard.type(text)
    await sleep(200)
    await page.keyboard.press('Enter')
    await sleep(500)
  }
  await page.waitForSelector('.guide.step-done', { timeout: 60000 })
  await ready(page)
  await installKit(page)
  await parkMouse(page)
  await sleep(400)
  const TIP = () => {
    const r = document.querySelector('.g-tip').getBoundingClientRect()
    const w = 760
    const h = 460
    return { x: r.left + r.width / 2 - w / 2, y: Math.max(0, r.top + r.height / 2 - h / 2), width: w, height: h }
  }
  await page.evaluate((icon) => {
    window.__v34.after(document.querySelector('.g-tip .g-actions'), `<div class="v34-x v34-gnote">${icon}<span>最初から作り直すときは、<br>右の欄の<b>「バックアップ」</b>から。</span></div>`, true)
  }, IC.restart)
  await shot(page, 'pc-c-guide', TIP)
  await context.close()
}

// =====================================================================
// スマホ
// =====================================================================
async function phoneShots(browser) {
  const { context, page } = await open(browser, PHONE)
  const openMenu = async () => {
    await page.evaluate(() => document.querySelector('.p-top .icon-btn').click())
    await page.waitForSelector('.sheet .links', { timeout: 30000 })
    // 指で押したときの見た目にする（メニューの最初のボタンに、キーボードで移ったときの枠を出さない）
    await page.evaluate(() => document.activeElement?.blur())
    await sleep(500)
  }
  const closeSheet = async () => {
    await page.evaluate(() => document.querySelector('.sheet-close')?.click())
    await sleep(500)
  }
  // ---- いま ----
  await openMenu()
  await shot(page, 'ph-now-menu')
  // ---- 案A：メニューの「バックアップ・作り直す」 ----
  await page.evaluate(() => window.__v34.relabel([...document.querySelectorAll('.sheet .link-btn')].find((b) => b.textContent.includes('バックアップ')), 'バックアップ・作り直す', 'v34-both'))
  await shot(page, 'ph-a-menu')
  await page.evaluate(() => window.__v34.clear())
  // ---- 案B：メニューに、それだけの「最初から作り直す」 ----
  await page.evaluate((icon) => {
    const body = document.querySelector('.sheet-body')
    const anchor = body.querySelector('.word-link') ?? body.querySelector('.links')
    window.__v34.after(anchor, `<button class="v34-x v34-link">${icon}最初から作り直す（新しく始める）</button>`)
  }, IC.restart)
  await shot(page, 'ph-b-menu')
  await page.evaluate(() => window.__v34.clear())
  // ---- 案A：スマホの「バックアップ」の窓 ----
  await page.evaluate(() => [...document.querySelectorAll('.sheet .link-btn')].find((b) => b.textContent.includes('バックアップ')).click())
  await page.waitForSelector('.modal .snapshots li', { timeout: 30000 })
  await page.evaluate(() => document.activeElement?.blur())
  await sleep(400)
  await dialogA(page, IC.restart)
  await shot(page, 'ph-a-dialog')
  await page.evaluate(() => window.__v34.clear())
  await closeBackup(page)
  // ---- 案C：使い方で「新しく」と探したところ（メニューは今のまま） ----
  await openMenu()
  await page.evaluate(() => document.querySelector('.sheet .help-btn').click())
  await page.waitForSelector('.help-sheet .help-search input', { timeout: 30000 })
  await sleep(500)
  await page.type('.help-search input', '新しく')
  await page.waitForSelector('.help-results li', { timeout: 30000 })
  await page.evaluate((icon) => {
    window.__v34.after(document.querySelector('.help-count'), `<div class="v34-x v34-quick"><b>${icon}<span>最初から作り直すときは、<br>「バックアップ」から</span></b>右上のメニューの「バックアップ」→「最初から作り直す」。いまの原稿は自動の控えに残ります。</div>`, true)
  }, IC.restart)
  await page.evaluate(() => document.activeElement?.blur())
  await sleep(300)
  await shot(page, 'ph-c-help')
  await page.evaluate(() => window.__v34.clear())
  await closeSheet()
  await context.close()
}

// =====================================================================
// 一覧のページ（mockups/v34/review.html）を画像にする（shots/review-startover.png）
// =====================================================================
async function reviewShots(browser) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1300, height: 900, deviceScaleFactor: 1 })
  await page.goto(`${APP}/${DIR}/review.html`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${OUT}/review-startover.png`, fullPage: true })
  console.log('✓', 'review-startover')
  await page.close()
}

await withEdge(async (browser) => {
  if (want('pc')) await pcShots(browser)
  if (want('guide')) await guideShots(browser)
  if (want('phone')) await phoneShots(browser)
  if (want('review')) await reviewShots(browser)
})
