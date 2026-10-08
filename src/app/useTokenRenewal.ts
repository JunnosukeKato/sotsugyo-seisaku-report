import { useEffect, useRef } from 'react'
import type { DriveSync } from '../drive/driveSync'

/**
 * パソコンで、Google の許可が切れる少し前（残り10分）にクリックしたら、許可を延ばす（DriveSync.renewOnClick。Google の窓が一瞬出て閉じる）。
 * 書き続けていれば「もう一度ログインしてください」は、ほとんど出なくなる（切れる前の10分ほどクリックしなかったときだけ出る）。
 * - クリック（マウス・指）のときだけ。キーを押したときは延ばさない（書いている途中に Google の窓が出ないように）
 * - Google の窓はクリックした処理の中でしか開けないので、クリックが紙面などに届く前（capture）に、待たずに呼ぶ
 * - blocked：ログインの窓・「もう一度ログイン」の窓・別のアカウントの窓などが開いている（そのときは延ばさない）
 * - Google の窓が閉じたあと、書いていた欄から外れていたら、元の欄と文字の位置に戻す
 */
export function useTokenRenewal(drive: DriveSync | null, blocked: boolean): void {
  const blockedRef = useRef(blocked)
  useEffect(() => {
    blockedRef.current = blocked
  }, [blocked])

  useEffect(() => {
    if (!drive) return
    const onClick = (e: MouseEvent) => {
      // マウス・指のクリックだけ（キーボードの Enter・スペースや、プログラムからのクリックは detail が 0）
      if (e.detail === 0 || blockedRef.current) return
      const renewing = drive.renewOnClick()
      if (!renewing) return
      // クリックした先（書く欄など）は、このクリックの処理が終わってから決まるので、そのあとに覚える
      let focused: HTMLElement | null = null
      let range: Range | null = null
      window.setTimeout(() => {
        const active = document.activeElement
        focused = active instanceof HTMLElement && active !== document.body ? active : null
        const selection = window.getSelection()
        range = focused && selection?.rangeCount && focused.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null
      }, 0)
      // Google の窓が閉じて、この画面に戻ったとき：書いていた欄から外れていたら（ほかの欄に移ったのでなければ）戻す
      const restore = () => {
        const active = document.activeElement
        if (!focused?.isConnected || (active && active !== document.body)) return
        focused.focus({ preventScroll: true })
        if (range) {
          const selection = window.getSelection()
          selection?.removeAllRanges()
          selection?.addRange(range)
        }
      }
      window.addEventListener('focus', restore, { once: true })
      void renewing.then(() => {
        restore()
        window.setTimeout(() => window.removeEventListener('focus', restore), 10_000)
      })
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [drive])
}
