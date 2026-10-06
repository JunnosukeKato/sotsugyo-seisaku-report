// デザイン案 v13（抄録は先生の許可が出てから書く：許可が出る前の抄録のページ）を画像に書き出す。
// 学生用ツールの抄録のページに、案ごとの部品を仮に重ねて撮る（まだ作っていない部品は、この撮影のためだけに足す）。
// 使い方: node scripts/mockup-shots-v13.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { withEdge } from './poc/edge.mjs'

const OUT = 'mockups/v13/screens'
mkdirSync(OUT, { recursive: true })

const MESSAGE = '抄録は、本文を書き終えて、先生のチェックで許可が出てから書きます。'

const VARIANTS = {
  // 案1：抄録のページに案内とボタン
  a: (message) => {
    const body = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current .abstract .body')
    body.querySelectorAll('p').forEach((p) => (p.style.visibility = 'hidden'))
    const box = document.createElement('div')
    box.style.cssText = 'position:absolute;left:0;right:0;top:6mm;padding:9mm 8mm;border:1.2px dashed #9aa3c4;border-radius:3mm;background:#f6f7fb;text-align:center;font-family:"BIZ UDPGothic",sans-serif;text-indent:0;letter-spacing:0.04em;line-height:1.8;color:#3f4660'
    box.innerHTML = `<div style="font-size:11pt;font-weight:700;margin-bottom:2mm">${message}</div><div style="font-size:9pt;color:#6b7290;margin-bottom:6mm">許可が出たら、下のボタンを押してください（このページは PDF では空欄のままです）。</div><span style="display:inline-block;padding:3mm 8mm;border-radius:2.5mm;background:#2f3e75;color:#fff;font-size:10.5pt;font-weight:700">先生の許可が出た（抄録を書き始める）</span>`
    body.style.position = 'relative'
    body.append(box)
  },
  // 案2：紙面には案内の文字だけ。ボタンは左の道具
  b: (message) => {
    const body = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current .abstract .body')
    const p = body.querySelector('p')
    p.removeAttribute('data-placeholder')
    p.setAttribute('data-placeholder', `（${message}許可が出たら、左の道具の「許可が出た」を押します）`)
    const palette = document.querySelector('.palette')
    const group = document.createElement('div')
    group.className = 'group ctx'
    group.innerHTML = `<div class="ctx-label">抄録</div><button class="tb"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span>許可が出た</span></button>`
    palette.insertBefore(group, palette.lastElementChild)
  },
  // 案3：抄録をクリックすると確認の窓
  c: (message) => {
    const body = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current .abstract .body')
    const p = body.querySelector('p')
    p.setAttribute('data-placeholder', '（抄録は、先生の許可が出てから書きます。クリックして始めます）')
    const back = document.createElement('div')
    back.className = 'modal-backdrop'
    back.innerHTML = `<div class="modal" role="dialog"><header><h2>抄録を書き始めますか？</h2><button class="close">×</button></header><p class="lead">${message}<br>先生の許可は出ましたか？</p><div class="row-buttons"><span class="spacer"></span><button>まだ（閉じる）</button><button class="primary">許可が出た（書き始める）</button></div></div>`
    document.body.append(back)
  },
}

await withEdge(async (browser) => {
  for (const [key, inject] of Object.entries(VARIANTS)) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 })
    await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
    const ready = () => page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning }, { timeout: 90000 })
    await ready()
    await page.addStyleTag({ content: '.guide { display: none !important; }' })
    await page.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, studentId: '00ZZ0123', name: '文化　花子', subtitleInput: 'シンドバッド' } })))
    await new Promise((r) => setTimeout(r, 300))
    await ready()
    await page.evaluate(() => window.__editor.goToArea('abstract'))
    await ready()
    await page.evaluate(inject, MESSAGE)
    await new Promise((r) => setTimeout(r, 300))
    await page.screenshot({ path: `${OUT}/${key}.png` })
    console.log(`${OUT}/${key}.png`)
    await context.close()
  }
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 })
  await page.goto('http://localhost:5173/mockups/v13/abstract-lock.html', { waitUntil: 'networkidle0' })
  await page.screenshot({ path: `${OUT}/abstract-lock.png`, fullPage: true })
  console.log(`${OUT}/abstract-lock.png`)
})
