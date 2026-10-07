import { FIGURE_MAX_PX } from '../model/images'
import type { StoredImage } from '../model/storage'

/**
 * Word の中の画像（word/media の中身）を、ツールの画像にする。
 * 考え方は model/images.ts の importImage と同じ：大きすぎる画像は、印刷に十分な大きさ（図は長い辺 1600px）まで縮め、
 * JPEG にして保存する（透過は白地に置く。スマホで撮った写真の向き（EXIF）は正しい向きに直す）。
 * Word で画像を切り抜いていた（トリミング）ときは、切り抜いたところだけを使う。
 */

/** 画像の形（ファイルの頭の数バイトで見分ける） */
export type ImageKind = 'png' | 'jpeg' | 'gif' | 'bmp' | 'webp' | 'tiff' | 'emf' | 'wmf' | 'heic' | 'svg' | 'unknown'

/** ブラウザで読める形（パソコンでもスマホでも） */
const BROWSER_KINDS: ImageKind[] = ['png', 'jpeg', 'gif', 'bmp', 'webp']

const MIME: Partial<Record<ImageKind, string>> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp' }

/** 学生に伝える形の名前（使えない形のとき） */
export const KIND_NAMES: Record<ImageKind, string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  gif: 'GIF',
  bmp: 'BMP',
  webp: 'WebP',
  tiff: 'TIFF',
  emf: 'EMF',
  wmf: 'WMF',
  heic: 'HEIC',
  svg: 'SVG',
  unknown: '不明な形',
}

/** Word の切り抜き（a:srcRect）。上下左右から切り取る割合（0〜1） */
export interface Crop {
  left: number
  top: number
  right: number
  bottom: number
}

export interface ImageInfo {
  kind: ImageKind
  /** 分かったときだけ（ファイルの頭から読む） */
  width?: number
  height?: number
}

const ascii = (b: Uint8Array, start: number, length: number) => String.fromCharCode(...b.subarray(start, start + length))
const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1]
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8)
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
const u32le = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0
const i32le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)

/** 画像の形と大きさ（px）を、ファイルの頭から読む */
export function imageInfo(b: Uint8Array): ImageInfo {
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') return { kind: 'png', width: u32be(b, 16), height: u32be(b, 20) }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) return { kind: 'jpeg', ...jpegSize(b) }
  if (b.length >= 10 && ascii(b, 0, 3) === 'GIF') return { kind: 'gif', width: u16le(b, 6), height: u16le(b, 8) }
  if (b.length >= 26 && ascii(b, 0, 2) === 'BM') return { kind: 'bmp', width: Math.abs(i32le(b, 18)), height: Math.abs(i32le(b, 22)) }
  if (b.length >= 30 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return { kind: 'webp', ...webpSize(b) }
  if (b.length >= 4 && (ascii(b, 0, 4) === 'II*\0' || ascii(b, 0, 4) === 'MM\0*')) return { kind: 'tiff' }
  if (b.length >= 44 && u32le(b, 0) === 1 && ascii(b, 40, 4) === ' EMF') return { kind: 'emf' }
  if (b.length >= 4 && (u32le(b, 0) === 0x9ac6cdd7 || ((u16le(b, 0) === 1 || u16le(b, 0) === 2) && u16le(b, 2) === 9))) return { kind: 'wmf' }
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif)/.test(ascii(b, 8, 4))) return { kind: 'heic' }
  const head = new TextDecoder().decode(b.subarray(0, 256)).trimStart()
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return { kind: 'svg' }
  return { kind: 'unknown' }
}

function jpegSize(b: Uint8Array): { width?: number; height?: number } {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return {}
    const marker = b[i + 1]
    // SOF0〜SOF15（DHT・JPG・DAC を除く）に大きさがある
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: u16be(b, i + 5), width: u16be(b, i + 7) }
    i += 2 + u16be(b, i + 2)
  }
  return {}
}

function webpSize(b: Uint8Array): { width?: number; height?: number } {
  const chunk = ascii(b, 12, 4)
  if (chunk === 'VP8 ') return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }
  if (chunk === 'VP8L') {
    const bits = u32le(b, 21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
  return {}
}

/** ブラウザで読める形か */
export function browserReadable(kind: ImageKind): boolean {
  return BROWSER_KINDS.includes(kind)
}

const JPEG_QUALITY = 0.88

/** 切り抜きの割合を 0〜1 に収める（Word は負の値で余白を表すことがある） */
function clampCrop(crop: Crop | null | undefined): Crop {
  const c = (v: number | undefined) => Math.min(0.95, Math.max(0, Number.isFinite(v) ? (v as number) : 0))
  const result = { left: c(crop?.left), top: c(crop?.top), right: c(crop?.right), bottom: c(crop?.bottom) }
  // 左右・上下を合わせて切り取りすぎるときは、切り抜かない
  if (result.left + result.right >= 0.95) result.left = result.right = 0
  if (result.top + result.bottom >= 0.95) result.top = result.bottom = 0
  return result
}

/**
 * Word の画像を、ツールの画像にする。読めない形・壊れた画像は例外になる（呼ぶ側で問題として知らせる）。
 * ブラウザで画像を描けない（画像を描く道具がない）ときは、縮めずにそのまま使う（大きさはファイルの頭から読む）
 */
export async function prepareImage(bytes: Uint8Array, id: string, crop?: Crop | null, maxLongEdgePx = FIGURE_MAX_PX): Promise<StoredImage> {
  const info = imageInfo(bytes)
  if (!browserReadable(info.kind)) throw new Error(`使えない画像の形（${KIND_NAMES[info.kind]}）`)
  const blob = new Blob([bytes.slice()], { type: MIME[info.kind] })
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    if (!info.width || !info.height) throw new Error('画像の大きさが分かりません')
    return { id, blob, widthPx: info.width, heightPx: info.height }
  }
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  try {
    const { left, top, right, bottom } = clampCrop(crop)
    const sx = Math.round(bitmap.width * left)
    const sy = Math.round(bitmap.height * top)
    const sw = Math.max(1, Math.round(bitmap.width * (1 - left - right)))
    const sh = Math.max(1, Math.round(bitmap.height * (1 - top - bottom)))
    const scale = Math.min(1, maxLongEdgePx / Math.max(sw, sh))
    const width = Math.max(1, Math.round(sw * scale))
    const height = Math.max(1, Math.round(sh * scale))
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('画像を描けません')
    // 透過 PNG（デザイン画など）は白地に置く
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height)
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY })
    return { id, blob: out, widthPx: width, heightPx: height }
  } finally {
    bitmap.close()
  }
}

/** 画像の中身の目じるし（FNV-1a）。ひな形の仮の画像のままかを見分ける */
export function imageFingerprint(bytes: Uint8Array): string {
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${bytes.length}:${h.toString(16).padStart(8, '0')}`
}

/**
 * 学科の Word のひな形（04_本文.docx）に入っている仮の画像（「デザイン画を挿入する」「写真」の灰色の画像）。
 * 学生が差し替えていなければ、画像を空けて写す（ツールで写真を入れる）
 */
export const TEMPLATE_IMAGE_FINGERPRINTS = new Set(['11087:5f5c94ad', '5395:d1e7bec7'])
