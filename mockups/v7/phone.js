// デザイン案（v7）スマホ版の3案。state=view（見る）／edit（書く）／check（セルフチェック）
//  案1：紙面を拡大して、PCと同じように紙面に直接書く
//  案2：紙面の段落をタップすると、下から大きな文字の書く欄が出る
//  案3：「書く」（読みやすい文章の画面）と「紙面」を切り替える
import { pagesHtml } from '../v2/pages.js'
import { setupBook } from '../v2/book.js'
import { I } from '../v6/shell.js'

const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
const X = {
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  pages: svg('<rect x="4" y="4" width="7" height="9" rx="1"/><rect x="13" y="4" width="7" height="9" rx="1"/><rect x="4" y="15" width="7" height="5" rx="1"/><rect x="13" y="15" width="7" height="5" rx="1"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  write: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  paper: svg('<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 12h6M9 15.5h6"/>'),
}

const BODY_TEXT = '世紀ごろの中東の装いをもとに、航海の力強さと冒険心を表すデザインを考えた（図1）。キーワードは自由、勇気、海である。袖は風をはらむように大きく膨らませ、腰には幅の広い帯を巻いた。'

const top = (sub) => `
  <header class="p-top">
    <span class="mark">卒</span>
    <div><div class="title">卒業制作報告書</div><div class="sub">${sub}</div></div>
    <span class="saved"><i></i>ドライブに保存済み</span>
    <button class="icon-btn" aria-label="メニュー（手順書・バックアップなど）">${X.menu}</button>
  </header>`

const nav = (items) => `<nav class="p-nav" style="grid-template-columns:repeat(${items.length},1fr)">${items
  .map(([label, icon, cls = '', badge]) => `<button class="${cls}">${cls.includes('add') ? `<span class="plus">${icon}</span>` : icon}${label}${badge ? `<i class="badge">${badge}</i>` : ''}</button>`)
  .join('')}</nav>`

const NAV_12 = (on) => nav([
  ['ページ一覧', X.pages],
  ['追加', X.plus, 'add'],
  ['チェック', X.check, on === 'check' ? 'on' : '', 3],
  ['PDF', I.pdf],
])
const NAV_3 = (on) => nav([
  ['書く', X.write, on === 'write' ? 'on' : ''],
  ['紙面', X.paper, on === 'paper' ? 'on' : ''],
  ['チェック', X.check, on === 'check' ? 'on' : '', 3],
  ['PDF', I.pdf],
])

const stageHtml = (withPager = true) => `
  <main class="p-stage" id="stage">
    <div class="book" id="book">${pagesHtml()}</div>
    ${withPager ? `<div class="pager"><button id="prev" aria-label="前のページ">${I.prev}</button><span class="lbl" id="lbl"></span><button id="next" aria-label="次のページ">${I.next}</button></div>` : ''}
  </main>`

const ACC = `
  <div class="acc">
    <button>${I.paragraph}段落</button><button>${I.heading2}小見出し</button><button>${I.heading1}大見出し</button>
    <span class="sep"></span><button>${I.figure}図</button><button>${I.table}素材表</button><button>${I.ref}図表を参照</button>
    <span class="sep"></span><button class="danger">${I.remove}削除</button><button>${I.undo}戻す</button>
    <button class="done">完了</button>
  </div>`

const KBD = `
  <div class="kbd" aria-label="キーボード（見本）">
    <div class="cand"><span>考えた</span><span>変えた</span><span>代えた</span><span>替えた</span></div>
    <div class="row">${'あかさたなはまやらわ'.split('').map((c) => `<span class="k">${c}</span>`).join('')}</div>
    <div class="row">${'いきしちにひみゆりを'.split('').map((c) => `<span class="k">${c}</span>`).join('')}</div>
    <div class="row">${'うくすつぬふむよるん'.split('').map((c) => `<span class="k">${c}</span>`).join('')}</div>
    <div class="row"><span class="k w">123</span><span class="k w">🌐</span><span class="k sp">空白</span><span class="k ret">改行</span></div>
  </div>`

// 紙面の見るときの表示（ページ送りつき）
function startBook(start = 3) {
  const stage = document.getElementById('stage')
  const book = document.getElementById('book')
  const pages = [...book.querySelectorAll('.page')]
  const lbl = document.getElementById('lbl')
  let api = null
  api = setupBook({
    stage,
    book,
    prev: document.getElementById('prev'),
    next: document.getElementById('next'),
    inset: { top: 14, bottom: 66, side: 12 },
    start,
    onLayout: () => {
      const i = api?.index ?? start
      if (lbl) lbl.innerHTML = `${pages[i].dataset.name}　<b>${i + 1}</b> / ${pages.length}`
    },
  })
  // 指で左右にはらうと、ページをめくる
  let x0 = null
  stage.addEventListener('pointerdown', (e) => (x0 = e.clientX))
  stage.addEventListener('pointerup', (e) => {
    if (x0 === null) return
    const dx = e.clientX - x0
    if (Math.abs(dx) > 50) api.go(api.index + (dx < 0 ? 1 : -1))
    x0 = null
  })
  return api
}

// 書くとき：紙面の本文の幅が画面の幅いっぱいになるよう拡大し、書いている段落のあたりを見せる
function zoomToEditing({ caret }) {
  const stage = document.getElementById('stage')
  const book = document.getElementById('book')
  const page = book.querySelectorAll('.page')[3]
  page.classList.add('current')
  const editing = page.querySelector('.editing p')
  if (caret) editing.innerHTML = editing.innerHTML.replace('考えた（図1）', '考えた<span class="caret"></span>（図1）')
  const s = (stage.clientWidth - 20) / 568
  const y = editing.offsetTop - 70
  book.style.left = '0'
  book.style.top = '0'
  book.style.transformOrigin = '0 0'
  book.style.transform = `translate(${10 - 132 * s}px, ${-y * s}px) scale(${s})`
}

export function mount(opt, state) {
  const root = document.getElementById('phone')
  if (state === 'view' || state === 'check') {
    root.innerHTML = `${top('本文 1ページ')}${stageHtml()}${opt === 3 ? NAV_3(state === 'check' ? 'check' : 'paper') : NAV_12(state)}`
    startBook(3)
    if (state === 'check') root.insertAdjacentHTML('beforeend', CHECK_SHEET)
    return
  }
  // 書く
  if (opt === 1) {
    root.innerHTML = `${top('本文 1ページを書いています')}${stageHtml(false)}${ACC}${KBD}`
    zoomToEditing({ caret: true })
  } else if (opt === 2) {
    root.innerHTML = `${top('本文 1ページ')}${stageHtml(false)}
      <div class="sheet">
        <div class="s-head"><span class="where">本文 1ページ ・ <b>段落</b>を書いています</span><button class="done">完了</button></div>
        <div class="s-text"><span class="err">１５</span>${BODY_TEXT.replace('考えた（図1）', '考えた<span class="caret"></span>（図1）')}</div>
        <div class="s-meta"><span>この段落 97字</span><span class="ng">数字は半角で書く（1件）</span></div>
        <div class="acc" style="background:#fff;border-top:0"><button>${X.plus}追加</button><button>${I.ref}図表を参照</button><button class="danger">${I.remove}削除</button><button>${I.undo}戻す</button></div>
      </div>${KBD}`
    zoomToEditing({ caret: false })
  } else {
    root.innerHTML = `${top('書く ・ 本文')}
      <div class="doc">
        <div class="sec-tag"><span>本文</span><span>1ページ目</span></div>
        <h1>Ⅰ．企画・立案</h1>
        <h2>ⅰ．担当衣装のキャラクター</h2>
        <p>筆者が担当したのは、物語の主人公である船乗りシンドバッドの衣装である。<span class="err">私は</span>、旅立ちの場面の若々しさと、帰還の場面の頼もしさの両方を衣装で表したいと考えた。</p>
        <h2>ⅱ．デザイン説明</h2>
        <p class="editing"><span class="err">１５</span>${BODY_TEXT.replace('考えた（図1）', '考えた<span class="caret"></span>（図1）')}</p>
        <div class="fig-card"><span class="ph"></span><div><b>図1．デザイン画</b><span>タップして写真・タイトルを変える</span></div></div>
        <div class="pbreak">ここから 2ページ目</div>
      </div>${ACC}${KBD}`
  }
}

const CHECK_SHEET = `
  <div class="scrim"></div>
  <section class="check-sheet">
    <div class="grab"></div>
    <div class="c-head"><h2>セルフチェック</h2><span class="tally"><b class="e">3</b> エラー　<b class="w">0</b> 警告</span></div>
    <div class="c-body">
      <div class="meters2">
        <div class="meter2"><div class="row"><span>本文のページ数</span><b class="ng">2 / 5ページ以上</b></div><div class="bar"><i class="ng" style="width:40%"></i></div></div>
        <div class="meter2"><div class="row"><span>抄録の文字数</span><b>712字（600〜900）</b></div><div class="bar"><i style="width:79%"></i></div></div>
        <div class="meter2"><div class="row"><span>抄録の行数</span><b>19行（15〜23）</b></div><div class="bar"><i style="width:83%"></i></div></div>
      </div>
      <div class="igroup"><div class="ig-h">全体<span>1件</span></div><ul class="issues">
        <li class="issue2"><i class="dot"></i><div><div class="ttl">本文が5ページに足りません<span class="src">手順書</span></div><div class="where">本文 2ページ</div><div class="sug">あと3ページ書きましょう</div></div><span></span></li></ul></div>
      <div class="igroup"><div class="ig-h">本文<span>2件</span></div><ul class="issues">
        <li class="issue2"><i class="dot"></i><div><div class="ttl">一人称は「筆者」にする<span class="src">手順書</span></div><div class="where">本文 1ページ</div><div class="sug">「私は」→「筆者は」</div></div><button class="fix">直す</button></li>
        <li class="issue2"><i class="dot"></i><div><div class="ttl">数字は半角で書く<span class="src">手順書</span></div><div class="where">本文 1ページ</div><div class="sug">「１５」→「15」</div></div><button class="fix">直す</button></li></ul></div>
    </div>
    <div class="c-foot"><button class="export">${I.pdf}PDFを書き出す</button></div>
  </section>`
