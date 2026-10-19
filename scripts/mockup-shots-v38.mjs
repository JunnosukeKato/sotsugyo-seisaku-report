// デザイン案 v38（作品写真を何ページかにできるようにする。1ページは4枚まで、6枚の並べ方はなくす：依頼者の判断）を画像に書き出す。
// ① 学生用ツール（開発サーバーの /?nodrive。ログインなし）：写真のページの足し方・消し方の3案（案A：左の道具に「＋ 写真のページを足す」「このページを消す」、
//    案B：紙面の下に点線の「＋ 写真のページを足す」、案C：最後のページの枠がうまると、自動で空のページができる）。
//    おすすめの案は、スマホの道具・セルフチェックの「まだのところ」の行・6枚の並べ方をなくした並べ方の選び方も。
//    見本の原稿（scripts/e2e/sampleReport.mjs の setupWriting）に、作品写真の見本（docs/guide-images/sample/photo-1.jpg を切り抜いたもの。読むだけ）を足して写す。
//    写真のページは本物の紙面（1ページ分）。2ページ目のある絵は、1ページ目のときのページの一覧の絵を写し取っておき、並べて見せる（src/ は変えない）
// ② 提出前チェック（開発サーバーの check.html）：見本の Word・PDF（scripts/e2e/fixtures/word-sample-*）と写真5枚を入れ、
//    4枚＋1枚・3枚＋2枚の2ページに分けたところ（ページの絵は本物の src/check/photo.ts の photoPageImage で、ページごとに作る）と、「6枚まで」と書いてある所の言葉
// できるもの：mockups/v38/shots/*.png（案の画面）と、shots/review-photos-tool.png（①の3案）・review-photos-tool-a.png（おすすめの案のくわしい絵）・
//   review-photos-check.png（②）（一覧のページ mockups/v38/review.html の写し）
// 使い方: node scripts/mockup-shots-v38.mjs [tool] [phone] [check] [review]（何も付けなければ全部。開発サーバーが http://localhost:5173 で動いていること）
//   tool  ：① パソコン（いま・案A・案B・案C、案A の「まだのところ」の行・ページを消したときの知らせ）
//   phone ：① スマホ（いま・案A の道具・案A のチェックの欄）
//   check ：② 提出前チェック（いま・4枚＋1枚・3枚＋2枚・「並べ替え・外す」の窓・入れすぎたときの知らせ）
//   review：一覧のページ（mockups/v38/review.html）を画像にする
//   Edge は EDGE_PORT（ふだんは 9726）で起動する
import { mkdirSync, readFileSync } from 'node:fs'

process.env.EDGE_PORT ??= '9726'
const { withEdge } = await import('./poc/edge.mjs')
const { stubConfig } = await import('./e2e/configStub.mjs')
const { setupWriting } = await import('./e2e/sampleReport.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const DIR = 'mockups/v38'
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })
const ONLY = process.argv.slice(2)
const want = (k) => ONLY.length === 0 || ONLY.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PC = { width: 1366, height: 768, deviceScaleFactor: 1.5 }
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

// ---- アイコン（src/app/icons.tsx と同じ線） ----
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const IC = {
  /** 写真のページを足す（紙に ＋） */
  pageAdd: svg('<rect x="5" y="3.5" width="14" height="17" rx="1.6"/><path d="M12 8.8v6.6M8.7 12.1h6.6"/>'),
  /** 消す（ごみ箱。src/app/icons.tsx の remove） */
  remove: svg('<path d="M5 7h14M10 7V5.5h4V7M7 7l.9 12h8.2L17 7"/>'),
  undo: svg('<path d="M9 7.5L5 11.5l4 4M5 11.5h9.5a4.5 4.5 0 010 9H12"/>'),
  next: svg('<path d="M9.5 5l7 7-7 7"/>'),
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
}

/** 案の部品の見た目。色と書体は src/tokens.css・src/index.css・src/check/check.css のもの */
const CSS = `
  .v38-x { box-sizing: border-box; }
  .v38-fixed { position: fixed; z-index: 60; }
  [data-v38-hidden] { display: none !important; }

  /* ===== ① 左の道具の「ページ」の欄（案A：足す・消す、案B：消すだけ） ===== */
  .palette .group.ctx.v38-pages { padding: 4px 0 3px; }
  .palette .v38-pages .tb { padding: 6px 0 5px; gap: 3px; line-height: 1.3; letter-spacing: 0; }
  .palette .v38-pages .tb svg { width: 20px; height: 20px; }
  .palette .v38-pages .tb.v38-add { color: var(--accent); font-weight: 700; }
  /* 案C：並べ方の下の説明 */
  .palette .ctx-note.v38-cnote { color: var(--accent); }
  /* 左の道具の上の名前「作品写真 2」（1行に収める） */
  .palette .p-head b.v38-head { letter-spacing: 0.02em; white-space: nowrap; }
  /* ページの一覧：自動で足した空のページ（案C） */
  .thumb-list .t.v38-empty { position: relative; }
  .thumb-list .t.v38-empty .mini { opacity: 0.55; outline: 1.5px dashed #9fa8cc; outline-offset: 1px; }
  .thumb-list .t.v38-empty .v38-emptytag { position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%); padding: 2px 7px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font-size: 10.5px; font-weight: 700; white-space: nowrap; }

  /* ===== ① 案B：紙面の下の「＋ 写真のページを足す」（図・表の下の「＋ ここに続きを書く」と同じ形）。全体表示では紙面を少し小さくして、下に出す ===== */
  .stage.v38-shrink .page-scroller { transform: scale(0.935); transform-origin: 50% 18px; }
  .v38-addrow { position: fixed; z-index: 9; display: flex; align-items: center; justify-content: center; gap: 6px; height: 32px; padding: 0 12px; border: 1.5px dashed #9fa8cc; border-radius: 8px; background: rgba(232, 235, 245, 0.9); color: var(--accent); font-family: 'BIZ UDPGothic', sans-serif; font-size: 12.5px; font-weight: 700; letter-spacing: 0.03em; white-space: nowrap; }
  .v38-addrow svg { width: 15px; height: 15px; flex: none; }

  /* ===== ① 案C：自動で足したページの札（紙面の上） ===== */
  .v38-pill { position: fixed; z-index: 9; transform: translateX(-50%); padding: 7px 16px; border-radius: 999px; background: rgba(43, 46, 54, 0.88); color: #fff; font-family: 'BIZ UDPGothic', sans-serif; font-size: 12.5px; line-height: 1.5; text-align: center; white-space: nowrap; box-shadow: 0 6px 16px rgba(20, 20, 30, 0.25); }
  .v38-pill small { display: block; font-size: 11.5px; opacity: 0.85; }
  /* 知らせ（案A：ページを消したとき、案C：ページを足したとき）。本物の「戻す」の知らせ（.undo-toast）の形 */
  .undo-toast.v38-x .v38-tt { line-height: 1.5; }
  .undo-toast.v38-x .v38-tt small { display: block; font-size: 12px; opacity: 0.8; }
  .undo-toast.v38-x .undo-timer span { animation: none; transform: scaleX(0.82); }

  /* ===== ① スマホ（案A）：並べ方の横に、ページの道具 ===== */
  .sel-bar .v38-sep { flex: none; width: 1px; align-self: stretch; margin: 4px 2px 4px 4px; background: var(--line); }
  .app.phone .sel-bar .tb.v38-pg { min-width: 0; width: 52px; padding: 3px 0; gap: 2px; font-size: 10.5px; line-height: 1.25; letter-spacing: -0.03em; white-space: nowrap; }
  .app.phone .sel-bar .tb.v38-pg svg { width: 20px; height: 20px; }
  .app.phone .sel-bar .tb.v38-add { color: var(--accent); font-weight: 700; }

  /* ===== ② 提出前チェック：「並べ替え・外す」の窓のページの区切り ===== */
  .photo-menu li.v38-pgh { display: flex; justify-content: space-between; align-items: baseline; padding: 7px 6px 3px; border-radius: 0; font-size: 12px; font-weight: 700; color: var(--accent); letter-spacing: 0.04em; }
  .photo-menu li.v38-pgh:not(:first-child) { margin-top: 4px; border-top: 1px solid var(--line); }
  .photo-menu li.v38-pgh span { font-weight: 400; font-size: 11.5px; color: var(--muted); letter-spacing: 0; }
  /* まとめた PDF の作品写真のページ（大きく並べて見せる） */
  .v38-a4 { position: fixed; z-index: 70; left: 0; top: 0; display: flex; gap: 26px; padding: 18px 24px 12px; background: #eceae6; font-family: 'BIZ UDPGothic', sans-serif; }
  .v38-a4 figure { margin: 0; text-align: center; font-size: 13px; color: #5d6068; }
  .v38-a4 img { display: block; width: 250px; margin-bottom: 7px; background: #fff; box-shadow: 0 1px 2px rgba(30, 25, 20, 0.1), 0 8px 20px rgba(30, 25, 20, 0.12); }
`

/** ページの中で使う道具（部品を足す・隠す・書き換える・元に戻す） */
async function installKit(page) {
  await page.evaluate((css) => {
    const style = document.createElement('style')
    style.id = 'v38-style'
    style.textContent = css
    document.head.append(style)
    const lastText = (el) => [...el.childNodes].reverse().find((n) => n.nodeType === 3 && n.nodeValue.trim())
    window.__v38 = {
      /** 部品を足す（body の直下） */
      add(html) {
        document.body.insertAdjacentHTML('beforeend', html)
        return document.body.lastElementChild
      },
      /** 本物の部品を隠す */
      hide(el) {
        el?.setAttribute('data-v38-hidden', '')
      },
      /**
       * 本物の部品を隠して、すぐ後ろに案の部品（class に v38-x）を置く。React が作った部品の中身は書き換えない
       * （中身を入れ替えて戻すと、React が覚えている部品と食い違い、あとで原稿を変えたときに画面が落ちるため）
       */
      swap(el, html) {
        el.setAttribute('data-v38-hidden', '')
        el.insertAdjacentHTML('afterend', html)
        return el.nextElementSibling
      },
      /** 本物の部品のすぐ後ろ（before：前）に、案の部品を足す */
      after(el, html, before = false) {
        el.insertAdjacentHTML(before ? 'beforebegin' : 'afterend', html)
        return before ? el.previousElementSibling : el.nextElementSibling
      },
      /** 本物の部品の class を変える（clear で戻す） */
      cls(el, add = [], remove = []) {
        if (!el.hasAttribute('data-v38-class')) el.setAttribute('data-v38-class', el.className)
        el.classList.remove(...remove)
        el.classList.add(...add)
      },
      /** 本物の部品の、最後の文字だけを書き換える（ページの一覧の名前・ページの絵の番号など。中の絵はそのまま。React の文字の部品はそのまま使う） */
      label(el, text) {
        const n = lastText(el)
        if (!el.hasAttribute('data-v38-label')) el.setAttribute('data-v38-label', n.nodeValue)
        n.nodeValue = text
      },
      /** 本物の部品の属性を変える（value が null なら外す。clear で戻す） */
      attr(el, name, value) {
        const saved = JSON.parse(el.getAttribute('data-v38-attrs') ?? '{}')
        if (!(name in saved)) saved[name] = el.getAttribute(name)
        el.setAttribute('data-v38-attrs', JSON.stringify(saved))
        if (value === null) el.removeAttribute(name)
        else el.setAttribute(name, value)
      },
      /** 案の部品を全部外し、本物を元に戻す */
      clear() {
        document.querySelectorAll('.v38-x').forEach((e) => e.remove())
        document.querySelectorAll('[data-v38-hidden]').forEach((e) => e.removeAttribute('data-v38-hidden'))
        document.querySelectorAll('[data-v38-class]').forEach((e) => {
          e.className = e.getAttribute('data-v38-class')
          e.removeAttribute('data-v38-class')
        })
        document.querySelectorAll('[data-v38-label]').forEach((e) => {
          lastText(e).nodeValue = e.getAttribute('data-v38-label')
          e.removeAttribute('data-v38-label')
        })
        document.querySelectorAll('[data-v38-attrs]').forEach((e) => {
          for (const [name, value] of Object.entries(JSON.parse(e.getAttribute('data-v38-attrs')))) {
            if (value === null) e.removeAttribute(name)
            else e.setAttribute(name, value)
          }
          e.removeAttribute('data-v38-attrs')
        })
      },
    }
  }, CSS)
}

/** 確かめ：横にはみ出していないか・案の部品が画面の外に出ていないか・文字がボタンからはみ出していないか */
const audit = (page, name) =>
  page
    .evaluate(() => {
      const bad = []
      if (document.documentElement.scrollWidth > innerWidth + 1) bad.push(`横にはみ出している（${document.documentElement.scrollWidth}px）`)
      for (const el of document.querySelectorAll('.v38-x')) {
        const r = el.getBoundingClientRect()
        if (!r.width) continue
        if (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1 || r.top < -1) bad.push(`画面の外：${el.className}`)
      }
      // 「戻す」の知らせのボタンは、押せる範囲を ::after で広げているので数えない
      for (const el of document.querySelectorAll('.tb, .lay, .zoom button, .sel-bar button, .photo-menu button, .v38-x button:not(.undo-toast button), .v38-addrow')) {
        if (el.offsetWidth && el.scrollWidth > el.clientWidth + 1) bad.push(`文字がはみ出す：${el.textContent}`)
      }
      return bad
    })
    .then((bad) => bad.length && console.log(`  ！${name}：${bad.join(' ／ ')}`))

/** 撮る。clip：写す範囲（画面の座標。ページの中で求める関数か式の文字列でもよい。なければ画面全体） */
async function shot(page, name, clip) {
  await page.evaluate(() => document.fonts.ready)
  await sleep(300)
  await audit(page, name)
  const box = typeof clip === 'function' || typeof clip === 'string' ? await page.evaluate(clip) : clip
  // captureBeyondViewport: false：写すときに画面の大きさを変えない
  await page.screenshot({ path: `${OUT}/${name}.png`, captureBeyondViewport: false, ...(box ? { clip: box } : {}) })
  console.log('✓', name)
}

/** 画面の外（何もない所）にマウスを置く（ボタンの上に乗ったままにしない） */
const parkMouse = (page) => page.mouse.move(5, 5)

/** 開発サーバーの即時反映をつながない（撮っている途中に src/ が直されても、画面が入れ替わらないように。scripts/e2e/smoke.mjs の noHotReload と同じ） */
const noHotReload = () => {
  const Real = window.WebSocket
  window.WebSocket = function (url, protocols) {
    if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
    return new Real(url, protocols)
  }
}

// =====================================================================
// ① 学生用ツール
// =====================================================================

const ready = (page) =>
  page.waitForFunction(() => {
    const s = window.__editor?.getSnapshot()
    return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading')
  }, { timeout: 120000 })

/** 学生用ツールを開き、見本の原稿（指摘0件）と作品写真の見本を入れる */
async function openSample(browser, vp) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  // 本物の確かめの窓が出たら、必ず「キャンセル」
  page.on('dialog', (d) => d.dismiss())
  await page.evaluateOnNewDocument(noHotReload)
  // 指差し確認は見たことにする
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  })
  await stubConfig(page)
  if (vp.isMobile) await page.setUserAgent(UA_IPHONE)
  await page.setViewport(vp)
  // 開発サーバーが一時的にエラーを出していたら（ほかの人が src/ を直している途中）、少し待って開き直す
  for (let i = 0; ; i++) {
    try {
      await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0', timeout: 90000 })
      await ready(page)
      await page.waitForSelector('.guide.step-course .g-opts button', { timeout: 60000 })
      break
    } catch (e) {
      if (i >= 3) throw e
      console.log('  …開き直します：', e.message)
      await sleep(8000)
    }
  }
  // はじめての案内は、コースを選び、Word は「いいえ」、あとで
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
  // 作品写真の見本：見本の写真（photo-1.jpg。全身の正面。g-photo1 は見本の原稿にあるもの）を切り抜いて、後ろ（左右反転）・上半身・帯・袖の刺繍・裾にする
  await page.evaluate(async () => {
    const { importImage } = await import('/src/model/images.ts')
    const base = await new Promise((resolve) => {
      const im = new Image()
      im.onload = () => resolve(im)
      im.src = '/docs/guide-images/sample/photo-1.jpg'
    })
    const crop = async (id, sx, sy, sw, sh, flip = false) => {
      const c = document.createElement('canvas')
      c.width = sw
      c.height = sh
      const g = c.getContext('2d')
      if (flip) {
        g.translate(sw, 0)
        g.scale(-1, 1)
      }
      g.drawImage(base, sx, sy, sw, sh, 0, 0, sw, sh)
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
      return importImage(blob, id, 1200)
    }
    window.__editor.addImages([
      await crop('w-back', 40, 30, 820, 1120, true),
      await crop('w-up', 150, 60, 600, 640),
      await crop('w-sash', 380, 260, 240, 480),
      await crop('w-sleeve', 480, 300, 420, 300),
      await crop('w-hem', 220, 760, 480, 300),
    ])
  })
  await installKit(page)
  return { context, page }
}

/** 作品写真のページの見本（本物の原稿の workPhotos。ツールは1ページなので、ページごとに入れ替えて写す） */
const SHOW = {
  /** いま：1ページに6枚（2列×3段） */
  now6: { layout: 6, columns: 2, imageIds: ['g-photo1', 'w-back', 'w-up', 'w-sash', 'w-sleeve', 'w-hem'] },
  /** 1ページ目：4枚（全身の正面・後ろ・上半身・帯） */
  p1: { layout: 4, columns: 2, imageIds: ['g-photo1', 'w-back', 'w-up', 'w-sash'] },
  /** 2ページ目：2枚（上下。袖の刺繍・裾） */
  p2: { layout: 2, columns: 1, imageIds: ['w-sleeve', 'w-hem'] },
  /** 空の4枚（案C：自動で足したページ） */
  empty4: { layout: 4, columns: 2, imageIds: [] },
}

/** 作品写真を入れ替えて、作品写真のページを出す */
async function setPhotos(page, workPhotos) {
  await page.evaluate((wp) => window.__editor.update((r) => ({ ...r, workPhotos: wp })), workPhotos)
  await sleep(500)
  await ready(page)
  await page.evaluate(() => window.__editor.goToPage(window.__editor.getSnapshot().layout.kinds.indexOf('photos'), 'none'))
  await ready(page)
  await sleep(700)
}

/** いまのページの一覧の、作品写真のページの絵を写し取っておく（あとで、作品写真が2ページあるように並べる） */
const keepThumb = (page, name) =>
  page.evaluate((name) => {
    const ts = document.querySelectorAll('.thumb-list .t')
    const c = ts[ts.length - 1].cloneNode(true)
    c.classList.remove('on')
    c.removeAttribute('aria-current')
    ;(window.__v38keep ??= {})[name] = c
  }, name)

/**
 * 作品写真が2ページあるように見せる（どの案でも同じ）：ページの一覧に、写し取っておいた絵を本物の前（before）か後ろ（after）に足し、
 * 名前を「作品写真 1」「作品写真 2」にする。番号は「10」ページまで。左の道具の上の名前も「作品写真 n」。並べ方は4つ（6枚をなくす）
 */
async function twoPages(page, { before, after, current, emptySecond = false }) {
  await page.evaluate(
    ({ before, after, current, emptySecond }) => {
      /** 空のページ（案C：自動で足したページ）の印 */
      const markEmpty = (t) => {
        k.cls(t, ['v38-empty'])
        t.querySelector('.mini').insertAdjacentHTML('afterend', '<span class="v38-x v38-emptytag">空のページ</span>')
      }
      const k = window.__v38
      const list = document.querySelector('.thumb-list')
      const ts = list.querySelectorAll('.t')
      const real = ts[ts.length - 1]
      const add = (name) => {
        const c = window.__v38keep[name].cloneNode(true)
        c.classList.add('v38-x')
        c.classList.remove('has-error')
        return c
      }
      // 空のページ（作品写真がまだ）の赤い点は出さない（作品写真は、ほかのページに入っている）
      k.cls(real, [], ['has-error'])
      if (before) {
        const c = add(before)
        real.before(c)
        k.label(c, '作品写真 1')
        k.label(real, '作品写真 2')
        if (emptySecond) markEmpty(real)
      } else {
        const c = add(after)
        real.after(c)
        k.label(real, '作品写真 1')
        k.label(c, '作品写真 2')
        if (emptySecond) markEmpty(c)
      }
      list.scrollTop = list.scrollHeight
      const pc = document.querySelector('.thumbs-col .pcount')
      if (pc) k.swap(pc, `<span class="v38-x pcount"><b>${current === 1 ? 9 : 10}</b> / 10</span>`)
      const head = document.querySelector('.palette .p-head b')
      if (head) {
        k.label(head, `作品写真 ${current}`)
        k.cls(head, ['v38-head'])
      }
      // 並べ方：6枚の2つをなくす
      document.querySelectorAll('.lay').forEach((b) => b.textContent.includes('6枚') && k.hide(b))
    },
    { before, after, current, emptySecond },
  )
}

/** セルフチェックの「まだのところ」の、作品写真の行の右の字（todo：まだの形（灰色の ○）にする） */
const photoRow = (page, value, todo = false) =>
  page.evaluate(
    ({ value, todo }) => {
      const k = window.__v38
      for (const li of document.querySelectorAll('.side li, .sheet li')) {
        if (li.querySelector('.l')?.textContent.trim() !== '作品写真') continue
        k.swap(li.querySelector('.v'), `<span class="v38-x v">${value}</span>`)
        if (todo) {
          k.cls(li, ['todo'], ['done'])
          k.swap(li.querySelector('i'), '<i class="v38-x" aria-hidden="true"></i>')
        }
      }
    },
    { value, todo },
  )

/** 写す範囲：画面の左の下（ページの一覧の作品写真と、左の道具の下の部分）。top：上の端 */
const LEFT = (top, height = 768 - top) => `(() => {
  const p = document.querySelector('.palette').getBoundingClientRect()
  return { x: 0, y: ${top}, width: Math.round(p.right + 14), height: ${height} }
})()`
/** 写す範囲：左の道具と紙面の下（案B の点線の枠） */
const ZOOM_B = () => {
  const p = document.querySelector('.palette').getBoundingClientRect()
  return { x: p.left - 12, y: 300, width: 590, height: 468 }
}
/** 写す範囲：左の道具だけ */
const PALETTE = () => {
  const p = document.querySelector('.palette').getBoundingClientRect()
  return { x: p.left - 14, y: Math.max(0, p.top - 12), width: p.width + 28, height: p.height + 24 }
}
/** 写す範囲：右の欄の「まだのところ」 */
const PROGRESS = () => {
  const side = document.querySelector('.side').getBoundingClientRect()
  const li = [...document.querySelectorAll('.side li')].find((x) => x.querySelector('.l')?.textContent.trim() === '作品写真')
  const ul = li.closest('ul, ol').getBoundingClientRect()
  const sub = document.querySelector('.side .check-sub').getBoundingClientRect()
  return { x: side.left, y: Math.max(0, sub.top - 12), width: side.width, height: ul.bottom - sub.top + 26 }
}

/** 案A：左の道具に「ページ」の欄（＋ 写真のページを足す・このページを消す） */
const drawA = (page) =>
  page.evaluate((IC) => {
    const k = window.__v38
    const ctx = document.querySelector('.palette .group.ctx:has(.layouts)')
    k.after(
      ctx,
      `<div class="v38-x group ctx v38-pages"><div class="ctx-label">ページ</div><button class="tb v38-add" title="作品写真のページを1つ足す（3ページまで）">${IC.pageAdd}<span>写真の<br>ページを足す</span></button><button class="tb danger" title="このページを、中の写真ごと消す（消したあと「戻す」で戻せます）">${IC.remove}<span>この<br>ページを消す</span></button></div>`,
    )
  }, IC)

/** 案B：左の道具には「このページを消す」だけ。紙面を少し小さくして、下に点線の「＋ 写真のページを足す」 */
const drawB = (page) =>
  page.evaluate((IC) => {
    const k = window.__v38
    const ctx = document.querySelector('.palette .group.ctx:has(.layouts)')
    k.after(ctx, `<div class="v38-x group ctx v38-pages"><div class="ctx-label">このページ</div><button class="tb danger">${IC.remove}<span>ページを消す</span></button></div>`)
    k.cls(document.querySelector('.stage'), ['v38-shrink'])
  }, IC)
const drawBRow = (page) =>
  page.evaluate((IC) => {
    const k = window.__v38
    const ed = window.__editor
    const r = ed.pageElements()[ed.getSnapshot().page].getBoundingClientRect()
    // 「＋ ここに続きを書く」と同じく、本文の幅（左の余白 35mm・右の余白 25mm の内側）
    const left = r.left + r.width * (132.3 / 793.7)
    const width = r.width * (566.9 / 793.7)
    k.add(`<button class="v38-x v38-addrow" style="left:${left}px;top:${r.bottom + 12}px;width:${width}px">${IC.plus}写真のページを足す</button>`)
  }, IC)

/** 知らせ（本物の「戻す」の知らせの形。紙面の下の真ん中） */
const toast = (page, html, button) =>
  page.evaluate(
    ({ html, button }) => {
      const area = document.querySelector('.stage .undo-area')
      area.insertAdjacentHTML('beforeend', `<div class="v38-x undo-toast"><span class="v38-tt">${html}</span><button>${button}</button><span class="undo-timer" aria-hidden="true"><span></span></span></div>`)
    },
    { html, button },
  )

async function toolShots(browser) {
  const { context, page } = await openSample(browser, PC)
  // ページの一覧の絵を写し取る：空の4枚のページ・1ページ目（4枚）
  await setPhotos(page, SHOW.empty4)
  await keepThumb(page, 'empty')
  await setPhotos(page, SHOW.p1)
  await keepThumb(page, 'p1')

  // ---- いま：1ページに6枚（2列×3段） ----
  await setPhotos(page, SHOW.now6)
  await parkMouse(page)
  await shot(page, 'now-pc')
  await shot(page, 'now-pc-zoom', LEFT(84, 468))
  await shot(page, 'lay-pc-now', PALETTE)

  // ---- 案A：2ページ目（2枚・上下）を開いたところ ----
  await setPhotos(page, SHOW.p2)
  await twoPages(page, { before: 'p1', current: 2 })
  await drawA(page)
  await photoRow(page, '6枚（2ページ）')
  await parkMouse(page)
  await shot(page, 'a-pc')
  await shot(page, 'a-pc-zoom', LEFT(316))
  await shot(page, 'lay-pc-a', PALETTE)
  await shot(page, 'a-pc-check', PROGRESS)
  // 足したページに、まだ写真がないとき
  await page.evaluate(() => window.__v38.clear())
  await photoRow(page, '2ページ目に写真がまだ', true)
  await shot(page, 'a-pc-check-todo', PROGRESS)
  await page.evaluate(() => window.__v38.clear())

  // ---- 案B：2ページ目（最後のページ）の下に点線の枠 ----
  await twoPages(page, { before: 'p1', current: 2 })
  await drawB(page)
  await photoRow(page, '6枚（2ページ）')
  await sleep(300)
  await drawBRow(page)
  await parkMouse(page)
  await shot(page, 'b-pc')
  await shot(page, 'b-pc-zoom', ZOOM_B)
  await page.evaluate(() => window.__v38.clear())

  // ---- 案C ①：1ページ目の4つの枠がうまり、空の2ページ目が自動でできたところ ----
  await setPhotos(page, SHOW.p1)
  await twoPages(page, { after: 'empty', current: 1, emptySecond: true })
  await photoRow(page, '4枚')
  await page.evaluate(() => window.__v38.attr(document.querySelector('.stage .arrow.next'), 'disabled', null))
  await toast(page, '作品写真 2 のページを足しました<small>写真を入れなければ、PDF には入りません</small>', `見る${IC.next}`)
  await parkMouse(page)
  await shot(page, 'c-pc-1')
  await shot(page, 'c-pc-1-zoom', { x: 0, y: 560, width: 770, height: 208 })
  await page.evaluate(() => window.__v38.clear())

  // ---- 案C ②：自動でできた2ページ目（空）を開いたところ ----
  await setPhotos(page, SHOW.empty4)
  await twoPages(page, { before: 'p1', current: 2, emptySecond: true })
  await page.evaluate(() => {
    const k = window.__v38
    // 空のページはチェックに数えない（作品写真は1ページ目の4枚で、済んでいる）
    for (const li of document.querySelectorAll('.side li')) {
      if (li.querySelector('.l')?.textContent.trim() !== '作品写真') continue
      const done = [...document.querySelectorAll('.side li.done')].find((x) => x !== li)
      k.cls(li, ['done'], ['todo'])
      k.swap(li.querySelector('i'), `<i class="v38-x" aria-hidden="true">${done?.querySelector('i')?.innerHTML ?? ''}</i>`)
      k.swap(li.querySelector('.v'), '<span class="v38-x v">4枚</span>')
    }
    const foot = document.querySelector('.side .export-note')
    if (foot) k.swap(foot, '<p class="v38-x export-note">直すところ・まだのところはありません</p>')
    // 「まだのところ」の横の数（まだ 0）
    const sub = document.querySelector('.side .check-sub')
    if (sub) [...sub.children].filter((e) => e.tagName !== 'B').forEach((e) => k.hide(e))
    // 並べ方の下の説明
    const note = document.querySelector('.palette .ctx-note')
    if (note) k.swap(note, '<div class="v38-x ctx-note v38-cnote">写真を全部<br>外すと、<br>このページも<br>消えます</div>')
    // 紙面の上の札
    const ed = window.__editor
    const r = ed.pageElements()[ed.getSnapshot().page].getBoundingClientRect()
    k.add(`<div class="v38-x v38-pill" style="left:${r.left + r.width / 2}px;top:${r.top + 14}px">自動で足したページ<small>写真を入れなければ、PDF には入りません</small></div>`)
  })
  // 本物の空の作品写真のページは「まだのところ」に出ているので、ほかの行（済み）と同じ形にしたうえで写す
  await parkMouse(page)
  await shot(page, 'c-pc-2')
  await shot(page, 'c-pc-2-zoom', { x: 0, y: 0, width: 770, height: 330 })
  await page.evaluate(() => window.__v38.clear())

  // ---- 案A：「このページを消す」を押したあと（1ページに戻り、「戻す」の知らせ） ----
  await setPhotos(page, SHOW.p1)
  await page.evaluate(() => document.querySelectorAll('.lay').forEach((b) => b.textContent.includes('6枚') && window.__v38.hide(b)))
  await drawA(page)
  // 1ページだけのときは「このページを消す」は押せない
  await page.evaluate(() => {
    const del = document.querySelector('.v38-pages .tb.danger')
    del.disabled = true
    del.style.opacity = '0.35'
  })
  await toast(page, '作品写真 2 のページを消しました<small>写真2枚も外しました</small>', `${IC.undo}戻す`)
  await parkMouse(page)
  await shot(page, 'a-pc-del')
  await shot(page, 'a-pc-del-zoom', () => {
    const s = document.querySelector('.stage').getBoundingClientRect()
    return { x: s.left, y: innerHeight - 450, width: s.width, height: 450 }
  })
  await page.evaluate(() => window.__v38.clear())
  await context.close()
}

/** 写す範囲：スマホの下の道具（並べ方） */
const PHONE_BAR = () => {
  const r = document.querySelector('.sel-bar .group').getBoundingClientRect()
  return { x: 0, y: r.top - 10, width: innerWidth, height: r.height + 20 }
}

async function phoneShots(browser) {
  const { context, page } = await openSample(browser, PHONE)
  // ---- いま：1ページに6枚 ----
  await setPhotos(page, SHOW.now6)
  await shot(page, 'now-ph')
  await shot(page, 'now-ph-bar', PHONE_BAR)
  // ---- 案A：2ページ目（2枚・上下）。並べ方（4つ）の横に「ページを足す」「ページを消す」 ----
  await setPhotos(page, SHOW.p2)
  await page.evaluate((IC) => {
    const k = window.__v38
    document.querySelectorAll('.sel-bar .lay').forEach((b) => b.textContent.includes('6枚') && k.hide(b))
    const layouts = document.querySelector('.sel-bar .layouts')
    k.after(
      layouts,
      `<span class="v38-x v38-sep"></span><button class="v38-x tb v38-pg v38-add">${IC.pageAdd}<span>ページを<br>足す</span></button><button class="v38-x tb v38-pg danger">${IC.remove}<span>ページを<br>消す</span></button>`,
    )
    const lbl = document.querySelector('.pager .lbl')
    if (lbl) k.swap(lbl, '<span class="v38-x lbl">作品写真 2　<b>10</b> / 10</span>')
    const sub = document.querySelector('.p-title .sub')
    if (sub) k.label(sub, '作品写真 2')
  }, IC)
  await sleep(300)
  await shot(page, 'a-ph')
  await shot(page, 'a-ph-bar', PHONE_BAR)
  // 「チェック」の欄の「まだのところ」
  await page.evaluate(() => document.querySelector('.nav-check').click())
  await page.waitForSelector('.sheet .sheet-body', { timeout: 30000 })
  await page.evaluate(() => document.activeElement?.blur())
  await sleep(600)
  await photoRow(page, '6枚（2ページ）')
  await shot(page, 'a-ph-check')
  await context.close()
}

// =====================================================================
// ② 提出前チェック（check.html）
// =====================================================================

const FIX = 'scripts/e2e/fixtures'
const now = Date.now()
const b64 = (path) => readFileSync(path).toString('base64')
/** 見本の Word・PDF（Word は PDF より古い：作り直した PDF を入れた、ふつうの状態） */
const FILES = ['cover', 'abstract', 'toc', 'body'].flatMap((n, i) => [
  { name: `0${i + 1}_${['表紙', '抄録', '目次', '本文'][i]}.pdf`, b64: b64(`${FIX}/word-sample-${n}.pdf`), lastModified: now - 3_600_000, type: 'application/pdf' },
  { name: `0${i + 1}_${['表紙', '抄録', '目次', '本文'][i]}.docx`, b64: b64(`${FIX}/word-sample-${n}.docx`), lastModified: now - 7_200_000, type: '' },
])
const drop = (page, files) =>
  page.evaluate((files) => {
    const dt = new DataTransfer()
    for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { lastModified: f.lastModified, type: f.type }))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, files)
const settled = (page, count) =>
  page.waitForFunction((count) => document.querySelector('main')?.dataset.busy === 'false' && document.querySelectorAll('.pf .fname').length >= count && !document.querySelector('.pg-wait'), { timeout: 180000, polling: 200 }, count)

/**
 * 写真の見本を作って入れる（photo-1.jpg を切り抜く：全身の正面・後ろ（左右反転）・帯・上半身・袖の刺繍（横長）。あとで足す2枚も作っておく）。
 * 作ったファイルは window.__v38files に取っておく（ページの絵を作るのに使う）
 */
const dropPhotos = (page, from, to) =>
  page.evaluate(
    async ({ from, to }) => {
      if (!window.__v38files) {
        const base = await new Promise((resolve) => {
          const im = new Image()
          im.onload = () => resolve(im)
          im.src = '/docs/guide-images/sample/photo-1.jpg'
        })
        const crop = async (name, sx, sy, sw, sh, flip = false) => {
          const c = document.createElement('canvas')
          c.width = sw
          c.height = sh
          const g = c.getContext('2d')
          if (flip) {
            g.translate(sw, 0)
            g.scale(-1, 1)
          }
          g.drawImage(base, sx, sy, sw, sh, 0, 0, sw, sh)
          const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
          return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() })
        }
        window.__v38files = [
          await crop('IMG_2041.jpg', 0, 0, 900, 1200),
          await crop('IMG_2042.jpg', 40, 30, 820, 1120, true),
          await crop('IMG_2047.jpg', 380, 260, 240, 480),
          await crop('IMG_2052.jpg', 150, 60, 600, 640),
          await crop('IMG_2043.jpg', 480, 300, 420, 300),
          await crop('IMG_2050.jpg', 220, 760, 480, 300),
          await crop('IMG_2058.jpg', 300, 420, 300, 300),
        ]
      }
      const dt = new DataTransfer()
      for (const f of window.__v38files.slice(from, to)) dt.items.add(f)
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    },
    { from, to },
  )

async function openCheck(browser) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  await page.evaluateOnNewDocument(noHotReload)
  await page.setViewport(PC)
  for (let i = 0; ; i++) {
    try {
      await page.goto(`${APP}/check.html`, { waitUntil: 'networkidle0', timeout: 90000 })
      await page.waitForSelector('main', { timeout: 60000 })
      break
    } catch (e) {
      if (i >= 3) throw e
      console.log('  …開き直します：', e.message)
      await sleep(8000)
    }
  }
  await drop(page, FILES)
  await settled(page, 8)
  // 写真5枚
  await dropPhotos(page, 0, 5)
  await settled(page, 9)
  await page.waitForFunction(() => document.querySelector('section[aria-label="作品写真"] .pf.photos')?.textContent.includes('5枚'), { timeout: 60000 })
  await sleep(800)
  await installKit(page)
  return { context, page }
}

/** 写す範囲：「並べ替え・外す」の窓のまわり */
const MENU = () => {
  const r = document.querySelector('.photo-menu').getBoundingClientRect()
  const sec = document.querySelector('section[aria-label="作品写真"]').getBoundingClientRect()
  const left = Math.max(0, Math.min(r.left, sec.left) - 16)
  const right = Math.min(innerWidth, Math.max(r.right, sec.right) + 16)
  return { x: left, y: Math.max(0, sec.top - 12), width: right - left, height: Math.min(innerHeight, r.bottom + 14) - Math.max(0, sec.top - 12) }
}
/** 写す範囲：ページの絵の並び（本文〜作品写真） */
const ROW = () => {
  const sec = document.querySelector('section[aria-label="作品写真"]').getBoundingClientRect()
  const body = document.querySelector('section[aria-label="本文"]').getBoundingClientRect()
  return { x: body.left - 14, y: sec.top - 12, width: sec.right - body.left + 28, height: sec.height + 24 }
}

/**
 * 写真を2ページに分けて見せる（split：1ページ目の枚数）。ページの絵は本物の photoPageImage（src/check/photo.ts）で、ページごとに作る。
 * 欄の字：「写真 5枚・2ページ」「（1ページ4枚まで）」。ページの絵の幅は、8ページが1段に収まる大きさ
 */
const splitPhotos = (page, split) =>
  page.evaluate((split) => {
    const k = window.__v38
    const sec = document.querySelector('section[aria-label="作品写真"]')
    const imgs = window.__v38pages[split]
    k.swap(sec.querySelector('.pf.photos .fname'), '<button type="button" class="v38-x fname">写真 5枚・2ページ</button>')
    k.swap(sec.querySelector('.pf-sub'), '<span class="v38-x pf-sub">（1ページ4枚まで）</span>')
    k.attr(sec, 'style', '--n: 2;')
    const fig = sec.querySelector('.g-pages figure')
    k.attr(fig.querySelector('img'), 'src', imgs[0])
    const second = fig.cloneNode(true)
    second.classList.add('v38-x')
    second.querySelector('img').src = imgs[1]
    second.setAttribute('data-page', 'photo:2')
    fig.after(second)
    k.label(second, '8')
    // ページの絵の幅：8ページ（パートは5つ）が1段に収まるように
    const doc = document.querySelector('.c2-doc')
    const cs = getComputedStyle(doc)
    const g = parseFloat(cs.getPropertyValue('--g'))
    const gg = parseFloat(cs.getPropertyValue('--gg'))
    const secs = [...doc.querySelectorAll('section.grp')]
    const pages = secs.reduce((n, s) => n + s.querySelectorAll('.g-pages figure').length, 0)
    const inner = secs.reduce((n, s) => n + s.querySelectorAll('.g-pages figure').length - 1, 0)
    const tw = Math.min(parseFloat(cs.getPropertyValue('--tw')), Math.floor((doc.clientWidth - inner * g - (secs.length - 1) * gg) / pages))
    k.attr(doc, 'style', `--tw: ${tw}px;`)
    // 下の帯の「7ページ」
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.nodeValue.trim() === '7ページ' && !n.parentElement.closest('.c2-doc')) k.label(n.parentElement, n.nodeValue.replace('7', '8'))
    }
  }, split)

/** 「並べ替え・外す」の窓を開き、ページの区切り（split：1ページ目の枚数）と言葉を書き換える */
const splitMenu = async (page, split) => {
  await page.evaluate(() => document.querySelector('section[aria-label="作品写真"] .pf-link').click())
  await page.waitForSelector('.photo-menu', { timeout: 10000 })
  await page.evaluate(() => document.activeElement?.blur())
  await page.evaluate((split) => {
    const k = window.__v38
    const m = document.querySelector('.photo-menu')
    k.swap(m.querySelector('.popover-title'), '<div class="v38-x popover-title"><b>作品写真</b>5枚・2ページ（1ページに4枚まで）</div>')
    const lis = m.querySelectorAll('ol > li')
    k.after(lis[0], `<li class="v38-x v38-pgh">1ページ目<span>${split}枚</span></li>`, true)
    k.after(lis[split], `<li class="v38-x v38-pgh">2ページ目<span>${5 - split}枚</span></li>`, true)
    k.swap(m.querySelector('.pm-hint'), `<p class="v38-x pm-hint">${split === 4 ? '4枚ずつ、この順にページに並べます。写真は切らずに入れます。' : '枚数がそろうように、2ページに分けて並べます。写真は切らずに入れます。'}</p>`)
  }, split)
  await sleep(300)
}
const closeMenu = async (page) => {
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('.photo-menu'), { timeout: 10000 })
}

/** まとめた PDF の作品写真のページを、大きく並べて見せる（names：ページの下の字） */
const bigPages = (page, key, names) =>
  page.evaluate(
    ({ key, names }) => {
      window.__v38.add(`<div class="v38-x v38-a4">${window.__v38big[key].map((src, i) => `<figure><img src="${src}">${names[i]}</figure>`).join('')}</div>`)
    },
    { key, names },
  )
const A4 = () => {
  const r = document.querySelector('.v38-a4').getBoundingClientRect()
  return { x: r.left, y: r.top, width: r.width, height: r.height }
}

async function checkShots(browser) {
  const { context, page } = await openCheck(browser)
  // ---- いま：5枚を1ページに（2列×3段） ----
  await parkMouse(page)
  await shot(page, 'chk-now')
  await shot(page, 'chk-now-row', ROW)
  await page.evaluate(() => document.querySelector('section[aria-label="作品写真"] .pf-link').click())
  await page.waitForSelector('.photo-menu', { timeout: 10000 })
  await page.evaluate(() => document.activeElement?.blur())
  await sleep(300)
  await shot(page, 'chk-now-menu', MENU)
  await closeMenu(page)

  // ページの絵（本物の photoPageImage。ページの一覧の小さな絵と、大きく見せる絵）
  await page.evaluate(async () => {
    const { preparePhoto, photoPageImage } = await import('/src/check/photo.ts')
    const ps = []
    for (const f of window.__v38files.slice(0, 5)) ps.push(await preparePhoto(f))
    const make = (w) => ({ now: [photoPageImage(ps, w)], 4: [photoPageImage(ps.slice(0, 4), w), photoPageImage(ps.slice(4), w)], 3: [photoPageImage(ps.slice(0, 3), w), photoPageImage(ps.slice(3), w)] })
    window.__v38pages = make(300)
    window.__v38big = make(500)
  })

  // ---- 案：4枚＋1枚 ／ 3枚＋2枚 ----
  for (const split of [4, 3]) {
    const tag = split === 4 ? '41' : '32'
    await splitPhotos(page, split)
    await parkMouse(page)
    await shot(page, `chk-${tag}`)
    await shot(page, `chk-${tag}-row`, ROW)
    await splitMenu(page, split)
    await shot(page, `chk-${tag}-menu`, MENU)
    await closeMenu(page)
    await bigPages(page, split, ['7ページ（作品写真 1）', '8ページ（作品写真 2）'])
    await shot(page, `chk-${tag}-pages`, A4)
    await page.evaluate(() => window.__v38.clear())
  }
  await bigPages(page, 'now', ['7ページ（作品写真）'])
  await shot(page, 'chk-now-pages', A4)
  await page.evaluate(() => window.__v38.clear())

  // ---- 入れすぎたとき（本物は6枚まで：2枚足すと、7枚目で知らせが出る）。言葉を案のものにする ----
  await dropPhotos(page, 5, 7)
  await page.waitForSelector('.add-notes li', { timeout: 60000 })
  await sleep(600)
  await page.evaluate(() => {
    const k = window.__v38
    // 知らせの文字（React の文字の部品の中身だけを書き換える）
    const walker = document.createTreeWalker(document.querySelector('.add-notes'), NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (/作品写真は\d+枚までです/.test(n.nodeValue)) k.label(n.parentElement, n.nodeValue.replace(/作品写真は\d+枚までです。/, '作品写真は12枚（3ページ）までです。'))
    }
  })
  await shot(page, 'chk-notice', () => {
    const r = document.querySelector('.add-notes').getBoundingClientRect()
    return { x: r.left - 12, y: r.top - 10, width: r.width + 24, height: r.height + 20 }
  })
  await context.close()
}

// =====================================================================
// 一覧のページ（mockups/v38/review.html）を画像にする（shots/review-photos-tool.png・review-photos-tool-a.png・review-photos-check.png）
// =====================================================================
async function reviewShots(browser) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1300, height: 900, deviceScaleFactor: 1 })
  await page.goto(`${APP}/${DIR}/review.html`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  for (const id of ['tool', 'tool-a', 'check']) {
    const el = await page.$(`#${id}`)
    if (!el) continue
    await el.screenshot({ path: `${OUT}/review-photos-${id}.png` })
    console.log('✓', `review-photos-${id}`)
  }
  await page.close()
}

await withEdge(async (browser) => {
  if (want('tool')) await toolShots(browser)
  if (want('phone')) await phoneShots(browser)
  if (want('check')) await checkShots(browser)
  if (want('review')) await reviewShots(browser)
})
