// 動画 4：セルフチェックで直す（パソコン）
// 見本の原稿に、わざと誤り（「見頃」「記事」「です」）を入れてから録る（使い方の画面の写真と同じ文）。
// 学生は「直す」ボタンを使わず、項目を押してその場所へ移り、自分で書き直す（依頼者の判断。2026-10-19）
export const meta = {
  number: '4',
  label: 'セルフチェックで直す',
  device: 'pc',
  captions: {
    panel: '右の「セルフチェック」に、直すところが出ます（エラーは直してから出す、要確認は確かめる）',
    go: '項目を押すと、その場所へ移って印が付きます。直し方も項目に書いてあります',
    fix: '印の付いた所をクリックして、自分で書き直します',
    warn: '要確認の「記事」も確かめて、直すところなら直します',
    edit: '「です」も、「である」調に書き直します',
    zero: 'エラーが0件になれば、提出用の PDF を書き出せます',
  },
}

const CHECK_TEXT = '二回目の仮縫いでは、前見頃の丈を2cm短くした。袖の記事が重く、腕が下がって見えたためです。'
const FIXED_TEXT = '二回目の仮縫いでは、前身頃の丈を2cm短くした。袖の生地が重く、腕が下がって見えたためである。'

export async function prepare({ page, h }) {
  await h.setParagraph(page, 'p7', CHECK_TEXT)
  await h.sleep(500)
  await h.ready(page)
  await h.goToBlock(page, 'p3')
  const findings = await page.evaluate(() => window.__editor.getSnapshot().findings.map((f) => `${f.severity}:${f.title}`))
  console.log('  指摘：', findings.join('、'))
}

const items = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.side .sec.check .issues li')].map((li) => {
      const r = li.getBoundingClientRect()
      return { text: li.textContent, x: r.left, y: r.top, w: r.width, h: r.height }
    }),
  )

/**
 * セルフチェックの欄のうち、「エラー・要確認」の説明から指摘の一覧（はじめの2件）まで。
 * 一覧は欄の中で下に続く（画面の外にもある）ので、画面の下の端までにとどめる
 */
const listArea = async (page, h) => {
  const sec = await h.rectOf(page, '.side .sec.check')
  const top = (await h.rectOf(page, '.side .sec.check .sev-legend'))?.y ?? sec.y
  const shown = (await items(page)).filter((i) => i.h > 0).slice(0, 2).at(-1)
  const bottom = Math.min(shown ? shown.y + shown.h + 8 : sec.y + sec.h, 700)
  return { x: sec.x, y: top - 8, w: sec.w, h: bottom - top + 8 }
}

/** 紙面の語の後ろをクリックして、その語を消して正しい語を打つ */
async function rewrite(page, h, wrong, right) {
  const r = await h.textRect(page, 'p7', wrong)
  if (!r) throw new Error(`紙面に「${wrong}」が見つかりません`)
  await h.clickAt(page, r.x + r.w - 1, r.y + r.h / 2, { pause: 900 })
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p7', { timeout: 30000 })
  await h.sleep(700)
  for (let i = 0; i < [...wrong].length; i++) {
    await page.keyboard.press('Backspace')
    await h.sleep(280)
  }
  await h.sleep(300)
  await h.typeSlow(page, right, 170)
  await h.sleep(1000)
  await page.keyboard.press('Escape')
  await h.ready(page)
  await h.sleep(900)
}

export async function run({ page, rec, h }) {
  // 1. セルフチェックの欄（指摘の一覧）
  rec.mark('panel', { focus: await listArea(page, h) })
  await h.sleep(4200)

  // 2. 項目を押すと、その場所へ（直し方は項目の中に「「見頃」→「身頃」」のように出ている）
  const list = await items(page)
  const first = list.find((i) => i.text.includes('見頃')) ?? list[0]
  rec.mark('go', { focus: await listArea(page, h) })
  await h.sleep(2400)
  await h.clickAt(page, first.x + 60, first.y + first.h / 2, { pause: 700 })
  await h.sleep(600)
  await h.ready(page)
  await h.sleep(800)
  const p7 = await h.blockRect(page, 'p7')
  const around = { ...p7, y: p7.y - 30, h: p7.h + 60 }
  rec.mark('jump', { focus: around })
  await h.sleep(3000)

  // 3. 自分で書き直す：「見頃」→「身頃」（エラー）
  rec.mark('fix', { focus: around })
  await h.sleep(1500)
  await rewrite(page, h, '見頃', '身頃')

  // 4. 要確認：「記事」→「生地」
  rec.mark('warn', { focus: around })
  await h.sleep(1500)
  await rewrite(page, h, '記事', '生地')

  // 5. 「ためです。」→「ためである。」
  rec.mark('edit', { focus: around })
  await h.sleep(1500)
  const end = await h.endOfBlock(page, 'p7')
  await h.clickAt(page, end.x, end.y, { pause: 700 })
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p7', { timeout: 30000 })
  await page.keyboard.press('End')
  await h.sleep(900)
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Backspace')
    await h.sleep(260)
  }
  await h.sleep(400)
  await h.typeSlow(page, 'である。', 160)
  await h.sleep(1200)
  await page.keyboard.press('Escape')
  await h.ready(page)
  await h.sleep(600)

  // 書き直した文が思ったとおりか（違えば、録り直しが要る）
  const text = await page.evaluate(() => window.__editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === 'p7').content.map((n) => n.text ?? '').join(''))
  if (text !== FIXED_TEXT) throw new Error(`書き直した文が違います：${text}`)

  // 6. 0件
  const head = await h.rectOf(page, '.side .sec.check')
  rec.mark('zero', { focus: { ...head, h: Math.min(head.h, 200) } })
  await h.sleep(3800)
}
