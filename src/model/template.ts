import { findCourse, type TemplateBlock, type YearConfig } from '../config'
import type { BodyBlock, Chapter, ParagraphBlock, Report } from './types'

/**
 * 下書きのひな形。コースごとに管理ページで決め、学生が最初に見る本文の組み立てになる。
 * ひな形を決めていないコースは、標準のひな形を使う。
 */

/** 標準のひな形（コースのひな形が決まっていないとき） */
export const DEFAULT_TEMPLATE: TemplateBlock[] = [
  { type: 'chapter', title: '企画・立案' },
  { type: 'paragraph', hint: '制作の目的とテーマ、自分が担当した内容を書く' },
  { type: 'chapter', title: '制作過程' },
  { type: 'paragraph', hint: '制作の手順と、工夫した点を書く' },
  { type: 'chapter', title: 'まとめ' },
  { type: 'paragraph', hint: '完成した作品を振り返り、できたこと・課題を書く' },
]

let counter = 0
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++counter}`

export function emptyParagraph(hint?: string): ParagraphBlock {
  return { type: 'paragraph', id: newId('p'), content: [{ type: 'text', text: '' }], ...(hint ? { hint } : {}) }
}

/** そのコースのひな形（なければ標準のひな形） */
export function courseTemplate(config: YearConfig, courseId: string): TemplateBlock[] {
  const template = findCourse(config, courseId)?.template
  return template && template.some((b) => b.type === 'chapter') ? template : DEFAULT_TEMPLATE
}

/** 抄録の欄に薄く出す書き出しの例 */
export function abstractHint(config: YearConfig, courseId: string): string {
  const example = findCourse(config, courseId)?.abstractExample?.trim() || config.abstract.openingExample
  return `書き出しの例：${example}……`
}

/** ひな形から本文を作る。大見出しより前の部品は、名前のない大見出しにまとめる。中身のない大見出しには空の段落を入れる */
export function bodyFromTemplate(template: TemplateBlock[]): Chapter[] {
  const chapters: Chapter[] = []
  const current = (): Chapter => {
    if (chapters.length === 0) chapters.push({ id: newId('c'), title: '', blocks: [] })
    return chapters[chapters.length - 1]
  }
  for (const block of template) {
    if (block.type === 'chapter') {
      chapters.push({ id: newId('c'), title: block.title, blocks: [] })
      continue
    }
    let body: BodyBlock
    switch (block.type) {
      case 'subheading':
        body = { type: 'subheading', id: newId('s'), title: block.title }
        break
      case 'paragraph':
        body = emptyParagraph(block.hint.trim() || undefined)
        break
      case 'figure':
        body = { type: 'figureRow', id: newId('r'), figures: [{ id: newId('f'), imageId: '', caption: block.caption }] }
        break
      case 'materialTable':
        body = { type: 'materialTable', id: newId('t'), caption: block.caption, rows: [{ id: newId('m'), name: '', usage: '', swatchImageId: null }] }
        break
    }
    current().blocks.push(body)
  }
  for (const chapter of chapters) if (chapter.blocks.length === 0) chapter.blocks.push(emptyParagraph())
  return chapters
}

/** ID を除いた本文の形（ひな形のままかどうかを比べるため） */
function shape(body: Chapter[]): string {
  return JSON.stringify(
    body.map((c) => ({
      title: c.title,
      blocks: c.blocks.map((b) => {
        if (b.type === 'paragraph') return { type: b.type, content: b.content.map((n) => (n.type === 'text' ? n.text : 'ref')).join(''), hint: b.hint ?? '' }
        if (b.type === 'subheading') return { type: b.type, title: b.title }
        if (b.type === 'figureRow') return { type: b.type, figures: b.figures.map((f) => [f.imageId, f.caption]) }
        if (b.type === 'pageBreak') return { type: b.type }
        return { type: b.type, caption: b.caption, rows: b.rows.map((r) => [r.name, r.usage, r.swatchImageId]) }
      }),
    })),
  )
}

/** 本文を書き始めているか（そのコースのひな形のままでなければ、書き始めているとみなす） */
export function bodyWritten(report: Report, config: YearConfig): boolean {
  return shape(report.body) !== shape(bodyFromTemplate(courseTemplate(config, report.basicInfo.courseId)))
}

/** 抄録をまだ書いていないか */
export function abstractEmpty(report: Report): boolean {
  return report.abstract.paragraphs.every((p) => p.content.every((n) => n.type === 'text' && !n.text.trim()))
}

/**
 * コースを変え、本文の下書きをそのコースのひな形に入れ替える。
 * 表紙の項目・参考文献・作品写真はそのまま。抄録は、まだ書いていなければ書き出しの例を入れ替える
 */
export function applyCourseTemplate(report: Report, config: YearConfig, courseId: string): Report {
  return {
    ...report,
    basicInfo: { ...report.basicInfo, courseId },
    body: bodyFromTemplate(courseTemplate(config, courseId)),
    abstract: abstractEmpty(report) ? { paragraphs: [emptyParagraph(abstractHint(config, courseId))] } : report.abstract,
  }
}
