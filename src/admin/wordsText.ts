import type { WordCheck } from '../config'

/** 書き間違いと正しい語が入っている行だけ（前後の空白は取る） */
export function cleanWords(rows: WordCheck[]): WordCheck[] {
  return rows
    .map((w) => ({ ...w, wrong: w.wrong.trim(), right: w.right.trim(), note: w.note?.trim() ?? '' }))
    .filter((w) => w.wrong && w.right && w.wrong !== w.right)
}

/**
 * cleanWords で外す行の説明（「反映する」のときに、どの行を使わないかを示す）。
 * 例：「3行目：空の行」「5行目「見頃」：正しい語が空です」「6行目「同じ」：書き間違いと正しい語が同じです」
 */
export function skippedWords(rows: WordCheck[]): string[] {
  return rows.flatMap((w, i) => {
    const wrong = w.wrong.trim()
    const right = w.right.trim()
    const row = `${i + 1}行目`
    if (!wrong && !right) return [`${row}：空の行`]
    if (!wrong) return [`${row}「→ ${right}」：書き間違いが空です`]
    if (!right) return [`${row}「${wrong}」：正しい語が空です`]
    if (wrong === right) return [`${row}「${wrong}」：書き間違いと正しい語が同じです`]
    return []
  })
}

export function wordSummary(words: WordCheck[]): string {
  const errors = words.filter((w) => w.severity === 'error').length
  return `${words.length}語（エラー${errors}・要確認${words.length - errors}）`
}
