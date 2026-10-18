import { useEffect, useRef, useState } from 'react'
import type { ReportEditor } from '../editor/reportEditor'
import { noticeText, type UndoNotice } from '../editor/undoNotice'
import { Icon } from './icons'

/** 削除の知らせを出しておく時間（15秒か、次の操作をするまで） */
const REMOVED_MS = 15000
/** 「〜を戻しました」を出しておく時間 */
const RESTORED_MS = 3000

/**
 * 削除したあと、画面の下に「段落を削除しました［戻す］」を出す（mockups/v32 ② 案A。スマホは前から mockups/v23 ⑦ 案A で出していたもの）。
 * PC は紙面の台の下の真ん中、スマホは下のタブの上（ページ送りに重ねる）に出す。
 * - 15秒か、次の操作（書く・足す・ほかを削除するなど）をするまで出し、下の細い線で残りの時間を示す
 * - マウスを重ねている間・キーボードで知らせの中に移っている間は、時間を止める
 * - 「戻す」で元に戻すと「✓ 段落を戻しました」を少しの間出す（戻した所へ移って光らせるのは、編集の中核）
 * 読み上げにも伝わるよう、いつも置いておく枠（role="status"）の中に、知らせを出し入れする。
 * onClose：出しておく時間が過ぎた（useUndoNotice の close）
 */
export function UndoBar({ editor, notice, onClose, className }: { editor: ReportEditor; notice: UndoNotice | null; onClose: (id: number) => void; className?: string }) {
  // 時間を止めている知らせ（マウスを重ねている・中に移っている。知らせが替わったら、止めるのもやめる）
  const [holding, setHolding] = useState<number | null>(null)
  const held = !!notice && holding === notice.id
  // 知らせの残りの時間（止めている間は減らない）
  const left = useRef<{ id: number; ms: number }>({ id: 0, ms: 0 })
  useEffect(() => {
    if (!notice) return
    if (left.current.id !== notice.id) left.current = { id: notice.id, ms: notice.kind === 'removed' ? REMOVED_MS : RESTORED_MS }
    if (held) return
    const state = left.current
    const since = Date.now()
    const timer = window.setTimeout(() => onClose(notice.id), state.ms)
    return () => {
      clearTimeout(timer)
      state.ms = Math.max(0, state.ms - (Date.now() - since))
    }
  }, [notice, held, onClose])
  // 止めるのは「戻す」のある知らせだけ（「戻しました」は、押す物がないので、マウスが乗っていても少しの間で消す）
  const hold = (on: boolean) => notice?.kind === 'removed' && setHolding(on ? notice.id : null)
  return (
    <div className={`undo-area${className ? ` ${className}` : ''}`} role="status">
      {notice && (
        <div
          key={notice.id}
          className={`undo-toast${held ? ' held' : ''}`}
          onFocus={() => hold(true)}
          onBlur={() => hold(false)}
          onPointerEnter={(e) => e.pointerType === 'mouse' && hold(true)}
          onPointerLeave={(e) => e.pointerType === 'mouse' && hold(false)}
        >
          {notice.kind === 'removed' ? (
            <>
              <span>{noticeText(notice)}</span>
              <button onClick={() => editor.undo()}>
                {Icon.undo}戻す
              </button>
              {/* 残りの時間（細い線が右から縮む） */}
              <span className="undo-timer" aria-hidden="true">
                <span style={{ animationDuration: `${REMOVED_MS}ms` }} />
              </span>
            </>
          ) : (
            <span className="undo-done">
              {Icon.check}
              {noticeText(notice)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
