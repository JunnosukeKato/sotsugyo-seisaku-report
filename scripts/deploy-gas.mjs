// Apps Script の2つのプロジェクトを更新する：ビルド → 送信（clasp push）→ 公開中のウェブアプリを新しい版に更新。
// ウェブアプリの URL は変わらない（gas/deployments.json のデプロイ ID を使う）。
// 使い方: node scripts/deploy-gas.mjs（先に npx clasp login を済ませておく）
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const deployments = JSON.parse(readFileSync('gas/deployments.json', 'utf8'))
const windows = process.platform === 'win32'
const clasp = resolve(windows ? 'node_modules/.bin/clasp.cmd' : 'node_modules/.bin/clasp')
// Windows の .cmd は shell 経由で動かす（引数に空白を含めない）
const run = (args, cwd) => execFileSync(clasp, args, { cwd, stdio: 'inherit', shell: windows })

execFileSync(process.execPath, ['scripts/build-gas.mjs'], { stdio: 'inherit' })
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
for (const [key, project] of [
  ['admin', 'admin-project'],
  ['api', 'api-project'],
]) {
  console.log(`\n=== ${deployments[key].title}`)
  run(['push', '--force'], `gas-dist/${project}`)
  run(['update-deployment', deployments[key].deploymentId, '--description', `update-${stamp}`], `gas-dist/${project}`)
}
console.log(`\n管理ページ: ${deployments.admin.url}\n配信: ${deployments.api.url}`)
