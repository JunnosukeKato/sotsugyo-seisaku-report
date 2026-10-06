/**
 * 卒業制作報告書 作成ツール：管理ページ（Google Apps Script。スプレッドシートに付属させる）
 *
 * スプレッドシートの3つのシート
 *   年度設定 … 年度 | 状態（公開中・準備中・終了）| 設定（JSON）| 更新日時 | 更新者
 *   変更履歴 … 日時 | 更新者 | 年度 | 操作 | 設定（JSON）
 *   管理者   … メールアドレス | メモ | 役割（管理者・先生。空なら管理者）
 *
 * ウェブアプリとして公開する（実行するユーザー：自分、アクセス：大学のドメイン内）。
 * 「管理者」シートに載っている人だけが使える。
 *   管理者 … 年度の設定をすべて変更・公開できる。先生を登録できる
 *   先生   … どのコースの「下書きのひな形」も編集できる（ほかの設定は変えられない）
 * 学生のツールへの配信は、別のプロジェクト（gas/api-project）が担う。
 *
 * このファイルは app/gas/admin-project/Code.js が元。scripts/build-gas.mjs で初期値を埋め込んで gas-dist に出力する。
 */

const SHEET_YEARS = '年度設定'
const SHEET_HISTORY = '変更履歴'
const SHEET_ADMINS = '管理者'
const STATUS_PUBLISHED = '公開中'
const STATUS_DRAFT = '準備中'
const STATUS_ENDED = '終了'
const ROLE_ADMIN = '管理者'
const ROLE_TEACHER = '先生'

/** 初期値（2026年度）。ビルド時に app/src/config/2026.json の内容が入る */
const INITIAL_CONFIG = /*INITIAL_CONFIG*/ null

function doGet() {
  return HtmlService.createHtmlOutputFromFile('admin')
    .setTitle('卒業制作報告書 管理ページ')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
}

/**
 * 最初に1回だけ、Apps Script の画面から実行する。
 * シートを作り、実行した人を管理者に登録し、初期値の年度設定を「公開中」で入れる。
 */
function setup() {
  // すでに管理者がいるときは、管理者だけが実行できる（管理ページから呼ばれて、誰でも管理者になれてしまわないように）
  if (readMembers_().some((m) => m.role === ROLE_ADMIN)) requireAdmin_()
  const ss = SpreadsheetApp.getActiveSpreadsheet()
  const ensure = (name, header) => {
    let sheet = ss.getSheetByName(name)
    if (!sheet) sheet = ss.insertSheet(name)
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(header)
      sheet.setFrozenRows(1)
      sheet.getRange(1, 1, 1, header.length).setFontWeight('bold')
    }
    return sheet
  }
  const years = ensure(SHEET_YEARS, ['年度', '状態', '設定（JSON）', '更新日時', '更新者'])
  ensure(SHEET_HISTORY, ['日時', '更新者', '年度', '操作', '設定（JSON）'])
  const admins = ensure(SHEET_ADMINS, ['メールアドレス', 'メモ', '役割'])
  // 役割の列がない古いシートには、見出しを足す
  if (!admins.getRange(1, 3).getValue()) admins.getRange(1, 3).setValue('役割')
  const me = Session.getActiveUser().getEmail()
  if (me && !roleOf_(me)) admins.appendRow([me, '初期設定で登録', ROLE_ADMIN])
  if (years.getLastRow() < 2 && INITIAL_CONFIG) {
    years.appendRow([INITIAL_CONFIG.fiscalYear, STATUS_PUBLISHED, JSON.stringify(INITIAL_CONFIG), new Date(), me])
    appendHistory_(me, INITIAL_CONFIG.fiscalYear, '初期設定', INITIAL_CONFIG)
  }
  const defaultSheet = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1')
  if (defaultSheet && defaultSheet.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(defaultSheet)
  // 配信用のプロジェクトがこのスプレッドシートを読めるよう、ID を表示する
  Logger.log('スプレッドシートの ID: ' + ss.getId())
}

// ---- 管理ページから呼ぶ関数（google.script.run） ----

function getState() {
  const user = Session.getActiveUser().getEmail()
  const role = roleOf_(user)
  return { user: user, isAdmin: role === ROLE_ADMIN, role: role === ROLE_ADMIN ? 'admin' : role === ROLE_TEACHER ? 'teacher' : null, years: role ? readYears_() : [] }
}

/**
 * 下書きのひな形だけを保存する（先生も使える）。templates は { コースID: { template, abstractExample } }。
 * 年度の設定のうち、指定したコースのひな形と抄録の書き出し例だけを書き換え、ほかは変えない。
 */
function saveTemplates(year, templates) {
  const user = requireTeacher_()
  if (!templates || typeof templates !== 'object') throw new Error('ひな形の形が正しくありません')
  return editYear_(year, user, (config) => '下書きのひな形を保存（' + applyTemplates_(config, templates).join('・') + '）')
}

/**
 * コースのお知らせだけを保存する（先生も使える）。notices は { コースID: お知らせ }。
 * 指定したコースのお知らせだけを書き換え、ほかは変えない
 */
function saveNotices(year, notices) {
  const user = requireTeacher_()
  if (!notices || typeof notices !== 'object') throw new Error('お知らせの形が正しくありません')
  return editYear_(year, user, (config) => 'お知らせを保存（' + applyNotices_(config, notices).join('・') + '）')
}

/**
 * 書き間違えやすい語の一覧だけを保存する（先生も使える）。words は [{ wrong, right, note, severity }]。
 * 書き間違いか正しい語が空の行、2つが同じ行は捨てる。
 */
function saveWordChecks(year, words) {
  const user = requireTeacher_()
  if (!Array.isArray(words)) throw new Error('書き間違えやすい語の形が正しくありません')
  return editYear_(year, user, (config) => {
    config.wordChecks = cleanWords_(words)
    return '書き間違えやすい語を保存（' + config.wordChecks.length + '語）'
  })
}

/**
 * 先生の画面の「保存」：ひな形・お知らせ・書き間違えやすい語を、まとめて1回で保存する（先生も使える）。
 * 別々に送ると、途中で失敗したときに一部だけが保存されるため。edits は { templates?, notices?, words? }
 */
function saveTeacherEdits(year, edits) {
  const user = requireTeacher_()
  if (!edits || typeof edits !== 'object') throw new Error('保存する内容の形が正しくありません')
  return editYear_(year, user, (config) => {
    const done = []
    if (edits.templates && typeof edits.templates === 'object' && Object.keys(edits.templates).length) {
      done.push('下書きのひな形を保存（' + applyTemplates_(config, edits.templates).join('・') + '）')
    }
    if (edits.notices && typeof edits.notices === 'object' && Object.keys(edits.notices).length) {
      done.push('お知らせを保存（' + applyNotices_(config, edits.notices).join('・') + '）')
    }
    if (Array.isArray(edits.words)) {
      config.wordChecks = cleanWords_(edits.words)
      done.push('書き間違えやすい語を保存（' + config.wordChecks.length + '語）')
    }
    return done.join('・') || '保存（変更なし）'
  })
}

/** 年度の設定を読み、fn で書き換えて保存し、変更履歴に残す（fn は履歴に残す操作の名前を返す） */
function editYear_(year, user, fn) {
  return withLock_(() => {
    const sheet = sheet_(SHEET_YEARS)
    const rowIndex = findYearRow_(year)
    if (rowIndex < 0) throw new Error(year + '年度の設定がありません')
    const config = JSON.parse(sheet.getRange(rowIndex, 3).getValue())
    const action = fn(config)
    checkConfig_(config)
    sheet.getRange(rowIndex, 3, 1, 3).setValues([[JSON.stringify(config), new Date(), user]])
    appendHistory_(user, year, action, config)
    return getState()
  })
}

/** 指定したコースのひな形と抄録の書き出し例を書き換える。書き換えたコースの名前を返す */
function applyTemplates_(config, templates) {
  const names = []
  config.courses.forEach((course) => {
    const t = templates[course.id]
    if (!t) return
    if (!Array.isArray(t.template)) throw new Error('「' + course.name + '」のひな形の形が正しくありません')
    course.template = t.template
    course.abstractExample = typeof t.abstractExample === 'string' ? t.abstractExample : ''
    names.push(course.name)
  })
  return names
}

/** 指定したコースのお知らせを書き換える。書き換えたコースの名前を返す */
function applyNotices_(config, notices) {
  const names = []
  config.courses.forEach((course) => {
    if (!Object.prototype.hasOwnProperty.call(notices, course.id)) return
    course.notice = String(notices[course.id] || '')
    names.push(course.name)
  })
  return names
}

/** 書き間違えやすい語の一覧を整える（書き間違いか正しい語が空の行、2つが同じ行は捨てる） */
function cleanWords_(words) {
  return words
    .map((w) => ({
      wrong: String((w && w.wrong) || '').trim(),
      right: String((w && w.right) || '').trim(),
      note: String((w && w.note) || '').trim(),
      severity: w && w.severity === 'warning' ? 'warning' : 'error',
    }))
    .filter((w) => w.wrong && w.right && w.wrong !== w.right)
}

/** 管理者と先生の一覧（管理者だけ） */
function getMembers() {
  requireAdmin_()
  return readMembers_()
}

/** 管理者・先生を登録する（管理者だけ）。すでに登録されていれば、役割とメモを書き換える */
function addMember(email, role, memo) {
  const user = requireAdmin_()
  const address = String(email || '').trim()
  if (!/^[^@\s]+@[^@\s]+$/.test(address)) throw new Error('メールアドレスが正しくありません')
  if (role !== ROLE_ADMIN && role !== ROLE_TEACHER) throw new Error('役割が正しくありません')
  return withLock_(() => {
    const sheet = sheet_(SHEET_ADMINS)
    const values = sheet.getDataRange().getValues()
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][0]).trim().toLowerCase() === address.toLowerCase()) {
        if (address.toLowerCase() === user.toLowerCase() && role !== ROLE_ADMIN) throw new Error('自分を管理者から外すことはできません')
        sheet.getRange(i + 1, 2, 1, 2).setValues([[memo || values[i][1] || '', role]])
        return readMembers_()
      }
    }
    sheet.appendRow([address, memo || '', role])
    return readMembers_()
  })
}

/**
 * まとめて登録する（管理者だけ）。entries は [{ email, memo }]。すでに登録されている人は、そのままにする（役割もメモも変えない）
 */
function addMembers(entries, role) {
  requireAdmin_()
  if (!Array.isArray(entries)) throw new Error('登録する人の形が正しくありません')
  if (role !== ROLE_ADMIN && role !== ROLE_TEACHER) throw new Error('役割が正しくありません')
  const list = entries
    .map((e) => ({ email: String((e && e.email) || '').trim(), memo: String((e && e.memo) || '').trim() }))
    .filter((e) => /^[^@\s]+@[^@\s]+$/.test(e.email))
  return withLock_(() => {
    const sheet = sheet_(SHEET_ADMINS)
    const known = sheet
      .getDataRange()
      .getValues()
      .slice(1)
      .map((r) => String(r[0]).trim().toLowerCase())
    list.forEach((e) => {
      if (known.indexOf(e.email.toLowerCase()) >= 0) return
      sheet.appendRow([e.email, e.memo, role])
      known.push(e.email.toLowerCase())
    })
    return readMembers_()
  })
}

/** 管理者・先生の登録を外す（管理者だけ。自分は外せない） */
function removeMember(email) {
  const user = requireAdmin_()
  const address = String(email || '').trim().toLowerCase()
  if (address === user.toLowerCase()) throw new Error('自分の登録は外せません')
  return withLock_(() => {
    const sheet = sheet_(SHEET_ADMINS)
    const values = sheet.getDataRange().getValues()
    for (let i = values.length - 1; i >= 1; i--) {
      if (String(values[i][0]).trim().toLowerCase() === address) sheet.deleteRow(i + 1)
    }
    return readMembers_()
  })
}

/**
 * 年度の設定を丸ごと保存する（管理者だけ）。
 * expectedUpdatedAt は、画面を開いたときの更新日時。そのあとにほかの人（先生など）が保存していたら、
 * 丸ごと書き戻すとその変更が消えるので、保存せずに知らせる
 */
function saveYear(config, expectedUpdatedAt) {
  const user = requireAdmin_()
  checkConfig_(config)
  return withLock_(() => {
    const sheet = sheet_(SHEET_YEARS)
    const rowIndex = findYearRow_(config.fiscalYear)
    if (rowIndex > 0) {
      if (expectedUpdatedAt) {
        const [updatedAt, updatedBy] = sheet.getRange(rowIndex, 4, 1, 2).getValues()[0]
        if (new Date(updatedAt).toISOString() !== expectedUpdatedAt) {
          throw new Error(
            'この画面を開いたあとに、ほかの人（' + updatedBy + '）がこの年度の設定を保存しました。そのまま保存すると、その変更が消えてしまうため、保存しませんでした。ページを読み込み直してから、もう一度変更してください',
          )
        }
      }
      sheet.getRange(rowIndex, 3, 1, 3).setValues([[JSON.stringify(config), new Date(), user]])
    } else {
      sheet.appendRow([config.fiscalYear, STATUS_DRAFT, JSON.stringify(config), new Date(), user])
    }
    appendHistory_(user, config.fiscalYear, '保存', config)
    return getState()
  })
}

function publishYear(year) {
  const user = requireAdmin_()
  return withLock_(() => {
    const sheet = sheet_(SHEET_YEARS)
    const rowIndex = findYearRow_(year)
    if (rowIndex < 0) throw new Error(year + '年度の設定がありません')
    const values = sheet.getDataRange().getValues()
    for (let i = 1; i < values.length; i++) {
      if (Number(values[i][0]) === Number(year)) sheet.getRange(i + 1, 2).setValue(STATUS_PUBLISHED)
      else if (values[i][1] === STATUS_PUBLISHED) sheet.getRange(i + 1, 2).setValue(STATUS_ENDED)
    }
    const config = JSON.parse(sheet.getRange(rowIndex, 3).getValue())
    appendHistory_(user, year, '公開', config)
    return getState()
  })
}

function createYear(fromYear, newYear) {
  const user = requireAdmin_()
  return withLock_(() => {
    if (findYearRow_(newYear) > 0) throw new Error(newYear + '年度はすでにあります')
    const fromIndex = findYearRow_(fromYear)
    if (fromIndex < 0) throw new Error(fromYear + '年度の設定がありません')
    const config = JSON.parse(sheet_(SHEET_YEARS).getRange(fromIndex, 3).getValue())
    config.fiscalYear = Number(newYear)
    sheet_(SHEET_YEARS).appendRow([Number(newYear), STATUS_DRAFT, JSON.stringify(config), new Date(), user])
    appendHistory_(user, newYear, fromYear + '年度からコピーして作成', config)
    return getState()
  })
}

function getHistory(year) {
  requireTeacher_()
  const values = sheet_(SHEET_HISTORY).getDataRange().getValues().slice(1)
  return values
    .filter((r) => Number(r[2]) === Number(year))
    .reverse()
    .slice(0, 50)
    .map((r) => ({ at: new Date(r[0]).toISOString(), user: r[1], year: Number(r[2]), action: r[3], config: JSON.parse(r[4]) }))
}

// ---- 内部の処理 ----

function sheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name)
  if (!sheet) throw new Error('シート「' + name + '」がありません。setup を実行してください')
  return sheet
}

function readYears_() {
  return sheet_(SHEET_YEARS)
    .getDataRange()
    .getValues()
    .slice(1)
    .filter((r) => r[0] !== '')
    .map((r) => ({ year: Number(r[0]), status: r[1], config: JSON.parse(r[2]), updatedAt: new Date(r[3]).toISOString(), updatedBy: r[4] }))
    .sort((a, b) => b.year - a.year)
}

function findYearRow_(year) {
  const values = sheet_(SHEET_YEARS).getDataRange().getValues()
  for (let i = 1; i < values.length; i++) if (Number(values[i][0]) === Number(year)) return i + 1
  return -1
}

/**
 * 管理者シートの一覧。役割は「管理者」「先生」のどちらか（役割の列がなかった頃の行＝空欄は管理者）。
 * それ以外（書き間違いなど）の行は、使えないようにする（間違って管理者にならないように）
 */
function readMembers_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ADMINS)
  if (!sheet) return []
  return sheet
    .getDataRange()
    .getValues()
    .slice(1)
    .map((r) => {
      const role = String(r[2] || '').trim()
      return { email: String(r[0]).trim(), memo: String(r[1] || ''), role: role === ROLE_TEACHER ? ROLE_TEACHER : role === ROLE_ADMIN || role === '' ? ROLE_ADMIN : null }
    })
    .filter((m) => m.email && m.role)
}

/** その人の役割（管理者・先生）。登録されていなければ null */
function roleOf_(email) {
  if (!email) return null
  const member = readMembers_().find((m) => m.email.toLowerCase() === email.toLowerCase())
  return member ? member.role : null
}

function requireAdmin_() {
  const user = Session.getActiveUser().getEmail()
  if (roleOf_(user) !== ROLE_ADMIN) throw new Error('管理者だけが変更できます（ログイン中：' + (user || '不明') + '）')
  return user
}

/** 管理者か先生 */
function requireTeacher_() {
  const user = Session.getActiveUser().getEmail()
  if (!roleOf_(user)) throw new Error('登録された先生だけが使えます（ログイン中：' + (user || '不明') + '）')
  return user
}

function appendHistory_(user, year, action, config) {
  sheet_(SHEET_HISTORY).appendRow([new Date(), user, Number(year), action, JSON.stringify(config)])
}

/** 最低限の形の確認（細かい確認は管理ページの画面で行う） */
function checkConfig_(config) {
  if (!config || typeof config !== 'object') throw new Error('設定の形が正しくありません')
  if (!Number.isInteger(config.fiscalYear)) throw new Error('年度が正しくありません')
  if (!Array.isArray(config.courses)) throw new Error('コースの一覧がありません')
  if (JSON.stringify(config).length > 45000) throw new Error('設定が大きすぎます')
}

function withLock_(fn) {
  const lock = LockService.getScriptLock()
  lock.waitLock(20000)
  try {
    return fn()
  } finally {
    lock.releaseLock()
  }
}
