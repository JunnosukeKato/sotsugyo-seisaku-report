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

// ---- マウスで選ぶ境目（句読点を字ごと選ぶ） ----

/**
 * 文の終わりの句読点・終わり括弧（「。」「、」「」」「）」など）。
 * 「。」「、」は字の箱の左下に点があり、点の上でマウスを離す（押す）と、ブラウザは字の真ん中より左なので字の前を境目にする。
 * そのため、文の終わりの「。」が、文と一緒に選べたり選べなかったりしていた（依頼者の指摘。2026-10-20）。
 * 行末にぶら下げた「。」（組版エンジンの viv-hang-end。字の幅が 0）は、どこで離しても選べなかった
 */
const CLOSING = /[、。，．､｡’”〞〟）］｝｠〉》」』】〕〗〙〛!?！？)\]]/u

/** 紙面の上の文字の境目（テキストノードと、その中の位置） */
export interface Caret {
  node: Node
  offset: number
}

/** 画面の点 (x, y) の、紙面の文字の境目（紙面の外なら null） */
export function caretAt(viewport: HTMLElement, x: number, y: number): Caret | null {
  const pos = document.caretPositionFromPoint?.(x, y)
  if (!pos || !viewport.contains(pos.offsetNode)) return null
  return { node: pos.offsetNode, offset: pos.offset }
}

/** 境目 c のすぐ後ろの文字（同じ欄（data-block-id）の中だけ。なければ null） */
function charAfter(c: Caret): { node: Text; offset: number } | null {
  if (c.node.nodeType === Node.TEXT_NODE && c.offset < (c.node as Text).length) return { node: c.node as Text, offset: c.offset }
  const block = (c.node instanceof Element ? c.node : c.node.parentElement)?.closest('[data-block-id]')
  if (!block) return null
  const point = document.createRange()
  point.setStart(c.node, c.offset)
  for (const text of textNodes(block)) {
    if (text.length > 0 && text !== c.node && point.comparePoint(text, 0) >= 0) return { node: text, offset: 0 }
  }
  return null
}

/** 文字の箱（画面座標）。行末にぶら下げた字（幅が 0）は、字の大きさの幅にする */
function glyphBox(node: Text, offset: number): { left: number; right: number; top: number; bottom: number } | null {
  const range = document.createRange()
  range.setStart(node, offset)
  range.setEnd(node, offset + 1)
  const r = [...range.getClientRects()].find((x) => x.height > 0)
  if (!r) return null
  // 字の高さ（画面の px）を、字の大きさの目安にする
  const width = r.width < r.height * 0.4 ? r.height * 0.9 : r.width
  return { left: r.left, right: r.left + width, top: r.top, bottom: r.bottom }
}

/**
 * 点 (x, y) が、境目 c のすぐ後ろの句読点・終わり括弧の上（字の箱の中。行末なら、その右の余白も）にあれば、その字の後ろの境目を返す（なければ c のまま）。
 * 選ぶ範囲の「後ろの端」（前へなぞったときは、なぞり始めた所）に使う：句読点の上で離せば（押せば）、句読点も選ぶ
 */
export function includeClosing(c: Caret, x: number, y: number): Caret {
  const next = charAfter(c)
  if (!next || !CLOSING.test(next.node.data[next.offset])) return c
  const box = glyphBox(next.node, next.offset)
  if (!box || y < box.top - 2 || y > box.bottom + 2 || x < box.left - 1) return c
  // 行末でなければ、字の右の端まで（その先は、次の字の上）
  const after = charAfter({ node: next.node, offset: next.offset + 1 })
  const afterBox = after ? glyphBox(after.node, after.offset) : null
  const sameLine = afterBox && Math.abs(afterBox.top - box.top) < (box.bottom - box.top) / 2
  if (sameLine && x > box.right + 1) return c
  return { node: next.node, offset: next.offset + 1 }
}

/** 境目 a が b より前か（同じなら false） */
export function caretBefore(a: Caret, b: Caret): boolean {
  const range = document.createRange()
  range.setStart(a.node, a.offset)
  return range.comparePoint(b.node, b.offset) > 0
}

// ---- 行末にぶら下げた句読点の、選んだ色 ----

/** 選んだ範囲に入っている、行末にぶら下げた句読点に付ける印（index.css で、選んだ色を字の後ろに塗る） */
const HANG_MARK = 'sel-hang'
let hangMarked = new Set<Element>()

/**
 * 行末にぶら下げた「。」「、」（組版エンジンの viv-hang-end）は、字の進む幅が 0 なので、選んでもブラウザが色を塗らない
 * （白い字になって、紙の上で見えなくなっていた）。選んだ範囲に入っているものに印を付け、index.css で色を塗る。
 * roots：紙面・書く欄を入れる要素。選び直すたびに呼ぶ（selectionchange）
 */
export function markHangingSelection(roots: readonly HTMLElement[]): void {
  if (roots.length === 0 && hangMarked.size === 0) return
  const sel = document.getSelection()
  const range = sel && sel.rangeCount > 0 && !sel.isCollapsed ? sel.getRangeAt(0) : null
  const next = new Set<Element>()
  if (range) {
    for (const root of roots) {
      if (!range.intersectsNode(root)) continue
      for (const el of root.querySelectorAll('viv-ts-close.viv-hang-end')) {
        const text = el.firstElementChild?.firstChild
        if (text instanceof Text && text.length > 0 && range.isPointInRange(text, 0) && range.isPointInRange(text, text.length)) next.add(el)
      }
    }
  }
  for (const el of hangMarked) if (!next.has(el)) el.classList.remove(HANG_MARK)
  for (const el of next) el.classList.add(HANG_MARK)
  hangMarked = next
}
