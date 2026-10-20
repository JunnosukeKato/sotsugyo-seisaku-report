import type { Chapter, TableBlock } from '../model/types'

/**
 * 表の行の高さ・左端の列の幅を、組んだ紙面で測って決める（「そろえる」「中身に合わせる」にした表だけ。editor/reportRenderer.ts が組むたびに測り、
 * 測った寸法を表の HTML に書いて組み直す：bodyHtml.ts の renderTable）。
 *
 * - 行の高さ「そろえる」：見出しの行のほかの行を、その中でいちばん高い行と同じ高さにする（見出しの行は、中身に合わせたまま。高さを比べるときにも入れない）。
 *   CSS だけでは、表の行の高さをいちばん高い行にそろえられない（grid にすると、組版エンジンが表としてページを分けられず、見出しの行をページごとに出すことも、
 *   枠線を重ねる見た目も変わる）。そこで、組んだ紙面で行の中身の高さを測り、行の高さ（pt）を HTML に書く。PDF・印刷も、同じ HTML の紙面なので同じ高さになる。
 *   中身の高さは、組版エンジンがセルの中身を包む要素（CELL_BOX）の高さで測る（行の高さを書いたあとも、この要素の高さは中身のままなので、測り直しても同じ値になる）
 * - 左端の列「中身に合わせる」（列の幅が「そろえる」の表だけ）：左端の列の幅を、その列のセルの字（画像）が折り返さない幅にする（表の幅の 40% まで）。
 *   ほかの列は、残りを同じ幅で分ける（table-layout: fixed のまま、左端の列にだけ幅を書く）。
 *   セルの中身を包む要素の幅を、測る間だけ max-content にして測る（すぐ元に戻す。画面には出ない）
 */

/** 表ごとの、測って決めた寸法（pt）。row：見出しの行のほかの行の高さ、label：左端の列の幅 */
export interface TableFit {
  row?: number
  label?: number
}

/** 表の ID → 寸法 */
export type TableFits = Readonly<Record<string, TableFit>>

/** 組版エンジンが、表のセルの中身を包む要素 */
const CELL_BOX = '.-vivliostyle-table-cell-container'
/** 書く寸法の刻み（pt）。列の幅は 0.25pt */
const STEP_PT = 0.25
/**
 * 行の高さの刻み（pt）：CSS の 1px（0.75pt）。表の枠線は、PDF の絵にするときに 1px の目にそろえて描かれるため、
 * 行の高さに端数があると、同じ高さの行でも、絵では枠線の間が 1px 違って見えることがある。1px の倍数なら、どの行の枠線の間も同じになる
 */
const ROW_STEP_PT = 0.75
/** 測った値が前の値より少し小さくなっただけなら、前の値のままにする（組み直しが行ったり来たりしないように。pt） */
const SHRINK_TOLERANCE_PT = 0.75
/** 測った値が前の値をこれだけ越えても、前の値のままにする（測るときの端数。pt） */
const GROW_TOLERANCE_PT = 0.05
/** 左端の列の幅の上限（表の幅に対する割合。長い字の列が、ほかの列を狭めすぎないように） */
export const LABEL_MAX_RATIO = 0.4
/** 左端の列の幅に足すゆとり（pt。測った幅ちょうどだと、端数で最後の字が折り返すことがあるため） */
const LABEL_SLACK_PT = 0.75
/** 左端の列の幅の下限（pt。左端の列のセルがみな空でも、押して書ける幅を残す。余白と枠線を入れて、1字半ほど） */
const LABEL_MIN_PT = 24
/** CSS の 1px（pt） */
const CSS_PX_PT = 0.75
/** そろえた行の高さの上限（pt。200mm。1ページに入らない高さの行を、どの行にも付けないように） */
export const ROW_MAX_PT = (200 / 25.4) * 72

/** 行の高さをそろえる表か */
export function equalRows(table: TableBlock): boolean {
  return table.heights === 'equal'
}

/** 左端の列を中身に合わせる表か（列の幅が「そろえる」のときだけ効く。「中身に合わせる」「自分で決める」では効かない） */
export function fitsLabel(table: TableBlock): boolean {
  return table.widths === 'equal' && table.labelColumn === true
}

/** 寸法を測る表（行の高さをそろえる・左端の列を中身に合わせる） */
function fittedTables(chapters: Chapter[]): TableBlock[] {
  return chapters.flatMap((c) => c.blocks).filter((b): b is TableBlock => b.type === 'table' && (equalRows(b) || fitsLabel(b)))
}

/** HTML に書く寸法（例：12.25pt） */
export function ptText(value: number): string {
  return `${Number(value.toFixed(2))}pt`
}

/**
 * 測った値から、HTML に書く値を決める。前の値（prev）が測った値とほぼ同じか、少し大きいだけなら、前の値のまま（組み直しが落ち着くように）。
 * そうでなければ、測った値を刻み（step。列の幅は 0.25pt、行の高さは 0.75pt＝1px）に切り上げる（書いた高さ・幅が、中身より小さくならないように）
 */
export function settleFit(prev: number | undefined, measured: number, step = STEP_PT): number {
  if (prev !== undefined && prev >= measured - GROW_TOLERANCE_PT && prev - measured < Math.max(SHRINK_TOLERANCE_PT, step)) return prev
  return Number((Math.ceil(measured / step - 1e-6) * step).toFixed(4))
}

/** 今の原稿で寸法を測る表の分だけを残す（消した表・「中身に合わせる」に戻した表の寸法は使わない） */
export function fitsFor(chapters: Chapter[], fits: TableFits): TableFits {
  const out: Record<string, TableFit> = {}
  for (const t of fittedTables(chapters)) {
    const f = fits[t.id]
    if (!f) continue
    const kept: TableFit = { ...(equalRows(t) && f.row !== undefined ? { row: f.row } : {}), ...(fitsLabel(t) && f.label !== undefined ? { label: f.label } : {}) }
    if (kept.row !== undefined || kept.label !== undefined) out[t.id] = kept
  }
  return out
}

export function sameTableFits(a: TableFits, b: TableFits): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((k) => b[k] !== undefined && a[k].row === b[k].row && a[k].label === b[k].label)
}

/** この端末に覚えた寸法（layout/memory.ts）を読む（形が違うものは捨てる） */
export function readTableFits(raw: unknown): TableFits {
  const out: Record<string, TableFit> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const f = value as { row?: unknown; label?: unknown } | null
    if (!f || typeof f !== 'object') continue
    const fit: TableFit = { ...(ok(f.row) ? { row: f.row } : {}), ...(ok(f.label) ? { label: f.label } : {}) }
    if (fit.row !== undefined || fit.label !== undefined) out[id] = fit
  }
  return out
}

/**
 * 組んだ紙面から、表の寸法を測る（測る表だけ）。prev：今の紙面を組んだときの寸法（ほぼ同じなら、そのまま使う：settleFit）。
 * 紙面に見つからない表は、前の寸法のまま
 */
export function measureTableFits(pages: HTMLElement[], chapters: Chapter[], prev: TableFits): TableFits {
  const tables = fittedTables(chapters)
  if (tables.length === 0) return {}
  const out: Record<string, TableFit> = {}
  for (const t of tables) {
    // 表の部分（ページをまたぐ表は、ページごとに分かれている）と、その部分のあるページ（pt に直す倍率）
    const parts = pages.flatMap((page) => {
      const r = page.getBoundingClientRect()
      const pt = r.height > 0 ? ((297 / 25.4) * 72) / r.height : 0
      return [...page.querySelectorAll<HTMLTableElement>(`.data-table[data-table-id="${CSS.escape(t.id)}"] table`)].map((table) => ({ table, pt }))
    }).filter((p) => p.pt > 0)
    const before = prev[t.id] ?? {}
    if (parts.length === 0) {
      if (before.row !== undefined || before.label !== undefined) out[t.id] = before
      continue
    }
    const fit: TableFit = {}
    if (equalRows(t)) {
      const row = naturalBodyRow(parts)
      if (row > 0) fit.row = settleFit(before.row, Math.min(row, ROW_MAX_PT), ROW_STEP_PT)
    }
    if (fitsLabel(t)) {
      const label = labelWidth(parts)
      if (label > 0) fit.label = settleFit(before.label, label)
    }
    if (fit.row !== undefined || fit.label !== undefined) out[t.id] = fit
  }
  return out
}

/** セルの中身の高さ・幅（画面の px）。組版エンジンが中身を包む要素がなければ、セルの中の要素と字の範囲 */
function cellBox(cell: Element): Element | null {
  // ページをまたぐ表では、包む要素がもう1つの要素の中に入る
  return cell.querySelector(CELL_BOX)
}

/**
 * セルの中身の高さ（画面の px）。cssPx：ページの原寸の 1px が、画面で何 px か（余白の値を画面の px に直す）。
 * 中身を包む要素の高さに、その外へはみ出す子の上下の余白も入れる（画像だけのセルでは、画像の下の余白 1mm が包む要素の外に出る。
 * セルの中には収まるので、行の高さには入る）
 */
function contentHeight(cell: Element, cssPx: number): number {
  const box = cellBox(cell)
  if (!box) {
    const range = document.createRange()
    range.selectNodeContents(cell)
    return range.getBoundingClientRect().height
  }
  const r = box.getBoundingClientRect()
  let top = r.top
  let bottom = r.bottom
  for (const child of box.children) {
    const cs = getComputedStyle(child)
    if (cs.display === 'none' || cs.display.startsWith('inline') || cs.position === 'absolute' || cs.position === 'fixed') continue
    const c = child.getBoundingClientRect()
    top = Math.min(top, c.top - (parseFloat(cs.marginTop) || 0) * cssPx)
    bottom = Math.max(bottom, c.bottom + (parseFloat(cs.marginBottom) || 0) * cssPx)
  }
  return bottom - top
}

/**
 * 見出しの行のほかの行の、中身に合わせたときの高さのうち、いちばん高いもの（pt）。
 * 行の高さ＝行の中でいちばん高いセルの中身の高さ＋セルの上下の余白と枠線。余白と枠線の分は、見出しの行（いつも中身に合わせた高さ）で測る
 * （見出しの行の高さから、その行でいちばん高いセルの中身の高さを引いた分。どの行のセルも、余白と枠線は同じ）
 */
function naturalBodyRow(parts: { table: HTMLTableElement; pt: number }[]): number {
  let chrome: number | null = null
  for (const { table, pt } of parts) {
    const head = table.querySelector(':scope > thead > tr')
    if (!head || head.children.length === 0) continue
    const tallest = Math.max(...[...head.children].map((c) => contentHeight(c, CSS_PX_PT / pt)))
    chrome = (head.getBoundingClientRect().height - tallest) * pt
    break
  }
  if (chrome === null) return 0
  let row = 0
  for (const { table, pt } of parts) {
    for (const tr of table.querySelectorAll(':scope > tbody > tr')) {
      if (tr.children.length === 0) continue
      row = Math.max(row, Math.max(...[...tr.children].map((c) => contentHeight(c, CSS_PX_PT / pt))) * pt + chrome)
    }
  }
  return row
}

/**
 * 左端の列の、字（画像）が折り返さない幅（pt。表の幅の 40% まで）。
 * 左端のセル（見出しの行も）の中身を包む要素の幅を、測る間だけ max-content にして測り、セルの左右の余白と枠線の分を足す
 */
function labelWidth(parts: { table: HTMLTableElement; pt: number }[]): number {
  const cells = parts.flatMap(({ table, pt }) =>
    [...table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr')].flatMap((tr) => {
      const cell = tr.firstElementChild
      const box = cell ? (cellBox(cell) as HTMLElement | null) : null
      return cell && box ? [{ cell, box, pt, tableWidth: table.getBoundingClientRect().width * pt }] : []
    }),
  )
  if (cells.length === 0) return 0
  // 左右の余白と枠線の分（ふだんの幅で測る）
  const chrome = cells.map(({ cell, box, pt }) => (cell.getBoundingClientRect().width - box.getBoundingClientRect().width) * pt)
  const saved = cells.map(({ box }) => [box.style.getPropertyValue('width'), box.style.getPropertyPriority('width')] as const)
  let widest = 0
  try {
    for (const { box } of cells) box.style.setProperty('width', 'max-content', 'important')
    cells.forEach(({ box, pt }, i) => {
      widest = Math.max(widest, box.getBoundingClientRect().width * pt + chrome[i])
    })
  } finally {
    cells.forEach(({ box }, i) => {
      const [value, priority] = saved[i]
      if (value) box.style.setProperty('width', value, priority)
      else box.style.removeProperty('width')
    })
  }
  const max = Math.max(...cells.map((c) => c.tableWidth)) * LABEL_MAX_RATIO
  return Math.min(Math.max(widest + LABEL_SLACK_PT, LABEL_MIN_PT), max)
}
