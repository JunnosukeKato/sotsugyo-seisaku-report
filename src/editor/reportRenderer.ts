import type { YearConfig } from '../config'
import type { FigureSize } from '../layout/bodyHtml'
import { buildReportDocument } from '../layout/document'
import { FONT_SIZE_PT } from '../layout/documentCss'
import { measureLayout, samePageNumbers, type LayoutInfo } from '../layout/measure'
import type { Figure, Report } from '../model/types'
import { PageView } from './pageView'

export interface ImageSources {
  imageSrc: (imageId: string) => string
  photoSrc: (imageId: string) => string
  figureSize: (figure: Figure) => FigureSize
}

/**
 * 報告書全体を組版して紙面に表示する。
 *
 * 画面のちらつきを防ぐため、紙面の表示枠を2つ持つ（ダブルバッファ）。
 * 見えていない側で組み直し、組み終わった瞬間に表と裏を入れ替える。
 * 目次のページ番号は組版した結果から読み取るため、番号が変わったときだけもう一度組み直す。
 */
export class ReportRenderer {
  private readonly buffers: [{ element: HTMLElement; view: PageView }, { element: HTMLElement; view: PageView }]
  private frontIndex = 0
  private tocPageNumbers: Record<string, number> = {}
  layout: LayoutInfo | null = null

  constructor(container: HTMLElement) {
    const make = () => {
      const element = document.createElement('div')
      element.className = 'page-viewport'
      container.append(element)
      return { element, view: new PageView(element) }
    }
    this.buffers = [make(), make()]
    this.buffers[0].element.classList.add('front')
  }

  /** いま見えている紙面 */
  get pageView(): PageView {
    return this.buffers[this.frontIndex].view
  }

  get viewport(): HTMLElement {
    return this.buffers[this.frontIndex].element
  }

  async render(report: Report, config: YearConfig, sources: ImageSources): Promise<{ ms: number; layout: LayoutInfo }> {
    const back = this.buffers[1 - this.frontIndex]
    const build = () => buildReportDocument(report, config, { ...sources, tocPageNumbers: this.tocPageNumbers })
    let html = build()
    // 文字の範囲ごとに分かれたフォントを、組版の前に読み込んでおく（後から読み込まれると改行位置がずれる）
    const text = html.replace(/<[^>]+>/g, '') + '0123456789'
    await Promise.all([
      document.fonts.load(`${FONT_SIZE_PT}pt "BIZ UDMincho"`, text),
      document.fonts.load(`${FONT_SIZE_PT}pt "BIZ UDPGothic"`, text),
    ])
    let ms = await back.view.render(html)
    let layout = measureLayout(back.view.pages(), report.body)
    if (!samePageNumbers(layout.tocPageNumbers, this.tocPageNumbers)) {
      this.tocPageNumbers = layout.tocPageNumbers
      html = build()
      ms += await back.view.render(html)
      layout = measureLayout(back.view.pages(), report.body)
    }
    // 表と裏を入れ替える（スクロールの位置は引き継ぐ）
    const front = this.buffers[this.frontIndex]
    back.element.scrollTop = front.element.scrollTop
    back.element.scrollLeft = front.element.scrollLeft
    back.element.classList.add('front')
    front.element.classList.remove('front')
    this.frontIndex = 1 - this.frontIndex
    this.layout = layout
    return { ms, layout }
  }
}
