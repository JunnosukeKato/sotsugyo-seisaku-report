// 動画 5：PDF を出す（下書き・提出用）（パソコン）
// 下書きを見せるため、見本の原稿の段落の終わりの「。」を消してから録る（エラー1件。段落の終わりに「。」を打って直す）
export const meta = {
  number: '5',
  label: 'PDF を出す（下書き・提出用）',
  device: 'pc',
  captions: {
    export: '途中で先生に見せるときも、右下の「PDFを書き出す」を押します',
    draft: 'エラーが残っていても、「下書き」の透かし入りの PDF を保存できます（提出には使えません）',
    draftDone: '保存した PDF を、印刷して先生に見せます',
    fixFirst: '提出用は、エラーを0件にしてから書き出します',
    fixType: '項目を押してその場所へ移り、段落の終わりに「。」を打ちます',
    final: 'もう一度「PDFを書き出す」を押し、3つを確かめてチェックを入れます',
    save: '「PDF を保存する」を押すと、提出用の PDF ができます',
    saved: 'ファイル名には、学籍番号と氏名が入ります。この1ファイルを提出します',
  },
}

// 「まとめ」の最初の段落（1ページに収まる短い段落。ページをまたぐと、直す場所が動画で分かりにくい）
const P14 = '本制作では、主人公の成長を一着の衣装で表すことを目標とした。袖の大きな膨らみと金の刺繍によって、旅立ちの若々しさと帰還の頼もしさの両方を表すことができた'

export async function prepare({ page, h }) {
  await h.setParagraph(page, 'p14', P14)
  await h.sleep(500)
  await h.ready(page)
  await h.goToBlock(page, 'p14')
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

  // 3. エラーを直す（「直す」ボタンはない。項目を押してその場所へ移り、自分で「。」を打つ）
  rec.mark('fixFirst', { focus: await exportArea(h, page) })
  await h.sleep(2200)
  await h.clickEl(page, '.side .sec.check li .go', null, { pause: 800 })
  await h.sleep(600)
  await h.ready(page)
  const p14 = await h.blockRect(page, 'p14')
  rec.mark('fixType', { focus: { ...p14, y: p14.y - 30, h: p14.h + 60 } })
  await h.sleep(1500)
  const end = await h.endOfBlock(page, 'p14')
  await h.clickAt(page, end.x + 2, end.y, { pause: 700 })
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p14', { timeout: 30000 })
  // 段落全体の終わりへ（End だけだと、その行の終わりになる）
  await page.keyboard.down('Control')
  await page.keyboard.press('End')
  await page.keyboard.up('Control')
  await h.sleep(600)
  await h.typeSlow(page, '。', 200)
  await h.sleep(900)
  await page.keyboard.press('Escape')
  await h.ready(page)
  const left = await page.evaluate(() => window.__editor.getSnapshot().findings.filter((f) => f.severity === 'error').length)
  if (left) throw new Error(`エラーが残っています（${left}件）`)
  await h.sleep(1200)

  // 4. 提出用：3つを確かめる（押す前に「PDFを書き出す」へ寄せておく。段落に寄ったまま窓が開くと、窓が見切れるため）
  rec.mark('final', { focus: await exportArea(h, page) })
  await h.sleep(1600)
  await h.clickEl(page, '.side .export', null, { pause: 700 })
  await page.waitForSelector('.modal .checklist')
  await h.sleep(400)
  rec.mark('finalDialog', { focus: await h.rectOf(page, '.modal') })
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
