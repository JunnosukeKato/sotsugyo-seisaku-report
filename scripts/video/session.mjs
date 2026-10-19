// 使い方の動画：学生用ツールを開くところまでの共通の手順（録画の前の準備）。
// Google のログインとドライブは偽物（scripts/e2e/fakeGoogle.mjs）に差し替える。本物の Google にはつながない。
// 見本の原稿は、衣装コースの架空の学生（文化花子・00ZZ0123）。見本の画像は docs/guide-images/sample/ のもの（読むだけ）
import { readFileSync } from 'node:fs'
import { sleep } from './recorder.mjs'

const { fakeDrive, routeGoogle } = await import('../e2e/fakeGoogle.mjs')
const { setupWriting } = await import('../e2e/sampleReport.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const config = JSON.parse(readFileSync('scripts/e2e/config-fixture.json', 'utf8'))
for (const c of config.courses) delete c.notice

/** 録る画面：パソコンは 1280×720、スマホは 390×844（どちらも2倍の細かさで撮る） */
export const VIEWPORTS = {
  pc: { width: 1280, height: 720, deviceScaleFactor: 2 },
  phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
}

export const ready = (page) =>
  page.waitForFunction(() => {
    const s = window.__editor?.getSnapshot()
    return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading')
  }, { timeout: 120000 })

/** 現在の紙面のページの、ブロックの範囲（CSS px。いくつかに分かれていれば、それらを囲む範囲） */
export const blockRect = (page, id) =>
  page.evaluate((id) => {
    const els = [...document.querySelectorAll(`.page-viewport.front [data-vivliostyle-page-container].is-current [data-block-id="${id}"]`)]
    if (!els.length) return null
    const rs = els.map((e) => e.getBoundingClientRect())
    const x = Math.min(...rs.map((r) => r.left))
    const y = Math.min(...rs.map((r) => r.top))
    return { x, y, w: Math.max(...rs.map((r) => r.right)) - x, h: Math.max(...rs.map((r) => r.bottom)) - y }
  }, id)

/** 段落の最後の字のあたり（クリックで、段落の終わりから書ける位置） */
export const endOfBlock = (page, id) =>
  page.evaluate((id) => {
    const els = [...document.querySelectorAll(`.page-viewport.front [data-vivliostyle-page-container].is-current [data-block-id="${id}"]`)]
    const last = els.flatMap((e) => [...e.getClientRects()]).at(-1)
    return last ? { x: last.right - 4, y: last.top + last.height / 2 } : null
  }, id)

/** 現在の紙面のページで、ブロックの中の文字（はじめに見つかったもの）の範囲（CSS px）。クリックで、その文字の後ろから書くのに使う */
export const textRect = (page, id, text) =>
  page.evaluate(
    (id, text) => {
      const els = [...document.querySelectorAll(`.page-viewport.front [data-vivliostyle-page-container].is-current [data-block-id="${id}"]`)]
      for (const el of els) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const at = node.textContent.indexOf(text)
          if (at < 0) continue
          const range = document.createRange()
          range.setStart(node, at)
          range.setEnd(node, at + text.length)
          const r = range.getBoundingClientRect()
          return { x: r.left, y: r.top, w: r.width, h: r.height }
        }
      }
      return null
    },
    id,
    text,
  )

/** 要素の範囲（CSS px。text があれば、その文字を含むもの）。なければ null */
export const rectOf = (page, selector, text) =>
  page.evaluate(
    (selector, text) => {
      const el = [...document.querySelectorAll(selector)].find((e) => e.getBoundingClientRect().width > 0 && (!text || e.textContent.includes(text)))
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, w: r.width, h: r.height }
    },
    selector,
    text,
  )

/** 範囲をまとめる（いくつかの範囲を囲む範囲） */
export const union = (...rs) => {
  const list = rs.filter(Boolean)
  const x = Math.min(...list.map((r) => r.x))
  const y = Math.min(...list.map((r) => r.y))
  return { x, y, w: Math.max(...list.map((r) => r.x + r.w)) - x, h: Math.max(...list.map((r) => r.y + r.h)) - y }
}

export const goToBlock = async (page, id) => {
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), id)
  await sleep(400)
  await ready(page)
}

/** 段落の文を書き換える（録画の前の準備に使う。画面の操作ではない） */
export const setParagraph = (page, id, text) =>
  page.evaluate(
    (id, text) => window.__editor.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === id ? { ...b, content: [{ type: 'text', text }] } : b)) })) })),
    id,
    text,
  )

/**
 * 学生用ツールを開く。device：'pc' | 'phone'。
 * login：false ならログインの窓のまま返す。guide：false なら、はじめての案内は出たまま返す（コースから録るとき）。
 * sample：見本の原稿にする。tour：指差し確認を、まだ見ていないことにする
 */
export async function openTool(browser, { device = 'pc', login = true, guide = false, sample = true, tour = false } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  page.on('dialog', (d) => d.accept())
  // 保存される PDF は、どこにも置かない（動画には要らない）
  await (await page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'deny', browserContextId: context.id })
  await page.evaluateOnNewDocument((tour) => {
    // 録画のあいだに src/ が直されても、画面が入れ替わらないようにする（開発サーバーの即時反映をつながない）
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
    try {
      if (!tour) localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  }, tour)
  if (device === 'phone') await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
  await page.setViewport(VIEWPORTS[device])
  await routeGoogle(page, fakeDrive('00zz0123@bunka-wu.ac.jp'), config)
  await page.goto(`${APP}/`, { waitUntil: 'networkidle0', timeout: 90000 })
  // 別のタブの知らせ（録画には出さない）
  await page.addStyleTag({ content: '.login-over.tab-locked { display: none !important; }' })
  await ready(page)
  if (!login) return { context, page }
  await page.waitForSelector('.login-over .login-btn')
  await page.click('.login-btn')
  await page.waitForFunction(() => !document.querySelector('.login-over'), { timeout: 60000 })
  if (guide) return { context, page }
  await page.waitForSelector('.guide.step-course .g-opts button')
  await page.evaluate(() => [...document.querySelectorAll('.guide .g-opts button')].find((b) => b.textContent.includes('映画・舞台衣装')).click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.guide .g-later')
  await page.evaluate(() => document.querySelector('.guide .g-later').click())
  await page.evaluate(() => window.__editor.finishEditing())
  await ready(page)
  if (sample) {
    await page.evaluate(setupWriting)
    await sleep(800)
    await ready(page)
  }
  return { context, page }
}
