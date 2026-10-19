// Apps Script に載せるファイルを gas-dist/ に作る。
//   gas-dist/admin-project … 管理ページ（スプレッドシートに付属）: Code.js（初期値入り）, admin.html, appsscript.json
//   gas-dist/api-project   … 学生のツールへの配信: Code.js, appsscript.json
// 使い方: node scripts/build-gas.mjs
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { loadEnv } from 'vite'

execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'vite.admin.config.ts'], { stdio: 'inherit' })

for (const project of ['admin-project', 'api-project']) {
  const out = `gas-dist/${project}`
  mkdirSync(out, { recursive: true })
  copyFileSync(`gas/${project}/appsscript.json`, `${out}/appsscript.json`)
  // clasp で送るときの設定（プロジェクトを作った後にできる）
  if (existsSync(`gas/${project}/.clasp.json`)) {
    const clasp = JSON.parse(readFileSync(`gas/${project}/.clasp.json`, 'utf8'))
    writeFileSync(`${out}/.clasp.json`, JSON.stringify({ ...clasp, rootDir: '.' }, null, 2))
  }
}

const initial = readFileSync('src/config/2026.json', 'utf8').trim()
const code = readFileSync('gas/admin-project/Code.js', 'utf8').replace('/*INITIAL_CONFIG*/ null', initial)
writeFileSync('gas-dist/admin-project/Code.js', code)
// 配信用のプロジェクトに、管理用スプレッドシートの ID を入れる（clasp で作ったときの .clasp.json の parentId）
const adminClasp = existsSync('gas/admin-project/.clasp.json') ? JSON.parse(readFileSync('gas/admin-project/.clasp.json', 'utf8')) : {}
// clasp の版によって、parentId は文字列のことも配列のこともある
const sheetId = (Array.isArray(adminClasp.parentId) ? adminClasp.parentId[0] : adminClasp.parentId) ?? ''
// 書き出した PDF の控えを置く、先生のドライブのフォルダ（git に入れないファイル gas/pdf-folder.local.json の folderId。なければ空 → スクリプト プロパティ）
const pdfFolder = existsSync('gas/pdf-folder.local.json') ? JSON.parse(readFileSync('gas/pdf-folder.local.json', 'utf8')) : {}
const pdfFolderId = typeof pdfFolder.folderId === 'string' ? pdfFolder.folderId.trim() : ''
if (pdfFolderId && !/^[\w-]+$/.test(pdfFolderId)) throw new Error('gas/pdf-folder.local.json の folderId の形が正しくありません')
// PDF の控えを送った人を確かめる：学生のツールのログインの登録（OAuth クライアント ID）と、大学のドメイン（学生用ツールと同じ .env の値）
const env = loadEnv('production', process.cwd(), 'VITE_')
const apiValues = { SHEET_ID: sheetId, PDF_FOLDER_ID: pdfFolderId, CLIENT_ID: env.VITE_GOOGLE_CLIENT_ID ?? '', DOMAIN: env.VITE_GOOGLE_DOMAIN || 'bunka-wu.ac.jp' }
let apiCode = readFileSync('gas/api-project/Code.js', 'utf8')
for (const [name, value] of Object.entries(apiValues)) {
  const mark = `/*${name}*/ ''`
  if (!apiCode.includes(mark)) throw new Error(`gas/api-project/Code.js に ${mark} がありません`)
  apiCode = apiCode.replace(mark, JSON.stringify(value))
}
writeFileSync('gas-dist/api-project/Code.js', apiCode)
console.log(`\n配信の窓口：PDF の控えのフォルダ ${pdfFolderId ? '設定あり（gas/pdf-folder.local.json）' : 'なし（スクリプト プロパティ PDF_FOLDER_ID を使う）'}・クライアント ID ${apiValues.CLIENT_ID ? 'あり' : 'なし'}・ドメイン ${apiValues.DOMAIN}`)

rmSync('gas-dist/admin-project/admin.html', { force: true })
renameSync('gas-dist/admin-build/admin.html', 'gas-dist/admin-project/admin.html')
rmSync('gas-dist/admin-build', { recursive: true, force: true })

const size = (f) => `${Math.round(statSync(f).size / 1024)}KB`
console.log(`\ngas-dist/admin-project: Code.js ${size('gas-dist/admin-project/Code.js')}, admin.html ${size('gas-dist/admin-project/admin.html')}`)
console.log(`gas-dist/api-project: Code.js ${size('gas-dist/api-project/Code.js')}`)
