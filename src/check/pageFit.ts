/**
 * 提出前チェック：作品写真を A4 の1ページに置く大きさ（merge.ts と photo.ts で使う。PDF の部品は読み込まない）
 */

/** A4（pt） */
export const A4 = { width: 595.28, height: 841.89 }

/** 写真を、ページの中に切らずに入る、いちばん大きな大きさにして、真ん中に置く位置（pt。左下が原点） */
export function fitInPage(width: number, height: number, page: { width: number; height: number } = A4): { x: number; y: number; width: number; height: number } {
  const scale = Math.min(page.width / width, page.height / height)
  const w = width * scale
  const h = height * scale
  return { x: (page.width - w) / 2, y: (page.height - h) / 2, width: w, height: h }
}

/** 写真の点の数（A4 に置いたとき、約 200dpi より細かければ、そこまで縮める。小さい写真は、そのまま） */
export function photoPixels(width: number, height: number, dpi = 200): { width: number; height: number } {
  const fit = fitInPage(width, height)
  const scale = Math.min(1, ((fit.width / 72) * dpi) / width, ((fit.height / 72) * dpi) / height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** 作品写真の上限（手順書：自分で撮った写真6枚以内を、A4 の1ページに並べる。年度の設定 workPhotos.maxImages と同じ） */
export const MAX_PHOTOS = 6

/** 写真を並べるときの、ページのまわりの余白と、写真の間（pt。10mm と 4mm）。写真が1枚のときも同じ余白 */
const PHOTO_MARGIN = (10 / 25.4) * 72
const PHOTO_GAP = (4 / 25.4) * 72

/**
 * 写真の並べ方（mockups/v31 案A：枚数で決まる。学生は選ばない）。
 * 1枚・2枚（縦長だけなら左右、横長があれば上下）・3〜4枚は 2×2・5〜6枚は 2×3
 */
export function photoGrid(photos: { width: number; height: number }[]): { cols: number; rows: number } {
  const n = photos.length
  if (n <= 1) return { cols: 1, rows: 1 }
  if (n === 2) return photos.some((p) => p.width > p.height) ? { cols: 1, rows: 2 } : { cols: 2, rows: 1 }
  if (n <= 4) return { cols: 2, rows: 2 }
  return { cols: 2, rows: 3 }
}

/**
 * 写真を並べた位置（pt。左下が原点。並べた順に、左上から右へ、上の段から下の段へ）。
 * 写真は切らずに、枠の中に入るいちばん大きな大きさで、枠の真ん中に置く
 */
export function photoPlaces(photos: { width: number; height: number }[], page: { width: number; height: number } = A4): { x: number; y: number; width: number; height: number }[] {
  const { cols, rows } = photoGrid(photos)
  const cw = (page.width - 2 * PHOTO_MARGIN - (cols - 1) * PHOTO_GAP) / cols
  const ch = (page.height - 2 * PHOTO_MARGIN - (rows - 1) * PHOTO_GAP) / rows
  return photos.map((p, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const fit = fitInPage(p.width, p.height, { width: cw, height: ch })
    // pt は左下が原点なので、上の段は y が大きい
    return { x: PHOTO_MARGIN + col * (cw + PHOTO_GAP) + fit.x, y: page.height - PHOTO_MARGIN - (row + 1) * ch - row * PHOTO_GAP + fit.y, width: fit.width, height: fit.height }
  })
}
