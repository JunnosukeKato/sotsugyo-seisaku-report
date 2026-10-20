import { describe, expect, it } from 'vitest'
import { abstractPasteNotice, stripFigureRefs } from './abstractRefs'

const strip = (s: string) => stripFigureRefs(s).text

describe('抄録に貼り付ける文から、図表の参照を除く', () => {
  it('括弧で添えた参照は、括弧ごと除く（全角・半角の括弧、全角の数字、いくつか並べたもの）', () => {
    expect(strip('袖を大きく膨らませた（図1）。')).toBe('袖を大きく膨らませた。')
    expect(strip('袖を大きく膨らませた(図1)。')).toBe('袖を大きく膨らませた。')
    expect(strip('素材をまとめた（表2）。')).toBe('素材をまとめた。')
    expect(strip('刺繍した（図１）。')).toBe('刺繍した。')
    expect(strip('仮縫いをした（図1・図2）。')).toBe('仮縫いをした。')
    expect(strip('仮縫いをした（図1、表1）。')).toBe('仮縫いをした。')
    expect(strip('形を比べた（図1〜3）。')).toBe('形を比べた。')
    expect(strip('形を比べた（図1参照）。')).toBe('形を比べた。')
    expect(strip('消した図を指していた（図?）。')).toBe('消した図を指していた。')
    expect(stripFigureRefs('袖（図1）と帯（図2）を作った。').removed).toEqual(['（図1）', '（図2）'])
  })
  it('前後の空白・句読点を整える', () => {
    expect(strip('を作った （図1） 。')).toBe('を作った。')
    expect(strip('を作った。（図1）')).toBe('を作った。')
    expect(strip('を作った。（図1）。次に')).toBe('を作った。次に')
    expect(strip('袖を広げ、（図1）、帯を巻いた。')).toBe('袖を広げ、帯を巻いた。')
    expect(strip('袖を広げた、（図1）。')).toBe('袖を広げた。')
    expect(strip('（図1）袖を広げた。')).toBe('袖を広げた。')
    expect(strip('袖を （図1） 広げた。')).toBe('袖を 広げた。')
    expect(strip('袖は（図1）大きく膨らませた。')).toBe('袖は大きく膨らませた。')
  })
  it('文の中の参照（「図1に示すように」）は残して、知らせる番号を返す（数字は半角）', () => {
    const r = stripFigureRefs('図１に示すように、表1の素材を使った（図2）。')
    expect(r.text).toBe('図１に示すように、表1の素材を使った。')
    expect(r.kept).toEqual(['図1', '表1'])
    expect(r.removed).toEqual(['（図2）'])
    // 漢字に続く「図」「表」（「地図」「代表」）は参照ではない
    expect(stripFigureRefs('地図1枚と代表2名で確かめた。').kept).toEqual([])
  })
  it('図表の参照のない文は、そのまま', () => {
    const s = '綿（コットン）を使った。「作品（仮）」の衣装である。'
    expect(stripFigureRefs(s)).toEqual({ text: s, removed: [], kept: [] })
  })
})

describe('抄録に貼り付けたときの知らせ', () => {
  it('文の中の参照があれば、書き直してもらう', () => {
    expect(abstractPasteNotice(false, [], ['図1'])).toBe('抄録には図表を入れません。「図1」の入った文を書き直してください')
    expect(abstractPasteNotice(true, ['（図2）'], ['図1', '表1', '図3'])).toBe('抄録には図表を入れません。「図1」「表1」の入った文を書き直してください')
  })
  it('除いたもの（見出し・図・表、括弧の参照）を知らせる。何も除いていなければ知らせない', () => {
    expect(abstractPasteNotice(true, ['（図1）'], [])).toBe('抄録には文だけを貼り付けました（見出し・図・表と「（図1）」は除きました）')
    expect(abstractPasteNotice(true, [], [])).toBe('抄録には文だけを貼り付けました（見出し・図・表は入れません）')
    expect(abstractPasteNotice(false, ['(図1)'], [])).toBe('抄録には図表を入れないので、「(図1)」を除いて貼り付けました')
    expect(abstractPasteNotice(false, [], [])).toBeNull()
  })
})
