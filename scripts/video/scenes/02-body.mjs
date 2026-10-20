// 動画 2：本文を書く・図を入れる（パソコン）
// 後半で、行の頭に「Ⅲ．まとめ」と打って Enter を押すと大見出しになる（手で打った見出しを見分ける。2026-10-20 の画面）ことを見せる。
// そのため、録る前に見本の原稿から「Ⅲ．まとめ」の章を外しておく（Ⅱ．制作過程を書き終えたところから、次の章を書き始める）
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
    next: '次のページへは、紙面の右の「＞」を押します',
    heading: '次の章は、行の頭に「Ⅲ．まとめ」のように打って Enter を押します',
    headingDone: '大見出しになりました。章は、新しいページから始まります',
    undo: '見出しにしないときは、下の「戻す」を押します',
    write: '続けて、その章の文を書きます',
    end: '書いた内容は、自動で保存されます（右上の「ドライブに保存」）',
  },
}

const CUR = '.page-viewport.front [data-vivliostyle-page-container].is-current'

export async function prepare({ page, h }) {
  // 「Ⅲ．まとめ」の章（c3）を外す
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, body: r.body.filter((c) => c.id !== 'c3') })))
  await h.sleep(500)
  await h.ready(page)
  await h.goToBlock(page, 'p7')
}

export async function run({ page, rec, h }) {
  // 1. 紙面の書きたい所（段落の終わり）をクリック
  const p7 = await h.blockRect(page, 'p7')
  const end = await h.endOfBlock(page, 'p7')
  rec.mark('click', { focus: { ...p7, h: p7.h + 230 } })
  await h.moveTo(page, end.x, end.y)
  await h.sleep(2400)
  h.logClick(page, end.x, end.y)
  await page.mouse.click(end.x, end.y)
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p7', { timeout: 30000 })
  await h.sleep(1200)

  // 2. 文を打つ
  rec.mark('type')
  await h.sleep(1000)
  await h.typeSlow(page, '客席の後ろからも、袖の動きが大きく見えることが分かった。')
  await h.sleep(1500)

  // 3. 「図を入れる」→ 画像を選ぶ
  const btn = await h.centerOf(page, '.palette .tb', '図を入れる')
  rec.mark('figure', { focus: h.union({ x: btn.x - btn.w / 2, y: btn.y - btn.h / 2, w: btn.w, h: btn.h }, await h.blockRect(page, 'p7')) })
  await h.moveTo(page, btn.x, btn.y)
  await h.sleep(2200)
  await h.chooseFile(page, btn.x, btn.y, [resolve('docs/guide-images/sample/photo-1.jpg')])
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId?.startsWith('f-'), { timeout: 30000 })
  await h.ready(page).catch(() => {})
  const cap = await h.rectOf(page, `${CUR} figure[data-figure-id] figcaption`)
  const fig = await h.rectOf(page, `${CUR} figure[data-figure-id]`)
  if (cap) await h.moveTo(page, cap.x + cap.w + 30, cap.y + cap.h + 16)
  await h.sleep(800)

  // 4. 図のタイトルを打つ（番号は自動）
  rec.mark('caption', { focus: h.union(fig, await h.blockRect(page, 'p7')) })
  await h.sleep(1300)
  await h.typeSlow(page, '二回目の仮縫い')
  await h.sleep(2200)

  // 5. 書き終える：本文の（図3）と、後ろの図の番号
  await page.keyboard.press('Escape')
  await h.ready(page)
  const after = h.union(await h.blockRect(page, 'p7'), await h.blockRect(page, 'p8'))
  rec.mark('done', { focus: after })
  await h.sleep(500)
  const p7b = await h.blockRect(page, 'p7')
  await h.moveTo(page, p7b.x + p7b.w - 40, p7b.y + p7b.h - 6)
  await h.sleep(4200)

  // 6. 次のページ（Ⅱ．制作過程の最後の段落）へ
  rec.mark('next', { full: true })
  for (let i = 0; i < 3 && !(await h.blockRect(page, 'p13')); i++) {
    await h.clickEl(page, '.stage .arrow.next', null, { pause: 400 })
    await h.sleep(300)
    await h.ready(page)
    await h.sleep(300)
  }

  // 7. 段落の終わりで Enter → 「Ⅲ．まとめ」と打って Enter（大見出しになる）
  const p13 = await h.blockRect(page, 'p13')
  rec.mark('heading', { focus: { ...p13, y: p13.y - 20, h: p13.h + 170 } })
  const e13 = await h.endOfBlock(page, 'p13')
  await h.clickAt(page, e13.x, e13.y, { pause: 700 })
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p13', { timeout: 30000 })
  await h.sleep(700)
  await page.keyboard.press('Enter')
  await h.sleep(700)
  await h.typeSlow(page, 'Ⅲ．まとめ', 180)
  await h.sleep(900)
  await page.keyboard.press('Enter')
  await page.waitForSelector('.undo-area .undo-toast', { timeout: 30000 })
  await h.sleep(300)
  await h.ready(page).catch(() => {})
  await h.sleep(300)
  // 大見出しは新しいページの上に来る（見出しと、続けて書く段落のあたりに寄る）
  const chapter = await page.evaluate(() => window.__editor.getSnapshot().report.body.at(-1).id)
  const head = await h.blockRect(page, chapter)
  const body = await h.blockRect(page, 'p13')
  const top = { x: body?.x ?? head.x - 40, y: head.y - 40, w: body?.w ?? 470, h: 160 }
  rec.mark('headingDone', { focus: top })
  await h.moveTo(page, head.x + head.w + 60, head.y + 40)
  await h.sleep(3000)
  // 画面の下の知らせ「大見出し「Ⅲ．まとめ」にしました［戻す］」（押さない。打ち始めると消える）
  const toast = await h.rectOf(page, '.undo-area .undo-toast')
  if (toast) {
    rec.mark('undo', { focus: { x: toast.x - 30, y: toast.y - 50, w: toast.w + 60, h: toast.h + 70 } })
    const back = (await h.rectOf(page, '.undo-area .undo-toast button')) ?? toast
    await h.moveTo(page, back.x + back.w / 2, back.y + back.h / 2)
    await h.sleep(2800)
  }
  // 新しい章の最初の段落を書き始める
  rec.mark('write', { focus: top })
  await h.moveTo(page, head.x + head.w + 60, head.y + 70)
  await h.sleep(500)
  await h.typeSlow(page, '本制作では、主人公の成長を一着の衣装で表すことを目標とした。')
  await h.sleep(1200)
  await page.keyboard.press('Escape')
  await h.ready(page)
  await h.sleep(400)

  // 8. 自動で保存（右上）
  const chip = await h.rectOf(page, '.side .chip')
  rec.mark('end', { focus: chip ? { x: chip.x - 60, y: chip.y - 40, w: 420, h: 160 } : undefined, full: !chip })
  await h.sleep(2600)
}
