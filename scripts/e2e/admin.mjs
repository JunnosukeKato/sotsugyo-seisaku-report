// 管理ページの通しの動作確認（試験用サーバーで。Edge を自動で操作する）
// 使い方: node scripts/e2e/admin.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { withEdge } from '../poc/edge.mjs'

const OUT = 'poc-output/e2e'
// 先生のお試しで見つかった問題の直し（確認の言葉・知らせ）の画面
const SHOTS = 'poc-output/admin-fixes'
mkdirSync(OUT, { recursive: true })
mkdirSync(SHOTS, { recursive: true })
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

await withEdge(async (browser) => {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  const dialogs = dialogLog(page)
  await page.setViewport({ width: 1440, height: 900 })
  await page.goto('http://localhost:5173/admin.html', { waitUntil: 'networkidle0' })
  await page.evaluate(() => {
    localStorage.removeItem('sotsugyo-admin-mock')
    localStorage.removeItem('sotsugyo-admin-year')
  })
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.admin .form')

  const previewText = () => page.evaluate(() => document.querySelector('.preview iframe').contentDocument.body.innerText.replace(/\s/g, ''))
  const fieldInput = (label) => page.evaluateHandle((label) => [...document.querySelectorAll('.f')].find((f) => f.querySelector('.l')?.textContent.startsWith(label)).querySelector('input, textarea'), label)
  const clickButton = (text) => page.evaluate((text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text)).click(), text)
  const messageText = (p = page) => p.evaluate(() => document.querySelector('.message')?.textContent ?? '')
  const hasDirty = (p = page) => p.evaluate(() => !!document.querySelector('.badge.warn'))
  /** ページを閉じる・読み込み直すときに、ブラウザの確認が出るか（beforeunload が止められるか） */
  const leaveGuarded = (p = page) =>
    p.evaluate(() => {
      const e = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(e)
      return e.defaultPrevented
    })
  const savedYear = (year) => page.evaluate((year) => JSON.parse(localStorage.getItem('sotsugyo-admin-mock')).years.find((y) => y.year === year), year)
  /**
   * 見出し（2段。mockups/v35-admin ① 案A）が画面の幅に入っているか：ページが横にはみ出さない・どちらの段も入りきる・
   * 「この年度を学生に公開」（なければ保存のボタン）が上の段にあり、画面の中に見える
   */
  const headerFits = (p = page) =>
    p.evaluate(() => {
      const rows = [...document.querySelectorAll('.admin-header > div')]
      const buttons = [...document.querySelectorAll('.admin-header .head-row button')]
      const main = buttons.find((b) => b.textContent.includes('この年度を学生に公開')) ?? buttons.find((b) => b.textContent.startsWith('保存'))
      const r = main?.getBoundingClientRect()
      return {
        scrollWidth: document.documentElement.scrollWidth,
        width: innerWidth,
        rows: rows.map((x) => `${x.className}:${x.scrollWidth}/${x.clientWidth}`),
        fits: document.documentElement.scrollWidth <= innerWidth && rows.length === 2 && rows.every((x) => x.scrollWidth <= x.clientWidth + 1),
        main: main?.textContent ?? '',
        mainVisible: !!r && r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      }
    })
  /** 見出しの下の段のリンクの並び（「この年度を削除」があれば、その位置も分かる） */
  const subLinks = (p = page) => p.evaluate(() => [...document.querySelectorAll('.admin-header .head-sub .link')].map((b) => b.textContent.trim()).join('|'))

  check('公開中の2026年度が開く', await page.evaluate(() => document.querySelector('.badge.pub')?.textContent === '公開中'))
  const firstHeader = await page.evaluate(() => ({
    top: [...document.querySelectorAll('.admin-header .head-row > *')].map((e) => e.textContent.trim() || e.className).join('|'),
    sub: [...document.querySelectorAll('.admin-header .head-sub > *')].map((e) => e.textContent.trim() || e.className).join('|'),
  }))
  check(
    '見出しは2段：上の段に年度・状態の印・保存、下の段にログイン中の人・試験用サーバーと、変更履歴・先生の登録・新年度を作成（公開中の年度には「この年度を削除」は出ない）',
    firstHeader.top === '卒業制作報告書 管理ページ|使い方|2026年度（公開中）|公開中|spacer|保存して学生に反映' &&
      firstHeader.sub === 'ログイン中：|admin@example.ac.jp|試験用サーバー|spacer|変更履歴|sep|先生の登録|sep|新年度を作成',
    JSON.stringify(firstHeader),
  )
  // 「？ 使い方」（見出しの横。右の端に先生用の使い方の欄が出る。mockups/v27 案A）
  await page.click('.admin-header .help-open')
  await page.waitForSelector('.help-dock')
  const adminHelp = await page.evaluate(() => ({
    topics: document.querySelectorAll('.help-dock .help-list button').length,
    pressed: document.querySelector('.admin-header .help-open')?.getAttribute('aria-pressed'),
    pdf: [...document.querySelectorAll('.help-dock .help-foot a')].map((a) => `${a.textContent} ${a.getAttribute('href')} ${a.getAttribute('target')}`),
    form: !!document.querySelector('.admin .form'),
    label: document.querySelector('.help-dock .help-title small')?.textContent ?? '',
    foot: document.querySelector('.help-dock .help-foot p')?.textContent ?? '',
  }))
  check(
    '見出しの横の「？ 使い方」で、右の端に先生・管理者用の使い方が出る（項目11・相談先はほかの管理者と引き継ぎ手順・いちばん下に印刷用の手引き（先生用・管理者用の PDF）を新しいタブで）',
    adminHelp.topics === 11 && adminHelp.pressed === 'true' && adminHelp.form && adminHelp.label === '先生・管理者用' && adminHelp.foot.includes('ほかの管理者') &&
      adminHelp.pdf.join('|') === '先生用 https://junnosukekato.github.io/sotsugyo-seisaku-report/guides/teacher-guide.pdf _blank|管理者用 https://junnosukekato.github.io/sotsugyo-seisaku-report/guides/admin-guide.pdf _blank',
    JSON.stringify(adminHelp),
  )
  const dockTop = await page.evaluate(() => ({ dock: document.querySelector('.help-dock').getBoundingClientRect().top, header: document.querySelector('.admin-header').getBoundingClientRect().bottom }))
  check('使い方の欄は、2段の見出しのすぐ下から出る（見出しの下の段に重ならない）', dockTop.dock === dockTop.header && dockTop.header > 80, JSON.stringify(dockTop))
  await page.type('.help-dock .help-search input', '反映 されない')
  await new Promise((r) => setTimeout(r, 300))
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

  // お知らせを書いてから消すと、「保存していない変更があります」も消える（空のお知らせと、お知らせなしは同じ）
  const firstNotice = await page.$('.form .course .notice-field textarea')
  await firstNotice.type('あ')
  const dirtyWhileTyped = await hasDirty()
  await firstNotice.press('Backspace')
  await sleep(200)
  check('お知らせを書いてから消すと、「保存していない変更があります」が消える', dirtyWhileTyped && !(await hasDirty()))
  // 詳細設定の数の欄は、消して打ち直せる（「0」が入って「0600」にならない）
  await page.evaluate(() => (document.querySelector('details.details').open = true))
  const minChars = await page.$('.details .range input')
  await minChars.focus()
  await page.keyboard.down('Control')
  await page.keyboard.press('KeyA')
  await page.keyboard.up('Control')
  await minChars.press('Backspace')
  const cleared = await minChars.evaluate((el) => el.value)
  await minChars.type('600')
  const retyped = await minChars.evaluate((el) => el.value)
  await page.evaluate(() => (document.querySelector('details.details').open = false))
  check('数の欄を消すと空のままで、打ち直すと「600」になる（「0600」にならない）', cleared === '' && retyped === '600' && !(await hasDirty()), `${JSON.stringify(cleared)} → ${retyped}`)

  // 共通の題目を変えると、見本の表紙と抄録にすぐ反映される
  const title = await fieldInput('共通の題目')
  await title.evaluate((el) => el.select())
  await title.type('卒業イベント「試験」について')
  await new Promise((r) => setTimeout(r, 300))
  const text = await previewText()
  check('題目の変更が見本に反映される', (text.match(/卒業イベント「試験」について/g) ?? []).length === 2)
  check('保存していない変更があると表示される', await page.evaluate(() => !!document.querySelector('.badge.warn')))

  // 指導教員を追加する
  const tag = await page.$('.tag-input')
  await tag.type('文化 太郎')
  await tag.press('Enter')
  await new Promise((r) => setTimeout(r, 300))
  check('指導教員を追加すると見本の抄録に出る', (await previewText()).includes('文化太郎'))

  // サブタイトルの形式から学生の入力部分を消すとエラーになり、保存ボタンが押せても公開中は保存できない
  await clickButton('保存して学生に反映')
  await page.waitForFunction(() => document.querySelector('.message.ok'))
  check('公開中の年度を保存できる', await page.evaluate(() => document.querySelector('.message.ok').textContent.includes('反映')))
  const saveConfirm = dialogs.last()
  check(
    '公開中の年度の保存の確認に、何が変わるか・届くまでの時間・書き始めた学生の原稿のことが出る',
    saveConfirm.includes('・共通の題目') && saveConfirm.includes('・映画・舞台衣装デザイナー コースの指導教員') && saveConfirm.includes('1分ほどで届きます') && saveConfirm.includes('すでに書き始めた学生の原稿（書いた文章）は変わりません'),
    saveConfirm.replace(/\n/g, '⏎'),
  )

  // 下書きのひな形を編集する（コースのカードの「編集する」から）
  await page.evaluate(() => document.querySelector('.tpl-row button').click())
  await page.waitForSelector('.tpl-modal')
  const tplFoot = await page.evaluate(() => document.querySelector('.tpl-foot .hint').textContent)
  check('公開中の年度のひな形の窓の案内は、「保存して学生に反映」で届くと言う', tplFoot.includes('上の「保存して学生に反映」で学生のツールに届きます'), tplFoot)
  // 何も直していなければ、Esc ですぐ閉じる（確かめない）
  const before = dialogs.count()
  await page.keyboard.press('Escape')
  await sleep(200)
  check('何も直していないひな形の窓は、Esc ですぐ閉じる', !(await page.$('.tpl-modal')) && dialogs.count() === before)
  await page.evaluate(() => document.querySelector('.tpl-row button').click())
  await page.waitForSelector('.tpl-modal')
  await page.evaluate(() => document.querySelectorAll('.tpl-modal .row')[1].click())
  await clickButton('＋ 小見出し')
  await page.keyboard.type('試験の小見出し')
  await new Promise((r) => setTimeout(r, 500))
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
  await subheading.evaluate((el, text) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, 'あ'.repeat(101))
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
  const setRowText = (handle, text) =>
    handle.evaluate((el, text) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, text)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, text)
  await setRowText(firstRow, '')
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
  await setRowText(firstRow, firstRowTitle)
  await subheading.evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(el, '試験の小見出し')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await sleep(200)
  const fixedFoot = await footReason()
  check('直すと、となりの理由は消え、下の案内に戻る', fixedFoot.why === null && fixedFoot.hint, JSON.stringify(fixedFoot))
  await clickButton('反映する')
  await new Promise((r) => setTimeout(r, 300))
  const summary = await page.evaluate(() => document.querySelector('.tpl-row b').textContent)
  check('反映すると、コースのカードのひな形の要約が変わる', summary.includes('小見出し4'), summary)
  check('ひな形を反映した知らせは、公開中の年度では「保存して学生に反映」を押すと届くと言う', (await messageText()) === 'ひな形を反映しました。上の「保存して学生に反映」を押すと、学生のツールに届きます', await messageText())
  await clickButton('保存して学生に反映')
  await page.waitForFunction(() => document.querySelector('.message.ok')?.textContent.includes('反映'))
  check('ひな形を保存できる（確認に、ひな形はこれからコースを選ぶ学生に入ると出る）', dialogs.last().includes('・映画・舞台衣装デザイナー コースの下書きのひな形') && dialogs.last().includes('これからコースを選ぶ学生に入ります'), dialogs.last().replace(/\n/g, '⏎'))

  // 書き間違えやすい語（ボタンから開く窓。mockups/v17 案3）
  const wordsLabel = () => page.evaluate(() => document.querySelector('.words-btn span').textContent)
  check('書き間違えやすい語のボタンに、最初から入っている語の数が出る', (await wordsLabel()) === '13語（エラー7・要確認6）', await wordsLabel())
  await page.click('.words-btn')
  await page.waitForSelector('.words-modal')
  const marks = () => page.evaluate(() => [...document.querySelectorAll('.wtry mark')].map((m) => `${m.className}:${m.textContent}`).join(','))
  check('窓の試しの文で、エラーと注意の語に印が付く', (await marks()) === 'e:見頃,w:記事', await marks())
  await clickButton('＋ 語を足す')
  const lastRow = await page.$$('.wtable tbody tr').then((rows) => rows.at(-1))
  const [wrongIn, rightIn] = await lastRow.$$('input')
  await wrongIn.type('芯地(仮)')
  await rightIn.type('芯地')
  const trial = await page.$('.wtry input')
  await trial.evaluate((el) => el.select())
  await trial.type('前見頃に芯地(仮)を貼った。')
  await new Promise((r) => setTimeout(r, 200))
  check('足した語（記号を含む）も、試しの文で印が付く', (await marks()) === 'e:見頃,e:芯地(仮)', await marks())
  await page.screenshot({ path: `${OUT}/admin-words.png` })
  // 書き間違えやすい語の窓も、直したあとの Esc は確かめる（キャンセルなら閉じない）
  dialogs.answer(false)
  await page.keyboard.press('Escape')
  await sleep(200)
  dialogs.answer(true)
  check('書き間違えやすい語の窓も、直したあとに Esc を押すと確かめ、キャンセルなら閉じない', dialogs.last() === '直した内容は反映されずに消えます。閉じますか？' && !!(await page.$('.words-modal')) && (await leaveGuarded()))
  // 空の行は、「反映する」のときに外すと示す
  await clickButton('＋ 語を足す')
  await clickButton('反映する')
  await new Promise((r) => setTimeout(r, 300))
  check('使わない行（空の行など）は、「反映する」のときに行の番号を示して確かめる', dialogs.last().startsWith('次の行は使わずに外します。') && dialogs.last().includes('・15行目：空の行'), dialogs.last().replace(/\n/g, '⏎'))
  check('反映すると、ボタンの語の数が変わる', (await wordsLabel()) === '14語（エラー8・要確認6）', await wordsLabel())
  check('書き間違えやすい語を反映した知らせも、公開中の年度では「保存して学生に反映」を押すと届くと言う', (await messageText()).startsWith('書き間違えやすい語を反映しました。上の「保存して学生に反映」'), await messageText())
  await clickButton('保存して学生に反映')
  await page.waitForFunction(() => document.querySelector('.message.ok')?.textContent.includes('反映しました'))
  const savedWords = await page.evaluate(() => JSON.parse(localStorage.getItem('sotsugyo-admin-mock')).years.find((y) => y.year === 2026).config.wordChecks)
  check('書き間違えやすい語が年度の設定に保存される', savedWords?.length === 14 && savedWords.at(-1).wrong === '芯地(仮)')

  // コースのお知らせ（コースのカードに書く。mockups/v21 案A）
  const noticeBox = await page.$('.form .course .notice-field textarea')
  await noticeBox.type('管理者が書いたお知らせ')
  await clickButton('保存して学生に反映')
  await page.waitForFunction(() => document.querySelector('.message.ok')?.textContent.includes('反映しました'))
  const savedNotice = await page.evaluate(() => JSON.parse(localStorage.getItem('sotsugyo-admin-mock')).years.find((y) => y.year === 2026).config.courses[0].notice)
  check('コースのカードに書いたお知らせが、そのコースに保存される', savedNotice === '管理者が書いたお知らせ', savedNotice)

  // 学生のドライブ保存を止める（詳細設定の中。Google の障害のとき。mockups/v22 ② 案B）
  const savedDriveSave = () => page.evaluate(() => JSON.parse(localStorage.getItem('sotsugyo-admin-mock')).years.find((y) => y.year === 2026).config.driveSave)
  await page.evaluate(() => (document.querySelector('details.details').open = true))
  await clickButton('止める（Google の障害のとき）')
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
  await page.evaluate(() => (document.querySelector('details.details').open = true))
  const pagesField = await page.evaluate(() => {
    const f = [...document.querySelectorAll('.f')].find((x) => x.querySelector('.l')?.textContent === '作品写真のページ数の上限')
    return { value: f?.querySelector('input')?.value, placeholder: f?.querySelector('input')?.placeholder, hint: f?.querySelector('.hint')?.textContent, old: [...document.querySelectorAll('.f .l')].some((l) => l.textContent.includes('作品写真の上限')) }
  })
  check('詳細設定に「作品写真のページ数の上限」：はじめは空（「上限なし」）で、「空なら上限なし（1ページに写真4枚まで）」。前の「作品写真の上限（枚）」はない', pagesField.value === '' && pagesField.placeholder === '上限なし' && pagesField.hint === '空なら上限なし（1ページに写真4枚まで）' && !pagesField.old, JSON.stringify(pagesField))
  const pagesInput = await fieldInput('作品写真のページ数の上限')
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
  await page.evaluate(() => (document.querySelector('details.details').open = false))

  // 先生の画面：ひな形だけを編集・保存できる
  const teacher = await context.newPage()
  const teacherDialogs = dialogLog(teacher)
  await teacher.setViewport({ width: 1440, height: 900 })
  await teacher.goto('http://localhost:5173/admin.html?as=teacher', { waitUntil: 'networkidle0' })
  await teacher.waitForSelector('.teacher-main')
  check('先生には、ひな形の一覧だけの画面が出る（年度の設定の欄は出ない）', !(await teacher.$('.form')) && (await teacher.$$('.teacher-main .tpl-row')).length > 0)
  check('先生の画面にも、ソースコードの場所のリンクが出る（AGPL）', await teacher.evaluate(() => !!document.querySelector('.teacher-main .source a')?.href))
  const teacherHeader = await teacher.evaluate(() => ({
    top: [...document.querySelectorAll('.admin-header .head-row > *')].map((e) => e.textContent.trim() || e.className).join('|'),
    sub: [...document.querySelectorAll('.admin-header .head-sub > *')].map((e) => e.textContent.trim() || e.className).join('|'),
  }))
  await teacher.setViewport({ width: 1280, height: 720 })
  await sleep(300)
  const teacherFit = await headerFits(teacher)
  await teacher.setViewport({ width: 1440, height: 900 })
  check(
    '先生の画面の見出しも2段（ログイン中の人は下の段。変更履歴・先生の登録・新年度を作成・削除はない）で、1280×720 に入る',
    teacherHeader.top === '卒業制作報告書 管理ページ|使い方|2026年度（公開中）|公開中|spacer|保存して学生に反映' && teacherHeader.sub === 'ログイン中：|sensei@example.ac.jp（先生）|試験用サーバー' && teacherFit.fits && teacherFit.mainVisible,
    JSON.stringify({ teacherHeader, teacherFit }),
  )
  await teacher.click('.admin-header .help-open')
  await teacher.waitForSelector('.help-dock')
  const teacherHelp = await teacher.evaluate(() => ({ topics: document.querySelectorAll('.help-dock .help-list button').length, main: !!document.querySelector('.admin.help-on .teacher-main'), label: document.querySelector('.help-dock .help-title small')?.textContent ?? '', foot: document.querySelector('.help-dock .help-foot p')?.textContent ?? '' }))
  check('先生の画面にも、見出しの横に「？ 使い方」があり、右の端に先生用の使い方が出る（項目11・相談先は管理者。その分、画面を左に寄せる）', teacherHelp.topics === 11 && teacherHelp.main && teacherHelp.label === '先生用' && teacherHelp.foot.includes('管理者に相談'), JSON.stringify(teacherHelp))
  await teacher.keyboard.press('Escape')
  await teacher.waitForFunction(() => !document.querySelector('.help-dock'), { timeout: 5000 }).catch(() => {})
  check('Esc でも使い方の欄が閉じる', !(await teacher.$('.help-dock')))
  await teacher.evaluate(() => document.querySelector('.teacher-main .tpl-row button').click())
  await teacher.waitForSelector('.tpl-modal')
  await teacher.evaluate(() => [...document.querySelectorAll('.tpl-modal .row input')].at(-1).focus())
  await teacher.evaluate(() => [...document.querySelectorAll('.tpl-modal .adds button')].find((b) => b.textContent.includes('説明')).click())
  await teacher.keyboard.type('先生が足した説明')
  await teacher.evaluate(() => [...document.querySelectorAll('.tpl-foot button')].find((b) => b.textContent.includes('反映する')).click())
  await sleep(200)
  // 先生の画面でも、反映したら知らせる（公開中なので「保存して学生に反映」で届く）
  const teacherApplied = await messageText(teacher)
  await teacher.screenshot({ path: `${SHOTS}/2-teacher-applied-notice.png` })
  check('先生の画面でも、ひな形を反映すると知らせが出る（「保存して学生に反映」を押すと届く）', teacherApplied === 'ひな形を反映しました。上の「保存して学生に反映」を押すと、学生のツールに届きます', teacherApplied)
  // 先生もコースのお知らせを書ける
  const teacherNotice = await teacher.$('.teacher-main .notice-field textarea')
  await teacherNotice.evaluate((el) => el.select())
  await teacherNotice.type('先生が書いたお知らせ')
  // 先生も書き間違えやすい語を編集できる（足した語を消す）
  await teacher.click('.words-btn')
  await teacher.waitForSelector('.words-modal')
  await teacher.evaluate(() => [...document.querySelectorAll('.wtable tbody tr')].at(-1).querySelector('.x').click())
  await teacher.evaluate(() => [...document.querySelectorAll('.words-modal button')].find((b) => b.textContent.includes('反映する')).click())
  // 長すぎるお知らせは、送る前に、本番のサーバーと同じ言葉で知らせる（保存しない）
  const setNotice = (text) =>
    teacher.evaluate((text) => {
      const t = document.querySelector('.teacher-main .notice-field textarea')
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, text)
      t.dispatchEvent(new Event('input', { bubbles: true }))
    }, text)
  await setNotice('あ'.repeat(1200))
  await teacher.evaluate(() => [...document.querySelectorAll('.admin-header button')].find((b) => b.textContent.includes('保存して学生に反映')).click())
  await sleep(300)
  check('先生の長すぎるお知らせは、保存せずに字数を示して知らせる', (await messageText(teacher)) === '「映画・舞台衣装デザイナー」のお知らせが長すぎます（1000字まで。今は1200字）', await messageText(teacher))
  await setNotice('先生が書いたお知らせ')
  await teacher.evaluate(() => [...document.querySelectorAll('.admin-header button')].find((b) => b.textContent.includes('保存して学生に反映')).click())
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
  const staleTitle = await fieldInput('共通の題目')
  await staleTitle.type('（古い画面）')
  await clickButton('保存して学生に反映')
  await new Promise((r) => setTimeout(r, 500))
  await page.waitForFunction(() => document.querySelector('.message.ng'))
  const staleMessage = await page.$eval('.message.ng', (e) => e.textContent)
  check('先生が保存したあとに、古い画面のまま管理者が保存しようとすると、保存せずに知らせる', staleMessage.includes('ほかの人（sensei@example.ac.jp）'), staleMessage)
  const mergedDraft = await page.evaluate(() => ({ title: [...document.querySelectorAll('.f')].find((f) => f.querySelector('.l')?.textContent.startsWith('共通の題目')).querySelector('input').value, notice: document.querySelector('.form .course .notice-field textarea').value }))
  await page.screenshot({ path: `${SHOTS}/3-other-person-saved.png` })
  check(
    'そのとき、先生が保存した内容を読み込み、管理者の変更（題目）を入れ直す（保存はしない）',
    staleMessage.includes('あなたの変更（共通の題目）を入れ直しました') && mergedDraft.title === '卒業イベント「試験」について（古い画面）' && mergedDraft.notice === '先生が書いたお知らせ' && (await hasDirty()) && (await savedYear(2026)).config.commonTitle === '卒業イベント「試験」について',
    JSON.stringify(mergedDraft),
  )
  await clickButton('保存して学生に反映')
  await page.waitForFunction(() => document.querySelector('.message.ok'))
  const mergedConfirm = dialogs.last()
  check('入れ直した内容は、もう一度押すと保存できる（確認には管理者の変更だけが出る）', mergedConfirm.includes('・共通の題目\n\n') && (await savedYear(2026)).config.commonTitle === '卒業イベント「試験」について（古い画面）', mergedConfirm.replace(/\n/g, '⏎'))
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.admin .form')
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
  await second.goto('http://localhost:5173/admin.html', { waitUntil: 'networkidle0' })
  await second.waitForSelector('.admin .form')
  const secondNotice = await second.$('.form .course .notice-field textarea')
  await secondNotice.evaluate((el) => el.select())
  await secondNotice.type('別のタブで書いたお知らせ')
  await second.evaluate(() => [...document.querySelectorAll('.admin-header button')].find((b) => b.textContent.includes('保存して学生に反映')).click())
  await second.waitForFunction(() => document.querySelector('.message.ok'))
  await second.close()
  await page.bringToFront()
  const firstTitle = await fieldInput('共通の題目')
  await firstTitle.evaluate((el) => el.select())
  await firstTitle.type('卒業イベント「試験」について')
  await clickButton('保存して学生に反映')
  await page.waitForFunction(() => document.querySelector('.message.ng'))
  const tabMessage = await messageText()
  await page.screenshot({ path: `${SHOTS}/4-another-tab-saved.png` })
  const tabNotice = await page.evaluate(() => document.querySelector('.form .course .notice-field textarea').value)
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
  await third.goto('http://localhost:5173/admin.html', { waitUntil: 'networkidle0' })
  await third.waitForSelector('.admin .form')
  const thirdNotice = await third.$('.form .course .notice-field textarea')
  await thirdNotice.evaluate((el) => el.select())
  await thirdNotice.type('3つめのタブのお知らせ')
  await third.evaluate(() => [...document.querySelectorAll('.admin-header button')].find((b) => b.textContent.includes('保存して学生に反映')).click())
  await third.waitForFunction(() => document.querySelector('.message.ok'))
  await third.close()
  await page.bringToFront()
  const myNotice = await page.$('.form .course .notice-field textarea')
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
  await page.waitForSelector('.admin .form')
  const freshTitle = await fieldInput('共通の題目')

  // 新年度を作る → 準備中 → 公開
  // 保存していない変更があるときは、確かめる（新年度は保存されている内容からコピーするため）
  await freshTitle.type('（保存しない）')
  dialogs.answer(false)
  await clickButton('新年度を作成')
  dialogs.answer(true)
  await sleep(200)
  check('保存していない変更があるときに「新年度を作成」を押すと確かめる（キャンセルなら作らない）', dialogs.last().startsWith('保存していない変更があります。新年度は保存されている内容からコピーして作るため') && !(await page.$('.modal')), dialogs.last())
  await clickButton('新年度を作成')
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
  // 知らせは、同じ緑の枠のまま箇条書き。項目ごとに、直す場所を小さな字で添える（mockups/v35-admin ③ 案A）
  const noticeList = await page.evaluate(() => {
    const box = document.querySelector('.form .message.ok.list')
    return {
      head: box?.querySelector('.h')?.textContent,
      detail: box?.querySelector('p')?.textContent,
      items: [...(box?.querySelectorAll('li') ?? [])].map((li) => `${li.firstChild?.textContent}／${li.querySelector('small')?.textContent}`),
    }
  })
  check(
    '新年度の知らせは箇条書きで、項目ごとに「場所：…」を添える',
    noticeList.head === '2027年度を作成しました（2026年度の設定のコピーです）。' &&
      noticeList.detail === '次の項目は2026年度のままです。確かめて直してください。' &&
      noticeList.items.join('|') ===
        '共通の題目／場所：この下の「毎年設定する項目」のいちばん上|最終締切（2027年1月20日（水）。2026年度と同じ日付）／場所：共通の題目のすぐ下|お知らせ（映画・舞台衣装デザイナー コース）／場所：コースのカードの「このコースの学生へのお知らせ」',
    JSON.stringify(noticeList),
  )
  check('前の年度の締切のままなら、年度の期間の外だと確認が出る', problemsText.includes('確認：最終締切（2027年1月20日）が、2027年度（2027年4月1日〜2028年3月31日）の外です'), problemsText)
  check('作ったばかりの準備中の年度には、見出しの下の段の「変更履歴」のとなりに「この年度を削除」が出る', (await subLinks()) === '変更履歴|この年度を削除|先生の登録|新年度を作成', await subLinks())
  await page.screenshot({ path: `${OUT}/admin-2027.png` })
  // 準備中の年度では、ひな形の窓の案内も「公開してから届く」と言う
  await page.evaluate(() => document.querySelector('.tpl-row button').click())
  await page.waitForSelector('.tpl-modal')
  const draftFoot = await page.evaluate(() => document.querySelector('.tpl-foot .hint').textContent)
  await page.keyboard.press('Escape')
  await sleep(200)
  check('準備中の年度のひな形の窓は、学生に届くのは公開してからだと言う', draftFoot === '「反映する」の後、上の「保存」で保存します。学生に届くのは、この年度を学生に公開してからです。' && !(await page.$('.tpl-modal')), draftFoot)
  // 締切の日付の欄：年は4桁まで（「20280119」と打つと 2028-01-19 になる。年が6桁にならない）
  const dateInput = await page.$('input[type=date]')
  await dateInput.click({ offset: { x: 12, y: 10 } })
  await page.keyboard.type('20280119')
  await sleep(300)
  const typedDate = await dateInput.evaluate((el) => el.value)
  const afterDate = await page.evaluate(() => document.querySelector('.problems')?.textContent ?? '')
  check('締切の欄に「20280119」と打つと 2028-01-19 になり、期間の外の確認も消える', typedDate === '2028-01-19' && !afterDate.includes('最終締切'), `${typedDate} / ${afterDate}`)
  // ノートパソコンの画面（1280×720）でも、「保存していない変更があります」が出たまま、見出しが横にはみ出さず、「この年度を学生に公開」が見える
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
  check('公開すると前の年度は「終了」になる', options.join(',') === '2027年度（公開中）,2026年度（終了）', options.join(','))

  // 先生の登録：メーリングリストの宛先をまとめて貼り付ける（mockups/v20 案3）
  await clickButton('先生の登録')
  await page.waitForSelector('.modal.members .member-list li')
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
  // 入力したまま窓の外を押すと、消えてよいか確かめる（キャンセルなら閉じない）
  dialogs.answer(false)
  await page.mouse.click(10, 450)
  await sleep(200)
  dialogs.answer(true)
  check('登録の欄に入力したまま窓の外を押すと確かめ、キャンセルなら閉じない（入力も残る）', dialogs.last().startsWith('登録の欄に入力したメールアドレスは、まだ登録していません') && !!(await page.$('.modal.members')) && (await box.evaluate((el) => el.value)).includes('someone@gmail.com'))
  await clickButton('2人を登録する')
  await page.waitForFunction(() => document.querySelectorAll('.member-list li').length >= 4 && !document.querySelector('.bulk-table'))
  const registered = await page.evaluate(() => [...document.querySelectorAll('.member-list li .who')].map((w) => w.textContent))
  check('「2人を登録する」で、名前をメモにして先生として登録される', registered.some((w) => w.includes('t-bunka@bunka-wu.ac.jp') && w.includes('文化 太郎')) && registered.some((w) => w.includes('h-isho@bunka-wu.ac.jp')) && !registered.some((w) => w.includes('00zz901')))
  // 試験用サーバーでは、試験用の先生と同じ example.ac.jp のアドレスも登録できる
  await box.type('tester@example.ac.jp')
  await clickButton('登録する')
  await page.waitForFunction(() => [...document.querySelectorAll('.member-list li .who')].some((w) => w.textContent.includes('tester@example.ac.jp')))
  check('試験用サーバーでは、example.ac.jp のアドレスも登録できる', true)
  // 役割を変えるときは確かめ、変えたら知らせる。管理者が1人だけになるときは、2人以上にするよう伝える
  const roleSelect = (email) => page.evaluateHandle((email) => [...document.querySelectorAll('.member-list li')].find((li) => li.textContent.includes(email)).querySelector('select'), email)
  await (await roleSelect('tester@example.ac.jp')).select('管理者')
  await page.waitForFunction(() => document.querySelector('.modal.members .message.ok'))
  const promoted = dialogs.last()
  const promotedInfo = await page.$eval('.modal.members .message.ok', (e) => e.textContent)
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
  const membersLead = await page.evaluate(() => document.querySelector('.modal.members .lead').textContent)
  check('先生ができることの説明に、お知らせも入っている', membersLead.includes('「下書きのひな形」「お知らせ」と「書き間違えやすい語」を編集できます'), membersLead)
  await clickButton('閉じる')

  // 変更履歴
  await clickButton('変更履歴')
  await page.waitForSelector('.history li')
  const history = await page.evaluate(() => [...document.querySelectorAll('.history li')].map((li) => li.textContent))
  check('変更履歴に操作が残る', history.some((h) => h.includes('公開')) && history.some((h) => h.includes('コピーして作成')), `${history.length}件`)
  await page.screenshot({ path: `${SHOTS}/8-history-summary.png` })
  check('変更履歴の行に、1つ前の記録から何が変わったかが出る', history.some((h) => h.includes('保存') && h.includes('変更：最終締切')), history.join(' | '))
  await page.keyboard.press('Escape')
  await sleep(200)
  // 保存していない変更があるときに「この内容を読み込む」を押すと確かめる（キャンセルなら読み込まない）
  const titleNow = await fieldInput('共通の題目')
  await titleNow.type('（書きかけ）')
  await clickButton('変更履歴')
  await page.waitForSelector('.history li')
  dialogs.answer(false)
  await page.evaluate(() => [...document.querySelectorAll('.history li button')].at(-1).click())
  await sleep(200)
  dialogs.answer(true)
  check('保存していない変更があるときに「この内容を読み込む」を押すと確かめる（キャンセルなら読み込まない）', dialogs.last() === '保存していない変更があります。破棄して、この時点の内容を読み込みますか？' && (await titleNow.evaluate((el) => el.value)).endsWith('（書きかけ）'))
  await page.keyboard.press('Escape')
  await sleep(200)

  // 間違えて作った準備中の年度は削除できる（mockups/v35-admin ② 案A：見出しの下の段の「変更履歴」のとなりの「この年度を削除」。一度も公開していない年度だけ）
  check('公開した年度（2027年度・公開中）には「この年度を削除」が出ない', (await subLinks()) === '変更履歴|先生の登録|新年度を作成', await subLinks())
  // 間違えて 2028年度を作った（保存していない「（書きかけ）」は、確かめて破棄する）
  await clickButton('新年度を作成')
  await page.waitForSelector('.modal')
  await clickButton('作成する')
  await page.waitForFunction(() => document.querySelector('.admin-header .sel').value === '2028' && document.querySelector('.badge.draft'))
  check('作った準備中の年度（2028年度）には「この年度を削除」が出る', (await subLinks()) === '変更履歴|この年度を削除|先生の登録|新年度を作成', await subLinks())
  const delTitle = await fieldInput('共通の題目')
  await delTitle.type('（消す年度）')
  const clickDelete = () => page.evaluate(() => document.querySelector('.admin-header .head-sub .link.del').click())
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
      (await subLinks()) === '変更履歴|先生の登録|新年度を作成',
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
  const endedNotice = await page.$('.form .course .notice-field textarea')
  await endedNotice.evaluate((el) => el.select())
  await endedNotice.type('終了した年度のお知らせ')
  await clickButton('保存')
  await page.waitForFunction(() => document.querySelector('.message.ok')?.textContent.startsWith('保存しました'))
  const endedConfirm = dialogs.last()
  check(
    '終了した年度の保存も確かめる（その年度に書き始めた学生のツールに届くと言う）',
    endedConfirm.startsWith('2026年度は「終了」した年度ですが、この年度に書き始めた学生は、今もこの設定を使っています。') && endedConfirm.includes('・映画・舞台衣装デザイナー コースのお知らせ'),
    endedConfirm.replace(/\n/g, '⏎'),
  )
  check('終了した年度を保存した知らせも、その年度に書き始めた学生に届くと言う', (await messageText()) === '保存しました（この年度に書き始めた学生のツールに、1分ほどで届きます）', await messageText())
  // 最後に開いた年度を覚えていて、開き直すとその年度から
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.admin .form')
  check('開き直すと、最後に見ていた年度（2026年度・終了）から開く', await page.evaluate(() => document.querySelector('.admin-header .sel').value === '2026' && document.querySelector('.badge.old')?.textContent === '終了'))
  await context.close()
})

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 件 合格`)
process.exitCode = failed.length ? 1 : 0
