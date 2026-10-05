// デザイン案（v3）共通：上のバーにあった部品と、右の欄（ページ一覧＋セルフチェック）
import { pagesHtml } from '../v2/pages.js'
import { setupBook } from '../v2/book.js'
import { toolsHtml } from '../v2/tools.js'

const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
export const ICONS = {
  handbook: svg('<path d="M4 5.5A1.5 1.5 0 015.5 4H11v16H5.5A1.5 1.5 0 014 18.5z"/><path d="M20 5.5A1.5 1.5 0 0018.5 4H13v16h5.5a1.5 1.5 0 001.5-1.5z"/>'),
  backup: svg('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M5 17v2.5h14V17"/>'),
  pdf: svg('<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4"/><path d="M12 11v6M9.5 14.5L12 17l2.5-2.5"/>'),
}

export const PAGES_BOX = `<section><h3>ページ <b id="pageinfo"></b></h3><div class="thumbs grid" id="thumbs"></div></section>`
export const CHECK_BOX = `<section class="check">
  <h2>セルフチェック</h2>
  <div class="counts"><div class="count e"><b>2</b>エラー</div><div class="count w"><b>0</b>警告</div></div>
  <div class="issue"><b>一人称は「筆者」にする</b><br>本文 1ページ　「私は」→「筆者は」</div>
  <div class="issue"><b>数字は半角で書く</b><br>本文 1ページ　全角の「１５」→ 半角の「15」</div>
</section>`

export function start(inset, onLayout) {
  document.getElementById('tools').innerHTML = toolsHtml()
  document.getElementById('book').innerHTML = pagesHtml()
  setupBook({
    stage: document.getElementById('stage'),
    book: document.getElementById('book'),
    indicator: document.getElementById('pageinfo'),
    prev: document.getElementById('prev'),
    next: document.getElementById('next'),
    thumbs: document.getElementById('thumbs'),
    inset,
    onLayout,
  })
  // 見本では「本文 1」にエラーがあることにする
  document.querySelectorAll('#thumbs .t').forEach((t) => t.classList.toggle('has-error', t.title === '本文 1'))
}
