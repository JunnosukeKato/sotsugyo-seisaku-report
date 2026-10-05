// デザイン案 v7（スマホ版の3案）を、見る／書くの2画面を並べた画像に書き出す。
// 使い方: node scripts/mockup-shots-v7.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { withEdge } from './poc/edge.mjs'

const OUT = 'mockups/v7/screens'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

await withEdge(async (browser) => {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  for (const opt of ['1', '2', '3', 'check']) {
    await page.setViewport({ width: opt === 'check' ? 480 : 920, height: 1010, deviceScaleFactor: 1.5 })
    await page.goto(`http://localhost:5173/mockups/v7/board.html?opt=${opt}`, { waitUntil: 'networkidle0' })
    await wait(1500)
    await page.screenshot({ path: `${OUT}/phone-${opt}.png` })
    console.log(`${OUT}/phone-${opt}.png`)
  }
})
