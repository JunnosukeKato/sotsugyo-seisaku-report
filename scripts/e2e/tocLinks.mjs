// 目次のページが自動だと分かるように（mockups/v41 案C＋案B：依頼者の判断）を確かめる（Edge を自動で操作する。パソコンは smoke.mjs、スマホは phone.mjs から呼ぶ。
// node scripts/e2e/tocLinks.mjs で、これだけでも動く）。画面の写真は poc-output/v41-impl/ に置く（1366×768 のパソコンと、390×844 のスマホ）。
// - 目次の行を押すと、その見出しのページへ移り、見出しを書き始める（同じ名前の見出しが2つあっても、押した行の見出し）。画面の下に「この見出しを直すと、目次も変わります」
// - パソコン：行にマウスを乗せると、見出しに下線と「→ 見出しへ」。行はキーボードで移れて、Enter で同じことをする
// - 行のない所を押すと、押した所の近くに「目次は自動です」の知らせ。×・Esc・外を押すと閉じる。「本文の見出しへ」で、本文の最初の大見出しへ
// - 左の道具の上：「本文の／見出しから／自動で／作ります」「直すときは、／目次の行を／クリック」。ページの一覧：「目次（自動）」。
//   スマホの帯：「目次は、本文の見出しから自動で作ります」「目次の行をタップすると、その見出しへ移ります」。どれも1字だけの行がない
// - PDF（紙面の絵）は変わらない：行にマウスを乗せても・知らせを出していても、目次のページの絵は同じ。新しく足した印（行き先・Tab の印）を外しても同じ
// - ページ送り（ホイール・→・下のページ送り・指ではらう）は、目次のページでも今までどおり。指ではらっても、行へ移ったり知らせが出たりしない
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { stubConfig } from './configStub.mjs'
import { setupWriting } from './sampleReport.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/v41-impl'
mkdirSync(OUT, { recursive: true })
const pause = (ms = 400) => new Promise((r) => setTimeout(r, ms))
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const PC = { width: 1366, height: 768, deviceScaleFactor: 1 }
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const JUMPED = 'この見出しを直すと、目次も変わります'

/** 確かめている途中に src/ が直されても、画面が入れ替わらないようにする（smoke.mjs と同じ） */
const noHotReload = (page) =>
  page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
  })

/**
 * 見本の原稿（指摘0件）に、同じ名前の見出し（大見出し「制作過程」が2つ・小見出し「パターンと仮縫い」が2つ）と、引用・参考文献を足して開く。vp：画面の大きさ
 */
async function openSample(browser, vp) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await noHotReload(page)
  await stubConfig(page)
  page.on('pageerror', (e) => console.log('pageerror(toc-links):', e.message))
  page.on('dialog', (d) => d.dismiss())
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  })
  if (vp.isMobile) await page.setUserAgent(UA_IPHONE)
  await page.setViewport(vp)
  await page.goto(`${APP}/?nodrive&direct=0`, { waitUntil: 'networkidle0', timeout: 90000 })
  const ready = () =>
    page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 60000 })
  await ready()
  await page.waitForSelector('.guide.step-course .g-opts button')
  await page.evaluate(() => [...document.querySelectorAll('.guide .g-opts button')].find((b) => b.textContent.includes('映画・舞台衣装')).click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.g-later')
  await page.evaluate(() => document.querySelector('.g-later').click())
  await page.evaluate(() => window.__editor.finishEditing())
  await ready()
  await page.evaluate(setupWriting)
  await pause(600)
  await ready()
  await page.evaluate(() =>
    window.__editor.update((r) => ({
      ...r,
      basicInfo: { ...r.basicInfo, studentId: '00ZZ0941' },
      body: r.body.map((c) => (c.id === 'c3' ? { ...c, title: '制作過程', blocks: [{ type: 'subheading', id: 's8', title: 'パターンと仮縫い' }, ...c.blocks] } : c)),
      references: [{ type: 'book', id: 'r1', author: '文化花子', title: '舞台衣装の作り方', publisher: '文化出版局', year: '2020', pages: '17-24' }],
    })),
  )
  await pause(800)
  await ready()
  return { context, page, ready }
}

const snap = (page) => page.evaluate(() => { const s = window.__editor.getSnapshot(); return { page: s.page, editingId: s.editingId, kind: s.layout.kinds[s.page] } })

/** 目次のページを出す（書いている欄は閉じる） */
async function showToc(page, ready) {
  await page.evaluate(() => window.__editor.finishEditing())
  await page.evaluate(() => window.__editor.goToPage(window.__editor.getSnapshot().layout.kinds.indexOf('toc'), 'none'))
  await ready()
  await pause(400)
}

/** 目次の行（行き先の ID）の、見出しの字の真ん中（画面の座標）。dy：上下にずらす */
const linePoint = (page, id, dy = 0) =>
  page.evaluate(
    (id, dy) => {
      const cur = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current') ?? window.__editor.pageElements()[window.__editor.getSnapshot().page]
      const line = cur.querySelector(`[data-toc-target="${id}"]`)
      const r = line.querySelector('span').getBoundingClientRect()
      const lr = line.getBoundingClientRect()
      return { x: Math.round(r.left + Math.min(r.width / 2, 40)), y: Math.round((dy > 0 ? lr.bottom : lr.top + lr.height / 2) + dy) }
    },
    id,
    dy,
  )

/** 目次のページの、行のない所（目次の下の白い所）の点 */
const emptyPoint = (page) =>
  page.evaluate(() => {
    const cur = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current') ?? window.__editor.pageElements()[window.__editor.getSnapshot().page]
    const r = cur.getBoundingClientRect()
    const last = [...cur.querySelectorAll('[data-toc-target]')].at(-1).getBoundingClientRect()
    return { x: Math.round(r.left + r.width * 0.45), y: Math.round(Math.min(r.bottom - 30, last.bottom + (r.bottom - last.bottom) * 0.3)) }
  })

/** 文が画面で何行に分かれたか（行ごとの字）。1字だけの行を見つけるのに使う */
const linesOf = (page, selector) =>
  page.evaluate((selector) => {
    const el = document.querySelector(selector)
    if (!el) return null
    const out = []
    let top = null
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      for (let i = 0; i < n.nodeValue.length; i++) {
        if (/\s/.test(n.nodeValue[i])) continue
        const range = document.createRange()
        range.setStart(n, i)
        range.setEnd(n, i + 1)
        const r = range.getClientRects()[0]
        if (!r) continue
        if (top === null || Math.abs(r.top - top) > r.height / 2) {
          out.push('')
          top = r.top
        }
        out[out.length - 1] += n.nodeValue[i]
      }
    }
    return out
  }, selector)
const noLoneChar = (lines) => !!lines && !(lines.length > 1 && lines.some((l) => [...l].length === 1))

/** 知らせ（行のない所を押したとき）のようす */
const tocNotice = (page) =>
  page.evaluate(() => {
    const n = document.querySelector('.toc-notice')
    if (!n) return null
    const r = n.getBoundingClientRect()
    return { title: n.querySelector('.hd b')?.textContent, body: n.querySelector('p')?.textContent, button: n.querySelector('.go')?.textContent, close: n.querySelector('.x')?.getAttribute('aria-label'), left: r.left, top: r.top, right: r.right, bottom: r.bottom, above: n.classList.contains('above') }
  })

/** 画面の下の知らせの文（「この見出しを直すと、目次も変わります」など） */
const toastText = (page) => page.evaluate(() => [...document.querySelectorAll('.undo-toast')].map((t) => t.textContent).join(' '))

/** 目次の行を押して（押し方 press）、その見出しを書き始めたか */
async function jumpBy(page, ready, id, press) {
  await press()
  await pause(500)
  await ready()
  // パソコンは見出しを書き始め、スマホは見出しのページへ移るだけ（mockups/v48 B）
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id || (window.__editor.getSnapshot().page === window.__editor.pageOfBlock(id) && !!document.querySelector('.toc-glow')), { timeout: 8000 }, id).catch(() => {})
  await pause(300)
  return page.evaluate((id) => {
    const ed = window.__editor
    const s = ed.getSnapshot()
    return { editingId: s.editingId, page: s.page, headingPage: ed.pageOfBlock(id), kind: s.layout.kinds[s.page] }
  }, id)
}

/** 目次のページを、PDF と同じ作り方で絵にする（src/pdf/pagesToPdf.ts。data URL） */
const tocImage = (page) =>
  page.evaluate(async () => {
    const { pagesToPdf } = await import('/src/pdf/pagesToPdf.ts')
    const ed = window.__editor
    const toc = ed.pageElements()[ed.getSnapshot().layout.kinds.indexOf('toc')]
    let url = ''
    await pagesToPdf([toc], { title: 'toc', onPage: (p) => { url = p.canvas.toDataURL('image/png') } })
    return url
  })

// =====================================================================
// パソコン（1366×768）
// =====================================================================
export async function tocLinksPc(browser, check) {
  const { context, page, ready } = await openSample(browser, PC)
  await showToc(page, ready)
  await page.mouse.move(5, 5)

  // ---- 言葉：左の道具の上・もう一言・ページの一覧 ----
  const head = await linesOf(page, '.palette .p-head span')
  const note = await linesOf(page, '.palette .toc-note span')
  check('目次のページの左の道具：「目次」の下が「本文の／見出しから／自動で／作ります」（1字だけの行がない）', head?.join('／') === '本文の／見出しから／自動で／作ります' && noLoneChar(head), JSON.stringify(head))
  check('左の道具のもう一言：「直すときは、／目次の行を／クリック」', note?.join('／') === '直すときは、／目次の行を／クリック' && noLoneChar(note), JSON.stringify(note))
  const list = await page.evaluate(() => {
    const t = [...document.querySelectorAll('.thumb-list .t')][window.__editor.getSnapshot().layout.kinds.indexOf('toc')]
    const range = document.createRange()
    range.selectNodeContents(t.lastChild)
    return { text: t.lastChild.textContent, label: t.getAttribute('aria-label'), lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size }
  })
  check('ページの一覧の名前は「目次（自動）」（1行）', list.text === '目次（自動）' && list.label.startsWith('目次（自動）') && list.lines === 1, JSON.stringify(list))
  await page.screenshot({ path: `${OUT}/pc-1-toc.png` })

  // ---- 行にマウスを乗せる：下線と「→ 見出しへ」 ----
  const hp = await linePoint(page, 'c2')
  await page.mouse.move(hp.x, hp.y)
  await pause(300)
  const hover = await page.evaluate(() => {
    const span = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current [data-toc-target="c2"] > span')
    const cs = getComputedStyle(span)
    const after = getComputedStyle(span, '::after')
    return { deco: cs.textDecorationLine, tag: after.content, cursor: getComputedStyle(span.parentElement).cursor, bg: getComputedStyle(span.parentElement).backgroundColor }
  })
  check('目次の行にマウスを乗せると、見出しに下線と「→ 見出しへ」・指の形のマウス・行の地の色', hover.deco.includes('underline') && hover.tag === '"→ 見出しへ"' && hover.cursor === 'pointer' && hover.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(hover))
  await page.screenshot({ path: `${OUT}/pc-2-hover.png` })

  // ---- PDF の絵は変わらない（マウスを乗せている間も同じ） ----
  const imgHover = await tocImage(page)
  await page.mouse.move(5, 5)
  await pause(200)
  const imgPlain = await tocImage(page)
  check('マウスを乗せている間も、PDF の目次のページの絵は同じ（画面だけの印は入らない）', imgHover === imgPlain && imgPlain.length > 1000)

  // ---- 行を押す：同じ名前の大見出し「制作過程」が2つ（Ⅱ・Ⅲ）。押した行の見出しへ ----
  const jumps = {}
  for (const id of ['c3', 'c2', 's8', 's4']) {
    await showToc(page, ready)
    const p = await linePoint(page, id)
    jumps[id] = await jumpBy(page, ready, id, () => page.mouse.click(p.x, p.y))
    if (id === 'c3') {
      jumps.toast = await toastText(page)
      await page.screenshot({ path: `${OUT}/pc-3-jump.png` })
    }
  }
  const okJump = (j, id) => j.editingId === id && j.page === j.headingPage && j.kind === 'body'
  check('目次の行を押すと、その見出しのページへ移り、見出しを書き始める（同じ名前の大見出し「制作過程」が2つでも、押した行の方。小見出しも同じ）', okJump(jumps.c3, 'c3') && okJump(jumps.c2, 'c2') && okJump(jumps.s8, 's8') && okJump(jumps.s4, 's4') && jumps.c3.page !== jumps.c2.page, JSON.stringify(jumps))
  check(`見出しへ移ると、画面の下に「${JUMPED}」`, jumps.toast.includes(JUMPED), jumps.toast)
  const caret = await page.evaluate(() => {
    const sel = getSelection()
    return { at: sel.anchorOffset, text: document.querySelector('.overlay-editor')?.textContent }
  })
  check('見出しの終わりから書ける（カーソルは見出しの終わり）', caret.text === 'パターンと仮縫い' && caret.at === caret.text.length, JSON.stringify(caret))

  // ---- 引用・参考文献の行：そのページへ ----
  await showToc(page, ready)
  const rp = await linePoint(page, 'references')
  await page.mouse.click(rp.x, rp.y)
  await pause(500)
  await ready()
  check('目次の「引用・参考文献」の行を押すと、引用・参考文献のページへ', (await snap(page)).kind === 'references')

  // ---- キーボード：行に移って Enter ----
  await showToc(page, ready)
  const kb = await page.evaluate(() => {
    const line = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current [data-toc-target="c2"]')
    line.focus()
    return { role: line.getAttribute('role'), tabindex: line.getAttribute('tabindex'), label: line.getAttribute('aria-label'), focused: document.activeElement === line }
  })
  const kbJump = await jumpBy(page, ready, 'c2', () => page.keyboard.press('Enter'))
  check('目次の行はキーボードで移れる（ボタンとして読み上げ）。Enter で、その見出しへ', kb.role === 'button' && kb.tabindex !== null && kb.label === '目次の行：Ⅱ．制作過程（押すと、その見出しへ移ります）' && kb.focused && okJump(kbJump, 'c2'), JSON.stringify({ kb, kbJump }))

  // ---- 行のない所を押す：知らせ（Esc・×・外を押すと閉じる。「本文の見出しへ」） ----
  await showToc(page, ready)
  const ep = await emptyPoint(page)
  await page.mouse.click(ep.x, ep.y)
  await pause(300)
  const n1 = await tocNotice(page)
  const nLines = { title: await linesOf(page, '.toc-notice .hd b'), body: await linesOf(page, '.toc-notice p'), button: await linesOf(page, '.toc-notice .go') }
  check('目次のページの行のない所を押すと、押した所のすぐ下に「目次は自動です／見出しを直すと、ここも変わります［本文の見出しへ］」（1字だけの行がない）',
    !!n1 && n1.title === '目次は自動です' && n1.body === '見出しを直すと、ここも変わります' && n1.button === '本文の見出しへ' && n1.close === '閉じる' && Math.abs(n1.top - (ep.y + 16)) <= 2 && n1.left <= ep.x && n1.right >= ep.x && Object.values(nLines).every(noLoneChar) && (await snap(page)).kind === 'toc',
    JSON.stringify({ n1, ep, nLines }))
  await page.screenshot({ path: `${OUT}/pc-4-notice.png` })
  const imgNotice = await tocImage(page)
  check('知らせを出している間も、PDF の目次のページの絵は同じ', imgNotice === imgPlain)
  await page.keyboard.press('Escape')
  await pause(200)
  const afterEsc = await tocNotice(page)
  await page.mouse.click(ep.x, ep.y)
  await pause(300)
  await page.click('.toc-notice .x')
  await pause(200)
  const afterX = await tocNotice(page)
  await page.mouse.click(ep.x, ep.y)
  await pause(300)
  // 紙の外（まわりの灰色の所）を押す
  const outside = await page.evaluate(() => {
    const st = document.querySelector('.stage').getBoundingClientRect()
    const r = window.__editor.pageElements()[window.__editor.getSnapshot().page].getBoundingClientRect()
    return { x: Math.round((r.right + st.right) / 2), y: Math.round(st.top + st.height * 0.7) }
  })
  await page.mouse.click(outside.x, outside.y)
  await pause(200)
  const afterOut = await tocNotice(page)
  check('知らせは Esc・×・知らせの外を押すと閉じる', afterEsc === null && afterX === null && afterOut === null, JSON.stringify({ afterEsc, afterX, afterOut }))
  await page.mouse.click(ep.x, ep.y)
  await pause(300)
  const goJump = await jumpBy(page, ready, 'c1', () => page.click('.toc-notice .go'))
  check('知らせの「本文の見出しへ」で、本文の最初の大見出し（Ⅰ．企画・立案）へ移って書き始める。知らせは閉じる', okJump(goJump, 'c1') && (await tocNotice(page)) === null, JSON.stringify(goJump))

  // ---- 印刷：画面だけの印は出ない ----
  await showToc(page, ready)
  await page.mouse.move(hp.x, hp.y)
  await page.mouse.click(ep.x, ep.y)
  await pause(300)
  await page.mouse.move(hp.x, hp.y)
  await pause(200)
  await page.emulateMediaType('print')
  const printed = await page.evaluate(() => {
    const span = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current [data-toc-target="c2"] > span')
    const n = document.querySelector('.toc-notice')
    return { tag: getComputedStyle(span, '::after').content, deco: getComputedStyle(span).textDecorationLine, notice: n ? getComputedStyle(n).display : 'none' }
  })
  await page.emulateMediaType(null)
  check('印刷では、行の下線・「→ 見出しへ」・知らせは出ない', printed.tag === 'none' && !printed.deco.includes('underline') && printed.notice === 'none', JSON.stringify(printed))
  await page.keyboard.press('Escape')
  await page.mouse.move(5, 5)

  // ---- ページ送り：ホイール・→・紙面の横の矢印は、目次のページでも今までどおり ----
  await showToc(page, ready)
  const tocIndex = (await snap(page)).page
  const stage = await page.evaluate(() => { const r = document.querySelector('.stage .page-scroller').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })
  await page.mouse.move(stage.x, stage.y)
  await page.mouse.wheel({ deltaY: 120 })
  await pause(300)
  await ready()
  const byWheel = (await snap(page)).page
  await showToc(page, ready)
  await page.evaluate(() => document.activeElement?.blur())
  await page.keyboard.press('ArrowRight')
  await pause(300)
  await ready()
  const byKey = (await snap(page)).page
  await showToc(page, ready)
  await page.click('.arrow.next')
  await pause(300)
  await ready()
  const byArrow = (await snap(page)).page
  check('目次のページでも、ホイール・→ キー・紙面の横の矢印で次のページへ送れる（知らせは出ない）', byWheel === tocIndex + 1 && byKey === tocIndex + 1 && byArrow === tocIndex + 1 && (await tocNotice(page)) === null, JSON.stringify({ tocIndex, byWheel, byKey, byArrow }))

  // ---- PDF の絵は、目次の行の行き先・Tab の印（新しく足したもの）を外しても同じ ----
  await showToc(page, ready)
  const before = await tocImage(page)
  await page.evaluate(() => {
    const toc = window.__editor.pageElements()[window.__editor.getSnapshot().layout.kinds.indexOf('toc')]
    for (const el of toc.querySelectorAll('[data-toc-target]')) {
      for (const a of ['data-toc-target', 'data-paper-key', 'role', 'tabindex', 'aria-label']) el.removeAttribute(a)
      // 小見出しの行は、前は見出しの字を span に入れていなかった
      if (el.classList.contains('toc-sub')) el.replaceChildren(...el.firstElementChild.childNodes)
    }
  })
  const stripped = await tocImage(page)
  check('PDF の目次のページの絵は、今回足した行き先・Tab の印・小見出しの span を外したもの（前の紙面）と同じ', before === stripped && before.length > 1000)
  await context.close()
}

// =====================================================================
// スマホ（390×844）
// =====================================================================
export async function tocLinksPhone(browser, check) {
  const { context, page, ready } = await openSample(browser, PHONE)
  await showToc(page, ready)

  // ---- 帯 ----
  const band = await page.evaluate(() => {
    const b = document.querySelector('.page-band.toc-band')
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { text: b.querySelector('.t')?.textContent, sub: b.querySelector('p')?.textContent, buttons: b.querySelectorAll('button').length, inView: r.top >= 0 && r.bottom <= innerHeight, wide: document.documentElement.scrollWidth > innerWidth + 1 }
  })
  const bandLines = { text: await linesOf(page, '.page-band.toc-band .t > span:last-child'), sub: await linesOf(page, '.page-band.toc-band p') }
  check('スマホの目次のページの帯：「目次は、本文の見出しから自動で作ります」「目次の行をタップすると、その見出しへ移ります」（ボタンなし・1字だけの行がない）',
    !!band && band.text === '目次は、本文の見出しから自動で作ります' && band.sub === '目次の行をタップすると、その見出しへ移ります' && band.buttons === 0 && band.inView && !band.wide && noLoneChar(bandLines.text) && noLoneChar(bandLines.sub),
    JSON.stringify({ band, bandLines }))
  await page.screenshot({ path: `${OUT}/ph-1-band.png` })

  // ---- 行をタップ（同じ名前の大見出しの2つ目）・行の少し下をタップ ----
  const p3 = await linePoint(page, 'c3')
  const tap3 = await jumpBy(page, ready, 'c3', () => page.touchscreen.tap(p3.x, p3.y))
  // スマホ：見出しのページへ移り、見出しを光らせるだけ（書き始めない。キーボードを出さない：mockups/v48 B）
  const sheet = await page.evaluate(() => ({ open: !!document.querySelector('.edit-sheet.open'), glow: document.querySelector('.page-viewport.front .toc-glow')?.textContent ?? '' }))
  await page.screenshot({ path: `${OUT}/ph-2-jump.png` })
  check('スマホ：目次の行をタップすると、その見出しのページへ移り、見出しを光らせる（書き始めない。同じ名前の2つ目の「制作過程」。mockups/v48 B）', tap3.editingId === null && tap3.page === tap3.headingPage && tap3.kind === 'body' && !sheet.open && sheet.glow.includes('制作過程'), JSON.stringify({ tap3, sheet }))
  // いちばん下の行（引用・参考文献）の少し下（行のない所）をタップ
  await showToc(page, ready)
  const near = await linePoint(page, 'references', 5)
  await page.touchscreen.tap(near.x, near.y)
  await pause(500)
  await ready()
  const tapNear = { ...(await snap(page)), notice: await tocNotice(page) }
  check('スマホ：行の少し下（5px。行のない所）をタップしても、その行の行き先へ（行は細いので、指の幅ほどずれても）', tapNear.kind === 'references' && tapNear.notice === null, JSON.stringify(tapNear))

  // ---- 行のない所をタップ：知らせ ----
  await showToc(page, ready)
  const ep = await emptyPoint(page)
  await page.touchscreen.tap(ep.x, ep.y)
  await pause(400)
  const n = await tocNotice(page)
  const nLines = { title: await linesOf(page, '.toc-notice .hd b'), body: await linesOf(page, '.toc-notice p'), button: await linesOf(page, '.toc-notice .go') }
  const sizes = await page.evaluate(() => ({ go: document.querySelector('.toc-notice .go')?.getBoundingClientRect().height, x: document.querySelector('.toc-notice .x')?.getBoundingClientRect().height, wide: document.documentElement.scrollWidth > innerWidth + 1 }))
  check('スマホ：行のない所をタップすると、その近くに「目次は自動です」の知らせ（画面からはみ出さない・ボタンは 44px・1字だけの行がない）',
    !!n && n.title === '目次は自動です' && n.left >= 0 && n.right <= 390 && n.bottom <= 844 && sizes.go >= 44 && sizes.x >= 44 && !sizes.wide && Object.values(nLines).every(noLoneChar),
    JSON.stringify({ n, sizes, nLines }))
  await page.screenshot({ path: `${OUT}/ph-3-notice.png` })
  // 帯をタップすると閉じる（知らせの外）
  const bandBox = await page.evaluate(() => { const r = document.querySelector('.page-band').getBoundingClientRect(); return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) } })
  await page.touchscreen.tap(bandBox.x, bandBox.y)
  await pause(300)
  check('スマホ：知らせの外をタップすると閉じる（目次のページのまま）', (await tocNotice(page)) === null && (await snap(page)).kind === 'toc')

  // ---- 指ではらう：行の上から始めても、ページを送る（見出しへ移らない・知らせも出ない） ----
  await showToc(page, ready)
  const tocIndex = (await snap(page)).page
  const from = await linePoint(page, 'c2')
  await page.touchscreen.touchStart(from.x + 150, from.y)
  await page.touchscreen.touchMove(from.x + 60, from.y + 4)
  await page.touchscreen.touchMove(from.x - 40, from.y + 8)
  await page.touchscreen.touchEnd()
  await pause(400)
  await ready()
  const afterSwipe = await snap(page)
  const noticeAfterSwipe = await tocNotice(page)
  check('スマホ：目次の行の上から左にはらうと、次のページへめくれる（見出しへは移らず、知らせも出ない）', afterSwipe.page === tocIndex + 1 && !afterSwipe.editingId && noticeAfterSwipe === null, JSON.stringify({ tocIndex, afterSwipe, noticeAfterSwipe }))
  await showToc(page, ready)
  await page.touchscreen.touchStart(200, ep.y)
  await page.touchscreen.touchMove(203, ep.y - 110)
  await page.touchscreen.touchMove(206, ep.y - 220)
  await page.touchscreen.touchEnd()
  await pause(400)
  await ready()
  const afterUp = await snap(page)
  check('スマホ：目次のページの行のない所から上にはらうと、次のページへ（知らせは出ない）', afterUp.page === tocIndex + 1 && (await tocNotice(page)) === null, JSON.stringify(afterUp))
  await context.close()
}

// node scripts/e2e/tocLinks.mjs で、これだけを動かす（Edge は EDGE_PORT）
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { withEdge } = await import('../poc/edge.mjs')
  const results = []
  const check = (name, ok, detail = '') => {
    results.push({ name, ok })
    console.log(`${ok ? '✓' : '✗'} ${name}${detail && !ok ? `  (${detail})` : ''}`)
  }
  await withEdge(async (browser) => {
    const only = process.argv.slice(2)
    if (!only.length || only.includes('pc')) await tocLinksPc(browser, check)
    if (!only.length || only.includes('phone')) await tocLinksPhone(browser, check)
  })
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 件 合格`)
  process.exitCode = failed.length ? 1 : 0
}
