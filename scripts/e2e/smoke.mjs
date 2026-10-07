// 通しの動作確認（Edge を自動で操作する）。
// 新しい報告書に、表紙・抄録・本文を入力し、指摘を直し、図を入れ、PDF に書き出すまでを行う。
// 使い方: node scripts/e2e/smoke.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { withEdge } from '../poc/edge.mjs'
import { stubConfig } from './configStub.mjs'
import { setupWriting } from './sampleReport.mjs'

// 開発サーバーの場所（ふだんは http://localhost:5173。APP_URL で変えられる）
const APP = process.env.APP_URL ?? 'http://localhost:5173'
/**
 * 確かめている途中に src/ が直されても、画面が入れ替わらないようにする（開発サーバーの即時反映をつながない。
 * 入れ替わると、案内や書いている途中の状態が消えて、確かめが途中で止まる。開いた時点のツールで確かめる）
 */
const noHotReload = (page) =>
  page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
  })
const OUT = 'poc-output/e2e'
mkdirSync(OUT, { recursive: true })
/** 「PDFを書き出す」で保存した PDF の置き場所（毎回空にする） */
const DOWNLOADS = `${OUT}/downloads`
rmSync(DOWNLOADS, { recursive: true, force: true })
mkdirSync(DOWNLOADS, { recursive: true })
/** 保存された PDF を待って、名前とページの数を返す（ページの数は、PDF の中の /Type /Page を数える） */
const savedPdf = async (name) => {
  for (let i = 0; i < 80 && !existsSync(`${DOWNLOADS}/${name}`); i++) await new Promise((r) => setTimeout(r, 250))
  if (!existsSync(`${DOWNLOADS}/${name}`)) return { files: readdirSync(DOWNLOADS), pages: 0 }
  const text = readFileSync(`${DOWNLOADS}/${name}`, 'latin1')
  return { files: readdirSync(DOWNLOADS), pages: (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length, head: text.slice(0, 5) }
}
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
}

await withEdge(async (browser) => {
  // 毎回まっさらな状態から始める（ブラウザ内の保存データを消す）
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await noHotReload(page)
  await stubConfig(page)
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  // 「PDFを書き出す」で保存した PDF を、決まった場所に置く（確かめのため）
  await (await page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: resolve(DOWNLOADS), browserContextId: context.id })
  await page.setViewport({ width: 1440, height: 900 })
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0' })
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
  check('はじめて開くと、表紙の上でコースを選ぶ案内が出る（今年度だけ、Word で書き始めた人への説明も出る）', !!(await page.$('.guide.step-course .g-opts button')) && !!(await page.$('.guide.step-course .g-word')))
  await page.evaluate(() => document.querySelector('.g-opts button').click())
  // 今年度だけ：コースを選ぶと「Word で書き始めていますか？」と聞く（mockups/v24 ① 案C）。「いいえ」で今までどおり学籍番号へ
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  const wordStep = await page.evaluate(() => ({
    steps: document.querySelector('.g-steps')?.textContent ?? '',
    modal: document.querySelector('.g-tip')?.getAttribute('aria-modal'),
    focus: document.activeElement?.tagName,
  }))
  check('コースを選ぶと「Word で書き始めていますか？」と聞く（案内の段階は 1 コース 2 Word 3 学籍番号…。窓として扱い、見出しに移る）', wordStep.steps.includes('2 Word') && wordStep.steps.includes('3 学籍番号') && wordStep.modal === 'true' && wordStep.focus === 'H2', JSON.stringify(wordStep))
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'basic:studentId', { timeout: 30000 })
  let s = await snap()
  check('コースを選ぶと、そのコースの下書きが本文に入り、「いいえ」で学籍番号の入力が始まる', !!s.report.basicInfo.courseId && s.report.body.length > 0 && s.report.body.flatMap((c) => c.blocks).some((b) => b.type === 'paragraph' && b.hint), s.report.basicInfo.courseId)
  const noticeText = () => page.evaluate(() => document.querySelector('.side .notice')?.textContent ?? '')
  check('右の欄に、自分のコースのお知らせが出る', (await noticeText()).includes('映画・舞台衣装デザイナー コースからのお知らせ') && (await noticeText()).includes('衣装コースへのお知らせ'), await noticeText())
  // 「？ 使い方」のボタン（右の欄の「バックアップ」の横。mockups/v27 案A。印刷用の手引きの PDF は、使い方の一覧のいちばん下から開く）
  check('右の欄の「バックアップ」の横に「？ 使い方」のボタンがある', await page.evaluate(() => [...document.querySelectorAll('.side .links .link-btn')].map((b) => b.textContent.trim()).join(',').includes('バックアップ,使い方')))
  await page.keyboard.type('00ZZ0123')
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
  check('案内に沿って、表紙の学籍番号・氏名・サブタイトルを入力できる', s.report.basicInfo.studentId === '00ZZ0123' && s.report.basicInfo.name === '文化　花子' && s.report.basicInfo.subtitleInput === 'シンドバッド' && !(await page.$('.guide')), JSON.stringify(s.report.basicInfo))
  check('表紙の未入力の指摘が消える', !s.findings.some((f) => f.ruleId === 'required-field'))

  // ---- 指差し確認（はじめての案内を終えたあと、1か所ずつ光を当てる。mockups/v27 案A） ----
  const TOUR_KEY = 'sotsugyo-seisaku-report-tour'
  const pause0 = (ms) => new Promise((r) => setTimeout(r, ms))
  const tourStep = () =>
    page.evaluate(() => ({
      count: document.querySelector('.tour-k span')?.textContent ?? '',
      title: document.querySelector('.tour-tip h2')?.textContent ?? '',
      focus: document.activeElement?.classList.contains('next') ?? false,
      spot: !!document.querySelector('.tour-spot'),
      next: document.querySelector('.tour-acts .next')?.textContent ?? '',
      skip: !!document.querySelector('.tour-acts .skip'),
      again: document.querySelector('.tour-again')?.textContent ?? '',
    }))
  const tourShown = await page.waitForSelector('.tour .tour-tip', { timeout: 20000 }).then(() => true, () => false)
  await pause0(300)
  const steps = []
  for (let i = 0; tourShown && i < 10; i++) {
    const st = await tourStep()
    steps.push(st)
    if (st.next === 'おわり') break
    // 「次へ」は、吹き出しに移っているので Enter で押せる
    await page.keyboard.press('Enter')
    await pause0(250)
  }
  await page.screenshot({ path: `${OUT}/0-tour-last.png` })
  check(
    '案内を終えると指差し確認が出て、「次へ」（Enter）で7か所を順に見られる（光の枠・「1 / 7」・「次へ」に移っている・「とばす」）',
    steps.map((x) => x.title).join(',') === '紙面,道具,ページの一覧,保存のようす,セルフチェック,PDFを書き出す,？ 使い方' && steps.every((x) => x.spot && x.focus) && steps[0].count === '1 / 7' && steps[0].skip,
    JSON.stringify(steps.map((x) => `${x.count} ${x.title}${x.focus ? '' : '（移っていない）'}`)),
  )
  const lastStep = steps.at(-1)
  check('最後は「？ 使い方」を指し、「おわり」と、使い方からもう一度見られることを伝える（「とばす」はない）', lastStep?.next === 'おわり' && !lastStep.skip && lastStep.again.includes('使い方'), JSON.stringify(lastStep))
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.querySelector('.tour'), { timeout: 10000 }).catch(() => {})
  check('「おわり」で閉じ、見たことをこの端末に覚える', !(await page.$('.tour')) && (await page.evaluate((k) => localStorage.getItem(k), TOUR_KEY)) === 'done')

  // ---- 使い方（PC：右の欄が使い方に替わる。mockups/v27 案A） ----
  await page.click('.side .help-btn')
  await page.waitForSelector('.side .help-side')
  await pause0(300)
  const helpOpen = await page.evaluate(() => ({
    topics: document.querySelectorAll('.help-list button').length,
    check: !!document.querySelector('.side .sec.check'),
    focus: document.activeElement?.classList.contains('help-title') ?? false,
    pdf: document.querySelector('.help-foot .help-pdf')?.getAttribute('href'),
    paper: !!document.querySelector('.palette'),
  }))
  check('「？ 使い方」で、右の欄が使い方に替わる（項目16・見出しに移る・紙面と道具はそのまま・いちばん下に印刷用の手引き（PDF））', helpOpen.topics === 16 && !helpOpen.check && helpOpen.focus && helpOpen.paper && helpOpen.pdf === './guides/student-guide.pdf', JSON.stringify(helpOpen))
  await page.type('.help-search input', 'PDF 出ない')
  await pause0(300)
  const found = await page.evaluate(() => ({
    count: document.querySelector('.help-count')?.textContent ?? '',
    titles: [...document.querySelectorAll('.help-results .t')].map((t) => t.textContent),
    marks: [...new Set([...document.querySelectorAll('.help-results mark')].map((m) => m.textContent))],
    part: !!document.querySelector('.help-part'),
  }))
  await page.screenshot({ path: `${OUT}/0-help-search.png` })
  check('「言葉で探す」に「PDF 出ない」と入れると、両方の言葉が入っている項目が先に出て、言葉に印（黄色）が付く', found.titles[0] === 'PDF の出し方（端末ごと）' && found.titles[1] === '下書きの PDF' && found.part && found.marks.includes('PDF') && found.marks.includes('出ない') && found.count.includes('件'), JSON.stringify(found))
  await page.evaluate(() => document.querySelector('.help-results button').click())
  await page.waitForSelector('.help-topic')
  await pause0(400)
  const topic = await page.evaluate(() => ({
    title: document.querySelector('.help-topic h3')?.textContent,
    back: document.querySelector('.help-back')?.textContent,
    steps: document.querySelectorAll('.help-steps li').length,
    device: document.querySelector('.help-dev .tabs .on')?.textContent,
    marks: document.querySelectorAll('.help-topic mark').length,
    img: (() => {
      const i = document.querySelector('.help-shot img')
      return i ? { src: i.getAttribute('src'), loaded: i.complete && i.naturalWidth > 0 } : null
    })(),
    focus: document.activeElement?.tagName,
  }))
  check('探した結果から項目を開くと、手順・端末ごとの手順・画面の写真が出て、言葉に印が付く（「探した結果へ」で戻れる）', topic.title === 'PDF の出し方（端末ごと）' && topic.back?.includes('探した結果へ') && topic.steps === 3 && topic.device === 'パソコン' && topic.marks > 0 && topic.img?.src === './help/export.jpg' && topic.img.loaded && topic.focus === 'H3', JSON.stringify(topic))
  await page.click('.help-shot-btn')
  await page.waitForSelector('.help-zoom img')
  await page.keyboard.press('Escape')
  await pause0(200)
  check('「押すと大きく」で画面の写真を大きく出し、Esc でそれだけを閉じる', !(await page.$('.help-zoom')) && !!(await page.$('.side .help-side')))
  await page.click('.help-back')
  await page.click('.help-clear')
  await pause0(200)
  // 使い方の「指差し確認をもう一度見る」→「いま見る」：使い方を閉じて、指差し確認を出す。Esc は「とばす」
  await page.evaluate(() => document.querySelector('.help-list [data-topic="tour"]').click())
  await page.waitForSelector('.help-action')
  await page.click('.help-action')
  const replayed = await page.waitForSelector('.tour .tour-tip', { timeout: 15000 }).then(() => true, () => false)
  const replayInfo = await tourStep()
  await page.keyboard.press('Escape')
  await pause0(300)
  check('使い方の「指差し確認をもう一度見る」から、もう一度見られ（使い方は閉じる）、Esc でとばせる', replayed && replayInfo.count === '1 / 7' && !(await page.$('.help-side')) && !(await page.$('.tour')), JSON.stringify(replayInfo))
  await page.click('.side .help-btn')
  await page.waitForSelector('.side .help-side')
  await page.click('.help-close')
  await pause0(200)
  check('使い方の「閉じる」で、セルフチェックの欄に戻る（「？ 使い方」に戻る）', !(await page.$('.help-side')) && !!(await page.$('.side .sec.check')) && (await page.evaluate(() => document.activeElement?.classList.contains('help-btn'))))
  // 一度見たら、読み込み直しても出ない
  await page.reload({ waitUntil: 'networkidle0' })
  await ready()
  await pause0(1200)
  check('指差し確認は、一度見たら（とばしたら）この端末では次から出ない', !(await page.$('.tour')) && !(await page.$('.guide')))

  // ---- キーボード：紙面の欄に Tab で移り、Enter で書き始め、Esc で戻る（mockups/v23 ④） ----
  const focused = () =>
    page.evaluate(() => {
      const a = document.activeElement
      return { key: a?.getAttribute('data-paper-key') ?? null, label: a?.getAttribute('aria-label'), inPaper: !!a?.closest('.page-viewport.front'), visible: !!a?.matches(':focus-visible'), outline: a ? getComputedStyle(a).outlineStyle : '' }
    })
  await page.evaluate(() => document.querySelector('.page-viewport.front [data-paper-key="b:basic:studentId"]').focus())
  await page.keyboard.press('Tab')
  let pf = await focused()
  check('表紙の欄に Tab で移れ、移った欄に目印（藍の枠）が出る（読み上げの名前「氏名」）', pf.key === 'b:basic:name' && pf.label?.startsWith('氏名：') && pf.visible && pf.outline === 'solid', JSON.stringify(pf))
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'basic:name', { timeout: 20000 })
  await page.keyboard.press('Escape')
  await ready()
  pf = await focused()
  check('Enter で書き始め、Esc で書き終えると、書いていた欄に戻る（組み直したあとも）', pf.key === 'b:basic:name' && pf.inPaper && pf.visible && (await snap()).editingId === null, JSON.stringify(pf))

  // ---- 表紙のサブタイトルが長いときは、枠の1行に入るまで文字を小さくする（mockups/v23 ①） ----
  const subtitleFit = () =>
    page.evaluate(() => {
      const s = window.__editor.getSnapshot()
      const el = document.querySelector('.page-viewport.front .cover .subtitle')
      return { pt: Math.round(parseFloat(getComputedStyle(el).fontSize) * 0.75 * 10) / 10, fit: s.layout.coverSubtitle, error: s.findings.some((f) => f.ruleId === 'cover-subtitle-fit') }
    })
  const setSubtitle = async (text) => {
    await page.evaluate((text) => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, subtitleInput: text } })), text)
    await ready()
  }
  await setSubtitle('映画『千夜一夜物語』に登場する砂漠の王子シンドバッド')
  let sf = await subtitleFit()
  check('表紙のサブタイトルが長いと、枠の1行に入るまで行全体の文字を小さくする（26字で 13pt ほど。枠の幅 144.2mm）', sf.pt >= 12 && sf.pt <= 13.5 && sf.fit.ratio <= 1.002 && !sf.error, JSON.stringify(sf))
  await setSubtitle('映画『千夜一夜物語』に登場する砂漠の王子シンドバッドと七つの海を渡る船乗りたち')
  sf = await subtitleFit()
  check('いちばん小さい文字（11pt）でも入らないときは、表紙のサブタイトルのエラーになる', sf.pt === 11 && sf.fit.ratio > 1 && sf.error, JSON.stringify(sf))
  await page.evaluate(() => {
    window.__editor.undo()
    window.__editor.undo()
  })
  await ready()
  sf = await subtitleFit()
  check('元に戻すと、サブタイトルの文字の大きさも 22pt に戻る', sf.pt === 22 && !sf.error && (await snap()).report.basicInfo.subtitleInput === 'シンドバッド', JSON.stringify(sf))

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
    check('コースを変えると、お知らせもそのコースのものになる（ないときは出ない）', (await noticeText()) === '', await noticeText())
  } else {
    await page.click('.popover button')
    await ready()
  }
  s = await snap()
  check('表紙の入力は、コースを変えても残る', s.report.basicInfo.studentId === '00ZZ0123' && s.report.basicInfo.name === '文化　花子' && s.report.basicInfo.subtitleInput === 'シンドバッド', JSON.stringify(s.report.basicInfo))

  // ---- 抄録：先生の許可が出てから書く（それまでは案内とボタンだけ。字数のチェックはしない） ----
  const abstractId = s.report.abstract.paragraphs[0].id
  await page.evaluate(() => window.__editor.goToArea('abstract'))
  await ready()
  const lockShown = await page.evaluate(() => !!document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current [data-abstract-start]'))
  check('抄録は、はじめは案内と「先生の許可が出た」ボタンだけで、字数のチェックは出ない', lockShown && s.findings.some((f) => f.ruleId === 'abstract-not-started') && !s.findings.some((f) => f.ruleId === 'abstract-length'))
  const startBox = await page.evaluate(() => { const r = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current [data-abstract-start]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  await page.mouse.click(startBox.x, startBox.y)
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 30000 }, abstractId)
  check('「先生の許可が出た」を押すと、抄録を書き始められる', (await snap()).report.abstract.started === true)
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

  // ---- 「。」を付けずに Enter：前の段落の終わりに「。」が付く。すぐ Backspace でつなぎ直すと元に戻る ----
  const second = blocks[i + 1].id
  const paraText = (id) => snap().then((x) => x.report.body.flatMap((c) => c.blocks).find((b) => b.id === id).content.map((n) => n.text ?? '').join(''))
  await clickBlock(second)
  await page.keyboard.press('End')
  await page.keyboard.type('そして袖を広げた')
  await page.keyboard.press('Enter')
  await page.waitForFunction((id) => { const e = window.__editor.getSnapshot().editingId; return e && e !== id }, { timeout: 30000 }, second)
  await ready()
  check('「。」を付けずに Enter で段落を分けると、前の段落の終わりに「。」が付く', (await paraText(second)) === '次の段落である。そして袖を広げた。', await paraText(second))
  await page.keyboard.press('Backspace')
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 30000 }, second)
  await page.keyboard.press('Escape')
  await ready()
  check('すぐ Backspace でつなぎ直すと、自動で付けた「。」は取り消される', (await paraText(second)) === '次の段落である。そして袖を広げた', await paraText(second))
  // 文末に「。」がない段落はエラー。カーソルをその箇所に置くと、右の一覧でその指摘が目立つ
  s = await snap()
  const endFinding = s.findings.find((x) => x.ruleId === 'sentence-end' && x.blockId === second)
  await clickBlock(second)
  await page.keyboard.press('End')
  await pause(400)
  const activeTitle = await page.evaluate(() => document.querySelector('.side .issue.active.here .ttl')?.textContent ?? '')
  check('文末に「。」がない段落はエラーになり、カーソルを置くと右の一覧でその指摘が目立つ', !!endFinding && activeTitle.includes('文末に「。」を付ける'), activeTitle)
  await page.keyboard.press('Escape')
  await ready()
  await page.evaluate((id) => { const f = window.__editor.getSnapshot().findings.find((x) => x.ruleId === 'sentence-end' && x.blockId === id); window.__editor.applyFinding(f) }, second)
  await ready()
  check('「直す」で文末に「。」が付く', (await paraText(second)) === '次の段落である。そして袖を広げた。', await paraText(second))

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

  // ---- 前に入れた図を、もう一度指す：番号を（図1）と書くと、確定したときに図とつながる ----
  await clickBlock(firstParagraph)
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.type('（図1）')
  await page.keyboard.press('Escape')
  await ready()
  s = await snap()
  const refsNow = s.report.body.flatMap((c) => c.blocks).find((b) => b.id === firstParagraph).content.filter((n) => n.type === 'ref').length
  check('（図1）と書くと、確定したときに図とつながる（番号が変わっても自動でそろう）', refsNow === 2 && !s.findings.some((x) => x.ruleId === 'figure-unreferenced' || x.ruleId === 'manual-ref'))
  await page.screenshot({ path: `${OUT}/2-figure.png` })

  // ---- 図・表は、文中の入れたい位置で入れる（書いていないときは押せない） ----
  const toolDisabled = (label) => page.evaluate((label) => [...document.querySelectorAll('.palette .tb')].find((b) => b.textContent.includes(label))?.disabled, label)
  check('段落を書いていないときは「図を入れる」「表を入れる」を押せない', (await toolDisabled('図を入れる')) === true && (await toolDisabled('表を入れる')) === true)
  const paletteNote = await page.evaluate(() => { const n = [...document.querySelectorAll('.palette .ctx-note')].find((e) => e.textContent.includes('図・表')); return n && getComputedStyle(n).display !== 'none' ? n.textContent : '' })
  check('押せないときは、その理由（入れたい位置をクリックしてから）が道具に出る', paletteNote.includes('入れたい位置をクリック'), paletteNote)
  await clickBlock(firstParagraph)
  await page.keyboard.press('End')
  await clickPaletteButton('表を入れる')
  await page.evaluate(() => [...document.querySelectorAll('.palette .side-menu button')].find((b) => b.textContent.includes('空の表')).click())
  await waitEditing(() => window.__editor.getSnapshot().editingKind === 'tableCaption')
  await ready()
  s = await snap()
  const tableBlock = s.report.body.flatMap((c) => c.blocks).find((b) => b.type === 'table' && b.id === s.editingId)
  check('「表を入れる」で、書いている位置に（表n）が入り、表のタイトルを書く欄が開く（タイトルが空ならエラー）', !!tableBlock && s.report.body.flatMap((c) => c.blocks).find((b) => b.id === firstParagraph).content.some((n) => n.type === 'ref' && n.targetId === tableBlock.id) && s.findings.some((x) => x.ruleId === 'required-text' && x.blockId === tableBlock.id), tableBlock?.id)
  await page.keyboard.type('使用した生地')
  await page.keyboard.press('Enter')
  await waitEditing((id) => window.__editor.getSnapshot().editingId === id, firstParagraph)
  check('表のタイトルを Enter で確定すると、書いていた段落の続きに戻る', true)
  await page.keyboard.press('Escape')
  await ready()
  // 表の操作：セルを書き、行・列を足し、列の幅を切り替え、セルに画像を入れる
  const tableNow = () => snap().then((x) => x.report.body.flatMap((c) => c.blocks).find((b) => b.id === tableBlock.id))
  await clickBlock((await tableNow()).rows[1].cells[0].id)
  await page.keyboard.type('サテン')
  await clickPaletteButton('行を足す')
  await waitEditing(() => window.__editor.getSnapshot().editingKind === 'tableCell')
  await ready()
  await clickPaletteButton('列を足す')
  await pause(300)
  await ready()
  await page.evaluate(() => [...document.querySelectorAll('.palette .seg button')].find((b) => b.textContent.includes('中身に合わせる')).click())
  await pause(300)
  await ready()
  let t = await tableNow()
  check('表に行と列を足し、列の幅を「中身に合わせる」にできる', t.rows.length === 3 && t.rows.every((r) => r.cells.length === 3) && t.widths === 'auto' && t.rows[1].cells[0].text === 'サテン', JSON.stringify(t.rows.map((r) => r.cells.length)))
  await clickBlock(t.rows[1].cells[0].id)
  const [cellChooser] = await Promise.all([page.waitForFileChooser(), clickPaletteButton('画像を入れる')])
  await cellChooser.accept([pngPath])
  await page.waitForFunction((id) => window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === id).rows[1].cells[0].imageId, { timeout: 30000 }, tableBlock.id)
  await ready()
  const cellImg = await page.evaluate((id) => !!document.querySelector(`.page-viewport.front [data-cell-id="${id}"] img`), t.rows[1].cells[0].id)
  check('表のセルに画像を入れられる（紙面のセルに画像が出る）', cellImg)
  await page.keyboard.press('Escape')
  await ready()
  // 図のタイトルをクリックして Enter：その図の下に段落ができる（段落を足すボタンはない）
  const figId = (await snap()).report.body.flatMap((c) => c.blocks).find((b) => b.type === 'figureRow').figures[0].id
  const blocksBefore = (await snap()).report.body.flatMap((c) => c.blocks).length
  await clickBlock(figId)
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await waitEditing(() => window.__editor.getSnapshot().editingKind === 'paragraph')
  await ready()
  s = await snap()
  const flat = s.report.body.flatMap((c) => c.blocks)
  const groupIndex = flat.findIndex((b) => b.type === 'figureRow' && b.figures.some((f) => f.id === figId))
  check('図のタイトルで Enter を押すと、その図の下に段落ができる', flat.length === blocksBefore + 1 && flat[groupIndex + 1]?.id === s.editingId, `${groupIndex}`)
  await page.keyboard.press('Escape')
  await ready()
  // 空の段落は取り消す
  await page.evaluate(() => window.__editor.undo())
  await ready()

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
  // 入っている写真を押すと、その写真を選び（写真を選ぶ画面は出さない）、道具の「外す」で枠を空にできる（mockups/v23 ⑧ 案A）
  chooserOpened = false
  page.on('filechooser', onChooser)
  const p0 = await slotBox(0)
  await page.mouse.click(p0.x, p0.y)
  await pause(300)
  const photoTools = await page.evaluate(() => ({
    sel: window.__editor.getSnapshot().selection,
    label: document.querySelector('.palette .group.ctx .ctx-label')?.textContent,
    tools: [...document.querySelectorAll('.palette .group.ctx')][0]?.textContent ?? '',
    marked: !!document.querySelector('.page-viewport.front [data-photo-slot="0"].is-selected'),
  }))
  check('入っている作品写真を押すと、その写真を選び、道具に「この写真：差し替え／外す」が出る（写真を選ぶ画面は出ない）', photoTools.sel?.index === 0 && photoTools.label === 'この写真' && photoTools.tools.includes('差し替え') && photoTools.tools.includes('外す') && photoTools.marked && !chooserOpened, JSON.stringify(photoTools))
  page.off('filechooser', onChooser)
  await page.evaluate(() => [...document.querySelectorAll('.palette .tb')].find((b) => b.textContent.includes('外す')).click())
  await pause(300)
  await ready()
  s = await snap()
  check('「外す」で枠が空になり、セルフチェックに空いている枠の注意が出る', s.report.workPhotos.imageIds[0] === '' && s.findings.some((f) => f.ruleId === 'photos-empty-slot') && !(await page.$('.page-viewport.front [data-photo-slot="0"] img')), JSON.stringify(s.report.workPhotos.imageIds))
  await page.evaluate(() => [...document.querySelectorAll('.palette .tb')].find((b) => b.textContent.includes('元に戻す')).click())
  await pause(300)
  await ready()
  s = await snap()
  check('「元に戻す」で、外した写真が戻る', s.report.workPhotos.imageIds.filter(Boolean).length === 2 && !s.findings.some((f) => f.ruleId.startsWith('photos')), JSON.stringify(s.report.workPhotos.imageIds))

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

  // ---- 章の終わり（次の章の前）の図がページの下に入りきらないときは、はみ出さずに次のページへ送る ----
  await page.evaluate(async () => {
    const make = async (w, h) => {
      const c = new OffscreenCanvas(w, h)
      c.getContext('2d').fillRect(0, 0, w, h)
      return c.convertToBlob({ type: 'image/png' })
    }
    const sizes = [[800, 800], [600, 800], [600, 800], [800, 800], [800, 800]]
    window.__editor.addImages(await Promise.all(sizes.map(async ([w, h], i) => ({ id: `ov${i}`, blob: await make(w, h), widthPx: w, heightPx: h }))))
    const t = (s) => ({ type: 'text', text: s })
    const ref = (id) => ({ type: 'ref', targetId: id, withParens: true })
    const blocks = [
      { type: 'paragraph', id: 'ovp1', content: [t('袖を広げた'), ref('ovf0'), ref('ovf1'), ref('ovf2'), ref('ovf3'), t('。')] },
      { type: 'figureRow', id: 'ovg1', figures: [0, 1, 2, 3].map((i) => ({ id: `ovf${i}`, imageId: `ov${i}`, caption: '見本' })) },
      { type: 'paragraph', id: 'ovp2', content: [t('仕上げた'), ref('ovf4'), t('。')] },
      { type: 'figureRow', id: 'ovg2', figures: [{ id: 'ovf4', imageId: 'ov4', caption: '完成' }] },
    ]
    window.__editor.update((r) => ({ ...r, body: [{ id: 'ovc1', title: '制作過程', blocks }, { id: 'ovc2', title: 'まとめ', blocks: [{ type: 'paragraph', id: 'ovp3', content: [t('まとめ。')] }] }] }))
  })
  await pause(300)
  await ready()
  const overflow = await page.evaluate(() => {
    const vp = document.querySelector('.page-viewport.front')
    vp.classList.add('measuring')
    const el = vp.querySelector('.figure-group[data-group-id="ovg2"]')
    const pg = el.closest('[data-vivliostyle-page-container]')
    const pr = pg.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const res = { top: Math.round(((r.top - pr.top) / pr.height) * 297), bottom: Math.round(((r.bottom - pr.top) / pr.height) * 297) }
    vp.classList.remove('measuring')
    return res
  })
  check('章の終わりの図がページの下に入りきらないときは、はみ出さずに次のページの上へ送る', overflow.bottom <= 272 && overflow.top <= 26, JSON.stringify(overflow))

  // ---- 左右の欄の境目をつかんで、幅を変える（ダブルクリックで元の幅） ----
  const colWidth = (sel) => page.evaluate((sel) => Math.round(document.querySelector(sel).getBoundingClientRect().width), sel)
  const dragHandle = async (side, dx) => {
    const h = await page.evaluate((side) => { const r = document.querySelector(`.resize-handle.${side}`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 300 } }, side)
    await page.mouse.move(h.x, h.y)
    await page.mouse.down()
    for (let k = 1; k <= 6; k++) await page.mouse.move(h.x + (dx * k) / 6, h.y)
    await page.mouse.up()
    await pause(300)
  }
  const leftBefore = await colWidth('.thumbs-col')
  const rightBefore = await colWidth('.side')
  await dragHandle('left', 60)
  await dragHandle('right', -80)
  const leftAfter = await colWidth('.thumbs-col')
  const rightAfter = await colWidth('.side')
  check('左右の欄の境目をつかんで動かすと、欄の幅が変わる', leftAfter >= leftBefore + 50 && rightAfter >= rightBefore + 70, `${leftBefore}→${leftAfter} / ${rightBefore}→${rightAfter}`)
  await page.evaluate(() => document.querySelector('.resize-handle.left').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  await pause(300)
  check('境目をダブルクリックすると、元の幅に戻る', (await colWidth('.thumbs-col')) === leftBefore, String(await colWidth('.thumbs-col')))

  // ---- 抄録を書き始める前は、PDF に抄録のページを入れない ----
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, abstract: { ...r.abstract, started: false } })))
  await pause(300)
  await ready()
  s = await snap()
  await page.pdf({ path: `${OUT}/no-abstract.pdf`, preferCSSPageSize: true, printBackground: true })
  const naDoc = await getDocument({ url: `${OUT}/no-abstract.pdf`, verbosity: 0 }).promise
  let naText = ''
  for (let n = 1; n <= naDoc.numPages; n++) naText += (await (await naDoc.getPage(n)).getTextContent()).items.map((it) => it.str).join('')
  check('抄録を書き始める前は、PDF に抄録のページが入らない（画面には残る）', naDoc.numPages === s.layout.kinds.length - 1 && !/卒業制作\s*抄録/.test(naText) && s.layout.kinds.includes('abstract'), `${naDoc.numPages} / ${s.layout.kinds.length}ページ`)

  // ---- エラーが残っていても、「下書き」の透かし入りの PDF は書き出せる（mockups/v22 ① 案A） ----
  // 文末に「。」がない段落を作る（補助の指摘のエラー）
  const keepId = await page.evaluate(() => {
    const ed = window.__editor
    const target = ed.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.type === 'paragraph')
    ed.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === target.id ? { ...b, content: [{ type: 'text', text: '袖を大きく広げた' }] } : b)) })) }))
    return target.id
  })
  await pause(300)
  await ready()
  await page.evaluate(() => {
    window.print = () => (window.__printed = { draft: document.documentElement.classList.contains('print-draft'), title: document.title })
  })
  await page.click('.side .export')
  await page.waitForSelector('.modal .draft-box .pdf-draft')
  const titleBefore = await page.title()
  // 印刷の画面から保存する道（「うまくいかないとき」を開いてから）
  await page.click('.modal .draft-box .pdf-fallback')
  await page.waitForSelector('.modal .draft-box .pdf-print')
  await page.click('.modal .draft-box .pdf-print')
  await page.waitForFunction(() => !!window.__printed)
  const printed = await page.evaluate(() => window.__printed)
  // 印刷画面が開いているときの見た目：どのページにも「下書き」が入る（透かしは PDF の文字としては取り出せないので、印刷のときの見た目で確かめる。PDF は目視用）
  // （PDF に書き出すと「印刷が終わった」ことになり、透かしの印が外れるので、見た目を確かめてから書き出す）
  await page.evaluate(() => document.documentElement.classList.add('print-draft'))
  await page.emulateMediaType('print')
  const draftPages = await page.evaluate(() => [...document.querySelectorAll('.page-viewport.front [data-vivliostyle-page-container]')].map((p) => getComputedStyle(p, '::after').content))
  await page.emulateMediaType(null)
  await page.pdf({ path: `${OUT}/draft.pdf`, preferCSSPageSize: true, printBackground: true })
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  const afterPrint = await page.evaluate(() => ({ draft: document.documentElement.classList.contains('print-draft'), title: document.title }))
  check('エラーが残っていても、下書きの欄の「うまくいかないとき：印刷の画面から保存」から印刷に進め、ファイル名に「_下書き」が付く（終わると元に戻る）', printed.draft && printed.title.endsWith('_下書き') && !afterPrint.draft && afterPrint.title === titleBefore, JSON.stringify(printed))
  check('下書きの PDF は、どのページにも「下書き」の透かしが入る', draftPages.length > 0 && draftPages.every((t) => t.includes('下書き')), draftPages.map((t) => (t.includes('下書き') ? '○' : '×')).join(''))
  await page.emulateMediaType('print')
  const plainPages = await page.evaluate(() => [...document.querySelectorAll('.page-viewport.front [data-vivliostyle-page-container]')].map((p) => getComputedStyle(p, '::after').content))
  await page.emulateMediaType(null)
  check('提出用の PDF には透かしが入らない', plainPages.length > 0 && !plainPages.some((t) => t.includes('下書き')), plainPages.join(','))

  // ---- 下書きの PDF を、ツールの中で作って保存する（「やめる」・作れなかったときも） ----
  {
    const title = await page.evaluate(() => window.__editor.pdfTitle)
    await page.click('.side .export')
    await page.waitForSelector('.modal .draft-box .pdf-draft')
    check('エラーが残っているときは「下書きの PDF を保存する」', (await page.$eval('.modal .draft-box .pdf-draft', (b) => b.textContent)) === '下書きの PDF を保存する')
    // やめる：ページとページの間で止まり、最初の窓に戻る
    await page.click('.modal .draft-box .pdf-draft')
    await page.waitForFunction(() => document.querySelectorAll('.modal .pdf-thumbs img').length >= 1, { timeout: 60000 })
    await page.evaluate(() => [...document.querySelectorAll('.modal .row-buttons button')].find((b) => b.textContent === 'やめる').click())
    await pause0(1500)
    check('作っている途中の「やめる」で止まり、最初の窓に戻る（保存しない）', !!(await page.$('.modal .draft-box .pdf-draft')) && !existsSync(`${DOWNLOADS}/${title}_下書き.pdf`))
    // 下書きの PDF を作って保存する
    await page.click('.modal .draft-box .pdf-draft')
    await page.waitForSelector('.modal .pdf-open', { timeout: 120000 })
    const draftDone = await page.evaluate(() => ({ title: document.querySelector('.modal h2')?.textContent, file: document.querySelector('.modal .pdf-file b')?.textContent, note: document.querySelector('.modal .lead')?.textContent ?? '' }))
    const printedPages = await page.evaluate(() => window.__editor.pageElements().filter((p) => !p.classList.contains('print-skip')).length)
    const saved = await savedPdf(`${title}_下書き.pdf`)
    await page.screenshot({ path: `${OUT}/0-pdf-draft-saved.png` })
    check('下書きの PDF も同じ流れで作って保存し、ファイル名に「_下書き」が付く（透かしの説明）', draftDone.title === '下書きの PDF を保存しました' && draftDone.file === `${title}_下書き.pdf` && draftDone.note.includes('透かし') && saved.pages === printedPages, JSON.stringify({ draftDone, saved, printedPages }))
    await page.click('.modal .close')
    await pause0(300)
    // 作れなかったとき（画像を JPEG にできない）：印刷の画面から保存する道を出す
    await page.evaluate(() => {
      window.__toBlob = HTMLCanvasElement.prototype.toBlob
      HTMLCanvasElement.prototype.toBlob = function (cb) {
        cb(null)
      }
    })
    await page.click('.side .export')
    await page.waitForSelector('.modal .draft-box .pdf-draft')
    await page.click('.modal .draft-box .pdf-draft')
    await page.waitForSelector('.modal .pdf-print', { timeout: 60000 })
    const failed = await page.evaluate(() => ({ title: document.querySelector('.modal h2')?.textContent, guide: document.querySelector('.modal .print-guide')?.textContent ?? '', retry: [...document.querySelectorAll('.modal button')].some((b) => b.textContent === 'もう一度作る') }))
    await page.screenshot({ path: `${OUT}/0-pdf-failed.png` })
    await page.evaluate(() => {
      HTMLCanvasElement.prototype.toBlob = window.__toBlob
    })
    check('作れなかったときは「PDF を作れませんでした」と、印刷の画面での選び方・「印刷の画面を開く」・「もう一度作る」を出す', failed.title === 'PDF を作れませんでした' && failed.guide.includes('印刷の画面で') && failed.guide.includes('_下書き.pdf') && failed.retry, JSON.stringify(failed))
    await page.click('.modal .close')
    await pause0(300)
  }

  // ---- 補助の指摘は「このままにする（確認済み）」にでき、「戻す」で元に戻る（mockups/v22 ① 案A） ----
  const keepKey = `sentence-end|${keepId}|`
  const keepClicked = await page.evaluate((key) => {
    const ed = window.__editor
    const f = ed.getSnapshot().findings.find((x) => x.key?.startsWith(key))
    if (!f) return false
    const li = [...document.querySelectorAll('.side .issue')].find((el) => el.querySelector('.keep') && el.textContent.includes(f.title) && (!f.detail || el.textContent.includes(f.detail)))
    li?.querySelector('.keep').click()
    return !!li
  }, keepKey)
  await pause(300)
  await ready()
  s = await page.evaluate(() => { const s = window.__editor.getSnapshot(); return { acked: s.report.acknowledged ?? [], left: s.findings.filter((f) => f.key).map((f) => f.key), summary: document.querySelector('.side details.acked summary')?.textContent ?? '' } })
  check('補助の指摘を「このままにする（確認済み）」にすると、エラーに数えず「確認済み」の一覧へ移る', keepClicked && s.acked.some((k) => k.startsWith(keepKey)) && !s.left.some((k) => k.startsWith(keepKey)) && s.summary.includes('確認済み 1件'), s.summary)
  await page.evaluate(() => [...document.querySelectorAll('.side details.acked button')].find((b) => b.textContent === '戻す').click())
  await pause(300)
  await ready()
  s = await page.evaluate(() => { const s = window.__editor.getSnapshot(); return { acked: s.report.acknowledged ?? [], left: s.findings.filter((f) => f.key).map((f) => f.key) } })
  check('「戻す」で、元の指摘に戻る', s.acked.length === 0 && s.left.some((k) => k.startsWith(keepKey)))

  // ---- 同じパソコンで2つめのタブを開くと、そのタブでは書けない（mockups/v22 ③ 案A） ----
  const page2 = await context.newPage()
  await noHotReload(page2)
  await stubConfig(page2)
  page2.on('pageerror', (e) => console.log('pageerror(2):', e.message))
  await page2.setViewport({ width: 1440, height: 900 })
  await page2.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0' })
  const lockedShown = await page2.waitForSelector('.tab-locked', { timeout: 30000 }).then(() => true, () => false)
  check('2つめのタブで開くと、「別のタブで開いています」の窓が出て、そのタブでは書けない', lockedShown && !(await page.$('.tab-locked')))
  await page2.screenshot({ path: `${OUT}/tab-locked.png` })
  const reloaded = page2.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 })
  await page2.evaluate(() => [...document.querySelectorAll('.tab-locked button')].find((b) => b.textContent.includes('こちらで続ける')).click())
  const firstLocked = await page.waitForSelector('.tab-locked', { timeout: 15000 }).then(() => true, () => false)
  await reloaded
  await page2.waitForFunction(() => window.__editor?.getSnapshot()?.layout && !document.querySelector('.loading'), { timeout: 60000 })
  await pause(500)
  check('「こちらで続ける」を押すと、そのタブで書けるようになり、もう一方のタブが書けなくなる', firstLocked && !(await page2.$('.tab-locked')))
  await page2.close()
  await context.close()

  // ---- 今年度だけ：Word から読み込む（mockups/v24。見本の Word は scripts/e2e/fixtures） ----
  await wordImportCheck(browser)

  // ---- 「PDFを書き出す」：エラーが0件の原稿で、ツールの中で PDF を作り、そのまま保存する（mockups/v28 案C） ----
  await pdfSaveCheck(browser)
})

/** エラーが0件の見本の原稿で、3つを確かめる → PDF を作る（進み具合・できたページの絵）→「ダウンロード」に保存、までを確かめる */
async function pdfSaveCheck(browser) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await noHotReload(page)
  await stubConfig(page)
  page.on('pageerror', (e) => console.log('pageerror(pdf):', e.message))
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  })
  await (await page.createCDPSession()).send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: resolve(DOWNLOADS), browserContextId: context.id })
  await page.setViewport({ width: 1440, height: 900 })
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0' })
  const ready = () =>
    page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 60000 })
  const pause = (ms) => new Promise((r) => setTimeout(r, ms))
  await ready()
  await page.waitForSelector('.guide.step-course .g-opts button')
  await page.evaluate(() => document.querySelector('.g-opts button').click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.g-later')
  await page.evaluate(() => document.querySelector('.g-later').click())
  await page.evaluate(() => window.__editor.finishEditing())
  await ready()
  await page.evaluate(setupWriting)
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, studentId: '00ZZ0123' } })))
  await pause(800)
  await ready()
  const errorsNow = await page.evaluate(() => window.__editor.getSnapshot().findings.filter((f) => f.severity === 'error').map((f) => f.title))
  await page.click('.side .export')
  await page.waitForSelector('.modal .checklist')
  const confirm = await page.evaluate(() => ({
    start: document.querySelector('.modal .pdf-start')?.textContent,
    disabled: document.querySelector('.modal .pdf-start')?.disabled,
    file: document.querySelector('.modal .pdf-file b')?.textContent,
    fallback: document.querySelector('.modal .row-buttons .pdf-fallback')?.textContent,
  }))
  const title = await page.evaluate(() => window.__editor.pdfTitle)
  check(
    '「PDFを書き出す」の窓：3つを確かめるまで「PDF を保存する」は押せず、ファイル名と、左下に「うまくいかないとき：印刷の画面から保存」が出る',
    errorsNow.length === 0 && confirm.start === 'PDF を保存する' && confirm.disabled && confirm.file === `${title}.pdf` && confirm.fallback?.includes('印刷の画面から保存'),
    JSON.stringify({ errorsNow, ...confirm }),
  )
  // 「うまくいかないとき」を開くと、今までの印刷の画面での選び方と「印刷の画面を開く」が出る
  await page.click('.modal .row-buttons .pdf-fallback')
  check('「うまくいかないとき：印刷の画面から保存」を押すと、印刷の画面での選び方と「印刷の画面を開く」が出る', await page.evaluate(() => !!document.querySelector('.modal .pdf-print-box .print-guide') && !!document.querySelector('.modal .pdf-print-box .pdf-print')))
  await page.click('.modal .row-buttons .pdf-fallback')
  await page.evaluate(() => document.querySelectorAll('.modal .checklist input').forEach((i) => i.click()))
  await page.click('.modal .pdf-start')
  // 作っている途中：進み具合と、できたページの小さな絵
  await page.waitForFunction(() => document.querySelectorAll('.modal .pdf-thumbs img').length >= 1, { timeout: 60000 })
  const building = await page.evaluate(() => ({ title: document.querySelector('.modal h2')?.textContent, progress: document.querySelector('.modal .pdf-progress span')?.textContent ?? '', tiles: document.querySelectorAll('.modal .pdf-thumbs figure').length }))
  await page.screenshot({ path: `${OUT}/0-pdf-building.png` })
  await page.waitForSelector('.modal .pdf-open', { timeout: 120000 })
  await pause(300)
  const done = await page.evaluate(() => ({
    title: document.querySelector('.modal h2')?.textContent,
    file: document.querySelector('.modal .pdf-file')?.textContent ?? '',
    thumbs: [...document.querySelectorAll('.modal .pdf-thumbs img')].filter((i) => i.complete && i.naturalWidth > 0 && i.src.startsWith('blob:')).length,
    focus: document.activeElement?.classList.contains('pdf-open'),
  }))
  await page.screenshot({ path: `${OUT}/0-pdf-saved.png` })
  const printedPages = await page.evaluate(() => window.__editor.pageElements().filter((p) => !p.classList.contains('print-skip')).length)
  const saved = await savedPdf(`${title}.pdf`)
  check('作っている間は「PDF を作っています」と、進み具合（〇 / 〇ページ）と、全ページの枠が出る', building.title === 'PDF を作っています' && /\d+ \/ \d+ページ/.test(building.progress) && building.tiles === printedPages, JSON.stringify(building))
  check(
    'できたら「保存しました」と、ファイル名・ページの数・できたページの小さな絵（全ページ）を出し、「PDF を開く」に移る',
    done.title === '保存しました' && done.file.includes(`${title}.pdf`) && done.file.includes(`${printedPages}ページ`) && done.thumbs === printedPages && done.focus,
    JSON.stringify(done),
  )
  check('PDF は「ダウンロード」に、決まったファイル名で保存され、ページの数が紙面と同じ', saved.head === '%PDF-' && saved.pages === printedPages, JSON.stringify({ ...saved, printedPages }))
  await page.click('.modal .close')
  await pause(300)
  check('窓を閉じると、ふだんの画面に戻る', !(await page.$('.modal')))
  await context.close()
}

/** 見本の Word（本文・表紙）を、はじめての案内から読み込み、写したあとの「つぎにすること」と「読み込む前の原稿に戻す」までを確かめる */
async function wordImportCheck(browser) {
  // 見本の Word の置き場所（WORD_FIXTURES で変えられる）
  const FIX = process.env.WORD_FIXTURES ?? 'scripts/e2e/fixtures'
  const bodyDocx = `${FIX}/word-sample-body.docx`
  const coverDocx = `${FIX}/word-sample-cover.docx`
  if (!existsSync(bodyDocx) || !existsSync(coverDocx)) {
    check('見本の Word（scripts/e2e/fixtures/word-sample-body.docx・word-sample-cover.docx）がある', false)
    return
  }
  // まっさらな状態から（別の入れ物で開く）
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await noHotReload(page)
  await stubConfig(page)
  page.on('pageerror', (e) => console.log('pageerror(word):', e.message))
  await page.setViewport({ width: 1440, height: 900 })
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0' })
  const ready = () =>
    page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 60000 })
  await ready()
  const pause = (ms = 400) => new Promise((r) => setTimeout(r, ms))
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
  const template = await page.evaluate(() => window.__editor.getSnapshot().report)
  await page.evaluate(() => document.querySelector('.g-word-opt.yes').click())
  await page.waitForSelector('.modal.word-mid')
  const start = await page.evaluate(() => ({
    guide: !!document.querySelector('.guide'),
    disabled: [...document.querySelectorAll('.modal .row-buttons button')].find((b) => b.textContent.includes('中身を確かめる'))?.disabled,
    accept: document.querySelector('.word-file input[type="file"]')?.getAttribute('accept') ?? '',
    hint: document.querySelector('.word-hint')?.textContent ?? '',
  }))
  check('「はい、Word から読み込む」で Word を選ぶ窓が開く（案内は隠れる。.docx だけ選べ、本文を選ぶまで「中身を確かめる」は押せない。PC の選び方の説明）', !start.guide && start.disabled === true && start.accept.startsWith('.docx') && start.hint.includes('OneDrive'), JSON.stringify(start))
  // 「やめる」で、案内の「Word で書き始めていますか？」に戻る
  await clickButton('.modal .row-buttons button', 'やめる')
  await page.waitForSelector('.guide.step-word .g-word-opt.yes')
  check('「やめる」で窓を閉じると、案内の「Word で書き始めていますか？」に戻る', !(await page.$('.modal')))
  await page.evaluate(() => document.querySelector('.g-word-opt.yes').click())
  await page.waitForSelector('.modal.word-mid')
  // 古い形の Word（.doc）は、選んだところで理由を出す
  const docPath = join(tmpdir(), 'sotsugyo-e2e-old.doc')
  writeFileSync(docPath, 'old')
  await choose(0, docPath)
  const docError = await page.evaluate(() => document.querySelector('.word-file small.err')?.textContent ?? '')
  check('古い形の Word（.doc）を選ぶと、その場で理由と直し方が出る', docError.includes('.doc') && docError.includes('.docx'), docError)

  // 見本の本文・表紙を選んで、中身を確かめる
  await choose(0, bodyDocx)
  await choose(1, coverDocx)
  await clickButton('.modal .row-buttons button', '中身を確かめる')
  await page.waitForSelector('.modal.word-modal, .word-error', { timeout: 60000 })
  const readError = await page.evaluate(() => document.querySelector('.word-error')?.textContent ?? '')
  if (readError) {
    check('見本の Word を読み取れる', false, readError)
    await context.close()
    return
  }
  // 図の小さな画像が読み込まれるのを待つ
  await page.waitForFunction(() => [...document.querySelectorAll('.word-figs img')].every((i) => i.complete), { timeout: 20000 })
  const shown = await page.evaluate(() => ({
    chapters: document.querySelectorAll('.word-outline li.ch').length,
    rows: document.querySelectorAll('.word-outline li').length,
    counts: Object.fromEntries([...document.querySelectorAll('.word-count span')].map((s) => [s.firstChild.textContent.trim(), Number(s.querySelector('b').textContent)])),
    cover: [...document.querySelectorAll('.word-cover dd')].map((d) => d.textContent),
    figures: document.querySelectorAll('.word-figs figure').length,
    loaded: [...document.querySelectorAll('.word-figs img')].filter((i) => i.naturalWidth > 0).length,
    keep: document.querySelector('.word-keep')?.textContent ?? '',
    focus: document.activeElement?.className ?? '',
    font: getComputedStyle(document.querySelector('.word-picked .fn')).fontFamily,
  }))
  await page.screenshot({ path: `${OUT}/word-confirm.png` })
  check(
    '本文と表紙の Word を読み取ると、写す前に、組み立ての一覧・数・表紙の項目・図の小さな画像・控えに残すことを見せる',
    shown.chapters > 0 && shown.rows >= shown.chapters && shown.counts['大見出し'] > 0 && shown.cover.length === 3 && shown.figures === shown.counts['図'] && shown.loaded > 0 && shown.keep.includes('自動の控え'),
    JSON.stringify(shown),
  )
  check('確かめる窓は、上（選んだファイル）から読み上げる。ファイル名は英数字の書体で出す（「_」が見えるように）', shown.focus === 'word-picked' && shown.font.startsWith('"Segoe UI"'), `${shown.focus} / ${shown.font}`)

  await clickButton('.modal .row-buttons button', '読み込む')
  await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 60000 })
  await pause(500)
  await ready()
  const after = await page.evaluate(async () => {
    const { allImages, listSnapshots } = await import('/src/model/storage.ts')
    const s = window.__editor.getSnapshot()
    const figures = s.report.body.flatMap((c) => c.blocks).flatMap((b) => (b.type === 'figureRow' ? b.figures : []))
    const stored = new Set((await allImages()).map((i) => i.id))
    return {
      report: s.report,
      kind: s.layout.kinds[s.page],
      figures: figures.filter((f) => f.imageId).length,
      storedAll: figures.filter((f) => f.imageId).every((f) => stored.has(f.imageId)),
      kept: (await listSnapshots()).filter((x) => x.keep).length,
      guide: document.querySelector('.guide')?.className ?? null,
      todo: document.querySelector('.side .word-todo')?.textContent ?? '',
      link: !!document.querySelector('.side .word-link'),
    }
  })
  await page.screenshot({ path: `${OUT}/word-after.png` })
  const b = after.report.basicInfo
  check(
    '「読み込む」で本文が Word の中身に入れ替わり、図の画像もこの端末に入る（年度・コースはそのまま。今の原稿は控えに残る）',
    after.report.body.length === shown.chapters && after.figures === shown.counts['図'] && after.storedAll && after.report.fiscalYear === template.fiscalYear && b.courseId === template.basicInfo.courseId && after.kept >= 1,
    JSON.stringify({ chapters: after.report.body.map((c) => c.title), figures: after.figures, kept: after.kept }),
  )
  const coverRead = shown.cover.every((t) => !t.includes('読み取れませんでした'))
  check(
    '表紙の項目が読み取れていれば表紙に入り、案内を閉じて本文へ進む（読み取れなかった項目があれば、その項目の案内に進む）',
    coverRead ? !!b.studentId && !!b.name && !!b.subtitleInput && after.guide === null && after.kind === 'body' : after.guide !== null,
    JSON.stringify({ basicInfo: b, guide: after.guide, page: after.kind }),
  )
  check('右の欄の上に「Word から写しました」の「つぎにすること」が出る（リンクは隠す）', after.todo.includes('Word から写しました') && after.todo.includes('読み込む前の原稿に戻す') && !after.link, after.todo)
  if (after.guide) {
    await page.evaluate(() => document.querySelector('.g-later')?.click())
    await ready()
  }

  // 「図1へ」で、図1を選んで見せる。表紙のページを開くと「表紙を確かめる」が済みになる
  if (after.figures > 0) {
    await clickButton('.side .word-todo .go', '図1へ')
    await pause(700)
    await ready()
    const fig = await page.evaluate(() => ({ sel: window.__editor.getSnapshot().selection, next: [...document.querySelectorAll('.side .word-todo .go')].map((x) => x.textContent) }))
    check('「図1へ」で図1のページへ移って図を選び、ボタンが「図2へ」に進む（図が1枚なら済みになる）', fig.sel?.kind === 'figure' && (after.figures === 1 || fig.next.includes('図2へ')), JSON.stringify(fig))
  }
  await page.evaluate(() => window.__editor.goToPage(0, 'none'))
  await pause(300)
  await ready()
  const coverDone = await page.evaluate(() => [...document.querySelectorAll('.side .word-todo li')].find((li) => li.textContent.includes('表紙を確かめる'))?.className)
  check('表紙のページを開くと、「表紙を確かめる」に ✓ が付く', coverDone === 'done', coverDone)
  check('Word から読み込んだあと（案内を終えていない）は、指差し確認を出さない', !(await page.$('.tour')))
  // 閉じるまで残る（読み込み直しても）。読み込み直すと指差し確認が出るので、見たことにしておく（指差し確認は上の確かめで見る）
  await page.evaluate(() => localStorage.setItem('sotsugyo-seisaku-report-tour', 'done'))
  await page.reload({ waitUntil: 'networkidle0' })
  await ready()
  await pause(300)
  check('「つぎにすること」は、読み込み直しても閉じるまで残る（済んだものの ✓ も）', await page.evaluate(() => !!document.querySelector('.side .word-todo li.done')))

  // 読み込む前の原稿に戻す（ツールのひな形のままの原稿に戻る）
  page.once('dialog', (d) => d.accept())
  await clickButton('.side .word-todo .undo', '読み込む前の原稿に戻す')
  await page.waitForFunction(() => !document.querySelector('.side .word-todo'), { timeout: 20000 })
  await pause(300)
  await ready()
  const restored = await page.evaluate(() => {
    const r = window.__editor.getSnapshot().report
    return { body: JSON.stringify(r.body), basicInfo: r.basicInfo, link: !!document.querySelector('.side .word-link') }
  })
  check('「読み込む前の原稿に戻す」で、読み込む前の原稿に戻り、「つぎにすること」は消えてリンクが戻る', restored.body === JSON.stringify(template.body) && restored.basicInfo.name === template.basicInfo.name && restored.link, JSON.stringify(restored.basicInfo))
  await context.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 件 合格`)
process.exitCode = failed.length ? 1 : 0
