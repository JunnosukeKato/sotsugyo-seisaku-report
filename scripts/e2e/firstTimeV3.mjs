// はじめて使う学生の試し（3回目：Word から移す学生・パソコン・スマホ）で見つかったことの直しを確かめる（Edge を自動で操作する）。
// smoke.mjs（パソコン）と phone.mjs（スマホ）から呼ぶ。画面の写真は poc-output/v3-fix/word/ に置く。
// - 控えに戻すと、コースも変わるとき：確かめる文で知らせる。「下書きを入れ替える」の前の控えには名前を付ける
// - Word の表紙のコース：いまのコースと違えば、確認の窓で赤く知らせ、どちらにするかを選ぶ。サブタイトルが決まった形と違うときも赤で知らせる
// - Word を選び直したとき、読めない形のファイルなら、その名前を出し、前のファイルは外す
// - 1行の欄に2行を貼り付けたら1行目だけ。氏名に数字・「学籍番号」、表紙の欄からはみ出す、はエラー
// - 表を貼り付けた・「。」を自動で付けた・引用・参考文献を反映した、を画面の下に知らせる
// - PDF の窓に、要確認も一覧で出す。作品写真がまだないときの PDF に、空の作品写真のページを入れない
// - 作品写真：まとめて選べる。入らない枚数と、隠れた写真を知らせる
// - 「バックアップ・作り直す」（mockups/v34 案A）
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { stubConfig } from './configStub.mjs'
import { makeDocx, table } from './fixtures/docx.mjs'
import { setupWriting } from './sampleReport.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/v3-fix/word'
mkdirSync(OUT, { recursive: true })
const pause = (ms = 400) => new Promise((r) => setTimeout(r, ms))
const FILM = '映画・舞台衣装デザイナー'
const STYLIST = 'スタイリスト・コーディネーター'

/** 確かめている途中に src/ が直されても、画面が入れ替わらないようにする（smoke.mjs と同じ） */
const noHotReload = (page) =>
  page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
  })

/**
 * まっさらな入れ物で開く（指差し確認は見たことにする）。phone：スマホの大きさ・タッチ。
 * 前の確かめで入れ物を閉じた直後は、開くのに失敗することがある（Navigating frame was detached）。そのときは、入れ物から作り直して1回だけやり直す
 */
async function openPage(browser, options = {}, retry = true) {
  try {
    return await openPageOnce(browser, options)
  } catch (e) {
    if (!retry) throw e
    console.log('（開き直します：', e instanceof Error ? e.message : String(e), '）')
    await pause(1000)
    return openPage(browser, options, false)
  }
}

async function openPageOnce(browser, { phone = false, downloads } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await noHotReload(page)
  await stubConfig(page)
  page.on('pageerror', (e) => console.log('pageerror(v3):', e.message))
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  })
  if (downloads) await (await page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: resolve(downloads), browserContextId: context.id })
  if (phone) {
    await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36')
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  } else {
    await page.setViewport({ width: 1440, height: 900 })
  }
  try {
    await page.goto(`${APP}/?nodrive&direct=0`, { waitUntil: 'networkidle0' })
  } catch (e) {
    await context.close().catch(() => {})
    throw e
  }
  const ready = () =>
    page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 60000 })
  await ready()
  return { context, page, ready }
}

/** はじめての案内：最初のコース（映画・舞台衣装デザイナー）を選び、Word は「いいえ」、学籍番号は「あとで」 */
async function skipGuide(page, ready) {
  await page.waitForSelector('.guide.step-course .g-opts button')
  await page.evaluate(() => document.querySelector('.g-opts button').click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.g-later')
  await page.evaluate(() => document.querySelector('.g-later').click())
  await page.evaluate(() => window.__editor.finishEditing())
  await ready()
}

/** 紙面のブロックを押す（そのページを表示してから） */
const clicker = (page, ready) => async (id) => {
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), id)
  await ready()
  const box = await page.evaluate((id) => {
    const el = [...document.querySelectorAll(`.page-viewport.front [data-block-id="${id}"]`)].find((e) => e.getBoundingClientRect().width > 0)
    const r = el.getBoundingClientRect()
    return { x: r.left + Math.min(r.width / 2, 40), y: r.top + r.height / 2 }
  }, id)
  await page.mouse.click(box.x, box.y)
}

/** 書く欄に貼り付ける（クリップボードの中身：text/plain と、あれば text/html） */
const paste = (page, plain, html) =>
  page.evaluate(
    (plain, html) => {
      const el = document.querySelector('.overlay-editor')
      const dt = new DataTransfer()
      dt.setData('text/plain', plain)
      if (html) dt.setData('text/html', html)
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    },
    plain,
    html,
  )

/** 画面の下の知らせ（出ていなければ空） */
/** 右の欄の「≡ メニュー」を開いて、項目を押す（mockups/v37 案C。「？ 使い方」「バックアップ・作り直す」はこの中）。name：項目の名前の一部 */
const pickMenu = async (page, name) => {
  if (!(await page.$('.side .head-menu'))) await page.click('.side .menu-btn')
  await page.waitForSelector('.side .head-menu [role="menuitem"]')
  await page.evaluate((name) => [...document.querySelectorAll('.side .head-menu [role="menuitem"]')].find((b) => b.textContent.includes(name)).click(), name)
}
const toastText = (page) => page.evaluate(() => document.querySelector('.undo-area .undo-toast')?.textContent ?? '')

/** 保存された PDF を待って、ページの数を返す（smoke.mjs と同じ数え方） */
async function savedPdf(dir, name) {
  for (let i = 0; i < 80 && !existsSync(`${dir}/${name}`); i++) await pause(250)
  if (!existsSync(`${dir}/${name}`)) return { files: readdirSync(dir), pages: 0 }
  const text = readFileSync(`${dir}/${name}`, 'latin1')
  return { pages: (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length, head: text.slice(0, 5) }
}

/** 色のついた PNG を、決まった場所に書き出す（写真を選ぶ画面で選ぶため） */
async function makePngs(page, count) {
  const paths = []
  for (let i = 0; i < count; i++) {
    const b64 = await page.evaluate(async (i) => {
      const c = new OffscreenCanvas(400, 300)
      const g = c.getContext('2d')
      g.fillStyle = `hsl(${i * 50}, 45%, 55%)`
      g.fillRect(0, 0, 400, 300)
      const blob = await c.convertToBlob({ type: 'image/png' })
      return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())))
    }, i)
    const path = join(tmpdir(), `sotsugyo-e2e-v3-photo${i + 1}.png`)
    writeFileSync(path, Buffer.from(b64, 'base64'))
    paths.push(path)
  }
  return paths
}

/** 確認の窓（confirm）を受け、文を返す */
const acceptNextDialog = (page) =>
  new Promise((resolveMessage) =>
    page.once('dialog', async (d) => {
      const message = d.message()
      await d.accept()
      resolveMessage(message)
    }),
  )

// =====================================================================
// パソコン
// =====================================================================
export async function firstTimeV3Pc(browser, check) {
  const downloads = `${OUT}/downloads`
  rmSync(downloads, { recursive: true, force: true })
  mkdirSync(downloads, { recursive: true })
  const { context, page, ready } = await openPage(browser, { downloads })
  const clickBlock = clicker(page, ready)
  const snap = () =>
    page.evaluate(() => {
      const s = window.__editor.getSnapshot()
      return { report: s.report, findings: s.findings.map((f) => ({ ruleId: f.ruleId, severity: f.severity, blockId: f.blockId, title: f.title, area: f.area })), page: s.page, kinds: s.layout?.kinds ?? [], noticeId: s.notice?.id ?? null }
    })
  await skipGuide(page, ready)
  await page.evaluate(setupWriting)
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, studentId: '00ZZ0123' } })))
  await pause(800)
  await ready()

  // ---- 「バックアップ・作り直す」（mockups/v34 案A。v37 案C から、右の欄の「≡ メニュー」の中） ----
  await page.click('.side .menu-btn')
  await page.waitForSelector('.side .head-menu')
  const side = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.side .head-menu [role="menuitem"]')]
    const b = items.find((x) => x.textContent.includes('バックアップ'))
    const cs = b && getComputedStyle(b)
    // 上下の余白を除いた高さが、1行分
    return { names: items.map((x) => x.textContent.trim()), oneLine: !!b && b.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) < parseFloat(cs.lineHeight) * 1.5 }
  })
  await page.click('.side .menu-btn')
  check(
    '右の欄の「メニュー」の中に「バックアップ・作り直す」がある（いちばん上は「使い方」。1行に入る）',
    side.names[0] === '使い方' && side.names[1] === 'バックアップ・作り直す' && side.oneLine,
    JSON.stringify(side),
  )
  // 自動の控えを3つにする（10分ごとの控えと同じもの）
  await page.evaluate(async () => {
    await new Promise((res, rej) => {
      const req = indexedDB.open('sotsugyo-seisaku-report')
      req.onsuccess = () => {
        const tx = req.result.transaction('snapshots', 'readwrite')
        tx.objectStore('snapshots').clear()
        tx.oncomplete = () => {
          req.result.close()
          res()
        }
        tx.onerror = rej
      }
      req.onerror = rej
    })
    const { saveSnapshot } = await window.__import('model/storage.ts')
    const r = window.__editor.getSnapshot().report
    for (const at of ['2026-10-17T07:50:00.000Z', '2026-10-18T05:30:00.000Z', '2026-10-18T12:32:53.000Z']) await saveSnapshot(r, at)
  })
  await pickMenu(page, 'バックアップ')
  await page.waitForSelector('.modal .snapshots li')
  await page.evaluate(() => document.activeElement?.blur())
  await pause(300)
  const dlg = await page.evaluate(() => {
    const m = document.querySelector('.modal')
    const list = m.querySelector('.snapshots')
    const sec = m.querySelector('.start-over')
    const close = [...m.querySelectorAll('.close-row button')].find((b) => b.textContent === '閉じる')
    const again = sec?.querySelector('button.danger')
    return {
      title: m.querySelector('h2')?.textContent,
      rows: list.querySelectorAll('li').length,
      scroll: list.scrollHeight > list.clientHeight,
      after: !!sec && !!(list.compareDocumentPosition(sec) & Node.DOCUMENT_POSITION_FOLLOWING),
      line: sec?.querySelector('p')?.textContent,
      button: again?.textContent,
      icon: !!again?.querySelector('svg'),
      closeBelow: !!close && !!again && close.getBoundingClientRect().top >= again.getBoundingClientRect().bottom,
    }
  })
  await page.screenshot({ path: `${OUT}/12-backup-dialog.png` })
  check(
    '窓の名前も「バックアップ・作り直す」。「最初から作り直す」は自動の控えの下に区切って出し、「いまの原稿は自動の控えに残ります」と書く。「閉じる」はその下の行',
    dlg.title === 'バックアップ・作り直す' && dlg.after && dlg.line === 'いまの原稿は自動の控えに残ります' && dlg.button === '最初から作り直す' && dlg.icon && dlg.closeBelow,
    JSON.stringify(dlg),
  )
  check('自動の控えが3つのときは、一覧に上下に動かす棒が出ない', dlg.rows === 3 && !dlg.scroll, JSON.stringify({ rows: dlg.rows, scroll: dlg.scroll }))
  await page.evaluate(() => [...document.querySelectorAll('.modal .close-row button')].find((b) => b.textContent === '閉じる').click())
  await pause(300)

  // ---- コースを変えて「下書きを入れ替える」→「この時点に戻す」：コースも戻ることを、確かめる文で知らせる ----
  await clickBlock('basic:course')
  await page.waitForSelector('.popover button')
  await page.evaluate((name) => [...document.querySelectorAll('.popover button')].find((b) => b.textContent.includes(name)).click(), STYLIST)
  await page.waitForSelector('.modal .course-replace')
  await page.click('.modal .course-replace')
  await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 10000 })
  await ready()
  const replaced = await snap()
  await pickMenu(page, 'バックアップ')
  await page.waitForSelector('.modal .snapshots li')
  const newest = await page.evaluate(() => document.querySelector('.modal .snapshots li span')?.textContent ?? '')
  await page.screenshot({ path: `${OUT}/01-replace-snapshot.png` })
  check('「下書きを入れ替える」の前の控えには、「下書きを入れ替える前」と名前が付く（いちばん上）', newest.includes('（下書きを入れ替える前）'), newest)
  const asked = acceptNextDialog(page)
  await page.evaluate(() => [...document.querySelectorAll('.modal .snapshots li')].find((li) => li.textContent.includes('下書きを入れ替える前')).querySelector('button').click())
  const restoreMessage = await asked
  await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 10000 })
  await ready()
  const restored = await snap()
  check(
    '控えのコースが今と違うとき、「この時点に戻す」の確かめる文に「コースも「…」に戻ります」と出て、戻すとコースも戻る',
    restoreMessage.includes(`コースも「${FILM}」に戻ります`) && replaced.report.basicInfo.courseId !== 'film-stage-costume' && restored.report.basicInfo.courseId === 'film-stage-costume' && restored.report.body.some((c) => c.id === 'c2'),
    JSON.stringify({ restoreMessage, before: replaced.report.basicInfo.courseId, after: restored.report.basicInfo.courseId }),
  )
  // 同じコースの控え（はじめに残した、いちばん下の控え）なら、コースのことは書かない
  await pickMenu(page, 'バックアップ')
  await page.waitForSelector('.modal .snapshots li')
  const sameAsked = new Promise((r) => page.once('dialog', async (d) => { r(d.message()); await d.dismiss() }))
  await page.evaluate(() => document.querySelector('.modal .snapshots li:last-child button').click())
  const sameMessage = await sameAsked
  check('同じコースの控えに戻すときは、コースのことは書かない', !sameMessage.includes('コース'), sameMessage)
  await page.evaluate(() => [...document.querySelectorAll('.modal .close-row button')].find((b) => b.textContent === '閉じる').click())
  await pause(300)

  // ---- 1行の欄（氏名）に2行を貼り付けると、1行目だけが入り、画面の下に知らせる ----
  await clickBlock('basic:name')
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'basic:name', { timeout: 30000 })
  await page.keyboard.down('Control')
  await page.keyboard.press('a')
  await page.keyboard.up('Control')
  await paste(page, '文化　花子\r\n学籍番号　00ZZ0123')
  await pause(300)
  const pastedToast = await toastText(page)
  await page.screenshot({ path: `${OUT}/03-paste-name.png` })
  await page.keyboard.press('Enter')
  await ready()
  const afterPaste = await snap()
  check(
    '氏名の欄に2行を貼り付けると、1行目（文化　花子）だけが入り、「この欄は1行なので、1行目だけを貼り付けました」と出る',
    afterPaste.report.basicInfo.name === '文化　花子' && pastedToast === 'この欄は1行なので、1行目だけを貼り付けました',
    JSON.stringify({ name: afterPaste.report.basicInfo.name, pastedToast }),
  )
  // つながって入ってしまった氏名（前の動き）は、エラーになる：数字・「学籍番号」と、表紙の欄からはみ出す
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, name: '文化　花子学籍番号　00ZZ0123' } })))
  await pause(600)
  await ready()
  await page.evaluate(() => window.__editor.goToPage(0, 'none'))
  await ready()
  const polluted = await snap()
  await page.screenshot({ path: `${OUT}/03-name-overflow-errors.png` })
  const nameErrors = polluted.findings.filter((f) => f.blockId === 'basic:name' && f.severity === 'error').map((f) => f.ruleId)
  check(
    '氏名に「学籍番号」や数字が入っている・表紙の欄からはみ出す、はエラーになる（直すところに残る）',
    nameErrors.includes('name-text') && nameErrors.includes('cover-field-fit'),
    JSON.stringify(nameErrors),
  )
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, studentId: '00ZZ0123-0123456789' } })))
  await pause(600)
  await ready()
  const longId = await snap()
  check('学籍番号が表紙の欄からはみ出すときも、エラーになる', longId.findings.some((f) => f.ruleId === 'cover-field-fit' && f.blockId === 'basic:studentId'), JSON.stringify(longId.findings.filter((f) => f.area === 'cover')))
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, studentId: '00ZZ0123', name: '文化　花子' } })))
  await pause(600)
  await ready()
  const fixedName = await snap()
  check('氏名・学籍番号を直すと、そのエラーは消える', !fixedName.findings.some((f) => ['name-text', 'cover-field-fit'].includes(f.ruleId)))

  // ---- Word の表を段落に貼り付けると、文になったことを知らせる（文はそのまま入る） ----
  await clickBlock('p13')
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p13', { timeout: 30000 })
  await page.keyboard.press('End')
  await paste(page, '素材\t用途\r\nサテン\t袖', '<html><body><table><tr><td>素材</td><td>用途</td></tr><tr><td>サテン</td><td>袖</td></tr></table></body></html>')
  await pause(300)
  const tableToast = await toastText(page)
  await page.screenshot({ path: `${OUT}/06-paste-table.png` })
  // 貼り付けた段落は、組み直したあとに書く欄が開き直す。開き直してから閉じる
  await page.waitForFunction(() => !!window.__editor.getSnapshot().editingId, { timeout: 30000 }).catch(() => {})
  await page.keyboard.press('Escape')
  await ready()
  const afterTable = await snap()
  const bodyText = JSON.stringify(afterTable.report.body)
  check(
    '表を貼り付けると、文として入り、「表は「表を入れる」で作ります（貼り付けた表は文になりました）」と出る',
    tableToast === '表は「表を入れる」で作ります（貼り付けた表は文になりました）' && bodyText.includes('サテン'),
    tableToast,
  )
  await page.evaluate(() => window.__editor.undo())
  await ready()

  // ---- 「。」を付けずに Enter：はじめての1回だけ、「。」を付けたことを知らせる ----
  const enterWithoutPeriod = async () => {
    await clickBlock('p16')
    await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p16', { timeout: 30000 })
    await page.keyboard.press('End')
    await page.keyboard.type('次に生かす')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => { const e = window.__editor.getSnapshot().editingId; return e && e !== 'p16' }, { timeout: 30000 })
    await pause(300)
  }
  await enterWithoutPeriod()
  const periodToast = await toastText(page)
  const periodId = (await snap()).noticeId
  await page.screenshot({ path: `${OUT}/07-auto-period.png` })
  await page.keyboard.press('Backspace')
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p16', { timeout: 30000 })
  await page.keyboard.press('Escape')
  await ready()
  await enterWithoutPeriod()
  const secondId = (await snap()).noticeId
  await page.keyboard.press('Backspace')
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p16', { timeout: 30000 })
  await page.keyboard.press('Escape')
  await ready()
  check(
    'はじめて「。」を自動で付けたとき、「段落の終わりに「。」を付けました（すぐ Backspace で取り消せます）」と出る（2回目からは出さない）',
    periodToast === '段落の終わりに「。」を付けました（すぐ Backspace で取り消せます）' && secondId === periodId,
    JSON.stringify({ periodToast, periodId, secondId }),
  )
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === 'p16' && b.type === 'paragraph' ? { ...b, content: [{ type: 'text', text: '制作を通して、舞台衣装は客席からの見え方と演者の動きやすさの両方を考える必要があることを学んだ。この経験を、今後の衣装制作に生かしたい。' }] } : b)) })) })))
  await ready()

  // ---- 引用・参考文献の「反映する」：そのページへ移り、「引用・参考文献を反映しました」と出る ----
  // 引用・参考文献は、使い方の「引用・参考文献」の「引用・参考文献を入れる」から入れる（右の欄からは外した。mockups/v35 ①）
  await pickMenu(page, '使い方')
  await page.waitForSelector('.help-list button[data-topic="references"]')
  await page.click('.help-list button[data-topic="references"]')
  await page.waitForSelector('.help-topic .help-refs')
  await page.click('.help-topic .help-refs')
  await page.waitForSelector('.modal .refs')
  await page.evaluate(() => [...document.querySelectorAll('.modal .row-buttons button')].find((b) => b.textContent.includes('書籍を追加')).click())
  await page.waitForSelector('.modal .ref-card')
  const fields = await page.$$('.modal .ref-card .field input')
  const values = ['浜松隆志', 'ドイツ衣装史', '文化出版局', '1998']
  for (let i = 0; i < values.length; i++) await fields[i].type(values[i])
  await page.evaluate(() => [...document.querySelectorAll('.modal .row-buttons button')].find((b) => b.textContent === '反映する').click())
  await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 10000 })
  await page.waitForFunction(() => { const s = window.__editor.getSnapshot(); return s.layout?.kinds[s.page] === 'references' && !s.turning }, { timeout: 20000 }).catch(() => {})
  await pause(300)
  const refs = await snap()
  const refsToast = await toastText(page)
  await page.screenshot({ path: `${OUT}/08-references-reflected.png` })
  check(
    '引用・参考文献の「反映する」で、引用・参考文献のページへ移り、「引用・参考文献を反映しました」と出る',
    refs.kinds[refs.page] === 'references' && refsToast === '引用・参考文献を反映しました' && refs.report.references.length === 1,
    JSON.stringify({ kind: refs.kinds[refs.page], refsToast }),
  )
  // PC は使い方を開いたまま窓を開いたので、閉じて右の欄に戻る
  await page.click('.help-close')
  await page.waitForSelector('.side .sec.check')

  // ---- PDF の窓：要確認も、直すところの一覧で出す（多いときは5件と「ほか◯件」） ----
  // 説明のない空の段落（要確認の「空の段落がある」。直すところ）を7つ作る
  await page.evaluate(() =>
    window.__editor.update((r) => ({
      ...r,
      body: r.body.map((c) => (c.id === 'c3' ? { ...c, blocks: [...c.blocks, ...Array.from({ length: 7 }, (_, i) => ({ type: 'paragraph', id: `w${i}`, content: [{ type: 'text', text: '' }] }))] } : c)),
    })),
  )
  await pause(800)
  await ready()
  const warnState = await snap()
  const errorsNow = warnState.findings.filter((f) => f.severity === 'error')
  // 右の欄と同じ分け方の、直すところ（app/checkSummary.ts）
  const fixesNow = await page.evaluate(async () => {
    const { checkSummary } = await window.__import('app/checkSummary.ts')
    const ed = window.__editor
    return checkSummary(ed.getSnapshot(), ed.config).fixes.filter((f) => f.severity !== 'error').length
  })
  await page.click('.side .export')
  await page.waitForSelector('.modal .pdf-left .fix-list', { timeout: 60000 })
  const listed = await page.evaluate(() => ({
    items: [...document.querySelectorAll('.modal .fix-list li')].map((li) => li.textContent),
    links: document.querySelectorAll('.modal .fix-list li:not(.more) button.link').length,
  }))
  await page.screenshot({ path: `${OUT}/09-pdf-warnings.png` })
  await page.evaluate(() => document.querySelector('.modal .fix-list .more button').click())
  await pause(200)
  const expanded = await page.evaluate(() => document.querySelectorAll('.modal .fix-list li').length)
  check(
    'PDF の窓に、要確認もエラーと同じ形の一覧（直すところ。「（要確認」を付ける）で出す（はじめは5件と「ほか◯件」。押すとすべて）',
    errorsNow.length === 0 && fixesNow >= 7 && listed.links === 5 && listed.items[5] === `ほか${fixesNow - 5}件` && expanded === fixesNow && listed.items.slice(0, 5).every((t) => t.includes('（要確認')),
    JSON.stringify({ errors: errorsNow.map((f) => f.title), fixesNow, listed, expanded }),
  )
  await page.click('.modal .close')
  await pause(300)
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.filter((b) => !/^w\d$/.test(b.id)) })) })))
  await pause(600)
  await ready()

  // ---- 作品写真：まとめて選べる。枠より多く選ぶと、ページを足して全部入れる（mockups/v38 ③）。隠れた写真・ページ数の上限を知らせる ----
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, workPhotos: [{ layout: 2, columns: 2, imageIds: [] }] })))
  await pause(600)
  await ready()
  await page.evaluate(() => window.__editor.goToArea('photos'))
  await ready()
  await pause(300)
  const pngs = await makePngs(page, 5)
  /** k ページ目（0 から）の作品写真の i 枚目の枠を押して、写真を選ぶ画面を開く */
  const clickSlot = async (k, i) => {
    const at = await page.evaluate((k, i) => { const r = document.querySelector(`.page-viewport.front section.photos[data-photo-page="${k}"] [data-photo-slot="${i}"]`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }, k, i)
    const [chooser] = await Promise.all([page.waitForFileChooser(), page.mouse.click(at.x, at.y)])
    return chooser
  }
  const counts = () => page.evaluate(() => window.__editor.getSnapshot().report.workPhotos.map((p) => p.imageIds.filter(Boolean).length).join())
  let chooser = await clickSlot(0, 0)
  const multiple = chooser.isMultiple()
  await chooser.accept(pngs.slice(0, 3))
  await page.waitForFunction(() => window.__editor.getSnapshot().report.workPhotos.length === 2, { timeout: 20000 })
  await pause(300)
  const twoToast = await toastText(page)
  const placed = await counts()
  await ready()
  await page.screenshot({ path: `${OUT}/11-photos-two-frames.png` })
  check(
    '作品写真の空いている枠を押すと、写真をまとめて選べ、空いている枠に順に入る（枠より多いと、同じ並べ方のページを足して全部入れ、そのことを知らせる）',
    multiple && placed === '2,1' && twoToast === '作品写真のページを1つ足して、1枚入れました',
    JSON.stringify({ multiple, placed, twoToast }),
  )
  // 学科の設定でページ数の上限があるとき（2ページ）：上限のページまで入れ、入れなかった枚数とわけを知らせる。「＋ 写真のページを足す」は押せない
  // 年度の設定を入れ替える（ツールの setConfig。ページ数の上限だけ変える）
  await page.evaluate(() => {
    const ed = window.__editor
    ed.setConfig({ ...ed.config, workPhotos: { maxPages: 2 } })
  })
  await ready()
  await page.evaluate(() => {
    const ed = window.__editor
    const kinds = ed.getSnapshot().layout.kinds
    void ed.goToPage(kinds.lastIndexOf('photos'), 'none')
  })
  await ready()
  await pause(300)
  chooser = await clickSlot(1, 1)
  await chooser.accept(pngs.slice(0, 3))
  await page.waitForFunction(() => window.__editor.getSnapshot().report.workPhotos[1].imageIds.filter(Boolean).length === 2, { timeout: 20000 })
  await pause(300)
  const limitToast = await toastText(page)
  const addButton = await page.evaluate(() => { const b = [...document.querySelectorAll('.palette .photo-pages .tb')].find((x) => x.textContent.includes('足す')); return { disabled: b?.disabled, title: b?.title } })
  await ready()
  check(
    'ページ数の上限（学科の設定。この確かめでは2ページ）があるときは、上限のページまで入れて「2枚は入れていません（作品写真は2ページまでです）」と出す。「＋ 写真のページを足す」は押せない',
    (await counts()) === '2,2' && limitToast === '2枚は入れていません（作品写真は2ページまでです）' && addButton.disabled === true && addButton.title === '作品写真は2ページまでです',
    JSON.stringify({ counts: await counts(), limitToast, addButton }),
  )
  await page.evaluate(() => {
    const ed = window.__editor
    ed.setConfig({ ...ed.config, workPhotos: { maxPages: null } })
  })
  await ready()
  await page.evaluate(() => [...document.querySelectorAll('.palette .lay')].find((b) => b.title.startsWith('1枚')).click())
  await pause(300)
  const hiddenToast = await toastText(page)
  await ready()
  await page.screenshot({ path: `${OUT}/11-photos-hidden.png` })
  check('写真より枠の少ない並べ方にすると「2枚目からは隠れています（並べ方を戻すと出ます）」と出る', hiddenToast === '2枚目からは隠れています（並べ方を戻すと出ます）', hiddenToast)

  // ---- 作品写真がまだないときの PDF には、空の作品写真のページを入れない（前は下書きの PDF だけの決まり） ----
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, workPhotos: [{ layout: 1, imageIds: [] }] })))
  await pause(600)
  await ready()
  const pages = await page.evaluate(() => {
    const ed = window.__editor
    const kinds = ed.getSnapshot().layout.kinds
    const printed = ed.pageElements().filter((p) => !p.classList.contains('print-skip'))
    return { all: printed.length, photos: kinds.filter((k) => k === 'photos').length, title: ed.pdfTitle }
  })
  rmSync(`${downloads}/${pages.title}.pdf`, { force: true })
  await page.click('.side .export')
  await page.waitForSelector('.modal .pdf-start', { timeout: 60000 })
  await page.click('.modal .pdf-start')
  await page.waitForSelector('.modal .pdf-progress span')
  const total = await page.evaluate(() => Number(document.querySelector('.modal .pdf-progress span').textContent.split('/')[1].replace(/\D/g, '')))
  await page.waitForSelector('.modal .pdf-open', { timeout: 120000 })
  const made = await savedPdf(downloads, `${pages.title}.pdf`)
  await page.screenshot({ path: `${OUT}/10-no-photo-page.png` })
  check(
    '作品写真がまだないときの PDF には、空の作品写真のページを入れない',
    pages.photos === 1 && total === pages.all - 1 && made.head === '%PDF-' && made.pages === pages.all - 1,
    JSON.stringify({ pages, total, made }),
  )
  await page.click('.modal .close')
  await context.close()
}

// =====================================================================
// Word から読み込む（表紙のコース・サブタイトルの形・選び直したファイル）
// =====================================================================
export async function firstTimeV3Word(browser, check) {
  const FIX = 'scripts/e2e/fixtures'
  const bodyDocx = `${FIX}/word-sample-body.docx`
  const pdf = `${FIX}/word-sample-body.pdf`
  // 表紙：コースは「スタイリスト・コーディネーター」、サブタイトルはコースの決まった形（―〇〇の衣装制作―）と違う
  const coverDocx = join(tmpdir(), '卒制_表紙_スタイリスト.docx')
  writeFileSync(
    coverDocx,
    makeDocx({
      body: table([
        ['２０２６年度'],
        ['卒 業 研 究'],
        ['', '研究題目', ''],
        ['', '卒業イベント「シンドバッド」について', ''],
        ['', '―主人公のスタイリング提案―', ''],
        ['', '国際文化学部・国際ファッション文化学科', ''],
        ['', STYLIST, 'コース'],
        ['', '学籍番号　', '00ZZ0123'],
        ['', '氏　　名', '：', '文化　花子'],
      ]),
    }),
  )
  const { context, page, ready } = await openPage(browser)
  const choose = async (row, path) => {
    const [chooser] = await Promise.all([page.waitForFileChooser(), page.evaluate((row) => document.querySelectorAll('.word-file .acts button:not(.link)')[row].click(), row)])
    await chooser.accept([path])
    await pause(200)
  }
  const clickButton = (sel, text) => page.evaluate((sel, text) => [...document.querySelectorAll(sel)].find((b) => b.textContent.includes(text)).click(), sel, text)
  await page.waitForSelector('.guide.step-course .g-opts button')
  await page.evaluate(() => document.querySelector('.g-opts button').click())
  await page.waitForSelector('.guide.step-word .g-word-opt.yes')
  await ready()
  await page.evaluate(() => document.querySelector('.g-word-opt.yes').click())
  await page.waitForSelector('.modal.word-mid')

  // ---- 読める .docx を選んだあとに PDF を選び直す：PDF の名前と理由を出し、前の .docx は外す ----
  await choose(0, bodyDocx)
  const first = await page.evaluate(() => ({ chosen: document.querySelector('.word-file small.chosen')?.textContent ?? '', check: !!document.querySelector('.word-file small.chosen i') }))
  await choose(0, pdf)
  const second = await page.evaluate(() => {
    const row = document.querySelector('.word-file')
    return {
      chosen: row.querySelector('small.chosen')?.textContent ?? '',
      check: !!row.querySelector('small.chosen i'),
      error: row.querySelector('small.err')?.textContent ?? '',
      disabled: [...document.querySelectorAll('.modal .row-buttons button')].find((b) => b.textContent.includes('中身を確かめる'))?.disabled,
      button: row.querySelector('.acts button')?.textContent,
    }
  })
  await page.screenshot({ path: `${OUT}/05-reselect-pdf.png` })
  check(
    '読める Word を選んだあとに PDF を選び直すと、PDF の名前（✓ なし）と理由を出し、前の Word は外す（「中身を確かめる」は押せない）',
    first.check && first.chosen.includes('word-sample-body.docx') && second.chosen.includes('word-sample-body.pdf') && !second.check && second.error.includes('.docx') && second.disabled === true && second.button === '選び直す',
    JSON.stringify({ first, second }),
  )

  // ---- 表紙の Word のコースが違う：赤で知らせ、どちらにするかを選ぶまで「読み込む」は押せない ----
  await choose(0, bodyDocx)
  await choose(1, coverDocx)
  await clickButton('.modal .row-buttons button', '中身を確かめる')
  await page.waitForSelector('.modal.word-modal, .word-error', { timeout: 60000 })
  const readError = await page.evaluate(() => document.querySelector('.word-error')?.textContent ?? '')
  if (readError) {
    check('表紙のコースが違う Word を読み取れる', false, readError)
    await context.close()
    return
  }
  await pause(300)
  const importButton = () => page.evaluate(() => [...document.querySelectorAll('.modal .row-buttons button')].find((b) => b.textContent.includes('読み込む'))?.disabled)
  const mismatch = await page.evaluate(() => ({
    box: document.querySelector('.word-course')?.textContent ?? '',
    radios: document.querySelectorAll('.word-course input[type="radio"]').length,
    checked: document.querySelectorAll('.word-course input:checked').length,
    course: [...document.querySelectorAll('.word-cover > div')].map((d) => ({ dt: d.querySelector('dt')?.textContent, dd: d.querySelector('dd')?.textContent, ng: d.querySelector('dd')?.classList.contains('ng') })),
    subOff: document.querySelector('.word-sub-off')?.textContent ?? '',
    color: getComputedStyle(document.querySelector('.word-course > b')).color,
  }))
  const disabledBefore = await importButton()
  await page.screenshot({ path: `${OUT}/02-course-mismatch.png` })
  const courseRow = mismatch.course.find((c) => c.dt === 'コース')
  check(
    '表紙の Word のコースが違うと、確認の窓に赤で出し（表紙の欄のコースも赤）、「Word のコースにする」「いまのコースのまま」を選ぶまで「読み込む」は押せない',
    mismatch.box.includes(STYLIST) && mismatch.box.includes(FILM) && mismatch.radios === 2 && mismatch.checked === 0 && courseRow?.ng && courseRow.dd.includes(STYLIST) && disabledBefore === true && mismatch.color === 'rgb(181, 68, 59)',
    JSON.stringify({ ...mismatch, disabledBefore }),
  )
  check(
    'サブタイトルがコースの決まった形と違うと、表紙にどう出るかを赤で知らせ、読み込んだあとで直すように書く（決まった文句を二重にしない）',
    mismatch.subOff.includes('―主人公のスタイリング提案―') && mismatch.subOff.includes('表紙には「―主人公のスタイリング提案の衣装制作―」と出ます') && mismatch.subOff.includes('直して') && mismatch.course.find((c) => c.dt === 'サブタイトル')?.ng,
    mismatch.subOff,
  )
  // 「Word のコースにする」：そのコースで読み取り直してから、「読み込む」を押せる
  await page.evaluate(() => document.querySelectorAll('.word-course input[type="radio"]')[0].click())
  await page.waitForFunction(() => !document.querySelector('.word-status .busy'), { timeout: 60000 })
  await pause(300)
  const disabledAfter = await importButton()
  const keepText = await page.evaluate(() => document.querySelector('.word-keep')?.textContent ?? '')
  check('「Word のコースにする」を選ぶと「読み込む」を押せる（コースも Word のものになると書く）', disabledAfter === false && keepText.includes('サブタイトル・コースも Word のもの'), JSON.stringify({ disabledAfter, keepText }))
  await clickButton('.modal .row-buttons button', '読み込む')
  await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 60000 })
  await pause(500)
  await ready()
  const after = await page.evaluate(() => {
    const s = window.__editor.getSnapshot()
    return { basicInfo: s.report.basicInfo, chapters: s.report.body.map((c) => c.title), guide: document.querySelector('.guide')?.className ?? null }
  })
  const stylistId = await page.evaluate((name) => window.__editor.config.courses.find((c) => c.name === name)?.id, STYLIST)
  check(
    '読み込むと、コースが表紙の Word のコース（スタイリスト・コーディネーター）になり、本文は Word の中身になる',
    after.basicInfo.courseId === stylistId && after.basicInfo.name === '文化　花子' && after.basicInfo.subtitleInput === '主人公のスタイリング提案' && after.chapters[0] === '企画・立案',
    JSON.stringify(after),
  )
  if (after.guide) {
    await page.evaluate(() => document.querySelector('.g-later')?.click())
    await ready()
  }

  // ---- 「つぎにすること」の「表紙を確かめる」：表紙を開いただけでは済みにせず、「確かめた」を押して済みにする ----
  await page.evaluate(() => window.__editor.goToPage(2, 'none'))
  await ready()
  await page.evaluate(() => window.__editor.goToPage(0, 'none'))
  await pause(300)
  await ready()
  const coverItem = () =>
    page.evaluate(() => {
      const li = [...document.querySelectorAll('.side .word-todo li')].find((x) => x.textContent.includes('表紙を確かめる'))
      return { done: li?.classList.contains('done') ?? false, button: li?.querySelector('button')?.textContent ?? '', note: li?.querySelector('small')?.textContent ?? '' }
    })
  const opened = await coverItem()
  await page.screenshot({ path: `${OUT}/02-todo-cover-confirm.png` })
  await page.evaluate(() => [...document.querySelectorAll('.side .word-todo li')].find((x) => x.textContent.includes('表紙を確かめる')).querySelector('button').click())
  await pause(300)
  const confirmed = await coverItem()
  check(
    '表紙のページを開いただけでは「表紙を確かめる」は済みにならず、「確かめた」を押すと済みになる',
    !opened.done && opened.button === '確かめた' && confirmed.done && confirmed.note === '確かめました',
    JSON.stringify({ opened, confirmed }),
  )

  // ---- 「読み込む前の原稿に戻す」：コースも戻ることを、確かめる文で知らせる ----
  const asked = acceptNextDialog(page)
  await clickButton('.side .word-todo .undo', '読み込む前の原稿に戻す')
  const message = await asked
  await page.waitForFunction(() => !document.querySelector('.side .word-todo'), { timeout: 20000 })
  await ready()
  const back = await page.evaluate(() => window.__editor.getSnapshot().report.basicInfo.courseId)
  check('「読み込む前の原稿に戻す」で、コースも戻るときは「コースも「…」に戻ります」と出て、コースも戻る', message.includes(`コースも「${FILM}」に戻ります`) && back === 'film-stage-costume', JSON.stringify({ message, back }))
  await context.close()
}

// =====================================================================
// スマホ
// =====================================================================
export async function firstTimeV3Phone(browser, check) {
  const { context, page, ready } = await openPage(browser, { phone: true })
  await skipGuide(page, ready)
  await page.click('.p-top .icon-btn')
  await page.waitForSelector('.sheet .sheet-body')
  await pause(300)
  const menu = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.sheet .link-btn')].find((x) => x.textContent.includes('バックアップ'))
    return { text: b?.textContent.trim(), oneLine: (() => { const l = b?.querySelector('.backup-label'); return !!l && l.getBoundingClientRect().height < parseFloat(getComputedStyle(l).fontSize) * 2 })(), label: document.querySelector('.p-top .icon-btn')?.getAttribute('aria-label') }
  })
  await page.screenshot({ path: `${OUT}/12-phone-menu.png` })
  check('スマホのメニューのボタンも「バックアップ・作り直す」（1行に入る）', menu.text === 'バックアップ・作り直す' && menu.oneLine && menu.label.includes('作り直す'), JSON.stringify(menu))
  await page.evaluate(() => [...document.querySelectorAll('.sheet .link-btn')].find((x) => x.textContent.includes('バックアップ')).click())
  await page.waitForSelector('.modal .start-over')
  await page.evaluate(() => document.activeElement?.blur())
  await pause(400)
  const dlg = await page.evaluate(() => {
    const m = document.querySelector('.modal')
    const r = m.getBoundingClientRect()
    const again = m.querySelector('.start-over button.danger')
    const close = [...m.querySelectorAll('.close-row button')].find((b) => b.textContent === '閉じる')
    return {
      title: m.querySelector('h2')?.textContent,
      inside: r.left >= 0 && r.right <= innerWidth,
      cut: m.scrollWidth > m.clientWidth + 1,
      line: m.querySelector('.start-over p')?.textContent,
      closeBelow: !!again && !!close && close.getBoundingClientRect().top >= again.getBoundingClientRect().bottom,
    }
  })
  // いちばん下まで動かして写す（「最初から作り直す」と「閉じる」が見えるように）
  await page.evaluate(() => { const m = document.querySelector('.modal'); m.scrollTop = m.scrollHeight })
  await pause(200)
  await page.screenshot({ path: `${OUT}/12-phone-dialog.png` })
  check(
    'スマホの窓も「バックアップ・作り直す」。いちばん下に「最初から作り直す」の区切りと「閉じる」の行があり、横にはみ出さない',
    dlg.title === 'バックアップ・作り直す' && dlg.inside && !dlg.cut && dlg.line === 'いまの原稿は自動の控えに残ります' && dlg.closeBelow,
    JSON.stringify(dlg),
  )
  await context.close()
}
