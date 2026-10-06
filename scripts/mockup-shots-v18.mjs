// デザイン案 v18（Google ドライブへの自動保存：つなぐ入口・保存のようす・確認の窓）を画像に書き出す。
// 学生用ツールに、案ごとの部品を仮に足して撮る（まだ作っていない部品は、この撮影のためだけに足す）。
// 使い方: node scripts/mockup-shots-v18.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { mkdirSync } from 'node:fs'
import { stubConfig } from './e2e/configStub.mjs'
import { withEdge } from './poc/edge.mjs'

const OUT = 'mockups/v18/screens'
mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const cloud = (check) =>
  `<svg class="v18-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18.5h10.5a4 4 0 0 0 .7-7.94A6 6 0 0 0 6.6 9.6 4.5 4.5 0 0 0 7 18.5z"/>${check ? '<path d="M9.4 13.7l2 2 3.6-3.7"/>' : ''}</svg>`
const EMAIL = '23fa0123@bunka-wu.ac.jp'

// 撮影で使う部品（ページの中に渡す）
const H = {
  cloud: cloud(false),
  cloudOk: cloud(true),
  menu: `
    <div class="who">${cloud(true)}<div><b>ドライブにつないでいます</b><small>${EMAIL}</small></div></div>
    <div class="when">最後にドライブに保存：今日 13:44<br>この端末（ブラウザ）にも保存しています</div>
    <button>今すぐドライブに保存</button>
    <button>ドライブの原稿を読み込み直す</button>
    <button>この端末から原稿を消す（共用のパソコンで）</button>
    <hr><button class="sub">ドライブとのつながりを切る</button>`,
  // 案1・案3：保存のようすの表示（ひとつにまとめる）
  chip: {
    off: '<span class="chip warn"><i class="dot warn"></i>この端末だけに保存 13:44</span>',
    saving: '<span class="chip"><i class="dot busy"></i>ドライブに保存しています…</span>',
    saved: `<span class="chip ok v18-click">${cloud(true)}ドライブに保存 13:44<span class="caret">▾</span></span>`,
    offline: '<span class="chip warn" title="電波がないため、ドライブには送れていません。つながったら自動で送ります"><i class="dot warn"></i>この端末にだけ保存 13:44（電波なし）</span>',
    expired: '<span class="chip ng v18-click"><i class="dot ng"></i>ドライブに保存できません　<u>ログインし直す</u></span>',
  },
  // 案2：ドライブの欄
  card: {
    off: `<div class="v18-card"><div class="t">${cloud(false)}Google ドライブ</div><div class="sub">大学のアカウントでつなぐと、原稿がドライブにも自動で保存され、スマホなど別の端末でも続きを書けます。</div><button class="go">大学のアカウントでつなぐ</button></div>`,
    saving: `<div class="v18-card"><div class="t"><i class="dot busy"></i>ドライブに保存しています…</div><div class="sub">${EMAIL}</div></div>`,
    saved: `<div class="v18-card"><div class="t ok">${cloud(true)}ドライブに保存済み <span class="time">13:44</span><button class="more">⋯</button></div><div class="sub">${EMAIL}</div></div>`,
    offline: `<div class="v18-card warn"><div class="t"><i class="dot warn"></i>この端末にだけ保存しています</div><div class="sub">電波がないため、ドライブには送れていません。つながったら自動で送ります。</div></div>`,
    expired: `<div class="v18-card ng"><div class="t"><i class="dot ng"></i>ドライブに保存できていません</div><div class="sub">ログインの期限が切れました（この端末には保存しています）。</div><button class="go">ログインし直す</button></div>`,
  },
}

const CSS = `
  .guide { display: none !important; }
  .v18-ic { width: 15px; height: 15px; flex: none; }
  .chip.ok { color: var(--ink); }
  .chip.ok .v18-ic { color: var(--ok); }
  .chip.warn { color: #87590a; background: #fbf0d9; }
  .chip .dot.warn { background: #d89a12; }
  .chip.ng u { color: var(--error); text-underline-offset: 2px; }
  .v18-click { cursor: pointer; box-shadow: inset 0 0 0 1px var(--line); background: #fff; }
  .chip .caret { font-size: 9px; color: var(--muted); margin-left: -2px; }
  .link-btn.v18-drive { color: var(--accent); border-color: #b9c1dd; font-weight: 700; }
  .link-btn.v18-drive svg { color: var(--accent); }
  .v18-pop { position: absolute; z-index: 30; left: 16px; right: 16px; top: 112px; padding: 8px; background: #fff; border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 12px 32px rgba(30, 25, 20, 0.2); display: grid; gap: 2px; font-size: 12.5px; }
  .v18-pop.inline { position: static; width: auto; box-shadow: none; margin-top: 12px; }
  .v18-pop .who { display: flex; gap: 8px; align-items: flex-start; padding: 6px 8px 4px; }
  .v18-pop .who .v18-ic { width: 20px; height: 20px; color: var(--ok); margin-top: 1px; }
  .v18-pop .who b { display: block; font-size: 13px; }
  .v18-pop .who small { color: var(--muted); font-size: 11.5px; }
  .v18-pop .when { padding: 2px 8px 8px 36px; color: var(--muted); font-size: 11.5px; line-height: 1.6; border-bottom: 1px solid var(--line); margin-bottom: 4px; }
  .v18-pop button { border: 0; background: none; text-align: left; padding: 8px 10px; border-radius: 7px; font-size: 13px; color: var(--ink); }
  .v18-pop button:first-of-type { background: var(--accent-soft); color: var(--accent); font-weight: 700; }
  .v18-pop hr { border: 0; border-top: 1px solid var(--line); margin: 4px 0; width: 100%; }
  .v18-pop button.sub { color: var(--muted); font-size: 12px; }
  .v18-card { margin-top: 12px; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: #fff; display: grid; gap: 4px; position: relative; }
  .v18-card.warn { background: #fdf7ea; border-color: #ecd6a6; }
  .v18-card.ng { background: var(--error-soft); border-color: #eab4b4; }
  .v18-card .t { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 700; }
  .v18-card .t.ok .v18-ic { color: var(--ok); width: 18px; height: 18px; }
  .v18-card .t .v18-ic { width: 18px; height: 18px; color: var(--accent); }
  .v18-card .t .time { font-weight: 400; color: var(--muted); }
  .v18-card .t .more { margin-left: auto; border: 0; background: none; font-size: 16px; color: var(--muted); padding: 0 4px; line-height: 1; }
  .v18-card .dot { width: 8px; height: 8px; border-radius: 50%; background: #c9c4bb; }
  .v18-card .dot.warn { background: #d89a12; }
  .v18-card .dot.ng { background: var(--error); }
  .v18-card .sub { font-size: 11.5px; color: var(--muted); line-height: 1.6; }
  .v18-card .go { margin-top: 4px; border: 0; background: var(--accent); color: #fff; font-weight: 700; border-radius: 8px; padding: 8px 0; font-size: 12.5px; }
  .v18-card.ng .go { background: #fff; color: var(--error); border: 1px solid #e3a3a3; }
  .v18-nag { margin-top: 10px; display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: #87590a; background: #fbf0d9; border-radius: 8px; padding: 6px 10px; }
  .v18-nag .v18-ic { color: #c08510; }
  .v18-nag u { margin-left: auto; color: var(--accent); font-weight: 700; text-underline-offset: 2px; }
  .modal .v18-points { margin: 0 0 14px; padding: 10px 14px 10px 30px; background: var(--accent-soft); border-radius: 10px; line-height: 1.9; font-size: 13.5px; }
  .modal .v18-small { font-size: 12px; color: var(--muted); line-height: 1.7; margin: 0; }
  .v18-two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 6px 0 4px; }
  .v18-two > div { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; display: grid; gap: 2px; font-size: 12.5px; color: var(--muted); }
  .v18-two > div b { color: var(--ink); font-size: 13.5px; display: flex; align-items: center; gap: 6px; }
  .v18-two > div.new { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent-soft); }
  .v18-two em { font-style: normal; font-size: 10.5px; color: #fff; background: var(--accent); border-radius: 999px; padding: 1px 7px; }
  .v18-or { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); display: grid; gap: 8px; }
  .v18-or span { font-size: 12.5px; color: var(--muted); }
  .v18-or button { padding: 11px 14px !important; border-radius: 10px !important; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid #b9c1dd !important; background: #fff !important; color: var(--accent) !important; font-weight: 700; }
  .v18-or .v18-ic { width: 18px; height: 18px; }
  .p-top .chip.ok .v18-ic { width: 14px; height: 14px; }
`

// ---- 右の欄（PC） ----
const PC = {
  // 案1：保存の表示を1つにまとめる。つないでいないときは「ドライブにつなぐ」ボタン
  'a-off': (H) => {
    document.querySelector('.side-head .meta').firstElementChild.outerHTML = H.chip.off
    document.querySelector('.side-head .links').insertAdjacentHTML('afterbegin', `<button class="link-btn v18-drive">${H.cloud}ドライブにつなぐ</button>`)
  },
  'a-on': (H) => {
    document.querySelector('.side-head .meta').firstElementChild.outerHTML = H.chip.saved
    const head = document.querySelector('.side-head')
    head.style.position = 'relative'
    head.insertAdjacentHTML('beforeend', `<div class="v18-pop">${H.menu}</div>`)
    const chip = head.querySelector('.v18-click')
    head.querySelector('.v18-pop').style.top = `${chip.offsetTop + chip.offsetHeight + 6}px`
  },
  // 案2：ドライブの欄を置く
  'b-off': (H) => {
    document.querySelector('.side-head .meta').firstElementChild.outerHTML = '<span class="chip"><i class="dot"></i>自動保存 13:44</span>'
    document.querySelector('.side-head .meta').insertAdjacentHTML('afterend', H.card.off)
  },
  'b-on': (H) => {
    document.querySelector('.side-head .meta').firstElementChild.outerHTML = '<span class="chip"><i class="dot"></i>自動保存 13:44</span>'
    document.querySelector('.side-head .meta').insertAdjacentHTML('afterend', H.card.saved)
    const card = document.querySelector('.v18-card')
    card.insertAdjacentHTML('beforeend', `<div class="v18-pop" style="left:-4px;right:-4px;top:calc(100% + 6px)">${H.menu}</div>`)
  },
  // 案3：はじめて開いたときに一度だけ聞く。「あとで」のあとは、つながっていないことを細く出す
  'c-ask': (H) => {
    document.querySelector('.side-head .meta').firstElementChild.outerHTML = H.chip.off
    const back = document.createElement('div')
    back.className = 'modal-backdrop'
    back.innerHTML = `<div class="modal"><header><h2>原稿を Google ドライブにも保存しましょう</h2><button class="close">×</button></header>
      <p class="lead">大学のアカウントでつなぐと、書くたびに原稿があなたのドライブにも自動で保存されます。</p>
      <ul class="v18-points"><li>スマホや別のパソコンでも、続きを書けます</li><li>このパソコンが壊れても、原稿は消えません</li></ul>
      <p class="v18-small">このツールが見られるのは、このツールで作ったファイルだけです。学科や先生が、あなたのドライブを見ることはありません。</p>
      <div class="row-buttons"><span class="spacer"></span><button>あとで</button><button class="primary">大学のアカウントでつなぐ（おすすめ）</button></div></div>`
    document.body.append(back)
  },
  'c-later': (H) => {
    document.querySelector('.side-head .meta').firstElementChild.outerHTML = H.chip.off
    document.querySelector('.side-head .meta').insertAdjacentHTML('afterend', `<div class="v18-nag">${H.cloud}ドライブにつながっていません<u>つなぐ</u></div>`)
  },
}

// ---- 共通の窓 ----
const COMMON = {
  conflict: (H) => {
    const back = document.createElement('div')
    back.className = 'modal-backdrop'
    back.innerHTML = `<div class="modal wide"><header><h2>別の端末で書いた、新しい原稿がドライブにあります</h2></header>
      <p class="lead">どちらの原稿で続けますか？　選ばなかった方は「自動の控え」に残るので、あとで戻せます。</p>
      <div class="v18-two">
        <div class="new"><b>${H.cloudOk}ドライブの原稿 <em>新しい</em></b><span>今日 21:10 に保存（iPhone）</span><span>本文 3,200字・図 8枚・7ページ</span></div>
        <div><b>この端末の原稿</b><span>今日 18:20 に保存（このパソコン）</span><span>本文 3,050字・図 7枚・7ページ</span></div>
      </div>
      <div class="row-buttons"><span class="spacer"></span><button>この端末の原稿のまま</button><button class="primary">ドライブの原稿を開く</button></div></div>`
    document.body.append(back)
  },
  wipe: () => {
    const back = document.createElement('div')
    back.className = 'modal-backdrop'
    back.innerHTML = `<div class="modal"><header><h2>この端末から原稿を消しますか？</h2><button class="close">×</button></header>
      <p class="lead">原稿はドライブに保存されています（今日 13:44）。大学のパソコン室など、共用のパソコンで書き終えたときに使います。</p>
      <p class="v18-small">消したあとは、このブラウザに原稿は残りません。次に書くときは、ツールを開いて「ドライブから続きを開く」を押します。</p>
      <div class="row-buttons"><span class="spacer"></span><button>やめる</button><button class="primary">この端末から消す（ドライブの原稿は残ります）</button></div></div>`
    document.body.append(back)
  },
}

// ---- スマホ（上の帯と、メニューの中） ----
const PHONE = {
  a: (H) => {
    document.querySelector('.p-top .chip').outerHTML = `<span class="chip ok">${H.cloudOk}13:44</span>`
    document.querySelector('.sheet .meta').firstElementChild.outerHTML = H.chip.saved.replace('<span class="caret">▾</span>', '')
    document.querySelector('.sheet .meta').insertAdjacentHTML('afterend', `<div class="v18-pop inline">${H.menu}</div>`)
  },
  b: (H) => {
    document.querySelector('.p-top .chip').outerHTML = `<span class="chip ok">${H.cloudOk}13:44</span>`
    document.querySelector('.sheet .meta').firstElementChild.outerHTML = '<span class="chip"><i class="dot"></i>自動保存 13:44</span>'
    document.querySelector('.sheet .meta').insertAdjacentHTML('afterend', H.card.saved)
  },
  c: () => {
    document.querySelector('.p-top .chip').outerHTML = `<span class="chip warn"><i class="dot warn"></i>この端末だけ</span>`
    document.querySelector('.scrim')?.remove()
    document.querySelector('.sheet')?.remove()
    const back = document.createElement('div')
    back.className = 'modal-backdrop'
    back.innerHTML = `<div class="modal"><header><h2>原稿をドライブにも保存しましょう</h2></header>
      <p class="lead">大学のアカウントでつなぐと、原稿があなたのドライブにも自動で保存されます。</p>
      <ul class="v18-points"><li>パソコンなど別の端末でも続きを書けます</li><li>スマホをなくしても、原稿は消えません</li></ul>
      <p class="v18-small">このツールが見られるのは、このツールで作ったファイルだけです。</p>
      <div class="row-buttons" style="flex-direction:column;align-items:stretch"><button class="primary">大学のアカウントでつなぐ（おすすめ）</button><button>あとで</button></div></div>`
    document.body.append(back)
  },
}

const ready = (page, phone) =>
  page.waitForFunction(
    (phone) => {
      const s = window.__editor?.getSnapshot()
      return s?.layout && (!phone || s.sheet) && !s.rendering && !s.turning && !document.querySelector('.loading')
    },
    { timeout: 120000 },
    phone,
  )

async function open(browser, { phone = false, guide = false } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  if (phone) await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  else await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1.5 })
  await stubConfig(page)
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle0', timeout: 90000 })
  await ready(page, phone)
  await page.addStyleTag({ content: guide ? CSS.replace('.guide { display: none !important; }', '') : CSS })
  if (!guide) {
    await page.evaluate(() => window.__editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, studentId: '23FA0123', name: '文化　花子', subtitleInput: 'シンドバッド' } })))
    await sleep(400)
    await ready(page, phone)
  }
  return { context, page }
}

await withEdge(async (browser) => {
  // 右の欄（PC）
  for (const [key, inject] of Object.entries(PC)) {
    const { context, page } = await open(browser)
    await page.evaluate(inject, H)
    await sleep(300)
    await page.screenshot({ path: `${OUT}/${key}.png` })
    // 右の欄だけ（大きく見せる用）
    await (await page.$('.side')).screenshot({ path: `${OUT}/${key}-side.png` })
    console.log(`${OUT}/${key}.png`)
    await context.close()
  }

  // 保存のようす（4つの状態）：右の欄の上の部分だけ
  {
    const { context, page } = await open(browser)
    for (const state of ['saving', 'saved', 'offline', 'expired']) {
      for (const kind of ['chip', 'card']) {
        await page.evaluate(
          (H, state, kind) => {
            document.querySelectorAll('.v18-card').forEach((e) => e.remove())
            const meta = document.querySelector('.side-head .meta')
            if (kind === 'chip') meta.firstElementChild.outerHTML = H.chip[state]
            else {
              meta.firstElementChild.outerHTML = '<span class="chip"><i class="dot"></i>自動保存 13:44</span>'
              meta.insertAdjacentHTML('afterend', H.card[state])
            }
          },
          H,
          state,
          kind,
        )
        await sleep(150)
        const el = await page.$('.side-head')
        await el.screenshot({ path: `${OUT}/state-${kind}-${state}.png` })
        console.log(`${OUT}/state-${kind}-${state}.png`)
      }
    }
    await context.close()
  }

  // 共通の窓
  for (const [key, inject] of Object.entries(COMMON)) {
    const { context, page } = await open(browser)
    await page.evaluate(inject, H)
    await sleep(300)
    await page.screenshot({ path: `${OUT}/common-${key}.png` })
    console.log(`${OUT}/common-${key}.png`)
    await context.close()
  }

  // 新しい端末で開いたとき：はじめの案内（コースを選ぶ）に「ドライブから続きを開く」
  {
    const { context, page } = await open(browser, { guide: true })
    await page.waitForSelector('.g-tip .g-opts button', { timeout: 60000 })
    await page.evaluate((H) => {
      document.querySelector('.g-tip').insertAdjacentHTML('beforeend', `<div class="v18-or"><span>前に、別の端末やブラウザで書き始めた人は</span><button>${H.cloud}ドライブから続きを開く</button></div>`)
    }, H)
    await sleep(500)
    await page.screenshot({ path: `${OUT}/common-start.png` })
    console.log(`${OUT}/common-start.png`)
    await context.close()
  }

  // スマホ
  for (const [key, inject] of Object.entries(PHONE)) {
    const { context, page } = await open(browser, { phone: true })
    await page.click('.p-top .icon-btn')
    await page.waitForSelector('.sheet .meta')
    await page.evaluate(inject, H)
    await sleep(400)
    await page.screenshot({ path: `${OUT}/phone-${key}.png` })
    console.log(`${OUT}/phone-${key}.png`)
    await context.close()
  }

  // 一覧のページ
  const page = await browser.newPage()
  await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 1 })
  await page.goto('http://localhost:5173/mockups/v18/drive.html', { waitUntil: 'networkidle0' })
  await page.screenshot({ path: `${OUT}/drive.png`, fullPage: true })
  console.log(`${OUT}/drive.png`)
})
