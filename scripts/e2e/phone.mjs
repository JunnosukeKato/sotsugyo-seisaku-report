// スマホ版の動作確認（Edge をスマホの画面の大きさ・タッチ操作にして動かす）。
// 使い方: node scripts/e2e/phone.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { withEdge } from '../poc/edge.mjs'
import { stubConfig } from './configStub.mjs'
import { firstTimeV3Phone } from './firstTimeV3.mjs'
import { editorFixesV3Phone } from './editorFixesV3.mjs'
import { rangeSelectPhone } from './rangeSelect.mjs'
import { photoPagesPhone } from './photoPages.mjs'
import { tocLinksPhone } from './tocLinks.mjs'
import { autoHeadingPhone } from './autoHeading.mjs'
import { undoHeaderPhone } from './undoHeader.mjs'
import { phoneLivePhone } from './phoneLive.mjs'

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
/**
 * 引用・参考文献の窓を開く（mockups/v35 ①：「追加」の欄からは外し、メニューの「？ 使い方」→「引用・参考文献」の「引用・参考文献を入れる」から入れる）。
 * 下から出る欄が開いていれば閉じてから。返す値：使い方の「引用・参考文献を入れる」の高さ（px）と、押したあと使い方の欄が閉じたか
 */
const openRefs = async (page) => {
  if (await page.$('.sheet .sheet-close')) {
    await page.click('.sheet .sheet-close')
    await wait(300)
  }
  await page.click('.p-top .icon-btn')
  await page.waitForSelector('.sheet .help-btn')
  await page.click('.sheet .help-btn')
  await page.waitForSelector('.help-list button[data-topic="references"]')
  await page.click('.help-list button[data-topic="references"]')
  await page.waitForSelector('.help-topic .help-refs')
  await wait(200)
  const h = await page.evaluate(() => Math.round(document.querySelector('.help-topic .help-refs').getBoundingClientRect().height))
  await page.click('.help-topic .help-refs')
  await page.waitForSelector('.modal .row-buttons')
  return { h, helpClosed: !(await page.$('.help-sheet')) }
}
/** 見えているボタンなどの、見た目の高さ（px。いちばん低いもの。見えているものがなければ 0） */
const minVisibleHeight = (page, sel) =>
  page.evaluate((sel) => {
    const hs = [...document.querySelectorAll(sel)].map((el) => el.getBoundingClientRect().height).filter((h) => h > 0)
    return hs.length ? Math.round(Math.min(...hs) * 10) / 10 : 0
  }, sel)
/**
 * 削除の知らせ（.undo-toast）の位置：ページ送り・「ページ全体に戻す」・選んでいる物の道具・紙面の下の帯のうち、知らせに重なっているもの（なければ空）。
 * shown：知らせが出ている、above：重なっていない道具・帯のうち、知らせより下にあるもの
 */
const undoPlacement = async (page) => {
  // 知らせは下から少し動いて出てくる（0.2秒）。出終わってから位置を測る（組み直しが速くなり、出ている途中に測ってしまうことがあったため）
  await page.waitForFunction(() => !document.querySelector('.undo-toast')?.getAnimations().some((a) => a.playState === 'running'), { timeout: 5000 })
  return page.evaluate(() => {
    const toast = document.querySelector('.undo-toast')?.getBoundingClientRect()
    if (!toast) return { shown: false }
    const parts = ['.pager', '.unzoom', '.sel-bar > *', '.page-band', '.page-side > *'].flatMap((sel) => [...document.querySelectorAll(sel)].map((el) => ({ sel, r: el.getBoundingClientRect() }))).filter(({ r }) => r.height > 0)
    const hit = (r) => r.top < toast.bottom - 0.5 && r.bottom > toast.top + 0.5 && r.left < toast.right - 0.5 && r.right > toast.left + 0.5
    return {
      shown: true,
      covers: parts.filter(({ r }) => hit(r)).map(({ sel }) => sel),
      below: parts.filter(({ r }) => r.top >= toast.bottom - 0.5).map(({ sel }) => sel),
      inside: toast.top >= 0 && toast.bottom <= innerHeight && toast.left >= 0 && toast.right <= innerWidth,
      buttonH: Math.round(document.querySelector('.undo-toast button')?.getBoundingClientRect().height ?? 0),
    }
  })
}

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

  // 書き始めたばかり（氏名・サブタイトルはあとで）：チェックの欄は「直すところ 0」で赤い字・印が出ず、まだのところが灰色の ○ で並ぶ。
  // 下の「チェック」の赤い数も出ない（直すところのエラーだけを数える。mockups/v35 ① 案A）
  await page.click('.p-nav .nav-check')
  await page.waitForSelector('.sheet .check-prog')
  await wait(300)
  const freshSheet = await page.evaluate(() => {
    const body = document.querySelector('.sheet .sheet-body')
    const red = [...document.querySelectorAll('.sheet *')].filter((e) => { const cs = getComputedStyle(e); return cs.color === 'rgb(181, 68, 59)' || cs.backgroundColor === 'rgb(181, 68, 59)' }).map((e) => e.className || e.tagName)
    return {
      tally: document.querySelector('.sheet .tally')?.textContent.replace(/\s/g, '') ?? '',
      rows: [...body.querySelectorAll('.check-prog li')].map((li) => `${li.className}:${li.querySelector('.l')?.textContent}`),
      none: body.querySelector('.check-none')?.textContent ?? '',
      note: body.querySelector('.export-note')?.textContent ?? '',
      issues: body.querySelectorAll('.issue').length,
      red,
      badge: document.querySelector('.p-nav .badge')?.textContent ?? '',
    }
  })
  await shot('4a-check-fresh')
  check(
    'スマホ：書き始めたばかりのチェックの欄は「直すところ 0　まだ 4」で、赤い字・印がない。まだのところ（表紙・本文のページ・本文の段落・作品写真は ○、抄録は「先生の許可のあと」）と、PDF のボタンの下に「まだのところが4つあります」。下の「チェック」に赤い数は出ない',
    freshSheet.tally === '直すところ0まだ4' && freshSheet.red.length === 0 && freshSheet.issues === 0 && freshSheet.none.includes('いま直すところはありません') && freshSheet.rows.join(',') === 'todo:表紙,todo:本文のページ,todo:本文の段落,todo:作品写真,wait:抄録' && freshSheet.note === 'まだのところが4つあります' && !freshSheet.badge,
    JSON.stringify(freshSheet),
  )
  // まだの行を押すと、欄が閉じて、その場所へ移る（本文の段落：まだ書いていない最初の段落が開く）
  await page.evaluate(() => [...document.querySelectorAll('.sheet .check-prog li')].find((li) => li.textContent.includes('本文の段落')).querySelector('button').click())
  await page.waitForFunction(() => !!window.__editor.getSnapshot().editingId, { timeout: 20000 }).catch(() => {})
  const rowJump = await page.evaluate(() => ({ sheet: !!document.querySelector('.sheet'), editing: window.__editor.getSnapshot().editingId, first: window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.type === 'paragraph' && b.hint)?.id }))
  check('スマホ：まだのところの「本文の段落」を押すと、欄が閉じて、まだ書いていない最初の段落が書く欄で開く', !rowJump.sheet && !!rowJump.editing && rowJump.editing === rowJump.first, JSON.stringify(rowJump))
  if (rowJump.editing) {
    await page.click('.edit-sheet .done')
    await ready()
  }


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
  await page.waitForSelector('.sheet .check-prog')
  await shot('5-check')
  check('「チェック」で、セルフチェックが下から出る', (await page.$$('.sheet .issue')).length > 0)
  // 書いた文の間違い（「私」「製作」）は直すところ（赤・黄）に出て、下の「チェック」の赤い数は、直すところのエラーの数だけ（まだのところは数えない）
  const fixSheet = await page.evaluate(() => {
    const errors = [...document.querySelectorAll('.sheet .issue.error')].length
    return { errors, afterFix: !!document.querySelector('.sheet .check-sub.fix ~ .sev-legend'), badge: document.querySelector('.p-nav .badge')?.textContent ?? '', tally: document.querySelector('.sheet .tally')?.textContent.replace(/\s/g, '') ?? '', todo: document.querySelectorAll('.sheet .check-prog li.todo').length }
  })
  check('スマホ：書いた文の間違いは「直すところ」に出て（凡例は直すところの中）、下の「チェック」の赤い数は直すところのエラーの数（まだのところは数えない）', fixSheet.errors >= 2 && fixSheet.afterFix && fixSheet.badge === String(fixSheet.errors) && fixSheet.todo > 0 && fixSheet.tally.startsWith('直すところ'), JSON.stringify(fixSheet))
  // エラーと要確認の意味は、一覧の上に1行（指摘ごとの札「手順書」「補助」はない。mockups/v31 案1）。スマホの幅で横にはみ出さない
  const phoneLegend = await page.evaluate(() => {
    const el = document.querySelector('.sheet .sev-legend')
    const r = el?.getBoundingClientRect()
    return { text: el?.textContent ?? '', inside: !!r && r.left >= 0 && r.right <= innerWidth, chips: document.querySelectorAll('.sheet .issue .src').length, fontSize: el ? parseFloat(getComputedStyle(el).fontSize) : 0 }
  })
  check('チェックの欄の一覧の上に「エラー：直してから出す」「要確認：確かめて、必要なら直す」が出て、札（手順書・補助）はない', phoneLegend.text.includes('エラー：直してから出す') && phoneLegend.text.includes('要確認：確かめて、必要なら直す') && phoneLegend.inside && phoneLegend.chips === 0 && phoneLegend.fontSize >= 13, JSON.stringify(phoneLegend))
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
  // 書く欄の道具は「図を入れる」「表を入れる」（素材表は「表を入れる」の欄の中へ。mockups/v35 ②）と、「戻す」の横に「やり直す」（mockups/v35 ④）
  const paraTools = await page.evaluate(() => [...document.querySelectorAll('.edit-sheet .es-tools button')].map((b) => b.textContent.trim()).join(','))
  check('段落を書いているときの書く欄の道具は「図を入れる・表を入れる・削除・戻す・やり直す」（素材表のボタンはない）', paraTools === '図を入れる,表を入れる,削除,戻す,やり直す', paraTools)
  // 表を入れる：下から小さな欄が出て、列・行を［−］［＋］で選ぶ（最初は2列×2行。ボタンは 44px 以上）。書く欄は開いたまま
  const centerOf = (sel, text) =>
    page.evaluate((sel, text) => {
      const el = [...document.querySelectorAll(sel)].find((b) => !text || b.textContent.includes(text))
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }, sel, text)
  const tapEl = async (sel, text) => {
    const p = await centerOf(sel, text)
    await page.touchscreen.tap(p.x, p.y)
    await wait(150)
  }
  const sizeSheet = () =>
    page.evaluate(() => {
      const el = document.querySelector('.sheet.table-size')
      if (!el) return null
      const steps = [...el.querySelectorAll('.ts-step')]
      const buttons = [...el.querySelectorAll('.ts-step button')].map((b) => b.getBoundingClientRect())
      return {
        title: el.querySelector('h2')?.textContent,
        values: steps.map((s) => s.querySelector('b').textContent).join('×'),
        labels: steps.map((s) => s.querySelector('.l').textContent).join('／'),
        minus: steps.map((s) => s.querySelectorAll('button')[0].disabled),
        small: Math.min(...buttons.map((r) => Math.min(r.width, r.height))),
        preview: el.querySelectorAll('.ts-preview i').length,
        head: el.querySelectorAll('.ts-preview i.h').length,
        note: el.querySelector('.ts-note')?.textContent,
        insert: el.querySelector('.ts-insert')?.textContent,
        material: el.querySelector('.ts-material')?.textContent,
        editing: window.__editor.getSnapshot().editingKind,
      }
    })
  await tapEl('.edit-sheet .es-tools button', '表を入れる')
  await page.waitForSelector('.sheet.table-size')
  let ss = await sizeSheet()
  check(
    '書く欄の「表を入れる」で、下から「表を入れる」の欄が出る（列［−］2［＋］・行［−］2［＋］（1行目は見出し）・小さな表の絵・「入れる」・「素材表を入れる」。［−］［＋］は 44px 以上。行は2より減らせない）',
    ss?.title === '表を入れる' && ss.values === '2×2' && ss.labels === '列横に並ぶ数／行縦に並ぶ数（1行目は見出し）' && ss.minus.join() === 'false,true' && ss.small >= 44 && ss.preview === 4 && ss.head === 2 && ss.note === '2列×2行（色の付いた行が見出し）' && ss.insert === '入れる' && ss.material === '素材表を入れる名称・使用箇所・生地見本の3列' && ss.editing === 'paragraph',
    JSON.stringify(ss),
  )
  // ×で閉じると、入れずに書く欄に戻る（書いていた段落のまま）
  await tapEl('.sheet.table-size .sheet-close')
  await wait(200)
  const closedSheet = await page.evaluate(() => ({ sheet: !!document.querySelector('.sheet.table-size'), editing: window.__editor.getSnapshot().editingId, focus: !!document.activeElement?.closest('.overlay-editor') }))
  check('「表を入れる」の欄を×で閉じると、表は入らず、書いていた段落に戻る', !closedSheet.sheet && closedSheet.editing === pid && closedSheet.focus, JSON.stringify(closedSheet))
  // 列を3、行を4にして「入れる」
  await tapEl('.edit-sheet .es-tools button', '表を入れる')
  await page.waitForSelector('.sheet.table-size')
  const plusOf = (n) => tapEl(`.sheet.table-size .ts-step:nth-of-type(${n + 1}) button[aria-label$="を増やす"]`)
  await plusOf(0)
  await plusOf(1)
  await plusOf(1)
  ss = await sizeSheet()
  check('［＋］で列3・行4にすると、小さな表の絵も 3列×4行になる', ss?.values === '3×4' && ss.preview === 12 && ss.head === 3 && ss.note === '3列×4行（色の付いた行が見出し）', JSON.stringify(ss))
  await shot('6b-table-size')
  await tapEl('.sheet.table-size .ts-insert')
  await page.waitForFunction(() => window.__editor.getSnapshot().editingKind === 'tableCaption', { timeout: 30000 })
  await ready()
  const phoneTable = await page.evaluate(() => {
    const s = window.__editor.getSnapshot()
    const id = window.__editor.tableIdOf(s.editingId)
    return { shape: s.report.body.flatMap((c) => c.blocks).find((b) => b.id === id)?.rows.map((r) => r.cells.length), sheet: !!document.querySelector('.sheet.table-size') }
  })
  check('「入れる」で、選んだ 3列×4行（1行目は見出し）の表が入り、表のタイトルを書き始める', JSON.stringify(phoneTable.shape) === '[3,3,3,3]' && !phoneTable.sheet, JSON.stringify(phoneTable))
  await page.keyboard.type('素材')
  // 書く欄の「戻す」で書いた分を戻し、「やり直す」で戻す前に進める（書く欄は開いたまま。mockups/v35 ④）
  const captionNow = () =>
    page.evaluate(() => {
      const s = window.__editor.getSnapshot()
      const t = s.report.body.flatMap((c) => c.blocks).find((b) => b.type === 'table' && b.id === window.__editor.tableIdOf(s.editingId ?? ''))
      const redo = [...document.querySelectorAll('.edit-sheet .es-tools button')].find((b) => b.textContent.includes('やり直す'))
      return { editing: s.editingKind, caption: t?.caption ?? null, open: !!document.querySelector('.edit-sheet.open'), redoOff: redo?.disabled ?? null, canRedo: s.canRedo }
    })
  await tapEl('.edit-sheet .es-tools button', '戻す')
  await page.waitForFunction(() => window.__editor.getSnapshot().editingKind === 'tableCaption', { timeout: 30000 })
  await ready()
  const phUndo = await captionNow()
  await tapEl('.edit-sheet .es-tools button', 'やり直す')
  await page.waitForFunction(() => window.__editor.getSnapshot().editingKind === 'tableCaption' && !window.__editor.getSnapshot().canRedo, { timeout: 30000 })
  await ready()
  const phRedo = await captionNow()
  check('スマホ：書く欄の「戻す」で書いた分が戻り、横の「やり直す」で戻す前に進む（書く欄は開いたまま）', phUndo.caption === '' && phUndo.open && phUndo.redoOff === false && phRedo.caption === '素材' && phRedo.open && phRedo.redoOff === true, JSON.stringify({ phUndo, phRedo }))
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

  // 選んだ表を削除すると、画面の下に「表を削除しました［戻す］」が出て、「戻す」で元に戻る（mockups/v23 ⑦ 案A）。
  // 15秒か次の操作まで出し、下の細い線で残りの時間を示す。戻すと「✓ 表を戻しました」と出て、戻した表が光る（mockups/v32 ② 案A）
  await page.evaluate((id) => window.__editor.select({ kind: 'table', id }), tableId)
  await page.waitForSelector('.sel-bar .tb')
  await page.evaluate(() => [...document.querySelectorAll('.sel-bar .tb')].find((b) => b.textContent.includes('削除')).click())
  await ready()
  const toast = await page.evaluate(() => {
    const area = document.querySelector('.undo-area')
    const b = area?.querySelector('.undo-toast button')
    const r = b?.getBoundingClientRect()
    const a = b && getComputedStyle(b, '::after')
    const line = area?.querySelector('.undo-timer span')
    return { text: area?.textContent ?? '', role: area?.getAttribute('role'), hitH: r ? r.height - parseFloat(a.top) - parseFloat(a.bottom) : 0, line: line ? getComputedStyle(line).animationDuration : null }
  })
  const tableGone = !(await snap()).report.body.flatMap((c) => c.blocks).some((b) => b.id === tableId)
  const undoAt = await undoPlacement(page)
  await shot('7b-undo-notice')
  // 知らせは、ページ送り（と紙面の下の帯・下の道具）の上に出す（前はページ送りに重なり、出ている15秒の間、ページを送れなかった）。［戻す］は見た目も高さ 44px 以上
  check(
    'スマホ：削除の知らせは、ページ送り・紙面の下の帯・下の道具に重ならず、その上に出る（［戻す］は見た目も高さ 44px 以上）',
    undoAt.shown && undoAt.covers.length === 0 && undoAt.below.includes('.pager') && undoAt.inside && undoAt.buttonH >= 44,
    JSON.stringify(undoAt),
  )
  check('選んだ表を削除すると、画面の下に「表を削除しました［戻す］」が出る（読み上げにも伝わる・残りの時間の線は15秒）', tableGone && toast.text.includes('表を削除しました') && toast.role === 'status' && toast.line === '15s', JSON.stringify(toast))
  check('知らせの「戻す」は、押せる範囲が高さ 44px 以上', toast.hitH >= 44, `${toast.hitH}px`)
  await wait(7000)
  check('7秒たっても、知らせは出たまま（前は6秒ほどで消えていた）', !!(await page.$('.undo-toast button')))
  await page.click('.undo-toast button')
  await ready()
  await wait(150)
  const restoredPh = await page.evaluate((id) => ({ text: document.querySelector('.undo-toast')?.textContent ?? '', button: !!document.querySelector('.undo-toast button'), flash: !!document.querySelector(`.page-viewport.front .data-table.undo-flash[data-table-id="${id}"]`) }), tableId)
  await shot('7c-undo-restored')
  check('知らせの「戻す」で、削除した表が戻り、「✓ 表を戻しました」と出て、戻した表が光る', (await snap()).report.body.flatMap((c) => c.blocks).some((b) => b.id === tableId) && restoredPh.text === '表を戻しました' && !restoredPh.button && restoredPh.flash, JSON.stringify(restoredPh))

  // 表の下が空いていれば、表を選ぶと、表のすぐ下に「＋ ここに続きを書く」。押すと、表の後ろに段落ができ、下の書く欄ですぐ書ける（mockups/v32 ① 案A）。
  // 表のすぐ後ろに段落が続くときは出さない（文に重ねない）
  const tableLast = (next) =>
    page.evaluate(
      (id, next) =>
        window.__editor.update((r) => ({
          ...r,
          body: r.body.map((c) => {
            const i = c.blocks.findIndex((b) => b.id === id)
            return i < 0 ? c : { ...c, blocks: [...c.blocks.slice(0, i + 1), ...(next ? [{ type: 'paragraph', id: 'ph-next', content: [{ type: 'text', text: '表のあとに続く段落である。' }] }] : [])] }
          }),
        })),
      tableId,
      next,
    )
  await tableLast(true)
  await ready()
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), cellId)
  await ready()
  await page.evaluate((id) => window.__editor.select({ kind: 'table', id }), tableId)
  await wait(300)
  const noRow = await page.evaluate(() => {
    const b = document.querySelector('.continue-row')
    const p = [...document.querySelectorAll('.page-viewport.front [data-block-id="ph-next"]')].find((e) => e.getBoundingClientRect().height > 0)
    const range = document.createRange()
    range.selectNodeContents(p)
    const line = range.getClientRects()[0]
    const hit = document.elementFromPoint(line.left + 10, (line.top + line.bottom) / 2)
    return { shown: !b.hidden, hit: hit?.closest('[data-block-id]')?.getAttribute('data-block-id') ?? hit?.className }
  })
  check('スマホでも、表のすぐ後ろに段落が続くときは、表を選んでも「＋ ここに続きを書く」を出さない（段落の1行目に重ならない）', !noRow.shown && noRow.hit === 'ph-next', JSON.stringify(noRow))
  await tableLast(false)
  await ready()
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), cellId)
  await ready()
  await page.evaluate((id) => window.__editor.select({ kind: 'table', id }), tableId)
  await wait(300)
  const phoneRow = await page.evaluate((id) => {
    const b = document.querySelector('.continue-row')
    const r = b.getBoundingClientRect()
    const t = document.querySelector(`.page-viewport.front .data-table[data-table-id="${id}"]`).getBoundingClientRect()
    return { shown: !b.hidden && r.height > 0, below: r.top >= t.bottom && r.top - t.bottom < 30, inside: r.left >= 0 && r.right <= innerWidth, h: Math.round(r.height), x: r.left + 60, y: r.top + r.height / 2 }
  }, tableId)
  await shot('7d-continue-row')
  check('スマホでも、表の下が空いていれば、表を選ぶと、表のすぐ下に「＋ ここに続きを書く」が出る（見た目も高さ 44px 以上）', phoneRow.shown && phoneRow.below && phoneRow.inside && phoneRow.h >= 44, JSON.stringify(phoneRow))
  await page.touchscreen.tap(phoneRow.x, phoneRow.y)
  await wait(300)
  const contOpen = await page.evaluate((id) => {
    const s = window.__editor.getSnapshot()
    const flat = s.report.body.flatMap((c) => c.blocks)
    return { editing: s.editingId, after: flat[flat.findIndex((b) => b.id === id) + 1]?.id, focused: document.activeElement?.classList.contains('overlay-editor') && !!document.activeElement.closest('.edit-sheet.open') }
  }, tableId)
  check('「＋ ここに続きを書く」をタップすると、表の後ろに段落ができ、下の書く欄ですぐ書ける', !!contOpen.editing && contOpen.editing === contOpen.after && contOpen.focused, JSON.stringify(contOpen))
  await page.keyboard.type('素材は三種類を使った。')
  await page.click('.edit-sheet .done')
  await ready()
  check('書いた文は、表の後ろの段落に入る', (await snap()).report.body.flatMap((c) => c.blocks).find((b) => b.id === contOpen.editing)?.content.map((n) => n.text ?? '').join('') === '素材は三種類を使った。')
  // 書く欄で段落を削除すると知らせが出て、次の操作（「追加」で小見出しを足す）をすると消える
  const contAt = await page.evaluate((id) => { const r = document.querySelector(`.page-viewport.front [data-block-id="${id}"]`).getBoundingClientRect(); return { x: r.left + 30, y: r.top + r.height / 2 } }, contOpen.editing)
  await page.touchscreen.tap(contAt.x, contAt.y)
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 20000 }, contOpen.editing)
  await page.evaluate(() => [...document.querySelectorAll('.edit-sheet .es-tools button')].find((b) => b.textContent.includes('削除')).click())
  await ready()
  const paraNotice = await page.evaluate(() => document.querySelector('.undo-toast')?.textContent ?? '')
  await page.click('.p-nav .add')
  await page.waitForSelector('.sheet .add-grid')
  await page.evaluate(() => [...document.querySelectorAll('.sheet .add-grid .tb')].find((b) => b.textContent.includes('小見出し')).click())
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId, { timeout: 30000 })
  await ready()
  check('書く欄で段落を削除すると「段落を削除しました［戻す］」が出て、次の操作（小見出しを足す）をすると消える', paraNotice === '段落を削除しました戻す' && !(await page.$('.undo-toast')), paraNotice)
  await page.click('.edit-sheet .done')
  await ready()

  // 作品写真：入っている写真を押すと「この写真（1枚目）：差し替え／外す」が出て、「外す」で枠を空にできる（mockups/v23 ⑧ 案A）
  await page.evaluate(async () => {
    const c = new OffscreenCanvas(300, 400)
    const g = c.getContext('2d')
    g.fillStyle = '#4a6a8a'
    g.fillRect(0, 0, 300, 400)
    window.__editor.addImages([{ id: 'e2e-photo', blob: await c.convertToBlob({ type: 'image/png' }), widthPx: 300, heightPx: 400 }])
    window.__editor.update((r) => ({ ...r, workPhotos: [{ layout: 1, columns: 1, imageIds: ['e2e-photo'] }] }))
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
  check('「外す」で枠が空になり、「作品写真を外しました［戻す］」が出る', s.report.workPhotos[0].imageIds[0] === '' && (await page.evaluate(() => document.querySelector('.undo-toast')?.textContent ?? '')).includes('作品写真を外しました'))
  await page.click('.undo-toast button')
  await ready()
  check('知らせの「戻す」で、外した写真が戻る', (await snap()).report.workPhotos[0].imageIds[0] === 'e2e-photo')
  await page.evaluate(() => window.__editor.goToPage(0, 'none'))
  await ready()

  // 今年度だけ：メニューに「Word で書いた分を読み込む」の小さなリンク
  await page.click('.p-top .icon-btn')
  await page.waitForSelector('.sheet .sheet-body')
  check('メニューに「Word で書いた分を読み込む」のリンクがある', !!(await page.$('.sheet .word-link')))
  // 「？ 使い方」（メニューの中。押すと画面いっぱいの使い方の欄。mockups/v27 案A）
  check('メニューに「？ 使い方」のボタンがある', !!(await page.$('.sheet .links .help-btn')))
  await page.click('.sheet .help-btn')
  await page.waitForSelector('.help-sheet')
  await wait(400)
  const helpSheet = await page.evaluate(() => {
    const r = document.querySelector('.help-sheet').getBoundingClientRect()
    return { top: Math.round(r.top), left: r.left, right: r.right, width: innerWidth, menu: !!document.querySelector('.sheet'), topics: document.querySelectorAll('.help-list button').length, modal: document.querySelector('.help-sheet').getAttribute('aria-modal'), pdf: document.querySelector('.help-foot .help-pdf')?.getAttribute('href') }
  })
  await shot('8a-help')
  check('メニューの「？ 使い方」で、画面いっぱいの使い方の欄が出る（メニューは閉じる・項目17・印刷用の手引き（PDF））', helpSheet.top <= 12 && helpSheet.left === 0 && helpSheet.right === helpSheet.width && !helpSheet.menu && helpSheet.topics === 17 && helpSheet.modal === 'true' && helpSheet.pdf === './guides/student-guide.pdf', JSON.stringify(helpSheet))
  await page.type('.help-search input', 'PDF 出ない')
  await wait(300)
  const phoneFound = await page.evaluate(() => ({ titles: [...document.querySelectorAll('.help-results .t')].map((t) => t.textContent).slice(0, 2), marks: document.querySelectorAll('.help-results mark').length }))
  check('スマホでも「PDF 出ない」で探すと、言葉に印が付いた項目が出る', phoneFound.titles[0] === 'PDF の出し方（端末ごと）' && phoneFound.marks > 0, JSON.stringify(phoneFound))
  await page.evaluate(() => document.querySelector('.help-results button').click())
  await page.waitForSelector('.help-topic')
  await wait(300)
  const phoneTopic = await page.evaluate(() => ({ device: document.querySelector('.help-dev .tabs .on')?.textContent, here: !!document.querySelector('.help-dev .here'), cut: document.querySelector('.help-sheet .help-body').scrollWidth > document.querySelector('.help-sheet .help-body').clientWidth + 1 }))
  await shot('8b-help-topic')
  check('項目を開くと、使っている端末（Android）の PDF の保存のしかたを先に出し、横にはみ出さない', phoneTopic.device === 'Android' && phoneTopic.here && !phoneTopic.cut, JSON.stringify(phoneTopic))
  await page.click('.help-sheet .help-close')
  await wait(300)
  check('「×」で使い方の欄が閉じる', !(await page.$('.help-sheet')))

  // ---- 指差し確認（スマホは4か所。mockups/v27 案A）：案内を「あとで」にした学生は、次に開いたときに出る ----
  check('案内を「あとで」で閉じた直後は、指差し確認を出さない', !(await page.$('.tour')))
  // 書いている途中に（同じタブで）読み込み直したときは出さない（はじめて使う学生の試し（3回目）：Word から読み込んで書いている途中に読み込み直すと、急に出ていた）
  await page.reload({ waitUntil: 'networkidle0' })
  await ready()
  await wait(1500)
  check('書いている途中に読み込み直したときは、指差し確認を出さない（次に開いたときに出す）', !(await page.$('.tour')))
  // 次に開いたとき（このタブで開いた印を消して、開き直したのと同じにする）
  await page.evaluate(() => sessionStorage.removeItem('sotsugyo-seisaku-report-opened'))
  await page.reload({ waitUntil: 'networkidle0' })
  await ready()
  const phoneTour = await page.waitForSelector('.tour .tour-tip', { timeout: 20000 }).then(() => true, () => false)
  // 出したら、すぐこの端末に覚える（見終える前に読み込み直しても、また初めから出さない）
  const tourStored = await page.evaluate(() => localStorage.getItem('sotsugyo-seisaku-report-tour'))
  check('指差し確認を出したら、見終える前でも、出したことをこの端末に覚える', phoneTour && tourStored === 'shown', String(tourStored))
  const tourTitles = []
  for (let i = 0; phoneTour && i < 6; i++) {
    const st = await page.evaluate(() => {
      const r = document.querySelector('.tour-tip').getBoundingClientRect()
      return { title: document.querySelector('.tour-tip h2')?.textContent, next: document.querySelector('.tour-acts .next')?.textContent, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }
    })
    tourTitles.push(st)
    if (i === 1) await shot('8c-tour')
    await page.click('.tour-acts .next')
    await wait(300)
    if (st.next === 'おわり') break
  }
  check('次に開くと指差し確認が出て、4か所（紙面・チェックと PDF・保存のようす・メニュー）を順に見られる（吹き出しは画面の中）', tourTitles.map((x) => x.title).join(',') === '紙面,チェックと PDF,保存のようす,メニュー' && tourTitles.every((x) => x.inside) && !(await page.$('.tour')), JSON.stringify(tourTitles))
  // 使い方の「指差し確認をもう一度見る」から、もう一度。「とばす」で終わる
  await page.click('.p-top .icon-btn')
  await page.waitForSelector('.sheet .help-btn')
  await wait(300)
  await page.click('.sheet .help-btn')
  await page.waitForSelector('.help-sheet [data-topic="tour"]')
  await page.evaluate(() => document.querySelector('.help-sheet [data-topic="tour"]').click())
  await page.waitForSelector('.help-action')
  await page.click('.help-action')
  const phoneReplay = await page.waitForSelector('.tour .tour-tip', { timeout: 15000 }).then(() => true, () => false)
  const tourButtonsH = { skip: await minVisibleHeight(page, '.tour-acts .skip'), next: await minVisibleHeight(page, '.tour-acts .next') }
  await page.click('.tour-acts .skip')
  await wait(300)
  check('使い方から指差し確認をもう一度見られ、「とばす」で終わる', phoneReplay && !(await page.$('.tour')) && !(await page.$('.help-sheet')))
  check('指差し確認の「とばす」「次へ」は、見た目も高さ 44px 以上', tourButtonsH.skip >= 44 && tourButtonsH.next >= 44, JSON.stringify(tourButtonsH))
  // 一度出した（見終えずに閉じた・読み込み直した）指差し確認は、次に開いても出さない（1回だけ）
  await page.evaluate(() => {
    localStorage.setItem('sotsugyo-seisaku-report-tour', 'shown')
    sessionStorage.removeItem('sotsugyo-seisaku-report-opened')
  })
  await page.reload({ waitUntil: 'networkidle0' })
  await ready()
  await wait(1500)
  check('一度出した指差し確認は、見終えていなくても、次に開いたときに出さない', !(await page.$('.tour')))
  await page.evaluate(() => window.__editor.goToPage(0, 'none'))
  await ready()

  // 指で左にはらうと次のページ（はらった直後のタップは、ブラウザが勢いを止める操作として扱うため、最後に確かめる）
  await page.touchscreen.touchStart(300, 400)
  await page.touchscreen.touchMove(200, 405)
  await page.touchscreen.touchMove(90, 410)
  await page.touchscreen.touchEnd()
  await wait(100)
  await ready()
  check('指で左にはらうと、次のページへめくれる', (await snap()).page === 1)
  // 上下にはらっても、めくれる（上へで次のページ、下へで前のページ。紙面は上下に動かない）
  const swipeV = async (fromY, toY) => {
    await page.touchscreen.touchStart(200, fromY)
    await page.touchscreen.touchMove(203, (fromY + toY) / 2)
    await page.touchscreen.touchMove(206, toY)
    await page.touchscreen.touchEnd()
    await wait(100)
    await ready()
  }
  const touchAction = await page.evaluate(() => getComputedStyle(document.querySelector('.stage .page-scroller')).touchAction)
  await swipeV(520, 300)
  const afterUp = (await snap()).page
  await swipeV(300, 520)
  const afterDown = (await snap()).page
  check('指で上にはらうと次のページ、下にはらうと前のページへめくれる（紙面はブラウザの上下の動きにしない）', afterUp === 2 && afterDown === 1 && touchAction === 'none', JSON.stringify({ afterUp, afterDown, touchAction }))
  // 読み込み直すと、最後に見ていたページが開く（下のページ送りも、そのページを指す）
  await wait(300)
  await page.reload({ waitUntil: 'networkidle0' })
  await ready()
  const reopened = await page.evaluate(() => ({ page: window.__editor.getSnapshot().page, pager: document.querySelector('.pager .lbl')?.textContent ?? '' }))
  check('スマホでも、読み込み直すと最後に見ていたページが開く', reopened.page === 1 && reopened.pager.includes('2 /'), JSON.stringify(reopened))
  await context.close()

  // 今年度だけ：小さい画面（360×640）で、はじめての案内から見本の Word を読み込む（mockups/v24 ④）
  await phoneWordCheck(browser)

  // iPhone：PDF を作ったあと「保存する」で共有の画面から保存する（mockups/v28 案C）
  await iphoneShareCheck(browser)

  // 紙面の下の帯（紙面の中の小さな案内を、ふつうの文字の大きさで出す）と、高さ 44px のボタン（mockups/v32 ④ 案A）
  await bandCheck(browser)

  // はじめて使う学生の試し（v32 のあと）で見つかったこと（横向きの「＋」・表のタイトル・表の行を消せないとき・抄録を書き始めたあとの［戻す］）
  await firstTimeFixesPhone(browser)

  // 書いている欄が、上の案内・下の書く欄に隠れない（縦向き・横向き・小さい画面。はじめての案内のサブタイトルが案内に隠れていた）
  await writingVisibleCheck(browser)

  // 2回目から開くのが速い（最後に見ていたページを先に見せる。「（初回は数秒かかります）」は、はじめて開いたときだけ）
  await quickOpenCheck(browser)

  // 横向き：作品写真のページの並べ方と、選んだ写真の道具を、紙面の右の列に出す（mockups/v33 案A）
  await sideToolsCheck(browser)

  // はじめて使う学生の試し（3回目）：メニューの「バックアップ・作り直す」と、その窓（mockups/v34 案A。scripts/e2e/firstTimeV3.mjs）
  await firstTimeV3Phone(browser, check)

  // はじめて使う学生の試し（3回目：スマホ）で見つかった、紙面と書く欄まわりの直し（開いた直後に書く・ページ送り・準備中の表示など。scripts/e2e/editorFixesV3.mjs）
  await editorFixesV3Phone(browser, check)

  // 段落をまたいで選ぶのはパソコンだけ：指で押すと、今までどおり書く欄が開く（scripts/e2e/rangeSelect.mjs）
  await rangeSelectPhone(browser, check)

  // 作品写真の何ページか（mockups/v38 案A）：下の道具の「ページを足す」「ページを消す」（scripts/e2e/photoPages.mjs）
  await photoPagesPhone(browser, check)

  // 目次のページ（mockups/v41 案C＋案B）：帯の言葉・行をタップすると見出しへ・行のない所は知らせ・はらうとページを送る（scripts/e2e/tocLinks.mjs）
  await tocLinksPhone(browser, check)

  // 段落に「ⅲ．試着」のように打って Enter・「完了」で見出しになる。知らせは書く欄の上に出て、「戻す」で打ったままの段落に戻る（scripts/e2e/autoHeading.mjs）
  await autoHeadingPhone(browser, check)

  // 上の帯の「戻す」「やり直す」（mockups/v39 案A。何もタップしていなくても戻せる。scripts/e2e/undoHeader.mjs）
  await undoHeaderPhone(browser, check)

  // 打った字をその場で紙面に（組み直すのを待たずに、紙面の段落の位置に写しを出す。Enter・見出し・ページをまたぐ段落・PDF・1字ごとの時間。scripts/e2e/phoneLive.mjs）
  await phoneLivePhone(browser, check)
})

/**
 * スマホの見やすさ（mockups/v32 ④ 案A）：
 * - 紙面の中の小さな案内とボタン（抄録の「先生の許可が出た」・作品写真の空いている枠・まだ書いていない欄）を、紙面の下の帯に、ふつうの文字の大きさで出す。紙面には小さな印だけ
 * - 横向きでは、帯は紙面の右（紙面が小さくなりすぎない）
 * - 小さいボタン（「完了」「あとで入力する」・使い方の「引用・参考文献を入れる」・ページ送り・「ページ全体に戻す」）は高さ 44px 以上（指摘の「直す」はなくした。学生が自分で直す）
 * - 残りの小さいボタン（書く欄の道具・案内の「本文へ進む」・引用・参考文献の窓のボタン）も、見た目の高さ 44px 以上（v32 の直し。
 *   削除の知らせの［戻す］・「＋ ここに続きを書く」・「とばす」は上の流れの中で、PDF の窓は iphoneShareCheck で確かめる）
 * - 縦向きでも横向きでも、画面が横にはみ出さない。横向きでは抄録の印を「→」に
 * - 拡大したままほかのページへ移ると、ページ全体の表示に戻る。削除の知らせは、ページ送り・帯・下の道具に重ならない
 * - 紙面の仮の文字は「タップ」。生地見本の画像を入れた表のセルには、仮の文字を出さない
 */
async function bandCheck(browser) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await noHotReload(page)
  await stubConfig(page)
  page.on('pageerror', (e) => console.log('pageerror(band):', e.message))
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  })
  const PORTRAIT = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  const LANDSCAPE = { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
  await page.setViewport(PORTRAIT)
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0' })
  const ready = () =>
    page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && s.sheet && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 60000 })
  await ready()
  const { setupWriting } = await import('./sampleReport.mjs')
  const showKind = async (kind) => {
    await page.evaluate((kind) => window.__editor.goToPage(window.__editor.getSnapshot().layout.kinds.indexOf(kind), 'none'), kind)
    await ready()
    await wait(400)
  }
  /** 高さ（px）。押せる範囲を ::after で広げているものは、その分も足す */
  const height = (sel) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return 0
      const r = el.getBoundingClientRect()
      const a = getComputedStyle(el, '::after')
      const grow = a.content !== 'none' && a.position === 'absolute' ? -(parseFloat(a.top) || 0) - (parseFloat(a.bottom) || 0) : 0
      return Math.round(Math.max(r.height, r.height + grow))
    }, sel)
  /** 帯のようす：文字の大きさ（いちばん小さいもの）・ボタンの高さ・位置（紙面・ページ送り・下の道具と重ならないか）・横にはみ出していないか */
  const band = () =>
    page.evaluate(() => {
      const el = document.querySelector('.page-band')
      const pageEl = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current').getBoundingClientRect()
      const scrollX = document.documentElement.scrollWidth > innerWidth + 1
      if (!el) return { shown: false, scrollX, pageW: Math.round(pageEl.width) }
      const r = el.getBoundingClientRect()
      const texts = [...el.querySelectorAll('.t, .t small, p, button')].filter((e) => e.textContent.trim())
      const btn = el.querySelector('button').getBoundingClientRect()
      const bars = [...document.querySelectorAll('.pager, .sel-bar > *')].map((e) => e.getBoundingClientRect())
      const overlapsBar = bars.some((b) => b.top < r.bottom - 0.5 && b.bottom > r.top + 0.5 && b.left < r.right && b.right > r.left)
      return {
        shown: true,
        text: el.textContent,
        minFont: Math.min(...texts.map((e) => parseFloat(getComputedStyle(e).fontSize))),
        button: el.querySelector('button').textContent,
        buttonH: Math.round(btn.height),
        inside: r.left >= 0 && r.right <= innerWidth + 0.5 && r.top >= 0 && r.bottom <= innerHeight,
        belowPage: r.top >= pageEl.bottom - 0.5,
        rightOfPage: r.left >= pageEl.right - 0.5,
        overlapsBar,
        pageW: Math.round(pageEl.width),
        scrollX,
      }
    })

  // はじめての案内：「あとで入力する（案内を閉じる）」は高さ 44px 以上。案内の間は、帯を出さない
  await page.waitForSelector('.guide.step-course .g-opts button')
  await page.evaluate(() => document.querySelector('.g-opts button').click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.guide .g-later')
  await wait(300)
  const laterH = await height('.guide .g-later')
  const duringGuide = await band()
  check('案内の「あとで入力する（案内を閉じる）」は高さ 44px 以上。案内の間は、紙面の下の帯を出さない', laterH >= 44 && !duringGuide.shown, JSON.stringify({ laterH, duringGuide }))
  // 案内の最後（「表紙ができました」）まで進む（学籍番号・氏名・サブタイトルの欄を開いて閉じる）。「本文へ進む」「閉じる」は見た目も高さ 44px 以上
  for (const id of ['basic:studentId', 'basic:name', 'basic:subtitleInput']) {
    await page.evaluate((id) => window.__editor.openEditor(id, 0), id)
    await wait(300)
    await page.evaluate(() => window.__editor.finishEditing())
    await wait(300)
  }
  const doneStep = await page.waitForSelector('.guide .g-actions button', { timeout: 10000 }).then(() => true, () => false)
  const doneButtons = await page.evaluate(() => [...document.querySelectorAll('.guide .g-actions button')].map((b) => b.textContent.trim()))
  const doneH = await minVisibleHeight(page, '.guide .g-actions button')
  await page.screenshot({ path: `${OUT}/11b-guide-done.png` })
  check('案内の最後の「本文へ進む」「閉じる」は、見た目も高さ 44px 以上', doneStep && doneButtons.join(',') === '本文へ進む,閉じる' && doneH >= 44, JSON.stringify({ doneButtons, doneH }))
  if (doneStep) await page.evaluate(() => [...document.querySelectorAll('.guide .g-actions button')].find((b) => b.textContent.includes('閉じる')).click())
  else await page.evaluate(() => document.querySelector('.guide .g-later')?.click())
  await page.evaluate(() => window.__editor.finishEditing())
  await ready()

  // 見本の原稿：抄録はまだ（先生の許可が出る前）・作品写真は2枚（上下）で下の枠が空いている・本文に「見頃」（書き間違えやすい語のエラー。直し方を書き、「このままにする」は出ない）
  await page.evaluate(setupWriting)
  await page.evaluate(() =>
    window.__editor.update((r) => ({
      ...r,
      basicInfo: { ...r.basicInfo, studentId: '00ZZ0123' },
      abstract: { ...r.abstract, started: false },
      workPhotos: [{ layout: 2, columns: 1, imageIds: ['g-photo1', ''] }],
      body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === 'p7' ? { ...b, content: [{ type: 'text', text: '二回目の仮縫いでは、見頃の丈も確かめた。' }] } : b)) })),
    })),
  )
  await wait(500)
  await ready()

  // 抄録：説明と「先生の許可が出た（抄録を書き始める）」は帯に（ふつうの文字の大きさ・高さ 44px のボタン）。紙面の欄は「↓」の印だけ
  await showKind('abstract')
  const abs = await band()
  /** 抄録の印の向き（紙面の印と帯の印。CSS の回転の行列。回していなければ matrix(1, 0, 0, 1, …)、→ は matrix(0, -1, 1, 0, …)） */
  const markTurn = () =>
    page.evaluate(() => ({
      paper: getComputedStyle(document.querySelector('.page-viewport.front .abstract-lock'), '::after').transform,
      band: getComputedStyle(document.querySelector('.page-band .mk svg')).transform,
    }))
  const lock = await page.evaluate(() => {
    const el = document.querySelector('.page-viewport.front .abstract-lock')
    return { childrenHidden: [...el.children].every((c) => getComputedStyle(c).display === 'none'), mark: getComputedStyle(el, '::after').content !== 'none', h: Math.round(el.getBoundingClientRect().height) }
  })
  const portraitTurn = await markTurn()
  await page.screenshot({ path: `${OUT}/12-band-abstract.png` })
  check(
    '抄録：「先生の許可が出た（抄録を書き始める）」と説明は、紙面の下の帯にふつうの文字（13px 以上）で出て、ボタンは高さ 44px 以上。紙面には「↓」の印だけ',
    abs.shown && abs.text.includes('先生のチェックで許可が出てから') && abs.button === '先生の許可が出た（抄録を書き始める）' && abs.minFont >= 13 && abs.buttonH >= 44 && abs.belowPage && !abs.overlapsBar && abs.inside && !abs.scrollX && lock.childrenHidden && lock.mark,
    JSON.stringify({ abs, lock }),
  )

  // PDF・印刷に帯は入らない（帯は紙面の外の部品。印刷のときは出さず、紙面の案内も小さな印にしない）
  await page.emulateMediaType('print')
  const printed = await page.evaluate(() => ({ band: getComputedStyle(document.querySelector('.page-band')).display, mark: getComputedStyle(document.querySelector('.page-viewport.front .abstract-lock'), '::after').content }))
  await page.emulateMediaType(null)
  check('印刷（PDF）には、帯も紙面の印も出さない', printed.band === 'none' && printed.mark === 'none', JSON.stringify(printed))

  // スマホの紙面の仮の文字は「クリック」ではなく「タップ」（PC は「クリック」のまま。smoke.mjs）。画像（生地見本）を入れた表のセルには、仮の文字も「＋」の印も出さない
  const placeholderTexts = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.page-viewport.front [data-vivliostyle-page-container].is-current :is([data-placeholder]:empty, [data-photo-slot]:empty, .figure-slot)')]
        .map((el) => getComputedStyle(el, '::before').content)
        .filter((c) => c !== 'none' && c !== '""'),
    )
  // 表紙のサブタイトルと氏名を空にして（仮の文字が出る）確かめ、元に戻す
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, subtitleInput: '', name: '' } })))
  await ready()
  await page.evaluate(() => window.__editor.goToPage(0, 'none'))
  await ready()
  await wait(300)
  const coverWords = await placeholderTexts()
  // 表紙の題目（研究題目。学科で決まっていて書けない）をタップすると、画面の下にわけを知らせる（近くの欄は開かない。呼び方は紙面の見出しと同じ）
  const titleAt = await page.evaluate(() => {
    const r = document.querySelector('.page-viewport.front section.cover .el.title').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.touchscreen.tap(titleAt.x, titleAt.y)
  await wait(300)
  const titleTap = await page.evaluate(() => ({ notice: document.querySelector('.undo-area')?.textContent ?? '', editing: window.__editor.getSnapshot().editingId }))
  check('表紙の題目をタップすると「制作題目は、学科で決まっています（変えられません）」と画面の下に知らせる（書く欄は開かない）', titleTap.notice === '制作題目は、学科で決まっています（変えられません）' && !titleTap.editing, JSON.stringify(titleTap))
  await page.evaluate(() => window.__editor.undo())
  await ready()
  const tablePage = await page.evaluate(() => window.__editor.pageElements().findIndex((p) => p.querySelector('.data-table[data-table-id="t1"]')))
  await page.evaluate((i) => window.__editor.goToPage(i, 'none'), tablePage)
  await ready()
  await wait(300)
  const swatch = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.page-viewport.front .data-table[data-table-id="t1"] [data-cell-id]')].filter((c) => c.querySelector('img'))
    const marks = cells.flatMap((c) => [...c.querySelectorAll('[data-block-id]:empty')].flatMap((el) => [getComputedStyle(el, '::before').content, getComputedStyle(el, '::after').content]))
    return { cells: cells.length, marks: [...new Set(marks)], band: document.querySelector('.page-band')?.textContent ?? '' }
  })
  await page.screenshot({ path: `${OUT}/12b-swatch-cells.png` })
  check(
    'スマホの紙面の仮の文字は「タップして入力」など（「クリック」と出さない）',
    coverWords.length > 0 && coverWords.some((w) => w.includes('タップ')) && !coverWords.some((w) => w.includes('クリック')),
    JSON.stringify(coverWords),
  )
  check('生地見本の画像を入れた表のセルには、仮の文字（「（タップして入力）」）も「＋」の印も出さず、帯でも空いている所にしない', swatch.cells > 0 && swatch.marks.every((m) => m === 'none') && !swatch.band.includes('表のセル'), JSON.stringify(swatch))

  // 作品写真：空いている枠は「＋」の印だけ。帯に「下の枠に、まだ写真がありません」と「写真を選ぶ」。並べ方の道具とも重ならない
  await showKind('photos')
  const ph = await band()
  const slotMark = await page.evaluate(() => {
    const before = getComputedStyle(document.querySelector('.page-viewport.front [data-photo-slot="1"]'), '::before')
    return { content: before.content, w: before.width }
  })
  await page.screenshot({ path: `${OUT}/13-band-photo.png` })
  check(
    '作品写真：空いている枠は「＋」の印だけになり、帯に「下の枠に、まだ写真がありません」と「写真を選ぶ」（13px 以上・高さ 44px 以上。並べ方の道具に重ならない）',
    ph.shown && ph.text.includes('下の枠に、まだ写真がありません') && ph.button === '写真を選ぶ' && ph.minFont >= 13 && ph.buttonH >= 44 && ph.belowPage && !ph.overlapsBar && ph.inside && !ph.scrollX && !slotMark.content.includes('クリック'),
    JSON.stringify({ ph, slotMark }),
  )

  // 作品写真を押すと、下の道具にスイッチ「全体を入れる（切らない）」（mockups/v32 ③ 案A）。入れると枠の中に全体が入る
  await page.evaluate(() => window.__editor.select({ kind: 'photos', page: 0, index: 0 }))
  await wait(400)
  const swH = await height('.sel-bar .photo-sw')
  await page.tap('.sel-bar .photo-sw')
  await wait(300)
  await ready()
  const phoneWhole = await page.evaluate(() => ({ fit: getComputedStyle(document.querySelector('.page-viewport.front [data-photo-slot="0"] img')).objectFit, checked: document.querySelector('.sel-bar .photo-sw')?.getAttribute('aria-checked'), whole: window.__editor.getSnapshot().report.workPhotos[0].whole }))
  await page.screenshot({ path: `${OUT}/14-photo-whole.png` })
  check('スマホ：写真を押すと下の道具にスイッチ「全体を入れる（切らない）」が出て（高さ 44px 以上）、入れると枠の中に全体が入る', swH >= 44 && phoneWhole.fit === 'contain' && phoneWhole.checked === 'true' && phoneWhole.whole?.[0] === true, JSON.stringify({ swH, phoneWhole }))
  await page.evaluate(() => window.__editor.select(null))
  await wait(300)

  // まだ書いていない欄：ひな形の段落は「ここに何を書くか」を帯に出し、「書く」でその段落を書き始める（書く欄にも出す）
  await page.evaluate(() =>
    window.__editor.update((r) => ({ ...r, body: [...r.body, { id: 'c-band', title: 'おわりに', blocks: [{ type: 'paragraph', id: 'p-band', content: [{ type: 'text', text: '' }], hint: '制作を振り返り、できたこと・課題を書く' }] }] })),
  )
  await wait(400)
  await ready()
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('p-band'), 'none'))
  await ready()
  await wait(300)
  const fields = await band()
  const fieldMark = await page.evaluate(() => {
    const el = document.querySelector('.page-viewport.front [data-block-id="p-band"]')
    return { text: getComputedStyle(el, '::before').color, mark: getComputedStyle(el, '::after').content !== 'none' }
  })
  await page.screenshot({ path: `${OUT}/15-band-fields.png` })
  await page.tap('.page-band button')
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p-band', { timeout: 20000 }).catch(() => {})
  await wait(400)
  const writing = await page.evaluate(() => ({ id: window.__editor.getSnapshot().editingId, hint: document.querySelector('.edit-sheet .es-hint')?.textContent ?? '', band: !!document.querySelector('.page-band'), done: document.querySelector('.edit-sheet .done').getBoundingClientRect().height }))
  check(
    'まだ書いていない段落：紙面の小さな仮の文字は「＋」の印にし、帯に「ここに何を書くか」（13px 以上）。「書く」でその段落を書き始め、書く欄にも出る（帯は隠れる）',
    fields.shown && fields.text.includes('制作を振り返り、できたこと・課題を書く') && fields.button === '書く' && fields.minFont >= 13 && fields.buttonH >= 44 && fieldMark.mark && fieldMark.text === 'rgba(0, 0, 0, 0)' && writing.id === 'p-band' && writing.hint.includes('制作を振り返り') && !writing.band,
    JSON.stringify({ fields, fieldMark, writing }),
  )
  check('書く欄の「完了」は高さ 44px 以上', writing.done >= 44, `${writing.done}px`)
  const toolsH = await minVisibleHeight(page, '.edit-sheet .es-tools button')
  const toolNames = await page.evaluate(() => [...document.querySelectorAll('.edit-sheet .es-tools button')].map((b) => b.textContent.trim()))
  await page.screenshot({ path: `${OUT}/15b-sheet-tools-44.png` })
  check('書く欄の道具（図を入れる・表を入れる・削除・戻すなど）は、見た目も高さ 44px 以上', toolsH >= 44 && ['図を入れる', '表を入れる', '削除', '戻す'].every((n) => toolNames.includes(n)), JSON.stringify({ toolsH, toolNames }))
  await page.click('.edit-sheet .done')
  await ready()

  // ページ送り・「ページ全体に戻す」・使い方の「引用・参考文献を入れる」は高さ 44px 以上
  const pagerH = await height('.pager button')
  await page.evaluate(() => window.__editor.setZoom(true))
  await wait(300)
  const unzoomH = await height('.unzoom')
  // 拡大したまま、ページ一覧からほかのページ（作品写真）へ移ると、ページ全体の表示に戻り、ページ送りと帯が出る
  // （前は拡大したままで、作品写真のページは白い所しか見えず、ページ送りと帯も隠れたままだった）
  await page.click('.p-nav button:nth-child(1)')
  await page.waitForSelector('.sheet .thumb-list .t')
  await page.evaluate(() => document.querySelectorAll('.sheet .thumb-list .t')[window.__editor.getSnapshot().layout.kinds.indexOf('photos')].click())
  await ready()
  await wait(500)
  const movedZoomed = await page.evaluate(() => {
    const s = window.__editor.getSnapshot()
    const pageEl = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current').getBoundingClientRect()
    return { kind: s.layout.kinds[s.page], zoomed: s.zoomed, pager: !!document.querySelector('.pager'), band: !!document.querySelector('.page-band'), wholePage: pageEl.top >= 0 && pageEl.bottom <= innerHeight }
  })
  await page.screenshot({ path: `${OUT}/16a-moved-after-zoom.png` })
  check('スマホ：拡大したままほかのページへ移ると、ページ全体の表示に戻り、ページ送りと帯が出る', movedZoomed.kind === 'photos' && !movedZoomed.zoomed && movedZoomed.pager && movedZoomed.band && movedZoomed.wholePage, JSON.stringify(movedZoomed))
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('p1'), 'none'))
  await ready()
  // 「追加」の欄に「＋ 引用・参考文献を入れる」はない（使い方の「引用・参考文献」から入れる。mockups/v35 ①）
  await page.click('.p-nav .add')
  await page.waitForSelector('.sheet .add-grid')
  const addHasRefs = !!(await page.$('.sheet .add-refs'))
  // 引用・参考文献の窓：ボタン（「削除」「＋ 書籍を追加」「やめる」「反映する」など）と種類の選択は、見た目も高さ 44px 以上
  const { h: refsH, helpClosed: refsHelpClosed } = await openRefs(page)
  await page.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.includes('書籍を追加')).click())
  await wait(300)
  const refsDialog = await page.evaluate(() => [...document.querySelectorAll('.modal button, .modal select')].map((b) => `${b.textContent.trim().slice(0, 8)}:${Math.round(b.getBoundingClientRect().height)}`))
  const refsDialogH = await minVisibleHeight(page, '.modal button, .modal select')
  await page.screenshot({ path: `${OUT}/16b-refs-dialog-44.png` })
  await page.evaluate(() => [...document.querySelectorAll('.modal .row-buttons button')].find((b) => b.textContent === 'やめる').click())
  await wait(300)
  check('引用・参考文献の窓のボタン（削除・＋書籍を追加・やめる・反映するなど）と種類の選択は、見た目も高さ 44px 以上', refsDialogH >= 44 && refsDialog.length >= 6, JSON.stringify(refsDialog))
  await page.evaluate(() => [...document.querySelectorAll('.p-nav button')].find((b) => b.textContent.includes('チェック')).click())
  await page.waitForSelector('.sheet .issue')
  await wait(300)
  // チェックの欄の指摘：「直す」のボタンはなく、直し方を書く。先生が決めた書き間違えやすい語のエラー（見頃）は「このままにする」にできない
  const phoneIssues = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.sheet .issue')]
    const mikoro = rows.find((li) => li.textContent.includes('「見頃」ではなく「身頃」と書く'))
    return {
      fix: document.querySelectorAll('.sheet .issue .fix').length,
      fixText: rows.flatMap((li) => [...li.querySelectorAll('button')]).filter((b) => b.textContent.trim() === '直す').length,
      mikoro: mikoro ? { error: mikoro.classList.contains('error'), detail: mikoro.querySelector('.detail')?.textContent ?? '', keep: !!mikoro.querySelector('.keep') } : null,
    }
  })
  await page.screenshot({ path: `${OUT}/16-buttons-44.png` })
  await page.click('.sheet-close')
  await wait(300)
  check('ページ送り・「ページ全体に戻す」・使い方の「引用・参考文献を入れる」は、高さ 44px 以上', pagerH >= 44 && unzoomH >= 44 && refsH >= 44, JSON.stringify({ pagerH, unzoomH, refsH }))
  check('スマホ：「追加」の欄に「＋ 引用・参考文献を入れる」はなく、使い方の「引用・参考文献」のボタンで窓が開く（使い方の欄は閉じる）', !addHasRefs && refsHelpClosed, JSON.stringify({ addHasRefs, refsHelpClosed }))
  check(
    'スマホのチェックの欄にも「直す」のボタンはなく、直し方を書く。「見頃」（書き間違えやすい語のエラー）は「このままにする」が出ない',
    phoneIssues.fix === 0 && phoneIssues.fixText === 0 && phoneIssues.mikoro?.error && phoneIssues.mikoro.detail.startsWith('「見頃」→「身頃」') && !phoneIssues.mikoro.keep,
    JSON.stringify(phoneIssues),
  )

  // 横向き（844×390）：帯は紙面の右。紙面は小さくなりすぎず、画面は横にはみ出さない
  await page.setViewport(LANDSCAPE)
  await wait(800)
  await ready()
  await showKind('abstract')
  const land = await band()
  await page.screenshot({ path: `${OUT}/17-band-landscape.png` })
  check(
    '横向き：抄録の帯は紙面の右に出て（13px 以上・高さ 44px のボタン）、紙面は幅 140px 以上のまま。画面は横にはみ出さない',
    land.shown && land.rightOfPage && land.inside && land.minFont >= 13 && land.buttonH >= 44 && land.pageW >= 140 && !land.scrollX,
    JSON.stringify(land),
  )
  // 横向きでは帯が紙面の右なので、抄録の印は「→」（縦向きは「↓」）。紙面の印も帯の印も
  const landTurn = await markTurn()
  const turned = (m) => /^matrix\(\s*0(\.0+)?,\s*-1,\s*1,\s*0(\.0+)?,/.test(m)
  const upright = (m) => m === 'none' || /^matrix\(\s*1,\s*0,\s*0,\s*1,/.test(m)
  check('抄録の印（紙面・帯）は、縦向きは「↓」、帯が紙面の右に出る横向きは「→」', upright(portraitTurn.paper) && upright(portraitTurn.band) && turned(landTurn.paper) && turned(landTurn.band), JSON.stringify({ portraitTurn, landTurn }))
  await showKind('photos')
  const landPhoto = await band()
  check('横向き：作品写真の帯も紙面の右で、画面の中に収まり、下の道具に重ならない', landPhoto.shown && landPhoto.rightOfPage && landPhoto.inside && !landPhoto.overlapsBar && !landPhoto.scrollX, JSON.stringify(landPhoto))
  // 横向き：作品写真を外したときの知らせも、ページ送り・下の道具・紙面の右の帯に重ならない（戻すと写真も戻る）
  // （横向きでは、選んだ写真の道具は紙面の右の列に出る。mockups/v33 案A）
  await page.evaluate(() => window.__editor.select({ kind: 'photos', page: 0, index: 0 }))
  await wait(300)
  await page.evaluate(() => [...document.querySelectorAll('.page-side .tb')].find((b) => b.textContent.includes('外す')).click())
  await ready()
  await wait(400)
  const landUndo = await undoPlacement(page)
  await page.screenshot({ path: `${OUT}/17b-undo-landscape.png` })
  await page.click('.undo-toast button')
  await ready()
  await wait(300)
  const photoBack = await page.evaluate(() => window.__editor.getSnapshot().report.workPhotos[0].imageIds[0])
  check('横向き：作品写真を外したときの知らせは、ページ送り・下の道具・紙面の右の帯に重ならない（［戻す］で戻る）', landUndo.shown && landUndo.covers.length === 0 && landUndo.inside && landUndo.buttonH >= 44 && photoBack === 'g-photo1', JSON.stringify({ landUndo, photoBack }))
  await page.evaluate(() => window.__editor.select(null))
  await wait(300)
  await page.setViewport(PORTRAIT)
  await wait(800)
  await ready()

  // 帯のボタンで、紙面のボタンと同じことができる：「写真を選ぶ」で写真を選ぶ画面が開き、入れると帯が消える。「先生の許可が出た」で抄録を書き始める
  await showKind('photos')
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(300, 400)
    const g = c.getContext('2d')
    g.fillStyle = '#4a6a8a'
    g.fillRect(0, 0, 300, 400)
    const blob = await c.convertToBlob({ type: 'image/png' })
    return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())))
  })
  const { writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const pngPath = join(tmpdir(), 'sotsugyo-e2e-band.png')
  writeFileSync(pngPath, Buffer.from(png, 'base64'))
  const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 10000 }), page.tap('.page-band button')])
  await chooser.accept([pngPath])
  await page.waitForFunction(() => !!window.__editor.getSnapshot().report.workPhotos[0].imageIds[1], { timeout: 20000 })
  await ready()
  await wait(300)
  const afterPhoto = await band()
  check('帯の「写真を選ぶ」で写真を選ぶ画面が開き、写真を入れると帯が消える', !afterPhoto.shown, JSON.stringify(afterPhoto))
  await showKind('abstract')
  await page.tap('.page-band button')
  await wait(400)
  await ready()
  const started = await page.evaluate(() => ({ started: window.__editor.getSnapshot().report.abstract.started, lock: !!document.querySelector('.page-viewport.front .abstract-lock') }))
  check('帯の「先生の許可が出た（抄録を書き始める）」で、抄録を書き始められる（紙面の案内も消える）', started.started === true && !started.lock, JSON.stringify(started))
  await context.close()
}

/**
 * iPhone で「PDFを書き出す」：作り終えたら、もう一度「保存する」を押して共有の画面から保存する（作るのに数秒かかり、最初のタップでは開けないため）。
 * 共有の画面（navigator.share）は偽物にする：1回目はやめる（AbortError）、2回目は保存できる、3回目は開けない（ダウンロードに切り替える）
 */
async function iphoneShareCheck(browser) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await noHotReload(page)
  await stubConfig(page)
  page.on('pageerror', (e) => console.log('pageerror(share):', e.message))
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  })
  const downloads = resolve(`${OUT}/share-downloads`)
  rmSync(downloads, { recursive: true, force: true })
  mkdirSync(downloads, { recursive: true })
  await (await page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, browserContextId: context.id })
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0' })
  const ready = () =>
    page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && s.sheet && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 60000 })
  await ready()
  await page.waitForSelector('.guide.step-course .g-opts button')
  await page.evaluate(() => document.querySelector('.g-opts button').click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.g-later')
  await page.evaluate(() => document.querySelector('.g-later').click())
  await ready()
  await page.evaluate(() => {
    window.__shares = []
    navigator.canShare = () => true
    navigator.share = (data) => {
      const f = data.files[0]
      window.__shares.push(`${f.name}|${f.type}`)
      const n = window.__shares.length
      return n === 1 ? Promise.reject(new DOMException('やめた', 'AbortError')) : n === 2 ? Promise.resolve() : Promise.reject(new DOMException('開けない', 'NotAllowedError'))
    }
  })
  const title = await page.evaluate(() => window.__editor.pdfTitle)
  await page.click('.p-nav .nav-pdf')
  await page.waitForSelector('.modal .pdf-start')
  // 直すところ・まだのところが残っていても、ふつうの「PDF を作る」（保存は、できたあとに押す）。下書きの PDF はない
  const startInfo = await page.evaluate(() => ({ start: document.querySelector('.modal .pdf-start')?.textContent, list: !!document.querySelector('.modal .pdf-left'), old: !!document.querySelector('.modal .draft-box, .modal .pdf-draft, .modal .checklist') }))
  check('iPhone：直すところ・まだのところが残っていても、ボタンはふつうの「PDF を作る」（保存は、できたあとに押す。下書きの PDF はない）', startInfo.start === 'PDF を作る' && startInfo.list && !startInfo.old, JSON.stringify(startInfo))
  // 「直しに戻る」「PDF を作る」・「うまくいかないとき：印刷の画面から保存」も、見た目の高さ 44px 以上
  const pdfStartH = { back: await minVisibleHeight(page, '.modal .row-buttons button:not(.pdf-fallback)'), print: await minVisibleHeight(page, '.modal .row-buttons .pdf-fallback') }
  const backLabels = await page.$$eval('.modal .row-buttons button', (bs) => bs.map((b) => b.textContent))
  await page.screenshot({ path: `${OUT}/10b-pdf-start-44.png` })
  check('PDF の窓の「直しに戻る」「PDF を作る」「うまくいかないとき：印刷の画面から保存」は、見た目も高さ 44px 以上', backLabels.includes('直しに戻る') && pdfStartH.back >= 44 && pdfStartH.print >= 44, JSON.stringify({ pdfStartH, backLabels }))
  await page.tap('.modal .pdf-start')
  await page.waitForSelector('.modal .pdf-save', { timeout: 120000 })
  await wait(300)
  const made = await page.evaluate(() => ({ title: document.querySelector('.modal h2')?.textContent, save: document.querySelector('.modal .pdf-save')?.textContent, thumbs: document.querySelectorAll('.modal .pdf-thumbs img').length, shares: window.__shares.length }))
  await page.screenshot({ path: `${OUT}/11-pdf-share.png` })
  check('iPhone：できたら「PDF ができました」と大きな「保存する」を出す（まだ保存しない・共有の画面も開かない）', made.title === 'PDF ができました' && made.save === '保存する' && made.thumbs > 0 && made.shares === 0 && readdirSync(downloads).length === 0, JSON.stringify(made))
  // 文字のリンクの「PDF を開く」と「閉じる」も、見た目の高さ 44px 以上（前は「PDF を開く」が高さ 12px ほどだった）
  const pdfDoneH = { open: await minVisibleHeight(page, '.modal .row-buttons .pdf-fallback'), close: await minVisibleHeight(page, '.modal .row-buttons button:not(.pdf-fallback)') }
  check('できたあとの「PDF を開く」（文字のリンク）と「閉じる」は、見た目も高さ 44px 以上', pdfDoneH.open >= 44 && pdfDoneH.close >= 44, JSON.stringify(pdfDoneH))
  await page.tap('.modal .pdf-save')
  await wait(300)
  const cancelled = await page.evaluate(() => ({ save: document.querySelector('.modal .pdf-save')?.textContent, shares: [...window.__shares] }))
  check('「保存する」で共有の画面を開き（ファイル名・PDF）、やめても「保存する」がそのまま押せる', cancelled.save === '保存する' && cancelled.shares[0] === `${title}.pdf|application/pdf`, JSON.stringify(cancelled))
  await page.tap('.modal .pdf-save')
  await wait(300)
  const shared = await page.evaluate(() => ({ save: document.querySelector('.modal .pdf-save')?.textContent, lead: document.querySelector('.modal .lead')?.textContent ?? '', shares: window.__shares.length }))
  check('もう一度「保存する」を押して保存すると「保存しました」と出る', shared.shares === 2 && shared.lead.startsWith('保存しました') && shared.save === 'もう一度保存する', JSON.stringify(shared))
  // 共有の画面が開けなかったとき（やめた以外の理由）は、ダウンロードに切り替える
  await page.tap('.modal .pdf-save')
  for (let i = 0; i < 40 && !readdirSync(downloads).some((n) => n.endsWith('.pdf')); i++) await wait(250)
  check('共有の画面を開けなかったときは、ダウンロードに切り替えて知らせる', readdirSync(downloads).includes(`${title}.pdf`) && (await page.$eval('.modal .lead', (e) => e.textContent)).includes('ダウンロードしました'), readdirSync(downloads).join(','))
  await context.close()
}

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

/**
 * はじめて使う学生の試し（v32 のあと）で見つかったこと（スマホ）：
 * - 横向き（紙面の幅が 160px ほど）で、空の段落の「＋」の印をタップすると、その段落が開く（前は、上の見出し「まとめ」の途中が開いていた）
 * - 表のタイトルをタップすると、まず表を選び、下に「この表」の「削除」が出る（書く欄には表を消す道具がない）。もう一度タップでタイトルを書く
 * - 2行の表で「行を消す」を押すと、わけと、表ごと消す方法が画面の下に出る（前は何も起きなかった）
 * - 抄録の「先生の許可が出た」のあと、画面の下に「抄録を書き始めました［戻す］」が出て、［戻す］で書き始める前に戻る
 */
async function firstTimeFixesPhone(browser) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await noHotReload(page)
  await stubConfig(page)
  page.on('pageerror', (e) => console.log('pageerror(firsttime):', e.message))
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  })
  const PORTRAIT = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  const LANDSCAPE = { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
  await page.setViewport(PORTRAIT)
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0' })
  const ready = () =>
    page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && s.sheet && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 60000 })
  await ready()
  // はじめての案内は「あとで入力する」で閉じる
  await page.waitForSelector('.guide.step-course .g-opts button')
  await page.evaluate(() => document.querySelector('.g-opts button').click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.guide .g-later')
  await page.evaluate(() => document.querySelector('.guide .g-later').click())
  await page.evaluate(() => window.__editor.finishEditing())
  await ready()
  // 見本の原稿：「まとめ」のすぐ下に、ひな形の説明のある空の段落。最後に2行・1列の表。抄録はまだ（先生の許可が出る前）
  const { setupWriting } = await import('./sampleReport.mjs')
  await page.evaluate(setupWriting)
  await page.evaluate(() =>
    window.__editor.update((r) => ({
      ...r,
      basicInfo: { ...r.basicInfo, studentId: '00ZZ0123' },
      abstract: { ...r.abstract, started: false },
      body: r.body.map((c) =>
        c.id === 'c3'
          ? {
              ...c,
              blocks: [
                { type: 'paragraph', id: 'pE', content: [{ type: 'text', text: '' }], hint: '完成した作品を振り返り、できたこと・課題を書く' },
                ...c.blocks,
                { type: 'paragraph', id: 'pT', content: [{ type: 'text', text: '糸の色を' }, { type: 'ref', targetId: 'tM', withParens: false }, { type: 'text', text: 'にまとめる。' }] },
                { type: 'table', id: 'tM', caption: '糸', widths: 'equal', rows: [{ id: 'tr1', cells: [{ id: 'tc1', text: '色', imageId: null }] }, { id: 'tr2', cells: [{ id: 'tc2', text: '金', imageId: null }] }] },
              ],
            }
          : c,
      ),
    })),
  )
  await wait(500)
  await ready()
  const showBlock = async (id) => {
    await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), id)
    await ready()
    await wait(400)
  }
  const snap = () => page.evaluate(() => { const s = window.__editor.getSnapshot(); return { editingId: s.editingId, editingKind: s.editingKind, selection: s.selection, started: s.report.abstract.started } })

  // 横向き：空の段落の「＋」の印をタップすると、その段落が開く（上の見出しではなく）
  await page.setViewport(LANDSCAPE)
  await wait(800)
  await ready()
  await showBlock('pE')
  const mark = await page.evaluate(() => {
    const p = document.querySelector('.page-viewport.front [data-block-id="pE"]')
    const r = p.getBoundingClientRect()
    const after = getComputedStyle(p, '::after')
    const pageW = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current').getBoundingClientRect().width
    // 印は段落の始め（左端、1行目の高さの真ん中）
    const line = parseFloat(getComputedStyle(p).lineHeight) * (r.width / p.offsetWidth || 1)
    return { x: r.left + 4, y: r.top + Math.max(2, line / 2), marked: after.content !== 'none' && after.content !== 'normal', pageW: Math.round(pageW) }
  })
  await page.touchscreen.tap(mark.x, mark.y)
  await page.waitForFunction(() => !!window.__editor.getSnapshot().editingId, { timeout: 20000 }).catch(() => {})
  await wait(300)
  const landTap = await snap()
  await page.screenshot({ path: `${OUT}/18-land-plus-tap.png` })
  check('横向き（紙面の幅 160px ほど）で、空の段落の「＋」の印をタップすると、その段落が開く（上の見出しが開かない）', mark.marked && landTap.editingId === 'pE', JSON.stringify({ mark, landTap }))
  await page.evaluate(() => window.__editor.finishEditing())
  await ready()
  await page.setViewport(PORTRAIT)
  await wait(800)
  await ready()

  // 表のタイトルをタップ：まず表を選び、下に「この表」の「削除」が出る。もう一度タップすると、タイトルを書く
  await showBlock('tM')
  const captionAt = () => page.evaluate(() => { const r = document.querySelector('.page-viewport.front [data-block-id="tM"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  let at = await captionAt()
  await page.touchscreen.tap(at.x, at.y)
  await wait(500)
  const selected = { ...(await snap()), bar: await page.evaluate(() => [...document.querySelectorAll('.sel-bar .tb, .sel-bar .ctx-label')].map((b) => b.textContent.trim())) }
  await page.screenshot({ path: `${OUT}/18b-table-title-tap.png` })
  check('スマホ：表のタイトルをタップすると、表を選び、下に「この表」の「削除」が出る（書く欄は開かない）', selected.selection?.kind === 'table' && selected.selection.id === 'tM' && !selected.editingId && selected.bar.includes('この表') && selected.bar.includes('削除'), JSON.stringify(selected))
  at = await captionAt()
  await page.touchscreen.tap(at.x, at.y)
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'tM', { timeout: 20000 }).catch(() => {})
  check('選んでいる表のタイトルをもう一度タップすると、タイトルを書ける', (await snap()).editingKind === 'tableCaption')
  await page.evaluate(() => window.__editor.finishEditing())
  await ready()

  // 2行の表のセルを書いているときに「行を消す」：わけと、表ごと消す方法（閉じてからタイトルをタップ→「この表」の「削除」）が画面の下に出る
  await showBlock('tc2')
  const cellAt = await page.evaluate(() => { const r = document.querySelector('.page-viewport.front [data-cell-id="tc2"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  await page.touchscreen.tap(cellAt.x, cellAt.y)
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'tc2', { timeout: 20000 })
  await wait(300)
  await page.evaluate(() => [...document.querySelectorAll('.edit-sheet .es-tools button')].find((b) => b.textContent.includes('行を消す')).click())
  await wait(300)
  const rowNote = {
    ...(await page.evaluate(() => {
      const toast = document.querySelector('.undo-toast')
      const t = toast?.getBoundingClientRect()
      const sheet = document.querySelector('.edit-sheet.open')?.getBoundingClientRect()
      return { text: toast?.textContent ?? '', aboveSheet: !!t && !!sheet && t.bottom <= sheet.top + 0.5 && t.top >= 0 }
    })),
    ...(await snap()),
  }
  await page.screenshot({ path: `${OUT}/18c-table-row-note.png` })
  check(
    'スマホ：2行の表で「行を消す」を押すと、わけと表ごと消す方法（書く欄の「この表を削除」）が書く欄の上に出る（書く欄はそのまま）',
    rowNote.text.includes('見出しの行ともう1行が要ります') && rowNote.text.includes('書く欄の「この表を削除」') && rowNote.editingId === 'tc2' && rowNote.aboveSheet,
    JSON.stringify(rowNote),
  )
  // 書く欄の「この表を削除」：表ごと消え、書く欄が閉じて、画面の下に「表を削除しました［戻す］」。［戻す］で戻る
  // （前は、閉じてから表のタイトル（ページ全体の表示では高さ 7px ほど）をタップするしかなかった）
  const delTool = await page.evaluate(() => { const b = [...document.querySelectorAll('.edit-sheet .es-tools button')].find((x) => x.textContent.includes('この表を削除')); const r = b?.getBoundingClientRect(); return { shown: !!b, h: r ? Math.round(r.height) : 0, danger: !!b?.classList.contains('danger') } })
  await page.evaluate(() => [...document.querySelectorAll('.edit-sheet .es-tools button')].find((b) => b.textContent.includes('この表を削除')).click())
  await ready()
  await wait(300)
  const tableDeleted = await page.evaluate(() => ({
    gone: !window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).some((b) => b.id === 'tM'),
    toast: document.querySelector('.undo-toast')?.textContent ?? '',
    button: !!document.querySelector('.undo-toast button'),
    sheet: !!document.querySelector('.edit-sheet.open'),
    zoomed: window.__editor.getSnapshot().zoomed,
  }))
  await page.screenshot({ path: `${OUT}/18c2-table-deleted-from-cell.png` })
  await page.tap('.undo-toast button')
  await ready()
  const tableBack = await page.evaluate(() => window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).some((b) => b.id === 'tM'))
  check(
    'スマホ：表のセルを書いているとき、書く欄の「この表を削除」で表ごと消え、書く欄が閉じて「表を削除しました［戻す］」が出る（［戻す］で戻る。ボタンは高さ 44px 以上）',
    delTool.shown && delTool.danger && delTool.h >= 44 && tableDeleted.gone && tableDeleted.toast.includes('表を削除しました') && tableDeleted.button && !tableDeleted.sheet && !tableDeleted.zoomed && tableBack,
    JSON.stringify({ delTool, tableDeleted, tableBack }),
  )
  await page.evaluate(() => window.__editor.finishEditing())
  await ready()

  // ---- はじめて使う学生の試し（2回目）で見つかったこと（スマホ） ----
  // 書く欄を開いたまま、下の「追加」を1回押すと、書く欄が閉じて「追加」の欄が開く（前は1回目で書く欄が閉じるだけだった）
  await showBlock('p1')
  const p1At = await page.evaluate(() => { const r = document.querySelector('.page-viewport.front [data-block-id="p1"]').getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 } })
  await page.touchscreen.tap(p1At.x, p1At.y)
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p1', { timeout: 20000 })
  await wait(400)
  const navAdd = await page.evaluate(() => {
    const b = document.querySelector('.p-nav .add')
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, onTop: b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)), sheetOpen: !!document.querySelector('.edit-sheet.open') }
  })
  await page.screenshot({ path: `${OUT}/19-sheet-and-tabs.png` })
  await page.touchscreen.tap(navAdd.x, navAdd.y)
  await wait(500)
  const oneTap = await page.evaluate(() => ({ sheet: document.querySelector('.sheet h2')?.textContent ?? '', editing: window.__editor.getSnapshot().editingId, open: !!document.querySelector('.edit-sheet.open') }))
  await page.screenshot({ path: `${OUT}/19b-add-one-tap.png` })
  check('スマホ：書く欄を開いているときも下のタブは隠れず、「追加」を1回押すと、書く欄が閉じて「追加」の欄が開く', navAdd.sheetOpen && navAdd.onTop && oneTap.sheet === '追加' && !oneTap.editing && !oneTap.open, JSON.stringify({ navAdd, oneTap }))
  // 「追加」の欄・ページ一覧の欄の「×」は 44px 四方以上
  const closeBox = () => page.evaluate(() => { const r = document.querySelector('.sheet .sheet-close').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })
  const addClose = await closeBox()
  // 引用・参考文献の窓：書いた内容があるまま「×」を押すと、窓の中で聞く（「反映せずに閉じる」で閉じ、反映しない。ボタンは高さ 44px 以上）
  await openRefs(page)
  await page.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.includes('書籍を追加')).click())
  await wait(200)
  await page.tap('.modal .ref-card .field:first-child input')
  await page.keyboard.type('浜松隆志')
  await page.tap('.modal .close')
  await wait(300)
  const phoneAsk = await page.evaluate(() => ({
    modal: !!document.querySelector('.modal'),
    ask: document.querySelector('.ref-ask-q')?.textContent ?? '',
    buttons: [...document.querySelectorAll('.ref-ask button')].map((b) => `${b.textContent.trim()}:${Math.round(b.getBoundingClientRect().height)}`),
  }))
  await page.screenshot({ path: `${OUT}/19c-refs-ask.png` })
  await page.evaluate(() => [...document.querySelectorAll('.ref-ask button')].find((b) => b.textContent.trim() === '反映せずに閉じる').click())
  await wait(300)
  const phoneDiscard = await page.evaluate(() => ({ modal: !!document.querySelector('.modal'), refs: window.__editor.getSnapshot().report.references.length }))
  check(
    'スマホ：引用・参考文献の窓で書いたまま「×」を押すと、窓の中で「書いた内容を反映せずに閉じますか？」と聞き（ボタンは高さ 44px 以上）、「反映せずに閉じる」で閉じる（反映しない）',
    phoneAsk.modal && phoneAsk.ask === '書いた内容を反映せずに閉じますか？' && phoneAsk.buttons.length === 3 && phoneAsk.buttons.every((b) => Number(b.split(':').at(-1)) >= 44) && !phoneDiscard.modal && phoneDiscard.refs === 0,
    JSON.stringify({ phoneAsk, phoneDiscard }),
  )
  await page.evaluate(() => [...document.querySelectorAll('.p-nav button')].find((b) => b.textContent.includes('ページ一覧')).click())
  await page.waitForSelector('.sheet .sheet-close')
  const pagesClose = await closeBox()
  await page.tap('.sheet .sheet-close')
  await wait(300)
  // 書く欄を開いたときに拡大した紙面を、ページ全体の表示に戻す
  await page.evaluate(() => window.__editor.setZoom(false))
  await ready()
  // 選んでいる表・図の下の道具：「列の幅」（いまの幅を出すボタン1つ。押すと切り替わる）・「削除」などは、幅も高さも 44px 以上。道具は画面の中に入る
  const selTools = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.sel-bar button')].map((b) => {
        const r = b.getBoundingClientRect()
        return { name: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), inside: r.left >= 0 && r.right <= innerWidth }
      }),
    )
  await page.evaluate(() => window.__editor.select({ kind: 'table', id: 'tM' }))
  await wait(400)
  const tableTools = await selTools()
  await page.screenshot({ path: `${OUT}/19d-table-tools-44.png` })
  await page.evaluate(() => document.querySelector('.sel-bar .width-toggle').click())
  await ready()
  await wait(300)
  const toggled = { widths: await page.evaluate(() => window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === 'tM').widths), tools: await selTools() }
  await page.evaluate(() => window.__editor.select({ kind: 'figure', id: 'f1' }))
  await wait(400)
  const figureTools = await selTools()
  await page.evaluate(() => window.__editor.select(null))
  await wait(200)
  const big = (list) => list.length > 0 && list.every((t) => t.w >= 44 && t.h >= 44 && t.inside)
  check(
    'スマホ：表・図を選んだときの下の道具（「列の幅」・「削除」など）は幅も高さも 44px 以上で、画面の中に入る。「列の幅」は押すたびに「そろえる」「中身に合わせる」が切り替わる。「追加」「ページ一覧」の「×」は 44px 四方以上',
    big(tableTools) && tableTools.some((t) => t.name === '列の幅そろえる') && toggled.widths === 'auto' && big(toggled.tools) && toggled.tools.some((t) => t.name === '列の幅中身に合わせる') && big(figureTools) && figureTools.some((t) => t.name === '削除') && addClose.w >= 44 && addClose.h >= 44 && pagesClose.w >= 44 && pagesClose.h >= 44,
    JSON.stringify({ tableTools, toggled, figureTools, addClose, pagesClose }),
  )
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === 'tM' ? { ...b, widths: 'equal' } : b)) })) })))
  await ready()

  // 章の最後の小見出しの下にも「＋ ここに続きを書く」（高さ 44px）。押すと、見出しのすぐ後ろに段落ができ、下の書く欄ですぐ書ける
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, body: [...r.body, { id: 'cH', title: '補足', blocks: [{ type: 'subheading', id: 'sH', title: '追記' }] }] })))
  await ready()
  await showBlock('sH')
  const phoneHeadRow = await page.evaluate(() => {
    const b = document.querySelector('.continue-row')
    const r = b.getBoundingClientRect()
    const h = document.querySelector('.page-viewport.front [data-block-id="sH"]').closest('h2').getBoundingClientRect()
    return { shown: !b.hidden && r.height > 0, h: Math.round(r.height), below: r.top >= h.bottom, x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.screenshot({ path: `${OUT}/19e-heading-row.png` })
  await page.touchscreen.tap(phoneHeadRow.x, phoneHeadRow.y)
  await page.waitForFunction(() => window.__editor.getSnapshot().editingKind === 'paragraph', { timeout: 20000 }).catch(() => {})
  await wait(300)
  const fromHeadRow = await page.evaluate(() => { const s = window.__editor.getSnapshot(); const c = s.report.body.find((x) => x.id === 'cH'); return { editing: s.editingId, sheet: !!document.querySelector('.edit-sheet.open'), blocks: c.blocks.map((b) => b.id) } })
  check(
    'スマホ：章の最後の小見出しの下にも「＋ ここに続きを書く」（高さ 44px 以上）が出て、押すと見出しのすぐ後ろに段落ができ、下の書く欄で書ける',
    phoneHeadRow.shown && phoneHeadRow.h >= 44 && phoneHeadRow.below && fromHeadRow.sheet && fromHeadRow.blocks.length === 2 && fromHeadRow.editing === fromHeadRow.blocks[1],
    JSON.stringify({ phoneHeadRow, fromHeadRow }),
  )
  await page.evaluate(() => window.__editor.finishEditing())
  await ready()
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, body: r.body.filter((c) => c.id !== 'cH') })))
  await ready()

  // 横向き：空の段落の「＋」の印は、段落の左の余白（上の見出しの文字に重ならない）。印の上の方・印のまわりを押してもその段落が開き、見出しの文字を押せば見出しが開く
  await page.setViewport(LANDSCAPE)
  await wait(800)
  await ready()
  await showBlock('pE')
  const landMark = await page.evaluate(() => {
    const p = document.querySelector('.page-viewport.front [data-block-id="pE"]')
    const mark = getComputedStyle(p, '::after')
    const s = parseFloat(getComputedStyle(document.querySelector('.stage')).getPropertyValue('--s'))
    const r = p.getBoundingClientRect()
    const size = parseFloat(mark.width) * s
    const cx = r.left + parseFloat(mark.left) * s + size / 2
    const cy = r.top + parseFloat(mark.top) * s
    const heading = document.querySelector('.page-viewport.front [data-block-id="c3"]').getBoundingClientRect()
    const num = document.querySelector('.page-viewport.front [data-block-id="c3"]').closest('h1').getBoundingClientRect()
    return { cx, cy, size, markRight: cx + size / 2, textLeft: num.left, heading: { x: heading.left + Math.min(heading.width / 2, 8), y: (heading.top + heading.bottom) / 2 } }
  })
  const tapOpens = async (x, y) => {
    await page.touchscreen.tap(x, y)
    await page.waitForFunction(() => !!window.__editor.getSnapshot().editingId, { timeout: 5000 }).catch(() => {})
    await wait(300)
    const id = (await snap()).editingId
    await page.evaluate(() => window.__editor.finishEditing())
    await ready()
    await wait(300)
    return id
  }
  await page.screenshot({ path: `${OUT}/19f-land-mark.png` })
  const markTaps = {
    topEdge: await tapOpens(landMark.cx, landMark.cy - landMark.size / 2 + 1),
    around: await tapOpens(landMark.cx - 15, landMark.cy - 15),
    heading: await tapOpens(landMark.heading.x, landMark.heading.y),
  }
  check(
    '横向き：空の段落の「＋」の印は段落の左の余白に出て（見出しの文字に重ならない）、印の上の端・印のまわり（44px 四方）を押してもその段落が開く。見出しの文字を押すと見出しが開く',
    landMark.markRight <= landMark.textLeft + 0.5 && markTaps.topEdge === 'pE' && markTaps.around === 'pE' && markTaps.heading === 'c3',
    JSON.stringify({ landMark, markTaps }),
  )
  await page.setViewport(PORTRAIT)
  await wait(800)
  await ready()

  // スマホの使い方の題は「タップ」（「書き方（タップして書く）」。PC は「クリック」のまま：smoke.mjs）
  await page.tap('.p-top .icon-btn')
  await page.waitForSelector('.sheet .links')
  await page.evaluate(() => [...document.querySelectorAll('.sheet button')].find((b) => b.textContent.includes('使い方')).click())
  await page.waitForSelector('.help-sheet .help-list')
  const phoneHelp = await page.evaluate(() => [...document.querySelectorAll('.help-sheet .help-list button')].map((b) => b.textContent))
  await page.evaluate(() => [...document.querySelectorAll('.help-sheet .help-list button')].find((b) => b.textContent.startsWith('書き方')).click())
  await wait(300)
  const phoneTopic = await page.evaluate(() => document.querySelector('.help-sheet .help-lead')?.textContent ?? '')
  await page.evaluate(() => document.querySelector('.help-sheet .help-close').click())
  await wait(300)
  check(
    'スマホの使い方の題・ひとことは「タップ」（「書き方（タップして書く）」。「クリック」が残らない）',
    phoneHelp.includes('書き方（タップして書く）') && !phoneHelp.some((t) => t.includes('クリック')) && phoneTopic === '紙面の文をタップすると、その場で書けます。',
    JSON.stringify({ phoneHelp: phoneHelp.filter((t) => /書き方|タップ|クリック/.test(t)), phoneTopic }),
  )

  // 抄録の帯の「先生の許可が出た」：画面の下に「抄録を書き始めました［戻す］」。［戻す］で、書き始める前に戻る
  await page.evaluate(() => window.__editor.goToPage(window.__editor.getSnapshot().layout.kinds.indexOf('abstract'), 'none'))
  await ready()
  await wait(400)
  await page.tap('.page-band button')
  await page.waitForFunction(() => window.__editor.getSnapshot().report.abstract.started === true, { timeout: 20000 })
  await ready()
  await wait(300)
  const startNote = await page.evaluate(() => ({ text: document.querySelector('.undo-toast')?.textContent ?? '', button: !!document.querySelector('.undo-toast button'), sheet: !!document.querySelector('.edit-sheet.open') }))
  await page.screenshot({ path: `${OUT}/18d-abstract-started.png` })
  await page.tap('.undo-toast button')
  await ready()
  await wait(300)
  const back = { ...(await snap()), text: await page.evaluate(() => document.querySelector('.undo-toast')?.textContent ?? ''), band: await page.evaluate(() => document.querySelector('.page-band button')?.textContent ?? '') }
  check(
    'スマホ：「先生の許可が出た」のあと、画面の下に「抄録を書き始めました［戻す］」が出て、［戻す］で書き始める前に戻る',
    startNote.text.includes('抄録を書き始めました') && startNote.button && !startNote.sheet && back.started === false && back.text.includes('抄録を書き始める前に戻しました') && back.band.includes('先生の許可が出た'),
    JSON.stringify({ startNote, back }),
  )
  await context.close()
}

/**
 * 横向きのスマホ：作品写真のページの道具を、紙面の右の列（帯と同じ列）に出す（mockups/v33 案A）：
 * - 6つの並べ方は右の列に3列×2段（絵の下に1行の名前・高さ 44px 以上・いまの並べ方に印と aria-pressed）。下の道具には出さない。紙面・帯・ページ送りに重ならない
 * - 押すと並べ方が変わる（本物のボタン）
 * - 空いている枠があるときは、帯が同じ列の上に出て、どちらも全部見える
 * - 写真を押して選ぶと、「この写真」の道具（差し替え・外す・全体を入れる（切らない））も右の列に出る（高さ 44px 以上）
 * - 紙面はほかのページと同じ大きさで、ページ送りに隠れない。844×390・800×360 で画面が横にはみ出さない
 * - 縦向きは今までどおり（下の道具）
 */
async function sideToolsCheck(browser) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await noHotReload(page)
  await stubConfig(page)
  page.on('pageerror', (e) => console.log('pageerror(side):', e.message))
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  })
  const PORTRAIT = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  const LANDSCAPE = { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  const SMALL = { width: 800, height: 360, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
  await page.setViewport(PORTRAIT)
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0' })
  const ready = () =>
    page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && s.sheet && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 60000 })
  await ready()
  // はじめての案内は「あとで入力する」で閉じる
  await page.waitForSelector('.guide.step-course .g-opts button')
  await page.evaluate(() => document.querySelector('.g-opts button').click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.guide .g-later')
  await page.evaluate(() => document.querySelector('.guide .g-later').click())
  await page.evaluate(() => window.__editor.finishEditing())
  await ready()
  // 見本の原稿。作品写真は2枚（上下）で、どちらの枠にも写真がある
  const { setupWriting } = await import('./sampleReport.mjs')
  await page.evaluate(setupWriting)
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, studentId: '00ZZ0123' }, workPhotos: [{ layout: 2, columns: 1, imageIds: ['g-photo1', 'g-process'] }] })))
  await wait(500)
  await ready()
  const turnTo = async (vp) => {
    await page.setViewport(vp)
    await wait(800)
    await ready()
  }
  const showPhotos = async () => {
    await page.evaluate(() => {
      window.__editor.select(null)
      window.__editor.goToPage(window.__editor.getSnapshot().layout.kinds.indexOf('photos'), 'none')
    })
    await ready()
    await wait(400)
  }
  // 作品写真の1ページ目（何ページかにできるようになった：mockups/v38）
  const photos = () => page.evaluate(() => window.__editor.getSnapshot().report.workPhotos[0])
  /** 右の列のようす：並べ方・選んだ写真の道具の位置と大きさ、紙面・帯・ページ送りとの重なり、画面の横のはみ出し */
  const side = () =>
    page.evaluate(() => {
      const rect = (el) => {
        const r = el.getBoundingClientRect()
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, height: r.height }
      }
      const hit = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5
      const inside = (r) => r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5
      const pageEl = rect(document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current'))
      const pagerEl = document.querySelector('.pager')
      const pager = pagerEl ? rect(pagerEl) : null
      const col = document.querySelector('.page-side')
      const band = document.querySelector('.page-band')
      const bandR = band ? rect(band) : null
      const lays = [...document.querySelectorAll('.page-side .lay')].map((b) => {
        const n = b.querySelector('.lay-n').getBoundingClientRect()
        const sub = b.querySelector('.lay-sub')?.getBoundingClientRect()
        return { name: b.textContent.trim(), r: rect(b), on: b.classList.contains('on'), pressed: b.getAttribute('aria-pressed'), oneLine: !sub || Math.abs(sub.top - n.top) < 1 }
      })
      const tools = [...document.querySelectorAll('.page-side :is(.tb, .photo-sw)')].map((b) => ({ name: b.textContent.trim(), r: rect(b), role: b.getAttribute('role'), checked: b.getAttribute('aria-checked') }))
      const cards = [...document.querySelectorAll('.page-side > *')].map(rect)
      const buttons = [...lays, ...tools]
      return {
        shown: !!col,
        selBar: !!document.querySelector('.sel-bar'),
        label: [...document.querySelectorAll('.page-side .ctx-label')].map((e) => e.textContent),
        lays: lays.map((l) => `${l.name}:${Math.round(l.r.height)}${l.on ? ':on' : ''}:${l.pressed}${l.oneLine ? '' : ':2行'}`),
        tools: tools.map((t) => `${t.name}:${Math.round(t.r.height)}${t.role ? `:${t.role}=${t.checked}` : ''}`),
        rows: new Set(lays.map((l) => Math.round(l.r.top))).size,
        cols: new Set(lays.map((l) => Math.round(l.r.left))).size,
        minH: buttons.length ? Math.round(Math.min(...buttons.map((b) => b.r.height)) * 10) / 10 : 0,
        oneLine: lays.every((l) => l.oneLine),
        pressedOk: lays.every((l) => l.pressed === String(l.on)) && lays.filter((l) => l.on).length === 1,
        band: band?.textContent ?? '',
        bandInColumn: !!band && !!col?.contains(band),
        bandButtonH: band ? Math.round(band.querySelector('button').getBoundingClientRect().height) : 0,
        bandAbove: !bandR || (cards.length === 2 && bandR.bottom <= cards[1].top + 0.5),
        overPage: cards.some((c) => hit(c, pageEl)) || (!!bandR && hit(bandR, pageEl)),
        overBand: !!bandR && buttons.some((b) => hit(b.r, bandR)),
        overPager: !!pager && (cards.some((c) => hit(c, pager)) || (!!bandR && hit(bandR, pager))),
        rightOfPager: !!col && !!pager && col.getBoundingClientRect().left >= pager.right - 0.5,
        allInside: cards.length > 0 && cards.every(inside) && (!bandR || inside(bandR)),
        pageCovered: !!pager && pager.top < pageEl.bottom - 0.5 && pager.left < pageEl.right && pager.right > pageEl.left,
        pageW: Math.round((pageEl.right - pageEl.left) * 10) / 10,
        scrollX: document.documentElement.scrollWidth > innerWidth + 1,
      }
    })
  const placed = (s) => s.shown && !s.selBar && s.minH >= 44 && !s.overPage && !s.overBand && !s.overPager && s.rightOfPager && s.allInside && !s.pageCovered && !s.scrollX
  const tapButton = async (sel, text) => {
    const el = await page.evaluateHandle((sel, text) => [...document.querySelectorAll(sel)].find((b) => b.textContent.trim() === text), sel, text)
    await el.tap()
    await wait(300)
    await ready()
    await wait(300)
  }

  // 横向き（844×390）：紙面の大きさ（表紙のページで測る。作品写真のページも同じ大きさのまま）
  await turnTo(LANDSCAPE)
  await page.evaluate(() => window.__editor.goToPage(0, 'none'))
  await ready()
  await wait(300)
  const coverW = await page.evaluate(() => Math.round(document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current').getBoundingClientRect().width * 10) / 10)
  // 何も選んでいないとき：4つの並べ方（6枚はなくした：mockups/v38）と「ページを足す」「ページを消す」が右の列に3列×2段。下の道具には出さない
  await showPhotos()
  const land = await side()
  await page.screenshot({ path: `${OUT}/20-side-layouts.png` })
  check(
    '横向き：作品写真のページの4つの並べ方と「ページを足す」「ページを消す」は、紙面の右の列に3列×2段（絵の下に1行の名前・高さ 44px 以上・いまの「2枚 上下」に印と aria-pressed）。下の道具には出さない',
    placed(land) && land.label.join() === '並べ方' && land.lays.length === 4 && land.lays.map((l) => l.split(':')[0]).join() === '1枚,2枚左右,2枚上下,4枚' && land.tools.length === 2 && land.rows === 2 && land.cols === 3 && land.oneLine && land.pressedOk && land.lays[2].includes(':on:true'),
    JSON.stringify(land),
  )
  check('横向き：紙面はほかのページと同じ大きさのままで、ページ送りに隠れず、並べ方にも重ならない（画面は横にはみ出さない）', land.pageW === coverW && !land.pageCovered && !land.overPage && !land.scrollX, JSON.stringify({ coverW, pageW: land.pageW, pageCovered: land.pageCovered, overPage: land.overPage }))
  // 「2枚 左右」を押すと、紙面の並べ方が変わる（右の列のボタンは本物）
  await tapButton('.page-side .lay', '2枚左右')
  const tapped = { photos: await photos(), side: await side() }
  const slots = await page.evaluate(() => [0, 1].map((i) => { const r = document.querySelector(`.page-viewport.front [data-photo-slot="${i}"]`).getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top } }))
  await page.screenshot({ path: `${OUT}/20b-side-layout-tapped.png` })
  check(
    '横向き：右の列の「2枚 左右」を押すと、紙面の写真が左右に並び、押したボタンに印が移る',
    tapped.photos.layout === 2 && tapped.photos.columns === 2 && slots[0].right <= slots[1].left + 0.5 && Math.abs(slots[0].top - slots[1].top) < 1 && tapped.side.lays[1].includes(':on:true') && tapped.side.pressedOk && placed(tapped.side),
    JSON.stringify({ photos: tapped.photos, slots, lays: tapped.side.lays }),
  )
  await tapButton('.page-side .lay', '2枚上下')

  // 下の枠が空いているとき：帯「下の枠に、まだ写真がありません［写真を選ぶ］」が同じ列の上に出て、帯も並べ方も全部見える
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, workPhotos: [{ ...r.workPhotos[0], imageIds: ['g-photo1', ''] }] })))
  await ready()
  await showPhotos()
  const withBand = await side()
  await page.screenshot({ path: `${OUT}/20c-side-band.png` })
  check(
    '横向き：空いている枠があるときは、帯が並べ方と同じ右の列の上に出て（帯のボタンは高さ 44px 以上）、帯も並べ方も全部見え、どちらも紙面に重ならない',
    placed(withBand) && withBand.bandInColumn && withBand.band.includes('下の枠に、まだ写真がありません') && withBand.bandButtonH >= 44 && withBand.bandAbove && withBand.lays.length === 4,
    JSON.stringify(withBand),
  )

  // 写真を押して選ぶ：「この写真（1枚目）」の道具（差し替え・外す・全体を入れる（切らない））も右の列に出る。スイッチは押すと切り替わる
  const photoAt = await page.evaluate(() => {
    const r = document.querySelector('.page-viewport.front [data-photo-slot="0"]').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.touchscreen.tap(photoAt.x, photoAt.y)
  await wait(400)
  const chosen = await side()
  await page.screenshot({ path: `${OUT}/20d-side-photo.png` })
  await tapButton('.page-side .photo-sw', '全体を入れる（切らない）')
  const switched = { checked: await page.evaluate(() => document.querySelector('.page-side .photo-sw')?.getAttribute('aria-checked')), whole: (await photos()).whole?.[0] }
  check(
    '横向き：写真を押して選ぶと、「この写真（1枚目）」の道具（差し替え・外す・全体を入れる（切らない））が下の道具ではなく右の列に出て（高さ 44px 以上）、スイッチで切り替えられる',
    placed(chosen) && chosen.label.join() === 'この写真（1枚目）' && chosen.tools.map((t) => t.split(':')[0]).join() === '差し替え,外す,全体を入れる（切らない）' && chosen.tools[2].includes('switch=false') && chosen.bandInColumn && chosen.bandAbove && switched.checked === 'true' && switched.whole === true,
    JSON.stringify({ chosen, switched }),
  )
  await page.evaluate(() => window.__editor.select(null))
  await wait(300)

  // 800×360：帯と並べ方・選んだ写真の道具が右の列に全部見え、紙面・ページ送りに重ならない。画面は横にはみ出さない
  await turnTo(SMALL)
  await showPhotos()
  const small = await side()
  await page.screenshot({ path: `${OUT}/20e-side-800x360.png` })
  await page.evaluate(() => window.__editor.select({ kind: 'photos', page: 0, index: 0 }))
  await wait(400)
  const smallChosen = await side()
  await page.screenshot({ path: `${OUT}/20f-side-800x360-photo.png` })
  await page.evaluate(() => window.__editor.select(null))
  await wait(300)
  check(
    '800×360 の横向きでも、帯と並べ方・「ページを足す」「ページを消す」（3列×2段）・選んだ写真の道具が右の列に全部見え（高さ 44px 以上）、紙面・帯・ページ送りに重ならず、紙面はページ送りに隠れない（横にはみ出さない）',
    placed(small) && small.bandInColumn && small.bandAbove && small.rows === 2 && small.cols === 3 && small.tools.length === 2 && small.oneLine && placed(smallChosen) && smallChosen.tools.length === 3 && smallChosen.bandAbove,
    JSON.stringify({ small, smallChosen }),
  )

  // 縦向き：今までどおり、並べ方と選んだ写真の道具は下の道具に出る（右の列は出さない）
  await turnTo(PORTRAIT)
  await showPhotos()
  const portrait = await page.evaluate(() => ({ side: !!document.querySelector('.page-side'), label: document.querySelector('.sel-bar .ctx-label')?.textContent, lays: document.querySelectorAll('.sel-bar .lay').length }))
  await page.screenshot({ path: `${OUT}/20g-portrait.png` })
  await page.evaluate(() => window.__editor.select({ kind: 'photos', page: 0, index: 0 }))
  await wait(400)
  const portraitChosen = await page.evaluate(() => ({ side: !!document.querySelector('.page-side'), label: document.querySelector('.sel-bar .ctx-label')?.textContent, tools: [...document.querySelectorAll('.sel-bar .tb')].map((b) => b.textContent.trim()) }))
  check(
    '縦向きは今までどおり：並べ方は下の道具に出て、写真を選ぶと下の道具が「この写真（1枚目）」に替わる（右の列は出さない）',
    !portrait.side && portrait.label === '並べ方' && portrait.lays === 4 && !portraitChosen.side && portraitChosen.label === 'この写真（1枚目）' && portraitChosen.tools.join() === '差し替え,外す',
    JSON.stringify({ portrait, portraitChosen }),
  )
  await context.close()
}

/**
 * スマホで欄を書いている間、紙面のその欄が、上の案内・下の書く欄・キーボードに隠れない（はじめて使う学生の試しで、案内に沿ってサブタイトルを
 * 書くとき、紙面のサブタイトルの行が案内の下に隠れ、どこに入るのか見えなかった）。縦向き 390×844・横向き 844×390・小さい画面 360×640 で：
 * - はじめての案内の学籍番号・氏名・サブタイトル（タップする前も、案内が欄を隠さない。書いている間は、書く欄の「完了」も隠さない）
 * - キーボードを出したとき（書く欄がキーボードの分だけ上がる。CSS の変数 --kb で試す）
 * - 案内を閉じたあとの表紙の欄と、本文の段落
 * - 書き終えると、紙面の上下に足した余白はなくなり、ページ全体の表示に戻る
 * 設定は、ページの中で fetch を差し替えて返す（要求の差し替えは使わない）
 */
async function writingVisibleCheck(browser) {
  const config = JSON.parse(readFileSync(new URL('./config-fixture.json', import.meta.url), 'utf8'))
  const views = [
    ['縦向き 390×844', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 300],
    ['横向き 844×390', { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true }, 0],
    ['小さい画面 360×640', { width: 360, height: 640, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 260],
  ]
  for (const [name, view, keyboard] of views) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    page.on('pageerror', (e) => console.log('pageerror(writing):', e.message))
    await page.evaluateOnNewDocument((config) => {
      const Real = window.WebSocket
      window.WebSocket = function (url, protocols) {
        if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
        return new Real(url, protocols)
      }
      const realFetch = window.fetch.bind(window)
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (/script\.google(usercontent)?\.com/.test(url)) return Promise.resolve(new Response(JSON.stringify({ ok: true, year: config.fiscalYear, config }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
        return realFetch(input, init)
      }
      try {
        localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
      } catch {}
    }, config)
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
    await page.setViewport(view)
    await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0' })
    const ready = () =>
      page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && s.sheet && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 60000 })
    await ready()
    const tag = name.split(' ')[0]
    const problems = []
    const seen = []
    /** 書いている欄の位置と、それを隠しうるもの（案内・書く欄・キーボード kb px）。「完了」が押せるか（案内に隠れていないか） */
    const geometry = (kb = 0) =>
      page.evaluate((kb) => {
        const id = window.__editor.getSnapshot().editingId
        const el = id && [...document.querySelectorAll(`.page-viewport.front [data-vivliostyle-page-container].is-current [data-block-id="${CSS.escape(id)}"]`)].find((e) => e.getBoundingClientRect().height > 0)
        const f = el?.getBoundingClientRect()
        const shown = (sel) => {
          const e = document.querySelector(sel)
          const r = e?.getBoundingClientRect()
          return r && r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' ? r : null
        }
        const hit = (r) => !!r && !!f && r.top < f.bottom - 0.5 && r.bottom > f.top + 0.5 && r.left < f.right && r.right > f.left
        const stage = document.querySelector('.stage').getBoundingClientRect()
        const done = document.querySelector('.edit-sheet.open .done')?.getBoundingClientRect()
        return {
          id,
          field: f ? [Math.round(f.top), Math.round(f.bottom)] : null,
          tip: hit(shown('.guide .g-tip')),
          sheet: hit(shown('.edit-sheet.open')),
          inStage: !!f && f.top >= stage.top - 0.5 && f.bottom <= stage.bottom + 0.5 && f.bottom <= innerHeight - kb + 0.5,
          done: !!done && !!document.elementFromPoint(done.left + done.width / 2, done.top + done.height / 2)?.closest('.edit-sheet .done'),
        }
      }, kb)
    const record = async (what, kb = 0) => {
      const g = await geometry(kb)
      seen.push(`${what}:${g.field?.join('-') ?? 'none'}`)
      if (!g.field || g.tip || g.sheet || !g.inStage || !g.done) problems.push({ what, ...g })
    }
    const tapField = async (id) => {
      const at = await page.evaluate((id) => {
        const el = [...document.querySelectorAll(`.page-viewport.front [data-vivliostyle-page-container].is-current [data-block-id="${CSS.escape(id)}"]`)].find((e) => e.getBoundingClientRect().width > 0)
        const r = el.getBoundingClientRect()
        const t = document.querySelector('.guide .g-tip')?.getBoundingClientRect()
        const covered = !!t && t.top < r.bottom && t.bottom > r.top && t.left < r.right && t.right > r.left
        return { x: r.left + Math.min(r.width / 2, 30), y: r.top + r.height / 2, covered }
      }, id)
      if (at.covered) problems.push({ what: `${id}（タップする前）`, covered: true })
      await page.touchscreen.tap(at.x, at.y)
      await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 10000 }, id).catch(() => problems.push({ what: `${id}（タップしても書く欄が開かない）` }))
      await wait(500)
    }
    /** キーボードを出したとき（iPhone と同じく、見えている所（visualViewport）が低くなり、書く欄がキーボードの分だけ上がる） */
    const withKeyboard = async (what) => {
      if (!keyboard) return
      await page.evaluate((kb) => {
        Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => window.innerHeight - kb })
        window.visualViewport.dispatchEvent(new Event('resize'))
      }, keyboard)
      await wait(500)
      await record(`${what}（キーボード）`, keyboard)
      await page.evaluate(() => {
        delete window.visualViewport.height
        window.visualViewport.dispatchEvent(new Event('resize'))
      })
      await wait(300)
    }
    const roomLeft = () => page.evaluate(() => { const s = document.querySelector('.page-scroller'); return s.style.getPropertyValue('--reveal-top') + s.style.getPropertyValue('--reveal-bottom') })

    // はじめての案内：コース →（今年度だけ）Word は「いいえ」→ 学籍番号・氏名・サブタイトル
    await page.waitForSelector('.guide.step-course .g-opts button')
    await page.evaluate(() => document.querySelector('.g-opts button').click())
    await page.waitForSelector('.guide.step-word .g-word-opt.no')
    await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
    const steps = [['studentId', 'basic:studentId', '00ZZ0123'], ['name', 'basic:name', '文化　花子'], ['subtitle', 'basic:subtitleInput', '海の王女']]
    for (const [step, id, text] of steps) {
      await page.waitForSelector(`.guide.step-${step}`)
      await ready()
      await wait(300)
      await tapField(id)
      await record(`案内の${step}`)
      if (step === 'subtitle') {
        await page.screenshot({ path: `${OUT}/20-writing-${tag}-guide-subtitle.png` })
        await withKeyboard(`案内の${step}`)
      }
      await page.keyboard.type(text)
      await wait(200)
      await record(`案内の${step}（書いたあと）`)
      await page.click('.edit-sheet .done')
      await wait(300)
    }
    await page.waitForSelector('.guide.step-done')
    await page.evaluate(() => [...document.querySelectorAll('.g-actions button')].find((b) => b.textContent.includes('閉じる')).click())
    await ready()
    const afterGuide = { room: await roomLeft(), zoomed: (await page.evaluate(() => window.__editor.getSnapshot().zoomed)) }
    // 案内を閉じたあと：表紙のサブタイトル・氏名と、本文の最初の段落
    for (const id of ['basic:subtitleInput', 'basic:name']) {
      await tapField(id)
      await record(`あとから${id.replace('basic:', '')}`)
      if (id === 'basic:subtitleInput') await withKeyboard('あとからsubtitleInput')
      await page.click('.edit-sheet .done')
      await ready()
      await wait(300)
    }
    const pid = await page.evaluate(() => window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.type === 'paragraph').id)
    await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), pid)
    await ready()
    await wait(300)
    await tapField(pid)
    await record('本文の段落')
    await withKeyboard('本文の段落')
    await page.screenshot({ path: `${OUT}/20-writing-${tag}-body.png` })
    await page.click('.edit-sheet .done')
    await ready()
    await wait(300)
    const restored = { room: await roomLeft(), zoomed: await page.evaluate(() => window.__editor.getSnapshot().zoomed) }
    check(
      `スマホ（${name}）：書いている欄（案内の学籍番号・氏名・サブタイトル、あとからの表紙の欄、本文の段落。キーボードを出したときも）が、上の案内・下の書く欄に隠れず、「完了」も押せる。書き終えると紙面の余白はなくなり、全体の表示に戻る`,
      problems.length === 0 && !afterGuide.room && !afterGuide.zoomed && !restored.room && !restored.zoomed,
      JSON.stringify({ problems, afterGuide, restored, seen }),
    )
    await context.close()
  }
}

/**
 * 開くのを速くした（はじめて使う学生の試しで、開くたびに5秒ほど「（初回は数秒かかります）」と出ていた）：
 * - はじめて開いたとき（この端末に原稿がない）だけ「（初回は数秒かかります）」と出す
 * - 2回目から（読み込み直したとき）は、最後に見ていたページを、そのページのある部分を組み終えたらすぐ見せ（ほかのページはそのあと組む）、「初回」とは出さない
 * - 先に見せている間にそのページで書いた文字は、組み終えたあとも残る。先に見せている間にページを送ると、移る先のページを組み終えたら送る
 * - 組み終えると、ページ数・紙面の情報・チェックの指摘は、まっさらな状態から組んだときと同じ
 * CPU を遅くして（6倍）、先に見せている間を長くして試す。設定は、ページの中で fetch を差し替えて返す（要求の差し替えは使わない）
 */
async function quickOpenCheck(browser) {
  const config = JSON.parse(readFileSync(new URL('./config-fixture.json', import.meta.url), 'utf8'))
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror(quick):', e.message))
  await page.evaluateOnNewDocument((config) => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
    const realFetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (/script\.google(usercontent)?\.com/.test(url)) return Promise.resolve(new Response(JSON.stringify({ ok: true, year: config.fiscalYear, config }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      return realFetch(input, init)
    }
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
    // 「紙面を準備しています…」の文字を、出るたびに記録する
    window.__loadingTexts = []
    new MutationObserver(() => {
      const t = document.querySelector('.loading')?.textContent
      if (t && window.__loadingTexts.at(-1) !== t) window.__loadingTexts.push(t)
    }).observe(document, { subtree: true, childList: true, characterData: true })
  }, config)
  await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const ready = () =>
    page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && s.sheet && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 120000 })
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0' })
  await ready()
  const firstTexts = await page.evaluate(() => window.__loadingTexts)
  // 見本の原稿にして、本文の3ページ目を見る（最後に見ていたページとして覚える）
  await page.waitForSelector('.guide.step-course .g-opts button')
  await page.evaluate(() => document.querySelector('.g-opts button').click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.g-later')
  await page.evaluate(() => document.querySelector('.g-later').click())
  await ready()
  const { setupWriting } = await import('./sampleReport.mjs')
  await page.evaluate(setupWriting)
  // 見本の写真を、この端末にも保存する（読み込み直しても写真が出るように）
  await page.evaluate(async () => {
    const { putImage } = await import('/src/model/storage.ts')
    for (const [id, img] of window.__editor.images) {
      const blob = await (await fetch(img.url)).blob()
      await putImage({ id, blob, widthPx: img.widthPx, heightPx: img.heightPx })
    }
  })
  await ready()
  const target = await page.evaluate(() => {
    const s = window.__editor.getSnapshot()
    const body = s.layout.kinds.map((k, i) => (k === 'body' ? i : -1)).filter((i) => i >= 0)
    return body[2]
  })
  await page.evaluate((p) => window.__editor.goToPage(p, 'none'), target)
  await ready()
  await wait(1500)
  // 読み込み直す（CPU を 6倍遅くして、先に見せている間を長くする）
  const cdp = await page.createCDPSession()
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => performance.getEntriesByType('mark').some((m) => m.name === 'open:shown'), { timeout: 120000 })
  const early = await page.evaluate(() => {
    const s = window.__editor.getSnapshot()
    const marks = Object.fromEntries(performance.getEntriesByType('mark').map((m) => [m.name, Math.round(m.startTime)]))
    const para = [...document.querySelectorAll('.page-viewport.front [data-vivliostyle-page-container].is-current section.body p[data-block-id]')].find((p) => p.textContent.length > 20)
    const r = para?.getBoundingClientRect()
    return { page: s.page, rendering: s.rendering, laidOut: 'open:layout' in marks, pager: document.querySelector('.pager .lbl')?.textContent ?? '', para: para?.dataset.blockId, x: r ? r.left + 30 : 0, y: r ? r.top + r.height / 2 : 0, loading: !!document.querySelector('.loading') }
  })
  await page.screenshot({ path: `${OUT}/21-quick-open-early.png` })
  // 先に見せている間に、そのページの段落をタップして書き、ページ送りも押す（組み終えてから送る）
  let typed = false
  if (early.para && !early.laidOut) {
    await page.touchscreen.tap(early.x, early.y)
    typed = await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 20000 }, early.para).then(() => true, () => false)
    if (typed) {
      await page.keyboard.type('先に見せている間に書いた。')
      await page.click('.edit-sheet .done')
    }
  }
  // 書く欄を閉じて、ページ送りが出るのを待ってから押す
  await page.waitForSelector('.pager button[aria-label="次のページ"]', { timeout: 30000 }).catch(() => {})
  // まだ組み終えていないかを確かめるのと押すのを、ページの中で続けて行う（間に組み終えないように）
  // 押すときの見ているページ（先に見せている間に書いても、見ているページの番号はずれない）
  const { stillEarly, pageAtClick } = await page.evaluate(() => {
    const early = !performance.getEntriesByType('mark').some((m) => m.name === 'open:layout') && !!document.querySelector('.pager button[aria-label="次のページ"]')
    const pageAtClick = window.__editor.getSnapshot().page
    if (early) document.querySelector('.pager button[aria-label="次のページ"]').click()
    return { stillEarly: early, pageAtClick }
  })
  await page.waitForFunction(() => performance.getEntriesByType('mark').some((m) => m.name === 'open:place'), { timeout: 120000 })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await ready()
  // 送るのを待っていたページ送りは、組み終えてから動く（パソコンが忙しいと遅れるので、決まった時間ではなく、送り終えるまで待つ）
  if (stillEarly) await page.waitForFunction((to) => window.__editor.getSnapshot().page === to, { timeout: 30000 }, target + 1).catch(() => {})
  // 送るのは1回だけ（少し待っても、それ以上は送らない）
  await wait(1000)
  await ready()
  const after = await page.evaluate((id) => {
    const s = window.__editor.getSnapshot()
    const block = s.report.body.flatMap((c) => c.blocks).find((b) => b.id === id)
    const text = block?.content.map((n) => n.text ?? '').join('') ?? ''
    const onPaper = [...document.querySelectorAll(`.page-viewport.front [data-block-id="${id}"]`)].map((e) => e.textContent).join('')
    return { page: s.page, pageCount: s.pageCount, text: text.includes('先に見せている間に書いた。'), onPaper: onPaper.includes('先に見せている間に書いた'), placeholders: window.__editor.renderer.pageView.pages().filter((p) => p.hasAttribute('data-placeholder-page')).length, texts: window.__loadingTexts }
  }, early.para)
  // まっさらな状態から組み直した紙面と比べる（ページ数・紙面の情報・指摘）
  const sum = () => page.evaluate(() => { const s = window.__editor.getSnapshot(); return JSON.stringify({ n: s.pageCount, layout: s.layout, findings: s.findings.map((f) => `${f.ruleId}|${f.blockId ?? ''}|${f.start ?? ''}`).sort() }) })
  const shownSum = await sum()
  await page.evaluate(async () => {
    window.__editor.renderer.forget()
    await window.__editor.render()
    await window.__editor.whenLaidOut()
  })
  await ready()
  const freshSum = await sum()
  check('はじめて開いたとき（この端末に原稿がない）は「紙面を準備しています…（初回は数秒かかります）」と出る', firstTexts.some((t) => t.includes('初回は数秒かかります')), JSON.stringify(firstTexts))
  check(
    '2回目から（読み込み直したとき）は、最後に見ていたページを、全部組み終える前に先に見せ、「初回」とは出さない（ページ送りも、そのページを指す）',
    early.page === target && !early.laidOut && early.rendering && early.pager.includes(`${target + 1} /`) && !early.loading && !after.texts.some((t) => t.includes('初回')),
    JSON.stringify({ target, early, texts: after.texts }),
  )
  check('先に見せている間にそのページで書いた文字は、組み終えたあとも原稿と紙面に残る', typed && after.text && after.onPaper, JSON.stringify({ typed, after }))
  check(
    '先に見せている間に書いても、見ているページの番号はずれない。そのあとページ送りを押すと、次のページを組み終えたら（すべて組み終えるのを待たずに）、次のページへ1回だけ送る。仮のページは残らない',
    stillEarly && pageAtClick === target && after.page === target + 1 && after.placeholders === 0,
    JSON.stringify({ stillEarly, pageAtClick, page: after.page, placeholders: after.placeholders }),
  )
  check('組み終えた紙面（ページ数・目次の番号などの紙面の情報・チェックの指摘）は、まっさらな状態から組み直したときと同じ', shownSum === freshSum, shownSum === freshSum ? '' : JSON.stringify({ shownSum, freshSum }))
  await context.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 件 合格`)
process.exitCode = failed.length ? 1 : 0
