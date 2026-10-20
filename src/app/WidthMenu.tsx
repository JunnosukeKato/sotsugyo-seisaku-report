import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { ReportEditor } from '../editor/reportEditor'
import type { TableBlock } from '../model/types'
import { Icon } from './icons'
import { SHORT_SWITCH_NAMES, twoLines, WIDTH_CHOICES, widthChoice } from './tableSwitches'
import { keepFocus } from './uiShared'

/** 窓の幅（px） */
const POP_W = 254

/**
 * スマホの「列の幅」（mockups/v42 案B）：ボタンに、いまの形と小さな下向きの印。押すと、すぐ上に小さな窓が開き、3つから選ぶ（いまの形に印）。
 * 選ぶ・窓の外を押す・Esc で閉じる。窓は画面に止めて出す（道具の段は横にずらせるので、その中に置くと切れて見えるため）。
 * variant：direct＝紙面に直接書くときのキーボードの上の道具、sel＝表を選んだときの下の道具、sheet＝予備の下の書く欄の道具
 */
export function WidthMenu({ editor, table, tableId, variant }: { editor: ReportEditor; table: TableBlock; tableId: string; variant: 'direct' | 'sel' | 'sheet' }) {
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState<{ left: number; bottom: number; tail: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const now = widthChoice(table)
  const place = () => {
    const r = button.current?.getBoundingClientRect()
    if (!r) return
    const left = Math.max(8, Math.min(innerWidth - POP_W - 8, r.left + r.width / 2 - POP_W * 0.6))
    setAt({ left, bottom: innerHeight - r.top + 9, tail: r.left + r.width / 2 - left })
  }
  useLayoutEffect(() => {
    if (open) place()
  }, [open])
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      const t = e.target as Node
      if (!pop.current?.contains(t) && !button.current?.contains(t)) setOpen(false)
    }
    // Esc は窓を閉じるだけ（書いている欄は、書いたまま）
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      setOpen(false)
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', key, true)
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', key, true)
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('resize', place)
    }
  }, [open])
  const choose = (value: TableBlock['widths']) => {
    setOpen(false)
    editor.setTableWidths(tableId, value)
  }
  const face =
    variant === 'direct' ? (
      <>
        <small>列の幅</small>
        <b>
          {now.name}
          {Icon.chevronDown}
        </b>
      </>
    ) : variant === 'sel' ? (
      <>
        <span>列の幅</span>
        <b>
          {twoLines(now.name)}
          {Icon.chevronDown}
        </b>
      </>
    ) : (
      <>
        {SHORT_SWITCH_NAMES.widths}：{now.name}
        {Icon.chevronDown}
      </>
    )
  return (
    <>
      <button
        ref={button}
        className={`width-menu ${variant === 'direct' ? 'db-width' : variant === 'sel' ? 'tb width-toggle' : ''}${open ? ' open' : ''}`}
        aria-haspopup="true"
        aria-expanded={open}
        title={`列の幅：${now.name}（押すと、3つから選ぶ）`}
        onMouseDown={keepFocus}
        onClick={() => setOpen((o) => !o)}
      >
        {face}
      </button>
      {open && (
        <div ref={pop} className="width-pop" role="dialog" aria-label="列の幅" style={at ? ({ left: `${at.left}px`, bottom: `${at.bottom}px`, '--tail': `${at.tail}px` } as CSSProperties) : { visibility: 'hidden' }}>
          <div className="wp-head">列の幅</div>
          <div role="radiogroup" aria-label="列の幅">
            {WIDTH_CHOICES.map((c) => (
              <button key={c.value} role="radio" aria-checked={c.value === table.widths} className={c.value === table.widths ? 'on' : ''} onMouseDown={keepFocus} onClick={() => choose(c.value)}>
                <i aria-hidden="true" />
                <span>
                  <b>{c.name}</b>
                  <small>{c.sub}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
