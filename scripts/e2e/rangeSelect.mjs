// 段落をまたいで選ぶ（紙面をマウスでなぞる・Shift+クリック・Shift+↓）と、コピー・切り取り・削除・貼り付けを確かめる（Edge を自動で操作する）。
// 依頼者の指摘「複数の段落をまたいでコピーを取って場所を移動させたいときに、段落をまたぐようにして選択することが出来ません」（2026-10-19）。
// 範囲の決まりは src/editor/rangeOps.ts、紙面の位置との対応は src/editor/rangeSelection.ts。画面の写真は poc-output/range-select/ に置く。
// smoke.mjs（パソコン：rangeSelectPc）と phone.mjs（スマホ：rangeSelectPhone）から呼ぶ。これだけを動かすときは node scripts/e2e/rangeSelect.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
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
  await page.goto(`${APP}/?nodrive&direct=0`, { waitUntil: 'networkidle0' })
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
    const ops = await window.__import('editor/reportOps.ts')
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
  // 「本制作では、」の「は」まで（5字目の「、」の上で離すと、「、」まで選ぶため。periodSelectPc）
  await drag(page, await charPoint(page, 'p13', 3), await charPoint(page, 'p14', 4))
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
  check('段落を選ぶ：大見出しをまたいでコピーすると、ふつうの文字には大見出しの行（「Ⅲ．まとめ」）も入る', chapterCopy === [textOf('p13').slice(3), 'Ⅲ．まとめ', textOf('p14').slice(0, 4)].join('\n'), JSON.stringify(chapterCopy.slice(0, 40)))
  await ctrl(page, 'x')
  await wait(300)
  st = await state(page)
  check(
    '段落を選ぶ：大見出しをまたいで切り取ると、大見出しは残り（「大見出しは残しました」）、前の章と後ろの章の文はつながない',
    st.chapters.length === 3 && st.chapters[2].title === 'まとめ' && blockIn(st, 'p13')?.text === textOf('p13').slice(0, 3) && blockIn(st, 'p14')?.text === textOf('p14').slice(4) && st.notice.includes('大見出しは残しました'),
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
  const keyBar = await page.evaluate(() => !document.querySelector('.range-bar').hidden)
  check('選んだ文のボタン：書く欄から Shift+↓ で選び広げたときも、選んだ所の上に帯が出る', keyBar)
  await context.close()
  await selectionButtonsPc(browser, check)
  await periodSelectPc(browser, check)
  await abstractPastePc(browser, check)
}

/**
 * 紙面の欄 id の、見えているページの n 番目の字 ch（prev があれば、そのすぐ後ろの ch だけを数える）。
 * charPoint と同じ数え方の位置 offset・字の箱・点のある所（左下）・真ん中。
 * hang：行末にぶら下げた字（字の幅が 0 なので、箱の幅は字の高さから決める）
 */
const glyphOf = (page, id, ch, n = 0, prev = null) =>
  page.evaluate(
    (id, ch, n, prev) => {
      let before = ''
      let k = 0
      let offset = 0
      for (const el of document.querySelectorAll(`.page-viewport.front [data-block-id="${id}"]`)) {
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        while (w.nextNode()) {
          const t = w.currentNode
          for (let i = 0; i < t.length; i++, offset++) {
            const last = before
            before = t.data[i]
            if (t.data[i] !== ch || (prev && last !== prev)) continue
            const r = document.createRange()
            r.setStart(t, i)
            r.setEnd(t, i + 1)
            // 見えていないページの字は数えない
            const g = [...r.getClientRects()].find((x) => x.height > 0)
            if (!g || k++ < n) continue
            const width = g.width > 2 ? g.width : g.height * 0.9
            const box = { left: g.left, top: g.top, width, height: g.height }
            return { offset, hang: !!t.parentElement?.closest('viv-ts-close.viv-hang-end'), box, ink: { x: g.left + width * 0.25, y: g.top + g.height * 0.75 }, center: { x: g.left + width / 2, y: g.top + g.height / 2 }, right: el.getBoundingClientRect().right }
          }
        }
      }
      return null
    },
    id,
    ch,
    n,
    prev,
  )

/** 画面の箱の中で、選んだ色（青）の点の割合（0〜1。選んだ色が字に付いているか） */
async function blueShare(page, box) {
  const clip = { x: Math.round(box.left + 1), y: Math.round(box.top + 1), width: Math.max(1, Math.floor(box.width - 2)), height: Math.max(1, Math.floor(box.height - 2)) }
  // captureBeyondViewport: false：写すときに画面の大きさを変えない（変えると、書く欄が組み直されて選んだ所が外れる）
  const png = await page.screenshot({ clip, encoding: 'base64', captureBeyondViewport: false })
  return page.evaluate(async (png) => {
    const img = new Image()
    img.src = `data:image/png;base64,${png}`
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const g = c.getContext('2d')
    g.drawImage(img, 0, 0)
    const d = g.getImageData(0, 0, c.width, c.height).data
    let blue = 0
    for (let i = 0; i < d.length; i += 4) if (d[i + 2] > 150 && d[i + 2] - d[i] > 80) blue++
    return blue / (d.length / 4)
  }, png)
}

/**
 * 文の終わりの「。」「、」・終わり括弧も、文と一緒に選べる（依頼者の指摘「文末の「。」は文章と一緒に選択ができません」「「。」側からドラッグしてその前の文章を全て選択しようとしたら、「。」しか選択できませんでした」2026-10-20）。
 * 「。」の点の上で離す・「。」から前へなぞる・行末にぶら下げた「。」・Shift+クリック・Shift+→・書き直したあと・見開き・拡大・次のページへ続く段落。画面の写真は poc-output/select-period/
 */
export async function periodSelectPc(browser, check) {
  const SHOTS = 'poc-output/select-period'
  mkdirSync(SHOTS, { recursive: true })
  const { context, page, ready } = await openSample(browser, { viewport: { width: 1366, height: 768 } })
  const original = await state(page)
  const textOf = (id) => blockIn(original, id)?.text ?? ''
  const copy = async () => {
    await ctrl(page, 'c')
    await wait(150)
    return page.evaluate(() => window.__copied.at(-1) ?? '')
  }
  const clear = async () => {
    await page.evaluate(() => getSelection().removeAllRanges())
    await wait(200)
  }
  /** 字の近くの写真（拡大） */
  const shot = async (name, box) => {
    const clip = { x: Math.max(0, Math.round(box.left - 170)), y: Math.max(0, Math.round(box.top - 40)), width: 230, height: 90 }
    const png = await page.screenshot({ clip, encoding: 'base64', captureBeyondViewport: false })
    // 3倍に拡大して保存する（画面の大きさは変えない）
    const big = await page.evaluate(async (png) => {
      const img = new Image()
      img.src = `data:image/png;base64,${png}`
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width * 3
      c.height = img.height * 3
      const g = c.getContext('2d')
      g.imageSmoothingEnabled = false
      g.drawImage(img, 0, 0, c.width, c.height)
      return c.toDataURL('image/png').split(',')[1]
    }, png)
    writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(big, 'base64'))
  }

  // ---- 行の途中の「。」：点の上で離しても、「。」まで選ぶ（今までは、点の上で離すと「。」の前まで）。選んだ色も付く ----
  await showBlock(page, ready, 'p4')
  let g = await glyphOf(page, 'p4', '。')
  await clear()
  await drag(page, await charPoint(page, 'p4', g.offset - 8), g.ink)
  let copied = await copy()
  let share = await blueShare(page, g.box)
  await shot('after-1-release-on-dot', g.box)
  check('文の終わりの「。」：「。」の点の上でマウスを離すと、「。」まで選ぶ（コピーした文が「。」で終わる。「。」に選んだ色が付く）', copied.endsWith('。') && copied.length === 9 && share > 0.4, JSON.stringify({ copied, share }))

  // 「、」・終わり括弧（「（図3）」の「）」）・「）」の後ろの「。」
  g = await glyphOf(page, 'p4', '、')
  await clear()
  await drag(page, await charPoint(page, 'p4', g.offset - 6), g.ink)
  copied = await copy()
  check('文の終わりの「。」：「、」の点の上で離しても、「、」まで選ぶ', copied.endsWith('、') && copied.length === 7, JSON.stringify(copied))
  await showBlock(page, ready, 'p8')
  g = await glyphOf(page, 'p8', '）')
  await clear()
  await drag(page, await charPoint(page, 'p8', g.offset - 6), g.ink)
  const paren = await copy()
  g = await glyphOf(page, 'p8', '。', 0, '）')
  await clear()
  await drag(page, await charPoint(page, 'p8', g.offset - 6), g.ink)
  const parenPeriod = await copy()
  check('文の終わりの「。」：「（図3）」の「）」の上で離すと「）」まで、そのあとの「。」の上なら「）。」まで選ぶ', paren.endsWith('図3）') && parenPeriod.endsWith('）。'), JSON.stringify({ paren, parenPeriod }))

  // ---- 依頼者の操作：段落の最後の「。」から前へなぞって、段落を全部選ぶ（今までは「。」しか選べなかった） ----
  await showBlock(page, ready, 'p11')
  const last = (textOf('p11').match(/。/g) ?? []).length - 1
  g = await glyphOf(page, 'p11', '。', last)
  const start = await charPoint(page, 'p11', 0)
  await clear()
  await drag(page, g.center, start)
  const backCenter = await copy()
  share = await blueShare(page, g.box)
  await shot('after-3-backward-from-period', g.box)
  await clear()
  await drag(page, g.ink, start)
  const backInk = await copy()
  check('文の終わりの「。」：段落の最後の「。」から前へなぞると、段落の始めから「。」まで全部選ぶ（「。」の真ん中・点のどちらから始めても）', backCenter === textOf('p11') && backInk === textOf('p11') && share > 0.4, JSON.stringify({ backCenter: backCenter.slice(-12), backInk: backInk.slice(-12), len: [backCenter.length, backInk.length, textOf('p11').length], share }))
  // 行の途中の「。」から、前の行へなぞる
  g = await glyphOf(page, 'p11', '。', 0)
  await clear()
  await drag(page, g.ink, { x: g.center.x - 30, y: g.center.y - g.box.height * 2.2 })
  copied = await copy()
  check('文の終わりの「。」：行の途中の「。」の点から前の行へなぞっても、「。」まで選ぶ', copied.endsWith('。') && copied.length > 5, JSON.stringify(copied.slice(-12)))

  // ---- 切り取り・削除にも「。」が入る ----
  await showBlock(page, ready, 'p4')
  g = await glyphOf(page, 'p4', '。')
  await clear()
  await drag(page, await charPoint(page, 'p4', g.offset - 8), g.ink)
  await ctrl(page, 'x')
  await wait(300)
  await ready()
  const cut = await page.evaluate(() => window.__copied.at(-1) ?? '')
  let st = await state(page)
  const before = textOf('p4')
  const at = before.indexOf(cut)
  check('文の終わりの「。」：「。」の点で離して切り取ると、「。」も一緒に切り取る（段落に「。」が残らない）', cut.endsWith('。') && at >= 0 && blockIn(st, 'p4')?.text === before.slice(0, at) + before.slice(at + cut.length), JSON.stringify({ cut, after: blockIn(st, 'p4')?.text.slice(Math.max(0, at - 3), at + 6) }))
  await ctrl(page, 'z')
  await wait(300)
  await ready()
  await showBlock(page, ready, 'p4')
  g = await glyphOf(page, 'p4', '。')
  await clear()
  await drag(page, await charPoint(page, 'p4', g.offset - 8), g.ink)
  await page.keyboard.press('Delete')
  await wait(300)
  await ready()
  st = await state(page)
  const afterDel = blockIn(st, 'p4')?.text ?? ''
  let p = 0
  while (p < afterDel.length && afterDel[p] === before[p]) p++
  const removed = before.slice(p, p + before.length - afterDel.length)
  check('文の終わりの「。」：「。」の点で離して Delete で消すと、「。」も一緒に消える', removed.endsWith('。') && removed.length === 9, JSON.stringify(removed))
  await ctrl(page, 'z')
  await wait(300)
  await ready()
  check('文の終わりの「。」：切り取り・削除は、元に戻すで元の原稿に戻る', (await state(page)).body === original.body)

  // ---- Shift+クリック（選んだあと・書く欄から）でも、「。」の点の上なら「。」まで ----
  await showBlock(page, ready, 'p4')
  g = await glyphOf(page, 'p4', '。')
  await clear()
  await drag(page, await charPoint(page, 'p4', g.offset - 12), await charPoint(page, 'p4', g.offset - 9))
  await page.keyboard.down('Shift')
  await page.mouse.click(g.ink.x, g.ink.y)
  await page.keyboard.up('Shift')
  await wait(250)
  const shiftClick = await copy()
  await clear()
  await showBlock(page, ready, 'p3')
  await page.evaluate(() => window.__editor.openEditor('p3', 3))
  await wait(300)
  g = await glyphOf(page, 'p4', '。')
  await page.keyboard.down('Shift')
  await page.mouse.click(g.ink.x, g.ink.y)
  await page.keyboard.up('Shift')
  await wait(250)
  st = await state(page)
  const fromBox = await copy()
  check(
    '文の終わりの「。」：Shift+クリックで「。」の点の上を押しても、「。」まで選ぶ（選んだあと・書く欄から）',
    shiftClick.endsWith('。') && shiftClick.length === 13 && !st.editing && fromBox.startsWith(textOf('p3').slice(3)) && fromBox.endsWith(`\n${textOf('p4').slice(0, g.offset + 1)}`),
    JSON.stringify({ shiftClick, fromBox: fromBox.slice(-12), editing: st.editing }),
  )

  // ---- 行末にぶら下げた「。」（字の幅が 0）：なぞる・前へなぞる・余白で離す・Shift+→。選んだ色も付く ----
  await page.evaluate(() => window.__editor.finishEditing())
  await clear()
  await showBlock(page, ready, 'a2')
  const hang = await page.evaluate(() => {
    const el = document.querySelector('.page-viewport.front viv-ts-close.viv-hang-end')
    if (!el) return null
    const id = el.closest('[data-block-id]').dataset.blockId
    return { id, ch: el.textContent }
  })
  if (hang) {
    // 何番目の「。」か
    const nth = await page.evaluate((id) => {
      const target = document.querySelector(`.page-viewport.front [data-block-id="${id}"] viv-ts-close.viv-hang-end`).firstElementChild.firstChild
      let n = 0
      for (const el of document.querySelectorAll(`.page-viewport.front [data-block-id="${id}"]`)) {
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        while (w.nextNode()) {
          const t = w.currentNode
          if (t === target) return n
          n += [...t.data].filter((c) => c === target.data).length
        }
      }
      return -1
    }, hang.id)
    g = await glyphOf(page, hang.id, hang.ch, nth)
    const from = await charPoint(page, hang.id, g.offset - 8)
    await clear()
    await drag(page, from, g.center)
    const fwd = await copy()
    const marked = await page.evaluate(() => document.querySelectorAll('.sel-hang').length)
    share = await blueShare(page, g.box)
    await shot('after-2-hanging-period', g.box)
    // 選んだ文の帯の「コピー」も同じ
    await page.evaluate(() => [...document.querySelectorAll('.range-bar button')].find((b) => b.textContent === 'コピー')?.click())
    await wait(150)
    const byBar = await page.evaluate(() => window.__copied.at(-1) ?? '')
    await clear()
    await drag(page, from, { x: g.right + 25, y: g.center.y })
    const margin = await copy()
    await clear()
    await drag(page, g.center, from)
    const back = await copy()
    // Shift+→：「。」の前まで選んでから
    await page.evaluate((id, offset) => {
      const els = [...document.querySelectorAll(`.page-viewport.front [data-block-id="${id}"]`)]
      const at = (o) => {
        let acc = 0
        for (const el of els) {
          const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
          while (w.nextNode()) {
            const t = w.currentNode
            if (o < acc + t.length) return [t, o - acc]
            acc += t.length
          }
        }
      }
      getSelection().setBaseAndExtent(...at(offset - 5), ...at(offset))
    }, hang.id, g.offset)
    await wait(100)
    await page.keyboard.down('Shift')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.up('Shift')
    await wait(200)
    const key = await copy()
    const keyShare = await blueShare(page, g.box)
    const hangOk = fwd.endsWith('。') && fwd.length === 9 && marked === 1 && share > 0.4 && byBar === fwd && margin === fwd && back === fwd && key.length === 6 && key.endsWith('。') && keyShare > 0.4
    check(
      '文の終わりの「。」：行末にぶら下げた「。」も、なぞる・前へなぞる・右の余白で離す・Shift+→ で選べて、選んだ色が付く（帯の「コピー」も同じ）',
      hangOk,
      JSON.stringify({ fwd, marked, share, byBar, margin, back, key, keyShare }),
    )
    // 書く欄（紙面と同じ所で折り返す）でも、ぶら下げた「。」に選んだ色が付く
    await clear()
    await page.evaluate((id) => window.__editor.openEditor(id, 0), hang.id)
    await wait(400)
    const inBox = await page.evaluate(() => {
      const el = document.querySelector('.overlay-editor viv-ts-close.viv-hang-end')
      if (!el) return null
      const t = el.firstElementChild.firstChild
      const w = document.createTreeWalker(document.querySelector('.overlay-editor'), NodeFilter.SHOW_TEXT)
      const nodes = []
      while (w.nextNode()) nodes.push(w.currentNode)
      // 「。」の5字前から「。」まで
      let k = nodes.indexOf(t) - 1
      let back = 5
      while (k > 0 && nodes[k].length < back) back -= nodes[k--].length
      getSelection().setBaseAndExtent(nodes[k], Math.max(0, nodes[k].length - back), t, 1)
      const r = document.createRange()
      r.setStart(t, 0)
      r.setEnd(t, 1)
      const g = r.getClientRects()[0]
      return { left: g.left, top: g.top, width: g.height * 0.9, height: g.height }
    })
    await wait(200)
    const boxShare = inBox ? await blueShare(page, inBox) : 0
    if (inBox) await shot('after-4-hanging-period-writing-box', inBox)
    check('文の終わりの「。」：書く欄でも、行末にぶら下げた「。」を選ぶと色が付く', !!inBox && boxShare > 0.4, JSON.stringify({ inBox: !!inBox, boxShare }))
    await page.evaluate(() => window.__editor.finishEditing())
    await wait(300)
    await ready()
  } else check('文の終わりの「。」：見本に行末にぶら下げた「。」がある', false, 'a2 のページに viv-hang-end がない')
  await clear()
  // 紙面の印は外れる。ページの一覧の小さなページ（紙面の複製）に印が写っていても、色は塗らない
  const left = await page.evaluate(() => ({
    paper: document.querySelectorAll(':is(.page-scroller, #overlay-layer) .sel-hang').length,
    painted: [...document.querySelectorAll('.sel-hang > viv-ts-inner')].filter((e) => getComputedStyle(e, '::before').content !== 'none').length,
  }))
  check('文の終わりの「。」：選ぶのをやめると、ぶら下げた「。」の色も消える（ページの一覧の小さなページにも塗らない）', left.paper === 0 && left.painted === 0, JSON.stringify(left))

  // ---- 書き直したあと（組み直した紙面）でも ----
  await page.evaluate(() => window.__editor.openEditor('p4', 0))
  await wait(300)
  await page.keyboard.press('End')
  await page.keyboard.down('Control')
  await page.keyboard.press('End')
  await page.keyboard.up('Control')
  await page.keyboard.type('あいうえお。')
  await page.evaluate(() => window.__editor.finishEditing())
  await wait(300)
  await ready()
  await showBlock(page, ready, 'p4')
  const count = ((await state(page)).chapters.flatMap((c) => c.blocks).find((b) => b.id === 'p4')?.text.match(/。/g) ?? []).length
  g = await glyphOf(page, 'p4', '。', count - 1)
  await clear()
  await drag(page, await charPoint(page, 'p4', g.offset - 3), g.ink)
  copied = await copy()
  check('文の終わりの「。」：書き直したあとの紙面でも、「。」の点で離すと「。」まで選ぶ', copied === 'うえお。', JSON.stringify(copied))
  await ctrl(page, 'z')
  await wait(300)
  await ready()

  // ---- 見開き・拡大でも ----
  await page.evaluate(() => window.__editor.setView('spread'))
  await showBlock(page, ready, 'p11')
  g = await glyphOf(page, 'p11', '。')
  await clear()
  await drag(page, await charPoint(page, 'p11', g.offset - 6), g.ink)
  const spread = await copy()
  await page.evaluate(() => window.__editor.setView('zoom'))
  await showBlock(page, ready, 'p11')
  await page.evaluate(() => document.querySelector('.page-viewport.front [data-block-id="p11"]').scrollIntoView({ block: 'center' }))
  await wait(200)
  g = await glyphOf(page, 'p11', '。')
  await clear()
  await drag(page, g.center, await charPoint(page, 'p11', g.offset - 6))
  const zoom = await copy()
  await page.evaluate(() => window.__editor.setView('fit'))
  await ready()
  check('文の終わりの「。」：見開き（点で離す）・拡大（「。」から前へなぞる）でも、「。」まで選ぶ', spread.endsWith('。') && spread.length === 7 && zoom.endsWith('。') && zoom.length === 7, JSON.stringify({ spread, zoom }))

  // ---- 次のページへ続く段落の、続きの部分でも ----
  await page.evaluate(() =>
    window.__editor.update((r) => ({
      ...r,
      body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === 'p5' ? { ...b, content: [...b.content, { type: 'text', text: '試作では、袖の形を三つ比べた。布の厚さによって、揺れ方が変わった。'.repeat(8) }] } : b)) })),
    })),
  )
  await wait(300)
  await ready()
  const p5 = (await state(page)).chapters.flatMap((c) => c.blocks).find((b) => b.id === 'p5').text
  const pages = await page.evaluate((len) => [window.__editor.pageOfBlock('p5'), window.__editor.renderer.pageView.pageOfOffset('p5', len)], p5.length)
  await page.evaluate((n) => window.__editor.goToPage(n, 'none'), pages[1])
  await ready()
  await wait(150)
  g = await glyphOf(page, 'p5', '。')
  await clear()
  await drag(page, await charPoint(page, 'p5', Math.max(0, g.offset - 6)), g.ink)
  copied = await copy()
  check('文の終わりの「。」：次のページへ続く段落の、続きの部分でも、「。」の点で離すと「。」まで選ぶ', pages[1] > pages[0] && copied.endsWith('。') && p5.includes(copied) && copied.length >= 2, JSON.stringify({ pages, copied }))
  await context.close()
}

/** 選んだ文のボタン（mockups/v36：案B 左の道具の「選んだ文」・案A 選んだ所の上の帯と、書く欄の近くの「貼り付け」）。画面の写真は poc-output/v36-impl/ */
async function selectionButtonsPc(browser, check) {
  const SHOTS = 'poc-output/v36-impl'
  mkdirSync(SHOTS, { recursive: true })
  const { context, page, ready } = await openSample(browser, { viewport: { width: 1366, height: 768 } })
  const original = await state(page)
  const ui = () =>
    page.evaluate(() => {
      const bar = document.querySelector('.range-bar')
      const chip = document.querySelector('.range-chip')
      const group = document.querySelector('.palette .group.ctx.sel-tools')
      const sel = getSelection()
      const lines = sel.rangeCount ? [...sel.getRangeAt(0).getClientRects()].filter((r) => r.width > 1 && r.height > 2) : []
      const b = bar.getBoundingClientRect()
      const overlap = !bar.hidden && lines.some((r) => r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top)
      const top = lines.length ? Math.min(...lines.map((r) => r.top)) : 0
      const bottom = lines.length ? Math.max(...lines.map((r) => r.bottom)) : 0
      return {
        bar: !bar.hidden,
        below: bar.classList.contains('below'),
        barTop: b.top,
        barBottom: b.bottom,
        selTop: top,
        selBottom: bottom,
        overlap,
        labels: [...bar.querySelectorAll('button')].map((x) => `${x.textContent}|${x.getAttribute('aria-label')}`),
        group: group ? [...group.querySelectorAll('.tb')].map((x) => `${x.textContent}|${x.title}`) : null,
        chip: !chip.hidden,
        chipLabel: chip.getAttribute('aria-label'),
        pasteTool: [...document.querySelectorAll('.palette .group.ctx .tb')].some((x) => x.textContent === '貼り付け'),
      }
    })
  const selectP3P4 = async () => {
    await page.evaluate(() => getSelection().removeAllRanges())
    await showBlock(page, ready, 'p3')
    await drag(page, await charPoint(page, 'p3', 5), await charPoint(page, 'p4', 10))
    await wait(150)
  }
  const clickTool = (selector, label) => page.evaluate((selector, label) => [...document.querySelectorAll(selector)].find((b) => b.textContent === label)?.click(), selector, label)

  // ---- なぞっている途中は帯を出さず、離すと選んだ所のすぐ上に出る。左の道具に「選んだ文」 ----
  await showBlock(page, ready, 'p3')
  const from = await charPoint(page, 'p3', 5)
  const to = await charPoint(page, 'p4', 10)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await wait(120)
  const during = await ui()
  await page.mouse.up()
  await wait(200)
  let u = await ui()
  await page.mouse.move(5, 5)
  await page.screenshot({ path: `${SHOTS}/1-selection-bar-palette.png` })
  check('選んだ文のボタン：なぞっている途中は帯を出さず、マウスを離すと、選んだ文の1行目のすぐ上に帯が出る（選んだ文に重ならない）', !during.bar && u.bar && !u.below && u.barBottom <= u.selTop && !u.overlap, JSON.stringify({ during: during.bar, u }))
  check(
    '選んだ文のボタン：帯は「コピー」「切り取り」「削除」（読み上げの名前と、キーの押し方の説明付き）。左の道具に「選んだ文」（同じ3つ）',
    u.labels.join(',') === 'コピー|選んだ文をコピー（Ctrl+C）,切り取り|選んだ文を切り取る（Ctrl+X）。書く欄で貼り付けると、そこへ動きます,削除|選んだ文を削除（Delete）' &&
      u.group?.map((x) => x.split('|')[0]).join(',') === 'コピー,切り取り,削除' &&
      u.group[0].includes('Ctrl+C'),
    JSON.stringify({ labels: u.labels, group: u.group }),
  )

  // ---- 右クリックは、ブラウザのいつものメニュー（このツールのメニューは出さない） ----
  const context1 = await page.evaluate((x, y) => {
    let prevented = null
    const watch = (e) => setTimeout(() => (prevented = e.defaultPrevented))
    window.addEventListener('contextmenu', watch, { once: true })
    const target = document.elementFromPoint(x, y)
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }))
    return new Promise((r) => setTimeout(() => r({ prevented, menus: document.querySelectorAll('[role="menu"]').length }), 50))
  }, to.x, to.y)
  check('選んだ文のボタン：右クリックは、ブラウザのいつものメニューのまま（このツールのメニューは出さない）', context1.prevented === false && context1.menus === 0, JSON.stringify(context1))

  // ---- Esc で帯を隠す（選んだ文と、左の道具の「選んだ文」はそのまま） ----
  await page.keyboard.press('Escape')
  await wait(100)
  u = await ui()
  check('選んだ文のボタン：Esc で帯が隠れる（選んだ文と、左の道具の「選んだ文」はそのまま）', !u.bar && !!u.group, JSON.stringify(u))

  // ---- 帯の「コピー」：Ctrl+C と同じ文がクリップボードに入る ----
  await selectP3P4()
  await ctrl(page, 'c')
  await wait(100)
  const byKey = await page.evaluate(() => window.__copied.at(-1) ?? '')
  await page.evaluate(() => navigator.clipboard.writeText(''))
  await page.click('.range-bar button.copy')
  await wait(150)
  // パソコンのクリップボードは、改行を CR LF にして返すことがある（貼り付けるときは同じ文として扱う：rangeOps.ts の sameClipText）
  const lf = (t) => t.replace(/\r\n/g, '\n')
  const byBar = lf(await page.evaluate(() => navigator.clipboard.readText()))
  u = await ui()
  check('選んだ文のボタン：帯の「コピー」は、Ctrl+C と同じ文をクリップボードに入れる（選んだ文は外れない）', byBar === byKey && byKey.length > 20 && u.bar && (await state(page)).paperSelected, JSON.stringify({ same: byBar === byKey, byBar: byBar.slice(-30), byKey: byKey.slice(-30), bar: u.bar }))
  await page.evaluate(() => navigator.clipboard.writeText(''))
  await selectP3P4()
  await clickTool('.palette .sel-tools .tb', 'コピー')
  await wait(150)
  const byPalette = lf(await page.evaluate(() => navigator.clipboard.readText()))
  check('選んだ文のボタン：左の道具の「コピー」も、Ctrl+C と同じ文をクリップボードに入れる', byPalette === byKey, JSON.stringify({ byPalette: byPalette.slice(-30), byKey: byKey.slice(-30) }))

  // ---- 「切り取り」「削除」は、Ctrl+X・Delete と同じ（同じ知らせ。元に戻す1回で戻る） ----
  const runAndUndo = async (how) => {
    await selectP3P4()
    await how()
    await wait(300)
    const after = await state(page)
    await ready()
    await ctrl(page, 'z')
    await ready()
    return { body: after.body, notice: after.notice, undone: (await state(page)).body === original.body }
  }
  const cutKey = await runAndUndo(() => ctrl(page, 'x'))
  const cutBar = await runAndUndo(() => page.click('.range-bar button.cut'))
  const cutPalette = await runAndUndo(() => clickTool('.palette .sel-tools .tb', '切り取り'))
  check(
    '選んだ文のボタン：帯・左の道具の「切り取り」は、Ctrl+X と同じ（同じ原稿・「切り取りました［戻す］」・元に戻す1回で戻る）',
    cutBar.body === cutKey.body && cutPalette.body === cutKey.body && cutBar.notice === cutKey.notice && cutKey.notice.includes('切り取りました') && cutBar.undone && cutPalette.undone,
    JSON.stringify({ notice: cutBar.notice }),
  )
  const delKey = await runAndUndo(() => page.keyboard.press('Delete'))
  const delBar = await runAndUndo(() => page.click('.range-bar button.remove'))
  const delPalette = await runAndUndo(() => clickTool('.palette .sel-tools .tb', '削除'))
  check(
    '選んだ文のボタン：帯・左の道具の「削除」は、Delete と同じ（同じ原稿・「選んだ文を削除しました［戻す］」・元に戻す1回で戻る）',
    delBar.body === delKey.body && delPalette.body === delKey.body && delBar.notice === delKey.notice && delKey.notice.includes('選んだ文を削除しました') && delBar.undone && delPalette.undone,
    JSON.stringify({ notice: delBar.notice }),
  )

  // ---- 選ぶのをやめる（ふつうに押す）と、帯と「選んだ文」は消える ----
  await selectP3P4()
  const p13 = await (async () => {
    await showBlock(page, ready, 'p13')
    return charPoint(page, 'p13', 6)
  })()
  await page.mouse.click(p13.x, p13.y)
  await wait(300)
  u = await ui()
  check('選んだ文のボタン：選ぶのをやめると（ほかを押した・ページを替えた）、帯と左の道具の「選んだ文」は消える', !u.bar && !u.group, JSON.stringify(u))
  await page.keyboard.press('Escape')
  await ready()

  // ---- 貼り付け：コピーしたあと書く欄を開くと、カーソルの近くに「貼り付け」。押すと Ctrl+V と同じ ----
  const pasteBy = async (how) => {
    await selectP3P4()
    await ctrl(page, 'c')
    await wait(100)
    await showBlock(page, ready, 'p13')
    const at = await charPoint(page, 'p13', 6)
    await page.mouse.click(at.x, at.y)
    await wait(300)
    const before = await ui()
    if (how === 'chip') await page.screenshot({ path: `${SHOTS}/2-paste-chip.png` })
    if (how === 'key') await ctrl(page, 'v')
    else if (how === 'chip') await page.click('.range-chip')
    else await clickTool('.palette .group.ctx .tb', '貼り付け')
    await wait(300)
    const afterUi = await ui()
    await page.keyboard.press('Escape')
    await ready()
    // 貼り付けた図・段落の新しい ID（時刻から作る）は、比べるときに除く
    const body = (await state(page)).body.replace(/"(p|f|r|t|s|pb|row|cell)-[a-z0-9]+-\d+"/g, '"(新しいID)"')
    await ctrl(page, 'z')
    await ready()
    return { before, afterUi, body, undone: (await state(page)).body === original.body }
  }
  const pasteKey = await pasteBy('key')
  const pasteChip = await pasteBy('chip')
  const pastePalette = await pasteBy('palette')
  check(
    '選んだ文のボタン：コピーしたあと書く欄を開くと、カーソルの近くに「貼り付け」が出て、左の道具の「この段落」にも「貼り付け」が出る',
    pasteChip.before.chip && pasteChip.before.chipLabel?.includes('Ctrl+V') && pasteChip.before.pasteTool,
    JSON.stringify(pasteChip.before),
  )
  check(
    '選んだ文のボタン：書く欄の近くの「貼り付け」・左の道具の「貼り付け」は、Ctrl+V と同じ（同じ原稿・元に戻す1回で戻る）。使ったあとは、近くの「貼り付け」は消える',
    pasteChip.body === pasteKey.body && pastePalette.body === pasteKey.body && pasteChip.body !== original.body && pasteChip.undone && pastePalette.undone && !pasteChip.afterUi.chip,
    JSON.stringify({ chipAfter: pasteChip.afterUi.chip, chip: pasteChip.body === pasteKey.body, palette: pastePalette.body === pasteKey.body, changed: pasteChip.body !== original.body, undo: [pasteChip.undone, pastePalette.undone] }),
  )
  // 書き始めると、近くの「貼り付け」は消える。コピーしていなければ、左の道具に「貼り付け」は出ない
  await selectP3P4()
  await ctrl(page, 'c')
  await showBlock(page, ready, 'p14')
  const p14 = await charPoint(page, 'p14', 4)
  await page.mouse.click(p14.x, p14.y)
  await wait(300)
  const chipShown = (await ui()).chip
  await page.keyboard.type('あ')
  await wait(200)
  const chipAfterTyping = (await ui()).chip
  await page.keyboard.press('Escape')
  await ready()
  await ctrl(page, 'z')
  await ready()
  check('選んだ文のボタン：書く欄で書き始めると、近くの「貼り付け」は消える', chipShown && !chipAfterTyping, JSON.stringify({ chipShown, chipAfterTyping }))

  // ---- 拡大の表示：スクロールすると帯は隠れる。見えている所の上の端で選ぶと、帯は選んだ文の下に出る ----
  await page.evaluate(() => window.__editor.setView('zoom'))
  await ready()
  await showBlock(page, ready, 'p3')
  // ページのいちばん下までスクロールして、見えている所のいちばん上の行から選ぶ（帯は、上に入らない）
  const topLine = await page.evaluate(() => {
    const scroller = document.querySelector('.page-scroller')
    scroller.scrollTop = scroller.scrollHeight
    const s = scroller.getBoundingClientRect()
    const page = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current').getBoundingClientRect()
    // 見えている所の上の端から下へ、最初の文字の行
    for (let y = s.top + 2; y < s.top + 80; y += 2) {
      const pos = document.caretPositionFromPoint(page.left + page.width * 0.4, y)
      if (pos?.offsetNode?.nodeType === 3 && pos.offsetNode.parentElement.closest('p[data-block-id]')) {
        const r = document.createRange()
        r.setStart(pos.offsetNode, Math.min(pos.offset, pos.offsetNode.length - 1))
        r.setEnd(pos.offsetNode, Math.min(pos.offset + 1, pos.offsetNode.length))
        const b = r.getClientRects()[0]
        if (b && b.top >= s.top) return { x: b.left + 2, y: b.top + b.height / 2, end: { x: page.left + page.width * 0.6, y: b.top + 140 } }
      }
    }
    return null
  })
  await wait(300)
  await drag(page, topLine, topLine.end)
  await wait(150)
  u = await ui()
  await page.mouse.move(5, 5)
  await page.screenshot({ path: `${SHOTS}/3-bar-flipped-top.png` })
  check('選んだ文のボタン：拡大の表示で、見えている所の上の端で選ぶと、帯は選んだ文の最後の行のすぐ下に出る（選んだ文に重ならない）', u.bar && u.below && u.barTop >= u.selBottom && !u.overlap, JSON.stringify(u))
  await page.evaluate(() => {
    document.querySelector('.page-scroller').scrollTop -= 60
  })
  await wait(150)
  u = await ui()
  check('選んだ文のボタン：スクロールすると、帯は隠れる', !u.bar, JSON.stringify(u))
  // 見開き：右のページで選んでも出る
  await page.evaluate(() => window.__editor.setView('spread'))
  await ready()
  await showBlock(page, ready, 'p14')
  const spreadPage = await page.evaluate(() => ({ p13: window.__editor.pageOfBlock('p13'), p14: window.__editor.pageOfBlock('p14'), page: window.__editor.getSnapshot().page }))
  await drag(page, await charPoint(page, 'p14', 2), await charPoint(page, 'p15', 6))
  await wait(150)
  u = await ui()
  await page.mouse.move(5, 5)
  await page.screenshot({ path: `${SHOTS}/4-spread.png` })
  check('選んだ文のボタン：見開きでも、選んだ所のすぐ上に帯が出る', u.bar && !u.overlap && !!u.group, JSON.stringify({ spreadPage, u }))
  await page.evaluate(() => window.__editor.setView('fit'))
  await wait(200)
  u = await ui()
  check('選んだ文のボタン：表示の大きさを変えると、帯は隠れる', !u.bar, JSON.stringify(u))
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
  const st = await page.evaluate(() => ({ editing: window.__editor.getSnapshot().editingId, sheet: window.__editor.getSnapshot().sheet, paper: window.__editor.hasPaperSelection(), bar: !document.querySelector('.range-bar')?.hidden, chip: !document.querySelector('.range-chip')?.hidden }))
  check('段落を選ぶ（スマホ）：指で押すと、今までどおり書く欄が開く（紙面で選ぶ仕組みは使わない。選んだ文の帯・「貼り付け」も出さない）', st.editing === 'p3' && st.sheet && !st.paper && !st.bar && !st.chip, JSON.stringify(st))
  await context.close()
  await abstractPastePhone(browser, check)
}

// ---- 本文から抄録への貼り付け（依頼者の指摘「本文をコピーして抄録に貼り付けると、うまくいかない」・決まり「抄録には図表を入れない」2026-10-20）。画面の写真は poc-output/abstract-paste/ ----

const PASTE_SHOTS = 'poc-output/abstract-paste'

/** 抄録の段落（ID と文字）・書いている欄・画面の下の知らせ（行ごとの字の数も。1字だけの行がないか見る） */
const abstractState = (page) =>
  page.evaluate(async () => {
    const ops = await window.__import('editor/reportOps.ts')
    const s = window.__editor.getSnapshot()
    const num = ops.numbering(s.report)
    const info = document.querySelector('.undo-toast .undo-info')
    const lines = new Map()
    if (info) {
      const w = document.createTreeWalker(info, NodeFilter.SHOW_TEXT)
      while (w.nextNode()) {
        const t = w.currentNode
        for (let i = 0; i < t.length; i++) {
          const r = document.createRange()
          r.setStart(t, i)
          r.setEnd(t, i + 1)
          const b = r.getClientRects()[0]
          if (b) lines.set(Math.round(b.top), (lines.get(Math.round(b.top)) ?? 0) + 1)
        }
      }
    }
    return {
      started: s.report.abstract.started !== false,
      paragraphs: s.report.abstract.paragraphs.map((p) => ({ id: p.id, text: ops.contentToText(p.content, num) })),
      editing: s.editingId,
      caret: s.caret,
      notice: info?.textContent ?? document.querySelector('.undo-toast')?.textContent ?? '',
      noticeLines: [...lines.values()],
      findings: s.findings.filter((f) => f.ruleId === 'abstract-figure-ref').map((f) => f.detail),
    }
  })

/** 知らせの行に、1字だけの行がない */
const noWidow = (st) => st.noticeLines.length > 0 && st.noticeLines.every((n) => n >= 2)

export async function abstractPastePc(browser, check) {
  mkdirSync(PASTE_SHOTS, { recursive: true })
  const { context, page, ready } = await openSample(browser, { viewport: { width: 1366, height: 768 } })
  const original = await state(page)
  const textOf = (id) => blockIn(original, id)?.text ?? ''
  const before = await abstractState(page)
  const abstractOf = (st, id) => st.paragraphs.find((p) => p.id === id)?.text
  const a2 = abstractOf(before, 'a2')

  // ---- 本文の段落の途中から、図1を通って次の段落の途中までを選んで Ctrl+C。抄録の段落の途中を押して Ctrl+V ----
  await showBlock(page, ready, 'p3')
  await drag(page, await charPoint(page, 'p3', 5), await charPoint(page, 'p4', 10))
  await ctrl(page, 'c')
  await wait(150)
  await showBlock(page, ready, 'a2')
  const at = await charPoint(page, 'a2', 10)
  await page.mouse.click(at.x, at.y)
  await wait(400)
  await ctrl(page, 'v')
  await wait(500)
  await ready()
  await wait(300)
  let st = await abstractState(page)
  await page.screenshot({ path: `${PASTE_SHOTS}/1-pc-paste-clip.png` })
  const pasted = textOf('p3').slice(5).replace('（図1）', '')
  const ids = st.paragraphs.map((p) => p.id)
  const added = st.paragraphs[ids.indexOf('a2') + 1]
  check(
    '抄録に貼り付け：本文を選んで Ctrl+C、抄録の段落の途中で Ctrl+V。押した所で段落を分けて文が入り、図は入らず、「（図1）」は除く（「。」は残り、空白は入らない）',
    abstractOf(st, 'a2') === a2.slice(0, 10) + pasted && added?.text === textOf('p4').slice(0, 10) + a2.slice(10) && !st.paragraphs.some((p) => /[図表][0-9０-９]|[ 　]/.test(p.text)) && st.paragraphs.length === before.paragraphs.length + 1,
    JSON.stringify({ a2: abstractOf(st, 'a2')?.slice(0, 60), added: added?.text.slice(0, 30), count: st.paragraphs.length }),
  )
  check('抄録に貼り付け：貼り付けたあと、書く欄は貼り付けた文の終わりで開いたまま', st.editing === added?.id && st.caret === 10, JSON.stringify({ editing: st.editing, caret: st.caret }))
  check(
    '抄録に貼り付け：画面の下に「抄録には文だけを貼り付けました（見出し・図・表と「（図1）」は除きました）」と出る（1字だけの行はない）',
    st.notice === '抄録には文だけを貼り付けました（見出し・図・表と「（図1）」は除きました）' && noWidow(st),
    JSON.stringify({ notice: st.notice, lines: st.noticeLines }),
  )
  await page.keyboard.press('Escape')
  await ready()
  await ctrl(page, 'z')
  await wait(400)
  await ready()
  st = await abstractState(page)
  check('抄録に貼り付け：元に戻すで、貼り付ける前の抄録に戻る', JSON.stringify(st.paragraphs) === JSON.stringify(before.paragraphs), JSON.stringify(st.paragraphs.map((p) => p.id)))
  await page.evaluate(() => window.__editor.finishEditing())
  await wait(300)
  await ready()

  // ---- 文の中の参照（「表1に使用した素材をまとめる。」）は残して、書き直してもらう（知らせ・セルフチェックの要確認） ----
  await showBlock(page, ready, 'p5')
  const p5 = textOf('p5')
  await drag(page, await charPoint(page, 'p5', 0), await charPoint(page, 'p5', p5.length - 1))
  await page.keyboard.down('Shift')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.up('Shift')
  await ctrl(page, 'c')
  await wait(150)
  await showBlock(page, ready, 'a4')
  await page.evaluate(() => window.__editor.openEditor('a4', 0))
  await wait(400)
  await ctrl(page, 'v')
  await wait(500)
  await ready()
  await wait(300)
  st = await abstractState(page)
  await page.screenshot({ path: `${PASTE_SHOTS}/2-pc-in-sentence-ref.png` })
  check(
    '抄録に貼り付け：文の中の「表1」は残し、「抄録には図表を入れません。「表1」の入った文を書き直してください」と知らせる（セルフチェックにも要確認で出る）',
    st.paragraphs.some((p) => p.text.startsWith(p5)) &&
      st.notice === '抄録には図表を入れません。「表1」の入った文を書き直してください' &&
      noWidow(st) &&
      st.findings.includes('抄録には図表を入れません。「表1」の入った文を書き直してください'),
    JSON.stringify({ notice: st.notice, lines: st.noticeLines, findings: st.findings }),
  )
  await page.keyboard.press('Escape')
  await ready()
  await ctrl(page, 'z')
  await wait(400)
  await ready()
  check('抄録に貼り付け：元に戻すで、貼り付ける前の抄録に戻る（2回目）', JSON.stringify((await abstractState(page)).paragraphs) === JSON.stringify(before.paragraphs))

  // ---- ほかのアプリなどからコピーした、ふつうの文字（1行・何行か）：「（図1）」「(図2)」を除く ----
  await page.evaluate(() => navigator.clipboard.writeText('袖を作った（図1）。帯も作った(図2)。'))
  const a4 = abstractOf(before, 'a4')
  await page.evaluate((n) => window.__editor.openEditor('a4', n), a4.length)
  await wait(400)
  await ctrl(page, 'v')
  await wait(300)
  await page.evaluate(() => window.__editor.finishEditing())
  await wait(400)
  await ready()
  st = await abstractState(page)
  const oneLine = abstractOf(st, 'a4')
  const oneNotice = st.notice
  const oneLines = st.noticeLines
  await page.evaluate(() => navigator.clipboard.writeText('袖を作った（図１・図２）。\r\n帯は表1の布で作った（表1）。'))
  await page.evaluate((n) => window.__editor.openEditor('a4', n), oneLine.length)
  await wait(400)
  await ctrl(page, 'v')
  await wait(500)
  await ready()
  await page.evaluate(() => window.__editor.finishEditing())
  await wait(400)
  await ready()
  st = await abstractState(page)
  const i4 = st.paragraphs.findIndex((p) => p.id === 'a4')
  const lastTwo = st.paragraphs.slice(i4, i4 + 2).map((p) => p.text)
  check(
    '抄録に貼り付け：ふつうの文字の「（図1）」「(図2)」「（図１・図２）」「（表1）」も除く（1行・何行か）。文の中の「表1」は残して知らせる',
    oneLine === `${a4}袖を作った。帯も作った。` &&
      oneNotice === '抄録には図表を入れないので、「（図1）」を除いて貼り付けました' &&
      oneLines.every((n) => n >= 2) &&
      lastTwo[0] === `${oneLine}袖を作った。` &&
      lastTwo[1] === '帯は表1の布で作った。' &&
      st.notice === '抄録には図表を入れません。「表1」の入った文を書き直してください',
    JSON.stringify({ oneLine: oneLine.slice(-16), oneNotice, lastTwo: lastTwo.map((t) => t.slice(-14)), notice: st.notice }),
  )
  await page.screenshot({ path: `${PASTE_SHOTS}/3-pc-plain-text.png` })

  // ---- 抄録を書き始める前（「先生の許可が出た」の前）：Ctrl+V では何も入らないので、わけを知らせる。押したあとの空の段落には入る ----
  await page.evaluate(async () => {
    const { emptyParagraph } = await window.__import('model/template.ts')
    window.__editor.replace({ ...window.__editor.getSnapshot().report, abstract: { started: false, paragraphs: [emptyParagraph('抄録の書き出しの例')] } })
  })
  await wait(300)
  await ready()
  await showBlock(page, ready, 'p3')
  await drag(page, await charPoint(page, 'p3', 5), await charPoint(page, 'p4', 10))
  await ctrl(page, 'c')
  await wait(150)
  await page.evaluate(() => window.__editor.goToPage(1, 'none'))
  await ready()
  await wait(200)
  await ctrl(page, 'v')
  await wait(300)
  const locked = await abstractState(page)
  await page.screenshot({ path: `${PASTE_SHOTS}/4-pc-not-started.png` })
  const button = await page.evaluate(() => {
    const b = document.querySelector('.page-viewport.front [data-abstract-start]').getBoundingClientRect()
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
  })
  await page.mouse.click(button.x, button.y)
  await wait(300)
  await ready()
  await wait(200)
  const empty = (await abstractState(page)).paragraphs[0]
  const box = await page.evaluate((id) => {
    const b = document.querySelector(`.page-viewport.front [data-block-id="${id}"]`).getBoundingClientRect()
    return { x: b.left + 30, y: b.top + b.height / 2 }
  }, empty.id)
  await page.mouse.click(box.x, box.y)
  await wait(400)
  await ctrl(page, 'v')
  await wait(500)
  await ready()
  await wait(300)
  st = await abstractState(page)
  await page.screenshot({ path: `${PASTE_SHOTS}/5-pc-empty-abstract.png` })
  check(
    '抄録に貼り付け：書き始める前に Ctrl+V を押すと「抄録は「先生の許可が出た」を押してから書きます」と出る。押したあとの空の段落には、文だけが入る（「（図1）」なし）',
    !locked.started &&
      locked.notice === '抄録は「先生の許可が出た」を押してから書きます' &&
      noWidow(locked) &&
      st.started &&
      st.paragraphs.map((p) => p.text).join('|') === `${textOf('p3').slice(5).replace('（図1）', '')}|${textOf('p4').slice(0, 10)}`,
    JSON.stringify({ locked: locked.notice, lines: locked.noticeLines, paragraphs: st.paragraphs.map((p) => p.text.slice(0, 20)) }),
  )
  await context.close()
}

/** スマホ：書く欄の文をコピーして（ふつうのコピー）、抄録の段落に貼り付けると、「（図1）」を除いて入る */
async function abstractPastePhone(browser, check) {
  mkdirSync(PASTE_SHOTS, { recursive: true })
  const { context, page, ready } = await openSample(browser, { phone: true })
  const original = await state(page)
  const p3 = blockIn(original, 'p3')?.text ?? ''
  await page.evaluate(() => window.__editor.openEditor('p3', 0))
  await wait(600)
  await page.evaluate(() => getSelection().selectAllChildren(document.querySelector('.overlay-editor')))
  await ctrl(page, 'c')
  await wait(150)
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  await page.evaluate(() => window.__editor.finishEditing())
  await wait(400)
  await ready()
  const a2 = (await abstractState(page)).paragraphs.find((p) => p.id === 'a2').text
  await page.evaluate(() => window.__editor.openEditor('a2', 10))
  await wait(600)
  await ctrl(page, 'v')
  await wait(400)
  const shown = await abstractState(page)
  const notice = shown.notice
  await page.screenshot({ path: `${PASTE_SHOTS}/6-phone-paste.png` })
  await page.evaluate(() => window.__editor.finishEditing())
  await wait(400)
  await ready()
  const st = await abstractState(page)
  check(
    '抄録に貼り付け（スマホ）：書く欄でコピーした文を抄録の段落に貼り付けると、「（図1）」を除いて入り、知らせが出る',
    copied.includes('（図1）') && st.paragraphs.find((p) => p.id === 'a2')?.text === a2.slice(0, 10) + p3.replace('（図1）', '') + a2.slice(10) && notice === '抄録には図表を入れないので、「（図1）」を除いて貼り付けました' && noWidow(shown),
    JSON.stringify({ copied: copied.slice(0, 20), a2: st.paragraphs.find((p) => p.id === 'a2')?.text.slice(0, 50), notice, lines: shown.noticeLines }),
  )
  await context.close()
}

// これだけを動かす：node scripts/e2e/rangeSelect.mjs（文の終わりの「。」だけ：… period。抄録への貼り付けだけ：… abstract）
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { withEdge } = await import('../poc/edge.mjs')
  const results = []
  const check = (name, ok, detail = '') => {
    results.push(ok)
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
  }
  await withEdge(async (browser) => {
    // node scripts/e2e/rangeSelect.mjs period：文の終わりの「。」を選ぶところだけ
    if (process.argv[2] === 'period') return periodSelectPc(browser, check)
    // node scripts/e2e/rangeSelect.mjs abstract：本文から抄録への貼り付けだけ
    if (process.argv[2] === 'abstract') {
      await abstractPastePc(browser, check)
      return abstractPastePhone(browser, check)
    }
    await rangeSelectPc(browser, check)
    await rangeSelectPhone(browser, check)
  })
  const failed = results.filter((ok) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} 件 合格`)
  process.exitCode = failed ? 1 : 0
}
