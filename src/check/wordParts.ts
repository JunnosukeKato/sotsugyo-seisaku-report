import { courseIdInText, type YearConfig } from '../config'
import { headingFromText, isPlaceholderOnly } from '../import/wordImport'
import type { WordBlock } from '../import/wordDocument'
import type { PartId } from './parts'

/**
 * 提出前チェック：Word（学科のひな形 01〜04）の中身から分かること。
 * どのパートのファイルか・抄録の本文・目次の見出しと本文の見出し。読み取りは import/wordDocument.ts（学生用ツールの「Word から読み込む」と同じ）
 */

/** 比べるための形（NFKC にし、空白を除く） */
const comparable = (s: string) => s.normalize('NFKC').replace(/[\s　]/g, '')

/** 段落・表のセル・文字の枠の、文字の行（上から順） */
export function blockLines(blocks: WordBlock[]): string[] {
  const lines: string[] = []
  for (const b of blocks) {
    if (b.type === 'paragraph') {
      lines.push(b.listPrefix + b.text.replace(/[\n\t]/g, '　'))
      for (const box of b.boxes) lines.push(...box.lines.map((l) => l.replace(/[\n\t]/g, '　')))
    } else {
      for (const row of b.rows) for (const cell of row) lines.push(...blockLines(cell.blocks))
    }
  }
  return lines
}

/**
 * どのパートの Word か（名前で分からないとき）。学生用ツールの「Word から読み込む」が、本文に選んだファイルを確かめるのと同じ見分け方
 * （wordImport.ts の checkBodyFile）：上に「目次」なら目次、大見出しがなく上のほうに「抄録」なら抄録、
 * 大見出しがなく「学籍番号」「研究題目」があれば表紙、ほかは本文
 */
export function sniffWordBlocks(blocks: WordBlock[]): Exclude<PartId, 'photo'> {
  const lines = blockLines(blocks).map(comparable).filter(Boolean)
  const head = lines.slice(0, 12)
  if (head.slice(0, 3).some((l) => l.startsWith('目次'))) return 'toc'
  const hasChapters = blocks.some((b) => b.type === 'paragraph' && headingFromText(b.text)?.level === 1)
  if (!hasChapters && head.some((l) => l.includes('抄録') || l.includes('要旨'))) return 'abstract'
  if (!hasChapters && lines.some((l) => l.includes('研究題目') || l.includes('学籍番号'))) return 'cover'
  return 'body'
}

/** 中身から、はっきり分かるパート（入れた場所と中身が違うのを見つけるのに使う）。本文は、大見出し（「Ⅰ．」など）があるときだけ。どれとも言えなければ null */
export function sniffWordStrict(blocks: WordBlock[]): Exclude<PartId, 'photo'> | null {
  const part = sniffWordBlocks(blocks)
  if (part !== 'body') return part
  return blocks.some((b) => b.type === 'paragraph' && headingFromText(b.text)?.level === 1) ? 'body' : null
}

/** コース：Word に書いたコースの名前から探す（長い名前から。見つからなければ null。学生用ツールの「Word から読み込む」と同じ探し方） */
export function findCourseId(lines: string[], config: YearConfig): string | null {
  return courseIdInText(lines, config)
}

const DASHES = '―－—–\\-‐−─━ー'
const SUBTITLE = new RegExp(`^[${DASHES}].*[${DASHES}]$`)

/**
 * 抄録の本文の段落（02_抄録.docx）。上の決まった行（「2026年度 卒業研究 抄録」・学部学科とコース・学籍番号と氏名・指導教員・題目・サブタイトル）より下の段落。
 * サブタイトル（「―…―」）の行が見つかればその下、なければ、決まった行の形の行を上から飛ばす。
 * 仮の文字だけの段落（「～～」）は入れない
 */
export function abstractParagraphs(blocks: WordBlock[], config: Pick<YearConfig, 'commonTitle'>): string[] {
  const paragraphs = blocks.flatMap((b) => (b.type === 'paragraph' ? [b.listPrefix + b.text] : []))
  const head = paragraphs.slice(0, 12).map((t) => comparable(t))
  let start = head.findIndex((t) => SUBTITLE.test(t)) + 1
  if (start === 0) {
    const title = comparable(config.commonTitle)
    const isHeader = (t: string) =>
      !t || /年度|抄録|要旨/.test(t) || /学部|学科|コース/.test(t) || /学籍番号|氏名|指導教員/.test(t) || (!!title && t.includes(title))
    while (start < head.length && isHeader(head[start])) start++
  }
  return paragraphs
    .slice(start)
    .flatMap((t) => joinLines(t.replace(/\t/g, '　').split('\n')))
    .filter((t) => t.trim() && !isPlaceholderOnly(t))
}

/**
 * 手で入れた改行（Shift+Enter）で分かれた行を、段落にする（「Word から読み込む」と同じ：文の終わりの後に、字下げで始まる行だけを新しい段落にする）
 */
function joinLines(lines: string[]): string[] {
  const out: string[] = []
  for (const line of lines) {
    const last = out[out.length - 1]
    if (last === undefined || !last.trim() || (/^[\s　]/.test(line) && line.trim() && /[。！？」）]$/.test(last.trim()))) out.push(line)
    else out[out.length - 1] = last + line
  }
  return out
}

/** 目次の1行の、後ろの点線とページ番号（「・・・・1」「……3」「\t5」） */
const LEADER = /[\s　\t・･…‥．.·_＿\-－—]*[0-9０-９〇]*[\s　]*$/

export interface HeadingEntry {
  level: 1 | 2
  title: string
}

/** 目次（03_目次.docx）に書いた見出し（「Ⅰ．企画・立案・・・1」「ⅰ．担当衣装のキャラクター」）。仮の名前（〇〇〇〇）は除く */
export function tocHeadings(blocks: WordBlock[]): HeadingEntry[] {
  return blockLines(blocks).flatMap((line) => {
    const h = headingFromText(line.replace(LEADER, ''))
    if (!h) return []
    const title = h.title.replace(LEADER, '').trim()
    return title && !isPlaceholderOnly(title) ? [{ level: h.level, title }] : []
  })
}

/** 本文（04_本文.docx）の見出し（「Ⅰ．」「ⅰ．」で始まる行と、見出しのスタイルの段落）。仮の名前は除く */
export function bodyHeadings(blocks: WordBlock[]): HeadingEntry[] {
  return blocks.flatMap((b) => {
    if (b.type !== 'paragraph') return []
    const text = b.text.replace(/[\n\t]/g, '').trim()
    const h = headingFromText(text) ?? (b.headingLevel && text.length <= 40 ? { level: b.headingLevel, title: text } : null)
    return h && h.title && !isPlaceholderOnly(h.title) ? [{ level: h.level, title: h.title }] : []
  })
}

/** 目次と本文の見出しの違い（目次にだけある・本文にだけある）。目次に見出しが見つからなければ null（確かめない） */
export function headingDifference(toc: HeadingEntry[], body: HeadingEntry[]): { onlyToc: string[]; onlyBody: string[] } | null {
  if (toc.length === 0 || body.length === 0) return null
  const tocKeys = new Set(toc.map((h) => comparable(h.title)))
  const bodyKeys = new Set(body.map((h) => comparable(h.title)))
  return {
    onlyToc: toc.filter((h) => !bodyKeys.has(comparable(h.title))).map((h) => h.title),
    onlyBody: body.filter((h) => !tocKeys.has(comparable(h.title))).map((h) => h.title),
  }
}
