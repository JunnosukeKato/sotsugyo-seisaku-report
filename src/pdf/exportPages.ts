import type { LayoutInfo } from '../layout/measure'
import type { Report } from '../model/types'

/**
 * PDF に入れないページ（「PDFを書き出す」の窓で作る PDF・印刷の画面から保存・ブラウザの印刷（Ctrl+P）で同じにする）。
 * 作品写真をまだ1枚も入れていなければ、空の作品写真のページは入れない（書いている途中の PDF を先生に見せるときに、空のページが出ないように。
 * 前は下書きの PDF だけの決まりだった。下書きをなくして、PDF を1つにした：依頼者の判断 2026-10-19）。
 * 抄録を書き始める前の抄録のページは、もとから .print-skip が付いていて入らない（ここでは数えない）
 */
export function skippedPages(pages: HTMLElement[], report: Report, layout: LayoutInfo | null): HTMLElement[] {
  const photos = report.workPhotos.imageIds.slice(0, report.workPhotos.layout).filter(Boolean)
  if (photos.length > 0 || !layout) return []
  return pages.filter((_, i) => layout.kinds[i] === 'photos')
}
