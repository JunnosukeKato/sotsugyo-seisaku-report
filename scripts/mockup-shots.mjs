// デザイン案（mockups/*.html）を画像に書き出す。確認用に送る・比べるためのもの。
// 使い方: node scripts/mockup-shots.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { withEdge } from './poc/edge.mjs'

const NAMES = ['student-a', 'student-b', 'student-c', 'admin-1', 'admin-2']
mkdirSync('mockups/screens', { recursive: true })

await withEdge(async (browser) => {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  for (const name of NAMES) {
    await page.goto(`http://localhost:5173/mockups/${name}.html`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `mockups/screens/${name}.png` })
    console.log(`mockups/screens/${name}.png`)
  }
})
