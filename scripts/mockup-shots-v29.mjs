// デザイン案 v29（表紙と目次の調整）を撮る。開発サーバー（localhost:5173）が動いていること
// node scripts/mockup-shots-v29.mjs → mockups/v29/shots/
import { mkdirSync } from 'node:fs'
import { withEdge } from './poc/edge.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'mockups/v29/shots'
mkdirSync(OUT, { recursive: true })

await withEdge(async (browser) => {
  const page = await browser.newPage()
  await page.setViewport({ width: 2050, height: 1400, deviceScaleFactor: 2 })
  await page.goto(`${APP}/mockups/v29/index.html`, { waitUntil: 'networkidle0', timeout: 90000 })
  // iframe の中の字（Google Fonts）が読み込まれるのを待つ
  await page.waitForFunction(() => [...document.querySelectorAll('iframe')].length === 8 && [...document.querySelectorAll('iframe')].every((f) => f.contentDocument?.fonts?.status === 'loaded' && f.contentDocument.fonts.check('16px "BIZ UDPGothic"') && f.contentDocument.fonts.check('16px "BIZ UDMincho"')), { timeout: 60000 })
  await new Promise((r) => setTimeout(r, 800))
  await page.screenshot({ path: `${OUT}/review.png`, fullPage: true })
  for (const [id, name] of [['covers', 'cover'], ['tocs', 'toc']]) {
    const cells = await page.$$(`#${id} .cell`)
    for (const [i, c] of cells.entries()) await c.screenshot({ path: `${OUT}/${name}-${['now', 'a', 'b', 'c'][i]}.png` })
  }
  console.log('撮りました:', OUT)
})
