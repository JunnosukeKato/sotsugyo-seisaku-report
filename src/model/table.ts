import { clampPercent } from './photos'
import type { PhotoPosition, TableBlock, TableCell, TableRow } from './types'

/**
 * 表（mockups/v16 案A）。1行目は見出しの行。行と列は自由に足せ、セルには文字と画像（生地見本など）を入れられる。
 * 列の幅は「そろえる（同じ幅）」「中身に合わせる」「自分で決める（列ごとの %）」から、行の高さは「そろえる」と「中身に合わせる」から選ぶ。素材表は、この表のひな形の1つ。
 */

type NewId = (prefix: string) => string

const cell = (newId: NewId, text = ''): TableCell => ({ id: newId('tc'), text, imageId: null })
const row = (newId: NewId, texts: string[]): TableRow => ({ id: newId('tr'), cells: texts.map((t) => cell(newId, t)) })

/** 入れる前に選べる表の大きさ（mockups/v35 ②。パソコンはます目、スマホは［−］［＋］）。行は見出しの行も数える（見出しともう1行が要る） */
export const TABLE_SIZE = { minColumns: 1, maxColumns: 6, minRows: 2, maxRows: 10, columns: 2, rows: 2 } as const

/** 表の大きさを、選べる範囲に収める（整数でなければ、いつもの 2列×2行の値にする） */
export function clampTableSize(columns: number, rows: number): { columns: number; rows: number } {
  const fit = (n: number, min: number, max: number, usual: number) => (Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : usual)
  return { columns: fit(columns, TABLE_SIZE.minColumns, TABLE_SIZE.maxColumns, TABLE_SIZE.columns), rows: fit(rows, TABLE_SIZE.minRows, TABLE_SIZE.maxRows, TABLE_SIZE.rows) }
}

/** 空の表（1行目は見出しの行。columns 列×rows 行。いつもは 2列×2行＝見出しの行と、1行） */
export function blankTable(id: string, newId: NewId, caption = '', columns: number = TABLE_SIZE.columns, rows: number = TABLE_SIZE.rows): TableBlock {
  const size = clampTableSize(columns, rows)
  const blank = () => Array.from({ length: size.columns }, () => '')
  return { type: 'table', id, caption, widths: 'equal', heights: 'auto', rows: Array.from({ length: size.rows }, () => row(newId, blank())) }
}

/** 素材表のひな形の見出し（生地見本の列には写真を入れる） */
export const MATERIAL_HEADERS = ['名称', '使用箇所', '生地見本']
export const SWATCH_HEADER = '生地見本'

/** 素材表のひな形（名称・使用箇所・生地見本） */
export function materialTable(id: string, newId: NewId, caption = '使用素材表'): TableBlock {
  return { type: 'table', id, caption, widths: 'equal', heights: 'auto', rows: [row(newId, MATERIAL_HEADERS), row(newId, ['', '', ''])] }
}

/**
 * ひな形のふつうの表から、学生の表を作る（mockups/v44。見出しの行は先生が書いた字、その下は空の行）。
 * 崩れた項目（ない・形が違う）は、いつもの値にする（学生のツールが止まらないように）
 */
export function tableFromTemplate(
  id: string,
  newId: NewId,
  t: { caption?: unknown; header?: unknown; rows?: unknown; widths?: unknown; colWidths?: unknown; heights?: unknown; labelColumn?: unknown },
): TableBlock {
  const header = (Array.isArray(t.header) && t.header.length > 0 ? t.header : ['', '']).slice(0, TABLE_SIZE.maxColumns).map((h) => (typeof h === 'string' ? h : ''))
  const count = typeof t.rows === 'number' && Number.isInteger(t.rows) ? Math.max(1, Math.min(TABLE_SIZE.maxRows - 1, t.rows)) : 1
  const widths = t.widths === 'auto' || t.widths === 'custom' ? t.widths : 'equal'
  const colWidths = normalizeColumnWidths(t.colWidths, header.length)
  return {
    type: 'table',
    id,
    caption: typeof t.caption === 'string' ? t.caption : '',
    widths,
    ...(colWidths ? { colWidths } : {}),
    heights: t.heights === 'equal' || t.heights === 'photo' ? t.heights : 'auto',
    ...(t.labelColumn === true ? { labelColumn: true } : {}),
    rows: [row(newId, header), ...Array.from({ length: count }, () => row(newId, header.map(() => '')))],
  }
}

/** 素材表のひな形のままの表か（見出しが「名称・使用箇所・生地見本」、中身は1行、列の幅・行の高さ・左端の列は、いつもの形） */
export function isPlainMaterialTable(table: TableBlock): boolean {
  const head = table.rows[0]?.cells.map((c) => c.text) ?? []
  return (
    head.length === MATERIAL_HEADERS.length &&
    head.every((h, i) => h === MATERIAL_HEADERS[i]) &&
    table.rows.length === 2 &&
    table.widths === 'equal' &&
    table.heights === 'auto' &&
    !table.labelColumn &&
    !colWidthsOf(table)
  )
}

/** セルの位置（行・列）。見つからなければ null */
export function cellPosition(table: TableBlock, cellId: string): { row: number; column: number } | null {
  for (let r = 0; r < table.rows.length; r++) {
    const c = table.rows[r].cells.findIndex((x) => x.id === cellId)
    if (c >= 0) return { row: r, column: c }
  }
  return null
}

const columns = (table: TableBlock) => Math.max(1, ...table.rows.map((r) => r.cells.length))

/** 表の列の数（いちばん多い行のセルの数） */
export const columnCount = columns

/** 行を足す（at 行目の下。見出しの行の上には足さない） */
export function addRow(table: TableBlock, at: number, newId: NewId): { table: TableBlock; firstCellId: string } {
  const added = row(newId, Array.from({ length: columns(table) }, () => ''))
  const rows = [...table.rows]
  rows.splice(Math.max(1, at + 1), 0, added)
  return { table: { ...table, rows }, firstCellId: added.cells[0].id }
}

/** 行を消す（見出しの行と、最後の1行は残す） */
export function removeRow(table: TableBlock, at: number): TableBlock {
  if (at <= 0 || table.rows.length <= 2) return table
  return { ...table, rows: table.rows.filter((_, i) => i !== at) }
}

/** 列を足す（at 列目の右）。自分で決めた列の幅があれば、足した列は、左どなり（at 列目）の幅を半分もらう */
export function addColumn(table: TableBlock, at: number, newId: NewId): TableBlock {
  const ws = colWidthsOf(table)
  const rows = table.rows.map((r) => ({ ...r, cells: [...r.cells.slice(0, at + 1), cell(newId), ...r.cells.slice(at + 1)] }))
  return { ...table, rows, ...(ws ? { colWidths: addColumnWidth(ws, at) } : {}) }
}

/** 列を消す（最後の1列は残す）。自分で決めた列の幅があれば、消した列の幅は左どなりへ（いちばん左の列なら右どなりへ） */
export function removeColumn(table: TableBlock, at: number): TableBlock {
  if (columns(table) <= 1) return table
  const ws = colWidthsOf(table)
  const rows = table.rows.map((r) => ({ ...r, cells: r.cells.filter((_, i) => i !== at) }))
  return { ...table, rows, ...(ws ? { colWidths: removeColumnWidth(ws, at) } : {}) }
}

// ---- 列の幅を自分で決める（mockups/v42：パソコンは縦の線をドラッグ、スマホは丸いつまみ。5% ずつ。どの列も 10% 以上。合計は本文の幅いっぱい） ----

/** どの列もこれより狭くしない（%。本文の幅 150mm で3字ほど）。列が多くて入らないときは、同じ幅に分けた幅 */
export const MIN_COLUMN_PCT = 10
/** 幅を変える刻み（%） */
export const COLUMN_STEP_PCT = 5

const minColumnPct = (n: number) => Math.min(MIN_COLUMN_PCT, 100 / n)

/** 0.1% の刻みにそろえ、合計をちょうど 100 にする（丸めの端数は、いちばん広い列で合わせる） */
function tidyWidths(ws: number[]): number[] {
  const tenths = ws.map((w) => Math.round(w * 10))
  const diff = 1000 - tenths.reduce((a, b) => a + b, 0)
  if (diff !== 0) tenths[tenths.indexOf(Math.max(...tenths))] += diff
  return tenths.map((t) => t / 10)
}

/** どの列も下限より狭くしない（足りない分は、ほかの列から、幅に比べて少しずつもらう） */
function withMinimum(ws: number[]): number[] {
  const min = minColumnPct(ws.length)
  const out = [...ws]
  const fixed = new Set<number>()
  for (let k = 0; k < ws.length; k++) {
    const low = out.flatMap((w, i) => (!fixed.has(i) && w < min - 1e-9 ? [i] : []))
    if (low.length === 0) break
    for (const i of low) {
      fixed.add(i)
      out[i] = min
    }
    const free = out.flatMap((_, i) => (fixed.has(i) ? [] : [i]))
    const room = 100 - fixed.size * min
    const sum = free.reduce((a, i) => a + out[i], 0)
    for (const i of free) out[i] = sum > 0 ? (out[i] * room) / sum : room / free.length
  }
  return out
}

/** 同じ幅（「幅をそろえ直す」。自分で決めるのまま） */
export function equalColumnWidths(n: number): number[] {
  return tidyWidths(Array.from({ length: Math.max(1, n) }, () => 100 / Math.max(1, n)))
}

/** 幅を、列の数 n の、合計 100・どの列も下限以上の形にする（数が合わない・使えない値なら null） */
export function normalizeColumnWidths(raw: unknown, n: number): number[] | null {
  if (!Array.isArray(raw) || raw.length !== n || n < 1 || !raw.every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)) return null
  const sum = (raw as number[]).reduce((a, b) => a + b, 0)
  return tidyWidths(withMinimum((raw as number[]).map((w) => (w * 100) / sum)))
}

/** 表の、自分で決めた列の幅（列の数と合わなければ null） */
export function colWidthsOf(table: TableBlock): number[] | null {
  return normalizeColumnWidths(table.colWidths, columns(table))
}

/**
 * 列の境目（border 番目の列と、その右の列の間）を delta（%）動かす。5% の刻みに丸め、となりの2列のどちらも下限（10%）より狭くならない所で止める。
 * ほかの列の幅は変わらない
 */
export function moveColumnBorder(ws: number[], border: number, delta: number): number[] {
  if (border < 0 || border >= ws.length - 1) return ws
  const min = minColumnPct(ws.length)
  const step = Math.round(delta / COLUMN_STEP_PCT) * COLUMN_STEP_PCT
  const d = Math.max(-(ws[border] - min), Math.min(ws[border + 1] - min, step))
  const next = [...ws]
  next[border] = Math.round((ws[border] + d) * 10) / 10
  next[border + 1] = Math.round((ws[border + 1] - d) * 10) / 10
  return next
}

/** 列を足した（at 列目の右）：足した列は、at 列目の幅を半分もらう（狭くなりすぎたら、ほかの列から少しずつもらう） */
export function addColumnWidth(ws: number[], at: number): number[] {
  const i = Math.max(0, Math.min(ws.length - 1, at))
  const half = Math.round(ws[i] * 5) / 10
  return tidyWidths(withMinimum([...ws.slice(0, i), ws[i] - half, half, ...ws.slice(i + 1)]))
}

/** 列を消した（at 列目）：その幅は左どなりへ（いちばん左の列なら右どなりへ） */
export function removeColumnWidth(ws: number[], at: number): number[] {
  if (ws.length <= 1 || at < 0 || at >= ws.length) return ws
  const to = at > 0 ? at - 1 : 1
  const next = ws.map((w, i) => (i === to ? w + ws[at] : w))
  return tidyWidths(next.filter((_, i) => i !== at))
}

/** セルの画像を入れる・差し替える・外す。切り抜きはやめる（新しい画像は、まず全体を入れる） */
export function setCellImage(table: TableBlock, cellId: string, imageId: string | null): TableBlock {
  return mapCell(table, cellId, (c) => ({ id: c.id, text: c.text, imageId }))
}

/** セルの画像を切り抜く（マスいっぱい。position は見える位置）・全体に戻す（null） */
export function setCellCrop(table: TableBlock, cellId: string, position: PhotoPosition | null): TableBlock {
  return mapCell(table, cellId, (c) => (position && c.imageId ? { ...c, crop: { x: clampPercent(position.x), y: clampPercent(position.y) } } : { id: c.id, text: c.text, imageId: c.imageId }))
}

function mapCell(table: TableBlock, cellId: string, fn: (cell: TableCell) => TableCell): TableBlock {
  return { ...table, rows: table.rows.map((r) => ({ ...r, cells: r.cells.map((c) => (c.id === cellId ? fn(c) : c)) })) }
}

export function setCellText(table: TableBlock, cellId: string, text: string): TableBlock {
  return { ...table, rows: table.rows.map((r) => ({ ...r, cells: r.cells.map((c) => (c.id === cellId ? { ...c, text } : c)) })) }
}

/** 「生地見本」の列（素材表）の位置。なければ -1 */
export function swatchColumn(table: TableBlock): number {
  return table.rows[0]?.cells.findIndex((c) => c.text.trim() === SWATCH_HEADER) ?? -1
}

/**
 * 使わなかった枠の行：見出しの行のほかの行のうち、どのセルにも字も画像もない行（どこかの行を書いた表だけ。どの行も空なら、空ではない）。
 * セルフチェックは、この行の空欄を「空いている所」に数えない（ひな形で枠を用意し、素材が少なければ空欄の行のままでよい：
 * 映画・舞台衣装デザイナーコースの決まり。依頼者 2026-10-22。表の行を消すのが難しい学生が多いため）
 */
export function unusedRows(table: TableBlock): Set<TableRow> {
  const body = table.rows.slice(1)
  const blank = (r: TableRow) => r.cells.every((c) => !c.text.trim() && !c.imageId)
  return body.some((r) => !blank(r)) ? new Set(body.filter(blank)) : new Set()
}

/** 前の版の素材表（名称・使用箇所・生地見本の決まった3列）を、表にする。セルの ID は前と同じものを使う */
export function fromMaterialTable(raw: { id: string; caption?: string; rows?: { id: string; name?: string; usage?: string; swatchImageId?: string | null }[] }): TableBlock {
  const header: TableRow = { id: `${raw.id}:h`, cells: MATERIAL_HEADERS.map((text, i) => ({ id: `${raw.id}:h${i}`, text, imageId: null })) }
  const rows = (raw.rows ?? []).map((r) => ({
    id: r.id,
    cells: [
      { id: `${r.id}:name`, text: r.name ?? '', imageId: null },
      { id: `${r.id}:usage`, text: r.usage ?? '', imageId: null },
      { id: `${r.id}:swatch`, text: '', imageId: r.swatchImageId ?? null },
    ],
  }))
  return { type: 'table', id: raw.id, caption: raw.caption ?? '', widths: 'equal', heights: 'auto', rows: [header, ...rows] }
}
