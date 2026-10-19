/**
 * 書く欄（と、書き終えた欄の仮の表示・段落を分けた前の段落の仮の表示）の文字の組み方を、紙面と同じにする。
 *
 * 紙面の組版エンジン（Vivliostyle）は、句読点・括弧の詰め（text-spacing-trim）、漢字・かなと英数字の間のすき間（text-autospace）、
 * 句読点のぶら下げ（hanging-punctuation）を、ブラウザの機能ではなく自前で行う（文字を viv-ts-open・viv-ts-close・viv-ts-thin-sp の
 * 要素で包み、組んだ行の位置を見て、詰めるかどうかの印（class）を付ける。見た目は、組版エンジンがページに入れる CSS）。
 * 書く欄はブラウザの機能で組んでいたため、詰め方とすき間が少し違い、同じ段落でも行の折り返しが紙面と違っていた（依頼者の指摘。2026-10-19）。
 * ここでは、組版エンジンと同じ手順で、書く欄の文字を包んで印を付ける（同じ幅・同じ書体なら、紙面と同じ行で折り返す）。
 *
 * 手順は Vivliostyle 2.45 の src/vivliostyle/text-polyfill.ts（AGPL-3.0。このツールと同じ使用許諾）の processGeneratedContent・
 * processTextSpacing を、紙面で使う設定（横組み・日本語・text-spacing-trim: normal・text-autospace: normal・hanging-punctuation: allow-end。
 * layout/reportCss.ts）に絞って写したもの。組版エンジンを新しくしたときは、紙面と行が合うかを確かめ直す（scripts/e2e/smoke.mjs の「書く欄の折り返し」）。
 */

/** 組版エンジンが文字を包む要素の名前（見た目の CSS は、組版エンジンがページに入れる） */
const OPEN = 'viv-ts-open'
const CLOSE = 'viv-ts-close'
const INNER = 'viv-ts-inner'
const THIN = 'viv-ts-thin-sp'

/** 句読点・括弧の前後と、漢字・かなと英数字の境目で、文字を分ける（組版エンジンの preprocessForTextSpacing と同じ） */
const SPLIT =
  /(?![()[\]{}])[\p{Ps}\p{Pe}\p{Pf}\p{Pi}、。，．：；､｡　〰]\p{M}*(?=\P{M})|.(?=(?![()[\]{}])[\p{Ps}\p{Pe}\p{Pf}\p{Pi}、。，．：；､｡　〰])|(?!\p{P})[\p{sc=Han}ぁ-ヿ㇀-ㇿ]\p{M}*(?=(?![\p{sc=Han}ぁ-ヿ㇀-ㇿ！-｠])[\p{L}\p{Nd}])|(?![\p{sc=Han}ぁ-ヿ㇀-ㇿ！-｠])[\p{L}\p{Nd}]\p{M}*(?=(?!\p{P})[\p{sc=Han}ぁ-ヿ㇀-ㇿ])/gsu

/** 文字列を、組版エンジンと同じ所で分ける（分けた文字列を順に） */
export function splitForSpacing(text: string): string[] {
  return text.replace(SPLIT, '$&\x00').split('\x00')
}

const HANG_END = /^[、。，．､｡]\p{M}*$/u
const OPEN_PUNCT = /^[‘“〝（［｛｟〈〈《「『【〔〖〘〚]\p{M}*$/u
const CLOSE_PUNCT = /^[’”〞〟）］｝｠〉〉》」』】〕〗〙〛]\p{M}*$/u
const IDEOGRAPH_START = /^(?!\p{P})[\p{sc=Han}ぁ-ヿ㇀-ㇿ]/u
const IDEOGRAPH_END = /(?!\p{P})[\p{sc=Han}ぁ-ヿ㇀-ㇿ]\p{M}*$/u
const ALPHA_END = /(?![\p{sc=Han}ぁ-ヿ㇀-ㇿ！-｠])\p{L}\p{M}*$/u
const NUMERIC_END = /(?![！-｠])\p{Nd}\p{M}*$/u
const ALPHA_START = /^(?![\p{sc=Han}ぁ-ヿ㇀-ㇿ！-｠])\p{L}/u
const NUMERIC_START = /^(?![！-｠])\p{Nd}/u

export interface TypesetOptions {
  /**
   * 包んだ句読点・括弧を、書く欄の中で1文字のまとまりにする（contenteditable="false"）。
   * カーソルが包んだ要素の中に入って、日本語の変換中の文字が、詰めた字間（-0.5em など）で重なって見えないように
   */
  atomic?: boolean
  /**
   * from の文字の位置より前は、測らずに known のとおりに包む（続けて書いたとき、書いた行の1つ前の行から後ろだけを測り直す。
   * 前の行は、後ろを書き換えても変わらないため。1文字打つたびに段落全体を測り直すと、長い段落では打つのが遅くなった）。
   * from が Infinity なら、すべて known のとおり（測らない。あとで測り直す）
   */
  from?: number
  /** until の文字の位置から後ろも、測らずに known のとおりに包む（測り直す所を、書いている所の近くだけにする） */
  until?: number
  known?: SpacingPlan | null
}

/**
 * 包み方の記録（文字の位置ごと）。wraps：包んだ句読点の位置 → 要素の名前と印、thins：すき間の要素を入れた位置（その位置の文字の前）
 */
export interface SpacingPlan {
  wraps: Map<number, { tag: string; cls: string }>
  thins: Set<number>
}

/**
 * 文字列の start〜oldEnd を、長さ delta だけ違う文字に書き換えたあとの包み方の記録（書き換えた所は消し、後ろはずらす）
 */
export function shiftPlan(plan: SpacingPlan, start: number, oldEnd: number, delta: number): SpacingPlan {
  const wraps = new Map<number, { tag: string; cls: string }>()
  for (const [at, w] of plan.wraps) {
    if (at < start) wraps.set(at, w)
    else if (at >= oldEnd) wraps.set(at + delta, w)
  }
  const thins = new Set<number>()
  for (const at of plan.thins) {
    if (at < start) thins.add(at)
    else if (at > oldEnd) thins.add(at + delta)
  }
  return { wraps, thins }
}

/** 要素の中の、包んだ句読点とすき間の要素の記録（紙面から写した中身から、包み方を読み取る） */
export function planFromDom(block: HTMLElement): SpacingPlan {
  const plan: SpacingPlan = { wraps: new Map(), thins: new Set() }
  let at = 0
  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        at += (child as Text).length
        continue
      }
      if (!(child instanceof Element)) continue
      if (child.localName === OPEN || child.localName === CLOSE) plan.wraps.set(at, { tag: child.localName, cls: child.className })
      else if (child.localName === THIN) plan.thins.add(at)
      walk(child)
    }
  }
  walk(block)
  return plan
}

/** 要素の中のテキストノード（文書の順に） */
function textNodesIn(block: HTMLElement): Text[] {
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  return nodes
}

/** 文字が、どの要素で包まれるか（句読点・括弧でなければ undefined。hangingEnd：行末にぶら下げられる句読点） */
function tagFor(text: string): { tag: typeof OPEN | typeof CLOSE; hangingEnd: boolean } | undefined {
  if (HANG_END.test(text)) return { tag: CLOSE, hangingEnd: true }
  if (OPEN_PUNCT.test(text)) return { tag: OPEN, hangingEnd: false }
  if (CLOSE_PUNCT.test(text)) return { tag: CLOSE, hangingEnd: false }
  return undefined
}

/** 2つの文字の間に、すき間（漢字・かなと英数字の間）を入れるか */
function autospaceBetween(prev: string, next: string): boolean {
  return (IDEOGRAPH_START.test(next) && (ALPHA_END.test(prev) || NUMERIC_END.test(prev))) || (IDEOGRAPH_END.test(prev) && (ALPHA_START.test(next) || NUMERIC_START.test(next)))
}

/** 文字を包む（outer > inner > 文字） */
function wrap(textNode: Text, tag: string, options: TypesetOptions): HTMLElement {
  const doc = textNode.ownerDocument
  const outerElem = doc.createElement(tag)
  const innerElem = doc.createElement(INNER)
  outerElem.appendChild(innerElem)
  if (options.atomic) outerElem.contentEditable = 'false'
  textNode.before(outerElem)
  innerElem.appendChild(textNode)
  return outerElem
}

/**
 * block（段落1つ分。書く欄・仮の表示）の文字を、紙面と同じように包み、詰めの印とすき間を付ける。包み方の記録を返す。
 * block は画面に置いてあり、紙面と同じ幅・書体になっていること（行の位置を測って印を決めるため）。
 * 前に包んだ要素があれば、いったん文字に戻してから、やり直す
 */
export function typesetSpacing(block: HTMLElement, options: TypesetOptions = {}): SpacingPlan {
  unwrapSpacing(block)
  const doc = block.ownerDocument
  // 文字を、組版エンジンと同じ所で分ける
  for (const node of textNodesIn(block)) {
    const parts = splitForSpacing(node.data)
    if (parts.length < 2) continue
    for (const part of parts.slice(0, -1)) node.before(doc.createTextNode(part))
    node.data = parts[parts.length - 1]
  }
  const nodes = textNodesIn(block).filter((n) => n.data.length > 0)
  const offsets: number[] = []
  nodes.reduce((at, n) => (offsets.push(at), at + n.length), 0)
  const from = options.known ? (options.from ?? 0) : 0
  const until = options.known ? (options.until ?? Infinity) : Infinity
  const plan: SpacingPlan = { wraps: new Map(), thins: new Set() }
  // 紙面では、文字を組んでから（行に並べてから）包む。同じように、先に組んでおく
  if (from < Infinity) void block.offsetHeight
  let wrapped = false
  const measured = (at: number) => !options.known || (at >= from && at < until)
  nodes.forEach((node, i) => {
    const prev = nodes[i - 1] ?? null
    const next = nodes[i + 1] ?? null
    const at = offsets[i]
    if (!measured(at)) {
      if (applyKnown(node, prev, at, options.known!, options, plan)) wrapped = true
      return
    }
    // 測らずに包んだ前の文字の、後ろのすき間（漢字・かなの後ろに英数字）は、前の文字を測ったときに入るものなので、ここで入れる
    if (prev && i > 0 && !measured(offsets[i - 1]) && IDEOGRAPH_END.test(prev.data) && (ALPHA_START.test(node.data) || NUMERIC_START.test(node.data)) && !nonZeroMarginBorderPadding(prev, node)) {
      node.before(thinSpace(node.ownerDocument, options))
      plan.thins.add(at)
      wrapped = true
    }
    if (processTextSpacing(node, prev, next, options, at, plan)) wrapped = true
  })
  // 包んだ要素を入れたあとは、ブラウザが前の文字の形の計算を使い回して、はじめから組んだときと違う所で折り返すことがあるため、組み直させる
  // （組版エンジンの reshapeBlockContainer と同じ。測らずに包んだだけのとき（あとで測り直す）は、しない）
  if (wrapped && from < Infinity) {
    const saved = block.style.fontKerning
    block.style.fontKerning = getComputedStyle(block).fontKerning === 'none' ? 'normal' : 'none'
    void block.offsetHeight
    block.style.fontKerning = saved
  }
  return plan
}

/** 測らずに、記録のとおりに包む（記録が、いまの文字と合わないときは包まない）。包んだら true */
function applyKnown(textNode: Text, prevNode: Text | null, at: number, known: SpacingPlan, options: TypesetOptions, plan: SpacingPlan): boolean {
  let changed = false
  const w = known.wraps.get(at)
  if (w && tagFor(textNode.data)?.tag === w.tag && textNode.parentElement?.localName !== INNER) {
    wrap(textNode, w.tag, options).className = w.cls
    plan.wraps.set(at, w)
    changed = true
  }
  if (known.thins.has(at) && prevNode && autospaceBetween(prevNode.data, textNode.data)) {
    const before = (textNode.parentElement?.localName === INNER ? textNode.parentElement.parentElement : textNode)?.previousSibling
    if (!(before instanceof Element && before.localName === THIN)) {
      ;(textNode.parentElement?.localName === INNER ? textNode.parentElement.parentElement! : textNode).before(thinSpace(textNode.ownerDocument, options))
    }
    plan.thins.add(at)
    changed = true
  }
  return changed
}

/** 包んだ要素を外して、文字だけに戻す（すき間の要素は消す。隣り合ったテキストノードはつなぐ） */
export function unwrapSpacing(block: HTMLElement): void {
  const wrappers = block.querySelectorAll(`${OPEN}, ${CLOSE}, ${THIN}`)
  if (wrappers.length === 0) return
  for (const el of wrappers) {
    if (el.localName === THIN) el.remove()
    else el.replaceWith(...[...el.childNodes].flatMap((c) => (c.nodeType === Node.ELEMENT_NODE && (c as Element).localName === INNER ? [...c.childNodes] : [c])))
  }
  block.normalize()
}

/** ノードの画面上の四角（最初・最後）。組版エンジンの RangeClientRects.getClientRectsOfNode と同じ測り方 */
function rectsOf(node: Node): DOMRectList {
  const range = node.ownerDocument!.createRange()
  range.selectNode(node)
  return range.getClientRects()
}

/** 文字 textNode に、組版エンジンと同じ処理をする（包んだら true） */
function processTextSpacing(textNode: Text, prevNode: Text | null, nextNode: Text | null, options: TypesetOptions, at: number, plan: SpacingPlan): boolean {
  const text = textNode.data
  const doc = textNode.ownerDocument
  // 段落の最初・最後の文字か（段落の中に改行はない。セルなど改行のある欄には使わない）
  const isFirstInBlock = !prevNode
  const isLastInBlock = !nextNode

  const isAtStartOfLine = (): boolean => {
    if (isFirstInBlock) return true
    const rect = rectsOf(textNode)[0]
    if (!rect || !prevNode) return false
    const prevRects = rectsOf(prevNode)
    const prevRect = prevRects[prevRects.length - 1]
    if (!prevRect) return false
    return rect.left < prevRect.left + prevRect.width - rect.height || rect.top > prevRect.top + prevRect.height - rect.height / 10 || rect.top + rect.height < prevRect.top + rect.height / 10
  }
  const isAtEndOfLine = (): boolean => {
    if (!nextNode) return false
    const rect = rectsOf(textNode)[0]
    if (!rect) return false
    const nextRect = rectsOf(nextNode)[0]
    if (!nextRect) return false
    return rect.left + rect.width > nextRect.left + rect.height || rect.top + rect.height < nextRect.top + rect.height / 10 || rect.top > nextRect.top + nextRect.height - rect.height / 10
  }

  // 句読点（行末にぶら下げられる：hanging-punctuation: allow-end）・始め括弧・終わり括弧
  const found = tagFor(text)
  const tagName = found?.tag
  const hangingEnd = !!found?.hangingEnd

  let wrapped = false
  if (tagName !== undefined && textNode.parentElement?.localName !== INNER) {
    wrapped = true
    const outerElem = wrap(textNode, tagName, options)
    const innerElem = outerElem.firstElementChild as HTMLElement

    // ほぼ全角の幅の句読点か
    const checkFullWidth = (elem: HTMLElement): boolean => elem.offsetWidth > parseFloat(getComputedStyle(elem).fontSize) * 0.7
    const isFullWidth = checkFullWidth(innerElem)
    const linePosition = () => outerElem.offsetTop

    if (isFullWidth || hangingEnd) {
      if (tagName === OPEN) {
        if (isFirstInBlock) {
          outerElem.className = 'viv-ts-space'
        } else if (isAtStartOfLine()) {
          // text-spacing-trim: normal は行頭の始め括弧を詰めない（space-start）
          outerElem.className = 'viv-ts-space'
        } else if (
          prevNode &&
          /[\p{Ps}\p{Pi}\p{Pe}\p{Pf}·‧・　：；、。，．]\p{M}*$/u.test(prevNode.data) &&
          (!/[\p{Pe}\p{Pf}]\p{M}*$/u.test(prevNode.data) || (prevNode.parentElement?.localName === INNER && checkFullWidth(prevNode.parentElement)))
        ) {
          // 句読点・括弧が続くときは、詰める（trim-adjacent）
          outerElem.className = 'viv-ts-trim'
        }
      } else if (isLastInBlock) {
        const linePos = linePosition()
        if (hangingEnd) {
          outerElem.className = isFullWidth ? 'viv-ts-auto' : 'viv-hang-end viv-hang-hw'
          if (linePos === linePosition()) {
            outerElem.className = 'viv-hang-end'
            if (linePos === linePosition()) outerElem.className = ''
          }
        } else {
          outerElem.className = 'viv-ts-auto'
          if (linePos === linePosition()) outerElem.className = ''
        }
      } else if (nextNode && /^[\p{Pe}\p{Pf}·‧・　：；、。，．]/u.test(nextNode.data)) {
        if (isFullWidth) outerElem.className = 'viv-ts-trim'
      } else if (hangingEnd) {
        const atEnd = isAtEndOfLine()
        // allow-end：行末に収まるなら、ぶら下げない
        const atEndNoHang = atEnd
        if (!atEndNoHang) outerElem.className = isFullWidth ? 'viv-hang-end' : 'viv-hang-end viv-hang-hw'
        if (!isFullWidth) {
          if (!atEnd && !isAtEndOfLine()) outerElem.className = ''
        } else if (!atEndNoHang && !isAtEndOfLine()) {
          outerElem.className = ''
        } else if (!atEnd) {
          outerElem.className = 'viv-ts-space'
          if (!isAtEndOfLine()) {
            outerElem.className = 'viv-ts-auto'
            if (!isAtEndOfLine()) outerElem.className = 'viv-hang-end'
          }
        }
      } else if (isAtEndOfLine()) {
        // 行末の終わり括弧は、詰めずに収まれば、そのまま（allow-end）
        outerElem.className = 'viv-ts-space'
      } else {
        const linePos = linePosition()
        outerElem.className = 'viv-ts-auto'
        if (linePos === linePosition()) outerElem.className = ''
      }
    }
    plan.wraps.set(at, { tag: tagName, cls: outerElem.className })
  }

  // 漢字・かなと英数字の間のすき間（text-autospace: normal）
  if (prevNode && IDEOGRAPH_START.test(text) && (ALPHA_END.test(prevNode.data) || NUMERIC_END.test(prevNode.data)) && !nonZeroMarginBorderPadding(prevNode, textNode)) {
    textNode.before(thinSpace(doc, options))
    plan.thins.add(at)
    wrapped = true
  }
  if (nextNode && IDEOGRAPH_END.test(text) && (ALPHA_START.test(nextNode.data) || NUMERIC_START.test(nextNode.data)) && !nonZeroMarginBorderPadding(textNode, nextNode)) {
    textNode.after(thinSpace(doc, options))
    plan.thins.add(at + text.length)
    wrapped = true
  }
  return wrapped
}

function thinSpace(doc: Document, options: TypesetOptions): HTMLElement {
  const el = doc.createElement(THIN)
  if (options.atomic) el.contentEditable = 'false'
  return el
}

/** node1 と node2 の間に、余白・枠・内側の余白のある要素の境目があるか（組版エンジンの checkNonZeroMarginBorderPadding と同じ） */
function nonZeroMarginBorderPadding(node1: Node, node2: Node): boolean {
  if (node1.nodeType === Node.ELEMENT_NODE) {
    const style = getComputedStyle(node1 as Element)
    if (parseFloat(style.marginInlineEnd) || parseFloat(style.borderInlineEndWidth) || parseFloat(style.paddingInlineEnd)) return true
  }
  const parent1 = node1.parentElement
  if (parent1 && !parent1.contains(node2)) return nonZeroMarginBorderPadding(parent1, node2)
  if (node2.nodeType === Node.ELEMENT_NODE) {
    const style = getComputedStyle(node2 as Element)
    if (parseFloat(style.marginInlineStart) || parseFloat(style.borderInlineStartWidth) || parseFloat(style.paddingInlineStart)) return true
  }
  const parent2 = node2.parentElement
  if (parent2 && !parent2.contains(node1)) return nonZeroMarginBorderPadding(node1, parent2)
  return false
}
