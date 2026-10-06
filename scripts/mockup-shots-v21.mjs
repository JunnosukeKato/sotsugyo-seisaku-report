// デザイン案 v21（学生へのお知らせを、コースごとにも出せるようにする）を画像に書き出す。
// 管理ページ（入力する場所）と学生用ツール（見せ方）に、案ごとの部品を仮に足して撮る。
// 使い方: node scripts/mockup-shots-v21.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { stubConfig } from './e2e/configStub.mjs'
import { withEdge } from './poc/edge.mjs'

const OUT = 'mockups/v21/screens'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// お知らせの例（架空）
const T = {
  all: '12月4日（金）の中間発表では、本文の下書きを印刷して持ってきてください。',
  course: '衣装コースの人は、素材表の「生地見本」に、使った生地の写真を必ず入れてください。',
  courseName: '映画・舞台衣装デザイナー',
}

const ADMIN_CSS = `
  .v21-note { margin-top: 6px; display: grid; gap: 4px; }
  .v21-note .l { font-size: 12px; color: var(--muted); }
  .v21-note textarea { font: inherit; font-size: 13px; }
  .v21-tabs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
  .v21-tabs button { border: 1px solid var(--line); background: #fff; border-radius: 999px; padding: 4px 10px; font-size: 12px; color: var(--muted); }
  .v21-tabs button.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); font-weight: 700; }
  .v21-tabs button i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--ok); margin-left: 5px; vertical-align: 1px; }
  .v21-btn { display: flex; align-items: center; gap: 10px; width: 100%; border: 1px solid #c9cfe6; background: #fff; color: var(--accent); border-radius: 8px; padding: 9px 12px; font-size: 13px; text-align: left; }
  .v21-btn span { margin-left: auto; color: var(--muted); font-size: 12px; }
  .v21-modal { width: min(900px, calc(100vw - 32px)) !important; }
  .v21-split { display: grid; grid-template-columns: 220px 1fr 260px; gap: 14px; align-items: start; }
  .v21-list { display: grid; gap: 4px; }
  .v21-list button { text-align: left; border: 1px solid var(--line); background: #fff; border-radius: 8px; padding: 8px 10px; font-size: 12.5px; }
  .v21-list button.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); font-weight: 700; }
  .v21-list button small { display: block; font-weight: 400; color: var(--muted); font-size: 11px; }
  .v21-pv { background: #fbfaf8; border: 1px solid var(--line); border-radius: 10px; padding: 10px; font-size: 11.5px; }
  .v21-pv .cap { font-size: 11px; color: var(--muted); margin-bottom: 6px; }
  .v21-pv .box { padding: 9px 12px; border-radius: 8px; background: #e8ebf5; line-height: 1.6; margin-bottom: 6px; }
  .v21-pv .box b { display: block; font-size: 11px; color: #2f3e75; }
`

const ADMIN = {
  // 案A：コースのカードに、そのコースのお知らせの欄を足す（今の欄は「全員へのお知らせ」に）
  a: (T) => {
    const label = [...document.querySelectorAll('.form .f .l')].find((l) => l.textContent.startsWith('学生へのお知らせ'))
    label.textContent = '全員へのお知らせ（任意）'
    label.parentElement.querySelector('textarea').value = T.all
    const card = document.querySelector('.form .course')
    card.querySelector('.tpl-row').insertAdjacentHTML('afterend', `<label class="v21-note"><span class="l">このコースの学生へのお知らせ（任意）</span><textarea class="in" rows="2">${T.course}</textarea></label>`)
    card.scrollIntoView({ block: 'center' })
  },
  // 案B：お知らせの欄を、「全員・コースごと」の切り替えにする
  b: (T) => {
    const label = [...document.querySelectorAll('.form .f .l')].find((l) => l.textContent.startsWith('学生へのお知らせ'))
    const courses = ['映画・舞台衣装デザイナー', 'プロデューサー・ジャーナリスト', 'スタイリスト・コーディネーター']
    label.insertAdjacentHTML('afterend', `<div class="v21-tabs"><button>全員<i></i></button>${courses.map((c, i) => `<button class="${i === 0 ? 'on' : ''}">${c}${i === 0 ? '<i></i>' : ''}</button>`).join('')}</div>`)
    label.parentElement.querySelector('textarea').value = T.course
    label.parentElement.querySelector('.hint').textContent = '「全員」は全員に、コースを選んで書いたものはそのコースの学生にだけ表示されます（点は、書いてあるもの）'
    label.parentElement.scrollIntoView({ block: 'center' })
  },
  // 案C：ボタンから開く窓で、全員・コースごとのお知らせをまとめて編集する（学生の見え方も出す）
  c: (T) => {
    const field = [...document.querySelectorAll('.form .f .l')].find((l) => l.textContent.startsWith('学生へのお知らせ')).parentElement
    field.innerHTML = `<span class="l">学生へのお知らせ（任意）</span><button class="v21-btn">全員・コースごとのお知らせを編集<span>全員・1コース</span></button><span class="hint">学生のツールのセルフチェック欄の上に表示されます</span>`
    const back = document.createElement('div')
    back.className = 'modal-backdrop'
    back.innerHTML = `<div class="modal v21-modal"><header><h2>学生へのお知らせ</h2><button class="close">×</button></header>
      <div class="v21-split">
        <div class="v21-list"><button>全員<small>書いてあります</small></button><button class="on">${T.courseName}<small>書いてあります</small></button><button>プロデューサー・ジャーナリスト<small>なし</small></button><button>スタイリスト・コーディネーター<small>なし</small></button></div>
        <label class="v21-note" style="margin:0"><span class="l">${T.courseName} コースの学生へのお知らせ</span><textarea class="in" rows="8">${T.course}</textarea></label>
        <div class="v21-pv"><div class="cap">このコースの学生には、こう見えます</div><div class="box"><b>学科からのお知らせ</b>${T.all}</div><div class="box"><b>${T.courseName} コースから</b>${T.course}</div></div>
      </div>
      <div class="row-buttons"><span class="spacer"></span><button>やめる</button><button class="primary">反映する</button></div></div>`
    document.body.append(back)
  },
}

const STUDENT_CSS = `
  .guide { display: none !important; }
  .notice .v21-sub { display: block; margin-top: 8px; padding-top: 7px; border-top: 1px solid rgba(47, 62, 117, 0.15); }
  .notice.course { background: #f6efe3; }
  .notice.course b { color: #8a5a12; }
`

const STUDENT = {
  // 見せ方1：1つの枠に、全員へのお知らせとコースのお知らせを続けて出す
  s1: (T) => {
    let box = document.querySelector('.side .notice')
    if (!box) {
      document.querySelector('.side .side-head').insertAdjacentHTML('afterend', '<div class="notice"></div>')
      box = document.querySelector('.side .notice')
    }
    box.innerHTML = `<b>学科からのお知らせ</b><p>${T.all}</p><span class="v21-sub"><b>${T.courseName} コースから</b><p>${T.course}</p></span>`
  },
  // 見せ方2：枠を分ける（コースのお知らせは色を変える）
  s2: (T) => {
    let box = document.querySelector('.side .notice')
    if (!box) {
      document.querySelector('.side .side-head').insertAdjacentHTML('afterend', '<div class="notice"></div>')
      box = document.querySelector('.side .notice')
    }
    box.innerHTML = `<b>学科からのお知らせ</b><p>${T.all}</p>`
    box.insertAdjacentHTML('afterend', `<div class="notice course"><b>${T.courseName} コースからのお知らせ</b><p>${T.course}</p></div>`)
  },
}

await withEdge(async (browser) => {
  for (const [key, inject] of Object.entries(ADMIN)) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 })
    await page.goto('http://localhost:5173/admin.html', { waitUntil: 'networkidle0' })
    await page.waitForSelector('.admin .form')
    await page.addStyleTag({ content: ADMIN_CSS })
    await page.evaluate(inject, T)
    await sleep(400)
    await page.screenshot({ path: `${OUT}/admin-${key}.png` })
    console.log(`${OUT}/admin-${key}.png`)
    await context.close()
  }
  for (const [key, inject] of Object.entries(STUDENT)) {
    const context = await browser.createBrowserContext()
    const page = await context.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 })
    await stubConfig(page)
    await page.goto('http://localhost:5173/?nodrive', { waitUntil: 'networkidle0', timeout: 90000 })
    await page.waitForFunction(() => window.__editor?.getSnapshot()?.layout && !window.__editor.getSnapshot().rendering, { timeout: 90000 })
    await page.addStyleTag({ content: STUDENT_CSS })
    await page.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, studentId: '00ZZ0123', name: '文化　花子', subtitleInput: 'シンドバッド', courseId: 'film-stage-costume' } })))
    await sleep(600)
    await page.evaluate(inject, T)
    await sleep(300)
    await page.screenshot({ path: `${OUT}/student-${key}.png` })
    await (await page.$('.side')).screenshot({ path: `${OUT}/student-${key}-side.png` })
    console.log(`${OUT}/student-${key}.png`)
    await context.close()
  }
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 })
  await page.goto('http://localhost:5173/mockups/v21/notice.html', { waitUntil: 'networkidle0' })
  await page.screenshot({ path: `${OUT}/notice.png`, fullPage: true })
  console.log(`${OUT}/notice.png`)
})
