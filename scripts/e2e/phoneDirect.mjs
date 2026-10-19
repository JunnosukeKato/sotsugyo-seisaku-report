// 試作：スマホで紙面に直接書く（Edge を自動で操作する。phone.mjs から呼ぶ）。
// 依頼者の願い：今の「下から出る書く欄」と、Google ドキュメントのアプリのように紙面の上でそのまま書くやり方を、自分のスマホで比べたい（2026-10-20）。
// 試作は、リンクの ?direct=1 で入り、その端末に覚える（?direct=0・メニューの「下の書く欄に戻す」でやめる。app/phoneDirect.ts）。
// - 印で入る・やめる・覚える。入っている間は、上の帯の下に小さな印（紙面に重ねない）
// - 段落をタップすると、紙面を拡大して（1字 10px ほど）、押した字の所から紙面の上で書く（下の書く欄は出ない）。打った字はすぐ紙面に出る
// - キーボードのすぐ上の細い道具（キーボードは visualViewport の高さを変えて仮に出す）。書いている行はキーボード・道具に隠れない
// - 「戻す」「やり直す」・Enter で段落を分ける・先頭の Backspace でつなげる・日本語の変換・段落に打った見出し・見出しの Enter・
//   Android のような改行・消す入力だけの Enter・Backspace・「完了」（拡大したまま）・紙面の外を押して閉じる・拡大中ははらってもめくらない
// - 表のセルは、今までどおり下の書く欄。印がなければ、今までどおり（下の書く欄）
// これだけを動かすときは node scripts/e2e/phoneDirect.mjs。画面の写真は poc-output/phone-direct/（390×844）
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { stubConfig } from './configStub.mjs'
import { setupWriting } from './sampleReport.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/phone-direct'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
/** 試作を覚えておく場所（app/phoneDirect.ts） */
const KEY = 'sotsugyo-seisaku-report-phone-direct'
/** 仮に出すキーボードの高さ（iPhone の日本語のキーボードほど） */
const KB = 336

/** スマホの画面で開く（はじめての案内は「あとで」で閉じる。fresh：この端末に原稿がない） */
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
        sheetOpen: !!document.querySelector('.edit-sheet.open'),
        inScroller: !!el.closest('.page-scroller'),
        inSheetHost: !!el.closest('.edit-sheet'),
        focused: document.activeElement === el,
        text: ed.overlay.text,
        caret: ed.overlay.caret,
        overlay: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        bar: bar ? { top: bar.top, bottom: bar.bottom } : null,
        caretRect: caret ? { left: caret.left, top: caret.top, bottom: caret.bottom } : null,
        scale: Number(getComputedStyle(document.querySelector('.stage')).getPropertyValue('--s')),
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

/** はじめての案内を「あとで」で閉じて、見本の原稿を入れる */
async function startSample(page, ready) {
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
}

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

/** 紙面の欄 id の i 文字目（見ているページ）の真ん中を指で押す（左半分を押すと、その字の前にカーソルが来る：left） */
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

export async function phoneDirectPhone(browser, check) {
  // ---- 1. 印で入る・覚える・小さな印（iPhone） ----
  const { context, page } = await openPhone(browser, { query: '&direct=1' })
  const ready = readyOf(page)
  const flag = await page.evaluate((key) => ({ search: location.search, saved: localStorage.getItem(key), meta: document.querySelector('meta[name="viewport"]').content }), KEY)
  await startSample(page, ready)
  await page.reload({ waitUntil: 'networkidle0' })
  await ready()
  // 見本の画像を入れ直す（画面の写真のため。読み込み直すと、見本の画像は灰色の仮の画像になる）
  await page.evaluate(setupWriting)
  await wait(300)
  await ready()
  await page.evaluate(() => window.__countRenders())
  const badge = await page.evaluate(() => {
    const b = document.querySelector('.direct-badge')
    const r = b?.getBoundingClientRect()
    const rect = (sel) => document.querySelector(sel)?.getBoundingClientRect()
    const page = rect('.page-viewport.front [data-vivliostyle-page-container].is-current')
    const overlaps = (q) => !!q && !!r && q.top < r.bottom - 0.5 && q.bottom > r.top + 0.5 && q.left < r.right - 0.5 && q.right > r.left + 0.5
    return {
      on: document.querySelector('.app')?.classList.contains('phone-direct'),
      text: b?.textContent ?? '',
      inside: !!r && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
      height: r ? Math.round(r.height) : 0,
      covers: ['.p-top', '.p-nav', '.stage', '.pager'].filter((s) => overlaps(rect(s))).concat(overlaps(page) ? ['page'] : []),
      oneLine: (() => { const s = b?.querySelector('span'); return !!s && s.getBoundingClientRect().height < 22 })(),
    }
  })
  check(
    '試作：?direct=1 で入り、この端末に覚える（アドレスからは印を外し、ほかの印 ?nodrive は残す）。読み込み直しても続く',
    flag.search === '?nodrive' && flag.saved === '1' && badge.on,
    JSON.stringify({ flag, on: badge.on }),
  )
  check(
    '試作：上の帯の下に小さな印「試作：紙面で直接書く」（紙面・上の帯・下のタブ・ページ送りに重ならない。1行）',
    badge.text === '試作：紙面で直接書く' && badge.inside && badge.covers.length === 0 && badge.height <= 24 && badge.oneLine,
    JSON.stringify(badge),
  )
  check('試作：iPhone では、書く欄に入っても画面が勝手に拡大されないよう、画面の設定に maximum-scale=1 を足す', flag.meta.includes('maximum-scale=1'), flag.meta)

  // ---- 2. 段落をタップ：拡大して、押した字の所から紙面の上で書く（下の書く欄は出ない） ----
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('p9'), 'none'))
  await ready()
  await wait(300)
  await page.screenshot({ path: `${OUT}/1-badge.png` })
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
    const ed = window.__editor
    const el = ed.overlay.element
    // 1字の幅（拡大した紙面の上で）
    const r = window.__charRect(el, 2)
    const frag = window.__frag('p9')
    const f = frag.getBoundingClientRect()
    const buttons = [...document.querySelectorAll('.direct-bar button')].map((b) => {
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
          const r = [...range.getClientRects()].find((x) => x.height > 0)
          if (r) lines.add(Math.round(r.top))
        }
      }
      return { name: b.textContent.trim(), w: Math.round(q.width), h: Math.round(q.height), oneLine: lines.size === 1 }
    })
    return { ...st, charW: r ? r.right - r.left : 0, fragTop: f.top, fragLeft: f.left, fragHidden: getComputedStyle(frag).visibility === 'hidden', buttons }
  })
  check(
    '試作：段落をタップすると、紙面が拡大し（1字 10px ほど）、紙面の上の書く欄で書き始める（下の書く欄は出ない。書く欄は紙面の表示枠の中）',
    !before.zoomed && opened.zoomed && opened.onPaper && !opened.sheet && !opened.sheetOpen && opened.inScroller && !opened.inSheetHost && opened.focused && opened.charW > 9 && opened.charW < 11,
    JSON.stringify({ zoomed: opened.zoomed, onPaper: opened.onPaper, sheetOpen: opened.sheetOpen, inScroller: opened.inScroller, focused: opened.focused, charW: opened.charW.toFixed(2), scale: opened.scale.toFixed(3) }),
  )
  check(
    '試作：カーソルは押した字の所に来る。書く欄は紙面の段落とちょうど同じ位置に重なり、紙面の段落は隠れる',
    Math.abs(opened.caret - at) <= 1 && Math.abs(opened.overlay.top - opened.fragTop) < 1.5 && Math.abs(opened.overlay.left - opened.fragLeft) < 1.5 && opened.fragHidden,
    JSON.stringify({ at, caret: opened.caret, overlay: [opened.overlay.left, opened.overlay.top].map(Math.round), frag: [opened.fragLeft, opened.fragTop].map(Math.round) }),
  )
  check(
    '試作：押した行は、押した高さのあたりに来る（キーボードがまだ出ていないので、隠れない画面の上の方）',
    !!opened.caretRect && opened.caretRect.top > 70 && opened.caretRect.bottom < 844 * 0.6 && Math.abs((opened.caretRect.top + opened.caretRect.bottom) / 2 - tap.y) < 844 * 0.6,
    JSON.stringify({ tapY: Math.round(tap.y), caret: opened.caretRect && [opened.caretRect.top, opened.caretRect.bottom].map(Math.round) }),
  )
  const names = opened.buttons.map((b) => b.name)
  check(
    '試作：キーボードの上の道具に「戻す」「やり直す」「図を入れる」「表を入れる」「完了」。どれも 44px 四方以上で、名前は1行',
    JSON.stringify(names) === JSON.stringify(['戻す', 'やり直す', '図を入れる', '表を入れる', '完了']) && opened.buttons.every((b) => b.w >= 44 && b.h >= 44 && b.oneLine),
    JSON.stringify(opened.buttons),
  )

  // ---- 3. キーボードを出す：道具はキーボードのすぐ上。書いている行は隠れない ----
  await keyboard(page, KB)
  await wait(400)
  const kb = await page.evaluate(() => ({ ...window.__state(), badgeBottom: document.querySelector('.direct-badge').getBoundingClientRect().bottom }))
  check(
    '試作：キーボードを出すと、道具はキーボードのすぐ上（visualViewport）。書いている行は、道具より上・上の帯より下に見えている',
    !!kb.bar && Math.abs(kb.bar.bottom - (844 - KB)) < 1 && !!kb.caretRect && kb.caretRect.bottom <= kb.bar.top - 2 && kb.caretRect.top >= kb.badgeBottom,
    JSON.stringify({ bar: kb.bar, caret: kb.caretRect, badgeBottom: kb.badgeBottom }),
  )
  await fakeKeyboard(page, true)
  await page.screenshot({ path: `${OUT}/2-editing-before.png` })
  await fakeKeyboard(page, false)

  // ---- 4. 打つと、組み直すのを待たずに、紙面の上にその字が出る ----
  await page.keyboard.type('あいうえお')
  const typed = await page.evaluate((at) => ({ ...window.__state(), report: window.__text('p9'), renders: window.__renders, fragHidden: getComputedStyle(window.__frag('p9')).visibility === 'hidden', at }), at)
  check(
    '試作：打つと、その字がすぐ紙面の上（書く欄）に出て、原稿にも入る（組み直すのを待たない）',
    typed.text === before.text.slice(0, at) + 'あいうえお' + before.text.slice(at) && typed.report === typed.text && typed.renders === before.renders && typed.fragHidden && typed.caret === at + 5,
    JSON.stringify({ around: typed.text.slice(at - 2, at + 8), report: typed.report === typed.text, renders: [before.renders, typed.renders], caret: typed.caret }),
  )
  await fakeKeyboard(page, true)
  await page.screenshot({ path: `${OUT}/3-editing-after.png` })
  await fakeKeyboard(page, false)
  // 行が増えるまで打つ：後ろの段落（p10）が、組み直す前に下がる。書いている行は隠れない
  // （組み直すのは止めておく。打つ手が止まって書く欄を測り直したあとの折り返しを、組み直した紙面と比べるため）
  await page.evaluate(() => (window.__editor.scheduleRender = () => {}))
  const p10Before = await page.evaluate(() => window.__frag('p10').getBoundingClientRect().top)
  await page.keyboard.type('かきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん、「漢字」とABC123も。')
  await wait(200)
  const grown = await page.evaluate(() => ({ ...window.__state(), p10: window.__frag('p10').getBoundingClientRect().top }))
  check(
    '試作：段落の行が増えると、後ろの段落がその分下がり（書く欄の下端のすぐ下）、書いている行は道具・キーボードに隠れない',
    grown.p10 > p10Before + 5 && Math.abs(grown.p10 - grown.overlay.bottom) < 1.5 && !!grown.caretRect && grown.caretRect.bottom <= grown.bar.top - 2,
    JSON.stringify({ p10: [Math.round(p10Before), Math.round(grown.p10)], overlayBottom: Math.round(grown.overlay.bottom), caret: grown.caretRect && Math.round(grown.caretRect.bottom), bar: Math.round(grown.bar.top) }),
  )
  // 指で紙面を動かしても、書く欄は紙面と一緒に動く（遅れてずれない。書く欄は紙面の表示枠の中）
  const scrolled = await page.evaluate(() => {
    const ed = window.__editor
    const p = ed.renderer.pageView.pages()[ed.getSnapshot().page]
    const gap = () => ed.overlay.element.getBoundingClientRect().top - p.getBoundingClientRect().top
    const before = gap()
    ed.scroller.scrollTop -= 40
    // スクロールの知らせ（scroll）を待たずに測る
    const after = gap()
    ed.scroller.scrollTop += 40
    return { before, after }
  })
  check('試作：紙面を上下に動かしても、書く欄は紙面と一緒に動く（ずれない）', Math.abs(scrolled.before - scrolled.after) < 0.5, JSON.stringify(scrolled))
  // 打つ手が止まると、書く欄を紙面と同じ組み方で測り直す（打つたびには測らない）。その折り返しが、組み直した紙面と同じ
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
    '試作：打つ手が止まって書く欄を測り直すと、行の始まりの字が、組み直した紙面と同じ（カーソルの位置もそのまま）',
    JSON.stringify(typedStarts.starts) === JSON.stringify(paperStarts) && typedStarts.caret === grown.caret && typedStarts.focused,
    JSON.stringify({ typed: typedStarts.starts, paper: paperStarts, caret: [grown.caret, typedStarts.caret] }),
  )

  // ---- 5. 道具の「戻す」「やり直す」（書く欄の中で打った字。キーボードは出たまま） ----
  const typedAll = grown.text
  await page.tap('.direct-bar button:nth-child(1)')
  await wait(200)
  const undone = await page.evaluate(() => window.__state())
  await page.tap('.direct-bar button:nth-child(2)')
  await wait(200)
  const redone = await page.evaluate(() => ({ ...window.__state(), report: window.__text('p9') }))
  check(
    '試作：道具の「戻す」で打った字が戻り、「やり直す」でまた入る（書いたまま。書く欄から出ない）',
    undone.text === before.text && undone.editing === 'p9' && undone.focused && redone.text === typedAll && redone.report === typedAll && redone.focused,
    JSON.stringify({ undone: undone.text === before.text, focused: [undone.focused, redone.focused], redone: redone.text === typedAll }),
  )

  // ---- 6. Enter で段落を分ける（「。」を自動で付ける）・先頭の Backspace でつなげ直す ----
  // ほかの所を書いて、紙面が書いた字に追いつくのを待つ
  await page.waitForFunction((t) => window.__frag('p9') && window.__editor.renderer.pageView.fragments('p9').map((f) => f.textContent).join('') === t, { timeout: 30000 }, typedAll)
  await ready()
  const cut = typedAll.indexOf('あいうえお') + 5
  await page.evaluate((c) => window.__editor.overlay.setCaret(c), cut)
  await page.keyboard.press('Enter')
  await wait(300)
  const split = await page.evaluate((cut) => ({ ...window.__state(), p9: window.__text('p9'), next: window.__text(window.__editor.getSnapshot().editingId), cut }), cut)
  check(
    '試作：Enter で段落を分けると、続きを新しい段落の始めから紙面の上で書く（前の段落の終わりには「。」が付く。キーボードは出たまま）',
    split.editing !== 'p9' && split.onPaper && split.focused && split.p9 === `${typedAll.slice(0, cut)}。` && split.next === typedAll.slice(cut) && split.caret === 0,
    JSON.stringify({ editing: split.editing, p9: split.p9?.slice(-8), next: split.next?.slice(0, 8), caret: split.caret, focused: split.focused }),
  )
  await page.keyboard.press('Backspace')
  await wait(300)
  const merged = await page.evaluate(() => ({ ...window.__state(), p9: window.__text('p9') }))
  check(
    '試作：分けた直後に、先頭で Backspace を押すと、前の段落につなげ直す（自動で付けた「。」も消える）',
    merged.editing === 'p9' && merged.p9 === typedAll && merged.caret === cut && merged.focused && merged.onPaper,
    JSON.stringify({ editing: merged.editing, same: merged.p9 === typedAll, caret: merged.caret, cut }),
  )

  // ---- 7. Android のように、Enter・Backspace のキーの知らせがなく、改行・消す入力だけが来たとき ----
  await page.evaluate(() => window.__editor.overlay.setCaret(window.__editor.overlay.text.length))
  const lenNow = await page.evaluate(() => window.__editor.overlay.text.length)
  await page.evaluate(() => window.__editor.overlay.element.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertParagraph', bubbles: true, cancelable: true })))
  await wait(300)
  const aSplit = await page.evaluate(() => ({ ...window.__state(), p9: window.__text('p9') }))
  await page.evaluate(() => window.__editor.overlay.element.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true })))
  await wait(300)
  const aMerge = await page.evaluate(() => ({ ...window.__state(), p9: window.__text('p9') }))
  check(
    '試作：Android のように改行の入力だけが来ても段落を分け、先頭で消す入力だけが来ても前の段落につなげる',
    aSplit.editing !== 'p9' && aSplit.onPaper && aSplit.text === '' && aMerge.editing === 'p9' && aMerge.p9 === typedAll && aMerge.caret === lenNow,
    JSON.stringify({ split: aSplit.editing, merged: aMerge.editing, same: aMerge.p9 === typedAll, caret: [aMerge.caret, lenNow] }),
  )

  // ---- 8. 日本語の変換：変換中の字も紙面の上に出て、確定すると原稿に入る ----
  const cdp = await page.createCDPSession()
  await page.evaluate((c) => window.__editor.overlay.setCaret(c), cut)
  await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 })
  await cdp.send('Input.imeSetComposition', { text: 'かん', selectionStart: 2, selectionEnd: 2 })
  const composing = await page.evaluate(() => ({ ...window.__state(), report: window.__text('p9') }))
  await cdp.send('Input.insertText', { text: '漢' })
  await wait(100)
  const composed = await page.evaluate(() => ({ ...window.__state(), report: window.__text('p9') }))
  const withKan = typedAll.slice(0, cut) + '漢' + typedAll.slice(cut)
  check(
    '試作：日本語の変換中の字も紙面の上の書く欄に出て（原稿にはまだ入れない）、確定すると原稿に入る',
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
    '試作：段落に「ⅳ．試着」と打って Enter で小見出しになり、続きは見出しの下の段落を紙面の上で書く（知らせも出る）',
    headed.titles.includes('試着') && headed.onPaper && headed.focused && headed.text === '' && headed.toast.includes('小見出し'),
    JSON.stringify({ titles: headed.titles, onPaper: headed.onPaper, toast: headed.toast }),
  )

  // ---- 10. 「完了」：書き終える（紙面は拡大したまま）。組み直した紙面に書いた字が出る ----
  await page.tap('.direct-bar .db-done')
  await wait(300)
  const done = await page.evaluate(() => ({ ...window.__state(), bar: !!document.querySelector('.direct-bar'), unzoom: !!document.querySelector('.unzoom') }))
  await ready()
  await wait(300)
  const shownAfter = await page.evaluate((t) => {
    const all = window.__editor.renderer.pageView.fragments('p9').filter((f) => f.closest('.page-viewport.front'))
    return { same: all.map((f) => f.textContent).join('') === t, hidden: all.some((f) => getComputedStyle(f).visibility === 'hidden') }
  }, withKan)
  check(
    '試作：「完了」で書き終える（キーボードの上の道具は消え、紙面は拡大したまま「ページ全体に戻す」が出る）。組み直した紙面に、書いた字が出る',
    done.editing === null && !done.bar && done.zoomed && done.unzoom && !done.focused && shownAfter.same && !shownAfter.hidden,
    JSON.stringify({ editing: done.editing, bar: done.bar, zoomed: done.zoomed, unzoom: done.unzoom, focused: done.focused, shownAfter }),
  )

  // ---- 10b. 書いている間にほかの段落をタップ：その段落へ移って書く（その間、書く欄からフォーカスが外れない＝キーボードが閉じない） ----
  // 見ているページの、字のある段落を2つ
  const [pa, pb] = await page.evaluate(() =>
    [...document.querySelectorAll('.page-viewport.front section.body p[data-block-id]')]
      .map((e) => e.dataset.blockId)
      .filter((id, i, all) => all.indexOf(id) === i && window.__frag(id) && (window.__text(id) ?? '').length > 10)
      .slice(0, 2),
  )
  await page.evaluate((id) => window.__frag(id).scrollIntoView({ block: 'center' }), pa)
  await wait(200)
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
    '試作：書いている間にほかの段落をタップすると、その段落の押した所へ移って書く（その間、書く欄からフォーカスが外れない＝キーボードが閉じない）',
    moved.editing === pb && moved.onPaper && moved.focused && moved.blurs === 0 && Math.abs(moved.caret - 5) <= 1,
    JSON.stringify({ pa, pb, editing: moved.editing, focused: moved.focused, blurs: moved.blurs, caret: moved.caret }),
  )
  await page.tap('.direct-bar .db-done')
  await wait(300)
  await ready()

  // ---- 11. 見出しをタップ：紙面の上で書き、Enter で後ろに段落ができる ----
  await page.evaluate(() => window.__frag('s5').scrollIntoView({ block: 'center' }))
  await wait(200)
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
    '試作：見出しをタップしても紙面の上で書き（下の書く欄は出ない）、Enter で見出しのすぐ後ろに段落ができて、続けて書く',
    heading.onPaper && heading.kind === 'subheading' && !heading.sheetOpen && afterHeading.title === '袖の刺繍（改）' && afterHeading.editing === afterHeading.nextId && afterHeading.onPaper && afterHeading.focused,
    JSON.stringify({ heading: [heading.onPaper, heading.kind, heading.sheetOpen], title: afterHeading.title, editing: afterHeading.editing, next: afterHeading.nextId }),
  )

  // ---- 11b. ページの終わりの段落に書き足して、次のページへ続く：次のページへ移り、書いている行がキーボードの上に見えたまま、続けて書ける ----
  await page.tap('.direct-bar .db-done')
  await wait(300)
  await ready()
  await page.evaluate(() => window.__editor.setZoom(false))
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('p12'), 'none'))
  await ready()
  await wait(300)
  await tapChar(page, 'p12', 1)
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p12', { timeout: 10000 })
  await wait(300)
  const contStart = await page.evaluate(() => {
    const ov = window.__editor.overlay
    ov.setCaret(ov.text.length)
    return { page: window.__editor.getSnapshot().page, len: ov.text.length }
  })
  await wait(200)
  // 次のページへ続くまで、1行ほどずつ書き足す
  for (let k = 0; k < 40; k++) {
    await page.keyboard.sendCharacter('ズボンの裾には、動いたときに広がりすぎないよう、細いテープを入れて形を整えた。')
    await wait(150)
    if (await page.evaluate((p) => window.__editor.getSnapshot().page > p, contStart.page)) break
  }
  await page.waitForFunction((p) => window.__editor.getSnapshot().page > p, { timeout: 20000 }, contStart.page).catch(() => {})
  await wait(600)
  const cont = await page.evaluate(() => {
    const st = window.__state()
    const ed = window.__editor
    return { ...st, caretPage: ed.pageOfBlock('p12', ed.overlay.caret), len: ed.overlay.text.length }
  })
  await fakeKeyboard(page, true)
  await page.screenshot({ path: `${OUT}/5-next-page.png` })
  await fakeKeyboard(page, false)
  check(
    '試作：ページの終わりの段落に書き足して次のページへ続くと、次のページへ移り、書いている行はキーボードの上の道具より上に見えたまま（書き続けられる）',
    cont.page > contStart.page && cont.caretPage === cont.page && cont.editing === 'p12' && cont.onPaper && cont.focused && !!cont.caretRect && cont.caretRect.top >= 70 && cont.caretRect.bottom <= cont.bar.top - 2,
    JSON.stringify({ from: contStart.page, page: cont.page, caretPage: cont.caretPage, caret: cont.caretRect && [cont.caretRect.top, cont.caretRect.bottom].map(Math.round), bar: cont.bar && Math.round(cont.bar.top), focused: cont.focused }),
  )

  // ---- 11c. 下のタブの「追加」→「小見出し」：足した小見出しを、すぐ紙面の上で書き始める（追加の欄を閉じても、書く欄から出ない） ----
  await page.tap('.direct-bar .db-done')
  await wait(300)
  await ready()
  await page.evaluate(() => window.__editor.setZoom(false))
  await page.tap('.p-nav .add')
  await page.waitForSelector('.add-grid .tb')
  await wait(300)
  await page.tap('.add-grid .tb')
  await wait(800)
  const added = await page.evaluate(() => window.__state())
  await page.keyboard.type('採寸')
  await wait(200)
  const addedTyped = await page.evaluate(() => window.__state())
  check(
    '試作：「追加」→「小見出し」で、足した小見出しを紙面の上ですぐ書き始める（追加の欄を閉じても、書く欄から出ない）',
    added.kind === 'subheading' && added.onPaper && added.zoomed && added.focused && addedTyped.text === '採寸' && addedTyped.focused,
    JSON.stringify({ kind: added.kind, onPaper: added.onPaper, zoomed: added.zoomed, focused: [added.focused, addedTyped.focused], text: addedTyped.text }),
  )

  // ---- 11d. 抄録の段落も、紙面を拡大して紙面の上で書く ----
  await page.tap('.direct-bar .db-done')
  await wait(300)
  await ready()
  await page.evaluate(() => window.__editor.setZoom(false))
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
    '試作：抄録の段落をタップしても、紙面を拡大して、押した所から紙面の上で書く（打った字はすぐ出る）',
    abs.kind === 'abstractParagraph' && abs.onPaper && abs.zoomed && !abs.sheetOpen && abs.focused && Math.abs(abs.caret - 6) <= 1 && absTyped.text.includes('（抄録）') && absTyped.report === absTyped.text,
    JSON.stringify({ kind: abs.kind, onPaper: abs.onPaper, zoomed: abs.zoomed, sheetOpen: abs.sheetOpen, caret: abs.caret, typed: absTyped.text.slice(abs.caret - 2, abs.caret + 6) }),
  )

  // ---- 12. 紙面の外（紙面の下の灰色の所）を押すと、書き終える（キーボードをしまって、紙面のいちばん下まで動かしてから） ----
  await keyboard(page, 0)
  // 打った見出しの組み直しが終わるのを待つ（終わると、書いている所のページを見せ直すため）
  await ready()
  await wait(300)
  await page.evaluate(() => {
    const sc = document.querySelector('.page-scroller')
    sc.scrollTop = sc.scrollHeight
  })
  await wait(300)
  const grey = await page.evaluate(() => {
    const p = window.__editor.renderer.pageView.pages()[window.__editor.getSnapshot().page].getBoundingClientRect()
    const bar = document.querySelector('.direct-bar').getBoundingClientRect()
    return { x: 195, y: (p.bottom + bar.top) / 2, pageBottom: Math.round(p.bottom), barTop: Math.round(bar.top) }
  })
  await page.touchscreen.tap(grey.x, grey.y)
  await wait(400)
  const closedOut = await page.evaluate(() => window.__state())
  check('試作：紙面の外（紙面の下の灰色の所）を押すと、書き終える（書く欄を閉じる）', grey.barTop - grey.pageBottom > 20 && closedOut.editing === null && !closedOut.focused, JSON.stringify({ grey, editing: closedOut.editing }))

  // ---- 13. 拡大している間は、指ではらってもページをめくらない ----
  await ready()
  const pageNow = await page.evaluate(() => window.__editor.getSnapshot().page)
  const swipe = async () => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 320, y: 400 }] })
    for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 320 - i * 40, y: 402 }] })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await wait(600)
  }
  await swipe()
  const afterSwipe = await page.evaluate(() => ({ page: window.__editor.getSnapshot().page, zoomed: window.__editor.getSnapshot().zoomed }))
  check('試作：拡大している間は、左右にはらってもページをめくらない（今までどおり）', afterSwipe.page === pageNow && afterSwipe.zoomed, JSON.stringify({ pageNow, afterSwipe }))

  // ---- 14. 表のセルは、今までどおり下の書く欄で書く ----
  await keyboard(page, 0)
  await page.evaluate(() => window.__editor.setZoom(false))
  await page.evaluate(() => {
    const ed = window.__editor
    const table = ed.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.type === 'table')
    window.__cellId = table.rows[1].cells[1].id
    return ed.goToPage(ed.pageOfBlock(window.__cellId), 'none')
  })
  await ready()
  await wait(300)
  const cellPt = await page.evaluate(() => {
    const r = document.querySelector(`.page-viewport.front [data-cell-id="${window.__cellId}"]`).getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  // 見出しにした知らせ（画面の下）がセルに重なっていれば、消えるまで待つ
  await page.waitForFunction((x, y) => !!document.elementFromPoint(x, y)?.closest(`[data-cell-id="${window.__cellId}"]`), { timeout: 20000 }, cellPt.x, cellPt.y).catch(() => {})
  await page.touchscreen.tap(cellPt.x, cellPt.y)
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === window.__cellId, { timeout: 10000 }).catch(() => {})
  await wait(300)
  const cell = await page.evaluate(() => ({ ...window.__state(), id: window.__cellId, bar: !!document.querySelector('.direct-bar') }))
  if (cell.sheetOpen) await page.tap('.edit-sheet .done')
  await wait(300)
  const cellDone = await page.evaluate(() => window.__state())
  check(
    '試作：表のセルは、今までどおり下の書く欄で書く（キーボードの上の道具は出ない）。「完了」で閉じると全体の表示に戻る',
    cell.editing === cell.id && cell.sheet && cell.sheetOpen && cell.inSheetHost && !cell.onPaper && !cell.bar && cellDone.editing === null && !cellDone.zoomed,
    JSON.stringify({ editing: cell.editing === cell.id, sheet: cell.sheet, sheetOpen: cell.sheetOpen, inSheetHost: cell.inSheetHost, bar: cell.bar, after: [cellDone.editing, cellDone.zoomed] }),
  )
  // そのあと段落をタップすると、また紙面の上で書く
  await ready()
  const para = await page.evaluate(() => {
    const ed = window.__editor
    const ids = [...document.querySelectorAll('.page-viewport.front section.body p[data-block-id]')].map((e) => e.dataset.blockId).filter((id) => ed.pageOfBlock(id) === ed.getSnapshot().page && (window.__text(id) ?? '').length > 10)
    return ids[0]
  })
  await tapChar(page, para, 3)
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 10000 }, para)
  await wait(300)
  const back = await page.evaluate(() => window.__state())
  check('試作：表のセルのあとで段落をタップすると、また紙面の上で書く', back.onPaper && back.inScroller && !back.sheetOpen && back.focused, JSON.stringify({ onPaper: back.onPaper, inScroller: back.inScroller, sheetOpen: back.sheetOpen }))
  await page.tap('.direct-bar .db-done')
  await wait(300)

  // ---- 15. メニューの「下の書く欄に戻す」でやめる（覚えていたものも消す） ----
  await page.evaluate(() => window.__editor.setZoom(false))
  await page.tap('.p-top .icon-btn')
  await page.waitForSelector('.sheet .direct-off .link-btn')
  await wait(300)
  const item = await page.evaluate(() => {
    const b = document.querySelector('.sheet .direct-off .link-btn').getBoundingClientRect()
    return { text: document.querySelector('.sheet .direct-off .link-btn').textContent, h: Math.round(b.height), oneLine: b.height < 50 }
  })
  await page.screenshot({ path: `${OUT}/4-menu.png` })
  await page.tap('.sheet .direct-off .link-btn')
  await wait(500)
  await ready()
  const off = await page.evaluate((key) => ({ on: document.querySelector('.app').classList.contains('phone-direct'), badge: !!document.querySelector('.direct-badge'), saved: localStorage.getItem(key), meta: document.querySelector('meta[name="viewport"]').content }), KEY)
  await tapChar(page, para, 3)
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 10000 }, para)
  await wait(300)
  const sheetAgain = await page.evaluate(() => ({ ...window.__state(), bar: !!document.querySelector('.direct-bar') }))
  check(
    '試作：メニューの「下の書く欄に戻す」（44px 以上・1行）でやめると、印が消え、この端末の覚えも消え、段落をタップすると今までどおり下の書く欄が出る',
    item.text === '下の書く欄に戻す' && item.h >= 44 && item.oneLine && !off.on && !off.badge && off.saved === null && !off.meta.includes('maximum-scale') && sheetAgain.sheetOpen && sheetAgain.sheet && !sheetAgain.onPaper && !sheetAgain.bar,
    JSON.stringify({ item, off, sheet: [sheetAgain.sheetOpen, sheetAgain.sheet, sheetAgain.onPaper, sheetAgain.bar] }),
  )
  await page.tap('.edit-sheet .done')
  await wait(200)
  await page.reload({ waitUntil: 'networkidle0' })
  await ready()
  const stillOff = await page.evaluate(() => document.querySelector('.app').classList.contains('phone-direct'))
  // ?direct=1 でまた入り、?direct=0 でやめる
  await page.goto(`${APP}/?nodrive&direct=1`, { waitUntil: 'networkidle0' })
  await ready()
  const onAgain = await page.evaluate((key) => ({ on: document.querySelector('.app').classList.contains('phone-direct'), saved: localStorage.getItem(key) }), KEY)
  await page.goto(`${APP}/?direct=0&nodrive`, { waitUntil: 'networkidle0' })
  await ready()
  const offAgain = await page.evaluate((key) => ({ on: document.querySelector('.app').classList.contains('phone-direct'), saved: localStorage.getItem(key), search: location.search }), KEY)
  check(
    '試作：やめたあと読み込み直してもやめたまま。?direct=1 でまた入り、?direct=0 でやめる（アドレスの印は外す）',
    !stillOff && onAgain.on && onAgain.saved === '1' && !offAgain.on && offAgain.saved === null && offAgain.search === '?nodrive',
    JSON.stringify({ stillOff, onAgain, offAgain }),
  )
  await context.close()

  // ---- 16. 印がなければ今までどおり（iPhone）。Android では、画面の設定を変えない ----
  const plain = await openPhone(browser)
  const plainReady = readyOf(plain.page)
  await startSample(plain.page, plainReady)
  await plain.page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('p9'), 'none'))
  await plainReady()
  await tapChar(plain.page, 'p9', 3)
  await plain.page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p9', { timeout: 10000 })
  await wait(300)
  const normal = await plain.page.evaluate(() => ({ ...window.__state(), badge: !!document.querySelector('.direct-badge'), bar: !!document.querySelector('.direct-bar'), meta: document.querySelector('meta[name="viewport"]').content, mirror: !!document.querySelector('.overlay-mirror') }))
  await plain.page.keyboard.type('あ')
  await wait(100)
  const live = await plain.page.evaluate(() => !!document.querySelector('.overlay-mirror.live'))
  check(
    '試作の印がなければ今までどおり：印は出ず、段落をタップすると下の書く欄で書き、打った字は紙面の上の写しに出る（画面の設定も変えない）',
    !normal.badge && !normal.bar && normal.sheetOpen && normal.sheet && normal.inSheetHost && !normal.onPaper && live && !normal.meta.includes('maximum-scale'),
    JSON.stringify({ badge: normal.badge, bar: normal.bar, sheetOpen: normal.sheetOpen, inSheetHost: normal.inSheetHost, live, meta: normal.meta }),
  )
  await plain.context.close()
  const android = await openPhone(browser, { ua: ANDROID, query: '&direct=1' })
  await readyOf(android.page)().catch(() => {})
  const aMeta = await android.page.evaluate(() => ({ on: document.querySelector('.app')?.classList.contains('phone-direct'), meta: document.querySelector('meta[name="viewport"]').content }))
  check('試作：Android でも入れる。Android は書く欄に入っても拡大しないので、画面の設定（指で広げる拡大）は変えない', aMeta.on && !aMeta.meta.includes('maximum-scale'), JSON.stringify(aMeta))
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
