// 段落をまたいで選ぶ（紙面をマウスでなぞる・Shift+クリック・Shift+↓）と、コピー・切り取り・削除・貼り付けを確かめる（Edge を自動で操作する）。
// 依頼者の指摘「複数の段落をまたいでコピーを取って場所を移動させたいときに、段落をまたぐようにして選択することが出来ません」（2026-10-19）。
// 範囲の決まりは src/editor/rangeOps.ts、紙面の位置との対応は src/editor/rangeSelection.ts。画面の写真は poc-output/range-select/ に置く。
// smoke.mjs（パソコン：rangeSelectPc）と phone.mjs（スマホ：rangeSelectPhone）から呼ぶ。これだけを動かすときは node scripts/e2e/rangeSelect.mjs
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { stubConfig } from './configStub.mjs'
import { setupWriting } from './sampleReport.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/range-select'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

/** 新しい入れ物で開き、はじめての案内を「あとで」で閉じて、見本の原稿にする（クリップボードを使えるようにする） */
async function openSample(browser, { phone = false, viewport = { width: 1600, height: 1000 } } = {}) {
  const context = await browser.createBrowserContext()
  await context.overridePermissions(APP, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'])
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror(rangeSelect):', e.message))
  await page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
    // コピーしたときに、クリップボードに入れた文字を記録する（編集の中核が入れたあと）
    window.__copied = []
    window.addEventListener('copy', (e) => window.__copied.push(e.clipboardData?.getData('text/plain') ?? ''))
  })
  await stubConfig(page)
  if (phone) {
    await page.setUserAgent(UA_IPHONE)
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  } else await page.setViewport(viewport)
  const ready = () =>
    page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning && !s.pageChecksPending && !document.querySelector('.loading') }, { timeout: 120000 })
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.guide.step-course .g-opts button', { timeout: 60000 })
  await page.evaluate(() => document.querySelector('.g-opts button').click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.g-later')
  await page.evaluate(() => document.querySelector('.g-later').click())
  await ready()
  await page.evaluate(() => window.__editor.finishEditing())
  await page.evaluate(setupWriting)
  await wait(300)
  await ready()
  return { context, page, ready }
}

/** 紙面の、欄 id の offset 文字目の点（見えているページの。その文字の左端の少し右・上下の真ん中） */
const charPoint = (page, id, offset) =>
  page.evaluate(
    (id, offset) => {
      const els = [...document.querySelectorAll(`.page-viewport.front [data-block-id="${id}"]`)]
      let acc = 0
      for (const el of els) {
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        while (w.nextNode()) {
          const n = w.currentNode
          if (offset < acc + n.length) {
            const r = document.createRange()
            r.setStart(n, offset - acc)
            r.setEnd(n, offset - acc + 1)
            const b = [...r.getClientRects()].find((x) => x.width > 0)
            return b ? { x: b.left + Math.min(2, b.width / 3), y: b.top + b.height / 2 } : null
          }
          acc += n.length
        }
      }
      return null
    },
    id,
    offset,
  )

/** 欄のあるページを出す */
const showBlock = async (page, ready, id) => {
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), id)
  await ready()
  await wait(150)
}

/** マウスでなぞって選ぶ（from から to まで） */
async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 })
  await page.mouse.move(to.x, to.y, { steps: 6 })
  await page.mouse.up()
  await wait(250)
}

const ctrl = async (page, key) => {
  await page.keyboard.down('Control')
  await page.keyboard.press(key)
  await page.keyboard.up('Control')
}

/** 原稿のようす（本文の章ごとのブロックの ID・種類、段落の文字） */
const state = (page) =>
  page.evaluate(async () => {
    const ops = await import('/src/editor/reportOps.ts')
    const s = window.__editor.getSnapshot()
    const num = ops.numbering(s.report)
    const text = (b) => (b.type === 'paragraph' ? ops.contentToText(b.content, num) : b.type === 'subheading' ? b.title : '')
    return {
      editing: s.editingId,
      caret: s.caret,
      chapters: s.report.body.map((c) => ({ id: c.id, title: c.title, blocks: c.blocks.map((b) => ({ id: b.id, type: b.type, text: text(b), figures: b.type === 'figureRow' ? b.figures.map((f) => f.id) : undefined, refs: b.type === 'paragraph' ? b.content.filter((n) => n.type === 'ref').map((n) => n.targetId) : undefined })) })),
      figures: [...num.figureByNumber.values()],
      body: JSON.stringify(s.report.body),
      notice: document.querySelector('.undo-toast')?.textContent ?? '',
      selection: getSelection().toString(),
      paperSelected: window.__editor.hasPaperSelection(),
    }
  })
const blockIn = (st, id) => st.chapters.flatMap((c) => c.blocks).find((b) => b.id === id)

export async function rangeSelectPc(browser, check) {
  const { context, page, ready } = await openSample(browser)
  const original = await state(page)
  const textOf = (id) => blockIn(original, id)?.text ?? ''

  // ---- ふつうのクリックは、今までどおり書く欄を開く ----
  await showBlock(page, ready, 'p3')
  const p3at = await charPoint(page, 'p3', 8)
  await page.mouse.click(p3at.x, p3at.y)
  await wait(300)
  let st = await state(page)
  check('段落を選ぶ：ふつうに押す（なぞらない）と、今までどおり書く欄が開く', st.editing === 'p3' && st.caret === 8, JSON.stringify({ editing: st.editing, caret: st.caret }))
  await page.keyboard.press('Escape')
  await ready()

  // ---- なぞって選ぶ：段落の途中から、図を通って、次の段落の途中まで（全体の表示） ----
  await drag(page, await charPoint(page, 'p3', 5), await charPoint(page, 'p4', 10))
  st = await state(page)
  await page.screenshot({ path: `${OUT}/1-drag-fit.png` })
  check(
    '段落を選ぶ：紙面をマウスでなぞると、段落と図をまたいで選べる（選んだ所の色が付く。書く欄は開かない）',
    !st.editing && st.paperSelected && st.selection.startsWith(textOf('p3').slice(5, 15)) && st.selection.includes('図1.デザイン画') && st.selection.includes(textOf('p4').slice(0, 10)),
    JSON.stringify({ editing: st.editing, selection: st.selection.slice(0, 60) }),
  )

  // ---- コピー：ふつうの文字は段落ごとに改行、図はタイトルの行 ----
  await ctrl(page, 'c')
  await wait(200)
  const copied = await page.evaluate(() => window.__copied.at(-1) ?? '')
  const system = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))
  const expected = [textOf('p3').slice(5), '図1.デザイン画', textOf('p4').slice(0, 10)].join('\n')
  check('段落を選ぶ：Ctrl+C で、選んだ文がクリップボードに入る（段落は改行で分け、図は「図1.デザイン画」の1行）', copied === expected && system === expected, JSON.stringify({ copied: copied.slice(0, 40), system: system.slice(0, 40) }))

  // ---- 選んだあと Shift+クリックで、選ぶ範囲を広げる（書く欄は開かない） ----
  const further = await charPoint(page, 'p4', 20)
  await page.keyboard.down('Shift')
  await page.mouse.click(further.x, further.y)
  await page.keyboard.up('Shift')
  await wait(250)
  st = await state(page)
  check('段落を選ぶ：選んだあと Shift+クリックすると、選ぶ範囲が広がる（書く欄は開かない）', !st.editing && st.paperSelected && st.selection.includes(textOf('p4').slice(0, 20)), JSON.stringify({ editing: st.editing, end: st.selection.slice(-12) }))
  // もう一度、はじめの範囲を選んでおく（貼り付けの確かめに使う。選んだ所の上から押すと、選んだ文をつかんで動かすことになるので、先に選ぶのをやめる）
  await page.evaluate(() => getSelection().removeAllRanges())
  await drag(page, await charPoint(page, 'p3', 5), await charPoint(page, 'p4', 10))
  await ctrl(page, 'c')
  await wait(150)

  // ---- 貼り付け：別の段落の途中で Ctrl+V。段落を分けて、文・図をまとまりのまま入れる。番号は振り直し、参照は貼り付けた図を指す ----
  await showBlock(page, ready, 'p13')
  const p13at = await charPoint(page, 'p13', 6)
  await page.mouse.click(p13at.x, p13at.y)
  await wait(300)
  await ctrl(page, 'v')
  await wait(400)
  await ready()
  const pasted = await state(page)
  const c2 = pasted.chapters[1].blocks
  const i13 = c2.findIndex((b) => b.id === 'p13')
  const newRow = c2[i13 + 1]
  const tail = c2[i13 + 2]
  const newFigure = newRow?.figures?.[0]
  check(
    '段落を選ぶ：書く欄で Ctrl+V：段落を分けて間に入れる（前の文＋選んだ文の始め・図・選んだ文の終わり＋後ろの文）',
    blockIn(pasted, 'p13')?.text === textOf('p13').slice(0, 6) + textOf('p3').slice(5).replace('（図1）', '（図4）') && newRow?.type === 'figureRow' && tail?.text === textOf('p4').slice(0, 10) + textOf('p13').slice(6),
    JSON.stringify({ p13: blockIn(pasted, 'p13')?.text.slice(0, 30), row: newRow?.type, tail: tail?.text.slice(0, 30) }),
  )
  check(
    '段落を選ぶ：貼り付けた図は新しい図（元の図はそのまま）。番号は振り直され（図4）、貼り付けた文の中の参照は、貼り付けた図を指す',
    !!newFigure && newFigure !== 'f1' && pasted.figures.length === 4 && pasted.figures[3] === newFigure && blockIn(pasted, 'p13')?.refs.includes(newFigure) && blockIn(pasted, 'p13')?.text.includes('（図4）') && blockIn(pasted, 'p3')?.refs.includes('f1'),
    JSON.stringify({ figures: pasted.figures, refs: blockIn(pasted, 'p13')?.refs }),
  )
  check('段落を選ぶ：貼り付けたあと、書く欄は貼り付けた文の終わりで開いたまま', pasted.editing === tail?.id && pasted.caret === 10, JSON.stringify({ editing: pasted.editing, caret: pasted.caret }))
  await page.screenshot({ path: `${OUT}/2-paste.png` })
  await page.keyboard.press('Escape')
  await ready()
  // 元に戻す・やり直す
  const afterPaste = (await state(page)).body
  await ctrl(page, 'z')
  await ready()
  const undone = (await state(page)).body
  await ctrl(page, 'y')
  await ready()
  const redone = (await state(page)).body
  check('段落を選ぶ：貼り付けは「元に戻す」1回で戻り、「やり直す」でまた入る', undone === original.body && redone === afterPaste, JSON.stringify({ undone: undone === original.body, redone: redone === afterPaste }))
  await ctrl(page, 'z')
  await ready()

  // ---- 切り取って貼り付ける＝動かす（段落・図・次の段落の途中まで） ----
  await showBlock(page, ready, 'p8')
  await drag(page, await charPoint(page, 'p8', 0), await charPoint(page, 'p9', 5))
  await ctrl(page, 'x')
  await wait(300)
  st = await state(page)
  await page.screenshot({ path: `${OUT}/3-cut.png` })
  check(
    '段落を選ぶ：Ctrl+X で切り取ると、選んだ段落・図・次の段落の始めが消え、画面の下に「切り取りました［戻す］」が出る',
    !blockIn(st, 'p8') && !blockIn(st, 'r3') && blockIn(st, 'p9')?.text === textOf('p9').slice(5) && st.figures.length === 2 && st.notice.includes('切り取りました') && st.notice.includes('戻す'),
    JSON.stringify({ notice: st.notice, figures: st.figures }),
  )
  await ready()
  await showBlock(page, ready, 'p16')
  const p16end = await charPoint(page, 'p16', textOf('p16').length - 1)
  await page.mouse.click(p16end.x + 12, p16end.y)
  await wait(300)
  await page.keyboard.press('End')
  await ctrl(page, 'v')
  await wait(400)
  await page.keyboard.press('Escape')
  await ready()
  const moved = await state(page)
  const c3 = moved.chapters[2].blocks.map((b) => b.id)
  check(
    '段落を選ぶ：切り取って別の所に貼り付けると、段落と図が動く（同じ図のまま。参照も同じ図を指し、番号は振り直し）',
    c3.slice(-4, -1).join(',') === 'p16,p8,r3' && moved.figures.length === 3 && moved.figures[2] === 'f3' && blockIn(moved, 'p8')?.refs.includes('f3') && blockIn(moved, 'p8')?.text.includes('（図3）') && moved.chapters[2].blocks.at(-1).text === textOf('p9').slice(0, 5),
    JSON.stringify({ c3, figures: moved.figures }),
  )
  await page.screenshot({ path: `${OUT}/4-moved.png` })
  await ctrl(page, 'z')
  await ready()
  await ctrl(page, 'z')
  await ready()
  check('段落を選ぶ：動かしたあと、元に戻す2回（貼り付け・切り取り）で元の原稿に戻る', (await state(page)).body === original.body)

  // ---- 範囲を Delete で消す（前と後ろの残りを1つの段落につなぐ）。［戻す］・やり直す ----
  await showBlock(page, ready, 'p11')
  await drag(page, await charPoint(page, 'p11', 3), await charPoint(page, 'p12', 5))
  await page.keyboard.press('Delete')
  await wait(300)
  st = await state(page)
  check(
    '段落を選ぶ：Delete で消すと、間の文が消え、前の段落の残りと後ろの段落の残りが1つの段落になる。画面の下に「選んだ文を削除しました［戻す］」',
    blockIn(st, 'p11')?.text === textOf('p11').slice(0, 3) + textOf('p12').slice(5) && !blockIn(st, 'p12') && st.notice.includes('選んだ文を削除しました'),
    JSON.stringify({ p11: blockIn(st, 'p11')?.text.slice(0, 20), notice: st.notice }),
  )
  await page.screenshot({ path: `${OUT}/5-delete.png` })
  await ready()
  await page.evaluate(() => [...document.querySelectorAll('.undo-toast button')].find((b) => b.textContent.includes('戻す'))?.click())
  await ready()
  const restoredDel = await state(page)
  await ctrl(page, 'y')
  await ready()
  const redoneDel = await state(page)
  check(
    '段落を選ぶ：［戻す］で元に戻り（「選んだ文を戻しました」）、やり直すとまた消える（知らせももう一度出る）',
    restoredDel.body === original.body && !blockIn(redoneDel, 'p12') && redoneDel.notice.includes('選んだ文を削除しました'),
    JSON.stringify({ restored: restoredDel.body === original.body, notice: redoneDel.notice }),
  )
  await ctrl(page, 'z')
  await ready()

  // ---- 大見出しをまたぐ：大見出しは残し、前の章と後ろの章の残りはつながない ----
  await page.evaluate(() => window.__editor.setView('spread'))
  await showBlock(page, ready, 'p14')
  const sp = await page.evaluate(() => ({ spread: window.__editor.getSnapshot().spread, page: window.__editor.getSnapshot().page, p13: window.__editor.pageOfBlock('p13'), p14: window.__editor.pageOfBlock('p14') }))
  await drag(page, await charPoint(page, 'p13', 3), await charPoint(page, 'p14', 5))
  st = await state(page)
  await page.screenshot({ path: `${OUT}/6-spread-chapter.png` })
  check(
    '段落を選ぶ：見開きで、左のページの段落から右のページの段落まで（大見出しをまたいで）なぞって選べる',
    sp.spread && sp.p13 !== sp.p14 && !st.editing && st.selection.includes('Ⅲ．まとめ') && st.selection.startsWith(textOf('p13').slice(3, 10)),
    JSON.stringify({ sp, selection: st.selection.slice(0, 50) }),
  )
  await ctrl(page, 'c')
  await wait(150)
  const chapterCopy = await page.evaluate(() => window.__copied.at(-1) ?? '')
  check('段落を選ぶ：大見出しをまたいでコピーすると、ふつうの文字には大見出しの行（「Ⅲ．まとめ」）も入る', chapterCopy === [textOf('p13').slice(3), 'Ⅲ．まとめ', textOf('p14').slice(0, 5)].join('\n'), JSON.stringify(chapterCopy.slice(0, 40)))
  await ctrl(page, 'x')
  await wait(300)
  st = await state(page)
  check(
    '段落を選ぶ：大見出しをまたいで切り取ると、大見出しは残り（「大見出しは残しました」）、前の章と後ろの章の文はつながない',
    st.chapters.length === 3 && st.chapters[2].title === 'まとめ' && blockIn(st, 'p13')?.text === textOf('p13').slice(0, 3) && blockIn(st, 'p14')?.text === textOf('p14').slice(5) && st.notice.includes('大見出しは残しました'),
    JSON.stringify({ titles: st.chapters.map((c) => c.title), notice: st.notice }),
  )
  await ready()
  await ctrl(page, 'z')
  await ready()
  check('段落を選ぶ：大見出しをまたいだ切り取りも、元に戻す1回で戻る', (await state(page)).body === original.body)

  // ---- 拡大の表示でも、なぞって選べる ----
  await page.evaluate(() => window.__editor.setView('zoom'))
  await showBlock(page, ready, 'p6')
  await page.evaluate(() => document.querySelector('.page-viewport.front [data-block-id="p6"]').scrollIntoView({ block: 'center' }))
  await wait(200)
  await drag(page, await charPoint(page, 'p6', 2), await charPoint(page, 'p7', 6))
  st = await state(page)
  await page.screenshot({ path: `${OUT}/7-zoom.png` })
  check('段落を選ぶ：拡大の表示でも、なぞって選べる（書く欄は開かない）', !st.editing && st.paperSelected && st.selection.includes(textOf('p7').slice(0, 6)), JSON.stringify(st.selection.slice(0, 40)))
  await page.evaluate(() => window.__editor.setView('fit'))
  await ready()

  // ---- 書く欄から Shift+クリックで選ぶ ----
  await showBlock(page, ready, 'p14')
  const p14at = await charPoint(page, 'p14', 2)
  await page.mouse.click(p14at.x, p14at.y)
  await wait(300)
  const p15at = await charPoint(page, 'p15', 5)
  await page.keyboard.down('Shift')
  await page.mouse.click(p15at.x, p15at.y)
  await page.keyboard.up('Shift')
  await wait(300)
  st = await state(page)
  await ctrl(page, 'c')
  await wait(150)
  const shiftCopy = await page.evaluate(() => window.__copied.at(-1) ?? '')
  check('段落を選ぶ：書く欄を開いたまま、ほかの段落を Shift+クリックすると、書く欄のカーソルの所から押した所までを選ぶ', !st.editing && st.paperSelected && shiftCopy === [textOf('p14').slice(2), textOf('p15').slice(0, 5)].join('\n'), JSON.stringify({ editing: st.editing, shiftCopy: shiftCopy.slice(0, 30) }))
  await ready()

  // ---- 選んだあとに、ふつうに押すと、選んだ所は消えて、押した所を書き始める ----
  const p16at = await charPoint(page, 'p16', 4)
  await page.mouse.click(p16at.x, p16at.y)
  await wait(300)
  st = await state(page)
  check('段落を選ぶ：選んだあとに、ふつうに押すと、押した所の書く欄が開く', st.editing === 'p16' && !st.paperSelected, JSON.stringify({ editing: st.editing }))

  // ---- キーボード：書く欄の最後の行で Shift+↓ を押すと、次の段落へ選ぶ範囲を広げる ----
  await page.evaluate(() => window.__editor.openEditor('p14', 3))
  await wait(300)
  await page.keyboard.down('Shift')
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown')
  await page.keyboard.up('Shift')
  await wait(200)
  st = await state(page)
  await ctrl(page, 'c')
  await wait(150)
  const keyCopy = await page.evaluate(() => window.__copied.at(-1) ?? '')
  await page.screenshot({ path: `${OUT}/8-shift-down.png` })
  check('段落を選ぶ：書く欄で Shift+↓ を続けて押すと、段落の終わりから次の段落へ、選ぶ範囲が広がる', !st.editing && st.paperSelected && keyCopy.startsWith(textOf('p14').slice(3)) && keyCopy.includes('\n' + textOf('p15').slice(0, 4)), JSON.stringify({ editing: st.editing, keyCopy: keyCopy.slice(0, 50) }))
  await context.close()
}

/** スマホ：指で押すと、今までどおり書く欄が開く（段落をまたいで選ぶのは、パソコンだけ） */
export async function rangeSelectPhone(browser, check) {
  const { context, page, ready } = await openSample(browser, { phone: true })
  await showBlock(page, ready, 'p3')
  // 紙面に選んだ文字が残っていても（長押しで選んだあとなど）、指で押せば書く欄が開く
  await page.evaluate(() => {
    const el = document.querySelector('.page-viewport.front [data-block-id="p2"]')
    getSelection().selectAllChildren(el)
  })
  const at = await charPoint(page, 'p3', 6)
  await page.touchscreen.tap(at.x, at.y)
  await wait(500)
  const st = await page.evaluate(() => ({ editing: window.__editor.getSnapshot().editingId, sheet: window.__editor.getSnapshot().sheet, paper: window.__editor.hasPaperSelection() }))
  check('段落を選ぶ（スマホ）：指で押すと、今までどおり書く欄が開く（紙面で選ぶ仕組みは使わない）', st.editing === 'p3' && st.sheet && !st.paper, JSON.stringify(st))
  await context.close()
}

// これだけを動かす：node scripts/e2e/rangeSelect.mjs
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { withEdge } = await import('../poc/edge.mjs')
  const results = []
  const check = (name, ok, detail = '') => {
    results.push(ok)
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
  }
  await withEdge(async (browser) => {
    await rangeSelectPc(browser, check)
    await rangeSelectPhone(browser, check)
  })
  const failed = results.filter((ok) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} 件 合格`)
  process.exitCode = failed ? 1 : 0
}
