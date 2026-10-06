// ドライブへの保存（ログイン必須）の通しの動作確認。Edge を自動で操作する。
// Google のログインとドライブは、このテストの中で作った偽物に差し替える（本物の Google には一切つながない）。
// 使い方: node scripts/e2e/drive.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { readFileSync } from 'node:fs'
import { withEdge } from '../poc/edge.mjs'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** 条件が満たされるまで待つ（満たされたら true） */
const until = async (fn, timeout = 30000) => {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(200)) if (await fn()) return true
  return false
}
const config = JSON.parse(readFileSync(new URL('./config-fixture.json', import.meta.url), 'utf8'))

/** 偽物のドライブ（ファイルはこのテストの中だけに置く） */
function fakeDrive() {
  const files = new Map()
  let seq = 0
  let clock = Date.now()
  const drive = { files, email: 'test@bunka-wu.ac.jp', failNext: null, logins: 0 }
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
      f.content = multipart(body, headers['content-type']).content
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

/** Google のログインの部品（偽物）：押すとすぐ許可が出る */
const GIS = `window.google = window.google || {};
window.google.accounts = { oauth2: {
  initTokenClient: (cfg) => ({ requestAccessToken: () => { window.__logins = (window.__logins || 0) + 1; setTimeout(() => cfg.callback({ access_token: 'fake-' + Date.now(), expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/drive.file' }), 30) } }),
  hasGrantedAllScopes: () => true,
  revoke: (t, done) => done && done(),
} };`

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS', 'Access-Control-Expose-Headers': 'Location' }

/** 端末（ブラウザの別の窓口）を1つ用意する。phone：スマホの画面 */
async function device(browser, drive, { phone = false } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  page.on('dialog', (d) => d.accept())
  if (phone) await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  else await page.setViewport({ width: 1440, height: 900 })
  await page.setRequestInterception(true)
  page.on('request', async (request) => {
    const url = request.url()
    if (/script\.google(usercontent)?\.com/.test(url)) {
      return request.respond({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ ok: true, year: config.fiscalYear, config }) })
    }
    if (url.startsWith('https://accounts.google.com/gsi/client')) return request.respond({ status: 200, contentType: 'text/javascript', body: GIS })
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
  return { context, page }
}

const editorReady = (page) => page.waitForFunction(() => window.__editor?.getSnapshot()?.layout && !window.__editor.getSnapshot().rendering, { timeout: 90000 })
const gateClosed = (page) => page.waitForFunction(() => !document.querySelector('.login-over'), { timeout: 60000 })
const nameOn = (page) => page.evaluate(() => window.__editor.getSnapshot().report.basicInfo.name)
const setInfo = (page, patch) => page.evaluate((patch) => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, ...patch } })), patch)
const savedChip = (page) =>
  page.waitForFunction(() => [...document.querySelectorAll('.chip.ok')].some((c) => /ドライブに保存|\d+:\d+/.test(c.textContent)) && !document.querySelector('.chip .dot.busy'), { timeout: 30000 })
const clickText = (page, selector, text) => page.evaluate((selector, text) => [...document.querySelectorAll(selector)].find((b) => b.textContent.includes(text)).click(), selector, text)
const snapshotsOf = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('sotsugyo-seisaku-report')
        open.onsuccess = () => {
          const get = open.result.transaction('snapshots', 'readonly').objectStore('snapshots').getAll()
          get.onsuccess = () => resolve(get.result.map((s) => s.report.basicInfo.subtitleInput))
        }
      }),
  )
const localReport = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const open = indexedDB.open('sotsugyo-seisaku-report')
        open.onsuccess = () => {
          const get = open.result.transaction('report', 'readonly').objectStore('report').get('current')
          get.onsuccess = () => resolve(get.result ?? null)
        }
      }),
  )

await withEdge(async (browser) => {
  const drive = fakeDrive()

  // ---- パソコン：はじめて開く ----
  const pc = await device(browser, drive)
  await pc.page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
  await pc.page.waitForSelector('.login-over .login-btn')
  check('開くと、ログインの窓が出る（ログインするまで書けない）', (await pc.page.$eval('.login-over', (e) => e.textContent)).includes('大学のアカウントでログイン'))
  await editorReady(pc.page)
  await pc.page.click('.login-btn')
  await gateClosed(pc.page)
  check('ログインすると窓が消え、はじめての人にはコースを選ぶ案内が出る', !!(await pc.page.$('.guide .g-opts button')))
  await clickText(pc.page, '.guide .g-opts button', 'コース')
  await editorReady(pc.page)
  await clickText(pc.page, '.guide button', 'あとで入力する')
  await setInfo(pc.page, { studentId: '23FA0123', name: '文化　花子' })
  await savedChip(pc.page)
  check('書いた内容が、数秒後にドライブにも保存される', drive.report()?.report.basicInfo.name === '文化　花子')
  const folders = [...drive.files.values()].filter((f) => f.mimeType === 'application/vnd.google-apps.folder').map((f) => f.name)
  check('ドライブには「卒業制作報告書」フォルダと「写真」フォルダができる', folders.join(',') === '卒業制作報告書,写真', folders.join(','))
  await pc.page.screenshot({ path: 'poc-output/e2e/drive-saved.png' })

  // 読み込み直しても、このタブでログイン済みなら、ボタンを押さずに続けられる
  await pc.page.reload({ waitUntil: 'networkidle0' })
  await editorReady(pc.page)
  await gateClosed(pc.page)
  check('読み込み直しても、このタブではログインし直さずに続けられる', (await pc.page.evaluate(() => window.__logins ?? 0)) === 0 && (await nameOn(pc.page)) === '文化　花子')

  // ---- スマホ：別の端末でログインすると、ドライブの原稿が開く ----
  const phone = await device(browser, drive, { phone: true })
  await phone.page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
  await editorReady(phone.page)
  await phone.page.click('.login-btn')
  await gateClosed(phone.page)
  await editorReady(phone.page)
  check('別の端末でログインすると、ドライブの原稿が開く（コースの案内は出ない）', (await nameOn(phone.page)) === '文化　花子' && !(await phone.page.$('.guide')))
  await setInfo(phone.page, { name: '文化　次郎' })
  check('スマホで書いた内容も、ドライブに保存される', await until(() => drive.report()?.report.basicInfo.name === '文化　次郎'))
  await savedChip(phone.page)
  await phone.page.click('.p-top .icon-btn')
  await phone.page.waitForSelector('.sheet .drive-pop')
  check('スマホでは、メニューの中にドライブの操作がある', (await phone.page.$eval('.sheet .drive-pop', (e) => e.textContent)).includes('この端末から原稿を消す'))
  await phone.page.screenshot({ path: 'poc-output/e2e/drive-phone-menu.png' })
  await phone.page.click('.sheet-close')

  // ---- パソコンに戻って書くと：別の端末が後から保存していたので、どちらで続けるかを聞く ----
  await setInfo(pc.page, { subtitleInput: 'パソコンで書いた' })
  await pc.page.waitForSelector('.drive-two', { timeout: 30000 })
  check('別の端末が後から保存していたら、上書きせずに、どちらで続けるかを聞く', drive.report()?.report.basicInfo.name === '文化　次郎')
  await pc.page.screenshot({ path: 'poc-output/e2e/drive-conflict.png' })
  await clickText(pc.page, '.modal button', 'ドライブの原稿を開く')
  await pc.page.waitForFunction(() => !document.querySelector('.drive-two'), { timeout: 30000 })
  await editorReady(pc.page)
  check('ドライブの原稿を選ぶと、別の端末で書いた内容になる', (await nameOn(pc.page)) === '文化　次郎')
  check('選ばなかった原稿は、自動の控えに残る', (await snapshotsOf(pc.page)).includes('パソコンで書いた'))

  // ---- 1時間たって許可が切れたとき ----
  drive.failNext = 401
  await setInfo(pc.page, { subtitleInput: '許可が切れたあと' })
  await pc.page.waitForFunction(() => [...document.querySelectorAll('.modal h2')].some((h) => h.textContent.includes('もう一度ログイン')), { timeout: 30000 })
  check('Google の許可が切れたら、もう一度ログインする窓が出る', true)
  check('ログインし直すまでも、この端末には保存している', (await localReport(pc.page))?.basicInfo.subtitleInput === '許可が切れたあと')
  await clickText(pc.page, '.modal button', 'ログインし直す')
  await pc.page.waitForFunction(() => ![...document.querySelectorAll('.modal h2')].some((h) => h.textContent.includes('もう一度ログイン')), { timeout: 30000 })
  await savedChip(pc.page)
  check('ログインし直すと、ドライブへの保存が続く', drive.report()?.report.basicInfo.subtitleInput === '許可が切れたあと')

  // ---- 別のアカウントでログインしたとき（共用のパソコン） ----
  drive.email = 'other@bunka-wu.ac.jp'
  await pc.page.evaluate(() => sessionStorage.clear())
  await pc.page.reload({ waitUntil: 'networkidle0' })
  await editorReady(pc.page)
  await pc.page.click('.login-btn')
  await pc.page.waitForFunction(() => [...document.querySelectorAll('.modal h2')].some((h) => h.textContent.includes('別のアカウント')), { timeout: 30000 })
  check('この端末に別のアカウントの原稿があるときは、知らせる', (await pc.page.$eval('.modal .lead', (e) => e.textContent)).includes('test@bunka-wu.ac.jp'))
  drive.email = 'test@bunka-wu.ac.jp'
  await clickText(pc.page, '.modal button', '前のアカウントでログインし直す')
  await pc.page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {})
  await editorReady(pc.page)
  await pc.page.click('.login-btn')
  await gateClosed(pc.page)
  check('前のアカウントでログインし直すと、続きを書ける', (await nameOn(pc.page)) === '文化　次郎')

  // ---- 共用のパソコンで書き終えたとき：この端末から原稿を消す ----
  await pc.page.click('.drive-chip-wrap .chip')
  await clickText(pc.page, '.drive-pop button', 'この端末から原稿を消す')
  await pc.page.waitForSelector('.modal .primary')
  await Promise.all([pc.page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 }), clickText(pc.page, '.modal button', 'この端末から消す')])
  await pc.page.waitForSelector('.login-over .login-btn')
  check('「この端末から原稿を消す」で、この端末の原稿が消え、ログインの窓に戻る', (await localReport(pc.page)) === null && (await snapshotsOf(pc.page)).length === 0)
  check('この端末から消しても、ドライブの原稿は残る', drive.report()?.report.basicInfo.name === '文化　次郎')

  // ---- インターネットにつながっていないとき ----
  await pc.page.setOfflineMode(true)
  await pc.page.waitForFunction(() => document.querySelector('.login-btn')?.disabled && document.querySelector('.login-warn'), { timeout: 10000 })
  check('インターネットにつながっていないと、ログインのボタンが押せない（書けない）', true)
  await pc.page.screenshot({ path: 'poc-output/e2e/drive-offline.png' })
  await pc.page.setOfflineMode(false)

  await phone.context.close()
  await pc.context.close()
})

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 件 合格`)
process.exitCode = failed.length ? 1 : 0
