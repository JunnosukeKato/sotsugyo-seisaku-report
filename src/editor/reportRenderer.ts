import type { YearConfig } from '../config'
import type { FigureSize } from '../layout/bodyHtml'
import { buildReportDocument } from '../layout/document'
import { FONT_SIZE_PT } from '../layout/documentCss'
import { reviseDeferredGroups, sameSet } from '../layout/figureFloat'
import { measureLayout, samePageNumbers, type LayoutInfo } from '../layout/measure'
import type { Figure, Report } from '../model/types'
import { PageView } from './pageView'

export interface ImageSources {
  imageSrc: (imageId: string) => string
  photoSrc: (imageId: string) => string
  figureSize: (figure: Figure) => FigureSize
}

export type PageEffect = 'turn' | 'fade' | 'none'

/** 組み直しの上限（図の送り方と目次のページ番号が落ち着くまで） */
const MAX_PASSES = 4

/** ページを送る動きのクラス（終わったら外す） */
const MOTION_CLASSES = ['is-under', 'is-under-current', 'turn-out', 'turn-in', 'fade-out', 'fade-in']

/**
 * 報告書全体を組版し、紙面を1ページずつ表示する。
 *
 * 画面のちらつきを防ぐため、紙面の表示枠を2つ持つ（ダブルバッファ）。
 * 見えていない側で組み直し（renderBack）、組み終わったら表と裏を入れ替える（swap）。
 * 組版の間は、組版エンジンが寸法を測れるよう、裏側のすべてのページを表示しておく（.measuring）。
 * 目次のページ番号は組版した結果から読み取るため、番号が変わったときだけもう一度組み直す。
 * 段落のすぐ下に入りきらない図は次のページの上へ送る（figureFloat.ts）。送る図が変わったときも組み直す。
 */
export class ReportRenderer {
  private readonly buffers: [{ element: HTMLElement; view: PageView }, { element: HTMLElement; view: PageView }]
  private frontIndex = 0
  private tocPageNumbers: Record<string, number> = {}
  /** 前に組んだときに次のページへ送った図のまとまり（たいていそのままでよいので、次もここから始める） */
  private deferredGroups = new Set<string>()

  constructor(container: HTMLElement) {
    const make = () => {
      const element = document.createElement('div')
      element.className = 'page-viewport'
      container.append(element)
      return { element, view: new PageView(element) }
    }
    this.buffers = [make(), make()]
    this.buffers[0].element.classList.add('front')
    hideBack(this.buffers[1].element, true)
  }

  /** いま見えている紙面 */
  get pageView(): PageView {
    return this.buffers[this.frontIndex].view
  }

  get viewport(): HTMLElement {
    return this.buffers[this.frontIndex].element
  }

  /** 見えていない側で組版し、紙面の情報を測る（まだ表には出さない） */
  async renderBack(report: Report, config: YearConfig, sources: ImageSources): Promise<{ ms: number; layout: LayoutInfo }> {
    const back = this.buffers[1 - this.frontIndex]
    back.element.classList.add('measuring')
    try {
      const groupIds = new Set(report.body.flatMap((c) => c.blocks).filter((b) => b.type === 'figureRow').map((b) => b.id))
      let deferred = new Set([...this.deferredGroups].filter((id) => groupIds.has(id)))
      const build = () => buildReportDocument(report, config, { ...sources, tocPageNumbers: this.tocPageNumbers, deferredGroups: deferred })
      // 文字の範囲ごとに分かれたフォントを、組版の前に読み込んでおく（後から読み込まれると改行位置がずれる）
      const text = build().replace(/<[^>]+>/g, '') + '0123456789'
      await Promise.all([
        document.fonts.load(`${FONT_SIZE_PT}pt "BIZ UDMincho"`, text),
        document.fonts.load(`${FONT_SIZE_PT}pt "BIZ UDPGothic"`, text),
      ])
      let ms = 0
      let layout: LayoutInfo
      const blocked = new Set<string>()
      let fallback = false
      for (let pass = 1; ; pass++) {
        ms += await back.view.render(build())
        layout = measureLayout(back.view.pages(), report.body)
        const tocChanged = !samePageNumbers(layout.tocPageNumbers, this.tocPageNumbers)
        if (tocChanged) this.tocPageNumbers = layout.tocPageNumbers
        let next = fallback ? deferred : reviseDeferredGroups(back.view.pages(), report.body, deferred, blocked)
        // 図の送り方が落ち着かないときは、送るのをやめて段落のすぐ下に置く（ページの下に空白が残るだけで、順番は崩れない）
        if (!fallback && pass >= MAX_PASSES && !sameSet(next, deferred)) {
          fallback = true
          next = new Set()
        }
        if ((sameSet(next, deferred) && !tocChanged) || pass >= MAX_PASSES + 2) break
        deferred = next
      }
      this.deferredGroups = deferred
      return { ms, layout }
    } finally {
      back.element.classList.remove('measuring')
    }
  }

  /** 組み終えた裏側を表に出し、page ページ目（0 から）を見せる */
  swap(page: number): void {
    const back = this.buffers[1 - this.frontIndex]
    const front = this.buffers[this.frontIndex]
    this.setCurrent(back.view, page)
    back.element.classList.add('front')
    front.element.classList.remove('front')
    hideBack(back.element, false)
    hideBack(front.element, true)
    this.frontIndex = 1 - this.frontIndex
  }

  pageCount(): number {
    return this.pageView.pages().length
  }

  /** 表の紙面で page ページ目を見せる（動きなし。fade なら、ふわっと出す） */
  show(page: number, effect: 'none' | 'fade' = 'none'): void {
    this.setCurrent(this.pageView, page)
    if (effect === 'fade' && !reducedMotion()) {
      const el = this.pageView.pages()[page]
      el?.classList.add('fade-in')
      el?.addEventListener('animationend', () => el.classList.remove('fade-in'), { once: true })
    }
  }

  private setCurrent(view: PageView, page: number): void {
    view.pages().forEach((p, i) => {
      p.classList.remove(...MOTION_CLASSES)
      p.classList.toggle('is-current', i === page)
    })
  }

  /**
   * ページを送る。隣のページは本のようにめくり、離れたページへはふわっと切り替える。
   * 動きが終わったら解決する。
   */
  turn(from: number, to: number, effect: PageEffect): Promise<void> {
    const view = this.pageView
    const pages = view.pages()
    const a = pages[from]
    const b = pages[to]
    if (!a || !b || effect === 'none' || reducedMotion()) {
      this.setCurrent(view, to)
      return Promise.resolve()
    }
    let moving: HTMLElement
    if (effect === 'fade' || Math.abs(to - from) !== 1) {
      b.classList.add('is-under')
      a.classList.add('fade-out')
      moving = a
    } else if (to > from) {
      // 今のページが右端から持ち上がり、左へめくれて、下の次のページが見える
      b.classList.add('is-under')
      a.classList.add('turn-out')
      moving = a
    } else {
      // 前のページが左からめくれて戻ってくる
      a.classList.add('is-under-current')
      b.classList.add('turn-in')
      moving = b
    }
    return new Promise((resolve) => {
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        moving.removeEventListener('animationend', onEnd)
        this.setCurrent(view, to)
        resolve()
      }
      // ページの影（::after）の動きの終わりも届くため、ページ本体の動きの終わりだけを見る
      const onEnd = (e: AnimationEvent) => {
        if (e.target === moving && !e.pseudoElement) finish()
      }
      moving.addEventListener('animationend', onEnd)
      setTimeout(finish, 1500)
    })
  }
}

/**
 * 裏側の表示枠（見えていない・古い内容のこともある）を、読み上げにも Tab にも出さない。
 * 出しておくと、読み上げで紙面が2回（片方は古い内容で）読まれてしまう
 */
function hideBack(element: HTMLElement, hidden: boolean): void {
  element.inert = hidden
  if (hidden) element.setAttribute('aria-hidden', 'true')
  else element.removeAttribute('aria-hidden')
}

function reducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches
}
