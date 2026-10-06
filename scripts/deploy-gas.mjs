// Apps Script の2つのプロジェクトを更新する：ビルド → 送信（clasp push）→ 公開中のウェブアプリを新しい版に更新。
// ウェブアプリの URL は変わらない（gas/deployments.json のデプロイ ID を使う）。
// 使い方: node scripts/deploy-gas.mjs（先に npx clasp login を済ませておく）
//
// 送る前に、次を確かめる（AGPL-3.0：動いているプログラムと、GitHub で公開しているソースコードを同じにするため）。
// どれかが違えば、理由を出して止める。
//   - コミットしていない変更・新しいファイルがない
//   - main ブランチにいる
//   - main が GitHub の main（origin/main）と同じ（送り忘れ・取り込み忘れがない）
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const stop = (reason) => {
  console.error(`\n送るのをやめました：${reason}`)
  process.exit(1)
}

if (git('status', '--porcelain')) stop('コミットしていない変更（または新しいファイル）があります。コミットして GitHub に送って（git push）から、もう一度実行してください（git status で確かめられます）')
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') stop('main ブランチではありません。git switch main で main に切り替えてから、もう一度実行してください')
try {
  // GitHub の最新の main を取ってくる（ほかの人が送った変更を、古いプログラムで上書きしないように）
  git('fetch', '--quiet', 'origin', 'main')
} catch {
  stop('GitHub（origin）から main を取ってこられませんでした。インターネットにつながっているか、GitHub にログインできるかを確かめてください')
}
const local = git('rev-parse', 'main')
const remote = git('rev-parse', 'origin/main')
if (local !== remote) {
  const ahead = git('rev-list', '--count', 'origin/main..main')
  const behind = git('rev-list', '--count', 'main..origin/main')
  stop(
    `main が GitHub の main（origin/main）と同じではありません（GitHub に送っていないコミット ${ahead} 件、取り込んでいないコミット ${behind} 件）。` +
      'git push（送っていないとき）または git pull（取り込んでいないとき）をしてから、もう一度実行してください',
  )
}

const deployments = JSON.parse(readFileSync('gas/deployments.json', 'utf8'))
const windows = process.platform === 'win32'
const clasp = resolve(windows ? 'node_modules/.bin/clasp.cmd' : 'node_modules/.bin/clasp')
// Windows の .cmd は shell 経由で動かす（引数に空白を含めない）
const run = (args, cwd) => execFileSync(clasp, args, { cwd, stdio: 'inherit', shell: windows })

execFileSync(process.execPath, ['scripts/build-gas.mjs'], { stdio: 'inherit' })
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
// 版の説明に、送ったコミットを残す（どのソースコードが動いているかを、Apps Script の「デプロイを管理」で確かめられる）
const commit = local.slice(0, 7)
for (const [key, project] of [
  ['admin', 'admin-project'],
  ['api', 'api-project'],
]) {
  console.log(`\n=== ${deployments[key].title}`)
  run(['push', '--force'], `gas-dist/${project}`)
  run(['update-deployment', deployments[key].deploymentId, '--description', `update-${stamp}-${commit}`], `gas-dist/${project}`)
}
console.log(`\n管理ページ: ${deployments.admin.url}\n配信: ${deployments.api.url}\n送ったコミット: ${local}`)
