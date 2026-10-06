// デザイン案 v9（抄録の見出しの並べ方）を画像に書き出す。
// 使い方: node scripts/mockup-shots-v9.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { withEdge } from './poc/edge.mjs'

mkdirSync('mockups/v9/screens', { recursive: true })
await withEdge(async (browser) => {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  await page.setViewport({ width: 1400, height: 820, deviceScaleFactor: 1.5 })
  await page.goto('http://localhost:5173/mockups/v9/abstract.html', { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  await new Promise((r) => setTimeout(r, 500))
  await page.screenshot({ path: 'mockups/v9/screens/abstract.png', fullPage: true })
  console.log('mockups/v9/screens/abstract.png')
})
