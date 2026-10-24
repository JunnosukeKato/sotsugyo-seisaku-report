// 見開きのページ送り：隣の組へは本のようにめくる（mockups/v50 案A。依頼者の選択 2026-10-24）。
// 次へは、右のページがとじ目を軸に立ち上がり（sp-lift）、その裏から次の組の左のページが倒れてくる（sp-drop）。前へは、左のページから、その逆。
// 続けて押すと押した数だけ送る・離れた組へはふわっと・画面の動きを減らす設定では動かさない。これだけを流すときは node scripts/e2e/run.mjs spreadTurn
import { mkdirSync } from 'node:fs'
import { withEdge } from '../poc/edge.mjs'
import { stubConfig } from './configStub.mjs'
import { setupWriting } from './sampleReport.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/spread-turn'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
}

async function open(browser) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  await page.evaluateOnNewDocument(() => { try { localStorage.setItem('sotsugyo-seisaku-report-tour', 'done'); localStorage.setItem('sotsugyo-seisaku-report-writing-zoom', '0') } catch {} })
  await stubConfig(page)
  await page.setViewport({ width: 1440, height: 900 })
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0', timeout: 90000 })
  const ready = () => page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 120000 })
  await ready()
  await page.waitForSelector('.guide.step-course .g-opts button', { timeout: 60000 })
  await page.evaluate(() => document.querySelector('.g-opts button').click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.guide.step-studentId')
  await ready()
  await page.evaluate(() => document.querySelector('.g-later').click())
  await ready()
  await page.evaluate(setupWriting)
  await wait(500)
  await ready()
  // 本文を数ページ足す（本文のページが2つ並ぶ組を、いくつか作る）
  await page.evaluate(() =>
    window.__editor.update((r) => ({
      ...r,
      body: [...r.body, { id: 'sp-c', title: '見開きの確かめ', blocks: Array.from({ length: 14 }, (_, i) => ({ type: 'paragraph', id: `sp-p${i}`, content: [{ type: 'text', text: `見開きの確かめの${i + 1}つめの段落である。`.repeat(9) }] })) }],
    })),
  )
  await wait(500)
  await ready()
  await page.evaluate(() => window.__editor.goToPage(2, 'none'))
  await ready()
  await page.evaluate(() => window.__editor.setView('spread'))
  await wait(300)
  await ready()
  return { context, page, ready }
}

/**
 * めくっている間のようすを調べる：phase のクラス（sp-lift / sp-drop）が付いたページを待ち、その番号・右のページか・軸・動きの名前を返す。
 * shot を渡すと、動きを at ミリ秒の所で止めて画面を写す（写したら動きを続ける）
 */
const during = (page, phase, at, shot) =>
  page
    .evaluate(
      async (phase, at, still) => {
        const frame = () => new Promise((r) => requestAnimationFrame(r))
        const pages = window.__editor.renderer.pageView.pages()
        let el = null
        for (let i = 0; i < 120 && !el; i++) {
          el = pages.find((p) => p.classList.contains(phase)) ?? null
          if (!el) await frame()
        }
        if (!el) return null
        const anims = document.getAnimations()
        if (still) {
          for (const a of anims) {
            a.pause()
            a.currentTime = at
          }
        }
        const cs = getComputedStyle(el)
        const shown = pages.map((p, i) => (getComputedStyle(p).display !== 'none' ? i : -1)).filter((i) => i >= 0)
        return { index: pages.indexOf(el), right: el.classList.contains('is-right'), origin: cs.transformOrigin, name: cs.animationName, backface: cs.backfaceVisibility, shown, pw: el.getBoundingClientRect().width }
      },
      phase,
      at,
      !!shot,
    )
    .then(async (r) => {
      if (shot) {
        await page.screenshot({ path: `${OUT}/${shot}.png` })
        await page.evaluate(() => document.getAnimations().forEach((a) => a.play()))
      }
      return r
    })
const info = (page) =>
  page.evaluate(() => {
    const s = window.__editor.getSnapshot()
    const pages = window.__editor.renderer.pageView.pages()
    return {
      page: s.page,
      count: s.pageCount,
      shown: pages.map((p, i) => (p.getBoundingClientRect().width > 0 ? i : -1)).filter((i) => i >= 0).join(','),
      motion: pages.filter((p) => p.matches('.sp-lift, .sp-drop, .is-under, .fade-in')).length,
    }
  })

await withEdge(async (browser) => {
  const { context, page, ready } = await open(browser)
  const start = await info(page)
  check('見開きで 3–4 ページを並べて出す（確かめの始まり）', start.page === 2 && start.shown === '2,3' && start.count >= 9, JSON.stringify(start))

  // ---- 次へ：右のページが立ち上がり、裏から次の組の左のページが倒れてくる ----
  await page.click('.arrow.next')
  const lift = await during(page, 'sp-lift', 150, '1-次へ_立ち上がる')
  const drop = await during(page, 'sp-drop', 120, '2-次へ_倒れてくる')
  await ready()
  const fwd = await info(page)
  check(
    '→で、まず右のページ（4ページ目）が、とじ目（左の端）を軸に立ち上がる。下に次の組の右のページ（6ページ目）、左は3ページ目が見えている',
    lift?.index === 3 && lift.right && lift.origin.startsWith('0px') && lift.name === 'sp-lift-right' && lift.backface === 'hidden' && JSON.stringify(lift.shown) === '[2,3,5]',
    JSON.stringify(lift),
  )
  check(
    '続けて、次の組の左のページ（5ページ目）が、とじ目（右の端）を軸に倒れてくる（立ち上がったページは隠れる）',
    drop?.index === 4 && !drop.right && !drop.origin.startsWith('0px') && drop.name === 'sp-drop-left' && JSON.stringify(drop.shown) === '[2,4,5]',
    JSON.stringify(drop),
  )
  check('めくり終えると 5–6 ページを並べ、動きの印は残らない', fwd.page === 4 && fwd.shown === '4,5' && fwd.motion === 0, JSON.stringify(fwd))

  // ---- 前へ：左のページが立ち上がり、裏から前の組の右のページが倒れてくる ----
  await page.click('.arrow.prev')
  const liftB = await during(page, 'sp-lift', 150, '3-前へ_立ち上がる')
  const dropB = await during(page, 'sp-drop', 120, '4-前へ_倒れてくる')
  await ready()
  const back = await info(page)
  check(
    '←で、左のページ（5ページ目）が右の端を軸に立ち上がり、前の組の右のページ（4ページ目）が左の端を軸に倒れてくる',
    liftB?.index === 4 && !liftB.right && liftB.name === 'sp-lift-left' && JSON.stringify(liftB.shown) === '[2,4,5]' && dropB?.index === 3 && dropB.right && dropB.name === 'sp-drop-right' && JSON.stringify(dropB.shown) === '[2,3,5]',
    JSON.stringify({ liftB, dropB }),
  )
  check('めくり終えると 3–4 ページに戻る', back.page === 2 && back.shown === '2,3' && back.motion === 0, JSON.stringify(back))

  // ---- 続けて3回押すと、押した数だけ送る（めくっている途中の動きは、すぐ終える） ----
  for (let i = 0; i < 3; i++) {
    await page.click('.arrow.next')
    await wait(80)
  }
  await ready()
  const many = await info(page)
  check('→を続けて3回押すと、3組先（9–10 ページ）まで送る', many.page === 8 && many.shown.startsWith('8') && many.motion === 0, JSON.stringify(many))

  // ---- 離れた組へは、めくらずに、ふわっと出す ----
  const far = await page.evaluate(async () => {
    const ed = window.__editor
    const turning = ed.goToPage(2)
    await new Promise((r) => requestAnimationFrame(r))
    const pages = ed.renderer.pageView.pages()
    const r = { fade: pages.filter((p) => p.classList.contains('fade-in')).map((p) => pages.indexOf(p)), flip: pages.filter((p) => p.matches('.sp-lift, .sp-drop')).length }
    await turning
    return r
  })
  await ready()
  check('離れた組（9–10 → 3–4）へは、めくらずに、並べた2ページをふわっと出す', JSON.stringify(far.fade) === '[2,3]' && far.flip === 0, JSON.stringify(far))

  // ---- 画面の動きを減らす設定では、めくらずにすぐ替える ----
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  const reduced = await page.evaluate(async () => {
    const ed = window.__editor
    const turning = ed.goToPage(4)
    await new Promise((r) => requestAnimationFrame(r))
    const flip = ed.renderer.pageView.pages().filter((p) => p.matches('.sp-lift, .sp-drop')).length
    await turning
    return { flip, page: ed.getSnapshot().page }
  })
  await page.emulateMediaFeatures([])
  check('画面の動きを減らす設定では、めくらずにすぐ替える', reduced.flip === 0 && reduced.page === 4, JSON.stringify(reduced))

  // ---- 1ページの表示のめくる動きは、今までどおり ----
  await page.evaluate(() => window.__editor.setView('fit'))
  await wait(300)
  await ready()
  await page.click('.arrow.next')
  const single = await page.evaluate(async () => {
    const pages = window.__editor.renderer.pageView.pages()
    for (let i = 0; i < 60; i++) {
      const el = pages.find((p) => p.matches('.turn-out, .sp-lift'))
      if (el) return { cls: el.classList.contains('turn-out') ? 'turn-out' : 'sp-lift', name: getComputedStyle(el).animationName }
      await new Promise((r) => requestAnimationFrame(r))
    }
    return null
  })
  await ready()
  check('1ページの表示では、今までどおり1ページずつめくる（turn-out）', single?.cls === 'turn-out' && single.name === 'turn-out', JSON.stringify(single))
  await context.close()
})
console.log(`${results.filter(Boolean).length}/${results.length} 件 合格`)
if (!results.every(Boolean)) process.exitCode = 1
