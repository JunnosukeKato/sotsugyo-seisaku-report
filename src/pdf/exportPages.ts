import type { LayoutInfo } from '../layout/measure'
import { pagePhotoCount } from '../model/photos'
import type { Report } from '../model/types'

/**
 * PDF に入れないページ（「PDFを書き出す」の窓で作る PDF・印刷の画面から保存・ブラウザの印刷（Ctrl+P）で同じにする）。
 * 写真が1枚も入っていない作品写真のページは入れない（書いている途中の PDF を先生に見せるときに、空のページが出ないように。
 * 前は下書きの PDF だけの決まりだった。下書きをなくして、PDF を1つにした：依頼者の判断 2026-10-19）。
 * 作品写真が何ページかあるとき（mockups/v38 案A）も、ページごとに同じ（足したまま空のページは入れない。チェックの「まだのところ」で知らせる）。
 * 抄録を書き始める前の抄録のページは、もとから .print-skip が付いていて入らない（ここでは数えない）
 */
export function skippedPages(pages: HTMLElement[], report: Report, layout: LayoutInfo | null): HTMLElement[] {
  if (!layout) return []
  let k = -1
  return pages.filter((_, i) => {
    if (layout.kinds[i] !== 'photos') return false
    const page = report.workPhotos[++k]
    return !page || pagePhotoCount(page) === 0
  })
}
