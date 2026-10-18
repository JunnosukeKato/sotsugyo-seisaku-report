import { describe, expect, it } from 'vitest'
import { STUDENT_TOPICS } from '../help/helpTopics'
import type { LayoutInfo } from '../layout/measure'
import { forTouch, paragraphHint, photoBand, photoSlotName, photoToolsAtSide, todoBand, topicsForTouch } from './bandText'
import { PAGE_CONTEXT } from './uiShared'

describe('スマホの紙面の下の帯の言葉（mockups/v32 ④ 案A）', () => {
  it('作品写真の空いている枠：2枚の並べ方は「下の枠」「右の枠」、ほかは「3枚目の枠」と呼ぶ', () => {
    expect(photoSlotName({ layout: 2, columns: 1 }, 1)).toBe('下の枠')
    expect(photoSlotName({ layout: 2, columns: 1 }, 0)).toBe('上の枠')
    expect(photoSlotName({ layout: 2 }, 1)).toBe('右の枠')
    expect(photoSlotName({ layout: 4, columns: 2 }, 2)).toBe('3枚目の枠')
  })

  it('作品写真の帯：空いている枠が1つならその枠、いくつかなら数を出し、「写真を選ぶ」は上の空いている枠に入れる', () => {
    expect(photoBand({ layout: 2, columns: 1, imageIds: ['a', ''] })).toEqual({ text: '下の枠に、まだ写真がありません', index: 1 })
    expect(photoBand({ layout: 4, imageIds: ['a'] })).toEqual({ text: 'まだ写真がない枠が3つあります（＋の枠）', index: 1 })
    expect(photoBand({ layout: 1, imageIds: [] })).toEqual({ text: '作品写真が、まだ入っていません', index: 0 })
    expect(photoBand({ layout: 2, imageIds: ['a', 'b'] })).toBeNull()
  })

  it('まだ書いていない欄：ひな形の段落は「ここに何を書くか」をそのまま、ほかは欄の名前。同じページのほかの所の数も出す', () => {
    expect(todoBand({ kind: 'field', id: 'p1', editable: 'paragraph', hint: '制作の手順と、工夫した点を書く' }, 0)).toEqual({ text: '制作の手順と、工夫した点を書く', sub: 'まだ書いていない段落', button: '書く' })
    expect(todoBand({ kind: 'field', id: 'basic:studentId', editable: 'field' }, 2)).toEqual({ text: '学籍番号が、まだ空いています', sub: 'このページで、ほかに2か所（＋の印）', button: '書く' })
    expect(todoBand({ kind: 'field', id: 'f1', editable: 'figureCaption' }, 0).text).toBe('図のタイトルが、まだ空いています')
    expect(todoBand({ kind: 'figure', id: 'f1' }, 1)).toEqual({ text: '図の枠に、まだ写真がありません', sub: 'このページで、ほかに1か所（＋の印）', button: '写真を選ぶ' })
    expect(todoBand({ kind: 'course', id: 'basic:course' }, 0).button).toBe('選ぶ')
  })
})

describe('スマホの言葉：「クリック」ではなく「タップ」', () => {
  it('「クリック」を「タップ」にし、ほかの言葉はそのまま', () => {
    expect(forTouch('枠をクリックして選ぶ')).toBe('枠をタップして選ぶ')
    expect(forTouch('（クリックして入力）・クリック')).toBe('（タップして入力）・タップ')
    expect(forTouch('Enter で段落を分ける')).toBe('Enter で段落を分ける')
  })

  it('ページの種類ごとのひとこと（スマホの「追加」の欄にも出す）は、スマホでは「クリック」が残らない', () => {
    for (const { hint } of Object.values(PAGE_CONTEXT)) expect(forTouch(hint)).not.toContain('クリック')
    expect(forTouch(PAGE_CONTEXT.photos.hint.replace('\n', ''))).toBe('枠をタップして選ぶ')
  })
})

describe('ひな形の段落の「ここに何を書くか」（帯と、スマホの書く欄に出す）', () => {
  it('段落の hint を返し、hint のない段落・ほかの欄は undefined', async () => {
    const { demoReport } = await import('../model/demoReport')
    const report = demoReport()
    const withHint = { ...report, body: [{ id: 'c', title: '', blocks: [{ type: 'paragraph' as const, id: 'p', content: [], hint: ' 制作の手順を書く ' }, { type: 'paragraph' as const, id: 'q', content: [] }] }] }
    expect(paragraphHint(withHint, 'p')).toBe('制作の手順を書く')
    expect(paragraphHint(withHint, 'q')).toBeUndefined()
    expect(paragraphHint(withHint, 'c')).toBeUndefined()
  })
})

describe('スマホの「？ 使い方」の言葉（「クリック」を「タップ」に）', () => {
  const touch = topicsForTouch(STUDENT_TOPICS)
  const byId = (id: string) => touch.find((t) => t.id === id)!

  it('題・ひとこと・手順の「クリック」は「タップ」になり、「クリック（スマホはタップ）」は「タップ」だけになる', () => {
    expect(byId('write').title).toBe('書き方（タップして書く）')
    expect(byId('write').lead).toBe('紙面の文をタップすると、その場で書けます。')
    expect(byId('figure').lead).toBe('文中の入れたい位置をタップしてから、道具の「図を入れる」「表を入れる」。')
    expect(byId('references').steps?.[1]).toBe('直す・足すときは、そのページをタップ')
    for (const t of touch) expect([t.title, t.lead ?? '', ...(t.steps ?? [])].join('')).not.toContain('クリック')
  })

  it('パソコンのことを書いた補足（「パソコンでは」）は変えない。PC の項目（元の一覧）もそのまま', () => {
    expect(byId('relogin').items?.find((it) => it.h === 'パソコンでは')?.t).toContain('クリックしながら')
    expect(STUDENT_TOPICS.find((t) => t.id === 'write')?.title).toBe('書き方（クリックして書く）')
  })

  it('変えた項目は「クリック」でも探せる（探す言葉に足す）。変えていない項目はそのまま', () => {
    expect(byId('write').words).toContain('クリック')
    expect(byId('login')).toBe(STUDENT_TOPICS.find((t) => t.id === 'login'))
  })
})

describe('横向きのスマホ：作品写真のページの道具を、紙面の右の列に出す（mockups/v33 案A）', () => {
  const layout = { kinds: ['cover', 'abstract', 'photos'] } as LayoutInfo
  const at = (page: number, more: { editingId?: string; zoomed?: boolean } = {}) => ({ layout, page, editingId: more.editingId ?? null, zoomed: more.zoomed ?? false })

  it('横向きの作品写真のページだけ、右の列に出す（縦向き・ほかのページは今までどおり下の道具）', () => {
    expect(photoToolsAtSide(at(2), true)).toBe(true)
    expect(photoToolsAtSide(at(2), false)).toBe(false)
    expect(photoToolsAtSide(at(1), true)).toBe(false)
    expect(photoToolsAtSide({ ...at(2), layout: null }, true)).toBe(false)
  })

  it('書いている間・拡大している間は、右の列に出さない', () => {
    expect(photoToolsAtSide(at(2, { editingId: 'p1' }), true)).toBe(false)
    expect(photoToolsAtSide(at(2, { zoomed: true }), true)).toBe(false)
  })
})
