/**
 * 紙面を1ページずつ表示する台（ステージ）の大きさを決める。
 * - 全体：1ページ全体が収まる倍率にし、中央に置く
 * - 拡大：紙面の横幅を台の幅いっぱいにし、上下にスクロールする
 * - 見開き（PC だけ）：いまのページと次のページを左右に並べ、2ページが入る倍率にする
 * 紙面のまわりに空ける幅は CSS の変数（--inset-side・--inset-top・--inset-bottom）で決める（画面の幅で変えるため）。
 * 求めた倍率と位置は、台の要素の CSS 変数（--s・--page-w・--page-h・--page-top）に書き込む。
 */

/** A4 の大きさ（CSS の px） */
export const PAGE_W = 793.7
export const PAGE_H = 1122.52
/** 本文の版面（左の余白 35mm・右の余白 25mm の内側。足したばかりの欄を、紙面に出る前に仮に置くときにも使う：reportEditor.ts） */
export const TEXT_LEFT = 132.3
export const TEXT_W = 566.9
const MAX_ZOOM = 1.4
/**
 * 全体の表示の倍率の下限（台がとても低いとき（キーボードなど）に、紙面がつぶれないため）。
 * 前は 0.2 倍で、横向きのスマホ（844×390 など）では紙面が台に収まらず、紙面の下の端がページ送りに隠れていた（800×360 では 25px ほど）。
 * いまは、ふつうの横向きのスマホでは紙面がページ送りの上に収まる倍率になる
 */
const MIN_FIT = 0.1
/** 見開きを出せる台の幅（px）の下限。これより狭いと紙面がとても小さくなるので、見開きは出さない（全体にする） */
export const SPREAD_MIN_W = 640

/** スマホで指で広げられる大きさの上限（本文の幅を画面の幅に合わせる倍率の何倍まで。1字 30px ほど） */
export const PINCH_MAX = 3
/** 指で広げた倍率が、本文の幅に合わせる倍率にこれより近ければ、本文の幅に合わせる（そろえやすく。比で） */
const SNAP_TO_TEXT = 0.04

export class PageStage {
  scale = 1
  zoomed = false
  /**
   * スマホ：指で広げた・縮めた倍率（拡大しているとき。null なら、本文の幅を画面の幅に合わせる：--zoom-to-text）。
   * このときは、紙面の左の端を台の左の端に置き（紙面が台より狭ければ真ん中）、横の位置は紙面の表示枠のスクロールで決める（editor/reportEditor.ts の applyPinch）
   */
  private free: number | null = null
  /** 1ページ全体の表示の倍率（最後に全体を表示したとき。指で縮めるときの下限） */
  fitScale = 0.5
  /** 本文の幅を台の幅に合わせる倍率（スマホの拡大の基準） */
  textScale = 1
  /** 指で広げて、紙面が台より広い（横にも動かせる。台の印 pan-x：index.css） */
  panX = false
  /**
   * 見開き（mockups/v35 ③ 案A。PC だけ）：いまのページと次のページを並べる。道具は台の左端、←→は下（拡大のときと同じ）。
   * 2ページを左右に並べ、紙面の上の端に合わせる。右のページを左のページからずらす幅（縮小前の px）は --pair-dx に書き込む（index.css の「v35 見開き」）
   */
  spread = false
  private readonly stage: HTMLElement
  private readonly onChange: () => void

  constructor(stage: HTMLElement, onChange: () => void) {
    this.stage = stage
    this.onChange = onChange
    new ResizeObserver(() => this.fit()).observe(stage)
  }

  /** 拡大する・全体に戻す（どちらでも、見開きはやめる。指で広げた倍率もやめる） */
  setZoom(zoomed: boolean): void {
    this.zoomed = zoomed
    this.spread = false
    this.free = null
    this.fit()
  }

  /** スマホで指で広げた・縮めた倍率の範囲（1ページ全体〜本文の幅に合わせる倍率の PINCH_MAX 倍） */
  clampPinch(scale: number): number {
    return Math.max(this.fitScale, Math.min(this.textScale * PINCH_MAX, scale))
  }

  /**
   * スマホ：指で広げた・縮めた倍率にする（拡大の表示。本文の幅に合わせる倍率に近ければ、それにそろえる）。
   * 横の位置（紙面の表示枠のスクロール）は、呼び出し側が決める
   */
  setFreeZoom(scale: number): void {
    const s = this.clampPinch(scale)
    this.zoomed = true
    this.spread = false
    this.free = Math.abs(s / this.textScale - 1) < SNAP_TO_TEXT ? null : s
    this.fit()
  }

  /** 指で広げた倍率で表示しているか（本文の幅に合わせる拡大・全体の表示なら false） */
  get freeZoom(): boolean {
    return this.zoomed && this.free !== null
  }

  /** 見開きにする・やめる（台が狭いときは、見開きにしない） */
  setSpread(on: boolean): void {
    this.spread = on && this.spreadFits
    if (this.spread) this.zoomed = false
    this.fit()
  }

  /** 台が、見開きを出せる広さか */
  get spreadFits(): boolean {
    return this.stage.clientWidth >= SPREAD_MIN_W
  }

  private inset(name: string, fallback: number): number {
    const value = parseFloat(getComputedStyle(this.stage).getPropertyValue(name))
    return Number.isFinite(value) ? value : fallback
  }

  fit(): void {
    const w = this.stage.clientWidth
    const h = this.stage.clientHeight
    if (w === 0 || h === 0) return
    // 台が狭くなったら（欄の幅を広げた・画面を小さくした）、見開きをやめて全体にする
    if (this.spread && !this.spreadFits) this.spread = false
    // 拡大しているか・見開きかで余白の幅を変えられるよう、先にクラスを付ける
    this.stage.classList.toggle('zoomed', this.zoomed)
    this.stage.classList.toggle('spread', this.spread)
    const side = this.inset('--inset-side', 180)
    const top = this.inset('--inset-top', 18)
    // スマホの紙面の下の案内の帯は、紙面に重ねる（帯の分は空けない。どのページも紙面が同じ位置に出る。app/PageBand.tsx・mockups/v46 案B）
    const bottom = this.inset('--inset-bottom', 18)
    // スマホで拡大するときは、余白を外して本文の幅を画面の幅に合わせる（--zoom-to-text: 1）
    const toText = this.zoomed && this.inset('--zoom-to-text', 0) === 1
    const byWidth = (w - side * 2) / (toText ? TEXT_W : PAGE_W)
    this.textScale = (w - side * 2) / TEXT_W
    // 指で広げた倍率（スマホ）：紙面の左の端を台の左の端に（台より狭ければ真ん中に）置き、横の位置はスクロールで決める
    const free = this.zoomed && this.free !== null ? this.clampPinch(this.free) : null
    let scale = free ?? (this.zoomed ? Math.min(MAX_ZOOM, byWidth) : Math.max(MIN_FIT, Math.min(byWidth, (h - top - bottom) / PAGE_H)))
    if (!this.zoomed && !this.spread) this.fitScale = scale
    let pageTop = this.zoomed ? top : top + (h - top - bottom - PAGE_H * scale) / 2
    let pageLeft = free !== null ? Math.max(0, (w - PAGE_W * scale) / 2) : toText ? side - TEXT_LEFT * scale : (w - PAGE_W * scale) / 2
    this.panX = free !== null && PAGE_W * scale > w
    this.stage.classList.toggle('pan-x', this.panX)
    const s = this.stage.style
    if (this.spread) {
      // 見開き：左は道具の分、右は少し、2ページの間は gap、下は←→と「全体／見開き／拡大」の分を空けて、2ページが入る倍率にする
      const left = this.inset('--spread-left', 110)
      const right = this.inset('--spread-right', 24)
      const gap = this.inset('--spread-gap', 14)
      const below = this.inset('--spread-bottom', 72)
      scale = Math.max(MIN_FIT, Math.min((w - left - right - gap) / 2 / PAGE_W, (h - top - below) / PAGE_H))
      pageTop = top
      pageLeft = left + (w - left - right - (PAGE_W * scale * 2 + gap)) / 2
      s.setProperty('--pair-dx', `${PAGE_W + gap / scale}px`)
    }
    s.setProperty('--s', String(scale))
    s.setProperty('--page-w', `${PAGE_W * scale}px`)
    s.setProperty('--page-h', `${PAGE_H * scale}px`)
    s.setProperty('--page-top', `${pageTop}px`)
    s.setProperty('--page-left', `${pageLeft}px`)
    this.scale = scale
    this.onChange()
  }
}
