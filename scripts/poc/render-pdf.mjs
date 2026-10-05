// PoC: 試作ページを Edge（Chromium）で開き、組版完了を待って PDF に書き出す。
// 学生がブラウザの「PDFに保存」を使った場合と同じ印刷処理になる。
// 使い方: node scripts/poc/render-pdf.mjs [url] [out.pdf]
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { withEdge } from './edge.mjs'

const [url = 'http://localhost:5173/poc.html', out = 'poc-output/body.pdf'] = process.argv.slice(2)

mkdirSync(dirname(out), { recursive: true })
await withEdge(async (browser) => {
  const page = await browser.newPage()
  await page.goto(url, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => window.__pocLayoutDone || window.__pocError, { timeout: 120000 })
  const error = await page.evaluate(() => window.__pocError)
  if (error) throw new Error(error)
  await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true })
  console.log(`wrote ${out}`)
})
