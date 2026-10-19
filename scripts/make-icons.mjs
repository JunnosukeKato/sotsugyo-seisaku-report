// ホーム画面のアイコンとブラウザのタブの印を作る（mockups/v40 案B：紺地に白い「卒」。依頼者の選択）。
// 「卒」は BIZ UD明朝（@fontsource。ツールの中の印と同じ書体）で描き、PNG にして public/icons/ に置く。
// 使い方：node scripts/make-icons.mjs（Edge を使う。EDGE_PORT でポートを変えられる）
import { mkdirSync, readFileSync } from 'node:fs'
import { withEdge } from './poc/edge.mjs'

const OUT = 'public/icons'
const ACCENT = '#2f3e75'
const font = readFileSync('node_modules/@fontsource/biz-udmincho/files/biz-udmincho-japanese-400-normal.woff2').toString('base64')

/**
 * 作る絵（size：一辺の点の数）。
 * 角は丸めない（iPhone・Android が自分の形に切り抜くため）。タブの小さな印だけは角を丸める。
 * 「卒」は真ん中の約半分の大きさ（Android の切り抜き〔maskable〕で切れない範囲に収まる）
 */
const ICONS = [
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-192.png', size: 192 },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'favicon-48.png', size: 48, round: true },
  { file: 'favicon-32.png', size: 32, round: true },
]

const html = (size, round) => `<!doctype html><html><head><style>
@font-face { font-family: 'Mincho'; src: url(data:font/woff2;base64,${font}) format('woff2'); }
html, body { margin: 0; background: transparent; }
.icon { width: ${size}px; height: ${size}px; display: grid; place-items: center; background: ${ACCENT}; border-radius: ${round ? Math.round(size * 0.2) : 0}px; }
.k { color: #fff; font-family: 'Mincho'; font-size: ${Math.round(size * (round ? 0.72 : 0.53))}px; line-height: 1; transform: translateY(${round ? 0 : -size * 0.01}px); }
</style></head><body><div class="icon"><span class="k">卒</span></div></body></html>`

mkdirSync(OUT, { recursive: true })
await withEdge(async (browser) => {
  const page = await browser.newPage()
  for (const { file, size, round } of ICONS) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 })
    await page.setContent(html(size, round), { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${OUT}/${file}`, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } })
    console.log(`${OUT}/${file}`)
  }
})
