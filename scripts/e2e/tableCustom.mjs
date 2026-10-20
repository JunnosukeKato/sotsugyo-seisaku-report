// 表の列の幅を「自分で決める」（mockups/v42 の依頼者の選んだ形。Edge を自動で操作する。パソコンとスマホ）。
// - 列の幅は3つ（そろえる・中身に合わせる・自分で決める）。自分で決めるにすると、いま見えている幅から始まる（見た目を変えない）。ほかへ切り替えても、決めた幅は覚えておく
// - パソコン：表のセル・タイトルを書いている間（表を選んでいる間）だけ、内側の縦の線に細い線とつまみ。マウスを乗せると col-resize と「左右にドラッグ」。
//   ドラッグで、となりの2列だけが 5% ずつ変わり、線の上に「20%｜30%」。どの列も 10% より狭くならない。左の道具に「縦の線を／ドラッグして／幅を変える」と「幅をそろえ直す」
// - スマホ：「列の幅」は押すと小さな窓で3つから選ぶ（案B）。自分で決めるでは、セルの列をうすく色付けし、両側の線に丸いつまみ（案D）。
//   指1本で動かすと、その側のとなりの列と幅をやりとりする。紙面を動かさない・ページを送らない・2本指の拡大を始めない
// - 元に戻す1回で、ドラッグ1回・そろえ直す・切り替えが戻る。PDF の列の幅は紙面と同じ（1px 以内）。列を足す・消すときの決まり
// smoke.mjs（tableCustomPc）・phone.mjs（tableCustomPhone）から呼ぶ。これだけを動かすときは node scripts/e2e/tableCustom.mjs [pc|phone]。画面の写真は poc-output/table-custom/
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { FEATURES, openSample, pdfShape, shapeOf, showTable } from './tableShape.mjs'

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
      label: document.querySelector('.col-handles .col-drag')?.textContent ?? null,
      ghost: !!document.querySelector('.col-handles .col-ghost'),
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
  const press = async (name, text) => {
    await page.evaluate((name, text) => [...document.querySelectorAll(`.palette .seg[aria-label="${name}"] button`)].find((b) => b.textContent === text).click(), name, text)
    await wait(300)
    await ready()
    await wait(300)
  }
  const shape = async () => {
    await showTable(page, ready, ID)
    return shapeOf(page, ID)
  }

  // ---- 列の幅：3つを縦に並べる。いまは「そろえる」。そろえるの表には、線・つまみは出ない ----
  await clickCell('m1:feat')
  const seg0 = await page.evaluate(() => [...document.querySelectorAll('.palette .seg[aria-label="列の幅"] button')].map((b) => ({ text: b.textContent, on: b.classList.contains('on'), title: b.title })))
  const idle0 = await handlesOf(page)
  check(
    'パソコン：左の道具の「列の幅」は、そろえる・中身に合わせる・自分で決めるの3つ（押すと切り替わるボタンに「列の幅：そろえる（押すと、自分で決める）」）。そろえるの表には、縦の線のつまみは出ない',
    JSON.stringify(seg0.map((b) => [b.text, b.on])) === JSON.stringify([['そろえる', true], ['中身に合わせる', false], ['自分で決める', false]]) && seg0[2].title === '列の幅：そろえる（押すと、自分で決める）' && !idle0.shown,
    JSON.stringify({ seg0, idle0: idle0.shown }),
  )

  // ---- 中身に合わせる → 自分で決める：いま見えている幅から始まる（見た目は変わらない） ----
  await press('列の幅', '中身に合わせる')
  const autoShape = await shape()
  await page.screenshot({ path: `${OUT}/pc-0-auto.png` })
  await clickCell('m1:feat')
  await press('列の幅', '自分で決める')
  const fromAuto = await shape()
  const m1 = await modelOf(page)
  check(
    'パソコン：中身に合わせるから「自分で決める」にすると、いま見えている幅から始まる（列の幅は 1px 以内で同じ。原稿には列ごとの % が入り、合計 100）',
    m1.widths === 'custom' && m1.colWidths.length === 4 && Math.abs(m1.colWidths.reduce((a, b) => a + b, 0) - 100) < 1e-6 && same(fromAuto.cols, autoShape.cols, 1) && fromAuto.cls.includes('widths-custom'),
    JSON.stringify({ auto: r1(autoShape.cols), custom: r1(fromAuto.cols), colWidths: m1.colWidths }),
  )
  // そろえ直す：どの列も同じ幅（自分で決めるのまま）。元に戻す1回で戻る
  const hint = await linesOf(page, '.palette .custom-hint span')
  const resetBtn = await page.evaluate(() => document.querySelector('.palette .reset-widths')?.textContent ?? null)
  await page.evaluate(() => document.querySelector('.palette .reset-widths').click())
  await wait(300)
  await ready()
  const evened = await modelOf(page)
  const evenShape = await shape()
  check(
    'パソコン：自分で決めるのとき、左の道具に「縦の線を／ドラッグして／幅を変える」（3行。1字だけの行はない）と「幅をそろえ直す」。そろえ直すと、どの列も同じ幅（自分で決めるのまま）',
    JSON.stringify(hint) === JSON.stringify([['縦の線を'], ['ドラッグして'], ['幅を変える']]) && resetBtn === '幅をそろえ直す' && evened.widths === 'custom' && JSON.stringify(evened.colWidths) === '[25,25,25,25]' && same(pctOf(evenShape.cols), [25, 25, 25, 25], 0.2),
    JSON.stringify({ hint, evened, cols: r1(evenShape.cols) }),
  )
  await page.evaluate(() => window.__editor.undo())
  await ready()
  const unEven = await modelOf(page)
  await page.evaluate(() => window.__editor.redo())
  await ready()
  check('パソコン：「幅をそろえ直す」は、元に戻す1回で前の幅に戻る', JSON.stringify(unEven.colWidths) === JSON.stringify(m1.colWidths) && JSON.stringify((await modelOf(page)).colWidths) === '[25,25,25,25]', JSON.stringify(unEven))

  // ---- 書いている間：内側の縦の線に、細い線とつまみ（3本）。マウスを乗せると col-resize と「左右にドラッグ」 ----
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
    'パソコン：自分で決めるの表のセルを書いている間、内側の縦の線（3本）に、表の高さの細い線とつまみが出る。線にマウスを乗せると、左右の矢印のカーソルと「左右にドラッグ」',
    h0.shown && h0.grips.length === 3 && h0.grips.every((g) => g.cursor === 'col-resize' && g.knob.w >= 8 && g.knob.h >= 22) && hover.tip === '左右にドラッグ',
    JSON.stringify({ grips: h0.grips.map((g) => [Math.round(g.x), g.cursor]), tip: hover.tip }),
  )

  // ---- ドラッグ：5% ずつ止まり、となりの2列だけが変わる。動かしている間は「35%｜15%」 ----
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
    'パソコン：縦の線をドラッグすると、線は 5% ずつ止まり（6% 動かすと 5%、11% 動かすと 10%）、線の上に「線の左の列｜右の列」の札と、元の位置に点線',
    mid.label === '30%｜20%' && during.label === '35%｜15%' && during.ghost,
    JSON.stringify({ mid: mid.label, during: during.label, ghost: during.ghost }),
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
    'パソコン：となりの列が 10% になると、それ以上は動かない（30% 動かしても 35・15 → 40・10。ほかの列は変わらない）',
    clamp.label === '40%｜10%' && JSON.stringify(minModel.colWidths) === '[25,40,10,25]',
    JSON.stringify({ label: clamp.label, colWidths: minModel.colWidths }),
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
  await press('列の幅', 'そろえる')
  const back = await shape()
  await clickCell('m1:feat')
  await press('列の幅', '自分で決める')
  const again = await modelOf(page)
  const againShape = await shape()
  check(
    'パソコン：そろえるに切り替えるとどの列も同じ幅に戻り、また「自分で決める」にすると、前に決めた幅（25・40・10・25）に戻る',
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

  // ---- 1366×768 の画面でも、新しい言葉に1字だけの行はない（左の道具の3つのボタン・一言・「幅をそろえ直す」・「左右にドラッグ」） ----
  await page.setViewport({ width: 1366, height: 768 })
  await wait(500)
  await ready()
  await showTable(page, ready, ID)
  // （列を消したので、残っている「使用箇所」の列のセル）
  await clickCell('m1:usage')
  const small = await linesOf(page, '.palette .seg[aria-label="列の幅"] button, .palette .custom-hint span, .palette .reset-widths')
  const hs = await handlesOf(page)
  await page.mouse.move(hs.grips[0].knob.x, hs.grips[0].knob.y)
  await wait(250)
  const tipLines = await linesOf(page, '.col-tip')
  await page.screenshot({ path: `${OUT}/pc-6-1366x768.png` })
  check(
    'パソコン（1366×768）：左の道具の「そろえる」「中身に合わせる」「自分で決める」・「縦の線を／ドラッグして／幅を変える」・「幅をそろえ直す」と「左右にドラッグ」は、どれも1行（1字だけの行はない）',
    small.length === 7 && small.every((l) => l.length === 1) && JSON.stringify(tipLines) === '[["左右にドラッグ"]]',
    JSON.stringify({ small, tipLines }),
  )
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
    'パソコン（1366×768）：使い方の「図・表の入れ方」に「表の列の幅」の1行（自分で決める・縦の線を左右に）。補足の文に1字だけの行はない',
    help.length === 3 && help.flat().join('').includes('「自分で決める」にすると、縦の線（スマホは丸）を左右に動かして') && help.every((l) => l.every((x) => x.length >= 2)),
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
  const pop = () =>
    page.evaluate(() => {
      const p = document.querySelector('.width-pop')
      if (!p) return null
      const r = p.getBoundingClientRect()
      return {
        head: p.querySelector('.wp-head')?.textContent,
        rows: [...p.querySelectorAll('[role="radio"]')].map((b) => ({ name: b.querySelector('b').textContent, sub: b.querySelector('small').textContent, on: b.getAttribute('aria-checked') === 'true', h: Math.round(b.getBoundingClientRect().height) })),
        inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0,
      }
    })
  const state = () => page.evaluate(() => ({ editing: window.__editor.getSnapshot().editingId, page: window.__editor.getSnapshot().page, zoomed: window.__editor.getSnapshot().zoomed, scale: window.__editor.stage.scale, scrollTop: document.querySelector('.page-scroller').scrollTop, scrollLeft: document.querySelector('.page-scroller').scrollLeft }))

  // ---- 案B：「列の幅」のボタンに下向きの印。押すと小さな窓で3つから選ぶ ----
  await tapCell('m1:feat')
  const face = await page.evaluate(() => {
    const b = document.querySelector('.direct-bar .db-table .width-menu')
    return { text: b?.textContent, chev: !!b?.querySelector('svg.chev'), w: Math.round(b?.getBoundingClientRect().width ?? 0), h: Math.round(b?.getBoundingClientRect().height ?? 0) }
  })
  await tap('.direct-bar .db-table .width-menu')
  const opened = await pop()
  const popLines = await linesOf(page, '.width-pop b, .width-pop small, .width-pop .wp-head')
  await page.screenshot({ path: `${OUT}/phone-1-popover.png` })
  check(
    'スマホ：キーボードの上の道具の「列の幅」は、いまの形と小さな下向きの印（44px 以上）。押すと、すぐ上に「列の幅」の小さな窓が開き、3つ（そろえる・中身に合わせる・自分で決める）と一言の説明。いまの形に印。どの字も1行',
    face.text === '列の幅そろえる' && face.chev && face.w >= 44 && face.h >= 44 &&
      opened?.head === '列の幅' && opened.inside &&
      JSON.stringify(opened.rows.map((r) => [r.name, r.sub, r.on])) === JSON.stringify([['そろえる', 'どの列も同じ幅', true], ['中身に合わせる', '字の多い列を広く', false], ['自分で決める', '列ごとに広く・狭く', false]]) &&
      opened.rows.every((r) => r.h >= 44) && popLines.every((l) => l.length === 1),
    JSON.stringify({ face, opened, popLines }),
  )
  // 窓の外を押す・Esc で閉じる（書いているマスは書いたまま。窓の外は、キーボードの上の道具の1段目の空いている所）
  const empty = await page.evaluate(() => {
    const r = document.querySelector('.direct-bar .db-row').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.touchscreen.tap(empty.x, empty.y)
  await wait(300)
  const closedOutside = (await pop()) === null && (await state()).editing === 'm1:feat'
  await tap('.direct-bar .db-table .width-menu')
  await page.keyboard.press('Escape')
  await wait(300)
  const closedEsc = (await pop()) === null && (await state()).editing === 'm1:feat'
  check('スマホ：窓の外を押す・Esc で窓が閉じる（Esc では、書いているマスは書いたまま）', closedOutside && closedEsc, JSON.stringify({ closedOutside, closedEsc }))

  // ---- 「自分で決める」を選ぶ：窓が閉じ、選んだ列に色・両側の線に丸いつまみ。3段目に「丸を左右に動かす」「この列 25%」「幅をそろえ直す」 ----
  await tapCell('m1:feat')
  await tap('.direct-bar .db-table .width-menu')
  await tap('.width-pop [role="radio"]', '自分で決める')
  await ready()
  await wait(500)
  const m0 = await modelOf(page)
  const closed = (await pop()) === null
  const h0 = await handlesOf(page)
  const row = await page.evaluate(() => {
    const r = document.querySelector('.direct-bar .db-colw')
    return r ? { hint: r.querySelector('.db-khint')?.textContent, pct: r.querySelector('.db-pct')?.textContent, reset: r.querySelector('.db-reset')?.textContent, h: Math.round(r.querySelector('.db-reset').getBoundingClientRect().height), w: Math.round(r.querySelector('.db-reset').getBoundingClientRect().width) } : null
  })
  const rowLines = await linesOf(page, '.direct-bar .db-colw .db-khint, .direct-bar .db-colw .db-pct small, .direct-bar .db-colw .db-reset span')
  await page.screenshot({ path: `${OUT}/phone-2-knobs.png` })
  const cellCol = await page.evaluate(() => {
    const r = document.querySelector('.page-viewport.front [data-cell-id="m1:feat"]').getBoundingClientRect()
    return { left: r.left, right: r.right }
  })
  check(
    'スマホ：「自分で決める」を選ぶと窓が閉じ、列の幅は自分で決める（いまの 25% ずつから）。書いているマスの列がうすく色付き、その列の両側の線に丸いつまみ（30px。押せる所は 44px）',
    m0.widths === 'custom' && JSON.stringify(m0.colWidths) === '[25,25,25,25]' && closed &&
      h0.tints.length >= 1 && Math.abs(h0.tints[0].left - cellCol.left) <= 1.5 && Math.abs(h0.tints[0].right - cellCol.right) <= 1.5 &&
      JSON.stringify(h0.knobs.map((k) => k.border)) === '[1,2]' && h0.knobs.every((k) => k.size[0] >= 30 && k.size[1] >= 30 && k.hit[0] >= 44 && k.hit[1] >= 44),
    JSON.stringify({ m0, tints: h0.tints, knobs: h0.knobs, cellCol }),
  )
  check(
    'スマホ：自分で決めるのとき、キーボードの上の道具の3段目に「丸を左右に動かす」「この列 25%」「幅をそろえ直す」（44px 以上。どの字も1行）',
    row?.hint === '丸を左右に動かす' && row.pct === 'この列25%' && row.reset === '幅をそろえ直す' && row.h >= 44 && row.w >= 44 && rowLines.every((l) => l.length === 1),
    JSON.stringify({ row, rowLines }),
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
  const pctAfter = await page.evaluate(() => document.querySelector('.direct-bar .db-colw .db-pct')?.textContent)
  await page.screenshot({ path: `${OUT}/phone-4-after.png` })
  check(
    'スマホ：右の丸いつまみを指で右へ動かすと、線が 5% ずつ止まり（11% で 10%）、右どなりの列と幅をやりとりする（25・25・35・15）。「この列 35%」',
    during.label === '35%｜15%' && JSON.stringify(m1.colWidths) === '[25,25,35,15]' && pctAfter === 'この列35%' && after.editing === 'm1:feat',
    JSON.stringify({ label: during.label, colWidths: m1.colWidths, pctAfter, editing: after.editing }),
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

  // ---- 表を選んだときの下の道具の「列の幅」も、押すと窓で選ぶ ----
  await page.tap('.direct-bar .db-done')
  await wait(400)
  await ready()
  await page.evaluate((id) => window.__editor.select({ kind: 'table', id }), ID)
  await wait(500)
  await tap('.sel-bar .width-menu')
  const selPop = await pop()
  // 表を選んだときの下の道具の「列の幅」：名前は1行、形は2行まで（「自分で／決める」。1字だけの行はない）
  const selFace = await linesOf(page, '.sel-bar .width-menu span, .sel-bar .width-menu b')
  await page.screenshot({ path: `${OUT}/phone-6-selbar-popover.png` })
  await tap('.width-pop [role="radio"]', '中身に合わせる')
  await ready()
  check(
    'スマホ：表を選んだときの下の道具の「列の幅」も、押すと窓で3つから選ぶ（自分で決めるに印）。中身に合わせるを選ぶと、そうなる（決めた幅は覚えておく）',
    selPop?.rows.find((r) => r.on)?.name === '自分で決める' && JSON.stringify(selFace) === '[["列の幅"],["自分で","決める"]]' && (await modelOf(page)).widths === 'auto' && JSON.stringify((await modelOf(page)).colWidths) === '[25,25,25,25]',
    JSON.stringify({ selPop, selFace, model: await modelOf(page) }),
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
    'スマホ（390px）：使い方の「図・表の入れ方」の補足（表の列の幅・行の高さと左端の列・マスの中の改行）に、1字だけの行はない',
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
    if (only !== 'phone') await tableCustomPc(browser, check)
    if (only !== 'pc') await tableCustomPhone(browser, check)
  })
  const failed = results.filter((ok) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} 件 合格`)
  process.exitCode = failed ? 1 : 0
}
