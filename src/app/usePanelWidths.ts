import { useCallback, useEffect, useRef, useState } from 'react'
import { PAGE_W } from '../editor/pageStage'

/**
 * PC：左（ページの一覧）と右（セルフチェックなど）の欄の幅。欄の境目をつかんで動かすと変わり、ダブルクリックで元に戻る。
 * 決めた幅はこのブラウザに覚えておく（使う人ごとの見やすさの設定。覚えておけなくても既定の幅で動く）
 */

export type PanelSide = 'left' | 'right'
type Widths = Record<PanelSide, number>

const KEY = 'sotsugyo-seisaku-report-panels'
export const PANEL_DEFAULTS: Widths = { left: 124, right: 312 }
const LIMITS: Record<PanelSide, [number, number]> = { left: [96, 280], right: [260, 540] }
/** 一覧の見本の幅は、欄の幅から左右の余白とスクロールバーの分を引いたもの */
const THUMB_GUTTER = 40

const clamp = (side: PanelSide, w: number) => Math.round(Math.max(LIMITS[side][0], Math.min(LIMITS[side][1], w)))

function load(): Widths {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Widths> | null
    if (v && typeof v.left === 'number' && typeof v.right === 'number') return { left: clamp('left', v.left), right: clamp('right', v.right) }
  } catch {
    // 覚えておいた幅を読めなくても、既定の幅で動く
  }
  return PANEL_DEFAULTS
}

export function usePanelWidths() {
  const [widths, setWidths] = useState<Widths>(load)
  // つかんだときの幅（動かしている間の計算に使う）
  const current = useRef(widths)

  useEffect(() => {
    current.current = widths
    try {
      localStorage.setItem(KEY, JSON.stringify(widths))
    } catch {
      // 覚えておけなくても、今は変えた幅で動く
    }
  }, [widths])

  /** 欄の境目をつかんだ：動かした分だけ欄の幅を変える */
  const startDrag = useCallback((side: PanelSide, e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const start = current.current[side]
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      setWidths((prev) => ({ ...prev, [side]: clamp(side, side === 'left' ? start + dx : start - dx) }))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('resizing')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    document.body.classList.add('resizing')
  }, [])

  const reset = useCallback((side: PanelSide) => setWidths((prev) => ({ ...prev, [side]: PANEL_DEFAULTS[side] })), [])

  const mini = Math.max(48, widths.left - THUMB_GUTTER)
  const style = {
    '--left-w': `${widths.left}px`,
    '--right-w': `${widths.right}px`,
    '--mini-w': `${mini}px`,
    '--mini-scale': String(mini / PAGE_W),
  } as React.CSSProperties

  return { style, startDrag, reset }
}
