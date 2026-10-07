/**
 * 指差し確認（Tour.tsx）を、この端末で見終えた（とばした）かを覚えておく。
 * 端末（ブラウザ）ごとに1回だけ出す（別の端末では、もう一度出る）
 */

const TOUR_KEY = 'sotsugyo-seisaku-report-tour'

/** この端末で、指差し確認を見終えた（とばした）か */
export function tourSeen(): boolean {
  try {
    return localStorage.getItem(TOUR_KEY) === 'done'
  } catch {
    // 覚えておけない端末では、開くたびに出さないよう、見たことにする（使い方から、いつでも見られる）
    return true
  }
}

/** 見終えた（とばした）ことを、この端末に覚えておく */
export function markTourSeen(): void {
  try {
    localStorage.setItem(TOUR_KEY, 'done')
  } catch {
    // 覚えておけなくても、続けられる
  }
}
