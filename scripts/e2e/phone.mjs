// スマホ版の動作確認（Edge をスマホの画面の大きさ・タッチ操作にして動かす）。
// 使い方: node scripts/e2e/phone.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { withEdge } from '../poc/edge.mjs'

const OUT = 'poc-output/e2e-phone'
mkdirSync(OUT, { recursive: true })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

await withEdge(async (browser) => {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36')
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
  await page.evaluate(() => new Promise((r) => { const req = indexedDB.deleteDatabase('sotsugyo-seisaku-report'); req.onsuccess = req.onerror = req.onblocked = () => r() }))
  await page.reload({ waitUntil: 'networkidle0' })
  const ready = () =>
    page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && s.sheet && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 60000 })
  await ready()
  const snap = () => page.evaluate(() => { const s = window.__editor.getSnapshot(); return { page: s.page, zoomed: s.zoomed, editingId: s.editingId, report: s.report } })
  const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` })

  check('スマホの並べ方になる（右の欄がなく、下にタブがある）', !(await page.$('.side')) && !!(await page.$('.p-nav')) && !!(await page.$('.p-top')))
  const pageWidth = await page.evaluate(() => document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current').getBoundingClientRect().width)
  check('紙面が画面の幅いっぱいに表示される', pageWidth > 330, `${Math.round(pageWidth)}px`)
  await shot('1-cover')


  // 本文の段落をタップすると、下から書く欄が出る
  const pid = await page.evaluate(() => window.__editor.getSnapshot().report.body[0].blocks.find((b) => b.type === 'paragraph').id)
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), pid)
  await ready()
  await shot('2-body')
  const tapAt = await page.evaluate((id) => {
    const el = [...document.querySelectorAll(`.page-viewport.front [data-block-id="${id}"]`)].find((e) => e.getBoundingClientRect().width > 0)
    const r = el.getBoundingClientRect()
    return { x: r.left + 20, y: r.top + r.height / 2 }
  }, pid)
  await page.touchscreen.tap(tapAt.x, tapAt.y)
  await wait(300)
  const sheet = await page.evaluate(() => {
    const ed = document.querySelector('.edit-sheet')
    const input = document.querySelector('.overlay-editor')
    return { open: ed.classList.contains('open') && ed.getBoundingClientRect().height > 0, inSheet: ed.contains(input), focused: document.activeElement === input, fontSize: parseFloat(getComputedStyle(input).fontSize) }
  })
  check('段落をタップすると、下から書く欄が出て、すぐ書ける', sheet.open && sheet.inSheet && sheet.focused, JSON.stringify(sheet))
  check('書く欄の文字は16px（iPhone で勝手に拡大されない大きさ）', sheet.fontSize >= 16, `${sheet.fontSize}px`)
  check('書いている間は紙面を拡大する', (await snap()).zoomed)
  await page.keyboard.type('私は衣装を製作した。')
  await wait(1200)
  await ready()
  await shot('3-editing')
  let s = await snap()
  const text = s.report.body[0].blocks.find((b) => b.id === pid).content.map((n) => n.text ?? '').join('')
  check('書いた文字が原稿に入る', text.includes('私は衣装を製作した。'), text)
  const blockIssue = await page.evaluate(() => document.querySelector('.es-meta .ng')?.textContent ?? '')
  check('書く欄に、その段落の指摘が出る', blockIssue.length > 0, blockIssue)
  await page.click('.edit-sheet .done')
  await ready()
  s = await snap()
  check('「完了」で書く欄が閉じ、紙面の表示が戻る', !s.editingId && !s.zoomed && !(await page.evaluate(() => document.querySelector('.edit-sheet').classList.contains('open'))))

  // 追加：段落を足す
  await page.click('.p-nav .add')
  await page.waitForSelector('.sheet .add-grid')
  await shot('4-add')
  const before = s.report.body[0].blocks.length
  await page.evaluate(() => [...document.querySelectorAll('.sheet .add-grid .tb')].find((b) => b.textContent.includes('段落')).click())
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId, { timeout: 30000 })
  await ready()
  s = await snap()
  check('「追加」から段落を足すと、すぐ書ける', s.report.body.flatMap((c) => c.blocks).length > before && !!s.editingId)
  await page.click('.edit-sheet .done')
  await ready()

  // チェック
  await page.click('.p-nav button:nth-child(3)')
  await page.waitForSelector('.sheet .meters')
  await shot('5-check')
  check('「チェック」で、セルフチェックが下から出る', (await page.$$('.sheet .issue')).length > 0)
  await page.click('.sheet-close')

  // ページ一覧
  await page.click('.p-nav button:nth-child(1)')
  await page.waitForSelector('.sheet .thumb-list .t')
  await shot('6-pages')
  await page.evaluate(() => document.querySelectorAll('.sheet .thumb-list .t')[0].click())
  await ready()
  check('「ページ一覧」から選んだページへ移る', (await snap()).page === 0)

  // 指で左にはらうと次のページ（はらった直後のタップは、ブラウザが勢いを止める操作として扱うため、最後に確かめる）
  await page.touchscreen.touchStart(300, 400)
  await page.touchscreen.touchMove(200, 405)
  await page.touchscreen.touchMove(90, 410)
  await page.touchscreen.touchEnd()
  await wait(100)
  await ready()
  check('指で左にはらうと、次のページへめくれる', (await snap()).page === 1)
  await context.close()
})

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 件 合格`)
process.exitCode = failed.length ? 1 : 0
