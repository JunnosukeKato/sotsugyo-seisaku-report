// 動画 2：本文を書く・図を入れる（パソコン）
import { resolve } from 'node:path'

export const meta = {
  number: '2',
  label: '本文を書く・図を入れる',
  device: 'pc',
  captions: {
    click: '本文は、紙面の書きたい所をクリックすると、その場で書けます',
    type: '文は、紙面の上でそのまま打ちます',
    figure: '図を入れたい文で「図を入れる」を押し、画像を選びます',
    caption: '図の下のタイトルを打ちます。「図3.」の番号は自動で付きます',
    done: '本文の「（図3）」も自動で入り、後ろの図は「図4」に変わります',
    end: '書いた内容は、自動で保存されます（右上の「ドライブに保存」）',
  },
}

export async function prepare({ page, h }) {
  await h.goToBlock(page, 'p7')
}

export async function run({ page, rec, h }) {
  // 1. 紙面の書きたい所（段落の終わり）をクリック
  const p7 = await h.blockRect(page, 'p7')
  const end = await h.endOfBlock(page, 'p7')
  rec.mark('click', { focus: { ...p7, h: p7.h + 230 } })
  await h.moveTo(page, end.x, end.y)
  await h.sleep(2600)
  h.logClick(page, end.x, end.y)
  await page.mouse.click(end.x, end.y)
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p7', { timeout: 30000 })
  await page.keyboard.press('End')
  await h.sleep(1500)

  // 2. 文を打つ
  rec.mark('type')
  await h.sleep(1200)
  await h.typeSlow(page, '客席の後ろからも、袖の動きが大きく見えることが分かった。')
  await h.sleep(1800)

  // 3. 「図を入れる」→ 画像を選ぶ
  const btn = await h.centerOf(page, '.palette .tb', '図を入れる')
  rec.mark('figure', { focus: h.union({ x: btn.x - btn.w / 2, y: btn.y - btn.h / 2, w: btn.w, h: btn.h }, await h.blockRect(page, 'p7')) })
  await h.moveTo(page, btn.x, btn.y)
  await h.sleep(2400)
  h.logClick(page, btn.x, btn.y)
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.mouse.click(btn.x, btn.y)])
  await h.sleep(900)
  await chooser.accept([resolve('docs/guide-images/sample/photo-1.jpg')])
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId?.startsWith('f-'), { timeout: 30000 })
  await h.ready(page).catch(() => {})
  const cap = await h.rectOf(page, '.page-viewport.front [data-vivliostyle-page-container].is-current figure[data-figure-id] figcaption')
  const fig = await h.rectOf(page, '.page-viewport.front [data-vivliostyle-page-container].is-current figure[data-figure-id]')
  if (cap) await h.moveTo(page, cap.x + cap.w + 30, cap.y + cap.h + 16)
  await h.sleep(900)

  // 4. 図のタイトルを打つ（番号は自動）
  rec.mark('caption', { focus: h.union(fig, await h.blockRect(page, 'p7')) })
  await h.sleep(1500)
  await h.typeSlow(page, '二回目の仮縫い')
  await h.sleep(2500)

  // 5. 書き終える：本文の（図3）と、後ろの図の番号
  await page.keyboard.press('Escape')
  await h.ready(page)
  const after = h.union(await h.blockRect(page, 'p7'), await h.blockRect(page, 'p8'))
  rec.mark('done', { focus: after })
  await h.sleep(600)
  const p7b = await h.blockRect(page, 'p7')
  await h.moveTo(page, p7b.x + p7b.w - 40, p7b.y + p7b.h - 6)
  await h.sleep(5200)

  // 6. 自動で保存（右上）
  const chip = await h.rectOf(page, '.side .chip')
  rec.mark('end', { focus: chip ? { x: chip.x - 60, y: chip.y - 40, w: 420, h: 160 } : undefined, full: !chip })
  await h.sleep(2500)
}
