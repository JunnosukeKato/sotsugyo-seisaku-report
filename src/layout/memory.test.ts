// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { documentHash, firstShowPlan, forgetLayoutMemory, loadLayoutMemory, saveLayoutMemory, type LayoutMemory } from './memory'

// 画面のない環境なので、ブラウザの保存場所（localStorage）は簡単な偽物を置く
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
})

const docs = ['<body>表紙</body>', '<body>抄録</body>', '<body>目次</body>', '<body>1章</body>', '<body>2章・作品写真</body>']
/** 覚えた組み方の見立て：表紙1・抄録1・目次1・1章3・残り（2章2・作品写真1） */
const memory = (): LayoutMemory => ({
  v: 1,
  state: { toc: { c1: 1, c2: 4 }, deferred: ['r2'], subtitle: { line: '―海の王女の衣装制作―', pt: 22 }, split: true },
  parts: [
    { hash: documentHash(docs[0]), kinds: ['cover'] },
    { hash: documentHash(docs[1]), kinds: ['abstract'] },
    { hash: documentHash(docs[2]), kinds: ['toc'] },
    { hash: documentHash(docs[3]), kinds: ['body', 'body', 'body'] },
    { hash: documentHash(docs[4]), kinds: ['body', 'body', 'photos'] },
  ],
  layout: { kinds: ['cover', 'abstract', 'toc', 'body', 'body', 'body', 'body', 'body', 'photos'], bodyPages: 5, abstractPages: 1, abstractLines: 30, tocPageNumbers: { c1: 1, c2: 4 }, figuresPerBodyPage: [0, 1, 0, 0, 0], pageBreaks: [] },
})

describe('前に開いたときの紙面の組み方を覚える', () => {
  beforeEach(() => store.clear())

  it('覚えて、読み出せる。忘れられる。形の違うもの・壊れたものは使わない', () => {
    expect(loadLayoutMemory()).toBeNull()
    saveLayoutMemory(memory())
    expect(loadLayoutMemory()).toEqual(memory())
    forgetLayoutMemory()
    expect(loadLayoutMemory()).toBeNull()
    store.set('sotsugyo-seisaku-report-layout', '{"v":1,"parts":"x"}')
    expect(loadLayoutMemory()).toBeNull()
    store.set('sotsugyo-seisaku-report-layout', '{壊れた')
    expect(loadLayoutMemory()).toBeNull()
  })

  it('文書の要約は、写真の場所（blob:）が違っても同じ。中身が違えば違う', () => {
    const a = '<img src="blob:http://localhost:5173/11111111-2222-3333-4444-555555555555" style="width: 80mm">'
    const b = '<img src="blob:http://localhost:5173/99999999-8888-7777-6666-555555555555" style="width: 80mm">'
    expect(documentHash(a)).toBe(documentHash(b))
    expect(documentHash(a)).not.toBe(documentHash(a.replace('80mm', '60mm')))
    expect(documentHash('<p>あいう</p>')).not.toBe(documentHash('<p>あいえ</p>'))
  })
})

describe('開いたときに、先に組んで見せる部分', () => {
  it('見せるページのある部分と、その前の部分が覚えたときと同じなら、その部分を先に組む', () => {
    expect(firstShowPlan(docs, memory(), 0)).toMatchObject({ part: 0 })
    expect(firstShowPlan(docs, memory(), 4)).toMatchObject({ part: 3 })
    expect(firstShowPlan(docs, memory(), 8)).toMatchObject({ part: 4 })
    // まだ組んでいない部分の仮のページの種類（数は、覚えていたページ数）
    expect(firstShowPlan(docs, memory(), 4)?.kinds).toEqual(memory().parts.map((p) => p.kinds))
  })

  it('見せるページより後ろの部分が変わっていても、先に見せられる（仮のページは、覚えていたもの）', () => {
    const changed = [...docs.slice(0, 4), '<body>2章（書き足した）</body>']
    expect(firstShowPlan(changed, memory(), 5)).toEqual({ part: 3, kinds: memory().parts.map((p) => p.kinds) })
  })

  it('見せるページのある部分だけが変わっていても、その前の部分が同じなら、その部分を先に組む（見せるページは、覚えたページ数で探す）', () => {
    const changed = [...docs.slice(0, 3), '<body>1章（書いて、すぐ閉じた）</body>', docs[4]]
    expect(firstShowPlan(changed, memory(), 4)).toEqual({ part: 3, kinds: memory().parts.map((p) => p.kinds) })
    // 覚えたページ数より後ろのページは、その部分にあるか分からないので、先には見せない
    expect(firstShowPlan(changed, memory(), 6)).toBeNull()
  })

  it('見せるページの前の部分が変わっていたら（ページの位置が決まらない）、先には見せない。ページが範囲の外でも見せない', () => {
    const changed = ['<body>表紙（名前を書いた）</body>', ...docs.slice(1)]
    expect(firstShowPlan(changed, memory(), 5)).toBeNull()
    expect(firstShowPlan(docs, memory(), 9)).toBeNull()
    expect(firstShowPlan(docs, null, 4)).toBeNull()
  })

  it('表紙は紙面のいちばん初めなので、表紙が変わっていても・覚えていなくても先に見せる（ほかの部分の仮のページは、覚えた数か、ふつうの数）', () => {
    const changed = ['<body>表紙（名前を書いた）</body>', ...docs.slice(1)]
    expect(firstShowPlan(changed, memory(), 0)).toEqual({ part: 0, kinds: memory().parts.map((p) => p.kinds) })
    expect(firstShowPlan(docs, null, 0)).toEqual({ part: 0, kinds: [['cover'], ['abstract'], ['toc'], ['body'], ['body', 'photos']] })
  })
})
