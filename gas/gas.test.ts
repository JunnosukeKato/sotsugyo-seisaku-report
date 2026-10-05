// Apps Script のプログラム（gas/*/Code.js）を、Google のサービスをまねた簡易版の上で動かして確かめる。
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { beforeEach, describe, expect, it } from 'vitest'
import initialConfig from '../src/config/2026.json'

type Cell = string | number | Date
class FakeSheet {
  rows: Cell[][] = []
  constructor(public name: string) {}
  getLastRow = () => this.rows.length
  appendRow = (row: Cell[]) => void this.rows.push([...row])
  setFrozenRows = () => {}
  getDataRange = () => ({ getValues: () => this.rows.map((r) => [...r]) })
  getRange = (row: number, col: number, numRows = 1, numCols = 1) => ({
    setFontWeight: () => {},
    setValue: (v: Cell) => void (this.rows[row - 1][col - 1] = v),
    setValues: (values: Cell[][]) => {
      for (let i = 0; i < numRows; i++) for (let j = 0; j < numCols; j++) this.rows[row - 1 + i][col - 1 + j] = values[i][j]
    },
    getValue: () => this.rows[row - 1][col - 1],
  })
}

class FakeSpreadsheet {
  sheets: FakeSheet[] = [new FakeSheet('シート1')]
  getSheetByName = (name: string) => this.sheets.find((s) => s.name === name) ?? null
  insertSheet = (name: string) => {
    const s = new FakeSheet(name)
    this.sheets.push(s)
    return s
  }
  getSheets = () => this.sheets
  deleteSheet = (s: FakeSheet) => void (this.sheets = this.sheets.filter((x) => x !== s))
  getId = () => 'sheet-id'
}

let spreadsheet: FakeSpreadsheet
let user = 'kato@example.ac.jp'

function load(project: 'admin-project' | 'api-project') {
  const source = readFileSync(`gas/${project}/Code.js`, 'utf8').replace('/*INITIAL_CONFIG*/ null', JSON.stringify(initialConfig))
  const cache = new Map<string, string>()
  const context = createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet },
    Session: { getActiveUser: () => ({ getEmail: () => user }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Logger: { log: () => {} },
    CacheService: { getScriptCache: () => ({ get: (k: string) => cache.get(k) ?? null, put: (k: string, v: string) => void cache.set(k, v) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'sheet-id' }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text: string) => ({ text, setMimeType() { return this } }) },
    HtmlService: { createHtmlOutputFromFile: () => ({ setTitle() { return this }, addMetaTag() { return this } }) },
    JSON,
    Date,
    Number,
    String,
    Error,
  })
  runInContext(source, context)
  return context as unknown as Record<string, (...args: unknown[]) => any>
}

beforeEach(() => {
  spreadsheet = new FakeSpreadsheet()
  user = 'kato@example.ac.jp'
})

describe('管理ページ（admin-project）', () => {
  it('setup でシートができ、実行した人が管理者になり、初期値が公開中で入る', () => {
    const gas = load('admin-project')
    gas.setup()
    expect(spreadsheet.sheets.map((s) => s.name)).toEqual(['年度設定', '変更履歴', '管理者'])
    const state = gas.getState()
    expect(state).toMatchObject({ user: 'kato@example.ac.jp', isAdmin: true })
    expect(state.years).toHaveLength(1)
    expect(state.years[0]).toMatchObject({ year: 2026, status: '公開中', config: { commonTitle: initialConfig.commonTitle } })
  })

  it('管理者でない人には年度設定を見せず、保存もさせない', () => {
    const gas = load('admin-project')
    gas.setup()
    user = 'student@example.ac.jp'
    expect(gas.getState()).toMatchObject({ isAdmin: false, years: [] })
    expect(() => gas.saveYear(initialConfig)).toThrow(/管理者だけ/)
  })

  it('保存・新年度の作成・公開・変更履歴', () => {
    const gas = load('admin-project')
    gas.setup()
    gas.saveYear({ ...initialConfig, commonTitle: '新しい題目' })
    expect(gas.getState().years[0].config.commonTitle).toBe('新しい題目')

    const created = gas.createYear(2026, 2027)
    expect(created.years.map((y: { year: number; status: string }) => `${y.year}:${y.status}`)).toEqual(['2027:準備中', '2026:公開中'])
    expect(() => gas.createYear(2026, 2027)).toThrow(/すでにあります/)

    const published = gas.publishYear(2027)
    expect(published.years.map((y: { year: number; status: string }) => `${y.year}:${y.status}`)).toEqual(['2027:公開中', '2026:終了'])

    const history = gas.getHistory(2026)
    expect(history.map((h: { action: string }) => h.action)).toEqual(['保存', '初期設定'])
  })
})

describe('配信（api-project）', () => {
  it('公開中の年度設定を返す。準備中の年度は返さない', () => {
    const admin = load('admin-project')
    admin.setup()
    admin.createYear(2026, 2027)
    const api = load('api-project')
    const published = JSON.parse(api.doGet({ parameter: {} }).text)
    expect(published).toMatchObject({ ok: true, year: 2026, config: { fiscalYear: 2026 } })
    const draft = JSON.parse(api.doGet({ parameter: { year: '2027' } }).text)
    expect(draft.ok).toBe(false)
  })

  it('公開中の年度がなければ ok: false を返す', () => {
    load('admin-project').setup()
    spreadsheet.getSheetByName('年度設定')!.rows[1][1] = '終了'
    const body = JSON.parse(load('api-project').doGet({ parameter: {} }).text)
    expect(body).toEqual({ ok: false, error: '公開中の年度設定がありません' })
  })
})
