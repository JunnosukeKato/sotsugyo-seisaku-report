import { describe, expect, it } from 'vitest'
import { demoReport } from './demoReport'
import { migrateReport } from './migrate'
import {
  addColumn,
  addColumnWidth,
  addRow,
  blankTable,
  cellPosition,
  clampTableSize,
  colWidthsOf,
  equalColumnWidths,
  fromMaterialTable,
  materialTable,
  moveColumnBorder,
  normalizeColumnWidths,
  removeColumn,
  removeColumnWidth,
  removeRow,
  setCellImage,
  swatchColumn,
  TABLE_SIZE,
} from './table'
import type { TableBlock } from './types'

let n = 0
const newId = (p: string) => `${p}${++n}`
const shape = (t: ReturnType<typeof blankTable>) => t.rows.map((r) => r.cells.length)

describe('表', () => {
  it('空の表は見出しの行と1行（2列）。素材表のひな形は名称・使用箇所・生地見本', () => {
    expect(shape(blankTable('t', newId))).toEqual([2, 2])
    const m = materialTable('t', newId)
    expect(m.rows[0].cells.map((c) => c.text)).toEqual(['名称', '使用箇所', '生地見本'])
    expect(swatchColumn(m)).toBe(2)
  })

  it('入れる前に大きさを選べる（3列×4行なら、見出しの行と3行。セルの ID はみな違う）', () => {
    const t = blankTable('t', newId, '', 3, 4)
    expect(shape(t)).toEqual([3, 3, 3, 3])
    const ids = t.rows.flatMap((r) => [r.id, ...r.cells.map((c) => c.id)])
    expect(new Set(ids).size).toBe(ids.length)
    expect(t.rows.flatMap((r) => r.cells).every((c) => c.text === '' && c.imageId === null)).toBe(true)
    expect(t.widths).toBe('equal')
  })

  it('大きさは 1〜6列・2〜10行に収める（見出しの行ともう1行は要る）。いつもは 2列×2行', () => {
    expect(shape(blankTable('t', newId, '', 6, 10))).toEqual(Array(10).fill(6))
    expect(shape(blankTable('t', newId, '', 9, 30))).toEqual(Array(10).fill(6))
    expect(shape(blankTable('t', newId, '', 0, 1))).toEqual([1, 1])
    expect(shape(blankTable('t', newId, '', Number.NaN, Number.NaN))).toEqual([2, 2])
    expect(clampTableSize(2.6, 3.2)).toEqual({ columns: 3, rows: 3 })
    expect(TABLE_SIZE).toMatchObject({ minColumns: 1, maxColumns: 6, minRows: 2, maxRows: 10, columns: 2, rows: 2 })
  })

  it('行は書いているセルの行の下に、列は右に足す。見出しの行と最後の1行・1列は消さない', () => {
    let t = blankTable('t', newId)
    const { table, firstCellId } = addRow(t, 1, newId)
    t = table
    expect(shape(t)).toEqual([2, 2, 2])
    expect(cellPosition(t, firstCellId)).toEqual({ row: 2, column: 0 })
    t = addColumn(t, 0, newId)
    expect(shape(t)).toEqual([3, 3, 3])
    expect(removeRow(t, 0)).toBe(t)
    t = removeRow(t, 2)
    expect(shape(t)).toEqual([3, 3])
    expect(removeRow(t, 1)).toBe(t)
    t = removeColumn(removeColumn(t, 0), 0)
    expect(shape(t)).toEqual([1, 1])
    expect(removeColumn(t, 0)).toBe(t)
  })

  it('セルに画像を入れる・外す', () => {
    const t = blankTable('t', newId)
    const id = t.rows[1].cells[1].id
    expect(setCellImage(t, id, 'img1').rows[1].cells[1].imageId).toBe('img1')
    expect(setCellImage(setCellImage(t, id, 'img1'), id, null).rows[1].cells[1].imageId).toBeNull()
  })

  it('新しい表・素材表・前の版の素材表は、行の高さ「中身に合わせる」・左端の列「ほかとそろえる」（今までどおり）', () => {
    for (const t of [blankTable('t', newId), materialTable('t', newId), fromMaterialTable({ id: 't', rows: [] })]) {
      expect(t).toMatchObject({ widths: 'equal', heights: 'auto' })
      expect(t.labelColumn).toBeUndefined()
    }
  })

  it('保存データ（自動保存・ドライブ・バックアップ）の、行の高さがない表は「中身に合わせる」。左端の列は true のときだけ残す', () => {
    const rows = [{ id: 'r', cells: [{ id: 'c', text: 'a', imageId: null }] }]
    const r = migrateReport({
      formatVersion: 1,
      body: [
        {
          id: 'c1',
          title: '章',
          blocks: [
            { type: 'table', id: 'old', caption: '', widths: 'auto', rows },
            { type: 'table', id: 'eq', caption: '', widths: 'equal', heights: 'equal', labelColumn: true, rows },
            { type: 'table', id: 'bad', caption: '', widths: 'equal', heights: 'tall', labelColumn: 'yes', rows },
            { type: 'table', id: 'off', caption: '', widths: 'equal', heights: 'auto', labelColumn: false, rows },
            { type: 'table', id: 'ph', caption: '', widths: 'equal', heights: 'photo', rows },
          ],
        },
      ],
    })
    const [old, eq, bad, off, ph] = r.body[0].blocks as TableBlock[]
    expect(ph).toMatchObject({ heights: 'photo' })
    expect(old).toMatchObject({ widths: 'auto', heights: 'auto' })
    expect('labelColumn' in old).toBe(false)
    expect(eq).toMatchObject({ widths: 'equal', heights: 'equal', labelColumn: true })
    expect(bad).toMatchObject({ heights: 'auto' })
    expect('labelColumn' in bad).toBe(false)
    expect('labelColumn' in off).toBe(false)
    // 前の版の素材表も、行の高さは「中身に合わせる」
    const m = migrateReport({ formatVersion: 1, body: [{ id: 'c', title: '', blocks: [{ type: 'materialTable', id: 'm', caption: '素材', rows: [] }] }] })
    expect(m.body[0].blocks[0]).toMatchObject({ type: 'table', heights: 'auto' })
  })

  it('前の版の素材表は、行と列を足せる表にする（文字と生地見本の写真は残る）', () => {
    const old = { type: 'materialTable', id: 't1', caption: '使用素材表', rows: [{ id: 'm1', name: 'サテン', usage: '上着', swatchImageId: 'sw1' }] }
    const report = migrateReport({ ...demoReport(), body: [{ id: 'c1', title: '企画', blocks: [old] }] })
    const t = report.body[0].blocks[0]
    expect(t).toEqual(fromMaterialTable(old))
    expect(t.type === 'table' && t.rows[1].cells.map((c) => [c.text, c.imageId])).toEqual([
      ['サテン', null],
      ['上着', null],
      ['', 'sw1'],
    ])
  })
})

describe('列の幅を自分で決める（mockups/v42）', () => {
  const tableOf = (n: number, colWidths?: number[]) => {
    const t = blankTable('t', newId, '', n, 2)
    return { ...t, widths: 'custom' as const, ...(colWidths ? { colWidths } : {}) }
  }

  it('同じ幅（合計はちょうど 100。端数は 0.1% の刻み）', () => {
    expect(equalColumnWidths(4)).toEqual([25, 25, 25, 25])
    const three = equalColumnWidths(3)
    expect(three.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10)
    expect(three.every((w) => Math.abs(w - 33.3) <= 0.11)).toBe(true)
  })

  it('決めた幅は、列の数と合うときだけ使う。合計 100 にし、どの列も 10% 以上にする', () => {
    expect(colWidthsOf(tableOf(3, [50, 30, 20]))).toEqual([50, 30, 20])
    expect(colWidthsOf(tableOf(3, [50, 50]))).toBeNull()
    expect(colWidthsOf(tableOf(3))).toBeNull()
    expect(normalizeColumnWidths([2, 1, 1], 3)).toEqual([50, 25, 25])
    const narrow = normalizeColumnWidths([5, 45, 50], 3)!
    expect(narrow[0]).toBe(10)
    expect(narrow.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10)
    expect(normalizeColumnWidths([1, Number.NaN, 1], 3)).toBeNull()
  })

  it('境目を動かすと、となりの2列だけが 5% ずつ変わる。どちらも 10% より狭くならない', () => {
    expect(moveColumnBorder([25, 25, 25, 25], 1, 11)).toEqual([25, 35, 15, 25])
    expect(moveColumnBorder([25, 25, 25, 25], 1, 6)).toEqual([25, 30, 20, 25])
    expect(moveColumnBorder([25, 25, 25, 25], 1, 2)).toEqual([25, 25, 25, 25])
    expect(moveColumnBorder([25, 35, 15, 25], 1, 30)).toEqual([25, 40, 10, 25])
    expect(moveColumnBorder([25, 35, 15, 25], 0, -40)).toEqual([10, 50, 15, 25])
    // 端数のある幅から：5% ずつ動き、10% で止まる
    expect(moveColumnBorder([23.1, 15.2, 39.7, 22], 0, -10)).toEqual([13.1, 25.2, 39.7, 22])
    expect(moveColumnBorder([23.1, 15.2, 39.7, 22], 0, 10)).toEqual([28.3, 10, 39.7, 22])
  })

  it('列を足すと、足した列はとなり（左）の列の幅を半分もらう。狭すぎるときは、ほかの列から少しずつ', () => {
    const t = addColumn(tableOf(4, [25, 40, 10, 25]), 1, newId)
    expect(t.colWidths).toEqual([25, 20, 20, 10, 25])
    const thin = addColumn(tableOf(3, [15, 60, 25]), 0, newId).colWidths!
    expect(thin.every((w) => w >= 10)).toBe(true)
    expect(thin.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10)
    // 決めた幅がない表は、今までどおり（幅を書かない）
    expect(addColumn(blankTable('t', newId, '', 2, 2), 0, newId).colWidths).toBeUndefined()
  })

  it('列を消すと、その幅は左どなりへ（いちばん左の列なら右どなりへ）', () => {
    expect(removeColumn(tableOf(4, [25, 20, 30, 25]), 2).colWidths).toEqual([25, 50, 25])
    expect(removeColumn(tableOf(4, [25, 20, 30, 25]), 0).colWidths).toEqual([45, 30, 25])
    expect(removeColumnWidth([60, 40], 1)).toEqual([100])
    expect(addColumnWidth([100], 0)).toEqual([50, 50])
  })

  it('保存データ：自分で決める・決めた幅を読む（幅の値が使えないものは捨てる）。前の版の表は変わらない', () => {
    const rows = [{ id: 'r', cells: [{ id: 'c', text: 'a', imageId: null }, { id: 'd', text: 'b', imageId: null }] }]
    const r = migrateReport({
      formatVersion: 1,
      body: [
        {
          id: 'c1',
          title: '章',
          blocks: [
            { type: 'table', id: 'a', caption: '', widths: 'custom', colWidths: [70, 30], rows },
            { type: 'table', id: 'b', caption: '', widths: 'auto', colWidths: [70, 30], rows },
            { type: 'table', id: 'x', caption: '', widths: 'custom', colWidths: ['70', 30], rows },
            { type: 'table', id: 'o', caption: '', widths: 'equal', rows },
          ],
        },
      ],
    })
    const [a, b, x, o] = r.body[0].blocks as TableBlock[]
    expect(a).toMatchObject({ widths: 'custom', colWidths: [70, 30] })
    expect(b).toMatchObject({ widths: 'auto', colWidths: [70, 30] })
    expect(x.widths).toBe('custom')
    expect('colWidths' in x).toBe(false)
    expect('colWidths' in o).toBe(false)
    expect(o.widths).toBe('equal')
  })
})
