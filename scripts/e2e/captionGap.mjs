// 図表のタイトルを書いている間の、番号と書いた字の間（Edge を自動で操作する。パソコンとスマホ）。
// 依頼者の指摘（2026-10-20）：図・表のタイトルを書いている間、書く欄が番号の後ろの空いた所から始まり、その中で真ん中にそろえていたため、
// 「図4.」「表2.」から離れて見えた（書き終えると「図4.タイトル」とつながる）。
// 書いている間も、番号を書く欄の前に出し（書けない字。書いた字には入らない）、紙面と同じ幅の中で、番号とタイトルを一緒に真ん中にそろえる。
// - パソコン：図のタイトル・表のタイトル。書いてあるタイトル・空のタイトル（打ち始め）・折り返す長いタイトル・2枚並べた図
// - スマホ（紙面に直接書く）：phoneDirect.mjs から captionGap で測る（図のタイトル・図を入れる・表を入れる）
// - 番号の右の端と、書いた字の1字目の左の間が、1字分（1em）以下。紙面の番号は書く欄の下に隠れて、番号は1つだけ見える
// smoke.mjs から呼ぶ（captionGapPc）。これだけを動かすときは node scripts/e2e/captionGap.mjs。画面の写真は poc-output/caption-gap/
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { stubConfig } from './configStub.mjs'
import { setupWriting } from './sampleReport.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/caption-gap'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const LONG = '袖の刺繍の図案を何度も描き直し、離れた客席からでも波の形が分かる大きさに決めたときの下絵'

/**
 * いま書いている図表のタイトル（id）の、番号と書いた字の間を測る（書いた字が1字以上あるとき）。
 * 見えている番号：書く欄の前の番号（::before）があれば、それ。なければ紙面の番号（前の作り：書く欄の外）。
 * gap：見えている番号の右の端から、書いた字の1字目の左まで（画面の px）。paperGap：紙面の番号の右の端から、書いた字の1字目の左まで
 * （書いてあったタイトルを開いただけなら、書き終えたときと同じ所から書くので 0 に近い）。em：書く欄の1字の幅（画面の px）
 */
export const captionGap = (page, id) =>
  page.evaluate((id) => {
    const ed = window.__editor
    const el = ed.overlay.element
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const scale = r.width / (el.offsetWidth || 1)
    const em = parseFloat(cs.fontSize) * scale
    const frag = document.querySelector(`.page-viewport.front [data-block-id="${CSS.escape(id)}"]`)
    const num = frag?.previousElementSibling?.classList.contains('num') ? frag.previousElementSibling : null
    const numRect = num?.getBoundingClientRect() ?? null
    // 書いた字の1字目と、それと同じ行の右の端
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let first = null
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (!node.length) continue
      const range = document.createRange()
      range.setStart(node, 0)
      range.setEnd(node, 1)
      first = [...range.getClientRects()].find((q) => q.height > 0) ?? null
      if (first) break
    }
    const all = document.createRange()
    all.selectNodeContents(el)
    const rects = [...all.getClientRects()].filter((q) => q.height > 0)
    const lineRight = first ? Math.max(...rects.filter((q) => Math.abs(q.top - first.top) < first.height / 2).map((q) => q.right)) : null
    const lines = new Set(rects.map((q) => Math.round(q.top / (first?.height || 1)))).size
    // 書く欄の前の番号（::before）：同じ書体の見えない字で幅を測り、行の左の端（真ん中にそろえた行なら、右の余りと同じだけ空く）から置く
    const before = getComputedStyle(el, '::before')
    const shown = before.content && before.content !== 'none' && before.content !== 'normal' ? JSON.parse(before.content) : null
    let labelRight = numRect?.right ?? null
    if (shown && first) {
      const probe = document.createElement('span')
      probe.textContent = shown
      for (const p of ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'fontFeatureSettings']) probe.style[p] = before[p]
      Object.assign(probe.style, { position: 'absolute', left: '0', top: '0', whiteSpace: 'pre', visibility: 'hidden', transformOrigin: '0 0', transform: cs.transform })
      el.parentElement.append(probe)
      const labelW = probe.getBoundingClientRect().width
      probe.remove()
      const A = r.left + (parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth)) * scale
      const B = r.right - (parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth)) * scale
      const lineLeft = cs.textAlign === 'center' ? A + B - lineRight : A
      labelRight = lineLeft + labelW
    }
    return {
      editing: ed.getSnapshot().editingId,
      label: num?.textContent ?? null,
      shown,
      text: ed.overlay.text,
      gap: first && labelRight !== null ? first.left - labelRight : null,
      paperGap: first && numRect ? first.left - numRect.right : null,
      em,
      lines,
      // 紙面の番号が書く欄の下に隠れている（番号が2つ見えない）
      covered: !shown || (!!numRect && numRect.left >= r.left - 0.5 && numRect.right <= r.right + 0.5 && numRect.top < r.bottom && numRect.bottom > r.top),
    }
  }, id)

/** 測った値が合格か：番号が紙面の番号と同じで、書いた字のすぐ前（1em 以内）。filled：書いてあったタイトルを開いただけ（書き終えたときと同じ所から書く） */
export const gapOk = (m, { filled = false } = {}) =>
  !!m &&
  m.shown === m.label &&
  m.gap !== null &&
  Math.abs(m.gap) <= m.em &&
  m.covered &&
  !m.text.startsWith(m.label ?? '\u0000') &&
  (!filled || (m.paperGap !== null && Math.abs(m.paperGap) <= m.em))

export const gapDetail = (m) =>
  JSON.stringify(m && { label: m.label, shown: m.shown, text: m.text.slice(0, 12), gap: m.gap?.toFixed(1), paperGap: m.paperGap?.toFixed(1), em: m.em.toFixed(1), lines: m.lines, covered: m.covered })

async function openSample(browser) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror(captionGap):', e.message))
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
  await page.setViewport({ width: 1440, height: 900 })
  const ready = () =>
    page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 120000 })
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.guide.step-course .g-opts button', { timeout: 60000 })
  await page.evaluate(() => document.querySelector('.g-opts button').click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.g-later')
  await page.evaluate(() => document.querySelector('.g-later').click())
  await ready()
  await page.evaluate(() => window.__editor.finishEditing())
  await page.evaluate(setupWriting)
  await wait(300)
  await ready()
  return { context, page, ready }
}

/** 原稿の図（id）・表（id）のタイトルを替える */
const setCaption = (page, id, text) =>
  page.evaluate(
    (id, text) =>
      window.__editor.update((r) => ({
        ...r,
        body: r.body.map((c) => ({
          ...c,
          blocks: c.blocks.map((b) =>
            b.type === 'figureRow' ? { ...b, figures: b.figures.map((f) => (f.id === id ? { ...f, caption: text } : f)) } : b.type === 'table' && b.id === id ? { ...b, caption: text } : b,
          ),
        })),
      })),
    id,
    text,
  )

const captionOf = (page, id) =>
  page.evaluate((id) => {
    for (const b of window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks)) {
      if (b.type === 'figureRow') for (const f of b.figures) if (f.id === id) return f.caption
      if (b.type === 'table' && b.id === id) return b.caption
    }
    return null
  }, id)

/** パソコン：図表のタイトルを、紙面の番号の後ろの所をクリックして書き始める */
export async function captionGapPc(browser, check) {
  const { context, page, ready } = await openSample(browser)
  /** タイトルの行のまわりを大きく撮る */
  const zoomShot = async (name, id) => {
    const clip = await page.evaluate((id) => {
      const el = window.__editor.overlay.element.getBoundingClientRect()
      const frag = document.querySelector(`.page-viewport.front [data-block-id="${id}"]`)
      const area = frag.closest('.figure-row, .data-table').getBoundingClientRect()
      const top = Math.min(el.top, frag.getBoundingClientRect().top) - 14
      return { x: area.left - 16, y: top, width: area.width + 32, height: Math.max(el.bottom, frag.getBoundingClientRect().bottom) - top + 14, scale: 2 }
    }, id)
    await page.screenshot({ path: `${OUT}/e2e-pc-${name}.png`, clip, captureBeyondViewport: false })
  }
  const open = async (id, text) => {
    await page.evaluate(() => window.__editor.finishEditing())
    if (text !== undefined) await setCaption(page, id, text)
    await ready()
    await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), id)
    await ready()
    await wait(300)
    await page.evaluate((id) => document.querySelector(`.page-viewport.front [data-block-id="${id}"]`).scrollIntoView({ block: 'center' }), id)
    await wait(200)
    const at = await page.evaluate((id) => {
      const r = document.querySelector(`.page-viewport.front [data-block-id="${id}"]`).getBoundingClientRect()
      return { x: r.left + Math.min(r.width / 2, 20), y: r.top + r.height / 2 }
    }, id)
    await page.mouse.click(at.x, at.y)
    await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 10000 }, id).catch(() => {})
    await wait(300)
    await page.evaluate(() => window.__editor.overlay.setCaret(window.__editor.overlay.text.length))
  }

  // 書いてあるタイトル：開いただけで、書き終えたときと同じ所から書く（「図3.袖の刺繍」）
  await open('f3', '袖の刺繍')
  const figFilled = await captionGap(page, 'f3')
  await zoomShot('figure-filled', 'f3')
  check('パソコン：図のタイトルを書いている間も、番号（図3.）が書く欄の前にあり、タイトルはそのすぐ後ろ（1字分以内）から始まる', gapOk(figFilled, { filled: true }), gapDetail(figFilled))

  // 空のタイトル：「図3. |」のように番号のすぐ後ろにカーソル。打った字も番号のすぐ後ろ。番号は書いた字に入らない
  await open('f3', '')
  const emptyShown = await page.evaluate(() => ({ shown: getComputedStyle(window.__editor.overlay.element, '::before').content, text: window.__editor.overlay.text }))
  await page.keyboard.type('あ')
  await wait(200)
  const figEmpty = await captionGap(page, 'f3')
  await zoomShot('figure-empty', 'f3')
  await page.evaluate(() => window.__editor.finishEditing())
  await ready()
  const figSaved = await captionOf(page, 'f3')
  check(
    'パソコン：空の図のタイトルを開くと、書く欄の前に番号（図3.）。打った字は番号のすぐ後ろ（1字分以内）で、原稿には打った字だけが入る',
    emptyShown.shown === '"図3."' && emptyShown.text === '' && gapOk(figEmpty) && figSaved === 'あ',
    `${gapDetail(figEmpty)} saved=${figSaved}`,
  )

  // 折り返す長いタイトル：番号のすぐ後ろから書き、2行目へ折り返す
  await open('f3', LONG)
  const figLong = await captionGap(page, 'f3')
  await zoomShot('figure-long', 'f3')
  check('パソコン：折り返す長い図のタイトルも、番号のすぐ後ろから書き、2行に折り返す', gapOk(figLong, { filled: true }) && figLong.lines >= 2, gapDetail(figLong))

  // 表のタイトル（書いてある・空）
  await open('t1', '使用素材表')
  const tabFilled = await captionGap(page, 't1')
  await zoomShot('table-filled', 't1')
  check('パソコン：表のタイトルを書いている間も、番号（表1.）が書く欄の前にあり、タイトルはそのすぐ後ろ（1字分以内）から始まる', gapOk(tabFilled, { filled: true }), gapDetail(tabFilled))
  await open('t1', '')
  await page.keyboard.type('あ')
  await wait(200)
  const tabEmpty = await captionGap(page, 't1')
  await zoomShot('table-empty', 't1')
  // 表のタイトルのすぐ下の、表の上の線が、書いている間も見える（書く欄の白い地で隠さない）：
  // 書く欄の右の方（字のない所）の、表の上の端のまわりを撮って、横いっぱいに濃い行（線）があるかを見る
  const strip = await page.evaluate(() => {
    const r = window.__editor.overlay.element.getBoundingClientRect()
    const th = document.querySelector('.page-viewport.front .data-table th').getBoundingClientRect()
    return { x: r.left + r.width * 0.75, y: th.top - 3, width: r.width * 0.15, height: 6, scale: 2 }
  })
  const png = await page.screenshot({ clip: strip, encoding: 'base64', captureBeyondViewport: false })
  const border = await page.evaluate(async (png) => {
    const img = new Image()
    img.src = `data:image/png;base64,${png}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    // 行ごとの、濃い点（白からはっきり離れた点）の割合の、いちばん多い行
    let best = 0
    for (let y = 0; y < c.height; y++) {
      let n = 0
      for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4] < 160) n++
      best = Math.max(best, n / c.width)
    }
    return best
  }, png)
  await page.evaluate(() => window.__editor.finishEditing())
  await ready()
  const tabSaved = await captionOf(page, 't1')
  check('パソコン：空の表のタイトルに打った字も、番号（表1.）のすぐ後ろ（1字分以内）。原稿には打った字だけが入る', gapOk(tabEmpty) && tabSaved === 'あ', `${gapDetail(tabEmpty)} saved=${tabSaved}`)
  check('パソコン：表のタイトルを書いている間も、表の上の線が見える（書く欄の白い地で隠さない）', border > 0.9, `濃い点の割合 ${border.toFixed(2)}`)

  // 2枚並べた図：その図の幅の中で、番号とタイトルを一緒に真ん中にそろえる
  await page.evaluate(() => window.__editor.finishEditing())
  await page.evaluate(() =>
    window.__editor.update((r) => ({
      ...r,
      body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.type === 'figureRow' && b.figures.some((f) => f.id === 'f3') ? { ...b, figures: [...b.figures, { ...b.figures[0], id: 'f3b', caption: '刺繍の裏' }] } : b)) })),
    })),
  )
  await ready()
  await open('f3b')
  const pair = await captionGap(page, 'f3b')
  const pairBox = await page.evaluate(() => {
    const r = window.__editor.overlay.element.getBoundingClientRect()
    const f = document.querySelector('.page-viewport.front figure[data-figure-id="f3b"]').getBoundingClientRect()
    return { overlay: [r.left, r.right].map(Math.round), figure: [f.left, f.right].map(Math.round) }
  })
  await zoomShot('figure-pair', 'f3b')
  check(
    'パソコン：2枚並べた図の右の図のタイトルも、番号のすぐ後ろから書く（書く欄はその図の幅）',
    gapOk(pair, { filled: true }) && Math.abs(pairBox.overlay[0] - pairBox.figure[0]) <= 1 && Math.abs(pairBox.overlay[1] - pairBox.figure[1]) <= 1,
    `${gapDetail(pair)} ${JSON.stringify(pairBox)}`,
  )
  await page.evaluate(() => window.__editor.finishEditing())
  await context.close()
}

// これだけを動かす：node scripts/e2e/captionGap.mjs
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { withEdge } = await import('../poc/edge.mjs')
  const results = []
  const check = (name, ok, detail = '') => {
    results.push(ok)
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
  }
  await withEdge((browser) => captionGapPc(browser, check))
  const failed = results.filter((ok) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} 件 合格`)
  process.exitCode = failed ? 1 : 0
}
