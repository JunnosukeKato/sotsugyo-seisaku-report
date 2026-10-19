import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadPlace, loadView, pageToOpen, placeOf, savePlace, saveView, viewOf } from './lastPlace'

// 画面のない環境なので、ブラウザの保存場所（localStorage）は簡単な偽物を置く
const memory = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) })

/** 紙面の見立て：欄の ID → 始まるページ */
const pages: Record<string, number> = { 'basic:studentId': 0, p1: 3, p2: 3, p3: 5 }
const pageOfBlock = (id: string) => pages[id] ?? -1
const firstBlockOn = (page: number) => Object.keys(pages).find((id) => pages[id] === page) ?? null

describe('最後に見ていたページを覚える', () => {
  beforeEach(() => memory.clear())

  it('書いている（最後に触った）欄が見ているページで始まっていれば、その欄を目印にする', () => {
    expect(placeOf(3, 'p2', pageOfBlock, firstBlockOn)).toEqual({ page: 3, blockId: 'p2' })
  })

  it('最後に触った欄が別のページなら、見ているページでいちばん上の欄を目印にする。欄がなければページだけ', () => {
    expect(placeOf(5, 'p1', pageOfBlock, firstBlockOn)).toEqual({ page: 5, blockId: 'p3' })
    expect(placeOf(7, null, pageOfBlock, firstBlockOn)).toEqual({ page: 7 })
  })

  it('覚えるのはページの番号と欄の ID だけ（原稿の文字は入れない）。読めないものは覚えていないことにする', () => {
    savePlace({ page: 3, blockId: 'p2' })
    expect([...memory.values()]).toEqual(['{"page":3,"blockId":"p2"}'])
    expect(loadPlace()).toEqual({ page: 3, blockId: 'p2' })
    memory.set('sotsugyo-seisaku-report-place', '{"page":"3"}')
    expect(loadPlace()).toBeNull()
    memory.set('sotsugyo-seisaku-report-place', '壊れた')
    expect(loadPlace()).toBeNull()
  })
})

describe('PC の表示の仕方（全体・見開き・拡大）を覚える', () => {
  beforeEach(() => memory.clear())

  it('覚えるのは「全体」「見開き」「拡大」のどれかだけ。覚えていなければ・読めなければ「全体」', () => {
    expect(loadView()).toBe('fit')
    saveView('zoom')
    expect([...memory.values()]).toEqual(['zoom'])
    expect(loadView()).toBe('zoom')
    saveView('spread')
    expect(loadView()).toBe('spread')
    saveView('fit')
    expect(loadView()).toBe('fit')
    memory.set('sotsugyo-seisaku-report-zoom', '壊れた')
    expect(loadView()).toBe('fit')
  })

  it('いまの表示の仕方は、拡大・見開き・全体の順に見る', () => {
    expect(viewOf({ zoomed: true, spread: false })).toBe('zoom')
    expect(viewOf({ zoomed: false, spread: true })).toBe('spread')
    expect(viewOf({ zoomed: false, spread: false })).toBe('fit')
  })
})

describe('開いたときに見せるページ', () => {
  it('覚えた欄があれば、そのページ（ページが前後にずれても、同じ欄を開く）', () => {
    expect(pageToOpen({ page: 2, blockId: 'p3' }, 8, pageOfBlock)).toBe(5)
  })

  it('覚えた欄がもうなければ、覚えたページ。そのページもなければ表紙', () => {
    expect(pageToOpen({ page: 4, blockId: 'gone' }, 8, pageOfBlock)).toBe(4)
    expect(pageToOpen({ page: 9, blockId: 'gone' }, 8, pageOfBlock)).toBe(0)
    expect(pageToOpen({ page: 6 }, 8, pageOfBlock)).toBe(6)
  })

  it('覚えていなければ表紙', () => {
    expect(pageToOpen(null, 8, pageOfBlock)).toBe(0)
  })
})
