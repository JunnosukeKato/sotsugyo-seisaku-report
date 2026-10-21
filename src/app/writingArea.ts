import { useEffect } from 'react'
import type { ReportEditor } from '../editor/reportEditor'

/**
 * スマホで欄を書いている間、紙面のその欄が、画面の上に出ているもの（はじめての案内）・下に出ているもの（書く欄・削除の知らせなど）・
 * キーボードに隠れないようにする（はじめて使う学生の試しで、案内に沿ってサブタイトルを書くとき、紙面のサブタイトルの行が案内の下に隠れ、
 * どこに入るのか見えなかったため）。紙面を動かすのは編集の中核（editor/reportEditor.ts の revealEditing）
 */

/**
 * 書いている欄を隠しうるもののうち、画面の下に出しているもの（書く欄・削除の知らせ・紙面の下の帯・ページ送りなど）。
 * .direct-bar：スマホで紙面に直接書くときの、キーボードの上の道具（app/Phone.tsx）
 */
const BOTTOM_COVERS = '.edit-sheet.open, .undo-toast, .page-band, .pager, .unzoom, .sel-bar > *, .direct-bar'
/** 上に出していることがあるもの（はじめての案内。書く欄を出している間は、画面の上） */
const TOP_COVERS = '.guide .g-tip, .pinch-tip'

/** 欄と横に重なって見えているものの位置 */
function coversOf(selector: string, field: DOMRect): DOMRect[] {
  return [...document.querySelectorAll<HTMLElement>(selector)]
    .filter((el) => getComputedStyle(el).visibility !== 'hidden')
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0 && r.right > field.left && r.left < field.right)
}

/**
 * 書いている欄（field：紙面での位置）を見せてよい、画面の中の高さの範囲（画面の上からの px）。
 * キーボードより上、下に出ているもの（書く欄など）より上。上に出ている案内より下（案内が下の方にあるときは、案内より上）
 */
export function writingArea(field: DOMRect): { top: number; bottom: number } {
  const vv = window.visualViewport
  let top = vv ? vv.offsetTop : 0
  let bottom = vv ? vv.offsetTop + vv.height : window.innerHeight
  for (const r of coversOf(BOTTOM_COVERS, field)) bottom = Math.min(bottom, r.top)
  for (const r of coversOf(TOP_COVERS, field)) {
    if ((r.top + r.bottom) / 2 < (top + bottom) / 2) top = Math.max(top, r.bottom)
    else bottom = Math.min(bottom, r.top)
  }
  return { top, bottom }
}

/**
 * 書いている間に、書く欄の高さ（文字が増えた・説明が出た）・キーボード・はじめての案内が変わったら、書いている欄が隠れていないか確かめ、
 * 隠れていれば見える所へ動かす（見えていれば動かさない）。watch：変わったら確かめ直すもの（はじめての案内の段階など）
 */
export function useKeepWritingVisible(editor: ReportEditor | null, editingId: string | null, active: boolean, watch: unknown): void {
  useEffect(() => {
    if (!editor || !editingId || !active) return
    let frame = 0
    const check = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => editor.revealEditing(false))
    }
    const resize = new ResizeObserver(check)
    // 案内を隠す・出す（書く欄との間に、欄を見せる高さがないとき。app/StartGuide.tsx の tucked）は、大きさが変わらないので、印の付け外しを見る
    const marks = new MutationObserver(check)
    for (const el of document.querySelectorAll<HTMLElement>('.edit-sheet, .guide .g-tip, .direct-bar, .pinch-tip')) {
      resize.observe(el)
      marks.observe(el, { attributes: true, attributeFilter: ['class'] })
    }
    window.visualViewport?.addEventListener('resize', check)
    window.addEventListener('resize', check)
    check()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      marks.disconnect()
      window.visualViewport?.removeEventListener('resize', check)
      window.removeEventListener('resize', check)
    }
  }, [editor, editingId, active, watch])
}
