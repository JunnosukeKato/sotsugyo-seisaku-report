import { useEffect, useRef } from 'react'
import type { EditorSnapshot, ReportEditor } from '../editor/reportEditor'

/**
 * 最後に見ていたページを、この端末（ブラウザ）に覚えておき、次に開いたときに、表紙ではなくそのページを見せる
 * （開くたびに表紙に戻り、続きのページを探す手間があったため）。
 * 覚えるのは、ページの番号と、そのページにある欄の目印（ID）だけ（原稿の文字は入れない）。
 * 欄の目印で探すので、ページが前後にずれても（ほかの端末で書き足した、など）同じ所を開く。
 * その欄がもうなければ覚えたページの番号で開き、そのページもなければ表紙を開く。
 * PC では、表示の大きさ（「全体」か「拡大」か）も覚えておき、開いたときに戻す（useRememberZoom）
 */

const PLACE_KEY = 'sotsugyo-seisaku-report-place'

export interface LastPlace {
  /** 見ていたページ（0 から） */
  page: number
  /** そのページで始まる欄の ID */
  blockId?: string
}

/** 覚えている場所（なければ・読めなければ null） */
export function loadPlace(): LastPlace | null {
  try {
    const place = JSON.parse(localStorage.getItem(PLACE_KEY) ?? 'null') as Partial<LastPlace> | null
    if (!place || !Number.isInteger(place.page)) return null
    return typeof place.blockId === 'string' ? { page: place.page!, blockId: place.blockId } : { page: place.page! }
  } catch {
    return null
  }
}

export function savePlace(place: LastPlace): void {
  try {
    localStorage.setItem(PLACE_KEY, JSON.stringify(place))
  } catch {
    // 覚えておけなくても、続けられる（次に開いたときは表紙から）
  }
}

/**
 * 覚える場所：見ているページと、そのページで始まる欄（書いている・最後に触った欄 touchedId がそのページで始まっていればそれ、
 * なければそのページでいちばん上の欄）。pageOfBlock：欄が始まるページ（紙面になければ -1）
 */
export function placeOf(page: number, touchedId: string | null, pageOfBlock: (id: string) => number, firstBlockOn: (page: number) => string | null): LastPlace {
  const blockId = (touchedId && pageOfBlock(touchedId) === page ? touchedId : null) ?? firstBlockOn(page)
  return blockId ? { page, blockId } : { page }
}

/** 開くページ（0 から）。覚えた欄があればそのページ、なければ覚えたページ、それもなければ表紙 */
export function pageToOpen(place: LastPlace | null, pageCount: number, pageOfBlock: (id: string) => number): number {
  if (!place) return 0
  const byBlock = place.blockId ? pageOfBlock(place.blockId) : -1
  if (byBlock >= 0) return byBlock
  return place.page >= 0 && place.page < pageCount ? place.page : 0
}

/** 覚えている場所のページを見せる（原稿を読み込み、紙面を組み終えたあとに呼ぶ） */
export async function openLastPlace(editor: ReportEditor): Promise<void> {
  const page = pageToOpen(loadPlace(), editor.getSnapshot().pageCount, (id) => editor.pageOfBlock(id))
  if (page > 0) await editor.goToPage(page, 'none')
}

// ---- PC の表示の大きさ（「全体」・「拡大」）も覚える ----
// 読み込み直すと、ページは戻っても、表示が「拡大」から「全体」に戻っていたため。覚えるのは「全体」か「拡大」かだけ。
// スマホは覚えない（スマホの拡大は、書いている間だけ。ページを替えると全体に戻る）

const ZOOM_KEY = 'sotsugyo-seisaku-report-zoom'

/** 覚えている表示の大きさ（拡大なら true。覚えていない・読めなければ false＝全体） */
export function loadZoom(): boolean {
  try {
    return localStorage.getItem(ZOOM_KEY) === 'zoom'
  } catch {
    return false
  }
}

export function saveZoom(zoomed: boolean): void {
  try {
    localStorage.setItem(ZOOM_KEY, zoomed ? 'zoom' : 'fit')
  } catch {
    // 覚えておけなくても、続けられる（次に開いたときは「全体」から）
  }
}

/**
 * PC：開いたときに、覚えている表示の大きさ（拡大）にし、そのあとは「全体」・「拡大」を替えるたびに覚える。
 * active：覚えた場所を開き終えた・このタブで書ける（useRememberPlace と同じ）。narrow：スマホの並べ方（覚えない・戻さない）
 */
export function useRememberZoom(editor: ReportEditor | null, snap: EditorSnapshot | null, active: boolean, narrow: boolean): void {
  const restored = useRef(false)
  const zoomed = snap?.zoomed
  const ready = !!snap?.layout
  useEffect(() => {
    if (!editor || !active || !ready || narrow || zoomed === undefined) return
    // はじめの1回は、覚えている大きさに戻す（開いた直後の「全体」で、覚えている「拡大」を上書きしない）
    if (!restored.current) {
      restored.current = true
      if (loadZoom() && !zoomed) editor.setZoom(true)
      return
    }
    saveZoom(zoomed)
  }, [editor, active, ready, narrow, zoomed])
}

/**
 * 見ているページが変わったら（紙面を組み直して、欄のページがずれたときも）覚える。
 * active：覚えた場所を開き終えた・このタブで書ける（別のタブで開いていて書けないタブは、書いているタブの場所を上書きしない）
 */
export function useRememberPlace(editor: ReportEditor | null, snap: EditorSnapshot | null, active: boolean): void {
  const last = useRef('')
  const page = snap?.page
  const ready = !!snap?.layout && !snap.rendering
  const touchedId = snap ? (snap.editingId ?? snap.currentId) : null
  useEffect(() => {
    if (!editor || !active || !ready || page === undefined) return
    const place = placeOf(page, touchedId, (id) => editor.pageOfBlock(id), (p) => editor.firstBlockOn(p))
    const text = JSON.stringify(place)
    if (text === last.current) return
    last.current = text
    savePlace(place)
  }, [editor, active, ready, page, touchedId])
}
