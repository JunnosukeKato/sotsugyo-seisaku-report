// 表のセルを書いている間も、そのセルの罫線（上下左右）が見えている（依頼者の指摘 2026-10-20「細い欄に文字入力する際、罫線が消えて見える」）。
// 前は、書く欄（白い地）がセルより広く（細い欄でも 120px 以上）、セルの右の線・下の線などを白く隠していた。
// 細い列（自分で決めるの 10%・中身に合わせる）の、見出しの行・途中の行・最後の行のセルを書いて、画面の絵で4本の線を確かめる（パソコン・スマホ）
// smoke.mjs（cellBorderPc）・phone.mjs（cellBorderPhone）から呼ぶ。これだけを動かすときは node scripts/e2e/cellBorder.mjs [pc|phone] [before|after]。画面の写真は poc-output/cell-border/
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { FEATURES, openSample, showTable } from './tableShape.mjs'

const OUT = 'poc-output/cell-border'
mkdirSync(OUT, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const ID = 't1'
const PAD = 8

/** 見本の素材表を、列の幅の形 mode にする（4列：名称・使用箇所・特徴・生地見本。custom は 名称 10%） */
const setTable = (page, mode) =>
  page.evaluate(
    (FEAT, mode) => {
      window.__editor.update((r) => ({
        ...r,
        body: r.body.map((c) => ({
          ...c,
          blocks: c.blocks.map((b) => {
            if (b.id !== 't1') return b
            const rows = b.rows[0].cells.length === 4 ? b.rows : b.rows.map((row, i) => ({ ...row, cells: [...row.cells.slice(0, 2), i === 0 ? { id: 't1:hf', text: FEAT.head, imageId: null } : { id: `${row.id}:feat`, text: FEAT.rows[i - 1], imageId: null }, ...row.cells.slice(2)] }))
            return { ...b, rows, widths: mode, colWidths: [10, 25, 40, 25] }
          }),
        })),
      }))
    },
    FEATURES,
    mode,
  )

/**
 * 書いているセル（cellId）の、上下左右の罫線が画面に描かれているか。セルのまわりの画面の絵を撮り、線の上の点の暗さを、線の真ん中の 70% で調べる。
 * 線ごとに、暗い点（明るさ 200 未満）の割合を返す（1 なら線が全部見えている）。
 * スマホの「自分で決める」の表で、線の上に置いた丸いつまみ（columnHandles.ts）の所は数えない（つまみは線を動かす道具。書く欄ではない）
 */
async function borders(page, cellId, shot) {
  const r = await page.evaluate((id) => {
    const el = document.querySelector(`.page-viewport.front [data-cell-id="${id}"]`)
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const q = el.getBoundingClientRect()
    const knobs = [...document.querySelectorAll('.col-handles .col-pknob span')].map((k) => {
      const b = k.getBoundingClientRect()
      return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }
    })
    return { left: q.left, top: q.top, width: q.width, height: q.height, knobs }
  }, cellId)
  await wait(150)
  const clip = { x: r.left - PAD, y: r.top - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 }
  const b64 = await page.screenshot({ clip, encoding: 'base64', captureBeyondViewport: false })
  if (shot) writeFileSync(`${OUT}/${shot}.png`, Buffer.from(b64, 'base64'))
  return page.evaluate(
    async (b64, clip, PAD, knobs) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const k = img.width / clip.width
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, c.width, c.height).data
      const lum = (x, y) => {
        const i = (Math.round(y) * c.width + Math.round(x)) * 4
        return data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11
      }
      // 線の位置（絵の中の px）。線の太さは 1px ほどなので、前後 3px の中でいちばん暗い点を見る
      const L = PAD * k
      const T = PAD * k
      const R = (clip.width - PAD) * k
      const B = (clip.height - PAD) * k
      // つまみの所（絵の中の px）
      const covered = (x, y) => knobs.some((q) => x >= (q.left - clip.x - 2) * k && x <= (q.right - clip.x + 2) * k && y >= (q.top - clip.y - 2) * k && y <= (q.bottom - clip.y + 2) * k)
      const side = (along, at, horizontal) => {
        const [a0, a1] = along
        let dark = 0
        let n = 0
        for (let a = a0 + (a1 - a0) * 0.15; a <= a0 + (a1 - a0) * 0.85; a += 1) {
          if (horizontal ? covered(a, at) : covered(at, a)) continue
          let min = 255
          for (let d = -3 * k; d <= 3 * k; d += 1) min = Math.min(min, horizontal ? lum(a, at + d) : lum(at + d, a))
          n += 1
          if (min < 200) dark += 1
        }
        // 線がみな、つまみの下（見出しの行の低いセル）：測れない（null）
        return n ? Math.round((dark / n) * 100) / 100 : null
      }
      return { top: side([L, R], T, true), bottom: side([L, R], B, true), left: side([T, B], L, false), right: side([T, B], R, false) }
    },
    b64,
    clip,
    PAD,
    r.knobs,
  )
}

const allDrawn = (b) => [b.top, b.bottom, b.left, b.right].every((v) => v === null || v >= 0.95)

/** セルを書き始める（PC はクリック、スマホは指で押す） */
async function edit(page, ready, cellId, phone) {
  await page.evaluate(() => window.__editor.finishEditing())
  await ready()
  await showTable(page, ready, ID)
  const at = await page.evaluate((id) => {
    const r = document.querySelector(`.page-viewport.front [data-cell-id="${id}"]`).getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, cellId)
  if (phone) await page.touchscreen.tap(at.x, at.y)
  else await page.mouse.click(at.x, at.y)
  await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 10000 }, cellId).catch(() => {})
  await wait(600)
}

async function run(browser, check, phone, tag) {
  const { context, page, ready } = await openSample(browser, phone)
  const who = phone ? 'スマホ' : 'パソコン'
  const results = []
  for (const mode of ['custom', 'auto']) {
    await setTable(page, mode)
    await ready()
    // 細い列：自分で決めるの 10% の「名称」、中身に合わせるの「使用箇所」。見出しの行・途中の行・最後の行
    const col = mode === 'custom' ? ['t1:h0', 'm1:name', 'm2:name', 'm3:name'] : ['t1:h1', 'm1:usage', 'm3:usage']
    for (const cellId of col) {
      await edit(page, ready, cellId, phone)
      const editing = await page.evaluate(() => window.__editor.getSnapshot().editingId)
      // 字を足して、書いている欄が組み直す前の形のときも見る（打っている途中）
      await page.keyboard.type('あ')
      await wait(80)
      const b = await borders(page, cellId, tag ? `${tag}-${phone ? 'phone' : 'pc'}-${mode}-${cellId.replace(':', '-')}` : null)
      results.push({ mode, cellId, editing: editing === cellId, ...b })
      await page.keyboard.press('Backspace')
    }
  }
  await page.evaluate(() => window.__editor.finishEditing())
  check(
    `${who}：表のセルを書いている間も、そのセルの罫線（上下左右）は見えている（細い列：自分で決めるの 10%・中身に合わせる。見出しの行・途中の行・最後の行）`,
    results.every((r) => r.editing && allDrawn(r)),
    JSON.stringify(results),
  )
  await context.close()
}

export const cellBorderPc = (browser, check, tag) => run(browser, check, false, tag)
export const cellBorderPhone = (browser, check, tag) => run(browser, check, true, tag)

// これだけを動かす：node scripts/e2e/cellBorder.mjs [pc|phone] [写真の名前の頭]
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { withEdge } = await import('../poc/edge.mjs')
  const only = process.argv[2]
  const tag = process.argv[3]
  const results = []
  const check = (name, ok, detail = '') => {
    results.push(ok)
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
  }
  await withEdge(async (browser) => {
    if (only !== 'phone') await cellBorderPc(browser, check, tag)
    if (only !== 'pc') await cellBorderPhone(browser, check, tag)
  })
  const failed = results.filter((ok) => !ok).length
  console.log(`\n${results.length - failed}/${results.length} 件 合格`)
  process.exitCode = failed ? 1 : 0
}
