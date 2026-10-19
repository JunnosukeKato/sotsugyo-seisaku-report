import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from './icons'
import { WordIcon } from './WordImport'

/**
 * PC の右の欄の「≡ メニュー」（mockups/v37 案C）。名前の横に置き、押すと下に開く。
 * 中身は、前に右の欄の上に並べていたもの：「？ 使い方」（いちばん上）・手順書（年度の設定に場所があるときだけ）／
 * 「バックアップ・作り直す」・今年度だけ「Word で書いた分を読み込む」。上の物を減らして、セルフチェックを広く見せるため。
 * キーボード：Enter・Space（↓）で開いて最初の項目へ（↑ は最後の項目へ）、↑↓・Home・End・Tab で項目を移り、Esc で閉じてボタンに戻る。
 * ほかの所を押したとき・Tab でメニューの外に出たときも閉じる。スマホは今までどおり（Phone.tsx のメニューの欄）
 */

interface Props {
  /** 手順書の場所（年度の設定。なければ出さない） */
  handbookUrl?: string
  onHelp: () => void
  onBackup: () => void
  /** 今年度だけ：「Word で書いた分を読み込む」。渡したときだけ出す */
  onWordImport?: () => void
}

/** ボタンに出す説明（マウスを乗せたとき）。中にあるものの名前 */
function sideMenuTitle({ handbookUrl, onWordImport }: Pick<Props, 'handbookUrl' | 'onWordImport'>): string {
  return ['使い方', handbookUrl && '手順書', 'バックアップ・作り直す', onWordImport && 'Word の読み込み'].filter(Boolean).join('・')
}

export function SideMenu({ handbookUrl, onHelp, onBackup, onWordImport }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  // 開いたときに移る項目（↑ で開いたときは最後の項目）
  const startAt = useRef<'first' | 'last'>('first')
  const buttonId = useId()
  const menuId = useId()

  const items = () => [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]

  // 開いたら項目に移る。ほかの所を押したら閉じる（押した所はそのまま使える）
  useEffect(() => {
    if (!open) return
    const list = items()
    ;(startAt.current === 'last' ? list[list.length - 1] : list[0])?.focus()
    startAt.current = 'first'
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  /** 閉じる。back：ボタンに戻る（Esc・項目を選んだとき。選んだ先の窓を閉じると、このボタンに戻る） */
  const close = (back: boolean) => {
    setOpen(false)
    if (back) buttonRef.current?.focus()
  }
  /** 項目を選んだ：閉じてボタンに戻ってから、その働きをする */
  const choose = (action: () => void) => () => {
    close(true)
    action()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const onButton = e.target === buttonRef.current
    if (e.key === 'Escape' && open) {
      e.preventDefault()
      e.stopPropagation()
      close(true)
      return
    }
    if (onButton) {
      // ↓ で開いて最初の項目へ、↑ で開いて最後の項目へ（Enter・Space は、ボタンを押したのと同じ）
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      e.stopPropagation()
      startAt.current = e.key === 'ArrowUp' ? 'last' : 'first'
      if (open) {
        const list = items()
        ;(startAt.current === 'last' ? list[list.length - 1] : list[0])?.focus()
        startAt.current = 'first'
      } else setOpen(true)
      return
    }
    const list = items()
    const i = list.indexOf(document.activeElement as HTMLElement)
    let next: HTMLElement | undefined
    if (e.key === 'ArrowDown') next = list[(i + 1) % list.length]
    else if (e.key === 'ArrowUp') next = list[(i - 1 + list.length) % list.length]
    else if (e.key === 'Home') next = list[0]
    else if (e.key === 'End') next = list[list.length - 1]
    else if (e.key === ' ' && document.activeElement instanceof HTMLAnchorElement) {
      // リンク（手順書）も、Space で開けるようにする（ボタンと同じ）
      e.preventDefault()
      document.activeElement.click()
      return
    } else if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    // ←→ は、紙面のページを送らない（メニューの中では何もしない）
    e.preventDefault()
    e.stopPropagation()
    next?.focus()
  }

  return (
    <div
      className="head-menu-wrap"
      ref={wrapRef}
      onKeyDown={onKeyDown}
      // Tab でメニューの外に出たら閉じる
      onBlur={(e) => {
        if (open && e.relatedTarget && !wrapRef.current?.contains(e.relatedTarget as Node)) setOpen(false)
      }}
    >
      <button
        type="button"
        ref={buttonRef}
        id={buttonId}
        className="menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={sideMenuTitle({ handbookUrl, onWordImport })}
        onClick={() => setOpen(!open)}
      >
        {Icon.menu}メニュー<span className="caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="head-menu" role="menu" id={menuId} aria-labelledby={buttonId} ref={menuRef}>
          <button type="button" role="menuitem" className="hm-help" onClick={choose(onHelp)}>
            {Icon.help}使い方
          </button>
          {handbookUrl && (
            <a role="menuitem" href={handbookUrl} target="_blank" rel="noreferrer" title="新しいタブで開きます" onClick={() => close(true)}>
              {Icon.handbook}手順書
            </a>
          )}
          <hr />
          <button type="button" role="menuitem" onClick={choose(onBackup)}>
            {Icon.backup}バックアップ・作り直す
          </button>
          {onWordImport && (
            <button type="button" role="menuitem" onClick={choose(onWordImport)}>
              <WordIcon />
              <span>
                Word で書いた分を読み込む<small>今年度だけ</small>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
