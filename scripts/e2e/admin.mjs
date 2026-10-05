// 管理ページの通しの動作確認（試験用サーバーで。Edge を自動で操作する）
// 使い方: node scripts/e2e/admin.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { withEdge } from '../poc/edge.mjs'

const OUT = 'poc-output/e2e'
mkdirSync(OUT, { recursive: true })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
}

await withEdge(async (browser) => {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  page.on('dialog', (d) => d.accept())
  await page.setViewport({ width: 1440, height: 900 })
  await page.goto('http://localhost:5173/admin.html', { waitUntil: 'networkidle0' })
  await page.evaluate(() => localStorage.removeItem('sotsugyo-admin-mock'))
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.admin .form')

  const previewText = () => page.evaluate(() => document.querySelector('.preview iframe').contentDocument.body.innerText.replace(/\s/g, ''))
  const fieldInput = (label) => page.evaluateHandle((label) => [...document.querySelectorAll('.f')].find((f) => f.querySelector('.l')?.textContent.startsWith(label)).querySelector('input, textarea'), label)
  const clickButton = (text) => page.evaluate((text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text)).click(), text)

  check('公開中の2026年度が開く', await page.evaluate(() => document.querySelector('.badge.pub')?.textContent === '公開中'))

  // 共通の題目を変えると、見本の表紙と抄録にすぐ反映される
  const title = await fieldInput('共通の題目')
  await title.click({ clickCount: 3 })
  await title.type('卒業イベント「試験」について')
  await new Promise((r) => setTimeout(r, 300))
  const text = await previewText()
  check('題目の変更が見本に反映される', (text.match(/卒業イベント「試験」について/g) ?? []).length === 2)
  check('保存していない変更があると表示される', await page.evaluate(() => !!document.querySelector('.badge.warn')))

  // 指導教員を追加する
  const tag = await page.$('.tag-input')
  await tag.type('文化 太郎')
  await tag.press('Enter')
  await new Promise((r) => setTimeout(r, 300))
  check('指導教員を追加すると見本の抄録に出る', (await previewText()).includes('文化太郎'))

  // サブタイトルの形式から学生の入力部分を消すとエラーになり、保存ボタンが押せても公開中は保存できない
  await clickButton('保存して学生に反映')
  await page.waitForFunction(() => document.querySelector('.message.ok'))
  check('公開中の年度を保存できる', await page.evaluate(() => document.querySelector('.message.ok').textContent.includes('反映')))

  // 下書きのひな形を編集する（コースのカードの「編集する」から）
  await page.evaluate(() => document.querySelector('.tpl-row button').click())
  await page.waitForSelector('.tpl-modal')
  await page.evaluate(() => document.querySelectorAll('.tpl-modal .row')[1].click())
  await clickButton('＋ 小見出し')
  await page.keyboard.type('試験の小見出し')
  await new Promise((r) => setTimeout(r, 500))
  const tplPreview = await page.evaluate(() => document.querySelector('.tpl-preview iframe').contentDocument.body.innerText)
  check('ひな形の編集画面で、足した小見出しが見本にすぐ出る', tplPreview.includes('試験の小見出し'))
  await page.screenshot({ path: `${OUT}/admin-template.png` })
  await clickButton('反映する')
  await new Promise((r) => setTimeout(r, 300))
  const summary = await page.evaluate(() => document.querySelector('.tpl-row b').textContent)
  check('反映すると、コースのカードのひな形の要約が変わる', summary.includes('小見出し4'), summary)
  await clickButton('保存して学生に反映')
  await page.waitForFunction(() => document.querySelector('.message.ok')?.textContent.includes('反映'))
  check('ひな形を保存できる', true)

  // 先生の画面：ひな形だけを編集・保存できる
  const teacher = await context.newPage()
  teacher.on('dialog', (d) => d.accept())
  await teacher.setViewport({ width: 1440, height: 900 })
  await teacher.goto('http://localhost:5173/admin.html?as=teacher', { waitUntil: 'networkidle0' })
  await teacher.waitForSelector('.teacher-main')
  check('先生には、ひな形の一覧だけの画面が出る（年度の設定の欄は出ない）', !(await teacher.$('.form')) && (await teacher.$$('.teacher-main .tpl-row')).length > 0)
  await teacher.evaluate(() => document.querySelector('.teacher-main .tpl-row button').click())
  await teacher.waitForSelector('.tpl-modal')
  await teacher.evaluate(() => [...document.querySelectorAll('.tpl-modal .row input')].at(-1).focus())
  await teacher.evaluate(() => [...document.querySelectorAll('.tpl-modal .adds button')].find((b) => b.textContent.includes('説明')).click())
  await teacher.keyboard.type('先生が足した説明')
  await teacher.evaluate(() => [...document.querySelectorAll('.tpl-foot button')].find((b) => b.textContent.includes('反映する')).click())
  await teacher.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('ひな形を保存')).click())
  await teacher.waitForFunction(() => document.querySelector('.message.ok'))
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.admin .form')
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sotsugyo-admin-mock')).years.find((y) => y.year === 2026).config.courses[0])
  check('先生が保存したひな形が、年度の設定に入る（ほかの設定は変わらない）', saved.template.some((b) => b.hint === '先生が足した説明') && saved.template.some((b) => b.title === '試験の小見出し'))
  await teacher.close()

  // 新年度を作る → 準備中 → 公開
  await clickButton('新年度を作成')
  await page.waitForSelector('.modal')
  await clickButton('作成する')
  await page.waitForFunction(() => document.querySelector('.badge.draft')?.textContent === '準備中')
  check('新年度（2027年度）が準備中で作られる', await page.evaluate(() => document.querySelector('.sel').value === '2027'))
  check('新年度は前の年度の内容を引き継ぐ', (await previewText()).includes('卒業イベント「試験」について') && (await previewText()).includes('２０２７年度'))
  await page.screenshot({ path: `${OUT}/admin-2027.png` })
  await clickButton('この年度を学生に公開')
  await page.waitForFunction(() => document.querySelector('.badge.pub')?.textContent === '公開中')
  const options = await page.evaluate(() => [...document.querySelectorAll('.sel option')].map((o) => o.textContent))
  check('公開すると前の年度は「終了」になる', options.join(',') === '2027年度（公開中）,2026年度（終了）', options.join(','))

  // 変更履歴
  await clickButton('変更履歴')
  await page.waitForSelector('.history li')
  const history = await page.evaluate(() => [...document.querySelectorAll('.history li')].map((li) => li.textContent))
  check('変更履歴に操作が残る', history.some((h) => h.includes('公開')) && history.some((h) => h.includes('コピーして作成')), `${history.length}件`)
  await context.close()
})

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 件 合格`)
process.exitCode = failed.length ? 1 : 0
