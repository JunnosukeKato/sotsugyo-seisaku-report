import { useEffect, useLayoutEffect, useRef } from 'react'
import type { EditorSnapshot, ReportEditor } from '../editor/reportEditor'
import { TOC_TEXT } from '../layout/document'

/**
 * 目次のページの、行のない所を押したときの小さな知らせ（mockups/v41 案B。押した所のすぐ下に出す）。
 * 目次は本文の見出しから自動で作るので、学生は書けない。押しても何も起きないと「壊れている」「さわれない」と思うため、わけを伝える。
 * 「本文の見出しへ」で、本文の最初の大見出しへ移って書き始める（目次の行を押したときと同じ：editor.goToHeading）。
 * ×・Esc・知らせの外を押すと閉じる。ページを送ったとき（目次のページでなくなったとき）も閉じる。
 * 紙面の外の部品なので、PDF・印刷には出ない（index.css の「v41」）。目次の行を押したときは、この知らせではなく見出しへ移る（reportEditor の onClick）
 */

const svg = (d: string, width = 1.6) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)
const AUTO = svg('M19.2 12a7.2 7.2 0 1 1-2.1-5.1M19.4 4.6v3.6h-3.6', 1.8)
const CLOSE = svg('M7 7l10 10M17 7L7 17')
const NEXT = svg('M9.5 5l7 7-7 7')

/** 押した点と知らせの間・画面の端との間（px） */
const GAP = 16
const EDGE = 8
/** 知らせの先（三角）を、知らせの左の端から、この幅だけ右に置く（押した点が知らせの左寄りに来るように） */
const TAIL_FROM_LEFT = 34

export function TocNotice({ editor, snap, point, onClose }: { editor: ReportEditor; snap: EditorSnapshot; point: { x: number; y: number } | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const onToc = snap.layout?.kinds[snap.page] === 'toc'
  const open = !!point && onToc && !snap.editingId

  // ページを送った・書き始めたら閉じる
  useEffect(() => {
    if (point && !open) onClose()
  }, [point, open, onClose])

  // Esc・知らせの外を押すと閉じる
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [open, onClose])

  // 置く：押した点のすぐ下（下に入りきらなければ上）。左右は画面からはみ出さないように寄せ、先（三角）は押した点に向ける
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !point) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const left = Math.max(EDGE, Math.min(innerWidth - w - EDGE, point.x - TAIL_FROM_LEFT))
    const below = point.y + GAP + h <= innerHeight - EDGE
    el.style.left = `${left}px`
    el.style.top = `${below ? point.y + GAP : Math.max(EDGE, point.y - GAP - h)}px`
    el.style.setProperty('--tail', `${Math.max(14, Math.min(w - 26, point.x - left - 6))}px`)
    el.classList.toggle('above', !below)
  }, [point, open])

  if (!open) return null
  const first = snap.report.body[0]
  return (
    <div className="toc-notice" role="dialog" aria-labelledby="toc-notice-title" ref={ref}>
      <div className="hd">
        {AUTO}
        <b id="toc-notice-title">{TOC_TEXT.noteTitle}</b>
        <button className="x" aria-label="閉じる" title="閉じる（Esc）" onClick={onClose}>
          {CLOSE}
        </button>
      </div>
      <p>{TOC_TEXT.noteBody}</p>
      {first && (
        <button
          className="go"
          onClick={() => {
            onClose()
            void editor.goToHeading(first.id)
          }}>
          {TOC_TEXT.noteButton}
          {NEXT}
        </button>
      )}
    </div>
  )
}
