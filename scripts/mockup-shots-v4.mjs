// デザイン案 v4（道具を紙面のそばに置く3案）を画像に書き出す。
// 使い方: node scripts/mockup-shots-v4.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { withEdge } from './poc/edge.mjs'

mkdirSync('mockups/v4/screens', { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

await withEdge(async (browser) => {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  for (const [w, h] of [[1440, 900], [1280, 720]]) {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
    for (const name of ['tools-1', 'tools-2', 'tools-3']) {
      await page.goto(`http://localhost:5173/mockups/v4/${name}.html`, { waitUntil: 'networkidle0' })
      await page.evaluate(() => document.fonts.ready)
      // 本文1ページ目（4ページ目）まで送ってから撮る
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('ArrowRight')
        await wait(900)
      }
      const path = `mockups/v4/screens/${name}${w === 1440 ? '' : `-${w}`}.png`
      await page.screenshot({ path })
      console.log(path)
    }
  }
})
