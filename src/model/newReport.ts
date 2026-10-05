import type { YearConfig } from '../config'
import type { Chapter, ParagraphBlock, Report } from './types'
import { DATA_FORMAT_VERSION } from './types'

/**
 * 新しい報告書。テンプレート（04_本文）の章立てを最初から用意する。
 * 見出しの番号（Ⅰ．ⅰ．）と図表の番号は自動で付くため、ここでは名前だけを持つ。
 */

let counter = 0
const id = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++counter}`
const emptyParagraph = (): ParagraphBlock => ({ type: 'paragraph', id: id('p'), content: [{ type: 'text', text: '' }] })

export function createReport(config: YearConfig): Report {
  const tableId = id('t')
  const body: Chapter[] = [
    {
      id: id('c'),
      title: '企画・立案',
      blocks: [
        { type: 'subheading', id: id('s'), title: '担当衣装のキャラクター' },
        emptyParagraph(),
        { type: 'subheading', id: id('s'), title: 'デザイン説明' },
        emptyParagraph(),
        { type: 'subheading', id: id('s'), title: '使用素材' },
        { type: 'paragraph', id: id('p'), content: [{ type: 'text', text: '' }, { type: 'ref', targetId: tableId, withParens: false }, { type: 'text', text: 'に使用した素材をまとめる。' }] },
        { type: 'materialTable', id: tableId, caption: '使用素材表', rows: [{ id: id('m'), name: '', usage: '', swatchImageId: null }] },
      ],
    },
    { id: id('c'), title: '制作過程', blocks: [{ type: 'subheading', id: id('s'), title: '' }, emptyParagraph()] },
    { id: id('c'), title: 'まとめ', blocks: [emptyParagraph()] },
  ]
  return {
    formatVersion: DATA_FORMAT_VERSION,
    fiscalYear: config.fiscalYear,
    basicInfo: { studentId: '', name: '', courseId: config.courses.length === 1 ? config.courses[0].id : '', subtitleInput: '' },
    abstract: { paragraphs: [emptyParagraph()] },
    body,
    references: [],
    workPhotos: { layout: 1, imageIds: [] },
    updatedAt: new Date().toISOString(),
  }
}
