import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { readPdf } from './pdfFacts'

/**
 * 提出前チェック：ブラウザの中で PDF を読む部品（pdf.js）。重いので、PDF を入れたときに初めて読み込む（check/CheckApp.tsx）。
 * 読む手伝いをする部品（worker）は、このページと同じ場所から読む（ほかの場所には取りに行かない）
 */
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/**
 * 読む手伝いをする部品（worker）は、1つを使い回す（PDF を入れるたびに作ると、そのたびに部品を読み込み直して遅くなる）。
 * PDF を外しても（loadingTask.destroy）、使い回す部品は止まらない
 */
let worker: pdfjs.PDFWorker | null = null

/** PDF を読む（pdfFacts.ts の readPdf に、ブラウザの pdf.js を渡す） */
export const readPdfInBrowser = (bytes: Uint8Array) => readPdf(bytes, pdfjs, (worker ??= new pdfjs.PDFWorker()))

/**
 * ページの小さな絵（幅 width 点の JPEG の URL。使い終えたら URL.revokeObjectURL で解放する）。
 * intent: 'print' は、画面が隠れていても描くのを止めない
 */
export async function pageThumbnail(doc: PDFDocumentProxy, pageNumber: number, width: number): Promise<string> {
  const page = await doc.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: width / base.width })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width)
  canvas.height = Math.round(viewport.height)
  try {
    await page.render({ canvas, viewport, intent: 'print', background: '#ffffff' }).promise
    return await new Promise<string>((resolve) => canvas.toBlob((b) => resolve(b ? URL.createObjectURL(b) : ''), 'image/jpeg', 0.82))
  } finally {
    // 絵を作る作業の場所は、すぐ解放する（スマホでメモリが足りなくならないように）
    canvas.width = canvas.height = 0
    page.cleanup()
  }
}
