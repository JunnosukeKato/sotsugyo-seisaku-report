import { describe, expect, it } from 'vitest'
import { headingFromText, typedHeading } from './headingText'

describe('段落に打った見出しの形（typedHeading）', () => {
  it('大見出し：「Ⅲ．まとめ」、英字の「I.」「II.」、全角の英字の「Ｉ．」。番号は除き、名前だけにする', () => {
    expect(typedHeading('Ⅲ．まとめ')).toEqual({ level: 1, title: 'まとめ' })
    expect(typedHeading('Ⅴ.仕上げと確認')).toEqual({ level: 1, title: '仕上げと確認' })
    expect(typedHeading('I. 企画・立案')).toEqual({ level: 1, title: '企画・立案' })
    expect(typedHeading('II.制作過程')).toEqual({ level: 1, title: '制作過程' })
    expect(typedHeading('Ｉ．企画・立案')).toEqual({ level: 1, title: '企画・立案' })
    expect(typedHeading('ＩＩ．制作過程')).toEqual({ level: 1, title: '制作過程' })
    // 番号のあとが空白だけ（Word の見出しと同じ）
    expect(typedHeading('Ⅱ　制作過程')).toEqual({ level: 1, title: '制作過程' })
  })

  it('小見出し：「ⅱ．袖の刺繍」、英字の「i.」「ii.」', () => {
    expect(typedHeading('ⅱ．袖の刺繍')).toEqual({ level: 2, title: '袖の刺繍' })
    expect(typedHeading('i. 担当衣装のキャラクター')).toEqual({ level: 2, title: '担当衣装のキャラクター' })
    expect(typedHeading('ii.デザイン説明')).toEqual({ level: 2, title: 'デザイン説明' })
    expect(typedHeading('ｉｉｉ．使用素材')).toEqual({ level: 2, title: '使用素材' })
  })

  it('算用数字の形（「1．」「（1）」「第1章」「①」）は見出しにしない', () => {
    for (const t of ['1．はじめに', '1. はじめに', '（1）素材', '(2) 素材', '第1章 企画', '①素材', 'A. 素材']) expect(typedHeading(t), t).toBeNull()
  })

  it('番号だけ（名前がない）は見出しにしない', () => {
    for (const t of ['Ⅲ．', 'Ⅲ', 'ⅱ．', 'II.', 'Ⅲ．．', 'ⅡⅢ', 'Ⅲ．（）']) expect(typedHeading(t), t).toBeNull()
  })

  it('文（「。」「！」「？」で終わる）・長い行は見出しにしない', () => {
    expect(typedHeading('Ⅲ．まとめとして、今回の制作を振り返る。')).toBeNull()
    expect(typedHeading('ⅰ．布を裁つ！')).toBeNull()
    expect(typedHeading(`Ⅲ．${'あ'.repeat(41)}`)).toBeNull()
    expect(typedHeading(`Ⅲ．${'あ'.repeat(40)}`)).toEqual({ level: 1, title: 'あ'.repeat(40) })
  })

  it('ふつうの文は見出しにしない（英字の「I」で始まる文なども）', () => {
    for (const t of ['I think so.', 'In this report', '筆者が担当したのは、', 'いろいろ試した', 'Vネックにした']) expect(typedHeading(t), t).toBeNull()
  })

  it('英字のローマ数字に「．」がなくても、すぐ後ろが日本語なら見出しにする（「iiiスカート」。学生の試し 2026-10-23）', () => {
    expect(typedHeading('iiiスカート')).toEqual({ level: 2, title: 'スカート' })
    expect(typedHeading('ivデザイン画')).toEqual({ level: 2, title: 'デザイン画' })
    expect(typedHeading('ｉｉｉスカート')).toEqual({ level: 2, title: 'スカート' })
    expect(typedHeading('IIIまとめ')).toEqual({ level: 1, title: 'まとめ' })
    // 服の言葉・英字の言葉・文は見出しにしない
    for (const t of ['Vネックにした', 'Iラインのスカート', 'Xライン', 'iPhoneで撮った', 'XLサイズ', 'iiスカートを縫った。', 'Ivスカート']) expect(typedHeading(t), t).toBeNull()
  })

  it('前後の空白は除く', () => {
    expect(typedHeading('  Ⅲ．まとめ  ')).toEqual({ level: 1, title: 'まとめ' })
  })

  it('Word から読み込むときの見分け方（headingFromText）は、今までどおり（「Ⅲ．」だけでも見出しの形とみなす）', () => {
    expect(headingFromText('Ⅰ．企画・立案')).toEqual({ level: 1, title: '企画・立案' })
    expect(headingFromText('Ⅲ．まとめとして、今回の制作を振り返る。')).toEqual({ level: 1, title: 'まとめとして、今回の制作を振り返る。' })
  })
})
