// デザイン案 v11（作品写真のページ）を画像に書き出す。
// 使い方: node scripts/mockup-shots-v11.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { withEdge } from './poc/edge.mjs'

mkdirSync('mockups/v11/screens', { recursive: true })
await withEdge(async (browser) => {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1.5 })
  await page.goto('http://localhost:5173/mockups/v11/photos.html', { waitUntil: 'networkidle0' })
  await new Promise((r) => setTimeout(r, 500))
  await page.screenshot({ path: 'mockups/v11/screens/photos.png', fullPage: true })
  console.log('mockups/v11/screens/photos.png')
})
