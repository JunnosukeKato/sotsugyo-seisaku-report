import type { PartId } from './parts'

/**
 * 提出前チェック（パソコン）：まとめた PDF のページの絵を、パートの順に左から並べ、入りきらなければ次の段へ送る（mockups/v30 案C2 の packRows）。
 * パートが1段に収まるなら途中で切らない（次の段から始める）。収まらない長いパート（本文）は、続きを次の段へ送る（「つづき」）
 */

/** ページの枠1つ */
export interface PageSlot {
  part: PartId
  /** パートの中で何ページ目か（1から） */
  k: number
  /** まとめた PDF での通しのページ番号（ページがまだない空の枠は null） */
  no: number | null
  /** パートの最後の枠 */
  last: boolean
}

/** 1段の中の、1つのパートのページの並び */
export interface Segment {
  part: PartId
  items: PageSlot[]
  /** パートの最初の段（見出しにファイルの名前を出す。続きの段は「つづき」） */
  first: boolean
}

/**
 * パートごとの枠。pages：入っているページの数（0 なら、空の枠を placeholder 個）
 */
export function pageSlots(parts: { id: PartId; pages: number; placeholder: number }[]): PageSlot[][] {
  let no = 0
  return parts.map((p) => {
    const count = p.pages > 0 ? p.pages : p.placeholder
    return Array.from({ length: count }, (_, i) => ({ part: p.id, k: i + 1, no: p.pages > 0 ? ++no : null, last: i === count - 1 }))
  })
}

/** 幅 width の中に並べる。tw：ページの絵の幅、gap：ページの間、ggap：パートの間 */
export function packRows(parts: PageSlot[][], width: number, tw: number, gap: number, ggap: number): Segment[][] {
  const rows: Segment[][] = [[]]
  let x = 0
  for (const items of parts) {
    if (items.length === 0) continue
    const whole = items.length * tw + (items.length - 1) * gap
    let row = rows[rows.length - 1]
    if (row.length && x + ggap + whole > width && whole <= width) {
      rows.push((row = []))
      x = 0
    }
    let seg: Segment | null = null
    items.forEach((it, i) => {
      let cost = seg ? gap + tw : (row.length ? ggap : 0) + tw
      if (x + cost > width && row.length) {
        rows.push((row = []))
        x = 0
        seg = null
        cost = tw
      }
      if (!seg) {
        seg = { part: it.part, items: [], first: i === 0 }
        row.push(seg)
      }
      seg.items.push(it)
      x += cost
    })
  }
  return rows.filter((r) => r.length > 0)
}

/** 見出し（パートの名前とファイルの名前）の高さと、ページの絵の下の番号の高さ（check.css の .p-h と figure） */
const HEAD_PX = 88
/** 「Word のほうが新しい」の知らせがある段は、見出しを高くする（check.css の .c-row.noted .p-h） */
export const NOTE_PX = 42
const CAPTION_PX = 24
const ROW_GAP_PX = 12

/** 知らせ（noted のパート）の見出しがある段か */
export const isNotedRow = (row: Segment[], noted: Set<PartId>) => row.some((s) => s.first && noted.has(s.part))

/** 並べたときの高さ（px） */
export function rowsHeight(rows: Segment[][], tw: number, noted: Set<PartId> = new Set()): number {
  return rows.reduce((h, row) => h + HEAD_PX + (isNotedRow(row, noted) ? NOTE_PX : 0) + (tw * 297) / 210 + CAPTION_PX, 0) + Math.max(0, rows.length - 1) * ROW_GAP_PX
}

/**
 * 画面の高さ（available）に収まる範囲で、ページの絵をできるだけ大きくする（150〜96px）。収まらなければ、いちばん小さい大きさ（縦に動かす）
 */
export function chooseThumbWidth(parts: PageSlot[][], width: number, available: number, noted: Set<PartId> = new Set()): { tw: number; rows: Segment[][] } {
  for (let tw = 150; tw > 96; tw -= 2) {
    const rows = packRows(parts, width, tw, 8, 20)
    if (rowsHeight(rows, tw, noted) <= available) return { tw, rows }
  }
  return { tw: 96, rows: packRows(parts, width, 96, 8, 20) }
}
