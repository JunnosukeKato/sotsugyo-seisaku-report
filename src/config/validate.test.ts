import { describe, expect, it } from 'vitest'
import { currentConfig } from '.'
import type { YearConfig } from './types'
import { validateConfig } from './validate'

const errors = (c: YearConfig) => validateConfig(c).filter((p) => p.severity === 'error').map((p) => p.field)

describe('validateConfig', () => {
  it('2026年度の初期値には問題がない', () => {
    expect(validateConfig(currentConfig)).toEqual([])
  })

  it('共通の題目・締切がないと公開できない', () => {
    expect(errors({ ...currentConfig, commonTitle: ' ', deadline: '' })).toEqual(['commonTitle', 'deadline'])
  })

  it('サブタイトルの形式に {input} がない、コース名の重複は公開できない', () => {
    const course = currentConfig.courses[0]
    const config = { ...currentConfig, courses: [course, { ...course, id: 'x', subtitleTemplate: '―衣装制作―' }] }
    expect(errors(config)).toEqual(['courses.1', 'courses'])
  })

  it('表示するコースが1つもないと公開できない。指導教員が未登録なら警告', () => {
    const hiddenOnly = { ...currentConfig, courses: currentConfig.courses.map((c) => ({ ...c, hidden: true })) }
    expect(errors(hiddenOnly)).toEqual(['courses'])
    const noAdvisors = { ...currentConfig, courses: [{ ...currentConfig.courses[0], advisors: [] }] }
    expect(validateConfig(noAdvisors)).toEqual([expect.objectContaining({ severity: 'warning' })])
  })

  it('学籍番号の形式が正規表現として正しくなければ公開できない', () => {
    expect(errors({ ...currentConfig, studentIdPattern: '([0-9' })).toEqual(['studentIdPattern'])
  })
})
