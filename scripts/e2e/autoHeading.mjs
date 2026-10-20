// 段落に打った見出しを確かめる（Edge を自動で操作する。パソコン・スマホ）。
// 依頼者の願い：段落に「Ⅲ．まとめ」のように見出しの形で打ったら、道具の「大見出し」「小見出し」を押さなくても見出しになる（2026-10-19）。
// - Enter：打った行が見出しの形なら、大見出し（章を分ける）・小見出しになり、すぐ後ろの新しい段落で書き続ける。番号は自動。「。」は付かない
// - 書く欄を閉じたとき（Esc・ほかを押した・スマホの「完了」）も、段落ごと見出しの形なら見出しになる
// - 画面の下に「大見出し「Ⅲ．まとめ」にしました［戻す］」。「戻す」・Ctrl+Z・道具の「元に戻す」で、打ったままの段落に戻る（同じ文では、もう見出しにしない）
// - 何行かの文を貼り付けたときも、見出しの形の行は見出しになる（「見出しに2つしました」）
// - 算用数字の形（「1．」）・抄録・日本語の変換を確定する Enter では、見出しにしない
// smoke.mjs から autoHeadingPc、phone.mjs から autoHeadingPhone を呼ぶ。これだけを動かすときは node scripts/e2e/autoHeading.mjs。
// 画面の写真は poc-output/auto-heading/ に置く
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { stubConfig } from './configStub.mjs'
import { setupWriting } from './sampleReport.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/auto-heading'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** 新しい入れ物で開き、はじめての案内を「あとで」で閉じて、見本の原稿にする */
async function openSample(browser, { phone }) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror(autoHeading):', e.message))
  await page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  })
  await stubConfig(page)
  if (phone) {
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  } else {
    await page.setViewport({ width: 1366, height: 768 })
  }
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

/** 原稿の本文のようす：章ごとの「題:ブロックの ID…」、段落の文字、書いている欄 */
const state = (page) =>
  page.evaluate(() => {
    const s = window.__editor.getSnapshot()
    const text = (b) => (b.type === 'paragraph' ? b.content.map((n) => (n.type === 'text' ? n.text : '〔参照〕')).join('') : b.type === 'subheading' ? `【${b.title}】` : `<${b.type}>`)
    return {
      chapters: s.report.body.map((c) => c.title),
      blocks: s.report.body.map((c) => c.blocks.map((b) => b.id)),
      texts: s.report.body.map((c) => c.blocks.map(text)),
      abstract: s.report.abstract.paragraphs.map((p) => p.content.map((n) => n.text ?? '').join('')),
      editing: s.editingId,
      canUndo: s.canUndo,
    }
  })
/** 画面の下の知らせの言葉（出ていなければ空。「戻す」の文字も入る） */
const toast = (page) => page.evaluate(() => document.querySelector('.undo-area .undo-toast')?.textContent ?? '')
/** 紙面の見出し（番号と名前。組み直した紙面） */
const paperHeadings = (page) =>
  page.evaluate(() => {
    const ed = window.__editor
    ed.renderer.viewport.classList.add('measuring')
    const hs = [...ed.renderer.viewport.querySelectorAll('section.body :is(h1, h2)')].map((h) => `${h.localName}:${h.textContent}`)
    ed.renderer.viewport.classList.remove('measuring')
    return hs
  })
/** 段落 id を、終わりにカーソルを置いて書き始める（そのページへ移ってから） */
const openAtEnd = async (page, ready, id) => {
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), id)
  await ready()
  await page.evaluate((id) => {
    const ed = window.__editor
    const p = ed.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === id) ?? ed.getSnapshot().report.abstract.paragraphs.find((b) => b.id === id)
    ed.openEditor(id, p.content.map((n) => n.text ?? '（図1）').join('').length)
  }, id)
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 30000 }, id)
}
/** Enter を押して、新しい段落を書き始めるまで待つ */
const enterNew = async (page, from) => {
  await page.keyboard.press('Enter')
  await page.waitForFunction((from) => { const e = window.__editor.getSnapshot().editingId; return !!e && e !== from }, { timeout: 30000 }, from)
}
/** 書く欄に貼り付ける（クリップボードの中身：text/plain と、あれば text/html） */
const paste = (page, plain, html) =>
  page.evaluate(
    (plain, html) => {
      const el = document.querySelector('.overlay-clip:not([hidden]) .overlay-editor, .edit-sheet .overlay-editor')
      const dt = new DataTransfer()
      dt.setData('text/plain', plain)
      if (html) dt.setData('text/html', html)
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    },
    plain,
    html,
  )
const ctrl = async (page, key) => {
  await page.keyboard.down('Control')
  await page.keyboard.press(key)
  await page.keyboard.up('Control')
}
/** 見本の原稿に戻す（元に戻す履歴も、はじめから） */
const resetSample = async (page, ready) => {
  await page.keyboard.press('Escape')
  await page.evaluate(() => window.__editor.finishEditing())
  await page.evaluate(setupWriting)
  await wait(200)
  await ready()
}

export async function autoHeadingPc(browser, check) {
  const { context, page, ready } = await openSample(browser, { phone: false })
  const cdp = await page.createCDPSession()

  // ---- 大見出し：p8（図3 の上の段落）の終わりで Enter → 新しい段落に「Ⅴ．仕上げと確認」と打って Enter ----
  await openAtEnd(page, ready, 'p8')
  await enterNew(page, 'p8')
  await ready()
  const typedId = (await state(page)).editing
  await page.keyboard.type('Ⅴ．仕上げと確認')
  await wait(200)
  await page.screenshot({ path: `${OUT}/pc-1-before-enter.png` })
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__editor.getSnapshot().report.body.length === 4, { timeout: 30000 })
  const right = await state(page)
  const rightToast = await toast(page)
  await ready()
  await wait(300)
  const shownToast = await toast(page)
  const heads = await paperHeadings(page)
  await page.screenshot({ path: `${OUT}/pc-2-after-enter.png` })
  check(
    '見出しの形で打って Enter：大見出し「Ⅲ．仕上げと確認」になり（打った「Ⅴ」ではなく自動の番号）、同じ章の後ろの段落・小見出しが新しい章に入る',
    JSON.stringify(right.chapters) === JSON.stringify(['企画・立案', '制作過程', '仕上げと確認', 'まとめ']) &&
      right.blocks[1].at(-1) === 'r3' &&
      JSON.stringify(right.blocks[2].slice(1)) === JSON.stringify(['p9', 'p10', 's6', 'p11', 'p12', 's7', 'p13']) &&
      heads.includes('h1:Ⅲ．仕上げと確認') &&
      heads.includes('h1:Ⅳ．まとめ'),
    JSON.stringify({ chapters: right.chapters, c2: right.blocks[1].slice(-2), c3: right.blocks[2], heads: heads.filter((h) => h.startsWith('h1')) }),
  )
  check(
    'Enter のあとは、見出しのすぐ後ろの新しい空の段落で書き続け、「。」はどこにも付かない（打った段落は無くなる）',
    right.editing === right.blocks[2][0] && right.texts[2][0] === '' && right.editing !== typedId && !right.texts.flat().some((t) => t.includes('仕上げと確認')),
    JSON.stringify({ editing: right.editing, first: right.texts[2][0] }),
  )
  check(
    '画面の下に「大見出し「Ⅲ．仕上げと確認」にしました［戻す］」が出る（書いている間も。組み直したあとも出ている）',
    rightToast.startsWith('大見出し「Ⅲ．仕上げと確認」にしました') && rightToast.includes('戻す') && shownToast === rightToast,
    JSON.stringify({ rightToast, shownToast }),
  )

  // ---- 「戻す」：打ったままの段落に戻る（1回で） ----
  await page.click('.undo-area .undo-toast button')
  await page.waitForFunction(() => window.__editor.getSnapshot().report.body.length === 3, { timeout: 30000 })
  const undone = await state(page)
  const undoneToast = await toast(page)
  await ready()
  await wait(200)
  await page.screenshot({ path: `${OUT}/pc-3-after-undo.png` })
  const i = undone.blocks[1].indexOf('r3')
  check(
    '「戻す」で、打ったままの段落「Ⅴ．仕上げと確認」に戻る（図3の下、p9 の前。分けた章も元の1つに戻る）。知らせは「見出しにする前に戻しました」',
    undone.blocks[1][i + 1] === typedId && undone.texts[1][i + 1] === 'Ⅴ．仕上げと確認' && undone.blocks[1][i + 2] === 'p9' && undoneToast.includes('見出しにする前に戻しました'),
    JSON.stringify({ after: undone.texts[1].slice(i, i + 3), undoneToast }),
  )
  // 戻した段落で、同じ文のまま Enter を押しても、もう見出しにしない（ふつうに段落を分ける）
  await openAtEnd(page, ready, typedId)
  await enterNew(page, typedId)
  const again = await state(page)
  check('「戻す」で戻した段落は、同じ文のまま Enter を押しても、もう見出しにしない（ふつうに段落を分ける）', again.chapters.length === 3 && again.texts[1].includes('Ⅴ．仕上げと確認。'), JSON.stringify(again.chapters))
  await resetSample(page, ready)

  // ---- Ctrl+Z（書く欄の中）と、道具の「元に戻す」も同じ ----
  const convert = async (from, typed) => {
    await openAtEnd(page, ready, from)
    await enterNew(page, from)
    await page.keyboard.type(typed)
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.__editor.getSnapshot().report.body.length === 4, { timeout: 30000 })
  }
  await convert('p8', 'Ⅴ．仕上げと確認')
  await ctrl(page, 'z')
  await page.waitForFunction(() => window.__editor.getSnapshot().report.body.length === 3, { timeout: 30000 }).catch(() => {})
  const byCtrl = await state(page)
  await ready()
  await convert('p8', 'Ⅲ．仕上げと確認')
  await ready()
  await page.evaluate(() => [...document.querySelectorAll('.palette button')].find((b) => b.getAttribute('aria-label')?.startsWith('元に戻す')).click())
  await page.waitForFunction(() => window.__editor.getSnapshot().report.body.length === 3, { timeout: 30000 }).catch(() => {})
  const byPalette = await state(page)
  check(
    '見出しにした直後の Ctrl+Z（書く欄の中）と、道具の「元に戻す」も、打ったままの段落に戻す',
    byCtrl.chapters.length === 3 && byCtrl.texts[1].includes('Ⅴ．仕上げと確認') && byPalette.chapters.length === 3 && byPalette.texts[1].includes('Ⅲ．仕上げと確認'),
    JSON.stringify({ byCtrl: byCtrl.chapters, byPalette: byPalette.chapters }),
  )
  await resetSample(page, ready)

  // ---- 小見出し：p7 の終わりで Enter → 「ⅳ．採寸」 Enter（制作過程の2つ目の小見出しになる） ----
  await openAtEnd(page, ready, 'p7')
  await enterNew(page, 'p7')
  await page.keyboard.type('ⅳ．採寸')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__editor.getSnapshot().report.body[1].blocks.some((b) => b.type === 'subheading' && b.title === '採寸'), { timeout: 30000 })
  const sub = await state(page)
  const subToast = await toast(page)
  await ready()
  const subHeads = await paperHeadings(page)
  const at = sub.texts[1].indexOf('【採寸】')
  check(
    '「ⅳ．採寸」で Enter：その位置に小見出し「ⅱ．採寸」（章の中の自動の番号）。すぐ後ろの空の段落で書き続け、後ろの小見出しの番号は1つずつ下がる',
    at === 3 && sub.texts[1][at + 1] === '' && sub.blocks[1][at + 1] === sub.editing && sub.blocks[1][at + 2] === 's5' && subHeads.includes('h2:ⅱ．採寸') && subHeads.includes('h2:ⅲ．袖の刺繍') && subToast.startsWith('小見出し「ⅱ．採寸」にしました'),
    JSON.stringify({ c2: sub.texts[1].slice(0, 6), subToast, subHeads: subHeads.filter((h) => h.startsWith('h2')).slice(3, 7) }),
  )

  // ---- 書く欄を閉じたとき（Esc）：段落ごと見出しの形なら見出しになる ----
  await page.keyboard.type('ⅰ．袖口の始末')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => window.__editor.getSnapshot().report.body[1].blocks.some((b) => b.type === 'subheading' && b.title === '袖口の始末'), { timeout: 30000 }).catch(() => {})
  const closed = await state(page)
  const closedToast = await toast(page)
  await ready()
  await wait(200)
  await page.screenshot({ path: `${OUT}/pc-4-after-esc.png` })
  const c = closed.texts[1].indexOf('【袖口の始末】')
  check(
    '書く欄に「ⅰ．袖口の始末」と打って Esc：その段落が小見出し「ⅲ．袖口の始末」になる（後ろに段落は作らない）。書く欄は閉じ、知らせが出る',
    c === at + 1 && closed.blocks[1][c + 1] === 's5' && closed.editing === null && closedToast.startsWith('小見出し「ⅲ．袖口の始末」にしました'),
    JSON.stringify({ c2: closed.texts[1].slice(2, 7), closedToast, editing: closed.editing }),
  )

  // ---- 書く欄を閉じたとき（ほかを押した）：大見出しになる。紙面のほかの段落を押して閉じる ----
  await openAtEnd(page, ready, 'p16')
  await enterNew(page, 'p16')
  await ready()
  await page.keyboard.type('Ⅳ．謝辞')
  const p16 = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.page-viewport.front [data-block-id="p16"]')].find((e) => e.getBoundingClientRect().width > 0)
    const r = el.getBoundingClientRect()
    return { x: r.left + 30, y: r.top + 6 }
  })
  await page.mouse.click(p16.x, p16.y)
  await page.waitForFunction(() => window.__editor.getSnapshot().report.body.length === 4, { timeout: 30000 }).catch(() => {})
  const clicked = await state(page)
  const clickedToast = await toast(page)
  await ready()
  check(
    '書く欄に「Ⅳ．謝辞」と打って、紙面のほかの段落を押す：大見出し「Ⅳ．謝辞」になり、押した段落を書き始める（知らせは書いている間も出る）',
    JSON.stringify(clicked.chapters) === JSON.stringify(['企画・立案', '制作過程', 'まとめ', '謝辞']) && clicked.blocks[3].length === 0 && clicked.editing === 'p16' && clickedToast.startsWith('大見出し「Ⅳ．謝辞」にしました'),
    JSON.stringify({ chapters: clicked.chapters, editing: clicked.editing, clickedToast }),
  )
  // 開いて閉じただけ（書き換えていない）なら、見出しの形でもそのまま：「戻す」で段落に戻し、開いて Esc
  await page.keyboard.press('Escape')
  await wait(200)
  await ready()
  await page.evaluate(() => window.__editor.undo())
  await ready()
  const back = (await state(page)).blocks[2].at(-1)
  await openAtEnd(page, ready, back)
  await page.keyboard.press('Escape')
  await wait(300)
  await ready()
  check('見出しの形の段落でも、開いて書き換えずに閉じただけなら、見出しにしない', (await state(page)).chapters.length === 3)
  await resetSample(page, ready)

  // ---- 算用数字の形（「1．」）は見出しにしない ----
  await openAtEnd(page, ready, 'p14')
  await enterNew(page, 'p14')
  await page.keyboard.type('1．はじめに')
  await page.keyboard.press('Enter')
  await wait(300)
  const arabic = await state(page)
  check('「1．はじめに」で Enter：見出しにしない（ふつうに段落を分ける。今までどおり「。」が付く）', arabic.chapters.length === 3 && arabic.texts[2].includes('1．はじめに。') && !arabic.texts[2].some((t) => t.startsWith('【')), JSON.stringify(arabic.texts[2]))
  // 番号だけ（名前がない）も見出しにしない
  await page.keyboard.type('Ⅲ．')
  await page.keyboard.press('Escape')
  await wait(300)
  await ready()
  check('「Ⅲ．」だけ（名前がない）で閉じても、見出しにしない', (await state(page)).chapters.length === 3 && (await state(page)).texts[2].includes('Ⅲ．'))
  await resetSample(page, ready)

  // ---- 日本語の変換を確定する Enter では、見出しにしない（確定したあとの Enter で見出しにする） ----
  await openAtEnd(page, ready, 'p14')
  await enterNew(page, 'p14')
  const imeId = (await state(page)).editing
  await page.keyboard.type('Ⅲ．')
  await cdp.send('Input.imeSetComposition', { text: 'まとめ', selectionStart: 3, selectionEnd: 3 })
  await page.waitForFunction(() => window.__editor.overlay.composing, { timeout: 30000 }).catch(() => {})
  // 変換を確定する Enter（変換中なので、キーの番号は 229）。そのあと変換を確定する
  await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 })
  await cdp.send('Input.insertText', { text: 'まとめ' })
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  await page.waitForFunction(() => !window.__editor.overlay.composing && window.__editor.overlay.text === 'Ⅲ．まとめ', { timeout: 30000 }).catch(() => {})
  const composing = await state(page)
  // 変換が終わっていなければ、終わったことにする（このあとの確かめに残さない）
  await page.evaluate(() => window.__editor.overlay.composing && document.querySelector('.overlay-editor').dispatchEvent(new CompositionEvent('compositionend', { data: '' })))
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__editor.getSnapshot().report.body.length === 4, { timeout: 30000 }).catch(() => {})
  const composed = await state(page)
  check(
    '日本語の変換を確定する Enter では何もせず（まだ段落）、確定したあとの Enter で大見出し「Ⅳ．まとめ」になる',
    composing.chapters.length === 3 && composing.editing === imeId && composed.chapters.length === 4 && composed.chapters[3] === 'まとめ',
    JSON.stringify({ composing: composing.chapters.length, editing: composing.editing === imeId, composed: composed.chapters }),
  )
  await resetSample(page, ready)

  // ---- 何行かの文を貼り付ける：見出しの形の行は見出しになる（Word から読み込むときと同じ） ----
  await openAtEnd(page, ready, 'p13')
  await enterNew(page, 'p13')
  await paste(page, 'Ⅲ．仕上げ\n最後に全体を整えた。\nⅰ．アイロン\n当て布をしてアイロンをかけた。')
  await page.waitForFunction(() => window.__editor.getSnapshot().report.body.length === 4, { timeout: 30000 }).catch(() => {})
  const pasted = await state(page)
  const pastedToast = await toast(page)
  await ready()
  await wait(200)
  await page.screenshot({ path: `${OUT}/pc-5-after-paste.png` })
  check(
    '何行かの文を貼り付けると、「Ⅲ．」の行は大見出し、「ⅰ．」の行は小見出しになり、ほかの行は段落。知らせは「見出しに2つしました［戻す］」',
    JSON.stringify(pasted.chapters) === JSON.stringify(['企画・立案', '制作過程', '仕上げ', 'まとめ']) &&
      JSON.stringify(pasted.texts[2]) === JSON.stringify(['最後に全体を整えた。', '【アイロン】', '当て布をしてアイロンをかけた。']) &&
      pasted.blocks[1].at(-1) === 'p13' &&
      pastedToast.startsWith('見出しに2つしました') &&
      pastedToast.includes('戻す'),
    JSON.stringify({ chapters: pasted.chapters, c3: pasted.texts[2], pastedToast }),
  )
  await page.click('.undo-area .undo-toast button')
  await page.waitForFunction(() => window.__editor.getSnapshot().report.body.length === 3, { timeout: 30000 }).catch(() => {})
  const plain = await state(page)
  check('貼り付けて見出しにしたのを「戻す」と、行ごとの段落に戻る（貼り付けた文は残る）', plain.chapters.length === 3 && ['Ⅲ．仕上げ', 'ⅰ．アイロン', '最後に全体を整えた。'].every((t) => plain.texts[1].includes(t)), JSON.stringify(plain.texts[1].slice(-4)))
  await ready()
  // 表を含む貼り付け：表の知らせは、見出しの知らせに添える
  await resetSample(page, ready)
  await openAtEnd(page, ready, 'p13')
  await enterNew(page, 'p13')
  await paste(page, 'Ⅲ．仕上げ\n素材\t量\nⅰ．アイロン', '<table><tr><td>素材</td><td>量</td></tr></table>')
  await wait(300)
  const tableToast = await toast(page)
  check('表を含む文を貼り付けたときは「見出しに2つしました。表は文になりました（表は「表を入れる」で作ります）［戻す］」', tableToast.startsWith('見出しに2つしました。表は文になりました（表は「表を入れる」で作ります）') && tableToast.includes('戻す'), tableToast)
  await resetSample(page, ready)

  // ---- 抄録では見出しにしない（Enter でも、貼り付けでも） ----
  await openAtEnd(page, ready, 'a4')
  await enterNew(page, 'a4')
  await page.keyboard.type('Ⅲ．まとめ')
  await page.keyboard.press('Enter')
  await wait(300)
  await paste(page, 'Ⅰ．企画\n本文の文。')
  await wait(300)
  await page.keyboard.press('Escape')
  await ready()
  const abs = await state(page)
  check('抄録に「Ⅲ．まとめ」と打って Enter・何行かを貼り付けても、見出しにしない（本文の章も変わらない）', abs.chapters.length === 3 && abs.abstract.includes('Ⅲ．まとめ。') && abs.abstract.includes('Ⅰ．企画') && !(await toast(page)).includes('見出し'), JSON.stringify(abs.abstract.slice(3)))

  await context.close()
}

export async function autoHeadingPhone(browser, check) {
  const { context, page, ready } = await openSample(browser, { phone: true })
  // p13（制作過程の最後の段落）をタップして、終わりで Enter → 「ⅲ．試着」 Enter
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('p13'), 'none'))
  await ready()
  const p13 = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.page-viewport.front [data-block-id="p13"]')].find((e) => e.getBoundingClientRect().width > 0)
    const r = el.getBoundingClientRect()
    return { x: r.left + 20, y: r.top + 4 }
  })
  await page.touchscreen.tap(p13.x, p13.y)
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p13', { timeout: 30000 })
  await page.evaluate(() => window.__editor.overlay.setCaret(window.__editor.overlay.text.length))
  await enterNew(page, 'p13')
  await page.keyboard.type('ⅲ．試着')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__editor.getSnapshot().report.body[1].blocks.some((b) => b.type === 'subheading' && b.title === '試着'), { timeout: 30000 })
  await ready()
  await wait(400)
  const sub = await state(page)
  const layout = await page.evaluate(() => {
    const t = document.querySelector('.undo-area .undo-toast')?.getBoundingClientRect()
    const sheet = document.querySelector('.edit-sheet.open')?.getBoundingClientRect()
    return { toast: document.querySelector('.undo-area .undo-toast')?.textContent ?? '', above: !!t && !!sheet && t.bottom <= sheet.top + 0.5, inside: !!t && t.left >= 0 && t.right <= innerWidth }
  })
  await page.screenshot({ path: `${OUT}/phone-1-after-enter.png` })
  check(
    'スマホ：書く欄で「ⅲ．試着」と打って Enter：小見出し「ⅴ．試着」になり、すぐ後ろの段落で書き続ける。知らせは書く欄の上に出る',
    sub.texts[1].at(-2) === '【試着】' && sub.blocks[1].at(-1) === sub.editing && layout.toast.startsWith('小見出し「ⅴ．試着」にしました') && layout.above && layout.inside,
    JSON.stringify({ tail: sub.texts[1].slice(-3), layout }),
  )
  // 知らせの「戻す」：打ったままの段落に戻る
  await page.tap('.undo-area .undo-toast button')
  await page.waitForFunction(() => !window.__editor.getSnapshot().report.body[1].blocks.some((b) => b.type === 'subheading' && b.title === '試着'), { timeout: 30000 }).catch(() => {})
  const undone = await state(page)
  check('スマホ：知らせの「戻す」で、打ったままの段落「ⅲ．試着」に戻る', undone.texts[1].at(-1) === 'ⅲ．試着', JSON.stringify(undone.texts[1].slice(-2)))
  await ready()

  // 書く欄の「完了」で閉じたとき：段落ごと見出しの形なら大見出しになる
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('p16'), 'none'))
  await ready()
  const p16 = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.page-viewport.front [data-block-id="p16"]')].find((e) => e.getBoundingClientRect().width > 0)
    const r = el.getBoundingClientRect()
    return { x: r.left + 20, y: r.top + 4 }
  })
  await page.touchscreen.tap(p16.x, p16.y)
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p16', { timeout: 30000 })
  await page.evaluate(() => window.__editor.overlay.setCaret(window.__editor.overlay.text.length))
  await enterNew(page, 'p16')
  await page.keyboard.type('Ⅳ．謝辞')
  await page.tap('.edit-sheet .done')
  await page.waitForFunction(() => window.__editor.getSnapshot().report.body.length === 4, { timeout: 30000 }).catch(() => {})
  await ready()
  await wait(400)
  const done = await state(page)
  const doneToast = await toast(page)
  await page.screenshot({ path: `${OUT}/phone-2-after-done.png` })
  check(
    'スマホ：書く欄に「Ⅳ．謝辞」と打って「完了」：大見出し「Ⅳ．謝辞」になり、知らせが出る',
    JSON.stringify(done.chapters) === JSON.stringify(['企画・立案', '制作過程', 'まとめ', '謝辞']) && done.editing === null && doneToast.startsWith('大見出し「Ⅳ．謝辞」にしました'),
    JSON.stringify({ chapters: done.chapters, doneToast }),
  )
  await context.close()
}

// これだけを動かす：node scripts/e2e/autoHeading.mjs
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { withEdge } = await import('../poc/edge.mjs')
  const results = []
  const check = (name, ok, detail = '') => {
    results.push(ok)
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
  }
  await withEdge(async (browser) => {
    await autoHeadingPc(browser, check)
    await autoHeadingPhone(browser, check)
  })
  const failed = results.filter((ok) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} 件 合格`)
  process.exitCode = failed ? 1 : 0
}
