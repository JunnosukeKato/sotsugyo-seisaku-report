// 下書きのひな形を、学生と同じ紙面で作る画面（mockups/v44 案A・管理ページの上に重ねて開く）を確かめる（admin.mjs から呼ぶ。試験用サーバーで）。
// - コースのカードの「ひな形を作る画面を開く」で、管理ページの上の窓の iframe に、学生のツールが ?template=1 で開く（開発中は同じ開発サーバー）
// - 紙面で「ここに書くこと」を直し、小見出し・表（見出しの行）・改ページを足し、抄録の書き出し例も直して「管理ページに戻して反映」→ 下書きに入る（変更あり・帯・知らせ）
// - 直していれば「やめる」「×」で確かめる。間違った場所・合言葉の知らせは受け取らない。ツールは、決まった場所からの init だけを受け取る
// - ひな形を作る画面は、この端末の保存（localStorage・sessionStorage・IndexedDB）に書かず、ドライブなどの外にもつながない
// 画面の写真は poc-output/template-mode/ に置く
import { mkdirSync } from 'node:fs'
import { answerConfirms } from './confirmUi.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/template-mode'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 開くたびに、ひな形を作る画面（?template=1 の枠）で、この端末の保存に書いたかを記録する。合言葉も覚える（間違った合言葉を試すため） */
const recordTemplateFrame = (page) =>
  page.evaluateOnNewDocument(() => {
    // 確かめている途中に src/ が直されても、画面が入れ替わらないようにする（smoke.mjs と同じ）
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
    if (!/[?&]template=/.test(location.search)) return
    const log = (window.__storageWrites = [])
    for (const name of ['setItem', 'removeItem', 'clear']) {
      const real = Storage.prototype[name]
      Storage.prototype[name] = function (...args) {
        log.push(`${this === window.localStorage ? 'localStorage' : 'sessionStorage'}.${name}(${args[0] ?? ''})`)
        return real.apply(this, args)
      }
    }
    for (const name of ['open', 'deleteDatabase']) {
      const real = IDBFactory.prototype[name]
      IDBFactory.prototype[name] = function (...args) {
        log.push(`indexedDB.${name}(${args[0]})`)
        return real.apply(this, args)
      }
    }
    window.addEventListener('message', (e) => e.data?.type === 'init' && (window.__nonce = e.data.nonce), true)
  })

/** 確認の窓を記録し、答える（ふだんは「OK」。answer(false) の間は「キャンセル」） */
async function dialogLog(page) {
  const log = { messages: [], ok: true }
  const decide = (message) => {
    log.messages.push(message)
    return log.ok
  }
  // ブラウザの確認（ページを離れるときなど）と、管理ページの画面の中の確認の窓（src/admin/confirm.tsx）
  page.on('dialog', (d) => {
    if (decide(d.message())) d.accept()
    else d.dismiss()
  })
  await answerConfirms(page, decide)
  return { last: () => log.messages.at(-1) ?? '', count: () => log.messages.length, answer: (ok) => void (log.ok = ok) }
}

/** 1字だけが行に残っている文（admin.mjs と同じ数え方。root の中の字のある部品ごと） */
const lonelyLines = (p, rootSel) =>
  p.evaluate((rootSel) => {
    const bad = []
    const boxes = new Map()
    const range = document.createRange()
    for (const root of document.querySelectorAll(rootSel)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim() || n.parentElement.closest('style, script, option, select, textarea, .sr-only')) continue
        let box = n.parentElement
        while (box && getComputedStyle(box).display === 'inline') box = box.parentElement
        if (!box || !box.getClientRects().length) continue
        if (!boxes.has(box)) boxes.set(box, [])
        const list = boxes.get(box)
        for (let i = 0; i < n.length; i++) {
          if (/\s/.test(n.data[i])) continue
          range.setStart(n, i)
          range.setEnd(n, i + 1)
          const r = range.getBoundingClientRect()
          if (r.height) list.push({ y: (r.top + r.bottom) / 2, h: r.height, ch: n.data[i] })
        }
      }
    }
    for (const [box, list] of boxes) {
      const lines = []
      for (const c of list.sort((a, b) => a.y - b.y)) {
        const line = lines.at(-1)
        if (line && Math.abs(c.y - line.y) < line.h * 0.55) line.chars.push(c.ch)
        else lines.push({ y: c.y, h: c.h, chars: [c.ch] })
      }
      if (lines.length > 1 && lines.some((l) => l.chars.length === 1)) bad.push(`${box.textContent.trim().slice(0, 40)}…（${lines.map((l) => l.chars.join('')).join('／')}）`.slice(0, 160))
    }
    return bad
  }, rootSel)

export async function templateModeAdmin(browser, check) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror(template-mode):', e.message))
  const dialogs = await dialogLog(page)
  await recordTemplateFrame(page)
  /** ひな形を作る画面から、開発サーバーのほか（Google のログイン・ドライブ・Apps Script など）への通信 */
  const outside = []
  page.on('request', (r) => {
    if (r.frame()?.url().includes('template=1') && !r.url().startsWith(new URL(APP).origin) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) outside.push(r.url())
  })
  await page.setViewport({ width: 1366, height: 768 })
  await page.goto(`${APP}/admin.html`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => {
    localStorage.removeItem('sotsugyo-admin-mock')
    localStorage.removeItem('sotsugyo-admin-year')
    sessionStorage.removeItem('sotsugyo-admin-section')
  })
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.admin .content')
  await page.evaluate(() => [...document.querySelectorAll('.side-nav button')].find((b) => b.textContent.includes('コース')).click())
  await page.waitForSelector('.course.open .tpl-line .tpl-open')

  const card = await page.evaluate(() => ({ open: document.querySelector('.course.open .tpl-open').textContent, old: document.querySelector('.course.open .tpl-old').textContent, summary: document.querySelector('.course.open .tpl-line b').textContent }))
  check('コースのカードに「ひな形を作る画面を開く」と、予備の「前の作り方で直す」', card.open === 'ひな形を作る画面を開く' && card.old === '前の作り方で直す' && card.summary === '大見出し3・小見出し3・説明5・図の枠1・素材表1', JSON.stringify(card))
  const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? '')
  check('管理ページの CSP は、中に開く枠を、学生のツールの場所（開発中は同じ開発サーバー）だけにする', csp === "frame-src 'self'", csp)

  /** 「ひな形を作る画面を開く」を押して、ツールが開くまで待つ。開いた枠を返す */
  const openScreen = async (p = page) => {
    await p.evaluate(() => document.querySelector('.course.open .tpl-open').click())
    await p.waitForSelector('.tpl-overlay iframe')
    await p.waitForFunction(() => !document.querySelector('.tpl-opening'), { timeout: 30000 })
    const frame = p.frames().find((f) => f.url().includes('template=1') && f.parentFrame() === p.mainFrame())
    await frame.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning && s.page === window.__editor.pageOfArea('body') }, { timeout: 60000 })
    await sleep(700)
    return frame
  }
  const ready = (frame) => frame.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning }, { timeout: 60000 })
  /** 左の道具のボタンを、名前で押す（なければ、そのときの道具の名前を出して止める） */
  const tool = async (frame, text) => {
    const missing = await frame.evaluate((text) => {
      const b = [...document.querySelectorAll('.palette .tb')].find((b) => b.textContent.replace(/\s/g, '').includes(text))
      b?.click()
      return b ? null : [...document.querySelectorAll('.palette .tb')].map((b) => b.textContent).join('|')
    }, text)
    if (missing !== null) throw new Error(`道具「${text}」がありません（${missing}）`)
  }
  const bodyBlocks = (frame) => frame.evaluate(() => window.__editor.getSnapshot().report.body.map((c) => ({ id: c.id, title: c.title, blocks: c.blocks.map((b) => ({ id: b.id, type: b.type, text: b.type === 'paragraph' ? b.content.map((n) => n.text ?? '').join('') : (b.title ?? b.caption ?? '') })) })))
  const templateOf = (frame) =>
    frame.evaluate(async () => {
      const { templateFromReport } = await window.__import('template/convert.ts')
      return templateFromReport(window.__editor.getSnapshot().report)
    })
  const leaveGuarded = () =>
    page.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(e)
      return e.defaultPrevented
    })
  /** iframe の中の部品の真ん中を、マウスで押す */
  const clickIn = async (frame, sel) => {
    const outer = await page.evaluate(() => document.querySelector('.tpl-overlay iframe').getBoundingClientRect().toJSON())
    const r = await frame.evaluate((sel) => document.querySelector(sel).getBoundingClientRect().toJSON(), sel)
    await page.mouse.click(outer.x + r.x + Math.min(r.width / 2, 20), outer.y + r.y + r.height / 2)
  }
  /** 画面全体の写真（iframe の中も入る） */
  const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png`, captureBeyondViewport: false })
  /** iframe の中の部品のまわりだけの写真 */
  const shotIn = async (frame, sel, name, pad = 0) => {
    const outer = await page.evaluate(() => document.querySelector('.tpl-overlay iframe').getBoundingClientRect().toJSON())
    const r = await frame.evaluate((sel) => document.querySelector(sel).getBoundingClientRect().toJSON(), sel)
    await page.screenshot({ path: `${OUT}/${name}.png`, captureBeyondViewport: false, clip: { x: outer.x + r.x - pad, y: outer.y + r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 } })
  }

  // ---- 開く ----
  const frame = await openScreen()
  const src = await page.evaluate(() => document.querySelector('.tpl-overlay iframe').src)
  check('重ねた窓の iframe に、学生のツールが ?template=1 で開く（開発中は同じ開発サーバー）', src === `${new URL(APP).origin}/?template=1` && frame.url() === src, src)
  const view0 = await frame.evaluate(() => { const s = window.__editor.getSnapshot(); return { zoomed: s.zoomed, spread: s.spread, page: s.page, body: window.__editor.pageOfArea('body') } })
  check('ひな形を作る画面は、本文の最初のページを「全体」（ページ全体）で開く（拡大ではない：依頼者の希望 2026-10-22）', !view0.zoomed && !view0.spread && view0.page === view0.body, JSON.stringify(view0))
  const screen = await frame.evaluate(() => ({
    banner: document.querySelector('.tpl-banner')?.textContent ?? '',
    title: document.querySelector('.tpl-panel h2')?.textContent ?? '',
    points: [...document.querySelectorAll('.tpl-points li')].map((li) => li.textContent).join('|'),
    buttons: [...document.querySelectorAll('.tpl-foot button')].map((b) => b.textContent).join('|'),
    note: document.querySelector('.tpl-note')?.textContent ?? '',
    gate: !!document.querySelector('.login-over'),
    selfCheck: !!document.querySelector('.side .check, .export, .side-menu, .drive-chip'),
    excluded: [...document.querySelectorAll('.thumb-list .t.excluded')].map((t) => `${t.querySelector('.mini-tag').textContent}:${t.lastChild.textContent}`).join('|'),
    findings: window.__editor.getSnapshot().findings.length,
  }))
  await shot('1-admin-overlay-open')
  check(
    'ひな形を作る画面：いちばん上の帯・右の欄（このコースのひな形・3行・戻すボタン・やめる・標準に戻す）。ログイン・セルフチェック・PDF はない',
    screen.banner === 'ひな形を作っています：映画・舞台衣装デザイナー コース（学生の画面ではありません）' &&
      screen.title === 'このコースのひな形' &&
      screen.points === '学生と同じように、紙面に書きます|本文の字は、学生には薄い字で出ます|表紙・作品写真は、ひな形に入りません' &&
      screen.buttons === '管理ページに戻して反映|やめる|標準のひな形に戻す' &&
      screen.note === '学生に届くのは、管理ページで「保存して学生に反映」を押してから' &&
      !screen.gate &&
      !screen.selfCheck &&
      screen.findings === 0,
    JSON.stringify(screen),
  )
  check('ページの一覧で、表紙と作品写真に「ひな形に入らない」', screen.excluded === 'ひな形に入らない:表紙|ひな形に入らない:作品写真', screen.excluded)
  const start = await templateOf(frame)
  const config = await page.evaluate(() => JSON.parse(localStorage.getItem('sotsugyo-admin-mock')).years[0].config.courses[0])
  check('管理ページのひな形（説明は段落の字）と抄録の書き出し例が、紙面に入って開く', JSON.stringify(start.template) === JSON.stringify(config.template) && start.abstractExample === config.abstractExample, JSON.stringify(start).slice(0, 200))
  const tags = await frame.evaluate(() => [...document.querySelectorAll('.page-viewport.front section.body p[data-block-id]')].map((p) => getComputedStyle(p, '::before').content).filter((c) => c.includes('ここに書くこと')).length)
  check('本文の段落の左の余白に「ここに書くこと」の札', tags >= 2, String(tags))

  // ---- 「ここに書くこと」を直す（制作過程の段落） ----
  let blocks = await bodyBlocks(frame)
  const process = blocks.find((c) => c.title === '制作過程')
  const pid = process.blocks.find((b) => b.type === 'paragraph').id
  await frame.evaluate((id) => window.__editor.openWhenReady(id, 0), pid)
  await frame.waitForSelector('.overlay-editor', { visible: true })
  await sleep(400)
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Control')
  await page.keyboard.type('パターン・仮縫い・縫製の順に、工夫した点と、', { delay: 15 })
  await sleep(700)
  const editingTag = await frame.evaluate(() => document.querySelector('.tpl-editing-tag')?.textContent ?? '')
  await shot('2-typing-hint')
  check('書いている段落の横にも「ここに書くこと」の札（段落の字は、学生と同じ薄い色）', editingTag === 'ここに書くこと' && (await frame.evaluate(() => getComputedStyle(document.querySelector('.overlay-editor')).color)) === 'rgb(95, 107, 149)', editingTag)
  await page.keyboard.type('うまくいかなかった点を書く', { delay: 10 })
  await sleep(300)
  check('直すと、管理ページは「直した」と知る（タブを閉じるときに確かめる）', await leaveGuarded())
  await shotIn(frame, '.tpl-side', '3-right-panel')

  // ---- 小見出しを足す（書いている段落の下）。Enter で、その下の説明 ----
  await tool(frame, '小見出し')
  await sleep(500)
  await page.keyboard.type('試験の小見出し', { delay: 10 })
  await page.keyboard.press('Enter')
  await sleep(300)
  await page.keyboard.type('試験の説明を書く', { delay: 10 })
  await sleep(300)
  // ---- 表（3列×3行）を入れて、見出しの行を書く ----
  await tool(frame, '表を入れる')
  await frame.waitForSelector('.table-menu')
  await frame.evaluate(() => document.querySelector('.table-menu [aria-label="3列×3行"]').click())
  await sleep(600)
  await page.keyboard.type('寸法表', { delay: 10 })
  await page.keyboard.press('Escape')
  await ready(frame)
  await sleep(400)
  const table = await frame.evaluate(() => window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.type === 'table' && b.caption === '寸法表'))
  await frame.evaluate((id) => window.__editor.openWhenReady(id, 0), table.rows[0].cells[0].id)
  await sleep(400)
  for (const [i, text] of ['部位', '寸法', 'メモ'].entries()) {
    if (i) await page.keyboard.press('Tab')
    await page.keyboard.type(text, { delay: 10 })
  }
  await page.keyboard.press('Tab')
  await sleep(300)
  const afterHeader = await frame.evaluate(() => window.__editor.getSnapshot().editingId)
  // 中身の行は学生が書く所：押しても書かず、表を選ぶ
  await frame.evaluate((id) => window.__editor.openWhenReady(id, 0), table.rows[1].cells[0].id)
  await sleep(300)
  const bodyCell = await frame.evaluate(() => ({ editing: window.__editor.getSnapshot().editingId, selection: window.__editor.getSnapshot().selection?.kind, tools: [...document.querySelectorAll('.palette .tb')].map((b) => b.textContent).join('|') }))
  check(
    '表は、見出しの行だけを書く（Tab は見出しの行の中だけ。中身の行は押すと表を選ぶ。画像を入れる道具は出ない）',
    afterHeader === null && bodyCell.editing === null && bodyCell.selection === 'table' && !bodyCell.tools.includes('画像') && bodyCell.tools.includes('行を足す'),
    JSON.stringify({ afterHeader, ...bodyCell }),
  )
  // ---- 改ページ：表の後ろ（大見出しの終わり。あとで「要りません」と言われる）と、「制作過程」の説明の後ろ（小見出しから次のページ） ----
  await frame.evaluate(() => window.__editor.select(null))
  await tool(frame, '改ページ')
  await ready(frame)
  await frame.evaluate((id) => window.__editor.openWhenReady(id, 0), pid)
  await sleep(400)
  await tool(frame, '改ページ')
  await ready(frame)
  await sleep(600)
  const breaks = (await templateOf(frame)).template.map((b) => b.type).join(',')
  check('改ページを、書いている段落の後ろ（と、選んでいた表の後ろ）に入れられる', breaks.includes('chapter,paragraph,pageBreak,subheading,paragraph,table,pageBreak,chapter'), breaks)
  await frame.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), pid)
  await ready(frame)
  await sleep(400)
  await shot('2b-table-and-page-break')
  // ---- 図は空の枠（写真は選ばない）。入れたら消す ----
  const figureBefore = (await templateOf(frame)).template.filter((b) => b.type === 'figure').length
  await frame.evaluate((id) => window.__editor.openWhenReady(id, 0), pid)
  await sleep(400)
  await tool(frame, '図を入れる')
  await sleep(500)
  await page.keyboard.type('試験の図', { delay: 10 })
  await page.keyboard.press('Escape')
  await ready(frame)
  const figure = await frame.evaluate(() => window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).filter((b) => b.type === 'figureRow').map((r) => r.figures[0]).find((f) => f.caption === '試験の図'))
  const figureTools = await frame.evaluate((id) => {
    window.__editor.select({ kind: 'figure', id })
    return [...document.querySelectorAll('.palette .tb')].map((b) => b.textContent).join('|')
  }, figure?.id)
  await sleep(200)
  const figureTools2 = await frame.evaluate(() => [...document.querySelectorAll('.palette .tb')].map((b) => b.textContent).join('|'))
  check('「図を入れる」は、写真を選ばずに空の枠を入れる（「差し替え」「もう1枚」は出ない）', figure?.imageId === '' && !figureTools2.includes('差し替え') && !figureTools2.includes('もう1枚') && figureTools2.includes('削除'), JSON.stringify({ figure, figureTools, figureTools2 }))
  await frame.evaluate(() => window.__editor.removeSelected())
  await ready(frame)
  check('入れた図の枠は、削除できる', (await templateOf(frame)).template.filter((b) => b.type === 'figure').length === figureBefore)

  // ---- 抄録の書き出し例を、抄録のページの上で直す ----
  const absId = await frame.evaluate(() => window.__editor.getSnapshot().report.abstract.paragraphs[0].id)
  await frame.evaluate((id) => window.__editor.openWhenReady(id, 0), absId)
  await frame.waitForSelector('.overlay-editor', { visible: true })
  await sleep(500)
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Control')
  await page.keyboard.type('本制作報告書は、試験の書き出し例', { delay: 10 })
  await sleep(500)
  const absTag = await frame.evaluate(() => document.querySelector('.tpl-editing-tag')?.textContent ?? '')
  await shot('2c-abstract-example')
  check('抄録の書き出し例は、抄録のページの上で直す（札は「書き出しの例」）', absTag === '書き出しの例', absTag)
  await page.keyboard.press('Escape')
  await ready(frame)
  // ---- 表紙は見るだけ（ひな形に入らない） ----
  await frame.evaluate(() => {
    window.__editor.setView('fit')
    return window.__editor.goToPage(window.__editor.pageOfArea('cover'), 'none')
  })
  await ready(frame)
  await sleep(500)
  const cover = await frame.evaluate(() => ({ note: document.querySelector('.tpl-off-note')?.textContent ?? '', head: document.querySelector('.palette .p-head span')?.textContent ?? '' }))
  await clickIn(frame, '.page-viewport.front [data-vivliostyle-page-container].is-current [data-block-id="basic:studentId"]')
  await sleep(400)
  const coverClick = await frame.evaluate(() => ({ editing: window.__editor.getSnapshot().editingId, notice: document.querySelector('.undo-area')?.textContent ?? '' }))
  await shot('2d-cover-not-in-template')
  check(
    '表紙は見るだけ：紙面に「表紙は、学生が書きます」、道具に「学生が書く所（見るだけ）」。学籍番号を押しても書かない',
    cover.note === '表紙は、学生が書きますひな形には入りません（見るだけ）' && cover.head === '学生が書く所\n（見るだけ）' && coverClick.editing === null && coverClick.notice.includes('学生が書きます'),
    JSON.stringify({ ...cover, ...coverClick }),
  )
  await frame.evaluate(() => {
    window.__editor.setView('zoom')
    return window.__editor.goToPage(window.__editor.pageOfArea('body'), 'none')
  })
  await ready(frame)

  // ---- 1字だけの行（1366×768）：管理ページのカードと、ひな形を作る画面の帯・右の欄・道具・ページの一覧 ----
  const lonely = [...(await lonelyLines(frame, '.tpl-banner, .tpl-side, .palette, .thumb-list, .tpl-off-note')), ...(await lonelyLines(page, '.course.open .tpl-line'))]
  check('ひな形を作る画面とカードに、1字だけの行がない（1366×768）', lonely.length === 0, lonely.slice(0, 5).join(' / '))

  // ---- 直すところがあると、戻さずに右の欄に出す。押すとそこへ移る ----
  const sub = (await bodyBlocks(frame)).flatMap((c) => c.blocks).find((b) => b.text === '試験の小見出し')
  await frame.evaluate((id) => window.__editor.openWhenReady(id, 0), sub.id)
  await sleep(400)
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Escape')
  await ready(frame)
  await frame.evaluate(() => document.querySelector('.tpl-primary').click())
  await sleep(500)
  const issues = await frame.evaluate(() => ({ head: document.querySelector('.tpl-issues b')?.textContent ?? '', items: [...document.querySelectorAll('.tpl-issues li')].map((li) => li.textContent).join('|') }))
  const stillOpen = !!(await page.$('.tpl-overlay'))
  await shotIn(frame, '.tpl-side', '6-issues-inline')
  const issuesLonely = await lonelyLines(frame, '.tpl-issues')
  check('直すところの言葉にも、1字だけの行がない', issuesLonely.length === 0, issuesLonely.join(' / '))
  check(
    '空の小見出し・大見出しの終わりの改ページがあると、右の欄に「直してから…」と、紙面の番号で示す（管理ページには戻さない）',
    stillOpen && issues.head === '直してから、もう一度押してください' && issues.items === '小見出し「Ⅱ．ⅰ．」の名前が空です|「Ⅱ．」の終わりの改ページは要りません（大見出しは、いつも新しいページから始まります）',
    JSON.stringify(issues),
  )
  await frame.evaluate(() => document.querySelector('.tpl-issues li button').click())
  await sleep(600)
  const jumped = await frame.evaluate(() => window.__editor.getSnapshot().editingId)
  await page.keyboard.type('試験の小見出し', { delay: 10 })
  await page.keyboard.press('Escape')
  await ready(frame)
  const left = await frame.evaluate(() => [...document.querySelectorAll('.tpl-issues li')].map((li) => li.textContent).join('|'))
  // 改ページの直すところを押すと、そのページへ移って改ページを選ぶ（道具の「削除」で消す）
  await frame.evaluate(() => document.querySelector('.tpl-issues li button').click())
  await sleep(800)
  const picked = await frame.evaluate(() => window.__editor.getSnapshot().selection)
  await tool(frame, '削除')
  await ready(frame)
  const cleared = await frame.evaluate(() => document.querySelectorAll('.tpl-issues li').length)
  check(
    '直すところを押すとその欄で書き始め（改ページは選び）、直すと消える',
    jumped === sub.id && left.startsWith('「Ⅱ．」の終わりの改ページ') && picked?.kind === 'pageBreak' && cleared === 0,
    JSON.stringify({ jumped, left, picked, cleared }),
  )

  // ---- この端末に保存しない・外につながない ----
  const writes = await frame.evaluate(() => window.__storageWrites)
  check('ひな形を作る画面は、localStorage・sessionStorage・IndexedDB に書かない（学生の原稿・控え・組み方の覚えにも触れない）', Array.isArray(writes) && writes.length === 0, JSON.stringify(writes))
  check('ひな形を作る画面は、ドライブ・Google のログイン・Apps Script などの外につながない', outside.length === 0, outside.slice(0, 3).join(' / '))

  // ---- 戻す ----
  const before = await templateOf(frame)
  await frame.evaluate(() => document.querySelector('.tpl-primary').click())
  await page.waitForFunction(() => !document.querySelector('.tpl-overlay'), { timeout: 10000 })
  await sleep(300)
  const back = await page.evaluate(() => {
    // カードの「ひな形」の行の「変更あり」（ラベルの横の印と、欄の色）
    const ctl = document.querySelector('.course.open .tpl-line').closest('.ctl')
    const label = ctl.previousElementSibling.textContent
    return {
      toast: document.querySelector('.message.ok')?.textContent ?? '',
      summary: document.querySelector('.course.open .tpl-line b').textContent,
      chg: ctl.classList.contains('chg') && label.startsWith('ひな形') && label.includes('変更あり'),
      bar: document.querySelector('.dirty-bar .tx')?.textContent ?? '',
      message: document.querySelector('.message')?.textContent ?? '',
    }
  })
  await page.evaluate(() => document.querySelector('.course.open .tpl-line').scrollIntoView({ block: 'center' }))
  await sleep(300)
  await shot('4-back-with-changes')
  check(
    '「管理ページに戻して反映」：窓が閉じ、知らせ「ひな形を受け取りました（まだ学生に届いていません）」、カードに「変更あり」と新しい要約、画面の下に保存の帯（ひな形と抄録の書き出し例の2か所）',
    back.toast.startsWith('ひな形を受け取りました（まだ学生に届いていません）') &&
      back.summary === '大見出し3・小見出し4・説明6・図の枠1・素材表1・改ページ1・表1' &&
      back.chg &&
      back.bar.includes('まだ学生に届いていない変更が2か所あります') &&
      back.bar.includes('映画・舞台衣装デザイナー コースの下書きのひな形') &&
      back.bar.includes('映画・舞台衣装デザイナー コースの抄録の書き出し例') &&
      back.message === 'ひな形を受け取りました（まだ学生に届いていません）。「保存して学生に反映」を押すと、学生のツールに届きます',
    JSON.stringify(back),
  )
  // 前の作り方の窓でも、改ページと表が見える（消えない）
  await page.evaluate(() => document.querySelector('.course.open .tpl-old').click())
  await page.waitForSelector('.tpl-modal')
  await sleep(500)
  const oldRows = await page.evaluate(() => [...document.querySelectorAll('.tpl-modal .row')].map((r) => `${r.querySelector('.kind').textContent}:${r.querySelector('input')?.value ?? r.querySelector('.brk')?.textContent}${r.querySelector('.tbl-head') ? `(${r.querySelector('.tbl-head').textContent})` : ''}`).join('|'))
  await page.screenshot({ path: `${OUT}/8-fallback-window.png`, captureBeyondViewport: false })
  await page.evaluate(() => [...document.querySelectorAll('.tpl-foot button')].find((b) => b.textContent === 'やめる').click())
  await sleep(300)
  check('前の作り方の窓でも、改ページ・表（見出しの行）が残って見える', oldRows.includes('表表2:寸法表(見出し：部位・寸法・メモ)') && oldRows.includes('改ページ:ここで次のページへ') && !(await page.$('.tpl-modal')), oldRows)
  // 保存すると、サーバーにも改ページ・表・説明・書き出し例が入る
  await page.evaluate(() => [...document.querySelectorAll('.dirty-bar button')].find((b) => b.textContent.includes('保存して学生に反映')).click())
  await page.waitForFunction(() => !document.querySelector('.dirty-bar'), { timeout: 10000 })
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sotsugyo-admin-mock')).years[0].config.courses[0])
  check(
    '保存すると、受け取ったひな形（説明・小見出し・表の見出しの行と行の数・改ページ）と書き出し例が、そのまま入る',
    JSON.stringify(saved.template) === JSON.stringify(before.template) &&
      saved.abstractExample === '本制作報告書は、試験の書き出し例' &&
      saved.template.some((b) => b.type === 'table' && b.header.join() === '部位,寸法,メモ' && b.rows === 2) &&
      saved.template.some((b) => b.type === 'pageBreak') &&
      saved.template.some((b) => b.type === 'paragraph' && b.hint === 'パターン・仮縫い・縫製の順に、工夫した点と、うまくいかなかった点を書く'),
    JSON.stringify(saved.template).slice(0, 300),
  )

  // ---- 開き直すと、保存した（下書きの）ひな形で開く。直してから「やめる」・「×」は確かめる ----
  const again = await openScreen()
  const reopened = await templateOf(again)
  check('開き直すと、いまのひな形（改ページ・表を含む）で開く', JSON.stringify(reopened.template) === JSON.stringify(saved.template), JSON.stringify(reopened.template).slice(0, 200))
  // 直していなければ、「やめる」ですぐ閉じる
  let count = dialogs.count()
  await again.evaluate(() => [...document.querySelectorAll('.tpl-foot button')].find((b) => b.textContent === 'やめる').click())
  await page.waitForFunction(() => !document.querySelector('.tpl-overlay'), { timeout: 5000 }).catch(() => {})
  check('直していなければ「やめる」で、確かめずに閉じる', !(await page.$('.tpl-overlay')) && dialogs.count() === count)
  const edited = await openScreen()
  const p2 = (await bodyBlocks(edited)).flatMap((c) => c.blocks).find((b) => b.type === 'paragraph').id
  await edited.evaluate((id) => window.__editor.openWhenReady(id, 0), p2)
  await sleep(400)
  await page.keyboard.type('書き足し', { delay: 10 })
  // 「標準のひな形に戻す」：右の欄で確かめてから、本文を標準のひな形にする（確認の窓は出さない）
  count = dialogs.count()
  await edited.evaluate(() => document.querySelector('.tpl-link').click())
  await sleep(300)
  const ask = await edited.evaluate(() => document.querySelector('.tpl-reset-ask')?.textContent ?? '')
  const askLonely = await lonelyLines(edited, '.tpl-reset-ask')
  await edited.evaluate(() => [...document.querySelectorAll('.tpl-reset-ask button')].find((b) => b.textContent === '戻す').click())
  await edited.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning }, { timeout: 60000 })
  const reset = await templateOf(edited)
  check(
    '「標準のひな形に戻す」は、右の欄で確かめてから、本文を標準のひな形（企画・立案／制作過程／まとめ）にする',
    ask.startsWith('本文を、標準のひな形（企画・立案／制作過程／まとめ）に戻しますか？') && askLonely.length === 0 && reset.template.filter((b) => b.type === 'chapter').map((b) => b.title).join('／') === '企画・立案／制作過程／まとめ' && dialogs.count() === count,
    JSON.stringify({ ask, askLonely, chapters: reset.template.length }),
  )
  count = dialogs.count()
  dialogs.answer(false)
  await edited.evaluate(() => [...document.querySelectorAll('.tpl-foot button')].find((b) => b.textContent === 'やめる').click())
  await sleep(500)
  const asked = dialogs.last()
  const keptOpen = !!(await page.$('.tpl-overlay'))
  await page.evaluate(() => document.querySelector('.tpl-close').click())
  await sleep(400)
  const askedX = dialogs.count() - count === 2 && !!(await page.$('.tpl-overlay'))
  dialogs.answer(true)
  await page.evaluate(() => document.querySelector('.tpl-close').click())
  await page.waitForFunction(() => !document.querySelector('.tpl-overlay'), { timeout: 5000 }).catch(() => {})
  const summaryAfter = await page.evaluate(() => document.querySelector('.course.open .tpl-line b').textContent)
  check(
    '直してから「やめる」・「×」を押すと確かめ、キャンセルなら閉じない。OK なら閉じ、下書きは変わらない',
    asked === 'ひな形を作る画面で直した内容は、反映されずに消えます。閉じますか？' && keptOpen && askedX && !(await page.$('.tpl-overlay')) && summaryAfter === back.summary && !(await page.$('.dirty-bar')),
    JSON.stringify({ asked, keptOpen, askedX, summaryAfter }),
  )

  // ---- 間違った場所・合言葉の知らせは受け取らない ----
  const probe = await openScreen()
  const nonce = await probe.evaluate(() => window.__nonce)
  const fake = (nonce) => ({ source: 'sotsugyo-template', type: 'apply', nonce, template: [{ type: 'chapter', title: '偽物' }], abstractExample: '' })
  // 管理ページ自身から（iframe ではない。場所は同じ開発サーバー）
  await page.evaluate((msg) => window.postMessage(msg, '*'), fake(nonce))
  // iframe から、違う合言葉で
  await probe.evaluate((msg) => parent.postMessage(msg, '*'), fake('0'.repeat(32)))
  await probe.evaluate((msg) => parent.postMessage(msg, '*'), { ...fake('0'.repeat(32)), type: 'cancel' })
  // iframe から（source は合う）、合言葉も合うが、場所（origin）が違う知らせ
  await page.evaluate((msg) => window.dispatchEvent(new MessageEvent('message', { data: msg, origin: 'https://evil.example.com', source: document.querySelector('.tpl-overlay iframe').contentWindow })), fake(nonce))
  await sleep(600)
  const ignored = await page.evaluate(() => ({ open: !!document.querySelector('.tpl-overlay'), summary: document.querySelector('.course.open .tpl-line b').textContent, bar: !!document.querySelector('.dirty-bar') }))
  // 比べるため：場所・iframe・合言葉がすべて合う知らせは受け取る（直したと知らせると、タブを閉じるときに確かめる）
  const guardedBefore = await leaveGuarded()
  await page.evaluate((nonce, origin) => window.dispatchEvent(new MessageEvent('message', { data: { source: 'sotsugyo-template', type: 'dirty', nonce, dirty: true }, origin, source: document.querySelector('.tpl-overlay iframe').contentWindow })), nonce, new URL(APP).origin)
  await sleep(200)
  const guardedAfter = await leaveGuarded()
  check(
    '管理ページは、ほかの窓・違う合言葉・違う場所（origin）の知らせを受け取らない（すべて合う知らせだけ受け取る）',
    ignored.open && ignored.summary === back.summary && !ignored.bar && !guardedBefore && guardedAfter,
    JSON.stringify({ ...ignored, guardedBefore, guardedAfter }),
  )
  dialogs.answer(true)
  await page.evaluate(() => document.querySelector('.tpl-close').click())
  await page.waitForFunction(() => !document.querySelector('.tpl-overlay'), { timeout: 5000 }).catch(() => {})

  // ツールは、決まった場所（開発中は手元）からの init だけを受け取る（管理ページの外に、もう1つ枠を開いて試す）
  await page.evaluate((src) => {
    const f = document.createElement('iframe')
    f.id = 'probe-tool'
    f.src = src
    f.style.cssText = 'position:fixed;left:0;top:0;width:1100px;height:700px;opacity:0;pointer-events:none'
    document.body.append(f)
  }, `${new URL(APP).origin}/?template=1&probe=1`)
  await page.waitForFunction(() => document.getElementById('probe-tool').contentDocument?.querySelector('.tpl-wait'), { timeout: 30000 })
  const probeFrame = page.frames().find((f) => f.url().includes('probe=1'))
  const init = (origin) =>
    probeFrame.evaluate((origin) => {
      const payload = { courseId: 'film-stage-costume', courseName: '偽物', template: [{ type: 'chapter', title: '偽物' }], abstractExample: '', config: {}, status: '公開中' }
      window.dispatchEvent(new MessageEvent('message', { data: { source: 'sotsugyo-admin', type: 'init', nonce: 'a'.repeat(32), payload }, origin, source: window.parent }))
    }, origin)
  const acks = []
  await page.exposeFunction('__ack', (data) => acks.push(data))
  await page.evaluate(() => window.addEventListener('message', (e) => e.data?.type === 'ack' && window.__ack(e.data)))
  for (const origin of ['https://evil.example.com', 'https://script.google.com', 'http://other.localhost:5173', 'null']) await init(origin)
  await sleep(800)
  const refused = await probeFrame.evaluate(() => ({ editor: !!window.__editor, banner: document.querySelector('.tpl-banner')?.textContent ?? '' }))
  // 比べるため：決まった場所（開発中は手元）からなら受け取る
  await init(new URL(APP).origin)
  await sleep(1500)
  const accepted = await probeFrame.evaluate(() => document.querySelector('.tpl-banner')?.textContent ?? '')
  check(
    'ツールは、決まった場所（Apps Script の枠・開発中は手元）からの init だけを受け取る（ほかの場所からは、ひな形を受け取らず、返事もしない）',
    !refused.editor && refused.banner === 'ひな形を作る画面（学生の画面ではありません）' && accepted.startsWith('ひな形を作っています：偽物 コース') && acks.length === 1,
    JSON.stringify({ refused, accepted, acks: acks.length }),
  )
  await page.evaluate(() => document.getElementById('probe-tool').remove())

  // ---- 狭い画面（スマホ・縦長のタブレット）では、パソコンで使うことを知らせる ----
  await page.setViewport({ width: 820, height: 900 })
  await sleep(300)
  await page.evaluate(() => document.querySelector('.course.open .tpl-open').click())
  await page.waitForFunction(() => !document.querySelector('.tpl-opening'), { timeout: 30000 })
  const narrow = page.frames().find((f) => f.url().includes('template=1') && !f.url().includes('probe'))
  await narrow.waitForSelector('.tpl-phone')
  const phone = await narrow.evaluate(() => document.querySelector('.tpl-phone').textContent)
  await shot('7-narrow-screen')
  await narrow.evaluate(() => document.querySelector('.tpl-phone .tpl-sub').click())
  await page.waitForFunction(() => !document.querySelector('.tpl-overlay'), { timeout: 5000 }).catch(() => {})
  check('狭い画面では「ひな形を作る画面は、パソコンで使います」と出し、「やめる」で閉じる', phone.includes('ひな形を作る画面は、パソコンで使います') && !(await page.$('.tpl-overlay')), phone)
  await page.setViewport({ width: 1366, height: 768 })
  await context.close()

  // ---- 先生の画面でも、同じように開いて戻せる ----
  const tctx = await browser.createBrowserContext()
  const teacher = await tctx.newPage()
  teacher.on('pageerror', (e) => console.log('pageerror(template-mode teacher):', e.message))
  teacher.on('dialog', (d) => d.accept())
  await answerConfirms(teacher, () => true)
  await recordTemplateFrame(teacher)
  await teacher.setViewport({ width: 1366, height: 768 })
  await teacher.goto(`${APP}/admin.html?as=teacher`, { waitUntil: 'networkidle0' })
  await teacher.waitForSelector('.course.open .tpl-open')
  const tframe = await openScreen(teacher)
  await tool(tframe, '大見出し')
  await sleep(500)
  await teacher.keyboard.type('先生の大見出し', { delay: 10 })
  await teacher.keyboard.press('Escape')
  await tframe.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning }, { timeout: 60000 })
  await tframe.evaluate(() => document.querySelector('.tpl-primary').click())
  await teacher.waitForFunction(() => !document.querySelector('.tpl-overlay'), { timeout: 10000 })
  const tback = await teacher.evaluate(() => ({ toast: document.querySelector('.message.ok')?.textContent ?? '', summary: document.querySelector('.course.open .tpl-line b').textContent, bar: !!document.querySelector('.dirty-bar') }))
  check('先生の画面でも、ひな形を作る画面で直して戻せる（知らせ・保存の帯）', tback.toast.startsWith('ひな形を受け取りました（まだ学生に届いていません）') && tback.summary.startsWith('大見出し4') && tback.bar, JSON.stringify(tback))
  // 使い方の「コースの下書きのひな形」は、新しい作り方の言葉（1366×768 で1字だけの行がない）
  await teacher.evaluate(() => document.querySelector('.help-open').click())
  await teacher.waitForSelector('.help-dock [data-topic="t-template"]')
  await teacher.evaluate(() => document.querySelector('.help-dock [data-topic="t-template"]').click())
  await sleep(500)
  const help = await teacher.evaluate(() => document.querySelector('.help-dock .help-body')?.textContent ?? '')
  const helpLonely = await lonelyLines(teacher, '.help-dock .help-body')
  await teacher.screenshot({ path: `${OUT}/9-help-topic.png`, captureBeyondViewport: false })
  check(
    '使い方の「コースの下書きのひな形」は、「ひな形を作る画面を開く」「管理ページに戻して反映」「前の作り方で直す」で説明し、1字だけの行がない',
    help.includes('ひな形を作る画面を開く') && help.includes('管理ページに戻して反映') && help.includes('前の作り方で直す') && !help.includes('「反映する」') && helpLonely.length === 0,
    helpLonely.join(' / ') || help.slice(0, 120),
  )
  await tctx.close()
}
