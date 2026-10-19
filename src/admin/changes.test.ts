import { describe, expect, it } from 'vitest'
import { DEFAULT_WORD_CHECKS } from '../checker/textRules'
import { currentConfig, type Course, type YearConfig } from '../config'
import { describeChanges, mergeEdits, sameConfig, shortChanges } from './changes'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const [film] = currentConfig.courses
const second: Course = { id: 'fashion', name: 'ファッションデザイン', advisors: ['文化 花子'], subtitleTemplate: '―{input}の制作―' }
/** コースが2つある設定（比べる元） */
const base: YearConfig = { ...currentConfig, courses: [film, second] }
/** コースを1つ書き換えた設定 */
const withCourse = (config: YearConfig, id: string, patch: Partial<Course>): YearConfig => ({ ...config, courses: config.courses.map((c) => (c.id === id ? { ...c, ...patch } : c)) })

describe('describeChanges（保存の確認・変更履歴に出す変更の一覧）', () => {
  it('変わった項目を、画面の並び順に、ふつうの言葉で返す', () => {
    const after: YearConfig = withCourse(
      { ...base, deadline: '2027-01-21', commonTitle: '新しい題目', wordChecks: [{ wrong: '見頃', right: '身頃', severity: 'error' }], abstract: { ...base.abstract, minChars: 500, maxChars: 800 } },
      film.id,
      { template: [{ type: 'chapter', title: '概要' }], notice: 'お知らせ' },
    )
    expect(describeChanges(base, after)).toEqual([
      '共通の題目',
      '最終締切',
      '映画・舞台衣装デザイナー コースの下書きのひな形',
      '映画・舞台衣装デザイナー コースのお知らせ',
      '書き間違えやすい語',
      '抄録の文字数',
    ])
    expect(describeChanges(base, clone(base))).toEqual([])
  })

  it('コースの追加・削除・順番・名前・表示・指導教員', () => {
    const added: Course = { id: 'new', name: '', advisors: [], subtitleTemplate: '―{input}の制作―' }
    expect(describeChanges(base, { ...base, courses: [...base.courses, added] })).toEqual(['（名前のないコース） コース（追加）'])
    expect(describeChanges(base, { ...base, courses: [film] })).toEqual([`${second.name} コース（削除）`])
    expect(describeChanges(base, { ...base, courses: [...base.courses].reverse() })).toEqual(['コースの順番'])
    expect(describeChanges(base, withCourse(base, film.id, { name: '衣装', hidden: true, advisors: ['文化 太郎'] }))).toEqual([
      '衣装 コースの名前（元は「映画・舞台衣装デザイナー」）',
      '衣装 コースの「学生に表示」',
      '衣装 コースの指導教員',
    ])
  })

  it('意味の同じ書き方の違い（空のお知らせ・空の手順書のリンク・「必須」・説明なしの語）は変更にしない', () => {
    const same = withCourse({ ...base, handbookUrl: '', driveSave: 'required', wordChecks: DEFAULT_WORD_CHECKS.map((w) => ({ ...w, note: w.note ?? '' })) }, film.id, { notice: '', hidden: false })
    expect(describeChanges(base, same)).toEqual([])
    expect(sameConfig(base, same)).toBe(true)
    // 項目の並びが違っても同じ
    const reordered = { ...base, courses: base.courses.map((c) => Object.fromEntries(Object.entries(c).reverse()) as unknown as Course) }
    expect(sameConfig(base, reordered)).toBe(true)
    expect(sameConfig(base, withCourse(base, film.id, { notice: 'x' }))).toBe(false)
    expect(sameConfig(base, { ...base, driveSave: 'off' })).toBe(false)
  })

  it('知らない項目の変更は「そのほかの設定」', () => {
    expect(describeChanges(base, { ...base, extra: 1 } as YearConfig)).toEqual(['そのほかの設定'])
  })

  it('短くまとめる（変更履歴の1行）', () => {
    expect(shortChanges(['a', 'b'])).toBe('a、b')
    expect(shortChanges(['a', 'b', 'c', 'd', 'e'])).toBe('a、b、c ほか2件')
  })
})

describe('mergeEdits（別のタブ・ほかの人が先に保存していたとき、自分の変更だけを入れ直す）', () => {
  it('違う項目なら、最新の設定に自分の変更を入れる', () => {
    const mine = withCourse({ ...base, commonTitle: '自分の題目' }, film.id, { notice: '自分のお知らせ' })
    const theirs = withCourse({ ...base, deadline: '2027-01-22' }, second.id, { template: [{ type: 'chapter', title: '先生のひな形' }] })
    const { config, conflicts } = mergeEdits(base, mine, theirs)
    expect(conflicts).toEqual([])
    expect(config.commonTitle).toBe('自分の題目')
    expect(config.deadline).toBe('2027-01-22')
    expect(config.courses[0].notice).toBe('自分のお知らせ')
    expect(config.courses[1].template).toEqual([{ type: 'chapter', title: '先生のひな形' }])
    // 入れ直した設定は、最新の設定から見ると自分の変更だけ
    expect(describeChanges(theirs, config)).toEqual(['共通の題目', '映画・舞台衣装デザイナー コースのお知らせ'])
  })

  it('同じ項目を両方が別の内容に変えていたら、入れ直さずに知らせる（同じ内容なら問題なし）', () => {
    const mine = withCourse({ ...base, commonTitle: 'A' }, film.id, { notice: 'x' })
    const theirs = withCourse({ ...base, commonTitle: 'B' }, film.id, { notice: 'x' })
    expect(mergeEdits(base, mine, theirs).conflicts).toEqual(['共通の題目'])
    expect(mergeEdits(base, withCourse(base, film.id, { notice: '自分' }), withCourse(base, film.id, { notice: '先生' })).conflicts).toEqual(['映画・舞台衣装デザイナー コースのお知らせ'])
  })

  it('消した項目・入れ物の中の項目も入れ直す', () => {
    const mine = withCourse({ ...base, abstract: { ...base.abstract, minChars: 500 } }, film.id, { notice: undefined })
    const theirs = { ...withCourse(base, film.id, { notice: '前からのお知らせ' }), abstract: { ...base.abstract, maxChars: 1000 } }
    const start = withCourse(base, film.id, { notice: '前からのお知らせ' })
    const { config, conflicts } = mergeEdits(start, mine, theirs)
    expect(conflicts).toEqual([])
    expect(config.abstract).toEqual({ ...base.abstract, minChars: 500, maxChars: 1000 })
    expect(config.courses[0]).not.toHaveProperty('notice')
  })

  it('コースの追加・並べ替えは、片方だけならその並びに。両方が別々に変えていたら入れ直さない', () => {
    const added: Course = { id: 'new', name: '新しいコース', advisors: [], subtitleTemplate: '―{input}の制作―' }
    const mine = { ...base, courses: [...base.courses, added] }
    const theirs = withCourse(base, film.id, { notice: '先生' })
    const merged = mergeEdits(base, mine, theirs)
    expect(merged.conflicts).toEqual([])
    expect(merged.config.courses.map((c) => c.id)).toEqual([film.id, second.id, 'new'])
    expect(merged.config.courses[0].notice).toBe('先生')
    expect(mergeEdits(base, mine, { ...base, courses: [...base.courses].reverse() }).conflicts).toEqual(['コースの追加・削除・順番'])
    // 自分が消したコースを、ほかの人が直していた
    expect(mergeEdits(base, { ...base, courses: [film] }, withCourse(base, second.id, { notice: '先生' })).conflicts).toEqual([`${second.name} コース（削除）`])
  })

  it('自分が何も変えていなければ、最新の設定のまま', () => {
    const theirs = { ...base, commonTitle: '先生の題目' }
    expect(mergeEdits(base, clone(base), theirs)).toEqual({ config: theirs, conflicts: [] })
  })
})
