// 待つ間の表示（依頼者の要望 2026-10-20「保存中に何も表示がなく待たされるので不安になります。待機が必要となる場面では、何かしらの表示を出して欲しい」）
// を確かめる（Edge を自動で操作する）。パソコンは smoke.mjs、スマホは phone.mjs、ドライブ（偽物の Google）は drive.mjs から呼ぶ。
// このファイルだけでも動かせる（node scripts/e2e/waiting.mjs。開発サーバーが http://localhost:5173 で動いていること。APP_URL・EDGE_PORT で変えられる）。
// 画面の写真は poc-output/waiting/ に置く（パソコン 1366×768 とスマホ 390×844）。
// - 押したボタンに、すぐ（100ms 以内）回る小さな印と言葉（「保存しています…」など）が出て、終わるまで押せない
// - 2秒を過ぎたら「数秒かかることがあります」（写真の多い Word などは「十数秒」）
// - 終わったら、短い知らせ（「✓ 保存しました」「バックアップファイルから戻しました」など）
// 待つ間の画面を撮るため、ファイル・写真を読む処理と偽物のドライブを、わざと遅くすることがある（busyWatch.mjs の slowDown・fakeGoogle.mjs の delay）。
// ふだんの速さで押してから終わるまでの時間（dur）も、確かめの横に出す
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { busyDone, busyResult, clickBusy, MEASURE, setSlow, slowDown, throttle, watchBusy } from './busyWatch.mjs'
import { stubConfig } from './configStub.mjs'
import { fakeDrive, routeGoogle } from './fakeGoogle.mjs'
import { setupWriting } from './sampleReport.mjs'
import { answerConfirms } from './confirmUi.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/waiting'
mkdirSync(OUT, { recursive: true })
const DOWNLOADS = resolve(`${OUT}/downloads`)
const PC = { width: 1366, height: 768 }
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
/** 写真を選ぶ画面で選ぶファイル（見本の写真。読むだけ） */
const PHOTOS = ['photo-1', 'design'].map((n) => resolve(`docs/guide-images/sample/${n}.jpg`))
const BODY_DOCX = resolve('scripts/e2e/fixtures/word-sample-body.docx')
/** 押してから回る印が出るまでの長さの上限 */
const QUICK_MS = 100
/** 学科の設定（偽物の Google が返す。drive.mjs と同じ） */
const CONFIG = JSON.parse(readFileSync(new URL('./config-fixture.json', import.meta.url), 'utf8'))
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

/** 確かめている途中に src/ が直されても、画面が入れ替わらないようにする（smoke.mjs と同じ） */
const noHotReload = (page) =>
  page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
  })

/** すぐ出たか（押してから QUICK_MS 以内に回る印が出て、そのときボタンが押せない） */
const quick = (r, label) => r.delay !== null && r.delay <= QUICK_MS && r.disabled !== false && (!label || r.label === label)
/** 確かめの横に出す、押してから終わるまでの時間など */
const detail = (r, extra = {}) => JSON.stringify({ delay: r.delay, disabled: r.disabled, label: r.label, dur: r.dur, slow: r.slow || undefined, slowAfter: r.slowAfter ?? undefined, ...extra })
/** 画面の下の知らせ（「バックアップファイルから戻しました」など） */
const toastText = (page) => page.evaluate(() => [...document.querySelectorAll('.undo-area .undo-toast')].map((t) => t.textContent).join(' '))

/** 見本の原稿（指摘0件）を、この端末だけに保存する形（?nodrive）で開く。vp：画面の大きさ */
async function openSample(browser, vp) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await noHotReload(page)
  await stubConfig(page)
  await slowDown(page)
  await throttle(page)
  page.on('pageerror', (e) => console.log('pageerror(waiting):', e.message))
  // 「この時点に戻す」「最初から作り直す」などの確かめは、「OK」を押す
  page.on('dialog', (d) => d.accept())
  // 学生のツールの確認・知らせは画面の中の窓（src/app/ask.tsx）。前のブラウザの確認と同じく答える
  await answerConfirms(page, () => true)
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  })
  if (vp.isMobile) await page.setUserAgent(UA_IPHONE)
  await page.setViewport(vp)
  await (await page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS, browserContextId: context.id })
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0', timeout: 90000 })
  const ready = () =>
    page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 90000 })
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
  await ready()
  return { context, page, ready }
}

/** 「メニュー」の項目を押す（PC は右の欄の「≡ メニュー」、スマホは上の帯の ≡ の欄） */
async function menu(page, phone, name) {
  if (phone) {
    await page.click('.p-top .icon-btn')
    await page.waitForSelector('.sheet .links')
    await page.evaluate((name) => [...document.querySelectorAll('.sheet button')].find((b) => b.textContent.includes(name)).click(), name)
  } else {
    if (!(await page.$('.side .head-menu'))) await page.click('.side .menu-btn')
    await page.waitForSelector('.side .head-menu [role="menuitem"]')
    await page.evaluate((name) => [...document.querySelectorAll('.side .head-menu [role="menuitem"]')].find((b) => b.textContent.includes(name)).click(), name)
  }
}

/** 保存されたバックアップファイルを待つ（いちばん新しいもの） */
async function savedBackup(after) {
  for (let i = 0; i < 80; i++) {
    const files = existsSync(DOWNLOADS) ? readdirSync(DOWNLOADS).filter((f) => f.endsWith('.json')).map((f) => join(DOWNLOADS, f)).filter((f) => statSync(f).mtimeMs >= after && statSync(f).size > 0) : []
    if (files.length) return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    await pause(250)
  }
  return null
}

/** 紙面の上の知らせ（写真を取り込んでいます…）の様子：画面の中に収まり、言葉は1行ずつ（1字だけ次の行に残らない） */
const toastShape = (page) =>
  page.evaluate(() => {
    const t = document.querySelector('.wait-toast')
    if (!t) return null
    const r = t.getBoundingClientRect()
    const lines = (el) => (el ? Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)) : 0)
    return { text: t.textContent, inside: r.left >= 8 && r.right <= innerWidth - 8 && r.top >= 0, textLines: lines(t.querySelector('.wt-text')), smallLines: lines(t.querySelector('small')) }
  })

// =====================================================================
// はじめて開く（この端末に原稿がない）：紙面を準備している間
// =====================================================================
async function firstOpen(browser, vp, check, who, shot) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await noHotReload(page)
  await stubConfig(page)
  await throttle(page)
  if (vp.isMobile) await page.setUserAgent(UA_IPHONE)
  await page.setViewport(vp)
  const started = Date.now()
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  const text = await page
    .waitForFunction(() => { const l = document.querySelector('.loading'); return l?.querySelector('.busy-spin') && l.textContent.includes('初回') ? l.textContent : null }, { timeout: 60000, polling: 20 })
    .then((h) => h.jsonValue(), () => '')
  await page.screenshot({ path: `${OUT}/${shot}` })
  await page.waitForFunction(() => window.__editor?.getSnapshot()?.layout && !document.querySelector('.loading'), { timeout: 90000 })
  check(`${who}：はじめて開いたとき、紙面を準備している間は、回る印と「紙面を準備しています…（初回は数秒かかります）」`, text === '紙面を準備しています…（初回は数秒かかります）', JSON.stringify({ text, dur: Date.now() - started }))
  await context.close()
}

// =====================================================================
// 写真を入れる（作品写真の空いている枠に、2枚まとめて）
// =====================================================================
async function photoInsert(page, ready, check, who, shot) {
  await watchBusy(page, '.wait-toast')
  await setSlow(page, 1300)
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.evaluate(() => void window.__editor.addPhotos(0, 0))])
  await chooser.accept(PHOTOS)
  await page.waitForSelector('.wait-toast', { timeout: 10000 })
  await pause(2300)
  const during = await toastShape(page)
  await page.screenshot({ path: `${OUT}/${shot}` })
  await setSlow(page, 0)
  await busyDone(page)
  await ready()
  const r = await busyResult(page)
  const placed = await page.evaluate(() => window.__editor.getSnapshot().report.workPhotos.flatMap((p) => p.imageIds).filter(Boolean).length)
  check(
    `${who}：写真を選ぶと、すぐ（100ms 以内）紙面の上に回る印と「写真を取り込んでいます…（1 / 2枚）」が出る。2秒を過ぎたら「数秒かかることがあります」。紙面に出たら消える`,
    r.delay !== null && r.delay <= QUICK_MS && /写真を取り込んでいます…（\d \/ 2枚）/.test(during?.text ?? '') && /数秒かかることがあります/.test(r.slow) && r.ended && placed >= 3,
    detail(r, { during, placed }),
  )
  check(`${who}：「写真を取り込んでいます…」の知らせは画面の中に収まり、言葉は1行ずつ（1字だけ次の行に残らない）`, !!during && during.inside && during.textLines === 1 && during.smallLines === 1, JSON.stringify(during))
}

// =====================================================================
// バックアップ・作り直す（保存・復元・自動の控えに戻す・最初から作り直す）
// =====================================================================
async function backupSave(page, check, who, phone, shot) {
  await menu(page, phone, 'バックアップ')
  await page.waitForSelector('.backup-modal .backup-save')
  await page.waitForFunction(() => !document.querySelector('.backup-modal .busy-line'), { timeout: 10000 })
  const startedAt = Date.now() - 1000
  await watchBusy(page, '.backup-modal .backup-save')
  // 写真は並べて読むので、1枚分の遅さが、そのまま全体の遅さになる
  await setSlow(page, 3000)
  await clickBusy(page, '.backup-modal .backup-save')
  await pause(2300)
  const during = await page.evaluate(() => ({
    others: [...document.querySelectorAll('.backup-modal button')].filter((b) => !b.classList.contains('backup-save')).every((b) => b.disabled),
    height: Math.round(document.querySelector('.backup-modal .backup-save').getBoundingClientRect().height),
    opacity: getComputedStyle(document.querySelector('.backup-modal .backup-save')).opacity,
  }))
  await page.screenshot({ path: `${OUT}/${shot}` })
  await setSlow(page, 0)
  await busyDone(page)
  const r = await busyResult(page)
  const done = await page.evaluate(() => document.querySelector('.backup-modal .done-note')?.textContent ?? '')
  // 「✓ 保存しました（「ダウンロード」のフォルダ）」は、狭い画面でも「（」の前でしか折り返さない
  const doneLines = await page.evaluate(() => [...document.querySelectorAll('.backup-modal .done-note .nb')].map((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight))))
  await page.screenshot({ path: `${OUT}/${shot.replace('.png', '-done.png')}` })
  const file = await savedBackup(startedAt)
  check(
    `${who}：「バックアップファイルを保存」を押すと、すぐ（100ms 以内）ボタンに回る印と「保存しています…」（ほとんど薄くしない）。終わるまで、ほかのボタン・×・「閉じる」も押せない。2秒を過ぎたら「数秒かかることがあります」、終わると「✓ 保存しました（「ダウンロード」のフォルダ）」`,
    quick(r, '保存しています…') && during.others && Number(during.opacity) >= 0.85 && /数秒かかることがあります/.test(r.slow) && done === '保存しました（「ダウンロード」のフォルダ）' && doneLines.every((n) => n === 1) && !!file && (!phone || during.height >= 44),
    detail(r, { ...during, done, doneLines, file: !!file }),
  )
  return file
}

async function backupRestore(page, ready, check, who, file, shot) {
  await page.waitForSelector('.backup-modal .file-button')
  await watchBusy(page, '.backup-modal .file-button')
  await setSlow(page, 900)
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.evaluate(() => document.querySelector('.backup-modal .file-button').click())])
  await chooser.accept([file])
  await pause(450)
  const during = await page.evaluate(() => ({ others: [...document.querySelectorAll('.backup-modal button')].filter((b) => !b.classList.contains('file-button')).every((b) => b.disabled) }))
  await page.screenshot({ path: `${OUT}/${shot}` })
  // 確かめ（「置き換えますか？」）は OK を押す（openSample の dialog）
  await page.waitForFunction(() => !document.querySelector('.backup-modal'), { timeout: 30000 })
  await setSlow(page, 0)
  const r = await busyResult(page)
  await ready()
  const toast = await toastText(page)
  check(
    `${who}：バックアップファイルを選ぶと、すぐ（100ms 以内）「バックアップファイルから復元」に回る印と「読み込んでいます…」が出て、終わるまで押せない（ほかのボタンも）。戻したら「バックアップファイルから戻しました」`,
    quick(r, '読み込んでいます…') && during.others && toast.includes('バックアップファイルから戻しました'),
    detail(r, { ...during, toast }),
  )
}

async function snapshotRestore(page, ready, check, who, phone) {
  await menu(page, phone, 'バックアップ')
  await page.waitForSelector('.backup-modal .snapshots li button', { timeout: 10000 })
  await watchBusy(page, '.backup-modal .snapshots li:first-child button')
  // 確かめ（「この控えに戻しますか？」）のあとで、ボタンに回る印が出る
  await clickBusy(page, '.backup-modal .snapshots li:first-child button')
  await page.waitForFunction(() => !document.querySelector('.backup-modal'), { timeout: 30000 })
  const r = await busyResult(page)
  await ready()
  const toast = await toastText(page)
  check(`${who}：「この時点に戻す」は、確かめのあと、そのボタンに回る印と「戻しています…」が出て押せない。戻したら「◯/◯ ◯:◯ の控えに戻しました」`, r.delay !== null && r.disabled !== false && r.label === '戻しています…' && /の控えに戻しました/.test(toast), detail(r, { toast }))
}

async function startOver(page, check, who, phone) {
  await menu(page, phone, 'バックアップ')
  await page.waitForSelector('.backup-modal .start-over-row button')
  await watchBusy(page, '.backup-modal .start-over-row button')
  await clickBusy(page, '.backup-modal .start-over-row button')
  await page.waitForSelector('.guide.step-course', { timeout: 30000 })
  const r = await busyResult(page)
  check(`${who}：「最初から作り直す」は、確かめのあと、ボタンに回る印と「作り直しています…」が出て押せない。作り直したら、はじめての案内（コースを選ぶ）が出る`, r.delay !== null && r.disabled !== false && r.label === '作り直しています…', detail(r))
}

// =====================================================================
// Word で書いた分を読み込む（本文だけ）
// =====================================================================
async function wordImport(page, ready, check, who, phone, shot) {
  await menu(page, phone, 'Word で書いた分を読み込む')
  await page.waitForSelector('.modal.word-mid')
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.evaluate(() => document.querySelector('.word-file .acts button:not(.link)').click())])
  await chooser.accept([BODY_DOCX])
  await pause(200)
  await watchBusy(page, '.modal .word-read')
  await setSlow(page, 1300)
  await clickBusy(page, '.modal .word-read')
  await pause(2300)
  const reading = await page.evaluate(() => ({
    status: document.querySelector('.word-status')?.textContent ?? '',
    cancel: [...document.querySelectorAll('.modal .row-buttons button')].find((b) => b.textContent === 'やめる')?.disabled,
    pick: [...document.querySelectorAll('.word-file .acts button')].every((b) => b.disabled),
  }))
  await page.screenshot({ path: `${OUT}/${shot}` })
  await setSlow(page, 0)
  await page.waitForSelector('.modal.word-modal', { timeout: 60000 })
  const read = await busyResult(page)
  check(
    `${who}：「中身を確かめる」を押すと、すぐ（100ms 以内）ボタンに回る印と「読み取っています…」が出て押せない（ファイルを選ぶボタンも。「やめる」は押せる）。2秒を過ぎたら「写真が多いと、十数秒かかることがあります」`,
    quick(read, '読み取っています…') && reading.pick && reading.cancel === false && reading.status === '写真が多いと、十数秒かかることがあります',
    detail(read, reading),
  )
  await page.waitForFunction(() => [...document.querySelectorAll('.word-figs img')].every((i) => i.complete), { timeout: 20000 })
  await watchBusy(page, '.modal .word-import')
  await clickBusy(page, '.modal .word-import')
  await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 60000 })
  const imported = await busyResult(page)
  await ready()
  // 読み込んだあと：PC は右の欄に「つぎにすること」。スマホは、表紙の項目が空いていれば、はじめての案内がその項目から出る（でなければ、チェックの欄に「つぎにすること」）
  const after = await page.evaluate(() => ({ todo: !!document.querySelector('.word-todo'), guide: !!document.querySelector('.guide') }))
  check(
    `${who}：「読み込む」を押すと、すぐ（100ms 以内）ボタンに回る印と「読み込んでいます…」が出て押せない。読み込んだら${phone ? '、表紙の空いた項目の案内か、' : ''}「Word から写しました」の「つぎにすること」が出る`,
    quick(imported, '読み込んでいます…') && (after.todo || (phone && after.guide)),
    detail(imported, after),
  )
  // 「読み込む前の原稿に戻す」（スマホはチェックの欄の中。PC は右の欄）
  if (phone) {
    if (after.guide) {
      await page.evaluate(() => document.querySelector('.g-later')?.click())
      await page.evaluate(() => window.__editor.finishEditing())
      await ready()
    }
    if (!(await page.$('.sheet .word-todo'))) await page.evaluate(() => document.querySelector('.p-nav .nav-check').click())
    await page.waitForSelector('.sheet .word-todo .undo', { timeout: 10000 })
  }
  await watchBusy(page, '.word-todo .undo')
  await clickBusy(page, '.word-todo .undo')
  await page.waitForFunction(() => !document.querySelector('.word-todo'), { timeout: 30000 })
  const back = await busyResult(page)
  await ready()
  if (phone) await page.evaluate(() => document.querySelector('.sheet-close')?.click())
  const toast = await toastText(page)
  check(`${who}：「読み込む前の原稿に戻す」は、確かめのあと「戻しています…」と回る印が出て押せない。戻したら「Word から読み込む前の原稿に戻しました」`, back.delay !== null && back.disabled !== false && back.label === '戻しています…' && toast.includes('Word から読み込む前の原稿に戻しました'), detail(back, { toast }))
}

// =====================================================================
// 「PDFを書き出す」（紙面を確かめる間）
// =====================================================================
async function exportButton(page, check, who, phone) {
  const sel = phone ? '.p-nav .nav-pdf' : '.side-foot .export'
  await watchBusy(page, sel)
  await clickBusy(page, sel)
  await page.waitForSelector('.modal', { timeout: 30000 })
  const r = await busyResult(page)
  await page.evaluate(() => [...document.querySelectorAll('.modal .row-buttons button')].find((b) => /やめる|直しに戻る/.test(b.textContent))?.click())
  await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 10000 })
  check(`${who}：「PDF${phone ? '' : 'を書き出す'}」を押すと、紙面を確かめる間、ボタンに回る印と「${phone ? '確認中…' : '確かめています…'}」が出て押せない`, quick(r, phone ? '確認中…' : '確かめています…'), detail(r))
}

/** パソコン（smoke.mjs から） */
export async function waitingPc(browser, check) {
  rmSync(DOWNLOADS, { recursive: true, force: true })
  mkdirSync(DOWNLOADS, { recursive: true })
  const who = 'パソコン'
  await firstOpen(browser, PC, check, who, 'pc-first-open.png')
  const { context, page, ready } = await openSample(browser, PC)
  try {
    await exportButton(page, check, who, false)
    await photoInsert(page, ready, check, who, 'pc-photo.png')
    const file = await backupSave(page, check, who, false, 'pc-backup-save.png')
    if (file) await backupRestore(page, ready, check, who, file, 'pc-backup-restore.png')
    else check(`${who}：バックアップファイルが保存される`, false)
    await snapshotRestore(page, ready, check, who, false)
    await wordImport(page, ready, check, who, false, 'pc-word-read.png')
    await startOver(page, check, who, false)
  } finally {
    await setSlow(page, 0).catch(() => {})
    await context.close()
  }
}

/** スマホ（phone.mjs から）：同じ働きを、スマホの画面で（ボタンは高さ 44px 以上） */
export async function waitingPhone(browser, check) {
  rmSync(DOWNLOADS, { recursive: true, force: true })
  mkdirSync(DOWNLOADS, { recursive: true })
  const who = 'スマホ'
  await firstOpen(browser, PHONE, check, who, 'phone-first-open.png')
  const { context, page, ready } = await openSample(browser, PHONE)
  try {
    await exportButton(page, check, who, true)
    await photoInsert(page, ready, check, who, 'phone-photo.png')
    const file = await backupSave(page, check, who, true, 'phone-backup-save.png')
    if (file) await backupRestore(page, ready, check, who, file, 'phone-backup-restore.png')
    await wordImport(page, ready, check, who, true, 'phone-word-read.png')
  } finally {
    await setSlow(page, 0).catch(() => {})
    await context.close()
  }
}

// =====================================================================
// ドライブ（偽物の Google。drive.mjs から）：ログイン・今すぐドライブに保存・読み込み直す
// =====================================================================

/** 端末（ブラウザの別の窓口）を1つ用意する */
async function driveDevice(browser, drive, vp) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await noHotReload(page)
  await throttle(page)
  page.on('pageerror', (e) => console.log('pageerror(waiting-drive):', e.message))
  page.on('dialog', (d) => d.accept())
  // 学生のツールの確認・知らせは画面の中の窓（src/app/ask.tsx）。前のブラウザの確認と同じく答える
  await answerConfirms(page, () => true)
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  })
  if (vp.isMobile) await page.setUserAgent(UA_IPHONE)
  await page.setViewport(vp)
  await routeGoogle(page, drive, CONFIG)
  await page.goto(APP, { waitUntil: 'networkidle0', timeout: 90000 })
  await page.waitForSelector('.login-over .login-btn')
  await page.waitForFunction(() => window.__editor?.getSnapshot()?.layout, { timeout: 90000 })
  return { context, page }
}

const gateClosed = (page) => page.waitForFunction(() => !document.querySelector('.login-over'), { timeout: 90000 })
const savedChip = (page) => page.waitForFunction(() => !document.querySelector('.chip .dot.busy') && [...document.querySelectorAll('.chip.ok')].some((c) => /\d+:\d+/.test(c.textContent)), { timeout: 60000 })
const setInfo = (page, patch) => page.evaluate((patch) => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, ...patch } })), patch)

/** 偽物のドライブの原稿を、別の端末が書き直したことにする（name：氏名） */
function writeElsewhere(drive, name) {
  const f = [...drive.files.values()].find((x) => x.name === '原稿.json' && !x.trashed)
  const body = JSON.parse(f.content.toString('utf8'))
  body.report.basicInfo.name = name
  body.report.updatedAt = new Date(Date.now() + 60_000).toISOString()
  body.device = 'iPhone・Safari'
  f.content = Buffer.from(JSON.stringify(body), 'utf8')
  f.appProperties = { ...f.appProperties, writer: 'another-device', updatedAt: body.report.updatedAt }
  f.modifiedTime = new Date(Date.now() + 60_000).toISOString()
}

export async function waitingDrive(browser, check) {
  const drive = fakeDrive('00zz902@bunka-wu.ac.jp')
  // ---- パソコン：はじめてのログイン（Google の返事が遅いとき） ----
  const pc = await driveDevice(browser, drive, PC)
  const page = pc.page
  drive.delay = 2500
  await watchBusy(page, '.login-over .login-btn')
  await clickBusy(page, '.login-over .login-btn')
  await pause(2300)
  const signing = await page.evaluate(() => ({ text: document.querySelector('.login-over .login-btn')?.textContent ?? '', slow: document.querySelector('.login-over .slow-note.on')?.textContent ?? '' }))
  await page.screenshot({ path: `${OUT}/pc-login.png` })
  const login = await busyResult(page)
  check('ドライブ：ログインのボタンを押すと、すぐ（100ms 以内）ボタンに回る印と「ログインしています…」が出て押せない。2秒を過ぎたら「数秒かかることがあります」', quick(login, 'ログインしています…') && signing.slow === '数秒かかることがあります', detail(login, signing))
  // そのあと、ドライブの原稿を確かめている間（はじめは十数秒かかることがある）
  await page.waitForSelector('.login-over .login-spin', { timeout: 30000 })
  await pause(2300)
  const checking = await page.evaluate(() => document.querySelector('.login-over .slow-note.on')?.textContent ?? '')
  await page.screenshot({ path: `${OUT}/pc-login-checking.png` })
  drive.delay = 0
  await gateClosed(page)
  check('ドライブ：ログインのあと、ドライブの原稿を確かめる間は回る印と「ドライブの原稿を確かめています…」。2秒を過ぎたら「十数秒かかることがあります」', checking === '十数秒かかることがあります', checking)
  await page.waitForSelector('.guide .g-opts button')
  await page.evaluate(() => [...document.querySelectorAll('.guide .g-opts button')].find((b) => b.textContent.includes('映画・舞台衣装')).click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.g-later')
  await page.evaluate(() => document.querySelector('.g-later').click())
  await setInfo(page, { name: '文化　花子' })
  await savedChip(page)

  // ---- 今すぐドライブに保存（送るのに時間がかかるとき） ----
  drive.uploadDelay = 2600
  await setInfo(page, { subtitleInput: '今すぐ保存' })
  await page.click('.drive-chip-wrap .chip')
  await page.waitForSelector('.drive-pop .drive-save-now')
  await watchBusy(page, '.drive-pop .drive-save-now')
  await clickBusy(page, '.drive-pop .drive-save-now')
  await pause(2300)
  const saving = await page.evaluate(() => ({
    open: !!document.querySelector('.drive-pop'),
    others: [...document.querySelectorAll('.drive-pop button:not(.drive-save-now)')].every((b) => b.disabled),
    chip: !!document.querySelector('.drive-chip-wrap .chip .dot.busy'),
    slow: document.querySelector('.drive-pop .slow-note.on')?.textContent ?? '',
  }))
  await page.screenshot({ path: `${OUT}/pc-drive-save.png` })
  await busyDone(page)
  const save = await busyResult(page)
  const saved = await page.evaluate(() => document.querySelector('.drive-pop .drive-done')?.textContent ?? '')
  drive.uploadDelay = 0
  await page.screenshot({ path: `${OUT}/pc-drive-saved.png` })
  check(
    'ドライブ：「今すぐドライブに保存」を押すと、操作の欄は開いたまま、すぐ（100ms 以内）ボタンに回る印と「ドライブに保存しています…」が出て押せない（ほかの操作も）。保存のようすも「ドライブに保存しています…」。2秒を過ぎたら「数秒かかることがあります」、送れたら「ドライブに保存しました（13:44）」',
    quick(save, 'ドライブに保存しています…') && saving.open && saving.others && saving.chip && saving.slow === '数秒かかることがあります' && /^ドライブに保存しました（\d{1,2}:\d{2}）$/.test(saved) && drive.report()?.report.basicInfo.subtitleInput === '今すぐ保存',
    detail(save, { ...saving, saved }),
  )

  // ---- ドライブの原稿を読み込み直す（別の端末が書き直していた。返事が遅いとき） ----
  writeElsewhere(drive, '読み込み直し　花子')
  drive.delay = 1200
  if (!(await page.$('.drive-pop'))) await page.click('.drive-chip-wrap .chip')
  await page.waitForSelector('.drive-pop button')
  await watchBusy(page, '.login-over .login-spin')
  await clickBusy(page, '.drive-pop button', '読み込み直す')
  await pause(2300)
  const reloading = await page.evaluate(() => ({ text: document.querySelector('.login-over .login-spin')?.textContent ?? '', slow: document.querySelector('.login-over .slow-note.on')?.textContent ?? '' }))
  await page.screenshot({ path: `${OUT}/pc-drive-reload.png` })
  drive.delay = 0
  await gateClosed(page)
  const reload = await busyResult(page)
  await page.waitForFunction(() => window.__editor.getSnapshot().report.basicInfo.name === '読み込み直し　花子', { timeout: 30000 }).catch(() => {})
  const reloadToast = await toastText(page)
  check(
    'ドライブ：「ドライブの原稿を読み込み直す」を押すと、すぐ（100ms 以内）回る印と「ドライブの原稿を確かめています…」が出る。2秒を過ぎたら「十数秒かかることがあります」。読み込んだら「ドライブの原稿を読み込みました」',
    reload.delay !== null && reload.delay <= QUICK_MS && reloading.text === 'ドライブの原稿を確かめています…' && reloading.slow === '十数秒かかることがあります' && reloadToast.includes('ドライブの原稿を読み込みました'),
    detail(reload, { ...reloading, reloadToast }),
  )
  await pc.context.close()

  // ---- スマホ：メニューの中の「今すぐドライブに保存」 ----
  const ph = await driveDevice(browser, drive, PHONE)
  await ph.page.click('.login-over .login-btn')
  await gateClosed(ph.page)
  await ph.page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering }, { timeout: 90000 })
  drive.uploadDelay = 2600
  await setInfo(ph.page, { subtitleInput: 'スマホで今すぐ保存' })
  await ph.page.click('.p-top .icon-btn')
  await ph.page.waitForSelector('.sheet .drive-pop .drive-save-now')
  await watchBusy(ph.page, '.sheet .drive-pop .drive-save-now')
  await clickBusy(ph.page, '.sheet .drive-pop .drive-save-now')
  await pause(2300)
  const phone = await ph.page.evaluate(() => ({
    heights: [...document.querySelectorAll('.sheet .drive-pop button')].map((b) => Math.round(b.getBoundingClientRect().height)),
    slow: document.querySelector('.sheet .drive-pop .slow-note.on')?.textContent ?? '',
    sheet: !!document.querySelector('.sheet'),
    hscroll: document.documentElement.scrollWidth > innerWidth,
  }))
  await ph.page.screenshot({ path: `${OUT}/phone-drive-save.png` })
  await busyDone(ph.page)
  const phoneSave = await busyResult(ph.page)
  const phoneSaved = await ph.page.evaluate(() => document.querySelector('.sheet .drive-pop .drive-done')?.textContent ?? '')
  await ph.page.screenshot({ path: `${OUT}/phone-drive-saved.png` })
  drive.uploadDelay = 0
  check(
    'ドライブ（スマホ）：メニューの「今すぐドライブに保存」も、欄を開いたまま、すぐ回る印と「ドライブに保存しています…」。ドライブの操作のボタンは高さ 44px 以上。送れたら「ドライブに保存しました（13:44）」',
    quick(phoneSave, 'ドライブに保存しています…') && phone.sheet && phone.heights.every((h) => h >= 44) && phone.slow === '数秒かかることがあります' && /^ドライブに保存しました（\d{1,2}:\d{2}）$/.test(phoneSaved) && !phone.hscroll,
    detail(phoneSave, { ...phone, phoneSaved }),
  )
  await ph.context.close()
}

// このファイルだけで動かしたとき：パソコン・スマホ・ドライブを順に
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { withEdge } = await import('../poc/edge.mjs')
  const results = []
  const check = (name, ok, extra = '') => {
    results.push({ name, ok })
    console.log(`${ok ? '✓' : '✗'} ${name}${extra ? `  (${extra})` : ''}`)
  }
  const only = process.argv[2]
  if (MEASURE) console.log(`測る：CPU を ${MEASURE} 倍遅くして、わざと遅くはしない（確かめの横の dur が、押してから終わるまでの時間）`)
  await withEdge(async (browser) => {
    if (!only || only === 'pc') await waitingPc(browser, check)
    if (!only || only === 'phone') await waitingPhone(browser, check)
    if (!only || only === 'drive') await waitingDrive(browser, check)
  })
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} 件 合格`)
  process.exitCode = failed.length ? 1 : 0
}
