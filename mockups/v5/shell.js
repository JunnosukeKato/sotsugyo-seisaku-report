// デザイン案（v5）：配置は決定済み（紙面を中央・道具を紙面の左わき・右の欄に案A）。
// 見た目（配色・文字・形）だけを theme-*.css で変えて比べる。
import { pagesHtml } from '../v2/pages.js'
import { setupBook } from '../v2/book.js'

const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`

// 道具のアイコンは、線の太さ・大きさをそろえて描き直したもの
const I = {
  paragraph: svg('<path d="M8.5 6.5H19M5 10.5h14M5 14.5h14M5 18.5h9"/>'),
  // 見出しは、報告書の番号の付け方（Ⅰ．ⅰ．）をそのまま絵にする
  heading2: svg('<text x="7.6" y="11.6" text-anchor="middle" font-size="8.5" font-weight="700" fill="currentColor" stroke="none">ⅰ</text><path d="M11.5 8.4h7" stroke-width="2.2"/><path d="M6 14.5h13M6 18.5h9"/>'),
  heading1: svg('<text x="6.6" y="12" text-anchor="middle" font-size="10.5" font-weight="700" fill="currentColor" stroke="none">Ⅰ</text><path d="M11 8.2h9" stroke-width="2.8"/><path d="M4 14.5h16M4 18.5h11"/>'),
  figure: svg('<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9.5" cy="10" r="1.5"/><path d="M5 17.5l4.5-4.5 3 3 2-2 4.5 4.5"/>'),
  table: svg('<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M4 14.5h16M10 10v9M15 10v9"/>'),
  ref: svg('<path d="M7.5 4.5c-3.3 4.2-3.3 10.8 0 15M16.5 4.5c3.3 4.2 3.3 10.8 0 15"/><rect x="9" y="9" width="6" height="6" rx="1"/>'),
  remove: svg('<path d="M5 7h14M10 7V5.5h4V7M7 7l.9 12h8.2L17 7"/>'),
  undo: svg('<path d="M9 7.5L5 11.5l4 4"/><path d="M5 11.5h9.5a4.5 4.5 0 010 9H12"/>'),
  handbook: svg('<path d="M4 5.5A1.5 1.5 0 015.5 4H11v16H5.5A1.5 1.5 0 014 18.5zM20 5.5A1.5 1.5 0 0018.5 4H13v16h5.5a1.5 1.5 0 001.5-1.5z"/>'),
  backup: svg('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 17v2.5h14V17"/>'),
  pdf: svg('<path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4M12 11v6M9.5 14.5L12 17l2.5-2.5"/>'),
  prev: svg('<path d="M14.5 5l-7 7 7 7"/>'),
  next: svg('<path d="M9.5 5l7 7-7 7"/>'),
}

const GROUPS = [
  [['段落', I.paragraph], ['小見出し', I.heading2], ['大見出し', I.heading1]],
  [['図（写真）', I.figure], ['素材表', I.table], ['図表を参照', I.ref]],
  [['削除', I.remove, 'danger'], ['元に戻す', I.undo]],
]

const ISSUES = [
  ['一人称は「筆者」にする', '本文 1ページ', '「私は」→「筆者は」'],
  ['数字は半角で書く', '本文 1ページ', '「１５」→「15」'],
]

export function mount() {
  document.body.innerHTML = `
  <div class="app">
    <main class="stage" id="stage">
      <div class="book" id="book">${pagesHtml()}</div>
      <nav class="palette" aria-label="道具">
        ${GROUPS.map((g) => `<div class="group">${g.map(([label, icon, cls]) => `<button class="tb ${cls ?? ''}" title="${label}">${icon}<span>${label}</span></button>`).join('')}</div>`).join('')}
      </nav>
      <button class="arrow prev" id="prev" aria-label="前のページ">${I.prev}</button>
      <button class="arrow next" id="next" aria-label="次のページ">${I.next}</button>
    </main>
    <aside class="side">
      <header class="side-head">
        <div class="brand-row">
          <span class="mark">卒</span>
          <div><div class="brand-name">卒業制作報告書</div><div class="brand-sub">2026年度</div></div>
        </div>
        <div class="meta">
          <span class="chip saved"><i class="dot"></i>自動保存 14:32</span>
          <span class="chip deadline" title="最終締切 2027年1月20日（水）">締切まで <b>107</b> 日</span>
        </div>
        <div class="links">
          <button class="link-btn">${I.handbook}手順書</button>
          <button class="link-btn">${I.backup}バックアップ</button>
        </div>
      </header>
      <section class="sec pages">
        <div class="sec-h"><span>ページ</span><span class="pcount" id="count"></span></div>
        <div class="thumb-list" id="thumbs"></div>
      </section>
      <section class="sec check">
        <div class="sec-h"><span>セルフチェック</span></div>
        <div class="summary"><span class="stat err"><b>2</b>エラー</span><span class="stat warn"><b>0</b>警告</span></div>
        <ul class="issues">
          ${ISSUES.map(([title, where, fix]) => `<li class="issue2"><i class="dot"></i><div><div class="ttl">${title}</div><div class="where">${where}</div><div class="sug">${fix}</div></div><button class="fix">直す</button></li>`).join('')}
        </ul>
      </section>
      <footer class="side-foot">
        <button class="export">${I.pdf}PDFを書き出す</button>
        <p>エラーを0にしてから書き出しましょう</p>
      </footer>
    </aside>
  </div>`

  const stage = document.getElementById('stage')
  const book = document.getElementById('book')
  const thumbs = document.getElementById('thumbs')
  const count = document.getElementById('count')
  const pages = [...book.querySelectorAll('.page')]
  setupBook({
    stage,
    book,
    prev: document.getElementById('prev'),
    next: document.getElementById('next'),
    thumbs,
    // 左に道具＋←の分、右に→の分を空ける
    inset: { top: 18, bottom: 18, side: 175 },
    onLayout: () => {
      const i = [...thumbs.children].findIndex((t) => t.classList.contains('on'))
      if (i >= 0) count.innerHTML = `<b>${i + 1}</b> / ${pages.length}`
    },
  })

  // ページ一覧は、紙面を縮小した本物の見た目にする
  thumbs.querySelectorAll(':scope > .t').forEach((t, i) => {
    const box = t.querySelector('span')
    box.className = 'mini'
    const clone = pages[i].cloneNode(true)
    clone.className = `${pages[i].className.replace(/\b(current|under|under-current|turn-in|turn-out)\b/g, '')} mini-page`
    clone.querySelectorAll('.editing').forEach((e) => e.classList.remove('editing'))
    box.append(clone)
    t.classList.toggle('has-error', t.title === '本文 1')
  })
}
