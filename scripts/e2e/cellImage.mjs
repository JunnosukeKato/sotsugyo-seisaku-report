// 表の画像（生地見本など）を押して「この画像」の道具：差し替え・切り抜く（マスいっぱい）・全体に戻す・外す。切り抜いた画像は指・マウスでずらす
// （学生の試し：依頼者 2026-10-23。案A「必要なときだけ切り抜く」）。スマホとパソコン。これだけを流すときは node scripts/e2e/run.mjs cellImage
import { mkdirSync } from 'node:fs'
import { withEdge } from '../poc/edge.mjs'
import { stubConfig } from './configStub.mjs'
import { setupWriting } from './sampleReport.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/cell-image'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
}

async function open(browser, phone) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('sotsugyo-seisaku-report-tour', 'done'); localStorage.setItem('sotsugyo-seisaku-report-writing-zoom', '0') } catch {} })
  await stubConfig(page)
  if (phone) {
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1')
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  } else await page.setViewport({ width: 1440, height: 900 })
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0', timeout: 90000 })
  const ready = () => page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 120000 })
  await ready()
  await page.waitForSelector('.guide.step-course .g-opts button', { timeout: 60000 })
  await page.evaluate(() => document.querySelector('.g-opts button').click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.guide.step-studentId')
  await ready()
  await page.evaluate(() => document.querySelector('.g-later').click())
  await ready()
  await page.evaluate(setupWriting)
  await wait(500)
  await ready()
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === 't1' ? { ...b, heights: 'photo' } : b)) })) })))
  await wait(400)
  await ready()
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('t1'), 'none'))
  await wait(400)
  await ready()
  return { context, page, ready }
}

const imgCenter = (page, i) =>
  page.evaluate((i) => {
    const t = [...document.querySelectorAll('.page-viewport.front .data-table')].find((x) => x.getBoundingClientRect().height > 0)
    const r = [...t.querySelectorAll('td img')][i].getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }
  }, i)
const state = (page) =>
  page.evaluate(() => {
    const s = window.__editor.getSnapshot()
    const t = s.report.body[0].blocks.find((b) => b.id === 't1')
    const cell = t.rows[2].cells[2]
    const tools = [...document.querySelectorAll('.sel-bar .tb, .palette .group.ctx .tb')].map((b) => b.textContent.trim())
    const img = [...document.querySelectorAll('.page-viewport.front .data-table')].find((x) => x.getBoundingClientRect().height > 0)?.querySelectorAll('td img')[1]
    return { sel: s.selection, editing: s.editingId, crop: cell.crop ?? null, image: cell.imageId, tools, imgClass: img?.className ?? '', notice: document.querySelector('.undo-toast, .notice-bar, .toast')?.textContent ?? '' }
  })

await withEdge(async (browser) => {
  // ---- スマホ ----
  {
    const { context, page, ready } = await open(browser, true)
    const c = await imgCenter(page, 1)
    await page.touchscreen.tap(c.x, c.y)
    await wait(500)
    const tapped = await state(page)
    check('スマホ：表の画像を押すと、画像を選び（書き始めない）、「この画像」の道具（差し替え・切り抜く・外す）が出る', tapped.sel?.kind === 'cellImage' && !tapped.editing && JSON.stringify(tapped.tools) === JSON.stringify(['差し替え', '切り抜く', '外す']) && tapped.imgClass.includes('is-selected'), JSON.stringify(tapped))
    await page.screenshot({ path: `${OUT}/p1-押した.png` })
    await page.evaluate(() => [...document.querySelectorAll('.sel-bar .tb')].find((b) => b.textContent.includes('切り抜く')).click())
    await wait(700)
    await ready()
    const cropped = await state(page)
    check('「切り抜く」で、マスいっぱいに広がり（印 crop）、選んだまま。道具は「全体に戻す」に。ずらし方を知らせる', cropped.crop?.x === 50 && cropped.crop?.y === 50 && cropped.sel?.kind === 'cellImage' && cropped.imgClass.includes('crop') && cropped.tools.includes('全体に戻す'), JSON.stringify(cropped))
    // 切り抜いた画像を選んでいる間は、紙面の下の帯に「指でずらして、写る所を調整」（作品写真と同じ。mockups/v53 ⑧）
    const band = await page.evaluate(() => document.querySelector('.page-band.photo-move-band')?.textContent ?? '')
    check('スマホ：切り抜いた表の画像を選んでいる間は、帯に「指でずらして、写る所を調整」と出る', band.includes('指でずらして、写る所を調整'), band)
    // 指でずらす（CDP のタッチ）
    const cdp = await page.createCDPSession()
    const p = await imgCenter(page, 1)
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] })
    await touch('touchStart', p.x, p.y)
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', p.x + (i * 40) / 8, p.y - (i * 30) / 8)
      await wait(16)
    }
    await touch('touchEnd', 0, 0)
    await wait(700)
    await ready()
    const moved = await state(page)
    check('切り抜いた画像を指でずらすと、写る所が変わる（右へずらすと左側が見える。ページは送らない）', moved.crop && (moved.crop.x < 50 || moved.crop.y !== 50) && moved.sel?.kind === 'cellImage', JSON.stringify({ crop: moved.crop, sel: moved.sel }))
    await page.screenshot({ path: `${OUT}/p2-ずらした.png` })
    await page.evaluate(() => [...document.querySelectorAll('.sel-bar .tb')].find((b) => b.textContent.includes('全体に戻す')).click())
    await wait(600)
    await ready()
    const whole = await state(page)
    check('「全体に戻す」で切り抜きをやめる', whole.crop === null && !whole.imgClass.includes('crop') && whole.tools.includes('切り抜く'), JSON.stringify(whole))
    await page.evaluate(() => [...document.querySelectorAll('.sel-bar .tb')].find((b) => b.textContent.includes('外す')).click())
    await wait(600)
    await ready()
    const removed = await state(page)
    check('「外す」で画像を外し、画面の下に「表の画像を外しました」', removed.image === null && removed.sel === null && /表の画像を外しました/.test(await page.evaluate(() => document.body.textContent)), JSON.stringify({ image: removed.image, sel: removed.sel }))
    await page.screenshot({ path: `${OUT}/p3-外した.png` })
    await context.close()
  }
  // ---- パソコン ----
  {
    const { context, page, ready } = await open(browser, false)
    const c = await imgCenter(page, 1)
    await page.mouse.click(c.x, c.y)
    await wait(500)
    const clicked = await state(page)
    check('パソコン：表の画像をクリックすると、左の道具に「この画像」（差し替え・切り抜く・外す）', clicked.sel?.kind === 'cellImage' && ['差し替え', '切り抜く', '外す'].every((t) => clicked.tools.includes(t)), JSON.stringify(clicked.tools))
    await page.evaluate(() => [...document.querySelectorAll('.palette .tb')].find((b) => b.textContent.includes('切り抜く')).click())
    await wait(700)
    await ready()
    const p = await imgCenter(page, 1)
    await page.mouse.move(p.x, p.y)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(p.x - (i * 30) / 8, p.y + (i * 20) / 8)
    await page.mouse.up()
    await wait(700)
    await ready()
    const moved = await state(page)
    check('パソコン：切り抜いた画像をマウスでずらすと、写る所が変わる', moved.crop && (moved.crop.x !== 50 || moved.crop.y !== 50), JSON.stringify(moved.crop))
    await page.screenshot({ path: `${OUT}/pc1-ずらした.png` })
    // Delete で外す
    await page.keyboard.press('Delete')
    await wait(600)
    const del = await state(page)
    check('パソコン：画像を選んで Delete で外す', del.image === null, JSON.stringify({ image: del.image }))
    await context.close()
  }
})
console.log(`${results.filter(Boolean).length}/${results.length} 件 合格`)
if (!results.every(Boolean)) process.exitCode = 1
