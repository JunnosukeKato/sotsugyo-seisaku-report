// デザイン案 v12（学生が入れた改ページの印の見え方）を画像に書き出す。
// 学生用ツールで改ページを入れた紙面を作り、印の見せ方だけを差し替えて撮る。
// 使い方: node scripts/mockup-shots-v12.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { withEdge } from './poc/edge.mjs'

const OUT = 'mockups/v12/screens'
mkdirSync(OUT, { recursive: true })

const VARIANTS = {
  // 案A：点線と「改ページ」の文字（Word の編集記号に近い）
  a: '',
  // 案B：細い線の中央に札を出す
  b: `.page-viewport .page-break::after { content: ''; border-top: 1.5px solid #b7bdd6; height: 0; top: 4mm; }
      .page-viewport .page-break[data-block-id]::before { content: '改ページ　ここから次のページ'; position: absolute; left: 50%; top: 4mm; translate: -50% -50%; padding: 1mm 4mm; border-radius: 4mm; background: #eef0f8; color: #5d6893; font-family: 'BIZ UDPGothic', sans-serif; font-size: 8pt; letter-spacing: 0.1em; white-space: nowrap; z-index: 1; }`,
  // 案C：ページの残り（空白になるところ）を薄い斜線で示す
  c: `.page-viewport .page-break::after { content: '改ページ（ここから下は空白になります）'; top: 2mm; height: var(--rest, 60mm); border-top: 1px dashed #9aa3c4; align-items: flex-start; padding-top: 3mm; background: repeating-linear-gradient(135deg, rgba(154, 163, 196, 0.12) 0 6px, transparent 6px 12px); }`,
}

const kana = '本制作では、衣装の素材や形を検討し、舞台の上での見え方を確かめながら制作を進めた。'

await withEdge(async (browser) => {
  for (const [key, css] of Object.entries(VARIANTS)) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 })
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
    const ready = () => page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning }, { timeout: 60000 })
    await ready()
    // はじめての案内は撮らない（コース選びは学科の設定の読み込みを待つため、案内を使わずに本文を入れる）
    await page.addStyleTag({ content: '.guide { display: none !important; }' })
    await page.evaluate((kana) => {
      const text = (n) => Array.from({ length: n }, (_, i) => kana[i % kana.length]).join('')
      const body = [{ id: 'mc1', title: '制作過程', blocks: [
        { type: 'paragraph', id: 'mpA', content: [{ type: 'text', text: text(700) }] },
        { type: 'pageBreak', id: 'mpb' },
        { type: 'subheading', id: 'mps', title: '素材' },
        { type: 'paragraph', id: 'mpB', content: [{ type: 'text', text: text(300) }] },
      ] }]
      window.__editor.update((r) => ({ ...r, body }))
    }, kana)
    await new Promise((r) => setTimeout(r, 300))
    await ready()
    await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('mpA'), 'none'))
    await ready()
    // 案C：改ページから本文の領域の下端までの高さ
    await page.evaluate(() => {
      const el = document.querySelector('.page-viewport.front .page-break')
      const p = el.closest('[data-vivliostyle-page-container]').getBoundingClientRect()
      const s = p.height / 297
      const restMm = 272 - (el.getBoundingClientRect().top - p.top) / s - 2
      el.style.setProperty('--rest', `${restMm}mm`)
    })
    if (css) await page.addStyleTag({ content: css })
    await new Promise((r) => setTimeout(r, 300))
    const clip = await page.evaluate(() => { const r = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current').getBoundingClientRect(); return { x: r.left, y: r.top + r.height * 0.3, width: r.width, height: r.height * 0.66 } })
    await page.screenshot({ path: `${OUT}/${key}.png`, clip })
    console.log(`${OUT}/${key}.png`)
    await context.close()
  }
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 })
  await page.goto('http://localhost:5173/mockups/v12/pagebreak.html', { waitUntil: 'networkidle0' })
  await page.screenshot({ path: `${OUT}/pagebreak.png`, fullPage: true })
  console.log(`${OUT}/pagebreak.png`)
})
