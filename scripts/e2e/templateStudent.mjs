// 先生がひな形を作る画面（mockups/v44 案A）で入れた改ページと、ふつうの表（見出しの行）が、学生の新しい原稿に出るかを確かめる（smoke.mjs から呼ぶ）。
// 映画・舞台衣装デザイナー コースのひな形の「制作過程」の説明の後ろに、改ページと表（部位・寸法・メモ、中身2行）を入れた設定で、学生がコースを選んで始める。
// 画面の写真は poc-output/template-mode/ に置く
import { mkdirSync, readFileSync } from 'node:fs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/template-mode'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 自動テストの設定（config-fixture.json）の衣装コースに、2026年度の初期値のひな形と、表・改ページを入れる */
function configWithTemplate() {
  const config = JSON.parse(readFileSync(new URL('./config-fixture.json', import.meta.url), 'utf8'))
  const base = JSON.parse(readFileSync(new URL('../../src/config/2026.json', import.meta.url), 'utf8'))
  const film = base.courses.find((c) => c.id === 'film-stage-costume')
  const template = []
  for (const block of film.template) {
    if (block.type === 'chapter' && block.title === 'まとめ') template.push({ type: 'pageBreak' }, { type: 'table', caption: '寸法表', header: ['部位', '寸法', 'メモ'], rows: 2 })
    template.push(block)
  }
  for (const c of config.courses) delete c.notice
  Object.assign(config.courses.find((c) => c.id === 'film-stage-costume'), { template, abstractExample: film.abstractExample })
  return config
}

/** ページの中で：開発サーバーの即時反映を止め、設定の窓口を決まった設定にする。指差し確認は見たことにする */
function hook(config) {
  const Real = window.WebSocket
  window.WebSocket = function (url, protocols) {
    if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
    return new Real(url, protocols)
  }
  const realFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (/script\.google(usercontent)?\.com/.test(url)) return Promise.resolve(new Response(JSON.stringify({ ok: true, year: config.fiscalYear, config }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    return realFetch(input, init)
  }
  try {
    localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
  } catch {}
}

export async function templateStudentPc(browser, check) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror(template-student):', e.message))
  page.on('dialog', (d) => d.dismiss())
  await page.evaluateOnNewDocument(hook, configWithTemplate())
  await page.setViewport({ width: 1366, height: 768 })
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0', timeout: 90000 })
  const ready = () => page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 60000 })
  await ready()
  // はじめての案内で、衣装コースを選ぶ（本文は、そのコースのひな形から作る）→ Word では書いていない → あとで
  await page.waitForSelector('.guide.step-course .g-opts button')
  await page.evaluate(() => [...document.querySelectorAll('.guide .g-opts button')].find((b) => b.textContent.includes('映画・舞台衣装')).click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.g-later')
  await page.evaluate(() => document.querySelector('.g-later').click())
  await page.evaluate(() => window.__editor.finishEditing())
  await ready()
  await sleep(500)

  const made = await page.evaluate(() => {
    const ed = window.__editor
    const body = ed.getSnapshot().report.body
    const blocks = body.flatMap((c) => c.blocks)
    const table = blocks.find((b) => b.type === 'table' && b.caption === '寸法表')
    const brk = blocks.find((b) => b.type === 'pageBreak')
    const last = body.find((c) => c.title === 'まとめ')
    return {
      header: table?.rows[0].cells.map((c) => c.text).join('・') ?? '',
      rows: table ? table.rows.slice(1).map((r) => r.cells.map((c) => c.text).join('')).join('|') : '',
      breakId: brk?.id ?? null,
      tablePage: table ? ed.pageOfBlock(table.id) : -1,
      breakPage: brk ? ed.pageOfBlock(brk.id) : -1,
      lastPage: last ? ed.pageOfBlock(last.id) : -1,
      tableId: table?.id ?? null,
    }
  })
  check(
    '学生の新しい原稿に、ひな形の表（見出しの行と、空の中身2行）と改ページが入る',
    made.header === '部位・寸法・メモ' && made.rows === '|' && !!made.breakId,
    JSON.stringify(made),
  )
  // 改ページのあるページと、表のあるページを、見開きで並べて見る
  await page.evaluate((id) => {
    window.__editor.setView('spread')
    return window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none')
  }, made.breakId)
  await ready()
  await sleep(600)
  await page.screenshot({ path: `${OUT}/5-student-new-report.png`, captureBeyondViewport: false })
  // 表のあるページを拡大して見る
  await page.evaluate((id) => {
    window.__editor.setView('zoom')
    return window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none')
  }, made.tableId)
  await ready()
  await sleep(600)
  const paper = await page.evaluate(() => {
    const cur = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current')
    const brk = document.querySelector('.page-viewport.front .page-break')
    return {
      th: [...cur.querySelectorAll('.data-table th')].map((t) => t.textContent).join('・'),
      td: cur.querySelectorAll('.data-table tbody td').length,
      brk: !!brk,
      mark: brk ? getComputedStyle(brk, '::after').content : '',
      caption: cur.querySelector('.data-table .table-caption')?.textContent ?? '',
    }
  })
  await page.screenshot({ path: `${OUT}/5b-student-table-page.png`, captureBeyondViewport: false })
  check(
    '学生の紙面に、改ページの印が出て、表（見出し「部位・寸法・メモ」と空の2行）は次のページから始まる',
    paper.th === '部位・寸法・メモ' && paper.td === 6 && paper.caption.includes('寸法表') && paper.brk && paper.mark.includes('改ページ') && made.tablePage === made.breakPage + 1 && made.lastPage === made.tablePage + 1,
    JSON.stringify({ ...paper, tablePage: made.tablePage, breakPage: made.breakPage, lastPage: made.lastPage }),
  )
  // ひな形のままの原稿は、書き始めていない（コースを変えても確かめずに入れ替わる）
  check('ひな形のままの原稿は「書き始めていない」とみなす（表・改ページが入っていても）', !(await page.evaluate(() => window.__editor.bodyWritten())))
  await context.close()
}
