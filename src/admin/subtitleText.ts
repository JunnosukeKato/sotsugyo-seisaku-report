/**
 * コースのカードの「サブタイトルの形式」。前後の「―」は入力欄の外に固定の印として出し、
 * 欄には「―」を除いた部分（学生が入力する部分の前の文字・後ろの文字）だけを出す。
 * 保存する形式は、いつも「―{前の文字}{input}{後ろの文字}―」（学生のツールは、今までどおり形式をそのまま使う）
 */

/** 前後の線（保存するときに付ける字） */
export const SUBTITLE_DASH = '―'
/** 線として打たれやすい字（「―」のほか、ダッシュ・全角のハイフン・長音の「ー」） */
const DASHES = '―—－ー'

/**
 * 形式を、欄に出す前の文字と後ろの文字に分ける。前の文字のはじめの線と、後ろの文字の終わりの線を1つずつ外す
 * （今までの設定は「―{input}の衣装制作―」のように、線を形式の中に持っているため）。
 * 終わりの「ー」は「ストーリー」のような語の終わりのこともあるので、はじめにも線があったときだけ線とみなす
 */
export function splitSubtitle(template: string): [string, string] {
  const i = template.indexOf('{input}')
  let before = i < 0 ? template : template.slice(0, i)
  let after = i < 0 ? '' : template.slice(i + '{input}'.length)
  const lead = before !== '' && DASHES.includes(before[0])
  if (lead) before = before.slice(1)
  const last = after.at(-1)
  if (last && DASHES.includes(last) && (last !== 'ー' || lead)) after = after.slice(0, -1)
  return [before, after]
}

/** 欄の前の文字と後ろの文字から、保存する形式を作る（前後に「―」を付ける） */
export function joinSubtitle(before: string, after: string): string {
  return `${SUBTITLE_DASH}${before}{input}${after}${SUBTITLE_DASH}`
}

/** 「例：」に出すサブタイトル（保存されている形式に、例の言葉を当てはめる。表紙と同じく前後の線も出る） */
export function subtitleExample(template: string, input = 'シンドバッド'): string {
  return template.replace('{input}', input)
}

/** コース名の最後に「コース」が付いているか（表紙では自動で付くので、二重になる） */
export function endsWithCourse(name: string): boolean {
  return /コース$/.test(name.trim())
}
