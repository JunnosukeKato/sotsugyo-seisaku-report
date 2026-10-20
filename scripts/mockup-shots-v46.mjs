// デザイン案 v46（スマホでページをめくると、紙面の下に帯（案内）が出るページだけ、紙面が上に動く）を画像に書き出す。
// 依頼者（先生）の声：「ページをめくっていると目次ページだけ、下側にメッセージがついている分だけ上に少し上がることが気になります」
// 「段落が空いていたり、他でも起こるんですね」。
// いまは、帯を出すページだけ、帯の分を空けて紙面を上下の真ん中に置き直している（src/app/PageBand.tsx の --inset-band・src/editor/pageStage.ts の fit）。
// 本物の画面（スマホ 390×844）を写し、案は紙面の位置（--page-top）だけを書き換えて写す（src/ は変えない）。
//   now ：いま（帯のないページ・目次のページ・まだ書いていない段落があるページ）
//   a   ：案A 紙面をいつも上に寄せる（どのページも同じ位置。帯は紙面の下の空いている所に出る）
//   b   ：案B 紙面はいつもの位置のまま、帯を紙面の下の方に重ねる
//   review：一覧のページ（mockups/v46/review.html）を1枚の画像にする（shots/review-band.png）
// 学生用ツールは、Google のログインとドライブを偽物（scripts/e2e/fakeGoogle.mjs）に差し替えて開く（本物の Google にはつながない）。
// 使い方: node scripts/mockup-shots-v46.mjs [shots] [review]（何も付けなければ全部。開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync, writeFileSync } from 'node:fs'

process.env.EDGE_PORT ??= '9811'
const { withEdge } = await import('./poc/edge.mjs')
const { openTool, ready } = await import('./video/session.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const DIR = 'mockups/v46'
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })
const ONLY = process.argv.slice(2)
const want = (k) => ONLY.length === 0 || ONLY.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** 数えたこと（一覧のページの数は、ここから書く） */
const FACTS = {}

/** ページへ移って、紙面と帯の位置を測る */
async function go(page, index) {
  await page.evaluate((i) => window.__editor.goToPage(i, 'none'), index)
  await sleep(500)
  await ready(page)
  await sleep(300)
  return page.evaluate(() => {
    const stage = document.querySelector('.stage')
    const st = stage.getBoundingClientRect()
    const box = document.querySelector('.page-viewport.front [data-vivliostyle-outer-zoom-box]')?.getBoundingClientRect()
    const band = document.querySelector('.page-band')?.getBoundingClientRect()
    const pager = document.querySelector('.pager')?.getBoundingClientRect()
    return {
      stageTop: st.top,
      pageTop: box ? box.top - st.top : null,
      pageBottom: box ? box.bottom - st.top : null,
      pageH: box?.height ?? null,
      band: band ? { top: band.top - st.top, bottom: band.bottom - st.top } : null,
      pagerTop: pager ? pager.top - st.top : null,
      insetTop: parseFloat(getComputedStyle(stage).getPropertyValue('--inset-top')),
    }
  })
}

/** 紙面の位置だけを書き換える（案の見た目。組版はそのまま） */
const setTop = (page, top) => page.evaluate((top) => document.querySelector('.stage').style.setProperty('--page-top', `${top}px`), top)

async function shots(browser) {
  const { context, page } = await openTool(browser, { device: 'phone' })
  // まだ書いていない段落があるページ：本文 2 の最後に、空の段落を1つ足す（ひな形の段落と同じ。紙面に仮の文字が出て、帯に「書く」が出る）
  const kinds = await page.evaluate(() => window.__editor.getSnapshot().layout.kinds)
  const toc = kinds.indexOf('toc')
  const body1 = kinds.indexOf('body')
  await page.evaluate(() =>
    window.__editor.update((r) => ({
      ...r,
      body: r.body.map((c, i) => (i === 1 ? { ...c, blocks: [...c.blocks, { type: 'paragraph', id: 'mk-empty', content: [], hint: 'ここに、制作の工夫を書く' }] } : c)),
    })),
  )
  await sleep(600)
  await ready(page)
  const emptyPage = await page.evaluate(() => window.__editor.pageOfBlock('mk-empty'))

  // いま
  const plain = await go(page, body1)
  await page.screenshot({ path: `${OUT}/now-plain.png` })
  const tocNow = await go(page, toc)
  await page.screenshot({ path: `${OUT}/now-toc.png` })
  const emptyNow = await go(page, emptyPage)
  await page.screenshot({ path: `${OUT}/now-empty.png` })
  FACTS.now = { plain, toc: tocNow, empty: emptyNow }

  // 案A：どのページも、紙面を上に寄せる（台の上の余白のすぐ下）
  const topA = plain.insetTop
  await go(page, body1)
  await setTop(page, topA)
  await page.screenshot({ path: `${OUT}/a-plain.png` })
  await go(page, toc)
  await setTop(page, topA)
  await page.screenshot({ path: `${OUT}/a-toc.png` })
  await go(page, emptyPage)
  await setTop(page, topA)
  await page.screenshot({ path: `${OUT}/a-empty.png` })

  // 案B：紙面はいつもの位置（帯のないページと同じ）のまま。帯は紙面に重ねる
  await go(page, body1)
  await page.screenshot({ path: `${OUT}/b-plain.png` })
  await go(page, toc)
  await setTop(page, plain.pageTop)
  await page.screenshot({ path: `${OUT}/b-toc.png` })
  await go(page, emptyPage)
  await setTop(page, plain.pageTop)
  await page.screenshot({ path: `${OUT}/b-empty.png` })

  writeFileSync(`${OUT}/facts.json`, JSON.stringify(FACTS, null, 2))
  console.log(JSON.stringify(FACTS, null, 1))
  await context.close()
}

/** 一覧のページ（mockups/v46/review.html）を1枚の画像にする */
async function reviewShots(browser) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 1.5 })
  await page.goto(`${APP}/${DIR}/review.html`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  await page.screenshot({ path: `${OUT}/review-band.png`, fullPage: true })
  console.log('✓ review-band')
  await context.close()
}

await withEdge(async (browser) => {
  if (want('shots')) await shots(browser)
  if (want('review')) await reviewShots(browser)
})
