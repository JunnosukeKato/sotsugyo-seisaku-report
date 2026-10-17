// デザイン案 v31（提出前チェック：作品写真を6枚まで入れる・指摘の札・最初の画面のファイル名の見本）を画像に書き出す。
// 本物のページ（開発サーバーの check.html）に見本のファイル（scripts/e2e/fixtures/word-sample-*。架空の原稿）を入れ、
// その画面の一部を案ごとに書き換えて写す（src/ は変えない）。作品写真の見本は docs/guide-images/sample/photo-1.jpg（読むだけ）を切り抜いて作る。
// 使い方: node scripts/mockup-shots-v31.mjs（開発サーバーが http://localhost:5173 で動いていること）。Edge は EDGE_PORT（ふだんは 9425）
import { mkdirSync, readFileSync } from 'node:fs'

process.env.EDGE_PORT ??= '9425'
const { withEdge } = await import('./poc/edge.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const DIR = 'mockups/v31'
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })
const FIX = 'scripts/e2e/fixtures'
const PC = { width: 1366, height: 768, deviceScaleFactor: 1.5 }
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

const now = Date.now()
const b64 = (path) => readFileSync(path).toString('base64')
/** 見本の Word・PDF（Word は PDF より古い：作り直した PDF を入れた、ふつうの状態） */
const FILES = ['cover', 'abstract', 'toc', 'body'].flatMap((n, i) => [
  { name: `0${i + 1}_${['表紙', '抄録', '目次', '本文'][i]}.pdf`, b64: b64(`${FIX}/word-sample-${n}.pdf`), lastModified: now - 3_600_000, type: 'application/pdf' },
  { name: `0${i + 1}_${['表紙', '抄録', '目次', '本文'][i]}.docx`, b64: b64(`${FIX}/word-sample-${n}.docx`), lastModified: now - 7_200_000, type: '' },
])
const PHOTO = { name: 'IMG_2041.jpg', b64: b64('docs/guide-images/sample/photo-1.jpg'), lastModified: now, type: 'image/jpeg' }

const drop = (page, files) =>
  page.evaluate((files) => {
    const dt = new DataTransfer()
    for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { lastModified: f.lastModified, type: f.type }))
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
  }, files)
const settled = (page, count) =>
  page.waitForFunction((count) => document.querySelector('main')?.dataset.busy === 'false' && document.querySelectorAll('.pf .fname').length >= count && !document.querySelector('.pg-wait'), { timeout: 180000, polling: 200 }, count)

/** ページの中で使う道具（写真の見本・A4 の作品写真のページの絵・案の部品）を入れる */
async function installKit(page) {
  await page.evaluate(async () => {
    const load = (src) => new Promise((resolve) => { const im = new Image(); im.onload = () => resolve(im); im.src = src })
    const base = await load('/docs/guide-images/sample/photo-1.jpg')
    /** 写真の見本：全体・後ろ（左右反転）・袖・帯・裾（横長）・上半身（正方形） */
    const crop = (sx, sy, sw, sh, flip = false) => {
      const c = document.createElement('canvas')
      c.width = sw
      c.height = sh
      const g = c.getContext('2d')
      if (flip) { g.translate(sw, 0); g.scale(-1, 1) }
      g.drawImage(base, sx, sy, sw, sh, 0, 0, sw, sh)
      return c
    }
    const photos = [
      { name: 'IMG_2041.jpg', c: crop(0, 0, 900, 1200) },
      { name: 'IMG_2042.jpg', c: crop(0, 0, 900, 1200, true) },
      { name: 'IMG_2043.jpg', c: crop(500, 300, 400, 300) },
      { name: 'IMG_2047.jpg', c: crop(380, 260, 240, 480) },
      { name: 'IMG_2050.jpg', c: crop(240, 760, 440, 260) },
      { name: 'IMG_2052.jpg', c: crop(150, 80, 600, 600) },
    ]
    /**
     * A4 の作品写真のページの絵。mode：contain（切らずに収める。まわりは白）・cover（枠いっぱいに切り抜く。学生用ツールと同じ。細い白い線で区切る）
     */
    const page = (list, cols, rows, mode) => {
      const W = 420
      const H = 594
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      const g = c.getContext('2d')
      g.fillStyle = '#fff'
      g.fillRect(0, 0, W, H)
      const m = mode === 'cover' ? 0 : 22
      const gap = mode === 'cover' ? 3 : 12
      const cw = (W - 2 * m - (cols - 1) * gap) / cols
      const ch = (H - 2 * m - (rows - 1) * gap) / rows
      list.slice(0, cols * rows).forEach((p, i) => {
        const x = m + (i % cols) * (cw + gap)
        const y = m + Math.floor(i / cols) * (ch + gap)
        const iw = p.c.width
        const ih = p.c.height
        if (mode === 'cover') {
          const s = Math.max(cw / iw, ch / ih)
          const sw = cw / s
          const sh = ch / s
          g.drawImage(p.c, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, cw, ch)
        } else {
          const s = Math.min(cw / iw, ch / ih)
          const dw = iw * s
          const dh = ih * s
          g.drawImage(p.c, x + (cw - dw) / 2, y + (ch - dh) / 2, dw, dh)
        }
      })
      return c.toDataURL('image/jpeg', 0.9)
    }
    const thumb = (p) => { const c = document.createElement('canvas'); const s = 96 / Math.max(p.c.width, p.c.height); c.width = Math.round(p.c.width * s); c.height = Math.round(p.c.height * s); c.getContext('2d').drawImage(p.c, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.85) }
    /** 枚数で決める並べ方（案A）：1枚・2枚（縦長なら左右、横長があれば上下）・3〜4枚は 2×2・5〜6枚は 2×3 */
    const autoGrid = (list) => {
      const n = list.length
      if (n <= 1) return [1, 1]
      if (n === 2) return list.some((p) => p.c.width > p.c.height) ? [1, 2] : [2, 1]
      if (n <= 4) return [2, 2]
      return [2, 3]
    }
    /** 並べ方の小さな印（案B・C）。cols×rows の枠 */
    const gridIcon = (cols, rows, on = false) =>
      `<span class="v31-gi${on ? ' on' : ''}" style="grid-template:repeat(${rows},1fr)/repeat(${cols},1fr)">${'<i></i>'.repeat(cols * rows)}</span>`
    window.__kit = { photos, page, thumb, autoGrid, gridIcon }
    const style = document.createElement('style')
    style.textContent = `
      .v31-gi { display: inline-grid; gap: 1.5px; width: 15px; height: 21px; padding: 2px; border-radius: 3px; box-shadow: inset 0 0 0 1px #b9bdcc; background: #fff; vertical-align: middle; }
      .v31-gi i { background: #c9cddb; border-radius: 1px; }
      .v31-gi.on { box-shadow: inset 0 0 0 1.5px var(--accent); background: var(--accent-soft); }
      .v31-gi.on i { background: var(--accent); }
      .v31-lays { display: flex; gap: 3px; margin-top: 3px; }
      .v31-lays button { padding: 0; border: 0; background: none; line-height: 0; }
      .v31-muted { color: var(--muted); font-size: 11.5px; line-height: 19px; }
      .v31-link { color: var(--accent); font-size: 11.5px; line-height: 19px; text-decoration: underline; text-underline-offset: 2px; }
      .v31-pop { position: fixed; z-index: 45; width: 310px; padding: 8px; border: 1px solid var(--line); border-radius: 12px; background: #fff; box-shadow: 0 10px 28px rgba(30,25,20,0.2); font-size: 13px; }
      .v31-pop h3 { margin: 2px 6px 6px; font-size: 13px; }
      .v31-pop h3 small { margin-left: 6px; font-weight: 400; color: var(--muted); }
      .v31-row { display: grid; grid-template-columns: 34px minmax(0,1fr) auto auto auto; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 8px; }
      .v31-row img { width: 34px; height: 34px; object-fit: cover; border-radius: 4px; }
      .v31-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .v31-row b { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 6px; color: var(--muted); font-weight: 400; }
      .v31-add { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 6px 4px 2px; padding: 9px; border: 1.5px dashed #aab2d2; border-radius: 9px; background: #f7f8fc; color: var(--accent); }
      .v31-hint { margin: 6px 6px 2px; font-size: 12px; color: var(--muted); line-height: 1.6; }
      .v31-dlg { display: grid; grid-template-columns: 330px minmax(0,1fr); gap: 22px; }
      .v31-dlg .prev { position: relative; }
      .v31-dlg .prev img { width: 100%; display: block; box-shadow: 0 1px 2px rgba(30,25,20,.1), 0 8px 20px rgba(30,25,20,.12); }
      .v31-dlg .sel { position: absolute; border: 2.5px solid var(--accent); box-shadow: 0 0 0 2px #fff; }
      .v31-dlg .drag { position: absolute; padding: 4px 9px; border-radius: 999px; background: rgba(20,22,30,.72); color: #fff; font-size: 12px; white-space: nowrap; }
      .v31-dlg h4 { margin: 0 0 6px; font-size: 13.5px; }
      .v31-dlg .lays { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
      .v31-dlg .lays span.opt { display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px 6px 7px; border: 1px solid var(--line); border-radius: 8px; font-size: 12.5px; }
      .v31-dlg .lays span.opt.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); font-weight: 700; }
      .v31-dlg .lays .v31-gi { width: 18px; height: 25px; }
      .v31-dlg label.tg { display: flex; align-items: center; gap: 8px; margin: 10px 0 0; font-size: 13px; }
      .v31-dlg label.tg i { width: 32px; height: 18px; border-radius: 999px; background: #c9cddb; position: relative; }
      .v31-dlg label.tg i::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; }
      .v31-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 10px 0 0; padding: 8px 12px; border-radius: 9px; background: #f7f6f3; font-size: 12.5px; line-height: 1.6; color: #3f4249; }
      .v31-legend b { font-weight: 700; }
      .v31-legend .e { color: var(--error); }
      .v31-legend .w { color: var(--warn); }
      .v31-src2 { margin-left: 6px; font-size: 11px; font-weight: 400; color: var(--muted); }
      .v31-sev { margin: 16px 0 2px; padding: 6px 0 6px; border-bottom: 2px solid currentColor; font-size: 13px; font-weight: 700; display: flex; justify-content: space-between; }
      .v31-sev.e { color: var(--error); }
      .v31-sev.w { color: var(--warn); }
      .v31-sev span { font-weight: 400; color: var(--muted); }
      .v31-note { margin-top: 6px; padding: 7px 12px; border-radius: 9px; background: var(--accent-soft); color: #33406f; font-size: 13px; }
    `
    document.head.append(style)
  })
}

/** 作品写真の欄（パソコンの段・スマホの行）を書き換える */
const setPhotoPart = (page, { info, img, count }) =>
  page.evaluate(({ info, img, count }) => {
    const sec = document.querySelector('section[aria-label="作品写真"]')
    sec.querySelector('.p-f').innerHTML = info
    const pg = sec.querySelector('.pg')
    pg.querySelector('img').src = img
    // ページの数：作品写真は1ページのまま（写真を何枚入れても A4 の1枚）
    void count
  }, { info, img, count })

const shot = async (page, name, clip) => {
  await new Promise((r) => setTimeout(r, 250))
  await page.screenshot({ path: `${OUT}/${name}.png`, ...(clip ? { clip } : {}) })
  console.log('✓', name)
}

async function open(browser, vp, { files = true, photo = true } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  await page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
  })
  if (vp.isMobile) await page.setUserAgent(UA_IPHONE)
  await page.setViewport(vp)
  await page.goto(`${APP}/check.html`, { waitUntil: 'networkidle0' })
  if (files) {
    await drop(page, FILES)
    await settled(page, 8)
  }
  if (photo) {
    await drop(page, [PHOTO])
    await settled(page, 9)
  }
  await installKit(page)
  return { context, page }
}

// ---- 作品写真の案 ----

/** 案A：枚数で並べ方が決まる（切らずに収める）。欄には「4枚（6枚まで）」と「並べ替え・外す」 */
const infoA = (n) => `<span class="pf"><button type="button" class="fname"><span class="fn">写真 ${n}枚</span></button><span class="v31-muted">（6枚まで）</span></span><a class="v31-link">並べ替え・外す</a>`
/** 案B：並べ方を選ぶ（学生用ツールと同じ6通り。切らずに収める） */
const infoB = (n, on) =>
  `<span class="pf"><button type="button" class="fname"><span class="fn">写真 ${n}枚</span></button><span class="v31-muted">（6枚まで）</span></span><span class="v31-lays">${[[1, 1], [2, 1], [1, 2], [2, 2], [2, 3], [3, 2]].map(([c, r]) => `<button type="button">__GI_${c}_${r}_${c === on[0] && r === on[1] ? 1 : 0}__</button>`).join('')}</span>`
/** 案C：作品写真の窓で並べる（欄には枚数と「並べる」） */
const infoC = (n) => `<span class="pf"><button type="button" class="fname"><span class="fn">写真 ${n}枚</span></button><span class="v31-muted">（6枚まで）</span></span><a class="v31-link">並べる・切り抜く位置</a>`

const fillIcons = (page, html) => page.evaluate((html) => html.replace(/__GI_(\d)_(\d)_(\d)__/g, (_, c, r, on) => window.__kit.gridIcon(+c, +r, on === '1')), html)

async function photoShots(browser) {
  // ---- パソコン ----
  {
    const { context, page } = await open(browser, PC)
    // 案A：4枚（2×2・切らない）
    const a4 = await page.evaluate(() => { const k = window.__kit; const l = k.photos.slice(0, 4); const [c, r] = k.autoGrid(l); return k.page(l, c, r, 'contain') })
    await setPhotoPart(page, { info: infoA(4), img: a4 })
    await shot(page, 'a-pc')
    // 案A：「並べ替え・外す」を押したところ（小さな窓）
    await page.evaluate(() => {
      const k = window.__kit
      const r = document.querySelector('section[aria-label="作品写真"] .v31-link').getBoundingClientRect()
      const pop = document.createElement('div')
      pop.className = 'v31-pop'
      pop.style.left = `${Math.min(r.left, innerWidth - 330)}px`
      pop.style.top = `${r.bottom + 6}px`
      pop.innerHTML = `<h3>作品写真<small>4枚・6枚まで（A4 の1ページに並べます）</small></h3>${k.photos
        .slice(0, 4)
        .map((p, i) => `<div class="v31-row"><img src="${k.thumb(p)}"><span>${i + 1}. ${p.name}</span><b>↑</b><b>↓</b><b>×</b></div>`)
        .join('')}<div class="v31-add">＋ 写真を足す</div><p class="v31-hint">並べ方は枚数で決まります。写真は切らずに入れます。</p>`
      document.body.append(pop)
    })
    await shot(page, 'a-pc-menu')
    // 案B：並べ方を選ぶ（4枚・2×2）
    await page.evaluate(() => document.querySelector('.v31-pop')?.remove())
    const b4 = await page.evaluate(() => { const k = window.__kit; return k.page(k.photos.slice(0, 4), 2, 2, 'contain') })
    await setPhotoPart(page, { info: await fillIcons(page, infoB(4, [2, 2])), img: b4 })
    await shot(page, 'b-pc')
    // 案C：欄（4枚・枠いっぱいに切り抜く）と、窓
    const c4 = await page.evaluate(() => { const k = window.__kit; return k.page(k.photos.slice(0, 4), 2, 2, 'cover') })
    await setPhotoPart(page, { info: infoC(4), img: c4 })
    await shot(page, 'c-pc')
    await page.evaluate(async (img) => {
      const k = window.__kit
      const back = document.createElement('div')
      back.className = 'modal-backdrop'
      back.innerHTML = `<div class="modal v31-wrap" style="width:min(900px,calc(100vw - 32px))"><header><h2>作品写真のページ</h2><button class="close">×</button></header>
        <div class="v31-dlg"><div class="prev"><img src="${img}"><span class="sel" style="left:0;top:0;width:calc(50% - 1px);height:calc(50% - 1px)"></span><span class="drag" style="left:22%;top:23%">つかんで動かすと、見える所が変わります</span></div>
        <div><h4>並べ方</h4><div class="lays">${[[1, 1, '1枚'], [2, 1, '2枚 左右'], [1, 2, '2枚 上下'], [2, 2, '4枚'], [2, 3, '6枚 2列'], [3, 2, '6枚 3列']].map(([c, r, t]) => `<span class="opt${c === 2 && r === 2 ? ' on' : ''}">${k.gridIcon(c, r, c === 2 && r === 2)}${t}</span>`).join('')}</div>
        <h4>写真<small style="margin-left:6px;font-weight:400;color:var(--muted)">4枚・6枚まで</small></h4>
        ${k.photos.slice(0, 4).map((p, i) => `<div class="v31-row" style="${i === 0 ? 'background:var(--accent-soft)' : ''}"><img src="${k.thumb(p)}"><span>${i + 1}. ${p.name}</span><b>↑</b><b>↓</b><b>×</b></div>`).join('')}
        <div class="v31-add">＋ 写真を足す</div>
        <label class="tg"><i></i>選んだ写真を、切らずに全体を入れる</label>
        <div class="row-buttons"><span class="spacer"></span><button class="btn primary">閉じる</button></div></div></div></div>`
      document.body.append(back)
    }, c4)
    await shot(page, 'c-pc-dialog')
    await context.close()
  }
  // ---- スマホ ----
  {
    const { context, page } = await open(browser, PHONE)
    const scrollToPhoto = () => page.evaluate(() => { const s = document.querySelector('section[aria-label="作品写真"]'); window.scrollTo(0, s.getBoundingClientRect().top + scrollY - 260) })
    const a4 = await page.evaluate(() => { const k = window.__kit; const l = k.photos.slice(0, 4); const [c, r] = k.autoGrid(l); return k.page(l, c, r, 'contain') })
    await setPhotoPart(page, { info: infoA(4), img: a4 })
    await scrollToPhoto()
    await shot(page, 'a-ph')
    const b4 = await page.evaluate(() => { const k = window.__kit; return k.page(k.photos.slice(0, 4), 2, 2, 'contain') })
    await setPhotoPart(page, { info: await fillIcons(page, infoB(4, [2, 2])), img: b4 })
    await scrollToPhoto()
    await shot(page, 'b-ph')
    const c4 = await page.evaluate(() => { const k = window.__kit; return k.page(k.photos.slice(0, 4), 2, 2, 'cover') })
    await setPhotoPart(page, { info: infoC(4), img: c4 })
    await scrollToPhoto()
    await shot(page, 'c-ph')
    await context.close()
  }
  // ---- 枚数ごとの並べ方（案A：自動・切らない／案C：選ぶ・切り抜く） ----
  {
    const { context, page } = await open(browser, { width: 900, height: 700 }, { files: false, photo: false })
    const strip = await page.evaluate(() => {
      const k = window.__kit
      const P = k.photos
      const sets = [
        ['1枚', [P[0]]],
        ['2枚（縦長）', [P[0], P[1]]],
        ['2枚（横長あり）', [P[0], P[2]]],
        ['3枚', [P[0], P[1], P[2]]],
        ['4枚', P.slice(0, 4)],
        ['6枚', P.slice(0, 6)],
      ]
      return {
        auto: sets.map(([t, l]) => { const [c, r] = k.autoGrid(l); return { t, img: k.page(l, c, r, 'contain') } }),
        cover: [['1枚', 1, 1], ['2枚 左右', 2, 1], ['2枚 上下', 1, 2], ['4枚', 2, 2], ['6枚 2列', 2, 3], ['6枚 3列', 3, 2]].map(([t, c, r]) => ({ t, img: k.page(P.slice(0, c * r), c, r, 'cover') })),
      }
    })
    for (const [key, list] of Object.entries(strip)) {
      await page.setContent(`<html><body style="margin:0;padding:18px;background:#ebe8e3;font-family:'Yu Gothic UI',sans-serif"><div style="display:grid;grid-template-columns:repeat(6,1fr);gap:14px">${list.map((x) => `<figure style="margin:0;text-align:center;font-size:13px;color:#3f4249"><img src="${x.img}" style="width:100%;display:block;box-shadow:0 1px 2px rgba(30,25,20,.1),0 6px 14px rgba(30,25,20,.1)"><figcaption style="margin-top:6px">${x.t}</figcaption></figure>`).join('')}</div></body></html>`)
      await page.setViewport({ width: 900, height: 330, deviceScaleFactor: 1.5 })
      await shot(page, `layouts-${key}`)
    }
    await context.close()
  }
}

// ---- 指摘の札（「手順書」「補助」）の案 ----

async function chipShots(browser) {
  const { context, page } = await open(browser, PC, { photo: true })
  const side = async () => {
    const r = await page.evaluate(() => { const b = document.querySelector('.c2-side').getBoundingClientRect(); return { x: b.left, y: b.top, width: b.width, height: Math.min(b.height, innerHeight - b.top - 8) } })
    return r
  }
  await page.evaluate(() => { document.querySelector('.c2-side').scrollTop = 0 })
  await shot(page, 'chips-now', await side())
  // 案1：札をなくし、エラーと警告の意味を一覧の上に書く
  const original = await page.evaluate(() => document.querySelector('.c2-side').innerHTML)
  await page.evaluate(() => {
    document.querySelectorAll('.c2-side .issue .src').forEach((x) => x.remove())
    const legend = document.createElement('p')
    legend.className = 'v31-legend'
    legend.innerHTML = '<span><b class="e">× エラー</b>：直してから出す</span><span><b class="w">！ 警告</b>：できれば直す</span>'
    document.querySelector('.c2-side .fix-hint').after(legend)
  })
  await shot(page, 'chips-1', await side())
  // 案2：札の言葉を変え、押せそうに見えない形（小さな灰色の文字）にする。意味は一覧の上に
  await page.evaluate((html) => { document.querySelector('.c2-side').innerHTML = html }, original)
  await page.evaluate(() => {
    document.querySelectorAll('.c2-side .issue .src').forEach((x) => {
      const s = document.createElement('span')
      s.className = 'v31-src2'
      s.textContent = x.textContent === '手順書' ? '― 手順書の決まり' : '― 読みやすくするための確かめ'
      x.replaceWith(s)
    })
    const legend = document.createElement('p')
    legend.className = 'v31-legend'
    legend.innerHTML = '<span><b class="e">× エラー</b>：直してから出す</span><span><b class="w">！ 警告</b>：できれば直す</span>'
    document.querySelector('.c2-side .fix-hint').after(legend)
  })
  await shot(page, 'chips-2', await side())
  // 案3：「直してから出す」（エラー）と「できれば直す」（警告）に分けて並べる。札はなし
  await page.evaluate((html) => { document.querySelector('.c2-side').innerHTML = html }, original)
  await page.evaluate(() => {
    const side = document.querySelector('.c2-side')
    const issues = [...side.querySelectorAll('.issue')]
    issues.forEach((x) => x.querySelector('.src')?.remove())
    const errors = issues.filter((x) => !x.classList.contains('warning'))
    const warnings = issues.filter((x) => x.classList.contains('warning'))
    side.querySelectorAll('.igroup').forEach((g) => g.remove())
    const make = (cls, title, list) => {
      const box = document.createElement('div')
      box.innerHTML = `<div class="v31-sev ${cls}">${title}<span>${list.length}件</span></div>`
      const ul = document.createElement('ul')
      ul.className = 'issues'
      list.forEach((x) => ul.append(x))
      box.append(ul)
      return box
    }
    const legend = side.querySelector('.c2-legend')
    legend.after(make('e', '× 直してから出す（エラー）', errors), make('w', '！ できれば直す（警告）', warnings))
  })
  await shot(page, 'chips-3', await side())
  await context.close()
}

// ---- 最初の画面（ファイル名の見本）の案 ----

async function emptyShots(browser) {
  for (const [vp, tag] of [[PC, 'pc'], [PHONE, 'ph']]) {
    const { context, page } = await open(browser, vp, { files: false, photo: false })
    await shot(page, `empty-now-${tag}`)
    const original = await page.evaluate(() => [...document.querySelectorAll('.pf.none')].map((x) => x.innerHTML))
    // 案1：見本の名前をやめ、「Word」「PDF」だけ
    await page.evaluate(() => {
      for (const sec of document.querySelectorAll('section[aria-label]')) {
        const nones = sec.querySelectorAll('.pf.none')
        if (sec.getAttribute('aria-label') === '作品写真') continue
        if (nones[0]) nones[0].textContent = 'Word'
        if (nones[1]) nones[1].textContent = 'PDF'
      }
      const s = document.querySelector('.d-s')
      if (s) s.textContent = 'Word・PDF・作品写真を、まとめて入れられます。名前はそのままで大丈夫です'
    })
    await shot(page, `empty-1-${tag}`)
    // 案2：見本の名前に「例」を付け、名前は変えなくてよいと書く
    await page.evaluate((original) => {
      document.querySelectorAll('.pf.none').forEach((x, i) => { x.innerHTML = original[i] })
      for (const sec of document.querySelectorAll('section[aria-label]')) {
        if (sec.getAttribute('aria-label') === '作品写真') continue
        const first = sec.querySelector('.pf.none')
        if (first) first.insertAdjacentHTML('afterbegin', '<span style="margin-right:4px;padding:0 5px;border-radius:4px;background:var(--chip-bg);font-size:10.5px;color:var(--muted)">例</span>')
      }
      const s = document.querySelector('.d-s')
      if (s) s.textContent = 'Word・PDF・作品写真を、まとめて入れられます'
      const cap = document.querySelector('.c-cap')
      if (cap) cap.innerHTML = 'この順に並べて、1つの PDF にまとめます。<b style="color:var(--accent)">ファイルの名前は、例と違っていても大丈夫です</b>（中身を見て分けます）。'
    }, original)
    await shot(page, `empty-2-${tag}`)
    await context.close()
  }
}

// ---- 一覧のページ（mockups/v31/review.html）を、質問ごとに画像にする（shots/review-photo.png など） ----
async function reviewShots(browser) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1300, height: 900, deviceScaleFactor: 1 })
  await page.goto(`${APP}/mockups/v31/review.html`, { waitUntil: 'networkidle0' })
  for (const id of ['photo', 'chips', 'empty']) {
    const el = await page.$(`#${id}`)
    await el.screenshot({ path: `${OUT}/review-${id}.png` })
    console.log('✓', `review-${id}`)
  }
}

await withEdge(async (browser) => {
  await photoShots(browser)
  await chipShots(browser)
  await emptyShots(browser)
  await reviewShots(browser)
})
