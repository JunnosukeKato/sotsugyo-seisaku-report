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
 * - 送ると、後ろの表がページをまたいで、図が表の途中（次のページの上）に入ってしまうとき（表が図の前後に分かれる。PDF でも）。
 *   このときは送らずに段落のすぐ下に置く（図は次のページの上に回り、表はその後ろから始まる。今のページの下に空白が残る）
 */

const PAGE_HEIGHT_MM = 297
/** 本文の領域の下端（A4 の下の余白 25mm） */
const CONTENT_BOTTOM_MM = PAGE_HEIGHT_MM - 25
const LINE_MM = (LINE_PITCH_PT * 25.4) / 72
/** これより狭い空白は、送っても埋まらないので気にしない */
const MIN_GAP_MM = 2 * LINE_MM
/** 送れる図のまとまりの高さ（本文の領域 247mm より少し低く） */
const MAX_GROUP_MM = 240

/** 紙面での位置（何ページ目か・ページの上端からの mm） */
export interface Placed {
  page: number
  /** ページの上端からの位置（mm） */
  top: number
  bottom: number
}

/** 組んだ紙面から読み取った、図の送り方を決めるのに使う位置（measureFloatLayout。単体テストでは作り物を渡す） */
export interface FloatLayout {
  /** 図のまとまり（figureRow の ID）の位置（ページをまたげば、ページごとに複数） */
  group(id: string): Placed[]
  /** 段落の位置（ページをまたげば複数） */
  block(id: string): Placed[]
  /** 表（table の ID）の位置（ページをまたげば複数） */
  table(id: string): Placed[]
  /** 表の始まりから、最初の行（見出しの行の次の行。なければ見出しの行）の下端までの高さ（mm。表は、タイトルと最初の行が入らないと、次のページから始まる） */
  tableHead(id: string): number
  /** 前のページの章の続き（本文のページで、章の見出しがない）か */
  continuesChapter(page: number): boolean
  /** ページの本文の、いちばん下の位置（mm） */
  contentBottom(page: number): number
}

/**
 * 今の紙面（deferred を送って組んだもの）から、次に組むときに送る図のまとまりを決める。
 * blocked は、この組み直しの間に「送ると具合が悪い」とわかったまとまり（もう送らない）。
 */
export function reviseDeferredGroups(pages: HTMLElement[], chapters: Chapter[], deferred: ReadonlySet<string>, blocked: Set<string>): Set<string> {
  return decideDeferredGroups(measureFloatLayout(pages), chapters, deferred, blocked)
}

/** 組んだ紙面から、図の送り方を決めるのに使う位置を読み取る */
export function measureFloatLayout(pages: HTMLElement[]): FloatLayout {
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
  return {
    group: (id) => placesOf(`.figure-group[data-group-id="${CSS.escape(id)}"]`),
    block: (id) => placesOf(`[data-block-id="${CSS.escape(id)}"]`),
    table: (id) => placesOf(`.data-table[data-table-id="${CSS.escape(id)}"]`),
    tableHead: (id) => {
      const el = pages.flatMap((page) => [...page.querySelectorAll(`.data-table[data-table-id="${CSS.escape(id)}"]`)])[0]
      const row = el?.querySelector('tbody tr') ?? el?.querySelector('tr')
      const page = el?.closest<HTMLElement>('[data-vivliostyle-page-container]')
      const i = page ? (pageIndex.get(page) ?? -1) : -1
      if (!el || !row || i < 0) return 0
      return toMm(i, row.getBoundingClientRect().bottom) - toMm(i, el.getBoundingClientRect().top)
    },
    continuesChapter: (i) => !!pages[i]?.querySelector('section.body') && !pages[i].querySelector('h1'),
    contentBottom: (i) => {
      const section = pages[i]?.querySelector('section.body')
      if (!section) return 0
      const range = document.createRange()
      range.selectNodeContents(section)
      const rects = [...range.getClientRects()].filter((r) => r.height > 0)
      return Math.max(0, ...rects.map((r) => toMm(i, r.bottom)))
    },
  }
}

/**
 * 送った図（ページ page の上に出る）が、表の途中に入るか：その章の、図より後ろの表が、前のページ（page - 1）と page にまたがっている
 * （表の始まりが前のページにあり、続きが page にある。page の上に送った図は、表の続きの前に出る）
 */
export function landsInTable(layout: FloatLayout, tableIds: string[], page: number): boolean {
  return tableIds.some((id) => {
    const parts = layout.table(id)
    return parts.some((p) => p.page === page - 1) && parts.some((p) => p.page === page)
  })
}

/**
 * まだ送っていない図を送ったら、後ろの表が今のページ（anchorPage）と次のページにまたがりそうか（図が表の途中に入ってしまう）。
 * 今の紙面では、図は次のページ（first）の上にあり、その後ろに表がある。送ると、図の後ろの文章が今のページの空白（gap mm）に上がる。
 * 表の始まりが空白に上がり（図の下端から表の上端までが gap より短い）、表のタイトルと最初の行が空白の残りに入り（入らなければ、表は丸ごと次のページから始まる）、
 * かつ表が空白に収まりきらない（次のページへ続いている・表の下端までが gap より長い）なら、またがる。
 * 見積もりなので、外れたときは、送って組んだあとに確かめて送るのをやめる（landsInTable）
 */
export function wouldSplitTable(layout: FloatLayout, tableIds: string[], first: Placed, gap: number): boolean {
  return tableIds.some((id) => {
    const parts = layout.table(id)
    const start = parts[0]
    if (!start || start.page !== first.page) return false
    const rises = start.top - first.bottom < gap
    const headFits = layout.tableHead(id) <= gap - (start.top - first.bottom)
    const overflows = parts.length > 1 || start.bottom - first.bottom > gap
    return rises && headFits && overflows
  })
}

/** 組んだ紙面の位置（layout）から、次に組むときに送る図のまとまりを決める（reviseDeferredGroups の中身。紙面の要素を見ない） */
export function decideDeferredGroups(layout: FloatLayout, chapters: Chapter[], deferred: ReadonlySet<string>, blocked: Set<string>): Set<string> {
  const next = new Set<string>()
  // 送っている図のうち、いちばん後ろの位置（後の図がそれより前に出ないようにする）
  let lastDeferred: Placed | null = null
  for (const chapter of chapters) {
    for (let index = 0; index < chapter.blocks.length; index++) {
      const block = chapter.blocks[index]
      if (block.type !== 'figureRow' || blocked.has(block.id)) continue
      const prev = chapter.blocks[index - 1]
      const after = chapter.blocks[index + 1]
      const group = layout.group(block.id)
      const anchor = prev?.type === 'paragraph' ? layout.block(prev.id).at(-1) : undefined
      if (!group.length || !anchor) continue
      const first = group[0]
      // この図より後ろの、同じ章の表（送った図が、表の途中に入らないか確かめる）
      const tablesAfter = chapter.blocks.slice(index + 1).flatMap((b) => (b.type === 'table' ? [b.id] : []))

      if (deferred.has(block.id)) {
        // 送った図：段落の次のページの上に出ていればよい。段落と同じページなら（もう入りきる）送るのをやめる
        if (first.page === anchor.page) continue
        if (first.page !== anchor.page + 1 || !layout.continuesChapter(first.page) || landsInTable(layout, tablesAfter, first.page)) {
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
      const rest = layout.contentBottom(first.page) - first.bottom - LINE_MM
      if (!layout.continuesChapter(first.page + 1) && rest < gap + LINE_MM) continue
      // 送ると、後ろの表が今のページと次のページにまたがり、図が表の途中に入ってしまう（組んでから確かめて送るのをやめると、組み直しが増えるので、先に見積もる）
      if (wouldSplitTable(layout, tablesAfter, first, gap)) continue
      next.add(block.id)
    }
  }
  return next
}

export function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x))
}
