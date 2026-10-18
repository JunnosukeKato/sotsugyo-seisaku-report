// 動画 5：PDF を出す（下書き・提出用）（パソコン）
// 下書きを見せるため、見本の原稿の段落の終わりの「。」を消してから録る（エラー1件。「直す」で直せる）
export const meta = {
  number: '5',
  label: 'PDF を出す（下書き・提出用）',
  device: 'pc',
  captions: {
    export: '途中で先生に見せるときも、右下の「PDFを書き出す」を押します',
    draft: 'エラーが残っていても、「下書き」の透かし入りの PDF を保存できます（提出には使えません）',
    draftDone: '保存した PDF を、印刷して先生に見せます',
    fixFirst: '提出用は、エラーを0件にしてから書き出します',
    final: 'もう一度「PDFを書き出す」を押し、3つを確かめてチェックを入れます',
    save: '「PDF を保存する」を押すと、提出用の PDF ができます',
    saved: 'ファイル名には、学籍番号と氏名が入ります。この1ファイルを提出します',
  },
}

const P13 = '最後に全体をアイロンで整え、本番と同じ照明の下で色の見え方を確かめた。袖の刺繍が客席の後ろからも光って見えることを確かめ、完成とした'

export async function prepare({ page, h }) {
  await h.setParagraph(page, 'p13', P13)
  await h.sleep(500)
  await h.ready(page)
  await h.goToBlock(page, 'p13')
}

const exportArea = async (h, page) => h.union(await h.rectOf(page, '.side .export'), await h.rectOf(page, '.side .sec.check'))

export async function run({ page, rec, h }) {
  // 1. 「PDFを書き出す」（エラーがあるとき）
  rec.mark('export', { focus: await exportArea(h, page) })
  await h.sleep(2200)
  await h.clickEl(page, '.side .export', null, { pause: 800 })
  await page.waitForSelector('.modal .draft-box')
  await h.sleep(600)

  // 2. 下書きの PDF
  rec.mark('draft', { focus: await h.rectOf(page, '.modal') })
  await h.sleep(3200)
  await h.clickEl(page, '.modal .pdf-draft', null, { pause: 800 })
  await page.waitForFunction(() => [...document.querySelectorAll('.modal')].some((m) => m.textContent.includes('下書きの PDF を保存しました')), { timeout: 120000 })
  await h.sleep(500)
  rec.mark('draftDone', { focus: await h.rectOf(page, '.modal') })
  await h.sleep(3600)
  await h.clickEl(page, '.modal .close', null, { pause: 600 })
  await h.sleep(600)

  // 3. エラーを直す
  rec.mark('fixFirst', { focus: await exportArea(h, page) })
  await h.sleep(1800)
  await h.clickEl(page, '.side .sec.check .fix', null, { pause: 800 })
  await h.sleep(500)
  await h.ready(page)
  await h.sleep(1500)

  // 4. 提出用：3つを確かめる
  await h.clickEl(page, '.side .export', null, { pause: 700 })
  await page.waitForSelector('.modal .checklist')
  await h.sleep(600)
  rec.mark('final', { focus: await h.rectOf(page, '.modal') })
  await h.sleep(2600)
  const boxes = await page.evaluate(() => [...document.querySelectorAll('.modal .checklist input')].map((i) => { const r = i.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }))
  for (const b of boxes) {
    await h.clickAt(page, b.x, b.y, { pause: 500 })
    await h.sleep(500)
  }

  // 5. 保存する
  rec.mark('save')
  await h.sleep(1500)
  await h.clickEl(page, '.modal .pdf-start', null, { pause: 800 })
  await page.waitForSelector('.modal .pdf-open', { timeout: 120000 })
  await h.sleep(500)
  rec.mark('saved', { focus: await h.rectOf(page, '.modal') })
  await h.sleep(5200)
}
