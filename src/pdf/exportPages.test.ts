import { describe, expect, it } from 'vitest'
import { currentConfig } from '../config'
import type { LayoutInfo } from '../layout/measure'
import { createReport } from '../model/newReport'
import type { Report } from '../model/types'
import { skippedPages } from './exportPages'

const layout = (kinds: LayoutInfo['kinds']): LayoutInfo => ({ kinds, bodyPages: 1, abstractPages: 1, abstractLines: 0, tocPageNumbers: {}, figuresPerBodyPage: [], pageBreaks: [] })
/** 紙面のページの代わり（どのページかだけ分かればよい） */
const pages = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }) as unknown as HTMLElement)

describe('PDF に入れないページ（作品写真の写真のないページ。mockups/v38 案A）', () => {
  const kinds: LayoutInfo['kinds'] = ['cover', 'abstract', 'toc', 'body', 'photos', 'photos', 'photos']
  const report = (workPhotos: Report['workPhotos']): Report => ({ ...createReport(currentConfig), workPhotos })

  it('写真のない作品写真のページだけ入れない（足したまま空のページ）', () => {
    const p = pages(7)
    const r = report([{ layout: 4, imageIds: ['a'] }, { layout: 4, imageIds: [] }, { layout: 1, imageIds: ['b'] }])
    expect(skippedPages(p, r, layout(kinds))).toEqual([p[5]])
  })

  it('どのページにも写真がなければ、作品写真のページはどれも入れない。写真がそろっていれば、どれも入れる', () => {
    const p = pages(7)
    expect(skippedPages(p, report([{ layout: 1, imageIds: [] }, { layout: 2, imageIds: ['', ''] }, { layout: 4, imageIds: [] }]), layout(kinds))).toEqual([p[4], p[5], p[6]])
    expect(skippedPages(p, report([{ layout: 1, imageIds: ['a'] }, { layout: 1, imageIds: ['b'] }, { layout: 1, imageIds: ['c'] }]), layout(kinds))).toEqual([])
  })

  it('並べ方で隠れている写真しかないページは、空とみなす（PDF に載る写真がない）', () => {
    const p = pages(5)
    expect(skippedPages(p, report([{ layout: 1, imageIds: ['', 'hidden'] }]), layout(kinds.slice(0, 5)))).toEqual([p[4]])
  })
})
