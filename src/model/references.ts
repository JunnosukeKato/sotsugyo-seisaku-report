import type { Reference } from './types'

/** 文献に何か書いてあるか（種類・ID・参照日（はじめから今日の日付が入っている）は除く） */
export function referenceFilled(ref: Reference): boolean {
  return Object.entries(ref).some(([k, v]) => k !== 'type' && k !== 'id' && k !== 'accessedOn' && typeof v === 'string' && v.trim() !== '')
}

/**
 * 引用・参考文献の窓で書いた内容（refs）が、反映してある内容（saved）と違うか（違えば、窓を閉じる前に聞く。app/dialogs.tsx）。
 * 足しただけで何も書いていない文献は、違いに数えない（「＋ 書籍を追加」を押しただけで閉じるときは、聞かずに閉じる）
 */
export function referencesChanged(saved: Reference[], refs: Reference[]): boolean {
  const savedIds = new Set(saved.map((r) => r.id))
  const kept = refs.filter((r) => savedIds.has(r.id) || referenceFilled(r))
  return JSON.stringify(kept) !== JSON.stringify(saved)
}
