// デザイン案 v39（スマホの「戻す」「やり直す」を、段落をタップしていないときにも押せるようにする：依頼者の希望）を画像に書き出す。
// いまのスマホでは、「戻す」「やり直す」は、段落をタップすると出る書く欄（src/app/Phone.tsx の .es-undo）の中にしかない。
// 置き場所の3案：案A 上の帯（≡ の左に ↶ ↷）・案B ページ送りの両わき（丸いボタン）・案C 下のタブ（5つ目の場所に「戻す」「やり直す」）。
// 本物の学生用ツール（開発サーバー。Google のログインとドライブは偽物：scripts/video/session.mjs の openTool）を開き、見本の原稿で、
// 案の部品だけを画面に書き足して写す（src/ は変えない）。ボタンが押せるか（灰色か）は、本物の editor の canUndo・canRedo のとおり。
// できるもの：mockups/v39/shots/*.png（案の画面）と、shots/review-undo-phone.png（一覧のページ mockups/v39/review.html の写し）
// 使い方: node scripts/mockup-shots-v39.mjs [phone] [review]（何も付けなければ全部。開発サーバーが http://localhost:5173 で動いていること）
//   phone ：いま・案A・案B・案C（何も選んでいないとき・書く欄を開いたとき・iPhone の下のホームバーの所をあけたとき・近くで）、
//           案A の上の帯の、保存のようすの言葉ごとの絵（390px・375px・360px）と横向き、案B の拡大したときと作品写真のページ
//   review：一覧のページ（mockups/v39/review.html）を画像にする
//   Edge は EDGE_PORT（ふだんは 9591）で起動する
import { mkdirSync } from 'node:fs'

process.env.EDGE_PORT ??= '9591'
const { withEdge } = await import('./poc/edge.mjs')
const { openTool, ready, VIEWPORTS } = await import('./video/session.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const DIR = 'mockups/v39'
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })
const ONLY = process.argv.slice(2)
const want = (k) => ONLY.length === 0 || ONLY.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** スマホ（390×844。いままでの案と同じ）・横向き・iPhone SE（375px）・小さい Android（360px） */
const PHONE = VIEWPORTS.phone
const LAND = { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const SE = { width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const SMALL = { width: 360, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
/** iPhone の画面の下の、ホームバーの所の高さ（縦向き。CSS px） */
const SAFE = 34
/** 段落をタップして書く欄を開くときの段落（本文 3ページ。図の下の段落） */
const PARA = 'p9'

// ---- アイコン（src/app/icons.tsx の undo・redo と同じ線） ----
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const IC = {
  undo: svg('<path d="M9 7.5L5 11.5l4 4M5 11.5h9.5a4.5 4.5 0 010 9H12"/>'),
  redo: svg('<path d="M15 7.5l4 4-4 4M19 11.5H9.5a4.5 4.5 0 000 9H12"/>'),
}

/** 案の部品の見た目。色と書体は src/tokens.css・src/index.css のもの */
const CSS = `
  .v39-x { box-sizing: border-box; }
  .v39-x * { box-sizing: border-box; }
  .v39-fixed { position: fixed; }
  [data-v39-hidden] { display: none !important; }
  .v39-x button, button.v39-x { font-family: inherit; }
  .v39-x svg { flex: none; }

  /* ===== 案A：上の帯。≡ の左に「戻す」「やり直す」（絵の下に小さな名前）。帯の部品の間を 9px → 6px に、右の余白を 4px → 2px に詰め、
     「やり直す」と ≡ はすき間なしで並べる（絵と絵の間は、どちらも 22px ほど） ===== */
  .p-top.v39-a { gap: 6px; padding-right: 2px; }
  .v39-hdr { display: flex; flex: none; align-items: center; margin-right: -6px; }
  .v39-hb { width: 44px; height: 44px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; padding: 0; border: 0; border-radius: 10px; background: none; color: var(--ink); font-size: 10.5px; line-height: 1.2; letter-spacing: -0.02em; white-space: nowrap; }
  .v39-hb svg { width: 21px; height: 21px; }
  /* 保存のようすの点・雲のマークは縮めない（入りきらないときに、点がつぶれて線になっていた） */
  .p-top.v39-a .chip :is(.dot, svg) { flex: none; }
  /* 幅の狭いスマホ（360px ほど）：左の「卒」のマークを出さない（保存のようすが切れないように） */
  @media (max-width: 370px) { .p-top.v39-a .mark { display: none; } }

  /* ===== 案B：ページ送りの両わきに、丸いボタン（ページ送りと同じ白い札。絵の下に小さな名前） ===== */
  /* ページ送りの真ん中の幅を一定にする（ページを送っても、両わきのボタンが動かないように） */
  .pager.v39-b .lbl { min-width: 118px; text-align: center; }
  .v39-rb { z-index: 10; width: 52px; height: 52px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; padding: 2px 0 0; border: 1px solid var(--line); border-radius: 50%; background: rgba(255, 255, 255, 0.95); box-shadow: var(--float-shadow); color: var(--ink); font-size: 10.5px; line-height: 1.2; letter-spacing: -0.02em; white-space: nowrap; }
  .v39-rb svg { width: 20px; height: 20px; }
  /* 押せないとき：ボタン全体を薄くせず、中の絵と字だけを薄く（札の白は残す） */
  .v39-rb:disabled { opacity: 1; color: rgba(35, 38, 43, 0.32); }
  /* 拡大していて、ページ送りがないとき：左下に2つ並べる（右下は「ページ全体に戻す」） */
  .v39-rpair { z-index: 10; display: flex; gap: 2px; padding: 3px; border: 1px solid var(--line); border-radius: 999px; background: rgba(255, 255, 255, 0.95); box-shadow: var(--float-shadow); }
  .v39-rpair button { width: 48px; height: 44px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; padding: 0; border: 0; border-radius: 22px; background: none; color: var(--ink); font-size: 10.5px; line-height: 1.2; letter-spacing: -0.02em; white-space: nowrap; }
  .v39-rpair button svg { width: 20px; height: 20px; }

  /* ===== 案C：下のタブの5つ目の場所に「戻す」「やり直す」（ほかのタブと同じ形：絵の下に名前）。左に細い区切りの線 ===== */
  .p-nav.v39-nav5 { grid-template-columns: repeat(4, minmax(0, 1fr)) auto; padding-right: 4px; }
  /* タブが細くなる分、ボタンの中の余白をなくし、名前は1行のまま（「ページ一覧」が「ページ一／覧」にならないように） */
  .p-nav.v39-nav5 button { padding: 0; white-space: nowrap; }
  .v39-navur { position: relative; display: flex; padding-left: 1px; }
  .v39-navur::before { content: ''; position: absolute; left: 0; top: 13px; bottom: 13px; width: 1px; background: var(--line); }
  .p-nav .v39-navur button { width: 52px; white-space: nowrap; }
  .p-nav.v39-nav5.v39-editing .v39-navur { visibility: hidden; }

  /* ===== iPhone：画面の下のホームバーの所（${SAFE}px）をあける（下のタブを高くし、ページ送り・道具・書く欄・知らせを、その分上げる） ===== */
  html.v39-iphone .app.phone { grid-template-rows: 48px minmax(0, 1fr) calc(62px + ${SAFE}px); }
  html.v39-iphone .app.phone .p-nav { padding-bottom: ${SAFE}px; }
  html.v39-iphone .pager, html.v39-iphone .unzoom, html.v39-iphone .undo-area { bottom: calc(62px + ${SAFE}px + 12px); }
  html.v39-iphone .app.phone .sel-bar { bottom: calc(62px + ${SAFE}px + 12px + 52px + 8px); }
  html.v39-iphone .app.phone .edit-sheet { bottom: max(var(--kb, 0px), calc(62px + ${SAFE}px)); }
  .v39-homebar { z-index: 200; left: 50%; bottom: 8px; width: 134px; height: 5px; margin-left: -67px; border-radius: 3px; background: #1b1c1f; pointer-events: none; }
`

/** ページの中で使う道具（部品を足す・隠す・書き換える・元に戻す。v38 と同じ形）と、案ごとの部品 */
async function installKit(page) {
  await page.evaluate(
    ({ css, IC }) => {
      const style = document.createElement('style')
      style.id = 'v39-style'
      style.textContent = css
      document.head.append(style)
      const lastText = (el) => [...el.childNodes].reverse().find((n) => n.nodeType === 3 && n.nodeValue.trim())
      const snap = () => window.__editor.getSnapshot()
      /** 「戻す」「やり直す」のボタン（押せるかは本物の editor のとおり） */
      const pair = (cls) => {
        const s = snap()
        return (
          `<button class="${cls}" aria-label="元に戻す"${s.canUndo ? '' : ' disabled'}>${IC.undo}<span>戻す</span></button>` +
          `<button class="${cls}" aria-label="やり直す"${s.canRedo ? '' : ' disabled'}>${IC.redo}<span>やり直す</span></button>`
        )
      }
      const k = {
        add(html) {
          document.body.insertAdjacentHTML('beforeend', html)
          return document.body.lastElementChild
        },
        hide(el) {
          el?.setAttribute('data-v39-hidden', '')
        },
        /** 本物の部品を隠して、すぐ後ろに案の部品を置く（React が作った部品の中身は書き換えない） */
        swap(el, html) {
          el.setAttribute('data-v39-hidden', '')
          el.insertAdjacentHTML('afterend', html)
          return el.nextElementSibling
        },
        after(el, html, before = false) {
          el.insertAdjacentHTML(before ? 'beforebegin' : 'afterend', html)
          return before ? el.previousElementSibling : el.nextElementSibling
        },
        cls(el, add = [], remove = []) {
          if (!el.hasAttribute('data-v39-class')) el.setAttribute('data-v39-class', el.className)
          el.classList.remove(...remove)
          el.classList.add(...add)
        },
        label(el, text) {
          const n = lastText(el)
          if (!el.hasAttribute('data-v39-label')) el.setAttribute('data-v39-label', n.nodeValue)
          n.nodeValue = text
        },
        clear() {
          document.querySelectorAll('.v39-x').forEach((e) => e.remove())
          document.querySelectorAll('[data-v39-hidden]').forEach((e) => e.removeAttribute('data-v39-hidden'))
          document.querySelectorAll('[data-v39-class]').forEach((e) => {
            e.className = e.getAttribute('data-v39-class')
            e.removeAttribute('data-v39-class')
          })
          document.querySelectorAll('[data-v39-label]').forEach((e) => {
            lastText(e).nodeValue = e.getAttribute('data-v39-label')
            e.removeAttribute('data-v39-label')
          })
        },

        // ---- 案A：上の帯（書く欄を開いているときは出さない：いまの帯のまま） ----
        a() {
          if (snap().editingId) return
          const top = document.querySelector('.p-top')
          k.cls(top, ['v39-a'])
          k.after(top.querySelector('.icon-btn'), `<span class="v39-x v39-hdr">${pair('v39-hb')}</span>`, true)
        },
        /**
         * 案A の保存のようすを、言葉を変えた案の部品にする。kind：ok（雲のマーク。check：保存したときのチェック付き）・ng（赤い点）・warn（黄色の点）・busy（灰色の点）・save（ドライブを止めているときの緑の点）。
         */
        chip(kind, text, check = true) {
          const real = document.querySelector('.p-top .chip:not(.v39-x)')
          const cloud = real.querySelector('svg')?.outerHTML.replace(check ? /$^/ : /<path d="M9\.4[^>]*><\/path>/, '') ?? ''
          const mark = kind === 'ok' ? cloud : kind === 'save' ? '<i class="dot"></i>' : `<i class="dot ${kind}"></i>`
          const cls = kind === 'save' ? 'chip saved' : kind === 'busy' ? 'chip' : `chip ${kind}`
          k.swap(real, `<span class="v39-x ${cls}">${mark}${text}</span>`)
        },
        /** 保存のようすが、帯に入りきらずに切れているか */
        chipCut() {
          const c = [...document.querySelectorAll('.p-top .chip')].find((e) => e.offsetWidth)
          return c ? { cut: c.scrollWidth > c.clientWidth + 0.5, need: c.scrollWidth, room: c.clientWidth, text: c.textContent } : null
        },
        /** いまの保存のようすの時刻（偽物のドライブに保存した時刻。ほかの言葉の絵にも使う） */
        time() {
          return document.querySelector('.p-top .chip')?.textContent.match(/\d{1,2}:\d{2}/)?.[0] ?? '12:34'
        },

        // ---- 案B：ページ送りの両わき（ページ送りがないとき：拡大している・書く欄を開いている） ----
        b() {
          const s = snap()
          if (s.editingId) return
          const pager = document.querySelector('.pager')
          if (pager) {
            k.cls(pager, ['v39-b'])
            const r = pager.getBoundingClientRect()
            const top = r.top + r.height / 2 - 26
            const [u, re] = pair('v39-rb').split('</button>').filter(Boolean).map((h) => `${h}</button>`)
            k.add(u.replace('class="v39-rb"', `class="v39-x v39-fixed v39-rb" style="left:${r.left - 8 - 52}px;top:${top}px"`))
            k.add(re.replace('class="v39-rb"', `class="v39-x v39-fixed v39-rb" style="left:${r.right + 8}px;top:${top}px"`))
            return
          }
          // 拡大しているとき：左下に2つ並べる（「ページ全体に戻す」と同じ高さ）
          const un = document.querySelector('.unzoom')
          if (!un) return
          const r = un.getBoundingClientRect()
          const g = k.add(`<div class="v39-x v39-fixed v39-rpair">${pair('')}</div>`)
          g.style.left = '12px'
          g.style.top = `${r.top + r.height / 2 - g.offsetHeight / 2}px`
        },

        // ---- 案C：下のタブ（書く欄を開いているときは隠す。ほかの4つのタブは動かさない） ----
        c() {
          const nav = document.querySelector('.p-nav')
          k.cls(nav, ['v39-nav5', ...(snap().editingId ? ['v39-editing'] : [])])
          nav.insertAdjacentHTML('beforeend', `<span class="v39-x v39-navur">${pair('')}</span>`)
        },

        /** iPhone：画面の下のホームバーの所をあける（on：あける・外す） */
        iphone(on) {
          document.documentElement.classList.toggle('v39-iphone', on)
          document.querySelectorAll('.v39-homebar').forEach((e) => e.remove())
          if (on) k.add('<div class="v39-x v39-fixed v39-homebar"></div>')
          window.__editor.refitPage()
        },
      }
      window.__v39 = k
    },
    { css: CSS, IC },
  )
}

/**
 * 確かめ：横にはみ出していないか・案の部品が画面の外に出ていないか・案のボタンが 44px 四方より小さくないか・文字がボタンからはみ出していないか・
 * 案の部品が、ほかの部品（ページ送り・「ページ全体に戻す」・下のタブ・紙面の下の帯・作品写真の道具）に重なっていないか
 */
const audit = (page, name) =>
  page
    .evaluate(() => {
      const bad = []
      if (document.documentElement.scrollWidth > innerWidth + 1) bad.push(`横にはみ出している（${document.documentElement.scrollWidth}px）`)
      const mine = [...document.querySelectorAll('.v39-x')].filter((e) => e.offsetWidth && getComputedStyle(e).visibility !== 'hidden')
      for (const el of mine) {
        const r = el.getBoundingClientRect()
        if (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1 || r.top < -1) bad.push(`画面の外：${el.className}`)
      }
      const buttons = mine.flatMap((e) => (e.matches('button') ? [e] : [...e.querySelectorAll('button')]))
      for (const b of buttons) {
        const r = b.getBoundingClientRect()
        if (r.width < 43.5 || r.height < 43.5) bad.push(`小さい（${Math.round(r.width)}×${Math.round(r.height)}）：${b.textContent}`)
        if (b.scrollWidth > b.clientWidth + 1) bad.push(`文字がはみ出す：${b.textContent}`)
      }
      // 名前が2行に折り返していないか（下のタブ・案のボタン）
      for (const b of [...document.querySelectorAll('.p-nav button'), ...buttons].filter((e) => e.offsetWidth && getComputedStyle(e.closest('.v39-navur') ?? e).visibility !== 'hidden')) {
        const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.nodeValue.trim()) continue
          const r = document.createRange()
          r.selectNodeContents(n)
          const tops = new Set([...r.getClientRects()].map((q) => Math.round(q.top)))
          if (tops.size > 1) bad.push(`名前が折り返す：${n.nodeValue}`)
        }
      }
      const others = [...document.querySelectorAll('.pager, .unzoom, .p-nav button, .page-band, .sel-bar .group, .p-top .chip, .p-top .icon-btn, .p-title')].filter((e) => e.offsetWidth && !e.closest('[data-v39-hidden]'))
      for (const b of buttons) {
        const r = b.getBoundingClientRect()
        for (const o of others) {
          if (o.contains(b) || b.contains(o)) continue
          const q = o.getBoundingClientRect()
          if (r.left < q.right - 0.5 && r.right > q.left + 0.5 && r.top < q.bottom - 0.5 && r.bottom > q.top + 0.5) bad.push(`重なる：${b.textContent} と ${o.className || o.textContent}`)
        }
      }
      return bad
    })
    .then((bad) => bad.length && console.log(`  ！${name}：${bad.join(' ／ ')}`))

/** 撮る。clip：写す範囲（画面の座標。ページの中で求める関数でもよい。なければ画面全体） */
async function shot(page, name, clip) {
  await page.evaluate(() => document.fonts.ready)
  await sleep(300)
  await audit(page, name)
  const box = typeof clip === 'function' ? await page.evaluate(clip) : clip
  await page.screenshot({ path: `${OUT}/${name}.png`, captureBeyondViewport: false, ...(box ? { clip: box } : {}) })
  console.log('✓', name)
}

/** 写す範囲 */
const HEADER = () => ({ x: 0, y: 0, width: innerWidth, height: 48 })
const BOTTOM = () => {
  const p = document.querySelector('.pager, .unzoom').getBoundingClientRect()
  const y = Math.max(0, p.top - 18)
  return { x: 0, y, width: innerWidth, height: innerHeight - y }
}
const NAV = () => {
  const n = document.querySelector('.p-nav').getBoundingClientRect()
  const y = n.top - 16
  return { x: 0, y, width: innerWidth, height: innerHeight - y }
}

/** 本文 3ページ（書く欄を開く段落のページ）を、1ページ全体の表示で出す */
async function showPage(page) {
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), PARA)
  await sleep(400)
  await ready(page)
  await page.evaluate(() => window.__editor.setZoom(false))
  await sleep(400)
  await ready(page)
}

/** 段落をタップしたときと同じく、書く欄を開く（キーボードは出ない。書く欄から外に移ると閉じるので、そのままにする） */
async function openSheet(page) {
  await page.evaluate((id) => window.__editor.openEditor(id, 27), PARA)
  await sleep(900)
}
async function closeSheet(page) {
  await page.evaluate(() => window.__editor.finishEditing())
  await sleep(700)
  await ready(page)
}

const mock = (page, fn, ...args) => page.evaluate((fn, args) => window.__v39[fn](...args), fn, args)
const clear = (page) => page.evaluate(() => window.__v39.clear())

/** 画面の大きさを変える（紙面の倍率を求め直す） */
async function resize(page, vp) {
  await page.setViewport(vp)
  await sleep(900)
  await ready(page)
  await page.evaluate(() => window.__editor.refitPage())
  await sleep(500)
  await ready(page)
}

// =====================================================================
// スマホの絵
// =====================================================================
async function phoneShots(browser) {
  const { context, page } = await openTool(browser, { device: 'phone' })
  // 見本の原稿は入れ替え（replace）で入るので、履歴は空。1つ変えて、「戻す」は押せる・「やり直す」は押せない（灰色）にする
  await page.evaluate(() => window.__editor.update((r) => ({ ...r })))
  await ready(page)
  // 偽物のドライブに保存して、上の帯の保存のようすが時刻（☁ 12:34）になるまで待つ
  await page.waitForFunction(() => /\d:\d\d/.test(document.querySelector('.p-top .chip')?.textContent ?? ''), { timeout: 60000 }).catch(() => console.log('  ！保存の時刻が出ない'))
  await installKit(page)
  await showPage(page)
  const s = await page.evaluate(() => {
    const s = window.__editor.getSnapshot()
    return { canUndo: s.canUndo, canRedo: s.canRedo }
  })
  if (!s.canUndo || s.canRedo) console.log('  ！「戻す」が押せて「やり直す」が押せない状態になっていない', s)

  // ---- いま ----
  await shot(page, 'now-ph')
  await openSheet(page)
  await shot(page, 'now-ph-sheet')
  await closeSheet(page)

  // ---- 3つの案：何も選んでいないとき・書く欄を開いたとき・iPhone（ホームバーの所をあける）・近くで ----
  const ZOOM = { a: HEADER, b: BOTTOM, c: NAV }
  for (const v of ['a', 'b', 'c']) {
    await mock(page, v)
    await shot(page, `${v}-ph`)
    await shot(page, `${v}-ph-zoom`, ZOOM[v])
    await clear(page)
    await openSheet(page)
    await mock(page, v)
    await shot(page, `${v}-ph-sheet`)
    await clear(page)
    await closeSheet(page)
    await mock(page, 'iphone', true)
    await sleep(500)
    await ready(page)
    await mock(page, v)
    await shot(page, `${v}-ph-iphone`)
    if (v !== 'a') await shot(page, `${v}-ph-iphone-zoom`, ZOOM[v])
    await clear(page)
    await mock(page, 'iphone', false)
    await sleep(500)
    await ready(page)
  }

  // ---- 案B：拡大しているとき（ページ送りが消え、右下に「ページ全体に戻す」）・作品写真のページ（並べ方の道具が出ている） ----
  await page.evaluate(() => window.__editor.setZoom(true))
  await sleep(700)
  await ready(page)
  await mock(page, 'b')
  await shot(page, 'b-ph-zoomed')
  await shot(page, 'b-ph-zoomed-zoom', BOTTOM)
  await clear(page)
  await page.evaluate(() => window.__editor.setZoom(false))
  await sleep(500)
  await ready(page)
  await page.evaluate(() => window.__editor.goToArea('photos'))
  await sleep(900)
  await ready(page)
  await mock(page, 'b')
  await shot(page, 'b-ph-photos')
  await shot(page, 'b-ph-photos-zoom', () => {
    const g = document.querySelector('.sel-bar .group').getBoundingClientRect()
    const y = Math.max(0, g.top - 14)
    return { x: 0, y, width: innerWidth, height: innerHeight - y }
  })
  await clear(page)
  await showPage(page)

  // ---- 案A：上の帯の保存のようす（言葉ごと）。390px（iPhone 12〜16）・375px（iPhone SE）・360px（小さい Android） ----
  const time = await page.evaluate(() => window.__v39.time())
  /** [絵の名前, 種類, いまの言葉, 案の言葉（null ならいまのまま）, 保存したときのチェック] */
  const CHIPS = [
    ['saved', 'ok', time, null, true],
    ['idle', 'ok', 'ドライブ', null, false],
    ['saving', 'busy', '保存中', null],
    ['offline', 'warn', '電波なし', null],
    ['error', 'ng', '保存エラー', null],
    ['unsaved', 'ng', 'ドライブ未保存', '未保存'],
    ['local', 'save', `自動保存 ${time}`, time],
    ['local-saving', 'busy', '保存しています…', '保存中'],
    ['local-error', 'ng', '保存できません。バックアップを保存してください', '保存エラー'],
  ]
  const fits = []
  for (const [vp, tag] of [
    [PHONE, '390'],
    [SE, '375'],
    [SMALL, '360'],
  ]) {
    if (tag !== '390') await resize(page, vp)
    for (const [name, kind, before, after, check] of CHIPS) {
      for (const [which, text] of [
        ['now', before],
        ['a', after ?? before],
      ]) {
        if (which === 'now' && !after && tag === '390') continue
        await mock(page, 'a')
        await mock(page, 'chip', kind, text, check)
        const r = await page.evaluate(() => window.__v39.chipCut())
        fits.push({ tag, name, which, text, ...r })
        if (tag === '390' || (which === 'a' && ['saved', 'idle', 'error'].includes(name))) await shot(page, `a-hdr-${tag}-${name}${which === 'now' ? '-now' : ''}`, HEADER)
        await clear(page)
      }
    }
  }
  console.log('  保存のようす（案A の帯に入るか）：')
  for (const f of fits) console.log(`    ${f.tag}px ${f.name} ${f.which}「${f.text}」 ${f.cut ? `切れる（${Math.round(f.need)} > ${Math.round(f.room)}）` : `入る（${Math.round(f.need)} ≦ ${Math.round(f.room)}）`}`)

  // ---- 案A：横向き（何も選んでいないとき・書く欄を開いたとき） ----
  await resize(page, LAND)
  await showPage(page)
  await mock(page, 'a')
  await shot(page, 'a-land')
  await clear(page)
  await openSheet(page)
  await mock(page, 'a')
  await shot(page, 'a-land-sheet')
  await clear(page)
  await closeSheet(page)
  await context.close()
}

// =====================================================================
// 一覧のページ（mockups/v39/review.html）を画像にする（shots/review-undo-phone.png。幅 1200px）。
// あわせて、ページの文に「1字だけの行」がないかを確かめる
// =====================================================================
async function reviewShots(browser) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 })
  await page.goto(`${APP}/${DIR}/review.html`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  const lonely = await page.evaluate(() => {
    // 字ごとの位置を、いちばん近い塊（ブロック）ごとに行に分け、句読点・かっこを除いて1字だけの行を探す
    const PUNCT = /[\s、。，．・：；！？「」『』（）()［］【】〈〉…ー―\-/]/
    const blockOf = (n) => {
      let e = n.parentElement
      while (e && getComputedStyle(e).display.startsWith('inline')) e = e.parentElement
      return e
    }
    const lines = new Map()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.nodeValue.trim()) continue
      const block = blockOf(n)
      if (!block || block.closest('script, style')) continue
      for (let i = 0; i < n.nodeValue.length; i++) {
        const ch = n.nodeValue[i]
        if (/\s/.test(ch)) continue
        const r = document.createRange()
        r.setStart(n, i)
        r.setEnd(n, i + 1)
        const b = r.getBoundingClientRect()
        if (!b.width) continue
        if (!lines.has(block)) lines.set(block, [])
        lines.get(block).push({ ch, y: b.top + b.height / 2, h: b.height })
      }
    }
    const bad = []
    for (const [block, chars] of lines) {
      const rows = []
      for (const c of chars) {
        const row = rows.find((r) => Math.abs(r.y - c.y) < Math.max(6, c.h * 0.45))
        if (row) row.chars.push(c.ch)
        else rows.push({ y: c.y, chars: [c.ch] })
      }
      if (rows.length < 2) continue
      for (const r of rows) {
        const real = r.chars.filter((c) => !PUNCT.test(c))
        if (real.length <= 1) bad.push(`「${r.chars.join('')}」（${block.textContent.trim().slice(0, 24)}…）`)
      }
    }
    return bad
  })
  if (lonely.length) console.log(`  ！1字だけの行：${lonely.join(' ／ ')}`)
  await page.screenshot({ path: `${OUT}/review-undo-phone.png`, fullPage: true })
  console.log('✓', 'review-undo-phone')
  await page.close()
}

await withEdge(async (browser) => {
  if (want('phone')) await phoneShots(browser)
  if (want('review')) await reviewShots(browser)
})
