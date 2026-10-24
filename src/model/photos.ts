import type { PhotoPosition, WorkPhotoLayout, WorkPhotoPage } from './types'

/**
 * 作品写真のページの並べ方。写真は枠いっぱいに切り抜き、細い白い線で区切る（mockups/v11 案A）。
 * 2枚は、学生が並べ方（左右・上下）を選べる。1ページは4枚まで（6枚の並べ方はなくした。多いときは次のページへ：mockups/v38 案A）
 */
export interface PhotoArrangement {
  layout: WorkPhotoLayout
  columns: number
  rows: number
  /** 道具のボタンの2段目（並べ方）。2枚だけ */
  arrange?: string
  /** 説明（ボタンの title） */
  label: string
}

export const PHOTO_ARRANGEMENTS: PhotoArrangement[] = [
  { layout: 1, columns: 1, rows: 1, label: '1枚' },
  { layout: 2, columns: 2, rows: 1, arrange: '左右', label: '2枚（左右に並べる）' },
  { layout: 2, columns: 1, rows: 2, arrange: '上下', label: '2枚（上下に並べる）' },
  { layout: 4, columns: 2, rows: 2, label: '4枚' },
]

/** 1ページに載せられるいちばん多い枚数 */
export const PHOTOS_PER_PAGE_MAX = 4

/** 枚数と横に並べる数から、並べ方を決める（合わない数なら、その枚数の最初の並べ方） */
export function photoGrid(photos: Pick<WorkPhotoPage, 'layout' | 'columns'>): PhotoArrangement {
  const candidates = PHOTO_ARRANGEMENTS.filter((a) => a.layout === photos.layout)
  return candidates.find((a) => a.columns === photos.columns) ?? candidates[0] ?? PHOTO_ARRANGEMENTS[0]
}

/** ページに載せる写真（先頭から layout 枚。空いている枠は ''）。whole：全体を入れる（切らない）写真か */
export function shownPhotos(photos: WorkPhotoPage): { imageId: string; position: PhotoPosition | null; whole: boolean }[] {
  return Array.from({ length: photos.layout }, (_, i) => ({ imageId: photos.imageIds[i] ?? '', position: photos.positions?.[i] ?? null, whole: photos.whole?.[i] === true }))
}

/**
 * 「全体を入れる（切らない）」を付け直す。どの写真も切り抜くときは、項目ごと外す
 * （前の版の原稿と同じ形のままにする。切らない写真がなければ、保存するデータも今までと変わらない）
 */
function withWhole(photos: WorkPhotoPage, whole: boolean[]): WorkPhotoPage {
  const next: WorkPhotoPage = { ...photos }
  if (whole.some(Boolean)) next.whole = whole
  else delete next.whole
  return next
}

/**
 * 並べ方を変える。写真は消さずに、入っているものを先頭へ詰める
 * （例：4枚の2枚目だけに写真があるとき、1枚にすると、その写真が載る）。
 * 切り抜く位置と「全体を入れる（切らない）」は、写真といっしょに動かす
 */
export function changeArrangement(photos: WorkPhotoPage, layout: WorkPhotoLayout, columns: number): WorkPhotoPage {
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
export function putPhoto(photos: WorkPhotoPage, index: number, imageId: string): WorkPhotoPage {
  const imageIds = Array.from({ length: Math.max(photos.imageIds.length, index + 1) }, (_, i) => photos.imageIds[i] ?? '')
  const positions = imageIds.map((_, i) => photos.positions?.[i] ?? null)
  const whole = imageIds.map((_, i) => photos.whole?.[i] === true)
  imageIds[index] = imageId
  positions[index] = null
  whole[index] = false
  return withWhole({ ...photos, imageIds, positions }, whole)
}

/** index 枚目の写真の切り抜く位置を変える */
export function movePhoto(photos: WorkPhotoPage, index: number, position: PhotoPosition): WorkPhotoPage {
  const positions = photos.imageIds.map((_, i) => photos.positions?.[i] ?? null)
  positions[index] = { x: clampPercent(position.x), y: clampPercent(position.y) }
  return { ...photos, positions }
}

/**
 * index 枚目の写真を「全体を入れる（切らない）」にする（on：false で、枠いっぱいに切り抜くのに戻す）。
 * 切り抜く位置は残しておく（切り抜くのに戻したとき、前に動かした位置で見える）
 */
export function wholePhoto(photos: WorkPhotoPage, index: number, on: boolean): WorkPhotoPage {
  const whole = photos.imageIds.map((_, i) => photos.whole?.[i] === true)
  if (index >= 0 && index < whole.length) whole[index] = on
  return withWhole(photos, whole)
}

export function clampPercent(v: number): number {
  return Math.round(Math.max(0, Math.min(100, v)) * 10) / 10
}

// ---- 作品写真の何ページか（mockups/v38 案A：依頼者の判断。ページごとに並べ方を選ぶ） ----

/** そのページに載っている写真の数 */
export function pagePhotoCount(page: WorkPhotoPage): number {
  return shownPhotos(page).filter((p) => p.imageId).length
}

/** すべてのページに載っている写真の数 */
export function photoCount(pages: WorkPhotoPage[]): number {
  return pages.reduce((n, p) => n + pagePhotoCount(p), 0)
}

/** すべてのページに載っている写真の ID（ページの順、ページの中は枠の順） */
export function shownPhotoIds(pages: WorkPhotoPage[]): string[] {
  return pages.flatMap((p) => shownPhotos(p).flatMap((s) => (s.imageId ? [s.imageId] : [])))
}

/** 写真が1枚も載っていないページ（0 から） */
export function emptyPhotoPages(pages: WorkPhotoPage[]): number[] {
  return pages.flatMap((p, i) => (pagePhotoCount(p) === 0 ? [i] : []))
}

/** 空のページ（並べ方は from と同じ。なければ1枚） */
export function blankPhotoPage(from?: Pick<WorkPhotoPage, 'layout' | 'columns'>): WorkPhotoPage {
  return { layout: from?.layout ?? 1, ...(from?.columns ? { columns: from.columns } : {}), imageIds: [] }
}

/** ページ数の上限（null は上限なし。学科の設定 workPhotos.maxPages）までに、まだページを足せるか */
export function canAddPhotoPage(pages: WorkPhotoPage[], maxPages: number | null): boolean {
  return maxPages === null || pages.length < maxPages
}

/** after ページ目（0 から）の後ろに、そのページと同じ並べ方の空のページを足す */
export function addPhotoPage(pages: WorkPhotoPage[], after: number): WorkPhotoPage[] {
  const at = Math.max(0, Math.min(after, pages.length - 1))
  return [...pages.slice(0, at + 1), blankPhotoPage(pages[at]), ...pages.slice(at + 1)]
}

/** index ページ目を、中の写真ごと消す（1ページだけのときは消さない。作品写真のページは、いつも1ページはある） */
export function removePhotoPage(pages: WorkPhotoPage[], index: number): WorkPhotoPage[] {
  if (pages.length <= 1 || index < 0 || index >= pages.length) return pages
  return pages.filter((_, i) => i !== index)
}

/** index ページ目だけを変える */
export function updatePhotoPage(pages: WorkPhotoPage[], index: number, fn: (page: WorkPhotoPage) => WorkPhotoPage): WorkPhotoPage[] {
  return pages.map((p, i) => (i === index ? fn(p) : p))
}

/** 写真を入れる枠（page：ページ、index：その中の枠。0 から） */
export interface PhotoSlot {
  page: number
  index: number
}

/**
 * 選んだ count 枚の写真を入れる枠（mockups/v38 ③：選んだ写真は全部入れる）。
 * 押した枠（page ページ目の index 枚目）から後ろ、そのあと前の、そのページの空いている枠 → 後ろのページの空いている枠 →
 * それでも足りなければ、最後のページと同じ並べ方のページを後ろに足して入れる（ページの数が maxPages（null は上限なし）に達したら、そこまで）。
 * 足りなければ、返す枠は count より少ない
 */
export function photoSlots(pages: WorkPhotoPage[], page: number, index: number, count: number, maxPages: number | null): PhotoSlot[] {
  const empty = (k: number) => shownPhotos(pages[k]).flatMap((p, i) => (p.imageId ? [] : [i]))
  const here = empty(page)
  const slots: PhotoSlot[] = [...here.filter((i) => i >= index), ...here.filter((i) => i < index)].map((i) => ({ page, index: i }))
  for (let k = page + 1; k < pages.length; k++) slots.push(...empty(k).map((i) => ({ page: k, index: i })))
  const last = pages[pages.length - 1]
  for (let k = pages.length; slots.length < count && (maxPages === null || k < maxPages); k++) {
    for (let i = 0; i < last.layout; i++) slots.push({ page: k, index: i })
  }
  return slots.slice(0, count)
}

/** 写真の枚数に合う並べ方（1枚・2枚は左右・3〜4枚は4枚。まとめて選んだとき。依頼者の選択 mockups/v53 ① 案B） */
export function fittingArrangement(count: number): { layout: WorkPhotoLayout; columns: number } {
  return count <= 1 ? { layout: 1, columns: 1 } : count === 2 ? { layout: 2, columns: 2 } : { layout: 4, columns: 2 }
}

/**
 * page ページ目の空いている枠に、次のページから写真を詰める（並べ方を、枠の多いものに変えたとき。依頼者の選択 mockups/v53 ① 案A。
 * 前は、「1枚」で2枚選んで2ページに分かれたあと「2枚 左右」にしても、右の枠が空いたままだった：学生の試し 2026-10-24）。
 * 次のページの写真を先頭から順に移し（切り抜く位置・全体を入れるもいっしょに）、写真がなくなったページは消す。
 * moved：詰めた枚数、removed：消したページの数
 */
export function packPhotos(pages: WorkPhotoPage[], page: number): { pages: WorkPhotoPage[]; moved: number; removed: number } {
  const target = pages[page]
  if (!target) return { pages, moved: 0, removed: 0 }
  const entries = (p: WorkPhotoPage) => p.imageIds.map((id, i) => ({ id, position: p.positions?.[i] ?? null, whole: p.whole?.[i] === true })).filter((e) => e.id)
  const build = (p: WorkPhotoPage, list: ReturnType<typeof entries>) => withWhole({ ...p, imageIds: list.map((e) => e.id), positions: list.map((e) => e.position) }, list.map((e) => e.whole))
  const mine = entries(target)
  let free = target.layout - mine.length
  if (free <= 0) return { pages, moved: 0, removed: 0 }
  const next = [...pages]
  let moved = 0
  let removed = 0
  for (let k = page + 1; k < next.length && free > 0; ) {
    const theirs = entries(next[k])
    const take = theirs.slice(0, free)
    mine.push(...take)
    moved += take.length
    free -= take.length
    const rest = theirs.slice(take.length)
    if (rest.length === 0) {
      next.splice(k, 1)
      removed += 1
      continue
    }
    next[k] = build(next[k], rest)
    k += 1
  }
  if (moved === 0) return { pages, moved: 0, removed: 0 }
  next[page] = build(target, mine)
  return { pages: next, moved, removed }
}

/** 写真を枠に入れる（枠のページがまだなければ、最後のページと同じ並べ方の空のページを後ろに足す） */
export function placePhotos(pages: WorkPhotoPage[], placed: (PhotoSlot & { imageId: string })[]): WorkPhotoPage[] {
  let next = pages
  for (const p of placed) {
    while (next.length <= p.page) next = [...next, blankPhotoPage(next[next.length - 1])]
    next = updatePhotoPage(next, p.page, (page) => putPhoto(page, p.index, p.imageId))
  }
  return next
}

/** ページの種類の並び（紙面の kinds）で、page ページ目（通し。0 から）が何枚目の作品写真のページか（0 から。作品写真のページでなければ null） */
export function photoPageAt(kinds: readonly string[], page: number): number | null {
  if (kinds[page] !== 'photos') return null
  return kinds.slice(0, page).filter((k) => k === 'photos').length
}

/** k 枚目（0 から）の作品写真のページの、通しのページ（0 から。なければ -1） */
export function pageOfPhotoPage(kinds: readonly string[], k: number): number {
  let seen = -1
  for (let i = 0; i < kinds.length; i++) if (kinds[i] === 'photos' && ++seen === k) return i
  return -1
}

/** 作品写真のページの名前：1ページだけなら「作品写真」、何ページかあれば「作品写真 2」 */
export function photoPageName(k: number, total: number): string {
  return total > 1 ? `作品写真 ${k + 1}` : '作品写真'
}
