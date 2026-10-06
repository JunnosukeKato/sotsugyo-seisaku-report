import type { TableBlock, TableCell, TableRow } from './types'

/**
 * 表（mockups/v16 案A）。1行目は見出しの行。行と列は自由に足せ、セルには文字と画像（生地見本など）を入れられる。
 * 列の幅は「そろえる（同じ幅）」と「中身に合わせる」から選ぶ。素材表は、この表のひな形の1つ。
 */

type NewId = (prefix: string) => string

const cell = (newId: NewId, text = ''): TableCell => ({ id: newId('tc'), text, imageId: null })
const row = (newId: NewId, texts: string[]): TableRow => ({ id: newId('tr'), cells: texts.map((t) => cell(newId, t)) })

/** 空の表（見出しの行と、1行。2列） */
export function blankTable(id: string, newId: NewId, caption = ''): TableBlock {
  return { type: 'table', id, caption, widths: 'equal', rows: [row(newId, ['', '']), row(newId, ['', ''])] }
}

/** 素材表のひな形の見出し（生地見本の列には写真を入れる） */
export const MATERIAL_HEADERS = ['名称', '使用箇所', '生地見本']
export const SWATCH_HEADER = '生地見本'

/** 素材表のひな形（名称・使用箇所・生地見本） */
export function materialTable(id: string, newId: NewId, caption = '使用素材表'): TableBlock {
  return { type: 'table', id, caption, widths: 'equal', rows: [row(newId, MATERIAL_HEADERS), row(newId, ['', '', ''])] }
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

/** 列を足す（at 列目の右） */
export function addColumn(table: TableBlock, at: number, newId: NewId): TableBlock {
  return { ...table, rows: table.rows.map((r) => ({ ...r, cells: [...r.cells.slice(0, at + 1), cell(newId), ...r.cells.slice(at + 1)] })) }
}

/** 列を消す（最後の1列は残す） */
export function removeColumn(table: TableBlock, at: number): TableBlock {
  if (columns(table) <= 1) return table
  return { ...table, rows: table.rows.map((r) => ({ ...r, cells: r.cells.filter((_, i) => i !== at) })) }
}

export function setCellImage(table: TableBlock, cellId: string, imageId: string | null): TableBlock {
  return { ...table, rows: table.rows.map((r) => ({ ...r, cells: r.cells.map((c) => (c.id === cellId ? { ...c, imageId } : c)) })) }
}

export function setCellText(table: TableBlock, cellId: string, text: string): TableBlock {
  return { ...table, rows: table.rows.map((r) => ({ ...r, cells: r.cells.map((c) => (c.id === cellId ? { ...c, text } : c)) })) }
}

/** 「生地見本」の列（素材表）の位置。なければ -1 */
export function swatchColumn(table: TableBlock): number {
  return table.rows[0]?.cells.findIndex((c) => c.text.trim() === SWATCH_HEADER) ?? -1
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
  return { type: 'table', id: raw.id, caption: raw.caption ?? '', widths: 'equal', rows: [header, ...rows] }
}
