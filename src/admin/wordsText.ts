import type { WordCheck } from '../config'
import { LIMITS, tooLong } from '../config/validate'

/** 書き間違いと正しい語が入っている行だけ（前後の空白は取る） */
export function cleanWords(rows: WordCheck[]): WordCheck[] {
  return rows
    .map((w) => ({ ...w, wrong: w.wrong.trim(), right: w.right.trim(), note: w.note?.trim() ?? '' }))
    .filter((w) => w.wrong && w.right && w.wrong !== w.right)
}

/**
 * 書き方のチェックの1行を「反映する」前に確かめる（直してもらうことの言葉。問題がなければ null）。
 * 空の欄・同じ語・長すぎる字（上限は src/config/validate.ts の LIMITS。サーバーと同じ）・一覧にもうある語・語の数の上限。
 * list は、いまの一覧。index は直している行（足すときは -1）
 */
export function wordRowProblem(row: WordCheck, list: WordCheck[], index: number): string | null {
  const wrong = row.wrong.trim()
  const right = row.right.trim()
  const note = (row.note ?? '').trim()
  if (!wrong || !right) return '書き間違いと正しい語の、両方を入れてください'
  if (wrong === right) return '書き間違いと正しい語が同じです'
  if (wrong.length > LIMITS.word) return `書き間違い${tooLong(LIMITS.word, wrong.length)}`
  if (right.length > LIMITS.word) return `正しい語${tooLong(LIMITS.word, right.length)}`
  if (note.length > LIMITS.wordNote) return `説明${tooLong(LIMITS.wordNote, note.length)}`
  if (list.some((w, i) => i !== index && w.wrong.trim() === wrong)) return `「${wrong}」は、もう一覧にあります`
  if (index < 0 && list.length >= LIMITS.words) return `語が多すぎます（${LIMITS.words}語まで）`
  return null
}

/** 左の見出しの「書き方のチェック」の下に出す、語の数（例：「言葉 13語（エラー7）」） */
export function wordSummary(words: WordCheck[]): string {
  const errors = words.filter((w) => w.severity === 'error').length
  return `言葉 ${words.length}語（エラー${errors}）`
}
