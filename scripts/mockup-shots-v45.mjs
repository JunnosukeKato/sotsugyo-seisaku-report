// デザイン案 v45（表の形の整え方を分かりやすく）を画像に書き出す。
// 依頼者（先生）の声：「表の列幅に対する調整・設定のボタンが使いにくかったり、見にくかったり、わかりにくかったりします」。
// 使うのは Word に慣れていない学生。いまの道具（パソコン：左の道具 src/app/Palette.tsx の表の所・src/app/tableSwitches.tsx、
// スマホ：キーボードの上の道具の表の段 src/app/Phone.tsx・列の幅の小さな窓 src/app/WidthMenu.tsx、列の線のつまみ src/editor/columnHandles.ts）を写し、
// 3つの案を、本物の画面に案の CSS と部品だけを書き足して写す（src/ は変えない）。
//   now   ：いまの画面（パソコン 1366×768・1280×720・ブラウザの中の 1280×586／1366×634、スマホ 390×844・仮のキーボード）。
//           分かりにくい所に番号（①言葉 ②押す前に分からない ③3つに分かれる ④小さい ⑤スマホの段が横に動く ⑥割合の数 ⑦左の道具がはみ出す）を付け、ボタンの大きさ・道具の高さを測る
//   a     ：案A 「表の形を整える」の窓（左の道具にボタン1つ。押すと、絵の付いた選び方の窓。スマホは「表の形」から下に出る欄）
//   b     ：案B 紙面の上の道具（書いている表のすぐ上に、小さな道具の帯「行・列／列の幅／行の高さ／画像／表を削除」。押すと、絵の付いた小さなメニュー）
//   c     ：案C 2段がまえ（左の道具は、よく使うものだけ。「表の設定…」で、表の見本を見ながら決める窓。「決定」「やめる」）
//   どの案でも：言葉は押すとどうなるかで書き、表の小さな絵を付ける。パソコンの「自分で決める」は、はっきりしたつまみと「せまくなる」「広くなる」の札（数は出さない）
//   review：一覧のページ（mockups/v45/review.html）を1枚の画像にする（shots/review-table-settings.png。幅 1200px）
// 学生用ツールは、Google のログインとドライブを偽物（scripts/e2e/fakeGoogle.mjs）に差し替えて開く（本物の Google にはつながない）。
// 見本の原稿の素材表（名称・使用箇所・生地見本）に、説明の列「特徴」を足して、幅を変えたくなる表にする（v42 と同じ）。
// 使い方: node scripts/mockup-shots-v45.mjs [now] [a] [b] [c] [review]（何も付けなければ全部。開発サーバーが http://localhost:5173 で動いていること）
//   Edge は EDGE_PORT（ふだんは 9811）で起動する。開発サーバーを別に立てたときは APP_URL（ツール）と REVIEW_URL（一覧のページ）で指す
//   （例：APP_URL=http://127.0.0.1:5191 REVIEW_URL=http://127.0.0.1:5191 node scripts/mockup-shots-v45.mjs）
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

process.env.EDGE_PORT ??= '9811'
const { withEdge } = await import('./poc/edge.mjs')
const { openTool, ready } = await import('./video/session.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
/** 一覧のページを開く所（ふだんの開発サーバー） */
const REVIEW_APP = process.env.REVIEW_URL ?? 'http://localhost:5173'
const DIR = 'mockups/v45'
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })
const ONLY = process.argv.slice(2)
const want = (k) => ONLY.length === 0 || ONLY.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** ノートパソコン（いちばん多い形）と、画面の低いノートパソコン。近くで見る絵のため、1.5倍の細かさで撮る */
const PC = { width: 1366, height: 768, deviceScaleFactor: 1.5 }
const PC_LOW = { width: 1280, height: 720, deviceScaleFactor: 1.5 }
/**
 * 1280×720・1366×768 の画面で、ブラウザ（Edge）を画面いっぱいに開いたときの、ページに使える所（下のタスクバー 48px と、
 * ブラウザのタブと住所の帯 86px ほどを引いた高さ）
 */
const BROWSER_LOW = { width: 1280, height: 586, deviceScaleFactor: 1.5 }
const BROWSER_MID = { width: 1366, height: 634, deviceScaleFactor: 1.5 }
/** 仮に出すキーボードの高さ（iPhone の日本語のキーボードほど。scripts/e2e/phoneDirect.mjs と同じ） */
const KB = 336
/** 数えたこと（一覧のページの数は、ここから書く） */
const FACTS = {}

// ---- 見本の表（素材表に「特徴」の列を足す。列は 名称・使用箇所・特徴・生地見本） ----
const FEAT = {
  head: '特徴',
  rows: ['やわらかい光沢があり、照明が当たると表面が光る', '薄く透ける。腕を動かすと、風に揺れて見える', '張りがあって丈夫。しゃがんでも形がくずれにくい'],
}
/** 自分で決めた幅（%。名称・使用箇所・特徴・生地見本。合計 100） */
const CUSTOM = [25, 20, 35, 20]

// =====================================================================
// 共通の道具（ページの中で部品を足す・隠す・元に戻す。v42 と同じ形）
// =====================================================================

/** 案の部品の見た目（下で案ごとに足す）。色と書体は src/tokens.css・src/index.css のもの */
let CSS = `
  .v45-x { box-sizing: border-box; font-family: 'BIZ UDPGothic', sans-serif; word-break: keep-all; overflow-wrap: anywhere; }
  .v45-x * { box-sizing: border-box; }
  [data-v45-hidden] { display: none !important; }
  .v45-fixed { position: fixed; }
  /* いまの画面の、分かりにくい所の番号 */
  .v45-num { z-index: 90; display: grid; place-items: center; width: 24px; height: 24px; margin: -12px 0 0 -12px; border-radius: 50%; background: #c0392b; color: #fff; font: 700 13.5px/1 'BIZ UDPGothic', sans-serif; box-shadow: 0 0 0 2.5px #fff, 0 2px 5px rgba(0, 0, 0, 0.3); pointer-events: none; }
  .v45-ring { z-index: 89; border: 2.5px solid #c0392b; border-radius: 8px; pointer-events: none; box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.85); }
  /* スマホ：指を置いた所 */
  .v45-tap { z-index: 95; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; background: rgba(47, 62, 117, 0.12); border: 2px solid rgba(47, 62, 117, 0.6); pointer-events: none; }
  /* パソコン：マウスのカーソル */
  .v45-cursor { z-index: 96; width: 22px; height: 22px; pointer-events: none; }
  .v45-cursor.lr { width: 26px; height: 26px; margin: -13px 0 0 -13px; }
  .v45-cursor svg { display: block; width: 100%; height: 100%; filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.25)); }
`

async function installKit(page) {
  await page.evaluate((css) => {
    document.getElementById('v45-style')?.remove()
    const style = document.createElement('style')
    style.id = 'v45-style'
    style.textContent = css
    document.head.append(style)
    window.__v45 = {
      add(html, parent = document.body) {
        parent.insertAdjacentHTML('beforeend', html)
        return parent.lastElementChild
      },
      hide(el) {
        el?.setAttribute('data-v45-hidden', '')
      },
      after(el, html, before = false) {
        el.insertAdjacentHTML(before ? 'beforebegin' : 'afterend', html)
        return before ? el.previousElementSibling : el.nextElementSibling
      },
      clear() {
        document.querySelectorAll('.v45-x').forEach((e) => e.remove())
        document.querySelectorAll('[data-v45-hidden]').forEach((e) => e.removeAttribute('data-v45-hidden'))
      },
      /** 見本の表（t1）の、いまの形 */
      table() {
        return window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === 't1')
      },
      /** 見ているページの、見本の表（紙面） */
      paperTable() {
        const cur = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current')
        return cur?.querySelector('.data-table[data-table-id="t1"]')
      },
    }
  }, CSS)
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

/** 見本の表の形を決める（本物の組版で組み直す）。widths：'equal'・'auto'・'custom'。label：左端の列を字に合わせる。heights：'equal'・'auto' */
async function setTable(page, { widths = 'equal', colWidths = CUSTOM, label = false, heights = 'equal' } = {}) {
  await page.evaluate(
    ({ widths, colWidths, label, heights }) => {
      window.__editor.update((r) => ({
        ...r,
        body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === 't1' ? { ...b, widths, colWidths, labelColumn: label, heights } : b)) })),
      }))
    },
    { widths, colWidths, label, heights },
  )
  await sleep(300)
  await ready(page)
  await sleep(300)
}

/**
 * 確かめ：横にはみ出していないか・案の部品が画面の外に出ていないか・1字だけの行がないか（案の部品の文）・
 * スマホの案のボタンは 44px 以上か・左の道具の中が動く（はみ出している）か
 */
const audit = (page, name) =>
  page
    .evaluate(() => {
      const bad = []
      const info = []
      const lines = (el) => {
        const out = []
        let top = null
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (n.parentElement?.closest('svg')) continue
          for (let i = 0; i < n.nodeValue.length; i++) {
            if (/\s/.test(n.nodeValue[i])) continue
            const range = document.createRange()
            range.setStart(n, i)
            range.setEnd(n, i + 1)
            const r = range.getClientRects()[0]
            if (!r || !r.width) continue
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
      for (const el of document.querySelectorAll('.v45-x.v45-fixed, .v45-x.v45-box')) {
        const r = el.getBoundingClientRect()
        if (!r.width || el.classList.contains('v45-num') || el.classList.contains('v45-ring')) continue
        if (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1 || r.top < -1) bad.push(`画面の外：${el.className}（${Math.round(r.left)},${Math.round(r.top)}〜${Math.round(r.right)},${Math.round(r.bottom)}）`)
      }
      // 案の部品の文：1字だけの行（いちばん内側の文の要素ごと）
      for (const el of document.querySelectorAll('.v45-x *, .v45-x')) {
        if (!el.getBoundingClientRect().width || el.closest('svg')) continue
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim())
        if (!own) continue
        const ls = lines(el)
        if (ls.length > 1 && ls.some((l) => l.length === 1)) bad.push(`1字だけの行：${ls.join('／')}`)
      }
      // スマホ：案のボタンは 44px 以上
      if (innerWidth < 500) {
        for (const b of document.querySelectorAll('.v45-x button, .v45-x [role=button]')) {
          const r = b.getBoundingClientRect()
          if (!r.width || b.closest('.v45-nohit')) continue
          if (r.width < 44 - 0.5 || r.height < 44 - 0.5) bad.push(`小さいボタン：${b.textContent.trim().slice(0, 14)}（${Math.round(r.width)}×${Math.round(r.height)}）`)
        }
        // 道具の段が横に動く
        for (const row of document.querySelectorAll('.direct-bar .db-row')) {
          if (!row.getBoundingClientRect().width) continue
          if (row.scrollWidth > row.clientWidth + 1) info.push(`道具の段が横に動く（中身 ${row.scrollWidth}px／見える所 ${row.clientWidth}px）`)
        }
      }
      const p = document.querySelector('.palette')
      if (p && p.getBoundingClientRect().width) {
        const r = p.getBoundingClientRect()
        if (p.scrollHeight > p.clientHeight + 1) info.push(`左の道具の中が動く（中身 ${p.scrollHeight}px／見える所 ${p.clientHeight}px）`)
        else info.push(`左の道具：下の端 ${Math.round(r.bottom)}px／画面 ${innerHeight}px`)
      }
      return { bad, info }
    })
    .then(({ bad, info }) => {
      if (bad.length) console.log(`  ！${name}：${[...new Set(bad)].join(' ／ ')}`)
      if (info.length) console.log(`    ${name}：${info.join(' ／ ')}`)
      FACTS[name] = { bad: [...new Set(bad)], info }
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
async function open(browser, device, viewport = PC) {
  for (let i = 0; ; i++) {
    let opened
    try {
      opened = await openTool(browser, { device })
      const { page } = opened
      if (device === 'pc') {
        await page.setViewport(viewport)
        await sleep(600)
        await ready(page)
      }
      await installKit(page)
      await addFeatureColumn(page)
      await sleep(500)
      await ready(page)
      await setTable(page, { widths: 'equal', label: true, heights: 'equal' })
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

/** 見ているページの表の、列の線の位置など（画面の座標） */
const tableGeom = (page) =>
  page.evaluate(() => {
    const cur = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current')
    const table = cur.querySelector('.data-table[data-table-id="t1"] table')
    const t = table.getBoundingClientRect()
    const head = table.querySelector('tr').getBoundingClientRect()
    const ths = [...table.querySelector('tr').children].map((th) => th.getBoundingClientRect())
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
      borders: ths.slice(0, -1).map((r, i) => (r.right + ths[i + 1].left) / 2),
      cap: { left: cap.left, top: cap.top, right: cap.right, bottom: cap.bottom },
      page: cur.getBoundingClientRect().toJSON(),
    }
  })

/** キーボードを仮に出す（iPhone と同じく、見えている所（visualViewport）が低くなる。道具はキーボードのすぐ上へ）と、仮のキーボードの絵 */
const keyboard = (page, on) =>
  page.evaluate(
    (kb, on) => {
      if (on) Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => window.innerHeight - kb })
      else delete window.visualViewport.height
      window.visualViewport.dispatchEvent(new Event('resize'))
      document.querySelector('#v45-kb')?.remove()
      if (!on) return
      const k = document.createElement('div')
      k.id = 'v45-kb'
      k.textContent = 'キーボード（仮）'
      Object.assign(k.style, { position: 'fixed', left: '0', right: '0', bottom: '0', height: `${kb}px`, zIndex: '200', pointerEvents: 'none', background: '#d3d6dc', color: '#6b6f78', display: 'grid', placeItems: 'center', font: "15px 'BIZ UDPGothic', sans-serif" })
      document.body.append(k)
    },
    KB,
    on,
  )

/** 紙面を動かして、表のタイトルが上の帯のすぐ下に来るようにする */
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

/** 指を置いた所 */
const tapAt = (page, x, y) => page.evaluate((x, y) => window.__v45.add(`<div class="v45-x v45-fixed v45-tap" style="left:${x}px;top:${y}px"></div>`), x, y)
const centerOf = (page, sel) =>
  page.evaluate((sel) => {
    const r = document.querySelector(sel).getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  }, sel)

/** 分かりにくい所の番号（要素の左上か、x・y）。ring：要素を赤い枠で囲む */
const mark = (page, items) =>
  page.evaluate((items) => {
    for (const it of items) {
      let { x, y, ring } = it
      if (it.sel) {
        const els = [...document.querySelectorAll(it.sel)].filter((e) => e.getBoundingClientRect().width && (!it.text || e.textContent.includes(it.text)))
        if (!els.length) continue
        const rs = els.slice(0, it.count ?? 1).map((e) => e.getBoundingClientRect())
        const r = { left: Math.min(...rs.map((q) => q.left)), top: Math.min(...rs.map((q) => q.top)), right: Math.max(...rs.map((q) => q.right)), bottom: Math.max(...rs.map((q) => q.bottom)) }
        x = r.left + (it.dx ?? 0)
        y = r.top + (it.dy ?? 0)
        if (it.ring) ring = { left: r.left - 3, top: r.top - 3, width: r.right - r.left + 6, height: r.bottom - r.top + 6 }
      }
      if (ring) window.__v45.add(`<div class="v45-x v45-fixed v45-ring" style="left:${ring.left}px;top:${ring.top}px;width:${ring.width}px;height:${ring.height}px"></div>`)
      window.__v45.add(`<div class="v45-x v45-fixed v45-num" style="left:${x}px;top:${y}px">${it.n}</div>`)
    }
  }, items)

/**
 * いまの左の道具の、分かりにくい所の番号：①言葉（左端の列）②押す前にどうなるか分からない（列の幅）③3つの切り替えに分かれる（左のかっこ）④ボタンが小さい。
 * 番号は道具の右（紙面の余白）に置く
 */
const markPalette = (page) =>
  page.evaluate(() => {
    const k = window.__v45
    const pal = document.querySelector('.palette').getBoundingClientRect()
    const group = document.querySelector('.palette .group.ctx')
    const subs = [...group.querySelectorAll(':scope > .ctx-label.sub')].filter((e) => e.getBoundingClientRect().width)
    const union = (rs) => ({ left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) })
    const part = (txt) => {
      const l = subs.find((e) => e.textContent.includes(txt))
      let seg = l.nextElementSibling
      while (seg && !seg.classList.contains('seg')) seg = seg.nextElementSibling
      return union([l.getBoundingClientRect(), seg.getBoundingClientRect()])
    }
    const ring = (r, pad = 2) => k.add(`<div class="v45-x v45-fixed v45-ring" style="left:${r.left - pad}px;top:${r.top - pad}px;width:${r.right - r.left + pad * 2}px;height:${r.bottom - r.top + pad * 2}px"></div>`)
    const badge = (n, x, y) => k.add(`<div class="v45-x v45-fixed v45-num" style="left:${x}px;top:${y}px">${n}</div>`)
    const w = part('列の幅')
    const l = part('左端の列')
    const h = part('行の高さ')
    ring(w)
    badge(2, pal.right + 16, w.top + 14)
    ring(l)
    badge(1, pal.right + 16, (l.top + l.bottom) / 2)
    const small = [...group.querySelectorAll('.seg button')].filter((b) => b.getBoundingClientRect().width).at(-1).getBoundingClientRect()
    ring(small, 2)
    badge(4, pal.right + 16, (small.top + small.bottom) / 2)
    const all = union([w, l, h])
    k.add(`<div class="v45-x v45-fixed v45-bracket" style="left:${pal.left - 4}px;top:${all.top}px;height:${all.bottom - all.top}px"></div>`)
    badge(3, pal.left - 17, (all.top + all.bottom) / 2)
  })
/** ⑦ 左の道具が画面に入らない：道具を囲み、下の端に番号と一言 */
const markOverflow = (page) =>
  page.evaluate(() => {
    const k = window.__v45
    const p = document.querySelector('.palette')
    const r = p.getBoundingClientRect()
    k.add(`<div class="v45-x v45-fixed v45-ring" style="left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width + 6}px;height:${r.height + 6}px"></div>`)
    k.add(`<div class="v45-x v45-fixed v45-num" style="left:${r.right + 16}px;top:${r.bottom - 40}px">7</div>`)
    k.add(`<div class="v45-x v45-fixed v45-callout" style="left:${r.right + 32}px;top:${r.bottom - 52}px">下に、まだ<br>ボタンがある</div>`)
  })

/** 写す範囲：左の道具と表 */
const PAL_TABLE = () => {
  const p = document.querySelector('.palette').getBoundingClientRect()
  const t = window.__v45.paperTable().getBoundingClientRect()
  const x = Math.max(0, Math.round(p.left) - 12)
  const y = Math.max(0, Math.round(Math.min(p.top, t.top)) - 12)
  const right = Math.min(innerWidth, Math.round(t.right) + 16)
  const bottom = Math.min(innerHeight, Math.round(Math.max(p.bottom, t.bottom)) + 16)
  return { x, y, width: right - x, height: bottom - y }
}
/** 写す範囲：表（と、タイトル・まわりの余白） */
const TABLE = (pad = 18, top = 0) => `(() => {
  const t = window.__v45.paperTable().getBoundingClientRect()
  const x = Math.round(t.left) - ${pad}
  const y = Math.max(0, Math.round(t.top) - ${pad} - ${top})
  return { x, y, width: Math.round(t.width) + ${pad} * 2, height: Math.min(innerHeight - y, Math.round(t.bottom) - y + ${pad}) }
})()`
/** 写す範囲：スマホの道具（キーボードの上）。above：上に含める高さ */
const BAR = (above = 0) => `(() => {
  const b = document.querySelector('.direct-bar').getBoundingClientRect()
  const pop = document.querySelector('.width-pop')?.getBoundingClientRect()
  const y = Math.max(0, Math.round(Math.min(b.top - ${above}, pop ? pop.top - 10 : Infinity)))
  return { x: 0, y, width: innerWidth, height: Math.round(b.bottom) - y + 8 }
})()`

// ---- アイコン（src/app/icons.tsx と同じ線の太さ） ----
const svg = (d, w = 1.6) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const IC = {
  table: svg('<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M4 14.5h16M10 10v9M15 10v9"/>'),
  colAdd: svg('<path d="M4 5h9v14H4zM8.5 5v14M17.5 9v6M14.5 12h6"/>'),
  colRemove: svg('<path d="M4 5h9v14H4zM8.5 5v14M14.5 12h6"/>'),
  rowAdd: svg('<rect x="4" y="5" width="16" height="10" rx="1.5"/><path d="M4 10h16M12 17.5v4M10 19.5h4"/>'),
  rowRemove: svg('<rect x="4" y="5" width="16" height="10" rx="1.5"/><path d="M4 10h16M10 19.5h4"/>'),
  image: svg('<path d="M4.5 5.5h15v13h-15zM4.5 15.5l4-4 3.5 3.5 2.5-2.5 5 4M15 9.5h.01"/>'),
  remove: svg('<path d="M5 7h14M10 7V5.5h4V7M7 7l.9 12h8.2L17 7"/>'),
  undo: svg('<path d="M9 7.5L5 11.5l4 4M5 11.5h9.5a4.5 4.5 0 010 9H12"/>'),
  even: svg('<rect x="3.5" y="6" width="17" height="12" rx="1.2"/><path d="M9.2 6v12M14.8 6v12"/>'),
  chev: svg('<path d="M7 10l5 5 5-5"/>', 2.2),
  chevR: svg('<path d="M10 7l5 5-5 5"/>', 2.2),
  chevL: svg('<path d="M14 7l-5 5 5 5"/>', 2.2),
  close: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>', 2),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2.6),
  minus: svg('<path d="M6 12h12"/>', 2.2),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 2.2),
  /** 表の形（表と、整える印） */
  shape: svg('<rect x="3.5" y="5" width="17" height="14" rx="1.6"/><path d="M3.5 9.5h17M9 9.5V19M14.5 9.5V19"/><path d="M7 2.8h10" stroke-dasharray="1.6 2.2"/>'),
  /** 表の設定（歯車ではなく、表と、つまみの線） */
  settings: svg('<rect x="3.5" y="4.5" width="17" height="10" rx="1.4"/><path d="M3.5 8.5h17M10 8.5v6M4 18.5h16M8 16.8v3.4M16 16.8v3.4"/>'),
  /** 行・列 */
  rowcol: svg('<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 4.5v15M15 4.5v15"/>'),
  /** 列の幅（両向きの矢印と、2本の線） */
  widths: svg('<path d="M5 4.5v15M19 4.5v15M8 12h8M10.2 9.8 8 12l2.2 2.2M13.8 9.8 16 12l-2.2 2.2"/>'),
  /** 行の高さ（上下の矢印と、2本の線） */
  heights: svg('<path d="M4.5 5h15M4.5 19h15M12 8v8M9.8 10.2 12 8l2.2 2.2M9.8 13.8 12 16l2.2-2.2"/>'),
  /** 左右の矢印（つまみの中） */
  lr: svg('<path d="M3.5 12h17M7 8.5 3.5 12 7 15.5M17 8.5l3.5 3.5-3.5 3.5"/>', 2.4),
  /** マウスのカーソル「列の幅を変える」（col-resize。白で縁取り） */
  colResize:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4.5v15M14 4.5v15M7.5 12H2.8M5 9.5 2.5 12 5 14.5M16.5 12h4.7M19 9.5l2.5 2.5-2.5 2.5" stroke="#fff" stroke-width="4"/><path d="M10 4.5v15M14 4.5v15M7.5 12H2.8M5 9.5 2.5 12 5 14.5M16.5 12h4.7M19 9.5l2.5 2.5-2.5 2.5" stroke="#111" stroke-width="1.6"/></g></svg>',
  /** マウスの矢印 */
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2.5v17.2l4.4-4.2 2.9 6.4 2.7-1.2-2.9-6.3h6.1z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>',
}
const cursorAt = (page, x, y, kind = 'arrow') =>
  page.evaluate(
    ({ x, y, html, kind }) => window.__v45.add(`<div class="v45-x v45-fixed v45-cursor${kind === 'lr' ? ' lr' : ''}" style="left:${x}px;top:${y}px">${html}</div>`),
    { x, y, html: kind === 'lr' ? IC.colResize : IC.arrow, kind },
  )

// =====================================================================
// いま（本物の画面をそのまま写す。分かりにくい所に番号）
// =====================================================================
async function nowShots(browser) {
  // ---- パソコン 1366×768 ----
  {
    const { context, page } = await open(browser, 'pc', PC)
    await openCell(page, 'm2:feat', 'pc')
    await parkMouse(page)
    await shot(page, 'now-pc')
    await shot(page, 'now-pc-pal', PAL_TABLE)
    // 切り替えのボタンの大きさ・字の大きさ
    FACTS['now-seg'] = await page.evaluate(() => {
      const bs = [...document.querySelectorAll('.palette .group.ctx .seg button')].filter((b) => b.getBoundingClientRect().width)
      const r = bs.map((b) => b.getBoundingClientRect())
      return { count: bs.length, height: Math.round(Math.max(...r.map((q) => q.height))), width: Math.round(Math.max(...r.map((q) => q.width))), font: getComputedStyle(bs[0]).fontSize, names: bs.map((b) => b.textContent.trim()) }
    })
    console.log('    切り替えのボタン：', JSON.stringify(FACTS['now-seg']))
    // 分かりにくい所に番号（左の道具）：①言葉 ②押す前に分からない ③3つに分かれる ④小さい
    await markPalette(page)
    await shot(page, 'now-pc-pal-marked', () => {
      const p = document.querySelector('.palette').getBoundingClientRect()
      const t = window.__v45.paperTable().getBoundingClientRect()
      const x = Math.max(0, Math.round(p.left) - 34)
      const y = Math.max(0, Math.round(p.top) - 12)
      const right = Math.min(innerWidth, Math.round(p.right) + 200)
      const bottom = Math.min(innerHeight, Math.round(p.bottom) + 12)
      return { x, y, width: right - x, height: bottom - y }
    })
    await page.evaluate(() => window.__v45.clear())

    // 自分で決める：縦の線のつまみ（本物）。線にマウス・ドラッグ中（本物の「20%｜30%」）
    await goTable(page)
    await setTable(page, { widths: 'custom', colWidths: [25, 25, 25, 25], label: true })
    await openCell(page, 'm2:feat', 'pc')
    await parkMouse(page)
    await shot(page, 'now-pc-custom')
    const g = await tableGeom(page)
    const ky = (g.headTop + g.headBottom) / 2
    await page.mouse.move(g.borders[1], ky)
    await sleep(500)
    await shot(page, 'now-pc-custom-hover', TABLE(26, 10))
    await page.mouse.down()
    await page.mouse.move(g.borders[1] - g.width * 0.05, ky, { steps: 4 })
    await page.mouse.move(g.borders[1] - g.width * 0.06, ky, { steps: 2 })
    await sleep(300)
    await cursorAt(page, g.borders[1] - g.width * 0.06, ky, 'lr')
    // ⑥ 割合の数（20%｜30%）
    await mark(page, [{ n: 6, sel: '.col-drag', ring: true, dx: -8, dy: 2 }])
    await shot(page, 'now-pc-custom-drag', TABLE(26, 30))
    await page.mouse.up()
    await sleep(500)
    await page.evaluate(() => window.__v45.clear())
    await context.close()
  }

  // ---- 画面の低いノートパソコン：1280×720（画面いっぱい）と、その画面のブラウザの中（1280×586。タスクバーとブラウザの帯の分だけ低い）・
  //      1366×768 の画面のブラウザの中（1366×634）。左の道具の高さを測る ----
  {
    const { context, page } = await open(browser, 'pc', PC_LOW)
    for (const vp of [PC_LOW, BROWSER_LOW, BROWSER_MID]) {
      for (const widths of ['equal', 'custom']) {
        await page.setViewport(vp)
        await sleep(600)
        await goTable(page)
        await setTable(page, { widths, colWidths: [25, 25, 25, 25], label: true })
        await openCell(page, 'm2:feat', 'pc')
        await parkMouse(page)
        const p = await page.evaluate(() => {
          const p = document.querySelector('.palette')
          return { scroll: p.scrollHeight, client: p.clientHeight, bottom: Math.round(p.getBoundingClientRect().bottom), width: p.offsetWidth }
        })
        FACTS[`now-palette-${vp.width}x${vp.height}-${widths}`] = p
        console.log(`    ${vp.width}×${vp.height}（${widths}）：左の道具の中身 ${p.scroll}px／見える所 ${p.client}px・幅 ${p.width}px`)
        if (widths === 'equal' && vp !== BROWSER_MID) await shot(page, vp === PC_LOW ? 'now-pc-low' : 'now-pc-586')
        // ⑦ 左の道具が画面に入らない（中を動かさないと、下のボタンが見えない）
        if ((widths === 'equal' && vp === PC_LOW) || (widths === 'custom' && vp === BROWSER_LOW)) {
          if (vp === BROWSER_LOW) await shot(page, 'now-pc-586-custom')
          await markOverflow(page)
          await shot(page, vp === PC_LOW ? 'now-pc-low-pal' : 'now-pc-586-pal', () => {
            const p = document.querySelector('.palette').getBoundingClientRect()
            return { x: Math.round(p.left) - 34, y: 0, width: Math.round(p.width) + 176, height: innerHeight }
          })
          await page.evaluate(() => window.__v45.clear())
        }
      }
    }
    await context.close()
  }

  // ---- スマホ 390×844（仮のキーボード） ----
  {
    const { context, page } = await open(browser, 'phone')
    await openCell(page, 'm2:feat', 'phone')
    await keyboard(page, true)
    await sleep(700)
    await showTableHead(page)
    await shot(page, 'now-ph')
    // ⑤ 段が横に動く（右に続きがある。「行の高さ」「表を削除」は見えない）・① 言葉（左端の列・中身に合わせる）
    await mark(page, [
      { n: 5, sel: '.direct-bar .db-table', dx: 366, dy: -1 },
      { n: 1, sel: '.direct-bar .db-table button', text: '左端の列', ring: true, dx: 2, dy: 4 },
    ])
    await shot(page, 'now-ph-bar', BAR())
    await page.evaluate(() => window.__v45.clear())
    // 段を右の端までずらしたところ
    await page.evaluate(() => {
      const r = document.querySelector('.direct-bar .db-table')
      r.scrollLeft = r.scrollWidth
    })
    await sleep(300)
    await shot(page, 'now-ph-bar-end', BAR())
    await page.evaluate(() => (document.querySelector('.direct-bar .db-table').scrollLeft = 0))
    // 列の幅の小さな窓
    await page.evaluate(() => {
      const r = document.querySelector('.direct-bar .db-table')
      const b = r.querySelector('.width-menu')
      r.scrollLeft = b.offsetLeft - 100
    })
    await sleep(300)
    await page.evaluate(() => document.querySelector('.direct-bar .width-menu').click())
    await sleep(500)
    await shot(page, 'now-ph-pop')
    await page.evaluate(() => document.querySelector('.direct-bar .width-menu').click())
    await sleep(300)
    await keyboard(page, false)
    // 自分で決める：3段目と、丸いつまみ
    await goTable(page)
    await setTable(page, { widths: 'custom', label: true })
    await openCell(page, 'm2:feat', 'phone')
    await keyboard(page, true)
    await sleep(700)
    await showTableHead(page)
    await sleep(500)
    await shot(page, 'now-ph-custom')
    // ⑥ 割合の数（この列 35%）と、見出しの字に重なる丸いつまみ
    await mark(page, [
      { n: 6, sel: '.direct-bar .db-colw .db-pct', ring: true, dx: -6, dy: 4 },
      { n: 6, sel: '.col-pknob', dx: 22, dy: 6 },
    ])
    await shot(page, 'now-ph-custom-marked')
    await page.evaluate(() => window.__v45.clear())
    await keyboard(page, false)
    await context.close()
  }
}

// =====================================================================
// 案で使う言葉（review.html の「言葉の表」と同じ）。配列は、折り返してよい所で分けたもの（1字だけの行ができないように）
// =====================================================================
const T = {
  /** 案A：左の道具のボタンと、窓の名前（スマホの道具は短く「表の形」） */
  shapeBtn: ['表の形を', '整える'],
  shapeTitle: '表の形を整える',
  shapeShort: '表の形',
  /** 案C：左の道具のボタンと、窓の名前（スマホの道具は「表の設定」） */
  settingsBtn: '表の設定…',
  settingsTitle: '表の設定',
  secWidth: '列の幅',
  secHeight: '行の高さ',
  wEqual: { name: ['列の幅を', 'そろえる'], sub: ['どの列も', '同じ幅'] },
  wAuto: { name: ['字の多い列を', '広く'], sub: ['字の量に', '合わせて', '自動で'] },
  wCustom: { name: ['自分で', '決める'], subPc: ['線を', 'ドラッグ'], subPh: ['列ごとに', '広く・せまく'] },
  /** 項目の列（左端）：列の幅を「そろえる」のときだけ使える。ほかのときは、うすくして、そのわけを出す */
  label: { name: ['項目の列', '（左端）は', '字に合わせる'], sub: ['ほかの列は', '同じ幅'], off: ['「列の幅を', 'そろえる」の', 'ときだけ'] },
  heights: { name: ['行の高さを', 'そろえる'], sub: ['見出しの行は別'] },
  hEqual: { name: ['行の高さを', 'そろえる'], sub: ['見出しの行は別'] },
  hAuto: { name: ['字の量に', '合わせる'], sub: ['行ごとに', 'ちがう高さ'] },
  customGuide: ['表の縦の線を', '左右に', 'ドラッグ'],
  even: '同じ幅に戻す',
  tipHover: ['左右にドラッグして', '列の幅を変える'],
  narrower: 'せまくなる',
  wider: '広くなる',
  done: 'できた',
  ok: '決定',
  cancel: 'やめる',
  perCol: '列ごとの幅',
  narrowBtn: 'せまく',
  widenBtn: '広く',
  liveNote: ['押すと、', 'すぐ表が', '変わります'],
  /** 案B：左の道具の一言 */
  bWriting: ['表を', '書いています'],
  bWhere: ['道具は', '表の', 'すぐ上'],
  /** 案B：紙面の上の道具の、マウスを乗せたときの一言 */
  bTip: '列の幅を、絵を見て選ぶ',
  /** 案B：自分で決めるのとき、紙面の上の道具の代わりに出す一言 */
  bGuide: ['表の縦の線を、', '左右にドラッグ'],
  /** 案C：見本の説明・自分で決めるの一言 */
  preview: ['見本（「決定」を押すと、', 'この形になります）'],
  cCustom: ['列ごとに', '広く・せまく'],
  /** スマホ：自分で決めるの欄の名前と、戻るボタン */
  phCustomTitle: '列ごとの幅',
  back: '戻る',
  /** 案B：行・列のメニュー */
  rcAddRow: ['下に行を', '足す'],
  rcDelRow: ['この行を', '消す'],
  rcAddCol: ['右に列を', '足す'],
  rcDelCol: ['この列を', '消す'],
}
/** 見本の表の列の名前（見出しの行） */
const COLS = ['名称', '使用箇所', '特徴', '生地見本']
const W = (a) => (Array.isArray(a) ? a.map((s) => `<span class="ph">${s}</span>`).join('<wbr>') : a)

// ---- 表の形の小さな絵（列の幅・項目の列・行の高さ）。3列：短い項目・長い説明・写真の四角。3行と見出しの行 ----
// 押したあとの形が分かるように、表の高さも変わる（字の多い列を広くすると、表が短くなる）。絵は上にそろえる
function pic(kind) {
  const X = 2
  const Y = 2
  const HEAD = 5
  const PITCH = 2.7
  const PAD = 2.2
  const conf = {
    equal: { cols: [20, 20, 20], text: [30, 30, 30] },
    auto: { cols: [13, 34, 13], text: [30, 30, 30] },
    custom: { cols: [17, 29, 14], text: [30, 30, 30], hot: 0 },
    label: { cols: [10, 25, 25], text: [30, 30, 30], fit: true },
    hEqual: { cols: [12, 36, 12], text: [28, 90, 56], rows: 'equal' },
    hAuto: { cols: [12, 36, 12], text: [28, 90, 56] },
  }[kind]
  const shortText = 7
  const xs = [X]
  for (const c of conf.cols) xs.push(xs.at(-1) + c)
  const cw = conf.cols
  const PW = xs.at(-1) - X
  const linesOf = (amount, w) => Math.max(1, Math.ceil(amount / Math.max(3, w - 3)))
  const need = conf.text.map((a) => Math.max(linesOf(a, cw[1]), linesOf(shortText, cw[0])))
  let rows = need.map((n) => n * PITCH + PAD)
  if (conf.rows === 'equal') rows = rows.map(() => Math.max(...rows))
  const PH = HEAD + rows.reduce((a, b) => a + b, 0)
  let s = `<svg class="pic" viewBox="0 0 64 40" aria-hidden="true">`
  s += `<rect x="${X}" y="${Y}" width="${PW}" height="${HEAD}" fill="currentColor" fill-opacity="0.2"/>`
  // 見出しの行の字
  cw.forEach((w, c) => (s += `<rect x="${(xs[c] + w / 2 - Math.min(5, w - 4) / 2).toFixed(2)}" y="${Y + HEAD / 2 - 0.6}" width="${Math.min(5, w - 4).toFixed(2)}" height="1.2" rx="0.5" fill="currentColor" fill-opacity="0.75"/>`))
  // 字（棒）
  let y = Y + HEAD
  rows.forEach((rh, r) => {
    const bars = (col, amount) => {
      const avail = Math.max(3, cw[col] - 3)
      const n = linesOf(amount, cw[col])
      const top = y + rh / 2 - ((n - 1) * PITCH) / 2
      let out = ''
      for (let i = 0; i < n; i++) {
        const len = Math.min(avail, i === n - 1 ? Math.max(3, amount - avail * (n - 1)) : avail)
        out += `<rect x="${(xs[col] + (cw[col] - len) / 2).toFixed(2)}" y="${(top + i * PITCH - 0.65).toFixed(2)}" width="${len.toFixed(2)}" height="1.3" rx="0.5" fill="currentColor" fill-opacity="0.6"/>`
      }
      return out
    }
    s += bars(0, conf.fit ? cw[0] - 3 : shortText)
    s += bars(1, conf.text[r])
    const sq = Math.min(cw[2] - 4, rh - 2, 6)
    s += `<rect x="${(xs[2] + (cw[2] - sq) / 2).toFixed(2)}" y="${(y + (rh - sq) / 2).toFixed(2)}" width="${sq.toFixed(2)}" height="${sq.toFixed(2)}" rx="0.4" fill="currentColor" fill-opacity="0.45"/>`
    y += rh
  })
  // 線
  s += `<rect x="${X}" y="${Y}" width="${PW}" height="${PH.toFixed(2)}" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/>`
  s += `<path d="M${X} ${Y + HEAD}h${PW}" stroke="currentColor" stroke-width="1"/>`
  y = Y + HEAD
  for (const rh of rows.slice(0, -1)) {
    y += rh
    s += `<path d="M${X} ${y.toFixed(2)}h${PW}" stroke="currentColor" stroke-width="0.7"/>`
  }
  xs.slice(1, -1).forEach((x, i) => {
    if (conf.hot === i)
      s += `<path d="M${x.toFixed(2)} ${Y}v${PH.toFixed(2)}" stroke="currentColor" stroke-width="2"/><rect x="${(x - 4.2).toFixed(2)}" y="${Y + HEAD / 2 - 2.6}" width="8.4" height="5.2" rx="2.6" fill="currentColor"/><path d="M${(x - 2.4).toFixed(2)} ${Y + HEAD / 2}h4.8M${(x - 1.4).toFixed(2)} ${Y + HEAD / 2 - 1}l-1 1 1 1M${(x + 1.4).toFixed(2)} ${Y + HEAD / 2 - 1}l1 1-1 1" stroke="#fff" stroke-width="0.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
    else s += `<path d="M${x.toFixed(2)} ${Y}v${PH.toFixed(2)}" stroke="currentColor" stroke-width="0.8"/>`
  })
  return s + '</svg>'
}

// ---- 部品の形（文字列） ----
/** パソコン：絵と名前の選び（縦に並べる） */
const choicePc = (kind, on, t, sub = t.sub) => `<button class="v45-ch${on ? ' on' : ''}" role="radio" aria-checked="${on}"><i class="rd"></i>${pic(kind)}<span class="tx"><b>${W(t.name)}</b>${sub ? `<small>${W(sub)}</small>` : ''}</span></button>`
/** 入・切の選び（チェック。絵つき）。off：使えない（うすくして、そのわけを出す） */
const check = (kind, on, t, cls = '', off = false) =>
  `<div class="v45-cb ${cls}${on && !off ? ' on' : ''}${off ? ' off' : ''}" role="checkbox" aria-checked="${on}" aria-disabled="${off}"><i class="box">${on && !off ? IC.check : ''}</i>${kind ? pic(kind) : ''}<span class="tx"><b>${W(t.name)}</b>${(off ? t.off : t.sub) ? `<small>${W(off ? t.off : t.sub)}</small>` : ''}</span></div>`
/** 項目の列（左端）のチェック（列の幅を「そろえる」のときだけ使える） */
const labelCheck = (s, cls = '') => check('label', s.label, T.label, cls, s.widths !== 'equal')
/** 絵が上・名前が下の選び（横に3つ並べる） */
const card = (kind, on, t, sub) => `<button class="v45-card${on ? ' on' : ''}" role="radio" aria-checked="${on}">${pic(kind)}<b>${W(t.name)}</b>${sub ? `<small>${W(sub)}</small>` : ''}</button>`
/** 列ごとの幅（名前・幅の棒・せまく・広く）。cur：いま書いている列 */
const colRows = (widths, cur) =>
  COLS.map(
    (n, i) =>
      `<div class="v45-cw${i === cur ? ' cur' : ''}"><span class="nm">${n}</span><span class="bar"><i style="width:${widths[i]}%"></i></span><button class="v45-step">${IC.minus}<small>${T.narrowBtn}</small></button><button class="v45-step">${IC.plus}<small>${T.widenBtn}</small></button></div>`,
  ).join('')
const evenBtn = (cls = '') => `<button class="v45-even ${cls}">${IC.even}<span>${T.even}</span></button>`

CSS += `
  .v45-x .ph { white-space: nowrap; }
  .v45-x svg.pic { display: block; flex: none; overflow: visible; }
  .v45-nohandles .col-handles, .v45-nohandles .col-tip, .v45-nohandles .width-pop { display: none !important; }

  /* ===== 選び（パソコン：絵と名前を横に） ===== */
  .v45-ch { display: flex; align-items: center; gap: 7px; width: 100%; padding: 6px 6px 6px 7px; border: 1.5px solid #e2e0dc; border-radius: 10px; background: #fff; color: #7b7f88; text-align: left; font: inherit; cursor: pointer; }
  .v45-ch + .v45-ch, .v45-cb + .v45-ch, .v45-guide + .v45-ch, .v45-ch + .v45-cb, .v45-guide + .v45-cb { margin-top: 5px; }
  .v45-ch.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
  .v45-ch .rd { flex: none; width: 15px; height: 15px; border-radius: 50%; border: 2px solid #b9bcc4; background: #fff; }
  .v45-ch.on .rd { border-color: var(--accent); background: radial-gradient(circle, var(--accent) 0 3.2px, #fff 3.7px); }
  .v45-ch svg.pic { width: 52px; height: 32.5px; }
  .v45-ch .tx { min-width: 0; }
  .v45-ch b { display: block; font-size: 12.5px; line-height: 1.35; color: var(--ink); }
  .v45-ch.on b { color: var(--accent); }
  .v45-ch small { display: block; margin-top: 1px; font-size: 10.5px; line-height: 1.4; color: var(--muted); }

  /* ===== 入・切の選び（チェック） ===== */
  .v45-cb { display: flex; align-items: center; gap: 10px; min-height: 52px; padding: 6px 10px; border: 1.5px solid #e2e0dc; border-radius: 12px; background: #fff; color: #7b7f88; cursor: pointer; }
  .v45-cb.on { color: var(--accent); }
  .v45-cb.off { background: #f6f5f3; border-style: dashed; color: #b3b6bd; cursor: default; }
  .v45-cb.off .tx b { color: #9a9da5; }
  .v45-cb.off .box { background: #f1f0ee; border-color: #d3d5da; }
  .v45-cb .box { flex: none; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 6px; border: 2px solid #b9bcc4; background: #fff; color: #fff; }
  .v45-cb.on .box { background: var(--accent); border-color: var(--accent); }
  .v45-cb .box svg { width: 16px; height: 16px; }
  .v45-cb svg.pic { width: 52px; height: 32px; }
  .v45-cb .tx { min-width: 0; }
  .v45-cb .tx b { display: block; font-size: 14px; line-height: 1.35; color: var(--ink); }
  .v45-cb .tx small { display: block; margin-top: 1px; font-size: 12px; line-height: 1.4; color: var(--muted); }
  .v45-cb.pc { gap: 6px; min-height: 0; padding: 6px 6px 6px 7px; border-radius: 10px; }
  .v45-cb.pc .box { width: 16px; height: 16px; border-radius: 4px; }
  .v45-cb.pc .box svg { width: 12px; height: 12px; }
  .v45-cb.pc svg.pic { width: 52px; height: 32.5px; }
  .v45-cb.pc .tx b { font-size: 12.5px; line-height: 1.35; }
  .v45-cb.pc .tx small { font-size: 10.5px; }

  /* ===== 選び（絵が上・名前が下。横に3つ） ===== */
  .v45-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .v45-card { display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 5px; min-height: 96px; padding: 9px 4px 8px; border: 1.5px solid #e2e0dc; border-radius: 12px; background: #fff; color: #7b7f88; font: inherit; cursor: pointer; }
  .v45-card.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .v45-card svg.pic { width: 64px; height: 40px; }
  .v45-card b { font-size: 13.5px; line-height: 1.3; color: var(--ink); text-align: center; }
  .v45-card.on b { color: var(--accent); }
  .v45-card small { font-size: 11px; line-height: 1.35; color: var(--muted); text-align: center; }

  /* ===== 列ごとの幅（せまく・広く） ===== */
  .v45-cw { display: grid; grid-template-columns: 66px minmax(0, 1fr) auto auto; align-items: center; gap: 6px; min-height: 48px; padding: 2px 4px 2px 8px; border-radius: 10px; }
  .v45-cw + .v45-cw { margin-top: 2px; }
  .v45-cw.cur { background: var(--accent-soft); }
  .v45-cw .nm { font-size: 14px; font-weight: 700; white-space: nowrap; }
  .v45-cw.cur .nm { color: var(--accent); }
  .v45-cw .bar { height: 12px; border-radius: 6px; background: #ebe9e5; overflow: hidden; }
  .v45-cw .bar i { display: block; height: 100%; border-radius: 6px; background: var(--accent); opacity: 0.75; }
  .v45-cw .v45-step { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0; min-width: 52px; min-height: 44px; padding: 2px 6px; border: 1px solid var(--line); border-radius: 10px; background: #fff; color: var(--ink); font: inherit; }
  .v45-cw .v45-step svg { width: 16px; height: 16px; }
  .v45-cw .v45-step small { font-size: 11px; line-height: 1.2; }
  .v45-even { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-height: 30px; padding: 0 10px; border: 1px solid var(--line); border-radius: 8px; background: #fff; color: var(--accent); font: inherit; font-size: 12px; font-weight: 700; white-space: nowrap; }
  .v45-even svg { width: 16px; height: 16px; }

  /* ===== パソコン：左の道具（案A・案C のボタン、案B の一言） ===== */
  .palette .v45-big { display: flex; flex-direction: column; align-items: center; gap: 3px; width: 100%; margin: 5px 0 4px; padding: 8px 0 7px; border: 1.5px solid var(--accent); border-radius: 10px; background: #fff; color: var(--accent); font: inherit; font-size: 11px; font-weight: 700; line-height: 1.3; letter-spacing: 0.02em; }
  .palette .v45-big svg.pic { width: 40px; height: 25px; }
  .palette .v45-big > svg:not(.pic) { width: 24px; height: 24px; }
  .palette .v45-big span { display: block; white-space: nowrap; }
  .palette .v45-big.open { background: var(--accent); color: #fff; }
  .palette .v45-bnote { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 6px 2px 8px; text-align: center; }
  .palette .v45-bnote b { font-size: 12px; line-height: 1.45; color: var(--accent); }
  .palette .v45-bnote b span, .palette .v45-bnote small span { display: block; }
  .palette .v45-bnote small { font-size: 10.5px; line-height: 1.45; color: var(--muted); }
  .palette .v45-bnote svg { width: 22px; height: 22px; color: var(--accent); }

  /* ===== 案A（パソコン）：左の道具の左に開く「表の形」の窓 ===== */
  .v45-apanel { z-index: 45; padding: 8px 8px 9px; background: #fff; border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 12px 32px rgba(30, 25, 20, 0.22); color: var(--ink); }
  .v45-apanel::after { content: ''; position: absolute; right: -7px; top: var(--tail, 60px); width: 12px; height: 12px; margin-top: -6px; background: #fff; border-right: 1px solid var(--line); border-top: 1px solid var(--line); transform: rotate(45deg); }
  .v45-apanel .hd { display: flex; align-items: center; justify-content: space-between; padding: 0 0 4px 4px; }
  .v45-apanel .hd b { font-size: 14.5px; letter-spacing: 0.08em; }
  .v45-apanel .hd button { display: grid; place-items: center; width: 28px; height: 28px; border: 0; border-radius: 8px; background: none; color: var(--muted); }
  .v45-apanel .hd button svg { width: 16px; height: 16px; }
  .v45-apanel .v45-sec { margin: 9px 0 4px 4px; font-size: 11px; font-weight: 700; color: var(--muted); letter-spacing: 0.08em; }
  .v45-apanel .note { margin: 8px 2px 0; font-size: 10.5px; line-height: 1.5; color: var(--muted); text-align: center; }
  .v45-guide { display: flex; flex-direction: column; align-items: center; gap: 5px; margin: 4px 0 0 18px; padding: 7px 6px 7px; border: 1.5px dashed rgba(47, 62, 117, 0.45); border-radius: 10px; color: var(--accent); text-align: center; }
  .v45-guide p { margin: 0; font-size: 12px; font-weight: 700; line-height: 1.45; }
  .v45-guide .v45-even { min-height: 28px; font-size: 11.5px; padding: 0 8px; }

  /* ===== パソコン：表の縦の線のつまみ（はっきり見える形） ===== */
  .v45-rail { z-index: 8; width: 0; margin-left: -1px; border-left: 2px solid rgba(47, 62, 117, 0.32); pointer-events: none; }
  .v45-rail.hot { margin-left: -1.5px; border-left: 3px solid var(--accent); }
  .v45-rail.ghost { margin-left: -0.75px; border-left: 1.5px dashed rgba(47, 62, 117, 0.55); }
  /* ふだんは細いつまみ（12×28。見出しの字にかかりにくい）。マウスを乗せる・つかむと、左右の矢印の付いた大きいつまみ */
  .v45-grip { z-index: 9; display: grid; place-items: center; width: 12px; height: 28px; margin: -14px 0 0 -6px; border-radius: 6px; background: var(--accent); color: #fff; box-shadow: 0 0 0 2px #fff, 0 1px 4px rgba(0, 0, 0, 0.3); pointer-events: none; }
  .v45-grip::before { content: ''; width: 3px; height: 12px; border-left: 1.5px solid rgba(255, 255, 255, 0.85); border-right: 1.5px solid rgba(255, 255, 255, 0.85); }
  .v45-grip svg { display: none; width: 16px; height: 16px; }
  .v45-grip.hot { width: 34px; height: 24px; margin: -12px 0 0 -17px; border-radius: 12px; box-shadow: 0 0 0 2px #fff, 0 0 0 6px rgba(47, 62, 117, 0.22), 0 2px 6px rgba(0, 0, 0, 0.3); }
  .v45-grip.hot::before { display: none; }
  .v45-grip.hot svg { display: block; }
  .v45-grip.dim { opacity: 0.4; }
  .v45-tint { z-index: 7; pointer-events: none; mix-blend-mode: multiply; }
  .v45-tint.narrow { background: #ecebf0; }
  .v45-tint.wide { background: #e3e8f6; }
  .v45-chip { z-index: 10; display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 10px; border-radius: 999px; background: #23262b; color: #fff; font-size: 12.5px; font-weight: 700; white-space: nowrap; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2); transform: translateX(-50%); }
  .v45-chip.wide { background: var(--accent); }
  .v45-tipbox { z-index: 50; padding: 5px 10px; border-radius: 7px; background: #23262b; color: #fff; font-size: 12px; line-height: 1.5; white-space: nowrap; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2); }
  .v45-tipbox span.ph { display: block; }

  /* ===== 案B（パソコン）：紙面の上の道具 ===== */
  .v45-float { z-index: 40; display: flex; align-items: stretch; gap: 2px; padding: 4px; background: #fff; border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 6px 20px rgba(30, 25, 20, 0.18); }
  .v45-float::after { content: ''; position: absolute; left: var(--tail, 50%); bottom: -7px; width: 12px; height: 12px; margin-left: -6px; background: #fff; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); transform: rotate(45deg); }
  .v45-float .fb { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-width: 56px; padding: 5px 7px 4px; border: 0; border-radius: 8px; background: none; color: var(--palette-ink); font: inherit; font-size: 11px; white-space: nowrap; }
  .v45-float .fb > svg { width: 20px; height: 20px; }
  .v45-float .fb .lab { display: inline-flex; align-items: center; gap: 1px; }
  .v45-float .fb .lab svg { width: 11px; height: 11px; }
  .v45-float .fb.on { background: var(--accent-soft); color: var(--accent); font-weight: 700; }
  .v45-float .fb.danger { color: var(--error); }
  .v45-float .sep { flex: none; width: 1px; margin: 6px 2px; background: var(--line); }
  .v45-menu { z-index: 41; padding: 8px; background: #fff; border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 12px 32px rgba(30, 25, 20, 0.24); color: var(--ink); }
  .v45-menu .mh { padding: 0 4px 6px; font-size: 11.5px; font-weight: 700; color: var(--muted); letter-spacing: 0.06em; }
  .v45-menu .v45-cards { width: 318px; gap: 6px; }
  .v45-menu .v45-cards.one { width: 372px; }
  .v45-menu .v45-cards.one .v45-card { gap: 4px; padding: 7px 4px 6px; }
  .v45-menu .v45-cards.one .v45-card svg.pic { width: 54px; height: 33.75px; }
  .v45-menu .v45-cards.one .v45-card b { white-space: nowrap; }
  .v45-menu .v45-card { min-height: 0; padding: 8px 4px 7px; }
  .v45-menu .v45-card b { font-size: 12.5px; }
  .v45-menu .v45-cb { margin-top: 6px; }
  .v45-menu .v45-cb.pc svg.pic { display: block; }
  .v45-rc { display: grid; grid-template-columns: repeat(2, 132px); gap: 4px; }
  .v45-rc button { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 4px 8px; border: 0; border-radius: 8px; background: #f6f5f2; color: var(--ink); font: inherit; font-size: 12.5px; text-align: left; }
  .v45-rc button svg { flex: none; width: 20px; height: 20px; color: var(--palette-ink); }
  .v45-rc button.add svg { color: var(--accent); }
  .v45-rc button b { font-weight: 400; line-height: 1.35; }
  .v45-menu .v45-cards.two { grid-template-columns: repeat(2, minmax(0, 1fr)); width: 230px; }
  /* 案B：自分で決めるのとき、紙面の上の道具の代わりに出す帯（一言・同じ幅に戻す・できた） */
  .v45-float.v45-gbar { align-items: center; gap: 8px; padding: 5px 6px 5px 12px; }
  .v45-float.v45-gbar > svg { flex: none; width: 22px; height: 22px; color: var(--accent); }
  .v45-float.v45-gbar p { margin: 0; font-size: 12.5px; font-weight: 700; line-height: 1.45; color: var(--accent); }
  .v45-float.v45-gbar .ok { min-height: 34px; padding: 0 16px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; font: inherit; font-size: 12.5px; font-weight: 700; white-space: nowrap; }
  .v45-float.v45-gbar .v45-even { min-height: 34px; }

  /* ===== 案C（パソコン）：表の設定の窓（見本つき） ===== */
  .v45-backdrop { z-index: 80; inset: 0; background: rgba(30, 25, 20, 0.38); }
  .v45-dlg { z-index: 81; display: flex; flex-direction: column; border-radius: 16px; background: #fff; box-shadow: 0 18px 48px rgba(0, 0, 0, 0.3); color: var(--ink); overflow: hidden; }
  .v45-dlg .dh { display: flex; align-items: baseline; gap: 12px; padding: 13px 20px 11px; border-bottom: 1px solid var(--line); }
  .v45-dlg .dh b { font-size: 17px; letter-spacing: 0.06em; }
  .v45-dlg .dh small { font-size: 13px; color: var(--muted); }
  .v45-dlg .bd { display: grid; grid-template-columns: minmax(0, 1fr) 300px; min-height: 0; }
  .v45-dlg .pv { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 12px 18px; background: #f4f2ee; }
  .v45-dlg .pv p { margin: 0; font-size: 12px; color: var(--muted); text-align: center; }
  .v45-dlg .pv .v45-stage { position: relative; }
  .v45-dlg .pv img { display: block; max-width: 100%; background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.14); }
  .v45-dlg .op { padding: 10px 16px 12px; border-left: 1px solid var(--line); }
  .v45-dlg .v45-sec { display: flex; align-items: center; justify-content: space-between; margin: 12px 0 6px 2px; font-size: 11.5px; font-weight: 700; color: var(--muted); letter-spacing: 0.06em; }
  .v45-dlg .v45-sec:first-child { margin-top: 0; }
  /* 案C：自分で決めるのとき、見本の下に列ごとの「せまく」「広く」。書いているマスの列は、見本にも色 */
  .v45-dlg .pv .colhl { position: absolute; bottom: 0; border: 2px solid var(--accent); background: rgba(47, 62, 117, 0.1); pointer-events: none; }
  .v45-dlg .cbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; margin-top: 2px; }
  .v45-dlg .cbar b { font-size: 12.5px; color: var(--accent); }
  .v45-cgrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; width: 100%; }
  .v45-cgrid .ci { display: flex; align-items: center; gap: 4px; padding: 3px 4px 3px 9px; border: 1px solid #e3e1dc; border-radius: 9px; background: #fff; }
  .v45-cgrid .ci.cur { border-color: var(--accent); background: var(--accent-soft); }
  .v45-cgrid .nm { flex: 1; min-width: 0; font-size: 12.5px; font-weight: 700; white-space: nowrap; }
  .v45-cgrid .ci.cur .nm { color: var(--accent); }
  .v45-cgrid button { display: inline-flex; align-items: center; gap: 2px; height: 28px; padding: 0 7px; border: 1px solid #d9d7d2; border-radius: 7px; background: #fff; color: var(--ink); font: inherit; font-size: 11.5px; white-space: nowrap; }
  .v45-cgrid button svg { width: 12px; height: 12px; }
  /* いまの画面：3つの切り替えをまとめて示す、左のかっこ */
  .v45-bracket { z-index: 89; width: 9px; margin-left: -9px; border: 2.5px solid #c0392b; border-right: 0; border-radius: 7px 0 0 7px; pointer-events: none; }
  .v45-callout { z-index: 91; padding: 3px 9px; border-radius: 7px; background: #c0392b; color: #fff; font-size: 12px; font-weight: 700; line-height: 1.45; white-space: nowrap; box-shadow: 0 0 0 2px #fff, 0 2px 5px rgba(0, 0, 0, 0.25); pointer-events: none; }
  .v45-dlg .df { display: flex; justify-content: flex-end; gap: 10px; padding: 11px 20px; border-top: 1px solid var(--line); }
  .v45-dlg .df button { min-width: 104px; height: 40px; border: 1px solid var(--line); border-radius: 10px; background: #fff; color: var(--ink); font: inherit; font-size: 14px; }
  .v45-dlg .df button.ok { border-color: var(--accent); background: var(--accent); color: #fff; font-weight: 700; }

  /* ===== スマホ：キーボードの上の道具の表の段（横にずらさず、画面の幅に入れる） ===== */
  .direct-bar .v45-trow { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 0; margin-top: 2px; padding-top: 3px; border-top: 1px solid var(--line); }
  .direct-bar .v45-trow button { min-width: 0; width: 100%; padding: 2px 0; font-size: 10.5px; }
  .direct-bar .v45-trow button .lab { display: inline-flex; align-items: center; gap: 0; }
  .direct-bar .v45-trow button .lab svg { width: 11px; height: 11px; margin-right: -2px; }
  .direct-bar .v45-trow button.hl { background: var(--accent-soft); color: var(--accent); font-weight: 700; }
  .direct-bar .v45-trow button.hl > svg.pic { width: 30px; height: 19px; }

  /* ===== スマホ：下から出る欄 ===== */
  .v45-sheet { z-index: 70; left: 0; right: 0; bottom: 0; padding: 4px 14px 22px; background: #fff; border-radius: 18px 18px 0 0; box-shadow: 0 -8px 28px rgba(30, 25, 20, 0.22); color: var(--ink); }
  .v45-sheet .grab { width: 40px; height: 5px; margin: 4px auto 2px; border-radius: 3px; background: #d5d3cf; }
  .v45-sheet .sh { display: flex; align-items: center; justify-content: space-between; min-height: 50px; }
  .v45-sheet .sh b { font-size: 17px; letter-spacing: 0.06em; }
  .v45-sheet .sh .back { display: inline-flex; align-items: center; gap: 2px; min-height: 44px; min-width: 76px; padding: 0 12px 0 6px; border: 1px solid var(--line); border-radius: 10px; background: #fff; color: var(--accent); font: inherit; font-size: 14px; font-weight: 700; }
  .v45-sheet .sh .back svg { width: 18px; height: 18px; }
  .v45-sheet .note { margin: 8px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--muted); text-align: center; }
  .v45-sheet .sh .ok, .v45-sheet .ft .ok { min-height: 44px; min-width: 92px; padding: 0 18px; border: 0; border-radius: 10px; background: var(--accent); color: #fff; font: inherit; font-size: 15px; font-weight: 700; }
  .v45-sheet .v45-sec { display: flex; align-items: center; justify-content: space-between; margin: 14px 0 8px 2px; font-size: 13px; font-weight: 700; color: var(--muted); letter-spacing: 0.06em; }
  .v45-sheet .v45-sec .v45-even { min-height: 44px; font-size: 13px; }
  .v45-sheet .v45-cb { margin-top: 8px; }
  .v45-sheet .v45-cards + .v45-cb { margin-top: 8px; }
  .v45-sheet .ft { display: flex; gap: 10px; margin-top: 12px; }
  .v45-sheet .ft button { flex: 1; min-height: 48px; border: 1px solid var(--line); border-radius: 12px; background: #fff; font: inherit; font-size: 15px; color: var(--ink); }
  .v45-sheet .ft .ok { flex: 1; }
  .v45-sheet .pv { margin: 0 -14px; padding: 10px 14px; background: #f4f2ee; text-align: center; }
  .v45-sheet .pv p { margin: 0 0 6px; font-size: 12px; color: var(--muted); }
  .v45-sheet .pv img { display: block; margin: 0 auto; background: #fff; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.14); }
  .v45-rc.ph { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .v45-rc.ph button { min-height: 56px; padding: 6px 12px; font-size: 14px; border-radius: 12px; }
  .v45-rc.ph button svg { width: 24px; height: 24px; }
  /* スマホ：いま書いている列（紙面。うすい色と枠。字の上に重ねて、掛け合わせる） */
  .v45-colhl { z-index: 6; pointer-events: none; background: #e3e7f4; mix-blend-mode: multiply; }
  .v45-coledge { z-index: 7; pointer-events: none; border: 2px solid var(--accent); border-radius: 2px; }
  .v45-dim { z-index: 69; inset: 0; background: rgba(30, 25, 20, 0.2); pointer-events: none; }
`

// =====================================================================
// 案を描く（ページの中）
// =====================================================================

/**
 * パソコンの左の道具（表の所）。kind：'a'（表の形を整える）・'b'（表を書いています）・'c'（表の設定…）。open：ボタンを押した形
 * いまの切り替え（列の幅・左端の列・行の高さ）を隠して、案の形を置く
 */
const drawPalette = (page, kind, open = false) =>
  page.evaluate(
    ({ kind, open, T, IC, picNow }) => {
      const k = window.__v45
      document.body.classList.add('v45-nohandles')
      const group = document.querySelector('.palette .group.ctx')
      const W = (a) => (Array.isArray(a) ? a.map((s) => `<span class="ph">${s}</span>`).join('') : a)
      for (const el of group.querySelectorAll(':scope > .ctx-label.sub, :scope > .seg, :scope > .custom-hint, :scope > p')) k.hide(el)
      const del = [...group.querySelectorAll(':scope > .tb.danger')].at(-1)
      if (kind === 'b') {
        for (const el of group.children) if (!el.classList.contains('ctx-label') || el.classList.contains('sub')) k.hide(el)
        group.insertAdjacentHTML('beforeend', `<div class="v45-x v45-bnote">${IC.table}<b>${W(T.bWriting)}</b><small>${W(T.bWhere)}</small></div>`)
      } else {
        const label = kind === 'a' ? T.shapeBtn.map((s) => `<span>${s}</span>`).join('') : `<span>${T.settingsBtn}</span>`
        del.insertAdjacentHTML('beforebegin', `<button class="tb v45-x v45-big${open ? ' open' : ''}">${kind === 'a' ? picNow : IC.settings}${label}</button>`)
      }
      const p = document.querySelector('.palette')
      const btn = document.querySelector('.palette .v45-big')?.getBoundingClientRect()
      return { overflow: p.scrollHeight > p.clientHeight + 1, h: p.scrollHeight, bottom: Math.round(p.getBoundingClientRect().bottom), left: p.getBoundingClientRect().left, top: p.getBoundingClientRect().top, btn: btn && { top: btn.top, bottom: btn.bottom } }
    },
    { kind, open, T, IC, picNow: pic(kind === 'a' ? 'equal' : 'equal') },
  )

/** 案A（パソコン）：左の道具の左に「表の形を整える」の窓。s：{ widths, label, heights } */
const panelHtmlA = (s) =>
  `<div class="hd"><b>${T.shapeTitle}</b><button aria-label="閉じる">${IC.close}</button></div>` +
  `<div class="v45-sec">${T.secWidth}</div>` +
  choicePc('equal', s.widths === 'equal', T.wEqual) +
  choicePc('auto', s.widths === 'auto', T.wAuto) +
  choicePc('custom', s.widths === 'custom', T.wCustom, T.wCustom.subPc) +
  (s.widths === 'custom' ? `<div class="v45-guide"><p>${W(T.customGuide)}</p>${evenBtn()}</div>` : '') +
  labelCheck(s, 'pc') +
  `<div class="v45-sec">${T.secHeight}</div>` +
  check('hEqual', s.heights === 'equal', T.heights, 'pc') +
  (s.widths === 'custom' ? '' : `<p class="note">${W(T.liveNote)}</p>`)

const drawPanelA = (page, s) =>
  page.evaluate(
    ({ html }) => {
      const k = window.__v45
      const p = document.querySelector('.palette').getBoundingClientRect()
      const btn = document.querySelector('.palette .v45-big').getBoundingClientRect()
      const width = Math.min(300, Math.round(p.left - 18))
      const el = k.add(`<div class="v45-x v45-fixed v45-box v45-apanel" style="left:${Math.round(p.left - 10 - width)}px;top:0;width:${width}px">${html}</div>`)
      const r = el.getBoundingClientRect()
      const cy = btn.top + btn.height / 2
      // 窓の矢印が「表の形を整える」を指すように。窓は画面に入るように上下にずらす
      const top = Math.max(8, Math.min(innerHeight - r.height - 8, cy - r.height + 70))
      el.style.top = `${Math.round(top)}px`
      el.style.setProperty('--tail', `${Math.round(cy - top)}px`)
      return { width, height: Math.round(r.height), top: Math.round(top), bottom: Math.round(top + r.height) }
    },
    { html: panelHtmlA(s) },
  )

/**
 * パソコン（どの案でも同じ）：表の縦の線のつまみ（はっきり見える形）。見出しの行の高さに、左右の矢印の付いたつまみ。
 * state：'idle'・'hover'・'drag'。which：線（0 から）。to：ドラッグ中の線の位置（表の左からの %）
 * ドラッグ中は、となりの2列に、うすい色と「せまくなる」「広くなる」の札（表の下）。元の位置に点線。数（%）は出さない
 */
const drawGrips = (page, state, which = 1, to = 45) =>
  page.evaluate(
    ({ state, which, to, T, IC }) => {
      const k = window.__v45
      const table = window.__v45.paperTable().querySelector('table')
      const t = table.getBoundingClientRect()
      const head = table.querySelector('tr').getBoundingClientRect()
      const gy = (head.top + head.bottom) / 2
      const ths = [...table.querySelector('tr').children].map((th) => th.getBoundingClientRect())
      const borders = ths.slice(0, -1).map((r, i) => (r.right + ths[i + 1].left) / 2)
      const edges = [t.left, ...borders, t.right]
      borders.forEach((x, i) => {
        const active = i === which && state !== 'idle'
        if (active && state === 'drag') {
          k.add(`<div class="v45-x v45-fixed v45-rail ghost" style="left:${x}px;top:${t.top}px;height:${t.height}px"></div>`)
          return
        }
        k.add(`<div class="v45-x v45-fixed v45-rail${active ? ' hot' : ''}" style="left:${x}px;top:${t.top}px;height:${t.height}px"></div>`)
        k.add(`<div class="v45-x v45-fixed v45-grip${active ? ' hot' : ''}${state === 'drag' ? ' dim' : ''}" style="left:${x}px;top:${gy}px">${IC.lr}</div>`)
      })
      const x0 = borders[which]
      const cy = head.bottom + 34
      if (state === 'hover') {
        k.add(`<div class="v45-x v45-fixed v45-cursor lr" style="left:${x0 + 1}px;top:${cy}px">${IC.colResize}</div>`)
        const tip = k.add(`<div class="v45-x v45-fixed v45-tipbox" style="left:${Math.round(x0 + 18)}px;top:${Math.round(cy + 12)}px">${T.tipHover.map((s) => `<span class="ph">${s}</span>`).join('')}</div>`)
        return { tip: tip.getBoundingClientRect().width }
      }
      if (state === 'drag') {
        const nx = t.left + (t.width * to) / 100
        const a = edges[which]
        const b = edges[which + 2]
        // となりの2列（左へ動かしたとき：左はせまく、右は広く）
        const left = nx < x0
        k.add(`<div class="v45-x v45-fixed v45-tint ${left ? 'narrow' : 'wide'}" style="left:${a}px;top:${t.top}px;width:${nx - a}px;height:${t.height}px"></div>`)
        k.add(`<div class="v45-x v45-fixed v45-tint ${left ? 'wide' : 'narrow'}" style="left:${nx}px;top:${t.top}px;width:${b - nx}px;height:${t.height}px"></div>`)
        k.add(`<div class="v45-x v45-fixed v45-rail hot" style="left:${nx}px;top:${t.top}px;height:${t.height}px"></div>`)
        k.add(`<div class="v45-x v45-fixed v45-grip hot" style="left:${nx}px;top:${gy}px">${IC.lr}</div>`)
        k.add(`<div class="v45-x v45-fixed v45-cursor lr" style="left:${nx + 1}px;top:${cy}px">${IC.colResize}</div>`)
        const y = t.bottom + 7
        k.add(`<div class="v45-x v45-fixed v45-chip${left ? '' : ' wide'}" style="left:${(a + nx) / 2}px;top:${y}px">${left ? `◀ ${T.narrower}` : `${T.wider} ▶`}</div>`)
        k.add(`<div class="v45-x v45-fixed v45-chip${left ? ' wide' : ''}" style="left:${(nx + b) / 2}px;top:${y}px">${left ? `${T.wider} ▶` : `◀ ${T.narrower}`}</div>`)
        return { from: Math.round(((x0 - t.left) / t.width) * 100), to }
      }
      return { borders: borders.map((x) => Math.round(((x - t.left) / t.width) * 100)) }
    },
    { state, which, to, T, IC },
  )

/** 案B（パソコン）：紙面の上の道具（表のタイトルのすぐ上）。on：開いているボタン（'rc'・'w'・'h'）。tip：マウスを乗せた一言 */
const drawFloat = (page, on = null, tip = false) =>
  page.evaluate(
    ({ on, tip, T, IC }) => {
      const k = window.__v45
      const pt = window.__v45.paperTable()
      const cap = pt.querySelector('.table-caption').getBoundingClientRect()
      const t = pt.querySelector('table').getBoundingClientRect()
      const fb = (key, icon, label, menu, cls = '') => `<button class="fb ${cls}${on === key ? ' on' : ''}" data-k="${key}">${icon}<span class="lab">${label}${menu ? IC.chev : ''}</span></button>`
      const html =
        fb('rc', IC.rowcol, '行・列', true) + fb('w', IC.widths, '列の幅', true) + fb('h', IC.heights, '行の高さ', true) + fb('img', IC.image, '画像', false) + '<i class="sep"></i>' + fb('del', IC.remove, '表を削除', false, 'danger')
      const el = k.add(`<div class="v45-x v45-fixed v45-box v45-float" style="left:0;top:0">${html}</div>`)
      const r = el.getBoundingClientRect()
      const left = Math.round(t.left + (t.width - r.width) / 2)
      const top = Math.round(cap.top - r.height - 9)
      el.style.left = `${left}px`
      el.style.top = `${top}px`
      el.style.setProperty('--tail', `${Math.round(r.width / 2)}px`)
      if (tip) {
        const b = el.querySelector('[data-k="w"]').getBoundingClientRect()
        k.add(`<div class="v45-x v45-fixed v45-cursor" style="left:${b.left + b.width / 2 + 8}px;top:${b.top + 12}px">${IC.arrow}</div>`)
        const tp = k.add(`<div class="v45-x v45-fixed v45-tipbox" style="left:0;top:0">${T.bTip}</div>`)
        const tr = tp.getBoundingClientRect()
        tp.style.left = `${Math.round(b.left + b.width / 2 - tr.width / 2)}px`
        tp.style.top = `${Math.round(b.top - tr.height - 8)}px`
      }
      return { left, top, width: Math.round(r.width), height: Math.round(r.height) }
    },
    { on, tip, T, IC },
  )

/** 案B（パソコン）：自分で決めるのとき、紙面の上の道具の代わりに出す帯（一言・同じ幅に戻す・できた） */
const drawGuideB = (page) =>
  page.evaluate(
    ({ T, IC }) => {
      const k = window.__v45
      const pt = window.__v45.paperTable()
      const cap = pt.querySelector('.table-caption').getBoundingClientRect()
      const t = pt.querySelector('table').getBoundingClientRect()
      const W = (a) => a.map((s) => `<span class="ph">${s}</span>`).join('<wbr>')
      const el = k.add(
        `<div class="v45-x v45-fixed v45-box v45-float v45-gbar" style="left:0;top:0">${IC.widths.replace('<svg ', '<svg width="22" height="22" ')}<p>${W(T.bGuide)}</p><button class="v45-even">${IC.even}<span>${T.even}</span></button><button class="ok">${T.done}</button></div>`,
      )
      const r = el.getBoundingClientRect()
      el.style.left = `${Math.round(t.left + (t.width - r.width) / 2)}px`
      el.style.top = `${Math.round(cap.top - r.height - 9)}px`
      el.style.setProperty('--tail', `${Math.round(r.width / 2)}px`)
      return { width: Math.round(r.width), height: Math.round(r.height) }
    },
    { T, IC },
  )

/** 案B（パソコン）：紙面の上の道具のメニュー。which：'w'（列の幅）・'h'（行の高さ）・'rc'（行・列） */
const menuHtmlB = (which, s) =>
  which === 'w'
    ? `<div class="mh">${T.secWidth}</div><div class="v45-cards one">${card('equal', s.widths === 'equal', T.wEqual)}${card('auto', s.widths === 'auto', T.wAuto)}${card('custom', s.widths === 'custom', T.wCustom)}</div>` +
      labelCheck(s, 'pc')
    : which === 'h'
      ? `<div class="mh">${T.secHeight}</div><div class="v45-cards two">${card('hEqual', s.heights === 'equal', T.hEqual, T.hEqual.sub)}${card('hAuto', s.heights === 'auto', T.hAuto, T.hAuto.sub)}</div>`
      : `<div class="mh">行・列</div><div class="v45-rc"><button class="add">${IC.rowAdd}<b>${W(T.rcAddRow)}</b></button><button>${IC.rowRemove}<b>${W(T.rcDelRow)}</b></button><button class="add">${IC.colAdd}<b>${W(T.rcAddCol)}</b></button><button>${IC.colRemove}<b>${W(T.rcDelCol)}</b></button></div>`
const drawMenuB = (page, which, s) =>
  page.evaluate(
    ({ which, html }) => {
      const k = window.__v45
      const b = document.querySelector(`.v45-float [data-k="${which}"]`).getBoundingClientRect()
      const bar = document.querySelector('.v45-float').getBoundingClientRect()
      const el = k.add(`<div class="v45-x v45-fixed v45-box v45-menu" style="left:0;top:0">${html}</div>`)
      const r = el.getBoundingClientRect()
      const left = Math.max(8, Math.min(innerWidth - r.width - 8, b.left + b.width / 2 - r.width / 2))
      // 上に開く（表が隠れないように）。上に入らなければ下に
      let top = bar.top - r.height - 6
      const up = top >= 8
      if (!up) top = bar.bottom + 6
      el.style.left = `${Math.round(left)}px`
      el.style.top = `${Math.round(top)}px`
      return { top: Math.round(top), height: Math.round(r.height), up }
    },
    { which, html: menuHtmlB(which, s) },
  )

/** 案C（パソコン）：表の設定の窓（見本つき）。pv：見本の絵（tablePicture）。s：選んでいる形。cur：書いているマスの列 */
const dlgHtmlC = (s, pv, imgW, cur = 2) => {
  const hl = pv.cols[cur]
  const stage =
    `<div class="v45-stage"><img src="${pv.url}" style="width:${imgW}px" alt="">` +
    (s.widths === 'custom' ? `<i class="colhl" style="left:${(hl.left * 100).toFixed(2)}%;width:${((hl.right - hl.left) * 100).toFixed(2)}%;top:${(pv.tableTop * 100).toFixed(2)}%"></i>` : '') +
    `</div>`
  const custom =
    s.widths === 'custom'
      ? `<div class="cbar"><b>${W(T.cCustom)}</b>${evenBtn()}</div><div class="v45-cgrid">${COLS.map((n, i) => `<div class="ci${i === cur ? ' cur' : ''}"><span class="nm">${n}</span><button>${IC.minus}<span>${T.narrowBtn}</span></button><button>${IC.plus}<span>${T.widenBtn}</span></button></div>`).join('')}</div>`
      : ''
  return (
    `<div class="dh"><b>${T.settingsTitle}</b><small>表1. 使用素材表</small></div>` +
    `<div class="bd"><div class="pv"><p>${W(T.preview)}</p>${stage}${custom}</div><div class="op">` +
    `<div class="v45-sec">${T.secWidth}</div>` +
    choicePc('equal', s.widths === 'equal', T.wEqual) +
    choicePc('auto', s.widths === 'auto', T.wAuto) +
    choicePc('custom', s.widths === 'custom', T.wCustom, T.cCustom) +
    labelCheck(s, 'pc') +
    `<div class="v45-sec">${T.secHeight}</div>` +
    check('hEqual', s.heights === 'equal', T.heights, 'pc') +
    `</div></div><div class="df"><button>${T.cancel}</button><button class="ok">${T.ok}</button></div>`
  )
}
/** 窓を画面の真ん中に。画面に入らなければ、見本の絵を小さくして入れる */
const drawDialogC = (page, s, pv, imgW) =>
  page.evaluate(
    async ({ html, imgW }) => {
      const k = window.__v45
      k.add('<div class="v45-x v45-fixed v45-backdrop"></div>')
      const width = Math.min(820, innerWidth - 40)
      const el = k.add(`<div class="v45-x v45-fixed v45-box v45-dlg" style="left:0;top:0;width:${width}px">${html}</div>`)
      const img = el.querySelector('.pv img')
      // 見本の絵が読み込まれてから測る（読み込む前は高さが 0）
      await img.decode().catch(() => {})
      let r = el.getBoundingClientRect()
      for (let i = 0; i < 4 && r.height > innerHeight - 16; i++) {
        const ih = img.getBoundingClientRect()
        const w = Math.floor(ih.width - ((r.height - (innerHeight - 16)) * ih.width) / ih.height) - 2
        img.style.width = `${w}px`
        r = el.getBoundingClientRect()
      }
      el.style.left = `${Math.round((innerWidth - r.width) / 2)}px`
      el.style.top = `${Math.max(8, Math.round((innerHeight - r.height) / 2))}px`
      return { width: Math.round(r.width), height: Math.round(r.height), img: Math.round(img.getBoundingClientRect().width) }
    },
    { html: dlgHtmlC(s, pv, imgW), imgW },
  )

/** 見本の絵：表を state の形に組み、表（とタイトル）を写して data URL にする（このあと元の形に戻すのは、呼んだ側）。列の位置（絵の幅に対する割合）も返す */
async function tablePicture(page, state) {
  await setTable(page, state)
  await sleep(300)
  const geo = await page.evaluate(() => {
    const pt = window.__v45.paperTable()
    const cap = pt.querySelector('.table-caption').getBoundingClientRect()
    const table = pt.querySelector('table')
    const t = table.getBoundingClientRect()
    const x = Math.floor(t.left) - 6
    const y = Math.floor(cap.top) - 6
    const clip = { x, y, width: Math.ceil(t.width) + 12, height: Math.ceil(t.bottom) - y + 6 }
    const cols = [...table.querySelector('tr').children].map((th) => {
      const r = th.getBoundingClientRect()
      return { left: (r.left - x) / clip.width, right: (r.right - x) / clip.width }
    })
    return { clip, cols, tableTop: (t.top - y) / clip.height }
  })
  const b64 = await page.screenshot({ clip: geo.clip, encoding: 'base64' })
  return { url: `data:image/png;base64,${b64}`, width: geo.clip.width, height: geo.clip.height, cols: geo.cols, tableTop: geo.tableTop }
}

/** スマホ：キーボードの上の道具の表の段（案の形。横にずらさず、画面の幅に入れる）。kind：'a'・'b'・'c' */
const drawPhoneBar = (page, kind) =>
  page.evaluate(
    ({ kind, IC, T, shapePic }) => {
      const k = window.__v45
      document.body.classList.add('v45-nohandles')
      const bar = document.querySelector('.direct-bar')
      const real = bar.querySelector('.db-table')
      k.hide(real)
      k.hide(bar.querySelector('.db-colw'))
      const b = (icon, label, cls = '', menu = false) => `<button class="${cls}">${icon}<span class="lab">${label}${menu ? IC.chev : ''}</span></button>`
      const items =
        kind === 'b'
          ? [b(IC.rowcol, '行・列', '', true), b(IC.widths, '列の幅', '', true), b(IC.heights, '行の高さ', '', true), b(IC.image, '画像'), b(IC.remove, '表を削除', 'danger')]
          : [
              b(IC.rowAdd, '行を足す'),
              b(IC.colAdd, '列を足す'),
              b(IC.image, '画像'),
              b(IC.rowRemove, '行を消す'),
              b(IC.colRemove, '列を消す'),
              kind === 'a' ? b(shapePic, T.shapeShort, 'hl') : b(IC.settings, '表の設定', 'hl'),
              b(IC.remove, '表を削除', 'danger'),
            ]
      k.after(real, `<div class="db-row v45-x v45-trow" style="--n:${items.length}">${items.join('')}</div>`)
      const r = bar.getBoundingClientRect()
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) }
    },
    { kind, IC, T, shapePic: pic('equal') },
  )

/** スマホ：下から出る欄（キーボードは閉じる。道具の段も隠れる）。html：中身 */
const drawSheet = (page, html, dim = false) =>
  page.evaluate(
    ({ html, dim }) => {
      const k = window.__v45
      k.hide(document.querySelector('.direct-bar'))
      if (dim) k.add('<div class="v45-x v45-fixed v45-dim"></div>')
      const el = k.add(`<div class="v45-x v45-fixed v45-box v45-sheet">${html}</div>`)
      const r = el.getBoundingClientRect()
      return { top: Math.round(r.top), height: Math.round(r.height) }
    },
    { html, dim },
  )
const widthCards = (s) => `<div class="v45-cards">${card('equal', s.widths === 'equal', T.wEqual, T.wEqual.sub)}${card('auto', s.widths === 'auto', T.wAuto, T.wAuto.sub)}${card('custom', s.widths === 'custom', T.wCustom, T.wCustom.subPh)}</div>`
const sheetHtmlA = (s) =>
  `<div class="grab"></div><div class="sh"><b>${T.shapeTitle}</b><button class="ok">${T.done}</button></div>` +
  `<div class="v45-sec">${T.secWidth}</div>${widthCards(s)}` +
  labelCheck(s) +
  `<div class="v45-sec">${T.secHeight}</div>` +
  check('hEqual', s.heights === 'equal', T.heights)
/** 案A（スマホ）：「自分で決める」を押すと、欄が低くなり、列ごとに「せまく」「広く」（表が見える） */
const sheetHtmlACustom = (widths, cur = 2) =>
  `<div class="grab"></div><div class="sh"><button class="back">${IC.chevL}${T.back}</button><b>${T.phCustomTitle}</b><button class="ok">${T.done}</button></div>` +
  colRows(widths, cur) +
  `<div class="v45-sec"><span>${W(T.liveNote)}</span>${evenBtn()}</div>`
const sheetHtmlBWidth = (s) => `<div class="grab"></div><div class="sh"><b>${T.secWidth}</b><button class="ok">${T.done}</button></div>` + widthCards(s) + labelCheck(s)
const sheetHtmlBRowCol = () =>
  `<div class="grab"></div><div class="sh"><b>行・列</b><button class="ok">${T.done}</button></div>` +
  `<div class="v45-rc ph"><button class="add">${IC.rowAdd}<b>${W(T.rcAddRow)}</b></button><button>${IC.rowRemove}<b>${W(T.rcDelRow)}</b></button><button class="add">${IC.colAdd}<b>${W(T.rcAddCol)}</b></button><button>${IC.colRemove}<b>${W(T.rcDelCol)}</b></button></div>`
const sheetHtmlC = (s, img, imgW) =>
  `<div class="grab"></div><div class="sh"><b>${T.settingsTitle}</b></div>` +
  `<div class="pv"><p>${W(T.preview)}</p><img src="${img}" style="width:${imgW}px" alt=""></div>` +
  `<div class="v45-sec">${T.secWidth}</div>${widthCards(s)}` +
  labelCheck(s) +
  `<div class="v45-sec">${T.secHeight}</div>` +
  check('hEqual', s.heights === 'equal', T.heights) +
  `<div class="ft"><button>${T.cancel}</button><button class="ok">${T.ok}</button></div>`

/** スマホ：いま書いている列を、うすく色付けする（案A の「列ごとの幅」と合わせて） */
const drawColumn = (page, col, bottomSel = '.v45-sheet') =>
  page.evaluate(
    ({ col, bottomSel }) => {
      const k = window.__v45
      const table = window.__v45.paperTable().querySelector('table')
      const t = table.getBoundingClientRect()
      const th = [...table.querySelector('tr').children][col].getBoundingClientRect()
      const head = document.querySelector('.page-scroller').getBoundingClientRect()
      const limit = document.querySelector(bottomSel)?.getBoundingClientRect().top ?? innerHeight
      const top = Math.max(t.top, head.top)
      const bottom = Math.min(t.bottom, limit)
      k.add(`<div class="v45-x v45-fixed v45-colhl" style="left:${th.left}px;top:${top}px;width:${th.width}px;height:${bottom - top}px"></div>`)
      k.add(`<div class="v45-x v45-fixed v45-coledge" style="left:${th.left - 1}px;top:${top - 1}px;width:${th.width + 2}px;height:${bottom - top + 2}px"></div>`)
    },
    { col, bottomSel },
  )

/** 写す範囲：要素たちを囲む範囲（pad の余白。画面に収める） */
const AROUND = (sels, pad = 14) => `(() => {
  const rs = ${JSON.stringify(sels)}.flatMap((s) => [...document.querySelectorAll(s)]).map((e) => e.getBoundingClientRect()).filter((r) => r.width)
  const x = Math.max(0, Math.floor(Math.min(...rs.map((r) => r.left))) - ${pad})
  const y = Math.max(0, Math.floor(Math.min(...rs.map((r) => r.top))) - ${pad})
  const right = Math.min(innerWidth, Math.ceil(Math.max(...rs.map((r) => r.right))) + ${pad})
  const bottom = Math.min(innerHeight, Math.ceil(Math.max(...rs.map((r) => r.bottom))) + ${pad})
  return { x, y, width: right - x, height: bottom - y }
})()`
const TABLE_SEL = '.page-viewport.front [data-vivliostyle-page-container].is-current .data-table[data-table-id="t1"]'

/** パソコン：画面の大きさを変えて、表のセルを書き始めたところから */
async function pcAt(page, vp, state = { widths: 'equal', label: true, heights: 'equal' }) {
  await page.evaluate(() => window.__v45.clear())
  await page.setViewport(vp)
  await sleep(600)
  await goTable(page)
  await setTable(page, state)
  await openCell(page, 'm2:feat', 'pc')
  await parkMouse(page)
}
/** 左の道具・案の窓が画面に入っているか（数） */
const paletteFit = (page) =>
  page.evaluate(() => {
    const p = document.querySelector('.palette')
    const panel = document.querySelector('.v45-apanel, .v45-dlg, .v45-menu')?.getBoundingClientRect()
    return {
      screen: `${innerWidth}×${innerHeight}`,
      palette: p.scrollHeight,
      visible: p.clientHeight,
      scrolls: p.scrollHeight > p.clientHeight + 1,
      bottom: Math.round(p.getBoundingClientRect().bottom),
      panelTop: panel ? Math.round(panel.top) : null,
      panelBottom: panel ? Math.round(panel.bottom) : null,
      panelFits: panel ? panel.top >= 0 && panel.bottom <= innerHeight : null,
    }
  })
/** 画面の低いパソコン3つ（1280×720 の画面いっぱい・その画面のブラウザの中・1366×768 の画面のブラウザの中）で、案を出して測る。shots：写す画面 */
async function lowScreens(page, prefix, draw, shots = [PC_LOW, BROWSER_LOW]) {
  for (const vp of [PC_LOW, BROWSER_LOW, BROWSER_MID]) {
    await draw(vp)
    const name = `${prefix}-${vp.width}x${vp.height}`
    FACTS[`${name}-fit`] = await paletteFit(page)
    console.log(`    ${name}：`, JSON.stringify(FACTS[`${name}-fit`]))
    if (shots.includes(vp)) await shot(page, vp === PC_LOW ? `${prefix}-1280` : vp === BROWSER_LOW ? `${prefix}-586` : `${prefix}-634`)
  }
}

// =====================================================================
// 案A　「表の形を整える」の窓
// =====================================================================
async function optionA(browser) {
  const EQ = { widths: 'equal', label: true, heights: 'equal' }
  const AUTO = { widths: 'auto', label: true, heights: 'equal' }
  const CU = { widths: 'custom', colWidths: [25, 25, 25, 25], label: true, heights: 'equal' }
  {
    const { context, page } = await open(browser, 'pc', PC)
    // 書いているとき（左の道具に「表の形を整える」1つ）
    await pcAt(page, PC, EQ)
    await drawPalette(page, 'a')
    await shot(page, 'a-pc-edit')
    await shot(page, 'a-pc-edit-zoom', PAL_TABLE)
    // 「表の形を整える」を押したところ（列の幅をそろえる・項目の列は字に合わせる・行の高さをそろえる）
    await page.evaluate(() => window.__v45.clear())
    await drawPalette(page, 'a', true)
    console.log('    窓：', JSON.stringify(await drawPanelA(page, EQ)))
    await shot(page, 'a-pc-open')
    await shot(page, 'a-pc-open-zoom', AROUND(['.v45-apanel', '.palette', TABLE_SEL]))
    // 「字の多い列を広く」を押したところ（表がすぐ変わる。項目の列は使えない形）
    await pcAt(page, PC, AUTO)
    await drawPalette(page, 'a', true)
    await drawPanelA(page, AUTO)
    await shot(page, 'a-pc-open-auto-zoom', AROUND(['.v45-apanel', '.palette', TABLE_SEL]))
    // 自分で決める：線にマウス・ドラッグ中
    await pcAt(page, PC, CU)
    await drawPalette(page, 'a', true)
    await drawPanelA(page, CU)
    await drawGrips(page, 'idle')
    await shot(page, 'a-pc-idle-zoom', TABLE(30, 6))
    await page.evaluate(() => window.__v45.clear())
    await drawPalette(page, 'a', true)
    await drawPanelA(page, CU)
    await drawGrips(page, 'hover')
    await shot(page, 'a-pc-hover-zoom', TABLE(30, 6))
    await page.evaluate(() => window.__v45.clear())
    await drawPalette(page, 'a', true)
    await drawPanelA(page, CU)
    console.log('    ドラッグ：', JSON.stringify(await drawGrips(page, 'drag')))
    await shot(page, 'a-pc-custom')
    await shot(page, 'a-pc-custom-zoom', AROUND(['.v45-apanel', '.palette', TABLE_SEL, '.v45-chip']))
    await shot(page, 'a-pc-drag-zoom', TABLE(30, 6))
    // 画面の低いパソコン（いちばん長い窓：自分で決める）
    await lowScreens(page, 'a-pc', async (vp) => {
      await pcAt(page, vp, CU)
      await drawPalette(page, 'a', true)
      await drawPanelA(page, CU)
    })
    await context.close()
  }
  {
    const { context, page } = await open(browser, 'phone')
    await openCell(page, 'm2:feat', 'phone')
    await keyboard(page, true)
    await sleep(700)
    await showTableHead(page)
    await drawPhoneBar(page, 'a')
    const c = await centerOf(page, '.direct-bar .v45-trow .hl > svg')
    await tapAt(page, c.x, c.y)
    await shot(page, 'a-ph-bar')
    await shot(page, 'a-ph-bar-zoom', BAR())
    await page.evaluate(() => window.__v45.clear())
    await keyboard(page, false)
    await sleep(500)
    await showTableHead(page)
    console.log('    欄：', JSON.stringify(await drawSheet(page, sheetHtmlA(EQ))))
    await shot(page, 'a-ph-sheet')
    // 自分で決める：欄が低くなり、列ごとの幅（いま書いている列「特徴」に色）
    await page.evaluate(() => window.__v45.clear())
    await goTable(page)
    await setTable(page, { widths: 'custom', colWidths: CUSTOM, label: true, heights: 'equal' })
    await openCell(page, 'm2:feat', 'phone')
    await page.evaluate(() => document.body.classList.add('v45-nohandles'))
    await sleep(400)
    await showTableHead(page, 4)
    console.log('    欄（自分で決める）：', JSON.stringify(await drawSheet(page, sheetHtmlACustom(CUSTOM))))
    await drawColumn(page, 2)
    await shot(page, 'a-ph-custom')
    await context.close()
  }
}

// =====================================================================
// 案B　紙面の上の道具
// =====================================================================
async function optionB(browser) {
  const EQ = { widths: 'equal', label: true, heights: 'equal' }
  const CU = { widths: 'custom', colWidths: [25, 25, 25, 25], label: true, heights: 'equal' }
  {
    const { context, page } = await open(browser, 'pc', PC)
    await pcAt(page, PC, EQ)
    await drawPalette(page, 'b')
    console.log('    道具：', JSON.stringify(await drawFloat(page, null, true)))
    await shot(page, 'b-pc-edit')
    await shot(page, 'b-pc-edit-zoom', AROUND(['.palette', TABLE_SEL, '.v45-float', '.v45-tipbox']))
    // 列の幅のメニュー（上に開く）
    await page.evaluate(() => window.__v45.clear())
    await drawPalette(page, 'b')
    await drawFloat(page, 'w')
    console.log('    メニュー：', JSON.stringify(await drawMenuB(page, 'w', EQ)))
    await shot(page, 'b-pc-open')
    await shot(page, 'b-pc-open-zoom', AROUND([TABLE_SEL, '.v45-float', '.v45-menu']))
    // 行・列のメニュー・行の高さのメニュー
    for (const which of ['rc', 'h']) {
      await page.evaluate(() => window.__v45.clear())
      await drawPalette(page, 'b')
      await drawFloat(page, which)
      await drawMenuB(page, which, EQ)
      await shot(page, which === 'rc' ? 'b-pc-rowcol-zoom' : 'b-pc-height-zoom', AROUND(['.v45-float', '.v45-menu'], 16))
    }
    // 自分で決める：紙面の上の帯（一言）と、線のつまみ（ドラッグ中）
    await pcAt(page, PC, CU)
    await drawPalette(page, 'b')
    console.log('    帯：', JSON.stringify(await drawGuideB(page)))
    await drawGrips(page, 'drag')
    await shot(page, 'b-pc-custom')
    await shot(page, 'b-pc-custom-zoom', AROUND([TABLE_SEL, '.v45-float', '.v45-chip']))
    await lowScreens(page, 'b-pc', async (vp) => {
      await pcAt(page, vp, EQ)
      await drawPalette(page, 'b')
      await drawFloat(page, 'w')
      await drawMenuB(page, 'w', EQ)
    })
    await context.close()
  }
  {
    const { context, page } = await open(browser, 'phone')
    await openCell(page, 'm2:feat', 'phone')
    await keyboard(page, true)
    await sleep(700)
    await showTableHead(page)
    await drawPhoneBar(page, 'b')
    const c = await centerOf(page, '.direct-bar .v45-trow button:nth-child(2) > svg')
    await tapAt(page, c.x, c.y)
    await shot(page, 'b-ph-bar')
    await shot(page, 'b-ph-bar-zoom', BAR())
    await page.evaluate(() => window.__v45.clear())
    await keyboard(page, false)
    await sleep(500)
    await showTableHead(page)
    console.log('    欄：', JSON.stringify(await drawSheet(page, sheetHtmlBWidth(EQ))))
    await shot(page, 'b-ph-sheet')
    await page.evaluate(() => window.__v45.clear())
    await drawSheet(page, sheetHtmlBRowCol())
    await shot(page, 'b-ph-rowcol')
    await context.close()
  }
}

// =====================================================================
// 案C　2段がまえ（表の設定の窓）
// =====================================================================
async function optionC(browser) {
  const EQ = { widths: 'equal', label: true, heights: 'equal' }
  const AUTO = { widths: 'auto', label: true, heights: 'equal' }
  const CU = { widths: 'custom', colWidths: CUSTOM, label: true, heights: 'equal' }
  {
    const { context, page } = await open(browser, 'pc', PC)
    await pcAt(page, PC, EQ)
    await drawPalette(page, 'c')
    await shot(page, 'c-pc-edit')
    await shot(page, 'c-pc-edit-zoom', PAL_TABLE)
    // 窓の見本の絵（字の多い列を広く・自分で決める）を、本物の組版で作る
    await goTable(page)
    const pAuto = await tablePicture(page, AUTO)
    const pCustom = await tablePicture(page, CU)
    for (const [name, s, pv] of [
      ['c-pc-open', AUTO, pAuto],
      ['c-pc-custom', CU, pCustom],
    ]) {
      await pcAt(page, PC, EQ)
      await drawPalette(page, 'c', true)
      console.log(`    ${name}：`, JSON.stringify(await drawDialogC(page, s, pv, Math.min(400, pv.width))))
      await shot(page, name)
      await shot(page, `${name}-zoom`, AROUND(['.v45-dlg'], 10))
    }
    // 画面の低いパソコン（いちばん長い窓：自分で決める）
    await lowScreens(page, 'c-pc', async (vp) => {
      await pcAt(page, vp, EQ)
      await drawPalette(page, 'c', true)
      await drawDialogC(page, CU, pCustom, Math.min(400, pCustom.width))
    })
    await context.close()
  }
  {
    const { context, page } = await open(browser, 'phone')
    await showTableHead(page)
    const pv = await tablePicture(page, AUTO)
    await setTable(page, EQ)
    await goTable(page)
    await openCell(page, 'm2:feat', 'phone')
    await keyboard(page, true)
    await sleep(700)
    await showTableHead(page)
    await drawPhoneBar(page, 'c')
    const c = await centerOf(page, '.direct-bar .v45-trow .hl > svg')
    await tapAt(page, c.x, c.y)
    await shot(page, 'c-ph-bar')
    await shot(page, 'c-ph-bar-zoom', BAR())
    await page.evaluate(() => window.__v45.clear())
    await keyboard(page, false)
    await sleep(500)
    console.log('    欄：', JSON.stringify(await drawSheet(page, sheetHtmlC(AUTO, pv.url, 250), true)))
    await shot(page, 'c-ph-sheet')
    await context.close()
  }
}

/** 一覧のページ（mockups/v45/review.html）を1枚の画像にする（shots/review-table-settings.png） */
async function reviewShots(browser) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1 })
  await page.goto(`${REVIEW_APP}/${DIR}/review.html`, { waitUntil: 'networkidle0' })
  await page.addStyleTag({ content: 'html { scrollbar-width: none; }' })
  await page.evaluate(() => document.fonts.ready)
  await sleep(400)
  const bad = await page.evaluate(() => {
    const out = []
    const blocks = [...document.querySelectorAll('h1, h2, p, li, figcaption b, figcaption span, small, td, th, .note p, .pw > div, .common li, .ask li, .why, .audit > div')]
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
  await page.screenshot({ path: `${OUT}/review-table-settings.png`, fullPage: true })
  console.log('✓ review-table-settings')
  await page.close()
}

await withEdge(async (browser) => {
  if (want('now')) await nowShots(browser)
  if (want('a')) await optionA(browser)
  if (want('b')) await optionB(browser)
  if (want('c')) await optionC(browser)
  if (want('review')) await reviewShots(browser)
  // 数えたこと（前に書いたものに足す。一覧のページの数は、ここから書く）
  const before = existsSync(`${OUT}/facts.json`) ? JSON.parse(readFileSync(`${OUT}/facts.json`, 'utf8')) : {}
  writeFileSync(`${OUT}/facts.json`, JSON.stringify({ ...before, ...FACTS }, null, 2))
})
