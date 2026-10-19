import { describe, expect, it } from 'vitest'
import { EditHistory } from './history'

describe('「元に戻す」「やり直す」の履歴', () => {
  it('元に戻すと、ひとつ前の状態に戻り、やり直すと、戻す前の状態に進む（何度でも行き来できる）', () => {
    const h = new EditHistory<string>()
    // 原稿 a → b → c と変えた
    h.push('a')
    h.push('b')
    let now = 'c'
    expect([h.canUndo, h.canRedo]).toEqual([true, false])
    now = h.undo(now)!
    expect(now).toBe('b')
    now = h.undo(now)!
    expect(now).toBe('a')
    expect([h.canUndo, h.canRedo]).toEqual([false, true])
    expect(h.undo(now)).toBeUndefined()
    now = h.redo(now)!.state
    expect(now).toBe('b')
    now = h.redo(now)!.state
    expect(now).toBe('c')
    expect(h.redo(now)).toBeUndefined()
    // やり直したあとも、また元に戻せる
    now = h.undo(now)!
    expect(now).toBe('b')
  })

  it('last：次に元に戻すと戻る状態（積んだものそのもの。段落を見出しにしたのを戻すかを、これで見分ける）', () => {
    const typed = { text: 'Ⅲ．まとめ' }
    const h = new EditHistory<{ text: string }>()
    expect(h.last).toBeUndefined()
    h.push({ text: '' })
    h.push(typed)
    expect(h.last).toBe(typed)
    expect(h.undo({ text: '見出し' })).toBe(typed)
    expect(h.last?.text).toBe('')
  })

  it('戻したあとに新しく変えると、やり直しの分は消える', () => {
    const h = new EditHistory<string>()
    h.push('a')
    let now = h.undo('b')!
    expect(h.canRedo).toBe(true)
    // 戻した a から、別の変更 d をした
    h.push(now)
    now = 'd'
    expect(h.canRedo).toBe(false)
    expect(h.redo(now)).toBeUndefined()
    expect(h.undo(now)).toBe('a')
  })

  it('やり直したときに出す知らせを、やり直しの分と一緒に持つ（戻すときに渡したもの）', () => {
    const h = new EditHistory<string, { kind: string }>()
    h.push('段落あり')
    const now = h.undo('段落なし', { kind: 'removed' })!
    expect(now).toBe('段落あり')
    expect(h.redo(now)).toEqual({ state: '段落なし', note: { kind: 'removed' } })
    h.push('x')
    expect(h.undo('y')).toBe('x')
    expect(h.redo('x')?.note).toBeNull()
  })

  it('覚えておく数を超えたら、古いものから捨てる。clear で両方とも消す（原稿を入れ替えたとき）', () => {
    const h = new EditHistory<number>(3)
    for (let i = 1; i <= 5; i++) h.push(i)
    let now = 6
    const back: number[] = []
    for (let x = h.undo(now); x !== undefined; x = h.undo(now)) back.push((now = x))
    expect(back).toEqual([5, 4, 3])
    expect(h.canRedo).toBe(true)
    h.clear()
    expect([h.canUndo, h.canRedo]).toEqual([false, false])
  })
})
