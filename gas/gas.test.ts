// Apps Script のプログラム（gas/*/Code.js）を、Google のサービスをまねた簡易版の上で動かして確かめる。
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { beforeEach, describe, expect, it } from 'vitest'
import initialConfig from '../src/config/2026.json'

type Cell = string | number | Date
class FakeSheet {
  rows: Cell[][] = []
  /** 数式として書かれてしまった値（先頭が = + - @ で、' が付いていないもの） */
  formulas: string[] = []
  constructor(public name: string) {}
  /** スプレッドシートと同じく、先頭の ' は「文字として書く」印として外す */
  private written = (v: Cell): Cell => {
    if (typeof v !== 'string') return v
    if (v.startsWith("'")) return v.slice(1)
    if (/^[=+\-@]/.test(v)) this.formulas.push(v)
    return v
  }
  getLastRow = () => this.rows.length
  appendRow = (row: Cell[]) => void this.rows.push(row.map(this.written))
  deleteRow = (row: number) => void this.rows.splice(row - 1, 1)
  setFrozenRows = () => {}
  getDataRange = () => ({ getValues: () => this.rows.map((r) => [...r]) })
  getRange = (row: number, col: number, numRows = 1, numCols = 1) => ({
    setFontWeight: () => {},
    setValue: (v: Cell) => void (this.rows[row - 1][col - 1] = this.written(v)),
    setValues: (values: Cell[][]) => {
      for (let i = 0; i < numRows; i++) for (let j = 0; j < numCols; j++) this.rows[row - 1 + i][col - 1 + j] = this.written(values[i][j])
    },
    getValue: () => this.rows[row - 1][col - 1],
    getValues: () => Array.from({ length: numRows }, (_, i) => Array.from({ length: numCols }, (_, j) => this.rows[row - 1 + i][col - 1 + j])),
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
/** ログイン中の人（管理ページを開いている人、またはエディタで実行した人） */
let user = 'kato@example.ac.jp'
/** プログラムを動かしている人（デプロイした人。エディタで実行したときは、実行した人） */
let owner = 'kato@example.ac.jp'
/** 配信の窓口がスプレッドシートを開いた回数 */
let opened = 0
/** 鍵を待つあいだに、ほかの人の操作が終わったことにする（同時に操作したときの確かめ） */
let whileWaiting: (() => void) | null = null

function load(project: 'admin-project' | 'api-project') {
  const source = readFileSync(`gas/${project}/Code.js`, 'utf8').replace('/*INITIAL_CONFIG*/ null', JSON.stringify(initialConfig))
  const cache = new Map<string, string>()
  const context = createContext({
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet,
      openById: () => {
        opened++
        return spreadsheet
      },
    },
    Session: { getActiveUser: () => ({ getEmail: () => user }), getEffectiveUser: () => ({ getEmail: () => owner }) },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {
          const other = whileWaiting
          whileWaiting = null
          other?.()
        },
        releaseLock: () => {},
      }),
    },
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
  owner = 'kato@example.ac.jp'
  opened = 0
  whileWaiting = null
})

const sheetRows = (name: string) => spreadsheet.getSheetByName(name)!.rows
/** 変更履歴のシートのうち、登録の変更の行（年度が空）の操作 */
const memberHistory = () =>
  sheetRows('変更履歴')
    .slice(1)
    .filter((r) => r[2] === '')
    .map((r) => `${r[1]}:${r[3]}`)

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

  it('先生の画面の保存は、ひな形・お知らせ・語の一覧をまとめて1回で保存する', () => {
    const gas = load('admin-project')
    gas.setup()
    gas.addMember('sensei@example.ac.jp', '先生')
    user = 'sensei@example.ac.jp'
    const template = [{ type: 'chapter', title: '概要' }]
    const saved = gas.saveTeacherEdits(2026, {
      templates: { 'film-stage-costume': { template, abstractExample: '本制作報告書は、' } },
      notices: { 'film-stage-costume': 'お知らせ' },
      words: [{ wrong: '見頃', right: '身頃', severity: 'error' }],
    })
    const config = saved.years[0].config
    expect(config.courses[0]).toMatchObject({ template, notice: 'お知らせ' })
    expect(config.wordChecks).toEqual([{ wrong: '見頃', right: '身頃', note: '', severity: 'error' }])
    const history = gas.getHistory(2026)
    expect(history[0].action).toBe('下書きのひな形を保存（映画・舞台衣装デザイナー）・お知らせを保存（映画・舞台衣装デザイナー）・書き間違えやすい語を保存（1語）')
    expect(history).toHaveLength(2)
    // 形が正しくないものがあれば、何も保存しない
    expect(() => gas.saveTeacherEdits(2026, { notices: { 'film-stage-costume': '別の' }, templates: { 'film-stage-costume': { template: 'x' } } })).toThrow(/形が正しくありません/)
    expect(gas.getState().years[0].config.courses[0].notice).toBe('お知らせ')
  })

  it('管理者の保存：画面を開いたあとにほかの人が保存していたら、保存せずに知らせる', () => {
    const gas = load('admin-project')
    gas.setup()
    // 管理者が、少し前に画面を開いた（そのときの更新日時）
    const opened = { ...gas.getState().years[0], updatedAt: '2026-10-01T00:00:00.000Z' }
    gas.addMember('sensei@example.ac.jp', '先生')
    user = 'sensei@example.ac.jp'
    gas.saveNotices(2026, { 'film-stage-costume': '先生のお知らせ' })
    user = 'kato@example.ac.jp'
    expect(() => gas.saveYear({ ...opened.config, deadline: '2027-01-21' }, opened.updatedAt)).toThrow(/ほかの人（sensei@example.ac.jp）/)
    expect(gas.getState().years[0].config.courses[0].notice).toBe('先生のお知らせ')
    // 読み込み直した更新日時なら保存できる
    const fresh = gas.getState().years[0]
    expect(gas.saveYear({ ...fresh.config, deadline: '2027-01-21' }, fresh.updatedAt).years[0].config.deadline).toBe('2027-01-21')
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

  it('setup は、デプロイした本人が実行したときだけ通る（管理ページから呼ばれても、ほかの人は管理者にならない）', () => {
    const gas = load('admin-project')
    gas.setup()
    user = 'student@example.ac.jp'
    expect(() => gas.setup()).toThrow(/デプロイした人/)
    expect(gas.getState()).toMatchObject({ role: null, years: [] })
    user = 'kato@example.ac.jp'
    expect(gas.getMembers().map((m: { email: string }) => m.email)).toEqual(['kato@example.ac.jp'])
    // デプロイした本人は、何度実行してもよい
    expect(() => gas.setup()).not.toThrow()
    // ほかの管理者も、管理ページからは呼べない（エディタで実行する）
    gas.addMember('admin2@example.ac.jp', '管理者')
    user = 'admin2@example.ac.jp'
    expect(() => gas.setup()).toThrow(/デプロイした人/)
  })

  it('有効な管理者が0人になっても（役割の書き間違い・シート名の変更）、ほかの人は setup で管理者になれない', () => {
    const gas = load('admin-project')
    gas.setup()
    // 役割を手で書き間違えた
    sheetRows('管理者')[1][2] = '管理社'
    user = 'student@example.ac.jp'
    expect(() => gas.setup()).toThrow(/デプロイした人/)
    expect(gas.getState()).toMatchObject({ role: null })
    // シート名を変えた
    spreadsheet.getSheetByName('管理者')!.name = '管理者（古い）'
    expect(() => gas.setup()).toThrow(/デプロイした人/)
    expect(spreadsheet.getSheetByName('管理者')).toBeNull()
    // デプロイした本人がエディタで実行すると、管理者に戻れる
    user = 'kato@example.ac.jp'
    gas.setup()
    expect(gas.getState()).toMatchObject({ role: 'admin' })
    // エディタで実行した人がデプロイした人と同じなら通る（ログインしていない＝アドレスが空のときは通さない）
    user = ''
    owner = ''
    expect(() => gas.setup()).toThrow(/デプロイした人/)
  })

  it('役割の確かめは鍵の中で行う（2人の管理者が同時にお互いを先生にしても、管理者は0人にならない）', () => {
    const gas = load('admin-project')
    gas.setup()
    gas.addMember('sato@example.ac.jp', '管理者')
    // 加藤さんが佐藤さんを先生にする。鍵を待つあいだに、佐藤さんが加藤さんを先生にし終えた
    whileWaiting = () => {
      user = 'sato@example.ac.jp'
      gas.addMember('kato@example.ac.jp', '先生')
      user = 'kato@example.ac.jp'
    }
    expect(() => gas.addMember('sato@example.ac.jp', '先生')).toThrow(/管理者だけ/)
    user = 'sato@example.ac.jp'
    expect(gas.getState()).toMatchObject({ role: 'admin' })
    // 先生の保存も、鍵の中で役割を確かめる（待つあいだに登録を外された）
    gas.addMember('sensei@example.ac.jp', '先生')
    whileWaiting = () => {
      user = 'sato@example.ac.jp'
      gas.removeMember('sensei@example.ac.jp')
      user = 'sensei@example.ac.jp'
    }
    user = 'sensei@example.ac.jp'
    expect(() => gas.saveTeacherEdits(2026, { notices: { 'film-stage-costume': 'x' } })).toThrow(/登録された先生だけ/)
  })

  it('有効な管理者が0人になる変更は断る', () => {
    const gas = load('admin-project')
    gas.setup()
    const header = ['メールアドレス', 'メモ', '役割']
    expect(() => gas.keepAdmin_([header, ['a@example.ac.jp', '', '先生'], ['b@example.ac.jp', '', '管理社']])).toThrow(/管理者が1人もいなくなる/)
    // 同じアドレスの行がいくつかあれば、最初の行の役割で数える（roleOf_ と同じ）
    expect(() => gas.keepAdmin_([header, ['a@example.ac.jp', '', '先生'], ['A@example.ac.jp', '', '管理者']])).toThrow(/管理者が1人もいなくなる/)
    expect(() => gas.keepAdmin_([header, ['a@example.ac.jp', '', ''], ['b@example.ac.jp', '', '先生']])).not.toThrow()
    // 自分を外す・先生にすることはできない
    expect(() => gas.addMember('kato@example.ac.jp', '先生')).toThrow(/自分を管理者から外す/)
    expect(() => gas.removeMember('KATO@example.ac.jp')).toThrow(/外せません/)
    expect(gas.getState()).toMatchObject({ role: 'admin' })
  })

  it('登録の変更（setup・登録・まとめて登録・役割の変更・外す）を変更履歴に残す', () => {
    const gas = load('admin-project')
    gas.setup()
    gas.addMember('sensei@example.ac.jp', '先生', '衣装の先生')
    gas.addMember('sensei@example.ac.jp', '管理者')
    gas.addMembers([{ email: 'a@example.ac.jp' }, { email: 'b@example.ac.jp' }, { email: 'sensei@example.ac.jp' }], '先生')
    gas.addMembers([{ email: 'a@example.ac.jp' }], '先生')
    gas.removeMember('a@example.ac.jp')
    gas.removeMember('nobody@example.ac.jp')
    expect(memberHistory()).toEqual([
      'kato@example.ac.jp:初期設定（setup）を実行：kato@example.ac.jp を管理者に登録',
      'kato@example.ac.jp:登録：sensei@example.ac.jp（先生）',
      'kato@example.ac.jp:役割を変更：sensei@example.ac.jp（先生→管理者）',
      'kato@example.ac.jp:まとめて登録：a@example.ac.jp、b@example.ac.jp（先生）',
      'kato@example.ac.jp:登録を外す：a@example.ac.jp',
    ])
    // 年度の変更履歴には混ざらない
    expect(gas.getHistory(2026).map((h: { action: string }) => h.action)).toEqual(['初期設定'])
  })

  it('管理者の入力は、数式としてではなく文字としてスプレッドシートに書く', () => {
    const gas = load('admin-project')
    gas.setup()
    gas.addMember('+sensei@example.ac.jp', '先生', '=HYPERLINK("https://example.com","見て")')
    gas.addMembers([{ email: '-a@example.ac.jp', memo: '@名前' }], '先生')
    const all = spreadsheet.sheets.flatMap((s) => s.formulas)
    expect(all).toEqual([])
    // 読み出すと、入力したとおりの文字になる
    expect(gas.getMembers().map((m: { email: string; memo: string }) => `${m.email}:${m.memo}`)).toEqual([
      'kato@example.ac.jp:初期設定で登録',
      '+sensei@example.ac.jp:=HYPERLINK("https://example.com","見て")',
      '-a@example.ac.jp:@名前',
    ])
  })

  it('新年度は、西暦4桁の整数だけ作れる', () => {
    const gas = load('admin-project')
    gas.setup()
    for (const bad of ['=1+1', '20x7', 99999, 2027.5, '', '0999']) expect(() => gas.createYear(2026, bad)).toThrow(/西暦4桁/)
    expect(gas.createYear(2026, '2027').years.map((y: { year: number }) => y.year)).toEqual([2027, 2026])
    user = 'student@example.ac.jp'
    expect(() => gas.createYear(2026, 2028)).toThrow(/管理者だけ/)
  })

  it('年度設定の壊れた行（設定の JSON・更新日時の書き損じ）は飛ばし、ほかの年度は使える', () => {
    const gas = load('admin-project')
    gas.setup()
    gas.createYear(2026, 2027)
    gas.createYear(2026, 2028)
    const years = sheetRows('年度設定')
    years[2][2] = '{壊れた JSON'
    years[3][3] = '日時ではない'
    expect(gas.getState().years.map((y: { year: number }) => y.year)).toEqual([2026])
    // 壊れた年度を書き換えようとすると、分かる言葉で断る
    expect(() => gas.publishYear(2027)).toThrow(/壊れていて読めません/)
    expect(() => gas.saveTeacherEdits(2027, { notices: {} })).toThrow(/壊れていて読めません/)
    expect(sheetRows('年度設定')[1][1]).toBe('公開中')
    // 変更履歴の壊れた行も飛ばす
    sheetRows('変更履歴').push([new Date(), 'x', 2026, '壊れた行', '{'], ['日時ではない', 'x', 2026, '壊れた行', '{}'])
    expect(gas.getHistory(2026).map((h: { action: string }) => h.action)).toEqual(['初期設定'])
  })

  it('先生の保存：崩れたひな形・お知らせ・語の一覧は保存せずにエラーで返す', () => {
    const gas = load('admin-project')
    gas.setup()
    gas.addMember('sensei@example.ac.jp', '先生')
    user = 'sensei@example.ac.jp'
    const id = 'film-stage-costume'
    const save = (edits: object) => () => gas.saveTeacherEdits(2026, edits)
    const template = (blocks: unknown) => ({ templates: { [id]: { template: blocks, abstractExample: '' } } })
    const chapter = { type: 'chapter', title: '概要' }
    expect(save(template([{ type: 'chapter' }]))).toThrow(/1行目の形が正しくありません/)
    expect(save(template([{ type: 'chapter', title: ' ' }]))).toThrow(/1行目の名前が空です/)
    expect(save(template([{ type: 'paragraph', hint: '説明' }, chapter]))).toThrow(/大見出しから始めて/)
    expect(save(template([chapter, { type: 'figure', caption: 3 }]))).toThrow(/2行目の形が正しくありません/)
    expect(save(template([chapter, { type: 'paragraph' }]))).toThrow(/2行目の形が正しくありません/)
    expect(save(template([chapter, { type: 'image', caption: '写真' }]))).toThrow(/2行目の形が正しくありません/)
    expect(save(template([chapter, null]))).toThrow(/2行目の形が正しくありません/)
    expect(save(template([chapter, { type: 'subheading', title: 'あ'.repeat(101) }]))).toThrow(/長すぎます（100字まで）/)
    expect(save(template([chapter, { type: 'paragraph', hint: 'あ'.repeat(301) }]))).toThrow(/長すぎます（300字まで）/)
    expect(save(template(Array.from({ length: 101 }, () => chapter)))).toThrow(/多すぎます/)
    expect(save({ templates: { [id]: { template: [chapter], abstractExample: 1 } } })).toThrow(/抄録の書き出し例の形が正しくありません/)
    expect(save({ templates: { [id]: 'x' } })).toThrow(/形が正しくありません/)
    expect(save({ notices: { [id]: 5 } })).toThrow(/お知らせの形が正しくありません/)
    expect(save({ notices: { [id]: 'あ'.repeat(1001) } })).toThrow(/お知らせが長すぎます/)
    expect(save({ words: 'x' })).toThrow(/書き間違えやすい語の形が正しくありません/)
    expect(save({ words: [{ wrong: 1, right: '身頃' }] })).toThrow(/1行目の形が正しくありません/)
    expect(save({ words: [null] })).toThrow(/1行目の形が正しくありません/)
    expect(save({ words: [{ wrong: 'あ'.repeat(51), right: '身頃' }] })).toThrow(/長すぎます/)
    expect(save({ words: Array.from({ length: 301 }, () => ({ wrong: '見頃', right: '身頃' })) })).toThrow(/多すぎます/)
    // 何も保存されていない
    expect(gas.getState().years[0].config).toEqual(initialConfig)
    expect(gas.getHistory(2026)).toHaveLength(1)
    // 正しい形なら保存でき、決まった項目だけが残る（段落の説明は空でもよい）
    const saved = gas.saveTeacherEdits(2026, template([{ ...chapter, extra: 'x' }, { type: 'paragraph', hint: '' }, { type: 'materialTable', caption: '使用素材表' }]))
    expect(saved.years[0].config.courses[0].template).toEqual([chapter, { type: 'paragraph', hint: '' }, { type: 'materialTable', caption: '使用素材表' }])
  })

  it('管理者の保存も、崩れたひな形は保存しない', () => {
    const gas = load('admin-project')
    gas.setup()
    const course = { ...initialConfig.courses[0], template: [{ type: 'paragraph' }] }
    expect(() => gas.saveYear({ ...initialConfig, courses: [course] })).toThrow(/ひな形の1行目の形が正しくありません/)
    expect(() => gas.saveYear({ ...initialConfig, courses: [{ ...initialConfig.courses[0], advisors: [1] }] })).toThrow(/形が正しくありません/)
    expect(() => gas.saveYear({ ...initialConfig, fiscalYear: 20260 })).toThrow(/年度が正しくありません/)
    // 準備中の年度は、題目が空などの途中の状態でも保存できる（細かい確認は画面で行う）
    gas.createYear(2026, 2027)
    expect(gas.saveYear({ ...initialConfig, fiscalYear: 2027, commonTitle: '' }).years[0].config.commonTitle).toBe('')
  })

  it('先生の保存と公開も、画面を開いたあとにほかの人が保存していたら、保存・公開せずに知らせる', () => {
    const gas = load('admin-project')
    gas.setup()
    gas.addMember('sensei@example.ac.jp', '先生')
    gas.addMember('sensei2@example.ac.jp', '先生')
    gas.createYear(2026, 2027)
    // 2人の先生と管理者が、少し前に画面を開いた（そのときの更新日時。同じミリ秒の保存と区別するため、前の日時にしておく）
    const opened = '2026-10-01T00:00:00.000Z'
    for (const row of sheetRows('年度設定').slice(1)) row[3] = new Date(opened)
    const yearOf = (y: number) => gas.getState().years.find((r: { year: number }) => r.year === y)
    // 先生2が先に保存した
    user = 'sensei2@example.ac.jp'
    gas.saveTeacherEdits(2026, { notices: { 'film-stage-costume': '先生2のお知らせ' } }, opened)
    // 先生1は、古い画面のまま保存しようとする
    user = 'sensei@example.ac.jp'
    expect(() => gas.saveTeacherEdits(2026, { notices: { 'film-stage-costume': '先生1のお知らせ' } }, opened)).toThrow(/ほかの人（sensei2@example.ac.jp）/)
    expect(yearOf(2026).config.courses[0].notice).toBe('先生2のお知らせ')
    // 管理者が2027年度を開いたあとに、先生が2027年度を保存した → 古い画面のままでは公開しない
    gas.saveTeacherEdits(2027, { notices: { 'film-stage-costume': '2027年度のお知らせ' } }, opened)
    user = 'kato@example.ac.jp'
    expect(() => gas.publishYear(2027, opened)).toThrow(/ほかの人（sensei@example.ac.jp）/)
    expect(yearOf(2027).status).toBe('準備中')
    // 読み込み直した更新日時なら公開できる
    expect(gas.publishYear(2027, yearOf(2027).updatedAt).years.map((y: { year: number; status: string }) => `${y.year}:${y.status}`)).toEqual(['2027:公開中', '2026:終了'])
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

  it('年度の指定は西暦4桁の数字だけ。それ以外は、シートを読まずに ok: false を返す', () => {
    load('admin-project').setup()
    const api = load('api-project')
    for (const year of ['abc', '20261', '', '2026 ', '=1+1', 'x'.repeat(300)]) {
      expect(JSON.parse(api.doGet({ parameter: { year } }).text)).toEqual({ ok: false, error: '年度の指定が正しくありません' })
    }
    expect(opened).toBe(0)
    expect(JSON.parse(api.doGet({ parameter: { year: '2026' } }).text)).toMatchObject({ ok: true, year: 2026 })
    expect(opened).toBe(1)
  })

  it('公開中の行が壊れていたら（設定の JSON の書き損じ）、止まらずに ok: false を返す（返事は1分控える）', () => {
    load('admin-project').setup()
    sheetRows('年度設定')[1][2] = '{壊れた JSON'
    const api = load('api-project')
    const body = JSON.parse(api.doGet({ parameter: {} }).text)
    expect(body).toEqual({ ok: false, error: '2026年度の設定が壊れていて読めません。管理者に知らせてください' })
    api.doGet({ parameter: {} })
    expect(opened).toBe(1)
    // 更新日時が読めないだけなら、設定は返す
    sheetRows('年度設定')[1][2] = JSON.stringify(initialConfig)
    sheetRows('年度設定')[1][3] = '日時ではない'
    expect(JSON.parse(load('api-project').doGet({ parameter: {} }).text)).toMatchObject({ ok: true, year: 2026, updatedAt: null })
  })

  it('公開中の年度がなければ ok: false を返す', () => {
    load('admin-project').setup()
    spreadsheet.getSheetByName('年度設定')!.rows[1][1] = '終了'
    const body = JSON.parse(load('api-project').doGet({ parameter: {} }).text)
    expect(body).toEqual({ ok: false, error: '公開中の年度設定がありません' })
  })
})
