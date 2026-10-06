// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { demoReport } from '../model/demoReport'
import { createReport } from '../model/newReport'
import { currentConfig } from '../config'
import type { Report } from '../model/types'

/**
 * ログインしたあと、どの原稿で始めるかの決め方（ドライブの API は偽物に差し替える）。
 * 画面のない環境なので、ブラウザの保存場所（localStorage など）も簡単な偽物を置く。
 */

const memory = () => {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), clear: () => data.clear() }
}
vi.stubGlobal('window', { addEventListener: () => {}, setTimeout, clearTimeout })
vi.stubGlobal('localStorage', memory())
vi.stubGlobal('sessionStorage', memory())
vi.stubGlobal('navigator', { onLine: true, userAgent: 'test', maxTouchPoints: 0 })

// 偽物のドライブ：remote にある原稿を返す
let remote: { id: string; modifiedTime: string; report: Report } | null = null
let email = 'test@bunka-wu.ac.jp'
vi.mock('./driveApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('./driveApi')>()
  return {
    ...original,
    signIn: async () => ({ accessToken: 'fake', expiresAt: Date.now() + 3600_000 }),
    account: async () => ({ email, usage: 0 }),
    ensureFolder: async (_t: unknown, name = 'root') => `folder-${name}`,
    listChildren: async () => [],
    findFile: async () => (remote ? { id: remote.id, name: '原稿.json', modifiedTime: remote.modifiedTime } : null),
    readFile: async () => new Blob([JSON.stringify({ kind: 'sotsugyo-seisaku-report-drive', savedAt: remote!.modifiedTime, device: 'iPhone・Safari', report: remote!.report })]),
    saveFile: async (_t: unknown, file: { name: string }) => ({ id: remote?.id ?? 'new-file', name: file.name, modifiedTime: '2026-10-06T10:00:00.000Z' }),
    getModified: async () => remote?.modifiedTime ?? null,
  }
})

const { DriveSync, hasContent, summarize } = await import('./driveSync')

const written = (name: string): Report => ({ ...demoReport(), basicInfo: { ...demoReport().basicInfo, name }, updatedAt: `2026-10-06T0${name.length}:00:00.000Z` })

async function loggedIn() {
  const drive = new DriveSync('client')
  await drive.login()
  return drive
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  remote = null
  email = 'test@bunka-wu.ac.jp'
})

describe('ログインしたあと、どの原稿で始めるか', () => {
  it('どこにも原稿がなければ新しく始め、この端末にだけあればドライブに送る', async () => {
    expect(await (await loggedIn()).resolve(null)).toEqual({ kind: 'new' })
    expect(await (await loggedIn()).resolve(written('花子'))).toEqual({ kind: 'local', upload: true })
  })

  it('この端末に原稿がなければ（別の端末で書いた）、ドライブの原稿を開く', async () => {
    remote = { id: 'r1', modifiedTime: '2026-10-06T09:00:00.000Z', report: written('次郎') }
    const r = await (await loggedIn()).resolve(null)
    expect(r.kind === 'remote' && r.remote.report.basicInfo.name).toBe('次郎')
  })

  it('この端末が新しく作っただけの原稿なら、ドライブの原稿で置き換える', async () => {
    remote = { id: 'r1', modifiedTime: '2026-10-06T09:00:00.000Z', report: written('次郎') }
    const fresh = createReport(currentConfig)
    expect(hasContent(fresh)).toBe(false)
    expect((await (await loggedIn()).resolve(fresh)).kind).toBe('remote')
  })

  it('前に同期したあと、ドライブだけが変わっていればドライブの原稿、この端末だけなら送る、両方なら選んでもらう', async () => {
    remote = { id: 'r1', modifiedTime: '2026-10-06T09:00:00.000Z', report: written('次郎') }
    const drive = await loggedIn()
    const local = written('次郎')
    // 1回目：中身が同じなので、そのままつながる（同期済みになる）
    expect(await drive.resolve(local)).toEqual({ kind: 'local', upload: false })
    // この端末だけが変わった
    const edited = { ...local, basicInfo: { ...local.basicInfo, name: '次郎（直した）' }, updatedAt: '2026-10-06T11:00:00.000Z' }
    expect(await drive.compare(edited)).toEqual({ kind: 'local', upload: true })
    // ドライブだけが変わった（別の端末で保存）
    remote = { ...remote, modifiedTime: '2026-10-06T12:00:00.000Z', report: written('三郎') }
    expect((await drive.compare(local)).kind).toBe('remote')
    // 両方が変わった
    expect((await drive.compare(edited)).kind).toBe('conflict')
  })

  it('この端末に別のアカウントの原稿があれば知らせる（ドライブに送っていない変更があるかも）', async () => {
    const first = await loggedIn()
    await first.resolve(written('花子'))
    email = 'other@bunka-wu.ac.jp'
    const second = new DriveSync('client')
    await second.login()
    expect(await second.resolve(written('花子'))).toEqual({ kind: 'otherAccount', previousEmail: 'test@bunka-wu.ac.jp', unsynced: true })
  })
})

describe('メールアドレスから学籍番号', () => {
  it('@ より前を大文字にする。学籍番号の形でなければ（教職員）null', async () => {
    const { studentIdFromEmail } = await import('./driveSync')
    expect(studentIdFromEmail('22fac123@bunka-wu.ac.jp', null)).toBe('22FAC123')
    expect(studentIdFromEmail('23fa0123@bunka-wu.ac.jp', null)).toBe('23FA0123')
    expect(studentIdFromEmail('jun-kato@bunka-wu.ac.jp', null)).toBeNull()
    expect(studentIdFromEmail(null, null)).toBeNull()
    // 管理ページで形式を決めていれば、そちらで見る
    expect(studentIdFromEmail('23fa0123@bunka-wu.ac.jp', '^\\d{2}FA\\d{3}$')).toBeNull()
    expect(studentIdFromEmail('23fa012@bunka-wu.ac.jp', '^\\d{2}FA\\d{3}$')).toBe('23FA012')
  })
})

describe('原稿の中身', () => {
  it('どちらで続けるかを選ぶときに、本文の字数・図・作品写真の数を見せる', () => {
    const s = summarize(demoReport())
    expect(s.chars).toBeGreaterThan(0)
    expect(s).toEqual({ chars: s.chars, figures: expect.any(Number), photos: expect.any(Number) })
  })
})
