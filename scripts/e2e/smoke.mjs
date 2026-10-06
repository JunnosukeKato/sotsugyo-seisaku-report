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
  // 光る枠は、開いた入力欄（紙面の仮の文字より広い）を囲む
  await new Promise((r) => setTimeout(r, 500))
  const spotCovers = await page.evaluate(() => {
    const s = document.querySelector('.g-spot')?.getBoundingClientRect()
    const e = document.querySelector('.overlay-clip:not([hidden]) .overlay-editor')?.getBoundingClientRect()
    return !!s && !!e && s.left <= e.left && s.right >= e.right && s.top <= e.top && s.bottom >= e.bottom
  })
  check('案内の光る枠が、開いた入力欄を囲む', spotCovers)
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

  // ---- マウスのホイールでページを送る ----
  const pause = (ms = 400) => new Promise((r) => setTimeout(r, ms))
  const stageCenter = await page.evaluate(() => { const r = document.querySelector('.page-scroller').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  await page.mouse.move(stageCenter.x, stageCenter.y)
  await page.mouse.wheel({ deltaY: 100 })
  await pause()
  await ready()
  check('ホイールを下へ1目盛り回すと、次のページへめくれる', (await snap()).page === 1)
  await pause()
  // タッチパッドのように細かく続けて回しても（指を離したあとの惰性を含めて）、1ページだけ送る
  await page.evaluate(async () => {
    const stage = document.querySelector('.stage')
    for (let i = 0; i < 40; i++) {
      stage.dispatchEvent(new WheelEvent('wheel', { deltaY: 25, bubbles: true, cancelable: true }))
      await new Promise((r) => setTimeout(r, 16))
    }
  })
  await pause()
  await ready()
  check('細かく続けて回しても、1回の操作では1ページだけ送る', (await snap()).page === 2, `${(await snap()).page}ページ目`)
  await page.evaluate(() => window.__editor.goToPage(0, 'none'))
  await ready()
  // 拡大しているときは、まず紙面をスクロールし、端まで来てから改めて回したときだけ送る
  await page.click('.zoom button:last-child')
  await ready()
  await page.mouse.move(stageCenter.x, stageCenter.y)
  await page.mouse.wheel({ deltaY: 300 })
  await pause()
  const zoomScroll = await page.evaluate(() => document.querySelector('.page-scroller').scrollTop)
  check('拡大しているときは、ホイールで紙面がスクロールする（ページは送らない）', zoomScroll > 0 && (await snap()).page === 0, `${zoomScroll}px`)
  await page.evaluate(() => { const sc = document.querySelector('.page-scroller'); sc.scrollTop = sc.scrollHeight })
  await pause()
  await page.mouse.wheel({ deltaY: 100 })
  await pause()
  await ready()
  check('拡大しているときは、下の端まで来てから回すと次のページへ送る', (await snap()).page === 1)
  await page.click('.zoom button:first-child')
  await ready()
  await page.evaluate(() => window.__editor.goToPage(0, 'none'))
  await ready()

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

  // ---- 書いていて行が増えたら、紙面を組み直す前から、後ろの段落が下へずれて見える（入力欄に隠れない） ----
  await clickBlock(firstParagraph)
  await page.keyboard.press('End')
  await page.keyboard.type('衣装は、舞台の上で動きやすく、遠くの客席からも形がわかるよう、袖を大きく広げた形にした。')
  const pushed = await page.evaluate((nextId) => {
    const ed = document.querySelector('.overlay-clip:not([hidden]) .overlay-editor').getBoundingClientRect()
    const next = [...document.querySelectorAll(`.page-viewport.front [data-block-id="${nextId}"]`)].find((e) => e.getBoundingClientRect().width > 0)?.getBoundingClientRect()
    return { rendering: window.__editor.getSnapshot().rendering, overlayBottom: Math.round(ed.bottom), nextTop: next && Math.round(next.top) }
  }, blocks[i + 1].id)
  check('書いて行が増えると、後ろの段落が下へずれて見える（入力欄に隠れない）', pushed.nextTop >= pushed.overlayBottom - 1, JSON.stringify(pushed))
  await page.keyboard.press('Escape')
  await ready()
  // 書き足した文は取り消す（この後の確かめは、1行の段落で行う）
  await page.evaluate(() => window.__editor.undo())
  await ready()

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
  const clickPaletteButton = (label) => page.evaluate((label) => [...document.querySelectorAll('.palette .tb')].find((b) => b.textContent.includes(label)).click(), label)
  const waitEditing = (test, ...args) => page.waitForFunction(test, { timeout: 30000 }, ...args)

  // 段落の最後（「。」の後ろ）で「図を入れる」を押し、写真を選ぶ
  await clickBlock(firstParagraph)
  await page.keyboard.press('End')
  const [chooser] = await Promise.all([page.waitForFileChooser(), clickPaletteButton('図を入れる')])
  await chooser.accept([pngPath])
  await waitEditing(() => window.__editor.getSnapshot().editingId?.startsWith('f-'))
  await page.keyboard.type('デザイン画')
  await page.keyboard.press('Enter')
  await waitEditing((id) => window.__editor.getSnapshot().editingId === id, firstParagraph)
  await ready()
  s = await snap()
  const blocksNow = s.report.body.flatMap((c) => c.blocks)
  const pIndex = blocksNow.findIndex((b) => b.id === firstParagraph)
  const group = blocksNow[pIndex + 1]
  check('「図を入れる」で、書いている位置に（図1）が入り、段落のすぐ下にタイトル付きの図が入る', group?.type === 'figureRow' && group.figures[0].caption === 'デザイン画' && !!group.figures[0].imageId && /（図1）。$/.test(await page.evaluate(() => document.querySelector('.overlay-editor').innerText)), JSON.stringify(group?.figures))
  check('図のタイトルを Enter で確定すると、書いていた段落の続きに戻る', s.editingId === firstParagraph)
  check('参照していない図の指摘が出ない', !s.findings.some((x) => x.ruleId === 'figure-unreferenced'))
  await page.keyboard.press('Escape')
  await ready()

  // 図を選んで「もう1枚」：すぐ後ろに入り、横に並び、本文に（図2）が入る
  const figAt = await page.evaluate(() => {
    const r = document.querySelector('.page-viewport.front figure[data-figure-id] img').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.mouse.click(figAt.x, figAt.y)
  const [chooser2] = await Promise.all([page.waitForFileChooser(), clickPaletteButton('もう1枚')])
  await chooser2.accept([pngPath])
  await waitEditing(() => (window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.type === 'figureRow')?.figures.length ?? 0) === 2 && window.__editor.getSnapshot().editingId?.startsWith('f-'))
  await page.keyboard.type('型紙')
  await page.keyboard.press('Enter')
  await ready()
  s = await snap()
  const two = s.report.body.flatMap((c) => c.blocks).find((b) => b.type === 'figureRow')
  const rowTops = await page.evaluate(() => [...document.querySelectorAll('.page-viewport.front figure[data-figure-id] img')].map((img) => Math.round(img.getBoundingClientRect().top)))
  const textWithTwo = await page.evaluate((id) => window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === id).content.filter((n) => n.type === 'ref').length, firstParagraph)
  check('「もう1枚」で2枚目が横に並び、本文に（図2）が入る', two.figures.length === 2 && rowTops.length === 2 && rowTops[0] === rowTops[1] && textWithTwo === 2, JSON.stringify(rowTops))
  await page.screenshot({ path: `${OUT}/2-figure-two.png` })

  // 2枚目を消すと、本文の（図2）も消える
  await page.evaluate((id) => window.__editor.select({ kind: 'figure', id }), two.figures[1].id)
  await page.evaluate(() => window.__editor.removeSelected())
  await ready()
  s = await snap()
  const refsLeft = s.report.body.flatMap((c) => c.blocks).find((b) => b.id === firstParagraph).content.filter((n) => n.type === 'ref').length
  check('図を消すと、本文のその図への（図n）も消える', s.report.body.flatMap((c) => c.blocks).find((b) => b.type === 'figureRow').figures.length === 1 && refsLeft === 1)

  // ---- 図を参照する（もう一度） ----
  await clickBlock(firstParagraph)
  await page.keyboard.press('End')
  await page.evaluate(() => [...document.querySelectorAll('.palette .tb')].find((b) => b.textContent.includes('図表を参照')).click())
  await page.evaluate(() => [...document.querySelectorAll('.palette .side-menu button')].find((b) => b.textContent.includes('図1')).click())
  await page.keyboard.press('Escape')
  await ready()
  s = await snap()
  const refsNow = s.report.body.flatMap((c) => c.blocks).find((b) => b.id === firstParagraph).content.filter((n) => n.type === 'ref').length
  check('「図表を参照」で（図1）をもう一度入れられる', refsNow === 2 && !s.findings.some((x) => x.ruleId === 'figure-unreferenced'))
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

  // ---- 作品写真：並べ方を選び、写真を入れ、つかんで動かす ----
  await page.evaluate(() => window.__editor.goToArea('photos'))
  await ready()
  const chooseArrangement = async (title) => {
    await page.evaluate((title) => [...document.querySelectorAll('.palette .lay')].find((b) => b.title.startsWith(title)).click(), title)
    await pause(300)
    await ready()
  }
  await chooseArrangement('2枚（上下')
  const slotBox = (i, sel = '') => page.evaluate((i, sel) => { const r = document.querySelector(`.page-viewport.front [data-photo-slot="${i}"]${sel}`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }, i, sel)
  for (const i of [0, 1]) {
    const b = await slotBox(i)
    const [photoChooser] = await Promise.all([page.waitForFileChooser(), page.mouse.click(b.x, b.y)])
    await photoChooser.accept([pngPath])
    await page.waitForFunction((i) => !!window.__editor.getSnapshot().report.workPhotos.imageIds[i], {}, i)
    await ready()
  }
  const photoFit = await page.evaluate(() => getComputedStyle(document.querySelector('.page-viewport.front [data-photo-slot="0"] img')).objectFit)
  check('作品写真を2枚（上下）で入れると、枠いっぱいに切り抜いて載る', (await snap()).report.workPhotos.imageIds.filter(Boolean).length === 2 && photoFit === 'cover', photoFit)
  // 1枚目をつかんで下へ動かす（ファイルを選ぶ画面は開かない）
  let chooserOpened = false
  const onChooser = () => (chooserOpened = true)
  page.on('filechooser', onChooser)
  const d = await slotBox(0, ' img')
  await page.mouse.move(d.x, d.y)
  await page.mouse.down()
  for (let k = 1; k <= 8; k++) await page.mouse.move(d.x, d.y + k * 12)
  await page.mouse.up()
  await pause()
  await ready()
  page.off('filechooser', onChooser)
  const moved = (await snap()).report.workPhotos.positions?.[0]
  check('作品写真をつかんで動かすと、見える位置が変わる（写真は選び直さない）', !!moved && moved.y < 50 && moved.x === 50 && !chooserOpened, JSON.stringify(moved))
  await chooseArrangement('1枚')
  const oneShown = await page.evaluate(() => document.querySelectorAll('.page-viewport.front [data-photo-slot]').length)
  await chooseArrangement('2枚（上下')
  s = await snap()
  check('1枚にしてから2枚に戻すと、2枚目の写真も戻る（1枚目から順に載る）', oneShown === 1 && s.report.workPhotos.imageIds.filter(Boolean).length === 2 && !s.findings.some((f) => f.ruleId.startsWith('photos')), String(oneShown))

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

  // ---- 図が段落の下に入りきらないときは、図だけ次のページの上へ送り、後ろの文章でページを埋める ----
  const setBody = async (rest, nextChapter) => {
    await page.evaluate((rest, nextChapter) => {
      const kana = '本制作では、衣装の素材や形を検討し、舞台の上での見え方を確かめながら制作を進めた。'
      const text = (n) => Array.from({ length: n }, (_, i) => kana[i % kana.length]).join('')
      const para = (id, n, ref) => ({ type: 'paragraph', id, content: [{ type: 'text', text: text(n) }, ...(ref ? [{ type: 'ref', targetId: ref, withParens: true }, { type: 'text', text: '。' }] : [])] })
      const body = [{ id: 'fc1', title: '制作過程', blocks: [para('fpA', 1050), para('fpP', 60, 'ff1'), { type: 'figureRow', id: 'fg1', figures: [{ id: 'ff1', imageId: '', caption: 'デザイン画' }] }, para('fpB', rest)] }]
      if (nextChapter) body.push({ id: 'fc2', title: 'まとめ', blocks: [para('fpE', 300)] })
      window.__editor.update((r) => ({ ...r, body }))
    }, rest, nextChapter)
    await new Promise((r) => setTimeout(r, 300))
    await ready()
    return page.evaluate(() => {
      const vp = document.querySelector('.page-viewport.front')
      vp.classList.add('measuring')
      const pages = [...vp.querySelectorAll('[data-vivliostyle-page-container]')]
      const at = (el) => {
        const pg = el.closest('[data-vivliostyle-page-container]')
        const pr = pg.getBoundingClientRect()
        const r = el.getBoundingClientRect()
        return { page: pages.indexOf(pg), top: Math.round(((r.top - pr.top) / pr.height) * 297), bottom: Math.round(((r.bottom - pr.top) / pr.height) * 297) }
      }
      const group = document.querySelector('.page-viewport.front .figure-group[data-group-id="fg1"]')
      const anchor = [...vp.querySelectorAll('[data-block-id="fpP"]')].at(-1)
      const after = [...vp.querySelectorAll('[data-block-id="fpB"]')]
      const chapter2 = vp.querySelector('#ch-fc2')
      const result = { deferred: group.classList.contains('deferred'), group: at(group), anchor: at(anchor), after: after.map(at), chapter2: chapter2 && at(chapter2) }
      vp.classList.remove('measuring')
      return result
    })
  }
  let f = await setBody(600, false)
  check('図が入りきらないときは、図を次のページの上へ送り、後ろの文章でページの下まで埋める', f.deferred && f.group.page === f.anchor.page + 1 && f.group.top <= 26 && f.after[0].page === f.anchor.page && f.after[0].bottom >= 265, JSON.stringify(f))
  f = await setBody(100, true)
  check('章の残りの文章が少ないときは送らない（図が次の章の見出しより上に出ない）', !f.deferred && f.group.page === f.anchor.page + 1 && f.chapter2.page > f.group.page, JSON.stringify(f))

  // ---- 改ページ：書いている段落の後ろに入れると、後ろは次のページから始まる。印は画面だけ ----
  await page.evaluate(() => {
    const kana = '本制作では、衣装の素材や形を検討し、舞台の上での見え方を確かめながら制作を進めた。'
    const text = (n) => Array.from({ length: n }, (_, i) => kana[i % kana.length]).join('')
    const body = [{ id: 'bc1', title: '制作過程', blocks: [{ type: 'paragraph', id: 'bpA', content: [{ type: 'text', text: text(300) }] }, { type: 'paragraph', id: 'bpB', content: [{ type: 'text', text: text(200) }] }] }]
    window.__editor.update((r) => ({ ...r, body }))
  })
  await pause(300)
  await ready()
  await clickBlock('bpA')
  await clickPaletteButton('改ページ')
  await pause(300)
  await ready()
  const pageOfId = (id) => page.evaluate((id) => window.__editor.pageOfBlock(id), id)
  s = await snap()
  const breakId = s.report.body[0].blocks[1]?.id
  check('「改ページ」を押すと、後ろの段落が次のページから始まる', s.report.body[0].blocks[1]?.type === 'pageBreak' && (await pageOfId('bpB')) === (await pageOfId('bpA')) + 1, JSON.stringify(s.report.body[0].blocks.map((b) => b.type)))
  check('改ページでページの半分以上が空くと、セルフチェックで注意が出る', s.findings.some((x) => x.ruleId === 'page-break-gap' && x.blockId === breakId))
  await page.pdf({ path: `${OUT}/pagebreak.pdf`, preferCSSPageSize: true, printBackground: true })
  const pbDoc = await getDocument({ url: `${OUT}/pagebreak.pdf`, verbosity: 0 }).promise
  let pbText = ''
  for (let n = 1; n <= pbDoc.numPages; n++) pbText += (await (await pbDoc.getPage(n)).getTextContent()).items.map((it) => it.str).join('')
  check('改ページの印は PDF に出ない', !pbText.includes('改ページ'))
  // 印をクリックして選び、道具の「削除」で消す
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), breakId)
  await ready()
  const mark = await page.evaluate((id) => {
    const el = document.querySelector(`.page-viewport.front .page-break[data-block-id="${id}"]`)
    const r = el.getBoundingClientRect()
    const p = el.closest('[data-vivliostyle-page-container]').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + (p.height / 297) * 6 }
  }, breakId)
  await page.mouse.click(mark.x, mark.y)
  await pause(200)
  const selected = (await page.evaluate(() => window.__editor.getSnapshot().selection))?.kind
  await clickPaletteButton('削除')
  await pause(300)
  await ready()
  s = await snap()
  check('改ページの印をクリックして選び、「削除」で消せる', selected === 'pageBreak' && !s.report.body[0].blocks.some((b) => b.type === 'pageBreak') && (await pageOfId('bpB')) === (await pageOfId('bpA')), selected)
  await context.close()
})

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 件 合格`)
process.exitCode = failed.length ? 1 : 0
