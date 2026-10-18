// 動画 4：セルフチェックで直す（パソコン）
// 見本の原稿に、わざと誤り（「見頃」「記事」「です」）を入れてから録る（使い方の画面の写真と同じ文）
export const meta = {
  number: '4',
  label: 'セルフチェックで直す',
  device: 'pc',
  captions: {
    panel: '右の「セルフチェック」に、直すところが出ます（エラーは直してから出す、警告はできれば直す）',
    go: '項目を押すと、その場所へ移って印が付きます',
    fix: '「直す」があるものは、押すだけで直ります',
    edit: '自分で書き直すこともできます。文をクリックして直します',
    zero: 'エラーが0件になれば、提出用の PDF を書き出せます',
  },
}

const CHECK_TEXT = '二回目の仮縫いでは、前見頃の丈を2cm短くした。袖の記事が重く、腕が下がって見えたためです。'

export async function prepare({ page, h }) {
  await h.setParagraph(page, 'p7', CHECK_TEXT)
  await h.sleep(500)
  await h.ready(page)
  await h.goToBlock(page, 'p3')
  const findings = await page.evaluate(() => window.__editor.getSnapshot().findings.map((f) => `${f.severity}:${f.title}${f.replacement !== undefined ? '（直す）' : ''}`))
  console.log('  指摘：', findings.join('、'))
}

const items = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.side .sec.check li')].map((li) => {
      const r = li.getBoundingClientRect()
      const fix = li.querySelector('.fix')?.getBoundingClientRect()
      return { text: li.textContent, x: r.left, y: r.top, w: r.width, h: r.height, fix: fix ? { x: fix.left + fix.width / 2, y: fix.top + fix.height / 2 } : null }
    }),
  )

/**
 * セルフチェックの欄のうち、「エラー・警告」の説明から指摘の一覧（はじめの2件）まで。
 * 一覧は欄の中で下に続く（画面の外にもある）ので、画面の下の端までにとどめる
 */
const listArea = async (page, h) => {
  const sec = await h.rectOf(page, '.side .sec.check')
  const top = (await h.rectOf(page, '.side .sec.check .sev-legend'))?.y ?? sec.y
  const shown = (await items(page)).filter((i) => i.h > 0).slice(0, 2).at(-1)
  const bottom = Math.min(shown ? shown.y + shown.h + 8 : sec.y + sec.h, 700)
  return { x: sec.x, y: top - 8, w: sec.w, h: bottom - top + 8 }
}

export async function run({ page, rec, h }) {
  // 1. セルフチェックの欄（数の欄と、指摘の一覧）
  rec.mark('panel', { focus: await listArea(page, h) })
  await h.sleep(4200)

  // 2. 項目を押すと、その場所へ
  let list = await items(page)
  const first = list.find((i) => !i.fix) ?? list[0]
  rec.mark('go', { focus: await listArea(page, h) })
  await h.sleep(1200)
  await h.clickAt(page, first.x + 60, first.y + first.h / 2, { pause: 700 })
  await h.sleep(600)
  await h.ready(page)
  await h.sleep(800)
  const p7 = await h.blockRect(page, 'p7')
  rec.mark('jump', { focus: { ...p7, y: p7.y - 30, h: p7.h + 60 } })
  await h.sleep(3200)

  // 3. 「直す」で直す（「見頃」「記事」。「です」は、次に自分で書き直して見せる）
  rec.mark('fix', { focus: await listArea(page, h) })
  await h.sleep(1500)
  for (let k = 0; k < 3; k++) {
    list = await items(page)
    const target = list.find((i) => i.fix && /見頃|記事/.test(i.text))
    if (!target) break
    await h.clickAt(page, target.fix.x, target.fix.y, { pause: 900 })
    await h.sleep(500)
    await h.ready(page)
    await h.sleep(1200)
  }

  // 4. 自分で書き直す（「ためです。」→「ためである。」）
  rec.mark('edit', { focus: { ...(await h.blockRect(page, 'p7')), h: 60 } })
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

  // 5. 0件
  const head = await h.rectOf(page, '.side .sec.check')
  rec.mark('zero', { focus: { ...head, h: Math.min(head.h, 200) } })
  await h.sleep(3800)
}
