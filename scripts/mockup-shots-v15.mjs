// デザイン案 v15（ページの一覧を左に縦に並べる。PowerPoint のように）を画像に書き出す。
// 学生用ツールで、右の欄にあるページの一覧を、案ごとの位置へ仮に動かして撮る。
// 使い方: node scripts/mockup-shots-v15.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { withEdge } from './poc/edge.mjs'
import { stubConfig } from './e2e/configStub.mjs'

const OUT = 'mockups/v15/screens'
mkdirSync(OUT, { recursive: true })

// ページの一覧を縦一列にし、見本を大きくする
const VERTICAL = `.mock-thumbs .thumb-list { grid-template-columns: 1fr !important; max-height: none !important; gap: 14px 0 !important; overflow: visible !important; }
  .mock-thumbs .thumb-list .mini { zoom: 1.55; }
  .mock-thumbs .sec-h { font-size: 11.5px; margin-bottom: 10px; display: flex; justify-content: space-between; white-space: nowrap; }
  .mock-thumbs .sec-h .pcount { font-size: 11px; }
  .mock-thumbs .add-refs { font-size: 10.5px; }`

const VARIANTS = {
  now: null,
  // 案1：紙面の左の余白（いまは空いているところ）に縦一列。紙面の大きさは変わらない
  a: (css) => {
    // ページの一覧だけを動かす（引用・参考文献の入口は右の欄に残す）
    const old = document.querySelector('.side .sec.pages')
    const sec = document.createElement('section')
    sec.className = 'sec pages'
    sec.append(old.querySelector('.sec-h'), old.querySelector('.thumb-list'))
    const box = document.createElement('div')
    box.className = 'mock-thumbs'
    box.style.cssText = 'position:absolute;z-index:9;left:14px;top:14px;bottom:14px;width:104px;overflow-y:auto;padding:10px 8px;background:rgba(255,255,255,0.7);border:1px solid var(--line);border-radius:14px'
    box.append(sec)
    document.querySelector('.stage').append(box)
    const s = document.createElement('style')
    s.textContent = css + ' .arrow.prev { left: calc(50% - var(--page-w) / 2 - 70px) !important; top: auto !important; bottom: 40px; }'
    document.head.append(s)
  },
  // 案2：画面の左端に、一覧の欄を設ける（PowerPoint と同じ形。紙面は少し小さくなる）
  b: (css) => {
    // ページの一覧だけを動かす（引用・参考文献の入口は右の欄に残す）
    const old = document.querySelector('.side .sec.pages')
    const sec = document.createElement('section')
    sec.className = 'sec pages'
    sec.append(old.querySelector('.sec-h'), old.querySelector('.thumb-list'))
    const box = document.createElement('aside')
    box.className = 'mock-thumbs'
    box.style.cssText = 'overflow-y:auto;padding:14px 10px;background:var(--panel-bg);border-right:1px solid var(--line)'
    box.append(sec)
    const app = document.querySelector('.app')
    app.prepend(box)
    const s = document.createElement('style')
    s.textContent = css + ' .app { grid-template-columns: 124px minmax(0, 1fr) 312px !important; }'
    document.head.append(s)
  },
  // 案3：一覧を紙面のすぐ左に置き、道具は紙面の右わきへ移す
  c: (css) => {
    // ページの一覧だけを動かす（引用・参考文献の入口は右の欄に残す）
    const old = document.querySelector('.side .sec.pages')
    const sec = document.createElement('section')
    sec.className = 'sec pages'
    sec.append(old.querySelector('.sec-h'), old.querySelector('.thumb-list'))
    const box = document.createElement('div')
    box.className = 'mock-thumbs'
    box.style.cssText = 'position:absolute;z-index:9;left:calc(50% - var(--page-w) / 2 - 122px);top:var(--page-top);bottom:14px;width:104px;overflow-y:auto;padding:4px 8px'
    box.append(sec)
    document.querySelector('.stage').append(box)
    const s = document.createElement('style')
    s.textContent = css + ' .palette { left: calc(50% + var(--page-w) / 2 + 18px) !important; } .arrow.next { left: calc(50% + var(--page-w) / 2 + 30px) !important; right: auto !important; top: auto !important; bottom: 40px; translate: none; } .arrow.prev { display: none; }'
    document.head.append(s)
  },
}

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
    await page.evaluate(() => document.querySelector('.g-opts button')?.click())
    await new Promise((r) => setTimeout(r, 500))
    await ready()
    await page.evaluate(() => window.__editor.goToPage(3, 'none'))
    await ready()
    if (inject) await page.evaluate(inject, VERTICAL)
    await new Promise((r) => setTimeout(r, 1200))
    await page.screenshot({ path: `${OUT}/${key}.png` })
    console.log(`${OUT}/${key}.png`)
    await context.close()
  }
})
