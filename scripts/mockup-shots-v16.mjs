// デザイン案 v16（表：画像を入れられる表と、列の幅）と、v14・v15 の比べる画像を書き出す。
// 使い方: node scripts/mockup-shots-v16.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { withEdge } from './poc/edge.mjs'

mkdirSync('mockups/v16/screens', { recursive: true })
await withEdge(async (browser) => {
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1.5 })
  for (const [url, out] of [
    ['mockups/v16/tables.html', 'mockups/v16/screens/tables.png'],
    ['mockups/v14/errors.html', 'mockups/v14/screens/errors.png'],
    ['mockups/v15/thumbs.html', 'mockups/v15/screens/thumbs.png'],
  ]) {
    await page.goto(`http://localhost:5173/${url}`, { waitUntil: 'networkidle0' })
    await page.screenshot({ path: out, fullPage: true })
    console.log(out)
  }
})
