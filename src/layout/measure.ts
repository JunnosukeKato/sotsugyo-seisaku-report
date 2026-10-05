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
}

function lineCount(element: Element): number {
  const range = document.createRange()
  range.selectNodeContents(element)
  const tops = new Set<number>()
  for (const rect of range.getClientRects()) {
    if (rect.width > 0 && rect.height > 0) tops.add(Math.round(rect.top))
  }
  return tops.size
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
  }
}

export function samePageNumbers(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((k) => a[k] === b[k])
}
