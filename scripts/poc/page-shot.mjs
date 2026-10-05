// 画面を画像にする（目視確認用）。ページのエラーも表示する。
// 使い方: node scripts/poc/page-shot.mjs <url> <out.png> [待つ条件の JS 式] [幅] [高さ]
import { withEdge } from './edge.mjs'

const [url, out, waitExpr = 'true', width = '1440', height = '900'] = process.argv.slice(2)

await withEdge(async (browser) => {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  page.on('console', (m) => m.type() === 'error' && console.log('console.error:', m.text()))
  await page.setViewport({ width: Number(width), height: Number(height), deviceScaleFactor: 1 })
  await page.goto(url, { waitUntil: 'networkidle0' })
  await page.waitForFunction(waitExpr, { timeout: 120000 })
  await new Promise((r) => setTimeout(r, 500))
  await page.screenshot({ path: out })
  console.log(`wrote ${out}`)
})
