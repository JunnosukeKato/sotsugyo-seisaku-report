// デザイン案 v49（管理ページ・提出前チェック：先生の試し 2026-10-21 で見つかった、見た目・動きを変えるもの）を画像に書き出す。
//   G 打っている間に、上の「確認」の枠が出たり消えたりして、欄の位置がずれる（押そうとした欄と違う欄を押してしまう）
//      いま／案1 確認は、その欄のすぐ下に出す（上の枠には出さない。打っている欄は動かない）
//   H 新年度の手順4「確かめる」が、正しい理由の確認（指導教員4名など）だと、いつまでも済みにならない
//      いま／案1 確認ごとに「確かめた」。全部確かめれば手順4は済み（内容が変わったら、また確かめる）
//   I 「変更を見る」に、何がどう変わったかが出ない
//      いま／案 変更前 → 変更後 を並べ、押すとその欄へ
//   J 先生：「ひな形を受け取りました」の知らせが、コースの「閉じる」に重なる
//      いま／案 ほかの知らせと同じく、見出しの下の緑の枠に出す（重ねない）
//   K 先生：指導教員は変えられないが、誰に頼めばよいか書いていない
//      案 「変えるときは、管理者に頼んでください」と添える
//   L 提出前チェック（スマホ）：結果が画面のかなり下（1000px ほど）から始まる
//      いま／案1 下の帯の「エラーが8件残っています」を押すと、結果へ移る／案2 結果を、ファイルを入れる所のすぐ下に出す
// 本物の画面（管理ページは試験用サーバー。提出前チェックは見本の Word）に、案の CSS と部品だけを書き足して写す（src/ は変えない）。
// 使い方: node scripts/mockup-shots-v49.mjs [shots] [review]（開発サーバーが http://localhost:5173 で動いていること）
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

process.env.EDGE_PORT ??= '9811'
const { withEdge } = await import('./poc/edge.mjs')
const { stubConfig } = await import('./e2e/configStub.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const DIR = 'mockups/v49'
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })
const ONLY = process.argv.slice(2)
const want = (k) => ONLY.length === 0 || ONLY.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const FACTS = {}

const nav = async (p, title) => {
  await p.evaluate((t) => [...document.querySelectorAll('.side-nav button')].find((b) => b.querySelector('.nt b').firstChild.textContent.trim() === t).click(), title)
  await sleep(250)
}
const clickButton = (p, text) => p.evaluate((text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text && b.getBoundingClientRect().width > 0).click(), text)
const clipOf = (p, sel, pad = 10) =>
  p.evaluate((sel, pad) => {
    const r = document.querySelector(sel).getBoundingClientRect()
    return { x: Math.max(0, r.left - pad), y: Math.max(0, r.top - pad), width: Math.min(innerWidth, r.width + pad * 2), height: Math.min(innerHeight - Math.max(0, r.top - pad), r.height + pad * 2) }
  }, sel, pad)
const shot = (p, name, clip) => p.screenshot({ path: `${OUT}/${name}.png`, ...(clip ? { clip, captureBeyondViewport: false } : {}) })
const inject = (p, css) =>
  p.evaluate((css) => {
    document.querySelector('style[data-mk]')?.remove()
    if (!css) return
    const s = document.createElement('style')
    s.dataset.mk = ''
    s.textContent = css
    document.head.append(s)
  }, css)
const clean = (p) => p.evaluate(() => document.querySelectorAll('[data-mk-el]').forEach((e) => e.remove()))

async function admin(browser) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('dialog', (d) => d.accept())
  await page.setViewport({ width: 1366, height: 634, deviceScaleFactor: 1.5 })
  await page.goto(`${APP}/admin.html`, { waitUntil: 'networkidle0', timeout: 120000 })
  await page.evaluate(() => {
    localStorage.removeItem('sotsugyo-admin-mock')
    localStorage.removeItem('sotsugyo-admin-year')
    sessionStorage.removeItem('sotsugyo-admin-section')
  })
  await page.reload({ waitUntil: 'networkidle0', timeout: 120000 })
  await page.waitForSelector('.admin .content')
  await nav(page, '年度の設定')
  await page.evaluate(() => document.querySelector('.next-year button').click())
  await page.waitForSelector('.modal input')
  await clickButton(page, '作成する')
  await page.waitForFunction(() => document.querySelector('.badge.draft')?.textContent === '準備中', { timeout: 30000 })
  await sleep(600)
  // 知らせ（作った年度の）を消して、共通の題目を長くする（打っている途中に「確認」が出る）
  await nav(page, 'コース')
  await nav(page, '年度の設定')
  const title = await page.$('#y-commonTitle')
  await title.click({ clickCount: 3 })
  await title.type('卒業イベント「モダン・クラシック」ファッションショーについて')
  await sleep(400)
  await page.evaluate(() => document.querySelector('#y-commonTitle').scrollIntoView({ block: 'center' }))
  await sleep(300)
  // ---- G いま ----
  await shot(page, 'g-now', await clipOf(page, '.admin .content', 0))
  // ---- G 案1：確認はその欄のすぐ下 ----
  await inject(page, '.content .problems { display: none !important; }')
  await page.evaluate(() => {
    const row = document.querySelector('#y-commonTitle').closest('.row, .field, div')
    const w = document.createElement('p')
    w.dataset.mkEl = ''
    w.textContent = '確認：表紙の1行に収まらないおそれがあります（全角18字ほどまで。今は28字）'
    Object.assign(w.style, { margin: '6px 0 0', padding: '6px 10px', borderRadius: '8px', background: '#fff6e2', color: '#8a5a00', fontSize: '13px', lineHeight: '1.5' })
    document.querySelector('#y-commonTitle').parentElement.append(w)
    void row
  })
  await sleep(200)
  await page.evaluate(() => document.querySelector('#y-commonTitle').scrollIntoView({ block: 'center' }))
  await sleep(200)
  await shot(page, 'g-1', await clipOf(page, '.admin .content', 0))
  await clean(page)
  await inject(page, null)

  // ---- H 手順4 ----
  await page.evaluate(() => document.querySelector('.steps-card').scrollIntoView({ block: 'start' }))
  await sleep(300)
  FACTS.step4 = await page.evaluate(() => [...document.querySelectorAll('.steps li')].map((li) => li.textContent.trim()))
  await shot(page, 'h-now', await clipOf(page, '.admin .content', 0))
  await page.evaluate(() => {
    const li = [...document.querySelectorAll('.steps li')][3]
    const st = li?.querySelector('.st')
    if (st) st.textContent = '確認はすべて確かめました'
    li?.classList.add('done')
    const i = li?.querySelector('i')
    if (i) i.textContent = '✓'
    const pr = document.querySelector('.content .problems')
    for (const d of pr?.querySelectorAll('.warning') ?? []) {
      const b = document.createElement('button')
      b.dataset.mkEl = ''
      b.textContent = '✓ 確かめた'
      Object.assign(b.style, { marginLeft: '10px', padding: '2px 10px', border: '1px solid #c7b27a', borderRadius: '999px', background: '#fff', color: '#6b5200', fontSize: '12.5px' })
      d.append(b)
      d.style.opacity = '0.7'
    }
  })
  await shot(page, 'h-1', await clipOf(page, '.admin .content', 0))
  await clean(page)

  // ---- I 変更を見る ----
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '変更を見る').click())
  await page.waitForSelector('.changes-modal')
  await sleep(300)
  await shot(page, 'i-now', await clipOf(page, '.changes-modal', 12))
  await page.evaluate(() => {
    const list = document.querySelector('.changes-modal .change-list')
    for (const li of list.querySelectorAll('li')) {
      const name = li.textContent.trim()
      const ex = name === '共通の題目' ? ['卒業イベント「シンドバッド」について', '卒業イベント「モダン・クラシック」ファッションショーについて'] : null
      li.innerHTML = ''
      const b = document.createElement('div')
      b.innerHTML = `<b style="display:block">${name}</b>` + (ex ? `<span style="color:#6b655d;font-size:13px">${ex[0]}</span> <span style="color:#2f3e75">→</span> <span style="font-size:13px">${ex[1]}</span>` : '')
      li.append(b)
      const go = document.createElement('span')
      go.textContent = 'この欄へ ›'
      Object.assign(go.style, { color: '#2f3e75', fontSize: '12.5px', marginLeft: 'auto', whiteSpace: 'nowrap' })
      li.append(go)
      Object.assign(li.style, { display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '8px 10px', margin: '0 0 6px -18px', listStyle: 'none', border: '1px solid #e5e1da', borderRadius: '10px' })
    }
  })
  await shot(page, 'i-1', await clipOf(page, '.changes-modal', 12))
  await context.close()
}

const fixture = (src, name) => ({ name, b64: readFileSync(`scripts/e2e/fixtures/${src}`).toString('base64'), lastModified: Date.now() - 3_600_000, type: '' })

async function check(browser) {
  const context = await browser.createBrowserContext()
  let page = await context.newPage()
  await stubConfig(page)
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.goto(`${APP}/check.html`, { waitUntil: 'networkidle0', timeout: 120000 })
  await page.waitForSelector('.c2-side')
  const files = [fixture('word-sample-cover.docx', '01_表紙.docx'), fixture('word-sample-abstract.docx', '02_抄録.docx'), fixture('word-sample-toc.docx', '03_目次.docx'), fixture('word-sample-body.docx', '04_本文.docx')]
  await page.evaluate((files) => {
    const dt = new DataTransfer()
    for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { lastModified: f.lastModified, type: f.type }))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, files)
  await page.waitForFunction(() => document.querySelectorAll('.pf .fname').length >= 4, { timeout: 120000 })
  await page.waitForFunction(() => document.querySelector('main')?.dataset.busy === 'false' && !document.querySelector('.pg-wait'), { timeout: 120000 })
  await sleep(800)
  FACTS.resultsTop = await page.evaluate(() => Math.round(document.querySelector('.c2-side').getBoundingClientRect().top + scrollY))
  await shot(page, 'l-now')
  // 案1：下の帯に「エラーが n件残っています ▼ 結果を見る」（押すと結果へ）
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('1つの PDF にまとめる'))
    const n = document.querySelector('.c2-side')?.textContent.match(/(d+)s*エラー/)?.[1] ?? '6'
    const line = document.createElement('button')
    line.dataset.mkEl = ''
    line.innerHTML = `<span style="color:#c0392b;font-weight:700">エラーが${n}件残っています</span><span style="margin-left:auto;padding:4px 12px;border-radius:999px;background:#c0392b;color:#fff;font-size:13px;font-weight:700">結果を見る ▼</span>`
    Object.assign(line.style, { display: 'flex', alignItems: 'center', width: '100%', margin: '0 0 10px', padding: '8px 12px', border: '1.5px solid #e9b8b0', borderRadius: '10px', background: '#fdf1ef', font: 'inherit', fontSize: '14px' })
    btn.before(line)
  })
  await sleep(300)
  await shot(page, 'l-1')
  await page.close()
  page = await context.newPage()
  await stubConfig(page)
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.goto(`${APP}/check.html`, { waitUntil: 'networkidle0', timeout: 120000 })
  await page.waitForSelector('.c2-side')
  await page.evaluate((files) => {
    const dt = new DataTransfer()
    for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { lastModified: f.lastModified, type: f.type }))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, files)
  await page.waitForFunction(() => document.querySelectorAll('.pf .fname').length >= 4, { timeout: 120000 })
  await page.waitForFunction(() => document.querySelector('main')?.dataset.busy === 'false' && !document.querySelector('.pg-wait'), { timeout: 120000 })
  await sleep(800)
  // 案2：結果を、ファイルを入れる所のすぐ下に（ページの絵はその下）
  await inject(page, '.c2 { display: flex !important; flex-direction: column; } .c2 > .c2-side { order: 1; position: static !important; max-height: none !important; margin-bottom: 12px; } .c2 > .c2-main { order: 2; } .c2-main .c-top { order: 0; }')
  await page.evaluate(() => {
    const top = document.querySelector('.c2-main .c-top')
    const main = document.querySelector('.c2')
    if (top && main) main.prepend(top)
    if (top) top.style.order = '0'
  })
  await sleep(500)
  await shot(page, 'l-2')
  await context.close()
}

/** 一覧のページ（mockups/v49/review.html）を1枚の画像にする */
async function reviewShots(browser) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 1.25 })
  await page.goto(`${APP}/${DIR}/review.html`, { waitUntil: 'networkidle0', timeout: 120000 })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${OUT}/review-admin.png`, fullPage: true })
  console.log('✓ review-admin')
  await context.close()
}

await withEdge(async (browser) => {
  if (want('shots')) {
    // 先生の試しで撮った「いま」の写真（J・K）
    for (const [from, to] of [['t06-teacher-sent-back.png', 'j-now.png'], ['t02-teacher-fresh.png', 'k-now.png']]) {
      try {
        copyFileSync(`poc-output/review-1021/teacher/${from}`, `${OUT}/${to}`)
      } catch {
        console.log(`写真がない：${from}`)
      }
    }
    await admin(browser)
    await check(browser)
    writeFileSync(`${OUT}/facts.json`, JSON.stringify(FACTS, null, 2))
    console.log(JSON.stringify(FACTS))
  }
  if (want('review')) await reviewShots(browser)
})
