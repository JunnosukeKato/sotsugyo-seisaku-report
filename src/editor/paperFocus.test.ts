import { describe, expect, it } from 'vitest'
import { fixedTitleNote } from './paperFocus'

describe('表紙の題目（押しても書けない）のわけ', () => {
  it('紙面の見出しと同じ呼び方で、学科で決まっていて変えられないことを伝える（見出しが空なら「題目」）', () => {
    expect(fixedTitleNote('制作題目')).toBe('制作題目は、学科で決まっています（変えられません）')
    expect(fixedTitleNote(' 研究題目 ')).toBe('研究題目は、学科で決まっています（変えられません）')
    expect(fixedTitleNote('')).toBe('題目は、学科で決まっています（変えられません）')
  })
})
