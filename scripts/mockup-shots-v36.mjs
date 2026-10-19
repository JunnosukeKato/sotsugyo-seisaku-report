// デザイン案 v36（1つ：紙面で段落をまたいで選んだときの「コピー」「切り取り」「削除」「貼り付け」のボタンの置き場所）を画像に書き出す。
// 本物の学生用ツール（開発サーバーの /?nodrive。ログインなし）を開き、見本の原稿（scripts/e2e/sampleReport.mjs の setupWriting）を入れて、
// 紙面を本当にマウスでなぞって選び（選んだ所の色は本物）、案ごとにボタンを書き足して写す（src/ は変えない）。
// できるもの：mockups/v36/shots/*.png（案の画面）と、shots/review-selection.png（mockups/v36/review.html を写したもの）
// 使い方: node scripts/mockup-shots-v36.mjs [shots] [review]（何も付けなければ全部。開発サーバーが http://localhost:5173 で動いていること）
//   Edge は EDGE_PORT（ふだんは 9722）で起動する
import { mkdirSync } from 'node:fs'

process.env.EDGE_PORT ??= '9722'
const { withEdge } = await import('./poc/edge.mjs')
const { stubConfig } = await import('./e2e/configStub.mjs')
const { setupWriting } = await import('./e2e/sampleReport.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const DIR = 'mockups/v36'
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })
const ONLY = process.argv.slice(2)
const want = (k) => ONLY.length === 0 || ONLY.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PC = { width: 1366, height: 768, deviceScaleFactor: 1.5 }

// ---- アイコン（src/app/icons.tsx と同じ線） ----
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const IC = {
  /** コピー（紙が2枚重なる） */
  copy: svg('<rect x="8.5" y="8.5" width="11" height="11.5" rx="1.6"/><path d="M15.5 8.5V5.6A1.6 1.6 0 0013.9 4H5.6A1.6 1.6 0 004 5.6v8.3a1.6 1.6 0 001.6 1.6h2.9"/>'),
  /** 切り取り（はさみ） */
  cut: svg('<circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><path d="M8.3 15.7L18 4.5M15.7 15.7L6 4.5"/>'),
  /** 削除（ごみ箱。src/app/icons.tsx の remove） */
  remove: svg('<path d="M5 7h14M10 7V5.5h4V7M7 7l.9 12h8.2L17 7"/>'),
  /** 貼り付け（クリップボード） */
  paste: svg('<path d="M9 5H7.2A1.7 1.7 0 005.5 6.7v12.6A1.7 1.7 0 007.2 21h9.6a1.7 1.7 0 001.7-1.7V6.7A1.7 1.7 0 0016.8 5H15"/><rect x="9" y="3.5" width="6" height="3" rx="1"/><path d="M9 12h6M9 15.5h4"/>'),
}
/** 説明用の矢印（マウスのカーソル） */
const CURSOR = '<path d="M3 2l15 8.2-6.6 1.6L8.6 18z" fill="#fff" stroke="#23262b" stroke-width="1.4" stroke-linejoin="round"/>'

/** 案の部品の見た目。色と書体は src/tokens.css・src/index.css のもの */
const CSS = `
  .v36-x { font-family: 'BIZ UDPGothic', sans-serif; box-sizing: border-box; }
  .v36-x * { box-sizing: border-box; }
  .v36-fixed { position: fixed; z-index: 60; }
  [data-v36-hidden] { display: none !important; }
  .v36-cursor { width: 22px; height: 22px; z-index: 62; pointer-events: none; }
  .v36-tip { padding: 6px 10px; border-radius: 7px; background: #2b2e36; color: #fff; font-size: 12px; line-height: 1.5; white-space: nowrap; box-shadow: 0 6px 16px rgba(20, 20, 30, 0.25); }

  /* ===== 案A：選んだ所のすぐ上に、小さな帯 ===== */
  .v36-bar { display: flex; gap: 2px; padding: 4px; background: #fff; border: 1px solid var(--palette-line); border-radius: 11px; box-shadow: 0 8px 24px rgba(30, 25, 20, 0.18); }
  .v36-bar button { display: flex; align-items: center; gap: 5px; border: 0; background: none; border-radius: 8px; padding: 7px 11px 7px 9px; font: inherit; font-size: 13px; color: var(--ink); white-space: nowrap; }
  .v36-bar button svg { width: 17px; height: 17px; }
  .v36-bar button.danger { color: var(--error); }
  .v36-bar button.hover { background: var(--palette-hover); color: var(--accent); }
  .v36-bar .sep { width: 1px; margin: 5px 2px; background: var(--line); }
  /* 帯の下の小さな三角（選んだ所を指す） */
  .v36-bar::after { content: ''; position: absolute; left: var(--ax, 28px); bottom: -6px; width: 10px; height: 10px; margin-left: -5px; background: #fff; border-right: 1px solid var(--palette-line); border-bottom: 1px solid var(--palette-line); transform: rotate(45deg); }

  /* ===== 案B：左の道具に「選んだ文」 ===== */
  .palette .group.ctx.v36-x .tb.hover { background: rgba(255, 255, 255, 0.75); color: var(--accent); }

  /* ===== 案C：右クリックのメニュー ===== */
  .v36-menu { min-width: 196px; padding: 5px; background: #fff; border: 1px solid var(--palette-line); border-radius: 10px; box-shadow: 0 10px 28px rgba(30, 25, 20, 0.2); }
  .v36-menu button { display: flex; align-items: center; gap: 9px; width: 100%; border: 0; background: none; border-radius: 7px; padding: 8px 10px; font: inherit; font-size: 13px; color: var(--ink); text-align: left; }
  .v36-menu button svg { width: 17px; height: 17px; flex: none; }
  .v36-menu button kbd { margin-left: auto; font: inherit; font-size: 11.5px; color: var(--muted); }
  .v36-menu button.danger { color: var(--error); }
  .v36-menu button.hover { background: var(--palette-hover); color: var(--accent); }
  .v36-menu button:disabled { opacity: 0.38; }
  .v36-menu .sep { height: 1px; margin: 4px 6px; background: var(--line); }
`

/** ページの中で使う道具（部品を足す・隠す・元に戻す） */
async function installKit(page) {
  await page.evaluate((css) => {
    const style = document.createElement('style')
    style.id = 'v36-style'
    style.textContent = css
    document.head.append(style)
    window.__v36 = {
      add(html) {
        document.body.insertAdjacentHTML('beforeend', html)
        return document.body.lastElementChild
      },
      after(el, html, before = false) {
        el.insertAdjacentHTML(before ? 'beforebegin' : 'afterend', html)
        return before ? el.previousElementSibling : el.nextElementSibling
      },
      hide(el) {
        el?.setAttribute('data-v36-hidden', '')
      },
      cursor(x, y) {
        return this.add(`<svg class="v36-x v36-fixed v36-cursor" style="left:${x - 3}px;top:${y - 2}px" viewBox="0 0 24 24">${window.__v36CursorPath}</svg>`)
      },
      /** 選んでいる所の、見えている行の四角（上から順） */
      lines() {
        const sel = getSelection()
        if (!sel.rangeCount) return []
        const rects = [...sel.getRangeAt(0).getClientRects()].filter((r) => r.width > 2 && r.height > 4)
        const page = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current')?.getBoundingClientRect()
        return rects.filter((r) => !page || (r.top >= page.top && r.bottom <= page.bottom && r.left >= page.left && r.right <= page.right))
      },
      clear() {
        document.querySelectorAll('.v36-x').forEach((e) => e.remove())
        document.querySelectorAll('[data-v36-hidden]').forEach((e) => e.removeAttribute('data-v36-hidden'))
      },
    }
  }, CSS)
  await page.evaluate((p) => (window.__v36CursorPath = p), CURSOR)
}

const ready = (page) =>
  page.waitForFunction(() => {
    const s = window.__editor?.getSnapshot()
    return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading')
  }, { timeout: 120000 })

/** 学生用ツールを開き、見本の原稿にする */
async function openSample(browser, vp) {
  const context = await browser.createBrowserContext()
  await context.overridePermissions(APP, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'])
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  page.on('dialog', (d) => d.dismiss())
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
  await page.setViewport(vp)
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0', timeout: 90000 })
  await page.waitForSelector('.guide.step-course .g-opts button', { timeout: 60000 })
  await page.evaluate(() => [...document.querySelectorAll('.guide .g-opts button')].find((b) => b.textContent.includes('映画・舞台衣装')).click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no', { timeout: 60000 })
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.guide .g-later', { timeout: 60000 })
  await page.evaluate(() => document.querySelector('.guide .g-later').click())
  await page.evaluate(() => window.__editor.finishEditing())
  await ready(page)
  await page.evaluate(setupWriting)
  await sleep(500)
  await ready(page)
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, studentId: '00ZZ0123' } })))
  await sleep(300)
  await ready(page)
  await installKit(page)
  return { context, page }
}

/** 紙面の欄 id の offset 文字目の点 */
const charPoint = (page, id, offset) =>
  page.evaluate(
    (id, offset) => {
      let acc = 0
      for (const el of document.querySelectorAll(`.page-viewport.front [data-block-id="${id}"]`)) {
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        while (w.nextNode()) {
          const n = w.currentNode
          if (offset < acc + n.length) {
            const r = document.createRange()
            r.setStart(n, offset - acc)
            r.setEnd(n, offset - acc + 1)
            const b = [...r.getClientRects()].find((x) => x.width > 0)
            return { x: b.left + Math.min(2, b.width / 3), y: b.top + b.height / 2 }
          }
          acc += n.length
        }
      }
      return null
    },
    id,
    offset,
  )

/** 本当にマウスでなぞって選ぶ（p3 の途中から、図1 を通って、p4 の途中まで） */
async function selectRange(page) {
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('p3'), 'none'))
  await ready(page)
  await sleep(200)
  const from = await charPoint(page, 'p3', 5)
  const to = await charPoint(page, 'p4', 10)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 })
  await page.mouse.move(to.x, to.y, { steps: 6 })
  await page.mouse.up()
  await sleep(250)
  return to
}

/** コピーして、p13 の途中で書く欄を開く（貼り付けるところ） */
async function openPasteTarget(page) {
  await page.keyboard.down('Control')
  await page.keyboard.press('c')
  await page.keyboard.up('Control')
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('p13'), 'none'))
  await ready(page)
  await sleep(200)
  const at = await charPoint(page, 'p13', 6)
  await page.mouse.click(at.x, at.y)
  await sleep(400)
  return at
}

async function shot(page, name, clip) {
  await page.evaluate(() => document.fonts.ready)
  await sleep(250)
  const box = typeof clip === 'function' ? await page.evaluate(clip) : clip
  await page.screenshot({ path: `${OUT}/${name}.png`, captureBeyondViewport: false, ...(box ? { clip: box } : {}) })
  console.log('✓', name)
}

/** 写す範囲：紙面と左の道具（全体の表示の、ページのまわり） */
const PAPER = () => {
  const p = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current').getBoundingClientRect()
  const pal = document.querySelector('.palette').getBoundingClientRect()
  const left = Math.max(0, pal.left - 10)
  return { x: left, y: 0, width: Math.min(innerWidth, p.right + 10) - left, height: innerHeight }
}
/** 写す範囲：選んだ所（書く欄）・案の部品・左の道具の案の部品のまわり（近くで） */
const NEAR = () => {
  const p = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current').getBoundingClientRect()
  const pal = document.querySelector('.palette').getBoundingClientRect()
  const sel = getSelection().rangeCount ? [...getSelection().getRangeAt(0).getClientRects()].filter((r) => r.width > 2 && r.top >= p.top && r.bottom <= p.bottom) : []
  const parts = [...document.querySelectorAll('.v36-x, .overlay-clip:not([hidden]) .overlay-editor')].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0)
  const boxes = [...sel, ...parts]
  const top = Math.max(0, Math.min(...boxes.map((r) => r.top)) - 40)
  const bottom = Math.min(innerHeight, Math.max(...boxes.map((r) => r.bottom)) + 70)
  const left = Math.max(0, pal.left - 10)
  return { x: left, y: top, width: Math.min(innerWidth, p.right + 10) - left, height: bottom - top }
}

async function selectionShots(browser) {
  const { context, page } = await openSample(browser, PC)
  // ---- いま（ボタンなし。選んだ所の色だけ。Ctrl+C・Ctrl+X・Delete・Ctrl+V で操作する） ----
  const end = await selectRange(page)
  await page.mouse.move(end.x + 30, end.y + 40)
  await shot(page, 'sel-now', PAPER)
  await shot(page, 'sel-now-near', NEAR)

  // ---- 案A：選んだ所のすぐ上に、小さな帯（コピー・切り取り・削除） ----
  await page.evaluate((IC) => {
    const k = window.__v36
    const first = k.lines()[0]
    const bar = k.add(`<div class="v36-x v36-fixed v36-bar" role="toolbar"><button>${IC.copy}コピー</button><button class="hover">${IC.cut}切り取り</button><span class="sep"></span><button class="danger">${IC.remove}削除</button></div>`)
    const page = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current').getBoundingClientRect()
    const left = Math.max(page.left + 8, Math.min(first.left - 14, page.right - bar.offsetWidth - 8))
    bar.style.left = `${left}px`
    bar.style.top = `${first.top - bar.offsetHeight - 10}px`
    bar.style.setProperty('--ax', `${first.left + 8 - left}px`)
    const b = bar.querySelector('.hover').getBoundingClientRect()
    k.cursor(b.left + b.width * 0.6, b.top + b.height * 0.55)
  }, IC)
  await shot(page, 'sel-a', PAPER)
  await shot(page, 'sel-a-near', NEAR)
  await page.evaluate(() => window.__v36.clear())

  // ---- 案B：左の道具に「選んだ文」（図・表を選んだときの「この図」「この表」と同じ所） ----
  await page.evaluate((IC) => {
    const k = window.__v36
    const pal = document.querySelector('.palette')
    const undo = pal.querySelector('.group.undo-redo')
    k.after(undo, `<div class="v36-x group ctx"><div class="ctx-label">選んだ文</div><button class="tb">${IC.copy}<span>コピー</span></button><button class="tb hover">${IC.cut}<span>切り取り</span></button><button class="tb danger">${IC.remove}<span>削除</span></button></div>`, true)
    const b = pal.querySelector('.v36-x .tb.hover').getBoundingClientRect()
    const tip = k.add('<div class="v36-x v36-fixed v36-tip">選んだ文と図を切り取る（Ctrl+X）<br>書く欄で貼り付けると、そこへ動きます</div>')
    tip.style.left = `${b.right + 10}px`
    tip.style.top = `${b.top + b.height / 2 - tip.offsetHeight / 2}px`
    k.cursor(b.left + b.width * 0.62, b.top + b.height * 0.42)
  }, IC)
  await shot(page, 'sel-b', PAPER)
  await shot(page, 'sel-b-near', NEAR)
  await page.evaluate(() => window.__v36.clear())

  // ---- 案C：右クリックのメニュー ----
  await page.evaluate(
    ({ IC, x, y }) => {
      const k = window.__v36
      const menu = k.add(`<div class="v36-x v36-fixed v36-menu" role="menu"><button>${IC.copy}コピー<kbd>Ctrl+C</kbd></button><button class="hover">${IC.cut}切り取り<kbd>Ctrl+X</kbd></button><button disabled>${IC.paste}貼り付け<kbd>Ctrl+V</kbd></button><div class="sep"></div><button class="danger">${IC.remove}削除<kbd>Delete</kbd></button></div>`)
      menu.style.left = `${x + 4}px`
      menu.style.top = `${y + 6}px`
      const b = menu.querySelector('.hover').getBoundingClientRect()
      k.cursor(b.left + 40, b.top + b.height * 0.55)
    },
    { IC, x: end.x, y: end.y },
  )
  await shot(page, 'sel-c', PAPER)
  await shot(page, 'sel-c-near', NEAR)
  await page.evaluate(() => window.__v36.clear())

  // ---- 貼り付けるとき（コピーしたあと、書く欄を開いた） ----
  const at = await openPasteTarget(page)
  await page.mouse.move(at.x + 40, at.y + 60)
  await shot(page, 'paste-now', NEAR)
  // 案A：書く欄のカーソルの上に「貼り付け」
  await page.evaluate((IC) => {
    const k = window.__v36
    // カーソルのすぐ前の文字の右端（カーソルの位置）
    const ed = document.querySelector('.overlay-clip:not([hidden]) .overlay-editor')
    const caret = window.__editor.overlay.selectionOffsets().start
    const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT)
    let acc = 0
    let r = ed.getBoundingClientRect()
    while (w.nextNode()) {
      const n = w.currentNode
      if (caret - 1 < acc + n.length) {
        const range = document.createRange()
        range.setStart(n, caret - 1 - acc)
        range.setEnd(n, caret - acc)
        const c = range.getClientRects()[0]
        r = { left: c.right, top: c.top }
        break
      }
      acc += n.length
    }
    const bar = k.add(`<div class="v36-x v36-fixed v36-bar" role="toolbar"><button class="hover">${IC.paste}貼り付け</button></div>`)
    bar.style.left = `${r.left - 22}px`
    bar.style.top = `${r.top - bar.offsetHeight - 10}px`
    bar.style.setProperty('--ax', '22px')
    const b = bar.querySelector('.hover').getBoundingClientRect()
    k.cursor(b.left + b.width * 0.6, b.top + b.height * 0.55)
  }, IC)
  await shot(page, 'paste-a', NEAR)
  await page.evaluate(() => window.__v36.clear())
  // 案B：左の道具の「この段落」に「貼り付け」
  await page.evaluate((IC) => {
    const k = window.__v36
    const ctx = [...document.querySelectorAll('.palette .group.ctx')].find((g) => g.textContent.includes('この段落'))
    const del = ctx.querySelector('.tb')
    const btn = k.after(del, `<button class="v36-x tb hover">${IC.paste}<span>貼り付け</span></button>`, true)
    const b = btn.getBoundingClientRect()
    const tip = k.add('<div class="v36-x v36-fixed v36-tip">コピーした文と図を、ここに入れる（Ctrl+V）</div>')
    tip.style.left = `${b.right + 10}px`
    tip.style.top = `${b.top + b.height / 2 - tip.offsetHeight / 2}px`
    k.cursor(b.left + b.width * 0.62, b.top + b.height * 0.42)
  }, IC)
  await shot(page, 'paste-b', NEAR)
  await page.evaluate(() => window.__v36.clear())
  // 案C：書く欄で右クリック
  await page.evaluate(
    ({ IC, x, y }) => {
      const k = window.__v36
      const menu = k.add(`<div class="v36-x v36-fixed v36-menu" role="menu"><button disabled>${IC.copy}コピー<kbd>Ctrl+C</kbd></button><button disabled>${IC.cut}切り取り<kbd>Ctrl+X</kbd></button><button class="hover">${IC.paste}貼り付け<kbd>Ctrl+V</kbd></button></div>`)
      menu.style.left = `${x + 4}px`
      menu.style.top = `${y + 6}px`
      const b = menu.querySelector('.hover').getBoundingClientRect()
      k.cursor(b.left + 40, b.top + b.height * 0.55)
    },
    { IC, x: at.x, y: at.y },
  )
  await shot(page, 'paste-c', NEAR)
  await page.evaluate(() => window.__v36.clear())
  await context.close()
}

// 一覧のページ（mockups/v36/review.html）を画像にする（shots/review-selection.png）
async function reviewShots(browser) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1420, height: 900, deviceScaleFactor: 1 })
  await page.goto(`${APP}/${DIR}/review.html`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  const el = await page.$('#selection')
  await el.screenshot({ path: `${OUT}/review-selection.png` })
  console.log('✓ review-selection')
  await page.close()
}

await withEdge(async (browser) => {
  if (want('shots')) await selectionShots(browser)
  if (want('review')) await reviewShots(browser)
})
