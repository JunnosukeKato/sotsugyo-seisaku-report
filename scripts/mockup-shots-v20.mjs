// デザイン案 v20（管理ページの「先生の登録」で、メーリングリストのアドレスをまとめて登録する）を画像に書き出す。
// 管理ページ（開発用の見本のデータ）の「先生の登録」の窓に、案ごとの部品を仮に足して撮る。
// 使い方: node scripts/mockup-shots-v20.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { withEdge } from './poc/edge.mjs'

const OUT = 'mockups/v20/screens'
mkdirSync(OUT, { recursive: true })

// 貼り付けた例（メーリングリストの宛先の形。名前はすべて架空）
const PASTED = '文化 太郎 <t-bunka@bunka-wu.ac.jp>, "衣装 花子" <h-isho@bunka-wu.ac.jp>, 舞台 次郎 <j-butai@bunka-wu.ac.jp>;\n00zz901@bunka-wu.ac.jp, someone@gmail.com'

// 読み取った結果
const ROWS = [
  { on: true, name: '文化 太郎', email: 't-bunka@bunka-wu.ac.jp', state: '新しく登録', kind: 'ok' },
  { on: true, name: '衣装 花子', email: 'h-isho@bunka-wu.ac.jp', state: '新しく登録', kind: 'ok' },
  { on: false, name: '舞台 次郎', email: 'j-butai@bunka-wu.ac.jp', state: '登録済み（先生）', kind: 'muted' },
  { on: false, name: '', email: '00zz901@bunka-wu.ac.jp', state: '学生のアドレスのため登録しない', kind: 'ng' },
  { on: false, name: '', email: 'someone@gmail.com', state: '大学のアドレスでないため登録しない', kind: 'ng' },
]

const preview = (rows) => `
  <table class="bulk-table">
    <thead><tr><th></th><th>名前（メモになる）</th><th>メールアドレス</th><th>読み取った結果</th></tr></thead>
    <tbody>${rows.map((r) => `<tr class="${r.kind}"><td><input type="checkbox" ${r.on ? 'checked' : ''} ${r.kind === 'ng' || r.kind === 'muted' ? 'disabled' : ''}></td><td>${r.name || '<span class="none">（名前なし）</span>'}</td><td>${r.email}</td><td class="st">${r.state}</td></tr>`).join('')}</tbody>
  </table>`

const CSS = `
  .modal.members { width: min(760px, calc(100vw - 32px)); }
  .bulk { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); display: grid; gap: 8px; }
  .bulk h3 { margin: 0; font-size: 13px; }
  .bulk .hint2 { font-size: 12px; color: var(--muted); line-height: 1.6; margin: -4px 0 0; }
  .bulk textarea { font: inherit; font-size: 12.5px; min-height: 64px; resize: vertical; width: 100%; box-sizing: border-box; border: 1px solid var(--line); border-radius: 6px; padding: 7px 9px; }
  .bulk-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  .bulk-table th { font-size: 11px; color: var(--muted); font-weight: 400; text-align: left; padding: 3px 6px; }
  .bulk-table td { padding: 5px 6px; border-top: 1px solid #f0efec; }
  .bulk-table td:first-child { width: 22px; }
  .bulk-table .st { font-size: 11.5px; }
  .bulk-table tr.ok .st { color: var(--ok); }
  .bulk-table tr.muted td { color: var(--muted); }
  .bulk-table tr.ng td { color: #a0a3aa; }
  .bulk-table tr.ng .st { color: var(--error); }
  .bulk-table .none { color: #a0a3aa; }
  .bulk-go { display: flex; align-items: center; gap: 8px; }
  .bulk-go .spacer { flex: 1; }
  .bulk-btn { border: 1px solid #c9cfe6 !important; color: var(--accent) !important; background: #fff !important; }
  .step { display: flex; gap: 10px; font-size: 11.5px; color: var(--muted); margin: -2px 0 10px; }
  .step .on { color: var(--accent); font-weight: 700; }
  .member-add.multi { grid-template-columns: 1fr auto auto; align-items: start; }
  .member-add.multi textarea { font: inherit; font-size: 13px; min-height: 64px; resize: vertical; border: 1px solid var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); border-radius: 6px; padding: 7px 9px; }
`

const VARIANTS = {
  // 案1：窓の下に「まとめて登録」の欄を置く。貼り付けると、すぐ下に読み取った結果が出る
  a: ({ pasted, table }) => {
    const modal = document.querySelector('.modal.members')
    const box = document.createElement('div')
    box.className = 'bulk'
    box.innerHTML = `<h3>まとめて登録（メーリングリストのアドレスを貼り付け）</h3><p class="hint2">「名前 &lt;アドレス&gt;」の形や、カンマ・改行で区切ったアドレスを、そのまま貼り付けられます。名前はメモになります。</p><textarea>${pasted}</textarea>${table}<div class="bulk-go"><span class="spacer"></span><select class="sel"><option>先生</option><option>管理者</option></select><button class="primary">2人を先生として登録する</button></div>`
    modal.querySelector('.member-add').after(box)
    modal.scrollTop = modal.scrollHeight
  },
  // 案2：「まとめて登録…」のボタンから、別の窓で（貼り付け → 確かめて登録の2段階）
  b: ({ table }) => {
    const add = document.querySelector('.modal.members .member-add')
    add.insertAdjacentHTML('afterend', '<div class="bulk-go" style="margin-top:10px"><span class="spacer"></span><button class="bulk-btn">まとめて登録…</button></div>')
    const back = document.createElement('div')
    back.className = 'modal-backdrop'
    back.style.zIndex = '60'
    back.innerHTML = `<div class="modal members"><header><h2>まとめて登録</h2><button class="close">×</button></header><div class="step"><span>1 貼り付ける</span><span class="on">2 確かめて登録する</span></div><p class="lead" style="margin-bottom:8px">読み取った結果です。チェックの入った人を登録します。</p>${table}<div class="row-buttons"><button>← 貼り付けに戻る</button><span class="spacer"></span><select class="sel"><option>先生</option><option>管理者</option></select><button class="primary">2人を先生として登録する</button></div></div>`
    document.body.append(back)
  },
  // 案3：今の1人ずつの欄に、そのまま何人分でも貼り付けられる（2人以上なら、下に読み取った結果が出る）
  c: ({ pasted, table }) => {
    const add = document.querySelector('.modal.members .member-add')
    add.className = 'member-add multi'
    add.innerHTML = `<textarea>${pasted}</textarea><select class="sel"><option>先生</option><option>管理者</option></select><button class="primary">2人を登録する</button>`
    add.insertAdjacentHTML('afterend', `<div class="bulk" style="border-top:0;padding-top:4px"><p class="hint2" style="margin:0">5件読み取りました。チェックの入った人を登録します（名前はメモになります）。</p>${table}</div>`)
    const modal = document.querySelector('.modal.members')
    modal.scrollTop = modal.scrollHeight
  },
}

await withEdge(async (browser) => {
  for (const [key, inject] of Object.entries(VARIANTS)) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 })
    await page.goto('http://localhost:5173/admin.html', { waitUntil: 'networkidle0' })
    await page.waitForSelector('.admin .form')
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '先生の登録').click())
    await page.waitForSelector('.modal.members .member-list')
    await page.addStyleTag({ content: CSS })
    await page.evaluate(inject, { pasted: PASTED.replace(/</g, '&lt;'), table: preview(ROWS) })
    await new Promise((r) => setTimeout(r, 400))
    await page.screenshot({ path: `${OUT}/${key}.png` })
    console.log(`${OUT}/${key}.png`)
    await context.close()
  }
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 })
  await page.goto('http://localhost:5173/mockups/v20/members.html', { waitUntil: 'networkidle0' })
  await page.screenshot({ path: `${OUT}/members.png`, fullPage: true })
  console.log(`${OUT}/members.png`)
})
