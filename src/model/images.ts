import type { StoredImage } from './storage'

/**
 * 写真の取り込み。大きすぎる写真は、印刷に十分な大きさまで自動で縮小・圧縮する
 * （手順書の「データが大きすぎてパソコンがフリーズする恐れ」への対策。PDF のファイルサイズも抑える）。
 * スマートフォンで撮った写真の向き（EXIF）は、正しい向きに直して取り込む。
 */

/** 本文の図：最大 100mm を約 400dpi で印刷できる大きさ */
export const FIGURE_MAX_PX = 1600
/** 作品写真：A4 の全面に約 200dpi で印刷できる大きさ */
export const PHOTO_MAX_PX = 2400
const JPEG_QUALITY = 0.88

export async function importImage(file: Blob, id: string, maxLongEdgePx: number): Promise<StoredImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxLongEdgePx / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  // 透過 PNG（デザイン画など）は白地に置く
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY })
  return { id, blob, widthPx: width, heightPx: height }
}

/** 図の表示サイズ：縦横比を保って、最大 maxMm 四方（手順書は 100mm×100mm 以内）に収める */
export function fitFigureSize(image: Pick<StoredImage, 'widthPx' | 'heightPx'>, maxMm: number): { widthMm: number; heightMm: number } {
  const ratio = image.widthPx / image.heightPx
  return ratio >= 1
    ? { widthMm: maxMm, heightMm: Math.round((maxMm / ratio) * 10) / 10 }
    : { widthMm: Math.round(maxMm * ratio * 10) / 10, heightMm: maxMm }
}

/** 印刷したときの解像度（dpi）。作品写真の解像度不足の警告に使う */
export function printDpi(image: Pick<StoredImage, 'widthPx' | 'heightPx'>, widthMm: number, heightMm: number): number {
  return Math.min(image.widthPx / (widthMm / 25.4), image.heightPx / (heightMm / 25.4))
}
