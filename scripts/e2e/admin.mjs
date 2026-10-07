// 管理ページの通しの動作確認（試験用サーバーで。Edge を自動で操作する）
// 使い方: node scripts/e2e/admin.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { withEdge } from '../poc/edge.mjs'

const OUT = 'poc-output/e2e'
mkdirSync(OUT, { recursive: true })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  (${detail})` : ''}`)
}

await withEdge(async (browser) => {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  page.on('dialog', (d) => d.accept())
  await page.setViewport({ width: 1440, height: 900 })
  await page.goto('http://localhost:5173/admin.html', { waitUntil: 'networkidle0' })
  await page.evaluate(() => localStorage.removeItem('sotsugyo-admin-mock'))
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.admin .form')

  const previewText = () => page.evaluate(() => document.querySelector('.preview iframe').contentDocument.body.innerText.replace(/\s/g, ''))
  const fieldInput = (label) => page.evaluateHandle((label) => [...document.querySelectorAll('.f')].find((f) => f.querySelector('.l')?.textContent.startsWith(label)).querySelector('input, textarea'), label)
  const clickButton = (text) => page.evaluate((text) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text)).click(), text)

  check('公開中の2026年度が開く', await page.evaluate(() => document.querySelector('.badge.pub')?.textContent === '公開中'))
  // 「？ 使い方」（見出しの横。右の端に先生用の使い方の欄が出る。mockups/v27 案A）
  await page.click('.admin-header .help-open')
  await page.waitForSelector('.help-dock')
  const adminHelp = await page.evaluate(() => ({
    topics: document.querySelectorAll('.help-dock .help-list button').length,
    pressed: document.querySelector('.admin-header .help-open')?.getAttribute('aria-pressed'),
    pdf: [...document.querySelectorAll('.help-dock .help-foot a')].map((a) => `${a.textContent} ${a.getAttribute('href')} ${a.getAttribute('target')}`),
    form: !!document.querySelector('.admin .form'),
  }))
  check(
    '見出しの横の「？ 使い方」で、右の端に先生用の使い方が出る（項目10・いちばん下に印刷用の手引き（先生用・管理者用の PDF）を新しいタブで）',
    adminHelp.topics === 10 && adminHelp.pressed === 'true' && adminHelp.form &&
      adminHelp.pdf.join('|') === '先生用 https://junnosukekato.github.io/sotsugyo-seisaku-report/guides/teacher-guide.pdf _blank|管理者用 https://junnosukekato.github.io/sotsugyo-seisaku-report/guides/admin-guide.pdf _blank',
    JSON.stringify(adminHelp),
  )
  await page.type('.help-dock .help-search input', '反映 されない')
  await new Promise((r) => setTimeout(r, 300))
  const adminFound = await page.evaluate(() => ({ first: document.querySelector('.help-dock .help-results .t')?.textContent, marks: [...new Set([...document.querySelectorAll('.help-dock .help-results mark')].map((m) => m.textContent))] }))
  check('先生用の使い方でも「言葉で探す」が使え、言葉に印が付く（「反映 されない」→ 保存と反映）', adminFound.first === '保存と反映（学生に届くまで）' && adminFound.marks.includes('反映'), JSON.stringify(adminFound))
  await page.evaluate(() => document.querySelector('.help-dock .help-results button').click())
  await page.waitForSelector('.help-dock .help-topic')
  await new Promise((r) => setTimeout(r, 500))
  const adminTopic = await page.evaluate(() => {
    const i = document.querySelector('.help-dock .help-shot img')
    return { title: document.querySelector('.help-dock .help-topic h3')?.textContent, img: i?.getAttribute('src'), loaded: !!i && i.complete && i.naturalWidth > 0 }
  })
  // 画面の写真は、本番（Apps Script）では学生用ツールの URL から読む。開発中は開発サーバーの public/help/ から
  check('項目を開くと、画面の写真が出る（開発中は public/help/ から）', adminTopic.title === '保存と反映（学生に届くまで）' && adminTopic.img === '/help/admin-save.jpg' && adminTopic.loaded, JSON.stringify(adminTopic))
  await page.click('.help-dock .help-close')
  check('「閉じる」で使い方の欄が閉じる', !(await page.$('.help-dock')))

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

  // 下書きのひな形を編集する（コースのカードの「編集する」から）
  await page.evaluate(() => document.querySelector('.tpl-row button').click())
  await page.waitForSelector('.tpl-modal')
  await page.evaluate(() => document.querySelectorAll('.tpl-modal .row')[1].click())
  await clickButton('＋ 小見出し')
  await page.keyboard.type('試験の小見出し')
  await new Promise((r) => setTimeout(r, 500))
  const tplPreview = await page.evaluate(() => document.querySelector('.tpl-preview iframe').contentDocument.body.innerText)
  check('ひな形の編集画面で、足した小見出しが見本にすぐ出る', tplPreview.includes('試験の小見出し'))
  await page.screenshot({ path: `${OUT}/admin-template.png` })
  await clickButton('反映する')
  await new Promise((r) => setTimeout(r, 300))
  const summary = await page.evaluate(() => document.querySelector('.tpl-row b').textContent)
  check('反映すると、コースのカードのひな形の要約が変わる', summary.includes('小見出し4'), summary)
  await clickButton('保存して学生に反映')
  await page.waitForFunction(() => document.querySelector('.message.ok')?.textContent.includes('反映'))
  check('ひな形を保存できる', true)

  // 書き間違えやすい語（ボタンから開く窓。mockups/v17 案3）
  const wordsLabel = () => page.evaluate(() => document.querySelector('.words-btn span').textContent)
  check('書き間違えやすい語のボタンに、最初から入っている語の数が出る', (await wordsLabel()) === '13語（エラー7・注意6）', await wordsLabel())
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
  await clickButton('反映する')
  await new Promise((r) => setTimeout(r, 300))
  check('反映すると、ボタンの語の数が変わる', (await wordsLabel()) === '14語（エラー8・注意6）', await wordsLabel())
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

  // 先生の画面：ひな形だけを編集・保存できる
  const teacher = await context.newPage()
  teacher.on('dialog', (d) => d.accept())
  await teacher.setViewport({ width: 1440, height: 900 })
  await teacher.goto('http://localhost:5173/admin.html?as=teacher', { waitUntil: 'networkidle0' })
  await teacher.waitForSelector('.teacher-main')
  check('先生には、ひな形の一覧だけの画面が出る（年度の設定の欄は出ない）', !(await teacher.$('.form')) && (await teacher.$$('.teacher-main .tpl-row')).length > 0)
  check('先生の画面にも、ソースコードの場所のリンクが出る（AGPL）', await teacher.evaluate(() => !!document.querySelector('.teacher-main .source a')?.href))
  await teacher.click('.admin-header .help-open')
  await teacher.waitForSelector('.help-dock')
  const teacherHelp = await teacher.evaluate(() => ({ topics: document.querySelectorAll('.help-dock .help-list button').length, main: !!document.querySelector('.admin.help-on .teacher-main') }))
  check('先生の画面にも、見出しの横に「？ 使い方」があり、右の端に先生用の使い方が出る（その分、画面を左に寄せる）', teacherHelp.topics === 10 && teacherHelp.main, JSON.stringify(teacherHelp))
  await teacher.keyboard.press('Escape')
  await teacher.waitForFunction(() => !document.querySelector('.help-dock'), { timeout: 5000 }).catch(() => {})
  check('Esc でも使い方の欄が閉じる', !(await teacher.$('.help-dock')))
  await teacher.evaluate(() => document.querySelector('.teacher-main .tpl-row button').click())
  await teacher.waitForSelector('.tpl-modal')
  await teacher.evaluate(() => [...document.querySelectorAll('.tpl-modal .row input')].at(-1).focus())
  await teacher.evaluate(() => [...document.querySelectorAll('.tpl-modal .adds button')].find((b) => b.textContent.includes('説明')).click())
  await teacher.keyboard.type('先生が足した説明')
  await teacher.evaluate(() => [...document.querySelectorAll('.tpl-foot button')].find((b) => b.textContent.includes('反映する')).click())
  // 先生もコースのお知らせを書ける
  const teacherNotice = await teacher.$('.teacher-main .notice-field textarea')
  await teacherNotice.evaluate((el) => el.select())
  await teacherNotice.type('先生が書いたお知らせ')
  // 先生も書き間違えやすい語を編集できる（足した語を消す）
  await teacher.click('.words-btn')
  await teacher.waitForSelector('.words-modal')
  await teacher.evaluate(() => [...document.querySelectorAll('.wtable tbody tr')].at(-1).querySelector('.x').click())
  await teacher.evaluate(() => [...document.querySelectorAll('.words-modal button')].find((b) => b.textContent.includes('反映する')).click())
  await teacher.evaluate(() => [...document.querySelectorAll('.admin-header button')].find((b) => b.textContent.includes('保存して学生に反映')).click())
  await teacher.waitForFunction(() => document.querySelector('.message.ok'))
  // 管理者は、先生が保存する前に開いた画面のまま保存しようとする → 先生の変更を消さないよう、保存せずに知らせる
  // 管理者のタブに戻る（後ろのタブのままだと、画面の更新が止まることがある）
  await page.bringToFront()
  const staleTitle = await fieldInput('共通の題目')
  await staleTitle.type('（古い画面）')
  await clickButton('保存して学生に反映')
  await new Promise((r) => setTimeout(r, 500))
  await page.waitForFunction(() => document.querySelector('.message.ng'))
  check('先生が保存したあとに、古い画面のまま管理者が保存しようとすると、保存せずに知らせる', (await page.$eval('.message.ng', (e) => e.textContent)).includes('ほかの人'))
  page.removeAllListeners('dialog')
  page.on('dialog', (d) => d.accept())
  await page.reload({ waitUntil: 'networkidle0' })
  await page.waitForSelector('.admin .form')
  const savedConfig = await page.evaluate(() => JSON.parse(localStorage.getItem('sotsugyo-admin-mock')).years.find((y) => y.year === 2026).config)
  const saved = savedConfig.courses[0]
  check('先生が保存したひな形が、年度の設定に入る（ほかの設定は変わらない）', saved.template.some((b) => b.hint === '先生が足した説明') && saved.template.some((b) => b.title === '試験の小見出し'))
  check('先生が書いたコースのお知らせも、いっしょに保存される', saved.notice === '先生が書いたお知らせ', saved.notice)
  check('先生が編集した書き間違えやすい語も、いっしょに保存される', savedConfig.wordChecks.length === 13 && !savedConfig.wordChecks.some((w) => w.wrong === '芯地(仮)'))
  await teacher.close()

  // 新年度を作る → 準備中 → 公開
  await clickButton('新年度を作成')
  await page.waitForSelector('.modal')
  await clickButton('作成する')
  await page.waitForFunction(() => document.querySelector('.badge.draft')?.textContent === '準備中')
  check('新年度（2027年度）が準備中で作られる', await page.evaluate(() => document.querySelector('.sel').value === '2027'))
  check('新年度は前の年度の内容を引き継ぐ', (await previewText()).includes('卒業イベント「試験」について') && (await previewText()).includes('２０２７年度'))
  await page.screenshot({ path: `${OUT}/admin-2027.png` })
  await clickButton('この年度を学生に公開')
  await page.waitForFunction(() => document.querySelector('.badge.pub')?.textContent === '公開中')
  const options = await page.evaluate(() => [...document.querySelectorAll('.sel option')].map((o) => o.textContent))
  check('公開すると前の年度は「終了」になる', options.join(',') === '2027年度（公開中）,2026年度（終了）', options.join(','))

  // 先生の登録：メーリングリストの宛先をまとめて貼り付ける（mockups/v20 案3）
  await clickButton('先生の登録')
  await page.waitForSelector('.modal.members .member-list li')
  const box = await page.$('.member-add textarea')
  await box.type('文化 太郎 <t-bunka@bunka-wu.ac.jp>, "衣装 花子" <h-isho@bunka-wu.ac.jp>;\n00zz901@bunka-wu.ac.jp, someone@gmail.com')
  await page.waitForSelector('.bulk-table tbody tr')
  const read = await page.evaluate(() => [...document.querySelectorAll('.bulk-table tbody tr')].map((tr) => `${tr.className}:${tr.querySelector('.st').textContent}`))
  check('貼り付けると、名前とアドレスを読み取り、学生・大学外のアドレスは登録しないと示す', read.join(',') === 'ok:新しく登録,ok:新しく登録,ng:学生のアドレスのため登録しない,ng:大学のアドレスでないため登録しない', read.join(','))
  await page.screenshot({ path: `${OUT}/admin-members.png` })
  await clickButton('2人を登録する')
  await page.waitForFunction(() => document.querySelectorAll('.member-list li').length >= 4 && !document.querySelector('.bulk-table'))
  const registered = await page.evaluate(() => [...document.querySelectorAll('.member-list li .who')].map((w) => w.textContent))
  check('「2人を登録する」で、名前をメモにして先生として登録される', registered.some((w) => w.includes('t-bunka@bunka-wu.ac.jp') && w.includes('文化 太郎')) && registered.some((w) => w.includes('h-isho@bunka-wu.ac.jp')) && !registered.some((w) => w.includes('00zz901')))
  await clickButton('閉じる')

  // 変更履歴
  await clickButton('変更履歴')
  await page.waitForSelector('.history li')
  const history = await page.evaluate(() => [...document.querySelectorAll('.history li')].map((li) => li.textContent))
  check('変更履歴に操作が残る', history.some((h) => h.includes('公開')) && history.some((h) => h.includes('コピーして作成')), `${history.length}件`)
  await context.close()
})

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} 件 合格`)
process.exitCode = failed.length ? 1 : 0
