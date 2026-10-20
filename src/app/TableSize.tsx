import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { clampTableSize, TABLE_SIZE } from '../model/table'
import { Icon } from './icons'
import { useDialogFocus } from './useDialogFocus'
import { keepFocus } from './uiShared'

/**
 * 表の大きさを、入れる前に選ぶ（mockups/v35 ② 決めていただいた形）。
 * - パソコン：道具の「表を入れる」のメニューに、ます目（6列×10行まで）。マウスを乗せた所まで色が付き（1行目は濃い色＝見出し）、押すとその大きさで入る。
 *   矢印キーで選び Enter で入れる・Esc で閉じる（書く欄にカーソルを置いたまま使える）。指で押せる大きな画面では、ます目を押すとその大きさで入る。
 *   素材表は、ます目の下のボタン
 * - スマホ：書く欄の「表を入れる」で、下から小さな欄。列・行を［−］［＋］で選び（最初は2列×2行）、下の小さな表の絵で形を見て「入れる」。素材表もこの欄の中
 * 行は見出しの行も数える（2〜10行。見出しともう1行が要る）。列は1〜6列（model/table.ts の TABLE_SIZE）
 */

export interface TableSize {
  columns: number
  rows: number
}

const USUAL: TableSize = { columns: TABLE_SIZE.columns, rows: TABLE_SIZE.rows }

/** 矢印キーで動かす向き（列・行） */
const MOVES: Record<string, [number, number]> = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }

/**
 * パソコン：「表を入れる」のメニューの中身（ます目と素材表のボタン）。開いている間だけ置く。
 * onPick：ます目で選んだ大きさで入れる。onMaterial：素材表を入れる。onClose：閉じる（Esc・メニューの外を押した・マウスが出た）
 */
export function TableSizeMenu({ onPick, onMaterial, onClose }: { onPick: (size: TableSize) => void; onMaterial: () => void; onClose: () => void }) {
  // 色を付けている大きさ（はじめは、いつもの 2列×2行）
  const [hi, setHi] = useState<TableSize>(USUAL)
  const ref = useRef<HTMLDivElement>(null)
  const latest = useRef({ hi, onPick, onClose })
  useEffect(() => {
    latest.current = { hi, onPick, onClose }
  })

  // キーボード：矢印キーで選び、Enter で入れ、Esc で閉じる（書く欄にカーソルがあっても、書く欄より先に受け取る。カーソルは動かさない）。
  // メニューの外（紙面など）を押したら閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return
      const { hi: now, onPick: pick, onClose: close } = latest.current
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
        return
      }
      const move = MOVES[e.key]
      if (move) {
        e.preventDefault()
        e.stopPropagation()
        setHi((h) => clampTableSize(h.columns + move[0], h.rows + move[1]))
        return
      }
      if (e.key === 'Enter' && !e.repeat) {
        // メニューの中の、ます目でないボタン（素材表）に移っているときは、そのボタンを押す
        const active = document.activeElement
        if (active instanceof Element && ref.current?.contains(active) && !active.closest('.tgrid')) return
        e.preventDefault()
        e.stopPropagation()
        pick(now)
      }
    }
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('.menu-wrap')) latest.current.onClose()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [])

  // 画面の下からはみ出すときは、はみ出す分だけ上に出す（低い画面・ひな形を作る窓の中で、下の「素材表」が切れて押せなかった：
  // 先生の試し 2026-10-21）。それでも入らなければ、メニューの中を上下に動かす
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const over = r.bottom - (window.innerHeight - 8)
    if (over <= 0) return
    const up = Math.min(over, Math.max(0, r.top - 8))
    el.style.top = `${-up}px`
    if (over > up) {
      el.style.maxHeight = `${window.innerHeight - 16}px`
      el.style.overflowY = 'auto'
    }
  }, [])

  const cells = []
  for (let r = 1; r <= TABLE_SIZE.maxRows; r++) {
    for (let c = 1; c <= TABLE_SIZE.maxColumns; c++) {
      // 1行目に乗せたときも、見出しともう1行（2行）にする
      const size = clampTableSize(c, r)
      const on = c <= hi.columns && r <= hi.rows
      cells.push(
        <button
          key={`${r}-${c}`}
          type="button"
          tabIndex={-1}
          className={on ? (r === 1 ? 'on h' : 'on') : undefined}
          aria-label={`${size.columns}列×${size.rows}行`}
          onMouseDown={keepFocus}
          onPointerEnter={() => setHi(size)}
          onClick={() => onPick(size)}
        />,
      )
    }
  }
  return (
    <div className="side-menu table-menu" ref={ref} onMouseLeave={onClose}>
      <div className="side-menu-title">表の大きさを選ぶ</div>
      <div className="tgrid" role="group" aria-label="表の大きさ（矢印キーで選び、Enter で入れる）">
        {cells}
      </div>
      <div className="tgrid-label" aria-live="polite">
        {hi.columns}列×{hi.rows}行<small>1行目は見出し</small>
      </div>
      <div className="tmenu-sep" />
      <button type="button" onMouseDown={keepFocus} onClick={onMaterial}>
        素材表<small>名称・使用箇所・生地見本</small>
      </button>
    </div>
  )
}

/** スマホ：列・行の［−］n［＋］（ボタンは 46px 四方） */
function Stepper({ label, note, value, min, max, onStep }: { label: string; note: string; value: number; min: number; max: number; onStep: (d: 1 | -1) => void }) {
  return (
    <div className="ts-step">
      <span className="l">
        {label}
        <small>{note}</small>
      </span>
      <button type="button" aria-label={`${label}を減らす`} disabled={value <= min} onClick={() => onStep(-1)}>
        {Icon.minus}
      </button>
      <b aria-live="polite" aria-label={`${label} ${value}`}>
        {value}
      </b>
      <button type="button" aria-label={`${label}を増やす`} disabled={value >= max} onClick={() => onStep(1)}>
        {Icon.plus}
      </button>
    </div>
  )
}

/**
 * スマホ：書く欄の「表を入れる」で、下から出る小さな欄。書く欄は開いたまま（書いていた位置を覚えておく。editor/overlayEditor.ts の KEEP_OPEN）。
 * onInsert：選んだ大きさの表を入れる。onMaterial：素材表を入れる。onClose：入れずに閉じる（×・後ろを押す・Esc。書く欄に戻る）
 */
export function TableSizeSheet({ onInsert, onMaterial, onClose }: { onInsert: (size: TableSize) => void; onMaterial: () => void; onClose: () => void }) {
  const [size, setSize] = useState<TableSize>(USUAL)
  const ref = useRef<HTMLElement>(null)
  useDialogFocus(ref, onClose)
  const step = (dc: number, dr: number) => setSize((s) => clampTableSize(s.columns + dc, s.rows + dr))
  return (
    <>
      {/* 後ろを押したら閉じる（押したときに、書く欄からカーソルを外さない） */}
      <div className="scrim" onMouseDown={keepFocus} onClick={onClose} />
      <section className="sheet table-size" role="dialog" aria-modal="true" aria-label="表を入れる" tabIndex={-1} ref={ref}>
        <div className="grab" />
        <header className="sheet-head">
          <h2>表を入れる</h2>
          <button type="button" className="sheet-close close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </header>
        <div className="sheet-body">
          <Stepper label="列" note="横に並ぶ数" value={size.columns} min={TABLE_SIZE.minColumns} max={TABLE_SIZE.maxColumns} onStep={(d) => step(d, 0)} />
          <Stepper label="行" note="縦に並ぶ数（1行目は見出し）" value={size.rows} min={TABLE_SIZE.minRows} max={TABLE_SIZE.maxRows} onStep={(d) => step(0, d)} />
          {/* できる形の小さな絵（色の付いた行が見出し） */}
          <div className="ts-preview" style={{ gridTemplateColumns: `repeat(${size.columns}, 1fr)` }} aria-hidden="true">
            {Array.from({ length: size.columns * size.rows }, (_, i) => (
              <i key={i} className={i < size.columns ? 'h' : undefined} />
            ))}
          </div>
          <p className="ts-note">
            {size.columns}列×{size.rows}行（色の付いた行が見出し）
          </p>
          <button type="button" className="export ts-insert" onClick={() => onInsert(size)}>
            {Icon.table}入れる
          </button>
          <button type="button" className="ts-material" onClick={onMaterial}>
            素材表を入れる<small>名称・使用箇所・生地見本の3列</small>
          </button>
        </div>
      </section>
    </>
  )
}
