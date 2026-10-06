// デザイン案 v22（見直しの相談事項のうち、見た目が変わるもの）を画像に書き出す。
// ①下書き PDF と「確認済み」、②ドライブ保存を止める切り替え、③2つめのタブ、⑨文字の濃さ・大きさとエラーの印。
// 学生用ツール・管理ページに、案ごとの部品を仮に足して撮る（まだ作っていない部品は、撮影のためだけに足す）。
// 使い方: node scripts/mockup-shots-v22.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { stubConfig } from './e2e/configStub.mjs'
import { withEdge } from './poc/edge.mjs'

const OUT = 'mockups/v22/screens'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ready = (page) => page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning }, { timeout: 90000 })

const CSS = `
  .guide { display: none !important; }
  /* ①下書き PDF：透かし */
  .v22-wm-a { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; z-index: 5; }
  .v22-wm-a span { transform: rotate(-32deg); font-family: 'BIZ UDPGothic', sans-serif; font-weight: 700; font-size: 120px; letter-spacing: 0.3em; color: rgba(181, 68, 59, 0.13); white-space: nowrap; }
  .v22-wm-b { position: absolute; left: 0; right: 0; top: 0; height: 13mm; display: grid; place-items: center; z-index: 5; font-family: 'BIZ UDPGothic', sans-serif; font-size: 11pt; font-weight: 700; letter-spacing: 0.1em; color: #b5443b; background: repeating-linear-gradient(-45deg, rgba(181,68,59,0.07) 0 10px, rgba(181,68,59,0.12) 10px 20px); border-bottom: 1px solid rgba(181,68,59,0.35); }
  .v22-draft { margin: 14px 0 0; padding: 12px 14px; border-radius: 10px; background: #f6f4ef; border: 1px solid var(--line); font-size: 13px; line-height: 1.7; }
  .v22-draft b { display: block; margin-bottom: 2px; }
  .v22-draft button { margin-top: 8px; }
  /* ①確認済み */
  .v22-keep { grid-column: 2 / 4; justify-self: start; margin-top: -2px; border: 0; background: none; padding: 0; color: var(--muted); font-size: 11.5px; text-decoration: underline; text-underline-offset: 3px; }
  .v22-check { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--muted); white-space: nowrap; }
  .v22-done { margin: 10px 0 0; padding: 8px 10px; border-radius: 8px; background: var(--chip-bg); font-size: 12px; color: var(--muted); display: flex; justify-content: space-between; }
  .v22-done u { color: var(--accent); }
  /* ②ドライブ保存の切り替え（管理ページ） */
  .v22-drive { border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; margin: 0 0 12px; background: #fff; display: grid; gap: 6px; }
  .v22-drive .l { font-size: 12px; color: var(--muted); }
  .v22-drive .seg2 { display: flex; gap: 6px; }
  .v22-drive .seg2 span { flex: 1; text-align: center; padding: 8px 6px; border-radius: 8px; border: 1px solid var(--line); font-size: 13px; }
  .v22-drive .seg2 .on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); font-weight: 700; }
  .v22-drive .seg2 .stop.on { border-color: #b5443b; background: #f7ebe9; color: #b5443b; }
  .v22-drive .warn { font-size: 12px; color: #b5443b; line-height: 1.7; }
  /* ②学生の画面（止めているとき） */
  .v22-stopped { margin: 10px 0 0; padding: 8px 10px; border-radius: 8px; background: var(--warn-soft); color: var(--warn); font-size: 12px; line-height: 1.6; }
  /* ③2つめのタブ */
  .v22-tab-over { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; background: rgba(236, 233, 228, 0.78); backdrop-filter: blur(3px); }
  .v22-tab-card { width: 420px; background: #fff; border-radius: 18px; padding: 24px 26px 20px; box-shadow: 0 18px 50px rgba(20,20,30,0.28); font-size: 14px; }
  .v22-tab-card h2 { font-size: 18px; margin: 0 0 8px; }
  .v22-tab-card p { margin: 0 0 14px; line-height: 1.8; color: #3f4249; font-size: 13.5px; }
  .v22-tab-card .row { display: flex; gap: 8px; justify-content: flex-end; }
  .v22-tab-card button { border: 1px solid var(--line); background: #fff; border-radius: 8px; padding: 8px 14px; font-size: 13px; }
  .v22-tab-card button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 700; }
  .v22-tab-bar { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); z-index: 40; display: flex; align-items: center; gap: 12px; padding: 9px 14px; border-radius: 12px; background: #fbf0d9; border: 1px solid #ecd6a6; color: #87590a; font-size: 13px; box-shadow: var(--float-shadow); white-space: nowrap; }
  .v22-tab-bar button { border: 1px solid #d9b56a; background: #fff; color: #87590a; border-radius: 8px; padding: 5px 10px; font-size: 12.5px; font-weight: 700; }
  /* ⑨文字の濃さ・大きさと、エラー・注意の印 */
  .v22-after { --muted: #62656c; }
  .v22-after .issue .detail { font-size: 12.5px !important; }
  .v22-after .issue .ttl { font-size: 13.5px; }
  .v22-after .meter .row, .v22-after .chip, .v22-after .sec-h, .v22-after .side-foot p { font-size: 12.5px !important; }
  .v22-mark .issue { grid-template-columns: 18px 1fr auto; }
  .v22-mark .issue .dot { width: 16px; height: 16px; margin-top: 2px; display: grid; place-items: center; color: #fff; font-size: 11px; font-weight: 700; font-style: normal; }
  .v22-mark .issue.error .dot::before { content: '×'; }
  .v22-mark .issue.warning .dot { border-radius: 3px; transform: rotate(45deg) scale(0.86); }
  .v22-mark .issue.warning .dot::before { content: '!'; transform: rotate(-45deg); }
  .v22-word .issue .ttl::before { display: inline-block; margin-right: 6px; padding: 0 6px; border-radius: 999px; font-size: 11px; font-weight: 700; line-height: 1.6; vertical-align: 1px; }
  .v22-word .issue.error .ttl::before { content: 'エラー'; background: #f7ebe9; color: #b5443b; }
  .v22-word .issue.warning .ttl::before { content: '注意'; background: #f6f0e3; color: #8a5a12; }
`

/** 学生用ツールを開き、書きかけの本文（補助の指摘が出る文）を入れる */
async function openStudent(browser) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 })
  await stubConfig(page)
  await page.goto('http://localhost:5173/?nodrive', { waitUntil: 'networkidle0', timeout: 90000 })
  await ready(page)
  await page.addStyleTag({ content: CSS })
  await page.evaluate(() =>
    window.__editor.update((r) => {
      const body = r.body.map((c, i) =>
        i === 0
          ? { ...c, blocks: c.blocks.map((b, j) => (b.type === 'paragraph' && j === c.blocks.findIndex((x) => x.type === 'paragraph') ? { ...b, content: [{ type: 'text', text: '主人公の衣装は、物語の舞台となる砂漠の色を取り入れました。監督からは「もっと軽やかにしてほしいです」という意見があった' }] } : b)) }
          : c,
      )
      return { ...r, basicInfo: { ...r.basicInfo, studentId: '00ZZ0123', name: '文化　花子', subtitleInput: 'シンドバッド', courseId: 'film-stage-costume' }, body }
    }),
  )
  await sleep(500)
  await ready(page)
  return { context, page }
}

const shot = async (page, name, el) => {
  await sleep(400)
  if (el) await (await page.$(el)).screenshot({ path: `${OUT}/${name}.png` })
  else await page.screenshot({ path: `${OUT}/${name}.png` })
  console.log(`${OUT}/${name}.png`)
}

await withEdge(async (browser) => {
  // ---- ① 下書き PDF：書き出しの窓 ----
  {
    const { context, page } = await openStudent(browser)
    await page.evaluate(() => document.querySelector('.side-foot .export').click())
    await page.waitForSelector('.modal .error-list')
    await page.evaluate(() => {
      const rows = document.querySelector('.modal .row-buttons')
      rows.insertAdjacentHTML('beforebegin', '<div class="v22-draft"><b>先生に途中経過を見せるとき</b>エラーが残っていても、「下書き」の透かしが入った PDF を書き出せます（提出には使えません）。<br><button>下書きの PDF を書き出す</button></div>')
    })
    await shot(page, '1-export')
    await context.close()
  }
  // ---- ① 下書き PDF：透かし（2案） ----
  for (const key of ['a', 'b']) {
    const { context, page } = await openStudent(browser)
    await page.evaluate((key) => {
      const pageEl = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current')
      pageEl.style.position = 'relative'
      pageEl.insertAdjacentHTML('beforeend', key === 'a' ? '<div class="v22-wm-a"><span>下書き</span></div>' : '<div class="v22-wm-b">下書き（提出用ではありません）</div>')
    }, key)
    await shot(page, `1-wm-${key}`, '.page-viewport.front [data-vivliostyle-page-container].is-current')
    await context.close()
  }
  // ---- ① 確認済み（2案） ----
  for (const key of ['a', 'b']) {
    const { context, page } = await openStudent(browser)
    await page.evaluate(() => window.__editor.goToArea('body'))
    await ready(page)
    await page.evaluate((key) => {
      for (const li of document.querySelectorAll('.side .issue')) {
        if (!li.querySelector('.src')?.textContent.includes('補助')) continue
        if (key === 'a') li.insertAdjacentHTML('beforeend', '<button class="v22-keep">このままにする（確認済み）</button>')
        else {
          const slot = li.lastElementChild
          slot.insertAdjacentHTML('afterend', '<label class="v22-check"><input type="checkbox">確認した</label>')
          li.style.gridTemplateColumns = '8px 1fr auto auto'
        }
      }
      document.querySelector('.side .check').insertAdjacentHTML('beforeend', '<div class="v22-done"><span>確認済み 2件（エラーに数えない）</span><u>表示</u></div>')
    }, key)
    await shot(page, `1-keep-${key}`, '.side')
    await context.close()
  }
  // ---- ② 管理ページ：ドライブ保存の切り替え（2案） ----
  for (const key of ['a', 'b']) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 })
    await page.goto('http://localhost:5173/admin.html', { waitUntil: 'networkidle0' })
    await page.waitForSelector('.admin .form')
    await page.addStyleTag({ content: CSS })
    await page.evaluate((key) => {
      const box = `<div class="v22-drive"><span class="l">学生のドライブ保存</span><div class="seg2"><span class="${key === 'a' ? '' : 'on'}">必須（ふだん）</span><span class="stop ${key === 'a' ? 'on' : ''}">止める（Google の障害のとき）</span></div>${key === 'a' ? '<span class="warn">止めているあいだ、学生はログインせずに書けます（原稿はその端末にだけ保存されます）。Google が使えるようになったら「必須」に戻してください。</span>' : '<span class="l">Google の障害や大学の設定変更で学生がログインできないときだけ、「止める」にして保存します。</span>'}</div>`
      if (key === 'a') document.querySelector('.form h2').insertAdjacentHTML('beforebegin', box)
      else {
        const d = document.querySelector('.details')
        d.open = true
        d.querySelector('.grid').insertAdjacentHTML('beforebegin', box)
        d.scrollIntoView({ block: 'start' })
      }
    }, key)
    await shot(page, `2-admin-${key}`)
    await context.close()
  }
  // ---- ② 学生の画面（止めているとき） ----
  {
    const { context, page } = await openStudent(browser)
    await page.evaluate(() => {
      const meta = document.querySelector('.side-head .meta')
      meta.firstElementChild.outerHTML = '<span class="chip"><i class="dot"></i>この端末にだけ保存 13:44</span>'
      meta.insertAdjacentHTML('afterend', '<div class="v22-stopped">いまはドライブへの保存を止めています（学科の判断）。原稿はこの端末にだけ保存されます。再開されたら、ログインするとドライブにも保存されます。</div>')
    })
    await shot(page, '2-student', '.side')
    await context.close()
  }
  // ---- ③ 2つめのタブ（2案） ----
  for (const key of ['a', 'b']) {
    const { context, page } = await openStudent(browser)
    await page.evaluate((key) => {
      if (key === 'a') {
        document.body.insertAdjacentHTML('beforeend', '<div class="v22-tab-over"><div class="v22-tab-card"><h2>このツールは、別のタブで開いています</h2><p>同じ原稿を2か所で書くと、新しく書いた内容が消えることがあるため、このタブでは書けないようにしています。もう一方のタブを閉じてから「こちらで続ける」を押してください。</p><div class="row"><button class="primary">こちらで続ける</button></div></div></div>')
      } else {
        document.querySelector('.stage').insertAdjacentHTML('beforeend', '<div class="v22-tab-bar">別のタブで開いています。このタブでは見るだけです<button>こちらで続ける</button></div>')
      }
    }, key)
    await shot(page, `3-tab-${key}`)
    await context.close()
  }
  // ---- ⑨ 文字の濃さ・大きさと、エラー・注意の印（今・案A・案B） ----
  for (const key of ['now', 'a', 'b']) {
    const { context, page } = await openStudent(browser)
    await page.evaluate(() => window.__editor.goToArea('body'))
    await ready(page)
    await page.evaluate((key) => {
      const app = document.querySelector('.app')
      if (key !== 'now') app.classList.add('v22-after', key === 'a' ? 'v22-mark' : 'v22-word')
    }, key)
    await shot(page, `9-${key}`, '.side')
    await context.close()
  }

  // 一覧のページ
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 })
  await page.goto('http://localhost:5173/mockups/v22/review.html', { waitUntil: 'networkidle0' })
  await page.screenshot({ path: `${OUT}/review.png`, fullPage: true })
  console.log(`${OUT}/review.png`)
})
