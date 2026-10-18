// 使い方の動画を録る（場面は scripts/video/scenes/*.mjs）。録ったものに字幕と拡大を重ねて MP4 にするのは compose.mjs。
// 使い方: node scripts/video/record.mjs [場面の名前 …]（名前を書かなければ全部。例：02-body）
//   開発サーバーが http://localhost:5173 で動いていること。Edge は EDGE_PORT（ふだんは 9411）で起動する
// 録ったもの（写真・時刻）は poc-output/video/<場面の名前>/ に置く（公開しない）
import { readdirSync } from 'node:fs'
import * as rec from './recorder.mjs'
import * as session from './session.mjs'

process.env.EDGE_PORT ??= '9411'
const { withEdge } = await import('../poc/edge.mjs')

const names = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync('scripts/video/scenes').filter((f) => f.endsWith('.mjs')).map((f) => f.replace(/\.mjs$/, ''))
const h = { ...rec, ...session }

await withEdge(async (browser) => {
  for (const name of names) {
    const scene = await import(`./scenes/${name}.mjs`)
    const { meta } = scene
    const { context, page } = await session.openTool(browser, { device: meta.device, ...meta.open })
    await scene.prepare?.({ page, h })
    // パソコンは、矢印が始めから見えるよう、紙面の右下に置いておく
    if (meta.device !== 'phone') await rec.moveTo(page, 900, 560)
    const recording = await rec.startRecording(page, `poc-output/video/${name}`)
    await rec.sleep(1000)
    await scene.run({ page, rec: recording, h })
    await rec.sleep(2600)
    const t = await recording.stop()
    console.log(`${name}：${t.duration.toFixed(1)}秒・写真 ${t.frames.length}枚・印 ${t.marks.map((m) => m.name).join(' → ')}`)
    await context.close()
  }
})
