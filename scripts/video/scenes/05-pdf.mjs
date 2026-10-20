// 動画 5：PDF を書き出す（パソコン）
// 2026-10-20 の画面：「PDFを書き出す」→「PDF を保存する」の1つの道。直すところが残っていれば先に一覧が出る（そのまま書き出すこともできる）。
// 作っている間はできたページが並び、そのあと「保存の画面を開いています…」→「保存しました」。自分のドライブのフォルダにも置いたことを1行で知らせる。
// ファイル名は「学籍番号_氏名.pdf」。
// 見本の原稿の段落の終わりの「。」を消してから録る（直すところ1つ。途中で書き出して先生に見せ、そのあと段落の終わりに「。」を打って直す）
export const meta = {
  number: '5',
  label: 'PDF を書き出す',
  device: 'pc',
  captions: {
    export: '書いた原稿は、右下の「PDFを書き出す」で PDF にします',
    left: '直すところが残っていると、先に一覧が出ます（押すと、その場所へ）',
    anyway: '途中で先生に見せるときは、このまま「PDF を保存する」を押します',
    build: 'PDF を作っている間は、できたページが順に並びます',
    waiting: '保存の画面が開くまで、数秒待ちます',
    savedMid: '保存しました。自分のドライブのフォルダにも置かれます',
    fixFirst: '提出の前に、直すところを0にします。項目を押すと、その場所へ',
    fixType: 'カーソルが段落の終わりに来るので、「。」を打ちます',
    final: 'もう一度「PDFを書き出す」を押して、PDF を保存します',
    saved: 'ファイル名は「学籍番号_氏名.pdf」。この1ファイルを提出します',
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

/** 右の欄の「直すところ」から、下の「PDFを書き出す」まで */
const exportArea = async (h, page) => {
  const fix = await h.rectOf(page, '.side .sec.check .check-sub.fix')
  const foot = await h.rectOf(page, '.side .side-foot')
  return fix ? h.union({ ...fix, y: fix.y - 8 }, foot) : foot
}

/**
 * 窓の上のほう（題名・ファイル名・できたページの1段目）と、下のほう（ひとこと・ドライブの1行・ボタン）。
 * 保存しましたの窓は画面の高さに近いので、窓ごと見せると字幕が題名やドライブの1行に重なる。言いたい所に寄る
 */
const modalTop = async (h, page) => {
  const m = await h.rectOf(page, '.modal')
  return { ...m, h: Math.min(m.h, 300) }
}
const modalBottom = async (h, page) => {
  const m = await h.rectOf(page, '.modal')
  const lead = await h.rectOf(page, '.modal .lead')
  return lead ? { ...m, y: lead.y - 16, h: m.y + m.h - lead.y + 16 } : m
}

/** 窓の題名が text を含むまで待つ */
const waitTitle = (page, text, timeout = 120000) =>
  page.waitForFunction((text) => (document.querySelector('.modal h2, .modal header')?.textContent ?? '').includes(text), { timeout, polling: 100 }, text)

/** 「PDF を保存する」を押してから「保存しました」まで（作る・保存の画面を待つ・保存しました。2回目は字幕を出さず、寄る所だけ変える） */
async function saveFlow(page, rec, h, mid) {
  await h.clickEl(page, '.modal .pdf-start', null, { pause: 700 })
  await waitTitle(page, '作っています')
  await h.sleep(250)
  rec.mark(mid ? 'build' : 'build2', { focus: await modalTop(h, page) })
  await waitTitle(page, '開いています')
  await h.sleep(300)
  rec.mark(mid ? 'waiting' : 'waiting2', { focus: await modalTop(h, page) })
  await waitTitle(page, '保存しました')
  // 自分のドライブに置き終えるまで（「置きました」）
  await page.waitForFunction(() => document.querySelector('.modal .pdf-drive')?.textContent.includes('置きました'), { timeout: 60000, polling: 100 }).catch(() => {})
  await h.sleep(300)
}

export async function run({ page, rec, h }) {
  // 1. 「PDFを書き出す」（直すところが残っているとき）
  rec.mark('export', { focus: await exportArea(h, page) })
  await h.sleep(2200)
  await h.clickEl(page, '.side .export', null, { pause: 700 })
  await page.waitForSelector('.modal .pdf-start')
  await h.sleep(500)

  // 2. 残っているものの一覧
  rec.mark('left', { focus: await h.rectOf(page, '.modal') })
  const link = await h.rectOf(page, '.modal .fix-list li')
  if (link) await h.moveTo(page, link.x + 80, link.y + link.h / 2)
  await h.sleep(3200)

  // 3. このまま書き出す（途中で先生に見せるとき）
  rec.mark('anyway')
  const start = await h.centerOf(page, '.modal .pdf-start')
  await h.moveTo(page, start.x, start.y)
  await h.sleep(1800)
  await saveFlow(page, rec, h, true)
  rec.mark('savedMid', { focus: await modalBottom(h, page) })
  const line = await h.rectOf(page, '.modal .pdf-drive')
  if (line) await h.moveTo(page, line.x + line.w + 20, line.y + line.h / 2)
  await h.sleep(3400)
  await h.clickEl(page, '.modal .row-buttons button', '閉じる', { pause: 500 })

  // 4. 直す（「直す」ボタンはない。項目を押すと、その場所へ移り、段落の終わりにカーソルが来る。自分で「。」を打つ）
  rec.mark('fixFirst', { focus: await exportArea(h, page) })
  await h.sleep(2500)
  await h.clickEl(page, '.side .sec.check .issues li .go', null, { pause: 700 })
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p14', { timeout: 30000 })
  await h.sleep(500)
  await h.ready(page).catch(() => {})
  const p14 = await h.blockRect(page, 'p14')
  rec.mark('fixType', { focus: { ...p14, y: p14.y - 30, h: p14.h + 60 } })
  // カーソルが段落の終わりにあるか（なければ、段落の終わりへ）
  const atEnd = await page.evaluate(() => {
    const s = window.__editor.getSnapshot()
    const b = s.report.body.flatMap((c) => c.blocks).find((x) => x.id === 'p14')
    return s.caret === b.content.map((n) => n.text ?? '').join('').length
  })
  if (!atEnd) {
    console.log('  （カーソルが段落の終わりにないので、Ctrl+End で移す）')
    await page.keyboard.down('Control')
    await page.keyboard.press('End')
    await page.keyboard.up('Control')
  }
  await h.sleep(1600)
  await h.typeSlow(page, '。', 200)
  await h.sleep(1000)
  await page.keyboard.press('Escape')
  await h.ready(page)
  const left = await page.evaluate(() => window.__editor.getSnapshot().findings.filter((f) => f.severity === 'error').length)
  if (left) throw new Error(`エラーが残っています（${left}件）`)
  await h.sleep(900)

  // 5. もう一度書き出す（押す前に「PDFを書き出す」へ寄せておく。段落に寄ったまま窓が開くと、窓が見切れるため）
  rec.mark('final', { focus: await exportArea(h, page) })
  await h.sleep(1500)
  await h.clickEl(page, '.side .export', null, { pause: 600 })
  await page.waitForSelector('.modal .pdf-start')
  await h.sleep(300)
  rec.mark('finalDialog', { focus: await h.rectOf(page, '.modal') })
  await h.sleep(1600)
  await saveFlow(page, rec, h, false)
  rec.mark('saved', { focus: await modalTop(h, page) })
  const file = await h.rectOf(page, '.modal .pdf-file .fn')
  if (file) await h.moveTo(page, file.x + file.w + 16, file.y + file.h / 2)
  await h.sleep(4200)
}
