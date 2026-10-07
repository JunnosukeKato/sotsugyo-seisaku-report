// デザイン案 v27（はじめての「指差し確認」と、ツールの中の「？ 使い方」）を画像に書き出す。
// 本物のツール（学生用ツール・管理ページの試験版）を Edge で開き、案の部品を仮に重ねて撮る（ツール本体は変えない）。
// 部品の見た目は mockups/v27/v27.css、作り方は mockups/v27/v27.js、使い方の項目と「言葉で探す」は mockups/v27/help-data.js。
// 使い方: node scripts/mockup-shots-v27.mjs [tour] [help] [admin] [try] [review]（何も付けなければ全部。開発サーバーが http://localhost:5173 で動いていること）
//   Edge は EDGE_PORT（ふだんは 9401）で起動する
// 学生用ツールは Google のログインとドライブを偽物（scripts/e2e/fakeGoogle.mjs）に差し替える。本物の Google にはつながない。
// 中身の例：衣装コースの学生（文化花子・00ZZ0123。架空）。指差し確認は「表紙ができた直後」（本文はコースの下書きのまま）、
// 使い方は「本文を書いている途中」（エラー2件・警告1件）の原稿で撮る
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

process.env.EDGE_PORT ??= '9401'
const { withEdge } = await import('./poc/edge.mjs')
const { fakeDrive, routeGoogle } = await import('./e2e/fakeGoogle.mjs')
await import('../mockups/v27/help-data.js')
const H = globalThis.V27_HELP

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const DIR = 'mockups/v27'
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })
const ONLY = process.argv.slice(2)
const want = (k) => ONLY.length === 0 || ONLY.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PC = { width: 1440, height: 900, deviceScaleFactor: 1.5 }
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const PHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const EMAIL = '00zz0123@bunka-wu.ac.jp'
const config = JSON.parse(readFileSync('scripts/e2e/config-fixture.json', 'utf8'))
for (const c of config.courses) delete c.notice
const CUR = '.page-viewport.front [data-vivliostyle-page-container].is-current'

/** 撮影のじゃまになるもの（別のタブの知らせ）を出さない */
const SHOT_CSS = `.login-over.tab-locked { display: none !important; }`

/** 撮影のあいだに src/ が直されても、画面が入れ替わらないようにする（開発サーバーの即時反映をつながない） */
const noHotReload = (page) =>
  page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
  })

const ready = (page, phone = false) =>
  page.waitForFunction(
    (phone) => {
      const s = window.__editor?.getSnapshot()
      return s?.layout && (!phone || s.sheet !== undefined) && !s.rendering && !s.turning && !document.querySelector('.loading')
    },
    { timeout: 120000 },
    phone,
  )

/** ドライブへの保存が済むまで待つ（「ドライブに保存 13:44」） */
const driveSaved = (page) =>
  page.waitForFunction(() => [...document.querySelectorAll('.chip.ok')].some((c) => /ドライブに保存|\d+:\d+/.test(c.textContent)) && !document.querySelector('.chip .dot.busy'), { timeout: 60000 })

/** 要素の位置（いくつかなら、それらを囲む範囲。text があれば、その文字を含むものだけ） */
function rectOf(sel, text) {
  const els = [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 0 && (!text || e.textContent.includes(text)))
  if (!els.length) return null
  const rs = els.map((e) => e.getBoundingClientRect())
  const left = Math.min(...rs.map((r) => r.left))
  const top = Math.min(...rs.map((r) => r.top))
  return { left, top, width: Math.max(...rs.map((r) => r.right)) - left, height: Math.max(...rs.map((r) => r.bottom)) - top }
}
const R = async (page, sel, text) => {
  const r = await page.evaluate(rectOf, sel, text)
  if (!r) throw new Error(`見つかりません：${sel}`)
  return r
}

/** 学生の原稿の見本（本文を書いている途中。make-guides.mjs の見本を短くしたもの。「見頃」「記事」「です」で、エラー2件・警告1件） */
async function setupWriting() {
  const { fromMaterialTable } = await import('/src/model/table.ts')
  const { importImage } = await import('/src/model/images.ts')
  const files = [
    ['g-design', 'design', 1200],
    ['g-mood', 'moodboard', 1200],
    ['g-process', 'process', 1200],
    ['g-photo1', 'photo-1', 1200],
    ['g-satin', 'swatch-satin', 800],
    ['g-chiffon', 'swatch-chiffon', 800],
    ['g-broad', 'swatch-broad', 800],
  ]
  const made = []
  for (const [id, file, max] of files) made.push(await importImage(await (await fetch(`/docs/guide-images/sample/${file}.jpg`)).blob(), id, max))
  window.__editor.addImages(made)
  const r0 = window.__editor.getSnapshot().report
  const t = (text) => ({ type: 'text', text })
  const ref = (targetId, withParens = true) => ({ type: 'ref', targetId, withParens })
  const p = (id, ...content) => ({ type: 'paragraph', id, content: content.map((c) => (typeof c === 'string' ? t(c) : c)) })
  const sub = (id, title) => ({ type: 'subheading', id, title })
  const fig = (rowId, id, imageId, caption) => ({ type: 'figureRow', id: rowId, figures: [{ id, imageId, caption }] })
  window.__editor.replace({
    ...r0,
    basicInfo: { ...r0.basicInfo, name: '文化　花子', courseId: 'film-stage-costume', subtitleInput: 'シンドバッド' },
    abstract: {
      started: true,
      paragraphs: [
        p('a1', '本制作報告書は、卒業イベント「シンドバッド」において、筆者が担当した主人公シンドバッドの衣装の制作についてまとめたものである。シンドバッドは七つの航海を経て成長していく人物であり、本制作では、旅立ちの場面の若々しさと、帰還の場面の頼もしさの両方を、一着の衣装で表すことを目標とした。'),
        p('a2', 'デザインは、中東の伝統的な装いをもとに、航海の力強さと冒険心を表すことを考えた。袖は風をはらむように大きく膨らませ、腰には幅の広い帯を巻いた。配色は海の青と砂の金を軸とし、袖には波の模様を金の糸で刺繍した。素材は、光沢のあるコットンサテンを中心に、透けるシルクシフォンを重ねて、照明の当たり方で表情が変わるようにした。'),
        p('a3', '制作では、二回の仮縫いで動きやすさを確かめた。一回目は袖の膨らみが大きすぎ、腕を上げると肩が引きつれたため、袖山を下げて袖幅を細くした。二回目は舞台の上で歩いたり腕を回したりして、客席からの見え方も確かめた。刺繍は図案を何度も描き直し、離れた客席からでも波の形が分かる大きさに決めた。袖の重ね布は、腕を下ろしたときに広がりすぎないよう、端に細いテープを入れて形を整えた。'),
        p('a4', '本番では、照明の下で袖の刺繍が光り、主人公の動きを大きく見せることができた。客席からも、袖が揺れる様子が印象に残ったという声が多く寄せられた。一方で、帯の結び目が大きく、場面転換の早替えに時間がかかるという課題が残った。今後は、見た目の美しさだけでなく、着脱のしやすさも初めから考えたデザインを心がけたい。'),
      ],
    },
    body: [
      {
        id: 'c1',
        title: '企画・立案',
        blocks: [
          sub('s1', '担当衣装のキャラクター'),
          p('p1', '筆者が担当したのは、物語の主人公である船乗りシンドバッドの衣装である。シンドバッドは七つの航海を経て成長していく人物であり、場面ごとに異なる表情を見せる。'),
          p('p2', '本制作では、旅立ちの場面の若々しさと、帰還の場面の頼もしさの両方を、一着の衣装で表すことを目標とした。そのため、色や形で年齢を強く感じさせるのではなく、動きの大きさと素材の光り方で印象を変えられるように考えた。'),
          sub('s2', 'デザイン説明'),
          p('p3', '中東の伝統的な装いをもとに、航海の力強さと冒険心を表すデザインを考えた', ref('f1'), '。キーワードは自由、勇気、海である。'),
          fig('r1', 'f1', 'g-design', 'デザイン画'),
          p('p4', '袖は風をはらむように大きく膨らませた。腰には幅の広い帯を巻き、袖には波の模様を刺繍で入れた。配色は海の青と砂の金を軸とし、ズボンには生成りを合わせて全体を軽く見せた。'),
          p('p4b', '配色と素材は、海と砂漠の写真や布の切れ端を集めたイメージボードをもとに決めた', ref('f2'), '。藍色の濃さは、照明の下でも黒く沈まないものを選んだ。'),
          fig('r2', 'f2', 'g-mood', 'イメージボード'),
          sub('s3', '使用素材'),
          p('p5', ref('t1', false), 'に使用した素材をまとめる。'),
          fromMaterialTable({
            id: 't1',
            caption: '使用素材表',
            rows: [
              { id: 'm1', name: 'コットンサテン', usage: 'ブラウス', swatchImageId: 'g-satin' },
              { id: 'm2', name: 'シルクシフォン', usage: '袖の重ね布', swatchImageId: 'g-chiffon' },
              { id: 'm3', name: 'コットンブロード', usage: 'ズボン', swatchImageId: 'g-broad' },
            ],
          }),
          p('p5b', 'ブラウスには、やわらかい光沢のあるコットンサテンを使った。照明が当たると表面が光り、袖の動きが客席からも分かりやすくなる。袖の重ね布には透けるシルクシフォンを使い、腕を動かしたときに風に揺れるように見せた。'),
        ],
      },
      {
        id: 'c2',
        title: '制作過程',
        blocks: [
          sub('s4', 'パターンと仮縫い'),
          p('p6', 'デザイン画をもとにパターンを引き、シーチングで仮縫いをした。一回目の仮縫いでは、袖の膨らみが大きすぎて、腕を上げたときに肩が引きつれた。そこで袖山を3cm下げ、袖幅も細くした。'),
          p('p7', '二回目の仮縫いでは、前見頃の丈を2cm短くした。袖の記事が重く、腕が下がって見えたためです。'),
          sub('s5', '袖の刺繍'),
          p('p8', '袖には、海の波を表す模様を金の糸で刺繍した', ref('f3'), '。図案は実物大に描いて袖に写し、刺繍枠に張ってから一針ずつ刺した。'),
          fig('r3', 'f3', 'g-process', '袖の刺繍'),
          p('p9', '最初の図案は波が細かすぎて、離れると模様が見えなかった。そこで波の数を減らし、一つ一つの波を大きく描き直した。糸は、照明の下で強く光りすぎないよう、つやを抑えた金色を選んだ。'),
          p('p10', '刺繍には片袖でおよそ20時間かかった。両袖の模様がそろうよう、型紙に印を付けて位置を合わせた。刺し終えたあとは、裏に薄い接着芯を貼り、着たときに糸が引っかからないようにした。'),
          sub('s6', '帯とズボン'),
          p('p11', '帯は、からし色の布を幅15cmの筒に縫い、腰に二重に巻いて後ろで結んだ。結び目が大きく見えるよう、端に重さのある房を付けた。房は動いたときに揺れて、舞台の上で動きを強調する役割も果たした。'),
          p('p12', 'ズボンは、裾に向かって細くなる形にし、裾口にゴムを入れて動きやすくした。股上を深くとり、しゃがんだり飛び跳ねたりしても突っ張らないようにした。'),
        ],
      },
      {
        id: 'c3',
        title: 'まとめ',
        blocks: [
          p('p14', '本制作では、主人公の成長を一着の衣装で表すことを目標とした。袖の大きな膨らみと金の刺繍によって、旅立ちの若々しさと帰還の頼もしさの両方を表すことができた。'),
          p('p15', '一方で、帯の結び目が大きく、場面転換の早替えに時間がかかるという課題が残った。今後は、見た目の美しさだけでなく、着脱のしやすさも初めから考えたデザインを心がけたい。'),
        ],
      },
    ],
    references: [],
    workPhotos: { layout: 1, imageIds: ['g-photo1'] },
    acknowledged: [],
  })
}

/**
 * 学生用ツールを開き、ログインして、はじめての案内を済ませる（コース：映画・舞台衣装デザイナー、Word：いいえ、表紙は「あとで」で閉じてから入れる）。
 * state：tour（表紙ができた直後。本文はコースの下書きのまま、本文の1ページ目）・writing（本文を書いている途中）
 */
async function openStudent(browser, { phone = false, state }) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  page.on('dialog', (d) => d.accept())
  await noHotReload(page)
  if (phone) await page.setUserAgent(PHONE_UA)
  await page.setViewport(phone ? PHONE : PC)
  await routeGoogle(page, fakeDrive(EMAIL), config)
  await page.goto(`${APP}/`, { waitUntil: 'networkidle0', timeout: 90000 })
  await page.addStyleTag({ content: SHOT_CSS })
  await page.waitForSelector('.login-over .login-btn', { timeout: 60000 })
  await sleep(300)
  await page.evaluate(() => document.querySelector('.login-over .login-btn').click())
  await page.waitForFunction(() => !document.querySelector('.login-over'), { timeout: 60000 })
  await page.waitForSelector('.guide.step-course .g-opts button', { timeout: 60000 })
  await page.evaluate(() => [...document.querySelectorAll('.guide .g-opts button')].find((b) => b.textContent.includes('映画・舞台衣装')).click())
  await page.waitForSelector('.guide.step-word .g-word-opt.no', { timeout: 60000 })
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.guide .g-later', { timeout: 60000 })
  await sleep(300)
  await page.evaluate(() => document.querySelector('.guide .g-later').click())
  await page.waitForFunction(() => !document.querySelector('.guide'), { timeout: 30000 })
  await page.evaluate(() => window.__editor.finishEditing())
  await ready(page, phone)
  if (state === 'tour') {
    await page.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, name: '文化　花子', subtitleInput: 'シンドバッド' } })))
  } else {
    await page.evaluate(setupWriting)
  }
  await sleep(800)
  await ready(page, phone)
  await page.evaluate(() => window.__editor.goToArea('body'))
  await sleep(900)
  await ready(page, phone)
  await driveSaved(page)
  await page.addStyleTag({ path: `${DIR}/v27.css` })
  await page.addScriptTag({ path: `${DIR}/help-data.js` })
  await page.addScriptTag({ path: `${DIR}/v27.js` })
  await helpButton(page)
  await page.mouse.move(5, 5)
  await page.bringToFront()
  await sleep(400)
  return { context, page }
}

/** 右の欄の「使い方（手引き）」のリンクを、「？ 使い方」のボタンに置き換える（スマホはメニューの中。メニューを開いたときに足す） */
const helpButton = (page, on = false) =>
  page.evaluate((on) => {
    document.documentElement.classList.add('v27-hide-howto')
    for (const links of document.querySelectorAll('.side .links, .sheet-body .links')) {
      let b = links.querySelector('.v27-help-btn')
      if (!b) {
        links.insertAdjacentHTML('beforeend', `<button class="link-btn v27-help-btn">${window.v27.IC.help}使い方</button>`)
        b = links.querySelector('.v27-help-btn')
      }
      b.classList.toggle('on', on)
    }
  }, on)

const shot = async (page, name, opts = {}) => {
  await sleep(opts.wait ?? 450)
  const path = `${OUT}/${name}.png`
  if (opts.clip) await page.screenshot({ path, clip: opts.clip, captureBeyondViewport: false })
  else await page.screenshot({ path, captureBeyondViewport: false })
  console.log(`  ${path}`)
}
const clearAll = (page) => page.evaluate(() => window.v27.clear())

/** はみ出しの確かめ：重ねた部品の中で、横にはみ出している（中身が枠より広い）ものを数える */
const overflowCheck = (page, name) =>
  page.evaluate(() => {
    const bad = []
    for (const el of document.querySelectorAll('.v27h *, .v27t *')) {
      const cs = getComputedStyle(el)
      if (cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1) bad.push(`${el.className || el.tagName}：${el.scrollWidth}>${el.clientWidth}`)
      const r = el.getBoundingClientRect()
      if (r.width > 0 && (r.right > innerWidth + 1 || r.left < -1)) bad.push(`${el.className || el.tagName}：画面の外（${Math.round(r.left)}〜${Math.round(r.right)}）`)
    }
    // 動画の見本の字幕（…で切る）は、はみ出してよい
    return bad.filter((b) => !/v27h-drawer\b|tab：|clear：|^cc：/.test(b)).slice(0, 8)
  }).then((bad) => bad.length && console.log(`  ！${name} はみ出し：${bad.join(' / ')}`))

// =====================================================================
// 指差し確認
// =====================================================================

/** 紙面の最初の段落と、その上の見出し（光を当てる「紙面」の場所）。id：その段落 */
function paperBlock(CUR) {
  const p = [...document.querySelectorAll(`${CUR} p[data-block-id]`)].find((e) => e.getBoundingClientRect().height > 0)
  const pr = p.getBoundingClientRect()
  const page = document.querySelector(CUR).getBoundingClientRect()
  const els = [...document.querySelectorAll(`${CUR} [data-block-id], ${CUR} h1, ${CUR} h2, ${CUR} h3`)].filter((e) => {
    const r = e.getBoundingClientRect()
    return r.height > 0 && r.top >= page.top + 20 && r.bottom <= pr.bottom + 1
  })
  const rs = els.map((e) => e.getBoundingClientRect())
  const left = Math.min(...rs.map((r) => r.left))
  const top = Math.min(...rs.map((r) => r.top))
  return { left, top, width: Math.max(...rs.map((r) => r.right)) - left, height: Math.max(...rs.map((r) => r.bottom)) - top, id: p.dataset.blockId }
}

/** PC の7つの場所 */
async function pcTargets(page) {
  return {
    paper: await page.evaluate(paperBlock, CUR),
    tools: await R(page, '.palette'),
    figTool: await R(page, '.palette .tb', '図を入れる'),
    mini: await R(page, '.thumbs-col .t:first-child .mini'),
    pages: await R(page, '.thumbs-col'),
    save: await R(page, '.side .drive-chip-wrap .chip'),
    check: await R(page, '.side .sec.check'),
    checkHead: await R(page, '.side .sec.check .sec-h > span:first-child'),
    pdf: await R(page, '.side .export'),
    help: await R(page, '.side .v27-help-btn'),
    paperPage: await R(page, CUR),
    stage: await R(page, '.stage'),
  }
}
/** スマホの4つの場所 */
async function phoneTargets(page) {
  const paper = await page.evaluate(paperBlock, CUR)
  const c = await R(page, '.p-nav button:nth-child(3)')
  const d = await R(page, '.p-nav button:nth-child(4)')
  return {
    paper,
    nav: { left: c.left, top: c.top, width: d.left + d.width - c.left, height: c.height },
    navSplit: { x: d.left, y: c.top },
    menu: await R(page, '.p-top .icon-btn'),
    save: await R(page, '.p-top .chip'),
    paperPage: await R(page, CUR),
  }
}

async function tourShots(browser) {
  // ---------------- PC ----------------
  {
    const { context, page } = await openStudent(browser, { state: 'tour' })
    const T = await pcTargets(page)
    console.log('  指摘', await page.evaluate(() => window.__editor.getSnapshot().findings.map((f) => `${f.severity}:${f.title}`).join('、')))
    // 案A：スポットライト（1 紙面・4 保存のようす・7 ？使い方）
    const sideA = { 1: ['paper', 'below'], 2: ['tools', 'right'], 3: ['pages', 'right'], 4: ['save', 'left'], 5: ['check', 'left'], 6: ['pdf', 'left'], 7: ['help', 'left'] }
    for (const step of [1, 4, 7]) {
      const [k, side] = sideA[step]
      await page.evaluate((o) => window.v27.tourA(o), { r: T[k], side, step, total: 7 })
      await overflowCheck(page, `tour-a-pc-${step}`)
      await shot(page, `tour-a-pc-${step}`)
    }
    // 案B：番号の付箋を一度に
    {
      const spots = [
        { r: T.paper, at: 'l' },
        { r: T.tools, at: 'tr' },
        { r: T.pages, at: 'tr' },
        { r: T.save, at: 'tl' },
        { r: T.check, at: 'tl' },
        { r: T.pdf, at: 'tl' },
        { r: T.help, at: 'tr' },
      ]
      const width = 430
      const card = { left: T.paperPage.left + (T.paperPage.width - width) / 2, bottom: T.paperPage.top + T.paperPage.height - 36, width }
      await page.evaluate((o) => window.v27.tourB(o), { spots, card })
      await overflowCheck(page, 'tour-b-pc')
      await shot(page, 'tour-b-pc')
    }
    // 案C：光る点（はじめ：7つ。紙面の点に重ねると、吹き出し）
    const dotsPC = (T) => [
      { step: 1, x: T.paper.left - 18, y: T.paper.top + T.paper.height / 2 },
      { step: 2, x: T.tools.left + T.tools.width - 1, y: T.figTool.top + T.figTool.height / 2 },
      { step: 3, x: T.mini.left + T.mini.width - 3, y: T.mini.top + 4 },
      { step: 4, x: T.save.left + T.save.width + 4, y: T.save.top + 2 },
      { step: 5, x: T.checkHead.left + T.checkHead.width + 14, y: T.checkHead.top + T.checkHead.height / 2 },
      { step: 6, x: T.pdf.left + T.pdf.width - 10, y: T.pdf.top + 5 },
      { step: 7, x: T.help.left + T.help.width - 5, y: T.help.top + 4 },
    ]
    const leftChip = { x: T.stage.left + 16, bottom: 16 }
    await page.evaluate((o) => window.v27.tourC(o), { dots: dotsPC(T), open: 1, side: 'below', left: leftChip })
    await page.mouse.move(T.paper.left - 18, T.paper.top + T.paper.height / 2)
    await overflowCheck(page, 'tour-c-pc-1')
    await shot(page, 'tour-c-pc-1')
    // 書き始めたあと：紙面と保存の点は消え、道具の点に重ねると吹き出し（書いている段落の道具が出ている）
    await clearAll(page)
    const pid = T.paper.id
    await page.evaluate((id) => window.__editor.openWhenReady(id, 0), pid)
    await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 30000 }, pid)
    await sleep(400)
    await page.keyboard.type('筆者が担当したのは、主人公シンドバッドの衣装である。', { delay: 5 })
    await sleep(1200)
    await driveSaved(page)
    const T2 = await pcTargets(page).catch(() => T)
    await page.evaluate((o) => window.v27.tourC(o), { dots: dotsPC(T2).filter((d) => d.step !== 1 && d.step !== 4), open: 2, side: 'right', left: leftChip })
    await shot(page, 'tour-c-pc-2')
    await context.close()
  }
  // ---------------- スマホ ----------------
  {
    const { context, page } = await openStudent(browser, { phone: true, state: 'tour' })
    const T = await phoneTargets(page)
    const sideA = { 1: ['paper', 'below'], 2: ['nav', 'above'], 3: ['menu', 'below'], 4: ['save', 'below'] }
    for (const step of [1, 2, 3]) {
      const [k, side] = sideA[step]
      await page.evaluate((o) => window.v27.tourA(o), { r: T[k], side, step, total: 4, narrow: true })
      await overflowCheck(page, `tour-a-ph-${step}`)
      await shot(page, `tour-a-ph-${step}`)
    }
    {
      const spots = [
        { r: T.paper, at: 'l' },
        { r: T.nav, at: 'tl' },
        { r: T.menu, at: 'b' },
        { r: T.save, at: 'b' },
      ]
      await page.evaluate((o) => window.v27.tourB(o), { spots, card: { left: 12, width: PHONE.width - 24, bottom: T.nav.top - 70 }, narrow: true })
      await overflowCheck(page, 'tour-b-ph')
      await shot(page, 'tour-b-ph')
    }
    const dotsPh = [
      { step: 1, x: T.paper.left - 14, y: T.paper.top + T.paper.height / 2 },
      { step: 2, x: T.navSplit.x, y: T.navSplit.y + 4 },
      { step: 3, x: T.menu.left + T.menu.width / 2, y: T.menu.top + T.menu.height + 1 },
      { step: 4, x: T.save.left + T.save.width / 2, y: T.menu.top + T.menu.height + 1 },
    ]
    await page.evaluate((o) => window.v27.tourC(o), { dots: dotsPh, open: 1, side: 'below', narrow: true })
    await overflowCheck(page, 'tour-c-ph-1')
    await shot(page, 'tour-c-ph-1')
    // 紙面に書き、保存されたあと：残りは2つ。下の「チェック・PDF」の点をタップすると、吹き出し
    await clearAll(page)
    const pid = T.paper.id
    await page.evaluate((id) => window.__editor.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === id ? { ...b, content: [{ type: 'text', text: '筆者が担当したのは、主人公シンドバッドの衣装である。' }] } : b)) })) })), pid)
    await sleep(1200)
    await ready(page, true)
    await driveSaved(page)
    await page.evaluate((o) => window.v27.tourC(o), { dots: dotsPh.filter((d) => d.step === 2 || d.step === 3), open: 2, side: 'above', narrow: true })
    await shot(page, 'tour-c-ph-2')
    await context.close()
  }
}

// =====================================================================
// 使い方（ヘルプ）
// =====================================================================

const SEARCH = 'PDF 出ない'

async function helpShots(browser) {
  // ---------------- PC ----------------
  {
    const { context, page } = await openStudent(browser, { state: 'writing' })
    await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('p3'), 'none'))
    await sleep(500)
    await ready(page)
    console.log('  指摘', await page.evaluate(() => window.__editor.getSnapshot().findings.map((f) => `${f.severity}:${f.title}`).join('、')))
    // 入り口：右の欄の「？ 使い方」
    {
      const head = await R(page, '.side .side-head')
      await shot(page, 'entry-pc', { clip: { x: head.left, y: head.top, width: head.width, height: head.height + 8 } })
    }
    for (const d of ['a', 'b', 'c']) {
      await helpButton(page, d === 'c')
      const states = [
        ['list', { who: 'student', mode: 'list', topic: 'write' }],
        ['topic', { who: 'student', mode: 'topic', topic: 'pdf', device: 'pc' }],
        ['search', { who: 'student', mode: 'search', q: SEARCH, topic: 'pdf', device: 'pc' }],
      ]
      for (const [k, o] of states) {
        await page.evaluate((d, o) => window.v27.showHelp(d, o), d, o)
        await sleep(300)
        await overflowCheck(page, `help-${d}-pc-${k}`)
        await shot(page, `help-${d}-pc-${k}`, { wait: 700 })
        // 使い方の部分だけを切り抜いたもの（一覧のページで、文が読める大きさに出す）
        const z = await R(page, { a: '.side', b: '.v27h-modal', c: '.v27h-drawer' }[d])
        await shot(page, `help-${d}-pc-${k}-z`, { wait: 50, clip: { x: z.left, y: z.top, width: Math.min(z.width, PC.width - z.left), height: Math.min(z.height, PC.height - z.top) } })
      }
      await clearAll(page)
    }
    await helpButton(page, false)
    await context.close()
  }
  // ---------------- スマホ ----------------
  {
    const { context, page } = await openStudent(browser, { phone: true, state: 'writing' })
    await page.evaluate(() => window.__editor.goToPage(window.__editor.pageOfBlock('p3'), 'none'))
    await sleep(500)
    await ready(page, true)
    // 入り口：メニューの「？ 使い方」
    await page.evaluate(() => document.querySelector('.p-top .icon-btn').click())
    await page.waitForSelector('.sheet .sheet-body')
    await sleep(500)
    await helpButton(page)
    await page.evaluate(() => document.activeElement?.blur())
    await shot(page, 'entry-ph')
    await page.evaluate(() => document.querySelector('.sheet-close').click())
    await sleep(500)
    for (const d of ['a', 'b', 'c']) {
      const states = [
        ['list', { who: 'student', mode: 'list', narrow: true }],
        ['topic', { who: 'student', mode: 'topic', topic: 'pdf', device: 'iphone', narrow: true }],
        ['search', { who: 'student', mode: 'search', q: SEARCH, narrow: true }],
      ]
      for (const [k, o] of states) {
        await page.evaluate((d, o) => window.v27.showHelp(d, o), d, o)
        await sleep(300)
        await overflowCheck(page, `help-${d}-ph-${k}`)
        await shot(page, `help-${d}-ph-${k}`, { wait: 700 })
      }
      await clearAll(page)
    }
    await context.close()
  }
}

/** 管理ページ（試験版）を開く */
async function openAdmin(browser) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  page.on('dialog', (d) => d.accept())
  await noHotReload(page)
  await page.setViewport(PC)
  await page.goto(`${APP}/admin.html`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => localStorage.removeItem('sotsugyo-admin-mock'))
  await page.goto(`${APP}/admin.html`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.admin .form')
  // 見本（表紙と抄録）が出るまで待つ
  for (let i = 0; i < 40; i++) {
    const ok = await page.evaluate(() => document.querySelector('.preview iframe')?.contentDocument?.querySelectorAll('.page').length === 2)
    if (ok) break
    await sleep(800)
  }
  await sleep(1500)
  await page.evaluate(() => [...document.querySelectorAll('.badge')].find((b) => b.textContent.includes('試験用'))?.style.setProperty('display', 'none'))
  await page.addStyleTag({ path: `${DIR}/v27.css` })
  await page.addScriptTag({ path: `${DIR}/help-data.js` })
  await page.addScriptTag({ path: `${DIR}/v27.js` })
  // 見出しの「使い方（教員用の手引き）」のリンクを、「？ 使い方」のボタンに置き換える
  await page.evaluate(() => {
    document.documentElement.classList.add('v27-admin-hide-howto')
    document.querySelector('.admin-header > b').insertAdjacentHTML('afterend', `<button class="v27-admin-help on">${window.v27.IC.help}使い方</button>`)
  })
  return { context, page }
}

async function adminShots(browser) {
  const { context, page } = await openAdmin(browser)
  const states = {
    a: { who: 'teacher', mode: 'list', admin: true, dock: true },
    b: { who: 'teacher', mode: 'list', topic: 't-year', admin: true },
    c: { who: 'teacher', mode: 'list', admin: true },
  }
  for (const d of ['a', 'b', 'c']) {
    await page.evaluate((d, o) => window.v27.showHelp(d, o), d, states[d])
    await sleep(300)
    await overflowCheck(page, `help-${d}-admin`)
    await shot(page, `help-${d}-admin`, { wait: 700 })
  }
  await context.close()
}

// =====================================================================
// 一覧のページ（mockups/v27/review.html）
// =====================================================================

function topicRows(list) {
  const groups = []
  for (const t of list) {
    let g = groups.find((x) => x.name === t.group)
    if (!g) groups.push((g = { name: t.group, items: [] }))
    g.items.push(t)
  }
  return groups
    .map(
      (g) =>
        `<li class="grp">${g.name}</li>` +
        g.items
          .map(
            (t) =>
              `<li><b>${t.title}</b><span class="sum">${t.lead ?? t.items?.map((i) => i.h).join('・') ?? ''}</span><span class="tags">${t.shot ? '<i class="s">画面</i>' : ''}${t.video ? `<i class="v">動画 ${t.video}秒</i>` : ''}</span></li>`,
          )
          .join(''),
    )
    .join('')
}

function reviewHtml() {
  const img = (f, cap, cls = '') => `<div class="${cls}"><a href="shots/${f}.png" target="_blank"><img src="shots/${f}.png" alt="" loading="lazy"></a><small>${cap}</small></div>`
  const pros = (good, weak) => `<div class="pw"><div class="good"><b>良い点</b><ul>${good.map((x) => `<li>${x}</li>`).join('')}</ul></div><div class="weak"><b>弱い点</b><ul>${weak.map((x) => `<li>${x}</li>`).join('')}</ul></div></div>`
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>v27 指差し確認と使い方</title>
<!-- node scripts/mockup-shots-v27.mjs review で作る（手で直さない） -->
<link rel="stylesheet" href="../../node_modules/@fontsource/biz-udpgothic/400.css">
<link rel="stylesheet" href="../../node_modules/@fontsource/biz-udpgothic/700.css">
<style>
  :root { --ink: #24262b; --muted: #5d6068; --accent: #2f3e75; --line: #ecebe8; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px 32px 48px; background: #eceae6; font-family: 'BIZ UDPGothic', 'Yu Gothic UI', sans-serif; color: var(--ink); }
  h1 { font-size: 21px; margin: 0 0 4px; letter-spacing: 0.04em; }
  h2 { font-size: 18px; margin: 40px 0 6px; letter-spacing: 0.04em; }
  .lead { margin: 0 0 16px; font-size: 13.5px; color: var(--muted); line-height: 1.8; max-width: 1180px; }
  .ask { margin: 0 0 8px; padding: 14px 18px 12px; background: #fff; border-radius: 14px; box-shadow: 0 2px 10px rgba(0,0,0,0.08); max-width: 1180px; }
  .ask h2 { margin: 0 0 6px; font-size: 15px; }
  .ask ol { margin: 0; padding-left: 22px; font-size: 13.5px; line-height: 2; }
  .ask em { font-style: normal; color: var(--accent); font-weight: 700; }
  figure { margin: 0 0 18px; background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.08); }
  figure.is-rec { box-shadow: 0 0 0 2.5px var(--accent), 0 2px 10px rgba(0,0,0,0.08); }
  figcaption { padding: 12px 16px 10px; border-bottom: 1px solid var(--line); }
  figcaption b { display: block; font-size: 15.5px; margin-bottom: 3px; }
  figcaption span { font-size: 13px; color: var(--muted); line-height: 1.7; }
  .rec { display: inline-block; margin-left: 8px; padding: 1px 9px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 11.5px; font-style: normal; font-weight: 700; letter-spacing: 0.06em; vertical-align: 2px; }
  img { display: block; width: 100%; }
  a { color: inherit; }
  .strip { display: grid; gap: 1px; background: var(--line); align-items: start; }
  .strip > div { background: #fff; align-self: stretch; }
  .strip small { display: block; padding: 6px 12px 9px; font-size: 12.5px; color: var(--muted); line-height: 1.6; }
  .strip small b { color: var(--ink); }
  .pc3 { grid-template-columns: repeat(3, 1fr); }
  .pc2 { grid-template-columns: repeat(2, 1fr); }
  .ph3 { grid-template-columns: repeat(3, 1fr) 1.6fr; }
  .ph4 { grid-template-columns: 1fr 1fr 1fr 2.3fr; }
  .pcz { grid-template-columns: 2.5fr 0.82fr 0.82fr 0.82fr; }
  .ph2 { grid-template-columns: repeat(2, 1fr) 2.2fr; }
  .ph { padding: 10px; background: #faf9f7 !important; }
  .ph img { border-radius: 12px; border: 1px solid #ddd; }
  .note-cell { padding: 14px 16px; font-size: 13px; line-height: 1.8; color: #3f4249; }
  .note-cell p { margin: 0 0 8px; }
  .pw { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--line); border-top: 1px solid var(--line); }
  .pw > div { background: #fff; padding: 10px 16px 12px; font-size: 13px; line-height: 1.75; }
  .pw b { font-size: 12.5px; letter-spacing: 0.06em; }
  .pw .good b { color: #3f7a55; }
  .pw .weak b { color: #b5443b; }
  .pw ul { margin: 4px 0 0; padding-left: 18px; }
  .why { margin: 2px 0 10px; padding: 11px 15px; border-left: 3px solid var(--accent); background: #f6f5f2; border-radius: 0 10px 10px 0; font-size: 13.5px; line-height: 1.85; max-width: 1180px; }
  .why b { color: var(--accent); }
  .entry { display: grid; grid-template-columns: 330px 210px 1fr 400px; gap: 1px; background: var(--line); }
  .entry > div { background: #fff; }
  .lists { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
  .lists section { background: #fff; border-radius: 14px; padding: 14px 18px 16px; box-shadow: 0 2px 10px rgba(0,0,0,0.08); }
  .lists h3 { margin: 0 0 6px; font-size: 15px; }
  .lists h3 span { font-size: 12.5px; font-weight: 400; color: var(--muted); margin-left: 6px; }
  .tl { list-style: none; margin: 0; padding: 0; counter-reset: n; }
  .tl li { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 2px 8px; padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 13.5px; line-height: 1.55; }
  .tl li::before { counter-increment: n; content: counter(n); grid-row: 1 / 3; color: var(--muted); font-size: 12px; padding-top: 1px; }
  .tl li.grp { display: block; padding: 12px 0 2px; border: 0; font-size: 11.5px; font-weight: 700; letter-spacing: 0.08em; color: var(--muted); }
  .tl li.grp::before { content: none; counter-increment: none; }
  .tl b { grid-column: 2; }
  .tl .sum { grid-column: 2; font-size: 12.5px; color: var(--muted); }
  .tl .tags { grid-column: 3; grid-row: 1 / 3; display: flex; gap: 4px; align-items: start; padding-top: 2px; }
  .tl i { font-style: normal; font-size: 11px; padding: 1px 7px; border-radius: 999px; white-space: nowrap; }
  .tl i.s { background: #f1efeb; color: var(--muted); }
  .tl i.v { background: #e8ebf5; color: var(--accent); }
  .search-demo { margin: 10px 0 0; padding: 10px 14px; border-radius: 10px; background: #f6f5f2; font-size: 12.5px; line-height: 1.8; color: #3f4249; }
  .search-demo b { color: var(--ink); }
</style>
</head>
<body>
  <h1>指差し確認と「？ 使い方」：画面の案（v27）</h1>
  <p class="lead">紙の手引きを1〜2ページに減らし、くわしい説明はツールの中に移します。そのための2つの部品の案です。どの画面も、本物のツールに案の部品を仮に重ねて撮っています（まだツールには入っていません）。中身の例は、衣装コースの学生（文化　花子・00ZZ0123。架空）。画像を押すと、大きく開きます。<b>おすすめ</b>の案には印を付けています。</p>
  <div class="ask">
    <h2>この v27 で決めていただきたいこと</h2>
    <ol>
      <li>指差し確認（はじめての画面の見かた）の形：案A／B／C　<em>おすすめ：案A「スポットライト」</em></li>
      <li>「？ 使い方」の出し方：案A／B／C　<em>おすすめ：案A「右の欄が切り替わる」</em></li>
      <li>使い方に入れる項目（いちばん下の一覧。学生用 16・先生用 10）</li>
    </ol>
  </div>

  <h2>① 指差し確認（はじめての画面の見かた）</h2>
  <p class="lead">今の「はじめての案内」（コース → Word で書いた？ → 表紙）が終わり、「本文へ進む」を押した直後に出します。本文はまだコースの下書きのままです。PC は7か所（紙面・道具・ページの一覧・保存のようす・セルフチェック・PDFを書き出す・？使い方）、スマホは4か所（紙面・下の「チェック」「PDF」・メニュー・保存のようす）。どの案も、あとから「？ 使い方」の中の「指差し確認をもう一度見る」で、もう一度見られます。</p>

  <figure class="is-rec">
    <figcaption><b>案A　スポットライト<em class="rec">おすすめ</em></b><span>1か所ずつ、そこだけを明るくして、横に吹き出し（ひとこと）。「次へ」で次の場所へ、「とばす」でいつでも終わり。上に「1 / 7」と点で、あといくつかが分かる。今の「はじめての案内」と同じ光の当て方</span></figcaption>
    <div class="strip pc3">
      ${img('tour-a-pc-1', '<b>1 / 7 紙面</b>：段落1つに光を当てる')}
      ${img('tour-a-pc-4', '<b>4 / 7 保存のようす</b>：小さな部品でも、そこだけ明るい')}
      ${img('tour-a-pc-7', '<b>7 / 7 ？使い方</b>：最後は「おわり」と、もう一度見る方法')}
    </div>
    <div class="strip ph3" style="border-top:1px solid var(--line)">
      ${img('tour-a-ph-1', '<b>スマホ 1 / 4</b>：紙面', 'ph')}
      ${img('tour-a-ph-2', '<b>2 / 4</b>：下のチェック・PDF', 'ph')}
      ${img('tour-a-ph-3', '<b>3 / 4</b>：メニュー', 'ph')}
      <div class="note-cell"><p>スマホの吹き出しは横いっぱい（今の案内と同じ）。4つ目は上の帯の「保存のようす」。</p><p>押せるのは「次へ」「とばす」だけ（光の当たった所も押せない）。7つ見ても1分かからない長さにしています。</p></div>
    </div>
    ${pros(
      ['1つずつなので、目が迷わない。今の「はじめての案内」の続きとして自然に見える', '「とばす」でいつでもやめられ、やめても困らない（あとから見直せる）', 'スマホでも同じ形で動く'],
      ['7回「次へ」を押す手間がある（急いでいる学生は、すぐ「とばす」）', '見ている間は、ほかの操作ができない'],
    )}
  </figure>

  <figure>
    <figcaption><b>案B　番号の付箋を一度に</b><span>全部の場所に番号を付けて一度に見せ、1枚のカードに1〜7の説明。「わかった」を1回押せば終わり</span></figcaption>
    <div class="strip" style="grid-template-columns: 2.6fr 1fr">
      ${img('tour-b-pc', '<b>PC</b>：7か所の番号と、紙面の上のカード')}
      ${img('tour-b-ph', '<b>スマホ</b>：4か所', 'ph')}
    </div>
    ${pros(['1回押すだけで終わる', '全体の配置が一度に分かる（どこに何があるかの地図になる）'], ['見るところが多く、番号とカードの間を目が行き来する', 'カードが紙面に重なる。スマホは画面が狭く、番号どうしが近い', '読まずに「わかった」を押されやすい'])}
  </figure>

  <figure>
    <figcaption><b>案C　光る点</b><span>暗くせず、操作も止めない。場所ごとに小さな点が光り、マウスを重ねる（スマホはタップ）とひとことが出る。その場所を使うと、点は消える。左下に「あといくつ」と「すべて消す」</span></figcaption>
    <div class="strip pc2">
      ${img('tour-c-pc-1', '<b>はじめ</b>：7つの点。紙面の点に重ねたところ')}
      ${img('tour-c-pc-2', '<b>書き始めたあと</b>：紙面と保存の点が消え、あと5つ。道具の点に重ねたところ')}
    </div>
    <div class="strip ph2" style="border-top:1px solid var(--line)">
      ${img('tour-c-ph-1', '<b>スマホ</b>：紙面の点をタップ', 'ph')}
      ${img('tour-c-ph-2', '<b>書いたあと</b>：残り2つ', 'ph')}
      <div class="note-cell"><p>点はその場所を使うまで残ります（「すべて消す」で全部消せる）。</p><p>スマホの点は小さいので、押せる範囲は見た目より広くします（指で押しやすい 44px ほど）。</p></div>
    </div>
    ${pros(['すぐ書き始められ、じゃまにならない', '使った所から消えるので、「まだ使っていない所」だけが残る'], ['気づかない・点の意味が分からない学生がいる（説明しないと押さない）', 'しばらく画面に点が残り、散らかって見える。セルフチェックの赤い印と見分けにくいことも', 'スマホにはマウスを重ねる操作がなく、タップしないと読めない'])}
  </figure>
  <p class="why"><b>おすすめは案A（スポットライト）</b>：学生はコースを選び表紙を書いた流れのまま、同じ光の当て方で「次はここ」を順に見られます。1回に読むのは1行だけなので、文が苦手な学生にも負担が軽く、「とばす」でやめても「？ 使い方」から見直せます。案Bは早く終わりますが、7か所とカードを見比べる必要があり、スマホでは窮屈です。案Cは書くことを止めない良さがある反面、何もしないと点の意味が伝わらず、画面に点が残り続けます。</p>

  <h2>② 「？ 使い方」（ツールの中のヘルプ）</h2>
  <p class="lead">右の欄（スマホはメニュー）の「使い方（手引き）」のリンクを、「？ 使い方」のボタンに替えます。中は、項目の一覧・開いた項目（短い文・画面の写真・動画）・言葉で探す、の3つ。動画（音なし・字幕つき 20〜40秒）はあとで作るので、今は「準備中」の見本です。「言葉で探す」は、入れた言葉が項目の文に入っているかを調べるだけで、AI ではありません。どこにも送りません。管理ページにも同じ「？ 使い方」を付け、先生用の項目を入れます。</p>
  <figure>
    <figcaption><b>入り口（どの案も同じ）</b><span>PC は右の欄の「バックアップ」の横、スマホはメニューの中。手順書のリンクがある年は、3つ並びます</span></figcaption>
    <div class="entry">
      ${img('entry-pc', '<b>PC</b>：右の欄の上')}
      ${img('entry-ph', '<b>スマホ</b>：メニュー（右上の ≡）', 'ph')}
      <div class="note-cell"><p><b>言葉で探す</b>の例：「PDF 出ない」と入れると、両方の言葉が入っている項目（PDF の出し方・下書きの PDF）を先に、片方だけの項目をその下に出します。入っている言葉には黄色の印。</p><p>全角・半角や大文字・小文字の違いはそろえます（「ＰＤＦ」でも見つかる）。言い方の違い（「出ない」と「出せない」など）は、項目ごとに「よく使われる言い方」を足しておきます。</p><p><a href="help-try.html" target="_blank"><b>help-try.html</b></a> で、好きな言葉を入れて試せます（右の画像）。</p></div>
      ${img('help-try', '<b>試す画面</b>（help-try.html）：「消えた」と入れたところ')}
    </div>
  </figure>

  ${[
    {
      d: 'a', rec: true, name: '案A　右の欄が切り替わる', desc: 'PC は右の欄（セルフチェックのところ）が、まるごと使い方に替わる。上に「言葉で探す」、項目を押すと中身、「← 一覧へ」で戻る、「閉じる」でセルフチェックに戻る。紙面と道具はそのまま使える。スマホは画面いっぱいの欄（ほかの下から出る欄と同じ形）',
      good: ['紙面を見ながら、手順のとおりに操作できる（説明と画面を行き来しない）', 'ほかの欄（ページ一覧・メニュー）と同じ場所・同じ形で、新しい形を覚えなくてよい', 'スマホも今の「下から出る欄」と同じ'],
      weak: ['幅が狭い（312px）ので、画面の写真が小さい（押すと大きくする）', '開いている間は、セルフチェックが見えない'],
      admin: '管理ページ：右の端に同じ欄（見本の上に重なる）',
    },
    {
      d: 'b', name: '案B　真ん中の大きな窓', desc: '画面の真ん中に大きな窓。左に項目の一覧（探した結果）、右に中身。広いので、文は左、動画と画面の写真は右に並べる。スマホは窓の中で、一覧と中身を1つずつ',
      good: ['広くて読みやすい。写真・動画が大きい', '一覧と中身が同時に見え、ほかの項目へ移りやすい'],
      weak: ['紙面がかくれるので、読みながら操作できない（閉じると手順を忘れる）', 'スマホでは窓のまわりが少し見えるだけで、案Aとほぼ同じになる'],
      admin: '管理ページ：同じ窓（「年度の設定」を開いたところ）',
    },
    {
      d: 'c', name: '案C　左から出る引き出し', desc: '左から引き出しが出て、ページの一覧の上に重なる。上に「言葉で探す」、項目を押すと中身。右の欄（セルフチェック）は見えたまま。スマホは左から、画面の9割ほど',
      good: ['セルフチェックを見ながら使える', '案Aより少し広い（384px）'],
      weak: ['道具（紙面の左わき）とページの一覧がかくれる。図の入れ方を読みながら道具を押せない', '「？ 使い方」のボタンは右の欄にあるのに、左から出る（目が左右に動く）'],
      admin: '管理ページ：左の入力欄の上に重なる',
    },
  ]
    .map(
      (x) => `<figure${x.rec ? ' class="is-rec"' : ''}>
    <figcaption><b>${x.name}${x.rec ? '<em class="rec">おすすめ</em>' : ''}</b><span>${x.desc}</span></figcaption>
    ${
      x.d === 'b'
        ? `<div class="strip">${img(`help-b-pc-topic`, '<b>PC（画面全体）</b>：開いた項目「PDF の出し方（端末ごと）」')}</div>
    <div class="strip pc2" style="border-top:1px solid var(--line)">${img('help-b-pc-list-z', '<b>窓を大きく</b>：開いたところ（項目の一覧と、最初の項目）')}${img('help-b-pc-search-z', '<b>言葉で探す</b>：「PDF 出ない」')}</div>`
        : `<div class="strip pcz">${img(`help-${x.d}-pc-topic`, '<b>PC（画面全体）</b>：開いた項目「PDF の出し方（端末ごと）」')}${img(`help-${x.d}-pc-list-z`, '<b>大きく</b>：項目の一覧')}${img(`help-${x.d}-pc-topic-z`, '<b>開いた項目</b>')}${img(`help-${x.d}-pc-search-z`, '<b>言葉で探す</b>：「PDF 出ない」')}</div>`
    }
    <div class="strip ph4" style="border-top:1px solid var(--line)">
      ${img(`help-${x.d}-ph-list`, '<b>スマホ</b>：一覧', 'ph')}
      ${img(`help-${x.d}-ph-topic`, '<b>開いた項目</b>（iPhone を選んでいる）', 'ph')}
      ${img(`help-${x.d}-ph-search`, '<b>言葉で探す</b>', 'ph')}
      ${img(`help-${x.d}-admin`, `<b>${x.admin}</b>`)}
    </div>
    ${pros(x.good, x.weak)}
  </figure>`,
    )
    .join('\n')}
  <p class="why"><b>おすすめは案A（右の欄が切り替わる）</b>：使い方を開く学生は、たいてい「いま、この操作をしたい」ときです。案Aなら紙面と道具を出したまま、右の手順を見て、そのとおりに押せます。スマホも今の「下から出る欄」と同じ形で、新しく覚えることがありません。写真が小さいのは、押すと大きく開くようにして補います。案Bは読みやすさでは一番ですが、紙面がかくれるため「読む → 閉じる → 操作」を繰り返すことになります。案Cは道具とページの一覧をかくしてしまい、図・表の入れ方のような「道具を使う説明」と相性がよくありません。管理ページも、同じ考えで右の端に出します。</p>

  <h2>③ 使い方に入れる項目</h2>
  <p class="lead">今の手引き（学生用4ページ・教員用8ページ）から作った案です。1つの項目は、ひとこと＋手順2〜3つ（＋うまくいかないとき）まで。「画面」は手引きの画面の写真をそのまま使えるもの、「動画」はあとで作る動画（音なし・字幕つき）の候補と長さの目安です。</p>
  <div class="lists">
    <section><h3>学生用<span>${H.student.length}項目（画面 ${H.student.filter((t) => t.shot).length}・動画 ${H.student.filter((t) => t.video).length}）</span></h3><ul class="tl">${topicRows(H.student)}</ul></section>
    <section><h3>先生用（管理ページ）<span>${H.teacher.length}項目（画面 ${H.teacher.filter((t) => t.shot).length}・動画 ${H.teacher.filter((t) => t.video).length}）</span></h3><ul class="tl">${topicRows(H.teacher)}</ul>
      <div class="search-demo"><b>紙の手引きに残すもの（1〜2ページ）</b>：ツールの URL と QR、ログイン、最初に知っておくこと3つ（自動保存・セルフチェック・PDF）、「困ったら ？ 使い方」の一文。</div>
    </section>
  </div>
</body>
</html>
`
}

await withEdge(async (browser) => {
  if (want('tour')) {
    console.log('指差し確認')
    await tourShots(browser)
  }
  if (want('help')) {
    console.log('使い方（学生用ツール）')
    await helpShots(browser)
  }
  if (want('admin')) {
    console.log('使い方（管理ページ）')
    await adminShots(browser)
  }
  if (want('try')) {
    // 試す画面（help-try.html）：言葉を入れて、結果が出るか
    console.log('試す画面')
    const page = await browser.newPage()
    await page.setViewport({ width: 760, height: 820, deviceScaleFactor: 1.5 })
    await page.goto(`${APP}/${DIR}/help-try.html`, { waitUntil: 'networkidle0' })
    await page.type('.v27h-search input', '消えた')
    await sleep(400)
    const n = await page.evaluate(() => document.querySelectorAll('.v27h-res li button').length)
    if (!n) throw new Error('help-try.html：「消えた」で何も出ません')
    await shot(page, 'help-try')
    await page.close()
  }
  if (want('review')) {
    writeFileSync(`${DIR}/review.html`, reviewHtml())
    console.log(`  ${DIR}/review.html`)
    const page = await browser.newPage()
    await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 })
    await page.goto(`${APP}/${DIR}/review.html`, { waitUntil: 'networkidle0' })
    await page.evaluate(async () => {
      for (const im of document.images) {
        im.loading = 'eager'
        if (!im.complete) await new Promise((r) => (im.onload = im.onerror = r))
      }
    })
    await page.screenshot({ path: `${OUT}/review.png`, fullPage: true })
    console.log(`  ${OUT}/review.png`)
  }
})
