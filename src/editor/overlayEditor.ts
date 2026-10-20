/**
 * 紙面の上に重ねて開く入力欄（案A「紙面に直接書く型」）。
 * 組版された紙面は表示専用のため、編集中の箇所だけ、同じ書体・字間・行送りの入力欄を同じ位置に重ねる。
 * 打つ手を止めると紙面全体が組み直される。
 *
 * 画面の狭いスマホでは、紙面に重ねると文字が小さすぎるため、画面の下から出る欄（sheet）の中で大きな文字で書く。
 *
 * - paragraph：段落。Enter で分ける、先頭の Backspace で前とつなげる、複数行の貼り付けは段落に分ける
 * - line：見出し・図のタイトル・表紙の項目。Enter で確定
 * - cell：表のセル。Enter（Shift+Enter も）で改行。書き終えるのは Esc・Tab（隣のセルへ）・ほかの所を押す・スマホの「完了」
 *
 * PC の段落は、紙面と同じ所で行を折り返すよう、紙面と同じ組み方で書く（組み方：textSpacing.ts。図表の参照「（図1）」は途中で折り返さない）。
 * このときは、書く欄の文字を自分で持ち（model）、打った・消した・貼り付けた・元に戻したなどの入力をすべて受け取って、
 * 書く欄の中身を組み直す（ブラウザに書き換えさせると、句読点を包んだ要素の中に文字が入って、詰めた字間で重なるため）。
 * 日本語の変換中だけはブラウザに任せ、変換を終えたら組み直す。書く欄の中の「元に戻す」「やり直す」も、ここで受け持つ
 *
 * スマホの段落は、下の欄で打った字を、紙面の段落の位置にも、打つたびにすぐ出す（紙面の上の写し mirror を見せ、紙面の段落を隠す。
 * 前は、打つ手を止めて紙面を組み直すまで、紙面が変わらなかった）。写しは PC の書く欄と同じく、紙面と同じ組み方・同じ倍率で組む。
 * スマホは測るのが遅い（長い段落で句読点を1つ測るのに、遅いスマホで 8ms ほど）ため、打つたびには測らない：打った・消した所の字だけを
 * 写しの中で入れ替える（できないときは、測らずに前の包み方のまま並べ直す）。打つ手が止まったら、見えない下書きの要素で、時間を分けて少しずつ測り直し、
 * 測り終えたら写しと入れ替える（mirrorJob。打つ手を止めているときに打っても、待たされない）。日本語の変換中の字も出す。
 * 組み直した紙面が書いた字に追いついたら、写しをやめて紙面の段落を見せる（reportEditor の syncLive）。
 * 写しと仮の表示を入れる枠は、紙面と一緒にスクロールするよう、紙面の表示枠の中に置く（PC は今までどおり、重ねる層）
 *
 * スマホで紙面に直接書く（スマホのふつう。app/phoneDirect.ts）：スマホでも、PC と同じく紙面に重ねた書く欄で書く（direct）。
 * 書く欄の枠は、紙面と一緒にスクロールするよう、紙面の表示枠の中に置く。Android の文字入力は、Enter・Backspace のキーの知らせを出さず、
 * 改行・消す入力だけを出すことがあるので、その入力でも段落を分ける・前の段落とつなげる
 */

import { planFromDom, reshapeSpacing, shiftPlan, typesetSpacing, typesetSteps, type SpacingPlan } from './textSpacing'

/** 句読点・括弧（書き換えたあとに測り直す所に、これがいくつあるかで、すぐ測るか、打つ手が止まってから測るかを決める） */
const PUNCTUATION = /[\p{Ps}\p{Pe}\p{Pf}\p{Pi}、。，．]/gu
/** これより少なければ、打つたびにすぐ測り直す（1つ測るのに、ふつうのパソコンで 1ms ほど） */
const QUICK_PUNCTUATION = 12
/** スマホの写しを、時間を分けて測り直すとき、1回に続けて測る時間（ms。これを超えたら、次の回に回して、打った字を先に受け取る） */
const MIRROR_SLICE_MS = 8
/** 測り直すのを待つ時間（打つ手が止まってから） */
const TYPESET_DELAY_MS = 250

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
  /** 1行目で Shift+↑、最終行で Shift+↓ を押した（anchor：選び始めた所。選ぶ範囲を、紙面の前・次の欄へ広げる。広げられなければ false） */
  onExtend?(blockId: string, text: string, anchor: number, direction: 'prev' | 'next'): boolean
  /** 複数行を貼り付けた（行ごとに段落にする） */
  onPasteParagraphs(blockId: string, paragraphs: string[], caretInLast: number): void
  /**
   * 紙面で選んでコピーしたまとまり（段落・図・表など）の貼り付け。matches：クリップボードの文字が、最後にコピーしたものと同じか。
   * paste：段落 blockId（書いている文字 text の start から end までを置き換える）に、まとまりのまま入れる
   */
  onPasteClip?: { matches(pasted: string): boolean; paste(blockId: string, text: string, start: number, end: number): void }
  /** 段落に貼り付ける、ふつうの文字を変える（抄録：図表の参照の括弧を除く。変えたら、呼び出し側が知らせる）。返した文字を入れる */
  pasteText?(blockId: string, pasted: string): string
  /**
   * 貼り付けたものを、そのままの形では入れなかった（画面の下に短く知らせる）。
   * firstLine：1行の欄（表紙の項目・見出しなど）に複数行を貼り付けたので、1行目だけを入れた／table：表を貼り付けたので、文にした
   */
  onPasteNote?(what: 'firstLine' | 'table'): void
  /** 表のセルで Tab（Shift+Tab）を押した（隣のセルへ移る） */
  onTab?(blockId: string, text: string, backward: boolean): void
  /** 紙面に重ねた入力欄の大きさが変わった（行が増えた・減った。日本語の変換中も呼ぶ。スマホは、紙面の上の写しを見せているとき） */
  onResize?(): void
  /** スマホ：紙面の上の写し（打った字をその場で見せる段落）を見せはじめた・やめた（見せている間は、紙面のその段落を隠す） */
  onLive?(on: boolean): void
  /** スマホ：紙面の上の写しを、打った字に合わせた（日本語の変換中も呼ぶ。書いている所が見えるよう、紙面を動かすため） */
  onLiveUpdate?(): void
  /**
   * 書く欄の中で、戻すもののない（開いてからまだ何も書いていない）ときに Ctrl+Z を押した。
   * 呼び出し側が、直前の原稿の変更を戻したら true（段落に「Ⅲ．まとめ」と打って Enter で見出しにした直後など）
   */
  onUndoEmpty?(): boolean
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
  /**
   * 図表のタイトルの番号（「図4.」「表2.」）。書く欄の前に、書けない字（::before）として出す。
   * 紙面では番号とタイトルを一緒に真ん中にそろえているので、書く欄も番号から始め、rect を真ん中にそろえる幅にする
   * （前は、書く欄が番号の後ろの空いた所から始まり、その中で真ん中にそろえていたため、「図4.」と「新しい図」が離れて見えた）
   */
  label?: string
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
  /**
   * 文字列の中の、図表への参照（「（図1）」など。紙面で途中で折り返さないもの）の位置 [始め, 終わり]。
   * 段落を紙面と同じ組み方で書くとき、参照を折り返さないまとまりにする（書いている途中も、打つたびに求め直す）
   */
  refs?: (text: string) => [number, number][]
  /** 紙面のその欄の要素（ページをまたぐと複数）。文字が同じなら、書く欄にその中身を写す（紙面と同じ組み方を、測らずに使う） */
  page?: HTMLElement[]
}

/** 書く欄の文字と、選んでいる範囲（元に戻すときに戻す） */
interface TextState {
  text: string
  start: number
  end: number
}

/** 文字列の位置 at の前（after が true なら後ろ）の、ひとまとまりの文字（絵文字の結合なども1つ）の位置 */
function graphemeEdge(text: string, at: number, after: boolean): number {
  const segments = [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(text)]
  if (after) {
    const next = segments.find((s) => s.index >= at)
    return next ? Math.min(text.length, next.index + next.segment.length) : at
  }
  const before = segments.filter((s) => s.index < at).at(-1)
  return before ? before.index : at
}

/** 2つの文字列の、前から同じ字の数 p と、（そのあとの）後ろから同じ字の数 q（書き換えた所を求める） */
function sameEnds(old: string, text: string): [number, number] {
  let p = 0
  while (p < old.length && p < text.length && old[p] === text[p]) p++
  let q = 0
  while (q < old.length - p && q < text.length - p && old[old.length - 1 - q] === text[text.length - 1 - q]) q++
  return [p, q]
}

/** 要素の中の i 文字目（0 から）の画面上の四角（包んだ要素の中の文字も数える）。なければ undefined */
function charRect(el: HTMLElement, i: number): DOMRect | undefined {
  // 1字目より前（カーソルが先頭にあるときの「前の字」）はない
  if (i < 0) return undefined
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let acc = 0
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (i < acc + node.length) {
      const range = document.createRange()
      range.setStart(node, i - acc)
      range.setEnd(node, i - acc + 1)
      return range.getClientRects()[0]
    }
    acc += node.length
  }
  return undefined
}

/** 紙面のその欄の要素（ページをまたぐと複数）の文字が、text と同じか（紙面が、書いた字に追いついているか） */
function pageShows(page: HTMLElement[] | undefined, text: string): boolean {
  return !!page && page.length > 0 && page.map((f) => f.textContent ?? '').join('') === text
}

/**
 * 紙面の上の写し（打った字をその場で見せる段落・書き終えた段落の仮の表示）el の、画面の点 (x, y) にいちばん近い文字の位置
 * （その文字の右半分なら、その文字の後ろ）。点が el の外（frame があれば、その見えている範囲の外）なら null
 */
export function offsetInCopy(el: HTMLElement, x: number, y: number, frame?: HTMLElement): number | null {
  const box = el.getBoundingClientRect()
  const view = frame?.getBoundingClientRect() ?? box
  if (x < Math.max(box.left, view.left) || x > Math.min(box.right, view.right) || y < Math.max(box.top, view.top) || y > Math.min(box.bottom, view.bottom)) return null
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let at = 0
  let best = { d: Infinity, offset: 0 }
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    for (let i = 0; i < node.length; i++) {
      range.setStart(node, i)
      range.setEnd(node, i + 1)
      const r = [...range.getClientRects()].find((q) => q.height > 0)
      if (r) {
        // 行（上下）の近さを先に、そのあと左右の近さで比べる
        const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0
        const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0
        const d = dy * 10000 + dx
        if (d < best.d) best = { d, offset: at + i + (x > (r.left + r.right) / 2 ? 1 : 0) }
      }
    }
    at += node.length
  }
  return best.d === Infinity ? 0 : best.offset
}

const COPIED_STYLES = ['fontFamily', 'fontSize', 'lineHeight', 'letterSpacing', 'textIndent', 'textAlign', 'fontWeight'] as const

/**
 * キーボードで書く欄からここへ移っても、書き終わりにしない（道具の「図を入れる」などを、書いていた位置で使えるように）。
 * .table-size：スマホの書く欄の「表を入れる」で出る、表の大きさを選ぶ欄（app/TableSize.tsx。選んでいる間も、書いていた位置を覚えておく）。
 * .direct-bar：スマホで紙面に直接書くの、キーボードの上の道具（app/Phone.tsx）。
 * .shape-panel・.table-shape：「表の形を整える」の窓（パソコン）と、下から出る欄（スマホ。app/tableShape.tsx。選んでいる間も、書いていたセルを覚えておく）
 */
const KEEP_OPEN = '.palette, .es-tools, .table-size, .direct-bar, .shape-panel, .table-shape'
/** 書く欄を開き直すときも、フォーカスを動かさない所（「表の形を整える」の窓・欄。キーボードで選び続けられるように） */
const STAY_FOCUS = '.shape-panel, .table-shape'

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
  /**
   * スマホの段落：紙面の上の写しを見せて、打った字をその場で紙面に出しているか（紙面のその段落は隠す）。
   * 打つと見せ、組み直した紙面が書いた字に追いつくと（reportEditor の syncLive）、やめて紙面の段落を見せる。
   * 写しは、見せていない間も、書く欄の字に合わせて紙面と同じ組み方で組んでおく（スマホの段落で、紙面の上の位置が決まっているとき：spacingBox）
   */
  private liveOn = false
  /** スマホの写しで、まだ測り直していない所の始め（打った・消した所のうち、いちばん前。測り直してあれば null） */
  private dirtyFrom: number | null = null
  /**
   * スマホの写しを、打つ手が止まってから測り直している途中（見えない下書きの要素 scratch で、時間を分けて測る。
   * 測り終えたら、写しの中身と入れ替える。途中で打ったら、やめて、また打つ手が止まってからやり直す）
   */
  private mirrorJob: { text: string; scratch: HTMLElement; steps: Generator<void, SpacingPlan>; timer: number } | null = null
  /** キーボードで道具へ移っているあいだ、書いていたカーソルの位置（書く欄に戻ったら、そこから続ける） */
  private parkedCaret: number | null = null
  private unwatchParked: (() => void) | null = null
  /** 紙面と同じ組み方で書いているか（PC の段落）。このときの書く欄の文字は model */
  private typeset = false
  private model = ''
  /** 書く欄の中の「元に戻す」「やり直す」（紙面と同じ組み方で書いているとき。開くたびに空にする） */
  private undoStack: TextState[] = []
  private redoStack: TextState[] = []
  /** 続けて打った・消した文字は、元に戻す1回分にまとめる（kind：打った・消した、at：その続きの位置） */
  private lastEdit: { kind: 'insert' | 'delete'; at: number } | null = null
  /** 日本語の変換を始める前の文字と範囲（変換を終えたら、元に戻す1回分にする） */
  private beforeComposition: TextState | null = null
  /** いまの書く欄の中身の、句読点の包み方の記録と、そのときの文字（書き換えたら、変わった所の近くだけを測り直すため） */
  private plan: SpacingPlan | null = null
  private renderedText: string | null = null
  /** 打つ手が止まったら測り直す所の始め（なければ null。flushTypeset） */
  private pendingFrom: number | null = null
  private typesetTimer = 0

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

    this.element.addEventListener('compositionstart', () => {
      this.composingNow = true
      if (this.typeset) this.beforeComposition = { text: this.model, ...this.selectionOffsets() }
    })
    this.element.addEventListener('compositionend', () => {
      this.composingNow = false
      if (this.typeset) this.syncFromDom(this.beforeComposition)
      else this.emitInput()
      this.beforeComposition = null
    })
    this.element.addEventListener('input', () => {
      if (this.composingNow) {
        // スマホ：日本語の変換中の字も、紙面の上の写しに出す（原稿には、変換を終えてから入れる）
        if (this.sheetHost && this.target) this.liveInput(this.text)
        return
      }
      // 紙面と同じ組み方で書いているとき、受け取らなかった入力で中身が変わっていたら、書く欄の中身から文字を読み直す
      if (this.typeset) {
        if (this.domText() !== this.model) this.syncFromDom({ text: this.model, start: this.selectionOffsets().start, end: this.selectionOffsets().end })
        return
      }
      this.emitInput()
    })
    this.element.addEventListener('beforeinput', (e) => this.onBeforeInput(e))
    this.element.addEventListener('copy', (e) => this.onCopyCut(e, false))
    this.element.addEventListener('cut', (e) => this.onCopyCut(e, true))
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
    // スマホ：紙面の上の写しの行が増えた・減った（後ろの文章をずらす）
    new ResizeObserver(() => {
      if (this.target && this.sheetHost && this.liveOn) this.callbacks.onResize?.()
    }).observe(this.mirror)
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
   * 紙面と同じ組み方で組む要素：PC の段落は書く欄、スマホの段落は紙面の上の写し（紙面の上の位置が決まっているときだけ）。組まないときは null
   */
  private get spacingBox(): HTMLElement | null {
    if (this.typeset) return this.element
    return this.sheetHost && this.placed && this.target?.kind === 'paragraph' ? this.mirror : null
  }

  /** スマホ：紙面の上の写しを見せて、打った字をその場で紙面に出しているか */
  get live(): boolean {
    return this.liveOn
  }

  /**
   * 書く場所を切り替える。host を渡すと、その中で（大きな文字で）書く。null なら紙面に重ねる。
   * direct：スマホで紙面に直接書く。紙面に重ね、書く欄の枠を紙面の表示枠の中に置く（紙面と一緒にスクロールする）
   */
  setSheetHost(host: HTMLElement | null, direct = false): void {
    if (this.target) this.commit()
    this.clearGhosts()
    this.sheetHost = host
    this.direct = !host && direct
    const el = this.element
    el.classList.toggle('in-sheet', !!host)
    if (host) {
      for (const key of [...COPIED_STYLES, 'transform', 'width', 'top', 'left'] as const) el.style[key] = ''
      host.append(el)
      // 紙面の上の写し・仮の表示を入れる枠は、紙面の表示枠の中に置く（紙面と一緒にスクロールする。
      // 重ねる層に置いて、スクロールのたびに動かすと、指で動かしている間、紙面より少し遅れてついてきて、ずれて見えるため）
      if (this.clip.parentElement !== this.scroller) this.scroller.append(this.clip)
    } else {
      this.clip.append(el)
      // スマホで紙面に直接書くときも、書く欄の枠を紙面の表示枠の中に置く（指で紙面を動かしても、書く欄が遅れてずれないように）
      const parent = this.direct ? this.scroller : this.layer
      if (this.clip.parentElement !== parent) parent.append(this.clip)
    }
  }

  private sheetHost: HTMLElement | null = null
  /** スマホで紙面に直接書く：スマホで紙面に直接書いている（紙面に重ねた書く欄。枠は紙面の表示枠の中） */
  private direct = false

  /**
   * 図表のタイトルの番号を、書く欄の前に出す・やめる（書く欄の data-label。見た目は index.css の ::before。書けない字なので、書いた字には入らない）。
   * 下の欄で書くとき（予備の ?direct=0 の端末）は出さない（今までどおり）
   */
  private setLabel(label: string | undefined): void {
    if (label && !this.sheetHost) this.element.dataset.label = label
    else delete this.element.dataset.label
  }

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
    // 紙面と同じ組み方で書いているとき：日本語の変換中は、変換中の文字も含めて、書く欄の中身から読む（閉じる直前の保存に間に合わせるため）
    if (this.typeset) return this.composingNow ? this.domText() : this.model
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
    return this.offsetAt(sel.anchorNode!, sel.anchorOffset)
  }

  /** 書く欄の中の点（ノードと、その中の位置）の、文字の位置（包んだ要素の中の文字も数える） */
  private offsetAt(node: Node, offset: number): number {
    const range = document.createRange()
    range.selectNodeContents(this.element)
    try {
      range.setEnd(node, offset)
    } catch {
      return this.text.length
    }
    return range.toString().length
  }

  /** 書く欄で選んでいる範囲（文字の位置。始め ≦ 終わり）。書く欄の外なら、文字の終わり */
  selectionOffsets(): { start: number; end: number } {
    const sel = getSelection()
    if (!sel || !sel.rangeCount || !this.element.contains(sel.anchorNode) || !this.element.contains(sel.focusNode)) {
      const at = this.parkedCaret ?? this.text.length
      return { start: at, end: at }
    }
    const r = sel.getRangeAt(0)
    const a = this.offsetAt(r.startContainer, r.startOffset)
    const b = this.offsetAt(r.endContainer, r.endOffset)
    return { start: Math.min(a, b), end: Math.max(a, b) }
  }

  /** 書く欄の中身の文字（包んだ要素の中の文字も。すき間の要素は文字を持たない） */
  private domText(): string {
    return (this.element.textContent ?? '').replace(/[\r\n]/g, '')
  }

  open(target: OverlayTarget): void {
    this.unpark()
    this.clearGhosts()
    // ほかの欄を開く：前の欄の、紙面の上の写しはやめる（同じ欄を開き直すときは、下で見せるかを決め直す）
    if (this.target?.blockId !== target.blockId) this.setLive(false)
    this.target = target
    this.element.dataset.kind = target.kind
    this.setLabel(target.label)
    this.setTypeset(!this.sheetHost && target.kind === 'paragraph')
    this.model = target.text
    this.resetHistory()
    this.resetTypeset()
    this.clearMirror()
    // 下の欄で書く（スマホ）：書体などは画面用（CSS）のまま。スマホでキーボードを出すには、タップの処理の中で欄を見せて入力欄に移る必要がある。
    // 紙面の上の位置と見た目は、写しに合わせておく（段落は、打った字をその場で見せる。ほかの欄は見えない：仮の表示に使う）
    if (this.sheetHost) this.sheetHost.closest('.edit-sheet')?.classList.add('open')
    this.copyStyle(target.styleSource, target.kind)
    this.clip.hidden = false
    // 紙面と同じ組み方で組むには、紙面と同じ幅が要る（行の位置を測って、句読点を詰めるかを決める）。幅を決めてから中身を組む
    this.box.style.transform = `scale(${target.scale})`
    this.box.style.width = this.widthOf(target)
    // 紙面の上の位置が決まっているか（スマホの写しを組むかどうか）を、先に決めておく
    this.setFrame(target)
    this.renderText(null, { full: true, page: target.page })
    this.moveTo(target)
    // 「表の形を整える」の窓・欄の中をキーボードで使っている（表を変えると、組み直してからセルを開き直す）：そこから動かさない。
    // 書く欄は開いたまま待たせ、窓を閉じて書く欄に戻ったら、このカーソルの位置から書ける（park。app/tableShape.tsx）
    if (document.activeElement?.closest(STAY_FOCUS)) {
      this.park()
      this.parkedCaret = target.caret
    } else {
      this.element.focus({ preventScroll: true })
      this.setCaret(target.caret)
    }
    // スマホ：紙面がまだ書いた字になっていなければ（書き終えた直後に、組み直す前にまた開いたなど）、はじめから写しを見せる
    this.setLive(this.spacingBox === this.mirror && !pageShows(target.page, this.model))
  }

  /** 紙面の上の写しを空にする（紙面と同じ組み方の印と、包み方の記録も外す） */
  private clearMirror(): void {
    this.mirror.textContent = ''
    delete this.mirror.dataset.typeset
    if (!this.typeset) this.resetTypeset()
  }

  /** スマホ：紙面の上の写しを見せる・やめる（見せられるのは、段落で、紙面の上の位置が決まっているときだけ） */
  showLive(on: boolean): void {
    this.setLive(on && this.spacingBox === this.mirror)
  }

  private setLive(on: boolean): void {
    if (this.liveOn === on) return
    this.liveOn = on
    this.mirror.classList.toggle('live', on)
    this.callbacks.onLive?.(on)
  }

  /**
   * スマホ：書く欄の字を、紙面の上の写しに入れる。段落で、紙面の上の位置が決まっていれば、紙面と同じ組み方で組む
   * （前に組んだ字と比べて、変わった所の近くだけを測り直す。full：はじめから組む。page：紙面の段落の中身を写せるなら写す）。
   * ほかの欄は、見えない写しに字だけを入れる（仮の表示に使う）
   */
  private syncMirror(text: string, how: { full?: boolean; page?: HTMLElement[] } = {}): void {
    if (!this.sheetHost || !this.target) return
    const mirror = this.mirror
    if (this.spacingBox !== mirror) {
      if (mirror.hasAttribute('data-typeset')) this.clearMirror()
      if (mirror.textContent !== text) mirror.textContent = text
      return
    }
    if (!mirror.hasAttribute('data-typeset')) {
      mirror.dataset.typeset = ''
      how = { ...how, full: true }
    }
    if (!how.full && text === this.renderedText) return
    this.cancelMirrorJob()
    const old = this.renderedText
    if (how.full || old === null || !this.plan) {
      // はじめから：紙面に同じ字の段落があれば、その中身を写す（測らずに済み、紙面と必ず同じ所で折り返す）。
      // なければ、測らずに並べ（同じ字のままなら前の包み方で）、打つ手が止まったら、はじめから測る
      if (how.page && this.copyPage(mirror, text, how.page)) {
        this.dirtyFrom = null
        return
      }
      const known = old === text && this.plan ? this.plan : { wraps: new Map(), thins: new Set<number>() }
      mirror.replaceChildren(...this.buildNodes(text))
      this.plan = typesetSpacing(mirror, { from: Infinity, known })
      this.renderedText = text
      this.dirtyFrom = 0
      this.scheduleTypeset()
      return
    }
    // 打った・消した所（前に組んだ字と比べる）
    let p = 0
    while (p < old.length && p < text.length && old[p] === text[p]) p++
    let q = 0
    while (q < old.length - p && q < text.length - p && old[old.length - 1 - q] === text[text.length - 1 - q]) q++
    const known = shiftPlan(this.plan, p, old.length - q, text.length - old.length)
    // 打った・消した所の字だけを、写しの中で入れ替える。できなければ、測らずに前の包み方のまま並べ直す（どちらも、打つ手が止まったら測り直す）
    if (!this.patchMirror(old, text, p, q)) {
      mirror.replaceChildren(...this.buildNodes(text))
      this.plan = typesetSpacing(mirror, { from: Infinity, known })
    } else this.plan = known
    this.renderedText = text
    this.dirtyFrom = Math.min(this.dirtyFrom ?? Infinity, p)
    this.scheduleTypeset()
  }

  /**
   * スマホの写しで、old の p 字目から（後ろの q 字は同じ）を text に書き換えた所だけを、写しの中で入れ替える（並べ直さない。入れ替えたら true）。
   * - 書き換えた所が、包んだ要素の外の1つのテキストノードの中なら、その字を入れ替える（打った句読点・英数字も、包まず・すき間を入れずに入れる）
   * - 包んだ句読点1つを消したなら、その要素を外す
   * 図表の参照（「（図1）」のまとまり）が変わるときは、入れ替えない。句読点の包み方・すき間は、打つ手が止まったら測り直す（flushMirror）。
   * box：入れ替える要素（ふだんは写し。スマホで紙面に直接書く書く欄も同じように入れ替える：patchTyped）
   */
  private patchMirror(old: string, text: string, p: number, q: number, box: HTMLElement = this.mirror): boolean {
    const oldEnd = old.length - q
    const inserted = text.slice(p, text.length - q)
    if (old.length === 0) return false
    const refs = this.target?.refs
    if (refs) {
      const delta = inserted.length - (oldEnd - p)
      const moved = refs(old).map(([s, e]) => (e <= p ? [s, e] : s >= oldEnd ? [s + delta, e + delta] : [-1, -1]))
      if (JSON.stringify(moved) !== JSON.stringify(refs(text))) return false
    }
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT)
    let start = 0
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      const end = start + node.length
      const parent = node.parentElement
      // 包んだ句読点1つ（の字だけ）を消した
      if (start === p && end === oldEnd && inserted === '' && parent?.localName === 'viv-ts-inner' && parent.parentElement?.parentElement === box) {
        parent.parentElement.remove()
        return true
      }
      // 書き換えた所が、このテキストノード（包んだ要素の外）の中にある（打ったときは、ノードの終わり・始めでもよい）
      if (start <= p && oldEnd <= end && parent === box) {
        node.replaceData(p - start, oldEnd - p, inserted)
        return true
      }
      if (end > p) return false
      start = end
    }
    return false
  }

  /** 打つ手が止まったら、測り直す（flushTypeset） */
  private scheduleTypeset(): void {
    clearTimeout(this.typesetTimer)
    this.typesetTimer = window.setTimeout(() => this.flushTypeset(), TYPESET_DELAY_MS)
  }

  /**
   * スマホの写しを、まだ測り直していない所（dirtyFrom の行の1つ前の行）から、正しく測り直す。
   * 見えない下書きの要素（写しと同じ書体・幅・位置）に同じ字を並べ、MIRROR_SLICE_MS ずつ時間を分けて測り、測り終えたら写しと入れ替える。
   * now：いま全部測る（書き終えるとき。仮の表示を、紙面と同じ所で折り返すように）
   */
  private flushMirror(now: boolean): void {
    if (this.dirtyFrom === null || this.spacingBox !== this.mirror) return
    if (!this.mirrorJob) {
      const text = this.renderedText ?? ''
      const from = this.dirtyFrom === 0 ? 0 : this.lineStartBefore(this.mirror, this.dirtyFrom)
      const scratch = document.createElement('div')
      scratch.className = 'overlay-mirror overlay-scratch'
      scratch.dataset.typeset = ''
      scratch.setAttribute('aria-hidden', 'true')
      scratch.style.cssText = this.mirror.style.cssText
      scratch.append(...this.buildNodes(text))
      this.clip.append(scratch)
      this.mirrorJob = { text, scratch, steps: typesetSteps(scratch, { from, known: this.plan, reshape: false }), timer: 0 }
    }
    this.runMirrorJob(now)
  }

  private runMirrorJob(now: boolean): void {
    const job = this.mirrorJob
    if (!job) return
    const deadline = now ? Infinity : performance.now() + MIRROR_SLICE_MS
    for (;;) {
      const step = job.steps.next()
      if (step.done) {
        this.mirrorJob = null
        job.scratch.remove()
        // 測り終えた：写しの中身を入れ替え、ブラウザに字の形をはじめから計算させる（紙面と同じ所で折り返すように）
        this.mirror.replaceChildren(...job.scratch.childNodes)
        reshapeSpacing(this.mirror)
        this.plan = step.value
        this.renderedText = job.text
        this.dirtyFrom = null
        return
      }
      if (performance.now() >= deadline) break
    }
    job.timer = window.setTimeout(() => this.runMirrorJob(false), 0)
  }

  /** スマホの写しを測り直している途中なら、やめる（字が変わった・閉じた） */
  private cancelMirrorJob(): void {
    if (!this.mirrorJob) return
    clearTimeout(this.mirrorJob.timer)
    this.mirrorJob.scratch.remove()
    this.mirrorJob = null
  }

  // ---- スマホで紙面に直接書く：打つたびには測らない ----
  // PC と同じく打つたびに測り直すと、スマホは測るのが遅く、長い段落では1字ごとに遅いスマホで 0.1 秒以上かかった。
  // スマホの写しと同じく、打った・消した所の字だけを書く欄の中で入れ替え（patchTyped）、打つ手が止まったら、見えない下書きの要素で
  // 時間を分けて測り直し、測り終えたら書く欄の中身と入れ替える（flushTyped。カーソルの位置は保つ）。日本語の変換中は入れ替えない

  /** スマホで紙面に直接書く：打つ手が止まってから、書く欄を測り直している途中（見えない下書きの要素 scratch で） */
  private typedJob: { text: string; scratch: HTMLElement; steps: Generator<void, SpacingPlan>; timer: number } | null = null

  /** スマホで紙面に直接書く：書く欄の中の、打った・消した所の字だけを入れ替える（できたら true。selection：入れ替えたあとに選ぶ範囲） */
  private patchTyped(selection: { start: number; end: number } | null): boolean {
    const old = this.renderedText
    const text = this.model
    if (old === null || !this.plan) return false
    if (old !== text) {
      const [p, q] = sameEnds(old, text)
      if (!this.patchMirror(old, text, p, q, this.element)) return false
      this.markTyped(old, text, p, q)
    }
    if (selection) this.select(selection.start, selection.end)
    return true
  }

  /** スマホで紙面に直接書く：書く欄の字が old から text に変わった（前の p 字・後ろの q 字は同じ）。包み方の記録をずらし、打つ手が止まったら測り直す */
  private markTyped(old: string, text: string, p: number, q: number): void {
    this.plan = shiftPlan(this.plan!, p, old.length - q, text.length - old.length)
    this.renderedText = text
    this.dirtyFrom = Math.min(this.dirtyFrom ?? Infinity, p)
    this.cancelTypedJob()
    this.scheduleTypeset()
  }

  /**
   * スマホで紙面に直接書く：まだ測り直していない所（dirtyFrom の行の1つ前の行、または pendingFrom）から後ろを、時間を分けて測り直す。
   * now：いま全部測る（書き終えるとき）。日本語の変換中は、変換を終えるまで待つ
   */
  private flushTyped(now: boolean): void {
    if (this.composingNow) {
      this.typesetTimer = window.setTimeout(() => this.flushTypeset(), TYPESET_DELAY_MS)
      return
    }
    if (!this.typedJob) {
      const text = this.model
      const dirty = this.dirtyFrom === null ? Infinity : this.dirtyFrom === 0 ? 0 : this.lineStartBefore(this.element, this.dirtyFrom)
      const from = Math.min(dirty, this.pendingFrom ?? Infinity)
      const scratch = document.createElement('div')
      scratch.className = 'overlay-editor overlay-scratch'
      scratch.dataset.typeset = ''
      scratch.dataset.kind = this.element.dataset.kind ?? ''
      scratch.setAttribute('aria-hidden', 'true')
      scratch.style.cssText = this.element.style.cssText
      Object.assign(scratch.style, { visibility: 'hidden', pointerEvents: 'none' })
      scratch.append(...this.buildNodes(text))
      this.clip.append(scratch)
      this.typedJob = { text, scratch, steps: typesetSteps(scratch, { atomic: true, from, known: this.plan, reshape: false }), timer: 0 }
    }
    this.runTypedJob(now)
  }

  private runTypedJob(now: boolean): void {
    const job = this.typedJob
    if (!job) return
    const deadline = now ? Infinity : performance.now() + MIRROR_SLICE_MS
    for (;;) {
      const step = job.steps.next()
      if (step.done) {
        this.typedJob = null
        job.scratch.remove()
        // 測っている間に字が変わった・日本語の変換が始まった：入れ替えない（打つ手が止まったら・変換を終えたら、また測り直す）
        if (job.text !== this.model || this.composingNow) {
          if (this.composingNow) this.typesetTimer = window.setTimeout(() => this.flushTypeset(), TYPESET_DELAY_MS)
          return
        }
        const focused = document.activeElement === this.element
        const selection = focused ? this.selectionOffsets() : null
        this.element.replaceChildren(...job.scratch.childNodes)
        reshapeSpacing(this.element)
        this.plan = step.value
        this.renderedText = job.text
        this.dirtyFrom = null
        this.pendingFrom = null
        if (selection) this.select(selection.start, selection.end)
        return
      }
      if (performance.now() >= deadline) break
    }
    job.timer = window.setTimeout(() => this.runTypedJob(false), 0)
  }

  /** スマホで紙面に直接書く：書く欄を測り直している途中なら、やめる（字が変わった・閉じた） */
  private cancelTypedJob(): void {
    if (!this.typedJob) return
    clearTimeout(this.typedJob.timer)
    this.typedJob.scratch.remove()
    this.typedJob = null
  }

  /**
   * スマホ：組み直した紙面が、書いている字に追いついた：紙面の段落の中身を写しに写す（測らずに、紙面と同じ組み方になる。
   * このあと打つときは、そこから字を入れ替える）
   */
  adoptPage(page: HTMLElement[]): void {
    if (this.spacingBox !== this.mirror || this.composingNow) return
    const text = this.text
    if (!pageShows(page, text)) return
    this.cancelMirrorJob()
    clearTimeout(this.typesetTimer)
    if (this.copyPage(this.mirror, text, page)) this.dirtyFrom = null
  }

  /** スマホ：書く欄の字が変わった（打った・消した・貼り付けた・日本語の変換中）。紙面の上の写しを合わせて、見せる */
  private liveInput(text: string): void {
    this.syncMirror(text)
    if (this.spacingBox !== this.mirror) return
    this.setLive(true)
    this.callbacks.onLiveUpdate?.()
  }

  /** スマホ：紙面の上の写しの、見えている範囲（画面座標。写しを見せていなければ null） */
  liveRect(): { left: number; top: number; right: number; bottom: number } | null {
    if (!this.liveOn) return null
    const r = this.mirror.getBoundingClientRect()
    const c = this.clip.getBoundingClientRect()
    return { left: Math.max(r.left, c.left), top: Math.max(r.top, c.top), right: Math.min(r.right, c.right), bottom: Math.max(Math.max(r.top, c.top), Math.min(r.bottom, c.bottom)) }
  }

  /**
   * スマホ：紙面の上の写しで、書く欄のカーソルの位置にあたる所（画面座標。カーソルの前の字の右端。写しを見せていなければ null）。
   * カーソルが紙面の本文の下へはみ出したか（組み直して次のページへ移る）・見えているかを調べるのに使う
   */
  liveCaretRect(): { left: number; top: number; bottom: number } | null {
    if (!this.liveOn) return null
    const length = this.renderedText?.length ?? 0
    const at = Math.min(this.caret, length)
    const before = at > 0 ? charRect(this.mirror, at - 1) : undefined
    if (before) return { left: before.right, top: before.top, bottom: before.bottom }
    const after = charRect(this.mirror, 0)
    if (after) return { left: after.left, top: after.top, bottom: after.bottom }
    const r = this.mirror.getBoundingClientRect()
    return { left: r.left, top: r.top, bottom: r.bottom }
  }

  /** スマホ：紙面の上の写しを押した：押した点にいちばん近い字の位置（写しを見せていない・写しの外なら null） */
  liveOffsetAt(x: number, y: number): number | null {
    return this.liveOn ? offsetInCopy(this.mirror, x, y, this.clip) : null
  }

  /** 紙面と同じ組み方で書くか（PC の段落）を決める（書く欄の印 data-typeset：組み方の CSS は index.css） */
  private setTypeset(on: boolean): void {
    this.typeset = on
    if (on) this.element.dataset.typeset = ''
    else delete this.element.dataset.typeset
  }

  private resetHistory(): void {
    this.undoStack = []
    this.redoStack = []
    this.lastEdit = null
    this.beforeComposition = null
  }

  /** 入力欄の幅（縮小前の px） */
  private widthOf({ rect, scale }: OverlayPlacement): string {
    return `${Math.max(40, (rect.right - rect.left) / scale)}px`
  }

  /**
   * 書く欄の中身を、文字（model）から作り直す。紙面と同じ組み方で書いているときは、図表の参照を折り返さないまとまり（.fig-ref）にし、
   * 句読点などを紙面と同じように包む（textSpacing.ts）。selection：作り直したあとに選ぶ範囲（null なら選び直さない）
   */
  private renderText(selection: { start: number; end: number } | null, how: { full?: boolean; page?: HTMLElement[] } = {}): void {
    const el = this.element
    if (!this.typeset) {
      el.textContent = this.model
      // スマホ：紙面の上の写しも、はじめから組む（段落は、紙面の段落の中身を写せるなら写す）
      if (this.sheetHost) this.syncMirror(this.model, { full: true, page: how.page })
      else this.resetTypeset()
      if (selection) this.select(selection.start, selection.end)
      return
    }
    const text = this.model
    // スマホで紙面に直接書く：打つたびには測らず、打った・消した所の字だけを入れ替える（打つ手が止まったら測り直す：flushTyped）
    if (this.direct && !how.full && !how.page && this.patchTyped(selection)) return
    if (this.direct) {
      // 入れ替えられないとき・はじめから組むとき：測り直すのを待っていた所も、下の組み直しで測る（測り直している途中ならやめる）
      this.cancelTypedJob()
      if (this.dirtyFrom !== null && !how.full) this.pendingFrom = Math.min(this.pendingFrom ?? Infinity, this.dirtyFrom === 0 ? 0 : this.lineStartBefore(el, this.dirtyFrom))
      this.dirtyFrom = null
    }
    // 紙面に同じ文字の段落があれば、紙面の中身を写す（組版エンジンが包んだまま。測らずに済み、紙面と必ず同じ所で折り返す）
    if (how.page && this.copyPage(el, text, how.page)) {
      if (selection) this.select(selection.start, selection.end)
      return
    }
    // 書き換えた所（前に組んだ文字と比べる）。その行の1つ前の行から後ろだけを測り直す（前の行は変わらない）
    const old = this.renderedText
    let known: SpacingPlan | null = null
    let from = 0
    if (!how.full && old !== null && this.plan) {
      let p = 0
      while (p < old.length && p < text.length && old[p] === text[p]) p++
      let q = 0
      while (q < old.length - p && q < text.length - p && old[old.length - 1 - q] === text[text.length - 1 - q]) q++
      from = Math.min(this.lineStartBefore(el, p), this.pendingFrom ?? Infinity)
      known = shiftPlan(this.plan, p, old.length - q, text.length - old.length)
    }
    el.replaceChildren(...this.buildNodes(text))
    this.renderedText = text
    clearTimeout(this.typesetTimer)
    if (!known) {
      this.plan = typesetSpacing(el, { atomic: true })
      this.pendingFrom = null
    } else if ((text.slice(from).match(PUNCTUATION) ?? []).length <= QUICK_PUNCTUATION) {
      this.plan = typesetSpacing(el, { atomic: true, from, known })
      this.pendingFrom = null
    } else {
      // 測り直す所が長い（長い段落の前の方を書いている）：いまは書いている所の近くだけを測り直し、後ろは前の包み方のまま並べて、
      // 打つ手が止まったら、まとめて測り直す（flushTypeset）
      const near = [...text.slice(from).matchAll(PUNCTUATION)][QUICK_PUNCTUATION]
      this.plan = typesetSpacing(el, { atomic: true, from, until: near ? from + near.index : Infinity, known })
      this.pendingFrom = from
      this.typesetTimer = window.setTimeout(() => this.flushTypeset(), TYPESET_DELAY_MS)
    }
    if (selection) this.select(selection.start, selection.end)
  }

  /** 書く欄の中身の要素（文字と、図表の参照の折り返さないまとまり） */
  private buildNodes(text: string): Node[] {
    const nodes: Node[] = []
    let at = 0
    for (const [s, e] of this.target?.refs?.(text) ?? []) {
      if (s < at || e <= s) continue
      if (s > at) nodes.push(document.createTextNode(text.slice(at, s)))
      const ref = document.createElement('span')
      ref.className = 'fig-ref'
      ref.textContent = text.slice(s, e)
      nodes.push(ref)
      at = e
    }
    if (at < text.length) nodes.push(document.createTextNode(text.slice(at)))
    return nodes
  }

  /**
   * 紙面の段落の中身（組版エンジンが句読点などを包んだもの。ページをまたぐ段落は、ページごとの要素を順に）を、box（書く欄・スマホの写し）に写す。
   * 文字が text と違う・知らない要素があるときは写さない（false）
   */
  private copyPage(box: HTMLElement, text: string, fragments: HTMLElement[]): boolean {
    if (!pageShows(fragments, text)) return false
    const allowed = new Set(['viv-ts-open', 'viv-ts-close', 'viv-ts-inner', 'viv-ts-thin-sp', 'span'])
    const copied = fragments.flatMap((f) => [...f.childNodes].map((n) => n.cloneNode(true)))
    const holder = document.createElement('div')
    holder.append(...copied)
    for (const el of holder.querySelectorAll('*')) {
      if (!allowed.has(el.localName) || (el.localName === 'span' && el.className !== 'fig-ref')) return false
      // 組版エンジンの印・見た目の指定は外す（図表の参照の折り返さない見た目は index.css）。包んだ句読点は1文字のまとまりにする
      for (const name of [...el.getAttributeNames()]) if (name !== 'class') el.removeAttribute(name)
      if (box === this.element && (el.localName === 'viv-ts-open' || el.localName === 'viv-ts-close' || el.localName === 'viv-ts-thin-sp')) (el as HTMLElement).contentEditable = 'false'
    }
    box.replaceChildren(...holder.childNodes)
    this.plan = planFromDom(box)
    this.renderedText = text
    this.pendingFrom = null
    clearTimeout(this.typesetTimer)
    return true
  }

  /**
   * 打つ手が止まった（など）：あとで測り直すことにしていた所を、いま測り直す（PC の書く欄は、日本語の変換中は待つ）。
   * スマホの写しは、時間を分けて測り直す（flushMirror。変換中の字は下の欄にあるので待たない）。now：スマホの写しも、いま全部測る
   */
  private flushTypeset(now = false): void {
    clearTimeout(this.typesetTimer)
    if (this.spacingBox === this.mirror) return this.flushMirror(now)
    // スマホで紙面に直接書く：時間を分けて測り直す（測り終えたら、書く欄の中身と入れ替える）
    if (this.direct && this.typeset && (this.dirtyFrom !== null || this.pendingFrom !== null)) return this.flushTyped(now)
    if (this.pendingFrom === null || !this.typeset) return
    if (this.composingNow) {
      this.typesetTimer = window.setTimeout(() => this.flushTypeset(), TYPESET_DELAY_MS)
      return
    }
    const focused = document.activeElement === this.element
    const selection = focused ? this.selectionOffsets() : null
    this.element.replaceChildren(...this.buildNodes(this.model))
    this.plan = typesetSpacing(this.element, { atomic: true, from: this.pendingFrom, known: this.plan })
    this.pendingFrom = null
    if (selection) this.select(selection.start, selection.end)
  }

  private resetTypeset(): void {
    clearTimeout(this.typesetTimer)
    this.cancelMirrorJob()
    this.cancelTypedJob()
    this.plan = null
    this.renderedText = null
    this.pendingFrom = null
    this.dirtyFrom = null
  }

  /**
   * いま組んである box（書く欄・スマホの写し）で、文字の位置 at のある行の、1つ前の行の始めの文字の位置（1行目・2行目なら 0）。
   * 書き換えたあと、ここから後ろだけを測り直す
   */
  private lineStartBefore(box: HTMLElement, at: number): number {
    const nodes: { node: Text; start: number }[] = []
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT)
    let total = 0
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      nodes.push({ node, start: total })
      total += node.length
    }
    const mid = (i: number): { mid: number; h: number } | null => {
      const found = nodes.findLast((n) => n.start <= i && i < n.start + n.node.length)
      if (!found) return null
      const range = document.createRange()
      range.setStart(found.node, i - found.start)
      range.setEnd(found.node, i - found.start + 1)
      const r = [...range.getClientRects()].find((x) => x.height > 0)
      return r ? { mid: r.top + r.height / 2, h: r.height } : null
    }
    let i = Math.min(at, total - 1)
    let last = null
    while (i >= 0 && !(last = mid(i))) i--
    if (!last) return 0
    let lines = 0
    for (let j = i - 1; j >= 0; j--) {
      const m = mid(j)
      if (!m) continue
      if (m.mid < last.mid - last.h / 2) {
        lines++
        if (lines === 2) return j + 1
        last = m
      }
    }
    return 0
  }

  /** 選んでいる範囲を保ったまま、書く欄の中身を組み直す（幅・書体が変わったとき） */
  private rerender(): void {
    if (!this.typeset || !this.target) return
    const focused = document.activeElement === this.element
    this.renderText(focused ? this.selectionOffsets() : null, { full: true })
  }

  /**
   * 文字の位置 offset に置くカーソルの点。包んだ句読点（1文字のまとまり）の中には置かない。
   * 境目では、文字の要素（テキストノード）の中を選ぶ（日本語の変換中の文字が、ふつうの字間で入るように）
   */
  private caretPoint(offset: number, parent: Node = this.element): { node: Node; offset: number } {
    let acc = 0
    const kids = [...parent.childNodes]
    for (let i = 0; i < kids.length; i++) {
      const kid = kids[i]
      const len = kid.textContent?.length ?? 0
      if (kid.nodeType === Node.TEXT_NODE) {
        if (offset <= acc + len) return { node: kid, offset: offset - acc }
      } else if (kid instanceof HTMLElement && kid.isContentEditable) {
        // 図表の参照のまとまり（中の文字は書ける）
        if (offset < acc + len || (offset === acc + len && i === kids.length - 1 && parent !== this.element)) return this.caretPoint(offset - acc, kid)
      } else if (offset <= acc) {
        return { node: parent, offset: i }
      } else if (offset < acc + len) {
        return { node: parent, offset: i + 1 }
      }
      acc += len
    }
    return { node: parent, offset: kids.length }
  }

  /** 書く欄の文字の start から end までを選ぶ（同じなら、そこにカーソルを置く） */
  private select(start: number, end: number): void {
    const a = this.caretPoint(start)
    const b = start === end ? a : this.caretPoint(end)
    getSelection()?.setBaseAndExtent(a.node, a.offset, b.node, b.offset)
  }

  /**
   * 入力欄を開いたまま、書く先を別のブロックへ移す（段落を分けた・つなげた・↑↓で移った・表のセルで Tab を押したとき）。
   * 紙面を組み直してから開き直すと、長い原稿では数秒かかり、その間に打った文字が消えていたため。
   * 組み直したら、呼び出し側が settle と moveTo で正しい位置・書体に合わせる。
   * ghost：分けた前の段落の文字。組み直すまで入力欄のあった位置に仮に表示し、入力欄はそのすぐ下へずらす
   */
  continueIn(next: { blockId: string; kind: OverlayKind; text: string; caret: number; styleSource?: HTMLElement; refs?: OverlayTarget['refs']; page?: HTMLElement[] }, ghost?: string): void {
    if (!this.target) return
    this.unpark()
    // 図表のタイトルで Enter：続きの段落には番号を出さない（前のタイトルの仮の表示には、番号を付ける）
    const label = this.element.dataset.label
    this.setLabel(undefined)
    // 前の段落の仮の表示を、それまでの仮の表示の下（書いていた欄の位置）に足す。それまでの仮の表示は残す（組み直した紙面が出るまで）
    if (ghost !== undefined && this.placed) {
      const g = document.createElement('div')
      g.className = 'overlay-ghost'
      g.setAttribute('aria-hidden', 'true')
      g.style.cssText = this.box.style.cssText
      Object.assign(g.style, GHOST_STYLE)
      g.textContent = ghost
      // 図表のタイトルで Enter を押した：前のタイトルの仮の表示にも番号を付ける
      if (label) g.dataset.label = label
      this.clip.insertBefore(g, this.element.parentElement === this.clip ? this.element : this.mirror)
      // 段落の仮の表示も、紙面と同じ組み方にする（組み直した紙面と、行の折り返しが変わらないように）
      if (this.target.kind === 'paragraph') {
        g.dataset.typeset = ''
        typesetSpacing(g)
      }
      this.ghosts.push(g)
      this.offset = { ...this.offset, top: this.offset.top + g.offsetHeight * this.scale }
    }
    const kindChanged = next.kind !== this.target.kind
    // スマホ：前の段落の、紙面の上の写しはやめる（移った先の欄で、見せるかを決め直す）
    if (next.blockId !== this.target.blockId) this.setLive(false)
    this.target = { ...this.target, blockId: next.blockId, kind: next.kind, text: next.text, caret: next.caret, enterCreatesParagraph: false, refs: next.refs }
    this.element.dataset.kind = next.kind
    this.setTypeset(!this.sheetHost && next.kind === 'paragraph')
    this.model = next.text
    this.resetHistory()
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
    // スマホ：紙面の上の写しも、移った先の欄の字で、はじめから組む（renderText）
    this.renderText(null, { full: true, page: next.page })
    this.place()
    this.element.focus({ preventScroll: true })
    this.setCaret(next.caret)
    // スマホ：移った先の段落が、まだ紙面にない（分けた後ろの段落）・紙面と字が違う（つなげた段落）なら、写しを見せる
    this.setLive(this.spacingBox === this.mirror && !pageShows(next.page, next.text))
  }

  /** 組み直した紙面の書体に合わせ、仮に表示していた前の段落を消す（continueIn のあと） */
  settle(styleSource: HTMLElement | undefined, page?: HTMLElement[]): void {
    this.clearGhosts()
    if (this.target && styleSource) {
      this.copyStyle(styleSource, this.target.kind)
      // 紙面に出た段落の中身を写す（文字が違えば、測って組み直す）
      if (this.typeset) {
        const focused = document.activeElement === this.element
        this.renderText(focused ? this.selectionOffsets() : null, { full: true, page })
      } else if (this.sheetHost) this.syncMirror(this.text, { full: true, page })
    }
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
      const resized = g.style.width !== width
      Object.assign(g.style, { transform: `scale(${scale})`, width, top: `${top}px`, left: `${left}px` })
      if (resized && g.hasAttribute('data-typeset')) typesetSpacing(g)
      top += g.offsetHeight * scale
    }
    this.box.style.transform = `scale(${scale})`
    this.setWidth(width)
    this.offset = { top, left }
    this.place()
  }

  /** 入力欄の幅を変える（紙面と同じ組み方で書いているときは、幅が変われば組み直す） */
  private setWidth(width: string): void {
    if (this.box.style.width === width) return
    this.box.style.width = width
    if (this.box === this.element) this.rerender()
    // スマホの紙面の上の写しも、幅が変われば組み直す
    else if (this.mirror.hasAttribute('data-typeset')) this.syncMirror(this.text, { full: true })
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
    // 図表のタイトル：組み直して番号が変わっていれば、書く欄の前の番号も替える
    if (placement.label !== undefined) this.setLabel(placement.label)
    this.setFrame(placement)
    this.box.style.transform = `scale(${scale})`
    this.setWidth(this.widthOf(placement))
    // スマホ：紙面の上の位置が決まった段落（まだ紙面になかった段落が、組み直した紙面に出た）は、写しを紙面と同じ組み方で組む
    if (this.sheetHost) this.syncMirror(this.text)
    // ページをまたぐ段落：見えているページの最初の文字が、そのページの段落の上端に来るようにずらす
    this.offset = { top: rect.top - clip.top - this.alignShift(this.box, alignOffset, scale), left: rect.left - clip.left }
    this.place()
  }

  /** 見えているページの範囲と倍率を合わせる（moveTo・restack） */
  private setFrame({ rect, clip, scale }: OverlayPlacement): void {
    this.scale = scale
    this.placed = rect.right - rect.left > 1
    // 枠を置いている所（PC は重ねる層、スマホは紙面の表示枠）の中の、スクロールする前の位置
    const parent = this.clip.parentElement ?? this.layer
    const base = parent.getBoundingClientRect()
    this.clipBox = {
      top: clip.top - base.top - parent.clientTop + this.scroller.scrollTop,
      left: clip.left - base.left - parent.clientLeft + this.scroller.scrollLeft,
      width: clip.right - clip.left,
      height: clip.bottom - clip.top,
    }
  }

  /** ページをまたぐ段落で、見えているページより前にある文字（alignOffset 字）の分だけ、上へずらす高さ（画面の px） */
  private alignShift(el: HTMLElement, alignOffset: number, scale: number): number {
    if (alignOffset <= 0) return 0
    const length = el.textContent?.length ?? 0
    const first = charRect(el, 0)
    const here = charRect(el, Math.min(alignOffset, length - 1))
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
    // 測り直すのを待っていた所は、写す前に測り直す（書き終えた欄の仮の表示を、紙面と同じ所で折り返すように。スマホの写しも、いま全部測る）
    this.flushTypeset(true)
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
    // スマホ：枠は紙面の表示枠の中に置いているが、仮の表示は重ねる層に置く（呼び出し側）。層の中の位置にする
    if (this.clip.parentElement !== this.layer) {
      const at = this.clip.getBoundingClientRect()
      const layer = this.layer.getBoundingClientRect()
      clip.style.top = `${at.top - layer.top}px`
      clip.style.left = `${at.left - layer.left}px`
    }
    clip.setAttribute('aria-hidden', 'true')
    // 段落は、紙面と同じ組み方のまま写す（組み直した紙面が出たときに、行の折り返しが変わらないように）。
    // スマホの紙面の上の写しは、打つたびに紙面と同じ組み方で組んである（字が違えば、写す前に組む）
    const paragraph = this.target.kind === 'paragraph'
    if (paragraph && this.box === this.mirror) this.syncMirror(text)
    const copy = (from: HTMLElement, text: string, typeset: boolean) => {
      const el = document.createElement('div')
      el.style.cssText = from.style.cssText
      Object.assign(el.style, GHOST_STYLE)
      // 図表のタイトル：番号も一緒に写す（組み直した紙面が出るまで、番号が消えて見えないように）
      if (from.dataset.label) el.dataset.label = from.dataset.label
      // 表のセル：地を透かすため（罫線を隠さない。index.css）、どの欄の写しかを付けておく
      if (from.dataset.kind) el.dataset.kind = from.dataset.kind
      if (typeset) {
        el.dataset.typeset = ''
        el.append(...[...from.childNodes].map((n) => n.cloneNode(true)))
        for (const atom of el.querySelectorAll('[contenteditable]')) atom.removeAttribute('contenteditable')
      } else el.textContent = text
      clip.append(el)
    }
    for (const g of this.ghosts) copy(g, g.textContent ?? '', g.hasAttribute('data-typeset'))
    // 書いていた欄（何も書いていない段落は写さない。分けた前の段落の仮の表示だけを残す）
    if (text.trim()) copy(this.box, text, paragraph && (this.typeset || this.box === this.mirror))
    return clip
  }

  /** 確定せずに閉じる（呼び出し側がデータを処理済みのとき） */
  private close(): void {
    // スマホ：紙面の上の写しはやめる（紙面の段落を隠すのもやめる。書いた字は、呼び出し側が仮の表示にする）
    this.setLive(false)
    this.setLabel(undefined)
    this.target = null
    this.unpark()
    this.clearGhosts()
    this.placed = false
    this.clearMirror()
    this.setTypeset(false)
    this.resetTypeset()
    this.resetHistory()
    this.clip.hidden = true
    this.sheetHost?.closest('.edit-sheet')?.classList.remove('open')
  }

  setCaret(offset: number): void {
    const at = Math.max(0, Math.min(offset, this.text.length))
    this.select(at, at)
  }

  /** カーソルの位置に文字を入れる（「図を参照」など）。元に戻す（Ctrl+Z）も効く */
  insertText(text: string): void {
    if (!this.target) return
    this.element.focus({ preventScroll: true })
    if (this.typeset) {
      const { start, end } = this.selectionOffsets()
      this.lastEdit = null
      this.edit(start, end, text.replace(/[\r\n]/g, ''), 'insert')
      this.lastEdit = null
      return
    }
    document.execCommand('insertText', false, text)
  }

  /** 入力欄の中の文字範囲（指摘の下線表示用。包んだ要素の中の文字も数える） */
  range(start: number, end: number): Range | null {
    const point = (offset: number) => {
      const walker = document.createTreeWalker(this.element, NodeFilter.SHOW_TEXT)
      let acc = 0
      let last: Text | null = null
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        if (offset <= acc + node.length) return { node, offset: offset - acc }
        acc += node.length
        last = node
      }
      return last ? { node: last, offset: last.length } : null
    }
    const a = point(start)
    const b = point(end)
    if (!a || !b) return null
    const range = document.createRange()
    range.setStart(a.node, a.offset)
    range.setEnd(b.node, b.offset)
    return range
  }

  // ---- 紙面と同じ組み方で書いているときの入力（PC の段落） ----

  /**
   * 文字の start から end までを text に置き換え、書く欄の中身を組み直す（カーソルは入れた文字の後ろ）。
   * 続けて打った・消した文字は、元に戻す1回分にまとめる
   */
  private edit(start: number, end: number, text: string, kind: 'insert' | 'delete'): void {
    const before: TextState = { text: this.model, ...this.selectionOffsets() }
    const last = this.lastEdit
    const continues = !!last && last.kind === kind && (kind === 'insert' ? start === end && start === last.at : start === last.at || end === last.at)
    if (!continues) this.pushUndo(before)
    this.redoStack = []
    this.model = this.model.slice(0, start) + text + this.model.slice(end)
    this.lastEdit = { kind, at: start + text.length }
    this.renderText({ start: start + text.length, end: start + text.length })
    this.emitInput()
  }

  private pushUndo(state: TextState): void {
    this.undoStack.push(state)
    if (this.undoStack.length > 200) this.undoStack.shift()
  }

  /** 書く欄の中の「元に戻す」（戻すものがなければ、呼び出し側に任せる：onUndoEmpty） */
  private undoStep(): void {
    const previous = this.undoStack.pop()
    if (!previous) {
      this.callbacks.onUndoEmpty?.()
      return
    }
    this.redoStack.push({ text: this.model, ...this.selectionOffsets() })
    this.restore(previous)
  }

  private redoStep(): void {
    const next = this.redoStack.pop()
    if (!next) return
    this.pushUndo({ text: this.model, ...this.selectionOffsets() })
    this.restore(next)
  }

  private restore(state: TextState): void {
    this.lastEdit = null
    this.model = state.text
    this.renderText({ start: state.start, end: state.end })
    this.emitInput()
  }

  /** 日本語の変換を終えた（など、ブラウザが書く欄の中身を変えた）：中身から文字を読み直して、組み直す。before：変わる前（元に戻す1回分） */
  private syncFromDom(before: TextState | null): void {
    const text = this.domText()
    const caret = this.selectionOffsets().end
    // スマホで紙面に直接書く：書く欄の中身は、もう書いた字になっている。日本語の変換を終えるたびに中身を作り直して測ると、
    // スマホでは続けて打つ字が遅れるため、作り直さない。包み方の記録をずらし、打つ手が止まったら測り直す（markTyped）
    const typed = this.direct && this.renderedText !== null && !!this.plan
    if (text === this.model) {
      if (!typed) this.renderText({ start: caret, end: caret })
      return
    }
    if (before) this.pushUndo(before)
    this.redoStack = []
    this.lastEdit = null
    this.model = text
    if (typed) {
      const old = this.renderedText!
      if (old !== text) {
        const [p, q] = sameEnds(old, text)
        this.markTyped(old, text, p, q)
      }
    } else this.renderText({ start: caret, end: caret })
    this.emitInput()
  }

  /**
   * 入力の直前（打つ・消す・落とす・元に戻すなど）：ブラウザに書き換えさせず、文字を自分で変えてから組み直す。
   * 変える範囲は、ブラウザが変えようとした範囲（getTargetRanges。図表の参照の途中なども、ブラウザと同じ）
   */
  private onBeforeInput(e: InputEvent): void {
    // 表のセル：改行の入力（Enter・Shift+Enter のキーと、Android の文字入力の、キーの知らせのない改行）は、セルの中の改行にする（書き終えない）
    if (this.target?.kind === 'cell' && !this.composingNow && !e.isComposing && (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak')) {
      e.preventDefault()
      return this.insertCellBreak()
    }
    // スマホで紙面に直接書く：Enter のキーの知らせがなく、改行の入力だけが来た（Android の文字入力など）。キーの Enter と同じことをする
    if (this.direct && this.target && !this.composingNow && !e.isComposing && (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak')) {
      e.preventDefault()
      return this.enterFromInput()
    }
    // 紙面と同じ組み方で書いていない欄（表のセル・見出しなど）：開いてから何も書いていないときの「元に戻す」（ブラウザのメニューからも）は、
    // ブラウザに任せない（同じ書く欄で前に書いていた欄の、消した字を戻してしまう）。原稿の「元に戻す」にする（onUndoEmpty）
    if (!this.typeset && this.target && e.inputType === 'historyUndo' && this.text === this.target.text) {
      e.preventDefault()
      this.callbacks.onUndoEmpty?.()
      return
    }
    if (!this.typeset || !this.target || e.inputType === 'insertCompositionText') return
    // スマホで紙面に直接書く：日本語の変換中の入力（変換中の字を消すなど）は、ブラウザに任せる（変換を終えたら、書く欄の中身から読み直す）
    if (this.direct && (this.composingNow || e.isComposing)) return
    e.preventDefault()
    const type = e.inputType
    if (type === 'historyUndo') return this.undoStep()
    if (type === 'historyRedo') return this.redoStep()
    const ranges = e.getTargetRanges()
    let { start, end } = this.selectionOffsets()
    if (ranges.length > 0) {
      const offsets = ranges.flatMap((r) => [this.offsetAt(r.startContainer, r.startOffset), this.offsetAt(r.endContainer, r.endOffset)])
      start = Math.min(...offsets)
      end = Math.max(...offsets)
    }
    if (type.startsWith('insert')) {
      // 改行は書く欄の Enter（段落を分ける）で受け持つ。段落の中には改行を入れない
      if (type === 'insertParagraph' || type === 'insertLineBreak') return
      const data = (e.data ?? e.dataTransfer?.getData('text/plain') ?? '').replace(/[\r\n]/g, '')
      if (type !== 'insertText') this.lastEdit = null
      this.edit(start, end, data, 'insert')
      if (type !== 'insertText') this.lastEdit = null
    } else if (type.startsWith('delete')) {
      // スマホで紙面に直接書く：段落の先頭で消した（Backspace のキーの知らせがなかった。Android の文字入力など）：前の段落とつなげる（キーの Backspace と同じ）
      if (this.direct && this.target.kind === 'paragraph' && /Backward/.test(type) && start === 0 && end === 0) {
        const { blockId } = this.target
        const text = this.model
        return this.handOff(() => this.callbacks.onMergeBackward(blockId, text))
      }
      // ブラウザが範囲を示さなかったとき：カーソルの前（後ろ）の1文字
      if (start === end && ranges.length === 0) {
        if (/Backward/.test(type)) start = graphemeEdge(this.model, start, false)
        else end = graphemeEdge(this.model, end, true)
      }
      if (start !== end) this.edit(start, end, '', 'delete')
    }
  }

  /** 書く欄の中のコピー・切り取り：選んでいる文字だけを、ふつうの文字としてクリップボードに入れる（紙面と同じ組み方で書いているとき） */
  private onCopyCut(e: ClipboardEvent, cut: boolean): void {
    if (!this.typeset || !this.target) return
    const { start, end } = this.selectionOffsets()
    if (start === end) return
    e.preventDefault()
    e.clipboardData?.setData('text/plain', this.model.slice(start, end))
    if (cut) {
      this.lastEdit = null
      this.edit(start, end, '', 'delete')
      this.lastEdit = null
    }
  }

  private place(): void {
    // 枠の中は動かさない（ブラウザがカーソルを見せようとしてずらしていたら、戻す）
    if (this.clip.scrollTop !== 0) this.clip.scrollTop = 0
    const c = this.clip.style
    // スマホ：枠は紙面の表示枠の中にあり、紙面と一緒にスクロールする（スクロールした分を引かない）
    const scrolls = this.clip.parentElement !== this.scroller
    c.top = `${this.clipBox.top - (scrolls ? this.scroller.scrollTop : 0)}px`
    c.left = `${this.clipBox.left - (scrolls ? this.scroller.scrollLeft : 0)}px`
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
    const r = this.caretBox()
    return r ? { top: r.top + this.clip.scrollTop, bottom: r.bottom + this.clip.scrollTop } : null
  }

  /**
   * カーソルの画面上の四角。包んだ句読点のすぐ前・後ろ（要素の境目）にカーソルがあると、ブラウザが四角を返さないことがあるので、
   * そのときは隣の文字の四角から求める（前の文字の右端、なければ後ろの文字の左端）
   */
  private caretBox(): { left: number; top: number; bottom: number } | null {
    const sel = getSelection()
    if (!sel?.rangeCount || !sel.focusNode) return null
    // 文字を選んでいるときは、選んでいる端（Shift+矢印で動かしている方）
    const focus = document.createRange()
    focus.setStart(sel.focusNode, sel.focusOffset)
    const r = focus.getClientRects()[0]
    if (r && (r.height > 0 || r.width > 0)) return r
    const at = this.offsetAt(sel.focusNode ?? this.element, sel.focusOffset)
    const before = charRect(this.element, at - 1)
    if (before) return { left: before.right, top: before.top, bottom: before.bottom }
    return charRect(this.element, at) ?? null
  }

  /** PC：書いている欄のカーソルの画面上の位置（左・上・下。書いていない・スマホ・カーソルが書く欄の外なら null） */
  caretClientRect(): { left: number; top: number; bottom: number } | null {
    if (!this.target || this.sheetHost || this.clip.hidden) return null
    const sel = getSelection()
    if (!sel?.rangeCount || !this.element.contains(sel.focusNode)) return null
    return this.caretBox()
  }

  /**
   * 道具の「貼り付け」・書く欄の近くの「貼り付け」：紙面でコピーしたまとまりを、カーソルの所に入れる（Ctrl+V と同じ。選んでいる文字は置き換える）
   */
  pasteClip(): void {
    const clip = this.callbacks.onPasteClip
    if (!this.target || this.target.kind !== 'paragraph' || !clip) return
    const { blockId } = this.target
    const text = this.text
    const { start, end } = this.selectionOffsets()
    this.handOff(() => clip.paste(blockId, text, start, end))
  }

  private emitInput(): void {
    if (!this.target) return
    const text = this.text
    // スマホ：紙面の上の写しにも、書いている字を入れる（段落は、その場で紙面に見せる。ほかの欄は見えない写し：仮の表示に使う）
    if (this.sheetHost) this.liveInput(text)
    this.callbacks.onInput(this.target.blockId, text)
  }

  private onKeyDown(e: KeyboardEvent): void {
    // 日本語の変換中の Enter は、変換の確定として扱う
    if (!this.target || e.isComposing || this.composingNow || e.keyCode === 229) return
    const { blockId, kind } = this.target
    const caret = this.caret
    const text = this.text
    const collapsed = getSelection()?.isCollapsed ?? true
    // 紙面と同じ組み方で書いているとき：書く欄の中の Ctrl+Z（⌘+Z）・Ctrl+Y・Ctrl+Shift+Z（⌘+Shift+Z）は、ここで書いた文字を戻す・やり直す
    // 紙面と同じ組み方で書いていないとき（見出しなど1行の欄・スマホ）：開いてから何も書いていなければ、Ctrl+Z は呼び出し側に任せる（onUndoEmpty）
    if (!this.typeset && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z' && text === this.target.text && this.callbacks.onUndoEmpty?.()) {
      e.preventDefault()
      return
    }
    if (this.typeset && (e.ctrlKey || e.metaKey) && !e.altKey) {
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        return this.undoStep()
      }
      if ((key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey && !e.metaKey)) {
        e.preventDefault()
        return this.redoStep()
      }
    }

    if (e.key === 'Escape') {
      e.preventDefault()
      this.closingByKey = true
      this.element.blur()
    } else if (e.key === 'Enter' && kind === 'cell') {
      // 表のセル：Enter・Shift+Enter は改行（続いて来る改行の入力で入れる：onBeforeInput の insertCellBreak）
    } else if (e.key === 'Enter' && (kind === 'paragraph' || this.target.enterCreatesParagraph)) {
      e.preventDefault()
      // 文字を選んでいるときは、選んだ文字を消して分ける（ふつうの書く欄と同じ）
      const { start, end } = this.selectionOffsets()
      this.handOff(() => this.callbacks.onSplit(blockId, text.slice(0, start), text.slice(end)))
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
      // Shift を押しながら：選ぶ範囲を、紙面の次（前）の欄へ広げる（PC。書く欄で選び始めた所から）
      const onExtend = this.callbacks.onExtend
      // （広げられないとき（書き換えていて、紙面の文字と違うなど）は、今までどおり次（前）の欄へ移る）
      this.handOff(() => {
        if (!(e.shiftKey && onExtend && !this.sheetHost && onExtend(blockId, text, caret, direction))) this.callbacks.onNavigate(blockId, text, direction)
      })
    }
  }

  /**
   * スマホで紙面に直接書く：改行の入力（Enter のキーの知らせがなかった）。キーの Enter と同じく、段落は分け、見出しは後ろに段落を作り、
   * 1行の欄は書き終える
   */
  private enterFromInput(): void {
    if (!this.target) return
    const { blockId, kind } = this.target
    const text = this.text
    if (kind === 'paragraph' || this.target.enterCreatesParagraph) {
      const { start, end } = this.selectionOffsets()
      this.handOff(() => this.callbacks.onSplit(blockId, text.slice(0, start), text.slice(end)))
    } else if (kind !== 'cell') {
      this.closingByKey = true
      this.element.blur()
    }
  }

  /**
   * 表のセルの中に改行を入れる（選んでいる字は置き換える）。ブラウザの文字の入れ方で入れるので、書く欄の中の Ctrl+Z でも戻せ、入力の知らせ（input）も出る。
   * セルは紙面と同じ組み方では書かない（typeset ではない）ので、書く欄の中身から字を読む（get text）
   */
  private insertCellBreak(): void {
    document.execCommand('insertText', false, '\n')
  }

  /** スマホのキーボードの上の道具の「戻す」：書く欄の中で書いた文字を戻す（紙面と同じ組み方で書いている段落だけ。戻すものがなければ false） */
  undoTyping(): boolean {
    if (!this.typeset || !this.target || this.undoStack.length === 0) return false
    this.undoStep()
    return true
  }

  /** スマホのキーボードの上の道具の「やり直す」：書く欄の中で戻した文字を、もう一度入れる（なければ false） */
  redoTyping(): boolean {
    if (!this.typeset || !this.target || this.redoStack.length === 0) return false
    this.redoStep()
    return true
  }

  /** 書く欄の中で、戻せる・やり直せる文字があるか（紙面と同じ組み方で書いている段落） */
  get typingHistory(): { undo: boolean; redo: boolean } {
    const on = this.typeset && !!this.target
    return { undo: on && this.undoStack.length > 0, redo: on && this.redoStack.length > 0 }
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
    const caretRect = this.caretBox()
    const box = this.element.getBoundingClientRect()
    if (!caretRect) return true
    const lineHeight = (parseFloat(getComputedStyle(this.element).lineHeight) || 20) * (this.sheetHost ? 1 : this.scale)
    return edge === 'first' ? caretRect.top - box.top < lineHeight * 0.8 : box.bottom - caretRect.bottom < lineHeight * 0.8
  }

  private onPaste(e: ClipboardEvent): void {
    let pasted = e.clipboardData?.getData('text/plain') ?? ''
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
    const { blockId } = this.target
    const text = this.text
    // 選んでいる文字は、貼り付けた文字に置き換える
    const { start, end } = this.selectionOffsets()
    // 紙面で選んでコピーした段落・図表のまとまり（クリップボードの文字が、最後にコピーしたものと同じ）：まとまりのまま入れる（呼び出し側。reportEditor の pasteClip）
    const clip = this.callbacks.onPasteClip
    if (this.target.kind === 'paragraph' && clip?.matches(pasted)) {
      e.preventDefault()
      this.handOff(() => clip.paste(blockId, text, start, end))
      return
    }
    // Word などの表を貼り付けた：表は「表を入れる」で作るので、文になったことを知らせる（文は、そのまま入れる）
    const table = this.target.kind === 'paragraph' && /<table[\s>]/i.test(e.clipboardData?.getData('text/html') ?? '')
    if (table) queueMicrotask(() => this.callbacks.onPasteNote?.('table'))
    // 段落：入れる文字を、呼び出し側が変える（抄録には、図表の参照の括弧を入れない）
    const raw = pasted
    if (this.target.kind === 'paragraph' && this.callbacks.pasteText) pasted = this.callbacks.pasteText(blockId, pasted)
    if (this.target.kind !== 'paragraph' || !/\n/.test(pasted)) {
      // 1行の文字：紙面と同じ組み方で書いているとき・文字を変えたときは、ここで入れる（ほかは、ブラウザがそのまま入れる）
      if (this.typeset) {
        e.preventDefault()
        this.lastEdit = null
        this.edit(start, end, pasted.replace(/[\r\n]/g, ''), 'insert')
        this.lastEdit = null
      } else if (pasted !== raw) {
        e.preventDefault()
        document.execCommand('insertText', false, pasted.replace(/[\r\n]/g, ''))
      }
      return
    }
    e.preventDefault()
    // 複数行：1行目は今の段落のカーソルの前に、残りの行は新しい段落にする（空の行は除く）
    const lines = pasted.split(/\r?\n|\r/).map((l) => l.trim()).filter((l) => l !== '')
    if (lines.length === 0) return
    const paragraphs = [...lines]
    paragraphs[0] = text.slice(0, start) + paragraphs[0]
    const caretInLast = paragraphs[paragraphs.length - 1].length
    paragraphs[paragraphs.length - 1] += text.slice(end)
    this.handOff(() => this.callbacks.onPasteParagraphs(blockId, paragraphs, caretInLast))
  }
}
