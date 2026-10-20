// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { Chapter } from '../model/types'
import { decideDeferredGroups, landsInTable, wouldSplitTable, type FloatLayout, type Placed } from './figureFloat'

/**
 * 図の送り方（figureFloat.ts）を、組んだ紙面の代わりの位置（ページの番号と mm）で確かめる。
 * 本文：段落 p1（図1を指す）→ 図のまとまり g1 → 段落 p2 → 表 t1 → 段落 p3。1ページ目の下（本文の下端は 272mm）に p1 があり、図が入りきらない
 */
const chapter: Chapter = {
  id: 'c1',
  title: '制作過程',
  blocks: [
    { type: 'paragraph', id: 'p1', content: [{ type: 'text', text: '素材を選んだ' }] },
    { type: 'figureRow', id: 'g1', figures: [{ id: 'f1', imageId: 'i1', caption: '素材' }] },
    { type: 'paragraph', id: 'p2', content: [{ type: 'text', text: '使った素材は次の表のとおりである。' }] },
    { type: 'table', id: 't1', caption: '使用素材表', widths: 'equal', heights: 'auto', rows: [] },
    { type: 'paragraph', id: 'p3', content: [{ type: 'text', text: '続き' }] },
  ],
}

const at = (page: number, top: number, bottom: number): Placed => ({ page, top, bottom })

/** 作り物の紙面の位置。どのページも本文のページで、2ページ目からは章の続き */
function layout(places: { groups?: Record<string, Placed[]>; blocks?: Record<string, Placed[]>; tables?: Record<string, Placed[]>; heads?: Record<string, number>; bottoms?: Record<number, number> }): FloatLayout {
  return {
    group: (id) => places.groups?.[id] ?? [],
    block: (id) => places.blocks?.[id] ?? [],
    table: (id) => places.tables?.[id] ?? [],
    // 表のタイトルと最初の行の高さ（ふつうは 20mm）
    tableHead: (id) => places.heads?.[id] ?? 20,
    continuesChapter: (page) => page > 0,
    contentBottom: (page) => places.bottoms?.[page] ?? 272,
  }
}

describe('図を次のページの上へ送るか（表の途中に入らないように）', () => {
  it('送っていない図：段落の下に入りきらず次のページへ回り、後ろの文章でページを埋められるなら送る（表が送ったあとも次のページで始まるとき）', () => {
    // 1ページ目の下 72mm が空いている。図は2ページ目の上（25〜95mm）。表は 200mm から（送っても、空白に上がらない）
    const l = layout({ blocks: { p1: [at(0, 180, 200)] }, groups: { g1: [at(1, 25, 95)] }, tables: { t1: [at(1, 200, 260)] } })
    expect(decideDeferredGroups(l, [chapter], new Set(), new Set())).toEqual(new Set(['g1']))
  })

  it('送ると、後ろの表が今のページと次のページにまたがりそうなら送らない（図が表の途中に入るため）', () => {
    // 表の始まり（図の下端から 10mm）が空白（72mm）に上がり、表は次のページの下まで続く（空白に収まりきらない）
    const l = layout({ blocks: { p1: [at(0, 180, 200)] }, groups: { g1: [at(1, 25, 95)] }, tables: { t1: [at(1, 105, 250)] } })
    expect(decideDeferredGroups(l, [chapter], new Set(), new Set())).toEqual(new Set())
    // 表が空白に収まりきる（短い表）なら送る（表は今のページに入り、図は次のページの上で、表の途中ではない）
    const short = layout({ blocks: { p1: [at(0, 180, 200)] }, groups: { g1: [at(1, 25, 95)] }, tables: { t1: [at(1, 105, 140)] } })
    expect(decideDeferredGroups(short, [chapter], new Set(), new Set())).toEqual(new Set(['g1']))
    // 表のタイトルと最初の行が、空白の残り（72 - 10 = 62mm）に入らない（写真の入った高い行）なら、表は丸ごと次のページから始まるので送る
    const tall = layout({ blocks: { p1: [at(0, 180, 200)] }, groups: { g1: [at(1, 25, 95)] }, tables: { t1: [at(1, 105, 250)] }, heads: { t1: 70 } })
    expect(decideDeferredGroups(tall, [chapter], new Set(), new Set())).toEqual(new Set(['g1']))
  })

  it('送った図が、表の続きの前（次のページの上）に入ってしまったら、送るのをやめる（この組み直しの間は、もう送らない）', () => {
    // 送った結果：表は1ページ目の下から始まり、2ページ目に続いた。図は2ページ目の上（表の続きより上）
    const l = layout({ blocks: { p1: [at(0, 180, 200)] }, groups: { g1: [at(1, 25, 95)] }, tables: { t1: [at(0, 230, 272), at(1, 105, 160)] } })
    const blocked = new Set<string>()
    expect(decideDeferredGroups(l, [chapter], new Set(['g1']), blocked)).toEqual(new Set())
    expect(blocked).toEqual(new Set(['g1']))
    // 表が1ページ目に収まっていれば、送ったままにする
    const fits = layout({ blocks: { p1: [at(0, 180, 200)] }, groups: { g1: [at(1, 25, 95)] }, tables: { t1: [at(0, 215, 260)] } })
    expect(decideDeferredGroups(fits, [chapter], new Set(['g1']), new Set())).toEqual(new Set(['g1']))
  })

  it('いままでの決まりはそのまま：段落と同じページに入りきるようになったら送らない。図のすぐ後ろが章の終わりなら送らない', () => {
    const same = layout({ blocks: { p1: [at(0, 100, 120)] }, groups: { g1: [at(0, 125, 195)] }, tables: { t1: [at(1, 30, 60)] } })
    expect(decideDeferredGroups(same, [chapter], new Set(['g1']), new Set())).toEqual(new Set())
    const last: Chapter = { ...chapter, blocks: chapter.blocks.slice(0, 2) }
    const l = layout({ blocks: { p1: [at(0, 180, 200)] }, groups: { g1: [at(1, 25, 95)] } })
    expect(decideDeferredGroups(l, [last], new Set(), new Set())).toEqual(new Set())
  })

  it('表が前のページと次のページにまたがっているか・またがりそうかを、表ごとに見る', () => {
    const l = layout({ tables: { a: [at(2, 200, 272), at(3, 25, 60)], b: [at(3, 100, 150)] } })
    expect(landsInTable(l, ['a'], 3)).toBe(true)
    expect(landsInTable(l, ['b'], 3)).toBe(false)
    expect(landsInTable(l, ['a'], 4)).toBe(false)
    // 図（3ページ目の 25〜95mm）を送ると、空白 40mm に上がる：b は上端が図の下端から 5mm で、下端までが 55mm（収まらない）
    const fig = at(3, 25, 95)
    const near = layout({ tables: { b: [at(3, 100, 150)] } })
    expect(wouldSplitTable(near, ['b'], fig, 40)).toBe(true)
    expect(wouldSplitTable(near, ['b'], fig, 60)).toBe(false)
    // 表が図より後ろのページから始まるなら、関係ない
    expect(wouldSplitTable(layout({ tables: { c: [at(4, 25, 60)] } }), ['c'], fig, 40)).toBe(false)
  })
})
