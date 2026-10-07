// デザイン案 v25（使い方の手引き：学生用・教員用の冊子。A4 縦の PDF）の見本を作る。
//   1. shots  … 本物のツール（学生用ツール・管理ページの試験版）を Edge で操作して、画面の画像を撮る（mockups/v25/shots/）。
//               吹き出しの番号を付ける場所（画面の部品の位置）も、いっしょに書き出す（mockups/v25/shots/marks.json）
//   2. pages  … 案ごとに、4ページ（学生用の表紙・「本文を書く」・教員用の表紙・「年度の設定」）の HTML を作る（mockups/v25/a.html など）
//   3. pdf    … HTML を Edge で PDF にし（mockups/v25/a.pdf など）、PDF をページごとの画像にする（mockups/v25/screens/a-1.png など）。
//               用紙からのはみ出し・書体・いちばん小さい文字の大きさも確かめる
//   4. review … 一覧のページ（mockups/v25/review.html）を画像にする（mockups/v25/screens/review.png）
// 使い方: node scripts/mockup-shots-v25.mjs [shots] [pages] [pdf] [review]（何も付けなければ全部。開発サーバーが http://localhost:5173 で動いていること）
//   SHOTS=admin node scripts/mockup-shots-v25.mjs shots … 画面の画像を一部だけ撮り直す（pc・figure・phone・admin）
//   Edge は EDGE_PORT（ふだんは 9363）で起動する。案ごとの見た目は designA・designB・designC、文は T にまとめてある
// 中身の例：衣装コースの学生が本文の1章を書いた想定（人名・学籍番号は架空）。本物の Google にはつながない（?nodrive・管理ページの試験版）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import QRCode from 'qrcode'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

// ほかの確かめと同時に動かしても Edge がぶつからないよう、別のポートを使う（edge.mjs は読み込んだときにポートを決めるので、先に決める）
process.env.EDGE_PORT ??= '9363'
const { withEdge } = await import('./poc/edge.mjs')
const { stubConfig } = await import('./e2e/configStub.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const TOOL_URL = 'https://junnosukekato.github.io/sotsugyo-seisaku-report/'
const V = 'mockups/v25'
const SHOTS = `${V}/shots`
const SCREENS = `${V}/screens`
mkdirSync(SHOTS, { recursive: true })
mkdirSync(SCREENS, { recursive: true })
const ARGS = process.argv.slice(2)
const want = (k) => ARGS.length === 0 || ARGS.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PC = { width: 1440, height: 900, deviceScaleFactor: 2 }
const PHONE = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }

// =====================================================================
// 1. 画面の画像
// =====================================================================

/** 撮影のじゃまになるもの（試験用の設定の「（自動テスト用）」のお知らせ、別のタブの知らせ）を出さない */
const SHOT_CSS = `
  .side .notice, .sheet .notice, .sheet-body .notice { display: none !important; }
  .login-over.tab-locked { display: none !important; }
  .guide { display: none !important; }
`

/** 撮影のあいだに src/ が直されても、画面が入れ替わらないようにする（開発サーバーの即時反映をつながない） */
const noHotReload = (page) =>
  page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
  })

const ready = (page, phone) =>
  page.waitForFunction(
    (phone) => {
      const s = window.__editor?.getSnapshot()
      return s?.layout && (!phone || s.sheet !== undefined) && !s.rendering && !s.turning && !document.querySelector('.loading')
    },
    { timeout: 120000 },
    phone,
  )

/**
 * 原稿を用意する（ページの中で動かす。mockup-shots-v24 の「写したあと」と同じ中身）。
 * 図の画像（デザイン画・トワル）と生地見本は、絵を描いて作る
 */
async function setupReport() {
  const { fromMaterialTable } = await import('/src/model/table.ts')
  const make = async (id, w, h, draw) => {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    draw(c.getContext('2d'), w, h)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
    return { id, blob, widthPx: w, heightPx: h }
  }
  // 人の形の絵（デザイン画・トワルの写真の代わり）
  const person = (bg1, bg2, cloth, accent, skirt = '#f1ece2') => (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w * 0.6, h)
    grd.addColorStop(0, bg1)
    grd.addColorStop(1, bg2)
    g.fillStyle = grd
    g.fillRect(0, 0, w, h)
    const cx = w / 2
    const u = h / 100
    g.fillStyle = 'rgba(0,0,0,0.16)'
    g.beginPath(); g.ellipse(cx, 90 * u, 22 * u, 2.5 * u, 0, 0, Math.PI * 2); g.fill()
    g.fillStyle = cloth
    g.beginPath(); g.ellipse(cx - 14 * u, 36 * u, 6 * u, 12 * u, 0.35, 0, Math.PI * 2); g.fill()
    g.beginPath(); g.ellipse(cx + 14 * u, 36 * u, 6 * u, 12 * u, -0.35, 0, Math.PI * 2); g.fill()
    g.beginPath(); g.moveTo(cx - 9 * u, 23 * u); g.lineTo(cx + 9 * u, 23 * u); g.lineTo(cx + 13 * u, 58 * u); g.lineTo(cx - 13 * u, 58 * u); g.closePath(); g.fill()
    g.fillStyle = skirt
    g.beginPath(); g.moveTo(cx - 12 * u, 58 * u); g.lineTo(cx + 12 * u, 58 * u); g.lineTo(cx + 11 * u, 88 * u); g.lineTo(cx + 2 * u, 88 * u); g.lineTo(cx, 66 * u); g.lineTo(cx - 2 * u, 88 * u); g.lineTo(cx - 11 * u, 88 * u); g.closePath(); g.fill()
    g.fillStyle = accent
    g.fillRect(cx - 12 * u, 44 * u, 24 * u, 5 * u)
    g.fillStyle = '#e6c3a0'
    g.beginPath(); g.arc(cx, 16 * u, 5.5 * u, 0, Math.PI * 2); g.fill()
    g.fillStyle = accent
    g.beginPath(); g.ellipse(cx, 12.5 * u, 7 * u, 4.5 * u, 0, Math.PI, 0); g.fill()
  }
  const swatch = (base, line) => (g, w, h) => {
    g.fillStyle = base
    g.fillRect(0, 0, w, h)
    g.strokeStyle = line
    g.lineWidth = 3
    for (let x = -h; x < w; x += 14) {
      g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.stroke()
    }
  }
  if (!window.__v25) {
    const made = await Promise.all([
      make('v25-f1', 600, 800, person('#f8f4ec', '#ece3d1', '#2f4f8a', '#c8a24a')),
      make('v25-f2', 900, 1200, person('#d9d5cc', '#aaa395', '#ece4d0', '#cdbf9f', '#e6dcc4')),
      make('v25-f3', 900, 1200, person('#cfcac0', '#9c958a', '#e8dfc9', '#bfb091', '#e3d8bf')),
      make('v25-s1', 240, 240, swatch('#22335c', 'rgba(255,255,255,0.10)')),
      make('v25-s2', 240, 240, swatch('#9cc3dc', 'rgba(255,255,255,0.28)')),
      make('v25-s3', 240, 240, swatch('#f4f1ea', 'rgba(0,0,0,0.05)')),
    ])
    window.__editor.addImages(made)
    window.__v25 = true
  }
  const r0 = window.__editor.getSnapshot().report
  const t = (text) => ({ type: 'text', text })
  const ref = (targetId, withParens = true) => ({ type: 'ref', targetId, withParens })
  const p = (id, ...content) => ({ type: 'paragraph', id, content: content.map((c) => (typeof c === 'string' ? t(c) : c)) })
  window.__editor.replace({
    ...r0,
    basicInfo: { studentId: '00ZZ0123', name: '文化　花子', courseId: 'film-stage-costume', subtitleInput: 'シンドバッド' },
    abstract: { ...r0.abstract, started: false },
    body: [
      {
        id: 'c1',
        title: '企画・立案',
        blocks: [
          { type: 'subheading', id: 's1', title: '担当衣装のキャラクター' },
          p('p1', '筆者が担当したのは、物語の主人公である船乗りシンドバッドの衣装である。シンドバッドは七つの航海を経て成長していく人物であり、場面ごとに異なる表情を見せる。'),
          p('p2', '本制作では、旅立ちの場面の若々しさと、帰還の場面の頼もしさの両方を、一着の衣装で表すことを目標とした。'),
          { type: 'subheading', id: 's2', title: 'デザイン説明' },
          p('p3', '中東の伝統的な装いをもとに、航海の力強さと冒険心を表すデザインを考えた', ref('f1'), '。キーワードは自由、勇気、海である。'),
          { type: 'figureRow', id: 'r1', figures: [{ id: 'f1', imageId: 'v25-f1', caption: 'デザイン画' }] },
          p('p4', '袖は風をはらむように大きく膨らませた。腰には幅の広い帯を巻き、波の模様を刺繍で入れた。配色は海の青と砂の金を軸とした。'),
          { type: 'subheading', id: 's3', title: '使用素材' },
          p('p5', ref('t1', false), 'に使用した素材をまとめる。'),
          fromMaterialTable({
            id: 't1',
            caption: '使用材料表',
            rows: [
              { id: 'm1', name: 'コットンサテン', usage: 'ジャケット', swatchImageId: 'v25-s1' },
              { id: 'm2', name: 'シルクシフォン', usage: '袖\n帯', swatchImageId: 'v25-s2' },
              { id: 'm3', name: 'ブロード', usage: 'シャツ', swatchImageId: 'v25-s3' },
            ],
          }),
        ],
      },
      {
        id: 'c2',
        title: '制作過程',
        blocks: [
          { type: 'subheading', id: 's4', title: 'トワル組み' },
          p('p6', 'デザイン画をもとに、まずシーチングでトワルを組んだ', ref('f2'), ref('f3'), '。'),
          { type: 'figureRow', id: 'r2', figures: [{ id: 'f2', imageId: 'v25-f2', caption: 'トワル（前）' }, { id: 'f3', imageId: 'v25-f3', caption: 'トワル（後ろ）' }] },
          p('p7', '一回目の仮縫いでは、袖の膨らみが大きすぎて、腕を上げたときに肩が引きつれた。そこで袖山を3cm下げ、袖幅も細くした。'),
          p('p8', '二回目の仮縫いでは、実際に舞台の上で歩いたり腕を回したりして、動きやすさを確かめた。'),
        ],
      },
    ],
    references: [],
    workPhotos: { layout: 1, imageIds: [] },
  })
}

/** 学生用ツールを開き、原稿を用意する */
async function openTool(browser, { phone = false } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  await noHotReload(page)
  if (phone) await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36')
  await page.setViewport(phone ? PHONE : PC)
  await stubConfig(page)
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0', timeout: 90000 })
  await ready(page, phone)
  await page.addStyleTag({ content: SHOT_CSS })
  await page.evaluate(setupReport)
  await sleep(800)
  await ready(page, phone)
  await page.bringToFront()
  return { context, page }
}

const goToBlock = async (page, id, phone) => {
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), id)
  await sleep(300)
  await ready(page, phone)
}

/** 段落を開いて書き始める（caret：カーソルを置く文字の位置） */
const openBlock = async (page, id, caret) => {
  await goToBlock(page, id)
  await page.evaluate((id, caret) => window.__editor.openWhenReady(id, caret), id, caret)
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 30000 }, id)
  await sleep(500)
}

/** ページの中で、要素の位置を測る（いくつかなら、それらを囲む範囲） */
function rectOf(sel, text) {
  const els = [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 0 && (!text || e.textContent.includes(text)))
  if (!els.length) return null
  const rs = els.map((e) => e.getBoundingClientRect())
  const x = Math.min(...rs.map((r) => r.left))
  const y = Math.min(...rs.map((r) => r.top))
  return { x, y, w: Math.max(...rs.map((r) => r.right)) - x, h: Math.max(...rs.map((r) => r.bottom)) - y }
}

/** ページの中で、文字の位置を測る（root の中で、最初に text が出てくるところ） */
function rectOfText(rootSel, text) {
  const roots = [...document.querySelectorAll(rootSel)].filter((e) => e.getBoundingClientRect().width > 0)
  for (const root of roots) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let all = ''
    const nodes = []
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      nodes.push({ n, start: all.length })
      all += n.textContent
    }
    const at = all.indexOf(text)
    if (at < 0) continue
    const range = document.createRange()
    const pos = (i) => {
      const hit = nodes.findLast((x) => x.start <= i)
      return [hit.n, i - hit.start]
    }
    range.setStart(...pos(at))
    range.setEnd(...pos(at + text.length))
    const r = range.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  }
  return null
}

/** カーソルの位置 */
function caretRect() {
  const r = getSelection().getRangeAt(0).getBoundingClientRect()
  return { x: r.left, y: r.top, w: Math.max(1, r.width), h: r.height }
}

const MARKS = existsSync(`${SHOTS}/marks.json`) ? JSON.parse(readFileSync(`${SHOTS}/marks.json`, 'utf8')) : {}

/**
 * 画面を切り抜いて撮り、吹き出しの番号の場所を書き出す。
 * clip：切り抜く範囲（CSS px）。marks：[{ n, box（部品の範囲）, at：吹き出しを置く側（l・r・t・b・tl・tr・bl・br・c）, dx, dy（px） }]
 * 書き出すのは、画像の中での部品の範囲（%）と置く側だけ。吹き出しの大きさは案ごとに違うので、部品からどれだけ離すかは
 * ページの HTML の側で決める（shotFig）
 */
async function capture(page, name, clip, marks = []) {
  const vp = page.viewport()
  const x = Math.max(0, Math.round(clip.x))
  const y = Math.max(0, Math.round(clip.y))
  const c = { x, y, width: Math.min(vp.width, Math.round(clip.x + clip.w)) - x, height: Math.min(vp.height, Math.round(clip.y + clip.h)) - y }
  // captureBeyondViewport を切る：切ると、撮るときに画面の大きさが一時的に変わらない（変わると、管理ページの見本が作り直されて白く写る）
  await page.screenshot({ path: `${SHOTS}/${name}.png`, clip: c, captureBeyondViewport: false })
  const pct = (v, s) => +((v / s) * 100).toFixed(2)
  const pts = marks
    .filter((m) => m.box)
    .map(({ n, box, at = 'l', dx = 0, dy = 0 }) => ({
      n,
      at,
      dx: pct(dx, c.width),
      dy: pct(dy, c.height),
      box: { x: pct(box.x - c.x, c.width), y: pct(box.y - c.y, c.height), w: pct(box.w, c.width), h: pct(box.h, c.height) },
    }))
  for (const m of marks) if (!m.box) console.log(`！ ${name}：${m.n} の場所が見つかりません`)
  MARKS[name] = { w: c.width, h: c.height, marks: pts }
  writeFileSync(`${SHOTS}/marks.json`, JSON.stringify(MARKS, null, 1))
  console.log(`  ${SHOTS}/${name}.png  (${c.width}×${c.height})`)
}

const pad = (r, px, py = px) => ({ x: r.x - px, y: r.y - py, w: r.w + px * 2, h: r.h + py * 2 })
const union = (...rs) => {
  rs = rs.filter(Boolean)
  const x = Math.min(...rs.map((r) => r.x))
  const y = Math.min(...rs.map((r) => r.y))
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y }
}
const CUR = '.page-viewport.front [data-vivliostyle-page-container].is-current'
const tool = (page, label) => page.evaluate(rectOf, '.palette .tb', label)

/** 撮る場面（環境変数 SHOTS=pc,figure,phone,admin で一部だけ撮り直せる） */
const SHOT_ONLY = (process.env.SHOTS ?? '').split(',').filter(Boolean)
const doShot = (k) => !SHOT_ONLY.length || SHOT_ONLY.includes(k)

async function takeShots(browser) {
  // ---- 学生用ツール：PC の画面全体（表紙の絵に使う） ----
  if (doShot('pc')) {
    const { context, page } = await openTool(browser)
    await goToBlock(page, 'p3')
    await page.mouse.move(5, 5)
    await capture(page, 'pc-full', { x: 0, y: 0, w: PC.width, h: PC.height })

    // ---- 「本文を書く」：段落を書いているところ（道具と紙面の上半分） ----
    // 「デザイン説明」の段落の終わりにカーソルを置く
    await openBlock(page, 'p3', 999)
    const palette = await page.evaluate(rectOf, '.palette')
    const paper = await page.evaluate(rectOf, CUR)
    const figure = await page.evaluate(rectOf, `${CUR} figure[data-figure-id]`)
    const editor = await page.evaluate(rectOf, '.overlay-clip:not([hidden]) .overlay-editor')
    const caret = await page.evaluate(caretRect)
    const clip = { x: palette.x - 18, y: 0, w: paper.x + paper.w + 18 - (palette.x - 18), h: figure.y + figure.h + 14 }
    await capture(page, 'w-main', clip, [
      { n: 1, box: editor, at: 'l', dy: -editor.h / 2 + 12 },
      { n: 2, box: caret, at: 'r', dx: 2 },
      { n: 3, box: await tool(page, '図を入れる'), at: 'r' },
      { n: 4, box: await tool(page, '表を入れる'), at: 'r' },
      { n: 5, box: union(await tool(page, '小見出し'), await tool(page, '大見出し')), at: 'r' },
      { n: 6, box: await tool(page, '元に戻す'), at: 'r' },
    ])

    // ---- 「表を入れる」を押したところ（どの表を入れるかを選ぶ） ----
    await page.evaluate(() => [...document.querySelectorAll('.palette .tb')].find((b) => b.textContent.includes('表を入れる')).click())
    await page.waitForSelector('.palette .side-menu')
    await sleep(300)
    const menu = await page.evaluate(rectOf, '.palette .side-menu')
    const tableTool = await tool(page, '表を入れる')
    await capture(page, 'w-table', pad(union(menu, tableTool, await tool(page, '図を入れる')), 14, 14), [
      { n: 1, box: await page.evaluate(rectOf, '.palette .side-menu button', '空の表'), at: 'r' },
      { n: 2, box: await page.evaluate(rectOf, '.palette .side-menu button', '素材表'), at: 'r' },
    ])
    await context.close()
  }

  // ---- 図を入れたところ：文中に「（図1）」が入り、段落のすぐ下に図、図のタイトルを書く欄が開く ----
  if (doShot('figure')) {
    const { context, page } = await openTool(browser)
    // 図の写真（イメージボードの代わりの絵）を、選ぶファイルとして書き出す
    const png = await page.evaluate(async () => {
      const c = new OffscreenCanvas(1000, 640)
      const g = c.getContext('2d')
      g.fillStyle = '#f4efe4'
      g.fillRect(0, 0, 1000, 640)
      const block = (x, y, w, h, color) => { g.fillStyle = color; g.fillRect(x, y, w, h) }
      block(40, 40, 430, 330, '#2f4f8a')
      block(500, 40, 220, 160, '#c8a24a')
      block(740, 40, 220, 160, '#e8dcc0')
      block(500, 220, 460, 150, '#9cc3dc')
      block(40, 400, 280, 200, '#d9cbb0')
      block(340, 400, 300, 200, '#22335c')
      block(660, 400, 300, 200, '#efe7d6')
      // 波の線
      g.strokeStyle = 'rgba(255,255,255,0.7)'
      g.lineWidth = 6
      for (let k = 0; k < 4; k++) {
        g.beginPath()
        for (let x = 60; x <= 450; x += 10) g.lineTo(x, 120 + k * 60 + Math.sin(x / 28) * 14)
        g.stroke()
      }
      g.strokeStyle = 'rgba(200,162,74,0.9)'
      g.beginPath()
      for (let x = 360; x <= 620; x += 10) g.lineTo(x, 500 + Math.sin(x / 22) * 18)
      g.stroke()
      const blob = await c.convertToBlob({ type: 'image/png' })
      return new Promise((r) => {
        const fr = new FileReader()
        fr.onload = () => r(String(fr.result).split(',')[1])
        fr.readAsDataURL(blob)
      })
    })
    const file = join(tmpdir(), 'sotsugyo-v25-board.png')
    writeFileSync(file, Buffer.from(png, 'base64'))
    // 「…目標とした」の後ろ（「。」の前）にカーソルを置いて、「図を入れる」
    await openBlock(page, 'p2', '本制作では、旅立ちの場面の若々しさと、帰還の場面の頼もしさの両方を、一着の衣装で表すことを目標とした'.length)
    const [chooser] = await Promise.all([page.waitForFileChooser(), page.evaluate(() => [...document.querySelectorAll('.palette .tb')].find((b) => b.textContent.includes('図を入れる')).click())])
    await chooser.accept([file])
    await page.waitForFunction(() => window.__editor.getSnapshot().editingId?.startsWith('f-'), { timeout: 30000 })
    await ready(page)
    await page.keyboard.type('イメージボード')
    await sleep(700)
    const para = await page.evaluate(rectOf, `${CUR} [data-block-id="p2"]`)
    const cap = await page.evaluate(rectOf, '.overlay-clip:not([hidden]) .overlay-editor')
    const newFig = await page.evaluate(rectOf, `${CUR} figure[data-figure-id^="f-"]`)
    const ref = await page.evaluate(rectOfText, `${CUR} [data-block-id="p2"]`, '（図1）')
    const area = union(para, newFig, cap)
    await capture(page, 'w-figure', { x: area.x - 26, y: area.y - 3, w: area.w + 52, h: area.h + 18 }, [
      { n: 1, box: ref, at: 'r' },
      { n: 2, box: cap, at: 'r' },
    ])
    await context.close()
  }

  // ---- スマホ：段落をタップして書いているところ ----
  if (doShot('phone')) {
    const { context, page } = await openTool(browser, { phone: true })
    await goToBlock(page, 'p3', true)
    await page.evaluate(() => window.__editor.openWhenReady('p3', 12))
    await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p3', { timeout: 30000 })
    await sleep(900)
    await capture(page, 'phone-write', { x: 0, y: 0, w: PHONE.width, h: PHONE.height }, [
      { n: 1, box: await page.evaluate(rectOf, '.edit-sheet .es-tools'), at: 't' },
    ])
    // 書く欄だけ（画面の下に開く）
    const sheet = await page.evaluate(rectOf, '.edit-sheet')
    await capture(page, 'phone-sheet', { x: 0, y: sheet.y - 6, w: PHONE.width, h: PHONE.height - sheet.y + 6 }, [
      { n: 1, box: await page.evaluate(rectOf, '.edit-sheet .es-tools button', '図を入れる'), at: 't', dy: 4 },
    ])
    await context.close()
  }

  // ---- 管理ページ（試験版）：年度の設定 ----
  if (doShot('admin')) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    page.on('pageerror', (e) => console.log('pageerror:', e.message))
    page.on('dialog', (d) => d.accept())
    await noHotReload(page)
    await page.setViewport(PC)
    await page.goto(`${APP}/admin.html`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => localStorage.removeItem('sotsugyo-admin-mock'))
    await page.reload({ waitUntil: 'networkidle0' })
    await page.waitForSelector('.admin .form')
    // 「試験用サーバー」の印は本物の管理ページにはないので出さない
    await page.evaluate(() => [...document.querySelectorAll('.badge')].find((b) => b.textContent.includes('試験用'))?.style.setProperty('display', 'none'))
    // 締切を1日ずらして、「保存していない変更があります」と保存のボタンが押せる状態にする
    const field = (label) => page.evaluateHandle((label) => [...document.querySelectorAll('.f')].find((f) => f.querySelector('.l')?.textContent.startsWith(label)).querySelector('input, textarea'), label)
    const deadline = await field('最終締切')
    await deadline.evaluate((el) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '2027-01-22')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await page.waitForSelector('.badge.warn')
    await page.evaluate(() => [...document.querySelectorAll('.badge')].find((b) => b.textContent.includes('試験用'))?.style.setProperty('display', 'none'))
    await page.mouse.move(5, 5)
    // 見本（iframe）は設定や幅が変わるたびに作り直されるので、表紙と抄録が出て、作り直しが止まるまで待つ
    // （同じ文書のまま 0.8 秒たったら、止まったとみなす）
    const previewStable = async () => {
      for (let i = 0; i < 40; i++) {
        const stable = await page.evaluate(() => {
          const d = document.querySelector('.preview iframe')?.contentDocument
          if (!d || d.readyState !== 'complete' || d.querySelectorAll('.page').length !== 2) return false
          if (d.__v25seen) return true
          d.__v25seen = true
          return false
        })
        if (stable) return
        await sleep(800)
      }
      throw new Error('管理ページの見本が表示されません')
    }
    await previewStable()
    await page.evaluate(() => document.querySelector('.preview iframe').contentDocument.fonts.ready)
    await sleep(600)
    await previewStable()
    // 欄の名前（「共通の題目」など）の文字の範囲（吹き出しは画像の左の外に置き、名前の左の端まで線を引く）
    const fieldBox = (label) => page.evaluate((label) => {
      const l = [...document.querySelectorAll('.form .l')].find((e) => e.textContent.startsWith(label))
      const range = document.createRange()
      range.selectNodeContents(l)
      const r = range.getBoundingClientRect()
      return { x: r.left, y: r.top, w: r.width, h: r.height }
    }, label)
    const previewPage = await page.evaluate(() => {
      const f = document.querySelector('.preview iframe')
      const fr = f.getBoundingClientRect()
      const r = f.contentDocument.querySelector('.page').getBoundingClientRect()
      return { x: fr.left + r.left, y: fr.top + r.top, w: r.width, h: r.height }
    })
    // 下の「書き間違えやすい語」などは、この章では使わないので写さない（見本の下の端まで）
    await capture(page, 'admin-main', { x: 0, y: 0, w: PC.width, h: previewPage.y + previewPage.h + 14 }, [
      { n: 1, box: union(await page.evaluate(rectOf, '.admin-header .sel'), await page.evaluate(rectOf, '.admin-header .badge.pub')), at: 'b' },
      { n: 2, box: await fieldBox('共通の題目'), at: 'ol' },
      { n: 3, box: await fieldBox('最終締切'), at: 'ol' },
      { n: 4, box: await fieldBox('サブタイトルの形式'), at: 'ol' },
      { n: 5, box: await fieldBox('指導教員'), at: 'ol' },
      { n: 6, box: previewPage, at: 'tl', dx: 10, dy: 10 },
      { n: 7, box: await page.evaluate(rectOf, '.admin-header .btn', '保存して学生に反映'), at: 'r' },
    ])

    // 新年度を作ったところ（準備中）：画面の上の欄だけ。ボタンが詰まって見えるよう、真ん中のリンクは出さない
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '保存して学生に反映').click())
    await page.waitForFunction(() => document.querySelector('.message.ok'))
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('新年度を作成')).click())
    await page.waitForSelector('.modal')
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('作成する')).click())
    await page.waitForFunction(() => document.querySelector('.badge.draft')?.textContent === '準備中')
    await page.evaluate(() => [...document.querySelectorAll('.badge')].find((b) => b.textContent.includes('試験用'))?.style.setProperty('display', 'none'))
    await page.addStyleTag({ content: '.admin-header .user, .admin-header .link { display: none !important; } .admin-header > b { visibility: hidden; } .admin-header .spacer { flex: 0 0 28px !important; }' })
    await page.mouse.move(5, 5)
    await sleep(400)
    const head = union(await page.evaluate(rectOf, '.admin-header .sel'), await page.evaluate(rectOf, '.admin-header .btn.primary'))
    const header = await page.evaluate(rectOf, '.admin-header')
    await capture(page, 'admin-draft', { x: head.x - 12, y: header.y, w: head.w + 24, h: header.h }, [
      { n: 1, box: await page.evaluate(rectOf, '.admin-header .btn', '新年度を作成'), at: 'c' },
      { n: 2, box: await page.evaluate(rectOf, '.admin-header .btn.primary'), at: 'c' },
    ])
    await context.close()
  }
}

// =====================================================================
// 2. 冊子のページ（案ごとの HTML。A4 縦 4ページ：学生用の表紙・「本文を書く」・教員用の表紙・「年度の設定をする」）
// =====================================================================

const FONTS = ['biz-udpgothic/400', 'biz-udpgothic/700', 'biz-udmincho/400', 'biz-udmincho/700']
  .map((f) => `<link rel="stylesheet" href="../../node_modules/@fontsource/${f}.css">`)
  .join('\n')

/** 線のアイコン（ツールの src/app/icons.tsx と同じ線の太さ） */
const ic = (d) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const IC = {
  click: ic('<path d="M10 9.5l9 3.6-3.8 1.5-1.6 3.9z"/><path d="M5.5 5.5l2 2M10 3.5v2.6M3.5 10h2.6"/>'),
  enter: ic('<path d="M19 5.5v5.5a3 3 0 01-3 3H6"/><path d="M9.5 10.5L6 14l3.5 3.5"/>'),
  image: ic('<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M5 17.5l4.5-4.5 3 3L15 13.5l4 4"/>'),
  table: ic('<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M4 14.5h16M10 10v9M15 10v9"/>'),
  heading: ic('<path d="M5 6h14M5 11h9M5 16h14M5 20h9"/>'),
  undo: ic('<path d="M9 7.5L5 11.5l4 4M5 11.5h9.5a4.5 4.5 0 010 9H12"/>'),
  pencil: ic('<path d="M5 19l1-4L16 5l3 3L9 18z"/><path d="M14 7l3 3"/>'),
  check: ic('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  doc: ic('<path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4"/><path d="M9 13h6M9 16.5h4"/>'),
  calendar: ic('<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>'),
  users: ic('<circle cx="9" cy="9" r="3"/><path d="M3.5 19a5.5 5.5 0 0111 0"/><circle cx="16.5" cy="10" r="2.4"/><path d="M15 14.2a4.6 4.6 0 015.5 4.8"/>'),
  eye: ic('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  publish: ic('<path d="M12 15.5V4.5M7.5 9L12 4.5 16.5 9"/><path d="M5 14.5v5h14v-5"/>'),
  save: ic('<path d="M5 4.5h11l3 3v12H5z"/><path d="M8 4.5v5h7v-5M8 19.5v-5h8v5"/>'),
  title: ic('<path d="M5 6.5h14M12 6.5v12"/>'),
  phone: ic('<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>'),
  bulb: ic('<path d="M9.5 17.5h5M10.3 20.5h3.4"/><path d="M12 3.5a5.5 5.5 0 00-3.2 10c.7.5 1.2 1.3 1.2 2.2v.3h4v-.3c0-.9.5-1.7 1.2-2.2A5.5 5.5 0 0012 3.5z"/>'),
  warn: ic('<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.2v.3"/>'),
  list: ic('<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="5" cy="6.5" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="5" cy="17.5" r="1"/>'),
  login: ic('<path d="M10 5H6.5A1.5 1.5 0 005 6.5v11A1.5 1.5 0 006.5 19H10"/><path d="M14 8l4 4-4 4M18 12H9"/>'),
  arrow: ic('<path d="M5 12h14M13 6l6 6-6 6"/>'),
}

/**
 * 画面の画像に、番号の吹き出しと囲みの枠を重ねる。
 * badges：吹き出しを出す番号（省略ですべて）。labels：番号の代わりに出す文字（{1:'A'}）。hl：枠で囲む番号
 */
function shotFig(name, { cls = '', badges, labels = {}, hl = [], alt = '' } = {}) {
  const m = MARKS[name]
  if (!m) throw new Error(`${name} の画像がありません（先に shots を動かしてください）`)
  const boxes = m.marks
    .filter((x) => hl.includes(x.n))
    .map((x) => `<span class="hl" style="left:calc(${x.box.x}% - 0.6mm);top:calc(${x.box.y}% - 0.6mm);width:calc(${x.box.w}% + 1.2mm);height:calc(${x.box.h}% + 1.2mm)"></span>`)
    .join('')
  // 吹き出しの中心：部品の外側に、吹き出しの半径（--mkr）とすき間（--mkgap）だけ離す
  const f = (v) => +v.toFixed(2)
  const pos = (x) => {
    const b = x.box
    const L = f(b.x + x.dx)
    const R = f(b.x + b.w + x.dx)
    const T = f(b.y + x.dy)
    const B = f(b.y + b.h + x.dy)
    const cx = f((L + R) / 2)
    const cy = f((T + B) / 2)
    const away = 'var(--mkr) + var(--mkgap)'
    return {
      l: `left:calc(${L}% - ${away});top:${cy}%`,
      r: `left:calc(${R}% + ${away});top:${cy}%`,
      t: `left:${cx}%;top:calc(${T}% - ${away})`,
      b: `left:${cx}%;top:calc(${B}% + ${away})`,
      tl: `left:${L}%;top:${T}%`,
      tr: `left:${R}%;top:${T}%`,
      bl: `left:${L}%;top:${B}%`,
      br: `left:${R}%;top:${B}%`,
      c: `left:${cx}%;top:${cy}%`,
      // 画像の左の外（余白）に置き、部品の左の端まで線を引く（部品が詰まっていて、近くに置くと字が隠れるとき）
      ol: `left:calc(0% - ${away} - var(--mkout));top:${cy}%`,
    }[x.at]
  }
  const shown = m.marks.filter((x) => !badges || badges.includes(x.n))
  const leaders = shown
    .filter((x) => x.at === 'ol')
    .map((x) => `<span class="ld" style="left:calc(0% - var(--mkgap) - var(--mkout));top:${f(x.box.y + x.dy + x.box.h / 2)}%;width:calc(${f(x.box.x + x.dx)}% + var(--mkgap) + var(--mkout) - 0.6mm)"></span>`)
    .join('')
  const marks = shown.map((x) => `<i class="mk${labels[x.n] ? ' sub' : ''}" style="${pos(x)}">${labels[x.n] ?? x.n}</i>`).join('')
  return `<figure class="shot ${cls}" style="aspect-ratio:${m.w}/${m.h}"><img src="shots/${name}.png" alt="${alt}">${boxes}${leaders}${marks}</figure>`
}

// ---- 中身（どの案も同じ文。案によって並べ方だけを変える） ----
const T = {
  url: TOOL_URL,
  studentLead: '表紙から作品写真まで、決まった形のまま1か所で書けるツールです。手順書のルールに合っているかをその場で確かめ（セルフチェック）、そのまま1つの PDF にして提出できます。',
  studentFeat: ['パソコンでもスマホでも書けます', '原稿は自動で保存（この端末と、自分の Google ドライブ）', '字の大きさ・行の間・見出しの番号は、ツールがそろえます'],
  login: '大学の Google アカウント（<span class="fn">@bunka-wu.ac.jp</span>）でログインします',
  firstOpen: 'はじめて開くと、コースを選ぶ案内が出ます',
  studentToc: [
    [1, 'はじめに', '開く・ログイン・コースを選ぶ', 2],
    [2, '表紙と抄録', '学籍番号・氏名・サブタイトル・抄録', 4],
    [3, '本文を書く', '段落・見出し・図・表', 6],
    [4, '作品写真と引用・参考文献', '', 8],
    [5, 'セルフチェックで直す', 'エラーと警告・「直す」ボタン', 9],
    [6, 'PDF にして提出する', '', 10],
    [7, '保存とバックアップ', '自動保存・控え・ほかの端末で書く', 11],
    [8, '困ったとき', '', 12],
  ],
  teacherLead: '学生はこのツールで報告書を書き、セルフチェックを受けて、1つの PDF にして提出します。先生は「管理ページ」で、その年度の題目・コース・指導教員・締切と、コースごとのひな形・お知らせを決めます。',
  teacherFeat: ['学生の原稿は、学生のブラウザと学生本人の Google ドライブにだけ保存されます（学科には集まりません）', '保存すると、1分ほどで学生のツールに反映されます', '「変更履歴」から、前の内容に戻せます'],
  roles: [
    ['管理者', '年度の設定と公開・先生の登録'],
    ['先生', 'コースのひな形・お知らせ・書き間違えやすい語'],
  ],
  adminUrl: '管理ページの URL は、管理者からのメールでお知らせします。大学の Google アカウントでログインし、登録された先生だけが開けます。',
  teacherToc: [
    [1, 'このツールのしくみ', '学生の原稿はどこに保存されるか', 2],
    [2, '管理ページを開く', '管理者と先生', 3],
    [3, '年度の設定をする', '題目・コース・指導教員・締切', 4],
    [4, 'コースのひな形を直す', '', 6],
    [5, 'お知らせと書き間違えやすい語', '', 7],
    [6, '先生を登録する', '管理者だけ', 8],
    [7, '新年度の準備と公開', '', 9],
    [8, '学生から相談を受けたとき', '', 10],
  ],
  // 「本文を書く」
  writeLead: '紙面の上で、そのまま書きます。字の大きさ・行の間・見出しの番号は、ツールが手順書どおりにそろえます。',
  writeSteps: [
    { n: 1, icon: 'click', t: '書きたいところをクリック', d: '紙面の段落をクリックすると、その場に書く欄が開きます。書き終えたら Esc キーか、紙面の外をクリック。' },
    { n: 2, icon: 'enter', t: 'Enter で次の段落へ', d: '段落を分けるところで Enter。「。」を忘れても自動で付きます。段落の頭で Backspace を押すと、前の段落とつながります。' },
    { n: 3, icon: 'image', t: '図を入れる', d: '図を指したい文中の位置をクリックしてから押し、写真を選びます。' },
    { n: 4, icon: 'table', t: '表を入れる', d: '図と同じく、入れたい位置をクリックしてから押します。' },
    { n: 5, icon: 'heading', t: '見出しを足す', d: '「小見出し」（ⅰ．）・「大見出し」（Ⅰ．）は、書いている段落の後ろに入ります。番号は自動です。' },
    { n: 6, icon: 'undo', t: '元に戻す', d: '間違えたら「元に戻す」（Ctrl＋Z）。直前の操作を取り消せます。' },
  ],
  figA: '書いていた位置に「（図1）」が入ります。番号は自動でそろいます。',
  figB: 'すぐ下に図が入り、タイトルの欄が開きます。書いて Enter で文の続きへ。',
  table: '「空の表（2列）」か「素材表（名称・使用箇所・生地見本）」を選び、表のタイトルを書いて Enter。セルを書いているときは「行を足す」「列を足す」「画像を入れる」が出ます。',
  phone: '段落をタップすると、画面の下に「書く欄」が開きます。図・表は書く欄のボタンで、見出しは画面の下の「追加」から入れます。',
  phoneShort: '段落をタップすると、下に「書く欄」が開きます。図・表はそのボタンで、見出しは「追加」から。',
  tips: [
    'ページは自動で分かれます（「改ページ」もあります）',
    '原稿は自動で保存（この端末と Google ドライブ）',
    '図・表が押せないときは、先に文中をクリック',
    'ボタンにマウスを重ねると、入る場所に線が出ます',
  ],
  // 「年度の設定をする」
  setLead: '年度の設定は、管理者の先生が管理ページで行います。入力すると、すぐ右の見本（表紙と抄録）に出ます。',
  setSteps: [
    { n: 1, icon: 'calendar', t: '年度を選ぶ', d: '「公開中」は学生が使っている年度。「準備中」は、まだ学生に見えません。' },
    { n: 2, icon: 'title', t: '共通の題目', d: '表紙と抄録に入ります。学生は変えられません。' },
    { n: 3, icon: 'calendar', t: '最終締切', d: '学生のツールの「締切まで○日」に使われます。' },
    { n: 4, icon: 'list', t: 'コースとサブタイトルの形', d: '「―」＋学生の入力＋「の衣装制作―」の形。「学生に表示」を外すと選べなくなります。' },
    { n: 5, icon: 'users', t: '指導教員', d: '氏名を入力して Enter。× で外します。抄録に出ます。' },
    { n: 6, icon: 'eye', t: '右の見本', d: '黄色は、年度の設定から入る部分です。' },
    { n: 7, icon: 'save', t: '保存して学生に反映', d: '公開中の年度は、1分ほどで学生のツールに反映されます。' },
  ],
  flow: [
    ['新年度を作成', '前の年度をコピーして、準備中で作る'],
    ['直して「保存」', '題目・コース・指導教員・締切を直す'],
    ['見本で確かめる', '表紙と抄録の形'],
    ['この年度を学生に公開', '前の年度は「終了」になる'],
  ],
  cautions: [
    '年度の設定は「管理者」だけが変えられます（「先生」は、ひな形・お知らせ・書き間違えやすい語）。',
    '学生の原稿は、書き始めた年度の設定のまま開きます（新年度を公開しても表紙は変わりません）。',
    'ほかの人が先に保存していると保存できません。読み込み直してから直します。',
    '間違えたときは「変更履歴」から戻せます。',
  ],
}

const page = (title, css, body) => `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<!-- node scripts/mockup-shots-v25.mjs pages で作る（手で直さない）。画面の画像は shots/、番号の吹き出しの場所は shots/marks.json -->
${FONTS}
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; background: #e9e6e0; -webkit-font-smoothing: antialiased; }
  .sheet { position: relative; width: 210mm; height: 297mm; overflow: hidden; background: #fff; break-after: page; }
  .sheet:last-child { break-after: auto; }
  @media screen { body { padding: 24px 0; } .sheet { margin: 0 auto 24px; box-shadow: 0 1px 3px rgba(30, 25, 20, 0.08), 0 20px 60px rgba(30, 25, 20, 0.16); } }
  @media print { body { background: none; padding: 0; } .sheet { margin: 0; box-shadow: none; } }
  h1, h2, h3, p, ol, ul, dl, dd, figure { margin: 0; }
  ol, ul { padding: 0; list-style: none; }
  b, strong { font-weight: 700; }
  .fn { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; letter-spacing: 0.01em; }
  .ic { width: 1em; height: 1em; display: inline-block; vertical-align: -0.14em; flex: none; }
  .shot { position: relative; margin: 0; --mkr: 2.7mm; --mkgap: 0.5mm; --mkout: 1.4mm; }
  .shot .ld { position: absolute; z-index: 1; height: 0.4mm; margin-top: -0.2mm; }
  .shot > img { display: block; width: 100%; height: 100%; }
  .shot .mk { position: absolute; transform: translate(-50%, -50%); display: grid; place-items: center; font-style: normal; line-height: 1; z-index: 2; }
  .shot .hl { position: absolute; z-index: 1; pointer-events: none; }
${css}
</style>
</head>
<body>
${body}
</body>
</html>
`

const toc = (items, row) => items.map(row).join('')

// =====================================================================
// 案A「紙と墨」：ツールと同じ藍と生成り。明朝の見出し・細い罫・縦書きの題で端正に
// =====================================================================
function designA(qr) {
  const css = `
  :root { --ink: #23262b; --muted: #5b5e65; --ai: #2f3e75; --ai-soft: #e8ebf5; --kinari: #f5f1e8; --kinari-2: #e7e1d3; --line: #ddd7cc; --stage: #ebe8e3; }
  body { font-family: 'BIZ UDPGothic', sans-serif; color: var(--ink); font-size: 9.5pt; line-height: 1.6; }
  .min { font-family: 'BIZ UDMincho', serif; font-weight: 400; }
  .shot .mk { width: 5.4mm; height: 5.4mm; border-radius: 50%; background: var(--ai); color: #fff; font: 700 9.5pt/1 'BIZ UDPGothic', sans-serif; box-shadow: 0 0 0 0.45mm #fff, 0 0.3mm 1mm rgba(0, 0, 0, 0.3); }
  .shot .mk.sub { background: #fff; color: var(--ai); box-shadow: 0 0 0 0.4mm var(--ai), 0 0.3mm 1mm rgba(0, 0, 0, 0.25); font-family: 'Segoe UI', sans-serif; }
  .shot .hl { border: 0.45mm solid var(--ai); border-radius: 1.6mm; }
  .shot .ld { background: var(--ai); }
  .frame.room { padding-left: 8mm; background: #fff; }
  .frame { border: 0.3mm solid var(--line); border-radius: 1.6mm; background: var(--stage); }
  .frame .shot > img { border-radius: 1.4mm; }

  /* ---- 表紙 ---- */
  .cover { padding: 15mm 16mm 0; display: flex; flex-direction: column; }
  .c-top { display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 2.6mm; border-bottom: 0.3mm solid var(--ai); font-size: 9pt; letter-spacing: 0.14em; color: var(--ai); }
  .c-top .min { font-size: 11pt; letter-spacing: 0.1em; }
  .rule2 { height: 0.9mm; border-bottom: 0.15mm solid var(--ai); margin-bottom: 9mm; }
  .c-main { display: grid; grid-template-columns: 1fr 52mm; gap: 10mm; flex: 1; min-height: 0; }
  .c-tool { display: flex; align-items: center; gap: 3mm; font-size: 14pt; letter-spacing: 0.08em; }
  .seal { width: 10mm; height: 10mm; display: grid; place-items: center; border: 0.35mm solid var(--ai); border-radius: 2.4mm; color: var(--ai); font-size: 15pt; letter-spacing: 0; }
  .c-for { margin: 6mm 0 7mm; }
  .c-for b { display: inline-block; padding: 1.6mm 6mm 1.8mm; background: var(--ai); color: #fff; font-family: 'BIZ UDMincho', serif; font-weight: 400; font-size: 17pt; letter-spacing: 0.4em; text-indent: 0.4em; border-radius: 0.8mm; }
  .c-for.t b { background: var(--ink); }
  .c-lead { font-size: 10.5pt; line-height: 1.95; }
  .c-feat { margin: 4mm 0 0; display: grid; gap: 1.2mm; }
  .c-feat li { position: relative; padding-left: 4.6mm; font-size: 9.5pt; line-height: 1.6; }
  .c-feat li::before { content: ''; position: absolute; left: 0.8mm; top: 2.1mm; width: 1.6mm; height: 1.6mm; background: var(--ai); transform: rotate(45deg); }
  .c-toc-h { margin: 9mm 0 2.4mm; display: flex; align-items: center; gap: 3mm; font-size: 12pt; letter-spacing: 0.5em; color: var(--ai); }
  .c-toc-h::after { content: ''; flex: 1; border-bottom: 0.2mm solid var(--line); }
  .c-toc li { display: grid; grid-template-columns: 7mm 1fr auto; align-items: baseline; gap: 2mm; padding: 1.5mm 0; border-bottom: 0.15mm dotted #c9c2b4; }
  .c-toc .no { font-size: 12pt; color: var(--ai); }
  .c-toc b { font-size: 10.5pt; }
  .c-toc small { margin-left: 2.4mm; font-size: 9pt; color: var(--muted); }
  .c-toc .pg { font-size: 10.5pt; color: var(--muted); }
  /* 縦書きの題（原稿用紙のます目） */
  .c-title { display: flex; flex-direction: row-reverse; justify-content: flex-start; align-items: flex-start; gap: 3.5mm; padding-top: 1mm; }
  .masu { display: flex; flex-direction: column; border: 0.35mm solid #9ea8c9; font-family: 'BIZ UDMincho', serif; font-size: 50pt; line-height: 1; color: var(--ink); }
  .masu span { width: 24mm; height: 23.4mm; display: grid; place-items: center; }
  .masu span + span { border-top: 0.25mm solid #c3c9de; }
  .c-title .side { writing-mode: vertical-rl; font-family: 'BIZ UDMincho', serif; font-size: 12pt; letter-spacing: 0.32em; color: var(--ai); padding-top: 4mm; }
  .c-band { margin: 9mm -16mm 0; padding: 8mm 16mm 7mm; background: var(--kinari); display: grid; grid-template-columns: 1fr auto; gap: 8mm; align-items: center; border-top: 0.3mm solid var(--kinari-2); }
  .c-band h2 { font-family: 'BIZ UDMincho', serif; font-weight: 400; font-size: 13pt; letter-spacing: 0.2em; color: var(--ai); }
  .c-band .url { margin: 2mm 0 3mm; font-size: 11pt; font-weight: 600; color: var(--ai); }
  .c-band .txt { margin: 2mm 0 0; font-size: 9.5pt; line-height: 1.6; }
  .c-band ol { counter-reset: s; display: grid; gap: 1.2mm; }
  .c-band ol li { counter-increment: s; position: relative; padding-left: 6.4mm; font-size: 9.5pt; line-height: 1.6; }
  .c-band ol li::before { content: counter(s); position: absolute; left: 0; top: 0.4mm; width: 4.4mm; height: 4.4mm; display: grid; place-items: center; border: 0.25mm solid var(--ai); border-radius: 50%; font-size: 8.5pt; color: var(--ai); line-height: 1; }
  .c-band .roles { display: grid; grid-template-columns: auto 1fr; gap: 0.8mm 3mm; margin-top: 2.4mm; font-size: 9.5pt; }
  .c-band .roles dt { color: var(--ai); font-weight: 700; }
  .c-band .url.s { margin: 3mm 0 0; font-size: 10pt; }
  .c-band .url.s span { font-family: 'BIZ UDPGothic', sans-serif; font-weight: 700; margin-right: 2mm; }
  .qr { width: 38mm; padding: 3mm 3mm 2.4mm; background: #fff; border: 0.3mm solid var(--kinari-2); border-radius: 1.6mm; text-align: center; }
  .qr svg { display: block; width: 32mm; height: 32mm; }
  .qr b { display: block; margin-top: 1.8mm; font-size: 9pt; color: var(--ai); letter-spacing: 0.08em; }
  .c-note { margin: 0 -16mm; padding: 0 16mm 6mm; background: var(--kinari); font-size: 8.5pt; color: var(--muted); }

  /* ---- 中のページ ---- */
  .inner { padding: 11mm 14mm 0; display: flex; flex-direction: column; }
  .run { display: flex; justify-content: space-between; padding-bottom: 1.8mm; border-bottom: 0.2mm solid var(--line); font-size: 8.5pt; color: var(--muted); letter-spacing: 0.06em; }
  .run b { color: var(--ai); }
  .ch { display: flex; align-items: center; gap: 4mm; margin: 5mm 0 2.6mm; }
  .ch-no { width: 13mm; height: 13mm; flex: none; display: grid; place-items: center; border: 0.35mm solid var(--ai); border-radius: 2.6mm; color: var(--ai); font-size: 22pt; }
  .ch h1 { font-family: 'BIZ UDMincho', serif; font-weight: 400; font-size: 21pt; letter-spacing: 0.12em; line-height: 1.25; }
  .ch-sub { font-size: 10pt; color: var(--ai); letter-spacing: 0.08em; }
  .lead { font-size: 10pt; line-height: 1.8; padding-bottom: 3.4mm; margin-bottom: 4.5mm; border-bottom: 0.2mm solid var(--line); }
  .w-main { display: grid; grid-template-columns: 88mm 1fr; gap: 6mm; align-items: start; }
  .w-left { display: grid; gap: 4.5mm; }
  .steps { display: grid; gap: 2mm; }
  .steps li { display: grid; grid-template-columns: 6.4mm 1fr; gap: 0 2.4mm; }
  .steps .no, .defs .no { grid-row: span 2; width: 5.4mm; height: 5.4mm; margin-top: 0.1mm; display: grid; place-items: center; border-radius: 50%; background: var(--ai); color: #fff; font-size: 9.5pt; font-weight: 700; line-height: 1; }
  .steps b { font-size: 10.5pt; line-height: 1.45; }
  .steps p { font-size: 9.5pt; line-height: 1.55; }
  .sec-h { display: flex; align-items: center; gap: 2.4mm; margin-bottom: 2mm; font-family: 'BIZ UDMincho', serif; font-weight: 400; font-size: 12pt; color: var(--ai); letter-spacing: 0.1em; }
  .sec-h::before { content: ''; width: 1.1mm; height: 3.8mm; background: var(--ai); }
  .row2 { display: grid; grid-template-columns: 1.15fr 1fr; gap: 6mm; margin-top: 4mm; align-items: start; }
  .row2 .fig .frame { width: 84mm; }
  .row2 .tbl .frame { width: 54mm; }
  .mini { display: grid; gap: 1.2mm; margin-top: 2.2mm; }
  .mini li { display: grid; grid-template-columns: 5mm 1fr; gap: 1.6mm; font-size: 9.5pt; line-height: 1.6; }
  .mini .k { width: 4.6mm; height: 4.6mm; margin-top: 0.3mm; display: grid; place-items: center; border-radius: 50%; border: 0.35mm solid var(--ai); color: var(--ai); font: 700 8.5pt/1 'Segoe UI', sans-serif; }
  .row2 p { margin-top: 2.2mm; font-size: 9.5pt; line-height: 1.6; }
  .phone { display: grid; grid-template-columns: 36mm 1fr; gap: 4mm; align-items: start; }
  .tips.wide { margin-top: 4mm; }
  .tips.wide ul { grid-template-columns: 1fr 1fr; gap: 1.3mm 7mm; }
  .phone p { font-size: 9.5pt; line-height: 1.6; }
  .tips, .care { padding: 3.4mm 4mm 3.6mm; background: var(--kinari); border-radius: 1.6mm; }
  .tips ul, .care ul { display: grid; gap: 1.3mm; }
  .tips li, .care li { position: relative; padding-left: 4mm; font-size: 9.5pt; line-height: 1.55; }
  .tips li::before, .care li::before { content: ''; position: absolute; left: 0.6mm; top: 2mm; width: 1.5mm; height: 1.5mm; background: var(--ai); transform: rotate(45deg); }
  .folio { margin-top: auto; padding: 2mm 0 6mm; text-align: center; font-family: 'BIZ UDMincho', serif; font-size: 9pt; color: var(--muted); letter-spacing: 0.3em; }
  /* 年度の設定 */
  .set-shot { margin-bottom: 4mm; }
  .defs { display: grid; grid-template-columns: 1fr 1fr; gap: 1.6mm 7mm; }
  .defs > div { display: grid; grid-template-columns: 6.4mm 1fr; gap: 0 2.4mm; align-content: start; }
  .defs dt { font-size: 10.5pt; font-weight: 700; line-height: 1.45; }
  .defs dd { font-size: 9.5pt; line-height: 1.6; }
  .row-set { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin-top: 4mm; align-items: start; }
  .flow { counter-reset: f; display: grid; gap: 1.4mm; margin-top: 2.6mm; }
  .flow li { counter-increment: f; display: grid; grid-template-columns: 6mm 1fr; gap: 2mm; align-items: baseline; font-size: 9.5pt; line-height: 1.55; }
  .flow li::before { content: counter(f); font-family: 'BIZ UDMincho', serif; font-size: 13pt; color: var(--ai); text-align: center; }
  .flow b { font-size: 10pt; }
  .flow small { margin-left: 2mm; font-size: 9.5pt; color: var(--muted); }
  .draft-shot { padding: 1.4mm; }
  `
  const cover = (who) => {
    const s = who === 'student'
    const items = s ? T.studentToc : T.teacherToc
    return `
<section class="sheet cover">
  <header class="c-top"><span>文化学園大学　国際ファッション文化学科</span><span class="min">2026年度</span></header>
  <div class="rule2"></div>
  <div class="c-main">
    <div>
      <p class="c-tool"><span class="seal min">卒</span><span class="min">卒業制作報告書 作成ツール</span></p>
      <p class="c-for${s ? '' : ' t'}"><b>${s ? '学生用' : '教員用'}</b></p>
      <p class="c-lead">${s ? T.studentLead : T.teacherLead}</p>
      <ul class="c-feat">${(s ? T.studentFeat : T.teacherFeat).map((f) => `<li>${f}</li>`).join('')}</ul>
      <h2 class="c-toc-h min">目次</h2>
      <ol class="c-toc">${toc(items, ([n, t, sub, pg]) => `<li><span class="no min">${n}</span><span><b>${t}</b>${sub ? `<small>${sub}</small>` : ''}</span><span class="pg min">${pg}</span></li>`)}</ol>
    </div>
    <div class="c-title">
      <div class="masu">${[...'使い方の手引き'].map((c) => `<span>${c}</span>`).join('')}</div>
      <div class="side">卒業制作報告書 作成ツール</div>
    </div>
  </div>
  <footer class="c-band">
    <div>
      ${s
        ? `<h2>ツールを開く</h2>
      <p class="url fn">${T.url}</p>
      <ol><li>${T.login}</li><li>${T.firstOpen}</li></ol>`
        : `<h2>管理ページと学生のツール</h2>
      <p class="txt">${T.adminUrl}</p>
      <dl class="roles">${T.roles.map(([r, d]) => `<dt>${r}</dt><dd>${d}</dd>`).join('')}</dl>
      <p class="url s"><span>学生のツール</span></p><p class="url fn" style="margin:0.6mm 0 0;font-size:10pt">${T.url}</p>`}
    </div>
    <div class="qr">${qr}<b>${s ? 'スマホで読み取る' : '学生に配る URL'}</b></div>
  </footer>
  <p class="c-note">この手引きは 2026年度のツールの画面で作っています。画面は少し変わることがあります。</p>
</section>`
  }

  const write = `
<section class="sheet inner">
  <header class="run"><span>卒業制作報告書 作成ツール　使い方の手引き　<b>学生用</b></span><span>3　本文を書く</span></header>
  <div class="ch"><span class="ch-no min">3</span><div><h1>本文を書く</h1><p class="ch-sub">段落・見出し・図・表</p></div></div>
  <p class="lead">${T.writeLead}</p>
  <div class="w-main">
    <div class="w-left">
      <div class="frame">${shotFig('w-main', { hl: [3, 4, 5, 6] })}</div>
      <section class="phone">
        <div class="frame">${shotFig('phone-sheet', { badges: [], hl: [1] })}</div>
        <div><h2 class="sec-h">スマホでは</h2><p>${T.phone}</p></div>
      </section>
    </div>
    <ol class="steps">${T.writeSteps.map((s) => `<li><span class="no">${s.n}</span><b>${s.t}</b><p>${s.d}</p></li>`).join('')}</ol>
  </div>
  <div class="row2">
    <section class="fig">
      <h2 class="sec-h">図を入れたところ</h2>
      <div class="frame" style="background:#fff">${shotFig('w-figure', { labels: { 1: 'A', 2: 'B' } })}</div>
      <ol class="mini"><li><span class="k">A</span><span>${T.figA}</span></li><li><span class="k">B</span><span>${T.figB}</span></li></ol>
    </section>
    <section class="tbl">
      <h2 class="sec-h">表を選ぶ</h2>
      <div class="frame">${shotFig('w-table', { badges: [], hl: [1, 2] })}</div>
      <p>${T.table}</p>
    </section>
  </div>
  <section class="tips wide"><h2 class="sec-h">知っておくと安心</h2><ul>${T.tips.map((t) => `<li>${t}</li>`).join('')}</ul></section>
  <footer class="folio">― 6 ―</footer>
</section>`

  const settings = `
<section class="sheet inner">
  <header class="run"><span>卒業制作報告書 作成ツール　使い方の手引き　<b>教員用</b></span><span>3　年度の設定をする</span></header>
  <div class="ch"><span class="ch-no min">3</span><div><h1>年度の設定をする</h1><p class="ch-sub">管理ページ ― 題目・コース・指導教員・締切</p></div></div>
  <p class="lead">${T.setLead}</p>
  <div class="frame set-shot room">${shotFig('admin-main', { hl: [1, 7] })}</div>
  <dl class="defs">${T.setSteps.map((s) => `<div><span class="no">${s.n}</span><dt>${s.t}</dt><dd>${s.d}</dd></div>`).join('')}</dl>
  <div class="row-set">
    <section>
      <h2 class="sec-h">新しい年度の準備と公開</h2>
      <div class="frame draft-shot" style="background:#fff">${shotFig('admin-draft', { badges: [], hl: [1, 2] })}</div>
      <ol class="flow">${T.flow.map(([t, d]) => `<li><span><b>${t}</b><small>${d}</small></span></li>`).join('')}</ol>
    </section>
    <section class="care"><h2 class="sec-h">気をつけること</h2><ul>${T.cautions.map((t) => `<li>${t}</li>`).join('')}</ul></section>
  </div>
  <footer class="folio">― 4 ―</footer>
</section>`

  return page('案A 紙と墨（v25 使い方の手引き）', css, cover('student') + write + cover('teacher') + settings)
}

// =====================================================================
// 案B「雑誌風」：大きな画面写真・色の帯・大きな番号で見せる
// =====================================================================
function designB(qr) {
  const css = `
  :root { --ink: #15171c; --muted: #575b64; --navy: #1f2b5b; --mustard: #f2b632; --mustard-ink: #8a5e0f; --sky: #a9b8e8; --gray: #f2f0ec; --line: #dedad2; }
  body { font-family: 'BIZ UDPGothic', sans-serif; color: var(--ink); font-size: 9.5pt; line-height: 1.6; }
  .d { font-family: 'Bahnschrift', 'Segoe UI', sans-serif; font-stretch: 87.5%; letter-spacing: 0.02em; }
  .shot { --mkr: 3mm; }
  .shot .mk { width: 6mm; height: 6mm; border-radius: 1mm; background: var(--mustard); color: var(--ink); border: 0.4mm solid var(--ink); font: 700 11pt/1 'Bahnschrift', 'Segoe UI', sans-serif; box-shadow: 0 0.4mm 1.2mm rgba(0, 0, 0, 0.3); }
  .shot .mk.sub { background: #fff; }
  .shot .hl { border: 0.55mm solid var(--ink); border-radius: 1.2mm; }
  .shot .ld { background: var(--ink); }
  .t .shot .mk { background: var(--sky); }

  /* ---- 表紙 ---- */
  .b-cover .hero { position: absolute; left: 0; top: 0; right: 0; height: 150mm; padding: 13mm 14mm 0; background: var(--navy); color: #fff; overflow: hidden; }
  .b-cover.t .hero { background: var(--ink); }
  .hero-top { display: flex; justify-content: space-between; font-size: 9pt; letter-spacing: 0.24em; color: rgba(255, 255, 255, 0.75); }
  .hero-top .d { letter-spacing: 0.3em; }
  .year { position: absolute; right: -6mm; top: 14mm; font-size: 150pt; font-weight: 700; line-height: 1; color: rgba(255, 255, 255, 0.07); }
  .kick { position: relative; margin-top: 12mm; font-size: 13pt; font-weight: 700; letter-spacing: 0.12em; color: rgba(255, 255, 255, 0.85); }
  .b-cover h1 { position: relative; margin-top: 1mm; font-size: 44pt; line-height: 1.2; letter-spacing: 0.04em; }
  .for { position: relative; display: inline-flex; align-items: center; gap: 4mm; margin-top: 4mm; padding: 1.6mm 5mm 1.8mm; background: var(--mustard); color: var(--ink); }
  .b-cover.t .for { background: var(--sky); }
  .for b { font-size: 16pt; letter-spacing: 0.2em; }
  .for .d { font-size: 11pt; font-weight: 700; letter-spacing: 0.24em; }
  .hero-lead { position: relative; width: 156mm; margin-top: 5mm; font-size: 10pt; line-height: 1.75; color: rgba(255, 255, 255, 0.92); }
  .pc { position: absolute; left: 46mm; top: 99mm; width: 172mm; margin: 0; box-shadow: 0 2mm 8mm rgba(0, 0, 0, 0.35); }
  .pc img { display: block; width: 100%; border: 0.4mm solid #fff; }
  .ph { position: absolute; left: 14mm; top: 93mm; width: 32mm; margin: 0; border: 1.4mm solid #111; border-radius: 4.5mm; overflow: hidden; background: #111; box-shadow: 0 2mm 6mm rgba(0, 0, 0, 0.4); }
  .ph img { display: block; width: 100%; border-radius: 3mm; }
  .toc { position: absolute; left: 14mm; right: 14mm; top: 216mm; display: grid; grid-template-columns: 1fr 1fr; gap: 0 8mm; }
  .toc li { display: grid; grid-template-columns: 10mm 1fr auto; align-items: baseline; gap: 2mm; padding: 2.2mm 0 2mm; border-top: 0.3mm solid var(--ink); }
  .toc .n { font-size: 17pt; font-weight: 700; color: var(--navy); line-height: 1; }
  .t .toc .n { color: var(--ink); }
  .toc b { font-size: 10.5pt; line-height: 1.4; }
  .toc small { margin-left: 2mm; font-size: 9pt; color: var(--muted); line-height: 1.4; }
  .toc .pg { font-size: 10pt; color: var(--muted); }
  .foot { position: absolute; left: 0; right: 0; bottom: 0; height: 30mm; padding: 0 14mm; display: grid; grid-template-columns: auto 1fr; gap: 6mm; align-items: center; background: var(--ink); color: #fff; }
  .foot .qr { width: 23mm; height: 23mm; padding: 1.5mm; background: #fff; }
  .foot .qr svg { display: block; width: 100%; height: 100%; }
  .foot .k { font-size: 9pt; letter-spacing: 0.2em; color: var(--mustard); font-weight: 700; }
  .t .foot .k { color: var(--sky); }
  .foot .url { margin: 0.6mm 0 1mm; font-size: 11pt; font-weight: 600; }
  .foot p { font-size: 9.5pt; line-height: 1.55; color: rgba(255, 255, 255, 0.88); }

  /* ---- 中のページ ---- */
  .b-inner { padding: 11mm 14mm 0 22mm; display: flex; flex-direction: column; }
  .edge { position: absolute; left: 0; top: 0; bottom: 0; width: 9mm; background: var(--mustard); }
  .t .edge { background: var(--sky); }
  .edge span { position: absolute; left: 50%; top: 14mm; transform: translateX(-50%); writing-mode: vertical-rl; font-size: 9pt; font-weight: 700; letter-spacing: 0.3em; color: var(--ink); }
  .b-ch { display: grid; grid-template-columns: auto 1fr; gap: 5mm; align-items: end; padding-bottom: 3mm; border-bottom: 0.8mm solid var(--ink); }
  .b-ch .num { font-size: 64pt; font-weight: 700; line-height: 0.78; color: var(--navy); }
  .t .b-ch .num { color: var(--ink); }
  .b-ch .kick2 { font-size: 9pt; font-weight: 700; letter-spacing: 0.24em; color: var(--mustard-ink); }
  .t .b-ch .kick2 { color: var(--navy); }
  .b-ch h1 { font-size: 25pt; line-height: 1.25; letter-spacing: 0.04em; }
  .b-ch .lead { margin-top: 1.2mm; font-size: 10pt; line-height: 1.65; }
  .hero-row { display: grid; grid-template-columns: 1fr 34mm; gap: 6mm; margin-top: 4mm; align-items: start; }
  .hero-row .shot { box-shadow: 0 0.6mm 2.4mm rgba(0, 0, 0, 0.18); }
  .hero-row .shot > img { border: 0.3mm solid var(--line); }
  .phone-col .frame { border: 1.1mm solid #111; border-radius: 3.6mm; overflow: hidden; background: #111; }
  .phone-col .frame img { border-radius: 2.4mm; }
  .phone-col h3 { margin-top: 2.6mm; font-size: 10.5pt; }
  .phone-col p { font-size: 9.5pt; line-height: 1.55; }
  .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm 5mm; margin-top: 4mm; }
  .grid3 li { padding-top: 2mm; border-top: 0.3mm solid var(--ink); }
  .grid3 .hd { display: flex; align-items: center; gap: 2.4mm; margin-bottom: 1mm; }
  .grid3 .no { width: 7.4mm; height: 7.4mm; flex: none; display: grid; place-items: center; background: var(--mustard); border: 0.35mm solid var(--ink); font: 700 13pt/1 'Bahnschrift', 'Segoe UI', sans-serif; }
  .t .grid3 .no { background: var(--sky); }
  .grid3 b { font-size: 10.5pt; line-height: 1.35; }
  .grid3 p { font-size: 9.5pt; line-height: 1.55; }
  .strip { display: grid; gap: 3.4mm; margin-top: 4mm; }
  .fig-row { display: grid; grid-template-columns: 58mm 1fr; gap: 5mm; align-items: center; }
  .fig-row h3, .dark h3 { font-size: 10.5pt; margin-bottom: 1.4mm; }
  .fig-row li { display: grid; grid-template-columns: 5.4mm 1fr; gap: 1.4mm; font-size: 9.5pt; line-height: 1.55; }
  .fig-row li + li { margin-top: 1.2mm; }
  .fig-row .k { width: 4.8mm; height: 4.8mm; margin-top: 0.3mm; display: grid; place-items: center; border: 0.35mm solid var(--ink); font: 700 9pt/1 'Bahnschrift', sans-serif; }
  .fig-row .shot > img { border: 0.3mm solid var(--line); }
  .dark { padding: 3.4mm 4mm; background: var(--navy); color: #fff; }
  .t .dark { background: var(--ink); }
  .dark h3 { color: var(--mustard); letter-spacing: 0.1em; }
  .t .dark h3 { color: var(--sky); }
  .dark h3 { margin: 0 0 1.2mm; }
  .dark ul { display: grid; grid-template-columns: 1fr 1fr; gap: 1mm 6mm; }
  .dark li { position: relative; padding-left: 3.4mm; font-size: 9.5pt; line-height: 1.5; }
  .dark li::before { content: ''; position: absolute; left: 0; top: 1.9mm; width: 1.5mm; height: 1.5mm; background: var(--mustard); }
  .t .dark li::before { background: var(--sky); }
  .folio { margin-top: auto; padding: 2mm 0 5.5mm; display: flex; justify-content: space-between; font-size: 8.5pt; color: var(--muted); letter-spacing: 0.08em; }
  .folio .d { font-size: 11pt; font-weight: 700; color: var(--ink); }
  /* 年度の設定 */
  .set-shot { margin: 4mm 0 0 8mm; box-shadow: 0 0.6mm 2.4mm rgba(0, 0, 0, 0.18); }
  .set-shot > img { border: 0.3mm solid var(--line); }
  .list2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1.8mm 7mm; margin-top: 4mm; }
  .list2 li { display: grid; grid-template-columns: 7.4mm 1fr; gap: 0 2.4mm; align-content: start; padding-top: 1.4mm; border-top: 0.3mm solid var(--ink); }
  .list2 .no { grid-row: span 2; width: 6.4mm; height: 6.4mm; font-size: 12pt !important; display: grid; place-items: center; background: var(--sky); border: 0.35mm solid var(--ink); font: 700 13pt/1 'Bahnschrift', 'Segoe UI', sans-serif; }
  .list2 b { font-size: 10.5pt; line-height: 1.4; }
  .list2 p { font-size: 9.5pt; line-height: 1.55; }
  .flow-band { margin-top: 4mm; padding: 3.2mm 4mm 3.4mm; background: var(--ink); color: #fff; display: grid; grid-template-columns: auto 74mm; gap: 2.6mm 6mm; align-items: center; justify-content: space-between; }
  .flow-band .chain { grid-column: 1 / -1; }
  .flow-band h3 { font-size: 10.5pt; letter-spacing: 0.1em; color: var(--sky); }
  .flow-band .shot-wrap { padding: 1mm; background: #fff; }
  .chain { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0 6mm; }
  .chain li { position: relative; }
  .chain li + li::before { content: ''; position: absolute; left: -4.6mm; top: 0.4mm; border: 1.4mm solid transparent; border-left: 2mm solid var(--sky); }
  .chain .d { display: block; font-size: 11pt; font-weight: 700; color: var(--sky); line-height: 1; }
  .chain b { display: block; margin-top: 0.8mm; font-size: 10pt; line-height: 1.35; }
  .chain small { display: block; font-size: 9.5pt; line-height: 1.45; color: rgba(255, 255, 255, 0.85); }
  .cares { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2mm 7mm; margin-top: 3.6mm; }
  .cares li { position: relative; padding-left: 4.6mm; font-size: 9.5pt; line-height: 1.55; }
  .cares li::before { content: '!'; position: absolute; left: 0; top: 0.5mm; width: 3.4mm; height: 3.4mm; display: grid; place-items: center; background: var(--ink); color: #fff; font: 700 7.5pt/1 'Segoe UI', sans-serif; }
  `

  const cover = (who) => {
    const s = who === 'student'
    const items = s ? T.studentToc : T.teacherToc
    return `
<section class="sheet b-cover${s ? '' : ' t'}">
  <div class="hero bleed">
    <div class="hero-top"><span class="d">BUNKA GAKUEN UNIVERSITY</span><span>国際ファッション文化学科</span></div>
    <div class="year d">2026</div>
    <p class="kick">卒業制作報告書 作成ツール</p>
    <h1>使い方の手引き</h1>
    <p class="for"><b>${s ? '学生用' : '教員用'}</b><span class="d">${s ? 'FOR STUDENTS' : 'FOR FACULTY'}</span><span class="d">2026</span></p>
    <p class="hero-lead">${s ? T.studentLead : T.teacherLead}</p>
  </div>
  ${s
    ? `<figure class="pc bleed"><img src="shots/pc-full.png" alt=""></figure>
  <figure class="ph"><img src="shots/phone-write.png" alt=""></figure>`
    : `<figure class="pc bleed" style="top:104mm"><img src="shots/admin-main.png" alt=""></figure>`}
  <ol class="toc">${toc(items, ([n, t, , pg]) => `<li><span class="n d">${String(n).padStart(2, '0')}</span><span><b>${t}</b></span><span class="pg d">p.${pg}</span></li>`)}</ol>
  <footer class="foot bleed">
    <div class="qr">${qr}</div>
    <div>
      ${s
        ? `<p class="k">ツールを開く ─ スマホは QR コードで</p>
      <p class="url fn">${T.url}</p>
      <p>${T.login}。${T.firstOpen}。</p>`
        : `<p class="k">管理ページ ／ 学生に配る URL（QR コード）</p>
      <p>${T.adminUrl}</p>
      <p class="fn" style="margin-top:0.6mm;font-size:10pt">${T.url}</p>`}
    </div>
  </footer>
</section>`
  }

  const write = `
<section class="sheet b-inner">
  <div class="edge bleed"><span class="d">STUDENT GUIDE</span></div>
  <header class="b-ch">
    <span class="num d">03</span>
    <div><p class="kick2 d">CHAPTER 03 ─ WRITE</p><h1>本文を書く</h1><p class="lead">${T.writeLead}</p></div>
  </header>
  <div class="hero-row">
    ${shotFig('w-main', { hl: [3, 4, 5, 6] })}
    <div class="phone-col">
      <div class="frame">${shotFig('phone-write', { badges: [], hl: [1] })}</div>
      <h3>スマホでは</h3>
      <p>${T.phoneShort}</p>
    </div>
  </div>
  <ol class="grid3">${T.writeSteps.map((s) => `<li><div class="hd"><span class="no">${s.n}</span><b>${s.t}</b></div><p>${s.d}</p></li>`).join('')}</ol>
  <div class="strip">
    <div class="fig-row">
      ${shotFig('w-figure', { labels: { 1: 'A', 2: 'B' } })}
      <div><h3>図を入れると</h3><ol><li><span class="k">A</span><span>${T.figA}</span></li><li><span class="k">B</span><span>${T.figB}</span></li></ol></div>
    </div>
    <div class="dark"><h3 class="d">TIPS</h3><ul>${T.tips.map((t) => `<li>${t}</li>`).join('')}</ul></div>
  </div>
  <footer class="folio"><span>使い方の手引き　学生用　─　本文を書く</span><span class="d">06</span></footer>
</section>`

  const settings = `
<section class="sheet b-inner t">
  <div class="edge bleed"><span class="d">FACULTY GUIDE</span></div>
  <header class="b-ch">
    <span class="num d">03</span>
    <div><p class="kick2 d">CHAPTER 03 ─ SETTINGS</p><h1>年度の設定をする</h1><p class="lead">${T.setLead}</p></div>
  </header>
  ${shotFig('admin-main', { cls: 'set-shot', hl: [1, 7] })}
  <ol class="list2">${T.setSteps.map((s) => `<li><span class="no">${s.n}</span><b>${s.t}</b><p>${s.d}</p></li>`).join('')}</ol>
  <section class="flow-band">
    <h3 class="d">新しい年度の準備と公開</h3>
    <div class="shot-wrap">${shotFig('admin-draft', { badges: [], hl: [1, 2] })}</div>
    <ol class="chain">${T.flow.map(([t, d], i) => `<li><span class="d">STEP ${i + 1}</span><b>${t}</b><small>${d}</small></li>`).join('')}</ol>
  </section>
  <ul class="cares">${T.cautions.map((t) => `<li>${t}</li>`).join('')}</ul>
  <footer class="folio"><span>使い方の手引き　教員用　─　年度の設定をする</span><span class="d">04</span></footer>
</section>`

  return page('案B 雑誌風（v25 使い方の手引き）', css, cover('student') + write + cover('teacher') + settings)
}

// =====================================================================
// 案C「やわらか」：角の丸い枠・アイコン・余白多めで親しみやすく
// =====================================================================
function designC(qr) {
  const css = `
  :root { --ink: #2b2e36; --muted: #5f6470; --ai: #3a4c94; --soft: #eef1fa; --soft-2: #dfe5f6; --cream: #fbf5ea; --cream-2: #efe3cc; --coral: #c8573a; --line: #e2e5ee; }
  body { font-family: 'BIZ UDPGothic', sans-serif; color: var(--ink); font-size: 9.5pt; line-height: 1.65; }
  .shot { --mkr: 2.9mm; --mkgap: 0.7mm; }
  .shot .mk { width: 5.8mm; height: 5.8mm; border-radius: 50%; background: var(--coral); color: #fff; font: 700 10pt/1 'BIZ UDPGothic', sans-serif; box-shadow: 0 0 0 0.6mm #fff, 0 0.5mm 1.6mm rgba(120, 50, 30, 0.35); }
  .shot .mk.sub { background: var(--ai); font-family: 'Segoe UI', sans-serif; }
  .shot .hl { border: 0.5mm solid var(--coral); border-radius: 2mm; }
  .shot .ld { background: var(--coral); }
  .shot-card.room { padding-left: 9mm; }
  .round { border-radius: 3.4mm; overflow: hidden; }
  .chip { display: inline-flex; align-items: center; padding: 1mm 4mm; border-radius: 99mm; border: 0.35mm solid var(--ai); color: var(--ai); font-size: 10pt; font-weight: 700; letter-spacing: 0.08em; }
  .chip.solid { background: var(--ai); color: #fff; }
  .icon { width: 10mm; height: 10mm; flex: none; display: grid; place-items: center; border-radius: 50%; background: var(--soft); color: var(--ai); font-size: 6mm; }

  /* ---- 表紙 ---- */
  .c-cover { padding: 13mm 14mm 0; display: flex; flex-direction: column; gap: 6.5mm; }
  .c-top { display: flex; align-items: center; gap: 2.4mm; }
  .c-top .org { margin-left: auto; font-size: 9.5pt; color: var(--muted); letter-spacing: 0.06em; }
  .c-hero { position: relative; height: 140mm; padding: 11mm 12mm 0; border-radius: 7mm; background: var(--soft); overflow: hidden; }
  .t .c-hero { background: var(--cream); }
  .c-hero .tool { font-size: 12.5pt; font-weight: 700; color: var(--ai); letter-spacing: 0.06em; }
  .c-hero h1 { margin-top: 1mm; font-size: 33pt; line-height: 1.25; letter-spacing: 0.06em; }
  .c-hero .catch { margin-top: 2.4mm; font-size: 11.5pt; color: var(--muted); }
  .c-hero .dots { position: absolute; right: 12mm; top: 12mm; width: 38mm; height: 26mm; background: radial-gradient(circle, #c9d2ef 0.7mm, transparent 0.8mm) 0 0 / 5mm 5mm; }
  .t .c-hero .dots { background: radial-gradient(circle, #e6d3ae 0.7mm, transparent 0.8mm) 0 0 / 5mm 5mm; }
  .c-hero .pc { position: absolute; left: 40mm; bottom: -8mm; width: 134mm; margin: 0; padding: 1.6mm; border-radius: 3.6mm; background: #fff; box-shadow: 0 2mm 7mm rgba(40, 50, 90, 0.18); }
  .c-hero .pc img { display: block; width: 100%; border-radius: 2.2mm; }
  .c-hero .ph { position: absolute; left: 13mm; bottom: -6mm; width: 30mm; margin: 0; padding: 1.2mm; border-radius: 5mm; background: #2b2e36; box-shadow: 0 2mm 6mm rgba(40, 50, 90, 0.25); }
  .c-hero .ph img { display: block; width: 100%; border-radius: 3.8mm; }
  .flow3 { display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; gap: 2mm; align-items: center; }
  .flow3 .card { display: grid; grid-template-columns: auto 1fr; gap: 0 3mm; align-items: center; padding: 3.4mm 3.6mm; border-radius: 4mm; border: 0.35mm solid var(--line); }
  .flow3 .card b { font-size: 11pt; }
  .flow3 .card p { grid-column: 2; font-size: 9.5pt; line-height: 1.5; color: var(--muted); }
  .flow3 .card .icon { grid-row: span 2; }
  .flow3 > .ic { color: var(--coral); width: 5mm; height: 5mm; }
  .c-bottom { display: grid; grid-template-columns: 1fr 52mm; gap: 5mm; align-items: stretch; }
  .c-toc { padding: 4mm 5mm 4.4mm; border-radius: 4mm; background: #fff; border: 0.35mm solid var(--line); }
  .c-toc h2, .c-qr h2 { display: flex; align-items: center; gap: 2mm; font-size: 11pt; color: var(--ai); margin-bottom: 2mm; }
  .c-toc ol { display: grid; grid-template-columns: 1fr 1fr; gap: 1.6mm 5mm; }
  .c-toc li { display: grid; grid-template-columns: 6mm 1fr auto; gap: 2mm; align-items: center; font-size: 10pt; line-height: 1.35; }
  .c-toc .n { width: 5.6mm; height: 5.6mm; display: grid; place-items: center; border-radius: 50%; background: var(--soft); color: var(--ai); font-weight: 700; font-size: 9.5pt; }
  .c-toc .pg { font-size: 9pt; color: var(--muted); }
  .c-qr { padding: 4mm 4mm 4mm; border-radius: 4mm; background: var(--cream); text-align: center; display: flex; flex-direction: column; align-items: center; }
  .c-qr .q { width: 32mm; height: 32mm; padding: 2mm; border-radius: 2.4mm; background: #fff; }
  .c-qr .q svg { display: block; width: 100%; height: 100%; }
  .c-qr h2 { justify-content: center; }
  .c-qr p { margin-top: 2mm; font-size: 9pt; line-height: 1.45; color: var(--muted); }
  .c-login { display: flex; align-items: center; gap: 3mm; padding: 3mm 4mm; border-radius: 4mm; background: var(--soft); font-size: 9.5pt; }
  .t .c-login { background: var(--cream); }
  .c-login .icon { background: #fff; width: 8mm; height: 8mm; font-size: 4.6mm; }
  .c-login .fn { font-weight: 600; color: var(--ai); }

  /* ---- 中のページ ---- */
  .c-inner { padding: 12mm 14mm 0; display: flex; flex-direction: column; }
  .c-ch { display: flex; align-items: center; gap: 4mm; }
  .c-ch .no { width: 15mm; height: 15mm; flex: none; display: grid; place-items: center; border-radius: 50%; background: var(--ai); color: #fff; font-size: 22pt; font-weight: 700; }
  .c-ch .kick { font-size: 9.5pt; font-weight: 700; color: var(--coral); letter-spacing: 0.14em; }
  .c-ch h1 { font-size: 23pt; line-height: 1.25; letter-spacing: 0.05em; }
  .c-ch .tag { margin-left: auto; align-self: flex-start; }
  .c-lead { margin: 4mm 0 0; padding: 3mm 4.4mm; border-radius: 4mm; background: var(--soft); font-size: 10pt; line-height: 1.7; }
  .t .c-lead { background: var(--cream); }
  .c-main { display: grid; grid-template-columns: 102mm 1fr; gap: 6mm; margin-top: 6mm; align-items: start; }
  .c-left { display: grid; gap: 4mm; }
  .shot-card { padding: 2mm; border-radius: 4mm; background: #fff; border: 0.35mm solid var(--line); box-shadow: 0 1mm 4mm rgba(40, 50, 90, 0.08); }
  .shot-card .shot > img { border-radius: 2.4mm; }
  .c-steps { display: grid; gap: 2.2mm; }
  .c-steps li { display: grid; grid-template-columns: 9mm 1fr; gap: 0 2.6mm; align-items: start; }
  .c-steps .icon { position: relative; grid-row: span 2; width: 9mm; height: 9mm; font-size: 5mm; }
  .c-steps .icon i, .c-list2 .icon i { position: absolute; right: -1.8mm; top: -1.8mm; width: 5.2mm; height: 5.2mm; display: grid; place-items: center; border-radius: 50%; background: var(--coral); color: #fff; font: 700 9.5pt/1 'BIZ UDPGothic', sans-serif; font-style: normal; box-shadow: 0 0 0 0.45mm #fff; }
  .c-steps b { font-size: 10.5pt; line-height: 1.45; }
  .c-steps p { font-size: 9.5pt; line-height: 1.55; }
  .c-row { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 4mm; margin-top: 6mm; align-items: stretch; }
  .soft { padding: 3mm 3.4mm 3.4mm; border-radius: 4mm; background: var(--cream); }
  .soft h3 { display: flex; align-items: center; gap: 1.6mm; margin-bottom: 2mm; font-size: 10.5pt; color: var(--ai); }
  .soft h3 .ic { width: 4.6mm; height: 4.6mm; }
  .soft .shot > img { border-radius: 2mm; border: 0.3mm solid var(--cream-2); }
  .soft p, .soft li { font-size: 9.5pt; line-height: 1.55; }
  .soft p { margin-top: 2mm; }
  .soft ol { margin-top: 2mm; display: grid; gap: 1mm; }
  .soft li { display: grid; grid-template-columns: 4.8mm 1fr; gap: 1.2mm; }
  .soft .k { width: 4.6mm; height: 4.6mm; margin-top: 0.3mm; display: grid; place-items: center; border-radius: 50%; background: var(--ai); color: #fff; font: 700 9pt/1 'Segoe UI', sans-serif; }
  .soft .narrow { width: 70%; margin: 0 auto; }
  .bubble { position: relative; display: flex; align-items: flex-start; gap: 3mm; padding: 3.2mm 4.4mm; border-radius: 4mm; border: 0.35mm solid var(--soft-2); background: #fff; }
  .bubble .icon { width: 9mm; height: 9mm; font-size: 5mm; background: var(--cream); color: var(--coral); }
  .bubble ul { display: grid; gap: 0.8mm; flex: 1; }
  .bubble li { position: relative; padding-left: 3.6mm; font-size: 9.5pt; line-height: 1.55; }
  .bubble li::before { content: ''; position: absolute; left: 0; top: 2mm; width: 1.6mm; height: 1.6mm; border-radius: 50%; background: var(--coral); }
  .bubble b { display: block; font-size: 10.5pt; color: var(--coral); margin-bottom: 0.6mm; }
  .folio { margin-top: auto; padding: 3mm 0 6mm; display: flex; justify-content: center; }
  .folio span { min-width: 9mm; height: 6mm; padding: 0 2mm; display: grid; place-items: center; border-radius: 99mm; background: var(--soft); color: var(--ai); font-size: 9pt; font-weight: 700; }
  /* 年度の設定 */
  .set-card { margin-top: 4.5mm; }
  .c-list2 { display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 6mm; margin-top: 4.5mm; }
  .c-list2 li { display: grid; grid-template-columns: 9mm 1fr; gap: 0 2.6mm; align-items: start; }
  .c-list2 .icon { position: relative; grid-row: span 2; width: 9mm; height: 9mm; font-size: 5mm; }
  .c-list2 b { font-size: 10.5pt; line-height: 1.45; }
  .c-list2 p { font-size: 9.5pt; line-height: 1.5; }
  .c-row2 { display: grid; grid-template-columns: 1.1fr 1fr; gap: 5mm; margin-top: 4mm; align-items: stretch; }
  .steps4 { display: grid; gap: 1.2mm; margin-top: 2.2mm; }
  .steps4 li { display: grid; grid-template-columns: 6mm 1fr; gap: 2mm; align-items: center; padding: 1.1mm 2.4mm; border-radius: 99mm; background: #fff; font-size: 9.5pt; line-height: 1.4; }
  .steps4 .n { width: 5.6mm; height: 5.6mm; display: grid; place-items: center; border-radius: 50%; background: var(--ai); color: #fff; font-weight: 700; font-size: 9.5pt; }
  .steps4 small { margin-left: 1.6mm; font-size: 9.5pt; color: var(--muted); }
  .soft.blue { background: var(--soft); }
  .care-list li { display: grid; grid-template-columns: 4.6mm 1fr; gap: 1.6mm; }
  .care-list .ic { width: 4.4mm; height: 4.4mm; margin-top: 0.5mm; color: var(--coral); }
  `

  const cover = (who) => {
    const s = who === 'student'
    const items = s ? T.studentToc : T.teacherToc
    const flow = s
      ? [['pencil', '書く', '表紙から作品写真まで、決まった形のまま'], ['check', '確かめる', '手順書のルールをセルフチェック'], ['doc', '提出する', '1つの PDF にして提出']]
      : [['calendar', '年度をつくる', '前の年度をコピーして準備'], ['pencil', '設定する', '題目・コース・指導教員・締切'], ['publish', '公開する', '学生のツールに反映']]
    return `
<section class="sheet c-cover${s ? '' : ' t'}">
  <div class="c-top"><span class="chip">2026年度</span><span class="chip solid">${s ? '学生用' : '教員用'}</span><span class="org">文化学園大学　国際ファッション文化学科</span></div>
  <div class="c-hero">
    <div class="dots"></div>
    <p class="tool">卒業制作報告書 作成ツール</p>
    <h1>使い方の手引き</h1>
    <p class="catch">${s ? 'はじめて開く日から、提出の日まで。' : '管理ページで、その年度の設定をととのえる。'}</p>
    ${s
      ? `<figure class="pc"><img src="shots/pc-full.png" alt=""></figure>
    <figure class="ph"><img src="shots/phone-write.png" alt=""></figure>`
      : `<figure class="pc" style="left:24mm;width:150mm"><img src="shots/admin-main.png" alt=""></figure>`}
  </div>
  <div class="flow3">${flow.map(([i, t, d], k) => `${k ? IC.arrow : ''}<div class="card"><span class="icon">${IC[i]}</span><b>${t}</b><p>${d}</p></div>`).join('')}</div>
  <div class="c-bottom">
    <div class="c-toc">
      <h2>${IC.list}もくじ</h2>
      <ol>${toc(items, ([n, t, , pg]) => `<li><span class="n">${n}</span><span>${t}</span><span class="pg">p.${pg}</span></li>`)}</ol>
    </div>
    <div class="c-qr">
      <h2>${IC.phone}${s ? 'スマホで開く' : '学生に配る URL'}</h2>
      <div class="q">${qr}</div>
      <p class="fn">${T.url.replace('https://', '')}</p>
    </div>
  </div>
  <div class="c-login"><span class="icon">${IC.login}</span><span>${s ? `${T.login}。${T.firstOpen}。` : T.adminUrl}</span></div>
</section>`
  }

  const step = (s) => `<li><span class="icon">${IC[s.icon]}<i>${s.n}</i></span><b>${s.t}</b><p>${s.d}</p></li>`

  const write = `
<section class="sheet c-inner">
  <header class="c-ch"><span class="no">3</span><div><p class="kick">STEP 3</p><h1>本文を書く</h1></div><span class="chip tag">学生用</span></header>
  <p class="c-lead">${T.writeLead}</p>
  <div class="c-main">
    <div class="c-left">
      <div class="shot-card">${shotFig('w-main', { hl: [3, 4, 5, 6] })}</div>
      <div class="bubble"><span class="icon">${IC.bulb}</span><div style="flex:1"><b>知っておくと安心</b><ul>${T.tips.map((t) => `<li>${t}</li>`).join('')}</ul></div></div>
    </div>
    <ol class="c-steps">${T.writeSteps.map(step).join('')}</ol>
  </div>
  <div class="c-row">
    <section class="soft"><h3>${IC.image}図を入れると</h3>${shotFig('w-figure', { labels: { 1: 'A', 2: 'B' } })}<ol><li><span class="k">A</span><span>${T.figA}</span></li><li><span class="k">B</span><span>${T.figB}</span></li></ol></section>
    <section class="soft"><h3>${IC.table}表を選ぶ</h3><div class="narrow">${shotFig('w-table', { badges: [], hl: [1, 2] })}</div><p>${T.table}</p></section>
    <section class="soft blue"><h3>${IC.phone}スマホでは</h3>${shotFig('phone-sheet', { badges: [], hl: [1] })}<p>${T.phone}</p></section>
  </div>
  <footer class="folio"><span>6</span></footer>
</section>`

  const settings = `
<section class="sheet c-inner t">
  <header class="c-ch"><span class="no">3</span><div><p class="kick">管理ページ</p><h1>年度の設定をする</h1></div><span class="chip tag">教員用</span></header>
  <p class="c-lead">${T.setLead}</p>
  <div class="shot-card set-card room">${shotFig('admin-main', { hl: [1, 7] })}</div>
  <ol class="c-list2">${T.setSteps.map(step).join('')}</ol>
  <div class="c-row2">
    <section class="soft blue">
      <h3>${IC.publish}新しい年度の準備と公開</h3>
      ${shotFig('admin-draft', { badges: [], hl: [1, 2] })}
      <ol class="steps4">${T.flow.map(([t, d], i) => `<li><span class="n">${i + 1}</span><span><b>${t}</b><small>${d}</small></span></li>`).join('')}</ol>
    </section>
    <section class="soft">
      <h3>${IC.warn}気をつけること</h3>
      <ul class="care-list">${T.cautions.map((t) => `<li>${IC.check}<span>${t}</span></li>`).join('')}</ul>
    </section>
  </div>
  <footer class="folio"><span>4</span></footer>
</section>`

  return page('案C やわらか（v25 使い方の手引き）', css, cover('student') + write + cover('teacher') + settings)
}

// =====================================================================
// 案ごとの HTML を書き出し、PDF とページの画像にする
// =====================================================================
const DESIGNS = Object.fromEntries(
  [
    ['a', typeof designA === 'function' ? designA : null, '#1d2030'],
    ['b', typeof designB === 'function' ? designB : null, '#14161b'],
    ['c', typeof designC === 'function' ? designC : null, '#2f3e75'],
  ]
    .filter(([, f]) => f)
    .map(([k, f, qrColor]) => [k, { make: f, qrColor }]),
)

async function writePages() {
  for (const [key, { make, qrColor }] of Object.entries(DESIGNS)) {
    // QR コード（学生用ツールの URL）。白黒で印刷しても読めるよう、濃い色にする
    const qr = await QRCode.toString(TOOL_URL, { type: 'svg', errorCorrectionLevel: 'M', margin: 0, color: { dark: qrColor, light: '#ffffff' } })
    writeFileSync(`${V}/${key}.html`, make(qr))
    console.log(`  ${V}/${key}.html`)
  }
}

async function makePdfs(browser) {
  for (const key of Object.keys(DESIGNS)) {
    const html = `${V}/${key}.html`
    const pdf = `${V}/${key}.pdf`
    const page = await browser.newPage()
    page.on('pageerror', (e) => console.log('pageerror(pdf):', e.message))
    page.on('requestfailed', (r) => console.log('読み込めなかったもの:', r.url()))
    await page.setViewport({ width: 1000, height: 1200 })
    await page.emulateMediaType('print')
    await page.goto(pathToFileURL(resolve(html)).href, { waitUntil: 'networkidle0' })
    await page.evaluate(() => document.fonts.ready)
    const check = await page.evaluate(() => {
      const fonts = ['BIZ UDPGothic', 'BIZ UDMincho'].filter((f) => !document.fonts.check(`16px "${f}"`))
      const images = [...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.getAttribute('src'))
      // 用紙（A4）の下の端からはみ出していないか（わざと用紙の外まで伸ばすもの .bleed は除く）
      const over = [...document.querySelectorAll('.sheet')].map((s, i) => {
        const r = s.getBoundingClientRect()
        let max = 0
        let who = ''
        for (const e of s.querySelectorAll('*')) {
          if (e.closest('.bleed, svg')) continue
          const q = e.getBoundingClientRect()
          if (!q.width || !q.height) continue
          if (q.bottom - r.bottom > max) {
            max = q.bottom - r.bottom
            who = `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}「${e.textContent.trim().slice(0, 14)}」`
          }
        }
        return { page: i + 1, over: Math.round(max), who }
      })
      // 文字の大きさ（pt）ごとに、どこで使っているか（画面の画像の上の番号は除く）
      const sizes = {}
      for (const e of document.querySelectorAll('.sheet *')) {
        if (e.closest('svg')) continue
        if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue
        const pt = Math.round(parseFloat(getComputedStyle(e).fontSize) * 0.75 * 10) / 10
        ;(sizes[pt] ??= []).push(`${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}「${e.textContent.trim().slice(0, 10)}」`)
      }
      return { fonts, images, over, sizes }
    })
    if (check.fonts.length) console.log(`！ ${key}：書体を読み込めませんでした：${check.fonts.join(', ')}`)
    if (check.images.length) console.log(`！ ${key}：読み込めなかった画像：${check.images.join(', ')}`)
    for (const o of check.over) if (o.over > 0) console.log(`！ ${key} ${o.page}ページ：用紙から ${o.over}px はみ出しています（${o.who}）`)
    const small = Object.keys(check.sizes).map(Number).filter((pt) => pt < 9.5).sort((a, b) => a - b)
    console.log(`  ${key}：いちばん小さい文字 ${Math.min(...Object.keys(check.sizes).map(Number))}pt。9.5pt より小さいもの：${small.map((pt) => `${pt}pt（${[...new Set(check.sizes[pt].map((x) => x.replace(/「.*$/, '')))].join(' ')}）`).join('　') || 'なし'}`)
    await page.pdf({ path: pdf, printBackground: true, preferCSSPageSize: true })
    await page.close()
    const doc = await getDocument({ data: new Uint8Array(readFileSync(pdf)), useSystemFonts: false, verbosity: 0 }).promise
    console.log(`  ${pdf}（${doc.numPages}ページ）`)
    if (doc.numPages !== 4) console.log(`！ ${key}：4ページになっていません`)

    // PDF をページごとの画像にする（scripts/poc/pdf-shots.mjs と同じ、pdf.js で描いたもの）。白黒で印刷したときの見え方も作る
    const view = await browser.newPage()
    await view.setViewport({ width: 1300, height: 1800, deviceScaleFactor: 1 })
    await view.goto(`${APP}/poc-pdf.html?file=${encodeURIComponent(pdf)}&scale=2`, { waitUntil: 'networkidle0' })
    await view.waitForFunction(() => document.body.dataset.rendered === 'true', { timeout: 120000 })
    const canvases = await view.$$('canvas')
    for (const [i, c] of canvases.entries()) await c.screenshot({ path: `${SCREENS}/${key}-${i + 1}.png` })
    await view.addStyleTag({ content: 'canvas { filter: grayscale(1); }' })
    for (const [i, c] of canvases.entries()) await c.screenshot({ path: `${SCREENS}/${key}-${i + 1}-gray.png` })
    console.log(`  ${SCREENS}/${key}-1〜${canvases.length}.png（白黒：-gray.png）`)
    await view.close()
  }
}

// Edge は1回だけ起動する（続けて起動し直すと、閉じかけの Edge に接続しようとして失敗することがあるため）
await withEdge(async (browser) => {
  if (want('shots')) {
    console.log('画面の画像を撮ります')
    await takeShots(browser)
  }
  if (want('pages')) {
    console.log('案ごとの HTML を作ります')
    await writePages()
  }
  if (want('pdf')) {
    console.log('PDF とページの画像を作ります')
    await makePdfs(browser)
  }
  if (want('review')) {
    const page = await browser.newPage()
    await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 })
    await page.goto(`${APP}/${V}/review.html`, { waitUntil: 'networkidle0' })
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `${SCREENS}/review.png`, fullPage: true })
    console.log(`  ${SCREENS}/review.png`)
  }
})
