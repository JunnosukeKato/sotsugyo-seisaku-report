// @vitest-environment node
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { demoReport } from '../model/demoReport'
import { createReport } from '../model/newReport'
import { currentConfig } from '../config'
import type { Report } from '../model/types'
import type { DriveFile } from './driveApi'

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

// 偽物のドライブ：remote にある原稿（1つ）と、写真のファイルを持つ
let remote: { id: string; modifiedTime: string; report: Report; appProperties?: Record<string, string> } | null = null
let photoFiles: DriveFile[] = []
let email = 'test@bunka-wu.ac.jp'
/** ドライブに保存した（作った・上書きした）ファイル */
const saved: { name: string; fileId?: string }[] = []
let clock = 0
/** 次の保存は、ドライブには保存されるが、返事が届かない（電波が切れた） */
let loseNextResponse = false
vi.mock('./driveApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('./driveApi')>()
  return {
    ...original,
    signIn: async () => ({ accessToken: 'fake', expiresAt: Date.now() + 3600_000 }),
    account: async () => ({ email, usage: 0 }),
    ensureFolder: async (_t: unknown, name = 'root') => `folder-${name}`,
    listChildren: async () => photoFiles,
    findFile: async () => (remote ? { id: remote.id, name: '原稿.json', modifiedTime: remote.modifiedTime, appProperties: remote.appProperties } : null),
    readFile: async () => new Blob([JSON.stringify({ kind: 'sotsugyo-seisaku-report-drive', savedAt: remote!.modifiedTime, device: 'iPhone・Safari', report: remote!.report })]),
    saveFile: async (_t: unknown, file: { name: string; fileId?: string; content: Blob; appProperties?: Record<string, string> }) => {
      saved.push({ name: file.name, fileId: file.fileId })
      const modifiedTime = `2026-10-06T10:${String(++clock).padStart(2, '0')}:00.000Z`
      if (file.name !== '原稿.json') {
        const photo = { id: `photo-${clock}`, name: file.name, modifiedTime, appProperties: file.appProperties }
        photoFiles = [...photoFiles, photo]
        return photo
      }
      const id = file.fileId ?? `file-${clock}`
      remote = { id, modifiedTime, report: JSON.parse(await file.content.text()).report, appProperties: file.appProperties }
      if (loseNextResponse) {
        loseNextResponse = false
        throw new original.DriveError('network', '返事が届かなかった')
      }
      return { id, name: file.name, modifiedTime, appProperties: file.appProperties }
    },
    getFileState: async (_t: unknown, id: string) => (id.startsWith('folder-') ? { modifiedTime: 'x' } : id === remote?.id ? { modifiedTime: remote.modifiedTime, appProperties: remote.appProperties } : null),
  }
})

const { DriveSync, hasContent, summarize, sameContent } = await import('./driveSync')
const { putImage } = await import('../model/storage')

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
  photoFiles = []
  saved.length = 0
  loseNextResponse = false
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

  it('この端末への保存だけが失敗していた（端末の原稿が、最後に送った版より古い）ときは、ドライブの原稿を開く', async () => {
    remote = { id: 'r1', modifiedTime: '2026-10-06T09:00:00.000Z', report: written('次郎') }
    const drive = await loggedIn()
    await drive.resolve(written('次郎'))
    const stale = { ...written('花'), updatedAt: '2026-10-06T01:00:00.000Z' }
    expect((await drive.compare(stale)).kind).toBe('remote')
  })

  it('ログインしたときに「この端末の原稿で続ける」を選ぶと、ドライブの原稿のファイルに上書きする（ファイルを2つにしない）', async () => {
    remote = { id: 'r1', modifiedTime: '2026-10-06T09:00:00.000Z', report: written('次郎') }
    const drive = await loggedIn()
    const r = await drive.resolve(written('花子'))
    expect(r.kind).toBe('conflict')
    saved.length = 0
    drive.activate()
    await drive.overwrite(written('花子'), r.kind === 'conflict' ? r.remote : undefined)
    expect(saved.filter((x) => x.name === '原稿.json')).toEqual([{ name: '原稿.json', fileId: 'r1' }])
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

describe('ドライブに送るとき（原稿を消さない・混ぜない）', () => {
  const later = (r: Report, minute: number): Report => ({ ...r, basicInfo: { ...r.basicInfo, subtitleInput: `直した${minute}` }, updatedAt: `2026-10-06T20:${String(minute).padStart(2, '0')}:00.000Z` })

  it('選ぶ窓を出したあとに別の端末がさらに保存していたら、「この端末の原稿で続ける」でも上書きせずに、もう一度選んでもらう', async () => {
    remote = { id: 'r1', modifiedTime: '2026-10-06T09:00:00.000Z', report: written('次郎') }
    const drive = await loggedIn()
    const r = await drive.resolve(written('花子'))
    expect(r.kind).toBe('conflict')
    // 窓を開いたまま、スマホで書き続けた
    remote = { ...remote, modifiedTime: '2026-10-06T09:30:00.000Z', report: written('三郎') }
    saved.length = 0
    drive.activate()
    await drive.overwrite(written('花子'), r.kind === 'conflict' ? r.remote : undefined)
    expect(saved).toEqual([])
    expect(drive.getState().status.kind).toBe('conflict')
    expect(remote.report.basicInfo.name).toBe('三郎')
  })

  it('ドライブに保存できたのに返事が届かなかっただけなら、自分の保存を「別の端末の保存」と間違えない（原稿のファイルも2つにしない）', async () => {
    const drive = await loggedIn()
    const first = written('花子')
    expect(await drive.resolve(first)).toEqual({ kind: 'local', upload: true })
    loseNextResponse = true
    drive.activate(first)
    await drive.flush()
    expect(drive.getState().status.kind).toBe('offline')
    // 電波が戻って、続きを送る
    const next = later(first, 1)
    drive.schedule(next, 0)
    await drive.flush()
    expect(drive.getState().status.kind).toBe('saved')
    expect(saved.filter((x) => x.name === '原稿.json').map((x) => x.fileId)).toEqual([undefined, remote!.id])
    expect(remote!.report.updatedAt).toBe(next.updatedAt)
    // 次にログインしたときも、選ぶ窓は出ない
    expect((await (await loggedIn()).resolve(next)).kind).toBe('local')
  })

  it('ドライブで原稿のファイルをゴミ箱に入れたあと、別の端末が作り直していたら、上書きも3つめのファイルも作らずに選んでもらう', async () => {
    remote = { id: 'r1', modifiedTime: '2026-10-06T09:00:00.000Z', report: written('次郎') }
    const drive = await loggedIn()
    expect(await drive.resolve(written('次郎'))).toEqual({ kind: 'local', upload: false })
    drive.activate()
    // r1 はゴミ箱へ。スマホが新しい原稿のファイルを作った
    remote = { id: 'r2', modifiedTime: '2026-10-06T09:40:00.000Z', report: written('三郎'), appProperties: { writer: 'phone' } }
    saved.length = 0
    drive.schedule(later(written('次郎'), 2), 0)
    await drive.flush()
    expect(saved).toEqual([])
    expect(drive.getState().status.kind).toBe('conflict')
  })

  it('ドライブで写真をゴミ箱に入れていても、この端末から消す前に送り直す', async () => {
    await putImage({ id: 'ph1', blob: new Blob(['x'], { type: 'image/jpeg' }), widthPx: 1, heightPx: 1 })
    const report: Report = { ...written('花子'), workPhotos: { layout: 1, imageIds: ['ph1'] } }
    const drive = await loggedIn()
    await drive.resolve(report)
    drive.activate(report)
    await drive.flush()
    expect(photoFiles.map((f) => f.appProperties?.imageId)).toEqual(['ph1'])
    photoFiles = []
    expect(await drive.finish(report)).toBe(true)
    expect(photoFiles.map((f) => f.appProperties?.imageId)).toEqual(['ph1'])
  })

  it('同じ中身かは、項目の並び順によらずに比べる', () => {
    const a = written('花子')
    // 項目の並び順を逆にし、更新時刻だけ変えた原稿
    const { basicInfo, ...rest } = a
    const b = { ...Object.fromEntries(Object.entries(rest).reverse()), basicInfo: Object.fromEntries(Object.entries(basicInfo).reverse()), updatedAt: 'x' } as Report
    expect(sameContent(a, b)).toBe(true)
    expect(sameContent(a, written('次郎'))).toBe(false)
  })
})

describe('メールアドレスから学籍番号', () => {
  it('@ より前を大文字にする。学籍番号の形でなければ（教職員）null', async () => {
    const { studentIdFromEmail } = await import('../model/account')
    expect(studentIdFromEmail('00zz901@bunka-wu.ac.jp', null)).toBe('00ZZ901')
    expect(studentIdFromEmail('00zz0123@bunka-wu.ac.jp', null)).toBe('00ZZ0123')
    expect(studentIdFromEmail('staff-a@bunka-wu.ac.jp', null)).toBeNull()
    expect(studentIdFromEmail(null, null)).toBeNull()
    // 管理ページで形式を決めていれば、そちらで見る
    expect(studentIdFromEmail('00zz0123@bunka-wu.ac.jp', '^\\d{2}ZZ\\d{3}$')).toBeNull()
    expect(studentIdFromEmail('00zz012@bunka-wu.ac.jp', '^\\d{2}ZZ\\d{3}$')).toBe('00ZZ012')
  })
})

describe('原稿の中身', () => {
  it('どちらで続けるかを選ぶときに、本文の字数・図・作品写真の数を見せる', () => {
    const s = summarize(demoReport())
    expect(s.chars).toBeGreaterThan(0)
    expect(s).toEqual({ chars: s.chars, figures: expect.any(Number), photos: expect.any(Number) })
  })
})
