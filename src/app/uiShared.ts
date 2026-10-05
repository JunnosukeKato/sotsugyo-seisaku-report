import { useEffect, useRef, useState } from 'react'
import type { EditorSnapshot, ReportEditor } from '../editor/reportEditor'
import type { PageKind } from '../layout/measure'

/** 画面の部品で共有する定数と、画面の幅・キーボード・指の動きを扱うフック */

/** ボタンを押しても入力欄から文字のカーソルが外れないようにする */
export const keepFocus = (e: React.MouseEvent) => e.preventDefault()

/** ページの種類ごとの名前と、道具の上に出すひとこと */
export const PAGE_CONTEXT: Record<PageKind, { name: string; hint: string }> = {
  cover: { name: '表紙', hint: '項目をクリック\nして入力' },
  abstract: { name: '抄録', hint: 'Enter で\n段落を分ける' },
  toc: { name: '目次', hint: '見出しから\n自動で作られる' },
  body: { name: '本文', hint: 'クリックして\nその場で書く' },
  references: { name: '参考文献', hint: 'クリックして\n編集する' },
  photos: { name: '作品写真', hint: '枠をクリック\nして選ぶ' },
  unknown: { name: '', hint: '' },
}

/** 表示しているページの名前（本文は「本文 2ページ」） */
export function pageName(snap: EditorSnapshot, index = snap.page): string {
  const kinds = snap.layout?.kinds ?? []
  const kind = kinds[index]
  if (!kind) return ''
  if (kind === 'body') return `本文 ${kinds.slice(0, index + 1).filter((k) => k === 'body').length}ページ`
  return PAGE_CONTEXT[kind].name
}

/** 画面の幅がスマホ（・縦長のタブレット）ほどか */
export function useNarrow(): boolean {
  const query = '(max-width: 999px)'
  const [narrow, setNarrow] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const onChange = () => setNarrow(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return narrow
}

/** スマホのキーボードの高さを CSS 変数 --kb に入れる（書く欄をキーボードのすぐ上に置くため） */
export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => document.documentElement.style.setProperty('--kb', `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`)
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    update()
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])
}

/** 紙面を指で左右にはらうと、ページをめくる */
export function useSwipe(target: React.RefObject<HTMLElement | null>, editor: ReportEditor | null, enabled: boolean): void {
  const start = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const el = target.current
    if (!el || !editor || !enabled) return
    const down = (e: PointerEvent) => (start.current = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY })
    const up = (e: PointerEvent) => {
      const s = start.current
      start.current = null
      if (!s) return
      const dx = e.clientX - s.x
      const dy = e.clientY - s.y
      const snap = editor.getSnapshot()
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 2 || snap.editingId || snap.zoomed) return
      if (dx < 0) editor.nextPage()
      else editor.prevPage()
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointerup', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointerup', up)
    }
  }, [target, editor, enabled])
}
