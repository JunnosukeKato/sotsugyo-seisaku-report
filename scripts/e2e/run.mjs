// 自動テスト（e2e）を、自動テスト用にまとめた版で流す（開発サーバーより速い。依頼者の選択 2026-10-22 ④）。
// 開発サーバーは、ページを開くたびに部品を1つずつ変換して送るので、ページを何百回も開くテストでは待ち時間が長かった。
// まとめた版（vite build --mode e2e → dist-e2e）は、公開する版と同じくまとめてあり、テスト用の窓口（window.__editor など）だけ足してある。
//
// 使い方: node scripts/e2e/run.mjs smoke phone   … まとめて、手元のサーバー（http://localhost:4173）を立て、テストを流して止める
//         node scripts/e2e/run.mjs all           … smoke・phone・admin・drive・check・cellImage・askVersion・spreadTurn（公開の前に、まとめて1回）
//         node scripts/e2e/run.mjs phoneDirect   … scripts/e2e の中の、1つだけで動かせるテストも名前で流せる
//   --no-build：前にまとめた版をそのまま使う（テストの文だけを直したとき）
//   --dev：まとめずに、開発サーバー（http://localhost:5173。動かしておくこと）で流す（前のやり方）
//   --one：1つずつ流す（ふだんは2つずつ同時に流す。Edge は 9333 と 9334）
// テストの記録は、1つ上のフォルダの <名前>-run.txt（例：../smoke-run.txt）。最後に、かかった時間と合格の数を出す
import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { serveBuilt } from './serveBuilt.mjs'

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const ALL = ['smoke', 'phone', 'admin', 'drive', 'check', 'cellImage', 'askVersion', 'spreadTurn']
const names = args.filter((a) => !a.startsWith('--')).flatMap((a) => (a === 'all' ? ALL : [a]))
if (!names.length) {
  console.log('流すテストの名前を書いてください（例：node scripts/e2e/run.mjs smoke phone、全部なら all）')
  process.exit(1)
}
for (const name of names) {
  if (!existsSync(`scripts/e2e/${name}.mjs`)) {
    console.log(`scripts/e2e/${name}.mjs がありません`)
    process.exit(1)
  }
}

const dev = flags.has('--dev')
const PORT = 4173
const APP = dev ? 'http://localhost:5173' : `http://localhost:${PORT}`
const minutes = (ms) => `${Math.floor(ms / 60000)}分${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}秒`

/** コマンドを動かし、終わるのを待つ（出力は、そのまま画面へ） */
function run(command, commandArgs) {
  return new Promise((ok, fail) => {
    const child = spawn(command, commandArgs, { stdio: 'inherit' })
    child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`${commandArgs.join(' ')} が失敗しました（${code}）`))))
  })
}

const started = Date.now()
let server = null
if (!dev) {
  if (!flags.has('--no-build')) {
    console.log('自動テスト用にまとめています（dist-e2e）…')
    const t = Date.now()
    await run(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build', '--mode', 'e2e', '--outDir', 'dist-e2e', '--emptyOutDir', '--logLevel', 'warn'])
    console.log(`まとめ終わりました（${minutes(Date.now() - t)}）`)
  } else if (!existsSync('dist-e2e/index.html')) {
    console.log('まとめた版（dist-e2e）がありません。--no-build を外して流してください')
    process.exit(1)
  }
  server = await serveBuilt('dist-e2e', PORT)
}

/** テスト1つを流す（記録は ../<名前>-run.txt）。合格の数を記録の最後の「n/m 件 合格」から読む */
function suite(name, edgePort) {
  const log = resolve(`../${name}-run.txt`)
  const t = Date.now()
  console.log(`▶ ${name}（Edge ${edgePort}）`)
  return new Promise((ok) => {
    const out = createWriteStream(log)
    const child = spawn(process.execPath, [`scripts/e2e/${name}.mjs`], { env: { ...process.env, APP_URL: APP, EDGE_PORT: String(edgePort) }, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.pipe(out, { end: false })
    child.stderr.pipe(out, { end: false })
    child.on('exit', (code) => {
      out.end(() => {
        const text = readFileSync(log, 'utf8')
        const counts = [...text.matchAll(/(\d+)\/(\d+) 件 合格/g)].at(-1)
        const failed = [...text.matchAll(/^✗ (.*)$/gm)].map((m) => m[1].slice(0, 80))
        const result = { name, code, ms: Date.now() - t, passed: counts ? Number(counts[1]) : null, total: counts ? Number(counts[2]) : null, failed, log }
        console.log(`■ ${name}：${counts ? `${counts[1]}/${counts[2]} 件 合格` : '途中で止まりました'}（${minutes(result.ms)}）`)
        ok(result)
      })
    })
  })
}

// 2つずつ同時に流す（--one なら1つずつ）。空いた Edge の口から、次のテストを始める
const ports = flags.has('--one') ? [9333] : [9333, 9334]
const queue = [...names]
const results = []
await Promise.all(
  ports.map(async (port) => {
    while (queue.length) results.push(await suite(queue.shift(), port))
  }),
)
server?.close()

console.log(`\n──── ${dev ? '開発サーバー' : 'まとめた版'}で流した結果（全部で ${minutes(Date.now() - started)}）`)
for (const r of results) {
  console.log(`${r.code === 0 ? '✓' : '✗'} ${r.name}：${r.passed !== null ? `${r.passed}/${r.total} 件 合格` : '途中で止まりました'}（${minutes(r.ms)}）  記録：${r.log}`)
  for (const f of r.failed) console.log(`    ✗ ${f}`)
}
process.exitCode = results.every((r) => r.code === 0) ? 0 : 1
