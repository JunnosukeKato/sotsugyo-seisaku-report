// デザイン案 v44（下書きのひな形を、書くときと同じ画面で作る）を画像に書き出す。
// 依頼者（先生）の声：「ひな形の作り方がとても分かりにくい。実際に書く時と同じように書くことは出来ないですか？」
// 本物の画面を開き、案の部分だけ CSS と部品を書き足して写す（src/ は変えない）。
//   now  ：いまのひな形の窓（管理ページ。コースのカードの「編集する」から開く）。分かりにくいところに番号を付けた絵も
//   a    ：案A ひな形を作る画面を、学生のツールで開く（学生用ツールを「ひな形を作る」ようすに書き足す）
//          管理ページのカード → ひな形の画面 → 「ここに書くこと」を書く → 学生の見え方（本物の学生の画面）→ 図・表 → 抄録の書き出し例 → 管理ページに戻ったあと
//   b    ：案B 管理ページの中に、紙面に似た画面（いまのひな形の窓の中身を、紙面に似たものに入れ替える）
//   review：一覧のページ mockups/v44/review.html を1枚の画像にする（shots/review-template.png）
// 学生用ツールは、Google のログインとドライブを偽物（scripts/e2e/fakeGoogle.mjs）に差し替えて開く。管理ページは、ブラウザの中だけで動く試験用サーバー。
// 本物の Google にはつながない。試験用サーバーの中身（localStorage）は、撮影用の Edge の中だけで作り直す。
// 見本のコースは「映画・舞台衣装デザイナー」（src/config/2026.json のひな形：大見出し3・小見出し3・説明5・図の枠1・素材表1）。
// 使い方: node scripts/mockup-shots-v44.mjs [now] [a] [b] [review]（何も付けなければ全部。開発サーバーが http://localhost:5173 で動いていること）
//   Edge は EDGE_PORT（ふだんは 9741）で起動する。開発サーバーを別に立てたときは APP_URL で指す
import { mkdirSync, readFileSync } from 'node:fs'

process.env.EDGE_PORT ??= '9741'
const { withEdge } = await import('./poc/edge.mjs')
const { fakeDrive, routeGoogle } = await import('./e2e/fakeGoogle.mjs')
const { ready } = await import('./video/session.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const DIR = 'mockups/v44'
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })
const ONLY = process.argv.slice(2)
const want = (k) => ONLY.length === 0 || ONLY.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** ノートパソコンの画面（近くで見る絵のため、1.5倍の細かさで撮る） */
const PC = { width: 1366, height: 768, deviceScaleFactor: 1.5 }

/** 見本のコース（2026年度の初期値のひな形と、抄録の書き出し例） */
const BASE = JSON.parse(readFileSync('src/config/2026.json', 'utf8'))
const FILM = BASE.courses.find((c) => c.id === 'film-stage-costume')
const COURSE_NAME = FILM.name
/** 学生用ツールに渡す年度の設定（自動の確かめと同じもの。1つ目のコースに、2026年度のひな形と書き出し例を入れる） */
function toolConfig(template = FILM.template) {
  const config = JSON.parse(readFileSync('scripts/e2e/config-fixture.json', 'utf8'))
  for (const c of config.courses) delete c.notice
  const film = config.courses.find((c) => c.id === 'film-stage-costume')
  film.template = template
  film.abstractExample = FILM.abstractExample
  return config
}
/** 先生が書き足す「ここに書くこと」（案A の絵で打つ文。いまの「制作過程」の説明を、くわしくしたもの） */
const NEW_HINT = 'パターン・仮縫い・縫製・装飾の順に、それぞれで工夫した点と、うまくいかなかった点を書く'
/** 打っている途中の所まで（打っているところの絵） */
const TYPED = 'パターン・仮縫い・縫製・装飾の順に、それぞれで工夫した点と、'

// ---- アイコン（src/app/icons.tsx と同じ線の太さ） ----
const svg = (d, w = 1.6) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const IC = {
  template: svg('<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8.5 8h7M8.5 11.5h7M8.5 15h4"/>'),
  pen: svg('<path d="M15.5 5.5l3 3L9 18H6v-3z"/><path d="M13.5 7.5l3 3"/>'),
  newTab: svg('<path d="M13.5 4.5h6v6"/><path d="M19.5 4.5l-8 8"/><path d="M17 13.5v5a1.5 1.5 0 01-1.5 1.5h-10A1.5 1.5 0 014 18.5v-10A1.5 1.5 0 015.5 7h5"/>'),
  back: svg('<path d="M10 7l-5 5 5 5"/><path d="M5 12h9.5a4.5 4.5 0 010 9H12"/>'),
  warn: svg('<path d="M12 4l9 16H3zM12 10v4.5M12 17.2v.1"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  lock: svg('<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5"/>'),
  h1: svg('<path d="M5 6.5h2.5M5 11h2.5M5 15.5h2.5"/><path d="M10.5 6.5H19M10.5 11H19M10.5 15.5H16"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  up: svg('<path d="M12 18V6M7 11l5-5 5 5"/>'),
  dn: svg('<path d="M12 6v12M7 13l5 5 5-5"/>'),
  remove: svg('<path d="M5 7h14M10 7V5.5h4V7M7 7l.9 12h8.2L17 7"/>'),
  figure: svg('<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M5 17l4.5-4.5 3 3 2.5-2.5 4 4"/>'),
  table: svg('<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M4 10h16M4 14.5h16M10 5v14"/>'),
  para: svg('<path d="M5 7h14M5 11h14M5 15h9"/>'),
  sub: svg('<path d="M8 7h11M8 12h11M8 17h7"/><path d="M4.5 7h.5M4.5 12h.5M4.5 17h.5"/>'),
  brk: svg('<path d="M6 4v5h12V4M6 20v-5h12v5"/><path d="M4 12h2M9 12h2M13 12h2M18 12h2"/>'),
}
/** マウスの矢印（説明用） */
const CURSOR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2.5v17.2l4.4-4.2 2.9 6.4 2.7-1.2-2.9-6.3h6.1z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>'
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// =====================================================================
// ページの中で使う道具（部品を足す・隠す・印を付ける・1字だけの行を探す）
// =====================================================================
const KIT_CSS = `
  [data-v44-hidden] { display: none !important; }
  .v44-x { box-sizing: border-box; font-family: 'BIZ UDPGothic', sans-serif; word-break: auto-phrase; text-wrap: pretty; }
  .v44-x * { box-sizing: border-box; }
  .v44-x button { font: inherit; cursor: pointer; }
  .v44-x svg { flex: none; }
  /* 説明用の印（番号の丸）。いまの画面の分かりにくいところを指す */
  .v44-pin { position: fixed; z-index: 2000; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%; background: #d4380d; color: #fff; font: 700 16px/30px 'BIZ UDPGothic', sans-serif; text-align: center; box-shadow: 0 0 0 3px #fff, 0 2px 6px rgba(0,0,0,.35); }
  .v44-ring { position: fixed; z-index: 1999; border: 3px solid #d4380d; border-radius: 10px; pointer-events: none; box-shadow: 0 0 0 2px rgba(255,255,255,.8); }
  .v44-cursor { position: fixed; z-index: 2001; width: 22px; height: 22px; pointer-events: none; }
  .v44-cursor svg { display: block; width: 100%; height: 100%; filter: drop-shadow(0 1px 1px rgba(0,0,0,.3)); }
`

async function installKit(page) {
  await page.evaluate(
    (css, cursorSvg) => {
      if (document.getElementById('v44-style')) return
      const style = document.createElement('style')
      style.id = 'v44-style'
      style.textContent = css
      document.head.append(style)
      window.__v44 = {
        add(html, parent = document.body) {
          parent.insertAdjacentHTML('beforeend', html)
          return parent.lastElementChild
        },
        hide(el) {
          el?.setAttribute('data-v44-hidden', '')
        },
        css(text, id) {
          if (id) document.getElementById(id)?.remove()
          const s = document.createElement('style')
          s.className = 'v44-x'
          if (id) s.id = id
          s.textContent = text
          document.head.append(s)
        },
        /** 説明の番号の丸を、部品の上（x・y は部品の幅・高さに対する割合）に置く */
        pin(el, n, fx = 0, fy = 0, ring = false) {
          if (!el) return
          const r = el.getBoundingClientRect()
          if (ring) this.add(`<div class="v44-x v44-ring" style="left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px"></div>`)
          this.add(`<div class="v44-x v44-pin" style="left:${Math.max(16, Math.min(innerWidth - 16, r.left + r.width * fx))}px;top:${Math.max(16, Math.min(innerHeight - 16, r.top + r.height * fy))}px">${n}</div>`)
        },
        cursor(el, fx = 0.6, fy = 0.6) {
          const r = el.getBoundingClientRect()
          this.add(`<div class="v44-x v44-cursor" style="left:${r.left + r.width * fx}px;top:${r.top + r.height * fy}px">${cursorSvg}</div>`)
        },
        /**
         * 1字だけの行を探す（selector の中の、字のある部品ごとに、1字ずつの位置から行を分ける）。
         * 2行以上ある部品で、1字だけの行があれば、その部品の字を返す
         */
        lonely(selector = '.v44-x') {
          const bad = []
          const boxes = new Map()
          const range = document.createRange()
          for (const root of document.querySelectorAll(selector)) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
              if (!n.textContent.trim() || n.parentElement.closest('style, script, option, select, textarea')) continue
              let box = n.parentElement
              while (box && getComputedStyle(box).display === 'inline') box = box.parentElement
              if (!box || !box.getClientRects().length) continue
              if (!boxes.has(box)) boxes.set(box, [])
              const list = boxes.get(box)
              for (let i = 0; i < n.length; i++) {
                if (/\s/.test(n.data[i])) continue
                range.setStart(n, i)
                range.setEnd(n, i + 1)
                const r = range.getBoundingClientRect()
                if (r.height) list.push({ y: (r.top + r.bottom) / 2, h: r.height, ch: n.data[i] })
              }
            }
          }
          for (const [box, list] of boxes) {
            const lines = []
            for (const c of list.sort((a, b) => a.y - b.y)) {
              const line = lines.at(-1)
              if (line && Math.abs(c.y - line.y) < line.h * 0.55) line.chars.push(c.ch)
              else lines.push({ y: c.y, h: c.h, chars: [c.ch] })
            }
            if (lines.length > 1 && lines.some((l) => l.chars.length === 1)) bad.push(`${box.textContent.trim().slice(0, 30)}…（${lines.map((l) => l.chars.join('')).join('／')}）`.slice(0, 160))
          }
          return bad
        },
        clear() {
          document.querySelectorAll('.v44-x:not(style)').forEach((e) => e.remove())
          document.querySelectorAll('[data-v44-hidden]').forEach((e) => e.removeAttribute('data-v44-hidden'))
        },
      }
    },
    KIT_CSS,
    CURSOR_SVG,
  )
}

/** 開発サーバーの即時反映をつながない（撮っている途中に src/ が直されても、画面が入れ替わらないように） */
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

/** 開く（読み込めなかったら、少し待ってやり直す。ほかの人が src/ を直していて、開発サーバーが組み直している間があるため） */
async function goto(page, url, selector) {
  for (let i = 0; i < 5; i++) {
    try {
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 })
      await page.waitForSelector(selector, { timeout: 30000 })
      return
    } catch (e) {
      console.log(`  （開けませんでした。やり直します：${e.message.split('\n')[0]}）`)
      await sleep(3000)
    }
  }
  throw new Error(`${url} を開けませんでした`)
}

const parkMouse = (page) => page.mouse.move(2, 2)

/** 確かめ：横にはみ出していないか・書き足した字に1字だけの行がないか */
const audit = (page, name) =>
  page
    .evaluate(() => {
      const bad = []
      if (document.documentElement.scrollWidth > innerWidth + 1) bad.push(`横にはみ出している（${document.documentElement.scrollWidth}px）`)
      for (const el of document.querySelectorAll('.v44-x button')) if (el.offsetWidth && el.scrollWidth > el.clientWidth + 1) bad.push(`文字がはみ出す：${el.textContent.slice(0, 20)}`)
      for (const t of window.__v44?.lonely() ?? []) bad.push(`1字だけの行：${t}`)
      return bad
    })
    .then((bad) => bad.length && console.log(`  ！${name}：${bad.join(' ／ ')}`))

/** 撮る。clip：写す範囲（関数ならページの中で測る。なければ画面全体） */
async function shot(page, name, clip, { check = true } = {}) {
  await page.evaluate(() => document.fonts.ready)
  await sleep(300)
  if (check) await audit(page, name)
  const box = typeof clip === 'function' ? await page.evaluate(clip) : clip
  await page.screenshot({ path: `${OUT}/${name}.png`, captureBeyondViewport: false, ...(box ? { clip: box } : {}) })
  console.log('✓', name)
}
/** 部品のまわりの範囲（pad だけ広げ、画面の中に収める） */
const around = (sel, pad = 12, extra = {}) =>
  new Function(
    `const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => e.getBoundingClientRect().width > 0)
     const rs = els.map((e) => e.getBoundingClientRect())
     const e = ${JSON.stringify(extra)}
     const l = Math.max(0, Math.min(...rs.map((r) => r.left)) - ${pad} - (e.l ?? 0))
     const t = Math.max(0, Math.min(...rs.map((r) => r.top)) - ${pad} - (e.t ?? 0))
     const r = Math.min(innerWidth, Math.max(...rs.map((r) => r.right)) + ${pad} + (e.r ?? 0))
     const b = Math.min(innerHeight, Math.max(...rs.map((r) => r.bottom)) + ${pad} + (e.b ?? 0))
     return { x: l, y: t, width: r - l, height: b - t }`,
  )

// =====================================================================
// 管理ページ（試験用サーバー）
// =====================================================================
/** 管理ページを開く。試験用サーバーを空にして、2026年度（公開中・初期値）で開き直す */
async function openAdmin(browser, { vp = PC, as = '' } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  page.on('dialog', (d) => d.accept())
  await noHotReload(page)
  await page.setViewport(vp)
  await goto(page, `${APP}/admin.html`, '.admin .form')
  await page.evaluate(() => {
    localStorage.removeItem('sotsugyo-admin-mock')
    localStorage.removeItem('sotsugyo-admin-year')
  })
  await goto(page, `${APP}/admin.html${as ? `?as=${as}` : ''}`, as === 'teacher' ? '.teacher-main' : '.admin .form')
  await previewReady(page)
  await installKit(page)
  await parkMouse(page)
  return { context, page }
}

/** 見本（表紙と抄録の iframe）が出るまで待つ */
async function previewReady(page) {
  for (let i = 0; i < 40; i++) {
    const ok = await page.evaluate(() => {
      const ds = [...document.querySelectorAll('.preview iframe')].map((f) => f.contentDocument)
      return ds.length === 0 || ds.every((d) => d?.readyState === 'complete' && d.querySelectorAll('.page').length === 2)
    })
    if (ok) break
    await sleep(500)
  }
  await sleep(900)
}

/** コースのカードの「編集する」で、ひな形の窓を開く（1つ目のコース） */
async function openTemplateWindow(page) {
  await page.evaluate(() => {
    const row = document.querySelector('.tpl-row')
    row.scrollIntoView({ block: 'center' })
  })
  await sleep(300)
  await page.evaluate(() => document.querySelector('.tpl-row button').click())
  await page.waitForSelector('.tpl-modal')
  // 見本（iframe）の字が出るまで待つ
  for (let i = 0; i < 30; i++) {
    const ok = await page.evaluate(() => {
      const d = document.querySelector('.tpl-preview iframe')?.contentDocument
      return d?.readyState === 'complete' && (d.body?.innerText ?? '').includes('企画')
    })
    if (ok) break
    await sleep(400)
  }
  await page.evaluate(() => document.fonts.ready)
  await sleep(1200)
}

// =====================================================================
// 1. いまのひな形の窓
// =====================================================================
async function nowShots(browser) {
  const { context, page } = await openAdmin(browser)
  // コースのカード（「編集する」の行）
  await page.evaluate(() => document.querySelector('.tpl-row').scrollIntoView({ block: 'center' }))
  await sleep(400)
  await shot(page, 'now-card', around('.form .course', 10), { check: false })
  await openTemplateWindow(page)
  await shot(page, 'now-template', null, { check: false })
  // 分かりにくいところに番号を付けた絵（review.html の「いまのひな形の作り方」の番号と同じ）
  await page.evaluate(() => {
    const k = window.__v44
    const q = (s) => document.querySelector(s)
    const rows = [...document.querySelectorAll('.tpl-modal .ol .row')]
    // ① 紙面ではなく、入力欄が縦に並んだ一覧
    k.pin(q('.tpl-modal .ol'), 1, 0, 0)
    // ② 「説明」が、学生に薄い字で見せる文だと分かりにくい
    k.pin(rows.find((r) => r.classList.contains('paragraph')), 2, 0, 0.5)
    // ③ 左で書き、右の見本で確かめる（目が行き来する）
    k.pin(q('.tpl-preview'), 3, 0.04, 0.04)
    // ④ 足すボタンは、一覧のいちばん下（スクロールしないと見えない）
    k.pin(q('.tpl-edit'), 4, 0.5, 0.97)
    // ⑤ 抄録の書き出し例は、いちばん上の小さな欄
    k.pin(q('.tpl-edit textarea'), 5, 1, 0)
    // ⑥ 「図の枠」「素材表」など、学生の画面と言葉が違う
    k.pin(rows.find((r) => r.classList.contains('figure')), 6, 0, 0.5)
    // ⑦ 「反映する」の後も、まだ学生に届かない
    k.pin([...document.querySelectorAll('.tpl-foot button')].find((b) => b.textContent.includes('反映')), 7, -0.08, -0.3)
  })
  await shot(page, 'now-template-pins', null, { check: false })
  await page.evaluate(() => window.__v44.clear())
  // 足すボタン（いちばん下までスクロールしたところ）
  await page.evaluate(() => {
    const e = document.querySelector('.tpl-edit')
    e.scrollTop = e.scrollHeight
  })
  await sleep(400)
  await shot(page, 'now-template-adds', around('.tpl-edit .adds', 14, { t: 120 }), { check: false })
  await context.close()
}

// =====================================================================
// 学生用ツール
// =====================================================================
/** 学生用ツールを開き、映画・舞台衣装デザイナー コースを選んで、ひな形のままの下書きにする（scripts/video/session.mjs の openTool と同じ手順） */
async function openStudentTool(browser, config, { vp = PC } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  page.on('dialog', (d) => d.accept())
  await (await page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'deny', browserContextId: context.id })
  await noHotReload(page)
  await page.setViewport(vp)
  await routeGoogle(page, fakeDrive('00zz0123@bunka-wu.ac.jp'), config)
  for (let i = 0; i < 5; i++) {
    try {
      await page.goto(`${APP}/`, { waitUntil: 'networkidle0', timeout: 90000 })
      await page.waitForSelector('.login-over .login-btn', { timeout: 30000 })
      break
    } catch (e) {
      console.log(`  （開けませんでした。やり直します：${e.message.split('\n')[0]}）`)
      await sleep(3000)
    }
  }
  await page.addStyleTag({ content: '.login-over.tab-locked { display: none !important; }' })
  await ready(page)
  await page.click('.login-btn')
  await page.waitForFunction(() => !document.querySelector('.login-over'), { timeout: 60000 })
  await page.waitForSelector('.guide.step-course .g-opts button')
  await page.evaluate((name) => [...document.querySelectorAll('.guide .g-opts button')].find((b) => b.textContent.includes(name)).click(), COURSE_NAME)
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.guide .g-later')
  await page.evaluate(() => document.querySelector('.guide .g-later').click())
  await page.evaluate(() => window.__editor.finishEditing())
  await ready(page)
  await installKit(page)
  await parkMouse(page)
  return { context, page }
}

/** 本文のブロック（大見出しの名前・種類・説明）を返す */
const bodyBlocks = (page) =>
  page.evaluate(() =>
    window.__editor.getSnapshot().report.body.map((c) => ({ id: c.id, title: c.title, blocks: c.blocks.map((b) => ({ id: b.id, type: b.type, hint: b.hint ?? '', title: b.title ?? '', caption: b.caption ?? b.figures?.[0]?.caption ?? '' })) })),
  )

async function goToPage(page, index) {
  await page.evaluate((i) => window.__editor.goToPage(i, 'none'), index)
  await sleep(500)
  await ready(page)
}

/** ページの種類の並び（cover・abstract・toc・body・photos） */
const pageKinds = (page) => page.evaluate(() => window.__editor.getSnapshot().layout.kinds)


// =====================================================================
// 案A ひな形を作る画面を、学生のツールで開く
// =====================================================================
/** ひな形を作っているあいだの見た目（学生用ツールに書き足す。body.v44-tpl のときだけ効く） */
const TPL_CSS = `
  /* いちばん上の帯（学生の画面ではないと、ひと目で分かるように） */
  body.v44-tpl #root { height: calc(100% - 46px); margin-top: 46px; }
  .v44-banner { position: fixed; z-index: 1500; top: 0; left: 0; right: 0; height: 46px; display: flex; align-items: center; gap: 10px; padding: 0 18px; background: #fbe6b0; border-bottom: 2px solid #d9a634; color: #4d3500; font-size: 15.5px; white-space: nowrap; }
  .v44-banner svg { width: 22px; height: 22px; color: #9a6a00; }
  .v44-banner b { font-weight: 700; letter-spacing: 0.02em; }
  .v44-banner span { color: #6b4d0c; }
  /* 本文の字＝学生に薄い字で見せる「ここに書くこと」。学生の画面の薄い字と同じ色 */
  body.v44-tpl .page-viewport section.body p[data-block-id]:not(:empty) { color: #5f6b95; position: relative; }
  body.v44-tpl .page-viewport section.body p[data-block-id]:not(:empty)::before,
  body.v44-tpl .page-viewport section.abstract .body p[data-block-id]:not(:empty)::before {
    content: 'ここに書くこと'; position: absolute; right: calc(100% + 2.5mm); top: 0.3em; text-indent: 0; letter-spacing: 0.02em;
    font: 700 6.4pt/1.55 'BIZ UDPGothic', sans-serif; color: #7a5600; background: #fcefcb; border: 0.25mm solid #e7c46e; border-radius: 1.2mm; padding: 0 1.3mm; white-space: nowrap;
  }
  body.v44-tpl .page-viewport section.abstract .body p[data-block-id]:not(:empty) { color: #5f6b95; position: relative; }
  body.v44-tpl .page-viewport section.abstract .body p[data-block-id]:not(:empty)::before { content: '書き出しの例'; }
  /* 書いている欄の字も同じ薄い色 */
  body.v44-tpl .overlay-editor[data-kind='paragraph'] { color: #5f6b95 !important; caret-color: #24262b; }
  /* 図の枠・素材表の中は、学生が入れる所 */
  body.v44-tpl .page-viewport .figure-slot::before { content: '（学生が写真を入れる枠）'; color: #8a90a0; }
  body.v44-tpl .page-viewport table [data-block-id][data-placeholder]:empty::before { content: '（学生が書く）'; color: #9aa1ad; }
  /* ひな形を作っているあいだは、チェック（指摘の赤い印）をしない */
  body.v44-tpl .page-viewport [data-block-id].has-issue:empty { outline: none !important; }
  body.v44-tpl .page-viewport [data-block-id].has-issue:empty::before { color: #9aa1ad !important; }
  body.v44-tpl ::highlight(issue-error), body.v44-tpl ::highlight(issue-warning) { text-decoration: none; background-color: transparent; color: #5f6b95; }
  /* 抄録のページの上の欄（年度・コース・学籍番号など）は、自動か学生が入れる所なので、少し薄く */
  body.v44-tpl .page-viewport section.abstract .head { opacity: 0.45; }
  /* チェックの赤い点は出さない */
  body.v44-tpl .thumb-list .t.has-error::after { display: none; }
  /* 右の欄：セルフチェックなどの代わりに、ひな形の欄 */
  body.v44-tpl .side > :not(.side-head):not(.v44-panel) { display: none !important; }
  body.v44-tpl .side .side-head .meta, body.v44-tpl .side .side-head .head-menu-wrap { display: none !important; }
  .v44-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 18px 22px 18px; color: var(--ink); }
  .v44-panel h2 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 18px; letter-spacing: 0.02em; }
  .v44-panel h2 svg { width: 22px; height: 22px; color: #9a6a00; }
  .v44-panel .course { margin: 4px 0 14px 30px; font-size: 14.5px; color: var(--muted); }
  .v44-panel ul { margin: 0; padding: 12px 14px 12px 30px; border-radius: 10px; background: #f6f4ef; font-size: 14px; line-height: 1.9; color: #4a4d55; }
  .v44-panel li::marker { color: #b9a26a; }
  .v44-panel .spacer { flex: 1; }
  .v44-panel .foot { display: flex; flex-direction: column; gap: 10px; }
  .v44-panel .primary { display: flex; align-items: center; justify-content: center; gap: 8px; height: 52px; border: 0; border-radius: 10px; background: var(--accent); color: #fff; font-size: 16.5px; font-weight: 700; letter-spacing: 0.03em; }
  .v44-panel .primary svg { width: 20px; height: 20px; }
  .v44-panel .sub { height: 42px; border: 1px solid #cfd3dc; border-radius: 10px; background: #fff; color: var(--ink); font-size: 15px; }
  .v44-panel .note { margin: 0; font-size: 13px; color: var(--muted); text-align: center; line-height: 1.6; }
  .v44-panel .link { align-self: center; margin-top: 2px; border: 0; background: none; color: var(--accent); font-size: 13px; text-decoration: underline; text-underline-offset: 3px; }
  /* 書いている欄の横の札（「ここに書くこと」） */
  .v44-tag { position: fixed; z-index: 60; display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 7px; background: #fcefcb; border: 1px solid #e7c46e; color: #6b4b00; font-size: 12.5px; font-weight: 700; white-space: nowrap; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .v44-tag small { font-weight: 400; color: #7d6530; font-size: 12px; }
`

/** 帯と右の欄（ひな形を作っているあいだ） */
const BANNER = `<div class="v44-x v44-banner">${IC.template}<b>ひな形を作っています：${esc(COURSE_NAME)} コース</b><span>（学生の画面ではありません）</span></div>`
const PANEL = `<section class="v44-x v44-panel">
  <h2>${IC.template}このコースのひな形</h2>
  <p class="course">${esc(COURSE_NAME)} コース</p>
  <ul>
    <li>学生と同じように、紙面に書きます</li>
    <li>本文の字は、学生には薄い字で出ます</li>
    <li>表紙・作品写真は、ひな形に入りません</li>
  </ul>
  <div class="spacer"></div>
  <div class="foot">
    <button class="primary">${IC.back}管理ページに戻して反映</button>
    <button class="sub">やめる</button>
    <p class="note">学生に届くのは、管理ページで<br>「保存して学生に反映」を押してから</p>
    <button class="link">標準のひな形に戻す</button>
  </div>
</section>`

/**
 * 学生用ツールを「ひな形を作る」ようすにする（案A）。
 * 原稿の中身：表紙の学生の項目は空。本文の段落の字＝ひな形の「ここに書くこと」。抄録は書き始めたことにして、書き出しの例を字として入れる。
 * empty：字を空にしておく段落（そこで先生が打つところを撮る）
 */
async function enterTemplateMode(page, { empty = [] } = {}) {
  const kinds = await pageKinds(page)
  await page.evaluate(
    (example, empty) =>
      window.__editor.update((r) => ({
        ...r,
        basicInfo: { ...r.basicInfo, studentId: '', name: '', subtitleInput: '' },
        abstract: { started: true, paragraphs: [{ ...r.abstract.paragraphs[0], hint: undefined, content: [{ type: 'text', text: example }] }] },
        body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.type === 'paragraph' ? { ...b, content: [{ type: 'text', text: empty.includes(b.id) ? '' : (b.hint ?? '') }], hint: undefined } : b)) })),
      })),
    FILM.abstractExample,
    empty,
  )
  await sleep(800)
  await ready(page)
  // ひな形に入らないページ（表紙・作品写真）は、ページの一覧で薄くし、札を付ける
  const off = kinds.map((k, i) => (k === 'cover' || k === 'photos' ? i + 1 : 0)).filter(Boolean)
  const offCss = off
    .map(
      (n) =>
        `body.v44-tpl .thumb-list .t:nth-child(${n}) .mini { opacity: 0.35; }
         body.v44-tpl .thumb-list .t:nth-child(${n}) { color: #9a9ea8; position: relative; }
         body.v44-tpl .thumb-list .t:nth-child(${n})::before { content: 'ひな形に\\A入らない'; white-space: pre; position: absolute; z-index: 2; left: 50%; top: 38%; transform: translate(-50%, -50%); padding: 3px 7px; border-radius: 6px; background: #fff; border: 1px solid #d8d4cc; color: #6d6a64; font-size: 11.5px; line-height: 1.45; font-weight: 700; text-align: center; }`,
    )
    .join('\n')
  await page.evaluate(
    (css, banner, panel) => {
      window.__v44.css(css, 'v44-tpl-css')
      document.body.classList.add('v44-tpl')
      window.__v44.add(banner)
      document.querySelector('.side .side-head').insertAdjacentHTML('afterend', panel)
      window.dispatchEvent(new Event('resize'))
    },
    TPL_CSS + offCss,
    BANNER,
    PANEL,
  )
  await sleep(600)
  await page.evaluate(() => window.__editor.refitPage())
  await sleep(600)
  await ready(page)
  await parkMouse(page)
}

/** 書いている欄（overlay-editor）のすぐ下に札を付ける（上には見出しがあるので、下に） */
const tagEditing = (page, html) =>
  page.evaluate((html) => {
    document.querySelector('.v44-tag')?.remove()
    CSS.highlights?.delete('issue-error')
    CSS.highlights?.delete('issue-warning')
    const ed = document.querySelector('.overlay-editor').getBoundingClientRect()
    const tag = window.__v44.add(`<div class="v44-x v44-tag">${html}</div>`)
    tag.style.left = `${ed.left}px`
    tag.style.top = `${ed.bottom + 8}px`
  }, html)

/** 段落を押して、書き始める（caret：何字目から） */
async function openParagraph(page, id, caret = 0) {
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), id)
  await sleep(500)
  await ready(page)
  await page.evaluate((id, caret) => window.__editor.openWhenReady(id, caret), id, caret)
  await page.waitForSelector('.overlay-editor', { visible: true })
  await sleep(700)
}

/** 紙面のブロックの範囲（いま見ているページの中）を、まわりを広げて返す（近くで撮る絵の範囲） */
const blockClip = (page, ids, pad = { l: 120, t: 60, r: 40, b: 40 }) =>
  page.evaluate(
    (ids, pad) => {
      const rs = ids.flatMap((id) => [...document.querySelectorAll(`.page-viewport.front [data-vivliostyle-page-container].is-current [data-block-id="${id}"]`)].map((e) => e.getBoundingClientRect()))
      const ed = document.querySelector('.overlay-editor')
      if (ed && getComputedStyle(ed).display !== 'none' && ed.getBoundingClientRect().width) rs.push(ed.getBoundingClientRect())
      const l = Math.max(0, Math.min(...rs.map((r) => r.left)) - pad.l)
      const t = Math.max(0, Math.min(...rs.map((r) => r.top)) - pad.t)
      const r = Math.min(innerWidth, Math.max(...rs.map((r) => r.right)) + pad.r)
      const b = Math.min(innerHeight, Math.max(...rs.map((r) => r.bottom)) + pad.b)
      return { x: l, y: t, width: r - l, height: b - t }
    },
    ids,
    pad,
  )

async function aShots(browser) {
  // ① 管理ページのコースのカード：「ひな形を作る画面を開く」（新しいタブ）
  {
    const { context, page } = await openAdmin(browser)
    await page.evaluate(() => document.querySelector('.tpl-row').scrollIntoView({ block: 'center' }))
    await sleep(300)
    await page.evaluate(
      (css, icon) => {
        window.__v44.css(css)
        const row = document.querySelector('.tpl-row')
        const summary = '大見出し3・小見出し3・図1・素材表1'
        window.__v44.hide(row)
        row.insertAdjacentHTML(
          'afterend',
          `<div class="v44-x v44-tplrow"><div class="top"><span class="l">下書きのひな形</span><b>${summary}</b></div><div class="bot"><button class="v44-open">${icon}ひな形を作る画面を開く</button><span class="n">学生と同じ画面が、<br>新しいタブで開きます</span></div></div>`,
        )
        window.__v44.cursor(document.querySelector('.v44-open'), 0.62, 0.62)
      },
      ROW_CSS,
      IC.newTab,
    )
    await shot(page, 'a-1-card', around('.form .course', 10))
    await context.close()
  }

  // ②〜⑦ ひな形を作る画面（学生用ツール）
  const { context, page } = await openStudentTool(browser, toolConfig())
  const blocks = await bodyBlocks(page)
  const all = blocks.flatMap((c) => c.blocks)
  const process = blocks.find((c) => c.title === '制作過程')
  const processP = process.blocks.find((b) => b.type === 'paragraph').id
  await page.evaluate(() => window.__editor.setView('zoom'))
  await sleep(500)
  await enterTemplateMode(page, { empty: [processP] })
  const kinds = await pageKinds(page)
  // ② 本文の1ページ目（いつもの見た目）
  await goToPage(page, kinds.indexOf('body'))
  await parkMouse(page)
  await shot(page, 'a-2-main')
  // 近くで：見出し・「ここに書くこと」・図の枠（紙面の左の余白の札も入れる）
  await shot(page, 'a-2-zoom', () => {
    const cur = '.page-viewport.front [data-vivliostyle-page-container].is-current'
    const rs = [...document.querySelectorAll(`${cur} h1, ${cur} h2, ${cur} section.body p[data-block-id], ${cur} .figure-slot, ${cur} figcaption`)].map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.top < innerHeight * 0.66)
    const l = Math.min(...rs.map((r) => r.left)) - 130
    const t = Math.min(...rs.map((r) => r.top)) - 30
    const r = Math.max(...rs.map((r) => r.right)) + 30
    const b = Math.max(...rs.map((r) => r.bottom)) + 16
    return { x: Math.max(0, l), y: Math.max(0, t), width: Math.min(innerWidth, r) - Math.max(0, l), height: Math.min(innerHeight, b) - Math.max(0, t) }
  })
  await shot(page, 'a-2-panel', around('.side', 0))

  // ③ 先生が「ここに書くこと」を書いているところ（「Ⅱ．制作過程」の段落）
  await openParagraph(page, processP, 0)
  await page.keyboard.type(TYPED, { delay: 5 })
  await sleep(800)
  await tagEditing(page, 'ここに書くこと<small>学生には薄い字で出ます</small>')
  await shot(page, 'a-3-typing')
  await shot(page, 'a-3-typing-zoom', await blockClip(page, [process.id, processP], { l: 70, t: 70, r: 30, b: 40 }))

  // ⑤ 表を入れる（素材表）。書いている段落で「表を入れる」を押したところ
  await page.evaluate(() => [...document.querySelectorAll('.palette button')].find((b) => b.textContent.includes('表を入れる')).click())
  await page.waitForSelector('.table-menu')
  await sleep(300)
  const mat = await page.evaluate(() => {
    const r = document.querySelector('.table-menu > button').getBoundingClientRect()
    return { x: r.left + r.width * 0.45, y: r.top + r.height * 0.5 }
  })
  await page.mouse.move(mat.x, mat.y)
  await sleep(300)
  await page.evaluate(() => window.__v44.cursor(document.querySelector('.table-menu > button'), 0.86, 0.3))
  await shot(page, 'a-5-table', around('.palette, .table-menu', 14, { r: 10 }))
  await page.keyboard.press('Escape')
  await page.evaluate(() => {
    document.querySelectorAll('.v44-cursor, .v44-tag').forEach((e) => e.remove())
    window.__editor.finishEditing()
  })
  await sleep(500)

  // ⑥ 抄録の書き出し例を、抄録のページの上で直す
  const absId = await page.evaluate(() => window.__editor.getSnapshot().report.abstract.paragraphs[0].id)
  await page.evaluate(() => window.__editor.setView('zoom'))
  await openParagraph(page, absId, FILM.abstractExample.length)
  await tagEditing(page, '抄録の書き出しの例<small>学生には薄い字で出ます</small>')
  await shot(page, 'a-6-abstract')
  await shot(page, 'a-6-abstract-zoom', await blockClip(page, [absId], { l: 70, t: 190, r: 40, b: 50 }))
  await page.evaluate(() => {
    document.querySelectorAll('.v44-tag').forEach((e) => e.remove())
    window.__editor.finishEditing()
  })
  await sleep(400)

  // 表紙（ひな形には入らない）。紙面全体が見えるように「全体」で
  await page.evaluate(() => window.__editor.setView('fit'))
  await goToPage(page, kinds.indexOf('cover'))
  await page.evaluate(() => {
    document.querySelector('.palette .p-head span').textContent = '学生が書く所\n（見るだけ）'
    const paper = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current').getBoundingClientRect()
    window.__v44.add(`<div class="v44-x v44-cover-note" style="left:${paper.left + paper.width / 2}px;top:${paper.top + paper.height * 0.8}px"><b>表紙は、学生が書きます</b><span>ひな形には入りません（見るだけ）</span></div>`)
    window.__v44.css(`.v44-cover-note { position: fixed; z-index: 50; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 12px 22px; border-radius: 12px; background: rgba(255,255,255,.96); border: 1.5px solid #e2c47a; box-shadow: 0 4px 16px rgba(0,0,0,.12); color: #4d3500; font-size: 15px; white-space: nowrap; }
      .v44-cover-note span { font-size: 13px; color: #6b5a33; }
      body.v44-tpl .page-viewport.front [data-vivliostyle-page-container].is-current { opacity: 0.55; }`)
  })
  await sleep(300)
  await shot(page, 'a-cover')
  await context.close()

  // ④ 学生の見え方（管理ページで保存したあと。本物の学生の画面）
  {
    const template = FILM.template.map((b) => (b.type === 'paragraph' && b.hint.startsWith('パターン') ? { ...b, hint: NEW_HINT } : b))
    const { context, page } = await openStudentTool(browser, toolConfig(template))
    const blocks = await bodyBlocks(page)
    const process = blocks.find((c) => c.title === '制作過程')
    const p = process.blocks.find((b) => b.type === 'paragraph').id
    await page.evaluate(() => window.__editor.setView('zoom'))
    await sleep(400)
    await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), p)
    await sleep(600)
    await ready(page)
    await parkMouse(page)
    await shot(page, 'a-4-student')
    await shot(page, 'a-4-student-zoom', await blockClip(page, [process.id, p], { l: 70, t: 70, r: 30, b: 40 }))
    await context.close()
  }

  // ⑧ 管理ページに戻ったあと（コースのカードに「ひな形：変更あり（まだ学生に届いていません）」と、画面の下の帯）
  {
    const { context, page } = await openAdmin(browser)
    // 本物の「反映する」で、ひな形を変えておく（保存していない変更がある状態にする）
    await openTemplateWindow(page)
    const input = await page.evaluateHandle(() => [...document.querySelectorAll('.tpl-modal .ol .row input')].find((i) => i.value.startsWith('パターン')))
    await input.evaluate((el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, NEW_HINT)
    await sleep(300)
    await page.evaluate(() => [...document.querySelectorAll('.tpl-foot button')].find((b) => b.textContent.trim() === '反映する').click())
    await page.waitForFunction(() => !document.querySelector('.tpl-modal'))
    await previewReady(page)
    await page.evaluate(() => document.querySelector('.tpl-row').scrollIntoView({ block: 'center' }))
    await sleep(300)
    await page.evaluate(
      (css, icon, warn, back) => {
        window.__v44.css(css)
        const row = document.querySelector('.tpl-row')
        const summary = '大見出し3・小見出し3・図1・素材表1'
        window.__v44.hide(row)
        row.insertAdjacentHTML(
          'afterend',
          `<div class="v44-x v44-tplrow chg"><div class="flag">${warn}ひな形：変更あり（まだ学生に届いていません）</div><div class="top"><span class="l">下書きのひな形</span><b>${summary}</b></div><div class="bot"><button class="v44-open">${icon}ひな形を作る画面を開く</button></div></div>`,
        )
        document.querySelector('.form').style.paddingBottom = '90px'
        window.__v44.add(
          `<div class="v44-x v44-bar"><span class="mk">1</span><div class="tx"><b>まだ学生に届いていない変更が1か所あります</b><span>映画・舞台衣装デザイナー コースの下書きのひな形</span></div><button class="v44-btn">変更を見る</button><button class="v44-btn primary">保存して学生に反映</button></div>`,
        )
        window.__v44.add(`<div class="v44-x v44-toast">${back}ひな形を受け取りました（映画・舞台衣装デザイナー コース）</div>`)
      },
      ROW_CSS + BAR_CSS,
      IC.newTab,
      IC.warn,
      IC.check,
    )
    await sleep(300)
    await shot(page, 'a-8-back')
    await shot(page, 'a-8-back-card', around('.form .course', 10))
    await context.close()
  }
}

/** 管理ページのコースのカードの「下書きのひな形」の行（案A） */
const ROW_CSS = `
  .v44-tplrow { margin-top: 4px; padding: 9px 11px 10px; border-radius: 8px; background: #f6f8fb; font-size: 12.5px; color: var(--muted); }
  .v44-tplrow .top { display: flex; gap: 8px; align-items: baseline; }
  .v44-tplrow .top .l { flex: none; }
  .v44-tplrow .top b { color: var(--ink); font-size: 12px; }
  .v44-tplrow .bot { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
  .v44-open { display: inline-flex; align-items: center; gap: 6px; padding: 7px 14px 7px 11px; border-radius: 8px; border: 1px solid var(--accent); background: var(--accent); color: #fff; font-size: 13.5px; font-weight: 700; white-space: nowrap; }
  .v44-open svg { width: 17px; height: 17px; }
  .v44-tplrow .n { font-size: 12px; line-height: 1.5; color: var(--muted); }
  .v44-tplrow.chg { background: #fff6e0; box-shadow: inset 0 0 0 1.5px #e9c56d; }
  .v44-tplrow .flag { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; color: #8a5a00; font-size: 13px; font-weight: 700; }
  .v44-tplrow .flag svg { width: 17px; height: 17px; }
  .v44-tplrow.chg .v44-open { background: #fff; color: var(--accent); border-color: #c3cbe4; }
`
/** 保存していない変更の帯（mockups/v43 案A の帯と同じ形） */
const BAR_CSS = `
  .v44-bar { position: fixed; z-index: 90; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 14px; padding: 12px 22px; background: #fff7e6; border-top: 2px solid #e9b949; box-shadow: 0 -4px 14px rgba(0,0,0,.08); }
  .v44-bar .mk { display: inline-grid; place-items: center; flex: none; width: 34px; height: 34px; border-radius: 50%; background: #e9a923; color: #fff; font-size: 17px; font-weight: 700; }
  .v44-bar .tx { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.5; }
  .v44-bar .tx b { font-size: 16px; color: #3a2a00; }
  .v44-bar .tx span { font-size: 13.5px; color: #6b5a33; }
  .v44-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 42px; padding: 0 18px; font-size: 15px; border: 1px solid #d9c9a3; background: #fff; color: var(--ink); border-radius: 9px; white-space: nowrap; }
  .v44-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 700; }
  .v44-toast { position: fixed; z-index: 95; top: 104px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 8px; padding: 10px 18px; border-radius: 10px; background: #2f3640; color: #fff; font-size: 14.5px; white-space: nowrap; box-shadow: 0 6px 18px rgba(0,0,0,.2); }
  .v44-toast svg { width: 18px; height: 18px; color: #9fe0b0; }
`

// =====================================================================
// 案B 管理ページの中に、紙面に似た画面（いまのひな形の窓の中身を入れ替える）
// =====================================================================
const B_CSS = `
  .tpl-body.v44b-on { grid-template-columns: 184px minmax(0, 1fr); }
  .tpl-body.v44b-on > .tpl-edit, .tpl-body.v44b-on > .tpl-pv { display: none !important; }
  .v44b-tools { display: flex; flex-direction: column; gap: 6px; padding: 14px 14px; border-right: 1px solid var(--line); background: #fafbfc; overflow: auto; }
  .v44b-tools .h { margin: 2px 2px 2px; font-size: 12.5px; font-weight: 700; color: var(--muted); letter-spacing: 0.04em; }
  .v44b-tools button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border: 1px solid #d5dae6; border-radius: 8px; background: #fff; color: var(--ink); font-size: 14px; text-align: left; white-space: nowrap; }
  .v44b-tools button svg { width: 19px; height: 19px; color: var(--accent); }
  .v44b-tools button.add { border-style: dashed; border-color: #aab6d6; color: var(--accent); }
  .v44b-tools button.danger svg, .v44b-tools button.danger { color: var(--error); }
  .v44b-tools button:disabled { opacity: 0.4; }
  .v44b-tools .sep { height: 1px; margin: 8px 0 6px; background: var(--line); }
  .v44b-tools .note { margin: 4px 2px 0; font-size: 12px; line-height: 1.6; color: var(--muted); }
  .v44b-stage { position: relative; min-height: 0; background: #e9e7e3; }
  .v44b-stage iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
  .v44b-tag { position: absolute; z-index: 5; display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 7px; background: #fcefcb; border: 1px solid #e7c46e; color: #6b4b00; font-size: 12.5px; font-weight: 700; white-space: nowrap; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .v44b-tag small { font-weight: 400; color: #7d6530; font-size: 12px; }
`
/** 案B の紙（1枚の長い紙。iframe の中） */
const SHEET_CSS = `
  body { margin: 0; padding: 18px 0 40px; background: #e9e7e3; zoom: ZOOM; }
  .sheet { width: 210mm; box-sizing: border-box; margin: 0 auto; padding: 16mm 25mm 30mm 35mm; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.12); }
  .abs { margin: 0 0 10mm; padding: 3mm 4mm 3.5mm; border: 0.3mm solid #d9d4c7; border-radius: 2mm; background: #fbfaf6; }
  .abs .h { font: 700 8.5pt/1.6 'BIZ UDPGothic', sans-serif; color: #6d6a64; }
  .abs .h small { font-weight: 400; margin-left: 2mm; }
  .abs p { margin: 1.5mm 0 0; font-family: 'BIZ UDMincho', serif; font-size: 10.5pt; line-height: 1.8; color: #5f6b95; text-indent: 1em; }
  .lbl { display: flex; align-items: center; gap: 3mm; margin: 0 0 6mm; font: 700 8.5pt/1 'BIZ UDPGothic', sans-serif; color: #8a8780; letter-spacing: 0.1em; }
  .lbl::after { content: ''; flex: 1; height: 0.3mm; background: #e2ded5; }
  section.body p[data-block-id] { color: #5f6b95; position: relative; }
  section.body p[data-block-id]::before { content: 'ここに書くこと'; position: absolute; right: calc(100% + 2.5mm); top: 0.3em; text-indent: 0; letter-spacing: 0.02em; font: 700 6.4pt/1.55 'BIZ UDPGothic', sans-serif; color: #7a5600; background: #fcefcb; border: 0.25mm solid #e7c46e; border-radius: 1.2mm; padding: 0 1.3mm; white-space: nowrap; }
  section.body p.on { outline: 0.5mm solid #2f3e75; outline-offset: 1.2mm; border-radius: 0.5mm; margin-bottom: 16mm; }
  section.body p.on::before { display: none; }
  .caret { display: inline-block; width: 0; height: 1.15em; margin-left: 0.3mm; border-left: 0.35mm solid #24262b; vertical-align: -0.2em; }
  .figure-slot { margin: 0 auto; outline: 1px dashed #b9b9b9; background: repeating-linear-gradient(45deg, #f6f6f6 0 8px, #efefef 8px 16px); display: grid; place-items: center; }
  .figure-slot::before { content: '（学生が写真を入れる枠）'; color: #8a90a0; font-family: 'BIZ UDPGothic', sans-serif; font-size: 10pt; }
  table [data-block-id]:empty::before { content: '（学生が書く）'; color: #9aa1ad; }
  h1.chapter:not(:first-child) { margin-top: 2em; }
  .brk { margin: 7mm 0 5mm; border-top: 0.3mm dashed #c9c5bb; text-align: center; font: 7.5pt/1 'BIZ UDPGothic', sans-serif; color: #a19d94; }
  .brk span { position: relative; top: -2mm; padding: 0 2mm; background: #fff; }
`

/** 案B の窓の中身を入れる。typing：打っているところ（「制作過程」の段落を選んで、打っている途中） */
async function putSheet(page, { typing = false } = {}) {
  await page.evaluate(
    async ({ css, sheetCss, template, example, typed, typing, ic }) => {
      const { bodyContentHtml } = await import('/src/layout/bodyHtml.ts')
      const { reportCss } = await import('/src/layout/reportCss.ts')
      const { bodyFromTemplate } = await import('/src/model/template.ts')
      window.__v44.css(css, 'v44b-css')
      const bodyEl = document.querySelector('.tpl-body')
      bodyEl.classList.add('v44b-on')
      bodyEl.querySelectorAll('.v44b-tools, .v44b-stage').forEach((e) => e.remove())
      const tool = (icon, label, cls = '', dis = false) => `<button class="${cls}"${dis ? ' disabled' : ''}>${icon}${label}</button>`
      bodyEl.insertAdjacentHTML(
        'beforeend',
        `<aside class="v44-x v44b-tools">
          <div class="h">足す</div>
          ${tool(ic.h1, '大見出し', 'add')}${tool(ic.sub, '小見出し', 'add')}${tool(ic.para, 'ここに書くこと', 'add')}${tool(ic.figure, '図の枠', 'add')}${tool(ic.table, '素材表', 'add')}${tool(ic.brk, '改ページ', 'add')}
          <div class="sep"></div>
          <div class="h">選んでいる所</div>
          ${tool(ic.up, '上へ', '', !typing)}${tool(ic.dn, '下へ', '', !typing)}${tool(ic.remove, '削除', 'danger', !typing)}
          <p class="note">紙の上で押した所の<br>すぐ下に足します</p>
        </aside>
        <div class="v44-x v44b-stage"><iframe title="ひな形の紙"></iframe></div>`,
      )
      const chapters = bodyFromTemplate(template)
      const body = bodyContentHtml(chapters, { imageSrc: () => '', figureSize: () => ({ widthMm: 60, heightMm: 45 }) })
      const fonts = ['/node_modules/@fontsource/biz-udmincho/400.css', '/node_modules/@fontsource/biz-udpgothic/400.css', '/node_modules/@fontsource/biz-udpgothic/700.css'].map((h) => `<link rel="stylesheet" href="${h}">`).join('')
      const frame = document.querySelector('.v44b-stage iframe')
      const stageW = frame.getBoundingClientRect().width
      const zoom = Math.min(0.95, (stageW - 40) / 794)
      frame.srcdoc = `<!doctype html><html lang="ja"><head><meta charset="utf-8">${fonts}<style>${reportCss}${sheetCss.replace('ZOOM', String(zoom))}</style></head><body><div class="sheet">
        <div class="abs"><div class="h">抄録の書き出し例<small>抄録の欄に、薄い字で出ます</small></div><p>${example}</p></div>
        <div class="lbl">本文</div>
        <section class="body">${body}</section></div></body></html>`
      await new Promise((r) => frame.addEventListener('load', r, { once: true }))
      const d = frame.contentDocument
      await d.fonts.ready
      // 段落の説明（「（…）」）を、字として出す（先生が書く字＝学生に薄い字で見せる字）
      for (const p of d.querySelectorAll('section.body p[data-block-id]')) p.textContent = (p.getAttribute('data-placeholder') ?? '').replace(/^（|）$/g, '')
      // 大見出しの区切り（学生の紙面では、大見出しごとに次のページから始まる。案B では1枚の紙なので、線だけ）
      ;[...d.querySelectorAll('section.body h1.chapter')].slice(1).forEach((h) => h.insertAdjacentHTML('beforebegin', '<div class="brk"><span>ここから次のページ</span></div>'))
      if (typing) {
        const p = [...d.querySelectorAll('section.body p[data-block-id]')].find((x) => x.textContent.startsWith('パターン'))
        p.classList.add('on')
        p.innerHTML = `${typed}<span class="caret"></span>`
        const win = frame.contentWindow
        const z = parseFloat(getComputedStyle(d.body).zoom) || 1
        const r = p.getBoundingClientRect()
        win.scrollTo(0, Math.max(0, (r.top + win.scrollY) * (z === 1 ? 1 : 1) - 260))
        const r2 = p.getBoundingClientRect()
        const fr = frame.getBoundingClientRect()
        const stage = document.querySelector('.v44b-stage')
        const sr = stage.getBoundingClientRect()
        // getBoundingClientRect は zoom の後の値（Chromium）
        stage.insertAdjacentHTML('beforeend', `<div class="v44b-tag" style="left:${fr.left - sr.left + r2.left}px;top:${fr.top - sr.top + r2.bottom + 10}px">ここに書くこと<small>学生には薄い字で出ます</small></div>`)
      }
    },
    { css: B_CSS, sheetCss: SHEET_CSS, template: FILM.template, example: esc(FILM.abstractExample), typed: esc(TYPED), typing, ic: IC },
  )
  await sleep(800)
}

async function bShots(browser) {
  const { context, page } = await openAdmin(browser)
  await openTemplateWindow(page)
  await putSheet(page)
  await shot(page, 'b-main')
  await putSheet(page, { typing: true })
  await shot(page, 'b-typing')
  await shot(page, 'b-typing-zoom', () => {
    const t = document.querySelector('.v44b-tag').getBoundingClientRect()
    const s = document.querySelector('.v44b-stage').getBoundingClientRect()
    const frame = document.querySelector('.v44b-stage iframe')
    const sh = frame.contentDocument.querySelector('.sheet').getBoundingClientRect()
    const fr = frame.getBoundingClientRect()
    const left = Math.max(s.left, fr.left + sh.left - 16)
    const right = Math.min(s.right, fr.left + sh.right + 16)
    const top = Math.max(s.top, t.top - 200)
    return { x: left, y: top, width: right - left, height: Math.min(t.bottom + 30, s.bottom) - top }
  })
  await context.close()
}

// =====================================================================
// 一覧のページ（mockups/v44/review.html）を1枚の画像にする（shots/review-template.png）
// =====================================================================
async function reviewShots(browser) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 })
  await page.goto(`${APP}/${DIR}/review.html`, { waitUntil: 'networkidle0' })
  // スクロールバーの分だけ幅が狭くならないように（画像の幅をちょうど 1200px に）
  await page.addStyleTag({ content: 'html { scrollbar-width: none; }' })
  await page.evaluate(() => document.fonts.ready)
  await sleep(300)
  // 書き足した字に、1字だけの行がないか
  await installKit(page)
  const bad = await page.evaluate(() => window.__v44.lonely('main'))
  if (bad.length) console.log(`  ！review：1字だけの行：${bad.join(' ／ ')}`)
  await page.evaluate(() => document.getElementById('v44-style')?.remove())
  await page.screenshot({ path: `${OUT}/review-template.png`, fullPage: true })
  console.log('✓ review-template')
  await page.close()
}

await withEdge(async (browser) => {
  if (want('now')) await nowShots(browser)
  if (want('a')) await aShots(browser)
  if (want('b')) await bShots(browser)
  if (want('review')) await reviewShots(browser)
})
