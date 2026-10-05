import config2026 from './2026.json'
import type { Course, YearConfig } from './types'

export type { Course, YearConfig } from './types'

export const currentConfig: YearConfig = config2026

export function findCourse(config: YearConfig, courseId: string): Course | undefined {
  return config.courses.find((course) => course.id === courseId)
}

/** コースごとの指定形式に学生の入力を当てはめてサブタイトルを作る */
export function renderSubtitle(course: Course, input: string): string {
  return course.subtitleTemplate.replace('{input}', input.trim())
}
