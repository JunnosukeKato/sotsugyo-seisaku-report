/**
 * 紙面で文を選んだときに、選んだ所のすぐ上に出す小さな帯「コピー・切り取り・削除」と、
 * コピーしたあと書く欄を開いたときに、カーソルの近くに出す「貼り付け」（mockups/v36 案A。依頼者の選んだ形：案B（左の道具）と一緒に出す）。
 * - 帯は、選んだ文の1行目のすぐ上に出す。上に入らないとき（見えている所の上の端）は、選んだ文の最後の行のすぐ下に出す（選んだ文には重ねない）
 * - 押しても、紙面で選んだ文は外れない（押したときにフォーカスを移さない）。「貼り付け」も、書く欄のカーソルをそのままにする
 * 出す・隠すを決めるのは編集の中核（reportEditor.ts の updateSelectionUi）。紙面に重ねる層（入力欄と同じ所）に置く、画面だけの部品（PDF・印刷には出ない）
 */

/** Mac のキーボードか（キーの書き方：⌘ と Ctrl） */
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent)

/** キーボードでの押し方の書き方（例：Ctrl+C、Mac は ⌘+C） */
export function shortcut(key: string): string {
  return `${MAC ? '⌘' : 'Ctrl'}+${key}`
}

/** 削除のキーの名前（Mac は delete） */
export const DELETE_KEY = MAC ? 'delete' : 'Delete'

const svg = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
/** アイコン（app/icons.tsx の copy・cut・remove・paste と同じ線） */
const ICON = {
  copy: svg('<rect x="8.5" y="8.5" width="11" height="11.5" rx="1.6"/><path d="M15.5 8.5V5.6A1.6 1.6 0 0013.9 4H5.6A1.6 1.6 0 004 5.6v8.3a1.6 1.6 0 001.6 1.6h2.9"/>'),
  cut: svg('<circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><path d="M8.3 15.7L18 4.5M15.7 15.7L6 4.5"/>'),
  remove: svg('<path d="M5 7h14M10 7V5.5h4V7M7 7l.9 12h8.2L17 7"/>'),
  paste: svg('<path d="M9 5H7.2A1.7 1.7 0 005.5 6.7v12.6A1.7 1.7 0 007.2 21h9.6a1.7 1.7 0 001.7-1.7V6.7A1.7 1.7 0 0016.8 5H15"/><rect x="9" y="3.5" width="6" height="3" rx="1"/><path d="M9 12h6M9 15.5h4"/>'),
}

/** 選んだ文の道具の言葉（左の道具の「選んだ文」と、帯で同じ） */
export const SELECTION_TEXTS = {
  group: '選んだ文',
  copy: { label: 'コピー', title: () => `選んだ文をコピー（${shortcut('C')}）` },
  cut: { label: '切り取り', title: () => `選んだ文を切り取る（${shortcut('X')}）。書く欄で貼り付けると、そこへ動きます` },
  remove: { label: '削除', title: () => `選んだ文を削除（${DELETE_KEY}）` },
  paste: { label: '貼り付け', title: () => `コピーした文・図を、カーソルの所に入れる（${shortcut('V')}）` },
}

/** 帯・「貼り付け」を置いてよい範囲（画面座標。見えている紙面のあたり） */
export interface Bounds {
  top: number
  bottom: number
  left: number
  right: number
}

/** 選んだ文と帯の間（画面の px） */
const GAP = 8

export interface SelectionActions {
  copy(): void
  cut(): void
  remove(): void
  paste(): void
}

export class SelectionBar {
  readonly bar: HTMLDivElement
  readonly chip: HTMLButtonElement
  private readonly layer: HTMLElement

  constructor(layer: HTMLElement, actions: SelectionActions) {
    this.layer = layer
    const bar = document.createElement('div')
    bar.className = 'range-bar'
    bar.setAttribute('role', 'toolbar')
    bar.setAttribute('aria-label', SELECTION_TEXTS.group)
    bar.hidden = true
    const button = (cls: string, icon: string, label: string, title: string, run: () => void) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = cls
      b.title = title
      b.setAttribute('aria-label', title)
      b.innerHTML = `${icon}<span>${label}</span>`
      // 押しても、紙面で選んだ文（書く欄のカーソル）を外さない
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', run)
      return b
    }
    const sep = document.createElement('span')
    sep.className = 'sep'
    bar.append(
      button('copy', ICON.copy, SELECTION_TEXTS.copy.label, SELECTION_TEXTS.copy.title(), () => actions.copy()),
      button('cut', ICON.cut, SELECTION_TEXTS.cut.label, SELECTION_TEXTS.cut.title(), () => actions.cut()),
      sep,
      button('remove danger', ICON.remove, SELECTION_TEXTS.remove.label, SELECTION_TEXTS.remove.title(), () => actions.remove()),
    )
    this.bar = bar
    this.chip = button('range-chip', ICON.paste, SELECTION_TEXTS.paste.label, SELECTION_TEXTS.paste.title(), () => actions.paste())
    this.chip.hidden = true
    layer.append(bar, this.chip)
  }

  get barShown(): boolean {
    return !this.bar.hidden
  }

  /**
   * 帯を、選んだ文（lines：見えている行の四角。画面座標）の1行目のすぐ上に出す。上に入らなければ、最後の行のすぐ下に出す。
   * 横は、1行目の始めの少し左から（見えている紙面からはみ出さない）
   */
  showBar(lines: DOMRect[], bounds: Bounds): void {
    if (lines.length === 0) return this.hideBar()
    const b = this.bar
    b.hidden = false
    const layer = this.layer.getBoundingClientRect()
    const top = Math.min(...lines.map((r) => r.top))
    const bottom = Math.max(...lines.map((r) => r.bottom))
    const first = lines.filter((r) => r.top < top + 2).sort((x, y) => x.left - y.left)[0]
    const w = b.offsetWidth
    const h = b.offsetHeight
    // 上に入るか（見えている所の上の端より下）。入らなければ下（下にも入らなければ、上の端に合わせる）
    const above = top - GAP - h >= bounds.top + 4 || bottom + GAP + h > bounds.bottom - 4
    const y = above ? Math.max(bounds.top + 4, top - GAP - h) : bottom + GAP
    const x = Math.max(bounds.left + 4, Math.min(first.left - 14, bounds.right - w - 4))
    b.classList.toggle('below', !above)
    b.style.left = `${x - layer.left}px`
    b.style.top = `${y - layer.top}px`
    // 帯の小さな三角は、1行目の始めを指す
    b.style.setProperty('--ax', `${Math.max(12, Math.min(w - 12, first.left + 8 - x))}px`)
  }

  hideBar(): void {
    this.bar.hidden = true
  }

  /** 「貼り付け」を、書く欄のカーソル（caret：画面座標）のすぐ上に出す（上に入らなければ下） */
  showChip(caret: { left: number; top: number; bottom: number }, bounds: Bounds): void {
    const c = this.chip
    c.hidden = false
    const layer = this.layer.getBoundingClientRect()
    const w = c.offsetWidth
    const h = c.offsetHeight
    const above = caret.top - 6 - h >= bounds.top + 4
    const y = above ? caret.top - 6 - h : caret.bottom + 6
    const x = Math.max(bounds.left + 4, Math.min(caret.left - 16, bounds.right - w - 4))
    c.classList.toggle('below', !above)
    c.style.left = `${x - layer.left}px`
    c.style.top = `${y - layer.top}px`
    c.style.setProperty('--ax', `${Math.max(10, Math.min(w - 10, caret.left - x))}px`)
  }

  hideChip(): void {
    this.chip.hidden = true
  }
}
