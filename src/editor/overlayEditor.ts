/**
 * 紙面の上に重ねて開く入力欄（案A「紙面に直接書く型」）。
 * 組版された紙面は表示専用のため、編集中の箇所だけ、同じ書体・字間・行送りの入力欄を同じ位置に重ねる。
 * 打つ手を止めると紙面全体が組み直される。
 *
 * - paragraph：段落。Enter で分ける、先頭の Backspace で前とつなげる、複数行の貼り付けは段落に分ける
 * - line：見出し・図のタイトル・表紙の項目。Enter で確定
 * - cell：表のセル。Enter で確定、Shift+Enter で改行
 */

export type OverlayKind = 'paragraph' | 'line' | 'cell'

export interface OverlayCallbacks {
  /** 文字が変わった（日本語の変換中は呼ばない） */
  onInput(blockId: string, text: string): void
  /** 編集を終えた */
  onCommit(blockId: string, text: string): void
  /** Enter で段落を分けた（見出しの Enter は、後ろに段落を作る） */
  onSplit(blockId: string, before: string, after: string): void
  /** 段落の先頭で Backspace を押した（前の段落とつなげる） */
  onMergeBackward(blockId: string, text: string): void
  /** 1行目で↑、最終行で↓を押した */
  onNavigate(blockId: string, text: string, direction: 'prev' | 'next'): void
  /** 複数行を貼り付けた（行ごとに段落にする） */
  onPasteParagraphs(blockId: string, paragraphs: string[], caretInLast: number): void
}

export interface OverlayTarget {
  blockId: string
  kind: OverlayKind
  text: string
  caret: number
  /** 紙面上の表示位置（画面座標） */
  rect: { left: number; top: number; right: number }
  /** 書体・字間・行送りを写し取る紙面上の要素 */
  styleSource: HTMLElement
  /** 見出しで Enter を押したときに後ろへ段落を作るか */
  enterCreatesParagraph?: boolean
}

const COPIED_STYLES = ['fontFamily', 'fontSize', 'lineHeight', 'letterSpacing', 'textIndent', 'textAlign', 'fontWeight'] as const

export class OverlayEditor {
  readonly element: HTMLDivElement
  private readonly layer: HTMLElement
  private readonly getScroller: () => HTMLElement
  private readonly callbacks: OverlayCallbacks
  private target: OverlayTarget | null = null
  private composing = false
  private contentTop = 0
  private contentLeft = 0

  /**
   * @param layer 入力欄を置く層（紙面の表示領域に重ねる）
   * @param scroll 紙面の表示枠の入れ物（スクロールを受け取る）と、いまスクロールしている表示枠
   */
  constructor(layer: HTMLElement, scroll: { container: HTMLElement; current: () => HTMLElement }, callbacks: OverlayCallbacks) {
    this.layer = layer
    this.getScroller = scroll.current
    this.callbacks = callbacks
    this.element = document.createElement('div')
    this.element.className = 'overlay-editor'
    this.element.contentEditable = 'plaintext-only'
    this.element.spellcheck = false
    this.element.hidden = true
    layer.append(this.element)

    this.element.addEventListener('compositionstart', () => (this.composing = true))
    this.element.addEventListener('compositionend', () => {
      this.composing = false
      this.emitInput()
    })
    this.element.addEventListener('input', () => {
      if (!this.composing) this.emitInput()
    })
    this.element.addEventListener('keydown', (e) => this.onKeyDown(e))
    this.element.addEventListener('paste', (e) => this.onPaste(e))
    this.element.addEventListener('blur', () => this.commit())
    // scroll は伝わらないため、入れ物で捕まえる（表示枠は組み直すたびに入れ替わる）
    scroll.container.addEventListener('scroll', () => this.place(), true)
  }

  get blockId(): string | null {
    return this.target?.blockId ?? null
  }

  get kind(): OverlayKind | null {
    return this.target?.kind ?? null
  }

  get text(): string {
    const raw = this.element.innerText ?? ''
    return this.target?.kind === 'cell' ? raw.replace(/\n$/, '') : raw.replace(/\n/g, '')
  }

  get caret(): number {
    const sel = getSelection()
    if (!sel || !sel.rangeCount || !this.element.contains(sel.anchorNode)) return this.text.length
    const range = sel.getRangeAt(0).cloneRange()
    range.selectNodeContents(this.element)
    range.setEnd(sel.anchorNode!, sel.anchorOffset)
    return range.toString().length
  }

  open(target: OverlayTarget): void {
    this.target = target
    this.element.dataset.kind = target.kind
    const computed = getComputedStyle(target.styleSource)
    for (const key of COPIED_STYLES) this.element.style[key] = computed[key]
    if (target.kind !== 'paragraph') this.element.style.textIndent = '0'
    this.element.textContent = target.text
    this.element.hidden = false
    this.moveTo(target.rect)
    this.element.focus({ preventScroll: true })
    this.setCaret(target.caret)
  }

  /** 紙面が組み直されてブロックの位置が変わったときに、入力欄を合わせて動かす */
  moveTo(rect: OverlayTarget['rect']): void {
    const layerRect = this.layer.getBoundingClientRect()
    this.contentTop = rect.top - layerRect.top + this.getScroller().scrollTop
    this.contentLeft = rect.left - layerRect.left + this.getScroller().scrollLeft
    this.element.style.width = `${Math.max(40, rect.right - rect.left)}px`
    this.place()
  }

  /** 編集を終えて閉じる（blur でも呼ばれる） */
  commit(): void {
    if (!this.target) return
    const { blockId } = this.target
    const text = this.text
    this.close()
    this.callbacks.onCommit(blockId, text)
  }

  /** 確定せずに閉じる（呼び出し側がデータを処理済みのとき） */
  private close(): void {
    this.target = null
    this.element.hidden = true
  }

  setCaret(offset: number): void {
    const node = this.element.firstChild ?? this.element
    const range = document.createRange()
    const max = node.textContent?.length ?? 0
    range.setStart(node, Math.min(offset, max))
    range.collapse(true)
    const sel = getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
  }

  /** カーソルの位置に文字を入れる（「図を参照」など）。元に戻す（Ctrl+Z）も効く */
  insertText(text: string): void {
    if (!this.target) return
    this.element.focus({ preventScroll: true })
    document.execCommand('insertText', false, text)
  }

  /** 入力欄の中の文字範囲（指摘の下線表示用） */
  range(start: number, end: number): Range | null {
    const node = this.element.firstChild
    if (!(node instanceof Text)) return null
    const range = document.createRange()
    range.setStart(node, Math.min(start, node.length))
    range.setEnd(node, Math.min(end, node.length))
    return range
  }

  private place(): void {
    this.element.style.top = `${this.contentTop - this.getScroller().scrollTop}px`
    this.element.style.left = `${this.contentLeft - this.getScroller().scrollLeft}px`
  }

  private emitInput(): void {
    if (this.target) this.callbacks.onInput(this.target.blockId, this.text)
  }

  private onKeyDown(e: KeyboardEvent): void {
    // 日本語の変換中の Enter は、変換の確定として扱う
    if (!this.target || e.isComposing || this.composing || e.keyCode === 229) return
    const { blockId, kind } = this.target
    const caret = this.caret
    const text = this.text
    const collapsed = getSelection()?.isCollapsed ?? true

    if (e.key === 'Escape') {
      e.preventDefault()
      this.element.blur()
    } else if (e.key === 'Enter' && kind === 'cell' && e.shiftKey) {
      // 表のセルの中の改行は、そのまま入れる
    } else if (e.key === 'Enter' && (kind === 'paragraph' || this.target.enterCreatesParagraph)) {
      e.preventDefault()
      this.close()
      this.callbacks.onSplit(blockId, text.slice(0, caret), text.slice(caret))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      this.element.blur()
    } else if (e.key === 'Backspace' && kind === 'paragraph' && caret === 0 && collapsed) {
      e.preventDefault()
      this.close()
      this.callbacks.onMergeBackward(blockId, text)
    } else if (kind !== 'cell' && ((e.key === 'ArrowUp' && this.caretOnEdgeLine('first')) || (e.key === 'ArrowDown' && this.caretOnEdgeLine('last')))) {
      e.preventDefault()
      this.close()
      this.callbacks.onNavigate(blockId, text, e.key === 'ArrowUp' ? 'prev' : 'next')
    }
  }

  private caretOnEdgeLine(edge: 'first' | 'last'): boolean {
    const sel = getSelection()
    if (!sel?.rangeCount) return true
    const caretRect = sel.getRangeAt(0).getClientRects()[0]
    const box = this.element.getBoundingClientRect()
    if (!caretRect) return true
    const lineHeight = parseFloat(getComputedStyle(this.element).lineHeight) || 20
    return edge === 'first' ? caretRect.top - box.top < lineHeight * 0.8 : box.bottom - caretRect.bottom < lineHeight * 0.8
  }

  private onPaste(e: ClipboardEvent): void {
    const pasted = e.clipboardData?.getData('text/plain') ?? ''
    if (!this.target || this.target.kind !== 'paragraph' || !/\n/.test(pasted)) return
    e.preventDefault()
    const { blockId } = this.target
    const text = this.text
    const caret = this.caret
    const lines = pasted.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '')
    if (lines.length === 0) return
    const paragraphs = [...lines]
    paragraphs[0] = text.slice(0, caret) + paragraphs[0]
    const caretInLast = paragraphs[paragraphs.length - 1].length
    paragraphs[paragraphs.length - 1] += text.slice(caret)
    this.close()
    this.callbacks.onPasteParagraphs(blockId, paragraphs, caretInLast)
  }
}
