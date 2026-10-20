// デザイン案 v43（管理ページを見やすく）を画像に書き出す。
// 依頼者（先生）の声：「管理ページが見づらい。情報が多く、ぱっと見で操作がしにくい」。
// 本物の管理ページ（開発サーバーの /admin.html。ブラウザの中だけで動く試験用サーバー）を開き、
//   1. いまの画面を、そのまま写す（1366×768・1920×1080、管理者と先生）。見づらいところを数える（入力欄・ボタン・小さい字の数）
//   2. 3つの案の画面を、案の CSS と部品だけを書き足して写す（src/ は変えない）
//      案A 整える：いまの並びのまま、見出しのある区切り・ラベルと欄の列・大きい字・コースは閉じたカード
//      案B 左の見出し：左に区切りの一覧。右には選んだ区切りだけ（見本は、要る区切りだけ右に）
//      案C 入口：はじめに「すること」のカードだけ。押すと、その作業だけの画面
// 試験用サーバーの中身（localStorage）は、撮影用の Edge の中だけで作り直す（ふだん使うブラウザの中身は変わらない）。
// 見本のデータ：2026年度（公開中）に、コースを2つ（1つ目はお知らせとひな形あり、2つ目は標準のひな形）。
// できるもの：mockups/v43/shots/*.png と、一覧のページ mockups/v43/review.html の写し（shots/review-admin.png）
// 使い方: node scripts/mockup-shots-v43.mjs [now] [a] [b] [c] [review]（何も付けなければ全部。開発サーバーが http://localhost:5173 で動いていること）
//   now   ：いまの画面（管理者・先生、1366×768・1920×1080、窓のそれぞれ、新年度の流れ）
//   a/b/c ：案A・案B・案C（1366×768。管理者のはじめの画面と、奥の画面、先生の画面）
//   review：一覧のページを画像にする
//   数（はじめの画面に見える入力欄・ボタンの数）は shots/counts.json に書き、一覧のページの表はこの数から書いた
//   Edge は EDGE_PORT（ふだんは 9721）で起動する
//   開発サーバーで作業中の変更（ほかの直し）が混ざらないよう、v43 の絵は、最後のコミット（HEAD）の写しを別のポートの開発サーバーで開いて写した：
//     git archive HEAD を作業用のフォルダーに広げ、node_modules をつなぎ、依存の控えを外に置く設定で vite を 5183 番で起動して
//     APP_URL=http://localhost:5183 node scripts/mockup-shots-v43.mjs（一覧のページは REVIEW_URL、ふだんは http://localhost:5173 で開く）
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'

process.env.EDGE_PORT ??= '9721'
const { withEdge } = await import('./poc/edge.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
/** 一覧のページ（mockups/v43/review.html）を開く所（ふだんの開発サーバー） */
const REVIEW_APP = process.env.REVIEW_URL ?? 'http://localhost:5173'
const DIR = 'mockups/v43'
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })
const ONLY = process.argv.slice(2)
const want = (k) => ONLY.length === 0 || ONLY.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** ノートパソコンの画面と、大きい画面 */
const PC = { width: 1366, height: 768, deviceScaleFactor: 1.5 }
const BIG = { width: 1920, height: 1080, deviceScaleFactor: 1 }

const COUNTS_FILE = `${OUT}/counts.json`
const counts = existsSync(COUNTS_FILE) ? JSON.parse(readFileSync(COUNTS_FILE, 'utf8')) : {}
const saveCounts = () => writeFileSync(COUNTS_FILE, JSON.stringify(counts, null, 2))

/** 見本のコースのお知らせ（管理ページの入力欄の例と同じ文） */
const NOTICE = '12月4日（金）の中間発表では、本文の下書きを印刷して持ってきてください'
/** 2つ目のコース（見本） */
const COURSE2 = { id: 'stylist', name: 'スタイリスト・コーディネーター', advisors: ['文化　一郎', '文化　桜'], subtitleTemplate: '―{input}のスタイリング―' }

// ---- アイコン（src/app/icons.tsx と同じ線の太さ） ----
const svg = (d, w = 1.6) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const IC = {
  calendar: svg('<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>'),
  course: svg('<path d="M4 7.5h16M4 12h16M4 16.5h10"/>'),
  notice: svg('<path d="M5 10v4h3l5 4V6L8 10z"/><path d="M16.5 9.5a3.5 3.5 0 010 5"/>'),
  template: svg('<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M8.5 8h7M8.5 11.5h7M8.5 15h4"/>'),
  words: svg('<path d="M4 18l5-12 5 12M5.8 14h6.4"/><path d="M15.5 15.5l2 2 3.5-4"/>'),
  people: svg('<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0111 0"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M15.5 14.2a4.6 4.6 0 015.2 4.8"/>'),
  history: svg('<path d="M4.5 12a7.5 7.5 0 102.2-5.3"/><path d="M4.5 4.5v3.5H8"/><path d="M12 8v4.5l3 2"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4L18 18M6 18l1.6-1.6M16.4 7.6L18 6"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  checkBold: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2.4),
  next: svg('<path d="M9.5 5l7 7-7 7"/>'),
  back: svg('<path d="M14.5 5l-7 7 7 7"/>'),
  down: svg('<path d="M6 9.5l6 6 6-6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  warn: svg('<path d="M12 4l9 16H3zM12 10v4.5M12 17.2v.1"/>'),
  sprout: svg('<path d="M12 20v-8"/><path d="M12 12c0-3.5 2.5-6 6.5-6 0 3.8-2.6 6-6.5 6z"/><path d="M12 14c0-3-2.2-5.2-5.8-5.2 0 3.3 2.3 5.2 5.8 5.2z"/>'),
  eye: svg('<path d="M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6z"/><circle cx="12" cy="12" r="2.6"/>'),
  pen: svg('<path d="M15.5 5.5l3 3L9 18H6v-3z"/><path d="M13.5 7.5l3 3"/>'),
  remove: svg('<path d="M5 7h14M10 7V5.5h4V7M7 7l.9 12h8.2L17 7"/>'),
  up: svg('<path d="M12 18V6M7 11l5-5 5 5"/>'),
  dn: svg('<path d="M12 6v12M7 13l5 5 5-5"/>'),
  user: svg('<circle cx="12" cy="8.6" r="3.6"/><path d="M4.8 19.5a7.2 7.2 0 0114.4 0"/>'),
}

// =====================================================================
// 案の見た目（色と書体は src/admin/admin.css の変数）
// =====================================================================
const CSS = `
  [data-v43-hidden] { display: none !important; }
  .v43-x { box-sizing: border-box; font-family: 'BIZ UDPGothic', sans-serif; }
  .v43-x * { box-sizing: border-box; }
  .v43-fixed { position: fixed; z-index: 70; }
  /* 説明用の印（番号の丸）。いまの画面の見づらいところを指す */
  .v43-pin { position: fixed; z-index: 80; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%; background: #d4380d; color: #fff; font: 700 16px/30px 'BIZ UDPGothic', sans-serif; text-align: center; box-shadow: 0 0 0 3px #fff, 0 2px 6px rgba(0,0,0,.35); }
  .v43-ring { position: fixed; z-index: 79; border: 3px solid #d4380d; border-radius: 10px; pointer-events: none; box-shadow: 0 0 0 2px rgba(255,255,255,.8); }
  /* マウスの矢印（説明用） */
  .v43-cursor { position: fixed; z-index: 90; width: 22px; height: 22px; pointer-events: none; }
  .v43-cursor svg { display: block; width: 100%; height: 100%; filter: drop-shadow(0 1px 1px rgba(0,0,0,.3)); }
`

/** マウスの矢印 */
const CURSOR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2.5v17.2l4.4-4.2 2.9 6.4 2.7-1.2-2.9-6.3h6.1z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>'

/** ページの中で使う道具（部品を足す・隠す・数える・元に戻す） */
async function installKit(page) {
  await page.evaluate(
    (css, cursorSvg) => {
      if (document.getElementById('v43-style')) return
      const style = document.createElement('style')
      style.id = 'v43-style'
      style.textContent = css
      document.head.append(style)
      window.__v43 = {
        add(html, parent = document.body) {
          parent.insertAdjacentHTML('beforeend', html)
          return parent.lastElementChild
        },
        hide(el) {
          el?.setAttribute('data-v43-hidden', '')
        },
        /** 案の CSS を足す（clear で外す） */
        css(text) {
          const s = document.createElement('style')
          s.className = 'v43-x'
          s.textContent = text
          document.head.append(s)
        },
        /** 説明の番号の丸を、部品の上（x・y は部品の幅・高さに対する割合）に置く */
        pin(el, n, fx = 0, fy = 0, ring = false) {
          if (!el) return
          const r = el.getBoundingClientRect()
          if (ring) this.add(`<div class="v43-x v43-ring" style="left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px"></div>`)
          this.add(`<div class="v43-x v43-pin" style="left:${Math.max(16, Math.min(innerWidth - 16, r.left + r.width * fx))}px;top:${Math.max(16, Math.min(innerHeight - 16, r.top + r.height * fy))}px">${n}</div>`)
        },
        cursor(el, fx = 0.6, fy = 0.6) {
          const r = el.getBoundingClientRect()
          this.add(`<div class="v43-x v43-cursor" style="left:${r.left + r.width * fx}px;top:${r.top + r.height * fy}px">${cursorSvg}</div>`)
        },
        /**
         * 画面に見えている入力欄とボタンを数える（画面の外・スクロールで隠れている所・閉じた「詳細設定」の中は数えない）。
         * 入力欄：input・select・textarea。ボタン：button・summary（開く所）・押せる行（[data-v43-btn]）
         */
        count() {
          /** 部品が見えている範囲（スクロールの枠で切る）。隠れていれば null */
          const clipOf = (el) => {
            let box = { l: 0, t: 0, r: innerWidth, b: innerHeight }
            for (let p = el; p; p = p.parentElement) {
              const ps = getComputedStyle(p)
              if (ps.display === 'none' || ps.visibility === 'hidden') return null
              if (p !== el && p.tagName === 'DETAILS' && !p.open && !el.closest('summary')) return null
              if (p !== el && /(auto|scroll|hidden)/.test(ps.overflow + ps.overflowX + ps.overflowY)) {
                const pr = p.getBoundingClientRect()
                box = { l: Math.max(box.l, pr.left), t: Math.max(box.t, pr.top), r: Math.min(box.r, pr.right), b: Math.min(box.b, pr.bottom) }
              }
            }
            return box
          }
          // 半分以上が見えていれば数える
          const shown = (r, box) => {
            if (!box || r.width < 2 || r.height < 2) return false
            const w = Math.min(r.right, box.r) - Math.max(r.left, box.l)
            const h = Math.min(r.bottom, box.b) - Math.max(r.top, box.t)
            return w > r.width * 0.5 && h > r.height * 0.5
          }
          const visible = (el) => shown(el.getBoundingClientRect(), clipOf(el))
          // 窓が開いていれば、窓の中だけ（後ろの画面は数えない）
          const root = document.querySelector('.modal-backdrop .modal, .v43-modal') ?? document.body
          const fields = [...root.querySelectorAll('input:not([type=hidden]):not([type=checkbox]), select, textarea, input[type=checkbox]')].filter(visible)
          const buttons = [...root.querySelectorAll('button, summary, [data-v43-btn]')].filter((b) => !b.closest('.v43-pin, .v43-cursor')).filter(visible)
          // 見えている字の数（見本の iframe の中は数えない）と、12px 以下の字のかたまりの数
          let chars = 0
          let small = 0
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
          const seen = new Set()
          const range = document.createRange()
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const text = n.textContent.replace(/\s/g, '')
            const el = n.parentElement
            // 見本（紙の形の絵）の中の字は、読む字に数えない（本物の見本の iframe と同じ扱い）
            if (!text || !el || el.closest('.v43-pin, style, script, option, .v43b-paper, .v43c-student')) continue
            const box = clipOf(el)
            range.selectNodeContents(n)
            if (!shown(range.getBoundingClientRect(), box)) continue
            chars += text.length
            if (!seen.has(el)) {
              seen.add(el)
              if (parseFloat(getComputedStyle(el).fontSize) <= 12.01) small++
            }
          }
          // 入力欄に入っている字も、読む字として数える
          for (const f of fields) if (f.value && f.type !== 'checkbox' && f.tagName !== 'SELECT') chars += f.value.replace(/\s/g, '').length
          return { fields: fields.length, buttons: buttons.length, chars, small }
        },
        /**
         * 1字だけの行を探す（root の中の、字のある部品ごとに、1字ずつの位置から行を分ける）。
         * 2行以上ある部品で、1字だけの行があれば、その部品の字を返す
         */
        lonely(selector = '.v43-x') {
          const bad = []
          const boxes = new Map()
          const range = document.createRange()
          for (const root of document.querySelectorAll(selector)) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
              if (!n.textContent.trim() || n.parentElement.closest('style, script, option, select, textarea')) continue
              // 行を作る箱（inline でない、いちばん近い祖先）
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
          document.querySelectorAll('.v43-x').forEach((e) => e.remove())
          document.querySelectorAll('[data-v43-hidden]').forEach((e) => e.removeAttribute('data-v43-hidden'))
          document.querySelectorAll('[class*="v43-on-"]').forEach((e) => [...e.classList].filter((c) => c.startsWith('v43-on-')).forEach((c) => e.classList.remove(c)))
        },
      }
    },
    CSS,
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
  })

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

/** 開く（読み込めなかったら、少し待ってやり直す。ほかの人が src/ を直していて、開発サーバーが組み直している間があるため） */
async function goto(page, url, selector) {
  for (let i = 0; i < 5; i++) {
    try {
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 })
      await page.waitForSelector(selector, { timeout: 15000 })
      return
    } catch (e) {
      console.log(`  （開けませんでした。やり直します：${e.message.split('\n')[0]}）`)
      await sleep(3000)
    }
  }
  throw new Error(`${url} を開けませんでした`)
}

/**
 * 管理ページを開く。試験用サーバーを空にしてから見本を入れて開き直す。
 * year2027：2027年度（準備中）も作っておく（開くのは open の年度）
 */
async function openAdmin(browser, { vp = PC, as = '', year2027 = false, open = 2026 } = {}) {
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
  await goto(page, `${APP}/admin.html`, '.admin .form')
  await page.evaluate(
    async ({ NOTICE, COURSE2, year2027, open }) => {
      const s = window.__adminServer
      const st = await s.getState()
      const row = st.years.find((y) => y.year === 2026)
      const config = JSON.parse(JSON.stringify(row.config))
      config.courses[0].notice = NOTICE
      config.courses.push(COURSE2)
      let after = await s.saveYear(config, row.updatedAt)
      // 変更履歴に、何回か保存した記録を残す（題目・締切を直して保存）
      for (const patch of [{ deadline: '2027-01-22' }, { deadline: '2027-01-20' }]) {
        const r = after.years.find((y) => y.year === 2026)
        after = await s.saveYear({ ...r.config, ...patch }, r.updatedAt)
      }
      // 変更履歴の日時を、春から秋に散らす（一度に作ったので、どれも同じ時刻になっているため）
      const store = JSON.parse(localStorage.getItem('sotsugyo-admin-mock'))
      const times = ['2026-04-08T10:12:00+09:00', '2026-06-15T16:40:00+09:00', '2026-09-30T09:05:00+09:00', '2026-10-14T13:20:00+09:00']
      store.history.forEach((h, i) => (h.at = new Date(times[Math.min(i, times.length - 1)]).toISOString()))
      localStorage.setItem('sotsugyo-admin-mock', JSON.stringify(store))
      if (year2027) await s.createYear(2026, 2027)
      localStorage.setItem('sotsugyo-admin-year', String(open))
    },
    { NOTICE, COURSE2, year2027, open },
  )
  await reopen(page, as)
  return { context, page }
}

/** 開き直す（as：teacher なら先生の画面） */
async function reopen(page, as) {
  await goto(page, `${APP}/admin.html${as ? `?as=${as}` : ''}`, as === 'teacher' ? '.teacher-main' : '.admin .form')
  await previewReady(page)
  await installKit(page)
  await parkMouse(page)
}

/** 入力欄の文字を変える（React に伝わるように、本物の入力と同じ知らせを出す） */
async function setValue(handle, value) {
  await handle.evaluate((el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
  await sleep(300)
}

const parkMouse = (page) => page.mouse.move(2, 2)
const clickText = (page, sel, text) => page.evaluate((sel, text) => [...document.querySelectorAll(sel)].find((b) => b.textContent.trim().startsWith(text)).click(), sel, text)

/** 確かめ：横にはみ出していないか・文字がボタンからはみ出していないか */
const audit = (page, name) =>
  page
    .evaluate(() => {
      const bad = []
      if (document.documentElement.scrollWidth > innerWidth + 1) bad.push(`横にはみ出している（${document.documentElement.scrollWidth}px）`)
      for (const el of document.querySelectorAll('.v43-x button, .v43-x [data-v43-btn], .v43-x .v43-chip')) {
        if (el.offsetWidth && el.scrollWidth > el.clientWidth + 1) bad.push(`文字がはみ出す：${el.textContent.slice(0, 20)}`)
      }
      for (const t of window.__v43.lonely()) bad.push(`1字だけの行：${t}`)
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

/** はじめの画面に見える入力欄・ボタンの数を数えて控える */
async function countAs(page, key) {
  const c = await page.evaluate(() => window.__v43.count())
  counts[key] = c
  saveCounts()
  console.log(`  数 ${key}：入力欄 ${c.fields}・ボタン ${c.buttons}・字 ${c.chars}・12px以下の字 ${c.small}`)
  return c
}

/** 入力の欄の長さ（画面の何枚分か）を控える */
async function screens(page, key, sel) {
  counts[key] = await page.evaluate((sel) => {
    const f = document.querySelector(sel)
    return Math.round((f.scrollHeight / f.clientHeight) * 10) / 10
  }, sel)
  saveCounts()
  console.log(`  長さ ${key}：画面 ${counts[key]} 枚分`)
}

/** 写す範囲：窓のまわり */
const MODAL = () => {
  const r = document.querySelector('.modal').getBoundingClientRect()
  const left = Math.max(0, r.left - 24)
  const top = Math.max(0, r.top - 12)
  return { x: left, y: top, width: Math.min(innerWidth, r.right + 24) - left, height: Math.min(innerHeight, r.bottom + 12) - top }
}

// =====================================================================
// 1. いまの画面
// =====================================================================
async function nowShots(browser) {
  const { context, page } = await openAdmin(browser, { vp: PC })
  // 管理者のはじめの画面（1366×768）
  await countAs(page, 'now-admin')
  await shot(page, 'now-admin-1366', null, { check: false })
  // 入力の欄の長さ（画面の何枚分か）
  const form = await page.evaluate(() => {
    const f = document.querySelector('.form')
    return { scroll: f.scrollHeight, client: f.clientHeight }
  })
  counts['now-form-screens'] = Math.round((form.scroll / form.client) * 10) / 10
  // 字の大きさ（いまの CSS から測る）
  counts['now-sizes'] = await page.evaluate(() => {
    const px = (sel) => {
      const el = document.querySelector(sel)
      return el ? parseFloat(getComputedStyle(el).fontSize) : null
    }
    return { h2: px('.form h2'), label: px('.f .l'), hint: px('.hint'), input: px('.in'), sublink: px('.head-sub .link'), badge: px('.badge'), legend: px('.stage .caption') }
  })
  saveCounts()
  console.log('  入力の欄の長さ：画面', counts['now-form-screens'], '枚分', JSON.stringify(counts['now-sizes']))

  // 見づらいところに番号を付けた絵
  await page.evaluate(() => {
    const k = window.__v43
    const q = (s) => document.querySelector(s)
    const btn = (t) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(t))
    k.pin(q('.form .course'), 1, 0.97, 0.06, true)
    k.pin(q('.form h2'), 2, 0.8, 0.5, true)
    k.pin(q('.form .tpl-row .btn'), 3, 1.32, 0.5)
    k.pin(btn('保存して学生に反映'), 4, -0.1, 0.5)
    k.pin(q('.head-sub .link'), 5, -0.4, 0.5)
    k.pin(q('.stage .caption'), 6, 0.62, 0.5)
  })
  await shot(page, 'now-admin-1366-pins', null, { check: false })
  await page.evaluate(() => window.__v43.clear())

  // 入力の欄を下まで（画面を縦に伸ばして、一度に見える所を全部写す）
  await page.setViewport({ ...PC, height: Math.min(4000, 86 + form.scroll + 4), deviceScaleFactor: 1 })
  await sleep(700)
  await page.evaluate(() => document.querySelector('details.details')?.removeAttribute('open'))
  await shot(page, 'now-admin-tall', () => ({ x: 0, y: 0, width: 520, height: document.querySelector('.form').scrollHeight + 86 }), { check: false })
  await page.setViewport(PC)
  await sleep(600)

  // コースのカード（近くで）
  await shot(page, 'now-course', () => {
    const r = document.querySelector('.form .course').getBoundingClientRect()
    return { x: r.left - 10, y: r.top - 30, width: r.width + 20, height: Math.min(innerHeight - r.top + 30, r.height + 40) }
  })

  // 詳細設定（開いたところ。入力の欄の下のほう）
  await page.evaluate(() => {
    const d = document.querySelector('details.details')
    d.open = true
    d.scrollIntoView({ block: 'start' })
    document.querySelector('.form').scrollTop -= 8
  })
  await sleep(400)
  await shot(page, 'now-details', null, { check: false })
  await page.evaluate(() => {
    document.querySelector('details.details').open = false
    document.querySelector('.form').scrollTop = 0
  })

  // 1920×1080
  await page.setViewport(BIG)
  await sleep(900)
  await previewReady(page)
  await countAs(page, 'now-admin-1920')
  await shot(page, 'now-admin-1920', null, { check: false })
  await page.setViewport(PC)
  await sleep(700)

  // ひな形の窓
  await page.evaluate(() => document.querySelector('.form .tpl-row .btn').click())
  await page.waitForSelector('.tpl-modal .ol .row input')
  await sleep(2200)
  await page.evaluate(() => document.activeElement?.blur())
  await parkMouse(page)
  await countAs(page, 'now-template')
  await shot(page, 'now-template', null, { check: false })
  await clickText(page, '.tpl-modal button', 'やめる')
  await sleep(300)

  // 書き間違えやすい語の窓
  await page.evaluate(() => document.querySelector('.words-btn').click())
  await page.waitForSelector('.words-modal')
  await sleep(400)
  await page.evaluate(() => document.activeElement?.blur())
  await countAs(page, 'now-words')
  await shot(page, 'now-words', null, { check: false })
  await clickText(page, '.words-modal button', 'やめる')
  await sleep(300)

  // 先生の登録
  await clickText(page, '.head-sub button', '先生の登録')
  await page.waitForSelector('.modal.members .member-list li')
  await sleep(400)
  await page.evaluate(() => document.activeElement?.blur())
  await countAs(page, 'now-members')
  await shot(page, 'now-members', null, { check: false })
  await clickText(page, '.modal button', '閉じる')
  await sleep(300)

  // 変更履歴
  await clickText(page, '.head-sub button', '変更履歴')
  await page.waitForSelector('.modal .history li')
  await sleep(400)
  await page.evaluate(() => document.activeElement?.blur())
  await countAs(page, 'now-history')
  await shot(page, 'now-history', null, { check: false })
  await page.keyboard.press('Escape')
  await sleep(300)

  // 新年度の流れ：窓 → 作ったあとの知らせ
  await clickText(page, '.head-sub button', '新年度を作成')
  await page.waitForSelector('.modal .row-buttons')
  await sleep(300)
  await shot(page, 'now-newyear-modal', null, { check: false })
  await clickText(page, '.modal button', '作成する')
  await page.waitForFunction(() => document.querySelector('.message.ok')?.textContent.includes('作成しました'))
  await previewReady(page)
  await parkMouse(page)
  await countAs(page, 'now-newyear-after')
  await shot(page, 'now-newyear-after', null, { check: false })

  // 先生の画面（公開中の2026年度）
  await page.evaluate(() => localStorage.setItem('sotsugyo-admin-year', '2026'))
  await reopen(page, 'teacher')
  await countAs(page, 'now-teacher')
  await shot(page, 'now-teacher-1366', null, { check: false })
  await page.setViewport(BIG)
  await sleep(700)
  await shot(page, 'now-teacher-1920', null, { check: false })
  await context.close()
}

// =====================================================================
// 案の部品（どの案でも同じ形）
// 別に直している6つ（依頼者が決めたもの）は、どの案にも入れて描く：
//   ① コース名の欄の右の外に「コース」 ② サブタイトルの「―」は欄の外に固定（―[前]〔学生が入力〕[後]―）
//   ③ お知らせの説明は「このコースの学生のツールの、セルフチェック欄の上に表示されます。」だけ
//   ④ コースの並べ替えは、カードの左上の ⋮⋮ をドラッグ（上へ・下へのボタンはなし） ⑤ 左の欄の幅は、境目をドラッグして変えられる
//   ⑥ 詳細設定のボタンは「止める」
// =====================================================================
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const STATUS_CLASS = (s) => (s === '公開中' ? 'pub' : s === '準備中' ? 'draft' : 'old')
const saveLabel = (s) => (s === '公開中' ? '保存して学生に反映' : '保存')
/** 並べ替えのつまみ（⋮⋮） */
const GRIP = '<svg viewBox="0 0 12 18" aria-hidden="true"><g fill="currentColor"><circle cx="3.5" cy="3.5" r="1.4"/><circle cx="8.5" cy="3.5" r="1.4"/><circle cx="3.5" cy="9" r="1.4"/><circle cx="8.5" cy="9" r="1.4"/><circle cx="3.5" cy="14.5" r="1.4"/><circle cx="8.5" cy="14.5" r="1.4"/></g></svg>'
const HELP = svg('<circle cx="12" cy="12" r="8.6"/><path d="M9.6 9.7a2.45 2.45 0 014.75.85c0 1.65-2.35 1.95-2.35 3.5"/><path d="M12 16.9v.15" stroke-width="2.3"/>')

/** 画面に出す内容（試験用サーバーの、いま開いている年度。言葉の一覧・標準のひな形は、本物の部品から読む） */
async function getData(page) {
  return page.evaluate(async () => {
    const s = window.__adminServer
    const st = await s.getState()
    const year = Number(document.querySelector('.admin-header .sel').value)
    const row = st.years.find((y) => y.year === year)
    const { DEFAULT_WORD_CHECKS } = await import('/src/checker/textRules.ts')
    const { DEFAULT_TEMPLATE } = await import('/src/model/template.ts')
    const { templateSummary } = await import('/src/admin/templateText.ts')
    let members = []
    let history = []
    try {
      members = await s.getMembers()
    } catch {}
    try {
      history = (await s.getHistory(year)).map((h) => ({ at: h.at, user: h.user, action: h.action }))
    } catch {}
    const c = row.config
    return {
      user: st.user,
      role: st.role,
      year,
      status: row.status,
      deletable: !!row.deletable,
      years: st.years.map((y) => ({ year: y.year, status: y.status })),
      config: c,
      words: c.wordChecks ?? DEFAULT_WORD_CHECKS,
      courses: c.courses.map((x) => ({ ...x, summary: templateSummary(x), own: !!x.template?.length, blocks: x.template?.length ? x.template : DEFAULT_TEMPLATE })),
      members,
      history,
    }
  })
}

const inp = (v, ph = '', cls = '') => `<input class="v43-in ${cls}" value="${esc(v)}" placeholder="${esc(ph)}">`
const area = (v, ph = '', rows = 3) => `<textarea class="v43-in" rows="${rows}" placeholder="${esc(ph)}">${esc(v)}</textarea>`
const num = (v, ph = '') => `<input class="v43-in num" type="number" value="${esc(v ?? '')}" placeholder="${esc(ph)}">`
/** ラベルと欄の1行（ラベルの列と欄の列をそろえる） */
const row = (label, control, { hint = '', sub = '', warn = '', mark = false } = {}) =>
  `<div class="v43-l">${label}${sub ? `<small>${sub}</small>` : ''}${mark ? '<small class="chg">変更あり</small>' : ''}</div><div class="v43-c${mark ? ' chg' : ''}">${control}${warn ? `<div class="v43-warn">${IC.warn}<span>${warn}</span></div>` : ''}${hint ? `<div class="v43-hint">${hint}</div>` : ''}</div>`
/** 保存していない変更がある項目か（d.dirty：'deadline'・'notice:コースID'・'advisors:コースID' など） */
const isDirty = (d, key) => !!d.dirty?.includes(key)
/** 見本の年度に、保存していない変更を作る（最終締切・1つ目のコースのお知らせ・2つ目のコースの指導教員）。数と一覧は src/admin/changes.ts で出す */
async function withChanges(page, d) {
  const config = JSON.parse(JSON.stringify(d.config))
  config.deadline = '2027-01-22'
  config.courses[0].notice = '中間発表は12月4日（金）です。本文の下書きを印刷して持ってきてください'
  config.courses[1].advisors = [...config.courses[1].advisors, '新宿　葵']
  const { changes, short } = await page.evaluate(async (before, after) => {
    const { describeChanges, shortChanges } = await import('/src/admin/changes.ts')
    const changes = describeChanges(before, after)
    return { changes, short: shortChanges(changes, 3) }
  }, d.config, config)
  console.log('  変更：', changes.join(' ／ '))
  const courses = d.courses.map((c, i) => ({ ...c, notice: config.courses[i].notice, advisors: config.courses[i].advisors }))
  return { ...d, config, courses, changes, short, dirty: ['deadline', `notice:${courses[0].id}`, `advisors:${courses[1].id}`] }
}
/** 保存していない変更があるあいだ、画面の下にずっと出る帯（ボタンも帯の中に。公開の確かめの流れは、いまのまま） */
function dirtyBar(d, { teacher = false } = {}) {
  const n = d.changes.length
  const reach = d.status === '公開中' || d.status === '終了'
  const head = reach ? `まだ学生に届いていない変更が${n}か所あります` : `保存していない変更が${n}か所あります`
  const tail = reach ? '' : `学生に届くのは、${teacher ? '管理者がこの年度を公開して' : 'この年度を公開して'}からです。`
  return `<div class="v43-x v43-bar"><span class="mk">${n}</span><div class="tx"><b>${head}</b><span>${esc(d.short)}${tail ? `　${tail}` : ''}</span></div><button class="v43-btn big">変更を見る</button><button class="v43-btn primary big">${saveLabel(d.status)}</button></div>`
}
const chip = (text, cls = '') => `<span class="v43-chip ${cls}">${text}</span>`
const NOTICE_HINT = 'このコースの学生のツールの、セルフチェック欄の上に表示されます。'
/** サブタイトルの前と後（「―」は欄の外に固定。② ） */
function subParts(t) {
  const i = t.indexOf('{input}')
  const [b, a] = i < 0 ? [t, ''] : [t.slice(0, i), t.slice(i + 7)]
  return [b.replace(/^―/, ''), a.replace(/―$/, '')]
}
const courseName = (c) => `<span class="v43-name">${inp(c.name, 'コース名')}<span class="suf">コース</span></span>`
const subtitle = (c) => {
  const [b, a] = subParts(c.subtitleTemplate)
  return `<span class="v43-subt"><span class="dash">―</span>${inp(b)}<span class="slot">学生が入力</span>${inp(a)}<span class="dash">―</span></span>`
}
const subtitleExample = (c) => {
  const [b, a] = subParts(c.subtitleTemplate)
  return `例：―${esc(b)}シンドバッド${esc(a)}―`
}
const advisors = (c) => `<span class="v43-tags">${c.advisors.map((n) => `<span class="v43-tag">${esc(n)}<button aria-label="${esc(n)}を外す">×</button></span>`).join('')}<input class="v43-in tagin" placeholder="氏名を入れて Enter"></span>`
const showToggle = (c) => `<label class="v43-check"><input type="checkbox" ${c.hidden ? '' : 'checked'}>学生に表示</label>`
const tplLine = (c, label = 'ひな形を直す') => `<span class="v43-tpl"><span class="${c.own ? 'own' : 'def'}">${esc(c.summary)}</span><button class="v43-btn sub sm">${IC.template}${label}</button></span>`
const courseChips = (c, d) =>
  [
    d && (isDirty(d, `notice:${c.id}`) || isDirty(d, `advisors:${c.id}`)) ? chip('変更あり', 'chg') : '',
    c.hidden ? chip('学生に表示しない', 'off') : '',
    c.notice ? chip(`${IC.notice}お知らせあり`, 'acc') : chip('お知らせなし'),
    c.own ? chip(`${IC.template}独自のひな形`, 'acc') : chip('標準のひな形'),
  ].join('')
/** 年度の見出し（案B・案C。案A は本物の見出しの字を大きくする） */
function header(d, { teacher = false, quietPublish = false } = {}) {
  const pub = d.status === '公開中'
  const dirty = d.changes?.length
  return `<header class="v43-x v43-hd">
    <span class="t">卒業制作報告書 管理ページ</span>
    <button class="v43-help">${HELP}使い方</button>
    <select class="v43-sel">${d.years.map((y) => `<option ${y.year === d.year ? 'selected' : ''}>${y.year}年度（${y.status}）</option>`).join('')}</select>
    <span class="v43-badge ${STATUS_CLASS(d.status)}">${d.status}</span>
    <span class="spacer"></span>
    <span class="v43-status${dirty ? ' dirty' : ''}">${dirty ? `保存していない変更 ${dirty}か所` : '変更はありません'}</span>
    <button class="v43-btn ${dirty ? (pub || teacher ? 'primary' : '') : 'off'}">${saveLabel(d.status)}</button>
    ${!pub && !teacher ? `<button class="v43-btn ${quietPublish ? 'sub' : 'primary'}">この年度を学生に公開</button>` : ''}
  </header>`
}
/** 見本の欄の上の行（本物の「見本（入力するとすぐ反映されます）」の代わり） */
const previewCaption = (name) =>
  `<div class="v43-x v43-cap"><b>見本</b><span>表紙と抄録（${esc(name)} コース）</span><span class="spacer"></span><span class="lg"><i class="y"></i>年度の設定から入る所<i class="g"></i>学生が書く所</span></div>`

/** 見本の欄の上の行を差し替え、見本の大きさが決まるのを待つ */
async function swapCaption(page, d, i = 0) {
  await page.evaluate((html) => {
    const cap = document.querySelector('.stage .caption')
    if (!cap) return
    window.__v43.hide(cap)
    cap.insertAdjacentHTML('afterend', html)
  }, previewCaption(d.courses[i].name))
}
/** 左の欄の幅を変える境目（⑤）。部品の右の端に、つまみを描く */
const resizeHandle = (page, sel) =>
  page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect()
    window.__v43.add(`<div class="v43-x v43-resize" style="left:${r.right - 4}px;top:${r.top}px;height:${r.height}px" title="ドラッグで幅を変える"><i></i></div>`)
  }, sel)
async function settle(page) {
  await sleep(500)
  await previewReady(page)
  await parkMouse(page)
}

const DESIGN = `
  .v43-x { font-size: 15px; line-height: 1.6; color: var(--ink); word-break: auto-phrase; text-wrap: pretty; }
  .v43-x button { font: inherit; cursor: pointer; }
  .v43-x .spacer { flex: 1; }
  .v43-x svg { flex: none; }
  /* 見出し（案B・案C） */
  .admin.v43-on-hd { --head-h: 61px; }
  .v43-hd { display: flex; align-items: center; gap: 12px; height: 61px; padding: 0 22px; background: #fff; border-bottom: 1px solid var(--line); white-space: nowrap; }
  .v43-hd .t { font-size: 16px; font-weight: 700; margin-right: 2px; }
  .v43-hd .v43-help { display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px 6px 9px; border: 1px solid #c9cfe6; border-radius: 8px; background: #fff; color: var(--accent); font-size: 14px; }
  .v43-hd .v43-help svg { width: 18px; height: 18px; }
  .v43-sel { font: inherit; font-size: 15px; border: 1px solid #cfd5de; border-radius: 8px; padding: 7px 10px; background: #fff; color: var(--ink); }
  .v43-badge { font-size: 13px; border-radius: 999px; padding: 3px 11px; font-weight: 700; }
  .v43-badge.pub { background: var(--ok-soft); color: var(--ok); }
  .v43-badge.draft { background: var(--warn-soft); color: var(--warn); }
  .v43-badge.old { background: var(--bg); color: var(--muted); }
  .v43-status { font-size: 14px; color: var(--muted); }
  .v43-status.dirty { color: var(--warn); font-weight: 700; }
  .v43-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; font-size: 15px; border: 1px solid #cfd5de; background: #fff; color: var(--ink); border-radius: 9px; padding: 8px 16px; white-space: nowrap; }
  .v43-btn svg { width: 18px; height: 18px; }
  .v43-btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 700; }
  .v43-btn.sub { color: var(--accent); border-color: #c3cbe4; }
  .v43-btn.off { color: #a3a9b4; background: #f5f6f8; border-color: #e3e6eb; }
  .v43-btn.sm { font-size: 14px; padding: 5px 12px; }
  .v43-btn.danger { color: var(--error); border-color: #efc7c7; }
  /* まとまり */
  .v43-card { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 16px 20px 18px; }
  .v43-h1 { font-size: 21px; font-weight: 700; margin: 0 0 4px; letter-spacing: 0.02em; }
  .v43-sh { display: flex; align-items: center; gap: 10px; margin: 0 0 2px; font-size: 18px; font-weight: 700; }
  .v43-sh .n { display: inline-grid; place-items: center; width: 27px; height: 27px; border-radius: 50%; background: var(--accent); color: #fff; font-size: 14px; }
  .v43-sh svg { width: 23px; height: 23px; color: var(--accent); }
  .v43-sh .v43-btn { margin-left: auto; }
  .v43-h3 { margin: 18px 0 10px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 15.5px; font-weight: 700; color: var(--accent); }
  .v43-lead { margin: 0 0 14px; font-size: 14px; color: var(--muted); line-height: 1.7; }
  /* ラベルと欄（ラベルの列をそろえる） */
  .v43-grid { display: grid; grid-template-columns: 7.6em minmax(0, 1fr); gap: 14px 16px; align-items: start; }
  .v43-l { font-size: 15px; font-weight: 700; padding-top: 7px; line-height: 1.45; }
  .v43-l small { display: block; margin-top: 2px; font-weight: 400; font-size: 13px; color: var(--muted); }
  .v43-c { min-width: 0; }
  .v43-in { font: inherit; font-size: 15px; line-height: 1.5; color: var(--ink); border: 1px solid #cfd5de; border-radius: 8px; padding: 7px 11px; background: #fff; width: 100%; }
  .v43-in::placeholder { color: #9aa1ad; }
  textarea.v43-in { resize: vertical; line-height: 1.65; display: block; }
  .v43-in.num { width: 84px; }
  .v43-hint { margin-top: 5px; font-size: 13.5px; color: var(--muted); line-height: 1.6; }
  .v43-warn { display: flex; gap: 6px; align-items: flex-start; margin-top: 6px; font-size: 13.5px; color: var(--warn); line-height: 1.6; }
  .v43-warn svg { width: 17px; height: 17px; margin-top: 2px; }
  .v43-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 13px; line-height: 1.5; padding: 2px 10px; border-radius: 999px; background: #f0f2f5; color: #535a68; white-space: nowrap; }
  .v43-chip svg { width: 15px; height: 15px; }
  .v43-chip.ok { background: var(--ok-soft); color: var(--ok); }
  .v43-chip.acc { background: var(--accent-soft); color: var(--accent); }
  .v43-chip.warn { background: var(--warn-soft); color: var(--warn); }
  .v43-chip.off { background: #f4e9e9; color: #8a4b4b; }
  .v43-add { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; border: 1px dashed #aab6d6; background: #fff; color: var(--accent); border-radius: 10px; padding: 9px; font-size: 15px; }
  .v43-add svg { width: 18px; height: 18px; }
  /* コースの部品（①〜④） */
  .v43-name { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
  .v43-name .v43-in { font-weight: 700; }
  .v43-name .suf { flex: none; font-weight: 700; color: var(--ink); }
  .v43-subt { display: flex; align-items: center; gap: 5px; }
  .v43-subt .dash { flex: none; font-size: 16px; color: var(--ink); }
  .v43-subt .v43-in { min-width: 0; flex: 1; }
  .v43-subt .slot { flex: none; font-size: 13.5px; color: var(--muted); background: var(--bg); border-radius: 7px; padding: 6px 8px; }
  .v43-tags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .v43-tag { display: inline-flex; align-items: center; gap: 2px; background: var(--accent-soft); color: var(--accent); border-radius: 999px; padding: 3px 4px 3px 12px; font-size: 14.5px; }
  .v43-tag button { border: 0; background: none; color: inherit; padding: 0 6px; font-size: 15px; }
  .v43-tags .tagin { width: 170px; padding: 4px 10px; font-size: 14px; }
  .v43-check { display: inline-flex; align-items: center; gap: 6px; font-size: 14.5px; white-space: nowrap; }
  .v43-check input { width: 17px; height: 17px; margin: 0; accent-color: var(--accent); }
  .v43-tpl { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 6px 0 0; }
  .v43-tpl .own { font-weight: 700; font-size: 14.5px; }
  .v43-tpl .def { color: var(--muted); font-size: 14.5px; }
  .v43-grip { display: inline-grid; place-items: center; width: 22px; height: 30px; border-radius: 6px; color: #9aa1ad; cursor: grab; }
  .v43-grip svg { width: 11px; height: 17px; }
  /* 左の欄の幅を変える境目（⑤） */
  .v43-resize { position: fixed; z-index: 30; width: 8px; cursor: col-resize; }
  .v43-resize i { position: absolute; left: 1px; top: 50%; width: 6px; height: 46px; margin-top: -23px; border-radius: 4px; background: #c4cad4; box-shadow: 0 0 0 2px #fff; }
  /* 見本の欄の上の行 */
  .v43-cap { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; padding: 13px 20px 10px; font-size: 14px; color: var(--muted); }
  .v43-cap > * { white-space: nowrap; }
  .v43-cap b { color: var(--ink); font-size: 15px; }
  .v43-cap .lg { display: inline-flex; align-items: center; font-size: 13.5px; }
  .v43-cap .lg i { display: inline-block; width: 14px; height: 14px; margin: 0 5px 0 12px; border-radius: 3px; }
  .v43-cap .lg i.y { background: #fff3b0; border: 1px solid #e8d77a; }
  .v43-cap .lg i.g { background: #fff; border: 1px solid #9aa1ad; }
  /* 保存していない変更（項目の印と、画面の下の帯） */
  .v43-l small.chg { display: inline-block; margin-top: 4px; padding: 0 8px; border-radius: 999px; background: #ffedc2; color: #7a4f00; font-size: 13px; font-weight: 700; }
  .v43-c.chg .v43-in, .v43-c.chg .v43-tags .v43-tag:last-of-type { box-shadow: 0 0 0 2px #f5c45e; }
  .v43-chip.chg { background: #ffedc2; color: #7a4f00; font-weight: 700; }
  .v43-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 40; display: flex; align-items: center; gap: 14px; padding: 11px 24px; background: #fff5dc; border-top: 2px solid #efb540; box-shadow: 0 -6px 18px rgba(80, 60, 0, 0.12); }
  .v43-bar .mk { flex: none; display: inline-grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: #e59a00; color: #fff; font-size: 17px; font-weight: 700; }
  .v43-bar .tx { flex: 1; min-width: 0; display: grid; }
  .v43-bar .tx b { font-size: 17px; color: #5c3c00; }
  .v43-bar .tx span { font-size: 14px; color: #7a5a1a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .v43-btn.big { font-size: 16px; padding: 10px 22px; border-radius: 10px; }
  .v43-bar .v43-btn:not(.primary) { background: #fffaf0; border-color: #e5c27a; color: #6b4a00; }
  .v43-pad-bar { padding-bottom: 110px !important; }
  .v43-cnt { display: inline-block; vertical-align: 2px; margin-left: 6px; min-width: 22px; padding: 0 6px; border-radius: 999px; background: #e59a00; color: #fff; font-size: 13px; font-weight: 700; font-style: normal; text-align: center; line-height: 22px; }
  .v43-link { border: 0; background: none; padding: 0; color: var(--accent); font-size: 14.5px; display: inline-flex; align-items: center; gap: 5px; }
  .v43-link svg { width: 18px; height: 18px; }

  /* ================= 案A 整える ================= */
  .v43a .admin-header .head-row { height: 58px; gap: 12px; padding: 0 22px; }
  .v43a .admin-header b { font-size: 16px; }
  .v43a .admin-header .help-open { font-size: 14px; padding: 6px 12px 6px 9px; }
  .v43a .admin-header .sel { font-size: 15px; padding: 7px 10px; }
  .v43a .admin-header .badge { font-size: 13px; padding: 3px 11px; }
  .v43a .admin-header .btn { font-size: 15px; padding: 8px 16px; border-radius: 9px; }
  .v43a .admin-header .btn:disabled { opacity: 1; color: #a3a9b4; background: #f5f6f8; border-color: #e3e6eb; }
  .v43a .admin-header .head-sub { height: 42px; padding: 0 22px; gap: 8px; }
  .v43a .head-sub .who, .v43a .head-sub .user { font-size: 13.5px; }
  .v43a .head-sub .link { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 8px; font-size: 14.5px; }
  .v43a .head-sub .link svg { width: 18px; height: 18px; }
  .v43a .head-sub .sep { display: none; }
  .v43a.admin { --head-h: 101px; }
  .v43a .admin-main { grid-template-columns: 600px 1fr; }
  .v43a-form { overflow: auto; background: #f4f5f8; border-right: 1px solid var(--line); padding: 18px 22px 60px; display: grid; gap: 16px; align-content: start; }
  .v43a-courses { display: grid; gap: 10px; margin-bottom: 12px; }
  .v43a-crow { border: 1px solid var(--line); border-radius: 10px; background: #fff; }
  .v43a-crow > .top { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 4px 10px; align-items: start; padding: 10px 12px 10px 8px; }
  .v43a-crow .main b { display: block; font-size: 16px; }
  .v43a-crow .adv { display: block; font-size: 14px; color: var(--muted); }
  .v43a-crow .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .v43a-crow .v43-btn { margin-top: 2px; }
  .v43a-crow.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .v43a-crow.on > .top { border-bottom: 1px solid var(--line); background: #fafbfd; border-radius: 10px 10px 0 0; }
  .v43a-crow .body { padding: 14px 16px 16px; }
  .v43a-crow .foot { margin-top: 14px; padding-top: 10px; border-top: 1px dashed var(--line); font-size: 13.5px; color: var(--muted); }
  .v43a-line { display: flex; align-items: center; gap: 12px; }
  .v43a-line > span { flex: 1; font-size: 14.5px; color: var(--muted); line-height: 1.6; }
  .v43a-line > span b { color: var(--ink); }
  .v43a .stage { background: var(--bg); }
  .v43a-seg { display: flex; gap: 8px; }
  .v43a-seg button { flex: 1; padding: 8px; border-radius: 9px; border: 1px solid #cfd5de; background: #fff; font-size: 15px; }
  .v43a-seg button.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); font-weight: 700; }
  .v43-range { display: flex; align-items: center; gap: 8px; font-size: 15px; }
  /* 案A：先生の画面 */
  .v43a-teacher { overflow: auto; padding: 22px max(24px, calc(50% - 400px)) 60px; display: grid; gap: 16px; align-content: start; background: #f4f5f8; }

  /* ================= 案B 左の見出し ================= */
  .v43b-main { display: grid !important; grid-template-columns: 212px 560px minmax(0, 1fr); min-height: 0; }
  .v43b-main.wide { grid-template-columns: 212px minmax(0, 1fr); }
  .v43b-nav { background: #fff; border-right: 1px solid var(--line); padding: 14px 10px 14px; display: flex; flex-direction: column; gap: 3px; overflow: auto; }
  .v43b-nav button { display: flex; gap: 11px; align-items: flex-start; text-align: left; width: 100%; padding: 9px 12px; border: 0; border-radius: 10px; background: none; color: var(--ink); position: relative; }
  .v43b-nav button svg { width: 22px; height: 22px; color: #7a8292; margin-top: 1px; }
  .v43b-nav button b { display: block; font-size: 15.5px; line-height: 1.45; }
  .v43b-nav button small { display: block; font-size: 13px; color: var(--muted); line-height: 1.45; }
  .v43b-nav button.on { background: var(--accent-soft); }
  .v43b-nav button.on::before { content: ''; position: absolute; left: -10px; top: 8px; bottom: 8px; width: 4px; border-radius: 0 4px 4px 0; background: var(--accent); }
  .v43b-nav button.on svg, .v43b-nav button.on b { color: var(--accent); }
  .v43b-nav .sep { height: 1px; background: var(--line); margin: 8px 8px; }
  .v43b-nav .grp { padding: 4px 12px 2px; font-size: 12.5px; color: #8a919e; letter-spacing: 0.06em; }
  .v43b-nav .me { margin-top: auto; padding: 10px 12px 0; font-size: 13px; color: var(--muted); line-height: 1.6; word-break: break-all; }
  .v43b-nav .me .v43-badge { display: inline-block; margin-top: 4px; font-weight: 400; font-size: 12.5px; }
  .v43b-content { overflow: auto; padding: 22px 26px 60px; background: #f4f5f8; border-right: 1px solid var(--line); display: grid; gap: 16px; align-content: start; }
  .v43b-content > .v43-lead { margin: -12px 0 0; }
  .v43b-year p { margin: 0 0 12px; font-size: 14.5px; color: var(--muted); line-height: 1.7; }
  .v43b-clist { display: grid; gap: 6px; }
  .v43b-clist > div { display: flex; align-items: center; gap: 8px; padding: 4px 12px 4px 6px; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
  .v43b-clist > div.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .v43b-clist > div button.nm { flex: 1; min-width: 0; text-align: left; border: 0; background: none; padding: 0; font-size: 15.5px; font-weight: 700; color: var(--ink); }
  .v43b-clist > div.on button.nm { color: var(--accent); }
  .v43b-cfoot { margin-top: 14px; padding-top: 10px; border-top: 1px dashed var(--line); font-size: 13.5px; color: var(--muted); }
  /* 案B：書き方のチェック（言葉） */
  .v43b-words { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 18px; align-items: start; }
  .v43b-wt { padding: 6px 0 12px; }
  .v43b-wt .h, .v43b-wt .r { display: grid; grid-template-columns: 112px 24px 112px 86px minmax(0, 1fr); align-items: center; gap: 0 8px; padding: 0 16px; }
  .v43b-wt .h { font-size: 13px; color: var(--muted); padding-top: 6px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
  .v43b-wt .r { width: 100%; border: 0; border-bottom: 1px solid #eef0f3; background: none; text-align: left; min-height: 38px; font-size: 15px; color: var(--ink); }
  .v43b-wt .r .ar { color: #9aa1ad; }
  .v43b-wt .r .nt { font-size: 14px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .v43b-wt .r.ed { display: block; padding: 10px 16px 12px; background: #f7f9fe; border-left: 3px solid var(--accent); }
  .v43b-wt .r.ed .g { display: grid; grid-template-columns: 1fr 1fr 110px; gap: 8px; }
  .v43b-wt .r.ed .g2 { display: flex; gap: 8px; margin-top: 8px; }
  .v43b-wt .r.ed label { display: grid; gap: 3px; font-size: 13px; color: var(--muted); }
  .v43b-wt .r.ed label.wide { flex: 1; }
  .v43b-wt .v43-add { width: auto; margin: 12px 16px 0; }
  .v43-sev { display: inline-block; font-size: 13px; padding: 1px 9px; border-radius: 999px; font-weight: 700; }
  .v43-sev.e { background: var(--error-soft); color: var(--error); }
  .v43-sev.w { background: var(--warn-soft); color: var(--warn); }
  .v43b-try p { margin: 0 0 10px; font-size: 14px; color: var(--muted); line-height: 1.7; }
  .v43b-try .s { margin-top: 10px; padding: 10px 12px; border-radius: 8px; background: #faf9f6; border: 1px solid var(--line); line-height: 1.9; }
  .v43b-try mark { color: inherit; padding: 0 1px; border-radius: 2px; }
  .v43b-try mark.e { background: rgba(198, 40, 40, 0.14); color: #b71c1c; text-decoration: underline 2px solid #c62828; }
  .v43b-try mark.w { background: rgba(201, 138, 0, 0.16); text-decoration: underline 2px solid #c98a00; }
  .v43b-try dl { margin: 14px 0 0; display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; font-size: 14px; color: var(--muted); line-height: 1.6; }
  .v43b-try dt { padding-top: 1px; }
  .v43b-try dd { margin: 0; }
  /* 案B：先生の画面の右（ひな形の組み立て） */
  .v43b-outline { overflow: auto; background: var(--bg); padding: 0 20px 20px; }
  .v43b-paper { background: #fff; border-radius: 4px; box-shadow: 0 2px 10px rgba(0,0,0,.12); padding: 26px 30px 30px 40px; font-family: 'BIZ UDMincho', serif; font-size: 14px; line-height: 1.75; max-width: 560px; }
  .v43b-paper .ch { font-weight: 400; font-size: 15.5px; margin: 14px 0 2px; }
  .v43b-paper .ch:first-child { margin-top: 0; }
  .v43b-paper .sh { font-size: 14.5px; margin: 6px 0 0 1em; }
  .v43b-paper .p { color: #8a90a0; font-size: 13.5px; margin: 0 0 0 2em; }
  .v43b-paper .f { margin: 6px 0 4px 2em; display: grid; place-items: center; height: 62px; border: 1px dashed #b9b9b9; background: repeating-linear-gradient(45deg, #f6f6f6 0 8px, #efefef 8px 16px); color: #9a9a9a; font-family: 'BIZ UDPGothic', sans-serif; font-size: 13px; }

  /* ================= 案C 入口 ================= */
  .v43c-home { overflow: auto; background: var(--bg); padding: 26px 32px 40px; }
  .v43c-home .wrap { max-width: 1120px; margin: 0 auto; }
  .v43c-hello { display: flex; align-items: center; gap: 14px; margin: 0 0 4px; }
  .v43c-hello h1 { margin: 0; font-size: 22px; }
  .v43c-home .st { margin: 0 0 20px; font-size: 15px; color: var(--muted); }
  .v43c-home h2 { margin: 0 0 12px; font-size: 18px; }
  .v43c-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
  .v43c-card { display: grid; grid-template-columns: 46px minmax(0, 1fr) 20px; grid-template-rows: auto auto 1fr; gap: 2px 14px; align-items: start; text-align: left; padding: 18px 16px 16px 18px; border: 1px solid var(--line); border-radius: 14px; background: #fff; color: var(--ink); box-shadow: 0 1px 2px rgba(20, 30, 60, 0.04); min-height: 148px; }
  .v43c-card .ic { grid-row: 1 / 4; display: grid; place-items: center; width: 46px; height: 46px; border-radius: 12px; background: var(--accent-soft); color: var(--accent); }
  .v43c-card .ic svg { width: 26px; height: 26px; }
  .v43c-card b { grid-column: 2; font-size: 17.5px; line-height: 1.45; }
  .v43c-card .d { grid-column: 2; font-size: 14px; color: var(--muted); line-height: 1.65; }
  .v43c-card .s { grid-column: 2; align-self: end; margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
  .v43c-card .go { grid-column: 3; grid-row: 1; color: #9aa1ad; margin-top: 3px; }
  .v43c-card .go svg { width: 20px; height: 20px; }
  .v43c-card.big { border-color: #b9c4e6; background: linear-gradient(#fff, #f7f9fe); }
  .v43c-more { display: flex; align-items: center; gap: 18px; margin-top: 18px; padding: 12px 18px; border-radius: 12px; background: #fff; border: 1px solid var(--line); font-size: 14px; color: var(--muted); }
  .v43c-more .me { font-size: 13.5px; }
  /* 案C：作業の画面 */
  .v43c-focus { display: grid !important; grid-template-columns: 560px minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); min-height: 0; }
  .v43c-crumb { grid-column: 1 / -1; display: flex; align-items: center; gap: 14px; padding: 10px 22px; background: #fff; border-bottom: 1px solid var(--line); white-space: nowrap; }
  .v43c-crumb .back { display: inline-flex; align-items: center; gap: 4px; padding: 6px 12px 6px 8px; border: 1px solid #cfd5de; border-radius: 9px; background: #fff; color: var(--ink); font-size: 14.5px; }
  .v43c-crumb .back svg { width: 18px; height: 18px; }
  .v43c-crumb > b { font-size: 17px; }
  .v43c-steps { display: flex; align-items: center; gap: 6px; margin: 0 0 0 auto; padding: 0; list-style: none; }
  .v43c-steps li { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px 5px 6px; border-radius: 999px; font-size: 14px; color: var(--muted); }
  .v43c-steps li i { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; border: 1.5px solid #c4cad4; font-style: normal; font-size: 12.5px; font-weight: 700; }
  .v43c-steps li i svg { width: 14px; height: 14px; }
  .v43c-steps li.done { color: var(--ok); }
  .v43c-steps li.done i { border-color: var(--ok); background: var(--ok); color: #fff; }
  .v43c-steps li.now { background: var(--accent-soft); color: var(--accent); font-weight: 700; }
  .v43c-steps li.now i { border-color: var(--accent); background: var(--accent); color: #fff; }
  .v43c-steps .to { color: #c4cad4; }
  .v43c-steps .to svg { width: 14px; height: 14px; }
  .v43c-content { overflow: auto; padding: 22px 26px 60px; background: #f4f5f8; border-right: 1px solid var(--line); display: grid; gap: 16px; align-content: start; }
  .v43c-content > .v43-lead { margin: -12px 0 0; }
  .v43c-next { display: flex; align-items: center; gap: 10px; }
  .v43c-tabs { display: flex; gap: 8px; flex-wrap: wrap; }
  .v43c-tabs button { padding: 8px 16px; border-radius: 999px; border: 1px solid #cfd5de; background: #fff; font-size: 15px; color: var(--ink); }
  .v43c-tabs button.on { border-color: var(--accent); background: var(--accent); color: #fff; font-weight: 700; }
  .v43c-side { overflow: auto; background: var(--bg); padding: 0 24px 24px; }
  .v43c-student { max-width: 380px; margin: 4px auto 0; background: #fbfaf8; border: 1px solid #e2e0dc; border-radius: 12px; padding: 16px 0 18px; box-shadow: 0 2px 10px rgba(0,0,0,.06); font-size: 13px; color: #24262b; }
  .v43c-student .sh { padding: 0 18px 10px; font-size: 13px; color: #5d6068; display: flex; justify-content: space-between; }
  .v43c-student .nt { margin: 0 18px 14px; padding: 10px 13px; border-radius: 8px; background: #e8ebf5; line-height: 1.65; font-size: 13.5px; }
  .v43c-student .nt b { display: block; font-size: 12.5px; color: #2f3e75; letter-spacing: 0.06em; }
  .v43c-student .nt p { margin: 2px 0 0; }
  .v43c-student .ck { margin: 0 18px; padding-top: 10px; border-top: 1px solid #ecebe8; }
  .v43c-student .ck .h { font-size: 13px; font-weight: 700; margin-bottom: 8px; }
  .v43c-student .ck i { display: block; height: 9px; margin: 9px 0; border-radius: 5px; background: #ecebe8; }
  .v43c-student .ck i:nth-child(odd) { width: 78%; }
`

// =====================================================================
// 案A 整える：いまの並び（2段の見出し・左に入力・右に見本）のまま、見出しのあるまとまり・ラベルの列・大きい字。
// コースは閉じたカード（押すと開く）、詳細設定も閉じた1行。保存と公開は右上の1か所（となりに、いまの状態を書く）
// =====================================================================

/** 見出し（本物）の字を大きくし、ときどき使うリンクに絵を付け、保存のボタンのとなりに状態を書く */
async function restyleHeaderA(page, teacher = false) {
  await page.evaluate(
    (icons, teacher) => {
      const k = window.__v43
      document.querySelector('.admin').classList.add('v43a', 'v43-on-a')
      if (teacher) document.querySelector('.admin').style.setProperty('--head-h', '101px')
      const icon = { 変更履歴: icons.history, 先生の登録: icons.people, 新年度を作成: icons.plus }
      for (const b of document.querySelectorAll('.head-sub .link')) {
        const t = b.textContent.trim()
        if (icon[t]) b.insertAdjacentHTML('afterbegin', `<span class="v43-x" style="display:contents">${icon[t]}</span>`)
      }
      const save = [...document.querySelectorAll('.head-row .btn')].find((b) => b.textContent.startsWith('保存'))
      save.insertAdjacentHTML('beforebegin', '<span class="v43-x v43-status">変更はありません</span>')
      // 保存していない変更がないときは、押せないことが分かる色に（いまは薄い色で、見落としやすい）
      if (teacher) save.classList.remove('primary')
      void k
    },
    { history: IC.history, people: IC.people, plus: IC.plus },
    teacher,
  )
}

function formA(d, { open = null, details = false } = {}) {
  const c = d.config
  const crow = (x, i) => {
    const on = open === i
    return `<div class="v43a-crow${on ? ' on' : ''}">
      <div class="top">
        <span class="v43-grip" title="ドラッグで並べ替え">${GRIP}</span>
        <div class="main"><b>${esc(x.name)} コース</b><span class="adv">指導教員：${x.advisors.map(esc).join('、')}</span>${on ? '' : `<span class="chips">${courseChips(x, d)}</span>`}</div>
        <button class="v43-btn sub sm">${on ? '閉じる' : '開く'}</button>
      </div>
      ${
        on
          ? `<div class="body"><div class="v43-grid">
          ${row('コース名', `${courseName(x)}<div style="margin-top:8px">${showToggle(x)}</div>`)}
          ${row('サブタイトル', subtitle(x), { hint: subtitleExample(x) })}
          ${row('指導教員', advisors(x), { hint: '抄録に出ます', mark: isDirty(d, `advisors:${x.id}`) })}
          ${row('お知らせ', area(x.notice ?? '', '例：12月4日（金）の中間発表では、下書きを印刷して持ってきてください', 2), { sub: '任意', hint: NOTICE_HINT, mark: isDirty(d, `notice:${x.id}`) })}
          ${row('ひな形', tplLine(x), { sub: '下書き' })}
        </div>
        <div class="foot">公開したことのあるコースは、消せません。「学生に表示」を外します。</div></div>`
          : ''
      }
    </div>`
  }
  const detailsCard = details
    ? `<div class="v43-card" id="v43a-details">
        <h2 class="v43-sh"><span class="n">4</span>詳細設定<button class="v43-btn sub sm">閉じる</button></h2>
        <p class="v43-lead">ふだんは変えません。手順書が変わったときや、Google の障害のときに使います。</p>
        <h3 class="v43-h3" style="margin-top:4px">Google の障害のとき</h3>
        <div class="v43-grid">${row('ドライブ保存', '<div class="v43a-seg"><button class="on">必須（ふだん）</button><button>止める</button></div>', { sub: '学生の原稿', hint: '学生がログインできないときだけ「止める」にして保存します。' })}</div>
        <h3 class="v43-h3">表紙と抄録の言葉</h3>
        <div class="v43-grid">
          ${row('報告書の名前', inp(c.reportName))}
          ${row('表紙の見出し', inp(c.cover.heading))}
          ${row('題目の見出し', inp(c.cover.titleLabel), { sub: '表紙' })}
          ${row('抄録の見出し', inp(c.abstract.heading))}
          ${row('書き出しの例', inp(c.abstract.openingExample), { sub: '抄録', hint: '学生の抄録の欄に、薄く出します' })}
          ${row('大学名', inp(c.university))}
          ${row('学部名', inp(c.faculty))}
          ${row('学科名', inp(c.department))}
        </div>
        <h3 class="v43-h3">分量の決まり</h3>
        <div class="v43-grid">
          ${row('抄録の字数', `<span class="v43-range">${num(c.abstract.minChars)}〜${num(c.abstract.maxChars)}字</span>`)}
          ${row('抄録の行数', `<span class="v43-range">${num(c.abstract.minLines)}〜${num(c.abstract.maxLines)}行</span>`)}
          ${row('本文', `<span class="v43-range">${num(c.body.minPages)}ページ以上</span>`)}
          ${row('画像の目安', `<span class="v43-range">1ページに${num(c.body.imagesPerPageGuide)}枚</span>`)}
          ${row('作品写真', `<span class="v43-range">${num(c.workPhotos?.maxPages ?? '', '上限なし')}ページまで</span>`, { hint: '空なら上限なし（1ページに写真4枚まで）' })}
        </div>
        <h3 class="v43-h3">学籍番号</h3>
        <div class="v43-grid">${row('形式', inp(c.studentIdPattern ?? '', '例：^\\d{2}FA[A-Z]?\\d{3,4}$'), { sub: '正規表現', hint: '空なら確かめません' })}</div>
      </div>`
    : `<div class="v43-card">
        <h2 class="v43-sh"><span class="n">4</span>詳細設定</h2>
        <div class="v43a-line"><span>ふだんは変えません。表紙の言葉・抄録の字数・Google の障害のとき など</span><button class="v43-btn sub">開く</button></div>
      </div>`
  return `<section class="v43-x v43a-form">
    <div class="v43-card">
      <h2 class="v43-sh"><span class="n">1</span>この年度の基本</h2>
      <p class="v43-lead">表紙と抄録に入ります。毎年、かならず確かめます。</p>
      <div class="v43-grid">
        ${row('共通の題目', inp(c.commonTitle), { hint: '学生は変えられません' })}
        ${row('最終締切', `<input class="v43-in" type="date" value="${esc(c.deadline)}" style="width:220px">`, { mark: isDirty(d, 'deadline') })}
        ${row('手順書のリンク', inp(c.handbookUrl ?? '', 'https://drive.google.com/…'), { sub: '任意', hint: '学生のツールの上に「手順書」ボタンで出ます' })}
      </div>
    </div>
    <div class="v43-card">
      <h2 class="v43-sh"><span class="n">2</span>コースと指導教員</h2>
      <p class="v43-lead">押すと開いて、直せます。並べ替えは、左の ⋮⋮ をドラッグします。</p>
      <div class="v43a-courses">${d.courses.map(crow).join('')}</div>
      <button class="v43-add">${IC.plus}コースを追加</button>
    </div>
    <div class="v43-card">
      <h2 class="v43-sh"><span class="n">3</span>書き方のチェック</h2>
      <div class="v43a-line"><span>書き間違えやすい語　<b>${d.words.length}語</b>（エラー${d.words.filter((w) => w.severity === 'error').length}・要確認${d.words.filter((w) => w.severity !== 'error').length}）</span><button class="v43-btn sub">一覧を開く</button></div>
    </div>
    ${detailsCard}
  </section>`
}

/** 案A の入力の欄を入れる（入れ直すときは、前のものを外す） */
async function putFormA(page, d, opts) {
  await page.evaluate((html) => {
    document.querySelector('.v43a-form')?.remove()
    document.querySelector('.v43-resize')?.remove()
    const form = document.querySelector('.admin-main > .form')
    window.__v43.hide(form)
    form.insertAdjacentHTML('beforebegin', html)
  }, formA(d, opts))
  await resizeHandle(page, '.v43a-form')
}

async function aShots(browser) {
  const { context, page } = await openAdmin(browser, { vp: PC })
  const d = await getData(page)
  await page.evaluate((css) => window.__v43.css(css), DESIGN)
  await restyleHeaderA(page)
  await swapCaption(page, d)
  await putFormA(page, d)
  await settle(page)
  await countAs(page, 'a-admin')
  await screens(page, 'a-form-screens', '.v43a-form')
  await shot(page, 'a-main')
  // 保存していない変更があるところ（帯と、項目の印）
  const dd = await withChanges(page, d)
  await putFormA(page, dd)
  await page.evaluate(
    (bar, n) => {
      document.querySelector('.v43a-form').classList.add('v43-pad-bar')
      document.querySelector('.head-row .v43-status').textContent = `保存していない変更 ${n}か所`
      document.querySelector('.head-row .v43-status').classList.add('dirty')
      const save = [...document.querySelectorAll('.head-row .btn')].find((b) => b.textContent.startsWith('保存'))
      save.disabled = false
      save.classList.add('primary')
      window.__v43.add(bar)
    },
    dirtyBar(dd),
    dd.changes.length,
  )
  await sleep(300)
  await shot(page, 'a-dirty')
  await page.evaluate(() => {
    document.querySelector('.v43-bar').remove()
    document.querySelector('.head-row .v43-status').textContent = '変更はありません'
    document.querySelector('.head-row .v43-status').classList.remove('dirty')
    const save = [...document.querySelectorAll('.head-row .btn')].find((b) => b.textContent.startsWith('保存'))
    save.disabled = true
    save.classList.remove('primary')
  })
  // コースを開いたところ
  await putFormA(page, d, { open: 0 })
  await page.evaluate(() => {
    const f = document.querySelector('.v43a-form')
    f.scrollTop = document.querySelector('.v43a-crow.on').getBoundingClientRect().top - f.getBoundingClientRect().top - 16
  })
  await sleep(300)
  await shot(page, 'a-course')
  // 詳細設定を開いたところ
  await putFormA(page, d, { details: true })
  await page.evaluate(() => {
    const f = document.querySelector('.v43a-form')
    f.scrollTop = document.getElementById('v43a-details').getBoundingClientRect().top - f.getBoundingClientRect().top - 16
  })
  await sleep(300)
  await shot(page, 'a-details')

  // 先生の画面
  await reopen(page, 'teacher')
  const t = await getData(page)
  await page.evaluate((css) => window.__v43.css(css), DESIGN)
  await restyleHeaderA(page, true)
  await page.evaluate(
    (html) => {
      const m = document.querySelector('.teacher-main')
      window.__v43.hide(m)
      m.insertAdjacentHTML('afterend', html)
    },
    teacherA(t),
  )
  await parkMouse(page)
  await countAs(page, 'a-teacher')
  await shot(page, 'a-teacher')
  await context.close()
}

function teacherA(d) {
  const card = (x) => `<div class="v43-card">
      <h2 class="v43-sh">${IC.course}${esc(x.name)} コース</h2>
      <p class="v43-lead">指導教員：${x.advisors.map(esc).join('、')}</p>
      <div class="v43-grid">
        ${row('お知らせ', area(x.notice ?? '', '例：12月4日（金）の中間発表では、下書きを印刷して持ってきてください', 2), { sub: '任意', hint: NOTICE_HINT })}
        ${row('ひな形', tplLine(x), { sub: '下書き' })}
      </div>
    </div>`
  return `<main class="v43-x v43a-teacher">
    <div><h1 class="v43-h1">コースごとの、ひな形とお知らせ（${d.year}年度）</h1>
    <p class="v43-lead" style="margin:0">先生は、どのコースも直せます。直したら、右上の「${saveLabel(d.status)}」を押します。</p></div>
    ${d.courses.filter((x) => !x.hidden).map(card).join('')}
    <div class="v43-card">
      <h2 class="v43-sh">${IC.words}書き方のチェック</h2>
      <div class="v43a-line"><span>書き間違えやすい語　<b>${d.words.length}語</b>（エラー${d.words.filter((w) => w.severity === 'error').length}・要確認${d.words.filter((w) => w.severity !== 'error').length}）</span><button class="v43-btn sub">一覧を開く</button></div>
    </div>
  </main>`
}

// =====================================================================
// 案B 左の見出し：左に区切りの一覧（いつも同じ場所）。右には、選んだ区切りだけ。見本は、要る区切りだけ右の端に
// =====================================================================
const roman = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ']
const small = ['ⅰ', 'ⅱ', 'ⅲ', 'ⅳ', 'ⅴ', 'ⅵ', 'ⅶ', 'ⅷ']
const lastSaved = (d) => {
  const at = d.history[0]?.at
  if (!at) return 'まだありません'
  const t = new Date(at)
  return `最後：${t.getMonth() + 1}月${t.getDate()}日`
}
function navB(d, active, { teacher = false } = {}) {
  const yearCount = d.dirty?.filter((k) => k === 'deadline').length ?? 0
  const courseCount = d.dirty?.filter((k) => k.includes(':')).length ?? 0
  const item = (key, icon, title, sub, n = 0) => `<button class="${active === key ? 'on' : ''}">${icon}<span><b>${title}${n ? `<em class="v43-cnt" title="保存していない変更">${n}</em>` : ''}</b><small>${sub}</small></span></button>`
  const errs = d.words.filter((w) => w.severity === 'error').length
  return `<nav class="v43-x v43b-nav">
    ${teacher ? '' : item('year', IC.calendar, '年度の設定', '題目・締切・新年度', yearCount)}
    ${item('course', IC.course, 'コース', 'お知らせ・ひな形', courseCount)}
    ${item('words', IC.words, '書き方のチェック', `言葉 ${d.words.length}語（エラー${errs}）`)}
    ${
      teacher
        ? ''
        : `<div class="sep"></div>
    ${item('members', IC.people, '先生の登録', `${d.members.length}人`)}
    ${item('history', IC.history, '変更履歴', lastSaved(d))}
    ${item('details', IC.gear, '詳細設定', 'ふだんは変えません')}`
    }
    <div class="me">ログイン中<br>${esc(d.user)}${teacher ? '（先生）' : ''}<br><span class="v43-badge old">試験用サーバー</span></div>
  </nav>`
}
function yearB(d) {
  const c = d.config
  return `<section class="v43-x v43b-content">
    <h1 class="v43-h1">年度の設定</h1>
    <p class="v43-lead">${d.year}年度の、毎年変わる項目です。表紙と抄録に入ります（右の見本）。</p>
    <div class="v43-card"><div class="v43-grid">
      ${row('共通の題目', inp(c.commonTitle), { hint: '学生は変えられません' })}
      ${row('最終締切', `<input class="v43-in" type="date" value="${esc(c.deadline)}" style="width:220px">`, { mark: isDirty(d, 'deadline') })}
      ${row('手順書のリンク', inp(c.handbookUrl ?? '', 'https://drive.google.com/…'), { sub: '任意', hint: '学生のツールの上に「手順書」ボタンで出ます' })}
    </div></div>
    <div class="v43-card v43b-year">
      <h2 class="v43-sh">${IC.sprout}次の年度</h2>
      <p>この年度の設定をコピーして、${d.year + 1}年度を作ります。公開するまで、学生には見えません。</p>
      <button class="v43-btn sub">${IC.plus}新年度を作成</button>
    </div>
  </section>`
}
function courseCardB(d, x, { teacher = false } = {}) {
  const rows = teacher
    ? `${row('指導教員', `<div style="padding-top:7px">${x.advisors.map(esc).join('、')}</div>`)}
       ${row('お知らせ', area(x.notice ?? '', '例：12月4日（金）の中間発表では、下書きを印刷して持ってきてください', 3), { sub: '任意', hint: NOTICE_HINT, mark: isDirty(d, `notice:${x.id}`) })}
       ${row('ひな形', tplLine(x), { sub: '下書き', hint: '組み立ては右の見本のとおりです' })}`
    : `${row('コース名', `${courseName(x)}<div style="margin-top:8px">${showToggle(x)}</div>`)}
       ${row('指導教員', advisors(x), { hint: '抄録に出ます', mark: isDirty(d, `advisors:${x.id}`) })}
       ${row('お知らせ', area(x.notice ?? '', '例：12月4日（金）の中間発表では、下書きを印刷して持ってきてください', 2), { sub: '任意', hint: NOTICE_HINT, mark: isDirty(d, `notice:${x.id}`) })}
       ${row('ひな形', tplLine(x), { sub: '下書き' })}
       ${row('サブタイトル', subtitle(x), { hint: subtitleExample(x) })}`
  return `<div class="v43-card">
      <h2 class="v43-sh">${IC.course}${esc(x.name)} コース</h2>
      <div class="v43-grid" style="margin-top:12px">${rows}</div>
      ${teacher ? '' : '<div class="v43b-cfoot">公開したことのあるコースは、消せません。「学生に表示」を外します。</div>'}
    </div>`
}
function courseB(d, i = 0, { teacher = false } = {}) {
  const list = d.courses
    .filter((x) => !teacher || !x.hidden)
    .map(
      (x, j) =>
        `<div class="${j === i ? 'on' : ''}">${teacher ? '<span style="width:6px"></span>' : `<span class="v43-grip" title="ドラッグで並べ替え">${GRIP}</span>`}<button class="nm">${esc(x.name)} コース</button>${
          isDirty(d, `notice:${x.id}`) || isDirty(d, `advisors:${x.id}`) ? chip('変更あり', 'chg') : ''
        }</div>`,
    )
    .join('')
  return `<section class="v43-x v43b-content">
    <h1 class="v43-h1">コース</h1>
    <p class="v43-lead">${teacher ? 'コースを選んで、お知らせとひな形を直します。' : '学生が最初に選ぶコースです。選んで直します。並べ替えは ⋮⋮ をドラッグします。'}</p>
    <div class="v43b-clist">${list}${teacher ? '' : `<button class="v43-add" style="padding:5px;font-size:14.5px">${IC.plus}コースを追加</button>`}</div>
    ${courseCardB(d, d.courses[i], { teacher })}
  </section>`
}
function wordsB(d) {
  const sev = (w) => (w.severity === 'error' ? '<span class="v43-sev e">エラー</span>' : '<span class="v43-sev w">要確認</span>')
  const rows = d.words
    .map((w, i) =>
      i === 0
        ? `<div class="r ed">
            <div class="g"><label>書き間違い${inp(w.wrong)}</label><label>正しい語${inp(w.right)}</label><label>重さ<select class="v43-in"><option ${w.severity === 'error' ? 'selected' : ''}>エラー</option><option ${w.severity === 'error' ? '' : 'selected'}>要確認</option></select></label></div>
            <div class="g2"><label class="wide">説明（任意）${inp(w.note ?? '')}</label></div>
            <div class="g2"><button class="v43-btn sm danger">${IC.remove}この語を消す</button><span class="spacer"></span><button class="v43-btn sm">やめる</button><button class="v43-btn sm primary">反映する</button></div>
          </div>`
        : `<button class="r"><span>${esc(w.wrong)}</span><span class="ar">→</span><span>${esc(w.right)}</span><span>${sev(w)}</span><span class="nt">${esc(w.note ?? '')}</span></button>`,
    )
    .join('')
  return `<section class="v43-x v43b-content" style="border-right:0">
    <h1 class="v43-h1">書き方のチェック（言葉）</h1>
    <p class="v43-lead">学生のセルフチェックで指摘する、書き間違えやすい語です。行を押すと直せます。</p>
    <div class="v43b-words">
      <div class="v43-card v43b-wt" style="padding:0 0 14px">
        <div class="h"><span>書き間違い</span><span></span><span>正しい語</span><span>重さ</span><span>説明</span></div>
        ${rows}
        <button class="v43-add">${IC.plus}語を足す</button>
      </div>
      <aside class="v43-card v43b-try">
        <h2 class="v43-sh" style="font-size:16.5px;margin-bottom:6px">${IC.eye}試しに確かめる</h2>
        <p>文を入れると、いまの一覧で指摘される所に印が付きます。</p>
        ${inp('前見頃と後ろ身頃を縫い合わせ、記事を選んだ。')}
        <div class="s">前<mark class="e">見頃</mark>と後ろ身頃を縫い合わせ、<mark class="w">記事</mark>を選んだ。</div>
        <dl><dt><span class="v43-sev e">エラー</span></dt><dd>PDF の書き出しを止めます。学生は消せません。</dd><dt><span class="v43-sev w">要確認</span></dt><dd>知らせるだけです。文脈によっては正しい語に使います。</dd></dl>
      </aside>
    </div>
  </section>`
}
/** 学生が最初に見る本文の組み立て（先生の画面の右。ひな形の見本を、紙の形で） */
function outline(x) {
  let ch = -1
  let sh = 0
  let fig = 0
  let tab = 0
  const body = x.blocks
    .map((b) => {
      if (b.type === 'chapter') {
        ch++
        sh = 0
        return `<div class="ch">${roman[ch]}．${esc(b.title)}</div>`
      }
      if (b.type === 'subheading') return `<div class="sh">${small[sh++]}．${esc(b.title)}</div>`
      if (b.type === 'paragraph') return `<div class="p">（${esc(b.hint)}）</div>`
      if (b.type === 'figure') return `<div class="f">（学生が写真を入れる枠）</div><div class="p" style="color:#24262b;text-align:center;margin:0">図${++fig}．${esc(b.caption)}</div>`
      return `<div class="p" style="color:#24262b;text-align:center;margin:6px 0 0">表${++tab}．${esc(b.caption)}</div><div class="f" style="height:34px">（素材表）</div>`
    })
    .join('')
  return `<aside class="v43-x v43b-outline"><div class="v43-cap" style="padding-left:0"><b>見本</b><span>学生が最初に見る本文（${esc(x.name)} コース）</span></div><div class="v43b-paper">${body}</div></aside>`
}

/** 案B の画面にする（admin-main の中身を、左の見出し＋選んだ区切り＋見本に） */
async function putB(page, d, content, { wide = false } = {}) {
  await page.evaluate(
    (hd, nav, content, wide) => {
      const k = window.__v43
      document.querySelectorAll('.v43b-nav, .v43b-content, .v43-hd, .v43-resize, .v43-bar').forEach((e) => e.remove())
      const admin = document.querySelector('.admin')
      admin.classList.add('v43-on-hd')
      const H = document.querySelector('.admin-header')
      k.hide(H)
      H.insertAdjacentHTML('afterend', hd)
      const main = document.querySelector('.admin-main')
      main.classList.add('v43b-main')
      main.classList.toggle('wide', wide)
      k.hide(main.querySelector('.form'))
      const stage = main.querySelector('.stage')
      if (wide) k.hide(stage)
      else stage.removeAttribute('data-v43-hidden')
      main.insertAdjacentHTML('afterbegin', nav + content)
    },
    header(d),
    navB(d, content.key),
    content.html,
    wide,
  )
  if (!wide) await resizeHandle(page, '.v43b-content')
  await settle(page)
}

async function bShots(browser) {
  const { context, page } = await openAdmin(browser, { vp: PC })
  const d = await getData(page)
  await page.evaluate((css) => window.__v43.css(css), DESIGN)
  await swapCaption(page, d)
  await putB(page, d, { key: 'year', html: yearB(d) })
  await countAs(page, 'b-admin')
  await screens(page, 'b-content-screens', '.v43b-content')
  await shot(page, 'b-main')
  // 大きい画面（1920×1080）
  await page.setViewport(BIG)
  await page.evaluate(() => document.querySelector('.v43-resize')?.remove())
  await resizeHandle(page, '.v43b-content')
  await settle(page)
  await shot(page, 'b-main-1920')
  await page.setViewport(PC)
  await page.evaluate(() => document.querySelector('.v43-resize')?.remove())
  await resizeHandle(page, '.v43b-content')
  await settle(page)
  // 保存していない変更があるところ
  const dd = await withChanges(page, d)
  await putB(page, dd, { key: 'year', html: yearB(dd) })
  await page.evaluate((bar) => {
    document.querySelector('.v43b-content').classList.add('v43-pad-bar')
    document.querySelector('.v43b-nav').classList.add('v43-pad-bar')
    window.__v43.add(bar)
  }, dirtyBar(dd))
  await shot(page, 'b-dirty')
  // コース
  await putB(page, d, { key: 'course', html: courseB(d, 0) })
  await shot(page, 'b-course')
  // 書き方のチェック（言葉）
  await putB(page, d, { key: 'words', html: wordsB(d) }, { wide: true })
  await shot(page, 'b-words')

  // 先生の画面
  await reopen(page, 'teacher')
  const t = await getData(page)
  await page.evaluate((css) => window.__v43.css(css), DESIGN)
  await page.evaluate(
    (hd, html) => {
      const k = window.__v43
      const admin = document.querySelector('.admin')
      admin.classList.add('v43-on-hd')
      k.hide(document.querySelector('.admin-header'))
      k.hide(document.querySelector('.teacher-main'))
      admin.insertAdjacentHTML('beforeend', hd + html)
    },
    header(t, { teacher: true }),
    `<main class="v43-x v43b-main">${navB(t, 'course', { teacher: true })}${courseB(t, 0, { teacher: true })}${outline(t.courses[0])}</main>`,
  )
  await resizeHandle(page, '.v43b-content')
  await parkMouse(page)
  await countAs(page, 'b-teacher')
  await shot(page, 'b-teacher')
  await context.close()
}

// =====================================================================
// 案C 入口：はじめは「すること」のカードだけ。押すと、その作業だけの画面（上に「はじめの画面」へ戻るボタン）
// =====================================================================
function homeC(d, { teacher = false } = {}) {
  const card = (icon, title, desc, status, big = false) =>
    `<button class="v43c-card${big ? ' big' : ''}"><span class="ic">${icon}</span><b>${title}</b><span class="go">${IC.next}</span><span class="d">${desc}</span><span class="s">${status}</span></button>`
  const withNotice = d.courses.filter((x) => x.notice).length
  const own = d.courses.filter((x) => x.own).length
  const pub = d.status === '公開中'
  const cards = [
    teacher ? '' : card(IC.sprout, '新年度の準備', '次の年度を作り、題目・締切・指導教員を直して、学生に公開します。', chip('年に1回（3月ごろ）'), true),
    card(IC.notice, 'コースのお知らせを書く', 'コースの学生に、知らせたいことを書きます。', chip(`お知らせあり ${withNotice}／${d.courses.length}コース`, 'acc')),
    card(IC.template, 'ひな形を直す', '学生が最初に見る本文の組み立てを、コースごとに直します。', chip(`独自 ${own}・標準 ${d.courses.length - own}`, 'acc')),
    card(IC.words, '書き間違えやすい語を直す', 'セルフチェックで指摘する語を、足したり直したりします。', chip(`${d.words.length}語`, 'acc')),
    teacher ? '' : card(IC.people, '先生を登録する', '管理ページを使える先生を足します。', chip(`${d.members.length}人`, 'acc')),
    teacher ? '' : card(IC.eye, '設定を確かめる', '題目・締切・コースを、表紙の見本といっしょに見て直します。', chip('表紙と抄録の見本つき', 'acc')),
  ].join('')
  return `<section class="v43-x v43c-home">
    <div class="wrap">
      <div class="v43c-hello"><h1>${d.year}年度</h1><span class="v43-badge ${STATUS_CLASS(d.status)}">${d.status}</span></div>
      <p class="st">${pub ? '学生に公開しています。直して保存すると、学生のツールに届きます。' : 'まだ学生には見えていません。'}</p>
      <h2>何をしますか？</h2>
      <div class="v43c-cards">${cards}</div>
      <div class="v43c-more">${teacher ? '' : `<span>ほかに</span><button class="v43-link">${IC.history}変更履歴</button><button class="v43-link">${IC.gear}詳細設定（Google の障害のとき など）</button>`}<span class="spacer"></span><span class="me">ログイン中：${esc(d.user)}${teacher ? '（先生）' : ''}</span><span class="v43-badge old">試験用サーバー</span></div>
    </div>
  </section>`
}
function crumbC(title, steps = '') {
  return `<div class="v43-x v43c-crumb"><button class="back">${IC.back}はじめの画面</button><b>${title}</b>${steps}</div>`
}
const STEPS = (now) => {
  const names = ['新年度を作る', '題目と締切', 'コースと指導教員', 'お知らせ・ひな形', '学生に公開']
  return `<ol class="v43c-steps">${names
    .map((n, i) => `${i ? `<span class="to">${IC.next}</span>` : ''}<li class="${i < now ? 'done' : i === now ? 'now' : ''}"><i>${i < now ? IC.checkBold : i + 1}</i>${n}</li>`)
    .join('')}</ol>`
}
function newYearC(d) {
  const c = d.config
  return `<section class="v43-x v43c-content">
    <h1 class="v43-h1">題目と締切</h1>
    <p class="v43-lead">${d.year - 1}年度のままです。${d.year}年度の内容に直してください。</p>
    <div class="v43-card"><div class="v43-grid">
      ${row('共通の題目', inp(c.commonTitle), { warn: `${d.year - 1}年度と同じです` })}
      ${row('最終締切', `<input class="v43-in" type="date" value="${esc(c.deadline)}" style="width:220px">`, { warn: `${d.year}年度（${d.year}年4月〜${d.year + 1}年3月）の外です` })}
      ${row('手順書のリンク', inp(c.handbookUrl ?? '', 'https://drive.google.com/…'), { sub: '任意', hint: '学生のツールの上に「手順書」ボタンで出ます' })}
    </div></div>
    <div class="v43c-next"><button class="v43-btn">${IC.back}新年度を作る</button><span class="spacer"></span><button class="v43-btn primary big">次へ：コースと指導教員${IC.next}</button></div>
  </section>`
}
function noticeC(d, i = 0) {
  const x = d.courses[i]
  return `<section class="v43-x v43c-content">
    <p class="v43-lead" style="margin:0">コースを選んで書きます。右は、学生の画面での見え方です。</p>
    <div class="v43c-tabs">${d.courses.map((y, j) => `<button class="${j === i ? 'on' : ''}">${esc(y.name)}</button>`).join('')}</div>
    <div class="v43-card"><div class="v43-grid">
      ${row('お知らせ', area(x.notice ?? '', '例：12月4日（金）の中間発表では、下書きを印刷して持ってきてください', 5), { sub: '任意', hint: NOTICE_HINT, mark: isDirty(d, `notice:${x.id}`) })}
    </div></div>
  </section>`
}
function studentSideC(d, i = 0) {
  const x = d.courses[i]
  return `<aside class="v43-x v43c-side"><div class="v43-cap" style="padding-left:0"><b>学生の画面での見え方</b><span>（見本）</span></div>
    <div class="v43c-student"><div class="sh"><span>右の欄の上のほう</span></div>
      ${x.notice ? `<div class="nt"><b>コースからのお知らせ</b><p>${esc(x.notice)}</p></div>` : '<div class="nt" style="background:#f1f0ed;color:#8a8d94">お知らせがないときは、何も出ません</div>'}
      <div class="ck"><div class="h">セルフチェック</div><i></i><i></i><i></i><i></i><i></i></div>
    </div></aside>`
}

/** 案C の画面にする（見出しを差し替え、admin-main の中身を入れる） */
async function putC(page, d, html, { cols = '', stage = false, pad = false, quietPublish = false } = {}) {
  await page.evaluate(
    (hd, html, cols, stage) => {
      const k = window.__v43
      document.querySelectorAll('.v43c-home, .v43c-crumb, .v43c-content, .v43c-side, .v43-hd, .v43-resize, .v43-bar').forEach((e) => e.remove())
      const admin = document.querySelector('.admin')
      admin.classList.add('v43-on-hd')
      const H = document.querySelector('.admin-header')
      k.hide(H)
      H.insertAdjacentHTML('afterend', hd)
      const main = document.querySelector('.admin-main')
      k.hide(main.querySelector('.form'))
      const st = main.querySelector('.stage')
      if (stage) st.removeAttribute('data-v43-hidden')
      else k.hide(st)
      main.classList.toggle('v43c-focus', !!cols)
      main.style.gridTemplateColumns = cols || '1fr'
      main.insertAdjacentHTML('afterbegin', html)
    },
    header(d, { quietPublish }),
    html,
    cols,
    stage,
  )
  if (pad) await page.evaluate(() => document.querySelector('.v43c-content')?.classList.add('v43-pad-bar'))
  await settle(page)
}

async function cShots(browser) {
  const { context, page } = await openAdmin(browser, { vp: PC })
  const d = await getData(page)
  await page.evaluate((css) => window.__v43.css(css), DESIGN)
  await putC(page, d, homeC(d))
  await countAs(page, 'c-admin')
  await shot(page, 'c-home')
  // コースのお知らせを書く（書いている途中＝保存していない変更があるところ）
  const dd = await withChanges(page, d)
  await putC(page, dd, crumbC('コースのお知らせを書く') + noticeC(dd, 0) + studentSideC(dd, 0), { cols: '560px minmax(0, 1fr)', pad: true })
  await resizeHandle(page, '.v43c-content')
  await page.evaluate((bar) => window.__v43.add(bar), dirtyBar(dd))
  await shot(page, 'c-notice')
  await context.close()

  // 新年度の準備（2027年度を作ったところ。2つ目の手順）
  const ny = await openAdmin(browser, { vp: PC, year2027: true, open: 2027 })
  const n = await getData(ny.page)
  await ny.page.evaluate((css) => window.__v43.css(css), DESIGN)
  await swapCaption(ny.page, n)
  await putC(ny.page, n, crumbC('新年度の準備', STEPS(1)) + newYearC(n), { cols: '560px minmax(0, 1fr)', stage: true, quietPublish: true })
  await resizeHandle(ny.page, '.v43c-content')
  await shot(ny.page, 'c-newyear')

  // 先生の画面
  await ny.page.evaluate(() => localStorage.setItem('sotsugyo-admin-year', '2026'))
  await reopen(ny.page, 'teacher')
  const t = await getData(ny.page)
  await ny.page.evaluate((css) => window.__v43.css(css), DESIGN)
  await ny.page.evaluate(
    (hd, html) => {
      const k = window.__v43
      const admin = document.querySelector('.admin')
      admin.classList.add('v43-on-hd')
      k.hide(document.querySelector('.admin-header'))
      k.hide(document.querySelector('.teacher-main'))
      admin.insertAdjacentHTML('beforeend', hd + html)
    },
    header(t, { teacher: true }),
    homeC(t, { teacher: true }),
  )
  await parkMouse(ny.page)
  await countAs(ny.page, 'c-teacher')
  await shot(ny.page, 'c-teacher')
  await ny.context.close()
}

// =====================================================================
// 一覧のページ（mockups/v43/review.html）を1枚の画像にする（shots/review-admin.png）
// =====================================================================
async function reviewShots(browser) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 })
  await page.goto(`${REVIEW_APP}/${DIR}/review.html`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  await sleep(600)
  // 1字だけの行がないか（書き足した言葉すべて）
  await installKit(page)
  const lonely = await page.evaluate(() => window.__v43.lonely('main'))
  if (lonely.length) console.log('  ！一覧のページに1字だけの行：', lonely.join(' ／ '))
  else console.log('  1字だけの行：なし')
  await page.screenshot({ path: `${OUT}/review-admin.png`, fullPage: true })
  console.log('✓ review-admin')
  await page.close()
}

await withEdge(async (browser) => {
  if (want('now')) await nowShots(browser)
  if (want('a')) await aShots(browser)
  if (want('b')) await bShots(browser)
  if (want('c')) await cShots(browser)
  if (want('review')) await reviewShots(browser)
})
