import type { Course, TemplateBlock } from '../config'

/** ひな形の中身の要約（コースのカードに出す。例：大見出し3・小見出し3・説明5・図の枠1・素材表1・改ページ1・表1） */
export function templateSummary(course: Course): string {
  const t = course.template
  if (!t || t.length === 0) return '標準のひな形（まだ決めていません）'
  const count = (type: TemplateBlock['type']) => t.filter((b) => b.type === type).length
  const parts = [`大見出し${count('chapter')}`, `小見出し${count('subheading')}`, `説明${count('paragraph')}`]
  if (count('figure')) parts.push(`図の枠${count('figure')}`)
  if (count('materialTable')) parts.push(`素材表${count('materialTable')}`)
  if (count('pageBreak')) parts.push(`改ページ${count('pageBreak')}`)
  if (count('table')) parts.push(`表${count('table')}`)
  return parts.join('・')
}

/** ひな形を作る画面から受け取ったときの短い知らせ（「保存して学生に反映」を押すまで、学生には届かない。mockups/v44 案A） */
export const TEMPLATE_RECEIVED = 'ひな形を受け取りました（まだ学生に届いていません）'
