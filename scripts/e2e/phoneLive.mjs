// スマホ：打った字をその場で紙面に（Edge を自動で操作する。phone.mjs から呼ぶ）。
// 依頼者の願い：スマホで下の書く欄に打っている間も、PC と同じく、紙面にその字が打つたびにすぐ出てほしい（前は、打つ手を止めて紙面を組み直すまで変わらなかった）。2026-10-20。
// - 段落（本文・抄録）を書いている間、紙面の段落の位置に、打った字の写しをすぐ出す（紙面と同じ組み方・同じ倍率。紙面の段落は隠す）。
//   日本語の変換中の字・貼り付けた字・消した字も、すぐ出る。行が増えたら、後ろの文章を下へずらす
// - 打つ手を止めて紙面を組み直すと、写しをやめて、組み直した紙面の段落を見せる（同じ所で折り返し、後ろの文章も同じ位置。ちらつかない）
// - 書き終えたら写しは残らない（紙面の要素のずらし・隠しも残らない）。PDF は変わらない
// - Enter で段落を分ける・段落に打った見出し・ページをまたぐ段落・写しを押して書く位置を決める・書いている行が見える所に来る・スクロールしてもずれない
// - 600字の段落を、CPU を4倍遅くして打ったときの、1字ごとの時間
// これだけを動かすときは node scripts/e2e/phoneLive.mjs。画面の写真は poc-output/phone-live/（測った時間は timing.json）
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { stubConfig } from './configStub.mjs'
import { setupWriting } from './sampleReport.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/phone-live'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

/** 見本の原稿をスマホで開く（はじめての案内は「あとで」で閉じる） */
export async function openSample(browser) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror(phoneLive):', e.message))
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
    /** 要素たちの文字の、行の始まりの文字の位置（writingWrap.mjs と同じ。ページをまたぐ段落は、ページごとの要素を順に） */
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
    /** 紙面の上の写しと、紙面の段落 id のようす */
    window.__live = (id) => {
      const ed = window.__editor
      const mirror = document.querySelector('.overlay-mirror')
      const view = ed.renderer.pageView
      const front = view.fragments(id).filter((f) => f.closest('.page-viewport.front'))
      const shown = front.find((f) => view.pageIndexOf(f) === ed.getSnapshot().page)
      const m = mirror?.getBoundingClientRect()
      const clip = mirror?.parentElement?.getBoundingClientRect()
      return {
        live: !!mirror?.classList.contains('live') && getComputedStyle(mirror).visibility === 'visible',
        mirrorText: mirror?.textContent ?? '',
        mirror: m ? { top: m.top, bottom: m.bottom, left: m.left, right: m.right } : null,
        clip: clip ? { top: clip.top, bottom: clip.bottom } : null,
        pageText: front.map((f) => f.textContent).join(''),
        fragment: shown ? (({ top, bottom, left, right }) => ({ top, bottom, left, right }))(shown.getBoundingClientRect()) : null,
        pageHidden: shown ? getComputedStyle(shown).visibility === 'hidden' : null,
        rendering: ed.getSnapshot().rendering,
        inScroller: !!mirror?.closest('.page-scroller'),
        report: ed.getSnapshot().report.body.flatMap((c) => c.blocks).concat(ed.getSnapshot().report.abstract.paragraphs).find((b) => b.id === id)?.content?.map((n) => n.text ?? '').join('') ?? null,
      }
    }
    /** 紙面の段落 id の行の始まり（見えていないページも測る。ページをまたぐ段落は、ページごとの部分を順に） */
    window.__pageStarts = (id) => {
      const ed = window.__editor
      ed.renderer.viewport.classList.add('measuring')
      const starts = window.__lineStarts(ed.renderer.pageView.fragments(id))
      ed.renderer.viewport.classList.remove('measuring')
      return starts
    }
    /** 紙面（表に出ている方）の要素 id の上端（画面座標） */
    window.__top = (id) => document.querySelector(`.page-viewport.front [data-block-id="${CSS.escape(id)}"]`)?.getBoundingClientRect().top ?? null
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
    /** 紙面の要素に残った、後ろの文章のずらし・隠し・写しの代わりに隠す印（どちらの表示枠も） */
    window.__leftovers = () =>
      [...document.querySelectorAll('.page-viewport [style]')].filter((el) => el.style.translate || el.style.clipPath || el.style.visibility === 'hidden').length +
      document.querySelectorAll('.page-viewport .live-hidden').length
  })
  await stubConfig(page)
  await page.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36')
  await page.setViewport(PHONE)
  const ready = () =>
    page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 120000 })
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0', timeout: 90000 })
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
  await page.evaluate(() => window.__countRenders())
  return { context, page, ready }
}

/** 段落 id のあるページ（page を渡せば、その段落の page ページ目の部分）へ移り、紙面の段落をタップして書き始める（at：カーソルを置く字の位置。省くと終わり） */
export async function tapOpen(page, ready, id, at, part = 0) {
  await page.evaluate((id, part) => window.__editor.goToPage(window.__editor.pageOfBlock(id) + part, 'none'), id, part)
  await ready()
  const pt = await page.evaluate((id) => {
    const ed = window.__editor
    const el = ed.renderer.pageView.fragments(id).find((f) => f.closest('.page-viewport.front') && ed.renderer.pageView.pageIndexOf(f) === ed.getSnapshot().page)
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    return { x: r.left + 20, y: r.top + 4 }
  }, id)
  await wait(100)
  await page.touchscreen.tap(pt.x, pt.y)
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 30000 }, id)
  await wait(300)
  await page.evaluate((at) => window.__editor.overlay.setCaret(at ?? window.__editor.overlay.text.length), at)
}

/** 書く欄の「完了」で書き終え、組み直し終えるまで待つ */
async function finish(page, ready) {
  await page.tap('.edit-sheet .done')
  await wait(200)
  await ready()
  await wait(300)
}

/** 組み直すのを止めておく・戻す（写しの折り返しを、組み直す前に測るため） */
export const holdRender = (page, on) =>
  page.evaluate((on) => {
    const ed = window.__editor
    if (on) ed.scheduleRender = () => {}
    else delete ed.scheduleRender
  }, on)

export async function phoneLivePhone(browser, check) {
  const { context, page, ready } = await openSample(browser)
  const cdp = await page.createCDPSession()

  // ---- 1. 打った字が、組み直すのを待たずに紙面に出る（p9：本文3ページの、図の下の段落） ----
  await tapOpen(page, ready, 'p9')
  const p9 = await page.evaluate(() => ({ ...window.__live('p9'), p10: window.__top('p10'), renders: window.__renders }))
  await page.screenshot({ path: `${OUT}/seq-1-before.png` })
  // 打った時刻（書く欄の input）を覚えておき、紙面を調べるまでの時間を測る
  await page.evaluate(() => document.querySelector('.edit-sheet .overlay-editor').addEventListener('input', () => (window.__typedAt = performance.now())))
  await page.keyboard.type('あいう')
  const quick = await page.evaluate(() => ({ ...window.__live('p9'), after: performance.now() - window.__typedAt, renders: window.__renders }))
  check(
    'スマホ：書く欄で打つと、紙面を組み直す前に（打ってから 100ms 以内）、紙面の段落の位置にその字が出る（紙面の段落は隠し、組み直しはまだ）',
    !p9.live && quick.live && quick.mirrorText === `${p9.pageText}あいう` && quick.pageText === p9.pageText && quick.pageHidden && quick.after < 100 && quick.renders === p9.renders && !quick.rendering && quick.inScroller,
    JSON.stringify({ before: { live: p9.live, renders: p9.renders }, live: quick.live, tail: quick.mirrorText.slice(-6), pageTail: quick.pageText.slice(-4), hidden: quick.pageHidden, ms: Math.round(quick.after), renders: quick.renders }),
  )
  // 行が増えるまで打つ：後ろの段落（p10）が、組み直す前に1行分下がる
  await page.keyboard.type('えおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめも')
  const grown = await page.evaluate(() => ({ ...window.__live('p9'), p10: window.__top('p10'), renders: window.__renders }))
  await page.screenshot({ path: `${OUT}/seq-2-typing.png` })
  const line = (p9.fragment.bottom - p9.fragment.top) / 3
  check(
    'スマホ：打って段落の行が増えると、組み直す前に、後ろの段落が1行分下がる（写しの下端のすぐ下）',
    grown.live && grown.renders === p9.renders && Math.abs(grown.p10 - p9.p10 - line) < 2 && Math.abs(grown.p10 - grown.mirror.bottom) < 1.5,
    JSON.stringify({ line: line.toFixed(1), moved: (grown.p10 - p9.p10).toFixed(1), mirrorBottom: grown.mirror.bottom.toFixed(1), p10: grown.p10.toFixed(1) }),
  )
  // 写しの折り返し（組み直す前、打つ手を止めて測り直したあと）を覚えておき、組み直した紙面と比べる
  await wait(350)
  const liveStarts = await page.evaluate(() => window.__lineStarts([document.querySelector('.overlay-mirror')]))
  const typed = await page.evaluate(() => window.__editor.overlay.text)
  // 打つ手を止める：組み直した紙面に替わり、写しはなくなる（後ろの段落は同じ位置のまま）
  await page.waitForFunction((n) => window.__renders > n, { timeout: 30000 }, grown.renders)
  await ready()
  await wait(200)
  const settled = await page.evaluate(() => ({ ...window.__live('p9'), p10: window.__top('p10'), leftovers: window.__leftovers() }))
  const pageStarts = await page.evaluate(() => window.__pageStarts('p9'))
  await page.screenshot({ path: `${OUT}/seq-3-after-pause.png` })
  check(
    'スマホ：打つ手を止めると、組み直した紙面の段落が、打った字のとおりに出て、写しはなくなる（後ろの段落は下がったときと同じ位置。ずらしも残らない）',
    !settled.live && settled.pageText === typed && !settled.pageHidden && Math.abs(settled.p10 - grown.p10) < 1 && settled.leftovers === 0,
    JSON.stringify({ live: settled.live, same: settled.pageText === typed, hidden: settled.pageHidden, p10: [grown.p10.toFixed(1), settled.p10.toFixed(1)], leftovers: settled.leftovers }),
  )
  check('スマホ：写しの行の始まりの字が、組み直した紙面と同じ（p9）', JSON.stringify(liveStarts) === JSON.stringify(pageStarts), JSON.stringify({ liveStarts, pageStarts }))

  // ---- 2. 消す・貼り付ける（何字かまとめて入る）・日本語の変換中 ----
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  const deleted = await page.evaluate(() => window.__live('p9'))
  await page.keyboard.sendCharacter('貼り付けた文。')
  const pasted = await page.evaluate(() => window.__live('p9'))
  const caret = typed.length - 2 + 7
  await page.evaluate((c) => window.__editor.overlay.setCaret(c - 7), caret)
  await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 })
  await cdp.send('Input.imeSetComposition', { text: 'かん', selectionStart: 2, selectionEnd: 2 })
  const composing = await page.evaluate(() => window.__live('p9'))
  await cdp.send('Input.insertText', { text: '漢' })
  await wait(50)
  const composed = await page.evaluate(() => window.__live('p9'))
  const base = typed.slice(0, -2)
  check(
    'スマホ：消した字・貼り付けた字・日本語の変換中の字（変換中は原稿に入れる前）も、すぐ紙面の写しに出る',
    deleted.live && deleted.mirrorText === base &&
      pasted.mirrorText === `${base}貼り付けた文。` &&
      composing.live && composing.mirrorText === `${base}かん貼り付けた文。` && composing.report === `${base}貼り付けた文。` &&
      composed.mirrorText === `${base}漢貼り付けた文。` && composed.report === composed.mirrorText,
    JSON.stringify({ deleted: deleted.mirrorText.slice(-4), pasted: pasted.mirrorText.slice(-8), composing: composing.mirrorText.slice(-10), composingReport: composing.report?.slice(-8), composed: composed.mirrorText.slice(-9) }),
  )

  // ---- 3. 写しを押すと、押した字の所から書く（紙面の段落は前の字のままで隠しているので、写しの字で決める） ----
  const target = await page.evaluate(() => {
    const m = document.querySelector('.overlay-mirror')
    const i = m.textContent.indexOf('漢')
    const r = window.__charRect(m, i)
    return { i, x: r.left + (r.right - r.left) * 0.25, y: (r.top + r.bottom) / 2 }
  })
  await page.touchscreen.tap(target.x, target.y)
  await wait(400)
  const tapped = await page.evaluate(() => ({ editing: window.__editor.getSnapshot().editingId, caret: window.__editor.overlay.caret, live: window.__live('p9') }))
  check(
    'スマホ：書いている間に紙面の写しの字を押すと、その字の所から書く（組み直す前でも）',
    tapped.editing === 'p9' && tapped.caret === target.i,
    JSON.stringify({ tapped: { editing: tapped.editing, caret: tapped.caret }, want: target.i }),
  )
  await finish(page, ready)

  // ---- 4. 書き終えたら、写しも紙面のずらし・隠しも残らない。PDF は、組み直した紙面だけから作ったものと同じ ----
  const afterDone = await page.evaluate(() => ({
    mirror: !!document.querySelector('.overlay-mirror.live'),
    clipHidden: document.querySelector('.page-scroller > .overlay-clip')?.hidden ?? null,
    styles: [...document.head.querySelectorAll('style')].filter((s) => /data-block-id="p9"/.test(s.textContent)).length,
    leftovers: window.__leftovers(),
  }))
  const pdfHash = () =>
    page.evaluate(async () => {
      const { buildPdf } = await import('/src/pdf/exportPdf.ts')
      const ed = window.__editor
      const pages = ed.pageElements()
      const at = ed.pageOfBlock('p9')
      let hash = ''
      await buildPdf([pages[at]], {
        title: 'live-check',
        onPage: ({ canvas }) => {
          const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
          let h = 0
          for (let i = 0; i < data.length; i += 4) h = (h * 31 + data[i] + data[i + 1] * 7 + data[i + 2] * 13) | 0
          hash = `${canvas.width}x${canvas.height}:${h}`
        },
      })
      return hash
    })
  const edited = await pdfHash()
  await page.emulateMediaType('print')
  const printHidden = await page.evaluate(() => [...document.querySelectorAll('.overlay-clip')].every((c) => getComputedStyle(c).display === 'none'))
  await page.emulateMediaType(null)
  // 紙面をはじめから組み直してから、同じページを PDF にする
  await page.evaluate(async () => {
    window.__editor.renderer.forget()
    await window.__editor.render()
    await window.__editor.whenLaidOut()
  })
  await ready()
  const fresh = await pdfHash()
  check(
    'スマホ：書き終えると、写しも紙面のずらし・隠しも残らない。印刷にも出ない。PDF（そのページ）は、はじめから組み直した紙面で作ったものと同じ',
    !afterDone.mirror && afterDone.clipHidden === true && afterDone.styles === 0 && afterDone.leftovers === 0 && printHidden && edited === fresh && edited !== '',
    JSON.stringify({ afterDone, printHidden, edited, fresh }),
  )

  // ---- 5. 写しの折り返し：図表の参照「（図1）」のある段落・抄録の段落も、組み直した紙面と同じ所で折り返す ----
  const wrapBad = []
  for (const id of ['p3', 'p8', 'p5b', 'a2']) {
    await tapOpen(page, ready, id, 12)
    await holdRender(page, true)
    await page.keyboard.sendCharacter('書き足した（図2）文、ABC123の')
    await page.keyboard.type('xyz')
    await page.keyboard.sendCharacter('「試作」。')
    await wait(400)
    const live = await page.evaluate((id) => ({ ...window.__live(id), starts: window.__lineStarts([document.querySelector('.overlay-mirror')]) }), id)
    await holdRender(page, false)
    await page.evaluate(() => window.__editor.render())
    await ready()
    await wait(100)
    const laid = await page.evaluate((id) => ({ ...window.__live(id), starts: window.__pageStarts(id) }), id)
    if (!live.live || laid.live || live.mirrorText !== laid.pageText || JSON.stringify(live.starts) !== JSON.stringify(laid.starts)) wrapBad.push({ id, live: live.live, laidLive: laid.live, liveStarts: live.starts, pageStarts: laid.starts })
    await finish(page, ready)
  }
  check('スマホ：図表の参照のある段落・抄録の段落でも、打ったあとの写しの行の始まりの字が、組み直した紙面と同じ（p3・p8・p5b・a2）', wrapBad.length === 0, JSON.stringify(wrapBad.slice(0, 2)))

  // ---- 6. Enter で段落を分ける：分けた前の段落の仮の表示の下に、後ろの段落の写しが出て、打った字も出る。後ろの文章はその下へ ----
  await tapOpen(page, ready, 'p14', 20)
  const p14 = await page.evaluate(() => ({ text: window.__editor.overlay.text, p15: window.__top('p15') }))
  // 組み直しに時間のかかるスマホと同じように、CPU を遅くする（組み直す前のようすを確かめるため）
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId !== 'p14', { timeout: 30000 })
  const newId = await page.evaluate(() => window.__editor.getSnapshot().editingId)
  await page.keyboard.type('Enter')
  await page.keyboard.sendCharacter('のあとに書いた。')
  const split = await page.evaluate((newId) => {
    const g = document.querySelector('.overlay-ghost')?.getBoundingClientRect()
    const l = window.__live(newId)
    return {
      ...l,
      ghost: document.querySelector('.overlay-ghost')?.textContent ?? null,
      ghostBottom: g?.bottom ?? null,
      p14Hidden: getComputedStyle(document.querySelector('.page-viewport.front [data-block-id="p14"]')).visibility === 'hidden',
      p15: window.__top('p15'),
      p14top: window.__top('p14'),
    }
  }, newId)
  await page.screenshot({ path: `${OUT}/split-1-typing.png` })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  const afterText = `Enterのあとに書いた。${p14.text.slice(20)}`
  check(
    'スマホ：段落の途中で Enter：前の段落の仮の表示の下に、分けた後ろの段落の写しが出て、打った字もすぐ出る。後ろの段落はその下へずれる（組み直す前）',
    split.ghost?.startsWith(p14.text.slice(0, 20)) && split.live && split.mirrorText === afterText && Math.abs(split.mirror.top - split.ghostBottom) < 1 && split.p14Hidden && Math.abs(split.p15 - split.mirror.bottom) < 1.5,
    JSON.stringify({ ghost: split.ghost?.slice(0, 22), live: split.live, mirror: split.mirrorText.slice(0, 16), gap: split.ghostBottom && split.mirror ? (split.mirror.top - split.ghostBottom).toFixed(1) : null, p15: [p14.p15?.toFixed(1), split.p15?.toFixed(1), split.mirror?.bottom.toFixed(1)] }),
  )
  // 打つ手を止めて、組み直した紙面が、打った字に追いつくまで待つ
  await page.waitForFunction((newId, want) => window.__live(newId).pageText === want && !window.__editor.getSnapshot().rendering, { timeout: 30000 }, newId, afterText)
  await ready()
  await wait(200)
  const splitDone = await page.evaluate((newId) => ({ ...window.__live(newId), ghost: !!document.querySelector('.overlay-ghost'), p14: window.__live('p14').pageText, p15: window.__top('p15'), p14top: window.__top('p14') }), newId)
  await page.screenshot({ path: `${OUT}/split-2-after-pause.png` })
  check(
    'スマホ：分けたあと組み直すと、紙面に2つの段落が出て、写しと仮の表示はなくなる（後ろの段落は、ページの中で同じ位置のまま）',
    !splitDone.live && !splitDone.ghost && splitDone.pageText === afterText && splitDone.p14 === `${p14.text.slice(0, 20)}。` && Math.abs(splitDone.p15 - splitDone.p14top - (split.p15 - split.p14top)) < 1,
    JSON.stringify({ live: splitDone.live, ghost: splitDone.ghost, page: splitDone.pageText.slice(0, 14), p14: splitDone.p14.slice(-6), p15FromP14: [(split.p15 - split.p14top).toFixed(1), (splitDone.p15 - splitDone.p14top).toFixed(1)] }),
  )
  await finish(page, ready)

  // ---- 7. 段落に打った見出し（Enter・完了）も、今までどおり見出しになる ----
  await tapOpen(page, ready, 'p13')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId !== 'p13', { timeout: 30000 })
  const headPara = await page.evaluate(() => window.__editor.getSnapshot().editingId)
  await page.keyboard.sendCharacter('ⅲ．試着')
  const headLive = await page.evaluate((id) => window.__live(id), headPara)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__editor.getSnapshot().report.body[1].blocks.some((b) => b.type === 'subheading' && b.title === '試着'), { timeout: 30000 })
  await ready()
  await wait(300)
  const headed = await page.evaluate(() => {
    const ed = window.__editor
    const s = ed.getSnapshot()
    return {
      paper: [...document.querySelectorAll('.page-viewport.front section.body h2')].map((h) => h.textContent).filter((t) => t.includes('試着')),
      editing: s.editingId,
      lastId: s.report.body[1].blocks.at(-1).id,
      live: document.querySelector('.overlay-mirror')?.classList.contains('live'),
    }
  })
  await page.keyboard.sendCharacter('Ⅳ．謝辞')
  await finish(page, ready)
  const chapters = await page.evaluate(() => ({ titles: window.__editor.getSnapshot().report.body.map((c) => c.title), leftovers: window.__leftovers(), live: !!document.querySelector('.overlay-mirror.live') }))
  check(
    'スマホ：段落に「ⅲ．試着」と打つと写しに出て、Enter で小見出しになり、すぐ後ろの段落で書き続ける。そこに「Ⅳ．謝辞」と打って「完了」で大見出しになる（制作過程のあと。写し・ずらしは残らない）',
    headLive.live && headLive.mirrorText === 'ⅲ．試着' && headed.paper.length === 1 && headed.editing === headed.lastId && !headed.live && JSON.stringify(chapters.titles) === JSON.stringify(['企画・立案', '制作過程', '謝辞', 'まとめ']) && chapters.leftovers === 0 && !chapters.live,
    JSON.stringify({ headLive: headLive.mirrorText, headed, chapters }),
  )

  // ---- 8. ページをまたぐ段落：見えているページの部分が、打った字のとおりにすぐ変わる ----
  await page.evaluate(() => {
    const kana = '本制作では、衣装の素材や形を検討し、舞台の上での見え方を確かめながら制作を進めた。袖山を3cm下げ、「試作」を2回行った。'
    const text = (n, seed) => Array.from({ length: n }, (_, i) => kana[(i + seed) % kana.length]).join('')
    const ed = window.__editor
    ed.update((r) => ({
      ...r,
      body: [
        ...r.body,
        { id: 'xc', title: '追加の章', blocks: Array.from({ length: 4 }, (_, k) => ({ type: 'paragraph', id: `xp${k}`, content: [{ type: 'text', text: `${text(k === 0 ? 600 : 520, k * 7)}。` }] })) },
      ],
    }))
  })
  await wait(300)
  await ready()
  const spanning = await page.evaluate(() => ['xp1', 'xp2', 'xp3'].find((id) => window.__editor.renderer.pageView.fragments(id).filter((f) => f.closest('.page-viewport.front')).length > 1) ?? null)
  const split1 = await page.evaluate((id) => {
    const view = window.__editor.renderer.pageView
    const frags = view.fragments(id).filter((f) => f.closest('.page-viewport.front'))
    return view.charsBefore(id, frags[1])
  }, spanning)
  // はじめのページの、ページの終わり近く（次のページへ続く少し前）で打つ
  await tapOpen(page, ready, spanning, split1 - 4)
  await page.keyboard.sendCharacter('ＸＹ')
  const span1 = await page.evaluate((id, at) => {
    const m = document.querySelector('.overlay-mirror')
    const page = window.__editor.renderer.pageView.pages()[window.__editor.getSnapshot().page].getBoundingClientRect()
    const x = window.__charRect(m, at)
    const y = window.__charRect(m, at + 1)
    return { ...window.__live(id), x, y, contentBottom: page.top + (page.height * (297 - 25)) / 297 }
  }, spanning, split1 - 4)
  await page.screenshot({ path: `${OUT}/span-1-first-page.png` })
  check(
    'スマホ：ページをまたぐ段落のはじめのページで打つと、そのページの部分が打った字のとおりにすぐ変わる（打った字が見える。本文の下へはみ出す分は隠れる）',
    span1.live && span1.pageHidden && span1.mirrorText.slice(split1 - 4, split1 - 2) === 'ＸＹ' && span1.y && span1.y.bottom <= span1.clip.bottom + 0.5 && Math.abs(span1.clip.bottom - span1.contentBottom) < 1,
    JSON.stringify({ id: spanning, split: split1, xy: span1.mirrorText.slice(split1 - 6, split1), y: span1.y, clip: span1.clip, contentBottom: span1.contentBottom }),
  )
  await finish(page, ready)
  // 次のページの続きの部分で打つ：見えているページの最初の字が、ページの段落の上端に来たまま、打った字が出る
  const split2 = await page.evaluate((id) => {
    const view = window.__editor.renderer.pageView
    const frags = view.fragments(id).filter((f) => f.closest('.page-viewport.front'))
    return view.charsBefore(id, frags[1])
  }, spanning)
  await tapOpen(page, ready, spanning, split2 + 6, 1)
  const span2before = await page.evaluate((id, at) => {
    const m = document.querySelector('.overlay-mirror')
    const ed = window.__editor
    const frag = ed.renderer.pageView.fragments(id).find((f) => f.closest('.page-viewport.front') && ed.renderer.pageView.pageIndexOf(f) === ed.getSnapshot().page)
    return { ...window.__live(id), first: window.__charRect(m, at), firstChar: m.textContent[at], pageFirst: window.__charRect(frag, 0), pageChar: frag.textContent[0] }
  }, spanning, split2)
  await holdRender(page, true)
  await page.keyboard.sendCharacter('続きに書いた')
  await wait(400)
  const span2 = await page.evaluate((id, at) => {
    const m = document.querySelector('.overlay-mirror')
    return { ...window.__live(id), first: window.__charRect(m, at), firstChar: m.textContent[at], typed: window.__charRect(m, at + 6), starts: window.__lineStarts([m]) }
  }, spanning, split2)
  await page.screenshot({ path: `${OUT}/span-2-next-page.png` })
  await holdRender(page, false)
  await page.evaluate(() => window.__editor.render())
  await ready()
  await wait(200)
  const span2laid = await page.evaluate((id) => ({ ...window.__live(id), starts: window.__pageStarts(id) }), spanning)
  check(
    'スマホ：ページをまたぐ段落の、次のページの部分で打つと、そのページの段落の上端からの字が、打った字のとおりにすぐ変わる（前のページの部分は、ページの上に出ない）',
    span2.live && span2.pageHidden && span2.firstChar === span2before.pageChar && Math.abs(span2before.first.top - span2before.pageFirst.top) < 1 && Math.abs(span2.first.top - span2before.pageFirst.top) < 1 && Math.abs(span2.first.left - span2before.pageFirst.left) < 1 && span2.first.top >= span2.clip.top && span2.typed && span2.typed.top >= span2.clip.top,
    JSON.stringify({ mirrorFirst: [span2before.first?.top.toFixed(1), span2.first?.top.toFixed(1)], pageFirst: span2before.pageFirst?.top.toFixed(1), clipTop: span2.clip?.top.toFixed(1), char: [span2before.pageChar, span2.firstChar] }),
  )
  check(
    'スマホ：ページをまたぐ段落でも、写しの行の始まりの字が、組み直した紙面（2ページ分）と同じ。組み直すと写しはなくなる',
    JSON.stringify(span2.starts) === JSON.stringify(span2laid.starts) && !span2laid.live && span2laid.pageText === span2.mirrorText,
    JSON.stringify({ live: span2.starts.length, page: span2laid.starts.length, diff: span2.starts.filter((s, i) => s !== span2laid.starts[i]).slice(0, 3) }),
  )
  await finish(page, ready)

  // ---- 9. 1字ごとの時間（600字の段落・CPU を4倍遅く・スマホの画面） ----
  // 同じ段落の同じ所で、写しを見せるとき（on）と見せないとき（off：前と同じ）を交互に打って比べる。
  // - 全体：beforeinput から input の処理まで（原稿・チェック・画面の部品の書き直しも入る）
  // - 次の絵まで：beforeinput から、次の絵を描き終えるまで（写しの組み直し・描き直しも入る）
  // - 写し：写しのための手間（写しを合わせる・書いている行を見せる・はじめに写しを見せる・行が増えて後ろの文章をずらす）
  // 打つ手が止まってからの、写しの測り直し（時間を分けて測る）の1回分の時間も測る
  await tapOpen(page, ready, 'xp0')
  await holdRender(page, true)
  await page.evaluate(() => {
    const ed = window.__editor
    const ov = ed.overlay
    window.__perf = []
    window.__slices = []
    window.__liveMs = 0
    window.__shiftMs = 0
    window.__liveOff = false
    const liveInput = Object.getPrototypeOf(ov).liveInput
    ov.liveInput = function (t) {
      const s = performance.now()
      if (!window.__liveOff) liveInput.call(this, t)
      window.__liveMs += performance.now() - s
    }
    // 後ろの文章をずらす（行が増えた・減った）・次の絵を描く前にすること（書いている行を見せる・はじめに写しを見せたときのずらし）
    let inFrame = false
    const shift = Object.getPrototypeOf(ed).shiftFollowing
    ed.shiftFollowing = function () {
      const s = performance.now()
      shift.call(this)
      if (!inFrame) window.__shiftMs += performance.now() - s
    }
    const frame = Object.getPrototypeOf(ed).runLiveFrame
    ed.runLiveFrame = function () {
      const s = performance.now()
      inFrame = true
      try {
        frame.call(this)
      } finally {
        inFrame = false
      }
      window.__shiftMs += performance.now() - s
    }
    const slice = Object.getPrototypeOf(ov).runMirrorJob
    ov.runMirrorJob = function (now) {
      const s = performance.now()
      slice.call(this, now)
      window.__slices.push(performance.now() - s)
    }
    addEventListener('beforeinput', () => {
      window.__t0 = performance.now()
      window.__liveMs = 0
      window.__shiftMs = 0
    }, true)
    addEventListener('input', (e) => {
      const t0 = window.__t0
      const sync = performance.now() - t0
      const live = window.__liveMs
      requestAnimationFrame(() => setTimeout(() => window.__perf.push({ sync, live, shift: window.__shiftMs, frame: performance.now() - t0, composing: e.isComposing }), 0))
    })
  })
  const length = await page.evaluate(() => window.__editor.overlay.text.length)
  const stats = (v) => {
    v = [...v].sort((a, b) => a - b)
    const at = (q) => v[Math.min(v.length - 1, Math.floor(q * v.length))]
    return { median: +at(0.5).toFixed(1), p95: +at(0.95).toFixed(1), max: +v.at(-1).toFixed(1) }
  }
  const typeEach = async (s) => {
    for (const ch of s) {
      await page.keyboard.sendCharacter(ch)
      await wait(40)
    }
  }
  const compose = async () => {
    const kana = 'しせいさくのほうこくしょをかく'
    for (let i = 1; i <= kana.length; i++) {
      await cdp.send('Input.imeSetComposition', { text: kana.slice(0, i), selectionStart: i, selectionEnd: i })
      await wait(40)
    }
    await cdp.send('Input.insertText', { text: '試製作の報告書を書く' })
  }
  /** 写しを見せる（on）・見せない（off）で、caret の所から run で打ち、1字ごとの時間を返す（打ったあと、測り直しが終わるまで待つ） */
  const batch = async (off, caret, run) => {
    await page.evaluate((off, caret) => {
      window.__liveOff = off
      const ov = window.__editor.overlay
      ov.setCaret(caret === 'end' ? ov.text.length : caret)
      window.__perf = []
      window.__slices = []
    }, off, caret)
    await run()
    await wait(3000)
    const result = await page.evaluate(() => ({ rows: window.__perf, slices: window.__slices }))
    // 写しを見せずに打ったあとは、写しを書く欄の字に合わせ直し、測り直し終えるまで待つ（次に写しを見せて打つときの時間に入れない）
    if (off) {
      await page.evaluate(() => {
        window.__liveOff = false
        const ov = window.__editor.overlay
        ov.syncMirror(ov.text)
      })
      await wait(3000)
    }
    return result
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const cases = [
    ['段落の終わりで、かなを打つ', 'end', () => typeEach('なにぬねのはひふへほまみむめもやゆよらり')],
    ['段落の途中（300字目）で、かなを打つ', 300, () => typeEach('るれろわをんがぎぐげござじずぜぞだぢづで')],
    ['段落のはじめの方（40字目）で、句読点・括弧・英数字を打つ', 40, () => typeEach('、。「」（）ABCabc123あい、。「」')],
    ['日本語の変換中（変換の字が1字ずつ増える）', 60, compose],
  ]
  const timing = []
  const allSlices = []
  for (const [name, caret, run] of cases) {
    const on = await batch(false, caret, run)
    const off = await batch(true, caret, run)
    allSlices.push(...on.slices)
    const extra = on.rows.map((r) => r.live + r.shift)
    timing.push({
      name,
      n: on.rows.length,
      extra: stats(extra),
      first: +extra[0].toFixed(1),
      each: extra.map((ms) => +ms.toFixed(1)),
      // はじめの1字（写しを見せはじめる・カーソルを動かした所を見せる）を除いた、9割の字がこれより小さい
      rest: { p90: +[...extra.slice(1)].sort((a, b) => a - b)[Math.floor((extra.length - 1) * 0.9)].toFixed(1) },
      sync: { on: stats(on.rows.map((r) => r.sync)), off: stats(off.rows.map((r) => r.sync)) },
      frame: { on: stats(on.rows.map((r) => r.frame)), off: stats(off.rows.map((r) => r.frame)) },
    })
  }
  await page.evaluate(() => (window.__liveOff = false))
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  const pause = { n: allSlices.length, ...stats(allSlices.length ? allSlices : [0]) }
  writeFileSync(`${OUT}/timing.json`, JSON.stringify({ paragraph: length, cpu: '4x', viewport: PHONE, unit: 'ms', timing, remeasureSlicesAfterPause: pause }, null, 2))
  console.log(JSON.stringify({ timing, pause }, null, 1))
  check(
    `スマホ：600字の段落で、CPU を4倍遅くしても、写しのための1字ごとの手間は、ふつう 16ms より小さく、ほとんどが 30ms より小さい（${timing.map((t) => `${t.name}：写し ${t.extra.median}ms（はじめの1字 ${t.first}ms・ほかの9割は ${t.rest.p90}ms 以下）・次の絵まで ${t.frame.off.median}→${t.frame.on.median}ms`).join('／')}。打つ手が止まってからの測り直しは、1回 ${pause.median}ms（95% ${pause.p95}ms）に分ける）`,
    length >= 600 && timing.every((t) => t.n >= 10 && t.extra.median < 16 && t.rest.p90 < 30 && t.frame.on.median - t.frame.off.median < 30) && pause.p95 < 50,
    JSON.stringify({ timing: timing.map((t) => ({ name: t.name, extra: t.extra, first: t.first, frameOn: t.frame.on.median, frameOff: t.frame.off.median })), pause }),
  )

  // ---- 10. 書いている行が、下の書く欄に隠れない（段落が長くなったら、紙面を動かす） ----
  const hidden = []
  for (let k = 0; k < 8; k++) {
    await page.keyboard.sendCharacter('書いている行が見えるように紙面を動かすかを確かめるための文。'.repeat(2))
    await wait(60)
    const seen = await page.evaluate(() => {
      const c = window.__editor.overlay.liveCaretRect()
      const sheet = document.querySelector('.edit-sheet.open').getBoundingClientRect()
      const head = document.querySelector('.p-top').getBoundingClientRect()
      return { top: c.top, bottom: c.bottom, sheet: sheet.top, head: head.bottom }
    })
    if (!(seen.bottom <= seen.sheet + 0.5 && seen.top >= seen.head - 0.5)) hidden.push({ k, ...seen })
  }
  await page.screenshot({ path: `${OUT}/caret-visible.png` })
  check('スマホ：段落が長くなっても、書いている行（写しのカーソルの行）は、上の帯と下の書く欄の間に見えている', hidden.length === 0, JSON.stringify(hidden.slice(0, 2)))

  // ---- 11. 紙面をスクロールしても、写しは紙面と一緒に動く（スクロールのたびに動かすのではない） ----
  const scrolled = await page.evaluate(() => {
    const ed = window.__editor
    const m = document.querySelector('.overlay-mirror')
    const p = ed.renderer.pageView.pages()[ed.getSnapshot().page]
    const gap = () => m.getBoundingClientRect().top - p.getBoundingClientRect().top
    const before = gap()
    ed.scroller.scrollTop -= 40
    // スクロールの知らせ（scroll）を待たずに測る
    const after = gap()
    return { before, after, live: m.classList.contains('live') }
  })
  check('スマホ：紙面をスクロールしても、写しは紙面と一緒に動く（ずれない）', scrolled.live && Math.abs(scrolled.before - scrolled.after) < 0.5, JSON.stringify(scrolled))
  await holdRender(page, false)
  await finish(page, ready)
  const end = await page.evaluate(() => ({ leftovers: window.__leftovers(), live: !!document.querySelector('.overlay-mirror.live') }))
  check('スマホ：書き終えると、写し・紙面のずらしは残らない（長い段落のあと）', end.leftovers === 0 && !end.live, JSON.stringify(end))

  await context.close()
}

// これだけを動かす：node scripts/e2e/phoneLive.mjs
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { withEdge } = await import('../poc/edge.mjs')
  const results = []
  const check = (name, ok, detail = '') => {
    results.push(ok)
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
  }
  await withEdge((browser) => phoneLivePhone(browser, check))
  const failed = results.filter((ok) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} 件 合格`)
  process.exitCode = failed ? 1 : 0
}
