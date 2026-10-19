/**
 * 卒業制作報告書 作成ツール：年度設定の配信（Google Apps Script。単独のプロジェクト）
 *
 * 学生のツールが起動時に「公開中の年度設定」を読み込むための窓口（doGet）。
 * ウェブアプリとして公開する（実行するユーザー：自分、アクセス：全員）。
 * 返すのは公開中（または終了した年度）の設定だけで、準備中の年度や学生のデータは扱わない。
 *
 * 管理用スプレッドシートの ID は、ビルド時（scripts/build-gas.mjs）に SHEET_ID へ入る。
 * 入っていなければ「プロジェクトの設定 → スクリプト プロパティ」の SHEET_ID を使う。
 * 最初に1回だけ authorize を実行して、スプレッドシートを読む権限を承認する。
 *
 * もう1つの窓口（doPost）：学生が「PDFを書き出す」で作った PDF の控えを、先生のドライブのフォルダに置く。
 * - フォルダは、先生が決めたもの（学生からは見えない）。ID はビルド時に gas/pdf-folder.local.json から PDF_FOLDER_ID へ入る
 *   （git には入れない。入っていなければスクリプト プロパティの PDF_FOLDER_ID）。未設定なら、何もせずに「未設定」と返す
 * - 送った人は、学生のツールのログインの許可（アクセストークン）を Google に確かめる（このツールの OAuth クライアント・大学のアカウント・確かめ済みのアドレス）。
 *   学生のアカウント（@ より前が学籍番号の形）なら、表紙の学籍番号と同じであること。教職員のアカウントも、見本の原稿で試せるように通す
 * - フォルダの中に、コースごとのフォルダを作り（なければ）、学生ごとに1つのファイルを置く。送るたびに中身を新しい版にする（前の版はドライブに残る）
 * - ファイル名は提出の決まりと同じ「学籍番号_氏名（空白を詰める）.pdf」（例：00ZZ0123_文化花子.pdf。学生が書き出す PDF と同じ名前）。
 *   教職員が試しに送った控えは、頭に「試し_」を付ける。ファイルの説明に、送った人のアドレスを書く
 * OAuth クライアント ID と大学のドメインも、ビルド時（.env の VITE_GOOGLE_CLIENT_ID・VITE_GOOGLE_DOMAIN）に入る
 * （入っていなければスクリプト プロパティの GOOGLE_CLIENT_ID・GOOGLE_DOMAIN）。
 * PDF の控えには、ドライブ（高度なサービス Drive API v3）と外部への接続の権限がいる。デプロイしたあと、エディタで1回だけ authorizePdfCopy を実行して承認する。
 * このファイルは app/gas/api-project/Code.js が元。
 */

const SHEET_ID = /*SHEET_ID*/ ''
/** 書き出した PDF の控えを置く、先生のドライブのフォルダ（ビルド時に gas/pdf-folder.local.json から入る） */
const PDF_FOLDER_ID = /*PDF_FOLDER_ID*/ ''
/** 学生のツールのログインの登録（OAuth クライアント ID。ビルド時に .env から入る） */
const CLIENT_ID = /*CLIENT_ID*/ ''
/** 大学のアカウントのドメイン（ビルド時に .env から入る） */
const DOMAIN = /*DOMAIN*/ ''

/** PDF の控えの大きさの上限（40MB。ふつうは数 MB） */
const PDF_MAX_BYTES = 40 * 1024 * 1024
/** 上限の PDF を base64 にしたときの文字数 */
const PDF_MAX_BASE64 = Math.ceil(PDF_MAX_BYTES / 3) * 4
const FOLDER_MIME = 'application/vnd.google-apps.folder'
/** 学籍番号の形（学生用ツールの src/model/account.ts と同じ。年度の設定で形式を決めていれば、そちらを使う） */
const DEFAULT_STUDENT_ID = /^\d{2}[A-Z]{2,3}\d{3,4}$/

function sheetId_() {
  const id = SHEET_ID || PropertiesService.getScriptProperties().getProperty('SHEET_ID')
  if (!id) throw new Error('SHEET_ID が設定されていません')
  return id
}

/** ビルド時に入った値。入っていなければスクリプト プロパティ（key）の値 */
function setting_(value, key) {
  return value || PropertiesService.getScriptProperties().getProperty(key) || ''
}

/** 最初に1回だけ実行して、スプレッドシートを読む権限を承認する */
function authorize() {
  Logger.log('読み込めました：' + SpreadsheetApp.openById(sheetId_()).getName())
}

/**
 * PDF の控えの窓口を加えたあと、デプロイしてから、エディタで1回だけ実行して承認する
 * （スプレッドシート・ドライブ・外部への接続の権限をまとめて。authorize の代わりにもなる）。
 * 「PDF の控えを置くフォルダ：（フォルダの名前）」と出れば、準備できている
 */
function authorizePdfCopy() {
  authorize()
  // 外部への接続（ログインの確かめに使う）の権限を承認するため、1回つないでみる（答えは使わない）
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=authorize-check', { muteHttpExceptions: true })
  const folderId = setting_(PDF_FOLDER_ID, 'PDF_FOLDER_ID')
  if (!folderId) {
    Logger.log('PDF の控えを置くフォルダは未設定です（gas/pdf-folder.local.json に書いて配り直すか、スクリプト プロパティ PDF_FOLDER_ID に入れる）')
    return
  }
  const folder = Drive.Files.get(folderId, { fields: 'id,name,mimeType', supportsAllDrives: true })
  if (folder.mimeType !== FOLDER_MIME) throw new Error('PDF_FOLDER_ID がフォルダではありません')
  Logger.log('PDF の控えを置くフォルダ：' + folder.name)
}

function doGet(e) {
  const year = e && e.parameter ? e.parameter.year : undefined
  let body
  try {
    // 年度の指定は、西暦4桁の数字だけ（それ以外は、シートも控えも読まずに断る）
    body = year !== undefined && !/^\d{4}$/.test(String(year)) ? { ok: false, error: '年度の指定が正しくありません' } : readConfig_(year)
  } catch (err) {
    body = { ok: false, error: String(err && err.message ? err.message : err) }
  }
  return json_(body)
}

function json_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON)
}

function readConfig_(year) {
  const cache = CacheService.getScriptCache()
  const key = 'config:' + (year || 'published')
  const cached = cache.get(key)
  if (cached) return JSON.parse(cached)

  const rows = SpreadsheetApp.openById(sheetId_()).getSheetByName('年度設定').getDataRange().getValues().slice(1)
  const row = year ? rows.find((r) => String(r[0]) === String(year) && r[1] !== '準備中') : rows.find((r) => r[1] === '公開中')
  const body = row ? bodyOf_(row) : { ok: false, error: '公開中の年度設定がありません' }
  // 学生が一斉に開いても負担にならないよう、1分だけ控えておく（管理ページで公開した内容は1分以内に反映される）。
  // 行が壊れているときの返事も控える（学生のツールは、前に読み込んだ設定か同梱の初期値で動く）
  cache.put(key, JSON.stringify(body), 60)
  return body
}

/** 年度設定の行から返事を作る。設定の JSON が書き損じで読めなければ ok: false（更新日時が読めないだけなら、設定は返す） */
function bodyOf_(row) {
  let config = null
  try {
    config = JSON.parse(row[2])
  } catch (e) {
    config = null
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) return { ok: false, error: Number(row[0]) + '年度の設定が壊れていて読めません。管理者に知らせてください' }
  const date = new Date(row[3])
  return { ok: true, year: Number(row[0]), config: config, updatedAt: isNaN(date.getTime()) ? null : date.toISOString() }
}

// ---- 書き出した PDF の控え（doPost） ----

/**
 * 学生のツールから届く（JSON を text/plain で送る。ブラウザの事前の問い合わせが要らない形）：
 * { action: 'pdfCopy', token, year, courseId, studentId, name, pdf（base64） }
 * 答え：{ ok: true } ／ { ok: false, error }（学生の画面には出さない。ツールは開発ツールのコンソールにだけ書く）
 */
function doPost(e) {
  let body
  try {
    const request = parseRequest_(e)
    if (request.tooLarge) body = { ok: false, error: 'PDF が大きすぎます（40MB まで）' }
    else if (request.action === 'pdfCopy') body = pdfCopy_(request)
    else body = { ok: false, error: '知らない操作です' }
  } catch (err) {
    // ドライブなどの思いがけないエラー：くわしいこと（フォルダの ID など）は返さず、ここの記録にだけ残す
    console.error('PDF の控えを保存できませんでした：' + String(err && err.message ? err.message : err))
    body = { ok: false, error: 'PDF の控えを保存できませんでした（ドライブのエラー）' }
  }
  if (!body.ok) console.warn('PDF の控え：' + body.error)
  return json_(body)
}

/** 届いた中身（JSON）。読めなければ空。大きすぎれば、読まずに tooLarge */
function parseRequest_(e) {
  const text = e && e.postData ? String(e.postData.contents || '') : ''
  if (text.length > PDF_MAX_BASE64 + 100000) return { tooLarge: true }
  try {
    const request = JSON.parse(text)
    return request && typeof request === 'object' && !Array.isArray(request) ? request : {}
  } catch (err) {
    return {}
  }
}

/** PDF の控えを置く。断るときは { ok: false, error }（ドライブなどの思いがけないエラーは投げる） */
function pdfCopy_(request) {
  const folderId = setting_(PDF_FOLDER_ID, 'PDF_FOLDER_ID')
  if (!folderId) return { ok: false, error: 'PDF の控えを置くフォルダが未設定' }
  const clientId = setting_(CLIENT_ID, 'GOOGLE_CLIENT_ID')
  const domain = setting_(DOMAIN, 'GOOGLE_DOMAIN').toLowerCase()
  if (!clientId || !domain) return { ok: false, error: 'ログインを確かめる設定（クライアント ID・ドメイン）が未設定' }

  // 形を確かめる（文字の長さにも上限を付ける）
  const text = (value, max) => (value === undefined || value === null ? '' : typeof value === 'string' && value.length <= max ? value : null)
  const token = text(request.token, 4096)
  const year = String(request.year)
  const courseId = text(request.courseId, 100)
  const studentId = text(request.studentId, 40)
  const name = text(request.name, 100)
  const pdf = request.pdf
  if (!token || !/^\d{4}$/.test(year) || courseId === null || studentId === null || name === null || typeof pdf !== 'string') {
    return { ok: false, error: '送られた内容の形が正しくありません' }
  }
  if (pdf.length > PDF_MAX_BASE64) return { ok: false, error: 'PDF が大きすぎます（40MB まで）' }
  // 中身が PDF か（base64 の文字だけで、先頭が %PDF。先頭だけ読んで、Google に確かめる前に断る）
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(pdf) || !isPdf_(decode_(pdf.slice(0, 8)))) return { ok: false, error: '送られたファイルが PDF ではありません' }

  // 送った人（ログインの許可を Google に確かめる）
  const sender = verifySender_(token, clientId, domain)
  if (!sender.ok) return sender
  const email = sender.email

  // 学生のアカウントなら、表紙の学籍番号と同じであること（教職員のアカウントは、見本の原稿で試せるように通す）
  const yearConfig = readConfig_(year)
  const config = yearConfig && yearConfig.ok ? yearConfig.config : null
  const accountId = studentIdOf_(email, config ? config.studentIdPattern : null)
  const coverId = studentId.trim().toUpperCase()
  if (accountId && coverId && coverId !== accountId) return { ok: false, error: '表紙の学籍番号が、ログインしたアカウントと違います' }

  // 中身の全体を読む
  const bytes = decode_(pdf)
  if (!isPdf_(bytes)) return { ok: false, error: '送られたファイルが PDF ではありません' }
  if (bytes.length > PDF_MAX_BYTES) return { ok: false, error: 'PDF が大きすぎます（40MB まで）' }

  const courses = config && Array.isArray(config.courses) ? config.courses : []
  const course = courseId ? courses.find((c) => c && c.id === courseId) : null
  const courseName = cleanName_(course && course.name, 80) || 'コース未設定'
  // 教職員のアカウント（学籍番号の形でない）は「試し_」を付ける（学生のファイルと見分けられるように）
  const fileName = pdfFileName_(accountId || coverId, name, config && config.reportName, !accountId)
  // 学生ごとに1つのファイル（年度と学籍番号。教職員はアドレスごと。学生のファイルを上書きしないように）
  const key = year + ':' + (accountId || 'staff:' + email)
  const description = '卒業制作報告書ツールから送られた PDF\n送った人：' + email + '\n送った日時：' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm')
  savePdf_(folderId, courseName, fileName, key, Utilities.newBlob(bytes, 'application/pdf', fileName), description)
  return { ok: true }
}

/**
 * ログインの許可（アクセストークン）を Google に確かめる：このツールの OAuth クライアントのもので、
 * アドレスが確かめ済みの、大学のアカウントであること。トークンは確かめに使うだけで、保存も記録もしない
 */
function verifySender_(token, clientId, domain) {
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token), { muteHttpExceptions: true })
  if (res.getResponseCode() !== 200) return { ok: false, error: 'ログインを確かめられませんでした（期限切れなど）' }
  let info = null
  try {
    info = JSON.parse(res.getContentText())
  } catch (err) {
    info = null
  }
  if (!info || typeof info !== 'object') return { ok: false, error: 'ログインを確かめられませんでした' }
  if (info.aud !== clientId || (info.azp !== undefined && info.azp !== clientId)) return { ok: false, error: 'このツールのログインではありません' }
  if (info.expires_in !== undefined && !(Number(info.expires_in) > 0)) return { ok: false, error: 'ログインの期限が切れています' }
  if (String(info.email_verified) !== 'true') return { ok: false, error: 'アドレスが確かめられていないアカウントです' }
  const email = String(info.email || '').toLowerCase()
  if (!email || email.slice(-(domain.length + 1)) !== '@' + domain) return { ok: false, error: '大学のアカウントではありません' }
  return { ok: true, email: email }
}

/** base64 の文字を読む（読めなければ null） */
function decode_(base64) {
  try {
    return Utilities.base64Decode(base64)
  } catch (err) {
    return null
  }
}

/** PDF の先頭（%PDF）か */
function isPdf_(bytes) {
  return !!bytes && bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46
}

/** 学生のアドレス（wu学籍番号@…）なら、@ より前を大文字にした学籍番号（先頭の WU は除く）。学籍番号の形でなければ（教職員のアカウント）null（src/model/account.ts と同じ） */
function studentIdOf_(email, pattern) {
  const local = String(email || '').split('@')[0].trim().toUpperCase()
  if (!local) return null
  let re = DEFAULT_STUDENT_ID
  try {
    if (pattern) re = new RegExp(pattern)
  } catch (err) {
    re = DEFAULT_STUDENT_ID
  }
  const withoutWu = local.replace(/^WU/, '')
  if (withoutWu !== local && re.test(withoutWu)) return withoutWu
  return re.test(local) ? local : null
}

/** ファイル名・フォルダ名に使えない文字（/ \ : * ? " < > | と制御文字）を除き、長さを切る */
function cleanName_(value, max) {
  // 制御文字も除く（わざと入れている）
  // oxlint-disable-next-line no-control-regex
  const unusable = /[\u0000-\u001f\u007f\\/:*?"<>|]/g
  return String(value || '')
    .replace(unusable, '')
    .trim()
    .slice(0, max)
}

/**
 * 控えのファイル名：提出の決まり「学籍番号_氏名.pdf」（例：00ZZ0123_文化花子.pdf。学生用ツールの src/model/fileName.ts の submissionTitle と同じ形）。
 * 氏名の空白は詰める。空の部分は付けない。両方とも空なら、報告書の名前（年度の設定の reportName。読めなければ「卒業制作報告書」）。
 * staff：教職員が試しに送った控え。学生のファイルと見分けられるよう、頭に「試し_」を付ける（例：試し_00ZZ0123_見本花子.pdf）
 */
function pdfFileName_(studentId, name, reportName, staff) {
  const title = [cleanName_(studentId, 40), cleanName_(String(name || '').replace(/[\s　]/g, ''), 50)].filter(Boolean).join('_') || cleanName_(reportName, 80) || '卒業制作報告書'
  return (staff ? '試し_' : '') + title + '.pdf'
}

/** ドライブの検索の条件に入れる文字（' と \ をエスケープする） */
function q_(value) {
  return "'" + String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"
}

function listFiles_(q) {
  const res = Drive.Files.list({ q: q, fields: 'files(id,name,parents)', pageSize: 100, supportsAllDrives: true, includeItemsFromAllDrives: true })
  return (res && res.files) || []
}

/** フォルダ（rootId）の中の、コースのフォルダ（なければ作る） */
function courseFolder_(rootId, name) {
  const find = () => listFiles_('name = ' + q_(name) + ' and ' + q_(rootId) + ' in parents and mimeType = ' + q_(FOLDER_MIME) + ' and trashed = false')[0]
  const found = find()
  if (found) return found.id
  // 同じコースの学生が同時に送っても、同じ名前のフォルダが2つできないよう、鍵をかけてから確かめ直して作る
  const lock = LockService.getScriptLock()
  lock.waitLock(20000)
  try {
    const again = find()
    if (again) return again.id
    return Drive.Files.create({ name: name, mimeType: FOLDER_MIME, parents: [rootId] }, null, { supportsAllDrives: true, fields: 'id' }).id
  } finally {
    lock.releaseLock()
  }
}

/**
 * 控えを置く。前に送ったこの学生のファイル（印 reportKey。どのコースのフォルダにあっても。なければ同じ名前のファイル）があれば、
 * その中身を新しい版にする（ドライブが前の版を残す。名前・置き場所も今のものにする）。なければ、コースのフォルダに作る
 */
function savePdf_(rootId, courseName, fileName, key, blob, description) {
  const root = Drive.Files.get(rootId, { fields: 'id,mimeType,trashed', supportsAllDrives: true })
  if (!root || root.mimeType !== FOLDER_MIME || root.trashed) throw new Error('PDF の控えを置くフォルダが見つかりません')
  const courseId = courseFolder_(rootId, courseName)
  const folders = listFiles_(q_(rootId) + ' in parents and mimeType = ' + q_(FOLDER_MIME) + ' and trashed = false').map((f) => f.id)
  if (folders.indexOf(courseId) < 0) folders.push(courseId)
  const inFolders = '(' + folders.map((id) => q_(id) + ' in parents').join(' or ') + ')'
  const file =
    listFiles_(inFolders + ' and appProperties has { key=' + q_('reportKey') + ' and value=' + q_(key) + ' } and trashed = false')[0] ||
    listFiles_('name = ' + q_(fileName) + ' and ' + q_(courseId) + ' in parents and trashed = false')[0] ||
    null
  const resource = { name: fileName, description: description, appProperties: { reportKey: key } }
  if (file) {
    const options = { supportsAllDrives: true, fields: 'id' }
    const parents = file.parents || []
    if (parents.indexOf(courseId) < 0) {
      options.addParents = courseId
      if (parents.length) options.removeParents = parents.join(',')
    }
    Drive.Files.update(resource, file.id, blob, options)
  } else {
    resource.parents = [courseId]
    resource.mimeType = 'application/pdf'
    Drive.Files.create(resource, blob, { supportsAllDrives: true, fields: 'id' })
  }
}
