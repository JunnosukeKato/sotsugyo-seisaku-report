import { deviceName } from '../drive/device'
import { pagesToPdf, type CapturedPage } from './pagesToPdf'

/**
 * 「PDFを書き出す」で、印刷の画面を通さずに PDF を作って保存する（mockups/v28 案C）。
 * 紙面の各ページを画像にして A4 の PDF にまとめる（pagesToPdf.ts。文字は選べないが、見た目は印刷と同じ）。
 * パソコン・Android は、できたらそのまま保存する（a[download]）。iPhone・iPad は、できたあとに「保存する」を押してもらい、
 * 共有の画面（navigator.share）から「"ファイル"に保存」する（共有の画面は、押した直後にしか開けないため。作るのに数秒かかる）
 */

/** できた PDF（ファイル名とともに、1か所にまとめて持つ。あとで先生のドライブに送るときも、作り直さずにこれを使う） */
export interface BuiltPdf {
  blob: Blob
  /** ファイル名（例：2026_卒業制作報告書_00ZZ0123_文化花子.pdf。下書きは _下書き を付ける） */
  fileName: string
  pageCount: number
  draft: boolean
  /** 開く・保存するための URL（使い終えたら URL.revokeObjectURL で解放する） */
  url: string
}

/** 保存のしかた：share（iPhone・iPad。できたあとに「保存する」を押して共有の画面から）／download（パソコン・Android。そのまま保存） */
export type SaveMode = 'share' | 'download'

/** この端末の保存のしかた（iPad は、Mac のふりをしていても、指で触れる画面なら iPad と見なす。drive/device.ts） */
export function saveMode(): SaveMode {
  return /^(iPhone|iPad)/.test(deviceName()) ? 'share' : 'download'
}

/**
 * 紙面のページを PDF にする。title：ファイル名のもと（拡張子なし）。onPage：1ページできるたびに呼ぶ（縮小の絵を作る）。
 * signal でやめると、ページとページの間で止まる
 */
export async function buildPdf(pages: HTMLElement[], options: { title: string; draft: boolean; signal?: AbortSignal; onPage?: (page: CapturedPage) => void | Promise<void> }): Promise<BuiltPdf> {
  const { title, draft, signal, onPage } = options
  const result = await pagesToPdf(pages, { title, draft, signal, onPage })
  return { blob: result.blob, fileName: `${title}.pdf`, pageCount: result.pageCount, draft, url: URL.createObjectURL(result.blob) }
}

/** そのまま保存する（パソコン・Android は「ダウンロード」のフォルダへ。iPhone・iPad では、ダウンロードの確認が出る） */
export function downloadPdf(pdf: BuiltPdf): void {
  const a = document.createElement('a')
  a.href = pdf.url
  a.download = pdf.fileName
  a.rel = 'noopener'
  a.click()
}

/**
 * iPhone・iPad：共有の画面を開いて保存してもらう。押した処理の中で、すぐ呼ぶこと（間に時間のかかる処理を挟むと、共有の画面が開かない）。
 * 結果：shared（共有した）／cancelled（共有の画面でやめた。もう一度押せる）／fallback（共有の画面が使えない・開けなかったので、ダウンロードした）
 */
export async function sharePdf(pdf: BuiltPdf): Promise<'shared' | 'cancelled' | 'fallback'> {
  const file = new File([pdf.blob], pdf.fileName, { type: 'application/pdf' })
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: pdf.fileName })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      // そのほかの理由で開けなかったときは、下でダウンロードする
    }
  }
  downloadPdf(pdf)
  return 'fallback'
}

/** できたページの縮小の絵（幅 120 点の JPEG の URL。使い終えたら解放する）。PDF に入れるのと同じ画像を縮める */
export function thumbnail(canvas: HTMLCanvasElement): Promise<string> {
  const small = document.createElement('canvas')
  small.width = 120
  small.height = Math.round((120 * canvas.height) / canvas.width)
  small.getContext('2d')!.drawImage(canvas, 0, 0, small.width, small.height)
  return new Promise((resolve) =>
    small.toBlob(
      (b) => {
        small.width = small.height = 0
        resolve(b ? URL.createObjectURL(b) : '')
      },
      'image/jpeg',
      0.8,
    ),
  )
}

/** ファイルの大きさ（例：2.9MB・640KB） */
export function sizeText(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(bytes / 1024))}KB`
}
