// Google のログインとドライブの偽物（本物の Google には一切つながない）。
// ドライブへの保存の通しテスト（drive.mjs）と、使い方の手引きの画面の画像（make-guides.mjs）で使う。

/** 偽物のドライブ（ファイルはこの中だけに置く）。email：ログインしたことにするアカウント */
export function fakeDrive(email = '00zz901@bunka-wu.ac.jp') {
  const files = new Map()
  let seq = 0
  let clock = Date.now()
  // 学生のアカウント（@ より前は学籍番号の小文字）
  const drive = { files, email, failNext: null, logins: 0 }
  const now = () => new Date((clock += 1000)).toISOString()
  const meta = (f) => ({ id: f.id, name: f.name, size: String(f.content?.length ?? 0), modifiedTime: f.modifiedTime, appProperties: f.appProperties })
  const unquote = (s) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\')
  const matches = (f, q) => {
    const name = q.match(/name = '((?:\\.|[^'])*)'/)
    const mime = q.match(/mimeType = '((?:\\.|[^'])*)'/)
    const parent = q.match(/'([^']+)' in parents/)
    return (!name || f.name === unquote(name[1])) && (!mime || f.mimeType === unquote(mime[1])) && (!parent || f.parents.includes(parent[1])) && (!/trashed = false/.test(q) || !f.trashed)
  }
  const create = (m, content) => {
    const f = { id: `f${++seq}`, name: m.name, mimeType: m.mimeType ?? 'application/octet-stream', parents: m.parents ?? ['root'], appProperties: m.appProperties, trashed: false, modifiedTime: now(), content }
    files.set(f.id, f)
    return f
  }
  const multipart = (body, contentType) => {
    const boundary = contentType.match(/boundary=(.+)$/)[1]
    const [first, second] = body.split(`--${boundary}`).filter((p) => p.trim() && p.trim() !== '--')
    const part = (p) => p.slice(p.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '')
    return { metadata: JSON.parse(part(first)), content: Buffer.from(part(second), 'utf8') }
  }
  /** ドライブの API の1回の呼び出しに答える（[状態, 返す中身, 中身の種類]） */
  drive.answer = async (method, url, headers, body) => {
    const u = new URL(url)
    if (drive.failNext) {
      const status = drive.failNext
      drive.failNext = null
      return [status, { error: { code: status, message: 'fake error', errors: [{ reason: status === 401 ? 'authError' : 'backendError' }] } }]
    }
    if (u.pathname === '/drive/v3/about') return [200, { user: { emailAddress: drive.email }, storageQuota: { usage: '1000' } }]
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      const q = u.searchParams.get('q') ?? ''
      const list = [...files.values()].filter((f) => matches(f, q)).sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))
      return [200, { files: list.map(meta) }]
    }
    if (u.pathname === '/drive/v3/files' && method === 'POST') return [200, meta(create(JSON.parse(body), Buffer.alloc(0)))]
    if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const { metadata, content } = multipart(body, headers['content-type'])
      return [200, meta(create(metadata, content))]
    }
    const upload = u.pathname.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/)
    if (upload && method === 'PATCH') {
      const f = files.get(upload[1])
      if (!f) return [404, { error: { code: 404, errors: [{ reason: 'notFound' }] } }]
      const { metadata, content } = multipart(body, headers['content-type'])
      f.content = content
      // 本物のドライブと同じく、appProperties は足し合わせる
      if (metadata.appProperties) f.appProperties = { ...f.appProperties, ...metadata.appProperties }
      f.modifiedTime = now()
      return [200, meta(f)]
    }
    const one = u.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/)
    if (one) {
      const f = files.get(one[1])
      if (!f) return [404, { error: { code: 404, errors: [{ reason: 'notFound' }] } }]
      if (method === 'PATCH') {
        Object.assign(f, JSON.parse(body), { modifiedTime: now() })
        return [200, { id: f.id }]
      }
      if (u.searchParams.get('alt') === 'media') return [200, f.content, f.mimeType]
      return [200, { ...meta(f), trashed: f.trashed }]
    }
    return [400, { error: { code: 400, message: `unknown ${method} ${u.pathname}` } }]
  }
  /** ドライブの原稿（原稿.json の中身） */
  drive.report = () => {
    const f = [...files.values()].find((x) => x.name === '原稿.json' && !x.trashed)
    return f ? JSON.parse(f.content.toString('utf8')) : null
  }
  return drive
}

/**
 * Google のログインの部品（偽物）：押すとすぐ許可が出る。
 * 窓を開いた回数（__logins）と、そのときの指定（__loginOptions：prompt・hint）を覚えておく。
 * __fakeExpiresIn（秒）を入れておくと、その長さの許可を出す（ふだんは1時間）
 */
export const FAKE_GIS = `window.google = window.google || {};
window.google.accounts = { oauth2: {
  initTokenClient: (cfg) => ({ requestAccessToken: (options) => { window.__logins = (window.__logins || 0) + 1; (window.__loginOptions = window.__loginOptions || []).push(options || {}); setTimeout(() => cfg.callback({ access_token: 'fake-' + Date.now(), expires_in: window.__fakeExpiresIn || 3600, scope: 'openid email https://www.googleapis.com/auth/drive.file' }), 30) } }),
  hasGrantedAllScopes: () => true,
  revoke: (t, done) => done && done(),
} };`

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'Access-Control-Expose-Headers': 'Location' }

/**
 * ページの Google への通信を、偽物に答えさせる。
 * 学科の設定（Apps Script）は config を返す（返すたびに読むので、あとから config を書き換えると次から変わる）
 */
export async function routeGoogle(page, drive, config) {
  await page.setRequestInterception(true)
  page.on('request', async (request) => {
    const url = request.url()
    if (/script\.google(usercontent)?\.com/.test(url)) {
      return request.respond({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, year: config.fiscalYear, config }) })
    }
    if (url.startsWith('https://accounts.google.com/gsi/client')) return request.respond({ status: 200, contentType: 'text/javascript', body: FAKE_GIS })
    if (url.startsWith('https://www.googleapis.com/')) {
      if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers: CORS })
      const body = request.hasPostData() ? ((await request.fetchPostData()) ?? '') : ''
      const [status, data, type] = await drive.answer(request.method(), url, request.headers(), body)
      return request.respond({
        status,
        headers: CORS,
        contentType: type ?? 'application/json',
        body: Buffer.isBuffer(data) ? data : JSON.stringify(data),
      })
    }
    return request.continue()
  })
}
