// デザイン案（v6）：デザイン1「紙と墨」を、本番の機能に合わせて見直したもの。
// - 道具は、ページの種類と、書いている物・選んでいる物に合わせて入れ替わる
// - 段落などを足す前に、どこに入るかを紙面に示す
// - 「全体」「拡大」の切り替え（画面の小さいノートPCでも文字を読みやすく）
// - 右の欄に、お知らせ・進み具合のメーター・場所ごとにまとめた指摘
import { pagesHtml } from '../v2/pages.js'
import { setupBook } from '../v2/book.js'

const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
export const I = {
  paragraph: svg('<path d="M8.5 6.5H19M5 10.5h14M5 14.5h14M5 18.5h9"/>'),
  heading2: svg('<text x="7.6" y="11.6" text-anchor="middle" font-size="8.5" font-weight="700" fill="currentColor" stroke="none">ⅰ</text><path d="M11.5 8.4h7" stroke-width="2.2"/><path d="M6 14.5h13M6 18.5h9"/>'),
  heading1: svg('<text x="6.6" y="12" text-anchor="middle" font-size="10.5" font-weight="700" fill="currentColor" stroke="none">Ⅰ</text><path d="M11 8.2h9" stroke-width="2.8"/><path d="M4 14.5h16M4 18.5h11"/>'),
  figure: svg('<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9.5" cy="10" r="1.5"/><path d="M5 17.5l4.5-4.5 3 3 2-2 4.5 4.5"/>'),
  table: svg('<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 10h16M4 14.5h16M10 10v9M15 10v9"/>'),
  refs: svg('<path d="M6 4.5h12v15H6z"/><path d="M9 8.5h6M9 12h6M9 15.5h4"/>'),
  ref: svg('<path d="M7.5 4.5c-3.3 4.2-3.3 10.8 0 15M16.5 4.5c3.3 4.2 3.3 10.8 0 15"/><rect x="9" y="9" width="6" height="6" rx="1"/>'),
  replace: svg('<rect x="4" y="6" width="12" height="11" rx="1.5"/><path d="M14 4.5h5.5V10M19.5 4.5l-6 6"/>'),
  beside: svg('<rect x="3.5" y="6" width="7.5" height="11" rx="1.2"/><rect x="13" y="6" width="7.5" height="11" rx="1.2" stroke-dasharray="2 2"/>'),
  remove: svg('<path d="M5 7h14M10 7V5.5h4V7M7 7l.9 12h8.2L17 7"/>'),
  undo: svg('<path d="M9 7.5L5 11.5l4 4"/><path d="M5 11.5h9.5a4.5 4.5 0 010 9H12"/>'),
  handbook: svg('<path d="M4 5.5A1.5 1.5 0 015.5 4H11v16H5.5A1.5 1.5 0 014 18.5zM20 5.5A1.5 1.5 0 0018.5 4H13v16h5.5a1.5 1.5 0 001.5-1.5z"/>'),
  backup: svg('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 17v2.5h14V17"/>'),
  pdf: svg('<path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4M12 11v6M9.5 14.5L12 17l2.5-2.5"/>'),
  prev: svg('<path d="M14.5 5l-7 7 7 7"/>'),
  next: svg('<path d="M9.5 5l7 7-7 7"/>'),
  fit: svg('<rect x="6" y="3.5" width="12" height="17" rx="1.5"/>'),
  zoom: svg('<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5L20 20M11 8.5v5M8.5 11h5"/>'),
}

const tb = (label, icon, extra = '') => `<button class="tb ${extra}" data-label="${label}" title="${label}">${icon}<span>${label}</span></button>`

// ページの種類ごとの道具と、ひとことの説明
const PAGE_CONTEXT = {
  表紙: { hint: '項目をクリック<br>して入力', add: [], insert: [] },
  抄録: { hint: '600〜900字で<br>まとめる', add: ['段落'], insert: [] },
  目次: { hint: '見出しから<br>自動で作られる', add: [], insert: [] },
  本文: { hint: 'クリックして<br>その場で書く', add: ['段落', '小見出し', '大見出し'], insert: ['図（写真）', '素材表', '参考文献'] },
  作品写真: { hint: '枠をクリック<br>して選ぶ', add: [], insert: [] },
}
const TOOL_ICONS = { 段落: I.paragraph, 小見出し: I.heading2, 大見出し: I.heading1, '図（写真）': I.figure, 素材表: I.table, 参考文献: I.refs }

// 書いている物・選んでいる物ごとの道具
const SELECTION_TOOLS = {
  paragraph: { label: 'この段落', tools: [['図表を参照', I.ref], ['削除', I.remove, 'danger']] },
  heading: { label: 'この見出し', tools: [['削除', I.remove, 'danger']] },
  figure: { label: 'この図', tools: [['差し替え', I.replace], ['横に並べる', I.beside], ['削除', I.remove, 'danger']] },
  photos: { label: '並べ方', layouts: [1, 2, 3, 4, 6] },
}

const GROUPS = [
  {
    area: '全体',
    items: [{ ttl: '本文が5ページに足りません', where: '本文 2ページ', sug: 'あと3ページ書きましょう', page: 4 }],
  },
  {
    area: '本文',
    items: [
      { ttl: '一人称は「筆者」にする', where: '本文 1ページ', sug: '「私は」→「筆者は」', page: 3, fix: true, target: 0 },
      { ttl: '数字は半角で書く', where: '本文 1ページ', sug: '「１５」→「15」', page: 3, fix: true, target: 1 },
    ],
  },
]

const meter = (label, value, ratio, ok) =>
  `<div class="meter2"><div class="row"><span>${label}</span><b class="${ok ? 'ok' : 'ng'}">${value}</b></div><div class="bar"><i class="${ok ? 'ok' : 'ng'}" style="width:${Math.round(Math.min(1, ratio) * 100)}%"></i></div></div>`

export function mount() {
  document.body.innerHTML = `
  <div class="app">
    <main class="stage" id="stage">
      <div class="book" id="book">${pagesHtml()}</div>
      <nav class="palette" id="palette" aria-label="道具">
        <div class="p-head"><b id="ctx-name"></b><span id="ctx-hint"></span></div>
        <div class="group" id="g-add"></div>
        <div class="group" id="g-insert"></div>
        <div class="group ctx" id="g-ctx"></div>
        <div class="group">${tb('元に戻す', I.undo)}</div>
      </nav>
      <button class="arrow prev" id="prev" aria-label="前のページ">${I.prev}</button>
      <button class="arrow next" id="next" aria-label="次のページ">${I.next}</button>
      <div class="zoom" role="group" aria-label="表示の大きさ">
        <button class="on" data-zoom="0" title="1ページ全体を表示">${I.fit}全体</button>
        <button data-zoom="1" title="文字を大きく表示（ホイールで上下に動かす）">${I.zoom}拡大</button>
      </div>
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
      <div class="notice2"><b>学科からのお知らせ</b>（見本）管理ページで入力したお知らせが、ここに出ます。</div>
      <section class="sec pages">
        <div class="sec-h"><span>ページ</span><span class="pcount" id="count"></span></div>
        <div class="thumb-list" id="thumbs"></div>
      </section>
      <section class="sec check">
        <div class="sec-h"><span>セルフチェック</span><span class="tally"><b class="e">3</b> エラー　<b class="w">0</b> 警告</span></div>
        <div class="meters2">
          ${meter('本文のページ数', '2 / 5ページ以上', 2 / 5, false)}
          ${meter('抄録の文字数', '712字（600〜900）', 712 / 900, true)}
          ${meter('抄録の行数', '19行（15〜23）', 19 / 23, true)}
          ${meter('図の枚数', '1枚（目安 4枚まで）', 1 / 4, true)}
        </div>
        ${GROUPS.map(
          (g) => `<div class="igroup"><div class="ig-h">${g.area}<span>${g.items.length}件</span></div><ul class="issues">${g.items
            .map(
              (it) =>
                `<li class="issue2" data-page="${it.page}" ${it.target !== undefined ? `data-target="${it.target}"` : ''}><i class="dot"></i><div><div class="ttl">${it.ttl}<span class="src">手順書</span></div><div class="where">${it.where}</div><div class="sug">${it.sug}</div></div>${it.fix ? '<button class="fix">直す</button>' : '<span></span>'}</li>`,
            )
            .join('')}</ul></div>`,
        ).join('')}
      </section>
      <footer class="side-foot">
        <button class="export">${I.pdf}PDFを書き出す</button>
        <p>エラーを0にしてから書き出しましょう</p>
        <a class="src-link" href="#">このツールのソースコード（AGPL-3.0）</a>
      </footer>
    </aside>
  </div>`

  const stage = document.getElementById('stage')
  const book = document.getElementById('book')
  const thumbs = document.getElementById('thumbs')
  const count = document.getElementById('count')
  const pages = [...book.querySelectorAll('.page')]
  // 書いている物・選んでいる物（ページごと）
  let selection = { kind: 'paragraph', el: book.querySelector('.editing') }

  const pageKind = (page) => {
    const name = page.dataset.name
    return name.startsWith('本文') ? '本文' : name
  }

  const renderPalette = () => {
    const page = pages[api?.index ?? 0]
    const kind = pageKind(page)
    const ctx = PAGE_CONTEXT[kind]
    document.getElementById('ctx-name').textContent = kind
    document.getElementById('ctx-hint').innerHTML = ctx.hint
    const gAdd = document.getElementById('g-add')
    const gInsert = document.getElementById('g-insert')
    const gCtx = document.getElementById('g-ctx')
    gAdd.innerHTML = ctx.add.map((l) => tb(l, TOOL_ICONS[l], 'add')).join('')
    gInsert.innerHTML = ctx.insert.map((l) => tb(l, TOOL_ICONS[l], l === '参考文献' ? '' : 'add')).join('')
    gAdd.hidden = ctx.add.length === 0
    gInsert.hidden = ctx.insert.length === 0
    // 選んでいる物の道具（そのページの中のものだけ）
    let sel = kind === '作品写真' ? { kind: 'photos' } : selection?.el && page.contains(selection.el) ? selection : null
    const def = sel && SELECTION_TOOLS[sel.kind]
    if (def?.layouts) {
      gCtx.innerHTML = `<div class="ctx-label">${def.label}</div><div class="layouts">${def.layouts.map((n) => `<button class="lay ${n === 2 ? 'on' : ''}">${n}枚</button>`).join('')}</div>`
    } else if (def) {
      gCtx.innerHTML = `<div class="ctx-label">${def.label}</div>${def.tools.map(([l, icon, extra]) => tb(l, icon, extra)).join('')}`
    } else {
      gCtx.innerHTML = ''
    }
    gCtx.hidden = !def
    // 足す道具にマウスを重ねると、紙面のどこに入るかを示す
    document.querySelectorAll('.tb.add').forEach((b) => {
      b.addEventListener('mouseenter', () => {
        const target = selection?.el && page.contains(selection.el) ? selection.el : page.querySelector('p:last-of-type')
        target?.classList.add('insert-preview')
      })
      b.addEventListener('mouseleave', () => document.querySelectorAll('.insert-preview').forEach((x) => x.classList.remove('insert-preview')))
    })
  }

  let api = null
  api = setupBook({
    stage,
    book,
    prev: document.getElementById('prev'),
    next: document.getElementById('next'),
    thumbs,
    inset: { top: 18, bottom: 18, side: 185 },
    onLayout: () => {
      const i = [...thumbs.children].findIndex((t) => t.classList.contains('on'))
      if (i >= 0) count.innerHTML = `<b>${i + 1}</b> / ${pages.length}`
      renderPalette()
    },
  })
  renderPalette()

  // 紙面をクリック：書く所を選ぶ／図を選ぶ
  book.addEventListener('click', (e) => {
    const page = e.target.closest('.page.current')
    if (!page) return
    const figure = e.target.closest('figure, .photos .ph')
    const text = e.target.closest('p, h1, h2, .frame > .t, .frame > .st, .frame > .crs, .frame > .id, .frame > .nm')
    document.querySelectorAll('.page .editing, .page .selected').forEach((x) => x.classList.remove('editing', 'selected'))
    if (figure) {
      figure.classList.add('selected')
      selection = { kind: 'figure', el: figure }
    } else if (text) {
      text.classList.add('editing')
      selection = { kind: /^H/.test(text.tagName) ? 'heading' : 'paragraph', el: text }
    } else {
      selection = null
    }
    renderPalette()
  })

  // 表示の大きさ
  document.querySelectorAll('.zoom button').forEach((b) =>
    b.addEventListener('click', () => {
      document.querySelectorAll('.zoom button').forEach((x) => x.classList.toggle('on', x === b))
      api.setZoom(b.dataset.zoom === '1')
    }),
  )

  // 指摘をクリック：そのページへめくり、該当箇所を光らせる
  document.querySelectorAll('.issue2').forEach((li) =>
    li.addEventListener('click', (e) => {
      if (e.target.closest('.fix')) return
      const to = Number(li.dataset.page)
      const flash = () => {
        if (li.dataset.target === undefined) return
        const el = pages[to].querySelectorAll('.err')[Number(li.dataset.target)]
        el?.classList.remove('flash')
        void el?.offsetWidth
        el?.classList.add('flash')
      }
      if (api.index === to) flash()
      else {
        api.go(to)
        setTimeout(flash, 800)
      }
    }),
  )

  // ページ一覧は、紙面を縮小した本物の見た目にする
  thumbs.querySelectorAll(':scope > .t').forEach((t, i) => {
    const box = t.querySelector('span')
    box.className = 'mini'
    const clone = pages[i].cloneNode(true)
    clone.className = `${pages[i].className.replace(/\b(current|under|under-current|turn-in|turn-out)\b/g, '')} mini-page`
    clone.querySelectorAll('.editing').forEach((e) => e.classList.remove('editing'))
    box.append(clone)
    t.classList.toggle('has-error', t.title === '本文 1' || t.title === '本文 2')
  })
}
