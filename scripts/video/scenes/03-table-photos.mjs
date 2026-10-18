// 動画 3：表・作品写真（パソコン）
import { resolve } from 'node:path'

export const meta = {
  number: '3',
  label: '表・作品写真',
  device: 'pc',
  captions: {
    table: '表は、入れたい文で「表を入れる」を押します',
    kind: '表の種類を選びます（素材表のひな形もあります）',
    tcaption: '表の上のタイトルを打ちます。「表2.」の番号と、本文の「（表2）」は自動です',
    cell: 'マスをクリックして、中身を書きます',
    row: '行や列は、左の「行を足す」「列を足す」で増やせます',
    photos: '作品写真のページでは、左で写真の並べ方を選びます',
    photoAdd: '空いている枠をクリックして、写真を選びます',
    fit: '写真が枠で切れるときは、「全体を入れる（切らない）」を押します',
    end: '作品写真は、6枚まで入れられます',
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

export async function run({ page, rec, h }) {
  // 1. 段落の終わりをクリックして「表を入れる」
  const p12 = await h.blockRect(page, 'p12')
  const btn = await h.centerOf(page, '.palette .tb', '表を入れる')
  rec.mark('table', { focus: h.union(p12, { x: btn.x - btn.w / 2, y: btn.y - btn.h / 2, w: btn.w, h: btn.h }) })
  const end = await h.endOfBlock(page, 'p12')
  await h.clickAt(page, end.x, end.y, { pause: 1200 })
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p12', { timeout: 30000 })
  await page.keyboard.press('End')
  await h.sleep(800)
  await h.clickAt(page, btn.x, btn.y, { pause: 900 })
  await page.waitForSelector('.palette .side-menu')
  await h.sleep(400)

  // 2. 表の種類
  rec.mark('kind', { focus: await h.rectOf(page, '.palette .side-menu') })
  await h.sleep(2600)
  await h.clickEl(page, '.palette .side-menu button', '空の表', { pause: 700 })
  await page.waitForFunction(() => window.__editor.getSnapshot().editingKind === 'tableCaption', { timeout: 30000 })
  // 表が入って紙面を組み直し終えてから、位置を測る
  await h.sleep(600)
  await h.ready(page)
  await h.sleep(600)

  // 3. 表のタイトル
  let table = await tableNow(page)
  const tableRect = async () => h.union(await h.blockRect(page, 'p12'), await h.blockRect(page, table.id))
  rec.mark('tcaption', { focus: await tableRect() })
  await h.sleep(1600)
  await h.typeSlow(page, '帯とズボンの寸法')
  await h.sleep(1600)
  await page.keyboard.press('Escape')
  await h.ready(page)
  await h.sleep(500)

  // 4. マスに書く（見出しの行と、1行目）
  table = await tableNow(page)
  rec.mark('cell', { focus: await tableRect() })
  await h.sleep(1200)
  const write = async (cell, text) => {
    const c = await cellCenter(page, cell.id)
    await h.clickAt(page, c.x, c.y, { pause: 450 })
    await h.sleep(400)
    await h.typeSlow(page, text)
    await h.sleep(300)
  }
  await write(table.rows[0].cells[0], '箇所')
  await write(table.rows[0].cells[1], '寸法')
  await write(table.rows[1].cells[0], '帯の幅')
  await write(table.rows[1].cells[1], '15cm')
  await h.sleep(600)

  // 5. 行を足す
  const rowBtn = await h.centerOf(page, '.palette .tb', '行を足す')
  rec.mark('row', { focus: h.union({ x: rowBtn.x - rowBtn.w / 2, y: rowBtn.y - rowBtn.h / 2, w: rowBtn.w, h: rowBtn.h }, await h.blockRect(page, table.id)) })
  await h.sleep(1200)
  await h.clickAt(page, rowBtn.x, rowBtn.y, { pause: 800 })
  await page.waitForFunction((id, n) => window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === id).rows.length > n, { timeout: 30000 }, table.id, table.rows.length)
  await h.sleep(400)
  await h.ready(page).catch(() => {})
  await h.sleep(500)
  await h.typeSlow(page, 'ズボンの丈')
  table = await tableNow(page)
  await write(table.rows.at(-1).cells[1], '98cm')
  await h.sleep(1200)
  await page.keyboard.press('Escape')
  await h.ready(page)
  await h.sleep(800)

  // 6. 作品写真のページ：並べ方を選ぶ
  await page.evaluate(() => window.__editor.goToArea('photos'))
  await h.sleep(500)
  await h.ready(page)
  rec.mark('photos', { focus: h.union(await h.rectOf(page, '.palette .layouts'), await h.rectOf(page, CUR)) })
  await h.sleep(2200)
  const lay = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.palette .lay')].find((x) => x.title.startsWith('2枚（左右'))
    const r = b.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await h.clickAt(page, lay.x, lay.y, { pause: 800 })
  await h.sleep(400)
  await h.ready(page)
  await h.sleep(800)

  // 7. 空いている枠に写真を入れる
  const slot = await h.rectOf(page, `${CUR} [data-photo-slot="1"]`)
  rec.mark('photoAdd', { focus: await h.rectOf(page, CUR) })
  const sc = { x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 }
  await h.moveTo(page, sc.x, sc.y)
  await h.sleep(2200)
  h.logClick(page, sc.x, sc.y)
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.mouse.click(sc.x, sc.y)])
  await h.sleep(900)
  await chooser.accept([resolve('docs/guide-images/sample/process.jpg')])
  await page.waitForFunction(() => !!window.__editor.getSnapshot().report.workPhotos.imageIds[1], { timeout: 30000 })
  await h.ready(page)
  await h.sleep(1200)

  // 8. 全体を入れる（切らない）
  if (!(await h.rectOf(page, '.palette .photo-sw'))) {
    await h.clickAt(page, sc.x, sc.y, { pause: 500 })
    await page.waitForSelector('.palette .photo-sw', { timeout: 10000 })
  }
  const sw = await h.rectOf(page, '.palette .photo-sw')
  rec.mark('fit', { focus: h.union(sw, await h.rectOf(page, CUR)) })
  await h.sleep(2200)
  await h.clickAt(page, sw.x + sw.w / 2, sw.y + sw.h / 2, { pause: 800 })
  await h.ready(page)
  await h.sleep(2600)
  rec.mark('end', { focus: await h.rectOf(page, CUR) })
  await h.sleep(2400)
}
