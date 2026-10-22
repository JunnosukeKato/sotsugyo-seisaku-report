// お試し（管理ページの「学生の画面を試す」。依頼者の選択 2026-10-22 案1）を確かめる（試験用サーバーで。単独でも、admin.mjs からも動かせる）。
// - 先生の管理ページの「学生の画面を試す」→「見本の原稿で開く」で、学生のツールが ?trial=1 で別のタブに開き、見本の原稿と写真が入っている
// - 上の帯（お試し中・どこにも届かない・「見本に戻す」）。試した内容は、読み込み直しても残り、「見本に戻す」で最初の見本に戻る
// - お試しは、学生の原稿（この端末のふだんの入れ物）に触れず、別のタブのふだんのツールとも、書けるタブを取り合わない
// - お試しのタブから、開発サーバーのほか（Google のログイン・ドライブ・Apps Script など）にはつながない
// - 管理ページから開いていない（このブラウザに見本がない）ときは、管理ページから開くよう知らせる。置いてあれば、そのまま開く
// 画面の写真は poc-output/trial-mode/ に置く
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { withEdge } from '../poc/edge.mjs'
import { stubConfig } from './configStub.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/trial-mode'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 紙面が落ち着くまで待つ */
const ready = (p) => p.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 120000 })
/** 画面の更新を止める（確かめている途中に src/ が直されても、画面が入れ替わらないように。smoke.mjs と同じ） */
const noHmr = (p) =>
  p.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
  })
/** その名前の IndexedDB の、原稿（current）の氏名（なければ null） */
const savedName = (p, db) =>
  p.evaluate(
    (db) =>
      new Promise((resolve) => {
        const req = indexedDB.open(db)
        req.onsuccess = () => {
          const d = req.result
          if (!d.objectStoreNames.contains('report')) return resolve(null)
          const get = d.transaction('report').objectStore('report').get('current')
          get.onsuccess = () => resolve(get.result?.basicInfo?.name ?? null)
          get.onerror = () => resolve(null)
        }
        req.onerror = () => resolve(null)
      }),
    db,
  )
/** このページが、開発サーバーのほかに読みに行った所 */
const outsideRequests = (p) => p.evaluate((origin) => performance.getEntriesByType('resource').map((e) => e.name).filter((u) => !u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')), new URL(APP).origin)

export async function trialModeAdmin(browser, check) {
  const context = await browser.createBrowserContext()
  // ふだんのツールで、学生の原稿をこの端末に置いておく（お試しと混ざらないことを確かめるため）
  const student = await context.newPage()
  await noHmr(student)
  // 学科の設定は、配信の窓口を呼ばずに決まった設定で（configStub.mjs）
  await stubConfig(student)
  student.on('dialog', (d) => d.accept())
  await student.setViewport({ width: 1366, height: 768 })
  await student.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0' })
  await ready(student)
  await student.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, name: '本物の学生' } })))
  await sleep(1500)
  check('（準備）ふだんのツールの原稿が、この端末に保存された', (await savedName(student, 'sotsugyo-seisaku-report')) === '本物の学生')

  // 先生の管理ページ：「学生の画面を試す」
  const admin = await context.newPage()
  await noHmr(admin)
  await admin.setViewport({ width: 1366, height: 768 })
  await admin.goto(`${APP}/admin.html?as=teacher`, { waitUntil: 'networkidle0' })
  await admin.waitForSelector('.admin .content')
  await admin.evaluate(() => [...document.querySelectorAll('.side-nav button')].find((b) => b.textContent.includes('学生の画面を試す')).click())
  await admin.waitForSelector('.trial-sec .trial-open .btn')
  await admin.waitForFunction(() => !document.querySelector('.trial-open .btn').disabled)
  const sec = await admin.evaluate(() => ({ head: document.querySelector('.content .sec-h')?.textContent, points: document.querySelectorAll('.trial-points li').length, button: document.querySelector('.trial-open .btn').textContent }))
  check('先生の管理ページに「学生の画面を試す」（説明3つと「見本の原稿で開く」）', sec.head === '学生の画面を試す' && sec.points === 3 && sec.button === '見本の原稿で開く', JSON.stringify(sec))
  await admin.screenshot({ path: `${OUT}/1-admin-teacher.png` })

  // 押すと、別のタブで ?trial=1 が開く
  const opened = browser.waitForTarget((t) => t.url().includes('trial=1'), { timeout: 20000 })
  await admin.click('.trial-open .btn')
  const trial = await (await opened).page()
  trial.on('pageerror', (e) => console.log('pageerror(trial):', e.message))
  const dialogs = []
  trial.on('dialog', (d) => {
    dialogs.push(d.message())
    d.accept()
  })
  await trial.setViewport({ width: 1366, height: 768 })
  await ready(trial)
  await admin.waitForFunction(() => document.querySelector('.trial-state')?.textContent === '別のタブで開きました', { timeout: 30000 })
  check('管理ページに「別のタブで開きました」', true)
  const view = await trial.evaluate(async () => {
    const { allImages } = await window.__import('model/storage.ts')
    const r = window.__editor.getSnapshot().report
    return {
      band: document.querySelector('.trial-band')?.textContent,
      name: r.basicInfo.name,
      paragraphs: r.body.flatMap((c) => c.blocks).filter((b) => b.type === 'paragraph').length,
      images: (await allImages()).length,
      locked: !!document.querySelector('.tab-locked'),
      login: !!document.querySelector('.login-over:not(.tab-locked)'),
      top: document.querySelector('.app').getBoundingClientRect().top,
    }
  })
  check('お試しのタブに、見本の原稿（文化 花子さん・本文の段落）と写真が入っている', view.name === '文化　花子' && view.paragraphs >= 3 && view.images >= 2, JSON.stringify(view))
  check('上の帯に「お試し中」「提出・ドライブには届きません」「見本に戻す」。画面は帯の下から', /お試し中（見本の原稿）/.test(view.band) && /提出・ドライブには届きません/.test(view.band) && /見本に戻す/.test(view.band) && view.top >= 30, `${view.band} / top ${view.top}`)
  check('お試しは、ログインを求めず、ふだんのツールのタブとも書けるタブを取り合わない', !view.locked && !view.login, JSON.stringify(view))
  await trial.screenshot({ path: `${OUT}/2-trial-opened.png` })

  // 試した内容は、読み込み直しても残る（管理ページを待たずに開く）
  await trial.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, name: '試した名前' } })))
  await sleep(1500)
  const t0 = Date.now()
  await trial.reload({ waitUntil: 'networkidle0' })
  await ready(trial)
  const reopened = await trial.evaluate(() => window.__editor.getSnapshot().report.basicInfo.name)
  check('試した内容は、読み込み直しても残る（置いてある見本で、すぐ開く）', reopened === '試した名前' && Date.now() - t0 < 20000, `${reopened}・${Date.now() - t0}ms`)

  // 「見本に戻す」：確かめてから、最初の見本に戻る
  await trial.click('.trial-band .trial-reset')
  await trial.waitForFunction(() => window.__editor.getSnapshot().report.basicInfo.name === '文化　花子', { timeout: 30000 })
  await ready(trial)
  check('「見本に戻す」で、確かめてから最初の見本の原稿に戻る', /見本の原稿に戻しますか/.test(dialogs.at(-1) ?? ''), dialogs.at(-1))
  await trial.screenshot({ path: `${OUT}/3-trial-reset.png` })

  // 学生の原稿（ふだんの入れ物）は、そのまま。お試しの原稿は、お試しの入れ物に
  check('ふだんの入れ物の学生の原稿は変わらない（お試しの原稿は、お試しの入れ物にだけ）', (await savedName(trial, 'sotsugyo-seisaku-report')) === '本物の学生' && (await savedName(trial, 'sotsugyo-seisaku-report-trial')) === '文化　花子')
  const outside = await outsideRequests(trial)
  check('お試しのタブは、開発サーバーのほかにつながない（Google・Apps Script など）', outside.length === 0, outside.slice(0, 3).join(' '))

  // スマホの幅：帯は短く（説明の文を省く）
  await trial.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  await sleep(800)
  const phone = await trial.evaluate(() => ({ note: getComputedStyle(document.querySelector('.trial-band .trial-note')).display, button: document.querySelector('.trial-band .trial-reset').getBoundingClientRect().right }))
  check('スマホの幅では、帯の説明の文を省き、ボタンは画面の中', phone.note === 'none' && phone.button <= 390, JSON.stringify(phone))
  await trial.screenshot({ path: `${OUT}/4-trial-phone.png` })

  // 管理ページから開いていない：見本が置いてあれば、そのまま開く
  const direct = await context.newPage()
  await noHmr(direct)
  await direct.setViewport({ width: 1366, height: 768 })
  await direct.goto(`${APP}/?trial=1`, { waitUntil: 'networkidle0' })
  await ready(direct)
  check('見本が置いてあるブラウザでは、URL から直接開いても、お試しが開く', (await direct.evaluate(() => window.__editor.getSnapshot().report.basicInfo.name)) === '文化　花子')
  await context.close()

  // 見本がないブラウザで直接開くと、管理ページから開くよう知らせる
  const fresh = await browser.createBrowserContext()
  const none = await fresh.newPage()
  await noHmr(none)
  await none.goto(`${APP}/?trial=1`, { waitUntil: 'networkidle0' })
  await none.waitForSelector('.trial-missing', { timeout: 30000 })
  check('見本がないブラウザで直接開くと、「管理ページの「学生の画面を試す」から開いて」と知らせる', /管理ページの「学生の画面を試す」から開いてください/.test(await none.evaluate(() => document.querySelector('.trial-missing').textContent)))
  await none.screenshot({ path: `${OUT}/5-trial-missing.png` })
  await fresh.close()
}

// 単独で動かすとき：node scripts/e2e/trialMode.mjs（開発サーバーが動いていること）
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = []
  const check = (name, ok, detail = '') => {
    results.push({ name, ok })
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
  }
  await withEdge((browser) => trialModeAdmin(browser, check))
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 件 合格`)
  process.exitCode = failed.length ? 1 : 0
}
