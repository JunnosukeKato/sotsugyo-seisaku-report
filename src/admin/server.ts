import type { YearConfig } from '../config'
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

export interface AdminState {
  user: string
  isAdmin: boolean
  years: YearRow[]
}

export interface AdminServer {
  getState(): Promise<AdminState>
  saveYear(config: YearConfig): Promise<AdminState>
  publishYear(year: number): Promise<AdminState>
  createYear(fromYear: number, newYear: number): Promise<AdminState>
  getHistory(year: number): Promise<HistoryRow[]>
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
    saveYear: (config) => call('saveYear', config),
    publishYear: (year) => call('publishYear', year),
    createYear: (fromYear, newYear) => call('createYear', fromYear, newYear),
    getHistory: (year) => call('getHistory', year),
  }
}

export const server: AdminServer = window.google?.script ? appsScriptServer() : createMockServer()
export const isMockServer = !window.google?.script
