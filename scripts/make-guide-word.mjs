// 学生に配る案内「Word から報告書作成ツールへの移り方」（今年度だけ）を作る。
//   1. 本物のツール（開発サーバー http://localhost:5173）を Edge で操作して、手順の画面の画像を撮る（docs/guide-images/step*.png）
//   2. ツールの URL の QR コードを作る（docs/guide-images/qr.svg）
//   3. 案内の HTML（docs/案内_Wordからの移り方.html。A4 縦 1枚）を PDF にする（docs/案内_Wordからの移り方.pdf）
// 使い方: node scripts/make-guide-word.mjs            … 画像を撮り直して PDF を作る（開発サーバーが動いていること）
//         node scripts/make-guide-word.mjs --pdf-only … HTML を書き直したあと（日付を入れたなど）、PDF だけ作り直す
// 画面の画像には、架空の見本の Word（scripts/e2e/fixtures/word-sample-*.docx）を使う。本物の Google にはつながない
// （ログインの画面は、Google のログインの部品を偽物に差し替えて撮る。押さない）。
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import QRCode from 'qrcode'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

// ほかの確かめ（smoke など）と同時に動かしても Edge がぶつからないよう、別のポートを使う（edge.mjs は読み込んだときにポートを決めるので、先に決める）
process.env.EDGE_PORT ??= '9359'
const { withEdge } = await import('./poc/edge.mjs')
const { stubConfig } = await import('./e2e/configStub.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
/** 学生に配るツールの URL（QR コードにする） */
const TOOL_URL = 'https://junnosukekato.github.io/sotsugyo-seisaku-report/'
const HTML = 'docs/案内_Wordからの移り方.html'
const PDF = 'docs/案内_Wordからの移り方.pdf'
const IMG = 'docs/guide-images'
const pdfOnly = process.argv.includes('--pdf-only')
mkdirSync(IMG, { recursive: true })

const pause = (ms = 400) => new Promise((r) => setTimeout(r, ms))

/** 撮っている途中に src/ が直されても、画面が入れ替わらないようにする（開発サーバーの即時反映をつながない。smoke.mjs と同じ） */
const noHotReload = (page) =>
  page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
  })

/**
 * 画像に写さないもの：試験用の設定にある「（自動テスト用）」のコースのお知らせ。
 * mark：押すところを囲む枠（案内の画像の中で、どこを押すかが分かるように）
 */
const SHOT_CSS = `
.side .notice, .sheet-body .notice { display: none !important; }
.guide-mark { outline: 3px solid #e0782a !important; outline-offset: 3px !important; border-radius: 8px; }
* { caret-color: transparent !important; }
`

/** 要素（いくつかなら、それらを囲む範囲）を、まわりに余白を付けて撮る（marginBottom：下の余白だけ変えるとき） */
async function shot(page, selectors, file, margin = 0, marginBottom = margin) {
  const rect = await page.evaluate((selectors) => {
    const rs = selectors.map((s) => [...document.querySelectorAll(s)].find((e) => e.getBoundingClientRect().width > 0)?.getBoundingClientRect()).filter(Boolean)
    if (!rs.length) return null
    const left = Math.min(...rs.map((r) => r.left))
    const top = Math.min(...rs.map((r) => r.top))
    return { left, top, right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) }
  }, selectors)
  if (!rect) throw new Error(`画面に ${selectors.join(', ')} が見つかりません`)
  const vw = page.viewport().width
  const vh = page.viewport().height
  const x = Math.max(0, rect.left - margin)
  const y = Math.max(0, rect.top - margin)
  const clip = { x, y, width: Math.min(vw, rect.right + margin) - x, height: Math.min(vh, rect.bottom + marginBottom) - y }
  await page.screenshot({ path: `${IMG}/${file}`, clip })
  console.log(`  ${IMG}/${file}  (${Math.round(clip.width)}×${Math.round(clip.height)})`)
}

/** 押すところに枠を付ける（text があれば、その文字を含むものだけ） */
const mark = (page, selector, text) =>
  page.evaluate(
    (selector, text) => {
      document.querySelectorAll('.guide-mark').forEach((e) => e.classList.remove('guide-mark'))
      for (const e of document.querySelectorAll(selector)) if (!text || e.textContent.includes(text)) e.classList.add('guide-mark')
    },
    selector,
    text,
  )

/** Google のログインの部品（偽物）。ログインの画面を撮るだけなので、押しても何もしない */
const FAKE_GIS = `window.google = window.google || {};
window.google.accounts = { oauth2: { initTokenClient: () => ({ requestAccessToken: () => {} }), hasGrantedAllScopes: () => false, revoke: (t, done) => done && done() } };`

async function takeShots(browser) {
  // 見本の Word を、学生のファイルと同じ名前（04_本文.docx・01_表紙.docx）にして選ぶ（中身は架空）
  const FIX = process.env.WORD_FIXTURES ?? 'scripts/e2e/fixtures'
  const dir = join(tmpdir(), 'sotsugyo-guide-word')
  mkdirSync(dir, { recursive: true })
  const bodyDocx = join(dir, '04_本文.docx')
  const coverDocx = join(dir, '01_表紙.docx')
  copyFileSync(`${FIX}/word-sample-body.docx`, bodyDocx)
  copyFileSync(`${FIX}/word-sample-cover.docx`, coverDocx)

  // ---- ① ログインの画面（Google のログインの部品は偽物。Google へは何も送らない） ----
  {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await noHotReload(page)
    await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 2 })
    const config = JSON.parse(readFileSync('scripts/e2e/config-fixture.json', 'utf8'))
    await page.setRequestInterception(true)
    page.on('request', (request) => {
      const url = request.url()
      if (/script\.google(usercontent)?\.com/.test(url))
        return request.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, year: config.fiscalYear, config }) })
      if (url.startsWith('https://accounts.google.com/gsi/client')) return request.respond({ status: 200, contentType: 'text/javascript', body: FAKE_GIS })
      // そのほか、Google などの外への通信はすべて止める
      if (!/^https?:\/\/localhost[:/]/.test(url) && !url.startsWith('data:') && !url.startsWith('blob:')) return request.abort()
      return request.continue()
    })
    await page.goto(`${APP}/`, { waitUntil: 'networkidle0' })
    await page.waitForSelector('.login-over .login-btn')
    await page.addStyleTag({ content: SHOT_CSS })
    await mark(page, '.login-btn')
    await pause(500)
    await shot(page, ['.login-card'], 'step1-login.png', 14)
    await context.close()
  }

  // ---- ②〜⑥ はじめて開いてから、Word を読み込むまで（ログインなしで試せる ?nodrive） ----
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await noHotReload(page)
  await stubConfig(page)
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 })
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0' })
  const ready = () =>
    page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 60000 })
  await ready()
  await page.addStyleTag({ content: SHOT_CSS })
  const clickButton = (sel, text) => page.evaluate((sel, text) => [...document.querySelectorAll(sel)].find((b) => b.textContent.includes(text)).click(), sel, text)

  // ② コースを選ぶ（表紙のコース欄の上に案内が出る）
  // （どのコースでもよいので枠は付けない。案内の、コースのボタンと注意書きまでを撮る）
  await page.waitForSelector('.guide.step-course .g-opts button')
  await pause(800)
  await shot(page, ['.g-tip .g-steps', '.g-tip h2', '.g-tip .g-note'], 'step2-course.png', 18, 8)

  // ③ 「Word で書き始めていますか？」→「はい、Word から読み込む」
  await page.evaluate(() => document.querySelector('.g-opts button').click())
  await page.waitForSelector('.guide.step-word .g-word-opt.yes')
  await ready()
  await pause(800)
  await mark(page, '.g-word-opt.yes')
  await shot(page, ['.g-tip'], 'step3-word.png', 16)

  // ④ 本文と表紙の Word を選ぶ
  await page.evaluate(() => document.querySelector('.g-word-opt.yes').click())
  await page.waitForSelector('.modal.word-mid')
  const choose = async (row, path) => {
    const [chooser] = await Promise.all([page.waitForFileChooser(), page.evaluate((row) => document.querySelectorAll('.word-file .acts button:not(.link)')[row].click(), row)])
    await chooser.accept([path])
    await pause(300)
  }
  await choose(0, bodyDocx)
  await choose(1, coverDocx)
  await page.evaluate(() => document.activeElement?.blur())
  await mark(page, '.modal .row-buttons button', '中身を確かめる')
  await pause(300)
  await shot(page, ['.modal.word-mid'], 'step4-files.png')

  // ⑤ 中身を確かめて「読み込む」
  await mark(page, '.nothing')
  await clickButton('.modal .row-buttons button', '中身を確かめる')
  await page.waitForSelector('.modal.word-modal, .word-error', { timeout: 60000 })
  if (await page.$('.word-error')) throw new Error(`見本の Word を読み取れませんでした：${await page.$eval('.word-error', (e) => e.textContent)}`)
  await page.waitForFunction(() => [...document.querySelectorAll('.word-figs img')].every((i) => i.complete && i.naturalWidth > 0), { timeout: 20000 })
  await page.evaluate(() => document.activeElement?.blur())
  await mark(page, '.modal .row-buttons button.primary', '読み込む')
  await pause(300)
  await shot(page, ['.modal.word-modal'], 'step5-confirm.png')

  // ⑥ 読み込んだあと：右の欄の「つぎにすること」
  await mark(page, '.nothing')
  await clickButton('.modal .row-buttons button', '読み込む')
  await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 60000 })
  await pause(500)
  await ready()
  if (await page.$('.guide')) {
    await page.evaluate(() => document.querySelector('.g-later')?.click())
    await ready()
  }
  await page.evaluate(() => document.activeElement?.blur())
  await pause(600)
  await shot(page, ['.side .word-todo'], 'step6-todo.png', 10)
  await context.close()
}

async function makeQr() {
  const svg = await QRCode.toString(TOOL_URL, { type: 'svg', errorCorrectionLevel: 'M', margin: 0, color: { dark: '#1d2030', light: '#ffffff' } })
  writeFileSync(`${IMG}/qr.svg`, svg)
  console.log(`  ${IMG}/qr.svg  (${TOOL_URL})`)
}

async function makePdf(browser) {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('pageerror(pdf):', e.message))
  page.on('requestfailed', (r) => console.log('読み込めなかったもの:', r.url()))
  await page.goto(pathToFileURL(resolve(HTML)).href, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  const check = await page.evaluate(() => ({
    font: document.fonts.check('16px "BIZ UDPGothic"') && document.fonts.check('bold 16px "BIZ UDPGothic"'),
    images: [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src')),
    // 用紙（A4：297mm）からはみ出していないか
    overflow: (() => {
      const sheet = document.querySelector('.sheet')
      return sheet.scrollHeight - sheet.clientHeight
    })(),
  }))
  if (!check.font) console.log('！ BIZ UDPゴシックを読み込めませんでした（node_modules/@fontsource/biz-udpgothic があるか確かめてください）')
  if (check.images.length) console.log(`！ 読み込めなかった画像：${check.images.join(', ')}`)
  // はみ出した分は用紙の外で切れる（PDF は1ページのまま、下が欠ける）ので、失敗にする
  if (check.overflow > 0) {
    console.log(`！ 用紙から ${check.overflow}px はみ出しています（文を短くしてください）`)
    process.exitCode = 1
  }
  await page.pdf({ path: PDF, printBackground: true, preferCSSPageSize: true })
  await page.close()
  const doc = await getDocument({ data: new Uint8Array(readFileSync(PDF)), useSystemFonts: false }).promise
  console.log(`  ${PDF}  (${doc.numPages}ページ)`)
  if (doc.numPages !== 1) {
    console.log('！ 1ページに収まっていません')
    process.exitCode = 1
  }
}

if (!existsSync(HTML)) throw new Error(`${HTML} がありません`)
await withEdge(async (browser) => {
  if (!pdfOnly) {
    console.log('画面の画像を撮ります')
    await takeShots(browser)
    await makeQr()
  }
  console.log('PDF にします')
  await makePdf(browser)
})
