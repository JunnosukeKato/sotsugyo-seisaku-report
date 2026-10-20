import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 待つ間の表示の決まり（依頼者の要望 2026-10-20「保存中に何も表示がなく待たされるので不安になる」）。
 * 画面の部品（回る印・ボタンの中身・ひとこと）は app/Busy.tsx
 */

/** これを過ぎたら「数秒かかることがあります」を出す */
export const SLOW_MS = 2000

/**
 * 画面が一度描き直されるのを待つ（押したボタンの回る印を、重い処理を始める前に見せる。遅いスマホでは、待たないと 0.3秒ほど何も変わらなかった）。
 * 画面を描かない間（ほかのタブを見ているなど）は、少し待って先へ進む。
 * Google の窓・ファイルを選ぶ画面など、押した直後にしか開けないものの前には使わない
 */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => window.setTimeout(resolve, 0))
    window.setTimeout(resolve, 100)
  })
}

/** 待つのが ms（ふつうは SLOW_MS）を過ぎたか（active が false に戻ったら、false に戻す） */
export function useSlow(active: boolean, ms = SLOW_MS): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!active) return
    const timer = window.setTimeout(() => setSlow(true), ms)
    return () => {
      window.clearTimeout(timer)
      setSlow(false)
    }
  }, [active, ms])
  return active && slow
}

/**
 * 押したボタンの働き（時間のかかるもの）を、1つずつ動かす。busy：動かしているもの（key。なければ null）。
 * 回る印を出してから（nextPaint）働きを始める。動かしている間に、ほかのボタンを押しても動かさない（二重に動かさない）。
 * paintFirst: false：働きの最初に確かめ（confirm）があるとき。確かめの窓の後ろで「戻しています…」と出さないよう、待たずに始める
 * （確かめたあと、端末への保存を待つ間に回る印が出る）。
 * 押した直後にしか開けないもの（Google の窓・ファイルを選ぶ画面）を開く働きには使わない
 */
export function useBusy<K extends string>(): [K | null, (key: K, fn: () => Promise<unknown> | unknown, options?: { paintFirst?: boolean }) => Promise<void>] {
  const [busy, setBusy] = useState<K | null>(null)
  const running = useRef(false)
  const run = useCallback(async (key: K, fn: () => Promise<unknown> | unknown, { paintFirst = true }: { paintFirst?: boolean } = {}) => {
    if (running.current) return
    running.current = true
    setBusy(key)
    try {
      if (paintFirst) await nextPaint()
      await fn()
    } finally {
      running.current = false
      setBusy(null)
    }
  }, [])
  return [busy, run]
}

/**
 * 終わったことを、少しの間だけ出す（「✓ 保存しました」など）。show(text) で出し、ms たったら消す（show(null) ですぐ消す）
 */
export function useDoneNote(ms = 6000): [string | null, (text: string | null) => void] {
  const [note, setNote] = useState<{ text: string; id: number } | null>(null)
  useEffect(() => {
    if (!note) return
    const timer = window.setTimeout(() => setNote(null), ms)
    return () => window.clearTimeout(timer)
  }, [note, ms])
  const show = useCallback((text: string | null) => setNote(text ? { text, id: Date.now() } : null), [])
  return [note?.text ?? null, show]
}
