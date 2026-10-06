import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * 窓（ダイアログ）をキーボードでも使えるようにする。
 * - 開いたら、窓の中の最初の操作できるもの（閉じる「×」を除く。data-autofocus があればそれ）に移る
 * - Tab で窓の外に出ない（最後の次は最初に戻る）
 * - onEscape を渡すと、Esc で閉じる（書きかけの内容が消える窓や、必ず選んでもらう窓には渡さない）
 * - 閉じたら、開く前に操作していた場所に戻る
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, onEscape?: () => void): void {
  const escape = useRef(onEscape)
  useEffect(() => {
    escape.current = onEscape
  })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusables = () => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement)
    const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? focusables().find((x) => !x.classList.contains('close')) ?? focusables()[0]
    first?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && escape.current) {
        e.preventDefault()
        e.stopPropagation()
        escape.current()
        return
      }
      if (e.key !== 'Tab') return
      const list = focusables()
      if (!list.length) return
      const head = list[0]
      const tail = list[list.length - 1]
      if (!el.contains(document.activeElement)) {
        e.preventDefault()
        head.focus()
      } else if (e.shiftKey && document.activeElement === head) {
        e.preventDefault()
        tail.focus()
      } else if (!e.shiftKey && document.activeElement === tail) {
        e.preventDefault()
        head.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      if (previous?.isConnected) previous.focus()
    }
  }, [ref])
}
