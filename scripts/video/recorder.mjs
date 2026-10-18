// 使い方の動画を録るための道具（本物のツールを Edge で操作し、画面を録る）。
// - 画面は、細かい写真（ビューポートの2倍の細かさ）を続けて撮る（1秒に約10枚）。ヘッドレスの Edge の screencast は
//   なめらかだが CSS の大きさ（1280×720）でしか届かず、拡大すると字がぼやけるため
// - マウスの矢印と押したときの輪は、写真には写さず、動かした位置と時刻を残して、動画にするとき（compose.mjs）になめらかに描く
// - 字幕や拡大を切り替える時刻は mark() で残す（同じ録画から見た目の違う動画を作れるように）
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** マウスの動き（時刻・位置・押したか）。録画の始まりより前のものも残し、止めるときに録画の時刻に直す */
const mouseLog = new WeakMap()
const logOf = (page) => {
  if (!mouseLog.has(page)) mouseLog.set(page, { at: null, events: [] })
  return mouseLog.get(page)
}

/** マウスを、人が動かすような速さで動かす（はじめと終わりをゆっくり） */
export async function moveTo(page, x, y) {
  const log = logOf(page)
  const from = log.at ?? { x: x - 220, y: y + 140 }
  const dist = Math.hypot(x - from.x, y - from.y)
  const steps = Math.max(10, Math.min(45, Math.round(dist / 16)))
  for (let i = 1; i <= steps; i++) {
    const k = i / steps
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2
    const p = { x: from.x + (x - from.x) * e, y: from.y + (y - from.y) * e }
    await page.mouse.move(p.x, p.y)
    log.events.push({ t: Date.now() / 1000, ...p })
    await sleep(16)
  }
  log.at = { x, y }
}

/** 動かしてから押す */
export async function clickAt(page, x, y, { pause = 350 } = {}) {
  await moveTo(page, x, y)
  await sleep(pause)
  logOf(page).events.push({ t: Date.now() / 1000, x, y, click: true })
  await page.mouse.click(x, y)
}

/** 押したことを残す（page.mouse.click を自分で呼ぶとき。ファイルを選ぶ窓を待つときなど） */
export function logClick(page, x, y) {
  logOf(page).events.push({ t: Date.now() / 1000, x, y, click: true })
}

/** スマホ：指でタップする（動画では、指の当たった所に丸を描く） */
export async function tapAt(page, x, y) {
  logOf(page).events.push({ t: Date.now() / 1000, x, y, tap: true })
  await page.touchscreen.tap(x, y)
}

/** スマホ：指でなぞる（左右のページ送りなど） */
export async function swipe(page, from, to, ms = 450) {
  const log = logOf(page)
  const steps = 12
  await page.touchscreen.touchStart(from.x, from.y)
  log.events.push({ t: Date.now() / 1000, ...from, touch: 'start' })
  for (let i = 1; i <= steps; i++) {
    const p = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps }
    await page.touchscreen.touchMove(p.x, p.y)
    log.events.push({ t: Date.now() / 1000, ...p, touch: 'move' })
    await sleep(ms / steps)
  }
  await page.touchscreen.touchEnd()
  log.events.push({ t: Date.now() / 1000, ...to, touch: 'end' })
}

/** 要素の中央（text があれば、その文字を含む要素）。見つからなければ例外 */
export async function centerOf(page, selector, text) {
  const r = await page.evaluate(
    (selector, text) => {
      const el = [...document.querySelectorAll(selector)].find((e) => e.getBoundingClientRect().width > 0 && (!text || e.textContent.includes(text)))
      if (!el) return null
      const b = el.getBoundingClientRect()
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }
    },
    selector,
    text,
  )
  if (!r) throw new Error(`見つかりません：${selector}${text ? `（${text}）` : ''}`)
  return r
}

export async function clickEl(page, selector, text, opts) {
  const c = await centerOf(page, selector, text)
  await clickAt(page, c.x, c.y, opts)
  return c
}

/** 人が打つような速さで打つ（日本語は1字ずつ確定した形で入る） */
export async function typeSlow(page, text, delay = 110) {
  for (const ch of text) {
    await page.keyboard.type(ch)
    await sleep(delay * (/[、。]/.test(ch) ? 2.5 : 1))
  }
}

/**
 * 録画を始める。dir に写真（frames/000001.jpg …）と、時刻の記録（timeline.json）を書く。
 * 戻り値の mark(name, extra) で、字幕や拡大の切り替えの時刻を残す
 */
export async function startRecording(page, dir, { quality = 88 } = {}) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'frames'), { recursive: true })
  const client = page._client()
  const view = page.viewport()
  const frames = []
  const marks = []
  const writes = []
  const start = Date.now() / 1000
  let stopped = false
  const loop = (async () => {
    while (!stopped) {
      const before = Date.now() / 1000
      // 写真はページ本体の窓口（page._client()）で撮る。別の窓口（createCDPSession）では倍率の設定が効かず、CSS の大きさ（1280×720）で返るため
      const { data } = await client.send('Page.captureScreenshot', { format: 'jpeg', quality, optimizeForSpeed: true, clip: { x: 0, y: 0, width: view.width, height: view.height, scale: 1 }, captureBeyondViewport: false })
      const after = Date.now() / 1000
      const file = `${String(frames.length + 1).padStart(6, '0')}.jpg`
      frames.push({ file, t: (before + after) / 2 - start })
      writes.push(writeFile(join(dir, 'frames', file), Buffer.from(data, 'base64')))
    }
  })()
  return {
    /** いまの時刻に印を付ける（録画の始まりからの秒） */
    mark(name, extra = {}) {
      marks.push({ name, t: Date.now() / 1000 - start, ...extra })
    },
    async stop() {
      await sleep(600)
      stopped = true
      await loop
      await Promise.all(writes)
      const end = Date.now() / 1000
      const mouse = logOf(page).events.map((e) => ({ ...e, t: e.t - start }))
      const timeline = { duration: end - start, frames, marks, mouse }
      writeFileSync(join(dir, 'timeline.json'), JSON.stringify(timeline))
      return timeline
    },
  }
}
