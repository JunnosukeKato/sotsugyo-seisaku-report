import type { Course, TemplateBlock } from '../config'

/** ひな形の中身の要約（コースのカードに出す） */
export function templateSummary(course: Course): string {
  const t = course.template
  if (!t || t.length === 0) return '標準のひな形（まだ決めていません）'
  const count = (type: TemplateBlock['type']) => t.filter((b) => b.type === type).length
  const parts = [`大見出し${count('chapter')}`, `小見出し${count('subheading')}`, `説明${count('paragraph')}`]
  if (count('figure')) parts.push(`図の枠${count('figure')}`)
  if (count('materialTable')) parts.push(`素材表${count('materialTable')}`)
  return parts.join('・')
}
