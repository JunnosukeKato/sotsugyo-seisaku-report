// Edge（Chromium）をヘッドレスで起動して puppeteer で操作する。
// puppeteer.launch の既定の起動引数ではこの環境の Edge が落ちるため、自分で起動して接続する。
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import puppeteer from 'puppeteer-core'

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
// 同時に複数の確かめを動かすときは、EDGE_PORT で別のポートにする（ブラウザのデータの置き場所も分かれる）
const PORT = Number(process.env.EDGE_PORT ?? 9333)

async function waitForDevtools() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (res.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('Edge の起動を確認できませんでした')
}

/** Edge を起動し、終わったら必ず閉じる */
export async function withEdge(fn) {
  const edge = spawn(
    EDGE,
    ['--headless', '--disable-gpu', '--no-first-run', `--user-data-dir=${join(tmpdir(), PORT === 9333 ? 'sotsugyo-poc-edge' : `sotsugyo-poc-edge-${PORT}`)}`, `--remote-debugging-port=${PORT}`, 'about:blank'],
    { stdio: 'ignore' },
  )
  try {
    await waitForDevtools()
    const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}` })
    try {
      return await fn(browser)
    } finally {
      await browser.close()
    }
  } finally {
    edge.kill()
  }
}
