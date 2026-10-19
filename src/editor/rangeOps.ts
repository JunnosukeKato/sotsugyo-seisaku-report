import { chapterLabel, figureCaption, subheadingLabel } from '../layout/bodyHtml'
import type { BodyBlock, Figure, FigureRowBlock, InlineNode, ParagraphBlock, Report, TableBlock } from '../model/types'
import { contentToText, mergeTexts, newId, numbering, withoutRefsTo, type Numbering } from './reportOps'

/**
 * 段落をまたいで選んだ範囲（紙面をマウスでなぞって選んだ所）の、コピー・切り取り・削除・貼り付け。
 * ここは原稿のデータだけを扱う（紙面の選んだ所から、原稿の位置を求めるのは rangeSelection.ts）。いずれも元のデータを変えず、新しいデータを返す。
 *
 * 範囲は、本文（大見出しから引用・参考文献の前まで）か、抄録の中だけ。表紙・目次・引用参考文献・作品写真にかかる範囲は扱わない
 * （コピーはブラウザのふつうのコピーになる。切り取り・削除はしない）。
 *
 * 決まり：
 * - 図・表・改ページは、少しでも範囲に入れば、まるごと入る（図のタイトルの途中だけを選んでも、ほかの段落と一緒なら図ごと）。
 *   図・表のタイトルの中だけを選んだときは、タイトルの文字だけ
 * - 1つの欄（段落・見出し・タイトル）の中だけを選んだときは、文字だけ（貼り付けると、カーソルの位置にそのまま入る）
 * - 段落の途中から別の段落の途中までを消すと、残った前と後ろをつないで1つの段落にする（ワープロと同じ）
 * - 大見出し（章）は、範囲にかかっても消さない（章を丸ごと動かすことはしない）。消すのは章の中の文・見出し・図表だけで、
 *   章をまたいだときは、前の章の残りと後ろの章の残りはつながない。貼り付けるときも、大見出しは入れない（中の文・図表だけ）。
 *   手順書で決まった章立て（Ⅰ．Ⅱ．…）を、選び方の加減で崩さないため
 * - 消した図・表への本文の参照は、図・表の「削除」と同じ決まり（添えてあるだけの（図n）は消し、文の中の参照は「図?」にして指摘する）
 */

/** 本文・抄録の流れの中の1つ（紙面の上から順） */
export interface FlowItem {
  kind: 'chapter' | 'subheading' | 'paragraph' | 'figure' | 'table' | 'pageBreak' | 'abstractParagraph'
  /** 段落・見出し・改ページ・表はブロックの ID、図は図の ID、大見出しは章の ID */
  id: string
  /** 章の番号（0 から。抄録は -1） */
  chapter: number
  /** 文字（段落は contentToText、見出しは題、図・表はタイトル。改ページは空） */
  text: string
  /** 図のまとまりの ID（図だけ） */
  rowId?: string
}

/** 原稿の中の点：欄の ID と、その中の文字の位置。whole：図・表を（タイトルの文字ではなく）物として指した（写真・表の中・番号） */
export interface ModelPoint {
  id: string
  offset: number
  whole?: boolean
}

/** 選んだ範囲（start ≦ end。index は流れの中の位置） */
export interface ModelRange {
  flow: 'body' | 'abstract'
  start: { index: number; offset: number }
  end: { index: number; offset: number }
  /** 図・表を物として選んだ（1つの図・表の中だけのときも、まるごと） */
  whole: boolean
}

/** 範囲にかかる1つ分。from〜to：その中の文字の範囲。whole：まるごと（図・表・改ページはいつも） */
export interface Piece {
  item: FlowItem
  index: number
  from: number
  to: number
  whole: boolean
}

const ATOMIC: FlowItem['kind'][] = ['figure', 'table', 'pageBreak']

/** 本文の流れ（大見出し・小見出し・段落・図・表・改ページを、紙面の上から順に） */
export function bodyFlow(report: Pick<Report, 'body'>): FlowItem[] {
  const num = numbering(report)
  return report.body.flatMap((c, chapter): FlowItem[] => [
    { kind: 'chapter', id: c.id, chapter, text: c.title },
    ...c.blocks.flatMap((b): FlowItem[] => {
      switch (b.type) {
        case 'subheading':
          return [{ kind: 'subheading', id: b.id, chapter, text: b.title }]
        case 'paragraph':
          return [{ kind: 'paragraph', id: b.id, chapter, text: contentToText(b.content, num) }]
        case 'figureRow':
          return b.figures.map((f) => ({ kind: 'figure', id: f.id, rowId: b.id, chapter, text: f.caption }))
        case 'table':
          return [{ kind: 'table', id: b.id, chapter, text: b.caption }]
        case 'pageBreak':
          return [{ kind: 'pageBreak', id: b.id, chapter, text: '' }]
      }
    }),
  ])
}

function abstractFlow(report: Report): FlowItem[] {
  const num = numbering(report)
  return report.abstract.paragraphs.map((p) => ({ kind: 'abstractParagraph', id: p.id, chapter: -1, text: contentToText(p.content, num) }))
}

/** 欄の ID がある流れと、その中の位置（表のセル・図のまとまりの ID は、その表・最初の図）。本文・抄録になければ null */
function locate(report: Report, id: string): { flow: 'body' | 'abstract'; index: number; cell: boolean } | null {
  const a = abstractFlow(report).findIndex((x) => x.id === id)
  if (a >= 0 && report.abstract.started !== false) return { flow: 'abstract', index: a, cell: false }
  const items = bodyFlow(report)
  const i = items.findIndex((x) => x.id === id || x.rowId === id)
  if (i >= 0) return { flow: 'body', index: i, cell: false }
  const table = report.body.flatMap((c) => c.blocks).find((b) => b.type === 'table' && b.rows.some((r) => r.cells.some((c) => c.id === id)))
  if (!table) return null
  return { flow: 'body', index: items.findIndex((x) => x.id === table.id), cell: true }
}

/** 流れ（本文か抄録）の欄 */
export function flowItems(report: Report, flow: ModelRange['flow']): FlowItem[] {
  return flow === 'abstract' ? abstractFlow(report) : bodyFlow(report)
}

/**
 * 2つの点（選び始めと終わり。順は問わない）から、選んだ範囲を求める。本文と抄録をまたぐ・どちらでもない所・何も選んでいないときは null
 */
export function resolveRange(report: Report, a: ModelPoint, b: ModelPoint): ModelRange | null {
  const la = locate(report, a.id)
  const lb = locate(report, b.id)
  if (!la || !lb || la.flow !== lb.flow) return null
  const items = flowItems(report, la.flow)
  const clamp = (index: number, offset: number) => Math.max(0, Math.min(offset, items[index].text.length))
  let start = { index: la.index, offset: clamp(la.index, a.offset) }
  let end = { index: lb.index, offset: clamp(lb.index, b.offset) }
  if (start.index > end.index || (start.index === end.index && start.offset > end.offset)) [start, end] = [end, start]
  const atomic = ATOMIC.includes(items[start.index].kind)
  const whole = start.index === end.index && atomic && (!!a.whole || !!b.whole || la.cell || lb.cell || items[start.index].kind === 'pageBreak')
  if (start.index === end.index && start.offset === end.offset && !whole) return null
  return { flow: la.flow, start, end, whole }
}

/** 範囲にかかる欄（何も文字のかからない、始めの欄の終わり・終わりの欄の始めは除く） */
export function rangePieces(report: Report, range: ModelRange): Piece[] {
  const items = flowItems(report, range.flow)
  const { start, end } = range
  if (start.index === end.index) {
    const item = items[start.index]
    if (range.whole || item.kind === 'pageBreak') return [{ item, index: start.index, from: 0, to: item.text.length, whole: true }]
    return [{ item, index: start.index, from: start.offset, to: end.offset, whole: start.offset === 0 && end.offset === item.text.length }]
  }
  const pieces: Piece[] = []
  for (let i = start.index; i <= end.index; i++) {
    const item = items[i]
    const len = item.text.length
    if (ATOMIC.includes(item.kind)) {
      pieces.push({ item, index: i, from: 0, to: len, whole: true })
      continue
    }
    const from = i === start.index ? start.offset : 0
    const to = i === end.index ? end.offset : len
    // 選び始めが欄の終わり・選び終わりが欄の始め：その欄は範囲に入れない（空の欄は、間にあれば入れる）
    if (len > 0 && ((i === start.index && from >= len) || (i === end.index && to <= 0))) continue
    pieces.push({ item, index: i, from, to, whole: from === 0 && to === len })
  }
  return pieces
}

// ---- 段落の中身（参照を含む）を文字の位置で切る ----

/** 中身の from〜to の部分（途中まで選んだ参照は、選んだ文字だけの文字にする） */
export function sliceContent(content: InlineNode[], from: number, to: number, num: Numbering): InlineNode[] {
  const out: InlineNode[] = []
  let at = 0
  for (const node of content) {
    const text = contentToText([node], num)
    const s = Math.max(from, at)
    const e = Math.min(to, at + text.length)
    if (s < e) {
      if (node.type === 'ref' && s === at && e === at + text.length) out.push(node)
      else out.push({ type: 'text', text: text.slice(s - at, e - at) })
    }
    at += text.length
  }
  return mergeTexts(out)
}

/** 中身から from〜to を除いたもの（範囲に少しでもかかる参照は、参照ごと除く。「（図」だけが残らないように） */
export function removeContent(content: InlineNode[], from: number, to: number, num: Numbering): InlineNode[] {
  const out: InlineNode[] = []
  let at = 0
  for (const node of content) {
    const text = contentToText([node], num)
    const end = at + text.length
    if (end <= from || at >= to) out.push(node)
    else if (node.type === 'text') out.push({ type: 'text', text: text.slice(0, Math.max(0, from - at)) + text.slice(Math.max(0, to - at)) })
    at = end
  }
  return mergeTexts(out)
}

/** 中身を at の位置で前と後ろに分ける（参照の途中なら、参照の後ろで分ける） */
export function splitContent(content: InlineNode[], at: number, num: Numbering): [InlineNode[], InlineNode[]] {
  const left: InlineNode[] = []
  const right: InlineNode[] = []
  let pos = 0
  for (const node of content) {
    const text = contentToText([node], num)
    const end = pos + text.length
    if (end <= at) left.push(node)
    else if (pos >= at) right.push(node)
    else if (node.type === 'ref') left.push(node)
    else {
      left.push({ type: 'text', text: text.slice(0, at - pos) })
      right.push({ type: 'text', text: text.slice(at - pos) })
    }
    pos = end
  }
  return [left, right]
}

/** 中身が空（文字も参照もない）か */
function emptyContent(content: InlineNode[]): boolean {
  return content.every((n) => n.type === 'text' && n.text === '')
}

// ---- コピー ----

/**
 * コピーしたもの。text：クリップボードに入れるふつうの文字（段落は改行で分ける。見出し・図表のタイトルは番号付きの1行、表は1行目にタイトル、行ごとにセルをタブで区切る）。
 * 貼り付けるときは、クリップボードの文字が text と同じなら、まとまり（blocks・inline）のまま入れる（reportEditor の pasteClip）
 */
export interface Clip {
  text: string
  /** inline：1つの欄の中の文字だけ（貼り付ける段落のカーソルの位置に、そのまま入れる）／blocks：段落・見出し・図表などのまとまり */
  kind: 'inline' | 'blocks'
  inline: InlineNode[]
  blocks: BodyBlock[]
  /** 最初のまとまりが、途中から選んだ段落（貼り付ける段落の、カーソルの前の文とつなぐ） */
  openStart: boolean
  /** 最後のまとまりが、途中まで選んだ段落（貼り付ける段落の、カーソルの後ろの文とつなぐ） */
  openEnd: boolean
  /** 範囲にかかった大見出しの数（貼り付けるときは入れない） */
  chapters: number
  /** コピーしたときの図表の番号の文字（図表の ID → 「図1」など。抄録へ貼り付けるとき・図表が見つからないときに使う） */
  labels: Record<string, string>
}

const clone = <T>(x: T): T => structuredClone(x)

/** 選んだ範囲をコピーする */
export function copyRange(report: Report, range: ModelRange): Clip {
  const num = numbering(report)
  const labels: Record<string, string> = {}
  for (const [id, n] of num.numbers) labels[id] = `${num.tableIds.has(id) ? '表' : '図'}${n}`
  const pieces = rangePieces(report, range)
  const blockOf = (id: string) => report.body.flatMap((c) => c.blocks).find((b) => b.id === id)
  const paragraphOf = (item: FlowItem): ParagraphBlock | undefined =>
    item.kind === 'abstractParagraph' ? report.abstract.paragraphs.find((p) => p.id === item.id) : (blockOf(item.id) as ParagraphBlock | undefined)
  const base: Clip = { text: '', kind: 'blocks', inline: [], blocks: [], openStart: false, openEnd: false, chapters: 0, labels }

  // 1つの欄の中の文字だけ
  const only = pieces.length === 1 ? pieces[0] : null
  if (only && !ATOMIC.includes(only.item.kind)) {
    const p = only.item.kind === 'paragraph' || only.item.kind === 'abstractParagraph' ? paragraphOf(only.item) : undefined
    const inline = p ? sliceContent(p.content, only.from, only.to, num) : [{ type: 'text' as const, text: only.item.text.slice(only.from, only.to) }]
    return { ...base, kind: 'inline', inline, text: only.item.text.slice(only.from, only.to) }
  }
  if (only && (only.item.kind === 'figure' || only.item.kind === 'table') && !only.whole && !range.whole) {
    const text = only.item.text.slice(only.from, only.to)
    return { ...base, kind: 'inline', inline: [{ type: 'text', text }], text }
  }

  const lines: string[] = []
  const blocks: BodyBlock[] = []
  let chapters = 0
  pieces.forEach((piece, k) => {
    const { item, from, to } = piece
    const partial = item.text.slice(from, to)
    switch (item.kind) {
      case 'chapter':
        chapters++
        lines.push(piece.whole ? `${chapterLabel(item.chapter)}${item.text}` : partial)
        break
      case 'subheading': {
        const chapter = report.body[item.chapter]
        const sub = chapter.blocks.filter((b) => b.type === 'subheading').findIndex((b) => b.id === item.id)
        lines.push(piece.whole ? `${subheadingLabel(sub)}${item.text}` : partial)
        blocks.push({ type: 'subheading', id: item.id, title: partial })
        break
      }
      case 'paragraph':
      case 'abstractParagraph': {
        const p = paragraphOf(item)!
        lines.push(partial)
        // ひな形の説明（hint）は持っていかない（貼り付けた先で、空の段落に同じ説明が二重に出ないように）
        blocks.push({ type: 'paragraph', id: item.id, content: piece.whole ? clone(p.content) : sliceContent(p.content, from, to, num) })
        if (k === 0 && !piece.whole) base.openStart = true
        if (k === pieces.length - 1 && !piece.whole) base.openEnd = true
        break
      }
      case 'figure': {
        const row = blockOf(item.rowId!) as FigureRowBlock
        const figure = clone(row.figures.find((f) => f.id === item.id)!)
        lines.push(figureCaption('図', num.numbers.get(item.id) ?? 0, figure.caption))
        // 同じまとまりの図が続けて入るときは、1つのまとまりのままにする
        const last = blocks.at(-1)
        if (last?.type === 'figureRow' && last.id === row.id) last.figures.push(figure)
        else blocks.push({ type: 'figureRow', id: row.id, figures: [figure] })
        break
      }
      case 'table': {
        const table = clone(blockOf(item.id) as TableBlock)
        lines.push(figureCaption('表', num.numbers.get(item.id) ?? 0, table.caption))
        for (const row of table.rows) lines.push(row.cells.map((c) => c.text.replace(/[\r\n]+/g, ' ')).join('\t'))
        blocks.push(table)
        break
      }
      case 'pageBreak':
        blocks.push({ type: 'pageBreak', id: item.id })
        break
    }
  })
  return { ...base, text: lines.join('\n'), blocks, chapters }
}

// ---- 削除（切り取りも） ----

export interface RangeRemoval {
  report: Report
  /** 消した図・表の ID（参照は「図?」などにした） */
  figures: string[]
  tables: string[]
  /** 範囲に大見出しがかかったが、大見出しは残した */
  keptChapters: boolean
}

/** 選んだ範囲を消す（何も消えなければ、同じ原稿を返す） */
export function deleteRange(report: Report, range: ModelRange): RangeRemoval {
  const num = numbering(report)
  const pieces = rangePieces(report, range)
  const figures: string[] = []
  const tables: string[] = []
  /** ブロック（図は図）の ID → 消す（null）か、置き換えるもの */
  const change = new Map<string, BodyBlock | ParagraphBlock | null>()
  const title = new Map<string, string>()
  let keptChapters = false
  const blockOf = (id: string) => report.body.flatMap((c) => c.blocks).find((b) => b.id === id)
  const paragraphOf = (item: FlowItem): ParagraphBlock => (item.kind === 'abstractParagraph' ? report.abstract.paragraphs.find((p) => p.id === item.id)! : (blockOf(item.id) as ParagraphBlock))

  const single = pieces.length === 1 ? pieces[0] : null
  if (single && !(ATOMIC.includes(single.item.kind) && (single.whole || range.whole))) {
    // 1つの欄の中：文字だけを消す（段落をまるごと選んで消したときは、段落ごと。大見出しは題の文字だけ）
    const { item, from, to } = single
    if (item.kind === 'chapter') title.set(item.id, item.text.slice(0, from) + item.text.slice(to))
    else if (item.kind === 'subheading') change.set(item.id, single.whole ? null : { type: 'subheading', id: item.id, title: item.text.slice(0, from) + item.text.slice(to) })
    else if (item.kind === 'figure' || item.kind === 'table') title.set(item.id, item.text.slice(0, from) + item.text.slice(to))
    else {
      const p = paragraphOf(item)
      const content = removeContent(p.content, from, to, num)
      change.set(item.id, single.whole && emptyContent(content) ? null : { ...p, content })
    }
  } else {
    const first = pieces[0]
    const last = pieces[pieces.length - 1]
    const isParagraph = (p: Piece) => p.item.kind === 'paragraph' || p.item.kind === 'abstractParagraph'
    // 前と後ろの段落の残りをつなぐか（同じ章の段落どうし・抄録の段落どうし）
    const merge = pieces.length > 1 && isParagraph(first) && isParagraph(last) && first.item.chapter === last.item.chapter
    for (const piece of pieces) {
      const { item, from, to } = piece
      const isFirst = piece === first
      const isLast = piece === last
      switch (item.kind) {
        case 'chapter':
          keptChapters = true
          break
        case 'subheading': {
          // 途中から（途中まで）選んだ見出しは、選んでいない文字を残す。まるごと選んだ見出しは消す
          const rest = isFirst ? item.text.slice(0, from) : isLast ? item.text.slice(to) : ''
          change.set(item.id, piece.whole || rest === '' ? null : { type: 'subheading', id: item.id, title: rest })
          break
        }
        case 'paragraph':
        case 'abstractParagraph': {
          const p = paragraphOf(item)
          if (isFirst) {
            const left = sliceContent(p.content, 0, from, num)
            const right = merge ? sliceContent(paragraphOf(last.item).content, last.to, last.item.text.length, num) : []
            const content = mergeTexts([...left, ...right])
            // つないだ段落は、前の段落（前の段落をまるごと選んだときは、後ろの段落。切り取って貼り付けると、前の段落が同じ ID のまま戻るように）
            const keep = merge && emptyContent(left) ? paragraphOf(last.item) : p
            change.set(item.id, null)
            if (merge) change.set(last.item.id, null)
            if (!emptyContent(content)) change.set(keep.id, { ...keep, content })
          } else if (isLast && merge) {
            // 前の段落とつないだ（上で決めた）
          } else if (isLast) {
            const content = sliceContent(p.content, to, item.text.length, num)
            change.set(item.id, emptyContent(content) ? null : { ...p, content })
          } else change.set(item.id, null)
          break
        }
        case 'figure':
          figures.push(item.id)
          change.set(item.id, null)
          break
        case 'table':
          tables.push(item.id)
          change.set(item.id, null)
          break
        case 'pageBreak':
          change.set(item.id, null)
          break
      }
    }
  }

  let next: Report = report
  if (range.flow === 'abstract') {
    let paragraphs = report.abstract.paragraphs.flatMap((p) => {
      if (!change.has(p.id)) return [p]
      const c = change.get(p.id)
      return c && c.type === 'paragraph' ? [c] : []
    })
    // 抄録の段落は、1つは残す（空でも）
    if (paragraphs.length === 0) paragraphs = [{ ...report.abstract.paragraphs[0], content: [{ type: 'text', text: '' }] }]
    next = { ...report, abstract: { ...report.abstract, paragraphs } }
  } else {
    next = {
      ...report,
      body: report.body.map((c) => ({
        ...c,
        title: title.get(c.id) ?? c.title,
        blocks: c.blocks.flatMap((b): BodyBlock[] => {
          if (b.type === 'figureRow') {
            const kept = b.figures.filter((f) => !change.has(f.id)).map((f) => (title.has(f.id) ? { ...f, caption: title.get(f.id)! } : f))
            return kept.length ? [{ ...b, figures: kept }] : []
          }
          if (b.type === 'table' && title.has(b.id)) return [{ ...b, caption: title.get(b.id)! }]
          if (!change.has(b.id)) return [b]
          const c2 = change.get(b.id)
          return c2 ? [c2 as BodyBlock] : []
        }),
      })),
    }
    for (const id of figures) next = withoutRefsTo(next, id, '図')
    for (const id of tables) next = withoutRefsTo(next, id, '表')
  }
  return { report: next, figures, tables, keptChapters }
}

// ---- 貼り付け ----

export interface PasteResult {
  report: Report
  /** 貼り付けたあとのカーソルの位置（書き続ける欄と、その中の位置）。書く欄で続けられないとき（図・表で終わる）は null */
  caret: { id: string; offset: number } | null
  /** 大見出しを入れなかった */
  skippedChapters: boolean
  /** 抄録に貼り付けたので、文のほか（見出し・図・表など）を入れなかった */
  droppedForAbstract: boolean
}

/**
 * 段落 paragraphId の文字の位置 offset に、コピーしたものを入れる（本文の段落・抄録の段落）。
 * - 文字だけ（inline）：カーソルの位置にそのまま入れる
 * - まとまり（blocks）：段落をカーソルの位置で分けて、間に入れる。途中から選んだ段落はカーソルの前の文と、途中まで選んだ段落はカーソルの後ろの文とつなぐ
 * - 図・表・段落などは新しい ID にする（同じ ID のものが原稿になければ、そのままの ID。切り取って貼り付けたとき）。番号は自動で振り直される。
 *   貼り付けた文の中の参照は、一緒に貼り付けた図表を指す。一緒でない図表への参照は、その図表がまだあればそれを指し、なければ「図?」の文字にする
 * - 大見出しは入れない。抄録には文だけを入れる（図表への参照は、コピーしたときの番号の文字にする）
 */
export function pasteClip(report: Report, paragraphId: string, offset: number, clip: Clip): PasteResult {
  const num = numbering(report)
  const inAbstract = report.abstract.paragraphs.some((p) => p.id === paragraphId)
  const target = inAbstract ? report.abstract.paragraphs.find((p) => p.id === paragraphId) : report.body.flatMap((c) => c.blocks).find((b) => b.id === paragraphId)
  const none: PasteResult = { report, caret: null, skippedChapters: false, droppedForAbstract: false }
  if (target?.type !== 'paragraph') return none
  const [left, right] = splitContent(target.content, offset, num)
  const skippedChapters = clip.chapters > 0

  // 原稿にある ID（図・表・段落など。同じ ID を二度使わない）
  const used = new Set<string>([...report.abstract.paragraphs.map((p) => p.id)])
  for (const c of report.body) {
    used.add(c.id)
    for (const b of c.blocks) {
      used.add(b.id)
      if (b.type === 'figureRow') for (const f of b.figures) used.add(f.id)
      if (b.type === 'table') for (const r of b.rows) {
        used.add(r.id)
        for (const cell of r.cells) used.add(cell.id)
      }
    }
  }
  const ids = new Map<string, string>()
  const fresh = (id: string, prefix: string): string => {
    if (ids.has(id)) return ids.get(id)!
    const next = used.has(id) ? newId(prefix) : id
    used.add(next)
    ids.set(id, next)
    return next
  }
  const existing = new Set(num.numbers.keys())
  // 先に図表の ID を決める（文の中の参照を、貼り付けた図表へつなぐため）
  for (const b of clip.blocks) {
    if (b.type === 'figureRow') b.figures.forEach((f) => fresh(f.id, 'f'))
    if (b.type === 'table') fresh(b.id, 't')
  }
  /** 参照をつなぎ直す（抄録では、コピーしたときの番号の文字にする） */
  const relink = (content: InlineNode[]): InlineNode[] =>
    mergeTexts(
      content.map((n): InlineNode => {
        if (n.type === 'text') return n
        const label = clip.labels[n.targetId] ?? '図?'
        if (inAbstract) return { type: 'text', text: n.withParens ? `（${label}）` : label }
        if (ids.has(n.targetId)) return { ...n, targetId: ids.get(n.targetId)! }
        if (existing.has(n.targetId)) return n
        const kind = label.startsWith('表') ? '表' : '図'
        return { type: 'text', text: n.withParens ? `（${kind}?）` : `${kind}?` }
      }),
    )

  if (clip.kind === 'inline') {
    const inline = relink(clip.inline)
    const content = mergeTexts([...left, ...inline, ...right])
    const updated: ParagraphBlock = { ...target, content }
    const next = replaceParagraph(report, paragraphId, [updated], inAbstract)
    // カーソルは、入れた文字の後ろ（参照の長さは、貼り付けたあとの番号で数える）
    return { report: next, caret: { id: paragraphId, offset: contentToText([...left, ...inline], numbering(next)).length }, skippedChapters, droppedForAbstract: false }
  }

  // まとまり：大見出しは入っていない（copyRange で除いてある）。抄録には段落だけ
  let blocks = clip.blocks
  let droppedForAbstract = false
  if (inAbstract) {
    droppedForAbstract = blocks.some((b) => b.type !== 'paragraph')
    blocks = blocks.filter((b) => b.type === 'paragraph')
  }
  const openStart = clip.openStart && blocks[0] === clip.blocks[0]
  const openEnd = clip.openEnd && blocks.at(-1) === clip.blocks.at(-1)
  const copied: BodyBlock[] = blocks.map((b): BodyBlock => {
    switch (b.type) {
      case 'paragraph':
        return { type: 'paragraph', id: fresh(b.id, 'p'), content: relink(b.content) }
      case 'subheading':
        return { ...b, id: fresh(b.id, 's') }
      case 'pageBreak':
        return { ...b, id: fresh(b.id, 'pb') }
      case 'figureRow':
        return { ...b, id: fresh(b.id, 'r'), figures: b.figures.map((f): Figure => ({ ...f, id: fresh(f.id, 'f') })) }
      case 'table':
        return { ...b, id: fresh(b.id, 't'), rows: b.rows.map((r) => ({ ...r, id: fresh(r.id, 'row'), cells: r.cells.map((c) => ({ ...c, id: fresh(c.id, 'cell') })) })) }
    }
  })
  if (copied.length === 0) return { ...none, skippedChapters, droppedForAbstract }

  const out: BodyBlock[] = []
  // カーソルの前の文：最初の段落につなぐか、そのまま残す（空なら残さない）
  let keptTarget = false
  const first = copied[0]
  if (openStart && first.type === 'paragraph') {
    out.push({ ...target, content: mergeTexts([...left, ...first.content]) })
    keptTarget = true
  } else {
    if (!emptyContent(left)) {
      out.push({ ...target, content: mergeTexts(left) })
      keptTarget = true
    }
    out.push(first)
  }
  out.push(...copied.slice(1))
  /** カーソルを置く段落と、その中のカーソルの前の部分（貼り付けたあとの番号で数える） */
  let caretAt: { id: string; before: InlineNode[] } | null = null
  let caretTitle: { id: string; offset: number } | null = null
  const lastIndex = out.length - 1
  const last = out[lastIndex]
  if (openEnd && last.type === 'paragraph') {
    // 途中まで選んだ最後の段落に、カーソルの後ろの文をつなぐ
    caretAt = { id: last.id, before: last.content }
    out[lastIndex] = { ...last, content: mergeTexts([...last.content, ...right]) }
  } else if (!emptyContent(right)) {
    // カーソルの後ろの文は、段落として残す（前の文を残さなかったときは、元の段落の ID のまま）
    const id = keptTarget ? newId('p') : paragraphId
    out.push({ type: 'paragraph', id, content: mergeTexts(right), ...(keptTarget || !target.hint ? {} : { hint: target.hint }) })
    caretAt = { id, before: [] }
  } else if (last.type === 'paragraph') {
    caretAt = { id: last.id, before: last.content }
  } else if (last.type === 'subheading') {
    caretTitle = { id: last.id, offset: last.title.length }
  }
  const next = replaceParagraph(report, paragraphId, out, inAbstract)
  const n2 = numbering(next)
  const caret = caretAt ? { id: caretAt.id, offset: contentToText(caretAt.before, n2).length } : caretTitle
  return { report: next, caret, skippedChapters, droppedForAbstract }
}

/** 段落 id を、blocks に置き換える（抄録の段落なら、段落だけ） */
function replaceParagraph(report: Report, id: string, blocks: BodyBlock[], inAbstract: boolean): Report {
  if (inAbstract) {
    const paragraphs = report.abstract.paragraphs.flatMap((p) => (p.id === id ? (blocks.filter((b) => b.type === 'paragraph') as ParagraphBlock[]) : [p]))
    return { ...report, abstract: { ...report.abstract, paragraphs: paragraphs.length ? paragraphs : report.abstract.paragraphs } }
  }
  return { ...report, body: report.body.map((c) => ({ ...c, blocks: c.blocks.flatMap((b) => (b.id === id ? blocks : [b])) })) }
}

/** クリップボードの文字が、コピーした文字と同じか（改行の違い・最後の改行は見ない） */
export function sameClipText(pasted: string, text: string): boolean {
  const norm = (s: string) => s.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  return norm(pasted) === norm(text) && norm(text) !== ''
}
