// 録画（record.mjs が書いた写真と時刻）に、字幕・拡大・マウスの矢印（スマホは指の丸）を重ねて、動画（MP4）にする。
// 見た目は依頼者の選んだ案C（操作の所を拡大＋下に字幕。2026-10-19）。スマホの動画は、縦長の画面を左に置き、右に字幕を大きく出す。
// 絵を重ねるのは Edge の中の canvas（字幕の書体は BIZ UDPゴシック）。1コマずつ JPEG にして、ffmpeg で MP4 にまとめる。
// 使い方: node scripts/video/compose.mjs [場面の名前 …]（名前を書かなければ、録ってある場面を全部）
//   できた動画は poc-output/video/out/<番号>_<題名>.mp4。ffmpeg は FFMPEG（なければ winget で入れた場所）を使う
//   CAPTIONS_ONLY=1 のときは、字幕の行の分け方を出すだけ（動画は作らない。録る前でもよい）
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

process.env.EDGE_PORT ??= '9412'
const { withEdge } = await import('../poc/edge.mjs')

const FFMPEG =
  process.env.FFMPEG ??
  `${process.env.LOCALAPPDATA}/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg.exe`
const ROOT = 'poc-output/video'
const OUT = join(ROOT, 'out')
/** 動画の速さ（コマ/秒）・はじめの題名の長さ・終わりに止めておく長さ（秒） */
const FPS = 30
const TITLE = 2.6
const TAIL = 1.2

const names = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync('scripts/video/scenes')
      .filter((f) => f.endsWith('.mjs'))
      .map((f) => f.replace(/\.mjs$/, ''))
      .filter((n) => process.env.CAPTIONS_ONLY || existsSync(join(ROOT, n, 'timeline.json')))
mkdirSync(OUT, { recursive: true })

// 写真を渡し、できたコマを受け取るだけのサーバー（この PC の中だけ）
let current = null
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url)
  if (req.method === 'GET' && url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end('<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><body style="margin:0">')
  }
  if (req.method === 'GET' && url.startsWith('/frames/')) {
    res.writeHead(200, { 'content-type': 'image/jpeg' })
    return res.end(readFileSync(join(ROOT, current, 'frames', url.slice(8))))
  }
  const out = url.match(/^\/out\/(\d+\.jpg)$/)
  if (req.method === 'POST' && out) {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      writeFileSync(join(ROOT, current, 'out', out[1]), Buffer.concat(chunks))
      res.end('ok')
    })
    return
  }
  res.writeHead(404)
  res.end()
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

/** ページの中で動く：1本分のコマを描く道具を用意する（window.__R） */
async function setup(p) {
  const W = 1920
  const H = 1080
  const FONT = '"BIZ UDPGothic", "BIZ UDGothic", "Yu Gothic", sans-serif'
  const NAVY = '#1f2a5c'
  const phone = p.meta.device === 'phone'
  const canvas = document.querySelector('canvas') ?? document.body.appendChild(document.createElement('canvas'))
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')
  g.imageSmoothingQuality = 'high'
  await document.fonts.load(`bold 40px ${FONT}`).catch(() => {})

  const marks = p.marks
  const captionMarks = marks.filter((m) => p.meta.captions[m.name])
  const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2)

  // ---- 拡大（パソコン）：印ごとに、見せたい範囲（focus）が字幕の外に収まるよう寄る。1秒かけて移る ----
  /** 録画の画面の大きさ（CSS px） */
  const VW = p.viewport.width
  const VH = p.viewport.height
  /** 字幕のためにあける高さ（録画の画面の CSS px。倍率 1 のとき。2行の字幕が入る高さ。画面の高さの約2割） */
  const CAPTION_RESERVE = Math.round(VH * 0.2083)
  /** 見せたい範囲から、寄る倍率を決める */
  const zoomFor = (f) => {
    const pad = 36
    return Math.min(2.1, Math.max(1, Math.min(VW / (f.w + pad * 2), (VH - CAPTION_RESERVE) / (f.h + pad * 2))))
  }
  /**
   * 字幕を上に出すか：見せたい範囲が画面の下のほうにあるとき（右下の「PDFを書き出す」など。拡大しても下の端より下へは動かせず、
   * 下の字幕に隠れるため）。範囲のない印は、その前の印に合わせる
   */
  let place = 'bottom'
  const placeOf = marks.map((m) => {
    // place：字幕の位置を、印で決める（全体を見せているとき、案内の吹き出しが下にあるときなど）
    if (m.place) place = m.place
    else if (m.full) place = 'bottom'
    else if (m.focus) place = m.focus.y + m.focus.h > VH - CAPTION_RESERVE / zoomFor(m.focus) - 8 ? 'top' : 'bottom'
    return place
  })
  const fromFocus = (f, where) => {
    const z = zoomFor(f)
    return { cx: f.x + f.w / 2, cy: f.y + f.h / 2 + ((where === 'top' ? -1 : 1) * CAPTION_RESERVE) / z / 2, z }
  }
  const targets = marks
    .map((m, i) => ({ t: m.t, v: p.meta.zoom?.[m.name] ?? (m.full ? { cx: VW / 2, cy: VH / 2, z: 1 } : m.focus ? fromFocus(m.focus, placeOf[i]) : null) }))
    .filter((x) => x.v)
  /** 録画の時刻 t の、字幕の位置 */
  const placeAt = (t) => {
    let cur = 'bottom'
    marks.forEach((m, i) => {
      if (t >= m.t) cur = placeOf[i]
    })
    return cur
  }
  const zoomAt = (t) => {
    let v = { cx: VW / 2, cy: VH / 2, z: 1 }
    for (const x of targets) {
      if (t < x.t) break
      const k = ease((t - x.t) / 1.0)
      v = { cx: v.cx + (x.v.cx - v.cx) * k, cy: v.cy + (x.v.cy - v.cy) * k, z: v.z + (x.v.z - v.z) * k }
    }
    return v
  }
  /** 録画の時刻 t の字幕（最初の字幕は始まりから） */
  const captionAt = (t) => {
    let cur = null
    captionMarks.forEach((m, i) => {
      if (i === 0 || t >= m.t) cur = { text: p.meta.captions[m.name], since: i === 0 ? -Infinity : m.t }
    })
    return cur
  }

  // ---- 録画の写真（時刻の順）。描くときに、その時刻の写真を読む ----
  let frameIndex = -1
  let bitmap = null
  const frameAt = async (t) => {
    let i = Math.max(0, frameIndex)
    while (i + 1 < p.frames.length && p.frames[i + 1].t <= t) i++
    if (i !== frameIndex || !bitmap) {
      frameIndex = i
      const blob = await (await fetch(`/frames/${p.frames[i].file}`)).blob()
      bitmap?.close()
      bitmap = await createImageBitmap(blob)
    }
    return bitmap
  }

  /** 文字を幅に合わせて行に分ける（行の頭に、。」）が来ないように） */
  /**
   * 文字を幅に合わせて行に分ける。字幕の文に「\n」があれば、そこで必ず分ける。
   * 分けてよいのは言葉の切れ目だけ（「、」「。」の後ろ・かぎかっこの前・ひらがなから漢字やカタカナに変わる所など）。
   * 行の頭に「、。」）」や小さい字が来ないようにし、何行かになるときは行の長さをそろえる（最後の行に1字だけ残らないように）
   */
  const OPEN = '「『（(【'
  const CLOSE = '」』）)】'
  const PUNCT = '、。，．・：！？'
  const isHira = (c) => /[ぁ-ゟ]/.test(c)
  const isSmall = (c) => /[ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮー]/.test(c)
  const canBreak = (a, b) => {
    if (!a || !b) return false
    if (CLOSE.includes(b) || PUNCT.includes(b) || isSmall(b)) return false
    if (OPEN.includes(a)) return false
    // 空白の後ろ（「Backspace で」の「で」のように、ひらがなが続くときは分けない）
    if (a === ' ' || a === '　') return !isHira(b)
    if (PUNCT.includes(a) || OPEN.includes(b)) return true
    if (CLOSE.includes(a)) return !isHira(b)
    return isHira(a) && !isHira(b) && b !== ' '
  }
  /** 言葉の切れ目で区切った、ひとかたまりずつ（かぎかっこの中の、ボタンの名前などは分けない） */
  const unitsOf = (text) => {
    const chars = [...text]
    const units = []
    let cur = ''
    let depth = 0
    chars.forEach((ch, i) => {
      if (cur && depth === 0 && canBreak(chars[i - 1], ch)) {
        units.push(cur)
        cur = ''
      }
      if ('「『'.includes(ch)) depth++
      if ('」』'.includes(ch)) depth = Math.max(0, depth - 1)
      cur += ch
    })
    if (cur) units.push(cur)
    return units
  }
  const width = (s) => g.measureText(s.trimEnd()).width
  /** 幅 max に、かたまりを前から詰めていく（1つのかたまりが max より長いときだけ、字の間で分ける） */
  const greedy = (text, max) => {
    const lines = []
    let line = ''
    for (const unit of unitsOf(text)) {
      if (line && width(line + unit) > max) {
        lines.push(line)
        line = unit
      } else line += unit
    }
    if (line) lines.push(line)
    // 長すぎるかたまり：字の間で分ける（行の頭に句読点などが来ないように）
    return lines.flatMap((l) => {
      if (width(l) <= max) return [l]
      const out = []
      let cur = ''
      for (const ch of l) {
        if (cur && width(cur + ch) > max && !CLOSE.includes(ch) && !PUNCT.includes(ch) && !isSmall(ch)) {
          out.push(cur)
          cur = ch
        } else cur += ch
      }
      if (cur) out.push(cur)
      return out
    })
  }
  const wrap = (text, font, max) => {
    g.font = font
    return text.split('\n').flatMap((part) => {
      const first = greedy(part, max)
      if (first.length <= 1) return first.map((l) => l.trimEnd())
      // 行の数を変えずに、いちばん狭くできる幅で組み直す（行の長さがそろう）
      let lo = 0
      let hi = max
      for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2
        if (greedy(part, mid).length <= first.length) hi = mid
        else lo = mid
      }
      return greedy(part, hi).map((l) => l.trimEnd())
    })
  }
  /** 1字だけの行（句読点・かっこを数えない） */
  const lonely = (lines) => lines.length > 1 && lines.some((l) => [...l].filter((c) => !PUNCT.includes(c) && !OPEN.includes(c) && !CLOSE.includes(c)).length <= 1)
  const roundRect = (x, y, w, h, r, fill) => {
    g.beginPath()
    g.roundRect(x, y, w, h, r)
    g.fillStyle = fill
    g.fill()
  }

  /** 録画の写真を、拡大のようすに合わせて描き、録画の画面の位置をこの絵の位置に直す関数を返す */
  const drawShot = (bmp, view, dx, dy, dw, dh) => {
    const s = bmp.width / p.viewport.width
    const sw = bmp.width / view.z
    const sh = bmp.height / view.z
    const sx = Math.min(Math.max(view.cx * s - sw / 2, 0), bmp.width - sw)
    const sy = Math.min(Math.max(view.cy * s - sh / 2, 0), bmp.height - sh)
    g.drawImage(bmp, sx, sy, sw, sh, dx, dy, dw, dh)
    const k = dw / sw
    return { map: (x, y) => ({ x: dx + (x * s - sx) * k, y: dy + (y * s - sy) * k }), unit: k * s }
  }

  // ---- マウスの矢印・押したときの輪（パソコン）、指の丸（スマホ） ----
  const ARROW = new Path2D('M0 0 L0 22 L5.6 16.6 L9.6 25.4 L13.4 23.8 L9.4 15.2 L17.4 15.2 Z')
  const mouse = p.mouse
  const moves = mouse.filter((e) => !e.click && !e.tap)
  const mouseAt = (t) => {
    let i = -1
    while (i + 1 < moves.length && moves[i + 1].t <= t) i++
    if (i < 0) return moves[0] ?? null
    const a = moves[i]
    const b = moves[i + 1]
    if (!b || b.t - a.t > 0.12) return a
    const k = (t - a.t) / (b.t - a.t)
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
  }
  const ring = (shot, e, t, life, color, fill) => {
    const age = t - e.t
    if (age < 0 || age > life) return
    const k = age / life
    const q = shot.map(e.x, e.y)
    // 矢印・指の大きさは、拡大しても大きくしすぎない
    const u = Math.min(shot.unit, 1.5 * 1.3)
    g.beginPath()
    g.arc(q.x, q.y, (10 + 24 * k) * u, 0, Math.PI * 2)
    g.fillStyle = fill(1 - k)
    g.fill()
    g.lineWidth = 4 * u
    g.strokeStyle = color(1 - k)
    g.stroke()
  }
  const drawPointer = (shot, t) => {
    if (phone) {
      for (const e of mouse) if (e.tap) ring(shot, e, t, 0.6, (a) => `rgba(255,255,255,${a})`, (a) => `rgba(40,40,40,${0.45 * a})`)
      // なぞっている間は、指の位置に丸（2本の指で広げるときは2つ）
      const touches = mouse.filter((e) => e.touch)
      const last = touches.filter((e) => e.t <= t).at(-1)
      if (last && last.touch !== 'end') {
        for (const pt of last.points ?? [last]) {
          const q = shot.map(pt.x, pt.y)
          g.beginPath()
          g.arc(q.x, q.y, 20 * shot.unit, 0, Math.PI * 2)
          g.fillStyle = 'rgba(40,40,40,.4)'
          g.fill()
          g.lineWidth = 3 * shot.unit
          g.strokeStyle = '#fff'
          g.stroke()
        }
      }
      return
    }
    for (const e of mouse) if (e.click) ring(shot, e, t, 0.7, (a) => `rgba(240,150,0,${a})`, (a) => `rgba(255,190,40,${0.3 * a})`)
    const m = mouseAt(t)
    if (!m) return
    const q = shot.map(m.x, m.y)
    const u = Math.min(shot.unit, 1.5 * 1.3)
    g.save()
    g.translate(q.x, q.y)
    g.scale(u, u)
    g.shadowColor = 'rgba(0,0,0,.35)'
    g.shadowBlur = 3
    g.shadowOffsetY = 1
    g.fillStyle = '#111'
    g.fill(ARROW)
    g.shadowColor = 'transparent'
    g.lineJoin = 'round'
    g.lineWidth = 1.6
    g.strokeStyle = '#fff'
    g.stroke(ARROW)
    g.restore()
  }

  /** パソコン：字幕（ふだんは下。見せたい所が下のほうにあるときは上） */
  const bandCaption = (cap, t) => {
    if (!cap) return
    const font = `bold 46px ${FONT}`
    const lines = wrap(cap.text, font, 1480)
    g.font = font
    const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 84
    const h = lines.length * 66 + 40
    const top = placeAt(t) === 'top' ? 44 : H - 44 - h
    g.globalAlpha = Math.min(1, (t - cap.since) / 0.25)
    roundRect((W - w) / 2, top, w, h, 20, 'rgba(22,30,70,0.9)')
    g.fillStyle = '#fff'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    lines.forEach((l, i) => g.fillText(l, W / 2, top + 20 + 33 + i * 66))
    g.globalAlpha = 1
  }

  /** スマホ：右の字幕の幅（縦長の画面の右。drawPhone と同じ位置から） */
  const PHONE_CAPTION_W = W - (330 + Math.round((960 * p.viewport.width) / p.viewport.height) + 130) - 120
  /** スマホ：縦長の画面を左に、右に題名と字幕 */
  const drawPhone = (bmp, t) => {
    g.fillStyle = '#f2efe8'
    g.fillRect(0, 0, W, H)
    const sh = 960
    const sw = Math.round((sh * p.viewport.width) / p.viewport.height)
    const sx = 330
    const sy = (H - sh) / 2
    roundRect(sx - 16, sy - 16, sw + 32, sh + 32, 58, '#1d1d1f')
    g.save()
    g.beginPath()
    g.roundRect(sx, sy, sw, sh, 44)
    g.clip()
    const shot = drawShot(bmp, { cx: p.viewport.width / 2, cy: p.viewport.height / 2, z: 1 }, sx, sy, sw, sh)
    drawPointer(shot, t)
    g.restore()
    // 右：番号と題名
    const x = sx + sw + 130
    g.beginPath()
    g.arc(x + 34, 236, 34, 0, Math.PI * 2)
    g.fillStyle = NAVY
    g.fill()
    g.fillStyle = '#fff'
    g.font = `bold 38px ${FONT}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(p.meta.number, x + 34, 238)
    g.fillStyle = NAVY
    g.font = `bold 44px ${FONT}`
    g.textAlign = 'left'
    g.fillText(p.meta.label, x + 90, 238)
    // 右：字幕
    const cap = captionAt(t)
    if (cap) {
      g.globalAlpha = Math.min(1, (t - cap.since) / 0.25)
      const font = `bold 56px ${FONT}`
      const lines = wrap(cap.text, font, PHONE_CAPTION_W)
      g.font = font
      g.fillStyle = '#1c1c1c'
      lines.forEach((l, i) => g.fillText(l, x, 420 + i * 84))
      g.globalAlpha = 1
    }
  }

  /** はじめの題名 */
  const titleOverlay = (alpha) => {
    if (alpha <= 0) return
    g.globalAlpha = alpha
    g.fillStyle = 'rgba(20,26,56,0.82)'
    g.fillRect(0, 0, W, H)
    g.fillStyle = 'rgba(255,255,255,.85)'
    g.font = `bold 38px ${FONT}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('卒業制作報告書 作成ツールの使い方', W / 2, H / 2 - 70)
    g.fillStyle = '#fff'
    g.font = `bold 76px ${FONT}`
    g.fillText(`${p.meta.number}　${p.meta.label}`, W / 2, H / 2 + 30)
    g.globalAlpha = 1
  }

  // 字幕の行の分け方（作る前に、node の側に出して確かめる。1字だけの行があれば知らせる）
  const report = Object.entries(p.meta.captions).map(([name, text]) => {
    const lines = phone ? wrap(text, `bold 56px ${FONT}`, PHONE_CAPTION_W) : wrap(text, `bold 46px ${FONT}`, 1480)
    return { name, lines, lonely: lonely(lines) }
  })

  window.__R = {
    report,
    total: Math.round((p.title + p.duration + p.tail) * p.fps),
    async render(from, to) {
      for (let n = from; n < to; n++) {
        const T = n / p.fps
        const t = Math.min(Math.max(T - p.title, 0), p.duration)
        const bmp = await frameAt(t)
        g.clearRect(0, 0, W, H)
        if (phone) drawPhone(bmp, t)
        else {
          drawPointer(drawShot(bmp, zoomAt(t), 0, 0, W, H), t)
          if (T >= p.title) bandCaption(captionAt(t), t)
        }
        titleOverlay(T < p.title - 0.5 ? 1 : 1 - (T - (p.title - 0.5)) / 0.5)
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.93))
        await fetch(`/out/${String(n + 1).padStart(6, '0')}.jpg`, { method: 'POST', body: blob })
      }
    },
  }
  return { total: window.__R.total, report }
}

await withEdge(async (browser) => {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()))
  await page.goto(`http://127.0.0.1:${port}/`)
  for (const name of names) {
    current = name
    const { meta } = await import(`./scenes/${name}.mjs`)
    const timeline = process.env.CAPTIONS_ONLY ? { marks: [], frames: [], mouse: [], duration: 0 } : JSON.parse(readFileSync(join(ROOT, name, 'timeline.json'), 'utf8'))
    // 録った画面の大きさ（前に録ったものには書いていないので、そのときの大きさ）
    const viewport = timeline.viewport ?? (meta.device === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 720 })
    const dir = join(ROOT, name, 'out')
    const started = Date.now()
    const { total, report } = await page.evaluate(setup, { meta, viewport, marks: timeline.marks, frames: timeline.frames, mouse: timeline.mouse, duration: timeline.duration, fps: FPS, title: TITLE, tail: TAIL })
    console.log(name)
    for (const c of report) console.log(`  字幕 ${c.name}：${c.lines.join(' ／ ')}${c.lonely ? '　← 1字だけの行があります' : ''}`)
    if (process.env.CAPTIONS_ONLY) continue
    if (report.some((c) => c.lonely)) throw new Error('1字だけの行がある字幕があります（字幕の文を直してください）')
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    for (let n = 0; n < total; n += 120) await page.evaluate((a, b) => window.__R.render(a, b), n, Math.min(total, n + 120))
    const mp4 = join(OUT, `${meta.number}_${meta.label}.mp4`)
    const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', join(dir, '%06d.jpg'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4])
    if (r.status !== 0) throw new Error(`ffmpeg：${r.stderr}`)
    console.log(`${mp4}（${(total / FPS).toFixed(1)}秒・${Math.round((Date.now() - started) / 1000)}秒で作成）`)
  }
})
server.close()
