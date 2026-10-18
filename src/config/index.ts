import config2026 from './2026.json'
import type { Course, YearConfig } from './types'

export type { Course, TemplateBlock, WordCheck, YearConfig } from './types'

// JSON の文字列（ひな形の部品の種類など）は型が広がるため、型を指定して読み込む
export const currentConfig: YearConfig = config2026 as YearConfig

export function findCourse(config: YearConfig, courseId: string): Course | undefined {
  return config.courses.find((course) => course.id === courseId)
}

/**
 * 文の中に書いてあるコースの名前から、コースを探す（Word の表紙・抄録など。長い名前から。見つからなければ null）。
 * 全角・半角と空白の違いは見ない。提出前チェック（check/wordParts.ts の findCourseId）と、学生用ツールの「Word から読み込む」で使う
 */
export function courseIdInText(lines: string[], config: YearConfig): string | null {
  const comparable = (s: string) => s.normalize('NFKC').replace(/[\s　]/g, '')
  const all = comparable(lines.join(''))
  const courses = [...config.courses].sort((a, b) => b.name.length - a.name.length)
  return courses.find((c) => c.name && all.includes(comparable(c.name)))?.id ?? null
}

/** コースごとの指定形式に学生の入力を当てはめてサブタイトルを作る */
export function renderSubtitle(course: Course, input: string): string {
  return course.subtitleTemplate.replace('{input}', input.trim())
}

/** サブタイトルの前後の線として打たれやすい字（「―」のほか、ダッシュ・ハイフン・罫線） */
const DASHES = '―－—–\\-‐−─━'

/**
 * サブタイトルの入力から、自動で付く前後の決まり文句（「―」「の衣装制作―」など）を取り、学生が入れる部分（{input}）だけにする。
 * 「―海の王女の衣装制作―」と全部を入力すると、表紙で「――海の王女の衣装制作―の衣装制作―」と二重になるため。
 * 線は「―」でなく「ー」「－」などで打つこともある。先頭の「ー」は線とみなす（語は「ー」で始まらない）が、
 * 終わりの「ー」は「ストーリー」のような語の終わりのこともあるので、先頭にも線があったとき・決まり文句のすぐ後ろのときだけ線とみなす。
 * 決まり文句だけを入力したとき（取ると何も残らない）は、そのまま返す
 */
export function subtitleInputOnly(course: Course, typed: string): string {
  const [before = '', after = ''] = course.subtitleTemplate.split('{input}')
  const edges = new RegExp(`^[${DASHES}]+|[${DASHES}]+$`, 'g')
  const head = before.replace(edges, '').trim()
  const tail = after.replace(edges, '').trim()
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let s = typed.trim()
  const lead = s.match(new RegExp(`^(?:[${DASHES}]+|ー+)`))
  if (lead && s.length > lead[0].length) s = s.slice(lead[0].length).trim()
  if (head && s.startsWith(head) && s.length > head.length) s = s.slice(head.length).trim()
  const withTail = tail ? s.match(new RegExp(`${escape(tail)}[\\s　]*(?:[${DASHES}]+|ー)?$`)) : null
  if (withTail && withTail.index! > 0) s = s.slice(0, withTail.index).trim()
  else s = s.replace(new RegExp(`(?:[${DASHES}]+${lead ? '|ー' : ''})$`), '').trim()
  return s || typed.trim()
}
