// 表紙と目次の組版を、本物のツール（開発サーバー）で PDF のページ画像にして確かめる（mockups/v29 の反映の確かめ）
// node scripts/check-cover-toc.mjs [出力フォルダ] → 表紙・目次の画像と、見本の原稿の PDF
import { writeFileSync, mkdirSync } from 'node:fs'
import { withEdge } from './poc/edge.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = process.argv[2] ?? 'poc-output/cover-toc'
mkdirSync(OUT, { recursive: true })
const { setupWriting } = await import('./e2e/sampleReport.mjs')

await withEdge(async (browser) => {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  })
  await page.setViewport({ width: 1400, height: 900 })
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0', timeout: 90000 })
  await page.waitForSelector('.guide .g-opts button', { timeout: 60000 })
  await page.evaluate(() => [...document.querySelectorAll('.guide .g-opts button')].find((b) => b.textContent.includes('映画・舞台衣装')).click())
  await page.waitForSelector('.g-word-opt.no', { timeout: 60000 })
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.guide .g-later', { timeout: 60000 })
  await page.evaluate(() => document.querySelector('.guide .g-later').click())
  const ready = () => page.waitForFunction(() => {
    const s = window.__editor?.getSnapshot()
    return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading')
  }, { timeout: 120000 })
  await ready()
  await page.evaluate(setupWriting)
  await new Promise((r) => setTimeout(r, 1500))
  await ready()
  // 学籍番号も入れて、表紙の欄をすべて埋める
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, studentId: '00ZZ0123' } })))
  await new Promise((r) => setTimeout(r, 1500))
  await ready()
  const result = await page.evaluate(async () => {
    const { pagesToPdf } = await import('/src/pdf/pagesToPdf.ts')
    const shots = []
    const r = await pagesToPdf(window.__editor.pageElements(), {
      onPage: (p) => {
        if (p.index > 2) return
        shots.push(p.canvas.toDataURL('image/png'))
      },
    })
    const buf = new Uint8Array(await r.blob.arrayBuffer())
    let bin = ''
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000))
    return { shots, pdf: btoa(bin) }
  })
  const names = ['1-表紙', '2-抄録', '3-目次']
  result.shots.forEach((u, i) => writeFileSync(`${OUT}/${names[i]}.png`, Buffer.from(u.split(',')[1], 'base64')))
  writeFileSync(`${OUT}/見本の原稿.pdf`, Buffer.from(result.pdf, 'base64'))
  console.log('書き出しました:', OUT)
})
