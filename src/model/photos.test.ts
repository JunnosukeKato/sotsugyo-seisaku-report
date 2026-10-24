import { describe, expect, it } from 'vitest'
import { migrateReport } from './migrate'
import { demoReport } from './demoReport'
import {
  addPhotoPage,
  canAddPhotoPage,
  changeArrangement,
  emptyPhotoPages,
  fittingArrangement,
  movePhoto,
  packPhotos,
  pageOfPhotoPage,
  photoCount,
  photoGrid,
  photoPageAt,
  photoPageName,
  photoSlots,
  placePhotos,
  PHOTO_ARRANGEMENTS,
  putPhoto,
  removePhotoPage,
  shownPhotos,
  wholePhoto,
} from './photos'
import { DATA_FORMAT_VERSION, type WorkPhotoPage } from './types'

describe('作品写真の並べ方', () => {
  it('並べ方は4つ（1枚・2枚左右・2枚上下・4枚）。6枚の並べ方はない（mockups/v38）', () => {
    expect(PHOTO_ARRANGEMENTS.map((a) => [a.layout, a.columns])).toEqual([
      [1, 1],
      [2, 2],
      [2, 1],
      [4, 2],
    ])
  })

  it('2枚は並べ方を選べる（選ばなければ左右）', () => {
    expect(photoGrid({ layout: 2 })).toMatchObject({ columns: 2, rows: 1 })
    expect(photoGrid({ layout: 2, columns: 1 })).toMatchObject({ columns: 1, rows: 2 })
    expect(photoGrid({ layout: 4, columns: 3 })).toMatchObject({ columns: 2, rows: 2 })
  })

  it('4枚から1枚にすると1枚目が載り、4枚に戻すと2〜4枚目も戻る', () => {
    const four: WorkPhotoPage = { layout: 4, imageIds: ['a', 'b', 'c', 'd'], positions: [null, { x: 10, y: 20 }, null, null] }
    const one = changeArrangement(four, 1, 1)
    expect(shownPhotos(one).map((p) => p.imageId)).toEqual(['a'])
    const back = changeArrangement(one, 4, 2)
    expect(shownPhotos(back).map((p) => p.imageId)).toEqual(['a', 'b', 'c', 'd'])
    expect(back.positions?.[1]).toEqual({ x: 10, y: 20 })
  })

  it('並べ方を変えると、入っている写真を先頭へ詰める（空いた枠が先頭に残らない）', () => {
    const photos: WorkPhotoPage = { layout: 4, imageIds: ['', 'b', '', 'd'] }
    expect(shownPhotos(changeArrangement(photos, 1, 1)).map((p) => p.imageId)).toEqual(['b'])
    expect(shownPhotos(changeArrangement(photos, 2, 1)).map((p) => p.imageId)).toEqual(['b', 'd'])
  })

  it('写真を入れ替えると切り抜く位置は中央に戻り、動かした位置は 0〜100% に収める', () => {
    const photos: WorkPhotoPage = { layout: 2, imageIds: ['a'], positions: [{ x: 0, y: 0 }] }
    const put = putPhoto(photos, 0, 'z')
    expect(put.imageIds).toEqual(['z'])
    expect(put.positions).toEqual([null])
    expect(putPhoto(photos, 1, 'b').imageIds).toEqual(['a', 'b'])
    expect(movePhoto(photos, 0, { x: -30, y: 140 }).positions?.[0]).toEqual({ x: 0, y: 100 })
  })

  it('「全体を入れる（切らない）」は写真ごとに選べ、切らない写真がなければ項目ごと持たない（mockups/v32 ③ 案A）', () => {
    const photos: WorkPhotoPage = { layout: 2, imageIds: ['a', 'b'], positions: [{ x: 10, y: 20 }, null] }
    expect(shownPhotos(photos).map((p) => p.whole)).toEqual([false, false])
    const on = wholePhoto(photos, 0, true)
    expect(on.whole).toEqual([true, false])
    expect(shownPhotos(on).map((p) => p.whole)).toEqual([true, false])
    // 切り抜く位置は残しておく（切り抜くのに戻したとき、前の位置で見える）
    expect(on.positions?.[0]).toEqual({ x: 10, y: 20 })
    const off = wholePhoto(on, 0, false)
    expect(off).toEqual(photos)
    expect('whole' in off).toBe(false)
  })

  it('並べ方を変えても、写真を詰めても、「全体を入れる」は写真といっしょに動く', () => {
    const photos: WorkPhotoPage = { layout: 4, imageIds: ['', 'b', '', 'd'], whole: [false, false, false, true] }
    const two = changeArrangement(photos, 2, 1)
    expect(two.imageIds).toEqual(['b', 'd'])
    expect(two.whole).toEqual([false, true])
    expect(shownPhotos(changeArrangement(two, 1, 1)).map((p) => [p.imageId, p.whole])).toEqual([['b', false]])
    expect(changeArrangement(changeArrangement(two, 1, 1), 4, 2).whole).toEqual([false, true])
  })

  it('写真を差し替える・外すと、その枠は「全体を入れる」を外し、切り抜く位置も中央に戻す（ほかの写真はそのまま）', () => {
    const photos: WorkPhotoPage = { layout: 2, imageIds: ['a', 'b'], positions: [{ x: 0, y: 0 }, null], whole: [true, true] }
    const replaced = putPhoto(photos, 0, 'z')
    expect(replaced.imageIds).toEqual(['z', 'b'])
    expect(replaced.whole).toEqual([false, true])
    expect(replaced.positions?.[0]).toBeNull()
    const removed = putPhoto(putPhoto(photos, 0, ''), 1, '')
    expect(removed.imageIds).toEqual(['', ''])
    expect('whole' in removed).toBe(false)
  })
})

describe('前の版の原稿の作品写真（1ページの形）を読む', () => {
  const report = demoReport()
  const migrate = (workPhotos: unknown) => migrateReport({ ...report, formatVersion: 1, workPhotos }).workPhotos

  it('1ページの形は、1ページの並びにする。「全体を入れる」がなければ、どの写真も今までどおり切り抜く。壊れた値は切り抜くとみなす', () => {
    expect(migrate({ layout: 2, imageIds: ['a', 'b'] })).toEqual([{ layout: 2, imageIds: ['a', 'b'] }])
    expect(shownPhotos(migrate({ layout: 2, imageIds: ['a', 'b'] })[0]).every((p) => !p.whole)).toBe(true)
    expect(migrate({ layout: 2, imageIds: ['a', 'b'], whole: [true, 'yes'] })[0].whole).toEqual([true, false])
    expect(migrate({ layout: 2, imageIds: ['a'], whole: [false, 1] })).toEqual([{ layout: 2, imageIds: ['a'] }])
  })

  it('前の版の「3枚」は4枚にする（写真は残る）', () => {
    expect(migrate({ layout: 3, imageIds: ['a', 'b', 'c'] })).toEqual([{ layout: 4, imageIds: ['a', 'b', 'c'] }])
  })

  it('6枚の原稿は、1ページ目を4枚にして、5・6枚目の写真を2ページ目（2枚・上下）に移す。写真・見える位置・「全体を入れる」は消さない（mockups/v38）', () => {
    const pages = migrate({
      layout: 6,
      columns: 3,
      imageIds: ['a', 'b', 'c', 'd', 'e', 'f'],
      positions: [null, { x: 10, y: 20 }, null, null, { x: 30, y: 40 }, null],
      whole: [false, false, false, false, false, true],
    })
    expect(pages).toEqual([
      { layout: 4, imageIds: ['a', 'b', 'c', 'd'], positions: [null, { x: 10, y: 20 }, null, null] },
      { layout: 2, columns: 1, imageIds: ['e', 'f'], positions: [{ x: 30, y: 40 }, null], whole: [false, true] },
    ])
    expect(photoCount(pages)).toBe(6)
  })

  it('6枚の原稿で5・6枚目の枠の片方だけに写真があれば、2ページ目は1枚。どちらも空なら、2ページ目は作らない', () => {
    expect(migrate({ layout: 6, imageIds: ['a', 'b', 'c', 'd', '', 'f'] })).toEqual([
      { layout: 4, imageIds: ['a', 'b', 'c', 'd'] },
      { layout: 1, imageIds: ['f'] },
    ])
    expect(migrate({ layout: 6, imageIds: ['a', '', 'c'] })).toEqual([{ layout: 4, imageIds: ['a', '', 'c', ''] }])
  })

  it('作品写真がない・壊れている原稿は、空の1ページにする。新しい形（ページの並び）は、そのまま読む', () => {
    expect(migrate(undefined)).toEqual([{ layout: 1, imageIds: [] }])
    expect(migrate([])).toEqual([{ layout: 1, imageIds: [] }])
    expect(migrate('x')).toEqual([{ layout: 1, imageIds: [] }])
    expect(migrate([null, 'x', [1], { layout: 1, imageIds: ['a'] }])).toEqual([{ layout: 1, imageIds: ['a'] }])
    const pages = [
      { layout: 4, imageIds: ['a', 'b', 'c', 'd'] },
      { layout: 2, columns: 1, imageIds: ['e'] },
    ]
    expect(migrateReport({ ...report, workPhotos: pages }).workPhotos).toEqual(pages)
  })

  it('読んだ原稿は新しい形の番号になる。もっと新しい版の原稿は読まない（前の版のツールで、ページの並びの原稿を壊さないため）', () => {
    expect(migrateReport({ ...report, formatVersion: 1 }).formatVersion).toBe(DATA_FORMAT_VERSION)
    expect(() => migrateReport({ ...report, formatVersion: DATA_FORMAT_VERSION + 1 })).toThrow('新しい版のツール')
  })
})

describe('作品写真の何ページか（mockups/v38 案A）', () => {
  const p1: WorkPhotoPage = { layout: 4, imageIds: ['a', 'b', 'c', 'd'] }
  const p2: WorkPhotoPage = { layout: 2, columns: 1, imageIds: ['e', ''] }

  it('ページを足すと、そのページと同じ並べ方の空のページが、すぐ後ろに入る', () => {
    expect(addPhotoPage([p1], 0)).toEqual([p1, { layout: 4, imageIds: [] }])
    expect(addPhotoPage([p1, p2], 0)).toEqual([p1, { layout: 4, imageIds: [] }, p2])
    expect(addPhotoPage([p1, p2], 1)).toEqual([p1, p2, { layout: 2, columns: 1, imageIds: [] }])
  })

  it('ページを消すと、中の写真ごとなくなる。1ページだけのときは消さない', () => {
    expect(removePhotoPage([p1, p2], 0)).toEqual([p2])
    expect(removePhotoPage([p1], 0)).toEqual([p1])
    expect(removePhotoPage([p1, p2], 5)).toEqual([p1, p2])
  })

  it('ページ数の上限：null は上限なし、数ならそのページ数まで', () => {
    expect(canAddPhotoPage([p1, p2], null)).toBe(true)
    expect(canAddPhotoPage([p1, p2], 3)).toBe(true)
    expect(canAddPhotoPage([p1, p2], 2)).toBe(false)
  })

  it('写真の数・空のページ（並べ方で隠れている写真は数えない）', () => {
    expect(photoCount([p1, p2])).toBe(5)
    expect(photoCount([{ layout: 1, imageIds: ['a', 'b'] }])).toBe(1)
    expect(emptyPhotoPages([p1, { layout: 4, imageIds: [] }, p2])).toEqual([1])
  })

  it('選んだ写真を入れる枠：押した枠から後ろ・前 → 後ろのページの空いている枠 → 足りなければ、最後のページと同じ並べ方のページを足す（上限なし）', () => {
    const half: WorkPhotoPage = { layout: 4, imageIds: ['a', '', 'c', ''] }
    expect(photoSlots([half, p2], 0, 3, 3, null)).toEqual([
      { page: 0, index: 3 },
      { page: 0, index: 1 },
      { page: 1, index: 1 },
    ])
    // 6枚選んだ：1ページ目の空き2つ、2ページ目の空き1つ、足した3ページ目（2枚・上下）に2つ、4ページ目に1つ
    expect(photoSlots([half, p2], 0, 1, 6, null)).toEqual([
      { page: 0, index: 1 },
      { page: 0, index: 3 },
      { page: 1, index: 1 },
      { page: 2, index: 0 },
      { page: 2, index: 1 },
      { page: 3, index: 0 },
    ])
  })

  it('ページ数の上限があると、上限のページまでしか入れない（入れる枠が選んだ数より少なくなる）', () => {
    expect(photoSlots([p1], 0, 0, 6, 2)).toEqual([0, 1, 2, 3].map((index) => ({ page: 1, index })))
    expect(photoSlots([p1], 0, 0, 6, 1)).toEqual([])
  })

  it('入れる枠のページがまだなければ、最後のページと同じ並べ方のページを足して入れる', () => {
    const pages = placePhotos([p1], [
      { page: 1, index: 0, imageId: 'x' },
      { page: 1, index: 1, imageId: 'y' },
      { page: 2, index: 0, imageId: 'z' },
    ])
    expect(pages.map((p) => [p.layout, shownPhotos(p).map((s) => s.imageId)])).toEqual([
      [4, ['a', 'b', 'c', 'd']],
      [4, ['x', 'y', '', '']],
      [4, ['z', '', '', '']],
    ])
  })

  it('紙面のページの種類の並びから、何ページ目の作品写真か・作品写真のページの通しの番号・名前', () => {
    const kinds = ['cover', 'abstract', 'toc', 'body', 'body', 'photos', 'photos']
    expect(photoPageAt(kinds, 5)).toBe(0)
    expect(photoPageAt(kinds, 6)).toBe(1)
    expect(photoPageAt(kinds, 4)).toBeNull()
    expect(pageOfPhotoPage(kinds, 1)).toBe(6)
    expect(pageOfPhotoPage(kinds, 2)).toBe(-1)
    expect(photoPageName(0, 1)).toBe('作品写真')
    expect(photoPageName(1, 2)).toBe('作品写真 2')
  })
})

describe('作品写真をまとめて選んだとき・並べ方を変えたとき（学生の試し 2026-10-24。mockups/v53 ① 案C）', () => {
  it('枚数に合う並べ方：1枚・2枚は左右・3〜4枚は4枚', () => {
    expect(fittingArrangement(1)).toEqual({ layout: 1, columns: 1 })
    expect(fittingArrangement(2)).toEqual({ layout: 2, columns: 2 })
    expect(fittingArrangement(3)).toEqual({ layout: 4, columns: 2 })
    expect(fittingArrangement(4)).toEqual({ layout: 4, columns: 2 })
  })

  it('枠の多い並べ方にしたら、次のページの写真を詰め、写真がなくなったページは消す（切り抜く位置・全体を入れるもいっしょに）', () => {
    const pages: WorkPhotoPage[] = [
      { layout: 2, columns: 2, imageIds: ['a'] },
      { layout: 1, imageIds: ['b'], positions: [{ x: 30, y: 40 }], whole: [true] },
      { layout: 1, imageIds: ['c'] },
    ]
    const r = packPhotos(pages, 0)
    expect(r.moved).toBe(1)
    expect(r.removed).toBe(1)
    expect(r.pages.map((p) => p.imageIds.join('+'))).toEqual(['a+b', 'c'])
    expect(r.pages[0].positions?.[1]).toEqual({ x: 30, y: 40 })
    expect(r.pages[0].whole).toEqual([false, true])
  })

  it('次のページに残る写真は、そのページの先頭へ。空きがなければ何もしない', () => {
    const pages: WorkPhotoPage[] = [
      { layout: 4, columns: 2, imageIds: ['a', 'b'] },
      { layout: 4, columns: 2, imageIds: ['c', 'd', 'e', 'f'] },
    ]
    const r = packPhotos(pages, 0)
    expect(r.pages.map((p) => p.imageIds.join('+'))).toEqual(['a+b+c+d', 'e+f'])
    expect(r.removed).toBe(0)
    const full = packPhotos([{ layout: 1, imageIds: ['a'] }, { layout: 1, imageIds: ['b'] }], 0)
    expect(full.moved).toBe(0)
    expect(full.pages.map((p) => p.imageIds.join('+'))).toEqual(['a', 'b'])
  })
})
