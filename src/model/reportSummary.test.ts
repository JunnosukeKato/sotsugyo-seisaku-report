import { describe, expect, it } from 'vitest'
import { demoReport } from './demoReport'
import { reportSummary } from './reportSummary'

describe('原稿の中身の目安（自動の控えの一覧。mockups/v53 ④ 案A）', () => {
  it('本文の字数（空白を除く）・図・表・作品写真の枚数', () => {
    const r = demoReport()
    const s = reportSummary(r)
    expect(s).toMatch(/^本文 [\d,]+字/)
  })

  it('本文を書いていなければ「本文はまだ書いていません」', () => {
    const r = { ...demoReport(), body: [{ id: 'c', title: '企画', blocks: [{ type: 'paragraph' as const, id: 'p', content: [] }] }], workPhotos: [] }
    expect(reportSummary(r)).toBe('本文はまだ書いていません')
  })

  it('図は写真の入ったものだけ、作品写真は並べ方で載っている枚数だけ数える', () => {
    const r = {
      ...demoReport(),
      body: [{ id: 'c', title: '企画', blocks: [{ type: 'paragraph' as const, id: 'p', content: [{ type: 'text' as const, text: '袖を 大きくした。' }] }, { type: 'figureRow' as const, id: 'r', figures: [{ id: 'f1', imageId: 'a', caption: '' }, { id: 'f2', imageId: '', caption: '' }] }] }],
      workPhotos: [{ layout: 1 as const, imageIds: ['x', 'y'] }],
    }
    expect(reportSummary(r)).toBe('本文 8字・図 1枚・作品写真 1枚')
  })
})
