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
