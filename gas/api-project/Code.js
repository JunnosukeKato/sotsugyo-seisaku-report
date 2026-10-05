/**
 * 卒業制作報告書 作成ツール：年度設定の配信（Google Apps Script。単独のプロジェクト）
 *
 * 学生のツールが起動時に「公開中の年度設定」を読み込むための窓口。
 * ウェブアプリとして公開する（実行するユーザー：自分、アクセス：全員）。
 * 返すのは公開中（または終了した年度）の設定だけで、準備中の年度や学生のデータは扱わない。
 *
 * 管理用スプレッドシートの ID は、ビルド時（scripts/build-gas.mjs）に SHEET_ID へ入る。
 * 入っていなければ「プロジェクトの設定 → スクリプト プロパティ」の SHEET_ID を使う。
 * 最初に1回だけ authorize を実行して、スプレッドシートを読む権限を承認する。
 * このファイルは app/gas/api-project/Code.js が元。
 */

const SHEET_ID = /*SHEET_ID*/ ''

function sheetId_() {
  const id = SHEET_ID || PropertiesService.getScriptProperties().getProperty('SHEET_ID')
  if (!id) throw new Error('SHEET_ID が設定されていません')
  return id
}

/** 最初に1回だけ実行して、スプレッドシートを読む権限を承認する */
function authorize() {
  Logger.log('読み込めました：' + SpreadsheetApp.openById(sheetId_()).getName())
}

function doGet(e) {
  const year = e && e.parameter && e.parameter.year
  let body
  try {
    body = readConfig_(year)
  } catch (err) {
    body = { ok: false, error: String(err && err.message ? err.message : err) }
  }
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON)
}

function readConfig_(year) {
  const cache = CacheService.getScriptCache()
  const key = 'config:' + (year || 'published')
  const cached = cache.get(key)
  if (cached) return JSON.parse(cached)

  const rows = SpreadsheetApp.openById(sheetId_()).getSheetByName('年度設定').getDataRange().getValues().slice(1)
  const row = year ? rows.find((r) => String(r[0]) === String(year) && r[1] !== '準備中') : rows.find((r) => r[1] === '公開中')
  const body = row ? { ok: true, year: Number(row[0]), config: JSON.parse(row[2]), updatedAt: new Date(row[3]).toISOString() } : { ok: false, error: '公開中の年度設定がありません' }
  // 学生が一斉に開いても負担にならないよう、1分だけ控えておく（管理ページで公開した内容は1分以内に反映される）
  cache.put(key, JSON.stringify(body), 60)
  return body
}
