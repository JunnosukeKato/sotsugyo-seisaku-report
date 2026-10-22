import { courseIdInText, findCourse, type YearConfig } from '../config'
import { newId, normalizeParagraph, numbering, setCourse, textToContent, type Numbering } from '../editor/reportOps'
import { chapterLabel, subheadingLabel } from '../layout/bodyHtml'
import type { StoredImage } from '../model/storage'
import { abstractEmpty, abstractHint, bodyFromTemplate, courseTemplate, emptyParagraph } from '../model/template'
import { headingFromText, type HeadingText } from '../model/headingText'
import type { BodyBlock, Chapter, ParagraphBlock, Report, TableBlock, TableRow } from '../model/types'
import type { FigurePreview, ImportProblem, OutlineItem, TablePreview, WordFiles, WordImportResult } from './types'
import { documentContext, readDocument, type ImageRef, type TextBox, type WordBlock, type WordTable } from './wordDocument'
import { browserReadable, imageFingerprint, imageInfo, KIND_NAMES, prepareImage, TEMPLATE_IMAGE_FINGERPRINTS } from './wordImages'
import { openWordFile, WordImportError, type WordPackage } from './wordPackage'

export { WordImportError } from './wordPackage'

/**
 * 今年度だけ：学科の Word のひな形（04_本文.docx・01_表紙.docx）で書き始めた分を、ツールの原稿の形にする（mockups/v24）。
 *
 * - 写すもの：見出し・段落・図（写真とタイトル）・表、表紙の学籍番号・氏名・サブタイトル
 * - Word の見た目（文字の大きさ・位置・太字・改ページなど）は写さず、ツールの決まった形で組む
 * - Word でまだ書いていない章（「〇〇〇〇」「～～～」のままの章）は写さず、ツールのコースのひな形の章で続ける
 *   （Word で書いた章と、ひな形の章を、ひな形の順に1つの並びにする：chapterOrder）
 * - 読み取りは学生のブラウザの中だけで行う（どこにも送らない）
 *
 * 読めないファイル（.doc・Word でないもの・壊れたもの）は WordImportError（message は学生に分かる言葉）。
 * 読めたが、うまく読み取れなかったところは problems に入れる（確認の窓で知らせる）。
 */

// ---- 文字の道具 ----

/** 本文の中の図表の参照（「（図1）」「図1」「（表１）」など） */
const REF_RE = /[（(][\s　]*[図表][\s　]*[0-9０-９]+[\s　]*[）)]|[図表][\s　]*[0-9０-９]+/g
/** 仮の文字（ひな形の「～～～」「〇〇〇〇」「●●●」） */
const PLACEHOLDER_CHAR = /[～〜~〇○●◯…‥]/
const PLACEHOLDER_RUN = /[～〜~]{2,}|[〇○●◯]{2,}|[…‥]+/g
/** 仮の文字だけの行かを見るときに、無視する記号 */
const IGNORABLE = /[\s　。、．，,.・「」『』（）()：:]/g

/** NFKC にし、空白を除く（見出しの名前を比べるため） */
const comparable = (s: string) => s.normalize('NFKC').replace(/\s/g, '')

/** 仮の文字だけの行（「～～～（図1）。」「〇〇〇〇」など）。空の行は含めない */
export function isPlaceholderOnly(text: string): boolean {
  const core = text.replace(REF_RE, '').replace(IGNORABLE, '')
  return core.length > 0 && [...core].every((c) => PLACEHOLDER_CHAR.test(c))
}

/** 仮の文字・参照・記号を除いた中身 */
const coreText = (text: string) => text.replace(REF_RE, '').replace(PLACEHOLDER_RUN, '').replace(IGNORABLE, '')

/** ひな形にもとから書いてある文（これだけの段落は、書いたことにしない） */
const TEMPLATE_PHRASES = new Set(['筆者が担当したのは、', '表1に使用した素材をまとめる。'].map(coreText))

/**
 * 学科の Word のひな形（04_本文.docx・03_目次.docx）にもとからある見出し。これだけの章・小見出しは、書いたことにしない。
 * コースのひな形（管理ページで決める）がないコースや、ひな形の見出しの名前が Word と違うコースでも、同じに見分けるため、
 * コースのひな形の見出しとは別に持つ
 */
const WORD_TEMPLATE_CHAPTERS = ['企画・立案', '制作過程', 'まとめ']
const WORD_TEMPLATE_SUBHEADINGS = ['担当衣装のキャラクター', 'デザイン説明', '使用素材']

/** 学生が書いた文か（仮の文字・ひな形にもとからある文だけではない） */
export function isWriting(text: string): boolean {
  const core = coreText(text)
  return core.length > 0 && !TEMPLATE_PHRASES.has(core)
}

/** 参照の番号の全角数字を半角にする（「（図１）」も図へのつながりにするため） */
const halfDigitsInRefs = (text: string) => text.replace(/([図表][\s　]*)([０-９]+)/g, (_, head: string, digits: string) => head + digits.normalize('NFKC'))

// ---- 見出し ----

// 行の頭のローマ数字で見出しを見分ける部品（headingFromText）は、段落に見出しの形で打ったときにも使うので、model/headingText.ts に置く

/** 見出しのスタイルの段落から、手で打った番号（Ⅰ．1．第1章 (1) ① など）を除く */
function stripHeadingNumber(text: string): string {
  const t = text.replace(/[\n\t]/g, '').trim()
  const fromRoman = headingFromText(t)
  if (fromRoman) return fromRoman.title
  return t.replace(/^(第?[0-9０-９一二三四五六七八九十]+[章節]?[．.、]?|[（(][0-9０-９ⅰ-ⅻivx]+[)）]|[①-⑳])[\s　]*/, '').trim()
}

/** 見出しの形でないが、見出しのつもりらしい行（「2. パターン」「第1章」「（1）」など） */
function looksLikeHeading(text: string): boolean {
  const t = text.trim()
  return (
    t.length <= 30 &&
    !/[。！？]$/.test(t) &&
    /^([0-9０-９]{1,2}[\s　]*[.．、)）]|第[0-9０-９一二三四五六七八九十]+[章節]|[（(][0-9０-９一二三四五六七八九十]{1,2}[)）]|[①-⑳]|[A-ZＡ-Ｚa-z][.．)）])[\s　]*\S/.test(t)
  )
}

// ---- 図・表のタイトル ----

interface Caption {
  kind: '図' | '表'
  /** Word に書いてあった番号 */
  number: number
  /** 名前（「デザイン画」）。仮の文字だけなら空 */
  name: string
  centerX: number | null
  xFrom: string | null
}

function parseOneCaption(s: string): Caption | null {
  const m = /^([図表])[\s　]*([0-9０-９]+)([\s　]*[.．:：、,，\-－‐]?[\s　]*)(.*)$/s.exec(s.trim())
  if (!m) return null
  const name = m[4].trim()
  // 「図1に示す…。」のような文はタイトルではない
  if (/。$/.test(name) || name.length > 40) return null
  if (!m[3] && /^[はにのをでがともへやよ、。，,）)]/.test(name)) return null
  return { kind: m[1] as '図' | '表', number: Number(m[2].normalize('NFKC')), name: isPlaceholderOnly(name) ? '' : name, centerX: null, xFrom: null }
}

/** 1行が図・表のタイトル（「図1 デザイン画」。2つ並んだ「図2 前 図3 後ろ」も）なら、そのタイトル */
export function parseCaptionLine(line: string): Caption[] | null {
  const t = line.replace(/\t/g, '　').trim()
  if (!/^[図表]/.test(t)) return null
  const parts = t.split(/[\s　]+(?=[図表][\s　]*[0-9０-９]+(?![0-9０-９]))/)
  const captions = parts.map(parseOneCaption)
  return captions.every((c): c is Caption => c !== null) ? captions : null
}

/** 文字の枠の中の行を、タイトルとそれ以外に分ける（「図1」と名前が2行に分かれていたら1つにする） */
function boxCaptions(box: TextBox): { captions: Caption[]; others: string[] } {
  const lines = box.lines.map((l) => l.replace(/\t/g, '　').replace(/\n/g, '').trim()).filter(Boolean)
  const captions: Caption[] = []
  const others: string[] = []
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    if (/^[図表][\s　]*[0-9０-９]+$/.test(line) && lines[i + 1] && !parseCaptionLine(lines[i + 1])) line = `${line}　${lines[++i]}`
    const found = parseCaptionLine(line)
    if (found) captions.push(...found.map((c) => ({ ...c, centerX: box.centerX, xFrom: box.xFrom })))
    else if (!isPlaceholderOnly(line)) others.push(line)
  }
  return { captions, others }
}

// ---- 1回目：段落と表の並びを、見出し・段落・図のまとまり・表にする ----

interface Group {
  images: ImageRef[]
  captions: Caption[]
}

interface DraftCell {
  text: string
  image: ImageRef | null
  /** 2枚目からの画像（写さない） */
  extraImages: number
}

interface DraftTable {
  rows: DraftCell[][]
  caption: Caption | null
  merged: boolean
  /** Word で行を高くしてあった表（素材表の、写真を入れる枠など）。ツールの行の高さ「写真が入る高さ」にする */
  tallRows: boolean
}

/**
 * Word の行の高さが、この高さ（twip）以上なら「高い行」（約25mm。映画・舞台衣装デザイナーコースの Word の素材表の行は 1904〜2062twip）。
 * 1行目（見出しの行）のほかの行の半分以上が高い行の表は、行の高さを「写真が入る高さ」にする（Word の枠のまま移る）
 */
const TALL_ROW_TWIP = 1400

function hasTallRows(table: WordTable): boolean {
  const body = (table.rowHeights ?? []).slice(1)
  return body.length > 0 && body.filter((h) => h !== null && h >= TALL_ROW_TWIP).length * 2 >= body.length
}

type Event =
  | { k: 'chapter'; title: string }
  | { k: 'sub'; title: string }
  | { k: 'para'; text: string; headingLike: boolean }
  /** 仮の文字だけで、写さない行 */
  | { k: 'skip' }
  | { k: 'group'; group: Group }
  | { k: 'table'; table: DraftTable }
  /** 文字の枠の中の、タイトルでない文（写さない） */
  | { k: 'boxText'; text: string }
  | { k: 'notes'; count: number }
  /** 表が見つからなかった表のタイトル */
  | { k: 'lostTableCaption'; caption: Caption }

/** セルの文字：行ごとに前後の空白を除き、空の行を除く */
function cellText(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/\t/g, '　').trim())
    .filter(Boolean)
    .join('\n')
}

/** 図を並べるための表（画像と図のタイトルだけの表）か */
function isFigureTable(table: WordTable): boolean {
  const cells = table.rows.flat()
  if (!cells.some((c) => c.images.length > 0)) return false
  return cells.every((c) => cellText(c.text).split('\n').every((line) => !line || isPlaceholderOnly(line) || parseCaptionLine(line)?.every((cap) => cap.kind === '図')))
}

function draftTable(table: WordTable): DraftTable {
  let merged = false
  let rows: DraftCell[][] = table.rows.map((row) =>
    row.flatMap((cell) => {
      if (cell.span > 1 || cell.mergedUp) merged = true
      const first: DraftCell = cell.mergedUp
        ? { text: '', image: null, extraImages: 0 }
        : { text: cellText(cell.text), image: cell.images[0] ?? null, extraImages: Math.max(0, cell.images.length - 1) }
      return [first, ...Array.from({ length: cell.span - 1 }, () => ({ text: '', image: null, extraImages: 0 }))]
    }),
  )
  rows = rows.filter((r) => r.length > 0)
  const columns = Math.max(1, ...rows.map((r) => r.length))
  rows = rows.map((r) => [...r, ...Array.from({ length: columns - r.length }, () => ({ text: '', image: null, extraImages: 0 }))])
  // 1行目がタイトルだけ（「表1 使用材料表」を表の中に書いた）なら、タイトルにする
  let caption: Caption | null = null
  const filled = rows[0]?.filter((c) => c.text || c.image) ?? []
  if (rows.length >= 2 && filled.length === 1 && !filled[0].image) {
    const found = parseCaptionLine(filled[0].text.replace(/\n/g, '　'))
    if (found?.length === 1 && found[0].kind === '表') {
      caption = found[0]
      rows = rows.slice(1)
    }
  }
  // 空の行（見出しの行より下の、文字も画像もない行）は写さない。1行は残す
  const [head, ...data] = rows
  const used = data.filter((r) => r.some((c) => c.text || c.image))
  rows = head ? [head, ...(used.length ? used : data.slice(0, 1))] : []
  if (rows.length === 1) rows.push(Array.from({ length: columns }, () => ({ text: '', image: null, extraImages: 0 })))
  return { rows, caption, merged, tallRows: hasTallRows(table) }
}

/** 手で入れた改行（w:br）で分かれた行を、段落にする。改行は続けてつなぐが、文の終わりの後に字下げで始まる行は、新しい段落にする */
function joinLines(lines: string[]): string[] {
  const paragraphs: string[] = []
  let current = ''
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '　')
    if (!current.trim()) {
      current = line
      continue
    }
    if (/^[\s　]/.test(line) && line.trim() && /[。！？」）]$/.test(current.trim())) {
      paragraphs.push(current)
      current = line
      continue
    }
    // 英数字どうしがつながるときは、半角の空白をはさむ
    current = /[A-Za-z0-9]$/.test(current) && /^[A-Za-z0-9]/.test(line) ? `${current} ${line}` : current + line
  }
  if (current.trim()) paragraphs.push(current)
  return paragraphs
}

/** コースのひな形の、大見出し・小見出しの名前（比べる形） */
interface KnownHeadings {
  chapters: Set<string>
  subheadings: Set<string>
}

/**
 * 番号が「Ⅰ．」の形でない（「1．企画・立案」「第1章 企画・立案」）か、番号のない短い行でも、
 * 名前がコースのひな形の大見出し・小見出しと同じなら、その見出しとみなす
 */
function knownHeading(line: string, known: KnownHeadings): HeadingText | null {
  const title = stripHeadingNumber(line)
  const key = comparable(title)
  if (!key) return null
  if (known.chapters.has(key)) return { level: 1, title }
  if (known.subheadings.has(key)) return { level: 2, title }
  return null
}

function classify(blocks: WordBlock[], known: KnownHeadings): Event[] {
  const events: Event[] = []
  let group: Group | null = null
  /** 表の前に見つかった表のタイトル（次の表のタイトルにする） */
  let pendingTableCaptions: Caption[] = []
  /** タイトルがまだない表（すぐ後ろにタイトルがあれば、それにする） */
  let awaiting: DraftTable | null = null

  const openGroup = () => (group ??= { images: [], captions: [] })
  const closeGroup = () => {
    if (group && (group.images.length || group.captions.length)) events.push({ k: 'group', group })
    group = null
  }
  const loseTableCaptions = () => {
    for (const caption of pendingTableCaptions) events.push({ k: 'lostTableCaption', caption })
    pendingTableCaptions = []
  }
  const addCaption = (caption: Caption) => {
    if (caption.kind === '図') openGroup().captions.push(caption)
    else if (awaiting) {
      awaiting.caption = caption
      awaiting = null
    } else pendingTableCaptions.push(caption)
  }
  const addFigures = (images: ImageRef[], boxes: TextBox[]) => {
    for (const image of images) openGroup().images.push(image)
    for (const box of boxes) {
      const { captions, others } = boxCaptions(box)
      captions.forEach(addCaption)
      for (const image of box.images) openGroup().images.push(image)
      for (const text of others) events.push({ k: 'boxText', text })
    }
  }

  for (const block of blocks) {
    if (block.type === 'table') {
      if (isFigureTable(block)) {
        // 画像と図のタイトルを表に並べただけのもの：図にする（行ごとに左から）
        for (const cell of block.rows.flat()) {
          for (const line of cellText(cell.text).split('\n')) parseCaptionLine(line)?.forEach(addCaption)
          for (const image of cell.images) openGroup().images.push(image)
        }
        continue
      }
      closeGroup()
      const table = draftTable(block)
      if (!table.caption) table.caption = pendingTableCaptions.pop() ?? null
      loseTableCaptions()
      awaiting = table.caption ? null : table
      events.push({ k: 'table', table })
      continue
    }

    const p = block
    const line = p.text.replace(/[\n\t]/g, '').trim()
    const short = line.length <= 40 && !/[。！？]$/.test(line)
    const headingText = headingFromText(p.text) ?? (short && !p.headingLevel ? knownHeading(line, known) : null)
    const level = headingText?.level ?? p.headingLevel ?? (p.romanLevel && short ? p.romanLevel : null)
    if (level && line) {
      closeGroup()
      loseTableCaptions()
      awaiting = null
      const title = headingText?.title ?? stripHeadingNumber(p.text)
      events.push(level === 1 ? { k: 'chapter', title } : { k: 'sub', title })
      addFigures(p.images, p.boxes)
      if (p.notes) events.push({ k: 'notes', count: p.notes })
      continue
    }

    // 段落の行のうち、図・表のタイトルの行は、段落として写さない
    const bodyLines: string[] = []
    const captions: Caption[] = []
    for (const line of (p.listPrefix + p.text).split('\n')) {
      const found = parseCaptionLine(line)
      if (found) captions.push(...found)
      else bodyLines.push(line)
    }
    const paragraphs = joinLines(bodyLines)
    if (paragraphs.length > 0) {
      // 文の段落：前の図のまとまりは閉じ、この段落の図は、この段落のすぐ下に置く
      closeGroup()
      for (const text of paragraphs) {
        if (isPlaceholderOnly(text)) events.push({ k: 'skip' })
        else events.push({ k: 'para', text, headingLike: !p.listPrefix && looksLikeHeading(text) })
      }
    }
    captions.forEach(addCaption)
    addFigures(p.images, p.boxes)
    if (paragraphs.length > 0) awaiting = null
    if (p.notes) events.push({ k: 'notes', count: p.notes })
  }
  closeGroup()
  loseTableCaptions()
  return events
}

// ---- 2回目：章・小見出しごとに分け、図の画像とタイトルを組にする ----

interface DraftFigure {
  image: ImageRef | null
  caption: Caption | null
}

type DraftBlock = { t: 'para'; text: string; headingLike: boolean } | { t: 'figs'; figures: DraftFigure[] } | { t: 'table'; table: DraftTable }

interface Section {
  /** 小見出し（章の最初の、小見出しより前の部分は null） */
  sub: string | null
  blocks: DraftBlock[]
  skipped: number
  boxTexts: string[]
  notes: number
  lostTableCaptions: Caption[]
  headingLike: string[]
}

interface DraftChapter {
  /** 大見出しより前の部分は null */
  title: string | null
  sections: Section[]
}

const newSection = (sub: string | null): Section => ({ sub, blocks: [], skipped: 0, boxTexts: [], notes: 0, lostTableCaptions: [], headingLike: [] })

/** 横に離れて並んだ、浮かせた図（位置で組にできる） */
function spreadOut(items: { centerX: number | null; xFrom: string | null }[]): boolean {
  if (items.some((i) => i.centerX === null)) return false
  if (new Set(items.map((i) => i.xFrom)).size > 1) return false
  const xs = items.map((i) => i.centerX as number).sort((a, b) => a - b)
  return xs.every((x, i) => i === 0 || x - xs[i - 1] >= 300000)
}

/** 図のまとまりの中で、画像とタイトルを組にする。組にならなかったタイトルを返す */
function pairGroup(group: Group): { figures: DraftFigure[]; leftover: Caption[] } {
  let images = [...group.images]
  const captions = [...group.captions]
  const assigned = new Map<ImageRef, Caption>()
  const leftover: Caption[] = []
  const positional =
    (images.length >= 2 || captions.length >= 2) && images.length > 0 && captions.length > 0 && spreadOut(images) && spreadOut(captions) && images[0].xFrom === captions[0].xFrom
  if (positional) {
    // 浮かせた画像とタイトルが横に並ぶ：横の位置の近いものを組にする（左から）
    images = images.sort((a, b) => (a.centerX as number) - (b.centerX as number))
    for (const caption of [...captions].sort((a, b) => (a.centerX as number) - (b.centerX as number))) {
      const free = images.filter((i) => !assigned.has(i))
      const nearest = free.sort((a, b) => Math.abs((a.centerX as number) - (caption.centerX as number)) - Math.abs((b.centerX as number) - (caption.centerX as number)))[0]
      if (nearest) assigned.set(nearest, caption)
      else leftover.push(caption)
    }
  } else {
    captions.forEach((caption, i) => (images[i] ? assigned.set(images[i], caption) : leftover.push(caption)))
  }
  const figures = images.map((image) => ({ image, caption: assigned.get(image) ?? null }))
  // タイトルの番号の順に並べる（タイトルのない図は、その位置のまま）
  const slots = figures.map((f, i) => (f.caption ? i : -1)).filter((i) => i >= 0)
  const sorted = slots.map((i) => figures[i]).sort((a, b) => (a.caption as Caption).number - (b.caption as Caption).number)
  slots.forEach((slot, k) => (figures[slot] = sorted[k]))
  return { figures, leftover }
}

function buildChapters(events: Event[]): DraftChapter[] {
  const chapters: DraftChapter[] = []
  const current = () => {
    if (chapters.length === 0) chapters.push({ title: null, sections: [newSection(null)] })
    const chapter = chapters[chapters.length - 1]
    return chapter.sections[chapter.sections.length - 1]
  }
  // 図のまとまりは、組にした後で並べるので、ひとまず位置だけを残す
  const groups = new Map<DraftBlock, Group>()
  for (const ev of events) {
    switch (ev.k) {
      case 'chapter':
        chapters.push({ title: ev.title, sections: [newSection(null)] })
        break
      case 'sub':
        current()
        chapters[chapters.length - 1].sections.push(newSection(ev.title))
        break
      case 'para':
        current().blocks.push({ t: 'para', text: ev.text, headingLike: ev.headingLike })
        if (ev.headingLike) current().headingLike.push(ev.text.trim())
        break
      case 'skip':
        current().skipped++
        break
      case 'group': {
        const block: DraftBlock = { t: 'figs', figures: [] }
        groups.set(block, ev.group)
        current().blocks.push(block)
        break
      }
      case 'table':
        current().blocks.push({ t: 'table', table: ev.table })
        break
      case 'boxText':
        current().boxTexts.push(ev.text)
        break
      case 'notes':
        current().notes += ev.count
        break
      case 'lostTableCaption':
        current().lostTableCaptions.push(ev.caption)
        break
    }
  }
  pairFigures(chapters, groups)
  return chapters
}

type FigureBlock = Extract<DraftBlock, { t: 'figs' }>

/**
 * 図の画像とタイトルを組にする。まず図のまとまりの中で組にし、組にならなかったタイトルは、同じ小見出しの中の
 * タイトルのない図のうち、番号の合う（前の図の番号の次になる）ものに付ける（浮かせた画像とタイトルの枠が、別の段落に付いていることがあるため）。
 * それでも残ったタイトルは、画像のない図（枠だけ）にする
 */
function pairFigures(chapters: DraftChapter[], groups: Map<DraftBlock, Group>) {
  const sections = chapters.flatMap((c) => c.sections)
  const figureBlocks = (section: Section) => section.blocks.filter((b): b is FigureBlock => b.t === 'figs')
  const leftovers: { caption: Caption; section: Section; at: number }[] = []
  for (const section of sections) {
    figureBlocks(section).forEach((block, at) => {
      const { figures, leftover } = pairGroup(groups.get(block) as Group)
      block.figures = figures
      for (const caption of leftover) leftovers.push({ caption, section, at })
    })
  }
  /** タイトルのない図の、前後から考えた番号（前の図の番号の次） */
  const expectedNumbers = () => {
    const expected = new Map<DraftFigure, number>()
    let last = 0
    for (const section of sections)
      for (const block of figureBlocks(section))
        for (const figure of block.figures) {
          last = figure.caption ? figure.caption.number : last + 1
          if (!figure.caption) expected.set(figure, last)
        }
    return expected
  }
  for (const { caption, section, at } of leftovers) {
    const expected = expectedNumbers()
    const blocks = figureBlocks(section)
    let best: DraftFigure | null = null
    let bestDistance = Infinity
    for (let i = 0; i < blocks.length; i++) {
      for (const figure of blocks[i].figures) {
        if (figure.caption || !figure.image || expected.get(figure) !== caption.number) continue
        // 同じ近さなら、前（タイトルより上）の図にする
        const distance = Math.abs(i - at) + (i > at ? 0.5 : 0)
        if (distance < bestDistance) {
          best = figure
          bestDistance = distance
        }
      }
    }
    if (best) best.caption = caption
    else blocks[at].figures.push({ image: null, caption })
  }
  for (const section of sections) section.blocks = section.blocks.filter((b) => b.t !== 'figs' || b.figures.length > 0)
}

// ---- 画像 ----

type ImageState =
  | { ok: true; path: string; bytes: Uint8Array }
  | { ok: false; reason: 'chart' | 'smartart' | 'linked' | 'missing' | 'template' | 'unsupported' | 'broken'; format?: string }

/** 画像の場所を求め、中身を取り出し、使えるかを見る */
function resolveImages(pkg: WordPackage, refs: ImageRef[]): Map<ImageRef, ImageState> {
  const states = new Map<ImageRef, ImageState>()
  const paths = new Map<ImageRef, string>()
  for (const ref of refs) {
    if (ref.kind !== 'image') states.set(ref, { ok: false, reason: ref.kind })
    else if (ref.linked) states.set(ref, { ok: false, reason: 'linked' })
    else {
      const rel = ref.rid ? pkg.rels.get(ref.rid) : undefined
      if (!rel) states.set(ref, { ok: false, reason: 'missing' })
      else if (rel.external) states.set(ref, { ok: false, reason: 'linked' })
      else paths.set(ref, rel.target)
    }
  }
  const files = pkg.readFiles([...new Set(paths.values())])
  for (const [ref, path] of paths) {
    const bytes = files.get(path)
    if (!bytes) states.set(ref, { ok: false, reason: 'missing' })
    else if (TEMPLATE_IMAGE_FINGERPRINTS.has(imageFingerprint(bytes))) states.set(ref, { ok: false, reason: 'template' })
    else {
      const info = imageInfo(bytes)
      states.set(ref, browserReadable(info.kind) ? { ok: true, path, bytes } : { ok: false, reason: 'unsupported', format: KIND_NAMES[info.kind] })
    }
  }
  return states
}

/** 学生が書いたもの（仮の文字・ひな形にもとからある文・仮の画像だけではないもの）があるか */
function sectionWritten(section: Section, states: Map<ImageRef, ImageState>, templateSubheadings: Set<string>): boolean {
  if (section.sub !== null && !isPlaceholderOnly(section.sub) && section.sub.trim() && !templateSubheadings.has(comparable(section.sub))) return true
  return section.blocks.some((b) => {
    if (b.t === 'para') return isWriting(b.text)
    if (b.t === 'figs') return b.figures.some((f) => f.image && (states.get(f.image)?.ok || f.image.kind !== 'image'))
    return b.table.rows.slice(1).some((r) => r.some((c) => (c.text && !isPlaceholderOnly(c.text)) || (c.image && states.get(c.image)?.ok)))
  })
}

const REASON_TEXT: Record<Exclude<ImageState, { ok: true }>['reason'], (label: string, format?: string) => Omit<ImportProblem, 'where'>> = {
  chart: (label) => ({ message: `${label}はグラフのため、写せません`, detail: '画像の枠だけを作ります。グラフを画像（JPEG・PNG）にして、ツールで入れてください。' }),
  smartart: (label) => ({ message: `${label}は SmartArt のため、写せません`, detail: '画像の枠だけを作ります。画像（JPEG・PNG）にして、ツールで入れてください。' }),
  linked: (label) => ({ message: `${label}の画像は、Word の中に入っていない（リンクした）画像でした`, detail: '画像の枠だけを作ります。ツールで写真を入れてください。' }),
  missing: (label) => ({ message: `${label}の画像が見つかりませんでした`, detail: '画像の枠だけを作ります。ツールで写真を入れてください。' }),
  template: (label) => ({ message: `${label}は、ひな形の仮の画像のままでした`, detail: '画像の枠だけを作ります。ツールで写真を入れてください。' }),
  unsupported: (label, format) => ({
    message: `${label}の画像は、ツールで使えない形（${format}）でした`,
    detail:
      format === 'EMF' || format === 'WMF'
        ? 'Word の図形や、ほかのソフトから貼り付けた図は写せません。画像の枠だけを作ります。JPEG か PNG の画像にして、ツールで入れてください。'
        : '画像の枠だけを作ります。JPEG か PNG にして、ツールで入れてください。',
  }),
  broken: (label) => ({ message: `${label}の画像を読めませんでした`, detail: '画像の枠だけを作ります。ツールで写真を入れ直してください。' }),
}

// ---- 表紙 ----

/** 表紙の文字を、行（表なら行ごとのセル）の並びにする */
function coverRows(blocks: WordBlock[]): string[][] {
  const rows: string[][] = []
  for (const b of blocks) {
    if (b.type === 'paragraph') {
      rows.push([b.text.replace(/[\n\t]/g, '　')])
      for (const box of b.boxes) for (const line of box.lines) rows.push([line.replace(/[\n\t]/g, '　')])
    } else {
      for (const row of b.rows) {
        rows.push(row.map((c) => c.text.replace(/[\n\t]/g, '　')))
        for (const cell of row) rows.push(...coverRows(cell.blocks.filter((x) => x.type === 'table')))
      }
    }
  }
  return rows
}

const hasPlaceholder = (s: string) => /[●〇○◯]|～～|〜〜/.test(s)

/** 学籍番号（数字2桁＋英字＋数字。全角は半角・大文字にする） */
function findStudentId(rows: string[][]): string | undefined {
  const re = /(?<![0-9A-Z])(\d{2}[A-Z]{1,4}\d{2,6})(?![0-9A-Z])/
  const norm = (s: string) => s.normalize('NFKC').toUpperCase().replace(/\s/g, '')
  const labeled = rows.filter((r) => norm(r.join('')).includes('学籍番号'))
  for (const row of [...labeled, ...rows.filter((r) => !labeled.includes(r))]) {
    const text = norm(row.join(' '))
    const after = text.includes('学籍番号') ? text.slice(text.indexOf('学籍番号') + 4) : text
    const m = re.exec(after.replace(/^[:：]/, ''))
    if (m) return m[1]
  }
  return undefined
}

/** 氏名（「氏名」「氏 名：」の後ろ。同じセルになければ、同じ行の次のセル） */
function findName(rows: string[][]): string | undefined {
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      const m = /(?:氏[\s　]*名|名[\s　]*前)(?![\s　]*[（(]?[\s　]*(?:ふりがな|フリガナ))[\s　]*[:：]?[\s　]*(.*)$/.exec(row[i])
      if (!m) continue
      let value = m[1]
      if (!value.trim()) value = row.slice(i + 1).find((c) => c.replace(/[\s　:：]/g, '')) ?? ''
      value = value.replace(/^[\s　:：]+/, '').trim().replace(/[\s　]{2,}/g, '　')
      if (value && !hasPlaceholder(value)) return value
    }
  }
  return undefined
}

/** サブタイトルの前後の線（―）。長音の「ー」で打つ学生もいるが、名前の中の「ー」と分けるため、「ー」は端の1字だけを線とみなす */
const DASHES = '―－—–\\-‐−─━'

/** サブタイトルの行の、前後の線（「―」「ー」など） */
const SUBTITLE_EDGE = () => new RegExp(`^(?:[${DASHES}]{1,3}|ー)|(?:[${DASHES}]{1,3}|ー)$`, 'g')

/** 表紙の、サブタイトルの行（前後が線（―）の行。ひな形のまま（●●●）の行は除く） */
function findSubtitleLine(rows: string[][]): string | undefined {
  for (const row of rows) {
    const line = row.join('').trim()
    if (line.length > 80 || !new RegExp(`^[${DASHES}ー].*[${DASHES}ー]$`).test(line)) continue
    const inner = line.replace(SUBTITLE_EDGE(), '').trim()
    if (inner && !hasPlaceholder(inner)) return line
  }
  return undefined
}

/**
 * Word のサブタイトルの行（「―シンドバッドの衣装制作―」）から、学生が入れる部分（{input}。「シンドバッド」）を取り出す。
 * コースの決まった形（template。「―{input}の衣装制作―」）の前と後ろは、合っている所だけを取る（合わない所は、そのまま残す）。
 * fits：前後とも決まった形に合っていたか（合わなければ、表紙には決まった形の前後が付いて、Word と違う文になる）
 */
export function subtitleFromWord(line: string, template: string): { input: string; fits: boolean } {
  const [prefix = '', suffix = ''] = template.replace(SUBTITLE_EDGE(), '').split('{input}').map((s) => s.trim())
  let input = line.trim().replace(SUBTITLE_EDGE(), '').trim()
  const head = !!prefix && input.startsWith(prefix) && input.length > prefix.length
  if (head) input = input.slice(prefix.length)
  const tail = !!suffix && input.endsWith(suffix) && input.length > suffix.length
  if (tail) input = input.slice(0, input.length - suffix.length)
  return { input: input.trim(), fits: (!prefix || head) && (!suffix || tail) }
}

/** 表紙の Word から読み取れたもの */
interface CoverRead {
  cover: WordImportResult['cover']
  /** 表紙に書いてあったコース（表紙を書いていない（ひな形のまま）とき・見つからないときは省く） */
  courseId?: string
  /** サブタイトルが、コースの決まった形と合わなかった：Word に書いてあった行 */
  subtitleOffForm?: string
}

function readCover(pkg: WordPackage, config: YearConfig, courseId: string, problems: ImportProblem[]): CoverRead {
  const blocks = readDocument(pkg.document, documentContext(pkg.styles, pkg.numbering))
  const rows = coverRows(blocks)
  const all = comparable(rows.flat().join(''))
  // 本文のファイルを表紙に選んだ
  const hasChapters = blocks.some((b) => b.type === 'paragraph' && headingFromText(b.text)?.level === 1)
  if (hasChapters && !all.includes('学籍番号') && !all.includes('氏名'))
    throw new WordImportError(`表紙に選んだ「${pkg.fileName}」は、表紙のファイルではないようです（本文や目次のファイルではありませんか）。表紙は 01_表紙.docx を選んでください（表紙を Word で書いていなければ、選ばなくてかまいません）。`)
  const template = findCourse(config, courseId)?.subtitleTemplate ?? '―{input}―'
  const cover: WordImportResult['cover'] = {}
  const studentId = findStudentId(rows)
  const name = findName(rows)
  const subtitleLine = findSubtitleLine(rows)
  const subtitle = subtitleLine ? subtitleFromWord(subtitleLine, template) : null
  const subtitleInput = subtitle?.input
  if (studentId) cover.studentId = studentId
  if (name) cover.name = name
  if (subtitleInput) cover.subtitleInput = subtitleInput
  const missing = [studentId ? '' : '学籍番号', name ? '' : '氏名', subtitleInput ? '' : 'サブタイトル'].filter(Boolean)
  if (missing.length > 0)
    problems.push({ message: `表紙の${missing.join('・')}を読み取れませんでした`, detail: '読み込んだあと、ツールの表紙で入力してください。', where: '表紙' })
  const read: CoverRead = { cover }
  // コース：表紙を書いているときだけ見る（ひな形のままの表紙には、ひな形のコース（映画・舞台衣装デザイナー）が書いてあるため）
  const written = !!(studentId || name || subtitleInput)
  const found = written ? courseIdInText(rows.flat(), config) : null
  if (found) read.courseId = found
  if (subtitleLine && subtitleInput && subtitle && !subtitle.fits) read.subtitleOffForm = subtitleLine
  return read
}

// ---- 読み取り ----

/** 本文に選んだファイルが、本文でなさそう（表紙・抄録・目次）なら、学生に分かる言葉で知らせる */
function checkBodyFile(blocks: WordBlock[], events: Event[], fileName: string) {
  const lines = blocks
    .flatMap((b) => (b.type === 'paragraph' ? [b.text] : b.rows.flat().map((c) => c.text)))
    .map(comparable)
    .filter(Boolean)
  const label = `本文に選んだ「${fileName}」`
  if (lines.length === 0 && !events.some((e) => e.k === 'group' || e.k === 'table'))
    throw new WordImportError(`${label}には、何も書かれていません。04_本文.docx を選んでください。`)
  const hasChapters = events.some((e) => e.k === 'chapter')
  const head = lines.slice(0, 12)
  if (head.slice(0, 3).includes('目次')) throw new WordImportError(`${label}は、目次のファイルのようです。本文は 04_本文.docx を選んでください。`)
  if (!hasChapters && head.some((l) => l.includes('抄録'))) throw new WordImportError(`${label}は、抄録のファイルのようです。本文は 04_本文.docx を選んでください。`)
  if (!hasChapters && head.some((l) => l.includes('研究題目') || l.includes('学籍番号')))
    throw new WordImportError(`${label}は、表紙のファイルのようです。本文は 04_本文.docx を選んでください。`)
}

/** 読み込んだあとの本文の並びの1つ：Word で書いた章（word：書いた章の番目）か、ツールのひな形の章（template：ひな形の章の番目） */
export type ChapterSlot = { word: number } | { template: number }

/**
 * Word で書いた章と、ツールのコースのひな形の章を、1つの並びにする
 * （依頼者の要望 2026-10-22：Word から移るときに、章が重なったり、順番が入れ替わったりしないように）。
 * - 同じ名前の章は、組にする（Word の章を使い、ひな形の章は入れない）
 * - 名前が違っても、Word の中で同じ番目（Ⅱ なら2番目）にあるひな形の章が、まだどの章とも組になっていなければ、組にする
 *   （先生がひな形の章の名前を変えた・学生が Word で章の名前を変えた。どちらも同じ章として扱う）
 * - 並びは、ひな形の順（Ⅰ・Ⅲ だけ書いて Ⅱ が空なら、ひな形の Ⅱ は Ⅰ と Ⅲ の間に入る）。
 *   どれとも組にならなかった Word の章は、Word で前にあった章のすぐ後ろに入れる
 * word：Word で書いた章の名前と、Word の中の番目（大見出しの順。書いていない章も数える。大見出しより前の部分は -1）。
 * renamed：名前が違うまま組にした章（読み込む前の確認の窓で知らせる）
 */
export function chapterOrder(word: { title: string; position: number }[], template: string[]): { slots: ChapterSlot[]; renamed: { word: number; template: number }[] } {
  /** Word の章の番目 → 組にしたひな形の章の番目 */
  const pairs = new Map<number, number>()
  const taken = new Set<number>()
  word.forEach((w, i) => {
    const j = template.findIndex((t, k) => !taken.has(k) && comparable(t) === comparable(w.title))
    if (j < 0) return
    pairs.set(i, j)
    taken.add(j)
  })
  const renamed: { word: number; template: number }[] = []
  word.forEach((w, i) => {
    const j = w.position
    if (pairs.has(i) || j < 0 || j >= template.length || taken.has(j)) return
    pairs.set(i, j)
    taken.add(j)
    renamed.push({ word: i, template: j })
  })
  const slots: ChapterSlot[] = []
  const placed = new Set<number>()
  /** 組にならなかった Word の章のうち、end 番目より前のものを、Word の順に入れる */
  const placeLoose = (end: number) => {
    for (let i = 0; i < end; i++) {
      if (placed.has(i) || pairs.has(i)) continue
      slots.push({ word: i })
      placed.add(i)
    }
  }
  template.forEach((_, j) => {
    const i = [...pairs].find(([, t]) => t === j)?.[0]
    if (i === undefined) {
      slots.push({ template: j })
      return
    }
    placeLoose(i)
    slots.push({ word: i })
    placed.add(i)
  })
  placeLoose(word.length)
  return { slots, renamed }
}

/**
 * 学生が選んだ Word（本文は必ず、表紙は書いていれば）を読み取り、ツールの原稿の形にする。
 * 読めないファイルは WordImportError（message は学生に分かる言葉）。
 * images: false：画像を縮めて取り出さない（図に画像があることだけを残す。提出前チェックで、確かめるだけのとき）
 */
export async function readWordFiles(files: WordFiles, context: { config: YearConfig; courseId: string; images?: boolean }): Promise<WordImportResult> {
  const { config, courseId } = context
  const problems: ImportProblem[] = []
  const bodyPkg = await openWordFile(files.body, '本文')
  const coverPkg = files.cover ? await openWordFile(files.cover, '表紙') : null

  // コースのひな形（まだ書いていない章を続けるのと、見出しの名前を比べるのに使う）
  const template = bodyFromTemplate(courseTemplate(config, courseId))
  // ひな形の仮の名前（「〇〇〇〇」の小見出しなど）は、見出しの名前として使わない（Word の「〇〇〇〇」だけの行を、見出しと取り違えないように）
  const named = (titles: string[]) => titles.filter((t) => !isPlaceholderOnly(t)).map(comparable)
  const templateChapters = new Set(named([...WORD_TEMPLATE_CHAPTERS, ...template.map((c) => c.title)]))
  const templateSubheadings = new Set(named([...WORD_TEMPLATE_SUBHEADINGS, ...template.flatMap((c) => c.blocks.flatMap((b) => (b.type === 'subheading' ? [b.title] : [])))]))

  const blocks = readDocument(bodyPkg.document, documentContext(bodyPkg.styles, bodyPkg.numbering))
  const events = classify(blocks, { chapters: templateChapters, subheadings: templateSubheadings })
  checkBodyFile(blocks, events, bodyPkg.fileName)
  const drafts = buildChapters(events)

  // 画像の中身を取り出し、使えるか・ひな形の仮の画像かを見る
  const refs = drafts.flatMap((c) =>
    c.sections.flatMap((s) =>
      s.blocks.flatMap((b) => (b.t === 'figs' ? b.figures.flatMap((f) => (f.image ? [f.image] : [])) : b.t === 'table' ? b.table.rows.flat().flatMap((c) => (c.image ? [c.image] : [])) : [])),
    ),
  )
  const states = resolveImages(bodyPkg, refs)

  // Word でまだ書いていない章は写さない（ツールのひな形の章で続ける）
  const isPlaceholderTitle = (t: string | null) => t !== null && isPlaceholderOnly(t)
  let skippedPlaceholders = 0
  const kept: DraftChapter[] = []
  /** 写す章の、Word の中の番目（大見出しの順。書いていない章も数える。大見出しより前の部分は -1。ひな形の章と組にするため：chapterOrder） */
  const keptPositions: number[] = []
  let titled = 0
  for (const chapter of drafts) {
    const position = chapter.title === null ? -1 : titled++
    const titleWritten = chapter.title !== null && chapter.title.trim() !== '' && !isPlaceholderTitle(chapter.title) && !templateChapters.has(comparable(chapter.title))
    const written = chapter.sections.map((s) => sectionWritten(s, states, templateSubheadings))
    const placeholderLines = chapter.sections.reduce((n, s) => n + s.skipped + (isPlaceholderTitle(s.sub) ? 1 : 0), isPlaceholderTitle(chapter.title) ? 1 : 0)
    if (!titleWritten && !written.some(Boolean)) {
      skippedPlaceholders += placeholderLines
      continue
    }
    // 書いた章の中でも、仮の小見出し（「ⅱ．〇〇〇〇」）の下に何も書いていなければ、その小見出しごと写さない
    const sections = chapter.sections.filter((s, i) => !(isPlaceholderTitle(s.sub) && !written[i]))
    // 写す見出し（仮の名前のままでも、下に書いたものがある見出し）は、写さなかった行に数えない
    skippedPlaceholders += placeholderLines - (isPlaceholderTitle(chapter.title) ? 1 : 0) - sections.filter((s) => isPlaceholderTitle(s.sub)).length
    kept.push({ ...chapter, sections })
    keptPositions.push(position)
  }

  // 使う画像を、ツールの画像にする（大きすぎるものは縮める）
  const images: StoredImage[] = []
  const imageIds = new Map<ImageRef, string>()
  const failed = new Set<ImageRef>()
  const byKey = new Map<string, string>()
  for (const ref of kept.flatMap((c) => c.sections.flatMap((s) => s.blocks)).flatMap((b) => (b.t === 'figs' ? b.figures.map((f) => f.image) : b.t === 'table' ? b.table.rows.flat().map((c) => c.image) : []))) {
    if (!ref) continue
    const state = states.get(ref)
    if (!state?.ok) continue
    const key = `${state.path}|${JSON.stringify(ref.crop)}`
    const known = byKey.get(key)
    if (known) {
      imageIds.set(ref, known)
      continue
    }
    // 画像を使わないとき（提出前チェック：src/check）：縮めずに、画像があることだけを残す（result.images は空）
    if (context.images === false) {
      byKey.set(key, key)
      imageIds.set(ref, key)
      continue
    }
    try {
      const stored = await prepareImage(state.bytes, newId('img'), ref.crop)
      images.push(stored)
      byKey.set(key, stored.id)
      imageIds.set(ref, stored.id)
    } catch {
      failed.add(ref)
    }
  }
  const imageState = (ref: ImageRef | null): ImageState | null => {
    if (!ref) return null
    if (failed.has(ref)) return { ok: false, reason: 'broken' }
    return states.get(ref) ?? { ok: false, reason: 'missing' }
  }

  // ツールの原稿にする
  const body: Chapter[] = []
  const paragraphTexts = new Map<string, string>()
  interface FigureMeta {
    id: string
    wordNumber: number | null
    caption: string
    imageId: string | null
    state: ImageState | null
    captionMissing: boolean
    chapter: number
    section: number
  }
  interface TableMeta {
    id: string
    wordNumber: number | null
    caption: string
    rows: number
    captionMissing: boolean
    merged: boolean
    extraImages: number
    /** 写せなかったセルの画像 */
    cellImages: Exclude<ImageState, { ok: true }>[]
    chapter: number
    section: number
  }
  const figureMetas: FigureMeta[] = []
  const tableMetas: TableMeta[] = []
  const sectionStats: { paragraphs: number }[][] = []
  const hintFor = (subheading: string): string | undefined => {
    for (const c of template) {
      const i = c.blocks.findIndex((b) => b.type === 'subheading' && comparable(b.title) === comparable(subheading))
      const next = c.blocks[i + 1]
      if (i >= 0 && next?.type === 'paragraph') return next.hint
    }
    return undefined
  }
  kept.forEach((draft, ci) => {
    const blocks: BodyBlock[] = []
    sectionStats.push([])
    draft.sections.forEach((section, si) => {
      const stats = { paragraphs: 0 }
      sectionStats[ci].push(stats)
      const subheadingAt = blocks.length
      if (section.sub !== null) blocks.push({ type: 'subheading', id: newId('s'), title: section.sub })
      for (const b of section.blocks) {
        if (b.t === 'para') {
          const id = newId('p')
          paragraphTexts.set(id, b.text)
          blocks.push({ type: 'paragraph', id, content: [{ type: 'text', text: '' }] })
          stats.paragraphs++
        } else if (b.t === 'figs') {
          const figures = b.figures.map((f) => {
            const id = newId('f')
            const imageId = (f.image && imageIds.get(f.image)) || null
            figureMetas.push({
              id,
              wordNumber: f.caption?.number ?? null,
              caption: f.caption?.name ?? '',
              imageId,
              state: imageState(f.image),
              captionMissing: !f.caption,
              chapter: ci,
              section: si,
            })
            return { id, imageId: imageId ?? '', caption: f.caption?.name ?? '' }
          })
          blocks.push({ type: 'figureRow', id: newId('r'), figures })
        } else {
          const id = newId('t')
          const rows: TableRow[] = b.table.rows.map((r) => ({
            id: newId('tr'),
            cells: r.map((c) => ({ id: newId('tc'), text: c.text, imageId: (c.image && imageIds.get(c.image)) || null })),
          }))
          const table: TableBlock = { type: 'table', id, caption: b.table.caption?.name ?? '', widths: 'equal', heights: b.table.tallRows ? 'photo' : 'auto', rows }
          tableMetas.push({
            id,
            wordNumber: b.table.caption?.number ?? null,
            caption: table.caption,
            rows: rows.length - 1,
            captionMissing: !b.table.caption,
            merged: b.table.merged,
            extraImages: b.table.rows.flat().reduce((n, c) => n + c.extraImages, 0),
            cellImages: b.table.rows.flat().flatMap((c) => {
              const state = imageState(c.image)
              return state && !state.ok ? [state] : []
            }),
            chapter: ci,
            section: si,
          })
          blocks.push(table)
        }
      }
      // 小見出しの下に段落がなければ、書くための空の段落を入れる（ひな形の説明があれば薄く出す）
      if (section.sub !== null && !section.blocks.some((b) => b.t === 'para')) blocks.splice(subheadingAt + 1, 0, emptyParagraph(hintFor(section.sub)))
    })
    if (blocks.length === 0) blocks.push(emptyParagraph())
    body.push({ id: newId('c'), title: draft.title ?? '', blocks })
  })
  // Word で書いた章と、ひな形の章を、ひな形の順に1つの並びにする（同じ章が2つにならず、書いていない章も元の位置に入る：chapterOrder）
  const wordChapters = [...body]
  const { slots, renamed } = chapterOrder(
    wordChapters.map((c, ci) => ({ title: c.title, position: keptPositions[ci] })),
    template.map((c) => c.title),
  )
  // 名前を入れていない（「〇〇〇〇」のまま・空の）大見出しは、組にしたひな形の章の名前にする
  const namedFromTemplate = new Map<number, string>()
  for (const r of renamed) {
    const chapter = wordChapters[r.word]
    if (chapter.title.trim() && !isPlaceholderOnly(chapter.title)) continue
    namedFromTemplate.set(r.word, chapter.title)
    chapter.title = template[r.template].title
  }
  body.splice(0, body.length, ...slots.map((s) => ('word' in s ? wordChapters[s.word] : template[s.template])))
  /** Word で書いた章（kept の番目）が、読み込んだあとの並びの何番目か（見出しの番号 Ⅰ．Ⅱ．…を、読み込んだあとの並びで出す） */
  const placeOf = new Map(slots.flatMap((s, k) => ('word' in s ? [[s.word, k] as const] : [])))

  // 本文の「（図1）」「（表1）」を、Word のタイトルの番号のとおりに、図・表へのつながりにする
  // （reportOps.setText と同じ変換。番号の合わないものは文字のまま残り、ツールのセルフチェックが知らせる）
  const tool = numbering({ body })
  const figureByNumber = new Map<number, string>()
  const tableByNumber = new Map<number, string>()
  for (const f of figureMetas) if (f.wordNumber !== null && !figureByNumber.has(f.wordNumber)) figureByNumber.set(f.wordNumber, f.id)
  for (const f of figureMetas) {
    const n = tool.numbers.get(f.id)
    if (f.wordNumber === null && n !== undefined && !figureByNumber.has(n)) figureByNumber.set(n, f.id)
  }
  for (const t of tableMetas) if (t.wordNumber !== null && !tableByNumber.has(t.wordNumber)) tableByNumber.set(t.wordNumber, t.id)
  for (const t of tableMetas) {
    const n = tool.numbers.get(t.id)
    if (t.wordNumber === null && n !== undefined && !tableByNumber.has(n)) tableByNumber.set(n, t.id)
  }
  const wordNumbering: Numbering = { numbers: tool.numbers, tableIds: tool.tableIds, figureByNumber, tableByNumber }
  for (const chapter of body) {
    chapter.blocks = chapter.blocks.map((b) => {
      const text = b.type === 'paragraph' ? paragraphTexts.get(b.id) : undefined
      return text === undefined ? b : { ...b, content: textToContent(normalizeParagraph(halfDigitsInRefs(text)), wordNumbering) }
    })
  }

  // 確認の窓に出すもの
  const label = (kind: '図' | '表', id: string) => `${kind}${tool.numbers.get(id) ?? '?'}`
  /** 書いた章の見出し（読み込んだあとの番号で） */
  const chapterHead = (ci: number) => `${chapterLabel(placeOf.get(ci) ?? ci)}${wordChapters[ci]?.title || '（名前のない大見出し）'}`
  const where = (ci: number, si: number): string => {
    const chapter = kept[ci]
    const head = chapterHead(ci)
    const subs = chapter.sections.slice(0, si + 1).filter((s) => s.sub !== null)
    const sub = chapter.sections[si].sub
    return sub === null ? head : `${head}　${subheadingLabel(subs.length - 1)}${sub}`
  }
  const sectionProblems = new Set<string>()
  /** 知らせる順（本文の中の位置の順。表紙などは後ろ） */
  const problemOrder = new Map<ImportProblem, number>()
  const addProblem = (ci: number, si: number, problem: Omit<ImportProblem, 'where'>) => {
    const item = { ...problem, where: where(ci, si) }
    problems.push(item)
    problemOrder.set(item, (placeOf.get(ci) ?? ci) * 10000 + si)
    sectionProblems.add(`${ci}:${si}`)
  }

  if (drafts.length > 0 && drafts[0].title === null && kept[0]?.title === null) {
    addProblem(0, 0, {
      message: drafts.length === 1 ? '大見出し（Ⅰ．Ⅱ．…）が見つかりませんでした' : '最初の大見出しより前に、文があります',
      detail: '名前のない大見出しに入れて写します。読み込んだあと、ツールで大見出しの名前を入れてください。',
    })
  }
  for (const f of figureMetas) {
    const name = label('図', f.id)
    if (f.captionMissing)
      addProblem(f.chapter, f.section, {
        message: `${name}のタイトルが見つかりませんでした`,
        detail: `写真の近くに「図${tool.numbers.get(f.id)}　〇〇」の行がないため、タイトルを空けて写します。読み込んだあと、ツールで入れてください。`,
      })
    if (f.state && !f.state.ok) addProblem(f.chapter, f.section, REASON_TEXT[f.state.reason](name, f.state.format))
    else if (!f.state) addProblem(f.chapter, f.section, { message: `${name}の画像が見つかりませんでした`, detail: `「図${tool.numbers.get(f.id)}　${f.caption}」のタイトルの近くに画像がないため、画像の枠だけを作ります。ツールで写真を入れてください。` })
  }
  for (const t of tableMetas) {
    const name = label('表', t.id)
    if (t.captionMissing)
      addProblem(t.chapter, t.section, { message: `${name}のタイトルが見つかりませんでした`, detail: `表の上に「${name}　〇〇」の行がないため、タイトルを空けて写します。読み込んだあと、ツールで入れてください。` })
    if (t.merged) addProblem(t.chapter, t.section, { message: `${name}の結合したセルは、分けて写しました`, detail: 'ツールの表は、セルを結合できません。読み込んだあと、表の形を確かめてください。' })
    if (t.extraImages > 0) addProblem(t.chapter, t.section, { message: `${name}に、画像が2枚以上入ったセルがありました`, detail: 'ツールの表のセルには、画像を1枚だけ入れられます。1枚目だけを写します。' })
    // 写せなかったセルの画像（同じ理由のものは1つにまとめる）
    for (const state of t.cellImages.filter((s, i, all) => all.findIndex((x) => x.reason === s.reason && x.format === s.format) === i))
      addProblem(t.chapter, t.section, REASON_TEXT[state.reason](`${name}のセル`, state.format))
  }
  kept.forEach((chapter, ci) =>
    chapter.sections.forEach((section, si) => {
      // 見出しの形でない行（多いときは、2つまで挙げてまとめる）
      const lines = section.headingLike
      if (lines.length > 0)
        addProblem(ci, si, {
          message: `見出しの形でない行があります：${lines.slice(0, 2).map((t) => `「${t}」`).join('')}${lines.length > 2 ? `など${lines.length}行` : ''}`,
          detail: '「Ⅰ．」「ⅰ．」の形でないため、ふつうの段落として写します。小見出しにするときは、読み込んだあと、ツールで直してください。',
        })
      if (section.lostTableCaptions.length > 0)
        addProblem(ci, si, {
          message: `表のタイトル（${section.lostTableCaptions.map((c) => `「表${c.number}　${c.name}」`).join('')}）はありましたが、表が見つかりませんでした`,
          detail: '表を画像にして貼り付けていると、表としては写せません。読み込んだあと、ツールで表を作ってください。',
        })
      if (section.boxTexts.length > 0)
        addProblem(ci, si, {
          message: `図形の中の文字（「${section.boxTexts[0].slice(0, 20)}」${section.boxTexts.length > 1 ? `など${section.boxTexts.length}か所` : ''}）は写していません`,
          detail: '文字の枠・図形の中の文字は、図・表のタイトルのほかは写しません。本文に書くときは、読み込んだあと、ツールで書いてください。',
        })
      if (section.notes > 0) addProblem(ci, si, { message: '脚注は写していません', detail: 'ツールには脚注がありません。引用・参考文献は「引用・参考文献」に入れてください。' })
    }),
  )
  // 名前が違うまま、ひな形の章と組にした章（その章は、ひな形の説明・図や表の枠が入らないことを知らせる）。名前のない大見出しには、ひな形の名前を入れたことを知らせる
  for (const r of renamed) {
    const name = template[r.template].title
    const was = namedFromTemplate.get(r.word)
    const item: ImportProblem =
      was !== undefined
        ? { where: chapterHead(r.word), message: `大見出しの名前を、ひな形の「${name}」にしました`, detail: `Word の大見出しは「${was || '（名前なし）'}」のままでした。ほかの名前にするときは、読み込んだあとツールで直してください。` }
        : {
            where: chapterHead(r.word),
            message: `ひな形の「${name}」の章の代わりに、Word の「${wordChapters[r.word].title}」の章を入れます`,
            detail: '章の名前がツールのひな形と違うため、同じ番目の章として入れます（その章の、ひな形の説明や図・表の枠は入りません）。',
          }
    problems.push(item)
    problemOrder.set(item, (placeOf.get(r.word) ?? r.word) * 10000 - 1)
  }
  if (kept.length === 0)
    problems.push({
      message: 'Word に書いた本文が見つかりませんでした',
      detail: 'ひな形のまま（「〇〇〇〇」「～～～」）のようです。読み込むと、本文はツールのひな形になります。',
    })

  const coverRead = coverPkg ? readCover(coverPkg, config, courseId, problems) : null
  const cover = coverRead?.cover ?? {}
  problems.sort((a, b) => (problemOrder.get(a) ?? 1e9) - (problemOrder.get(b) ?? 1e9))

  const outline: OutlineItem[] = []
  for (const slot of slots) {
    if ('template' in slot) {
      outline.push({ level: 1, title: template[slot.template].title, paragraphs: 0, figures: [], tables: [], fromTemplate: true })
      continue
    }
    const ci = slot.word
    // 章の最初の部分（小見出しより前）は、大見出しの行に数える
    kept[ci].sections.forEach((section, si) => {
      const item: OutlineItem = {
        level: section.sub === null ? 1 : 2,
        title: section.sub ?? wordChapters[ci].title,
        paragraphs: sectionStats[ci][si].paragraphs,
        figures: figureMetas.filter((f) => f.chapter === ci && f.section === si).map((f) => label('図', f.id)),
        tables: tableMetas.filter((t) => t.chapter === ci && t.section === si).map((t) => label('表', t.id)),
      }
      if (sectionProblems.has(`${ci}:${si}`)) item.problem = true
      outline.push(item)
    })
  }

  const figures: FigurePreview[] = figureMetas.map((f) => ({ label: label('図', f.id), caption: f.caption, imageId: f.imageId }))
  const tables: TablePreview[] = tableMetas.map((t) => ({ label: label('表', t.id), caption: t.caption, rows: t.rows }))
  const usedImages = new Set([...figureMetas.map((f) => f.imageId), ...body.flatMap((c) => c.blocks.flatMap((b) => (b.type === 'table' ? b.rows.flatMap((r) => r.cells.map((x) => x.imageId)) : [])))])

  return {
    body,
    cover,
    ...(coverRead?.courseId ? { coverCourseId: coverRead.courseId } : {}),
    ...(coverRead?.subtitleOffForm ? { subtitleOffForm: coverRead.subtitleOffForm } : {}),
    images: images.filter((img) => usedImages.has(img.id)),
    outline,
    figures,
    tables,
    counts: {
      chapters: kept.length,
      subheadings: kept.reduce((n, c) => n + c.sections.filter((s) => s.sub !== null).length, 0),
      paragraphs: paragraphTexts.size,
      figures: figureMetas.length,
      tables: tableMetas.length,
    },
    skippedPlaceholders,
    problems,
  }
}

/**
 * 表紙の Word だけを読む（提出前チェック：src/check。本文の Word を入れずに、表紙だけを入れたとき）。
 * 読めないファイル・表紙でないファイルは WordImportError（message は学生に分かる言葉）
 */
export async function readCoverFile(file: File, context: { config: YearConfig; courseId: string }): Promise<{ cover: WordImportResult['cover']; problems: ImportProblem[] }> {
  const problems: ImportProblem[] = []
  const pkg = await openWordFile(file, '表紙')
  return { cover: readCover(pkg, context.config, context.courseId, problems).cover, problems }
}

/**
 * 読み取った中身を原稿に写す：本文を入れ替え、表紙の読み取れた項目（学籍番号・氏名・サブタイトル）を入れる。
 * 抄録・作品写真・引用参考文献はそのまま。画像の保存は呼ぶ側が行う（result.images を putImage する）。
 * course：表紙の Word のコースに変える（確認の窓で、学生が Word のコースを選んだとき）。本文は読み込んだ本文のまま、
 * コースの名前だけを変える（「コース名だけ変える」と同じ。抄録をまだ書いていなければ、書き出しの例もそのコースのものにする。
 * 読み込む本文は、そのコースで読み取り直したもの）
 */
export function applyWordImport(report: Report, result: WordImportResult, course?: { courseId: string; config: YearConfig }): Report {
  const cover = Object.fromEntries(Object.entries(result.cover).filter(([, v]) => typeof v === 'string' && v.trim() !== ''))
  const imported: Report = { ...report, body: result.body, basicInfo: { ...report.basicInfo, ...cover } }
  if (!course || course.courseId === report.basicInfo.courseId) return imported
  const renamed = setCourse(imported, course.courseId)
  return abstractEmpty(renamed) ? { ...renamed, abstract: { ...renamed.abstract, paragraphs: [emptyParagraph(abstractHint(course.config, course.courseId))] } } : renamed
}

/** Word を読み込むと消える、ツールで書いた本文（大見出しごと） */
export interface LostChapter {
  /** 番号（Ⅰ．）と見出し（例「Ⅱ．制作過程」） */
  heading: string
  /** 大見出しの名前だけ（確認の窓の一覧で、同じ名前の章に印を付けるため） */
  title: string
  paragraphs: number
  figures: number
  tables: number
}

/** 比べるための文字（図表の参照・空白・句読点の違いは見ない） */
const comparableText = (content: ParagraphBlock['content']) => comparable(content.map((n) => (n.type === 'text' ? n.text : '')).join('')).replace(IGNORABLE, '')

/**
 * Word を読み込むと消える、ツールで書いた本文。今の原稿の段落・図・表のうち、読み込む本文（body）にないものを大見出しごとに数える。
 * 本文は Word の中身に入れ替わるため、ツールで書き足した章や、ツールで直した段落は消える（同じ Word を読み込み直したときなど）。
 * 何も書いていない段落（ひな形のまま）と、Word から読み込んだままの段落は数えない。図は写真が入っていてタイトルのあるもの、表は中身で比べる
 */
export function lostByImport(report: Report, body: Chapter[]): LostChapter[] {
  const blocks = body.flatMap((c) => c.blocks)
  const texts = new Set(blocks.flatMap((b) => (b.type === 'paragraph' ? [comparableText(b.content)] : [])))
  const captions = new Set(blocks.flatMap((b) => (b.type === 'figureRow' ? b.figures.map((f) => comparable(f.caption)) : [])))
  const tableText = (t: TableBlock) => comparable([t.caption, ...t.rows.flatMap((r) => r.cells.map((c) => c.text))].join('|'))
  const tables = new Set(blocks.flatMap((b) => (b.type === 'table' ? [tableText(b)] : [])))
  return report.body.flatMap((chapter, i): LostChapter[] => {
    let paragraphs = 0
    let figures = 0
    let lostTables = 0
    for (const b of chapter.blocks) {
      if (b.type === 'paragraph') {
        const text = comparableText(b.content)
        if (text && !texts.has(text)) paragraphs++
      } else if (b.type === 'figureRow') {
        figures += b.figures.filter((f) => f.imageId && f.caption.trim() && !captions.has(comparable(f.caption))).length
      } else if (b.type === 'table') {
        const written = b.rows.slice(1).some((r) => r.cells.some((c) => c.text.trim() || c.imageId))
        if (written && !tables.has(tableText(b))) lostTables++
      }
    }
    if (paragraphs + figures + lostTables === 0) return []
    return [{ heading: `${chapterLabel(i)}${chapter.title}`, title: chapter.title, paragraphs, figures, tables: lostTables }]
  })
}
