// スマホで紙面に直接書く（スマホのふつうの書き方。Edge を自動で操作する。phone.mjs から呼ぶ）。
// 2026-10-20 の試作（?direct=1）を依頼者が試して、スマホのふつうの書き方にした。予備として ?direct=0 で、その端末だけ下から出る書く欄にできる。
// - 印なしで紙面に直接書く。試作の札・メニューの「下の書く欄に戻す」はない。試作のときの覚えは消し、下の書く欄にするのは ?direct=0 だけ
// - 表紙の項目・段落・見出し・抄録・図のタイトル・表のタイトル・表のセルを、紙面を拡大して、紙面の上で書く（下の書く欄は出ない）
// - 「完了」・紙面の外を押すと、書き終えて1ページ全体の表示に戻る（表のセルの Enter はマスの中の改行。拡大したまま書き続ける）
// - 図を入れたら、図とタイトルの行を一緒に見せてタイトルを書く。表を入れたら、タイトルの行と表を一緒に見せる
// - 図表のタイトルは、書いている間も番号（図4.・表2.）のすぐ後ろから書く（書き終えたときと同じ。captionGap.mjs）
// - キーボードのすぐ上の細い道具（キーボードは visualViewport の高さを変えて仮に出す）。書いている行はキーボード・道具に隠れない
// - 「戻す」「やり直す」・Enter で段落を分ける・先頭の Backspace でつなげる・日本語の変換・段落に打った見出し・見出しの Enter・
//   Android のような改行・消す入力だけの Enter・Backspace・ページの終わりから次のページへ続く・「追加」の「小見出し」・指摘へ移る
// - 2本の指で紙面を広げる・縮める（指の間の点は動かない。1ページ全体〜本文の幅の3倍。上の帯・道具は大きくしない）・広げたら指1本で動かす・
//   広げてもページを送らない・書き始めない・広げ終えたあとのタップはふつう・書いている間に広げると、その大きさを覚えて次も使う
// - 作品写真は、押して選んでから指で動かす（選んでいない写真の上ではらうと、ページを送る。依頼者の判断：案A）。2本の指では紙面を広げる
// - 予備の ?direct=0：下から出る書く欄（覚える。?direct=1 でふつうに戻す）
// これだけを動かすときは node scripts/e2e/phoneDirect.mjs。画面の写真は poc-output/phone-direct-v2/（390×844）
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stubConfig } from './configStub.mjs'
import { setupWriting } from './sampleReport.mjs'
import { captionGap, gapDetail, gapOk } from './captionGap.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/phone-direct-v2'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
/** 予備の「下の書く欄」にした端末の覚え・試作のときの覚え・書くときの大きさの覚え（app/phoneDirect.ts・editor/pinchZoom.ts） */
const SHEET_KEY = 'sotsugyo-seisaku-report-phone-sheet'
const OLD_KEY = 'sotsugyo-seisaku-report-phone-direct'
const ZOOM_KEY = 'sotsugyo-seisaku-report-writing-zoom'
/** 仮に出すキーボードの高さ（iPhone の日本語のキーボードほど） */
const KB = 336
/** 図を入れるときに選ぶ写真（見本の画像。読むだけ） */
const FIGURE_FILE = resolve('docs/guide-images/sample/design.jpg')

/** スマホの画面で開く */
async function openPhone(browser, { ua = IPHONE, query = '' } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror(phoneDirect):', e.message))
  page.on('dialog', (d) => d.dismiss())
  await page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
    /** 要素の i 文字目の画面上の四角（包んだ要素の中の字も数える） */
    window.__charRect = (el, i) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      let acc = 0
      while (walker.nextNode()) {
        const node = walker.currentNode
        if (i < acc + node.length) {
          const r = document.createRange()
          r.setStart(node, i - acc)
          r.setEnd(node, i - acc + 1)
          const q = [...r.getClientRects()].find((x) => x.height > 0)
          return q ? { left: q.left, top: q.top, right: q.right, bottom: q.bottom } : null
        }
        acc += node.length
      }
      return null
    }
    /** 紙面（表に出ている方）の欄 id の、見ているページの部分 */
    window.__frag = (id) => {
      const ed = window.__editor
      const view = ed.renderer.pageView
      return view.fragments(id).find((f) => f.closest('.page-viewport.front') && view.pageIndexOf(f) === ed.getSnapshot().page) ?? null
    }
    /** 原稿の欄 id の文字 */
    window.__text = (id) => {
      const r = window.__editor.getSnapshot().report
      const block = r.body.flatMap((c) => c.blocks).concat(r.abstract.paragraphs).find((b) => b.id === id)
      return block?.content?.map((n) => n.text ?? '').join('') ?? block?.title ?? null
    }
    /** 見ているページの四角 */
    window.__page = () => {
      const ed = window.__editor
      const r = ed.renderer.pageView.pages()[ed.getSnapshot().page].getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width }
    }
    /** 書いているようす */
    window.__state = () => {
      const ed = window.__editor
      const s = ed.getSnapshot()
      const el = ed.overlay.element
      const r = el.getBoundingClientRect()
      const bar = document.querySelector('.direct-bar')?.getBoundingClientRect()
      const caret = ed.overlay.caretClientRect()
      return {
        editing: s.editingId,
        kind: s.editingKind,
        zoomed: s.zoomed,
        onPaper: s.onPaper,
        sheet: s.sheet,
        page: s.page,
        selection: s.selection,
        sheetOpen: !!document.querySelector('.edit-sheet.open'),
        inScroller: !!el.closest('.page-scroller'),
        inSheetHost: !!el.closest('.edit-sheet'),
        focused: document.activeElement === el,
        text: ed.overlay.text,
        caret: ed.overlay.caret,
        overlay: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        bar: bar ? { top: bar.top, bottom: bar.bottom, height: bar.height } : null,
        caretRect: caret ? { left: caret.left, top: caret.top, bottom: caret.bottom } : null,
        scale: ed.stage.scale,
        fitScale: ed.stage.fitScale,
        textScale: ed.stage.textScale,
        unzoom: !!document.querySelector('.unzoom'),
      }
    }
    /** 要素たちの文字の、行の始まりの文字の位置（phoneLive.mjs と同じ。ページをまたぐ段落は、ページごとの要素を順に） */
    window.__lineStarts = (els) => {
      const starts = []
      let index = 0
      for (const el of els) {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        let lastTop = null
        while (walker.nextNode()) {
          const node = walker.currentNode
          for (let i = 0; i < node.length; i++, index++) {
            const r = document.createRange()
            r.setStart(node, i)
            r.setEnd(node, i + 1)
            const rect = [...r.getClientRects()].find((x) => x.height > 0)
            if (!rect) continue
            if (lastTop === null || rect.top > lastTop + rect.height * 0.5) {
              starts.push(index)
              lastTop = rect.top
            }
          }
        }
      }
      return starts
    }
    /** 紙面の段落 id の行の始まり（見えていないページも測る） */
    window.__pageStarts = (id) => {
      const ed = window.__editor
      ed.renderer.viewport.classList.add('measuring')
      const starts = window.__lineStarts(ed.renderer.pageView.fragments(id).filter((f) => f.closest('.page-viewport.front')))
      ed.renderer.viewport.classList.remove('measuring')
      return starts
    }
    /** 組み直した回数を数える（render を呼んだ回数） */
    window.__countRenders = () => {
      const ed = window.__editor
      if (ed.__counted) return
      ed.__counted = true
      window.__renders = 0
      const render = Object.getPrototypeOf(ed).render
      ed.render = function (...args) {
        window.__renders += 1
        return render.apply(this, args)
      }
    }
  })
  await stubConfig(page)
  await page.setUserAgent(ua)
  await page.setViewport(PHONE)
  await page.goto(`${APP}/?nodrive${query}`, { waitUntil: 'networkidle0', timeout: 90000 })
  return { context, page }
}

const readyOf = (page) => () =>
  page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 120000 })

/** キーボードを仮に出す・しまう（iPhone と同じく、見えている所（visualViewport）が低くなる） */
const keyboard = (page, kb) =>
  page.evaluate((kb) => {
    if (kb) Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => window.innerHeight - kb })
    else delete window.visualViewport.height
    window.visualViewport.dispatchEvent(new Event('resize'))
  }, kb)

/** 画面の写真のためだけの、仮のキーボードの絵（押せない。写真を撮ったら外す） */
const fakeKeyboard = (page, on) =>
  page.evaluate((kb, on) => {
    document.querySelector('#fake-kb')?.remove()
    if (!on) return
    const k = document.createElement('div')
    k.id = 'fake-kb'
    k.textContent = 'キーボード（仮）'
    Object.assign(k.style, { position: 'fixed', left: '0', right: '0', bottom: '0', height: `${kb}px`, zIndex: '200', pointerEvents: 'none', background: '#d3d6dc', color: '#6b6f78', display: 'grid', placeItems: 'center', font: '15px sans-serif' })
    document.body.append(k)
  }, KB, on)

/** 仮のキーボードを出した画面の写真 */
async function shotWithKeyboard(page, name) {
  await fakeKeyboard(page, true)
  await page.screenshot({ path: `${OUT}/${name}.png` })
  await fakeKeyboard(page, false)
}

/** 紙面の欄 id の i 文字目（見ているページ）を指で押す（左半分を押すと、その字の前にカーソルが来る：left） */
async function tapChar(page, id, i, left = true) {
  const pt = await page.evaluate(
    (id, i, left) => {
      const el = window.__frag(id)
      const r = window.__charRect(el, i)
      return { x: left ? r.left + (r.right - r.left) * 0.25 : r.left + (r.right - r.left) * 0.75, y: (r.top + r.bottom) / 2 }
    },
    id,
    i,
    left,
  )
  await page.touchscreen.tap(pt.x, pt.y)
  return pt
}

/** 紙面の要素（CSS のセレクタ。表に出ている方）の真ん中を指で押す */
async function tapEl(page, selector) {
  const pt = await page.evaluate((sel) => {
    const r = document.querySelector(`.page-viewport.front ${sel}`).getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, selector)
  await page.touchscreen.tap(pt.x, pt.y)
  return pt
}

/** 指1本で from から to へ動かす（はらう・つかんで動かす） */
async function drag(cdp, from, to, steps = 8) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: 1 }] })
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps, id: 1 }] })
    await wait(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await wait(500)
}

/** 2本の指を、点 c を真ん中に、横に d0 離して置き、d1 まで広げる（縮める）。shift：その間に、2本の指ごと動かす量 */
async function pinch(cdp, c, d0, d1, { steps = 10, shift = { x: 0, y: 0 } } = {}) {
  const at = (i) => {
    const d = d0 + ((d1 - d0) * i) / steps
    const x = c.x + (shift.x * i) / steps
    const y = c.y + (shift.y * i) / steps
    return [{ x: x - d / 2, y, id: 1 }, { x: x + d / 2, y, id: 2 }]
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) })
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(i) })
    await wait(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await wait(500)
}

export async function phoneDirectPhone(browser, check) {
  // ---- 1. 印なしで紙面に直接書く。試作の札・メニューの項目はない。試作のときの覚えは消し、下の書く欄にはしない ----
  const { context, page } = await openPhone(browser)
  const ready = readyOf(page)
  const cdp = await page.createCDPSession()
  // 試作を使っていた学生の端末（試作のときの覚えがある）
  await page.evaluate((key) => localStorage.setItem(key, '1'), OLD_KEY)
  await page.reload({ waitUntil: 'networkidle0' })
  const start = await page.evaluate(
    (keys) => ({
      on: document.querySelector('.app')?.classList.contains('phone-direct'),
      old: localStorage.getItem(keys.old),
      sheet: localStorage.getItem(keys.sheet),
      badge: !!document.querySelector('.direct-badge'),
      meta: document.querySelector('meta[name="viewport"]').content,
    }),
    { old: OLD_KEY, sheet: SHEET_KEY },
  )
  check(
    'スマホは印なしで紙面に直接書く（試作の札は出ない。試作のときの覚えは消し、下の書く欄にはしない）。iPhone は書く欄に入っても画面が拡大されないよう maximum-scale=1',
    start.on && start.old === null && start.sheet === null && !start.badge && start.meta.includes('maximum-scale=1'),
    JSON.stringify(start),
  )

  // ---- 2. はじめての案内の表紙の項目も、紙面の上で書く。「完了」で1ページ全体の表示に戻り、次の項目へ ----
  await page.waitForSelector('.guide.step-course .g-opts button', { timeout: 60000 })
  await page.evaluate(() => document.querySelector('.g-opts button').click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.guide.step-studentId')
  await ready()
  await wait(300)
  await tapEl(page, '[data-block-id="basic:studentId"]')
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'basic:studentId', { timeout: 10000 }).catch(() => {})
  await wait(300)
  await keyboard(page, KB)
  await wait(400)
  await page.keyboard.type('00ZZ0123')
  await wait(200)
  const cover = await page.evaluate(() => {
    const st = window.__state()
    const tip = document.querySelector('.guide .g-tip')?.getBoundingClientRect()
    return { ...st, tipBottom: tip ? tip.bottom : null, tucked: !!document.querySelector('.guide .g-tip.tucked') }
  })
  await shotWithKeyboard(page, '4-cover-field')
  check(
    '表紙の項目（学籍番号）も、紙面を拡大して紙面の上で書く（下の書く欄は出ない）。書いている欄は、案内の吹き出しより下・キーボードの上の道具より上に見えている',
    cover.kind === 'field' && cover.onPaper && cover.zoomed && !cover.sheetOpen && cover.inScroller && cover.focused && cover.text === '00ZZ0123' &&
      cover.overlay.bottom <= cover.bar.top - 2 && (cover.tucked || cover.tipBottom === null || cover.overlay.top >= cover.tipBottom - 1),
    JSON.stringify({ kind: cover.kind, onPaper: cover.onPaper, zoomed: cover.zoomed, sheetOpen: cover.sheetOpen, text: cover.text, overlay: [cover.overlay.top, cover.overlay.bottom].map(Math.round), bar: Math.round(cover.bar.top), tip: cover.tipBottom && Math.round(cover.tipBottom), tucked: cover.tucked }),
  )
  await page.tap('.direct-bar .db-done')
  await page.waitForSelector('.guide.step-name', { timeout: 10000 }).catch(() => {})
  await wait(300)
  const coverDone = await page.evaluate(() => ({ ...window.__state(), id: window.__editor.getSnapshot().report.basicInfo.studentId, step: document.querySelector('.guide')?.className ?? '' }))
  check(
    '表紙の項目で「完了」：書き終えて、1ページ全体の表示に戻り、案内は次（氏名）へ進む',
    coverDone.editing === null && !coverDone.zoomed && coverDone.id === '00ZZ0123' && coverDone.step.includes('step-name') && !coverDone.focused,
    JSON.stringify({ editing: coverDone.editing, zoomed: coverDone.zoomed, id: coverDone.id, step: coverDone.step }),
  )
  await keyboard(page, 0)
  await page.evaluate(() => document.querySelector('.g-later').click())
  await ready()
  await page.evaluate(setupWriting)
  await wait(300)
  await ready()
  await page.evaluate(() => window.__countRenders())

  // メニューに「下の書く欄に戻す」はない
  await page.tap('.p-top .icon-btn')
  await page.waitForSelector('.sheet .sheet-close')
  await wait(300)
  const menu = await page.evaluate(() => ({ off: !!document.querySelector('.sheet .direct-off'), text: document.querySelector('.sheet')?.textContent.includes('下の書く欄に戻す') }))
  await page.tap('.sheet .sheet-close')
  await wait(300)
  check('メニューに「下の書く欄に戻す」は出ない（予備の ?direct=0 は、リンクでだけ）', !menu.off && !menu.text, JSON.stringify(menu))

  // ---- 3. 段落をタップ：拡大して、押した字の所から紙面の上で書く ----
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('p9'), 'none'))
  await ready()
  await wait(300)
  const before = await page.evaluate(() => ({ text: window.__text('p9'), zoomed: window.__editor.getSnapshot().zoomed, renders: window.__renders }))
  // 2行目の5字目あたりを押す
  const second = await page.evaluate(() => {
    const el = window.__frag('p9')
    const first = window.__charRect(el, 0)
    for (let i = 1; i < 200; i++) {
      const r = window.__charRect(el, i)
      if (r && r.top > first.bottom - 1) return i
    }
    return 20
  })
  const at = second + 4
  const tap = await tapChar(page, 'p9', at)
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p9', { timeout: 10000 })
  await wait(400)
  const opened = await page.evaluate(() => {
    const st = window.__state()
    const el = window.__editor.overlay.element
    const r = window.__charRect(el, 2)
    const frag = window.__frag('p9')
    const f = frag.getBoundingClientRect()
    const buttons = [...document.querySelectorAll('.direct-bar .db-row:first-of-type button')].map((b) => {
      const q = b.getBoundingClientRect()
      // 名前の字の行の数（字ごとの四角の上端の数）
      const lines = new Set()
      const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode
        for (let i = 0; i < node.length; i++) {
          const range = document.createRange()
          range.setStart(node, i)
          range.setEnd(node, i + 1)
          const rr = [...range.getClientRects()].find((x) => x.height > 0)
          if (rr) lines.add(Math.round(rr.top))
        }
      }
      return { name: b.textContent.trim(), w: Math.round(q.width), h: Math.round(q.height), oneLine: lines.size === 1 }
    })
    return { ...st, charW: r ? r.right - r.left : 0, fragTop: f.top, fragLeft: f.left, fragHidden: getComputedStyle(frag).visibility === 'hidden', buttons }
  })
  check(
    '段落をタップすると、紙面が拡大し（1字 10px ほど）、紙面の上の書く欄で書き始める（下の書く欄は出ない。書く欄は紙面の表示枠の中）',
    !before.zoomed && opened.zoomed && opened.onPaper && !opened.sheet && !opened.sheetOpen && opened.inScroller && !opened.inSheetHost && opened.focused && opened.charW > 9 && opened.charW < 11,
    JSON.stringify({ zoomed: opened.zoomed, onPaper: opened.onPaper, sheetOpen: opened.sheetOpen, inScroller: opened.inScroller, focused: opened.focused, charW: opened.charW.toFixed(2), scale: opened.scale.toFixed(3) }),
  )
  check(
    'カーソルは押した字の所に来る。書く欄は紙面の段落とちょうど同じ位置に重なり、紙面の段落は隠れる',
    Math.abs(opened.caret - at) <= 1 && Math.abs(opened.overlay.top - opened.fragTop) < 1.5 && Math.abs(opened.overlay.left - opened.fragLeft) < 1.5 && opened.fragHidden,
    JSON.stringify({ at, caret: opened.caret, overlay: [opened.overlay.left, opened.overlay.top].map(Math.round), frag: [opened.fragLeft, opened.fragTop].map(Math.round) }),
  )
  check(
    '押した行は、押した高さのあたりに来る（キーボードがまだ出ていないので、隠れない画面の上の方）',
    !!opened.caretRect && opened.caretRect.top > 48 && opened.caretRect.bottom < 844 * 0.6 && Math.abs((opened.caretRect.top + opened.caretRect.bottom) / 2 - tap.y) < 844 * 0.6,
    JSON.stringify({ tapY: Math.round(tap.y), caret: opened.caretRect && [opened.caretRect.top, opened.caretRect.bottom].map(Math.round) }),
  )
  const names = opened.buttons.map((b) => b.name)
  check(
    'キーボードの上の道具に「戻す」「やり直す」「図を入れる」「表を入れる」「削除」「完了」（削除は mockups/v48 E）。どれも 44px 四方以上で、名前は1行',
    JSON.stringify(names) === JSON.stringify(['戻す', 'やり直す', '図を入れる', '表を入れる', '削除', '完了']) && opened.buttons.every((b) => b.w >= 44 && b.h >= 44 && b.oneLine),
    JSON.stringify(opened.buttons),
  )

  // ---- 4. キーボードを出す：道具はキーボードのすぐ上。書いている行は隠れない ----
  await keyboard(page, KB)
  await wait(400)
  const kb = await page.evaluate(() => window.__state())
  check(
    'キーボードを出すと、道具はキーボードのすぐ上（visualViewport）。書いている行は、道具より上・上の帯より下に見えている',
    !!kb.bar && Math.abs(kb.bar.bottom - (844 - KB)) < 1 && !!kb.caretRect && kb.caretRect.bottom <= kb.bar.top - 2 && kb.caretRect.top >= 48,
    JSON.stringify({ bar: kb.bar, caret: kb.caretRect }),
  )

  // ---- 5. 打つと、組み直すのを待たずに、紙面の上にその字が出る ----
  await page.keyboard.type('あいうえお')
  const typed = await page.evaluate(() => ({ ...window.__state(), report: window.__text('p9'), renders: window.__renders, fragHidden: getComputedStyle(window.__frag('p9')).visibility === 'hidden' }))
  check(
    '打つと、その字がすぐ紙面の上（書く欄）に出て、原稿にも入る（組み直すのを待たない）',
    typed.text === before.text.slice(0, at) + 'あいうえお' + before.text.slice(at) && typed.report === typed.text && typed.renders === before.renders && typed.fragHidden && typed.caret === at + 5,
    JSON.stringify({ around: typed.text.slice(at - 2, at + 8), report: typed.report === typed.text, renders: [before.renders, typed.renders], caret: typed.caret }),
  )
  // 行が増えるまで打つ（組み直すのは止めておく。打つ手が止まって書く欄を測り直したあとの折り返しを、組み直した紙面と比べるため）
  await page.evaluate(() => (window.__editor.scheduleRender = () => {}))
  const p10Before = await page.evaluate(() => window.__frag('p10').getBoundingClientRect().top)
  await page.keyboard.type('かきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん、「漢字」とABC123も。')
  await wait(200)
  const grown = await page.evaluate(() => ({ ...window.__state(), p10: window.__frag('p10').getBoundingClientRect().top }))
  check(
    '段落の行が増えると、後ろの段落がその分下がり（書く欄の下端のすぐ下）、書いている行は道具・キーボードに隠れない',
    grown.p10 > p10Before + 5 && Math.abs(grown.p10 - grown.overlay.bottom) < 1.5 && !!grown.caretRect && grown.caretRect.bottom <= grown.bar.top - 2,
    JSON.stringify({ p10: [Math.round(p10Before), Math.round(grown.p10)], overlayBottom: Math.round(grown.overlay.bottom), caret: grown.caretRect && Math.round(grown.caretRect.bottom), bar: Math.round(grown.bar.top) }),
  )
  const scrolled = await page.evaluate(() => {
    const ed = window.__editor
    const p = ed.renderer.pageView.pages()[ed.getSnapshot().page]
    const gap = () => ed.overlay.element.getBoundingClientRect().top - p.getBoundingClientRect().top
    const b = gap()
    ed.scroller.scrollTop -= 40
    const a = gap()
    ed.scroller.scrollTop += 40
    return { before: b, after: a }
  })
  check('紙面を上下に動かしても、書く欄は紙面と一緒に動く（ずれない）', Math.abs(scrolled.before - scrolled.after) < 0.5, JSON.stringify(scrolled))
  await wait(1200)
  const typedStarts = await page.evaluate(() => ({ starts: window.__lineStarts([window.__editor.overlay.element]), caret: window.__editor.overlay.caret, focused: document.activeElement === window.__editor.overlay.element }))
  await page.evaluate(() => {
    delete window.__editor.scheduleRender
    return window.__editor.render()
  })
  await ready()
  await wait(200)
  const paperStarts = await page.evaluate(() => window.__pageStarts('p9'))
  check(
    '打つ手が止まって書く欄を測り直すと、行の始まりの字が、組み直した紙面と同じ（カーソルの位置もそのまま）',
    JSON.stringify(typedStarts.starts) === JSON.stringify(paperStarts) && typedStarts.caret === grown.caret && typedStarts.focused,
    JSON.stringify({ typed: typedStarts.starts, paper: paperStarts, caret: [grown.caret, typedStarts.caret] }),
  )

  // ---- 6. 道具の「戻す」「やり直す」（書く欄の中で打った字。キーボードは出たまま） ----
  const typedAll = grown.text
  await page.tap('.direct-bar .db-row button:nth-child(1)')
  await wait(200)
  const undone = await page.evaluate(() => window.__state())
  await page.tap('.direct-bar .db-row button:nth-child(2)')
  await wait(200)
  const redone = await page.evaluate(() => ({ ...window.__state(), report: window.__text('p9') }))
  check(
    '道具の「戻す」で打った字が戻り、「やり直す」でまた入る（書いたまま。書く欄から出ない）',
    undone.text === before.text && undone.editing === 'p9' && undone.focused && redone.text === typedAll && redone.report === typedAll && redone.focused,
    JSON.stringify({ undone: undone.text === before.text, focused: [undone.focused, redone.focused], redone: redone.text === typedAll }),
  )

  // ---- 7. Enter で段落を分ける（「。」を自動で付ける）・先頭の Backspace でつなげ直す・Android のような入力 ----
  await page.waitForFunction((t) => window.__frag('p9') && window.__editor.renderer.pageView.fragments('p9').map((f) => f.textContent).join('') === t, { timeout: 30000 }, typedAll)
  await ready()
  const cut = typedAll.indexOf('あいうえお') + 5
  await page.evaluate((c) => window.__editor.overlay.setCaret(c), cut)
  await page.keyboard.press('Enter')
  await wait(300)
  const split = await page.evaluate(() => ({ ...window.__state(), p9: window.__text('p9'), next: window.__text(window.__editor.getSnapshot().editingId) }))
  check(
    'Enter で段落を分けると、続きを新しい段落の始めから紙面の上で書く（前の段落の終わりには「。」が付く。キーボードは出たまま）',
    split.editing !== 'p9' && split.onPaper && split.focused && split.p9 === `${typedAll.slice(0, cut)}。` && split.next === typedAll.slice(cut) && split.caret === 0,
    JSON.stringify({ editing: split.editing, p9: split.p9?.slice(-8), next: split.next?.slice(0, 8), caret: split.caret, focused: split.focused }),
  )
  await page.keyboard.press('Backspace')
  await wait(300)
  const merged = await page.evaluate(() => ({ ...window.__state(), p9: window.__text('p9') }))
  check(
    '分けた直後に、先頭で Backspace を押すと、前の段落につなげ直す（自動で付けた「。」も消える）',
    merged.editing === 'p9' && merged.p9 === typedAll && merged.caret === cut && merged.focused && merged.onPaper,
    JSON.stringify({ editing: merged.editing, same: merged.p9 === typedAll, caret: merged.caret, cut }),
  )
  await page.evaluate(() => window.__editor.overlay.setCaret(window.__editor.overlay.text.length))
  const lenNow = await page.evaluate(() => window.__editor.overlay.text.length)
  await page.evaluate(() => window.__editor.overlay.element.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertParagraph', bubbles: true, cancelable: true })))
  await wait(300)
  const aSplit = await page.evaluate(() => window.__state())
  await page.evaluate(() => window.__editor.overlay.element.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true })))
  await wait(300)
  const aMerge = await page.evaluate(() => ({ ...window.__state(), p9: window.__text('p9') }))
  check(
    'Android のように改行の入力だけが来ても段落を分け、先頭で消す入力だけが来ても前の段落につなげる',
    aSplit.editing !== 'p9' && aSplit.onPaper && aSplit.text === '' && aMerge.editing === 'p9' && aMerge.p9 === typedAll && aMerge.caret === lenNow,
    JSON.stringify({ split: aSplit.editing, merged: aMerge.editing, same: aMerge.p9 === typedAll, caret: [aMerge.caret, lenNow] }),
  )

  // ---- 8. 日本語の変換：変換中の字も紙面の上に出て、確定すると原稿に入る ----
  await page.evaluate((c) => window.__editor.overlay.setCaret(c), cut)
  await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 })
  await cdp.send('Input.imeSetComposition', { text: 'かん', selectionStart: 2, selectionEnd: 2 })
  const composing = await page.evaluate(() => ({ ...window.__state(), report: window.__text('p9') }))
  await cdp.send('Input.insertText', { text: '漢' })
  await wait(100)
  const composed = await page.evaluate(() => ({ ...window.__state(), report: window.__text('p9') }))
  const withKan = typedAll.slice(0, cut) + '漢' + typedAll.slice(cut)
  check(
    '日本語の変換中の字も紙面の上の書く欄に出て（原稿にはまだ入れない）、確定すると原稿に入る',
    composing.text === typedAll.slice(0, cut) + 'かん' + typedAll.slice(cut) && composing.report === typedAll && composed.text === withKan && composed.report === withKan && composed.caret === cut + 1,
    JSON.stringify({ composing: composing.text.slice(cut - 2, cut + 4), report: composing.report === typedAll, composed: composed.report === withKan, caret: composed.caret }),
  )

  // ---- 9. 段落に打った見出し（Enter で見出しになり、続きは紙面の上で書く） ----
  await page.evaluate(() => window.__editor.overlay.setCaret(window.__editor.overlay.text.length))
  await page.keyboard.press('Enter')
  await wait(300)
  await page.keyboard.type('ⅳ．試着')
  await page.keyboard.press('Enter')
  await wait(500)
  const headed = await page.evaluate(() => {
    const r = window.__editor.getSnapshot().report
    const titles = r.body.flatMap((c) => c.blocks).filter((b) => b.type === 'subheading').map((b) => b.title)
    return { ...window.__state(), titles, toast: document.querySelector('.undo-toast')?.textContent ?? '' }
  })
  check(
    '段落に「ⅳ．試着」と打って Enter で小見出しになり、続きは見出しの下の段落を紙面の上で書く（知らせも出る）',
    headed.titles.includes('試着') && headed.onPaper && headed.focused && headed.text === '' && headed.toast.includes('小見出し'),
    JSON.stringify({ titles: headed.titles, onPaper: headed.onPaper, toast: headed.toast }),
  )

  // ---- 10. 「完了」：書き終えて、1ページ全体の表示に戻る（書いていたページ） ----
  await page.evaluate(() => window.__editor.overlay.setCaret(0))
  await page.evaluate(() => window.__editor.overlay.insertText('ここまで書いた。'))
  await wait(100)
  const doneFrom = await page.evaluate(() => ({ id: window.__editor.getSnapshot().editingId, page: window.__editor.getSnapshot().page }))
  await page.tap('.direct-bar .db-done')
  await wait(300)
  const done = await page.evaluate((id) => ({ ...window.__state(), barShown: !!document.querySelector('.direct-bar'), blockPage: window.__editor.pageOfBlock(id) }), doneFrom.id)
  await ready()
  await wait(300)
  const shownAfter = await page.evaluate((id) => {
    const all = window.__editor.renderer.pageView.fragments(id).filter((f) => f.closest('.page-viewport.front'))
    return { text: all.map((f) => f.textContent).join(''), hidden: all.some((f) => getComputedStyle(f).visibility === 'hidden') }
  }, doneFrom.id)
  await page.screenshot({ path: `${OUT}/1-done-whole-page.png` })
  check(
    '「完了」で書き終えると、1ページ全体の表示に戻る（書いていた段落のあるページ。「ページ全体に戻す」は出ない。キーボードの上の道具も消える）。組み直した紙面に書いた字が出る',
    done.editing === null && !done.zoomed && Math.abs(done.scale - done.fitScale) < 0.001 && done.page === doneFrom.page && done.blockPage === done.page && !done.unzoom && !done.barShown && !done.focused &&
      shownAfter.text === 'ここまで書いた。' && !shownAfter.hidden,
    JSON.stringify({ editing: done.editing, zoomed: done.zoomed, page: [doneFrom.page, done.page, done.blockPage], unzoom: done.unzoom, bar: done.barShown, shownAfter }),
  )

  // ---- 11. 書いている間にほかの段落をタップ：その段落へ移って書く（フォーカスが外れない＝キーボードが閉じない） ----
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('p10'), 'none'))
  await ready()
  const [pa, pb] = await page.evaluate(() =>
    [...document.querySelectorAll('.page-viewport.front section.body p[data-block-id]')]
      .map((e) => e.dataset.blockId)
      .filter((id, i, all) => all.indexOf(id) === i && window.__frag(id) && (window.__text(id) ?? '').length > 10)
      .slice(0, 2),
  )
  await tapChar(page, pa, 3)
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 10000 }, pa)
  await wait(300)
  await page.evaluate(() => {
    window.__blurs = 0
    window.__editor.overlay.element.addEventListener('blur', () => (window.__blurs += 1))
  })
  await tapChar(page, pb, 5)
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 10000 }, pb).catch(() => {})
  await wait(300)
  const moved = await page.evaluate(() => ({ ...window.__state(), blurs: window.__blurs }))
  check(
    '書いている間にほかの段落をタップすると、その段落の押した所へ移って書く（その間、書く欄からフォーカスが外れない＝キーボードが閉じない）',
    moved.editing === pb && moved.onPaper && moved.focused && moved.blurs === 0 && Math.abs(moved.caret - 5) <= 1,
    JSON.stringify({ pa, pb, editing: moved.editing, focused: moved.focused, blurs: moved.blurs, caret: moved.caret }),
  )
  await page.tap('.direct-bar .db-done')
  await wait(300)
  await ready()

  // ---- 12. 見出しをタップ：紙面の上で書き、Enter で後ろに段落ができる ----
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('s5'), 'none'))
  await ready()
  await tapChar(page, 's5', 1, false)
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 's5', { timeout: 10000 })
  await wait(300)
  const heading = await page.evaluate(() => window.__state())
  await page.evaluate(() => window.__editor.overlay.setCaret(window.__editor.overlay.text.length))
  await page.keyboard.type('（改）')
  await page.keyboard.press('Enter')
  await wait(400)
  const afterHeading = await page.evaluate(() => {
    const r = window.__editor.getSnapshot().report
    const blocks = r.body.flatMap((c) => c.blocks)
    const i = blocks.findIndex((b) => b.id === 's5')
    return { ...window.__state(), title: blocks[i].title, nextId: blocks[i + 1]?.id }
  })
  check(
    '見出しをタップしても紙面の上で書き（下の書く欄は出ない）、Enter で見出しのすぐ後ろに段落ができて、続けて書く',
    heading.onPaper && heading.kind === 'subheading' && !heading.sheetOpen && afterHeading.title === '袖の刺繍（改）' && afterHeading.editing === afterHeading.nextId && afterHeading.onPaper && afterHeading.focused,
    JSON.stringify({ heading: [heading.onPaper, heading.kind, heading.sheetOpen], title: afterHeading.title, editing: afterHeading.editing, next: afterHeading.nextId }),
  )
  await page.tap('.direct-bar .db-done')
  await wait(300)
  await ready()

  // ---- 13. ページの終わりの段落に書き足して、次のページへ続く ----
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('p12'), 'none'))
  await ready()
  await wait(300)
  await tapChar(page, 'p12', 1)
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p12', { timeout: 10000 })
  await wait(300)
  const contStart = await page.evaluate(() => {
    const ov = window.__editor.overlay
    ov.setCaret(ov.text.length)
    return { page: window.__editor.getSnapshot().page }
  })
  await wait(200)
  for (let k = 0; k < 40; k++) {
    await page.keyboard.sendCharacter('ズボンの裾には、動いたときに広がりすぎないよう、細いテープを入れて形を整えた。')
    await wait(150)
    if (await page.evaluate((p) => window.__editor.getSnapshot().page > p, contStart.page)) break
  }
  await page.waitForFunction((p) => window.__editor.getSnapshot().page > p, { timeout: 20000 }, contStart.page).catch(() => {})
  await wait(600)
  const cont = await page.evaluate(() => {
    const ed = window.__editor
    return { ...window.__state(), caretPage: ed.pageOfBlock('p12', ed.overlay.caret) }
  })
  check(
    'ページの終わりの段落に書き足して次のページへ続くと、次のページへ移り、書いている行はキーボードの上の道具より上に見えたまま（書き続けられる）',
    cont.page > contStart.page && cont.caretPage === cont.page && cont.editing === 'p12' && cont.onPaper && cont.focused && !!cont.caretRect && cont.caretRect.top >= 48 && cont.caretRect.bottom <= cont.bar.top - 2,
    JSON.stringify({ from: contStart.page, page: cont.page, caretPage: cont.caretPage, caret: cont.caretRect && [cont.caretRect.top, cont.caretRect.bottom].map(Math.round), bar: cont.bar && Math.round(cont.bar.top) }),
  )
  await page.tap('.direct-bar .db-done')
  await wait(300)
  await ready()

  // ---- 14. 「追加」→「小見出し」：足した小見出しを、すぐ紙面の上で書き始める ----
  await page.tap('.p-nav .add')
  await page.waitForSelector('.add-grid .tb')
  await wait(300)
  // 名前で探して押す（並びは大見出し → 小見出し）
  await page.evaluate(() => [...document.querySelectorAll('.add-grid .tb')].find((b) => b.textContent.includes('小見出し')).setAttribute('data-test-sub', ''))
  await page.tap('.add-grid .tb[data-test-sub]')
  await wait(800)
  const added = await page.evaluate(() => window.__state())
  await page.keyboard.type('採寸')
  await wait(200)
  const addedTyped = await page.evaluate(() => window.__state())
  check(
    '「追加」→「小見出し」で、足した小見出しを紙面の上ですぐ書き始める（追加の欄を閉じても、書く欄から出ない）',
    added.kind === 'subheading' && added.onPaper && added.zoomed && added.focused && addedTyped.text === '採寸' && addedTyped.focused,
    JSON.stringify({ kind: added.kind, onPaper: added.onPaper, zoomed: added.zoomed, focused: [added.focused, addedTyped.focused], text: addedTyped.text }),
  )
  await page.tap('.direct-bar .db-done')
  await wait(300)
  await ready()

  // ---- 15. 抄録の段落も、紙面を拡大して紙面の上で書く ----
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('a2'), 'none'))
  await ready()
  await wait(300)
  await tapChar(page, 'a2', 6)
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'a2', { timeout: 10000 }).catch(() => {})
  await wait(300)
  const abs = await page.evaluate(() => window.__state())
  await page.keyboard.type('（抄録）')
  const absTyped = await page.evaluate(() => ({ ...window.__state(), report: window.__text('a2') }))
  check(
    '抄録の段落をタップしても、紙面を拡大して、押した所から紙面の上で書く（打った字はすぐ出る）',
    abs.kind === 'abstractParagraph' && abs.onPaper && abs.zoomed && !abs.sheetOpen && abs.focused && Math.abs(abs.caret - 6) <= 1 && absTyped.text.includes('（抄録）') && absTyped.report === absTyped.text,
    JSON.stringify({ kind: abs.kind, onPaper: abs.onPaper, zoomed: abs.zoomed, caret: abs.caret }),
  )

  // ---- 16. 紙面の外を押すと、書き終えて、1ページ全体の表示に戻る ----
  await keyboard(page, 0)
  await page.evaluate(() => {
    const sc = document.querySelector('.page-scroller')
    sc.scrollTop = sc.scrollHeight
  })
  await wait(300)
  const grey = await page.evaluate(() => {
    const p = window.__page()
    const bar = document.querySelector('.direct-bar').getBoundingClientRect()
    return { x: 195, y: (p.bottom + bar.top) / 2, pageBottom: Math.round(p.bottom), barTop: Math.round(bar.top) }
  })
  await page.touchscreen.tap(grey.x, grey.y)
  await wait(500)
  const closedOut = await page.evaluate(() => window.__state())
  check(
    '紙面の外（紙面の下の灰色の所）を押すと、書き終えて、1ページ全体の表示に戻る（「ページ全体に戻す」を押さなくてよい）',
    grey.barTop - grey.pageBottom > 20 && closedOut.editing === null && !closedOut.focused && !closedOut.zoomed && !closedOut.unzoom,
    JSON.stringify({ grey, editing: closedOut.editing, zoomed: closedOut.zoomed }),
  )
  await ready()

  // ---- 17. 指摘へ移ると、指摘の字の後ろにカーソルを置いて、紙面の上で書く（Backspace で消して打ち直せる） ----
  await page.evaluate(() => window.__editor.goToFinding({ ruleId: 'test', severity: 'error', area: 'body', blockId: 'p10', start: 4, end: 8, title: 'test' }))
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p10', { timeout: 10000 }).catch(() => {})
  await wait(400)
  const found = await page.evaluate(() => window.__state())
  check('指摘へ移ると、指摘の字の後ろにカーソルを置いて、紙面の上で書く', found.editing === 'p10' && found.onPaper && found.zoomed && found.caret === 8, JSON.stringify({ editing: found.editing, onPaper: found.onPaper, caret: found.caret }))
  await page.tap('.direct-bar .db-done')
  await wait(300)
  await ready()

  // ---- 18. 図のタイトルをタップ：紙面の上で書き、図とタイトルの行が一緒に見える ----
  await keyboard(page, KB)
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('f3'), 'none'))
  await ready()
  await wait(300)
  await tapEl(page, 'figure[data-figure-id="f3"] figcaption [data-block-id="f3"]')
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'f3', { timeout: 10000 }).catch(() => {})
  await wait(500)
  const figVisible = (id) =>
    page.evaluate((id) => {
      const st = window.__state()
      const img = document.querySelector(`.page-viewport.front figure[data-figure-id="${id}"] img`)?.getBoundingClientRect()
      const line = st.caretRect ?? { top: st.overlay.top, bottom: st.overlay.bottom }
      const top = document.querySelector('.p-top').getBoundingClientRect().bottom
      const bottom = st.bar?.top ?? innerHeight
      return {
        ...st,
        img: img ? { top: img.top, bottom: img.bottom } : null,
        imgShown: img ? Math.max(0, Math.min(img.bottom, bottom) - Math.max(img.top, top)) / (img.bottom - img.top) : 0,
        lineShown: line.top >= top - 0.5 && line.bottom <= bottom + 0.5,
      }
    }, id)
  const fig = await figVisible('f3')
  const figGap = await captionGap(page, 'f3')
  await shotWithKeyboard(page, '2-figure-caption')
  check(
    '図のタイトルをタップすると、紙面の上で書く（下の書く欄は出ない）。キーボードの上の道具より上に、図の写真とタイトルの行が一緒に見える',
    fig.kind === 'figureCaption' && fig.onPaper && !fig.sheetOpen && fig.focused && fig.imgShown > 0.95 && fig.lineShown,
    JSON.stringify({ kind: fig.kind, onPaper: fig.onPaper, img: fig.img && [fig.img.top, fig.img.bottom].map(Math.round), imgShown: fig.imgShown.toFixed(2), line: fig.lineShown, bar: fig.bar && Math.round(fig.bar.top) }),
  )
  check('図のタイトルを書いている間も、番号（図3.）が書く欄の前にあり、タイトルはそのすぐ後ろ（1字分以内。書き終えたときと同じ所）から始まる', gapOk(figGap, { filled: true }), gapDetail(figGap))
  await page.tap('.direct-bar .db-done')
  await wait(300)
  await ready()

  // ---- 19. 図を入れる：写真を選ぶと、タイトルを紙面の上で書き始め、図の写真とタイトルの行が一緒に見える ----
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('p10'), 'none'))
  await ready()
  await tapChar(page, 'p10', 6)
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p10', { timeout: 10000 })
  await wait(300)
  const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 10000 }), page.tap('.direct-bar .db-row button:nth-child(3)')])
  await chooser.accept([FIGURE_FILE])
  await page.waitForFunction(() => window.__editor.getSnapshot().editingKind === 'figureCaption', { timeout: 20000 }).catch(() => {})
  await ready()
  await wait(800)
  const newFig = await page.evaluate(() => window.__editor.getSnapshot().editingId)
  const ins = await figVisible(newFig)
  const insLabel = await page.evaluate(() => ({ shown: getComputedStyle(window.__editor.overlay.element, '::before').content, text: window.__editor.overlay.text }))
  await page.keyboard.type('新しい図')
  await wait(200)
  const insTyped = await page.evaluate(() => window.__state())
  const insGap = await captionGap(page, newFig)
  await shotWithKeyboard(page, '2b-figure-inserted')
  check(
    '「図を入れる」で写真を選ぶと、図のタイトルを紙面の上で書き始め、図の写真とタイトルの行が、キーボードの上の道具より上に一緒に見える',
    ins.kind === 'figureCaption' && ins.onPaper && ins.focused && ins.imgShown > 0.5 && ins.lineShown && insTyped.text === '新しい図',
    JSON.stringify({ kind: ins.kind, img: ins.img && [ins.img.top, ins.img.bottom].map(Math.round), imgShown: ins.imgShown.toFixed(2), line: ins.lineShown, text: insTyped.text }),
  )
  check(
    '入れた図の空のタイトル：書く欄の前に番号（「図4. |」のように番号のすぐ後ろにカーソル）。打った字も番号のすぐ後ろ（1字分以内）で、書いた字に番号は入らない',
    /^"図\d+\."$/.test(insLabel.shown) && insLabel.text === '' && gapOk(insGap) && insGap.text === '新しい図',
    `${insLabel.shown} ${gapDetail(insGap)}`,
  )
  await page.tap('.direct-bar .db-done')
  await wait(300)
  await ready()

  // ---- 20. 表を入れる：表のタイトルを紙面の上で書き、タイトルの行と表が一緒に見える。表の道具も出る ----
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('p11'), 'none'))
  await ready()
  await tapChar(page, 'p11', 6)
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p11', { timeout: 10000 })
  await wait(300)
  await page.tap('.direct-bar .db-row button:nth-child(4)')
  await page.waitForSelector('.table-size .ts-insert')
  await wait(300)
  await page.tap('.table-size .ts-insert')
  await page.waitForFunction(() => window.__editor.getSnapshot().editingKind === 'tableCaption', { timeout: 20000 }).catch(() => {})
  await ready()
  await wait(600)
  const tableId = await page.evaluate(() => window.__editor.getSnapshot().editingId)
  await page.keyboard.type('試着の記録')
  await wait(200)
  const tab = await page.evaluate((id) => {
    const st = window.__state()
    const t = document.querySelector(`.page-viewport.front .data-table[data-table-id="${id}"] table`)?.getBoundingClientRect()
    const top = document.querySelector('.p-top').getBoundingClientRect().bottom
    const line = st.caretRect ?? { top: st.overlay.top, bottom: st.overlay.bottom }
    return {
      ...st,
      table: t ? { top: t.top, bottom: t.bottom } : null,
      tableShown: !!t && t.top >= line.bottom - 1 && t.bottom <= st.bar.top + 0.5,
      lineShown: line.top >= top - 0.5 && line.bottom <= st.bar.top + 0.5,
      tools: [...document.querySelectorAll('.direct-bar .db-table button')].map((b) => ({ name: b.textContent.trim(), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })),
    }
  }, tableId)
  const tabGap = await captionGap(page, tableId)
  await shotWithKeyboard(page, '3-table-title')
  check(
    '「表を入れる」で、表のタイトルを紙面の上で書き始め、タイトルの行とその下の表が、キーボードの上の道具より上に一緒に見える',
    tab.kind === 'tableCaption' && tab.onPaper && tab.focused && tab.text === '試着の記録' && tab.tableShown && tab.lineShown,
    JSON.stringify({ kind: tab.kind, text: tab.text, table: tab.table && [tab.table.top, tab.table.bottom].map(Math.round), line: tab.lineShown, bar: Math.round(tab.bar.top) }),
  )
  check('入れた表のタイトル：書いている間も、番号（表n.）が書く欄の前にあり、打った字はそのすぐ後ろ（1字分以内）', gapOk(tabGap) && tabGap.text === '試着の記録', gapDetail(tabGap))
  check(
    '表のタイトル・セルを書いている間は、キーボードの上の道具の2段目に表の道具（行を足す・列を足す・行を消す・列を消す・表の形・表を削除。どれも 44px 以上。mockups/v45 案A）',
    JSON.stringify(tab.tools.map((t) => t.name)) === JSON.stringify(['行を足す', '列を足す', '行を消す', '列を消す', '表の形', '表を削除']) && tab.tools.every((t) => t.w >= 44 && t.h >= 44),
    JSON.stringify(tab.tools),
  )

  // ---- 21. 表のセルも、紙面の上で書く。Enter はマスの中の改行（拡大したまま書き続ける）。隣のセルを押すと続けて書ける。「完了」で1ページ全体に ----
  const cells = await page.evaluate((id) => {
    const t = window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === id)
    return t.rows[1].cells.map((c) => c.id)
  }, tableId)
  await tapEl(page, `[data-cell-id="${cells[0]}"]`)
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 10000 }, cells[0]).catch(() => {})
  await wait(300)
  const cell = await page.evaluate(() => ({ ...window.__state(), tools: [...document.querySelectorAll('.direct-bar .db-table button')].map((b) => b.textContent.trim()) }))
  await page.keyboard.type('サテン')
  await page.keyboard.press('Enter')
  await page.keyboard.type('光沢')
  await wait(400)
  const cellEnter = await page.evaluate(() => window.__state())
  await tapEl(page, `[data-cell-id="${cells[1]}"]`)
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 10000 }, cells[1]).catch(() => {})
  await wait(300)
  const cell2 = await page.evaluate((id) => {
    const t = window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === id)
    return { ...window.__state(), value: t.rows[1].cells[0].text }
  }, tableId)
  check(
    '表のセルも、紙面の上で書く（下の書く欄は出ない。表の道具に「画像」も出る）。Enter はマスの中の改行で、拡大したまま同じマスを書き続け、隣のセルを押すと続けて書ける（書いた字は原稿に入る）',
    cell.kind === 'tableCell' && cell.onPaper && !cell.sheetOpen && cell.focused && cell.tools.includes('画像') && cellEnter.text === 'サテン\n光沢' && cellEnter.editing === cells[0] && cellEnter.zoomed && cell2.editing === cells[1] && cell2.onPaper && cell2.value === 'サテン\n光沢',
    JSON.stringify({ kind: cell.kind, onPaper: cell.onPaper, tools: cell.tools, afterEnter: [cellEnter.text, cellEnter.editing, cellEnter.zoomed], next: cell2.editing === cells[1], value: cell2.value }),
  )
  await page.tap('.direct-bar .db-done')
  await wait(300)
  const cellDone = await page.evaluate(() => window.__state())
  check('表のセルで「完了」：1ページ全体の表示に戻る', cellDone.editing === null && !cellDone.zoomed, JSON.stringify({ editing: cellDone.editing, zoomed: cellDone.zoomed }))
  await keyboard(page, 0)
  await ready()

  // ---- 22. 2本の指で紙面を広げる・縮める ----
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('p9'), 'none'))
  await ready()
  await wait(300)
  const topBar = await page.evaluate(() => {
    const r = document.querySelector('.p-top').getBoundingClientRect()
    return { h: r.height, font: getComputedStyle(document.querySelector('.p-title .title')).fontSize }
  })
  const mid = { x: 220, y: 420 }
  const pinch0 = await page.evaluate((m) => {
    const p = window.__page()
    const s = window.__editor.stage.scale
    return { s, c: { x: (m.x - p.left) / s, y: (m.y - p.top) / s }, page: window.__editor.getSnapshot().page }
  }, mid)
  await pinch(cdp, mid, 80, 200)
  const pinched = await page.evaluate((c) => {
    const p = window.__page()
    const s = window.__editor.stage.scale
    const r = document.querySelector('.p-top').getBoundingClientRect()
    return { ...window.__state(), at: { x: p.left + c.x * s, y: p.top + c.y * s }, topH: r.height, font: getComputedStyle(document.querySelector('.p-title .title')).fontSize, panX: window.__editor.stage.panX }
  }, pinch0.c)
  await page.screenshot({ path: `${OUT}/5-pinch-enlarged.png` })
  check(
    '2本の指で広げると、紙面だけが大きくなり（指の間の点は動かない）、上の帯は大きくならない。書き始めない・ページは送らない',
    pinched.zoomed && pinched.scale > pinch0.s * 2 && Math.abs(pinched.at.x - mid.x) < 4 && Math.abs(pinched.at.y - mid.y) < 4 && pinched.topH === topBar.h && pinched.font === topBar.font && pinched.editing === null && pinched.page === pinch0.page && pinched.unzoom,
    JSON.stringify({ s: [pinch0.s.toFixed(3), pinched.scale.toFixed(3)], at: [pinched.at.x, pinched.at.y].map(Math.round), mid, topH: pinched.topH, editing: pinched.editing, page: [pinch0.page, pinched.page] }),
  )
  // 広げたら、指1本で上下・左右に動かせる（ページは送らない・書き始めない）
  const scroll0 = await page.evaluate(() => ({ left: document.querySelector('.page-scroller').scrollLeft, top: document.querySelector('.page-scroller').scrollTop }))
  await drag(cdp, { x: 300, y: 500 }, { x: 150, y: 380 })
  const pan = await page.evaluate(() => ({ ...window.__state(), left: document.querySelector('.page-scroller').scrollLeft, top: document.querySelector('.page-scroller').scrollTop }))
  check(
    '広げたら、指1本で上下・左右に紙面を動かせる（ページは送らない・書き始めない）',
    pinched.panX && pan.left > scroll0.left + 50 && pan.top > scroll0.top + 50 && pan.page === pinch0.page && pan.editing === null,
    JSON.stringify({ scroll0, scroll: [pan.left, pan.top], page: pan.page, editing: pan.editing }),
  )
  // 縮めると、1ページ全体の表示まで（それより小さくはしない）
  await pinch(cdp, { x: 195, y: 420 }, 260, 40)
  const unpinched = await page.evaluate(() => window.__state())
  check(
    '2本の指で縮めると、1ページ全体の表示に戻る（それより小さくはしない）',
    !unpinched.zoomed && Math.abs(unpinched.scale - unpinched.fitScale) < 0.001 && unpinched.page === pinch0.page && unpinched.editing === null,
    JSON.stringify({ zoomed: unpinched.zoomed, scale: unpinched.scale, fit: unpinched.fitScale }),
  )
  // 段落の上で、2本の指を横に大きく動かしても：ページを送らない・書き始めない。そのあとのタップは、ふつうに書き始める
  const p9at = await page.evaluate(() => {
    const r = window.__frag('p9').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + 6 }
  })
  await pinch(cdp, p9at, 60, 90, { shift: { x: -160, y: 0 } })
  const noSide = await page.evaluate(() => window.__state())
  check(
    '段落の上で2本の指を横に大きく動かしても、ページを送らない・書き始めない',
    noSide.page === pinch0.page && noSide.editing === null,
    JSON.stringify({ page: [pinch0.page, noSide.page], editing: noSide.editing }),
  )
  if (noSide.zoomed) {
    await page.evaluate(() => window.__editor.setZoom(false))
    await wait(200)
  }
  await wait(300)
  await tapChar(page, 'p9', 3)
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p9', { timeout: 10000 }).catch(() => {})
  await wait(400)
  const afterPinchTap = await page.evaluate(() => window.__state())
  check('2本の指で広げ・縮めたあとのタップは、ふつうに書き始める', afterPinchTap.editing === 'p9' && afterPinchTap.onPaper && Math.abs(afterPinchTap.caret - 3) <= 1, JSON.stringify({ editing: afterPinchTap.editing, caret: afterPinchTap.caret }))

  // ---- 23. 書いている間に2本の指で広げる：書く字が大きくなり、カーソルと道具はそのまま。その大きさを覚えて、次に書くときも使う ----
  await keyboard(page, KB)
  await wait(400)
  const w0 = await page.evaluate(() => {
    const el = window.__editor.overlay.element
    const r = window.__charRect(el, 1)
    return { ...window.__state(), charW: r.right - r.left, barButtons: [...document.querySelectorAll('.direct-bar .db-row button')].map((b) => Math.round(b.getBoundingClientRect().height)) }
  })
  await pinch(cdp, { x: 195, y: (w0.caretRect.top + w0.caretRect.bottom) / 2 }, 80, 140)
  await wait(300)
  const w1 = await page.evaluate((key) => {
    const ed = window.__editor
    const el = ed.overlay.element
    const r = window.__charRect(el, 1)
    const c = ed.overlay.caretClientRect()
    return {
      ...window.__state(),
      charW: r.right - r.left,
      caretIn: !!c && c.top >= el.getBoundingClientRect().top - 1 && c.bottom <= el.getBoundingClientRect().bottom + 1,
      saved: Number(localStorage.getItem(key)),
      barButtons: [...document.querySelectorAll('.direct-bar .db-row button')].map((b) => Math.round(b.getBoundingClientRect().height)),
      topH: document.querySelector('.p-top').getBoundingClientRect().height,
    }
  }, ZOOM_KEY)
  await page.keyboard.type('大きく')
  await wait(200)
  const w2 = await page.evaluate(() => window.__state())
  await shotWithKeyboard(page, '6-writing-pinched')
  check(
    '書いている間に2本の指で広げると、書く字が大きくなる（書き続けられ、カーソルは書く欄の中）。キーボードの上の道具と上の帯は、大きさも場所も変わらない',
    w1.editing === 'p9' && w1.focused && w1.charW > w0.charW * 1.4 && w1.caretIn && Math.abs(w1.bar.bottom - (844 - KB)) < 1 && JSON.stringify(w1.barButtons) === JSON.stringify(w0.barButtons) && w1.topH === 48 && w2.text.includes('大きく'),
    JSON.stringify({ charW: [w0.charW.toFixed(1), w1.charW.toFixed(1)], caretIn: w1.caretIn, bar: w1.bar, buttons: [w0.barButtons, w1.barButtons], topH: w1.topH }),
  )
  check('書いている間に広げた大きさを、この端末に覚える（本文の幅に合わせる倍率の何倍か）', Math.abs(w1.saved - w1.scale / w1.textScale) < 0.01 && w1.saved > 1.3, JSON.stringify({ saved: w1.saved, ratio: (w1.scale / w1.textScale).toFixed(3) }))
  await page.tap('.direct-bar .db-done')
  await wait(400)
  const wDone = await page.evaluate(() => window.__state())
  check('広げた大きさで書いていても、「完了」で1ページ全体の表示に戻る', wDone.editing === null && !wDone.zoomed && Math.abs(wDone.scale - wDone.fitScale) < 0.001, JSON.stringify({ editing: wDone.editing, zoomed: wDone.zoomed }))
  await ready()
  await tapChar(page, 'p10', 4)
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p10', { timeout: 10000 }).catch(() => {})
  await wait(400)
  const w3 = await page.evaluate(() => {
    const ed = window.__editor
    const c = ed.overlay.caretClientRect()
    const s = document.querySelector('.page-scroller').getBoundingClientRect()
    return { ...window.__state(), caretInView: !!c && c.left >= s.left && c.left <= s.right }
  })
  check(
    '次に段落を押して書き始めると、覚えた大きさで開く（本文の幅に合わせる大きさではなく）。押した所は画面の中',
    w3.editing === 'p10' && w3.onPaper && Math.abs(w3.scale / w3.textScale - w1.saved) < 0.02 && w3.caretInView,
    JSON.stringify({ ratio: (w3.scale / w3.textScale).toFixed(3), saved: w1.saved, caretInView: w3.caretInView }),
  )
  await page.tap('.direct-bar .db-done')
  await wait(300)
  await keyboard(page, 0)
  await page.evaluate((key) => localStorage.removeItem(key), ZOOM_KEY)
  await ready()

  // ---- 24. 作品写真：押して選んでから指で動かす（選んでいない写真の上ではらうと、ページを送る） ----
  await page.evaluate(() =>
    window.__editor.update((r) => ({ ...r, workPhotos: [{ layout: 2, columns: 2, imageIds: ['g-photo1', 'g-process'] }] })),
  )
  await ready()
  const photoPage = await page.evaluate(() => window.__editor.pageOfArea('photos'))
  await page.evaluate((p) => window.__editor.goToPage(p, 'none'), photoPage)
  await ready()
  await wait(300)
  const slotPt = (i) =>
    page.evaluate((i) => {
      const r = document.querySelector(`.page-viewport.front [data-photo-slot="${i}"] img`).getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }, i)
  const positions = () => page.evaluate(() => JSON.stringify(window.__editor.getSnapshot().report.workPhotos[0].positions ?? []))
  const pos0 = await positions()
  const s0 = await slotPt(0)
  await drag(cdp, { x: s0.x - 40, y: s0.y }, { x: s0.x + 60, y: s0.y })
  const swiped = await page.evaluate(() => window.__state())
  const pos1 = await positions()
  check(
    '作品写真：選んでいない写真の上で左右にはらうと、ページを送る（写真の見える所は動かない）',
    swiped.page === photoPage - 1 && pos1 === pos0,
    JSON.stringify({ page: [photoPage, swiped.page], positions: [pos0, pos1] }),
  )
  await page.evaluate((p) => window.__editor.goToPage(p, 'none'), photoPage)
  await ready()
  await wait(300)
  const sel = await slotPt(0)
  await page.touchscreen.tap(sel.x, sel.y)
  await wait(400)
  const picked = await page.evaluate(() => ({ ...window.__state(), band: document.querySelector('.page-band')?.textContent ?? '', touch: getComputedStyle(document.querySelector('.page-viewport.front [data-photo-slot="0"] img')).touchAction, other: getComputedStyle(document.querySelector('.page-viewport.front [data-photo-slot="1"] img')).touchAction }))
  await drag(cdp, { x: sel.x + 30, y: sel.y }, { x: sel.x - 30, y: sel.y })
  const dragged = await page.evaluate(() => window.__state())
  const pos2 = await positions()
  check(
    '作品写真：押すと写真を選び（帯に「指でずらして、トリミングを調整」）、選んだ写真を指でずらすと、トリミングが変わる（ページは送らない）',
    picked.selection?.kind === 'photos' && picked.selection.index === 0 && picked.band.includes('指でずらして、トリミングを調整') && picked.touch === 'none' && picked.other === 'auto' && dragged.page === photoPage && pos2 !== pos1,
    JSON.stringify({ selection: picked.selection, band: picked.band, touch: [picked.touch, picked.other], page: dragged.page, positions: pos2 }),
  )
  const s1 = await slotPt(1)
  await drag(cdp, { x: s1.x - 40, y: s1.y }, { x: s1.x + 60, y: s1.y })
  const swiped2 = await page.evaluate(() => window.__state())
  const pos3 = await positions()
  check(
    '作品写真：1枚目を選んでいても、選んでいない2枚目の上ではらうと、ページを送る（2枚目は動かない）',
    swiped2.page === photoPage - 1 && JSON.parse(pos3)[1] == null,
    JSON.stringify({ page: swiped2.page, positions: pos3 }),
  )
  await page.evaluate((p) => window.__editor.goToPage(p, 'none'), photoPage)
  await ready()
  await wait(300)
  const sel2 = await slotPt(0)
  await page.touchscreen.tap(sel2.x, sel2.y)
  await wait(400)
  const pos4 = await positions()
  await pinch(cdp, sel2, 60, 160)
  const photoPinch = await page.evaluate(() => window.__state())
  const pos5 = await positions()
  check('作品写真：選んだ写真の上で2本の指を広げると、紙面が大きくなる（写真の見える所は動かない）', photoPinch.zoomed && pos5 === pos4, JSON.stringify({ zoomed: photoPinch.zoomed, positions: [pos4, pos5] }))
  // 拡大している間は、左右にはらってもページを送らない（今までどおり）
  await drag(cdp, { x: 320, y: 420 }, { x: 60, y: 424 })
  const zoomedSwipe = await page.evaluate(() => window.__state())
  check('拡大している間は、左右にはらってもページをめくらない（今までどおり）', zoomedSwipe.page === photoPage && zoomedSwipe.zoomed, JSON.stringify({ page: zoomedSwipe.page, zoomed: zoomedSwipe.zoomed }))
  await context.close()

  // ---- 25. 予備の ?direct=0：下から出る書く欄（覚える）。?direct=1 でふつうに戻す ----
  const fallback = await openPhone(browser, { query: '&direct=0' })
  const fbReady = readyOf(fallback.page)
  const fb = await fallback.page.evaluate((key) => ({ on: document.querySelector('.app').classList.contains('phone-direct'), saved: localStorage.getItem(key), search: location.search, badge: !!document.querySelector('.direct-badge') }), SHEET_KEY)
  await fallback.page.waitForSelector('.guide.step-course .g-opts button', { timeout: 60000 })
  await fallback.page.evaluate(() => document.querySelector('.g-opts button').click())
  await fallback.page.waitForSelector('.guide.step-word .g-word-opt.no')
  await fallback.page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await fallback.page.waitForSelector('.g-later')
  await fallback.page.evaluate(() => document.querySelector('.g-later').click())
  await fbReady()
  await fallback.page.evaluate(() => window.__editor.finishEditing())
  await fallback.page.evaluate(setupWriting)
  await wait(300)
  await fbReady()
  await fallback.page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('p9'), 'none'))
  await fbReady()
  await tapChar(fallback.page, 'p9', 3)
  await fallback.page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p9', { timeout: 10000 })
  await wait(300)
  const fbEdit = await fallback.page.evaluate(() => ({ ...window.__state(), bar: !!document.querySelector('.direct-bar') }))
  await fallback.page.tap('.edit-sheet .done')
  await wait(200)
  await fallback.page.reload({ waitUntil: 'networkidle0' })
  await fbReady()
  const fbAgain = await fallback.page.evaluate(() => document.querySelector('.app').classList.contains('phone-direct'))
  await fallback.page.goto(`${APP}/?direct=1&nodrive`, { waitUntil: 'networkidle0' })
  await fbReady()
  const fbBack = await fallback.page.evaluate((key) => ({ on: document.querySelector('.app').classList.contains('phone-direct'), saved: localStorage.getItem(key), search: location.search }), SHEET_KEY)
  check(
    '予備の ?direct=0：この端末だけ、下から出る書く欄で書く（覚える。アドレスの印は外す。札は出ない）。読み込み直してもそのまま。?direct=1 でふつう（紙面で直接書く）に戻す',
    !fb.on && fb.saved === '1' && fb.search === '?nodrive' && !fb.badge && fbEdit.sheetOpen && fbEdit.sheet && fbEdit.inSheetHost && !fbEdit.onPaper && !fbEdit.bar && !fbAgain && fbBack.on && fbBack.saved === null && fbBack.search === '?nodrive',
    JSON.stringify({ fb, sheet: [fbEdit.sheetOpen, fbEdit.inSheetHost, fbEdit.onPaper], again: fbAgain, back: fbBack }),
  )
  await fallback.context.close()

  // ---- 26. Android でも紙面で直接書く。Android は画面の設定を変えない ----
  const android = await openPhone(browser, { ua: ANDROID })
  await android.page.waitForSelector('.guide', { timeout: 60000 }).catch(() => {})
  const aMeta = await android.page.evaluate(() => ({ on: document.querySelector('.app')?.classList.contains('phone-direct'), meta: document.querySelector('meta[name="viewport"]').content }))
  check('Android でも紙面で直接書く。Android は書く欄に入っても拡大しないので、画面の設定は変えない', aMeta.on && !aMeta.meta.includes('maximum-scale'), JSON.stringify(aMeta))
  await android.context.close()
}

// これだけを動かす：node scripts/e2e/phoneDirect.mjs
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { withEdge } = await import('../poc/edge.mjs')
  const results = []
  const check = (name, ok, detail = '') => {
    results.push(ok)
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
  }
  await withEdge((browser) => phoneDirectPhone(browser, check))
  const failed = results.filter((ok) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} 件 合格`)
  process.exitCode = failed ? 1 : 0
}
