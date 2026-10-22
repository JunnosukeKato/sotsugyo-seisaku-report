// 自動テスト用にまとめた版（dist-e2e。scripts/e2e/run.mjs が vite build --mode e2e で作る）を配る、この端末だけの小さなサーバー。
// 開発サーバーと同じく、学生用ツール・管理ページの試験版（admin.html）・提出前チェック（check.html）を同じ場所から開ける。
// 開発中だけ読む、git に入れない見本（gas/trial-sample.private.json。管理ページの試験版の「学生の画面を試す」）は、
// まとめた版には入れず、ここから返す（まとめた版のフォルダに、公開しないファイルを置かないため）
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
}

/**
 * まとめた版の外から返すもの（URL の場所 → この端末のファイル・フォルダ。/ で終わるものはフォルダ）。
 * 見本の原稿の画像（docs/guide-images/sample/。テストの見本 sampleReport.mjs が、開発サーバーと同じ場所から読む）も
 */
const EXTRA = [
  ['/gas/trial-sample.private.json', 'gas/trial-sample.private.json'],
  ['/docs/guide-images/sample/', 'docs/guide-images/sample/'],
]

/** URL の場所 path を、返すファイルにする（返さないものは null） */
function fileOf(base, path) {
  for (const [url, local] of EXTRA) {
    if (url.endsWith('/') ? !path.startsWith(url) : path !== url) continue
    const dir = resolve(url.endsWith('/') ? local : '.')
    const file = resolve(url.endsWith('/') ? join(local, path.slice(url.length)) : local)
    return file.startsWith(dir + sep) ? file : null
  }
  // まとめた版のフォルダの外は返さない
  const file = resolve(join(base, path))
  return file === base || file.startsWith(base + sep) ? file : null
}

/** root のフォルダを http://localhost:port で配る。止めるときは、返したサーバーの close() */
export function serveBuilt(root = 'dist-e2e', port = 4173) {
  const base = resolve(root)
  const server = createServer((req, res) => {
    let path
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    } catch {
      return res.writeHead(400).end()
    }
    let file = fileOf(base, path)
    if (!file) return res.writeHead(403).end()
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    if (!existsSync(file)) return res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('見つかりません')
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': statSync(file).size, 'Cache-Control': 'no-store' })
    if (req.method === 'HEAD') return res.end()
    createReadStream(file).pipe(res)
  })
  return new Promise((ok, fail) => {
    server.once('error', fail)
    // 開発サーバーと同じく、この端末からだけ開ける（localhost）
    server.listen(port, 'localhost', () => ok(server))
  })
}

// これだけを動かす：node scripts/e2e/serveBuilt.mjs（Ctrl+C で止める）
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT ?? 4173)
  await serveBuilt('dist-e2e', port)
  console.log(`http://localhost:${port}/ で、自動テスト用にまとめた版を配っています（Ctrl+C で止める）`)
}
