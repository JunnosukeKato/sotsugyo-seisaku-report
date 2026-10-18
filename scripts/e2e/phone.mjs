// スマホ版の動作確認（Edge をスマホの画面の大きさ・タッチ操作にして動かす）。
// 使い方: node scripts/e2e/phone.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
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
    const parts = ['.pager', '.unzoom', '.sel-bar > *', '.page-band'].flatMap((sel) => [...document.querySelectorAll(sel)].map((el) => ({ sel, r: el.getBoundingClientRect() }))).filter(({ r }) => r.height > 0)
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
  // エラーと警告の意味は、一覧の上に1行（指摘ごとの札「手順書」「補助」はない。mockups/v31 案1）。スマホの幅で横にはみ出さない
  const phoneLegend = await page.evaluate(() => {
    const el = document.querySelector('.sheet .sev-legend')
    const r = el?.getBoundingClientRect()
    return { text: el?.textContent ?? '', inside: !!r && r.left >= 0 && r.right <= innerWidth, chips: document.querySelectorAll('.sheet .issue .src').length, fontSize: el ? parseFloat(getComputedStyle(el).fontSize) : 0 }
  })
  check('チェックの欄の一覧の上に「エラー：直してから出す」「警告：できれば直す」が出て、札（手順書・補助）はない', phoneLegend.text.includes('エラー：直してから出す') && phoneLegend.text.includes('警告：できれば直す') && phoneLegend.inside && phoneLegend.chips === 0 && phoneLegend.fontSize >= 13, JSON.stringify(phoneLegend))
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
  check('「外す」で枠が空になり、「作品写真を外しました［戻す］」が出る', s.report.workPhotos.imageIds[0] === '' && (await page.evaluate(() => document.querySelector('.undo-toast')?.textContent ?? '')).includes('作品写真を外しました'))
  await page.click('.undo-toast button')
  await ready()
  check('知らせの「戻す」で、外した写真が戻る', (await snap()).report.workPhotos.imageIds[0] === 'e2e-photo')
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
  check('メニューの「？ 使い方」で、画面いっぱいの使い方の欄が出る（メニューは閉じる・項目18・印刷用の手引き（PDF））', helpSheet.top <= 12 && helpSheet.left === 0 && helpSheet.right === helpSheet.width && !helpSheet.menu && helpSheet.topics === 18 && helpSheet.modal === 'true' && helpSheet.pdf === './guides/student-guide.pdf', JSON.stringify(helpSheet))
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
  await page.reload({ waitUntil: 'networkidle0' })
  await ready()
  const phoneTour = await page.waitForSelector('.tour .tour-tip', { timeout: 20000 }).then(() => true, () => false)
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
})

/**
 * スマホの見やすさ（mockups/v32 ④ 案A）：
 * - 紙面の中の小さな案内とボタン（抄録の「先生の許可が出た」・作品写真の空いている枠・まだ書いていない欄）を、紙面の下の帯に、ふつうの文字の大きさで出す。紙面には小さな印だけ
 * - 横向きでは、帯は紙面の右（紙面が小さくなりすぎない）
 * - 小さいボタン（「直す」「完了」「あとで入力する」「＋引用・参考文献を入れる」・ページ送り・「ページ全体に戻す」）は高さ 44px 以上
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

  // 見本の原稿：抄録はまだ（先生の許可が出る前）・作品写真は2枚（上下）で下の枠が空いている・本文に「見頃」（指摘の「直す」が出る）
  await page.evaluate(setupWriting)
  await page.evaluate(() =>
    window.__editor.update((r) => ({
      ...r,
      basicInfo: { ...r.basicInfo, studentId: '00ZZ0123' },
      abstract: { ...r.abstract, started: false },
      workPhotos: { layout: 2, columns: 1, imageIds: ['g-photo1', ''] },
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
  await page.evaluate(() => window.__editor.select({ kind: 'photos', index: 0 }))
  await wait(400)
  const swH = await height('.sel-bar .photo-sw')
  await page.tap('.sel-bar .photo-sw')
  await wait(300)
  await ready()
  const phoneWhole = await page.evaluate(() => ({ fit: getComputedStyle(document.querySelector('.page-viewport.front [data-photo-slot="0"] img')).objectFit, checked: document.querySelector('.sel-bar .photo-sw')?.getAttribute('aria-checked'), whole: window.__editor.getSnapshot().report.workPhotos.whole }))
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

  // ページ送り・「ページ全体に戻す」・「＋引用・参考文献を入れる」・指摘の「直す」は高さ 44px 以上
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
  await page.click('.p-nav .add')
  await page.waitForSelector('.sheet .add-refs')
  const refsH = await height('.sheet .add-refs')
  // 「＋引用・参考文献を入れる」の窓：ボタン（「削除」「＋ 書籍を追加」「やめる」「反映する」など）と種類の選択は、見た目も高さ 44px 以上
  await page.click('.sheet .add-refs')
  await page.waitForSelector('.modal .row-buttons')
  await page.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.includes('書籍を追加')).click())
  await wait(300)
  const refsDialog = await page.evaluate(() => [...document.querySelectorAll('.modal button, .modal select')].map((b) => `${b.textContent.trim().slice(0, 8)}:${Math.round(b.getBoundingClientRect().height)}`))
  const refsDialogH = await minVisibleHeight(page, '.modal button, .modal select')
  await page.screenshot({ path: `${OUT}/16b-refs-dialog-44.png` })
  await page.evaluate(() => [...document.querySelectorAll('.modal .row-buttons button')].find((b) => b.textContent === 'やめる').click())
  await wait(300)
  check('引用・参考文献の窓のボタン（削除・＋書籍を追加・やめる・反映するなど）と種類の選択は、見た目も高さ 44px 以上', refsDialogH >= 44 && refsDialog.length >= 6, JSON.stringify(refsDialog))
  await page.evaluate(() => [...document.querySelectorAll('.p-nav button')].find((b) => b.textContent.includes('チェック')).click())
  await page.waitForSelector('.sheet .issue .fix')
  await wait(300)
  const fixH = await height('.sheet .issue .fix')
  await page.screenshot({ path: `${OUT}/16-buttons-44.png` })
  await page.click('.sheet-close')
  await wait(300)
  check('ページ送り・「ページ全体に戻す」・「＋引用・参考文献を入れる」・指摘の「直す」は、高さ 44px 以上', pagerH >= 44 && unzoomH >= 44 && refsH >= 44 && fixH >= 44, JSON.stringify({ pagerH, unzoomH, refsH, fixH }))

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
  await page.evaluate(() => window.__editor.select({ kind: 'photos', index: 0 }))
  await wait(300)
  await page.evaluate(() => [...document.querySelectorAll('.sel-bar .tb')].find((b) => b.textContent.includes('外す')).click())
  await ready()
  await wait(400)
  const landUndo = await undoPlacement(page)
  await page.screenshot({ path: `${OUT}/17b-undo-landscape.png` })
  await page.click('.undo-toast button')
  await ready()
  await wait(300)
  const photoBack = await page.evaluate(() => window.__editor.getSnapshot().report.workPhotos.imageIds[0])
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
  await page.waitForFunction(() => !!window.__editor.getSnapshot().report.workPhotos.imageIds[1], { timeout: 20000 })
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
  await page.waitForSelector('.modal .draft-box .pdf-draft')
  check('iPhone：エラーが残っているときのボタンは「下書きの PDF を作る」（保存は、できたあとに押す）', (await page.$eval('.modal .draft-box .pdf-draft', (b) => b.textContent)) === '下書きの PDF を作る')
  // 「直しに戻る」・「うまくいかないとき：印刷の画面から保存」も、見た目の高さ 44px 以上
  const pdfStartH = { back: await minVisibleHeight(page, '.modal .row-buttons button'), print: await minVisibleHeight(page, '.modal .draft-box .pdf-fallback') }
  const backLabel = await page.$eval('.modal .row-buttons button.primary', (b) => b.textContent)
  await page.screenshot({ path: `${OUT}/10b-pdf-start-44.png` })
  check('PDF の窓の「直しに戻る」「うまくいかないとき：印刷の画面から保存」は、見た目も高さ 44px 以上', backLabel === '直しに戻る' && pdfStartH.back >= 44 && pdfStartH.print >= 44, JSON.stringify(pdfStartH))
  await page.tap('.modal .draft-box .pdf-draft')
  await page.waitForSelector('.modal .pdf-save', { timeout: 120000 })
  await wait(300)
  const made = await page.evaluate(() => ({ title: document.querySelector('.modal h2')?.textContent, save: document.querySelector('.modal .pdf-save')?.textContent, thumbs: document.querySelectorAll('.modal .pdf-thumbs img').length, shares: window.__shares.length }))
  await page.screenshot({ path: `${OUT}/11-pdf-share.png` })
  check('iPhone：できたら「下書きの PDF ができました」と大きな「保存する」を出す（まだ保存しない・共有の画面も開かない）', made.title === '下書きの PDF ができました' && made.save === '保存する' && made.thumbs > 0 && made.shares === 0 && readdirSync(downloads).length === 0, JSON.stringify(made))
  // 文字のリンクの「PDF を開く」と「閉じる」も、見た目の高さ 44px 以上（前は「PDF を開く」が高さ 12px ほどだった）
  const pdfDoneH = { open: await minVisibleHeight(page, '.modal .row-buttons .pdf-fallback'), close: await minVisibleHeight(page, '.modal .row-buttons button:not(.pdf-fallback)') }
  check('できたあとの「PDF を開く」（文字のリンク）と「閉じる」は、見た目も高さ 44px 以上', pdfDoneH.open >= 44 && pdfDoneH.close >= 44, JSON.stringify(pdfDoneH))
  await page.tap('.modal .pdf-save')
  await wait(300)
  const cancelled = await page.evaluate(() => ({ save: document.querySelector('.modal .pdf-save')?.textContent, shares: [...window.__shares] }))
  check('「保存する」で共有の画面を開き（ファイル名・PDF）、やめても「保存する」がそのまま押せる', cancelled.save === '保存する' && cancelled.shares[0] === `${title}_下書き.pdf|application/pdf`, JSON.stringify(cancelled))
  await page.tap('.modal .pdf-save')
  await wait(300)
  const shared = await page.evaluate(() => ({ save: document.querySelector('.modal .pdf-save')?.textContent, lead: document.querySelector('.modal .lead')?.textContent ?? '', shares: window.__shares.length }))
  check('もう一度「保存する」を押して保存すると「保存しました」と出る', shared.shares === 2 && shared.lead.startsWith('保存しました') && shared.save === 'もう一度保存する', JSON.stringify(shared))
  // 共有の画面が開けなかったとき（やめた以外の理由）は、ダウンロードに切り替える
  await page.tap('.modal .pdf-save')
  for (let i = 0; i < 40 && !readdirSync(downloads).some((n) => n.endsWith('.pdf')); i++) await wait(250)
  check('共有の画面を開けなかったときは、ダウンロードに切り替えて知らせる', readdirSync(downloads).includes(`${title}_下書き.pdf`) && (await page.$eval('.modal .lead', (e) => e.textContent)).includes('ダウンロードしました'), readdirSync(downloads).join(','))
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
  await page.tap('.sheet .add-refs')
  await page.waitForSelector('.modal .row-buttons')
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

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 件 合格`)
process.exitCode = failed.length ? 1 : 0
