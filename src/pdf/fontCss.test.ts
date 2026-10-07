import { describe, expect, it } from 'vitest'
import { coversAny, familyList, parseUnicodeRange, pickFontFiles, pickSource, type FontFile, type UsedText } from './fontCss'

const file = (family: string, weight: string, range: string, url = `${family}-${weight}-${range}.woff2`): FontFile => ({
  family,
  weight,
  style: 'normal',
  ranges: parseUnicodeRange(range),
  rangeText: range,
  url,
  format: 'woff2',
})

const used = (entries: [string, string, string][]): UsedText =>
  new Map(entries.map(([family, weight, text]) => [`${family.toLowerCase()}|${weight}`, { family, weight, codePoints: new Set([...text].map((c) => c.codePointAt(0)!)) }]))

describe('書体のファイルを選ぶ', () => {
  it('unicode-range を読める（範囲・1字・? の書き方）', () => {
    expect(parseUnicodeRange('U+3000-303F, U+4E00, U+4??')).toEqual([
      [0x3000, 0x303f],
      [0x4e00, 0x4e00],
      [0x400, 0x4ff],
    ])
    // 書いていなければ、すべての文字
    expect(parseUnicodeRange('')).toEqual([[0, 0x10ffff]])
  })

  it('文字が範囲に入っているかを調べる', () => {
    const ranges = parseUnicodeRange('U+3040-309F')
    expect(coversAny(ranges, [0x3042])).toBe(true)
    expect(coversAny(ranges, [0x41, 0x4e00])).toBe(false)
  })

  it('font-family の並びと src を読める（woff2 を優先）', () => {
    expect(familyList(`"BIZ UDMincho", serif`)).toEqual(['BIZ UDMincho', 'serif'])
    expect(pickSource(`url("a.woff") format("woff"), url(b.woff2) format("woff2")`)).toEqual({ url: 'b.woff2', format: 'woff2' })
    expect(pickSource(`url(data:font/woff2;base64,AAAA)`)).toEqual({ url: 'data:font/woff2;base64,AAAA', format: '' })
  })

  it('ページで使っている文字を含むファイルだけを選ぶ', () => {
    const hiragana = file('BIZ UDMincho', '400', 'U+3040-309F')
    const kanji = file('BIZ UDMincho', '400', 'U+4E00-4FFF')
    const latin = file('BIZ UDMincho', '400', 'U+0000-00FF')
    const gothic = file('BIZ UDPGothic', '400', 'U+3040-309F')
    const picked = pickFontFiles([hiragana, kanji, latin, gothic], used([['BIZ UDMincho', '400', 'あ']]))
    expect(picked).toEqual([hiragana])
  })

  it('同じ太さのファイルがなければ、その書体のほかの太さを使う', () => {
    const regular = file('BIZ UDMincho', '400', 'U+3040-309F')
    expect(pickFontFiles([regular], used([['BIZ UDMincho', '700', 'あ']]))).toEqual([regular])
    const bold = file('BIZ UDPGothic', '700', 'U+3040-309F')
    const gothicRegular = file('BIZ UDPGothic', '400', 'U+3040-309F')
    expect(pickFontFiles([gothicRegular, bold], used([['BIZ UDPGothic', '700', 'あ']]))).toEqual([bold])
  })

  it('組版エンジンの書体（句読点のぶら下げに使う）は、いつも選ぶ', () => {
    const engine = file('-viv-ts-sp', '400', '', 'data:font/woff2;base64,AAAA')
    expect(pickFontFiles([engine], used([]))).toEqual([engine])
  })
})
