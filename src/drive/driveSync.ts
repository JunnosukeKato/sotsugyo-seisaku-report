import { migrateReport } from '../model/migrate'
import { getImage, putImage, usedImageIds, type StoredImage } from '../model/storage'
import type { Report } from '../model/types'
import { deviceId, deviceName } from './device'
import { account, DriveError, ensureFolder, findFile, getFileState, listChildren, readFile, saveFile, signIn, type DriveFile, type Token } from './driveApi'

/**
 * 原稿を Google ドライブにも保存する（mockups/v18 案3・v19 案A）。
 * - ツールを開いたら、まず大学のアカウントでログインする（ログインするまで書けない）
 * - ログインしたら、ドライブの最新の原稿を開く。この端末の原稿と食い違うときは、どちらで続けるかを学生に選んでもらう
 * - 書いているあいだは、今まで通りこの端末（ブラウザ）に保存し、書くのをやめて数秒後にドライブにも送る。写真は1枚ずつ、1回だけ送る
 * - Google の許可は約1時間で切れる。切れたら、もう一度ログインしてもらう（押すまでも、この端末には保存し続ける）
 *
 * ドライブには「卒業制作報告書」フォルダを作り、原稿（原稿.json）と「写真」フォルダ（写真1枚ずつ）を置く。
 */

const LINK_KEY = 'sotsugyo-seisaku-report-drive'
const TOKEN_KEY = 'sotsugyo-seisaku-report-drive-token'
const KIND = 'sotsugyo-seisaku-report-drive'
const REPORT_NAME = '原稿.json'
const PHOTOS_FOLDER = '写真'
/** 書くのをやめてから、ドライブに送るまで */
const SYNC_DELAY_MS = 5000
/** 送れなかった（電波がない・Google 側の問題）ときに、やり直すまで */
const RETRY_MS = 30000
/** 許可が切れる少し前から、切れたものとして扱う */
const EXPIRY_MARGIN_MS = 60000

/** この端末とドライブのつながり（この端末のブラウザに覚えておく） */
interface Link {
  email: string
  folderId: string
  photosFolderId: string
  reportFileId?: string
  /** 最後に読み書きしたときの、ドライブの原稿の更新時刻 */
  remoteModified?: string
  /** そのときの、この端末の原稿の updatedAt（この端末の原稿が、それから変わったかを見る） */
  syncedUpdatedAt?: string
}

/** ドライブの原稿 */
export interface RemoteCopy {
  fileId: string
  modifiedTime: string
  savedAt: string
  /** 保存した端末（例：iPhone・Safari） */
  device: string
  report: Report
}

/** ログインしたあと、どの原稿で始めるか */
export type Resolution =
  /** どこにも原稿がない（はじめて） */
  | { kind: 'new' }
  /** この端末の原稿で続ける（upload：ドライブに送る必要がある） */
  | { kind: 'local'; upload: boolean }
  /** ドライブの原稿を開く */
  | { kind: 'remote'; remote: RemoteCopy }
  /** この端末とドライブの両方で書いている。どちらで続けるかを選んでもらう */
  | { kind: 'conflict'; remote: RemoteCopy }
  /** この端末には、別のアカウントの原稿が残っている（unsynced：ドライブに送っていない変更がある） */
  | { kind: 'otherAccount'; previousEmail: string; unsynced: boolean }

export type DriveStatus =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: Date }
  | { kind: 'offline' }
  /** 許可が切れた。もう一度ログインしてもらう */
  | { kind: 'expired' }
  /** 別の端末が、この端末より後にドライブに保存した */
  | { kind: 'conflict' }
  | { kind: 'error'; message: string }

export interface DriveState {
  email: string | null
  status: DriveStatus
}

// ---- ブラウザに覚えておくもの（使えなくても動くようにする） ----

function readLink(): Link | null {
  try {
    return JSON.parse(localStorage.getItem(LINK_KEY) ?? 'null')
  } catch {
    return null
  }
}

function writeLink(link: Link | null): void {
  try {
    if (link) localStorage.setItem(LINK_KEY, JSON.stringify(link))
    else localStorage.removeItem(LINK_KEY)
  } catch {
    // 覚えておけなくても、次に開いたときに確かめ直すだけ
  }
}

/** 許可（約1時間）は、このタブを閉じるまで覚えておく（ページを読み込み直しただけなら、ログインし直さなくてよい） */
function readSession(): (Token & { email: string }) | null {
  try {
    return JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? 'null')
  } catch {
    return null
  }
}

function writeSession(value: (Token & { email: string }) | null): void {
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, JSON.stringify(value))
    else sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // 覚えておけなければ、読み込み直したときにログインし直す
  }
}

// ---- 原稿の中身 ----

const paragraphsOf = (report: Report) => [...report.body.flatMap((c) => c.blocks), ...report.abstract.paragraphs].filter((b) => b.type === 'paragraph')

/** 何か書いてある原稿か（新しく作っただけの原稿は、ドライブの原稿で置き換えてよい） */
export function hasContent(report: Report): boolean {
  const b = report.basicInfo
  if (b.studentId.trim() || b.name.trim() || b.subtitleInput.trim() || usedImageIds(report).length) return true
  return paragraphsOf(report).some((p) => p.content.some((n) => n.type === 'text' && n.text.trim()))
}

/** 原稿の大きさ（どちらの原稿で続けるかを選ぶときに見せる） */
export function summarize(report: Report): { chars: number; figures: number; photos: number } {
  const blocks = report.body.flatMap((c) => c.blocks)
  return {
    chars: blocks.reduce((n, b) => n + (b.type === 'paragraph' ? b.content.reduce((m, x) => m + (x.type === 'text' ? x.text.length : 0), 0) : 0), 0),
    figures: blocks.reduce((n, b) => n + (b.type === 'figureRow' ? b.figures.filter((f) => f.imageId).length : 0), 0),
    photos: report.workPhotos.imageIds.filter(Boolean).length,
  }
}

/** 項目の並び順によらない文字列（同じ中身かを比べる） */
const stable = (value: unknown) =>
  JSON.stringify(value, (_key, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x))

/** 更新時刻のほかが同じ原稿か（形式をそろえてから比べる。項目の並び順や、前の版の形式の違いでは「違う」としない） */
export const sameContent = (a: Report, b: Report) => stable({ ...migrateReport(a), updatedAt: '' }) === stable({ ...migrateReport(b), updatedAt: '' })

const asDriveError = (e: unknown) => (e instanceof DriveError ? e : new DriveError('unknown', 'ドライブでエラーが起きました', String(e)))

export class DriveSync {
  private clientId: string
  private token: Token | null = null
  private link: Link | null = readLink()
  private state: DriveState = { email: null, status: { kind: 'idle' } }
  private listeners = new Set<() => void>()
  /** ログインして、どの原稿で始めるかが決まったあと（それまでは送らない） */
  private active = false
  private timer: number | undefined
  private retryTimer: number | undefined
  /** まだドライブに送っていない原稿 */
  private pending: Report | null = null
  private running: Promise<void> | null = null
  /** ドライブにある写真（写真の ID → ファイル） */
  private photos = new Map<string, DriveFile>()

  constructor(clientId: string) {
    this.clientId = clientId
    window.addEventListener('online', () => void this.flush())
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState = () => this.state

  private set(patch: Partial<DriveState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  private setStatus(status: DriveStatus): void {
    this.set({ status })
  }

  get tokenValid(): boolean {
    return !!this.token && this.token.expiresAt - EXPIRY_MARGIN_MS > Date.now()
  }

  /** ドライブに送れていない変更があるか（許可切れ・電波なし・別の端末の保存を待っている、送っている途中など） */
  get unsent(): boolean {
    return this.active && !!this.link && (!!this.pending || !!this.running)
  }

  /** 最後にドライブに保存した（読み込んだ）時刻 */
  get lastSaved(): Date | null {
    return this.link?.remoteModified ? new Date(this.link.remoteModified) : null
  }

  /** このタブで前にログインした許可が、まだ使えるか（使えれば、ログインのボタンを押さずに始める） */
  restoreToken(): boolean {
    const saved = readSession()
    if (!saved || saved.expiresAt - EXPIRY_MARGIN_MS < Date.now()) return false
    this.token = { accessToken: saved.accessToken, expiresAt: saved.expiresAt }
    this.set({ email: saved.email })
    return true
  }

  /**
   * ログインする。Google の窓はボタンを押したときにしか開けないので、ボタンを押した処理の中から、待たずに呼ぶ。
   * 前にログインしたアカウントがあれば、そのアカウントで（窓が一瞬出て閉じるだけ）。
   */
  async login(): Promise<void> {
    const hint = this.state.email ?? this.link?.email
    const token = await signIn(this.clientId, hint ? { prompt: '', hint } : { prompt: 'select_account' })
    const { email } = await account(token)
    if (this.active && this.link && email !== this.link.email) throw new DriveError('account', `最初と同じアカウント（${this.link.email}）でログインしてください`)
    this.token = token
    writeSession({ ...token, email })
    this.set({ email })
    if (this.active && this.state.status.kind === 'expired') {
      this.setStatus({ kind: 'idle' })
      void this.flush()
    }
  }

  private need(): Token {
    if (!this.tokenValid) throw new DriveError('expired', 'ログインの期限が切れました。もう一度ログインしてください')
    return this.token!
  }

  /** ログインしたあと：ドライブの原稿と、この端末の原稿（local）を比べて、どれで始めるかを決める */
  async resolve(local: Report | null): Promise<Resolution> {
    const token = this.need()
    const email = this.state.email ?? ''
    if (this.link && this.link.email !== email) {
      return { kind: 'otherAccount', previousEmail: this.link.email, unsynced: !!local && local.updatedAt !== this.link.syncedUpdatedAt }
    }
    const folderId = await ensureFolder(token)
    const photosFolderId = await ensureFolder(token, PHOTOS_FOLDER, folderId)
    // フォルダが変わった（ドライブでゴミ箱に入れたなど）ら、前のつながりは使わない
    const keep = this.link?.folderId === folderId ? this.link : null
    this.link = { ...keep, email, folderId, photosFolderId }
    writeLink(this.link)
    return this.compare(local)
  }

  /** ドライブの最新の原稿と比べる（ログインしたとき・「読み込み直す」） */
  async compare(local: Report | null): Promise<Resolution> {
    const token = this.need()
    const link = this.link!
    await this.loadPhotoList()
    const file = await findFile(token, link.folderId, REPORT_NAME)
    if (!file) return local ? { kind: 'local', upload: true } : { kind: 'new' }
    if (!local) return { kind: 'remote', remote: await this.readRemote(file) }
    const sameFile = link.reportFileId === file.id
    // 最後にドライブに保存したのがこの端末なら（送れたのに返事が届かなかったなど）、別の端末の保存ではない
    const own = sameFile && file.appProperties?.writer === deviceId()
    if (own && file.modifiedTime !== link.remoteModified) {
      link.remoteModified = file.modifiedTime
      if (file.appProperties?.updatedAt === local.updatedAt) link.syncedUpdatedAt = local.updatedAt
      writeLink(link)
    }
    const localChanged = local.updatedAt !== link.syncedUpdatedAt
    // この端末の原稿が、最後にドライブに送った版より古い（この端末への保存だけが失敗していた）。古い方で上書きしない
    const sentUpdatedAt = own ? file.appProperties?.updatedAt : link.syncedUpdatedAt
    const localStale = !!sentUpdatedAt && local.updatedAt < sentUpdatedAt
    if (sameFile && file.modifiedTime === link.remoteModified && !localStale) return { kind: 'local', upload: localChanged || (await this.photosToSend(local)) }
    const remote = await this.readRemote(file)
    if (sameContent(local, remote.report)) {
      this.adopt(remote, local)
      return { kind: 'local', upload: await this.photosToSend(local) }
    }
    if ((sameFile && (!localChanged || localStale)) || !hasContent(local)) return { kind: 'remote', remote }
    return { kind: 'conflict', remote }
  }

  /** ドライブの最新の原稿（別の端末が保存したとき、どちらで続けるかを選ぶのに使う） */
  async fetchRemote(): Promise<RemoteCopy | null> {
    try {
      const file = await findFile(this.need(), this.link!.folderId, REPORT_NAME)
      if (!file) return null
      await this.loadPhotoList()
      return await this.readRemote(file)
    } catch (e) {
      // 許可が切れていたら、もう一度ログインしてもらう（ログインし直すと、送り直して、また確かめる）
      if (e instanceof DriveError && e.code === 'expired') this.expire()
      throw e
    }
  }

  /** 許可が切れた：もう一度ログインしてもらう */
  private expire(): void {
    this.token = null
    writeSession(null)
    this.setStatus({ kind: 'expired' })
  }

  private async readRemote(file: DriveFile): Promise<RemoteCopy> {
    let body: { kind?: string; savedAt?: string; device?: string; report?: unknown }
    try {
      body = JSON.parse(await (await readFile(this.need(), file.id)).text())
    } catch (e) {
      if (e instanceof DriveError) throw e
      body = {}
    }
    if (body?.kind !== KIND) throw new DriveError('format', 'ドライブの原稿のファイルを読み込めませんでした（壊れているか、別のファイルです）')
    return { fileId: file.id, modifiedTime: file.modifiedTime, savedAt: body.savedAt ?? file.modifiedTime, device: body.device ?? '', report: migrateReport(body.report) }
  }

  private async loadPhotoList(): Promise<void> {
    const files = await listChildren(this.need(), this.link!.photosFolderId)
    this.photos.clear()
    for (const file of files) {
      const id = file.appProperties?.imageId
      if (id && !this.photos.has(id)) this.photos.set(id, file)
    }
  }

  /** 原稿で使っている写真のうち、この端末にあってドライブにないもの（ドライブで写真をゴミ箱に入れたなど）があるか */
  private async photosToSend(report: Report): Promise<boolean> {
    for (const id of new Set(usedImageIds(report))) if (!this.photos.has(id) && (await getImage(id))) return true
    return false
  }

  /**
   * フォルダがゴミ箱に入っていたら（消えていたら）、入れ直すフォルダを用意する（ゴミ箱の中に保存し続けないように）。
   * 変わったら true
   */
  private async checkFolders(token: Token): Promise<boolean> {
    const link = this.link!
    let moved = false
    if ((await getFileState(token, link.folderId)) === null) {
      link.folderId = await ensureFolder(token)
      link.photosFolderId = await ensureFolder(token, PHOTOS_FOLDER, link.folderId)
      moved = true
    } else if ((await getFileState(token, link.photosFolderId)) === null) {
      link.photosFolderId = await ensureFolder(token, PHOTOS_FOLDER, link.folderId)
      moved = true
    }
    if (moved) {
      writeLink(link)
      await this.loadPhotoList()
    }
    return moved
  }

  /**
   * 原稿のファイルを新しく作る前に（はじめて送るとき・ドライブで原稿のファイルやフォルダをゴミ箱に入れたとき）、
   * ほかの端末がすでに作った原稿がないか確かめる。あれば、そのファイルに保存する先を合わせ、
   * force でなければ true（上書きせずに、どちらで続けるかを選んでもらう）
   */
  private async findExisting(token: Token, force: boolean): Promise<boolean> {
    const link = this.link!
    delete link.reportFileId
    delete link.remoteModified
    await this.checkFolders(token)
    const file = await findFile(token, link.folderId, REPORT_NAME)
    if (file) link.reportFileId = file.id
    // この端末が作った（作れたのに返事が届かなかった）ファイルなら、そのまま続けて保存する
    const own = file?.appProperties?.writer === deviceId()
    if (own) link.remoteModified = file.modifiedTime
    writeLink(link)
    return !!file && !force && !own
  }

  /** 原稿で使っている写真のうち、この端末にないものをドライブから読み込む */
  async downloadImages(report: Report, onProgress?: (done: number, total: number) => void): Promise<StoredImage[]> {
    const missing: string[] = []
    for (const id of new Set(usedImageIds(report))) if (this.photos.has(id) && !(await getImage(id))) missing.push(id)
    const images: StoredImage[] = []
    onProgress?.(0, missing.length)
    for (const [i, id] of missing.entries()) {
      const file = this.photos.get(id)!
      const blob = await readFile(this.need(), file.id)
      const image = {
        id,
        blob: blob.type.startsWith('image/') ? blob : new Blob([blob], { type: 'image/jpeg' }),
        widthPx: Number(file.appProperties?.widthPx) || 1,
        heightPx: Number(file.appProperties?.heightPx) || 1,
      }
      await putImage(image)
      images.push(image)
      onProgress?.(i + 1, missing.length)
    }
    return images
  }

  /** ドライブの原稿を開いたあと：この端末の原稿（current）は、ドライブの原稿と同じ */
  adopt(remote: RemoteCopy, current: Report): void {
    Object.assign(this.link!, { reportFileId: remote.fileId, remoteModified: remote.modifiedTime, syncedUpdatedAt: current.updatedAt })
    writeLink(this.link)
    this.pending = null
    this.setStatus({ kind: 'saved', at: new Date(remote.modifiedTime) })
  }

  /** 始める（ここから、原稿が変わるたびにドライブに送る）。upload：この端末の原稿（とドライブにない写真）を、すぐ送る */
  activate(upload?: Report): void {
    this.active = true
    if (this.state.status.kind === 'idle' && this.lastSaved) this.setStatus({ kind: 'saved', at: this.lastSaved })
    if (upload && this.link) {
      this.pending = upload
      clearTimeout(this.timer)
      this.timer = window.setTimeout(() => void this.flush(), 0)
    }
  }

  /** 原稿が変わった：書くのをやめて少したったら、ドライブに送る */
  schedule(report: Report, delay = SYNC_DELAY_MS): void {
    if (!this.active || !this.link || report.updatedAt === this.link.syncedUpdatedAt) return
    this.pending = report
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => void this.flush(), delay)
  }

  /** 送っていない変更を、すぐドライブに送る */
  async flush(): Promise<void> {
    clearTimeout(this.timer)
    clearTimeout(this.retryTimer)
    while (this.running) await this.running
    const report = this.pending
    if (!report || !this.active) return
    this.pending = null
    this.running = this.upload(report)
    try {
      await this.running
    } finally {
      this.running = null
    }
  }

  /**
   * この端末の原稿で、ドライブの原稿を上書きする（どちらで続けるかを選んだとき）。
   * remote：選ばなかったドライブの原稿。そのファイルに上書きする（新しく作ると、原稿のファイルが2つになる）。
   * 選ぶ窓を出したあとに、別の端末がさらに保存していたら、上書きせずに、もう一度選んでもらう（その版を確かめずに消さないように）。
   * remote がない（ドライブに原稿がなかった）ときは、そのまま送る
   */
  async overwrite(report: Report, remote?: RemoteCopy): Promise<void> {
    clearTimeout(this.timer)
    while (this.running) await this.running
    if (remote && this.link) {
      // 選んだ時点のドライブの原稿を、見た版として覚えておく（すぐ送れなくても、つながってから同じ窓を出し直さない）
      Object.assign(this.link, { reportFileId: remote.fileId, remoteModified: remote.modifiedTime })
      writeLink(this.link)
    }
    this.pending = null
    this.running = this.upload(report, !remote)
    try {
      await this.running
    } finally {
      this.running = null
    }
  }

  /** 送れなかった原稿を、次に送るために残す（そのあとの変更があれば、そちらを残す） */
  private keep(report: Report): void {
    this.pending ??= report
  }

  private retryLater(): void {
    clearTimeout(this.retryTimer)
    this.retryTimer = window.setTimeout(() => void this.flush(), RETRY_MS)
  }

  private async upload(report: Report, force = false): Promise<void> {
    const link = this.link!
    // 電波がないときは、ログインもできないので先に見る（つながってから、許可が切れていればログインしてもらう）
    if (!navigator.onLine) {
      this.keep(report)
      this.setStatus({ kind: 'offline' })
      this.retryLater()
      return
    }
    if (!this.tokenValid) {
      this.keep(report)
      this.setStatus({ kind: 'expired' })
      return
    }
    this.setStatus({ kind: 'saving' })
    try {
      const token = this.token!
      /**
       * 別の端末が、この端末より後に保存していないか（していたら、上書きせずに、どちらで続けるかを選んでもらう）。
       * force：選ぶ窓で「この端末の原稿」を選んだあとなど、比べずに上書きする
       */
      const changedElsewhere = async () => {
        // はじめて送る・ドライブで原稿のファイルをゴミ箱に入れた：作る前に、ほかの端末が作った原稿がないか確かめる
        if (!link.reportFileId) return this.findExisting(token, force)
        const state = await getFileState(token, link.reportFileId)
        if (state === null) return this.findExisting(token, force)
        if (force || state.modifiedTime === link.remoteModified) return false
        // 最後に保存したのがこの端末（送れたのに返事が届かなかった）なら、別の端末の保存ではない
        if (state.appProperties?.writer === deviceId()) {
          link.remoteModified = state.modifiedTime
          return false
        }
        return true
      }
      if (await changedElsewhere()) {
        this.keep(report)
        this.setStatus({ kind: 'conflict' })
        return
      }
      const toSend: string[] = []
      for (const id of new Set(usedImageIds(report))) if (!this.photos.has(id)) toSend.push(id)
      // 写真を送る前に、写真のフォルダがゴミ箱に入っていないか確かめる
      if (toSend.length && (await this.checkFolders(token))) toSend.splice(0, toSend.length, ...toSend.filter((id) => !this.photos.has(id)))
      let sentPhotos = 0
      for (const id of toSend) {
        const image = await getImage(id)
        if (!image) continue
        const file = await saveFile(token, {
          name: `${id}.jpg`,
          folderId: link.photosFolderId,
          content: image.blob,
          appProperties: { imageId: id, widthPx: String(image.widthPx), heightPx: String(image.heightPx) },
        })
        this.photos.set(id, file)
        sentPhotos++
      }
      // 写真を送っているあいだに、別の端末が保存していないか（写真が多いと時間がかかるため、もう一度見る）
      if (sentPhotos && (await changedElsewhere())) {
        this.keep(report)
        this.setStatus({ kind: 'conflict' })
        return
      }
      const content = new Blob([JSON.stringify({ kind: KIND, savedAt: new Date().toISOString(), device: deviceName(), report })], { type: 'application/json' })
      // どの端末が、どの版を保存したかを付けておく（返事が届かなかったとき、自分の保存だと分かるように）
      const appProperties = { writer: deviceId(), updatedAt: report.updatedAt }
      const saved = await saveFile(token, { name: REPORT_NAME, folderId: link.folderId, content, fileId: link.reportFileId, appProperties })
      Object.assign(link, { reportFileId: saved.id, remoteModified: saved.modifiedTime, syncedUpdatedAt: report.updatedAt })
      writeLink(link)
      this.setStatus({ kind: 'saved', at: new Date() })
    } catch (e) {
      this.keep(report)
      const err = asDriveError(e)
      if (err.code === 'expired') this.expire()
      else if (err.code === 'network') {
        this.setStatus({ kind: 'offline' })
        this.retryLater()
      } else {
        this.setStatus({ kind: 'error', message: err.message })
        if (err.code === 'server' || err.code === 'rate' || err.code === 'unknown') this.retryLater()
      }
    }
  }

  /**
   * この端末から原稿を消す前に、ドライブに送り終える。送れたら true。
   * 写真もドライブにそろっているか確かめ直す（ドライブで写真をゴミ箱に入れていたら、送り直す。端末から消したあと、どこにも残らないように）
   */
  async finish(current: Report): Promise<boolean> {
    if (!this.link || !this.tokenValid) return false
    try {
      await this.checkFolders(this.token!)
      await this.loadPhotoList()
    } catch {
      return false
    }
    if (current.updatedAt !== this.link.syncedUpdatedAt || (await this.photosToSend(current))) {
      this.pending = current
      await this.flush()
    }
    return !!this.link && current.updatedAt === this.link.syncedUpdatedAt && !(await this.photosToSend(current))
  }

  /** この端末とドライブのつながりを忘れる（この端末から原稿を消したとき） */
  forget(): void {
    this.forgetLink()
    this.forgetToken()
  }

  forgetLink(): void {
    this.link = null
    this.active = false
    writeLink(null)
  }

  /** 許可を忘れる（次に開いたときは、ログインから） */
  forgetToken(): void {
    this.token = null
    writeSession(null)
  }
}
