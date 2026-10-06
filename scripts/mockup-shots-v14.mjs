// デザイン案 v14（エラー・注意の箇所を、紙面の上で気づきやすくする）を画像に書き出す。
// 学生用ツールで誤りを含む本文を作り、見せ方だけを差し替えて撮る（まだ作っていない部品は、撮影のためだけに足す）。
// 使い方: node scripts/mockup-shots-v14.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { withEdge } from './poc/edge.mjs'
import { stubConfig } from './e2e/configStub.mjs'

const OUT = 'mockups/v14/screens'
mkdirSync(OUT, { recursive: true })

const PARAGRAPHS = [
  '本制作は、卒業イベント「シンドバッド」において、主人公シンドバッドの衣装を制作したものである。七つの航海を経て成長していく主人公の姿を、衣装の色と形で表すことを目標とした。',
  '私は、中東の伝統的な装いについて資料を集め、１５世紀の上着の丈や袖の形、帯の巻き方を調べた。そのうえで、舞台の上で動きやすく、遠くの客席からも形がわかるよう、袖を大きく広げたデザインにした（図1）。',
  '素材は、光沢のあるサテンと、張りのあるリネンを組み合わせた。サテンは照明を受けて輝き、航海の華やかさを表す。',
]

// 紙面の上で、エラーのある行の位置（画面座標）を求める
const errorRects = () => {
  const h = CSS.highlights.get('issue-error')
  const rects = []
  for (const r of h ?? []) for (const c of r.getClientRects()) if (c.width > 0) rects.push({ top: c.top, bottom: c.bottom, left: c.left })
  return rects
}

const VARIANTS = {
  now: null,
  // 案1：文字そのものを濃く示す（太い下線と、はっきりした背景）
  a: () => {
    const s = document.createElement('style')
    s.textContent = `::highlight(issue-error) { text-decoration: underline 2px solid #c62828; text-underline-offset: 3px; background-color: rgba(198, 40, 40, 0.16); color: #b71c1c; }
      ::highlight(issue-warning) { text-decoration: underline 2px solid #c98a00; text-underline-offset: 3px; background-color: rgba(201, 138, 0, 0.16); }`
    document.head.append(s)
  },
  // 案2：今の波線に加えて、行の左の余白に赤い印（遠目にもどこにあるかわかる）
  b: (rectsSrc) => {
    const rects = eval(rectsSrc)()
    const page = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current').getBoundingClientRect()
    const seen = new Set()
    for (const r of rects) {
      const key = Math.round(r.top / 4)
      if (seen.has(key)) continue
      seen.add(key)
      const dot = document.createElement('div')
      dot.style.cssText = `position:fixed;z-index:30;left:${page.left + page.width * 0.08}px;top:${(r.top + r.bottom) / 2 - 5}px;width:10px;height:10px;border-radius:50%;background:#d32f2f;box-shadow:0 0 0 2px #fff`
      document.body.append(dot)
    }
  },
  // 案3：余白に番号札。右のセルフチェックの一覧にも同じ番号を付ける（番号で、どの指摘がどこかがわかる）
  c: () => {
    const page = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current').getBoundingClientRect()
    const snap = window.__editor.getSnapshot()
    const ids = new Set([...document.querySelectorAll('.page-viewport.front [data-vivliostyle-page-container].is-current [data-block-id]')].map((e) => e.dataset.blockId))
    const onPage = snap.findings.filter((f) => f.area === 'body' && f.blockId && ids.has(f.blockId))
    const perLine = new Map()
    onPage.forEach((f, i) => {
      const el = document.querySelector(`.page-viewport.front [data-vivliostyle-page-container].is-current [data-block-id="${f.blockId}"]`)
      let r = el.getBoundingClientRect()
      if (f.start !== undefined) {
        const ranges = []
        for (const h of [CSS.highlights.get('issue-error'), CSS.highlights.get('issue-warning')]) for (const x of h ?? []) ranges.push(x)
        const hit = ranges.find((x) => el.contains(x.startContainer) && x.startOffset === f.start)
        if (hit) r = hit.getClientRects()[0] ?? r
      }
      // 同じ行（上下 10px 以内）の札は、横に並べる
      const key = [...perLine.keys()].find((t) => Math.abs(t - r.top) < 10) ?? r.top
      const k = perLine.get(key) ?? 0
      perLine.set(key, k + 1)
      const tag = document.createElement('div')
      tag.textContent = String(i + 1)
      const color = f.severity === 'error' ? '#d32f2f' : '#c98a00'
      tag.style.cssText = `position:fixed;z-index:30;left:${page.left + page.width * 0.068 + k * 21}px;top:${r.top + Math.min(r.height, 20) / 2 - 9}px;width:18px;height:18px;border-radius:50%;background:${color};color:#fff;font:700 11px/18px sans-serif;text-align:center`
      document.body.append(tag)
    })
    const group = [...document.querySelectorAll('.side .igroup')].find((g) => g.querySelector('.ig-h')?.textContent.startsWith('本文'))
    if (group) {
      group.scrollIntoView({ block: 'start' })
      const items = [...group.querySelectorAll('li.issue')]
      onPage.forEach((f, i) => {
        const li = items.find((x) => x.querySelector('.ttl')?.firstChild?.textContent === f.title && !x.dataset.numbered)
        if (!li) return
        li.dataset.numbered = '1'
        const b = document.createElement('span')
        b.textContent = String(i + 1)
        b.style.cssText = `display:inline-block;width:16px;height:16px;margin-right:6px;border-radius:50%;background:${f.severity === 'error' ? '#d32f2f' : '#c98a00'};color:#fff;font:700 10px/16px sans-serif;text-align:center;vertical-align:1px`
        li.querySelector('.ttl').prepend(b)
      })
    }
  },
}

// どの案も：タイトルが空の図は、タイトルの欄を赤い枠と赤い字で示す
const EMPTY_CAPTION = `.page-viewport figcaption [data-block-id]:empty::before { content: '（図のタイトルを入力）' !important; color: #d32f2f !important; }
  .page-viewport figcaption [data-block-id]:empty { outline: 1.5px dashed #d32f2f; outline-offset: 2px; }`

await withEdge(async (browser) => {
  for (const [key, inject] of Object.entries(VARIANTS)) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await stubConfig(page)
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 })
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
    const ready = () => page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning }, { timeout: 90000 })
    await ready()
    await page.addStyleTag({ content: '.guide { display: none !important; }' })
    await page.evaluate((paragraphs) => {
      const blocks = [
        { type: 'paragraph', id: 'ep0', content: [{ type: 'text', text: paragraphs[0] }] },
        { type: 'paragraph', id: 'ep1', content: [{ type: 'text', text: paragraphs[1].replace('（図1）', '') }, { type: 'ref', targetId: 'ef1', withParens: true }, { type: 'text', text: '。' }] },
        { type: 'figureRow', id: 'er1', figures: [{ id: 'ef1', imageId: '', caption: '' }] },
        { type: 'paragraph', id: 'ep2', content: [{ type: 'text', text: paragraphs[2] }] },
      ]
      blocks[1].content[0].text = blocks[1].content[0].text.replace(/。$/, '')
      window.__editor.update((r) => ({ ...r, body: [{ id: 'ec1', title: '制作過程', blocks }, ...r.body.slice(1)] }))
    }, PARAGRAPHS)
    await new Promise((r) => setTimeout(r, 300))
    await ready()
    await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('ep1'), 'none'))
    await ready()
    if (key !== 'now') await page.addStyleTag({ content: EMPTY_CAPTION })
    if (inject) await page.evaluate(inject, `(${errorRects.toString()})`)
    await page.evaluate(() => [...document.querySelectorAll('.side .igroup')].find((g) => g.querySelector('.ig-h')?.textContent.startsWith('本文'))?.scrollIntoView({ block: 'start' }))
    await new Promise((r) => setTimeout(r, 300))
    await page.screenshot({ path: `${OUT}/${key}.png` })
    console.log(`${OUT}/${key}.png`)
    await context.close()
  }
})
