import { describe, expect, it } from 'vitest'
import { currentConfig, type YearConfig } from '../config'
import { validateConfig } from '../config/validate'
import { courseChanged, fieldChanged, listChanges } from './changes'
import { newYearSteps } from './newYearSteps'

/** 2026年度（前の年度）と、そのコピーの2027年度（準備中） */
const prev: YearConfig = { ...currentConfig, courses: currentConfig.courses.map((c) => ({ ...c, notice: '中間発表の準備' })) }
const copy: YearConfig = { ...JSON.parse(JSON.stringify(prev)), fiscalYear: 2027 }
const steps = (config: YearConfig) => newYearSteps(config, prev, validateConfig(config))
const summary = (config: YearConfig) => steps(config).map((s) => `${s.name}:${s.done ? '済' : 'まだ'}:${s.text}`)

describe('新年度の手順（準備中の年度の「年度の設定」）', () => {
  it('作ったばかり（前の年度のコピー）：題目・締切・コースは前の年度のまま', () => {
    expect(summary(copy)).toEqual([
      '題目:まだ:2026年度と同じです',
      '締切:まだ:2026年度と同じ日付です',
      'コース:まだ:お知らせが2026年度のままです（映画・舞台衣装デザイナー コース）',
      '確かめる:まだ:確認が1件あります',
      '公開:まだ:上の「この年度を学生に公開」で公開します',
    ])
    expect(steps(copy)[2].courseId).toBe(copy.courses[0].id)
  })

  it('題目・締切・お知らせを直すと、それぞれ済みになる（締切は日付を出す）', () => {
    const fixed: YearConfig = { ...copy, commonTitle: '卒業イベント「アラジン」について', deadline: '2028-01-19', courses: copy.courses.map((c) => ({ ...c, notice: undefined, abstractExample: undefined })) }
    expect(summary(fixed)).toEqual([
      '題目:済:直しました',
      '締切:済:2028年1月19日（水）',
      'コース:済:1コース。直す所はありません',
      '確かめる:済:エラーも確認もありません',
      '公開:まだ:上の「この年度を学生に公開」で公開します',
    ])
  })

  it('締切が年度の外・題目が空・抄録の書き出し例に前の題目の言葉・指導教員なし', () => {
    const outside: YearConfig = { ...copy, commonTitle: ' ', deadline: '2027-03-01', courses: copy.courses.map((c) => ({ ...c, notice: undefined, abstractExample: '卒業イベント「シンドバッド」において' })) }
    expect(steps(outside).slice(0, 3).map((s) => s.text)).toEqual(['まだ入っていません', '2027年度の期間の外です', '抄録の書き出し例に、2026年度の題目の言葉があります（映画・舞台衣装デザイナー コース）'])
    const noAdvisor: YearConfig = { ...copy, courses: copy.courses.map((c) => ({ ...c, notice: undefined, abstractExample: undefined, advisors: [] })) }
    expect(steps(noAdvisor)[2].text).toBe('指導教員がいません（映画・舞台衣装デザイナー コース）')
  })
})

describe('変更の数と「変更あり」の印', () => {
  it('変更を、左の見出しの区切りごとに分ける', () => {
    const after: YearConfig = {
      ...currentConfig,
      deadline: '2027-01-22',
      wordChecks: [],
      reportName: '報告書',
      courses: currentConfig.courses.map((c) => ({ ...c, notice: 'お知らせ', advisors: [...c.advisors, '新宿　葵'] })),
    }
    expect(listChanges(currentConfig, after).map((c) => `${c.section}:${c.label}`)).toEqual([
      'year:最終締切',
      'course:映画・舞台衣装デザイナー コースの指導教員',
      'course:映画・舞台衣装デザイナー コースのお知らせ',
      'words:書き間違えやすい語',
      'details:報告書の名前',
    ])
    expect(fieldChanged(currentConfig, after, 'deadline')).toBe(true)
    expect(fieldChanged(currentConfig, after, 'commonTitle')).toBe(false)
    expect(courseChanged(currentConfig, after, currentConfig.courses[0].id, 'notice')).toBe(true)
    expect(courseChanged(currentConfig, after, currentConfig.courses[0].id, 'name')).toBe(false)
    // 空のお知らせと、お知らせなしは同じ（印を付けない）
    const empty: YearConfig = { ...currentConfig, courses: currentConfig.courses.map((c) => ({ ...c, notice: '' })) }
    expect(courseChanged(currentConfig, empty, currentConfig.courses[0].id)).toBe(false)
  })
})
