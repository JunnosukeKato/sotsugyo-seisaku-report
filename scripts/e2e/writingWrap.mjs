// 書く欄の折り返しが、紙面と同じかを確かめる（Edge を自動で操作する。パソコン）。
// 依頼者の指摘：段落を押すと、何も書いていないのに、書く欄の行の折り返しが紙面と違う（見本の原稿の p3：紙面は「…デザインを考えた」で行が終わり、
// 「（図1）。」が次の行の始めなのに、書く欄は「…考えた（図」で終わり、「1）。」が次の行の始めになっていた）。2026-10-19。
// 書く欄は、紙面と同じ組み方（句読点の詰め・英数字の前後のすき間・ぶら下げ。図表の参照は途中で折り返さない）で書く（src/editor/textSpacing.ts）。
// - 見本の原稿の本文と抄録のすべての段落、ページをまたぐ長い段落：書く欄を開いただけで、行の始まりの文字が紙面と同じ
// - 書き終えた直後の仮の表示（.overlay-frozen）も、組み直した紙面と同じ所で折り返す
// - 書く欄で打つ・消す・日本語の変換・元に戻す・やり直す・↓で次の行へ、が今までどおり
// smoke.mjs から呼ぶ（writingWrapPc）。これだけを動かすときは node scripts/e2e/writingWrap.mjs。画面の写真は poc-output/range-select/
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { stubConfig } from './configStub.mjs'
import { setupWriting } from './sampleReport.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/range-select'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function openSample(browser, viewport) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror(writingWrap):', e.message))
  await page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
    /** 要素たちの文字の、行の始まりの文字の位置（ページをまたぐ段落は、ページごとの要素を順に） */
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
  })
  await stubConfig(page)
  await page.setViewport(viewport)
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

/** 紙面の段落 id の行の始まり（見えていないページも測る） */
const pageStarts = (page, id) =>
  page.evaluate((id) => {
    const ed = window.__editor
    ed.renderer.viewport.classList.add('measuring')
    const starts = window.__lineStarts(ed.renderer.pageView.fragments(id))
    ed.renderer.viewport.classList.remove('measuring')
    return starts
  }, id)
const editorStarts = (page) => page.evaluate(() => window.__lineStarts([document.querySelector('.overlay-clip:not([hidden]) .overlay-editor')]))
const editorState = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.overlay-clip:not([hidden]) .overlay-editor')
    return { text: el?.textContent ?? '', editing: window.__editor.getSnapshot().editingId, caret: window.__editor.overlay.selectionOffsets().start }
  })
const ctrl = async (page, key) => {
  await page.keyboard.down('Control')
  await page.keyboard.press(key)
  await page.keyboard.up('Control')
}

/** 段落を1つずつ開いて、行の始まりを紙面と比べる（違った段落を返す） */
async function compareAll(page, ready, ids) {
  const bad = []
  for (const id of ids) {
    await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), id)
    await ready()
    const onPage = await pageStarts(page, id)
    await page.evaluate((id) => window.__editor.openEditor(id, 0), id)
    await wait(120)
    const inEditor = await editorStarts(page)
    if (JSON.stringify(onPage) !== JSON.stringify(inEditor)) bad.push({ id, onPage, inEditor })
    await page.keyboard.press('Escape')
    await ready()
  }
  return bad
}

export async function writingWrapPc(browser, check) {
  // ---- 依頼者の画面の大きさ（1600×1000）と、ノートパソコン（1366×768）で、見本の原稿のすべての段落 ----
  for (const viewport of [{ width: 1600, height: 1000 }, { width: 1366, height: 768 }]) {
    const { context, page, ready } = await openSample(browser, viewport)
    const ids = await page.evaluate(() => {
      const r = window.__editor.getSnapshot().report
      return [...r.abstract.paragraphs.map((p) => p.id), ...r.body.flatMap((c) => c.blocks).filter((b) => b.type === 'paragraph').map((b) => b.id)]
    })
    const bad = await compareAll(page, ready, ids)
    check(`書く欄の折り返し（${viewport.width}×${viewport.height}）：見本の原稿の抄録と本文のすべての段落（${ids.length}）で、段落を押しただけなら、書く欄の行の始まりの文字が紙面と同じ`, ids.length > 20 && bad.length === 0, JSON.stringify(bad.slice(0, 2)))
    if (viewport.width === 1600) {
      // 依頼者の例：p3 は、紙面も書く欄も「（図1）。」が2行目の始め（「（図」と「1）」で分かれない）
      await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('p3'), 'none'))
      await ready()
      await page.evaluate(() => window.__editor.openEditor('p3', 0))
      await wait(150)
      const p3 = await page.evaluate(() => {
        const el = document.querySelector('.overlay-clip:not([hidden]) .overlay-editor')
        const starts = window.__lineStarts([el])
        const text = el.textContent
        const ref = el.querySelector('.fig-ref')
        return { second: text.slice(starts[1], starts[1] + 5), ref: ref?.textContent, nowrap: ref ? getComputedStyle(ref).textWrapMode : '' }
      })
      await page.screenshot({ path: `${OUT}/wrap-p3-editor.png` })
      check('書く欄の折り返し：p3 は、書く欄でも「（図1）。」が2行目の始め。書く欄の「（図1）」は途中で折り返さないまとまり', p3.second === '（図1）。' && p3.ref === '（図1）' && p3.nowrap === 'nowrap', JSON.stringify(p3))
      await page.keyboard.press('Escape')
      await ready()
    }
    await context.close()
  }

  const { context, page, ready } = await openSample(browser, { width: 1600, height: 1000 })
  const cdp = await page.createCDPSession()

  // ---- ページをまたぐ長い段落（文字・括弧・英数字・（図1）の入った長い章を足す） ----
  await page.evaluate(() => {
    const kana = '本制作では、衣装の素材や形を検討し、舞台の上での見え方を確かめながら制作を進めた。袖山を3cm下げ（図1）、「試作」を2回行った。'
    const text = (n, seed) => Array.from({ length: n }, (_, i) => kana[(i + seed) % kana.length]).join('')
    const ed = window.__editor
    ed.update((r) => ({ ...r, body: [...r.body.slice(0, 2), { id: 'xc', title: '追加の章', blocks: Array.from({ length: 6 }, (_, k) => ({ type: 'paragraph', id: `xp${k}`, content: [{ type: 'text', text: `${text(380, k * 7)}。` }] })) }, ...r.body.slice(2)] }))
  })
  await wait(300)
  await ready()
  const longIds = ['xp0', 'xp1', 'xp2', 'xp3', 'xp4', 'xp5']
  const spans = await page.evaluate((ids) => ids.filter((id) => window.__editor.renderer.pageView.fragments(id).length > 1).length, longIds)
  const longBad = await compareAll(page, ready, longIds)
  check('書く欄の折り返し：長い段落（ページをまたぐ段落も）でも、書く欄の行の始まりが紙面と同じ', spans > 0 && longBad.length === 0, JSON.stringify({ spans, bad: longBad.slice(0, 1) }))

  // ---- 書き終えた直後の仮の表示（.overlay-frozen）も、組み直した紙面と同じ所で折り返す ----
  const frozenBad = []
  for (const id of ['p3', 'p8', 'xp1']) {
    await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), id)
    await ready()
    await page.evaluate((id) => window.__editor.openEditor(id, 10), id)
    await wait(120)
    await page.keyboard.type('書き足した（図2）文、')
    // 長い段落の前の方を書いているときは、書いている所の近くだけをすぐ測り直し、残りは打つ手が止まってから測り直す（overlayEditor.ts）
    await wait(400)
    const typed = await editorStarts(page)
    await page.keyboard.press('Escape')
    const frozen = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.overlay-frozen > div')].at(-1)
      return el ? window.__lineStarts([el]) : null
    })
    await ready()
    await wait(200)
    const after = await pageStarts(page, id)
    if (JSON.stringify(typed) !== JSON.stringify(after) || JSON.stringify(frozen) !== JSON.stringify(after)) frozenBad.push({ id, typed, frozen, after })
  }
  check('書く欄の折り返し：書いて閉じた直後の仮の表示も、書いていたとき（打つ手を止めたとき）も、組み直した紙面と同じ所で折り返す', frozenBad.length === 0, JSON.stringify(frozenBad.slice(0, 1)))

  // ---- 長い段落の途中を書き換えても（打つたびに、書いた行の1つ前の行から後ろだけを測り直す）、段落全体を組み直したときと同じ組み方 ----
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('xp2'), 'none'))
  await ready()
  await page.evaluate(() => window.__editor.openEditor('xp2', 0))
  await wait(200)
  const incrementalBad = []
  const pieces = ['あ', '、', '「か」', 'AB', '12', '。', '（い）', 'う、え。']
  for (let k = 0; k < 16; k++) {
    const res = await page.evaluate(
      async (k, pieces) => {
        const el = document.querySelector('.overlay-clip:not([hidden]) .overlay-editor')
        window.__editor.overlay.setCaret((k * 37) % el.textContent.length)
        if (k % 3 === 2) {
          const sel = getSelection()
          sel.modify('extend', 'forward', 'character')
          sel.modify('extend', 'forward', 'character')
          document.execCommand('delete')
        } else document.execCommand('insertText', false, pieces[k % pieces.length])
        // 打つ手が止まって、まとめて測り直すのを待つ
        await new Promise((r) => setTimeout(r, 350))
        const { typesetSpacing } = await window.__import('editor/textSpacing.ts')
        const whole = document.createElement('div')
        whole.className = 'overlay-ghost'
        whole.dataset.typeset = ''
        whole.style.cssText = el.style.cssText
        Object.assign(whole.style, { position: 'absolute', whiteSpace: 'pre-wrap', lineBreak: 'strict' })
        whole.innerHTML = el.innerHTML
        el.parentElement.append(whole)
        typesetSpacing(whole)
        const marks = (root) => {
          const out = []
          let i = 0
          const walk = (n) => {
            for (const c of n.childNodes) {
              if (c.nodeType === 3) i += c.length
              else {
                if (/^viv-ts-(open|close|thin-sp)$/.test(c.localName)) out.push(`${i}${c.localName}.${c.className}`)
                walk(c)
              }
            }
          }
          walk(root)
          return out.join(' ')
        }
        const same = marks(el) === marks(whole)
        whole.remove()
        return same
      },
      k,
      pieces,
    )
    if (!res) incrementalBad.push(k)
  }
  check('書く欄：長い段落の途中を書き換えても（打つたびに測り直すのは、書いた所の近くだけ）、打つ手を止めると、段落全体を組み直したときと同じ組み方になる', incrementalBad.length === 0, JSON.stringify(incrementalBad))
  await page.keyboard.press('Escape')
  await ready()

  // ---- 書く欄の操作が今までどおり ----
  await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('p4'), 'none'))
  await ready()
  await page.evaluate(() => window.__editor.openEditor('p4', 0))
  await wait(150)
  const p4 = (await editorState(page)).text
  // 「、」のすぐ後ろに打った文字は、ふつうの字間（詰めた句読点の要素の中に入らない）
  const comma = p4.indexOf('、') + 1
  await page.evaluate((c) => window.__editor.overlay.setCaret(c), comma)
  await page.keyboard.type('あい')
  const afterComma = await page.evaluate((c) => {
    const el = document.querySelector('.overlay-clip:not([hidden]) .overlay-editor')
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let acc = 0
    while (w.nextNode()) {
      const n = w.currentNode
      if (c < acc + n.length) return { parent: n.parentElement.localName, text: el.textContent.slice(c - 1, c + 3) }
      acc += n.length
    }
    return null
  }, comma)
  check('書く欄：句読点のすぐ後ろに打った文字は、ふつうの字間で入る（句読点を包んだ要素の中に入らない）', afterComma?.parent === 'div' && afterComma.text === '、あい' + p4[comma], JSON.stringify(afterComma))
  // 書く欄の中の元に戻す・やり直す
  await ctrl(page, 'z')
  const undone = (await editorState(page)).text
  await ctrl(page, 'y')
  const redone = (await editorState(page)).text
  check('書く欄：Ctrl+Z で打った文字が戻り、Ctrl+Y でまた入る（書く欄は開いたまま）', undone === p4 && redone === p4.slice(0, comma) + 'あい' + p4.slice(comma), JSON.stringify({ undone: undone.slice(0, 20), redone: redone.slice(0, 20) }))
  // 日本語の変換（変換中の文字はブラウザに任せ、確定したら組み直す）
  await page.evaluate(() => window.__editor.overlay.setCaret(2))
  await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 })
  await cdp.send('Input.imeSetComposition', { text: 'かん', selectionStart: 2, selectionEnd: 2 })
  const composing = (await editorState(page)).text
  await cdp.send('Input.insertText', { text: '漢' })
  await wait(80)
  const composed = await editorState(page)
  await ctrl(page, 'z')
  const composedUndo = (await editorState(page)).text
  check(
    '書く欄：日本語の変換中も文字が見え、確定すると入る（カーソルは確定した文字の後ろ）。Ctrl+Z で戻る',
    composing.slice(2, 4) === 'かん' && composed.text.slice(2, 3) === '漢' && composed.caret === 3 && composedUndo === redone,
    JSON.stringify({ composing: composing.slice(0, 6), composed: composed.text.slice(0, 6), caret: composed.caret }),
  )
  // ↓：1行目なら同じ段落の次の行、最後の行なら次の欄へ（今までどおり）
  await page.evaluate(() => window.__editor.overlay.setCaret(3))
  await page.keyboard.press('ArrowDown')
  const down1 = await editorState(page)
  await page.keyboard.press('End')
  await page.keyboard.down('Control')
  await page.keyboard.press('End')
  await page.keyboard.up('Control')
  await page.keyboard.press('ArrowDown')
  await wait(300)
  const down2 = await editorState(page)
  check('書く欄：1行目で↓は同じ段落の次の行へ、最後の行で↓は次の段落へ（今までどおり）', down1.editing === 'p4' && down1.caret > 30 && down2.editing === 'p4b', JSON.stringify({ down1, down2: down2.editing }))
  // Enter で分ける：分けた前の段落の仮の表示も、紙面と同じ組み方
  await page.evaluate(() => window.__editor.overlay.setCaret(12))
  await page.keyboard.press('Enter')
  await wait(50)
  const ghost = await page.evaluate(() => ({ typeset: !!document.querySelector('.overlay-ghost[data-typeset]'), editing: window.__editor.getSnapshot().editingId }))
  check('書く欄：Enter で分けた前の段落の仮の表示も、紙面と同じ組み方（紙面を組み直す前）', ghost.typeset && ghost.editing !== 'p4b', JSON.stringify(ghost))
  await page.keyboard.press('Escape')
  await ready()
  await context.close()
}

// これだけを動かす：node scripts/e2e/writingWrap.mjs
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { withEdge } = await import('../poc/edge.mjs')
  const results = []
  const check = (name, ok, detail = '') => {
    results.push(ok)
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
  }
  await withEdge((browser) => writingWrapPc(browser, check))
  const failed = results.filter((ok) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} 件 合格`)
  process.exitCode = failed ? 1 : 0
}
