import { describe, expect, it } from 'vitest'
import { demoReport } from './demoReport'
import { migrateReport } from './migrate'
import { addColumn, addRow, blankTable, cellPosition, fromMaterialTable, materialTable, removeColumn, removeRow, setCellImage, swatchColumn } from './table'

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
