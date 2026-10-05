// 通しの動作確認（Edge を自動で操作する）。
// 新しい報告書に、表紙・抄録・本文を入力し、指摘を直し、図を入れ、PDF に書き出すまでを行う。
// 使い方: node scripts/e2e/smoke.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { withEdge } from '../poc/edge.mjs'

const OUT = 'poc-output/e2e'
mkdirSync(OUT, { recursive: true })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
}

await withEdge(async (browser) => {
  // 毎回まっさらな状態から始める（ブラウザ内の保存データを消す）
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  await page.setViewport({ width: 1440, height: 900 })
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0' })
  await page.evaluate(() => new Promise((r) => { const req = indexedDB.deleteDatabase('sotsugyo-seisaku-report'); req.onsuccess = req.onerror = req.onblocked = () => r() }))
  await page.reload({ waitUntil: 'networkidle0' })
  const ready = () =>
    page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 60000 })
  await ready()
  check('新しい報告書が開く', true)

  const snap = () => page.evaluate(() => { const s = window.__editor.getSnapshot(); return { report: s.report, findings: s.findings.map((f) => ({ ruleId: f.ruleId, severity: f.severity, blockId: f.blockId })), layout: s.layout, editingId: s.editingId, page: s.page, pageCount: s.pageCount, zoomed: s.zoomed } })
  // 紙面は1ページずつ表示するため、ブロックのあるページを表示してからクリックする
  const clickBlock = async (id, offset = 'center') => {
    await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), id)
    await ready()
    const box = await page.evaluate((id, offset) => {
      const el = [...document.querySelectorAll(`.page-viewport.front [data-block-id="${id}"]`)].find((e) => e.getBoundingClientRect().width > 0)
      const r = el.getBoundingClientRect()
      return offset === 'start' ? { x: r.left + 4, y: r.top + 6 } : { x: r.left + Math.min(r.width / 2, 40), y: r.top + r.height / 2 }
    }, id, offset)
    await page.mouse.click(box.x, box.y)
  }
  const clickTool = (title) => page.evaluate((title) => document.querySelector(`.palette .tb[title="${title}"]`).click(), title)
  const typeAndCommit = async (text, key = 'Enter') => {
    await page.keyboard.type(text)
    await page.keyboard.press(key)
    await ready()
  }

  // ---- はじめての案内：コースを選び、表紙の項目を順に入力する ----
  check('はじめて開くと、表紙の上でコースを選ぶ案内が出る', !!(await page.$('.guide.step-course .g-opts button')))
  await page.evaluate(() => document.querySelector('.g-opts button').click())
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'basic:studentId', { timeout: 30000 })
  let s = await snap()
  check('コースを選ぶと、そのコースの下書きが本文に入り、学籍番号の入力が始まる', !!s.report.basicInfo.courseId && s.report.body.length > 0 && s.report.body.flatMap((c) => c.blocks).some((b) => b.type === 'paragraph' && b.hint), s.report.basicInfo.courseId)
  await page.keyboard.type('23FA0123')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'basic:name', { timeout: 30000 })
  await page.keyboard.type('文化　花子')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'basic:subtitleInput', { timeout: 30000 })
  await page.keyboard.type('シンドバッド')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.guide.step-done')
  await page.screenshot({ path: `${OUT}/0-guide-done.png` })
  await page.evaluate(() => [...document.querySelectorAll('.g-actions button')].find((b) => b.textContent.includes('閉じる')).click())
  await ready()
  s = await snap()
  check('案内に沿って、表紙の学籍番号・氏名・サブタイトルを入力できる', s.report.basicInfo.studentId === '23FA0123' && s.report.basicInfo.name === '文化　花子' && s.report.basicInfo.subtitleInput === 'シンドバッド' && !(await page.$('.guide')), JSON.stringify(s.report.basicInfo))
  check('表紙の未入力の指摘が消える', !s.findings.some((f) => f.ruleId === 'required-field'))

  // ---- 1ページずつの表示とページ送り ----
  check('紙面は1ページだけを表示する', (await page.evaluate(() => [...document.querySelectorAll('.page-viewport.front [data-vivliostyle-page-container]')].filter((p) => p.getBoundingClientRect().width > 0).length)) === 1)
  await page.keyboard.press('ArrowRight')
  await ready()
  check('→キーで次のページへめくれる', (await snap()).page === 1)
  await page.click('.arrow.prev')
  await ready()
  check('←ボタンで前のページへ戻る', (await snap()).page === 0)
  check('最初のページでは←ボタンが押せない', await page.$eval('.arrow.prev', (b) => b.disabled))
  await page.click('.zoom button:last-child')
  await ready()
  const zoomedWidth = await page.evaluate(() => document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current').getBoundingClientRect().width)
  await page.click('.zoom button:first-child')
  await ready()
  const fitWidth = await page.evaluate(() => document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current').getBoundingClientRect().width)
  check('「拡大」で紙面が大きくなり、「全体」で戻る', zoomedWidth > fitWidth * 1.1, `${Math.round(fitWidth)}px → ${Math.round(zoomedWidth)}px`)

  // ---- 表紙 ----
  await clickBlock('basic:studentId')
  check('表紙の学籍番号をクリックすると入力欄が開く', (await snap()).editingId === 'basic:studentId')
  await page.keyboard.press('Escape')
  await ready()
  // コース：表紙のコース欄をクリックし、出てきた一覧から別のコースを選ぶ（本文をまだ書いていないので、確かめずに下書きを入れ替える）
  const firstCourse = (await snap()).report.basicInfo.courseId
  await clickBlock('basic:course')
  await page.waitForSelector('.popover button')
  const courseCount = await page.$$eval('.popover button', (b) => b.length)
  if (courseCount > 1) {
    await page.evaluate(() => [...document.querySelectorAll('.popover button')].find((b) => !b.classList.contains('on')).click())
    await ready()
    s = await snap()
    check('表紙のコース欄から、ほかのコースに変えられる', s.report.basicInfo.courseId !== firstCourse && !(await page.$('.modal')), s.report.basicInfo.courseId)
  } else {
    await page.click('.popover button')
    await ready()
  }
  s = await snap()
  check('表紙の入力は、コースを変えても残る', s.report.basicInfo.studentId === '23FA0123' && s.report.basicInfo.name === '文化　花子' && s.report.basicInfo.subtitleInput === 'シンドバッド', JSON.stringify(s.report.basicInfo))

  // ---- 抄録 ----
  const abstractId = s.report.abstract.paragraphs[0].id
  await clickBlock(abstractId)
  const sentence = '本制作報告書は、卒業イベントにおいて筆者が制作した衣装についてである。'
  await typeAndCommit(sentence.repeat(19), 'Escape')
  s = await snap()
  check('抄録の文字数と行数が測れる', s.layout.abstractLines >= 15 && s.layout.abstractLines <= 23, `${s.layout.abstractLines}行`)
  check('抄録の字数の指摘が消える', !s.findings.some((f) => f.ruleId.startsWith('abstract')))

  // ---- 本文：誤りを含む文を書き、修正ボタンで直す ----
  const firstParagraph = s.report.body[0].blocks.find((b) => b.type === 'paragraph').id
  await clickBlock(firstParagraph)
  await typeAndCommit('私は１５世紀の衣装を製作した。', 'Escape')
  s = await snap()
  const ruleIds = s.findings.filter((f) => f.blockId === firstParagraph).map((f) => f.ruleId)
  check('本文の誤りを見つける', ['first-person', 'digit-fullwidth', 'seisaku'].every((r) => ruleIds.includes(r)), ruleIds.join(','))
  await page.screenshot({ path: `${OUT}/1-findings.png` })
  for (let i = 0; i < 3; i++) {
    const fix = await page.$('.side .issue .fix')
    if (!fix) break
    await fix.click()
    await ready()
  }
  s = await snap()
  const fixed = s.report.body[0].blocks.find((b) => b.id === firstParagraph).content.map((n) => n.text ?? '').join('')
  check('［修正する］で直る', fixed === '筆者は15世紀の衣装を制作した。', fixed)

  // ---- Enter で段落を分ける ----
  await clickBlock(firstParagraph)
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await ready()
  await page.keyboard.type('次の段落である。')
  await page.keyboard.press('Escape')
  await ready()
  s = await snap()
  const blocks = s.report.body[0].blocks
  const i = blocks.findIndex((b) => b.id === firstParagraph)
  check('Enter で段落が分かれる', blocks[i + 1]?.type === 'paragraph' && blocks[i + 1].content.map((n) => n.text ?? '').join('') === '次の段落である。')

  // ---- 本文を書き始めてからコースを変えると、確かめる ----
  if (courseCount > 1) {
    const before = s.report.basicInfo.courseId
    await clickBlock('basic:course')
    await page.waitForSelector('.popover button')
    await page.evaluate(() => [...document.querySelectorAll('.popover button')].find((b) => !b.classList.contains('on')).click())
    await page.waitForSelector('.modal')
    const asked = await page.evaluate(() => document.querySelector('.modal h2')?.textContent ?? '')
    await page.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.includes('コース名だけ変える')).click())
    await ready()
    s = await snap()
    const kept = s.report.body.flatMap((c) => c.blocks).some((b) => b.id === firstParagraph)
    check('本文を書き始めてからコースを変えると確かめ、「コース名だけ変える」なら本文を残す', asked.includes('コースを変えますか') && s.report.basicInfo.courseId !== before && kept, asked)
  }

  // ---- 図を入れる ----
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(600, 800)
    const g = c.getContext('2d')
    g.fillStyle = '#c9d7f0'
    g.fillRect(0, 0, 600, 800)
    g.fillStyle = '#3446a8'
    g.fillRect(150, 200, 300, 400)
    const blob = await c.convertToBlob({ type: 'image/png' })
    return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())))
  })
  const pngPath = join(tmpdir(), 'sotsugyo-e2e-figure.png')
  writeFileSync(pngPath, Buffer.from(png, 'base64'))
  await clickBlock(firstParagraph)
  const [chooser] = await Promise.all([page.waitForFileChooser(), clickTool('図（写真）を入れる')])
  await chooser.accept([pngPath])
  try {
    await page.waitForFunction(() => window.__editor.getSnapshot().editingId?.startsWith('f-'), { timeout: 30000 })
  } catch (e) {
    console.log('debug after figure:', await page.evaluate(() => { const s = window.__editor.getSnapshot(); return JSON.stringify({ editingId: s.editingId, rendering: s.rendering, figures: s.report.body.flatMap((c) => c.blocks).filter((b) => b.type === 'figureRow') }) }))
    throw e
  }
  await page.keyboard.type('デザイン画')
  await page.keyboard.press('Enter')
  await ready()
  s = await snap()
  const figure = s.report.body.flatMap((c) => c.blocks).find((b) => b.type === 'figureRow' && b.figures[0].caption === 'デザイン画')
  check('図が入り、タイトルを付けられる', !!figure && !!figure.figures[0].imageId)
  check('参照していない図を指摘する', s.findings.some((f) => f.ruleId === 'figure-unreferenced'))

  // ---- 図を参照する ----
  await clickBlock(firstParagraph)
  await page.keyboard.press('End')
  await page.evaluate(() => [...document.querySelectorAll('.palette .tb')].find((b) => b.textContent.includes('図表を参照')).click())
  await page.evaluate(() => [...document.querySelectorAll('.palette .side-menu button')].find((b) => b.textContent.includes('図1')).click())
  await page.keyboard.press('Escape')
  await ready()
  s = await snap()
  check('「図表を参照」で（図1）が入り、指摘が消える', !s.findings.some((f) => f.ruleId === 'figure-unreferenced'))
  await page.screenshot({ path: `${OUT}/2-figure.png` })

  // ---- 書いた文字が次のページへあふれたら、表示も追いかける ----
  await clickBlock(firstParagraph)
  const startPage = (await snap()).page
  await page.keyboard.press('End')
  await page.keyboard.type('航海の場面ごとに衣装の色を変え、物語の流れが観客に伝わるよう工夫した。'.repeat(50))
  await new Promise((r) => setTimeout(r, 1200))
  await ready()
  const follow = await page.evaluate(() => {
    const ed = window.__editor
    const s = ed.getSnapshot()
    const clip = document.querySelector('.overlay-clip').getBoundingClientRect()
    const caret = getSelection().getRangeAt(0).getBoundingClientRect()
    return { page: s.page, caretPage: ed.pageOfBlock(s.editingId, 1e9), caretVisible: caret.top >= clip.top && caret.bottom <= clip.bottom }
  })
  await page.screenshot({ path: `${OUT}/3-follow.png` })
  check('書いた文字が次のページへ移ると、表示も追いかける', follow.page === follow.caretPage && follow.caretPage > startPage && follow.caretVisible, JSON.stringify({ startPage, ...follow }))
  await page.keyboard.press('Escape')
  await ready()

  // ---- 自動保存：読み込み直しても残っている ----
  await new Promise((r) => setTimeout(r, 1500))
  await page.reload({ waitUntil: 'networkidle0' })
  await ready()
  s = await snap()
  check('読み込み直しても原稿が残っている（自動保存）', s.report.basicInfo.name === '文化　花子' && s.report.body.flatMap((c) => c.blocks).some((b) => b.type === 'figureRow'))
  const imgLoaded = await page.evaluate(() => { const img = document.querySelector('.page-viewport.front figure img'); return img?.src.startsWith('blob:') && img.naturalWidth > 0 })
  check('読み込み直しても写真が残っている', imgLoaded)

  // ---- PDF に書き出す（学生が「PDFに保存」を選んだときと同じ印刷処理） ----
  await page.pdf({ path: `${OUT}/report.pdf`, preferCSSPageSize: true, printBackground: true })
  const doc = await getDocument({ url: `${OUT}/report.pdf`, verbosity: 0 }).promise
  const texts = []
  for (let n = 1; n <= doc.numPages; n++) texts.push((await (await doc.getPage(n)).getTextContent()).items.map((it) => it.str).join(''))
  const all = texts.join('\n')
  check('PDF のページ数が紙面と同じ', doc.numPages === s.layout.kinds.length, `${doc.numPages}ページ`)
  check('PDF に画面の部品（ボタンやチェック欄）が入らない', !/セルフチェック|PDFを書き出す|自動保存/.test(all))
  check('PDF に仮の文字（クリックして入力）が入らない', !/クリックして/.test(all))
  const page1Text = texts[0].replace(/\s/g, '')
  check('PDF の1ページ目は表紙', /卒業制作/.test(page1Text) && /文化学園大学/.test(page1Text) && /文化　?花子|文化花子/.test(page1Text))
  check('PDF に白紙のページがない', texts.slice(0, -1).every((t) => t.trim().length > 0), texts.map((t) => t.trim().length).join(','))
  const page1 = await doc.getPage(1)
  const vp = page1.getViewport({ scale: 1 })
  check('PDF は A4', Math.abs(vp.width - 595.3) < 2 && Math.abs(vp.height - 841.9) < 2, `${vp.width.toFixed(1)}x${vp.height.toFixed(1)}pt`)
  await context.close()
})

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 件 合格`)
process.exitCode = failed.length ? 1 : 0
