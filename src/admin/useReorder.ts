import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

/**
 * 一覧の並べ替え（コースのカード・ひな形の行）。「↑ 上へ」「↓ 下へ」のボタンの代わりに、ドラッグで動かす。
 * 左上のつまみ（⋮⋮）をつかんで上下に動かすと、落とす場所に線が出て、離すとそこへ移る。
 * マウスと指のどちらでも動くよう、ポインターのイベントで扱う（つまみの上では画面がスクロールしない）。
 * つまみはボタンなので、キーボードでは ↑・↓ で1つずつ動かせる（動かした先を読み上げる）。
 * 一覧の上・下の端の近くまで動かすと、一覧をスクロールする（長い一覧の端まで運べるように）
 */

/** つかんでいる間の状態 */
export interface ReorderDrag {
  /** つかんだ行の番号 */
  from: number
  /** 離すと移る番号（並べ替えたあとの番号） */
  to: number
  /** 落とす場所の線の位置（一覧の上の端から。px）。動かない場所では null（線を出さない） */
  line: number | null
}

/** 端からこの幅（px）に入ったら、一覧をスクロールする */
const EDGE = 48

/** いちばん近い、縦にスクロールする入れ物 */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY
    if ((overflow === 'auto' || overflow === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return null
}

/**
 * listRef：一覧の要素（行が並ぶ入れ物。落とす場所の線もこの中に出す）。
 * itemSelector：一覧の中の、並べ替える行の CSS セレクター（一覧のすぐ下の子だけを見る）。
 * onMove(from, to)：from 番目の行を to 番目に移す（to は並べ替えたあとの番号）
 */
export function useReorder(listRef: RefObject<HTMLElement | null>, count: number, onMove: (from: number, to: number) => void, itemSelector: string) {
  const [drag, setDrag] = useState<ReorderDrag | null>(null)
  /** 読み上げる知らせ（aria-live の欄に出す） */
  const [message, setMessage] = useState('')
  // 動かす関数は描くたびに変わる（中の設定が変わるため）。離したときは、いちばん新しい関数を呼ぶ
  const moveRef = useRef(onMove)
  useEffect(() => {
    moveRef.current = onMove
  })
  // キーボードで動かした行のつまみ（並べ替えでつまみが一度ページから外れると、選んでいた状態が消えるので、選び直す）
  const grips = useRef(new Map<string | number, HTMLButtonElement>())
  const refocus = useRef<string | number | null>(null)
  useEffect(() => {
    if (refocus.current === null) return
    const grip = grips.current.get(refocus.current)
    refocus.current = null
    if (grip && document.activeElement !== grip) grip.focus()
  })
  // つかんだまま一覧が消えた（窓を閉じたなど）ときの後始末
  const cleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanup.current?.(), [])

  /** 同じ知らせが続いても読み上げるよう、見えない字で変える */
  const say = (text: string) => setMessage((prev) => (prev === text ? `${text}​` : text))

  /** 指（マウス）の高さ y で離したときに移る番号と、線の位置 */
  const target = (y: number, from: number): Omit<ReorderDrag, 'from'> => {
    const list = listRef.current
    if (!list) return { to: from, line: null }
    const items = [...list.querySelectorAll<HTMLElement>(`:scope > ${itemSelector}`)]
    const rects = items.map((el) => el.getBoundingClientRect())
    // 線を入れる隙間：真ん中より上にある最初の行の前（なければいちばん下）
    let gap = rects.findIndex((r) => y < r.top + r.height / 2)
    if (gap < 0) gap = rects.length
    const to = gap > from ? gap - 1 : gap
    if (to === from || rects.length === 0) return { to: from, line: null }
    const top = list.getBoundingClientRect().top
    // 行と行の間の真ん中（いちばん上・いちばん下は、行の少し外）
    const y0 = gap === 0 ? rects[0].top - 3 : gap === rects.length ? rects[gap - 1].bottom + 3 : (rects[gap - 1].bottom + rects[gap].top) / 2
    return { to, line: y0 - top }
  }

  const onPointerDown = (i: number) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || count < 2 || !listRef.current) return
    const list = listRef.current
    const id = e.pointerId
    // 指でもマウスでも、離すまでの動きをこのつまみで受け取る（見本の iframe の上に動かしても途切れない）
    e.currentTarget.setPointerCapture?.(id)
    const scroller = scrollParent(list)
    let lastY = e.clientY
    let current: ReorderDrag = { from: i, to: i, line: null }
    setDrag(current)
    document.body.classList.add('reordering')
    const update = () => {
      const next = { from: i, ...target(lastY, i) }
      if (next.to !== current.to || next.line !== current.line) {
        current = next
        setDrag(next)
      }
    }
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      lastY = ev.clientY
      update()
    }
    // 一覧の上・下の端の近くでは、一覧をスクロールする（端に近いほど速く）
    let frame = 0
    const tick = () => {
      if (scroller) {
        const r = scroller.getBoundingClientRect()
        const dy = lastY < r.top + EDGE ? -Math.ceil((r.top + EDGE - lastY) / 4) : lastY > r.bottom - EDGE ? Math.ceil((lastY - r.bottom + EDGE) / 4) : 0
        if (dy) {
          const before = scroller.scrollTop
          scroller.scrollTop += dy
          if (scroller.scrollTop !== before) update()
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      stop()
      setDrag(null)
      if (ev.type === 'pointerup' && current.to !== i) {
        moveRef.current(i, current.to)
        say(`${current.to + 1}番目に移しました`)
      }
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      cancelAnimationFrame(frame)
      document.body.classList.remove('reordering')
      cleanup.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    cleanup.current = stop
  }

  const onKeyDown = (i: number, key: string | number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const to = e.key === 'ArrowUp' ? i - 1 : i + 1
    if (to < 0) return say('いちばん上です')
    if (to >= count) return say('いちばん下です')
    refocus.current = key
    moveRef.current(i, to)
    say(`${to + 1}番目に移しました`)
  }

  /** つまみ（⋮⋮）のボタンに付ける。key は行の目印（並べ替えても変わらないもの） */
  const gripProps = (i: number, key: string | number) => ({
    type: 'button' as const,
    'aria-label': '並べ替え（矢印キーで動かす）',
    title: 'つかんで上下に動かすと、順番を入れ替えられます',
    ref: (el: HTMLButtonElement | null) => {
      if (el) grips.current.set(key, el)
      else grips.current.delete(key)
    },
    onPointerDown: onPointerDown(i),
    onKeyDown: onKeyDown(i, key),
  })

  return { drag, message, gripProps }
}
