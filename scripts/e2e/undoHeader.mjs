// スマホの上の帯の「戻す」「やり直す」（mockups/v39 案A：依頼者の判断）を確かめる（Edge を自動で操作する。phone.mjs から呼ぶ）。
// 画面の写真は poc-output/v39-impl/ に置く（390×844 の縦・360px・375px・書く欄を開いたとき・横向き）。
// - ≡ の左に「戻す」「やり直す」（絵の下に小さな名前。読み上げは「元に戻す」「やり直す」）。どれも 44px 四方以上（≡ も）
// - 何もタップしていなくても戻せる（段落を削除したあと・作品写真の並べ方を変えたあと）。戻した所が光る。戻すものがなければ灰色
// - 「やり直す」は、戻したあとだけ押せる（それまでは灰色）
// - 書く欄を開いている間は出さない（書く欄の中の「戻す」「やり直す」を使う）
// - 保存のようすは短い言葉（ドライブを止めているときの保存した時刻は時刻だけ。メニューの中は「自動保存 13:05」のまま）。
//   390・375・360px で、いちばん長い言葉（● 保存エラー）でも切れず、帯からはみ出さない。360px ほどでは「卒」のマークを出さない
import { mkdirSync } from 'node:fs'
import { stubConfig } from './configStub.mjs'
import { setupWriting } from './sampleReport.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/v39-impl'
mkdirSync(OUT, { recursive: true })
const pause = (ms = 400) => new Promise((r) => setTimeout(r, ms))
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const SIZES = [
  ['390', PHONE],
  ['375', { width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ['360', { width: 360, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
]
const LAND = { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
/** 書く欄を開いて削除する段落（本文 3ページ。図の下の段落） */
const PARA = 'p9'
const UNDO = '.p-top .p-undo button[aria-label="元に戻す"]'
const REDO = '.p-top .p-undo button[aria-label="やり直す"]'

/** 確かめている途中に src/ が直されても、画面が入れ替わらないようにする（smoke.mjs と同じ） */
const noHotReload = (page) =>
  page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
  })

/** 見本の原稿（指摘0件）を開く（入れ替えで入れるので、「戻す」「やり直す」の履歴は空） */
async function openSample(browser) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await noHotReload(page)
  await stubConfig(page)
  page.on('pageerror', (e) => console.log('pageerror(undo-header):', e.message))
  page.on('dialog', (d) => d.dismiss())
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  })
  await page.setUserAgent(UA_IPHONE)
  await page.setViewport(PHONE)
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0', timeout: 90000 })
  const ready = () =>
    page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 60000 })
  await ready()
  await page.waitForSelector('.guide.step-course .g-opts button')
  await page.evaluate(() => [...document.querySelectorAll('.guide .g-opts button')].find((b) => b.textContent.includes('映画・舞台衣装')).click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.g-later')
  await page.evaluate(() => document.querySelector('.g-later').click())
  await page.evaluate(() => window.__editor.finishEditing())
  await ready()
  await page.evaluate(setupWriting)
  await pause(600)
  await ready()
  return { context, page, ready }
}

/** 上の帯のようす（ボタン・保存のようす・マーク・題名・≡ の位置と大きさ、はみ出し） */
const header = (page) =>
  page.evaluate(() => {
    const top = document.querySelector('.p-top')
    const box = (el) => {
      if (!el || !el.offsetWidth) return null
      const r = el.getBoundingClientRect()
      return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }
    }
    /** 中の文字が1行か */
    const oneLine = (el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      return new Set([...range.getClientRects()].map((q) => Math.round(q.top))).size <= 1
    }
    const chip = [...top.querySelectorAll('.chip')].find((e) => e.offsetWidth)
    const title = top.querySelector('.p-title .title')
    const tr = document.createRange()
    tr.selectNodeContents(title)
    const mark = top.querySelector('.mark')
    return {
      buttons: [...top.querySelectorAll('.p-undo button')].map((b) => ({ label: b.getAttribute('aria-label'), text: b.textContent, disabled: b.disabled, oneLine: oneLine(b.querySelector('span')), overflow: b.scrollWidth > b.clientWidth + 1, ...box(b) })),
      chip: chip ? { text: chip.textContent, shown: [...chip.childNodes].filter((n) => !(n.nodeType === 1 && n.classList.contains('sr-only'))).map((n) => n.textContent).join(''), dot: chip.querySelector('.dot')?.getBoundingClientRect().width ?? 0, cut: chip.scrollWidth > chip.clientWidth + 0.5, ...box(chip) } : null,
      titleRight: tr.getBoundingClientRect().right,
      mark: getComputedStyle(mark).display === 'none' ? null : box(mark),
      menu: box(top.querySelector('.icon-btn')),
      topH: top.getBoundingClientRect().height,
      wide: document.documentElement.scrollWidth > innerWidth + 1,
      width: innerWidth,
    }
  })

/** 上の帯の部品が、切れず・重ならず・はみ出さず、左から 題名・保存のようす・戻す・やり直す・≡ の順に並ぶか（問題の一覧） */
const layoutProblems = (h) => {
  const bad = []
  if (h.wide) bad.push('画面が横にはみ出す')
  if (!h.chip) bad.push('保存のようすがない')
  else {
    if (h.chip.cut) bad.push(`保存のようすが切れる（${h.chip.shown}）`)
    if (h.chip.dot && h.chip.dot < 6.5) bad.push('点がつぶれる')
    if (h.titleRight > h.chip.l + 0.5) bad.push('題名が保存のようすに重なる')
  }
  const [u, r] = h.buttons
  if (h.buttons.length !== 2) bad.push(`ボタンが ${h.buttons.length} 個`)
  else {
    if (h.chip && h.chip.r > u.l + 0.5) bad.push('保存のようすが「戻す」に重なる')
    if (u.r > r.l + 0.5) bad.push('「戻す」と「やり直す」が重なる')
    if (r.r > h.menu.l + 0.5) bad.push('「やり直す」が ≡ に重なる')
    for (const b of h.buttons) {
      if (b.w < 44 || b.h < 44) bad.push(`${b.label} が小さい（${b.w}×${b.h}）`)
      if (!b.oneLine || b.overflow) bad.push(`${b.label} の名前が折り返す・はみ出す`)
    }
  }
  if (!h.menu || h.menu.w < 44 || h.menu.h < 44) bad.push(`≡ が小さい（${h.menu?.w}×${h.menu?.h}）`)
  if (h.menu && h.menu.r > h.width + 0.5) bad.push('≡ が画面の外')
  for (const b of [...h.buttons, h.menu].filter(Boolean)) if (b.t < -0.5 || b.b > h.topH + 0.5) bad.push('ボタンが帯の外')
  return bad
}

/** いちばん長い短い言葉（● 保存エラー）を、少しの間だけ保存のようすに入れて測る（測ったらすぐ戻す） */
const longestFits = (page) =>
  page.evaluate(() => {
    const chip = [...document.querySelectorAll('.p-top .chip')].find((e) => e.offsetWidth)
    const dot = chip.querySelector('.dot')
    const text = [...chip.childNodes].reverse().find((n) => n.nodeType === 3 && n.nodeValue.trim())
    const sr = chip.querySelector('.sr-only')
    const saved = { cls: dot?.className, text: text?.nodeValue, sr: sr?.style.display }
    if (dot) dot.className = 'dot ng'
    if (text) text.nodeValue = '保存エラー'
    if (sr) sr.style.display = 'none'
    const u = document.querySelector('.p-top .p-undo button').getBoundingClientRect()
    const tr = document.createRange()
    tr.selectNodeContents(document.querySelector('.p-top .p-title .title'))
    const res = { cut: chip.scrollWidth > chip.clientWidth + 0.5, w: Math.round(chip.scrollWidth), dot: dot?.getBoundingClientRect().width ?? 0, overlap: chip.getBoundingClientRect().right > u.left + 0.5 || tr.getBoundingClientRect().right > chip.getBoundingClientRect().left + 0.5 }
    if (dot) dot.className = saved.cls
    if (text) text.nodeValue = saved.text
    if (sr) sr.style.display = saved.sr
    return res
  })

const state = (page) =>
  page.evaluate((id) => {
    const s = window.__editor.getSnapshot()
    const ids = s.report.body.flatMap((c) => c.blocks).map((b) => b.id)
    return { canUndo: s.canUndo, canRedo: s.canRedo, editing: s.editingId, has: ids.includes(id), toast: document.querySelector('.undo-toast')?.textContent ?? '', layout: JSON.stringify({ layout: s.report.workPhotos[0]?.layout, columns: s.report.workPhotos[0]?.columns }) }
  }, PARA)
const buttons = (page) => page.evaluate((u, r) => ({ undo: document.querySelector(u)?.disabled ?? null, redo: document.querySelector(r)?.disabled ?? null }), UNDO, REDO)

export async function undoHeaderPhone(browser, check) {
  const { context, page, ready } = await openSample(browser)
  // 保存し終えて、保存のようすが時刻になるまで待つ
  await page.waitForFunction(() => /\d{1,2}:\d{2}/.test(document.querySelector('.p-top .chip')?.textContent ?? ''), { timeout: 30000 }).catch(() => {})
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), PARA)
  await ready()
  await pause(400)

  // ---- はじめ：何も選んでいない。履歴は空なので、どちらも灰色 ----
  const h0 = await header(page)
  const b0 = await buttons(page)
  const p0 = layoutProblems(h0)
  check(
    'スマホ（v39 案A）：何も選んでいないとき、上の帯の ≡ の左に「戻す」「やり直す」（読み上げは「元に戻す」「やり直す」）。どれも 44px 四方以上（≡ も）。戻すものがないうちは、どちらも灰色',
    h0.buttons.map((b) => `${b.label}/${b.text}`).join() === '元に戻す/戻す,やり直す/やり直す' && b0.undo === true && b0.redo === true && p0.length === 0,
    JSON.stringify({ buttons: h0.buttons.map(({ label, w, h, disabled }) => ({ label, w, h, disabled })), menu: h0.menu, problems: p0 }),
  )
  // 保存のようす：時刻だけ（緑の点）。メニューの中は「自動保存 13:05」のまま
  await page.tap('.p-top .icon-btn')
  await page.waitForSelector('.sheet .meta .chip')
  const menuChip = await page.evaluate(() => document.querySelector('.sheet .meta .chip').textContent)
  await page.evaluate(() => document.querySelector('.sheet .sheet-close').click())
  await page.waitForFunction(() => !document.querySelector('.sheet'), { timeout: 10000 })
  check(
    'スマホ：上の帯の保存のようすは時刻だけ（緑の点。読み上げでは「自動保存」も）。メニューの中は「自動保存 13:05」のまま',
    /^\d{1,2}:\d{2}$/.test(h0.chip.shown) && h0.chip.text === `自動保存 ${h0.chip.shown}` && menuChip === `自動保存 ${h0.chip.shown}`,
    JSON.stringify({ header: h0.chip.shown, read: h0.chip.text, menu: menuChip }),
  )

  // ---- 書く欄を開いている間は出さない（書く欄の中の「戻す」「やり直す」を使う） ----
  const at = await page.evaluate((id) => {
    const r = document.querySelector(`.page-viewport.front [data-block-id="${id}"]`).getBoundingClientRect()
    return { x: r.left + 30, y: r.top + r.height / 2 }
  }, PARA)
  await page.touchscreen.tap(at.x, at.y)
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 20000 }, PARA)
  await pause(600)
  const inSheet = await page.evaluate(() => ({ header: document.querySelectorAll('.p-top .p-undo button').length, sheet: [...document.querySelectorAll('.edit-sheet.open .es-undo button')].map((b) => b.textContent) }))
  await page.screenshot({ path: `${OUT}/phone-390-sheet-open.png` })
  check('スマホ：書く欄を開いている間は、上の帯に「戻す」「やり直す」を出さない（書く欄の中にだけある）', inSheet.header === 0 && inSheet.sheet.join() === '戻す,やり直す', JSON.stringify(inSheet))

  // ---- 段落を削除したあと（書く欄は閉じて、何もタップしていない）：上の帯の「戻す」で戻る。「やり直す」は戻したあとだけ ----
  await page.evaluate(() => [...document.querySelectorAll('.edit-sheet .es-tools button')].find((b) => b.textContent.includes('削除')).click())
  await ready()
  await pause(400)
  const s1 = { ...(await state(page)), ...(await buttons(page)) }
  check('スマホ：段落を削除すると書く欄が閉じ、上の帯の「戻す」が押せるようになる。「やり直す」は灰色のまま', !s1.has && !s1.editing && s1.undo === false && s1.redo === true, JSON.stringify(s1))
  await page.tap(UNDO)
  const flashed = await page.waitForFunction((id) => !!document.querySelector(`.page-viewport.front [data-block-id="${id}"].undo-flash`), { timeout: 8000 }, PARA).then(() => true, () => false)
  await ready()
  await pause(300)
  const s2 = { ...(await state(page)), ...(await buttons(page)) }
  check(
    'スマホ：何もタップしていないとき、上の帯の「戻す」で削除した段落が戻り、戻した所が光る（書く欄は開かない）。戻したあとは「やり直す」が押せる',
    s2.has && !s2.editing && flashed && s2.redo === false && s2.toast.includes('戻しました'),
    JSON.stringify({ ...s2, flashed }),
  )
  await page.tap(REDO)
  await ready()
  await pause(400)
  const s3 = { ...(await state(page)), ...(await buttons(page)) }
  check('スマホ：上の帯の「やり直す」で、もう一度削除される（「段落を削除しました［戻す］」がまた出る）。やり直したあとは「やり直す」が灰色', !s3.has && s3.undo === false && s3.redo === true && s3.toast.includes('段落を削除しました'), JSON.stringify(s3))
  await page.tap(UNDO)
  await ready()
  await pause(400)

  // ---- 作品写真の並べ方を変えたあと（何もタップしていない。前は段落をタップしないと戻せなかった） ----
  await page.evaluate(() => window.__editor.goToArea('photos'))
  await ready()
  await pause(500)
  const before = (await state(page)).layout
  await page.evaluate(() => [...document.querySelectorAll('.sel-bar .lay')].find((b) => !b.classList.contains('on'))?.click())
  await ready()
  await pause(400)
  const changed = (await state(page)).layout
  await page.tap(UNDO)
  await ready()
  await pause(400)
  const reverted = await state(page)
  check('スマホ：作品写真の並べ方を変えたあと、上の帯の「戻す」で元の並べ方に戻る', changed !== before && reverted.layout === before && !reverted.editing, JSON.stringify({ before, changed, reverted: reverted.layout }))
  // 写真のため、もう一度変えて（「戻す」は押せる・「やり直す」は灰色）、本文のページへ戻る
  await page.tap(REDO)
  await ready()
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), PARA)
  await ready()
  await page.waitForFunction(() => !document.querySelector('.undo-toast'), { timeout: 20000 }).catch(() => {})
  await page.waitForFunction(() => /\d{1,2}:\d{2}/.test(document.querySelector('.p-top .chip')?.textContent ?? ''), { timeout: 30000 }).catch(() => {})
  await pause(400)

  // ---- 画面の幅ごと（390・375・360px）：切れない・重ならない・はみ出さない。360px ほどでは「卒」のマークを出さない ----
  const widths = {}
  for (const [tag, vp] of SIZES) {
    if (tag !== '390') {
      await page.setViewport(vp)
      await pause(900)
      await ready()
    }
    const h = await header(page)
    widths[tag] = { problems: layoutProblems(h), mark: !!h.mark, chip: h.chip?.shown, longest: await longestFits(page), buttons: (await buttons(page)) }
    await page.screenshot({ path: `${OUT}/phone-${tag}${tag === '390' ? '-idle' : ''}.png` })
  }
  const ok = (w) => w.problems.length === 0 && !w.longest.cut && !w.longest.overlap && w.longest.dot >= 6.5
  check(
    'スマホ：上の帯は 390・375・360px のどれでも、保存のようす（いちばん長い「● 保存エラー」でも）が切れず、部品が重ならず、画面からはみ出さない。「卒」のマークは 360px ほどでは出さない',
    ok(widths['390']) && ok(widths['375']) && ok(widths['360']) && widths['390'].mark && widths['375'].mark && !widths['360'].mark,
    JSON.stringify(widths),
  )

  // ---- 横向き：帯にゆとりがある。書く欄を開くと出さない ----
  await page.setViewport(LAND)
  await pause(1000)
  await ready()
  const land = await header(page)
  await page.screenshot({ path: `${OUT}/phone-landscape.png` })
  const at2 = await page.evaluate(() => {
    const p = [...document.querySelectorAll('.page-viewport.front [data-vivliostyle-page-container].is-current section.body p[data-block-id]')].find((e) => e.textContent.length > 20)
    const r = p.getBoundingClientRect()
    return { id: p.dataset.blockId, x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.touchscreen.tap(at2.x, at2.y)
  const opened = await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 20000 }, at2.id).then(() => true, () => false)
  await pause(600)
  const landSheet = await page.evaluate(() => document.querySelectorAll('.p-top .p-undo button').length)
  await page.screenshot({ path: `${OUT}/phone-landscape-sheet.png` })
  check('スマホの横向き：上の帯に「戻す」「やり直す」（切れない・重ならない）。書く欄を開くと出さない', layoutProblems(land).length === 0 && land.buttons.length === 2 && opened && landSheet === 0, JSON.stringify({ problems: layoutProblems(land), opened, landSheet }))
  await context.close()
}
