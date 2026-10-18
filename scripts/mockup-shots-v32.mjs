// デザイン案 v32（はじめての学生役の試しで分かりにくかった4か所：図・表のあとの続きの書き方／削除の「戻す」／作品写真が切れる／スマホの見やすさ）を画像に書き出す。
// 本物の学生用ツール（開発サーバーの /?nodrive。ログインなし）に見本の原稿（scripts/e2e/sampleReport.mjs の setupWriting。衣装コースの架空の学生）を入れ、
// その画面の一部を案ごとに書き換えて写す（src/ は変えない）。見本の画像は docs/guide-images/sample/（読むだけ）。
// できるもの：mockups/v32/shots/*.png（案の画面）と、shots/review-after.png などの一覧の写し（mockups/v32/review.html を質問ごとに写したもの）
// 使い方: node scripts/mockup-shots-v32.mjs [after] [undo] [photo] [phone] [review]（何も付けなければ全部。開発サーバーが http://localhost:5173 で動いていること）
//   after ：① 図・表のあとの続きの書き方
//   undo  ：② 削除の「戻す」
//   photo ：③ 作品写真が切れる
//   phone ：④ スマホの見やすさ
//   review：一覧のページ（mockups/v32/review.html）を質問ごとに画像にする
//   Edge は EDGE_PORT（ふだんは 9471）で起動する
import { mkdirSync } from 'node:fs'

process.env.EDGE_PORT ??= '9471'
const { withEdge } = await import('./poc/edge.mjs')
const { stubConfig } = await import('./e2e/configStub.mjs')
const { setupWriting } = await import('./e2e/sampleReport.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const DIR = 'mockups/v32'
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })
const ONLY = process.argv.slice(2)
const want = (k) => ONLY.length === 0 || ONLY.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PC = { width: 1366, height: 768, deviceScaleFactor: 1.5 }
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const LAND = { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

// ---- アイコン（src/app/icons.tsx と同じ線） ----
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const IC = {
  undo: svg('<path d="M9 7.5L5 11.5l4 4M5 11.5h9.5a4.5 4.5 0 010 9H12"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  down: svg('<path d="M12 5v13M6.5 12.5L12 18l5.5-5.5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
}

/** 案の部品の見た目。色と書体は src/tokens.css・src/index.css のもの */
const CSS = `
  .v32-x { position: fixed; z-index: 50; font-family: 'BIZ UDPGothic', sans-serif; box-sizing: border-box; }
  .v32-x * { box-sizing: border-box; }
  /* ① 案A：図・表のすぐ下の「＋ ここに続きを書く」 */
  .v32-cont { z-index: 8; display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 12px; border: 1.5px dashed #9fa8cc; border-radius: 8px; background: rgba(232, 235, 245, 0.8); color: var(--accent); font-size: 12.5px; font-weight: 700; letter-spacing: 0.03em; }
  .v32-cont svg { width: 15px; height: 15px; stroke-width: 2.2; }
  /* ① 案B：クリックする所（説明用の印：矢印と波紋） */
  .v32-ripple { width: 38px; height: 38px; margin: -19px 0 0 -19px; border-radius: 50%; border: 2px solid var(--accent); background: rgba(47, 62, 117, 0.14); }
  .v32-cursor { width: 24px; height: 24px; margin: -2px 0 0 -3px; z-index: 51; }
  /* ① 案C：カーソルのそばの吹き出し */
  .v32-balloon { z-index: 40; width: 292px; padding: 9px 13px; border-radius: 10px; background: #2b2e36; color: #fff; font-size: 12.5px; line-height: 1.65; box-shadow: 0 10px 28px rgba(20, 20, 30, 0.3); }
  .v32-balloon::before { content: ''; position: absolute; top: -6px; left: var(--ax, 24px); width: 12px; height: 12px; margin-left: -6px; background: #2b2e36; transform: rotate(45deg); border-radius: 2px; }
  .v32-balloon b { color: #ffd98a; }
  /* ② 知らせ（スマホの .undo-toast と同じ形）と、残り時間の細い線 */
  .v32-toastwrap { z-index: 35; transform: translateX(-50%); width: 380px; }
  .undo-toast { position: relative; overflow: hidden; }
  .undo-toast .v32-timer { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(255, 255, 255, 0.16); }
  .undo-toast .v32-timer::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 72%; background: rgba(255, 255, 255, 0.7); }
  .undo-toast .v32-ok { display: inline-flex; align-items: center; gap: 8px; }
  .undo-toast .v32-ok svg { width: 18px; height: 18px; color: #8fd0a4; stroke-width: 2.2; }
  /* ② 戻した所を光らせる・削除する段落を示す（紙面の文字は透けて見える） */
  .v32-hl { z-index: 9; border-radius: 5px; background: #ffe7a1; box-shadow: 0 0 0 2px #e0b23c; mix-blend-mode: multiply; }
  .v32-doomed { z-index: 9; border-radius: 5px; background: #f6d8d4; box-shadow: 0 0 0 1.5px #d99a92; mix-blend-mode: multiply; }
  /* ② 案B：削除の前に確かめる小さな窓 */
  .v32-confirm { z-index: 45; width: 230px; padding: 12px 12px 10px; border: 1px solid var(--line); border-radius: 12px; background: #fff; box-shadow: 0 10px 28px rgba(30, 25, 20, 0.2); font-size: 13.5px; color: var(--ink); }
  .v32-confirm::before { content: ''; position: absolute; left: -6px; top: 46px; width: 11px; height: 11px; background: #fff; border-left: 1px solid var(--line); border-bottom: 1px solid var(--line); transform: rotate(45deg); }
  .v32-confirm b { display: block; margin: 0 2px 10px; }
  .v32-confirm div { display: flex; gap: 8px; }
  .v32-confirm button { flex: 1; min-height: 34px; border: 1px solid var(--line); border-radius: 8px; background: #fff; color: var(--ink); font: inherit; font-size: 13px; }
  .v32-confirm button.del { border-color: var(--error); background: var(--error); color: #fff; font-weight: 700; }
  /* ② 案C：「元に戻す」に、戻すものの名前 */
  .palette .tb .v32-what { display: block; margin-top: -2px; font-size: 9.5px; line-height: 1.3; color: var(--accent); font-weight: 700; letter-spacing: 0; }
  .palette .tb.v32-hover { background: var(--palette-hover); color: var(--accent); }
  .v32-tip { z-index: 45; padding: 6px 10px; border-radius: 7px; background: #2b2e36; color: #fff; font-size: 12.5px; white-space: nowrap; box-shadow: 0 6px 16px rgba(20, 20, 30, 0.25); }
  .v32-tip::before { content: ''; position: absolute; left: -4px; top: 50%; width: 9px; height: 9px; margin-top: -4.5px; background: #2b2e36; transform: rotate(45deg); }
  /* ③ 写真を切らずに入れるスイッチ（PC の道具は幅 86px なので、つまみの下に名前） */
  .v32-sw { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 100%; padding: 8px 2px 7px; border: 0; background: none; color: var(--palette-ink); font: inherit; font-size: 10.5px; line-height: 1.35; text-align: center; border-radius: var(--r-md); }
  .v32-sw i { position: relative; width: 32px; height: 18px; border-radius: 999px; background: #c9c6c0; flex: none; }
  .v32-sw i::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2); }
  .v32-sw.on i { background: var(--accent); }
  .v32-sw.on i::after { left: 16px; }
  .v32-sw.on { color: var(--accent); font-weight: 700; }
  .palette .group.ctx .v32-sw { border-top: 1px solid rgba(47, 62, 117, 0.12); border-radius: 0 0 8px 8px; }
  .palette .layouts + .v32-sw { margin-top: 6px; border-top: 1px solid var(--palette-line); border-radius: 0; }
  /* スマホの下の道具（横に1列）：つまみの右に名前 */
  .sel-bar .v32-sw { flex-direction: row; width: auto; gap: 7px; padding: 6px 8px 6px 10px; margin-left: 2px; border-left: 1px solid var(--line); border-radius: 0; font-size: 12px; text-align: left; }
  /* ④ 案A：ページの下の帯（ふつうの文字の大きさ）と、紙面に残す小さな印 */
  .v32-band { z-index: 12; padding: 12px 14px 12px; border: 1px solid var(--line); border-radius: 14px; background: #fff; box-shadow: var(--float-shadow); color: var(--ink); }
  .v32-band .t { display: flex; gap: 8px; align-items: flex-start; font-size: 14px; font-weight: 700; line-height: 1.6; }
  .v32-band .t .mk { margin-top: 1px; }
  .v32-band p { margin: 4px 0 10px 30px; font-size: 13px; line-height: 1.65; color: var(--muted); }
  .v32-band button { display: block; width: 100%; min-height: 44px; border: 0; border-radius: 10px; background: var(--accent); color: #fff; font: inherit; font-size: 14.5px; font-weight: 700; }
  .v32-band.row { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 12px; }
  .v32-band.row .t { flex: 1; align-items: center; font-size: 13.5px; }
  .v32-band.row button { width: auto; flex: none; padding: 0 16px; }
  .v32-band.side { padding: 14px 16px; }
  .mk { flex: none; display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--accent); color: #fff; }
  .mk svg { width: 14px; height: 14px; stroke-width: 2.4; }
  .v32-mark { z-index: 9; transform: translate(-50%, -50%); width: 26px; height: 26px; box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.9); }
  .v32-mark svg { width: 16px; height: 16px; }
  .v32-mark.plus { width: 34px; height: 34px; background: #fff; color: var(--accent); box-shadow: inset 0 0 0 2px var(--accent); }
  .v32-mark.plus svg { width: 20px; height: 20px; }
  /* ④ 案B：2本の指で広げる（説明用の印） */
  .v32-fingers { z-index: 40; inset: 0; pointer-events: none; }
  /* ④ 3案とも：小さいボタンを、見た目も高さ 44px 以上に */
  html.v32-big .pager button { width: 44px; height: 44px; }
  html.v32-big .issue .fix { min-height: 44px; padding: 0 16px; font-size: 13px; }
  html.v32-big .es-head .done { min-height: 44px; padding: 0 20px; }
  html.v32-big .g-later, html.v32-big .add-refs { min-height: 44px; display: inline-flex; align-items: center; }
  html.v32-big .unzoom { min-height: 44px; }
  /* ページ送りが高くなった分、並べ方の道具を少し上に（重ならないように） */
  html.v32-big .sel-bar { bottom: calc(62px + 12px + 52px + 8px); }
  /* スマホの紙面のスクロールバーは出さない（iPhone では重ねて出て、すぐ消えるため。撮影用の Edge だけ、いつも出てしまう） */
  .app.phone .page-scroller { scrollbar-width: none; }
`

/** ページの中で使う道具（位置を測る・部品を足す・消す） */
async function installKit(page) {
  await page.evaluate((css) => {
    const style = document.createElement('style')
    style.id = 'v32-style'
    style.textContent = css
    document.head.append(style)
    const state = document.createElement('style')
    state.id = 'v32-state'
    document.head.append(state)
    const shown = (els) => [...els].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
    window.__v32 = {
      /** 紙面のその部分（いま見ているページの分）の画面での位置。段落がいくつかに分かれていれば、まとめた範囲 */
      rect(sel) {
        const rs = shown(document.querySelectorAll(`.page-viewport.front ${sel}`)).map((e) => e.getBoundingClientRect())
        if (!rs.length) return null
        const left = Math.min(...rs.map((r) => r.left))
        const top = Math.min(...rs.map((r) => r.top))
        const right = Math.max(...rs.map((r) => r.right))
        const bottom = Math.max(...rs.map((r) => r.bottom))
        return { left, top, right, bottom, width: right - left, height: bottom - top, cx: (left + right) / 2, cy: (top + bottom) / 2 }
      },
      /** いま見ているページの位置と倍率、本文の版面（左の余白 35mm・右の余白 25mm の内側） */
      page() {
        const el = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current')
        const r = el.getBoundingClientRect()
        const s = r.width / 793.7
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, s, textLeft: r.left + 132.3 * s, textWidth: 566.9 * s }
      },
      /** 部品を足す（body の直下。fixed で画面に置く） */
      add(html) {
        document.body.insertAdjacentHTML('beforeend', html)
        return document.body.lastElementChild
      },
      /** 案の部品を全部外す */
      clear() {
        document.querySelectorAll('.v32-x, [data-v32]').forEach((e) => e.remove())
        document.querySelectorAll('.v32-hover').forEach((e) => e.classList.remove('v32-hover'))
        document.getElementById('v32-state').textContent = ''
      },
      /** その時だけの見た目（紙面の写真を切らずに入れる、など） */
      state(css) {
        document.getElementById('v32-state').textContent = css
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
  await installKit(page)
  return { context, page }
}

/** その段落・図があるページを出す */
async function showBlock(page, id) {
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), id)
  await ready(page)
  await sleep(300)
}
async function showKind(page, kind) {
  await page.evaluate((kind) => window.__editor.goToPage(window.__editor.getSnapshot().layout.kinds.indexOf(kind), 'none'), kind)
  await ready(page)
  await sleep(300)
}

/** 確かめ：横にはみ出していないか */
const audit = (page, name) =>
  page
    .evaluate(() => {
      const bad = []
      if (document.documentElement.scrollWidth > innerWidth + 1) bad.push(`横にはみ出している（${document.documentElement.scrollWidth}px）`)
      for (const el of document.querySelectorAll('.v32-x')) {
        const r = el.getBoundingClientRect()
        if (r.width && (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1)) bad.push(`画面の外：${el.className}`)
      }
      return bad
    })
    .then((bad) => bad.length && console.log(`  ！${name}：${bad.join(' ／ ')}`))

/**
 * 撮る。clip：'paper'（PC：左の道具から紙面の右の端までの縦長の範囲。左のページ一覧と右の欄は写さない。
 * 2枚を横に並べても、紙面の字が読める大きさになるように）
 */
async function shot(page, name, clip) {
  await page.evaluate(() => document.fonts.ready)
  await sleep(300)
  await audit(page, name)
  const paper =
    clip === 'paper'
      ? await page.evaluate(() => {
          const st = document.querySelector('.stage').getBoundingClientRect()
          const pal = document.querySelector('.palette').getBoundingClientRect()
          const pg = window.__v32.page()
          const x = Math.max(st.left, pal.left - 14)
          const right = Math.min(st.right, pg.right + 12)
          // 案の部品が、写す範囲からはみ出していないか
          const out = [...document.querySelectorAll('.v32-x')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.left < x - 1 || r.right > right + 1) }).map((e) => e.className)
          return { box: { x, y: st.top, width: right - x, height: st.height }, out }
        })
      : null
  if (paper?.out.length) console.log(`  ！${name}：写す範囲の外：${paper.out.join(' ／ ')}`)
  const box = paper?.box
  // captureBeyondViewport: false：写すときに画面の大きさを変えない（変わると、書いている欄が閉じてしまう）
  await page.screenshot({ path: `${OUT}/${name}.png`, captureBeyondViewport: false, ...(box ? { clip: box } : {}) })
  console.log('✓', name)
}

/** 画面の外（紙面のない所）にマウスを置く（ボタンの上に乗ったままにしない） */
const parkMouse = (page) => page.mouse.move(5, 760)

// =====================================================================
// ① 図・表のあとの続きの書き方
// =====================================================================
async function afterShots(browser) {
  const { context, page } = await open(browser, PC)
  // 書いている途中：「袖の刺繍」の段落に図3を入れたところまで（図3がこの原稿の最後。下は空いている）
  await page.evaluate(() =>
    window.__editor.update((r) => {
      const c2 = r.body[1]
      const end = c2.blocks.findIndex((b) => b.id === 'r3')
      return { ...r, body: [r.body[0], { ...c2, blocks: c2.blocks.slice(0, end + 1) }] }
    }),
  )
  await sleep(300)
  await ready(page)
  await showBlock(page, 'p8')

  // いま：図のタイトルで Enter → 図の上の段落の終わりに戻る（次の文が図の前に入る）
  await page.evaluate(() => window.__editor.openEditor('p8', 0))
  await sleep(500)
  await page.keyboard.down('Control')
  await page.keyboard.press('End')
  await page.keyboard.up('Control')
  await parkMouse(page)
  await sleep(300)
  await shot(page, 'after-now', 'paper')

  // 案C：戻ったときに、カーソルのそばに吹き出し
  await page.evaluate(() => {
    const ed = document.querySelector('.overlay-editor')
    const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT)
    let last = null
    while (walker.nextNode()) if (walker.currentNode.textContent.length) last = walker.currentNode
    const range = document.createRange()
    range.setStart(last, last.textContent.length - 1)
    range.setEnd(last, last.textContent.length)
    const c = range.getBoundingClientRect()
    const p = window.__v32.page()
    const left = Math.min(c.right - 26, p.right - 300)
    window.__v32.add(`<div class="v32-x v32-balloon" style="left:${left}px;top:${c.bottom + 12}px;--ax:${c.right - left}px">図の上の段落に戻りました。<br>図の後ろに書くときは、図のタイトルで <b>もう一度 Enter</b></div>`)
  })
  await shot(page, 'after-c', 'paper')
  await page.evaluate(() => window.__v32.clear())
  await page.evaluate(() => window.__editor.finishEditing())
  await ready(page)

  // 案A：図を選んでいる（または、図がページの最後で下が空いている）とき、図のすぐ下に「＋ ここに続きを書く」
  const fig = await page.evaluate(() => { const r = window.__v32.rect('figure[data-figure-id="f3"] img'); return { x: r.cx, y: r.cy } })
  await page.mouse.click(fig.x, fig.y)
  await sleep(500)
  await parkMouse(page)
  await page.evaluate((icon) => {
    const f = window.__v32.rect('figure[data-figure-id="f3"]')
    const p = window.__v32.page()
    window.__v32.add(`<div class="v32-x v32-cont" style="left:${p.textLeft}px;top:${f.bottom + 12}px;width:${p.textWidth}px">${icon}ここに続きを書く</div>`)
  }, IC.plus)
  await shot(page, 'after-a-1', 'paper')
  await page.evaluate(() => window.__v32.clear())

  // 案B：何も出さない。図の下の空いている所をクリックする（矢印と波紋は説明用の印）
  await page.evaluate(() => window.__editor.select(null))
  await sleep(300)
  await page.evaluate(() => {
    const f = window.__v32.rect('figure[data-figure-id="f3"]')
    const p = window.__v32.page()
    const x = p.textLeft + p.textWidth * 0.3
    const y = f.bottom + 54
    window.__v32.add(`<div class="v32-x v32-ripple" style="left:${x}px;top:${y}px"></div>`)
    window.__v32.add(`<svg class="v32-x v32-cursor" style="left:${x}px;top:${y}px" viewBox="0 0 24 24"><path d="M3 2l15 8.2-6.6 1.6L8.6 18z" fill="#fff" stroke="#23262b" stroke-width="1.4" stroke-linejoin="round"/></svg>`)
  })
  await shot(page, 'after-b-1', 'paper')
  await page.evaluate(() => window.__v32.clear())

  // 案A・B の結果：図の後ろに新しい段落ができ、そこで書き続ける（図の後ろの段落で、次の文を書いているところ）
  await page.evaluate(() =>
    window.__editor.update((r) => ({
      ...r,
      body: r.body.map((c) => (c.id === 'c2' ? { ...c, blocks: [...c.blocks, { type: 'paragraph', id: 'p-new', content: [] }] } : c)),
    })),
  )
  await sleep(300)
  await ready(page)
  await page.evaluate(() => window.__editor.openEditor('p-new', 0))
  await sleep(500)
  await page.keyboard.type('最初の図案は波が細かすぎて、離れると模様が見えなかった。')
  await sleep(1500)
  await ready(page)
  await parkMouse(page)
  await shot(page, 'after-result', 'paper')
  await context.close()
}

// =====================================================================
// ② 削除の「戻す」
// =====================================================================

/** 戻した段落を光らせる（紙面の文字は透けて見える） */
const highlight = (page, id) =>
  page.evaluate((id) => {
    const r = window.__v32.rect(`[data-block-id="${id}"]`)
    window.__v32.add(`<div class="v32-x v32-hl" style="left:${r.left - 6}px;top:${r.top - 4}px;width:${r.width + 12}px;height:${r.height + 8}px"></div>`)
  }, id)

/** PC の知らせ（紙面の台の下の真ん中） */
const pcToast = (page, inner) =>
  page.evaluate((inner) => {
    const st = document.querySelector('.stage').getBoundingClientRect()
    const p = window.__v32.page()
    window.__v32.add(`<div class="v32-x v32-toastwrap" style="left:${p.left + p.width / 2}px;bottom:${innerHeight - st.bottom + 18}px"><div class="undo-toast">${inner}</div></div>`)
  }, inner)

async function undoShots(browser) {
  // ---- パソコン ----
  {
    const { context, page } = await open(browser, PC)
    await showBlock(page, 'p2')
    // 案B：段落を書いていて「削除」を押すと、小さな窓で確かめる
    await page.evaluate(() => window.__editor.openEditor('p2', 14))
    await sleep(500)
    await page.evaluate(() => {
      const b = document.querySelector('.palette .group.ctx .tb.danger').getBoundingClientRect()
      const r = window.__v32.rect('[data-block-id="p2"]')
      window.__v32.add(`<div class="v32-x v32-doomed" style="left:${r.left - 6}px;top:${r.top - 4}px;width:${r.width + 12}px;height:${r.height + 8}px"></div>`)
      window.__v32.add(`<div class="v32-x v32-confirm" style="left:${b.right + 16}px;top:${b.top + b.height / 2 - 52}px"><b>この段落を削除しますか？</b><div><button class="del">削除する</button><button>やめる</button></div></div>`)
    })
    await parkMouse(page)
    await shot(page, 'undo-b-pc', 'paper')
    await page.evaluate(() => window.__v32.clear())

    // 案A：削除すると、PC でも下に「段落を削除しました［戻す］」（15秒か、次の操作まで）
    await page.evaluate(() => document.querySelector('.palette .group.ctx .tb.danger').click())
    await sleep(300)
    await ready(page)
    await pcToast(page, `<span>段落を削除しました</span><button>${IC.undo}戻す</button><i class="v32-timer"></i>`)
    await parkMouse(page)
    await shot(page, 'undo-a-pc', 'paper')
    await page.evaluate(() => window.__v32.clear())
    // 案A：「戻す」を押すと「段落を戻しました」。戻した所へ移り、少しの間光らせる
    await page.evaluate(() => window.__editor.undo())
    await sleep(300)
    await ready(page)
    await highlight(page, 'p2')
    await pcToast(page, `<span class="v32-ok">${IC.check}段落を戻しました</span>`)
    await shot(page, 'undo-a-pc-2', 'paper')
    await page.evaluate(() => window.__v32.clear())

    // 案C：知らせは出さない。道具の「元に戻す」に、戻すものの名前（段落の削除）を出す
    await page.evaluate(() => window.__editor.openEditor('p2', 14))
    await sleep(500)
    await page.evaluate(() => document.querySelector('.palette .group.ctx .tb.danger').click())
    await sleep(300)
    await ready(page)
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('.palette .tb')].find((x) => x.textContent.includes('元に戻す'))
      b.classList.add('v32-hover')
      b.insertAdjacentHTML('beforeend', '<small class="v32-what" data-v32>段落の削除</small>')
      const r = b.getBoundingClientRect()
      window.__v32.add(`<div class="v32-x v32-tip" style="left:${r.right + 10}px;top:${r.top + r.height / 2 - 15}px">元に戻す：段落の削除</div>`)
    })
    await parkMouse(page)
    await shot(page, 'undo-c-pc', 'paper')
    await page.evaluate(() => window.__v32.clear())
    // 案C：押すと、戻した所へ移り、少しの間光らせる（知らせは出さない）
    await page.evaluate(() => window.__editor.undo())
    await sleep(300)
    await ready(page)
    await highlight(page, 'p2')
    await shot(page, 'undo-c-pc-2', 'paper')
    await context.close()
  }
  // ---- スマホ（案A。知らせは今のまま。15秒か次の操作まで出す） ----
  {
    const { context, page } = await open(browser, PHONE)
    await showBlock(page, 'p2')
    const at = await page.evaluate(() => { const r = window.__v32.rect('[data-block-id="p2"]'); return { x: r.left + 30, y: r.top + 4 } })
    await page.touchscreen.tap(at.x, at.y)
    await sleep(700)
    await page.evaluate(() => [...document.querySelectorAll('.edit-sheet .es-tools button')].find((b) => b.textContent.includes('削除')).click())
    await sleep(400)
    await ready(page)
    await page.waitForSelector('.undo-toast')
    await page.evaluate(() => document.querySelector('.undo-toast').insertAdjacentHTML('beforeend', '<i class="v32-timer" data-v32></i>'))
    await shot(page, 'undo-a-ph')
    await page.evaluate(() => document.querySelector('.undo-toast button').click())
    await sleep(300)
    await ready(page)
    await highlight(page, 'p2')
    await page.evaluate((icon) => window.__v32.add(`<div class="v32-x undo-area" style="position:fixed"><div class="undo-toast"><span class="v32-ok">${icon}段落を戻しました</span></div></div>`), IC.check)
    await shot(page, 'undo-a-ph-2')
    await context.close()
  }
}

// =====================================================================
// ③ 作品写真が切れる
// =====================================================================

/** 作品写真のページ：2枚（上下）。上は縦長の全身（枠いっぱいだと頭と裾が切れる）、下は横長の部分の写真 */
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
    window.__editor.update((r) => ({ ...r, workPhotos: { layout: 2, columns: 1, imageIds: ['g-photo1', 'g-detail'] } }))
  })

/** 紙面の写真を切らずに入れる（slots：何枚目か。0 から。'all' は全部） */
const containCss = (slots) =>
  (slots === 'all' ? ['.page-viewport [data-photo-slot] img'] : slots.map((i) => `.page-viewport [data-photo-slot="${i}"] img`)).join(', ') + ' { object-fit: contain !important; object-position: 50% 50% !important; }'

/** 道具のスイッチ。where：'ctx'（「この写真」の欄）・'layouts'（「並べ方」の欄の下）・'bar'（スマホの下の道具） */
const addSwitch = (page, where, label, on) =>
  page.evaluate((where, label, on) => {
    const html = `<button class="v32-sw${on ? ' on' : ''}" data-v32><i></i><span>${label}</span></button>`
    if (where === 'ctx') [...document.querySelectorAll('.palette .group.ctx')].find((g) => g.querySelector('.ctx-label')?.textContent === 'この写真').insertAdjacentHTML('beforeend', html)
    if (where === 'layouts') document.querySelector('.palette .layouts').insertAdjacentHTML('afterend', html)
    if (where === 'bar') document.querySelector('.sel-bar .group.ctx').insertAdjacentHTML('beforeend', html)
  }, where, label, on)

async function photoShots(browser) {
  // ---- パソコン ----
  {
    const { context, page } = await open(browser, PC)
    await preparePhotos(page)
    await sleep(300)
    await ready(page)
    await showKind(page, 'photos')
    // 案A：写真を押すと「差し替え」「外す」と、スイッチ「全体を入れる（切らない）」（その写真だけ）
    await page.evaluate(() => window.__editor.select({ kind: 'photos', index: 0 }))
    await sleep(400)
    await addSwitch(page, 'ctx', '全体を入れる<br>（切らない）', false)
    await parkMouse(page)
    await shot(page, 'photo-a-pc-1', 'paper')
    await page.evaluate(() => window.__v32.clear())
    await addSwitch(page, 'ctx', '全体を入れる<br>（切らない）', true)
    await page.evaluate((css) => window.__v32.state(css), containCss([0]))
    await shot(page, 'photo-a-pc-2', 'paper')
    await page.evaluate(() => window.__v32.clear())
    // 案B：並べ方の下に、ページ全体のスイッチ「写真を切らずに入れる」
    await page.evaluate(() => window.__editor.select(null))
    await sleep(400)
    await addSwitch(page, 'layouts', '写真を<br>切らずに<br>入れる', true)
    await page.evaluate((css) => window.__v32.state(css), containCss('all'))
    await shot(page, 'photo-b-pc', 'paper')
    await page.evaluate(() => window.__v32.clear())
    // 案C：はじめから全部「切らずに入れる」。写真を押すと「枠いっぱいにする」を選べる
    await page.evaluate(() => window.__editor.select({ kind: 'photos', index: 0 }))
    await sleep(400)
    await addSwitch(page, 'ctx', '枠いっぱいに<br>する', false)
    await page.evaluate((css) => window.__v32.state(css), containCss('all'))
    await shot(page, 'photo-c-pc', 'paper')
    await context.close()
  }
  // ---- スマホ（案A） ----
  {
    const { context, page } = await open(browser, PHONE)
    await preparePhotos(page)
    await sleep(300)
    await ready(page)
    await showKind(page, 'photos')
    await page.evaluate(() => window.__editor.select({ kind: 'photos', index: 0 }))
    await sleep(400)
    await addSwitch(page, 'bar', '全体を入れる<br>（切らない）', true)
    await page.evaluate((css) => window.__v32.state(css), containCss([0]))
    await shot(page, 'photo-a-ph')
    await context.close()
  }
}

// =====================================================================
// ④ スマホの見やすさ
// =====================================================================

/** 抄録はまだ（先生の許可が出る前）・作品写真は2枚（上下）で下の枠が空いている・本文に「見頃」（指摘の「直す」が出る） */
const preparePhone = (page) =>
  page.evaluate(() =>
    window.__editor.update((r) => ({
      ...r,
      abstract: { ...r.abstract, started: false },
      workPhotos: { layout: 2, columns: 1, imageIds: ['g-photo1', ''] },
      body: r.body.map((c) => ({
        ...c,
        blocks: c.blocks.map((b) => (b.id === 'p7' ? { ...b, content: [{ type: 'text', text: '二回目の仮縫いでは、見頃の丈も確かめた。実際に舞台の上で歩いたり腕を回したりして、動きやすさを確かめた。' }] } : b)),
      })),
    })),
  )

/** 紙面の台の下の余白を変えて、紙面を上に寄せる（案A：帯の分をあける） */
const setInsetBottom = async (page, px) => {
  await page.evaluate((px) => {
    const st = document.querySelector('.stage')
    if (px === null) st.style.removeProperty('--inset-bottom')
    else st.style.setProperty('--inset-bottom', `${px}px`)
    window.__editor.setZoom(false)
  }, px)
  await sleep(500)
}

/** 2本の指で広げる（説明用の印）。紙面を k 倍にし、(tx, ty) を画面の (cx, cy) に持ってくる */
const pinch = (page, sel, k, fingers) =>
  page.evaluate((sel, k, fingers) => {
    const t = window.__v32.rect(sel)
    const vp = document.querySelector('.page-viewport.front')
    const box = vp.getBoundingClientRect()
    const st = document.querySelector('.stage').getBoundingClientRect()
    const cx = st.left + st.width / 2
    const cy = st.top + (st.height - 70) / 2
    vp.style.transformOrigin = `${t.cx - box.left}px ${t.cy - box.top}px`
    vp.style.transform = `translate(${cx - t.cx}px, ${cy - t.cy}px) scale(${k})`
    vp.dataset.v32zoom = '1'
    const [a, b] = fingers.map(([dx, dy]) => [cx + dx, cy + dy])
    const arrow = (x, y, ux, uy) => `<path d="M${x + ux * 32} ${y + uy * 32} L${x + ux * 62} ${y + uy * 62}" stroke="#2f3e75" stroke-width="3" stroke-linecap="round"/><path d="M${x + ux * 62 - uy * 8 - ux * 10} ${y + uy * 62 + ux * 8 - uy * 10} L${x + ux * 62} ${y + uy * 62} L${x + ux * 62 + uy * 8 - ux * 10} ${y + uy * 62 - ux * 8 - uy * 10}" fill="none" stroke="#2f3e75" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const ux = (b[0] - a[0]) / len
    const uy = (b[1] - a[1]) / len
    const dot = (x, y) => `<circle cx="${x}" cy="${y}" r="24" fill="rgba(47,62,117,0.22)" stroke="#fff" stroke-width="3"/><circle cx="${x}" cy="${y}" r="24" fill="none" stroke="rgba(47,62,117,0.55)" stroke-width="1.5"/>`
    window.__v32.add(`<svg class="v32-x v32-fingers" width="${innerWidth}" height="${innerHeight}" style="left:0;top:0">${dot(...a)}${dot(...b)}${arrow(a[0], a[1], -ux, -uy)}${arrow(b[0], b[1], ux, uy)}</svg>`)
  }, sel, k, fingers)
const unpinch = (page) =>
  page.evaluate(() => {
    const vp = document.querySelector('.page-viewport.front[data-v32zoom]')
    if (!vp) return
    vp.style.transform = ''
    vp.style.transformOrigin = ''
    delete vp.dataset.v32zoom
  })

/** 案C：拡大した表示のまま、ページ送り（44px）も出す（今の拡大では、ページ送りが消えるため） */
const fakePager = (page, html) =>
  page.evaluate((html) => {
    const el = window.__v32.add(html)
    el.classList.add('v32-x')
    el.style.zIndex = '10'
  }, html)

async function phoneShots(browser) {
  const { context, page } = await open(browser, PHONE)
  await preparePhone(page)
  await sleep(300)
  await ready(page)
  // ---- いま ----
  await showKind(page, 'abstract')
  await shot(page, 'phone-now-abstract')
  await showKind(page, 'photos')
  await shot(page, 'phone-now-photo')
  // 3案とも：指摘の「直す」など、小さいボタンを高さ 44px 以上に（いま／あと）
  await page.evaluate(() => [...document.querySelectorAll('.p-nav button')].find((b) => b.textContent.includes('チェック')).click())
  await sleep(700)
  await shot(page, 'phone-btn-now')
  await page.evaluate(() => document.documentElement.classList.add('v32-big'))
  await sleep(200)
  await shot(page, 'phone-btn-44')
  await page.evaluate(() => document.querySelector('.sheet-close').click())
  await sleep(500)

  // ---- 案A：紙面の中の案内・ボタンは、ページの下の帯に、ふつうの文字の大きさで出す（紙面には小さな印だけ） ----
  // 抄録：帯の高さを測ってから、帯の分だけ紙面を上に寄せる
  await showKind(page, 'abstract')
  const PAGER_TOP = 844 - 74 - 52
  const STAGE_BOTTOM = 844 - 62
  const abstractBand = (cls, style) =>
    `<div class="v32-x v32-band ${cls}" style="${style}"><div class="t"><span class="mk">${IC.down}</span><span>抄録は、本文を書き終えて、先生のチェックで許可が出てから書きます。</span></div><p>許可が出たら、下のボタンを押してください（それまで、このページは PDF には入りません）。</p><button>先生の許可が出た（抄録を書き始める）</button></div>`
  const bandH = await page.evaluate((html) => { const el = window.__v32.add(html); const h = el.offsetHeight; el.remove(); return h }, abstractBand('', 'left:10px;right:10px;top:0;visibility:hidden'))
  const bandTop = PAGER_TOP - 10 - bandH
  await setInsetBottom(page, STAGE_BOTTOM - bandTop + 10)
  await page.evaluate(() => window.__v32.state('.page-viewport .abstract-lock > * { display: none !important; } .page-viewport .abstract-lock { padding: 0 !important; height: 16mm; }'))
  await sleep(200)
  await page.evaluate((html, icon) => {
    window.__v32.add(html)
    const r = window.__v32.rect('.abstract-lock')
    window.__v32.add(`<span class="v32-x mk v32-mark" style="left:${r.cx}px;top:${r.cy}px">${icon}</span>`)
  }, abstractBand('', `left:10px;right:10px;top:${bandTop}px`), IC.down)
  await shot(page, 'phone-a-abstract')
  await page.evaluate(() => window.__v32.clear())
  // 作品写真：空いている枠には「＋」の印だけ。帯に「写真を選ぶ」。並べ方の道具は、その下
  await showKind(page, 'photos')
  await page.evaluate(() => { document.querySelector('.sel-bar').style.bottom = `${62 + 12 + 52 + 8}px` })
  const selTop = await page.evaluate(() => document.querySelector('.sel-bar').getBoundingClientRect().top)
  const photoBand = `<div class="v32-x v32-band row" style="left:10px;right:10px;top:0"><div class="t"><span class="mk">${IC.plus}</span><span>下の枠に、まだ写真がありません</span></div><button>写真を選ぶ</button></div>`
  const rowH = await page.evaluate((html) => { const el = window.__v32.add(html); const h = el.offsetHeight; el.remove(); return h }, photoBand)
  const rowTop = selTop - 8 - rowH
  await setInsetBottom(page, STAGE_BOTTOM - rowTop + 10)
  await page.evaluate(() => window.__v32.state('.page-viewport [data-photo-slot]:empty::before { content: none !important; }'))
  await page.evaluate((html, top, icon) => {
    window.__v32.add(html.replace('top:0', `top:${top}px`))
    const r = window.__v32.rect('[data-photo-slot="1"]')
    window.__v32.add(`<span class="v32-x mk v32-mark plus" style="left:${r.cx}px;top:${r.cy}px">${icon}</span>`)
  }, photoBand, rowTop, IC.plus)
  await shot(page, 'phone-a-photo')
  await page.evaluate(() => { window.__v32.clear(); document.querySelector('.sel-bar').style.bottom = '' })
  await setInsetBottom(page, null)
  // 横向き：紙面は幅 160px ほど。帯は紙面の右に出す
  await page.setViewport(LAND)
  await sleep(800)
  await ready(page)
  await showKind(page, 'abstract')
  await page.evaluate(() => window.__v32.state('.page-viewport .abstract-lock > * { display: none !important; } .page-viewport .abstract-lock { padding: 0 !important; height: 16mm; }'))
  await sleep(200)
  await page.evaluate((html, icon) => {
    const p = window.__v32.page()
    const st = document.querySelector('.stage').getBoundingClientRect()
    const el = window.__v32.add(html)
    el.style.left = `${p.right + 18}px`
    el.style.width = `${Math.min(330, innerWidth - p.right - 30)}px`
    el.style.top = `${st.top + (st.height - el.offsetHeight) / 2 - 18}px`
    const r = window.__v32.rect('.abstract-lock')
    window.__v32.add(`<span class="v32-x mk v32-mark" style="left:${r.cx}px;top:${r.cy}px;width:20px;height:20px">${icon}</span>`)
  }, abstractBand('side', ''), IC.down)
  await shot(page, 'phone-a-land')
  await page.evaluate(() => window.__v32.clear())
  await page.setViewport(PHONE)
  await sleep(800)
  await ready(page)

  // ---- 案B：紙面を2本の指で広げられる（1本の指は今のまま）＋ 44px のボタン ----
  await showKind(page, 'abstract')
  await pinch(page, '.abstract-lock', 2.1, [[-100, 175], [100, 285]])
  await shot(page, 'phone-b-abstract')
  await unpinch(page)
  await page.evaluate(() => window.__v32.clear())
  await showKind(page, 'photos')
  await pinch(page, '[data-photo-slot="1"]', 2.3, [[-110, -150], [110, 150]])
  await shot(page, 'phone-b-photo')
  await unpinch(page)
  await page.evaluate(() => window.__v32.clear())

  // ---- 案C：はじめから拡大した表示（本文の幅＝画面の幅）で開き、上下に動かして見る ＋ 44px のボタン ----
  for (const [kind, name, target] of [['abstract', 'phone-c-abstract', null], ['photos', 'phone-c-photo', '[data-photo-slot="1"]']]) {
    await showKind(page, kind)
    const pagerHtml = await page.evaluate(() => document.querySelector('.pager').outerHTML)
    await page.evaluate(() => window.__editor.setZoom(true))
    await sleep(700)
    if (target)
      await page.evaluate((target) => {
        const sc = document.querySelector('.stage .page-scroller')
        const r = window.__v32.rect(target)
        sc.scrollTop += r.cy - 380
      }, target)
    await sleep(300)
    await fakePager(page, pagerHtml)
    await page.evaluate(() => window.__v32.state('.unzoom { top: 58px; bottom: auto !important; }'))
    await shot(page, name)
    await page.evaluate(() => { window.__v32.clear(); window.__editor.setZoom(false) })
    await sleep(400)
  }
  await context.close()
}

// =====================================================================
// 一覧のページ（mockups/v32/review.html）を、質問ごとに画像にする（shots/review-after.png など）
// =====================================================================
async function reviewShots(browser) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1300, height: 900, deviceScaleFactor: 1 })
  await page.goto(`${APP}/${DIR}/review.html`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  for (const id of ['after', 'undo', 'photo', 'phone']) {
    const el = await page.$(`#${id}`)
    await el.screenshot({ path: `${OUT}/review-${id}.png` })
    console.log('✓', `review-${id}`)
  }
  await page.close()
}

await withEdge(async (browser) => {
  if (want('after')) await afterShots(browser)
  if (want('undo')) await undoShots(browser)
  if (want('photo')) await photoShots(browser)
  if (want('phone')) await phoneShots(browser)
  if (want('review')) await reviewShots(browser)
})
