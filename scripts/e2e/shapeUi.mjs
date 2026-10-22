// 「表の形を整える」（mockups/v45 案A。src/app/tableShape.tsx）を、確かめのスクリプトから操作する道具。
// パソコンは左の道具の「表の形を整える」で開く窓（.shape-panel）、スマホは道具の「表の形」で下から出る欄（.table-shape）。
// tableShape.mjs・tableCustom.mjs・tableSettings.mjs・smoke.mjs・phone.mjs から使う
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** 窓・欄の中（開いていなければ null）：列の幅の選び・項目の列・行の高さのいまの形 */
export const shapeState = (page) =>
  page.evaluate(() => {
    const box = document.querySelector('.shape-panel, .table-shape')
    if (!box) return null
    const check = (key) => {
      const el = box.querySelector(`.so-check[data-key="${key}"]`)
      return el ? { on: el.getAttribute('aria-checked') === 'true', disabled: el.getAttribute('aria-disabled') === 'true', text: el.textContent } : null
    }
    return {
      kind: box.classList.contains('shape-panel') ? 'panel' : 'sheet',
      title: box.querySelector('.sp-head b, .sheet-head h2')?.textContent ?? '',
      widths: [...box.querySelectorAll('.so-choice[role="radio"]')].map((b) => ({ value: b.dataset.value, on: b.getAttribute('aria-checked') === 'true', text: b.textContent })),
      label: check('label'),
      heights: check('heights'),
      photo: check('photo'),
      guide: box.querySelector('.so-guide')?.textContent ?? null,
      note: box.querySelector('.so-note')?.textContent ?? null,
    }
  })

/** 道具の「表の形を整える」（スマホは「表の形」）を押して、窓・欄を開く（開いていれば、そのまま） */
export async function openShape(page, phone = false) {
  if (await page.$('.shape-panel, .table-shape')) return
  const sel = phone ? '.direct-bar .shape-btn, .sel-bar .shape-btn, .es-tools .shape-btn' : '.palette .shape-btn'
  if (phone) {
    const at = await page.evaluate((sel) => {
      const b = [...document.querySelectorAll(sel)].find((x) => x.getBoundingClientRect().width > 0)
      const r = b.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    }, sel)
    await page.touchscreen.tap(at.x, at.y)
  } else await page.click(sel)
  await page.waitForSelector('.shape-panel, .table-shape', { timeout: 5000 })
  await wait(250)
}

/** 窓・欄の中の物を押す（パソコンはクリック、スマホはタップ）。押したあと、組み直すのを待つ */
async function press(page, selector, phone, ready) {
  const at = await page.evaluate((selector) => {
    const el = document.querySelector(`:is(.shape-panel, .table-shape) ${selector}`)
    el.scrollIntoView({ block: 'nearest' })
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, selector)
  if (phone) await page.touchscreen.tap(at.x, at.y)
  else await page.mouse.click(at.x, at.y)
  await wait(300)
  if (ready) await ready()
  await wait(150)
}

/** 列の幅を選ぶ（'equal'・'auto'・'custom'）。窓・欄が開いていなければ開く */
export async function pickWidth(page, value, { phone = false, ready } = {}) {
  await openShape(page, phone)
  await press(page, `.so-choice[data-value="${value}"]`, phone, ready)
}

/** 項目の列（'label'）・行の高さ（'heights'：そろえる、'photo'：写真が入る高さ）のチェックを、on にする（もうその形なら押さない） */
export async function setCheck(page, key, on, { phone = false, ready } = {}) {
  await openShape(page, phone)
  const now = await page.evaluate((key) => document.querySelector(`:is(.shape-panel, .table-shape) .so-check[data-key="${key}"]`).getAttribute('aria-checked') === 'true', key)
  if (now !== on) await press(page, `.so-check[data-key="${key}"]`, phone, ready)
}

/** 窓・欄を閉じる（パソコン：×、スマホ：できた） */
export async function closeShape(page, phone = false) {
  if (!(await page.$('.shape-panel, .table-shape'))) return
  await press(page, phone ? '.ts-done' : '.sp-close', phone)
  await page.waitForFunction(() => !document.querySelector('.shape-panel, .table-shape'), { timeout: 5000 }).catch(() => {})
}

/** 要素の字を、行ごとに分ける（同じ高さの字を1行とする。空白は数えない）。1字だけの行（と、その元の字）を探すのに使う */
export const linesIn = (page, selector) =>
  page.evaluate((selector) =>
    [...document.querySelectorAll(selector)].map((el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      const lines = []
      let lastTop = null
      while (walker.nextNode()) {
        const node = walker.currentNode
        for (let i = 0; i < node.length; i++) {
          if (/\s/.test(node.data[i])) continue
          const r = document.createRange()
          r.setStart(node, i)
          r.setEnd(node, i + 1)
          const q = [...r.getClientRects()].find((x) => x.height > 0)
          if (!q) continue
          if (lastTop === null || q.top > lastTop + q.height * 0.5) {
            lines.push('')
            lastTop = q.top
          }
          lines[lines.length - 1] += node.data[i]
        }
      }
      return lines
    }),
  selector)

/** 1字だけの行がある物（行に分けた字の一覧） */
export const loneOf = (lines) => lines.filter((l) => l.length > 1 && l.some((x) => x.length === 1)).map((l) => l.join('／'))
