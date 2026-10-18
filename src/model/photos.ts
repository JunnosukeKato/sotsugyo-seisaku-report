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

/** ページに載せる写真（先頭から layout 枚。空いている枠は ''）。whole：全体を入れる（切らない）写真か */
export function shownPhotos(photos: WorkPhotos): { imageId: string; position: PhotoPosition | null; whole: boolean }[] {
  return Array.from({ length: photos.layout }, (_, i) => ({ imageId: photos.imageIds[i] ?? '', position: photos.positions?.[i] ?? null, whole: photos.whole?.[i] === true }))
}

/**
 * 「全体を入れる（切らない）」を付け直す。どの写真も切り抜くときは、項目ごと外す
 * （前の版の原稿と同じ形のままにする。切らない写真がなければ、保存するデータも今までと変わらない）
 */
function withWhole(photos: WorkPhotos, whole: boolean[]): WorkPhotos {
  const next: WorkPhotos = { ...photos }
  if (whole.some(Boolean)) next.whole = whole
  else delete next.whole
  return next
}

/**
 * 並べ方を変える。写真は消さずに、入っているものを先頭へ詰める
 * （例：4枚の2枚目だけに写真があるとき、1枚にすると、その写真が載る）。
 * 切り抜く位置と「全体を入れる（切らない）」は、写真といっしょに動かす
 */
export function changeArrangement(photos: WorkPhotos, layout: WorkPhotoLayout, columns: number): WorkPhotos {
  const filled = photos.imageIds.map((id, i) => ({ id, position: photos.positions?.[i] ?? null, whole: photos.whole?.[i] === true })).filter((p) => p.id)
  return withWhole(
    { layout, columns, imageIds: filled.map((p) => p.id), positions: filled.map((p) => p.position) },
    filled.map((p) => p.whole),
  )
}

/**
 * index 枚目の写真を入れる（差し替える・外す）。新しい写真は、切り抜く位置を中央に戻し、
 * 「全体を入れる（切らない）」も外す（今までどおり枠いっぱいに切り抜く。前の写真の設定は、別の写真には合わないため）
 */
export function putPhoto(photos: WorkPhotos, index: number, imageId: string): WorkPhotos {
  const imageIds = Array.from({ length: Math.max(photos.imageIds.length, index + 1) }, (_, i) => photos.imageIds[i] ?? '')
  const positions = imageIds.map((_, i) => photos.positions?.[i] ?? null)
  const whole = imageIds.map((_, i) => photos.whole?.[i] === true)
  imageIds[index] = imageId
  positions[index] = null
  whole[index] = false
  return withWhole({ ...photos, imageIds, positions }, whole)
}

/** index 枚目の写真の切り抜く位置を変える */
export function movePhoto(photos: WorkPhotos, index: number, position: PhotoPosition): WorkPhotos {
  const positions = photos.imageIds.map((_, i) => photos.positions?.[i] ?? null)
  positions[index] = { x: clampPercent(position.x), y: clampPercent(position.y) }
  return { ...photos, positions }
}

/**
 * index 枚目の写真を「全体を入れる（切らない）」にする（on：false で、枠いっぱいに切り抜くのに戻す）。
 * 切り抜く位置は残しておく（切り抜くのに戻したとき、前に動かした位置で見える）
 */
export function wholePhoto(photos: WorkPhotos, index: number, on: boolean): WorkPhotos {
  const whole = photos.imageIds.map((_, i) => photos.whole?.[i] === true)
  if (index >= 0 && index < whole.length) whole[index] = on
  return withWhole(photos, whole)
}

export function clampPercent(v: number): number {
  return Math.round(Math.max(0, Math.min(100, v)) * 10) / 10
}
