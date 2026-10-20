// 先生の試し（2026-10-21。管理ページ・提出前チェック）で見つかったことの直しを確かめる（Edge を自動で操作する）。
// 画面の写真は poc-output/trial-fixes-1021/ に置く。
// 管理ページ（試験用サーバー）：
// - 新年度を作ると、上まで戻り（「新年度の準備」と作った知らせが見える）、作った知らせは残る
// - 次の年度がもうある年度のページでは「○年度を作ります」と言わず、「2027年度は、作成済みです（準備中）」と、その年度を開くボタン
// - 変更履歴で「この内容を読み込む」の知らせは、ほかの年度に切り替えたら消える
// - 新年度の準備にまだのところがあると、公開の確かめに並べる
// - コースのお知らせの欄は、書いた行の数に合わせて高くなる（3行目から隠れない）
// 提出前チェック：
// - 読めない Word を入れても、前に入れた Word のまま（入れ替えない。わけを知らせる）
// - ファイルの名前は、長くても拡張子（.docx）が見える。移す・外す の窓に「やめる」
import { mkdirSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { stubConfig } from './configStub.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/trial-fixes-1021'
const FIX = 'scripts/e2e/fixtures'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 確認の窓を記録して答える（ふだんは OK） */
function dialogLog(page) {
  const log = { messages: [], ok: true }
  page.on('dialog', (d) => {
    log.messages.push(d.message())
    if (log.ok) d.accept()
    else d.dismiss()
  })
  return { last: () => log.messages.at(-1) ?? '', answer: (ok) => void (log.ok = ok) }
}
/** 左の見出しの区切りを押す */
const nav = async (p, title) => {
  await p.evaluate((t) => [...document.querySelectorAll('.side-nav button')].find((b) => b.querySelector('.nt b').firstChild.textContent.trim() === t).click(), title)
  await sleep(200)
}
const clickButton = (p, text) => p.evaluate((text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text && b.getBoundingClientRect().width > 0).click(), text)

export async function trialFixesAdmin(browser, check) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror(trialFixesAdmin):', e.message))
  const dialogs = dialogLog(page)
  await page.setViewport({ width: 1366, height: 634 })
  await page.goto(`${APP}/admin.html`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => {
    localStorage.removeItem('sotsugyo-admin-mock')
    localStorage.removeItem('sotsugyo-admin-year')
    sessionStorage.removeItem('sotsugyo-admin-section')
  })
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.admin .content')
  await nav(page, '年度の設定')

  // ---- 1. 新年度を作ると、上まで戻り、作った知らせが残る ----
  await page.evaluate(() => document.querySelectorAll('.admin .content, .admin-main').forEach((el) => el.scrollTo({ top: 99999 })))
  await page.evaluate(() => document.querySelector('.next-year button').click())
  await page.waitForSelector('.modal input')
  await clickButton(page, '作成する')
  await page.waitForFunction(() => document.querySelector('.badge.draft')?.textContent === '準備中', { timeout: 30000 })
  await sleep(500)
  const created = await page.evaluate(() => ({
    year: document.querySelector('.sel')?.value,
    scroll: Math.max(...[...document.querySelectorAll('.admin .content, .admin-main')].map((el) => el.scrollTop)),
    text: document.querySelector('.admin .content')?.textContent ?? '',
  }))
  await page.screenshot({ path: `${OUT}/admin-1-new-year.png` })
  check(
    '管理ページ：新年度を作ると、ページの上まで戻り（新年度の準備が見える）、作った知らせも残る',
    created.year === '2027' && created.scroll === 0 && created.text.includes('2027年度を作成しました') && created.text.includes('新年度の準備'),
    JSON.stringify({ year: created.year, scroll: created.scroll }),
  )

  // ---- 2. 変更履歴で読み込んだ知らせは、年度を切り替えたら消える ----
  await nav(page, '変更履歴')
  await page.waitForSelector('.history li button')
  await page.evaluate(() => [...document.querySelectorAll('.history li button')].at(-1).click())
  await sleep(300)
  const loaded = await page.evaluate(() => document.querySelector('.admin .content').textContent)
  await page.select('.sel', '2026')
  await sleep(800)
  const switched = await page.evaluate(() => ({ year: document.querySelector('.sel').value, text: document.querySelector('.admin').textContent }))
  check(
    '管理ページ：変更履歴の「この内容を読み込む」の知らせは、ほかの年度に切り替えたら残らない',
    /この時点の内容/.test(loaded) && switched.year === '2026' && !switched.text.includes('この時点の内容を読み込みました'),
    JSON.stringify({ loaded: /この時点の内容/.test(loaded), year: switched.year }),
  )

  // ---- 3. 次の年度がもうある年度のページ：「2028年度を作ります」と言わない ----
  await nav(page, '年度の設定')
  const nextCard = await page.evaluate(() => ({ text: document.querySelector('.next-year')?.textContent ?? '', button: document.querySelector('.next-year button')?.textContent ?? '' }))
  await page.screenshot({ path: `${OUT}/admin-3-later-year.png` })
  check(
    '管理ページ：2027年度がもうあるとき、2026年度の「次の年度」は「2027年度は、作成済みです（準備中）」と「2027年度を開く」（2028年度を作るとは言わない）',
    nextCard.text.includes('2027年度は、作成済みです（準備中）') && !nextCard.text.includes('2028') && nextCard.button === '2027年度を開く',
    JSON.stringify(nextCard),
  )
  await page.evaluate(() => document.querySelector('.next-year button').click())
  await sleep(800)

  // ---- 4. 公開の確かめに、新年度の準備のまだのところを並べる（キャンセル） ----
  const year4 = await page.evaluate(() => document.querySelector('.sel').value)
  dialogs.answer(false)
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('この年度を学生に公開')).click())
  await sleep(400)
  dialogs.answer(true)
  const still = await page.evaluate(() => document.querySelector('.badge.draft')?.textContent)
  check(
    '管理ページ：新年度の準備にまだのところがあると、公開の確かめの初めに「新年度の準備で、まだのところがあります」と並べる（キャンセルなら公開しない）',
    year4 === '2027' && dialogs.last().startsWith('新年度の準備で、まだのところがあります。\n・') && still === '準備中',
    dialogs.last().slice(0, 120),
  )

  // ---- 5. コースのお知らせの欄は、書いた行の数に合わせて高くなる ----
  await nav(page, 'コース')
  await page.evaluate(() => document.querySelector('.course-card summary, .course-card .c-head, .course-row button')?.click())
  await sleep(300)
  const area = await page.$('textarea.in.notice')
  let notice = null
  if (area) {
    await area.click()
    await area.type('1行目のお知らせ\n2行目のお知らせ\n3行目のお知らせ\n4行目のお知らせ')
    await sleep(200)
    notice = await area.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }))
  }
  check('管理ページ：コースのお知らせの欄は、4行書いても全部見える（欄が高くなる）', !!notice && notice.scroll <= notice.client + 2, JSON.stringify(notice))
  await context.close()
}

/** 見本のファイル */
const fixture = (src, name, lastModified = Date.now() - 3_600_000) => ({ name, b64: readFileSync(`${FIX}/${src}`).toString('base64'), lastModified, type: '' })
const drop = (page, files) =>
  page.evaluate((files) => {
    const dt = new DataTransfer()
    for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { lastModified: f.lastModified, type: f.type }))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, files)
const settled = (page) => page.waitForFunction(() => document.querySelector('main')?.dataset.busy === 'false' && !document.querySelector('.pg-wait'), { timeout: 120000, polling: 100 })

export async function trialFixesCheck(browser, check) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror(trialFixesCheck):', e.message))
  await stubConfig(page)
  await page.setViewport({ width: 1366, height: 634 })
  await page.goto(`${APP}/check.html`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.c2-side')
  const body = fixture('word-sample-body.docx', '04_本文_卒業制作報告書_文化花子_最終版.docx')
  await drop(page, [body])
  await page.waitForFunction((n) => [...document.querySelectorAll('.pf .fname')].some((x) => x.textContent === n), { timeout: 120000 }, body.name)
  await settled(page)
  const before = await page.evaluate(() => ({ names: [...document.querySelectorAll('.pf .fname')].map((x) => x.textContent), errors: document.querySelectorAll('.issue, .finding, .c2-list li').length }))
  // 壊れた Word（中身が Word でない）を、本文と同じ名前で入れる
  const broken = { name: '04_本文.docx', b64: Buffer.from('これは Word ではありません').toString('base64'), lastModified: Date.now(), type: '' }
  await drop(page, [broken])
  await sleep(1500)
  await settled(page)
  const after = await page.evaluate(() => ({ names: [...document.querySelectorAll('.pf .fname')].map((x) => x.textContent), notes: document.body.textContent }))
  await page.screenshot({ path: `${OUT}/check-1-broken-word.png` })
  check(
    '提出前チェック：読めない Word を同じ場所に入れても、前の Word のまま（入れ替えない）。「読めませんでした」と「前に入れた…のままです」を知らせる',
    after.names.includes(body.name) && !after.names.includes(broken.name) && after.notes.includes('Word のファイルとして読めませんでした') && after.notes.includes(`前に入れた「${body.name}」のままです`),
    JSON.stringify({ before: before.names, after: after.names }),
  )
  // 長い名前でも拡張子が見える。移す・外す の窓に「やめる」
  const name = await page.evaluate((n) => {
    const b = [...document.querySelectorAll('.pf .fname')].find((x) => x.textContent === n)
    const ext = b.querySelector('.ext')
    const r = ext?.getBoundingClientRect()
    const br = b.getBoundingClientRect()
    return { ext: ext?.textContent ?? null, visible: !!r && r.width > 0 && r.right <= br.right + 1, title: b.title }
  }, body.name)
  await page.evaluate((n) => [...document.querySelectorAll('.pf .fname')].find((x) => x.textContent === n).click(), body.name)
  await page.waitForSelector('.move-menu')
  const cancel = await page.evaluate(() => [...document.querySelectorAll('.move-menu button')].map((b) => b.textContent.trim()))
  await page.evaluate(() => [...document.querySelectorAll('.move-menu button')].find((b) => b.textContent.trim() === 'やめる').click())
  await sleep(200)
  const closed = !(await page.$('.move-menu'))
  check(
    '提出前チェック：長いファイル名でも拡張子（.docx）が見え、名前全体はマウスを乗せると出る。移す・外す の窓に「やめる」があり、押すと閉じる',
    name.ext === '.docx' && name.visible && name.title === body.name && cancel.at(-1) === 'やめる' && closed,
    JSON.stringify({ name, cancel, closed }),
  )
  await context.close()
}

// これだけを動かす：node scripts/e2e/trialFixesAdmin.mjs
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { withEdge } = await import('../poc/edge.mjs')
  const results = []
  const check = (name, ok, detail = '') => {
    results.push(ok)
    console.log(`${ok ? '✓' : '✗'} ${name}${detail && !ok ? `  (${detail})` : ''}`)
  }
  await withEdge(async (browser) => {
    await trialFixesAdmin(browser, check)
    await trialFixesCheck(browser, check)
  })
  const failed = results.filter((ok) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} 件 合格`)
  process.exitCode = failed ? 1 : 0
}
