// 通しの動作確認（Edge を自動で操作する）。
// 新しい報告書に、表紙・抄録・本文を入力し、指摘を直し、図を入れ、PDF に書き出すまでを行う。
// 使い方: node scripts/e2e/smoke.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { withEdge } from '../poc/edge.mjs'
import { stubConfig } from './configStub.mjs'
import { firstTimeV3Pc, firstTimeV3Word } from './firstTimeV3.mjs'
import { editorFixesV3Pc } from './editorFixesV3.mjs'
import { teacherTrialPc } from './teacherTrialFixes.mjs'
import { rangeSelectPc } from './rangeSelect.mjs'
import { writingWrapPc } from './writingWrap.mjs'
import { photoPagesPc } from './photoPages.mjs'
import { tocLinksPc } from './tocLinks.mjs'
import { autoHeadingPc } from './autoHeading.mjs'
import { captionGapPc } from './captionGap.mjs'
import { tableShapePc } from './tableShape.mjs'
import { paletteFitPc, tableCustomPc } from './tableCustom.mjs'
import { cellBorderPc } from './cellBorder.mjs'
import { tableSettingsPc } from './tableSettings.mjs'
import { closeShape, pickWidth } from './shapeUi.mjs'
import { waitingPc } from './waiting.mjs'
import { templateStudentPc } from './templateStudent.mjs'
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
/**
 * 組み直しを速くする仕組み（表紙・抄録・目次・章ごとに分けて組む、変わらない部分や前の紙面の使い回し、ページ番号の付け直し）で
 * 表に出ている紙面が、同じ状態（目次の番号・次のページへ送る図・サブタイトルの大きさ）で報告書全体を1つの文書として組んだ紙面と同じか。
 * ページごとに、各要素の位置と大きさ（ページの中の mm）・文字数と、ページ番号を比べる
 */
const paperMatchesWhole = (page) =>
  page.evaluate(async () => {
    const ed = window.__editor
    const r = ed.renderer
    const { buildReportDocument } = await import('/src/layout/document.ts')
    const { PartView } = await import('/src/editor/pageView.ts')
    const { fitFigureSize } = await import('/src/model/images.ts')
    const image = (id) => ed.images.get(id)
    const html = buildReportDocument(ed.getSnapshot().report, ed.config, {
      imageSrc: (id) => image(id)?.url ?? ed.placeholderImage,
      photoSrc: (id) => image(id)?.url ?? ed.placeholderImage,
      figureSize: (f) => (image(f.imageId) ? fitFigureSize(image(f.imageId), 80) : { widthMm: 60, heightMm: 45 }),
      tocPageNumbers: r.tocPageNumbers,
      deferredGroups: r.deferredGroups,
      coverSubtitlePt: r.coverSubtitle?.pt,
      tableFits: r.tableFits,
    })
    const mm = (v) => Math.round(v * 10) / 10
    const geometry = (pages) =>
      pages.map((p) => {
        const box = p.getBoundingClientRect()
        const at = (b) => [mm(((b.top - box.top) / box.height) * 297), mm(((b.left - box.left) / box.height) * 297), mm(((b.bottom - box.top) / box.height) * 297), mm(((b.right - box.left) / box.height) * 297)]
        const items = [...p.querySelectorAll('[data-block-id], figure, .figure-group, .data-table, h1, h2, p, li, [data-photo-slot]')].map((el) => [el.tagName, el.getAttribute('data-block-id') ?? el.getAttribute('data-group-id') ?? '', ...at(el.getBoundingClientRect()), (el.textContent ?? '').length])
        return { number: p.querySelector('[data-vivliostyle-page-margin-box="bottom-center"]')?.textContent ?? '', items }
      })
    const front = r.viewport
    front.classList.add('measuring')
    const shown = geometry(r.pageView.pages())
    front.classList.remove('measuring')
    // 全体を1つの文書として組む（表の紙面と同じ台の上に、見えないように置く）
    const box = document.createElement('div')
    box.className = 'page-viewport measuring'
    box.inert = true
    front.parentElement.append(box)
    const part = document.createElement('div')
    part.className = 'paper-part'
    box.append(part)
    try {
      await new PartView(part).render(html)
      const whole = geometry([...box.querySelectorAll('[data-vivliostyle-page-container]')])
      const diff = shown.findIndex((s, i) => JSON.stringify(s) !== JSON.stringify(whole[i]))
      return { same: JSON.stringify(shown) === JSON.stringify(whole), pages: `${shown.length}/${whole.length}`, firstDiffPage: diff }
    } finally {
      box.remove()
    }
  })
/**
 * 右の欄の「≡ メニュー」を開いて、項目を押す（mockups/v37 案C。「？ 使い方」「バックアップ・作り直す」「Word で書いた分を読み込む」はこの中）。
 * name：項目の名前の一部（例「使い方」）
 */
const pickMenu = async (page, name) => {
  if (!(await page.$('.side .head-menu'))) await page.click('.side .menu-btn')
  await page.waitForSelector('.side .head-menu [role="menuitem"]')
  await page.evaluate((name) => [...document.querySelectorAll('.side .head-menu [role="menuitem"]')].find((b) => b.textContent.includes(name)).click(), name)
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
  // 見出しは「コースからのお知らせ」だけ（右の欄の上の半分を詰める。mockups/v35 ①）
  check('右の欄に、自分のコースのお知らせが出る（見出しは「コースからのお知らせ」）', (await noticeText()).startsWith('コースからのお知らせ') && (await noticeText()).includes('衣装コースへのお知らせ'), await noticeText())
  // 「？ 使い方」「バックアップ・作り直す」「Word で書いた分を読み込む」は、名前の横の「≡ メニュー」の中（mockups/v37 案C。中身はこのあと確かめる）
  check(
    '右の欄の名前の横に「メニュー」のボタンがあり（閉じている）、前の「バックアップ・作り直す」「使い方」のボタンと Word のリンクは右の欄の上に並ばない',
    await page.evaluate(() => !!document.querySelector('.side .brand-row .menu-btn[aria-haspopup="menu"][aria-expanded="false"]') && !document.querySelector('.side .links, .side .help-btn, .side .backup-btn, .side .word-link, .side .head-menu')),
  )
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
      text: document.querySelector('.tour-tip p')?.textContent ?? '',
      // 光の枠が、右の欄の「メニュー」のボタンを囲んでいるか
      onMenu: (() => {
        const s = document.querySelector('.tour-spot')?.getBoundingClientRect()
        const b = document.querySelector('.side .menu-btn')?.getBoundingClientRect()
        return !!s && !!b && s.left <= b.left && s.right >= b.right && s.top <= b.top && s.bottom >= b.bottom
      })(),
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
  check(
    '最後は「？ 使い方」：右上の「メニュー」のボタンに光を当て、「？ 使い方」はメニューの中と伝える。「おわり」と、メニューの使い方からもう一度見られることを伝える（「とばす」はない）',
    lastStep?.next === 'おわり' && !lastStep.skip && lastStep.onMenu && lastStep.text.includes('「メニュー」の中') && lastStep.again.includes('メニュー') && lastStep.again.includes('使い方'),
    JSON.stringify(lastStep),
  )
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.querySelector('.tour'), { timeout: 10000 }).catch(() => {})
  check('「おわり」で閉じ、見たことをこの端末に覚える', !(await page.$('.tour')) && (await page.evaluate((k) => localStorage.getItem(k), TOUR_KEY)) === 'done')

  // ---- 右の欄のセルフチェック（mockups/v35 ① 案A）：「まだのところ」（灰色の ○）と「直すところ」（書いた文の間違い）に分ける ----
  // 表紙を入れただけの書き始めは「直すところ 0」で、赤い字・印が出ない。引用・参考文献のボタンは右の欄にない（使い方から入れる）
  const freshPanel = await page.evaluate(() => {
    const sec = document.querySelector('.side .sec.check')
    const red = [...sec.querySelectorAll('*')].filter((e) => { const cs = getComputedStyle(e); return cs.color === 'rgb(181, 68, 59)' || cs.backgroundColor === 'rgb(181, 68, 59)' }).map((e) => e.className || e.tagName)
    return {
      // 数は小見出しの横の小さな札（mockups/v37。直すところは 0 なので出さない）。小見出しの右のひとことは、マウスを乗せたときだけ（title）
      tally: [...sec.querySelectorAll('.check-sub')].map((s) => s.textContent.replace(/\s/g, '')).join(','),
      oldTally: !!document.querySelector('.side .tally'),
      hints: [...sec.querySelectorAll('.check-sub')].map((s) => s.title).join(','),
      fold: !!sec.querySelector('.done-fold'),
      rows: [...sec.querySelectorAll('.check-prog li')].map((li) => `${li.className}:${li.querySelector('.l')?.textContent}:${li.querySelector('.v')?.textContent}`),
      none: sec.querySelector('.check-none')?.textContent ?? '',
      issues: sec.querySelectorAll('.issue').length,
      legend: !!sec.querySelector('.sev-legend'),
      red,
      note: document.querySelector('.side-foot .export-note')?.textContent ?? '',
      refs: !!document.querySelector('.side .add-refs, .side .refs-link'),
      // 保存のようすと締切が1行（2つの縦の真ん中がそろい、締切は右に寄る）
      metaOneLine: (() => {
        const [a, b] = [...document.querySelectorAll('.side .meta > *')].map((e) => e.getBoundingClientRect())
        return !!a && !!b && Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 3 && b.left > a.right
      })(),
    }
  })
  await page.screenshot({ path: `${OUT}/0-check-fresh.png` })
  check(
    '書き始め（表紙だけ入れた）の右の欄：「進み具合 あと3」（数は小見出しの横。直すところは 0 なので数を出さない）で赤い字・印がなく、まだのところは表紙 ✓・本文のページ／本文の段落／作品写真 ○・抄録「先生の許可のあと」（図の枚数の行はない。直すところがないので ✓ の行はたたまない）。直すところは「いま直すところはありません」（凡例は出さない）。「押すと、その場所へ」「書いた文の間違い」はマウスを乗せたときだけ',
    freshPanel.tally === '進み具合あと3,直すところ' &&
      !freshPanel.oldTally &&
      freshPanel.hints === '押すと、その場所へ,書いた文の間違い' &&
      !freshPanel.fold &&
      freshPanel.red.length === 0 &&
      freshPanel.issues === 0 &&
      !freshPanel.legend &&
      freshPanel.none.includes('いま直すところはありません') &&
      freshPanel.rows.map((r) => r.split(':').slice(0, 2).join(':')).join(',') === 'done:表紙,todo:本文のページ,todo:本文の段落,todo:作品写真,wait:抄録' &&
      freshPanel.rows[4].endsWith('先生の許可のあと'),
    JSON.stringify(freshPanel),
  )
  check('「PDFを書き出す」の下は「まだのところが3つあります」。保存のようすと締切は1行。右の欄に「＋ 引用・参考文献を入れる」はない', freshPanel.note === 'まだのところが3つあります' && freshPanel.metaOneLine && !freshPanel.refs, JSON.stringify(freshPanel))
  // まだの行を押すと、その場所へ移る（本文の段落：まだ書いていない最初の段落が開く）
  await page.evaluate(() => [...document.querySelectorAll('.side .check-prog li')].find((li) => li.textContent.includes('本文の段落')).querySelector('button').click())
  await page.waitForFunction(() => !!window.__editor.getSnapshot().editingId, { timeout: 20000 }).catch(() => {})
  const rowJump = await page.evaluate(() => { const s = window.__editor.getSnapshot(); return { editing: s.editingId, first: s.report.body.flatMap((c) => c.blocks).find((b) => b.type === 'paragraph' && b.hint)?.id, kind: s.layout.kinds[s.page] } })
  check('まだのところの「本文の段落」を押すと、まだ書いていない最初の段落へ移って書き始められる', !!rowJump.editing && rowJump.editing === rowJump.first && rowJump.kind === 'body', JSON.stringify(rowJump))
  await page.evaluate(() => window.__editor.finishEditing())
  await ready()
  // 表紙に戻しておく（このあと読み込み直して、表紙の欄でキーボードを確かめる。最後に見ていたページを開くため）
  await page.evaluate(() => window.__editor.goToPage(0, 'none'))
  await ready()

  // ---- 右の欄の「≡ メニュー」（mockups/v37 案C）：マウスで開く・ほかの所を押すと閉じる・キーボードで開いて動く・Esc でボタンに戻る ----
  const menuState = () =>
    page.evaluate(() => {
      const btn = document.querySelector('.side .menu-btn')
      const menu = document.querySelector('.side .head-menu')
      const a = document.activeElement
      return {
        open: !!menu,
        expanded: btn?.getAttribute('aria-expanded'),
        controls: !!menu && btn?.getAttribute('aria-controls') === menu.id,
        role: menu?.getAttribute('role') ?? null,
        labelled: !!menu && menu.getAttribute('aria-labelledby') === btn?.id,
        items: [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])].map((b) => b.textContent.trim()),
        width: menu ? Math.round(menu.getBoundingClientRect().width) : 0,
        font: menu ? getComputedStyle(menu.querySelector('[role="menuitem"]')).fontSize : '',
        focus: a === btn ? 'button' : a?.getAttribute('role') === 'menuitem' ? a.textContent.trim() : String(a?.className || a?.tagName || ''),
      }
    })
  const pageBeforeMenu = (await snap()).page
  await page.click('.side .menu-btn')
  await page.waitForSelector('.side .head-menu')
  const menuOpen = await menuState()
  await page.screenshot({ path: `${OUT}/0-side-menu.png` })
  const WORD_ITEM = 'Word で書いた分を読み込む今年度だけ'
  check(
    '「メニュー」を押すと開き（aria-expanded・role="menu"）、「使い方」がいちばん上、その下に「バックアップ・作り直す」「Word で書いた分を読み込む（今年度だけ）」が出る（幅 262px・字 13.5px）',
    menuOpen.expanded === 'true' && menuOpen.controls && menuOpen.role === 'menu' && menuOpen.labelled && menuOpen.items.join(',') === `使い方,バックアップ・作り直す,${WORD_ITEM}` && menuOpen.width === 262 && menuOpen.font === '13.5px',
    JSON.stringify(menuOpen),
  )
  // ほかの所（「PDFを書き出す」の下のひとこと。セルフチェックの見出しはメニューに隠れることがある）を押すと閉じる
  await page.click('.side-foot .export-note')
  await pause0(200)
  const menuOutside = await menuState()
  check('メニューの外を押すと閉じる', !menuOutside.open && menuOutside.expanded === 'false', JSON.stringify(menuOutside))
  // キーボード：Enter で開いて最初の項目へ、↓↑ で動き（端で回る）、Home・End、Tab でも次の項目へ、←→ でページは送らない、Esc で閉じてボタンに戻る
  await page.focus('.side .menu-btn')
  await page.keyboard.press('Enter')
  await page.waitForSelector('.side .head-menu')
  const menuKeys = [(await menuState()).focus]
  for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowLeft', 'Home', 'Tab']) {
    await page.keyboard.press(key)
    await pause0(60)
    menuKeys.push((await menuState()).focus)
  }
  await page.keyboard.press('Escape')
  await pause0(150)
  const menuEsc = await menuState()
  check(
    'キーボード：Enter で開いて「使い方」へ、↓↑ で項目を動き（端で回る）、Home・End、Tab でも次の項目へ（←→ でページは送らない）。Esc で閉じて「メニュー」のボタンに戻る',
    menuKeys.join('|') === ['使い方', 'バックアップ・作り直す', WORD_ITEM, '使い方', WORD_ITEM, '使い方', WORD_ITEM, WORD_ITEM, '使い方', 'バックアップ・作り直す'].join('|') &&
      !menuEsc.open &&
      menuEsc.focus === 'button' &&
      menuEsc.expanded === 'false' &&
      (await snap()).page === pageBeforeMenu,
    JSON.stringify({ menuKeys, menuEsc }),
  )
  // Space でも開く。↑ で開くと最後の項目へ。最後の項目から Tab でメニューの外に出ると閉じる
  await page.keyboard.press('Space')
  await page.waitForSelector('.side .head-menu')
  const menuBySpace = (await menuState()).focus
  await page.keyboard.press('Escape')
  await page.keyboard.press('ArrowUp')
  await page.waitForSelector('.side .head-menu')
  const menuByUp = (await menuState()).focus
  await page.keyboard.press('Tab')
  await pause0(150)
  const menuTabbedOut = await menuState()
  check(
    'Space でも開き（「使い方」へ）、↑ で開くと最後の項目へ。最後の項目から Tab でメニューの外に出ると閉じる',
    menuBySpace === '使い方' && menuByUp === WORD_ITEM && !menuTabbedOut.open && menuTabbedOut.focus !== 'button',
    JSON.stringify({ menuBySpace, menuByUp, menuTabbedOut }),
  )
  await page.evaluate(() => document.activeElement?.blur())

  // ---- 使い方（PC：右の欄が使い方に替わる。mockups/v27 案A。v37 案C から「メニュー」の中） ----
  await pickMenu(page, '使い方')
  await page.waitForSelector('.side .help-side')
  await pause0(300)
  const helpOpen = await page.evaluate(() => ({
    topics: document.querySelectorAll('.help-list button').length,
    check: !!document.querySelector('.side .sec.check'),
    focus: document.activeElement?.classList.contains('help-title') ?? false,
    pdf: document.querySelector('.help-foot .help-pdf')?.getAttribute('href'),
    paper: !!document.querySelector('.palette'),
  }))
  check('「？ 使い方」で、右の欄が使い方に替わる（項目17・見出しに移る・紙面と道具はそのまま・いちばん下に印刷用の手引き（PDF））', helpOpen.topics === 17 && !helpOpen.check && helpOpen.focus && helpOpen.paper && helpOpen.pdf === './guides/student-guide.pdf', JSON.stringify(helpOpen))
  await page.type('.help-search input', 'PDF 出ない')
  await pause0(300)
  const found = await page.evaluate(() => ({
    count: document.querySelector('.help-count')?.textContent ?? '',
    titles: [...document.querySelectorAll('.help-results .t')].map((t) => t.textContent),
    marks: [...new Set([...document.querySelectorAll('.help-results mark')].map((m) => m.textContent))],
    part: !!document.querySelector('.help-part'),
  }))
  await page.screenshot({ path: `${OUT}/0-help-search.png` })
  check('「言葉で探す」に「PDF 出ない」と入れると、両方の言葉が入っている項目が先に出て、言葉に印（黄色）が付く', found.titles[0] === 'PDF の出し方（端末ごと）' && found.part && found.marks.includes('PDF') && found.marks.includes('出ない') && found.count.includes('件'), JSON.stringify(found))
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
  // 学生が探して見つからなかった言葉（引用・参考文献・最初から・作り直す・新しく）でも、その項目が先に出る。
  // 「やり直」「やり直す」は、元に戻す・やり直すの項目が先（mockups/v35 ④。最初から作り直す項目は、その下に出る）
  const firstHits = []
  for (const q of ['引用', '参考文献', '最初から', '作り直す', '新しく', 'やり直', 'やり直す']) {
    await page.type('.help-search input', q)
    await pause0(200)
    firstHits.push(await page.evaluate(() => document.querySelector('.help-results .t')?.textContent ?? ''))
    await page.click('.help-clear')
    await pause0(100)
  }
  check(
    '「引用」「参考文献」で引用・参考文献の項目、「最初から」「作り直す」「新しく」で最初から作り直す項目、「やり直」「やり直す」で元に戻す・やり直すの項目が先に出る',
    firstHits.join(',') === ['引用・参考文献', '引用・参考文献', ...Array(3).fill('最初から作り直す（新しく始める）'), ...Array(2).fill('原稿を前に戻す（元に戻す・やり直す・自動の控え）')].join(','),
    JSON.stringify(firstHits),
  )
  // 使い方の「引用・参考文献」：「引用・参考文献を入れる」のボタンで、引用・参考文献の窓が開く（右の欄からは外した。mockups/v35 ①）。
  // PC は使い方を開いたまま。窓を閉じると、ボタンに戻る
  await page.evaluate(() => document.querySelector('.help-list [data-topic="references"]').click())
  await page.waitForSelector('.help-topic .help-refs')
  const refsTopic = await page.evaluate(() => ({ lead: document.querySelector('.help-topic .help-lead')?.textContent ?? '', button: document.querySelector('.help-topic .help-refs')?.textContent ?? '' }))
  await page.click('.help-topic .help-refs')
  const refsOpened = await page.waitForSelector('.modal .refs', { timeout: 10000 }).then(() => true, () => false)
  const refsWhileOpen = { help: !!(await page.$('.side .help-side')), title: await page.evaluate(() => document.querySelector('.modal h2')?.textContent ?? '') }
  await page.evaluate(() => [...document.querySelectorAll('.modal .row-buttons button')].find((b) => b.textContent === 'やめる').click())
  await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 10000 }).catch(() => {})
  const refsBack = await page.evaluate(() => document.activeElement?.classList.contains('help-refs') ?? false)
  check(
    '使い方の「引用・参考文献」に「引用・参考文献を入れる」のボタンがあり、押すと引用・参考文献の窓が開く（使い方は開いたまま。「やめる」でボタンに戻る）',
    refsTopic.lead === '使うときだけ、下のボタンから入れます。' && refsTopic.button === '引用・参考文献を入れる' && refsOpened && refsWhileOpen.help && refsWhileOpen.title === '引用・参考文献' && refsBack,
    JSON.stringify({ refsTopic, refsOpened, refsWhileOpen, refsBack }),
  )
  await page.click('.help-back')
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
  await pickMenu(page, '使い方')
  await page.waitForSelector('.side .help-side')
  await page.click('.help-close')
  await pause0(200)
  check('使い方の「閉じる」で、セルフチェックの欄に戻る（「？ 使い方」の入っている「メニュー」のボタンに戻る）', !(await page.$('.help-side')) && !!(await page.$('.side .sec.check')) && (await page.evaluate(() => document.activeElement?.classList.contains('menu-btn'))))
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

  // ---- 見開き（mockups/v35 ③ 案A。PC だけ）：いまのページと次のページを並べ、1–2、3–4…と2ページずつめくる。どちらのページでも書ける ----
  {
    const spreadInfo = () =>
      page.evaluate(() => {
        const s = window.__editor.getSnapshot()
        const shown = [...document.querySelectorAll('.page-viewport.front [data-vivliostyle-page-container]')].filter((p) => p.getBoundingClientRect().width > 0)
        const rects = shown.map((p) => p.getBoundingClientRect())
        return {
          spread: s.spread,
          page: s.page,
          count: s.pageCount,
          shown: shown.length,
          sideBySide: rects.length === 2 && rects[1].left >= rects[0].right && Math.abs(rects[0].top - rects[1].top) < 1 && Math.abs(rects[0].width - rects[1].width) < 1,
          pcount: document.querySelector('.thumbs-col .pcount')?.textContent ?? '',
          thumbs: [...document.querySelectorAll('.thumbs-col .thumb-list .t')].map((t, i) => (t.classList.contains('on') ? i : -1)).filter((i) => i >= 0).join(','),
          prevOff: document.querySelector('.arrow.prev').disabled,
          nextOff: document.querySelector('.arrow.next').disabled,
          arrowsBelow: rects.length > 0 && document.querySelector('.arrow.prev').getBoundingClientRect().top > rects[0].bottom,
        }
      })
    check('右下の切り替えは「全体／見開き／拡大」の3つ', (await page.evaluate(() => [...document.querySelectorAll('.zoom button')].map((b) => b.textContent.trim()).join('／'))) === '全体／見開き／拡大')
    // 確かめのあいだだけ、本文を数ページ足す（本文のページが2つ並ぶ組を作る。あとで元に戻す）
    await page.evaluate(() =>
      window.__editor.update((r) => ({
        ...r,
        body: [...r.body, { id: 'sp-c', title: '見開きの確かめ', blocks: Array.from({ length: 14 }, (_, i) => ({ type: 'paragraph', id: `sp-p${i}`, content: [{ type: 'text', text: `見開きの確かめの${i + 1}つめの段落である。`.repeat(9) }] })) }],
      })),
    )
    await ready()
    await page.evaluate(() => window.__editor.goToPage(0, 'none'))
    await ready()
    await page.evaluate(() => [...document.querySelectorAll('.zoom button')].find((b) => b.textContent.includes('見開き')).click())
    await ready()
    let sp = await spreadInfo()
    check(
      '「見開き」で、1–2ページを並べて出す（ページ一覧は2ページとも選んだ印、番号は「1–2 / n」、←→は下。最初の組では←は押せない）',
      sp.spread && sp.page === 0 && sp.shown === 2 && sp.sideBySide && sp.pcount === `1–2 / ${sp.count}` && sp.thumbs === '0,1' && sp.prevOff && sp.arrowsBelow,
      JSON.stringify(sp),
    )
    await page.keyboard.press('ArrowRight')
    await ready()
    sp = await spreadInfo()
    const afterKey = sp.page
    await page.click('.arrow.next')
    await ready()
    sp = await spreadInfo()
    check('見開きでは、→キー・→ボタンで2ページずつめくる（1–2 → 3–4 → 5–6）', afterKey === 2 && sp.page === 4 && sp.shown === 2 && sp.pcount.startsWith('5–6') && sp.thumbs === '4,5', JSON.stringify({ afterKey, sp }))
    await page.mouse.move(stageCenter.x, stageCenter.y)
    await page.mouse.wheel({ deltaY: -100 })
    await pause()
    await ready()
    check('見開きでは、ホイールでも2ページずつめくる（5–6 → 3–4）', (await snap()).page === 2, `${(await snap()).page}`)
    // ページ一覧で、ほかの組のページを押すと、その組へ（押したページで書く）
    await page.evaluate(() => document.querySelectorAll('.thumbs-col .thumb-list .t')[5].click())
    await ready()
    sp = await spreadInfo()
    check('見開きで、ページ一覧の6ページ目を押すと 5–6 の組を出す（書くのは6ページ目）', sp.page === 5 && sp.shown === 2 && sp.thumbs === '4,5', JSON.stringify(sp))
    // 右のページ（左も本文の組）の段落を押すと、めくらずにその場で書ける
    const pair = await page.evaluate(() => {
      const ed = window.__editor
      const s = ed.getSnapshot()
      const paras = s.report.body.flatMap((c) => c.blocks).filter((b) => b.type === 'paragraph').map((b) => b.id)
      const kinds = s.layout.kinds
      const right = paras.find((id) => { const p = ed.pageOfBlock(id); return p % 2 === 1 && kinds[p] === 'body' && kinds[p - 1] === 'body' })
      const p = right ? ed.pageOfBlock(right) : -1
      const left = paras.find((id) => ed.pageOfBlock(id) === p - 1 && ed.pageOfBlock(id, 1e9) === p - 1)
      return { right, left, page: p }
    })
    await page.evaluate((p) => window.__editor.goToPage(p - 1, 'none'), pair.page)
    await ready()
    const pointOf = (id) =>
      page.evaluate((id) => {
        const el = [...document.querySelectorAll(`.page-viewport.front [data-block-id="${id}"]`)].find((e) => e.getBoundingClientRect().width > 0)
        const r = el.getBoundingClientRect()
        return { x: r.left + Math.min(r.width / 2, 40), y: r.top + Math.min(r.height / 2, 8) }
      }, id)
    const paraTextOf = (id) => page.evaluate((id) => window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === id).content.map((n) => n.text ?? '').join(''), id)
    const editingOn = (p) =>
      page.evaluate((p) => {
        const s = window.__editor.getSnapshot()
        const pr = window.__editor.pageElements()[p].getBoundingClientRect()
        const box = document.querySelector('.overlay-editor').getBoundingClientRect()
        const shown = [...document.querySelectorAll('.page-viewport.front [data-vivliostyle-page-container]')].filter((x) => x.getBoundingClientRect().width > 0).length
        return { editing: s.editingId, page: s.page, shown, inside: box.width > 0 && box.left >= pr.left - 1 && box.right <= pr.right + 1 && box.top >= pr.top - 1 }
      }, p)
    let at = await pointOf(pair.right)
    await page.mouse.click(at.x, at.y)
    await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 20000 }, pair.right)
    const onRight = await editingOn(pair.page)
    await page.keyboard.press('End')
    await page.keyboard.type('右で書いた。')
    // 続けて左のページの段落を押す（右で書いた分は確定する）
    at = await pointOf(pair.left)
    await page.mouse.click(at.x, at.y)
    await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 20000 }, pair.left)
    const onLeft = await editingOn(pair.page - 1)
    await page.keyboard.press('Escape')
    await ready()
    const rightText = await paraTextOf(pair.right)
    check(
      '見開きの右のページの段落を押すと、めくらずにその場で書ける。続けて左のページの段落も押して書ける（書く欄は、押したページの上）',
      !!pair.right && !!pair.left && onRight.page === pair.page && onRight.shown === 2 && onRight.inside && onLeft.page === pair.page - 1 && onLeft.shown === 2 && onLeft.inside && rightText.endsWith('右で書いた。'),
      JSON.stringify({ pair, onRight, onLeft, rightText: rightText.slice(-12) }),
    )
    // 右で書いた分と、足した本文を元に戻す
    await page.evaluate(() => window.__editor.undo())
    await ready()
    check('元に戻すと、右のページで書いた分が消える', !(await paraTextOf(pair.right)).endsWith('右で書いた。'))
    await page.evaluate(() => window.__editor.undo())
    await ready()
    check('足した本文も元に戻る（見開きの確かめの前の原稿）', !(await snap()).report.body.some((c) => c.id === 'sp-c'))
    // 印刷（PDF）では、見開きの並べ方を使わない（ページを1枚ずつ、ずらさずに出す）
    await page.emulateMediaType('print')
    const printed = await page.evaluate(() => {
      const pages = window.__editor.pageElements()
      return { shown: pages.filter((p) => getComputedStyle(p).display !== 'none').length, total: pages.length, shifted: pages.filter((p) => getComputedStyle(p).translate !== 'none').length }
    })
    await page.emulateMediaType(null)
    check('見開きのままでも、印刷（PDF）はページを1枚ずつ、ずらさずに出す', printed.shown >= printed.total - 1 && printed.shifted === 0, JSON.stringify(printed))
    // 表示の仕方は覚える（読み込み直すと見開きに戻る）
    const stored = await page.evaluate(() => localStorage.getItem('sotsugyo-seisaku-report-zoom'))
    await page.reload({ waitUntil: 'networkidle0' })
    await ready()
    await page.waitForFunction(() => window.__editor.getSnapshot().spread, { timeout: 15000 }).catch(() => {})
    sp = await spreadInfo()
    check('見開きにしたことを覚え、読み込み直すと見開きに戻る', stored === 'spread' && sp.spread && sp.shown === 2, JSON.stringify({ stored, sp }))
    await page.click('.zoom button:first-child')
    await ready()
    sp = await spreadInfo()
    check('「全体」で1ページずつの表示に戻る', !sp.spread && sp.shown === 1 && !sp.pcount.includes('–') && (await page.evaluate(() => localStorage.getItem('sotsugyo-seisaku-report-zoom'))) === 'fit', JSON.stringify(sp))
    await page.evaluate(() => window.__editor.goToPage(0, 'none'))
    await ready()
  }

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
  const startBoxOf = () => page.evaluate(() => { const r = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current [data-abstract-start]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  const startBox = await startBoxOf()
  await page.mouse.click(startBox.x, startBox.y)
  await page.waitForFunction(() => window.__editor.getSnapshot().report.abstract.started === true, { timeout: 30000 })
  await ready()
  // 押すと、画面の下に「抄録を書き始めました［戻す］」が出る（書く欄は開かない。開くと知らせが隠れるため）。［戻す］で書き始める前に戻る
  const startToast = await page.evaluate(() => ({ text: document.querySelector('.undo-toast')?.textContent ?? '', button: !!document.querySelector('.undo-toast button'), editing: window.__editor.getSnapshot().editingId }))
  check('「先生の許可が出た」を押すと、抄録を書き始められ、画面の下に「抄録を書き始めました［戻す］」が出る', (await snap()).report.abstract.started === true && startToast.text.includes('抄録を書き始めました') && startToast.button && !startToast.editing, JSON.stringify(startToast))
  await page.click('.undo-toast button')
  await ready()
  await pause0(200)
  const unstarted = await page.evaluate(() => ({
    started: window.__editor.getSnapshot().report.abstract.started,
    lock: !!document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current [data-abstract-start]'),
    text: document.querySelector('.undo-toast')?.textContent ?? '',
  }))
  check('知らせの［戻す］で、書き始める前（案内と「先生の許可が出た」だけ）に戻り、「抄録を書き始める前に戻しました」と出る', unstarted.started === false && unstarted.lock && unstarted.text.includes('抄録を書き始める前に戻しました'), JSON.stringify(unstarted))
  // もう一度押して書き始め、抄録の段落を押して書く
  const startBox2 = await startBoxOf()
  await page.mouse.click(startBox2.x, startBox2.y)
  await page.waitForFunction(() => window.__editor.getSnapshot().report.abstract.started === true, { timeout: 30000 })
  await ready()
  await clickBlock(abstractId)
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 30000 }, abstractId)
  const sentence = '本制作報告書は、卒業イベントにおいて筆者が制作した衣装についてである。'
  await typeAndCommit(sentence.repeat(19), 'Escape')
  s = await snap()
  check('抄録の文字数と行数が測れる', s.layout.abstractLines >= 15 && s.layout.abstractLines <= 23, `${s.layout.abstractLines}行`)
  check('抄録の字数の指摘が消える', !s.findings.some((f) => f.ruleId.startsWith('abstract')))

  // ---- 本文：誤りを含む文を書き、指摘を押してその段落へ移り、書いてある直し方のとおりに自分で直す（「直す」のボタンはない） ----
  const firstParagraph = s.report.body[0].blocks.find((b) => b.type === 'paragraph').id
  await clickBlock(firstParagraph)
  await typeAndCommit('私は１５世紀の衣装を製作した。', 'Escape')
  s = await snap()
  const ruleIds = s.findings.filter((f) => f.blockId === firstParagraph).map((f) => f.ruleId)
  check('本文の誤りを見つける', ['first-person', 'digit-fullwidth', 'seisaku'].every((r) => ruleIds.includes(r)), ruleIds.join(','))
  // エラーと要確認の意味は、一覧の上に1行で出す（指摘ごとの札「手順書」「補助」はなくした。提出前チェックと同じ。mockups/v31 案1）
  const legend = await page.evaluate(() => ({
    text: document.querySelector('.side .sec.check .sev-legend')?.textContent ?? '',
    aboveList: !!document.querySelector('.side .sec.check .sev-legend + .igroup'),
    icons: [...document.querySelectorAll('.side .sev-legend .dot')].map((i) => getComputedStyle(i, '::before').content),
    chips: document.querySelectorAll('.side .issue .src').length,
    chipText: /手順書|補助/.test([...document.querySelectorAll('.side .issue .ttl')].map((t) => t.textContent).join('')),
    // 凡例と指摘は「直すところ」の中（mockups/v35 ① 案A）。数は小見出し「直すところ」の横の赤い札（mockups/v37）
    inFix: !!document.querySelector('.side .sec.check .check-sub.fix ~ .sev-legend'),
    tally: document.querySelector('.side .check-sub.fix')?.textContent.replace(/\s/g, '') ?? '',
    tallyRed: getComputedStyle(document.querySelector('.side .check-sub.fix .count-badge')).color === 'rgb(181, 68, 59)',
    issues: document.querySelectorAll('.side .sec.check .issue').length,
  }))
  check('セルフチェックの一覧の上に「× エラー：直してから出す」「! 要確認：確かめて、必要なら直す」が出て、指摘ごとの札（手順書・補助）はない', legend.text.includes('エラー：直してから出す') && legend.text.includes('要確認：確かめて、必要なら直す') && legend.aboveList && legend.icons.join(',') === '"×","!"' && legend.chips === 0 && !legend.chipText, JSON.stringify(legend))
  check('書いた文の間違いは「直すところ」に出る（凡例も直すところの中。「直すところ」の横の数 N は赤）', legend.inFix && legend.tallyRed && legend.tally === `直すところ${legend.issues}`, JSON.stringify(legend))
  // 直すところがあるときは、まだのところの済んだ（✓）行を、灰色の1行「✓ 表紙・…」にたたむ（mockups/v37 の承認）。まだ・先生の許可のあとの行は、そのまま
  const folded = await page.evaluate(() => {
    const sec = document.querySelector('.side .sec.check')
    const s = window.__editor.getSnapshot()
    return {
      line: sec.querySelector('.check-prog li.done-fold')?.textContent ?? null,
      last: sec.querySelector('.check-prog li:last-child')?.className ?? '',
      doneRows: sec.querySelectorAll('.check-prog li.done').length,
      rows: [...sec.querySelectorAll('.check-prog li:not(.done-fold)')].map((li) => li.className),
      names: [...sec.querySelectorAll('.done-fold button')].map((b) => b.textContent),
      tip: sec.querySelector('.done-fold button')?.title ?? '',
      color: getComputedStyle(sec.querySelector('.done-fold .row') ?? sec).color,
      page: s.page,
    }
  })
  await page.screenshot({ path: `${OUT}/1-check-folded.png` })
  check(
    '直すところがあるときは、済んだ行（✓）が「✓ 表紙・…」の灰色の1行（まだのところのいちばん下）にたたまれ、まだの行はそのまま。名前にマウスを乗せると、右の字（入れました など）が出る',
    folded.doneRows === 0 && folded.last === 'done-fold' && folded.names[0] === '表紙' && folded.line === `済んだもの：${folded.names.join('・')}` && folded.rows.every((c) => c !== 'done') && folded.tip === '表紙：入れました（押すと、その場所へ）' && folded.color === 'rgb(104, 107, 114)',
    JSON.stringify(folded),
  )
  // たたんだ行の名前を押すと、その場所へ移る（表紙 → 表紙のページ）
  await page.evaluate(() => [...document.querySelectorAll('.side .done-fold button')].find((b) => b.textContent === '表紙').click())
  await page.waitForFunction(() => { const s = window.__editor.getSnapshot(); return s.layout.kinds[s.page] === 'cover' && !s.turning }, { timeout: 20000 }).catch(() => {})
  await ready()
  check('たたんだ1行の「表紙」を押すと、表紙のページへ移る', await page.evaluate(() => { const s = window.__editor.getSnapshot(); return s.layout.kinds[s.page] === 'cover' }))
  await page.evaluate((p) => window.__editor.goToPage(p, 'none'), folded.page)
  await ready()
  await page.screenshot({ path: `${OUT}/1-findings.png` })
  const issueRows = await page.evaluate(() => ({
    fix: document.querySelectorAll('.side .issue .fix').length,
    fixText: [...document.querySelectorAll('.side .issue button')].filter((b) => b.textContent.trim() === '直す').length,
    details: [...document.querySelectorAll('.side .issue .detail')].map((d) => d.textContent),
  }))
  check(
    '指摘に「直す」のボタンはなく、直し方が書いてある（「私」→「筆者」・全角の「１５」→ 半角の「15」・「製作」→「制作」）',
    issueRows.fix === 0 && issueRows.fixText === 0 && ['「私」→「筆者」', '全角の「１５」→ 半角の「15」', '「製作」→「制作」'].every((d) => issueRows.details.includes(d)),
    JSON.stringify(issueRows),
  )
  // 指摘を押すと、その段落が開く（カーソルは指摘の所）。書いてあるとおりに自分で書き直す
  await page.evaluate(() => [...document.querySelectorAll('.side .issue')].find((li) => li.textContent.includes('「私」→「筆者」')).click())
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 30000 }, firstParagraph)
  await page.keyboard.down('Control')
  await page.keyboard.press('a')
  await page.keyboard.up('Control')
  await typeAndCommit('筆者は15世紀の衣装を制作した。', 'Escape')
  s = await snap()
  const fixed = s.report.body[0].blocks.find((b) => b.id === firstParagraph).content.map((n) => n.text ?? '').join('')
  check('指摘を押してその段落へ移り、書いてあるとおりに直すと、指摘が消える', fixed === '筆者は15世紀の衣装を制作した。' && !s.findings.some((f) => f.blockId === firstParagraph && ['first-person', 'digit-fullwidth', 'seisaku'].includes(f.ruleId)), fixed)

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
  // 指摘には直し方（段落の終わりに「。」を打つ）が書いてある。指摘を押してその段落へ移り、終わりに「。」を打つ
  const endDetail = await page.evaluate(() => [...document.querySelectorAll('.side .issue')].find((li) => li.textContent.includes('文末に「。」を付ける'))?.querySelector('.detail')?.textContent ?? '')
  await page.evaluate(() => [...document.querySelectorAll('.side .issue')].find((li) => li.textContent.includes('文末に「。」を付ける')).click())
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 30000 }, second)
  await page.keyboard.press('End')
  await typeAndCommit('。', 'Escape')
  check('文末の「。」の指摘は「段落の終わりに「。」を打つ」と書き、押して移った段落の終わりに「。」を打つと消える', endDetail === '段落の終わりに「。」を打つ' && (await paraText(second)) === '次の段落である。そして袖を広げた。' && !(await snap()).findings.some((x) => x.ruleId === 'sentence-end' && x.blockId === second), JSON.stringify({ endDetail, text: await paraText(second) }))

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
    // 濃いボタン（開いたときに移るボタン）は、本文を残す「コース名だけ変える」（書いた本文が消える「下書きを入れ替える」は目立たせない）
    const courseButtons = await page.evaluate(() => ({ primary: [...document.querySelectorAll('.modal button.primary')].map((b) => b.textContent), focused: document.activeElement?.textContent ?? '' }))
    await page.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.includes('コース名だけ変える')).click())
    await ready()
    s = await snap()
    const kept = s.report.body.flatMap((c) => c.blocks).some((b) => b.id === firstParagraph)
    check('本文を書き始めてからコースを変えると確かめ、「コース名だけ変える」なら本文を残す', asked.includes('コースを変えますか') && s.report.basicInfo.courseId !== before && kept, asked)
    check('コースを変える窓の濃いボタン（Enter で押されるボタン）は「コース名だけ変える」', courseButtons.primary.join(',') === 'コース名だけ変える' && courseButtons.focused === 'コース名だけ変える', JSON.stringify(courseButtons))
    // 「下書きを入れ替える」を選ぶと、画面の下に「下書きを入れ替えました［戻す］」が出て、［戻す］で本文もコースも元に戻る
    const keptCourse = s.report.basicInfo.courseId
    await clickBlock('basic:course')
    await page.waitForSelector('.popover button')
    await page.evaluate(() => [...document.querySelectorAll('.popover button')].find((b) => !b.classList.contains('on')).click())
    await page.waitForSelector('.modal')
    await page.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.includes('下書きを入れ替える')).click())
    await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 10000 })
    await ready()
    s = await snap()
    const replaced = { course: s.report.basicInfo.courseId !== keptCourse, gone: !s.report.body.flatMap((c) => c.blocks).some((b) => b.id === firstParagraph) }
    const replacedNotice = await page.evaluate(() => document.querySelector('.stage .undo-area .undo-toast')?.textContent ?? '')
    await page.screenshot({ path: `${OUT}/course-replaced-undo.png` })
    await page.click('.stage .undo-area .undo-toast button').catch(() => {})
    await ready()
    await new Promise((r) => setTimeout(r, 300))
    s = await snap()
    const restoredDraft = { course: s.report.basicInfo.courseId === keptCourse, body: s.report.body.flatMap((c) => c.blocks).some((b) => b.id === firstParagraph), notice: await page.evaluate(() => document.querySelector('.stage .undo-area')?.textContent ?? '') }
    check(
      '「下書きを入れ替える」のあと、画面の下に「下書きを入れ替えました［戻す］」が出て、［戻す］で本文とコースが元に戻る（「下書きを戻しました」）',
      replaced.course && replaced.gone && replacedNotice === '下書きを入れ替えました戻す' && restoredDraft.course && restoredDraft.body && restoredDraft.notice === '下書きを戻しました',
      JSON.stringify({ replaced, replacedNotice, restoredDraft }),
    )
  }

  // ---- 表紙の題目（研究題目。学科で決まっていて、書けない）：マウスを重ねると理由が出て、押すと画面の下に同じ言葉を知らせる（何も開かない）。
  //      呼び方は紙面の見出しと同じ（設定の「制作題目」） ----
  await page.evaluate(() => window.__editor.goToPage(0, 'none'))
  await ready()
  const titleAt = await page.evaluate(() => {
    const el = document.querySelector('.page-viewport.front section.cover .el.title')
    const r = el.getBoundingClientRect()
    return { label: document.querySelector('.page-viewport.front section.cover .el.label')?.textContent ?? '', tip: el.title, cursor: getComputedStyle(el).cursor, x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await page.mouse.click(titleAt.x, titleAt.y)
  await pause(300)
  const titleClick = await page.evaluate(() => ({ notice: document.querySelector('.stage .undo-area')?.textContent ?? '', editing: window.__editor.getSnapshot().editingId }))
  check(
    '表紙の題目：マウスを重ねると「制作題目は、学科で決まっています（変えられません）」（見出しと同じ呼び方）と出て、押すと画面の下に同じ言葉を知らせる（書く欄は開かない）',
    titleAt.label === '制作題目' && titleAt.tip === '制作題目は、学科で決まっています（変えられません）' && titleAt.cursor === 'help' && titleClick.notice === titleAt.tip && !titleClick.editing,
    JSON.stringify({ titleAt, titleClick }),
  )

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
  await waitEditing(() => window.__editor.getSnapshot().editingKind === 'paragraph')
  await ready()
  s = await snap()
  const blocksNow = s.report.body.flatMap((c) => c.blocks)
  const pIndex = blocksNow.findIndex((b) => b.id === firstParagraph)
  const group = blocksNow[pIndex + 1]
  const refAtEnd = blocksNow[pIndex].content.at(-2)?.targetId === group?.figures?.[0].id && blocksNow[pIndex].content.at(-1)?.text === '。'
  check('「図を入れる」で、書いている位置に（図1）が入り、段落のすぐ下にタイトル付きの図が入る', group?.type === 'figureRow' && group.figures[0].caption === 'デザイン画' && !!group.figures[0].imageId && refAtEnd, JSON.stringify(group?.figures))
  // 図のタイトルで Enter：図の上の段落に戻らず、図の後ろに新しい段落ができて、そこで書き続ける（mockups/v32 ① 案A）
  const afterFigure = blocksNow[pIndex + 2]
  check('図のタイトルで Enter を押すと、図の後ろに新しい段落ができて、そこで書ける（図の上の段落には戻らない）', afterFigure?.type === 'paragraph' && s.editingId === afterFigure.id && afterFigure.content.every((n) => !n.text), JSON.stringify({ editing: s.editingId, after: afterFigure?.id }))
  check('参照していない図の指摘が出ない', !s.findings.some((x) => x.ruleId === 'figure-unreferenced'))
  await page.keyboard.press('Escape')
  await ready()
  // 元に戻す1回で、作った段落だけが消える（図とタイトルは残る）
  await page.evaluate(() => window.__editor.undo())
  await ready()
  s = await snap()
  const undoneFlat = s.report.body.flatMap((c) => c.blocks)
  check('元に戻す1回で、図のタイトルの Enter で作った段落だけが消える（タイトルは残る）', !undoneFlat.some((b) => b.id === afterFigure?.id) && undoneFlat.find((b) => b.id === group?.id)?.figures[0].caption === 'デザイン画', JSON.stringify(undoneFlat.slice(pIndex, pIndex + 3).map((b) => b.id)))

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
  // Esc で書き終える（Enter は図の後ろに段落を作る）
  await page.keyboard.press('Escape')
  await ready()
  s = await snap()
  const two = s.report.body.flatMap((c) => c.blocks).find((b) => b.type === 'figureRow')
  const rowTops = await page.evaluate(() => [...document.querySelectorAll('.page-viewport.front figure[data-figure-id] img')].map((img) => Math.round(img.getBoundingClientRect().top)))
  const textWithTwo = await page.evaluate((id) => window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === id).content.filter((n) => n.type === 'ref').length, firstParagraph)
  check('「もう1枚」で2枚目が横に並び、本文に（図2）が入る', two.figures.length === 2 && rowTops.length === 2 && rowTops[0] === rowTops[1] && textWithTwo === 2, JSON.stringify(rowTops))
  await page.screenshot({ path: `${OUT}/2-figure-two.png` })

  // 2枚目を消すと、本文の（図2）も消える
  await page.evaluate((id) => window.__editor.select({ kind: 'figure', id }), two.figures[1].id)
  // 削除のすぐあと（組み直す前）に、道具の「改ページ」などを押しても、何も入らない（すばやく2回押したとき、2回目が入れ替わった道具に当たる）
  const pressedDuring = await page.evaluate(() => {
    window.__editor.removeSelected()
    const before = window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).length
    window.__editor.addPageBreak()
    window.__editor.addParagraph()
    return before
  })
  await ready()
  s = await snap()
  check('図を削除してすぐ（組み直す前）に「改ページ」「段落」を押しても、何も入らない', !s.report.body.flatMap((c) => c.blocks).some((b) => b.type === 'pageBreak') && s.report.body.flatMap((c) => c.blocks).length === pressedDuring, String(pressedDuring))
  const refsLeft = s.report.body.flatMap((c) => c.blocks).find((b) => b.id === firstParagraph).content.filter((n) => n.type === 'ref').length
  check('図を消すと、本文のその図への（図n）も消える', s.report.body.flatMap((c) => c.blocks).find((b) => b.type === 'figureRow').figures.length === 1 && refsLeft === 1)
  // 図を押して選び、Delete キーで消せる（左の道具の「削除」と同じ。依頼者の要望）。元に戻すで戻る
  {
    const figBox = await page.evaluate(() => {
      const r = document.querySelector('.page-viewport.front figure[data-figure-id] img').getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })
    await page.mouse.click(figBox.x, figBox.y)
    await page.waitForFunction(() => window.__editor.getSnapshot().selection?.kind === 'figure', { timeout: 10000 })
    await page.keyboard.press('Delete')
    await ready()
    const afterDelete = (await snap()).report.body.flatMap((c) => c.blocks).some((b) => b.type === 'figureRow')
    await page.evaluate(() => window.__editor.undo())
    await ready()
    const afterUndo = (await snap()).report.body.flatMap((c) => c.blocks).find((b) => b.type === 'figureRow')?.figures.length
    check('図を押して選び、Delete キーで消せる（元に戻すで戻る）', !afterDelete && afterUndo === 1, JSON.stringify({ afterDelete, afterUndo }))
  }

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
  // 同じ段落に（図1）が2つ並んだ：二重になっているとエラーで知らせ、下線の（図1）を消すように書く。指摘を押すと、その（図1）の後ろにカーソルが来る（Backspace で消せる）
  const dup = await page.evaluate((id) => {
    const f = window.__editor.getSnapshot().findings.find((x) => x.ruleId === 'duplicate-ref' && x.blockId === id)
    return f ? { severity: f.severity, detail: f.detail, start: f.start, end: f.end } : null
  }, firstParagraph)
  await page.evaluate(() => [...document.querySelectorAll('.side .issue')].find((li) => li.textContent.includes('が2つある')).click())
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 30000 }, firstParagraph)
  for (let k = 0; dup && k < dup.end - dup.start; k++) await page.keyboard.press('Backspace')
  await page.keyboard.press('Escape')
  await ready()
  s = await snap()
  const refsFixed = s.report.body.flatMap((c) => c.blocks).find((b) => b.id === firstParagraph).content.filter((n) => n.type === 'ref').length
  check('同じ段落に（図1）が2つあるとエラーになり、下線の（図1）を消して1つにできる（押すと、その後ろにカーソルが来る）', dup?.severity === 'error' && dup.detail.includes('下線の（図1）を消して1つにします') && refsFixed === 1 && !s.findings.some((x) => x.ruleId === 'duplicate-ref'), JSON.stringify({ dup, refsFixed }))
  await page.screenshot({ path: `${OUT}/2-figure.png` })

  // ---- 図・表は、文中の入れたい位置で入れる（書いていないときは押せない） ----
  const toolDisabled = (label) => page.evaluate((label) => [...document.querySelectorAll('.palette .tb')].find((b) => b.textContent.includes(label))?.disabled, label)
  check('段落を書いていないときは「図を入れる」「表を入れる」を押せない', (await toolDisabled('図を入れる')) === true && (await toolDisabled('表を入れる')) === true)
  const paletteNote = await page.evaluate(() => { const n = [...document.querySelectorAll('.palette .ctx-note')].find((e) => e.textContent.includes('図・表')); return n && getComputedStyle(n).display !== 'none' ? n.textContent : '' })
  check('押せないときは、その理由（入れたい所をクリックしてから）が道具に出る', paletteNote.includes('入れたい所をクリック'), paletteNote)
  await clickBlock(firstParagraph)
  await page.keyboard.press('End')
  await clickPaletteButton('表を入れる')
  // 表の大きさを最初に選ぶ（mockups/v35 ②）：メニューに、ます目（6列×10行。はじめは 2列×2行に色）と、素材表のボタン
  const menuInfo = () =>
    page.evaluate(() => {
      const m = document.querySelector('.palette .table-menu')
      return m && { title: m.querySelector('.side-menu-title')?.textContent, cells: m.querySelectorAll('.tgrid button').length, on: m.querySelectorAll('.tgrid button.on').length, head: m.querySelectorAll('.tgrid button.on.h').length, label: m.querySelector('.tgrid-label')?.textContent, more: [...m.querySelectorAll(':scope > button')].map((b) => b.textContent).join(), editing: window.__editor.getSnapshot().editingId, caret: window.__editor.getSnapshot().caret }
    })
  const menu0 = await menuInfo()
  check('「表を入れる」のメニューに、表の大きさを選ぶます目（6列×10行。はじめは 2列×2行）と、その下に素材表のボタンが出る', menu0?.title === '表の大きさを選ぶ' && menu0.cells === 60 && menu0.on === 4 && menu0.head === 2 && menu0.label === '2列×2行1行目は見出し' && menu0.more === '素材表名称・使用箇所・生地見本', JSON.stringify(menu0))
  // マウスを 3列×4行のます目に乗せると、そこまで色が付く（1行目は濃い色＝見出し）
  const gridCell = (c, r) => page.evaluate((c, r) => { const b = document.querySelectorAll('.palette .table-menu .tgrid button')[(r - 1) * 6 + (c - 1)].getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } }, c, r)
  let gc = await gridCell(3, 4)
  await page.mouse.move(gc.x, gc.y)
  await pause(150)
  const menu34 = await menuInfo()
  check('ます目にマウスを乗せると、3列×4行まで色が付き（見出しの行は3つ）、「3列×4行 ／ 1行目は見出し」と出る', menu34?.on === 12 && menu34.head === 3 && menu34.label === '3列×4行1行目は見出し', JSON.stringify(menu34))
  // キーボード：矢印キーで選び直し（書く欄のカーソルは動かない）、Enter で入れる
  for (const key of ['ArrowLeft', 'ArrowUp', 'ArrowUp', 'ArrowUp']) await page.keyboard.press(key)
  const menuKey = await menuInfo()
  check('矢印キーで大きさを選び直せる（2列×2行より小さい行にはならない。書く欄のカーソルは動かない）', menuKey?.label === '2列×2行1行目は見出し' && menuKey.on === 4 && menuKey.caret === menu0.caret && menuKey.editing === menu0.editing, JSON.stringify(menuKey))
  await page.keyboard.press('Enter')
  await waitEditing(() => window.__editor.getSnapshot().editingKind === 'tableCaption')
  await ready()
  s = await snap()
  const tableBlock = s.report.body.flatMap((c) => c.blocks).find((b) => b.type === 'table' && b.id === s.editingId)
  check('Enter で、選んだ大きさ（2列×2行）の表が入る', JSON.stringify(tableBlock?.rows.map((r) => r.cells.length)) === '[2,2]', JSON.stringify(tableBlock?.rows.map((r) => r.cells.length)))
  check('「表を入れる」で、書いている位置に（表n）が入り、表のタイトルを書く欄が開く（タイトルが空ならエラー）', !!tableBlock && s.report.body.flatMap((c) => c.blocks).find((b) => b.id === firstParagraph).content.some((n) => n.type === 'ref' && n.targetId === tableBlock.id) && s.findings.some((x) => x.ruleId === 'required-text' && x.blockId === tableBlock.id), tableBlock?.id)
  await page.keyboard.type('使用した生地')
  await page.keyboard.press('Enter')
  await waitEditing(() => window.__editor.getSnapshot().editingKind === 'paragraph')
  await ready()
  s = await snap()
  const tableFlat = s.report.body.flatMap((c) => c.blocks)
  const afterTable = tableFlat[tableFlat.findIndex((b) => b.id === tableBlock.id) + 1]
  check('表のタイトルで Enter を押すと、表の後ろに新しい段落ができて、そこで書ける', afterTable?.type === 'paragraph' && s.editingId === afterTable.id && tableFlat.find((b) => b.id === tableBlock.id).caption === '使用した生地', JSON.stringify({ editing: s.editingId, after: afterTable?.id }))
  await page.keyboard.press('Escape')
  await ready()
  await page.evaluate(() => window.__editor.undo())
  await ready()
  check('元に戻す1回で、表の後ろに作った段落が消える', !(await snap()).report.body.flatMap((c) => c.blocks).some((b) => b.id === afterTable?.id))
  // ---- ます目で 3列×4行を押して入れる。元に戻す・やり直す（mockups/v35 ④ 案A：道具のいちばん下の2つのボタン・Ctrl+Z／Ctrl+Y／Ctrl+Shift+Z） ----
  {
    const bodyKey = () => snap().then((x) => JSON.stringify(x.report.body))
    const before34 = await bodyKey()
    await clickBlock(firstParagraph)
    await page.keyboard.press('End')
    await clickPaletteButton('表を入れる')
    await page.waitForSelector('.palette .table-menu')
    gc = await gridCell(3, 4)
    await page.mouse.move(gc.x, gc.y)
    await page.mouse.click(gc.x, gc.y)
    await waitEditing(() => window.__editor.getSnapshot().editingKind === 'tableCaption')
    await ready()
    s = await snap()
    const t34 = s.report.body.flatMap((c) => c.blocks).find((b) => b.type === 'table' && b.id === s.editingId)
    const t34Cells = await page.evaluate((id) => [...document.querySelectorAll(`.page-viewport.front .data-table[data-table-id="${id}"] tr`)].map((tr) => tr.children.length), t34?.id)
    check('ます目の 3列×4行を押すと、3列×4行（1行目は見出し）の表が入る（紙面の表も 3列×4行）', JSON.stringify(t34?.rows.map((r) => r.cells.length)) === '[3,3,3,3]' && JSON.stringify(t34Cells) === '[3,3,3,3]', JSON.stringify({ model: t34?.rows.map((r) => r.cells.length), paper: t34Cells }))
    await page.keyboard.press('Escape')
    await ready()
    const urState = () =>
      page.evaluate((id) => {
        const s = window.__editor.getSnapshot()
        const bs = [...document.querySelectorAll('.palette .undo-redo .tb')]
        return { has: s.report.body.flatMap((c) => c.blocks).some((b) => b.id === id), canUndo: s.canUndo, canRedo: s.canRedo, buttons: bs.map((b) => `${b.textContent.trim()}${b.disabled ? '×' : '○'}`).join(',') }
      }, t34?.id)
    const after34 = await urState()
    check('道具のいちばん下に「元に戻す」「やり直す」が並ぶ（まだ戻していないので「やり直す」は押せない）', after34.has && after34.buttons === '元に戻す○,やり直す×', JSON.stringify(after34))
    await page.evaluate(() => [...document.querySelectorAll('.palette .undo-redo .tb')].find((b) => b.textContent.includes('元に戻す')).click())
    await ready()
    const undone34 = await urState()
    // 「やり直す」にマウスを乗せると、キーボードでの押し方が出る
    const redoBox = await page.evaluate(() => { const r = [...document.querySelectorAll('.palette .undo-redo .tb')][1].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
    await page.mouse.move(redoBox.x, redoBox.y)
    await pause(700)
    const tip = await page.evaluate(() => { const t = document.querySelector('.ur-tip'); const r = t?.getBoundingClientRect(); const b = [...document.querySelectorAll('.palette .undo-redo .tb')][1].getBoundingClientRect(); return t ? { text: t.textContent, right: r.left >= b.right } : null })
    await page.mouse.click(redoBox.x, redoBox.y)
    await ready()
    const redone34 = await urState()
    check(
      '「元に戻す」で表が消え、「やり直す」で戻る（マウスを乗せると「やり直す（Ctrl+Y）／Mac は ⌘+Shift+Z」が右に出る）',
      !undone34.has && undone34.buttons === '元に戻す○,やり直す○' && tip?.text === 'やり直す（Ctrl+Y）Mac は ⌘+Shift+Z' && tip.right && redone34.has && !redone34.canRedo && before34 !== (await bodyKey()),
      JSON.stringify({ undone34, tip, redone34 }),
    )
    await page.mouse.move(5, 5)
    // キーボード（書く欄の外）：Ctrl+Z で戻し、Ctrl+Y・Ctrl+Shift+Z でやり直す
    await page.evaluate(() => document.activeElement?.blur())
    const keyed = []
    for (const combo of [['Control', 'z'], ['Control', 'y'], ['Control', 'z'], ['Control', 'Shift', 'Z']]) {
      for (const k of combo) await page.keyboard.down(k)
      for (const k of [...combo].reverse()) await page.keyboard.up(k)
      await ready()
      keyed.push((await urState()).has)
    }
    check('キーボード：Ctrl+Z で戻し、Ctrl+Y・Ctrl+Shift+Z でやり直す（書く欄の外）', keyed.join(',') === 'false,true,false,true', keyed.join(','))
    // 削除をやり直すと、削除の知らせ（［戻す］）がもう一度出る
    const toast = () => page.evaluate(() => document.querySelector('.stage .undo-area .undo-toast')?.textContent ?? '')
    await page.evaluate((id) => { window.__editor.select({ kind: 'table', id }); window.__editor.removeSelected() }, t34?.id)
    await ready()
    const t1 = await toast()
    await page.keyboard.down('Control')
    await page.keyboard.press('z')
    await page.keyboard.up('Control')
    await ready()
    const t2 = await toast()
    await page.keyboard.down('Control')
    await page.keyboard.press('y')
    await page.keyboard.up('Control')
    await ready()
    const t3 = await toast()
    const goneAgain = !(await urState()).has
    await page.evaluate(() => document.querySelector('.stage .undo-area .undo-toast button')?.click())
    await ready()
    check('表を削除 →「元に戻す」→「やり直す」で、また消えて「表を削除しました［戻す］」が出る（［戻す］で戻る）', t1 === '表を削除しました戻す' && t2.includes('表を戻しました') && t3 === '表を削除しました戻す' && goneAgain && (await urState()).has, JSON.stringify({ t1, t2, t3, goneAgain }))
    // 戻したあとに、ほかを変えると、やり直せなくなる
    await page.evaluate(() => window.__editor.undo())
    await ready()
    const canBefore = (await urState()).canRedo
    await page.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, name: r.basicInfo.name } })))
    await ready()
    const cleared = await urState()
    check('戻したあとに原稿を変えると、「やり直す」は押せなくなる', canBefore && !cleared.canRedo && cleared.buttons.endsWith('やり直す×'), JSON.stringify({ canBefore, cleared }))
    await page.evaluate(() => window.__editor.undo())
    await ready()
    // 書く欄の中の Ctrl+Z・Ctrl+Y は、今までどおりブラウザの文字の元に戻す・やり直す（原稿の「やり直す」はしない）
    await clickBlock(firstParagraph)
    await page.keyboard.press('End')
    await page.keyboard.type('いろは')
    const typed = await page.evaluate(() => document.querySelector('.overlay-editor').textContent)
    await page.keyboard.down('Control')
    await page.keyboard.press('z')
    await page.keyboard.up('Control')
    const inUndo = await page.evaluate(() => document.querySelector('.overlay-editor').textContent)
    await page.keyboard.down('Control')
    await page.keyboard.press('y')
    await page.keyboard.up('Control')
    const inRedo = await page.evaluate(() => ({ text: document.querySelector('.overlay-editor').textContent, editing: window.__editor.getSnapshot().editingId }))
    check('書く欄の中の Ctrl+Z・Ctrl+Y は、書いた文字を戻す・やり直す（書く欄は開いたまま）', typed.endsWith('いろは') && !inUndo.endsWith('いろは') && inRedo.text === typed && inRedo.editing === firstParagraph, JSON.stringify({ typed: typed.slice(-5), inUndo: inUndo.slice(-5), inRedo }))
    await page.keyboard.press('Escape')
    await ready()
    await page.evaluate(() => window.__editor.undo())
    await ready()
    check('ます目・元に戻す・やり直すの確かめのあと、原稿は確かめる前のまま', (await bodyKey()) === before34)
  }
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
  // 列の幅は「表の形を整える」の窓で選ぶ（mockups/v45 案A。scripts/e2e/shapeUi.mjs）
  await pickWidth(page, 'auto', { ready })
  await closeShape(page)
  await pause(300)
  await ready()
  let t = await tableNow()
  check('表に行と列を足し、列の幅を「字の多い列を広く」にできる（「表の形を整える」の窓）', t.rows.length === 3 && t.rows.every((r) => r.cells.length === 3) && t.widths === 'auto' && t.rows[1].cells[0].text === 'サテン', JSON.stringify(t.rows.map((r) => r.cells.length)))
  await clickBlock(t.rows[1].cells[0].id)
  const [cellChooser] = await Promise.all([page.waitForFileChooser(), clickPaletteButton('画像を入れる')])
  await cellChooser.accept([pngPath])
  await page.waitForFunction((id) => window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === id).rows[1].cells[0].imageId, { timeout: 30000 }, tableBlock.id)
  await ready()
  const cellImg = await page.evaluate((id) => !!document.querySelector(`.page-viewport.front [data-cell-id="${id}"] img`), t.rows[1].cells[0].id)
  check('表のセルに画像を入れられる（紙面のセルに画像が出る）', cellImg)
  await page.keyboard.press('Escape')
  await ready()
  // 画像（生地見本など）を入れたセルは、文字が空でも仮の文字（「（クリックして入力）」）を出さない。画像のない空のセルは、PC では「クリック」のまま
  {
    const now = await tableNow()
    const [imageCell, plainCell] = [now.rows[2].cells[1].id, now.rows[2].cells[2].id]
    await page.evaluate(
      (tid, cid, img) =>
        window.__editor.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === tid ? { ...b, rows: b.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => (cell.id === cid ? { ...cell, imageId: img } : cell)) })) } : b)) })) })),
      tableBlock.id,
      imageCell,
      now.rows[1].cells[0].imageId,
    )
    await ready()
    const marks = await page.evaluate((a, b) => {
      const mark = (id) => {
        const el = document.querySelector(`.page-viewport.front [data-cell-id="${id}"] [data-block-id]`)
        return el ? getComputedStyle(el, '::before').content : null
      }
      return { image: mark(a), plain: mark(b) }
    }, imageCell, plainCell)
    check('画像を入れた表のセルには、文字が空でも仮の文字を出さない（画像のない空のセルは、PC では「（クリックして入力）」のまま）', marks.image === 'none' && marks.plain === '"（クリックして入力）"', JSON.stringify(marks))
    await page.evaluate(() => window.__editor.undo())
    await ready()
  }
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
    // カーソルの位置は、書く欄が測ったもの（句読点を包んだ要素のすぐ後ろでは、ブラウザの選択の四角が空になるため。editor/overlayEditor.ts の caretBox）
    const caret = ed.overlay.caretRect()
    return { page: s.page, caretPage: ed.pageOfBlock(s.editingId, 1e9), caretVisible: !!caret && caret.top >= clip.top && caret.bottom <= clip.bottom }
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
    await page.waitForFunction((i) => !!window.__editor.getSnapshot().report.workPhotos[0].imageIds[i], {}, i)
    await ready()
  }
  const photoFit = await page.evaluate(() => getComputedStyle(document.querySelector('.page-viewport.front [data-photo-slot="0"] img')).objectFit)
  check('作品写真を2枚（上下）で入れると、枠いっぱいに切り抜いて載る', (await snap()).report.workPhotos[0].imageIds.filter(Boolean).length === 2 && photoFit === 'cover', photoFit)
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
  const moved = (await snap()).report.workPhotos[0].positions?.[0]
  check('作品写真をつかんでずらすと、トリミングが変わる（写真は選び直さない。パソコンは選ばずにずらせる）', !!moved && moved.y < 50 && moved.x === 50 && !chooserOpened, JSON.stringify(moved))
  await chooseArrangement('1枚')
  const oneShown = await page.evaluate(() => document.querySelectorAll('.page-viewport.front [data-photo-slot]').length)
  await chooseArrangement('2枚（上下')
  s = await snap()
  check('1枚にしてから2枚に戻すと、2枚目の写真も戻る（1枚目から順に載る）', oneShown === 1 && s.report.workPhotos[0].imageIds.filter(Boolean).length === 2 && !s.findings.some((f) => f.ruleId.startsWith('photos')), String(oneShown))
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
  check('入っている作品写真を押すと、その写真を選び、道具に「この写真：差し替え／外す」が出る（写真を選ぶ画面は出ない）', photoTools.sel?.index === 0 && photoTools.sel?.page === 0 && photoTools.label === 'この写真' && photoTools.tools.includes('差し替え') && photoTools.tools.includes('外す') && photoTools.marked && !chooserOpened, JSON.stringify(photoTools))
  page.off('filechooser', onChooser)
  await page.evaluate(() => [...document.querySelectorAll('.palette .tb')].find((b) => b.textContent.includes('外す')).click())
  await pause(300)
  await ready()
  s = await snap()
  check('「外す」で枠が空になり、セルフチェックに空いている枠の注意が出る', s.report.workPhotos[0].imageIds[0] === '' && s.findings.some((f) => f.ruleId === 'photos-empty-slot') && !(await page.$('.page-viewport.front [data-photo-slot="0"] img')), JSON.stringify(s.report.workPhotos))
  await page.evaluate(() => [...document.querySelectorAll('.palette .tb')].find((b) => b.textContent.includes('元に戻す')).click())
  await pause(300)
  await ready()
  s = await snap()
  check('「元に戻す」で、外した写真が戻る', s.report.workPhotos[0].imageIds.filter(Boolean).length === 2 && !s.findings.some((f) => f.ruleId.startsWith('photos')), JSON.stringify(s.report.workPhotos))

  // ---- 自動保存：読み込み直しても残っている ----
  await new Promise((r) => setTimeout(r, 1500))
  // 表示の大きさ（拡大）も、読み込み直したあとに戻る（この端末に「全体」か「拡大」かだけを覚える）
  await page.click('.zoom button:last-child')
  await pause(300)
  const pageBeforeReload = (await snap()).page
  await page.reload({ waitUntil: 'networkidle0' })
  await ready()
  await page.waitForFunction(() => window.__editor.getSnapshot().zoomed, { timeout: 5000 }).catch(() => {})
  s = await snap()
  check('読み込み直しても原稿が残っている（自動保存）', s.report.basicInfo.name === '文化　花子' && s.report.body.flatMap((c) => c.blocks).some((b) => b.type === 'figureRow'))
  // 最後に見ていたページは、この端末に覚えておく（ページの番号と欄の ID だけ）
  check('読み込み直すと、表紙ではなく、最後に見ていたページ（作品写真）が開く', pageBeforeReload > 0 && s.page === pageBeforeReload && s.layout.kinds[s.page] === 'photos', `${pageBeforeReload} → ${s.page}`)
  const zoomAfter = await page.evaluate(() => ({ zoomed: window.__editor.getSnapshot().zoomed, pressed: document.querySelector('.zoom button:last-child')?.getAttribute('aria-pressed'), stored: localStorage.getItem('sotsugyo-seisaku-report-zoom') }))
  check('PC：読み込み直すと、表示の大きさ（「拡大」）も戻る（覚えるのは「全体」か「拡大」かだけ）', zoomAfter.zoomed && zoomAfter.pressed === 'true' && zoomAfter.stored === 'zoom', JSON.stringify(zoomAfter))
  await page.click('.zoom button:first-child')
  await pause(300)
  const zoomFit = { stored: await page.evaluate(() => localStorage.getItem('sotsugyo-seisaku-report-zoom')), zoomed: (await snap()).zoomed }
  check('PC：「全体」に戻すと、それも覚える', zoomFit.stored === 'fit' && !zoomFit.zoomed, JSON.stringify(zoomFit))
  const imgLoaded = await page.evaluate(() => { const img = document.querySelector('.page-viewport.front figure img'); return img?.src.startsWith('blob:') && img.naturalWidth > 0 })
  check('読み込み直しても写真が残っている', imgLoaded)

  // ---- 書いてすぐ（0.1秒後に）読み込み直しても、最後に書いた文が残る（保存が間に合わなくても、閉じる直前の写しから戻す） ----
  const paraIds = s.report.body.flatMap((c) => c.blocks).filter((b) => b.type === 'paragraph').map((b) => b.id)
  const lastPara = paraIds[paraIds.length - 1]
  await clickBlock(lastPara)
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 20000 }, lastPara)
  await page.keyboard.type('読み込み直す直前に書いた文である。')
  await pause0(100)
  await page.reload({ waitUntil: 'networkidle0' })
  await ready()
  s = await snap()
  const keptText = s.report.body.flatMap((c) => c.blocks).find((b) => b.id === lastPara)?.content.map((n) => n.text ?? '').join('') ?? ''
  check('書いて0.1秒後に読み込み直しても、最後に書いた文が残っている', keptText.includes('読み込み直す直前に書いた文である。'), keptText.slice(-40))
  const lastParaPage = await page.evaluate((id) => window.__editor.pageOfBlock(id), lastPara)
  check('読み込み直すと、最後に書いていた段落のページが開く', lastParaPage > 0 && s.page === lastParaPage, `${s.page} / ${lastParaPage}`)
  const place = await page.evaluate(() => localStorage.getItem('sotsugyo-seisaku-report-place') ?? '')
  check('覚えておくのはページの番号と欄の ID だけ（原稿の文字は入れない）', /^\{"page":\d+,"blockId":"[^"]+"\}$/.test(place) && !place.includes('読み込み直す'), place)
  // 覚えたページがもうないとき（欄が消え、ページの数も減った）は、表紙から
  const badPlace = await page.evaluateOnNewDocument(() => localStorage.setItem('sotsugyo-seisaku-report-place', JSON.stringify({ page: 999, blockId: 'gone' })))
  await page.reload({ waitUntil: 'networkidle0' })
  await page.removeScriptToEvaluateOnNewDocument(badPlace.identifier)
  await ready()
  s = await snap()
  check('覚えたページがもうなければ、表紙が開く', s.page === 0, String(s.page))

  // ---- 段落の「削除」：押したらすぐ紙面から消え、組み直す前にもう一度押しても、隣のブロックは消えない ----
  const bodyIds = () => snap().then((x) => x.report.body.flatMap((c) => c.blocks.map((b) => b.id)))
  const idsBefore = await bodyIds()
  // すぐ後ろに別のブロックがある段落
  const doomed = s.report.body.flatMap((c) => c.blocks.filter((b, i) => b.type === 'paragraph' && c.blocks[i + 1]).map((b) => b.id))[0]
  await clickBlock(doomed)
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 20000 }, doomed)
  await pause0(300)
  const spot = await page.evaluate((id) => { const r = document.querySelector(`.page-viewport.front [data-block-id="${id}"]`).getBoundingClientRect(); return { x: r.left + 40, y: r.top + 6 } }, doomed)
  const delAt = await page.evaluate(() => { const r = [...document.querySelectorAll('.palette .tb')].find((b) => b.textContent.includes('削除')).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  await page.mouse.click(delAt.x, delAt.y)
  const gone = await page.evaluate((id) => [...document.querySelectorAll(`.page-viewport.front [data-block-id="${id}"]`)].every((e) => e.getBoundingClientRect().height === 0), doomed)
  // 組み直す前に、もう一度同じ所（道具）を押し、紙面の消えた段落の所も押す
  const stillRendering = await page.evaluate(() => window.__editor.getSnapshot().rendering)
  await page.mouse.click(delAt.x, delAt.y)
  await page.mouse.click(spot.x, spot.y)
  const openedDuring = await page.evaluate(() => window.__editor.getSnapshot().editingId)
  await ready()
  const idsAfter = await bodyIds()
  check('段落の「削除」を押すと、組み直すのを待たずに、すぐ紙面から消える', gone)
  check(
    '組み直す前にもう一度押しても、ほかのブロックは消えない（組み直す前の紙面を押しても、隣のブロックを開かない）',
    JSON.stringify(idsAfter) === JSON.stringify(idsBefore.filter((id) => id !== doomed)) && (!stillRendering || openedDuring === null),
    JSON.stringify({ stillRendering, openedDuring, removed: idsBefore.filter((id) => !idsAfter.includes(id)) }),
  )
  // PC でも、紙面の台の下に「段落を削除しました［戻す］」が出る。15秒か、次の操作まで（下の細い線は残りの時間。mockups/v32 ② 案A）
  const pcBar = () =>
    page.evaluate(() => {
      const area = document.querySelector('.stage .undo-area')
      const toast = area?.querySelector('.undo-toast')
      const line = toast?.querySelector('.undo-timer span')
      const r = toast?.getBoundingClientRect()
      const p = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current')?.getBoundingClientRect()
      return {
        text: toast?.textContent ?? '',
        role: area?.getAttribute('role'),
        button: !!toast?.querySelector('button'),
        line: line ? { duration: getComputedStyle(line).animationDuration, scale: new DOMMatrix(getComputedStyle(line).transform).a } : null,
        centered: !!r && !!p && Math.abs(r.left + r.width / 2 - (p.left + p.width / 2)) < 2 && r.bottom > p.bottom - 80,
      }
    })
  const barNow = await pcBar()
  await page.screenshot({ path: `${OUT}/2-delete-bar.png` })
  check('PC でも、段落を削除すると紙面の下の真ん中に「段落を削除しました［戻す］」が出る（残りの時間の線・読み上げにも伝わる）', barNow.text === '段落を削除しました戻す' && barNow.role === 'status' && barNow.button && barNow.line?.duration === '15s' && barNow.centered, JSON.stringify(barNow))
  await pause0(7000)
  const barLater = await pcBar()
  check('7秒たっても知らせは出たまま（15秒出す）で、残りの時間の線は縮んでいる', barLater.button && barLater.line && barLater.line.scale < 0.7 && barLater.line.scale > 0.3, JSON.stringify(barLater.line))
  await page.click('.stage .undo-area .undo-toast button')
  await ready()
  const restoredPc = await page.evaluate((id) => ({ text: document.querySelector('.stage .undo-area')?.textContent ?? '', flash: !!document.querySelector(`.page-viewport.front .undo-flash[data-block-id="${id}"]`), page: window.__editor.getSnapshot().page, at: window.__editor.pageOfBlock(id) }), doomed)
  await page.screenshot({ path: `${OUT}/2-delete-restored.png` })
  check('知らせの「戻す」で削除した段落が戻り、「✓ 段落を戻しました」と出て、戻した段落が光る', JSON.stringify(await bodyIds()) === JSON.stringify(idsBefore) && restoredPc.text === '段落を戻しました' && restoredPc.flash && restoredPc.page === restoredPc.at, JSON.stringify(restoredPc))
  await pause0(1700)
  check('光るのは少しの間だけ（1.5秒ほどで消える）', !(await page.$('.page-viewport.front .undo-flash')))
  // 次の操作（ほかの段落に書く）をすると、知らせは消える
  await clickBlock(doomed)
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 20000 }, doomed)
  await clickPaletteButton('削除')
  await ready()
  const shownAgain = (await pcBar()).button
  const other = idsBefore.find((id) => id !== doomed && s.report.body.flatMap((c) => c.blocks).find((b) => b.id === id)?.type === 'paragraph')
  await clickBlock(other)
  await page.keyboard.type('あ')
  await pause0(300)
  const afterTyping = await pcBar()
  check('知らせは、次の操作（ほかの段落に書く）をすると消える', shownAgain && !afterTyping.text, JSON.stringify({ shownAgain, afterTyping: afterTyping.text }))
  await page.keyboard.press('Escape')
  await ready()
  await page.evaluate(() => window.__editor.undo())
  await ready()
  // ほかのページを見ているときに Ctrl+Z で戻しても、戻した所へ移って光る（何をどこに戻したか分かる）
  await page.evaluate(() => window.__editor.goToPage(0, 'none'))
  await ready()
  await page.keyboard.down('Control')
  await page.keyboard.press('z')
  await page.keyboard.up('Control')
  await ready()
  await pause0(200)
  const movedBack = await page.evaluate((id) => ({ page: window.__editor.getSnapshot().page, at: window.__editor.pageOfBlock(id), flash: !!document.querySelector(`.page-viewport.front .undo-flash[data-block-id="${id}"]`) }), doomed)
  check('ほかのページで元に戻す（Ctrl+Z）と、戻した段落のページへ移って光る', JSON.stringify(await bodyIds()) === JSON.stringify(idsBefore) && movedBack.page === movedBack.at && movedBack.page > 0 && movedBack.flash, JSON.stringify(movedBack))
  s = await snap()
  // 組み直しを速くする仕組み（分けて組む・使い回す）で組んだ紙面が、報告書全体を1つの文書として組んだ紙面と同じ（いくつも操作したあと）
  const parity = await paperMatchesWhole(page)
  check('いくつも操作したあとの紙面が、報告書全体を1つの文書として組んだ紙面と同じ（分けて組む・使い回す仕組みで、紙面が変わらない）', parity.same, JSON.stringify(parity))

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

  // ---- 図・表のあとの続き：章の最後の図の下が空いていれば「＋ ここに続きを書く」。押すと図の後ろに段落ができる（画面だけ。mockups/v32 ① 案A） ----
  await page.evaluate(() => {
    const t = (text) => ({ type: 'text', text })
    const body = [
      { id: 'kc1', title: '制作過程', blocks: [{ type: 'paragraph', id: 'kpA', content: [t('袖には波の模様を刺繍した'), { type: 'ref', targetId: 'kf1', withParens: true }, t('。')] }, { type: 'figureRow', id: 'kg1', figures: [{ id: 'kf1', imageId: '', caption: '袖の刺繍' }] }] },
      { id: 'kc2', title: 'まとめ', blocks: [{ type: 'paragraph', id: 'kpZ', content: [t('まとめた。')] }] },
    ]
    window.__editor.update((r) => ({ ...r, body }))
  })
  await pause(300)
  await ready()
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('kpA'), 'none'))
  await ready()
  await pause0(200)
  const contRow = () =>
    page.evaluate(() => {
      const b = document.querySelector('.continue-row')
      const g = document.querySelector('.page-viewport.front .figure-group[data-group-id="kg1"]')?.getBoundingClientRect()
      const r = b?.getBoundingClientRect()
      return { shown: !!b && !b.hidden && r.height > 0, text: b?.textContent ?? '', below: !!g && !!r && r.top >= g.bottom && r.top - g.bottom < 40, inPaper: !!b?.closest('.page-viewport'), x: r ? r.left + 60 : 0, y: r ? r.top + r.height / 2 : 0 }
    })
  const autoRow = await contRow()
  await page.screenshot({ path: `${OUT}/2-continue-row.png` })
  check('章の最後の図がページの最後で、下が空いているときは、図のすぐ下に「＋ ここに続きを書く」が出る（紙面の外の層に置く）', autoRow.shown && autoRow.text === 'ここに続きを書く' && autoRow.below && !autoRow.inPaper, JSON.stringify(autoRow))
  const pagesNow = (await snap()).layout.kinds.length
  await page.pdf({ path: `${OUT}/continue-row.pdf`, preferCSSPageSize: true, printBackground: true })
  const crDoc = await getDocument({ url: `${OUT}/continue-row.pdf`, verbosity: 0 }).promise
  let crText = ''
  for (let n = 1; n <= crDoc.numPages; n++) crText += (await (await crDoc.getPage(n)).getTextContent()).items.map((it) => it.str).join('')
  check('「＋ ここに続きを書く」は PDF に出ず、ページの数も変わらない', !crText.includes('ここに続きを書く') && crText.replace(/\s/g, '').includes('袖の刺繍') && crDoc.numPages === pagesNow, `${crDoc.numPages} / ${pagesNow}ページ`)
  // 下が空いている図を選んだときも、その空いた所（本文の領域の中）に出る
  await page.evaluate(() => window.__editor.select({ kind: 'figure', id: 'kf1' }))
  await pause0(200)
  const selRow = await page.evaluate(() => {
    const r = document.querySelector('.continue-row').getBoundingClientRect()
    const p = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current').getBoundingClientRect()
    return { inside: r.bottom <= p.top + (p.height * (297 - 25)) / 297 }
  })
  check('下が空いている図を選んだときも、図のすぐ下の空いた所（本文の領域の中）に出る', (await contRow()).shown && (await contRow()).below && selRow.inside, JSON.stringify(selRow))
  await page.evaluate(() => window.__editor.select(null))
  await pause0(200)
  await page.mouse.click(autoRow.x, autoRow.y)
  await waitEditing(() => window.__editor.getSnapshot().editingKind === 'paragraph')
  await ready()
  await page.keyboard.type('最初の図案は波が細かすぎた。')
  await page.keyboard.press('Escape')
  await ready()
  s = await snap()
  const kc1 = s.report.body.find((c) => c.id === 'kc1').blocks
  check('「＋ ここに続きを書く」を押すと、図の後ろ（同じ章の中）に新しい段落ができ、そこで書ける', kc1.length === 3 && kc1[1].id === 'kg1' && kc1[2].type === 'paragraph' && kc1[2].content.map((n) => n.text ?? '').join('') === '最初の図案は波が細かすぎた。' && s.report.body.find((c) => c.id === 'kc2').blocks.length === 1, JSON.stringify(kc1.map((b) => b.id)))
  await pause0(150)
  check('図の後ろに段落があるときは、選ばなければ出ない', !(await contRow()).shown)
  // 選んでも、後ろに段落が続く（下が空いていない）ときは出さない。続きの段落の1行目に重ならず、押せば書ける
  await page.evaluate(() => window.__editor.select({ kind: 'figure', id: 'kf1' }))
  await pause0(200)
  const nextLine = await page.evaluate((id) => {
    const b = document.querySelector('.continue-row')
    const r = b.getBoundingClientRect()
    const p = [...document.querySelectorAll(`.page-viewport.front [data-block-id="${id}"]`)].find((e) => e.getBoundingClientRect().height > 0)
    const range = document.createRange()
    range.selectNodeContents(p)
    const line = range.getClientRects()[0]
    const hit = document.elementFromPoint(line.left + 20, (line.top + line.bottom) / 2)
    return { shown: !b.hidden && r.height > 0, overlap: !b.hidden && r.bottom > line.top && r.top < line.bottom, hit: hit?.closest('[data-block-id]')?.getAttribute('data-block-id') ?? hit?.className }
  }, kc1[2].id)
  await page.screenshot({ path: `${OUT}/2-continue-row-none.png` })
  check('図を選んでも、後ろに段落が続くときは「＋ ここに続きを書く」を出さない（続きの段落の1行目に重ならない）', !nextLine.shown && !nextLine.overlap && nextLine.hit === kc1[2].id, JSON.stringify(nextLine))
  await page.evaluate(() => window.__editor.select(null))
  // 元に戻す（書いた文 → 作った段落）で、きれいに元どおりになる
  await page.evaluate(() => window.__editor.undo())
  await ready()
  await page.evaluate(() => window.__editor.undo())
  await ready()
  await pause0(150)
  check('元に戻すと、作った段落が消え、また図の下に「＋ ここに続きを書く」が出る', (await snap()).report.body.find((c) => c.id === 'kc1').blocks.length === 2 && (await contRow()).shown)


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

  // ---- はじめて使う学生の試し（v32 のあと）で見つかったこと ----
  // （ここで本文を入れ替えて確かめ、終わったら元の原稿に戻す。後ろの確かめ（PDF の「やめる」など）が、元の長さの原稿で動くように）
  {
    const savedReport = await page.evaluate(() => window.__editor.getSnapshot().report)
    const setBody = async () => {
      await page.evaluate(() => {
        const t = (text) => ({ type: 'text', text })
        const body = [
          {
            id: 'fc1',
            title: '制作過程',
            blocks: [
              { type: 'paragraph', id: 'fpA', content: [t('最初に生地の色を確かめ、汚れや傷がないかを見た。次に型紙を写した。')] },
              { type: 'paragraph', id: 'fpB', content: [t('次の段落である。')] },
              { type: 'paragraph', id: 'fpH', content: [t('')], hint: '工夫した点を書く' },
              { type: 'subheading', id: 'fsN', title: '（1）素材' },
            ],
          },
          { id: 'fc2', title: 'まとめ', blocks: [{ type: 'paragraph', id: 'fpZ', content: [t('まとめた。')] }] },
        ]
        window.__editor.update((r) => ({ ...r, body }))
      })
      await ready()
    }
    await setBody()
    const textOf = (b) => (b.type === 'subheading' ? `【${b.title}】` : b.type === 'paragraph' ? b.content.map((n) => (n.type === 'ref' ? '(ref)' : n.text)).join('') : `[${b.type}]`)
    const blocksOf = async (chapterId) => (await snap()).report.body.find((c) => c.id === chapterId).blocks
    const ctrlEnd = async () => {
      await page.keyboard.down('Control')
      await page.keyboard.press('End')
      await page.keyboard.up('Control')
    }

    // 段落を分けて書き、すぐ「小見出し」を押して、すぐ打つ：見出しの文字は消えず、書いていた段落の後ろに入る（前は、組み直すまでの1秒ほどの間に打った文字が消え、見出しが段落の前に入っていた）
    await clickBlock('fpA')
    await ctrlEnd()
    await page.keyboard.press('Enter')
    await page.keyboard.type('分けた段落に書いた。')
    await clickPaletteButton('小見出し')
    await page.keyboard.type('すぐ打った見出し')
    const openedAt = await page.evaluate(() => ({ editing: window.__editor.getSnapshot().editingKind, rendering: window.__editor.getSnapshot().rendering }))
    await page.keyboard.press('Escape')
    await ready()
    let fc1 = (await blocksOf('fc1')).map(textOf)
    check(
      '段落を分けて書き、すぐ「小見出し」を押してすぐ打っても、見出しの文字は消えず、書いていた段落の後ろに入る（組み直すのを待たずに書く欄が開く）',
      JSON.stringify(fc1.slice(0, 4)) === JSON.stringify(['最初に生地の色を確かめ、汚れや傷がないかを見た。次に型紙を写した。', '分けた段落に書いた。', '【すぐ打った見出し】', '次の段落である。']) && openedAt.editing === 'subheading',
      JSON.stringify({ fc1, openedAt }),
    )

    // 何も書いていない段落で「小見出し」：その段落を見出しに置き換える（空の段落を残さない）
    await clickBlock('fpB')
    await ctrlEnd()
    await page.keyboard.press('Enter')
    await clickPaletteButton('小見出し')
    await page.keyboard.type('置き換えた見出し')
    await page.keyboard.press('Escape')
    await ready()
    fc1 = (await blocksOf('fc1')).map(textOf)
    check('何も書いていない段落で「小見出し」を押すと、その段落が見出しになる（空の段落が残らない）', JSON.stringify(fc1.slice(3, 6)) === JSON.stringify(['次の段落である。', '【置き換えた見出し】', '']) && fc1.length === 7, JSON.stringify(fc1))

    // ひな形の説明のある空の段落：開いて何も書かずに閉じても、説明は消えない
    await clickBlock('fpH')
    await waitEditing(() => window.__editor.getSnapshot().editingId === 'fpH')
    await page.keyboard.press('Escape')
    await ready()
    const kept = await page.evaluate(() => ({
      hint: window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === 'fpH')?.hint,
      placeholder: document.querySelector('.page-viewport.front [data-block-id="fpH"]')?.dataset.placeholder ?? '',
    }))
    check('ひな形の説明のある空の段落を開いて、何も書かずに閉じても、説明（「ここに書くこと」）は消えない', kept.hint === '工夫した点を書く' && kept.placeholder.includes('工夫した点を書く'), JSON.stringify(kept))

    // 小見出しに手で書いた「（1）」：警告で、消す番号を書く（番号の「ⅰ．」は自動で付く）。押すと「（1）」の後ろにカーソルが来るので、Backspace で自分で消す
    const headingFix = await page.evaluate(() => {
      const li = [...document.querySelectorAll('.side .issue')].find((x) => x.textContent.includes('小見出しに番号を手で書いている'))
      const info = { shown: !!li, warning: !!li?.classList.contains('warning'), fix: !!li?.querySelector('.fix'), detail: li?.querySelector('.detail')?.textContent ?? '' }
      li?.click()
      return info
    })
    await waitEditing(() => window.__editor.getSnapshot().editingId === 'fsN')
    for (let k = 0; k < 3; k++) await page.keyboard.press('Backspace')
    await page.keyboard.press('Escape')
    await ready()
    const fixedTitle = (await blocksOf('fc1')).find((b) => b.id === 'fsN')?.title
    check('小見出しに手で書いた「（1）」は警告になり、「「（1）」を消します」と書く（「直す」はない）。押して移り、自分で消すと番号のない見出しになる', headingFix.shown && headingFix.warning && !headingFix.fix && headingFix.detail.includes('「（1）」を消します') && fixedTitle === '素材', JSON.stringify({ headingFix, fixedTitle }))

    // Enter を押して何も書かずに閉じた空の段落：「空の段落がある」を押すとその段落が開き、道具の「削除」で消せる（「段落を削除しました［戻す］」が出る）
    await clickBlock('fpZ')
    await ctrlEnd()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Escape')
    await ready()
    const emptyCount = (await blocksOf('fc2')).length
    const emptyFix = await page.evaluate(() => {
      const li = [...document.querySelectorAll('.side .issue')].find((x) => x.textContent.includes('空の段落がある'))
      const info = { shown: !!li, fix: !!li?.querySelector('.fix'), detail: li?.querySelector('.detail')?.textContent ?? '' }
      li?.click()
      return info
    })
    await waitEditing(() => { const s = window.__editor.getSnapshot(); return s.editingKind === 'paragraph' && s.editingId !== 'fpZ' })
    await clickPaletteButton('削除')
    await ready()
    const afterEmpty = { blocks: (await blocksOf('fc2')).map(textOf), toast: await page.evaluate(() => document.querySelector('.undo-toast')?.textContent ?? '') }
    check('何も書かずに残った空の段落は「空の段落がある」（「削除」で消すと書く）。押してその段落へ移り、道具の「削除」で消すと、「段落を削除しました［戻す］」が出る', emptyCount === 2 && emptyFix.shown && !emptyFix.fix && emptyFix.detail === '「削除」で、この空の段落を消します' && JSON.stringify(afterEmpty.blocks) === JSON.stringify(['まとめた。']) && afterEmpty.toast.includes('段落を削除しました'), JSON.stringify({ emptyCount, emptyFix, afterEmpty }))

    // 文の途中で「図を入れる」：（図n）はカーソルの位置ではなく、その文の終わり（「。」の前）に入る
    await page.evaluate(() => window.__editor.openWhenReady('fpA', 8))
    await waitEditing(() => window.__editor.getSnapshot().editingId === 'fpA')
    const [figChooser] = await Promise.all([page.waitForFileChooser(), clickPaletteButton('図を入れる')])
    await figChooser.accept([pngPath])
    await waitEditing(() => window.__editor.getSnapshot().editingKind === 'figureCaption')
    await page.keyboard.type('生地')
    await page.keyboard.press('Escape')
    await ready()
    const fpAText = (await blocksOf('fc1')).find((b) => b.id === 'fpA').content.map((n) => (n.type === 'ref' ? '（図）' : n.text)).join('')
    check('文の途中で「図を入れる」を押すと、（図n）はその文の終わり（「。」の前）に入る（「確かめ（図1）、汚れや…」にしない）', fpAText === '最初に生地の色を確かめ、汚れや傷がないかを見た（図）。次に型紙を写した。', fpAText)

    // 何も書いていない段落で「表を入れる」：「（表n）。」だけの段落を作らず、その段落の位置に表が入る。本文で参照していないことはチェックで知らせる
    await clickBlock('fpZ')
    await ctrlEnd()
    await page.keyboard.press('Enter')
    await clickPaletteButton('表を入れる')
    // ます目の 2列×2行（いつもの大きさ）を押す
    await page.evaluate(() => document.querySelectorAll('.palette .table-menu .tgrid button')[1 * 6 + 1].click())
    await waitEditing(() => window.__editor.getSnapshot().editingKind === 'tableCaption')
    await page.keyboard.type('使用した糸')
    await ready()
    s = await snap()
    const fc2 = s.report.body.find((c) => c.id === 'fc2').blocks
    const tableId = fc2.find((b) => b.type === 'table')?.id
    check('何も書いていない段落で「表を入れる」と、「（表n）。」だけの段落は作らず、その段落の位置に表が入る（参照していないことはチェックで知らせる）', JSON.stringify(fc2.map(textOf)) === JSON.stringify(['まとめた。', '[table]']) && s.findings.some((f) => f.ruleId === 'table-unreferenced' && f.blockId === tableId), JSON.stringify(fc2.map(textOf)))
    await page.keyboard.press('Escape')
    await ready()

    // 表のセルを書いている間も、表の下が空いていれば「＋ ここに続きを書く」が出る（前は、セルを書くと消えた）
    const cellId = fc2.find((b) => b.type === 'table').rows[1].cells[0].id
    await clickBlock(cellId)
    await waitEditing((id) => window.__editor.getSnapshot().editingId === id, cellId)
    await pause0(300)
    const rowWhileCell = await page.evaluate(() => { const b = document.querySelector('.continue-row'); return !!b && !b.hidden && b.getBoundingClientRect().height > 0 })
    check('表のセルを書いている間も、表の下が空いていれば「＋ ここに続きを書く」が出る', rowWhileCell)

    // 消せない行・列を「行を消す」「列を消す」で押したとき：わけと、表ごと消す方法を画面の下に知らせる（セルは書いたまま）。
    // まず書いているセルの列を消して1列にし（その列のセルはなくなるので、表を選んだ状態になる）、残ったセルを書く
    await clickPaletteButton('列を消す')
    await ready()
    const leftCell = (await snap()).report.body.find((c) => c.id === 'fc2').blocks.find((b) => b.type === 'table').rows[1].cells[0].id
    await clickBlock(leftCell)
    await waitEditing((id) => window.__editor.getSnapshot().editingId === id, leftCell)
    await clickPaletteButton('列を消す')
    await pause0(200)
    const colNote = await page.evaluate(() => ({ text: document.querySelector('.undo-toast')?.textContent ?? '', editing: window.__editor.getSnapshot().editingKind, cols: window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.type === 'table' && b.id.startsWith('t-'))?.rows[0].cells.length }))
    await clickPaletteButton('行を消す')
    await pause0(200)
    const rowNote = await page.evaluate(() => document.querySelector('.undo-toast')?.textContent ?? '')
    check(
      '1列の表で「列を消す」、2行の表で「行を消す」を押すと、わけと表ごと消す方法（左の「この表」の「削除」）が画面の下に出る（セルは書いたまま）',
      colNote.text.includes('表には1列以上が要ります') && colNote.text.includes('「この表」の「削除」') && colNote.editing === 'tableCell' && colNote.cols === 1 && rowNote.includes('見出しの行ともう1行が要ります'),
      JSON.stringify({ colNote, rowNote }),
    )
    await page.keyboard.press('Escape')
    await ready()

    // 拡大して見えていない所（ページの下の方）を元に戻したときは、そこまで動かし終えてから光らせる（前は、動かしている間に光が消えていた）
    await page.evaluate(() => {
      const t = (text) => ({ type: 'text', text })
      const long = '袖の形を何度も試し、動きやすさと見た目のつり合いを確かめた。'.repeat(5)
      const blocks = Array.from({ length: 9 }, (_, i) => ({ type: 'paragraph', id: `uf${i}`, content: [t(long)] }))
      window.__editor.update((r) => ({ ...r, body: [{ id: 'uc1', title: '制作過程', blocks }] }))
    })
    await ready()
    await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('uf0'), 'none'))
    await ready()
    const lowId = await page.evaluate(() => {
      const ed = window.__editor
      const first = ed.pageOfBlock('uf0')
      return ['uf8', 'uf7', 'uf6', 'uf5', 'uf4'].find((id) => ed.pageOfBlock(id) === first && ed.pageOfBlock(id, 1e9) === first)
    })
    await page.evaluate(() => window.__editor.setZoom(true))
    await pause0(300)
    await page.evaluate((id) => window.__editor.removeBlock(id), lowId)
    await ready()
    await page.evaluate(() => {
      document.querySelector('.page-scroller').scrollTop = 0
    })
    await pause0(300)
    await page.evaluate(() => {
      window.__flashSeen = null
      const scroller = document.querySelector('.page-scroller')
      const obs = new MutationObserver(() => {
        const el = document.querySelector('.page-viewport.front .undo-flash')
        if (!el || window.__flashSeen) return
        const r = el.getBoundingClientRect()
        const s = scroller.getBoundingClientRect()
        window.__flashSeen = { inView: r.top >= s.top - 1 && r.bottom <= s.bottom + 1, top: Math.round(r.top), bottom: Math.round(r.bottom), scrollerTop: Math.round(s.top), scrollerBottom: Math.round(s.bottom), scrollTop: Math.round(scroller.scrollTop) }
        obs.disconnect()
      })
      obs.observe(scroller, { subtree: true, attributes: true, attributeFilter: ['class'] })
    })
    await page.evaluate(() => window.__editor.undo())
    await page.waitForFunction(() => !!window.__flashSeen, { timeout: 30000 }).catch(() => {})
    const flashSeen = await page.evaluate(() => window.__flashSeen)
    check('拡大していて、元に戻した段落がページの下の方（見えていない所）にあるときは、そこへ動かし終えてから光らせる（光ったときには見えている）', !!lowId && !!flashSeen?.inView, JSON.stringify({ lowId, flashSeen }))
    await page.evaluate(() => window.__editor.setZoom(false))
    await ready()
    await page.evaluate((r) => window.__editor.update(() => r), savedReport)
    await ready()
  }

  // ---- はじめて使う学生の試し（2回目）で見つかったこと ----
  // （ここでも本文を入れ替えて確かめ、終わったら元の原稿に戻す）
  {
    const savedReport = await page.evaluate(() => window.__editor.getSnapshot().report)
    await page.evaluate(() => {
      const t = (text) => ({ type: 'text', text })
      const body = [
        { id: 'gc1', title: '企画', blocks: [{ type: 'paragraph', id: 'gp1', content: [t('この制作の目的は、砂漠の王女の衣装を作ることである。')] }] },
        { id: 'gc2', title: '追加の大見出し', blocks: [{ type: 'subheading', id: 'gs1', title: '素材の選定' }] },
      ]
      window.__editor.update((r) => ({ ...r, body, references: [] }))
    })
    await ready()
    const blocksOf = async (chapterId) => (await snap()).report.body.find((c) => c.id === chapterId)?.blocks ?? []
    const textOf = (b) => (b.type === 'subheading' ? `【${b.title}】` : b.type === 'paragraph' ? b.content.map((n) => (n.type === 'ref' ? '(ref)' : n.text)).join('') : `[${b.type}]`)
    const ctrlEnd = async () => {
      await page.keyboard.down('Control')
      await page.keyboard.press('End')
      await page.keyboard.up('Control')
    }
    const rowAt = () =>
      page.evaluate(() => {
        const b = document.querySelector('.continue-row')
        const h = document.querySelector('.page-viewport.front [data-block-id="gs1"]')?.closest('h2')?.getBoundingClientRect()
        const r = b?.getBoundingClientRect()
        return { shown: !!b && !b.hidden && r.height > 0, below: !!h && !!r && r.top >= h.bottom, x: r ? r.left + r.width / 2 : 0, y: r ? r.top + r.height / 2 : 0, bottom: r?.bottom ?? 0, left: h?.left ?? 0 }
      })

    // 章の最後の小見出し（足したばかりで、後ろに何もない）の下に「＋ ここに続きを書く」が出る（mockups/v32 ① 案A を見出しにも）
    await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('gs1'), 'none'))
    await ready()
    await pause0(300)
    const headRow = await rowAt()
    await page.screenshot({ path: `${OUT}/g1-heading-row.png` })
    check('章の最後の小見出し（後ろに何もない）の下が空いていれば、そのすぐ下に「＋ ここに続きを書く」が出る', headRow.shown && headRow.below, JSON.stringify(headRow))
    // 見出しの下の空いた所を押して打っても、見出しの続きにならない（前は「素材の選定使う布」になった）
    await page.mouse.click(headRow.left + 60, headRow.bottom + 80)
    await pause0(300)
    const afterBlank = (await snap()).editingId
    await page.keyboard.type('使う布')
    await pause0(200)
    const headAfter = (await blocksOf('gc2')).map(textOf)
    check('見出しの下の空いた所を押して打っても、見出しの続きにならない（見出しの書く欄は開かない）', afterBlank === null && JSON.stringify(headAfter) === JSON.stringify(['【素材の選定】']), JSON.stringify({ afterBlank, headAfter }))
    // 見出しを書いている間も出て、押すと見出しのすぐ後ろに段落ができ、そこに書ける
    await clickBlock('gs1')
    await waitEditing(() => window.__editor.getSnapshot().editingId === 'gs1')
    await pause0(300)
    const whileHead = await rowAt()
    await page.mouse.click(whileHead.x, whileHead.y)
    await waitEditing(() => window.__editor.getSnapshot().editingKind === 'paragraph')
    await page.keyboard.type('使う布を選んだ。')
    await page.keyboard.press('Escape')
    await ready()
    const headRowAfter = (await blocksOf('gc2')).map(textOf)
    check('見出しを書いている間も出て、押すと見出しのすぐ後ろに段落ができ、そこに書ける（見出しは変わらない）', whileHead.shown && JSON.stringify(headRowAfter) === JSON.stringify(['【素材の選定】', '使う布を選んだ。']), JSON.stringify({ whileHead, headRowAfter }))

    // 「大見出し」を足す：見出しを書いている間は、付いてきた空の段落を「空の段落がある」と言わない。
    // Enter で、その段落へ移る（空の段落をもう1つ作らない）。書かずに閉じたら言う
    const emptyShown = () => page.evaluate(() => ({ findings: window.__editor.getSnapshot().findings.filter((f) => f.ruleId === 'paragraph-empty').map((f) => f.blockId), side: [...document.querySelectorAll('.side .issue')].some((x) => x.textContent.includes('空の段落がある')) }))
    await clickPaletteButton('大見出し')
    await waitEditing(() => window.__editor.getSnapshot().editingKind === 'chapter')
    await page.keyboard.type('まとめ')
    await ready()
    const chapterId = await page.evaluate(() => window.__editor.getSnapshot().editingId)
    const whileTitle = await emptyShown()
    await page.screenshot({ path: `${OUT}/g2-new-chapter.png` })
    await page.keyboard.press('Enter')
    await ready()
    const enter = await page.evaluate((id) => { const s = window.__editor.getSnapshot(); const c = s.report.body.find((x) => x.id === id); return { editing: s.editingId, kind: s.editingKind, blocks: c.blocks.map((b) => b.id), title: c.title } }, chapterId)
    const whilePara = await emptyShown()
    await page.keyboard.press('Escape')
    await ready()
    const afterClose = await emptyShown()
    check(
      '「大見出し」を足して見出しを書いている間・Enter で付いてきた段落へ移って書いている間は「空の段落がある」と言わず、空のまま閉じたら言う',
      !whileTitle.findings.length && !whileTitle.side && enter.title === 'まとめ' && enter.kind === 'paragraph' && enter.blocks.length === 1 && enter.editing === enter.blocks[0] && !whilePara.findings.length && afterClose.findings.includes(enter.blocks[0]) && afterClose.side,
      JSON.stringify({ whileTitle, enter, whilePara, afterClose }),
    )

    // 紙の外（まわりの灰色の所）を押すと、書く欄を閉じる（Esc と同じ。書いた文字は残る。近くの欄が開き直さない）
    await page.evaluate(() => window.__editor.openWhenReady('gp1', 3))
    await waitEditing(() => window.__editor.getSnapshot().editingId === 'gp1')
    await page.keyboard.type('とても')
    const grey = await page.evaluate(() => {
      const p = [...document.querySelectorAll('.page-viewport.front [data-vivliostyle-page-container]')].map((e) => e.getBoundingClientRect()).find((r) => r.width > 0 && r.left > 0)
      return { x: p.right + 40, y: p.top + 60 }
    })
    await page.mouse.click(grey.x, grey.y)
    await pause0(500)
    const greyClosed = { editing: (await snap()).editingId, text: textOf((await blocksOf('gc1'))[0]) }
    check('紙の外（まわりの灰色の所）を押すと、書く欄を閉じる（書いた文字は残り、近くの欄が開き直さない）', greyClosed.editing === null && greyClosed.text === 'この制とても作の目的は、砂漠の王女の衣装を作ることである。', JSON.stringify(greyClosed))
    await ready()

    // 何も書いていない段落で「図を入れる」：表と同じく、（図n）は入らず、その段落の位置に図が入る。
    // 指摘「本文中に「図1」…を入れる」は、直し方（「図1に示す」のように書く）を言う
    await clickBlock('gp1')
    await ctrlEnd()
    await page.keyboard.press('Enter')
    await waitEditing(() => window.__editor.getSnapshot().editingKind === 'paragraph' && window.__editor.getSnapshot().editingId !== 'gp1')
    const [emptyFigChooser] = await Promise.all([page.waitForFileChooser(), clickPaletteButton('図を入れる')])
    await emptyFigChooser.accept([pngPath])
    await waitEditing(() => window.__editor.getSnapshot().editingKind === 'figureCaption')
    await page.keyboard.type('全体像')
    await page.keyboard.press('Escape')
    await ready()
    const emptyFig = await page.evaluate(() => {
      const s = window.__editor.getSnapshot()
      const blocks = s.report.body.find((c) => c.id === 'gc1').blocks
      const fig = s.findings.find((f) => f.ruleId === 'figure-unreferenced')
      return { blocks: blocks.map((b) => (b.type === 'paragraph' ? b.content.map((n) => (n.type === 'ref' ? '(ref)' : n.text)).join('') : b.type)), detail: fig?.detail, side: [...document.querySelectorAll('.side .issue')].find((x) => x.textContent.includes('本文中に「図1」'))?.textContent ?? '' }
    })
    check(
      '何も書いていない段落で「図を入れる」と、表と同じく（図n）は入らず、その段落の位置に図が入る。指摘は「図の前の段落に「図1に示す」のように書く」と直し方を言う',
      JSON.stringify(emptyFig.blocks) === JSON.stringify(['この制とても作の目的は、砂漠の王女の衣装を作ることである。', 'figureRow']) && emptyFig.detail === '図の前の段落に「図1に示す」のように書く' && emptyFig.side.includes('図1に示す'),
      JSON.stringify(emptyFig),
    )

    // 引用・参考文献の窓：書いた内容があるまま「×」「やめる」を押すと、窓の中で「書いた内容を反映せずに閉じますか？」と聞く（前は、すぐ閉じて消えた）
    // 窓は、使い方の「引用・参考文献」の「引用・参考文献を入れる」から開く（右の欄からは外した。mockups/v35 ①。PC の使い方は開いたまま）
    const openRefs = async () => {
      if (!(await page.$('.help-topic .help-refs'))) {
        if (!(await page.$('.side .help-side'))) await pickMenu(page, '使い方')
        await page.waitForSelector('.help-list button[data-topic="references"]')
        await page.evaluate(() => document.querySelector('.help-list button[data-topic="references"]').click())
        await page.waitForSelector('.help-topic .help-refs')
      }
      await page.click('.help-topic .help-refs')
      await page.waitForSelector('.modal .ref-card, .modal .row-buttons')
    }
    const refsState = () =>
      page.evaluate(() => ({
        modal: !!document.querySelector('.modal'),
        ask: document.querySelector('.ref-ask-q')?.textContent ?? '',
        buttons: [...document.querySelectorAll('.ref-ask button')].map((b) => b.textContent.trim()),
        focus: document.activeElement?.textContent?.trim() ?? '',
        first: document.querySelector('.modal .ref-card input')?.value ?? null,
        saved: window.__editor.getSnapshot().report.references.map((r) => r.author ?? r.siteTitle),
      }))
    const refsButton = (label) => page.evaluate((label) => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.trim() === label).click(), label)
    // 何も書いていなければ（文献を足しただけでも）、「×」ですぐ閉じる
    await openRefs()
    await refsButton('＋ 書籍を追加')
    await page.click('.modal .close')
    await pause0(200)
    const plainClose = await refsState()
    // 4冊書いて「×」：閉じずに聞く。「反映して閉じる」に移る（Enter でうっかり消さない）
    await openRefs()
    for (let i = 0; i < 4; i++) await refsButton('＋ 書籍を追加')
    const authorInputs = await page.$$('.modal .ref-card .field:first-child input')
    for (const [i, input] of authorInputs.entries()) await input.type(`著者${i + 1}`)
    await page.click('.modal .close')
    await pause0(200)
    const askedX = await refsState()
    await page.screenshot({ path: `${OUT}/g3-refs-ask.png` })
    // 「戻る」：書いた内容はそのまま、窓に戻る
    await refsButton('戻る')
    await pause0(200)
    const back = await refsState()
    // 「やめる」→「反映せずに閉じる」：閉じて、書いた内容は反映しない
    await refsButton('やめる')
    await pause0(200)
    const askedCancel = await refsState()
    await refsButton('反映せずに閉じる')
    await ready()
    const discarded = await refsState()
    check(
      '引用・参考文献の窓：何も書いていなければ「×」ですぐ閉じ、書いた内容があれば「×」「やめる」で窓の中で「書いた内容を反映せずに閉じますか？」と聞く（反映して閉じる・反映せずに閉じる・戻る）。「戻る」で書いた内容のまま戻り、「反映せずに閉じる」で閉じる',
      !plainClose.modal &&
        askedX.modal && askedX.ask === '書いた内容を反映せずに閉じますか？' && JSON.stringify(askedX.buttons) === JSON.stringify(['戻る', '反映せずに閉じる', '反映して閉じる']) && askedX.focus === '反映して閉じる' &&
        back.modal && !back.ask && back.first === '著者1' && back.focus === 'やめる' &&
        askedCancel.ask.includes('反映せずに') && !discarded.modal && discarded.saved.length === 0,
      JSON.stringify({ plainClose, askedX, back, askedCancel, discarded }),
    )
    // 「反映して閉じる」：書いた内容を反映して閉じる
    await openRefs()
    await refsButton('＋ 書籍を追加')
    await (await page.$('.modal .ref-card .field:first-child input')).type('浜松隆志')
    await page.click('.modal .close')
    await pause0(200)
    await refsButton('反映して閉じる')
    await ready()
    const kept = await refsState()
    check('「反映して閉じる」で、書いた内容を反映して閉じる', !kept.modal && JSON.stringify(kept.saved) === JSON.stringify(['浜松隆志']), JSON.stringify(kept))
    // 入れた文献は、使い方のボタンからもう一度開くと、窓の中で直せる（ページをクリックしても開く）
    await openRefs()
    const reopened = await page.evaluate(() => [...document.querySelectorAll('.modal .ref-card .field:first-child input')].map((i) => i.value))
    await refsButton('やめる')
    await pause0(200)
    check('入れた引用・参考文献は、使い方の「引用・参考文献を入れる」からもう一度開くと、窓の中に出て直せる', JSON.stringify(reopened) === JSON.stringify(['浜松隆志']) && !(await page.$('.modal')), JSON.stringify(reopened))
    // 使い方を閉じて、右の欄に戻る
    await page.click('.side .help-close')
    await page.waitForSelector('.side .menu-btn')

    // PC の使い方の題は「クリック」のまま（スマホだけ「タップ」。phone.mjs）
    await pickMenu(page, '使い方')
    await page.waitForSelector('.side .help-list')
    const pcHelp = await page.evaluate(() => [...document.querySelectorAll('.side .help-list button')].map((b) => b.textContent).find((t) => t.startsWith('書き方')))
    await page.evaluate(() => document.querySelector('.side .help-close').click())
    await page.waitForSelector('.side .menu-btn')
    check('PC の使い方の題は「書き方（クリックして書く）」のまま', pcHelp === '書き方（クリックして書く）', pcHelp)

    await page.evaluate((r) => window.__editor.update(() => r), savedReport)
    await ready()
  }

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
  // 右の欄の既定の幅は 340px（mockups/v37。前は 312px）。動かしていない欄の幅は、このブラウザに覚えない（既定の幅が変われば、それに合わせる）
  const storedPanels = await page.evaluate(() => localStorage.getItem('sotsugyo-seisaku-report-panels'))
  check('右の欄の幅は、ふだん 340px（動かしていなければ、幅を覚えない）', rightBefore === 340 && leftBefore === 124 && (storedPanels === null || storedPanels === '{}'), `${leftBefore} / ${rightBefore} / ${storedPanels}`)
  await dragHandle('left', 60)
  await dragHandle('right', -80)
  const leftAfter = await colWidth('.thumbs-col')
  const rightAfter = await colWidth('.side')
  check('左右の欄の境目をつかんで動かすと、欄の幅が変わる', leftAfter >= leftBefore + 50 && rightAfter >= rightBefore + 70, `${leftBefore}→${leftAfter} / ${rightBefore}→${rightAfter}`)
  await page.evaluate(() => document.querySelector('.resize-handle.left').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  await pause(300)
  check('境目をダブルクリックすると、元の幅に戻る', (await colWidth('.thumbs-col')) === leftBefore, String(await colWidth('.thumbs-col')))
  // 動かした右の欄の幅は覚えておき、ダブルクリックで既定の 340px に戻すと、覚えた幅も消す
  const rightStored = await page.evaluate(() => JSON.parse(localStorage.getItem('sotsugyo-seisaku-report-panels') ?? '{}'))
  await page.evaluate(() => document.querySelector('.resize-handle.right').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })))
  await pause(300)
  const rightReset = { width: await colWidth('.side'), stored: await page.evaluate(() => JSON.parse(localStorage.getItem('sotsugyo-seisaku-report-panels') ?? '{}')) }
  check('動かした右の欄の幅は覚えておき、ダブルクリックで 340px に戻すと、覚えた幅も消す', rightStored.right === rightAfter && rightReset.width === 340 && rightReset.stored.right === undefined && rightReset.stored.left === undefined, JSON.stringify({ rightStored, rightReset }))

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

  // ---- 直すところ・まだのところが残っていても、PDF は書き出せる（PDF は1つだけ。下書きの PDF と3つのチェックはなくした：依頼者の判断 2026-10-19） ----
  // 文末に「。」がない段落を作る（補助の指摘のエラー）
  const keepId = await page.evaluate(() => {
    const ed = window.__editor
    const target = ed.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.type === 'paragraph')
    ed.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === target.id ? { ...b, content: [{ type: 'text', text: '袖を大きく広げた' }] } : b)) })) }))
    return target.id
  })
  await pause(300)
  await ready()
  {
    const title = await page.evaluate(() => window.__editor.pdfTitle)
    rmSync(`${DOWNLOADS}/${title}.pdf`, { force: true })
    // 右の欄と同じ分け方（app/checkSummary.ts）での、残っている直すところ・まだのところ
    const left = await page.evaluate(async (keepId) => {
      const { checkSummary } = await import('/src/app/checkSummary.ts')
      const ed = window.__editor
      const { rows, fixes } = checkSummary(ed.getSnapshot(), ed.config)
      const keep = fixes.find((f) => f.ruleId === 'sentence-end' && f.blockId === keepId)
      return { fixes: fixes.length, notYet: rows.filter((r) => r.state === 'todo').length, keep: keep ? `本文：${keep.title}` : '' }
    }, keepId)
    await page.click('.side .export')
    await page.waitForSelector('.modal .pdf-left')
    const dialog = await page.evaluate(() => ({
      title: document.querySelector('.modal h2')?.textContent ?? '',
      lead: document.querySelector('.modal .lead')?.textContent ?? '',
      heads: [...document.querySelectorAll('.modal .pdf-left-h')].map((h) => h.textContent),
      fixes: [...document.querySelectorAll('.modal .fix-list li:not(.more)')].map((li) => li.textContent),
      more: document.querySelector('.modal .fix-list .more')?.textContent ?? '',
      notYet: document.querySelectorAll('.modal .notyet-list li').length,
      anyway: document.querySelector('.modal .pdf-anyway')?.textContent ?? '',
      start: document.querySelector('.modal .pdf-start')?.textContent ?? '',
      startDisabled: document.querySelector('.modal .pdf-start')?.disabled,
      primaries: [...document.querySelectorAll('.modal button.primary')].map((b) => b.textContent),
      file: document.querySelector('.modal .pdf-file b')?.textContent ?? '',
      old: !!document.querySelector('.modal .checklist, .modal .draft-box, .modal .pdf-draft, .modal input[type=checkbox]') || /下書き|透かし/.test(document.querySelector('.modal').textContent),
      buttons: [...document.querySelectorAll('.modal .row-buttons button')].map((b) => b.textContent),
    }))
    await page.screenshot({ path: `${OUT}/0-pdf-left.png` })
    check(
      '直すところ・まだのところが残っていると、PDF の窓に右の欄と同じ言葉で一覧（押すとその場所へ）と「提出の前に直しましょう。このまま書き出すこともできます」を出し、ふつうの「PDF を保存する」で書き出せる（3つのチェック・下書きの欄・透かしの話はない）',
      left.keep &&
        dialog.title === 'PDFを書き出す' &&
        dialog.lead.startsWith('直すところが') &&
        dialog.heads[0] === '直すところ' &&
        dialog.fixes.some((t) => t.startsWith(left.keep)) &&
        dialog.fixes.length + (dialog.more ? Number(dialog.more.replace(/\D/g, '')) : 0) === left.fixes &&
        (left.notYet ? dialog.heads[1] === 'まだのところ' && dialog.notYet === left.notYet : dialog.heads.length === 1) &&
        dialog.anyway === '提出の前に直しましょう。このまま書き出すこともできます（途中で先生に見せるときなど）。' &&
        dialog.start === 'PDF を保存する' &&
        !dialog.startDisabled &&
        dialog.primaries.join(',') === 'PDF を保存する' &&
        dialog.file === `${title}.pdf` &&
        !dialog.old &&
        dialog.buttons.includes('直しに戻る'),
      JSON.stringify({ dialog, left }),
    )
    // 一覧の直すところを押すと、窓が閉じて、その場所へ移る（その段落が開く）
    await page.evaluate((keep) => [...document.querySelectorAll('.modal .fix-list button.link')].find((b) => b.textContent.startsWith(keep)).click(), left.keep)
    await page.waitForFunction((id) => !document.querySelector('.modal') && window.__editor.getSnapshot().editingId === id, { timeout: 10000 }, keepId).catch(() => {})
    const jumped = await page.evaluate(() => ({ modal: !!document.querySelector('.modal'), editing: window.__editor.getSnapshot().editingId }))
    check('PDF の窓の一覧で直すところを押すと、窓が閉じて、その場所へ移る', !jumped.modal && jumped.editing === keepId, JSON.stringify(jumped))
    await page.evaluate(() => window.__editor.finishEditing())
    await pause(300)
    await ready()

    // 印刷の画面から保存する道（「うまくいかないとき」を開いてから）。ファイル名は同じで、透かしは入らない
    await page.evaluate(() => {
      window.print = () => (window.__printed = { title: document.title, draftClass: document.documentElement.classList.contains('print-draft') })
    })
    const titleBefore = await page.title()
    await page.click('.side .export')
    await page.waitForSelector('.modal .pdf-left')
    await page.click('.modal .row-buttons .pdf-fallback')
    await page.waitForSelector('.modal .pdf-print-box .pdf-print')
    await page.click('.modal .pdf-print-box .pdf-print')
    await page.waitForFunction(() => !!window.__printed)
    const printed = await page.evaluate(() => window.__printed)
    await page.emulateMediaType('print')
    const marks = await page.evaluate(() => [...document.querySelectorAll('.page-viewport.front [data-vivliostyle-page-container]')].map((p) => getComputedStyle(p, '::after').content))
    await page.emulateMediaType(null)
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
    const afterTitle = await page.title()
    check(
      '残っていても「うまくいかないとき：印刷の画面から保存」から印刷に進め、ファイル名はいつもと同じ（「_下書き」も透かしもない。終わると元に戻る）',
      printed.title === title && !printed.draftClass && marks.length > 0 && !marks.some((t) => t.includes('下書き')) && afterTitle === titleBefore,
      JSON.stringify({ printed, afterTitle }),
    )

    // ツールの中で作って保存する（「やめる」・作れなかったときも）
    await page.click('.side .export')
    await page.waitForSelector('.modal .pdf-start')
    await page.click('.modal .pdf-start')
    await page.waitForFunction(() => document.querySelectorAll('.modal .pdf-thumbs img').length >= 1, { timeout: 60000 })
    await page.evaluate(() => [...document.querySelectorAll('.modal .row-buttons button')].find((b) => b.textContent === 'やめる').click())
    await pause0(1500)
    check('作っている途中の「やめる」で止まり、最初の窓に戻る（保存しない）', !!(await page.$('.modal .pdf-left .fix-list')) && !existsSync(`${DOWNLOADS}/${title}.pdf`))
    await page.click('.modal .pdf-start')
    await page.waitForSelector('.modal .pdf-open', { timeout: 120000 })
    // 保存の画面が開かない（「ダウンロード」にそのまま保存する。窓のフォーカスも外れない）ときは、約4秒で「保存しました」になる
    const waitStart = Date.now()
    const waitTitle = await page.$eval('.modal h2', (e) => e.textContent)
    await page.waitForFunction(() => document.querySelector('.modal h2')?.textContent === '保存しました', { timeout: 15000 }).catch(() => {})
    const waited = Date.now() - waitStart
    check('保存の画面が開かないブラウザ（「ダウンロード」にそのまま保存）では、「保存の画面を開いています…」が約4秒で「保存しました」になる', waitTitle === '保存の画面を開いています…' && waited > 2500 && waited < 6000, JSON.stringify({ waitTitle, waited }))
    const done = await page.evaluate(() => ({ title: document.querySelector('.modal h2')?.textContent, file: document.querySelector('.modal .pdf-file b')?.textContent, note: document.querySelector('.modal .lead')?.textContent ?? '' }))
    const printedPages = await page.evaluate(() => window.__editor.pageElements().filter((p) => !p.classList.contains('print-skip')).length)
    const saved = await savedPdf(`${title}.pdf`)
    await page.screenshot({ path: `${OUT}/0-pdf-left-saved.png` })
    check(
      '残っていても、同じ流れで PDF を作って保存できる（ファイル名はいつもと同じ。透かしの説明はない）',
      done.title === '保存しました' && done.file === `${title}.pdf` && !/下書き|透かし/.test(done.note) && saved.pages === printedPages && !saved.files.some((f) => f.includes('下書き')),
      JSON.stringify({ done, saved, printedPages }),
    )
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
    await page.waitForSelector('.modal .pdf-start')
    await page.click('.modal .pdf-start')
    await page.waitForSelector('.modal .pdf-print', { timeout: 60000 })
    const failed = await page.evaluate(() => ({ title: document.querySelector('.modal h2')?.textContent, guide: document.querySelector('.modal .print-guide')?.textContent ?? '', retry: [...document.querySelectorAll('.modal button')].some((b) => b.textContent === 'もう一度作る') }))
    await page.screenshot({ path: `${OUT}/0-pdf-failed.png` })
    await page.evaluate(() => {
      HTMLCanvasElement.prototype.toBlob = window.__toBlob
    })
    check('作れなかったときは「PDF を作れませんでした」と、印刷の画面での選び方・「印刷の画面を開く」・「もう一度作る」を出す', failed.title === 'PDF を作れませんでした' && failed.guide.includes('印刷の画面で') && failed.guide.includes(`${title}.pdf`) && !failed.guide.includes('下書き') && failed.retry, JSON.stringify(failed))
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

  // ---- 作品写真の「全体を入れる（切らない）」（mockups/v32 ③ 案A） ----
  await photoWholeCheck(browser)

  // ---- 作品写真の何ページか（mockups/v38 案A：ページを足す・消す・ページごとの並べ方・選んだ写真を全部入れる・空のページは PDF に入らない。scripts/e2e/photoPages.mjs） ----
  await photoPagesPc(browser, check)

  // ---- 目次のページ（mockups/v41 案C＋案B：行を押すと見出しへ・行のない所は知らせ・言葉・PDF は変わらない。scripts/e2e/tocLinks.mjs） ----
  await tocLinksPc(browser, check)

  // ---- はじめて使う学生の試し（3回目：Word から移す学生・パソコン）で見つかったこと（scripts/e2e/firstTimeV3.mjs） ----
  await firstTimeV3Pc(browser, check)
  await firstTimeV3Word(browser, check)

  // ---- はじめて使う学生の試し（3回目：パソコン）で見つかった、紙面と書く欄まわりの直し（scripts/e2e/editorFixesV3.mjs） ----
  await editorFixesV3Pc(browser, check)

  // ---- はじめて使う先生の試しで見つかったこと（書き間違えやすい語のエラー・はじめての案内の続き。scripts/e2e/teacherTrialFixes.mjs） ----
  await teacherTrialPc(browser, check)

  // ---- 段落をまたいで選ぶ（なぞって選ぶ・コピー・切り取り・削除・貼り付け。scripts/e2e/rangeSelect.mjs） ----
  await rangeSelectPc(browser, check)

  // ---- 書く欄の折り返しが紙面と同じ（scripts/e2e/writingWrap.mjs） ----
  await writingWrapPc(browser, check)

  // ---- 段落に「Ⅲ．まとめ」のように打つと見出しになる（Enter・書く欄を閉じたとき・何行かの貼り付け。「戻す」。scripts/e2e/autoHeading.mjs） ----
  await autoHeadingPc(browser, check)

  // ---- 図表のタイトルを書いている間も、番号（図4.・表2.）のすぐ後ろから書く（書き終えたときと同じ。scripts/e2e/captionGap.mjs） ----
  await captionGapPc(browser, check)

  // ---- 表の行の高さ「そろえる」・左端の列「中身に合わせる」・列の幅「中身に合わせる」で1字だけの行を作らない・マスの中の Enter は改行（scripts/e2e/tableShape.mjs） ----
  await tableShapePc(browser, check)

  // ---- 表の列の幅を「自分で決める」（mockups/v42：縦の線をドラッグ・5% ずつ・10% 以上・そろえ直す・元に戻す・PDF。scripts/e2e/tableCustom.mjs） ----
  await tableCustomPc(browser, check)

  // ---- 画面の低いパソコン（1280×720・1366×768・1280×586）でも左の道具は全部見え、「表の形を整える」の窓も入る。もっと低い画面で道具の中を動かしても、中身が狭まらない（1字だけの行ができない。scripts/e2e/tableCustom.mjs） ----
  await paletteFitPc(browser, check)

  // ---- 表のセルを書いている間も、そのセルの罫線（上下左右）が見える（細い列・見出しの行・最後の行。scripts/e2e/cellBorder.mjs） ----
  await cellBorderPc(browser, check)

  // ---- 「表の形を整える」の窓（mockups/v45 案A：開く・閉じる（×・Esc・外を押す）・選ぶとすぐ変わる・元に戻す1回・キーボード・線のつまみ。scripts/e2e/tableSettings.mjs） ----
  await tableSettingsPc(browser, check)

  // ---- 待つ間の表示（押したボタンに回る印と言葉・2秒を過ぎたら「数秒かかることがあります」・終わったら知らせ。依頼者の要望 2026-10-20。scripts/e2e/waiting.mjs） ----
  await waitingPc(browser, check)

  // ---- 先生がひな形を作る画面（mockups/v44 案A）で入れた改ページ・ふつうの表が、学生の新しい原稿に出る（scripts/e2e/templateStudent.mjs） ----
  await templateStudentPc(browser, check)
})

/**
 * 作品写真の「全体を入れる（切らない）」（mockups/v32 ③ 案A）：写真を押すと「この写真」の道具にスイッチが出る。
 * 入れると、紙面でも PDF でも、写真の全体が枠に入る（まわりは白）。入れている間は動かせない。元に戻せる。
 * 並べ方を変えても残り、写真を差し替えると外れる（今までどおり枠いっぱいに切り抜く）
 */
async function photoWholeCheck(browser) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await noHotReload(page)
  await stubConfig(page)
  page.on('pageerror', (e) => console.log('pageerror(whole):', e.message))
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  })
  await page.setViewport({ width: 1440, height: 900 })
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0' })
  const ready = () =>
    page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 60000 })
  const pause = (ms = 400) => new Promise((r) => setTimeout(r, ms))
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
  // 上の枠に縦長の全身の写真（枠いっぱいだと頭と裾が切れる）、下の枠に横長の写真（2枚・上下）
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, workPhotos: [{ layout: 2, columns: 1, imageIds: ['g-photo1', 'g-mood'] }] })))
  await pause(500)
  await ready()
  // 見本の原稿（章・図・表あり）でも、分けて組んだ紙面が、報告書全体を1つの文書として組んだ紙面と同じ。
  // 段落に書き足して閉じたとき（その章だけ組み直す）、元に戻したとき（前の紙面を使い回す）も同じ
  const parityBefore = await paperMatchesWhole(page)
  await page.evaluate(() => window.__editor.openWhenReady('p9', 0))
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p9', { timeout: 30000 })
  await page.keyboard.type('照明の下で、袖の刺繍の光り方を何度も確かめた。')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !window.__editor.getSnapshot().editingId, { timeout: 30000 })
  await ready()
  const parityEdited = await paperMatchesWhole(page)
  await page.evaluate(() => window.__editor.undo())
  await ready()
  const parityUndone = await paperMatchesWhole(page)
  check(
    '見本の原稿の紙面が、報告書全体を1つの文書として組んだ紙面と同じ（はじめ・段落に書き足して閉じたあと・元に戻したあと）',
    parityBefore.same && parityEdited.same && parityUndone.same,
    JSON.stringify({ parityBefore, parityEdited, parityUndone }),
  )
  await page.evaluate(() => window.__editor.goToArea('photos'))
  await ready()
  const slotState = (i) =>
    page.evaluate((i) => {
      const slot = document.querySelector(`.page-viewport.front [data-photo-slot="${i}"]`)
      const img = slot?.querySelector('img')
      return { whole: !!slot?.classList.contains('whole'), fit: img ? getComputedStyle(img).objectFit : null, cursor: img ? getComputedStyle(img).cursor : null }
    }, i)
  // 作品写真の1ページ目（何ページかにできるようになった：mockups/v38）
  const model = () => page.evaluate(() => window.__editor.getSnapshot().report.workPhotos[0])
  const clickSwitch = async () => {
    await page.click('.palette .photo-sw')
    await pause(300)
    await ready()
  }
  // 道具の「元に戻す」（ほかの道具の「戻す」と取り違えないように、名前で探す）
  const undo = async () => {
    await page.evaluate(() => [...document.querySelectorAll('.palette .tb')].find((b) => b.textContent.includes('元に戻す')).click())
    await pause(300)
    await ready()
  }
  /** ツールの中で作る PDF（「PDFを書き出す」と同じ部品）で、作品写真のページの上の枠の左端・真ん中・右端の色 */
  const pdfColors = () =>
    page.evaluate(async () => {
      const { buildPdf } = await import('/src/pdf/exportPdf.ts')
      const ed = window.__editor
      const photos = ed.pageElements()[ed.getSnapshot().layout.kinds.indexOf('photos')]
      let colors = null
      await buildPdf([photos], {
        title: 'whole-check',
        onPage: ({ canvas }) => {
          const ctx = canvas.getContext('2d')
          const y = Math.round(canvas.height * 0.25)
          const at = (x) => [...ctx.getImageData(Math.round(canvas.width * x), y, 1, 1).data].slice(0, 3)
          colors = { left: at(0.04), center: at(0.5), right: at(0.96) }
        },
      })
      return colors
    })
  const white = (c) => !!c && c.every((v) => v >= 245)

  // 写真を押すと、道具の「この写真」に、スイッチ「全体を入れる（切らない）」が出る（まだ入っていない）
  const p0 = await page.evaluate(() => { const r = document.querySelector('.page-viewport.front [data-photo-slot="0"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  await page.mouse.click(p0.x, p0.y)
  await pause(300)
  const tools = await page.evaluate(() => {
    const sw = document.querySelector('.palette .group.ctx .photo-sw')
    return { label: sw?.closest('.group.ctx')?.querySelector('.ctx-label')?.textContent, text: sw?.textContent, role: sw?.getAttribute('role'), checked: sw?.getAttribute('aria-checked') }
  })
  const before = await slotState(0)
  const cropped = await pdfColors()
  check(
    '作品写真を押すと、「この写真」の道具にスイッチ「全体を入れる（切らない）」が出る（はじめは切っている：紙面も PDF も枠いっぱい）',
    tools.label === 'この写真' && tools.text === '全体を入れる（切らない）' && tools.role === 'switch' && tools.checked === 'false' && before.fit === 'cover' && !before.whole && !white(cropped?.left),
    JSON.stringify({ tools, before, cropped }),
  )

  // スイッチを入れる：その写真だけ、枠の中に全体が入る（紙面・印刷・PDF）。選んだまま
  await clickSwitch()
  const on = await slotState(0)
  const other = await slotState(1)
  const m1 = await model()
  await page.emulateMediaType('print')
  const printed = await slotState(0)
  await page.emulateMediaType(null)
  const whole = await pdfColors()
  const still = await page.evaluate(() => ({ sel: window.__editor.getSnapshot().selection, checked: document.querySelector('.palette .photo-sw')?.getAttribute('aria-checked') }))
  await page.screenshot({ path: `${OUT}/photo-whole.png` })
  check(
    'スイッチを入れると、その写真だけ、紙面でも印刷でも枠の中に全体が入る（ほかの写真は切ったまま。写真は選んだまま）',
    on.whole && on.fit === 'contain' && printed.fit === 'contain' && other.fit === 'cover' && JSON.stringify(m1.whole) === '[true,false]' && still.sel?.index === 0 && still.checked === 'true',
    JSON.stringify({ on, other, printed, whole: m1.whole, still }),
  )
  check('「PDFを書き出す」で作る PDF でも、全体を入れた写真のまわりは白になる（真ん中は写真）', white(whole?.left) && white(whole?.right) && !white(whole?.center), JSON.stringify(whole))

  // 全体を入れている写真は、つかんで動かしても動かない（つかむ形のカーソルも出さない）
  const d = await page.evaluate(() => { const r = document.querySelector('.page-viewport.front [data-photo-slot="0"] img').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
  await page.mouse.move(d.x, d.y)
  await page.mouse.down()
  for (let k = 1; k <= 8; k++) await page.mouse.move(d.x + k * 10, d.y + k * 12)
  const dragging = await page.evaluate(() => !!document.querySelector('.page-viewport.front [data-photo-slot] img.dragging'))
  await page.mouse.up()
  await pause()
  await ready()
  const m2 = await model()
  check('全体を入れている写真は、つかんで動かしても動かない（つかむ形のカーソルも出ない）', !dragging && !m2.positions?.[0] && on.cursor !== 'grab', JSON.stringify({ dragging, positions: m2.positions, cursor: on.cursor }))

  // 元に戻す：切った写真に戻る。もう一度入れる
  await undo()
  const undone = await slotState(0)
  const m3 = await model()
  check('「元に戻す」で、枠いっぱいに切った写真に戻る', !undone.whole && undone.fit === 'cover' && !m3.whole, JSON.stringify({ undone, whole: m3.whole }))
  await page.evaluate(() => window.__editor.select({ kind: 'photos', page: 0, index: 0 }))
  await pause(300)
  await clickSwitch()

  // 並べ方を変えても残る（2枚・左右 → 2枚・上下）
  const arrange = async (title) => {
    await page.evaluate((title) => [...document.querySelectorAll('.palette .lay')].find((b) => b.title.startsWith(title)).click(), title)
    await pause(300)
    await ready()
  }
  await arrange('2枚（左右')
  const side = await slotState(0)
  await arrange('2枚（上下')
  const back = await slotState(0)
  check('並べ方を変えても、全体を入れた写真はそのまま', side.whole && side.fit === 'contain' && back.whole && back.fit === 'contain', JSON.stringify({ side, back }))

  // 写真を差し替えると、外れる（新しい写真は、今までどおり枠いっぱいに切り抜く）
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(400, 300)
    const g = c.getContext('2d')
    g.fillStyle = '#7a5c3c'
    g.fillRect(0, 0, 400, 300)
    const blob = await c.convertToBlob({ type: 'image/png' })
    return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())))
  })
  const replacePath = join(tmpdir(), 'sotsugyo-e2e-whole.png')
  writeFileSync(replacePath, Buffer.from(png, 'base64'))
  await page.evaluate(() => window.__editor.select({ kind: 'photos', page: 0, index: 0 }))
  await pause(300)
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.evaluate(() => [...document.querySelectorAll('.palette .tb')].find((b) => b.textContent.includes('差し替え')).click())])
  await chooser.accept([replacePath])
  await page.waitForFunction(() => window.__editor.getSnapshot().report.workPhotos[0].imageIds[0] !== 'g-photo1', { timeout: 20000 })
  await pause(300)
  await ready()
  const replaced = await slotState(0)
  const m4 = await model()
  check('写真を差し替えると「全体を入れる」は外れ、新しい写真は枠いっぱいに切り抜く', !replaced.whole && replaced.fit === 'cover' && !m4.whole?.[0], JSON.stringify({ replaced, whole: m4.whole }))
  await context.close()
}

/** 直すところ・まだのところのない見本の原稿で、PDF を作る（進み具合・できたページの絵）→「ダウンロード」に保存、までを確かめる */
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
  // 右の欄：指摘のない原稿は「直すところ 0、まだ 0」、まだのところは全部 ✓（抄録は書いている）、「直すところ・まだのところはありません」（mockups/v35 ① 案A）
  const zeroPanel = await page.evaluate(() => ({
    // 数は小見出しの横（mockups/v37）。0 のときは出さない
    tally: [...document.querySelectorAll('.side .check-sub')].map((s) => s.textContent.replace(/\s/g, '')).join(','),
    rows: [...document.querySelectorAll('.side .check-prog li')].map((li) => li.className).join(','),
    note: document.querySelector('.side-foot .export-note')?.textContent ?? '',
  }))
  check('指摘のない原稿の右の欄は、まだのところ・直すところの数を出さず（0）、まだのところは全部 ✓ の行のまま（直すところがないので、たたまない）、PDF のボタンの下は「直すところ・まだのところはありません」', zeroPanel.tally === '進み具合,直すところ' && zeroPanel.rows === 'done,done,done,done,done' && zeroPanel.note === '直すところ・まだのところはありません', JSON.stringify(zeroPanel))
  await page.click('.side .export')
  await page.waitForSelector('.modal .pdf-start')
  const confirm = await page.evaluate(() => ({
    title: document.querySelector('.modal h2')?.textContent,
    lead: document.querySelector('.modal .lead')?.textContent,
    start: document.querySelector('.modal .pdf-start')?.textContent,
    disabled: document.querySelector('.modal .pdf-start')?.disabled,
    file: document.querySelector('.modal .pdf-file b')?.textContent,
    fallback: document.querySelector('.modal .row-buttons .pdf-fallback')?.textContent,
    list: !!document.querySelector('.modal .pdf-left'),
    old: !!document.querySelector('.modal .checklist, .modal .draft-box, .modal .pdf-draft, .modal input[type=checkbox]') || /下書き|透かし/.test(document.querySelector('.modal').textContent),
  }))
  const title = await page.evaluate(() => window.__editor.pdfTitle)
  await page.screenshot({ path: `${OUT}/0-pdf-zero.png` })
  check(
    '「PDFを書き出す」の窓（残っていないとき）：「直すところ・まだのところはありません」と、すぐ押せる「PDF を保存する」・ファイル名・左下の「うまくいかないとき：印刷の画面から保存」だけ（3つのチェック・下書きの欄はない）',
    errorsNow.length === 0 && confirm.title === 'PDFを書き出す' && confirm.lead === '直すところ・まだのところはありません。' && confirm.start === 'PDF を保存する' && !confirm.disabled && confirm.file === `${title}.pdf` && confirm.fallback?.includes('印刷の画面から保存') && !confirm.list && !confirm.old,
    JSON.stringify({ errorsNow, ...confirm }),
  )
  // 「うまくいかないとき」を開くと、今までの印刷の画面での選び方と「印刷の画面を開く」が出る
  await page.click('.modal .row-buttons .pdf-fallback')
  check('「うまくいかないとき：印刷の画面から保存」を押すと、印刷の画面での選び方と「印刷の画面を開く」が出る', await page.evaluate(() => !!document.querySelector('.modal .pdf-print-box .print-guide') && !!document.querySelector('.modal .pdf-print-box .pdf-print')))
  await page.click('.modal .row-buttons .pdf-fallback')
  // 保存の画面を待つ間の見張り（窓のフォーカス）と時計（約4秒）を数える（「保存しました」になったら・窓を閉じたら、残さず外すか）
  await page.evaluate(() => {
    window.__blurWatch = 0
    window.__waitTimers = new Set()
    const add = window.addEventListener
    const remove = window.removeEventListener
    window.addEventListener = function (type, fn, options) {
      if (type === 'blur') window.__blurWatch++
      return add.call(this, type, fn, options)
    }
    window.removeEventListener = function (type, fn, options) {
      if (type === 'blur') window.__blurWatch--
      return remove.call(this, type, fn, options)
    }
    const set = window.setTimeout.bind(window)
    const clear = window.clearTimeout.bind(window)
    window.setTimeout = (fn, ms, ...args) => {
      if (ms !== 4000) return set(fn, ms, ...args)
      const id = set((...a) => {
        window.__waitTimers.delete(id)
        fn(...a)
      }, ms, ...args)
      window.__waitTimers.add(id)
      return id
    }
    window.clearTimeout = (id) => {
      window.__waitTimers.delete(id)
      return clear(id)
    }
  })
  const watching = () => page.evaluate(() => ({ blur: window.__blurWatch, timers: window.__waitTimers.size }))
  await page.click('.modal .pdf-start')
  // 作っている途中：進み具合と、できたページの小さな絵
  await page.waitForFunction(() => document.querySelectorAll('.modal .pdf-thumbs img').length >= 1, { timeout: 60000 })
  const building = await page.evaluate(() => ({ title: document.querySelector('.modal h2')?.textContent, progress: document.querySelector('.modal .pdf-progress span')?.textContent ?? '', tiles: document.querySelectorAll('.modal .pdf-thumbs figure').length }))
  await page.screenshot({ path: `${OUT}/0-pdf-building.png` })
  await page.waitForSelector('.modal .pdf-open', { timeout: 120000 })
  await pause(150)
  // できたら、まず保存の画面を待つ（パソコン・Android）：「保存の画面を開いています…」と回る印・「数秒かかることがあります」。ファイル名・小さな絵・ボタンはそのまま
  const waitInfo = await page.evaluate(() => ({
    title: document.querySelector('.modal h2')?.textContent,
    label: document.querySelector('.modal')?.getAttribute('aria-label'),
    spinner: !!document.querySelector('.modal h2 .pdf-wait') && !document.querySelector('.modal h2 .pdf-ok'),
    lead: document.querySelector('.modal .lead')?.textContent,
    file: document.querySelector('.modal .pdf-file b')?.textContent,
    tiles: document.querySelectorAll('.modal .pdf-thumbs figure').length,
    buttons: [...document.querySelectorAll('.modal .row-buttons button')].map((b) => `${b.textContent}${b.disabled ? '(押せない)' : ''}`).join('|'),
    focus: document.activeElement?.classList.contains('pdf-open'),
    drive: !!document.querySelector('.modal .pdf-drive'),
  }))
  const waitWatch = await watching()
  await page.screenshot({ path: `${OUT}/0-pdf-waiting.png` })
  check(
    'できたら、まず「保存の画面を開いています…」（回る印）と「数秒かかることがあります」を出す。ファイル名・小さな絵はそのまま、「PDF を開く」「閉じる」「もう一度保存」も押せ、「PDF を開く」に移る',
    waitInfo.title === '保存の画面を開いています…' &&
      waitInfo.label === waitInfo.title &&
      waitInfo.spinner &&
      waitInfo.lead === '数秒かかることがあります' &&
      waitInfo.file === `${title}.pdf` &&
      waitInfo.tiles > 0 &&
      waitInfo.buttons === '保存されていないときは、もう一度保存|閉じる|PDF を開く' &&
      waitInfo.focus &&
      !waitInfo.drive &&
      waitWatch.blur === 1 &&
      waitWatch.timers === 1,
    JSON.stringify({ ...waitInfo, ...waitWatch }),
  )
  // ブラウザの保存の画面が開いた（窓のフォーカスが外れた）ことにする：すぐ「保存しました」になり、見張りと時計を外す
  const afterBlur = await page.evaluate(async () => {
    window.dispatchEvent(new Event('blur'))
    await new Promise((r) => setTimeout(r, 100))
    return { title: document.querySelector('.modal h2')?.textContent, ok: !!document.querySelector('.modal h2 .pdf-ok'), focus: document.activeElement?.classList.contains('pdf-open') }
  })
  const savedWatch = await watching()
  check(
    '保存の画面が開くと（窓のフォーカスが外れると）、すぐ「✓ 保存しました」になり、見張り・時計は残さない（「PDF を開く」のまま）',
    afterBlur.title === '保存しました' && afterBlur.ok && afterBlur.focus && savedWatch.blur === 0 && savedWatch.timers === 0,
    JSON.stringify({ ...afterBlur, ...savedWatch }),
  )
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
  // 保存の画面を待っている間に窓を閉じても、見張り・時計を残さない（あとで窓が出てきたりしない）
  await page.click('.side .export')
  await page.waitForSelector('.modal .pdf-start')
  await page.click('.modal .pdf-start')
  await page.waitForSelector('.modal .pdf-open', { timeout: 120000 })
  const closingTitle = await page.$eval('.modal h2', (e) => e.textContent)
  await page.click('.modal .close')
  await pause(300)
  const closedWatch = await watching()
  await pause(4500)
  check(
    '保存の画面を待っている間に窓を閉じると、見張り・時計を残さない（4秒たっても窓は出ない）',
    closingTitle === '保存の画面を開いています…' && closedWatch.blur === 0 && closedWatch.timers === 0 && !(await page.$('.modal')),
    JSON.stringify({ closingTitle, ...closedWatch }),
  )
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
  // 右の欄の「メニュー」に「Word で書いた分を読み込む」があるか（開いて見て、閉じる。mockups/v37 案C。開けなければ null）
  const menuHasWord = () =>
    page.evaluate(async () => {
      const btn = document.querySelector('.side .menu-btn')
      btn.click()
      await new Promise((r) => setTimeout(r, 150))
      const opened = !!document.querySelector('.side .head-menu')
      const has = [...document.querySelectorAll('.side .head-menu [role="menuitem"]')].some((b) => b.textContent.includes('Word で書いた分を読み込む'))
      btn.click()
      await new Promise((r) => setTimeout(r, 150))
      return opened ? has : null
    })

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
    '本文と表紙の Word を読み取ると、写す前に、組み立ての一覧・数・表紙の項目（コース・学籍番号・氏名・サブタイトル）・図の小さな画像・控えに残すことを見せる',
    shown.chapters > 0 && shown.rows >= shown.chapters && shown.counts['大見出し'] > 0 && shown.cover.length === 4 && shown.figures === shown.counts['図'] && shown.loaded > 0 && shown.keep.includes('自動の控え'),
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
    }
  })
  after.link = await menuHasWord()
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
  check('右の欄の上に「Word から写しました」の「つぎにすること」が出る（「メニュー」の「Word で書いた分を読み込む」は隠す）', after.todo.includes('Word から写しました') && after.todo.includes('読み込む前の原稿に戻す') && after.link === false, `${after.link} ${after.todo}`)
  if (after.guide) {
    await page.evaluate(() => document.querySelector('.g-later')?.click())
    await ready()
  }

  // 「図1へ」で、図1を選んで見せる。表紙のページを開いて「確かめた」を押すと「表紙を確かめる」が済みになる（開いただけでは済みにしない）
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
  const coverItem = () => page.evaluate(() => { const li = [...document.querySelectorAll('.side .word-todo li')].find((x) => x.textContent.includes('表紙を確かめる')); return { cls: li?.className, button: li?.querySelector('button')?.textContent ?? '' } })
  const coverOpened = await coverItem()
  await page.evaluate(() => [...document.querySelectorAll('.side .word-todo li button')].find((b) => b.textContent === '確かめた')?.click())
  await pause(300)
  const coverDone = await coverItem()
  check('表紙のページを開くと「表紙を確かめる」のボタンが「確かめた」になり、押すと ✓ が付く（開いただけでは付かない）', coverOpened.cls !== 'done' && coverOpened.button === '確かめた' && coverDone.cls === 'done', JSON.stringify({ coverOpened, coverDone }))
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
    return { body: JSON.stringify(r.body), basicInfo: r.basicInfo }
  })
  restored.link = await menuHasWord()
  check('「読み込む前の原稿に戻す」で、読み込む前の原稿に戻り、「つぎにすること」は消えて「メニュー」の「Word で書いた分を読み込む」が戻る', restored.body === JSON.stringify(template.body) && restored.basicInfo.name === template.basicInfo.name && restored.link === true, JSON.stringify({ ...restored.basicInfo, link: restored.link }))
  await context.close()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 件 合格`)
process.exitCode = failed.length ? 1 : 0
