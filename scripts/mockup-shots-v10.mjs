// デザイン案 v10（文字を書いているときの見え方）を画像に書き出す。
// 学生用ツールで本文の段落を書いている状態にし、入力欄の見せ方だけを差し替えて撮る。
// 使い方: node scripts/mockup-shots-v10.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { withEdge } from './poc/edge.mjs'

const OUT = 'mockups/v10/screens'
mkdirSync(OUT, { recursive: true })

const VARIANTS = {
  now: '',
  // 案1：枠なし。カーソルだけ（Word・Google ドキュメントと同じ）
  a: `.overlay-editor { outline: none !important; }`,
  // 案2：枠なし＋左の余白に細い線（どの段落を書いているかだけを示す）
  b: `.overlay-editor { outline: none !important; overflow: visible; }
      .overlay-clip { overflow: visible !important; }
      .overlay-editor::before { content: ''; position: absolute; left: -16px; top: 2px; bottom: 2px; width: 3px; border-radius: 2px; background: var(--accent); opacity: 0.55; }`,
  // 案3：枠なし＋ごく薄い色（書いている段落を、ほんのり色づける）
  c: `.overlay-editor { outline: none !important; background: #f3f5fb !important; box-shadow: 0 0 0 5px #f3f5fb; }`,
}

const PARAGRAPHS = [
  '本制作は、卒業イベント「シンドバッド」において、主人公シンドバッドの衣装を制作したものである。七つの航海を経て成長していく主人公の姿を、衣装の色と形の変化で表すことを目標とした。',
  'まず、中東の伝統的な装いについて資料を集め、上着の丈や袖の形、帯の巻き方を調べた。そのうえで、舞台の上で動きやすく、遠くの客席からも形がわかるよう、袖を大きく広げたデザインにした。',
  '素材は、光沢のあるサテンと、張りのあるリネンを組み合わせた。サテンは照明を受けて輝き、航海の華やかさを表す。リネンは形を保ちやすく、袖の広がりを支える役割を持たせた。',
  'トワルを組んで形を確かめたところ、袖が重く、腕を上げたときに肩が引きつれることがわかった。そこで袖の付け位置を下げ、まちを入れて動きやすくした。',
]

await withEdge(async (browser) => {
  for (const [key, css] of Object.entries(VARIANTS)) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    // 文字のカーソルが写るよう、画面に入力のフォーカスがある状態にする
    const cdp = await page.createCDPSession()
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
    const ready = () => page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning }, { timeout: 60000 })
    await ready()
    await page.evaluate(() => document.querySelector('.g-opts button').click())
    await page.waitForSelector('.g-later')
    await page.click('.g-later')
    await ready()
    await page.evaluate((paragraphs) => {
      const blocks = paragraphs.map((text, i) => ({ type: 'paragraph', id: `mp${i}`, content: [{ type: 'text', text }] }))
      window.__editor.update((r) => ({ ...r, body: [{ id: 'mc1', title: '制作過程', blocks: [{ type: 'subheading', id: 'ms1', title: 'デザインと素材' }, ...blocks] }, ...r.body.slice(1)] }))
    }, PARAGRAPHS)
    await new Promise((r) => setTimeout(r, 300))
    await ready()
    await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('mp1'), 'none'))
    await ready()
    if (css) await page.addStyleTag({ content: css })
    // 2つ目の段落の途中をクリックして、書いている状態にする
    const box = await page.evaluate(() => {
      const r = [...document.querySelectorAll('.page-viewport.front [data-block-id="mp1"]')].find((e) => e.getBoundingClientRect().width > 0).getBoundingClientRect()
      return { x: r.left + r.width * 0.55, y: r.top + 30 }
    })
    await page.mouse.click(box.x, box.y)
    await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'mp1')
    // 「動きやすく、」の後ろにカーソルを置いて書き足す
    await page.evaluate(() => {
      const ed = document.querySelector('.overlay-editor')
      const node = ed.firstChild
      const at = node.textContent.indexOf('動きやすく、') + '動きやすく、'.length
      const range = document.createRange()
      range.setStart(node, at)
      range.collapse(true)
      getSelection().removeAllRanges()
      getSelection().addRange(range)
    })
    await page.keyboard.type('そで口に金の刺しゅうを入れ、')
    await new Promise((r) => setTimeout(r, 700))
    const clip = await page.evaluate(() => {
      const r = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current').getBoundingClientRect()
      return { x: r.left + r.width * 0.08, y: r.top + r.height * 0.06, width: r.width * 0.84, height: r.height * 0.36 }
    })
    // カーソルは点滅するため、カーソルを動かした直後（点滅が始まる前）に撮る
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowRight')
    await page.screenshot({ path: `${OUT}/${key}.png`, clip })
    console.log(`${OUT}/${key}.png`)
    await context.close()
  }
  // 4枚を並べた比較の画像
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 })
  await page.goto('http://localhost:5173/mockups/v10/typing.html', { waitUntil: 'networkidle0' })
  await page.screenshot({ path: `${OUT}/typing.png`, fullPage: true })
  console.log(`${OUT}/typing.png`)
})
