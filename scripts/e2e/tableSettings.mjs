// 表の形を整える（mockups/v45 案A。依頼者の選んだ形。src/app/tableShape.tsx）を確かめる（Edge を自動で操作する。パソコンとスマホ）。
// - パソコン：左の道具の表の所は「画像を入れる・行を足す・列を足す・行を消す・列を消す・表の形を整える・削除」。「表の形を整える」を押すと、左の道具の左に窓。
//   窓には、列の幅（絵の付いた3つ：列の幅をそろえる・字の多い列を広く・自分で決める）・項目の列（左端）は字に合わせる（列の幅をそろえるのときだけ）・
//   行の高さをそろえる・「押すと、すぐ表が変わります」。選ぶとすぐ紙面の表が変わり（窓は開いたまま）、元に戻す1回で1つずつ戻る。
//   自分で決めるでは「表の縦の線を左右にドラッグ」と「同じ幅に戻す」。閉じるのは ×・Esc・窓の外を押す。キーボード：Tab で窓の中を回り、Space・Enter で選ぶ
// - パソコンの線のつまみ：ふだんは細いつまみ、マウスを乗せると ↔ のつまみと「左右にドラッグして／列の幅を変える」。動かしている間は「◀ せまくなる」「広くなる ▶」。数（%）は出さない
// - スマホ：キーボードの上の道具の表の段は、横にずらさない7つ（「表の形」を含む。どれも 44px 以上）。「表の形」で下から「表の形を整える」の欄（絵つき・44px 以上・「できた」）。
//   「自分で決める」で欄が閉じ、紙面の丸いつまみ（v42 案D のまま）と「丸を左右に動かす」。列の幅の数は出さない
// - 1280×720・1366×768・390px で、1字だけの行はない
// smoke.mjs（tableSettingsPc）・phone.mjs（tableSettingsPhone）から呼ぶ。これだけを動かすときは node scripts/e2e/tableSettings.mjs [pc|phone]。画面の写真は poc-output/table-settings-a/
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { FEATURES, openSample, shapeOf, showTable } from './tableShape.mjs'
import { closeShape, linesIn, loneOf, openShape, pickWidth, setCheck, shapeState } from './shapeUi.mjs'

const OUT = 'poc-output/table-settings-a'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const ID = 't1'

/** 見本の素材表に「特徴」の列を足す（名称・使用箇所・特徴・生地見本。mockups/v45 と同じ） */
const addFeatureColumn = (page) =>
  page.evaluate((FEAT) => {
    window.__editor.update((r) => ({
      ...r,
      body: r.body.map((c) => ({
        ...c,
        blocks: c.blocks.map((b) =>
          b.id !== 't1'
            ? b
            : { ...b, rows: b.rows.map((row, i) => ({ ...row, cells: [...row.cells.slice(0, 2), i === 0 ? { id: 't1:hf', text: FEAT.head, imageId: null } : { id: `${row.id}:feat`, text: FEAT.rows[i - 1], imageId: null }, ...row.cells.slice(2)] })) },
        ),
      })),
    }))
  }, FEATURES)

/** 原稿の表の形 */
const modelOf = (page) =>
  page.evaluate((id) => {
    const t = window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === id)
    return { widths: t.widths, heights: t.heights, label: t.labelColumn === true, colWidths: t.colWidths ?? null }
  }, ID)

const editingOf = (page) => page.evaluate(() => window.__editor.getSnapshot().editingId)

/** 窓・左の道具・表を一緒に写す */
async function shotAround(page, name, selectors = ['.shape-panel', '.palette', `.page-viewport.front .data-table[data-table-id="${ID}"]`]) {
  const clip = await page.evaluate((selectors) => {
    const rs = selectors.map((s) => document.querySelector(s)?.getBoundingClientRect()).filter((r) => r && r.width > 0)
    const left = Math.max(0, Math.min(...rs.map((r) => r.left)) - 12)
    const top = Math.max(0, Math.min(...rs.map((r) => r.top)) - 12)
    const right = Math.min(innerWidth, Math.max(...rs.map((r) => r.right)) + 12)
    const bottom = Math.min(innerHeight, Math.max(...rs.map((r) => r.bottom)) + 40)
    return { x: left, y: top, width: right - left, height: bottom - top }
  }, selectors)
  await page.screenshot({ path: `${OUT}/${name}.png`, clip, captureBeyondViewport: false })
}

/** 窓の中の言葉と、左の道具の言葉の行（1字だけの行を探す） */
const PANEL_TEXT = '.shape-panel :is(.sp-head b, .so-sec, .so-choice b, .so-choice small, .so-check b, .so-check small, .so-guide p, .so-even, .so-note), .palette .tb span, .palette .p-head span, .palette .ctx-label'

export async function tableSettingsPc(browser, check) {
  const { context, page, ready } = await openSample(browser, false)
  await page.setViewport({ width: 1366, height: 768 })
  await addFeatureColumn(page)
  await ready()
  await showTable(page, ready, ID)
  const clickCell = async (id) => {
    const at = await page.evaluate((id) => {
      const el = document.querySelector(`.page-viewport.front [data-cell-id="${id}"]`)
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }, id)
    await page.mouse.click(at.x, at.y)
    await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 10000 }, id).catch(() => {})
    await wait(300)
  }

  // ---- 左の道具：表の所は7つ（画像・行・列を足す・行・列を消す・表の形を整える・削除。画像は書いているマス1つに入れるので先頭）。前の切り替え（列の幅・左端の列・行の高さのボタン）はない ----
  await clickCell('m2:feat')
  const tools = await page.evaluate(() => ({
    names: [...document.querySelectorAll('.palette .group.ctx .tb')].map((b) => b.textContent.trim()),
    old: document.querySelectorAll('.palette .seg, .palette .ctx-label.sub, .palette .custom-hint').length,
    expanded: document.querySelector('.palette .shape-btn')?.getAttribute('aria-expanded'),
  }))
  await shotAround(page, 'pc-0-palette', ['.palette', `.page-viewport.front .data-table[data-table-id="t1"]`])
  check(
    'パソコン：表のセルを書いているとき、左の道具の表の所は「画像を入れる・行を足す・列を足す・行を消す・列を消す・表の形を整える・削除」（列の幅・左端の列・行の高さの切り替えのボタンはない）',
    JSON.stringify(tools.names) === JSON.stringify(['画像を入れる', '行を足す', '列を足す', '行を消す', '列を消す', '表の形を整える', '削除']) && tools.old === 0 && tools.expanded === 'false',
    JSON.stringify(tools),
  )

  // ---- 押すと、左の道具の左に窓。書いているセルは書いたまま（カーソルもセルに） ----
  await openShape(page)
  const panel = await shapeState(page)
  const where = await page.evaluate(() => {
    const p = document.querySelector('.shape-panel').getBoundingClientRect()
    const pal = document.querySelector('.palette').getBoundingClientRect()
    const btn = document.querySelector('.palette .shape-btn')
    const b = btn.getBoundingClientRect()
    const tail = parseFloat(getComputedStyle(document.querySelector('.shape-panel')).getPropertyValue('--tail'))
    return {
      left: p.right <= pal.left + 0.5,
      inside: p.top >= 0 && p.bottom <= innerHeight && p.left >= 0,
      tailAtButton: Math.abs(p.top + tail - (b.top + b.height / 2)) <= 2,
      open: btn.classList.contains('open') && btn.getAttribute('aria-expanded') === 'true',
      focusInCell: document.activeElement?.classList.contains('overlay-editor') ?? false,
    }
  })
  await shotAround(page, 'pc-1-open')
  await page.screenshot({ path: `${OUT}/pc-1-open-full.png` })
  check(
    'パソコン：「表の形を整える」を押すと、左の道具の左に「表の形を整える」の窓が開き、矢印がボタンを指す（ボタンは塗った形）。書いているセルは書いたまま（カーソルもセル）',
    panel?.kind === 'panel' && panel.title === '表の形を整える' && where.left && where.inside && where.tailAtButton && where.open && where.focusInCell && (await editingOf(page)) === 'm2:feat',
    JSON.stringify({ title: panel?.title, where }),
  )
  check(
    'パソコン：窓には、列の幅の3つ（列の幅をそろえる／どの列も同じ幅・字の多い列を広く／字の量に合わせて自動で・自分で決める／線をドラッグ）、項目の列（左端）は字に合わせる／ほかの列は同じ幅、行の高さをそろえる／見出しの行は別、「押すと、すぐ表が変わります」',
    JSON.stringify(panel.widths.map((w) => w.text)) === JSON.stringify(['列の幅をそろえるどの列も同じ幅', '字の多い列を広く字の量に合わせて自動で', '自分で決める線をドラッグ']) &&
      panel.widths[0].on &&
      panel.label.text === '項目の列（左端）は字に合わせるほかの列は同じ幅' &&
      panel.heights.text === '行の高さをそろえる見出しの行は別' &&
      panel.note === '押すと、すぐ表が変わります' &&
      (await page.evaluate(() => document.querySelectorAll('.shape-panel svg.pic').length)) === 5,
    JSON.stringify(panel),
  )

  // ---- 選ぶと、すぐ紙面の表が変わる（窓は開いたまま）。項目の列は「列の幅をそろえる」のときだけ ----
  await pickWidth(page, 'auto', { ready })
  await showTable(page, ready, ID)
  const auto = { model: await modelOf(page), paper: (await shapeOf(page, ID))?.cls, panel: await shapeState(page), editing: await editingOf(page) }
  await shotAround(page, 'pc-2-auto')
  check(
    'パソコン：「字の多い列を広く」を押すと、すぐ紙面の表が変わる（窓は開いたまま・セルは書いたまま）。「項目の列（左端）」はうすくなり「「列の幅をそろえる」のときだけ」',
    auto.model.widths === 'auto' && auto.paper.includes('widths-auto') && auto.panel?.widths[1].on && auto.panel.label.disabled && auto.panel.label.text.includes('「列の幅をそろえる」のときだけ') && auto.editing === 'm2:feat',
    JSON.stringify(auto),
  )
  // 左の道具の「元に戻す」1回で戻る（窓の外を押すので、窓は閉じる。開き直すと、印も「列の幅をそろえる」に戻っている）
  const undoBtn = () => page.click('.view-bar .undo-redo .tb:first-child')
  await undoBtn()
  await wait(300)
  await ready()
  const undoModel = await modelOf(page)
  await clickCell('m2:feat')
  await openShape(page)
  const undoWidth = { model: undoModel, panel: await shapeState(page) }
  check('パソコン：列の幅の切り替えは、左の道具の「元に戻す」1回で戻る（開き直した窓の印も「列の幅をそろえる」）', undoWidth.model.widths === 'equal' && undoWidth.panel?.widths[0].on === true, JSON.stringify({ model: undoWidth.model, widths: undoWidth.panel?.widths.map((w) => w.on) }))
  // 項目の列・行の高さ：1つずつ、元に戻す1回で戻る
  await setCheck(page, 'label', true, { ready })
  await setCheck(page, 'heights', true, { ready })
  const both = { model: await modelOf(page), panel: await shapeState(page) }
  await shotAround(page, 'pc-3-checks')
  await undoBtn()
  await wait(300)
  await ready()
  const undo1 = await modelOf(page)
  await page.evaluate(() => window.__editor.undo())
  await ready()
  const undo2 = await modelOf(page)
  await page.evaluate(() => window.__editor.redo())
  await ready()
  await page.evaluate(() => window.__editor.redo())
  await ready()
  await clickCell('m2:feat')
  check(
    'パソコン：「項目の列（左端）は字に合わせる」「行の高さをそろえる」に印を付けると、そのとおりになり、元に戻す1回で1つずつ戻る（行の高さ → 項目の列）',
    both.model.label && both.model.heights === 'equal' && both.panel.label.on && both.panel.heights.on && undo1.label && undo1.heights === 'auto' && !undo2.label && undo2.heights === 'auto',
    JSON.stringify({ both: both.model, undo1, undo2 }),
  )

  // ---- 自分で決める：窓に「表の縦の線を左右にドラッグ」と「同じ幅に戻す」 ----
  await pickWidth(page, 'custom', { ready })
  const custom = await shapeState(page)
  await wait(300)
  await shotAround(page, 'pc-4-custom')
  check(
    'パソコン：「自分で決める」を押すと、窓に「表の縦の線を左右にドラッグ」と「同じ幅に戻す」。項目の列はうすい',
    custom.widths[2].on && custom.guide === '表の縦の線を左右にドラッグ同じ幅に戻す' && custom.label.disabled && (await modelOf(page)).widths === 'custom',
    JSON.stringify(custom),
  )

  // ---- 線のつまみ：マウスを乗せると ↔ と一言、動かしている間は「せまくなる」「広くなる」（数は出さない）。窓は開いたまま ----
  const grips = await page.evaluate(() => [...document.querySelectorAll('.col-handles .col-grip .col-knob')].map((k) => { const r = k.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: Math.round(r.width), h: Math.round(r.height) } }))
  await page.mouse.move(grips[1].x, grips[1].y)
  await wait(300)
  const hover = await page.evaluate(() => {
    const k = document.querySelector('.col-handles .col-grip:hover .col-knob')?.getBoundingClientRect()
    const tip = document.querySelector('.col-tip')
    return { knob: k && [Math.round(k.width), Math.round(k.height)], arrows: !!document.querySelector('.col-handles .col-grip:hover .col-knob svg'), tip: tip && !tip.hidden ? tip.textContent : null }
  })
  await shotAround(page, 'pc-5-hover', ['.palette', `.page-viewport.front .data-table[data-table-id="${ID}"]`, '.col-tip'])
  const tableW = await page.evaluate((id) => document.querySelector(`.page-viewport.front .data-table[data-table-id="${id}"] table`).getBoundingClientRect().width, ID)
  const before = await modelOf(page)
  await page.mouse.down()
  await page.mouse.move(grips[1].x - tableW * 0.11, grips[1].y, { steps: 6 })
  await wait(200)
  const drag = await page.evaluate(() => ({
    chips: [...document.querySelectorAll('.col-handles .col-chip')].filter((c) => !c.hidden).map((c) => [c.textContent, c.classList.contains('wide')]),
    shades: [...document.querySelectorAll('.col-handles .col-shade')].filter((c) => !c.hidden).length,
    ghost: !!document.querySelector('.col-handles .col-ghost'),
    percent: /%/.test(document.querySelector('.col-handles').textContent + document.querySelector('.col-tip').textContent + (document.querySelector('.shape-panel')?.textContent ?? '') + document.querySelector('.palette').textContent),
    panel: !!document.querySelector('.shape-panel'),
  }))
  await shotAround(page, 'pc-6-drag', ['.shape-panel', '.palette', `.page-viewport.front .data-table[data-table-id="${ID}"]`, '.col-chip'])
  await page.mouse.up()
  await wait(400)
  await ready()
  const after = await modelOf(page)
  check(
    'パソコン：線のつまみは、ふだん細い形（12×28）。マウスを乗せると ↔ の付いた大きいつまみ（34×24）と「左右にドラッグして／列の幅を変える」',
    grips.length === 3 && grips.every((g) => g.w === 12 && g.h === 28) && JSON.stringify(hover.knob) === '[34,24]' && hover.arrows && hover.tip === '左右にドラッグして列の幅を変える',
    JSON.stringify({ grips, hover }),
  )
  check(
    'パソコン：線を左へ動かしている間は、となりの2列に色と、左の列に「◀ せまくなる」・右の列に「広くなる ▶」の札。元の位置に点線。数（%）はどこにも出さない。窓は開いたまま。離すと 5% ずつ（10% 動かした）変わる',
    JSON.stringify(drag.chips) === JSON.stringify([['◀ せまくなる', false], ['広くなる ▶', true]]) &&
      drag.shades === 2 &&
      drag.ghost &&
      !drag.percent &&
      drag.panel &&
      after.colWidths[1] === before.colWidths[1] - 10 &&
      after.colWidths[2] === before.colWidths[2] + 10,
    JSON.stringify({ drag, before: before.colWidths, after: after.colWidths }),
  )

  // ---- 閉じる：×・Esc・窓の外を押す（書いているセルは書いたまま） ----
  await closeShape(page)
  const byX = { open: !!(await page.$('.shape-panel')), editing: await editingOf(page), focus: await page.evaluate(() => document.activeElement?.classList.contains('overlay-editor')) }
  await openShape(page)
  await page.keyboard.press('Escape')
  await wait(300)
  const byEsc = { open: !!(await page.$('.shape-panel')), editing: await editingOf(page) }
  await openShape(page)
  const blank = await page.evaluate(() => {
    const r = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current, .page-viewport.front [data-vivliostyle-page-container]').getBoundingClientRect()
    return { x: r.right + 30, y: r.top + 40 }
  })
  await page.mouse.click(blank.x, blank.y)
  await wait(400)
  const byOutside = !(await page.$('.shape-panel'))
  check(
    'パソコン：窓は「×」・Esc・窓の外を押すと閉じる（× と Esc では、書いているセルは書いたまま。× のあとはカーソルもセルに戻る）',
    !byX.open && byX.editing === 'm2:feat' && byX.focus && !byEsc.open && byEsc.editing === 'm2:feat' && byOutside,
    JSON.stringify({ byX, byEsc, byOutside }),
  )

  // ---- キーボード：Tab で「表の形を整える」へ、Enter で開くと窓の中（選んでいる形）へ。Tab で窓の中を回り、Space・Enter で選ぶ。Esc で閉じてボタンへ戻る ----
  await page.evaluate(() => window.__editor.finishEditing())
  await ready()
  await page.evaluate((id) => window.__editor.setTableWidths(id, 'equal'), ID)
  await ready()
  await clickCell('m2:feat')
  await page.focus('.palette .shape-btn')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.shape-panel', { timeout: 5000 })
  await wait(300)
  const desc = () => page.evaluate(() => { const a = document.activeElement; return { inPanel: !!a?.closest('.shape-panel'), what: a?.dataset.value ?? a?.dataset.key ?? a?.className ?? '' } })
  const first = await desc()
  const ring = []
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press('Tab')
    ring.push(await desc())
  }
  // 「字の多い列を広く」に Tab で移って Space、「行の高さをそろえる」に移って Enter
  const tabTo = async (what) => {
    for (let i = 0; i < 8 && (await desc()).what !== what; i++) await page.keyboard.press('Tab')
  }
  await tabTo('auto')
  await page.keyboard.press('Space')
  await wait(300)
  await ready()
  const spaced = await modelOf(page)
  await tabTo('heights')
  const heightsBefore = (await modelOf(page)).heights
  await page.keyboard.press('Enter')
  await wait(300)
  await ready()
  const entered = await modelOf(page)
  await page.screenshot({ path: `${OUT}/pc-7-keyboard.png` })
  await page.keyboard.press('Escape')
  await wait(300)
  const afterEsc = await page.evaluate(() => ({ open: !!document.querySelector('.shape-panel'), focus: document.activeElement?.classList.contains('shape-btn') ?? false, editing: window.__editor.getSnapshot().editingId }))
  check(
    'パソコン：キーボードで「表の形を整える」を押すと、窓の中の選んでいる形（列の幅をそろえる）へ移る。Tab で窓の中の物（×・3つの選び・項目の列・行の高さ）を回り、窓の外へは出ない',
    first.inPanel && first.what === 'equal' && ring.every((r) => r.inPanel) && ['sp-close', 'equal', 'auto', 'custom', 'label', 'heights'].every((w) => [first, ...ring].some((r) => r.what === w || r.what.includes(w))),
    JSON.stringify({ first, ring }),
  )
  check(
    'パソコン：キーボードの Space で列の幅の選び、Enter で行の高さのチェックが切り替わる。Esc で窓が閉じ、「表の形を整える」に戻る（セルは書いたまま）',
    spaced.widths === 'auto' && entered.heights !== heightsBefore && !afterEsc.open && afterEsc.focus && afterEsc.editing === 'm2:feat',
    JSON.stringify({ spaced, heightsBefore, entered, afterEsc }),
  )

  // ---- 1字だけの行はない（1366×768・1280×720。窓は、いちばん長い「自分で決める」と「字の多い列を広く」で） ----
  const lone = []
  for (const [w, h] of [
    [1366, 768],
    [1280, 720],
  ]) {
    await page.setViewport({ width: w, height: h })
    await wait(600)
    await ready()
    await clickCell('m2:feat')
    for (const v of ['custom', 'auto', 'equal']) {
      await pickWidth(page, v, { ready })
      const lines = await linesIn(page, PANEL_TEXT)
      lone.push(...loneOf(lines).map((x) => `${w}×${h} ${v}: ${x}`))
      if (v === 'custom') await page.screenshot({ path: `${OUT}/pc-8-${w}x${h}-custom.png` })
    }
    await closeShape(page)
  }
  check('パソコン（1366×768・1280×720）：窓・左の道具の言葉に、1字だけの行はない', lone.length === 0, JSON.stringify(lone))
  // 1280×586（1280×720 の画面のブラウザの中）：左の道具も窓も画面に入る（写真）
  await page.setViewport({ width: 1280, height: 586 })
  await wait(600)
  await ready()
  await clickCell('m2:feat')
  await pickWidth(page, 'custom', { ready })
  await page.screenshot({ path: `${OUT}/pc-9-1280x586-custom.png` })
  await closeShape(page)
  await page.evaluate(() => window.__editor.finishEditing())
  await context.close()
}

export async function tableSettingsPhone(browser, check) {
  const { context, page, ready } = await openSample(browser, true)
  const cdp = await page.createCDPSession()
  await addFeatureColumn(page)
  await ready()
  await showTable(page, ready, ID)
  const tapCell = async (id) => {
    const at = await page.evaluate((id) => {
      const r = document.querySelector(`.page-viewport.front [data-cell-id="${id}"]`).getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }, id)
    await page.touchscreen.tap(at.x, at.y)
    await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 10000 }, id).catch(() => {})
    await wait(600)
  }
  const opts = { phone: true, ready }

  // ---- キーボードの上の道具の表の段：横にずらさない7つ（「表の形」を含む）。どれも 44px 以上。1字だけの行はない ----
  await tapCell('m2:feat')
  const bar = await page.evaluate(() => {
    const row = document.querySelector('.direct-bar .db-table')
    return {
      tools: [...row.querySelectorAll('button')].map((b) => { const r = b.getBoundingClientRect(); return { name: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), inside: r.left >= -0.5 && r.right <= innerWidth + 0.5 } }),
      scrolls: row.scrollWidth > row.clientWidth + 0.5,
      overflowX: getComputedStyle(row).overflowX,
      pic: !!row.querySelector('.shape-btn svg.pic'),
    }
  })
  const barLines = await linesIn(page, '.direct-bar .db-table button')
  await page.screenshot({ path: `${OUT}/ph-1-bar.png` })
  check(
    'スマホ：表のセルを書いている間、キーボードの上の道具の表の段は「画像・行を足す・列を足す・行を消す・列を消す・表の形・表を削除」の7つ。横にずらさず全部が画面に入り、どれも 44px 以上（「表の形」は表の絵つき）。名前は1行',
    JSON.stringify(bar.tools.map((t) => t.name)) === JSON.stringify(['画像', '行を足す', '列を足す', '行を消す', '列を消す', '表の形', '表を削除']) &&
      bar.tools.every((t) => t.w >= 44 && t.h >= 44 && t.inside) &&
      !bar.scrolls &&
      bar.overflowX !== 'auto' &&
      bar.pic &&
      barLines.every((l) => l.length === 1),
    JSON.stringify({ bar, barLines }),
  )

  // ---- 「表の形」：下から「表の形を整える」の欄（できた・絵の付いた選び・押す所は 44px 以上・1字だけの行はない） ----
  await openShape(page, true)
  const sheet = await shapeState(page)
  const sheetInfo = await page.evaluate(() => {
    const s = document.querySelector('.table-shape')
    const r = s.getBoundingClientRect()
    return {
      inside: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight + 0.5,
      pics: s.querySelectorAll('svg.pic').length,
      buttons: [...s.querySelectorAll('button')].map((b) => { const q = b.getBoundingClientRect(); return [b.textContent.trim().slice(0, 8), Math.round(q.width), Math.round(q.height)] }),
      cardsInRow: (() => { const c = [...s.querySelectorAll('.so-choice')].map((b) => Math.round(b.getBoundingClientRect().top)); return c.length === 3 && c.every((t) => t === c[0]) })(),
    }
  })
  const sheetLines = await linesIn(page, '.table-shape :is(h2, .so-sec, .so-choice b, .so-choice small, .so-check b, .so-check small, .ts-done)')
  await page.screenshot({ path: `${OUT}/ph-2-sheet.png` })
  check(
    'スマホ：「表の形」を押すと、下から「表の形を整える」の欄（「できた」）。列の幅は絵が上の選びを横に3つ（列の幅をそろえる・字の多い列を広く・自分で決める／丸を左右に動かす）、項目の列（左端）・行の高さのチェック（絵つき）。押す所はどれも 44px 以上。1字だけの行はない',
    sheet?.kind === 'sheet' &&
      sheet.title === '表の形を整える' &&
      sheetInfo.inside &&
      sheetInfo.pics === 5 &&
      sheetInfo.cardsInRow &&
      sheetInfo.buttons[0][0] === 'できた' &&
      sheetInfo.buttons.every(([, w, h]) => w >= 44 && h >= 44) &&
      sheet.widths[2].text.includes('丸を左右に動かす') &&
      loneOf(sheetLines).length === 0,
    JSON.stringify({ sheet: sheet?.widths.map((w) => w.text), sheetInfo, lone: loneOf(sheetLines) }),
  )

  // ---- 欄で選ぶと、すぐ紙面の表が変わる。元に戻す1回で1つずつ戻る ----
  await pickWidth(page, 'auto', opts)
  const auto = { model: await modelOf(page), sheet: await shapeState(page) }
  await page.screenshot({ path: `${OUT}/ph-3-auto.png` })
  await pickWidth(page, 'equal', opts)
  await setCheck(page, 'label', true, opts)
  await setCheck(page, 'heights', true, opts)
  const both = await modelOf(page)
  await page.evaluate(() => window.__editor.undo())
  await ready()
  const undo1 = await modelOf(page)
  await page.evaluate(() => window.__editor.undo())
  await ready()
  const undo2 = await modelOf(page)
  check(
    'スマホ：欄で「字の多い列を広く」を押すとすぐそうなり、「項目の列（左端）」はうすくなる（「列の幅をそろえる」のときだけ）。項目の列・行の高さの印も、すぐ表に入り、元に戻す1回で1つずつ戻る',
    auto.model.widths === 'auto' && auto.sheet.label.disabled && both.widths === 'equal' && both.label && both.heights === 'equal' && undo1.label && undo1.heights === 'auto' && !undo2.label,
    JSON.stringify({ auto: auto.model, both, undo1, undo2 }),
  )

  // ---- 「自分で決める」：欄が閉じ、紙面の丸いつまみ（v42 案D のまま）と「丸を左右に動かす」。列の幅の数は出さない ----
  // （元に戻すと書き終えるので、マスを押し直してから）
  await tapCell('m2:feat')
  await pickWidth(page, 'custom', opts)
  await wait(500)
  await ready()
  const custom = await page.evaluate(() => ({
    sheet: !!document.querySelector('.table-shape'),
    knobs: document.querySelectorAll('.col-handles .col-pknob').length,
    third: !!document.querySelector('.direct-bar .db-colw'),
    hint: document.querySelector('.col-handles .col-hint')?.textContent ?? null,
    percent: /%/.test(document.querySelector('.direct-bar').textContent + document.querySelector('.col-handles').textContent),
    editing: window.__editor.getSnapshot().editingId,
  }))
  const guideLines = await linesIn(page, '.col-handles .col-hint')
  await page.screenshot({ path: `${OUT}/ph-4-custom.png` })
  check(
    'スマホ：欄で「自分で決める」を押すと、欄が閉じて、書いているマスの列の両側に丸いつまみ。キーボードの上の道具は2段のまま、表の上に「丸を左右に動かすと、列の幅が変わります」（mockups/v48 C）。列の幅の数（%）は出さない。1字だけの行はない',
    (await modelOf(page)).widths === 'custom' && !custom.sheet && custom.knobs === 2 && !custom.third && custom.hint === '丸を左右に動かすと、列の幅が変わります' && !custom.percent && custom.editing === 'm2:feat' && guideLines.every((l) => l.length === 1),
    JSON.stringify({ custom, guideLines }),
  )

  // ---- 丸いつまみは今までどおり動く（指で右のつまみを左へ）。動かしている間は「せまくなる」「広くなる」（数は出さない） ----
  const knob = await page.evaluate(() => {
    const k = [...document.querySelectorAll('.col-handles .col-pknob')].find((x) => x.dataset.border === '2')
    const r = k.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  const tableW = await page.evaluate((id) => document.querySelector(`.page-viewport.front .data-table[data-table-id="${id}"] table`).getBoundingClientRect().width, ID)
  const before = await modelOf(page)
  const pts = (dx) => [{ x: knob.x + dx, y: knob.y, id: 1 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(0) })
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts((-tableW * 0.11 * i) / 8) })
    await wait(30)
  }
  const drag = await page.evaluate(() => ({
    chips: [...document.querySelectorAll('.col-handles .col-chip')].filter((c) => !c.hidden).map((c) => c.textContent),
    percent: /%/.test(document.querySelector('.col-handles').textContent),
  }))
  await page.screenshot({ path: `${OUT}/ph-5-knob-drag.png` })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await wait(500)
  await ready()
  const after = await modelOf(page)
  check(
    'スマホ：丸いつまみは今までどおり指で動かせる（右のつまみを左へ 10%：書いている列がせまく、右どなりが広く）。動かしている間は表の上に「◀ せまくなる」「広くなる ▶」（数は出さない）',
    JSON.stringify(drag.chips) === JSON.stringify(['◀ せまくなる', '広くなる ▶']) && !drag.percent && after.colWidths[2] === before.colWidths[2] - 10 && after.colWidths[3] === before.colWidths[3] + 10,
    JSON.stringify({ drag, before: before.colWidths, after: after.colWidths }),
  )
  await page.tap('.direct-bar .db-done')
  await wait(400)
  await context.close()
}

// これだけを動かす：node scripts/e2e/tableSettings.mjs（pc・phone で片方だけ）
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { withEdge } = await import('../poc/edge.mjs')
  const only = process.argv[2]
  const results = []
  const check = (name, ok, detail = '') => {
    results.push(ok)
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
  }
  await withEdge(async (browser) => {
    if (only !== 'phone') await tableSettingsPc(browser, check)
    if (only !== 'pc') await tableSettingsPhone(browser, check)
  })
  const failed = results.filter((ok) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} 件 合格`)
  process.exitCode = failed ? 1 : 0
}
