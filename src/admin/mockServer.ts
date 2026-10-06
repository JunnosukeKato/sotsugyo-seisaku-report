import { currentConfig, type YearConfig } from '../config'
import type { AdminServer, AdminState, HistoryRow, Member, YearRow } from './server'

/**
 * 開発用の試験サーバー（ブラウザ内だけで動く）。本番の gas/admin-project/Code.js と同じ振る舞いをまねる。
 * 年度設定はこのブラウザの localStorage に保存する。
 * admin.html?as=teacher で開くと、先生（ひな形だけ編集できる）として振る舞う。
 */

const KEY = 'sotsugyo-admin-mock'
const ADMIN = 'admin@example.ac.jp'
const TEACHER = 'sensei@example.ac.jp'
const USER = new URLSearchParams(location.search).get('as') === 'teacher' ? TEACHER : ADMIN

interface Store {
  years: YearRow[]
  history: HistoryRow[]
  members?: Member[]
}

const DEFAULT_MEMBERS: Member[] = [
  { email: ADMIN, memo: '試験用の管理者', role: '管理者' },
  { email: TEACHER, memo: '試験用の先生', role: '先生' },
]

function load(): Store {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Store | null
    if (saved) return saved
  } catch {
    // 壊れていたら作り直す
  }
  // はじめての状態は、すぐ控えておく（読むたびに作り直すと更新日時が変わり、「ほかの人が保存した」と判定されてしまう）
  const initial: Store = { years: [{ year: currentConfig.fiscalYear, status: '公開中', config: currentConfig, updatedAt: new Date().toISOString(), updatedBy: USER }], history: [] }
  save(initial)
  return initial
}

function save(store: Store): void {
  localStorage.setItem(KEY, JSON.stringify(store))
}

const wait = () => new Promise((r) => setTimeout(r, 200))
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

export function createMockServer(): AdminServer {
  const members = (store: Store) => store.members ?? DEFAULT_MEMBERS
  const roleOf = (store: Store) => members(store).find((m) => m.email === USER)?.role ?? null
  const state = (store: Store): AdminState => {
    const role = roleOf(store)
    return { user: USER, isAdmin: role === '管理者', role: role === '管理者' ? 'admin' : role === '先生' ? 'teacher' : null, years: role ? clone(store.years).sort((a, b) => b.year - a.year) : [] }
  }
  const requireAdmin = (store: Store) => {
    if (roleOf(store) !== '管理者') throw new Error(`管理者だけが変更できます（ログイン中：${USER}）`)
  }
  const record = (store: Store, year: number, action: string, config: YearConfig) =>
    store.history.push({ at: new Date().toISOString(), user: USER, year, action, config: clone(config) })

  return {
    async getState() {
      await wait()
      return state(load())
    },
    async saveYear(config, expectedUpdatedAt) {
      await wait()
      const store = load()
      requireAdmin(store)
      const row = store.years.find((y) => y.year === config.fiscalYear)
      if (row && expectedUpdatedAt && row.updatedAt !== expectedUpdatedAt) {
        throw new Error(`この画面を開いたあとに、ほかの人（${row.updatedBy}）がこの年度の設定を保存しました。そのまま保存すると、その変更が消えてしまうため、保存しませんでした。ページを読み込み直してから、もう一度変更してください`)
      }
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
    async saveTeacherEdits(year, edits) {
      await wait()
      const store = load()
      if (!roleOf(store)) throw new Error('登録された先生だけが使えます')
      const row = store.years.find((y) => y.year === year)!
      const done: string[] = []
      const templates = edits.templates ?? {}
      const notices = edits.notices ?? {}
      const tNames: string[] = []
      const nNames: string[] = []
      for (const course of row.config.courses) {
        const t = templates[course.id]
        if (t) {
          Object.assign(course, { template: t.template, abstractExample: t.abstractExample })
          tNames.push(course.name)
        }
        if (course.id in notices) {
          course.notice = notices[course.id]
          nNames.push(course.name)
        }
      }
      if (tNames.length) done.push(`下書きのひな形を保存（${tNames.join('・')}）`)
      if (nNames.length) done.push(`お知らせを保存（${nNames.join('・')}）`)
      if (edits.words) {
        row.config.wordChecks = edits.words
        done.push(`書き間違えやすい語を保存（${edits.words.length}語）`)
      }
      Object.assign(row, { updatedAt: new Date().toISOString(), updatedBy: USER })
      record(store, year, done.join('・') || '保存（変更なし）', row.config)
      save(store)
      return state(store)
    },
    async saveNotices(year, notices) {
      await wait()
      const store = load()
      if (!roleOf(store)) throw new Error('登録された先生だけが使えます')
      const row = store.years.find((y) => y.year === year)!
      const names: string[] = []
      for (const course of row.config.courses) {
        if (!(course.id in notices)) continue
        course.notice = notices[course.id]
        names.push(course.name)
      }
      Object.assign(row, { updatedAt: new Date().toISOString(), updatedBy: USER })
      record(store, year, `お知らせを保存（${names.join('・')}）`, row.config)
      save(store)
      return state(store)
    },
    async saveWordChecks(year, words) {
      await wait()
      const store = load()
      if (!roleOf(store)) throw new Error('登録された先生だけが使えます')
      const row = store.years.find((y) => y.year === year)!
      row.config.wordChecks = words
      Object.assign(row, { updatedAt: new Date().toISOString(), updatedBy: USER })
      record(store, year, `書き間違えやすい語を保存（${words.length}語）`, row.config)
      save(store)
      return state(store)
    },
    async saveTemplates(year, templates) {
      await wait()
      const store = load()
      if (!roleOf(store)) throw new Error('登録された先生だけが使えます')
      const row = store.years.find((y) => y.year === year)!
      const names: string[] = []
      for (const course of row.config.courses) {
        const t = templates[course.id]
        if (!t) continue
        course.template = t.template
        course.abstractExample = t.abstractExample
        names.push(course.name)
      }
      Object.assign(row, { updatedAt: new Date().toISOString(), updatedBy: USER })
      record(store, year, `下書きのひな形を保存（${names.join('・')}）`, row.config)
      save(store)
      return state(store)
    },
    async getMembers() {
      await wait()
      const store = load()
      requireAdmin(store)
      return clone(members(store))
    },
    async addMember(email, role, memo) {
      await wait()
      const store = load()
      requireAdmin(store)
      const list = clone(members(store))
      const found = list.find((m) => m.email.toLowerCase() === email.trim().toLowerCase())
      if (found) Object.assign(found, { role, memo: memo || found.memo })
      else list.push({ email: email.trim(), role, memo })
      store.members = list
      save(store)
      return clone(list)
    },
    async addMembers(entries, role) {
      await wait()
      const store = load()
      requireAdmin(store)
      const list = clone(members(store))
      for (const { email, memo } of entries) {
        if (!list.some((m) => m.email.toLowerCase() === email.trim().toLowerCase())) list.push({ email: email.trim(), role, memo })
      }
      store.members = list
      save(store)
      return clone(list)
    },
    async removeMember(email) {
      await wait()
      const store = load()
      requireAdmin(store)
      if (email.toLowerCase() === USER) throw new Error('自分の登録は外せません')
      store.members = members(store).filter((m) => m.email.toLowerCase() !== email.toLowerCase())
      save(store)
      return clone(store.members)
    },
  }
}
