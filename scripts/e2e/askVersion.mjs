// 学生の試し（iPhone の Chrome）のあとの直し（依頼者の選択 2026-10-23）。パソコンとスマホ。
// - 確認の窓・知らせの窓を画面の中に出す（src/app/ask.tsx。前はブラウザの confirm・alert で、iPhone の Chrome で「読み込む前の原稿に戻す」を押しても何も起きなかった）
// - 新しい版が公開されたら、画面の上に「新しい版があります［新しくする］」（src/app/newVersion.tsx。version.json の印が、いまの版と違うとき）。
//   「新しくする」で、書いたものを保存してから読み込み直す。メニューにも「ページを読み込み直す」
// - 段落の書き出しに空白を打っても入れない（1字下げは自動。前は書いている間、2字分空いて見えた。依頼者の指摘 2026-10-24）
// これだけを流すときは node scripts/e2e/run.mjs askVersion
import { mkdirSync } from 'node:fs'
import { withEdge } from '../poc/edge.mjs'
import { stubConfig } from './configStub.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/ask-version'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
}

/** version.json を、いまの版と違う印にして返す（新しい版が公開されたことにする。設定の差し替え（configStub.mjs）と重ならないよう、ページの fetch で） */
async function newerVersion(page) {
  await page.evaluateOnNewDocument(() => {
    const real = window.fetch.bind(window)
    window.fetch = (input, init) =>
      /version.json/.test(String(input)) ? Promise.resolve(new Response(JSON.stringify({ id: 'newer-build' }), { status: 200, headers: { 'Content-Type': 'application/json' } })) : real(input, init)
  })
}

async function open(browser, { phone = false, newer = false } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror(askVersion):', e.message))
  // ブラウザの確認（confirm）が出たら、それは前のやり方のまま（出てはいけない）
  const native = []
  page.on('dialog', (d) => {
    native.push(d.message())
    void d.dismiss()
  })
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  })
  await stubConfig(page)
  if (newer) await newerVersion(page)
  if (phone) {
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1')
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  } else await page.setViewport({ width: 1440, height: 900 })
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
  return { context, page, ready, native }
}

/** 確認の窓のようす */
const modal = (page) =>
  page.evaluate(() => {
    const m = document.querySelector('.confirm-modal')
    if (!m) return null
    return { title: m.querySelector('h2')?.textContent ?? '', buttons: [...m.querySelectorAll('.row-buttons button')].map((b) => b.textContent.trim()), focus: document.activeElement?.textContent?.trim() ?? '' }
  })

await withEdge(async (browser) => {
  // ---- パソコン：確認の窓（「最初から作り直す」）を画面の中に出す。「やめる」で何も変わらない ----
  {
    const { context, page, ready, native } = await open(browser)
    await page.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, name: '文化　花子' } })))
    await ready()
    await page.evaluate(() => document.querySelector('.side .menu-btn').click())
    await page.waitForSelector('.head-menu')
    const menu = await page.evaluate(() => [...document.querySelectorAll('.head-menu [role="menuitem"]')].map((b) => b.textContent.trim()))
    check('パソコン：メニューに「ページを読み込み直す」', menu.includes('ページを読み込み直す'), JSON.stringify(menu))
    await page.evaluate(() => [...document.querySelectorAll('.head-menu [role="menuitem"]')].find((b) => b.textContent.includes('バックアップ')).click())
    await page.waitForSelector('.modal')
    await page.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.includes('最初から作り直す')).click())
    await page.waitForSelector('.confirm-modal')
    const asked = await modal(page)
    await page.screenshot({ path: `${OUT}/pc-1-confirm.png` })
    check(
      '「最初から作り直す」の確かめは、画面の中の窓（題「…最初から作り直しますか？」・「やめる」「作り直す」。はじめは「やめる」）。ブラウザの確認は出ない',
      asked?.title.endsWith('最初から作り直しますか？') && JSON.stringify(asked.buttons) === JSON.stringify(['やめる', '作り直す']) && asked.focus === 'やめる' && native.length === 0,
      JSON.stringify({ asked, native }),
    )
    await page.evaluate(() => document.querySelector('.confirm-modal [data-confirm="cancel"]').click())
    await wait(300)
    const kept = await page.evaluate(() => ({ modal: !!document.querySelector('.confirm-modal'), name: window.__editor.getSnapshot().report.basicInfo.name }))
    check('「やめる」で窓が閉じ、原稿はそのまま', !kept.modal && kept.name === '文化　花子', JSON.stringify(kept))
    await context.close()
  }

  // ---- スマホ：新しい版の知らせ。「新しくする」で、書いた字を保存してから読み込み直す ----
  {
    const { context, page, ready } = await open(browser, { phone: true, newer: true })
    await page.waitForSelector('.new-version', { timeout: 15000 })
    const band = await page.evaluate(() => {
      const b = document.querySelector('.new-version')
      const r = b.getBoundingClientRect()
      const top = document.querySelector('.p-top').getBoundingClientRect()
      return { text: b.textContent, inside: r.left >= 0 && r.right <= innerWidth, belowTop: r.top >= top.bottom - 1 }
    })
    await page.screenshot({ path: `${OUT}/phone-1-new-version.png` })
    check('スマホ：新しい版が公開されていたら、上の帯の下に「新しい版があります［新しくする］」（画面に入る）', band.text.includes('新しい版があります') && band.text.includes('新しくする') && band.inside && band.belowTop, JSON.stringify(band))
    // メニューにも「ページを読み込み直す」
    await page.tap('.p-top .icon-btn')
    await page.waitForSelector('.sheet .reload-link')
    check('スマホ：メニューに「ページを読み込み直す」', true)
    await page.tap('.sheet .sheet-close')
    await wait(300)
    // 書いた字（まだ保存の待ち時間の中）を、新しくしても失わない
    await page.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, name: '新しく　する' } })))
    const nav = page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 })
    await page.tap('.new-version .nv-reload')
    await nav
    await ready()
    const after = await page.evaluate(() => window.__editor.getSnapshot().report.basicInfo.name)
    check('「新しくする」で、保存してから読み込み直す（書いた字は残る）', after === '新しく　する', after)
    // × で閉じると、この画面では出さない
    await page.waitForSelector('.new-version', { timeout: 15000 })
    await page.tap('.new-version .nv-close')
    await wait(300)
    check('× で閉じると、知らせは消える', !(await page.$('.new-version')))
    await context.close()
  }

  // ---- 段落の書き出しに空白を打っても入れない（パソコン・スマホ） ----
  for (const phone of [false, true]) {
    const { context, page, ready } = await open(browser, { phone })
    const who = phone ? 'スマホ' : 'パソコン'
    // 本文の最初の段落を開き、書き出しにカーソルを置く
    const id = await page.evaluate(() => window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.type === 'paragraph')?.id)
    await page.evaluate((id) => window.__editor.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === id ? { ...b, content: [{ type: 'text', text: 'デザインを考えた。' }] } : b)) })) })), id)
    await ready()
    await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), id)
    await ready()
    await page.evaluate((id) => window.__editor.openEditor(id, 0), id)
    await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 10000 }, id)
    await wait(300)
    await page.evaluate(() => window.__editor.overlay.setCaret(0))
    await page.keyboard.type('\u3000')
    await wait(150)
    await page.keyboard.type(' ')
    await wait(300)
    const typed = await page.evaluate(() => ({ text: window.__editor.overlay.text, caret: window.__editor.overlay.caret, notice: document.querySelector('.undo-area')?.textContent ?? '' }))
    check(
      `${who}：段落の書き出しに全角・半角の空白を打っても入らず（カーソルも書き出しのまま）、「1字下げは自動で入ります」と知らせる`,
      typed.text === 'デザインを考えた。' && typed.caret === 0 && typed.notice.includes('1字下げは自動で入ります'),
      JSON.stringify(typed),
    )
    // 文の途中の空白は、今までどおり入る
    await page.evaluate(() => window.__editor.overlay.setCaret(5))
    await page.keyboard.type('\u3000')
    await wait(300)
    const middle = await page.evaluate(() => window.__editor.overlay.text)
    check(`${who}：文の途中の空白は、今までどおり入る`, middle === 'デザインを\u3000考えた。', middle)
    await context.close()
  }

  // ---- 新しい版でなければ、知らせは出ない ----
  {
    const { context, page } = await open(browser)
    await wait(1500)
    check('いまの版が公開中の版と同じなら、知らせは出ない', !(await page.$('.new-version')))
    await context.close()
  }
})
console.log(`${results.filter(Boolean).length}/${results.length} 件 合格`)
if (!results.every(Boolean)) process.exitCode = 1
