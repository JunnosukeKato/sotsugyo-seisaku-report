import type { Crop } from './wordImages'

/**
 * Word の本文（word/document.xml）を、段落と表の並びにする。見た目（文字の大きさ・位置・太字など）は読まない。
 *
 * - 段落の文字は w:t。w:tab はタブ（\t）、手で入れた改行 w:br は \n にする（改ページは読まない）
 * - 図形の中の文字の枠（w:txbxContent。図のタイトルなど）は、段落の文字とは分けて読む
 * - 新旧2通りの書き方が入った図形（mc:AlternateContent）は、同じ中身が2回出るので、片方（Choice。なければ Fallback）だけ読む
 * - 削除した変更履歴（w:del）・隠し文字・ふりがな（ルビ）は読まない
 * - 見出しのスタイル（見出し 1・2）と、自動の段落番号（w:numPr）も読む
 *
 * Word の新しい保存形式（Strict）でも読めるよう、要素は名前空間の URI の末尾で見分ける。
 */

export interface ImageRef {
  /** 画像の関係の ID（a:blip の r:embed、VML の r:id） */
  rid: string | null
  /** Word の中に入っていない（リンクした）画像 */
  linked: boolean
  /** 画像でない図（グラフ・SmartArt） */
  kind: 'image' | 'chart' | 'smartart'
  /** 浮かせた図の横の中心（EMU）と、その基準。行内の図は null */
  centerX: number | null
  xFrom: string | null
  crop: Crop | null
}

/** 文字の枠（テキストボックス・図形の中の文字） */
export interface TextBox {
  /** 枠の中の段落ごとの文字 */
  lines: string[]
  images: ImageRef[]
  centerX: number | null
  xFrom: string | null
}

export interface WordParagraph {
  type: 'paragraph'
  /** 段落の文字（手で入れた改行は \n、タブは \t） */
  text: string
  images: ImageRef[]
  boxes: TextBox[]
  /** 見出しのスタイル・自動の段落番号で決まる見出しの段（1＝大見出し、2＝小見出し） */
  headingLevel: 1 | 2 | null
  /** 自動の段落番号がローマ数字（大文字 1・小文字 2）のとき */
  romanLevel: 1 | 2 | null
  /** 自動の段落番号（箇条書き）の、画面に出る番号（例「1.」「・」）。見出しのときは空 */
  listPrefix: string
  /** 脚注・文末脚注の数 */
  notes: number
}

export interface WordCell {
  blocks: WordBlock[]
  /** セルの段落の文字（段落ごとに \n でつなぐ） */
  text: string
  images: ImageRef[]
  /** 横につなげたセルの数（w:gridSpan） */
  span: number
  /** 上のセルとつなげた（縦の結合の続き） */
  mergedUp: boolean
}

export interface WordTable {
  type: 'table'
  rows: WordCell[][]
}

export type WordBlock = WordParagraph | WordTable

// ---- XML の小さな道具 ----

const NS = {
  w: /wordprocessingml\/(2006\/)?main$/,
  a: /drawingml\/(2006\/)?main$/,
  wp: /wordprocessingDrawing$/,
  mc: /markup-compatibility\/2006$/,
  v: /^urn:schemas-microsoft-com:vml$/,
  m: /officeDocument\/2006\/math$|ooxml\/officeDocument\/math$/,
}

type NsKey = keyof typeof NS

export function is(el: Element, ns: NsKey, name?: string): boolean {
  return (name === undefined || el.localName === name) && NS[ns].test(el.namespaceURI ?? '')
}

/** 子の要素 */
export function elements(node: Node): Element[] {
  const result: Element[] = []
  for (let n = node.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) result.push(n as Element)
  return result
}

export function child(el: Element | null | undefined, ns: NsKey, name: string): Element | undefined {
  return el ? elements(el).find((c) => is(c, ns, name)) : undefined
}

/** 属性（名前空間は見ず、名前の後ろの部分で探す） */
export function attr(el: Element | null | undefined, local: string): string | null {
  if (!el) return null
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i]
    if ((a.localName ?? a.name.replace(/^.*:/, '')) === local) return a.value
  }
  return null
}

/** w:val の値（「オン・オフ」の属性は、値がなければオン） */
const isOn = (el: Element | undefined) => !!el && !['0', 'false', 'off'].includes(attr(el, 'val') ?? '')

// ---- スタイルと段落番号 ----

interface StyleInfo {
  name: string
  basedOn: string | null
  outlineLevel: number | null
  numId: string | null
  ilvl: number | null
}

interface NumLevel {
  format: string
  text: string
  start: number
}

export interface DocumentContext {
  styles: Map<string, StyleInfo>
  /** numId → 段ごとの番号の形 */
  numbering: Map<string, { abstractId: string; levels: Map<number, NumLevel> }>
  /** 箇条書きの番号を数える（numId → 段ごとの今の番号） */
  counters: Map<string, number[]>
}

export function documentContext(styles: Document | null, numbering: Document | null): DocumentContext {
  const styleMap = new Map<string, StyleInfo>()
  if (styles) {
    for (const s of elements(styles.documentElement).filter((e) => is(e, 'w', 'style'))) {
      const id = attr(s, 'styleId')
      if (!id) continue
      const pPr = child(s, 'w', 'pPr')
      const outline = attr(child(pPr, 'w', 'outlineLvl'), 'val')
      const numPr = child(pPr, 'w', 'numPr')
      styleMap.set(id, {
        name: attr(child(s, 'w', 'name'), 'val') ?? '',
        basedOn: attr(child(s, 'w', 'basedOn'), 'val'),
        outlineLevel: outline === null ? null : Number(outline),
        numId: attr(child(numPr, 'w', 'numId'), 'val'),
        ilvl: numPr ? Number(attr(child(numPr, 'w', 'ilvl'), 'val') ?? 0) : null,
      })
    }
  }
  const numMap: DocumentContext['numbering'] = new Map()
  if (numbering) {
    const abstracts = new Map<string, Map<number, NumLevel>>()
    for (const a of elements(numbering.documentElement).filter((e) => is(e, 'w', 'abstractNum'))) {
      const levels = new Map<number, NumLevel>()
      for (const lvl of elements(a).filter((e) => is(e, 'w', 'lvl'))) {
        levels.set(Number(attr(lvl, 'ilvl') ?? 0), {
          format: attr(child(lvl, 'w', 'numFmt'), 'val') ?? 'decimal',
          text: attr(child(lvl, 'w', 'lvlText'), 'val') ?? '',
          start: Number(attr(child(lvl, 'w', 'start'), 'val') ?? 1),
        })
      }
      abstracts.set(attr(a, 'abstractNumId') ?? '', levels)
    }
    for (const n of elements(numbering.documentElement).filter((e) => is(e, 'w', 'num'))) {
      const abstractId = attr(child(n, 'w', 'abstractNumId'), 'val') ?? ''
      const levels = new Map(abstracts.get(abstractId) ?? [])
      for (const o of elements(n).filter((e) => is(e, 'w', 'lvlOverride'))) {
        const ilvl = Number(attr(o, 'ilvl') ?? 0)
        const start = attr(child(o, 'w', 'startOverride'), 'val')
        const lvl = child(o, 'w', 'lvl')
        const base = levels.get(ilvl) ?? { format: 'decimal', text: '', start: 1 }
        levels.set(ilvl, {
          format: attr(child(lvl, 'w', 'numFmt'), 'val') ?? base.format,
          text: attr(child(lvl, 'w', 'lvlText'), 'val') ?? base.text,
          start: start !== null ? Number(start) : base.start,
        })
      }
      numMap.set(attr(n, 'numId') ?? '', { abstractId, levels })
    }
  }
  return { styles: styleMap, numbering: numMap, counters: new Map() }
}

/** スタイルの名前・見出しの段から、見出しの段（1・2。3以下も小見出し）を求める */
function styleHeadingLevel(ctx: DocumentContext, styleId: string | null): number | null {
  let id = styleId
  for (let depth = 0; id && depth < 8; depth++) {
    const s = ctx.styles.get(id)
    const m = /^(?:heading|見出し)\s*(\d)$/i.exec(s?.name ?? '') ?? /^(?:heading|見出し)\s*(\d)$/i.exec(id)
    if (m) return Number(m[1])
    if (!s) return null
    if (s.outlineLevel !== null && s.outlineLevel < 9) return s.outlineLevel + 1
    id = s.basedOn
  }
  return null
}

/** スタイルに付いた段落番号 */
function styleNumPr(ctx: DocumentContext, styleId: string | null): { numId: string; ilvl: number } | null {
  let id = styleId
  for (let depth = 0; id && depth < 8; depth++) {
    const s = ctx.styles.get(id)
    if (!s) return null
    if (s.numId !== null) return { numId: s.numId, ilvl: s.ilvl ?? 0 }
    id = s.basedOn
  }
  return null
}

const KANJI_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
const AIUEO = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン'
const IROHA = 'イロハニホヘトチリヌルヲワカヨタレソツネナラムウヰノオクヤマケフコエテアサキユメミシヱヒモセスン'

export function toRoman(n: number): string {
  const table: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  let result = ''
  for (const [value, letters] of table) while (n >= value) {
    result += letters
    n -= value
  }
  return result
}

/** 段落番号の1つを、画面に出る形にする */
function formatNumber(n: number, format: string): string {
  switch (format) {
    case 'decimalZero':
      return String(n).padStart(2, '0')
    case 'upperRoman':
      return toRoman(n)
    case 'lowerRoman':
      return toRoman(n).toLowerCase()
    case 'upperLetter':
      return String.fromCharCode(64 + (((n - 1) % 26) + 1))
    case 'lowerLetter':
      return String.fromCharCode(96 + (((n - 1) % 26) + 1))
    case 'decimalEnclosedCircle':
    case 'decimalEnclosedCircleChinese':
      return n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : String(n)
    case 'aiueo':
    case 'aiueoFullWidth':
      return AIUEO[n - 1] ?? String(n)
    case 'iroha':
    case 'irohaFullWidth':
      return IROHA[n - 1] ?? String(n)
    case 'ideographDigital':
    case 'japaneseCounting':
    case 'chineseCounting':
    case 'chineseCountingThousand':
    case 'ideographTraditional':
      return KANJI_DIGITS[n] ?? String(n)
    default:
      return String(n)
  }
}

/** 段落番号を数え、画面に出る番号（例「1.」）を作る */
function listLabel(ctx: DocumentContext, numId: string, ilvl: number): { label: string; format: string } | null {
  const num = ctx.numbering.get(numId)
  const level = num?.levels.get(ilvl)
  if (!num || !level) return null
  const counters = ctx.counters.get(numId) ?? []
  for (let i = 0; i < ilvl; i++) if (counters[i] === undefined) counters[i] = num.levels.get(i)?.start ?? 1
  counters[ilvl] = counters[ilvl] === undefined ? level.start : counters[ilvl] + 1
  counters.length = ilvl + 1
  ctx.counters.set(numId, counters)
  if (level.format === 'none') return { label: '', format: level.format }
  if (level.format === 'bullet') return { label: '・', format: level.format }
  const label = level.text.replace(/%(\d)/g, (_, d: string) => {
    const i = Number(d) - 1
    return formatNumber(counters[i] ?? 1, num.levels.get(i)?.format ?? 'decimal')
  })
  return { label, format: level.format }
}

// ---- 段落 ----

interface Collector {
  text: string
  images: ImageRef[]
  boxes: TextBox[]
  notes: number
}

const emptyCollector = (): Collector => ({ text: '', images: [], boxes: [], notes: 0 })

function merge(into: Collector, from: Collector) {
  into.text += from.text
  into.images.push(...from.images)
  into.boxes.push(...from.boxes)
  into.notes += from.notes
}

const isEmpty = (c: Collector) => !c.text && c.images.length === 0 && c.boxes.length === 0

/** 同じ中身が2通りの書き方で入った図形：Choice を読み、何もなければ Fallback を読む */
function alternate(el: Element, read: (branch: Element, out: Collector) => void, out: Collector) {
  const choice = elements(el).find((e) => is(e, 'mc', 'Choice'))
  const fallback = elements(el).find((e) => is(e, 'mc', 'Fallback'))
  let got = emptyCollector()
  if (choice) read(choice, got)
  if (isEmpty(got) && fallback) {
    got = emptyCollector()
    read(fallback, got)
  }
  merge(out, got)
}

/** 段落の中（w:r・w:hyperlink・変更履歴の挿入など）を読む */
function readInline(node: Element, out: Collector, ctx: DocumentContext) {
  for (const el of elements(node)) {
    if (is(el, 'w')) {
      switch (el.localName) {
        case 'r':
          readRun(el, out, ctx)
          break
        case 'hyperlink':
        case 'ins':
        case 'moveTo':
        case 'smartTag':
        case 'customXml':
        case 'fldSimple':
        case 'dir':
        case 'bdo':
        case 'sdtContent':
          readInline(el, out, ctx)
          break
        case 'sdt': {
          const content = child(el, 'w', 'sdtContent')
          if (content) readInline(content, out, ctx)
          break
        }
        default:
          // w:del・w:moveFrom（削除した変更履歴）、w:pPr、しおりなどは読まない
          break
      }
    } else if (is(el, 'mc', 'AlternateContent')) {
      alternate(el, (branch, o) => readInline(branch, o, ctx), out)
    } else if (is(el, 'm')) {
      // 数式：文字だけを読む
      out.text += mathText(el)
    }
  }
}

function mathText(el: Element): string {
  if (is(el, 'm', 't')) return el.textContent ?? ''
  return elements(el)
    .map((c) => mathText(c))
    .join('')
}

/** 文字の並び（w:r）を読む */
function readRun(run: Element, out: Collector, ctx: DocumentContext) {
  const hidden = isOn(child(child(run, 'w', 'rPr'), 'w', 'vanish'))
  readRunContent(run, out, ctx, hidden)
}

function readRunContent(node: Element, out: Collector, ctx: DocumentContext, hidden: boolean) {
  for (const el of elements(node)) {
    if (is(el, 'mc', 'AlternateContent')) {
      alternate(el, (branch, o) => readRunContent(branch, o, ctx, hidden), out)
      continue
    }
    if (!is(el, 'w')) continue
    switch (el.localName) {
      case 't':
        if (!hidden) out.text += el.textContent ?? ''
        break
      case 'tab':
      case 'ptab':
        if (!hidden) out.text += '\t'
        break
      case 'br': {
        // 改ページ・段区切りは読まない（ツールの決まった形で組む）
        const type = attr(el, 'type')
        if (!hidden && type !== 'page' && type !== 'column') out.text += '\n'
        break
      }
      case 'cr':
        if (!hidden) out.text += '\n'
        break
      case 'noBreakHyphen':
        if (!hidden) out.text += '-'
        break
      case 'drawing':
      case 'pict':
      case 'object':
        if (!hidden) readGraphic(el, out, ctx, null)
        break
      case 'footnoteReference':
      case 'endnoteReference':
        out.notes++
        break
      case 'ruby': {
        // ふりがなは読まず、ふりがなを振った文字だけを読む
        const base = child(el, 'w', 'rubyBase')
        if (base && !hidden) readInline(base, out, ctx)
        break
      }
      default:
        break
    }
  }
}

/** 浮かせた図形の、横の中心と基準 */
function anchorPosition(anchor: Element | null): { centerX: number | null; xFrom: string | null } {
  if (!anchor) return { centerX: null, xFrom: null }
  const positionH = child(anchor, 'wp', 'positionH')
  const offset = child(positionH, 'wp', 'posOffset')
  const extent = child(anchor, 'wp', 'extent')
  if (!positionH || !offset) return { centerX: null, xFrom: null }
  const x = Number(offset.textContent)
  const cx = Number(attr(extent, 'cx') ?? 0)
  return Number.isFinite(x) ? { centerX: x + (Number.isFinite(cx) ? cx / 2 : 0), xFrom: attr(positionH, 'relativeFrom') } : { centerX: null, xFrom: null }
}

/** 図形（w:drawing・w:pict）の中を読む：画像・文字の枠・グラフ */
function readGraphic(node: Element, out: Collector, ctx: DocumentContext, anchor: Element | null) {
  for (const el of elements(node)) {
    const here = is(el, 'wp', 'anchor') ? el : anchor
    if (is(el, 'w', 'txbxContent')) {
      out.boxes.push(readTextBox(el, ctx, here))
      continue
    }
    if (is(el, 'mc', 'AlternateContent')) {
      alternate(el, (branch, o) => readGraphic(branch, o, ctx, here), out)
      continue
    }
    if (is(el, 'a', 'blip')) {
      const embed = attr(el, 'embed')
      const link = attr(el, 'link')
      out.images.push({ rid: embed ?? link, linked: !embed && !!link, kind: 'image', ...anchorPosition(here), crop: cropOf(el) })
      continue
    }
    if (is(el, 'v', 'imagedata')) {
      out.images.push({ rid: attr(el, 'id') ?? attr(el, 'relid'), linked: false, kind: 'image', centerX: null, xFrom: null, crop: null })
      continue
    }
    if (is(el, 'a', 'graphicData')) {
      const uri = attr(el, 'uri') ?? ''
      if (/\/chart$|chartex/.test(uri)) {
        out.images.push({ rid: null, linked: false, kind: 'chart', ...anchorPosition(here), crop: null })
        continue
      }
      if (/\/diagram$/.test(uri)) {
        out.images.push({ rid: null, linked: false, kind: 'smartart', ...anchorPosition(here), crop: null })
        continue
      }
    }
    readGraphic(el, out, ctx, here)
  }
}

/** 画像の切り抜き（a:srcRect。1/1000 % の単位）。a:blip の隣にある */
function cropOf(blip: Element): Crop | null {
  const parent = blip.parentNode as Element | null
  const rect = parent ? elements(parent).find((e) => is(e, 'a', 'srcRect')) : undefined
  if (!rect) return null
  const v = (name: string) => Number(attr(rect, name) ?? 0) / 100000
  const crop = { left: v('l'), top: v('t'), right: v('r'), bottom: v('b') }
  return Object.values(crop).some((x) => x > 0) ? crop : null
}

/** 文字の枠の中（段落・表）を読む */
function readTextBox(content: Element, ctx: DocumentContext, anchor: Element | null): TextBox {
  const blocks = readBlocks(content, ctx)
  const lines: string[] = []
  const images: ImageRef[] = []
  const collect = (list: WordBlock[]) => {
    for (const b of list) {
      if (b.type === 'paragraph') {
        lines.push(b.listPrefix + b.text)
        images.push(...b.images)
        // 枠の中の枠
        for (const box of b.boxes) {
          lines.push(...box.lines)
          images.push(...box.images)
        }
      } else {
        for (const row of b.rows) for (const cell of row) collect(cell.blocks)
      }
    }
  }
  collect(blocks)
  return { lines, images, ...anchorPosition(anchor) }
}

function readParagraph(p: Element, ctx: DocumentContext): WordParagraph {
  const out = emptyCollector()
  readInline(p, out, ctx)
  const pPr = child(p, 'w', 'pPr')
  const styleId = attr(child(pPr, 'w', 'pStyle'), 'val')
  const outline = attr(child(pPr, 'w', 'outlineLvl'), 'val')
  let level = outline !== null && Number(outline) < 9 ? Number(outline) + 1 : styleHeadingLevel(ctx, styleId)
  // 段落番号：段落に付いたもの、なければスタイルに付いたもの
  const numPr = child(pPr, 'w', 'numPr')
  const own = numPr ? { numId: attr(child(numPr, 'w', 'numId'), 'val') ?? '0', ilvl: Number(attr(child(numPr, 'w', 'ilvl'), 'val') ?? 0) } : null
  const num = own ?? styleNumPr(ctx, styleId)
  let listPrefix = ''
  let romanLevel: 1 | 2 | null = null
  if (num && num.numId !== '0' && out.text.trim()) {
    const label = listLabel(ctx, num.numId, num.ilvl)
    if (label?.format === 'upperRoman') romanLevel = 1
    else if (label?.format === 'lowerRoman') romanLevel = 2
    else if (label && label.label && level === null) listPrefix = label.format === 'bullet' ? '・' : `${label.label}　`
  }
  if (level !== null && level > 2) level = 2
  return {
    type: 'paragraph',
    text: out.text,
    images: out.images,
    boxes: out.boxes,
    headingLevel: level === null ? null : (level as 1 | 2),
    romanLevel,
    listPrefix,
    notes: out.notes,
  }
}

function readTable(tbl: Element, ctx: DocumentContext): WordTable {
  const rows: WordCell[][] = []
  const rowElements = (node: Element): Element[] =>
    elements(node).flatMap((e) => {
      if (is(e, 'w', 'tr')) return [e]
      // 内容コントロールなどで包まれた行
      if (is(e, 'w', 'sdt') || is(e, 'w', 'customXml') || is(e, 'w', 'sdtContent')) return rowElements(e)
      return []
    })
  const cellElements = (node: Element): Element[] =>
    elements(node).flatMap((e) => {
      if (is(e, 'w', 'tc')) return [e]
      if (is(e, 'w', 'sdt') || is(e, 'w', 'customXml') || is(e, 'w', 'sdtContent')) return cellElements(e)
      return []
    })
  for (const tr of rowElements(tbl)) {
    const cells: WordCell[] = []
    for (const tc of cellElements(tr)) {
      const tcPr = child(tc, 'w', 'tcPr')
      const vMerge = child(tcPr, 'w', 'vMerge')
      const blocks = readBlocks(tc, ctx)
      const images: ImageRef[] = []
      const texts: string[] = []
      for (const b of blocks) {
        if (b.type === 'paragraph') {
          texts.push(b.listPrefix + b.text)
          images.push(...b.images)
          for (const box of b.boxes) images.push(...box.images)
        } else {
          for (const row of b.rows) for (const c of row) {
            if (c.text.trim()) texts.push(c.text)
            images.push(...c.images)
          }
        }
      }
      cells.push({
        blocks,
        text: texts.join('\n'),
        images,
        span: Math.max(1, Number(attr(child(tcPr, 'w', 'gridSpan'), 'val') ?? 1) || 1),
        mergedUp: !!vMerge && attr(vMerge, 'val') !== 'restart',
      })
    }
    rows.push(cells)
  }
  return { type: 'table', rows }
}

/** 本文・セル・文字の枠の中の、段落と表の並びを読む */
export function readBlocks(container: Element, ctx: DocumentContext): WordBlock[] {
  const blocks: WordBlock[] = []
  for (const el of elements(container)) {
    if (is(el, 'w', 'p')) blocks.push(readParagraph(el, ctx))
    else if (is(el, 'w', 'tbl')) blocks.push(readTable(el, ctx))
    else if (is(el, 'w', 'sdt')) {
      // 内容コントロール。目次（Word の自動の目次）は読まない
      const gallery = attr(child(child(child(el, 'w', 'sdtPr'), 'w', 'docPartObj'), 'w', 'docPartGallery'), 'val')
      if (gallery && /Table of Contents/i.test(gallery)) continue
      const content = child(el, 'w', 'sdtContent')
      if (content) blocks.push(...readBlocks(content, ctx))
    } else if (is(el, 'w', 'customXml') || is(el, 'w', 'ins') || is(el, 'w', 'moveTo')) {
      blocks.push(...readBlocks(el, ctx))
    } else if (is(el, 'mc', 'AlternateContent')) {
      const choice = elements(el).find((e) => is(e, 'mc', 'Choice')) ?? elements(el).find((e) => is(e, 'mc', 'Fallback'))
      if (choice) blocks.push(...readBlocks(choice, ctx))
    }
  }
  return blocks
}

/** 本文（w:body）の段落と表の並び */
export function readDocument(document: Document, ctx: DocumentContext): WordBlock[] {
  const body = elements(document.documentElement).find((e) => is(e, 'w', 'body'))
  return body ? readBlocks(body, ctx) : []
}
