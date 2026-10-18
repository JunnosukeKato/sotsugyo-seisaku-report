import { setCellText } from '../model/table'
import type { BasicInfo, BodyBlock, Chapter, Figure, InlineNode, ParagraphBlock, Report, TableBlock } from '../model/types'

/**
 * 報告書データの操作。いずれも元のデータを変えず、新しいデータを返す（元に戻す機能のため）。
 *
 * 紙面上で編集できる文字列（Editable）と、その ID：
 * - 表紙の項目      basic:studentId / basic:name / basic:subtitleInput
 * - 抄録の段落      段落の ID
 * - 大見出し        章の ID
 * - 小見出し・段落  ブロックの ID
 * - 図・表のタイトル 図の ID ／ 表の ID
 * - 素材表のセル    {行の ID}:name ／ {行の ID}:usage
 *
 * 段落の中の図表の参照（（図1）など）は、図表へのリンクとして持つ。
 * 編集するときは「（図1）」という文字列にし、確定したときにリンクへ戻す。図を追加・削除すると番号は自動で振り直される。
 */

export type EditableKind = 'field' | 'abstractParagraph' | 'chapter' | 'subheading' | 'paragraph' | 'figureCaption' | 'tableCaption' | 'tableCell'

export interface Editable {
  id: string
  kind: EditableKind
  text: string
}

const FIELD_PREFIX = 'basic:'
const EDITABLE_FIELDS = ['studentId', 'name', 'subtitleInput'] as const
type EditableField = (typeof EDITABLE_FIELDS)[number]

let counter = 0
export function newId(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter}`
}

// ---- 図表の番号と参照 ----

export interface Numbering {
  /** 図・表の ID → 番号（図と表は別々に数える） */
  numbers: Map<string, number>
  tableIds: Set<string>
  /** 番号 → ID */
  figureByNumber: Map<number, string>
  tableByNumber: Map<number, string>
}

export function numbering(report: Pick<Report, 'body'>): Numbering {
  const numbers = new Map<string, number>()
  const tableIds = new Set<string>()
  const figureByNumber = new Map<number, string>()
  const tableByNumber = new Map<number, string>()
  for (const block of report.body.flatMap((c) => c.blocks)) {
    if (block.type === 'figureRow') {
      for (const f of block.figures) {
        const n = figureByNumber.size + 1
        numbers.set(f.id, n)
        figureByNumber.set(n, f.id)
      }
    } else if (block.type === 'table') {
      const n = tableByNumber.size + 1
      numbers.set(block.id, n)
      tableIds.add(block.id)
      tableByNumber.set(n, block.id)
    }
  }
  return { numbers, tableIds, figureByNumber, tableByNumber }
}

/** 段落の中身を、編集・チェック用の文字列にする（参照は「（図1）」などになる） */
export function contentToText(content: InlineNode[], num: Numbering): string {
  return content
    .map((node) => {
      if (node.type === 'text') return node.text
      const label = `${num.tableIds.has(node.targetId) ? '表' : '図'}${num.numbers.get(node.targetId) ?? '?'}`
      return node.withParens ? `（${label}）` : label
    })
    .join('')
}

/** 文字列中の「（図1）」「図1」などを、存在する図表へのリンクに戻す。存在しない番号は文字のまま残す */
export function textToContent(text: string, num: Numbering): InlineNode[] {
  const nodes: InlineNode[] = []
  let last = 0
  // 括弧なしの「図1」は、「設計図1枚」のような語の一部を拾わないよう、直前が漢字でないときだけ
  const re = /[（(]([図表])\s*(\d+)[）)]|(?<![㐀-鿿々])([図表])(\d+)/g
  for (const m of text.matchAll(re)) {
    const kind = m[1] ?? m[3]
    const n = Number(m[2] ?? m[4])
    const targetId = (kind === '表' ? num.tableByNumber : num.figureByNumber).get(n)
    if (!targetId) continue
    if (m.index > last) nodes.push({ type: 'text', text: text.slice(last, m.index) })
    nodes.push({ type: 'ref', targetId, withParens: m[1] !== undefined })
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push({ type: 'text', text: text.slice(last) })
  return nodes.length ? nodes : [{ type: 'text', text: '' }]
}

/** 段落の書き出しの1字下げは自動で付くため、入力された先頭の空白と改行は取り除く */
export function normalizeParagraph(text: string): string {
  // 続いた「。」は1つにする
  return text.replace(/[\r\n]/g, '').replace(/^[\s　]+/, '').replace(/。{2,}/g, '。')
}

/**
 * 段落の終わりに「。」がなければ付ける（Enter で段落を分けたとき）。「、」で終わっていれば「。」に置き換える。
 * 空の段落・「！」「？」で終わる段落はそのまま
 */
export function withPeriod(text: string): string {
  const t = text.replace(/[\s　]+$/, '')
  if (!t || /[。！？!?]$/.test(t)) return text
  return /[、，,]$/.test(t) ? `${t.slice(0, -1)}。` : `${t}。`
}

/**
 * 段落を作る。hint：ひな形の「ここに何を書くか」（書き換えても持ち続ける。空の段落を開いて、何も書かずに閉じたときに、
 * 説明が消えていたため。説明が出るのは空のときだけなので、書いてある段落では見えない）
 */
function paragraph(id: string, text: string, num?: Numbering, hint?: string): ParagraphBlock {
  const normalized = normalizeParagraph(text)
  return { type: 'paragraph', id, content: num ? textToContent(normalized, num) : [{ type: 'text', text: normalized }], ...(hint ? { hint } : {}) }
}

// ---- 編集できる文字列の一覧 ----

export function editables(report: Report): Editable[] {
  const num = numbering(report)
  return [
    ...EDITABLE_FIELDS.map((f) => ({ id: FIELD_PREFIX + f, kind: 'field' as const, text: report.basicInfo[f] })),
    // 抄録は、書き始めるまで（先生の許可が出るまで）書けない
    ...(report.abstract.started === false ? [] : report.abstract.paragraphs).map((p) => ({ id: p.id, kind: 'abstractParagraph' as const, text: contentToText(p.content, num) })),
    ...report.body.flatMap((c) => [
      { id: c.id, kind: 'chapter' as const, text: c.title },
      ...c.blocks.flatMap((b): Editable[] => {
        switch (b.type) {
          case 'subheading':
            return [{ id: b.id, kind: 'subheading', text: b.title }]
          case 'paragraph':
            return [{ id: b.id, kind: 'paragraph', text: contentToText(b.content, num) }]
          case 'figureRow':
            return b.figures.map((f) => ({ id: f.id, kind: 'figureCaption' as const, text: f.caption }))
          case 'pageBreak':
            return []
          case 'table':
            return [{ id: b.id, kind: 'tableCaption', text: b.caption }, ...b.rows.flatMap((r) => r.cells.map((c) => ({ id: c.id, kind: 'tableCell' as const, text: c.text })))]
        }
      }),
    ]),
  ]
}

export function findEditable(report: Report, id: string): Editable | undefined {
  return editables(report).find((e) => e.id === id)
}

/** 前後の編集箇所（↑↓での移動用）。表紙の項目と表のセルは移動の対象にしない */
export function neighbor(report: Report, id: string, direction: 'prev' | 'next'): Editable | undefined {
  const list = editables(report).filter((e) => e.kind !== 'field' && e.kind !== 'tableCell')
  const i = list.findIndex((e) => e.id === id)
  return i < 0 ? undefined : list[direction === 'prev' ? i - 1 : i + 1]
}

// ---- 書き換え ----

function mapBody(report: Report, fn: (block: BodyBlock) => BodyBlock | BodyBlock[]): Report {
  return { ...report, body: report.body.map((c) => ({ ...c, blocks: c.blocks.flatMap((b) => fn(b)) })) }
}

export function setText(report: Report, id: string, text: string): Report {
  if (id.startsWith(FIELD_PREFIX)) {
    const key = id.slice(FIELD_PREFIX.length) as EditableField
    if (!EDITABLE_FIELDS.includes(key)) return report
    const basicInfo: BasicInfo = { ...report.basicInfo, [key]: text.replace(/[\r\n]/g, '').trim() }
    return { ...report, basicInfo }
  }
  if (report.abstract.paragraphs.some((p) => p.id === id)) {
    // 抄録を書き始めたか（started）は、そのまま残す
    return { ...report, abstract: { ...report.abstract, paragraphs: report.abstract.paragraphs.map((p) => (p.id === id ? paragraph(id, text, undefined, p.hint) : p)) } }
  }
  const num = numbering(report)
  const withChapter = { ...report, body: report.body.map((c) => (c.id === id ? { ...c, title: text.replace(/[\r\n]/g, '') } : c)) }
  return mapBody(withChapter, (b): BodyBlock => {
    if (b.type === 'subheading' && b.id === id) return { ...b, title: text.replace(/[\r\n]/g, '') }
    if (b.type === 'paragraph' && b.id === id) return paragraph(id, text, num, b.hint)
    if (b.type === 'table' && b.id === id) return { ...b, caption: text.replace(/[\r\n]/g, '') }
    if (b.type === 'table' && b.rows.some((r) => r.cells.some((c) => c.id === id))) return setCellText(b, id, text.trim())
    if (b.type === 'figureRow' && b.figures.some((f) => f.id === id))
      return { ...b, figures: b.figures.map((f) => (f.id === id ? { ...f, caption: text.replace(/[\r\n]/g, '') } : f)) }
    return b
  })
}

export function setCourse(report: Report, courseId: string): Report {
  return { ...report, basicInfo: { ...report.basicInfo, courseId } }
}

// ---- 段落の分割・結合・貼り付け ----

/** Enter：段落を2つに分ける。見出しで Enter を押した場合は、その後ろに空の段落を作る */
export function split(report: Report, id: string, before: string, after: string): { report: Report; newId: string } {
  const created = newId('p')
  const abstract = report.abstract.paragraphs
  const ai = abstract.findIndex((p) => p.id === id)
  if (ai >= 0) {
    const paragraphs = [...abstract]
    paragraphs.splice(ai, 1, paragraph(id, withPeriod(before), undefined, abstract[ai].hint), paragraph(created, after))
    return { report: { ...report, abstract: { ...report.abstract, paragraphs } }, newId: created }
  }
  const num = numbering(report)
  if (report.body.some((c) => c.id === id)) {
    return {
      report: { ...report, body: report.body.map((c) => (c.id === id ? { ...c, title: before + after, blocks: [paragraph(created, ''), ...c.blocks] } : c)) },
      newId: created,
    }
  }
  // 図・表のタイトル：そのまとまり（表）の下に段落を作る
  const below = paragraphAfter(report, id, created)
  if (below) return below
  for (const chapter of report.body) {
    const i = chapter.blocks.findIndex((b) => b.id === id)
    const b = chapter.blocks[i]
    if (b?.type !== 'paragraph') continue
    // 段落のすぐ下に付いている図・表：分けた後ろの部分がそれを参照していなければ、前の部分に付けたままにする
    let end = i + 1
    while (end < chapter.blocks.length && isAttachment(chapter.blocks[end])) end++
    const attached = chapter.blocks.slice(i + 1, end)
    const labels = attached.flatMap((a) => (a.type === 'figureRow' ? a.figures.map((f) => `図${num.numbers.get(f.id)}`) : [`表${num.numbers.get(a.id)}`]))
    const keepWithBefore = attached.length > 0 && !labels.some((l) => after.includes(l))
    const blocks = [...chapter.blocks]
    // 分けた前の段落の終わりに「。」がなければ付ける（ひな形の説明は、前の段落に残す）
    const first = paragraph(b.id, withPeriod(before), num, b.hint)
    if (keepWithBefore) blocks.splice(i, end - i, first, ...attached, paragraph(created, after, num))
    else blocks.splice(i, 1, first, paragraph(created, after, num))
    return { report: { ...report, body: report.body.map((c) => (c === chapter ? { ...c, blocks } : c)) }, newId: created }
  }
  return {
    report: mapBody(report, (b) => (b.id === id && b.type === 'subheading' ? [{ ...b, title: before + after }, paragraph(created, '')] : b)),
    newId: created,
  }
}

/**
 * 図・表のすぐ後ろ（同じ章の中）に、空の段落を作る（図・表のタイトルで Enter・「＋ ここに続きを書く」。mockups/v32 ① 案A）。
 * id は図の ID か表の ID（表のタイトル）。図は、並んでいる図のまとまりの後ろに作る。図・表が見つからなければ null
 */
export function paragraphAfter(report: Report, id: string, created = newId('p')): { report: Report; newId: string } | null {
  const owner = report.body.flatMap((c) => c.blocks).find((b) => (b.type === 'figureRow' && b.figures.some((f) => f.id === id)) || (b.type === 'table' && b.id === id))
  if (!owner) return null
  return { report: mapBody(report, (b) => (b === owner ? [b, paragraph(created, '')] : b)), newId: created }
}

/**
 * 「＋ ここに続きを書く」：図・表・見出しのすぐ後ろに、空の段落を作る（mockups/v32 ① 案A）。
 * 図・表は paragraphAfter と同じ。小見出しは、そのすぐ後ろ。大見出し（章の ID）は、その章のいちばん初め。
 * どれでもなければ null
 */
export function paragraphBelow(report: Report, id: string, created = newId('p')): { report: Report; newId: string } | null {
  const below = paragraphAfter(report, id, created)
  if (below) return below
  if (report.body.some((c) => c.id === id)) {
    return { report: { ...report, body: report.body.map((c) => (c.id === id ? { ...c, blocks: [paragraph(created, ''), ...c.blocks] } : c)) }, newId: created }
  }
  const heading = report.body.flatMap((c) => c.blocks).find((b) => b.type === 'subheading' && b.id === id)
  if (!heading) return null
  return { report: mapBody(report, (b) => (b === heading ? [b, paragraph(created, '')] : b)), newId: created }
}

/**
 * 見出し（大見出しは章の ID、小見出しはその ID）のすぐ後ろにある、何も書いていない段落（ひな形の説明もない）の ID。なければ null。
 * 見出しで Enter を押したとき、その段落があれば、新しい段落を作らずにそこへ移る（「大見出し」を足すと付いてくる空の段落を、
 * もう1つ増やして、空のまま残さないように）
 */
export function blankParagraphAfterHeading(report: Report, id: string): string | null {
  const chapter = report.body.find((c) => c.id === id)
  if (chapter) {
    const first = chapter.blocks[0]
    return first?.type === 'paragraph' && isBlankParagraph(report, first.id) ? first.id : null
  }
  for (const c of report.body) {
    const i = c.blocks.findIndex((b) => b.id === id && b.type === 'subheading')
    if (i < 0) continue
    const next = c.blocks[i + 1]
    return next?.type === 'paragraph' && isBlankParagraph(report, next.id) ? next.id : null
  }
  return null
}

/** 見出し（大見出しは章の ID、小見出しはその ID）が、その章のいちばん最後か（大見出しは、章の中に何もないとき） */
export function headingEndsChapter(report: Report, id: string): boolean {
  const chapter = report.body.find((c) => c.id === id)
  if (chapter) return chapter.blocks.length === 0
  return report.body.some((c) => c.blocks.at(-1)?.type === 'subheading' && c.blocks.at(-1)?.id === id)
}

/** 段落の先頭で Backspace：前の段落とつなげる。前が段落でなければ null */
export function mergeBackward(report: Report, id: string, text: string): { report: Report; targetId: string; caret: number } | null {
  const num = numbering(report)
  const abstract = report.abstract.paragraphs
  const ai = abstract.findIndex((p) => p.id === id)
  if (ai > 0) {
    const prev = abstract[ai - 1]
    const prevText = contentToText(prev.content, num)
    const paragraphs = [...abstract]
    paragraphs.splice(ai - 1, 2, paragraph(prev.id, prevText + text, undefined, prev.hint))
    return { report: { ...report, abstract: { ...report.abstract, paragraphs } }, targetId: prev.id, caret: prevText.length }
  }
  if (ai === 0) return null
  for (const c of report.body) {
    const i = c.blocks.findIndex((b) => b.id === id)
    if (i <= 0) continue
    const prev = c.blocks[i - 1]
    if (prev.type !== 'paragraph') return null
    const prevText = contentToText(prev.content, num)
    const blocks = [...c.blocks]
    blocks.splice(i - 1, 2, paragraph(prev.id, prevText + text, num, prev.hint))
    return { report: { ...report, body: report.body.map((x) => (x === c ? { ...c, blocks } : x)) }, targetId: prev.id, caret: prevText.length }
  }
  return null
}

/** 複数行の貼り付け：1行目で今の段落を置き換え、残りを新しい段落として後ろに入れる */
export function replaceWithParagraphs(report: Report, id: string, texts: string[]): { report: Report; lastId: string } {
  const ids = texts.map((_, i) => (i === 0 ? id : newId('p')))
  const lastId = ids[ids.length - 1]
  if (report.abstract.paragraphs.some((p) => p.id === id)) {
    const paragraphs = report.abstract.paragraphs.flatMap((p) => (p.id === id ? texts.map((t, i) => paragraph(ids[i], t, undefined, i === 0 ? p.hint : undefined)) : [p]))
    return { report: { ...report, abstract: { ...report.abstract, paragraphs } }, lastId }
  }
  const num = numbering(report)
  return {
    report: mapBody(report, (b) => (b.id === id && b.type === 'paragraph' ? texts.map((t, i) => paragraph(ids[i], t, num, i === 0 ? b.hint : undefined)) : b)),
    lastId,
  }
}

// ---- ブロックの追加・削除 ----

/** ID からブロックの位置を探す（図の ID・表のセルの ID でもよい） */
function blockIndex(chapter: Chapter, id: string): number {
  return chapter.blocks.findIndex(
    (b) =>
      b.id === id ||
      (b.type === 'figureRow' && b.figures.some((f) => f.id === id)) ||
      (b.type === 'table' && b.rows.some((r) => r.cells.some((c) => c.id === id))),
  )
}

/** 表のタイトル・セルの ID から、その表を探す */
export function findTable(report: Report, id: string): TableBlock | null {
  for (const b of report.body.flatMap((c) => c.blocks)) {
    if (b.type === 'table' && (b.id === id || b.rows.some((r) => r.cells.some((c) => c.id === id)))) return b
  }
  return null
}

/** 表を書き換える */
export function updateTable(report: Report, tableId: string, fn: (table: TableBlock) => TableBlock): Report {
  return mapBody(report, (b) => (b.type === 'table' && b.id === tableId ? fn(b) : b))
}

/** 指定した位置の後ろに本文のブロックを入れる。章の ID なら章の先頭、見つからなければ最後の章の末尾 */
export function insertAfter(report: Report, afterId: string | null, block: BodyBlock): Report {
  if (afterId && report.body.some((c) => c.id === afterId)) {
    return { ...report, body: report.body.map((c) => (c.id === afterId ? { ...c, blocks: [block, ...c.blocks] } : c)) }
  }
  const containing = afterId ? report.body.find((c) => blockIndex(c, afterId) >= 0) : undefined
  const target = containing ?? report.body[report.body.length - 1]
  return {
    ...report,
    body: report.body.map((c) => {
      if (c !== target) return c
      const blocks = [...c.blocks]
      blocks.splice(containing ? blockIndex(c, afterId!) + 1 : blocks.length, 0, block)
      return { ...c, blocks }
    }),
  }
}

/** 本文の章・ブロック（図の ID・表のセルの ID でもよい）か（段落などを足す位置の目印になるか） */
export function inBody(report: Report, id: string): boolean {
  return report.body.some((c) => c.id === id || blockIndex(c, id) >= 0)
}

/** 本文の段落に、まだ何も書いていない（文字も図表の参照もない）か */
export function paragraphEmpty(report: Report, id: string): boolean {
  const p = findParagraph(report, id)
  return !!p && !contentToText(p.content, numbering(report)).trim()
}

/**
 * 何も書いていない、ひな形の説明もない段落か（Enter を押して何も書かなかったときなどにできる段落）。
 * 小見出し・図・表をそこで入れるときは、その段落と置き換える（空の段落を残さない）。セルフチェックの「直す」でも消せる
 */
export function isBlankParagraph(report: Report, id: string): boolean {
  return paragraphEmpty(report, id) && !findParagraph(report, id)?.hint
}

/** 本文のブロック id を、block に置き換える（同じ位置に入る） */
export function replaceBlock(report: Report, id: string, block: BodyBlock): Report {
  return mapBody(report, (b) => (b.id === id ? block : b))
}

/** 大見出し（章）を指定した章の後ろに追加する */
export function insertChapterAfter(report: Report, afterId: string | null, chapter: Chapter): Report {
  const i = afterId ? report.body.findIndex((c) => c.id === afterId || blockIndex(c, afterId) >= 0) : -1
  const body = [...report.body]
  body.splice(i >= 0 ? i + 1 : body.length, 0, chapter)
  return { ...report, body }
}

/**
 * ブロックを削除する。図の ID を渡すと、その図だけを除く（並びが空になれば並びごと消す）。
 * 抄録の段落も消せる（最後の1段落は残す）。
 */
export function removeBlock(report: Report, id: string): Report {
  const abstract = report.abstract.paragraphs
  if (abstract.some((p) => p.id === id)) {
    return abstract.length > 1 ? { ...report, abstract: { paragraphs: abstract.filter((p) => p.id !== id) } } : report
  }
  return mapBody(report, (b) => {
    if (b.id === id) return []
    if (b.type === 'figureRow' && b.figures.some((f) => f.id === id)) {
      const figures = b.figures.filter((f) => f.id !== id)
      return figures.length ? { ...b, figures } : []
    }
    return b
  })
}

/** 章を削除する（中のブロックごと） */
export function removeChapter(report: Report, id: string): Report {
  return { ...report, body: report.body.filter((c) => c.id !== id) }
}

// ---- 図を入れる（書いている文の終わりに（図n）を入れ、段落の下に図を置く） ----

/** 段落を探す（本文） */
function findParagraph(report: Report, id: string): ParagraphBlock | undefined {
  for (const chapter of report.body) {
    const b = chapter.blocks.find((x) => x.id === id)
    if (b?.type === 'paragraph') return b
  }
  return undefined
}

/**
 * 段落の文字位置 offset（いまの番号での表示の文字数。書いているカーソルの位置）のある文の終わりに、図表への参照「（図n）」を入れる。
 * 「〜（図n）。」となるよう、文末の「。」の前に入れる（手順書の書き方）。
 * - 文末の「。」の直後なら、その文（「。」の前）に入れる
 * - 文の途中なら、その文の「。」の前に入れる（前はカーソルの位置に入れていたため、「確かめ（図2）、汚れや…」と文の途中に入っていた）
 * - 後ろに「。」がなければ段落の終わりに入れ、後ろに「。」を付ける
 */
export function insertRef(report: Report, paragraphId: string, offset: number, targetId: string): Report {
  const paragraph = findParagraph(report, paragraphId)
  if (!paragraph) return report
  const num = numbering(report)
  const full = contentToText(paragraph.content, num)
  const caret = Math.max(0, Math.min(offset, full.length))
  const period = full.indexOf('。', caret)
  const at = full[caret - 1] === '。' ? caret - 1 : period >= 0 ? period : full.length
  const ref: InlineNode = { type: 'ref', targetId, withParens: true }
  const content: InlineNode[] = []
  let pos = 0
  let placed = false
  for (const node of paragraph.content) {
    const length = contentToText([node], num).length
    if (!placed && node.type === 'text' && at <= pos + length) {
      const cut = at - pos
      if (cut > 0) content.push({ type: 'text', text: node.text.slice(0, cut) })
      content.push(ref)
      if (cut < node.text.length) content.push({ type: 'text', text: node.text.slice(cut) })
      placed = true
    } else {
      content.push(node)
      // 参照の途中を指していたら、その参照の後ろに入れる
      if (!placed && node.type === 'ref' && at < pos + length && at > pos) {
        content.push(ref)
        placed = true
      }
    }
    pos += length
  }
  if (!placed) content.push(ref)
  // 段落の終わり（「。」のない文末）に入れたときは、後ろに「。」を付ける
  if (content[content.length - 1] === ref) content.push({ type: 'text', text: '。' })
  return mapBody(report, (b) => (b.id === paragraphId ? { ...paragraph, content } : b))
}

/**
 * 段落のすぐ下に図を置く。段落のすぐ下にすでに図のまとまりがあれば、そこに加える。
 * まとまりの中の図は、段落の中で参照している順に並べ直す（参照していない図はそのままの位置）
 */
export function addFigureBelow(report: Report, paragraphId: string, figure: Figure): Report {
  return {
    ...report,
    body: report.body.map((chapter) => {
      const i = chapter.blocks.findIndex((b) => b.id === paragraphId)
      if (i < 0) return chapter
      const paragraph = chapter.blocks[i] as ParagraphBlock
      const next = chapter.blocks[i + 1]
      const blocks = [...chapter.blocks]
      if (next?.type === 'figureRow') blocks[i + 1] = { ...next, figures: orderByRefs([...next.figures, figure], paragraph) }
      else blocks.splice(i + 1, 0, { type: 'figureRow', id: newId('r'), figures: [figure] })
      return { ...chapter, blocks }
    }),
  }
}

/** 表を、段落のすぐ下に入れる（その段落の下にすでに図・表があれば、その後ろ） */
export function addTableBelow(report: Report, paragraphId: string, table: BodyBlock): Report {
  return {
    ...report,
    body: report.body.map((chapter) => {
      const i = chapter.blocks.findIndex((b) => b.id === paragraphId)
      if (i < 0) return chapter
      let at = i + 1
      while (at < chapter.blocks.length && isAttachment(chapter.blocks[at])) at++
      const blocks = [...chapter.blocks]
      blocks.splice(at, 0, table)
      return { ...chapter, blocks }
    }),
  }
}

/** 段落のすぐ下に付く図・表 */
function isAttachment(b: BodyBlock | undefined): boolean {
  return b?.type === 'figureRow' || b?.type === 'table'
}

/** 図のまとまりの中の、ある図のすぐ後ろに図を加える（「もう1枚」） */
export function addFigureAfter(report: Report, figureId: string, figure: Figure): Report {
  return mapBody(report, (b) => {
    if (b.type !== 'figureRow') return b
    const i = b.figures.findIndex((f) => f.id === figureId)
    if (i < 0) return b
    return { ...b, figures: [...b.figures.slice(0, i + 1), figure, ...b.figures.slice(i + 1)] }
  })
}

/** 段落の中で、ある図表への参照のすぐ後ろに別の参照を入れる。その参照がなければ何もしない */
export function insertRefAfterRef(report: Report, afterTargetId: string, targetId: string): Report {
  for (const chapter of report.body) {
    for (const b of chapter.blocks) {
      if (b.type !== 'paragraph') continue
      const i = b.content.findIndex((n) => n.type === 'ref' && n.targetId === afterTargetId)
      if (i < 0) continue
      const content = [...b.content.slice(0, i + 1), { type: 'ref' as const, targetId, withParens: true }, ...b.content.slice(i + 1)]
      return mapBody(report, (x) => (x.id === b.id ? { ...b, content } : x))
    }
  }
  return report
}

function orderByRefs(figures: Figure[], paragraph: ParagraphBlock): Figure[] {
  const order = (id: string) => paragraph.content.findIndex((n) => n.type === 'ref' && n.targetId === id)
  const slots = figures.map((f, i) => (order(f.id) >= 0 ? i : -1)).filter((i) => i >= 0)
  const sorted = slots.map((i) => figures[i]).sort((a, b) => order(a.id) - order(b.id))
  const result = [...figures]
  slots.forEach((slot, k) => (result[slot] = sorted[k]))
  return result
}

/**
 * 図を消す。本文のその図への参照は、文末などの「（図n）」なら一緒に消す。
 * 文の中で使っている参照（「図1に示す」など）は「図?」の文字にして残す（消すと「〜をに示す」と文が崩れるため。チェックで指摘される）
 */
export function removeFigure(report: Report, figureId: string): Report {
  return withoutRefsTo(removeBlock(report, figureId), figureId, '図')
}

/** 表を消す。本文のその表への参照は、図と同じく「（表n）」なら消し、文の中の参照は「表?」の文字にして残す */
export function removeTable(report: Report, tableId: string): Report {
  return withoutRefsTo(removeBlock(report, tableId), tableId, '表')
}

/** 並んだ文字の部分を1つにまとめる（参照を抜いたあとなど）。空になったら空の文字を1つ置く */
function mergeTexts(content: InlineNode[]): InlineNode[] {
  const merged: InlineNode[] = []
  for (const n of content) {
    const last = merged[merged.length - 1]
    if (n.type === 'text' && last?.type === 'text') merged[merged.length - 1] = { type: 'text', text: last.text + n.text }
    else if (n.type !== 'text' || n.text) merged.push(n)
  }
  return merged.length ? merged : [{ type: 'text', text: '' }]
}

/**
 * 括弧付きの参照「（図1）」が、文の中ではなく、文末などに添えてあるだけか（消しても文が崩れないか）。
 * すぐ後ろが段落の終わり・句読点・閉じ括弧・別の参照なら添えてあるだけ。「（図1）に示す」のように後ろに言葉が続けば、文の中で使っている
 */
export function parenthetical(content: InlineNode[], index: number): boolean {
  const node = content[index]
  if (node?.type !== 'ref' || !node.withParens) return false
  const next = content.slice(index + 1).find((n) => n.type === 'ref' || n.text !== '')
  return !next || next.type === 'ref' || /^[。、，．,.！？!?」』）)\s　]/.test(next.text)
}

/**
 * 本文から、消した図・表への参照を除く。添えてあるだけの「（図n）」は括弧ごと消し、
 * 文の中で使っている参照は「図?」（「（図?）」）の文字にして残す（kind：図か表か。消したあとは番号から分からないため）
 */
function withoutRefsTo(report: Report, targetId: string, kind: '図' | '表'): Report {
  return mapBody(report, (b) => {
    if (b.type !== 'paragraph' || !b.content.some((n) => n.type === 'ref' && n.targetId === targetId)) return b
    const content = b.content.flatMap((n, i): InlineNode[] => {
      if (n.type !== 'ref' || n.targetId !== targetId) return [n]
      if (parenthetical(b.content, i)) return []
      return [{ type: 'text', text: n.withParens ? `（${kind}?）` : `${kind}?` }]
    })
    return { ...b, content: mergeTexts(content) }
  })
}

/** 手で書いた図表の番号（「図1」「（表１）」など。数字は全角でもよい） */
const WRITTEN_REF = /[（(]\s*([図表])\s*([0-9０-９]+)\s*[）)]|(?<![㐀-鿿々])([図表])([0-9０-９]+)/g

/**
 * 段落の中に、その図表の番号を手で書いていれば（「図1に示す」）、その番号を図表へのリンクにし、
 * 「図を入れる」「表を入れる」で自動で入れた（図n）は除く（「図1に示す（図1）。」と二重にならないように）。
 * 手で書いた番号がなければ null（自動で入れた（図n）のまま）
 */
export function linkWrittenRef(report: Report, paragraphId: string, targetId: string): Report | null {
  const paragraph = findParagraph(report, paragraphId)
  const num = numbering(report)
  const n = num.numbers.get(targetId)
  if (!paragraph || n === undefined) return null
  const kind = num.tableIds.has(targetId) ? '表' : '図'
  const content: InlineNode[] = []
  let linked = false
  for (const node of paragraph.content) {
    if (linked || node.type !== 'text') {
      content.push(node)
      continue
    }
    const m = [...node.text.matchAll(WRITTEN_REF)].find((x) => (x[1] ?? x[3]) === kind && Number((x[2] ?? x[4]).normalize('NFKC')) === n)
    if (!m) {
      content.push(node)
      continue
    }
    content.push({ type: 'text', text: node.text.slice(0, m.index) }, { type: 'ref', targetId, withParens: m[1] !== undefined }, { type: 'text', text: node.text.slice(m.index + m[0].length) })
    linked = true
  }
  if (!linked) return null
  // 自動で入れた（図n）を除く（手で書いた番号の方を残す）
  const kept = content.filter((x, i) => !(x.type === 'ref' && x.targetId === targetId && x.withParens && paragraph.content.includes(x) && parenthetical(content, i)))
  return mapBody(report, (b) => (b.id === paragraphId ? { ...paragraph, content: mergeTexts(kept) } : b))
}

/**
 * 「直す」で、手で書いた図表の番号（段落の文字位置 start から end）を、replacement（「表1」「（表1）」）にして図表へつなげる。
 * 同じ段落に、その図表への（図n）（自動で入れたもの）がほかにもあれば、二重になるので除く（「表1に示す（表1）。」→「表1に示す。」）
 */
export function linkManualRef(report: Report, paragraphId: string, start: number, end: number, replacement: string): Report {
  const text = findEditable(report, paragraphId)?.text
  if (text === undefined) return report
  const next = setText(report, paragraphId, text.slice(0, start) + replacement + text.slice(end))
  const paragraph = findParagraph(next, paragraphId)
  if (!paragraph) return next
  const num = numbering(next)
  // つなげた参照（start の位置にある参照）
  let pos = 0
  let linked: InlineNode | undefined
  for (const node of paragraph.content) {
    if (node.type === 'ref' && pos === start) linked = node
    pos += contentToText([node], num).length
  }
  if (linked?.type !== 'ref') return next
  const targetId = linked.targetId
  const content = paragraph.content.filter((x, i) => x === linked || !(x.type === 'ref' && x.targetId === targetId && parenthetical(paragraph.content, i)))
  if (content.length === paragraph.content.length) return next
  return mapBody(next, (b) => (b.id === paragraphId ? { ...paragraph, content: mergeTexts(content) } : b))
}
