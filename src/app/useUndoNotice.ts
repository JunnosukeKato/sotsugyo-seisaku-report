import { useCallback, useState } from 'react'
import type { EditorSnapshot } from '../editor/reportEditor'
import type { UndoNotice } from '../editor/undoNotice'

/**
 * 画面の下に出す、削除・戻したあとの知らせ（mockups/v32 ② 案A。部品は UndoBar.tsx）。
 * 知らせは編集の中核が出し、ほかを変えたら・書き始めたら消す。ここでは、出しておく時間が過ぎた知らせを閉じる
 */
export function useUndoNotice(snap: EditorSnapshot | null): { notice: UndoNotice | null; close: (id: number) => void } {
  const [closed, setClosed] = useState<number | null>(null)
  const notice = snap?.notice && snap.notice.id !== closed ? snap.notice : null
  const close = useCallback((id: number) => setClosed(id), [])
  return { notice, close }
}
