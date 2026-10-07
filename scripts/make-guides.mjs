// 使い方の手引き（学生用・先生用・管理者用。どれも A4 片面1枚の PDF）を作る。デザインは案B「雑誌風」（mockups/v25/b.html）を
// 軽くした案C2（mockups/v26 の c2・t-c2）。くわしいことは、ツールと管理ページの「？ 使い方」に任せる。
//   1. 本物のツール（学生用ツール・管理ページの試験版）を Edge で操作して、画面の画像を撮る（docs/guide-images/g-*.jpg）。
//      番号の吹き出しを付ける場所（画面の部品の位置）も書き出す（docs/guide-images/marks.js。HTML の中の guide.js が読んで重ねる）
//   2. ツールの URL の QR コードを作る（docs/guide-images/qr-guide.svg）
//      手引きで使っていない画像も撮っている（前の版の手引きで使っていたもの。デザイン案 mockups/v26・v27 が読む）
//   3. 手引きの HTML（docs/手引き_学生用.html・手引き_先生用.html・手引き_管理者用.html。文は HTML に手で書く）を Edge で PDF にする。
//      ページ数（1ページ）・用紙からのはみ出し・文字の大きさ（本文 10.5pt 以上）・1ページの文字数（350字まで）・書体・画像を確かめ、
//      外れていたら失敗にする
//   4. PDF を public/guides/（student-guide.pdf・teacher-guide.pdf（先生用）・admin-guide.pdf（管理者用））に写す（GitHub Pages で公開される）
// 使い方: node scripts/make-guides.mjs            … 画面を撮り直して PDF を作る（開発サーバーが http://localhost:5173 で動いていること）
//         node scripts/make-guides.mjs --pdf-only … HTML の文だけを直したあと、PDF だけ作り直す（画面は撮り直さない）
//   SHOTS=student（学生用ツール。スマホも）／SHOTS=admin（管理ページ） node scripts/make-guides.mjs … 画面の画像を一部だけ撮り直す
//   Edge は EDGE_PORT（ふだんは 9364）で起動する（ほかの確かめと同時に動かしてもぶつからないように）
//
// 見本の原稿：衣装コースの学生が書いた想定（人名・学籍番号・メールアドレスは架空）。本物の Google にはつながない
// （学生用ツールは Google のログインとドライブを偽物 scripts/e2e/fakeGoogle.mjs に差し替え、管理ページは試験版）。
// 見本の原稿の画像（デザイン画・作品写真・生地見本など）は、依頼者が画像生成で作って「../手引き用の画像/」に置く
// （ファイル名はそのフォルダの「作る画像の一覧と指示文.md」。png でも jpg でもよい）。あればツールと同じ読み込みで縮めて見本の原稿に入れ、
// 縮めたものを docs/guide-images/sample/ に写す。ないものは仮の絵で撮る。
// 画像が届いたら、node scripts/make-guides.mjs だけで作り直せる。
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import QRCode from 'qrcode'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

// ほかの確かめと同時に動かしても Edge がぶつからないよう、別のポートを使う（edge.mjs は読み込んだときにポートを決めるので、先に決める）
process.env.EDGE_PORT ??= '9364'
const { withEdge } = await import('./poc/edge.mjs')
const { fakeDrive, routeGoogle } = await import('./e2e/fakeGoogle.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
/** 学生に配るツールの URL（QR コードにする。GitHub のリポジトリを移したら、ここと HTML の URL を直す） */
const TOOL_URL = 'https://junnosukekato.github.io/sotsugyo-seisaku-report/'
const IMG = 'docs/guide-images'
const SAMPLE_OUT = `${IMG}/sample`
/** 依頼者が作る見本の画像の置き場所（公開のリポジトリの外） */
const SAMPLE_IN = resolve('..', '手引き用の画像')
const GUIDES = [
  { html: 'docs/手引き_学生用.html', pdf: 'docs/手引き_学生用.pdf', publish: 'public/guides/student-guide.pdf', pages: 1 },
  { html: 'docs/手引き_先生用.html', pdf: 'docs/手引き_先生用.pdf', publish: 'public/guides/teacher-guide.pdf', pages: 1 },
  { html: 'docs/手引き_管理者用.html', pdf: 'docs/手引き_管理者用.pdf', publish: 'public/guides/admin-guide.pdf', pages: 1 },
]
/** 本文の文字の大きさの下限（pt）。柱・ページ番号・英字の飾りの見出し（MIN_EXEMPT）は除く */
const MIN_PT = 10.5
const MIN_EXEMPT = '.folio, .edge, .hero-top, .kick2, .year, .shot .mk, .lh .k'
/** 1ページの文字数の上限（学生は長い文を読まないため）。数えるのは、ひらがな・カタカナ・漢字と全角の記号（英数字・URL は数えない） */
const MAX_CHARS = 350
const JP = /[\u3000-\u30ff\u4e00-\u9fff\uff00-\uffef]/g
const pdfOnly = process.argv.includes('--pdf-only')
const SHOT_ONLY = (process.env.SHOTS ?? '').split(',').filter(Boolean)
const doShot = (k) => !SHOT_ONLY.length || SHOT_ONLY.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PC = { width: 1440, height: 900, deviceScaleFactor: 2 }
const PHONE = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
/** 見本の学生のアカウント（架空。@ より前が学籍番号） */
const STUDENT_EMAIL = '00zz0123@bunka-wu.ac.jp'
mkdirSync(IMG, { recursive: true })
mkdirSync('poc-output/guides', { recursive: true })
mkdirSync('public/guides', { recursive: true })

// =====================================================================
// 見本の原稿の画像
// =====================================================================

/**
 * 見本の原稿に使う画像。file：依頼者が作る画像のファイル名（拡張子は png・jpg・jpeg・webp のどれでもよい。同じ名前なら png を先に使う）。
 * max：見本の原稿に入れるときの長い辺（px。手引きに写る大きさには十分で、軽くなるように）。w・h：ない（まだ届いていない）ときに描く仮の絵の大きさ（一覧の形と同じ縦横の比）
 */
const SAMPLE_IMAGES = [
  { id: 'g-design', file: 'design', max: 1200, w: 900, h: 1200, what: 'デザイン画' },
  { id: 'g-mood', file: 'moodboard', max: 1200, w: 1200, h: 900, what: 'イメージボード' },
  { id: 'g-process', file: 'process', max: 1200, w: 1200, h: 900, what: '制作過程（袖の刺繍）' },
  { id: 'g-photo1', file: 'photo-1', max: 1200, w: 900, h: 1200, what: '作品写真' },
  { id: 'g-satin', file: 'swatch-satin', max: 800, w: 400, h: 400, what: '生地見本（コットンサテン）' },
  { id: 'g-chiffon', file: 'swatch-chiffon', max: 800, w: 400, h: 400, what: '生地見本（シルクシフォン）' },
  { id: 'g-broad', file: 'swatch-broad', max: 800, w: 400, h: 400, what: '生地見本（コットンブロード）' },
]

/** 依頼者の画像があれば読み込む（data: URL）。なければ data: null（ページの中で仮の絵を描く） */
function loadSampleImages() {
  const found = []
  const list = SAMPLE_IMAGES.map((s) => {
    const ext = ['.png', '.PNG', '.jpg', '.JPG', '.jpeg', '.JPEG', '.webp'].find((e) => existsSync(join(SAMPLE_IN, s.file + e)))
    if (!ext) return { ...s, data: null }
    found.push(s.file + ext)
    const type = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[ext.toLowerCase()]
    return { ...s, data: `data:${type};base64,${readFileSync(join(SAMPLE_IN, s.file + ext)).toString('base64')}` }
  })
  const missing = SAMPLE_IMAGES.filter((s) => !list.find((x) => x.id === s.id).data).map((s) => s.file)
  console.log(found.length ? `  見本の画像：${found.join('・')}${missing.length ? `（まだないもの ${missing.join('・')} は仮の絵）` : ''}` : `  見本の画像：${SAMPLE_IN} にないので、仮の絵で撮ります`)
  return list
}

/**
 * 見本の原稿に入れた依頼者の画像（ツールの読み込みで縮めたもの）を、docs/guide-images/sample/ に写す（公開してよいと依頼者が了承済み）。
 * 元の大きな画像ではなく、長い辺を max（図・作品写真 1200px、生地見本 800px）に縮め、画質 0.8 の JPEG にしたものを置く（リポジトリを重くしないため）
 */
function saveSampleImages(saved) {
  if (!saved.length) return
  mkdirSync(SAMPLE_OUT, { recursive: true })
  for (const { file, base64 } of saved) writeFileSync(join(SAMPLE_OUT, `${file}.jpg`), Buffer.from(base64, 'base64'))
  console.log(`  使った見本の画像を ${SAMPLE_OUT}/ に写しました（${saved.map((s) => `${s.file}.jpg`).join('・')}）`)
}

/**
 * ページの中で、見本の画像を用意する。依頼者の画像は、ツールで写真を選んだときと同じ読み込み（src/model/images.ts の importImage：
 * 長い辺を縮めて JPEG にする。長い辺は SAMPLE_IMAGES の max）を通す。ないものは仮の絵を描く。
 * 仮の絵は、依頼者の画像と同じ構成（デザイン画・イメージボード・制作過程・作品写真1枚・生地見本3つ）
 */
async function prepareImages(list) {
  const { importImage } = await import('/src/model/images.ts')
  const toBlob = (c) => new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
  // 人の形（デザイン画は白い紙に描いた絵、作品写真は濃い紺の背景で頭のないボディに着せたもの）
  const figure = (g, w, h, { photo }) => {
    const cx = w / 2
    const u = h / 100
    if (photo) {
      const grd = g.createRadialGradient(cx, h * 0.42, h * 0.05, cx, h * 0.5, h * 0.7)
      grd.addColorStop(0, '#2c3a66')
      grd.addColorStop(1, '#0d1430')
      g.fillStyle = grd
      g.fillRect(0, 0, w, h)
      g.fillStyle = 'rgba(0,0,0,0.35)'
      g.beginPath(); g.ellipse(cx, 92 * u, 20 * u, 2.2 * u, 0, 0, Math.PI * 2); g.fill()
      // ボディの台
      g.fillStyle = '#6b5a45'
      g.fillRect(cx - 0.8 * u, 86 * u, 1.6 * u, 6 * u)
    } else {
      g.fillStyle = '#fbfaf6'
      g.fillRect(0, 0, w, h)
    }
    const alpha = photo ? 1 : 0.88
    g.globalAlpha = alpha
    // 袖（大きく膨らむ）
    g.fillStyle = '#26407a'
    g.beginPath(); g.ellipse(cx - 15 * u, 36 * u, 7 * u, 13 * u, 0.4, 0, Math.PI * 2); g.fill()
    g.beginPath(); g.ellipse(cx + 15 * u, 36 * u, 7 * u, 13 * u, -0.4, 0, Math.PI * 2); g.fill()
    // 袖の波の刺繍
    g.strokeStyle = '#d6aa45'
    g.lineWidth = 0.5 * u
    for (const side of [-1, 1]) {
      g.beginPath()
      for (let t = 0; t <= 1; t += 0.05) g.lineTo(cx + side * (11 + t * 8) * u, (40 + Math.sin(t * 12) * 1.2) * u)
      g.stroke()
    }
    // 胴
    g.fillStyle = '#26407a'
    g.beginPath(); g.moveTo(cx - 9 * u, 22 * u); g.lineTo(cx + 9 * u, 22 * u); g.lineTo(cx + 12 * u, 50 * u); g.lineTo(cx - 12 * u, 50 * u); g.closePath(); g.fill()
    // 帯（からし色）
    g.fillStyle = '#d6a131'
    g.fillRect(cx - 12.5 * u, 46 * u, 25 * u, 6 * u)
    g.beginPath(); g.moveTo(cx + 6 * u, 51 * u); g.lineTo(cx + 9 * u, 62 * u); g.lineTo(cx + 5 * u, 62 * u); g.closePath(); g.fill()
    // ズボン（生成り）
    g.fillStyle = '#efe7d4'
    g.beginPath(); g.moveTo(cx - 12 * u, 52 * u); g.lineTo(cx + 12 * u, 52 * u); g.lineTo(cx + 9 * u, 86 * u); g.lineTo(cx + 2 * u, 86 * u); g.lineTo(cx, 62 * u); g.lineTo(cx - 2 * u, 86 * u); g.lineTo(cx - 9 * u, 86 * u); g.closePath(); g.fill()
    g.globalAlpha = 1
    if (photo) {
      // 頭のないボディ：首の台
      g.fillStyle = '#d9cdb8'
      g.fillRect(cx - 2.6 * u, 16 * u, 5.2 * u, 6.5 * u)
    } else {
      // デザイン画：頭と帽子、輪郭の線、紙の端の色
      g.fillStyle = '#ead2b8'
      g.beginPath(); g.arc(cx, 15 * u, 5 * u, 0, Math.PI * 2); g.fill()
      g.fillStyle = '#d6a131'
      g.beginPath(); g.ellipse(cx, 11.5 * u, 6 * u, 3.6 * u, 0, Math.PI, 0); g.fill()
      g.strokeStyle = 'rgba(40,40,50,0.55)'
      g.lineWidth = 0.25 * u
      g.strokeRect(cx - 12.5 * u, 46 * u, 25 * u, 6 * u)
      g.beginPath(); g.moveTo(cx - 9 * u, 22 * u); g.lineTo(cx - 12 * u, 50 * u); g.moveTo(cx + 9 * u, 22 * u); g.lineTo(cx + 12 * u, 50 * u); g.stroke()
    }
  }
  const board = (g, w, h) => {
    g.fillStyle = '#f6f3ec'
    g.fillRect(0, 0, w, h)
    const block = (x, y, bw, bh, color, rot = 0) => {
      g.save(); g.translate(x + bw / 2, y + bh / 2); g.rotate(rot)
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(-bw / 2 + 6, -bh / 2 + 8, bw, bh)
      g.fillStyle = color; g.fillRect(-bw / 2, -bh / 2, bw, bh)
      g.restore()
    }
    block(60, 60, 480, 360, '#26407a', -0.02)
    block(580, 70, 260, 200, '#d6a131', 0.03)
    block(870, 60, 270, 220, '#e8dcc0', -0.04)
    block(590, 310, 550, 170, '#7fb0cf', 0.01)
    block(60, 470, 320, 360, '#d9c7a4', 0.02)
    block(410, 520, 380, 300, '#1c2a52', -0.03)
    block(830, 520, 310, 310, '#efe7d6', 0.04)
    g.strokeStyle = 'rgba(255,255,255,0.75)'
    g.lineWidth = 8
    for (let k = 0; k < 4; k++) {
      g.beginPath()
      for (let x = 90; x <= 510; x += 10) g.lineTo(x, 140 + k * 70 + Math.sin(x / 30) * 16)
      g.stroke()
    }
    g.strokeStyle = 'rgba(214,161,49,0.95)'
    g.lineWidth = 7
    g.beginPath()
    for (let x = 440; x <= 760; x += 10) g.lineTo(x, 660 + Math.sin(x / 24) * 22)
    g.stroke()
    // ロープ
    g.strokeStyle = '#b48a55'
    g.lineWidth = 12
    g.beginPath(); g.arc(990, 680, 90, 0.3, Math.PI * 1.7); g.stroke()
  }
  const process = (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, h)
    grd.addColorStop(0, '#9c8466')
    grd.addColorStop(1, '#6f5b44')
    g.fillStyle = grd
    g.fillRect(0, 0, w, h)
    // 藍の布
    g.fillStyle = '#22396e'
    g.beginPath(); g.moveTo(80, 120); g.lineTo(1120, 60); g.lineTo(1150, 840); g.lineTo(60, 860); g.closePath(); g.fill()
    // 刺繍枠
    g.strokeStyle = '#c99a5b'
    g.lineWidth = 30
    g.beginPath(); g.arc(600, 450, 290, 0, Math.PI * 2); g.stroke()
    g.strokeStyle = '#a77b43'
    g.lineWidth = 6
    g.beginPath(); g.arc(600, 450, 308, 0, Math.PI * 2); g.stroke()
    // 金の波（刺繍の途中）
    g.strokeStyle = '#e0b552'
    g.lineWidth = 9
    for (let k = 0; k < 3; k++) {
      g.beginPath()
      const end = k === 2 ? 640 : 800
      for (let x = 380; x <= end; x += 8) g.lineTo(x, 360 + k * 90 + Math.sin(x / 26) * 22)
      g.stroke()
    }
    // 糸と針
    g.strokeStyle = 'rgba(224,181,82,0.9)'
    g.lineWidth = 3
    g.beginPath(); g.moveTo(640, 545); g.quadraticCurveTo(820, 520, 930, 640); g.stroke()
    g.strokeStyle = '#d8d8d8'
    g.lineWidth = 4
    g.beginPath(); g.moveTo(930, 640); g.lineTo(1010, 720); g.stroke()
  }
  const swatch = (base, line, sheen) => (g, w, h) => {
    g.fillStyle = '#fbfaf7'
    g.fillRect(0, 0, w, h)
    const m = w * 0.1
    // ピンキングの縁
    g.fillStyle = base
    g.beginPath()
    const z = w / 40
    for (let x = m; x <= w - m; x += z) g.lineTo(x, m + ((x / z) % 2 < 1 ? 0 : z * 0.6))
    for (let y = m; y <= h - m; y += z) g.lineTo(w - m - ((y / z) % 2 < 1 ? 0 : z * 0.6), y)
    for (let x = w - m; x >= m; x -= z) g.lineTo(x, h - m - ((x / z) % 2 < 1 ? 0 : z * 0.6))
    for (let y = h - m; y >= m; y -= z) g.lineTo(m + ((y / z) % 2 < 1 ? 0 : z * 0.6), y)
    g.closePath(); g.fill()
    if (sheen) {
      const grd = g.createLinearGradient(m, m, w - m, h - m)
      grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.45, sheen); grd.addColorStop(0.6, 'rgba(255,255,255,0)')
      g.fillStyle = grd
      g.fillRect(m, m, w - 2 * m, h - 2 * m)
    }
    g.strokeStyle = line
    g.lineWidth = 1
    for (let x = m; x < w - m; x += 3) { g.beginPath(); g.moveTo(x, m); g.lineTo(x, h - m); g.stroke() }
  }
  const DRAW = {
    'g-design': (g, w, h) => figure(g, w, h, { photo: false }),
    'g-mood': board,
    'g-process': process,
    'g-photo1': (g, w, h) => figure(g, w, h, { photo: true }),
    'g-satin': swatch('#22396e', 'rgba(255,255,255,0.05)', 'rgba(255,255,255,0.28)'),
    'g-chiffon': swatch('rgba(236,228,206,0.85)', 'rgba(0,0,0,0.04)', null),
    'g-broad': swatch('#efe6d2', 'rgba(0,0,0,0.05)', null),
  }
  const made = []
  for (const s of list) {
    if (s.data) {
      const file = await (await fetch(s.data)).blob()
      made.push(await importImage(file, s.id, s.max))
      continue
    }
    const c = document.createElement('canvas')
    c.width = s.w
    c.height = s.h
    DRAW[s.id](c.getContext('2d'), s.w, s.h)
    made.push({ id: s.id, blob: await toBlob(c), widthPx: c.width, heightPx: c.height })
  }
  window.__editor.addImages(made)
  // 依頼者の画像を縮めたもの（docs/guide-images/sample/ に写す）
  const base64 = (blob) =>
    new Promise((r) => {
      const fr = new FileReader()
      fr.onload = () => r(String(fr.result).split(',')[1])
      fr.readAsDataURL(blob)
    })
  const saved = []
  // 元の画像から、長い辺 max・画質 0.8 で作り直す（リポジトリに置くので軽く）
  for (const s of list) {
    if (!s.data) continue
    const bitmap = await createImageBitmap(await (await fetch(s.data)).blob())
    const k = Math.min(1, s.max / Math.max(bitmap.width, bitmap.height))
    const c = new OffscreenCanvas(Math.round(bitmap.width * k), Math.round(bitmap.height * k))
    const g = c.getContext('2d')
    g.fillStyle = '#fff'
    g.fillRect(0, 0, c.width, c.height)
    g.drawImage(bitmap, 0, 0, c.width, c.height)
    saved.push({ file: s.file, base64: await base64(await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 })) })
  }
  return saved
}

// =====================================================================
// 見本の原稿（実際の報告書に近い形：本文5ページ以上・図3枚・素材表・作品写真1枚・抄録）
// =====================================================================

/** 「セルフチェック」の画像のために、わざと入れる誤り（「見頃」「記事」「です」） */
const CHECK_TEXT = '二回目の仮縫いでは、前見頃の丈を2cm短くした。袖の記事が重く、腕が下がって見えたためです。'

/** ページの中で、見本の原稿にする（setupReport）。started：抄録を書き始めているか */
async function setupReport({ started = true } = {}) {
  const { fromMaterialTable } = await import('/src/model/table.ts')
  const r0 = window.__editor.getSnapshot().report
  const t = (text) => ({ type: 'text', text })
  const ref = (targetId, withParens = true) => ({ type: 'ref', targetId, withParens })
  const p = (id, ...content) => ({ type: 'paragraph', id, content: content.map((c) => (typeof c === 'string' ? t(c) : c)) })
  const sub = (id, title) => ({ type: 'subheading', id, title })
  const fig = (rowId, id, imageId, caption) => ({ type: 'figureRow', id: rowId, figures: [{ id, imageId, caption }] })
  window.__editor.replace({
    ...r0,
    basicInfo: { studentId: '00ZZ0123', name: '文化　花子', courseId: 'film-stage-costume', subtitleInput: 'シンドバッド' },
    abstract: {
      started,
      paragraphs: [
        p('a1', '本制作報告書は、卒業イベント「シンドバッド」において、筆者が担当した主人公シンドバッドの衣装の制作についてまとめたものである。シンドバッドは七つの航海を経て成長していく人物であり、本制作では、旅立ちの場面の若々しさと、帰還の場面の頼もしさの両方を、一着の衣装で表すことを目標とした。'),
        p('a2', 'デザインは、中東の伝統的な装いをもとに、航海の力強さと冒険心を表すことを考えた。袖は風をはらむように大きく膨らませ、腰には幅の広い帯を巻いた。配色は海の青と砂の金を軸とし、袖には波の模様を金の糸で刺繍した。素材は、光沢のあるコットンサテンを中心に、透けるシルクシフォンを重ねて、照明の当たり方で表情が変わるようにした。'),
        p('a3', '制作では、二回の仮縫いで動きやすさを確かめた。一回目は袖の膨らみが大きすぎ、腕を上げると肩が引きつれたため、袖山を下げて袖幅を細くした。二回目は舞台の上で歩いたり腕を回したりして、客席からの見え方も確かめた。刺繍は図案を何度も描き直し、離れた客席からでも波の形が分かる大きさに決めた。袖の重ね布は、腕を下ろしたときに広がりすぎないよう、端に細いテープを入れて形を整えた。'),
        p('a4', '本番では、照明の下で袖の刺繍が光り、主人公の動きを大きく見せることができた。客席からも、袖が揺れる様子が印象に残ったという声が多く寄せられた。一方で、帯の結び目が大きく、場面転換の早替えに時間がかかるという課題が残った。今後は、見た目の美しさだけでなく、着脱のしやすさも初めから考えたデザインを心がけたい。'),
      ],
    },
    body: [
      {
        id: 'c1',
        title: '企画・立案',
        blocks: [
          sub('s1', '担当衣装のキャラクター'),
          p('p1', '筆者が担当したのは、物語の主人公である船乗りシンドバッドの衣装である。シンドバッドは七つの航海を経て成長していく人物であり、場面ごとに異なる表情を見せる。'),
          p('p2', '本制作では、旅立ちの場面の若々しさと、帰還の場面の頼もしさの両方を、一着の衣装で表すことを目標とした。そのため、色や形で年齢を強く感じさせるのではなく、動きの大きさと素材の光り方で印象を変えられるように考えた。'),
          sub('s2', 'デザイン説明'),
          p('p3', '中東の伝統的な装いをもとに、航海の力強さと冒険心を表すデザインを考えた', ref('f1'), '。キーワードは自由、勇気、海である。'),
          fig('r1', 'f1', 'g-design', 'デザイン画'),
          p('p4', '袖は風をはらむように大きく膨らませた。腰には幅の広い帯を巻き、袖には波の模様を刺繍で入れた。配色は海の青と砂の金を軸とし、ズボンには生成りを合わせて全体を軽く見せた。'),
          p('p4b', '配色と素材は、海と砂漠の写真や布の切れ端を集めたイメージボードをもとに決めた', ref('f2'), '。藍色の濃さは、照明の下でも黒く沈まないものを選んだ。'),
          fig('r2', 'f2', 'g-mood', 'イメージボード'),
          sub('s3', '使用素材'),
          p('p5', ref('t1', false), 'に使用した素材をまとめる。'),
          fromMaterialTable({
            id: 't1',
            caption: '使用素材表',
            rows: [
              { id: 'm1', name: 'コットンサテン', usage: 'ブラウス', swatchImageId: 'g-satin' },
              { id: 'm2', name: 'シルクシフォン', usage: '袖の重ね布', swatchImageId: 'g-chiffon' },
              { id: 'm3', name: 'コットンブロード', usage: 'ズボン', swatchImageId: 'g-broad' },
            ],
          }),
          p('p5b', 'ブラウスには、やわらかい光沢のあるコットンサテンを使った。照明が当たると表面が光り、袖の動きが客席からも分かりやすくなる。袖の重ね布には透けるシルクシフォンを使い、腕を動かしたときに風に揺れるように見せた。ズボンは、張りがあって動きやすいコットンブロードで仕立てた。'),
        ],
      },
      {
        id: 'c2',
        title: '制作過程',
        blocks: [
          sub('s4', 'パターンと仮縫い'),
          p('p6', 'デザイン画をもとにパターンを引き、シーチングで仮縫いをした。一回目の仮縫いでは、袖の膨らみが大きすぎて、腕を上げたときに肩が引きつれた。そこで袖山を3cm下げ、袖幅も細くした。'),
          p('p7', '二回目の仮縫いでは、実際に舞台の上で歩いたり腕を回したりして、動きやすさを確かめた。客席から見たときに袖の膨らみが十分に伝わるかも、離れた位置から確認した。'),
          sub('s5', '袖の刺繍'),
          p('p8', '袖には、海の波を表す模様を金の糸で刺繍した', ref('f3'), '。図案は実物大に描いて袖に写し、刺繍枠に張ってから一針ずつ刺した。'),
          fig('r3', 'f3', 'g-process', '袖の刺繍'),
          p('p9', '最初の図案は波が細かすぎて、離れると模様が見えなかった。そこで波の数を減らし、一つ一つの波を大きく描き直した。糸は、照明の下で強く光りすぎないよう、つやを抑えた金色を選んだ。'),
          p('p10', '刺繍には片袖でおよそ20時間かかった。両袖の模様がそろうよう、型紙に印を付けて位置を合わせた。刺し終えたあとは、裏に薄い接着芯を貼り、着たときに糸が引っかからないようにした。'),
          sub('s6', '帯とズボン'),
          p('p11', '帯は、からし色の布を幅15cmの筒に縫い、腰に二重に巻いて後ろで結んだ。結び目が大きく見えるよう、端に重さのある房を付けた。房は動いたときに揺れて、舞台の上で動きを強調する役割も果たした。'),
          p('p12', 'ズボンは、裾に向かって細くなる形にし、裾口にゴムを入れて動きやすくした。股上を深くとり、しゃがんだり飛び跳ねたりしても突っ張らないようにした。'),
          sub('s7', '仕上げ'),
          p('p13', '最後に全体をアイロンで整え、本番と同じ照明の下で色の見え方を確かめた。袖の刺繍が客席の後ろからも光って見えることを確かめ、完成とした。'),
        ],
      },
      {
        id: 'c3',
        title: 'まとめ',
        blocks: [
          p('p14', '本制作では、主人公の成長を一着の衣装で表すことを目標とした。袖の大きな膨らみと金の刺繍によって、旅立ちの若々しさと帰還の頼もしさの両方を表すことができた。'),
          p('p15', '一方で、帯の結び目が大きく、場面転換の早替えに時間がかかるという課題が残った。今後は、見た目の美しさだけでなく、着脱のしやすさも初めから考えたデザインを心がけたい。'),
          p('p16', '制作を通して、舞台衣装は客席からの見え方と演者の動きやすさの両方を考える必要があることを学んだ。この経験を、今後の衣装制作に生かしたい。'),
        ],
      },
    ],
    references: [],
    workPhotos: { layout: 1, imageIds: ['g-photo1'] },
    acknowledged: [],
  })
}

// =====================================================================
// 画面の画像
// =====================================================================

/** 撮影のじゃまになるもの（別のタブの知らせ・はじめての案内）を出さない（.guide は、案内を撮るときだけ出す） */
const SHOT_CSS = `
  .login-over.tab-locked { display: none !important; }
  .no-guide .guide { display: none !important; }
`

/**
 * 撮影のあいだに src/ が直されても、画面が入れ替わらないようにする（開発サーバーの即時反映をつながない）。
 * はじめての案内のあとに出る指差し確認（ツアー）は、見たことにしておく（出ると画面が覆われ、撮影が先へ進めない）
 */
const noHotReload = (page) =>
  page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  })

const ready = (page, phone = false) =>
  page.waitForFunction(
    (phone) => {
      const s = window.__editor?.getSnapshot()
      return s?.layout && (!phone || s.sheet !== undefined) && !s.rendering && !s.turning && !document.querySelector('.loading')
    },
    { timeout: 120000 },
    phone,
  )

/** ドライブへの保存が済むまで待つ（右の欄・スマホの上の帯の「ドライブに保存 13:44」） */
const driveSaved = (page) =>
  page.waitForFunction(() => [...document.querySelectorAll('.chip.ok')].some((c) => /ドライブに保存|\d+:\d+/.test(c.textContent)) && !document.querySelector('.chip .dot.busy'), { timeout: 60000 })

/** ページの中で、最初の1つの要素の位置を測る */
function rectFirst(sel) {
  const e = [...document.querySelectorAll(sel)].find((x) => x.getBoundingClientRect().width > 0)
  if (!e) return null
  const r = e.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}

/** ページの中で、要素の位置を測る（いくつかなら、それらを囲む範囲。text があれば、その文字を含むものだけ） */
function rectOf(sel, text) {
  const els = [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 0 && (!text || e.textContent.includes(text)))
  if (!els.length) return null
  const rs = els.map((e) => e.getBoundingClientRect())
  const x = Math.min(...rs.map((r) => r.left))
  const y = Math.min(...rs.map((r) => r.top))
  return { x, y, w: Math.max(...rs.map((r) => r.right)) - x, h: Math.max(...rs.map((r) => r.bottom)) - y }
}

const pad = (r, px, py = px) => ({ x: r.x - px, y: r.y - py, w: r.w + px * 2, h: r.h + py * 2 })
const union = (...rs) => {
  rs = rs.filter(Boolean)
  const x = Math.min(...rs.map((r) => r.x))
  const y = Math.min(...rs.map((r) => r.y))
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y }
}
const CUR = '.page-viewport.front [data-vivliostyle-page-container].is-current'
const clickText = (page, selector, text) => page.evaluate((selector, text) => [...document.querySelectorAll(selector)].find((b) => b.textContent.includes(text)).click(), selector, text)

/** 番号の吹き出しの場所（marks.js に書き出す。前に撮った分は残し、撮り直した分だけ入れ替える） */
const MARKS_FILE = `${IMG}/marks.js`
const MARKS = existsSync(MARKS_FILE) ? JSON.parse(readFileSync(MARKS_FILE, 'utf8').replace(/^[^=]*=\s*/, '').replace(/;\s*$/, '')) : {}
const writeMarks = () =>
  writeFileSync(
    MARKS_FILE,
    `// node scripts/make-guides.mjs が書き出す（手で直さない）。画面の画像の大きさと、番号の吹き出しを付ける部品の場所（画像の中の %）\nwindow.GUIDE_MARKS = ${JSON.stringify(MARKS, null, 1)};\n`,
  )

/**
 * 画面を切り抜いて撮り（docs/guide-images/<name>.jpg）、吹き出しの番号の場所を書き出す。
 * clip：切り抜く範囲（CSS px）。marks：[{ n, box（部品の範囲）, at：吹き出しを置く側（l・r・t・b・tl・tr・bl・br・c・ol）, dx, dy（px） }]
 * optional：見つからなくてもよい印（画面が変わりやすい部品。見つからなければ、その番号は付けない）
 */
async function capture(page, name, clip, marks = []) {
  for (const m of marks) if (!m.box && m.optional) console.log(`  （${name}：${m.n} の場所が見つからないので、番号を付けません）`)
  marks = marks.filter((m) => m.box || !m.optional)
  const vp = page.viewport()
  const x = Math.max(0, Math.round(clip.x))
  const y = Math.max(0, Math.round(clip.y))
  const c = { x, y, width: Math.min(vp.width, Math.round(clip.x + clip.w)) - x, height: Math.min(vp.height, Math.round(clip.y + clip.h)) - y }
  // captureBeyondViewport を切る：切ると、撮るときに画面の大きさが一時的に変わらない（変わると、紙面や見本が作り直されて白く写る）
  await page.screenshot({ path: `${IMG}/${name}.jpg`, type: 'jpeg', quality: 88, clip: c, captureBeyondViewport: false })
  const pct = (v, s) => +((v / s) * 100).toFixed(2)
  for (const m of marks) if (!m.box) throw new Error(`${name}：${m.n} の場所が見つかりません（ツールの画面が変わったかもしれません）`)
  MARKS[name] = {
    w: c.width,
    h: c.height,
    marks: marks.map(({ n, box, at = 'l', dx = 0, dy = 0 }) => ({
      n,
      at,
      dx: pct(dx, c.width),
      dy: pct(dy, c.height),
      box: { x: pct(box.x - c.x, c.width), y: pct(box.y - c.y, c.height), w: pct(box.w, c.width), h: pct(box.h, c.height) },
    })),
  }
  writeMarks()
  console.log(`  ${IMG}/${name}.jpg  (${c.width}×${c.height})`)
}

/** 学生用ツールを、偽物の Google につないで開く（ログインはまだ）。phone：スマホの画面 */
async function openTool(browser, drive, config, { phone = false, context } = {}) {
  context ??= await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  page.on('dialog', (d) => d.accept())
  await noHotReload(page)
  if (phone) await page.setUserAgent(PHONE_UA)
  await page.setViewport(phone ? PHONE : PC)
  await routeGoogle(page, drive, config)
  await page.goto(`${APP}/`, { waitUntil: 'networkidle0', timeout: 90000 })
  await page.addStyleTag({ content: SHOT_CSS })
  return { context, page }
}

const goToBlock = async (page, id, phone = false) => {
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

/** 段落の文を書き換える */
const setParagraph = (page, id, text) =>
  page.evaluate(
    (id, text) =>
      window.__editor.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === id ? { ...b, content: [{ type: 'text', text }] } : b)) })) })),
    id,
    text,
  )

async function studentShots(browser, config, images) {
  const drive = fakeDrive(STUDENT_EMAIL)
  const { context, page } = await openTool(browser, drive, config)
  await ready(page)

  // ---- ログインの窓（Google のログインの部品は偽物） ----
  await page.waitForSelector('.login-over .login-btn')
  await sleep(500)
  await capture(page, 'g-login', pad(await page.evaluate(rectOf, '.login-card'), 16), [{ n: 1, box: await page.evaluate(rectOf, '.login-card .login-btn'), at: 'r' }])
  await page.click('.login-btn')
  await page.waitForFunction(() => !document.querySelector('.login-over'), { timeout: 60000 })

  // ---- はじめての案内：コースを選ぶ → Word で書き始めているか → 表紙（学籍番号はアカウントから入るので、氏名から） ----
  await page.waitForSelector('.guide.step-course .g-opts button')
  await sleep(900)
  await capture(page, 'g-course', pad(await page.evaluate(rectOf, '.g-tip'), 14), [{ n: 1, box: await page.evaluate(rectOf, '.g-opts button', '映画・舞台衣装'), at: 'r' }])
  await clickText(page, '.guide .g-opts button', '映画・舞台衣装')
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await ready(page)
  await sleep(900)
  await capture(page, 'g-word', pad(await page.evaluate(rectOf, '.g-tip'), 14), [
    { n: 1, box: await page.evaluate(rectOf, '.g-word-opt.yes'), at: 'r' },
    { n: 2, box: await page.evaluate(rectOf, '.g-word-opt.no'), at: 'r' },
  ])
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'basic:name', { timeout: 30000 })
  await sleep(500)
  // 氏名を書いているところ（学籍番号は、ログインしたアカウントから入っている）
  await page.keyboard.type('文化　花子')
  await sleep(900)
  {
    const fields = await page.evaluate(rectOf, `${CUR} [data-block-id="basic:course"], ${CUR} [data-block-id="basic:studentId"], .overlay-clip:not([hidden]) .overlay-editor`)
    const tip = await page.evaluate(rectOf, '.g-tip')
    const paper = await page.evaluate(rectOf, CUR)
    const area = union(fields, tip)
    await capture(page, 'g-cover', { x: paper.x + 20, y: area.y - 24, w: paper.w - 40, h: area.h + 40 }, [
      { n: 1, box: await page.evaluate(rectOf, `${CUR} [data-block-id="basic:studentId"]`), at: 'r' },
      { n: 2, box: await page.evaluate(rectOf, '.overlay-clip:not([hidden]) .overlay-editor'), at: 'r' },
    ])
  }
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'basic:subtitleInput', { timeout: 30000 })
  await page.keyboard.type('シンドバッド')
  await sleep(500)
  await page.keyboard.press('Enter')
  await page.waitForSelector('.guide.step-done')
  await page.evaluate(() => [...document.querySelectorAll('.g-actions button')].find((b) => b.textContent.includes('閉じる')).click())
  await ready(page)
  await page.evaluate(() => document.documentElement.classList.add('no-guide'))

  // ---- 見本の原稿にする ----
  saveSampleImages(await page.evaluate(prepareImages, images))
  await page.evaluate(setupReport)
  await sleep(800)
  await ready(page)
  await driveSaved(page)
  const info = await page.evaluate(() => {
    const s = window.__editor.getSnapshot()
    return { bodyPages: s.layout.bodyPages, abstractLines: s.layout.abstractLines, findings: s.findings.map((f) => `${f.severity}:${f.title}`) }
  })
  console.log(`  見本の原稿：本文 ${info.bodyPages}ページ・抄録 ${info.abstractLines}行・指摘 ${info.findings.length}件${info.findings.length ? `（${info.findings.join('、')}）` : ''}`)
  if (info.findings.some((f) => f.startsWith('error'))) throw new Error('見本の原稿にエラーが残っています（提出用の PDF の画面が撮れません）')

  // ---- 提出用の PDF を書き出す窓（エラーが0件のとき） ----
  await page.evaluate(() => document.querySelector('.side .export').click())
  await page.waitForSelector('.modal .checklist')
  await page.evaluate(() => document.activeElement?.blur())
  await sleep(500)
  await capture(page, 'g-export', await page.evaluate(rectOf, '.modal'), [
    { n: 1, box: await page.evaluate(rectOf, '.modal .checklist'), at: 'l' },
    { n: 2, box: await page.evaluate(rectOf, '.modal .print-guide'), at: 'l' },
    { n: 3, box: await page.evaluate(rectOf, '.modal .row-buttons button.primary'), at: 'l' },
  ])
  await page.evaluate(() => document.querySelector('.modal .close').click())

  // ---- 下書きの透かしの入った PDF（教員用：途中経過を見せてもらう）。本文の1ページ目を画像にする ----
  {
    const bodyPage = await page.evaluate(() => window.__editor.getSnapshot().layout.kinds.indexOf('body'))
    await page.evaluate(() => {
      document.title = `${window.__editor.pdfTitle}_下書き`
      document.documentElement.classList.add('print-draft')
    })
    await page.pdf({ path: 'poc-output/guides/draft.pdf', preferCSSPageSize: true, printBackground: true })
    await page.evaluate(() => {
      window.dispatchEvent(new Event('afterprint'))
      document.documentElement.classList.remove('print-draft')
    })
    const view = await browser.newPage()
    await view.setViewport({ width: 1000, height: 1400, deviceScaleFactor: 1 })
    await view.goto(`${APP}/poc-pdf.html?file=${encodeURIComponent('poc-output/guides/draft.pdf')}&scale=1.6`, { waitUntil: 'networkidle0' })
    await view.waitForFunction(() => document.body.dataset.rendered === 'true', { timeout: 120000 })
    const canvases = await view.$$('canvas')
    await canvases[bodyPage].screenshot({ path: `${IMG}/g-draft-page.jpg`, type: 'jpeg', quality: 88 })
    const size = await canvases[bodyPage].evaluate((c) => ({ w: c.width, h: c.height }))
    MARKS['g-draft-page'] = { w: size.w, h: size.h, marks: [] }
    writeMarks()
    console.log(`  ${IMG}/g-draft-page.jpg（下書きの PDF の ${bodyPage + 1}ページ目）`)
    await view.close()
    await page.bringToFront()
  }

  // ---- 抄録：先生の許可が出るまでは、案内と「先生の許可が出た」ボタン。エラーがあると、PDF の窓は「下書き」だけ ----
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, abstract: { ...r.abstract, started: false } })))
  await sleep(500)
  await ready(page)
  await page.evaluate(() => window.__editor.goToArea('abstract'))
  await sleep(900)
  await ready(page)
  {
    const box = await page.evaluate(rectOf, `${CUR} [data-abstract-start]`)
    const lock = await page.evaluate(rectOf, `${CUR} .abstract-lock`)
    const head = await page.evaluate(rectOf, CUR)
    await capture(page, 'g-abstract', { x: lock.x - 24, y: head.y + 60, w: lock.w + 48, h: lock.y + lock.h - head.y - 60 + 20 }, [{ n: 1, box, at: 'r' }])
  }
  await page.evaluate(() => document.querySelector('.side .export').click())
  await page.waitForSelector('.modal .draft-box')
  await page.evaluate(() => document.activeElement?.blur())
  await sleep(500)
  await capture(page, 'g-export-draft', await page.evaluate(rectOf, '.modal'), [
    { n: 1, box: await page.evaluate(rectOf, '.modal .error-list'), at: 'l' },
    { n: 2, box: await page.evaluate(rectOf, '.modal .draft-box button'), at: 'r' },
  ])
  await page.evaluate(() => document.querySelector('.modal .close').click())
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, abstract: { ...r.abstract, started: true } })))
  await sleep(500)
  await ready(page)

  // ---- セルフチェック：わざと誤りを入れる（エラー・警告・「直す」・「このままにする（確認済み）」） ----
  await setParagraph(page, 'p7', CHECK_TEXT)
  await sleep(500)
  await ready(page)
  await driveSaved(page)
  await goToBlock(page, 'p3')
  await page.mouse.move(5, 5)
  await sleep(600)
  // PC の画面全体（表紙の絵・教員用の「学生の画面」）
  await capture(page, 'g-pc-full', { x: 0, y: 0, w: PC.width, h: PC.height }, [
    { n: 1, box: await page.evaluate(rectOf, '.thumbs-col'), at: 'c' },
    { n: 2, box: await page.evaluate(rectOf, '.palette'), at: 'b' },
    { n: 3, box: await page.evaluate(rectOf, CUR), at: 'tl', dx: 26, dy: 26 },
    { n: 4, box: await page.evaluate(rectOf, '.side .drive-chip-wrap .chip'), at: 'b' },
    { n: 5, box: await page.evaluate(rectOf, '.side .sec.check .sec-h'), at: 'l' },
    { n: 6, box: await page.evaluate(rectOf, '.side .export'), at: 'l' },
  ])
  {
    // 指摘の一覧が欄の中で切れないよう、この画像だけ画面を縦に長くして撮る
    await page.setViewport({ ...PC, height: 1200 })
    await sleep(800)
    await ready(page)
    const sec = await page.evaluate(rectOf, '.side .sec.check')
    const issues = await page.evaluate(rectOf, '.side .sec.check .igroup')
    await capture(page, 'g-check', { x: sec.x, y: sec.y, w: sec.w, h: issues.y + issues.h - sec.y + 6 }, [
      { n: 1, box: await page.evaluate(rectFirst, '.side .issue.error .dot'), at: 'l' },
      { n: 2, box: await page.evaluate(rectFirst, '.side .issue.warning .dot'), at: 'l' },
      { n: 3, box: await page.evaluate(rectFirst, '.side .issue .fix'), at: 'r' },
      { n: 4, box: await page.evaluate(rectFirst, '.side .issue .keep'), at: 'l' },
    ])
    await page.setViewport(PC)
    await sleep(800)
    await ready(page)
  }

  // ---- 書く：段落を書いているところ（道具と紙面の上半分） ----
  await openBlock(page, 'p3', 999)
  {
    const palette = await page.evaluate(rectOf, '.palette')
    const paper = await page.evaluate(rectOf, CUR)
    const figure = await page.evaluate(rectOf, `${CUR} figure[data-figure-id]`)
    const editor = await page.evaluate(rectOf, '.overlay-clip:not([hidden]) .overlay-editor')
    const tool = (label) => page.evaluate(rectOf, '.palette .tb', label)
    await capture(page, 'g-write', { x: palette.x - 18, y: 0, w: paper.x + paper.w + 18 - (palette.x - 18), h: figure.y + figure.h + 14 }, [
      { n: 1, box: editor, at: 'l', dy: -editor.h / 2 + 12 },
      { n: 2, box: await tool('図を入れる'), at: 'r' },
      { n: 3, box: await tool('表を入れる'), at: 'r' },
      { n: 4, box: union(await tool('小見出し'), await tool('大見出し')), at: 'r' },
      { n: 5, box: await tool('元に戻す'), at: 'r' },
    ])
  }
  await page.keyboard.press('Escape')
  await sleep(400)
  await ready(page)

  // ---- 保存のようす（右の欄の「ドライブに保存」を押したところ） ----
  await page.mouse.move(5, 5)
  await page.click('.side .drive-chip-wrap .chip')
  await page.waitForSelector('.drive-pop')
  await sleep(300)
  {
    const head = await page.evaluate(rectOf, '.side .side-head')
    const pop = await page.evaluate(rectOf, '.drive-pop')
    await capture(page, 'g-drive', union(head, pad(pop, 10)), [
      { n: 1, box: await page.evaluate(rectOf, '.side .drive-chip-wrap .chip'), at: 'l' },
      { n: 2, box: await page.evaluate(rectOf, '.drive-pop button', 'この端末から原稿を消す'), at: 'l' },
      { n: 3, box: await page.evaluate(rectOf, '.side .side-head a, .side .side-head button', '使い方'), at: 'l', optional: true },
    ])
  }
  await page.keyboard.press('Escape')
  await sleep(300)

  // ---- バックアップ（自動の控え） ----
  await page.evaluate(() => [...document.querySelectorAll('.side .link-btn')].find((b) => b.textContent.includes('バックアップ')).click())
  await page.waitForSelector('.modal .snapshots, .modal .muted')
  await page.evaluate(() => document.activeElement?.blur())
  await sleep(400)
  await capture(page, 'g-backup', await page.evaluate(rectOf, '.modal'), [{ n: 1, box: await page.evaluate(rectOf, '.modal h3'), at: 'l' }])
  await page.evaluate(() => document.querySelector('.modal .close').click())

  // ---- スマホ：同じアカウントでログインすると、ドライブの原稿が開く ----
  const phone = await openTool(browser, drive, config, { phone: true })
  const pp = phone.page
  await ready(pp, true)
  await pp.waitForSelector('.login-btn')
  await pp.tap('.login-btn')
  await pp.waitForFunction(() => !document.querySelector('.login-over'), { timeout: 90000 })
  await ready(pp, true)
  await pp.evaluate(() => document.documentElement.classList.add('no-guide'))
  // 偽物のドライブは写真（バイナリ）を正しく受け渡せないので、スマホにも同じ見本の画像を入れ直して、紙面を組み直す
  await pp.evaluate(prepareImages, images)
  await pp.evaluate(() => window.__editor.update((r) => ({ ...r })))
  await sleep(800)
  await ready(pp, true)
  await driveSaved(pp)
  await goToBlock(pp, 'p3', true)
  await pp.evaluate(() => window.__editor.openWhenReady('p3', 12))
  await pp.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p3', { timeout: 30000 })
  await sleep(900)
  await capture(pp, 'g-phone-write', { x: 0, y: 0, w: PHONE.width, h: PHONE.height }, [{ n: 1, box: await pp.evaluate(rectOf, '.edit-sheet .es-tools'), at: 't' }])
  await pp.evaluate(() => window.__editor.finishEditing())
  await sleep(600)
  await pp.click('.p-top .icon-btn')
  await pp.waitForSelector('.sheet .sheet-body')
  await sleep(600)
  await capture(pp, 'g-phone-menu', { x: 0, y: 0, w: PHONE.width, h: PHONE.height }, [
    { n: 1, box: await pp.evaluate(rectOf, '.sheet .drive-pop button', 'この端末から原稿を消す'), at: 'l' },
    { n: 2, box: await pp.evaluate(rectOf, '.sheet .sheet-body a, .sheet .sheet-body button', '使い方'), at: 'r', optional: true },
  ])
  await pp.click('.sheet-close')
  await sleep(400)

  // ---- 別の端末（スマホ）が後から保存していた：パソコンで書くと、どちらで続けるかを聞く ----
  await pp.evaluate(() => window.__editor.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === 'p16' ? { ...b, content: [{ type: 'text', text: '制作を通して、舞台衣装は客席からの見え方と演者の動きやすさの両方を考える必要があることを学んだ。この経験を、今後の衣装制作に生かしたい。（スマホで書き足した）' }] } : b)) })) })))
  await sleep(1500)
  await driveSaved(pp)
  await page.bringToFront()
  await setParagraph(page, 'p15', '一方で、帯の結び目が大きく、場面転換の早替えに時間がかかるという課題が残った。')
  await page.waitForSelector('.drive-two', { timeout: 60000 })
  await page.evaluate(() => document.activeElement?.blur())
  await sleep(500)
  await capture(page, 'g-conflict', await page.evaluate(rectOf, '.modal'), [
    { n: 1, box: await page.evaluate(rectOf, '.modal .row-buttons button', 'この端末の原稿で続ける'), at: 'b' },
    { n: 2, box: await page.evaluate(rectOf, '.modal .row-buttons button', 'ドライブの原稿を開く'), at: 'b' },
  ])
  // （この端末の原稿で続ける：ドライブの原稿を開くと、写真を偽物のドライブから読むことになるため）
  await clickText(page, '.modal button', 'この端末の原稿で続ける')
  await page.waitForFunction(() => !document.querySelector('.drive-two'), { timeout: 60000 })
  await ready(page)
  await phone.context.close()

  // ---- 1時間たって Google の許可が切れたとき ----
  drive.failNext = 401
  await setParagraph(page, 'p15', '一方で、帯の結び目が大きく、場面転換の早替えに時間がかかるという課題が残った。今後は、着脱のしやすさも考えたい。')
  await page.waitForFunction(() => [...document.querySelectorAll('.modal h2')].some((h) => h.textContent.includes('もう一度ログイン')), { timeout: 60000 })
  await page.evaluate(() => document.activeElement?.blur())
  await sleep(400)
  await capture(page, 'g-relogin', await page.evaluate(rectOf, '.modal'), [{ n: 1, box: await page.evaluate(rectOf, '.modal .row-buttons button.primary'), at: 'l' }])
  await clickText(page, '.modal button', 'ログインし直す')
  await driveSaved(page)

  // ---- 同じパソコンで2つめのタブを開いたとき ----
  {
    const second = await context.newPage()
    await noHotReload(second)
    await second.setViewport(PC)
    await routeGoogle(second, drive, config)
    await second.goto(`${APP}/`, { waitUntil: 'networkidle0', timeout: 90000 })
    await second.waitForSelector('.login-over.tab-locked .login-card', { timeout: 60000 })
    await second.evaluate(() => document.activeElement?.blur())
    await sleep(600)
    await capture(second, 'g-tablock', await second.evaluate(rectOf, '.login-over.tab-locked .login-card'), [{ n: 1, box: await second.evaluate(rectOf, '.login-over.tab-locked .login-btn'), at: 'r' }])
    await second.close()
  }
  await context.close()
}

/** 管理ページ（試験版）を開く。as：teacher なら先生の画面（試験版の管理者・先生のアドレスは example.ac.jp） */
async function openAdmin(browser, { as } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  page.on('dialog', (d) => d.accept())
  await noHotReload(page)
  await page.setViewport(PC)
  await page.goto(`${APP}/admin.html`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => localStorage.removeItem('sotsugyo-admin-mock'))
  await page.goto(`${APP}/admin.html${as ? `?as=${as}` : ''}`, { waitUntil: 'networkidle0' })
  await page.waitForSelector(as === 'teacher' ? '.teacher-main' : '.admin .form')
  await hideMockBadge(page)
  return { context, page }
}

/** 「試験用サーバー」の印は本物の管理ページにはないので出さない */
const hideMockBadge = (page) => page.evaluate(() => [...document.querySelectorAll('.badge')].find((b) => b.textContent.includes('試験用'))?.style.setProperty('display', 'none'))

/** 管理ページの見本（iframe）は設定や幅が変わるたびに作り直されるので、表紙と抄録が出て、作り直しが止まるまで待つ */
async function previewStable(page) {
  for (let i = 0; i < 40; i++) {
    const stable = await page.evaluate(() => {
      const d = document.querySelector('.preview iframe')?.contentDocument
      if (!d || d.readyState !== 'complete' || d.querySelectorAll('.page').length !== 2) return false
      if (d.__guideSeen) return true
      d.__guideSeen = true
      return false
    })
    if (stable) return
    await sleep(800)
  }
  throw new Error('管理ページの見本が表示されません')
}

async function adminShots(browser) {
  const { context, page } = await openAdmin(browser)
  // 締切を1日ずらして、「保存していない変更があります」と保存のボタンが押せる状態にする
  const field = (label) => page.evaluateHandle((label) => [...document.querySelectorAll('.f')].find((f) => f.querySelector('.l')?.textContent.startsWith(label)).querySelector('input, textarea'), label)
  const deadline = await field('最終締切')
  await deadline.evaluate((el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '2027-01-22')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForSelector('.badge.warn')
  await hideMockBadge(page)
  await page.mouse.move(5, 5)
  await previewStable(page)
  await page.evaluate(() => document.querySelector('.preview iframe').contentDocument.fonts.ready)
  await sleep(600)
  await previewStable(page)
  // 欄の名前（「共通の題目」など）の文字の範囲（吹き出しは画像の左の外に置き、名前の左の端まで線を引く）
  const fieldBox = (label) =>
    page.evaluate((label) => {
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
  await capture(page, 'g-admin-main', { x: 0, y: 0, w: PC.width, h: previewPage.y + previewPage.h + 14 }, [
    { n: 1, box: union(await page.evaluate(rectOf, '.admin-header .sel'), await page.evaluate(rectOf, '.admin-header .badge.pub')), at: 'b' },
    { n: 2, box: await fieldBox('共通の題目'), at: 'ol' },
    { n: 3, box: await fieldBox('最終締切'), at: 'ol' },
    { n: 4, box: await fieldBox('サブタイトルの形式'), at: 'ol' },
    { n: 5, box: await fieldBox('指導教員'), at: 'ol' },
    { n: 6, box: previewPage, at: 'tl', dx: 10, dy: 10 },
    { n: 7, box: await page.evaluate(rectOf, '.admin-header .btn', '保存して学生に反映'), at: 'b' },
    { n: 8, box: await page.evaluate(rectOf, '.admin-header a, .admin-header button', '使い方'), at: 'b', optional: true },
  ])

  // コースのカード（下書きのひな形・お知らせ。お知らせの欄は、入っている例の薄い字のまま）
  await page.evaluate(() => document.querySelector('.form .course').scrollIntoView({ block: 'start' }))
  await sleep(500)
  await capture(page, 'g-admin-course', pad(await page.evaluate(rectOf, '.form .course'), 10), [
    { n: 1, box: await page.evaluate(rectOf, '.form .course .tpl-row'), at: 'l' },
    { n: 2, box: await page.evaluate(rectOf, '.form .course .notice-field textarea'), at: 'l' },
  ])

  // 書き間違えやすい語の窓
  await page.evaluate(() => document.querySelector('.words-btn').scrollIntoView({ block: 'center' }))
  await page.click('.words-btn')
  await page.waitForSelector('.words-modal')
  await page.evaluate(() => document.activeElement?.blur())
  await sleep(500)
  await capture(page, 'g-admin-words', await page.evaluate(rectOf, '.words-modal'), [
    { n: 1, box: await page.evaluate(rectOf, '.wtable'), at: 'l' },
    { n: 2, box: await page.evaluate(rectOf, '.wtry'), at: 'l' },
  ])
  await page.keyboard.press('Escape')
  await sleep(300)
  if (await page.$('.words-modal')) await clickText(page, '.words-modal button', 'やめる')

  // 下書きのひな形の窓
  await page.evaluate(() => document.querySelector('.tpl-row button').click())
  await page.waitForSelector('.tpl-modal')
  await page.evaluate(() => document.activeElement?.blur())
  await sleep(1200)
  await capture(page, 'g-admin-template', await page.evaluate(rectOf, '.tpl-modal'), [])
  await page.keyboard.press('Escape')
  await sleep(300)
  if (await page.$('.tpl-modal')) await clickText(page, '.tpl-modal button', 'やめる')

  // 詳細設定：学生のドライブ保存の切り替え（Google の障害のとき）
  await page.evaluate(() => {
    const d = document.querySelector('details.details')
    d.open = true
    d.querySelector('.drive-switch').scrollIntoView({ block: 'center' })
  })
  await sleep(400)
  await capture(page, 'g-admin-switch', pad(union(await page.evaluate(rectOf, 'details.details summary'), await page.evaluate(rectOf, '.drive-switch')), 10), [
    { n: 1, box: await page.evaluate(rectOf, '.drive-switch .seg2 button', '止める'), at: 'r' },
  ])

  // 保存して学生に反映 → 新年度を作成（準備中）。画面の上の欄だけ
  await clickText(page, '.admin-header button', '保存して学生に反映')
  await page.waitForFunction(() => document.querySelector('.message.ok'))
  await clickText(page, '.admin-header button', '新年度を作成')
  await page.waitForSelector('.modal')
  await clickText(page, '.modal button', '作成する')
  await page.waitForFunction(() => document.querySelector('.badge.draft')?.textContent === '準備中')
  await hideMockBadge(page)
  await page.mouse.move(5, 5)
  await sleep(400)
  {
    const head = union(await page.evaluate(rectOf, '.admin-header .sel'), await page.evaluate(rectOf, '.admin-header .btn.primary'))
    const header = await page.evaluate(rectOf, '.admin-header')
    await capture(page, 'g-admin-draft', { x: head.x - 12, y: header.y, w: head.w + 24, h: header.h }, [
      { n: 1, box: await page.evaluate(rectOf, '.admin-header .btn', '新年度を作成'), at: 'b' },
      { n: 2, box: await page.evaluate(rectOf, '.admin-header .btn.primary'), at: 'b' },
      { n: 3, box: await page.evaluate(rectOf, '.admin-header .link', '変更履歴'), at: 'b' },
      { n: 4, box: await page.evaluate(rectOf, '.admin-header .link', '先生の登録'), at: 'b' },
    ])
  }

  // 変更履歴
  await clickText(page, '.admin-header button', '変更履歴')
  await page.waitForSelector('.history li')
  await page.evaluate(() => document.activeElement?.blur())
  await sleep(400)
  await capture(page, 'g-admin-history', await page.evaluate(rectOf, '.modal'), [{ n: 1, box: await page.evaluate(rectOf, '.history li button'), at: 'l' }])
  await context.close()

  // 先生の画面
  const t = await openAdmin(browser, { as: 'teacher' })
  await t.page.mouse.move(5, 5)
  await sleep(500)
  {
    const firstCourse = await t.page.evaluate(rectFirst, '.teacher-main .course')
    await capture(t.page, 'g-admin-teacher', { x: 0, y: 0, w: PC.width, h: firstCourse.y + firstCourse.h + 16 }, [
      { n: 1, box: await t.page.evaluate(rectOf, '.teacher-main .course .tpl-row button'), at: 'r' },
      { n: 2, box: await t.page.evaluate(rectOf, '.teacher-main .course .notice-field textarea'), at: 'r' },
      { n: 3, box: await t.page.evaluate(rectOf, '.admin-header .btn.primary'), at: 'b' },
    ])
  }
  await t.context.close()
}

// =====================================================================
// PDF
// =====================================================================

async function makePdf(browser, guide) {
  const page = await browser.newPage()
  const failed = []
  page.on('pageerror', (e) => failed.push(`ページのエラー：${e.message}`))
  page.on('requestfailed', (r) => failed.push(`読み込めなかったもの：${r.url()}`))
  await page.setViewport({ width: 1000, height: 1200 })
  await page.emulateMediaType('print')
  await page.goto(pathToFileURL(resolve(guide.html)).href, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() => document.body.dataset.ready === 'true', { timeout: 30000 })
  const check = await page.evaluate((exempt, minPt, jp) => {
    const fonts = ['BIZ UDPGothic'].filter((f) => !document.fonts.check(`16px "${f}"`) || !document.fonts.check(`bold 16px "${f}"`))
    const images = [...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.getAttribute('src'))
    const missing = [...document.querySelectorAll('figure[data-shot]')].filter((f) => !f.querySelector('img')).map((f) => f.dataset.shot)
    // 用紙（A4）からはみ出していないか（わざと用紙の外まで伸ばすもの .bleed は除く）
    const sheets = [...document.querySelectorAll('.sheet')]
    const over = sheets.map((s, i) => {
      const r = s.getBoundingClientRect()
      let worst = { px: 0, who: '' }
      for (const e of s.querySelectorAll('*')) {
        if (e.closest('.bleed, svg')) continue
        const q = e.getBoundingClientRect()
        if (!q.width || !q.height) continue
        const px = Math.max(q.bottom - r.bottom, q.right - r.right, r.left - q.left)
        if (px > worst.px) worst = { px: Math.round(px), who: `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}「${e.textContent.trim().slice(0, 14)}」` }
      }
      // 中の要素が、自分の枠からあふれていないか（柱の上に文が重なるなど）
      for (const e of s.querySelectorAll('.fit')) {
        if (e.scrollHeight - e.clientHeight > 1) worst = { px: Math.max(worst.px, e.scrollHeight - e.clientHeight), who: `.fit「${e.textContent.trim().slice(0, 14)}」の中があふれています` }
      }
      return { page: i + 1, chars: (s.innerText.match(new RegExp(jp, 'g')) ?? []).length, ...worst }
    })
    // 文字の大きさ（pt）。柱・ページ番号・飾りの英字（exempt）は除く
    let min = { pt: 99, who: '' }
    const small = []
    for (const e of document.querySelectorAll('.sheet *')) {
      if (e.closest('svg') || e.closest(exempt)) continue
      if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue
      const pt = Math.round(parseFloat(getComputedStyle(e).fontSize) * 0.75 * 10) / 10
      const who = `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}「${e.textContent.trim().slice(0, 12)}」`
      if (pt < min.pt) min = { pt, who }
      if (pt < minPt) small.push(`${pt}pt ${who}`)
    }
    return { fonts, images, missing, sheets: sheets.length, over, min, small }
  }, MIN_EXEMPT, MIN_PT, JP.source)
  const problems = [...failed]
  if (check.fonts.length) problems.push(`書体を読み込めませんでした：${check.fonts.join(', ')}（node_modules/@fontsource があるか確かめてください）`)
  if (check.images.length) problems.push(`読み込めなかった画像：${check.images.join(', ')}`)
  if (check.missing.length) problems.push(`画面の画像がありません（先に画面を撮ってください）：${check.missing.join(', ')}`)
  if (check.sheets !== guide.pages) problems.push(`${guide.pages}ページのはずが、${check.sheets}ページあります`)
  for (const o of check.over) if (o.px > 0) problems.push(`${o.page}ページ：用紙・枠から ${o.px}px はみ出しています（${o.who}）。文を短くしてください`)
  for (const o of check.over) if (o.chars > MAX_CHARS) problems.push(`${o.page}ページ：${o.chars}字あります（${MAX_CHARS}字まで）。文を短くしてください`)
  if (check.small.length) problems.push(`文字が ${MIN_PT}pt より小さいところがあります：${check.small.slice(0, 6).join('　')}`)
  console.log(`  ${guide.html}：${check.over.map((o) => o.chars).join('・')}字　いちばん小さい文字 ${check.min.pt}pt（${check.min.who}。柱・ページ番号などを除く）`)
  await page.pdf({ path: guide.pdf, printBackground: true, preferCSSPageSize: true })
  await page.close()
  const doc = await getDocument({ data: new Uint8Array(readFileSync(guide.pdf)), useSystemFonts: false, verbosity: 0 }).promise
  const kb = Math.round(readFileSync(guide.pdf).length / 1024)
  console.log(`  ${guide.pdf}（${doc.numPages}ページ・${kb.toLocaleString()}KB）`)
  if (doc.numPages !== guide.pages) problems.push(`PDF が ${guide.pages}ページになっていません（${doc.numPages}ページ）`)
  if (problems.length) {
    for (const p of problems) console.log(`！ ${p}`)
    process.exitCode = 1
    return false
  }
  copyFileSync(guide.pdf, guide.publish)
  console.log(`  ${guide.publish} に写しました`)
  return true
}

async function makeQr() {
  // 白黒で印刷しても読めるよう、濃い色にする
  const svg = await QRCode.toString(TOOL_URL, { type: 'svg', errorCorrectionLevel: 'M', margin: 0, color: { dark: '#14161b', light: '#ffffff' } })
  writeFileSync(`${IMG}/qr-guide.svg`, svg)
  console.log(`  ${IMG}/qr-guide.svg  (${TOOL_URL})`)
}

for (const g of GUIDES) if (!existsSync(g.html)) throw new Error(`${g.html} がありません`)

// Edge は1回だけ起動する（続けて起動し直すと、閉じかけの Edge に接続しようとして失敗することがあるため）
await withEdge(async (browser) => {
  if (!pdfOnly) {
    console.log('画面の画像を撮ります')
    const config = JSON.parse(readFileSync('scripts/e2e/config-fixture.json', 'utf8'))
    // 試験用の設定の「（自動テスト用）」のお知らせは写さない
    for (const c of config.courses) delete c.notice
    if (doShot('student')) await studentShots(browser, config, loadSampleImages())
    if (doShot('admin')) await adminShots(browser)
    await makeQr()
  }
  console.log('PDF にします')
  for (const g of GUIDES) await makePdf(browser, g)
})
