import type { ReactNode } from 'react'
import { SLOW_MS, useSlow } from './useBusy'

/**
 * 待つ間の表示（依頼者の要望 2026-10-20「保存中に何も表示がなく待たされるので不安になる」）。
 * 押したボタンは、すぐ回る小さな印と「保存しています…」などの言葉に替え、終わるまで押せなくする。
 * 2秒を過ぎたら「数秒かかることがあります」を足す。回る印は、PDF の窓の「保存の画面を開いています…」と同じ形
 * （index.css・check/check.css の「待つ間の表示」。「動きを減らす」設定では回さない）。
 * 待つ間の決まり（2秒・1つずつ動かす・「✓ 保存しました」を少しの間出す）は app/useBusy.ts
 */

/** 回る小さな印（読み上げない。言葉は、となりに書く） */
export function Spinner({ className }: { className?: string }) {
  return <span className={`busy-spin${className ? ` ${className}` : ''}`} aria-hidden="true" />
}

/**
 * ボタンの中身。busy の間は、回る印と text（例「保存しています…」）に替える（ボタンを押せなくするのは、呼ぶ側の disabled）
 */
export function BusyLabel({ busy, text, children }: { busy: boolean; text: string; children: ReactNode }) {
  if (!busy) return <>{children}</>
  return (
    <>
      <Spinner />
      {text}
    </>
  )
}

/**
 * 待つのが2秒を過ぎたら出す、ひとこと（「数秒かかることがあります」。写真の多い Word などは「十数秒」）。
 * 読み上げにも伝わるよう、いつも置いておく枠（role="status"）の中に出す。出していない間は、高さを取らない
 */
export function SlowNote({ busy, text = '数秒かかることがあります', className }: { busy: boolean; text?: string; className?: string }) {
  const slow = useSlow(busy)
  return (
    <span className={`slow-note${slow ? ' on' : ''}${className ? ` ${className}` : ''}`} role="status">
      {slow ? text : ''}
    </span>
  )
}

/**
 * 紙面の上に出す、待つ間の小さな知らせ（写真を選んだあと、縮めて保存している間など。押したボタンが、選ぶ画面の向こうに消えてしまうとき）。
 * 出してから slowMs（ふつうは2秒）を過ぎたら slowText（「数秒かかることがあります」）を足す
 */
export function WaitToast({ text, slowText = '数秒かかることがあります', slowMs = SLOW_MS, className }: { text: string; slowText?: string; slowMs?: number; className?: string }) {
  const slow = useSlow(true, slowMs)
  return (
    <div className={`wait-toast${className ? ` ${className}` : ''}`} role="status">
      <Spinner />
      <span>
        <span className="wt-text">{text}</span>
        {slow && <small>{slowText}</small>}
      </span>
    </div>
  )
}
