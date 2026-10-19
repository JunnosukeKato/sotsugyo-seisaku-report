// @vitest-environment node
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { demoReport } from '../model/demoReport'
import { createReport } from '../model/newReport'
import { currentConfig } from '../config'
import type { Report } from '../model/types'
import type { DriveFile, SignInOptions, Token } from './driveApi'

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
/** 「卒業制作報告書」フォルダ（folder-root）に置いた PDF（書き出した PDF。savePdf） */
let pdfFiles: (DriveFile & { content: string })[] = []
/** ゴミ箱に入れたフォルダ */
const trashedFolders = new Set<string>()
/** 次に PDF を置くときのエラー（null なら置ける） */
let pdfError: (() => Error) | null = null
let email = 'test@bunka-wu.ac.jp'
/** ドライブに保存した（作った・上書きした）ファイル */
const saved: { name: string; fileId?: string }[] = []
let clock = 0
/** 次の保存は、ドライブには保存されるが、返事が届かない（電波が切れた） */
let loseNextResponse = false
/** ログイン（Google の窓）を開いた回数と、そのときの指定 */
const signIns: SignInOptions[] = []
/** 次のログインの結果（null なら、すぐ1時間の許可が出る） */
let nextSignIn: (() => Promise<Token>) | null = null
/** 出した許可の番号（fake-1, fake-2, …） */
let tokenSeq = 0
vi.mock('./driveApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('./driveApi')>()
  return {
    ...original,
    signIn: (_clientId: string, options: SignInOptions = {}) => {
      signIns.push(options)
      const result = nextSignIn
      nextSignIn = null
      return result ? result() : Promise.resolve({ accessToken: `fake-${++tokenSeq}`, expiresAt: Date.now() + 3600_000 })
    },
    signInReady: () => true,
    account: async () => ({ email, usage: 0 }),
    ensureFolder: async (_t: unknown, name = 'root') => `folder-${name}`,
    listChildren: async (_t: unknown, folderId: string) => (folderId === 'folder-root' ? pdfFiles : photoFiles),
    findFile: async () => (remote ? { id: remote.id, name: '原稿.json', modifiedTime: remote.modifiedTime, appProperties: remote.appProperties } : null),
    readFile: async () => new Blob([JSON.stringify({ kind: 'sotsugyo-seisaku-report-drive', savedAt: remote!.modifiedTime, device: 'iPhone・Safari', report: remote!.report })]),
    saveFile: async (_t: unknown, file: { name: string; fileId?: string; folderId: string; content: Blob; appProperties?: Record<string, string>; rename?: boolean }) => {
      saved.push({ name: file.name, fileId: file.fileId })
      const modifiedTime = `2026-10-06T10:${String(++clock).padStart(2, '0')}:00.000Z`
      if (file.name.endsWith('.pdf')) {
        // 本物のドライブと同じく、送っている間は少し待つ（続けて置いたときに、ファイルが2つにならないかを見る）
        await new Promise((resolve) => setTimeout(resolve, 5))
        const error = pdfError
        pdfError = null
        if (error) throw error()
        const before = pdfFiles.find((f) => f.id === file.fileId)
        const pdf = { id: before?.id ?? `pdf-${clock}`, name: before && !file.rename ? before.name : file.name, modifiedTime, appProperties: { ...before?.appProperties, ...file.appProperties }, content: `${file.content.type}|${await file.content.text()}` }
        pdfFiles = [pdf, ...pdfFiles.filter((f) => f.id !== pdf.id)]
        return pdf
      }
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
    getFileState: async (_t: unknown, id: string) => (trashedFolders.has(id) ? null : id.startsWith('folder-') ? { modifiedTime: 'x' } : id === remote?.id ? { modifiedTime: remote.modifiedTime, appProperties: remote.appProperties } : null),
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
  pdfFiles = []
  trashedFolders.clear()
  pdfError = null
  saved.length = 0
  loseNextResponse = false
  email = 'test@bunka-wu.ac.jp'
  signIns.length = 0
  nextSignIn = null
  tokenSeq = 0
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
    const report: Report = { ...written('花子'), workPhotos: [{ layout: 1, imageIds: ['ph1'] }] }
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

describe('パソコンで、許可が切れる少し前にクリックしたら、許可を延ばす', () => {
  const MIN = 60_000
  const nav = navigator as { userAgent: string; onLine: boolean }
  /** ログインして書き始めたところ（許可は1時間） */
  async function writing() {
    const drive = await loggedIn()
    await drive.resolve(written('花子'))
    drive.activate()
    signIns.length = 0
    return drive
  }
  const sessionToken = () => JSON.parse(sessionStorage.getItem('sotsugyo-seisaku-report-drive-token') ?? 'null')

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T10:00:00'))
  })
  afterEach(() => {
    vi.useRealTimers()
    nav.userAgent = 'test'
    nav.onLine = true
  })

  it('残りが10分を切ったらクリックで延ばす（同じアカウントで、窓が一瞬出て閉じるだけの指定）。送っていない変更もすぐ送る', async () => {
    const drive = await writing()
    vi.setSystemTime(Date.now() + 52 * MIN)
    // 送るのを待っている変更（ふだんは書くのをやめて数秒後に送る）
    drive.schedule(written('花子さん'), 60 * MIN)
    saved.length = 0
    const renewing = drive.renewOnClick()
    expect(renewing).not.toBeNull()
    expect(signIns).toEqual([{ prompt: '', hint: 'test@bunka-wu.ac.jp' }])
    expect(await renewing).toBe(true)
    await vi.waitFor(() => expect(saved.map((x) => x.name)).toContain('原稿.json'))
    // 前の許可が切れる時刻を過ぎても、使える（タブに覚えておく許可も新しくなる）
    vi.setSystemTime(Date.now() + 20 * MIN)
    expect(drive.tokenValid).toBe(true)
    expect(sessionToken()).toMatchObject({ accessToken: 'fake-2', email: 'test@bunka-wu.ac.jp' })
    expect(drive.getState().status.kind).toBe('saved')
  })

  it('残りが十分あるときは延ばさない', async () => {
    const drive = await writing()
    vi.setSystemTime(Date.now() + 30 * MIN)
    expect(drive.renewOnClick()).toBeNull()
    expect(signIns).toEqual([])
  })

  it('延ばそうとするのは2分に1回まで', async () => {
    const drive = await writing()
    vi.setSystemTime(Date.now() + 51 * MIN)
    nextSignIn = () => Promise.reject(new Error('popup_closed'))
    expect(await drive.renewOnClick()).toBe(false)
    vi.setSystemTime(Date.now() + 1 * MIN)
    expect(drive.renewOnClick()).toBeNull()
    vi.setSystemTime(Date.now() + 1 * MIN + 1000)
    expect(await drive.renewOnClick()).toBe(true)
    expect(signIns).toHaveLength(2)
  })

  it('うまくいかなかったら（窓が止められた・閉じた）何も出さず、切れたら今まで通り「もう一度ログイン」になる', async () => {
    const drive = await writing()
    vi.setSystemTime(Date.now() + 55 * MIN)
    nextSignIn = () => Promise.reject(new Error('popup_failed_to_open'))
    expect(await drive.renewOnClick()).toBe(false)
    expect(drive.getState().status.kind).not.toBe('error')
    expect(sessionToken()).toMatchObject({ accessToken: 'fake-1' })
    // 1時間たって許可が切れたあとに書くと、もう一度ログインしてもらう
    vi.setSystemTime(Date.now() + 10 * MIN)
    drive.schedule(written('花子さん'), 0)
    await drive.flush()
    expect(drive.getState().status.kind).toBe('expired')
    // 切れたあとは、クリックでは延ばさない（「もう一度ログイン」の窓から）
    expect(drive.renewOnClick()).toBeNull()
  })

  it('別のアカウントの許可が返ってきたら使わない（知らないうちにアカウントを切り替えない）', async () => {
    const drive = await writing()
    vi.setSystemTime(Date.now() + 55 * MIN)
    email = 'other@bunka-wu.ac.jp'
    expect(await drive.renewOnClick()).toBe(false)
    expect(drive.getState().email).toBe('test@bunka-wu.ac.jp')
    expect(sessionToken()).toMatchObject({ accessToken: 'fake-1', email: 'test@bunka-wu.ac.jp' })
  })

  it('スマホ・タブレット（iPhone・iPad・Android）と、電波がないときは延ばさない', async () => {
    const drive = await writing()
    vi.setSystemTime(Date.now() + 55 * MIN)
    for (const ua of ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)']) {
      nav.userAgent = ua
      expect(drive.renewOnClick()).toBeNull()
    }
    nav.userAgent = 'test'
    nav.onLine = false
    expect(drive.renewOnClick()).toBeNull()
    expect(signIns).toEqual([])
  })
})

describe('PDF の控えを先生のフォルダに送るときの許可（app/usePdfCopy.ts）', () => {
  const MIN = 60_000
  const nav = navigator as { userAgent: string; onLine: boolean }
  async function writing() {
    const drive = await loggedIn()
    await drive.resolve(written('花子'))
    drive.activate()
    signIns.length = 0
    return drive
  }
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-08T10:00:00'))
  })
  afterEach(() => {
    vi.useRealTimers()
    nav.userAgent = 'test'
  })

  it('許可が十分あれば、延ばさずにその許可で送る', async () => {
    const drive = await writing()
    vi.setSystemTime(Date.now() + 30 * MIN)
    drive.renewForExport()
    expect(signIns).toEqual([])
    expect((await drive.copyToken())?.accessToken).toBe('fake-1')
  })

  it('パソコン：「PDF を保存する」を押したときに、許可が切れていても（残りが10分を切っていても）延ばし、延ばした許可で送る', async () => {
    const drive = await writing()
    vi.setSystemTime(Date.now() + 70 * MIN)
    expect(drive.tokenValid).toBe(false)
    drive.renewForExport()
    expect(signIns).toEqual([{ prompt: '', hint: 'test@bunka-wu.ac.jp' }])
    expect((await drive.copyToken())?.accessToken).toBe('fake-2')
    // 同じクリックで、紙面のクリックの延長（renewOnClick）と重ねて窓を開かない
    drive.renewForExport()
    expect(signIns).toHaveLength(1)
  })

  it('スマホでは延ばさない。許可が切れていれば送らずに待ち、PDF の窓を閉じたら「もう一度ログイン」を出す', async () => {
    const drive = await writing()
    nav.userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'
    vi.setSystemTime(Date.now() + 70 * MIN)
    drive.renewForExport()
    expect(signIns).toEqual([])
    expect(await drive.copyToken()).toBeNull()
    const states: string[] = []
    drive.subscribe(() => states.push(drive.getState().status.kind))
    drive.noticeExpired()
    expect(drive.getState().status.kind).toBe('expired')
    // ログインし直すと、許可が使えるようになったことを知らせる（待っていた控えを送る）
    await drive.login()
    expect(drive.tokenValid).toBe(true)
    expect(states.at(-1)).not.toBe('expired')
    expect((await drive.copyToken())?.accessToken).toBe('fake-2')
  })

  it('許可が使えるときは、「もう一度ログイン」を出さない', async () => {
    const drive = await writing()
    drive.noticeExpired()
    expect(drive.getState().status.kind).not.toBe('expired')
  })
})

describe('書き出した PDF を、自分のドライブの「卒業制作報告書」フォルダにも置く（app/useDrivePdf.ts）', () => {
  const MIN = 60_000
  const nav = navigator as { onLine: boolean }
  async function writing() {
    const drive = await loggedIn()
    await drive.resolve(written('花子'))
    drive.activate()
    signIns.length = 0
    return drive
  }
  const pdf = (text: string) => new Blob([`%PDF-${text}`], { type: 'application/pdf' })
  afterEach(() => {
    vi.useRealTimers()
    nav.onLine = true
  })

  it('提出用の名前で1つ置き（印 kind: pdf）、2回目からは同じファイルの中身を新しくして、名前も今の名前にする（ファイルは1つ）', async () => {
    const drive = await writing()
    expect(drive.canSavePdf).toBe(true)
    expect(await drive.savePdf(pdf('1'), '00ZZ0123_文化花子.pdf')).toBe(true)
    expect(pdfFiles.map((f) => `${f.name}|${f.appProperties?.kind}|${f.content}`)).toEqual(['00ZZ0123_文化花子.pdf|pdf|application/pdf|%PDF-1'])
    const first = pdfFiles[0].id
    // 氏名を直して、もう一度書き出した
    expect(await drive.savePdf(pdf('2'), '00ZZ0123_文化花子子.pdf')).toBe(true)
    expect(pdfFiles.map((f) => `${f.id}|${f.name}|${f.content}`)).toEqual([`${first}|00ZZ0123_文化花子子.pdf|application/pdf|%PDF-2`])
    // 原稿のファイルには触らない
    expect(saved.filter((x) => x.name === '原稿.json')).toEqual([])
  })

  it('続けて書き出しても、前のを置き終えてから置く（PDF のファイルは1つ）', async () => {
    const drive = await writing()
    expect(await Promise.all([drive.savePdf(pdf('1'), 'a.pdf'), drive.savePdf(pdf('2'), 'b.pdf')])).toEqual([true, true])
    expect(pdfFiles.map((f) => `${f.name}|${f.content}`)).toEqual(['b.pdf|application/pdf|%PDF-2'])
  })

  it('始める前・電波がない・フォルダがゴミ箱に入っている・許可が切れているときは置かない（ログインの窓も「もう一度ログイン」も出さない）', async () => {
    const before = await loggedIn()
    expect(before.canSavePdf).toBe(false)
    expect(await before.savePdf(pdf('0'), 'a.pdf')).toBe(false)
    const drive = await writing()
    nav.onLine = false
    expect(drive.canSavePdf).toBe(false)
    expect(await drive.savePdf(pdf('1'), 'a.pdf')).toBe(false)
    nav.onLine = true
    trashedFolders.add('folder-root')
    expect(await drive.savePdf(pdf('2'), 'a.pdf')).toBe(false)
    trashedFolders.clear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 70 * MIN)
    expect(drive.canSavePdf).toBe(false)
    expect(await drive.savePdf(pdf('3'), 'a.pdf')).toBe(false)
    expect(pdfFiles).toEqual([])
    expect(signIns).toEqual([])
    expect(drive.getState().status.kind).not.toBe('expired')
  })

  it('ドライブのエラーは投げる（そのあとも、次に書き出したときは置ける）', async () => {
    const { DriveError } = await import('./driveApi')
    const drive = await writing()
    pdfError = () => new DriveError('server', 'Google 側で一時的な問題が起きています')
    await expect(drive.savePdf(pdf('1'), 'a.pdf')).rejects.toMatchObject({ code: 'server' })
    expect(await drive.savePdf(pdf('2'), 'a.pdf')).toBe(true)
    expect(pdfFiles).toHaveLength(1)
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
  it('学生のアドレスは「wu」＋学籍番号（提出ガイド：wu学籍番号@bunka-wu.ac.jp）。先頭の wu は除く', async () => {
    const { studentIdFromEmail } = await import('../model/account')
    expect(studentIdFromEmail('wu23aaa999@bunka-wu.ac.jp', null)).toBe('23AAA999')
    expect(studentIdFromEmail('WU00zz0123@bunka-wu.ac.jp', null)).toBe('00ZZ0123')
    expect(studentIdFromEmail('wu00zz012@bunka-wu.ac.jp', '^\\d{2}ZZ\\d{3}$')).toBe('00ZZ012')
    // 教務などの共用アドレス（wu- で始まる）は教職員のまま
    expect(studentIdFromEmail('wu-kyoumu@bunka-wu.ac.jp', null)).toBeNull()
    expect(studentIdFromEmail('wu@bunka-wu.ac.jp', null)).toBeNull()
  })
})

describe('原稿の中身', () => {
  it('どちらで続けるかを選ぶときに、本文の字数・図・作品写真の数を見せる', () => {
    const s = summarize(demoReport())
    expect(s.chars).toBeGreaterThan(0)
    expect(s).toEqual({ chars: s.chars, figures: expect.any(Number), photos: expect.any(Number) })
  })
})
