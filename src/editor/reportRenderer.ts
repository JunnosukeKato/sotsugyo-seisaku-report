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
 * 目次のページ番号は組版した結果から読み取るため、番号が変わったときだけもう一度組み直す。
 */
export class ReportRenderer {
  readonly pageView: PageView
  private tocPageNumbers: Record<string, number> = {}
  layout: LayoutInfo | null = null

  constructor(viewport: HTMLElement) {
    this.pageView = new PageView(viewport)
  }

  async render(report: Report, config: YearConfig, sources: ImageSources): Promise<{ ms: number; layout: LayoutInfo }> {
    const build = () => buildReportDocument(report, config, { ...sources, tocPageNumbers: this.tocPageNumbers })
    let html = build()
    // 文字の範囲ごとに分かれたフォントを、組版の前に読み込んでおく（後から読み込まれると改行位置がずれる）
    const text = html.replace(/<[^>]+>/g, '') + '0123456789'
    await Promise.all([
      document.fonts.load(`${FONT_SIZE_PT}pt "BIZ UDMincho"`, text),
      document.fonts.load(`${FONT_SIZE_PT}pt "BIZ UDPGothic"`, text),
    ])
    let ms = await this.pageView.render(html)
    let layout = measureLayout(this.pageView.pages(), report.body)
    if (!samePageNumbers(layout.tocPageNumbers, this.tocPageNumbers)) {
      this.tocPageNumbers = layout.tocPageNumbers
      html = build()
      ms += await this.pageView.render(html)
      layout = measureLayout(this.pageView.pages(), report.body)
    }
    this.layout = layout
    return { ms, layout }
  }
}
