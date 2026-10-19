import { describe, expect, it } from 'vitest'
import { courseIdInText, currentConfig, findCourse, renderSubtitle, subtitleInputOnly } from '.'

describe('2026年度の設定', () => {
  it('手順書の基準値と一致している', () => {
    expect(currentConfig.abstract).toMatchObject({ minChars: 600, maxChars: 900, minLines: 15, maxLines: 23 })
    expect(currentConfig.body.minPages).toBe(5)
    // 作品写真は何ページでもよい（ページ数の上限なし。mockups/v38：依頼者の判断）
    expect(currentConfig.workPhotos.maxPages).toBeNull()
    expect(currentConfig.commonTitle).toBe('卒業イベント「シンドバッド」について')
  })

  it('名称が「卒業制作」系に統一されている', () => {
    expect(currentConfig.reportName).toBe('卒業制作報告書')
    expect(currentConfig.cover.heading).toBe('卒業制作')
    expect(currentConfig.cover.titleLabel).toBe('制作題目')
    expect(JSON.stringify(currentConfig)).not.toContain('研究')
  })

  it('コースの ID が重複していない', () => {
    const ids = currentConfig.courses.map((course) => course.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('renderSubtitle', () => {
  it('コースの指定形式に入力を当てはめる', () => {
    const course = findCourse(currentConfig, 'film-stage-costume')!
    expect(renderSubtitle(course, ' パリス ')).toBe('―パリスの衣装制作―')
  })
})

describe('subtitleInputOnly（サブタイトルの決まり文句まで入力したとき）', () => {
  const course = findCourse(currentConfig, 'film-stage-costume')!
  const plain = { ...course, subtitleTemplate: '―{input}―' }

  it('前後の決まり文句（「―」「の衣装制作―」）を取り、入力する部分だけにする（表紙で二重にならない）', () => {
    expect(subtitleInputOnly(course, '―海の王女の衣装制作―')).toBe('海の王女')
    expect(renderSubtitle(course, subtitleInputOnly(course, '―海の王女の衣装制作―'))).toBe('―海の王女の衣装制作―')
    expect(subtitleInputOnly(course, '海の王女の衣装制作')).toBe('海の王女')
    expect(subtitleInputOnly(course, '―海の王女―')).toBe('海の王女')
    expect(subtitleInputOnly(plain, '―パリス―')).toBe('パリス')
  })

  it('線を「ー」「－」「—」で打っていても取る', () => {
    expect(subtitleInputOnly(course, 'ー海の王女の衣装制作ー')).toBe('海の王女')
    expect(subtitleInputOnly(course, '－海の王女の衣装制作－')).toBe('海の王女')
    expect(subtitleInputOnly(course, '—海の王女の衣装制作—')).toBe('海の王女')
    expect(subtitleInputOnly(course, '海の王女の衣装制作ー')).toBe('海の王女')
  })

  it('入力する部分だけなら、そのまま。語の終わりの「ー」は取らない', () => {
    expect(subtitleInputOnly(course, ' 海の王女 ')).toBe('海の王女')
    expect(subtitleInputOnly(course, 'シンデレラ・ストーリー')).toBe('シンデレラ・ストーリー')
    expect(subtitleInputOnly(course, '―シンデレラ・ストーリー―')).toBe('シンデレラ・ストーリー')
    expect(subtitleInputOnly(course, '映画『千夜一夜物語』の王子')).toBe('映画『千夜一夜物語』の王子')
  })

  it('決まり文句だけを入力したとき（取ると何も残らない）は、そのまま', () => {
    expect(subtitleInputOnly(course, 'の衣装制作')).toBe('の衣装制作')
    expect(subtitleInputOnly(course, '')).toBe('')
  })
})

describe('文の中のコースの名前から、コースを探す（Word の表紙・抄録）', () => {
  const config = {
    ...currentConfig,
    courses: [
      { id: 'a', name: '映画・舞台衣装デザイナー', advisors: [], subtitleTemplate: '―{input}の衣装制作―' },
      { id: 'b', name: 'スタイリスト・コーディネーター', advisors: [], subtitleTemplate: '―{input}の衣装制作―' },
      { id: 'c', name: '衣装', advisors: [], subtitleTemplate: '―{input}―' },
    ],
  }
  it('全角・半角と空白の違いは見ず、長い名前から探す', () => {
    expect(courseIdInText(['国際文化学部・国際ファッション文化学科', 'スタイリスト・コーディネーター', 'コース'], config)).toBe('b')
    expect(courseIdInText(['映画・舞台 衣装デザイナー コース'], config)).toBe('a')
    expect(courseIdInText(['衣装コース'], config)).toBe('c')
    expect(courseIdInText(['〇〇コース'], config)).toBeNull()
  })
})
