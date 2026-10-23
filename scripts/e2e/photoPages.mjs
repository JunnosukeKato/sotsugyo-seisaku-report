// 作品写真の何ページか（mockups/v38 案A：依頼者の判断）を確かめる（Edge を自動で操作する。パソコンは smoke.mjs、スマホは phone.mjs から呼ぶ）。
// 画面の写真は poc-output/v38-impl/ に置く（1366×768 のパソコンと、390×844 のスマホ）。
// - 左の道具の「ページ」の欄：「＋ 写真のページを足す」（同じ並べ方の空のページを、すぐ後ろに）・「このページを消す」（1ページだけなら押せない。消すと「戻す」の知らせ）
// - 並べ方は4つ（6枚はない）。ページごとに選ぶ。ページの一覧・道具の上・スマホのページ送りは「作品写真 2」
// - 空いている枠より多く写真を選ぶと、最後のページと同じ並べ方のページを足して、全部入れる
// - セルフチェックの「まだのところ」：「6枚（2ページ）」、空のページがあれば「2ページ目が空です」。空のページは PDF に入らない
// - 前の版の原稿（6枚の並べ方）は、4枚と次のページ（2枚・上下）にして開く（写真は消えない）
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { stubConfig } from './configStub.mjs'
import { setupWriting } from './sampleReport.mjs'
import { answerConfirms } from './confirmUi.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/v38-impl'
mkdirSync(OUT, { recursive: true })
const DOWNLOADS = `${OUT}/downloads`
const pause = (ms = 400) => new Promise((r) => setTimeout(r, ms))
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
/** 写真を選ぶ画面で選ぶファイル（見本の写真。読むだけ） */
const PHOTOS = ['photo-1', 'design', 'process'].map((n) => resolve(`docs/guide-images/sample/${n}.jpg`))

/** 確かめている途中に src/ が直されても、画面が入れ替わらないようにする（smoke.mjs と同じ） */
const noHotReload = (page) =>
  page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
  })

/** 見本の原稿（指摘0件）を開く。vp：画面の大きさ */
async function openSample(browser, vp) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await noHotReload(page)
  await stubConfig(page)
  page.on('pageerror', (e) => console.log('pageerror(photo-pages):', e.message))
  page.on('dialog', (d) => d.dismiss())
  // 学生のツールの確認・知らせは画面の中の窓（src/app/ask.tsx）。前のブラウザの確認と同じく答える
  await answerConfirms(page, () => false)
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  })
  if (vp.isMobile) await page.setUserAgent(UA_IPHONE)
  await page.setViewport(vp)
  await page.goto(`${APP}/?nodrive&direct=0`, { waitUntil: 'networkidle0', timeout: 90000 })
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
  // 学籍番号は、PDF のファイル名が smoke.mjs の PDF と重ならないものにする
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, studentId: '00ZZ0938' } })))
  await pause(600)
  await ready()
  return { context, page, ready }
}

/** 作品写真の k ページ目（0 から）を出す */
const showPhotoPage = async (page, ready, k) => {
  await page.evaluate((k) => {
    const kinds = window.__editor.getSnapshot().layout.kinds
    let seen = -1
    window.__editor.goToPage(kinds.findIndex((x) => x === 'photos' && ++seen === k), 'none')
  }, k)
  await ready()
  await pause(400)
}

/** 左の道具（スマホは下の道具）のボタンを、名前で押す */
const tool = (page, scope, text) => page.evaluate((scope, text) => [...document.querySelectorAll(`${scope} .tb`)].find((b) => b.textContent.replace(/\s/g, '').includes(text))?.click(), scope, text)

const photosOf = (page) => page.evaluate(() => window.__editor.getSnapshot().report.workPhotos)
const photoRow = (scope) => (page) => page.evaluate((scope) => [...document.querySelectorAll(`${scope} li`)].find((li) => li.querySelector('.l')?.textContent.trim() === '作品写真')?.querySelector('.v')?.textContent ?? '', scope)

export async function photoPagesPc(browser, check) {
  const { context, page, ready } = await openSample(browser, { width: 1366, height: 768, deviceScaleFactor: 1 })
  rmSync(DOWNLOADS, { recursive: true, force: true })
  mkdirSync(DOWNLOADS, { recursive: true })
  await (await page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: resolve(DOWNLOADS), browserContextId: context.id })
  // 1ページ目に4枚
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, workPhotos: [{ layout: 4, imageIds: ['g-photo1', 'g-design', 'g-mood', 'g-process'] }] })))
  await pause(500)
  await ready()
  await showPhotoPage(page, ready, 0)
  const palette = () =>
    page.evaluate(() => ({
      head: document.querySelector('.palette .p-head b')?.textContent,
      lays: [...document.querySelectorAll('.palette .lay')].map((b) => b.textContent.replace(/\s/g, '')),
      label: document.querySelector('.palette .photo-pages .ctx-label')?.textContent,
      tools: [...document.querySelectorAll('.palette .photo-pages .tb')].map((b) => `${b.textContent.replace(/\s/g, '')}:${b.disabled}`),
      thumbs: [...document.querySelectorAll('.thumb-list .t')].map((t) => t.textContent.trim().split('\n').pop().trim()).filter((t) => t.startsWith('作品写真')),
    }))
  const one = await palette()
  check(
    '作品写真のページ：並べ方は4つ（1枚・2枚左右・2枚上下・4枚。6枚はない）、その下に「ページ」の欄「＋ 写真のページを足す」「このページを消す」（1ページだけのときは消せない）。ページが1つなら名前は「作品写真」',
    one.lays.join() === '1枚,2枚左右,2枚上下,4枚' && one.label === 'ページ' && one.tools.join() === '写真のページを足す:false,このページを消す:true' && one.head === '作品写真' && one.thumbs.join() === '作品写真',
    JSON.stringify(one),
  )

  // ---- 足す：同じ並べ方の空のページが、すぐ後ろにでき、そのページが出る ----
  await tool(page, '.palette .photo-pages', '写真のページを足す')
  await page.waitForFunction(() => window.__editor.getSnapshot().report.workPhotos.length === 2 && window.__editor.getSnapshot().photoPage === 1, { timeout: 30000 })
  await ready()
  await pause(500)
  const added = { photos: await photosOf(page), palette: await palette(), row: await photoRow('.side')(page), count: await page.evaluate(() => document.querySelector('.thumbs-col .pcount')?.textContent) }
  check(
    '「＋ 写真のページを足す」：1ページ目と同じ並べ方（4枚）の空のページが後ろにでき、そのページが出る。一覧と道具の上は「作品写真 1」「作品写真 2」、ページの数は 10',
    added.photos.length === 2 && added.photos[1].layout === 4 && added.photos[1].imageIds.length === 0 && added.palette.head === '作品写真 2' && added.palette.thumbs.join() === '作品写真 1,作品写真 2' && added.palette.tools.join() === '写真のページを足す:false,このページを消す:false' && added.count?.includes('/ 10'),
    JSON.stringify(added),
  )
  check('足したまま空のページは、セルフチェックの「まだのところ」に「2ページ目が空です」（赤くしない）', added.row === '2ページ目が空です', added.row)

  // ---- 並べ方はページごと：2ページ目を「1枚」にしても、1ページ目は4枚のまま ----
  await page.evaluate(() => [...document.querySelectorAll('.palette .lay')].find((b) => b.title.startsWith('1枚')).click())
  await pause(400)
  await ready()
  const perPage = await photosOf(page)
  check('並べ方はページごとに選べる（2ページ目を1枚にしても、1ページ目は4枚のまま）', perPage[0].layout === 4 && perPage[1].layout === 1, JSON.stringify(perPage.map((p) => p.layout)))

  // ---- 空いている枠より多く選ぶと、最後のページと同じ並べ方（1枚）のページを足して、全部入れる ----
  const slot = await page.evaluate(() => { const r = document.querySelector('.page-viewport.front section.photos[data-photo-page="1"] [data-photo-slot="0"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.mouse.click(slot.x, slot.y)])
  await chooser.accept(PHOTOS)
  await page.waitForFunction(() => window.__editor.getSnapshot().report.workPhotos.length === 4, { timeout: 30000 })
  await ready()
  await pause(500)
  const auto = { photos: (await photosOf(page)).map((p) => [p.layout, p.imageIds.filter(Boolean).length]), toast: await page.evaluate(() => document.querySelector('.undo-toast')?.textContent ?? ''), row: await photoRow('.side')(page) }
  check(
    '空いている枠（1つ）より多く写真を選ぶ（3枚）と、最後のページと同じ並べ方（1枚）のページを2つ足して全部入れ、「作品写真のページを2つ足して、2枚入れました」と出す（上限なしのときは、入れない写真はない）',
    JSON.stringify(auto.photos) === '[[4,4],[1,1],[1,1],[1,1]]' && auto.toast.includes('作品写真のページを2つ足して、2枚入れました') && !auto.toast.includes('入れていません'),
    JSON.stringify(auto),
  )
  check('セルフチェックの「まだのところ」は「7枚（4ページ）」', auto.row === '7枚（4ページ）', auto.row)

  // ---- 消す → 戻す ----
  await showPhotoPage(page, ready, 3)
  await tool(page, '.palette .photo-pages', 'このページを消す')
  await page.waitForFunction(() => window.__editor.getSnapshot().report.workPhotos.length === 3, { timeout: 30000 })
  await ready()
  await pause(500)
  const removed = await page.evaluate(() => ({ toast: document.querySelector('.undo-toast')?.textContent ?? '', photoPage: window.__editor.getSnapshot().photoPage }))
  check('「このページを消す」：中の写真ごとページが消え、前のページが出て、「作品写真のページを消しました（写真1枚も）［戻す］」が出る', removed.toast.startsWith('作品写真のページを消しました（写真1枚も）') && removed.toast.includes('戻す') && removed.photoPage === 2, JSON.stringify(removed))
  await page.evaluate(() => [...document.querySelectorAll('.undo-toast button')].find((b) => b.textContent.includes('戻す')).click())
  await page.waitForFunction(() => window.__editor.getSnapshot().report.workPhotos.length === 4, { timeout: 30000 })
  await ready()
  await pause(800)
  const restored = await page.evaluate(() => ({ toast: document.querySelector('.undo-toast')?.textContent ?? '', photoPage: window.__editor.getSnapshot().photoPage, ids: window.__editor.getSnapshot().report.workPhotos[3].imageIds.filter(Boolean).length }))
  check('知らせの「戻す」で、消したページが写真ごと戻り、そのページが出る（「作品写真のページを戻しました」）', restored.toast.includes('作品写真のページを戻しました') && restored.photoPage === 3 && restored.ids === 1, JSON.stringify(restored))

  // ---- 2ページ目の写真を押して Delete：そのページの写真だけ外れる ----
  await showPhotoPage(page, ready, 1)
  const p2 = await page.evaluate(() => { const r = document.querySelector('.page-viewport.front section.photos[data-photo-page="1"] [data-photo-slot="0"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  await page.mouse.click(p2.x, p2.y)
  await pause(300)
  const sel = await page.evaluate(() => window.__editor.getSnapshot().selection)
  await page.keyboard.press('Delete')
  await pause(400)
  await ready()
  const afterDel = (await photosOf(page)).map((p) => p.imageIds.filter(Boolean).length)
  check('2ページ目の写真を押すと、その写真（2ページ目の1枚目）を選び、Delete で、そのページの写真だけが外れる', sel?.kind === 'photos' && sel.page === 1 && sel.index === 0 && afterDel.join() === '4,0,1,1', JSON.stringify({ sel, afterDel }))
  await page.evaluate(() => window.__editor.undo())
  await pause(400)
  await ready()

  // ---- 写しの画面（1366×768）：2ページ目（2枚・上下）と、左の道具の「ページ」の欄 ----
  await page.evaluate(() =>
    window.__editor.update((r) => ({ ...r, workPhotos: [{ layout: 4, imageIds: ['g-photo1', 'g-design', 'g-mood', 'g-process'] }, { layout: 2, columns: 1, imageIds: ['g-satin', 'g-chiffon'] }] })),
  )
  await pause(500)
  await ready()
  await showPhotoPage(page, ready, 1)
  await page.mouse.move(5, 5)
  await page.screenshot({ path: `${OUT}/pc-two-photo-pages.png` })
  await page.screenshot({ path: `${OUT}/pc-palette-pages.png`, clip: await page.evaluate(() => { const r = document.querySelector('.palette').getBoundingClientRect(); return { x: 0, y: 0, width: r.right + 14, height: innerHeight } }) })
  const twoRow = await photoRow('.side')(page)
  check('2ページとも写真が入っていれば、まだのところは「6枚（2ページ）」の ✓', twoRow === '6枚（2ページ）', twoRow)

  // ---- 紙面：作品写真は、ページごとに組む（何ページ目か・ページごとの並べ方） ----
  const parity = await page.evaluate(() => {
    const ed = window.__editor
    const pages = ed.pageElements()
    const kinds = ed.getSnapshot().layout.kinds
    return { photoSections: pages.filter((_, i) => kinds[i] === 'photos').map((p) => p.querySelector('section.photos')?.dataset.photoPage).join(), grids: pages.filter((_, i) => kinds[i] === 'photos').map((p) => p.querySelector('section.photos')?.className).join('|') }
  })
  check('作品写真のページは、ページごとに組まれ（何ページ目か・ページごとの並べ方）、紙面の順に並ぶ', parity.photoSections === '0,1' && parity.grids === 'photos grid-2x2|photos grid-1x2', JSON.stringify(parity))

  // ---- PDF：空のページは入らない ----
  await tool(page, '.palette .photo-pages', '写真のページを足す')
  await page.waitForFunction(() => window.__editor.getSnapshot().report.workPhotos.length === 3, { timeout: 30000 })
  await ready()
  await pause(500)
  const title = await page.evaluate(() => window.__editor.pdfTitle)
  const pageCount = await page.evaluate(() => window.__editor.getSnapshot().pageCount)
  await page.click('.side .export')
  await page.waitForSelector('.modal .pdf-start')
  await page.click('.modal .pdf-start')
  await page.waitForSelector('.modal .pdf-open', { timeout: 120000 })
  const saved = await savedPdf(`${title}.pdf`)
  check('PDF には作品写真の2ページが入り、写真のない3ページ目は入らない（紙面 11ページ → PDF 10ページ）', pageCount === 11 && saved.pages === 10, JSON.stringify({ pageCount, saved }))
  await page.click('.modal .close')
  await pause(300)

  // ---- 前の版の原稿（6枚の並べ方）：4枚と次のページ（2枚・上下）にして開く。写真は消えない ----
  // 閉じる直前の写し（この端末の原稿より新しい）に、前の版の形の原稿を置いて、新しいタブで開く（前のタブは先に閉じる。閉じるときの写しで上書きされないように、開く前に置く）
  const old = await page.evaluate(() => {
    const r = window.__editor.getSnapshot().report
    return JSON.stringify({ ...r, formatVersion: 1, updatedAt: '2099-01-01T00:00:00.000Z', workPhotos: { layout: 6, columns: 2, imageIds: ['g-photo1', 'g-design', 'g-mood', 'g-process', 'g-satin', 'g-chiffon'] } })
  })
  await page.close()
  const again = await context.newPage()
  await noHotReload(again)
  await stubConfig(again)
  await again.evaluateOnNewDocument((old) => localStorage.setItem('sotsugyo-seisaku-report-leaving', old), old)
  await again.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 })
  await again.goto(`${APP}/?nodrive&direct=0`, { waitUntil: 'networkidle0', timeout: 90000 })
  await again.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !document.querySelector('.loading') }, { timeout: 60000 })
  await pause(800)
  const migrated = await again.evaluate(() => ({ photos: window.__editor.getSnapshot().report.workPhotos, version: window.__editor.getSnapshot().report.formatVersion }))
  check(
    '前の版の原稿（6枚の並べ方）を開くと、1ページ目は4枚、5・6枚目は2ページ目（2枚・上下）に移る（写真は消えない）',
    JSON.stringify(migrated.photos) === JSON.stringify([{ layout: 4, imageIds: ['g-photo1', 'g-design', 'g-mood', 'g-process'] }, { layout: 2, imageIds: ['g-satin', 'g-chiffon'], columns: 1 }]) && migrated.version === 2,
    JSON.stringify(migrated),
  )
  await context.close()
}

/** 「PDFを書き出す」で保存した PDF のページの数（smoke.mjs と同じ数え方） */
const savedPdf = async (name) => {
  for (let i = 0; i < 80 && !existsSync(`${DOWNLOADS}/${name}`); i++) await pause(250)
  if (!existsSync(`${DOWNLOADS}/${name}`)) return { files: readdirSync(DOWNLOADS), pages: 0 }
  const text = readFileSync(`${DOWNLOADS}/${name}`, 'latin1')
  return { pages: (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length, head: text.slice(0, 5) }
}

/** スマホ（390×844）：下の道具の並べ方（4つ）の横に「ページを足す」「ページを消す」。ページ送りは「作品写真 2 10 / 10」 */
export async function photoPagesPhone(browser, check) {
  const { context, page, ready } = await openSample(browser, { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, workPhotos: [{ layout: 4, imageIds: ['g-photo1', 'g-design', 'g-mood', 'g-process'] }] })))
  await pause(500)
  await ready()
  await showPhotoPage(page, ready, 0)
  const bar = () =>
    page.evaluate(() => {
      const group = document.querySelector('.sel-bar .group.ctx')
      const r = group?.getBoundingClientRect()
      return {
        lays: [...document.querySelectorAll('.sel-bar .lay')].map((b) => b.textContent.replace(/\s/g, '')),
        tools: [...document.querySelectorAll('.sel-bar .tb')].map((b) => `${b.textContent.replace(/\s/g, '')}:${b.disabled}`),
        inside: !!r && r.left >= 0 && r.right <= innerWidth,
        pager: document.querySelector('.pager .lbl')?.textContent.replace(/\s+/g, ' ').trim(),
      }
    })
  const one = await bar()
  check('スマホ：下の道具は、並べ方4つの横に「ページを足す」「ページを消す」（1ページだけなら消せない）。道具は画面の幅に入る', one.lays.join() === '1枚,2枚左右,2枚上下,4枚' && one.tools.join() === 'ページを足す:false,ページを消す:true' && one.inside, JSON.stringify(one))
  await tool(page, '.sel-bar', 'ページを足す')
  await page.waitForFunction(() => window.__editor.getSnapshot().report.workPhotos.length === 2 && window.__editor.getSnapshot().photoPage === 1, { timeout: 30000 })
  await ready()
  await pause(500)
  const two = await bar()
  check('スマホ：「ページを足す」で2ページ目ができて出る。ページ送りは「作品写真 2 10 / 10」', two.pager === '作品写真 2 10 / 10' && two.tools.join() === 'ページを足す:false,ページを消す:false', JSON.stringify(two))
  // 写しの画面：2ページ目（2枚・上下）
  await page.evaluate(() =>
    window.__editor.update((r) => ({ ...r, workPhotos: [r.workPhotos[0], { layout: 2, columns: 1, imageIds: ['g-satin', 'g-chiffon'] }] })),
  )
  await pause(500)
  await ready()
  await showPhotoPage(page, ready, 1)
  await page.screenshot({ path: `${OUT}/phone-two-photo-pages.png` })
  // チェックの欄の「まだのところ」
  await page.evaluate(() => document.querySelector('.nav-check').click())
  await page.waitForSelector('.sheet .sheet-body', { timeout: 30000 })
  await pause(500)
  const row = await photoRow('.sheet')(page)
  await page.screenshot({ path: `${OUT}/phone-check.png` })
  check('スマホ：「チェック」の欄の「まだのところ」は「6枚（2ページ）」', row === '6枚（2ページ）', row)
  await page.evaluate(() => document.querySelector('.sheet .sheet-close, .sheet .close')?.click())
  await pause(400)
  // 消す → 戻す
  await tool(page, '.sel-bar', 'ページを消す')
  await page.waitForFunction(() => window.__editor.getSnapshot().report.workPhotos.length === 1, { timeout: 30000 })
  await ready()
  await pause(500)
  const toast = await page.evaluate(() => document.querySelector('.undo-toast')?.textContent ?? '')
  check('スマホ：「ページを消す」で、そのページが写真ごと消え、「作品写真のページを消しました（写真2枚も）［戻す］」が出る', toast.startsWith('作品写真のページを消しました（写真2枚も）') && toast.includes('戻す'), toast)
  await context.close()
}
