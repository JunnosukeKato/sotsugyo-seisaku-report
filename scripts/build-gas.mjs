// Apps Script に載せるファイルを gas-dist/ に作る。
//   gas-dist/admin-project … 管理ページ（スプレッドシートに付属）: Code.js（初期値入り）, admin.html, appsscript.json
//   gas-dist/api-project   … 学生のツールへの配信: Code.js, appsscript.json
// 使い方: node scripts/build-gas.mjs
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'

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
writeFileSync('gas-dist/api-project/Code.js', readFileSync('gas/api-project/Code.js', 'utf8').replace("/*SHEET_ID*/ ''", JSON.stringify(sheetId)))

rmSync('gas-dist/admin-project/admin.html', { force: true })
renameSync('gas-dist/admin-build/admin.html', 'gas-dist/admin-project/admin.html')
rmSync('gas-dist/admin-build', { recursive: true, force: true })

const size = (f) => `${Math.round(statSync(f).size / 1024)}KB`
console.log(`\ngas-dist/admin-project: Code.js ${size('gas-dist/admin-project/Code.js')}, admin.html ${size('gas-dist/admin-project/admin.html')}`)
console.log(`gas-dist/api-project: Code.js ${size('gas-dist/api-project/Code.js')}`)
