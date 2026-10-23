// 表の形（行の高さ・項目の列（左端））と、表のマスの中の改行（Edge を自動で操作する。パソコンとスマホ）。
// 依頼者の判断（2026-10-20）：
// - 行の高さ「そろえる」：見出しの行のほかの行を、その中でいちばん高い行と同じ高さにする（見出しの行は中身に合わせたまま。比べるときにも入れない）。
//   画面でも PDF・印刷でも同じ（組んだ紙面で測った高さを HTML に書く：src/layout/tableFit.ts）
// - 項目の列（左端）は字に合わせる（列の幅が「列の幅をそろえる」のときだけ使える）：左端の列は字の幅、ほかの列は残りを同じ幅で分ける
// - 切り替えは「表の形を整える」の窓（スマホは「表の形」の下から出る欄。mockups/v45 案A。操作は scripts/e2e/shapeUi.mjs）
// - 表のマスの中は、Enter（Shift+Enter も）で改行。書き終えるのは Esc・Tab（隣のマスへ）・ほかの所を押す・スマホの「完了」。
//   Android の文字入力の、キーの知らせのない改行の入力（insertParagraph）も改行にする
// 確かめること：そろえると、見出しの行のほかの行の高さが 0.5px 以内で同じ（画面と PDF の絵）。見出しの行の高さは変わらない。
// 高い見出しの行に、ほかの行は合わせない。戻すと元の高さ。元に戻す1回で戻る。前からある表（素材表）は変わらない。
// smoke.mjs（tableShapePc）・phone.mjs（tableShapePhone）から呼ぶ。これだけを動かすときは node scripts/e2e/tableShape.mjs。画面の写真は poc-output/table-heights/
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { stubConfig } from './configStub.mjs'
import { setupWriting } from './sampleReport.mjs'
import { closeShape, openShape, pickWidth, setCheck, shapeState } from './shapeUi.mjs'
import { answerConfirms } from './confirmUi.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/table-heights'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
/** 確かめに使う表（見出しの行・画像の行・文字の行。2行の字の行もある）。見本の原稿の2章の終わりに足す */
const TABLE_ID = 'tShape'
const rowsOf = (cells) => cells.map((r, i) => ({ id: `${TABLE_ID}r${i}`, cells: r.map((c, k) => ({ id: `${TABLE_ID}c${i}${k}`, text: typeof c === 'string' ? c : '', imageId: typeof c === 'string' ? null : c.img })) }))
const SHAPE_TABLE = {
  type: 'table',
  id: TABLE_ID,
  caption: '試着の記録',
  widths: 'equal',
  heights: 'auto',
  rows: rowsOf([
    ['項目', '内容', '備考'],
    ['素材', 'コットンサテン', ''],
    ['生地見本', { img: 'g-satin' }, ''],
    ['色', '紺と金\n袖口だけ赤', '仮縫いで決めた'],
    ['柄', 'なし', ''],
  ]),
}
/** セルの ID（行・列） */
const cellId = (r, c) => `${TABLE_ID}c${r}${c}`

/** 見本の原稿を開き、確かめに使う表を足す（はじめての案内は閉じる） */
export async function openSample(browser, phone) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log(`pageerror(tableShape${phone ? '-phone' : ''}):`, e.message))
  page.on('dialog', (d) => d.dismiss())
  // 学生のツールの確認・知らせは画面の中の窓（src/app/ask.tsx）。前のブラウザの確認と同じく答える
  await answerConfirms(page, () => false)
  await page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  })
  await stubConfig(page)
  if (phone) {
    await page.setUserAgent(IPHONE)
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  } else await page.setViewport({ width: 1440, height: 900 })
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0', timeout: 90000 })
  const ready = () =>
    page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 120000 })
  await ready()
  await page.waitForSelector('.guide.step-course .g-opts button')
  await page.evaluate(() => document.querySelector('.g-opts button').click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.g-later')
  await page.evaluate(() => document.querySelector('.g-later').click())
  await page.evaluate(() => window.__editor.finishEditing())
  await ready()
  await page.evaluate(setupWriting)
  await ready()
  await page.evaluate((t) => window.__editor.update((r) => ({ ...r, body: r.body.map((c, i) => (i === r.body.length - 1 ? { ...c, blocks: [...c.blocks, t] } : c)) })), SHAPE_TABLE)
  await ready()
  return { context, page, ready }
}

/** 表を見せる（表のあるページへ。PC は表が画面に入るよう動かす） */
export async function showTable(page, ready, id = TABLE_ID) {
  await page.evaluate((id) => {
    const ed = window.__editor
    const cell = ed.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === id).rows[0].cells[0].id
    ed.goToPage(ed.pageOfBlock(cell), 'none')
  }, id)
  await ready()
  await wait(250)
}

/**
 * 紙面の表の形（ページの原寸の px）：見出しの行・ほかの行の高さ（ページをまたぐ表は、どのページの行も）、列の幅、class、行に書いた高さ。
 * first：最初のページにある、見出しの行のほかの行の数（PDF の絵と比べるとき）
 */
export const shapeOf = (page, id = TABLE_ID) =>
  page.evaluate((id) => {
    const viewport = document.querySelector('.page-viewport.front')
    const measuring = viewport.classList.contains('measuring')
    viewport.classList.add('measuring')
    try {
      const parts = [...viewport.querySelectorAll(`.data-table[data-table-id="${id}"] table`)]
      const t = parts[0]
      if (!t) return null
      const scaleOf = (el) => el.closest('[data-vivliostyle-page-container]').getBoundingClientRect().height / 1122.52
      const s = scaleOf(t)
      if (!s) return null
      const head = t.querySelector(':scope > thead > tr').getBoundingClientRect().height / s
      const body = parts.flatMap((p) => [...p.querySelectorAll(':scope > tbody > tr')].map((tr) => tr.getBoundingClientRect().height / scaleOf(p)))
      const cols = [...t.querySelector(':scope > thead > tr').children].map((c) => c.getBoundingClientRect().width / s)
      return { cls: t.className, head, body, first: t.querySelectorAll(':scope > tbody > tr').length, cols, colgroup: !!t.querySelector('colgroup'), styled: [...t.querySelectorAll('tr[style*="height"]')].length }
    } finally {
      if (!measuring) viewport.classList.remove('measuring')
    }
  }, id)

const spread = (list) => Math.max(...list) - Math.min(...list)
/** そろえた行の高さが、いちばん高い行の高さか（行の高さは 1px の刻みに切り上げて書くので、1px まで高くてよい：src/layout/tableFit.ts） */
const asTallest = (v, tallest) => v >= tallest - 0.01 && v <= tallest + 1.01
const r2 = (v) => Math.round(v * 100) / 100
const brief = (s) => (s ? { cls: s.cls, head: r2(s.head), body: s.body.map(r2), cols: s.cols.map(r2) } : null)

/**
 * 表のあるページを PDF と同じ絵にして（src/pdf/pagesToPdf.ts。dpi：300）、絵の中の表の行の高さ・列の幅を測る（ページの原寸の px）。
 * 行：表の左端のすぐ内側を上から下へ見て、横の線（黒い点の並び）の間。列：見出しの行の真ん中を左から右へ見て、縦の線の間。
 * lines：セル（cellId）の中の、字のある横の帯の数（字の行の数）。crop：表のまわりを切り抜いた絵（PNG の data URL）
 */
export const pdfShape = (page, id = TABLE_ID, cell = null) =>
  page.evaluate(
    async (id, cell) => {
      const { pagesToPdf } = await window.__import('pdf/pagesToPdf.ts')
      const t = document.querySelector(`.page-viewport.front .data-table[data-table-id="${id}"] table`)
      const pageEl = t.closest('[data-vivliostyle-page-container]')
      const pr = pageEl.getBoundingClientRect()
      const s = pr.height / 1122.52
      const box = (el) => {
        const r = el.getBoundingClientRect()
        return { left: (r.left - pr.left) / s, top: (r.top - pr.top) / s, right: (r.right - pr.left) / s, bottom: (r.bottom - pr.top) / s }
      }
      const tb = box(t)
      const head = box(t.querySelector(':scope > thead > tr'))
      const target = cell ? box(document.querySelector(`.page-viewport.front [data-cell-id="${cell}"]`)) : null
      let out = null
      await pagesToPdf([pageEl], {
        dpi: 300,
        onPage: ({ canvas }) => {
          const k = canvas.width / 793.7
          const ctx = canvas.getContext('2d')
          const dark = (x, y) => {
            const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data
            return d[0] * 0.3 + d[1] * 0.59 + d[2] * 0.11 < 110
          }
          // 線（黒い点が続く所）の真ん中の位置を並べる
          const lines = (from, to, at) => {
            const found = []
            let start = null
            for (let v = from; v <= to; v++) {
              if (at(v)) start ??= v
              else if (start !== null) {
                found.push([start, v - 1])
                start = null
              }
            }
            if (start !== null) found.push([start, to])
            return found
          }
          // 線の真ん中：線のまわりの点の黒さで重みを付けた位置（ぼかした端の点も入れて、1点より細かく求める）
          const darkness = (x, y) => {
            const d = ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data
            return Math.max(0, 255 - (d[0] * 0.3 + d[1] * 0.59 + d[2] * 0.11)) / 255
          }
          const center = ([a, b], weight) => {
            let sum = 0
            let w = 0
            for (let v = a - 2; v <= b + 2; v++) {
              const q = weight(v)
              sum += v * q
              w += q
            }
            return w ? sum / w : (a + b) / 2
          }
          const x = Math.round((tb.left + 3) * k)
          const hs = lines(Math.floor((tb.top - 3) * k), Math.ceil((tb.bottom + 3) * k), (y) => dark(x, y)).map((run) => center(run, (y) => darkness(x, y)))
          // 列の線：見出しの行の上の線のすぐ下（字のない所）を、左から右へ見る
          const y = Math.round((head.top + 2) * k)
          const vs = lines(Math.floor((tb.left - 3) * k), Math.ceil((tb.right + 3) * k), (xx) => dark(xx, y)).map((run) => center(run, (xx) => darkness(xx, y)))
          const diffs = (list) => list.slice(1).map((v, i) => (v - list[i]) / k)
          let textLines = null
          if (target) {
            // セルの中（枠線と余白を除く）で、字のある横の帯を数える
            const x0 = Math.ceil((target.left + 4) * k)
            const x1 = Math.floor((target.right - 4) * k)
            const rows = []
            for (let yy = Math.ceil((target.top + 3) * k); yy <= Math.floor((target.bottom - 3) * k); yy++) {
              const d = ctx.getImageData(x0, yy, x1 - x0, 1).data
              let any = false
              for (let i = 0; i < d.length; i += 4) if (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11 < 140) any = true
              rows.push(any)
            }
            textLines = lines(0, rows.length - 1, (i) => rows[i]).length
          }
          // 表のまわりを切り抜いた絵
          const pad = 12 * k
          const c = document.createElement('canvas')
          c.width = Math.round((tb.right - tb.left) * k + pad * 2)
          c.height = Math.round((tb.bottom - tb.top) * k + pad * 2)
          c.getContext('2d').drawImage(canvas, tb.left * k - pad, tb.top * k - pad, c.width, c.height, 0, 0, c.width, c.height)
          out = { rows: diffs(hs), cols: diffs(vs), textLines, crop: c.toDataURL('image/png') }
        },
      })
      return out
    },
    id,
    cell,
  )

/** PDF の絵の切り抜きを保存する */
const saveCrop = (name, shape) => shape?.crop && writeFileSync(`${OUT}/${name}.png`, Buffer.from(shape.crop.split(',')[1], 'base64'))

/** 要素の字を、行ごとに分ける（同じ高さの字を1行とする） */
const linesOfText = (page, selector) =>
  page.evaluate((selector) => {
    return [...document.querySelectorAll(selector)].map((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      const lines = []
      let lastTop = null
      while (walker.nextNode()) {
        const node = walker.currentNode
        for (let i = 0; i < node.length; i++) {
          // 改行・空白の字は数えない（行の終わりの改行は、前の行の高さにある）
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
    })
  }, selector)

/** 表の、原稿の値（列の幅・行の高さ・左端の列）とセルの字 */
const modelOf = (page, id = TABLE_ID) =>
  page.evaluate((id) => {
    const t = window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === id)
    return { widths: t.widths, heights: t.heights, labelColumn: t.labelColumn === true, texts: t.rows.map((r) => r.cells.map((c) => c.text)) }
  }, id)

/** 前からある表（見本の原稿の素材表 t1）の形と、HTML に書いたもの */
const existingOf = async (page, ready) => {
  await showTable(page, ready, 't1')
  const shape = await shapeOf(page, 't1')
  const html = await page.evaluate(() => document.querySelector('.page-viewport.front .data-table[data-table-id="t1"] table').className)
  return { ...brief(shape), html, styled: shape?.styled, colgroup: shape?.colgroup }
}

export async function tableShapePc(browser, check) {
  const { context, page, ready } = await openSample(browser, false)
  const existing0 = await existingOf(page, ready)
  await showTable(page, ready)
  const auto0 = await shapeOf(page)
  const pdfAuto = await pdfShape(page)
  saveCrop('pc-table-auto-pdf', pdfAuto)

  // ---- 表のセルを押すと、左の道具に「表の形を整える」。押すと窓が開き、列の幅・項目の列（左端）・行の高さを選ぶ（mockups/v45 案A。窓は tableSettings.mjs でも確かめる） ----
  const clickCell = async (id) => {
    const at = await page.evaluate((id) => {
      const el = document.querySelector(`.page-viewport.front [data-cell-id="${id}"]`)
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }, id)
    await page.mouse.click(at.x, at.y)
    await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 10000 }, id).catch(() => {})
    await wait(250)
  }
  await clickCell(cellId(1, 1))
  await openShape(page)
  const tools0 = await shapeState(page)
  const shotPalette = async (name) => {
    const clip = await page.evaluate((id) => {
      const p = document.querySelector('.palette').getBoundingClientRect()
      const t = document.querySelector(`.page-viewport.front .data-table[data-table-id="${id}"]`).getBoundingClientRect()
      const top = Math.max(0, Math.min(p.top, t.top - 20))
      return { x: Math.max(0, p.left), y: top, width: Math.min(innerWidth, t.right + 20) - Math.max(0, p.left), height: Math.min(innerHeight, Math.max(p.bottom, t.bottom + 20)) - top }
    }, TABLE_ID)
    await page.screenshot({ path: `${OUT}/${name}.png`, clip, captureBeyondViewport: false })
  }
  await shotPalette('pc-toggle-auto')
  check(
    'パソコン：表のセルを書いているとき「表の形を整える」の窓に、列の幅（列の幅をそろえるに印）・項目の列（左端）・行の高さ（はじめは印なし）が出る',
    tools0?.kind === 'panel' &&
      JSON.stringify(tools0.widths.map((w) => [w.value, w.on])) === JSON.stringify([['equal', true], ['auto', false], ['custom', false]]) &&
      tools0.label && !tools0.label.on && !tools0.label.disabled && tools0.heights && !tools0.heights.on,
    JSON.stringify(tools0),
  )

  // ---- 行の高さ：そろえる ----
  await setCheck(page, 'heights', true, { ready })
  await showTable(page, ready)
  const eq = await shapeOf(page)
  const eqModel = await modelOf(page)
  const pdfEq = await pdfShape(page)
  saveCrop('pc-table-equal-pdf', pdfEq)
  const tools1 = await shapeState(page)
  await shotPalette('pc-toggle-equal')
  const tallestBody = Math.max(...auto0.body)
  check(
    'パソコン：「行の高さ」を「そろえる」にすると、見出しの行のほかの行が、いちばん高い行と同じ高さになる（画面で 0.5px 以内）。見出しの行の高さは変わらない',
    eqModel.heights === 'equal' && spread(eq.body) <= 0.5 && asTallest(eq.body[0], tallestBody) && Math.abs(eq.head - auto0.head) <= 0.01 && eq.cls.includes('heights-equal'),
    JSON.stringify({ auto: brief(auto0), equal: brief(eq) }),
  )
  const pdfBodyEq = pdfEq.rows.slice(1)
  check(
    'パソコン：PDF の絵でも、見出しの行のほかの行の高さが 0.5px 以内で同じで、画面と同じ高さ。見出しの行も画面と同じ',
    pdfEq.rows.length === eq.first + 1 && spread(pdfBodyEq) <= 0.5 && Math.abs(pdfBodyEq[0] - eq.body[0]) <= 0.5 && Math.abs(pdfEq.rows[0] - eq.head) <= 0.5,
    JSON.stringify({ pdf: pdfEq.rows.map(r2), screen: [eq.head, ...eq.body].map(r2) }),
  )
  check('パソコン：そろえたあとは、窓の「行の高さをそろえる」に印が付く（窓は開いたまま）', tools1?.heights?.on === true, JSON.stringify(tools1?.heights))
  await closeShape(page)

  // ---- 元に戻す1回で「中身に合わせる」に戻り、やり直すとまた「そろえる」 ----
  await page.evaluate(() => window.__editor.undo())
  await ready()
  await showTable(page, ready)
  const undone = await shapeOf(page)
  const undoneModel = await modelOf(page)
  await page.evaluate(() => window.__editor.redo())
  await ready()
  await showTable(page, ready)
  const redone = await shapeOf(page)
  check(
    'パソコン：元に戻す1回で「中身に合わせる」（前と同じ高さ）に戻り、やり直すとまた「そろえる」',
    undoneModel.heights === 'auto' && JSON.stringify(brief(undone)) === JSON.stringify(brief(auto0)) && (await modelOf(page)).heights === 'equal' && JSON.stringify(brief(redone)) === JSON.stringify(brief(eq)),
    JSON.stringify({ undone: brief(undone), redone: brief(redone) }),
  )

  // ---- 「行の高さをそろえる」の印を外すと、もとの高さ ----
  await clickCell(cellId(1, 1))
  await setCheck(page, 'heights', false, { ready })
  await closeShape(page)
  await showTable(page, ready)
  const back = await shapeOf(page)
  check(
    'パソコン：「行の高さをそろえる」の印を外すと、もとの高さに戻る（行に高さを書かない）',
    (await modelOf(page)).heights === 'auto' && JSON.stringify(brief(back)) === JSON.stringify(brief(auto0)) && back.styled === 0 && !back.cls.includes('heights-equal'),
    JSON.stringify(brief(back)),
  )

  // ---- 行の高さ：写真が入る高さ（Word の素材表と同じ 34.5mm。依頼者の選択 2026-10-22 案A）。「そろえる」とはどちらか1つ ----
  await clickCell(cellId(1, 1))
  await setCheck(page, 'photo', true, { ready })
  await showTable(page, ready)
  const ph = await shapeOf(page)
  const pdfPh = await pdfShape(page)
  saveCrop('pc-table-photo-pdf', pdfPh)
  const tools2 = await shapeState(page)
  await shotPalette('pc-toggle-photo')
  // ページの原寸の px（A4 の高さ 1122.52px）で、34.5mm
  const PHOTO_PX = (34.5 / 297) * 1122.52
  check(
    'パソコン：「写真が入る高さにする」に印を付けると、見出しの行のほかの行が、どれも 34.5mm になる（生地見本の画像の行も。画面と PDF の絵で 1px 以内）。見出しの行の高さは変わらない。窓の印は「写真が入る高さ」だけ',
    (await modelOf(page)).heights === 'photo' &&
      ph.cls.includes('heights-photo') &&
      ph.body.every((h) => Math.abs(h - PHOTO_PX) <= 1) &&
      Math.abs(ph.head - auto0.head) <= 0.01 &&
      pdfPh.rows.slice(1).every((h) => Math.abs(h - PHOTO_PX) <= 1) &&
      tools2?.photo?.on === true &&
      tools2?.heights?.on === false,
    JSON.stringify({ photo: brief(ph), pdf: pdfPh.rows.map(r2), want: r2(PHOTO_PX), tools: [tools2?.heights, tools2?.photo] }),
  )
  await closeShape(page)
  await clickCell(cellId(1, 1))
  await setCheck(page, 'heights', true, { ready })
  const swapped = await shapeState(page)
  const swappedModel = await modelOf(page)
  await closeShape(page)
  await page.evaluate(() => window.__editor.undo())
  await ready()
  const undonePhoto = await modelOf(page)
  await clickCell(cellId(1, 1))
  await setCheck(page, 'photo', false, { ready })
  await closeShape(page)
  await showTable(page, ready)
  const offPhoto = await shapeOf(page)
  check(
    'パソコン：「写真が入る高さ」のときに「行の高さをそろえる」に印を付けると、写真が入る高さの印は外れる。元に戻す1回で「写真が入る高さ」に戻り、印を外すと、もとの高さ',
    swappedModel.heights === 'equal' && swapped?.heights?.on === true && swapped?.photo?.on === false && undonePhoto.heights === 'photo' && (await modelOf(page)).heights === 'auto' && JSON.stringify(brief(offPhoto)) === JSON.stringify(brief(auto0)),
    JSON.stringify({ swapped: [swapped?.heights, swapped?.photo], undone: undonePhoto.heights, off: brief(offPhoto) }),
  )

  // ---- 見出しの行がいちばん高くても、ほかの行は見出しの行に合わせない ----
  await page.evaluate(() => window.__editor.finishEditing())
  await ready()
  await page.evaluate((id, cid) => {
    window.__editor.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === id ? { ...b, rows: b.rows.map((row) => ({ ...row, cells: row.cells.map((x) => (x.id === cid ? { ...x, text: '項目\n（素材・色・柄\nなどを書く。\n見出しの\n行が\nいちばん\n高い表）' } : x)) })) } : b)) })) }))
  }, TABLE_ID, cellId(0, 0))
  await ready()
  await showTable(page, ready)
  const tallHeadAuto = await shapeOf(page)
  await page.evaluate((id) => window.__editor.setTableHeights(id, 'equal'), TABLE_ID)
  await ready()
  await showTable(page, ready)
  const tallHead = await shapeOf(page)
  check(
    'パソコン：見出しの行がいちばん高くても、ほかの行は見出しの行の高さにならない（ほかの行の中でいちばん高い行にそろう。見出しの行はそのまま）',
    tallHeadAuto.head > Math.max(...tallHeadAuto.body) + 5 && spread(tallHead.body) <= 0.5 && asTallest(tallHead.body[0], Math.max(...tallHeadAuto.body)) && Math.abs(tallHead.head - tallHeadAuto.head) <= 0.01,
    JSON.stringify({ auto: brief(tallHeadAuto), equal: brief(tallHead) }),
  )
  await page.evaluate(() => window.__editor.undo())
  await ready()
  await page.evaluate(() => window.__editor.undo())
  await ready()

  // ---- 項目の列（左端）は字に合わせる（列の幅をそろえるのときだけ） ----
  await clickCell(cellId(1, 1))
  await showTable(page, ready)
  const label0 = await shapeOf(page)
  await setCheck(page, 'label', true, { ready })
  await closeShape(page)
  await showTable(page, ready)
  const label1 = await shapeOf(page)
  const pdfLabel = await pdfShape(page)
  saveCrop('pc-table-label-pdf', pdfLabel)
  const labelModel = await modelOf(page)
  check(
    'パソコン：「項目の列（左端）は字に合わせる」に印を付けると、左端の列が字の幅（ほかの列より狭い）になり、ほかの列は 0.5px 以内で同じ幅（表の幅は同じ）',
    labelModel.labelColumn && label1.cols[0] < label1.cols[1] - 20 && spread(label1.cols.slice(1)) <= 0.5 && Math.abs(label1.cols.reduce((a, b) => a + b) - label0.cols.reduce((a, b) => a + b)) <= 1 && label1.colgroup,
    JSON.stringify({ before: label0.cols.map(r2), after: label1.cols.map(r2) }),
  )
  check(
    'パソコン：PDF の絵でも、左端の列は画面と同じ幅で、ほかの列は 0.5px 以内で同じ幅',
    pdfLabel.cols.length === 3 && Math.abs(pdfLabel.cols[0] - label1.cols[0]) <= 0.75 && spread(pdfLabel.cols.slice(1)) <= 0.5,
    JSON.stringify({ pdf: pdfLabel.cols.map(r2), screen: label1.cols.map(r2) }),
  )
  // 左端の列の字が折り返していない
  const labelLines = await linesOfText(page, `.page-viewport.front .data-table[data-table-id="${TABLE_ID}"] tr > :first-child [data-block-id]`)
  check('パソコン：項目の列を字に合わせると、左端の列の字は折り返さない', labelLines.every((l) => l.length <= 1), JSON.stringify(labelLines))
  await page.evaluate(() => window.__editor.undo())
  await ready()
  await showTable(page, ready)
  const labelUndone = await shapeOf(page)
  check('パソコン：「項目の列（左端）」も、元に戻す1回で戻る（すべての列が同じ幅）', !(await modelOf(page)).labelColumn && spread(labelUndone.cols) <= 0.5, JSON.stringify(labelUndone.cols.map(r2)))
  await page.evaluate(() => window.__editor.redo())
  await ready()
  await clickCell(cellId(1, 1))
  await setCheck(page, 'label', false, { ready })
  await showTable(page, ready)
  const labelOff = await shapeOf(page)
  check('パソコン：「項目の列（左端）」の印を外すと、すべての列が同じ幅（0.5px 以内）', !(await modelOf(page)).labelColumn && spread(labelOff.cols) <= 0.5 && !labelOff.colgroup, JSON.stringify(labelOff.cols.map(r2)))
  // 列の幅を「字の多い列を広く」にすると、「項目の列（左端）」は、うすくなって押せない（「列の幅をそろえる」のときだけ）
  await pickWidth(page, 'auto', { ready })
  const toolsAuto = await shapeState(page)
  await setCheck(page, 'label', true, { ready })
  const labelBlocked = (await modelOf(page)).labelColumn
  check(
    'パソコン：「列の幅」が「字の多い列を広く」のときは、「項目の列（左端）」はうすく出て押せない（「「列の幅をそろえる」のときだけ」）',
    (await modelOf(page)).widths === 'auto' && toolsAuto.label.disabled && toolsAuto.label.text.includes('「列の幅をそろえる」のときだけ') && !labelBlocked,
    JSON.stringify(toolsAuto.label),
  )
  await pickWidth(page, 'equal', { ready })
  await closeShape(page)

  // ---- 表のマスの中は Enter で改行。Esc・Tab で書き終える ----
  await clickCell(cellId(4, 1))
  await page.evaluate(() => window.__editor.overlay.setCaret(window.__editor.overlay.text.length))
  await page.keyboard.press('Enter')
  await page.keyboard.type('無地')
  const typed = await page.evaluate(() => ({ text: window.__editor.overlay.text, editing: window.__editor.getSnapshot().editingId }))
  await page.keyboard.down('Shift')
  await page.keyboard.press('Enter')
  await page.keyboard.up('Shift')
  await page.keyboard.type('光沢')
  const shifted = await page.evaluate(() => window.__editor.overlay.text)
  // Android の文字入力のような、キーの知らせのない改行の入力
  await page.evaluate(() => window.__editor.overlay.element.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertParagraph', bubbles: true, cancelable: true })))
  await page.keyboard.type('つや')
  const android = await page.evaluate(() => ({ text: window.__editor.overlay.text, editing: window.__editor.getSnapshot().editingId }))
  check(
    'パソコン：表のマスの中で Enter を押すと改行になり、そのマスを書き続ける（Shift+Enter も改行。「。」は付かない）',
    typed.text === 'なし\n無地' && typed.editing === cellId(4, 1) && shifted === 'なし\n無地\n光沢',
    JSON.stringify({ typed, shifted }),
  )
  check('パソコン：キーの知らせのない改行の入力（Android の文字入力など）も、マスの中の改行になる', android.text === 'なし\n無地\n光沢\nつや' && android.editing === cellId(4, 1), JSON.stringify(android))
  // Tab で隣のマスへ（書いた字は原稿に入る）。Shift+Tab で戻る。Esc で書き終える
  await page.keyboard.press('Tab')
  await wait(300)
  const tabbed = await page.evaluate(() => window.__editor.getSnapshot().editingId)
  await page.keyboard.down('Shift')
  await page.keyboard.press('Tab')
  await page.keyboard.up('Shift')
  await wait(300)
  const backTab = await page.evaluate(() => window.__editor.getSnapshot().editingId)
  await page.keyboard.press('Escape')
  await ready()
  const escaped = await page.evaluate(() => window.__editor.getSnapshot().editingId)
  const enterModel = await modelOf(page)
  check(
    'パソコン：Tab で隣のマスへ、Shift+Tab で前のマスへ移り、Esc で書き終える（書いた改行は原稿に入る）',
    tabbed === cellId(4, 2) && backTab === cellId(4, 1) && escaped === null && enterModel.texts[4][1] === 'なし\n無地\n光沢\nつや',
    JSON.stringify({ tabbed, backTab, escaped, text: enterModel.texts[4][1] }),
  )
  await showTable(page, ready)
  const paperLines = await linesOfText(page, `.page-viewport.front [data-cell-id="${cellId(4, 1)}"] [data-block-id]`)
  const pdfLines = await pdfShape(page, TABLE_ID, cellId(4, 1))
  check(
    'パソコン：改行したマスは、紙面でも PDF の絵でも4行になる',
    JSON.stringify(paperLines[0]) === JSON.stringify(['なし', '無地', '光沢', 'つや']) && pdfLines.textLines === 4,
    JSON.stringify({ paper: paperLines[0], pdf: pdfLines.textLines }),
  )

  // ---- 前からある表（素材表）は変わらない ----
  const existing1 = await existingOf(page, ready)
  check(
    'パソコン：前からある表（見本の素材表。行の高さ・左端の列を変えていない）は、紙面の形も HTML も変わらない（行に高さを書かない・列の幅も書かない）',
    JSON.stringify(existing1) === JSON.stringify(existing0) && existing0.html === 'widths-equal' && existing0.styled === 0 && !existing0.colgroup,
    JSON.stringify({ before: existing0, after: existing1 }),
  )

  // ---- 画面の写真：画像の行と文字の行のある表を、両方の形で ----
  await showTable(page, ready)
  const tableShot = async (name) => {
    const clip = await page.evaluate((id) => {
      const el = document.querySelector(`.page-viewport.front .data-table[data-table-id="${id}"]`)
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.left - 16, y: r.top - 12, width: r.width + 32, height: r.height + 24 }
    }, TABLE_ID)
    await page.screenshot({ path: `${OUT}/${name}.png`, clip: { ...clip, scale: 2 }, captureBeyondViewport: false })
  }
  await tableShot('pc-table-auto')
  await page.evaluate((id) => window.__editor.setTableHeights(id, 'equal'), TABLE_ID)
  await ready()
  await showTable(page, ready)
  await tableShot('pc-table-equal')
  await page.evaluate((id) => window.__editor.setTableLabelColumn(id, true), TABLE_ID)
  await ready()
  await showTable(page, ready)
  await tableShot('pc-table-equal-label')
  saveCrop('pc-table-equal-label-pdf', await pdfShape(page))

  // ---- 列の幅「中身に合わせる」：1字だけの行を作らない（見本の素材表に「特徴」の列を足した、4列の表。mockups/v42 で見つかったもの） ----
  await page.evaluate((FEAT) => {
    window.__editor.update((r) => ({
      ...r,
      body: r.body.map((c) => ({
        ...c,
        blocks: c.blocks.map((b) =>
          b.id !== 't1'
            ? b
            : { ...b, widths: 'auto', rows: b.rows.map((row, i) => ({ ...row, cells: [...row.cells.slice(0, 2), i === 0 ? { id: 't1:hf', text: FEAT.head, imageId: null } : { id: `${row.id}:feat`, text: FEAT.rows[i - 1], imageId: null }, ...row.cells.slice(2)] })) },
        ),
      })),
    }))
  }, FEATURES)
  await ready()
  await showTable(page, ready, 't1')
  const lone4 = await loneLines(page, 't1')
  await page.evaluate(() => document.querySelector('.page-viewport.front .data-table[data-table-id="t1"]').scrollIntoView({ block: 'center' }))
  await tableShotOf(page, 't1', 'pc-auto-4columns')
  check(
    'パソコン：列の幅「中身に合わせる」の4列の表（名称・使用箇所・特徴・生地見本）で、どのセルも、折り返した最後の行が1字だけにならない（「使用箇／所」「コットンサテ／ン」にならない）',
    lone4.cells.length === 16 && lone4.bad.length === 0 && lone4.cells.some((c) => c.lines.length > 1),
    JSON.stringify(lone4),
  )
  // 確かめに使う表も「中身に合わせる」に（長い字・改行・画像のセル）
  await page.evaluate((id) => window.__editor.setTableWidths(id, 'auto'), TABLE_ID)
  await ready()
  await showTable(page, ready)
  const loneShape = await loneLines(page, TABLE_ID)
  check('パソコン：列の幅「中身に合わせる」の確かめの表（見出しの長い表・改行のあるセル）でも、1字だけの行はない', loneShape.bad.length === 0, JSON.stringify(loneShape))
  await context.close()
  await photoTablePage(browser, check)
}

/**
 * 映画・舞台衣装デザイナーコースのひな形と同じつくり（改ページ → 小見出し「使用素材」・説明1行・「写真が入る高さ」の6行の素材表で、章が終わる）。
 * Word のひな形と同じく、1ページに入る。小見出しはページのいちばん上から始まる。表のあとに空のページはできない
 * （前は、表の下の余白の分だけ章の終わりの目印が次のページへ送られ、空のページができていた：2026-10-22）
 */
async function photoTablePage(browser, check) {
  const { context, page, ready } = await openSample(browser, false)
  await page.evaluate(() => {
    const cell = (id, text) => ({ id, text, imageId: null })
    const rows = [{ id: 'ph', cells: ['名称', '使用箇所', '生地見本'].map((t, i) => cell(`ph${i}`, t)) }, ...Array.from({ length: 6 }, (_, r) => ({ id: `pr${r}`, cells: [0, 1, 2].map((c) => cell(`pc${r}${c}`, '')) }))]
    const p = (id, text) => ({ type: 'paragraph', id, content: [{ type: 'text', text }] })
    window.__editor.update((r) => ({
      ...r,
      body: [
        { id: 'pC1', title: '企画・立案', blocks: [{ type: 'subheading', id: 'pS1', title: 'デザイン説明' }, p('pP1', 'デザインのもとにした時代・地域の装いと、込めた意図を書く。'), { type: 'pageBreak', id: 'pPB' }, { type: 'subheading', id: 'pS2', title: '使用素材' }, p('pP2', '使った素材と使った場所を表1にまとめ、文中に「表1」と書く'), { type: 'table', id: 'pT', caption: '使用材料表', widths: 'equal', heights: 'photo', rows }] },
        { id: 'pC2', title: '制作過程', blocks: [p('pP3', '次の作業について書く。')] },
      ],
    }))
  })
  await ready()
  const at = await page.evaluate(() => ({ sub: window.__editor.pageOfBlock('pS2'), last: window.__editor.pageOfBlock('pc50'), next: window.__editor.pageOfBlock('pP3') }))
  await page.evaluate((p) => window.__editor.goToPage(p, 'none'), at.sub)
  await ready()
  const top = await page.evaluate(() => {
    const h = [...document.querySelectorAll('.page-viewport.front h2.subheading')].find((e) => e.textContent.includes('使用素材'))
    const pageEl = h.closest('[data-vivliostyle-page-container]').getBoundingClientRect()
    return Math.round(((h.getBoundingClientRect().top - pageEl.top) / pageEl.height) * 297 * 10) / 10
  })
  check(
    'パソコン：改ページ → 小見出し・説明1行・「写真が入る高さ」の6行の表で章が終わるとき、表は1ページに入り、次の章はすぐ次のページ（空のページができない）。改ページの後の小見出しは、ページのいちばん上（上の余白 25mm）から',
    at.sub === at.last && at.next === at.sub + 1 && Math.abs(top - 25) <= 0.5,
    JSON.stringify({ ...at, topMm: top }),
  )
  await context.close()
}

/** 見本の素材表に足す「特徴」の列（mockups/v42 と同じ字） */
export const FEATURES = {
  head: '特徴',
  rows: ['やわらかい光沢があり、照明が当たると表面が光る', '薄く透ける。腕を動かすと、風に揺れて見える', '張りがあって丈夫。しゃがんでも形がくずれにくい'],
}

/**
 * 表のセルごとの、紙面での行（字の四角の高さで分ける。改行で分けた行ごと）。bad：折り返した行の最後の行が1字だけのセル
 * （1字だけの字のセルや、改行で分けた1字だけの行は数えない）
 */
const loneLines = (page, id) =>
  page.evaluate((id) => {
    const cells = [...document.querySelectorAll(`.page-viewport.front .data-table[data-table-id="${id}"] th, .page-viewport.front .data-table[data-table-id="${id}"] td`)]
    const out = cells.map((cell) => {
      const span = cell.querySelector('[data-block-id]')
      // 改行で分けた行ごとに、紙面の行に分ける
      const explicit = [[]]
      let last = null
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode
        for (let i = 0; i < node.length; i++) {
          const ch = node.data[i]
          if (ch === '\n') {
            explicit.push([])
            last = null
            continue
          }
          if (/\s/.test(ch)) continue
          const r = document.createRange()
          r.setStart(node, i)
          r.setEnd(node, i + 1)
          const q = [...r.getClientRects()].find((x) => x.height > 0)
          if (!q) continue
          const lines = explicit[explicit.length - 1]
          if (last === null || q.top > last + q.height * 0.5) {
            lines.push('')
            last = q.top
          }
          lines[lines.length - 1] += ch
        }
      }
      return { id: cell.getAttribute('data-cell-id'), lines: explicit.flat(), lone: explicit.some((lines) => lines.length > 1 && lines[lines.length - 1].length === 1) }
    })
    return { cells: out.map(({ id, lines }) => ({ id, lines })), bad: out.filter((c) => c.lone).map((c) => `${c.id}:${c.lines.join('／')}`) }
  }, id)

/** 紙面の表のまわりを撮る */
async function tableShotOf(page, id, name) {
  const clip = await page.evaluate((id) => {
    const r = document.querySelector(`.page-viewport.front .data-table[data-table-id="${id}"]`).getBoundingClientRect()
    return { x: r.left - 16, y: r.top - 12, width: r.width + 32, height: r.height + 24 }
  }, id)
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: { ...clip, scale: 2 }, captureBeyondViewport: false })
}

export async function tableShapePhone(browser, check) {
  const { context, page, ready } = await openSample(browser, true)
  await showTable(page, ready)
  const auto0 = await shapeOf(page)
  const tapCell = async (id) => {
    const at = await page.evaluate((id) => {
      const r = document.querySelector(`.page-viewport.front [data-cell-id="${id}"]`).getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }, id)
    await page.touchscreen.tap(at.x, at.y)
    await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 10000 }, id).catch(() => {})
    await wait(500)
  }
  /** キーボードの上の道具の2段目（表の道具）：ボタンの名前・大きさ。画面の中にあるか（reach。横にずらさずに） */
  const dbTools = () =>
    page.evaluate(() => {
      const row = document.querySelector('.direct-bar .db-table')
      if (!row) return null
      const out = [...row.querySelectorAll('button')].map((b) => {
        const r = b.getBoundingClientRect()
        return { name: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), reach: r.left >= -0.5 && r.right <= innerWidth + 0.5 }
      })
      return { tools: out, scrolls: row.scrollWidth > row.clientWidth + 0.5, rowRight: row.getBoundingClientRect().right <= innerWidth + 0.5 }
    })
  const opts = { phone: true, ready }
  // ---- セルを押して紙面の上で書く：キーボードの上の道具の2段目は、横にずらさない1段（画像・行・列を足す・行・列を消す・表の形・表を削除。44px 以上） ----
  await tapCell(cellId(1, 1))
  const db0 = await dbTools()
  const dbLines = await linesOfText(page, '.direct-bar .db-table button')
  await page.screenshot({ path: `${OUT}/phone-toolbar.png` })
  check(
    'スマホ：表のセルを書いている間、キーボードの上の道具の2段目は「画像・行を足す・列を足す・行を消す・列を消す・表の形・表を削除」の7つ（どれも 44px 以上。名前は1行）',
    !!db0 &&
      JSON.stringify(db0.tools.map((t) => t.name)) === JSON.stringify(['画像', '行を足す', '列を足す', '行を消す', '列を消す', '表の形', '表を削除']) &&
      db0.tools.every((t) => t.w >= 44 && t.h >= 44) &&
      dbLines.every((l) => l.length === 1),
    JSON.stringify({ tools: db0?.tools, lines: dbLines }),
  )
  check('スマホ：2段目の道具は、横にずらさなくても全部が画面に入る（ずらす所はない）', !!db0 && !db0.scrolls && db0.rowRight && db0.tools.every((t) => t.reach), JSON.stringify({ scrolls: db0?.scrolls, reach: db0?.tools.map((t) => t.reach) }))

  // ---- 行の高さ：そろえる（「表の形」の欄の「行の高さをそろえる」）。紙面と PDF の絵で、見出しの行のほかの行が同じ高さ ----
  await setCheck(page, 'heights', true, opts)
  const sheetEq = await shapeState(page)
  await closeShape(page, true)
  await wait(300)
  await showTable(page, ready)
  const eq = await shapeOf(page)
  const pdfEq = await pdfShape(page)
  saveCrop('phone-table-equal-pdf', pdfEq)
  const stillEditing = await page.evaluate(() => window.__editor.getSnapshot().editingId)
  check(
    'スマホ：「表の形」の欄で「行の高さをそろえる」に印を付けると、見出しの行のほかの行が、いちばん高い行と同じ高さになる（画面・PDF の絵とも 0.5px 以内。見出しの行はそのまま。「できた」で、書いていたマスを書き続ける）',
    (await modelOf(page)).heights === 'equal' &&
      spread(eq.body) <= 0.5 &&
      asTallest(eq.body[0], Math.max(...auto0.body)) &&
      Math.abs(eq.head - auto0.head) <= 0.01 &&
      spread(pdfEq.rows.slice(1)) <= 0.5 &&
      Math.abs(pdfEq.rows[1] - eq.body[0]) <= 0.5 &&
      sheetEq?.kind === 'sheet' &&
      sheetEq.heights.on &&
      stillEditing === cellId(1, 1),
    JSON.stringify({ auto: brief(auto0), equal: brief(eq), pdf: pdfEq.rows.map(r2), editing: stillEditing }),
  )
  // 元に戻す（キーボードの上の「戻す」）1回で戻る
  await page.tap('.direct-bar .db-row button:first-child')
  await wait(400)
  await ready()
  await showTable(page, ready)
  const undone = await shapeOf(page)
  check('スマホ：キーボードの上の「戻す」1回で「中身に合わせる」（前と同じ高さ）に戻る', (await modelOf(page)).heights === 'auto' && JSON.stringify(brief(undone)) === JSON.stringify(brief(auto0)), JSON.stringify(brief(undone)))

  // ---- 項目の列（左端）は字に合わせる ----
  await tapCell(cellId(1, 1))
  await setCheck(page, 'label', true, opts)
  await closeShape(page, true)
  await showTable(page, ready)
  const label = await shapeOf(page)
  check(
    'スマホ：「項目の列（左端）は字に合わせる」に印を付けると、左端の列が字の幅（ほかより狭い）、ほかの列は 0.5px 以内で同じ幅',
    (await modelOf(page)).labelColumn && label.cols[0] < label.cols[1] - 20 && spread(label.cols.slice(1)) <= 0.5,
    JSON.stringify(label.cols.map(r2)),
  )
  await setCheck(page, 'label', false, opts)
  await showTable(page, ready)
  const labelOff = await shapeOf(page)
  await pickWidth(page, 'auto', opts)
  const sheetAuto = await shapeState(page)
  check(
    'スマホ：印を外すと、すべての列が同じ幅。「列の幅」を「字の多い列を広く」にすると「項目の列（左端）」はうすくなって押せない（「「列の幅をそろえる」のときだけ」）',
    !(await modelOf(page)).labelColumn && spread(labelOff.cols) <= 0.5 && (await modelOf(page)).widths === 'auto' && sheetAuto.label.disabled && sheetAuto.label.text.includes('「列の幅をそろえる」のときだけ'),
    JSON.stringify({ cols: labelOff.cols.map(r2), label: sheetAuto.label }),
  )
  await pickWidth(page, 'equal', opts)
  await closeShape(page, true)

  // ---- マスの中の改行：Enter・キーの知らせのない改行の入力。「完了」で書き終える ----
  await tapCell(cellId(4, 1))
  await page.evaluate(() => window.__editor.overlay.setCaret(window.__editor.overlay.text.length))
  await page.keyboard.press('Enter')
  await page.keyboard.type('無地')
  const typed = await page.evaluate(() => ({ text: window.__editor.overlay.text, editing: window.__editor.getSnapshot().editingId, zoomed: window.__editor.getSnapshot().zoomed }))
  await page.evaluate(() => window.__editor.overlay.element.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertParagraph', bubbles: true, cancelable: true })))
  await page.keyboard.type('光沢')
  const android = await page.evaluate(() => ({ text: window.__editor.overlay.text, editing: window.__editor.getSnapshot().editingId }))
  check(
    'スマホ：表のマスの中で Enter を押すと改行になり、拡大したまま、そのマスを書き続ける',
    typed.text === 'なし\n無地' && typed.editing === cellId(4, 1) && typed.zoomed,
    JSON.stringify(typed),
  )
  check('スマホ：キーの知らせのない改行の入力（Android の文字入力）も、マスの中の改行になる', android.text === 'なし\n無地\n光沢' && android.editing === cellId(4, 1), JSON.stringify(android))
  await page.screenshot({ path: `${OUT}/phone-cell-newline.png` })
  // ほかのマスを押すと、そのマスへ移る（書いた字は原稿に入る）
  await tapCell(cellId(3, 2))
  const moved = await page.evaluate(() => window.__editor.getSnapshot().editingId)
  await page.tap('.direct-bar .db-done')
  await wait(400)
  await ready()
  const done = await page.evaluate(() => ({ editing: window.__editor.getSnapshot().editingId, zoomed: window.__editor.getSnapshot().zoomed }))
  check(
    'スマホ：ほかのマスを押すとそのマスへ移り、「完了」で書き終える（書いた改行は原稿に入る）',
    moved === cellId(3, 2) && done.editing === null && (await modelOf(page)).texts[4][1] === 'なし\n無地\n光沢',
    JSON.stringify({ moved, done, text: (await modelOf(page)).texts[4][1] }),
  )
  await showTable(page, ready)
  const pdfLines = await pdfShape(page, TABLE_ID, cellId(4, 1))
  check('スマホ：改行したマスは、PDF の絵でも3行になる', pdfLines.textLines === 3, JSON.stringify({ lines: pdfLines.textLines }))

  // ---- 表を選んだときの下の道具：「表の形」のボタン1つ（押すと下から欄）。44px 以上。名前は1行。画面に入る ----
  await page.evaluate((id) => window.__editor.select({ kind: 'table', id }), TABLE_ID)
  await wait(500)
  const sel = await page.evaluate(async () => {
    const group = document.querySelector('.sel-bar .group.ctx')
    const out = []
    for (const b of group.querySelectorAll('button')) {
      b.scrollIntoView({ inline: 'nearest', block: 'nearest' })
      await new Promise((r) => requestAnimationFrame(r))
      const r = b.getBoundingClientRect()
      out.push({ name: b.textContent.trim(), title: b.title, w: Math.round(r.width), h: Math.round(r.height), reach: r.left >= -0.5 && r.right <= innerWidth + 0.5 })
    }
    group.scrollLeft = 0
    const g = group.getBoundingClientRect()
    return { tools: out, inside: g.left >= 0 && g.right <= innerWidth }
  })
  const selLines = await linesOfText(page, '.sel-bar .shape-btn span')
  await page.screenshot({ path: `${OUT}/phone-selbar.png` })
  check(
    'スマホ：表を選んだときの下の道具に「表の形」（44px 以上。名前は1行。どの道具も画面に入る）',
    sel.tools.some((t) => t.name === '表の形') && sel.tools.every((t) => t.w >= 44 && t.h >= 44 && t.reach) && sel.inside && JSON.stringify(selLines) === '[["表の形"]]',
    JSON.stringify({ tools: sel.tools, lines: selLines }),
  )
  // 「表の形」の欄で、行の高さをそろえる
  await setCheck(page, 'heights', true, opts)
  const selSheet = await shapeState(page)
  await page.screenshot({ path: `${OUT}/phone-selbar-equal.png` })
  await closeShape(page, true)
  check('スマホ：表を選んだときの「表の形」の欄で「行の高さをそろえる」に印を付けると、そろう', (await modelOf(page)).heights === 'equal' && selSheet?.heights?.on === true, JSON.stringify(selSheet?.heights))
  await page.evaluate(() => window.__editor.select(null))
  await wait(300)
  // 画面の写真：表を両方の形で（紙面は縮小しているので、表のまわりを拡大して撮る）
  await showTable(page, ready)
  const tableShot = async (name) => {
    const clip = await page.evaluate((id) => {
      const r = document.querySelector(`.page-viewport.front .data-table[data-table-id="${id}"]`).getBoundingClientRect()
      return { x: Math.max(0, r.left - 8), y: r.top - 8, width: Math.min(innerWidth, r.right + 8) - Math.max(0, r.left - 8), height: r.height + 16 }
    }, TABLE_ID)
    await page.screenshot({ path: `${OUT}/${name}.png`, clip: { ...clip, scale: 1 }, captureBeyondViewport: false })
  }
  await tableShot('phone-table-equal')
  await page.evaluate((id) => window.__editor.setTableHeights(id, 'auto'), TABLE_ID)
  await ready()
  await showTable(page, ready)
  await tableShot('phone-table-auto')
  await context.close()
}

// これだけを動かす：node scripts/e2e/tableShape.mjs（pc・phone で片方だけ）
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { withEdge } = await import('../poc/edge.mjs')
  const only = process.argv[2]
  const results = []
  const check = (name, ok, detail = '') => {
    results.push(ok)
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
  }
  await withEdge(async (browser) => {
    if (only !== 'phone') await tableShapePc(browser, check)
    if (only !== 'pc') await tableShapePhone(browser, check)
  })
  const failed = results.filter((ok) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} 件 合格`)
  process.exitCode = failed ? 1 : 0
}
