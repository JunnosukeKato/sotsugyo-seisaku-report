import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useDialogFocus } from './useDialogFocus'

/**
 * 指差し確認（mockups/v27 案A「スポットライト」）。画面の大事な場所に1か所ずつ光を当て、ひとことで知らせる。
 * PC は7か所（紙面・道具・ページの一覧・保存のようす・セルフチェック・PDFを書き出す・？使い方）、
 * スマホは4か所（紙面・下の「チェック」「PDF」・保存のようす・メニュー）。
 * 「次へ」で次の場所へ、「とばす」（Esc）でいつでも終わる。見終えたら（とばしたら）この端末に覚えておき、次からは出さない。
 * 使い方の「指差し確認をもう一度見る」から、もう一度見られる。
 * 場所が見つからない・隠れているときは、その段をとばす
 */

type Side = 'below' | 'above' | 'left' | 'right'
interface Rect {
  left: number
  top: number
  width: number
  height: number
}
interface Step {
  title: string
  text: string
  /** 光を当てる要素（いくつかなら、それらを囲む範囲） */
  targets: () => Element[]
  /** 吹き出しを置く側（前から順に、画面に入る側を選ぶ） */
  sides: Side[]
}

/** 表示している紙面のページ */
const CUR = '.page-viewport.front [data-vivliostyle-page-container].is-current'

/** 見えている要素か（大きさがあり、画面の中に少しでも入っている） */
function visible(el: Element): boolean {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight && getComputedStyle(el).visibility !== 'hidden'
}
const first = (selector: string) => () => [...document.querySelectorAll(selector)].filter(visible).slice(0, 1)
/** 紙面：表示しているページの最初の段落（なければページ全体） */
const paper = () => {
  const p = [...document.querySelectorAll(`${CUR} p[data-block-id]`)].find(visible)
  return p ? [p] : first(CUR)()
}

const PC_STEPS = (drive: boolean): Step[] => [
  { title: '紙面', text: '文をクリックすると、その場で書けます。', targets: paper, sides: ['below', 'above', 'right'] },
  { title: '道具', text: '図・表は、文中をクリックしてから、ここで入れます。', targets: first('.palette'), sides: ['right'] },
  { title: 'ページの一覧', text: '押すと、そのページへ。赤い点は、エラーのあるページです。', targets: first('.thumbs-col'), sides: ['right'] },
  {
    title: '保存のようす',
    text: drive ? '書くたびに、ドライブに自動で保存します。時刻は、最後に保存した時刻です。' : '書くたびに、この端末に自動で保存します。',
    targets: first('.side .meta > :first-child'),
    sides: ['left', 'below'],
  },
  { title: 'セルフチェック', text: '直すところの一覧です。× を0件にします。', targets: first('.side .sec.check'), sides: ['left'] },
  { title: 'PDFを書き出す', text: 'エラーが0件になったら、ここから提出用の PDF にします。', targets: first('.side .export'), sides: ['left', 'above'] },
  { title: '？ 使い方', text: '困ったら、ここを押します。言葉で探せます。', targets: first('.side .help-btn'), sides: ['left', 'below'] },
]
const PHONE_STEPS = (drive: boolean): Step[] => [
  { title: '紙面', text: '文をタップすると、書く欄が出ます。', targets: paper, sides: ['below', 'above'] },
  {
    title: 'チェックと PDF',
    text: '直すところの一覧と、PDF の書き出しは、ここです。',
    targets: () => [...first('.p-nav .nav-check')(), ...first('.p-nav .nav-pdf')()],
    sides: ['above'],
  },
  {
    title: '保存のようす',
    text: drive ? 'ドライブに自動で保存します。時刻は、最後に保存した時刻です。' : 'この端末に自動で保存します。',
    targets: first('.p-top .chip'),
    sides: ['below'],
  },
  { title: 'メニュー', text: '手順書・バックアップ・？使い方は、ここです。', targets: first('.p-top .icon-btn'), sides: ['below'] },
]

/** 要素を囲む範囲（見つからなければ null） */
function rectOf(step: Step): Rect | null {
  const els = step.targets()
  if (!els.length) return null
  const rs = els.map((e) => e.getBoundingClientRect())
  const left = Math.min(...rs.map((r) => r.left))
  const top = Math.min(...rs.map((r) => r.top))
  return { left, top, width: Math.max(...rs.map((r) => r.right)) - left, height: Math.max(...rs.map((r) => r.bottom)) - top }
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))
/** 光の枠のまわりの余白 */
const PAD = 6
/** 光の枠を、画面の端から少し内側に収める（画面の端の欄に当てても、白い縁が見えるように） */
function spotOf(r: Rect): Rect {
  const left = Math.max(3, r.left - PAD)
  const top = Math.max(3, r.top - PAD)
  return { left, top, width: Math.min(innerWidth - 3, r.left + r.width + PAD) - left, height: Math.min(innerHeight - 3, r.top + r.height + PAD) - top }
}

/** 吹き出しを、光の枠の横（sides の順に、画面に入る側）に置き、矢印を枠に向ける */
function placeTip(tip: HTMLElement, r: Rect, sides: Side[], narrow: boolean) {
  const W = innerWidth
  const H = innerHeight
  const m = 10
  const gap = 14
  // スマホは横いっぱい（広い画面でも 420px まで）
  if (narrow) tip.style.width = `${Math.min(W - m * 2, 420)}px`
  const w = tip.offsetWidth
  const h = tip.offsetHeight
  for (const [i, side] of sides.entries()) {
    let left: number
    let top: number
    if (side === 'below' || side === 'above') {
      left = clamp(r.left + r.width / 2 - (narrow ? w / 2 : Math.min(w / 2, 60)), m, W - w - m)
      top = side === 'below' ? r.top + r.height + gap : r.top - gap - h
    } else {
      left = side === 'right' ? r.left + r.width + gap : r.left - gap - w
      top = clamp(r.top + Math.min(r.height / 2, 40) - 30, m, H - h - m)
    }
    const fits = left >= m && top >= m && left + w <= W - m && top + h <= H - m
    if (!fits && i < sides.length - 1) continue
    // どの側にも入らないときは、画面の中に収めて重ねる（矢印は出さない）
    tip.dataset.side = fits ? side : 'none'
    tip.style.left = `${clamp(left, m, W - w - m)}px`
    tip.style.top = `${clamp(top, m, H - h - m)}px`
    tip.style.setProperty('--ax', `${clamp(r.left + r.width / 2 - left - 9, 16, w - 34)}px`)
    tip.style.setProperty('--ay', `${clamp(r.top + Math.min(r.height / 2, 40) - top - 9, 14, h - 30)}px`)
    return
  }
}

interface Props {
  narrow: boolean
  /** Google ドライブにも保存しているか（保存のようすの説明を変える） */
  drive: boolean
  /** 見終えた・とばした */
  onDone: () => void
}

export function Tour({ narrow, drive, onDone }: Props) {
  // 始めたときに、場所が見つかる段だけにする。使い方を閉じてすぐ（右の欄が戻る前）にも始めるため、画面ができてから（次のフレームで）調べる
  const [steps, setSteps] = useState<Step[] | null>(null)
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => setSteps((narrow ? PHONE_STEPS(drive) : PC_STEPS(drive)).filter((s) => rectOf(s))))
    return () => cancelAnimationFrame(frame)
  }, [narrow, drive])
  // 見せる場所が1つもなければ、すぐ終える
  useEffect(() => {
    if (steps && !steps.length) onDone()
  }, [steps, onDone])
  return steps?.length ? <TourSteps steps={steps} narrow={narrow} onDone={onDone} /> : null
}

/** 調べた段を、1つずつ見せる */
function TourSteps({ steps, narrow, onDone }: { steps: Step[]; narrow: boolean; onDone: () => void }) {
  const [index, setIndex] = useState(0)
  // 最初の場所は、はじめて描くときから決めておく（吹き出しを隠したまま出すと、吹き出しのボタンに移れないため）
  const [rect, setRect] = useState<Rect | null>(() => (steps[0] ? rectOf(steps[0]) : null))
  const tipRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  // 吹き出しに移り、Tab で外に出ない。Esc は「とばす」
  useDialogFocus(tipRef, onDone)
  const step = steps[index]
  const last = index === steps.length - 1

  // 紙面などに移った文字のカーソル（ページを送ったあと、紙面が自分の欄に戻すなど）は、吹き出しに戻す
  // （指差し確認の間に、Enter で紙面の欄を書き始めたりしないように）
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      const tip = tipRef.current
      if (tip && e.target instanceof Node && !tip.contains(e.target)) tip.querySelector<HTMLElement>('.next')?.focus()
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [])

  // 光を当てる場所の位置。画面の大きさ・ページの切り替えなどで動くため、毎フレーム確かめ、変わったときだけ動かす。
  // 途中で場所が見えなくなったら、その段をとばす
  useLayoutEffect(() => {
    if (!step) return
    let frame = 0
    let key = ''
    const measure = () => {
      const r = rectOf(step)
      if (!r) {
        if (last) onDone()
        else setIndex((i) => i + 1)
        return
      }
      const k = [r.left, r.top, r.width, r.height].map(Math.round).join()
      if (k !== key) {
        key = k
        setRect(r)
      }
      frame = requestAnimationFrame(measure)
    }
    measure()
    return () => cancelAnimationFrame(frame)
  }, [step, last, onDone])

  useLayoutEffect(() => {
    if (tipRef.current && rect && step) placeTip(tipRef.current, spotOf(rect), step.sides, narrow)
  }, [rect, step, narrow])

  if (!step) return null
  const spot = rect ? spotOf(rect) : null
  return (
    <div className={`tour${narrow ? ' narrow' : ''}`}>
      {/* 指差し確認の間は、ほかの所を押せないようにする */}
      <div className="tour-block" />
      {spot && <div className="tour-spot" style={{ left: spot.left, top: spot.top, width: spot.width, height: spot.height }} />}
      <div className="tour-tip" ref={tipRef} role="dialog" aria-modal="true" aria-labelledby={titleId} style={spot ? undefined : { opacity: 0 }}>
        <div className="tour-k">
          指差し確認<span>{index + 1} / {steps.length}</span>
          <span className="tour-dots" aria-hidden="true">
            {steps.map((s, i) => (
              <i key={s.title} className={i === index ? 'on' : i < index ? 'past' : ''} />
            ))}
          </span>
        </div>
        <div aria-live="polite">
          <h2 id={titleId}>{step.title}</h2>
          <p>{step.text}</p>
        </div>
        <div className="tour-acts">
          {!last && (
            <button className="skip" onClick={onDone}>
              とばす
            </button>
          )}
          <button className="next" data-autofocus onClick={() => (last ? onDone() : setIndex(index + 1))}>
            {last ? 'おわり' : '次へ'}
          </button>
        </div>
        {last && <span className="tour-again">この案内は、<b>？使い方</b>からもう一度見られます</span>}
      </div>
    </div>
  )
}
