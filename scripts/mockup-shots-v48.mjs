// デザイン案 v48（スマホ：はじめて使う学生の試し 2026-10-21 で見つかった、見た目・動きを変えるもの）を画像に書き出す。
//   A 書くときの字が小さい（紙面の本文の幅を画面に合わせるので、字は 10px ほど）
//      いま／案1 はじめて書くとき1回だけ「2本の指で広げると、字を大きくできます」／案2 書き始めるとき 1.3 倍（横にずらしながら書く）
//   B 目次の行が押しにくく（行の高さ 11px ほど）、押すと見出しを書き始めてキーボードが出る
//      いま／案 押せる所を行の間まで広げ、押したらその見出しのページへ移って見出しを光らせる（書き始めない）
//   C 小さいスマホ（360×740）で、列の幅を「自分で決める」の表を書くと、キーボードの上の道具が3段（152px）になり、紙面が 200px ほどしか見えない
//      いま／案 3段目（「丸を左右に動かす」「同じ幅に戻す」）をやめ、表の上に一度だけ小さな知らせ。「同じ幅に戻す」は「表の形」の欄の中
//   D 上の帯の保存の時刻「06:25」が、時計に見える
//      いま／案1「保存 06:25」／案2「保存済み」（時刻は ≡ の中）
//   E キーボードの上の道具に「削除」がない（空の段落・見出しは Backspace で消せるようにした）
//      いま／案 段落・見出しを書いているとき「削除」を足す
// 本物の画面（見本の原稿）に、案の CSS と部品だけを書き足して写す（src/ は変えない）。
// 学生用ツールは、Google のログインとドライブを偽物（scripts/e2e/fakeGoogle.mjs）に差し替えて開く（本物の Google にはつながない）。
// 使い方: node scripts/mockup-shots-v48.mjs [shots] [review]（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync, writeFileSync } from 'node:fs'

process.env.EDGE_PORT ??= '9811'
const { withEdge } = await import('./poc/edge.mjs')
const { openTool, ready } = await import('./video/session.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const DIR = 'mockups/v48'
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })
const ONLY = process.argv.slice(2)
const want = (k) => ONLY.length === 0 || ONLY.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const FACTS = {}
const KB = 336
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const SMALL = { width: 360, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

/** キーボードを仮に出す（見えている所 visualViewport が低くなる）。写真には仮のキーボードの絵を重ねる */
const keyboard = (page, kb) =>
  page.evaluate((kb) => {
    if (kb) Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => window.innerHeight - kb })
    else delete window.visualViewport.height
    window.visualViewport.dispatchEvent(new Event('resize'))
    document.querySelector('#mk-kb')?.remove()
    if (!kb) return
    const k = document.createElement('div')
    k.id = 'mk-kb'
    k.textContent = 'キーボード（仮）'
    Object.assign(k.style, { position: 'fixed', left: '0', right: '0', bottom: '0', height: `${kb}px`, zIndex: '200', pointerEvents: 'none', background: '#d3d6dc', color: '#6b6f78', display: 'grid', placeItems: 'center', font: '15px sans-serif' })
    document.body.append(k)
  }, kb)

/** 紙面の要素（表に出ている方）を指で押す */
async function tapPaper(page, selector, dx = 30, dy = 4) {
  const pt = await page.evaluate((sel, dx, dy) => { const r = document.querySelector(`.page-viewport.front ${sel}`).getBoundingClientRect(); return { x: r.left + Math.min(dx, r.width / 2), y: r.top + Math.min(dy, r.height / 2) } }, selector, dx, dy)
  await page.touchscreen.tap(pt.x, pt.y)
  await sleep(900)
}
const goTo = async (page, id) => {
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), id)
  await ready(page)
  await sleep(300)
}
const stop = async (page) => {
  await page.evaluate(() => window.__editor.finishEditing())
  await keyboard(page, 0)
  await ready(page)
  await sleep(300)
}
/** 書き足す見た目（案）。消すときは null */
const style = (page, css) =>
  page.evaluate((css) => {
    document.querySelector('style[data-mk]')?.remove()
    if (!css) return
    const s = document.createElement('style')
    s.dataset.mk = ''
    s.textContent = css
    document.head.append(s)
  }, css)
const removeMk = (page) => page.evaluate(() => document.querySelectorAll('[data-mk-el]').forEach((e) => e.remove()))

/** 2本の指で、点 c を真ん中に d0 から d1 まで広げる（phoneDirect.mjs と同じ） */
async function pinch(cdp, c, d0, d1, steps = 10) {
  const at = (i) => {
    const d = d0 + ((d1 - d0) * i) / steps
    return [{ x: c.x - d / 2, y: c.y, id: 1 }, { x: c.x + d / 2, y: c.y, id: 2 }]
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) })
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(i) })
    await sleep(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await sleep(700)
}

/** 書いている字の大きさ（画面の px） */
const glyph = (page) => page.evaluate(() => { const el = document.querySelector('.overlay-editor'); const s = el ? parseFloat(getComputedStyle(el).fontSize) : 0; const k = el ? el.getBoundingClientRect().width / el.offsetWidth : 1; return Math.round(s * k * 10) / 10 })

async function shots(browser) {
  const { context, page } = await openTool(browser, { device: 'phone' })
  const cdp = await page.createCDPSession()

  // ---- A 書くときの字の大きさ ----
  await goTo(page, 'p7')
  await tapPaper(page, '[data-block-id="p7"]')
  await keyboard(page, KB)
  await sleep(400)
  FACTS.glyphNow = await glyph(page)
  await page.screenshot({ path: `${OUT}/a-now.png` })
  // 案1：はじめて書くとき1回だけの知らせ（上の帯のすぐ下）
  await page.evaluate(() => {
    const t = document.createElement('div')
    t.dataset.mkEl = ''
    t.innerHTML = '<b>字を大きくするには</b><span>2本の指で広げます（次からも、その大きさで書けます）</span><i>×</i>'
    Object.assign(t.style, { position: 'fixed', left: '12px', right: '12px', top: '58px', zIndex: '60', display: 'grid', gridTemplateColumns: '1fr auto', gap: '2px 10px', padding: '10px 12px 11px 14px', borderRadius: '12px', background: '#2f3e75', color: '#fff', font: '14px "BIZ UDPGothic", sans-serif', lineHeight: '1.5', boxShadow: '0 8px 24px rgba(30,25,20,.25)' })
    t.querySelector('b').style.gridColumn = '1'
    t.querySelector('span').style.cssText = 'grid-column:1;font-size:13px;opacity:.9'
    t.querySelector('i').style.cssText = 'grid-row:1 / span 2;grid-column:2;align-self:center;font-style:normal;font-size:18px;opacity:.8'
    document.body.append(t)
  })
  await page.screenshot({ path: `${OUT}/a-1.png` })
  await removeMk(page)
  // 案2：1.3 倍（2本の指で広げたのと同じ大きさ）
  const mid = await page.evaluate(() => { const r = document.querySelector('.overlay-editor').getBoundingClientRect(); return { x: 195, y: Math.max(150, Math.min(380, r.top + 20)) } })
  await pinch(cdp, mid, 120, 156)
  await page.evaluate(() => window.__editor.overlay.setCaret(40))
  await sleep(500)
  FACTS.glyph13 = await glyph(page)
  await page.screenshot({ path: `${OUT}/a-2.png` })
  await stop(page)
  // 大きさの覚えを消す（このあとの写真のため）
  await page.evaluate(() => { try { for (const k of Object.keys(localStorage)) if (/zoom|pinch|scale/i.test(k)) localStorage.removeItem(k) } catch {} })

  // ---- B 目次の行 ----
  await page.evaluate(() => window.__editor.goToPage(window.__editor.getSnapshot().layout.kinds.indexOf('toc'), 'none'))
  await ready(page)
  await sleep(400)
  const rows = await page.evaluate(() => [...document.querySelectorAll('.page-viewport.front [data-toc-target]')].map((e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: Math.round(r.height * 10) / 10 } }))
  FACTS.tocRowH = rows.map((r) => r.h)
  // いま：行を押すと、見出しを書き始めてキーボードが出る
  const first = rows[0]
  await page.touchscreen.tap(first.left + 20, (first.top + first.bottom) / 2)
  await sleep(1200)
  await ready(page)
  await keyboard(page, KB)
  await sleep(400)
  FACTS.tocTapEditing = await page.evaluate(() => window.__editor.getSnapshot().editingKind)
  await page.screenshot({ path: `${OUT}/b-now.png` })
  await stop(page)
  // 案：押せる所（行の間まで）を見せる
  await page.evaluate(() => window.__editor.goToPage(window.__editor.getSnapshot().layout.kinds.indexOf('toc'), 'none'))
  await ready(page)
  await sleep(400)
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.page-viewport.front [data-toc-target]')].map((e) => e.getBoundingClientRect())
    rows.forEach((r, i) => {
      const prev = rows[i - 1]
      const next = rows[i + 1]
      const top = prev ? (prev.bottom + r.top) / 2 : r.top - 6
      const bottom = next ? (r.bottom + next.top) / 2 : r.bottom + 6
      const b = document.createElement('div')
      b.dataset.mkEl = ''
      Object.assign(b.style, { position: 'fixed', left: `${r.left - 6}px`, width: `${r.right - r.left + 12}px`, top: `${top}px`, height: `${bottom - top}px`, zIndex: '40', border: '1.5px dashed #2f3e75', borderRadius: '4px', background: i % 2 ? 'rgba(47,62,117,.06)' : 'rgba(47,62,117,.12)', pointerEvents: 'none' })
      document.body.append(b)
    })
  })
  FACTS.tocZoneH = await page.evaluate(() => [...document.querySelectorAll('[data-mk-el]')].map((b) => Math.round(parseFloat(b.style.height))))
  await page.screenshot({ path: `${OUT}/b-1a.png` })
  await removeMk(page)
  // 案：押すと、その見出しのページへ移り、見出しを少しの間光らせる（書き始めない）
  const target = await page.evaluate(() => document.querySelector('.page-viewport.front [data-toc-target]').getAttribute('data-toc-target'))
  await page.evaluate((t) => {
    const ed = window.__editor
    const chapter = ed.getSnapshot().report.body.find((c) => t.includes(c.id)) ?? ed.getSnapshot().report.body[0]
    ed.goToPage(ed.pageOfBlock(chapter.id), 'none')
  }, target)
  await ready(page)
  await sleep(400)
  await page.evaluate(() => {
    const h = document.querySelector('.page-viewport.front h1.chapter')
    const r = h.getBoundingClientRect()
    const b = document.createElement('div')
    b.dataset.mkEl = ''
    Object.assign(b.style, { position: 'fixed', left: `${r.left - 4}px`, top: `${r.top - 3}px`, width: `${r.width + 8}px`, height: `${r.height + 6}px`, zIndex: '40', borderRadius: '4px', background: 'rgba(255, 214, 102, .45)', boxShadow: '0 0 0 2px rgba(240, 180, 40, .8)', pointerEvents: 'none' })
    document.body.append(b)
  })
  await page.screenshot({ path: `${OUT}/b-1b.png` })
  await removeMk(page)

  // ---- C 小さいスマホ（360×740）で、自分で決めた列の幅の表を書く ----
  await page.setViewport(SMALL)
  await sleep(600)
  await ready(page)
  await page.evaluate(() => {
    const ed = window.__editor
    const t = ed.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === 't1')
    ed.setTableWidths('t1', 'custom')
    ed.goToPage(ed.pageOfBlock(t.rows[1].cells[0].id), 'none')
  })
  await ready(page)
  await sleep(400)
  const cell = await page.evaluate(() => window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === 't1').rows[1].cells[1].id)
  await tapPaper(page, `[data-cell-id="${cell}"]`, 40, 20)
  await keyboard(page, KB)
  await sleep(500)
  FACTS.smallBar = await page.evaluate(() => { const b = document.querySelector('.direct-bar').getBoundingClientRect(); return { barH: Math.round(b.height), paper: Math.round(b.top - 48) } })
  await page.screenshot({ path: `${OUT}/c-now.png` })
  await style(page, '.direct-bar .db-colw { display: none !important; }')
  await sleep(300)
  await page.evaluate(() => {
    const t = document.querySelector('.page-viewport.front .data-table[data-table-id="t1"] table').getBoundingClientRect()
    const c = document.createElement('div')
    c.dataset.mkEl = ''
    c.textContent = '丸を左右に動かすと、列の幅が変わります'
    Object.assign(c.style, { position: 'fixed', left: '12px', right: '12px', top: `${Math.max(56, t.top - 40)}px`, zIndex: '45', padding: '7px 12px', borderRadius: '10px', background: '#2f3e75', color: '#fff', font: '13px "BIZ UDPGothic", sans-serif', textAlign: 'center', boxShadow: '0 6px 16px rgba(30,25,20,.2)' })
    document.body.append(c)
  })
  FACTS.smallBarFixed = await page.evaluate(() => { const b = document.querySelector('.direct-bar').getBoundingClientRect(); return { barH: Math.round(b.height), paper: Math.round(b.top - 48) } })
  await page.screenshot({ path: `${OUT}/c-1.png` })
  await removeMk(page)
  await style(page, null)
  await stop(page)
  await page.evaluate(() => window.__editor.undo())
  await ready(page)

  // ---- D 上の帯の保存の時刻 ----
  for (const [name, vp] of [['390', PHONE], ['360', SMALL]]) {
    await page.setViewport(vp)
    await sleep(500)
    await ready(page)
    const clip = { x: 0, y: 0, width: vp.width, height: 56 }
    const chip = '.p-top .chip, .p-top .drive-chip, .p-top [role="status"]'
    const original = await page.evaluate((sel) => document.querySelector(sel)?.innerHTML ?? '', chip)
    await page.screenshot({ path: `${OUT}/d-now-${name}.png`, clip, captureBeyondViewport: false })
    for (const [k, text] of [['1', '保存 '], ['2', '保存済み']]) {
      await page.evaluate((sel, text, k) => {
        const el = document.querySelector(sel)
        const nodes = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim())
        const last = nodes.at(-1)
        if (k === '1') last.textContent = text + last.textContent.trim()
        else last.textContent = text
      }, chip, text, k)
      await sleep(150)
      FACTS[`d${k}-${name}`] = await page.evaluate(() => { const h = document.querySelector('.p-top').getBoundingClientRect(); const over = [...document.querySelectorAll('.p-top > *')].some((e) => e.getBoundingClientRect().right > h.right + 1); return { over } })
      await page.screenshot({ path: `${OUT}/d-${k}-${name}.png`, clip, captureBeyondViewport: false })
      await page.evaluate((sel, html) => { document.querySelector(sel).innerHTML = html }, chip, original)
    }
  }

  // ---- E キーボードの上の道具に「削除」 ----
  await page.setViewport(SMALL)
  await sleep(500)
  await ready(page)
  await goTo(page, 'p7')
  await tapPaper(page, '[data-block-id="p7"]')
  await keyboard(page, KB)
  await sleep(400)
  const barClip = await page.evaluate(() => { const b = document.querySelector('.direct-bar').getBoundingClientRect(); return { x: 0, y: Math.round(b.top) - 4, width: innerWidth, height: Math.round(b.height) + 8 } })
  await page.screenshot({ path: `${OUT}/e-now.png`, clip: barClip, captureBeyondViewport: false })
  await page.evaluate(() => {
    const row = document.querySelector('.direct-bar .db-row')
    const done = row.querySelector('.db-done')
    const b = document.createElement('button')
    b.dataset.mkEl = ''
    b.className = 'danger'
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M10 7V5.5h4V7M7 7l.9 12h8.2L17 7"/></svg><span>削除</span>'
    done.before(b)
  })
  FACTS.deleteFits = await page.evaluate(() => { const row = document.querySelector('.direct-bar .db-row'); return row.scrollWidth <= row.clientWidth + 1 })
  await page.screenshot({ path: `${OUT}/e-1.png`, clip: barClip, captureBeyondViewport: false })
  await removeMk(page)
  await stop(page)

  writeFileSync(`${OUT}/facts.json`, JSON.stringify(FACTS, null, 2))
  console.log(JSON.stringify(FACTS))
  await context.close()
}

/** 一覧のページ（mockups/v48/review.html）を1枚の画像にする */
async function reviewShots(browser) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 1.25 })
  await page.goto(`${APP}/${DIR}/review.html`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${OUT}/review-phone.png`, fullPage: true })
  console.log('✓ review-phone')
  await context.close()
}

await withEdge(async (browser) => {
  if (want('shots')) await shots(browser)
  if (want('review')) await reviewShots(browser)
})
