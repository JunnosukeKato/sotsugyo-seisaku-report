import { describe, expect, it } from 'vitest'
import { currentConfig } from '../config'
import * as ops from '../editor/reportOps'
import type { LayoutInfo } from '../layout/measure'
import { demoReport } from '../model/demoReport'
import type { Report } from '../model/types'
import { abstractCharCount, checkReport } from './reportChecks'

const layout = (over: Partial<LayoutInfo> = {}): LayoutInfo => ({
  kinds: [],
  bodyPages: 5,
  abstractPages: 1,
  abstractLines: 18,
  tocPageNumbers: {},
  figuresPerBodyPage: [],
  pageBreaks: [],
  ...over,
})

const ids = (r: Report, l?: LayoutInfo) => checkReport(r, currentConfig, l).map((f) => f.ruleId)

/** 画像や参照などを満たした「指摘のない」報告書 */
function cleanReport(): Report {
  let r = demoReport()
  r = ops.setText(r, 'p1', '筆者が担当したのは、主人公の衣装である。')
  r = ops.setText(r, 'p2', 'デザインを考えた（図1）。')
  r = ops.setText(r, 'p4', '前身頃には金のブレードを縫い付けた。')
  r = ops.setText(r, 'p5', '袖口には細かいピンタックを施した。')
  r = {
    ...r,
    abstract: { paragraphs: [{ type: 'paragraph', id: 'a1', content: [{ type: 'text', text: 'あ'.repeat(700) + 'である。' }] }] },
    body: r.body.map((c) => ({
      ...c,
      blocks: c.blocks.map((b) =>
        b.type === 'figureRow'
          ? { ...b, figures: b.figures.map((f) => ({ ...f, imageId: 'img1' })) }
          : b.type === 'materialTable'
            ? { ...b, rows: b.rows.map((row) => ({ ...row, swatchImageId: 'sw' })) }
            : b,
      ),
    })),
    workPhotos: { layout: 2, imageIds: ['ph1', 'ph2'] },
  }
  return r
}

describe('checkReport', () => {
  it('条件を満たした報告書には指摘がない', () => {
    expect(checkReport(cleanReport(), currentConfig, layout())).toEqual([])
  })

  it('架空の見本の誤りを見つける（文章のルールには紙面上の位置が付く）', () => {
    const findings = checkReport(demoReport(), currentConfig, layout())
    const firstPerson = findings.find((f) => f.ruleId === 'first-person')
    expect(firstPerson).toMatchObject({ area: 'body', blockId: 'p1', severity: 'error' })
    expect(findings.map((f) => f.ruleId)).toEqual(expect.arrayContaining(['digit-fullwidth', 'desu-masu', 'seisaku', 'choon-dash', 'figure-image', 'photos-required']))
  })

  it('表紙の未入力の項目とコースを指摘する', () => {
    const r = { ...cleanReport(), basicInfo: { studentId: '', name: '', courseId: 'none', subtitleInput: '' } }
    expect(ids(r, layout()).filter((x) => x === 'required-field')).toHaveLength(4)
  })

  it('抄録の字数・行数・ページ数を判定する', () => {
    const r = cleanReport()
    expect(abstractCharCount(r)).toBe(704)
    const short = { ...r, abstract: { paragraphs: [{ type: 'paragraph' as const, id: 'a1', content: [{ type: 'text' as const, text: '短い。' }] }] } }
    const finding = checkReport(short, currentConfig, layout()).find((f) => f.ruleId === 'abstract-length')
    expect(finding?.detail).toBe('現在 3字（あと597字）')
    expect(ids(r, layout({ abstractLines: 24 }))).toContain('abstract-lines')
    expect(ids(r, layout({ abstractPages: 2 }))).toContain('abstract-one-page')
  })

  it('本文が5ページ未満ならエラー。組版の結果がなければページ数は判定しない', () => {
    expect(ids(cleanReport(), layout({ bodyPages: 4 }))).toContain('body-pages')
    expect(ids(cleanReport())).not.toContain('body-pages')
  })

  it('本文から参照されていない図表を指摘する', () => {
    const r = ops.setText(cleanReport(), 'p2', 'デザインを考えた。')
    expect(ids(r, layout())).toContain('figure-unreferenced')
    expect(ids(r, layout())).not.toContain('table-unreferenced')
  })

  it('存在しない図の番号を指摘する', () => {
    const r = ops.setText(cleanReport(), 'p4', '縫い付けた（図9）。')
    const finding = checkReport(r, currentConfig, layout()).find((f) => f.ruleId === 'reference-missing')
    expect(finding).toMatchObject({ blockId: 'p4', start: 5, end: 9 })
  })

  it('引用・参考文献の未入力の項目を指摘する', () => {
    const r = { ...cleanReport(), references: [{ type: 'web' as const, id: 'w', siteTitle: 'サイト', url: '', accessedOn: '' }] }
    expect(ids(r, layout()).filter((x) => x === 'reference-field')).toHaveLength(2)
  })

  it('画像が1ページあたりの目安より多いと警告する', () => {
    expect(ids(cleanReport(), layout({ bodyPages: 0 }))).toContain('figures-per-page')
  })
})

describe('改ページ', () => {
  it('改ページでページの半分以上が空いていると注意を出す（半分より少なければ出さない）', () => {
    const report = demoReport()
    expect(ids(report, layout({ pageBreaks: [{ id: 'pb1', page: 4, emptyRatio: 0.7 }] }))).toContain('page-break-gap')
    expect(ids(report, layout({ pageBreaks: [{ id: 'pb1', page: 4, emptyRatio: 0.3 }] }))).not.toContain('page-break-gap')
  })
})
