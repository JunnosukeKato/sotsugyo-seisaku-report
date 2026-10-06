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
const FILE_FIELDS = 'id,name,size,modifiedTime'
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
  requestAccessToken(options?: { prompt?: string }): void
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

/** ログインして、ドライブへの保存の許可をもらう（Google の小さな窓が開く） */
export async function signIn(clientId: string): Promise<Token> {
  const oauth2 = await loadGis()
  return new Promise((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: `openid email ${DRIVE_SCOPE}`,
      callback: (r) => {
        if (r.error || !r.access_token) return reject(explainAuthError(r.error ?? 'unknown', r.error_description))
        if (!oauth2.hasGrantedAllScopes(r, DRIVE_SCOPE)) {
          return reject(new DriveError('scope', 'ドライブへの保存が許可されませんでした（Google の確認の画面で、ドライブの項目にチェックを入れてください）', r.scope ?? ''))
        }
        resolve({ accessToken: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 })
      },
      error_callback: (e) => reject(explainPopupError(e.type, e.message)),
    })
    client.requestAccessToken({ prompt: 'select_account' })
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
  const params = new URLSearchParams({ q, fields: `files(${FILE_FIELDS})`, orderBy: 'modifiedTime desc', spaces: 'drive' })
  const res = await call(token, `${API}/files?${params}`)
  return (await res.json()).files ?? []
}

export async function findFolder(token: Token): Promise<string | null> {
  const [folder] = await list(token, `name = ${quote(FOLDER_NAME)} and mimeType = ${quote(FOLDER_MIME)} and trashed = false`)
  return folder?.id ?? null
}

/** 「卒業制作報告書」フォルダ（なければ作る） */
export async function ensureFolder(token: Token): Promise<string> {
  const found = await findFolder(token)
  if (found) return found
  const res = await call(token, `${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
  })
  return (await res.json()).id
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
export async function saveFile(token: Token, file: { name: string; content: Blob; folderId: string; fileId?: string }): Promise<DriveFile> {
  const metadata = file.fileId ? {} : { name: file.name, parents: [file.folderId], mimeType: file.content.type || 'application/octet-stream' }
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
