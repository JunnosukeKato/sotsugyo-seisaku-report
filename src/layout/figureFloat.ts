import type { Chapter } from '../model/types'
import { LINE_PITCH_PT } from './reportCss'

/**
 * 図のまとまりを「次のページの上へ送る」かどうかを、組んだ紙面を見て決める。
 *
 * 図は段落のすぐ下に置くが、ページの残りに入りきらないと、図ごと次のページへ回り、ページの下に空白が残る。
 * そのときは図だけを次のページの上へ送り（組版エンジンのページフロート）、後ろの文章で今のページを埋める。
 * ただし入りきる図まで送ると、ページの上（段落より上）に出てしまうため、組むたびに確かめて選び直す。
 *
 * 送らないもの：
 * - 図のすぐ後ろが別の図のまとまり、または章の終わり（埋める文章がない）
 * - 章の残りの文章が少なく、図だけが次の章のページに回ってしまうとき（次の章の見出しより上に出てしまう）
 * - 1ページに収まらない高さのまとまり
 */

const PAGE_HEIGHT_MM = 297
/** 本文の領域の下端（A4 の下の余白 25mm） */
const CONTENT_BOTTOM_MM = PAGE_HEIGHT_MM - 25
const LINE_MM = (LINE_PITCH_PT * 25.4) / 72
/** これより狭い空白は、送っても埋まらないので気にしない */
const MIN_GAP_MM = 2 * LINE_MM
/** 送れる図のまとまりの高さ（本文の領域 247mm より少し低く） */
const MAX_GROUP_MM = 240

interface Placed {
  page: number
  /** ページの上端からの位置（mm） */
  top: number
  bottom: number
}

/**
 * 今の紙面（deferred を送って組んだもの）から、次に組むときに送る図のまとまりを決める。
 * blocked は、この組み直しの間に「送ると具合が悪い」とわかったまとまり（もう送らない）。
 */
export function reviseDeferredGroups(pages: HTMLElement[], chapters: Chapter[], deferred: ReadonlySet<string>, blocked: Set<string>): Set<string> {
  const pageIndex = new Map(pages.map((p, i) => [p, i]))
  const toMm = (i: number, y: number) => {
    const r = pages[i].getBoundingClientRect()
    return ((y - r.top) / r.height) * PAGE_HEIGHT_MM
  }
  const placesOf = (selector: string): Placed[] =>
    pages.flatMap((page, i) =>
      [...page.querySelectorAll(selector)].map((el) => {
        const r = el.getBoundingClientRect()
        return { page: pageIndex.get(page) ?? i, top: toMm(i, r.top), bottom: toMm(i, r.bottom) }
      }),
    )
  /** 前のページの章の続き（本文のページで、章の見出しがない） */
  const continuesChapter = (i: number) => !!pages[i]?.querySelector('section.body') && !pages[i].querySelector('h1')
  /** ページの本文の、いちばん下の位置 */
  const contentBottom = (i: number) => {
    const section = pages[i]?.querySelector('section.body')
    if (!section) return 0
    const range = document.createRange()
    range.selectNodeContents(section)
    const rects = [...range.getClientRects()].filter((r) => r.height > 0)
    return Math.max(0, ...rects.map((r) => toMm(i, r.bottom)))
  }

  const next = new Set<string>()
  // 送っている図のうち、いちばん後ろの位置（後の図がそれより前に出ないようにする）
  let lastDeferred: Placed | null = null
  for (const chapter of chapters) {
    for (let index = 0; index < chapter.blocks.length; index++) {
      const block = chapter.blocks[index]
      if (block.type !== 'figureRow' || blocked.has(block.id)) continue
      const prev = chapter.blocks[index - 1]
      const after = chapter.blocks[index + 1]
      const group = placesOf(`.figure-group[data-group-id="${CSS.escape(block.id)}"]`)
      const anchor = prev?.type === 'paragraph' ? placesOf(`[data-block-id="${CSS.escape(prev.id)}"]`).at(-1) : undefined
      if (!group.length || !anchor) continue
      const first = group[0]

      if (deferred.has(block.id)) {
        // 送った図：段落の次のページの上に出ていればよい。段落と同じページなら（もう入りきる）送るのをやめる
        if (first.page === anchor.page) continue
        if (first.page !== anchor.page + 1 || !continuesChapter(first.page)) {
          blocked.add(block.id)
          continue
        }
        next.add(block.id)
        lastDeferred = first
        continue
      }

      // 前の図を送ったために、この図がそれより前に出てしまったら、この図も送る（図の順番を守る）
      if (lastDeferred && (first.page < lastDeferred.page || (first.page === lastDeferred.page && first.top < lastDeferred.top))) {
        next.add(block.id)
        continue
      }

      // 段落のすぐ下に入りきらず、図ごと次のページへ回ったか
      if (first.page !== anchor.page + 1 || group.length > 1) continue
      const gap = CONTENT_BOTTOM_MM - anchor.bottom
      if (gap < MIN_GAP_MM || first.bottom - first.top > MAX_GROUP_MM) continue
      if (!after || after.type === 'figureRow') continue
      // 章の残りの文章で空いたところを埋めきって、なお図のページに文章が残るか（残らないと、図だけが次の章のページに回る）
      const rest = contentBottom(first.page) - first.bottom - LINE_MM
      if (!continuesChapter(first.page + 1) && rest < gap + LINE_MM) continue
      next.add(block.id)
    }
  }
  return next
}

export function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x))
}
