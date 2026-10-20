// ツールの中の「？ 使い方」に出す画面の写真（public/help/*.jpg）を作る（mockups/v27 案A。項目は src/help/helpTopics.ts）。
// 本物のツール（学生用ツール・管理ページの試験版）を Edge で操作して撮り、長い辺 900px 以下・画質 0.8 の JPEG にする
// （学生用ツールは相対パスで、管理ページは GitHub Pages の URL で読む。src/help/links.ts）。
// 使い方: node scripts/make-help-images.mjs（開発サーバーが http://localhost:5173 で動いていること。APP_URL で変えられる）
//   SHOTS=student（学生用ツール）／SHOTS=admin（管理ページ） node scripts/make-help-images.mjs … 一部だけ撮り直す
//   Edge は EDGE_PORT（ふだんは 9403）で起動する
// 学生用ツールは Google のログインとドライブを偽物（scripts/e2e/fakeGoogle.mjs）に差し替える。本物の Google にはつながない。
// 見本の原稿は、衣装コースの架空の学生（文化花子・00ZZ0123）。メールアドレスは、架空の学生の 00zz0123@bunka-wu.ac.jp と、
// 管理ページの試験版の example.ac.jp だけが写る（本物の大学のアドレスは写さない）。
// 見本の画像（デザイン画・作品写真など）は docs/guide-images/sample/ のもの（読むだけ）
// 撮る画面（2026-10-20 の画面に合わせた）：
//   学生用ツール：ログイン・Word の案内・PDF を保存したところ・抄録・セルフチェック・学生の画面・書く（パソコンとスマホを並べる）・
//     表（列の幅）・作品写真（2ページ目）・ドライブに保存・バックアップ・別の端末の原稿・もう一度ログイン・2つめのタブ
//   管理ページ：年度の設定・変更があるときの下の帯・コース・ひな形を作る画面・書き方のチェック・先生の登録・詳細設定・新年度の準備・先生の画面
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

process.env.EDGE_PORT ??= '9403'
const { withEdge } = await import('./poc/edge.mjs')
const { fakeDrive, routeGoogle } = await import('./e2e/fakeGoogle.mjs')
const { setupWriting } = await import('./e2e/sampleReport.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'public/help'
/** 画像の長い辺の上限（px）と、JPEG の画質 */
const MAX = 900
const QUALITY = 0.8
const SHOT_ONLY = (process.env.SHOTS ?? '').split(',').filter(Boolean)
const doShot = (k) => !SHOT_ONLY.length || SHOT_ONLY.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PC = { width: 1440, height: 900, deviceScaleFactor: 2 }
const PHONE = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
/** スマホの仮のキーボードの高さ（iPhone の日本語のキーボードほど。scripts/e2e/phoneDirect.mjs と同じ） */
const KB = 336
const STUDENT_EMAIL = '00zz0123@bunka-wu.ac.jp'
const config = JSON.parse(readFileSync('scripts/e2e/config-fixture.json', 'utf8'))
// 試験用の設定の「（自動テスト用）」のお知らせは写さない
for (const c of config.courses) delete c.notice
mkdirSync(OUT, { recursive: true })

/** 撮影のじゃまになるもの（別のタブの知らせは、撮るときだけ出す。はじめての案内は、撮るときだけ出す） */
const SHOT_CSS = `
  .no-tablock .login-over.tab-locked { display: none !important; }
  .no-guide .guide { display: none !important; }
`

/** 撮影のあいだに src/ が直されても、画面が入れ替わらないようにする（開発サーバーの即時反映をつながない）。指差し確認は、見たことにしておく */
const prepare = (page) =>
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

const ready = (page) =>
  page.waitForFunction(() => {
    const s = window.__editor?.getSnapshot()
    return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading')
  }, { timeout: 120000 })

/** ドライブへの保存が済むまで待つ（右の欄・スマホの上の帯の「ドライブに保存 13:44」） */
const driveSaved = (page) =>
  page.waitForFunction(() => [...document.querySelectorAll('.chip.ok')].some((c) => /ドライブに保存|\d+:\d+/.test(c.textContent)) && !document.querySelector('.chip .dot.busy'), { timeout: 60000 })

/** 要素の範囲（いくつかなら、それらを囲む範囲。text があれば、その文字を含むものだけ） */
function rectOf(sel, text) {
  const els = [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 0 && (!text || e.textContent.includes(text)))
  if (!els.length) return null
  const rs = els.map((e) => e.getBoundingClientRect())
  const x = Math.min(...rs.map((r) => r.left))
  const y = Math.min(...rs.map((r) => r.top))
  return { x, y, w: Math.max(...rs.map((r) => r.right)) - x, h: Math.max(...rs.map((r) => r.bottom)) - y }
}
const R = async (page, sel, text) => {
  const r = await page.evaluate(rectOf, sel, text)
  if (!r) throw new Error(`見つかりません：${sel}${text ? `（${text}）` : ''}`)
  return r
}
const pad = (r, px, py = px) => ({ x: r.x - px, y: r.y - py, w: r.w + px * 2, h: r.h + py * 2 })
const union = (...rs) => {
  const x = Math.min(...rs.map((r) => r.x))
  const y = Math.min(...rs.map((r) => r.y))
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y }
}
const clickText = (page, selector, text) =>
  page.evaluate(
    (selector, text) => {
      const b = [...document.querySelectorAll(selector)].find((b) => b.textContent.includes(text))
      if (!b) throw new Error(`押すものが見つかりません：${selector}（${text}）`)
      b.click()
    },
    selector,
    text,
  )
const CUR = '.page-viewport.front [data-vivliostyle-page-container].is-current'
/** 押したボタンなどに残る、選んでいる印（青い枠）を消す */
const unfocus = (page) => page.evaluate(() => document.activeElement?.blur())

/** 縮めて JPEG にするためのページ（canvas で縮める） */
let shrinker = null

/** 画面を切り抜いて、PNG（base64）で撮る。clip：切り抜く範囲（CSS px。画面の外は切る） */
async function grab(page, clip) {
  const vp = page.viewport()
  const x = Math.max(0, Math.round(clip.x))
  const y = Math.max(0, Math.round(clip.y))
  const c = { x, y, width: Math.min(vp.width, Math.round(clip.x + clip.w)) - x, height: Math.min(vp.height, Math.round(clip.y + clip.h)) - y }
  // captureBeyondViewport を切る：切ると、撮るときに画面の大きさが一時的に変わらない（変わると、紙面や見本が作り直されて白く写る）
  return page.screenshot({ clip: c, captureBeyondViewport: false, encoding: 'base64' })
}

/** PNG を、長い辺 MAX px 以下の JPEG にして public/help/<name>.jpg に書き出す。いくつかなら、同じ高さで横に並べる（間にすき間） */
async function writeJpeg(name, pngs) {
  const out = await shrinker.evaluate(
    async (pngs, max, quality) => {
      const imgs = []
      for (const b64 of pngs) {
        const img = new Image()
        img.src = `data:image/png;base64,${b64}`
        await img.decode()
        imgs.push(img)
      }
      // 並べるときは、どれも同じ高さ（いちばん高いもの）にそろえ、まわりと間に、ツールの地の色のすき間を入れる
      const many = imgs.length > 1
      const H = Math.max(...imgs.map((i) => i.height))
      const gap = many ? Math.round(H * 0.03) : 0
      const sizes = imgs.map((i) => ({ w: (i.width * H) / i.height, h: H }))
      const W = sizes.reduce((s, z) => s + z.w, 0) + gap * (imgs.length + 1)
      const k = Math.min(1, max / Math.max(W, H + gap * 2))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(W * k)
      canvas.height = Math.round((H + gap * 2) * k)
      const g = canvas.getContext('2d')
      g.imageSmoothingQuality = 'high'
      g.fillStyle = many ? '#e9e6e0' : '#fff'
      g.fillRect(0, 0, canvas.width, canvas.height)
      let x = gap
      imgs.forEach((img, i) => {
        g.drawImage(img, x * k, gap * k, sizes[i].w * k, sizes[i].h * k)
        if (many) {
          g.strokeStyle = '#cfcac0'
          g.lineWidth = 1
          g.strokeRect(x * k - 0.5, gap * k - 0.5, sizes[i].w * k + 1, sizes[i].h * k + 1)
        }
        x += sizes[i].w + gap
      })
      return { data: canvas.toDataURL('image/jpeg', quality).split(',')[1], w: canvas.width, h: canvas.height }
    },
    pngs,
    MAX,
    QUALITY,
  )
  writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(out.data, 'base64'))
  console.log(`  ${OUT}/${name}.jpg  (${out.w}×${out.h}, ${Math.round((out.data.length * 0.75) / 1024)}KB)`)
}

/** 画面を切り抜いて撮り、public/help/<name>.jpg に書き出す。clip：切り抜く範囲（CSS px） */
const capture = async (page, name, clip) => writeJpeg(name, [await grab(page, clip)])

// =====================================================================
// 学生用ツール
// =====================================================================

/** 「セルフチェック」の画像のために、わざと入れる誤り（「見頃」「記事」「です」） */
const CHECK_TEXT = '二回目の仮縫いでは、前見頃の丈を2cm短くした。袖の記事が重く、腕が下がって見えたためです。'
const P7 = '二回目の仮縫いでは、実際に舞台の上で歩いたり腕を回したりして、動きやすさを確かめた。'

/** 段落の文を書き換える */
const setParagraph = (page, id, text) =>
  page.evaluate(
    (id, text) => window.__editor.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === id ? { ...b, content: [{ type: 'text', text }] } : b)) })) })),
    id,
    text,
  )
const goToBlock = async (page, id) => {
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), id)
  await sleep(300)
  await ready(page)
}

/** 学生用ツールを、偽物の Google につないで開く（ログインはまだ）。phone：スマホの画面 */
async function openTool(browser, drive, { context, phone = false } = {}) {
  context ??= await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  page.on('dialog', (d) => d.accept())
  // 「PDF を保存する」で保存される PDF は、どこにも置かない（撮影には要らない）
  await (await page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'deny', browserContextId: context.id })
  await prepare(page)
  if (phone) await page.setUserAgent(PHONE_UA)
  await page.setViewport(phone ? PHONE : PC)
  await routeGoogle(page, drive, config)
  await page.goto(`${APP}/`, { waitUntil: 'networkidle0', timeout: 90000 })
  await page.addStyleTag({ content: SHOT_CSS })
  return { context, page }
}

/**
 * 作品写真の2ページ目のための写真（見本の作品写真から、袖と帯のあたりを切り出して、寄りの写真にする）。
 * ページの中で動かす。見本の作品写真（g-photo1）は、setupWriting が入れたもの
 */
async function addDetailPhotos() {
  const { importImage } = await import('/src/model/images.ts')
  const bitmap = await createImageBitmap(await (await fetch('/docs/guide-images/sample/photo-1.jpg')).blob())
  const crop = async (id, x, y, w, h) => {
    const c = new OffscreenCanvas(Math.round(bitmap.width * w), Math.round(bitmap.height * h))
    c.getContext('2d').drawImage(bitmap, bitmap.width * x, bitmap.height * y, c.width, c.height, 0, 0, c.width, c.height)
    return importImage(await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 }), id, 1200)
  }
  // 上半身（袖の刺繍）と、帯からズボン（2枚・上下の枠に合う横長）
  window.__editor.addImages([await crop('g-photo2', 0.05, 0.12, 0.9, 0.4), await crop('g-photo3', 0.1, 0.45, 0.8, 0.4)])
}

/** スマホの紙面の段落 id の、i 文字目（見ているページ）を指で押す（字の左寄りを押す） */
async function tapChar(page, id, i) {
  const pt = await page.evaluate(
    (id, i) => {
      const el = [...document.querySelectorAll(`.page-viewport.front [data-block-id="${id}"]`)].find((e) => e.getBoundingClientRect().width > 0)
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      let acc = 0
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (i < acc + n.length) {
          const range = document.createRange()
          range.setStart(n, i - acc)
          range.setEnd(n, i - acc + 1)
          const r = [...range.getClientRects()].find((x) => x.height > 0)
          return { x: r.left + r.width * 0.25, y: (r.top + r.bottom) / 2 }
        }
        acc += n.length
      }
      throw new Error(`${id} の ${i} 文字目がありません`)
    },
    id,
    i,
  )
  await page.touchscreen.tap(pt.x, pt.y)
}

/** スマホのキーボードを仮に出す（見えている所 visualViewport を低くし、写真のための灰色の板を置く。e2e/phoneDirect.mjs と同じ） */
const fakeKeyboard = (page, on) =>
  page.evaluate(
    (kb, on) => {
      document.querySelector('#fake-kb')?.remove()
      if (on) Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => window.innerHeight - kb })
      else delete window.visualViewport.height
      window.visualViewport.dispatchEvent(new Event('resize'))
      if (!on) return
      const k = document.createElement('div')
      k.id = 'fake-kb'
      k.textContent = 'キーボード'
      Object.assign(k.style, { position: 'fixed', left: '0', right: '0', bottom: '0', height: `${kb}px`, zIndex: '200', pointerEvents: 'none', background: '#d3d6dc', color: '#6b6f78', display: 'grid', placeItems: 'center', font: '15px sans-serif' })
      document.body.append(k)
    },
    KB,
    on,
  )

async function studentShots(browser) {
  const drive = fakeDrive(STUDENT_EMAIL)
  const { context, page } = await openTool(browser, drive)
  await page.evaluate(() => document.documentElement.classList.add('no-tablock'))
  await ready(page)

  // ---- ログインの窓 ----
  await page.waitForSelector('.login-over .login-btn')
  await sleep(500)
  await capture(page, 'login', pad(await R(page, '.login-card'), 16))
  await page.click('.login-btn')
  await page.waitForFunction(() => !document.querySelector('.login-over'), { timeout: 60000 })

  // ---- はじめての案内：コース → Word で書き始めていますか？ ----
  await page.waitForSelector('.guide.step-course .g-opts button')
  await clickText(page, '.guide .g-opts button', '映画・舞台衣装')
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await ready(page)
  await sleep(900)
  await capture(page, 'word', pad(await R(page, '.g-tip'), 14))
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.guide .g-later')
  await page.evaluate(() => document.querySelector('.guide .g-later').click())
  await page.evaluate(() => window.__editor.finishEditing())
  await ready(page)
  await page.evaluate(() => document.documentElement.classList.add('no-guide'))

  // ---- 見本の原稿にする ----
  await page.evaluate(setupWriting)
  await sleep(800)
  await ready(page)
  await driveSaved(page)
  const errors = await page.evaluate(() => window.__editor.getSnapshot().findings.map((f) => `${f.severity}:${f.title}`))
  if (errors.length) throw new Error(`見本の原稿に指摘が残っています：${errors.join('、')}`)

  // ---- PDF を保存したところ（「PDF を保存する」→ できたページが並ぶ・ドライブにも置いた1行） ----
  await page.evaluate(() => document.querySelector('.side .export').click())
  await page.waitForSelector('.modal .pdf-start')
  await page.evaluate(() => document.querySelector('.modal .pdf-start').click())
  await page.waitForSelector('.modal .pdf-open', { timeout: 120000 })
  // 保存の画面が開いた（窓のフォーカスが外れた）ことにして、「保存しました」と、ドライブにも置いた1行を出してから撮る
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.waitForFunction(() => document.querySelector('.modal h2')?.textContent.includes('保存しました'), { timeout: 10000 })
  await page.waitForSelector('.modal .pdf-drive.done', { timeout: 30000 })
  await unfocus(page)
  await page.mouse.move(5, 5)
  await sleep(500)
  await capture(page, 'export', await R(page, '.modal'))
  await page.evaluate(() => document.querySelector('.modal .close').click())

  // ---- 抄録：先生の許可が出るまで ----
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, abstract: { ...r.abstract, started: false } })))
  await sleep(500)
  await ready(page)
  await page.evaluate(() => window.__editor.goToArea('abstract'))
  await sleep(900)
  await ready(page)
  {
    const lock = await R(page, `${CUR} .abstract-lock`)
    const head = await R(page, CUR)
    await capture(page, 'abstract', { x: lock.x - 24, y: head.y + 60, w: lock.w + 48, h: lock.y + lock.h - head.y - 60 + 20 })
  }
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, abstract: { ...r.abstract, started: true } })))
  await sleep(500)
  await ready(page)

  // ---- セルフチェック：わざと誤りを入れる ----
  await setParagraph(page, 'p7', CHECK_TEXT)
  await sleep(500)
  await ready(page)
  await driveSaved(page)
  await goToBlock(page, 'p3')
  await unfocus(page)
  await page.mouse.move(5, 5)
  await sleep(600)
  // 学生の画面（教員用の項目）：PC の画面全体
  await capture(page, 'student-screen', { x: 0, y: 0, w: PC.width, h: PC.height })
  {
    // 指摘の一覧が欄の中で切れないよう、画面を縦に長くして撮る
    await page.setViewport({ ...PC, height: 1200 })
    await sleep(800)
    await ready(page)
    const sec = await R(page, '.side .sec.check')
    const issues = await R(page, '.side .sec.check .igroup')
    await capture(page, 'check', { x: sec.x, y: sec.y, w: sec.w, h: issues.y + issues.h - sec.y + 6 })
    await page.setViewport(PC)
    await sleep(800)
    await ready(page)
  }
  await setParagraph(page, 'p7', P7)
  await sleep(500)
  await ready(page)

  // ---- 書く：段落を書いているところ（パソコン：道具と紙面の上半分。あとでスマホと並べる） ----
  await goToBlock(page, 'p3')
  await page.evaluate(() => window.__editor.openWhenReady('p3', 999))
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p3', { timeout: 30000 })
  await sleep(600)
  let writePc
  {
    const palette = await R(page, '.palette')
    const paper = await R(page, CUR)
    const figure = await R(page, `${CUR} figure[data-figure-id]`)
    writePc = await grab(page, { x: palette.x - 18, y: 0, w: paper.x + paper.w + 18 - (palette.x - 18), h: figure.y + figure.h + 14 })
  }
  await page.keyboard.press('Escape')
  await sleep(400)
  await ready(page)

  // ---- 表のマスを書いているところ：「表の形を整える」の窓で列の幅を「自分で決める」にして、縦の線のつまみにマウスを乗せる（mockups/v45 案A。窓・左の道具・表を写す） ----
  await goToBlock(page, 't1')
  {
    const at = await page.evaluate(() => {
      const cell = [...document.querySelectorAll('.page-viewport.front [data-cell-id]')].find((c) => c.textContent.trim() === 'ブラウス')
      const r = cell.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
    await page.mouse.click(at.x, at.y)
    await page.waitForFunction(() => window.__editor.getSnapshot().editingKind === 'tableCell', { timeout: 10000 })
    await sleep(300)
    // 「表の形を整える」の窓で選ぶ（窓は開いたまま）
    const press = async (value) => {
      if (!(await page.$('.shape-panel'))) await page.click('.palette .shape-btn')
      await page.waitForSelector('.shape-panel')
      await page.click(`.shape-panel .so-choice[data-value="${value}"]`)
    }
    await press('custom')
    await sleep(400)
    await ready(page)
    await page.waitForSelector('.col-handles .col-grip', { visible: true, timeout: 10000 })
    await sleep(300)
    // 2本目の縦の線（使用箇所と生地見本の間）のつまみにマウスを乗せる（「左右にドラッグ」が出る）
    const grip = await page.evaluate(() => {
      const gs = [...document.querySelectorAll('.col-handles .col-grip')].map((g) => g.getBoundingClientRect())
      const r = gs[1] ?? gs[0]
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
    await page.mouse.move(grip.x, grip.y)
    await sleep(500)
    const palette = await R(page, '.palette')
    const panel = await R(page, '.shape-panel')
    const table = await R(page, `${CUR} [data-table-id="t1"]`)
    const left = Math.min(palette.x, panel.x) - 18
    const top = Math.min(palette.y, panel.y, table.y) - 14
    await capture(page, 'table', { x: Math.max(0, left), y: Math.max(0, top), w: table.x + table.w + 30 - Math.max(0, left), h: Math.max(palette.y + palette.h, panel.y + panel.h, table.y + table.h) + 16 - Math.max(0, top) })
    await press('equal')
    await page.keyboard.press('Escape')
    await sleep(300)
    await page.mouse.move(5, 5)
    await page.keyboard.press('Escape')
    await sleep(400)
    await ready(page)
  }

  // ---- 作品写真：2ページ目（2枚・上下）を見ているところ。左の道具に、並べ方と「写真のページを足す」「このページを消す」 ----
  await page.evaluate(addDetailPhotos)
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, workPhotos: [{ layout: 1, imageIds: ['g-photo1'] }, { layout: 2, columns: 1, imageIds: ['g-photo2', 'g-photo3'] }] })))
  await sleep(600)
  await ready(page)
  await page.evaluate(() => window.__editor.goToPage(window.__editor.getSnapshot().layout.kinds.lastIndexOf('photos'), 'none'))
  await sleep(900)
  await ready(page)
  await page.evaluate(() => document.querySelector('.thumb-list')?.scrollTo(0, 1e6))
  await unfocus(page)
  await page.mouse.move(5, 5)
  await sleep(500)
  {
    const paper = await R(page, CUR)
    // 紙面の右下の「全体・見開き・拡大」は、写真に重なるので、この写真では出さない
    await page.evaluate(() => document.querySelector('.zoom')?.style.setProperty('visibility', 'hidden'))
    await capture(page, 'photos', { x: 0, y: 0, w: paper.x + paper.w + 18, h: PC.height })
    await page.evaluate(() => document.querySelector('.zoom')?.style.removeProperty('visibility'))
  }
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, workPhotos: [{ layout: 1, imageIds: ['g-photo1'] }] })))
  await sleep(500)
  await ready(page)
  await goToBlock(page, 'p3')

  // ---- 保存のようす（「ドライブに保存」を押したところ） ----
  await page.mouse.move(5, 5)
  await page.click('.side .drive-chip-wrap .chip')
  await page.waitForSelector('.drive-pop')
  await sleep(300)
  {
    // 窓のうしろの右の欄（セルフチェック）の字が、窓の端から少し見えるので、撮るあいだだけ隠す。右の端は、窓の右の端まで
    await page.evaluate(() => document.querySelectorAll('.side .sec').forEach((e) => e.style.setProperty('visibility', 'hidden')))
    const pop = await R(page, '.drive-pop')
    const clip = union(await R(page, '.side .side-head'), pad(pop, 10))
    await capture(page, 'drive', { ...clip, w: pop.x + pop.w + 4 - clip.x })
    await page.evaluate(() => document.querySelectorAll('.side .sec').forEach((e) => e.style.removeProperty('visibility')))
  }
  await page.keyboard.press('Escape')
  await sleep(300)

  // ---- バックアップ（自動の控え） ----
  // 「バックアップ・作り直す」は右の欄の「メニュー」の中（mockups/v37 案C）
  await page.click('.side .menu-btn')
  await page.waitForSelector('.side .head-menu')
  await page.evaluate(() => [...document.querySelectorAll('.side .head-menu [role="menuitem"]')].find((b) => b.textContent.includes('バックアップ')).click())
  await page.waitForSelector('.modal .snapshots, .modal .muted')
  await unfocus(page)
  await sleep(400)
  await capture(page, 'backup', await R(page, '.modal'))
  await page.evaluate(() => document.querySelector('.modal .close').click())

  // ---- スマホ：同じアカウントでログインして、紙面に直接書く（キーボードのすぐ上に細い道具）。パソコンの写真と並べる ----
  {
    const phone = await openTool(browser, drive, { phone: true })
    const pp = phone.page
    await ready(pp)
    await pp.waitForSelector('.login-btn')
    await pp.tap('.login-btn')
    await pp.waitForFunction(() => !document.querySelector('.login-over'), { timeout: 90000 })
    await ready(pp)
    await pp.evaluate(() => document.documentElement.classList.add('no-guide', 'no-tablock'))
    // 偽物のドライブは写真（バイナリ）を正しく受け渡せないので、見本の画像を入れ直す
    await pp.evaluate(setupWriting)
    await sleep(800)
    await ready(pp)
    await driveSaved(pp)
    await goToBlock(pp, 'p3')
    await tapChar(pp, 'p3', 14)
    await pp.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p3' && window.__editor.getSnapshot().zoomed, { timeout: 30000 })
    await sleep(900)
    await fakeKeyboard(pp, true)
    await sleep(700)
    const bar = await R(pp, '.direct-bar')
    const writePhone = await grab(pp, { x: 0, y: 0, w: PHONE.width, h: bar.y + bar.h + 120 })
    await fakeKeyboard(pp, false)
    await writeJpeg('write', [writePc, writePhone])
    await pp.evaluate(() => window.__editor.finishEditing())
    await sleep(600)
    // 別の端末（このスマホ）があとから保存した：パソコンで書くと、どちらで続けるかを聞く
    await pp.evaluate(() => window.__editor.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === 'p16' ? { ...b, content: [{ type: 'text', text: '制作を通して、舞台衣装は客席からの見え方と演者の動きやすさの両方を考える必要があることを学んだ。この経験を、今後の衣装制作に生かしたい。（スマホで書き足した）' }] } : b)) })) })))
    // ドライブの原稿に、書き足した分が届くまで待つ
    for (let i = 0; i < 60 && !JSON.stringify(drive.report() ?? {}).includes('スマホで書き足した'); i++) await sleep(500)
    if (!JSON.stringify(drive.report() ?? {}).includes('スマホで書き足した')) throw new Error('スマホの原稿が、ドライブに保存されません')
    await phone.context.close()
  }
  await page.bringToFront()
  await setParagraph(page, 'p15', '一方で、帯の結び目が大きく、場面転換の早替えに時間がかかるという課題が残った。')
  await page.waitForSelector('.drive-two', { timeout: 60000 })
  await unfocus(page)
  await sleep(500)
  await capture(page, 'conflict', await R(page, '.modal'))
  // （この端末の原稿で続ける：ドライブの原稿を開くと、写真を偽物のドライブから読むことになるため）
  await clickText(page, '.modal button', 'この端末の原稿で続ける')
  await page.waitForFunction(() => !document.querySelector('.drive-two'), { timeout: 60000 })
  await ready(page)

  // ---- 1時間たって Google の許可が切れたとき ----
  drive.failNext = 401
  await setParagraph(page, 'p15', '一方で、帯の結び目が大きく、場面転換の早替えに時間がかかるという課題が残った。今後は、着脱のしやすさも考えたい。')
  await page.waitForFunction(() => [...document.querySelectorAll('.modal h2')].some((h) => h.textContent.includes('もう一度ログイン')), { timeout: 60000 })
  await unfocus(page)
  await sleep(400)
  await capture(page, 'relogin', await R(page, '.modal'))
  await clickText(page, '.modal button', 'ログインし直す')
  await driveSaved(page)

  // ---- 同じパソコンで2つめのタブを開いたとき ----
  {
    const second = await context.newPage()
    await prepare(second)
    await second.setViewport(PC)
    await routeGoogle(second, drive, config)
    await second.goto(`${APP}/`, { waitUntil: 'networkidle0', timeout: 90000 })
    await second.waitForSelector('.login-over.tab-locked .login-card', { timeout: 60000 })
    await unfocus(second)
    await sleep(600)
    await capture(second, 'tablock', pad(await R(second, '.login-over.tab-locked .login-card'), 16))
    await second.close()
  }
  await context.close()
}

// =====================================================================
// 管理ページ（試験版）。mockups/v43 案B：左の見出し（年度の設定・コース・書き方のチェック・先生の登録・変更履歴・詳細設定）
// =====================================================================

/** 管理ページ（試験版）を開く。as：teacher なら先生の画面 */
async function openAdmin(browser, { as, viewport = PC } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  page.on('dialog', (d) => d.accept())
  await prepare(page)
  await page.setViewport(viewport)
  await page.goto(`${APP}/admin.html`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => {
    localStorage.removeItem('sotsugyo-admin-mock')
    localStorage.removeItem('sotsugyo-admin-year')
    localStorage.removeItem('sotsugyo-admin-form-width')
    sessionStorage.removeItem('sotsugyo-admin-section')
  })
  await page.goto(`${APP}/admin.html${as ? `?as=${as}` : ''}`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.admin .content')
  await hideMockBadge(page)
  return { context, page }
}

/** 「試験用サーバー」の印は本物の管理ページにはないので出さない */
const hideMockBadge = (page) => page.evaluate(() => [...document.querySelectorAll('.badge')].filter((b) => b.textContent.includes('試験用')).forEach((b) => b.style.setProperty('display', 'none')))

/** 左の見出しの区切りを押す（title：「年度の設定」「コース」など） */
const nav = async (page, title) => {
  await page.evaluate((t) => [...document.querySelectorAll('.side-nav button')].find((b) => b.querySelector('.nt b').firstChild.textContent.trim() === t).click(), title)
  await page.waitForFunction((t) => document.querySelector('.content .sec-h')?.textContent.startsWith(t), {}, title)
  await sleep(500)
  await hideMockBadge(page)
}

/** 入力欄に字を入れる（React に知らせる） */
const setValue = (handle, text) =>
  handle.evaluate((el, text) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, text)

/** 管理ページの見本（iframe）は作り直しが止まるまで待つ */
async function previewStable(page) {
  for (let i = 0; i < 40; i++) {
    const stable = await page.evaluate(() => {
      const d = document.querySelector('.preview iframe')?.contentDocument
      if (!d || d.readyState !== 'complete' || d.querySelectorAll('.page').length !== 2) return false
      if (d.__helpSeen) return true
      d.__helpSeen = true
      return false
    })
    if (stable) return
    await sleep(800)
  }
  throw new Error('管理ページの見本が表示されません')
}
const previewReady = async (page) => {
  await previewStable(page)
  await page.evaluate(() => document.querySelector('.preview iframe').contentDocument.fonts.ready)
  await sleep(600)
  await previewStable(page)
}
/** 見本の1ページ目（表紙）の範囲 */
const previewPage = (page) =>
  page.evaluate(() => {
    const f = document.querySelector('.preview iframe')
    const fr = f.getBoundingClientRect()
    const r = f.contentDocument.querySelector('.page').getBoundingClientRect()
    return { x: fr.left + r.left, y: fr.top + r.top, w: r.width, h: r.height }
  })

/** 「ひな形を作る画面を開く」を押して、重ねた窓の中の学生のツールが開くまで待つ（e2e/templateMode.mjs と同じ） */
async function openTemplate(page) {
  await page.evaluate(() => document.querySelector('.course.open .tpl-open').click())
  await page.waitForSelector('.tpl-overlay iframe')
  await page.waitForFunction(() => !document.querySelector('.tpl-opening'), { timeout: 30000 })
  const frame = page.frames().find((f) => f.url().includes('template=1') && f.parentFrame() === page.mainFrame())
  await frame.waitForFunction(() => {
    const s = window.__editor?.getSnapshot()
    return s?.layout && !s.rendering && !s.turning && s.zoomed
  }, { timeout: 60000 })
  await sleep(900)
  return frame
}

async function adminShots(browser) {
  const { context, page } = await openAdmin(browser)

  // ---- 年度の設定（左の見出し・年度の欄・右の見本） ----
  await page.mouse.move(5, 5)
  await previewReady(page)
  {
    const pp = await previewPage(page)
    await capture(page, 'admin-main', { x: 0, y: 0, w: PC.width, h: pp.y + pp.h + 14 })
  }

  // ---- 変更があるときの下の帯（締切を1日ずらす。直した欄に「変更あり」、左の見出しに数、下に帯） ----
  await setValue(await page.$('#y-deadline'), '2027-01-22')
  await page.waitForSelector('.dirty-bar')
  await page.mouse.move(5, 5)
  await previewReady(page)
  await sleep(400)
  await capture(page, 'admin-save', { x: 0, y: 0, w: PC.width, h: PC.height })

  // ---- コース（開いたコースのカード） ----
  await nav(page, 'コース')
  await page.waitForSelector('.course.open .tpl-open')
  await page.mouse.move(5, 5)
  await capture(page, 'admin-course', pad(await R(page, '.course.open'), 10))

  // ---- 下書きのひな形を作る画面（管理ページの上に重ねた窓。中は学生と同じ紙面） ----
  {
    await openTemplate(page)
    await page.mouse.move(5, 5)
    await capture(page, 'admin-template', { x: 0, y: 0, w: PC.width, h: PC.height })
    // 直していないので、「やめる」で確かめずに閉じる
    const frame = page.frames().find((f) => f.url().includes('template=1'))
    await frame.evaluate(() => [...document.querySelectorAll('.tpl-foot button')].find((b) => b.textContent === 'やめる').click())
    await page.waitForFunction(() => !document.querySelector('.tpl-overlay'), { timeout: 10000 })
  }

  // ---- 書き方のチェック（書き間違えやすい語の一覧と、試しに確かめる） ----
  await nav(page, '書き方のチェック')
  await page.mouse.move(5, 5)
  await capture(page, 'admin-words', pad(union(await R(page, '.content .sec-h'), await R(page, '.words')), 14))

  // ---- 先生の登録：登録済みの人（試験版の example.ac.jp）と、メールアドレスを貼り付ける欄 ----
  await nav(page, '先生の登録')
  await page.mouse.move(5, 5)
  await capture(page, 'admin-members', pad(union(await R(page, '.content .sec-h'), await R(page, '.members')), 14))

  // ---- 詳細設定：Google の障害のとき（学生のドライブ保存） ----
  await nav(page, '詳細設定')
  await page.mouse.move(5, 5)
  await capture(page, 'admin-switch', pad(await R(page, '.content .card', 'Google の障害のとき'), 10))

  // ---- 保存して学生に反映 → 新年度を作成（準備中の年度の「新年度の準備」） ----
  await page.evaluate(() => document.querySelector('.dirty-bar .btn.primary').click())
  await page.waitForFunction(() => !document.querySelector('.dirty-bar') && !document.querySelector('.admin-header .busy'), { timeout: 30000 })
  await nav(page, '年度の設定')
  await page.evaluate(() => document.querySelector('.next-year button').click())
  await page.waitForSelector('.modal')
  await clickText(page, '.modal button', '作成する')
  await page.waitForFunction(() => document.querySelector('.badge.draft')?.textContent === '準備中', { timeout: 30000 })
  // 「作成しました」の知らせが消えるまで待つ
  await page.waitForFunction(() => !document.querySelector('.admin-header .done-note, .admin-header .done'), { timeout: 15000 }).catch(() => {})
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.evaluate(() => document.querySelector('.content')?.scrollTo?.(0, 0))
  await page.mouse.move(5, 5)
  await previewReady(page)
  await unfocus(page)
  await sleep(400)
  {
    const steps = await R(page, '.steps-card')
    await capture(page, 'admin-newyear', { x: 0, y: 0, w: PC.width, h: steps.y + steps.h + 16 })
  }
  await context.close()

  // ---- 先生の画面（コースと書き方のチェックだけ） ----
  const t = await openAdmin(browser, { as: 'teacher' })
  await t.page.waitForSelector('.course.open')
  await t.page.mouse.move(5, 5)
  await sleep(500)
  {
    const course = await R(t.page, '.course.open')
    await capture(t.page, 'admin-teacher', { x: 0, y: 0, w: PC.width, h: course.y + course.h + 16 })
  }
  await t.context.close()
}

await withEdge(async (browser) => {
  shrinker = await browser.newPage()
  await shrinker.goto('about:blank')
  if (doShot('student')) {
    console.log('学生用ツール')
    await studentShots(browser)
  }
  if (doShot('admin')) {
    console.log('管理ページ')
    await adminShots(browser)
  }
})
