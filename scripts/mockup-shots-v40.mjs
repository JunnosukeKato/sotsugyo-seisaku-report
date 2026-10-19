// 見本 v40（スマホのホーム画面のアイコン）の絵を撮る：mockups/v40/icons.html → mockups/v40/shots/review-icons.png
// 開発サーバー（http://localhost:5173）が動いていること。EDGE_PORT で Edge のポートを変えられる
import { mkdirSync } from 'node:fs'
import { withEdge } from './poc/edge.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
mkdirSync('mockups/v40/shots', { recursive: true })

await withEdge(async (browser) => {
  const page = await browser.newPage()
  await page.setViewport({ width: 1244, height: 900, deviceScaleFactor: 1 })
  await page.goto(`${APP}/mockups/v40/icons.html`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: 'mockups/v40/shots/review-icons.png', fullPage: true })
  console.log('mockups/v40/shots/review-icons.png')
})
