// 管理ページの通しの動作確認（試験用サーバーで。Edge を自動で操作する）
// 使い方: node scripts/e2e/admin.mjs（開発サーバーが http://localhost:5173 で動いていること。APP_URL で変えられる）
// 管理ページは mockups/v43 案B（左の見出し）：左に区切り（年度の設定・コース・書き方のチェック・先生の登録・変更履歴・詳細設定）、右には選んだ区切りだけ
import { mkdirSync } from 'node:fs'
import { withEdge } from '../poc/edge.mjs'
import { templateModeAdmin } from './templateMode.mjs'

// 開発サーバーの場所（ふだんは http://localhost:5173。APP_URL で変えられる）
const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'poc-output/e2e'
// 先生のお試しで見つかった問題の直し（確認の言葉・知らせ）の画面
const SHOTS = 'poc-output/admin-fixes'
// mockups/v43 案B（左の見出し）の画面（1366×768・1920×1080）
const V43 = 'poc-output/admin-v43b'
mkdirSync(OUT, { recursive: true })
mkdirSync(SHOTS, { recursive: true })
mkdirSync(V43, { recursive: true })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 確認の窓（confirm・ページを離れるときの確認）を記録し、答える。ふだんは「OK」。
 * answer(false) のあいだは「キャンセル」。answerNext(true, false) は、次の窓から順に「OK」「キャンセル」（使い切ったら、ふだんの答え）
 */
function dialogLog(page) {
  const log = { messages: [], ok: true, next: [] }
  page.on('dialog', (d) => {
    log.messages.push(d.message())
    const ok = log.next.length ? log.next.shift() : log.ok
    if (ok) d.accept()
    else d.dismiss()
  })
  return {
    last: () => log.messages.at(-1) ?? '',
    /** 後ろから n 番目の窓の文（1 で最後） */
    nth: (n) => log.messages.at(-n) ?? '',
    count: () => log.messages.length,
    answer: (ok) => void (log.ok = ok),
    answerNext: (...answers) => void log.next.push(...answers),
  }
}

// ---- どのページでも使う道具 ----
/** 左の見出しの区切りを押す（title：「年度の設定」「コース」など） */
const nav = async (p, title) => {
  await p.evaluate((t) => [...document.querySelectorAll('.side-nav button')].find((b) => b.querySelector('.nt b').firstChild.textContent.trim() === t).click(), title)
  await sleep(150)
}
/** いま開いている区切りの見出し */
const sectionTitle = (p) => p.evaluate(() => document.querySelector('.content .sec-h')?.textContent ?? '')
/** 開いているコースのお知らせの欄（コースの区切りを開いてから） */
const openNotice = async (p) => {
  if ((await sectionTitle(p)) !== 'コース') await nav(p, 'コース')
  return p.$('.course.open textarea.notice')
}
const setValue = (handle, text) =>
  handle.evaluate((el, text) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, text)
const previewTextOf = async (p) => {
  // 見本の iframe は、設定が変わるたびに読み込み直す（読み込みの途中は中身がない）。中身が出てから読む
  await p.waitForFunction(() => document.querySelector('.preview iframe')?.contentDocument?.body?.innerText.trim(), { timeout: 5000 }).catch(() => {})
  return p.evaluate(() => document.querySelector('.preview iframe').contentDocument.body.innerText.replace(/\s/g, ''))
}
/**
 * 1字だけが行に残っている文を探す（root の中の、字のある部品ごとに、1字ずつの位置から行を分ける。mockups/v43 の数え方と同じ）。
 * 入力欄・選ぶ欄・見本（iframe）の中は見ない
 */
const lonelyLines = (p, root = '.admin') =>
  p.evaluate((rootSel) => {
    const bad = []
    const boxes = new Map()
    const range = document.createRange()
    for (const root of document.querySelectorAll(rootSel)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent.trim() || n.parentElement.closest('style, script, option, select, textarea, .sr-only')) continue
        let box = n.parentElement
        while (box && getComputedStyle(box).display === 'inline') box = box.parentElement
        if (!box || !box.getClientRects().length) continue
        if (!boxes.has(box)) boxes.set(box, [])
        const list = boxes.get(box)
        for (let i = 0; i < n.length; i++) {
          if (/\s/.test(n.data[i])) continue
          range.setStart(n, i)
          range.setEnd(n, i + 1)
          const r = range.getBoundingClientRect()
          if (r.height) list.push({ y: (r.top + r.bottom) / 2, h: r.height, ch: n.data[i] })
        }
      }
    }
    for (const [box, list] of boxes) {
      const lines = []
      for (const c of list.sort((a, b) => a.y - b.y)) {
        const line = lines.at(-1)
        if (line && Math.abs(c.y - line.y) < line.h * 0.55) line.chars.push(c.ch)
        else lines.push({ y: c.y, h: c.h, chars: [c.ch] })
      }
      if (lines.length > 1 && lines.some((l) => l.chars.length === 1)) bad.push(`${box.textContent.trim().slice(0, 40)}…（${lines.map((l) => l.chars.join('')).join('／')}）`.slice(0, 160))
    }
    return bad
  }, root)
/** 1280・1366・1920 の幅で、1字だけ行に残っている文（最後は width×height に戻す） */
const lonelyAtWidths = async (p, root = '.admin', back = { width: 1366, height: 768 }) => {
  const bad = []
  for (const width of [1280, 1920, 1366]) {
    await p.setViewport({ width, height: width === 1920 ? 1080 : 768 })
    await sleep(250)
    bad.push(...(await lonelyLines(p, root)).map((s) => `${width}:${s}`))
  }
  await p.setViewport(back)
  await sleep(150)
  return bad
}
/** 13px より小さい字（見えている字のある部品。見本の iframe の中は見ない） */
const smallText = (p, root = '.admin') =>
  p.evaluate((rootSel) => {
    const out = new Set()
    for (const root of document.querySelectorAll(rootSel)) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const el = n.parentElement
        if (!n.textContent.trim() || !el || el.closest('style, script, option, .sr-only') || !el.getClientRects().length) continue
        const size = parseFloat(getComputedStyle(el).fontSize)
        if (size < 12.99) out.add(`${size}px「${n.textContent.trim().slice(0, 20)}」`)
      }
    }
    return [...out]
  }, root)
/**
 * はじめの画面に見えている入力欄・ボタン・字の数（mockups/v43 の counts.json と同じ数え方）。
 * 入力欄：input・select・textarea。ボタン：button。字：見えている字（見本の iframe の中は数えない）と、入力欄に入っている字
 */
const countScreen = (p) =>
  p.evaluate(() => {
    const clipOf = (el) => {
      let box = { l: 0, t: 0, r: innerWidth, b: innerHeight }
      for (let q = el; q; q = q.parentElement) {
        const ps = getComputedStyle(q)
        if (ps.display === 'none' || ps.visibility === 'hidden') return null
        if (q !== el && /(auto|scroll|hidden)/.test(ps.overflow + ps.overflowX + ps.overflowY)) {
          const pr = q.getBoundingClientRect()
          box = { l: Math.max(box.l, pr.left), t: Math.max(box.t, pr.top), r: Math.min(box.r, pr.right), b: Math.min(box.b, pr.bottom) }
        }
      }
      return box
    }
    const shown = (r, box) => {
      if (!box || r.width < 2 || r.height < 2) return false
      const w = Math.min(r.right, box.r) - Math.max(r.left, box.l)
      const h = Math.min(r.bottom, box.b) - Math.max(r.top, box.t)
      return w > r.width * 0.5 && h > r.height * 0.5
    }
    const visible = (el) => shown(el.getBoundingClientRect(), clipOf(el))
    const root = document.querySelector('.modal-backdrop .modal') ?? document.body
    const fields = [...root.querySelectorAll('input:not([type=hidden]), select, textarea')].filter(visible)
    const buttons = [...root.querySelectorAll('button')].filter(visible)
    let chars = 0
    let small = 0
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const seen = new Set()
    const range = document.createRange()
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent.replace(/\s/g, '')
      const el = n.parentElement
      if (!text || !el || el.closest('style, script, option, .sr-only')) continue
      const box = clipOf(el)
      range.selectNodeContents(n)
      if (!shown(range.getBoundingClientRect(), box)) continue
      chars += text.length
      if (!seen.has(el)) {
        seen.add(el)
        if (parseFloat(getComputedStyle(el).fontSize) <= 12.01) small++
      }
    }
    for (const f of fields) if (f.value && f.type !== 'checkbox' && f.tagName !== 'SELECT') chars += f.value.replace(/\s/g, '').length
    return { fields: fields.length, buttons: buttons.length, chars, small }
  })

await withEdge(async (browser) => {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  const dialogs = dialogLog(page)
  await page.setViewport({ width: 1440, height: 900 })
  await page.goto(`${APP}/admin.html`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => {
    localStorage.removeItem('sotsugyo-admin-mock')
    localStorage.removeItem('sotsugyo-admin-year')
    localStorage.removeItem('sotsugyo-admin-form-width')
    sessionStorage.removeItem('sotsugyo-admin-section')
  })
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.admin .content')

  const previewText = () => previewTextOf(page)
  const clickButton = (text, p = page) => p.evaluate((text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text)).click(), text)
  const messageText = (p = page) => p.evaluate(() => document.querySelector('.message')?.textContent ?? '')
  const hasDirty = (p = page) => p.evaluate(() => !!document.querySelector('.dirty-bar'))
  /** ページを閉じる・読み込み直すときに、ブラウザの確認が出るか（beforeunload が止められるか） */
  const leaveGuarded = (p = page) =>
    p.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(e)
      return e.defaultPrevented
    })
  const savedYear = (year) => page.evaluate((year) => JSON.parse(localStorage.getItem('sotsugyo-admin-mock')).years.find((y) => y.year === year), year)
  /**
   * 見出しが画面の幅に入っているか：ページが横にはみ出さない・見出しが入りきる・
   * 「この年度を学生に公開」（なければ保存のボタン）が見出しにあり、画面の中に見える
   */
  const headerFits = (p = page) =>
    p.evaluate(() => {
      const head = document.querySelector('.admin-header')
      const buttons = [...head.querySelectorAll('button')]
      const main = buttons.find((b) => b.textContent.includes('この年度を学生に公開')) ?? buttons.find((b) => b.textContent.startsWith('保存'))
      const r = main?.getBoundingClientRect()
      return {
        scrollWidth: document.documentElement.scrollWidth,
        width: innerWidth,
        head: `${head.scrollWidth}/${head.clientWidth}`,
        fits: document.documentElement.scrollWidth <= innerWidth && head.scrollWidth <= head.clientWidth + 1,
        main: main?.textContent ?? '',
        mainVisible: !!r && r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      }
    })
  /** 見出しの並び（字。字のない部品は class の名前） */
  const headerItems = (p = page) => p.evaluate(() => [...document.querySelectorAll('.admin-header > *')].map((e) => e.textContent.trim() || e.className).join('|'))
  /** 左の見出し（区切りの名前／下の字） */
  const navItems = (p = page) => p.evaluate(() => [...document.querySelectorAll('.side-nav button')].map((b) => `${b.querySelector('.nt b').firstChild.textContent.trim()}／${b.querySelector('.nt small').textContent}${b.getAttribute('aria-current') ? '＊' : ''}`).join('|'))

  check('公開中の2026年度が開く', await page.evaluate(() => document.querySelector('.badge.pub')?.textContent === '公開中'))
  const firstHeader = await headerItems()
  const firstNav = await navItems()
  const me = await page.evaluate(() => document.querySelector('.side-nav .me').textContent)
  check(
    '見出しは1段：題名・使い方・年度・状態の印、右に「変更はありません」と静かな保存のボタン。左の見出しに6つの区切り（はじめは「年度の設定」）。ログイン中の人と試験用サーバーは左の下',
    firstHeader === '卒業制作報告書 管理ページ|使い方|2026年度（公開中）|公開中|spacer|変更はありません|保存して学生に反映' &&
      firstNav.startsWith('年度の設定／題目・締切・新年度＊|コース／お知らせ・ひな形|書き方のチェック／言葉 13語（エラー7）|先生の登録／2人|変更履歴／最後：') &&
      firstNav.endsWith('|詳細設定／ふだんは変えません') &&
      me.includes('admin@example.ac.jp') &&
      me.includes('試験用サーバー'),
    JSON.stringify({ firstHeader, firstNav, me }),
  )
  // 「？ 使い方」（見出しの横。右の端に先生用の使い方の欄が出る。mockups/v27 案A）
  await page.click('.admin-header .help-open')
  await page.waitForSelector('.help-dock')
  const adminHelp = await page.evaluate(() => ({
    topics: document.querySelectorAll('.help-dock .help-list button').length,
    pressed: document.querySelector('.admin-header .help-open')?.getAttribute('aria-pressed'),
    pdf: [...document.querySelectorAll('.help-dock .help-foot a')].map((a) => `${a.textContent} ${a.getAttribute('href')} ${a.getAttribute('target')}`),
    content: !!document.querySelector('.admin .content'),
    label: document.querySelector('.help-dock .help-title small')?.textContent ?? '',
    foot: document.querySelector('.help-dock .help-foot p')?.textContent ?? '',
  }))
  check(
    '見出しの横の「？ 使い方」で、右の端に先生・管理者用の使い方が出る（項目11・相談先はほかの管理者と引き継ぎ手順・いちばん下に印刷用の手引き（先生用・管理者用の PDF）を新しいタブで）',
    adminHelp.topics === 11 && adminHelp.pressed === 'true' && adminHelp.content && adminHelp.label === '先生・管理者用' && adminHelp.foot.includes('ほかの管理者') &&
      adminHelp.pdf.join('|') === '先生用 https://junnosukekato.github.io/sotsugyo-seisaku-report/guides/teacher-guide.pdf _blank|管理者用 https://junnosukekato.github.io/sotsugyo-seisaku-report/guides/admin-guide.pdf _blank',
    JSON.stringify(adminHelp),
  )
  const dockTop = await page.evaluate(() => ({ dock: document.querySelector('.help-dock').getBoundingClientRect().top, header: document.querySelector('.admin-header').getBoundingClientRect().bottom }))
  check('使い方の欄は、見出しのすぐ下から出る（見出しに重ならない）', dockTop.dock === dockTop.header && dockTop.header > 55, JSON.stringify(dockTop))
  await page.type('.help-dock .help-search input', '反映 されない')
  await sleep(300)
  const adminFound = await page.evaluate(() => ({ first: document.querySelector('.help-dock .help-results .t')?.textContent, marks: [...new Set([...document.querySelectorAll('.help-dock .help-results mark')].map((m) => m.textContent))] }))
  check('先生用の使い方でも「言葉で探す」が使え、言葉に印が付く（「反映 されない」→ 保存と反映）', adminFound.first === '保存と反映（学生に届くまで）' && adminFound.marks.includes('反映'), JSON.stringify(adminFound))
  await page.evaluate(() => document.querySelector('.help-dock .help-results button').click())
  await page.waitForSelector('.help-dock .help-topic')
  // 写真は遅れて読み込まれる（loading="lazy"。2秒ほどかかることがある）
  await page.waitForFunction(() => document.querySelector('.help-dock .help-shot img')?.complete && document.querySelector('.help-dock .help-shot img').naturalWidth > 0, { timeout: 8000 }).catch(() => {})
  const adminTopic = await page.evaluate(() => {
    const i = document.querySelector('.help-dock .help-shot img')
    return { title: document.querySelector('.help-dock .help-topic h3')?.textContent, img: i?.getAttribute('src'), loaded: !!i && i.complete && i.naturalWidth > 0 }
  })
  // 画面の写真は、本番（Apps Script）では学生用ツールの URL から読む。開発中は開発サーバーの public/help/ から
  check('項目を開くと、画面の写真が出る（開発中は public/help/ から）', adminTopic.title === '保存と反映（学生に届くまで）' && adminTopic.img === '/help/admin-save.jpg' && adminTopic.loaded, JSON.stringify(adminTopic))
  await page.click('.help-dock .help-close')
  check('「閉じる」で使い方の欄が閉じる', !(await page.$('.help-dock')))

  // お知らせを書いてから消すと、「保存していない変更」の帯も消える（空のお知らせと、お知らせなしは同じ）
  const firstNotice = await openNotice(page)
  await firstNotice.type('あ')
  const dirtyWhileTyped = await hasDirty()
  await firstNotice.press('Backspace')
  await sleep(200)
  check('コースのお知らせを書いてから消すと、画面の下の帯も消える', dirtyWhileTyped && !(await hasDirty()))
  // 詳細設定の数の欄は、消して打ち直せる（「0」が入って「0600」にならない）
  await nav(page, '詳細設定')
  const minChars = await page.$('#d-minChars')
  await minChars.focus()
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Control')
  await minChars.press('Backspace')
  const cleared = await minChars.evaluate((el) => el.value)
  await minChars.type('600')
  const retyped = await minChars.evaluate((el) => el.value)
  check('数の欄を消すと空のままで、打ち直すと「600」になる（「0600」にならない）', cleared === '' && retyped === '600' && !(await hasDirty()), `${JSON.stringify(cleared)} → ${retyped}`)

  // 共通の題目を変えると、見本の表紙と抄録にすぐ反映される
  await nav(page, '年度の設定')
  const title = await page.$('#y-commonTitle')
  await title.evaluate((el) => el.select())
  await title.type('卒業イベント「試験」について')
  await sleep(300)
  const text = await previewText()
  check('題目の変更が見本に反映される', (text.match(/卒業イベント「試験」について/g) ?? []).length === 2)
  check('保存していない変更があると、画面の下に帯が出る', await hasDirty())

  // 指導教員を追加する
  await nav(page, 'コース')
  const tag = await page.$('.course.open .tag-input')
  await tag.type('文化 太郎')
  await tag.press('Enter')
  await sleep(300)
  check('指導教員を追加すると見本の抄録に出る', (await previewText()).includes('文化太郎'))

  await clickButton('保存して学生に反映')
  await page.waitForFunction(() => document.querySelector('.message.ok'))
  check('公開中の年度を保存できる', await page.evaluate(() => document.querySelector('.message.ok').textContent.includes('反映')))
  const saveConfirm = dialogs.last()
  check(
    '公開中の年度の保存の確認に、何が変わるか・届くまでの時間・書き始めた学生の原稿のことが出る',
    saveConfirm.includes('・共通の題目') && saveConfirm.includes('・映画・舞台衣装デザイナー コースの指導教員') && saveConfirm.includes('1分ほどで届きます') && saveConfirm.includes('すでに書き始めた学生の原稿（書いた文章）は変わりません'),
    saveConfirm.replace(/\n/g, '⏎'),
  )

  // 下書きのひな形を編集する（前の作り方の窓。コースを開いた所の「前の作り方で直す」から。紙面で作る画面は templateMode.mjs）
  const openTemplate = (p = page) => p.evaluate(() => document.querySelector('.course.open .tpl-line .tpl-old').click())
  await openTemplate()
  await page.waitForSelector('.tpl-modal')
  const tplFoot = await page.evaluate(() => document.querySelector('.tpl-foot .hint').textContent)
  check('公開中の年度のひな形の窓の案内は、「保存して学生に反映」で届くと言う', tplFoot.includes('「保存して学生に反映」で学生のツールに届きます'), tplFoot)
  // 何も直していなければ、Esc ですぐ閉じる（確かめない）
  const before = dialogs.count()
  await page.keyboard.press('Escape')
  await sleep(200)
  check('何も直していないひな形の窓は、Esc ですぐ閉じる', !(await page.$('.tpl-modal')) && dialogs.count() === before)
  await openTemplate()
  await page.waitForSelector('.tpl-modal')
  await page.evaluate(() => document.querySelectorAll('.tpl-modal .row')[1].click())
  await clickButton('＋ 小見出し')
  await page.keyboard.type('試験の小見出し')
  await sleep(500)
  const tplPreview = await page.evaluate(() => document.querySelector('.tpl-preview iframe').contentDocument.body.innerText)
  check('ひな形の編集画面で、足した小見出しが見本にすぐ出る', tplPreview.includes('試験の小見出し'))
  await page.screenshot({ path: `${OUT}/admin-template.png` })
  // 直したあとに「×」「やめる」・Esc を押すと、消えてよいか確かめる（キャンセルなら窓は開いたまま）
  check('直しているあいだは、タブを閉じる・読み込み直すときに確かめる', await leaveGuarded())
  dialogs.answer(false)
  await page.keyboard.press('Escape')
  await sleep(200)
  const escAsked = dialogs.last()
  await clickButton('やめる')
  await sleep(200)
  await page.evaluate(() => document.querySelector('.tpl-modal .close').click())
  await sleep(200)
  dialogs.answer(true)
  check('直したひな形の窓で Esc・「やめる」・「×」を押すと確かめ、キャンセルなら閉じない', escAsked === '直した内容は反映されずに消えます。閉じますか？' && !!(await page.$('.tpl-modal')) && dialogs.count() === before + 3, escAsked)
  // 長すぎる行は、窓の中で赤く知らせ、「反映する」を押せなくする（行の番号・種類・字数を示す）
  const subheading = await page.evaluateHandle(() => [...document.querySelectorAll('.tpl-modal .row input')].find((i) => i.value === '試験の小見出し'))
  await setValue(subheading, 'あ'.repeat(101))
  await sleep(300)
  const longProblem = await page.evaluate(() => [...document.querySelectorAll('.tpl-modal .problems .error')].map((e) => e.textContent).join('|'))
  const applyDisabled = await page.evaluate(() => [...document.querySelectorAll('.tpl-foot button')].find((b) => b.textContent.includes('反映する')).disabled)
  await page.screenshot({ path: `${SHOTS}/1-template-long-row.png` })
  check('ひな形の行が長すぎると、窓の中で行と字数を示し、「反映する」を押せない', /^\d+行目の小見出し「あ+…」が長すぎます（100字まで。今は101字）$/.test(longProblem) && applyDisabled, longProblem)
  // 押せない理由は、「反映する」のとなりにも出す（mockups/v35-admin ④ 案A。行の書き出しは外した短い文。そのあいだ、下の案内は出さない）
  const footReason = () =>
    page.evaluate(() => ({
      why: document.querySelector('.tpl-foot .why > span')?.textContent ?? null,
      icon: !!document.querySelector('.tpl-foot .why svg'),
      more: document.querySelector('.tpl-foot .why .more')?.textContent ?? null,
      hint: !!document.querySelector('.tpl-foot .hint'),
      order: [...document.querySelectorAll('.tpl-foot > *')].map((e) => e.className || e.textContent.trim()).join('|'),
    }))
  const oneReason = await footReason()
  check(
    '「反映する」を押せないときは、ボタンのとなりに理由を出す（「⚠ 3行目の小見出しが長すぎます（…）」。1つだけなら「ほか○件」はなく、下の案内の代わりに出す）',
    /^\d+行目の小見出しが長すぎます（100字まで。今は101字）$/.test(oneReason.why) && oneReason.icon && oneReason.more === null && !oneReason.hint && oneReason.order === 'spacer|why|やめる|primary',
    JSON.stringify(oneReason),
  )
  // 2つ目の問題（いちばん上の大見出しを空に）：1つ目の理由と「ほか1件」。「ほか1件」を押すと、左の欄のいちばん下の一覧へ動く
  const firstRow = await page.$('.tpl-modal .row input')
  const firstRowTitle = await firstRow.evaluate((el) => el.value)
  await setValue(firstRow, '')
  await page.evaluate(() => (document.querySelector('.tpl-edit').scrollTop = 0))
  await sleep(300)
  const twoReasons = await footReason()
  await page.screenshot({ path: `${SHOTS}/9-template-foot-reason.png` })
  await page.evaluate(() => document.querySelector('.tpl-foot .why .more').click())
  await sleep(900)
  const scrolled = await page.evaluate(() => {
    const edit = document.querySelector('.tpl-edit')
    const list = document.querySelector('.tpl-modal .problems').getBoundingClientRect()
    const box = edit.getBoundingClientRect()
    return { atBottom: edit.scrollTop >= edit.scrollHeight - edit.clientHeight - 2, listVisible: list.top >= box.top && list.bottom <= box.bottom }
  })
  check(
    '2つ以上あるときは、1つ目の理由と「ほか1件」。押すと、左の欄のいちばん下の理由の一覧へ動く',
    twoReasons.why === '1行目の大見出しの名前が空です' && twoReasons.more === 'ほか1件' && scrolled.atBottom && scrolled.listVisible,
    JSON.stringify({ twoReasons, scrolled }),
  )
  await setValue(firstRow, firstRowTitle)
  await setValue(subheading, '試験の小見出し')
  await sleep(200)
  const fixedFoot = await footReason()
  check('直すと、となりの理由は消え、下の案内に戻る', fixedFoot.why === null && fixedFoot.hint, JSON.stringify(fixedFoot))
  await clickButton('反映する')
  await sleep(300)
  const summary = await page.evaluate(() => document.querySelector('.course.open .tpl-line b').textContent)
  check('反映すると、コースのひな形の要約が変わる', summary.includes('小見出し4'), summary)
  check('ひな形を反映した知らせは、公開中の年度では「保存して学生に反映」を押すと届くと言う', (await messageText()) === 'ひな形を反映しました。「保存して学生に反映」を押すと、学生のツールに届きます', await messageText())
  await clickButton('保存して学生に反映')
  await page.waitForFunction(() => document.querySelector('.message.ok')?.textContent.includes('反映'))
  check('ひな形を保存できる（確認に、ひな形はこれからコースを選ぶ学生に入ると出る）', dialogs.last().includes('・映画・舞台衣装デザイナー コースの下書きのひな形') && dialogs.last().includes('これからコースを選ぶ学生に入ります'), dialogs.last().replace(/\n/g, '⏎'))

  // 書き方のチェック（書き間違えやすい語。前の版の窓の代わりに、画面の中に。行を押すと、その行だけ直せる。mockups/v43 案B）
  await nav(page, '書き方のチェック')
  const marks = () => page.evaluate(() => [...document.querySelectorAll('.wtry mark')].map((m) => `${m.className}:${m.textContent}`).join(','))
  check('書き方のチェックの区切りに、語の一覧が並び、試しの文で、エラーと注意の語に印が付く', (await page.$$('.wtable .wrow')).length === 13 && (await marks()) === 'e:見頃,w:記事', await marks())
  await clickButton('語を足す')
  await sleep(200)
  // 空のまま「反映する」：反映しないで、直すことを示す
  await page.evaluate(() => [...document.querySelectorAll('.wedit button')].find((b) => b.textContent === '反映する').click())
  await sleep(150)
  const emptyError = await page.evaluate(() => document.querySelector('.wedit .werr')?.textContent ?? '')
  check('空の語は反映しないで、「書き間違いと正しい語の、両方を入れてください」と出す', emptyError === '書き間違いと正しい語の、両方を入れてください' && (await page.$$('.wtable .wrow')).length === 13, emptyError)
  const [wrongIn, rightIn] = await page.$$('.wedit .g3 input')
  await wrongIn.type('芯地(仮)')
  await rightIn.type('芯地')
  const trial = await page.$('.wtry input')
  await trial.evaluate((el) => el.select())
  await trial.type('前見頃に芯地(仮)を貼った。')
  await sleep(200)
  check('足している語（記号を含む）も、「反映する」の前から、試しの文で印が付く', (await marks()) === 'e:見頃,e:芯地(仮)', await marks())
  await page.screenshot({ path: `${OUT}/admin-words.png` })
  // 反映していない語があるまま、ほかの区切りに移ると確かめる（キャンセルなら移らない）
  check('足している語は、タブを閉じる・読み込み直すときにも確かめる', await leaveGuarded())
  dialogs.answer(false)
  await nav(page, '年度の設定')
  dialogs.answer(true)
  check('反映していない語があるまま、ほかの区切りに移ると確かめる（キャンセルなら移らない）', dialogs.last() === '直している語は、まだ反映していません。反映せずに閉じますか？' && (await sectionTitle(page)) === '書き方のチェック（言葉）', dialogs.last())
  await page.evaluate(() => [...document.querySelectorAll('.wedit button')].find((b) => b.textContent === '反映する').click())
  await sleep(300)
  const wordsSub = () => page.evaluate(() => [...document.querySelectorAll('.side-nav button')].find((b) => b.textContent.includes('書き方のチェック')).querySelector('small').textContent)
  check('反映すると、一覧の最後に足され、左の見出しの語の数が変わる', (await wordsSub()) === '言葉 14語（エラー8）' && (await page.$$('.wtable .wrow')).length === 14, await wordsSub())
  // もう一覧にある語は、足さない
  await clickButton('語を足す')
  await sleep(150)
  const [w2, r2] = await page.$$('.wedit .g3 input')
  await w2.type('見頃')
  await r2.type('身頃')
  await page.evaluate(() => [...document.querySelectorAll('.wedit button')].find((b) => b.textContent === '反映する').click())
  await sleep(150)
  check('もう一覧にある語は、「「見頃」は、もう一覧にあります」と出して足さない', (await page.evaluate(() => document.querySelector('.wedit .werr')?.textContent)) === '「見頃」は、もう一覧にあります')
  await page.evaluate(() => [...document.querySelectorAll('.wedit button')].find((b) => b.textContent === 'やめる').click())
  await clickButton('保存して学生に反映')
  await page.waitForFunction(() => document.querySelector('.message.ok')?.textContent.includes('反映しました'))
  const savedWords = await page.evaluate(() => JSON.parse(localStorage.getItem('sotsugyo-admin-mock')).years.find((y) => y.year === 2026).config.wordChecks)
  check('書き間違えやすい語が年度の設定に保存される', savedWords?.length === 14 && savedWords.at(-1).wrong === '芯地(仮)')

  // コースのお知らせ（コースを開いた所に書く。mockups/v21 案A）
  const noticeBox = await openNotice(page)
  await noticeBox.type('管理者が書いたお知らせ')
  await clickButton('保存して学生に反映')
  await page.waitForFunction(() => document.querySelector('.message.ok')?.textContent.includes('反映しました'))
  const savedNotice = await page.evaluate(() => JSON.parse(localStorage.getItem('sotsugyo-admin-mock')).years.find((y) => y.year === 2026).config.courses[0].notice)
  check('コースに書いたお知らせが、そのコースに保存される', savedNotice === '管理者が書いたお知らせ', savedNotice)

  // 学生のドライブ保存を止める（詳細設定の区切り。Google の障害のとき。mockups/v22 ② 案B）
  const savedDriveSave = () => page.evaluate(() => JSON.parse(localStorage.getItem('sotsugyo-admin-mock')).years.find((y) => y.year === 2026).config.driveSave)
  await nav(page, '詳細設定')
  await clickButton('止める')
  const stopWarn = await page.evaluate(() => document.querySelector('.drive-switch.off .warn')?.textContent ?? '')
  await page.screenshot({ path: `${OUT}/admin-drive-switch.png` })
  await clickButton('保存して学生に反映')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('sotsugyo-admin-mock')).years.find((y) => y.year === 2026).config.driveSave === 'off', { timeout: 10000 }).catch(() => {})
  check('詳細設定で「止める」にして保存すると、学生のドライブ保存を止める設定になる（注意書きが出る）', (await savedDriveSave()) === 'off' && stopWarn.includes('ログインせずに書けます'), String(await savedDriveSave()))
  await clickButton('必須（ふだん）')
  await clickButton('保存して学生に反映')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('sotsugyo-admin-mock')).years.find((y) => y.year === 2026).config.driveSave === 'required', { timeout: 10000 }).catch(() => {})
  check('「必須」に戻して保存すると、元に戻る', (await savedDriveSave()) === 'required', String(await savedDriveSave()))

  // 作品写真のページ数の上限（詳細設定。空なら上限なし。前の版の「作品写真の上限（枚）」はなくした。mockups/v38）
  const savedPhotos = () => page.evaluate(() => JSON.parse(localStorage.getItem('sotsugyo-admin-mock')).years.find((y) => y.year === 2026).config.workPhotos)
  const pagesField = await page.evaluate(() => {
    const input = document.querySelector('#d-photoPages')
    const ctl = input?.closest('.ctl')
    return { label: ctl?.previousElementSibling?.textContent, value: input?.value, placeholder: input?.placeholder, hint: ctl?.querySelector('.hint')?.textContent, unit: ctl?.querySelector('.range')?.textContent }
  })
  check(
    '詳細設定の「分量の決まり」に「作品写真」：はじめは空（「上限なし」）で「ページまで」、「空なら上限なし（1ページに写真4枚まで）」',
    pagesField.label === '作品写真' && pagesField.value === '' && pagesField.placeholder === '上限なし' && pagesField.hint === '空なら上限なし（1ページに写真4枚まで）' && pagesField.unit === 'ページまで',
    JSON.stringify(pagesField),
  )
  const pagesInput = await page.$('#d-photoPages')
  await pagesInput.type('3')
  await clickButton('保存して学生に反映')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('sotsugyo-admin-mock')).years.find((y) => y.year === 2026).config.workPhotos?.maxPages === 3, { timeout: 10000 }).catch(() => {})
  check('「3」と入れて保存すると、ページ数の上限が3になる（枚数の上限 maxImages は残らない）', JSON.stringify(await savedPhotos()) === '{"maxPages":3}', JSON.stringify(await savedPhotos()))
  await pagesInput.evaluate((el) => el.select())
  await pagesInput.press('Backspace')
  await pagesInput.type('0')
  await sleep(200)
  const zeroProblem = await page.evaluate(() => document.querySelector('.problems')?.textContent ?? '')
  check('「0」はエラー（1以上の整数か、空）', zeroProblem.includes('作品写真のページ数の上限は、1以上の整数にしてください（空にすると上限なし）'), zeroProblem)
  await pagesInput.evaluate((el) => el.select())
  await pagesInput.press('Backspace')
  await sleep(200)
  await clickButton('保存して学生に反映')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('sotsugyo-admin-mock')).years.find((y) => y.year === 2026).config.workPhotos?.maxPages === null, { timeout: 10000 }).catch(() => {})
  check('空にして保存すると、上限なし（null）に戻る', JSON.stringify(await savedPhotos()) === '{"maxPages":null}', JSON.stringify(await savedPhotos()))

  // 先生の画面：コースと書き方のチェックだけ（mockups/v43 案B の先生の画面）
  const teacher = await context.newPage()
  const teacherDialogs = dialogLog(teacher)
  await teacher.setViewport({ width: 1440, height: 900 })
  await teacher.goto(`${APP}/admin.html?as=teacher`, { waitUntil: 'networkidle0' })
  await teacher.waitForSelector('.admin .content')
  check(
    '先生には、左の見出しが「コース」と「書き方のチェック」の2つだけの画面が出る（年度の設定・先生の登録などは出ない）',
    (await navItems(teacher)) === 'コース／お知らせ・ひな形＊|書き方のチェック／言葉 14語（エラー8）' && !(await teacher.$('#y-commonTitle')) && (await teacher.$$('.course.open .tpl-line')).length === 1,
    await navItems(teacher),
  )
  check('先生の画面にも、ソースコードの場所のリンクが出る（AGPL）', await teacher.evaluate(() => !!document.querySelector('.side-nav .source a')?.href))
  const teacherHeader = await headerItems(teacher)
  await teacher.setViewport({ width: 1280, height: 720 })
  await sleep(300)
  const teacherFit = await headerFits(teacher)
  await teacher.setViewport({ width: 1440, height: 900 })
  check(
    '先生の画面の見出しも1段（公開・新年度などはない）で、1280×720 に入る。ログイン中の人は左の下',
    teacherHeader === '卒業制作報告書 管理ページ|使い方|2026年度（公開中）|公開中|spacer|変更はありません|保存して学生に反映' && teacherFit.fits && teacherFit.mainVisible && (await teacher.evaluate(() => document.querySelector('.side-nav .me').textContent.includes('sensei@example.ac.jp（先生）'))),
    JSON.stringify({ teacherHeader, teacherFit }),
  )
  await teacher.click('.admin-header .help-open')
  await teacher.waitForSelector('.help-dock')
  const teacherHelp = await teacher.evaluate(() => ({ topics: document.querySelectorAll('.help-dock .help-list button').length, main: !!document.querySelector('.admin.help-on .content'), label: document.querySelector('.help-dock .help-title small')?.textContent ?? '', foot: document.querySelector('.help-dock .help-foot p')?.textContent ?? '' }))
  check('先生の画面にも、見出しの横に「？ 使い方」があり、右の端に先生用の使い方が出る（項目11・相談先は管理者。その分、画面を左に寄せる）', teacherHelp.topics === 11 && teacherHelp.main && teacherHelp.label === '先生用' && teacherHelp.foot.includes('管理者に相談'), JSON.stringify(teacherHelp))
  await teacher.keyboard.press('Escape')
  await teacher.waitForFunction(() => !document.querySelector('.help-dock'), { timeout: 5000 }).catch(() => {})
  check('Esc でも使い方の欄が閉じる', !(await teacher.$('.help-dock')))
  await openTemplate(teacher)
  await teacher.waitForSelector('.tpl-modal')
  await teacher.evaluate(() => [...document.querySelectorAll('.tpl-modal .row input')].at(-1).focus())
  await teacher.evaluate(() => [...document.querySelectorAll('.tpl-modal .adds button')].find((b) => b.textContent.includes('説明')).click())
  await teacher.keyboard.type('先生が足した説明')
  await teacher.evaluate(() => [...document.querySelectorAll('.tpl-foot button')].find((b) => b.textContent.includes('反映する')).click())
  await sleep(200)
  // 先生の画面でも、反映したら知らせる（公開中なので「保存して学生に反映」で届く）
  const teacherApplied = await messageText(teacher)
  await teacher.screenshot({ path: `${SHOTS}/2-teacher-applied-notice.png` })
  check('先生の画面でも、ひな形を反映すると知らせが出る（「保存して学生に反映」を押すと届く）', teacherApplied === 'ひな形を反映しました。「保存して学生に反映」を押すと、学生のツールに届きます', teacherApplied)
  // 先生もコースのお知らせを書ける
  const teacherNotice = await teacher.$('.course.open textarea.notice')
  await teacherNotice.evaluate((el) => el.select())
  await teacherNotice.type('先生が書いたお知らせ')
  // 先生も書き間違えやすい語を編集できる（足した語を消す）
  await nav(teacher, '書き方のチェック')
  await teacher.evaluate(() => [...document.querySelectorAll('.wtable .wrow')].at(-1).click())
  await sleep(150)
  await teacher.evaluate(() => [...document.querySelectorAll('.wedit button')].find((b) => b.textContent === 'この語を消す').click())
  await sleep(150)
  await nav(teacher, 'コース')
  // 長すぎるお知らせは、送る前に、本番のサーバーと同じ言葉で知らせる（保存しない）
  const setNotice = async (text) => setValue(await teacher.$('.course.open textarea.notice'), text)
  await setNotice('あ'.repeat(1200))
  await clickButton('保存して学生に反映', teacher)
  await sleep(300)
  check('先生の長すぎるお知らせは、保存せずに字数を示して知らせる', (await messageText(teacher)) === '「映画・舞台衣装デザイナー」のお知らせが長すぎます（1000字まで。今は1200字）', await messageText(teacher))
  await setNotice('先生が書いたお知らせ')
  await clickButton('保存して学生に反映', teacher)
  await teacher.waitForFunction(() => document.querySelector('.message.ok')?.textContent.startsWith('保存し'))
  const teacherConfirm = teacherDialogs.last()
  check(
    '先生の保存の確認にも、何が変わるか（ひな形・お知らせ・語）と届くまでの時間が出る',
    ['・映画・舞台衣装デザイナー コースの下書きのひな形', '・映画・舞台衣装デザイナー コースのお知らせ', '・書き間違えやすい語', '1分ほどで届きます'].every((s) => teacherConfirm.includes(s)),
    teacherConfirm.replace(/\n/g, '⏎'),
  )
  // 管理者は、先生が保存する前に開いた画面のまま保存しようとする → 先生の変更を消さないよう、保存しない。
  // 先生が保存した内容を読み込み、管理者が変えた項目（題目）だけを入れ直して見せる
  // 管理者のタブに戻る（後ろのタブのままだと、画面の更新が止まることがある）
  await page.bringToFront()
  await nav(page, '年度の設定')
  const staleTitle = await page.$('#y-commonTitle')
  await staleTitle.type('（古い画面）')
  await clickButton('保存して学生に反映')
  await sleep(500)
  await page.waitForFunction(() => document.querySelector('.message.ng'))
  const staleMessage = await page.$eval('.message.ng', (e) => e.textContent)
  check('先生が保存したあとに、古い画面のまま管理者が保存しようとすると、保存せずに知らせる', staleMessage.includes('ほかの人（sensei@example.ac.jp）'), staleMessage)
  const mergedTitle = await page.evaluate(() => document.querySelector('#y-commonTitle').value)
  await page.screenshot({ path: `${SHOTS}/3-other-person-saved.png` })
  const mergedNotice = await (await openNotice(page)).evaluate((el) => el.value)
  check(
    'そのとき、先生が保存した内容を読み込み、管理者の変更（題目）を入れ直す（保存はしない）',
    staleMessage.includes('あなたの変更（共通の題目）を入れ直しました') && mergedTitle === '卒業イベント「試験」について（古い画面）' && mergedNotice === '先生が書いたお知らせ' && (await hasDirty()) && (await savedYear(2026)).config.commonTitle === '卒業イベント「試験」について',
    JSON.stringify({ mergedTitle, mergedNotice }),
  )
  await clickButton('保存して学生に反映')
  await page.waitForFunction(() => document.querySelector('.message.ok'))
  const mergedConfirm = dialogs.last()
  check('入れ直した内容は、もう一度押すと保存できる（確認には管理者の変更だけが出る）', mergedConfirm.includes('・共通の題目\n\n') && (await savedYear(2026)).config.commonTitle === '卒業イベント「試験」について（古い画面）', mergedConfirm.replace(/\n/g, '⏎'))
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.admin .content')
  const savedConfig = (await savedYear(2026)).config
  const saved = savedConfig.courses[0]
  check('先生が保存したひな形が、年度の設定に入る（ほかの設定は変わらない）', saved.template.some((b) => b.hint === '先生が足した説明') && saved.template.some((b) => b.title === '試験の小見出し'))
  check('先生が書いたコースのお知らせも、いっしょに保存される', saved.notice === '先生が書いたお知らせ', saved.notice)
  check('先生が編集した書き間違えやすい語も、いっしょに保存される', savedConfig.wordChecks.length === 13 && !savedConfig.wordChecks.some((w) => w.wrong === '芯地(仮)'))
  await teacher.close()

  // 同じ管理者が2つのタブで開いた：もう1つのタブで保存したあと、このタブで保存すると「別のタブかウィンドウで」と伝え、変更を入れ直す
  const second = await context.newPage()
  dialogLog(second)
  await second.setViewport({ width: 1440, height: 900 })
  await second.goto(`${APP}/admin.html`, { waitUntil: 'networkidle0' })
  await second.waitForSelector('.admin .content')
  const secondNotice = await openNotice(second)
  await secondNotice.evaluate((el) => el.select())
  await secondNotice.type('別のタブで書いたお知らせ')
  await clickButton('保存して学生に反映', second)
  await second.waitForFunction(() => document.querySelector('.message.ok'))
  await second.close()
  await page.bringToFront()
  await nav(page, '年度の設定')
  const firstTitle = await page.$('#y-commonTitle')
  await firstTitle.evaluate((el) => el.select())
  await firstTitle.type('卒業イベント「試験」について')
  await clickButton('保存して学生に反映')
  await page.waitForFunction(() => document.querySelector('.message.ng'))
  const tabMessage = await messageText()
  await page.screenshot({ path: `${SHOTS}/4-another-tab-saved.png` })
  const tabNotice = await (await openNotice(page)).evaluate((el) => el.value)
  check(
    '同じ人が別のタブで保存していたら「別のタブかウィンドウで」と伝え、そのタブの内容に自分の変更を入れ直す',
    tabMessage.startsWith('保存しませんでした。この画面を開いたあとに別のタブかウィンドウで、この年度の設定が保存されていたためです。') && !tabMessage.includes('ほかの人') && tabNotice === '別のタブで書いたお知らせ' && tabMessage.includes('あなたの変更（共通の題目）'),
    tabMessage,
  )
  await clickButton('保存して学生に反映')
  await page.waitForFunction(() => document.querySelector('.message.ok'))
  const both = (await savedYear(2026)).config
  check('もう一度押すと、両方の変更が保存される', both.commonTitle === '卒業イベント「試験」について' && both.courses[0].notice === '別のタブで書いたお知らせ')
  // 同じ項目（お知らせ）を両方で別の内容に変えていたら、入れ直さずに読み込み直しを頼む（どちらも消さない）
  const third = await context.newPage()
  dialogLog(third)
  await third.goto(`${APP}/admin.html`, { waitUntil: 'networkidle0' })
  await third.waitForSelector('.admin .content')
  const thirdNotice = await openNotice(third)
  await thirdNotice.evaluate((el) => el.select())
  await thirdNotice.type('3つめのタブのお知らせ')
  await clickButton('保存して学生に反映', third)
  await third.waitForFunction(() => document.querySelector('.message.ok'))
  await third.close()
  await page.bringToFront()
  const myNotice = await openNotice(page)
  await myNotice.evaluate((el) => el.select())
  await myNotice.type('このタブのお知らせ')
  await clickButton('保存して学生に反映')
  await page.waitForFunction(() => document.querySelector('.message.ng'))
  const conflictMessage = await messageText()
  check(
    '同じ項目を両方で別の内容に変えていたら、入れ直さずに読み込み直しを頼む（どちらも消さない）',
    conflictMessage.includes('同じ項目（映画・舞台衣装デザイナー コースのお知らせ）がそちらでも変わっているため、自動では入れ直せません') && (await savedYear(2026)).config.courses[0].notice === '3つめのタブのお知らせ' && (await myNotice.evaluate((el) => el.value)) === 'このタブのお知らせ',
    conflictMessage,
  )
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.admin .content')
  check('読み込み直すと、さっきの区切り（コース）のまま開く（区切りは、このタブのあいだ覚えておく）', (await sectionTitle(page)) === 'コース' && (await navItems(page)).includes('コース／お知らせ・ひな形＊'))
  await nav(page, '年度の設定')

  // 新年度を作る → 準備中 → 公開
  // 保存していない変更があるときは、確かめる（新年度は保存されている内容からコピーするため）
  await (await page.$('#y-commonTitle')).type('（保存しない）')
  const newYearButton = () => page.evaluate(() => document.querySelector('.next-year .btn').click())
  check('「年度の設定」の「次の年度」に、新しい年度の数と「新年度を作成」', (await page.evaluate(() => document.querySelector('.next-year').textContent)).includes('この年度の設定をコピーして、2027年度を作ります。公開するまで、学生には見えません。'))
  dialogs.answer(false)
  await newYearButton()
  dialogs.answer(true)
  await sleep(200)
  check('保存していない変更があるときに「新年度を作成」を押すと確かめる（キャンセルなら作らない）', dialogs.last().startsWith('保存していない変更があります。新年度は保存されている内容からコピーして作るため') && !(await page.$('.modal')), dialogs.last())
  await newYearButton()
  await page.waitForSelector('.modal')
  const newYearLead = await page.evaluate(() => document.querySelector('.modal .lead').textContent)
  check('新年度の窓は、保存されている設定をコピーすると言う', newYearLead.startsWith('2026年度の、保存されている設定をコピーして'), newYearLead)
  // 全角の数字で打っても受け付ける
  const yearInput = await page.$('.modal input')
  await yearInput.evaluate((el) => el.select())
  await yearInput.type('２０２７')
  const typedYear = await yearInput.evaluate((el) => el.value)
  check('新しい年度の欄は、全角の数字（２０２７）も受け付ける', typedYear === '２０２７' && (await page.evaluate(() => ![...document.querySelectorAll('.modal button')].find((b) => b.textContent === '作成する').disabled)), typedYear)
  await clickButton('作成する')
  await page.waitForFunction(() => document.querySelector('.badge.draft')?.textContent === '準備中')
  check('新年度（2027年度）が準備中で作られる', await page.evaluate(() => document.querySelector('.sel').value === '2027'))
  check('新年度は前の年度の内容を引き継ぐ（保存していない変更は入らない）', (await previewText()).includes('卒業イベント「試験」について') && !(await previewText()).includes('保存しない') && (await previewText()).includes('２０２７年度'))
  const createdNotice = await messageText()
  const problemsText = await page.evaluate(() => document.querySelector('.problems')?.textContent ?? '')
  await page.screenshot({ path: `${SHOTS}/5-new-year-notice.png` })
  check(
    '新年度を作ると、前の年度のままの項目（題目・締切・お知らせ）を知らせる',
    createdNotice.startsWith('2027年度を作成しました（2026年度の設定のコピーです）。次の項目は2026年度のままです。') && createdNotice.includes('最終締切（2027年1月20日（水）。2026年度と同じ日付）') && createdNotice.includes('お知らせ（映画・舞台衣装デザイナー コース）'),
    createdNotice,
  )
  // 知らせは、同じ緑の枠のまま箇条書き。項目ごとに、直す場所（左の見出しの区切りと欄の名前）を小さな字で添える
  const noticeList = await page.evaluate(() => {
    const box = document.querySelector('.content .message.ok.list')
    return {
      head: box?.querySelector('.h')?.textContent,
      detail: box?.querySelector('p')?.textContent,
      items: [...(box?.querySelectorAll('li') ?? [])].map((li) => `${li.firstChild?.textContent}／${li.querySelector('small')?.textContent}`),
    }
  })
  check(
    '新年度の知らせは箇条書きで、項目ごとに「場所：…」を添える（左の見出しの区切りと、欄の名前）',
    noticeList.head === '2027年度を作成しました（2026年度の設定のコピーです）。' &&
      noticeList.detail === '次の項目は2026年度のままです。確かめて直してください。' &&
      noticeList.items.join('|') === '共通の題目／場所：「年度の設定」の「共通の題目」|最終締切（2027年1月20日（水）。2026年度と同じ日付）／場所：「年度の設定」の「最終締切」|お知らせ（映画・舞台衣装デザイナー コース）／場所：「コース」で、コースを開いた所の「お知らせ」',
    JSON.stringify(noticeList),
  )
  check('前の年度の締切のままなら、年度の期間の外だと確認が出る', problemsText.includes('確認：最終締切（2027年1月20日）が、2027年度（2027年4月1日〜2028年3月31日）の外です'), problemsText)
  check('作ったばかりの準備中の年度には、「年度の設定」に新年度の手順と、「この年度を削除」が出る', !!(await page.$('.steps-card')) && !!(await page.$('.delete-year')))
  await page.screenshot({ path: `${OUT}/admin-2027.png` })
  // 準備中の年度では、ひな形の窓の案内も「公開してから届く」と言う
  await nav(page, 'コース')
  await openTemplate()
  await page.waitForSelector('.tpl-modal')
  const draftFoot = await page.evaluate(() => document.querySelector('.tpl-foot .hint').textContent)
  await page.keyboard.press('Escape')
  await sleep(200)
  check('準備中の年度のひな形の窓は、学生に届くのは公開してからだと言う', draftFoot === '「反映する」の後、「保存」で保存します。学生に届くのは、この年度を学生に公開してからです。' && !(await page.$('.tpl-modal')), draftFoot)
  await nav(page, '年度の設定')
  // 締切の日付の欄：年は4桁まで（「20280119」と打つと 2028-01-19 になる。年が6桁にならない）
  const dateInput = await page.$('#y-deadline')
  await dateInput.click({ offset: { x: 12, y: 10 } })
  await page.keyboard.type('20280119')
  await sleep(300)
  const typedDate = await dateInput.evaluate((el) => el.value)
  const afterDate = await page.evaluate(() => document.querySelector('.problems')?.textContent ?? '')
  check('締切の欄に「20280119」と打つと 2028-01-19 になり、期間の外の確認も消える', typedDate === '2028-01-19' && !afterDate.includes('最終締切'), `${typedDate} / ${afterDate}`)
  // ノートパソコンの画面（1280×720）でも、保存していない変更があるまま、見出しが横にはみ出さず、「この年度を学生に公開」が見える
  await page.setViewport({ width: 1280, height: 720 })
  await sleep(400)
  const fit1280 = await headerFits()
  await page.screenshot({ path: `${SHOTS}/10-header-1280.png` })
  await page.setViewport({ width: 1440, height: 900 })
  await sleep(400)
  const fit1440 = await headerFits()
  check(
    '1280×720 と 1440×900 で、保存していない変更があっても見出しが横にはみ出さず、「この年度を学生に公開」が見える',
    (await hasDirty()) && fit1280.fits && fit1280.mainVisible && fit1280.main === 'この年度を学生に公開' && fit1440.fits && fit1440.mainVisible,
    JSON.stringify({ fit1280, fit1440 }),
  )
  await clickButton('保存')
  await page.waitForFunction(() => document.querySelector('.message.ok')?.textContent.startsWith('保存しました'))
  check('準備中の年度は確かめずに保存し、学生に届くのは公開してからだと知らせる', (await messageText()) === '保存しました（学生に届くのは、「この年度を学生に公開」を押してからです）', await messageText())
  await clickButton('この年度を学生に公開')
  await page.waitForFunction(() => document.querySelector('.badge.pub')?.textContent === '公開中')
  const publishConfirm = dialogs.last()
  check(
    '公開の確認に、題目・締切・コースごとの指導教員と、学生がどうなるかが出る',
    ['共通の題目：卒業イベント「試験」について', '最終締切：2028年1月19日（水）', '・映画・舞台衣装デザイナー コース：', '・まだ書き始めていない学生は、2027年度の設定で書き始めます。', '・すでに書き始めた学生は、書き始めた年度の設定のままです。', '・今公開中の2026年度は「終了」になります。'].every((s) => publishConfirm.includes(s)),
    publishConfirm.replace(/\n/g, '⏎'),
  )
  const options = await page.evaluate(() => [...document.querySelectorAll('.sel option')].map((o) => o.textContent))
  check('公開すると前の年度は「終了」になり、新年度の手順は出なくなる', options.join(',') === '2027年度（公開中）,2026年度（終了）' && !(await page.$('.steps-card')), options.join(','))

  // 先生の登録（左の見出しの区切り。メーリングリストの宛先をまとめて貼り付ける。mockups/v20 案3）
  await nav(page, '先生の登録')
  await page.waitForSelector('.member-list li')
  const box = await page.$('.member-add textarea')
  await box.type('文化 太郎 <t-bunka@bunka-wu.ac.jp>, "衣装 花子" <h-isho@bunka-wu.ac.jp>;\n00zz901@bunka-wu.ac.jp, someone@gmail.com')
  await page.waitForSelector('.bulk-table tbody tr')
  const read = await page.evaluate(() => [...document.querySelectorAll('.bulk-table tbody tr')].map((tr) => `${tr.className}:${tr.querySelector('.st').textContent}`))
  check(
    '貼り付けると、名前とアドレスを読み取り、学生・大学外のアドレスは登録しないと示す（登録できるドメインを示す）',
    read.join(',') === 'ok:新しく登録,ok:新しく登録,ng:学生のアドレスのため登録しない,ng:大学のアドレス（@bunka-wu.ac.jp。試験用サーバーでは @example.ac.jp も）だけ登録できます',
    read.join(','),
  )
  await page.screenshot({ path: `${OUT}/admin-members.png` })
  await page.screenshot({ path: `${SHOTS}/6-members-domain.png` })
  // 入力したまま、ほかの区切りに移ろうとすると、消えてよいか確かめる（キャンセルなら移らない）
  dialogs.answer(false)
  await nav(page, '年度の設定')
  dialogs.answer(true)
  check('登録の欄に入力したまま、ほかの区切りに移ろうとすると確かめ、キャンセルなら移らない（入力も残る）', dialogs.last().startsWith('登録の欄に入力したメールアドレスは、まだ登録していません') && (await sectionTitle(page)) === '先生の登録' && (await box.evaluate((el) => el.value)).includes('someone@gmail.com'))
  await clickButton('2人を登録する')
  await page.waitForFunction(() => document.querySelectorAll('.member-list li').length >= 4 && !document.querySelector('.bulk-table'))
  const registered = await page.evaluate(() => [...document.querySelectorAll('.member-list li .who')].map((w) => w.textContent))
  check('「2人を登録する」で、名前をメモにして先生として登録される（左の見出しの人数も変わる）', registered.some((w) => w.includes('t-bunka@bunka-wu.ac.jp') && w.includes('文化 太郎')) && registered.some((w) => w.includes('h-isho@bunka-wu.ac.jp')) && !registered.some((w) => w.includes('00zz901')) && (await navItems(page)).includes('先生の登録／4人'))
  // 試験用サーバーでは、試験用の先生と同じ example.ac.jp のアドレスも登録できる
  await box.type('tester@example.ac.jp')
  await clickButton('登録する')
  await page.waitForFunction(() => [...document.querySelectorAll('.member-list li .who')].some((w) => w.textContent.includes('tester@example.ac.jp')))
  check('試験用サーバーでは、example.ac.jp のアドレスも登録できる', true)
  // 役割を変えるときは確かめ、変えたら知らせる。管理者が1人だけになるときは、2人以上にするよう伝える
  const roleSelect = (email) => page.evaluateHandle((email) => [...document.querySelectorAll('.member-list li')].find((li) => li.textContent.includes(email)).querySelector('select'), email)
  await (await roleSelect('tester@example.ac.jp')).select('管理者')
  await page.waitForFunction(() => document.querySelector('.members .member-info.ok'))
  const promoted = dialogs.last()
  const promotedInfo = await page.$eval('.members .member-info.ok', (e) => e.textContent)
  check('役割を「管理者」にするときは確かめ、変えたら知らせる', promoted.startsWith('tester@example.ac.jp を「管理者」にしますか？') && !promoted.includes('1人だけ') && promotedInfo.startsWith('tester@example.ac.jp を「管理者」にしました'), promotedInfo)
  dialogs.answer(false)
  await (await roleSelect('tester@example.ac.jp')).select('先生')
  await sleep(500)
  dialogs.answer(true)
  const demoteAsked = dialogs.last()
  const stillAdmin = await (await roleSelect('tester@example.ac.jp')).evaluate((el) => el.value)
  await page.screenshot({ path: `${SHOTS}/7-members-role-info.png` })
  check('管理者を先生にして管理者が1人だけになるときは、2人以上にするよう伝える（キャンセルなら変えない）', demoteAsked.includes('管理者が1人だけになります') && stillAdmin === '管理者', demoteAsked.replace(/\n/g, '⏎'))
  const savedRole = await page.evaluate(() => JSON.parse(localStorage.getItem('sotsugyo-admin-mock')).members.find((m) => m.email === 'tester@example.ac.jp').role)
  check('キャンセルした役割の変更は保存されない', savedRole === '管理者', savedRole)
  const membersLead = await page.evaluate(() => document.querySelector('.members .sec-lead').textContent)
  check('先生ができることの説明に、お知らせも入っている', membersLead.includes('「下書きのひな形」「お知らせ」と「書き間違えやすい語」を編集できます'), membersLead)

  // 変更履歴（左の見出しの区切り）
  await nav(page, '変更履歴')
  await page.waitForSelector('.history li')
  const history = await page.evaluate(() => [...document.querySelectorAll('.history li')].map((li) => li.textContent))
  check('変更履歴に操作が残る', history.some((h) => h.includes('公開')) && history.some((h) => h.includes('コピーして作成')), `${history.length}件`)
  await page.screenshot({ path: `${SHOTS}/8-history-summary.png` })
  check('変更履歴の行に、1つ前の記録から何が変わったかが出る', history.some((h) => h.includes('保存') && h.includes('変更：最終締切')), history.join(' | '))
  // 保存していない変更があるときに「この内容を読み込む」を押すと確かめる（キャンセルなら読み込まない）
  await nav(page, '年度の設定')
  const titleNow = await page.$('#y-commonTitle')
  await titleNow.type('（書きかけ）')
  await nav(page, '変更履歴')
  await page.waitForSelector('.history li')
  dialogs.answer(false)
  await page.evaluate(() => [...document.querySelectorAll('.history li button')].at(-1).click())
  await sleep(200)
  dialogs.answer(true)
  await nav(page, '年度の設定')
  check('保存していない変更があるときに「この内容を読み込む」を押すと確かめる（キャンセルなら読み込まない）', dialogs.last() === '保存していない変更があります。破棄して、この時点の内容を読み込みますか？' && (await page.$eval('#y-commonTitle', (el) => el.value)).endsWith('（書きかけ）'))

  // 間違えて作った準備中の年度は削除できる（「年度の設定」のいちばん下の「この年度を削除」。一度も公開していない年度だけ）
  check('公開した年度（2027年度・公開中）には「この年度を削除」が出ない', !(await page.$('.delete-year')))
  // 間違えて 2028年度を作った（保存していない「（書きかけ）」は、確かめて破棄する）
  await newYearButton()
  await page.waitForSelector('.modal')
  await clickButton('作成する')
  await page.waitForFunction(() => document.querySelector('.admin-header .sel').value === '2028' && document.querySelector('.badge.draft'))
  check('作った準備中の年度（2028年度）には「この年度を削除」が出る', !!(await page.$('.delete-year')))
  await (await page.$('#y-commonTitle')).type('（消す年度）')
  const clickDelete = () => page.evaluate(() => document.querySelector('.delete-year .btn').click())
  // 保存していない変更があるときは、年度を切り替えるときと同じく先に確かめる（キャンセルなら何もしない）
  dialogs.answer(false)
  await clickDelete()
  await sleep(300)
  dialogs.answer(true)
  check(
    '保存していない変更があるときに「この年度を削除」を押すと、先に確かめる（キャンセルなら何もしない）',
    dialogs.last() === '保存していない変更があります。破棄して、この年度の削除に進みますか？' && !!(await savedYear(2028)) && (await hasDirty()),
    dialogs.last(),
  )
  // 削除の確かめ（消える内容・学生のツールは変わらない・削除したあとに開く年度）。キャンセルなら何も変わらない
  dialogs.answerNext(true, false)
  await clickDelete()
  await sleep(300)
  const deleteConfirm = dialogs.last()
  check(
    '削除の前に、消える内容と、削除したあとに開く年度（公開中の2027年度）を示して確かめる（キャンセルなら消さない）',
    deleteConfirm ===
      '2028年度（準備中）を削除しますか？\n\n・この年度の設定（共通の題目・締切・コース・ひな形・お知らせなど）が、すべて消えます。元には戻せません。\n・まだ学生に公開していないので、学生のツールは変わりません。\n・削除したあとは、2027年度（公開中）を開きます。' &&
      !!(await savedYear(2028)) &&
      (await page.evaluate(() => document.querySelector('.admin-header .sel').value)) === '2028',
    deleteConfirm.replace(/\n/g, '⏎'),
  )
  // 「OK」：消して、公開中の年度を開き、緑の知らせを出す
  await clickDelete()
  await page.waitForFunction(() => document.querySelector('.message.ok')?.textContent.includes('削除しました'))
  const afterDelete = await page.evaluate(() => ({
    year: document.querySelector('.admin-header .sel').value,
    options: [...document.querySelectorAll('.admin-header .sel option')].map((o) => o.textContent).join(','),
  }))
  await page.screenshot({ path: `${SHOTS}/11-year-deleted.png` })
  const deletedHistory = await page.evaluate(async () => (await window.__adminServer.getHistory(2028)).map((h) => h.action))
  check(
    '「OK」で削除し、公開中の年度（2027年度）を開いて知らせる（変更履歴に「削除」が残る。保存していない変更は破棄）',
    (await messageText()) === '2028年度を削除しました。いまは2027年度（公開中）を開いています。' &&
      afterDelete.year === '2027' &&
      afterDelete.options === '2027年度（公開中）,2026年度（終了）' &&
      !(await savedYear(2028)) &&
      deletedHistory[0] === '削除' &&
      !(await hasDirty()) &&
      !(await page.$('.delete-year')),
    `${await messageText()} / ${JSON.stringify(afterDelete)} / ${deletedHistory.join(',')}`,
  )
  // 画面では押せないが、サーバーも、公開した年度の削除は断る
  const refused = await page.evaluate(() =>
    window.__adminServer.deleteYear(2027).then(
      () => 'deleted',
      (e) => e.message,
    ),
  )
  check('公開した年度は、サーバーでも削除できない', refused.includes('学生に公開したことがあるため削除できません'), refused)

  // 終了した年度（その年度に書き始めた学生が今も読む）を保存するときも確かめる
  await page.evaluate(() => {
    const sel = document.querySelector('.admin-header .sel')
    sel.value = '2026'
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForFunction(() => document.querySelector('.badge.old')?.textContent === '終了')
  const endedNotice = await openNotice(page)
  await endedNotice.evaluate((el) => el.select())
  await endedNotice.type('終了した年度のお知らせ')
  await sleep(200)
  const endedBar = await page.evaluate(() => document.querySelector('.dirty-bar .tx b')?.textContent ?? '')
  await clickButton('保存')
  await page.waitForFunction(() => document.querySelector('.message.ok')?.textContent.startsWith('保存しました'))
  const endedConfirm = dialogs.last()
  check(
    '終了した年度の保存も確かめる（その年度に書き始めた学生のツールに届くと言う。帯は「まだ学生に届いていない変更」）',
    endedConfirm.startsWith('2026年度は「終了」した年度ですが、この年度に書き始めた学生は、今もこの設定を使っています。') && endedConfirm.includes('・映画・舞台衣装デザイナー コースのお知らせ') && endedBar === 'まだ学生に届いていない変更が1か所あります',
    `${endedConfirm.replace(/\n/g, '⏎')} / ${endedBar}`,
  )
  check('終了した年度を保存した知らせも、その年度に書き始めた学生に届くと言う', (await messageText()) === '保存しました（この年度に書き始めた学生のツールに、1分ほどで届きます）', await messageText())
  // 最後に開いた年度を覚えていて、開き直すとその年度から
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.admin .content')
  check('開き直すと、最後に見ていた年度（2026年度・終了）から開く', await page.evaluate(() => document.querySelector('.admin-header .sel').value === '2026' && document.querySelector('.badge.old')?.textContent === '終了'))
  await context.close()

  // ==== 先生のお試しのあとの直し（コース名の「コース」・サブタイトルの「―」・お知らせの案内・ドラッグで並べ替え・中身の幅・「止める」） ====
  // 新しい入れ物（試験用サーバーは最初の状態から）で、ノートパソコンの画面（1366×768）で確かめる
  const fixes = await browser.createBrowserContext()
  const fx = await fixes.newPage()
  fx.on('pageerror', (e) => console.log('pageerror:', e.message))
  const fxDialogs = dialogLog(fx)
  await fx.setViewport({ width: 1366, height: 768 })
  await fx.goto(`${APP}/admin.html`, { waitUntil: 'networkidle0' })
  await fx.waitForSelector('.admin .content')
  const fxSaved = () => fx.evaluate(() => JSON.parse(localStorage.getItem('sotsugyo-admin-mock')).years.find((y) => y.year === 2026).config)
  const fxDirty = () => fx.evaluate(() => !!document.querySelector('.dirty-bar'))
  const fxClick = (text) => fx.evaluate((text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text)).click(), text)
  const fxSave = async () => {
    await fxClick('保存して学生に反映')
    await fx.waitForFunction(() => document.querySelector('.message.ok'), { timeout: 10000 })
  }
  await nav(fx, 'コース')
  const openCard = '.course.open'

  // ---- 1. コース名：欄の外の右に「コース」。名前の最後に「コース」があると、やさしく知らせる（名前は変えない） ----
  const nameBox = await fx.evaluate((sel) => {
    const card = document.querySelector(sel)
    const input = card.querySelector('.in.name')
    const a = input.getBoundingClientRect()
    const suffix = card.querySelector('.name-box .suffix')
    const r = suffix.getBoundingClientRect()
    return { text: suffix.textContent, placeholder: input.placeholder, value: input.value, gap: Math.round(r.left - a.right), middle: Math.abs((r.top + r.bottom) / 2 - (a.top + a.bottom) / 2) < 3, warn: !!card.querySelector('.name-warn') }
  }, openCard)
  check(
    'コース名の欄の外の右に「コース」が付く（欄の見本の字は「コース名」。名前には「コース」を付けない）',
    nameBox.text === 'コース' && nameBox.placeholder === 'コース名' && nameBox.value === '映画・舞台衣装デザイナー' && nameBox.gap >= 0 && nameBox.gap <= 10 && nameBox.middle && !nameBox.warn,
    JSON.stringify(nameBox),
  )
  const nameInput = await fx.$(`${openCard} .in.name`)
  await nameInput.focus()
  await fx.keyboard.press('End')
  await nameInput.type('コース')
  await sleep(300)
  const warned = await fx.evaluate((sel) => {
    const card = document.querySelector(sel)
    const w = card.querySelector('.name-warn')
    return {
      text: w?.textContent ?? null,
      described: !!w && card.querySelector('.in.name').getAttribute('aria-describedby') === w.id,
      cover: document.querySelector('.preview iframe').contentDocument.querySelector('.cover .course')?.textContent ?? '',
    }
  }, openCard)
  await fx.screenshot({ path: `${SHOTS}/12-course-name-suffix.png` })
  check(
    '名前の最後に「コース」があると、「名前の最後の「コース」は消してください（表紙では自動で付きます）」と知らせる（名前は勝手に変えない）',
    warned.text === '名前の最後の「コース」は消してください（表紙では自動で付きます）' && warned.described && warned.cover === '映画・舞台衣装デザイナーコース コース',
    JSON.stringify(warned),
  )
  const staticLonely = await lonelyAtWidths(fx, '.content')
  check('新しい字（「コース」・知らせ・例・お知らせの案内）は、1280・1366・1920 の幅で1字だけ次の行に残らない', staticLonely.length === 0, staticLonely.join(' / '))
  await nameInput.focus()
  await fx.keyboard.press('End')
  for (let i = 0; i < 3; i++) await fx.keyboard.press('Backspace')
  await sleep(200)
  check('「コース」を消すと、知らせも画面の下の帯も消える', !(await fx.$('.course .name-warn')) && !(await fxDirty()))

  // ---- 2. サブタイトルの形式：前後の「―」は欄の外の固定の印。保存する形式には、いつも前後に「―」が付く ----
  const subtitleRow = () =>
    fx.evaluate((sel) => {
      const card = document.querySelector(sel)
      return {
        parts: [...card.querySelectorAll('.template > *')].map((e) => (e.tagName === 'INPUT' ? `[${e.value}]` : e.className === 'slot' ? '〔学生が入力〕' : e.textContent)).join(''),
        hint: card.querySelector('.template').closest('.ctl').querySelector('.example').textContent,
        cover: document.querySelector('.preview iframe').contentDocument.querySelector('.cover .subtitle')?.textContent ?? '',
      }
    }, openCard)
  const row0 = await subtitleRow()
  check(
    'サブタイトルの形式は「―」［前］〔学生が入力〕［後ろ］「―」の並び。今の形式（―{input}の衣装制作―）は、欄に「―」を入れずに出る（例・見本にも「―」）',
    row0.parts === '―[]〔学生が入力〕[の衣装制作]―' && row0.hint === '例：―シンドバッドの衣装制作―' && row0.cover === '―の衣装制作―',
    JSON.stringify(row0),
  )
  const [beforeIn, afterIn] = await fx.$$(`${openCard} .template input`)
  await beforeIn.type('x')
  const typedDirty = await fxDirty()
  await beforeIn.press('Backspace')
  await sleep(200)
  check('前の欄に書いて消すと、画面の下の帯も消える（開いて保存するだけでは、形式は変わらない）', typedDirty && !(await fxDirty()))
  await afterIn.click({ count: 3 })
  await afterIn.type('の衣装デザイン')
  await sleep(300)
  const row1 = await subtitleRow()
  await fx.evaluate(() => document.querySelector('.course.open .template').scrollIntoView({ block: 'center' }))
  await sleep(200)
  await fx.screenshot({ path: `${SHOTS}/13-subtitle-dashes.png` })
  await fxSave()
  const savedTemplate = (await fxSaved()).courses[0].subtitleTemplate
  check(
    '後ろの欄を「の衣装デザイン」にすると、例・見本は「―…の衣装デザイン―」になり、「―{input}の衣装デザイン―」で保存される（確認にサブタイトルの形式が出る）',
    row1.parts === '―[]〔学生が入力〕[の衣装デザイン]―' && row1.hint === '例：―シンドバッドの衣装デザイン―' && row1.cover === '―の衣装デザイン―' && savedTemplate === '―{input}の衣装デザイン―' && fxDialogs.last().includes('・映画・舞台衣装デザイナー コースのサブタイトルの形式'),
    `${JSON.stringify(row1)} / ${savedTemplate}`,
  )
  // 前に保存した形式（線を「—」で書いていた）も、線を外して欄に出る。開いただけでは変更にならない
  const setStoredTemplate = (template) =>
    fx.evaluate((template) => {
      const store = JSON.parse(localStorage.getItem('sotsugyo-admin-mock'))
      store.years[0].config.courses[0].subtitleTemplate = template
      localStorage.setItem('sotsugyo-admin-mock', JSON.stringify(store))
    }, template)
  await setStoredTemplate('—卒業制作「{input}」—')
  await fx.reload({ waitUntil: 'networkidle0' })
  await fx.waitForSelector('.admin .content')
  const legacy = await subtitleRow()
  check(
    '前の形式（—卒業制作「{input}」—）も、前後の線を外して［卒業制作「］〔学生が入力〕［」］と出る（開いただけでは変更にならない）',
    legacy.parts === '―[卒業制作「]〔学生が入力〕[」]―' && !(await fxDirty()),
    JSON.stringify(legacy),
  )
  await setStoredTemplate('―{input}の衣装制作―')
  await fx.reload({ waitUntil: 'networkidle0' })
  await fx.waitForSelector('.admin .content')

  // ---- 3. お知らせの欄の案内は、どこに出るかだけ（管理者・先生の画面とも） ----
  const NOTICE_HINT = 'このコースの学生のツールの、セルフチェック欄の上に表示されます。'
  const noticeHints = (p) => p.evaluate(() => [...document.querySelectorAll('.course.open textarea.notice')].map((t) => t.closest('.ctl').querySelector('.hint').textContent))
  const adminHint = await noticeHints(fx)
  await fx.evaluate(() => document.querySelector('.course.open textarea.notice').scrollIntoView({ block: 'center' }))
  await sleep(200)
  await fx.screenshot({ path: `${SHOTS}/14-notice-hint.png` })
  const teacherFx = await fixes.newPage()
  dialogLog(teacherFx)
  await teacherFx.setViewport({ width: 1366, height: 768 })
  await teacherFx.goto(`${APP}/admin.html?as=teacher`, { waitUntil: 'networkidle0' })
  await teacherFx.waitForSelector('.admin .content')
  const teacherHint = await noticeHints(teacherFx)
  const teacherLonely = await lonelyAtWidths(teacherFx)
  await teacherFx.close()
  check(
    'お知らせの欄の案内は「このコースの学生のツールの、セルフチェック欄の上に表示されます。」だけ（管理者・先生の画面とも。1字だけ次の行に残らない）',
    adminHint.length === 1 && adminHint[0] === NOTICE_HINT && teacherHint.length === 1 && teacherHint[0] === NOTICE_HINT && teacherLonely.length === 0,
    JSON.stringify({ adminHint, teacherHint, teacherLonely }),
  )

  // ---- 4. コースの並べ替え：「↑ 上へ」「↓ 下へ」はなくし、左上のつまみ（⋮⋮）をつかんで動かす ----
  const gripInfo = await fx.evaluate(() => {
    const card = document.querySelector('.course-list > .course')
    const g = card.querySelector('.crow > .grip:first-child')
    const a = card.getBoundingClientRect()
    const r = g.getBoundingClientRect()
    return {
      arrows: [...document.querySelectorAll('.course button')].some((b) => /上へ|下へ|↑|↓/.test(b.textContent)),
      text: g.textContent,
      label: g.getAttribute('aria-label'),
      tag: g.tagName,
      dx: Math.round(r.left - a.left),
      dy: Math.round(r.top - a.top),
      cursor: getComputedStyle(g).cursor,
      touch: getComputedStyle(g).touchAction,
    }
  })
  check(
    'コースに「↑ 上へ」「↓ 下へ」はなく、左上につまみ「⋮⋮」（ボタン。名前は「並べ替え（矢印キーで動かす）」）がある',
    !gripInfo.arrows && gripInfo.text === '⋮⋮' && gripInfo.label === '並べ替え（矢印キーで動かす）' && gripInfo.tag === 'BUTTON' && gripInfo.dx < 24 && gripInfo.dy < 24 && gripInfo.cursor === 'grab' && gripInfo.touch === 'none',
    JSON.stringify(gripInfo),
  )
  const A = '映画・舞台衣装デザイナー'
  const B = '試験二'
  const C = '試験三'
  for (const name of [B, C]) {
    await fx.evaluate(() => [...document.querySelectorAll('.content button.add')].find((b) => b.textContent.includes('コースを追加')).click())
    await sleep(200)
    await fx.type('.course.open .in.name', name)
  }
  const courseNames = () => fx.evaluate(() => [...document.querySelectorAll('.course-list > .course .cname')].map((e) => e.textContent.replace(/ コース$/, '')).join('|'))
  check('「コースを追加」で足したコースは、開いた形で一覧の最後に入る（ほかのコースは閉じる）', (await courseNames()) === `${A}|${B}|${C}` && (await fx.$$('.course.open')).length === 1 && (await fx.evaluate(() => document.querySelector('.course.open .cname').textContent)) === `${C} コース`, await courseNames())
  const cardBox = (i, sel) =>
    fx.evaluate(
      (i, sel) => {
        const card = document.querySelectorAll('.course-list > .course')[i]
        const r = (sel ? card.querySelector(sel) : card).getBoundingClientRect()
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, top: r.top, bottom: r.bottom }
      },
      i,
      sel,
    )
  const live = () => fx.evaluate(() => document.querySelector('.content .sr-only[aria-live]').textContent.replace(/​/g, ''))
  // マウス：いちばん下（試験三。開いている）のつまみをつかんで、2番目のコースの上半分まで動かす
  await fx.evaluate(() => (document.querySelector('.content').scrollTop = 0))
  await sleep(200)
  const gripC = await cardBox(2, '.grip')
  const cardB = await cardBox(1)
  await fx.mouse.move(gripC.x, gripC.y)
  await fx.mouse.down()
  await fx.mouse.move(gripC.x, cardB.top + 10, { steps: 12 })
  await sleep(200)
  const midDrag = await fx.evaluate(() => {
    const line = document.querySelector('.course-list > .drop-line')
    const cards = [...document.querySelectorAll('.course-list > .course')]
    return {
      line: line ? Math.round(line.getBoundingClientRect().top + line.getBoundingClientRect().height / 2) : null,
      between: Math.round((cards[0].getBoundingClientRect().bottom + cards[1].getBoundingClientRect().top) / 2),
      dragging: cards.findIndex((c) => c.classList.contains('dragging')),
      grabbing: document.body.classList.contains('reordering'),
    }
  })
  await fx.screenshot({ path: `${SHOTS}/15-drag-reorder.png` })
  await fx.mouse.up()
  await sleep(250)
  const afterMouse = { order: await courseNames(), line: !!(await fx.$('.drop-line')), live: await live() }
  check(
    'マウスでつまみをつかんで動かすと、つかんだコースが薄くなり、落とす場所（コースとコースの間）に線が出る。離すとそこへ移り、「2番目に移しました」と読み上げる',
    midDrag.dragging === 2 && midDrag.grabbing && midDrag.line !== null && Math.abs(midDrag.line - midDrag.between) <= 2 && afterMouse.order === `${A}|${C}|${B}` && !afterMouse.line && afterMouse.live === '2番目に移しました',
    JSON.stringify({ midDrag, afterMouse }),
  )
  // 区切りの下の端の近くまで動かすと、中身がスクロールし、いちばん下まで運べる（開いたコースは長い）
  await fx.evaluate(() => (document.querySelector('.content').scrollTop = 0))
  await sleep(200)
  const gripA = await cardBox(0, '.grip')
  const contentBottom = await fx.evaluate(() => document.querySelector('.content').getBoundingClientRect().bottom)
  await fx.mouse.move(gripA.x, gripA.y)
  await fx.mouse.down()
  await fx.mouse.move(gripA.x, contentBottom - 6, { steps: 15 })
  await sleep(2500)
  const scrolledBy = await fx.evaluate(() => document.querySelector('.content').scrollTop)
  await fx.mouse.up()
  await sleep(250)
  check('つかんだまま区切りの下の端の近くまで動かすと、中身がスクロールし、いちばん下まで運べる', scrolledBy > 150 && (await courseNames()) === `${C}|${B}|${A}`, `${scrolledBy} / ${await courseNames()}`)
  // 指（タッチ）でも動かせる：2番目（試験二）を、3番目の下半分まで
  await fx.evaluate(() => document.querySelectorAll('.course-list > .course')[1].scrollIntoView({ block: 'start' }))
  await sleep(200)
  const gripB = await cardBox(1, '.grip')
  const cardA = await cardBox(2)
  await fx.touchscreen.touchStart(gripB.x, gripB.y)
  for (let k = 1; k <= 10; k++) await fx.touchscreen.touchMove(gripB.x, gripB.y + ((cardA.bottom - 12 - gripB.y) * k) / 10)
  await sleep(100)
  await fx.touchscreen.touchEnd()
  await sleep(250)
  check('指（タッチ）でも、つまみをつかんで動かせる', (await courseNames()) === `${C}|${A}|${B}`, await courseNames())
  // キーボード：つまみを選んで ↓・↑。動かしたコースのつまみが選ばれたまま。端では「いちばん下です」
  const focusedCard = () => fx.evaluate(() => (document.activeElement?.classList.contains('grip') ? document.activeElement.closest('.course').querySelector('.cname').textContent.replace(/ コース$/, '') : null))
  await (await fx.$$('.course-list > .course .grip'))[0].focus()
  const steps = []
  for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowUp']) {
    await fx.keyboard.press(key)
    await sleep(150)
    steps.push(`${await courseNames()}／${await live()}／${await focusedCard()}`)
  }
  check(
    'キーボード：つまみを選んで ↓・↑ で1つずつ動き、「3番目に移しました」などと読み上げる（動かしたコースのつまみが選ばれたまま。端では「いちばん下です」）',
    steps.join(' ; ') === [`${A}|${C}|${B}／2番目に移しました／${C}`, `${A}|${B}|${C}／3番目に移しました／${C}`, `${A}|${B}|${C}／いちばん下です／${C}`, `${A}|${C}|${B}／2番目に移しました／${C}`].join(' ; '),
    steps.join(' ; '),
  )
  const pageScroll = await fx.evaluate(() => ({ height: document.documentElement.scrollHeight, inner: innerHeight, y: scrollY, header: document.querySelector('.admin-header').getBoundingClientRect().top }))
  check('コースが増えて中身が長くなっても、ページ全体はスクロールしない（見出しはいつも画面の上に見える）', pageScroll.height <= pageScroll.inner && pageScroll.y === 0 && pageScroll.header === 0, JSON.stringify(pageScroll))
  // 「学生に表示」を外したコースも並べ替えられる（試験二を開いて外す）
  await fx.evaluate(() => document.querySelectorAll('.course-list > .course')[2].querySelector('.open-btn').click())
  await sleep(150)
  await fx.evaluate(() => document.querySelector('.course.open .toggle-label input').click())
  await sleep(100)
  await (await fx.$$('.course-list > .course .grip'))[2].focus()
  await fx.keyboard.press('ArrowUp')
  await sleep(150)
  const hiddenMoved = await fx.evaluate(() => document.querySelectorAll('.course-list > .course')[1].classList.contains('hidden-course'))
  check('「学生に表示」を外したコースも、同じように並べ替えられる', hiddenMoved && (await courseNames()) === `${A}|${B}|${C}`, await courseNames())
  await fxSave()
  const savedOrder1 = (await fxSaved()).courses.map((c) => c.name).join('|')
  await (await fx.$$('.course-list > .course .grip'))[2].focus()
  await fx.keyboard.press('ArrowUp')
  await sleep(150)
  await fxSave()
  const savedOrder2 = (await fxSaved()).courses.map((c) => c.name).join('|')
  check(
    '並べ替えた順番は、今までどおり「保存して学生に反映」で保存される（保存の確認に「コースの順番」が出る）',
    savedOrder1 === `${A}|${B}|${C}` && savedOrder2 === `${A}|${C}|${B}` && fxDialogs.last().includes('・コースの順番'),
    `${savedOrder1} → ${savedOrder2} / ${fxDialogs.last().replace(/\n/g, '⏎')}`,
  )
  // 下書きのひな形の窓の行も、つまみで並べ替える
  await fx.evaluate(() => document.querySelector('.course-list > .course .open-btn').click())
  await sleep(150)
  await fx.evaluate(() => document.querySelector('.course.open .tpl-line .tpl-old').click())
  await fx.waitForSelector('.tpl-modal')
  const tplRows = () => fx.evaluate(() => [...document.querySelectorAll('.tpl-modal .row input')].map((i) => i.value))
  const tplInfo = await fx.evaluate(() => ({
    grips: [...document.querySelectorAll('.tpl-modal .row')].every((r) => r.firstElementChild.classList.contains('grip') && r.firstElementChild.textContent === '⋮⋮' && r.firstElementChild.getAttribute('aria-label') === '並べ替え（矢印キーで動かす）'),
    arrows: [...document.querySelectorAll('.tpl-modal .row button')].some((b) => /↑|↓/.test(b.textContent) || /上へ|下へ/.test(b.title)),
  }))
  const tpl0 = await tplRows()
  await (await fx.$$('.tpl-modal .row .grip'))[1].focus()
  await fx.keyboard.press('ArrowDown')
  await sleep(150)
  const tplKey = await tplRows()
  const tplLive = await fx.evaluate(() => document.querySelector('.tpl-modal .sr-only[aria-live]').textContent.replace(/​/g, ''))
  const gripRow4 = await fx.evaluate(() => {
    const r = document.querySelectorAll('.tpl-modal .row .grip')[4].getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
  })
  const row1Top = await fx.evaluate(() => document.querySelectorAll('.tpl-modal .row')[1].getBoundingClientRect().top)
  await fx.mouse.move(gripRow4.x, gripRow4.y)
  await fx.mouse.down()
  await fx.mouse.move(gripRow4.x, row1Top + 6, { steps: 8 })
  await sleep(150)
  const tplLine = !!(await fx.$('.tpl-modal .drop-line'))
  await fx.screenshot({ path: `${SHOTS}/18-template-rows-grip.png` })
  await fx.mouse.up()
  await sleep(200)
  const tplMouse = await tplRows()
  const swapped = [tpl0[0], tpl0[2], tpl0[1], ...tpl0.slice(3)]
  const dragged = [swapped[0], swapped[4], swapped[1], swapped[2], swapped[3], ...swapped.slice(5)]
  check(
    'ひな形の窓の行も「↑」「↓」をなくし、行の左のつまみで並べ替える（キーボードの ↓、マウスでつかんで動かす）',
    tplInfo.grips && !tplInfo.arrows && JSON.stringify(tplKey) === JSON.stringify(swapped) && tplLive === '3番目に移しました' && tplLine && JSON.stringify(tplMouse) === JSON.stringify(dragged),
    JSON.stringify({ tplInfo, tpl0: tpl0.slice(0, 6), tplKey: tplKey.slice(0, 6), tplMouse: tplMouse.slice(0, 6), tplLive }),
  )
  await fx.evaluate(() => [...document.querySelectorAll('.tpl-foot button')].find((b) => b.textContent === 'やめる').click())
  await fx.waitForFunction(() => !document.querySelector('.tpl-modal'), { timeout: 3000 }).catch(() => {})

  // ---- 5. 区切りの中身の幅：見本との境目をつかんで変える。覚えておき、ダブルクリックで元の幅。←・→ でも変わる ----
  const contentWidth = () => fx.evaluate(() => Math.round(document.querySelector('.work > .content').getBoundingClientRect().width))
  const storedWidth = () => fx.evaluate(() => localStorage.getItem('sotsugyo-admin-form-width'))
  const handleBox = async () => {
    const b = await (await fx.$('.form-resize')).boundingBox()
    return { x: b.x + b.width / 2, y: 300 }
  }
  const handleInfo = await fx.evaluate(() => {
    const h = document.querySelector('.form-resize')
    return { role: h.getAttribute('role'), label: h.getAttribute('aria-label'), tab: h.tabIndex, cursor: getComputedStyle(h).cursor, edge: Math.abs(h.getBoundingClientRect().left + h.getBoundingClientRect().width / 2 - document.querySelector('.work > .content').getBoundingClientRect().right) }
  })
  const width0 = await contentWidth()
  const drag = async (dx) => {
    const h = await handleBox()
    await fx.mouse.move(h.x, h.y)
    await fx.mouse.down()
    await fx.mouse.move(h.x + dx, h.y, { steps: 8 })
    await fx.mouse.up()
    await sleep(200)
  }
  let h = await handleBox()
  await fx.mouse.move(h.x, h.y)
  await sleep(300)
  const hoverLine = await fx.evaluate(() => getComputedStyle(document.querySelector('.form-resize'), '::after').backgroundColor)
  await drag(120)
  const widened = { width: await contentWidth(), stored: await storedWidth() }
  h = await handleBox()
  await fx.mouse.move(h.x, h.y)
  await sleep(300)
  await fx.screenshot({ path: `${SHOTS}/16-panel-resize.png` })
  check(
    '中身と見本の境目は、マウスを重ねると細い線が見え（カーソルは左右の矢印）、つかんで右へ 120px 動かすと中身が 560px → 680px になる（このブラウザに覚える）',
    handleInfo.role === 'separator' && handleInfo.label === '入力欄の幅（←→キーで変える）' && handleInfo.tab === 0 && handleInfo.cursor === 'col-resize' && handleInfo.edge <= 2 && hoverLine !== 'rgba(0, 0, 0, 0)' && width0 === 560 && widened.width === 680 && widened.stored === '680',
    JSON.stringify({ handleInfo, hoverLine, width0, widened }),
  )
  await fx.reload({ waitUntil: 'networkidle0' })
  await fx.waitForSelector('.admin .content')
  const remembered = await contentWidth()
  await fx.focus('.form-resize')
  await fx.keyboard.press('ArrowRight')
  await sleep(100)
  const keyRight = await contentWidth()
  await fx.keyboard.press('ArrowLeft')
  await fx.keyboard.press('ArrowLeft')
  await sleep(100)
  const keyLeft = await contentWidth()
  check('開き直しても、決めた幅（680px）のまま。境目を選んで → で広く、← で狭くなる（16px ずつ）', remembered === 680 && keyRight === 696 && keyLeft === 664, `${remembered} → ${keyRight} → ${keyLeft}`)
  await drag(-600)
  const narrowest = await contentWidth()
  await drag(900)
  const widest = await contentWidth()
  h = await handleBox()
  await fx.mouse.click(h.x, h.y, { count: 2 })
  await sleep(200)
  const reset = { width: await contentWidth(), stored: await storedWidth() }
  check('狭くても 480px、広くても見本に 360px を残す所まで（1366 の幅で 794px）。ダブルクリックで元の幅（560px）に戻り、覚えた幅も消える', narrowest === 480 && widest === 794 && reset.width === 560 && reset.stored === null, JSON.stringify({ narrowest, widest, reset }))

  // ---- 6. 詳細設定の「止める（Google の障害のとき）」は「止める」に ----
  await nav(fx, '詳細設定')
  const drive = await fx.evaluate(() => ({ buttons: [...document.querySelectorAll('.drive-switch .seg2 button')].map((b) => b.textContent), nav: [...document.querySelectorAll('.side-nav button')].find((b) => b.textContent.includes('詳細設定')).textContent }))
  await fx.screenshot({ path: `${SHOTS}/17-drive-stop-label.png` })
  const driveLonely = await lonelyAtWidths(fx)
  check(
    '詳細設定のボタンは「必須（ふだん）」と「止める」（左の見出しは「詳細設定　ふだんは変えません」）',
    drive.buttons.join('|') === '必須（ふだん）|止める' && drive.nav === '詳細設定ふだんは変えません' && driveLonely.length === 0,
    JSON.stringify({ drive, driveLonely }),
  )
  await fixes.close()

  // ==== サーバーを待つ間の表示（試験用サーバーを遅くして確かめる。本番の Apps Script は、10秒ほどかかることがある） ====
  const DELAY = 3500
  const waiting = await browser.createBrowserContext()
  const sw = await waiting.newPage()
  sw.on('pageerror', (e) => console.log('pageerror:', e.message))
  const swDialogs = dialogLog(sw)
  await sw.setViewport({ width: 1366, height: 768 })
  await sw.goto(`${APP}/admin.html?delay=${DELAY}`, { waitUntil: 'domcontentloaded' })
  await sw.waitForSelector('.page-wait')
  const firstWait = await sw.evaluate(() => ({ all: document.querySelector('.page-wait').textContent, spin: !!document.querySelector('.page-wait .spin'), small: document.querySelector('.page-wait small')?.textContent ?? null }))
  await sleep(2300)
  const firstSlow = await sw.evaluate(() => document.querySelector('.page-wait small')?.textContent ?? null)
  await sw.screenshot({ path: `${SHOTS}/19-wait-first-load.png` })
  const loadLonely = await lonelyLines(sw, '.page-wait')
  await sw.waitForSelector('.admin .content', { timeout: 15000 })
  check(
    '最初の読み込み：画面の真ん中に回る印と「読み込んでいます…」。2秒を過ぎると、その下に「数秒〜十数秒かかることがあります」',
    firstWait.all === '読み込んでいます…' && firstWait.spin && firstWait.small === null && firstSlow === '数秒〜十数秒かかることがあります' && loadLonely.length === 0,
    JSON.stringify({ firstWait, firstSlow, loadLonely }),
  )
  const swState = () =>
    sw.evaluate(() => {
      const busy = [...document.querySelectorAll('.admin-header button.busy')][0] ?? null
      return {
        busy: busy ? { text: busy.textContent, spin: !!busy.querySelector('.spin'), disabled: busy.disabled, aria: busy.getAttribute('aria-busy') } : null,
        bar: document.querySelector('.dirty-bar .btn.primary')?.textContent ?? null,
        buttons: [...document.querySelectorAll('.admin-header button.btn')].map((b) => `${b.textContent}:${b.disabled}`),
        select: document.querySelector('.admin-header .sel').disabled,
        inert: document.querySelector('.content').inert,
        slow: document.querySelector('.admin-header .slow-note')?.textContent ?? null,
        done: document.querySelector('.admin-header .done-note')?.textContent ?? null,
        message: document.querySelector('.content .message')?.textContent ?? null,
      }
    })
  const swClick = (text, scope = '.admin-header') => sw.evaluate((text, scope) => [...document.querySelectorAll(`${scope} button`)].find((b) => b.textContent.trim() === text).click(), text, scope)
  // 保存して学生に反映
  await (await sw.$('#y-commonTitle')).type('（待つ）')
  await swClick('保存して学生に反映')
  await sleep(80)
  const saving = await swState()
  await sw.screenshot({ path: `${SHOTS}/20-wait-saving.png` })
  await sleep(2200)
  const savingSlow = await swState()
  const waitLonely = await lonelyAtWidths(sw, '.admin-header, .dirty-bar')
  await sw.screenshot({ path: `${SHOTS}/21-wait-slow.png` })
  await sw.waitForFunction(() => document.querySelector('.content .message.ok'), { timeout: 15000 })
  const savedState = await swState()
  await sw.screenshot({ path: `${SHOTS}/22-wait-done.png` })
  check(
    '「保存して学生に反映」を押すと、すぐボタン（見出しと画面の下の帯）に回る印と「保存しています…」が出て押せなくなる（年度の選択・中身も、終わるまで触れない）',
    saving.busy?.text === '保存しています…' && saving.busy.spin && saving.busy.disabled && saving.busy.aria === 'true' && saving.bar === '保存しています…' && saving.select && saving.inert && saving.slow === null && saving.done === null,
    JSON.stringify(saving),
  )
  check(
    '2秒を過ぎると、見出しの保存のボタンのとなりに「数秒〜十数秒かかることがあります」（1280・1366・1920 の幅で、1字だけ次の行に残らない）',
    savingSlow.slow === '数秒〜十数秒かかることがあります' && savingSlow.busy?.text === '保存しています…' && waitLonely.length === 0,
    JSON.stringify({ savingSlow, waitLonely }),
  )
  check(
    '保存が終わると、ボタンのとなりに「✓ 保存しました」が出て、帯は消え、ボタン・中身は元に戻る（いつもの知らせも出る）',
    savedState.done === '保存しました' && savedState.busy === null && savedState.bar === null && savedState.buttons.join('|') === '保存して学生に反映:true' && !savedState.inert && !savedState.select && savedState.slow === null && savedState.message.includes('反映'),
    JSON.stringify(savedState),
  )
  const doneGone = await sw.waitForFunction(() => !document.querySelector('.done-note'), { timeout: 7000 }).then(
    () => true,
    () => false,
  )
  check('「✓ 保存しました」は数秒で消え、「変更はありません」に戻る', doneGone && (await sw.evaluate(() => document.querySelector('.admin-header .save-state')?.textContent)) === '変更はありません')
  // 変更履歴（読み込む間は、区切りの中に回る印と「読み込んでいます…」）
  await nav(sw, '変更履歴')
  await sleep(80)
  const histWait = await sw.evaluate(() => {
    const w = document.querySelector('.history-sec .wait-line')
    return { text: w?.textContent ?? null, spin: !!w?.querySelector('.spin') }
  })
  await sleep(2200)
  const histSlow = await sw.evaluate(() => document.querySelector('.history-sec .slow-note')?.textContent ?? null)
  await sw.waitForSelector('.history li', { timeout: 15000 })
  check('「変更履歴」を押すと、すぐ区切りの中に回る印と「読み込んでいます…」が出て（2秒を過ぎると「数秒〜…」も）、読み込むと一覧が出る', histWait.text === '読み込んでいます…' && histWait.spin && histSlow === '数秒〜十数秒かかることがあります', JSON.stringify({ histWait, histSlow }))
  await nav(sw, '年度の設定')
  // 新年度を作成（作っている間は窓を開いたまま、「作成する」に回る印と「作成しています…」）
  await sw.evaluate(() => document.querySelector('.next-year .btn').click())
  await sw.waitForSelector('.modal')
  await swClick('作成する', '.modal')
  await sleep(80)
  const creating = await sw.evaluate(() => {
    const b = document.querySelector('.modal button.primary')
    const cancel = [...document.querySelectorAll('.modal button')].find((x) => x.textContent === 'やめる')
    return { text: b?.textContent, spin: !!b?.querySelector('.spin'), disabled: b?.disabled, cancel: cancel?.disabled, slow: document.querySelector('.modal .slow-note')?.textContent ?? null }
  })
  await sw.keyboard.press('Escape')
  await sleep(2200)
  const createSlow = await sw.evaluate(() => ({ open: !!document.querySelector('.modal'), slow: document.querySelector('.modal .slow-note')?.textContent ?? null }))
  const createLonely = await lonelyLines(sw, '.modal')
  await sw.screenshot({ path: `${SHOTS}/23-wait-create.png` })
  await sw.waitForFunction(() => !document.querySelector('.modal') && document.querySelector('.badge.draft'), { timeout: 15000 })
  const created = await swState()
  check(
    '新年度の「作成する」を押すと、窓を開いたまま、ボタンに回る印と「作成しています…」（「やめる」・Esc でも閉じない）。2秒を過ぎると窓の中に「数秒〜十数秒かかることがあります」。作ると窓が閉じ、「✓ 作成しました」と新年度の手順',
    creating.text === '作成しています…' && creating.spin && creating.disabled && creating.cancel && creating.slow === null && createSlow.open && createSlow.slow === '数秒〜十数秒かかることがあります' && createLonely.length === 0 && created.done === '作成しました' && created.message.startsWith('2027年度を作成しました') && !!(await sw.$('.steps-card')),
    JSON.stringify({ creating, createSlow, createLonely, created }),
  )
  // この年度を学生に公開（保存して公開。回る印と「公開しています…」）
  await swClick('この年度を学生に公開')
  await sleep(80)
  const publishing = await swState()
  await sw.waitForFunction(() => document.querySelector('.badge.pub')?.textContent === '公開中', { timeout: 15000 })
  const published = await swState()
  check(
    '「この年度を学生に公開」を押すと、すぐボタンに回る印と「公開しています…」が出て押せなくなり、終わると「✓ 公開しました」',
    publishing.busy?.text === '公開しています…' && publishing.busy.spin && publishing.busy.disabled && publishing.inert && publishing.select && published.done === '公開しました',
    JSON.stringify({ publishing, published: published.done }),
  )
  // この年度を削除（準備中の年度。ボタンに回る印と「削除しています…」）
  await sw.evaluate(() => document.querySelector('.next-year .btn').click())
  await sw.waitForSelector('.modal')
  await swClick('作成する', '.modal')
  await sw.waitForFunction(() => !document.querySelector('.modal') && document.querySelector('.badge.draft'), { timeout: 15000 })
  await sw.evaluate(() => document.querySelector('.delete-year .btn').click())
  await sleep(80)
  const deleting = await sw.evaluate(() => {
    const b = document.querySelector('.delete-year .btn')
    return { text: b?.textContent, spin: !!b?.querySelector('.spin'), disabled: b?.disabled, header: [...document.querySelectorAll('.admin-header button.btn')].every((x) => x.disabled), inert: document.querySelector('.content').inert }
  })
  await sw.waitForFunction(() => document.querySelector('.content .message.ok')?.textContent.includes('削除しました'), { timeout: 15000 })
  const deleted = await swState()
  check(
    '「この年度を削除」を押すと（確かめたあと）、すぐボタンに回る印と「削除しています…」が出て、保存・公開も押せない。終わると「✓ 削除しました」',
    deleting.text === '削除しています…' && deleting.spin && deleting.disabled && deleting.header && deleted.done === '削除しました',
    JSON.stringify({ deleting, deleted: deleted.done, confirm: swDialogs.last().slice(0, 30) }),
  )
  // 先生の登録（一覧の読み込み・登録）。読み込み直してすぐ開くと、一覧を読み込んでいる
  await sw.reload({ waitUntil: 'domcontentloaded' })
  await sw.waitForSelector('.admin .content', { timeout: 15000 })
  await nav(sw, '先生の登録')
  await sleep(80)
  const membersLoading = await sw.evaluate(() => ({ text: document.querySelector('.members .wait-line')?.textContent ?? null, spin: !!document.querySelector('.members .wait-line .spin'), nav: [...document.querySelectorAll('.side-nav button')].find((b) => b.textContent.includes('先生の登録')).querySelector('small').textContent }))
  await sw.waitForSelector('.member-list li', { timeout: 15000 })
  await sw.type('.member-add textarea', 'wait-test@example.ac.jp')
  await swClick('登録する', '.members')
  await sleep(80)
  const adding = await sw.evaluate(() => {
    const b = document.querySelector('.member-add button.primary')
    return { text: b?.textContent, spin: !!b?.querySelector('.spin'), disabled: b?.disabled, others: [...document.querySelectorAll('.member-list button, .member-list select')].every((x) => x.disabled) }
  })
  await sleep(2200)
  const addingSlow = await sw.evaluate(() => document.querySelector('.members .slow-note')?.textContent ?? null)
  await sw.screenshot({ path: `${SHOTS}/24-wait-members.png` })
  await sw.waitForFunction(() => [...document.querySelectorAll('.member-list li .who')].some((w) => w.textContent.includes('wait-test@example.ac.jp')), { timeout: 15000 })
  const addedNote = await sw.evaluate(() => document.querySelector('.members .done-note')?.textContent ?? null)
  check(
    '先生の登録：一覧を読み込む間は回る印と「読み込んでいます…」（左の見出しも「読み込んでいます…」）。「登録する」を押すと、ボタンに回る印と「登録しています…」（ほかの「外す」・役割も押せない）。2秒を過ぎると「数秒〜…」。終わると「✓ 登録しました」',
    membersLoading.text === '読み込んでいます…' && membersLoading.spin && membersLoading.nav === '読み込んでいます…' && adding.text === '登録しています…' && adding.spin && adding.disabled && adding.others && addingSlow === '数秒〜十数秒かかることがあります' && addedNote === '登録しました',
    JSON.stringify({ membersLoading, adding, addingSlow, addedNote }),
  )
  // 先生の画面の保存（ひな形・お知らせ・書き間違えやすい語）
  const tw = await waiting.newPage()
  dialogLog(tw)
  await tw.setViewport({ width: 1366, height: 768 })
  await tw.goto(`${APP}/admin.html?as=teacher&delay=${DELAY}`, { waitUntil: 'domcontentloaded' })
  await tw.waitForSelector('.admin .content', { timeout: 15000 })
  await tw.type('.course.open textarea.notice', '待つ間の表示の確かめ')
  await tw.evaluate(() => [...document.querySelectorAll('.admin-header button')].find((b) => b.textContent.startsWith('保存して')).click())
  await sleep(80)
  const teacherSaving = await tw.evaluate(() => {
    const b = document.querySelector('.admin-header button.busy')
    return { text: b?.textContent, spin: !!b?.querySelector('.spin'), disabled: b?.disabled, select: document.querySelector('.admin-header .sel').disabled, inert: document.querySelector('.content').inert }
  })
  await sleep(2200)
  const teacherSlow = await tw.evaluate(() => document.querySelector('.admin-header .slow-note')?.textContent ?? null)
  await tw.screenshot({ path: `${SHOTS}/25-wait-teacher.png` })
  await tw.waitForFunction(() => document.querySelector('.message.ok'), { timeout: 15000 })
  const teacherDone = await tw.evaluate(() => document.querySelector('.done-note')?.textContent ?? null)
  check(
    '先生の画面の保存も、すぐボタンに回る印と「保存しています…」（年度の選択・中身も触れない）。2秒を過ぎると「数秒〜…」、終わると「✓ 保存しました」',
    teacherSaving.text === '保存しています…' && teacherSaving.spin && teacherSaving.disabled && teacherSaving.select && teacherSaving.inert && teacherSlow === '数秒〜十数秒かかることがあります' && teacherDone === '保存しました',
    JSON.stringify({ teacherSaving, teacherSlow, teacherDone }),
  )
  await waiting.close()

  // ==== mockups/v43 案B（左の見出し）：区切りの切り替え・はじめの画面の数・保存していない変更の帯と印・新年度の手順・先生の画面・字の大きさ ====
  const v43 = await browser.createBrowserContext()
  const vb = await v43.newPage()
  vb.on('pageerror', (e) => console.log('pageerror:', e.message))
  const vbDialogs = dialogLog(vb)
  await vb.setViewport({ width: 1366, height: 768 })
  await vb.goto(`${APP}/admin.html`, { waitUntil: 'networkidle0' })
  await vb.waitForSelector('.admin .content')
  await sleep(600)
  // はじめの画面（変更なし）：見える入力欄・ボタン・字の数（mockups/v43 の数え方。案B は入力欄4・ボタン9・字352・12px以下の字0）
  const firstCount = await countScreen(vb)
  await vb.screenshot({ path: `${V43}/1-year-1366.png` })
  check(
    'はじめの画面に見えるのは、入力欄4・ボタン9・12px以下の字0（mockups/v43 案B の数とほぼ同じ。前の画面は入力欄10・ボタン11）',
    firstCount.fields === 4 && firstCount.buttons >= 9 && firstCount.buttons <= 10 && firstCount.small === 0 && firstCount.chars >= 280 && firstCount.chars <= 430,
    JSON.stringify(firstCount),
  )
  /** いま見えている区切り：見出しの数・名前、左の見出しで選ばれている区切り、見本があるか */
  const shownSections = () =>
    vb.evaluate(() => ({
      heads: [...document.querySelectorAll('.sec-h')].map((h) => h.textContent),
      current: [...document.querySelectorAll('.side-nav button[aria-current="page"]')].map((b) => b.querySelector('.nt b').firstChild.textContent.trim()),
      preview: !!document.querySelector('.stage .preview'),
    }))
  const switched = []
  for (const [title, head, preview, key] of [
    ['コース', 'コース', true, 'course'],
    ['書き方のチェック', '書き方のチェック（言葉）', false, 'words'],
    ['先生の登録', '先生の登録', false, 'members'],
    ['変更履歴', '変更履歴', false, 'history'],
    ['詳細設定', '詳細設定', true, 'details'],
    ['年度の設定', '年度の設定', true, 'year'],
  ]) {
    await nav(vb, title)
    await sleep(250)
    const s = await shownSections()
    switched.push(s.heads.length === 1 && s.heads[0] === head && s.current.join() === title && s.preview === preview ? 'ok' : JSON.stringify(s))
    for (const [vp, tag] of [
      [{ width: 1366, height: 768 }, '1366'],
      [{ width: 1920, height: 1080 }, '1920'],
    ]) {
      await vb.setViewport(vp)
      await sleep(350)
      await vb.screenshot({ path: `${V43}/2-${key}-${tag}.png` })
    }
    await vb.setViewport({ width: 1366, height: 768 })
  }
  check('左の見出しを押すと、その区切りだけが右に出る（見出しは1つ・aria-current が移る。見本は年度の設定・コース・詳細設定だけ）', switched.every((s) => s === 'ok'), switched.join(' / '))
  // キーボード：左の見出しはボタンの一覧（Tab で移り、Enter で開く）
  await vb.focus('.side-nav button')
  await vb.keyboard.press('Tab')
  await vb.keyboard.press('Enter')
  await sleep(200)
  const keyNav = await shownSections()
  check('左の見出しはキーボードでも使える（Tab で次の区切りへ、Enter で開く）', keyNav.heads[0] === 'コース' && keyNav.current.join() === 'コース', JSON.stringify(keyNav))
  await vb.reload({ waitUntil: 'networkidle0' })
  await vb.waitForSelector('.admin .content')
  check('読み込み直しても、選んでいた区切り（コース）から開く', (await shownSections()).heads[0] === 'コース')

  // 保存していない変更（公開中の年度）：画面の下に帯と保存のボタン、直した欄に「変更あり」、左の見出しに数
  const barState = () =>
    vb.evaluate(() => {
      const bar = document.querySelector('.dirty-bar')
      return {
        head: bar?.querySelector('.tx b')?.textContent ?? null,
        sub: bar?.querySelector('.tx span')?.textContent ?? null,
        mark: bar?.querySelector('.mk')?.textContent ?? null,
        buttons: bar ? [...bar.querySelectorAll('button')].map((b) => `${b.textContent}${b.classList.contains('primary') ? '＊' : ''}`).join('|') : null,
        header: document.querySelector('.admin-header .save-state')?.textContent ?? null,
        headerSave: [...document.querySelectorAll('.admin-header button.btn')].map((b) => `${b.textContent}${b.classList.contains('primary') ? '＊' : b.classList.contains('quiet') ? '（静か）' : ''}${b.disabled ? '（押せない）' : ''}`).join('|'),
        counts: [...document.querySelectorAll('.side-nav button')].map((b) => `${b.querySelector('.nt b').firstChild.textContent.trim()}${b.querySelector('.cnt') ? `:${b.querySelector('.cnt').textContent.replace('保存していない変更', '')}` : ''}`).join('|'),
      }
    })
  const clean = await barState()
  check(
    '変更がないときは、帯は出ず、見出しは「変更はありません」と静かな（押せない）保存のボタン',
    clean.head === null && clean.header === '変更はありません' && clean.headerSave === '保存して学生に反映（静か）（押せない）',
    JSON.stringify(clean),
  )
  await nav(vb, '年度の設定')
  await setValue(await vb.$('#y-deadline'), '2027-01-22')
  await sleep(200)
  const one = await barState()
  const deadlineMark = await vb.evaluate(() => {
    const ctl = document.querySelector('#y-deadline').closest('.ctl')
    return { label: ctl.previousElementSibling.querySelector('.chg')?.textContent ?? null, ring: ctl.classList.contains('chg'), others: document.querySelectorAll('.content .lb .chg').length }
  })
  check(
    '最終締切を変えると、画面の下に「まだ学生に届いていない変更が1か所あります」と保存のボタン（見出しのボタンも目立つ形に）。直した欄に「変更あり」、左の見出しの「年度の設定」に 1',
    one.head === 'まだ学生に届いていない変更が1か所あります' && one.sub === '最終締切' && one.mark === '1' && one.buttons === '変更を見る|保存して学生に反映＊' && one.header === '保存していない変更 1か所' && one.headerSave === '保存して学生に反映＊' &&
      one.counts === '年度の設定:1|コース|書き方のチェック|先生の登録|変更履歴|詳細設定' && deadlineMark.label === '変更あり' && deadlineMark.ring && deadlineMark.others === 1,
    JSON.stringify({ one, deadlineMark }),
  )
  await nav(vb, 'コース')
  await (await vb.$('.course.open textarea.notice')).type('中間発表は12月4日（金）です')
  await vb.evaluate(() => document.querySelector('.course.open .open-btn').click())
  await sleep(200)
  const two = await barState()
  const courseChip = await vb.evaluate(() => [...document.querySelectorAll('.course-list > .course')].map((c) => [...c.querySelectorAll('.chip')].map((x) => x.textContent).join('・')))
  for (const [vp, tag] of [
    [{ width: 1366, height: 768 }, '1366'],
    [{ width: 1920, height: 1080 }, '1920'],
  ]) {
    await vb.setViewport(vp)
    await sleep(350)
    await vb.screenshot({ path: `${V43}/3-dirty-published-${tag}.png` })
  }
  await vb.setViewport({ width: 1366, height: 768 })
  check(
    'コースのお知らせも直すと、帯は「…2か所あります」・「最終締切、映画・舞台衣装デザイナー コースのお知らせ」。閉じたコースの行に「変更あり」、左の見出しの「コース」に 1',
    two.head === 'まだ学生に届いていない変更が2か所あります' && two.sub === '最終締切、映画・舞台衣装デザイナー コースのお知らせ' && two.counts.startsWith('年度の設定:1|コース:1|') && courseChip[0].startsWith('変更あり・お知らせあり'),
    JSON.stringify({ two, courseChip }),
  )
  await vb.evaluate(() => [...document.querySelectorAll('.dirty-bar button')].find((b) => b.textContent === '変更を見る').click())
  await vb.waitForSelector('.changes-modal')
  const changeList = await vb.evaluate(() => [...document.querySelectorAll('.changes-modal li')].map((li) => li.textContent))
  await vb.screenshot({ path: `${V43}/4-changes-list-1366.png` })
  await vb.keyboard.press('Escape')
  await sleep(150)
  check('帯の「変更を見る」で、まだ保存していない変更の一覧が出る（保存の確認と同じ言葉）', changeList.join('|') === '最終締切|映画・舞台衣装デザイナー コースのお知らせ' && !(await vb.$('.changes-modal')), changeList.join('|'))
  await vb.evaluate(() => document.querySelector('.dirty-bar .btn.primary').click())
  await vb.waitForFunction(() => document.querySelector('.content .message.ok'))
  const afterBarSave = await barState()
  check(
    '帯の「保存して学生に反映」で、今までどおり確かめてから保存する（確かめに2つの変更）。保存すると帯は消える',
    vbDialogs.last().includes('・最終締切') && vbDialogs.last().includes('・映画・舞台衣装デザイナー コースのお知らせ') && afterBarSave.head === null && afterBarSave.counts === '年度の設定|コース|書き方のチェック|先生の登録|変更履歴|詳細設定',
    JSON.stringify(afterBarSave),
  )

  // 準備中の年度：「年度の設定」に新年度の手順。帯は「保存していない変更が…」で、ボタンは「保存」
  await nav(vb, '年度の設定')
  await vb.evaluate(() => document.querySelector('.next-year .btn').click())
  await vb.waitForSelector('.modal')
  await vb.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent === '作成する').click())
  await vb.waitForFunction(() => document.querySelector('.badge.draft') && document.querySelector('.steps-card'))
  await sleep(400)
  const stepState = () =>
    vb.evaluate(() => ({
      prog: document.querySelector('.steps-card .prog')?.textContent,
      steps: [...document.querySelectorAll('.steps li')].map((li) => `${li.className || '-'}:${li.querySelector('b').textContent}:${li.querySelector('.st').textContent}`),
    }))
  const stepsNow = await stepState()
  await vb.evaluate(() => document.querySelector('.steps-card').scrollIntoView({ block: 'start' }))
  for (const [vp, tag] of [
    [{ width: 1366, height: 768 }, '1366'],
    [{ width: 1920, height: 1080 }, '1920'],
  ]) {
    await vb.setViewport(vp)
    await sleep(350)
    await vb.screenshot({ path: `${V43}/5-newyear-steps-${tag}.png` })
  }
  await vb.setViewport({ width: 1366, height: 768 })
  check(
    '準備中の年度の「年度の設定」に、新年度の手順（題目 → 締切 → コース → 確かめる → 公開）。作ったばかりは、どれもまだ（理由つき。最初の手順が目立つ）',
    stepsNow.prog === '0/5' &&
      stepsNow.steps.join(' ; ') === ['now:題目:2026年度と同じです', '-:締切:2026年度と同じ日付です', '-:コース:お知らせが2026年度のままです（映画・舞台衣装デザイナー コース）', '-:確かめる:確認が1件あります', '-:公開:上の「この年度を学生に公開」で公開します'].join(' ; '),
    JSON.stringify(stepsNow),
  )
  const clickStep = async (name) => {
    await vb.evaluate((name) => [...document.querySelectorAll('.steps li')].find((li) => li.querySelector('b').textContent === name).querySelector('button').click(), name)
    await sleep(300)
  }
  const active = () => vb.evaluate(() => ({ id: document.activeElement?.id ?? '', cls: document.activeElement?.className ?? '', section: document.querySelector('.sec-h')?.textContent }))
  await clickStep('締切')
  const toDeadline = await active()
  await clickStep('題目')
  const toTitle = await active()
  await (await vb.$('#y-commonTitle')).evaluate((el) => el.select())
  await vb.keyboard.type('卒業イベント「アラジン」について')
  await sleep(200)
  const titleDone = (await stepState()).steps[0]
  const draftBar = await barState()
  await clickStep('コース')
  const toCourse = await vb.evaluate(() => ({ section: document.querySelector('.sec-h')?.textContent, open: document.querySelector('.course.open .cname')?.textContent, focus: document.activeElement?.classList.contains('notice') && !!document.activeElement.closest('.course.open') }))
  await nav(vb, '年度の設定')
  await clickStep('確かめる')
  const toCheck = await active()
  await clickStep('公開')
  const toPublish = await active()
  check(
    '手順を押すと、直す所へ移る（題目・締切は「年度の設定」のその欄へ、コースは前の年度のままのお知らせへ、確かめるは確認の一覧へ、公開は「この年度を学生に公開」へ）',
    toDeadline.id === 'y-deadline' && toTitle.id === 'y-commonTitle' && toCourse.section === 'コース' && toCourse.open === '映画・舞台衣装デザイナー コース' && toCourse.focus && toCheck.cls.includes('problems') && toCheck.section === '年度の設定' && toPublish.id === 'publish-btn',
    JSON.stringify({ toDeadline, toTitle, toCourse, toCheck, toPublish }),
  )
  check('題目を直すと、手順の「題目」は済み（「直しました」）になる', titleDone === 'done:題目:直しました', titleDone)
  check(
    '準備中の年度の帯は「保存していない変更が1か所あります」・「学生に届くのは、この年度を公開してからです。」で、ボタンは「保存」（見出しの「この年度を学生に公開」が目立つ形のまま）',
    draftBar.head === '保存していない変更が1か所あります' && draftBar.sub === '共通の題目　学生に届くのは、この年度を公開してからです。' && draftBar.buttons === '変更を見る|保存＊' && draftBar.headerSave === '保存|この年度を学生に公開＊',
    JSON.stringify(draftBar),
  )
  await vb.setViewport({ width: 1366, height: 768 })
  await vb.screenshot({ path: `${V43}/6-dirty-draft-1366.png` })
  await vb.setViewport({ width: 1920, height: 1080 })
  await sleep(350)
  await vb.screenshot({ path: `${V43}/6-dirty-draft-1920.png` })
  await vb.setViewport({ width: 1366, height: 768 })
  // 字の大きさと、1字だけの行：どの区切りでも（変更の帯と、新年度の手順を出したまま）
  const lonelyAll = []
  const smallAll = []
  for (const title of ['年度の設定', 'コース', '書き方のチェック', '先生の登録', '変更履歴', '詳細設定']) {
    await nav(vb, title)
    if (title === '書き方のチェック') await vb.evaluate(() => document.querySelector('.wtable .wrow').click())
    if (title === '先生の登録') await vb.waitForSelector('.member-list li')
    if (title === '変更履歴') await vb.waitForSelector('.history li')
    await sleep(200)
    lonelyAll.push(...(await lonelyAtWidths(vb)).map((s) => `${title}:${s}`))
    smallAll.push(...(await smallText(vb)).map((s) => `${title}:${s}`))
    if (title === '書き方のチェック') await vb.evaluate(() => [...document.querySelectorAll('.wedit button')].find((b) => b.textContent === 'やめる').click())
  }
  // 窓（ひな形・新年度・変更の一覧）の中も
  await nav(vb, 'コース')
  await vb.evaluate(() => document.querySelector('.course.open .tpl-line .tpl-old').click())
  await vb.waitForSelector('.tpl-modal')
  smallAll.push(...(await smallText(vb, '.tpl-modal')).map((s) => `ひな形の窓:${s}`))
  lonelyAll.push(...(await lonelyLines(vb, '.tpl-modal')).map((s) => `ひな形の窓:${s}`))
  await vb.keyboard.press('Escape')
  await sleep(200)
  await vb.evaluate(() => [...document.querySelectorAll('.dirty-bar button')].find((b) => b.textContent === '変更を見る').click())
  await vb.waitForSelector('.changes-modal')
  smallAll.push(...(await smallText(vb, '.modal')).map((s) => `変更の一覧:${s}`))
  await vb.keyboard.press('Escape')
  check('どの区切りでも、1280・1366・1920 の幅で、1字だけの行がない（新しい区切りの見出し・説明・手順・帯の字）', lonelyAll.length === 0, lonelyAll.slice(0, 8).join(' / '))
  check('どの区切りでも、字は13px以上（ひな形の窓・変更の一覧の窓も）', smallAll.length === 0, smallAll.slice(0, 8).join(' / '))
  // 公開すると、新年度の手順は出なくなる
  await nav(vb, '年度の設定')
  await vb.evaluate(() => document.querySelector('#publish-btn').click())
  await vb.waitForFunction(() => document.querySelector('.badge.pub')?.textContent === '公開中')
  check('公開すると、新年度の手順は出なくなる', !(await vb.$('.steps-card')))

  // 先生の画面（mockups/v43 案B）：左の見出しは2つ。コースを開くと、お知らせとひな形。右に、学生が最初に見る本文の組み立て
  const tv = await v43.newPage()
  dialogLog(tv)
  await tv.setViewport({ width: 1366, height: 768 })
  await tv.goto(`${APP}/admin.html?as=teacher`, { waitUntil: 'networkidle0' })
  await tv.waitForSelector('.admin .content')
  await sleep(800)
  const teacherCount = await countScreen(tv)
  const teacherView = await tv.evaluate(() => ({
    nav: [...document.querySelectorAll('.side-nav button')].map((b) => b.querySelector('.nt b').firstChild.textContent.trim()).join('|'),
    labels: [...document.querySelectorAll('.course.open .lb')].map((l) => l.firstChild.textContent).join('|'),
    caption: document.querySelector('.stage .caption')?.textContent ?? '',
    outline: !!document.querySelector('.stage .tpl-preview iframe'),
    grips: document.querySelectorAll('.grip').length,
  }))
  for (const [vp, tag] of [
    [{ width: 1366, height: 768 }, '1366'],
    [{ width: 1920, height: 1080 }, '1920'],
  ]) {
    await tv.setViewport(vp)
    await sleep(400)
    await tv.screenshot({ path: `${V43}/7-teacher-course-${tag}.png` })
  }
  await tv.setViewport({ width: 1366, height: 768 })
  check(
    '先生の画面：左の見出しは「コース」と「書き方のチェック」の2つ。はじめのコースが開いていて、指導教員・お知らせ・ひな形（並べ替えのつまみはない）。右に「学生が最初に見る本文」の見本',
    teacherView.nav === 'コース|書き方のチェック' && teacherView.labels === '指導教員|お知らせ|ひな形' && teacherView.caption.startsWith('見本学生が最初に見る本文（映画・舞台衣装デザイナー コース）') && teacherView.outline && teacherView.grips === 0,
    JSON.stringify(teacherView),
  )
  check(
    '先生の画面のはじめに見えるのは、入力欄2・ボタン7前後・12px以下の字0（mockups/v43 案B：入力欄2・ボタン7）',
    teacherCount.fields === 2 && teacherCount.buttons >= 6 && teacherCount.buttons <= 8 && teacherCount.small === 0,
    JSON.stringify(teacherCount),
  )
  await nav(tv, '書き方のチェック')
  await sleep(200)
  for (const [vp, tag] of [
    [{ width: 1366, height: 768 }, '1366'],
    [{ width: 1920, height: 1080 }, '1920'],
  ]) {
    await tv.setViewport(vp)
    await sleep(350)
    await tv.screenshot({ path: `${V43}/8-teacher-words-${tag}.png` })
  }
  await tv.setViewport({ width: 1366, height: 768 })
  const teacherLonelyAll = [...(await lonelyAtWidths(tv)), ...(await smallText(tv))]
  await nav(tv, 'コース')
  teacherLonelyAll.push(...(await lonelyAtWidths(tv)), ...(await smallText(tv)))
  check('先生の画面も、1字だけの行がなく、字は13px以上', teacherLonelyAll.length === 0, teacherLonelyAll.slice(0, 6).join(' / '))
  await (await tv.$('.course.open textarea.notice')).type('先生のお知らせ')
  await sleep(200)
  const teacherBar = await tv.evaluate(() => ({ head: document.querySelector('.dirty-bar .tx b')?.textContent, buttons: [...document.querySelectorAll('.dirty-bar button')].map((b) => b.textContent).join('|'), count: document.querySelector('.side-nav .cnt')?.textContent.replace('保存していない変更', '') }))
  await tv.screenshot({ path: `${V43}/9-teacher-dirty-1366.png` })
  check('先生の画面でも、直すと画面の下に帯（「まだ学生に届いていない変更が1か所あります」と保存のボタン）。左の見出しの「コース」に 1', teacherBar.head === 'まだ学生に届いていない変更が1か所あります' && teacherBar.buttons === '変更を見る|保存して学生に反映' && teacherBar.count === '1', JSON.stringify(teacherBar))
  await v43.close()

  // 下書きのひな形を、学生と同じ紙面で作る画面（mockups/v44 案A。scripts/e2e/templateMode.mjs）
  await templateModeAdmin(browser, check)
})

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 件 合格`)
process.exitCode = failed.length ? 1 : 0
