import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReportEditor } from '../editor/reportEditor'
import { headingNotice, noticeText, tableCutNotice, undoable, type UndoNotice } from '../editor/undoNotice'
import { Icon } from './icons'
import { keepFocus } from './uiShared'

/** 見出しにした知らせの、終わりの何文字かを1行にまとめる（「た」だけが次の行に出ないように。index.css の「段落に打った見出し」） */
const KEEP_TAIL = 5

/** 知らせの言葉。見出しにした知らせは、終わりの何文字かを折り返さないまとまりにする */
function NoticeWords({ notice }: { notice: UndoNotice }) {
  const text = noticeText(notice)
  if (!headingNotice(notice) || text.length <= KEEP_TAIL * 2) return <span>{text}</span>
  return (
    <span>
      {text.slice(0, -KEEP_TAIL)}
      <span className="undo-keep">{text.slice(-KEEP_TAIL)}</span>
    </span>
  )
}

/** 削除の知らせを出しておく時間（15秒か、次の操作をするまで）。「抄録を書き始めました［戻す］」も同じ */
const REMOVED_MS = 15000
/** 「〜を戻しました」を出しておく時間 */
const RESTORED_MS = 3000
/** 戻すもののない短い知らせ（表の行・列を消せないわけなど）を出しておく時間（読み終えられるように、少し長め） */
const INFO_MS = 8000

/**
 * 削除したあと、画面の下に「段落を削除しました［戻す］」を出す（mockups/v32 ② 案A。スマホは前から mockups/v23 ⑦ 案A で出していたもの）。
 * PC は紙面の台の下の真ん中、スマホは下のタブの上（ページ送り・選んでいる物の道具・紙面の下の帯に重ねず、その上）に出す。
 * - 15秒か、次の操作（書く・足す・ほかを削除するなど）をするまで出し、下の細い線で残りの時間を示す
 * - マウスを重ねている間・キーボードで知らせの中に移っている間は、時間を止める
 * - 「戻す」で元に戻すと「✓ 段落を戻しました」を少しの間出す（戻した所へ移って光らせるのは、編集の中核）
 * - 抄録を書き始めたとき（「抄録を書き始めました［戻す］」）と、表の行・列を消せないとき（わけだけ。8秒）も、ここに出す
 * - 段落に「Ⅲ．まとめ」のように打って見出しにしたとき（「大見出し「Ⅲ．まとめ」にしました［戻す］」）も。書いている間も出すので、
 *   「戻す」を押しても書く欄からフォーカスを移さない（スマホで書く欄が閉じて、知らせが動くと、押したつもりの所から外れるため）
 * 読み上げにも伝わるよう、いつも置いておく枠（role="status"）の中に、知らせを出し入れする。
 * onClose：出しておく時間が過ぎた（useUndoNotice の close）。
 * place：知らせを出すたびに（画面が描き直されるたびに）、知らせの枠の位置を決める（スマホ：ページ送りや帯に重ねない。Phone.tsx）
 */
export function UndoBar({
  editor,
  notice,
  onClose,
  className,
  place,
}: {
  editor: ReportEditor
  notice: UndoNotice | null
  onClose: (id: number) => void
  className?: string
  place?: (area: HTMLElement) => void
}) {
  const areaRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (areaRef.current && notice) place?.(areaRef.current)
  })
  // 時間を止めている知らせ（マウスを重ねている・中に移っている。知らせが替わったら、止めるのもやめる）
  const [holding, setHolding] = useState<number | null>(null)
  const held = !!notice && holding === notice.id
  // 知らせの残りの時間（止めている間は減らない）
  const left = useRef<{ id: number; ms: number }>({ id: 0, ms: 0 })
  useEffect(() => {
    if (!notice) return
    if (left.current.id !== notice.id) left.current = { id: notice.id, ms: undoable(notice) ? REMOVED_MS : notice.kind === 'info' ? INFO_MS : RESTORED_MS }
    if (held) return
    const state = left.current
    const since = Date.now()
    const timer = window.setTimeout(() => onClose(notice.id), state.ms)
    return () => {
      clearTimeout(timer)
      state.ms = Math.max(0, state.ms - (Date.now() - since))
    }
  }, [notice, held, onClose])
  // 止めるのは「戻す」のある知らせと、わけを伝える知らせだけ（「戻しました」は、押す物がないので、マウスが乗っていても少しの間で消す）
  const hold = (on: boolean) => !!notice && (undoable(notice) || notice.kind === 'info') && setHolding(on ? notice.id : null)
  return (
    <div className={`undo-area${className ? ` ${className}` : ''}`} role="status" ref={areaRef}>
      {notice && (
        <div
          key={notice.id}
          className={`undo-toast${held ? ' held' : ''}`}
          onFocus={() => hold(true)}
          onBlur={() => hold(false)}
          onPointerEnter={(e) => e.pointerType === 'mouse' && hold(true)}
          onPointerLeave={(e) => e.pointerType === 'mouse' && hold(false)}
        >
          {undoable(notice) ? (
            <>
              <NoticeWords notice={notice} />
              <button onMouseDown={headingNotice(notice) || tableCutNotice(notice) ? keepFocus : undefined} onClick={() => editor.undo()}>
                {Icon.undo}戻す
              </button>
              {/* 残りの時間（細い線が右から縮む） */}
              <span className="undo-timer" aria-hidden="true">
                <span style={{ animationDuration: `${REMOVED_MS}ms` }} />
              </span>
            </>
          ) : notice.kind === 'info' ? (
            // 戻すもののない知らせ（表の行・列を消せないわけなど）：言葉だけ
            <span className="undo-info">{noticeText(notice)}</span>
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
