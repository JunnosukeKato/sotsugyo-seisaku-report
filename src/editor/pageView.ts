import { CoreViewer } from '@vivliostyle/core'
import { pageKind, type PageKind } from '../layout/measure'

/**
 * 組版エンジン（Vivliostyle）1つ分。報告書の一部（表紙・抄録・目次・本文から後ろ）の HTML 文書を組んで表示する。
 * 組んである文書（html）を覚えておき、同じ文書なら組み直さずに使い回す（reportRenderer.ts）。
 */
export class PartView {
  readonly element: HTMLElement
  private readonly viewer: CoreViewer
  private documentUrl: string | null = null
  /** いま組んである文書（まだ組んでいない・組めなかったときは null） */
  html: string | null = null

  constructor(element: HTMLElement) {
    this.element = element
    // - debug: true … 印刷用の printHTML と同じ使い方。すべてのページを組んで画面に残す
    // - pixelRatio: 0 … 画面を拡大して組む仕組みを止め、画面と印刷（PDF）を同じ条件で組む（プレビュー＝提出 PDF）
    this.viewer = new CoreViewer(
      { viewportElement: element, window, debug: true },
      { renderAllPages: true, autoResize: false, pixelRatio: 0 },
    )
  }

  /**
   * まだ組んでいない（組んでいる途中の）部分の、仮のページ（紙面には置かない。ページの数と種類だけを表す。showPlaceholder）。
   * 組み終えるまでは、組んでいる途中のページの代わりにこれを数える（組んでいる途中は、ページが1枚ずつ増え、章の終わりの印もまだ付いていないため）
   */
  private standIns: HTMLElement[] | null = null

  /** この部分のページ（章の終わりの「次の章の始まり」の代わりのページは除く。仮のページを置いていれば、組み終えるまでは仮のページ） */
  pageElements(): HTMLElement[] {
    return this.standIns ?? [...this.element.querySelectorAll<HTMLElement>(`[data-vivliostyle-page-container]:not([${SENTINEL_PAGE_ATTR}])`)]
  }

  /** この部分のページの種類（表紙・本文など） */
  pageKinds(): PageKind[] {
    return this.pageElements().map(pageKind)
  }

  /**
   * まだ組んでいない部分に、仮のページ（中は空）を置く（kinds：ページの種類。数は、前に開いたときのページ数）。
   * はじめて開いたとき、見せるページのある部分を先に組んで見せる間、紙面のページの番号がずれないようにするため（reportRenderer.ts）。
   * 仮のページは紙面（組版エンジンの表示枠）には入れず、ページの一覧（PageView.pages）にだけ出す。この部分を組み終えたら外す（removePlaceholder）
   */
  showPlaceholder(kinds: PageKind[]): void {
    if (this.html !== null || this.element.querySelector('[data-vivliostyle-page-container]')) return
    this.standIns = kinds.map((kind) => {
      const page = document.createElement('div')
      page.setAttribute('data-vivliostyle-page-container', '')
      page.setAttribute(PLACEHOLDER_ATTR, '')
      const section = document.createElement('section')
      section.className = kind
      page.append(section)
      return page
    })
  }

  /** 仮のページを外す（この部分を組み終えたとき・この表示枠が裏に回ったとき） */
  removePlaceholder(): void {
    this.standIns = null
  }

  /** HTML 文書を組版して表示する。かかった時間（ミリ秒）を返す */
  render(html: string): Promise<number> {
    const started = performance.now()
    // 組んでいる途中で失敗したときに、組めていない紙面を使い回さないよう、先に忘れておく
    this.html = null
    // 組版エンジンは処理の区切りごとに console.debug へ記録を出し、大量になると遅くなるため、組版の間だけ止める
    const consoleDebug = console.debug
    console.debug = () => {}
    return new Promise((resolve, reject) => {
      const done = () => {
        console.debug = consoleDebug
        this.viewer.removeListener('readystatechange', onState)
        this.viewer.removeListener('error', onError)
      }
      const onState = () => {
        if (this.viewer.readyState !== 'complete') return
        done()
        this.html = html
        resolve(performance.now() - started)
      }
      const onError = (payload: { content?: { error?: unknown; messages?: unknown } }) => {
        done()
        reject(new Error(String(payload.content?.error ?? payload.content?.messages)))
      }
      this.viewer.addListener('readystatechange', onState)
      this.viewer.addListener('error', onError)
      if (this.documentUrl) URL.revokeObjectURL(this.documentUrl)
      this.documentUrl = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
      this.viewer.loadDocument({ url: this.documentUrl })
    })
  }

  /** 使わなくなった（章が減った）：表示枠から外し、組んだ文書の URL を解放する */
  dispose(): void {
    this.element.remove()
    if (this.documentUrl) URL.revokeObjectURL(this.documentUrl)
    this.documentUrl = null
    this.html = null
    this.standIns = null
  }
}

/** 章を分けて組んだときの、章の終わりの「次の章の始まり」の代わりのページ（表示しない。ページの一覧にも入れない。reportRenderer.ts） */
export const SENTINEL_PAGE_ATTR = 'data-sentinel-page'

/** まだ組んでいない部分の仮のページ（PartView.showPlaceholder）と、その入れ物の印 */
export const PLACEHOLDER_ATTR = 'data-placeholder-page'

/**
 * 紙面の表示枠1つ（報告書の全ページ）。表示された紙面は提出 PDF と同じもの。紙面上の位置と、文書データ（ブロック ID ＋文字位置）を対応づける。
 *
 * 表紙・抄録・目次・本文の各章は、それぞれ改ページで始まり、互いの組み方に影響しないため、
 * 別々の組版エンジン（PartView）で組み、表示枠の中に順に並べる（変わった部分だけ組み直せるように。layout/document.ts の buildReportParts）。
 * 部分の数は章の数で変わる（setPartCount）。ページの一覧（pages）は、表示枠の中のページを報告書の順に並べたもの。
 *
 * 紙面の文字は元の文字列と1文字ずつ対応している（句読点の詰めのために差し込まれる要素は文字を持たない）ため、
 * ブロック内のテキストノードを順にたどれば文字位置が求まる。段落がページをまたぐと、同じ ID の要素が複数できる。
 */
export class PageView {
  readonly viewport: HTMLElement
  /** 部分（表示枠の中に並べた順。初めの3つは表紙・抄録・目次、最後は本文の残りから後ろ、その間は章ごと） */
  readonly parts: PartView[] = []

  constructor(viewport: HTMLElement) {
    this.viewport = viewport
    for (const name of ['cover', 'abstract', 'toc', 'tail']) this.parts.push(this.makePart(name, null))
  }

  private makePart(name: string, before: Element | null): PartView {
    const element = document.createElement('div')
    element.className = 'paper-part'
    element.dataset.part = name
    this.viewport.insertBefore(element, before)
    return new PartView(element)
  }

  /** 部分の数を count（4 以上）にする。章ごとの部分を、最後の部分の前で足す・外す */
  setPartCount(count: number): void {
    const tail = this.parts[this.parts.length - 1]
    while (this.parts.length < count) this.parts.splice(this.parts.length - 1, 0, this.makePart('chapter', tail.element))
    while (this.parts.length > Math.max(4, count)) this.parts.splice(this.parts.length - 2, 1)[0].dispose()
  }

  /** ページの一覧（部分の順。まだ組んでいない・組んでいる途中の部分に仮のページを置いていれば、組み終えるまではそれを数える） */
  pages(): HTMLElement[] {
    return this.parts.flatMap((part) => part.pageElements())
  }

  /**
   * i 番目の部分を、もう一方の表示枠（other）の j 番目の部分と入れ替える（要素ごと移す。組み直さない）。
   * 組み直すとき、表に出ている紙面に同じ文書の部分があれば、組まずにそれを使うため（reportRenderer.ts の swap）。
   * 開いたあと、はじめて書いたときに、もう一方の表示枠が空のため、報告書の全部を組み直していた（スマホでは十数秒）
   */
  exchangePart(i: number, other: PageView, j: number): void {
    const mine = this.parts[i]
    const theirs = other.parts[j]
    if (!mine || !theirs || mine === theirs) return
    const mark = document.createComment('')
    mine.element.replaceWith(mark)
    theirs.element.replaceWith(mine.element)
    mark.replaceWith(theirs.element)
    this.parts[i] = theirs
    other.parts[j] = mine
  }

  /** ブロックの表示要素（ページをまたぐと複数） */
  fragments(blockId: string): HTMLElement[] {
    return [...this.viewport.querySelectorAll<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`)]
  }

  /** 要素が何ページ目（0 から）にあるか。見つからなければ -1 */
  pageIndexOf(element: Element): number {
    const page = element.closest('[data-vivliostyle-page-container]')
    return page ? this.pages().indexOf(page as HTMLElement) : -1
  }

  /** ブロックの文字位置 offset が何ページ目にあるか（段落がページをまたぐときに使う） */
  pageOfOffset(blockId: string, offset: number): number {
    const fragments = this.fragments(blockId)
    let end = 0
    for (const fragment of fragments) {
      end += this.nodesIn(fragment).reduce((n, t) => n + t.length, 0)
      if (offset < end) return this.pageIndexOf(fragment)
    }
    return fragments.length ? this.pageIndexOf(fragments[fragments.length - 1]) : -1
  }

  /** ブロックの中で、fragment より前（前のページ）にある文字数 */
  charsBefore(blockId: string, fragment: HTMLElement): number {
    let count = 0
    for (const f of this.fragments(blockId)) {
      if (f === fragment) return count
      count += this.nodesIn(f).reduce((n, t) => n + t.length, 0)
    }
    return count
  }

  private nodesIn(el: HTMLElement): Text[] {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    while (walker.nextNode()) nodes.push(walker.currentNode as Text)
    return nodes
  }

  private textNodes(blockId: string): Text[] {
    return this.fragments(blockId).flatMap((el) => this.nodesIn(el))
  }

  /** 画面上の点から、ブロック ID と文字位置を求める */
  offsetFromPoint(x: number, y: number): { blockId: string; offset: number } | null {
    const pos = document.caretPositionFromPoint?.(x, y)
    const node = pos?.offsetNode
    const element = node instanceof Element ? node : node?.parentElement
    const block = element?.closest<HTMLElement>('[data-block-id]')
    if (!pos || !node || !block) return null
    const blockId = block.dataset.blockId!
    let offset = 0
    for (const text of this.textNodes(blockId)) {
      if (text === node) return { blockId, offset: offset + pos.offset }
      offset += text.length
    }
    return { blockId, offset: 0 }
  }

  /**
   * ブロック内の文字範囲を、テキストノードごとの Range に分けて返す。
   * ページをまたぐ範囲を1つの Range にすると、間にあるページ番号なども含んでしまうため。
   */
  ranges(blockId: string, start: number, end: number): Range[] {
    const result: Range[] = []
    let offset = 0
    for (const text of this.textNodes(blockId)) {
      const from = Math.max(start, offset)
      const to = Math.min(end, offset + text.length)
      if (from < to) {
        const range = document.createRange()
        range.setStart(text, from - offset)
        range.setEnd(text, to - offset)
        result.push(range)
      }
      offset += text.length
    }
    return result
  }
}
