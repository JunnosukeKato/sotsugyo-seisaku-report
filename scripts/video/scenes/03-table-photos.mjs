// 動画 3：表・作品写真（パソコン）
// 2026-10-21 の画面：表の大きさはマス目で選ぶ・マスの中は Enter で改行・「表の形を整える」の窓で列の幅（そろえる・字の多い列を広く・自分で決める）、
// 作品写真は、つかんでずらしてトリミング・「写真のページを足す」（1ページに4枚まで）
import { resolve } from 'node:path'

export const meta = {
  number: '3',
  label: '表・作品写真',
  device: 'pc',
  captions: {
    table: '表は、入れたい文で「表を入れる」を押します',
    kind: 'マス目で表の大きさを選びます（1行目は見出し）',
    tcaption: '表の上のタイトルを打ちます。番号と、本文の「（表2）」は自動です',
    cell: 'マスをクリックして、中身を書きます',
    newline: 'マスの中で Enter を押すと、改行できます',
    widths: '列の幅などは、左の道具の「表の形を整える」で変えます',
    shapePanel: '絵を見て選ぶと、すぐ表が変わります',
    photos: '作品写真のページでは、左の「並べ方」で写真の数を選びます',
    photoAdd: '空いている枠をクリックして、写真を選びます',
    trim: '写真をつかんでずらすと、写る所（トリミング）を変えられます',
    pageAdd: '写真は1ページに4枚まで。多いときは「写真のページを足す」を押します',
    end: '作品写真のページが増えました。枠をクリックして写真を入れます',
  },
}

const CUR = '.page-viewport.front [data-vivliostyle-page-container].is-current'

export async function prepare({ page, h }) {
  await h.goToBlock(page, 'p12')
}

/** 書いている表（いちばん新しい表）と、そのマスの位置 */
const tableNow = (page) =>
  page.evaluate(() => {
    const blocks = window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks)
    return blocks.filter((b) => b.type === 'table').at(-1)
  })
const cellCenter = (page, id) =>
  page.evaluate((id) => {
    const el = [...document.querySelectorAll(`.page-viewport.front [data-cell-id="${id}"]`)].find((e) => e.getBoundingClientRect().width > 0)
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }
  }, id)
const box = (c) => ({ x: c.x - c.w / 2, y: c.y - c.h / 2, w: c.w, h: c.h })

export async function run({ page, rec, h }) {
  // 1. 段落の終わりをクリックして「表を入れる」
  const p12 = await h.blockRect(page, 'p12')
  const btn = await h.centerOf(page, '.palette .tb', '表を入れる')
  rec.mark('table', { focus: h.union(p12, box(btn)) })
  const end = await h.endOfBlock(page, 'p12')
  await h.clickAt(page, end.x, end.y, { pause: 1000 })
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p12', { timeout: 30000 })
  await h.sleep(600)
  await h.clickAt(page, btn.x, btn.y, { pause: 800 })
  await page.waitForSelector('.palette .tgrid')
  await h.sleep(300)

  // 2. 表の大きさ：マス目の上で矢印を動かし、2列×3行を選ぶ（マス目は 6列×10行。左上から行ごとに並ぶ）
  rec.mark('kind', { focus: await h.rectOf(page, '.palette .table-menu') })
  await h.sleep(1500)
  const cellAt = (index) =>
    page.evaluate((index) => {
      const r = document.querySelectorAll('.palette .tgrid button')[index].getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }, index)
  for (const index of [0, 7, 13]) {
    const c = await cellAt(index)
    await h.moveTo(page, c.x, c.y)
    await h.sleep(500)
  }
  await h.sleep(600)
  const pick = await cellAt(13)
  await h.clickAt(page, pick.x, pick.y, { pause: 250 })
  await page.waitForFunction(() => window.__editor.getSnapshot().editingKind === 'tableCaption', { timeout: 30000 })
  // 表が入って紙面を組み直し終えてから、位置を測る
  await h.sleep(500)
  await h.ready(page)
  await h.sleep(400)

  // 3. 表のタイトル
  let table = await tableNow(page)
  const tableRect = async () => h.union(await h.blockRect(page, 'p12'), await h.blockRect(page, table.id))
  rec.mark('tcaption', { focus: await tableRect() })
  await h.sleep(1100)
  await h.typeSlow(page, '帯とズボンの寸法')
  await h.sleep(1000)
  await page.keyboard.press('Escape')
  await h.ready(page)
  await h.sleep(400)

  // 4. マスに書く（見出しの行と、2行）。最後のマスは Enter で改行して2行に
  table = await tableNow(page)
  const tableOnly = async () => {
    const r = await h.blockRect(page, table.id)
    return { ...r, y: r.y - 20, h: r.h + 70 }
  }
  rec.mark('cell', { focus: await tableOnly() })
  await h.sleep(900)
  const write = async (cell, text) => {
    const c = await cellCenter(page, cell.id)
    await h.clickAt(page, c.x, c.y, { pause: 250 })
    await h.sleep(200)
    await h.typeSlow(page, text, 80)
    await h.sleep(150)
  }
  await write(table.rows[0].cells[0], '箇所')
  await write(table.rows[0].cells[1], '寸法')
  await write(table.rows[1].cells[0], '帯の幅')
  await write(table.rows[1].cells[1], '15cm')
  await write(table.rows[2].cells[0], 'ズボンの丈')
  await write(table.rows[2].cells[1], '98cm')
  await h.sleep(300)
  rec.mark('newline', { focus: await tableOnly() })
  await h.sleep(1200)
  await page.keyboard.press('Enter')
  await h.sleep(500)
  await h.typeSlow(page, '（裾のゴムを含む）', 85)
  await h.sleep(1200)

  // 5. 列の幅：左の道具の「表の形を整える」を押すと、絵の付いた窓が出る（mockups/v45 案A）。「字の多い列を広く」を押し、表に寄って結果を見せる
  const shapeBtn = await h.centerOf(page, '.palette .shape-btn', '表の形')
  rec.mark('widths', { focus: await h.rectOf(page, '.palette .shape-btn') })
  await h.moveTo(page, shapeBtn.x, shapeBtn.y)
  await h.sleep(1200)
  await h.clickAt(page, shapeBtn.x, shapeBtn.y, { pause: 300 })
  await page.waitForSelector('.shape-panel .so-choice[data-value="auto"]')
  await h.sleep(500)
  rec.mark('shapePanel', { focus: h.union(await h.rectOf(page, '.shape-panel'), await h.rectOf(page, '.palette .shape-btn')) })
  const fit = await h.centerOf(page, '.shape-panel .so-choice[data-value="auto"]')
  await h.moveTo(page, fit.x, fit.y)
  await h.sleep(1500)
  await h.clickAt(page, fit.x, fit.y, { pause: 300 })
  await h.sleep(400)
  await h.ready(page).catch(() => {})
  rec.mark('widthsDone', { focus: await tableOnly() })
  await h.sleep(2000)
  // 窓を閉じる（Esc は窓だけを閉じる）・書いているマスも閉じる
  await page.keyboard.press('Escape')
  await h.sleep(300)
  await page.keyboard.press('Escape')
  await h.ready(page)
  await h.sleep(500)

  // 6. 作品写真のページ（左のページの一覧の、いちばん下）：並べ方を選ぶ
  const thumb = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.thumbs-col .t')].at(-1)
    b.scrollIntoView({ block: 'nearest' })
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await h.sleep(300)
  await h.clickAt(page, thumb.x, thumb.y, { pause: 500 })
  await h.sleep(400)
  await h.ready(page)
  await h.sleep(300)
  rec.mark('photos', { focus: h.union(await h.rectOf(page, '.palette .photo-arrange'), await h.rectOf(page, CUR)) })
  await h.sleep(1500)
  const lay = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.palette .lay')].find((x) => x.title.startsWith('2枚（左右'))
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await h.clickAt(page, lay.x, lay.y, { pause: 600 })
  await h.sleep(400)
  await h.ready(page)
  await h.sleep(600)

  // 7. 空いている枠に写真を入れる
  const slot = await h.rectOf(page, `${CUR} [data-photo-slot="1"]`)
  rec.mark('photoAdd', { focus: await h.rectOf(page, CUR) })
  const sc = { x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 }
  await h.moveTo(page, sc.x, sc.y)
  await h.sleep(1800)
  await h.chooseFile(page, sc.x, sc.y, [resolve('docs/guide-images/sample/process.jpg')])
  await page.waitForFunction(() => !!window.__editor.getSnapshot().report.workPhotos[0].imageIds[1], { timeout: 30000 })
  await h.ready(page)
  await h.sleep(1000)

  // 8. トリミング：1枚目の写真をつかんで、右へずらす
  const s0 = await h.rectOf(page, `${CUR} [data-photo-slot="0"]`)
  rec.mark('trim', { focus: await h.rectOf(page, CUR) })
  const from = { x: s0.x + s0.w * 0.45, y: s0.y + s0.h * 0.45 }
  await h.moveTo(page, from.x, from.y)
  await h.sleep(1300)
  await h.dragTo(page, from, { x: from.x + 130, y: from.y }, 1100)
  await h.sleep(500)
  await h.ready(page).catch(() => {})
  await h.sleep(1600)

  // 9. 写真のページを足す
  const add = await h.centerOf(page, '.palette .photo-pages .tb', 'ページを足す')
  rec.mark('pageAdd', { focus: h.union(await h.rectOf(page, '.palette .photo-pages'), await h.rectOf(page, CUR)) })
  await h.moveTo(page, add.x, add.y)
  await h.sleep(1800)
  await h.clickAt(page, add.x, add.y, { pause: 300 })
  await page.waitForFunction(() => window.__editor.getSnapshot().report.workPhotos.length === 2, { timeout: 30000 })
  await h.sleep(400)
  await h.ready(page)
  await h.sleep(400)
  rec.mark('end', { focus: h.union(await h.rectOf(page, '.palette'), await h.rectOf(page, CUR)) })
  await h.sleep(3000)
}
