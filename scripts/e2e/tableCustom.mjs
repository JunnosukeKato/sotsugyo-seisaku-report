// 表の列の幅を「自分で決める」（mockups/v42 の依頼者の選んだ形。Edge を自動で操作する。パソコンとスマホ）。
// - 列の幅は3つ（そろえる・中身に合わせる・自分で決める）。自分で決めるにすると、いま見えている幅から始まる（見た目を変えない）。ほかへ切り替えても、決めた幅は覚えておく
// - 列の幅を選ぶのは「表の形を整える」の窓（スマホは「表の形」の下から出る欄。mockups/v45 案A。scripts/e2e/shapeUi.mjs）
// - パソコン：表のセル・タイトルを書いている間（表を選んでいる間）だけ、内側の縦の線に細い線とつまみ。マウスを乗せると col-resize・大きいつまみと「左右にドラッグして／列の幅を変える」。
//   ドラッグで、となりの2列だけが 5% ずつ変わり、となりの2列に色と、表の下に「◀ せまくなる」「広くなる ▶」（数（%）は出さない。mockups/v45 ②）。どの列も 10% より狭くならない。
//   窓に「表の縦の線を左右にドラッグ」と「同じ幅に戻す」
// - スマホ：自分で決めるでは、セルの列をうすく色付けし、両側の線に丸いつまみ（v42 案D のまま。依頼者の判断）。キーボードの上の道具に「丸を左右に動かす」「同じ幅に戻す」。
//   指1本で動かすと、その側のとなりの列と幅をやりとりする（札は「せまくなる」「広くなる」）。紙面を動かさない・ページを送らない・2本指の拡大を始めない
// - 元に戻す1回で、ドラッグ1回・そろえ直す・切り替えが戻る。PDF の列の幅は紙面と同じ（1px 以内）。列を足す・消すときの決まり
// smoke.mjs（tableCustomPc）・phone.mjs（tableCustomPhone）から呼ぶ。これだけを動かすときは node scripts/e2e/tableCustom.mjs [pc|phone]。画面の写真は poc-output/table-custom/
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { FEATURES, openSample, pdfShape, shapeOf, showTable } from './tableShape.mjs'
import { closeShape, linesIn, loneOf, openShape, pickWidth, shapeState } from './shapeUi.mjs'

const OUT = 'poc-output/table-custom'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const ID = 't1'

/** 見本の素材表に「特徴」の列を足す（名称・使用箇所・特徴・生地見本。mockups/v42 と同じ） */
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

/** 原稿の表の列の幅の形と、自分で決めた幅 */
const modelOf = (page) =>
  page.evaluate((id) => {
    const t = window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === id)
    return { widths: t.widths, colWidths: t.colWidths ?? null, columns: t.rows[0].cells.length }
  }, ID)

/** 紙面の列の幅（%。見出しの行のセルの幅の割合） */
const pctOf = (cols) => {
  const sum = cols.reduce((a, b) => a + b, 0)
  return cols.map((c) => Math.round((c / sum) * 1000) / 10)
}
const same = (a, b, tol) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol)
const r1 = (list) => list.map((v) => Math.round(v * 10) / 10)

/** 紙面の部品（境目の線・つまみ・札など） */
const handlesOf = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('.col-handles')
    const vis = (el) => !!el && !el.hidden && el.getBoundingClientRect().width > 0
    return {
      shown: !!root && !root.hidden,
      grips: [...document.querySelectorAll('.col-handles .col-grip')].map((g) => {
        const r = g.getBoundingClientRect()
        const k = g.querySelector('.col-knob').getBoundingClientRect()
        return { x: r.left + r.width / 2, top: r.top, bottom: r.bottom, knob: { x: k.left + k.width / 2, y: k.top + k.height / 2, w: k.width, h: k.height }, cursor: getComputedStyle(g).cursor }
      }),
      knobs: [...document.querySelectorAll('.col-handles .col-pknob')].map((g) => {
        const r = g.getBoundingClientRect()
        const s = g.querySelector('span').getBoundingClientRect()
        return { border: Number(g.dataset.border), x: r.left + r.width / 2, y: r.top + r.height / 2, hit: [Math.round(r.width), Math.round(r.height)], size: [Math.round(s.width), Math.round(s.height)] }
      }),
      tints: [...document.querySelectorAll('.col-handles .col-tint')].map((t) => {
        const r = t.getBoundingClientRect()
        return { left: r.left, right: r.right }
      }),
      tip: vis(document.querySelector('.col-tip')) ? document.querySelector('.col-tip').textContent : null,
      chips: [...document.querySelectorAll('.col-handles .col-chip')].filter((c) => !c.hidden).map((c) => c.textContent),
      ghost: !!document.querySelector('.col-handles .col-ghost'),
      // つかんでいる線の位置（表の左からの %。パソコンはつかんだ線、スマホはつかんだつまみの線）
      hot: (() => {
        const h = document.querySelector('.col-handles .col-grip.hot, .col-handles .col-pknob.hot')
        const t = document.querySelector('.page-viewport.front .data-table[data-table-id="t1"] table')?.getBoundingClientRect()
        if (!h || !t) return null
        const r = h.getBoundingClientRect()
        return Math.round((((r.left + r.width / 2 - t.left) / t.width) * 100) * 10) / 10
      })(),
      // 数（%）が、紙面の部品・一言のどこかに出ているか
      percent: /%/.test((root?.textContent ?? '') + (document.querySelector('.col-tip')?.textContent ?? '')),
    }
  })

/** 要素の字を、行ごとに分ける（同じ高さの字を1行とする。空白は数えない） */
const linesOf = (page, selector) =>
  page.evaluate((selector) =>
    [...document.querySelectorAll(selector)].map((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      const lines = []
      let lastTop = null
      while (walker.nextNode()) {
        const node = walker.currentNode
        for (let i = 0; i < node.length; i++) {
          if (/\s/.test(node.data[i])) continue
          const r = document.createRange()
          r.setStart(node, i)
          r.setEnd(node, i + 1)
          const q = [...r.getClientRects()].find((x) => x.height > 0)
          if (!q) continue
          if (lastTop === null || q.top > lastTop + q.height * 0.5) {
            lines.push('')
            lastTop = q.top
          }
          lines[lines.length - 1] += node.data[i]
        }
      }
      return lines
    }),
  selector)

const saveCrop = (name, shape) => shape?.crop && writeFileSync(`${OUT}/${name}.png`, Buffer.from(shape.crop.split(',')[1], 'base64'))

/** 表のまわりを撮る（パソコン：左の道具も入れるときは withPalette） */
async function shot(page, name, withPalette = false, pad = 40) {
  const clip = await page.evaluate(
    (id, withPalette, pad) => {
      const t = document.querySelector(`.page-viewport.front .data-table[data-table-id="${id}"]`).getBoundingClientRect()
      const p = withPalette ? document.querySelector('.palette')?.getBoundingClientRect() : null
      const left = Math.max(0, Math.min(t.left - pad, p ? p.left - 8 : Infinity))
      const top = Math.max(0, Math.min(t.top - pad, p ? p.top - 8 : Infinity))
      const right = Math.min(innerWidth, t.right + pad)
      const bottom = Math.min(innerHeight, Math.max(t.bottom + pad, p ? p.bottom + 8 : 0))
      return { x: left, y: top, width: right - left, height: bottom - top }
    },
    ID,
    withPalette,
    pad,
  )
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: { ...clip, scale: 1 }, captureBeyondViewport: false })
}

export async function tableCustomPc(browser, check) {
  const { context, page, ready } = await openSample(browser, false)
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
  /** 列の幅を選ぶ（「表の形を整える」の窓。選んだあとも窓は開いたまま） */
  const press = async (value) => {
    await pickWidth(page, value, { ready })
    await wait(300)
  }
  const shape = async () => {
    await showTable(page, ready, ID)
    return shapeOf(page, ID)
  }

  // ---- 列の幅：窓に3つ（列の幅をそろえる・字の多い列を広く・自分で決める）。いまは「列の幅をそろえる」。そろえるの表には、線・つまみは出ない ----
  await clickCell('m1:feat')
  await openShape(page)
  const seg0 = await shapeState(page)
  const idle0 = await handlesOf(page)
  check(
    'パソコン：「表の形を整える」の窓の「列の幅」は、列の幅をそろえる・字の多い列を広く・自分で決めるの3つ（いまの形に印）。そろえるの表には、縦の線のつまみは出ない',
    JSON.stringify(seg0.widths.map((b) => [b.value, b.on])) === JSON.stringify([['equal', true], ['auto', false], ['custom', false]]) &&
      seg0.widths[0].text.includes('列の幅をそろえる') && seg0.widths[1].text.includes('字の多い列を広く') && seg0.widths[2].text.includes('自分で決める') &&
      !idle0.shown,
    JSON.stringify({ seg0: seg0.widths, idle0: idle0.shown }),
  )

  // ---- 字の多い列を広く → 自分で決める：いま見えている幅から始まる（見た目は変わらない） ----
  await press('auto')
  const autoShape = await shape()
  await page.screenshot({ path: `${OUT}/pc-0-auto.png` })
  await press('custom')
  const fromAuto = await shape()
  const m1 = await modelOf(page)
  check(
    'パソコン：中身に合わせるから「自分で決める」にすると、いま見えている幅から始まる（列の幅は 1px 以内で同じ。原稿には列ごとの % が入り、合計 100）',
    m1.widths === 'custom' && m1.colWidths.length === 4 && Math.abs(m1.colWidths.reduce((a, b) => a + b, 0) - 100) < 1e-6 && same(fromAuto.cols, autoShape.cols, 1) && fromAuto.cls.includes('widths-custom'),
    JSON.stringify({ auto: r1(autoShape.cols), custom: r1(fromAuto.cols), colWidths: m1.colWidths }),
  )
  // 同じ幅に戻す：どの列も同じ幅（自分で決めるのまま）。元に戻す1回で戻る
  const hint = await linesIn(page, '.shape-panel .so-guide p')
  const resetBtn = await page.evaluate(() => document.querySelector('.shape-panel .so-even')?.textContent ?? null)
  await page.click('.shape-panel .so-even')
  await wait(300)
  await ready()
  const evened = await modelOf(page)
  const evenShape = await shape()
  check(
    'パソコン：自分で決めるのとき、窓に「表の縦の線を左右にドラッグ」（1字だけの行はない）と「同じ幅に戻す」。同じ幅に戻すと、どの列も同じ幅（自分で決めるのまま）',
    hint.length === 1 && hint[0].join('') === '表の縦の線を左右にドラッグ' && loneOf(hint).length === 0 && resetBtn === '同じ幅に戻す' && evened.widths === 'custom' && JSON.stringify(evened.colWidths) === '[25,25,25,25]' && same(pctOf(evenShape.cols), [25, 25, 25, 25], 0.2),
    JSON.stringify({ hint, evened, cols: r1(evenShape.cols) }),
  )
  await closeShape(page)
  await page.evaluate(() => window.__editor.undo())
  await ready()
  const unEven = await modelOf(page)
  await page.evaluate(() => window.__editor.redo())
  await ready()
  check('パソコン：「同じ幅に戻す」は、元に戻す1回で前の幅に戻る', JSON.stringify(unEven.colWidths) === JSON.stringify(m1.colWidths) && JSON.stringify((await modelOf(page)).colWidths) === '[25,25,25,25]', JSON.stringify(unEven))

  // ---- 書いている間：内側の縦の線に、細い線とつまみ（3本）。マウスを乗せると col-resize・大きいつまみと「左右にドラッグして／列の幅を変える」 ----
  await clickCell('m1:feat')
  await shape()
  await clickCell('m1:feat')
  const h0 = await handlesOf(page)
  await shot(page, 'pc-1-editing', true)
  await page.mouse.move(h0.grips[1].knob.x, h0.grips[1].knob.y)
  await wait(250)
  const hover = await handlesOf(page)
  await shot(page, 'pc-2-hover')
  check(
    'パソコン：自分で決めるの表のセルを書いている間、内側の縦の線（3本）に、表の高さの細い線と、見出しの行の細いつまみ（12×28）が出る。線にマウスを乗せると、左右の矢印のカーソル・左右の矢印の付いた大きいつまみ（34×24）と「左右にドラッグして／列の幅を変える」',
    h0.shown &&
      h0.grips.length === 3 &&
      h0.grips.every((g) => g.cursor === 'col-resize' && Math.round(g.knob.w) === 12 && Math.round(g.knob.h) === 28) &&
      Math.round(hover.grips[1].knob.w) === 34 &&
      Math.round(hover.grips[1].knob.h) === 24 &&
      hover.tip === '左右にドラッグして列の幅を変える' &&
      !hover.percent,
    JSON.stringify({ grips: h0.grips.map((g) => [Math.round(g.x), g.cursor, Math.round(g.knob.w), Math.round(g.knob.h)]), hover: hover.grips[1].knob, tip: hover.tip }),
  )

  // ---- ドラッグ：5% ずつ止まり、となりの2列だけが変わる。動かしている間は、となりの2列に色と「広くなる ▶」「◀ せまくなる」（数は出さない） ----
  const tableW = await page.evaluate((id) => document.querySelector(`.page-viewport.front .data-table[data-table-id="${id}"] table`).getBoundingClientRect().width, ID)
  const g1 = h0.grips[1]
  await page.mouse.down()
  await page.mouse.move(g1.knob.x + tableW * 0.06, g1.knob.y, { steps: 4 })
  const mid = await handlesOf(page)
  await page.mouse.move(g1.knob.x + tableW * 0.11, g1.knob.y, { steps: 4 })
  const during = await handlesOf(page)
  await shot(page, 'pc-3-dragging')
  await page.mouse.up()
  await wait(300)
  await ready()
  const dragged = await modelOf(page)
  const dragShape = await shape()
  const stillEditing = await page.evaluate(() => window.__editor.getSnapshot().editingId)
  check(
    'パソコン：縦の線をドラッグすると、線は 5% ずつ止まり（6% 動かすと 5%、11% 動かすと 10%。線の位置は表の左から 55%・60%）、元の位置に点線。右へ動かすと、表の下に、左の列「広くなる ▶」・右の列「◀ せまくなる」の札（数（%）は出さない）',
    Math.abs(mid.hot - 55) <= 0.6 && Math.abs(during.hot - 60) <= 0.6 && during.ghost && JSON.stringify(during.chips) === JSON.stringify(['広くなる ▶', '◀ せまくなる']) && !mid.percent && !during.percent,
    JSON.stringify({ mid: [mid.hot, mid.chips], during: [during.hot, during.chips], ghost: during.ghost }),
  )
  check(
    'パソコン：離すと、となりの2列だけが変わる（25・25・25・25 → 25・35・15・25）。紙面の列の幅も同じ割合（0.2% 以内）。書いていたセルを書き続ける',
    JSON.stringify(dragged.colWidths) === '[25,35,15,25]' && same(pctOf(dragShape.cols), [25, 35, 15, 25], 0.2) && stillEditing === 'm1:feat',
    JSON.stringify({ colWidths: dragged.colWidths, paper: pctOf(dragShape.cols), editing: stillEditing }),
  )

  // ---- 10% より狭くならない ----
  await clickCell('m1:feat')
  const h1 = await handlesOf(page)
  await page.mouse.move(h1.grips[1].knob.x, h1.grips[1].knob.y)
  await page.mouse.down()
  await page.mouse.move(h1.grips[1].knob.x + tableW * 0.3, h1.grips[1].knob.y, { steps: 6 })
  const clamp = await handlesOf(page)
  await page.mouse.up()
  await wait(300)
  await ready()
  const minModel = await modelOf(page)
  check(
    'パソコン：となりの列が 10% になると、それ以上は動かない（30% 動かしても 35・15 → 40・10。線は表の左から 65% で止まる。ほかの列は変わらない）',
    Math.abs(clamp.hot - 65) <= 0.6 && JSON.stringify(minModel.colWidths) === '[25,40,10,25]',
    JSON.stringify({ hot: clamp.hot, colWidths: minModel.colWidths }),
  )

  // ---- 元に戻す：ドラッグ1回ずつ戻る ----
  await page.evaluate(() => window.__editor.undo())
  await ready()
  const u1 = (await modelOf(page)).colWidths
  await page.evaluate(() => window.__editor.undo())
  await ready()
  const u2 = (await modelOf(page)).colWidths
  await page.evaluate(() => window.__editor.redo())
  await ready()
  await page.evaluate(() => window.__editor.redo())
  await ready()
  check(
    'パソコン：元に戻す1回で、ドラッグ1回分ずつ戻る（40・10 → 35・15 → 25・25）。やり直すで進む',
    JSON.stringify(u1) === '[25,35,15,25]' && JSON.stringify(u2) === '[25,25,25,25]' && JSON.stringify((await modelOf(page)).colWidths) === '[25,40,10,25]',
    JSON.stringify({ u1, u2 }),
  )

  // ---- PDF の列の幅は、紙面と同じ（1px 以内） ----
  const paper = await shape()
  const pdf = await pdfShape(page, ID)
  saveCrop('pc-4-pdf', pdf)
  check('パソコン：PDF の絵の列の幅は、紙面と同じ（1px 以内。線の印・つまみは出ない）', pdf.cols.length === 4 && same(pdf.cols, paper.cols, 1), JSON.stringify({ pdf: r1(pdf.cols), paper: r1(paper.cols) }))

  // ---- 書いていないときは、線・つまみは出ない。表を選ぶと出る ----
  await page.keyboard.press('Escape')
  await ready()
  await wait(300)
  const off = await handlesOf(page)
  await shot(page, 'pc-5-done')
  await page.evaluate((id) => window.__editor.select({ kind: 'table', id }), ID)
  await wait(400)
  const selected = await handlesOf(page)
  await page.evaluate(() => window.__editor.select(null))
  await wait(300)
  check('パソコン：書き終えると、縦の線・つまみは出ない（ふつうの表）。表を選んでいる間は出る', !off.shown && selected.shown && selected.grips.length === 3, JSON.stringify({ off: off.shown, selected: selected.grips.length }))

  // ---- ほかに切り替えても、決めた幅を覚えておく ----
  await clickCell('m1:feat')
  await press('equal')
  const back = await shape()
  await clickCell('m1:feat')
  await press('custom')
  await closeShape(page)
  const again = await modelOf(page)
  const againShape = await shape()
  check(
    'パソコン：「列の幅をそろえる」に切り替えるとどの列も同じ幅に戻り、また「自分で決める」にすると、前に決めた幅（25・40・10・25）に戻る',
    same(pctOf(back.cols), [25, 25, 25, 25], 0.2) && JSON.stringify(again.colWidths) === '[25,40,10,25]' && same(pctOf(againShape.cols), [25, 40, 10, 25], 0.2),
    JSON.stringify({ back: pctOf(back.cols), again: again.colWidths }),
  )

  // ---- 列を足す・消す：足した列は、となりの列の幅を半分もらう。消した列の幅は左どなりへ（いちばん左なら右どなりへ） ----
  await clickCell('m1:usage')
  await page.evaluate((id) => window.__editor.addTableColumn(id), ID)
  await ready()
  const added = await modelOf(page)
  await clickCell('m1:name')
  await page.evaluate((id) => window.__editor.removeTableColumn(id), ID)
  await ready()
  const removedFirst = await modelOf(page)
  const cells = await page.evaluate((id) => window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === id).rows[1].cells.map((c) => c.id), ID)
  await clickCell(cells[2])
  await page.evaluate((id) => window.__editor.removeTableColumn(id), ID)
  await ready()
  const removedMid = await modelOf(page)
  const midShape = await shape()
  check(
    'パソコン：列を足すと、足した列はとなり（左）の列の幅を半分もらう（25・40・10・25 → 25・20・20・10・25）。いちばん左の列を消すと、その幅は右どなりへ（45・20・10・25）。ほかの列を消すと、その幅は左どなりへ（45・30・25）',
    JSON.stringify(added.colWidths) === '[25,20,20,10,25]' && JSON.stringify(removedFirst.colWidths) === '[45,20,10,25]' && JSON.stringify(removedMid.colWidths) === '[45,30,25]' && same(pctOf(midShape.cols), [45, 30, 25], 0.2),
    JSON.stringify({ added: added.colWidths, removedFirst: removedFirst.colWidths, removedMid: removedMid.colWidths }),
  )

  // ---- 1366×768 の画面でも、新しい言葉に1字だけの行はない（窓の選び・一言・「同じ幅に戻す」・「左右にドラッグして／列の幅を変える」） ----
  await page.setViewport({ width: 1366, height: 768 })
  await wait(500)
  await ready()
  await showTable(page, ready, ID)
  // （列を消したので、残っている「使用箇所」の列のセル）
  await clickCell('m1:usage')
  await openShape(page)
  const small = await linesIn(page, '.shape-panel .sp-head b, .shape-panel .so-sec, .shape-panel .so-choice b, .shape-panel .so-choice small, .shape-panel .so-check b, .shape-panel .so-check small, .shape-panel .so-guide p, .shape-panel .so-even, .shape-panel .so-note, .palette .shape-btn')
  const hs = await handlesOf(page)
  await page.mouse.move(hs.grips[0].knob.x, hs.grips[0].knob.y)
  await wait(250)
  const tipLines = await linesIn(page, '.col-tip')
  await page.screenshot({ path: `${OUT}/pc-6-1366x768.png` })
  check(
    'パソコン（1366×768）：窓の言葉（名前・選び・一言・「同じ幅に戻す」）と左の道具の「表の形を／整える」、線の一言「左右にドラッグして／列の幅を変える」に、1字だけの行はない',
    small.length >= 14 && loneOf(small).length === 0 && JSON.stringify(tipLines) === '[["左右にドラッグして","列の幅を変える"]]',
    JSON.stringify({ lone: loneOf(small), tipLines }),
  )
  await closeShape(page)
  // 使い方の「図・表の入れ方」の補足（列の幅・行の高さ・マスの中の改行）も、1字だけの行がない
  await page.evaluate(() => window.__editor.finishEditing())
  await ready()
  if (!(await page.$('.side .head-menu'))) await page.click('.side .menu-btn')
  await page.waitForSelector('.side .head-menu [role="menuitem"]')
  await page.evaluate(() => [...document.querySelectorAll('.side .head-menu [role="menuitem"]')].find((b) => b.textContent.includes('使い方')).click())
  await page.waitForSelector('.help-list button[data-topic="figure"]')
  await page.click('.help-list button[data-topic="figure"]')
  await page.waitForSelector('.help-topic .help-item')
  await wait(300)
  const help = await linesOf(page, '.help-topic .help-item')
  await page.screenshot({ path: `${OUT}/pc-7-help-1366x768.png` })
  check(
    'パソコン（1366×768）：使い方の「図・表の入れ方」に「表の形を整える」と「列の幅を自分で決める」（縦の線を左右に）の1行ずつ。補足の文に1字だけの行はない',
    help.length === 3 &&
      help.flat().join('').includes('道具の「表の形を整える」（スマホは「表の形」）で、列の幅・項目の列（左端）・行の高さを、絵を見て選べます') &&
      help.flat().join('').includes('「自分で決める」を選ぶと、表の縦の線（スマホは丸）を左右に動かして') &&
      help.every((l) => l.every((x) => x.length >= 2)),
    JSON.stringify(help),
  )
  await context.close()
}

export async function tableCustomPhone(browser, check) {
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
  const tap = async (selector, text) => {
    const at = await page.evaluate(
      (selector, text) => {
        const el = [...document.querySelectorAll(selector)].find((b) => text === undefined || b.textContent.includes(text))
        el.scrollIntoView({ inline: 'nearest', block: 'nearest' })
        const r = el.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      },
      selector,
      text,
    )
    await wait(150)
    await page.touchscreen.tap(at.x, at.y)
    await wait(400)
  }
  const state = () => page.evaluate(() => ({ editing: window.__editor.getSnapshot().editingId, page: window.__editor.getSnapshot().page, zoomed: window.__editor.getSnapshot().zoomed, scale: window.__editor.stage.scale, scrollTop: document.querySelector('.page-scroller').scrollTop, scrollLeft: document.querySelector('.page-scroller').scrollLeft }))

  // ---- 「表の形」を押すと、下から「表の形を整える」の欄（絵が上の選びを横に3つ・項目の列・行の高さ。押す所は 44px 以上。どの字も1字だけの行はない） ----
  await tapCell('m1:feat')
  const face = await page.evaluate(() => {
    const b = document.querySelector('.direct-bar .db-table .shape-btn')
    return { text: b?.textContent, pic: !!b?.querySelector('svg.pic'), w: Math.round(b?.getBoundingClientRect().width ?? 0), h: Math.round(b?.getBoundingClientRect().height ?? 0) }
  })
  await openShape(page, true)
  const opened = await shapeState(page)
  const sheetSizes = await page.evaluate(() => [...document.querySelectorAll('.table-shape button')].map((b) => [b.textContent.slice(0, 8), Math.round(b.getBoundingClientRect().width), Math.round(b.getBoundingClientRect().height)]))
  const sheetLines = await linesIn(page, '.table-shape h2, .table-shape .so-sec, .table-shape .so-choice b, .table-shape .so-choice small, .table-shape .so-check b, .table-shape .so-check small, .table-shape .ts-done')
  await page.screenshot({ path: `${OUT}/phone-1-sheet.png` })
  check(
    'スマホ：キーボードの上の道具の「表の形」（絵つき・44px 以上）を押すと、下から「表の形を整える」の欄が出る。列の幅は絵が上の選びを横に3つ（列の幅をそろえるに印）・項目の列（左端）・行の高さ・「できた」。押す所はどれも 44px 以上。1字だけの行はない',
    face.text === '表の形' && face.pic && face.w >= 44 && face.h >= 44 &&
      opened?.kind === 'sheet' && opened.title === '表の形を整える' &&
      JSON.stringify(opened.widths.map((w) => [w.value, w.on])) === JSON.stringify([['equal', true], ['auto', false], ['custom', false]]) &&
      opened.widths[2].text.includes('丸を左右に動かす') &&
      sheetSizes.every(([, w, h]) => w >= 44 && h >= 44) && loneOf(sheetLines).length === 0,
    JSON.stringify({ face, opened, sheetSizes, lone: loneOf(sheetLines) }),
  )
  // 後ろを押す・「できた」・Esc で閉じる（書いているマスは書いたまま）
  const scrim = await page.evaluate(() => {
    const r = document.querySelector('.scrim').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + 60 }
  })
  await page.touchscreen.tap(scrim.x, scrim.y)
  await wait(400)
  const closedOutside = (await shapeState(page)) === null && (await state()).editing === 'm1:feat'
  await openShape(page, true)
  await page.keyboard.press('Escape')
  await wait(400)
  const closedEsc = (await shapeState(page)) === null && (await state()).editing === 'm1:feat'
  await openShape(page, true)
  await closeShape(page, true)
  const closedDone = (await shapeState(page)) === null && (await state()).editing === 'm1:feat'
  check('スマホ：欄は、後ろを押す・Esc・「できた」で閉じる（書いているマスは書いたまま）', closedOutside && closedEsc && closedDone, JSON.stringify({ closedOutside, closedEsc, closedDone }))

  // ---- 「自分で決める」を選ぶ：欄が閉じ、選んだ列に色・両側の線に丸いつまみ。3段目に「丸を左右に動かす」「同じ幅に戻す」（列の幅の数は出さない） ----
  await tapCell('m1:feat')
  await pickWidth(page, 'custom', { phone: true, ready })
  await wait(500)
  const m0 = await modelOf(page)
  const closed = (await shapeState(page)) === null
  const h0 = await handlesOf(page)
  // キーボードの上の道具に3段目は出さない（mockups/v48 C）。丸を一度も動かしていなければ、表の上に一言
  const row = await page.evaluate(() => ({ third: !!document.querySelector('.direct-bar .db-colw'), hint: document.querySelector('.col-handles .col-hint')?.textContent ?? null, percent: /%/.test(document.querySelector('.direct-bar').textContent) }))
  await page.screenshot({ path: `${OUT}/phone-2-knobs.png` })
  const cellCol = await page.evaluate(() => {
    const r = document.querySelector('.page-viewport.front [data-cell-id="m1:feat"]').getBoundingClientRect()
    return { left: r.left, right: r.right }
  })
  check(
    'スマホ：欄で「自分で決める」を選ぶと欄が閉じ、列の幅は自分で決める（いまの 25% ずつから）。書いているマスの列がうすく色付き、その列の両側の線に丸いつまみ（30px。押せる所は 44px）',
    m0.widths === 'custom' && JSON.stringify(m0.colWidths) === '[25,25,25,25]' && closed &&
      h0.tints.length >= 1 && Math.abs(h0.tints[0].left - cellCol.left) <= 1.5 && Math.abs(h0.tints[0].right - cellCol.right) <= 1.5 &&
      JSON.stringify(h0.knobs.map((k) => k.border)) === '[1,2]' && h0.knobs.every((k) => k.size[0] >= 30 && k.size[1] >= 30 && k.hit[0] >= 44 && k.hit[1] >= 44),
    JSON.stringify({ m0, tints: h0.tints, knobs: h0.knobs, cellCol }),
  )
  check(
    'スマホ：自分で決めるのとき、キーボードの上の道具は2段のまま（3段目を出さない）。丸を動かす前は、表の上に「丸を左右に動かすと、列の幅が変わります」。列の幅の数は出さない（mockups/v48 C）',
    !row.third && row.hint === '丸を左右に動かすと、列の幅が変わります' && !row.percent,
    JSON.stringify(row),
  )

  // ---- 右のつまみを指で右へ 10% 動かす：その線だけが動き、右どなりの列と幅をやりとりする。紙面は動かない・ページは送らない・拡大はそのまま ----
  const before = await state()
  const tableW = await page.evaluate((id) => document.querySelector(`.page-viewport.front .data-table[data-table-id="${id}"] table`).getBoundingClientRect().width, ID)
  const k = h0.knobs.find((x) => x.border === 2)
  const pts = (dx) => [{ x: k.x + dx, y: k.y, id: 1 }]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(0) })
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts((tableW * 0.11 * i) / 8) })
    await wait(30)
  }
  const during = await handlesOf(page)
  const duringState = await state()
  await page.screenshot({ path: `${OUT}/phone-3-dragging.png` })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await wait(500)
  await ready()
  await wait(400)
  const after = await state()
  const m1 = await modelOf(page)
  const barAfter = await page.evaluate(() => document.querySelector('.direct-bar')?.textContent ?? '')
  await page.screenshot({ path: `${OUT}/phone-4-after.png` })
  check(
    'スマホ：右の丸いつまみを指で右へ動かすと、線が 5% ずつ止まり（11% で 10%）、右どなりの列と幅をやりとりする（25・25・35・15）。動かしている間は、表の上に「広くなる ▶」「◀ せまくなる」（数（%）は出さない）',
    JSON.stringify(during.chips) === JSON.stringify(['広くなる ▶', '◀ せまくなる']) && !during.percent && JSON.stringify(m1.colWidths) === '[25,25,35,15]' && !/%/.test(barAfter) && after.editing === 'm1:feat',
    JSON.stringify({ chips: during.chips, colWidths: m1.colWidths, editing: after.editing }),
  )
  check(
    'スマホ：つまみを動かしている間、紙面は動かず、ページも送らず、拡大の大きさも変わらない',
    duringState.page === before.page && duringState.scrollTop === before.scrollTop && duringState.scrollLeft === before.scrollLeft && Math.abs(duringState.scale - before.scale) < 1e-6 && after.page === before.page && Math.abs(after.scale - before.scale) < 1e-6,
    JSON.stringify({ before, duringState, after }),
  )
  // PDF の列の幅は、紙面と同じ
  const paper = await shapeOf(page, ID)
  const pdf = await pdfShape(page, ID)
  saveCrop('phone-5-pdf', pdf)
  check('スマホ：PDF の絵の列の幅は、紙面と同じ（1px 以内。色・つまみは出ない）', pdf.cols.length === 4 && same(pdf.cols, paper.cols, 1), JSON.stringify({ pdf: r1(pdf.cols), paper: r1(paper.cols) }))
  // キーボードの上の「戻す」1回で戻る
  await tap('.direct-bar .db-row button', '戻す')
  await ready()
  await wait(400)
  check('スマホ：キーボードの上の「戻す」1回で、つまみを動かす前の幅（25% ずつ）に戻る', JSON.stringify((await modelOf(page)).colWidths) === '[25,25,25,25]', JSON.stringify(await modelOf(page)))

  // ---- 2本の指で紙面を広げると、拡大する（つまみの上でなければ、今までどおり） ----
  await tapCell('m1:feat')
  const s0 = await state()
  const mid = { x: 195, y: 300 }
  const two = (d) => [
    { x: mid.x - d / 2, y: mid.y, id: 1 },
    { x: mid.x + d / 2, y: mid.y, id: 2 },
  ]
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: two(80) })
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: two(80 + 12 * i) })
    await wait(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await wait(600)
  const s1 = await state()
  check('スマホ：つまみのない所の2本の指の広げは、今までどおり紙面を広げる', s1.scale > s0.scale * 1.2, JSON.stringify({ before: s0.scale, after: s1.scale }))

  // ---- 表を選んだときの下の道具の「表の形」も、押すと下から同じ欄 ----
  await page.tap('.direct-bar .db-done')
  await wait(400)
  await ready()
  await page.evaluate((id) => window.__editor.select({ kind: 'table', id }), ID)
  await wait(500)
  const selFace = await linesOf(page, '.sel-bar .shape-btn span')
  await openShape(page, true)
  const selPop = await shapeState(page)
  await page.screenshot({ path: `${OUT}/phone-6-selbar-sheet.png` })
  await pickWidth(page, 'auto', { phone: true, ready })
  await closeShape(page, true)
  check(
    'スマホ：表を選んだときの下の道具の「表の形」も、押すと同じ欄で選ぶ（自分で決めるに印）。字の多い列を広くを選ぶと、そうなる（決めた幅は覚えておく）',
    selPop?.widths.find((r) => r.on)?.value === 'custom' && JSON.stringify(selFace) === '[["表の形"]]' && (await modelOf(page)).widths === 'auto' && JSON.stringify((await modelOf(page)).colWidths) === '[25,25,25,25]',
    JSON.stringify({ selPop: selPop?.widths, selFace, model: await modelOf(page) }),
  )
  await page.evaluate(() => window.__editor.select(null))
  await wait(300)
  // 使い方の「図・表の入れ方」の補足（390px）も、1字だけの行がない
  await page.click('.p-top .icon-btn')
  await page.waitForSelector('.sheet .help-btn')
  await page.click('.sheet .help-btn')
  await page.waitForSelector('.help-sheet .help-list button[data-topic="figure"]')
  await page.click('.help-sheet .help-list button[data-topic="figure"]')
  await page.waitForSelector('.help-topic .help-item')
  await wait(300)
  const help = await linesOf(page, '.help-topic .help-item')
  await page.screenshot({ path: `${OUT}/phone-7-help.png` })
  check(
    'スマホ（390px）：使い方の「図・表の入れ方」の補足（表の形を整える・列の幅を自分で決める・マスの中の改行）に、1字だけの行はない',
    help.length === 3 && help.every((l) => l.every((x) => x.length >= 2)),
    JSON.stringify(help),
  )
  await context.close()
}

// これだけを動かす：node scripts/e2e/tableCustom.mjs（pc・phone で片方だけ）
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { withEdge } = await import('../poc/edge.mjs')
  const only = process.argv[2]
  const results = []
  const check = (name, ok, detail = '') => {
    results.push(ok)
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
  }
  await withEdge(async (browser) => {
    if (only === 'fit') return paletteFitPc(browser, check)
    if (only !== 'phone') await tableCustomPc(browser, check)
    if (only !== 'pc') await tableCustomPhone(browser, check)
    if (only !== 'phone') await paletteFitPc(browser, check)
  })
  const failed = results.filter((ok) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} 件 合格`)
  process.exitCode = failed ? 1 : 0
}

/**
 * 画面の低いノートパソコン（1280×720・1366×768・1280×720 の画面のブラウザの中 1280×586）で、表のセル・タイトルを書いている・表を選んでいるとき（列の幅の3つの形のどれでも）、
 * 左の道具は、中を上下に動かさずに全部見える（表の道具は「表の形を整える」1つにまとめた。mockups/v45 案A）。「表の形を整える」の窓も画面に入る。1字だけの行はない。
 * もっと低い画面（1280×480）で道具の中を上下に動かすことになっても、棒で中身が狭まらない（中身の幅は 72px のまま。前は「クリックし／て」「画像を入れ／る」のように1字だけの行ができていた）
 */
export async function paletteFitPc(browser, check) {
  const { context, page, ready } = await openSample(browser, false)
  const OUT_FIT = 'poc-output/palette-fit'
  mkdirSync(OUT_FIT, { recursive: true })
  const measure = () =>
    page.evaluate(() => {
      const p = document.querySelector('.palette')
      const linesOf = (el) => {
        const out = []
        let last = null
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        while (walker.nextNode()) {
          const n = walker.currentNode
          for (let i = 0; i < n.length; i++) {
            if (/\s/.test(n.data[i])) continue
            const r = document.createRange()
            r.setStart(n, i)
            r.setEnd(n, i + 1)
            const q = [...r.getClientRects()].find((x) => x.height > 0)
            if (!q) continue
            if (last === null || q.top > last + q.height * 0.5) {
              out.push('')
              last = q.top
            }
            out[out.length - 1] += n.data[i]
          }
        }
        return out
      }
      const labels = [...p.querySelectorAll('.p-head b, .p-head span, .tb span, .ctx-label'), ...document.querySelectorAll('.shape-panel :is(.sp-head b, .so-sec, .so-choice b, .so-choice small, .so-check b, .so-check small, .so-guide p, .so-even, .so-note)')]
      const panel = document.querySelector('.shape-panel')?.getBoundingClientRect()
      return {
        tools: !!p.querySelector('.group.ctx .ctx-label') && !!p.querySelector('.group.ctx .shape-btn'),
        scrolls: p.scrollHeight > p.clientHeight,
        bottom: Math.round(p.getBoundingClientRect().bottom),
        screen: innerHeight,
        sizes: `${p.scrollHeight}/${p.clientHeight} w${p.offsetWidth}`,
        lone: labels.map(linesOf).filter((l) => l.some((x) => x.length === 1) && l.join('').length > 1).map((l) => l.join('／')),
        inner: Math.round(p.querySelector('.group.ctx')?.getBoundingClientRect().width ?? 0),
        head: Math.round(p.querySelector('.p-head')?.getBoundingClientRect().width ?? 0),
        panel: panel ? { top: Math.round(panel.top), bottom: Math.round(panel.bottom), fits: panel.top >= 0 && panel.bottom <= innerHeight, scroll: document.querySelector('.shape-panel').classList.contains('scroll') } : null,
      }
    })
  for (const [w, h] of [
    [1280, 720],
    [1366, 768],
    [1280, 586],
  ]) {
    await page.setViewport({ width: w, height: h })
    await wait(600)
    await ready()
    const bad = []
    const seen = []
    for (const mode of ['equal', 'auto', 'custom']) {
      await page.evaluate((mode) => window.__editor.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === 't1' ? { ...b, widths: mode, colWidths: mode === 'custom' ? [40, 30, 30] : b.colWidths } : b)) })) })), mode)
      await ready()
      await showTable(page, ready, ID)
      for (const state of ['cell', 'title', 'selected']) {
        await page.evaluate(() => window.__editor.finishEditing())
        await ready()
        if (state === 'selected') await page.evaluate((id) => window.__editor.select({ kind: 'table', id }), ID)
        else {
          const id = state === 'cell' ? 'm1:name' : ID
          await page.evaluate((id) => window.__editor.openWhenReady(id, 0), id)
          await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 10000 }, id).catch(() => {})
        }
        await wait(400)
        const m = await measure()
        // 「表の形を整える」の窓も開いて測る（自分で決めるの窓がいちばん長い）
        await openShape(page)
        const open = await measure()
        if (state === 'cell') await page.screenshot({ path: `${OUT_FIT}/e2e-${w}x${h}-${mode}.png` })
        await closeShape(page)
        seen.push(`${mode}/${state}:${m.sizes} 下の端${m.bottom}/${m.screen} 窓${open.panel?.top}〜${open.panel?.bottom}`)
        if (!m.tools || m.scrolls || m.bottom > m.screen || m.lone.length || m.inner !== 72 || m.head !== 72 || !open.panel?.fits || open.panel.scroll || open.lone.length) bad.push({ mode, state, m, open })
      }
    }
    await page.evaluate(() => window.__editor.finishEditing())
    check(
      `パソコン（${w}×${h}）：表のセル・タイトルを書いている・表を選んでいるとき、列の幅のどの形でも、左の道具は中を上下に動かさずに全部見える（表の道具は「表の形を整える」1つ）。「表の形を整える」の窓も画面に入る。1字だけの行はない`,
      bad.length === 0,
      JSON.stringify(bad.length ? bad : seen),
    )
  }
  // もっと低い画面：道具の中を上下に動かす棒が出ても、中身は狭まらない（72px のまま）。1字だけの行はない
  await page.setViewport({ width: 1280, height: 480 })
  await wait(600)
  await ready()
  await showTable(page, ready, ID)
  await page.evaluate(() => window.__editor.openWhenReady('m1:name', 0))
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'm1:name', { timeout: 10000 }).catch(() => {})
  await wait(400)
  const low = await measure()
  await page.screenshot({ path: `${OUT_FIT}/e2e-1280x480-scroll.png` })
  await page.evaluate(() => window.__editor.finishEditing())
  check(
    'パソコン（1280×480 のとても低い画面）：左の道具の中を上下に動かす棒が出ても、中身は狭まらない（72px のまま）。1字だけの行はない',
    low.scrolls && low.inner === 72 && low.head === 72 && low.lone.length === 0,
    JSON.stringify(low),
  )
  await context.close()
}
