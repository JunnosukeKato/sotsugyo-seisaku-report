import { describe, expect, it } from 'vitest'
import { currentConfig, findCourse, renderSubtitle } from '.'

describe('2026年度の設定', () => {
  it('手順書の基準値と一致している', () => {
    expect(currentConfig.abstract).toMatchObject({ minChars: 600, maxChars: 900, minLines: 15, maxLines: 23 })
    expect(currentConfig.body.minPages).toBe(5)
    expect(currentConfig.workPhotos.maxImages).toBe(6)
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
