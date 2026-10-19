// ドライブへの保存（ログイン必須）の通しの動作確認。Edge を自動で操作する。
// Google のログインとドライブは、偽物（fakeGoogle.mjs）に差し替える（本物の Google には一切つながない）。
// 使い方: node scripts/e2e/drive.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { readFileSync } from 'node:fs'
import { withEdge } from '../poc/edge.mjs'
import { fakeDrive, routeGoogle } from './fakeGoogle.mjs'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** 条件が満たされるまで待つ（満たされたら true） */
const until = async (fn, timeout = 30000) => {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(200)) if (await fn()) return true
  return false
}
const config = JSON.parse(readFileSync(new URL('./config-fixture.json', import.meta.url), 'utf8'))

/** 端末（ブラウザの別の窓口）を1つ用意する。phone：スマホの画面 */
async function device(browser, drive, { phone = false } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  page.on('dialog', (d) => d.accept())
  if (phone) await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  else await page.setViewport({ width: 1440, height: 900 })
  await routeGoogle(page, drive, config)
  return { context, page }
}

const editorReady = (page) => page.waitForFunction(() => window.__editor?.getSnapshot()?.layout && !window.__editor.getSnapshot().rendering, { timeout: 90000 })
const gateClosed = (page) => page.waitForFunction(() => !document.querySelector('.login-over'), { timeout: 60000 })
const nameOn = (page) => page.evaluate(() => window.__editor.getSnapshot().report.basicInfo.name)
const setInfo = (page, patch) => page.evaluate((patch) => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, ...patch } })), patch)
const savedChip = (page) =>
  page.waitForFunction(() => [...document.querySelectorAll('.chip.ok')].some((c) => /ドライブに保存|\d+:\d+/.test(c.textContent)) && !document.querySelector('.chip .dot.busy'), { timeout: 30000 })
const clickText = (page, selector, text) => page.evaluate((selector, text) => [...document.querySelectorAll(selector)].find((b) => b.textContent.includes(text)).click(), selector, text)
/** 指差し確認（mockups/v27）が出るのを待つ（出たら true） */
const tourAppears = (page, timeout = 15000) => page.waitForSelector('.tour .tour-tip', { timeout }).then(() => true, () => false)
/** 指差し確認を「とばす」 */
const skipTour = async (page) => {
  await page.click('.tour-acts .skip')
  await page.waitForFunction(() => !document.querySelector('.tour'), { timeout: 10000 })
}
const TOKEN_KEY = 'sotsugyo-seisaku-report-drive-token'
/** このタブの許可を、あと5分で切れることにして、読み込み直す（ログインし直さずに、その許可で続ける） */
const nearExpiry = async (page) => {
  await page.evaluate((key) => {
    const token = JSON.parse(sessionStorage.getItem(key))
    sessionStorage.setItem(key, JSON.stringify({ ...token, expiresAt: Date.now() + 5 * 60_000 }))
  }, TOKEN_KEY)
  await page.reload({ waitUntil: 'networkidle0' })
  await editorReady(page)
  await gateClosed(page)
}
/** 本文の最初の段落を、マウスでクリックする（そのページを出してから） */
const clickParagraph = async (page) => {
  const id = await page.evaluate(() => {
    const ed = window.__editor
    const block = ed.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.type === 'paragraph')
    ed.goToPage(ed.pageOfBlock(block.id), 'none')
    return block.id
  })
  await editorReady(page)
  await sleep(300)
  const box = await page.evaluate((id) => {
    const r = [...document.querySelectorAll(`.page-viewport.front [data-block-id="${id}"]`)].find((e) => e.getBoundingClientRect().width > 0).getBoundingClientRect()
    return { x: r.left + Math.min(r.width / 2, 40), y: r.top + r.height / 2 }
  }, id)
  await page.mouse.click(box.x, box.y)
  return id
}
/** PDF の窓の、ドライブの1行の折り返し（行の数と、最後の行の文字） */
const lastLine = (page) =>
  page.evaluate(() => {
    const text = document.querySelector('.modal .pdf-drive > span')
    if (!text) return { lines: 0, last: '' }
    // 1字ずつ、どの行にあるか（前の字より 8px 以上下なら、次の行）
    const lines = []
    let top = -Infinity
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      for (let i = 0; i < node.data.length; i++) {
        const range = document.createRange()
        range.setStart(node, i)
        range.setEnd(node, i + 1)
        const y = range.getBoundingClientRect().top
        if (y > top + 8) {
          lines.push('')
          top = y
        }
        lines[lines.length - 1] += node.data[i]
      }
    }
    return { lines: lines.length, last: lines.at(-1) ?? '', all: lines }
  })
const reloginOpen = (page) => page.evaluate(() => [...document.querySelectorAll('.modal h2')].some((h) => h.textContent.includes('もう一度ログイン')))
const snapshotsOf = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('sotsugyo-seisaku-report')
        open.onsuccess = () => {
          const get = open.result.transaction('snapshots', 'readonly').objectStore('snapshots').getAll()
          get.onsuccess = () => resolve(get.result.map((s) => s.report.basicInfo.subtitleInput))
        }
      }),
  )
const localReport = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('sotsugyo-seisaku-report')
        open.onsuccess = () => {
          const get = open.result.transaction('report', 'readonly').objectStore('report').get('current')
          get.onsuccess = () => resolve(get.result ?? null)
        }
      }),
  )

await withEdge(async (browser) => {
  const drive = fakeDrive()

  // ---- パソコン：はじめて開く ----
  const pc = await device(browser, drive)
  await pc.page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
  await pc.page.waitForSelector('.login-over .login-btn')
  check('開くと、ログインの窓が出る（ログインするまで書けない）', (await pc.page.$eval('.login-over', (e) => e.textContent)).includes('大学のアカウントでログイン'))
  await editorReady(pc.page)
  await pc.page.click('.login-btn')
  await gateClosed(pc.page)
  check('ログインすると窓が消え、はじめての人にはコースを選ぶ案内が出る', !!(await pc.page.$('.guide .g-opts button')))
  await clickText(pc.page, '.guide .g-opts button', 'コース')
  await editorReady(pc.page)
  // 今年度だけ：「Word で書き始めていますか？」には「いいえ」（mockups/v24）
  await pc.page.waitForSelector('.guide.step-word .g-word-opt.no')
  await pc.page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await pc.page.waitForSelector('.guide .g-tip h2')
  check(
    '学生のアカウントなら、表紙の学籍番号にメールアドレスの学籍番号（大文字）が入り、案内は氏名から',
    (await pc.page.evaluate(() => window.__editor.getSnapshot().report.basicInfo.studentId)) === '00ZZ901' && (await pc.page.$eval('.guide .g-tip h2', (e) => e.textContent)).includes('氏名'),
  )
  check('学生のアカウントでは、教職員の表示は出ない', !(await pc.page.$('.staff-note')))
  await clickText(pc.page, '.guide button', 'あとで入力する')
  await setInfo(pc.page, { name: '文化　花子' })
  await savedChip(pc.page)
  check('書いた内容が、数秒後にドライブにも保存される', drive.report()?.report.basicInfo.name === '文化　花子')
  const folders = [...drive.files.values()].filter((f) => f.mimeType === 'application/vnd.google-apps.folder').map((f) => f.name)
  check('ドライブには「卒業制作報告書」フォルダと「写真」フォルダができる', folders.join(',') === '卒業制作報告書,写真', folders.join(','))
  await pc.page.screenshot({ path: 'poc-output/e2e/drive-saved.png' })

  // 読み込み直しても、このタブでログイン済みなら、ボタンを押さずに続けられる
  // （下の指差し確認は「次に開いたとき」に出るので、このタブで開いた印だけを消して、開き直したのと同じにする。tourMemory.ts の firstOpenInTab）
  await pc.page.evaluate(() => sessionStorage.removeItem('sotsugyo-seisaku-report-opened'))
  await pc.page.reload({ waitUntil: 'networkidle0' })
  await editorReady(pc.page)
  await gateClosed(pc.page)
  check('読み込み直しても、このタブではログインし直さずに続けられる', (await pc.page.evaluate(() => window.__logins ?? 0)) === 0 && (await nameOn(pc.page)) === '文化　花子')
  // 案内を終えずに閉じた（指差し確認を見ていない）学生は、次に開いたとき（ログインのあと）に、指差し確認が1回出る
  check('指差し確認を見ていなければ、次に開いたとき（ログインのあと）に指差し確認が出る', await tourAppears(pc.page))
  await skipTour(pc.page)
  check('「とばす」で閉じ、この端末に覚える', (await pc.page.evaluate(() => localStorage.getItem('sotsugyo-seisaku-report-tour'))) === 'done')

  // ---- PDF を書き出すと、同じ PDF の控えを先生のフォルダ（学科の Apps Script の窓口）に送る。学生の画面には出さない ----
  // ---- 同じ PDF を、自分のドライブの「卒業制作報告書」フォルダにも置き、PDF の窓に1行で知らせる（1366×768 の画面で） ----
  {
    // 保存（ダウンロード）は、ここでは確かめないので止めておく（ほかの場所にファイルを作らない）
    await (await pc.page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'deny', browserContextId: pc.context.id })
    await pc.page.setViewport({ width: 1366, height: 768 })
    const before = drive.pdfCopies.length
    const title = await pc.page.evaluate(() => window.__editor.pdfTitle)
    // ドライブに置くのを少し遅くして、「置いています…」を見る
    drive.uploadDelay = 2000
    await pc.page.click('.side .export')
    await pc.page.waitForSelector('.modal .pdf-start')
    await pc.page.click('.modal .pdf-start')
    await pc.page.waitForSelector('.modal .pdf-open', { timeout: 120000 })
    // 保存の画面が開いた（窓のフォーカスが外れた）ことにする →「保存しました」
    const waitingLine = await pc.page.evaluate(() => !!document.querySelector('.modal .pdf-drive'))
    await pc.page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await pc.page.waitForFunction(() => document.querySelector('.modal h2')?.textContent === '保存しました', { timeout: 10000 })
    const sendingLine = await pc.page.evaluate(() => document.querySelector('.modal .pdf-drive.sending')?.textContent ?? '')
    await pc.page.waitForSelector('.modal .pdf-drive.done', { timeout: 30000 }).catch(() => {})
    drive.uploadDelay = 0
    const doneLine = await pc.page.evaluate(() => document.querySelector('.modal .pdf-drive.done')?.textContent ?? '')
    const doneWrap = await lastLine(pc.page)
    const sent = await until(() => drive.pdfCopies.length > before, 30000)
    await sleep(1000)
    const copy = drive.pdfCopies.at(-1) ?? {}
    const expected = await pc.page.evaluate((key) => {
      const { report } = window.__editor.getSnapshot()
      return { token: JSON.parse(sessionStorage.getItem(key)).accessToken, year: report.fiscalYear, courseId: report.basicInfo.courseId }
    }, TOKEN_KEY)
    const shown = await pc.page.evaluate(() => document.querySelector('.modal')?.textContent ?? '')
    await pc.page.screenshot({ path: 'poc-output/e2e/drive-pdf-copy.png' })
    check(
      'PDF を書き出すと、同じ PDF の控えを1つだけ、学科の窓口に送る（いまのログインの許可・年度・コース・表紙の学籍番号と氏名・PDF。JSON を text/plain で、cookie なし）',
      sent &&
        drive.pdfCopies.length === before + 1 &&
        /^https:\/\/script\.google\.com\/macros\//.test(copy.url) &&
        JSON.stringify(copy.data) === JSON.stringify({ action: 'pdfCopy', token: expected.token, year: expected.year, courseId: expected.courseId, studentId: '00ZZ901', name: '文化　花子' }) &&
        copy.pdfHead.startsWith('%PDF-') &&
        copy.pdfBytes > 10000 &&
        copy.contentType.startsWith('text/plain') &&
        !copy.cookie,
      JSON.stringify({ ...copy, data: { ...copy.data, token: copy.data?.token === expected.token ? '（いまの許可）' : copy.data?.token } }),
    )
    check('控えを送ったことは、学生の画面（PDF の窓）には出さない', !/控え|先生のフォルダ/.test(shown), shown)
    const own = drive.pdfs()
    check(
      '同じ PDF（作り直さない）を、自分のドライブの「卒業制作報告書」フォルダにも1つ置く（提出用の名前・印 kind: pdf）',
      own.length === 1 && own[0].name === `${title}.pdf` && title === '00ZZ901_文化花子' && own[0].folder === '卒業制作報告書' && own[0].appProperties?.kind === 'pdf' && own[0].head === '%PDF-' && own[0].bytes === copy.pdfBytes,
      JSON.stringify({ own, teacherCopyBytes: copy.pdfBytes }),
    )
    check(
      'PDF の窓（保存しました）の「開いて、ページの数と写真を確かめてください。」の下に、置いている間は「…置いています…」、置けたら「…置きました」と1行で出す（保存の画面を待つ間は出さない）',
      !waitingLine && sendingLine === 'ドライブの「卒業制作報告書」フォルダにも置いています…' && doneLine === 'ドライブの「卒業制作報告書」フォルダにも置きました' && shown.includes('確かめてください。ドライブの'),
      JSON.stringify({ waitingLine, sendingLine, doneLine }),
    )
    check('1366×768 の画面では、ドライブの1行は折り返さない（1字だけ次の行に残らない）', doneWrap.lines === 1, JSON.stringify(doneWrap))
    await pc.page.click('.modal .close')

    // 氏名を直して、もう一度書き出す：同じファイルの中身を新しくし、名前も今の名前にする（2つめのファイルは作らない）
    await setInfo(pc.page, { name: '文化　花子子' })
    await pc.page.click('.side .export')
    await pc.page.waitForSelector('.modal .pdf-start')
    await pc.page.click('.modal .pdf-start')
    await pc.page.waitForSelector('.modal .pdf-open', { timeout: 120000 })
    await pc.page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await pc.page.waitForSelector('.modal .pdf-drive.done', { timeout: 30000 }).catch(() => {})
    const again = drive.pdfs()
    check(
      'もう一度書き出すと、自分のドライブの同じファイルを新しくし、名前も今の提出用の名前にする（2つめのファイルは作らない。前の版はドライブに残る）',
      again.length === 1 && again[0].id === own[0]?.id && again[0].name === '00ZZ901_文化花子子.pdf' && again[0].modifiedTime !== own[0]?.modifiedTime,
      JSON.stringify(again),
    )
    await pc.page.click('.modal .close')
    await setInfo(pc.page, { name: '文化　花子' })
    await until(() => drive.report()?.report.basicInfo.name === '文化　花子')
    await savedChip(pc.page)
    await pc.page.setViewport({ width: 1440, height: 900 })
  }

  // ---- スマホ：別の端末でログインすると、ドライブの原稿が開く ----
  const phone = await device(browser, drive, { phone: true })
  await phone.page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
  await editorReady(phone.page)
  await phone.page.click('.login-btn')
  await gateClosed(phone.page)
  await editorReady(phone.page)
  check('別の端末でログインすると、ドライブの原稿が開く（コースの案内は出ない）', (await nameOn(phone.page)) === '文化　花子' && !(await phone.page.$('.guide')))
  // 指差し確認は端末ごとに覚えるので、別の端末では、その端末で1回出る
  check('別の端末では、その端末で指差し確認が1回出る（端末ごとに覚える）', await tourAppears(phone.page))
  await skipTour(phone.page)
  await setInfo(phone.page, { name: '文化　次郎' })
  check('スマホで書いた内容も、ドライブに保存される', await until(() => drive.report()?.report.basicInfo.name === '文化　次郎'))
  await savedChip(phone.page)
  await phone.page.click('.p-top .icon-btn')
  await phone.page.waitForSelector('.sheet .drive-pop')
  check('スマホでは、メニューの中にドライブの操作がある', (await phone.page.$eval('.sheet .drive-pop', (e) => e.textContent)).includes('この端末から原稿を消す'))
  await phone.page.screenshot({ path: 'poc-output/e2e/drive-phone-menu.png' })
  await phone.page.click('.sheet-close')

  // ---- パソコンに戻って書くと：別の端末が後から保存していたので、どちらで続けるかを聞く ----
  await setInfo(pc.page, { subtitleInput: 'パソコンで書いた' })
  await pc.page.waitForSelector('.drive-two', { timeout: 30000 })
  check('別の端末が後から保存していたら、上書きせずに、どちらで続けるかを聞く', drive.report()?.report.basicInfo.name === '文化　次郎')
  await pc.page.screenshot({ path: 'poc-output/e2e/drive-conflict.png' })
  await clickText(pc.page, '.modal button', 'ドライブの原稿を開く')
  await pc.page.waitForFunction(() => !document.querySelector('.drive-two'), { timeout: 30000 })
  await editorReady(pc.page)
  check('ドライブの原稿を選ぶと、別の端末で書いた内容になる', (await nameOn(pc.page)) === '文化　次郎')
  check('選ばなかった原稿は、自動の控えに残る', (await snapshotsOf(pc.page)).includes('パソコンで書いた'))

  // ---- 1時間たって許可が切れたとき ----
  drive.failNext = 401
  await setInfo(pc.page, { subtitleInput: '許可が切れたあと' })
  await pc.page.waitForFunction(() => [...document.querySelectorAll('.modal h2')].some((h) => h.textContent.includes('もう一度ログイン')), { timeout: 30000 })
  check('Google の許可が切れたら、もう一度ログインする窓が出る', true)
  check('ログインし直すまでも、この端末には保存している', (await localReport(pc.page))?.basicInfo.subtitleInput === '許可が切れたあと')
  // 「あとで」を選ぶと窓は閉じ、右の欄の赤い表示から、いつでもログインし直せる
  await clickText(pc.page, '.modal button', 'あとで')
  await pc.page.waitForFunction(() => ![...document.querySelectorAll('.modal h2')].some((h) => h.textContent.includes('もう一度ログイン')), { timeout: 30000 })
  check('「あとで」で窓が閉じ、右の欄に「ログインし直す」が赤く残る', (await pc.page.$eval('.drive-chip-wrap .chip', (e) => e.className + e.textContent)).includes('ng'))
  await pc.page.click('.drive-chip-wrap .chip')
  await clickText(pc.page, '.drive-pop button', 'ログインし直す')
  await savedChip(pc.page)
  check('ログインし直すと、ドライブへの保存が続く', drive.report()?.report.basicInfo.subtitleInput === '許可が切れたあと')

  // ---- 別のアカウントでログインしたとき（共用のパソコン） ----
  drive.email = 'other@bunka-wu.ac.jp'
  await pc.page.evaluate(() => sessionStorage.clear())
  await pc.page.reload({ waitUntil: 'networkidle0' })
  await editorReady(pc.page)
  // ログインの窓：後ろの原稿は見せず、前回のアカウントは一部を伏せて出し、「別のアカウントでログイン」も置く（mockups/v23 ② 案A）
  const gateInfo = await pc.page.evaluate(() => ({
    account: document.querySelector('.login-acct .who b')?.textContent ?? '',
    other: !!document.querySelector('.login-other'),
    background: getComputedStyle(document.querySelector('.login-over')).backgroundColor,
  }))
  check('ログインの窓は後ろの原稿を見せず、前回のアカウントを一部伏せて出し、「別のアカウントでログイン」も置く', gateInfo.account === '00zz9**@bunka-wu.ac.jp' && gateInfo.other && !/rgba(.*, 0.d+)/.test(gateInfo.background), JSON.stringify(gateInfo))
  await pc.page.screenshot({ path: 'poc-output/e2e/drive-gate-previous.png' })
  await pc.page.click('.login-other')
  await pc.page.waitForFunction(() => [...document.querySelectorAll('.modal h2')].some((h) => h.textContent.includes('別のアカウント')), { timeout: 30000 })
  check('この端末に別のアカウントの原稿があるときは、知らせる（前のアカウントは一部を伏せる）', (await pc.page.$eval('.modal .lead', (e) => e.textContent)).includes('00zz9**@bunka-wu.ac.jp'))
  drive.email = '00zz901@bunka-wu.ac.jp'
  await clickText(pc.page, '.modal button', '前のアカウントでログインし直す')
  await pc.page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {})
  await editorReady(pc.page)
  await pc.page.click('.login-btn')
  await gateClosed(pc.page)
  check('前のアカウントでログインし直すと、続きを書ける', (await nameOn(pc.page)) === '文化　次郎')
  check('一度とばした指差し確認は、この端末では次に開いても出ない', !(await tourAppears(pc.page, 2500)))

  // ---- 共用のパソコンで書き終えたとき：この端末から原稿を消す ----
  await pc.page.click('.drive-chip-wrap .chip')
  await clickText(pc.page, '.drive-pop button', 'この端末から原稿を消す')
  await pc.page.waitForSelector('.modal .primary')
  await Promise.all([pc.page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 }), clickText(pc.page, '.modal button', 'この端末から消す')])
  await pc.page.waitForSelector('.login-over .login-btn')
  check('「この端末から原稿を消す」で、この端末の原稿が消え、ログインの窓に戻る', (await localReport(pc.page)) === null && (await snapshotsOf(pc.page)).length === 0)
  check('この端末から消しても、ドライブの原稿は残る', drive.report()?.report.basicInfo.name === '文化　次郎')

  // ---- 先生（学籍番号の形でないアドレス）は、試しに使える ----
  drive.email = 'staff-a@bunka-wu.ac.jp'
  const staff = await device(browser, drive)
  await staff.page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
  await editorReady(staff.page)
  await staff.page.click('.login-btn')
  await gateClosed(staff.page)
  const staffInfo = await staff.page.evaluate(() => ({ note: document.querySelector('.staff-note')?.textContent ?? '', meta: document.querySelector('.side .meta')?.textContent ?? '', modal: document.querySelector('.modal h2')?.textContent ?? '' }))
  check('先生のアカウントでも使え、右の欄に「教職員のアカウントで試しています」と出る', staffInfo.note.includes('教職員'), JSON.stringify(staffInfo))
  await staff.context.close()
  drive.email = '00zz901@bunka-wu.ac.jp'

  // ---- 管理ページでドライブ保存を止めているとき（Google の障害など。mockups/v22 ②） ----
  config.driveSave = 'off'
  const stopped = await device(browser, drive)
  await stopped.page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
  await editorReady(stopped.page)
  await stopped.page.waitForSelector('.drive-stopped', { timeout: 30000 })
  const stoppedInfo = await stopped.page.evaluate(() => ({ gate: !!document.querySelector('.login-over'), guide: !!document.querySelector('.guide .g-opts button'), chip: !!document.querySelector('.drive-chip-wrap') }))
  check('ドライブ保存を止めていると、ログインせずに書け、右の欄に「この端末にだけ保存」と出る', !stoppedInfo.gate && stoppedInfo.guide && !stoppedInfo.chip, JSON.stringify(stoppedInfo))
  await stopped.page.screenshot({ path: 'poc-output/e2e/drive-stopped.png' })
  // 止めているあいだに、別の学生（00ZZ555）がこの端末で書いた。再開したあと、この端末で 00zz901 の学生がログインする（mockups/v23 ③）
  await setInfo(stopped.page, { studentId: '00ZZ555', name: '前野　学生', subtitleInput: '前の人の原稿' })
  await new Promise((r) => setTimeout(r, 1500))
  delete config.driveSave
  await stopped.page.reload({ waitUntil: 'networkidle0' })
  await editorReady(stopped.page)
  await stopped.page.click('.login-btn')
  await stopped.page.waitForFunction(() => [...document.querySelectorAll('.modal h2')].some((h) => h.textContent.includes('学籍番号')), { timeout: 30000 })
  const mismatch = await stopped.page.evaluate(() => ({ text: document.querySelector('.modal .id-compare')?.textContent ?? '', gate: !!document.querySelector('.login-over'), tour: !!document.querySelector('.tour') }))
  check('表紙の学籍番号がログインしたアカウントと違うと、ドライブに送る前に知らせる（後ろの原稿は見せないまま。指差し確認も出さない）', mismatch.text.includes('00ZZ555') && mismatch.gate && !mismatch.tour && drive.report()?.report.basicInfo.name === '文化　次郎', JSON.stringify(mismatch))
  await stopped.page.screenshot({ path: 'poc-output/e2e/drive-id-mismatch.png' })
  await clickText(stopped.page, '.modal button', '自分の原稿ではない')
  await gateClosed(stopped.page)
  await editorReady(stopped.page)
  check('「自分の原稿ではない」を選ぶと、その原稿は自分のドライブに送らず（この端末の控えに残す）、自分の原稿で続ける', drive.report()?.report.basicInfo.name === '文化　次郎' && (await nameOn(stopped.page)) === '文化　次郎' && (await snapshotsOf(stopped.page)).includes('前の人の原稿'))
  await stopped.context.close()

  // ---- インターネットにつながっていないとき ----
  // パソコンのタブに戻る（後ろのタブのままだと、画面の更新が止まることがある）
  await pc.page.bringToFront()
  await pc.page.setOfflineMode(true)
  await pc.page.waitForFunction(() => document.querySelector('.login-btn')?.disabled && document.querySelector('.login-warn'), { timeout: 10000 })
  check('インターネットにつながっていないと、ログインのボタンが押せない（書けない）', true)
  await pc.page.screenshot({ path: 'poc-output/e2e/drive-offline.png' })
  await pc.page.setOfflineMode(false)

  // ---- パソコン：許可が切れる少し前にクリックすると、そのときに許可を延ばす（「もう一度ログイン」を出さない） ----
  const renew = await device(browser, drive)
  await renew.page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
  await editorReady(renew.page)
  await renew.page.click('.login-btn')
  await gateClosed(renew.page)
  await editorReady(renew.page)
  if (await tourAppears(renew.page)) await skipTour(renew.page)
  await nearExpiry(renew.page)
  // キーで押したときは延ばさない（書いている途中に Google の窓が出ないように）
  // 「？ 使い方」は右の欄の「メニュー」の中（mockups/v37 案C）：Enter で開くと「使い方」に移るので、もう一度 Enter
  await renew.page.focus('.side .menu-btn')
  await renew.page.keyboard.press('Enter')
  await renew.page.waitForSelector('.side .head-menu', { timeout: 10000 }).catch(() => {})
  await renew.page.keyboard.press('Enter')
  await renew.page.waitForSelector('.help-top', { timeout: 10000 }).catch(() => {})
  await sleep(500)
  const byKey = await renew.page.evaluate(() => ({ opened: (window.__loginOptions ?? []).length, help: !!document.querySelector('.help-top') }))
  await renew.page.evaluate(() => document.querySelector('.help-close').click())
  await renew.page.waitForFunction(() => !document.querySelector('.help-top'), { timeout: 10000 })
  check('キー（Enter）でボタンを押したときは、残りが少なくても延ばさない', byKey.opened === 0 && byKey.help, JSON.stringify(byKey))
  const blockId = await clickParagraph(renew.page)
  await until(() => renew.page.evaluate(() => (window.__loginOptions ?? []).length > 0), 5000)
  await sleep(500)
  const renewed = await renew.page.evaluate(
    (key) => {
      const a = document.activeElement
      return {
        options: window.__loginOptions ?? [],
        left: Math.round((JSON.parse(sessionStorage.getItem(key)).expiresAt - Date.now()) / 60_000),
        editing: window.__editor.getSnapshot().editingId,
        typing: !!a && (a.isContentEditable || a.tagName === 'TEXTAREA' || a.tagName === 'INPUT'),
      }
    },
    TOKEN_KEY,
  )
  check(
    'パソコン：許可の残りが10分を切ってから紙面をクリックすると、同じアカウントで許可を延ばす（窓が一瞬出て閉じるだけの指定）。クリックした段落はそのまま書ける',
    renewed.options.length === 1 && renewed.options[0].prompt === '' && renewed.options[0].hint === '00zz901@bunka-wu.ac.jp' && renewed.left >= 55 && renewed.editing === blockId && renewed.typing,
    JSON.stringify(renewed),
  )
  await renew.page.keyboard.type('延ばしたあと')
  await renew.page.evaluate(() => window.__editor.commitEditing())
  check('延ばしたあとも「もう一度ログイン」の窓は出ず、ドライブへの保存が続く', await until(() => JSON.stringify(drive.report()?.report.body ?? '').includes('延ばしたあと')) && !(await reloginOpen(renew.page)))
  // 残りが十分あれば、クリックしても延ばさない
  await clickParagraph(renew.page)
  await sleep(800)
  check('残りが十分あるときは、クリックしても Google の窓を開かない', (await renew.page.evaluate(() => (window.__loginOptions ?? []).length)) === 1)
  await renew.context.close()

  // ---- スマホでは、クリックで許可を延ばさない（Google の窓がタブの切り替えになるため。切れたら、今まで通り「もう一度ログイン」） ----
  const android = await device(browser, drive, { phone: true })
  await android.page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36')
  await android.page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
  await editorReady(android.page)
  await android.page.click('.login-btn')
  await gateClosed(android.page)
  await editorReady(android.page)
  if (await tourAppears(android.page)) await skipTour(android.page)
  await nearExpiry(android.page)
  await clickParagraph(android.page)
  await sleep(1000)
  const phoneRenew = await android.page.evaluate((key) => ({ opened: (window.__loginOptions ?? []).length, left: Math.round((JSON.parse(sessionStorage.getItem(key)).expiresAt - Date.now()) / 60_000) }), TOKEN_KEY)
  check('スマホ（Android）では、許可の残りが少なくても、クリックで Google の窓を開かない', phoneRenew.opened === 0 && phoneRenew.left <= 5 && !(await reloginOpen(android.page)), JSON.stringify(phoneRenew))
  await android.context.close()

  // ---- パソコン：PDF を書き出すときに許可が切れていたら、「PDF を保存する」を押したときに延ばし、延ばした許可で控えを送る ----
  {
    const late = await device(browser, drive)
    // はじめのログインだけ、許可を短く（70秒。切れる1分前から切れたものとして扱うので、使えるのは10秒ほど）
    await late.page.evaluateOnNewDocument(() => {
      window.__fakeExpiresIn = 70
      try {
        localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
      } catch {}
    })
    await (await late.page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'deny', browserContextId: late.context.id })
    await late.page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
    await editorReady(late.page)
    await late.page.click('.login-btn')
    await gateClosed(late.page)
    await editorReady(late.page)
    await late.page.evaluate(() => (window.__fakeExpiresIn = 3600))
    // 許可が切れるまで待つ（書いていないので、まだ「もう一度ログイン」は出ない）
    await until(() => late.page.evaluate((key) => JSON.parse(sessionStorage.getItem(key)).expiresAt - 60_000 < Date.now(), TOKEN_KEY), 30000)
    const loginsBefore = await late.page.evaluate(() => (window.__loginOptions ?? []).length)
    const before = drive.pdfCopies.length
    const ownBefore = drive.pdfs()
    await late.page.click('.side .export')
    await late.page.waitForSelector('.modal .pdf-start')
    await late.page.click('.modal .pdf-start')
    await late.page.waitForSelector('.modal .pdf-open', { timeout: 120000 })
    const sent = await until(() => drive.pdfCopies.length > before, 30000)
    const after = await late.page.evaluate((key) => ({ options: (window.__loginOptions ?? []).slice(-1)[0], logins: (window.__loginOptions ?? []).length, token: JSON.parse(sessionStorage.getItem(key)).accessToken }), TOKEN_KEY)
    const copy = drive.pdfCopies.at(-1)
    check(
      'パソコン：書き出すときに許可が切れていたら、「PDF を保存する」を押したときに同じアカウントで延ばし（窓が一瞬出て閉じるだけ）、延ばした許可で控えを送る（「もう一度ログイン」は出さない）',
      sent && after.logins === loginsBefore + 1 && after.options?.prompt === '' && after.options?.hint === '00zz901@bunka-wu.ac.jp' && copy?.data?.token === after.token && !(await reloginOpen(late.page)),
      JSON.stringify({ ...after, token: undefined, sent, copyToken: copy?.data?.token === after.token }),
    )
    // 延ばした許可で、自分のドライブの PDF も新しくする（同じファイル。今の原稿の提出用の名前）
    const lateTitle = await late.page.evaluate(() => window.__editor.pdfTitle)
    const ownPlaced = await until(() => drive.pdfs()[0]?.modifiedTime !== ownBefore[0]?.modifiedTime, 30000)
    const ownAfter = drive.pdfs()
    check(
      'パソコン：書き出すときに許可が切れていても、延ばした許可で、自分のドライブの PDF も新しくする（同じファイルのまま）',
      ownPlaced && ownAfter.length === 1 && ownAfter[0].id === ownBefore[0]?.id && ownAfter[0].name === `${lateTitle}.pdf`,
      JSON.stringify({ ownBefore, ownAfter, lateTitle }),
    )
    await late.context.close()
  }

  // ---- この端末だけに保存するとき（?nodrive）は、PDF を書き出しても控えを送らない ----
  {
    const local = await device(browser, drive)
    await local.page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
      } catch {}
    })
    await (await local.page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'deny', browserContextId: local.context.id })
    await local.page.goto('http://localhost:5173/?nodrive', { waitUntil: 'networkidle0' })
    await editorReady(local.page)
    await local.page.waitForSelector('.guide.step-course .g-opts button')
    await local.page.evaluate(() => document.querySelector('.g-opts button').click())
    await local.page.waitForSelector('.guide.step-word .g-word-opt.no')
    await local.page.evaluate(() => document.querySelector('.g-word-opt.no').click())
    await local.page.waitForSelector('.g-later')
    await local.page.evaluate(() => document.querySelector('.g-later').click())
    await editorReady(local.page)
    const before = drive.pdfCopies.length
    const ownBefore = JSON.stringify(drive.pdfs())
    await local.page.click('.side .export')
    await local.page.waitForSelector('.modal .pdf-start')
    await local.page.click('.modal .pdf-start')
    await local.page.waitForSelector('.modal .pdf-open', { timeout: 120000 })
    await local.page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await local.page.waitForFunction(() => document.querySelector('.modal h2')?.textContent === '保存しました', { timeout: 10000 })
    await sleep(3000)
    check('この端末だけに保存するとき（?nodrive）は、PDF を書き出しても控えを送らない', drive.pdfCopies.length === before, `${drive.pdfCopies.length - before}件`)
    const localLine = await local.page.evaluate(() => document.querySelector('.modal .pdf-drive')?.textContent ?? '')
    check('この端末だけに保存するとき（?nodrive）は、ドライブに PDF を置かず、PDF の窓にもドライブの1行を出さない', !localLine && JSON.stringify(drive.pdfs()) === ownBefore, localLine)
    await local.context.close()
  }

  // ---- 管理ページでドライブ保存を止めているときも、ドライブに PDF を置かず、1行も出さない ----
  {
    config.driveSave = 'off'
    const off = await device(browser, drive)
    await off.page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
      } catch {}
    })
    await (await off.page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'deny', browserContextId: off.context.id })
    await off.page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
    await editorReady(off.page)
    await off.page.waitForSelector('.drive-stopped', { timeout: 30000 })
    await off.page.waitForSelector('.guide.step-course .g-opts button')
    await off.page.evaluate(() => document.querySelector('.g-opts button').click())
    await off.page.waitForSelector('.guide.step-word .g-word-opt.no')
    await off.page.evaluate(() => document.querySelector('.g-word-opt.no').click())
    await off.page.waitForSelector('.g-later')
    await off.page.evaluate(() => document.querySelector('.g-later').click())
    await editorReady(off.page)
    const ownBefore = JSON.stringify(drive.pdfs())
    await off.page.click('.side .export')
    await off.page.waitForSelector('.modal .pdf-start')
    await off.page.click('.modal .pdf-start')
    await off.page.waitForSelector('.modal .pdf-open', { timeout: 120000 })
    await off.page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await off.page.waitForFunction(() => document.querySelector('.modal h2')?.textContent === '保存しました', { timeout: 10000 })
    await sleep(3000)
    const offLine = await off.page.evaluate(() => document.querySelector('.modal .pdf-drive')?.textContent ?? '')
    check('管理ページでドライブ保存を止めているときは、ドライブに PDF を置かず、PDF の窓にもドライブの1行を出さない', !offLine && JSON.stringify(drive.pdfs()) === ownBefore, offLine)
    await off.context.close()
    delete config.driveSave
  }

  // ---- iPhone（共有の画面から保存する）：できた窓（PDF ができました）にも、ドライブの1行を出す。390px の画面で1字だけ次の行に残らない ----
  {
    const iphone = await device(browser, drive, { phone: true })
    await iphone.page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
    await iphone.page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
      } catch {}
    })
    await iphone.page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
    await editorReady(iphone.page)
    await iphone.page.click('.login-btn')
    await gateClosed(iphone.page)
    await editorReady(iphone.page)
    const ownBefore = drive.pdfs()
    const title = await iphone.page.evaluate(() => window.__editor.pdfTitle)
    await iphone.page.evaluate(() => document.querySelector('.p-nav .nav-pdf').click())
    await iphone.page.waitForSelector('.modal .pdf-start')
    await iphone.page.evaluate(() => document.querySelector('.modal .pdf-start').click())
    await iphone.page.waitForSelector('.modal .pdf-save', { timeout: 120000 })
    await iphone.page.waitForSelector('.modal .pdf-drive.done', { timeout: 30000 }).catch(() => {})
    const shareInfo = await iphone.page.evaluate(() => ({
      title: document.querySelector('.modal h2')?.textContent,
      line: document.querySelector('.modal .pdf-drive.done')?.textContent ?? '',
      // 「「保存する」を押して…」のすぐ下
      after: document.querySelector('.modal .lead')?.nextElementSibling?.classList.contains('pdf-drive'),
    }))
    const wrap = await lastLine(iphone.page)
    const ownAfter = drive.pdfs()
    await iphone.page.screenshot({ path: 'poc-output/e2e/drive-pdf-iphone.png' })
    check(
      'iPhone：できた窓（PDF ができました）にも「ドライブの「卒業制作報告書」フォルダにも置きました」を出し、自分のドライブの同じファイルを新しくする',
      shareInfo.title === 'PDF ができました' && shareInfo.line === 'ドライブの「卒業制作報告書」フォルダにも置きました' && shareInfo.after && ownAfter.length === 1 && ownAfter[0].id === ownBefore[0]?.id && ownAfter[0].name === `${title}.pdf`,
      JSON.stringify({ shareInfo, ownAfter }),
    )
    check('390px の画面では、ドライブの1行は言葉の切れ目で折り返し、1字だけ次の行に残らない', wrap.lines <= 2 && wrap.last.length >= 2, JSON.stringify(wrap))
    await iphone.context.close()
  }

  await phone.context.close()
  await pc.context.close()
})

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 件 合格`)
process.exitCode = failed.length ? 1 : 0
