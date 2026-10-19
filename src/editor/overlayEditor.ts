/**
 * 紙面の上に重ねて開く入力欄（案A「紙面に直接書く型」）。
 * 組版された紙面は表示専用のため、編集中の箇所だけ、同じ書体・字間・行送りの入力欄を同じ位置に重ねる。
 * 打つ手を止めると紙面全体が組み直される。
 *
 * 画面の狭いスマホでは、紙面に重ねると文字が小さすぎるため、画面の下から出る欄（sheet）の中で大きな文字で書く。
 *
 * - paragraph：段落。Enter で分ける、先頭の Backspace で前とつなげる、複数行の貼り付けは段落に分ける
 * - line：見出し・図のタイトル・表紙の項目。Enter で確定
 * - cell：表のセル。Enter で確定、Shift+Enter で改行
 */

export type OverlayKind = 'paragraph' | 'line' | 'cell'

export interface OverlayCallbacks {
  /** 文字が変わった（日本語の変換中は呼ばない） */
  onInput(blockId: string, text: string): void
  /**
   * 編集を終えた（byKey：Enter・Esc で閉じたとき true。ほかの場所をクリックして閉じたときは false）。
   * frozen：閉じる前の入力欄の見た目を写した、動かない要素（紙面に重ねていたときだけ。使わなければ捨ててよい）
   */
  onCommit(blockId: string, text: string, byKey: boolean, frozen: HTMLElement | null): void
  /** Enter で段落を分けた（見出しの Enter は、後ろに段落を作る） */
  onSplit(blockId: string, before: string, after: string): void
  /** 段落の先頭で Backspace を押した（前の段落とつなげる） */
  onMergeBackward(blockId: string, text: string): void
  /** 1行目で↑、最終行で↓を押した */
  onNavigate(blockId: string, text: string, direction: 'prev' | 'next'): void
  /** 複数行を貼り付けた（行ごとに段落にする） */
  onPasteParagraphs(blockId: string, paragraphs: string[], caretInLast: number): void
  /**
   * 貼り付けたものを、そのままの形では入れなかった（画面の下に短く知らせる）。
   * firstLine：1行の欄（表紙の項目・見出しなど）に複数行を貼り付けたので、1行目だけを入れた／table：表を貼り付けたので、文にした
   */
  onPasteNote?(what: 'firstLine' | 'table'): void
  /** 表のセルで Tab（Shift+Tab）を押した（隣のセルへ移る） */
  onTab?(blockId: string, text: string, backward: boolean): void
  /** 紙面に重ねた入力欄の大きさが変わった（行が増えた・減った。日本語の変換中も呼ぶ） */
  onResize?(): void
}

/** 紙面上の位置と大きさ（画面座標）。紙面は縮小・拡大して表示しているため、倍率も渡す */
export interface OverlayPlacement {
  /** 入力欄を合わせる、いま見えているページ上の要素の位置 */
  rect: { left: number; top: number; right: number }
  /** いま見えているページの範囲（入力欄はこの外を隠す） */
  clip: { left: number; top: number; right: number; bottom: number }
  scale: number
  /** 段落がページをまたぐとき、見えているページより前にある文字数（その文字が rect の上端に来るようにずらす） */
  alignOffset: number
}

export interface OverlayTarget extends OverlayPlacement {
  blockId: string
  kind: OverlayKind
  text: string
  caret: number
  /** 書体・字間・行送りを写し取る紙面上の要素 */
  styleSource: HTMLElement
  /** 見出しで Enter を押したときに後ろへ段落を作るか */
  enterCreatesParagraph?: boolean
}

const COPIED_STYLES = ['fontFamily', 'fontSize', 'lineHeight', 'letterSpacing', 'textIndent', 'textAlign', 'fontWeight'] as const

/**
 * キーボードで書く欄からここへ移っても、書き終わりにしない（道具の「図を入れる」などを、書いていた位置で使えるように）。
 * .table-size：スマホの書く欄の「表を入れる」で出る、表の大きさを選ぶ欄（app/TableSize.tsx。選んでいる間も、書いていた位置を覚えておく）
 */
const KEEP_OPEN = '.palette, .es-tools, .table-size'

/** 段落を分けた直後に、前の段落を仮に表示する要素（ghost）の見た目（入力欄と同じ書体・位置で、押せない） */
const GHOST_STYLE: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  pointerEvents: 'none',
  transformOrigin: '0 0',
  background: '#fff',
  color: '#000',
  whiteSpace: 'pre-wrap',
  lineBreak: 'strict',
}

export class OverlayEditor {
  readonly element: HTMLDivElement
  private readonly layer: HTMLElement
  private readonly clip: HTMLDivElement
  private readonly scroller: HTMLElement
  private readonly callbacks: OverlayCallbacks
  private target: OverlayTarget | null = null
  private composingNow = false
  /** Enter・Esc で閉じようとしている */
  private closingByKey = false
  private scale = 1
  /** 見えているページの範囲（スクロールする前の座標） */
  private clipBox = { top: 0, left: 0, width: 0, height: 0 }
  /** ページの範囲の中での、入力欄の位置 */
  private offset = { top: 0, left: 0 }
  /**
   * 段落を分けた直後、紙面を組み直すまで、前の段落を仮に表示する要素（上から順に）。
   * Enter を続けて押したときも、まだ紙面に出ていない段落をすべて並べて見せる（前は直前の1つだけで、その前に分けた段落が消えて見えていた）
   */
  private ghosts: HTMLDivElement[] = []
  /**
   * スマホ：紙面の上で、書いている欄があるはずの位置と見た目（見えない。下の欄で書いている文字を写す）。
   * 段落を分けた前の段落の仮の表示（ghosts）と、書き終えた欄の仮の表示（freeze）を、紙面の上の正しい位置に出すために使う。PC は入力欄そのもの
   */
  private readonly mirror: HTMLDivElement
  /** 紙面の上の位置が決まっているか（まだ紙面にない欄を、下の欄で開いたときは決まっていない：仮の表示を出さない） */
  private placed = false
  /** キーボードで道具へ移っているあいだ、書いていたカーソルの位置（書く欄に戻ったら、そこから続ける） */
  private parkedCaret: number | null = null
  private unwatchParked: (() => void) | null = null

  /**
   * @param layer 入力欄を置く層（紙面の表示領域に重ねる）
   * @param scroller 紙面をスクロールする要素（拡大して表示しているとき）
   */
  constructor(layer: HTMLElement, scroller: HTMLElement, callbacks: OverlayCallbacks) {
    this.layer = layer
    this.scroller = scroller
    this.callbacks = callbacks
    this.clip = document.createElement('div')
    this.clip.className = 'overlay-clip'
    this.clip.hidden = true
    this.element = document.createElement('div')
    this.element.className = 'overlay-editor'
    this.element.contentEditable = 'plaintext-only'
    // 読み上げソフトにも、書く欄だと分かるようにする
    this.element.setAttribute('role', 'textbox')
    this.element.setAttribute('aria-multiline', 'true')
    this.element.setAttribute('aria-label', '書く欄')
    this.element.spellcheck = false
    this.mirror = document.createElement('div')
    this.mirror.className = 'overlay-mirror'
    this.mirror.setAttribute('aria-hidden', 'true')
    this.clip.append(this.element, this.mirror)
    layer.append(this.clip)

    this.element.addEventListener('compositionstart', () => (this.composingNow = true))
    this.element.addEventListener('compositionend', () => {
      this.composingNow = false
      this.emitInput()
    })
    this.element.addEventListener('input', () => {
      if (!this.composingNow) this.emitInput()
    })
    this.element.addEventListener('keydown', (e) => this.onKeyDown(e))
    this.element.addEventListener('paste', (e) => this.onPaste(e))
    this.element.addEventListener('blur', (e) => {
      const next = e.relatedTarget instanceof Element ? e.relatedTarget : null
      if (this.target && next?.closest(KEEP_OPEN)) this.park()
      else this.commit()
    })
    this.element.addEventListener('focus', () => {
      if (this.parkedCaret === null) return
      const caret = this.parkedCaret
      this.unpark()
      this.setCaret(caret)
    })
    scroller.addEventListener('scroll', () => this.place())
    // 入力欄を囲む枠（はみ出しを隠す）と、重ねる層は、動かさない。カーソルがページの下からはみ出すと、ブラウザがカーソルを見せようとして
    // 枠の中を上へずらし、入力欄が前の段落の終わりの行に重なって隠していた（打つほど多く隠れた）。カーソルが次のページへ移ったら、
    // 紙面を組み直して、次のページへ移る（reportEditor の followCaret）
    for (const box of [this.clip, layer]) {
      box.addEventListener('scroll', () => {
        if (box.scrollTop !== 0) box.scrollTop = 0
        if (box.scrollLeft !== 0) box.scrollLeft = 0
      })
    }
    new ResizeObserver(() => {
      if (this.target && !this.sheetHost) this.callbacks.onResize?.()
    }).observe(this.element)
  }

  /** 紙面の上の、書いている欄の下端（画面座標。スマホは、見えない写し） */
  get bottom(): number {
    return this.box.getBoundingClientRect().bottom
  }

  /** 前の段落の仮の表示（ghosts）の数と、いちばん下の仮の表示の下端（画面座標。なければ null） */
  get ghostCount(): number {
    return this.ghosts.length
  }

  get ghostsBottom(): number | null {
    return this.ghosts.at(-1)?.getBoundingClientRect().bottom ?? null
  }

  /** 紙面の上で位置と見た目を合わせる要素（PC は入力欄、スマホは見えない写し） */
  private get box(): HTMLDivElement {
    return this.sheetHost ? this.mirror : this.element
  }

  /**
   * 書く場所を切り替える。host を渡すと、その中で（大きな文字で）書く。null なら紙面に重ねる
   */
  setSheetHost(host: HTMLElement | null): void {
    if (this.target) this.commit()
    this.clearGhosts()
    this.sheetHost = host
    const el = this.element
    el.classList.toggle('in-sheet', !!host)
    if (host) {
      for (const key of [...COPIED_STYLES, 'transform', 'width', 'top', 'left'] as const) el.style[key] = ''
      host.append(el)
    } else {
      this.clip.append(el)
    }
  }

  private sheetHost: HTMLElement | null = null

  get inSheet(): boolean {
    return this.sheetHost !== null
  }

  get blockId(): string | null {
    return this.target?.blockId ?? null
  }

  get kind(): OverlayKind | null {
    return this.target?.kind ?? null
  }

  /** 日本語の変換中か */
  get composing(): boolean {
    return this.composingNow
  }

  get text(): string {
    const raw = this.element.innerText ?? ''
    return this.target?.kind === 'cell' ? raw.replace(/\n$/, '') : raw.replace(/\n/g, '')
  }

  get caret(): number {
    if (this.parkedCaret !== null && document.activeElement !== this.element) return this.parkedCaret
    return this.caretInElement()
  }

  private caretInElement(): number {
    const sel = getSelection()
    if (!sel || !sel.rangeCount || !this.element.contains(sel.anchorNode)) return this.text.length
    const range = sel.getRangeAt(0).cloneRange()
    range.selectNodeContents(this.element)
    range.setEnd(sel.anchorNode!, sel.anchorOffset)
    return range.toString().length
  }

  open(target: OverlayTarget): void {
    this.unpark()
    this.clearGhosts()
    this.target = target
    this.element.dataset.kind = target.kind
    this.element.textContent = target.text
    this.mirror.textContent = this.sheetHost ? target.text : ''
    // 下の欄で書く（スマホ）：書体などは画面用（CSS）のまま。スマホでキーボードを出すには、タップの処理の中で欄を見せて入力欄に移る必要がある。
    // 紙面の上の位置と見た目は、見えない写しに合わせておく（仮の表示に使う）
    if (this.sheetHost) this.sheetHost.closest('.edit-sheet')?.classList.add('open')
    this.copyStyle(target.styleSource, target.kind)
    this.clip.hidden = false
    this.moveTo(target)
    this.element.focus({ preventScroll: true })
    this.setCaret(target.caret)
  }

  /**
   * 入力欄を開いたまま、書く先を別のブロックへ移す（段落を分けた・つなげた・↑↓で移った・表のセルで Tab を押したとき）。
   * 紙面を組み直してから開き直すと、長い原稿では数秒かかり、その間に打った文字が消えていたため。
   * 組み直したら、呼び出し側が settle と moveTo で正しい位置・書体に合わせる。
   * ghost：分けた前の段落の文字。組み直すまで入力欄のあった位置に仮に表示し、入力欄はそのすぐ下へずらす
   */
  continueIn(next: { blockId: string; kind: OverlayKind; text: string; caret: number; styleSource?: HTMLElement }, ghost?: string): void {
    if (!this.target) return
    this.unpark()
    // 前の段落の仮の表示を、それまでの仮の表示の下（書いていた欄の位置）に足す。それまでの仮の表示は残す（組み直した紙面が出るまで）
    if (ghost !== undefined && this.placed) {
      const g = document.createElement('div')
      g.className = 'overlay-ghost'
      g.setAttribute('aria-hidden', 'true')
      g.style.cssText = this.box.style.cssText
      Object.assign(g.style, GHOST_STYLE)
      g.textContent = ghost
      this.clip.insertBefore(g, this.element.parentElement === this.clip ? this.element : this.mirror)
      this.ghosts.push(g)
      this.offset = { ...this.offset, top: this.offset.top + g.offsetHeight * this.scale }
    }
    const kindChanged = next.kind !== this.target.kind
    this.target = { ...this.target, blockId: next.blockId, kind: next.kind, text: next.text, caret: next.caret, enterCreatesParagraph: false }
    this.element.dataset.kind = next.kind
    if (next.styleSource) {
      this.copyStyle(next.styleSource, next.kind)
      // 見出しの後ろに段落を作ったとき：段落の左端と幅に合わせる
      if (kindChanged) {
        const r = next.styleSource.getBoundingClientRect()
        const clip = this.clip.getBoundingClientRect()
        this.offset = { ...this.offset, left: r.left - clip.left }
        this.box.style.width = `${Math.max(40, r.width / this.scale)}px`
      }
    }
    this.element.textContent = next.text
    if (this.sheetHost) this.mirror.textContent = next.text
    this.place()
    this.element.focus({ preventScroll: true })
    this.setCaret(next.caret)
  }

  /** 組み直した紙面の書体に合わせ、仮に表示していた前の段落を消す（continueIn のあと） */
  settle(styleSource: HTMLElement | undefined): void {
    this.clearGhosts()
    if (this.target && styleSource) this.copyStyle(styleSource, this.target.kind)
  }

  /**
   * 前の段落の仮の表示を、紙面の上の anchor（仮の表示のいちばん上の段落の、紙面での位置）から並べ直し、書いている欄をその下に置く。
   * 組み直す前に、紙面の倍率・位置が変わったとき（画面の大きさを変えた・スマホで拡大をやめたなど）に使う
   */
  restack(anchor: OverlayPlacement): void {
    if (this.ghosts.length === 0) return this.moveTo(anchor)
    this.setFrame(anchor)
    const { rect, clip, scale, alignOffset } = anchor
    const width = `${Math.max(40, (rect.right - rect.left) / scale)}px`
    let top = rect.top - clip.top - this.alignShift(this.ghosts[0], alignOffset, scale)
    const left = rect.left - clip.left
    for (const g of this.ghosts) {
      Object.assign(g.style, { transform: `scale(${scale})`, width, top: `${top}px`, left: `${left}px` })
      top += g.offsetHeight * scale
    }
    this.box.style.transform = `scale(${scale})`
    this.box.style.width = width
    this.offset = { top, left }
    this.place()
  }

  private copyStyle(source: HTMLElement, kind: OverlayKind): void {
    const computed = getComputedStyle(source)
    for (const key of COPIED_STYLES) this.box.style[key] = computed[key]
    if (kind !== 'paragraph') this.box.style.textIndent = '0'
  }

  private clearGhosts(): void {
    for (const g of this.ghosts) g.remove()
    this.ghosts = []
  }

  /** いちばん下の仮の表示を外し、書いている欄をその位置に戻す（Enter のすぐ後に Backspace で、前の段落とつなぎ直したとき） */
  popGhost(): void {
    const g = this.ghosts.pop()
    if (!g) return
    this.offset = { top: parseFloat(g.style.top) || 0, left: parseFloat(g.style.left) || 0 }
    g.remove()
    this.place()
  }

  /**
   * キーボード（Tab）で道具へ移った：書き終わりにせず、カーソルの位置を覚えておく。
   * 道具でも書く欄でもない所へ移ったら、書き終わりにする
   */
  private park(): void {
    this.parkedCaret = this.caretInElement()
    this.unwatchParked?.()
    const onFocusIn = (e: FocusEvent) => {
      const el = e.target instanceof Element ? e.target : null
      if (el === this.element || el?.closest(KEEP_OPEN)) return
      this.commit()
    }
    const onFocusOut = (e: FocusEvent) => {
      // フォーカスを受け取らない所（紙面の余白など）を押して、道具からフォーカスが外れた
      if (e.relatedTarget === null && e.target instanceof Element && e.target.closest(KEEP_OPEN)) {
        setTimeout(() => {
          if (document.activeElement === document.body) this.commit()
        })
      }
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    this.unwatchParked = () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }

  private unpark(): void {
    this.parkedCaret = null
    this.unwatchParked?.()
    this.unwatchParked = null
  }

  /**
   * 紙面が組み直された・ページを送った・倍率が変わったときに、入力欄を合わせて動かす。
   * 入力欄は紙面と同じ寸法で組み、紙面と同じ倍率で縮小して重ねる。
   */
  moveTo(placement: OverlayPlacement): void {
    const { rect, clip, scale, alignOffset } = placement
    this.setFrame(placement)
    this.box.style.transform = `scale(${scale})`
    this.box.style.width = `${Math.max(40, (rect.right - rect.left) / scale)}px`
    // ページをまたぐ段落：見えているページの最初の文字が、そのページの段落の上端に来るようにずらす
    this.offset = { top: rect.top - clip.top - this.alignShift(this.box, alignOffset, scale), left: rect.left - clip.left }
    this.place()
  }

  /** 見えているページの範囲と倍率を合わせる（moveTo・restack） */
  private setFrame({ rect, clip, scale }: OverlayPlacement): void {
    this.scale = scale
    this.placed = rect.right - rect.left > 1
    const layerRect = this.layer.getBoundingClientRect()
    this.clipBox = {
      top: clip.top - layerRect.top + this.scroller.scrollTop,
      left: clip.left - layerRect.left + this.scroller.scrollLeft,
      width: clip.right - clip.left,
      height: clip.bottom - clip.top,
    }
  }

  /** ページをまたぐ段落で、見えているページより前にある文字（alignOffset 字）の分だけ、上へずらす高さ（画面の px） */
  private alignShift(el: HTMLElement, alignOffset: number, scale: number): number {
    const node = el.firstChild
    if (alignOffset <= 0 || !(node instanceof Text)) return 0
    const at = (i: number) => {
      const range = document.createRange()
      range.setStart(node, Math.min(i, node.length))
      range.setEnd(node, Math.min(i + 1, node.length))
      return range.getClientRects()[0]
    }
    const first = at(0)
    const here = at(alignOffset)
    // 要素の transform（倍率）が、まだ合っていない（倍率を変えた直後）こともあるので、要素の倍率で割って、新しい倍率を掛ける
    const own = el.getBoundingClientRect().width / (el.offsetWidth || 1)
    return first && here ? ((here.top - first.top) / (own || 1)) * scale : 0
  }

  /** 編集を終えて閉じる（blur でも呼ばれる） */
  commit(): void {
    if (!this.target) return
    const { blockId } = this.target
    const text = this.text
    const byKey = this.closingByKey
    this.closingByKey = false
    const frozen = this.freeze()
    this.close()
    this.callbacks.onCommit(blockId, text, byKey, frozen)
  }

  /**
   * 紙面に重ねた入力欄の、いまの見た目を写した動かない要素（同じ位置・書体・文字。押せない・読み上げない）。
   * 書き終えたあと、組み直した紙面が出るまで、前の文字ではなく書いた文字を見せるために使う（reportEditor の freezeEdited）。
   * 段落を分けた直後の、前の段落の仮の表示（ghosts）も一緒に写す。スマホは、紙面の上の見えない写しを写す。
   * 紙面の上の位置が決まっていない（まだ紙面にない欄を下の欄で開いた）・何も書いていないときは null
   */
  private freeze(): HTMLElement | null {
    const text = this.text
    if (!this.target || !this.placed || this.clip.hidden || (!text.trim() && this.ghosts.length === 0)) return null
    const clip = document.createElement('div')
    clip.className = 'overlay-clip overlay-frozen'
    clip.style.cssText = this.clip.style.cssText
    clip.setAttribute('aria-hidden', 'true')
    const copy = (from: HTMLElement, text: string) => {
      const el = document.createElement('div')
      el.style.cssText = from.style.cssText
      Object.assign(el.style, GHOST_STYLE)
      el.textContent = text
      clip.append(el)
    }
    for (const g of this.ghosts) copy(g, g.textContent ?? '')
    // 書いていた欄（何も書いていない段落は写さない。分けた前の段落の仮の表示だけを残す）
    if (text.trim()) copy(this.box, text)
    return clip
  }

  /** 確定せずに閉じる（呼び出し側がデータを処理済みのとき） */
  private close(): void {
    this.target = null
    this.unpark()
    this.clearGhosts()
    this.placed = false
    this.mirror.textContent = ''
    this.clip.hidden = true
    this.sheetHost?.closest('.edit-sheet')?.classList.remove('open')
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
    // 枠の中は動かさない（ブラウザがカーソルを見せようとしてずらしていたら、戻す）
    if (this.clip.scrollTop !== 0) this.clip.scrollTop = 0
    const c = this.clip.style
    c.top = `${this.clipBox.top - this.scroller.scrollTop}px`
    c.left = `${this.clipBox.left - this.scroller.scrollLeft}px`
    c.width = `${this.clipBox.width}px`
    c.height = `${this.clipBox.height}px`
    this.box.style.top = `${this.offset.top}px`
    this.box.style.left = `${this.offset.left}px`
  }

  /**
   * PC：書いているカーソルの位置（画面座標）。ブラウザがカーソルを見せようとして枠の中をずらしていても（ずらしを戻す前でも）、ずらす前の位置。
   * カーソルがページの本文の下へはみ出したら、打つ手が止まるのを待たずに組み直して、次のページへ移るために使う（reportEditor の caretBelowContent）
   */
  caretRect(): { top: number; bottom: number } | null {
    if (!this.target || this.sheetHost || this.clip.hidden) return null
    const sel = getSelection()
    if (!sel?.rangeCount || !this.element.contains(sel.anchorNode)) return null
    const r = sel.getRangeAt(0).getClientRects()[0]
    return r ? { top: r.top + this.clip.scrollTop, bottom: r.bottom + this.clip.scrollTop } : null
  }

  private emitInput(): void {
    if (!this.target) return
    // スマホ：紙面の上の見えない写しにも、書いている文字を入れておく（仮の表示に使う）
    if (this.sheetHost) this.mirror.textContent = this.text
    this.callbacks.onInput(this.target.blockId, this.text)
  }

  private onKeyDown(e: KeyboardEvent): void {
    // 日本語の変換中の Enter は、変換の確定として扱う
    if (!this.target || e.isComposing || this.composingNow || e.keyCode === 229) return
    const { blockId, kind } = this.target
    const caret = this.caret
    const text = this.text
    const collapsed = getSelection()?.isCollapsed ?? true

    if (e.key === 'Escape') {
      e.preventDefault()
      this.closingByKey = true
      this.element.blur()
    } else if (e.key === 'Enter' && kind === 'cell' && e.shiftKey) {
      // 表のセルの中の改行は、そのまま入れる
    } else if (e.key === 'Enter' && (kind === 'paragraph' || this.target.enterCreatesParagraph)) {
      e.preventDefault()
      this.handOff(() => this.callbacks.onSplit(blockId, text.slice(0, caret), text.slice(caret)))
    } else if (e.key === 'Tab' && kind === 'cell' && this.callbacks.onTab) {
      e.preventDefault()
      const onTab = this.callbacks.onTab
      this.handOff(() => onTab(blockId, text, e.shiftKey))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      this.closingByKey = true
      this.element.blur()
    } else if (e.key === 'Backspace' && kind === 'paragraph' && caret === 0 && collapsed) {
      e.preventDefault()
      this.handOff(() => this.callbacks.onMergeBackward(blockId, text))
    } else if (kind !== 'cell' && ((e.key === 'ArrowUp' && this.caretOnEdgeLine('first')) || (e.key === 'ArrowDown' && this.caretOnEdgeLine('last')))) {
      e.preventDefault()
      const direction = e.key === 'ArrowUp' ? 'prev' : 'next'
      this.handOff(() => this.callbacks.onNavigate(blockId, text, direction))
    }
  }

  /**
   * 段落を分けた・つなげたなどを呼び出し側に任せる。呼び出し側が書く先を移した（continueIn・open）ら開いたまま、
   * 移さなかった（組み直してから開き直す）ら、書いた内容は呼び出し側が受け取り済みなので、確定せずに閉じる
   */
  private handOff(fn: () => void): void {
    const before = this.target
    fn()
    if (this.target === before) this.close()
  }

  private caretOnEdgeLine(edge: 'first' | 'last'): boolean {
    const sel = getSelection()
    if (!sel?.rangeCount) return true
    const caretRect = sel.getRangeAt(0).getClientRects()[0]
    const box = this.element.getBoundingClientRect()
    if (!caretRect) return true
    const lineHeight = (parseFloat(getComputedStyle(this.element).lineHeight) || 20) * (this.sheetHost ? 1 : this.scale)
    return edge === 'first' ? caretRect.top - box.top < lineHeight * 0.8 : box.bottom - caretRect.bottom < lineHeight * 0.8
  }

  private onPaste(e: ClipboardEvent): void {
    const pasted = e.clipboardData?.getData('text/plain') ?? ''
    if (!this.target) return
    // 1行の欄（表紙の項目・見出し・図表のタイトル）に、複数行を貼り付けた：1行目（空でない最初の行）だけを入れる。
    // 前は、氏名の欄に「文化 花子」と「学籍番号 00ZZ0123」の2行を貼り付けると、1行につながって入り、表紙の枠からはみ出していた
    if (this.target.kind === 'line' && /[\r\n]/.test(pasted)) {
      e.preventDefault()
      const lines = pasted.split(/\r?\n|\r/).map((l) => l.trim()).filter((l) => l !== '')
      if (lines.length === 0) return
      document.execCommand('insertText', false, lines[0])
      if (lines.length > 1) this.callbacks.onPasteNote?.('firstLine')
      return
    }
    // Word などの表を貼り付けた：表は「表を入れる」で作るので、文になったことを知らせる（文は、そのまま入れる）
    const table = this.target.kind === 'paragraph' && /<table[\s>]/i.test(e.clipboardData?.getData('text/html') ?? '')
    if (table) queueMicrotask(() => this.callbacks.onPasteNote?.('table'))
    if (this.target.kind !== 'paragraph' || !/\n/.test(pasted)) return
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
    this.handOff(() => this.callbacks.onPasteParagraphs(blockId, paragraphs, caretInLast))
  }
}
