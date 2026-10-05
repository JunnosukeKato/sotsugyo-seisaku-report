/**
 * 卒業制作報告書 作成ツール：管理ページ（Google Apps Script。スプレッドシートに付属させる）
 *
 * スプレッドシートの3つのシート
 *   年度設定 … 年度 | 状態（公開中・準備中・終了）| 設定（JSON）| 更新日時 | 更新者
 *   変更履歴 … 日時 | 更新者 | 年度 | 操作 | 設定（JSON）
 *   管理者   … メールアドレス | メモ
 *
 * ウェブアプリとして公開する（実行するユーザー：自分、アクセス：大学のドメイン内）。
 * 管理ページから保存・公開できるのは「管理者」シートに載っている人だけ。
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
  const admins = ensure(SHEET_ADMINS, ['メールアドレス', 'メモ'])
  const me = Session.getActiveUser().getEmail()
  if (me && !readAdmins_().includes(me.toLowerCase())) admins.appendRow([me, '初期設定で登録'])
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
  const admin = isAdmin_(user)
  return { user: user, isAdmin: admin, years: admin ? readYears_() : [] }
}

function saveYear(config) {
  const user = requireAdmin_()
  checkConfig_(config)
  return withLock_(() => {
    const sheet = sheet_(SHEET_YEARS)
    const rowIndex = findYearRow_(config.fiscalYear)
    if (rowIndex > 0) {
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
  requireAdmin_()
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

function readAdmins_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_ADMINS)
  if (!sheet) return []
  return sheet
    .getDataRange()
    .getValues()
    .slice(1)
    .map((r) => String(r[0]).trim().toLowerCase())
    .filter(Boolean)
}

function isAdmin_(email) {
  return !!email && readAdmins_().includes(email.toLowerCase())
}

function requireAdmin_() {
  const user = Session.getActiveUser().getEmail()
  if (!isAdmin_(user)) throw new Error('管理者だけが変更できます（ログイン中：' + (user || '不明') + '）')
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
