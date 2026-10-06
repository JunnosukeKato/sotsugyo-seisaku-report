import config2026 from './2026.json'
import type { Course, YearConfig } from './types'

export type { Course, TemplateBlock, WordCheck, YearConfig } from './types'

// JSON の文字列（ひな形の部品の種類など）は型が広がるため、型を指定して読み込む
export const currentConfig: YearConfig = config2026 as YearConfig

export function findCourse(config: YearConfig, courseId: string): Course | undefined {
  return config.courses.find((course) => course.id === courseId)
}

/** コースごとの指定形式に学生の入力を当てはめてサブタイトルを作る */
export function renderSubtitle(course: Course, input: string): string {
  return course.subtitleTemplate.replace('{input}', input.trim())
}
