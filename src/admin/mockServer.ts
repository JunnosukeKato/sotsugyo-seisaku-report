import { currentConfig, type YearConfig } from '../config'
import type { AdminServer, AdminState, HistoryRow, YearRow } from './server'

/**
 * 開発用の試験サーバー（ブラウザ内だけで動く）。本番の gas/admin-project/Code.js と同じ振る舞いをまねる。
 * 年度設定はこのブラウザの localStorage に保存する。
 */

const KEY = 'sotsugyo-admin-mock'
const USER = 'admin@example.ac.jp'

interface Store {
  years: YearRow[]
  history: HistoryRow[]
}

function load(): Store {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Store | null
    if (saved) return saved
  } catch {
    // 壊れていたら作り直す
  }
  return { years: [{ year: currentConfig.fiscalYear, status: '公開中', config: currentConfig, updatedAt: new Date().toISOString(), updatedBy: USER }], history: [] }
}

function save(store: Store): void {
  localStorage.setItem(KEY, JSON.stringify(store))
}

const wait = () => new Promise((r) => setTimeout(r, 200))
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

export function createMockServer(): AdminServer {
  const state = (store: Store): AdminState => ({ user: USER, isAdmin: true, years: clone(store.years).sort((a, b) => b.year - a.year) })
  const record = (store: Store, year: number, action: string, config: YearConfig) =>
    store.history.push({ at: new Date().toISOString(), user: USER, year, action, config: clone(config) })

  return {
    async getState() {
      await wait()
      return state(load())
    },
    async saveYear(config) {
      await wait()
      const store = load()
      const row = store.years.find((y) => y.year === config.fiscalYear)
      if (row) Object.assign(row, { config, updatedAt: new Date().toISOString(), updatedBy: USER })
      else store.years.push({ year: config.fiscalYear, status: '準備中', config, updatedAt: new Date().toISOString(), updatedBy: USER })
      record(store, config.fiscalYear, '保存', config)
      save(store)
      return state(store)
    },
    async publishYear(year) {
      await wait()
      const store = load()
      for (const row of store.years) {
        if (row.year === year) row.status = '公開中'
        else if (row.status === '公開中') row.status = '終了'
      }
      const row = store.years.find((y) => y.year === year)!
      record(store, year, '公開', row.config)
      save(store)
      return state(store)
    },
    async createYear(fromYear, newYear) {
      await wait()
      const store = load()
      if (store.years.some((y) => y.year === newYear)) throw new Error(`${newYear}年度はすでにあります`)
      const from = store.years.find((y) => y.year === fromYear)!
      const config: YearConfig = { ...clone(from.config), fiscalYear: newYear }
      store.years.push({ year: newYear, status: '準備中', config, updatedAt: new Date().toISOString(), updatedBy: USER })
      record(store, newYear, `${fromYear}年度からコピーして作成`, config)
      save(store)
      return state(store)
    },
    async getHistory(year) {
      await wait()
      return load()
        .history.filter((h) => h.year === year)
        .reverse()
    },
  }
}
