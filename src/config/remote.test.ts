// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { currentConfig } from '.'
import type { YearConfig } from './types'

/** 配信の窓口（偽物）：年度ごとの設定を返す */
const years = new Map<number, YearConfig>()
const memory = new Map<string, string>()
vi.stubGlobal('localStorage', { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, v) })
vi.stubGlobal('fetch', async (url: string) => {
  const year = Number(new URL(url).searchParams.get('year'))
  const config = year ? years.get(year) : [...years.values()].at(-1)
  return { json: async () => (config ? { ok: true, config } : { ok: false }) }
})

const { loadConfig, loadYearConfig } = await import('./remote')
const API = 'https://example.test/exec'

beforeEach(() => {
  years.clear()
  memory.clear()
})

describe('年度の設定を読み込む', () => {
  it('原稿の年度の設定を、その年度を指定して読む（公開中の年度とは別）', async () => {
    years.set(2026, { ...currentConfig, fiscalYear: 2026, commonTitle: '2026年度の題目' })
    years.set(2027, { ...currentConfig, fiscalYear: 2027, commonTitle: '2027年度の題目' })
    expect((await loadConfig(API)).config.commonTitle).toBe('2027年度の題目')
    expect((await loadYearConfig(2026, API))?.commonTitle).toBe('2026年度の題目')
  })

  it('読めなければ、前に控えた設定。なければ同梱の初期値（同じ年度のときだけ）、それもなければ null', async () => {
    years.set(2026, { ...currentConfig, fiscalYear: 2026, commonTitle: '控えた題目' })
    await loadYearConfig(2026, API)
    years.clear()
    expect((await loadYearConfig(2026, API))?.commonTitle).toBe('控えた題目')
    memory.clear()
    expect((await loadYearConfig(currentConfig.fiscalYear, API))?.fiscalYear).toBe(currentConfig.fiscalYear)
    expect(await loadYearConfig(2019, API)).toBeNull()
  })
})
