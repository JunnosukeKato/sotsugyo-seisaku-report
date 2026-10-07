// ツールの中の「？ 使い方」に出す画面の写真（public/help/*.jpg）を作る（mockups/v27 案A。項目は src/help/helpTopics.ts）。
// 本物のツール（学生用ツール・管理ページの試験版）を Edge で操作して撮り、長い辺 900px 以下・画質 0.8 の JPEG にする
// （学生用ツールは相対パスで、管理ページは GitHub Pages の URL で読む。src/help/links.ts）。
// 使い方: node scripts/make-help-images.mjs（開発サーバーが http://localhost:5173 で動いていること）
//   SHOTS=student（学生用ツール）／SHOTS=admin（管理ページ） node scripts/make-help-images.mjs … 一部だけ撮り直す
//   Edge は EDGE_PORT（ふだんは 9403）で起動する
// 学生用ツールは Google のログインとドライブを偽物（scripts/e2e/fakeGoogle.mjs）に差し替える。本物の Google にはつながない。
// 見本の原稿は、衣装コースの架空の学生（文化花子・00ZZ0123）。メールアドレスは、架空の学生の 00zz0123@bunka-wu.ac.jp と、
// 管理ページの試験版の example.ac.jp だけが写る（本物の大学のアドレスは写さない）。
// 見本の画像（デザイン画・作品写真など）は docs/guide-images/sample/ のもの（読むだけ）
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

process.env.EDGE_PORT ??= '9403'
const { withEdge } = await import('./poc/edge.mjs')
const { fakeDrive, routeGoogle } = await import('./e2e/fakeGoogle.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const OUT = 'public/help'
/** 画像の長い辺の上限（px）と、JPEG の画質 */
const MAX = 900
const QUALITY = 0.8
const SHOT_ONLY = (process.env.SHOTS ?? '').split(',').filter(Boolean)
const doShot = (k) => !SHOT_ONLY.length || SHOT_ONLY.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PC = { width: 1440, height: 900, deviceScaleFactor: 2 }
const STUDENT_EMAIL = '00zz0123@bunka-wu.ac.jp'
const config = JSON.parse(readFileSync('scripts/e2e/config-fixture.json', 'utf8'))
for (const c of config.courses) delete c.notice
mkdirSync(OUT, { recursive: true })

/** 撮影のじゃまになるもの（別のタブの知らせは、撮るときだけ出す） */
const SHOT_CSS = `.no-tablock .login-over.tab-locked { display: none !important; }`

/** 撮影のあいだに src/ が直されても、画面が入れ替わらないようにする（開発サーバーの即時反映をつながない）。指差し確認は、見たことにしておく */
const prepare = (page) =>
  page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
    try {
      localStorage.setItem('sotsugyo-seisaku-report-tour', 'done')
    } catch {}
  })

const ready = (page) =>
  page.waitForFunction(() => {
    const s = window.__editor?.getSnapshot()
    return s?.layout && !s.rendering && !s.turning && !document.querySelector('.loading')
  }, { timeout: 120000 })

/** ドライブへの保存が済むまで待つ */
const driveSaved = (page) =>
  page.waitForFunction(() => [...document.querySelectorAll('.chip.ok')].some((c) => /ドライブに保存|\d+:\d+/.test(c.textContent)) && !document.querySelector('.chip .dot.busy'), { timeout: 60000 })

/** 要素の範囲（いくつかなら、それらを囲む範囲。text があれば、その文字を含むものだけ） */
function rectOf(sel, text) {
  const els = [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 0 && (!text || e.textContent.includes(text)))
  if (!els.length) return null
  const rs = els.map((e) => e.getBoundingClientRect())
  const x = Math.min(...rs.map((r) => r.left))
  const y = Math.min(...rs.map((r) => r.top))
  return { x, y, w: Math.max(...rs.map((r) => r.right)) - x, h: Math.max(...rs.map((r) => r.bottom)) - y }
}
const R = async (page, sel, text) => {
  const r = await page.evaluate(rectOf, sel, text)
  if (!r) throw new Error(`見つかりません：${sel}${text ? `（${text}）` : ''}`)
  return r
}
const pad = (r, px, py = px) => ({ x: r.x - px, y: r.y - py, w: r.w + px * 2, h: r.h + py * 2 })
const union = (...rs) => {
  const x = Math.min(...rs.map((r) => r.x))
  const y = Math.min(...rs.map((r) => r.y))
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y }
}
const clickText = (page, selector, text) => page.evaluate((selector, text) => [...document.querySelectorAll(selector)].find((b) => b.textContent.includes(text)).click(), selector, text)
const CUR = '.page-viewport.front [data-vivliostyle-page-container].is-current'

/** 縮めて JPEG にするためのページ（canvas で縮める） */
let shrinker = null
/**
 * 画面を切り抜いて撮り、長い辺 MAX px 以下の JPEG にして public/help/<name>.jpg に書き出す。clip：切り抜く範囲（CSS px）
 */
async function capture(page, name, clip) {
  const vp = page.viewport()
  const x = Math.max(0, Math.round(clip.x))
  const y = Math.max(0, Math.round(clip.y))
  const c = { x, y, width: Math.min(vp.width, Math.round(clip.x + clip.w)) - x, height: Math.min(vp.height, Math.round(clip.y + clip.h)) - y }
  const png = await page.screenshot({ clip: c, captureBeyondViewport: false, encoding: 'base64' })
  const out = await shrinker.evaluate(
    async (b64, max, quality) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const k = Math.min(1, max / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * k)
      canvas.height = Math.round(img.height * k)
      const g = canvas.getContext('2d')
      g.imageSmoothingQuality = 'high'
      g.fillStyle = '#fff'
      g.fillRect(0, 0, canvas.width, canvas.height)
      g.drawImage(img, 0, 0, canvas.width, canvas.height)
      return { data: canvas.toDataURL('image/jpeg', quality).split(',')[1], w: canvas.width, h: canvas.height }
    },
    png,
    MAX,
    QUALITY,
  )
  writeFileSync(`${OUT}/${name}.jpg`, Buffer.from(out.data, 'base64'))
  console.log(`  ${OUT}/${name}.jpg  (${out.w}×${out.h}, ${Math.round((out.data.length * 0.75) / 1024)}KB)`)
}

// =====================================================================
// 学生用ツール
// =====================================================================

/** 「セルフチェック」の画像のために、わざと入れる誤り（「見頃」「記事」「です」） */
const CHECK_TEXT = '二回目の仮縫いでは、前見頃の丈を2cm短くした。袖の記事が重く、腕が下がって見えたためです。'
const P7 = '二回目の仮縫いでは、実際に舞台の上で歩いたり腕を回したりして、動きやすさを確かめた。'

/** ページの中で、見本の画像（docs/guide-images/sample/）を読み込み、見本の原稿にする（本文5ページ・図3枚・素材表・作品写真1枚・抄録） */
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
          p('p7', '二回目の仮縫いでは、実際に舞台の上で歩いたり腕を回したりして、動きやすさを確かめた。'),
          sub('s5', '袖の刺繍'),
          p('p8', '袖には、海の波を表す模様を金の糸で刺繍した', ref('f3'), '。図案は実物大に描いて袖に写し、刺繍枠に張ってから一針ずつ刺した。'),
          fig('r3', 'f3', 'g-process', '袖の刺繍'),
          p('p9', '最初の図案は波が細かすぎて、離れると模様が見えなかった。そこで波の数を減らし、一つ一つの波を大きく描き直した。糸は、照明の下で強く光りすぎないよう、つやを抑えた金色を選んだ。'),
          p('p10', '刺繍には片袖でおよそ20時間かかった。両袖の模様がそろうよう、型紙に印を付けて位置を合わせた。刺し終えたあとは、裏に薄い接着芯を貼り、着たときに糸が引っかからないようにした。'),
          sub('s6', '帯とズボン'),
          p('p11', '帯は、からし色の布を幅15cmの筒に縫い、腰に二重に巻いて後ろで結んだ。結び目が大きく見えるよう、端に重さのある房を付けた。房は動いたときに揺れて、舞台の上で動きを強調する役割も果たした。'),
          p('p12', 'ズボンは、裾に向かって細くなる形にし、裾口にゴムを入れて動きやすくした。股上を深くとり、しゃがんだり飛び跳ねたりしても突っ張らないようにした。'),
          sub('s7', '仕上げ'),
          p('p13', '最後に全体をアイロンで整え、本番と同じ照明の下で色の見え方を確かめた。袖の刺繍が客席の後ろからも光って見えることを確かめ、完成とした。'),
        ],
      },
      {
        id: 'c3',
        title: 'まとめ',
        blocks: [
          p('p14', '本制作では、主人公の成長を一着の衣装で表すことを目標とした。袖の大きな膨らみと金の刺繍によって、旅立ちの若々しさと帰還の頼もしさの両方を表すことができた。'),
          p('p15', '一方で、帯の結び目が大きく、場面転換の早替えに時間がかかるという課題が残った。今後は、見た目の美しさだけでなく、着脱のしやすさも初めから考えたデザインを心がけたい。'),
          p('p16', '制作を通して、舞台衣装は客席からの見え方と演者の動きやすさの両方を考える必要があることを学んだ。この経験を、今後の衣装制作に生かしたい。'),
        ],
      },
    ],
    references: [],
    workPhotos: { layout: 1, imageIds: ['g-photo1'] },
    acknowledged: [],
  })
}

/** 段落の文を書き換える */
const setParagraph = (page, id, text) =>
  page.evaluate(
    (id, text) => window.__editor.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === id ? { ...b, content: [{ type: 'text', text }] } : b)) })) })),
    id,
    text,
  )
const goToBlock = async (page, id) => {
  await page.evaluate((id) => window.__editor.goToPage(window.__editor.pageOfBlock(id), 'none'), id)
  await sleep(300)
  await ready(page)
}

/** 学生用ツールを、偽物の Google につないで開く（ログインはまだ） */
async function openTool(browser, drive, { context, viewport = PC } = {}) {
  context ??= await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  page.on('dialog', (d) => d.accept())
  await prepare(page)
  await page.setViewport(viewport)
  await routeGoogle(page, drive, config)
  await page.goto(`${APP}/`, { waitUntil: 'networkidle0', timeout: 90000 })
  await page.addStyleTag({ content: SHOT_CSS })
  return { context, page }
}

async function studentShots(browser) {
  const drive = fakeDrive(STUDENT_EMAIL)
  const { context, page } = await openTool(browser, drive)
  await page.evaluate(() => document.documentElement.classList.add('no-tablock'))
  await ready(page)

  // ---- ログインの窓 ----
  await page.waitForSelector('.login-over .login-btn')
  await sleep(500)
  await capture(page, 'login', pad(await R(page, '.login-card'), 16))
  await page.click('.login-btn')
  await page.waitForFunction(() => !document.querySelector('.login-over'), { timeout: 60000 })

  // ---- はじめての案内：コース → Word で書き始めていますか？ ----
  await page.waitForSelector('.guide.step-course .g-opts button')
  await clickText(page, '.guide .g-opts button', '映画・舞台衣装')
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await ready(page)
  await sleep(900)
  await capture(page, 'word', pad(await R(page, '.g-tip'), 14))
  await page.evaluate(() => document.querySelector('.g-word-opt.no').click())
  await page.waitForSelector('.guide .g-later')
  await page.evaluate(() => document.querySelector('.guide .g-later').click())
  await page.evaluate(() => window.__editor.finishEditing())
  await ready(page)

  // ---- 見本の原稿にする ----
  await page.evaluate(setupWriting)
  await sleep(800)
  await ready(page)
  await driveSaved(page)
  const errors = await page.evaluate(() => window.__editor.getSnapshot().findings.map((f) => `${f.severity}:${f.title}`))
  if (errors.length) throw new Error(`見本の原稿に指摘が残っています：${errors.join('、')}`)

  // ---- 提出用の PDF を書き出す窓（エラーが0件のとき） ----
  await page.evaluate(() => document.querySelector('.side .export').click())
  await page.waitForSelector('.modal .checklist')
  await page.evaluate(() => document.activeElement?.blur())
  await sleep(500)
  await capture(page, 'export', await R(page, '.modal'))
  await page.evaluate(() => document.querySelector('.modal .close').click())

  // ---- 抄録：先生の許可が出るまで ----
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, abstract: { ...r.abstract, started: false } })))
  await sleep(500)
  await ready(page)
  await page.evaluate(() => window.__editor.goToArea('abstract'))
  await sleep(900)
  await ready(page)
  {
    const lock = await R(page, `${CUR} .abstract-lock`)
    const head = await R(page, CUR)
    await capture(page, 'abstract', { x: lock.x - 24, y: head.y + 60, w: lock.w + 48, h: lock.y + lock.h - head.y - 60 + 20 })
  }
  await page.evaluate(() => window.__editor.update((r) => ({ ...r, abstract: { ...r.abstract, started: true } })))
  await sleep(500)
  await ready(page)

  // ---- セルフチェック・下書きの PDF：わざと誤りを入れる ----
  await setParagraph(page, 'p7', CHECK_TEXT)
  await sleep(500)
  await ready(page)
  await driveSaved(page)
  await goToBlock(page, 'p3')
  await page.mouse.move(5, 5)
  await sleep(600)
  // 学生の画面（教員用の項目）：PC の画面全体
  await capture(page, 'student-screen', { x: 0, y: 0, w: PC.width, h: PC.height })
  {
    // 指摘の一覧が欄の中で切れないよう、画面を縦に長くして撮る
    await page.setViewport({ ...PC, height: 1200 })
    await sleep(800)
    await ready(page)
    const sec = await R(page, '.side .sec.check')
    const issues = await R(page, '.side .sec.check .igroup')
    await capture(page, 'check', { x: sec.x, y: sec.y, w: sec.w, h: issues.y + issues.h - sec.y + 6 })
    await page.setViewport(PC)
    await sleep(800)
    await ready(page)
  }
  await page.evaluate(() => document.querySelector('.side .export').click())
  await page.waitForSelector('.modal .draft-box')
  await page.evaluate(() => document.activeElement?.blur())
  await sleep(500)
  await capture(page, 'export-draft', await R(page, '.modal'))
  await page.evaluate(() => document.querySelector('.modal .close').click())
  await setParagraph(page, 'p7', P7)
  await sleep(500)
  await ready(page)

  // ---- 書く：段落を書いているところ（道具と紙面の上半分） ----
  await goToBlock(page, 'p3')
  await page.evaluate(() => window.__editor.openWhenReady('p3', 999))
  await page.waitForFunction(() => window.__editor.getSnapshot().editingId === 'p3', { timeout: 30000 })
  await sleep(600)
  {
    const palette = await R(page, '.palette')
    const paper = await R(page, CUR)
    const figure = await R(page, `${CUR} figure[data-figure-id]`)
    await capture(page, 'write', { x: palette.x - 18, y: 0, w: paper.x + paper.w + 18 - (palette.x - 18), h: figure.y + figure.h + 14 })
  }
  await page.keyboard.press('Escape')
  await sleep(400)
  await ready(page)

  // ---- 図を押したところ（左の道具に「この図」） ----
  await page.evaluate(() => window.__editor.select({ kind: 'figure', id: 'f1' }))
  await sleep(600)
  {
    const palette = await R(page, '.palette')
    const figure = await R(page, `${CUR} figure[data-figure-id="f1"]`)
    await capture(page, 'figure', { x: palette.x - 18, y: palette.y - 12, w: figure.x + figure.w + 40 - (palette.x - 18), h: Math.max(palette.y + palette.h, figure.y + figure.h) - palette.y + 30 })
  }
  await page.evaluate(() => window.__editor.select(null))
  await sleep(300)

  // ---- 作品写真のページと、並べ方 ----
  await page.evaluate(() => window.__editor.goToArea('photos'))
  await sleep(900)
  await ready(page)
  {
    const palette = await R(page, '.palette')
    const paper = await R(page, CUR)
    await capture(page, 'photos', { x: palette.x - 18, y: 0, w: paper.x + paper.w + 18 - (palette.x - 18), h: Math.min(PC.height, paper.y + paper.h * 0.62) })
  }
  await goToBlock(page, 'p3')

  // ---- 保存のようす（「ドライブに保存」を押したところ） ----
  await page.mouse.move(5, 5)
  await page.click('.side .drive-chip-wrap .chip')
  await page.waitForSelector('.drive-pop')
  await sleep(300)
  await capture(page, 'drive', union(await R(page, '.side .side-head'), pad(await R(page, '.drive-pop'), 10)))
  await page.keyboard.press('Escape')
  await sleep(300)

  // ---- バックアップ（自動の控え） ----
  await page.evaluate(() => [...document.querySelectorAll('.side .link-btn')].find((b) => b.textContent.includes('バックアップ')).click())
  await page.waitForSelector('.modal .snapshots, .modal .muted')
  await page.evaluate(() => document.activeElement?.blur())
  await sleep(400)
  await capture(page, 'backup', await R(page, '.modal'))
  await page.evaluate(() => document.querySelector('.modal .close').click())

  // ---- 別の端末（もう1台のパソコン）があとから保存した：この端末で書くと、どちらで続けるかを聞く ----
  {
    const other = await openTool(browser, drive)
    await ready(other.page)
    await other.page.waitForSelector('.login-btn')
    await other.page.click('.login-btn')
    await other.page.waitForFunction(() => !document.querySelector('.login-over'), { timeout: 90000 })
    await ready(other.page)
    // 偽物のドライブは写真（バイナリ）を正しく受け渡せないので、見本の画像を入れ直してから書き足す
    await other.page.evaluate(setupWriting)
    await sleep(800)
    await ready(other.page)
    await other.page.evaluate(() => window.__editor.update((r) => ({ ...r, body: r.body.map((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === 'p16' ? { ...b, content: [{ type: 'text', text: '制作を通して、舞台衣装は客席からの見え方と演者の動きやすさの両方を考える必要があることを学んだ。（別の端末で書き足した）' }] } : b)) })) })))
    // ドライブの原稿に、書き足した分が届くまで待つ
    for (let i = 0; i < 60 && !JSON.stringify(drive.report() ?? {}).includes('別の端末で書き足した'); i++) await sleep(500)
    if (!JSON.stringify(drive.report() ?? {}).includes('別の端末で書き足した')) throw new Error('別の端末の原稿が、ドライブに保存されません')
    await other.context.close()
  }
  await page.bringToFront()
  await setParagraph(page, 'p15', '一方で、帯の結び目が大きく、場面転換の早替えに時間がかかるという課題が残った。')
  await page.waitForSelector('.drive-two', { timeout: 60000 })
  await page.evaluate(() => document.activeElement?.blur())
  await sleep(500)
  await capture(page, 'conflict', await R(page, '.modal'))
  await clickText(page, '.modal button', 'この端末の原稿で続ける')
  await page.waitForFunction(() => !document.querySelector('.drive-two'), { timeout: 60000 })
  await ready(page)

  // ---- 1時間たって Google の許可が切れたとき ----
  drive.failNext = 401
  await setParagraph(page, 'p15', '一方で、帯の結び目が大きく、場面転換の早替えに時間がかかるという課題が残った。今後は、着脱のしやすさも考えたい。')
  await page.waitForFunction(() => [...document.querySelectorAll('.modal h2')].some((h) => h.textContent.includes('もう一度ログイン')), { timeout: 60000 })
  await page.evaluate(() => document.activeElement?.blur())
  await sleep(400)
  await capture(page, 'relogin', await R(page, '.modal'))
  await clickText(page, '.modal button', 'ログインし直す')
  await driveSaved(page)

  // ---- 同じパソコンで2つめのタブを開いたとき ----
  {
    const second = await context.newPage()
    await prepare(second)
    await second.setViewport(PC)
    await routeGoogle(second, drive, config)
    await second.goto(`${APP}/`, { waitUntil: 'networkidle0', timeout: 90000 })
    await second.waitForSelector('.login-over.tab-locked .login-card', { timeout: 60000 })
    await second.evaluate(() => document.activeElement?.blur())
    await sleep(600)
    await capture(second, 'tablock', pad(await R(second, '.login-over.tab-locked .login-card'), 16))
    await second.close()
  }
  await context.close()
}

// =====================================================================
// 管理ページ（試験版）
// =====================================================================

/** 管理ページ（試験版）を開く。as：teacher なら先生の画面 */
async function openAdmin(browser, { as } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  page.on('dialog', (d) => d.accept())
  await prepare(page)
  await page.setViewport(PC)
  await page.goto(`${APP}/admin.html`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => localStorage.removeItem('sotsugyo-admin-mock'))
  await page.goto(`${APP}/admin.html${as ? `?as=${as}` : ''}`, { waitUntil: 'networkidle0' })
  await page.waitForSelector(as === 'teacher' ? '.teacher-main' : '.admin .form')
  await hideMockBadge(page)
  return { context, page }
}

/** 「試験用サーバー」の印は本物の管理ページにはないので出さない */
const hideMockBadge = (page) => page.evaluate(() => [...document.querySelectorAll('.badge')].find((b) => b.textContent.includes('試験用'))?.style.setProperty('display', 'none'))

/** 管理ページの見本（iframe）は作り直しが止まるまで待つ */
async function previewStable(page) {
  for (let i = 0; i < 40; i++) {
    const stable = await page.evaluate(() => {
      const d = document.querySelector('.preview iframe')?.contentDocument
      if (!d || d.readyState !== 'complete' || d.querySelectorAll('.page').length !== 2) return false
      if (d.__helpSeen) return true
      d.__helpSeen = true
      return false
    })
    if (stable) return
    await sleep(800)
  }
  throw new Error('管理ページの見本が表示されません')
}

async function adminShots(browser) {
  const { context, page } = await openAdmin(browser)
  // 締切を1日ずらして、「保存して学生に反映」が押せる状態にする
  const deadline = await page.evaluateHandle(() => [...document.querySelectorAll('.f')].find((f) => f.querySelector('.l')?.textContent.startsWith('最終締切')).querySelector('input'))
  await deadline.evaluate((el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '2027-01-22')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForSelector('.badge.warn')
  await hideMockBadge(page)
  await page.mouse.move(5, 5)
  await previewStable(page)
  await page.evaluate(() => document.querySelector('.preview iframe').contentDocument.fonts.ready)
  await sleep(600)
  await previewStable(page)
  {
    const previewPage = await page.evaluate(() => {
      const f = document.querySelector('.preview iframe')
      const fr = f.getBoundingClientRect()
      const r = f.contentDocument.querySelector('.page').getBoundingClientRect()
      return { y: fr.top + r.top, h: r.height }
    })
    await capture(page, 'admin-main', { x: 0, y: 0, w: PC.width, h: previewPage.y + previewPage.h + 14 })
  }
  // 見出しの欄の右（保存して学生に反映）
  {
    const header = await R(page, '.admin-header')
    const right = union(await R(page, '.admin-header .link', '変更履歴'), await R(page, '.admin-header .btn', '保存して学生に反映'))
    await capture(page, 'admin-save', { x: right.x - 12, y: header.y, w: right.w + 24, h: header.h })
  }

  // コースのカード
  await page.evaluate(() => document.querySelector('.form .course').scrollIntoView({ block: 'start' }))
  await sleep(500)
  await capture(page, 'admin-course', pad(await R(page, '.form .course'), 10))

  // 書き間違えやすい語の窓
  await page.evaluate(() => document.querySelector('.words-btn').scrollIntoView({ block: 'center' }))
  await page.click('.words-btn')
  await page.waitForSelector('.words-modal')
  await page.evaluate(() => document.activeElement?.blur())
  await sleep(500)
  await capture(page, 'admin-words', await R(page, '.words-modal'))
  await page.keyboard.press('Escape')
  await sleep(300)
  if (await page.$('.words-modal')) await clickText(page, '.words-modal button', 'やめる')

  // 下書きのひな形の窓
  await page.evaluate(() => document.querySelector('.tpl-row button').click())
  await page.waitForSelector('.tpl-modal')
  await page.evaluate(() => document.activeElement?.blur())
  await sleep(1200)
  await capture(page, 'admin-template', await R(page, '.tpl-modal'))
  await page.keyboard.press('Escape')
  await sleep(300)
  if (await page.$('.tpl-modal')) await clickText(page, '.tpl-modal button', 'やめる')

  // 詳細設定：学生のドライブ保存（Google の障害のとき）
  await page.evaluate(() => {
    const d = document.querySelector('details.details')
    d.open = true
    d.querySelector('.drive-switch').scrollIntoView({ block: 'center' })
  })
  await sleep(400)
  await capture(page, 'admin-switch', pad(union(await R(page, 'details.details summary'), await R(page, '.drive-switch')), 10))

  // 先生の登録：登録済みの人（試験版の example.ac.jp）と、メールアドレスを貼り付ける欄まで
  // （貼り付けた例は、大学のアドレスでないと「登録しない」と出るため、写さない。本物の大学のアドレスは写さない）
  await page.evaluate(() => window.scrollTo(0, 0))
  await clickText(page, '.admin-header button', '先生の登録')
  await page.waitForSelector('.modal.members .member-list li')
  await page.evaluate(() => document.activeElement?.blur())
  await sleep(400)
  {
    const modal = await R(page, '.modal.members')
    const add = await R(page, '.member-add')
    await capture(page, 'admin-members', { x: modal.x, y: modal.y, w: modal.w, h: add.y + add.h + 18 - modal.y })
  }
  await clickText(page, '.modal.members .row-buttons button', '閉じる')

  // 保存して学生に反映 → 変更履歴
  await clickText(page, '.admin-header button', '保存して学生に反映')
  await page.waitForFunction(() => document.querySelector('.message.ok'))
  await clickText(page, '.admin-header button', '変更履歴')
  await page.waitForSelector('.history li')
  await page.evaluate(() => document.activeElement?.blur())
  await sleep(400)
  await capture(page, 'admin-history', await R(page, '.modal'))
  await context.close()

  // 先生の画面
  const t = await openAdmin(browser, { as: 'teacher' })
  await t.page.mouse.move(5, 5)
  await sleep(500)
  {
    const firstCourse = await R(t.page, '.teacher-main .course')
    await capture(t.page, 'admin-teacher', { x: 0, y: 0, w: PC.width, h: firstCourse.y + firstCourse.h + 16 })
  }
  await t.context.close()
}

await withEdge(async (browser) => {
  shrinker = await browser.newPage()
  await shrinker.goto('about:blank')
  if (doShot('student')) {
    console.log('学生用ツール')
    await studentShots(browser)
  }
  if (doShot('admin')) {
    console.log('管理ページ')
    await adminShots(browser)
  }
})
