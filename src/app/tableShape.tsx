import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ReportEditor } from '../editor/reportEditor'
import type { TableBlock } from '../model/types'
import { Icon } from './icons'
import { SHAPE_TEXTS } from './tableShapeTexts'
import { keepFocus } from './uiShared'
import { useDialogFocus } from './useDialogFocus'

/**
 * 表の形を整える（mockups/v45 案A。依頼者の判断 2026-10-20）。列の幅（3つから選ぶ）・項目の列（左端）・行の高さ（そろえる・写真が入る高さ）を、1か所で、小さな表の絵を見て選ぶ。
 * - パソコン：左の道具の「表の形を整える」を押すと、左の道具のとなりに窓が開く（TableShapeTool）。選ぶと、すぐ紙面の表が変わる（窓は開いたまま）。
 *   閉じるのは「×」・Esc・窓の外を押す
 * - スマホ：道具の「表の形」を押すと、下から欄が出る（TableShapeSheet）。「できた」で閉じる。
 *   「自分で決める」を選ぶと欄を閉じ、紙面の丸いつまみ（editor/columnHandles.ts。v42 案D のまま）で幅を変える
 * どれも、元に戻す1回で戻る（editor/reportEditor.ts の changeTable）。言葉は、押すとどうなるかで書く（「中身に合わせる」「左端の列」は使わない）
 */

type PicKind = 'equal' | 'auto' | 'custom' | 'label' | 'heights' | 'photo'

/** 列の幅の3つ（絵・名前・一言） */
const WIDTH_CHOICES: { value: TableBlock['widths']; pic: PicKind; name: string[]; sub: string[]; subPhone?: string[] }[] = [
  { value: 'equal', pic: 'equal', name: ['列の幅を', 'そろえる'], sub: ['どの列も', '同じ幅'] },
  { value: 'auto', pic: 'auto', name: ['字の多い列を', '広く'], sub: ['字の量に', '合わせて', '自動で'] },
  { value: 'custom', pic: 'custom', name: ['自分で', '決める'], sub: ['線を', 'ドラッグ'], subPhone: ['丸を', '左右に', '動かす'] },
]
/** 項目の列（左端）：列の幅が「そろえる」のときだけ使える。ほかのときは、うすくして、そのわけを出す */
const LABEL = { name: ['項目の列', '（左端）は', '字に合わせる'], sub: ['ほかの列は', '同じ幅'], off: ['「列の幅を', 'そろえる」の', 'ときだけ'] }
const HEIGHTS = { name: ['行の高さを', 'そろえる'], sub: ['見出しの行は別'] }
/** 行の高さ「写真が入る高さ」（Word の素材表と同じ枠：依頼者の選択 2026-10-22 案A）。「そろえる」とどちらか1つ（両方外すと、中身に合わせる） */
const PHOTO = { name: ['写真が入る', '高さにする'], sub: ['どの行も', '約3.5cm'] }

/** 言葉の切れ目でだけ折り返す（切れ目の間は折り返さない。index.css の .ph） */
export function Phrase({ parts }: { parts: string[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <span key={i} className="ph">
          {p}
          {i < parts.length - 1 && <wbr />}
        </span>
      ))}
    </>
  )
}

/**
 * 表の形の小さな絵（3列：短い項目・長い説明・写真の四角。見出しの行と3行）。押したあとの形が分かるように、表の高さも変わる
 * （字の多い列を広くすると、表が短くなる）。mockups/v45 と同じ絵
 */
export function TablePic({ kind }: { kind: PicKind }) {
  const X = 2
  const Y = 2
  const HEAD = 5
  const PITCH = 2.7
  const PAD = 2.2
  const conf = {
    equal: { cols: [20, 20, 20], text: [30, 30, 30] },
    auto: { cols: [13, 34, 13], text: [30, 30, 30] },
    custom: { cols: [17, 29, 14], text: [30, 30, 30], hot: 0 },
    label: { cols: [10, 25, 25], text: [30, 30, 30], fit: true },
    heights: { cols: [12, 36, 12], text: [28, 90, 56], equalRows: true },
    photo: { cols: [20, 20, 20], text: [12, 12, 12], rowHeight: 10.5 },
  }[kind] as { cols: number[]; text: number[]; hot?: number; fit?: boolean; equalRows?: boolean; rowHeight?: number }
  const shortText = 7
  const xs = [X]
  for (const c of conf.cols) xs.push(xs[xs.length - 1] + c)
  const cw = conf.cols
  const PW = xs[xs.length - 1] - X
  const linesOf = (amount: number, w: number) => Math.max(1, Math.ceil(amount / Math.max(3, w - 3)))
  const need = conf.text.map((a) => Math.max(linesOf(a, cw[1]), linesOf(shortText, cw[0])))
  let rows = need.map((n) => n * PITCH + PAD)
  if (conf.equalRows) rows = rows.map(() => Math.max(...rows))
  if (conf.rowHeight) rows = rows.map(() => conf.rowHeight as number)
  const PH = HEAD + rows.reduce((a, b) => a + b, 0)
  const parts: ReactNode[] = []
  let key = 0
  const rect = (x: number, y: number, w: number, h: number, opacity: number, rx = 0.5) =>
    parts.push(<rect key={key++} x={x.toFixed(2)} y={y.toFixed(2)} width={w.toFixed(2)} height={h.toFixed(2)} rx={rx} fill="currentColor" fillOpacity={opacity} />)
  rect(X, Y, PW, HEAD, 0.2, 0)
  // 見出しの行の字
  cw.forEach((w, c) => rect(xs[c] + w / 2 - Math.min(5, w - 4) / 2, Y + HEAD / 2 - 0.6, Math.min(5, w - 4), 1.2, 0.75))
  // 字（棒）と写真の四角
  let y = Y + HEAD
  rows.forEach((rh, r) => {
    const bars = (col: number, amount: number) => {
      const avail = Math.max(3, cw[col] - 3)
      const n = linesOf(amount, cw[col])
      const top = y + rh / 2 - ((n - 1) * PITCH) / 2
      for (let i = 0; i < n; i++) {
        const len = Math.min(avail, i === n - 1 ? Math.max(3, amount - avail * (n - 1)) : avail)
        rect(xs[col] + (cw[col] - len) / 2, top + i * PITCH - 0.65, len, 1.3, 0.6)
      }
    }
    bars(0, conf.fit ? cw[0] - 3 : shortText)
    bars(1, conf.text[r])
    const sq = Math.min(cw[2] - 4, rh - 2, conf.rowHeight ? 8 : 6)
    rect(xs[2] + (cw[2] - sq) / 2, y + (rh - sq) / 2, sq, sq, 0.45, 0.4)
    y += rh
  })
  // 線
  parts.push(<rect key={key++} x={X} y={Y} width={PW} height={PH.toFixed(2)} rx={1.2} fill="none" stroke="currentColor" strokeWidth={1.3} />)
  parts.push(<path key={key++} d={`M${X} ${Y + HEAD}h${PW}`} stroke="currentColor" strokeWidth={1} />)
  y = Y + HEAD
  for (const rh of rows.slice(0, -1)) {
    y += rh
    parts.push(<path key={key++} d={`M${X} ${y.toFixed(2)}h${PW}`} stroke="currentColor" strokeWidth={0.7} />)
  }
  xs.slice(1, -1).forEach((x, i) => {
    if (conf.hot === i) {
      // 自分で決める：つかむ線と、左右の矢印の付いたつまみ
      parts.push(<path key={key++} d={`M${x.toFixed(2)} ${Y}v${PH.toFixed(2)}`} stroke="currentColor" strokeWidth={2} />)
      parts.push(<rect key={key++} x={(x - 4.2).toFixed(2)} y={Y + HEAD / 2 - 2.6} width={8.4} height={5.2} rx={2.6} fill="currentColor" />)
      parts.push(
        <path
          key={key++}
          d={`M${(x - 2.4).toFixed(2)} ${Y + HEAD / 2}h4.8M${(x - 1.4).toFixed(2)} ${Y + HEAD / 2 - 1}l-1 1 1 1M${(x + 1.4).toFixed(2)} ${Y + HEAD / 2 - 1}l1 1-1 1`}
          stroke="#fff"
          strokeWidth={0.7}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />,
      )
    } else parts.push(<path key={key++} d={`M${x.toFixed(2)} ${Y}v${PH.toFixed(2)}`} stroke="currentColor" strokeWidth={0.8} />)
  })
  return (
    <svg className="pic" viewBox="0 0 64 40" aria-hidden="true">
      {parts}
    </svg>
  )
}

/** 窓・欄の中身：列の幅（3つから選ぶ）・項目の列（左端）・行の高さ。phone：スマホの欄（絵が上の選びを横に3つ） */
function ShapeOptions({ editor, table, tableId, phone, onCustom }: { editor: ReportEditor; table: TableBlock; tableId: string; phone?: boolean; onCustom?: () => void }) {
  const labelOff = table.widths !== 'equal'
  const labelOn = table.labelColumn === true && !labelOff
  const heightsOn = table.heights === 'equal'
  const photoOn = table.heights === 'photo'
  const choose = (value: TableBlock['widths']) => {
    editor.setTableWidths(tableId, value)
    if (value === 'custom') onCustom?.()
  }
  return (
    <>
      <div className="so-sec" id={`so-w-${tableId}`}>
        {SHAPE_TEXTS.width}
      </div>
      <div className="so-widths" role="radiogroup" aria-labelledby={`so-w-${tableId}`}>
        {WIDTH_CHOICES.map((c) => {
          const on = table.widths === c.value
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={on}
              className={`so-choice${on ? ' on' : ''}`}
              data-value={c.value}
              data-autofocus={on || undefined}
              onMouseDown={keepFocus}
              onClick={() => choose(c.value)}
            >
              {!phone && <i className="rd" aria-hidden="true" />}
              <TablePic kind={c.pic} />
              <span className="tx">
                <b>
                  <Phrase parts={c.name} />
                </b>
                <small>
                  <Phrase parts={(phone && c.subPhone) || c.sub} />
                </small>
              </span>
            </button>
          )
        })}
      </div>
      {/* スマホ：自分で決めるのときは「同じ幅に戻す」をこの欄の中に（前はキーボードの上の道具の3段目：mockups/v48 C） */}
      {phone && table.widths === 'custom' && (
        <div className="so-guide phone">
          <button type="button" className="so-even" onMouseDown={keepFocus} onClick={() => editor.resetTableColWidths(tableId)}>
            {Icon.evenColumns}
            <span>{SHAPE_TEXTS.even}</span>
          </button>
        </div>
      )}
      {/* パソコン：自分で決めるのときは、表の縦の線をドラッグすること（editor/columnHandles.ts）と「同じ幅に戻す」 */}
      {!phone && table.widths === 'custom' && (
        <div className="so-guide">
          <p>
            <Phrase parts={SHAPE_TEXTS.dragGuide} />
          </p>
          <button type="button" className="so-even" onMouseDown={keepFocus} onClick={() => editor.resetTableColWidths(tableId)}>
            {Icon.evenColumns}
            <span>{SHAPE_TEXTS.even}</span>
          </button>
        </div>
      )}
      <button
        type="button"
        role="checkbox"
        aria-checked={labelOn}
        aria-disabled={labelOff}
        className={`so-check${labelOn ? ' on' : ''}${labelOff ? ' off' : ''}`}
        data-key="label"
        onMouseDown={keepFocus}
        onClick={() => {
          if (!labelOff) editor.setTableLabelColumn(tableId, !labelOn)
        }}
      >
        <i className="box" aria-hidden="true">
          {labelOn && Icon.check}
        </i>
        <TablePic kind="label" />
        <span className="tx">
          <b>
            <Phrase parts={LABEL.name} />
          </b>
          <small>
            <Phrase parts={labelOff ? LABEL.off : LABEL.sub} />
          </small>
        </span>
      </button>
      <div className="so-sec">{SHAPE_TEXTS.height}</div>
      <button
        type="button"
        role="checkbox"
        aria-checked={heightsOn}
        className={`so-check${heightsOn ? ' on' : ''}`}
        data-key="heights"
        onMouseDown={keepFocus}
        onClick={() => editor.setTableHeights(tableId, heightsOn ? 'auto' : 'equal')}
      >
        <i className="box" aria-hidden="true">
          {heightsOn && Icon.check}
        </i>
        <TablePic kind="heights" />
        <span className="tx">
          <b>
            <Phrase parts={HEIGHTS.name} />
          </b>
          <small>
            <Phrase parts={HEIGHTS.sub} />
          </small>
        </span>
      </button>
      <button
        type="button"
        role="checkbox"
        aria-checked={photoOn}
        className={`so-check${photoOn ? ' on' : ''}`}
        data-key="photo"
        onMouseDown={keepFocus}
        onClick={() => editor.setTableHeights(tableId, photoOn ? 'auto' : 'photo')}
      >
        <i className="box" aria-hidden="true">
          {photoOn && Icon.check}
        </i>
        <TablePic kind="photo" />
        <span className="tx">
          <b>
            <Phrase parts={PHOTO.name} />
          </b>
          <small>
            <Phrase parts={PHOTO.sub} />
          </small>
        </span>
      </button>
    </>
  )
}

/** 窓の中で Tab で回れるもの */
const FOCUSABLE = 'button:not([disabled])'

/**
 * パソコンの左の道具の「表の形を整える」と、押すと左の道具のとなりに開く窓。
 * 窓は左の道具の左に開き、矢印でボタンを指す（左に場所がなければ右）。画面の低いパソコンでも入るよう、上下にずらす。
 * マウスで開いたときは、書いているセルにカーソルを残す（打ち続けられる）。キーボードで開いたときは、窓の中の選んでいる形に移る（Tab で窓の中を回る）。
 * 閉じると、開く前の所（書いているセル・このボタン）に戻る
 */
export function TableShapeTool({ editor, table, tableId }: { editor: ReportEditor; table: TableBlock; tableId: string }) {
  const [open, setOpen] = useState(false)
  // 画面の大きさが変わったら、窓の位置を合わせ直す
  const [, bump] = useState(0)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  /** 閉じたときに戻る所 */
  const back = useRef<HTMLElement | null>(null)
  /** キーボードで開いた（窓の中に移る） */
  const byKey = useRef(false)

  const close = (restore: boolean) => {
    if (restore && panel.current?.contains(document.activeElement)) {
      const to = back.current?.isConnected ? back.current : button.current
      to?.focus()
    }
    setOpen(false)
  }

  // 窓の位置（左の道具の左。ボタンの真ん中を矢印で指す）。中身の高さが変わったとき（自分で決めるの一言など）も合わせる
  useLayoutEffect(() => {
    if (!open) return
    const el = panel.current
    const b = button.current?.getBoundingClientRect()
    const p = button.current?.closest('.palette')?.getBoundingClientRect()
    if (!el || !b || !p) return
    const room = p.left - 18
    // 左の道具の左に、ページの一覧に重ねて開く（狭いと字が2〜3行になる。mockups/v45）。拡大・見開きで左の道具が台の左端にあるときは、右に開く
    const left = room >= 170
    const width = Math.min(300, left ? room : innerWidth - p.right - 18)
    el.style.width = `${width}px`
    el.style.left = `${left ? p.left - 10 - width : p.right + 10}px`
    el.classList.toggle('right', !left)
    // 低い画面で入らなければ、選びの下の小さな一言（「どの列も同じ幅」など）を出さない（index.css の .shape-panel.compact。左の道具の一言を出さないのと同じ：mockups/v47 案C）。
    // 行の高さ「写真が入る高さ」を足して、1280×586 の画面の「自分で決める」で入らなくなったため。それでも入らなければ、窓の中を上下に動かす（.shape-panel.scroll）
    el.classList.remove('scroll', 'compact')
    el.style.maxHeight = ''
    let h = el.offsetHeight
    if (h > innerHeight - 16) {
      el.classList.add('compact')
      h = el.offsetHeight
    }
    if (h > innerHeight - 16) {
      h = innerHeight - 16
      el.classList.add('scroll')
      el.style.maxHeight = `${h}px`
    }
    const cy = b.top + b.height / 2
    const top = Math.max(8, Math.min(innerHeight - h - 8, cy - h + 70))
    el.style.top = `${top}px`
    el.style.setProperty('--tail', `${Math.max(18, Math.min(h - 18, cy - top))}px`)
  })

  useEffect(() => {
    if (!open) return
    if (byKey.current) panel.current?.querySelector<HTMLElement>('[aria-checked="true"][role="radio"]')?.focus()
    const outside = (e: PointerEvent) => {
      const t = e.target as Node
      // 表の縦の線をドラッグするとき（自分で決める。editor/columnHandles.ts）は、窓を開いたまま
      if (!panel.current?.contains(t) && !button.current?.contains(t) && !(t instanceof Element && t.closest('.col-handles'))) close(false)
    }
    const key = (e: KeyboardEvent) => {
      // Esc は窓を閉じるだけ（書いているセルは、書いたまま）
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        close(true)
        return
      }
      // 窓の中では、Tab で窓の中を回る
      const el = panel.current
      if (e.key !== 'Tab' || !el || !el.contains(document.activeElement)) return
      const list = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)]
      const i = list.indexOf(document.activeElement as HTMLElement)
      const next = e.shiftKey ? (i <= 0 ? list[list.length - 1] : list[i - 1]) : i >= list.length - 1 ? list[0] : list[i + 1]
      e.preventDefault()
      e.stopPropagation()
      next?.focus()
    }
    const resize = () => bump((n) => n + 1)
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', key, true)
    window.addEventListener('resize', resize)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', key, true)
      window.removeEventListener('resize', resize)
    }
  }, [open])

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`tb shape-btn${open ? ' open' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="列の幅・項目の列・行の高さを、絵を見て選ぶ"
        onMouseDown={keepFocus}
        onClick={(e) => {
          if (open) return close(true)
          back.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
          // キーボード（Enter・Space）で押したときは、クリックの位置がない
          byKey.current = e.detail === 0
          setOpen(true)
        }}
      >
        <TablePic kind="equal" />
        <span>
          {SHAPE_TEXTS.button.map((s) => (
            <span key={s} className="ph">
              {s}
            </span>
          ))}
        </span>
      </button>
      {open &&
        createPortal(
          <div ref={panel} className="shape-panel" role="dialog" aria-label={SHAPE_TEXTS.title}>
            <div className="sp-head">
              <b>{SHAPE_TEXTS.title}</b>
              <button type="button" className="sp-close" aria-label="閉じる" onMouseDown={keepFocus} onClick={() => close(true)}>
                {Icon.close}
              </button>
            </div>
            <ShapeOptions editor={editor} table={table} tableId={tableId} />
            <p className="so-note">
              <Phrase parts={SHAPE_TEXTS.live} />
            </p>
          </div>,
          document.body,
        )}
    </>
  )
}

/** スマホの道具の「表の形」の絵と名前（キーボードの上の道具・表を選んだときの下の道具・予備の下の書く欄） */
export function ShapeFace() {
  return (
    <>
      <TablePic kind="equal" />
      <span>{SHAPE_TEXTS.short}</span>
    </>
  )
}

/**
 * スマホの「表の形」で下から出る欄（mockups/v45 案A）。絵が上の選びを横に3つ・項目の列・行の高さ（押す所はどれも 44px 以上）。
 * 選ぶと、すぐ紙面の表が変わる。「できた」・後ろを押す・Esc で閉じる。
 * 「自分で決める」を選ぶと欄を閉じる（紙面の丸いつまみで幅を変える。キーボードの上の道具に「丸を左右に動かす」）
 */
export function TableShapeSheet({ editor, table, tableId, onClose }: { editor: ReportEditor; table: TableBlock; tableId: string; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null)
  useDialogFocus(ref, onClose)
  return (
    <>
      {/* 後ろを押したら閉じる（押したときに、書く欄からカーソルを外さない） */}
      <div className="scrim" onMouseDown={keepFocus} onClick={onClose} />
      <section className="sheet table-shape" role="dialog" aria-modal="true" aria-label={SHAPE_TEXTS.title} tabIndex={-1} ref={ref}>
        <div className="grab" />
        <header className="sheet-head">
          <h2>{SHAPE_TEXTS.title}</h2>
          <button type="button" className="ts-done close" onClick={onClose}>
            {SHAPE_TEXTS.done}
          </button>
        </header>
        <div className="sheet-body">
          <ShapeOptions editor={editor} table={table} tableId={tableId} phone onCustom={onClose} />
        </div>
      </section>
    </>
  )
}

