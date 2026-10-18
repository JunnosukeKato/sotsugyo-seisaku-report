/**
 * 指差し確認（Tour.tsx）を、この端末で見たかを覚えておく。
 * 端末（ブラウザ）ごとに1回だけ出す（別の端末では、もう一度出る）。
 * 出したとき（shown）にも覚える：前は見終えた（とばした）ときだけ覚えていたため、出ている間に読み込み直すと、また初めから出ていた。
 * 覚えるのは「出した・見終えた」だけ（原稿の文字は入れない）
 */

const TOUR_KEY = 'sotsugyo-seisaku-report-tour'
/** このタブで、すでにツールを開いたか（読み込み直しても残る。タブを閉じると消える） */
const OPENED_KEY = 'sotsugyo-seisaku-report-opened'
/** このページを読み込んだときの firstOpenInTab の答え（2回目からは、同じ答えを返す） */
let freshOpen: boolean | null = null

/** この端末で、指差し確認を出した（見終えた・とばした）か */
export function tourSeen(): boolean {
  try {
    const v = localStorage.getItem(TOUR_KEY)
    return v === 'done' || v === 'shown'
  } catch {
    // 覚えておけない端末では、開くたびに出さないよう、見たことにする（使い方から、いつでも見られる）
    return true
  }
}

/** 指差し確認を出した（見終えていなくても、次からは自分では出さない。使い方から、もう一度見られる） */
export function markTourShown(): void {
  try {
    if (localStorage.getItem(TOUR_KEY) !== 'done') localStorage.setItem(TOUR_KEY, 'shown')
  } catch {
    // 覚えておけなくても、続けられる
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

/**
 * このタブで開くのが初めてか（ページを読み込むたびに1回だけ調べ、あとは同じ答え）。このタブで書いている途中に読み込み直したときは false。
 * 案内を終えずに閉じた学生への指差し確認は、次に開いたときに出す。書いている途中に読み込み直したときには出さない
 * （Word から読み込んで書いている途中に読み込み直すと、急に出ていた）
 */
export function firstOpenInTab(): boolean {
  if (freshOpen !== null) return freshOpen
  try {
    freshOpen = !sessionStorage.getItem(OPENED_KEY)
    sessionStorage.setItem(OPENED_KEY, '1')
  } catch {
    freshOpen = true
  }
  return freshOpen
}
