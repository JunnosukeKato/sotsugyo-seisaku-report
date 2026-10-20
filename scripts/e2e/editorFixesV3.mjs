// はじめて使う学生の試し（3回目：パソコン・スマホ）で見つかった、紙面と書く欄まわりの直しを確かめる（Edge を自動で操作する）。
// smoke.mjs（パソコン）と phone.mjs（スマホ）から呼ぶ。画面の写真は poc-output/v3-fix/editor/ に置く。
// パソコン（editorFixesV3Pc）：
// - ページの下の段落に書き足して、ページの下からはみ出しても、書く欄が上へずれて前の段落を隠さない。はみ出したら次のページへ移る
// - ページをまたぐ段落を前のページで書き始め、Ctrl+End で終わりへ移ると、終わりのある次のページへ移る（書く欄はずれない）
// - ページの下の近くで Enter を続けて押しても、分けた段落がすべて見えている（組み直すのが遅いときも）。「元に戻す」は、まず分けたことだけを戻す
// - 止まっているページは、ページの裏側を隠す指定（文字がぼやけて太く見えていた）をしない。めくっている間だけ
// - ページ送りを続けて押すと、押した数だけ送る（最後のページより先へは行かない）
// - 段落のすぐ下に入りきらない図を次のページの上へ送っても、後ろの素材表が図の前後に分かれない
// - はじめて開いたとき、案内の光の枠が、画面の左上に一瞬出ない
// - 原稿を丸ごと入れ替えたとき（Word から読み込んだなど）、前の原稿の紙面を見せない（「紙面を準備しています…」）
// スマホ（editorFixesV3Phone）：
// - Enter で分けた前の段落・「完了」で書き終えた段落が、組み直すのを待たずに紙面に見える
// - 長い原稿を開いた直後（ほかのページを組んでいる間）：残りのページの見込みを出す・先に見せられるページは先に見せる・書いた文字はすぐ紙面に見える・
//   ページの一覧のまだ組んでいないページは「準備中」・チェックは「指摘はありません」と言わない・「追加」は本文のページで本文の道具を出す・
//   ページ送りは、移る先のページを組み終えたら押した数だけ1回で送る。組み終えた紙面は、まっさらな状態から組み直したときと同じ
import { mkdirSync, readFileSync } from 'node:fs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/v3-fix/editor'
mkdirSync(OUT, { recursive: true })
const config = JSON.parse(readFileSync(new URL('./config-fixture.json', import.meta.url), 'utf8'))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** ページの中で：開発サーバーの即時反映を止め、設定の窓口を決まった設定にする（読み込み直しても効くように、ページの中で fetch を差し替える）。指差し確認は見たことにする */
function hook(config) {
  const Real = window.WebSocket
  window.WebSocket = function (url, protocols) {
    if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
    return new Real(url, protocols)
  }
  const realFetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (/script\.google(usercontent)?\.com/.test(url)) return Promise.resolve(new Response(JSON.stringify({ ok: true, year: config.fiscalYear, config }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    return realFetch(input, init)
  }
  try {
    localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
  } catch {}
  // 「紙面を準備しています…」の文字を、出るたびに記録する
  window.__loadingTexts = []
  new MutationObserver(() => {
    const t = document.querySelector('.loading')?.textContent
    if (t && window.__loadingTexts.at(-1) !== t) window.__loadingTexts.push(t)
  }).observe(document, { subtree: true, childList: true, characterData: true })
}

/** ページの中で：見本の原稿に、長い章を6つ足す（本文がおよそ17ページになる。開くのに時間がかかる長い原稿の代わり） */
function addLongChapters() {
  const kana = '本制作では、衣装の素材や形を検討し、舞台の上での見え方を確かめながら制作を進めた。'
  const text = (n, seed) => Array.from({ length: n }, (_, i) => kana[(i + seed) % kana.length]).join('')
  const extra = Array.from({ length: 6 }, (_, c) => ({
    id: `xc${c}`,
    title: `追加の章${c + 1}`,
    blocks: Array.from({ length: 6 }, (_, k) => ({ type: 'paragraph', id: `xp${c}_${k}`, content: [{ type: 'text', text: `${text(380, c * 7 + k)}。` }] })),
  }))
  window.__editor.update((r) => ({ ...r, body: [...r.body.slice(0, 2), ...extra, ...r.body.slice(2)] }))
}

/** ページの中で：写真を、この端末にも保存する（読み込み直しても写真が出るように） */
async function storeImages() {
  const { putImage } = await import('/src/model/storage.ts')
  for (const [id, img] of window.__editor.images) {
    const blob = await (await fetch(img.url)).blob()
    await putImage({ id, blob, widthPx: img.widthPx, heightPx: img.heightPx })
  }
}

/** 新しい入れ物で開き、はじめての案内を「あとで」で閉じて、見本の原稿にする */
async function openWithSample(browser, { phone }) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror(editorFixesV3):', e.message))
  await page.evaluateOnNewDocument(hook, config)
  if (phone) {
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  } else {
    await page.setViewport({ width: 1440, height: 900 })
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
  const { setupWriting } = await import('./sampleReport.mjs')
  await page.evaluate(setupWriting)
  await ready()
  return { context, page, ready }
}

export async function editorFixesV3Pc(browser, check) {
  // ---- はじめて開いたとき、案内の光の枠が、位置が決まる前に画面の左上に出ない（はじめて使う学生の試し（3回目）v3-pc 132） ----
  {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.evaluateOnNewDocument(hook, config)
    await page.evaluateOnNewDocument(() => {
      window.__spots = []
      const t0 = performance.now()
      const frame = () => {
        const s = document.querySelector('.g-spot')
        const p = document.querySelector('.page-viewport.front [data-vivliostyle-page-container].is-current')
        if (s && p) {
          const r = s.getBoundingClientRect()
          const pr = p.getBoundingClientRect()
          window.__spots.push({ inside: r.left >= pr.left - 12 && r.top >= pr.top - 12 && r.right <= pr.right + 12 && r.bottom <= pr.bottom + 12, r: [r.left, r.top].map(Math.round) })
        }
        if (performance.now() - t0 < 20000) requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    })
    await page.setViewport({ width: 1440, height: 900 })
    await page.goto(`${APP}/?nodrive&direct=0`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.g-spot', { timeout: 60000 })
    await wait(800)
    const spots = await page.evaluate(() => window.__spots)
    check('はじめて開いたとき、案内の光の枠は、紙面の欄の位置が決まってから出る（画面の左上から動いてこない）', spots.length > 0 && spots.every((s) => s.inside), JSON.stringify(spots.filter((s) => !s.inside).slice(0, 3)))
    await context.close()
  }

  const { context, page, ready } = await openWithSample(browser, { phone: false })
  await page.evaluate(addLongChapters)
  await ready()
  const cdp = await page.createCDPSession()

  // ---- 止まっているページは、ページの裏側を隠す指定をしない（文字がぼやけて太く見えていた）。めくっている間だけ ----
  const faces = await page.evaluate(async () => {
    const ed = window.__editor
    await ed.goToPage(4, 'none')
    const cur = () => ed.renderer.pageView.pages()[ed.getSnapshot().page]
    const still = getComputedStyle(cur()).backfaceVisibility
    const turning = ed.goToPage(5, 'turn')
    await new Promise((r) => requestAnimationFrame(r))
    const moving = [...document.querySelectorAll('.page-viewport.front .turn-out, .page-viewport.front .turn-in')].map((p) => getComputedStyle(p).backfaceVisibility)
    await turning
    return { still, moving, after: getComputedStyle(cur()).backfaceVisibility }
  })
  check('止まっているページは、裏側を隠す指定（backface-visibility）をしない。めくっているページだけ隠す（めくる動きは今までどおり）', faces.still === 'visible' && faces.after === 'visible' && faces.moving.length > 0 && faces.moving.every((v) => v === 'hidden'), JSON.stringify(faces))

  // ---- ページ送りを続けて押すと、押した数だけ送る（最後のページより先へは行かない） ----
  await ready()
  const start = await page.evaluate(() => window.__editor.getSnapshot().page)
  for (let i = 0; i < 3; i++) {
    await page.click('.arrow.next')
    await wait(150)
  }
  await page.waitForFunction((to) => window.__editor.getSnapshot().page === to && !window.__editor.getSnapshot().turning, { timeout: 10000 }, start + 3).catch(() => {})
  await wait(400)
  const afterThree = await page.evaluate(() => window.__editor.getSnapshot().page)
  const last = await page.evaluate(() => window.__editor.getSnapshot().pageCount - 1)
  await page.evaluate((p) => window.__editor.goToPage(p, 'none'), last - 1)
  await ready()
  for (let i = 0; i < 3; i++) {
    await page.click('.arrow.next').catch(() => {})
    await wait(120)
  }
  await wait(1200)
  const atEnd = await page.evaluate(() => window.__editor.getSnapshot().page)
  check('ページ送りを 0.15秒おきに3回押すと、3ページ送る（めくっている途中でも、押した分を捨てない）。最後のページより先へは行かない', afterThree === start + 3 && atEnd === last, JSON.stringify({ start, afterThree, last, atEnd }))

  // ---- ページの下の段落に書き足して、ページの下からはみ出しても、書く欄が上へずれて前の段落を隠さない ----
  await ready()
  const target = await page.evaluate(() => {
    const ed = window.__editor
    const view = ed.renderer.pageView
    const pages = view.pages()
    ed.renderer.viewport.classList.add('measuring')
    let found = null
    for (let i = 3; i < pages.length && !found; i++) {
      const pr = pages[i].getBoundingClientRect()
      for (const p of pages[i].querySelectorAll('p[data-block-id]')) {
        const frs = view.fragments(p.dataset.blockId)
        const bottomMm = ((p.getBoundingClientRect().bottom - pr.top) / pr.height) * 297
        if (frs.length === 1 && bottomMm > 240 && bottomMm < 268 && p.previousElementSibling?.matches('p[data-block-id]')) {
          found = { id: p.dataset.blockId, page: i, prev: p.previousElementSibling.dataset.blockId, len: p.textContent.length }
          break
        }
      }
    }
    ed.renderer.viewport.classList.remove('measuring')
    return found
  })
  if (!target) check('ページの下の段落に書き足す（確かめる段落が見つかる）', false)
  else {
    await page.evaluate((t) => window.__editor.goToPage(t.page, 'none'), target)
    await ready()
    await page.evaluate((t) => window.__editor.openEditor(t.id, t.len), target)
    await wait(200)
    const prevBottom = await page.evaluate((id) => window.__editor.renderer.pageView.fragments(id).at(-1).getBoundingClientRect().bottom, target.prev)
    for (const ch of '書き足した文。'.repeat(16)) await page.keyboard.type(ch)
    // 打っている途中に、書いている位置のある次のページへ移っていることもある（はみ出したら、打つ手が止まるのを待たずに組み直すため）
    const during = await page.evaluate((id) => {
      const ed = window.__editor
      const view = ed.renderer.pageView
      const clip = document.querySelector('.overlay-clip:not([hidden]):not(.overlay-frozen)')
      const here = view.fragments(id).find((f) => view.pageIndexOf(f) === ed.getSnapshot().page)
      return {
        page: ed.getSnapshot().page,
        clip: clip?.scrollTop ?? -1,
        layer: document.querySelector('#overlay-layer').scrollTop,
        editorTop: document.querySelector('.overlay-editor').getBoundingClientRect().top,
        clipTop: Math.round(clip?.getBoundingClientRect().top ?? 0),
        fragmentTop: Math.round(here?.getBoundingClientRect().top ?? -1),
      }
    }, target.id)
    await page.screenshot({ path: `${OUT}/smoke-1-typing-past-bottom.png` })
    // 打つ手が止まったら（組み直したら）、書いている位置のある次のページへ移る
    const followed = await page.waitForFunction((p) => window.__editor.getSnapshot().page === p + 1 && !window.__editor.getSnapshot().rendering, { timeout: 15000 }, target.page).then(() => true, () => false)
    await page.screenshot({ path: `${OUT}/smoke-1-followed.png` })
    check(
      'ページの下の段落に書き足して、ページの下からはみ出しても、書く欄の枠の中は動かず、前の段落の終わりの行を隠さない。打つ手が止まると、次のページへ移る',
      // 前のページのままなら、書く欄は前の段落の下から。次のページへ移っていれば、そのページの段落の上端から見せる（どちらも、枠の中はずらさない）
      during.clip === 0 && during.layer === 0 && (during.page === target.page ? during.editorTop >= prevBottom - 1 : Math.abs(during.clipTop - during.fragmentTop) <= 1) && followed,
      JSON.stringify({ during, prevBottom, followed }),
    )
    await page.keyboard.press('Escape')
    await ready()
  }

  // ---- ページをまたぐ段落を前のページで押し、Ctrl+End で終わりへ移ると、書く欄はずれずに、終わりのある次のページへ移る（v3-pc 034・035・037） ----
  const span = await page.evaluate(() => {
    const ed = window.__editor
    const view = ed.renderer.pageView
    for (const p of view.pages().flatMap((pg) => [...pg.querySelectorAll('p[data-block-id]')])) {
      const frs = view.fragments(p.dataset.blockId)
      if (frs.length === 2 && frs[0] === p) return { id: p.dataset.blockId, first: view.pageIndexOf(frs[0]), second: view.pageIndexOf(frs[1]) }
    }
    return null
  })
  if (!span) check('ページをまたぐ段落で Ctrl+End（確かめる段落が見つかる）', false)
  else {
    await page.evaluate((s) => window.__editor.goToPage(s.first, 'none'), span)
    await ready()
    await page.evaluate((s) => window.__editor.openEditor(s.id, 0), span)
    await wait(200)
    await page.keyboard.down('Control')
    await page.keyboard.press('End')
    await page.keyboard.up('Control')
    await wait(400)
    const moved = await page.evaluate((id) => {
      const ed = window.__editor
      const view = ed.renderer.pageView
      const clip = document.querySelector('.overlay-clip:not([hidden]):not(.overlay-frozen)')
      const here = view.fragments(id).find((f) => view.pageIndexOf(f) === ed.getSnapshot().page)
      return { page: ed.getSnapshot().page, clip: clip?.scrollTop ?? -1, clipTop: Math.round(clip?.getBoundingClientRect().top ?? 0), fragmentTop: Math.round(here?.getBoundingClientRect().top ?? -1) }
    }, span.id)
    await page.screenshot({ path: `${OUT}/smoke-1-ctrl-end.png` })
    check(
      'ページをまたぐ段落を前のページで書き始め、Ctrl+End で終わりへ移ると、終わりのある次のページへ移り、書く欄はずれない（前の段落を隠さない）',
      moved.page === span.second && moved.clip === 0 && Math.abs(moved.clipTop - moved.fragmentTop) <= 1,
      JSON.stringify({ span, moved }),
    )
    await page.keyboard.press('Escape')
    await ready()
  }

  // ---- ページの下の近くで Enter を続けて押しても、分けた段落がすべて見えている（組み直すのが遅いときも：CPU を 6倍遅く） ----
  const t2 = await page.evaluate(() => {
    const ed = window.__editor
    const view = ed.renderer.pageView
    const pages = view.pages()
    ed.renderer.viewport.classList.add('measuring')
    let found = null
    for (let i = 4; i < pages.length && !found; i++) {
      const pr = pages[i].getBoundingClientRect()
      for (const p of pages[i].querySelectorAll('p[data-block-id]')) {
        const bottomMm = ((p.getBoundingClientRect().bottom - pr.top) / pr.height) * 297
        if (view.fragments(p.dataset.blockId).length === 1 && bottomMm > 230 && bottomMm < 262) {
          found = { id: p.dataset.blockId, page: i, len: p.textContent.length }
          break
        }
      }
    }
    ed.renderer.viewport.classList.remove('measuring')
    return found
  })
  if (!t2) check('ページの下の近くで Enter を続けて押す（確かめる段落が見つかる）', false)
  else {
    await page.evaluate((t) => window.__editor.goToPage(t.page, 'none'), t2)
    await ready()
    await page.evaluate((t) => window.__editor.openEditor(t.id, t.len), t2)
    await wait(200)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
    const words = []
    const seen = []
    for (let n = 1; n <= 4; n++) {
      const w = `【分けた段落${n}】春の街で着られる軽さを大切にし、素材は麻と綿を中心に選んだ。`
      words.push(w)
      await page.keyboard.press('Enter')
      for (const ch of w) await page.keyboard.type(ch)
      // 押してすぐ：書いた段落がすべて見えているか（仮の表示・書く欄・紙面のどれか。紙面で隠している段落は数えない）
      seen.push(
        await page.evaluate((words) => {
          const shown = (el) => {
            const r = el.getBoundingClientRect()
            const cs = getComputedStyle(el)
            return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0' ? el.textContent : ''
          }
          const ed = window.__editor
          const cur = ed.renderer.pageView.pages()[ed.getSnapshot().page]
          const texts = [...document.querySelectorAll('.overlay-ghost, .overlay-editor, .overlay-frozen > div'), ...cur.querySelectorAll('p[data-block-id]')].map(shown).join('\n')
          return words.every((w) => texts.includes(w.slice(0, 10)))
        }, words),
      )
    }
    await page.screenshot({ path: `${OUT}/smoke-2-enter-repeat.png` })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    await ready()
    const settled = await page.evaluate((words) => {
      const all = window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).filter((b) => b.type === 'paragraph').map((b) => b.content.map((n) => n.text ?? '').join(''))
      return words.map((w) => all.filter((t) => t.startsWith(w.slice(0, 10))).length)
    }, words)
    check('ページの下の近くで Enter を続けて押しても、組み直す前から、分けた段落がすべて見えている（空白・重なりにならない）。組み直したあとも1つずつ', seen.every(Boolean) && settled.every((n) => n === 1), JSON.stringify({ seen, settled }))
    await page.keyboard.press('Escape')
    await ready()
    // 「元に戻す」：Enter で分けた直後（組み直す前）に押しても、まず分けたことだけを戻す（分ける前に書いた文字は残す。もう一度押すと、書いた文字も戻る）
    const blocks = () => page.evaluate(() => window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).map((b) => (b.type === 'paragraph' ? b.content.map((n) => n.text ?? '').join('') : b.type)))
    await page.evaluate((t) => window.__editor.openEditor(t.id, 9999), t2)
    await wait(200)
    const before = await blocks()
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
    await page.keyboard.type('戻す前に書いた文')
    await page.keyboard.press('Enter')
    // 組み直す前に「元に戻す」と同じことをする（CPU を遅くしているので、ボタンの見た目が押せる形になる前に押してしまわないよう、直接呼ぶ）
    await page.evaluate(() => window.__editor.undo())
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    await ready()
    const once = await blocks()
    await page.evaluate(() => window.__editor.undo())
    await ready()
    const twice = await blocks()
    check(
      'Enter で分けた直後（組み直す前）に「元に戻す」を押すと、まず分けたことだけを戻す（分ける前に書いた文字は消えない）。もう一度押すと、書いた文字も戻る',
      once.length === before.length && once.some((t) => t.includes('戻す前に書いた文')) && twice.length === before.length && !twice.some((t) => t.includes('戻す前に書いた文')),
      JSON.stringify({ before: before.length, once: once.length, kept: once.some((t) => t.includes('戻す前に書いた文')), twice: twice.some((t) => t.includes('戻す前に書いた文')) }),
    )
  }

  // ---- 段落のすぐ下に入りきらない図を次のページの上へ送っても、後ろの素材表が図の前後に分かれない ----
  const floats = []
  // 直す前は、どれも図が表の途中（表の続きの前）に入っていた：素材表（文字だけの12行）は段落 900・1000・1100 字、生地見本の写真の入った4行は 875・925 字
  for (const [lead, rows] of [[900, 'text'], [1000, 'text'], [1100, 'text'], [875, 'image'], [925, 'image']]) {
    await page.evaluate(
      (lead, rows) => {
        const kana = '本制作では、衣装の素材や形を検討し、舞台の上での見え方を確かめながら制作を進めた。'
        const text = (n) => Array.from({ length: n }, (_, i) => kana[i % kana.length]).join('')
        const para = (id, n, ref) => ({ type: 'paragraph', id, content: [{ type: 'text', text: text(n) }, ...(ref ? [{ type: 'ref', targetId: ref, withParens: true }, { type: 'text', text: '。' }] : [])] })
        const names = ['コットンサテン', 'シルクシフォン', 'コットンブロード', 'リネン', 'ウール', 'オーガンジー', 'ベルベット', 'タフタ']
        const swatches = ['g-satin', 'g-chiffon', 'g-broad']
        const row = (i) => ({ id: `tr${i}`, cells: [{ id: `tr${i}a`, text: names[i % names.length] }, { id: `tr${i}b`, text: '袖' }, { id: `tr${i}c`, text: rows === 'image' ? '' : '見本', imageId: rows === 'image' ? swatches[i % 3] : undefined }] })
        const table = { type: 'table', id: 'tt1', caption: '使用素材表', widths: 'equal', rows: [{ id: 'th', cells: [{ id: 'tha', text: '名称' }, { id: 'thb', text: '使用箇所' }, { id: 'thc', text: '生地見本' }] }, ...Array.from({ length: rows === 'image' ? 4 : 12 }, (_, i) => row(i))] }
        const body = [{ id: 'tc1', title: '制作過程', blocks: [para('tpA', lead), para('tpP', 60, 'tf1'), { type: 'figureRow', id: 'tg1', figures: [{ id: 'tf1', imageId: 'g-mood', caption: 'イメージボード' }] }, para('tpB', 30), table, para('tpC', 400)] }]
        window.__editor.update((r) => ({ ...r, body }))
      },
      lead,
      rows,
    )
    await wait(300)
    await ready()
    floats.push(
      await page.evaluate(() => {
        const vp = window.__editor.renderer.viewport
        vp.classList.add('measuring')
        const pages = window.__editor.renderer.pageView.pages()
        const pageOf = (el) => pages.indexOf(el.closest('[data-vivliostyle-page-container]'))
        const group = vp.querySelector('.figure-group[data-group-id="tg1"]')
        const tables = [...vp.querySelectorAll('.data-table[data-table-id="tt1"]')].map(pageOf)
        const res = { deferred: group.classList.contains('deferred'), group: pageOf(group), tables }
        vp.classList.remove('measuring')
        // 図が表の途中に入っている：表が、図のページの前のページと図のページにまたがり、図はその上に送られている
        return { ...res, inside: res.deferred && tables.includes(res.group - 1) && tables.includes(res.group) }
      }),
    )
    await page.evaluate((p) => window.__editor.goToPage(p, 'none'), floats.at(-1).group)
    await ready()
    await page.screenshot({ path: `${OUT}/smoke-9-float-${rows}-${lead}.png` })
  }
  check(
    '段落のすぐ下に入りきらない図を次のページの上へ送っても、後ろの素材表が図の前後に分かれない（送ると分かれるときは送らず、表は図の後ろから始まる）',
    floats.every((f) => !f.inside && f.tables[0] === f.group),
    JSON.stringify(floats),
  )

  // ---- 原稿を丸ごと入れ替えたとき（Word から読み込んだ・控えに戻したなど）、新しい紙面が出るまで、前の原稿の紙面を見せない ----
  const replaced = await page.evaluate(async () => {
    const ed = window.__editor
    const r = ed.getSnapshot().report
    ed.replace({ ...r, basicInfo: { ...r.basicInfo, name: '入替　太郎' } })
    // 同じ処理の中（画面に出る前）に、紙面を隠す「紙面を準備しています…」が出ているか
    await new Promise((res) => requestAnimationFrame(res))
    const loading = !!document.querySelector('.loading')
    await ed.whenLaidOut()
    await new Promise((res) => setTimeout(res, 300))
    return { loading, after: !document.querySelector('.loading') }
  })
  check('原稿を丸ごと入れ替えた（Word から読み込んだなど）直後は、新しい紙面が出るまで「紙面を準備しています…」を出す（読み込む前の表紙を見せない）', replaced.loading && replaced.after, JSON.stringify(replaced))
  await context.close()
}

export async function editorFixesV3Phone(browser, check) {
  const { context, page, ready } = await openWithSample(browser, { phone: true })
  await page.evaluate(addLongChapters)
  await ready()
  await page.evaluate(storeImages)
  await ready()

  // ---- Enter で分けた前の段落が、組み直すのを待たずに紙面に見える（スマホ。v3-phone 17・127） ----
  const enter = await page.evaluate(async () => {
    const ed = window.__editor
    const page = ed.layout.kinds.indexOf('body')
    await ed.goToPage(page, 'none')
    const p = [...ed.renderer.pageView.pages()[page].querySelectorAll('p[data-block-id]')].at(-1)
    return { id: p.dataset.blockId, len: p.textContent.length, rect: (() => { const r = p.getBoundingClientRect(); return [r.left + 20, r.top + 4] })() }
  })
  await page.touchscreen.tap(enter.rect[0], enter.rect[1])
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 10000 }, enter.id)
  await page.keyboard.press('End')
  const cdp = await page.createCDPSession()
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  await page.keyboard.type('改行の前に書いた文')
  await page.keyboard.press('Enter')
  const ghost = await page.evaluate(() => {
    const g = [...document.querySelectorAll('.overlay-ghost')].at(-1)
    const r = g?.getBoundingClientRect()
    return { text: g?.textContent.includes('改行の前に書いた文') ?? false, visible: !!r && r.width > 0 && r.top < innerHeight && r.bottom > 0 }
  })
  await page.screenshot({ path: `${OUT}/phone-2-after-enter.png` })
  await page.keyboard.type('次の段落の文。')
  await page.click('.edit-sheet .done')
  const done = await page.evaluate(() => {
    const f = [...document.querySelectorAll('.overlay-frozen > div')].map((d) => d.textContent).join('|')
    return { frozen: f.includes('改行の前に書いた文') && f.includes('次の段落の文。') }
  })
  await wait(100)
  await page.screenshot({ path: `${OUT}/phone-2-after-done.png` })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await ready()
  const laid = await page.evaluate(() => [...document.querySelectorAll('.page-viewport.front p[data-block-id]')].some((p) => p.textContent.includes('次の段落の文。')))
  check('スマホ：Enter で分けた前の段落と、「完了」で書き終えた段落は、組み直すのを待たずに紙面に見える（組み直すと、組んだ紙面に替わる）', ghost.text && ghost.visible && done.frozen && laid, JSON.stringify({ ghost, done, laid }))

  // ---- 長い原稿を開いた直後（ほかのページを組んでいる間） ----
  // 本文の2ページ目を、最後に見ていたページにする。覚えた組み方の表紙の部分を違うものにして、覚えた組み方では先に見せられない（前から順に組む）ようにする
  const target = await page.evaluate(() => window.__editor.getSnapshot().layout.kinds.map((k, i) => (k === 'body' ? i : -1)).filter((i) => i >= 0)[1])
  await page.evaluate((p) => window.__editor.goToPage(p, 'none'), target)
  await ready()
  await wait(1500)
  await page.evaluate(() => {
    const m = JSON.parse(localStorage.getItem('sotsugyo-seisaku-report-layout'))
    m.parts[0].hash = 'changed'
    localStorage.setItem('sotsugyo-seisaku-report-layout', JSON.stringify(m))
  })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 10 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => performance.getEntriesByType('mark').some((m) => m.name === 'open:shown' || m.name === 'open:layout'), { timeout: 180000, polling: 100 })
  const provisional = () => page.evaluate(() => !performance.getEntriesByType('mark').some((m) => m.name === 'open:layout'))
  const shown = await page.evaluate(() => ({
    early: !performance.getEntriesByType('mark').some((m) => m.name === 'open:layout'),
    page: window.__editor.getSnapshot().page,
    texts: window.__loadingTexts,
    loading: !!document.querySelector('.loading'),
  }))
  await page.screenshot({ path: `${OUT}/phone-3-shown-early.png` })
  check(
    'スマホ：覚えた組み方で先に見せられないときも、「紙面を準備しています…」に残りのページの見込みを出し、見せるページまで組んだら、ほかのページを組み終える前に見せる',
    shown.early && shown.page === target && !shown.loading && shown.texts.some((t) => /あと\d+ページほど/.test(t)),
    JSON.stringify(shown),
  )

  // チェック：組み終えるまで「指摘はありません」と言わない（エラーの数も出さない）
  await page.click('.p-nav .nav-check')
  await page.waitForSelector('.sheet .sheet-body')
  const checkSheet = await page.evaluate(() => ({ text: document.querySelector('.sheet .sheet-body').textContent, tally: document.querySelector('.sheet .tally')?.textContent ?? '', badge: !!document.querySelector('.p-nav .badge') }))
  const checkEarly = await provisional()
  await page.screenshot({ path: `${OUT}/phone-5-check-preparing.png` })
  await page.click('.sheet .sheet-close')
  await wait(200)
  check('スマホ：開いた直後（ほかのページを組んでいる間）のチェックは「指摘はありません」と言わず、「確かめています…」と出す（エラーの数も出さない）', checkEarly && (!checkSheet.text.includes('指摘はありません') && /確かめています|ページ数などのチェック/.test(checkSheet.text + checkSheet.tally) && !checkSheet.badge), JSON.stringify({ checkEarly, tally: checkSheet.tally, badge: checkSheet.badge, text: checkSheet.text.slice(0, 120) }))

  // 追加：本文のページなら、本文の道具を出す（「段落や図は、本文のページで足せます」と言わない）
  await page.click('.p-nav .add')
  await page.waitForSelector('.sheet .sheet-body')
  const addText = await page.evaluate(() => document.querySelector('.sheet .sheet-body').textContent)
  await page.click('.sheet .sheet-close')
  await wait(200)
  check('スマホ：開いた直後に本文のページで「追加」を押すと、本文の道具が出る（「本文のページで足せます」と言わない）', !addText.includes('本文のページで足せます') && addText.includes('小見出し'), addText.slice(0, 80))

  // ページの一覧：まだ組んでいないページは「準備中」（白いページにしない）
  await page.click('.p-nav button')
  await page.waitForSelector('.sheet .thumb-list .mini')
  await wait(600)
  const thumbs = await page.evaluate(() => ({ preparing: document.querySelectorAll('.sheet .mini.preparing').length, total: document.querySelectorAll('.sheet .mini').length, placeholders: window.__editor.renderer.pageView.pages().filter((p) => p.hasAttribute('data-placeholder-page')).length }))
  const thumbsEarly = await provisional()
  await page.screenshot({ path: `${OUT}/phone-3-thumbs-preparing.png` })
  await page.click('.sheet .sheet-close')
  await wait(200)
  check('スマホ：開いた直後のページの一覧で、まだ組んでいないページは「準備中」と出す（白いページにしない）', thumbsEarly && thumbs.placeholders > 0 && thumbs.preparing > 0, JSON.stringify({ thumbsEarly, ...thumbs }))

  // 書いた文字は、すぐ紙面に見える（組み終えるのを待たない）
  const para = await page.evaluate(() => {
    const p = [...document.querySelectorAll('.page-viewport.front [data-vivliostyle-page-container].is-current p[data-block-id]')].find((x) => x.textContent.length > 20)
    const r = p.getBoundingClientRect()
    return { id: p.dataset.blockId, x: r.left + 30, y: r.top + 4 }
  })
  await page.touchscreen.tap(para.x, para.y)
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 30000 }, para.id)
  await page.keyboard.press('End')
  await page.keyboard.type('開いた直後に書いた文。')
  await page.click('.edit-sheet .done')
  const edited = await page.evaluate(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight }
    return {
      now: [...document.querySelectorAll('.overlay-frozen > div')].some((d) => d.textContent.includes('開いた直後に書いた文。') && visible(d)),
      early: !performance.getEntriesByType('mark').some((m) => m.name === 'open:layout'),
    }
  })
  await wait(1500)
  const edited2 = await page.evaluate((id) => ({
    still: [...document.querySelectorAll('.overlay-frozen > div')].some((d) => d.textContent.includes('開いた直後に書いた文。')) || window.__editor.renderer.pageView.fragments(id).some((f) => f.textContent.includes('開いた直後に書いた文')),
  }), para.id)
  await page.screenshot({ path: `${OUT}/phone-3-edit-early.png` })
  check('スマホ：開いた直後（ほかのページを組んでいる間）に「完了」で書き終えた文字は、すぐ紙面に見え、組み直すまで見えたまま', edited.early && edited.now && edited2.still, JSON.stringify({ ...edited, ...edited2 }))

  // ページ送り：0.15秒おきに3回押すと、移る先のページを組み終えたら、3ページ先へ1回で送る（それより先へは行かない）
  await page.waitForSelector('.pager button[aria-label="次のページ"]', { timeout: 30000 })
  const navStart = await page.evaluate(() => window.__editor.getSnapshot().page)
  const navEarly = await provisional()
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => document.querySelector('.pager button[aria-label="次のページ"]')?.click())
    await wait(150)
  }
  await page.waitForFunction(() => performance.getEntriesByType('mark').some((m) => m.name === 'open:place'), { timeout: 240000 })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await ready()
  await wait(1200)
  const navEnd = await page.evaluate(() => window.__editor.getSnapshot().page)
  check('スマホ：開いた直後にページ送りを3回押すと、3ページ先へ送る（移る先のページを組み終えたらすぐ。何度も送らない）', navEarly && navEnd === navStart + 3, JSON.stringify({ navEarly, navStart, navEnd }))

  // 組み終えた紙面は、まっさらな状態から組み直したときと同じ（ページ数・紙面の情報・指摘）
  const laidText = await page.evaluate((id) => window.__editor.renderer.pageView.fragments(id).some((f) => f.textContent.includes('開いた直後に書いた文')), para.id)
  const sum = () => page.evaluate(() => { const s = window.__editor.getSnapshot(); return JSON.stringify({ n: s.pageCount, layout: s.layout, findings: s.findings.map((f) => `${f.ruleId}|${f.blockId ?? ''}|${f.start ?? ''}`).sort() }) })
  const shownSum = await sum()
  await page.evaluate(async () => {
    window.__editor.renderer.forget()
    await window.__editor.render()
    await window.__editor.whenLaidOut()
  })
  await ready()
  const freshSum = await sum()
  check('スマホ：開いた直後に書いた文字も、組み終えた紙面に入り、紙面はまっさらな状態から組み直したときと同じ', laidText && shownSum === freshSum, shownSum === freshSum ? String(laidText) : JSON.stringify({ shownSum, freshSum }))
  await context.close()
}
