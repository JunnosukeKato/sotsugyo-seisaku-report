import { describe, expect, it } from 'vitest'
import type { Chapter, TableBlock } from '../model/types'
import { bodyContentHtml, noWrapLimit, shortText } from './bodyHtml'
import { equalRows, fitsFor, fitsLabel, ptText, readTableFits, sameTableFits, settleFit } from './tableFit'

const cell = (id: string, text: string) => ({ id, text, imageId: null })
const table = (id: string, extra: Partial<TableBlock> = {}): TableBlock => ({
  type: 'table',
  id,
  caption: '素材',
  widths: 'equal',
  heights: 'auto',
  rows: [
    { id: `${id}h`, cells: [cell(`${id}h0`, '項目'), cell(`${id}h1`, '内容')] },
    { id: `${id}r1`, cells: [cell(`${id}a0`, '素材'), cell(`${id}a1`, 'コットン')] },
    { id: `${id}r2`, cells: [cell(`${id}b0`, '色'), cell(`${id}b1`, '紺')] },
  ],
  ...extra,
})
const chapters = (...blocks: TableBlock[]): Chapter[] => [{ id: 'c1', title: '章', blocks }]
const options = { imageSrc: (id: string) => `img/${id}`, figureSize: () => ({ widthMm: 50, heightMm: 40 }) }

describe('表の行の高さ・左端の列（測って決める寸法）', () => {
  it('行の高さを「そろえる」表・左端の列を「中身に合わせる」表（列の幅が「そろえる」のときだけ）を見分ける', () => {
    expect(equalRows(table('t'))).toBe(false)
    expect(equalRows(table('t', { heights: 'equal' }))).toBe(true)
    expect(fitsLabel(table('t'))).toBe(false)
    expect(fitsLabel(table('t', { labelColumn: true }))).toBe(true)
    expect(fitsLabel(table('t', { labelColumn: true, widths: 'auto' }))).toBe(false)
    // 前の版の原稿（行の高さがない）は、中身に合わせる
    expect(equalRows({ ...table('t'), heights: undefined } as unknown as TableBlock)).toBe(false)
  })

  it('測った値は 0.25pt に切り上げる。前の値とほぼ同じか、少し大きいだけなら、前の値のまま（組み直しが落ち着く）', () => {
    expect(settleFit(undefined, 30.1)).toBe(30.25)
    expect(settleFit(undefined, 30)).toBe(30)
    expect(settleFit(30.25, 30.1)).toBe(30.25)
    expect(settleFit(30.25, 30.28)).toBe(30.25)
    // 中身が高くなった：測った値に（書いた高さが中身より低くならないように）
    expect(settleFit(30.25, 31)).toBe(31)
    // 中身が低くなった：測った値に
    expect(settleFit(30.25, 20.1)).toBe(20.25)
    // 行の高さは 0.75pt（CSS の 1px）の刻み
    expect(settleFit(undefined, 120.1, 0.75)).toBe(120.75)
    expect(settleFit(120.75, 120.1, 0.75)).toBe(120.75)
    expect(settleFit(120.75, 120.05, 0.75)).toBe(120.75)
    expect(settleFit(120.75, 119.9, 0.75)).toBe(120)
    expect(settleFit(120.75, 119.5, 0.75)).toBe(120)
    expect(ptText(30.25)).toBe('30.25pt')
    expect(ptText(12)).toBe('12pt')
  })

  it('今の原稿で測る表の分だけを残す（消した表・「中身に合わせる」に戻した表の寸法は使わない）', () => {
    const fits = { a: { row: 30 }, b: { row: 40, label: 50 }, c: { row: 10 }, gone: { row: 5 } }
    const kept = fitsFor(chapters(table('a', { heights: 'equal' }), table('b', { labelColumn: true }), table('c')), fits)
    expect(kept).toEqual({ a: { row: 30 }, b: { label: 50 } })
    expect(sameTableFits(kept, { b: { label: 50 }, a: { row: 30 } })).toBe(true)
    expect(sameTableFits(kept, { a: { row: 30 }, b: { label: 51 } })).toBe(false)
    expect(sameTableFits(kept, { a: { row: 30 } })).toBe(false)
  })

  it('この端末に覚えた寸法は、形を確かめてから使う（前の版で覚えたもの・壊れたものは捨てる）', () => {
    expect(readTableFits(undefined)).toEqual({})
    expect(readTableFits([1, 2])).toEqual({})
    expect(readTableFits({ a: { row: 30, label: '9' }, b: null, c: { row: -1 }, d: { label: 12.5 } })).toEqual({ a: { row: 30 }, d: { label: 12.5 } })
  })

  it('今までの表（行の高さ：中身に合わせる・左端の列：ほかとそろえる）の HTML は前と同じ（印の class・高さ・幅を書かない）', () => {
    const html = bodyContentHtml(chapters(table('t')), { ...options, tableFits: { t: { row: 40, label: 30 } } })
    expect(html).toContain('<table class="widths-equal"><thead><tr><th data-cell-id="th0">')
    expect(html).not.toContain('heights-equal')
    expect(html).not.toContain('colgroup')
    expect(html).not.toContain('style="height')
    const auto = bodyContentHtml(chapters(table('t', { widths: 'auto', labelColumn: true })), options)
    expect(auto).toContain('<table class="widths-auto"><thead>')
  })

  it('行の高さを「そろえる」表：見出しの行のほかの行に、測った高さを書く（測る前は印の class だけ）', () => {
    const before = bodyContentHtml(chapters(table('t', { heights: 'equal' })), options)
    expect(before).toContain('<table class="widths-equal heights-equal"><thead><tr><th')
    expect(before).not.toContain('style="height')
    const html = bodyContentHtml(chapters(table('t', { heights: 'equal' })), { ...options, tableFits: { t: { row: 40.25 } } })
    // 見出しの行は、中身に合わせたまま
    expect(html).toContain('<thead><tr><th')
    expect(html.match(/<tr style="height:40\.25pt">/g)).toHaveLength(2)
  })

  it('行の高さを「写真が入る高さ」にした表：印の class だけ付け、測った高さは書かない（高さは CSS）', () => {
    const html = bodyContentHtml(chapters(table('t', { heights: 'photo' })), { ...options, tableFits: { t: { row: 40 } } })
    expect(html).toContain('<table class="widths-equal heights-photo"><thead><tr><th')
    expect(html).not.toContain('style="height')
    expect(fitsFor(chapters(table('t', { heights: 'photo' })), { t: { row: 40 } })).toEqual({})
  })

  it('列の幅「中身に合わせる」の表：短い字のセルは折り返さない印（nw）。字数の上限は列の数で決める。「そろえる」の表には付けない', () => {
    expect([1, 2, 3, 4, 5, 6].map(noWrapLimit)).toEqual([37, 18, 11, 8, 6, 5])
    expect(shortText('コットンサテン', 8)).toBe(true)
    expect(shortText('コットンブロード', 8)).toBe(true)
    expect(shortText('やわらかい光沢があり', 8)).toBe(false)
    // 改行で分けた行ごとに数える。半角は半分
    expect(shortText('紺と金\n袖口だけ赤', 8)).toBe(true)
    expect(shortText('cotton satin', 8)).toBe(true)
    // 空のセル・空白の続く字は、折り返さない印を付けない
    expect(shortText('', 8)).toBe(false)
    expect(shortText('紺  金', 8)).toBe(false)
    expect(shortText(' 紺', 8)).toBe(false)
    const t = table('t', { widths: 'auto' })
    t.rows[1].cells[1].text = 'やわらかい光沢があり、照明が当たると表面が光る'
    const html = bodyContentHtml(chapters(t), options)
    expect(html).toContain('<th data-cell-id="th0" class="nw">')
    expect(html).toContain('<td data-cell-id="ta0" class="nw">')
    expect(html).toContain('<td data-cell-id="ta1">')
    expect(bodyContentHtml(chapters(table('t')), options)).not.toContain('class="nw"')
  })

  it('左端の列を「中身に合わせる」表：左端の列にだけ、測った幅を書く（ほかの列は、残りを同じ幅で分ける）', () => {
    const html = bodyContentHtml(chapters(table('t', { labelColumn: true })), { ...options, tableFits: { t: { label: 36.5 } } })
    expect(html).toContain('<table class="widths-equal label-column"><colgroup><col style="width:36.5pt"></colgroup><thead>')
  })

  it('列の幅を「自分で決める」表：列ごとの幅（%）を colgroup に書く（決めた幅がない・数が合わないときは同じ幅）。左端の列・短い字の印は使わない', () => {
    const html = bodyContentHtml(chapters(table('t', { widths: 'custom', colWidths: [70, 30], labelColumn: true })), { ...options, tableFits: { t: { label: 30 } } })
    expect(html).toContain('<table class="widths-custom"><colgroup><col style="width:70%"><col style="width:30%"></colgroup><thead>')
    expect(html).not.toContain('class="nw"')
    expect(fitsLabel(table('t', { widths: 'custom', labelColumn: true }))).toBe(false)
    const even = bodyContentHtml(chapters(table('t', { widths: 'custom', colWidths: [10, 20, 70] })), options)
    expect(even).toContain('<colgroup><col style="width:50%"><col style="width:50%"></colgroup>')
    // 自分で決めた幅を覚えていても、そろえる・中身に合わせるの表は、前と同じ HTML
    expect(bodyContentHtml(chapters(table('t', { colWidths: [70, 30] })), options)).toContain('<table class="widths-equal"><thead>')
  })
})
