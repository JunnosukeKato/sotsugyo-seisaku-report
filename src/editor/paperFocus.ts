/**
 * 紙面の欄に、キーボード（Tab）で移れるようにする（mockups/v23 ④）。
 * 組版した紙面は表示専用で、もとは Tab で止まる所がなかった。紙面を組み直して表に出すたびに（reportEditor の render）、
 * 書ける欄・図・改ページの印・作品写真の枠・抄録の「先生の許可が出た」・引用・参考文献に、Tab で止まる印（tabindex）と読み上げ用の名前を付ける。
 * 移った欄で Enter（スペース）を押すと、クリックしたときと同じことをする（reportEditor の onPaperKey）。
 *
 * 見えているページのほかは表示していない（display: none）ので、Tab で移るのは見えているページの欄だけ。
 * 紙面の中の Tab は、紙面の上から順（同じ高さなら左から）に移す（reportEditor の onPaperKey）。組版エンジンは、
 * 次のページの上へ送った図などを文書の後ろのほうに置くため、ブラウザに任せると上から順にならない。
 * そのため、Tab で紙面に入ったときに止まる欄は、ページに1つだけにする（ほかの欄は tabindex -1。最後にいた欄、はじめはいちばん上の欄）。
 * 組み直すと紙面の要素は作り直されるため、付けた要素には「何の欄か」（data-paper-key）を書いておき、
 * フォーカスしていた欄は、新しい紙面の同じ印の要素に移し直す。
 * 目印（藍色の枠）は index.css。キーボードで移ったときだけ出す（:focus-visible）。
 */

const KEY_ATTR = 'data-paper-key'

/** Tab で止まる紙面の要素 */
export const PAPER_FOCUSABLE = `[${KEY_ATTR}]`

/** 表紙の項目の、読み上げ用の名前 */
const FIELD_NAMES: Record<string, string> = {
  'basic:studentId': '学籍番号',
  'basic:name': '氏名',
  'basic:subtitleInput': 'サブタイトル',
  'basic:course': 'コース',
}

/** 「図1.」「表2.」の番号から、「図1」「表2」 */
function numberLabel(el: Element | null | undefined, fallback: string): string {
  const text = el?.textContent?.trim().replace(/[.．]$/, '')
  return text || fallback
}

/** 読み上げで伝える、欄の中の文。空なら、まだ書いていないこと（段落は、ひな形の「何を書くか」も） */
function contentOf(el: HTMLElement): string {
  const text = (el.textContent ?? '').replace(/\s*\n\s*/g, ' ').trim()
  if (text) return text
  const hint = el.tagName === 'P' ? el.dataset.placeholder : undefined
  return hint && !hint.includes('クリック') ? `まだ書いていません${hint}` : 'まだ書いていません'
}

/** 書ける欄（data-block-id の要素）の、読み上げ用の名前 */
function blockName(el: HTMLElement, id: string): string {
  if (FIELD_NAMES[id]) return FIELD_NAMES[id]
  if (el.closest('section.abstract')) return '抄録の段落'
  if (el.tagName === 'P') return '本文の段落'
  if (el.closest('h1')) return '大見出し'
  if (el.closest('h2')) return '小見出し'
  const caption = el.closest('figcaption, .table-caption')
  if (caption) return `${numberLabel(caption.querySelector('.num'), caption.matches('figcaption') ? '図' : '表')}のタイトル`
  return '書く欄'
}

/**
 * Tab で止まる印と、読み上げ用の名前（label）を付ける。押す（Enter）と、書き始める・選ぶ・コースの一覧を開くなどをするので、ボタンとして読ませる。
 * 表のセルは、表の読み上げ（何行目・何列目か）が使えるよう、セルのまま（button にしない）にし、どの表のセルかを説明（description）で添える
 */
function mark(el: HTMLElement, key: string, how: { label?: string; description?: string; keepRole?: boolean } = {}): void {
  // Tab で紙面に入ったときに止まる欄は、あとで1つだけ決める（setTabStop）
  el.tabIndex = -1
  el.setAttribute(KEY_ATTR, key)
  if (!how.keepRole) el.setAttribute('role', 'button')
  if (how.label) el.setAttribute('aria-label', how.label)
  if (how.description) el.setAttribute('aria-description', how.description)
}

/** 表に出した紙面（viewport）の欄に、Tab で止まる印と読み上げ用の名前を付ける */
export function markFocusable(viewport: HTMLElement): void {
  for (const el of viewport.querySelectorAll<HTMLElement>('[data-block-id]')) {
    const id = el.dataset.blockId!
    if (el.classList.contains('page-break')) {
      mark(el, `pb:${id}`, { label: '改ページの印' })
      continue
    }
    // 表のセルは、セル全体（画像の入ったセルも）に移る
    const cell = el.closest<HTMLElement>('[data-cell-id]')
    if (cell) {
      const tableId = cell.closest<HTMLElement>('.data-table')?.dataset.tableId
      const caption = tableId ? viewport.querySelector(`.data-table[data-table-id="${CSS.escape(tableId)}"] .table-caption .num`) : null
      mark(cell, `b:${id}`, { keepRole: true, description: `${numberLabel(caption, '表')}の${cell.tagName === 'TH' ? '見出しのセル' : 'セル'}` })
      continue
    }
    // 名前（氏名・本文の段落など）のあとに、中の文も入れる（名前だけにすると、紙面を読み上げたときに文が読まれなくなる）
    mark(el, `b:${id}`, { label: `${blockName(el, id)}：${contentOf(el)}` })
  }
  // 図：写真の部分に移る（下のタイトルは、別の欄として移る）。目印は図全体に付ける（index.css）
  for (const el of viewport.querySelectorAll<HTMLElement>('figure[data-figure-id] > img, figure[data-figure-id] > .figure-slot')) {
    const figure = el.parentElement!
    const name = numberLabel(figure.querySelector('figcaption .num'), '図')
    mark(el, `f:${figure.dataset.figureId}`, { label: figure.hasAttribute('data-empty-figure') ? `${name}（写真を入れる枠）` : name })
  }
  for (const el of viewport.querySelectorAll<HTMLElement>('[data-photo-slot]')) {
    const n = Number(el.dataset.photoSlot) + 1
    mark(el, `ph:${el.dataset.photoSlot}`, { label: `作品写真の${n}枚目${el.querySelector('img') ? '' : '（空いている枠）'}` })
  }
  // 「先生の許可が出た（抄録を書き始める）」は、書いてある文がそのまま名前になる
  for (const el of viewport.querySelectorAll<HTMLElement>('[data-abstract-start]')) mark(el, 'abstract-start')
  for (const el of viewport.querySelectorAll<HTMLElement>('section.references')) mark(el, 'references', { label: `引用・参考文献：${contentOf(el).replace(/^引用・参考文献\s*/, '')}` })
}

/** 紙面の欄の「何の欄か」（Tab で止まる要素でなければ null） */
export function paperKeyOf(el: Element | null): string | null {
  return el instanceof HTMLElement ? el.getAttribute(KEY_ATTR) : null
}

/** 書ける欄（ブロック ID）の「何の欄か」 */
export function blockPaperKey(blockId: string): string {
  return `b:${blockId}`
}

/** ページの中の、key の欄 */
export function paperElement(page: HTMLElement | undefined, key: string): HTMLElement | null {
  return page?.querySelector<HTMLElement>(`[${KEY_ATTR}="${CSS.escape(key)}"]`) ?? null
}

/** ページの欄を、紙面の上から順（同じ高さなら左から）に並べる。見えていない欄（書いている最中で隠している欄など）は除く */
export function paperOrder(page: HTMLElement | undefined): HTMLElement[] {
  if (!page) return []
  const items = [...page.querySelectorAll<HTMLElement>(PAPER_FOCUSABLE)]
    .filter((el) => getComputedStyle(el).visibility !== 'hidden')
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 || r.height > 0)
  // 上端の差が 3px 未満なら同じ高さ（表の同じ行のセルなど）とみなし、左から
  items.sort((a, b) => (Math.abs(a.r.top - b.r.top) >= 3 ? a.r.top - b.r.top : a.r.left - b.r.left))
  return items.map((x) => x.el)
}

/** Tab で紙面に入ったときに止まる欄を、ページの中で el だけにする */
export function setTabStop(page: Element | null | undefined, el: HTMLElement | null): void {
  for (const x of page?.querySelectorAll<HTMLElement>(PAPER_FOCUSABLE) ?? []) x.tabIndex = x === el ? 0 : -1
}

/** 紙面の欄にフォーカスが来た（Tab・クリック・組み直したあと）：次に Tab で紙面に入ったときは、この欄に止まる */
export function rememberTabStop(target: EventTarget | null): void {
  if (target instanceof HTMLElement && target.matches(PAPER_FOCUSABLE)) setTabStop(target.closest('[data-vivliostyle-page-container]'), target)
}
