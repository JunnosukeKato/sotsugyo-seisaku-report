import { useState, type ReactNode } from 'react'
import { Icon } from '../app/icons'

/**
 * 管理ページの区切りの中で使う部品（mockups/v43 案B）。
 * 欄は「ラベルの列」と「欄の列」の2列にそろえる（Row を .grid の中に並べる）。
 * 保存していない変更のある欄には、ラベルの下に「変更あり」の印を付け、欄を黄色の線で囲む
 */

/** ラベルと欄の1行。htmlFor を渡すと、ラベルを押すとその欄に入る */
export function Row({
  label,
  sub,
  hint,
  warn,
  changed = false,
  htmlFor,
  className = '',
  children,
}: {
  label: string
  /** ラベルの下の小さな字（「任意」など） */
  sub?: string
  /** 欄の下の説明 */
  hint?: ReactNode
  /** 欄の下の注意（黄色の字） */
  warn?: string
  /** 保存していない変更がある（「変更あり」の印） */
  changed?: boolean
  htmlFor?: string
  className?: string
  children: ReactNode
}) {
  const inner = (
    <>
      {label}
      {sub && <small>{sub}</small>}
      {changed && <small className="chg">変更あり</small>}
    </>
  )
  return (
    <>
      {htmlFor ? (
        <label className={`lb ${className}`} htmlFor={htmlFor}>
          {inner}
        </label>
      ) : (
        <div className={`lb ${className}`}>{inner}</div>
      )}
      <div className={`ctl${changed ? ' chg' : ''} ${className}`}>
        {children}
        {warn && (
          <div className="warn-line">
            {Icon.warn}
            <span>{warn}</span>
          </div>
        )}
        {hint && <div className="hint">{hint}</div>}
      </div>
    </>
  )
}

/** 区切りの見出しと、その下の説明 */
export function SectionHead({ title, lead }: { title: string; lead?: ReactNode }) {
  return (
    <>
      <h1 className="sec-h">{title}</h1>
      {lead && <p className="sec-lead">{lead}</p>}
    </>
  )
}

/** 小さな札（「お知らせあり」「変更あり」など） */
export function Chip({ children, kind = '' }: { children: ReactNode; kind?: '' | 'acc' | 'chg' | 'off' | 'ok' }) {
  return <span className={`chip ${kind}`}>{children}</span>
}

export function TextInput({ id, value, onChange, placeholder, type = 'text', max, className = '' }: { id?: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; max?: string; className?: string }) {
  return <input id={id} className={`in ${className}`} type={type} value={value} placeholder={placeholder} max={max} onChange={(e) => onChange(e.target.value)} />
}

/**
 * 数の欄。入力の途中は空にできる（消して打ち直すときに「0」が入って「0600」にならないように）。
 * 空のあいだは設定を変えず、欄を離れると設定の値を出し直す
 */
export function NumberInput({ id, value, onChange, label }: { id?: string; value: number; onChange: (v: number) => void; label?: string }) {
  const [text, setText] = useState(String(value))
  const [shown, setShown] = useState(value)
  // 年度の切り替え・変更履歴の読み込みなどで値が変わったら、表示を合わせる
  if (value !== shown) {
    setShown(value)
    setText(String(value))
  }
  return (
    <input
      id={id}
      className="in num"
      type="number"
      aria-label={label}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value.trim() !== '' && Number.isFinite(n)) {
          setShown(n)
          onChange(n)
        }
      }}
      onBlur={() => setText(String(value))}
    />
  )
}

/**
 * 空にできる数の欄（空は「なし」＝ null。作品写真のページ数の上限：空なら上限なし。mockups/v38）。
 * 入力の途中の扱いは NumberInput と同じ
 */
export function OptionalNumberInput({ id, value, onChange, placeholder }: { id?: string; value: number | null; onChange: (v: number | null) => void; placeholder?: string }) {
  const show = (v: number | null) => (v === null ? '' : String(v))
  const [text, setText] = useState(show(value))
  const [shown, setShown] = useState(value)
  if (value !== shown) {
    setShown(value)
    setText(show(value))
  }
  return (
    <input
      id={id}
      className="in num"
      type="number"
      min={1}
      step={1}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value)
        if (e.target.value.trim() === '') {
          setShown(null)
          onChange(null)
          return
        }
        const n = Number(e.target.value)
        if (Number.isFinite(n)) {
          setShown(n)
          onChange(n)
        }
      }}
      onBlur={() => setText(show(value))}
    />
  )
}
