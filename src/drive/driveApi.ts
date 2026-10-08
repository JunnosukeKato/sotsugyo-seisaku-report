/**
 * Google ドライブとのやりとり。学生本人のドライブに、このツールで作ったファイルだけを保存・読み込みする。
 * - ログインは Google Identity Services（トークンの方式。ページの中だけで完結し、サーバーはいらない）
 * - 許可の範囲は drive.file：このツールが作った（開いた）ファイルだけ。学生のほかのファイルは見えない
 * まだ試しの段階で、接続テストのページ（drive-test.html）から使う。
 */

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const FOLDER_NAME = '卒業制作報告書'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FILE_FIELDS = 'id,name,size,modifiedTime,appProperties'
/** これより大きいファイルは、分けて送れる方式（resumable）で送る */
const MULTIPART_LIMIT = 4 * 1024 * 1024

/** 利用者に見せる説明（message）と、調べるための元の文（raw） */
export class DriveError extends Error {
  code: string
  raw: string
  constructor(code: string, message: string, raw = '') {
    super(message)
    this.code = code
    this.raw = raw
  }
}

// ---- ログイン（Google Identity Services） ----

interface TokenResponse {
  access_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}
interface TokenClient {
  requestAccessToken(options?: { prompt?: string; hint?: string; login_hint?: string }): void
}
interface Oauth2 {
  initTokenClient(config: {
    client_id: string
    scope: string
    callback: (r: TokenResponse) => void
    error_callback?: (e: { type: string; message?: string }) => void
  }): TokenClient
  hasGrantedAllScopes(r: TokenResponse, ...scopes: string[]): boolean
  revoke(token: string, done?: () => void): void
}
/** 読み込んだ Google のログインの部品（管理ページの google.script とは別物なので、Window には足さない） */
const gis = () => (window as unknown as { google?: { accounts?: { oauth2?: Oauth2 } } }).google?.accounts?.oauth2

export interface Token {
  accessToken: string
  expiresAt: number
}

let gisLoading: Promise<Oauth2> | null = null

function loadGis(): Promise<Oauth2> {
  const loaded = gis()
  if (loaded) return Promise.resolve(loaded)
  gisLoading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => {
      const oauth2 = gis()
      if (oauth2) resolve(oauth2)
      else reject(new DriveError('gis', 'Google のログインの部品を読み込めませんでした'))
    }
    script.onerror = () => {
      gisLoading = null
      reject(new DriveError('gis', 'Google のログインの部品を読み込めませんでした（ネットワークか、ブラウザの設定で止められています）'))
    }
    document.head.append(script)
  })
  return gisLoading
}

/**
 * ログインの部品を先に読み込んでおく（ボタンを押したときに、すぐ Google の窓を開けるように）。
 * clientId を渡すと、Google の窓を開く準備（トークンのクライアント）も先に作っておく
 */
export function preloadGis(clientId?: string): Promise<void> {
  return loadGis().then((oauth2) => {
    if (clientId) tokenClient(oauth2, clientId)
  })
}

/** ログインの部品を読み込み終えているか（読み込み終えていれば、押した処理の中で、待たずに Google の窓を開ける） */
export function signInReady(): boolean {
  return !!gis()
}

export interface SignInOptions {
  /** select_account：アカウントを選ばせる（はじめて）。''：前に許可していれば、窓が一瞬出て閉じるだけ */
  prompt?: 'select_account' | '' | 'consent'
  /** 前にログインしたアカウント（メールアドレス） */
  hint?: string
}

/**
 * ログインして、ドライブへの保存の許可をもらう（Google の小さな窓が開く）。
 * 窓はボタンを押したときにしか開けない（ブラウザが止める）ので、部品が読み込み済みなら、待たずにすぐ開く。
 */
export function signIn(clientId: string, options: SignInOptions = {}): Promise<Token> {
  const ready = gis()
  return ready ? requestToken(ready, clientId, options) : loadGis().then((oauth2) => requestToken(oauth2, clientId, options))
}

/** Google の窓の返事を待っているもの（窓を続けて開いたときは、どれにも同じ返事を渡す） */
const waiting: { resolve: (token: Token) => void; reject: (e: DriveError) => void }[] = []
/** Google の窓を開く準備（トークンのクライアント）。一度作ったら使い回す（押したときは requestAccessToken を呼ぶだけ） */
let client: { clientId: string; tokenClient: TokenClient } | null = null

function tokenClient(oauth2: Oauth2, clientId: string): TokenClient {
  if (client?.clientId === clientId) return client.tokenClient
  const settle = (result: Token | DriveError) => {
    for (const w of waiting.splice(0)) {
      if (result instanceof DriveError) w.reject(result)
      else w.resolve(result)
    }
  }
  const tokenClient = oauth2.initTokenClient({
    client_id: clientId,
    scope: `openid email ${DRIVE_SCOPE}`,
    callback: (r) => {
      if (r.error || !r.access_token) return settle(explainAuthError(r.error ?? 'unknown', r.error_description))
      if (!oauth2.hasGrantedAllScopes(r, DRIVE_SCOPE)) {
        return settle(new DriveError('scope', 'ドライブへの保存が許可されませんでした（Google の確認の画面で、ドライブの項目にチェックを入れてください）', r.scope ?? ''))
      }
      settle({ accessToken: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 })
    },
    error_callback: (e) => settle(explainPopupError(e.type, e.message)),
  })
  client = { clientId, tokenClient }
  return tokenClient
}

/** Google の窓を開く（待たずに、この場で開く。押した処理の中から呼ばれる） */
function requestToken(oauth2: Oauth2, clientId: string, options: SignInOptions): Promise<Token> {
  return new Promise((resolve, reject) => {
    const w = { resolve, reject }
    waiting.push(w)
    try {
      // アカウントの指定は、今の説明書の名前（login_hint）と前の名前（hint）の両方で渡す
      tokenClient(oauth2, clientId).requestAccessToken({ prompt: options.prompt ?? 'select_account', ...(options.hint ? { login_hint: options.hint, hint: options.hint } : {}) })
    } catch (e) {
      waiting.splice(waiting.indexOf(w), 1)
      throw e
    }
  })
}

/** このツールへの許可を取り消す（次に使うときは、もう一度許可がいる） */
export async function revoke(token: Token): Promise<void> {
  const oauth2 = await loadGis()
  await new Promise<void>((resolve) => oauth2.revoke(token.accessToken, resolve))
}

export function explainAuthError(error: string, description = ''): DriveError {
  const raw = `${error} ${description}`.trim()
  switch (error) {
    case 'access_denied':
      return new DriveError('denied', 'ログインの許可がされませんでした（「キャンセル」を押したか、大学の設定で止められています）', raw)
    case 'admin_policy_enforced':
      return new DriveError('blocked', '大学の管理者の設定で、このツールとつなぐことが止められています', raw)
    case 'org_internal':
      return new DriveError('org', 'このツールは大学のアカウントだけで使えます（ほかのアカウントでログインしています）', raw)
    case 'invalid_client':
    case 'unauthorized_client':
      return new DriveError('client', 'ツールの登録（クライアント ID）が正しくありません', raw)
    default:
      return new DriveError('auth', 'ログインできませんでした', raw)
  }
}

export function explainPopupError(type: string, message = ''): DriveError {
  const raw = `${type} ${message}`.trim()
  if (type === 'popup_failed_to_open') return new DriveError('popup', 'ログインの窓を開けませんでした（ブラウザがポップアップを止めています。許可してからやり直してください）', raw)
  if (type === 'popup_closed') {
    return new DriveError('closed', 'ログインの窓が閉じられました。Google の画面にエラー（例：「エラー 400: admin_policy_enforced」）が出ていたら、その文字を控えてください', raw)
  }
  return new DriveError('auth', 'ログインできませんでした', raw)
}

// ---- ドライブの API ----

async function call(token: Token, url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token.accessToken}`, ...init.headers } })
  } catch (e) {
    throw new DriveError('network', 'ドライブにつながりませんでした（ネットワークを確かめてください）', String(e))
  }
  if (!res.ok) throw await responseError(res)
  return res
}

async function responseError(res: Response): Promise<DriveError> {
  let reason = ''
  let message = ''
  try {
    const body = await res.json()
    reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? ''
    message = body.error?.message ?? ''
  } catch {
    // 中身が JSON でなければ、状態の番号だけで判断する
  }
  return explainApiError(res.status, reason, message)
}

/** ドライブの API のエラーを、利用者に分かる言葉にする */
export function explainApiError(status: number, reason: string, message = ''): DriveError {
  const raw = `${status} ${reason} ${message}`.trim()
  if (status === 401) return new DriveError('expired', 'ログインの期限が切れました。もう一度ログインしてください', raw)
  if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') return new DriveError('api', 'ツールの登録で「Google Drive API」が有効になっていません（Google Cloud の設定）', raw)
  if (reason === 'domainPolicy') return new DriveError('blocked', '大学の設定で、ほかのツールからドライブを使うことが止められています', raw)
  if (reason === 'storageQuotaExceeded' || reason === 'quotaExceeded') return new DriveError('quota', 'ドライブの容量がいっぱいで保存できません', raw)
  if (reason === 'insufficientPermissions' || reason === 'insufficientFilePermissions' || reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT') {
    return new DriveError('scope', 'ドライブへの保存が許可されていません（ログインのときに、ドライブの項目にチェックが入っていなかった可能性があります）', raw)
  }
  if (status === 429 || reason === 'userRateLimitExceeded' || reason === 'rateLimitExceeded') return new DriveError('rate', '短い時間に何度も保存しました。少し待ってからやり直してください', raw)
  if (status === 404) return new DriveError('missing', 'ファイルが見つかりません（削除されたか、別のアカウントのファイルです）', raw)
  if (status >= 500) return new DriveError('server', 'Google 側で一時的な問題が起きています。少し待ってからやり直してください', raw)
  return new DriveError('unknown', 'ドライブでエラーが起きました', raw)
}

export interface DriveFile {
  id: string
  name: string
  size?: string
  modifiedTime: string
  /** このツールが付けた情報（写真の ID・大きさなど） */
  appProperties?: Record<string, string>
}

export interface Account {
  email: string
  /** 容量の上限（バイト）。上限がなければ undefined */
  limit?: number
  usage: number
}

export async function account(token: Token): Promise<Account> {
  const res = await call(token, `${API}/about?fields=${encodeURIComponent('user(emailAddress),storageQuota(limit,usage)')}`)
  const body = await res.json()
  const limit = Number(body.storageQuota?.limit)
  return { email: body.user?.emailAddress ?? '', limit: Number.isFinite(limit) && limit > 0 ? limit : undefined, usage: Number(body.storageQuota?.usage ?? 0) }
}

/** 検索の条件に入れる文字（' と \ をエスケープする） */
export const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

async function list(token: Token, q: string): Promise<DriveFile[]> {
  const files: DriveFile[] = []
  let pageToken = ''
  do {
    const params = new URLSearchParams({ q, fields: `nextPageToken,files(${FILE_FIELDS})`, orderBy: 'modifiedTime desc', spaces: 'drive', pageSize: '1000' })
    if (pageToken) params.set('pageToken', pageToken)
    const body = await (await call(token, `${API}/files?${params}`)).json()
    files.push(...(body.files ?? []))
    pageToken = body.nextPageToken ?? ''
  } while (pageToken)
  return files
}

/** フォルダを探す（parentId を省くとマイドライブ全体から。このツールが作ったものだけが見つかる） */
export async function findFolder(token: Token, name = FOLDER_NAME, parentId?: string): Promise<string | null> {
  const [folder] = await list(token, `name = ${quote(name)} and mimeType = ${quote(FOLDER_MIME)} and trashed = false${parentId ? ` and ${quote(parentId)} in parents` : ''}`)
  return folder?.id ?? null
}

/** フォルダ（なければ作る）。省いたら、マイドライブの「卒業制作報告書」フォルダ */
export async function ensureFolder(token: Token, name = FOLDER_NAME, parentId?: string): Promise<string> {
  const found = await findFolder(token, name, parentId)
  if (found) return found
  const res = await call(token, `${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }),
  })
  return (await res.json()).id
}

/** フォルダの中のファイル（ゴミ箱のものは除く） */
export function listChildren(token: Token, folderId: string): Promise<DriveFile[]> {
  return list(token, `${quote(folderId)} in parents and trashed = false`)
}

/** ファイル（フォルダ）の最後に変わった時刻と、このツールが付けた情報。消えていたり、ゴミ箱に入っていたら null */
export async function getFileState(token: Token, fileId: string): Promise<{ modifiedTime: string; appProperties?: Record<string, string> } | null> {
  try {
    const body = await (await call(token, `${API}/files/${fileId}?fields=modifiedTime,trashed,appProperties`)).json()
    return body.trashed ? null : { modifiedTime: body.modifiedTime, appProperties: body.appProperties }
  } catch (e) {
    if (e instanceof DriveError && e.code === 'missing') return null
    throw e
  }
}

export async function findFile(token: Token, folderId: string, name: string): Promise<DriveFile | null> {
  const [file] = await list(token, `name = ${quote(name)} and ${quote(folderId)} in parents and trashed = false`)
  return file ?? null
}

/** 情報（名前など）と中身を1回で送るときの本文 */
export function multipartBody(metadata: object, content: Blob, boundary: string): Blob {
  return new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${content.type || 'application/octet-stream'}\r\n\r\n`,
    content,
    `\r\n--${boundary}--`,
  ])
}

/**
 * ファイルを保存する。fileId があれば上書き、なければ folderId のフォルダに新しく作る。
 * 大きいファイルは、分けて送れる方式で送る。
 */
export async function saveFile(
  token: Token,
  file: { name: string; content: Blob; folderId: string; fileId?: string; appProperties?: Record<string, string> },
): Promise<DriveFile> {
  const metadata = file.fileId
    ? file.appProperties
      ? { appProperties: file.appProperties }
      : {}
    : { name: file.name, parents: [file.folderId], mimeType: file.content.type || 'application/octet-stream', ...(file.appProperties ? { appProperties: file.appProperties } : {}) }
  const target = file.fileId ? `${UPLOAD}/files/${file.fileId}` : `${UPLOAD}/files`
  const method = file.fileId ? 'PATCH' : 'POST'
  if (file.content.size > MULTIPART_LIMIT) {
    // 1回目で送る場所をもらい、2回目で中身を送る
    const start = await call(token, `${target}?uploadType=resumable&fields=${FILE_FIELDS}`, {
      method,
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': file.content.type || 'application/octet-stream' },
      body: JSON.stringify(metadata),
    })
    const location = start.headers.get('Location')
    if (location) {
      let res: Response
      try {
        res = await fetch(location, { method: 'PUT', body: file.content })
      } catch (e) {
        throw new DriveError('network', 'ドライブへの送信が途中で切れました（ネットワークを確かめてください）', String(e))
      }
      if (!res.ok) throw await responseError(res)
      return res.json()
    }
  }
  const boundary = `sotsugyo-${Math.random().toString(36).slice(2)}`
  const res = await call(token, `${target}?uploadType=multipart&fields=${FILE_FIELDS}`, {
    method,
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipartBody(metadata, file.content, boundary),
  })
  return res.json()
}

export async function readFile(token: Token, fileId: string): Promise<Blob> {
  const res = await call(token, `${API}/files/${fileId}?alt=media`)
  return res.blob()
}

/** ゴミ箱に移す（ゴミ箱からは30日で自動的に消える） */
export async function trashFile(token: Token, fileId: string): Promise<void> {
  await call(token, `${API}/files/${fileId}?fields=id`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ trashed: true }),
  })
}
