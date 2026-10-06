import { describe, expect, it } from 'vitest'
import { currentConfig } from '.'
import { bodyFromTemplate, courseTemplate, DEFAULT_TEMPLATE } from '../model/template'
import type { TemplateBlock, YearConfig } from './types'
import { repairConfig, templateProblems, validateConfig } from './validate'

const errors = (c: YearConfig) => validateConfig(c).filter((p) => p.severity === 'error').map((p) => p.field)
/** 崩れた値（型の決まりから外れたもの）を入れるため */
const broken = (v: unknown) => v as never
const course0 = currentConfig.courses[0]
const withTemplate = (template: unknown): YearConfig => ({ ...currentConfig, courses: [{ ...course0, template: broken(template) }] })

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

  it('書き間違えやすい語の空の行・同じ語の行は警告（公開は止めない）', () => {
    const wordChecks = [
      { wrong: '見頃', right: '身頃', severity: 'error' as const },
      { wrong: '', right: '空', severity: 'error' as const },
      { wrong: '同じ', right: '同じ', severity: 'warning' as const },
    ]
    const problems = validateConfig({ ...currentConfig, wordChecks })
    expect(problems.map((p) => [p.severity, p.field])).toEqual([
      ['warning', 'wordChecks.1'],
      ['warning', 'wordChecks.2'],
    ])
  })
})

describe('崩れた設定（管理ページのサーバーを通らずに書かれたものなど）', () => {
  it('ひな形の部品の形・種類・長さを確かめる（段落の説明は空でもよいが、文字であること）', () => {
    const chapter = { type: 'chapter', title: '概要' }
    expect(templateProblems([chapter, { type: 'paragraph', hint: '' }])).toEqual([])
    expect(templateProblems([])).toEqual([])
    expect(templateProblems('x')).toEqual(['の形が正しくありません'])
    expect(templateProblems([{ type: 'chapter' }])).toEqual(['の1行目の形が正しくありません'])
    expect(templateProblems([chapter, { type: 'paragraph' }])).toEqual(['の2行目の形が正しくありません'])
    expect(templateProblems([chapter, { type: 'figure', caption: 3 }])).toEqual(['の2行目の形が正しくありません'])
    expect(templateProblems([chapter, { type: 'toString', title: 'x' }, null])).toEqual(['の2行目の形が正しくありません', 'の3行目の形が正しくありません'])
    expect(templateProblems([chapter, { type: 'paragraph', hint: 'あ'.repeat(301) }])).toEqual(['の2行目が長すぎます（300字まで）'])
    expect(templateProblems(Array.from({ length: 101 }, () => chapter))).toEqual(['の部品が多すぎます（100個まで）'])
    expect(templateProblems([{ type: 'paragraph', hint: '説明' }])).toEqual(['は、大見出しから始めてください', 'に大見出しがありません'])
  })

  it('例外を出さずに、問題として返す（管理ページの画面が止まらない）', () => {
    expect(() => validateConfig(broken(null))).not.toThrow()
    expect(errors(broken(null))).toEqual(['config'])
    const messy = broken({ ...currentConfig, abstract: undefined, cover: 'x', courses: [null, { ...course0, advisors: 'x' }], wordChecks: [{ wrong: 1, right: '身頃', severity: 'error' }] })
    expect(() => validateConfig(messy)).not.toThrow()
    expect(errors(messy)).toEqual(expect.arrayContaining(['abstract.heading', 'cover.heading', 'courses.0', 'courses.1', 'wordChecks.0']))
    expect(errors(broken({ ...currentConfig, courses: 'x' }))).toEqual(['courses'])
    expect(errors(withTemplate([{ type: 'chapter' }, { type: 'paragraph' }]))).toEqual(['courses.0', 'courses.0'])
    expect(validateConfig(withTemplate([{ type: 'paragraph' }])).map((p) => p.message)).toEqual(['「映画・舞台衣装デザイナー」の下書きのひな形の1行目の形が正しくありません'])
  })

  it('学生のツールでは、崩れたコースのひな形・お知らせだけを使わず、設定全体は捨てない', () => {
    const other = { ...course0, id: 'other', name: 'ほかのコース', template: broken([{ type: 'chapter', title: '概要' }, { type: 'paragraph' }]), notice: broken(5), abstractExample: broken({}) }
    const config: YearConfig = { ...currentConfig, courses: [course0, other], wordChecks: broken([{ wrong: '見頃', right: '身頃', severity: 'error' }, { wrong: 1, right: 'x', severity: 'error' }, null]) }
    expect(errors(config).length).toBeGreaterThan(0)
    const repaired = repairConfig(config)
    expect(validateConfig(repaired)).toEqual([])
    expect(repaired.courses[0]).toEqual(course0)
    expect(repaired.courses[1]).toEqual({ id: 'other', name: 'ほかのコース', advisors: course0.advisors, subtitleTemplate: course0.subtitleTemplate })
    expect(repaired.wordChecks).toEqual([{ wrong: '見頃', right: '身頃', severity: 'error' }])
    // そのコースは標準のひな形になる
    expect(courseTemplate(repaired, 'other')).toBe(DEFAULT_TEMPLATE)
    // 元の設定は書き換えない
    expect(config.courses[1].notice).toBe(5)
    // 一覧そのものが崩れていたら、ツールに入っている一覧を使う（空の一覧は「語を使わない」なので残す）
    expect(repairConfig({ ...currentConfig, wordChecks: broken('x') }).wordChecks).toBeUndefined()
    expect(repairConfig({ ...currentConfig, wordChecks: [] }).wordChecks).toEqual([])
    // 崩れていない設定は、そのまま
    expect(repairConfig(currentConfig)).toEqual(currentConfig)
  })

  it('崩れたひな形でも、本文を作るときに止まらない（段落の説明がない・知らない種類の部品）', () => {
    expect(courseTemplate(withTemplate([{ type: 'chapter', title: '概要' }, { type: 'paragraph' }]), course0.id)).toBe(DEFAULT_TEMPLATE)
    expect(courseTemplate(withTemplate('x'), course0.id)).toBe(DEFAULT_TEMPLATE)
    const template = broken([{ type: 'chapter' }, { type: 'paragraph' }, { type: 'figure' }, { type: 'image' }, null, { type: 'materialTable', caption: 7 }]) as TemplateBlock[]
    const body = bodyFromTemplate(template)
    expect(body.map((c) => [c.title, c.blocks.map((b) => b.type)])).toEqual([['', ['paragraph', 'figureRow', 'table']]])
    expect(body[0].blocks[0]).not.toHaveProperty('hint')
  })
})
