// デザイン案 v17（管理ページで「書き間違えやすい語」を追加・編集する）を画像に書き出す。
// 管理ページ（開発用の見本のデータ）に、案ごとの部品を仮に足して撮る（まだ作っていない部品は、撮影のためだけに足す）。
// 使い方: node scripts/mockup-shots-v17.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { withEdge } from './poc/edge.mjs'

const OUT = 'mockups/v17/screens'
mkdirSync(OUT, { recursive: true })

const WORDS = [
  ['見頃', '身頃', 'error'],
  ['身返し', '見返し', 'error'],
  ['再寸', '採寸', 'error'],
  ['友布', '共布', 'error'],
  ['記事', '生地', 'warning'],
  ['証明', '照明', 'warning'],
]

// 表（どの案も同じ部品）
const table = (words, compact) => `
  <table class="wtable${compact ? ' compact' : ''}">
    <thead><tr><th>書き間違い</th><th>正しい語</th><th>重さ</th><th></th></tr></thead>
    <tbody>${words.map(([w, r, s]) => `<tr><td><input class="in" value="${w}"></td><td><input class="in" value="${r}"></td><td><select class="in"><option ${s === 'error' ? 'selected' : ''}>エラー</option><option ${s === 'warning' ? 'selected' : ''}>注意</option></select></td><td><button class="x">×</button></td></tr>`).join('')}</tbody>
  </table>
  <button class="add">＋ 語を足す</button>`

const CSS = `
  .wtable { width: 100%; border-collapse: collapse; margin: 4px 0 8px; font-size: 13px; }
  .wtable th { font-size: 11px; color: #6b6f78; font-weight: 400; text-align: left; padding: 2px 4px; }
  .wtable td { padding: 3px 4px; }
  .wtable .in { width: 100%; box-sizing: border-box; }
  .wtable td:nth-child(3) { width: 82px; }
  .wtable td:nth-child(4) { width: 26px; }
  .wtable .x { border: 0; background: none; color: #a33; font-size: 15px; cursor: pointer; }
  .whint { font-size: 12px; color: #6b6f78; line-height: 1.7; margin: -4px 0 8px; }
  .wtry { margin-top: 12px; padding: 10px 12px; border: 1px solid #dedbd5; border-radius: 8px; background: #faf9f6; font-size: 12.5px; }
  .wtry b { display: block; font-size: 12px; color: #6b6f78; font-weight: 400; margin-bottom: 4px; }
  .wtry .s { line-height: 1.9; }
  .wtry mark.e { background: rgba(198,40,40,0.16); color: #b71c1c; text-decoration: underline 2px solid #c62828; }
  .wtry mark.w { background: rgba(201,138,0,0.16); text-decoration: underline 2px solid #c98a00; }
  .mock-modal { position: fixed; inset: 0; background: rgba(20,20,28,0.45); display: grid; place-items: center; z-index: 50; }
  .mock-modal .box { width: 620px; background: #fff; border-radius: 14px; padding: 18px 22px 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); font-family: 'BIZ UDPGothic', sans-serif; }
  .mock-modal h3 { margin: 0 0 6px; font-size: 17px; }
  .mock-modal .row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
  .mock-modal .row button { border: 1px solid #dedbd5; background: #fff; border-radius: 8px; padding: 7px 16px; }
  .mock-modal .row .p { background: #2f3e75; color: #fff; border-color: #2f3e75; }
  .wbtn { border: 1px solid #c9cfe6; background: #fff; color: #2f3e75; border-radius: 8px; padding: 8px 12px; font-size: 13px; width: 100%; text-align: left; }
  .wbtn span { float: right; color: #6b6f78; font-size: 12px; }
`

const TRY = `<div class="wtry"><b>試しに文を入れて確かめる</b><div class="s">前<mark class="e">見頃</mark>と後ろ身頃を縫い合わせ、<mark class="w">記事</mark>を選んだ。</div></div>`

const VARIANTS = {
  // 案1：左の欄に「書き間違えやすい語」の見出しと表を置く（コースの下）
  a: (html) => {
    const h = [...document.querySelectorAll('.form h2')].find((x) => x.textContent.startsWith('コースと'))
    const add = h.parentElement.querySelector(':scope > .add')
    const box = document.createElement('div')
    box.innerHTML = `<h2>書き間違えやすい語（学生のセルフチェックで指摘する）</h2><p class="whint">エラーは書き出しを止め、注意は知らせるだけです。学生は「直す」で正しい語に置き換えられます。</p>${html.table}`
    add.after(box)
    box.scrollIntoView({ block: 'start' })
    document.querySelector('.form').scrollTop -= 40
  },
  // 案2：「詳細設定」の折りたたみの中に置く（ふだんは隠れている）
  b: (html) => {
    const d = document.querySelector('.details')
    d.open = true
    const box = document.createElement('div')
    box.innerHTML = `<h2 style="margin-top:18px">書き間違えやすい語</h2><p class="whint">エラーは書き出しを止め、注意は知らせるだけです。</p>${html.table}`
    d.append(box)
    box.scrollIntoView({ block: 'center' })
  },
  // 案3：ボタンから開く窓で編集する（試しに文を入れて確かめられる）
  c: (html) => {
    const h = [...document.querySelectorAll('.form h2')].find((x) => x.textContent.startsWith('コースと'))
    const add = h.parentElement.querySelector(':scope > .add')
    const box = document.createElement('div')
    box.innerHTML = `<h2>書き間違えやすい語</h2><button class="wbtn">書き間違えやすい語の一覧を編集<span>13語（エラー7・注意6）</span></button>`
    add.after(box)
    box.scrollIntoView({ block: 'center' })
    const modal = document.createElement('div')
    modal.className = 'mock-modal'
    modal.innerHTML = `<div class="box"><h3>書き間違えやすい語</h3><p class="whint">学生のセルフチェックで指摘します。エラーは書き出しを止め、注意は知らせるだけです。</p>${html.table}${html.try}<div class="row"><button>やめる</button><button class="p">反映する</button></div></div>`
    document.body.append(modal)
  },
}

await withEdge(async (browser) => {
  for (const [key, inject] of Object.entries(VARIANTS)) {
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 })
    await page.goto('http://localhost:5173/admin.html', { waitUntil: 'networkidle0' })
    await page.waitForSelector('.admin .form')
    await page.addStyleTag({ content: CSS })
    await page.evaluate(inject, { table: table(WORDS), try: TRY })
    await new Promise((r) => setTimeout(r, 400))
    await page.screenshot({ path: `${OUT}/${key}.png` })
    console.log(`${OUT}/${key}.png`)
    await page.close()
  }
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 })
  await page.goto('http://localhost:5173/mockups/v17/words.html', { waitUntil: 'networkidle0' })
  await page.screenshot({ path: `${OUT}/words.png`, fullPage: true })
  console.log(`${OUT}/words.png`)
})
