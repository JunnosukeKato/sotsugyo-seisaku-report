import { describe, expect, it } from 'vitest'
import { currentConfig } from '.'
import { bodyFromTemplate, courseTemplate, DEFAULT_TEMPLATE } from '../model/template'
import type { TemplateBlock, YearConfig } from './types'
import { COVER_TITLE_UNITS, repairConfig, templateProblems, validateConfig } from './validate'

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

  it('最終締切は実在する日付だけ（年が6桁・2月30日などはエラー。分かる言葉で）', () => {
    const deadline = (d: string) => validateConfig({ ...currentConfig, deadline: d }).filter((p) => p.field === 'deadline')
    for (const bad of ['202801-12-20', '2027-02-30', '2027-13-01', '2027/01/20', '2027-1-20']) {
      expect(deadline(bad)).toEqual([{ field: 'deadline', severity: 'error', message: '最終締切の日付が正しくありません（例：2027/01/20）' }])
    }
    expect(deadline('')).toEqual([expect.objectContaining({ severity: 'error', message: '最終締切の日付を入力してください' })])
    expect(deadline('2027-01-20')).toEqual([])
    expect(deadline('2027-03-31')).toEqual([])
    expect(deadline('2026-04-01')).toEqual([])
  })

  it('最終締切が年度の期間の外（前の年度の日付のままなど）なら確認を出す（公開は止めない）', () => {
    const deadline = (d: string) => validateConfig({ ...currentConfig, fiscalYear: 2027, deadline: d }).filter((p) => p.field === 'deadline')
    expect(deadline('2027-01-20')).toEqual([
      { field: 'deadline', severity: 'warning', message: '最終締切（2027年1月20日）が、2027年度（2027年4月1日〜2028年3月31日）の外です。前の年度の日付のままでないか確かめてください' },
    ])
    expect(deadline('2028-04-01')).toEqual([expect.objectContaining({ severity: 'warning' })])
    expect(deadline('2028-01-19')).toEqual([])
  })

  it('最終締切が今日より前かは、今日の日付を渡したとき（管理ページ）だけ確かめる（学生のツールでは日によって結果が変わらない）', () => {
    const config = { ...currentConfig, deadline: '2026-10-01' }
    expect(validateConfig(config)).toEqual([])
    expect(validateConfig(config, { today: '2026-10-19' })).toEqual([{ field: 'deadline', severity: 'warning', message: '最終締切（2026年10月1日）が、今日より前です' }])
    expect(validateConfig(config, { today: '2026-10-01' })).toEqual([])
    // 初期値（2027年1月20日締切）は、今日の日付を渡しても問題なし
    expect(validateConfig(currentConfig, { today: '2026-10-19' })).toEqual([])
  })

  it('共通の題目が表紙の1行（144.2mm・22pt。全角18.6字分）に収まらなければ確認を出す', () => {
    const title = (t: string) => validateConfig({ ...currentConfig, commonTitle: t }).filter((p) => p.field === 'commonTitle')
    expect(COVER_TITLE_UNITS).toBeCloseTo(18.58, 1)
    // 2026年度の題目（18字）は収まる
    expect(title(currentConfig.commonTitle)).toEqual([])
    expect(title('あ'.repeat(18))).toEqual([])
    expect(title('あ'.repeat(18) + 'A')).toEqual([])
    expect(title('あ'.repeat(19))).toEqual([expect.objectContaining({ severity: 'warning', message: expect.stringContaining('表紙の1行に収まらないおそれがあります（表紙の題目は1行で、全角18字ほどまで。今は19字分）') })])
    expect(title('卒業イベント「シンドバッドと七つの海の冒険」について')).toEqual([expect.objectContaining({ severity: 'warning' })])
  })
})

describe('崩れた設定（管理ページのサーバーを通らずに書かれたものなど）', () => {
  it('ひな形の部品の形・種類・長さを確かめる（段落の説明は空でもよいが、文字であること）', () => {
    const chapter = { type: 'chapter', title: '概要' }
    expect(templateProblems([chapter, { type: 'paragraph', hint: '' }])).toEqual([])
    expect(templateProblems([])).toEqual([])
    expect(templateProblems('x')).toEqual(['の形が正しくありません'])
    expect(templateProblems([{ type: 'chapter' }])).toEqual(['の1行目の大見出しの形が正しくありません'])
    expect(templateProblems([chapter, { type: 'paragraph' }])).toEqual(['の2行目の説明の形が正しくありません'])
    expect(templateProblems([chapter, { type: 'figure', caption: 3 }])).toEqual(['の2行目の図の枠の形が正しくありません'])
    expect(templateProblems([chapter, { type: 'toString', title: 'x' }, null])).toEqual(['の2行目の形が正しくありません', 'の3行目の形が正しくありません'])
    // 長すぎる行は、種類と書き出しと字数で示す（サーバーの言葉と同じ）
    expect(templateProblems([chapter, { type: 'paragraph', hint: 'あ'.repeat(301) }])).toEqual(['の2行目の説明「ああああああああああああ…」が長すぎます（300字まで。今は301字）'])
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
    expect(validateConfig(withTemplate([{ type: 'paragraph' }])).map((p) => p.message)).toEqual(['「映画・舞台衣装デザイナー」の下書きのひな形の1行目の説明の形が正しくありません'])
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

describe('作品写真のページ数の上限（mockups/v38：枚数の上限 maxImages をやめた）', () => {
  it('空（null）は上限なし。入れるなら1以上の整数（0・小数・文字はエラー）', () => {
    const errorsOf = (maxPages: unknown) => validateConfig({ ...currentConfig, workPhotos: { maxPages } as never }).filter((p) => p.field === 'workPhotos.maxPages' && p.severity === 'error')
    expect(errorsOf(null)).toEqual([])
    expect(errorsOf(3)).toEqual([])
    expect(errorsOf(0)).toHaveLength(1)
    expect(errorsOf(1.5)).toHaveLength(1)
    expect(errorsOf('3')).toHaveLength(1)
  })

  it('前の版の設定（maxImages: 6 だけ）は、学生のツールでは上限なしで読む（maxImages は使わない）。崩れた値も上限なし', () => {
    const old = { ...currentConfig, workPhotos: { maxImages: 6 } } as never
    expect(validateConfig(old).filter((p) => p.severity === 'error')).toEqual([])
    expect(repairConfig(old).workPhotos).toEqual({ maxPages: null })
    expect(repairConfig({ ...currentConfig, workPhotos: { maxPages: 2 } }).workPhotos).toEqual({ maxPages: 2 })
    expect(repairConfig({ ...currentConfig, workPhotos: { maxPages: -1 } } as never).workPhotos).toEqual({ maxPages: null })
  })
})
