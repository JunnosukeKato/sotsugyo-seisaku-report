/**
 * スマホ：紙面を2本の指で広げる・縮める（依頼者の要望。2026-10-20）。
 * ブラウザの画面全体の拡大（上の帯・キーボードの上の道具・下のタブまで大きくなる）ではなく、このツールが紙面の倍率だけを変える。
 * ここでは指の動きだけを見て、2本の指の間の点（mid）と、始めからの指の間の長さの比（k）を、呼び出し側（editor/reportEditor.ts）に渡す。
 * 指を置いている間の見せ方（CSS の transform）と、指を離したときの本当の倍率は、呼び出し側が決める。
 * - 2本目の指を置いたら始まる。指を1本にしたら終わる（残った指で、続けて紙面を動かしたり、ページを送ったりはしない）
 * - 終わってすぐのタップ・はらいでは、書き始めない・ページを送らない（justEnded）
 * - iPhone（Safari）の、画面全体を広げる動き（gesture の知らせ）は止める（スマホの並べ方のときだけ：enabled）
 */

export interface Point {
  x: number
  y: number
}

export interface PinchHandlers {
  /** 指で広げてよいか（スマホの並べ方で、紙面があるとき） */
  enabled(): boolean
  /** 始まった（2本目の指を置いた）。始められなければ false */
  start(mid: Point): boolean
  /** 指が動いた（k：始めの指の間の長さの何倍か。mid：いまの2本の指の間の点） */
  move(k: number, mid: Point): void
  /** 指を離した（最後の k と mid） */
  end(k: number, mid: Point): void
}

/** 指で広げ終えてから、タップ・はらいを受け付けない時間（ms） */
const QUIET_MS = 400

export class PinchZoom {
  private readonly handlers: PinchHandlers
  private gesture: { d0: number; k: number; mid: Point } | null = null
  private endedAt = -Infinity

  constructor(target: HTMLElement, handlers: PinchHandlers) {
    this.handlers = handlers
    target.addEventListener('touchstart', (e) => this.onStart(e), { passive: false })
    target.addEventListener('touchmove', (e) => this.onMove(e), { passive: false })
    target.addEventListener('touchend', (e) => this.onEnd(e))
    target.addEventListener('touchcancel', (e) => this.onEnd(e))
    // iPhone（Safari）：2本の指で画面全体を広げる動きを止める（紙面はこのツールが広げる。上の帯・道具・タブは広げない）
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      document.addEventListener(
        type,
        (e) => {
          if (this.handlers.enabled()) e.preventDefault()
        },
        { passive: false },
      )
    }
  }

  /** 指で広げている途中か */
  get active(): boolean {
    return this.gesture !== null
  }

  /** 指で広げている途中か、広げ終えた直後か（このときのタップ・はらいは、書き始めない・ページを送らない） */
  get busy(): boolean {
    return this.gesture !== null || performance.now() - this.endedAt < QUIET_MS
  }

  private static measure(touches: TouchList): { d: number; mid: Point } {
    const a = touches[0]
    const b = touches[1]
    return { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), mid: { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 } }
  }

  private onStart(e: TouchEvent): void {
    if (e.touches.length < 2 || !this.handlers.enabled()) return
    // 2本の指を置いた：ブラウザの拡大・スクロール・タップ（書き始める・カーソルを動かす）にしない
    if (e.cancelable) e.preventDefault()
    if (this.gesture || e.touches.length !== 2) return
    const { d, mid } = PinchZoom.measure(e.touches)
    if (d < 1 || !this.handlers.start(mid)) return
    this.gesture = { d0: d, k: 1, mid }
  }

  private onMove(e: TouchEvent): void {
    const g = this.gesture
    if (!g) return
    if (e.cancelable) e.preventDefault()
    if (e.touches.length < 2) return
    const { d, mid } = PinchZoom.measure(e.touches)
    g.k = d / g.d0
    g.mid = mid
    this.handlers.move(g.k, mid)
  }

  private onEnd(e: TouchEvent): void {
    const g = this.gesture
    if (!g || e.touches.length >= 2) return
    this.gesture = null
    this.endedAt = performance.now()
    this.handlers.end(g.k, g.mid)
  }
}

/** スマホで紙面に直接書くときの大きさ（本文の幅を画面の幅に合わせる倍率の何倍か）を覚える場所 */
const WRITING_ZOOM_KEY = 'sotsugyo-seisaku-report-writing-zoom'
/** 覚える大きさの範囲（本文の幅に合わせる倍率の何倍か） */
const WRITING_ZOOM_MIN = 0.75
const WRITING_ZOOM_MAX = 3

/**
 * 覚えている、書くときの大きさ（覚えていなければ 1：本文の幅を画面の幅に合わせる）。
 * 0 は「拡大しない」（ページ全体のまま書く。書いている間に指でページ全体まで縮めた・メニューで「書くときに拡大する」を外した：依頼者の選択 2026-10-22）
 */
export function loadWritingZoom(): number {
  try {
    const raw = localStorage.getItem(WRITING_ZOOM_KEY)
    const v = Number(raw)
    if (raw === '0') return 0
    return Number.isFinite(v) && v > 0 ? Math.max(WRITING_ZOOM_MIN, Math.min(WRITING_ZOOM_MAX, v)) : 1
  } catch {
    return 1
  }
}

/** 書くときに拡大するか（メニューの「書くときに拡大する」） */
export const writingZoomOn = (): boolean => loadWritingZoom() !== 0

/** メニューの「書くときに拡大する」：外すと、ページ全体のまま書く。付けると、本文の幅を画面の幅に合わせる大きさに戻す */
export function setWritingZoomOn(on: boolean): void {
  try {
    if (on) localStorage.removeItem(WRITING_ZOOM_KEY)
    else localStorage.setItem(WRITING_ZOOM_KEY, '0')
  } catch {
    // 覚えておけなくても、いまの表示で書ける
  }
}

/** 書いている間に指で広げた・縮めた大きさを覚える（次に段落を押して書き始めるときも、この大きさで開く）。0 は「拡大しない」（ページ全体まで縮めた） */
export function saveWritingZoom(ratio: number): void {
  try {
    if (ratio === 0) return void localStorage.setItem(WRITING_ZOOM_KEY, '0')
    localStorage.setItem(WRITING_ZOOM_KEY, String(Math.max(WRITING_ZOOM_MIN, Math.min(WRITING_ZOOM_MAX, Math.round(ratio * 1000) / 1000))))
  } catch {
    // 覚えておけなくても、いまは広げた大きさで書ける
  }
}
