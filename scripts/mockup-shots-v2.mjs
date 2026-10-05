// デザイン案 v2（1ページ全面表示）を画像に書き出す。めくる途中の画像も撮る。
// 使い方: node scripts/mockup-shots-v2.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { withEdge } from './poc/edge.mjs'

mkdirSync('mockups/v2/screens', { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

await withEdge(async (browser) => {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  for (const name of ['layout-1', 'layout-2', 'layout-3']) {
    await page.goto(`http://localhost:5173/mockups/v2/${name}.html`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => document.fonts.ready)
    // 本文1ページ目（4ページ目）まで送ってから撮る
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('ArrowRight')
      await wait(800)
    }
    await page.screenshot({ path: `mockups/v2/screens/${name}.png` })
    console.log(`mockups/v2/screens/${name}.png`)
  }
  // めくる途中
  await page.goto('http://localhost:5173/mockups/v2/layout-1.html', { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  // めくりの動きは CSS アニメーションのため、途中で一時停止させて撮る
  await page.keyboard.press('ArrowRight')
  await wait(50)
  await page.evaluate(() => {
    for (const a of document.getAnimations()) {
      a.pause()
      a.currentTime = 230
    }
  })
  await wait(100)
  await page.screenshot({ path: 'mockups/v2/screens/turning.png' })
  console.log('mockups/v2/screens/turning.png')
})
