// デザイン案 v47（パソコンの低い画面で、左の道具が窮屈）を画像に書き出す。
// はじめて使う学生の試し（2026-10-21。ノートパソコンのブラウザの大きさ 1366×634・1280×586）で見つかったこと：
//   ① 拡大・見開きのとき、左下のページ送りの「‹」が左の道具に重なり、「元に戻す」を押すとページがめくれた（いまは道具を上に重ねて、押し間違いだけ防いでいる）
//   ② 「この表」の道具が、「画像を入れる」がある・ないで 50px ずれる（マスを書いているときだけ出るため）
//   ③ 作品写真の写真を選ぶと、道具が画面に入らず、「このページを消す」「元に戻す」「やり直す」が下に隠れる（全体の表示でも）
// 本物の画面（見本の原稿）に、案の CSS と部品だけを書き足して写す（src/ は変えない）。
//   now ：いま
//   a   ：案A 道具の中のひとこと（「クリックしてその場で書く」「つかんでずらして…」など）を、低い画面では出さない（ボタンに乗せると出る）
//   b   ：案B 「元に戻す」「やり直す」を、道具から右下（「全体・見開き・拡大」の左）へ移す
//   c   ：案C 案A と案B の両方
//   どの案でも：拡大・見開きのページ送り「‹ ›」は右下にまとめる（道具に重ならない）。「この表」の「画像を入れる」はいつも同じ所（マスを書いていないときは薄く）
//   review：一覧のページ（mockups/v47/review.html）を1枚の画像にする（shots/review-palette.png）
// 学生用ツールは、Google のログインとドライブを偽物（scripts/e2e/fakeGoogle.mjs）に差し替えて開く（本物の Google にはつながない）。
// 使い方: node scripts/mockup-shots-v47.mjs [shots] [review]（何も付けなければ全部。開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync, writeFileSync } from 'node:fs'

process.env.EDGE_PORT ??= '9811'
const { withEdge } = await import('./poc/edge.mjs')
const { openTool, ready } = await import('./video/session.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const DIR = 'mockups/v47'
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })
const ONLY = process.argv.slice(2)
const want = (k) => ONLY.length === 0 || ONLY.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** ノートパソコンのブラウザの、ページに使える大きさ（タスクバーとブラウザの帯を引いた高さ） */
const SIZES = { low: { width: 1280, height: 586, deviceScaleFactor: 1.5 }, mid: { width: 1366, height: 634, deviceScaleFactor: 1.5 } }
const FACTS = {}

/** どの案にも入れる直し：拡大・見開きのページ送りは右下にまとめる */
const COMMON = `
.stage.zoomed .arrow.prev, .stage.spread .arrow.prev { left: auto !important; right: 87px !important; top: auto !important; bottom: 68px !important; translate: none !important; }
.palette .tb.mk-off { opacity: 0.35; pointer-events: none; }
`
/** 案A：低い画面では、道具の中のひとことを出さない */
const CSS_A = `
.palette .p-head span, .palette .ctx-note, .palette .lay-sub { display: none !important; }
.palette .p-head { padding-bottom: 4px !important; }
`
/** 案B：「元に戻す」「やり直す」を右下へ（道具の下の段は出さない） */
const CSS_B = `
.palette .group.undo-redo { display: none !important; }
.zoom .mk-undo { display: flex; gap: 2px; padding-right: 6px; margin-right: 4px; border-right: 1px solid var(--line); }
.zoom .mk-undo button { display: flex; align-items: center; gap: 5px; height: 34px; padding: 0 10px; border: 0; border-radius: 8px; background: none; color: var(--ink); font: inherit; font-size: 13px; }
.zoom .mk-undo button svg { width: 17px; height: 17px; }
.zoom .mk-undo button.off { color: #b5b7bc; }
`

/** 案の見た目を書き足す（kind：now・a・b・c） */
async function apply(page, kind) {
  await page.evaluate(() => document.querySelectorAll('style[data-mk]').forEach((s) => s.remove()))
  await page.evaluate(() => document.querySelectorAll('.zoom .mk-undo').forEach((s) => s.remove()))
  if (kind === 'now') return
  const css = COMMON + (kind === 'a' || kind === 'c' ? CSS_A : '') + (kind === 'b' || kind === 'c' ? CSS_B : '')
  // kind が slot：どの案にも入れる直しだけ（「画像を入れる」の場所を見せる）
  await page.evaluate((css) => {
    const s = document.createElement('style')
    s.dataset.mk = ''
    s.textContent = css
    document.head.append(s)
  }, css)
  if (kind === 'b' || kind === 'c') {
    await page.evaluate(() => {
      const src = document.querySelector('.palette .group.undo-redo')
      const zoom = document.querySelector('.zoom')
      if (!src || !zoom) return
      const box = document.createElement('div')
      box.className = 'mk-undo'
      for (const b of src.querySelectorAll('button')) {
        const c = document.createElement('button')
        c.className = b.disabled ? 'off' : ''
        c.innerHTML = b.querySelector('svg')?.outerHTML ?? ''
        c.append(b.textContent.trim())
        box.append(c)
      }
      zoom.prepend(box)
    })
  }
  await sleep(250)
}

/** 道具の高さと、画面に入っているか（数は一覧のページに書く） */
const paletteFacts = (page) =>
  page.evaluate(() => {
    const p = document.querySelector('.palette')
    const r = p.getBoundingClientRect()
    const stage = document.querySelector('.stage').getBoundingClientRect()
    const prev = document.querySelector('.arrow.prev')?.getBoundingClientRect()
    const overlap = !!prev && prev.width > 0 && prev.left < r.right && prev.right > r.left && prev.top < r.bottom && prev.bottom > r.top
    const hidden = [...p.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width > 0 && b.getBoundingClientRect().bottom > r.bottom + 1).map((b) => b.textContent.trim())
    return { height: Math.round(p.scrollHeight), shown: Math.round(r.height), room: Math.round(stage.bottom - r.top), scrolls: p.scrollHeight > p.clientHeight + 1, overlap, hidden }
  })

/** 表のマスを書いている（拡大の表示） */
async function tableState(page) {
  await page.evaluate(() => {
    const ed = window.__editor
    const t = ed.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === 't1')
    ed.goToPage(ed.pageOfBlock(t.rows[1].cells[0].id), 'none')
  })
  await ready(page)
  if (!(await page.evaluate(() => window.__editor.getSnapshot().zoomed))) {
    await page.evaluate(() => [...document.querySelectorAll('.zoom button')].find((b) => b.textContent.includes('拡大'))?.click())
    await ready(page)
    await sleep(300)
  }
  await openCell(page)
}

/** 素材表のマス（2行目の使用箇所）を書く */
async function openCell(page) {
  await page.evaluate(() => {
    const ed = window.__editor
    const t = ed.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === 't1')
    ed.openEditor(t.rows[2].cells[1].id, 0)
  })
  await page.waitForFunction(() => window.__editor.getSnapshot().editingKind === 'tableCell', { timeout: 15000 })
  await sleep(500)
}

/** 作品写真のページで、写真を押して選んでいる（全体の表示） */
async function photoState(page) {
  await page.evaluate(() => window.__editor.finishEditing())
  await page.evaluate(() => [...document.querySelectorAll('.zoom button')].find((b) => b.textContent.includes('全体'))?.click())
  await ready(page)
  await page.evaluate(() => window.__editor.goToPage(window.__editor.getSnapshot().layout.kinds.indexOf('photos'), 'none'))
  await ready(page)
  await sleep(300)
  const pt = await page.evaluate(() => {
    const img = document.querySelector('.page-viewport.front [data-photo-slot="0"] img')
    const r = img.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.mouse.click(pt.x, pt.y)
  await sleep(500)
}

/** 道具と紙面の所だけを写す（左の一覧と右の欄は写さない） */
const crop = (vp) => ({ x: 118, y: 0, width: vp.width - 118 - 340, height: vp.height })

/** ②「この表」のずれ：マスを書いているときと、表を選んでいるとき（「画像を入れる」が出ない）の左の道具。直すと薄い「画像を入れる」が同じ所に出る */
async function shiftShots(page) {
  const clip = () => page.evaluate(() => { const r = document.querySelector('.palette').getBoundingClientRect(); return { x: r.left - 6, y: r.top - 6, width: r.width + 12, height: Math.min(r.height + 12, innerHeight - r.top + 6) } })
  await openCell(page)
  await page.screenshot({ path: `${OUT}/shift-cell.png`, clip: await clip(), captureBeyondViewport: false })
  await page.evaluate(() => window.__editor.finishEditing())
  await ready(page)
  await sleep(300)
  // 表を選んでいる（マスを書いていない）：「画像を入れる」が出ない
  await page.evaluate(() => window.__editor.select({ kind: 'table', id: 't1' }))
  await sleep(500)
  await page.screenshot({ path: `${OUT}/shift-caption-now.png`, clip: await clip(), captureBeyondViewport: false })
  await apply(page, 'slot')
  await page.evaluate(() => {
    const group = [...document.querySelectorAll('.palette .group.ctx')].find((g) => g.textContent.includes('この表'))
    const rows = [...group.querySelectorAll('.tb')].find((b) => b.textContent.includes('行を足す'))
    const c = rows.cloneNode(true)
    c.classList.add('mk-off')
    c.querySelector('span').textContent = '画像を入れる'
    c.querySelector('svg').outerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="m4 17 5-5 4 4 3-3 4 4"/><circle cx="15.5" cy="9.5" r="1.5"/></svg>'
    rows.before(c)
  })
  await page.screenshot({ path: `${OUT}/shift-caption-fixed.png`, clip: await clip(), captureBeyondViewport: false })
  await apply(page, 'now')
  await page.evaluate(() => window.__editor.finishEditing())
  await ready(page)
}

async function shots(browser) {
  const { context, page } = await openTool(browser, { device: 'pc' })
  // 作品写真を2枚にする（2枚目は「1枚目」と同じ写真。見本の原稿の作品写真は1枚）
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, workPhotos: r.workPhotos.map((p, i) => (i === 0 ? { ...p, layout: 4, columns: 2, imageIds: [p.imageIds[0], p.imageIds[0], '', ''] } : p)) })))
  await ready(page)
  for (const [size, vp] of Object.entries(SIZES)) {
    await page.setViewport(vp)
    await sleep(500)
    await ready(page)
    await tableState(page)
    for (const kind of ['now', 'a', 'b', 'c']) {
      if ((await page.evaluate(() => window.__editor.getSnapshot().editingKind)) !== 'tableCell') await openCell(page)
      await apply(page, kind)
      FACTS[`${size}-table-${kind}`] = await paletteFacts(page)
      await page.screenshot({ path: `${OUT}/${kind}-${size}-table.png`, clip: crop(vp), captureBeyondViewport: false })
    }
    await apply(page, 'now')
    if (size === 'low') await shiftShots(page)
    await photoState(page)
    for (const kind of ['now', 'a', 'b', 'c']) {
      await apply(page, kind)
      FACTS[`${size}-photo-${kind}`] = await paletteFacts(page)
      await page.screenshot({ path: `${OUT}/${kind}-${size}-photo.png`, clip: crop(vp), captureBeyondViewport: false })
    }
    await apply(page, 'now')
  }
  writeFileSync(`${OUT}/facts.json`, JSON.stringify(FACTS, null, 2))
  console.log(JSON.stringify(FACTS))
  await context.close()
}

/** 一覧のページ（mockups/v47/review.html）を1枚の画像にする */
async function reviewShots(browser) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 1.25 })
  await page.goto(`${APP}/${DIR}/review.html`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${OUT}/review-palette.png`, fullPage: true })
  console.log('✓ review-palette')
  await context.close()
}

await withEdge(async (browser) => {
  if (want('shots')) await shots(browser)
  if (want('review')) await reviewShots(browser)
})
