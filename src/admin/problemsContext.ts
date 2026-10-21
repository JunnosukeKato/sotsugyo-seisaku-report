import { createContext } from 'react'
import type { ConfigProblem } from '../config/validate'

/**
 * 入力の誤り（エラー）と確認。欄のすぐ下（FieldProblems）と、区切りの見出しの下（それ以外）に出す。
 * 確認は「確かめた」にできる（この端末に年度ごとに覚える。文が変わったら、また確かめる：mockups/v49 G・H）
 */
export interface ProblemsValue {
  list: ConfigProblem[]
  isAcked: (p: ConfigProblem) => boolean
  ack: (p: ConfigProblem, on: boolean) => void
}
export const ProblemsContext = createContext<ProblemsValue>({ list: [], isAcked: () => false, ack: () => {} })
