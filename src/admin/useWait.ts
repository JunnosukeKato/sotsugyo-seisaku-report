import { useCallback, useEffect, useState } from 'react'

/**
 * サーバー（Apps Script）を待つ間の表示に使う時間。Apps Script は、しばらく使っていないと、最初の呼び出しに10秒ほどかかる。
 * 押したボタンにはすぐ回る印と「保存しています…」などを出し、SLOW_MS より長く待つと「数秒〜十数秒かかることがあります」を足す。
 * 終わったら「保存しました」などを DONE_MS のあいだ出す
 */
export const SLOW_MS = 2000
export const DONE_MS = 4000
/** 長く待っているときの1行 */
export const SLOW_TEXT = '数秒〜十数秒かかることがあります'

/** active になってから SLOW_MS より長くたったか */
export function useSlow(active: boolean): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => setSlow(true), SLOW_MS)
    return () => {
      clearTimeout(timer)
      setSlow(false)
    }
  }, [active])
  return active && slow
}

/** 終わったときの短い知らせ（出してから DONE_MS で消える。同じ知らせを続けて出しても、そこから数え直す） */
export function useDone(): [string | null, (text: string) => void] {
  const [done, setDone] = useState<{ text: string; at: number } | null>(null)
  useEffect(() => {
    if (!done) return
    const timer = setTimeout(() => setDone(null), DONE_MS)
    return () => clearTimeout(timer)
  }, [done])
  const show = useCallback((text: string) => setDone({ text, at: Date.now() }), [])
  return [done?.text ?? null, show]
}
