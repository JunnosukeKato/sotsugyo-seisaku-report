// デザイン案 v8（学生の最初の画面・管理ページのひな形の編集）を画像に書き出す。
// 使い方: node scripts/mockup-shots-v8.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { withEdge } from './poc/edge.mjs'

const OUT = 'mockups/v8/screens'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

await withEdge(async (browser) => {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  const shot = async (name, w, h, mobile = false) => {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile })
    await page.goto(`http://localhost:5173/mockups/v8/${name}.html`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => document.fonts.ready)
    await wait(400)
    const path = `${OUT}/${name}${mobile ? '-phone' : ''}.png`
    await page.screenshot({ path })
    console.log(path)
  }
  for (const name of ['start-1', 'start-2', 'start-3']) {
    await shot(name, 1440, 900)
    await shot(name, 390, 844, true)
  }
  for (const name of ['template-1', 'template-2', 'template-3']) await shot(name, 1440, 900)
})
