// はじめて使う学生の試し（2026-10-21。パソコン・スマホ）で見つかったことの直しを確かめる（Edge を自動で操作する）。
// 画面の写真は poc-output/trial-fixes-1021/ に置く。
// パソコン：
// - 表のマスで、何も打っていないときの Ctrl+Z は、左の道具の「元に戻す」と同じ（行を足したのを戻す）。前のマスで消した字が入らない
// - 打って消しただけで書き終えたときは、元に戻す1回分を積まない（そのあとの「元に戻す」の1回目が空振りしない）
// - 「列を足す」は、足した列の、書いていた行のマスへ移る（生地見本の画像のマスを書いていても、続けて打った字は足したマスへ）
// - ページの一覧の赤い点は「直すところ」のエラーのあるページだけ（先生の許可を待つ抄録には付けない）
// - 抄録を書き始める前の案内は、言葉の切れ目でだけ折り返す
import { mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { linesIn } from './shapeUi.mjs'
import { openSample, showTable } from './tableShape.mjs'

const OUT = 'poc-output/trial-fixes-1021'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
/** 見本の原稿の素材表（名称・使用箇所・生地見本） */
const ID = 't1'

/** 原稿の表（行・列の数、マスの字と id） */
const tableOf = (page) =>
  page.evaluate((id) => {
    const t = window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === id)
    return { rows: t.rows.length, cols: t.rows[0].cells.length, texts: t.rows.flatMap((r) => r.cells.map((c) => c.text)), ids: t.rows.map((r) => r.cells.map((c) => c.id)), images: t.rows.map((r) => r.cells.map((c) => !!c.imageId)) }
  }, ID)

/** 左の道具のボタンを、マウスで押す（名前の字で探す） */
async function clickTool(page, label) {
  const at = await page.evaluate((label) => {
    const b = [...document.querySelectorAll('.palette button')].find((x) => x.textContent.replace(/\s/g, '').includes(label) && x.getBoundingClientRect().width > 0)
    if (!b) return null
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, label)
  if (!at) throw new Error(`左の道具に「${label}」がない`)
  await page.mouse.click(at.x, at.y)
  await wait(150)
}

const openCell = async (page, ready, id) => {
  await page.evaluate((id) => window.__editor.openEditor(id, 0), id)
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 15000 }, id)
  await wait(200)
}

export async function trialFixesPc(browser, check) {
  const { context, page, ready } = await openSample(browser, false)
  await page.setViewport({ width: 1366, height: 768 })
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, abstract: { ...r.abstract, started: false } })))
  await ready()
  await showTable(page, ready, ID)
  const t0 = await tableOf(page)

  // ---- 1. 前のマスで字を打って消し、「行を足す」→ Ctrl+Z：行を足したのが戻り、どのマスにも消した字は入らない ----
  await openCell(page, ready, t0.ids[1][1])
  await page.keyboard.type('丈')
  await wait(150)
  await page.keyboard.press('Backspace')
  await wait(150)
  await clickTool(page, '行を足す')
  await ready()
  await wait(300)
  const added = await tableOf(page)
  const editingAfterAdd = await page.evaluate(() => window.__editor.getSnapshot().editingId)
  await page.keyboard.down('Control')
  await page.keyboard.press('z')
  await page.keyboard.up('Control')
  await wait(300)
  await ready()
  await wait(300)
  const undone = await tableOf(page)
  await page.screenshot({ path: `${OUT}/pc-1-ctrlz-after-add-row.png` })
  check(
    'パソコン：マスで打って消してから「行を足す」→ 足した行のマスで何も打たずに Ctrl+Z：行を足したのが戻り、どのマスにも消した字（丈）は入らない',
    added.rows === t0.rows + 1 && editingAfterAdd === added.ids[2][0] && undone.rows === t0.rows && !undone.texts.some((t) => t.includes('丈')),
    JSON.stringify({ before: t0.rows, added: added.rows, editingAfterAdd, undone: undone.rows, stray: undone.texts.filter((t) => t.includes('丈')) }),
  )

  // ---- 2. 行を足し、別のマスで打って消して書き終える → 「元に戻す」1回で、行を足したのが戻る（空振りしない） ----
  await openCell(page, ready, t0.ids[1][0])
  await clickTool(page, '行を足す')
  await ready()
  await wait(300)
  const added2 = await tableOf(page)
  await openCell(page, ready, added2.ids[1][1])
  await page.keyboard.type('ア')
  await wait(150)
  await page.keyboard.press('Backspace')
  await wait(150)
  await page.keyboard.press('Escape')
  await wait(300)
  await ready()
  await clickTool(page, '元に戻す')
  await wait(300)
  await ready()
  const undone2 = await tableOf(page)
  check(
    'パソコン：行を足したあと、別のマスで打って消しただけで書き終えても、「元に戻す」1回で行を足したのが戻る（1回目が空振りしない）',
    added2.rows === t0.rows + 1 && undone2.rows === t0.rows,
    JSON.stringify({ added: added2.rows, afterOneUndo: undone2.rows }),
  )

  // ---- 3. 生地見本の画像のマスを書いているときに「列を足す」：足した列の同じ行のマスへ移り、打った字はそこに入る ----
  const swatch = t0.images.map((row, r) => row.findIndex((x) => x) >= 0 && r > 0 ? [r, row.findIndex((x) => x)] : null).find(Boolean)
  const [sr, sc] = swatch
  await openCell(page, ready, t0.ids[sr][sc])
  await clickTool(page, '列を足す')
  await ready()
  await wait(400)
  const widened = await tableOf(page)
  const newCell = widened.ids[sr][sc + 1]
  const editingNew = await page.evaluate(() => window.__editor.getSnapshot().editingId)
  await page.keyboard.type('あ')
  await wait(200)
  await page.keyboard.press('Escape')
  await wait(300)
  await ready()
  const typed = await tableOf(page)
  await page.screenshot({ path: `${OUT}/pc-3-add-column.png` })
  check(
    'パソコン：生地見本の画像のマスを書いているときに「列を足す」：足した列の、同じ行のマスを書く（打った字は、画像のマスではなく足したマスに入る）',
    widened.cols === t0.cols + 1 && editingNew === newCell && typed.texts[typed.ids.flat().indexOf(newCell)] === 'あ' && typed.texts[typed.ids.flat().indexOf(t0.ids[sr][sc])] === t0.texts[t0.ids.flat().indexOf(t0.ids[sr][sc])],
    JSON.stringify({ cols: [t0.cols, widened.cols], editingNew, newCell, newText: typed.texts[typed.ids.flat().indexOf(newCell)] }),
  )
  // 足した列を戻しておく
  await page.evaluate(() => window.__editor.undo())
  await ready()
  await page.evaluate(() => window.__editor.undo())
  await ready()

  // ---- 4. ページの一覧の赤い点：直すところのエラーのあるページだけ（先生の許可を待つ抄録・まだ書いていない所には付けない） ----
  await page.evaluate(() =>
    window.__editor.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === 'p7' ? { ...b, content: [{ type: 'text', text: '私は二回目の仮縫いで丈を確かめた。' }] } : b)) })) })),
  )
  await ready()
  await wait(800)
  const dots = await page.evaluate(() => {
    const ed = window.__editor
    const kinds = ed.getSnapshot().layout.kinds
    const dotted = [...document.querySelectorAll('.thumbs-col .thumb-list .t')].map((t, i) => (t.classList.contains('has-error') ? i : -1)).filter((i) => i >= 0)
    return { dotted, abstract: kinds.indexOf('abstract'), p7: ed.pageOfBlock('p7') }
  })
  check(
    'パソコン：ページの一覧の赤い点は、直すところのエラー（一人称「私」）のあるページに付き、先生の許可を待つ抄録のページには付かない',
    dots.dotted.includes(dots.p7) && !dots.dotted.includes(dots.abstract),
    JSON.stringify(dots),
  )

  // ---- 5. 抄録を書き始める前の案内：言葉の切れ目でだけ折り返す（「入りませ／ん）。」にならない） ----
  await page.evaluate(() => window.__editor.goToPage(window.__editor.getSnapshot().layout.kinds.indexOf('abstract'), 'none'))
  await ready()
  await wait(300)
  const [title] = await linesIn(page, '.page-viewport.front .abstract-lock b')
  const [note] = await linesIn(page, '.page-viewport.front .abstract-lock span:not(.abstract-start)')
  await page.screenshot({ path: `${OUT}/pc-5-abstract-lock.png` })
  const starts = { title: ['抄録は、', '本文を書き終えて、', '先生のチェックで', '許可が出てから', '書きます。'], note: ['許可が出たら、', '下のボタンを', '押してください', '（それまで、', 'このページは', 'PDFには', '入りません）。'] }
  const onPhrase = (lines, phrases) => lines.every((l) => phrases.some((p) => l.startsWith(p)))
  check(
    'パソコン：抄録を書き始める前の案内は、言葉の切れ目でだけ折り返す（「…入りませ／ん）。」のように言葉の途中で折れない）',
    title?.length >= 1 && note?.length >= 1 && onPhrase(title, starts.title) && onPhrase(note, starts.note),
    JSON.stringify({ title, note }),
  )
  await context.close()
}

// これだけを動かす：node scripts/e2e/trialFixes.mjs
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { withEdge } = await import('../poc/edge.mjs')
  const only = process.argv[2]
  const results = []
  const check = (name, ok, detail = '') => {
    results.push(ok)
    console.log(`${ok ? '✓' : '✗'} ${name}${detail && !ok ? `  (${detail})` : ''}`)
  }
  await withEdge(async (browser) => {
    if (only !== 'phone') await trialFixesPc(browser, check)
  })
  const failed = results.filter((ok) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} 件 合格`)
  process.exitCode = failed ? 1 : 0
}
