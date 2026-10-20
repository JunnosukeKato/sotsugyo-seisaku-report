import { useState, useSyncExternalStore } from 'react'
import type { ReportEditor } from '../editor/reportEditor'
import { WaitToast } from './Busy'
import type { ImageWork, ImageWorkState } from './imageWorkStore'

/**
 * 選んだ写真を縮めて保存している間の「写真を取り込んでいます…」（紙面の上の真ん中。依頼者の要望 2026-10-20）。
 * 編集の中核（editor/reportEditor.ts の onImageWork）から知らせを受けて、ここだけを描き直す
 * （画面全体（App）を描き直すと、遅いスマホでは知らせが出るまで 0.2秒ほどかかったため）
 */

/**
 * 写真を取り込んでいる間と、保存し終えたあと、その写真が紙面に出るまで（組み直し終えるまで）出す知らせ。
 * まとめて選んだときは「（2 / 5枚）」
 */
export function ImageWorkToast({ work, editor }: { work: ImageWork; editor: ReportEditor }) {
  const state = useSyncExternalStore(work.subscribe, work.get)
  const rendering = useSyncExternalStore(editor.subscribe, () => editor.getSnapshot().rendering)
  // 保存し終えたあと、紙面を組み直し終えるまで（描く途中で合わせる。React の「前の値と比べて state を変える」書き方）
  const [tail, setTail] = useState(false)
  const [last, setLast] = useState<ImageWorkState>(null)
  if (state !== last) {
    setLast(state)
    if (!state && last) setTail(true)
  }
  if (tail && !state && !rendering) setTail(false)
  if (!state && !tail) return null
  const text = state && state.total > 1 ? `写真を取り込んでいます…（${Math.min(state.done + 1, state.total)} / ${state.total}枚）` : '写真を取り込んでいます…'
  return <WaitToast className="on-stage" text={text} />
}
