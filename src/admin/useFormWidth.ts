import { useEffect, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'

/**
 * 管理ページの区切りの中身（左の見出しと右の見本の間）の幅。見本との境目をつかんで動かすと変わり、ダブルクリックで元の幅に戻る。
 * キーボードでは、境目を選んで ←・→ で変える。決めた幅はこのブラウザに覚えておく
 * （学生用ツールの src/app/usePanelWidths.ts と同じ考え方。覚えておけなくても既定の幅で動く）
 */

const KEY = 'sotsugyo-admin-form-width'
/** 既定の幅（mockups/v43 案B）・いちばん狭い幅（ラベルの列とサブタイトルの形式の行が収まる幅）・いちばん広い幅 */
export const FORM_WIDTH = { initial: 560, min: 480, max: 900 } as const
/** 見本の欄に残す幅（中身を広げても、見本がこれより狭くならない。admin.css の .work と同じ値） */
const STAGE_MIN = 360
/** ←・→ を1回押したときに変わる幅 */
const STEP = 16

const clamp = (w: number, max: number = FORM_WIDTH.max) => Math.round(Math.max(FORM_WIDTH.min, Math.min(Math.max(FORM_WIDTH.min, max), w)))

/** 覚えておいた幅を読む（決めていない・読めないときは null。既定の幅と同じなら決めていないものとする） */
export function readFormWidth(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null
  const w = Number(raw)
  if (!Number.isFinite(w)) return null
  const c = clamp(w)
  return c === FORM_WIDTH.initial ? null : c
}

function load(): number | null {
  try {
    return readFormWidth(localStorage.getItem(KEY))
  } catch {
    return null
  }
}

export function useFormWidth() {
  const [chosen, setChosen] = useState<number | null>(load)
  const width = chosen ?? FORM_WIDTH.initial

  useEffect(() => {
    try {
      if (chosen === null) localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, String(chosen))
    } catch {
      // 覚えておけなくても、今は変えた幅で動く
    }
  }, [chosen])

  /** 今の画面で広げられるいちばん広い幅（見本の欄に STAGE_MIN を残す） */
  const maxFor = (handle: HTMLElement) => Math.min(FORM_WIDTH.max, (handle.parentElement?.clientWidth ?? Infinity) - STAGE_MIN)
  /** 画面に出ている中身の幅（狭い画面では、決めた幅より狭く出ていることがある） */
  const shownWidth = (handle: HTMLElement) => handle.parentElement?.firstElementChild?.getBoundingClientRect().width ?? width

  /** 境目をつかんだ：動かした分だけ幅を変える（つかんでいる間は、見本の iframe の上でも動きを受け取る） */
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const handle = e.currentTarget
    const id = e.pointerId
    handle.setPointerCapture?.(id)
    const startX = e.clientX
    const start = shownWidth(handle)
    const max = maxFor(handle)
    const move = (ev: PointerEvent) => {
      if (ev.pointerId === id) setChosen(clamp(start + ev.clientX - startX, max))
    }
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      document.body.classList.remove('resizing')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    document.body.classList.add('resizing')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const handle = e.currentTarget
    setChosen(clamp(shownWidth(handle) + (e.key === 'ArrowRight' ? STEP : -STEP), maxFor(handle)))
  }

  /** 元の幅に戻す（幅は覚えておかない） */
  const reset = () => setChosen(null)

  const style = { '--form-w': `${width}px` } as CSSProperties
  const handleProps = {
    role: 'separator' as const,
    tabIndex: 0,
    'aria-orientation': 'vertical' as const,
    'aria-label': '入力欄の幅（←→キーで変える）',
    'aria-valuenow': width,
    'aria-valuemin': FORM_WIDTH.min,
    'aria-valuemax': FORM_WIDTH.max,
    title: 'つかんで動かすと、入力欄の幅が変わります（ダブルクリックで元の幅）',
    onPointerDown,
    onDoubleClick: reset,
    onKeyDown,
  }
  return { width, style, handleProps }
}
