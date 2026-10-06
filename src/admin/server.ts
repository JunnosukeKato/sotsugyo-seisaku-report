import type { TemplateBlock, WordCheck, YearConfig } from '../config'
import { createMockServer } from './mockServer'

/**
 * 管理ページとサーバー（Google Apps Script）のやり取り。
 * 本番では google.script.run で gas/admin-project/Code.js の関数を呼ぶ。
 * 開発サーバー（npm run dev の admin.html）では、ブラウザ内だけで動く試験用のサーバーを使う。
 */

export type YearStatus = '公開中' | '準備中' | '終了'

export interface YearRow {
  year: number
  status: YearStatus
  config: YearConfig
  updatedAt: string
  updatedBy: string
}

export interface HistoryRow {
  at: string
  user: string
  year: number
  action: string
  config: YearConfig
}

/** 管理者：年度の設定をすべて変更・公開できる。先生：どのコースの下書きのひな形も編集できる */
export type Role = 'admin' | 'teacher' | null

export interface AdminState {
  user: string
  isAdmin: boolean
  role?: Role
  years: YearRow[]
}

export interface Member {
  email: string
  memo: string
  role: '管理者' | '先生'
}

/** コースごとの下書きのひな形（コースID → ひな形と抄録の書き出し例） */
export type TemplateSet = Record<string, { template: TemplateBlock[]; abstractExample: string }>

/** 役割（古いサーバーは role を返さないため、isAdmin から決める） */
export function roleOf(state: AdminState): Role {
  return state.role !== undefined ? state.role : state.isAdmin ? 'admin' : null
}

export interface AdminServer {
  getState(): Promise<AdminState>
  /** expectedUpdatedAt：画面を開いたときの更新日時（そのあとにほかの人が保存していたら、保存せずに知らせる） */
  saveYear(config: YearConfig, expectedUpdatedAt?: string): Promise<AdminState>
  publishYear(year: number): Promise<AdminState>
  createYear(fromYear: number, newYear: number): Promise<AdminState>
  getHistory(year: number): Promise<HistoryRow[]>
  saveTemplates(year: number, templates: TemplateSet): Promise<AdminState>
  /** コースのお知らせを保存する（管理者・先生）。notices はコースの ID → お知らせ */
  saveNotices(year: number, notices: Record<string, string>): Promise<AdminState>
  /** 書き間違えやすい語の一覧を保存する（管理者・先生） */
  saveWordChecks(year: number, words: WordCheck[]): Promise<AdminState>
  /** 先生の画面の保存：ひな形・お知らせ・書き間違えやすい語を、まとめて1回で */
  saveTeacherEdits(year: number, edits: { templates?: TemplateSet; notices?: Record<string, string>; words?: WordCheck[] }): Promise<AdminState>
  getMembers(): Promise<Member[]>
  addMember(email: string, role: Member['role'], memo: string): Promise<Member[]>
  /** まとめて登録する（すでに登録されている人は、そのまま） */
  addMembers(entries: { email: string; memo: string }[], role: Member['role']): Promise<Member[]>
  removeMember(email: string): Promise<Member[]>
}

interface ScriptRun {
  withSuccessHandler(fn: (value: unknown) => void): ScriptRun
  withFailureHandler(fn: (error: Error) => void): ScriptRun
  [name: string]: unknown
}

declare global {
  interface Window {
    google?: { script: { run: ScriptRun } }
  }
}

function call<T>(name: string, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = window.google!.script.run.withSuccessHandler((v) => resolve(v as T)).withFailureHandler(reject)
    ;(run[name] as (...a: unknown[]) => void)(...args)
  })
}

function appsScriptServer(): AdminServer {
  return {
    getState: () => call('getState'),
    saveYear: (config, expectedUpdatedAt) => call('saveYear', config, expectedUpdatedAt ?? null),
    publishYear: (year) => call('publishYear', year),
    createYear: (fromYear, newYear) => call('createYear', fromYear, newYear),
    getHistory: (year) => call('getHistory', year),
    saveTemplates: (year, templates) => call('saveTemplates', year, templates),
    saveWordChecks: (year, words) => call('saveWordChecks', year, words),
    saveNotices: (year, notices) => call('saveNotices', year, notices),
    saveTeacherEdits: (year, edits) => call('saveTeacherEdits', year, edits),
    getMembers: () => call('getMembers'),
    addMember: (email, role, memo) => call('addMember', email, role, memo),
    addMembers: (entries, role) => call('addMembers', entries, role),
    removeMember: (email) => call('removeMember', email),
  }
}

export const server: AdminServer = window.google?.script ? appsScriptServer() : createMockServer()
export const isMockServer = !window.google?.script
