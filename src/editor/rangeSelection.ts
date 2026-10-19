import type { ModelPoint } from './rangeOps'

/**
 * 紙面（組版した表示枠）の上の点と、原稿の位置（欄の ID と文字の位置）を対応づける（段落をまたいで選ぶ。範囲の決まりは rangeOps.ts）。
 * 紙面の文字は原稿の文字と1文字ずつ対応している（組版エンジンが句読点などを包む要素・すき間の要素は、文字を持たない）ので、
 * 欄の要素（data-block-id）の中のテキストノードを順に数えれば、文字の位置になる。段落がページをまたぐと、同じ ID の要素が複数ある。
 * 見えていないページ（1ページずつ表示しているときの、ほかのページ）の中の点でもよい（要素の順で数える）
 */

/** 欄・図・表の要素（紙面の上から順） */
const ITEMS = '[data-block-id], figure[data-figure-id], .data-table[data-table-id]'

/** 欄 id の、紙面の要素（ページをまたぐと複数） */
function fragments(viewport: HTMLElement, id: string): HTMLElement[] {
  return [...viewport.querySelectorAll<HTMLElement>(`[data-block-id="${CSS.escape(id)}"]`)]
}

function textNodes(el: Node): Text[] {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  return nodes
}

/** 欄 id の中で、点 (node, offset) より前にある文字の数 */
function charsBefore(viewport: HTMLElement, id: string, node: Node, offset: number): number {
  const point = document.createRange()
  point.setStart(node, offset)
  let count = 0
  for (const text of fragments(viewport, id).flatMap(textNodes)) {
    if (text === node) return count + Math.min(offset, text.length)
    if (point.comparePoint(text, text.length) <= 0) count += text.length
    else if (point.comparePoint(text, 0) >= 0) break
    else return count
  }
  return count
}

/** 紙面の要素の、原稿の位置（end：その要素の終わり） */
function pointOfElement(viewport: HTMLElement, el: HTMLElement, end: boolean): ModelPoint | null {
  if (el.matches('figure[data-figure-id]')) return { id: el.dataset.figureId!, offset: 0, whole: true }
  if (el.matches('.data-table[data-table-id]')) return { id: el.dataset.tableId!, offset: 0, whole: true }
  const id = el.dataset.blockId
  if (!id) return null
  if (!end) return { id, offset: el.classList.contains('page-break') ? 0 : charsBefore(viewport, id, el, 0), whole: el.classList.contains('page-break') }
  return { id, offset: charsBefore(viewport, id, el, el.childNodes.length), whole: el.classList.contains('page-break') }
}

/**
 * 紙面（viewport）の中の点 (node, offset) の、原稿の位置。紙面の外なら null。
 * - 欄（段落・見出し・図表のタイトル・表紙の項目など）の文字の中：その欄と文字の位置
 * - 図の写真・番号、表の中（セルも）：図・表（まるごと。whole）
 * - 見出しの番号（Ⅰ．など）：その見出しの始め
 * - 欄と欄の間・ページの余白など：side が start なら、後ろの欄の始め、end なら、前の欄の終わり
 */
export function paperPoint(viewport: HTMLElement, node: Node, offset: number, side: 'start' | 'end'): ModelPoint | null {
  const el = node instanceof Element ? node : node.parentElement
  if (!el || !viewport.contains(el)) return null
  const block = el.closest<HTMLElement>('[data-block-id]')
  const table = el.closest<HTMLElement>('.data-table[data-table-id]')
  // 表の中（セル・タイトル以外）：表まるごと。表のタイトルは、文字の位置
  if (table && !(block && block.closest('.table-caption'))) return { id: table.dataset.tableId!, offset: 0, whole: true }
  if (block && viewport.contains(block)) {
    const id = block.dataset.blockId!
    if (block.classList.contains('page-break')) return { id, offset: 0, whole: true }
    return { id, offset: charsBefore(viewport, id, node, offset) }
  }
  const figure = el.closest<HTMLElement>('figure[data-figure-id]')
  if (figure) return { id: figure.dataset.figureId!, offset: 0, whole: true }
  const heading = el.closest('h1, h2')?.querySelector<HTMLElement>('[data-block-id]')
  if (heading) return { id: heading.dataset.blockId!, offset: 0 }
  // 欄と欄の間：近い欄へ寄せる
  const point = document.createRange()
  point.setStart(node, offset)
  const items = [...viewport.querySelectorAll<HTMLElement>(ITEMS)].filter((x) => !x.parentElement?.closest(ITEMS))
  if (side === 'start') {
    const next = items.find((x) => point.comparePoint(x, 0) >= 0)
    return next ? pointOfElement(viewport, next, false) : null
  }
  const prev = items.filter((x) => point.comparePoint(x, x.childNodes.length) <= 0).at(-1)
  return prev ? pointOfElement(viewport, prev, true) : null
}

/** 原稿の位置（欄 id の offset 文字目）の、紙面の上の点（その欄が紙面になければ null） */
export function domPoint(viewport: HTMLElement, id: string, offset: number): { node: Node; offset: number } | null {
  const frs = fragments(viewport, id)
  if (frs.length === 0) return null
  let acc = 0
  let last: Text | null = null
  for (const text of frs.flatMap(textNodes)) {
    if (offset <= acc + text.length) return { node: text, offset: Math.max(0, offset - acc) }
    acc += text.length
    last = text
  }
  return last ? { node: last, offset: last.length } : { node: frs[0], offset: 0 }
}
