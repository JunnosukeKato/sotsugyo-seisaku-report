import { describe, expect, it } from 'vitest'
import { isUniversityAddress, parseAddresses } from './account'

describe('メーリングリストの宛先から、名前とアドレスを読み取る', () => {
  it('「名前 <アドレス>」の形と、区切っただけのアドレスの両方を読む', () => {
    const text = '文化 太郎 <T-Bunka@bunka-wu.ac.jp>, "衣装 花子" <h-isho@bunka-wu.ac.jp>; 舞台 次郎 <j-butai@bunka-wu.ac.jp>\n00zz901@bunka-wu.ac.jp someone@gmail.com、t-bunka@bunka-wu.ac.jp'
    expect(parseAddresses(text)).toEqual([
      { name: '文化 太郎', email: 't-bunka@bunka-wu.ac.jp' },
      { name: '衣装 花子', email: 'h-isho@bunka-wu.ac.jp' },
      { name: '舞台 次郎', email: 'j-butai@bunka-wu.ac.jp' },
      { name: '', email: '00zz901@bunka-wu.ac.jp' },
      { name: '', email: 'someone@gmail.com' },
    ])
  })

  it('全角の記号で書かれたアドレスも読む。アドレスがなければ空', () => {
    expect(parseAddresses('文化　太郎＜t-bunka＠bunka-wu.ac.jp＞')).toEqual([{ name: '文化 太郎', email: 't-bunka@bunka-wu.ac.jp' }])
    expect(parseAddresses('よろしくお願いします')).toEqual([])
  })

  it('大学のアドレスかどうか', () => {
    expect(isUniversityAddress('t-bunka@bunka-wu.ac.jp')).toBe(true)
    expect(isUniversityAddress('someone@gmail.com')).toBe(false)
  })
})
