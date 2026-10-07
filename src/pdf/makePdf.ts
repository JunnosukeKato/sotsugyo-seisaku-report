import { findCourse, type YearConfig } from '../config'
import { loadConfig, loadYearConfig } from '../config/remote'
import { ReportRenderer, type ImageSources } from '../editor/reportRenderer'
import { fitFigureSize } from '../model/images'
import { allImages, loadReport, type StoredImage } from '../model/storage'
import type { Report } from '../model/types'
import { pagesToPdf, type CapturedPage, type PagesToPdfOptions, type PagesToPdfResult } from './pagesToPdf'
import { demoSample, longSample } from './samples'

/**
 * PDF の試し（pdf-test.html）の中身：原稿を組版し、紙面を画像にして PDF にする。
 * 組版は学生用ツールと同じ部品（ReportRenderer）で行う。組版した紙面は、画面の左上に透明にして置く（見えない。pdfTest.css）。
 */

export type SourceKind = 'demo' | 'long' | 'mine'

export interface Manuscript {
  report: Report
  images: StoredImage[]
  config: YearConfig
}

/** 図の大きさの上限（学生用ツールの reportEditor.ts と同じ） */
const FIGURE_MAX_MM = 80
/** 写真が見つからないときの灰色の四角（学生用ツールと同じ） */
const PLACEHOLDER_IMAGE =
  'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#e4e4e4"/></svg>')

let configCache: Promise<YearConfig> | null = null
const publishedConfig = () => (configCache ??= loadConfig().then((r) => r.config))

/** この端末に保存されている原稿（なければ null） */
export async function loadMine(): Promise<{ report: Report; images: StoredImage[] } | null> {
  const report = await loadReport()
  return report ? { report, images: await allImages() } : null
}

/** 原稿を用意する（自分の原稿は、書き始めた年度の設定で組む。学生用ツールと同じ） */
export async function loadManuscript(kind: SourceKind): Promise<Manuscript> {
  const published = await publishedConfig()
  if (kind === 'mine') {
    const mine = await loadMine()
    if (!mine) throw new Error('この端末には、まだ原稿が保存されていません')
    const yearConfig = mine.report.fiscalYear !== published.fiscalYear ? await loadYearConfig(mine.report.fiscalYear) : null
    const courseId = mine.report.basicInfo.courseId
    const config = yearConfig && (!courseId || findCourse(yearConfig, courseId)) ? yearConfig : published
    return { ...mine, config }
  }
  const sample = kind === 'long' ? await longSample() : await demoSample()
  return { ...sample, config: published }
}

/** PDF のファイル名のもと（学生用ツールの「PDFを書き出す」と同じ形） */
export function pdfTitle({ report, config }: Manuscript, draft: boolean): string {
  const { studentId, name } = report.basicInfo
  const base = [String(config.fiscalYear), config.reportName, studentId.trim(), name.replace(/[\s　]/g, '')].filter(Boolean).join('_')
  return draft ? `${base}_下書き` : base
}

export interface MakePdfResult extends PagesToPdfResult {
  /** 組版にかかった時間（ミリ秒） */
  composeMs: number
  /** 組版したページ数（PDF に入れないページも数える） */
  composedPages: number
  title: string
}

/** 進み具合：組版している／画像にしている（done＝total になったら、PDF にまとめている） */
export type Progress = { step: 'compose' } | { step: 'capture'; done: number; total: number }

let renderer: ReportRenderer | null = null

/** 原稿を組版し、紙面を画像にして PDF にする。paper：組版した紙面を置く要素（画面の外） */
export async function makePdf(
  paper: HTMLElement,
  manuscript: Manuscript,
  options: Omit<PagesToPdfOptions, 'title' | 'onPage'> & { onProgress?: (p: Progress) => void; onPage?: (page: CapturedPage) => void | Promise<void> },
): Promise<MakePdfResult> {
  const { report, images, config } = manuscript
  const { onProgress, onPage, ...pdfOptions } = options
  onProgress?.({ step: 'compose' })
  const urls = new Map(images.map((img) => [img.id, { url: URL.createObjectURL(img.blob), widthPx: img.widthPx, heightPx: img.heightPx }]))
  const sources: ImageSources = {
    imageSrc: (id) => urls.get(id)?.url ?? PLACEHOLDER_IMAGE,
    photoSrc: (id) => urls.get(id)?.url ?? PLACEHOLDER_IMAGE,
    figureSize: (f) => {
      const img = urls.get(f.imageId)
      return img ? fitFigureSize(img, FIGURE_MAX_MM) : { widthMm: 60, heightMm: 45 }
    },
  }
  try {
    const composeStarted = performance.now()
    renderer ??= new ReportRenderer(paper)
    const { layout } = await renderer.renderBack(report, config, sources)
    renderer.swap(0)
    const pages = renderer.pageView.pages()
    // 抄録を書き始めるまでは、抄録のページを PDF に入れない（学生用ツールと同じ）
    const skip = report.abstract.started === false
    pages.forEach((page, i) => page.classList.toggle('print-skip', skip && layout.kinds[i] === 'abstract'))
    const composeMs = performance.now() - composeStarted
    const title = pdfTitle(manuscript, !!pdfOptions.draft)
    onProgress?.({ step: 'capture', done: 0, total: pages.filter((p) => !p.classList.contains('print-skip')).length })
    const result = await pagesToPdf(pages, {
      ...pdfOptions,
      title,
      onPage: async (page) => {
        onProgress?.({ step: 'capture', done: page.index + 1, total: page.total })
        await onPage?.(page)
      },
    })
    return { ...result, composeMs, composedPages: pages.length, title }
  } finally {
    for (const { url } of urls.values()) URL.revokeObjectURL(url)
  }
}
