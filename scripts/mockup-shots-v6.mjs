// デザイン案 v6（デザイン1を機能に合わせて見直した版）の、いくつかの場面を画像に書き出す。
// 使い方: node scripts/mockup-shots-v6.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { withEdge } from './poc/edge.mjs'

const OUT = 'mockups/v6/screens'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

await withEdge(async (browser) => {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  const open = async (w, h) => {
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
    await page.goto('http://localhost:5173/mockups/v6/design-1b.html', { waitUntil: 'networkidle0' })
    await page.evaluate(() => document.fonts.ready)
  }
  const turn = async (n) => {
    for (let i = 0; i < n; i++) {
      await page.keyboard.press('ArrowRight')
      await wait(1100)
    }
  }
  const shot = async (name) => {
    await page.screenshot({ path: `${OUT}/${name}.png` })
    console.log(`${OUT}/${name}.png`)
  }

  // 1. 本文：段落を書いているところ。「段落」に重ねて、入る場所を示す
  await open(1440, 900)
  await turn(3)
  await page.hover('.tb[data-label="段落"]')
  await wait(200)
  await shot('1-body-paragraph')

  // 2. 本文：図を選んだところ
  await page.mouse.move(10, 10)
  const fig = await page.$('.page.current figure')
  await fig.click()
  await wait(200)
  await shot('2-body-figure')

  // 3. 表紙
  await open(1440, 900)
  await shot('3-cover')

  // 4. 作品写真
  await turn(5)
  await shot('4-photos')

  // 5. 小さいノートPC（1280×720）：全体と拡大
  await open(1280, 720)
  await turn(3)
  await shot('5-laptop-fit')
  await page.click('.zoom button[data-zoom="1"]')
  await wait(200)
  await shot('6-laptop-zoom')
})
