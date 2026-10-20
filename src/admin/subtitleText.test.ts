import { describe, expect, it } from 'vitest'
import { currentConfig, subtitleInputOnly, type YearConfig } from '../config'
import { subtitleLine } from '../layout/document'
import { DATA_FORMAT_VERSION, type Report } from '../model/types'
import { describeChanges, sameConfig } from './changes'
import { endsWithCourse, joinSubtitle, splitSubtitle, subtitleExample } from './subtitleText'
import { readFormWidth } from './useFormWidth'

describe('サブタイトルの形式（前後の「―」は欄の外に固定）', () => {
  it('今の設定の形式は、前後の「―」を外して欄に出し、保存すると元の形式に戻る', () => {
    expect(splitSubtitle('―{input}の衣装制作―')).toEqual(['', 'の衣装制作'])
    expect(splitSubtitle('―{input}の制作―')).toEqual(['', 'の制作'])
    expect(splitSubtitle('―{input}―')).toEqual(['', ''])
    expect(splitSubtitle('―卒業制作「{input}」―')).toEqual(['卒業制作「', '」'])
    for (const t of ['―{input}の衣装制作―', '―{input}の制作―', '―{input}―', '―卒業制作「{input}」―', '――{input}――']) expect(joinSubtitle(...splitSubtitle(t))).toBe(t)
  })

  it('線として打った「—」「－」「ー」も1つずつ外す（終わりの「ー」は、はじめにも線があるときだけ）', () => {
    expect(splitSubtitle('—{input}の制作—')).toEqual(['', 'の制作'])
    expect(splitSubtitle('－{input}の制作－')).toEqual(['', 'の制作'])
    expect(splitSubtitle('ー{input}の制作ー')).toEqual(['', 'の制作'])
    // 線のない形式の終わりの「ー」は、語の終わり（ストーリー）なので外さない
    expect(splitSubtitle('{input}のストーリー')).toEqual(['', 'のストーリー'])
    expect(splitSubtitle('―{input}のストーリー―')).toEqual(['', 'のストーリー'])
    // 2つ並んでいても、外すのは1つだけ
    expect(splitSubtitle('――{input}――')).toEqual(['―', '―'])
  })

  it('保存する形式は、いつも前後に「―」が付く', () => {
    expect(joinSubtitle('', 'の制作')).toBe('―{input}の制作―')
    expect(joinSubtitle('卒業制作「', '」')).toBe('―卒業制作「{input}」―')
    // 線のない形式を直すと、前後に「―」が付く
    const [before, after] = splitSubtitle('{input}の制作')
    expect(joinSubtitle(before, `${after}物`)).toBe('―{input}の制作物―')
  })

  it('「例：」は、保存されている形式に例の言葉を当てはめる（前後の線も出る）', () => {
    expect(subtitleExample('―{input}の衣装制作―')).toBe('―シンドバッドの衣装制作―')
  })

  it('開いて、何も変えずに（書いて消して）保存しても、変更にならない（変更履歴・保存の確認に出ない）', () => {
    const roundTrip: YearConfig = { ...currentConfig, courses: currentConfig.courses.map((c) => ({ ...c, subtitleTemplate: joinSubtitle(...splitSubtitle(c.subtitleTemplate)) })) }
    expect(sameConfig(currentConfig, roundTrip)).toBe(true)
    expect(describeChanges(currentConfig, roundTrip)).toEqual([])
  })

  it('学生のツールの表紙のサブタイトルと、入力からの決まり文句の取り除きは、今までどおり', () => {
    const [course] = currentConfig.courses
    const saved = { ...course, subtitleTemplate: joinSubtitle(...splitSubtitle(course.subtitleTemplate)) }
    const config: YearConfig = { ...currentConfig, courses: [saved] }
    const report: Report = {
      formatVersion: DATA_FORMAT_VERSION,
      fiscalYear: config.fiscalYear,
      basicInfo: { studentId: '', name: '', courseId: saved.id, subtitleInput: '海の王女' },
      abstract: { paragraphs: [] },
      body: [],
      references: [],
      workPhotos: [],
      updatedAt: '',
    }
    expect(subtitleLine(report, config)).toBe('―海の王女の衣装制作―')
    expect(subtitleInputOnly(saved, '―海の王女の衣装制作―')).toBe('海の王女')
  })
})

describe('コース名の最後の「コース」', () => {
  it('名前の最後に「コース」があると知らせる（前後の空白は見ない）', () => {
    expect(endsWithCourse('ファッションデザインコース')).toBe(true)
    expect(endsWithCourse('ファッションデザインコース ')).toBe(true)
    expect(endsWithCourse('映画・舞台衣装デザイナー')).toBe(false)
    expect(endsWithCourse('コースデザイン')).toBe(false)
  })
})

describe('左の入力欄の幅（このブラウザに覚えておく）', () => {
  it('覚えておいた幅を読む（決めていない・既定の幅・読めないときは null。範囲の外は端の幅）', () => {
    expect(readFormWidth(null)).toBeNull()
    expect(readFormWidth('')).toBeNull()
    expect(readFormWidth('abc')).toBeNull()
    expect(readFormWidth('560')).toBeNull()
    expect(readFormWidth('600')).toBe(600)
    expect(readFormWidth('100')).toBe(480)
    expect(readFormWidth('5000')).toBe(900)
  })
})
