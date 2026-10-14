import { photoPixels } from './pageFit'

/**
 * 提出前チェック：作品写真（JPEG・PNG・端末が読めれば HEIC）を、A4 の1ページに置くための JPEG にする。
 * ブラウザで読み（写真の向き（Exif）も直す）、大きすぎる写真は A4 で約 200dpi になる大きさまで縮める。白い紙に置く。
 * 読めない形（パソコンの Chrome・Edge の HEIC など）は PhotoError
 */

export class PhotoError extends Error {
  name = 'PhotoError'
}

export interface PreparedPhoto {
  bytes: Uint8Array
  width: number
  height: number
  /** 画面に出す絵の URL（使い終えたら解放する） */
  url: string
}

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    const heic = /\.(heic|heif)$/i.test(file.name) || /hei[cf]/i.test(file.type)
    throw new PhotoError(
      heic
        ? 'この写真（HEIC）は、このブラウザでは読めません。JPEG にしてから入れてください（iPhone は「設定 → カメラ → フォーマット → 互換性優先」で、JPEG で撮れます）。'
        : 'この写真を読めませんでした。JPEG か PNG にしてから入れてください。',
    )
  }
  try {
    const { width, height } = photoPixels(bitmap.width, bitmap.height)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new PhotoError('この端末では、写真を PDF のページにできませんでした。')
    // 透過の PNG は白い紙に置く
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    canvas.width = canvas.height = 0
    if (!blob) throw new PhotoError('この端末では、写真を PDF のページにできませんでした。')
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height, url: URL.createObjectURL(blob) }
  } finally {
    bitmap.close()
  }
}
