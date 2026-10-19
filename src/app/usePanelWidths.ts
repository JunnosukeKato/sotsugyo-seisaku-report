import { useCallback, useEffect, useRef, useState } from 'react'
import { PAGE_W } from '../editor/pageStage'

/**
 * PC：左（ページの一覧）と右（セルフチェックなど）の欄の幅。欄の境目をつかんで動かすと変わり、ダブルクリックで元に戻る。
 * 決めた幅はこのブラウザに覚えておく（使う人ごとの見やすさの設定。覚えておけなくても既定の幅で動く）。
 * 覚えておくのは、使う人が動かした欄の幅だけ（動かしていない欄は、既定の幅が変わればそれに合わせる）
 */

export type PanelSide = 'left' | 'right'
type Widths = Record<PanelSide, number>

const KEY = 'sotsugyo-seisaku-report-panels'
/** 既定の幅。右は 312 → 340px（mockups/v37：字を大きくしたので、長い指摘が1行に収まるように。紙の大きさは画面の高さで決まるので変わらない） */
export const PANEL_DEFAULTS: Widths = { left: 124, right: 340 }
/**
 * 前の既定の幅。前の版は、開くたびに（動かしていなくても）既定の幅を覚えていたので、この幅が覚えてあれば、
 * 使う人が決めた幅ではなく既定の幅として読む（右の欄が 312px のまま残らないように）
 */
const PAST_DEFAULTS: Record<PanelSide, number[]> = { left: [124], right: [312] }
const LIMITS: Record<PanelSide, [number, number]> = { left: [96, 280], right: [260, 540] }
/** 一覧の見本の幅は、欄の幅から左右の余白とスクロールバーの分を引いたもの */
const THUMB_GUTTER = 40

const clamp = (side: PanelSide, w: number) => Math.round(Math.max(LIMITS[side][0], Math.min(LIMITS[side][1], w)))

/** 使う人が決めた幅（決めていない欄はない） */
type Chosen = Partial<Widths>

/** 覚えておいた幅を読む（raw：このブラウザに覚えてある文字。既定の幅・前の既定の幅と同じ欄は、決めていないものとする） */
export function readPanelWidths(raw: string | null): Chosen {
  const chosen: Chosen = {}
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<Record<PanelSide, unknown>> | null
    for (const side of ['left', 'right'] as const) {
      const w = v?.[side]
      if (typeof w !== 'number' || !Number.isFinite(w)) continue
      const c = clamp(side, w)
      if (c !== PANEL_DEFAULTS[side] && !PAST_DEFAULTS[side].includes(c)) chosen[side] = c
    }
  } catch {
    // 覚えておいた幅を読めなくても、既定の幅で動く
  }
  return chosen
}

function load(): Chosen {
  try {
    return readPanelWidths(localStorage.getItem(KEY))
  } catch {
    return {}
  }
}

export function usePanelWidths() {
  const [chosen, setChosen] = useState<Chosen>(load)
  const widths: Widths = { ...PANEL_DEFAULTS, ...chosen }
  // つかんだときの幅（動かしている間の計算に使う）
  const current = useRef(chosen)

  useEffect(() => {
    current.current = chosen
    try {
      localStorage.setItem(KEY, JSON.stringify(chosen))
    } catch {
      // 覚えておけなくても、今は変えた幅で動く
    }
  }, [chosen])

  /** 欄の境目をつかんだ：動かした分だけ欄の幅を変える */
  const startDrag = useCallback((side: PanelSide, e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const start = current.current[side] ?? PANEL_DEFAULTS[side]
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX
      setChosen((prev) => ({ ...prev, [side]: clamp(side, side === 'left' ? start + dx : start - dx) }))
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

  // 元の幅に戻す：その欄の幅は覚えておかない（既定の幅が変われば、それに合わせる）
  const reset = useCallback(
    (side: PanelSide) =>
      setChosen((prev) => {
        const next = { ...prev }
        delete next[side]
        return next
      }),
    [],
  )

  const mini = Math.max(48, widths.left - THUMB_GUTTER)
  const style = {
    '--left-w': `${widths.left}px`,
    '--right-w': `${widths.right}px`,
    '--mini-w': `${mini}px`,
    '--mini-scale': String(mini / PAGE_W),
  } as React.CSSProperties

  return { style, startDrag, reset }
}
