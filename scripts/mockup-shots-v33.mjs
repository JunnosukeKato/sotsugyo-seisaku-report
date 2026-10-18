// デザイン案 v33（スマホを横に持ったとき、作品写真のページの「並べ方」の道具が紙面の大半を隠して、写真を見ながら選べない）を画像に書き出す。
// 本物の学生用ツール（開発サーバーの /?nodrive。ログインなし）に見本の原稿（scripts/e2e/sampleReport.mjs の setupWriting。衣装コースの架空の学生）を入れ、
// 作品写真のページ（2枚・上下）を出して、その画面の一部を案ごとに書き換えて写す（src/ は変えない）。見本の画像は docs/guide-images/sample/（読むだけ）。
// できるもの：mockups/v33/shots/*.png（案の画面）と、shots/review-landscape.png（一覧のページ mockups/v33/review.html の写し）
// 使い方: node scripts/mockup-shots-v33.mjs [now] [a] [b] [c] [portrait] [review]（何も付けなければ全部。開発サーバーが http://localhost:5173 で動いていること）
//   now     ：いま（横向き。並べ方の道具が紙面に重なる）
//   a       ：案A 並べ方を紙面の右の列に出す（選ぶ前・選んだあと・空いている枠があって帯と並ぶとき）
//   b       ：案B 下の「並べ方：2枚 上下 ▾」1つにまとめ、押すと小さな欄で選ぶ（閉じている・開いた・選んだあと）
//   c       ：案C 下の道具を細い1列（絵と小さな名前だけ）にし、紙面をその上に収まるよう小さくする（選ぶ前・選んだあと）
//   portrait：縦向き（3案とも今のまま）
//   review  ：一覧のページ（mockups/v33/review.html）を画像にする
//   Edge は EDGE_PORT（ふだんは 9601）で起動する
import { mkdirSync } from 'node:fs'

process.env.EDGE_PORT ??= '9601'
const { withEdge } = await import('./poc/edge.mjs')
const { stubConfig } = await import('./e2e/configStub.mjs')
const { setupWriting } = await import('./e2e/sampleReport.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const DIR = 'mockups/v33'
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })
const ONLY = process.argv.slice(2)
const want = (k) => ONLY.length === 0 || ONLY.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const LAND = { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

// ---- アイコン（src/app/icons.tsx と同じ線） ----
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const IC = {
  chevDown: svg('<path d="M6.5 9.5L12 15l5.5-5.5"/>'),
}

/** 案の部品の見た目。色と書体は src/tokens.css・src/index.css のもの */
const CSS = `
  .v33-x { position: fixed; z-index: 12; font-family: 'BIZ UDPGothic', sans-serif; box-sizing: border-box; }
  .v33-x * { box-sizing: border-box; }
  /* 案A・B：並べ方のボタン（3列×2段）。絵の下に「2枚 上下」を1行で。高さは 44px 以上 */
  .v33-lays { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .v33-lay { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 52px; padding: 6px 2px 5px; border: 1px solid var(--line); border-radius: 10px; background: #fff; color: var(--ink); font: inherit; font-size: 12.5px; line-height: 1.2; white-space: nowrap; }
  .v33-lay .lay-grid { width: 15px; height: 21px; margin: 0; }
  .v33-lay.on { border: 1.5px solid var(--accent); background: var(--accent-soft); color: var(--accent); font-weight: 700; }
  .v33-lay.on .lay-grid i { background: var(--accent); }
  /* 案A：紙面の右の列（帯と同じ列）の「並べ方」 */
  .v33-side { padding: 9px 10px 10px; border: 1px solid var(--line); border-radius: 14px; background: #fff; box-shadow: var(--float-shadow); }
  .v33-hd { display: flex; align-items: baseline; gap: 8px; margin: 0 2px 7px; font-size: 13px; font-weight: 700; color: var(--accent); letter-spacing: 0.06em; }
  .v33-hd small { font-size: 11.5px; font-weight: 400; color: var(--muted); letter-spacing: 0.02em; }
  /* 案B：下の「並べ方：2枚 上下 ▾」（ページ送りと同じ高さ・同じ形）と、押すと出る小さな欄 */
  .v33-pick { display: flex; align-items: center; gap: 8px; padding: 0 12px 0 14px; border: 1px solid var(--line); border-radius: 999px; background: rgba(255, 255, 255, 0.97); box-shadow: var(--float-shadow); color: var(--ink); font: inherit; font-size: 13.5px; white-space: nowrap; }
  .v33-pick .lay-grid { width: 13px; height: 18px; flex: none; }
  .v33-pick .lay-grid i { background: var(--accent); }
  .v33-pick b { color: var(--accent); }
  .v33-pick svg { width: 18px; height: 18px; flex: none; color: var(--muted); }
  .v33-pick.open { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent), var(--float-shadow); }
  .v33-pick.open svg { transform: rotate(180deg); color: var(--accent); }
  .v33-sheet { z-index: 30; padding: 10px 10px 10px; border: 1px solid var(--line); border-radius: 14px; background: #fff; box-shadow: 0 10px 28px rgba(30, 25, 20, 0.22); }
  .v33-sheet::after { content: ''; position: absolute; right: var(--tail, 40px); bottom: -6px; width: 11px; height: 11px; background: #fff; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); transform: rotate(45deg); }
  /* スマホの紙面のスクロールバーは出さない（iPhone では重ねて出て、すぐ消えるため。撮影用の Edge だけ、いつも出てしまう） */
  .app.phone .page-scroller { scrollbar-width: none; }
`

/** 案C：今の下の道具を、細い1列（絵と、その下の小さな名前だけ）にする。「並べ方」の文字は出さない。押せる大きさは 44px 四方以上 */
const THIN_CSS = `
  .sel-bar .group.ctx { gap: 2px; padding: 3px; border-radius: 12px; }
  .sel-bar .ctx-label { display: none !important; }
  .sel-bar .layouts { gap: 2px; }
  .sel-bar .lay { display: grid; grid-template-columns: auto auto; justify-content: center; align-content: center; column-gap: 2px; row-gap: 3px; width: 50px; min-height: 44px; padding: 3px 0; border-color: transparent; font-size: 10px; line-height: 1.1; }
  .sel-bar .lay.on { border-color: var(--accent); background: var(--accent-soft); }
  .sel-bar .lay-grid { grid-column: 1 / -1; justify-self: center; width: 11px; height: 15px; margin: 0; }
  .sel-bar .lay-sub { font-size: 10px; }
  .sel-bar .lay-n:last-child { grid-column: 1 / -1; justify-self: center; }
`

/** 案A・B：今の下の道具は出さない（同じものを、右の列・小さな欄に出す） */
const HIDE_BAR_CSS = '.sel-bar { display: none !important; }'

/** ページの中で使う道具（位置を測る・部品を足す・消す） */
async function installKit(page) {
  await page.evaluate((css) => {
    const style = document.createElement('style')
    style.id = 'v33-style'
    style.textContent = css
    document.head.append(style)
    const state = document.createElement('style')
    state.id = 'v33-state'
    document.head.append(state)
    window.__v33 = {
      /** 画面での位置 */
      box(sel) {
        const r = document.querySelector(sel).getBoundingClientRect()
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
      },
      /** いま見ているページの位置 */
      page() {
        return this.box('.page-viewport.front [data-vivliostyle-page-container].is-current')
      },
      /** 本物の並べ方のボタン（下の道具の中。隠していても、ツールが今の並べ方に合わせて描き直している）から、案のボタンを作る */
      lays() {
        return [...document.querySelectorAll('.sel-bar .layouts .lay')].map((b) => ({
          grid: b.querySelector('.lay-grid').outerHTML,
          text: [...b.querySelectorAll('.lay-n, .lay-sub')].map((s) => s.textContent).join(' '),
          on: b.classList.contains('on'),
        }))
      },
      laysHtml() {
        return this.lays().map((l) => `<button class="v33-lay${l.on ? ' on' : ''}">${l.grid}<span>${l.text}</span></button>`).join('')
      },
      /** 部品を足す（body の直下。fixed で画面に置く） */
      add(html) {
        document.body.insertAdjacentHTML('beforeend', html)
        return document.body.lastElementChild
      },
      /** 案の部品を全部外し、帯・紙面の位置を元に戻す */
      clear() {
        document.querySelectorAll('.v33-x').forEach((e) => e.remove())
        document.getElementById('v33-state').textContent = ''
        const band = document.querySelector('.page-band')
        if (band) for (const p of ['left', 'right', 'width', 'max-width', 'max-height']) band.style.removeProperty(p)
      },
      /** その案だけの見た目 */
      state(css) {
        document.getElementById('v33-state').textContent = css
      },
    }
  }, CSS)
}

const ready = (page) =>
  page.waitForFunction(() => {
    const s = window.__editor?.getSnapshot()
    return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading')
  }, { timeout: 120000 })

/** 学生用ツールを開き、はじめての案内を閉じて、見本の原稿を入れる */
async function open(browser, vp) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  page.on('dialog', (d) => d.accept())
  // 開発サーバーの即時反映をつながない（撮っている途中に src/ が直されても、画面が入れ替わらないように）。指差し確認は見たことにする
  await page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  })
  await stubConfig(page)
  if (vp.isMobile) await page.setUserAgent(UA_IPHONE)
  await page.setViewport(vp)
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0', timeout: 90000 })
  await ready(page)
  await page.waitForSelector('.guide.step-course .g-opts button', { timeout: 60000 })
  await page.evaluate(() => [...document.querySelectorAll('.guide .g-opts button')].find((b) => b.textContent.includes('映画・舞台衣装')).click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no', { timeout: 60000 })
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.guide .g-later', { timeout: 60000 })
  await page.evaluate(() => document.querySelector('.guide .g-later').click())
  await page.evaluate(() => window.__editor.finishEditing())
  await ready(page)
  await page.evaluate(setupWriting)
  await sleep(600)
  await ready(page)
  // 表紙の学籍番号も入れる（指摘が出ないように）
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, studentId: '00ZZ0123' } })))
  await sleep(300)
  await ready(page)
  await preparePhotos(page)
  await sleep(300)
  await ready(page)
  await installKit(page)
  await showPhotos(page)
  return { context, page }
}

/**
 * 作品写真のページ：2枚（上下）。上は縦長の全身（「全体を入れる（切らない）」を入れてある）、下は横長の部分の写真（photo-1.jpg の一部を切り出したもの）
 */
const preparePhotos = (page) =>
  page.evaluate(async () => {
    const { importImage } = await import('/src/model/images.ts')
    const im = await new Promise((resolve) => { const i = new Image(); i.onload = () => resolve(i); i.src = '/docs/guide-images/sample/photo-1.jpg' })
    const c = document.createElement('canvas')
    c.width = 640
    c.height = 480
    c.getContext('2d').drawImage(im, 130, 250, 640, 480, 0, 0, 640, 480)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92))
    window.__editor.addImages([await importImage(blob, 'g-detail', 1200)])
    window.__editor.update((r) => ({ ...r, workPhotos: { layout: 2, columns: 1, imageIds: ['g-photo1', 'g-detail'], whole: [true, false] } }))
  })

/** 作品写真のページを出す（何も選んでいない。下に並べ方の道具が出る） */
async function showPhotos(page) {
  await page.evaluate(() => {
    window.__editor.select(null)
    window.__editor.goToPage(window.__editor.getSnapshot().layout.kinds.indexOf('photos'), 'none')
  })
  await ready(page)
  await sleep(400)
}

/** 並べ方を変える（ツールの本物の動き）。2枚：columns 2＝左右・1＝上下 */
async function setLayout(page, layout, columns) {
  await page.evaluate((layout, columns) => window.__editor.setPhotoLayout(layout, columns), layout, columns)
  await sleep(400)
  await ready(page)
  await sleep(400)
}
/** 見本の並べ方（2枚・上下）に戻す */
const resetLayout = (page) => setLayout(page, 2, 1)
/** 2枚（上下）に入れる写真を変える（'' は空いている枠） */
async function setPhotos(page, ids) {
  await page.evaluate((ids) => window.__editor.update((r) => ({ ...r, workPhotos: { layout: 2, columns: 1, imageIds: ids, whole: [true, false] } })), ids)
  await sleep(400)
  await ready(page)
  await sleep(400)
}

/** 確かめ：横にはみ出していないか・案の部品が画面の外に出ていないか・紙面に重なっていないか */
const audit = (page, name) =>
  page
    .evaluate(() => {
      const bad = []
      if (document.documentElement.scrollWidth > innerWidth + 1) bad.push(`横にはみ出している（${document.documentElement.scrollWidth}px）`)
      const p = window.__v33.page()
      for (const el of document.querySelectorAll('.v33-x, .page-band')) {
        const r = el.getBoundingClientRect()
        if (!r.width) continue
        if (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1 || r.top < -1) bad.push(`画面の外：${el.className}`)
        if (r.left < p.right && r.right > p.left && r.top < p.bottom && r.bottom > p.top) bad.push(`紙面に重なる：${el.className}`)
      }
      return bad
    })
    .then((bad) => bad.length && console.log(`  ！${name}：${bad.join(' ／ ')}`))

async function shot(page, name) {
  await page.evaluate(() => document.fonts.ready)
  await sleep(300)
  await audit(page, name)
  // captureBeyondViewport: false：写すときに画面の大きさを変えない
  await page.screenshot({ path: `${OUT}/${name}.png`, captureBeyondViewport: false })
  console.log('✓', name)
}

// =====================================================================
// いま
// =====================================================================
async function nowShots(page) {
  await shot(page, 'land-now')
}

// =====================================================================
// 案A：紙面の右の列（帯と同じ列）に「並べ方」。紙面は左にそのまま全部見える
// =====================================================================

/** 右の列に、帯（あれば）と「並べ方」を縦に積み、列の高さの真ん中に置く */
const placeSide = (page) =>
  page.evaluate(() => {
    const k = window.__v33
    const st = k.box('.stage')
    const p = k.page()
    const pg = k.box('.pager')
    // 列の左：紙面の右から 18px（帯と同じ）。ページ送りより右にして、列は台の下まで使う
    const left = Math.max(p.right + 18, pg.right + 12)
    const width = Math.min(380, innerWidth - 10 - left)
    const panel = k.add(`<div class="v33-x v33-side" style="left:${left}px;width:${width}px;top:0"><div class="v33-hd">並べ方</div><div class="v33-lays">${k.laysHtml()}</div></div>`)
    const band = document.querySelector('.page-band')
    const GAP = 8
    if (band) {
      band.style.left = `${left - st.left}px`
      band.style.right = 'auto'
      band.style.width = `${width}px`
      band.style.maxWidth = 'none'
      band.style.maxHeight = 'none'
    }
    const bh = band ? band.offsetHeight + GAP : 0
    const top0 = st.top + 10
    const room = st.bottom - 10 - top0
    const y = top0 + Math.max(0, (room - bh - panel.offsetHeight) / 2)
    if (band) band.style.top = `${y - st.top}px`
    panel.style.top = `${y + bh}px`
  })

async function aShots(page) {
  await page.evaluate((css) => window.__v33.state(css), HIDE_BAR_CSS)
  await placeSide(page)
  await shot(page, 'land-a-1')
  await page.evaluate(() => window.__v33.clear())
  // 「2枚 左右」を押したあと（紙面がすぐ変わる。列はそのまま）
  await setLayout(page, 2, 2)
  await page.evaluate((css) => window.__v33.state(css), HIDE_BAR_CSS)
  await placeSide(page)
  await shot(page, 'land-a-2')
  await page.evaluate(() => window.__v33.clear())
  await resetLayout(page)
  // 下の枠がまだ空いているとき（はじめての学生の試しと同じ）：帯「下の枠に、まだ写真がありません」が、同じ列の上に並ぶ
  await setPhotos(page, ['g-photo1', ''])
  await page.evaluate((css) => window.__v33.state(css), HIDE_BAR_CSS)
  await placeSide(page)
  await shot(page, 'land-a-3')
  await page.evaluate(() => window.__v33.clear())
  await setPhotos(page, ['g-photo1', 'g-detail'])
}

// =====================================================================
// 案B：下の「並べ方：2枚 上下 ▾」1つ（ページ送りの右）。押すと小さな欄が開き、選ぶと閉じる
// =====================================================================

const pickButton = (page, open, chev) =>
  page.evaluate((open, chev) => {
    const k = window.__v33
    const pg = k.box('.pager')
    const cur = k.lays().find((l) => l.on)
    const btn = k.add(`<button class="v33-x v33-pick${open ? ' open' : ''}" style="right:12px;bottom:${innerHeight - pg.bottom}px;height:${pg.height}px">${cur.grid}<span>並べ方：<b>${cur.text}</b></span>${chev}</button>`)
    if (!open) return
    const b = btn.getBoundingClientRect()
    const p = k.page()
    const width = Math.min(320, innerWidth - 12 - (p.right + 18))
    const sheet = k.add(`<div class="v33-x v33-sheet" style="right:12px;width:${width}px;bottom:${innerHeight - b.top + 10}px"><div class="v33-hd">並べ方を選ぶ<small>選ぶと閉じます</small></div><div class="v33-lays">${k.laysHtml()}</div></div>`)
    // 欄のしっぽを、ボタンの「▾」の上に
    sheet.style.setProperty('--tail', `${innerWidth - 12 - (b.right - 22)}px`)
  }, open, chev)

async function bShots(page) {
  await page.evaluate((css) => window.__v33.state(css), HIDE_BAR_CSS)
  await pickButton(page, false, IC.chevDown)
  await shot(page, 'land-b-1')
  await page.evaluate(() => window.__v33.clear())
  await page.evaluate((css) => window.__v33.state(css), HIDE_BAR_CSS)
  await pickButton(page, true, IC.chevDown)
  await shot(page, 'land-b-2')
  await page.evaluate(() => window.__v33.clear())
  // 「2枚 左右」を選んだあと：欄は閉じ、ボタンの名前が変わる
  await setLayout(page, 2, 2)
  await page.evaluate((css) => window.__v33.state(css), HIDE_BAR_CSS)
  await pickButton(page, false, IC.chevDown)
  await shot(page, 'land-b-3')
  await page.evaluate(() => window.__v33.clear())
  await resetLayout(page)
}

// =====================================================================
// 案C：下の道具は今の場所のまま、細い1列にする。紙面は、その上に収まるよう小さくする
// =====================================================================

/**
 * 道具を細くし、紙面をその上に収まる大きさにする。
 * 今のツールは紙面を 0.2 倍より小さくしない（editor/pageStage.ts）ので、台の余白を広げるだけでは小さくならない。
 * ここでは、紙面の倍率と位置（台の --s など。pageStage.ts が書き込む値）を、写すときだけ上書きする
 */
const thinAndShrink = (page) =>
  page.evaluate((thin) => {
    const k = window.__v33
    k.state(thin)
    const st = k.box('.stage')
    const bar = k.box('.sel-bar .group.ctx')
    const top = 8
    const h = bar.top - 8 - (st.top + top)
    const s = h / 1122.52
    const w = 793.7 * s
    k.state(`${thin} .app.phone .stage { --s: ${s} !important; --page-w: ${w}px !important; --page-h: ${h}px !important; --page-top: ${top}px !important; --page-left: ${(st.width - w) / 2}px !important; }`)
  }, THIN_CSS)

async function cShots(page) {
  await thinAndShrink(page)
  await sleep(400)
  await shot(page, 'land-c-1')
  // 「2枚 左右」を押したあと
  await setLayout(page, 2, 2)
  await shot(page, 'land-c-2')
  await page.evaluate(() => window.__v33.clear())
  await sleep(300)
  await resetLayout(page)
}

// =====================================================================
// 縦向き（3案とも今のまま）
// =====================================================================
async function portraitShots(page) {
  await page.setViewport(PHONE)
  await sleep(800)
  await ready(page)
  await showPhotos(page)
  await shot(page, 'portrait')
  await page.setViewport(LAND)
  await sleep(800)
  await ready(page)
  await showPhotos(page)
}

// =====================================================================
// 一覧のページ（mockups/v33/review.html）を画像にする（shots/review-landscape.png）
// =====================================================================
async function reviewShots(browser) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1300, height: 900, deviceScaleFactor: 1 })
  await page.goto(`${APP}/${DIR}/review.html`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${OUT}/review-landscape.png`, fullPage: true })
  console.log('✓', 'review-landscape')
  await page.close()
}

await withEdge(async (browser) => {
  if (['now', 'a', 'b', 'c', 'portrait'].some(want)) {
    const { context, page } = await open(browser, LAND)
    if (want('now')) await nowShots(page)
    if (want('a')) await aShots(page)
    if (want('b')) await bShots(page)
    if (want('c')) await cShots(page)
    if (want('portrait')) await portraitShots(page)
    await context.close()
  }
  if (want('review')) await reviewShots(browser)
})
