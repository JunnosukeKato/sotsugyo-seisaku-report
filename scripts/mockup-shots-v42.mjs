// デザイン案 v42（表の列の幅を「自分で決める」：依頼者の希望「列の幅を、必要なときだけ自由に変えられるように」）を画像に書き出す。
// いまの列の幅は「そろえる／中身に合わせる」の2つ（パソコン：左の道具 src/app/Palette.tsx・スマホ：キーボードの上の道具の表の段 src/app/Phone.tsx）。
// ここに3つ目「自分で決める」を足す。そろえる・中身に合わせるの表には、つまみもボタンも出さない（いまのまま）。
// 決まり：幅は 5% ずつ・どの列も3字ほどより狭くしない（本文の幅で 10%）・合計はいつも本文の幅いっぱい。
// 別に作っている途中の「行の高さ：そろえる／中身に合わせる」「左端の列：中身に合わせる／ほかとそろえる（列の幅が そろえる のときだけ）」も、
// 同じ形のボタンで描き足す（まだ src/ にないので、形は仮）。
// 1. 切り替え：パソコンは3つを縦に並べる。スマホは 案A 押すたびに切り替え・案B 押すと3つから選ぶ（小さな窓）
// 2. パソコンの「自分で決める」：セル・タイトルを書いている間（表を選んでいる間）だけ、内側の縦の線に細いつまみ。
//    マウスを乗せると左右の矢印のカーソル、ドラッグ中は「35%」のような小さな札。書いていないときは、ふつうの表（つまみなし）
// 3. スマホの「自分で決める」：セルを押すと、その列をうすく色付け。道具に「この列を狭く」「この列を広く」「幅をそろえ直す」（案C）。
//    つまみを指で動かす形（案D）も
// 4. 仕上がり：紙面（PDF と同じ。PDF は紙面のページを画像にしたもの：src/pdf/exportPdf.ts）で、自分で決めた幅の表
// 本物の学生用ツール（開発サーバー。Google のログインとドライブは偽物：scripts/video/session.mjs の openTool）を開き、見本の原稿で写す（src/ は変えない）。
// 見本の素材表（名称・使用箇所・生地見本）に、説明の列「特徴」を足して、幅を決めたくなる表にする。
// 自分で決めた幅の紙面は、組む前の文書の表の見出しのセルに幅（%）を書き足して、本物の組版で組んだもの（このページの中の Blob だけを差し替える）。
// できるもの：mockups/v42/shots/*.png（案の画面）と、shots/review-table-widths.png（一覧のページ mockups/v42/review.html の写し）
// 使い方: node scripts/mockup-shots-v42.mjs [pc] [phone] [paper] [review]（何も付けなければ全部。開発サーバーが http://localhost:5173 で動いていること）
//   pc    ：パソコン 1366×768（いま・切り替えの3つ・自分で決める（ふだん・書いているとき・線にマウス・ドラッグ中））と、近くで見た絵
//   phone ：スマホ 390×844・仮のキーボード（いま・案A・案B・案C・案D）と、近くで見た絵
//   paper ：仕上がりの紙面（そろえる・中身に合わせる・自分で決める）
//   review：一覧のページ（mockups/v42/review.html）を画像にする
//   Edge は EDGE_PORT（ふだんは 9702）で起動する
import { mkdirSync } from 'node:fs'

process.env.EDGE_PORT ??= '9702'
const { withEdge } = await import('./poc/edge.mjs')
const { openTool, ready } = await import('./video/session.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const DIR = 'mockups/v42'
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })
const ONLY = process.argv.slice(2)
const want = (k) => ONLY.length === 0 || ONLY.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** パソコン（ノートパソコン）。細かく写す（スマホは openTool の 390×844） */
const PC = { width: 1366, height: 768, deviceScaleFactor: 1.5 }
/** 仮に出すキーボードの高さ（iPhone の日本語のキーボードほど。scripts/e2e/phoneDirect.mjs と同じ） */
const KB = 336

// ---- 見本の表（素材表に「特徴」の列を足す。列は 名称・使用箇所・特徴・生地見本） ----
const FEAT = {
  head: '特徴',
  rows: ['やわらかい光沢があり、照明が当たると表面が光る', '薄く透ける。腕を動かすと、風に揺れて見える', '張りがあって丈夫。しゃがんでも形がくずれにくい'],
}
/** 自分で決めた幅（%。名称・使用箇所・特徴・生地見本。合計 100） */
const CUSTOM = [25, 20, 35, 20]
/**
 * ドラッグ中の絵：「自分で決める」にした直後（いまの幅＝そろえるの 25% ずつから始まる）に、使用箇所と特徴の間の線を 50% → 45% へ
 * （使用箇所 20%・特徴 30%）。このあと特徴と生地見本の間の線を 75% → 80% へ動かすと、CUSTOM になる
 */
const DRAG = { border: 1, to: 45 }
/** いちばん狭い幅（%。本文の幅 150mm で3字ほど＋セルの余白） */
const MIN = 10

// ---- 案の言葉（review.html の「言葉の表」と同じ） ----
const T = {
  width: '列の幅',
  wEqual: 'そろえる',
  wAuto: '中身に合わせる',
  wCustom: '自分で決める',
  height: '行の高さ',
  hEqual: 'そろえる',
  hAuto: '中身に合わせる',
  left: '左端の列',
  lAuto: '中身に合わせる',
  lEqual: 'ほかとそろえる',
  /** パソコン：自分で決めるのとき、左の道具の一言 */
  pcHint: '縦の線を\nドラッグして\n幅を変える',
  reset: '幅をそろえ直す',
  /** パソコン：線にマウスを乗せたとき */
  tip: '左右にドラッグ',
  /** スマホ：案C の道具 */
  narrow: 'この列を狭く',
  widen: 'この列を広く',
  thisCol: 'この列',
  /** スマホ：案B の小さな窓 */
  popEqualSub: 'どの列も同じ幅',
  popAutoSub: '字の多い列を広く',
  popCustomSub: '列ごとに広く・狭く',
  /** スマホ：案D の一言（道具の段） */
  knobHint: '丸を左右に動かす',
}

// ---- アイコン（src/app/icons.tsx と同じ線の太さ） ----
const svg = (d, w = 1.6) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const IC = {
  /** この列を広く（列の線が外へ） */
  widen: svg('<path d="M9.5 5v14M14.5 5v14M6.5 12H2.5M4.5 10l-2 2 2 2M17.5 12h4M19.5 10l2 2-2 2"/>'),
  /** この列を狭く（列の線が内へ） */
  narrow: svg('<path d="M3.5 5v14M20.5 5v14M6.5 12h4.5M9 10l2 2-2 2M17.5 12H13M15 10l-2 2 2 2"/>'),
  /** 幅をそろえ直す（同じ幅の列） */
  even: svg('<rect x="3.5" y="6" width="17" height="12" rx="1.2"/><path d="M9.2 6v12M14.8 6v12"/>'),
  /** 小さな下向きの山（押すと選べる） */
  chev: svg('<path d="M7 10l5 5 5-5"/>', 2.2),
  /** 左右の矢印（スマホのつまみの中） */
  lr: svg('<path d="M3.5 12h17M7 8.5 3.5 12 7 15.5M17 8.5l3.5 3.5-3.5 3.5"/>', 2.4),
  /** マウスのカーソル「列の幅を変える」（col-resize。白で縁取り） */
  colResize:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4.5v15M14 4.5v15M7.5 12H2.8M5 9.5 2.5 12 5 14.5M16.5 12h4.7M19 9.5l2.5 2.5-2.5 2.5" stroke="#fff" stroke-width="4"/><path d="M10 4.5v15M14 4.5v15M7.5 12H2.8M5 9.5 2.5 12 5 14.5M16.5 12h4.7M19 9.5l2.5 2.5-2.5 2.5" stroke="#111" stroke-width="1.6"/></g></svg>',
  /** マウスの矢印 */
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2.5v17.2l4.4-4.2 2.9 6.4 2.7-1.2-2.9-6.3h6.1z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>',
}

/** 案の部品の見た目。色と書体は src/tokens.css・src/index.css のもの */
const CSS = `
  .v42-x { box-sizing: border-box; font-family: 'BIZ UDPGothic', sans-serif; }
  .v42-x * { box-sizing: border-box; }
  [data-v42-hidden] { display: none !important; }
  .v42-fixed { position: fixed; }

  /* ===== パソコン：左の道具（列の幅・行の高さ・左端の列。いまの「列の幅」と同じ形） ===== */
  .palette .v42-pal { display: flex; flex-direction: column; }
  .palette .v42-pal .seg button { font-family: inherit; }
  .palette .v42-hint { margin: 1px 0 3px; font-size: 9.5px; line-height: 1.45; color: var(--accent); text-align: center; font-weight: 700; }
  .palette .v42-hint span { display: block; white-space: nowrap; }
  .palette .v42-pal .seg button.v42-reset { display: flex; align-items: center; justify-content: center; gap: 2px; color: var(--accent); }
  .palette .v42-pal .seg button.v42-reset svg { width: 13px; height: 13px; }

  /* ===== パソコン：表の内側の縦の線のつまみ（自分で決めるの表を書いている間だけ） ===== */
  .v42-hline { z-index: 8; pointer-events: none; width: 0; margin-left: -1px; border-left: 2px solid rgba(47, 62, 117, 0.26); }
  .v42-hline.hot { border-left-color: var(--accent); }
  .v42-hline.ghost { margin-left: -0.75px; border-left: 1.5px dashed rgba(47, 62, 117, 0.5); }
  .v42-knob { z-index: 9; width: 8px; height: 22px; margin: -11px 0 0 -4px; border-radius: 4px; background: var(--accent); box-shadow: 0 0 0 1.5px #fff, 0 1px 3px rgba(0, 0, 0, 0.25); }
  .v42-knob.hot { width: 10px; height: 28px; margin: -14px 0 0 -5px; border-radius: 5px; }
  .v42-pill { z-index: 10; display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 12px; font-weight: 700; white-space: nowrap; box-shadow: 0 0 0 2px #fff; transform: translate(-50%, -50%); }
  .v42-tip { z-index: 10; padding: 4px 9px; border-radius: 7px; background: #23262b; color: #fff; font-size: 12px; line-height: 1.4; white-space: nowrap; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2); }
  .v42-drag { z-index: 10; display: flex; align-items: center; height: 22px; border-radius: 7px; background: #23262b; color: #fff; font-size: 12.5px; font-weight: 700; white-space: nowrap; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.22); }
  .v42-drag span { padding: 0 8px; }
  .v42-drag i { align-self: stretch; width: 1.5px; margin: 5px 0; background: rgba(255, 255, 255, 0.55); }
  .v42-cursor { z-index: 62; width: 26px; height: 26px; margin: -13px 0 0 -13px; pointer-events: none; }
  .v42-cursor.arrow { width: 22px; height: 22px; margin: 0; }
  .v42-cursor svg { display: block; width: 100%; height: 100%; filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.25)); }

  /* ===== スマホ：キーボードの上の道具（いまの道具と同じ形のボタン。src/index.css の .direct-bar） ===== */
  .direct-bar .v42-toggles .db-width b { display: inline-flex; align-items: center; gap: 1px; }
  .direct-bar .v42-toggles .db-width b svg { width: 12px; height: 12px; margin-right: -3px; }
  .direct-bar .v42-toggles .db-width.v42-open { background: var(--accent-soft); }
  .direct-bar .v42-colw { gap: 2px; }
  .direct-bar .v42-colw .v42-pct { flex: none; display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 50px; min-height: 44px; line-height: 1.15; }
  .direct-bar .v42-colw .v42-pct small { font-size: 9.5px; color: var(--muted); }
  .direct-bar .v42-colw .v42-pct b { font-size: 16px; color: var(--accent); letter-spacing: 0.02em; }
  .direct-bar .v42-colw .v42-reset { margin-left: auto; }
  .direct-bar .v42-colw .v42-khint { align-self: center; padding-left: 6px; margin-right: 8px; font-size: 12px; color: var(--accent); font-weight: 700; white-space: nowrap; }

  /* スマホ：選んだ列（うすい色。紙面の字の上に重ねて、掛け合わせる） */
  .v42-colhl { z-index: 6; pointer-events: none; background: #e3e7f4; mix-blend-mode: multiply; }
  .v42-coledge { z-index: 7; pointer-events: none; border: 2px solid var(--accent); border-radius: 2px; }

  /* スマホ 案B：押すと3つから選ぶ小さな窓 */
  .v42-pop { z-index: 40; width: 254px; padding: 6px; border-radius: 14px; background: #fff; border: 1px solid var(--line); box-shadow: 0 12px 32px rgba(30, 25, 20, 0.24); color: var(--ink); }
  .v42-pop::after { content: ''; position: absolute; left: var(--tail, 40px); bottom: -7px; width: 12px; height: 12px; background: #fff; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); transform: rotate(45deg); }
  .v42-pop .hd { padding: 4px 10px 4px; font-size: 12px; font-weight: 700; color: var(--muted); letter-spacing: 0.06em; }
  .v42-pop .op { display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 6px 10px; border-radius: 10px; }
  .v42-pop .op.on { background: var(--accent-soft); }
  .v42-pop .rd { flex: none; width: 20px; height: 20px; border-radius: 50%; border: 2px solid #b9bcc4; background: #fff; }
  .v42-pop .op.on .rd { border-color: var(--accent); background: radial-gradient(circle, var(--accent) 0 4.5px, #fff 5px); }
  .v42-pop b { display: block; font-size: 15px; line-height: 1.35; }
  .v42-pop .op.on b { color: var(--accent); }
  .v42-pop small { display: block; font-size: 12px; line-height: 1.4; color: var(--muted); }

  /* スマホ 案D：指で動かす丸いつまみ */
  .v42-pknob { z-index: 9; display: grid; place-items: center; width: 30px; height: 30px; margin: -15px 0 0 -15px; border-radius: 50%; background: var(--accent); color: #fff; box-shadow: 0 0 0 2px #fff, 0 2px 6px rgba(0, 0, 0, 0.3); }
  .v42-pknob svg { width: 18px; height: 18px; }
  .v42-pline { z-index: 8; pointer-events: none; width: 0; margin-left: -1px; border-left: 2px solid var(--accent); }

  /* スマホ：指を置いた所 */
  .v42-tap { z-index: 61; width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%; background: rgba(47, 62, 117, 0.22); border: 2px solid rgba(47, 62, 117, 0.55); pointer-events: none; }
`

/** ページの中で使う道具（部品を足す・隠す・書き換える・元に戻す。v41 と同じ形） */
async function installKit(page) {
  await page.evaluate((css) => {
    document.getElementById('v42-style')?.remove()
    const style = document.createElement('style')
    style.id = 'v42-style'
    style.textContent = css
    document.head.append(style)
    /** 見本の表の、いまの行の高さ（そろえる＝true）・左端の列（中身に合わせる＝true）。案の道具にも、本物と同じ形を出す */
    window.__v42now = () => {
      const t = window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === 't1')
      return { heights: t?.heights === 'equal', label: t?.labelColumn === true }
    }
    window.__v42 = {
      /** 部品を足す（body の直下） */
      add(html) {
        document.body.insertAdjacentHTML('beforeend', html)
        return document.body.lastElementChild
      },
      hide(el) {
        el?.setAttribute('data-v42-hidden', '')
      },
      after(el, html, before = false) {
        el.insertAdjacentHTML(before ? 'beforebegin' : 'afterend', html)
        return before ? el.previousElementSibling : el.nextElementSibling
      },
      /** 案の部品を全部外し、本物を元に戻す */
      clear() {
        document.querySelectorAll('.v42-x').forEach((e) => e.remove())
        document.querySelectorAll('[data-v42-hidden]').forEach((e) => e.removeAttribute('data-v42-hidden'))
      },
    }
  }, CSS)
}

/**
 * 自分で決めた幅：組む前の文書（Blob の text/html）の、表 id の見出しの行のセルに幅（%）を書き足す（このページの中だけ。src/ は変えない）。
 * window.__v42w = { t1: [25, 15, 40, 20] } のときだけ。組み直すと、本物の組版で、その幅の表になる
 */
const installWidthHook = (page) =>
  page.evaluate(() => {
    if (window.__v42hooked) return
    window.__v42hooked = true
    window.__v42w = null
    const Real = window.Blob
    const rewrite = (s) => {
      // 組み直すために表のタイトルに付けた、見えない字（setWidths）を消す
      s = s.replace(/​+/g, '')
      const all = window.__v42w
      if (!all) return s
      for (const [id, ws] of Object.entries(all)) {
        const at = s.indexOf(`data-table-id="${id}"`)
        if (at < 0) continue
        const t = s.indexOf('<table class="widths-', at)
        const tEnd = s.indexOf('>', t)
        const head = s.indexOf('<thead><tr>', tEnd)
        const headEnd = s.indexOf('</tr></thead>', head)
        let row = s.slice(head, headEnd)
        let i = 0
        row = row.replace(/<th /g, () => `<th style="width:${ws[i++]}%;box-sizing:border-box" `)
        // 列の幅の印は「そろえる」に（左端の列の印と、その幅の colgroup は外す。行の高さの印はそのまま）
        const cls = (s.slice(t, tEnd).match(/class="([^"]*)"/)?.[1] ?? '')
          .split(' ')
          .filter((c) => c && c !== 'label-column' && !c.startsWith('widths-'))
        const between = s.slice(tEnd + 1, head).replace(/<colgroup>[\s\S]*?<\/colgroup>/, '')
        s = s.slice(0, t) + `<table class="${['widths-equal', ...cls].join(' ')}" style="table-layout:fixed">` + between + row + s.slice(headEnd)
      }
      return s
    }
    function Blob(parts, opts) {
      if (opts && opts.type === 'text/html' && Array.isArray(parts)) parts = parts.map((p) => (typeof p === 'string' ? rewrite(p) : p))
      return new Real(parts, opts)
    }
    Blob.prototype = Real.prototype
    window.Blob = Blob
  })

/** 表の列の幅を決めて、組み直す（mode：'equal'・'auto'・'custom'。custom は widths の %） */
let bump = 0
async function setWidths(page, mode, widths = CUSTOM) {
  // 紙面は、前に組んだのと同じ文書なら組み直さない（表の裏と表の2枚の紙面を使い回す：src/editor/reportRenderer.ts）。
  // 表のタイトルの終わりに、見えない字（U+200B）を毎回ちがう数だけ付けて、文書を変える（組む前に、Blob の差し替えで消す）
  bump++
  await page.evaluate(
    ({ w, target, bump }) => {
      window.__v42w = w
      window.__editor.update((r) => ({
        ...r,
        body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === 't1' ? { ...b, widths: target, caption: b.caption.replace(/​+$/, '') + '​'.repeat(bump) } : b)) })),
      }))
    },
    { w: mode === 'custom' ? { t1: widths } : null, target: mode === 'auto' ? 'auto' : 'equal', bump },
  )
  await sleep(300)
  await ready(page)
  await sleep(400)
}

/** 見本の素材表に「特徴」の列を足す（名称・使用箇所・特徴・生地見本） */
const addFeatureColumn = (page) =>
  page.evaluate((FEAT) => {
    window.__editor.update((r) => ({
      ...r,
      body: r.body.map((c) => ({
        ...c,
        blocks: c.blocks.map((b) =>
          b.id !== 't1'
            ? b
            : {
                ...b,
                rows: b.rows.map((row, i) => ({
                  ...row,
                  cells: [...row.cells.slice(0, 2), i === 0 ? { id: 't1:hf', text: FEAT.head, imageId: null } : { id: `${row.id}:feat`, text: FEAT.rows[i - 1], imageId: null }, ...row.cells.slice(2)],
                })),
              },
        ),
      })),
    }))
  }, FEAT)

/**
 * 確かめ：横にはみ出していないか・案の部品が画面の外に出ていないか・1字だけの行がないか（案の部品の文）。
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
      for (const el of document.querySelectorAll('.v42-fixed')) {
        const r = el.getBoundingClientRect()
        if (!r.width) continue
        if (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1 || r.top < -1) bad.push(`画面の外：${el.className}`)
      }
      const said = []
      const sel = '.v42-hint, .v42-tip, .v42-pill, .v42-drag, .v42-pop .hd, .v42-pop b, .v42-pop small, .v42-pal .ctx-label, .v42-pal .seg button, .direct-bar .v42-x button > span, .direct-bar .v42-x button > b, .direct-bar .v42-x button > small, .v42-pct, .v42-khint'
      for (const el of document.querySelectorAll(sel)) {
        if (!el.getBoundingClientRect().width) continue
        const ls = lines(el)
        said.push(ls.join('／'))
        if (ls.length > 1 && ls.some((l) => l.length === 1)) bad.push(`1字だけの行：${ls.join('／')}`)
      }
      // スマホの道具：ボタンは 44px 以上・名前は1行
      for (const b of document.querySelectorAll('.direct-bar .v42-x button')) {
        const r = b.getBoundingClientRect()
        if (!r.width) continue
        if (r.width < 44 - 0.5 || r.height < 44 - 0.5) bad.push(`小さいボタン：${b.textContent.trim()}（${Math.round(r.width)}×${Math.round(r.height)}）`)
        for (const t of b.querySelectorAll('span, b, small')) if (lines(t).length > 1) bad.push(`2行の名前：${t.textContent.trim()}`)
      }
      for (const b of document.querySelectorAll('.v42-pop .op')) {
        const r = b.getBoundingClientRect()
        if (r.height < 44) bad.push(`小さい選び：${b.textContent.trim()}`)
      }
      return { bad, said }
    })
    .then(({ bad, said }) => {
      if (bad.length) console.log(`  ！${name}：${bad.join(' ／ ')}`)
      if (said.length) console.log(`    ${name} の文：${[...new Set(said)].join(' ｜ ')}`)
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

/** 学生用ツールを開く（見本の原稿に「特徴」の列）。開発サーバーが一時的にエラーを出していたら（ほかの人が src/ を直している途中）、少し待って開き直す */
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
      await installWidthHook(page)
      await addFeatureColumn(page)
      await sleep(500)
      await ready(page)
      await goTable(page)
      return opened
    } catch (e) {
      await opened?.context.close().catch(() => {})
      if (i >= 3) throw e
      console.log('  …開き直します：', e.message)
      await sleep(8000)
    }
  }
}

/** 表のあるページを出す（書くのをやめて） */
async function goTable(page) {
  await page.evaluate(() => window.__editor.finishEditing())
  await page.evaluate(() => window.__editor.select(null))
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('t1'), 'none'))
  await ready(page)
  await sleep(600)
}

/** 見ているページの表の、列の線の位置など（画面の座標） */
const tableGeom = (page) =>
  page.evaluate(() => {
    const cur = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current') ?? window.__editor.pageElements()[window.__editor.getSnapshot().page]
    const table = cur.querySelector('.data-table[data-table-id="t1"] table')
    const t = table.getBoundingClientRect()
    const head = table.querySelector('thead tr').getBoundingClientRect()
    const ths = [...table.querySelectorAll('thead th')].map((th) => th.getBoundingClientRect())
    const cap = cur.querySelector('.data-table[data-table-id="t1"] .table-caption').getBoundingClientRect()
    return {
      left: t.left,
      top: t.top,
      right: t.right,
      bottom: t.bottom,
      width: t.width,
      height: t.height,
      headTop: head.top,
      headBottom: head.bottom,
      cols: ths.map((r) => ({ left: r.left, right: r.right })),
      /** 内側の縦の線（列と列の間） */
      borders: ths.slice(0, -1).map((r, i) => (r.right + ths[i + 1].left) / 2),
      cap: { left: cap.left, top: cap.top, right: cap.right, bottom: cap.bottom },
      page: cur.getBoundingClientRect().toJSON(),
    }
  })

/** セルを押して書き始める（パソコン：クリック。スマホ：タップ） */
async function openCell(page, cellId, device) {
  const r = await page.evaluate((id) => {
    const el = document.querySelector(`.page-viewport.front [data-vivliostyle-page-container].is-current [data-cell-id="${id}"]`)
    const b = el.getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
  }, cellId)
  if (device === 'phone') await page.touchscreen.tap(r.x, r.y)
  else await page.mouse.click(r.x, r.y)
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 15000 }, cellId)
  await sleep(1200)
  await ready(page).catch(() => {})
}

// =====================================================================
// パソコン（1366×768）
// =====================================================================

/**
 * パソコンの左の道具：列の幅（3つ）・左端の列（列の幅が そろえる のときだけ）・行の高さ（並びは、別に作っている途中の src/app/tableSwitches.tsx と同じ）。
 * 本物の切り替え（あれば、列の幅・左端の列・行の高さの全部）を隠して、案の形を置く。mode：'equal'・'auto'・'custom'
 */
const drawPalette = (page, mode) =>
  page.evaluate(
    ({ T, IC, mode }) => {
      const k = window.__v42
      const now = window.__v42now()
      const group = document.querySelector('.palette .group.ctx')
      const labels = [...group.querySelectorAll('.ctx-label.sub')].filter((e) => [T.width, T.left, T.height].includes(e.textContent.trim()))
      const btn = (text, on, cls = '') => `<button class="${[on ? 'on' : '', cls].join(' ').trim()}" aria-pressed="${on}">${text}</button>`
      let html = `<div class="v42-x v42-pal"><div class="ctx-label sub">${T.width}</div><div class="seg">${btn(T.wEqual, mode === 'equal')}${btn(T.wAuto, mode === 'auto')}${btn(T.wCustom, mode === 'custom')}</div>`
      if (mode === 'custom') html += `<p class="v42-hint">${T.pcHint.split('\n').map((l) => `<span>${l}</span>`).join('')}</p><div class="seg"><button class="v42-reset">${T.reset}</button></div>`
      if (mode === 'equal') html += `<div class="ctx-label sub">${T.left}</div><div class="seg">${btn(T.lAuto, now.label)}${btn(T.lEqual, !now.label)}</div>`
      html += `<div class="ctx-label sub">${T.height}</div><div class="seg">${btn(T.hEqual, now.heights)}${btn(T.hAuto, !now.heights)}</div>`
      html += '</div>'
      k.after(labels[0], html, true)
      for (const label of labels) {
        k.hide(label.nextElementSibling)
        k.hide(label)
      }
      const p = document.querySelector('.palette')
      return { overflow: p.scrollHeight > p.clientHeight + 1, bottom: Math.round(p.getBoundingClientRect().bottom), h: p.scrollHeight }
    },
    { T, IC, mode },
  )

/**
 * パソコン：表の内側の縦の線のつまみ。state：'idle'（書いている間）・'hover'（線にマウス）・'drag'（ドラッグ中）。
 * which：マウスを乗せる・ドラッグする線（0 から）。to：ドラッグ中の線の位置（表の左からの %）
 */
const drawHandles = (page, state, which = DRAG.border, to = DRAG.to) =>
  page.evaluate(
    ({ T, IC, state, which, to, MIN }) => {
      const k = window.__v42
      const cur = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current')
      const table = cur.querySelector('.data-table[data-table-id="t1"] table')
      const t = table.getBoundingClientRect()
      const head = table.querySelector('thead tr').getBoundingClientRect()
      const ths = [...table.querySelectorAll('thead th')].map((th) => th.getBoundingClientRect())
      const borders = ths.slice(0, -1).map((r, i) => (r.right + ths[i + 1].left) / 2)
      const ky = head.top + head.height / 2
      const pct = (x) => Math.round(((x - t.left) / t.width) * 100)
      borders.forEach((x, i) => {
        const active = i === which && state !== 'idle'
        if (active && state === 'drag') {
          k.add(`<div class="v42-x v42-fixed v42-hline ghost" style="left:${x}px;top:${t.top}px;height:${t.height}px"></div>`)
          return
        }
        k.add(`<div class="v42-x v42-fixed v42-hline${active ? ' hot' : ''}" style="left:${x}px;top:${t.top}px;height:${t.height}px"></div>`)
        k.add(`<div class="v42-x v42-fixed v42-knob${active ? ' hot' : ''}" style="left:${x}px;top:${ky}px"></div>`)
      })
      const x0 = borders[which]
      if (state === 'hover') {
        k.add(`<div class="v42-x v42-fixed v42-cursor" style="left:${x0 + 1}px;top:${ky + 22}px">${IC.colResize}</div>`)
        const tip = k.add(`<div class="v42-x v42-fixed v42-tip" style="left:0;top:0">${T.tip}</div>`)
        const tr = tip.getBoundingClientRect()
        tip.style.left = `${Math.round(x0 + 16)}px`
        tip.style.top = `${Math.round(ky + 30)}px`
        return { pct: pct(x0), tip: tr.width }
      }
      if (state === 'drag') {
        // 動かせる範囲（となりの2列が、どちらも MIN% 以上）。線は 5% ごとに止まる
        const leftEdge = which === 0 ? t.left : borders[which - 1]
        const rightEdge = which === borders.length - 1 ? t.right : borders[which + 1]
        const a = pct(leftEdge)
        const b = pct(rightEdge)
        const lo = Math.ceil((a + MIN) / 5) * 5
        const hi = Math.floor((b - MIN) / 5) * 5
        const nx = t.left + (t.width * to) / 100
        k.add(`<div class="v42-x v42-fixed v42-hline hot" style="left:${nx}px;top:${t.top}px;height:${t.height}px"></div>`)
        k.add(`<div class="v42-x v42-fixed v42-knob hot" style="left:${nx}px;top:${ky}px"></div>`)
        k.add(`<div class="v42-x v42-fixed v42-cursor" style="left:${nx + 1}px;top:${ky + 22}px">${IC.colResize}</div>`)
        // となりの2列の、新しい幅（線の上に小さな札。左の列｜右の列。仕切りが線の真上に来るように置く）
        const el = k.add(`<div class="v42-x v42-fixed v42-drag" style="left:0;top:0"><span>${to - a}%</span><i></i><span>${b - to}%</span></div>`)
        const r = el.getBoundingClientRect()
        const bar = el.querySelector('i').getBoundingClientRect()
        el.style.left = `${Math.round(nx - (bar.left + bar.width / 2 - r.left))}px`
        el.style.top = `${Math.round(t.top - r.height - 5)}px`
        return { range: [lo, hi], from: pct(x0), to, widths: [to - a, b - to] }
      }
      return { borders: borders.map(pct) }
    },
    { T, IC, state, which, to, MIN },
  )

/** 写す範囲：左の道具の、列の幅・左端の列・行の高さの所（案の形） */
const SWITCH = () => {
  const p = document.querySelector('.palette').getBoundingClientRect()
  const s = document.querySelector('.v42-pal').getBoundingClientRect()
  return { x: Math.round(p.left) - 6, y: Math.round(s.top) - 3, width: Math.round(p.width) + 12, height: Math.round(s.height) + 10 }
}
/** 写す範囲：左の道具と表（いまの絵） */
const PAL_TABLE = () => {
  const p = document.querySelector('.palette').getBoundingClientRect()
  const cur = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current')
  const t = cur.querySelector('.data-table[data-table-id="t1"]').getBoundingClientRect()
  const x = Math.round(p.left) - 12
  const y = Math.max(0, Math.round(Math.min(p.top, t.top)) - 12)
  const right = Math.round(t.right) + 16
  const bottom = Math.min(innerHeight, Math.round(Math.max(p.bottom, t.bottom)) + 16)
  return { x, y, width: right - x, height: bottom - y }
}
/** 写す範囲：表（と、タイトル・下の余白） */
const TABLE = (pad = 18) => `(() => {
  const cur = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current')
  const t = cur.querySelector('.data-table[data-table-id="t1"]').getBoundingClientRect()
  const x = Math.round(t.left) - ${pad}
  const y = Math.max(0, Math.round(t.top) - ${pad})
  return { x, y, width: Math.round(t.width) + ${pad} * 2, height: Math.min(innerHeight - y, Math.round(t.height) + ${pad} * 2 + 6) }
})()`

async function pcShots(browser) {
  const { context, page } = await open(browser, 'pc')
  await parkMouse(page)

  // ---- いま（そろえる。セルを書いているとき） ----
  await openCell(page, 'm2:feat', 'pc')
  await parkMouse(page)
  await shot(page, 'now-pc', PAL_TABLE)

  // ---- 切り替え：パソコンは3つを縦に並べる（押した所へすぐ変わる）。自分で決めるは、いまの幅（そろえるの 25% ずつ）から始まる ----
  for (const mode of ['equal', 'auto', 'custom']) {
    await goTable(page)
    await setWidths(page, mode, [25, 25, 25, 25])
    await openCell(page, 'm2:feat', 'pc')
    await parkMouse(page)
    const pal = await drawPalette(page, mode)
    console.log(`    左の道具（${mode}）：下の端 ${pal.bottom}px・中の高さ ${pal.h}px${pal.overflow ? '（はみ出して、左の道具の中が動く）' : ''}`)
    if (mode === 'custom') await drawHandles(page, 'idle')
    await shot(page, `sw-pc-${mode}`, SWITCH)
    await shot(page, `sw-pc-${mode}-table`, TABLE())
    await page.evaluate(() => window.__v42.clear())
  }

  // ---- 自分で決める：書いているとき（つまみ）・線にマウス・ドラッグ中（どれも、自分で決めるにした直後の 25% ずつの表） ----
  await drawPalette(page, 'custom')
  const idle = await drawHandles(page, 'idle')
  console.log(`    線の位置：${idle.borders.join('%・')}%`)
  await shot(page, 'c-pc-edit')
  await shot(page, 'c-pc-edit-zoom', TABLE())
  await page.evaluate(() => window.__v42.clear())
  await drawPalette(page, 'custom')
  const hov = await drawHandles(page, 'hover')
  console.log(`    マウスを乗せた線：${hov.pct}%`)
  await shot(page, 'c-pc-hover')
  await shot(page, 'c-pc-hover-zoom', TABLE())
  await page.evaluate(() => window.__v42.clear())
  await drawPalette(page, 'custom')
  const drag = await drawHandles(page, 'drag')
  console.log(`    ドラッグ：${drag.from}% → ${drag.to}%（動かせる ${drag.range.join('〜')}%）・となりの列 ${drag.widths.join('%・')}%`)
  await shot(page, 'c-pc-drag')
  await shot(page, 'c-pc-drag-zoom', TABLE(22))
  await page.evaluate(() => window.__v42.clear())

  // ---- 自分で決めた幅にしたあと：書いていないときは、ふつうの表（つまみなし）・書き始めると、つまみ ----
  await goTable(page)
  await setWidths(page, 'custom')
  await parkMouse(page)
  await shot(page, 'c-pc-idle')
  await shot(page, 'c-pc-idle-zoom', TABLE())
  await openCell(page, 'm2:feat', 'pc')
  await parkMouse(page)
  await drawPalette(page, 'custom')
  const done = await drawHandles(page, 'idle')
  console.log(`    決めたあとの線の位置：${done.borders.join('%・')}%`)
  await shot(page, 'c-pc-done-zoom', TABLE())
  await page.evaluate(() => window.__v42.clear())
  await context.close()
}

// =====================================================================
// スマホ（390×844・仮のキーボード）
// =====================================================================

/** キーボードを仮に出す（iPhone と同じく、見えている所（visualViewport）が低くなる。道具はキーボードのすぐ上へ）と、仮のキーボードの絵 */
const keyboard = (page, on) =>
  page.evaluate(
    (kb, on) => {
      if (on) Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => window.innerHeight - kb })
      else delete window.visualViewport.height
      window.visualViewport.dispatchEvent(new Event('resize'))
      document.querySelector('#v42-kb')?.remove()
      if (!on) return
      const k = document.createElement('div')
      k.id = 'v42-kb'
      k.textContent = 'キーボード（仮）'
      Object.assign(k.style, { position: 'fixed', left: '0', right: '0', bottom: '0', height: `${kb}px`, zIndex: '200', pointerEvents: 'none', background: '#d3d6dc', color: '#6b6f78', display: 'grid', placeItems: 'center', font: "15px 'BIZ UDPGothic', sans-serif" })
      document.body.append(k)
    },
    KB,
    on,
  )

/**
 * スマホの道具の表の段（案の形）。本物の表の段を隠して、同じボタンで並べ直す：
 * 1段目 行を足す・列を足す・画像・行を消す・列を消す・表を削除／2段目 列の幅・行の高さ・左端の列（そろえる のときだけ）／
 * 自分で決める（案C）なら 3段目 この列を狭く・この列の幅・この列を広く・幅をそろえ直す。
 * opts：mode（'equal'・'auto'・'custom'）・chev（案B：列の幅に下向きの山）・open（案B：窓を開いている）・colw（案C の段）・pct（この列の幅）・knob（案D の一言）
 */
const drawBar = (page, opts) =>
  page.evaluate(
    ({ T, IC, opts }) => {
      const k = window.__v42
      const real = document.querySelector('.direct-bar .db-table')
      const tools = real.cloneNode(true)
      tools.classList.add('v42-x', 'v42-toggles')
      tools.removeAttribute('aria-label')
      // 本物の切り替え（列の幅・左端の列・行の高さ）を外して、同じ所に案の形を置く（並びは src/app/tableSwitches.tsx と同じ）
      tools.querySelectorAll('.db-width').forEach((b) => b.remove())
      const wv = { equal: T.wEqual, auto: T.wAuto, custom: T.wCustom }[opts.mode]
      const tg = (cls, label, value, chev) => `<button class="db-width ${cls}"><small>${label}</small><b>${value}${chev ? IC.chev : ''}</b></button>`
      const now = window.__v42now()
      const switches = `${tg(`v42-w${opts.open ? ' v42-open' : ''}`, T.width, wv, opts.chev)}${opts.mode === 'equal' ? tg('', T.left, now.label ? T.lAuto : T.lEqual) : ''}${tg('', T.height, now.heights ? T.hEqual : T.hAuto)}`
      const danger = tools.querySelector('.danger')
      if (danger) danger.insertAdjacentHTML('beforebegin', switches)
      else tools.insertAdjacentHTML('beforeend', switches)
      let html = tools.outerHTML
      if (opts.knob)
        html += `<div class="db-row db-table v42-x v42-colw"><span class="v42-khint">${T.knobHint}</span><span class="v42-pct"><small>${T.thisCol}</small><b>${opts.pct}%</b></span><button class="v42-reset">${IC.even}<span>${T.reset}</span></button></div>`
      if (opts.colw)
        html += `<div class="db-row db-table v42-x v42-colw"><button>${IC.narrow}<span>${T.narrow}</span></button><span class="v42-pct"><small>${T.thisCol}</small><b>${opts.pct}%</b></span><button>${IC.widen}<span>${T.widen}</span></button><button class="v42-reset">${IC.even}<span>${T.reset}</span></button></div>`
      k.after(real, html)
      k.hide(real)
      const bar = document.querySelector('.direct-bar').getBoundingClientRect()
      return { top: Math.round(bar.top), bottom: Math.round(bar.bottom) }
    },
    { T, IC, opts },
  )

/** 紙面を動かして、表の見出しの行が、上の帯のすぐ下に来るようにする（道具が高くなっても、選んだ列が見えるように） */
const showTableHead = (page, below = 10) =>
  page.evaluate(async (below) => {
    const cur = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current')
    const cap = cur.querySelector('.data-table[data-table-id="t1"] .table-caption').getBoundingClientRect()
    const scroller = document.querySelector('.page-scroller')
    const top = document.querySelector('.phone-head, .app-head, header')?.getBoundingClientRect().bottom ?? scroller.getBoundingClientRect().top
    scroller.scrollTop += cap.top - top - below
    await new Promise((r) => setTimeout(r, 300))
    return { scroller: scroller.scrollTop, head: Math.round(top) }
  }, below)

/** 選んだ列（col：0 から）を、うすく色付けする（上の帯から道具の上まで） */
const drawColumn = (page, col) =>
  page.evaluate((col) => {
    const k = window.__v42
    const cur = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current')
    const table = cur.querySelector('.data-table[data-table-id="t1"] table')
    const t = table.getBoundingClientRect()
    const th = [...table.querySelectorAll('thead th')][col].getBoundingClientRect()
    const head = document.querySelector('.page-scroller').getBoundingClientRect()
    const bar = document.querySelector('.direct-bar').getBoundingClientRect()
    const top = Math.max(t.top, head.top)
    const bottom = Math.min(t.bottom, bar.top)
    k.add(`<div class="v42-x v42-fixed v42-colhl" style="left:${th.left}px;top:${top}px;width:${th.width}px;height:${bottom - top}px"></div>`)
    k.add(`<div class="v42-x v42-fixed v42-coledge" style="left:${th.left - 1}px;top:${top - 1}px;width:${th.width + 2}px;height:${bottom - top + (t.bottom > bar.top ? 4 : 2)}px"></div>`)
    return { left: th.left, right: th.right, top, bottom }
  }, col)

/** 指を置いた所 */
const tapAt = (page, x, y) => page.evaluate((x, y) => window.__v42.add(`<div class="v42-x v42-fixed v42-tap" style="left:${x}px;top:${y}px"></div>`), x, y)
const centerOf = (page, sel) =>
  page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  }, sel)

/** 案B：列の幅のボタンの上に、3つから選ぶ小さな窓 */
const drawPopover = (page, mode) =>
  page.evaluate(
    ({ T, mode }) => {
      const k = window.__v42
      const btn = document.querySelector('.direct-bar .v42-w').getBoundingClientRect()
      const op = (m, label, sub) => `<div class="op${m === mode ? ' on' : ''}"><span class="rd"></span><span><b>${label}</b><small>${sub}</small></span></div>`
      const el = k.add(
        `<div class="v42-x v42-fixed v42-pop" style="left:0;top:0"><div class="hd">${T.width}</div>${op('equal', T.wEqual, T.popEqualSub)}${op('auto', T.wAuto, T.popAutoSub)}${op('custom', T.wCustom, T.popCustomSub)}</div>`,
      )
      const r = el.getBoundingClientRect()
      const left = Math.max(8, Math.min(innerWidth - r.width - 8, btn.left - 6))
      el.style.left = `${left}px`
      el.style.top = `${Math.round(btn.top - r.height - 10)}px`
      el.style.setProperty('--tail', `${Math.round(btn.left + btn.width / 2 - left - 6)}px`)
    },
    { T, mode },
  )

/** 案D：選んだ列の両側の線に、指で動かす丸いつまみ（見出しの行の高さ）と、列の幅の札 */
const drawPhoneKnobs = (page, col) =>
  page.evaluate(
    ({ IC, col }) => {
      const k = window.__v42
      const cur = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current')
      const table = cur.querySelector('.data-table[data-table-id="t1"] table')
      const t = table.getBoundingClientRect()
      const head = table.querySelector('thead tr').getBoundingClientRect()
      const ths = [...table.querySelectorAll('thead th')].map((th) => th.getBoundingClientRect())
      const bar = document.querySelector('.direct-bar').getBoundingClientRect()
      const ky = head.top + head.height / 2
      const xs = []
      if (col > 0) xs.push((ths[col - 1].right + ths[col].left) / 2)
      if (col < ths.length - 1) xs.push((ths[col].right + ths[col + 1].left) / 2)
      const bottom = Math.min(t.bottom, bar.top)
      for (const x of xs) {
        k.add(`<div class="v42-x v42-fixed v42-pline" style="left:${x}px;top:${t.top}px;height:${bottom - t.top}px"></div>`)
        k.add(`<div class="v42-x v42-fixed v42-pknob" style="left:${x}px;top:${ky}px">${IC.lr}</div>`)
      }
      return { xs: xs.map(Math.round), right: xs.at(-1), ky }
    },
    { IC, col },
  )

/** 写す範囲：道具（キーボードの上）。above：上に含める高さ */
const BAR = (above = 0) => `(() => {
  const b = document.querySelector('.direct-bar').getBoundingClientRect()
  const pop = document.querySelector('.v42-pop')?.getBoundingClientRect()
  const y = Math.max(0, Math.round(Math.min(b.top - ${above}, pop ? pop.top - 10 : Infinity)))
  return { x: 0, y, width: innerWidth, height: Math.round(b.bottom) - y + 8 }
})()`
/** 写す範囲：表の段（2段目まで）だけ */
const TOGGLES = () => {
  const rows = [...document.querySelectorAll('.direct-bar .v42-toggles, .direct-bar .v42-colw')].map((e) => e.getBoundingClientRect())
  const y = Math.round(rows[0].top) - 6
  const bottom = Math.round(Math.max(...rows.map((r) => r.bottom))) + 6
  return { x: 0, y, width: innerWidth, height: bottom - y }
}

async function phoneShots(browser) {
  const { context, page } = await open(browser, 'phone')

  // ---- いま（そろえる。セルを書いているとき） ----
  await openCell(page, 'm2:feat', 'phone')
  await keyboard(page, true)
  await sleep(700)
  await showTableHead(page)
  await shot(page, 'now-ph')
  await shot(page, 'now-ph-bar', BAR())

  // ---- 案A：押すたびに切り替え（そろえる → 中身に合わせる → 自分で決める → そろえる） ----
  for (const [i, mode] of ['equal', 'auto', 'custom'].entries()) {
    await drawBar(page, { mode, colw: mode === 'custom', pct: 25 })
    const c = await centerOf(page, '.direct-bar .v42-w')
    await tapAt(page, c.x, c.y)
    if (i === 0) await shot(page, 'a-ph')
    await shot(page, `a-ph-${i + 1}`, TOGGLES)
    await page.evaluate(() => window.__v42.clear())
  }

  // ---- 案B：押すと3つから選ぶ（小さな窓） ----
  await drawBar(page, { mode: 'equal', chev: true })
  await shot(page, 'b-ph-closed', BAR())
  await page.evaluate(() => window.__v42.clear())
  await drawBar(page, { mode: 'equal', chev: true, open: true })
  await drawPopover(page, 'equal')
  await shot(page, 'b-ph')
  await shot(page, 'b-ph-zoom', BAR())
  await page.evaluate(() => window.__v42.clear())
  await keyboard(page, false)

  // ---- 案C：自分で決める。セルを押すと、その列をうすく色付け。道具に「この列を狭く」「この列を広く」 ----
  await page.evaluate(() => window.__editor.finishEditing())
  await ready(page)
  await setWidths(page, 'custom')
  await goTable(page)
  await openCell(page, 'm2:feat', 'phone')
  await keyboard(page, true)
  await sleep(700)
  await drawBar(page, { mode: 'custom', colw: true, pct: CUSTOM[2] })
  await showTableHead(page)
  await drawColumn(page, 2)
  await shot(page, 'c-ph')
  await shot(page, 'c-ph-bar', BAR())
  await shot(page, 'c-ph-paper', () => {
    const head = document.querySelector('.page-scroller').getBoundingClientRect()
    const bar = document.querySelector('.direct-bar').getBoundingClientRect()
    const y = Math.round(head.top)
    return { x: 0, y, width: innerWidth, height: Math.round(bar.bottom) - y + 6 }
  })
  await page.evaluate(() => window.__v42.clear())

  // ---- 案D：つまみを指で動かす ----
  await drawBar(page, { mode: 'custom', knob: true, pct: CUSTOM[2] })
  await showTableHead(page)
  await drawColumn(page, 2)
  const kn = await drawPhoneKnobs(page, 2)
  await tapAt(page, kn.right, kn.ky)
  await shot(page, 'd-ph')
  await shot(page, 'd-ph-paper', () => {
    const head = document.querySelector('.page-scroller').getBoundingClientRect()
    const bar = document.querySelector('.direct-bar').getBoundingClientRect()
    const y = Math.round(head.top)
    return { x: 0, y, width: innerWidth, height: Math.round(bar.bottom) - y + 6 }
  })
  await page.evaluate(() => window.__v42.clear())
  await keyboard(page, false)
  await context.close()
}

// =====================================================================
// 仕上がりの紙面（PDF と同じ紙面。そろえる・中身に合わせる・自分で決める）
// =====================================================================
async function paperShots(browser) {
  const { context, page } = await open(browser, 'pc')
  await page.setViewport({ ...PC, deviceScaleFactor: 2.5 })
  await sleep(600)
  await ready(page)
  await installKit(page)
  // 紙面の右下に重なる「全体・見開き・拡大」と、左右の矢印は写さない
  await page.addStyleTag({ content: '.zoom, .arrow { visibility: hidden !important; }' })
  const PAGE = () => {
    const ed = window.__editor
    const r = ed.pageElements()[ed.getSnapshot().page].getBoundingClientRect()
    return { x: r.left, y: r.top, width: r.width, height: r.height }
  }
  for (const mode of ['equal', 'auto', 'custom']) {
    await setWidths(page, mode)
    await goTable(page)
    await parkMouse(page)
    const g = await tableGeom(page)
    const ws = g.cols.map((c) => Math.round(((c.right - c.left) / g.width) * 100))
    console.log(`    紙面（${mode}）：列の幅 ${ws.join('%・')}%・表の高さ ${Math.round(g.height)}px`)
    await shot(page, `p-${mode}`, PAGE)
    await shot(page, `p-${mode}-table`, TABLE(14))
  }
  await context.close()
}

// =====================================================================
// 一覧のページ（mockups/v42/review.html）を1枚の画像にする（shots/review-table-widths.png）
// =====================================================================
async function reviewShots(browser) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 })
  await page.goto(`${APP}/${DIR}/review.html`, { waitUntil: 'networkidle0' })
  // スクロールバーの分だけ幅が狭くならないように（画像の幅をちょうど 1200px に）
  await page.addStyleTag({ content: 'html { scrollbar-width: none; }' })
  await page.evaluate(() => document.fonts.ready)
  await sleep(300)
  // 確かめ：1字だけの行がないか（一覧のページの文すべて）
  const bad = await page.evaluate(() => {
    const out = []
    const blocks = [...document.querySelectorAll('h1, h2, p, li, figcaption b, figcaption span, small, td, th, .pw > div, .note p, .common li, .ask li')]
    for (const el of blocks) {
      const lines = []
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
          if (top === null || r.top - top > r.height / 2) {
            lines.push('')
            top = r.top
          }
          lines[lines.length - 1] += n.nodeValue[i]
        }
      }
      if (lines.length > 1 && lines.some((l) => l.length === 1)) out.push(lines.join('／'))
    }
    return [...new Set(out)]
  })
  if (bad.length) console.log(`  ！一覧のページ：1字だけの行\n    ${bad.join('\n    ')}`)
  await page.screenshot({ path: `${OUT}/review-table-widths.png`, fullPage: true })
  console.log('✓ review-table-widths')
  await page.close()
}

await withEdge(async (browser) => {
  if (want('pc')) await pcShots(browser)
  if (want('phone')) await phoneShots(browser)
  if (want('paper')) await paperShots(browser)
  if (want('review')) await reviewShots(browser)
})
