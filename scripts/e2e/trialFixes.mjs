// はじめて使う学生の試し（2026-10-21。パソコン・スマホ）で見つかったことの直しを確かめる（Edge を自動で操作する）。
// 画面の写真は poc-output/trial-fixes-1021/ に置く。
// パソコン：
// - 表のマスで、何も打っていないときの Ctrl+Z は、左の道具の「元に戻す」と同じ（行を足したのを戻す）。前のマスで消した字が入らない
// - 打って消しただけで書き終えたときは、元に戻す1回分を積まない（そのあとの「元に戻す」の1回目が空振りしない）
// - 「列を足す」は、足した列の、書いていた行のマスへ移る（生地見本の画像のマスを書いていても、続けて打った字は足したマスへ）
// - ページの一覧の赤い点は「直すところ」のエラーのあるページだけ（先生の許可を待つ抄録には付けない）
// - 抄録を書き始める前の案内は、言葉の切れ目でだけ折り返す
// スマホ（紙面に直接書く）：
// - キーボードの上の道具の、薄い（押せない）「やり直す」を押しても、書き終わりにならない
// - 表のマスで打った字を、道具の「戻す」で戻せる（前は薄いままで戻せなかった）
// - 「行を消す」のあとも、上の行のマスを書き続け、「表の行を消しました［戻す］」が出る。「戻す」で行が戻り、書き続ける
// - 足した空の小見出しで Backspace：小見出しを消して、前の欄の終わりへ移る
// - 表紙のサブタイトルを書く間も、後ろの「の衣装制作―」が見える（書く欄の字のすぐ後ろ）
// - 「追加」の欄の説明は、言葉の切れ目で折り返す（「…から）。」の「ら）。」だけの行にならない）
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { linesIn } from './shapeUi.mjs'
import { openSample, showTable } from './tableShape.mjs'

const OUT = 'poc-output/trial-fixes-1021'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
/** 仮のキーボードの高さ（iPhone の日本語のキーボードほど。phoneDirect.mjs と同じ） */
const KB = 336
/** キーボードを仮に出す・しまう（見えている所 visualViewport が低くなる） */
const keyboard = (page, kb) =>
  page.evaluate((kb) => {
    if (kb) Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => window.innerHeight - kb })
    else delete window.visualViewport.height
    window.visualViewport.dispatchEvent(new Event('resize'))
  }, kb)

/** 見えているボタン（名前の字で探す）を指で押す */
async function tapButton(page, selector, text) {
  const pt = await page.evaluate(
    (selector, text) => {
      const b = [...document.querySelectorAll(selector)].find((x) => x.getBoundingClientRect().width > 0 && (!text || x.textContent.includes(text)))
      if (!b) return null
      const r = b.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    },
    selector,
    text,
  )
  if (!pt) throw new Error(`見つかりません：${selector}（${text ?? ''}）`)
  await page.touchscreen.tap(pt.x, pt.y)
  await wait(400)
}
/** 見本の原稿の素材表（名称・使用箇所・生地見本） */
const ID = 't1'

/** 原稿の表（行・列の数、マスの字と id） */
const tableOf = (page) =>
  page.evaluate((id) => {
    const t = window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === id)
    return { rows: t.rows.length, cols: t.rows[0].cells.length, texts: t.rows.flatMap((r) => r.cells.map((c) => c.text)), ids: t.rows.map((r) => r.cells.map((c) => c.id)), images: t.rows.map((r) => r.cells.map((c) => !!c.imageId)) }
  }, ID)

/** 左の道具のボタンを、マウスで押す（名前の字で探す） */
async function clickTool(page, label) {
  const at = await page.evaluate((label) => {
    const b = [...document.querySelectorAll('.palette button')].find((x) => x.textContent.replace(/\s/g, '').includes(label) && x.getBoundingClientRect().width > 0)
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, label)
  if (!at) throw new Error(`左の道具に「${label}」がない`)
  await page.mouse.click(at.x, at.y)
  await wait(150)
}

const openCell = async (page, ready, id) => {
  await page.evaluate((id) => window.__editor.openEditor(id, 0), id)
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 15000 }, id)
  await wait(200)
}

export async function trialFixesPc(browser, check) {
  const { context, page, ready } = await openSample(browser, false)
  await page.setViewport({ width: 1366, height: 768 })
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, abstract: { ...r.abstract, started: false } })))
  await ready()
  await showTable(page, ready, ID)
  const t0 = await tableOf(page)

  // ---- 1. 前のマスで字を打って消し、「行を足す」→ Ctrl+Z：行を足したのが戻り、どのマスにも消した字は入らない ----
  await openCell(page, ready, t0.ids[1][1])
  await page.keyboard.type('丈')
  await wait(150)
  await page.keyboard.press('Backspace')
  await wait(150)
  await clickTool(page, '行を足す')
  await ready()
  await wait(300)
  const added = await tableOf(page)
  const editingAfterAdd = await page.evaluate(() => window.__editor.getSnapshot().editingId)
  await page.keyboard.down('Control')
  await page.keyboard.press('z')
  await page.keyboard.up('Control')
  await wait(300)
  await ready()
  await wait(300)
  const undone = await tableOf(page)
  await page.screenshot({ path: `${OUT}/pc-1-ctrlz-after-add-row.png` })
  check(
    'パソコン：マスで打って消してから「行を足す」→ 足した行のマスで何も打たずに Ctrl+Z：行を足したのが戻り、どのマスにも消した字（丈）は入らない',
    added.rows === t0.rows + 1 && editingAfterAdd === added.ids[2][0] && undone.rows === t0.rows && !undone.texts.some((t) => t.includes('丈')),
    JSON.stringify({ before: t0.rows, added: added.rows, editingAfterAdd, undone: undone.rows, stray: undone.texts.filter((t) => t.includes('丈')) }),
  )

  // ---- 2. 行を足し、別のマスで打って消して書き終える → 「元に戻す」1回で、行を足したのが戻る（空振りしない） ----
  await openCell(page, ready, t0.ids[1][0])
  await clickTool(page, '行を足す')
  await ready()
  await wait(300)
  const added2 = await tableOf(page)
  await openCell(page, ready, added2.ids[1][1])
  await page.keyboard.type('ア')
  await wait(150)
  await page.keyboard.press('Backspace')
  await wait(150)
  await page.keyboard.press('Escape')
  await wait(300)
  await ready()
  await page.click('.view-bar .undo-redo .tb:first-child')
  await wait(150)
  await wait(300)
  await ready()
  const undone2 = await tableOf(page)
  check(
    'パソコン：行を足したあと、別のマスで打って消しただけで書き終えても、「元に戻す」1回で行を足したのが戻る（1回目が空振りしない）',
    added2.rows === t0.rows + 1 && undone2.rows === t0.rows,
    JSON.stringify({ added: added2.rows, afterOneUndo: undone2.rows }),
  )

  // ---- 3. 生地見本の画像のマスを書いているときに「列を足す」：足した列の同じ行のマスへ移り、打った字はそこに入る ----
  const swatch = t0.images.map((row, r) => row.findIndex((x) => x) >= 0 && r > 0 ? [r, row.findIndex((x) => x)] : null).find(Boolean)
  const [sr, sc] = swatch
  await openCell(page, ready, t0.ids[sr][sc])
  await clickTool(page, '列を足す')
  await ready()
  await wait(400)
  const widened = await tableOf(page)
  const newCell = widened.ids[sr][sc + 1]
  const editingNew = await page.evaluate(() => window.__editor.getSnapshot().editingId)
  await page.keyboard.type('あ')
  await wait(200)
  await page.keyboard.press('Escape')
  await wait(300)
  await ready()
  const typed = await tableOf(page)
  await page.screenshot({ path: `${OUT}/pc-3-add-column.png` })
  check(
    'パソコン：生地見本の画像のマスを書いているときに「列を足す」：足した列の、同じ行のマスを書く（打った字は、画像のマスではなく足したマスに入る）',
    widened.cols === t0.cols + 1 && editingNew === newCell && typed.texts[typed.ids.flat().indexOf(newCell)] === 'あ' && typed.texts[typed.ids.flat().indexOf(t0.ids[sr][sc])] === t0.texts[t0.ids.flat().indexOf(t0.ids[sr][sc])],
    JSON.stringify({ cols: [t0.cols, widened.cols], editingNew, newCell, newText: typed.texts[typed.ids.flat().indexOf(newCell)] }),
  )
  // 足した列を戻しておく
  await page.evaluate(() => window.__editor.undo())
  await ready()
  await page.evaluate(() => window.__editor.undo())
  await ready()

  // ---- 4. ページの一覧の赤い点：直すところのエラーのあるページだけ（先生の許可を待つ抄録・まだ書いていない所には付けない） ----
  await page.evaluate(() =>
    window.__editor.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === 'p7' ? { ...b, content: [{ type: 'text', text: '私は二回目の仮縫いで丈を確かめた。' }] } : b)) })) })),
  )
  await ready()
  await wait(800)
  const dots = await page.evaluate(() => {
    const ed = window.__editor
    const kinds = ed.getSnapshot().layout.kinds
    const dotted = [...document.querySelectorAll('.thumbs-col .thumb-list .t')].map((t, i) => (t.classList.contains('has-error') ? i : -1)).filter((i) => i >= 0)
    return { dotted, abstract: kinds.indexOf('abstract'), p7: ed.pageOfBlock('p7') }
  })
  check(
    'パソコン：ページの一覧の赤い点は、直すところのエラー（一人称「私」）のあるページに付き、先生の許可を待つ抄録のページには付かない',
    dots.dotted.includes(dots.p7) && !dots.dotted.includes(dots.abstract),
    JSON.stringify(dots),
  )

  // ---- 5. 抄録を書き始める前の案内：言葉の切れ目でだけ折り返す（「入りませ／ん）。」にならない） ----
  await page.evaluate(() => window.__editor.goToPage(window.__editor.getSnapshot().layout.kinds.indexOf('abstract'), 'none'))
  await ready()
  await wait(300)
  const [title] = await linesIn(page, '.page-viewport.front .abstract-lock b')
  const [note] = await linesIn(page, '.page-viewport.front .abstract-lock span:not(.abstract-start)')
  await page.screenshot({ path: `${OUT}/pc-5-abstract-lock.png` })
  const starts = { title: ['抄録は、', '本文を書き終えて、', '先生のチェックで', '許可が出てから', '書きます。'], note: ['許可が出たら、', '下のボタンを', '押してください', '（それまで、', 'このページは', 'PDFには', '入りません）。'] }
  const onPhrase = (lines, phrases) => lines.every((l) => phrases.some((p) => l.startsWith(p)))
  check(
    'パソコン：抄録を書き始める前の案内は、言葉の切れ目でだけ折り返す（「…入りませ／ん）。」のように言葉の途中で折れない）',
    title?.length >= 1 && note?.length >= 1 && onPhrase(title, starts.title) && onPhrase(note, starts.note),
    JSON.stringify({ title, note }),
  )

  // ---- 5b. 章のいちばん最後の改ページ：空のページを作らない（次の章はもう次のページから始まる） ----
  const pagesBefore = await page.evaluate(() => window.__editor.getSnapshot().pageCount)
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, body: r.body.map((c, i) => (i === 0 ? { ...c, blocks: [...c.blocks, { type: 'pageBreak', id: 'pb-end' }] } : c)) })))
  await ready()
  await wait(500)
  const endBreak = await page.evaluate(() => ({
    pages: window.__editor.getSnapshot().pageCount,
    marker: !!document.querySelector('.page-viewport [data-block-id="pb-end"].page-break.end'),
    gap: window.__editor.getSnapshot().findings.some((f) => f.ruleId === 'page-break-gap'),
  }))
  check(
    'パソコン：章のいちばん最後に改ページを入れても、空のページはできない（改ページの印は残る。「ページの半分以上が空いている」とも言わない）',
    endBreak.pages === pagesBefore && endBreak.marker && !endBreak.gap,
    JSON.stringify({ pagesBefore, ...endBreak }),
  )
  await page.evaluate(() => window.__editor.undo())
  await ready()

  // ---- 6. 低い画面（1280×586）でも、「表を入れる」の大きさを選ぶメニューが画面に入り、「素材表」まで押せる ----
  await page.setViewport({ width: 1280, height: 586 })
  await wait(400)
  await ready()
  await openCell(page, ready, 'p7')
  await clickTool(page, '表を入れる')
  await page.waitForSelector('.table-menu')
  await wait(200)
  const menu = await page.evaluate(() => {
    const m = document.querySelector('.table-menu').getBoundingClientRect()
    const material = [...document.querySelectorAll('.table-menu > button')].find((b) => b.textContent.includes('素材表'))?.getBoundingClientRect()
    return { top: Math.round(m.top), bottom: Math.round(m.bottom), h: innerHeight, material: material ? Math.round(material.bottom) : null }
  })
  await page.screenshot({ path: `${OUT}/pc-6-table-menu-1280x586.png` })
  await page.keyboard.press('Escape')
  check(
    'パソコン（1280×586）：「表を入れる」の大きさを選ぶメニューは画面の中に収まり、下の「素材表」まで見えて押せる（前は下が切れていた）',
    menu.top >= 0 && menu.bottom <= menu.h && menu.material !== null && menu.material <= menu.h,
    JSON.stringify(menu),
  )

  // ---- 7. 低い画面の左の道具（mockups/v47 案C）：「元に戻す」は右下・道具のひとことは出さない・矢印は右下・「画像を入れる」は同じ所 ----
  await page.evaluate(() => window.__editor.finishEditing())
  await ready()
  // 作品写真を2枚（4枚の並べ方）にして、1枚目を選ぶ（全体の表示）
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, workPhotos: r.workPhotos.map((p, i) => (i === 0 ? { ...p, layout: 4, columns: 2, imageIds: [p.imageIds[0], p.imageIds[0], '', ''] } : p)) })))
  await ready()
  await page.evaluate(() => window.__editor.goToPage(window.__editor.getSnapshot().layout.kinds.indexOf('photos'), 'none'))
  await ready()
  await wait(300)
  const photoAt = await page.evaluate(() => { const r = document.querySelector('.page-viewport.front [data-photo-slot="0"] img').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  await page.mouse.click(photoAt.x, photoAt.y)
  await wait(500)
  const photoPal = await page.evaluate(() => {
    const p = document.querySelector('.palette')
    const r = p.getBoundingClientRect()
    const hidden = [...p.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().bottom > r.bottom + 1).map((b) => b.textContent.trim())
    return { scrolls: p.scrollHeight > p.clientHeight + 1, hidden, hint: getComputedStyle(document.querySelector('.palette .p-head span')).display, undoInBar: !!document.querySelector('.view-bar .undo-redo .tb'), undoInPalette: !!document.querySelector('.palette .undo-redo') }
  })
  await page.screenshot({ path: `${OUT}/pc-7-photo-1280x586.png` })
  check(
    'パソコン（1280×586）：作品写真を選んでも、左の道具が画面に入る（隠れるボタンがない）。道具のひとことは出さず、「元に戻す」「やり直す」は右下（mockups/v47 案C）',
    !photoPal.scrolls && photoPal.hidden.length === 0 && photoPal.hint === 'none' && photoPal.undoInBar && !photoPal.undoInPalette,
    JSON.stringify(photoPal),
  )
  // 拡大で表のマスを書く：ページ送りの「‹」は右下で、左の道具に重ならない。表を選ぶと「画像を入れる」は薄く、同じ所にある
  await page.evaluate(() => window.__editor.finishEditing())
  await page.evaluate(() => { const ed = window.__editor; const t = ed.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === 't1'); ed.goToPage(ed.pageOfBlock(t.rows[1].cells[0].id), 'none') })
  await ready()
  if (!(await page.evaluate(() => window.__editor.getSnapshot().zoomed))) {
    await page.evaluate(() => [...document.querySelectorAll('.zoom button')].find((b) => b.textContent.includes('拡大')).click())
    await ready()
  }
  const t1 = await tableOf(page)
  await openCell(page, ready, t1.ids[2][1])
  const imgSlot = () => page.evaluate(() => {
    const b = [...document.querySelectorAll('.palette .tb')].find((x) => x.textContent.includes('画像を入れる') || x.textContent.includes('画像を外す'))
    const rows = [...document.querySelectorAll('.palette .tb')].find((x) => x.textContent.includes('行を足す'))
    return { has: !!b, disabled: b?.disabled ?? null, rowsTop: rows ? Math.round(rows.getBoundingClientRect().top) : null }
  })
  const editingSlot = await imgSlot()
  const arrow = await page.evaluate(() => {
    const p = document.querySelector('.palette').getBoundingClientRect()
    const a = document.querySelector('.arrow.prev').getBoundingClientRect()
    return { overlap: a.left < p.right && a.right > p.left && a.top < p.bottom && a.bottom > p.top, rightSide: a.left > innerWidth / 2 }
  })
  await page.evaluate(() => window.__editor.finishEditing())
  await page.evaluate(() => window.__editor.select({ kind: 'table', id: 't1' }))
  await wait(400)
  const selectedSlot = await imgSlot()
  check(
    'パソコン（1280×586・拡大）：ページ送りの「‹」は右下で、左の道具に重ならない。表を選ぶと「画像を入れる」は薄く同じ所に出て、下の「行を足す」の位置がずれない',
    !arrow.overlap && arrow.rightSide && editingSlot.has && !editingSlot.disabled && selectedSlot.has && selectedSlot.disabled === true && selectedSlot.rowsTop === editingSlot.rowsTop,
    JSON.stringify({ arrow, editingSlot, selectedSlot }),
  )
  // 高い画面（1440×900）では、道具のひとことを出す
  await page.setViewport({ width: 1440, height: 900 })
  await wait(400)
  const tall = await page.evaluate(() => getComputedStyle(document.querySelector('.palette .p-head span')).display)
  check('パソコン（1440×900）：高い画面では、道具のひとこと（「クリックしてその場で書く」など）を今までどおり出す', tall !== 'none', tall)
  await context.close()
}

export async function trialFixesPhone(browser, check) {
  const { context, page, ready } = await openSample(browser, true)
  const snap = () => page.evaluate(() => { const s = window.__editor.getSnapshot(); return { editing: s.editingId, kind: s.editingKind, zoomed: s.zoomed, toast: document.querySelector('.undo-area')?.textContent ?? '' } })
  const cellText = (id) => page.evaluate((id) => window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === 't1').rows.flatMap((r) => r.cells).find((c) => c.id === id)?.text ?? null, id)
  const rows = () => page.evaluate(() => window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === 't1').rows.length)
  /** 紙面の要素（表に出ている方）を指で押して書き始め、キーボードを出す */
  const tapPaper = async (selector, dx = 30, dy = 4) => {
    const pt = await page.evaluate((sel, dx, dy) => { const r = document.querySelector(`.page-viewport.front ${sel}`).getBoundingClientRect(); return { x: r.left + Math.min(dx, r.width / 2), y: r.top + Math.min(dy, r.height / 2) } }, selector, dx, dy)
    await page.touchscreen.tap(pt.x, pt.y)
    await wait(800)
    await keyboard(page, KB)
    await wait(400)
  }
  const goTo = async (id) => {
    await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), id)
    await ready()
  }
  const stop = async () => {
    await page.evaluate(() => window.__editor.finishEditing())
    await keyboard(page, 0)
    await ready()
  }

  // ---- 1. 薄い「やり直す」を押しても、書き終わりにならない ----
  await goTo('p7')
  await tapPaper('[data-block-id="p7"]')
  const redoOff = await page.evaluate(() => [...document.querySelectorAll('.direct-bar .db-row button')].find((b) => b.textContent.includes('やり直す'))?.getAttribute('aria-disabled'))
  await tapButton(page, '.direct-bar .db-row button', 'やり直す')
  const afterGrey = await snap()
  check('スマホ：キーボードの上の道具の、薄い（押せない）「やり直す」を押しても、書き終わりにならない（紙面の拡大もそのまま）', redoOff === 'true' && afterGrey.editing === 'p7' && afterGrey.zoomed, JSON.stringify({ redoOff, afterGrey }))
  await stop()

  // ---- 2. 表のマスで打った字を、道具の「戻す」で戻せる ----
  const cell = await page.evaluate(() => window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === 't1').rows[2].cells[1].id)
  await goTo(cell)
  await tapPaper(`[data-cell-id="${cell}"]`, 40, 20)
  const original = await cellText(cell)
  await page.keyboard.sendCharacter('裏地')
  await wait(500)
  const typed = await cellText(cell)
  const undoOn = await page.evaluate(() => [...document.querySelectorAll('.direct-bar .db-row button')].find((b) => b.textContent.includes('戻す'))?.getAttribute('aria-disabled') !== 'true')
  await tapButton(page, '.direct-bar .db-row button', '戻す')
  await wait(400)
  const undone = await cellText(cell)
  const stillCell = await snap()
  check('スマホ：表のマスで打った字は、道具の「戻す」（押せる）で戻せ、マスを書き続ける', typed !== original && typed.includes('裏地') && undoOn && undone === original && stillCell.editing === cell, JSON.stringify({ original, typed, undoOn, undone, stillCell }))

  // ---- 3. 行を消すと、上の行のマスを書き続け、知らせが出る。「戻す」で行が戻り、書き続ける ----
  const r0 = await rows()
  await tapButton(page, '.direct-bar .db-table button', '行を消す')
  await ready()
  await wait(500)
  const cut = { rows: await rows(), ...(await snap()) }
  await page.screenshot({ path: `${OUT}/ph-3-row-cut.png` })
  await tapButton(page, '.undo-area button', '戻す')
  await ready()
  await wait(800)
  const back = { rows: await rows(), ...(await snap()) }
  check(
    'スマホ：「行を消す」のあとも上の行のマスを書き続け（キーボードの上の道具のまま）、「表の行を消しました［戻す］」が出る。「戻す」で行が戻り、消した行のマスを書き続ける',
    cut.rows === r0 - 1 && cut.kind === 'tableCell' && cut.zoomed && cut.toast.includes('表の行を消しました') && back.rows === r0 && back.editing === cell,
    JSON.stringify({ r0, cut, back }),
  )
  await stop()

  // ---- 4. 「追加」→「小見出し」で足した空の小見出しで Backspace：消して、前の欄の終わりへ ----
  await goTo('p7')
  await tapPaper('[data-block-id="p7"]')
  await stop()
  await tapButton(page, '.p-nav button', '追加')
  const hint = await linesIn(page, '.sheet .sheet-hint')
  await tapButton(page, '.sheet button', '小見出し')
  await ready()
  await wait(800)
  await keyboard(page, KB)
  const added = await snap()
  const subs = () => page.evaluate(() => window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).filter((b) => b.type === 'subheading').length)
  const s0 = await subs()
  await page.keyboard.press('Backspace')
  await wait(600)
  await ready()
  const removed = { subs: await subs(), ...(await snap()) }
  check(
    'スマホ：「追加」の「小見出し」で足した空の小見出しで Backspace を押すと、小見出しを消して前の段落の終わりを書く（足してしまった見出しを消せる）',
    added.kind === 'subheading' && removed.subs === s0 - 1 && removed.editing === 'p7' && removed.zoomed,
    JSON.stringify({ added, s0, removed }),
  )
  check(
    'スマホ：「追加」の欄の説明は、言葉の切れ目で折り返す（最後の行が「ら）。」のように短い切れ端にならない）',
    hint.length > 0 && hint.every((lines) => lines.length > 0 && lines.at(-1).length >= 4),
    JSON.stringify(hint),
  )
  await stop()

  // ---- 4b. 表の空いたマスの「＋」の印は、どのマスでも真ん中（狭い列でも上にずれない。依頼者の指摘 2026-10-21） ----
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === 't1' ? { ...b, rows: [...b.rows, { id: 'rx', cells: b.rows[0].cells.map((_, i) => ({ id: `rx:${i}`, text: '', imageId: null })) }] } : b)) })) })))
  await ready()
  await goTo('rx:0')
  await wait(500)
  const plus = await page.evaluate(() =>
    [0, 1, 2].map((i) => {
      const cell = document.querySelector(`.page-viewport.front [data-cell-id="rx:${i}"]`).getBoundingClientRect()
      const span = document.querySelector(`.page-viewport.front [data-cell-id="rx:${i}"] [data-block-id]`)
      const a = getComputedStyle(span, '::after')
      const s = span.getBoundingClientRect()
      return { cellMid: Math.round((cell.top + cell.bottom) / 2), markMid: Math.round(s.top + s.height / 2), content: a.content, top: a.top }
    }),
  )
  await page.screenshot({ path: `${OUT}/ph-4b-plus.png` })
  check(
    'スマホ：表の空いたマスの「＋」の印は、狭い列でもほかのマスと同じ高さ（マスの真ん中）に出る',
    plus.every((p) => p.content !== 'none' && Math.abs(p.markMid - p.cellMid) <= 3) && new Set(plus.map((p) => p.markMid)).size === 1,
    JSON.stringify(plus),
  )
  await page.evaluate(() => window.__editor.undo())
  await ready()

  // ---- 5. 表紙のサブタイトルを書く間も、後ろの「の衣装制作―」が書く欄の字のすぐ後ろに見える ----
  await page.evaluate(() => window.__editor.goToPage(0, 'none'))
  await ready()
  await tapPaper('[data-block-id="basic:subtitleInput"]', 60, 6)
  const sub = await page.evaluate(() => {
    const ov = document.querySelector('.overlay-editor')
    const after = ov ? getComputedStyle(ov, '::after').content : ''
    return { editing: window.__editor.getSnapshot().editingId, suffix: ov?.dataset.suffix ?? null, after, align: ov ? getComputedStyle(ov).textAlign : null }
  })
  await page.screenshot({ path: `${OUT}/ph-5-subtitle.png` })
  check(
    'スマホ：表紙のサブタイトルを書く間も、後ろの決まった字（「の衣装制作―」）が書く欄の字のすぐ後ろに見える（前は書く欄に隠れて消えたように見えた）',
    sub.editing === 'basic:subtitleInput' && !!sub.suffix && sub.suffix.includes('衣装制作') && sub.after.includes('衣装制作') && sub.align === 'left',
    JSON.stringify(sub),
  )
  await stop()
  await context.close()
}

// これだけを動かす：node scripts/e2e/trialFixes.mjs
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { withEdge } = await import('../poc/edge.mjs')
  const only = process.argv[2]
  const results = []
  const check = (name, ok, detail = '') => {
    results.push(ok)
    console.log(`${ok ? '✓' : '✗'} ${name}${detail && !ok ? `  (${detail})` : ''}`)
  }
  await withEdge(async (browser) => {
    if (only !== 'phone') await trialFixesPc(browser, check)
    if (only !== 'pc') await trialFixesPhone(browser, check)
  })
  const failed = results.filter((ok) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} 件 合格`)
  process.exitCode = failed ? 1 : 0
}
