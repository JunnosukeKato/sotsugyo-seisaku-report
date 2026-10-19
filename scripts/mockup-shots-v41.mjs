// デザイン案 v41（目次のページが「自動で作られる」と分かるようにする：依頼者の心配「学生が、目次が壊れている・さわれないと思うのでは」）を画像に書き出す。
// 目次のページは、本文の見出しから自動で作る。学生はそこに書けない。いまは、左の道具の上に小さく「目次／見出しから自動で作られる」とあるだけで、
// 紙面を押しても何も起きない。スマホの紙面の下の帯（src/app/PageBand.tsx）にも、目次のページでは何も出ない。
// 3つの案：案A 紙面の上に、画面だけの知らせ（印刷しない）・案B 紙面を押すと、押した所の近くに小さな知らせ（「本文の見出しへ」のボタン付き）・
// 案C 目次の行を押せる（マウスを乗せると下線と「→ 見出しへ」。押すと、その見出しのページへ移り、見出しを書く欄が開く）＋左の道具の言葉を分かりやすく。
// 本物の学生用ツール（開発サーバー。Google のログインとドライブは偽物：scripts/video/session.mjs の openTool）を開き、見本の原稿で、
// 案の部品だけを画面に書き足して写す（src/ は変えない）。案C の「押したあと」は、本物の editor でその見出しのページへ移り、本物の書く欄を開いたもの。
// できるもの：mockups/v41/shots/*.png（案の画面）と、shots/review-toc.png（一覧のページ mockups/v41/review.html の写し）
// 使い方: node scripts/mockup-shots-v41.mjs [pc] [phone] [review]（何も付けなければ全部。開発サーバーが http://localhost:5173 で動いていること）
//   pc    ：パソコン 1366×768（いま・案A・案B（押す前・押したあと）・案C（ふだん・マウスを乗せたとき・押したあと））と、近くで見た絵
//   phone ：スマホ 390×844（いま・案A の帯・案B（押したあと）・案C（帯・押したとき・押したあと））と、近くで見た絵
//   review：一覧のページ（mockups/v41/review.html）を画像にする
//   Edge は EDGE_PORT（ふだんは 9621）で起動する
import { mkdirSync } from 'node:fs'

process.env.EDGE_PORT ??= '9621'
const { withEdge } = await import('./poc/edge.mjs')
const { openTool, ready } = await import('./video/session.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const DIR = 'mockups/v41'
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })
const ONLY = process.argv.slice(2)
const want = (k) => ONLY.length === 0 || ONLY.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** パソコン（ノートパソコン）とスマホ。どちらも細かく写す */
const PC = { width: 1366, height: 768, deviceScaleFactor: 1.5 }
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

// ---- 案の言葉（review.html の「言葉の表」と同じ） ----
const T = {
  /** 左の道具の上（どの案でも同じ。いまは「見出しから／自動で作られ／る」と、1字だけの行ができている） */
  head: '本文の\n見出しから\n自動で\n作ります',
  /** ページの一覧の名前（どの案でも同じ。いまは「目次」） */
  list: '目次（自動）',
  /** 案A：紙面の上の知らせ（画面だけ。PDF・印刷には出ない） */
  aTitle: '目次は、本文の見出しから自動で作ります',
  aSub: '直すときは、本文の見出しを直します',
  /** 案B：押した所の近くの知らせ */
  bTitle: '目次は自動です',
  bSub: '見出しを直すと、ここも変わります',
  bButton: '本文の見出しへ',
  /** 案C：行にマウスを乗せたとき */
  cTag: '→ 見出しへ',
  /** 案C：左の道具の上の、もう一言（パソコン） */
  cNote: '直すときは、\n目次の行を\nクリック',
  /** 案C：見出しへ移ったときの知らせ（本物の editor.showNotice） */
  cNotice: 'この見出しを直すと、目次も変わります',
  /** スマホの帯（案A・案C） */
  phTitle: '目次は、本文の見出しから自動で作ります',
  phASub: '直すときは、本文の見出しを直します',
  phCSub: '目次の行をタップすると、その見出しへ移ります',
}

// ---- アイコン（src/app/icons.tsx と同じ線の太さ） ----
const svg = (d, w = 1.6) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const IC = {
  /** 自動（まわる矢印） */
  auto: svg('<path d="M19.2 12a7.2 7.2 0 1 1-2.1-5.1"/><path d="M19.4 4.6v3.6h-3.6"/>'),
  autoBold: svg('<path d="M19.2 12a7.2 7.2 0 1 1-2.1-5.1"/><path d="M19.4 4.6v3.6h-3.6"/>', 2.4),
  next: svg('<path d="M9.5 5l7 7-7 7"/>'),
  close: svg('<path d="M7 7l10 10M17 7L7 17"/>'),
  /** マウスの矢印（画面の絵の中だけ。どこを押したか） */
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2.5v17.2l4.4-4.2 2.9 6.4 2.7-1.2-2.9-6.3h6.1z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  /** マウスの指（押せる物の上） */
  hand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.2 3.2a1.5 1.5 0 0 1 3 0v6.9h.4V8.6a1.5 1.5 0 0 1 3 0v1.9h.3V9.6a1.5 1.5 0 0 1 3 0v6.2a5.6 5.6 0 0 1-5.6 5.6h-1.6a5.6 5.6 0 0 1-4.6-2.4l-3.3-4.7a1.5 1.5 0 0 1 2.3-1.9l1.7 1.9h.4z" fill="#fff" stroke="#111" stroke-width="1.2" stroke-linejoin="round"/></svg>',
}

/** 案の部品の見た目。色と書体は src/tokens.css・src/index.css のもの */
const CSS = `
  .v41-x { box-sizing: border-box; font-family: 'BIZ UDPGothic', sans-serif; }
  .v41-x * { box-sizing: border-box; }
  [data-v41-hidden] { display: none !important; }
  .v41-fixed { position: fixed; z-index: 60; }

  /* ===== どの案でも同じ：左の道具の上の言葉（行を自分で分ける。1字だけの行を作らない） ===== */
  .palette .p-head span.v41-x { display: block; margin-top: 3px; font-size: 10.5px; line-height: 1.45; color: var(--muted); white-space: pre-line; }
  /* 案C：もう一言（押せることを伝える） */
  .palette .v41-cgroup { border-top: 1px solid var(--palette-line); padding: 6px 0 4px; }
  .palette .v41-cnote { display: flex; flex-direction: column; align-items: center; gap: 3px; font-size: 10.5px; line-height: 1.45; color: var(--accent); text-align: center; white-space: pre-line; font-weight: 700; }
  .palette .v41-cnote svg { width: 18px; height: 18px; }

  /* ===== 案A：紙面の上の知らせ（画面だけ。紙面の部品ではないので、PDF・印刷には出ない） ===== */
  .v41-banner { display: flex; align-items: center; gap: 8px; padding: 5px 12px 5px 8px; border-radius: 9px; background: var(--accent-soft); border: 1px solid #cdd3ea; color: var(--accent); font-size: 12px; line-height: 1.4; }
  .v41-banner .mk { flex: none; display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: var(--accent); color: #fff; }
  .v41-banner .mk svg { width: 13px; height: 13px; }
  .v41-banner b { display: block; font-weight: 700; }
  .v41-banner span { display: block; color: #4a5585; }

  /* ===== 案B：押した所の近くの知らせ（吹き出し） ===== */
  .v41-bubble { width: 268px; padding: 11px 12px 12px 14px; border-radius: 12px; background: #fff; border: 1px solid var(--line); box-shadow: 0 10px 28px rgba(30, 25, 20, 0.2); color: var(--ink); font-size: 13px; line-height: 1.55; }
  .v41-bubble::before { content: ''; position: absolute; left: var(--tail, 30px); top: -7px; width: 12px; height: 12px; background: #fff; border-left: 1px solid var(--line); border-top: 1px solid var(--line); transform: rotate(45deg); }
  .v41-bubble .hd { display: flex; align-items: center; gap: 7px; font-size: 13.5px; font-weight: 700; color: var(--accent); }
  .v41-bubble .hd svg { flex: none; width: 17px; height: 17px; }
  .v41-bubble .hd .x { margin-left: auto; width: 22px; height: 22px; display: grid; place-items: center; color: var(--muted); }
  .v41-bubble .hd .x svg { width: 15px; height: 15px; }
  .v41-bubble p { margin: 3px 0 10px 24px; color: var(--ink); }
  .v41-bubble button { display: flex; align-items: center; justify-content: center; gap: 4px; width: 100%; min-height: 36px; padding: 0 12px; border: 0; border-radius: 9px; background: var(--accent); color: #fff; font: inherit; font-size: 13.5px; font-weight: 700; }
  .v41-bubble button svg { width: 15px; height: 15px; }
  .app.phone .v41-bubble { width: 300px; font-size: 14px; padding: 13px 14px 14px 16px; }
  .app.phone .v41-bubble .hd { font-size: 15px; }
  .app.phone .v41-bubble p { margin: 4px 0 12px 24px; }
  .app.phone .v41-bubble button { min-height: 44px; font-size: 15px; }

  /* ===== 案C：行にマウスを乗せたとき ===== */
  .v41-hl { pointer-events: none; z-index: 8; border-radius: 3px; background: #e3e7f4; mix-blend-mode: multiply; }
  .v41-tag { z-index: 9; display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 11.5px; font-weight: 700; letter-spacing: 0.02em; white-space: nowrap; box-shadow: 0 0 0 3px #fff; }
  /* 案C：見出しへ移ったとき（書いている所の印。本物はカーソルが点滅する：写真には写らないので描く） */
  .v41-caret { z-index: 61; width: 1.5px; background: var(--accent); }
  .v41-flash { pointer-events: none; z-index: 8; border-radius: 4px; background: #dfe4f5; mix-blend-mode: multiply; }
  /* スマホ：押したとき（指を置いた所） */
  .v41-tap { z-index: 61; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; background: rgba(47, 62, 117, 0.22); border: 2px solid rgba(47, 62, 117, 0.55); }
  /* マウス（どこを押したか） */
  .v41-cursor { z-index: 62; width: 22px; height: 22px; pointer-events: none; }
  .v41-cursor svg { display: block; width: 100%; height: 100%; filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.3)); }
`

/** ページの中で使う道具（部品を足す・隠す・書き換える・元に戻す。v38 と同じ形） */
async function installKit(page) {
  await page.evaluate((css) => {
    document.getElementById('v41-style')?.remove()
    const style = document.createElement('style')
    style.id = 'v41-style'
    style.textContent = css
    document.head.append(style)
    const lastText = (el) => [...el.childNodes].reverse().find((n) => n.nodeType === 3 && n.nodeValue.trim())
    window.__v41 = {
      /** 部品を足す（body の直下） */
      add(html) {
        document.body.insertAdjacentHTML('beforeend', html)
        return document.body.lastElementChild
      },
      hide(el) {
        el?.setAttribute('data-v41-hidden', '')
      },
      /** 本物の部品を隠して、すぐ後ろに案の部品（class に v41-x）を置く。React が作った部品の中身は書き換えない */
      swap(el, html) {
        el.setAttribute('data-v41-hidden', '')
        el.insertAdjacentHTML('afterend', html)
        return el.nextElementSibling
      },
      after(el, html, before = false) {
        el.insertAdjacentHTML(before ? 'beforebegin' : 'afterend', html)
        return before ? el.previousElementSibling : el.nextElementSibling
      },
      /** 本物の部品の、最後の文字だけを書き換える（ページの一覧の名前など） */
      label(el, text) {
        const n = lastText(el)
        if (!el.hasAttribute('data-v41-label')) el.setAttribute('data-v41-label', n.nodeValue)
        n.nodeValue = text
      },
      /** 本物の部品の属性を変える（value が null なら外す。clear で戻す） */
      attr(el, name, value) {
        const saved = JSON.parse(el.getAttribute('data-v41-attrs') ?? '{}')
        if (!(name in saved)) saved[name] = el.getAttribute(name)
        el.setAttribute('data-v41-attrs', JSON.stringify(saved))
        if (value === null) el.removeAttribute(name)
        else el.setAttribute(name, value)
      },
      /** 案の部品を全部外し、本物を元に戻す（スマホの帯の分だけ上に寄せた紙面も戻す） */
      clear() {
        document.querySelectorAll('.v41-x').forEach((e) => e.remove())
        document.querySelectorAll('[data-v41-hidden]').forEach((e) => e.removeAttribute('data-v41-hidden'))
        document.querySelectorAll('[data-v41-label]').forEach((e) => {
          lastText(e).nodeValue = e.getAttribute('data-v41-label')
          e.removeAttribute('data-v41-label')
        })
        document.querySelectorAll('[data-v41-attrs]').forEach((e) => {
          for (const [name, value] of Object.entries(JSON.parse(e.getAttribute('data-v41-attrs')))) {
            if (value === null) e.removeAttribute(name)
            else e.setAttribute(name, value)
          }
          e.removeAttribute('data-v41-attrs')
        })
        const stage = document.querySelector('.stage')
        if (stage?.style.getPropertyValue('--inset-band')) {
          stage.style.removeProperty('--inset-band')
          window.__editor.refitPage()
        }
      },
    }
  }, CSS)
}

/**
 * 確かめ：横にはみ出していないか・案の部品が画面の外に出ていないか・1字だけの行がないか（左の道具の上・案の部品の文）。
 * 案の部品の文の行の分かれ方も書き出す（言葉の表と同じか、目で確かめる）
 */
const audit = (page, name) =>
  page
    .evaluate(() => {
      const bad = []
      const lines = (el) => {
        const out = []
        let top = null
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          for (let i = 0; i < n.nodeValue.length; i++) {
            if (/\s/.test(n.nodeValue[i])) continue
            const range = document.createRange()
            range.setStart(n, i)
            range.setEnd(n, i + 1)
            const r = range.getClientRects()[0]
            if (!r) continue
            if (top === null || Math.abs(r.top - top) > r.height / 2) {
              out.push('')
              top = r.top
            }
            out[out.length - 1] += n.nodeValue[i]
          }
        }
        return out
      }
      if (document.documentElement.scrollWidth > innerWidth + 1) bad.push(`横にはみ出している（${document.documentElement.scrollWidth}px）`)
      for (const el of document.querySelectorAll('.v41-x')) {
        const r = el.getBoundingClientRect()
        if (!r.width) continue
        if (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1 || r.top < -1) bad.push(`画面の外：${el.className}`)
      }
      const said = []
      for (const el of document.querySelectorAll('.palette .p-head span:not([data-v41-hidden]), .v41-cnote, .v41-banner b, .v41-banner span, .v41-bubble .hd span, .v41-bubble p, .v41-bubble button, .page-band .t, .page-band p, .v41-tag')) {
        if (!el.getBoundingClientRect().width) continue
        const ls = lines(el)
        said.push(ls.join('／'))
        if (ls.length > 1 && ls.some((l) => l.length === 1)) bad.push(`1字だけの行：${ls.join('／')}`)
      }
      return { bad, said }
    })
    .then(({ bad, said }) => {
      if (bad.length) console.log(`  ！${name}：${bad.join(' ／ ')}`)
      if (said.length) console.log(`    ${name} の文：${said.join(' ｜ ')}`)
    })

/** 撮る。clip：写す範囲（画面の座標。ページの中で求める関数か式の文字列でもよい。なければ画面全体） */
async function shot(page, name, clip) {
  await page.evaluate(() => document.fonts.ready)
  await sleep(300)
  await audit(page, name)
  const box = typeof clip === 'function' || typeof clip === 'string' ? await page.evaluate(clip) : clip
  await page.screenshot({ path: `${OUT}/${name}.png`, captureBeyondViewport: false, ...(box ? { clip: box } : {}) })
  console.log('✓', name)
}

const parkMouse = (page) => page.mouse.move(2, 2)

/** 学生用ツールを開く（見本の原稿）。開発サーバーが一時的にエラーを出していたら（ほかの人が src/ を直している途中）、少し待って開き直す */
async function open(browser, device) {
  for (let i = 0; ; i++) {
    let opened
    try {
      opened = await openTool(browser, { device })
      const { page } = opened
      if (device === 'pc') {
        await page.setViewport(PC)
        await sleep(600)
        await ready(page)
      }
      await installKit(page)
      return opened
    } catch (e) {
      await opened?.context.close().catch(() => {})
      if (i >= 3) throw e
      console.log('  …開き直します：', e.message)
      await sleep(8000)
    }
  }
}

/** 目次のページを出す */
async function goToc(page) {
  await page.evaluate(() => window.__editor.finishEditing())
  await page.evaluate(() => window.__editor.goToPage(window.__editor.getSnapshot().layout.kinds.indexOf('toc'), 'none'))
  await ready(page)
  await sleep(700)
}

/** 見ている紙面のページの中の、目次の行（text を含む行。title：行の見出しの部分） */
const TOC_LINE = `(text) => {
  const cur = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current') ?? window.__editor.pageElements()[window.__editor.getSnapshot().page]
  const line = [...cur.querySelectorAll('.toc > div')].find((d) => d.textContent.includes(text))
  return line
}`

/** どの案でも同じ：左の道具の上の言葉と、ページの一覧の名前 */
const common = (page) =>
  page.evaluate((T) => {
    const k = window.__v41
    const span = document.querySelector('.palette .p-head span')
    if (span) k.swap(span, `<span class="v41-x">${T.head}</span>`)
    const t = [...document.querySelectorAll('.thumb-list .t')].find((b) => b.getAttribute('aria-label')?.startsWith('目次'))
    if (t) k.label(t, T.list)
  }, T)

/** 案A：紙面の上の余白に、画面だけの知らせ（紙面の題「目次」より上） */
const drawA = (page) =>
  page.evaluate(
    ({ T, IC, TOC_LINE }) => {
      const k = window.__v41
      const ed = window.__editor
      const r = ed.pageElements()[ed.getSnapshot().page].getBoundingClientRect()
      const title = eval(TOC_LINE)('目次').getBoundingClientRect()
      // 本文の幅（左の余白 35mm・右の余白 25mm の内側）
      const left = r.left + r.width * (132.3 / 793.7) - 8
      const width = r.width * (566.9 / 793.7) + 8
      const el = k.add(`<div class="v41-x v41-fixed v41-banner" style="left:${left}px;width:${width}px;top:0"><span class="mk">${IC.autoBold}</span><div><b>${T.aTitle}</b><span>${T.aSub}</span></div></div>`)
      // 紙面の上の端と、題「目次」の間の真ん中
      const h = el.getBoundingClientRect().height
      el.style.top = `${Math.round(r.top + (title.top - r.top - h) / 2)}px`
      const b = el.getBoundingClientRect()
      // 紙面の上の端・題「目次」とのすき間（画面の px）
      return { above: Math.round(b.top - r.top), below: Math.round(title.top - b.bottom) }
    },
    { T, IC, TOC_LINE },
  )

/** 案B：押した所（x, y）の近くに知らせ。cursor：'arrow'（パソコン）・'tap'（スマホ） */
const drawB = (page, x, y, cursor) =>
  page.evaluate(
    ({ T, IC, x, y, cursor }) => {
      const k = window.__v41
      const el = k.add(
        `<div class="v41-x v41-fixed v41-bubble" style="left:0;top:0"><div class="hd">${IC.auto}<span>${T.bTitle}</span><span class="x">${IC.close}</span></div><p>${T.bSub}</p><button>${T.bButton}${IC.next}</button></div>`,
      )
      const w = el.getBoundingClientRect().width
      // 押した所の少し下に、吹き出しの先を向ける（画面の外に出ないように左右をずらす）
      const left = Math.max(10, Math.min(innerWidth - w - 10, x - 34))
      el.style.left = `${left}px`
      el.style.top = `${y + 18}px`
      el.style.setProperty('--tail', `${x - left - 7}px`)
      if (cursor === 'arrow') k.add(`<div class="v41-x v41-fixed v41-cursor" style="left:${x - 5}px;top:${y - 3}px">${IC.arrow}</div>`)
      else k.add(`<div class="v41-x v41-fixed v41-tap" style="left:${x}px;top:${y}px"></div>`)
    },
    { T, IC, x, y, cursor },
  )

/** 目次の行の上の、押す所（パソコン：見出しの字の中ほど） */
const linePoint = (page, text) =>
  page.evaluate(
    ({ text, TOC_LINE }) => {
      const line = eval(TOC_LINE)(text)
      const span = line.querySelector('span') ?? line
      const r = span.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(span)
      const t = range.getBoundingClientRect()
      // 行の字の終わりのすぐ右（字を隠さないように）
      return { x: Math.round(t.right + 6), y: Math.round(r.top + r.height / 2) }
    },
    { text, TOC_LINE },
  )

/** 案C：行にマウスを乗せた（スマホは押した）ときの見た目。tag：「→ 見出しへ」を出すか。cursor：'hand'・'tap' */
const drawCHover = (page, text, { tag = true, cursor = 'hand' } = {}) =>
  page.evaluate(
    ({ T, IC, text, tag, cursor, TOC_LINE }) => {
      const k = window.__v41
      const line = eval(TOC_LINE)(text)
      const span = line.querySelector('span') ?? line
      const lr = line.getBoundingClientRect()
      // 行の地を薄い色に（紙面の文字の上に重ねて、掛け合わせる）
      k.add(`<div class="v41-x v41-fixed v41-hl" style="left:${lr.left - 6}px;top:${lr.top - 1}px;width:${lr.width + 12}px;height:${lr.height + 2}px"></div>`)
      // 見出しの字に下線（紙面の中の字。clear で戻す）
      k.attr(span, 'style', 'text-decoration: underline; text-decoration-thickness: 0.08em; text-underline-offset: 0.18em; color: #2f3e75;')
      const range = document.createRange()
      range.selectNodeContents(span)
      const t = range.getBoundingClientRect()
      let right = t.right
      if (tag) {
        const el = k.add(`<span class="v41-x v41-fixed v41-tag" style="left:${t.right + 8}px;top:0">${T.cTag}</span>`)
        el.style.top = `${Math.round(lr.top + lr.height / 2 - el.getBoundingClientRect().height / 2)}px`
        right = el.getBoundingClientRect().right
      }
      // マウス・指は、行の点線の上（行のどこを押しても移れる。見出しの字を隠さないように）
      const x = Math.round(right + (tag ? 40 : 34))
      const y = Math.round(lr.top + lr.height / 2)
      if (cursor === 'hand') k.add(`<div class="v41-x v41-fixed v41-cursor" style="left:${x - 7}px;top:${y - 2}px">${IC.hand}</div>`)
      else k.add(`<div class="v41-x v41-fixed v41-tap" style="left:${x}px;top:${y}px"></div>`)
    },
    { T, IC, text, tag, cursor, TOC_LINE },
  )

/** 案C：左の道具の上の、もう一言（パソコン） */
const drawCNote = (page) =>
  page.evaluate(
    ({ T, IC }) => {
      const k = window.__v41
      k.after(document.querySelector('.palette .p-head'), `<div class="v41-x v41-cgroup"><div class="v41-cnote">${IC.hand}<span>${T.cNote}</span></div></div>`)
    },
    { T, IC },
  )

/** 案C：行を押したあと（本物の editor：その見出しのページへ移り、見出しを書く欄を開く。知らせも本物の showNotice） */
async function jumpC(page, id, notice) {
  await page.evaluate(() => window.__v41.clear())
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), id)
  await ready(page)
  await sleep(500)
  await page.evaluate(
    ({ id, notice }) => {
      const ed = window.__editor
      const title = ed.getSnapshot().report.body.find((c) => c.id === id)?.title ?? ''
      ed.openWhenReady(id, title.length)
      if (notice) ed.showNotice(notice)
    },
    { id, notice },
  )
  await sleep(900)
  await ready(page)
  // パソコン：書いている所の印（本物は、見出しの終わりでカーソルが点滅する。写真には写らないので描く）と、移った見出しの地をうすく光らせる
  // （本物の「戻した所を光らせる」と同じ考え）。スマホは、下の書く欄が開くので描かない
  await page.evaluate((id) => {
    if (document.querySelector('.app.phone')) return
    const k = window.__v41
    const cur = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current') ?? window.__editor.pageElements()[window.__editor.getSnapshot().page]
    const block = cur.querySelector(`[data-block-id="${id}"]`)
    const head = block.parentElement
    const hr = head.getBoundingClientRect()
    k.add(`<div class="v41-x v41-fixed v41-flash" style="left:${hr.left - 8}px;top:${hr.top - 3}px;width:${hr.width + 16}px;height:${hr.height + 6}px"></div>`)
    const range = document.createRange()
    range.selectNodeContents(document.querySelector('.overlay-editor') ?? block)
    const last = [...range.getClientRects()].at(-1) ?? block.getBoundingClientRect()
    k.add(`<div class="v41-x v41-fixed v41-caret" style="left:${Math.round(last.right + 1)}px;top:${Math.round(last.top)}px;height:${Math.round(last.height)}px"></div>`)
  }, id)
}

/** スマホの紙面の下の帯（本物の帯と同じ形・同じ置き方。帯の分だけ紙面を上に寄せる：PageBand.tsx の place） */
const drawBand = (page, title, sub) =>
  page.evaluate(
    ({ title, sub, IC }) => {
      const stage = document.querySelector('.stage')
      stage.insertAdjacentHTML('beforeend', `<section class="v41-x page-band" aria-label="このページの案内"><div class="t"><span class="mk">${IC.autoBold}</span><span>${title}</span></div><p>${sub}</p></section>`)
      const band = stage.lastElementChild
      // 帯の中の説明は、ボタンがないので下の余白を詰める
      band.querySelector('p').style.marginBottom = '0'
      const st = stage.getBoundingClientRect()
      const bars = [...document.querySelectorAll('.pager, .sel-bar > *')].map((e) => e.getBoundingClientRect()).filter((r) => r.height > 0)
      const above = st.bottom - Math.min(st.bottom, ...bars.map((r) => r.top)) + 10
      band.style.bottom = `${above}px`
      stage.style.setProperty('--inset-band', `${Math.round(above + band.offsetHeight + 10)}px`)
      window.__editor.refitPage()
    },
    { title, sub, IC },
  )

/** 写す範囲：左の道具（上の部分） */
const PALETTE = () => {
  const p = document.querySelector('.palette').getBoundingClientRect()
  return { x: p.left - 12, y: Math.max(0, p.top - 10), width: p.width + 24, height: p.height + 20 }
}
/** 写す範囲：ページの一覧の、目次のまわり */
const LIST = () => {
  const t = [...document.querySelectorAll('.thumb-list .t')].find((b) => b.getAttribute('aria-label')?.startsWith('目次')).getBoundingClientRect()
  const col = document.querySelector('.thumbs-col').getBoundingClientRect()
  return { x: col.left, y: Math.max(0, t.top - 8), width: col.width, height: t.height + 16 }
}
/** 写す範囲：紙面の上の部分（題と目次の行の一部）。h：高さ */
const PAPER_TOP = (h) => `(() => {
  const ed = window.__editor
  const r = ed.pageElements()[ed.getSnapshot().page].getBoundingClientRect()
  return { x: Math.round(r.left), y: Math.max(0, Math.round(r.top) - 4), width: Math.round(r.width), height: ${h} }
})()`
/** 写す範囲：案の部品（sel）のまわり（pad：まわりの余白、extra：ほかに含めたい部品） */
const AROUND = (sel, pad = 16, extra = []) => `(() => {
  const rs = [${JSON.stringify(sel)}, ...${JSON.stringify(extra)}].flatMap((s) => [...document.querySelectorAll(s)]).map((e) => e.getBoundingClientRect()).filter((r) => r.width)
  const x = Math.max(0, Math.min(...rs.map((r) => r.left)) - ${pad})
  const y = Math.max(0, Math.min(...rs.map((r) => r.top)) - ${pad})
  const right = Math.min(innerWidth, Math.max(...rs.map((r) => r.right)) + ${pad})
  const bottom = Math.min(innerHeight, Math.max(...rs.map((r) => r.bottom)) + ${pad})
  return { x, y, width: right - x, height: bottom - y }
})()`

// =====================================================================
// パソコン（1366×768）
// =====================================================================
async function pcShots(browser) {
  const { context, page } = await open(browser, 'pc')
  await goToc(page)
  await parkMouse(page)

  // ---- いま ----
  await shot(page, 'now-pc')
  await shot(page, 'now-pc-head', PALETTE)
  await shot(page, 'now-pc-list', LIST)

  // ---- 案A：紙面の上の知らせ ----
  await common(page)
  const gap = await drawA(page)
  console.log(`    案A の知らせ：紙面の上の端から ${gap.above}px、題「目次」まで ${gap.below}px`)
  await shot(page, 'a-pc')
  await shot(page, 'a-pc-zoom', PAPER_TOP(150))
  await shot(page, 'common-pc-head', PALETTE)
  await shot(page, 'common-pc-list', LIST)
  await page.evaluate(() => window.__v41.clear())

  // ---- 案B：ふだん（いまと同じ。左の道具の言葉だけ直す）・行を押したあと ----
  await common(page)
  await shot(page, 'b-pc')
  const pb = await linePoint(page, 'デザイン説明')
  await drawB(page, pb.x, pb.y, 'arrow')
  await shot(page, 'b-pc-click')
  await shot(page, 'b-pc-zoom', PAPER_TOP(300))
  await page.evaluate(() => window.__v41.clear())

  // ---- 案C：ふだん・行にマウスを乗せたとき・押したあと ----
  await common(page)
  await drawCNote(page)
  await shot(page, 'c-pc')
  await shot(page, 'c-pc-head', PALETTE)
  await drawCHover(page, '制作過程')
  await shot(page, 'c-pc-hover')
  await shot(page, 'c-pc-zoom', PAPER_TOP(300))
  await jumpC(page, 'c2', T.cNotice)
  await shot(page, 'c-pc-jump')
  await shot(page, 'c-pc-jump-zoom', `(() => {
    const ed = window.__editor
    const r = ed.pageElements()[ed.getSnapshot().page].getBoundingClientRect()
    const toast = document.querySelector('.undo-toast')?.getBoundingClientRect()
    const x = Math.round(r.left) - 10
    const right = Math.round(Math.max(r.right, toast ? toast.right : 0)) + 10
    return { x, y: Math.max(0, Math.round(r.top) - 4), width: right - x, height: 190 }
  })()`)
  await shot(page, 'c-pc-jump-toast', AROUND('.undo-toast', 10))
  await context.close()
}

// =====================================================================
// スマホ（390×844）
// =====================================================================
/** 写す範囲：スマホの帯（と、ページ送り） */
const BAND = () => {
  const b = document.querySelector('.page-band').getBoundingClientRect()
  const p = document.querySelector('.pager').getBoundingClientRect()
  return { x: 0, y: Math.round(b.top) - 12, width: innerWidth, height: Math.round(p.bottom - b.top) + 24 }
}

async function phoneShots(browser) {
  const { context, page } = await open(browser, 'phone')
  await goToc(page)

  // ---- いま（帯は出ない。案B の「押す前」も同じ） ----
  await shot(page, 'now-ph')

  // ---- 案A：帯に知らせ ----
  await drawBand(page, T.phTitle, T.phASub)
  await sleep(600)
  await shot(page, 'a-ph')
  await shot(page, 'a-ph-band', BAND)
  await page.evaluate(() => window.__v41.clear())
  await sleep(600)

  // ---- 案B：行をタップしたあと ----
  const pb = await linePoint(page, 'デザイン説明')
  await drawB(page, pb.x, pb.y, 'tap')
  await shot(page, 'b-ph-tap')
  await shot(page, 'b-ph-zoom', () => {
    // 画面の幅いっぱい（目次の行が途中で切れないように）。押した所の少し上から、知らせの下まで
    const tap = document.querySelector('.v41-tap').getBoundingClientRect()
    const b = document.querySelector('.v41-bubble').getBoundingClientRect()
    const y = Math.round(tap.top) - 40
    return { x: 0, y, width: innerWidth, height: Math.round(b.bottom) + 16 - y }
  })
  await page.evaluate(() => window.__v41.clear())

  // ---- 案C：帯・行をタップしたとき・タップしたあと ----
  await drawBand(page, T.phTitle, T.phCSub)
  await sleep(600)
  await shot(page, 'c-ph')
  await shot(page, 'c-ph-band', BAND)
  await drawCHover(page, '制作過程', { tag: false, cursor: 'tap' })
  await shot(page, 'c-ph-tap')
  await jumpC(page, 'c2', null)
  await shot(page, 'c-ph-jump')
  await context.close()
}

// =====================================================================
// 一覧のページ（mockups/v41/review.html）を1枚の画像にする（shots/review-toc.png）
// =====================================================================
async function reviewShots(browser) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 })
  await page.goto(`${APP}/${DIR}/review.html`, { waitUntil: 'networkidle0' })
  // スクロールバーの分だけ幅が狭くならないように（画像の幅をちょうど 1200px に）
  await page.addStyleTag({ content: 'html { scrollbar-width: none; }' })
  await page.evaluate(() => document.fonts.ready)
  await sleep(300)
  await page.screenshot({ path: `${OUT}/review-toc.png`, fullPage: true })
  console.log('✓ review-toc')
  await page.close()
}

await withEdge(async (browser) => {
  if (want('pc')) await pcShots(browser)
  if (want('phone')) await phoneShots(browser)
  if (want('review')) await reviewShots(browser)
})
