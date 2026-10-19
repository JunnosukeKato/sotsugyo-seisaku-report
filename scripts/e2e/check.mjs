// 提出前チェック（check.html）の通しの確かめ（Edge を自動で操作する。パソコン 1440×900 とスマホ 390×844）。
// 見本の Word・PDF（scripts/e2e/fixtures/word-sample-*。架空の原稿。make-word-sample.mjs で作る）を入れて、
// 分ける・チェックする・ページに枠を付ける・「Word のほうが新しい」・外す・移す・PDF だけのとき・確かめの窓・まとめて保存する、までを行う。
// ファイルをどこにも送らないこと（このページと、年度の設定の窓口のほかへの通信がないこと）と、画面にエラーが出ないことも確かめる。
// 使い方: node scripts/e2e/check.mjs（開発サーバーが http://localhost:5173 で動いていること。APP_URL で変えられる。EDGE_PORT で Edge のポート）
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { withEdge } from '../poc/edge.mjs'
import { stubConfig } from './configStub.mjs'
import { png } from './fixtures/docx.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const FIX = 'scripts/e2e/fixtures'
const OUT = 'poc-output/check'
mkdirSync(OUT, { recursive: true })
/** まとめた PDF の置き場所（毎回空にする） */
const DOWNLOADS = `${OUT}/downloads`
const FILE_NAME = '00ZZ0123_文化花子.pdf'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** 確かめている途中に src/ が直されても、画面が入れ替わらないようにする（smoke.mjs と同じ） */
const noHotReload = (page) =>
  page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
  })

// ---- 入れるファイル ----
const pdfTime = statSync(`${FIX}/word-sample-body.pdf`).mtimeMs
/** 見本のファイル（name：入れるときの名前、lastModified：ファイルの時刻） */
const fixture = (src, name, lastModified = pdfTime - 3_600_000) => ({ name, b64: readFileSync(`${FIX}/${src}`).toString('base64'), lastModified, type: name.endsWith('.pdf') ? 'application/pdf' : '' })
const WORDS = [
  fixture('word-sample-cover.docx', '01_表紙.docx'),
  // 名前で分からない抄録（中身から分ける）
  fixture('word-sample-abstract.docx', 'abstract-final.docx'),
  fixture('word-sample-toc.docx', '03_目次.docx'),
  // 本文の Word は、PDF より新しい（PDF を作り直していない）
  fixture('word-sample-body.docx', '04_本文.docx', pdfTime + 600_000),
]
const PDFS = [
  fixture('word-sample-cover.pdf', '01_表紙.pdf'),
  fixture('word-sample-abstract.pdf', '02_抄録.pdf'),
  // 名前で分からない目次の PDF（1ページ目の「目次」で分ける）
  fixture('word-sample-toc.pdf', 'scan_0001.pdf'),
  fixture('word-sample-body.pdf', '04_本文.pdf'),
]
// 作品写真（選ぶ画面から入れる）と、作り直した本文の PDF（今の時刻のファイル）
const PHOTO = resolve(`${OUT}/IMG_2041.png`)
writeFileSync(PHOTO, png(300, 400, { figure: [47, 62, 117] }))
const PHOTO2 = resolve(`${OUT}/IMG_2042.png`)
writeFileSync(PHOTO2, png(400, 300, { figure: [181, 140, 40] }))
// 作品写真の3〜5枚目（5枚で2ページになる：4枚ずつのページ。mockups/v38 案1）
const MORE_PHOTOS = [3, 4, 5].map((n, i) => {
  const path = resolve(`${OUT}/IMG_204${n}.png`)
  writeFileSync(path, png(300 + i * 20, 400, { figure: [60 + i * 40, 90, 120] }))
  return path
})
const NEW_BODY_PDF = resolve(`${OUT}/04_本文.pdf`)
writeFileSync(NEW_BODY_PDF, readFileSync(`${FIX}/word-sample-body.pdf`))
// 作り直した PDF は、本文の Word より新しい
utimesSync(NEW_BODY_PDF, new Date(), new Date(Math.max(Date.now(), pdfTime + 3_600_000)))

/** ページにファイルを落とす（ファイルの時刻を決められるように、ページの中でファイルを作る） */
const drop = (page, files) =>
  page.evaluate((files) => {
    const dt = new DataTransfer()
    for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { lastModified: f.lastModified, type: f.type }))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, files)

/** 読み終わり、確かめ終わり、ページの絵ができるまで待つ */
const settled = (page) =>
  page
    .waitForFunction(() => document.querySelector('main')?.dataset.busy === 'false' && !document.querySelector('.pg-wait'), { timeout: 120000, polling: 100 })
    .catch(async (e) => {
      // 待ちきれなかったときは、そのときの様子を出す（原因を探せるように）
      console.log('settled:', JSON.stringify(await page.evaluate(() => ({ busy: document.querySelector('main')?.dataset.busy, wait: document.querySelectorAll('.pg-wait').length, checking: document.querySelector('.checking')?.textContent, reading: document.querySelector('.drop small, .d-s')?.textContent, phase: document.querySelector('.modal')?.className }))))
      throw e
    })

/** ファイルを落として、入った（名前が出た）あと、読み終わるまで待つ */
async function put(page, files) {
  await drop(page, files)
  await page.waitForFunction((names) => names.every((n) => [...document.querySelectorAll('.pf .fname')].some((x) => x.textContent === n)), { timeout: 120000, polling: 100 }, files.map((f) => f.name))
  await settled(page)
}

/** パートの見出しの下のファイルの名前 */
const filesOf = (page, part) => page.evaluate((part) => [...document.querySelectorAll(`[aria-label="${part}"] .pf`)].map((x) => x.textContent.replace(/\s/g, '')), part)
const findingTexts = (page) => page.evaluate(() => [...document.querySelectorAll('.c2-side .issue')].map((li) => li.textContent))
const tally = (page) => page.evaluate(() => document.querySelector('.c2-side .tally')?.textContent.replace(/\s/g, '') ?? '')

/** 保存された PDF を待つ */
async function savedPdf(name) {
  for (let i = 0; i < 80 && !existsSync(`${DOWNLOADS}/${name}`); i++) await wait(250)
  if (!existsSync(`${DOWNLOADS}/${name}`)) return null
  await wait(300)
  const bytes = new Uint8Array(readFileSync(`${DOWNLOADS}/${name}`))
  const lib = await PDFDocument.load(bytes)
  const doc = await getDocument({ data: bytes.slice(), verbosity: 0 }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i)
    const text = (await p.getTextContent()).items.map((it) => it.str ?? '').join('').replace(/\s/g, '')
    const view = p.getViewport({ scale: 1 })
    // 画像の数（作品写真のページに、写真が何枚あるか）
    const images = (await p.getOperatorList()).fnArray.filter((fn) => fn === OPS.paintImageXObject).length
    pages.push({ text, w: Math.round(view.width), h: Math.round(view.height), images })
  }
  await doc.loadingTask.destroy()
  return { count: lib.getPageCount(), pages }
}

/** このページと、年度の設定の窓口（Apps Script）のほかへの通信を記録する */
const ALLOWED = /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/|data:|blob:|https:\/\/script\.google(usercontent)?\.com\/)/
function watch(page, label) {
  const outside = []
  const errors = []
  page.on('request', (r) => {
    if (!ALLOWED.test(r.url())) outside.push(r.url())
  })
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(e.message))
  return () => {
    check(`${label}：このページと年度の設定の窓口のほかへは、何も送らない（通信しない）`, outside.length === 0, outside.slice(0, 3).join(' '))
    check(`${label}：画面にエラー（console.error）が出ない`, errors.length === 0, errors.slice(0, 3).join(' | '))
  }
}

async function open(browser, viewport, label) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await noHotReload(page)
  await stubConfig(page)
  const done = watch(page, label)
  await (await page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: resolve(DOWNLOADS), browserContextId: context.id })
  await page.setViewport(viewport)
  await page.goto(`${APP}/check.html`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.c2-side')
  return { context, page, done }
}

await withEdge(async (browser) => {
  // =====================================================================
  // パソコン（1440×900）
  // =====================================================================
  rmSync(DOWNLOADS, { recursive: true, force: true })
  mkdirSync(DOWNLOADS, { recursive: true })
  {
    const { context, page, done } = await open(browser, { width: 1440, height: 900 }, 'パソコン')
    const empty = await page.evaluate(() => ({
      title: document.querySelector('h1')?.textContent,
      year: document.querySelector('.brand small')?.textContent,
      safe: document.querySelector('.safe')?.textContent,
      frames: document.querySelectorAll('.pg.none').length,
      parts: [...document.querySelectorAll('.p-seg > header b')].map((b) => b.textContent),
      disabled: document.querySelector('.merge .btn.big')?.disabled,
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? '',
      scroll: document.documentElement.scrollHeight <= innerHeight,
    }))
    await page.screenshot({ path: `${OUT}/c2-empty-pc.png` })
    check('開くと：「提出前チェック」・年度・「ファイルは外に送りません」、5つのパートの空の枠（本文は5ページ分）、まとめるボタンは押せない', empty.title === '提出前チェック' && /2026年度/.test(empty.year) && /外に送りません/.test(empty.safe) && empty.frames === 9 && empty.parts.join(',') === '表紙,抄録,目次,本文,作品写真' && empty.disabled === true, JSON.stringify(empty))
    check('ページの決まり（CSP）：送り先は学科の Apps Script だけ（Google のログインやドライブは入れない）', /connect-src 'self' blob: data: https:\/\/script\.google\.com https:\/\/script\.googleusercontent\.com/.test(empty.csp) && !/googleapis|accounts\.google/.test(empty.csp), empty.csp.slice(0, 80))
    check('開いたところは、画面の高さに収まる', empty.scroll)

    // ---- 使い方 ----
    await page.click('.help-btn')
    await page.waitForSelector('.modal .help-steps')
    const help = await page.evaluate(() => ({ steps: document.querySelectorAll('.help-steps li').length, text: document.querySelector('.modal').textContent.length, focus: document.activeElement?.textContent }))
    await page.screenshot({ path: `${OUT}/help-pc.png` })
    await page.keyboard.press('Escape')
    await wait(150)
    const helpClosed = await page.evaluate(() => ({ modal: !!document.querySelector('.modal'), focus: document.activeElement?.className }))
    check('「使い方」：3つの手順の短い窓（Esc で閉じ、ボタンに戻る）', help.steps === 3 && help.text < 300 && !helpClosed.modal && helpClosed.focus === 'help-btn', `${help.text}字 ${JSON.stringify(helpClosed)}`)

    // ---- PDF だけ（Word なし） ----
    await put(page, PDFS)
    const pdfOnly = await page.evaluate(() => ({
      unchecked: document.querySelector('.unchecked b')?.textContent,
      oks: [...document.querySelectorAll('.oks li')].map((li) => li.textContent),
      issues: [...document.querySelectorAll('.issue .ttl')].map((x) => x.textContent),
      note: document.querySelector('.m-note')?.textContent,
      toc: [...document.querySelectorAll('[aria-label="目次"] .pf')].map((x) => x.textContent),
      thumbs: document.querySelectorAll('.pg img').length,
    }))
    await page.screenshot({ path: `${OUT}/c2-pdfonly-pc.png` })
    check('PDF だけのとき：「Word を入れていないので、チェックしていません」と出し、PDF から分かることは確かめる', pdfOnly.unchecked === 'Word を入れていないので、チェックしていません' && pdfOnly.oks.some((t) => t.includes('抄録のページの数')) && pdfOnly.oks.some((t) => t.includes('どのページも A4')) && pdfOnly.issues.some((t) => t.startsWith('本文はA4で5ページ以上にする')), JSON.stringify(pdfOnly))
    check('名前で分からない PDF（scan_0001.pdf）は、1ページ目の「目次」で目次に入る。ページの絵が6枚できる', pdfOnly.toc.some((t) => t.includes('scan_0001.pdf')) && pdfOnly.thumbs === 6, JSON.stringify(pdfOnly.toc))

    // ---- Word を入れる ----
    await put(page, WORDS)
    const loaded = await page.evaluate(() => ({
      abstract: [...document.querySelectorAll('[aria-label="抄録"] .pf')].map((x) => x.textContent),
      groups: [...document.querySelectorAll('.igroup .ig-h')].map((x) => x.firstChild.textContent),
      stale: document.querySelector('.p-note')?.textContent,
      legend: !!document.querySelector('.c2-legend'),
      sevLegend: document.querySelector('.c2-side .sev-legend')?.textContent ?? '',
      chips: document.querySelectorAll('.issue .src').length,
      pins: [...document.querySelectorAll('.pg .pin')].map((x) => x.textContent),
    }))
    const t = await tally(page)
    const texts = await findingTexts(page)
    await page.screenshot({ path: `${OUT}/c2-loaded-pc.png` })
    check('Word を入れると：名前で分からない抄録の Word（abstract-final.docx）は中身から抄録に入る', loaded.abstract.some((x) => x.includes('abstract-final.docx')), JSON.stringify(loaded.abstract))
    check('指摘がパートごとに出る（エラー・要確認の数）。札「手順書」「補助」はなく、一覧の上に「エラー：直してから出す」「要確認：確かめて、必要なら直す」', /^\d+エラー\d+要確認$/.test(t) && !t.startsWith('0') && loaded.groups.join(',') === '抄録,目次,本文' && loaded.chips === 0 && loaded.sevLegend.includes('エラー：直してから出す') && loaded.sevLegend.includes('要確認：確かめて、必要なら直す'), `${t} ${loaded.groups}`)
    check('抄録：600〜900字・「である」調（指摘した文字に印）', texts.some((x) => x.includes('抄録は600〜900字にする')) && (await page.$('.issue mark')) !== null && texts.some((x) => x.includes('巻きました')))
    check('目次：ひな形と違う余白（左 30mm）と、本文にない見出し「まとめ」', texts.some((x) => x.includes('左 30mm')) && texts.some((x) => x.includes('目次にだけある：「まとめ」')))
    check('ツールの中でしか意味のない指摘（抄録はまだ書いていない・作品写真を入れる）は出さない', !texts.some((x) => /まだ書いていない|作品写真を入れる|コースが選ばれていない/.test(x)))
    check('Word のほうが新しい本文：「PDF が Word より古いようです」と「PDF を入れ替える」が出て、チェックの結果にも「Word を直したら、PDF も作り直す」（時刻つき）が出る', /PDF が Word より古いようです/.test(loaded.stale ?? '') && /PDF を入れ替える/.test(loaded.stale ?? '') && texts.some((x) => x.includes('Word を直したら、PDF も作り直す') && /Word：[0-9]+月[0-9]+日/.test(x)), loaded.stale)
    // 確かめの窓にも出る（エラーの数のほかに）
    await page.click('.merge .btn.big')
    await page.waitForSelector('.modal.confirm')
    const staleAsk = await page.evaluate(() => [...document.querySelectorAll('.modal.confirm .cf-sub')].map((x) => x.textContent))
    await page.evaluate(() => document.querySelector('.modal.confirm .go-back').click())
    await wait(150)
    check('確かめの窓：「本文の PDF が、Word より古いようです。」も出る', staleAsk.includes('本文の PDF が、Word より古いようです。'), JSON.stringify(staleAsk))
    check('指摘のあるページに、数の丸が付く', loaded.pins.length > 0 && loaded.legend, JSON.stringify(loaded.pins))
    check('ファイル名は、表紙の学籍番号・氏名から', (await page.evaluate(() => document.querySelector('.m-file b')?.textContent)) === FILE_NAME)

    // ---- 指摘を押す → そのページに枠 ----
    const located = await page.evaluate(() => {
      const li = [...document.querySelectorAll('.issue')].find((x) => x.querySelector('.loc')?.textContent === '本文 2ページ目')
      li?.querySelector('.go').click()
      return li?.dataset.finding ?? null
    })
    await wait(300)
    const ring = await page.evaluate(() => ({ sel: [...document.querySelectorAll('.pg.sel')].map((x) => x.closest('figure').dataset.page), issue: !!document.querySelector('.issue.sel'), pressed: document.querySelector('.issue.sel .go')?.getAttribute('aria-pressed') }))
    await page.screenshot({ path: `${OUT}/c2-ring-pc.png` })
    check('「本文 2ページ目」の指摘を押すと、本文の2ページ目に枠が付く', !!located && ring.sel.join() === 'body:2' && ring.issue && ring.pressed === 'true', JSON.stringify(ring))
    // キーボード：Tab で指摘に移り、Enter で選ぶ
    await page.evaluate(() => document.querySelector('.issue .go').focus())
    await page.keyboard.press('Enter')
    await wait(150)
    check('キーボードでも、指摘を選べる（Enter）', await page.evaluate(() => document.querySelector('.issue .go')?.getAttribute('aria-pressed') === 'true'))

    // ---- 「PDF を入れ替える」（作り直した本文の PDF） ----
    const [replaceChooser] = await Promise.all([page.waitForFileChooser(), page.evaluate(() => [...document.querySelectorAll('.p-note .link')][0].click())])
    await replaceChooser.accept([NEW_BODY_PDF])
    await page.waitForFunction(() => !document.querySelector('.p-note'), { timeout: 30000 }).catch(() => {})
    await settled(page)
    check('「PDF を入れ替える」で新しい PDF を入れると、知らせが消える', !(await page.$('.p-note')))

    // ---- 外す・移す ----
    const tocBefore = await filesOf(page, '目次')
    await page.evaluate(() => [...document.querySelectorAll('[aria-label="目次"] .pf')].find((x) => x.textContent.includes('03_目次.docx')).querySelector('.x').click())
    await settled(page)
    const tocAfter = await filesOf(page, '目次')
    const textsAfter = await findingTexts(page)
    check('× で外すと、そのファイルがなくなり（「Word なし」）、その指摘も消える', tocBefore.some((x) => x.includes('03_目次.docx')) && tocAfter.includes('Wordなし') && !textsAfter.some((x) => x.includes('左 30mm')), JSON.stringify(tocAfter))
    // 抄録の PDF を、目次に移す（目次の PDF と入れ替わる）→ 戻す
    const move = async (part, name, to) => {
      await page.evaluate((part, name) => [...document.querySelectorAll(`[aria-label="${part}"] .pf .fname`)].find((x) => x.textContent.includes(name)).click(), part, name)
      await page.waitForSelector('.move-menu')
      const focus = await page.evaluate(() => document.activeElement?.closest('.move-menu') !== null)
      await page.evaluate((to) => [...document.querySelectorAll('.move-menu button')].find((b) => b.textContent.startsWith(to)).click(), to)
      await settled(page)
      return focus
    }
    const focusInMenu = await move('抄録', '02_抄録.pdf', '目次の PDF')
    const moved = { abstract: await filesOf(page, '抄録'), toc: await filesOf(page, '目次') }
    await page.screenshot({ path: `${OUT}/c2-moved-pc.png` })
    check('ファイルの名前を押すと小さな窓が開き（窓の中に移る）、ほかの場所へ移せる（移す先のファイルと入れ替わる）', focusInMenu && moved.toc.some((x) => x.includes('02_抄録.pdf')) && moved.abstract.some((x) => x.includes('scan_0001.pdf')), JSON.stringify(moved))
    await move('目次', '02_抄録.pdf', '抄録の PDF')
    await put(page, [WORDS[2]])
    const back = { abstract: await filesOf(page, '抄録'), toc: await filesOf(page, '目次') }
    check('戻して、外した目次の Word を入れ直すと、元のとおり', back.abstract.some((x) => x.includes('02_抄録.pdf')) && back.toc.some((x) => x.includes('03_目次.docx')) && back.toc.some((x) => x.includes('scan_0001.pdf')), JSON.stringify(back))

    // ---- 確かめの窓（作品写真がまだ） ----
    await page.click('.merge .btn.big')
    await page.waitForSelector('.modal.confirm')
    const ask = await page.evaluate(() => ({
      role: document.querySelector('.modal.confirm').getAttribute('role'),
      title: document.querySelector('.modal.confirm h2').textContent,
      lead: document.querySelector('.modal.confirm .r-lead').textContent,
      sub: document.querySelector('.modal.confirm .cf-sub')?.textContent,
      focus: document.activeElement?.textContent,
    }))
    await page.screenshot({ path: `${OUT}/c2-confirm-pc.png` })
    check('エラーが残ったまま「1つの PDF にまとめる」：「エラーが◯件残っています」「このまままとめますか？」「作品写真も、まだありません。」、はじめは「戻って直す」', ask.role === 'alertdialog' && /^エラーが\d+件残っています$/.test(ask.title) && ask.lead === 'このまままとめますか？' && ask.sub === '作品写真も、まだありません。' && ask.focus === '戻って直す', JSON.stringify(ask))
    await page.evaluate(() => document.querySelector('.modal.confirm .go-back').click())
    await wait(300)
    const stayed = await page.evaluate(() => ({ modal: !!document.querySelector('.modal'), files: document.querySelectorAll('.pf .fname').length, saved: !!document.querySelector('.c-saved') }))
    check('「戻って直す」：窓が閉じ、入れたファイルはそのまま（保存しない）', !stayed.modal && stayed.files === 8 && !stayed.saved && readdirSync(DOWNLOADS).length === 0, JSON.stringify(stayed))

    // ---- 作品写真：読めない HEIC → 「写真を入れる」から入れる ----
    await drop(page, [{ name: 'IMG_9999.HEIC', b64: Buffer.from('not really a heic file').toString('base64'), lastModified: Date.now(), type: 'image/heic' }])
    await page.waitForFunction(() => [...document.querySelectorAll('.add-notes li')].some((x) => x.textContent.includes('IMG_9999.HEIC')), { timeout: 120000, polling: 100 })
    await settled(page)
    const heic = await page.evaluate(() => ({ note: [...document.querySelectorAll('.add-notes li')].map((x) => x.textContent).join(''), photo: document.querySelector('[aria-label="作品写真"] .pf')?.textContent }))
    check('読めない写真（HEIC）：入れずに、JPEG にするよう知らせる（作品写真は「まだありません」のまま）', /HEIC/.test(heic.note) && /JPEG/.test(heic.note) && heic.photo === 'まだありません', JSON.stringify(heic).slice(0, 160))
    // 「写真を入れる」から、2枚まとめて選ぶ（縦長と横長 → 上下に並ぶ）
    const [photoChooser] = await Promise.all([page.waitForFileChooser(), page.click('.pg.none.add')])
    await photoChooser.accept([PHOTO, PHOTO2])
    await page.waitForFunction(() => document.querySelector('[aria-label="作品写真"] .pf .fname')?.textContent === '写真 2枚', { timeout: 120000, polling: 100 })
    await settled(page)
    const photo = await page.evaluate(() => ({ img: !!document.querySelector('[aria-label="作品写真"] .pg img'), no: document.querySelector('[aria-label="作品写真"] figure')?.textContent, small: document.querySelector('.m-file small')?.textContent, label: document.querySelector('[aria-label="作品写真"] .p-f')?.textContent, errors: !!document.querySelector('.read-errors') }))
    check('「写真を入れる」から写真を2枚入れると、「写真 2枚（1ページ4枚まで）」で、1ページ（最後の7ページ目）に並ぶ', photo.img && photo.no === '7' && photo.small === '7ページ' && !!photo.label?.startsWith('写真 2枚（1ページ4枚まで）') && !photo.errors, JSON.stringify(photo))
    // 「並べ替え・外す」：2枚が並び、↓ で順番が変わる
    await page.click('[aria-label="作品写真"] .pf-link')
    await page.waitForSelector('.photo-menu')
    const before = await page.evaluate(() => [...document.querySelectorAll('.photo-menu li .fn')].map((x) => x.textContent))
    await page.evaluate(() => document.querySelector('.photo-menu li .pm-b[aria-label$="を後ろへ"]').click())
    await wait(400)
    const after = await page.evaluate(() => [...document.querySelectorAll('.photo-menu li .fn')].map((x) => x.textContent))
    await page.keyboard.press('Escape')
    await wait(150)
    check('作品写真の「並べ替え・外す」：写真の一覧が出て、順番を変えられる', before.join() === 'IMG_2041.png,IMG_2042.png' && after.join() === 'IMG_2042.png,IMG_2041.png' && !(await page.$('.photo-menu')), JSON.stringify({ before, after }))
    // 「写真を足す」から3枚足して5枚にする：入れた順に4枚ずつ、2ページ（7・8ページ目）に並ぶ（mockups/v38 案1。年度の設定にページ数の上限はない）
    await page.click('[aria-label="作品写真"] .pf-link')
    await page.waitForSelector('.photo-menu .pm-add')
    const [moreChooser] = await Promise.all([page.waitForFileChooser(), page.click('.photo-menu .pm-add')])
    await moreChooser.accept(MORE_PHOTOS)
    await page.waitForFunction(() => document.querySelector('[aria-label="作品写真"] .pf .fname')?.textContent === '写真 5枚・2ページ', { timeout: 120000, polling: 100 })
    await settled(page)
    const five = await page.evaluate(() => ({
      label: document.querySelector('[aria-label="作品写真"] .p-f')?.textContent,
      nos: [...document.querySelectorAll('[aria-label="作品写真"] figure')].map((f) => f.textContent),
      imgs: document.querySelectorAll('[aria-label="作品写真"] .pg img').length,
      small: document.querySelector('.m-file small')?.textContent,
    }))
    await page.screenshot({ path: `${OUT}/c2-photos-five-pc.png` })
    check('作品写真を5枚にすると「写真 5枚・2ページ（1ページ4枚まで）」で、7・8ページ目の2ページに並ぶ（全部で8ページ）', !!five.label?.startsWith('写真 5枚・2ページ（1ページ4枚まで）') && five.nos.join() === '7,8' && five.imgs === 2 && five.small === '8ページ', JSON.stringify(five))
    await page.click('[aria-label="作品写真"] .pf-link')
    await page.waitForSelector('.photo-menu')
    await wait(300)
    const menu = await page.evaluate(() => ({
      title: document.querySelector('.photo-menu .popover-title')?.textContent,
      rows: [...document.querySelectorAll('.photo-menu li')].map((li) => (li.classList.contains('pm-page') ? `[${li.textContent}]` : li.querySelector('.fn')?.textContent)),
      hint: document.querySelector('.photo-menu .pm-hint')?.textContent,
      add: !!document.querySelector('.photo-menu .pm-add'),
    }))
    await page.screenshot({ path: `${OUT}/c2-photos-five-menu.png` })
    await page.keyboard.press('Escape')
    await wait(150)
    check(
      '「並べ替え・外す」の窓：上に「5枚・2ページ（1ページに4枚まで）」、ページの区切り「1ページ目 4枚」「2ページ目 1枚」、下に「4枚ずつ、この順にページに並べます。」。上限がないので「写真を足す」は出たまま',
      menu.title === '作品写真5枚・2ページ（1ページに4枚まで）' && menu.rows.join() === '[1ページ目4枚],IMG_2042.png,IMG_2041.png,IMG_2043.png,IMG_2044.png,[2ページ目1枚],IMG_2045.png' && menu.hint?.startsWith('4枚ずつ、この順にページに並べます。') && menu.add,
      JSON.stringify(menu),
    )

    // ---- まとめて保存する ----
    await page.click('.merge .btn.big')
    await page.waitForSelector('.modal.confirm')
    const sub2 = await page.evaluate(() => document.querySelector('.modal.confirm .cf-sub')?.textContent ?? null)
    await page.evaluate(() => document.querySelector('.modal.confirm .go-merge').click())
    await page.waitForSelector('.c-saved', { timeout: 60000 })
    const saved = await savedPdf(FILE_NAME)
    await settled(page)
    const result = await page.evaluate(() => ({ title: document.querySelector('.c-saved .r-title')?.textContent, file: document.querySelector('.c-saved .pdf-file b')?.textContent, small: document.querySelector('.c-saved .pdf-file small')?.textContent, bar: !!document.querySelector('.merge'), focus: document.activeElement?.classList.contains('c-saved') }))
    await page.screenshot({ path: `${OUT}/c2-done-pc.png` })
    check('写真を入れたあとの確かめの窓には、「作品写真も…」は出ない', sub2 === null, String(sub2))
    check('「このまままとめる」：「ダウンロード」に保存し、「保存しました」とファイル名・ページの数・大きさを出す', result.title === '保存しました' && result.file === FILE_NAME && /^8ページ・[\d.]+(MB|KB)　「ダウンロード」のフォルダ$/.test(result.small) && !result.bar && result.focus, JSON.stringify(result))
    check('保存した PDF：8ページ（透かしなし・名前はそのまま）、表紙 → 抄録 → 目次 → 本文 → 作品写真（写真5枚を、入れた順に4枚＋1枚の2ページに）の順、どのページも A4', !!saved && saved.count === 8 && /学籍番号/.test(saved.pages[0].text) && /抄録/.test(saved.pages[1].text) && /^目次/.test(saved.pages[2].text) && /企画・立案/.test(saved.pages[3].text) && /使用素材/.test(saved.pages[4].text) && /制作過程/.test(saved.pages[5].text) && saved.pages[6].text === '' && saved.pages[6].images === 4 && saved.pages[7].text === '' && saved.pages[7].images === 1 && saved.pages.every((p) => p.w === 595 && p.h === 842) && !saved.pages.some((p) => p.text.includes('下書き')), JSON.stringify(saved?.pages.map((p) => [p.text.slice(0, 12), p.images])))

    // ---- はじめから（確かめの窓が出る。窓の外を押しても閉じない） ----
    await page.evaluate(() => [...document.querySelectorAll('.c-saved .btn')].find((b) => b.textContent === 'はじめから').click())
    await page.waitForSelector('.modal.confirm')
    const clearAsk = await page.evaluate(() => ({ title: document.querySelector('#cf-title')?.textContent, focus: document.activeElement?.textContent }))
    await page.mouse.click(5, 5)
    await wait(150)
    const stillOpen = await page.evaluate(() => !!document.querySelector('.modal.confirm') && !!document.querySelector('.pf .fname'))
    await page.evaluate(() => document.querySelector('.modal.confirm .go-clear').click())
    await wait(300)
    check('「はじめから」：「入れたファイルを、すべて外しますか？」と確かめ（はじめは「やめる」、窓の外を押しても閉じない）、外すと開いたところに戻る', clearAsk.title === '入れたファイルを、すべて外しますか？' && clearAsk.focus === 'やめる' && stillOpen && (await page.evaluate(() => !document.querySelector('.pf .fname') && !!document.querySelector('.drop.big') && !!document.querySelector('.merge'))), JSON.stringify({ ...clearAsk, stillOpen }))

    // ---- 間違ったファイル（1つにまとめた PDF・名前と中身が違う PDF・同じ場所に2つ） ----
    const all = await PDFDocument.create()
    for (const src of ['cover', 'abstract', 'toc', 'body']) {
      const doc = await PDFDocument.load(readFileSync(`${FIX}/word-sample-${src}.pdf`))
      for (const p of await all.copyPages(doc, doc.getPageIndices())) all.addPage(p)
    }
    const mergedB64 = Buffer.from(await all.save()).toString('base64')
    await put(page, [{ name: '卒業制作報告書.pdf', b64: mergedB64, lastModified: pdfTime, type: 'application/pdf' }])
    const merged = await findingTexts(page)
    check('自分で1つにまとめた PDF：表紙に入り、「表紙は1ページにする」（今 6ページ）のエラー', merged.some((x) => x.includes('表紙は1ページにする') && x.includes('今 6ページ')), JSON.stringify(merged))
    // 中身は本文なのに「表紙.pdf」（前の PDF と入れ替わったことも知らせる）
    await put(page, [fixture('word-sample-body.pdf', '表紙.pdf', pdfTime)])
    const wrong = await findingTexts(page)
    const replacedNote = await page.evaluate(() => [...document.querySelectorAll('.add-notes li')].map((x) => x.textContent))
    check('名前と中身が違う PDF：「表紙の PDF の1ページ目が、本文のようです」のエラー。入れ替えたことも知らせる', wrong.some((x) => x.includes('表紙の PDF の1ページ目が、本文のようです')) && replacedNote.some((x) => x.includes('表紙の PDF を「卒業制作報告書.pdf」から「表紙.pdf」に入れ替えました')), JSON.stringify({ wrong, replacedNote }))
    // 同じ場所に2つ（新しい本文を先に、古い本文をあとに入れる）：入れた順ではなく、新しいほうを使う
    const newer = { ...fixture('word-sample-body.pdf', '04_本文_新.pdf', pdfTime + 7_200_000) }
    const older = { ...fixture('word-sample-toc.pdf', '04_本文_古.pdf', pdfTime - 7_200_000) }
    // 古いほうは入らないので、put（全部の名前が出るのを待つ）は使わない
    await drop(page, [newer, older])
    await page.waitForFunction(() => [...document.querySelectorAll('.pf .fname')].some((x) => x.textContent === '04_本文_新.pdf'), { timeout: 120000, polling: 100 })
    await settled(page)
    const two = await page.evaluate(() => ({ body: [...document.querySelectorAll('[aria-label="本文"] .pf')].map((x) => x.textContent), notes: [...document.querySelectorAll('.add-notes li')].map((x) => x.textContent) }))
    check('同じ場所に2つ入れると、入れた順ではなく、ファイルの時刻が新しいほうを使い、そう知らせる', two.body.some((x) => x.includes('04_本文_新.pdf')) && !two.body.some((x) => x.includes('04_本文_古.pdf')) && two.notes.some((x) => x.includes('新しいほうの「04_本文_新.pdf」')), JSON.stringify(two))
    done()
    await context.close()
  }

  // =====================================================================
  // スマホ（390×844）
  // =====================================================================
  rmSync(DOWNLOADS, { recursive: true, force: true })
  mkdirSync(DOWNLOADS, { recursive: true })
  {
    const { context, page, done } = await open(browser, { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, 'スマホ')
    await page.screenshot({ path: `${OUT}/c2-empty-ph.png` })
    await put(page, [...WORDS, ...PDFS])
    const phone = await page.evaluate(() => {
      const visible = (el) => el.getBoundingClientRect().width > 0
      const small = [...document.querySelectorAll('.issue .detail, .issue .ttl, .pf, .m-file small, .m-note, .c2-legend, .fix-hint, .p-note, .drop small, .safe, .top .sub')]
        .filter(visible)
        .map((el) => parseFloat(getComputedStyle(el).fontSize))
      return {
        list: !!document.querySelector('.pp-list') && getComputedStyle(document.querySelector('.pp-list')).display !== 'none',
        parts: [...document.querySelectorAll('.pp .pp-info b')].map((b) => b.textContent),
        hscroll: document.documentElement.scrollWidth > innerWidth,
        minFont: Math.min(...small),
        stale: !!document.querySelector('.pp .p-note'),
      }
    })
    await page.screenshot({ path: `${OUT}/c2-loaded-ph.png`, fullPage: true })
    check('スマホ：パートを縦に並べ（ページの絵は行の中で横に動く）、画面は横に動かない', phone.list && phone.parts.join(',') === '表紙,抄録,目次,本文,作品写真' && !phone.hscroll && phone.stale, JSON.stringify(phone))
    check('スマホ：読む字は 13px 以上', phone.minFont >= 13, String(phone.minFont))
    // 指摘を押す → そのページに枠（ページの行の中で見える所へ）
    await page.evaluate(() => [...document.querySelectorAll('.issue')].find((x) => x.querySelector('.loc')?.textContent === '本文 2ページ目')?.querySelector('.go').click())
    await wait(600)
    const phoneRing = await page.evaluate(() => {
      const sel = document.querySelector('.pg.sel')
      const strip = sel?.closest('.pp-strip')?.getBoundingClientRect()
      const r = sel?.getBoundingClientRect()
      return { page: sel?.closest('figure')?.dataset.page, inStrip: !!r && !!strip && r.left >= strip.left - 1 && r.right <= strip.right + 1 }
    })
    check('スマホ：指摘を押すと、そのページに枠が付き、見える所に来る', phoneRing.page === 'body:2' && phoneRing.inStrip, JSON.stringify(phoneRing))
    // 360px でも横に動かない
    await page.setViewport({ width: 360, height: 780, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await wait(400)
    check('幅 360px でも、画面は横に動かない', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
    await wait(300)
    // 学籍番号・氏名が分からないとき（表紙の Word と PDF を外す）：入れる欄が出る
    for (const name of ['01_表紙.docx', '01_表紙.pdf']) await page.evaluate((name) => [...document.querySelectorAll('.pf')].find((x) => x.textContent.includes(name))?.querySelector('.x').click(), name)
    await settled(page)
    // 抄録の Word から読める（抄録にも学籍番号・氏名がある）ので、抄録の Word も外す
    await page.evaluate(() => [...document.querySelectorAll('.pf')].find((x) => x.textContent.includes('abstract-final.docx'))?.querySelector('.x').click())
    await settled(page)
    const noCover = await page.evaluate(() => document.querySelectorAll('.m-ask input').length)
    check('表紙をまだ入れていないときは、学籍番号・氏名を聞かない（「表紙から読み取れなかった」と言わない）', noCover === 0, String(noCover))
    // 学籍番号・氏名の書いていない表紙の PDF を入れる
    const blank = await PDFDocument.create()
    blank.addPage([595.28, 841.89])
    await put(page, [{ name: '01_表紙.pdf', b64: Buffer.from(await blank.save()).toString('base64'), lastModified: pdfTime, type: 'application/pdf' }])
    const asking = await page.evaluate(() => ({ inputs: document.querySelectorAll('.m-ask input').length, name: document.querySelector('.m-file b')?.textContent, font: parseFloat(getComputedStyle(document.querySelector('.m-ask input')).fontSize) }))
    await page.type('.m-ask label:nth-of-type(1) input', '00ZZ0123')
    await page.type('.m-ask label:nth-of-type(2) input', '文化 花子')
    const typed = await page.evaluate(() => document.querySelector('.m-file b')?.textContent)
    check('学籍番号・氏名を読み取れないときは、入れる欄が出て（字は 16px）、ファイル名に入る', asking.inputs === 2 && asking.name === '卒業制作報告書.pdf' && asking.font >= 16 && typed === FILE_NAME, `${JSON.stringify(asking)} ${typed}`)
    // まとめる（確かめの窓 → このまままとめる）
    await page.click('.merge .btn.big')
    await page.waitForSelector('.modal.confirm')
    await page.screenshot({ path: `${OUT}/c2-confirm-ph.png` })
    await page.evaluate(() => document.querySelector('.modal.confirm .go-merge').click())
    await page.waitForSelector('.c-saved, .c2-saved', { timeout: 60000 })
    const saved = await savedPdf(FILE_NAME)
    await settled(page)
    await page.screenshot({ path: `${OUT}/c2-done-ph.png`, fullPage: true })
    check('スマホ：まとめて保存できる（白紙の表紙 → 抄録 → 目次 → 本文 の6ページ）', !!saved && saved.count === 6 && /抄録/.test(saved.pages[1].text), JSON.stringify(saved?.pages.map((p) => p.text.slice(0, 8))))
    done()
    await context.close()
  }
})

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 件 合格`)
process.exitCode = failed.length ? 1 : 0
