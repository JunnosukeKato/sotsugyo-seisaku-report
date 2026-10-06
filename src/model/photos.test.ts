import { describe, expect, it } from 'vitest'
import { migrateReport } from './migrate'
import { demoReport } from './demoReport'
import { changeArrangement, movePhoto, photoGrid, putPhoto, shownPhotos } from './photos'
import type { WorkPhotos } from './types'

describe('作品写真の並べ方', () => {
  it('2枚と6枚は並べ方を選べる（選ばなければ、2枚は左右・6枚は2列×3段）', () => {
    expect(photoGrid({ layout: 2 })).toMatchObject({ columns: 2, rows: 1 })
    expect(photoGrid({ layout: 2, columns: 1 })).toMatchObject({ columns: 1, rows: 2 })
    expect(photoGrid({ layout: 6 })).toMatchObject({ columns: 2, rows: 3 })
    expect(photoGrid({ layout: 6, columns: 3 })).toMatchObject({ columns: 3, rows: 2 })
    expect(photoGrid({ layout: 4, columns: 3 })).toMatchObject({ columns: 2, rows: 2 })
  })

  it('4枚から1枚にすると1枚目が載り、4枚に戻すと2〜4枚目も戻る', () => {
    const four: WorkPhotos = { layout: 4, imageIds: ['a', 'b', 'c', 'd'], positions: [null, { x: 10, y: 20 }, null, null] }
    const one = changeArrangement(four, 1, 1)
    expect(shownPhotos(one).map((p) => p.imageId)).toEqual(['a'])
    const back = changeArrangement(one, 4, 2)
    expect(shownPhotos(back).map((p) => p.imageId)).toEqual(['a', 'b', 'c', 'd'])
    expect(back.positions?.[1]).toEqual({ x: 10, y: 20 })
  })

  it('並べ方を変えると、入っている写真を先頭へ詰める（空いた枠が先頭に残らない）', () => {
    const photos: WorkPhotos = { layout: 4, imageIds: ['', 'b', '', 'd'] }
    expect(shownPhotos(changeArrangement(photos, 1, 1)).map((p) => p.imageId)).toEqual(['b'])
    expect(shownPhotos(changeArrangement(photos, 2, 1)).map((p) => p.imageId)).toEqual(['b', 'd'])
  })

  it('写真を入れ替えると切り抜く位置は中央に戻り、動かした位置は 0〜100% に収める', () => {
    const photos: WorkPhotos = { layout: 2, imageIds: ['a'], positions: [{ x: 0, y: 0 }] }
    const put = putPhoto(photos, 0, 'z')
    expect(put.imageIds).toEqual(['z'])
    expect(put.positions).toEqual([null])
    expect(putPhoto(photos, 1, 'b').imageIds).toEqual(['a', 'b'])
    expect(movePhoto(photos, 0, { x: -30, y: 140 }).positions?.[0]).toEqual({ x: 0, y: 100 })
  })

  it('前の版の「3枚」は4枚にする（写真は残る）', () => {
    const report = demoReport()
    const raw = { ...report, workPhotos: { layout: 3, imageIds: ['a', 'b', 'c'] } }
    expect(migrateReport(raw).workPhotos).toEqual({ layout: 4, imageIds: ['a', 'b', 'c'] })
  })
})
