import { CoreViewer } from '@vivliostyle/core'

/**
 * 組版エンジン（Vivliostyle）で紙面を表示する。
 * 表示された紙面は提出 PDF と同じもの。紙面上の位置と、文書データ（ブロック ID ＋文字位置）を対応づける。
 *
 * 紙面の文字は元の文字列と1文字ずつ対応している（句読点の詰めのために差し込まれる要素は文字を持たない）ため、
 * ブロック内のテキストノードを順にたどれば文字位置が求まる。段落がページをまたぐと、同じ ID の要素が複数できる。
 */
export class PageView {
  readonly viewport: HTMLElement
  private readonly viewer: CoreViewer
  private documentUrl: string | null = null

  constructor(viewport: HTMLElement) {
    this.viewport = viewport
    // - debug: true … 印刷用の printHTML と同じ使い方。すべてのページを組んで画面に残す
    // - pixelRatio: 0 … 画面を拡大して組む仕組みを止め、画面と印刷（PDF）を同じ条件で組む（プレビュー＝提出 PDF）
    this.viewer = new CoreViewer(
      { viewportElement: viewport, window, debug: true },
      { renderAllPages: true, autoResize: false, pixelRatio: 0 },
    )
  }

  /** HTML 文書を組版して表示する。かかった時間（ミリ秒）を返す */
  render(html: string): Promise<number> {
    const started = performance.now()
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

  pages(): HTMLElement[] {
    return [...this.viewport.querySelectorAll<HTMLElement>('[data-vivliostyle-page-container]')]
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
