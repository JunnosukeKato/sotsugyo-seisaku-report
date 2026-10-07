import { describe, expect, it } from 'vitest'
import { currentConfig } from '../config'
import { createReport } from '../model/newReport'
import { ABSTRACT_SUBTITLE, abstractHtml, abstractRowFontPt, COVER_SUBTITLE, coverHtml, fitLineFontPt, refitLineFontPt, subtitleLine, textUnits } from './document'

describe('抄録の見出し（学籍番号・氏名と指導教員を1行に）', () => {
  it('文字の幅は全角を1、半角を0.5として数える', () => {
    expect(textUnits('学籍番号　00ZZ0123')).toBe(9)
  })

  it('1行に収まる文字の大きさを選ぶ（短ければ10pt、指導教員3名なら9pt）', () => {
    expect(abstractRowFontPt('学籍番号　00ZZ0123　　氏名　文化　花子', '（指導教員　文化　太郎　）')).toBe(10)
    expect(abstractRowFontPt('学籍番号　00ZZ0123　　氏名　文化　花子', '（指導教員　梶田　貴子、佐藤　綾、加藤　淳之介　）')).toBe(9)
  })

  it('学籍番号・氏名と指導教員を同じ行（左と右）に出す', () => {
    const report = createReport(currentConfig)
    report.basicInfo = { ...report.basicInfo, studentId: '00ZZ0123', name: '文化　花子' }
    const html = abstractHtml(report, currentConfig)
    expect(html).toMatch(/<div class="el row row3" style="font-size:9pt"><span class="student">学籍番号　00ZZ0123　　氏名　文化　花子<\/span><span class="advisors">（指導教員　梶田　貴子、佐藤　綾、加藤　淳之介　）<\/span><\/div>/)
    expect(html).not.toContain('row4')
  })
})

describe('サブタイトルが長いとき、1行に入るまで文字を小さくする（mockups/v23 ① 案A）', () => {
  const withSubtitle = (subtitleInput: string) => {
    const report = createReport(currentConfig)
    report.basicInfo = { ...report.basicInfo, courseId: 'film-stage-costume', subtitleInput }
    return report
  }
  // 映画・舞台衣装コースの「―{入力}の衣装制作―」。決まり文句は7字
  const EIGHT = 'アラビアンナイト'
  const SIXTEEN = 'オペラ『魔笛』に登場する夜の女王'
  const TWENTY_SIX = '映画『千夜一夜物語』に登場する砂漠の王子シンドバッド'

  it('表紙：字数から見積もる。短ければ 22pt のまま、長いほど 0.5pt ずつ小さく、いちばん小さくて 11pt', () => {
    const pt = (input: string) => fitLineFontPt(subtitleLine(withSubtitle(input), currentConfig), COVER_SUBTITLE)
    expect(subtitleLine(withSubtitle(EIGHT), currentConfig)).toBe('―アラビアンナイトの衣装制作―')
    expect(pt(EIGHT)).toBe(22)
    expect(pt(SIXTEEN)).toBe(17.5)
    expect(pt(TWENTY_SIX)).toBe(12)
    expect(pt('あ'.repeat(40))).toBe(11)
    // どの大きさでも、見積もった幅は枠（144.2mm）に収まる
    for (const input of [EIGHT, SIXTEEN, TWENTY_SIX]) {
      const line = subtitleLine(withSubtitle(input), currentConfig)
      expect(textUnits(line) * pt(input) * (25.4 / 72)).toBeLessThanOrEqual(COVER_SUBTITLE.widthMm)
    }
  })

  it('表紙：組んだ紙面で測ったはみ出し（文字の幅 ÷ 枠の幅）から、入りきる大きさに直す', () => {
    // はみ出している → 比例して小さく（0.5pt 刻みで切り捨て）
    expect(refitLineFontPt(22, 1.3, COVER_SUBTITLE)).toBe(16.5)
    // 見積もりが小さすぎた（表紙の書体はかなの幅が狭い）→ 入る大きさまで大きく
    expect(refitLineFontPt(16.5, 0.93, COVER_SUBTITLE)).toBe(17.5)
    // 入っている・ちょうど → そのまま。22pt より大きくはしない
    expect(refitLineFontPt(17.5, 0.99, COVER_SUBTITLE)).toBe(17.5)
    expect(refitLineFontPt(22, 0.5, COVER_SUBTITLE)).toBe(22)
    // 測り方の細かい誤差くらいのはみ出しは見ない
    expect(refitLineFontPt(22, 1.001, COVER_SUBTITLE)).toBe(22)
    // わずかにはみ出す → 少なくとも 0.5pt 小さく
    expect(refitLineFontPt(17.5, 1.01, COVER_SUBTITLE)).toBe(17)
    // いちばん小さくしても入らない → 11pt のまま（セルフチェックのエラーになる）
    expect(refitLineFontPt(11, 1.2, COVER_SUBTITLE)).toBe(11)
    expect(refitLineFontPt(12, 1.5, COVER_SUBTITLE)).toBe(11)
    // 一度はみ出した大きさには戻さない（行ったり来たりしない）
    expect(refitLineFontPt(17, 0.97, COVER_SUBTITLE, 17.5)).toBe(17)
    // 測れなかったときは変えない
    expect(refitLineFontPt(20, 0, COVER_SUBTITLE)).toBe(20)
  })

  it('表紙：決めた大きさで、サブタイトルの行全体（決まり文句も）を組む。小さくしたときは上をあけて、文字の下を罫線の上にそろえる', () => {
    expect(coverHtml(withSubtitle(EIGHT), currentConfig)).toContain('<div class="el subtitle" style="font-size:22pt">―<span data-block-id="basic:subtitleInput"')
    expect(coverHtml(withSubtitle(SIXTEEN), currentConfig, { coverSubtitlePt: 17.5 })).toContain('<div class="el subtitle" style="font-size:17.5pt;padding-top:4.5pt">')
  })

  it('抄録の見出し：12pt から、本文の幅（150mm）の1行に入るまで小さくする（いちばん小さくて 9pt）', () => {
    const subtitleHtml = (input: string) => abstractHtml(withSubtitle(input), currentConfig).match(/<div class="el subtitle"[^>]*>[^<]*<\/div>/)?.[0]
    expect(subtitleHtml(EIGHT)).toBe('<div class="el subtitle" style="font-size:12pt">―アラビアンナイトの衣装制作―</div>')
    // 30字：37字分は 12pt（150mm に 35字ほど）では入らない
    expect(subtitleHtml('あ'.repeat(30))).toContain('style="font-size:11pt"')
    expect(fitLineFontPt('あ'.repeat(60), ABSTRACT_SUBTITLE)).toBe(9)
  })
})
