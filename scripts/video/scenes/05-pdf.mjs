// 動画 5：PDF を書き出す（パソコン）
// 「下書きの PDF」と提出前の3つのチェックは、依頼者の判断でなくした（2026-10-19）。直すところが残っていても、一覧を見たうえで書き出せる。
// 見本の原稿の段落の終わりの「。」を消してから録る（直すところ1つ。途中で書き出して先生に見せ、そのあと段落の終わりに「。」を打って直す）
export const meta = {
  number: '5',
  label: 'PDF を書き出す',
  device: 'pc',
  captions: {
    export: '書いた原稿は、右下の「PDFを書き出す」で PDF にします',
    left: '直すところ・まだのところが残っていると、ここに出ます（押すとその場所へ移ります）',
    anyway: '途中で先生に見せるときは、このまま「PDF を保存する」を押します',
    savedMid: 'できた PDF を印刷して、先生に見せます',
    fixFirst: '提出の前に、直すところを0にします',
    fixType: '項目を押してその場所へ移り、段落の終わりに「。」を打ちます',
    final: 'もう一度「PDFを書き出す」を押して、PDF を保存します',
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

/** PDF ができるのを待つ（できたページが並ぶ窓） */
const waitSaved = (page) => page.waitForSelector('.modal .pdf-open', { timeout: 120000 })

export async function run({ page, rec, h }) {
  // 1. 「PDFを書き出す」（直すところが残っているとき）
  rec.mark('export', { focus: await exportArea(h, page) })
  await h.sleep(2400)
  await h.clickEl(page, '.side .export', null, { pause: 800 })
  await page.waitForSelector('.modal .pdf-start')
  await h.sleep(600)

  // 2. 残っているものの一覧
  rec.mark('left', { focus: await h.rectOf(page, '.modal') })
  await h.sleep(3800)

  // 3. このまま書き出す（途中で先生に見せるとき）
  rec.mark('anyway')
  await h.sleep(1800)
  await h.clickEl(page, '.modal .pdf-start', null, { pause: 800 })
  await waitSaved(page)
  await h.sleep(500)
  rec.mark('savedMid', { focus: await h.rectOf(page, '.modal') })
  await h.sleep(3400)
  await h.clickEl(page, '.modal .close', null, { pause: 600 })
  await h.sleep(600)

  // 4. 直す（「直す」ボタンはない。項目を押してその場所へ移り、自分で「。」を打つ）
  rec.mark('fixFirst', { focus: await exportArea(h, page) })
  await h.sleep(2200)
  await h.clickEl(page, '.side .sec.check .issues li .go', null, { pause: 800 })
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

  // 5. もう一度書き出す（押す前に「PDFを書き出す」へ寄せておく。段落に寄ったまま窓が開くと、窓が見切れるため）
  rec.mark('final', { focus: await exportArea(h, page) })
  await h.sleep(1600)
  await h.clickEl(page, '.side .export', null, { pause: 700 })
  await page.waitForSelector('.modal .pdf-start')
  await h.sleep(400)
  rec.mark('finalDialog', { focus: await h.rectOf(page, '.modal') })
  await h.sleep(2200)
  await h.clickEl(page, '.modal .pdf-start', null, { pause: 800 })
  await waitSaved(page)
  await h.sleep(500)
  rec.mark('saved', { focus: await h.rectOf(page, '.modal') })
  await h.sleep(5200)
}
