// はじめて使う先生の試しで見つかったことの直しを確かめる（Edge を自動で操作する。smoke.mjs から呼ぶ）。画面の写真は poc-output/student-fixes/ に置く。
// - 先生が決めた書き間違えやすい語のうち、エラーの語は「このままにする（確認済み）」にできない（前に確認済みにしていても隠れず、PDF の窓の「直すところ」に出る）。
//   注意の語は、今までどおり「このままにする」にできる
// - はじめての案内の途中（「Word で書き始めていますか？」・学籍番号など）で読み込み直すと、案内の続きが出る（指差し確認ではなく）。
//   「あとで入力する」で閉じたら、読み込み直しても出ない
import { mkdirSync } from 'node:fs'
import { stubConfig } from './configStub.mjs'
import { setupWriting } from './sampleReport.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/student-fixes'
mkdirSync(OUT, { recursive: true })
const pause = (ms = 400) => new Promise((r) => setTimeout(r, ms))
const GUIDE_KEY = 'sotsugyo-seisaku-report-guide'

/** 確かめている途中に src/ が直されても、画面が入れ替わらないようにする（smoke.mjs と同じ） */
const noHotReload = (page) =>
  page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
  })

/** まっさらな入れ物で、パソコンの大きさで開く（指差し確認は見たことにする） */
async function openPage(browser) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await noHotReload(page)
  await stubConfig(page)
  page.on('pageerror', (e) => console.log('pageerror(teacher-trial):', e.message))
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  })
  await page.setViewport({ width: 1440, height: 900 })
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0', timeout: 90000 })
  const ready = () =>
    page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 60000 })
  await ready()
  return { context, page, ready }
}

/** 読み込み直して、紙面ができるまで待つ */
async function reload(page, ready) {
  await page.reload({ waitUntil: 'networkidle0', timeout: 90000 })
  await ready()
  await pause(1200)
}

/** 書き間違えやすい語のエラーは「このままにする」にできない（mockups/v22 ① 案A の例外） */
async function wordErrorCheck(browser, check) {
  const { context, page, ready } = await openPage(browser)
  await page.waitForSelector('.guide.step-course .g-opts button')
  await page.evaluate(() => document.querySelector('.g-opts button').click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.g-later')
  await page.evaluate(() => document.querySelector('.g-later').click())
  await page.evaluate(() => window.__editor.finishEditing())
  await ready()
  // 見本の原稿（指摘は0件）に、「見頃」（エラーの語）と「記事」（注意の語）を書く
  await page.evaluate(setupWriting)
  await page.evaluate(() =>
    window.__editor.update((r) => ({
      ...r,
      basicInfo: { ...r.basicInfo, studentId: '00ZZ0123' },
      body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === 'p7' ? { ...b, content: [{ type: 'text', text: '二回目の仮縫いでは、見頃の記事の重さを確かめた。' }] } : b)) })),
    })),
  )
  await pause(800)
  await ready()
  const rows = () =>
    page.evaluate(() => {
      const find = (word) => [...document.querySelectorAll('.side .issue')].find((li) => li.textContent.includes(`「${word}」ではなく`))
      const info = (li) => (li ? { error: li.classList.contains('error'), keep: !!li.querySelector('.keep'), fix: !!li.querySelector('.fix'), detail: li.querySelector('.detail')?.textContent ?? '' } : null)
      return { mikoro: info(find('見頃')), kiji: info(find('記事')), acked: document.querySelector('.side details.acked summary')?.textContent ?? '' }
    })
  const before = await rows()
  await page.screenshot({ path: `${OUT}/word-error-no-keep.png` })
  check(
    '書き間違えやすい語のエラー（見頃）には「このままにする」が出ず、直し方（「見頃」→「身頃」）を書く。注意の語（記事）には「このままにする」が出る',
    before.mikoro?.error && !before.mikoro.keep && !before.mikoro.fix && before.mikoro.detail.startsWith('「見頃」→「身頃」') && before.kiji && !before.kiji.error && before.kiji.keep,
    JSON.stringify(before),
  )
  // 注意の語は「このままにする」で確認済みにできる
  await page.evaluate(() => [...document.querySelectorAll('.side .issue')].find((li) => li.textContent.includes('「記事」ではなく')).querySelector('.keep').click())
  await pause(300)
  await ready()
  // 前の版で「確認済み」にした目印（エラーの語）が原稿に残っていても、隠れない
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, acknowledged: [...(r.acknowledged ?? []), 'word-見頃|p7|見頃'] })))
  await pause(500)
  await ready()
  const after = await rows()
  const snap = await page.evaluate(() => {
    const s = window.__editor.getSnapshot()
    return { errors: s.findings.filter((f) => f.severity === 'error').map((f) => f.ruleId), acked: s.acknowledged.map((f) => f.ruleId) }
  })
  check(
    '注意の語は確認済みにでき、前に確認済みにしたエラーの語（見頃）は隠れずにエラーのまま数える',
    !after.kiji && after.mikoro?.error && !after.mikoro.keep && snap.errors.includes('word-見頃') && snap.acked.join(',') === 'word-記事' && after.acked.includes('確認済み 1件'),
    JSON.stringify({ after, snap }),
  )
  // 「PDFを書き出す」：エラーの語が残っているので、窓の「直すところ」の一覧に「見頃」が出る（提出の前に直す。そのまま書き出すこともできる）
  await page.click('.side .export')
  await page.waitForSelector('.modal .pdf-left')
  const dialog = await page.evaluate(() => ({ title: document.querySelector('.modal h2')?.textContent ?? '', list: [...document.querySelectorAll('.modal .fix-list li')].map((li) => li.textContent), anyway: document.querySelector('.modal .pdf-anyway')?.textContent ?? '' }))
  await page.screenshot({ path: `${OUT}/word-error-export.png` })
  check(
    'エラーの語が残っていると、PDF の窓の「直すところ」の一覧に「見頃」が出て、提出の前に直すよう伝える',
    dialog.title === 'PDFを書き出す' && dialog.list.some((t) => t.includes('「見頃」ではなく「身頃」と書く')) && dialog.anyway.startsWith('提出の前に直しましょう'),
    JSON.stringify(dialog),
  )
  await page.evaluate(() => document.querySelector('.modal .close')?.click())
  await context.close()
}

/** はじめての案内の途中で読み込み直すと、案内の続きが出る */
async function guideResumeCheck(browser, check) {
  const { context, page, ready } = await openPage(browser)
  await page.waitForSelector('.guide.step-course .g-opts button')
  await page.evaluate(() => document.querySelector('.g-opts button').click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  // 「Word で書き始めていますか？」のところで読み込み直す
  await reload(page, ready)
  const atWord = await page.waitForSelector('.guide.step-word .g-word-opt.no', { timeout: 15000 }).then(() => true, () => false)
  await page.screenshot({ path: `${OUT}/guide-resume-word.png` })
  check(
    'はじめての案内の「Word で書き始めていますか？」で読み込み直すと、同じ案内に戻る（指差し確認は出ない）',
    atWord && !(await page.$('.tour')) && (await page.evaluate((k) => localStorage.getItem(k), GUIDE_KEY)) === 'word',
  )
  // 「いいえ」→ 学籍番号の案内。何も入れずに読み込み直すと、学籍番号の案内から続く
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'basic:studentId', { timeout: 30000 })
  await reload(page, ready)
  const atId = await page.waitForSelector('.guide.step-studentId', { timeout: 15000 }).then(() => true, () => false)
  check('学籍番号の案内の途中で読み込み直すと、学籍番号の案内から続く', atId && !(await page.$('.tour')), String(atId))
  // 学籍番号を入れて氏名へ。氏名の案内で読み込み直すと、空いている最初の項目（氏名）から続く
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'basic:studentId', { timeout: 30000 })
  await page.keyboard.type('00ZZ0123')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'basic:name', { timeout: 30000 })
  await reload(page, ready)
  const atName = await page.waitForSelector('.guide.step-name', { timeout: 15000 }).then(() => true, () => false)
  await page.screenshot({ path: `${OUT}/guide-resume-name.png` })
  check('氏名の案内の途中で読み込み直すと、氏名の案内から続く（学籍番号は入ったまま）', atName && (await page.evaluate(() => window.__editor.getSnapshot().report.basicInfo.studentId)) === '00ZZ0123', String(atName))
  // 「あとで入力する」で閉じたら、読み込み直しても出ない（覚えた段階も消える）
  await page.evaluate(() => document.querySelector('.guide .g-later').click())
  await pause(300)
  check('「あとで入力する」で閉じると、覚えていた案内の段階を消す', (await page.evaluate((k) => localStorage.getItem(k), GUIDE_KEY)) === null)
  await reload(page, ready)
  check('閉じた案内は、読み込み直しても出ない', !(await page.$('.guide')) && !(await page.$('.tour')))
  await context.close()
}

export async function teacherTrialPc(browser, check) {
  await wordErrorCheck(browser, check)
  await guideResumeCheck(browser, check)
}
