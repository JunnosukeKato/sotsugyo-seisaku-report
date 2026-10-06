import { describe, expect, it } from 'vitest'
import { currentConfig } from '../config'
import { createReport } from '../model/newReport'
import { abstractHtml, abstractRowFontPt, textUnits } from './document'

describe('抄録の見出し（学籍番号・氏名と指導教員を1行に）', () => {
  it('文字の幅は全角を1、半角を0.5として数える', () => {
    expect(textUnits('学籍番号　23FA0123')).toBe(9)
  })

  it('1行に収まる文字の大きさを選ぶ（短ければ10pt、指導教員3名なら9pt）', () => {
    expect(abstractRowFontPt('学籍番号　23FA0123　　氏名　文化　花子', '（指導教員　文化　太郎　）')).toBe(10)
    expect(abstractRowFontPt('学籍番号　23FA0123　　氏名　文化　花子', '（指導教員　梶田　貴子、佐藤　綾、加藤　淳之介　）')).toBe(9)
  })

  it('学籍番号・氏名と指導教員を同じ行（左と右）に出す', () => {
    const report = createReport(currentConfig)
    report.basicInfo = { ...report.basicInfo, studentId: '23FA0123', name: '文化　花子' }
    const html = abstractHtml(report, currentConfig)
    expect(html).toMatch(/<div class="el row row3" style="font-size:9pt"><span class="student">学籍番号　23FA0123　　氏名　文化　花子<\/span><span class="advisors">（指導教員　梶田　貴子、佐藤　綾、加藤　淳之介　）<\/span><\/div>/)
    expect(html).not.toContain('row4')
  })
})
