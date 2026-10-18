// 動画 6：スマホで書く（スマホ：390×844。動画では縦長の画面を左に置き、右に字幕を出す）
import { resolve } from 'node:path'

export const meta = {
  number: '6',
  label: 'スマホで書く',
  device: 'phone',
  captions: {
    tap: 'スマホでは、書きたい所をタップすると、下に書く欄が出ます',
    type: '文を打ったら、「完了」を押します',
    figure: '図は、書く欄の「図を入れる」から入れます',
    caption: '図の下のタイトルを打ちます。番号は自動で付きます',
    swipe: 'ページは、左右に指でなぞって移ります',
    check: '直すところは、下の「チェック」で見られます',
    end: 'PDF も、下の「PDF」から書き出せます',
  },
}

export async function prepare({ page, h }) {
  await h.goToBlock(page, 'p7')
}

const tapEl = async (h, page, selector, text) => {
  const c = await h.centerOf(page, selector, text)
  await h.tapAt(page, c.x, c.y)
  return c
}

export async function run({ page, rec, h }) {
  // 1. 段落をタップ
  rec.mark('tap')
  await h.sleep(2600)
  const p7 = await h.blockRect(page, 'p7')
  await h.tapAt(page, p7.x + p7.w - 30, p7.y + p7.h - 6)
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p7', { timeout: 30000 })
  await h.sleep(1600)

  // 2. 打って「完了」
  rec.mark('type')
  await page.keyboard.press('End')
  await h.sleep(800)
  await h.typeSlow(page, '客席からも袖の動きが大きく見えた。')
  await h.sleep(1500)
  await tapEl(h, page, '.edit-sheet .done')
  await h.ready(page)
  await h.sleep(1500)

  // 3. 図を入れる
  rec.mark('figure')
  await h.sleep(1600)
  const p7b = await h.blockRect(page, 'p7')
  await h.tapAt(page, p7b.x + p7b.w - 30, p7b.y + p7b.h - 6)
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p7', { timeout: 30000 })
  await page.keyboard.press('End')
  await h.sleep(1600)
  const fig = await h.centerOf(page, '.edit-sheet .es-tools button', '図を入れる')
  const [chooser] = await Promise.all([page.waitForFileChooser(), h.tapAt(page, fig.x, fig.y)])
  await h.sleep(900)
  await chooser.accept([resolve('docs/guide-images/sample/photo-1.jpg')])
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId?.startsWith('f-'), { timeout: 30000 })
  await h.ready(page).catch(() => {})
  await h.sleep(800)
  rec.mark('caption')
  await h.sleep(1200)
  await h.typeSlow(page, '二回目の仮縫い')
  await h.sleep(1500)
  await tapEl(h, page, '.edit-sheet .done')
  await h.ready(page)
  await h.sleep(2200)

  // 4. ページを指でなぞる
  rec.mark('swipe')
  await h.sleep(1500)
  await h.swipe(page, { x: 320, y: 430 }, { x: 70, y: 440 })
  await h.sleep(400)
  await h.ready(page)
  await h.sleep(1800)
  await h.swipe(page, { x: 70, y: 430 }, { x: 320, y: 440 })
  await h.sleep(400)
  await h.ready(page)
  await h.sleep(1200)

  // 5. チェック
  rec.mark('check')
  await h.sleep(1200)
  await tapEl(h, page, '.p-nav .nav-check')
  await page.waitForSelector('.sheet')
  await h.sleep(3600)
  await tapEl(h, page, '.sheet .sheet-close')
  await h.sleep(800)

  // 6. PDF
  rec.mark('end')
  await h.sleep(1200)
  const pdf = await h.rectOf(page, '.p-nav .nav-pdf')
  if (pdf) await h.tapAt(page, pdf.x + pdf.w / 2, pdf.y + pdf.h / 2)
  await h.sleep(3000)
}
