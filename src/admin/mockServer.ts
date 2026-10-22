import { currentConfig, type YearConfig } from '../config'
import { DEV_TRIAL_SAMPLE } from '../trial/devSample'
import type { AdminServer, AdminState, HistoryRow, Member, YearRow } from './server'
import { applyNotices, applyTemplates, changedMessage, checkConfig, cleanWords } from './serverRules'

/**
 * 開発用の試験サーバー（ブラウザ内だけで動く）。本番の gas/admin-project/Code.js と同じ振る舞いをまねる
 * （保存の前の確かめとエラーの言葉は serverRules.ts で Code.js と同じにしている）。
 * 年度設定はこのブラウザの localStorage に保存する。
 * admin.html?as=teacher で開くと、先生（ひな形・お知らせ・書き間違えやすい語だけ編集できる）として振る舞う。
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

/**
 * 1回のやり取りにかかる時間。admin.html?delay=3000 で開くと 3 秒待つ（本番の Apps Script は、しばらく使っていないと
 * 10秒ほどかかることがあるので、待つ間の表示「保存しています…」「数秒〜十数秒かかることがあります」を確かめるため）
 */
const DELAY = Number(new URLSearchParams(location.search).get('delay')) || 200
const wait = () => new Promise((r) => setTimeout(r, DELAY))
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

export function createMockServer(): AdminServer {
  const members = (store: Store) => store.members ?? DEFAULT_MEMBERS
  const roleOf = (store: Store) => members(store).find((m) => m.email === USER)?.role ?? null
  /** その年度を、これまでに学生に公開したことがあるか（本番の wasPublished_ と同じ：変更履歴に「公開」か「初期設定」がある） */
  const wasPublished = (store: Store, year: number) => store.history.some((h) => h.year === year && (h.action === '公開' || h.action === '初期設定'))
  const state = (store: Store): AdminState => {
    const role = roleOf(store)
    // 削除できる年度（一度も公開していない「準備中」。本番の readYears_ と同じく、deleteYear と同じ決まりで付ける）
    const years = clone(store.years).map((y) => ({ ...y, deletable: y.status === '準備中' && !wasPublished(store, y.year) }))
    return { user: USER, isAdmin: role === '管理者', role: role === '管理者' ? 'admin' : role === '先生' ? 'teacher' : null, years: role ? years.sort((a, b) => b.year - a.year) : [] }
  }
  const requireAdmin = (store: Store) => {
    if (roleOf(store) !== '管理者') throw new Error(`管理者だけが変更できます（ログイン中：${USER}）`)
  }
  const requireTeacher = (store: Store) => {
    if (!roleOf(store)) throw new Error(`登録された先生だけが使えます（ログイン中：${USER}）`)
  }
  const findYear = (store: Store, year: number) => {
    const row = store.years.find((y) => y.year === year)
    if (!row) throw new Error(`${year}年度の設定がありません`)
    return row
  }
  /** 画面を開いたあとに、ほかの人（別のタブの自分）が保存していたら止める（本番の checkNotChanged_ と同じ） */
  const checkNotChanged = (row: YearRow, expectedUpdatedAt?: string) => {
    if (expectedUpdatedAt && row.updatedAt !== expectedUpdatedAt) throw new Error(changedMessage(row.updatedBy, USER))
  }
  /** 有効な管理者が0人になる変更は断る（本番の keepAdmin_ と同じ） */
  const keepAdmin = (list: Member[]) => {
    if (!list.some((m) => m.role === '管理者')) throw new Error('有効な管理者が1人もいなくなるため、変更しませんでした。管理者を1人以上残してください')
  }
  const record = (store: Store, year: number, action: string, config: YearConfig) =>
    store.history.push({ at: new Date().toISOString(), user: USER, year, action, config: clone(config) })
  /**
   * 年度の設定を読み、fn で書き換えて保存し、変更履歴に残す（本番の editYear_ と同じ。先生も使える）。
   * fn の中や書き換えたあとの確かめで誤りが見つかったら、何も保存しない
   */
  const editYear = (year: number, expectedUpdatedAt: string | undefined, fn: (config: YearConfig) => string) => {
    const store = load()
    requireTeacher(store)
    const row = findYear(store, year)
    checkNotChanged(row, expectedUpdatedAt)
    const config = clone(row.config)
    const action = fn(config)
    checkConfig(config)
    Object.assign(row, { config, updatedAt: new Date().toISOString(), updatedBy: USER })
    record(store, year, action, config)
    save(store)
    return state(store)
  }

  return {
    async getState() {
      await wait()
      return state(load())
    },
    async saveYear(config, expectedUpdatedAt) {
      await wait()
      const store = load()
      requireAdmin(store)
      checkConfig(config)
      const row = store.years.find((y) => y.year === config.fiscalYear)
      if (row) checkNotChanged(row, expectedUpdatedAt)
      if (row) Object.assign(row, { config, updatedAt: new Date().toISOString(), updatedBy: USER })
      else store.years.push({ year: config.fiscalYear, status: '準備中', config, updatedAt: new Date().toISOString(), updatedBy: USER })
      record(store, config.fiscalYear, '保存', config)
      save(store)
      return state(store)
    },
    async publishYear(year, expectedUpdatedAt) {
      await wait()
      const store = load()
      requireAdmin(store)
      const target = findYear(store, year)
      checkNotChanged(target, expectedUpdatedAt)
      for (const row of store.years) {
        if (row.year === year) row.status = '公開中'
        else if (row.status === '公開中') row.status = '終了'
      }
      record(store, year, '公開', target.config)
      save(store)
      return state(store)
    },
    async createYear(fromYear, newYear) {
      await wait()
      const store = load()
      requireAdmin(store)
      if (!/^[1-9]\d{3}$/.test(String(newYear).trim())) throw new Error('新しい年度は、西暦4桁の数字で入力してください')
      const year = Number(newYear)
      if (store.years.some((y) => y.year === year)) throw new Error(`${year}年度はすでにあります`)
      const from = findYear(store, fromYear)
      const config: YearConfig = { ...clone(from.config), fiscalYear: year }
      store.years.push({ year, status: '準備中', config, updatedAt: new Date().toISOString(), updatedBy: USER })
      record(store, year, `${Number(fromYear)}年度からコピーして作成`, config)
      save(store)
      return state(store)
    },
    async deleteYear(year, expectedUpdatedAt) {
      await wait()
      const store = load()
      requireAdmin(store)
      const row = findYear(store, year)
      // 本番の deleteYear と同じく、一度も公開したことのない「準備中」の年度だけ消せる
      if (row.status !== '準備中' || wasPublished(store, year)) {
        throw new Error(`${year}年度は、学生に公開したことがあるため削除できません（削除できるのは、一度も公開していない「準備中」の年度だけです）`)
      }
      checkNotChanged(row, expectedUpdatedAt)
      store.years = store.years.filter((y) => y !== row)
      record(store, year, '削除', row.config)
      save(store)
      return state(store)
    },
    async getHistory(year) {
      await wait()
      const store = load()
      requireTeacher(store)
      return store.history
        .filter((h) => h.year === year)
        .reverse()
        .slice(0, 50)
    },
    async saveTeacherEdits(year, edits, expectedUpdatedAt) {
      await wait()
      return editYear(year, expectedUpdatedAt, (config) => {
        if (!edits || typeof edits !== 'object') throw new Error('保存する内容の形が正しくありません')
        const done: string[] = []
        if (edits.templates && typeof edits.templates === 'object' && Object.keys(edits.templates).length) done.push(`下書きのひな形を保存（${applyTemplates(config, edits.templates).join('・')}）`)
        if (edits.notices && typeof edits.notices === 'object' && Object.keys(edits.notices).length) done.push(`お知らせを保存（${applyNotices(config, edits.notices).join('・')}）`)
        if (edits.words !== undefined && edits.words !== null) {
          config.wordChecks = cleanWords(edits.words)
          done.push(`書き間違えやすい語を保存（${config.wordChecks.length}語）`)
        }
        return done.join('・') || '保存（変更なし）'
      })
    },
    async saveNotices(year, notices) {
      await wait()
      return editYear(year, undefined, (config) => {
        if (!notices || typeof notices !== 'object') throw new Error('お知らせの形が正しくありません')
        return `お知らせを保存（${applyNotices(config, notices).join('・')}）`
      })
    },
    async saveWordChecks(year, words) {
      await wait()
      return editYear(year, undefined, (config) => {
        config.wordChecks = cleanWords(words)
        return `書き間違えやすい語を保存（${config.wordChecks.length}語）`
      })
    },
    async saveTemplates(year, templates) {
      await wait()
      return editYear(year, undefined, (config) => {
        if (!templates || typeof templates !== 'object') throw new Error('ひな形の形が正しくありません')
        return `下書きのひな形を保存（${applyTemplates(config, templates).join('・')}）`
      })
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
      if (found && found.email.toLowerCase() === USER && role !== '管理者') throw new Error('自分を管理者から外すことはできません')
      if (found) Object.assign(found, { role, memo: memo || found.memo })
      else list.push({ email: email.trim(), role, memo })
      keepAdmin(list)
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
      const list = members(store).filter((m) => m.email.toLowerCase() !== email.toLowerCase())
      keepAdmin(list)
      store.members = list
      save(store)
      return clone(store.members)
    },
    async getTrialSample() {
      await wait()
      requireTeacher(load())
      // 開発中・自動テスト用にまとめた版（scripts/e2e/serveBuilt.mjs が返す）は、手元にある本番の見本（git に入れないファイル gas/trial-sample.private.json）を使う。なければ開発用の小さな見本
      if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') {
        const local = await fetch('/gas/trial-sample.private.json')
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
        if (local) return local
      }
      return clone(DEV_TRIAL_SAMPLE)
    },
  }
}
