// デザイン案 v35（管理ページ）を画像に書き出す。
// 本物の管理ページ（開発サーバーの /admin.html。ブラウザの中だけで動く試験用サーバー）を開き、
// 見出し・窓・知らせなどを、案ごとに書き換えて写す（src/ は変えない）。
// 試験用サーバーの中身（localStorage）は、撮影用の Edge の中だけで作り直す（ふだん使うブラウザの中身は変わらない）。
// ブラウザの確かめの窓（confirm）と、ボタンに重ねたときの小さな説明（title）は、撮影用の Edge では写せないため、似せて描いたもの。
// できるもの：mockups/v35-admin/shots/*.png（案の画面）と、一覧のページ mockups/v35-admin/review.html の話題ごとの写し（shots/review-header.png など）
// 使い方: node scripts/mockup-shots-v35-admin.mjs [header] [delete] [notice] [template] [review]（何も付けなければ全部。開発サーバーが http://localhost:5173 で動いていること）
//   header  ：1. 上の見出しが狭い画面で切れる。1280×720（準備中の年度・保存していない変更あり）と 1440×900。いま・案A（2段）・案B（まとめる）・案C（短い名前）。案A は先生の画面も
//   delete  ：2. 準備中の年度を消すボタン。案A（見出しの「変更履歴」のとなり）・案B（変更履歴の窓のいちばん下）・案C（年度を選ぶ欄のとなり）と、確かめの窓・消したあと
//   notice  ：3. 新年度を作ったあとの知らせ。いま・案A（箇条書き）・案B（チェックを付けられる一覧）
//   template：4. ひな形の窓で「反映する」を押せない理由。いま・案A（ボタンのとなりに理由）・案B（押すと、直す行へ動いて赤くする）・案C（ボタンに数、押すと一覧）
//   review  ：一覧のページを、話題ごとに画像にする
//   Edge は EDGE_PORT（ふだんは 9722）で起動する
import { mkdirSync } from 'node:fs'

process.env.EDGE_PORT ??= '9722'
const { withEdge } = await import('./poc/edge.mjs')

const APP = process.env.APP_URL ?? 'http://localhost:5173'
const DIR = 'mockups/v35-admin'
const OUT = `${DIR}/shots`
mkdirSync(OUT, { recursive: true })
const ONLY = process.argv.slice(2)
const want = (k) => ONLY.length === 0 || ONLY.includes(k)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** ノートパソコンの小さめの画面と、ふつうの画面 */
const PC = { width: 1280, height: 720, deviceScaleFactor: 1.5 }
const WIDE = { width: 1440, height: 900, deviceScaleFactor: 1.5 }

/** 見本のコースのお知らせ（新年度の知らせに「お知らせ」の項目が出るように、2026年度に入れておく。文は管理ページの入力欄の例と同じ） */
const NOTICE = '12月4日（金）の中間発表では、本文の下書きを印刷して持ってきてください'
/** 保存していない変更：最終締切を、2027年度の中の日付に直したところ */
const NEW_DEADLINE = '2028-01-19'
/** ひな形の窓で長すぎる説明（300字まで）。先生が、くわしい説明を貼り付けたところ（400字にそろえる） */
const LONG_HINT = (
  '担当したキャラクターの性格や、物語の中での役割を書く。キャラクターの年齢・身分・職業、ほかの登場人物との関係、物語のどの場面で登場するかを、' +
  '台本や演出の打ち合わせのメモをもとに、具体的に書く。衣装を考えるときに、どの性格や場面を大事にしたかがわかるように、例を挙げて説明する。' +
  '舞台の照明や背景の色、ほかの役の衣装との違いをどう考えたかも書くとよい。参考にした映画・絵画・資料があれば、題名と作者を書き、参考文献の欄にも入れる。' +
  '文の長さは200字から400字ほどを目安にし、箇条書きにはせず、「である」調で書く。読む人が、写真を見なくても衣装の姿を思い浮かべられるように、' +
  '色・形・素材の手ざわりを、できるだけ言葉にしてみる。完成した姿だけでなく、最初に考えた案から何をどう変えたかにもふれると、考えた筋道が伝わる。' +
  '指導教員と相談して決めたことや、ほかの学生と分担したことがあれば、それも分けて書いておく。'
).slice(0, 400)

// ---- アイコン（src/app/icons.tsx と同じ線） ----
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
const IC = {
  /** 削除（ごみ箱。icons.tsx の remove） */
  remove: svg('<path d="M5 7h14M10 7V5.5h4V7M7 7l.9 12h8.2L17 7"/>'),
  /** 注意（icons.tsx の warn） */
  warn: svg('<path d="M12 4l9 16H3zM12 10v4.5M12 17.2v.1"/>'),
  /** チェック（icons.tsx の check） */
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  /** ログインしている人（案B の見出し。新しく描いたもの） */
  person: svg('<circle cx="12" cy="8.6" r="3.6"/><path d="M4.8 19.5a7.2 7.2 0 0114.4 0"/>'),
  /** 下向きの小さな三角（メニューが開く印） */
  caret: svg('<path d="M8 10.5l4 4 4-4"/>'),
  /** その他（横に3つの点） */
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/><circle cx="18" cy="12" r="1.7" fill="currentColor"/></svg>',
}
/** マウスの矢印（説明用の印） */
const CURSOR = '<path d="M3 2l15 8.2-6.6 1.6L8.6 18z" fill="#fff" stroke="#23262b" stroke-width="1.4" stroke-linejoin="round"/>'

/** 準備中の年度を削除するときの確かめ（案の文） */
const CONFIRM_DELETE =
  '2027年度（準備中）を削除しますか？\n\n' +
  '・この年度の設定（共通の題目・締切・コース・ひな形・お知らせなど）が、すべて消えます。元には戻せません。\n' +
  '・まだ学生に公開していないので、学生のツールは変わりません。\n' +
  '・削除したあとは、2026年度（公開中）を開きます。'

/** 案の部品の見た目。色と書体は src/admin/admin.css のもの */
const CSS = `
  .v35-x { font-family: 'BIZ UDPGothic', sans-serif; box-sizing: border-box; }
  .v35-fixed { position: fixed; z-index: 60; }
  [data-v35-hidden] { display: none !important; }
  .v35-cursor { width: 22px; height: 22px; z-index: 120; pointer-events: none; }

  /* ---- 1. 見出し ---- */
  /* 案A：2段。上の段は年度と保存・公開、下の段（細く、薄い灰色）はログイン中の人と、ときどき使うリンク */
  .admin.v35-two { grid-template-rows: auto 1fr; }
  .admin-header.v35-hA { display: block; padding: 0; }
  .v35-hA .v35-row { display: flex; align-items: center; gap: 10px; padding: 0 18px; white-space: nowrap; }
  .v35-hA .v35-row:first-child { height: 52px; }
  .v35-hA .v35-row + .v35-row { height: 32px; gap: 12px; background: #f6f7f9; border-top: 1px solid var(--line); }
  .v35-hA .v35-row + .v35-row .link { padding: 0; font-size: 12.5px; }
  .v35-who { font-size: 12px; color: var(--muted); margin-right: -6px; }
  .v35-sep { width: 1px; height: 14px; background: #cfd4dc; }
  /* 案B：1段のまま。ログイン中の人は丸いボタン、ときどき使うものは「…」の中 */
  .v35-acct { display: inline-flex; align-items: center; gap: 1px; height: 32px; padding: 0 4px 0 6px; border: 1px solid var(--line); border-radius: 999px; background: #fff; color: var(--muted); }
  .v35-acct svg { width: 20px; height: 20px; }
  .v35-acct svg + svg { width: 14px; height: 14px; }
  .v35-acct.on, .v35-more.on { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
  .btn.v35-more { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 32px; padding: 0; color: var(--ink); }
  .btn.v35-more svg { width: 20px; height: 20px; }
  .v35-menu { min-width: 200px; padding: 6px; border: 1px solid var(--line); border-radius: 10px; background: #fff; box-shadow: 0 10px 28px rgba(20, 22, 30, 0.18); font-size: 13px; color: var(--ink); }
  .v35-menu button { display: block; width: 100%; padding: 8px 12px; border: 0; border-radius: 6px; background: none; color: var(--ink); text-align: left; font-size: 13px; }
  .v35-menu button.hover { background: var(--accent-soft); color: var(--accent); }
  .v35-menu hr { margin: 5px 4px; border: 0; border-top: 1px solid var(--line); }
  .v35-menu small { display: block; margin-top: 1px; color: var(--muted); font-size: 11px; }
  .v35-acctpop { width: 310px; padding: 12px 14px; line-height: 1.6; word-break: auto-phrase; }
  .v35-acctpop .l { font-size: 11.5px; color: var(--muted); }
  .v35-acctpop .m { font-size: 14px; font-weight: 700; }
  .v35-acctpop .t { display: flex; gap: 8px; align-items: flex-start; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line); font-size: 12px; color: var(--muted); }
  .v35-acctpop .t .badge { flex: none; margin-top: 1px; }
  /* 案C：短い名前と、小さな印 */
  .admin-header.v35-hC { gap: 8px; }
  .admin-header .badge.v35-sm { padding: 2px 7px; font-size: 10px; }

  /* ---- 2. 準備中の年度を消す ---- */
  .admin-header .link.v35-del { display: inline-flex; align-items: center; gap: 3px; color: var(--error); }
  .v35-del svg { width: 15px; height: 15px; }
  .v35-ydel { display: inline-flex; align-items: center; gap: 4px; padding: 4px 9px 4px 7px; border: 1px solid #f0c9c9; border-radius: 7px; background: #fff; color: var(--error); font-size: 12px; }
  .v35-ydel svg { width: 15px; height: 15px; }
  .modal .v35-delsec { margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--line); }
  .modal .v35-delsec .t { font-size: 13px; font-weight: 700; margin-bottom: 6px; }
  .modal .v35-delsec .r { display: flex; align-items: center; gap: 12px; }
  .modal .v35-delsec p { flex: 1; margin: 0; word-break: auto-phrase; font-size: 12.5px; line-height: 1.7; color: var(--muted); }
  .modal .v35-delsec button { flex: none; display: inline-flex; align-items: center; gap: 4px; border-color: #f0c9c9; color: var(--error); }
  .modal .v35-delsec button svg { width: 16px; height: 16px; }
  /* ブラウザの確かめの窓（confirm）に似せたもの（撮影用の Edge では本物を写せないため） */
  .v35-native { z-index: 100; top: 12px; left: 50%; transform: translateX(-50%); width: 470px; padding: 20px 24px 18px; border-radius: 8px; background: #fff; box-shadow: 0 10px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(0, 0, 0, 0.08); font-family: 'Yu Gothic UI', 'Segoe UI', sans-serif; color: #1b1b1b; }
  .v35-native .h { margin-bottom: 12px; font-size: 15px; font-weight: 600; }
  .v35-native p { margin: 0 0 22px; font-size: 13.5px; line-height: 1.65; white-space: pre-line; }
  .v35-native .b { display: flex; justify-content: flex-end; gap: 8px; }
  .v35-native button { min-width: 84px; height: 32px; padding: 0 14px; border: 1px solid #c4c4c4; border-radius: 4px; background: #fff; color: #1b1b1b; font: inherit; font-size: 13px; }
  .v35-native button.ok { border-color: #0f6cbd; background: #0f6cbd; color: #fff; }

  /* ---- 3. 新年度を作ったあとの知らせ ---- */
  .message.v35-list, .message.v35-check { padding: 10px 14px 12px; line-height: 1.65; word-break: auto-phrase; }
  .message.v35-x { word-break: auto-phrase; }
  .v35-list .h, .v35-check .h { font-weight: 700; }
  .v35-list p, .v35-check p { margin: 2px 0 0; }
  .v35-list ul { margin: 6px 0 0; padding: 0 0 0 1.3em; color: var(--ink); }
  .v35-list li { margin: 6px 0 0; }
  .v35-list li::marker { color: var(--ok); }
  .v35-list small, .v35-check small { display: block; color: #5f7d6a; font-size: 11.5px; line-height: 1.55; }
  .v35-check ul { margin: 8px 0 0; padding: 0; list-style: none; color: var(--ink); }
  .v35-check li { display: flex; gap: 9px; align-items: flex-start; margin: 0; padding: 6px 4px; border-top: 1px solid #cfe5d7; }
  .v35-check .box { flex: none; display: grid; place-items: center; width: 18px; height: 18px; margin-top: 1px; border: 1.5px solid #8fb79d; border-radius: 4px; background: #fff; color: #fff; }
  .v35-check .box svg { width: 14px; height: 14px; stroke-width: 2.4; }
  .v35-check li.done .box { border-color: var(--ok); background: var(--ok); }
  .v35-check li.done .tx { color: #7c8a82; text-decoration: line-through; text-decoration-color: #9db3a5; }
  .v35-check li.done small { text-decoration: none; }
  .v35-check .cnt { display: inline-block; margin-left: 6px; padding: 0 8px; border-radius: 999px; background: #fff; font-size: 11.5px; font-weight: 700; }
  .v35-check .ft { margin-top: 4px; padding-top: 6px; border-top: 1px solid #cfe5d7; font-size: 11.5px; color: #5f7d6a; }

  /* ---- 4. ひな形の窓 ---- */
  /* いま：ボタンに重ねたときの小さな説明（title）に似せたもの */
  .v35-tooltip { z-index: 110; max-width: 520px; padding: 6px 9px; border: 1px solid #c8c8c8; border-radius: 4px; background: #fff; box-shadow: 0 3px 10px rgba(0, 0, 0, 0.16); font-family: 'Yu Gothic UI', 'Segoe UI', sans-serif; font-size: 12px; line-height: 1.55; color: #1b1b1b; white-space: pre-line; }
  /* 案A：「反映する」のとなりの理由 */
  .v35-why { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--error); white-space: nowrap; }
  .v35-why svg { width: 17px; height: 17px; flex: none; }
  .v35-why .more { margin-left: 2px; padding: 1px 8px; border: 1px solid #f0c9c9; border-radius: 999px; background: #fff; color: var(--error); font-size: 12px; text-decoration: none; }
  /* 案B：押すと、直す行へ動いて赤くする */
  .tpl-modal .row.v35-bad { border-color: var(--error); background: #fff7f7; box-shadow: 0 0 0 2px #f8d4d4; }
  .tpl-modal .v35-rowmsg { display: flex; align-items: center; gap: 5px; margin: -1px 0 3px 44px; font-size: 12px; color: var(--error); }
  .tpl-modal .v35-rowmsg.sub { margin-left: 22px; }
  .tpl-modal .v35-rowmsg svg { width: 15px; height: 15px; flex: none; }
  .v35-flash { font-size: 12.5px; color: var(--error); font-weight: 700; }
  /* 案C：ボタンに数、押すと一覧 */
  .v35-count { z-index: 70; display: grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; border: 2px solid #fff; border-radius: 999px; background: var(--error); color: #fff; font-size: 11.5px; font-weight: 700; }
  .v35-pop { z-index: 70; width: 480px; word-break: auto-phrase; padding: 12px 14px 10px; border: 1px solid #f0c9c9; border-radius: 10px; background: #fff; box-shadow: 0 10px 28px rgba(20, 22, 30, 0.2); font-size: 13px; color: var(--ink); }
  .v35-pop::after { content: ''; position: absolute; bottom: -7px; right: var(--ax, 40px); width: 12px; height: 12px; background: #fff; border-right: 1px solid #f0c9c9; border-bottom: 1px solid #f0c9c9; transform: rotate(45deg); }
  .v35-pop .h { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; font-weight: 700; color: var(--error); }
  .v35-pop .h svg { width: 17px; height: 17px; }
  .v35-pop ul { margin: 0; padding: 0; list-style: none; }
  .v35-pop li { padding: 6px 2px; border-top: 1px solid #f3e3e3; line-height: 1.55; }
  .v35-pop li a { color: var(--ink); text-decoration: underline; text-decoration-color: #d9a3a3; text-underline-offset: 3px; }
  .v35-pop .f { margin-top: 2px; font-size: 11.5px; color: var(--muted); }
`

/** ページの中で使う道具（部品を足す・隠す・見出しを組み替える・元に戻す） */
async function installKit(page) {
  await page.evaluate((css) => {
    if (document.getElementById('v35-style')) return
    const style = document.createElement('style')
    style.id = 'v35-style'
    style.textContent = css
    document.head.append(style)
    window.__v35 = {
      /** 部品を足す（body の直下） */
      add(html) {
        document.body.insertAdjacentHTML('beforeend', html)
        return document.body.lastElementChild
      },
      /** 本物の部品を隠して、すぐ後ろに案の部品を置く */
      swap(el, html) {
        el.setAttribute('data-v35-hidden', '')
        el.insertAdjacentHTML('afterend', html)
        return el.nextElementSibling
      },
      /** 本物の部品のすぐ後ろ（before：前）に、案の部品を足す */
      after(el, html, before = false) {
        el.insertAdjacentHTML(before ? 'beforebegin' : 'afterend', html)
        return before ? el.previousElementSibling : el.nextElementSibling
      },
      /** 本物の見出し（隠したあとも、こちらを指す） */
      realHeader: () => document.querySelector('.admin-header:not(.v35-x)'),
      /** 見出しの本物の部品の複製（名前で選ぶ） */
      part(key) {
        const H = this.realHeader()
        const btn = (t) => [...H.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(t))
        const el = {
          title: H.querySelector(':scope > b'),
          help: H.querySelector('.help-open'),
          year: H.querySelector('.sel'),
          state: H.querySelector('.badge'),
          dirty: H.querySelector('.badge.warn'),
          mock: [...H.querySelectorAll('.badge')].find((b) => b.textContent.includes('試験用')),
          user: H.querySelector('.user'),
          history: btn('変更履歴'),
          members: btn('先生の登録'),
          newyear: btn('新年度を作成'),
          save: [...H.querySelectorAll('.btn')].find((b) => b.textContent.trim().startsWith('保存')),
          publish: btn('この年度を学生に公開'),
        }[key]
        if (!el) return null
        const c = el.cloneNode(true)
        if (key === 'year') c.value = el.value
        return c
      },
      /**
       * 見出しを、案の並びに置き換える。rows：段ごとの部品。
       * '@名前' は本物の部品の複製、{ k: 名前, label: 名前を変える, cls: 足す class, className: class をすべて変える } も同じ。ほかの文字は HTML
       */
      header(rows, cls) {
        const H = this.realHeader()
        H.setAttribute('data-v35-hidden', '')
        const h = document.createElement('header')
        h.className = `admin-header v35-x ${cls}`
        for (const row of rows) {
          let target = h
          if (rows.length > 1) {
            target = document.createElement('div')
            target.className = 'v35-row'
            h.append(target)
          }
          for (const t of row) {
            if (typeof t === 'string' && !t.startsWith('@')) {
              target.insertAdjacentHTML('beforeend', t)
              continue
            }
            const o = typeof t === 'string' ? { k: t.slice(1) } : t
            const c = this.part(o.k)
            if (!c) continue
            if (o.className !== undefined) c.className = o.className
            if (o.cls) c.classList.add(...o.cls.split(' '))
            if (o.label) {
              const icon = c.querySelector('svg')
              c.textContent = ''
              if (icon) c.append(icon)
              c.append(o.label)
            }
            target.append(c)
          }
        }
        if (rows.length > 1) document.querySelector('.admin').classList.add('v35-two')
        H.after(h)
        return h
      },
      /** マウスの矢印を、部品の上（x・y は部品の幅・高さに対する割合）に置く */
      cursor(el, fx = 0.6, fy = 0.55, path) {
        const r = el.getBoundingClientRect()
        this.add(`<svg class="v35-x v35-fixed v35-cursor" style="left:${r.left + r.width * fx}px;top:${r.top + r.height * fy}px" viewBox="0 0 24 24">${path}</svg>`)
      },
      /** ブラウザの確かめの窓に似せたもの */
      native(text) {
        this.add('<div class="v35-x v35-fixed v35-native" role="alertdialog"><div class="h">このページの内容</div><p></p><div class="b"><button class="ok">OK</button><button>キャンセル</button></div></div>').querySelector('p').append(text)
      },
      /** 案の部品を全部外し、隠した本物を戻す */
      clear() {
        document.querySelectorAll('.v35-x').forEach((e) => e.remove())
        document.querySelectorAll('[data-v35-hidden]').forEach((e) => e.removeAttribute('data-v35-hidden'))
        document.querySelectorAll('.v35-two, .v35-bad').forEach((e) => e.classList.remove('v35-two', 'v35-bad'))
      },
    }
  }, CSS)
}

/** 開発サーバーの即時反映をつながない（撮っている途中に src/ が直されても、画面が入れ替わらないように。scripts/e2e/smoke.mjs の noHotReload と同じ） */
const noHotReload = (page) =>
  page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket
    window.WebSocket = function (url, protocols) {
      if (String(protocols).includes('vite-hmr')) return { readyState: 0, addEventListener() {}, removeEventListener() {}, send() {}, close() {} }
      return new Real(url, protocols)
    }
  })

/** 見本（表紙と抄録の iframe）が出るまで待つ */
async function previewReady(page) {
  for (let i = 0; i < 40; i++) {
    const ok = await page.evaluate(() => {
      const d = document.querySelector('.preview iframe')?.contentDocument
      return !document.querySelector('.preview') || (d?.readyState === 'complete' && d.querySelectorAll('.page').length === 2)
    })
    if (ok) break
    await sleep(500)
  }
  await sleep(800)
}

/**
 * 管理ページを開く。試験用サーバーを空にしてから、seed（試験用サーバーに入れる見本）を入れて開き直す。
 * seed.notice：2026年度のコースにお知らせを入れる。seed.year2027：2027年度（準備中）を作って、その年度で開く。
 * seed.deadline：2027年度の最終締切を、年度の中の日付に直して保存しておく（「確認：最終締切が年度の外」の黄色い字を出さない）
 */
async function openAdmin(browser, { vp = PC, notice = true, year2027 = true, deadline = false } = {}) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log('pageerror:', e.message))
  // 本物の確かめの窓が出たら「OK」（年度の切り替えなど。撮るのは似せて描いたもの）
  page.on('dialog', (d) => d.accept())
  await noHotReload(page)
  await page.setViewport(vp)
  await page.goto(`${APP}/admin.html`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => {
    localStorage.removeItem('sotsugyo-admin-mock')
    localStorage.removeItem('sotsugyo-admin-year')
  })
  await page.goto(`${APP}/admin.html`, { waitUntil: 'networkidle0' })
  await page.waitForSelector('.admin .form')
  await page.evaluate(
    async ({ notice, year2027, deadline, NOTICE, NEW_DEADLINE }) => {
      const s = window.__adminServer
      const st = await s.getState()
      const row = st.years.find((y) => y.year === 2026)
      if (notice) {
        const config = JSON.parse(JSON.stringify(row.config))
        config.courses[0].notice = NOTICE
        await s.saveYear(config, row.updatedAt)
      }
      if (year2027) {
        const created = (await s.createYear(2026, 2027)).years.find((y) => y.year === 2027)
        if (deadline) await s.saveYear({ ...created.config, deadline: NEW_DEADLINE }, created.updatedAt)
        localStorage.setItem('sotsugyo-admin-year', '2027')
      } else localStorage.setItem('sotsugyo-admin-year', '2026')
    },
    { notice, year2027, deadline, NOTICE, NEW_DEADLINE },
  )
  await reopen(page)
  return { context, page }
}

/** 開き直す（as：teacher なら先生の画面） */
async function reopen(page, as) {
  await page.goto(`${APP}/admin.html${as ? `?as=${as}` : ''}`, { waitUntil: 'networkidle0' })
  await page.waitForSelector(as === 'teacher' ? '.teacher-main' : '.admin .form')
  await previewReady(page)
  await installKit(page)
  await parkMouse(page)
}

/** 入力欄の文字を変える（React に伝わるように、本物の入力と同じ知らせを出す） */
async function setValue(handle, value) {
  await handle.evaluate((el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
  await sleep(300)
}

/** 保存していない変更を作る（最終締切を直す） */
async function makeDirty(page) {
  const input = await page.evaluateHandle(() => [...document.querySelectorAll('.f')].find((f) => f.querySelector('.l')?.textContent.startsWith('最終締切')).querySelector('input'))
  await setValue(input, NEW_DEADLINE)
  await page.waitForSelector('.badge.warn')
}

/** 画面の外（何もない所）にマウスを置く */
const parkMouse = (page) => page.mouse.move(2, 2)

/** 確かめ：横にはみ出していないか・案の部品が画面の外に出ていないか・文字がボタンや印からはみ出していないか・見出しが1段に入っているか */
const audit = (page, name, wide = true) =>
  page
    .evaluate((wide) => {
      const bad = []
      if (wide && document.documentElement.scrollWidth > innerWidth + 1) bad.push(`横にはみ出している（${document.documentElement.scrollWidth}px）`)
      const h = document.querySelector('.admin-header:not([data-v35-hidden])')
      if (wide && h && h.scrollWidth > h.clientWidth + 1) bad.push(`見出しが入りきらない（${h.scrollWidth}/${h.clientWidth}px）`)
      for (const row of document.querySelectorAll('.v35-row')) if (row.scrollWidth > row.clientWidth + 1) bad.push(`見出しの段が入りきらない（${row.scrollWidth}/${row.clientWidth}px）`)
      for (const el of document.querySelectorAll('.v35-x')) {
        const r = el.getBoundingClientRect()
        if (!r.width) continue
        if (r.right > innerWidth + 1 || r.left < -1 || r.bottom > innerHeight + 1 || r.top < -1) bad.push(`画面の外：${el.className.baseVal ?? el.className}`)
      }
      for (const el of document.querySelectorAll('.admin-header button, .admin-header .badge, .modal button, .v35-x button')) {
        if (el.offsetWidth && el.scrollWidth > el.clientWidth + 1) bad.push(`文字がはみ出す：${el.textContent}`)
      }
      return bad
    }, wide)
    .then((bad) => bad.length && console.log(`  ！${name}：${bad.join(' ／ ')}`))

/** 撮る。clip：写す範囲（画面の座標。関数ならページの中で測る。なければ画面全体） */
async function shot(page, name, clip, { check = true, wide = true } = {}) {
  await page.evaluate(() => document.fonts.ready)
  await sleep(300)
  if (check) await audit(page, name, wide)
  const box = typeof clip === 'function' ? await page.evaluate(clip) : clip
  // captureBeyondViewport: false：写すときに画面の大きさを変えない
  await page.screenshot({ path: `${OUT}/${name}.png`, captureBeyondViewport: false, ...(box ? { clip: box } : {}) })
  console.log('✓', name)
}

/** 写す範囲：見出しと、その下の少し（見本の欄の見出しの行まで。一覧で、見出しの字が読める大きさに出すため） */
const STRIP = () => {
  const h = document.querySelector('.admin-header:not([data-v35-hidden])').getBoundingClientRect()
  return { x: 0, y: 0, width: innerWidth, height: Math.round(h.bottom + 34) }
}
/** 写す範囲：先生の画面の見出しと、その下の見出し（先生の画面には見本の欄がないため、下の見出しの行まで） */
const STRIP_T = () => {
  const h = document.querySelector('.admin-header:not([data-v35-hidden])').getBoundingClientRect()
  return { x: 0, y: 0, width: innerWidth, height: Math.round(h.bottom + 52) }
}
/** 写す範囲：見出しの右の部分と、その下に開いたメニュー */
const HEAD_RIGHT = () => {
  const els = [...document.querySelectorAll('.v35-menu')].map((e) => e.getBoundingClientRect())
  const left = Math.max(0, Math.min(innerWidth - 640, ...els.map((r) => r.left - 24)))
  const bottom = Math.max(...els.map((r) => r.bottom)) + 20
  return { x: left, y: 0, width: innerWidth - left, height: bottom }
}
/** 写す範囲：窓（と、上に重なるブラウザの確かめの窓）のまわり */
const MODAL = () => {
  const els = [...document.querySelectorAll('.modal, .v35-native')].map((e) => e.getBoundingClientRect())
  const left = Math.max(0, Math.min(...els.map((r) => r.left)) - 28)
  const top = Math.max(0, Math.min(...els.map((r) => r.top)) - 12)
  const right = Math.min(innerWidth, Math.max(...els.map((r) => r.right)) + 28)
  const bottom = Math.min(innerHeight, Math.max(...els.map((r) => r.bottom)) + 18)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

// ---- 1. 見出しの並び（2. でも、案A の並びを使う） ----
const SPACER = '<span class="spacer"></span>'
const SEP = '<span class="v35-sep"></span>'
/** 案A：上の段（年度・状態の印・保存・公開）と、下の段（ログイン中の人・試験用サーバー・ときどき使うリンク）。extra：2. の案の部品を足す所 */
const rowsA = ({ del = '', ydel = '' } = {}) => [
  ['@title', '@help', '@year', '@state', ydel, '@dirty', SPACER, '@save', '@publish'],
  ['<span class="v35-who">ログイン中：</span>', '@user', '@mock', SPACER, '@history', del, SEP, '@members', SEP, { k: 'newyear', className: 'link' }],
]
const headerA = (page, extra) => page.evaluate((rows) => window.__v35.header(rows, 'v35-hA') && null, rowsA(extra))
/** 案B：1段のまま。メールアドレスと試験用サーバーは丸いボタンの中、変更履歴・先生の登録・新年度を作成は「…」の中 */
const headerB = (page) =>
  page.evaluate(
    (rows) => window.__v35.header(rows, 'v35-hB') && null,
    [['@title', '@help', '@year', '@state', '@dirty', SPACER, `<button class="v35-acct" aria-label="ログイン中の人">${IC.person}${IC.caret}</button>`, `<button class="btn v35-more" aria-label="その他">${IC.more}</button>`, '@save', '@publish']],
  )
/** 案C：名前を短く、印を小さく */
const headerC = (page) =>
  page.evaluate(
    (rows) => window.__v35.header(rows, 'v35-hC') && null,
    [
      [
        '@title',
        '@help',
        '@year',
        { k: 'state', cls: 'v35-sm' },
        { k: 'dirty', label: '未保存の変更あり', cls: 'v35-sm' },
        { k: 'mock', label: '試験用', cls: 'v35-sm' },
        SPACER,
        '@user',
        { k: 'history', label: '履歴' },
        { k: 'members', label: '先生' },
        { k: 'newyear', label: '新年度' },
        '@save',
        { k: 'publish', label: '学生に公開' },
      ],
    ],
  )
const clear = (page) => page.evaluate(() => window.__v35.clear())

// =====================================================================
// 1. 上の見出しが狭い画面で切れる
// =====================================================================
async function headerShots(browser) {
  const { context, page } = await openAdmin(browser, { vp: PC })
  await makeDirty(page)
  // ---- いま ----
  await shot(page, 'h-now-1280-full', null, { check: false })
  await shot(page, 'h-now-1280', STRIP, { check: false })
  // ---- 案A・案B・案C（1280×720） ----
  await headerA(page)
  await shot(page, 'h-a-1280', STRIP)
  await shot(page, 'h-a-1280-full')
  await clear(page)
  await headerB(page)
  await shot(page, 'h-b-1280', STRIP)
  // 案B：「…」を押したところ
  await page.evaluate((cursor) => {
    const k = window.__v35
    const b = document.querySelector('.v35-more')
    b.classList.add('on')
    const r = b.getBoundingClientRect()
    const m = k.add('<div class="v35-x v35-fixed v35-menu" role="menu"><button>変更履歴</button><button class="hover">先生の登録</button><hr><button>新年度を作成</button></div>')
    m.style.top = `${r.bottom + 6}px`
    m.style.left = `${r.right - m.offsetWidth}px`
    k.cursor(m.querySelector('.hover'), 0.45, 0.5, cursor)
  }, CURSOR)
  await shot(page, 'h-b-more', HEAD_RIGHT)
  await page.evaluate(() => {
    document.querySelectorAll('.v35-menu, .v35-cursor').forEach((e) => e.remove())
    document.querySelector('.v35-more').classList.remove('on')
  })
  // 案B：丸いボタンを押したところ（ログイン中の人と、試験用サーバーの印）
  await page.evaluate(
    (cursor, user) => {
      const k = window.__v35
      const b = document.querySelector('.v35-acct')
      b.classList.add('on')
      const r = b.getBoundingClientRect()
      const m = k.add(
        `<div class="v35-x v35-fixed v35-menu v35-acctpop"><div class="l">ログイン中</div><div class="m">${user}</div><div class="t"><span class="badge old">試験用サーバー</span><span>このブラウザの中だけで動く、試しの保存先です。学生には届きません。</span></div></div>`,
      )
      m.style.top = `${r.bottom + 6}px`
      m.style.left = `${Math.min(innerWidth - 12 - m.offsetWidth, r.left + r.width / 2 - m.offsetWidth / 2)}px`
      k.cursor(b, 0.5, 0.6, cursor)
    },
    CURSOR,
    await page.evaluate(() => document.querySelector('.user').textContent),
  )
  await shot(page, 'h-b-acct', HEAD_RIGHT)
  await clear(page)
  await headerC(page)
  await shot(page, 'h-c-1280', STRIP)
  await clear(page)

  // ---- 1440×900 ----
  await page.setViewport(WIDE)
  await sleep(600)
  await parkMouse(page)
  await shot(page, 'h-now-1440', STRIP, { check: false })
  for (const [k, fn] of [
    ['a', headerA],
    ['b', headerB],
    ['c', headerC],
  ]) {
    await fn(page)
    await shot(page, `h-${k}-1440`, STRIP)
    await clear(page)
  }

  // ---- 先生の画面（案A。1280×720・準備中の年度・保存していない変更あり） ----
  await page.setViewport(PC)
  await reopen(page, 'teacher')
  const notice = await page.$('.teacher-main .notice-field textarea')
  await setValue(notice, '1月の講評会の日程は、追って知らせます')
  await page.waitForSelector('.badge.warn')
  await shot(page, 'h-teacher-now', STRIP_T, { check: false })
  await page.evaluate(
    (rows) => window.__v35.header(rows, 'v35-hA') && null,
    [
      ['@title', '@help', '@year', '@state', '@dirty', SPACER, '@save'],
      ['<span class="v35-who">ログイン中：</span>', '@user', '@mock'],
    ],
  )
  await shot(page, 'h-teacher-a', STRIP_T)
  await context.close()
}

// =====================================================================
// 2. 準備中の年度を消すボタン（見出しは 1. の案A の並び）
// =====================================================================
async function deleteShots(browser) {
  const { context, page } = await openAdmin(browser, { vp: PC, deadline: true })
  // ---- 案A：下の段の「変更履歴」のとなりに、赤い字の「この年度を削除」 ----
  await headerA(page, { del: `<button class="link v35-del">${IC.remove}この年度を削除</button>` })
  await shot(page, 'd-a', STRIP)
  // 確かめの窓（どの案でも同じ文）
  await page.evaluate((cursor) => window.__v35.cursor(document.querySelector('.v35-del'), 0.5, 0.55, cursor), CURSOR)
  await page.evaluate((t) => window.__v35.native(t), CONFIRM_DELETE)
  await shot(page, 'd-confirm', () => {
    const r = document.querySelector('.v35-native').getBoundingClientRect()
    return { x: 0, y: 0, width: innerWidth, height: r.bottom + 16 }
  })
  await clear(page)
  // ---- 案C：年度を選ぶ欄のとなりに、小さな「この年度を削除」 ----
  await headerA(page, { ydel: `<button class="v35-ydel">${IC.remove}この年度を削除</button>` })
  await shot(page, 'd-c', STRIP)
  await clear(page)
  // ---- 案B：変更履歴の窓のいちばん下 ----
  await headerA(page)
  await page.evaluate(() => [...window.__v35.realHeader().querySelectorAll('button')].find((b) => b.textContent.includes('変更履歴')).click())
  await page.waitForSelector('.modal .history li')
  await page.evaluate(() => document.activeElement?.blur())
  await page.evaluate((icon) => {
    const m = document.querySelector('.modal')
    window.__v35.after(
      m.querySelector('.history'),
      `<div class="v35-x v35-delsec"><div class="t">この年度を削除</div><div class="r"><p>2027年度は、まだ一度も学生に公開していないので、削除できます。間違えて作った年度を消すときに使います。</p><button>${icon}この年度を削除</button></div></div>`,
    )
  }, IC.remove)
  await parkMouse(page)
  await shot(page, 'd-b', MODAL)
  await page.evaluate(() => document.querySelector('.modal .close').click())
  await clear(page)
  // ---- 削除したあと（本当に試験用サーバーで消して、2026年度で開き直す。知らせは案の文） ----
  await page.evaluate(async () => {
    const s = window.__adminServer
    const row = (await s.getState()).years.find((y) => y.year === 2027)
    await s.deleteYear(2027, row.updatedAt)
    localStorage.setItem('sotsugyo-admin-year', '2026')
  })
  await reopen(page)
  await headerA(page)
  await page.evaluate(() => {
    const form = document.querySelector('.form')
    window.__v35.after(form.firstElementChild, '<div class="v35-x message ok">2027年度を削除しました。いまは2026年度（公開中）を開いています。</div>', true)
  })
  await shot(page, 'd-done', () => ({ x: 0, y: 0, width: 760, height: 200 }))
  await context.close()
}

// =====================================================================
// 3. 新年度を作ったあとの知らせ（本物の「新年度を作成」で作り、出た文を使う）
// =====================================================================
/** 場所の案内（項目の名前の始まり → どこを直すか） */
const WHERE = [
  ['共通の題目', 'この下の「毎年設定する項目」のいちばん上'],
  ['最終締切', '共通の題目のすぐ下'],
  ['お知らせ', 'コースのカードの「このコースの学生へのお知らせ」'],
  ['抄録の書き出し例', 'コースのカードの「下書きのひな形」の「編集する」'],
]

async function noticeShots(browser) {
  const { context, page } = await openAdmin(browser, { vp: PC, year2027: false })
  await page.evaluate(() => [...document.querySelectorAll('.admin-header button')].find((b) => b.textContent.includes('新年度を作成')).click())
  await page.waitForSelector('.modal')
  await page.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => b.textContent.includes('作成する')).click())
  await page.waitForFunction(() => document.querySelector('.message.ok')?.textContent.includes('作成しました'))
  await previewReady(page)
  await parkMouse(page)
  const text = await page.evaluate(() => document.querySelector('.message.ok').textContent)
  console.log('  知らせ：', text)
  // 文を分ける：「…作成しました（…）。」「次の項目は…のままです。」と、項目（かっこの外の「、」で分ける）
  const [head, rest] = text.split('確かめて直してください：')
  const [first, second] = head.split(/(?<=。)/)
  const items = []
  let depth = 0
  let cur = ''
  for (const ch of rest) {
    if (ch === '（') depth++
    if (ch === '）') depth--
    if (ch === '、' && depth === 0) {
      items.push(cur)
      cur = ''
    } else cur += ch
  }
  items.push(cur)
  const where = (item) => WHERE.find(([k]) => item.startsWith(k))?.[1] ?? ''
  /** 写す範囲：入力の欄の上の部分（知らせと、共通の題目・最終締切の欄まで） */
  const FORM_TOP = () => {
    const form = document.querySelector('.form').getBoundingClientRect()
    const deadline = [...document.querySelectorAll('.f')].find((f) => f.querySelector('.l')?.textContent.startsWith('最終締切')).getBoundingClientRect()
    return { x: form.left, y: form.top, width: form.width, height: Math.min(innerHeight - form.top, deadline.bottom + 14 - form.top) }
  }
  // ---- いま ----
  await shot(page, 'n-now', FORM_TOP, { wide: false })
  // ---- 案A：箇条書き（どこを直すかを、小さな字で添える） ----
  const listA = `<div class="v35-x message ok v35-list"><div class="h">${first}</div><p>${second}確かめて直してください。</p><ul>${items.map((it) => `<li>${it}<small>場所：${where(it)}</small></li>`).join('')}</ul></div>`
  await page.evaluate((html) => window.__v35.swap(document.querySelector('.message.ok'), html), listA)
  await shot(page, 'n-a', FORM_TOP, { wide: false })
  await clear(page)
  // ---- 案B：チェックを付けられる一覧（1つ目に付けたところ） ----
  const left = items.length - 1
  const listB =
    `<div class="v35-x message ok v35-check"><div class="h">${first}</div><p>${second}確かめて直したら、チェックを付けてください。<span class="cnt">あと${left}つ</span></p><ul>` +
    items.map((it, i) => `<li class="${i === 0 ? 'done' : ''}"><span class="box">${IC.check}</span><span><span class="tx">${it}</span><small>場所：${where(it)}</small></span></li>`).join('') +
    '</ul><div class="ft">全部にチェックを付けると、この知らせは消えます（「保存」を押しても残ります）。</div></div>'
  await page.evaluate((html) => window.__v35.swap(document.querySelector('.message.ok'), html), listB)
  await page.evaluate((cursor) => window.__v35.cursor(document.querySelector('.v35-check li:nth-child(2) .box'), 0.55, 0.6, cursor), CURSOR)
  await shot(page, 'n-b', FORM_TOP, { wide: false })
  await clear(page)
  await context.close()
}

// =====================================================================
// 4. ひな形の窓：「反映する」を押せない理由（3行目の説明を400字に、7行目の小見出しを空にする）
// =====================================================================
async function templateShots(browser) {
  const { context, page } = await openAdmin(browser, { vp: PC, notice: false, year2027: false })
  await page.evaluate(() => document.querySelector('.form .tpl-row .btn').click())
  await page.waitForSelector('.tpl-modal .ol .row input')
  const inputs = await page.$$('.tpl-modal .ol .row input')
  await setValue(inputs[2], LONG_HINT)
  await setValue(inputs[6], '')
  await page.waitForSelector('.tpl-modal .problems .error')
  // 見本（iframe）の書体が読み込まれるまで待つ
  await sleep(2500)
  await page.evaluate(() => {
    document.activeElement?.blur()
    document.querySelector('.tpl-edit').scrollTop = 0
  })
  await parkMouse(page)
  const problems = await page.evaluate(() => [...document.querySelectorAll('.tpl-modal .problems .error')].map((e) => e.textContent))
  console.log('  問題：', problems.join(' ／ '))
  const ROW_NUM = (p) => Number(/^(\d+)行目/.exec(p)?.[1])
  /** 「3行目の説明「…」が長すぎます（…）」→「3行目の説明が長すぎます（…）」（のぞきの文を外して短く） */
  const short = (p) => p.replace(/「[^」]*」/, '')
  /** 行の中に出す文：「説明が長すぎます（…）」（何行目かは、行そのものでわかるので外す） */
  const inRow = (p) => short(p).replace(/^\d+行目の/, '')

  /** 写す範囲：窓のいちばん下（案内とボタン）と、その上の少し */
  const FOOT = () => {
    const m = document.querySelector('.tpl-modal').getBoundingClientRect()
    const f = document.querySelector('.tpl-foot').getBoundingClientRect()
    const pops = [...document.querySelectorAll('.v35-pop, .v35-tooltip')].map((e) => e.getBoundingClientRect().top)
    const top = Math.min(f.top - 80, ...pops.map((t) => t - 16))
    return { x: m.left, y: top, width: m.width, height: f.bottom + 10 - top }
  }
  /** 写す範囲：左の欄（本文の組み立て） */
  const EDIT = () => {
    const r = document.querySelector('.tpl-edit').getBoundingClientRect()
    const f = document.querySelector('.tpl-foot').getBoundingClientRect()
    return { x: r.left - 8, y: r.top - 8, width: r.width + 16, height: f.bottom + 8 - (r.top - 8) }
  }

  // ---- いま：ボタンは押せず、理由はマウスを重ねたときの小さな説明だけ。赤い字は左の欄のいちばん下 ----
  await page.evaluate(
    (cursor, text) => {
      const k = window.__v35
      const b = document.querySelector('.tpl-foot button.primary')
      k.cursor(b, 0.5, 0.55, cursor)
      const r = b.getBoundingClientRect()
      const tip = k.add('<div class="v35-x v35-fixed v35-tooltip"></div>')
      tip.textContent = text
      tip.style.left = `${Math.min(innerWidth - 10 - tip.offsetWidth, r.left + r.width / 2)}px`
      tip.style.top = `${r.top - 10 - tip.offsetHeight}px`
    },
    CURSOR,
    problems.join('\n'),
  )
  await shot(page, 't-now', null)
  await shot(page, 't-now-foot', FOOT)
  await clear(page)
  await page.evaluate(() => {
    const e = document.querySelector('.tpl-edit')
    e.scrollTop = e.scrollHeight
  })
  await sleep(300)
  await shot(page, 't-now-bottom', EDIT)
  await page.evaluate(() => (document.querySelector('.tpl-edit').scrollTop = 0))

  // ---- 案A：「反映する」のとなりに、1つ目の理由と「ほか1件」（そのあいだ、下の案内の代わりに出す） ----
  await page.evaluate(
    (icon, first, more) => {
      const k = window.__v35
      const foot = document.querySelector('.tpl-foot')
      foot.querySelector('.hint').setAttribute('data-v35-hidden', '')
      const cancel = [...foot.querySelectorAll('button')].find((b) => b.textContent.trim() === 'やめる')
      k.after(cancel, `<span class="v35-x v35-why">${icon}<span>${first}</span>${more ? `<a class="more" href="#">ほか${more}件</a>` : ''}</span>`, true)
    },
    IC.warn,
    short(problems[0]),
    problems.length - 1,
  )
  await shot(page, 't-a', null)
  await shot(page, 't-a-foot', FOOT)
  await clear(page)

  // ---- 案B：押すと、左の欄が直す行へ動き、その行を赤くして、行のすぐ下に理由を出す ----
  await page.evaluate(
    (icon, cursor, list) => {
      const k = window.__v35
      const rows = [...document.querySelectorAll('.tpl-modal .ol .row')]
      for (const { n, text } of list) {
        const row = rows[n - 1]
        if (!row) continue
        row.classList.add('v35-bad')
        k.after(row, `<div class="v35-x v35-rowmsg${row.classList.contains('subheading') ? ' sub' : row.classList.contains('chapter') ? ' ch' : ''}">${icon}${text}</div>`)
      }
      rows[list[0].n - 1]?.scrollIntoView({ block: 'nearest' })
      const foot = document.querySelector('.tpl-foot')
      k.swap(foot.querySelector('.hint'), `<span class="v35-x v35-flash">直すところ（${list.length}か所）を、左の欄で赤くしました</span>`)
      k.cursor(foot.querySelector('button.primary'), 0.5, 0.55, cursor)
    },
    IC.warn,
    CURSOR,
    problems.map((p) => ({ n: ROW_NUM(p), text: inRow(p) })).filter((x) => x.n),
  )
  await shot(page, 't-b', null)
  await shot(page, 't-b-edit', EDIT)
  await clear(page)

  // ---- 案C：「反映する」に赤い数。押す（マウスを重ねる）と、理由の一覧が上に出る。押すと、その行へ動く ----
  await page.evaluate(
    (icon, cursor, list) => {
      const k = window.__v35
      const b = document.querySelector('.tpl-foot button.primary')
      const r = b.getBoundingClientRect()
      const c = k.add(`<span class="v35-x v35-fixed v35-count">${list.length}</span>`)
      c.style.left = `${r.right - c.offsetWidth / 2 - 4}px`
      c.style.top = `${r.top - c.offsetHeight / 2 - 2}px`
      const pop = k.add(`<div class="v35-x v35-fixed v35-pop"><div class="h">${icon}直すところが${list.length}つあります</div><ul>${list.map((t) => `<li><a href="#">${t}</a></li>`).join('')}</ul><div class="f">押すと、その行へ動きます</div></div>`)
      const m = document.querySelector('.tpl-modal').getBoundingClientRect()
      const left = Math.min(m.right - 12 - pop.offsetWidth, r.right - pop.offsetWidth + 10)
      pop.style.left = `${left}px`
      pop.style.top = `${r.top - 20 - pop.offsetHeight}px`
      pop.style.setProperty('--ax', `${left + pop.offsetWidth - (r.left + r.width / 2) - 6}px`)
      k.cursor(b, 0.45, 0.6, cursor)
    },
    IC.warn,
    CURSOR,
    problems,
  )
  await shot(page, 't-c', null)
  await shot(page, 't-c-foot', FOOT)
  await clear(page)
  await context.close()
}

// =====================================================================
// 一覧のページ（mockups/v35-admin/review.html）を、話題ごとに画像にする（shots/review-header.png など）
// =====================================================================
async function reviewShots(browser) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1300, height: 900, deviceScaleFactor: 1 })
  await page.goto(`${APP}/${DIR}/review.html`, { waitUntil: 'networkidle0' })
  await page.evaluate(() => document.fonts.ready)
  await sleep(500)
  for (const id of ['header', 'delete', 'notice', 'template']) {
    const el = await page.$(`#${id}`)
    await el.screenshot({ path: `${OUT}/review-${id}.png` })
    console.log('✓', `review-${id}`)
  }
  await page.close()
}

await withEdge(async (browser) => {
  if (want('header')) await headerShots(browser)
  if (want('delete')) await deleteShots(browser)
  if (want('notice')) await noticeShots(browser)
  if (want('template')) await templateShots(browser)
  if (want('review')) await reviewShots(browser)
})
