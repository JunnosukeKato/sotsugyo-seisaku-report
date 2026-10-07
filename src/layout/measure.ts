import type { Chapter } from '../model/types'
import { chapterAnchor } from './bodyHtml'
import { REFERENCES_ANCHOR } from './document'

/**
 * 組版された紙面（ページの要素）から、セルフチェックと目次に使う情報を読み取る。
 * 紙面の各ページには、元の <section class="cover|abstract|toc|body|references|photos"> が複製されて入っている。
 */

export type PageKind = 'cover' | 'abstract' | 'toc' | 'body' | 'references' | 'photos' | 'unknown'

export function pageKind(page: HTMLElement): PageKind {
  const section = page.querySelector('section')
  const classes = section?.classList
  if (!classes) return 'unknown'
  for (const kind of ['cover', 'abstract', 'toc', 'body', 'references', 'photos'] as const) {
    if (classes.contains(kind)) return kind
  }
  return 'unknown'
}

export interface LayoutInfo {
  kinds: PageKind[]
  /** 本文のページ数（引用・参考文献のページは含めない） */
  bodyPages: number
  /** 抄録のページ数（1ページに収まっていなければ 2 以上） */
  abstractPages: number
  /** 抄録本文の行数 */
  abstractLines: number
  /** 目次に載せるページ番号 */
  tocPageNumbers: Record<string, number>
  /** 本文の各ページにある図の数 */
  figuresPerBodyPage: number[]
  /** 学生が入れた改ページと、そのページの空いている割合（0〜1。本文の領域のうち、改ページより下） */
  pageBreaks: { id: string; page: number; emptyRatio: number }[]
  /**
   * 表紙のサブタイトルの1行：組んだ文字の大きさ（pt）と、文字の幅 ÷ 枠の幅（ratio。1 をこえるとはみ出している）。
   * chars は入力した部分の字数、fitChars はこの大きさで入りそうな字数（はみ出したときの知らせに使う）
   */
  coverSubtitle?: { fontPt: number; ratio: number; chars: number; fitChars: number }
}

/** 本文の領域（A4 の上下の余白 25mm を除く） */
const CONTENT_TOP_MM = 25
const CONTENT_BOTTOM_MM = 297 - 25

function lineCount(element: Element): number {
  const range = document.createRange()
  range.selectNodeContents(element)
  const tops = new Set<number>()
  for (const rect of range.getClientRects()) {
    if (rect.width > 0 && rect.height > 0) tops.add(Math.round(rect.top))
  }
  return tops.size
}

/**
 * 1行の欄（折り返さない）の、文字の幅 ÷ 欄の幅。文字のない欄は null。
 * 入力していない欄の仮の文字（::before）は数えないよう、文字そのものの位置から測る
 */
function lineRatio(el: HTMLElement): number | null {
  const box = el.getBoundingClientRect()
  const range = document.createRange()
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let left = Infinity
  let right = -Infinity
  while (walker.nextNode()) {
    range.selectNodeContents(walker.currentNode)
    const r = range.getBoundingClientRect()
    if (!r.width) continue
    left = Math.min(left, r.left)
    right = Math.max(right, r.right)
  }
  return right > left && box.width > 0 ? (right - left) / box.width : null
}

/** 表紙のサブタイトルが枠に入っているか（LayoutInfo.coverSubtitle） */
function measureCoverSubtitle(pages: HTMLElement[], kinds: PageKind[]): LayoutInfo['coverSubtitle'] {
  const el = pages[kinds.indexOf('cover')]?.querySelector<HTMLElement>('.cover .subtitle')
  const ratio = el ? lineRatio(el) : null
  if (!el || ratio === null) return undefined
  const total = [...(el.textContent ?? '')].length
  const chars = [...(el.querySelector('[data-block-id]')?.textContent ?? '')].length
  return {
    fontPt: Math.round(parseFloat(getComputedStyle(el).fontSize) * 0.75 * 10) / 10,
    ratio,
    chars,
    // 決まり文句（―・の衣装制作― など）の字数は変わらないので、全体で入る字数から引く
    fitChars: Math.max(0, Math.floor(total / ratio) - (total - chars)),
  }
}

export function measureLayout(pages: HTMLElement[], chapters: Chapter[]): LayoutInfo {
  const kinds = pages.map(pageKind)
  const bodyStart = kinds.indexOf('body')
  const pageNumberOf = (selector: string) => {
    const index = pages.findIndex((page) => page.querySelector(selector))
    return index >= 0 && bodyStart >= 0 ? index - bodyStart + 1 : 0
  }
  const tocPageNumbers: Record<string, number> = {}
  for (const chapter of chapters) {
    const n = pageNumberOf(`#${CSS.escape(chapterAnchor(chapter.id))}`)
    if (n > 0) tocPageNumbers[chapter.id] = n
  }
  const referencesPage = pageNumberOf(`#${REFERENCES_ANCHOR}`)
  if (referencesPage > 0) tocPageNumbers[REFERENCES_ANCHOR] = referencesPage

  const abstractParagraphs = pages.filter((_, i) => kinds[i] === 'abstract').flatMap((page) => [...page.querySelectorAll('.abstract .body p')])
  return {
    kinds,
    bodyPages: kinds.filter((k) => k === 'body').length,
    abstractPages: kinds.filter((k) => k === 'abstract').length,
    abstractLines: abstractParagraphs.reduce((n, p) => n + lineCount(p), 0),
    tocPageNumbers,
    figuresPerBodyPage: pages.filter((_, i) => kinds[i] === 'body').map((page) => page.querySelectorAll('figure').length),
    pageBreaks: pages.flatMap((page, i) =>
      [...page.querySelectorAll<HTMLElement>('.page-break[data-block-id]')].map((el) => {
        const p = page.getBoundingClientRect()
        const top = ((el.getBoundingClientRect().top - p.top) / p.height) * 297
        const emptyRatio = Math.max(0, Math.min(1, (CONTENT_BOTTOM_MM - top) / (CONTENT_BOTTOM_MM - CONTENT_TOP_MM)))
        return { id: el.dataset.blockId!, page: i, emptyRatio }
      }),
    ),
    coverSubtitle: measureCoverSubtitle(pages, kinds),
  }
}

export function samePageNumbers(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((k) => a[k] === b[k])
}
