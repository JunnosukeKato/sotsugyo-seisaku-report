// スマホで学生が試して見つかったことの直し（2026-10-24）。これだけを流すときは node scripts/e2e/run.mjs phoneFixes1024
// - 「字を大きくするには」は、はじめての案内が出ている間は出さない（前は案内の吹き出しの下に隠れたまま「見た」ことになり、本文では出なかった）
// - 表紙の氏名を書く欄は、下線の右端まで（前は「文化　花／子」と折り返した）
// - 図は横に2枚まで（「もう1枚」・段落からの「図」で、3枚目が同じ並びに入っていた）
// - Word から写したあとの「エラーを直す あと○件」は、下の「直すところ」のエラーの数（前は「進み具合」の側のエラーも数えて食い違った）
// - 下のタブの名前は折り返さない（360px で「ページ一／覧」）
// - mockups/v53（依頼者の選択）：「3．スカート」は小見出しに・開いてすぐの「戻す」・大見出しの一言・図の「上へ」のわけ・作品写真（枚数に合わせる・詰める）・控えの札と目安・窓の下のボタン
import { existsSync, mkdirSync } from 'node:fs'
import { withEdge } from '../poc/edge.mjs'
import { stubConfig } from './configStub.mjs'
import { setupWriting } from './sampleReport.mjs'
import { confirmQueue } from './confirmUi.mjs'

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/phone-fixes-1024'
mkdirSync(OUT, { recursive: true })
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
}

async function open(browser, { width = 390, height = 844, fresh = true } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  if (!fresh) await page.evaluateOnNewDocument(() => { try { localStorage.setItem('sotsugyo-seisaku-report-tour', 'done') } catch {} })
  await stubConfig(page)
  await page.setUserAgent(IPHONE)
  await page.setViewport({ width, height, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await page.goto(`${APP}/?nodrive`, { waitUntil: 'networkidle0', timeout: 90000 })
  const ready = () => page.waitForFunction(() => { const s = window.__editor?.getSnapshot(); return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading') }, { timeout: 120000 })
  await ready()
  return { context, page, ready }
}

/** 紙面の欄（data-block-id）の真ん中を指で押す */
const tapBlock = async (page, id) => {
  const p = await page.evaluate((id) => {
    const el = [...document.querySelectorAll(`.page-viewport.front [data-block-id="${id}"]`)].find((e) => e.getBoundingClientRect().width > 0)
    const r = el.getBoundingClientRect()
    return { x: r.left + Math.min(r.width / 2, 30), y: r.top + r.height / 2 }
  }, id)
  await page.touchscreen.tap(p.x, p.y)
  await wait(500)
}

await withEdge(async (browser) => {
  // ---- 「字を大きくするには」：はじめての案内の間は出さず、案内を閉じてから書くと出る（指差し確認は見たことにする。その間も出さない） ----
  {
    const { context, page, ready } = await open(browser, { fresh: false })
    await page.waitForSelector('.guide.step-course .g-opts button', { timeout: 60000 })
    await page.evaluate(() => document.querySelector('.g-opts button').click())
    await page.waitForSelector('.guide.step-word .g-word-opt.no')
    await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
    await page.waitForSelector('.guide.step-studentId')
    await ready()
    await tapBlock(page, 'basic:studentId')
    await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'basic:studentId', { timeout: 20000 })
    await page.keyboard.type('24AB001')
    await wait(400)
    const during = { tip: !!(await page.$('.pinch-tip')), stored: await page.evaluate(() => localStorage.getItem('sotsugyo-seisaku-report-pinch-tip')) }
    await page.screenshot({ path: `${OUT}/1-guide-no-tip.png` })
    // 氏名：「文化　花子」が1行のまま（書く欄は下線の右端まで）
    await page.waitForSelector('.guide.step-name', { timeout: 20000 }).catch(() => {})
    await tapBlock(page, 'basic:name')
    await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'basic:name', { timeout: 20000 })
    await page.keyboard.type('文化　花子')
    await wait(600)
    const name = await page.evaluate(() => {
      const box = document.querySelector('.overlay-editor')
      const r = box.getBoundingClientRect()
      const lh = parseFloat(getComputedStyle(box).lineHeight) * (r.height / box.offsetHeight || 1)
      const rule = [...document.querySelectorAll('.page-viewport.front .rule.name-rule')].find((e) => e.getBoundingClientRect().width > 0).getBoundingClientRect()
      return { lines: Math.round(r.height / lh), right: Math.round(r.right), ruleRight: Math.round(rule.right) }
    })
    await page.screenshot({ path: `${OUT}/2-name-one-line.png` })
    const storedAfterName = await page.evaluate(() => localStorage.getItem('sotsugyo-seisaku-report-pinch-tip') + '|' + (document.querySelector('.guide')?.className ?? 'noguide'))
    check('はじめての案内が出ている間は、「字を大きくするには」を出さない（「見た」にもしない）', !during.tip && during.stored === null, JSON.stringify(during))
    check('表紙の氏名「文化　花子」を書いている間も1行のまま（書く欄は下線の右端まで）', name.lines === 1 && Math.abs(name.right - name.ruleRight) <= 2, JSON.stringify(name))
    // 氏名を書き終えてから（「完了」）、案内を閉じて本文を書くと出る
    await page.evaluate(() => [...document.querySelectorAll('.direct-bar button')].find((b) => b.textContent.includes('完了'))?.click())
    await wait(600)
    await ready()
    const storedAfterDone = await page.evaluate(() => localStorage.getItem('sotsugyo-seisaku-report-pinch-tip'))
    await page.evaluate(() => document.querySelectorAll('.guide .g-later').forEach((b) => b.click()))
    await wait(400)
    await page.evaluate(() => window.__editor.goToPage(window.__editor.getSnapshot().layout.kinds.indexOf('body'), 'none'))
    await ready()
    const first = await page.evaluate(() => window.__editor.getSnapshot().report.body[0].blocks.find((b) => b.type === 'paragraph').id)
    await tapBlock(page, first)
    await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 20000 }, first)
    await wait(400)
    const after = { guide: !!(await page.$('.guide')), tour: !!(await page.$('.tour')), tip: !!(await page.$('.pinch-tip')), bar: !!(await page.$('.direct-bar')), stored: await page.evaluate(() => localStorage.getItem('sotsugyo-seisaku-report-pinch-tip')), storedAfterName, storedAfterDone }
    await page.screenshot({ path: `${OUT}/3-body-tip.png` })
    check('案内を閉じてから本文を書くと、「字を大きくするには」が出る', !after.guide && !after.tour && after.tip && storedAfterDone === null, JSON.stringify(after))
    await context.close()
  }

  // ---- 図は横に2枚まで（スマホの「もう1枚」） ----
  {
    const { context, page, ready } = await open(browser, { fresh: false })
    await page.waitForSelector('.guide.step-course .g-opts button', { timeout: 60000 })
    await page.evaluate(() => document.querySelector('.g-opts button').click())
    await page.waitForSelector('.guide.step-word .g-word-opt.no')
    await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
    await page.waitForSelector('.guide .g-later')
    await page.evaluate(() => document.querySelector('.guide .g-later').click())
    await ready()
    await page.evaluate(setupWriting)
    await wait(500)
    await ready()
    // 図1の並びを2枚にしてから、1枚目を選んで「もう1枚」
    await page.evaluate(() => window.__editor.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === 'r1' ? { ...b, figures: [...b.figures, { id: 'f1b', imageId: 'g-mood', caption: '二枚目' }] } : b)) })) })))
    await wait(400)
    await ready()
    await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('r1'), 'none'))
    await ready()
    const firstFig = await page.evaluate(() => window.__editor.getSnapshot().report.body[0].blocks.find((b) => b.id === 'r1').figures[0].id)
    await page.evaluate((id) => window.__editor.select({ kind: 'figure', id }), firstFig)
    await wait(400)
    const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 20000 }), page.evaluate(() => [...document.querySelectorAll('.sel-bar .tb')].find((b) => b.textContent.includes('もう1枚')).click())])
    const photo = 'docs/guide-images/sample/swatch-satin.jpg'
    await chooser.accept([photo])
    await page.waitForFunction(() => window.__editor.getSnapshot().report.body[0].blocks.filter((b) => b.type === 'figureRow').reduce((n, b) => n + b.figures.length, 0) >= 3, { timeout: 30000 })
    await wait(500)
    await ready()
    const rows = await page.evaluate(() => window.__editor.getSnapshot().report.body[0].blocks.filter((b) => b.type === 'figureRow').map((b) => b.figures.length))
    await page.screenshot({ path: `${OUT}/4-two-per-row.png` })
    check('2枚並んだ図で「もう1枚」を押しても、横は2枚まで（あふれた図は、すぐ下の並びへ）', rows.every((n) => n <= 2) && rows.slice(0, 2).join('+') === '2+1', JSON.stringify(rows))
    await context.close()
  }

  // ---- 下のタブ（360px）・Word から写したあとの「あと○件」 ----
  {
    const { context, page, ready } = await open(browser, { width: 360, height: 740 })
    await page.waitForSelector('.guide.step-course .g-opts button', { timeout: 60000 })
    const tabs = await page.evaluate(() => [...document.querySelectorAll('.p-nav button')].map((b) => { const t = [...b.childNodes].map((n) => n.textContent).join('').trim(); const r = b.getBoundingClientRect(); return { t, lines: b.querySelector('span') ? Math.round(b.querySelector('span').getBoundingClientRect().height / parseFloat(getComputedStyle(b).lineHeight || '16')) : 1, h: Math.round(r.height) } }))
    check('360px の画面でも、下のタブの名前（ページ一覧など）は1行', tabs.length === 5 && tabs.every((x) => x.lines <= 1), JSON.stringify(tabs))
    const FIX = process.env.WORD_FIXTURES ?? 'scripts/e2e/fixtures'
    const bodyDocx = `${FIX}/word-sample-body.docx`
    const coverDocx = `${FIX}/word-sample-cover.docx`
    if (existsSync(bodyDocx) && existsSync(coverDocx)) {
      await page.evaluate(() => document.querySelector('.g-opts button').click())
      await page.waitForSelector('.guide.step-word .g-word-opt.yes')
      await page.evaluate(() => document.querySelector('.g-word-opt.yes').click())
      await page.waitForSelector('.modal.word-mid')
      // ツールで1章目に1段落書いてあることにする（Word の1章目に入れ替わって消える分。赤い札を確かめる：mockups/v53 ⑧）
      await page.evaluate(() => window.__editor.update((r) => ({ ...r, body: r.body.map((c, i) => (i === 0 ? { ...c, blocks: [...c.blocks, { type: 'paragraph', id: 'tool-p', content: [{ type: 'text', text: 'ツールで書いた段落である。' }] }] } : c)) })))
      await wait(300)
      for (const [row, path] of [[0, bodyDocx], [1, coverDocx]]) {
        const [chooser] = await Promise.all([page.waitForFileChooser(), page.evaluate((row) => document.querySelectorAll('.word-file .acts button:not(.link)')[row].click(), row)])
        await chooser.accept([path])
        await wait(200)
      }
      await page.evaluate(() => [...document.querySelectorAll('.modal .row-buttons button')].find((b) => b.textContent.includes('中身を確かめる')).click())
      await page.waitForSelector('.modal.word-modal', { timeout: 60000 })
      const gone = await page.evaluate(() => [...document.querySelectorAll('.word-outline li.ch')].map((li) => ({ t: li.querySelector('.ttl')?.textContent ?? '', gone: li.querySelector('.gone')?.textContent ?? '' })))
      await page.screenshot({ path: `${OUT}/11-word-gone.png` })
      check('Word の中身の確認：Word の章に入れ替わる章にも「ツールで書いた1段落は消えます」の赤い札（mockups/v53 ⑧）', gone.some((g) => g.gone.includes('ツールで書いた1段落は消えます')), JSON.stringify(gone))
      await page.evaluate(() => [...document.querySelectorAll('.modal .row-buttons button')].find((b) => b.textContent.includes('読み込む')).click())
      await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 60000 })
      await ready()
      await page.waitForSelector('.sheet .word-todo', { timeout: 20000 })
      await wait(500)
      const counts = await page.evaluate(() => {
        const li = [...document.querySelectorAll('.sheet .word-todo li')].find((x) => x.textContent.includes('エラーを直す'))
        const small = li?.querySelector('small')?.textContent ?? ''
        const m = small.match(/あと\s*(\d+)件/)
        const tally = document.querySelector('.sheet .tally')?.textContent.replace(/\s/g, '') ?? ''
        const fixErrors = document.querySelectorAll('.sheet .issue.error').length
        return { small, todo: m ? Number(m[1]) : 0, tally, fixErrors }
      })
      await page.screenshot({ path: `${OUT}/5-word-todo.png` })
      check('Word から写したあとの「エラーを直す」の数は、下の「直すところ」のエラーの数と同じ', counts.todo === counts.fixErrors && (counts.todo > 0 ? counts.small.includes('「直すところ」') : counts.small.includes('エラーはありません')), JSON.stringify(counts))
    } else {
      check('見本の Word がある', false)
    }
    await context.close()
  }
  // ==== mockups/v53（依頼者の選択 2026-10-24）：見出しの自動変換・開いてすぐの「戻す」・大見出しの一言・図のわけ・作品写真・控えの目安・窓のボタン ====
  {
    const { context, page, ready } = await open(browser, { fresh: false })
    const queue = await confirmQueue(page, true)
    await page.waitForSelector('.guide.step-course .g-opts button', { timeout: 60000 })
    await page.evaluate(() => document.querySelector('.g-opts button').click())
    await page.waitForSelector('.guide.step-word .g-word-opt.no')
    await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
    await page.waitForSelector('.guide .g-later')
    await page.evaluate(() => document.querySelector('.guide .g-later').click())
    await ready()
    // ⑦ 案内でコースを選んだあとは、「戻す」が押せない（コースが消えない）
    const start = await page.evaluate(() => ({ canUndo: window.__editor.getSnapshot().canUndo, course: window.__editor.getSnapshot().report.basicInfo.courseId }))
    check('はじめての案内でコースを選んだあとは「戻す」が押せない（選んだコースは「戻す」で消えない。mockups/v53 ⑦）', !start.canUndo && !!start.course, JSON.stringify(start))

    await page.evaluate(setupWriting)
    await wait(500)
    await ready()
    // ② 段落に「3．スカート」と打って Enter → 小見出し（番号はツールの形）
    await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('p12'), 'none'))
    await ready()
    await page.evaluate(() => window.__editor.openWhenReady('p12', 999))
    await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p12', { timeout: 20000 })
    await page.keyboard.press('Enter')
    await wait(300)
    await page.keyboard.type('3．スカート')
    await page.keyboard.press('Enter')
    await wait(800)
    const typed = await page.evaluate(() => {
      const blocks = window.__editor.getSnapshot().report.body[1].blocks
      return { subs: blocks.filter((b) => b.type === 'subheading').map((b) => b.title), paras: blocks.filter((b) => b.type === 'paragraph').map((b) => b.content.map((n) => n.text ?? '').join('')).filter((t) => t.includes('スカート')), notice: document.querySelector('.undo-toast')?.textContent ?? '' }
    })
    await page.screenshot({ path: `${OUT}/6-arabic-heading.png` })
    check('段落に「3．スカート」と打って Enter：小見出し「スカート」になり（「。」は付かない）、［戻す］の知らせが出る（mockups/v53 ② 案B）', typed.subs.includes('スカート') && typed.paras.length === 0 && /小見出し/.test(typed.notice) && /戻す/.test(typed.notice), JSON.stringify(typed))
    // ⑤ 書いている間の「追加」：大見出しの入る場所の一言
    await page.evaluate(() => [...document.querySelectorAll('.direct-bar .db-row button')].find((b) => b.textContent.includes('追加'))?.click())
    await wait(300)
    const addNote = await page.evaluate(() => document.querySelector('.direct-bar .db-add-note')?.textContent ?? '')
    check('書いている間の「追加」に「大見出しは、この章のいちばん後ろに新しい章を足します」と出る（mockups/v53 ⑤ 案B）', addNote.includes('大見出しは、この章のいちばん後ろに新しい章を足します'), addNote)
    await page.evaluate(() => [...document.querySelectorAll('.direct-bar button')].find((b) => b.textContent.includes('完了'))?.click())
    await wait(500)
    await ready()

    // ⑧ 図の「上へ」が押せないとき、押すとわけを知らせる（図1は、すぐ上の段落に（図1）がある）
    await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('r1'), 'none'))
    await ready()
    await page.evaluate(() => window.__editor.select({ kind: 'figure', id: 'f1' }))
    await wait(400)
    const up = await page.evaluate(() => {
      const b = [...document.querySelectorAll('.sel-bar .tb')].find((x) => x.textContent.includes('上へ'))
      b?.click()
      return { disabled: !!b?.disabled, aria: b?.getAttribute('aria-disabled') ?? '' }
    })
    await wait(400)
    const why = await page.evaluate(() => document.querySelector('.undo-toast')?.textContent ?? '')
    check('スマホ：図の「上へ」が押せないとき、押すと「本文の（図n）がある段落より上…には動かせません」と知らせる（mockups/v53 ⑧）', !up.disabled && up.aria === 'true' && why.includes('動かせません'), JSON.stringify({ up, why }))
    await page.evaluate(() => window.__editor.select(null))

    // ① 作品写真：空のページで2枚まとめて選ぶと「2枚 左右」の1ページ
    const photosAt = await page.evaluate(() => window.__editor.getSnapshot().layout.kinds.indexOf('photos'))
    await page.evaluate(() => window.__editor.update((r) => ({ ...r, workPhotos: [{ layout: 1, imageIds: [] }] })))
    await wait(400)
    await ready()
    await page.evaluate((i) => window.__editor.goToPage(i, 'none'), photosAt)
    await ready()
    const slot = await page.evaluate(() => { const r = [...document.querySelectorAll('.page-viewport.front [data-photo-slot="0"]')].find((e) => e.getBoundingClientRect().width > 0).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } })
    const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 20000 }), page.touchscreen.tap(slot.x, slot.y)])
    await chooser.accept(['docs/guide-images/sample/photo-1.jpg', 'docs/guide-images/sample/design.jpg'])
    await page.waitForFunction(() => window.__editor.getSnapshot().report.workPhotos.flatMap((p) => p.imageIds.filter(Boolean)).length >= 2, { timeout: 30000 })
    await wait(600)
    await ready()
    const bulk = await page.evaluate(() => ({ pages: window.__editor.getSnapshot().report.workPhotos.map((p) => `${p.layout}:${p.columns ?? ''}:${p.imageIds.filter(Boolean).length}`), notice: document.querySelector('.undo-toast')?.textContent ?? '' }))
    await page.screenshot({ path: `${OUT}/7-photos-bulk.png` })
    check('作品写真：空のページで2枚まとめて選ぶと、「2枚 左右」の並べ方で1ページに入る（mockups/v53 ① 案B）', bulk.pages.join(',') === '2:2:2' && bulk.notice.includes('2枚 左右'), JSON.stringify(bulk))
    // ① 並べ方を変えたら詰める：1枚ずつ2ページ → 1ページ目を「2枚 左右」に
    await page.evaluate(() => window.__editor.update((r) => ({ ...r, workPhotos: [{ layout: 1, imageIds: [r.workPhotos[0].imageIds[0]] }, { layout: 1, imageIds: [r.workPhotos[0].imageIds[1]] }] })))
    await wait(400)
    await ready()
    await page.evaluate((i) => window.__editor.goToPage(i, 'none'), photosAt)
    await ready()
    await page.evaluate(() => [...document.querySelectorAll('.sel-bar .lay, .page-side .lay')].find((b) => b.textContent.replace(/\s/g, '') === '2枚左右')?.click())
    await wait(600)
    await ready()
    const packed = await page.evaluate(() => ({ pages: window.__editor.getSnapshot().report.workPhotos.map((p) => `${p.layout}:${p.imageIds.filter(Boolean).length}`), notice: document.querySelector('.undo-toast')?.textContent ?? '' }))
    await page.screenshot({ path: `${OUT}/8-photos-packed.png` })
    check('作品写真：並べ方を「2枚 左右」にすると、次のページの写真を詰め、空いたページを消す（［戻す］つき。mockups/v53 ① 案A）', packed.pages.join(',') === '2:2' && packed.notice.includes('次のページの写真を詰めました') && packed.notice.includes('戻す'), JSON.stringify(packed))

    // ④ 自動の控え：「最初から作り直す」の前の控えに札と中身の目安
    await page.evaluate(() => window.__editor.select(null))
    await wait(300)
    await page.evaluate(() => document.querySelector('.p-top .icon-btn').click())
    await page.waitForSelector('.sheet .backup-btn')
    await page.evaluate(() => document.querySelector('.sheet .backup-btn').click())
    await page.waitForSelector('.modal .snapshots, .modal .muted')
    const ask = queue.next(true)
    await page.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.includes('最初から作り直す'))?.click())
    await ask
    await page.waitForFunction(() => !document.querySelector('.modal'), { timeout: 20000 })
    await ready()
    await page.evaluate(() => window.__editor.select(null))
    await wait(300)
    await page.evaluate(() => document.querySelector('.p-top .icon-btn').click())
    await page.waitForSelector('.sheet .backup-btn')
    await page.evaluate(() => document.querySelector('.sheet .backup-btn').click())
    await page.waitForSelector('.modal .snapshots li', { timeout: 20000 })
    await wait(300)
    const snaps = await page.evaluate(() => [...document.querySelectorAll('.modal .snapshots li')].map((li) => ({ label: li.querySelector('.snap-label')?.textContent ?? '', summary: li.querySelector('.snap-when small')?.textContent ?? '' })))
    // ③ 窓のいちばん下のボタンの段は、窓の下にいつも見える
    const stick = await page.evaluate(() => {
      const m = document.querySelector('.modal')
      const row = m.querySelector(':scope > .row-buttons:last-child')
      const mr = m.getBoundingClientRect()
      const rr = row?.getBoundingClientRect()
      return { position: row ? getComputedStyle(row).position : '', inside: !!rr && rr.bottom <= mr.bottom + 1 && rr.bottom <= innerHeight, scrolls: m.scrollHeight > m.clientHeight }
    })
    await page.screenshot({ path: `${OUT}/9-backup-labels.png` })
    const kept = snaps.find((s) => s.label === '作り直す前')
    check('自動の控え：「最初から作り直す」の前の控えに「作り直す前」の札と、中身の目安（本文の字数・図の数など）が出る（mockups/v53 ④ 案A）', !!kept && /本文 [\d,]+字/.test(kept.summary) && /図 \d+枚/.test(kept.summary), JSON.stringify(snaps))
    check('スマホ：窓のいちばん下のボタンの段は、窓の下に止まって見える（mockups/v53 ③ 案A）', stick.position === 'sticky' && stick.inside, JSON.stringify(stick))
    await context.close()
  }

  // ==== ③ 小さい画面（360×640）：直すところが多くても、PDF の窓の「PDF を作る」が窓の下に見える ====
  {
    const { context, page, ready } = await open(browser, { width: 360, height: 640, fresh: false })
    await page.waitForSelector('.guide.step-course .g-opts button', { timeout: 60000 })
    await page.evaluate(() => document.querySelector('.g-opts button').click())
    await page.waitForSelector('.guide.step-word .g-word-opt.no')
    await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
    await page.waitForSelector('.guide .g-later')
    await page.evaluate(() => document.querySelector('.guide .g-later').click())
    await ready()
    await page.evaluate(setupWriting)
    await wait(500)
    await ready()
    // 直すところをたくさん作る（です・ます・全角の数字）
    await page.evaluate(() => window.__editor.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.type === 'paragraph' ? { ...b, content: [{ type: 'text', text: '袖を１０ｃｍ短くしました。' }] } : b)) })) })))
    await wait(800)
    await ready()
    await page.evaluate(() => document.querySelector('.p-nav .nav-pdf').click())
    await page.waitForSelector('.modal .pdf-start')
    await wait(400)
    const pdf = await page.evaluate(() => {
      const m = document.querySelector('.modal')
      const b = m.querySelector('.pdf-start').getBoundingClientRect()
      return { scrolls: m.scrollHeight > m.clientHeight, top: m.scrollTop, visible: b.top >= 0 && b.bottom <= innerHeight && b.bottom <= m.getBoundingClientRect().bottom + 1 }
    })
    await page.screenshot({ path: `${OUT}/10-pdf-360.png` })
    check('360×640 の画面で直すところが多くても、PDF の窓の「PDF を作る」は、下へずらさずに見える（mockups/v53 ③ 案A）', pdf.scrolls && pdf.top === 0 && pdf.visible, JSON.stringify(pdf))
    await context.close()
  }

})
console.log(`${results.filter(Boolean).length}/${results.length} 件 合格`)
if (!results.every(Boolean)) process.exitCode = 1
