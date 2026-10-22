// 作った動画（poc-output/video/out）を、使い方から見られる形にして public/help/videos/ に置く。
// 幅 1280 に縮め、すぐ再生を始められる形（faststart）の MP4 と、はじめに出す絵（題名の場面の JPEG）を作る。
// 使い方: node scripts/video/publish.mjs（compose.mjs のあと）。長さ（秒）を出すので、src/help/videos.ts の seconds に合わせる
//   node scripts/video/publish.mjs 6 … 番号を書けば、その動画だけ置き直す（ほかの動画はそのまま）
import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const FFMPEG =
  process.env.FFMPEG ??
  `${process.env.LOCALAPPDATA}/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe`
const FFPROBE = FFMPEG.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1')
const IN = 'poc-output/video/out'
const OUT = 'public/help/videos'
/** 動画の番号と、置くときの名前（src/help/videos.ts の file と同じ） */
const FILES = { 1: '1-start', 2: '2-body', 3: '3-table-photos', 4: '4-check', 5: '5-pdf', 6: '6-phone' }

/** 置き直す動画の番号（書かなければ全部） */
const ONLY = process.argv.slice(2).map(Number)
mkdirSync(OUT, { recursive: true })
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}\n${r.stderr}`)
  return r.stdout
}

for (const src of readdirSync(IN).filter((f) => f.endsWith('.mp4'))) {
  const n = Number(src.split('_')[0])
  const name = FILES[n]
  if (!name || (ONLY.length && !ONLY.includes(n))) continue
  const from = join(IN, src)
  const mp4 = join(OUT, `${name}.mp4`)
  // 音はない。字幕が読める細かさのまま、軽くする
  run(FFMPEG, ['-y', '-loglevel', 'error', '-i', from, '-vf', 'scale=1280:-2', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', mp4])
  // はじめの題名の場面（0.8秒。題名がはっきり出ている）
  run(FFMPEG, ['-y', '-loglevel', 'error', '-ss', '0.8', '-i', from, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', join(OUT, `${name}.jpg`)])
  const seconds = Math.round(Number(run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4]).trim()))
  console.log(`${n} ${name}：${seconds}秒・${(statSync(mp4).size / 1e6).toFixed(1)}MB`)
}
