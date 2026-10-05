// PDF をページごとの画像として並べた1枚の PNG にする（目視確認用）。
// 使い方: node scripts/poc/pdf-shots.mjs <file.pdf（app からの相対パス）> <out.png> [scale] [width]
import { withEdge } from './edge.mjs'

const [file, out, scale = '0.5', width = '1400'] = process.argv.slice(2)

await withEdge(async (browser) => {
  const page = await browser.newPage()
  await page.setViewport({ width: Number(width), height: 900, deviceScaleFactor: 1 })
  await page.goto(`http://localhost:5173/poc-pdf.html?file=${encodeURIComponent(file)}&scale=${scale}`, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => document.body.dataset.rendered === 'true', { timeout: 120000 })
  await page.addStyleTag({ content: 'body{flex-direction:row!important;flex-wrap:wrap;align-items:flex-start!important;justify-content:center}' })
  await page.screenshot({ path: out, fullPage: true })
  console.log(`wrote ${out}`)
})
