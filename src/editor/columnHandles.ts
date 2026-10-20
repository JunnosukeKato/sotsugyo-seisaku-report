import { moveColumnBorder } from '../model/table'

/**
 * 列の幅を「自分で決める」表の、列の境目を動かす部品（mockups/v42）。
 * 紙面に重ねる層（#overlay-layer）に置く、画面だけの部品。紙面の中には入れないので、PDF・印刷には出ず、ページの組み方も変えない。
 *
 * - パソコン（② の案）：表のセル・タイトルを書いている間と、表を選んでいる間だけ、内側の縦の線に、うすい線と細いつまみを出す。
 *   線にマウスを乗せると、左右の矢印のカーソルと「左右にドラッグ」。ドラッグすると線が 5% ずつ止まり、線の上に「20%｜30%」（線の左の列｜右の列）、
 *   元の位置に点線。動かせるのは、となりの2列の間だけ（ほかの列の幅は変わらない）。となりの列が 10% になると、それ以上は動かない。
 *   離すと、原稿の列の幅を変えて組み直す（元に戻す1回で戻る：editor/reportEditor.ts の setTableColWidths）
 * - スマホ（案D）：セルを書いている間、その列をうすく色付けし、その列の両側の内側の線に、丸いつまみ（30px。指で押せる所は 44px 四方）。
 *   指1本で左右に動かすと、その線が動き、その側のとなりの列と幅をやりとりする（5% ずつ）。
 *   つまみを動かしている間は、紙面を動かさない（touch-action: none）・ページを送らない・2本の指の拡大を始めない（指の知らせを、紙面の台へ渡さない）
 */

/** 境目を動かす表 */
export interface ColumnTarget {
  tableId: string
  /** いまの列の幅（%。合計 100） */
  widths: number[]
  /** スマホ：書いているセル（その列を選ぶ）。パソコンは null */
  cellId: string | null
}

export interface ColumnHandlesHost {
  /** 動かし終えた（新しい幅。変わったときだけ） */
  onCommit(tableId: string, widths: number[]): void
}

/** 紙面の表の列の幅が、widths（%）になっているか（0.5% まで） */
function sameWidths(f: Fragment, widths: number[]): boolean {
  const ws = f.cells.map((c) => c.getBoundingClientRect().width)
  const sum = ws.reduce((a, b) => a + b, 0)
  return ws.length === widths.length && sum > 0 && ws.every((w, i) => Math.abs((w / sum) * 100 - widths[i]) < 0.5)
}

/** 「20%｜30%」の数（小数は四捨五入） */
const pct = (w: number) => `${Math.round(w)}%`

/** 左右の矢印（スマホのつまみの中） */
const ARROWS =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 12h17M7 8.5 3.5 12 7 15.5M17 8.5l3.5 3.5-3.5 3.5"/></svg>'

interface Fragment {
  table: HTMLElement
  /** 見出しの行のセル（列ごと） */
  cells: HTMLElement[]
  rect: DOMRect
  head: DOMRect
}

interface Drag {
  pointerId: number
  tableId: string
  border: number
  startX: number
  /** 表の幅（画面の px。列の幅の合計） */
  width: number
  start: number[]
  next: number[]
  /** 動かす線（と、スマホのつまみ）の、はじめの位置（層の中の px） */
  baseX: number
  line: HTMLElement
  knob: HTMLElement | null
  ghost: HTMLElement
  label: HTMLElement
  labelTop: number
}

export class ColumnHandles {
  private readonly root: HTMLElement
  private readonly tip: HTMLElement
  private drag: Drag | null = null
  /** 動かし終えて、組み直した紙面を待っている（それまでは、動かした所に線を残す。前は、組み直す間だけ元の位置に戻って見えた） */
  private pending: { tableId: string; widths: number[]; until: number } | null = null

  private readonly layer: HTMLElement
  private readonly host: ColumnHandlesHost

  constructor(layer: HTMLElement, host: ColumnHandlesHost) {
    this.layer = layer
    this.host = host
    this.root = document.createElement('div')
    this.root.className = 'col-handles'
    this.root.hidden = true
    this.tip = document.createElement('div')
    this.tip.className = 'col-tip'
    this.tip.textContent = '左右にドラッグ'
    this.tip.hidden = true
    layer.append(this.root, this.tip)
  }

  /** つまみ・線を動かしている途中か（スマホ：この間は、2本の指の拡大を始めない） */
  get dragging(): boolean {
    return this.drag !== null
  }

  /**
   * 出し直す（target が null なら隠す）。紙面の位置が変わったとき（組み直し・スクロール・倍率・ページ送り）も呼び直す。
   * viewport：表に出ている紙面の表示枠。phone：スマホの形（丸いつまみ・選んだ列の色）
   */
  sync(target: ColumnTarget | null, viewport: HTMLElement, phone: boolean): void {
    // 動かしている間は、出し直さない（組み直しが終わるまで、動かしている線をそのまま見せる）
    if (this.drag) return
    // 出す表がない（ふだん。段落を書いている間は、1字ごとに呼ばれる）：もう隠していれば、何も変えない（紙面の組み方を測り直させない）
    if (!target) {
      this.pending = null
      if (!this.root.hidden) {
        this.root.hidden = true
        this.root.replaceChildren()
      }
      if (!this.tip.hidden) this.tip.hidden = true
      return
    }
    const fragments = this.fragments(target.tableId, viewport)
    const p = this.pending
    if (p && target.tableId === p.tableId && performance.now() < p.until && fragments.length > 0 && !sameWidths(fragments[0], p.widths)) return
    this.pending = null
    this.root.replaceChildren()
    this.tip.hidden = true
    if (fragments.length === 0) {
      this.root.hidden = true
      return
    }
    this.root.hidden = false
    this.root.classList.toggle('phone', phone)
    const layer = this.layer.getBoundingClientRect()
    if (phone) this.placePhone(target, fragments, layer)
    else this.placePc(target, fragments, layer)
  }

  /** 表の、いま見えているページの部分（ページをまたぐ表は、見えているページごと） */
  private fragments(tableId: string, viewport: HTMLElement): Fragment[] {
    return [...viewport.querySelectorAll<HTMLElement>(`.data-table[data-table-id="${CSS.escape(tableId)}"] table`)].flatMap((table) => {
      const rect = table.getBoundingClientRect()
      const headRow = table.querySelector<HTMLElement>(':scope > thead > tr, :scope > tbody > tr')
      const cells = headRow ? ([...headRow.children] as HTMLElement[]) : []
      if (rect.width <= 0 || rect.height <= 0 || cells.length < 2) return []
      return [{ table, cells, rect, head: headRow!.getBoundingClientRect() }]
    })
  }

  private el(className: string, parent: HTMLElement = this.root): HTMLElement {
    const e = document.createElement('div')
    e.className = className
    parent.append(e)
    return e
  }

  /** パソコン：内側の縦の線ごとに、うすい線（つかめる所は少し広い）と、見出しの行の高さの細いつまみ */
  private placePc(target: ColumnTarget, fragments: Fragment[], layer: DOMRect): void {
    for (const f of fragments) {
      for (let i = 0; i < f.cells.length - 1; i++) {
        const x = f.cells[i].getBoundingClientRect().right - layer.left
        const grip = this.el('col-grip')
        Object.assign(grip.style, { left: `${x}px`, top: `${f.rect.top - layer.top}px`, height: `${f.rect.height}px` })
        const knob = this.el('col-knob', grip)
        knob.style.top = `${f.head.top + f.head.height / 2 - f.rect.top}px`
        grip.addEventListener('pointerenter', () => {
          if (this.drag) return
          Object.assign(this.tip.style, { left: `${x + 12}px`, top: `${f.head.top + f.head.height / 2 - layer.top}px` })
          this.tip.hidden = false
        })
        grip.addEventListener('pointerleave', () => (this.tip.hidden = true))
        this.listen(grip, target, f, i, x, grip, null, layer)
      }
    }
  }

  /** スマホ：書いているセルの列をうすく色付けし、その列の両側の内側の線に、丸いつまみ */
  private placePhone(target: ColumnTarget, fragments: Fragment[], layer: DOMRect): void {
    if (!target.cellId) return
    // 書いているセルのある部分（ページをまたぐ表では、そのページの部分。見出しの行はページごとに出る）
    const own = fragments.find((f) => f.table.querySelector(`[data-cell-id="${CSS.escape(target.cellId!)}"]`)) ?? null
    const cell = own?.table.querySelector<HTMLElement>(`[data-cell-id="${CSS.escape(target.cellId)}"]`)
    if (!own || !cell) return
    const column = [...(cell.parentElement?.children ?? [])].indexOf(cell)
    if (column < 0 || column >= own.cells.length) return
    for (const f of fragments) {
      const c = f.cells[column]?.getBoundingClientRect()
      if (!c) continue
      const tint = this.el('col-tint')
      Object.assign(tint.style, { left: `${c.left - layer.left}px`, top: `${f.rect.top - layer.top}px`, width: `${c.width}px`, height: `${f.rect.height}px` })
    }
    const borders = [column - 1, column].filter((b) => b >= 0 && b < own.cells.length - 1)
    for (const b of borders) {
      const x = own.cells[b].getBoundingClientRect().right - layer.left
      const line = this.el('col-line')
      Object.assign(line.style, { left: `${x}px`, top: `${own.rect.top - layer.top}px`, height: `${own.rect.height}px` })
      const knob = this.el('col-pknob')
      knob.dataset.border = String(b)
      knob.innerHTML = `<span>${ARROWS}</span>`
      Object.assign(knob.style, { left: `${x}px`, top: `${own.head.top + own.head.height / 2 - layer.top}px` })
      this.listen(knob, target, own, b, x, line, knob, layer)
    }
  }

  /** つまみ・線をつかんで動かす（パソコンはマウス、スマホは指1本） */
  private listen(handle: HTMLElement, target: ColumnTarget, f: Fragment, border: number, x: number, line: HTMLElement, knob: HTMLElement | null, layer: DOMRect): void {
    // 指の知らせを、紙面の台（ページ送り・2本の指の拡大）へ渡さない。書いている欄からフォーカスを外さない（キーボードを閉じない）
    const stop = (e: Event) => {
      e.stopPropagation()
      if (e.cancelable) e.preventDefault()
    }
    for (const type of ['touchstart', 'touchmove', 'touchend', 'mousedown', 'click']) handle.addEventListener(type, stop, { passive: false })
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.drag) return
      stop(e)
      handle.setPointerCapture(e.pointerId)
      const width = f.cells.reduce((sum, c) => sum + c.getBoundingClientRect().width, 0)
      const ghost = this.el('col-ghost')
      Object.assign(ghost.style, { left: `${x}px`, top: `${f.rect.top - layer.top}px`, height: `${f.rect.height}px` })
      const label = this.el('col-drag')
      const labelTop = f.rect.top - layer.top - 6
      this.tip.hidden = true
      this.root.classList.add('dragging')
      handle.classList.add('hot')
      this.drag = { pointerId: e.pointerId, tableId: target.tableId, border, startX: e.clientX, width, start: target.widths, next: target.widths, baseX: x, line, knob, ghost, label, labelTop }
      this.show()
    })
    handle.addEventListener('pointermove', (e) => {
      const d = this.drag
      if (!d || d.pointerId !== e.pointerId) return
      stop(e)
      d.next = moveColumnBorder(d.start, d.border, ((e.clientX - d.startX) / d.width) * 100)
      this.show()
    })
    const end = (e: PointerEvent, commit: boolean) => {
      const d = this.drag
      if (!d || d.pointerId !== e.pointerId) return
      stop(e)
      this.drag = null
      this.root.classList.remove('dragging')
      handle.classList.remove('hot')
      d.ghost.remove()
      d.label.remove()
      const changed = d.next.some((w, i) => w !== d.start[i])
      if (commit && changed) {
        this.pending = { tableId: d.tableId, widths: d.next, until: performance.now() + 3000 }
        this.host.onCommit(d.tableId, d.next)
      } else {
        // 動かさなかった：線を元の位置に戻す
        d.line.style.left = `${d.baseX}px`
        if (d.knob && d.knob !== d.line) d.knob.style.left = `${d.baseX}px`
      }
    }
    handle.addEventListener('pointerup', (e) => end(e, true))
    handle.addEventListener('pointercancel', (e) => end(e, false))
  }

  /** 動かしている線・つまみと、「20%｜30%」の札を、いまの幅の所に出す */
  private show(): void {
    const d = this.drag
    if (!d) return
    const x = d.baseX + ((d.next[d.border] - d.start[d.border]) / 100) * d.width
    d.line.style.left = `${x}px`
    if (d.knob && d.knob !== d.line) d.knob.style.left = `${x}px`
    d.label.innerHTML = `<span>${pct(d.next[d.border])}</span><i>｜</i><span>${pct(d.next[d.border + 1])}</span>`
    Object.assign(d.label.style, { left: `${x}px`, top: `${d.labelTop}px` })
  }
}
