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
  deleteRow = (row: number) => void this.rows.splice(row - 1, 1)
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

  it('先生を登録すると、下書きのひな形だけを保存できる（ほかの設定は変えられない）', () => {
    const gas = load('admin-project')
    gas.setup()
    const members = gas.addMember('sensei@example.ac.jp', '先生', '衣装の先生')
    expect(members.map((m: { email: string; role: string }) => `${m.email}:${m.role}`)).toEqual(['kato@example.ac.jp:管理者', 'sensei@example.ac.jp:先生'])

    user = 'sensei@example.ac.jp'
    const state = gas.getState()
    expect(state).toMatchObject({ isAdmin: false, role: 'teacher' })
    expect(state.years).toHaveLength(1)
    expect(() => gas.saveYear({ ...initialConfig, commonTitle: '先生が変えた題目' })).toThrow(/管理者だけ/)
    expect(() => gas.addMember('x@example.ac.jp', '先生')).toThrow(/管理者だけ/)

    const template = [{ type: 'chapter', title: '概要' }, { type: 'paragraph', hint: '概要を書く' }]
    const saved = gas.saveTemplates(2026, { 'film-stage-costume': { template, abstractExample: '本制作報告書は、' }, 'no-such-course': { template } })
    const course = saved.years[0].config.courses[0]
    expect(course).toMatchObject({ template, abstractExample: '本制作報告書は、' })
    expect(saved.years[0].config.commonTitle).toBe(initialConfig.commonTitle)
    expect(gas.getHistory(2026)[0].action).toContain('下書きのひな形を保存')
  })

  it('先生もコースのお知らせを保存できる（指定したコースだけ書き換える）', () => {
    const gas = load('admin-project')
    gas.setup()
    gas.addMember('sensei@example.ac.jp', '先生')
    user = 'sensei@example.ac.jp'
    const saved = gas.saveNotices(2026, { 'film-stage-costume': '中間発表の準備をしてください', 'no-such-course': 'x' })
    const course = saved.years[0].config.courses[0]
    expect(course.notice).toBe('中間発表の準備をしてください')
    expect(saved.years[0].config.commonTitle).toBe(initialConfig.commonTitle)
    expect(gas.getHistory(2026)[0].action).toContain('お知らせを保存')
    user = 'student@example.ac.jp'
    expect(() => gas.saveNotices(2026, {})).toThrow(/登録された先生だけ/)
  })

  it('先生も書き間違えやすい語を保存できる（空の行・同じ語の行は捨てる）', () => {
    const gas = load('admin-project')
    gas.setup()
    gas.addMember('sensei@example.ac.jp', '先生')
    user = 'sensei@example.ac.jp'
    const words = [
      { wrong: ' 見頃 ', right: '身頃', note: '服の胴の部分', severity: 'error' },
      { wrong: '記事', right: '生地', severity: 'warning' },
      { wrong: '', right: '空', severity: 'error' },
      { wrong: '同じ', right: '同じ', severity: 'error' },
      { wrong: '芯地', right: '芯', severity: 'what' },
    ]
    const saved = gas.saveWordChecks(2026, words)
    expect(saved.years[0].config.wordChecks).toEqual([
      { wrong: '見頃', right: '身頃', note: '服の胴の部分', severity: 'error' },
      { wrong: '記事', right: '生地', note: '', severity: 'warning' },
      { wrong: '芯地', right: '芯', note: '', severity: 'error' },
    ])
    expect(saved.years[0].config.commonTitle).toBe(initialConfig.commonTitle)
    expect(gas.getHistory(2026)[0].action).toBe('書き間違えやすい語を保存（3語）')
    expect(() => gas.saveWordChecks(2026, 'x')).toThrow(/形が正しくありません/)
    user = 'student@example.ac.jp'
    expect(() => gas.saveWordChecks(2026, [])).toThrow(/登録された先生だけ/)
  })

  it('管理者は、まとめて登録できる（登録済みの人はそのまま。先生はまとめて登録できない）', () => {
    const gas = load('admin-project')
    gas.setup()
    gas.addMember('sensei@example.ac.jp', '先生', '前からの先生')
    const list = gas.addMembers(
      [
        { email: ' a@example.ac.jp ', memo: '文化 太郎' },
        { email: 'SENSEI@example.ac.jp', memo: '上書きしない' },
        { email: 'b@example.ac.jp', memo: '' },
        { email: 'not-an-address', memo: '' },
      ],
      '先生',
    )
    expect(list.map((m: { email: string; role: string; memo: string }) => `${m.email}:${m.role}:${m.memo}`)).toEqual([
      'kato@example.ac.jp:管理者:初期設定で登録',
      'sensei@example.ac.jp:先生:前からの先生',
      'a@example.ac.jp:先生:文化 太郎',
      'b@example.ac.jp:先生:',
    ])
    expect(() => gas.addMembers([], '学生')).toThrow(/役割が正しくありません/)
    user = 'sensei@example.ac.jp'
    expect(() => gas.addMembers([{ email: 'c@example.ac.jp' }], '先生')).toThrow(/管理者だけ/)
  })

  it('登録していない人はひな形を保存できない。自分の登録は外せない', () => {
    const gas = load('admin-project')
    gas.setup()
    gas.addMember('sensei@example.ac.jp', '先生')
    expect(() => gas.removeMember('kato@example.ac.jp')).toThrow(/外せません/)
    expect(gas.removeMember('sensei@example.ac.jp')).toHaveLength(1)
    user = 'student@example.ac.jp'
    expect(gas.getState()).toMatchObject({ role: null, years: [] })
    expect(() => gas.saveTemplates(2026, {})).toThrow(/登録された先生だけ/)
  })

  it('管理者がいるあとは、登録していない人が setup を呼んでも管理者にならない', () => {
    const gas = load('admin-project')
    gas.setup()
    user = 'student@example.ac.jp'
    expect(() => gas.setup()).toThrow(/管理者だけ/)
    expect(gas.getState()).toMatchObject({ role: null, years: [] })
    user = 'kato@example.ac.jp'
    expect(gas.getMembers().map((m: { email: string }) => m.email)).toEqual(['kato@example.ac.jp'])
    // 管理者は、何度実行してもよい
    expect(() => gas.setup()).not.toThrow()
  })

  it('役割の書き間違いは、管理者にも先生にもしない', () => {
    const gas = load('admin-project')
    gas.setup()
    const sheet = spreadsheet.getSheetByName('管理者')!
    sheet.rows.push(['typo@example.ac.jp', '', '管理社'], ['teacher@example.ac.jp', '', ' 先生 '])
    user = 'typo@example.ac.jp'
    expect(gas.getState()).toMatchObject({ role: null })
    user = 'teacher@example.ac.jp'
    expect(gas.getState()).toMatchObject({ role: 'teacher' })
  })

  it('役割の列がない古い管理者シートは、管理者として扱う', () => {
    const gas = load('admin-project')
    gas.setup()
    const sheet = spreadsheet.getSheetByName('管理者')!
    sheet.rows = [['メールアドレス', 'メモ'], ['kato@example.ac.jp', '']]
    expect(gas.getState()).toMatchObject({ isAdmin: true, role: 'admin' })
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
