// スマホ版の動作確認（Edge をスマホの画面の大きさ・タッチ操作にして動かす）。
// 使い方: node scripts/e2e/phone.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { existsSync, mkdirSync } from 'node:fs'
import { withEdge } from '../poc/edge.mjs'
import { stubConfig } from './configStub.mjs'

// 開発サーバーの場所（ふだんは http://localhost:5173。APP_URL で変えられる）
const APP = process.env.APP_URL ?? 'http://localhost:5173'
/** 確かめている途中に src/ が直されても、画面が入れ替わらないようにする（smoke.mjs と同じ） */
const noHotReload = (page) =>
  page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
  })
const OUT = 'poc-output/e2e-phone'
mkdirSync(OUT, { recursive: true })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

await withEdge(async (browser) => {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await noHotReload(page)
  await stubConfig(page)
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36')
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => new Promise((r) => { const req = indexedDB.deleteDatabase('sotsugyo-seisaku-report'); req.onsuccess = req.onerror = req.onblocked = () => r() }))
  await page.reload({ waitUntil: 'networkidle0' })
  const ready = () =>
    page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && s.sheet && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 60000 })
  await ready()
  const snap = () => page.evaluate(() => { const s = window.__editor.getSnapshot(); return { page: s.page, zoomed: s.zoomed, editingId: s.editingId, report: s.report } })
  const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` })

  check('スマホの並べ方になる（右の欄がなく、下にタブがある）', !(await page.$('.side')) && !!(await page.$('.p-nav')) && !!(await page.$('.p-top')))
  const pageWidth = await page.evaluate(() => document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current').getBoundingClientRect().width)
  check('紙面が画面の幅いっぱいに表示される', pageWidth > 330, `${Math.round(pageWidth)}px`)
  await shot('1-cover')

  // はじめての案内：コースを選び、案内に沿って学籍番号を入力する
  check('はじめて開くと、コースを選ぶ案内が出る', !!(await page.$('.guide.step-course .g-opts button')))
  await page.evaluate(() => document.querySelector('.g-opts button').click())
  // 今年度だけ：「Word で書き始めていますか？」（画面の下に出す）。「いいえ」で学籍番号へ
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await wait(300)
  const wordTip = await page.evaluate(() => {
    const r = document.querySelector('.g-tip').getBoundingClientRect()
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: innerHeight, note: document.querySelector('.g-tip .g-note')?.textContent ?? '' }
  })
  check('コースを選ぶと「Word で書き始めていますか？」が画面の下に出る（あとからはメニューから、と書く）', wordTip.top >= 0 && wordTip.bottom <= wordTip.height && wordTip.bottom > wordTip.height / 2 && wordTip.note.includes('メニュー'), JSON.stringify(wordTip))
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.guide.step-studentId')
  await ready()
  const idAt = await page.evaluate(() => {
    const r = document.querySelector('.page-viewport.front [data-block-id="basic:studentId"]').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.touchscreen.tap(idAt.x, idAt.y)
  await wait(300)
  await shot('1a-guide')
  check('案内の欄をタップすると、下の書く欄で入力できる', (await snap()).editingId === 'basic:studentId')
  // 紙面の欄はキーボード（Tab）でも移れるようにしたが、タップでは今までどおり：下の欄で書き、紙面にキーボードの目印（藍の枠）は出さない（mockups/v23 ④）
  const tapFocus = () => page.evaluate(() => ({ inSheet: !!document.activeElement?.closest('.edit-sheet'), ring: !!document.querySelector('.page-viewport.front :focus-visible') }))
  const afterTap = await tapFocus()
  await page.keyboard.type('00ZZ0123')
  await page.click('.edit-sheet .done')
  await page.waitForSelector('.guide.step-name')
  check('学籍番号を書き終えると、氏名の案内に進む', (await snap()).report.basicInfo.studentId === '00ZZ0123')
  const afterDone = await tapFocus()
  check('タップで書くとき・書き終えたとき、紙面にキーボードの目印は出ない', afterTap.inSheet && !afterTap.ring && !afterDone.ring, JSON.stringify({ afterTap, afterDone }))
  await page.click('.g-later')
  await ready()

  // 表紙のコース欄をタップすると、コースの一覧が画面の中（下から）に出る
  const courseAt = await page.evaluate(() => {
    const el = document.querySelector('.page-viewport.front [data-block-id="basic:course"]')
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.touchscreen.tap(courseAt.x, courseAt.y)
  await page.waitForSelector('.popover.course-menu')
  await wait(300)
  await shot('1b-course')
  const menu = await page.evaluate(() => {
    const r = document.querySelector('.popover.course-menu').getBoundingClientRect()
    const cut = [...document.querySelectorAll('.popover.course-menu button')].some((b) => b.scrollWidth > b.clientWidth + 1)
    return { left: Math.round(r.left), right: Math.round(r.right), width: innerWidth, cut }
  })
  check('コースの一覧が画面からはみ出さず、名前が切れない', menu.left >= 0 && menu.right <= menu.width && !menu.cut, JSON.stringify(menu))
  await page.evaluate(() => document.querySelector('.popover.course-menu button').click())
  await ready()
  check('コースの一覧から選べる', !!(await snap()).report.basicInfo.courseId)


  // 本文の段落をタップすると、下から書く欄が出る
  const pid = await page.evaluate(() => window.__editor.getSnapshot().report.body[0].blocks.find((b) => b.type === 'paragraph').id)
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), pid)
  await ready()
  await shot('2-body')
  const tapAt = await page.evaluate((id) => {
    const el = [...document.querySelectorAll(`.page-viewport.front [data-block-id="${id}"]`)].find((e) => e.getBoundingClientRect().width > 0)
    const r = el.getBoundingClientRect()
    return { x: r.left + 20, y: r.top + r.height / 2 }
  }, pid)
  await page.touchscreen.tap(tapAt.x, tapAt.y)
  await wait(300)
  const sheet = await page.evaluate(() => {
    const ed = document.querySelector('.edit-sheet')
    const input = document.querySelector('.overlay-editor')
    return { open: ed.classList.contains('open') && ed.getBoundingClientRect().height > 0, inSheet: ed.contains(input), focused: document.activeElement === input, fontSize: parseFloat(getComputedStyle(input).fontSize) }
  })
  check('段落をタップすると、下から書く欄が出て、すぐ書ける', sheet.open && sheet.inSheet && sheet.focused, JSON.stringify(sheet))
  check('書く欄の文字は16px（iPhone で勝手に拡大されない大きさ）', sheet.fontSize >= 16, `${sheet.fontSize}px`)
  check('書いている間は紙面を拡大する', (await snap()).zoomed)
  await page.keyboard.type('私は衣装を製作した。')
  await wait(1200)
  await ready()
  await shot('3-editing')
  let s = await snap()
  const text = s.report.body[0].blocks.find((b) => b.id === pid).content.map((n) => n.text ?? '').join('')
  check('書いた文字が原稿に入る', text.includes('私は衣装を製作した。'), text)
  const blockIssue = await page.evaluate(() => document.querySelector('.es-meta .ng')?.textContent ?? '')
  check('書く欄に、その段落の指摘が出る', blockIssue.length > 0, blockIssue)
  await page.click('.edit-sheet .done')
  await ready()
  s = await snap()
  check('「完了」で書く欄が閉じ、紙面の表示が戻る', !s.editingId && !s.zoomed && !(await page.evaluate(() => document.querySelector('.edit-sheet').classList.contains('open'))))

  // 追加：小見出しを足す（段落は、書く欄で改行して分ける）
  await page.click('.p-nav .add')
  await page.waitForSelector('.sheet .add-grid')
  await shot('4-add')
  const before = s.report.body[0].blocks.length
  await page.evaluate(() => [...document.querySelectorAll('.sheet .add-grid .tb')].find((b) => b.textContent.includes('小見出し')).click())
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId, { timeout: 30000 })
  await ready()
  s = await snap()
  check('「追加」から小見出しを足すと、すぐ書ける', s.report.body.flatMap((c) => c.blocks).length > before && !!s.editingId)
  await page.click('.edit-sheet .done')
  await ready()

  // チェック
  await page.click('.p-nav button:nth-child(3)')
  await page.waitForSelector('.sheet .meters')
  await shot('5-check')
  check('「チェック」で、セルフチェックが下から出る', (await page.$$('.sheet .issue')).length > 0)
  await page.click('.sheet-close')

  // ページ一覧
  await page.click('.p-nav button:nth-child(1)')
  await page.waitForSelector('.sheet .thumb-list .t')
  await shot('6-pages')
  await page.evaluate(() => document.querySelectorAll('.sheet .thumb-list .t')[0].click())
  await ready()
  check('「ページ一覧」から選んだページへ移る', (await snap()).page === 0)

  // 書く欄の道具：1段に入りきらないときは2段に折り返し、全部が画面の中に見える（横にずらさないと見えない道具がない。mockups/v23 ⑥）
  const toolsFit = () =>
    page.evaluate(() => {
      const t = document.querySelector('.edit-sheet .es-tools')
      const bs = [...t.querySelectorAll('button')]
      const out = bs.filter((b) => { const r = b.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5 }).map((b) => b.textContent.trim())
      return { n: bs.length, rows: new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top))).size, out, scroll: t.scrollWidth > t.clientWidth + 1 }
    })
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), pid)
  await ready()
  const paraAt = await page.evaluate((id) => {
    const r = [...document.querySelectorAll(`.page-viewport.front [data-block-id="${id}"]`)].find((e) => e.getBoundingClientRect().width > 0).getBoundingClientRect()
    return { x: r.left + 20, y: r.top + r.height / 2 }
  }, pid)
  await page.touchscreen.tap(paraAt.x, paraAt.y)
  await page.waitForFunction(() => document.querySelector('.edit-sheet.open'), { timeout: 20000 })
  let fit = await toolsFit()
  check('段落を書いているとき、書く欄の道具が全部画面の中に見える', fit.out.length === 0 && !fit.scroll && fit.rows <= 2, JSON.stringify(fit))
  // 表を入れて、セルを書く（道具が7つになり、2段に折り返す）
  await page.evaluate(() => [...document.querySelectorAll('.edit-sheet .es-tools button')].find((b) => b.textContent.includes('表を入れる')).click())
  await page.waitForFunction(() => window.__editor.getSnapshot().editingKind === 'tableCaption', { timeout: 30000 })
  await ready()
  await page.keyboard.type('素材')
  const tableId = await page.evaluate(() => window.__editor.tableIdOf(window.__editor.getSnapshot().editingId))
  const cellId = await page.evaluate((tid) => window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === tid).rows[1].cells[0].id, tableId)
  await page.click('.edit-sheet .done')
  await ready()
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), cellId)
  await ready()
  const cellAt = await page.evaluate((id) => {
    const r = document.querySelector(`.page-viewport.front [data-cell-id="${id}"]`).getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, cellId)
  await page.touchscreen.tap(cellAt.x, cellAt.y)
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 20000 }, cellId)
  await wait(300)
  fit = await toolsFit()
  await shot('7-cell-tools')
  check('表のセルを書いているとき、道具（行・列・幅・戻すなど）が2段に折り返して全部見える', fit.n >= 7 && fit.out.length === 0 && !fit.scroll && fit.rows === 2, JSON.stringify(fit))
  await page.click('.edit-sheet .done')
  await ready()

  // 選んだ表を削除すると、画面の下に「表を削除しました［戻す］」が出て、「戻す」で元に戻る（mockups/v23 ⑦ 案A）
  await page.evaluate((id) => window.__editor.select({ kind: 'table', id }), tableId)
  await page.waitForSelector('.sel-bar .tb')
  await page.evaluate(() => [...document.querySelectorAll('.sel-bar .tb')].find((b) => b.textContent.includes('削除')).click())
  await ready()
  const toast = await page.evaluate(() => {
    const area = document.querySelector('.undo-area')
    const b = area?.querySelector('.undo-toast button')
    const r = b?.getBoundingClientRect()
    const a = b && getComputedStyle(b, '::after')
    return { text: area?.textContent ?? '', role: area?.getAttribute('role'), hitH: r ? r.height - parseFloat(a.top) - parseFloat(a.bottom) : 0 }
  })
  const tableGone = !(await snap()).report.body.flatMap((c) => c.blocks).some((b) => b.id === tableId)
  await shot('7b-undo-notice')
  check('選んだ表を削除すると、画面の下に「表を削除しました［戻す］」が出る（読み上げにも伝わる）', tableGone && toast.text.includes('表を削除しました') && toast.role === 'status', JSON.stringify(toast))
  check('知らせの「戻す」は、押せる範囲が高さ 44px 以上', toast.hitH >= 44, `${toast.hitH}px`)
  await page.click('.undo-toast button')
  await ready()
  check('知らせの「戻す」で、削除した表が戻り、知らせが消える', (await snap()).report.body.flatMap((c) => c.blocks).some((b) => b.id === tableId) && !(await page.$('.undo-toast')))

  // 作品写真：入っている写真を押すと「この写真（1枚目）：差し替え／外す」が出て、「外す」で枠を空にできる（mockups/v23 ⑧ 案A）
  await page.evaluate(async () => {
    const c = new OffscreenCanvas(300, 400)
    const g = c.getContext('2d')
    g.fillStyle = '#4a6a8a'
    g.fillRect(0, 0, 300, 400)
    window.__editor.addImages([{ id: 'e2e-photo', blob: await c.convertToBlob({ type: 'image/png' }), widthPx: 300, heightPx: 400 }])
    window.__editor.update((r) => ({ ...r, workPhotos: { layout: 1, columns: 1, imageIds: ['e2e-photo'] } }))
  })
  await ready()
  await page.evaluate(() => window.__editor.goToArea('photos'))
  await ready()
  const photoAt = await page.evaluate(() => {
    const r = document.querySelector('.page-viewport.front [data-photo-slot="0"]').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.touchscreen.tap(photoAt.x, photoAt.y)
  await wait(400)
  const photoBar = await page.evaluate(() => ({ label: document.querySelector('.sel-bar .ctx-label')?.textContent, tools: [...document.querySelectorAll('.sel-bar .tb')].map((b) => b.textContent.trim()) }))
  check('作品写真を押すと、下の道具に「この写真（1枚目）：差し替え／外す」が出る', photoBar.label === 'この写真（1枚目）' && photoBar.tools.join(',') === '差し替え,外す', JSON.stringify(photoBar))
  await page.evaluate(() => [...document.querySelectorAll('.sel-bar .tb')].find((b) => b.textContent.includes('外す')).click())
  await ready()
  s = await snap()
  check('「外す」で枠が空になり、「写真を外しました［戻す］」が出る', s.report.workPhotos.imageIds[0] === '' && (await page.evaluate(() => document.querySelector('.undo-toast')?.textContent ?? '')).includes('写真を外しました'))
  await page.click('.undo-toast button')
  await ready()
  check('知らせの「戻す」で、外した写真が戻る', (await snap()).report.workPhotos.imageIds[0] === 'e2e-photo')
  await page.evaluate(() => window.__editor.goToPage(0, 'none'))
  await ready()

  // 今年度だけ：メニューに「Word で書いた分を読み込む」の小さなリンク
  await page.click('.p-top .icon-btn')
  await page.waitForSelector('.sheet .sheet-body')
  check('メニューに「Word で書いた分を読み込む」のリンクがある', !!(await page.$('.sheet .word-link')))
  // 使い方の手引き（学生用の PDF）を新しいタブで開くリンク
  const guideLink = await page.evaluate(() => {
    const a = document.querySelector('.sheet .howto-link')
    return a ? { href: a.getAttribute('href'), target: a.getAttribute('target') } : null
  })
  check('メニューに「使い方（手引き）」のリンクがあり、学生用の手引きの PDF を新しいタブで開く', guideLink?.href === './guides/student-guide.pdf' && guideLink.target === '_blank', JSON.stringify(guideLink))
  await page.click('.sheet-close')
  await page.waitForFunction(() => !document.querySelector('.sheet'))

  // 指で左にはらうと次のページ（はらった直後のタップは、ブラウザが勢いを止める操作として扱うため、最後に確かめる）
  await page.touchscreen.touchStart(300, 400)
  await page.touchscreen.touchMove(200, 405)
  await page.touchscreen.touchMove(90, 410)
  await page.touchscreen.touchEnd()
  await wait(100)
  await ready()
  check('指で左にはらうと、次のページへめくれる', (await snap()).page === 1)
  await context.close()

  // 今年度だけ：小さい画面（360×640）で、はじめての案内から見本の Word を読み込む（mockups/v24 ④）
  await phoneWordCheck(browser)
})

async function phoneWordCheck(browser) {
  // 見本の Word の置き場所（WORD_FIXTURES で変えられる）
  const FIX = process.env.WORD_FIXTURES ?? 'scripts/e2e/fixtures'
  const bodyDocx = `${FIX}/word-sample-body.docx`
  const coverDocx = `${FIX}/word-sample-cover.docx`
  if (!existsSync(bodyDocx) || !existsSync(coverDocx)) {
    check('見本の Word（scripts/e2e/fixtures/word-sample-body.docx・word-sample-cover.docx）がある', false)
    return
  }
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await noHotReload(page)
  await stubConfig(page)
  page.on('pageerror', (e) => console.log('pageerror(word):', e.message))
  await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36')
  await page.setViewport({ width: 360, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0' })
  const ready = () =>
    page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && s.sheet && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 60000 })
  await ready()
  const inView = (sel) =>
    page.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect()
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), w: innerWidth, h: innerHeight, scrollX: document.documentElement.scrollWidth > innerWidth }
    }, sel)
  const fits = (r) => r.top >= 0 && r.left >= 0 && r.bottom <= r.h && r.right <= r.w && !r.scrollX
  await page.waitForSelector('.guide.step-course .g-word')
  await wait(300)
  const courseTip = await inView('.g-tip')
  check('小さい画面（360×640）でも、コースを選ぶ案内（Word の説明つき）が画面からはみ出さない', fits(courseTip), JSON.stringify(courseTip))
  await page.evaluate(() => document.querySelector('.g-opts button').click())
  await page.waitForSelector('.guide.step-word .g-word-opt.yes')
  await page.evaluate(() => document.querySelector('.g-word-opt.yes').click())
  await page.waitForSelector('.modal.word-mid')
  await wait(300)
  const startBox = await inView('.modal')
  const fullWidth = await page.evaluate(() => {
    const row = document.querySelector('.word-file').getBoundingClientRect()
    const b = document.querySelector('.word-file .acts button').getBoundingClientRect()
    return b.width > row.width * 0.8
  })
  const hint = await page.evaluate(() => document.querySelector('.word-hint')?.textContent ?? '')
  await page.screenshot({ path: `${OUT}/8-word-start.png` })
  check('Word を選ぶ窓が画面に収まり、「ファイルを選ぶ」は横いっぱい。Android の選び方（≡ から Google ドライブ）を出す', fits(startBox) && fullWidth && hint.includes('≡') && hint.includes('Google ドライブ'), JSON.stringify({ startBox, fullWidth }))
  for (const [row, path] of [[0, bodyDocx], [1, coverDocx]]) {
    const [chooser] = await Promise.all([page.waitForFileChooser(), page.evaluate((row) => document.querySelectorAll('.word-file .acts button:not(.link)')[row].click(), row)])
    await chooser.accept([path])
    await wait(200)
  }
  await page.evaluate(() => [...document.querySelectorAll('.modal .row-buttons button')].find((b) => b.textContent.includes('中身を確かめる')).click())
  await page.waitForSelector('.modal.word-modal, .word-error', { timeout: 60000 })
  const readError = await page.evaluate(() => document.querySelector('.word-error')?.textContent ?? '')
  if (readError) {
    check('見本の Word を読み取れる（スマホ）', false, readError)
    await context.close()
    return
  }
  await wait(300)
  const confirm = await page.evaluate(() => {
    const cols = getComputedStyle(document.querySelector('.word-cols')).gridTemplateColumns.split(' ').length
    const m = document.querySelector('.modal')
    return { cols, scrolls: m.scrollHeight > m.clientHeight }
  })
  await page.screenshot({ path: `${OUT}/9-word-confirm.png` })
  check('中身を確かめる窓は、縦1列に並べ、窓の中を上下に動かして読む', confirm.cols === 1 && fits(await inView('.modal')), JSON.stringify(confirm))
  await page.evaluate(() => [...document.querySelectorAll('.modal .row-buttons button')].find((b) => b.textContent.includes('読み込む')).click())
  await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 60000 })
  await ready()
  const guideNext = await page.evaluate(() => document.querySelector('.guide')?.className ?? null)
  if (guideNext) {
    // 表紙の項目が読み取れなかったときは、その項目の案内に進む（チェックの欄は開かない）
    check('写し終えたら、表紙の読み取れなかった項目の案内に進む', /step-(studentId|name|subtitle)/.test(guideNext), guideNext)
  } else {
    await page.waitForSelector('.sheet .word-todo', { timeout: 20000 })
    await wait(300)
    const top = await page.evaluate(() => document.querySelector('.sheet-body').firstElementChild?.className ?? '')
    await page.screenshot({ path: `${OUT}/10-word-after.png` })
    check('写し終えると、チェックの欄が開き、いちばん上に「つぎにすること」が出る', top === 'word-todo', top)
    // 「図1へ」：欄を閉じて、図のページへ
    const hasFigure = await page.$('.sheet .word-todo .go')
    if (hasFigure) {
      await page.evaluate(() => document.querySelector('.sheet .word-todo .go').click())
      await wait(700)
      await ready()
      const s = await page.evaluate(() => ({ sheet: !!document.querySelector('.sheet'), sel: window.__editor.getSnapshot().selection?.kind }))
      check('「図1へ」（表紙へ）を押すと、チェックの欄を閉じて紙面のその場所へ移る', !s.sheet, JSON.stringify(s))
    }
  }
  await context.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 件 合格`)
process.exitCode = failed.length ? 1 : 0
