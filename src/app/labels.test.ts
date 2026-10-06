import { describe, expect, it } from 'vitest'
import { daysUntil } from './labels'

describe('締切まで何日か', () => {
  it('日付で数える（前日は1、当日は0、過ぎたら負）', () => {
    expect(daysUntil('2027-01-20', new Date(2027, 0, 19, 23, 50))).toBe(1)
    expect(daysUntil('2027-01-20', new Date(2027, 0, 20, 0, 5))).toBe(0)
    expect(daysUntil('2027-01-20', new Date(2027, 0, 20, 23, 50))).toBe(0)
    expect(daysUntil('2027-01-20', new Date(2027, 0, 21, 9, 0))).toBe(-1)
    expect(daysUntil('2027-01-20', new Date(2026, 9, 5, 12, 0))).toBe(107)
  })
})
