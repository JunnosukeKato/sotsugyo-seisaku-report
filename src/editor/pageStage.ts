/**
 * 紙面を1ページずつ表示する台（ステージ）の大きさを決める。
 * - 全体：1ページ全体が収まる倍率にし、中央に置く
 * - 拡大：紙面の横幅を台の幅いっぱいにし、上下にスクロールする
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

export class PageStage {
  scale = 1
  zoomed = false
  private readonly stage: HTMLElement
  private readonly onChange: () => void

  constructor(stage: HTMLElement, onChange: () => void) {
    this.stage = stage
    this.onChange = onChange
    new ResizeObserver(() => this.fit()).observe(stage)
  }

  setZoom(zoomed: boolean): void {
    this.zoomed = zoomed
    this.fit()
  }

  private inset(name: string, fallback: number): number {
    const value = parseFloat(getComputedStyle(this.stage).getPropertyValue(name))
    return Number.isFinite(value) ? value : fallback
  }

  fit(): void {
    const w = this.stage.clientWidth
    const h = this.stage.clientHeight
    if (w === 0 || h === 0) return
    // 拡大しているかで余白の幅を変えられるよう、先にクラスを付ける
    this.stage.classList.toggle('zoomed', this.zoomed)
    const side = this.inset('--inset-side', 180)
    const top = this.inset('--inset-top', 18)
    // スマホ：紙面の下に案内の帯を出すときは、その分も空ける（--inset-band。app/PageBand.tsx。拡大しているときは帯を出さない）
    const bottom = Math.max(this.inset('--inset-bottom', 18), this.zoomed ? 0 : this.inset('--inset-band', 0))
    // スマホで拡大するときは、余白を外して本文の幅を画面の幅に合わせる（--zoom-to-text: 1）
    const toText = this.zoomed && this.inset('--zoom-to-text', 0) === 1
    const byWidth = (w - side * 2) / (toText ? TEXT_W : PAGE_W)
    const scale = this.zoomed ? Math.min(MAX_ZOOM, byWidth) : Math.max(MIN_FIT, Math.min(byWidth, (h - top - bottom) / PAGE_H))
    const pageTop = this.zoomed ? top : top + (h - top - bottom - PAGE_H * scale) / 2
    const pageLeft = toText ? side - TEXT_LEFT * scale : (w - PAGE_W * scale) / 2
    const s = this.stage.style
    s.setProperty('--s', String(scale))
    s.setProperty('--page-w', `${PAGE_W * scale}px`)
    s.setProperty('--page-h', `${PAGE_H * scale}px`)
    s.setProperty('--page-top', `${pageTop}px`)
    s.setProperty('--page-left', `${pageLeft}px`)
    this.scale = scale
    this.onChange()
  }
}
