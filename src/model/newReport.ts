import type { YearConfig } from '../config'
import { abstractHint, bodyFromTemplate, courseTemplate, emptyParagraph } from './template'
import type { Report } from './types'
import { DATA_FORMAT_VERSION } from './types'

/**
 * 新しい報告書。本文は、選んだコースの下書きのひな形（管理ページで決める）から作る。
 * コースを指定しないとき、学生に見せるコースが1つだけならそのコースにし、2つ以上なら未選択にする（最初の画面で選ぶ）。
 * 見出しの番号（Ⅰ．ⅰ．）と図表の番号は自動で付くため、ここでは名前だけを持つ。
 */
export function createReport(config: YearConfig, courseId?: string): Report {
  const visible = config.courses.filter((c) => !c.hidden)
  const course = courseId ?? (visible.length === 1 ? visible[0].id : '')
  return {
    formatVersion: DATA_FORMAT_VERSION,
    fiscalYear: config.fiscalYear,
    basicInfo: { studentId: '', name: '', courseId: course, subtitleInput: '' },
    abstract: { paragraphs: [emptyParagraph(abstractHint(config, course))] },
    body: bodyFromTemplate(courseTemplate(config, course)),
    references: [],
    workPhotos: { layout: 1, imageIds: [] },
    updatedAt: new Date().toISOString(),
  }
}
