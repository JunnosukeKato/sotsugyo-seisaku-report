import type { WordCheck } from '../config'

/** 書き間違いと正しい語が入っている行だけ（前後の空白は取る） */
export function cleanWords(rows: WordCheck[]): WordCheck[] {
  return rows
    .map((w) => ({ ...w, wrong: w.wrong.trim(), right: w.right.trim(), note: w.note?.trim() ?? '' }))
    .filter((w) => w.wrong && w.right && w.wrong !== w.right)
}

export function wordSummary(words: WordCheck[]): string {
  const errors = words.filter((w) => w.severity === 'error').length
  return `${words.length}語（エラー${errors}・注意${words.length - errors}）`
}
