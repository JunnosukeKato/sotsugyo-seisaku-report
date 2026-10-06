import type { PhotoPosition, WorkPhotoLayout, WorkPhotos } from './types'

/**
 * 作品写真のページの並べ方。写真は枠いっぱいに切り抜き、細い白い線で区切る（mockups/v11 案A）。
 * 2枚と6枚は、学生が並べ方を選べる。
 */
export interface PhotoArrangement {
  layout: WorkPhotoLayout
  columns: number
  rows: number
  /** 道具のボタンの2段目（並べ方）。2枚・6枚だけ */
  arrange?: string
  /** 説明（ボタンの title） */
  label: string
}

export const PHOTO_ARRANGEMENTS: PhotoArrangement[] = [
  { layout: 1, columns: 1, rows: 1, label: '1枚' },
  { layout: 2, columns: 2, rows: 1, arrange: '左右', label: '2枚（左右に並べる）' },
  { layout: 2, columns: 1, rows: 2, arrange: '上下', label: '2枚（上下に並べる）' },
  { layout: 4, columns: 2, rows: 2, label: '4枚' },
  { layout: 6, columns: 2, rows: 3, arrange: '2列', label: '6枚（2列×3段）' },
  { layout: 6, columns: 3, rows: 2, arrange: '3列', label: '6枚（3列×2段）' },
]

/** 枚数と横に並べる数から、並べ方を決める（合わない数なら、その枚数の最初の並べ方） */
export function photoGrid(photos: Pick<WorkPhotos, 'layout' | 'columns'>): PhotoArrangement {
  const candidates = PHOTO_ARRANGEMENTS.filter((a) => a.layout === photos.layout)
  return candidates.find((a) => a.columns === photos.columns) ?? candidates[0] ?? PHOTO_ARRANGEMENTS[0]
}

/** ページに載せる写真（先頭から layout 枚。空いている枠は ''） */
export function shownPhotos(photos: WorkPhotos): { imageId: string; position: PhotoPosition | null }[] {
  return Array.from({ length: photos.layout }, (_, i) => ({ imageId: photos.imageIds[i] ?? '', position: photos.positions?.[i] ?? null }))
}

/**
 * 並べ方を変える。写真は消さずに、入っているものを先頭へ詰める
 * （例：4枚の2枚目だけに写真があるとき、1枚にすると、その写真が載る）
 */
export function changeArrangement(photos: WorkPhotos, layout: WorkPhotoLayout, columns: number): WorkPhotos {
  const filled = photos.imageIds.map((id, i) => ({ id, position: photos.positions?.[i] ?? null })).filter((p) => p.id)
  return { layout, columns, imageIds: filled.map((p) => p.id), positions: filled.map((p) => p.position) }
}

/** index 枚目の写真を入れる（切り抜く位置は中央に戻す） */
export function putPhoto(photos: WorkPhotos, index: number, imageId: string): WorkPhotos {
  const imageIds = Array.from({ length: Math.max(photos.imageIds.length, index + 1) }, (_, i) => photos.imageIds[i] ?? '')
  const positions = imageIds.map((_, i) => photos.positions?.[i] ?? null)
  imageIds[index] = imageId
  positions[index] = null
  return { ...photos, imageIds, positions }
}

/** index 枚目の写真の切り抜く位置を変える */
export function movePhoto(photos: WorkPhotos, index: number, position: PhotoPosition): WorkPhotos {
  const positions = photos.imageIds.map((_, i) => photos.positions?.[i] ?? null)
  positions[index] = { x: clampPercent(position.x), y: clampPercent(position.y) }
  return { ...photos, positions }
}

export function clampPercent(v: number): number {
  return Math.round(Math.max(0, Math.min(100, v)) * 10) / 10
}
