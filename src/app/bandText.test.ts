import { describe, expect, it } from 'vitest'
import { paragraphHint, photoBand, photoSlotName, todoBand } from './bandText'

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
