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

  it('コースのひな形が崩れていても設定全体は捨てず、そのコースだけ標準のひな形にする（控えも直したもの）', async () => {
    const course = { ...currentConfig.courses[0], template: [{ type: 'chapter', title: '概要' }, { type: 'paragraph' }] as never }
    years.set(2026, { ...currentConfig, fiscalYear: 2026, commonTitle: '配信の題目', courses: [course] })
    const { config, source } = await loadConfig(API)
    expect(source).toBe('remote')
    expect(config.commonTitle).toBe('配信の題目')
    expect(config.courses[0].template).toBeUndefined()
    expect(JSON.parse(memory.get('sotsugyo-seisaku-report-config')!).courses[0].template).toBeUndefined()
    // 題目がないなど、設定全体の問題があれば、使わない（同梱の初期値で動く）
    years.set(2026, { ...currentConfig, fiscalYear: 2026, commonTitle: '' })
    memory.clear()
    expect(await loadConfig(API)).toMatchObject({ source: 'bundled' })
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
