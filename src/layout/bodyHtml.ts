import { colWidthsOf, equalColumnWidths } from '../model/table'
import type { BodyBlock, Chapter, Figure, TableBlock, TableCell } from '../model/types'
import { FONT_SIZE_PT, LETTER_SPACING_PT, reportCss } from './reportCss'
import { equalRows, fitsLabel, ptText, type TableFits } from './tableFit'

const CHAPTER_NUMERALS = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ']
const SUBHEADING_NUMERALS = ['ⅰ', 'ⅱ', 'ⅲ', 'ⅳ', 'ⅴ', 'ⅵ', 'ⅶ', 'ⅷ', 'ⅸ', 'ⅹ']

/** 大見出しの番号（Ⅰ．Ⅱ．…）。全角ピリオドはテンプレートどおり */
export function chapterLabel(index: number): string {
  return `${CHAPTER_NUMERALS[index] ?? String(index + 1)}．`
}

/** 小見出しの番号（ⅰ．ⅱ．…）。章ごとに振り直す */
export function subheadingLabel(index: number): string {
  return `${SUBHEADING_NUMERALS[index] ?? String(index + 1)}．`
}

/** 図表のタイトル。手順書の形式「図1.デザイン画」 */
export function figureCaption(kind: '図' | '表', number: number, name: string): string {
  return `${kind}${number}.${name}`
}

export interface FigureSize {
  widthMm: number
  heightMm: number
}

export interface BodyRenderOptions {
  /** 画像 ID から表示用 URL を得る */
  imageSrc: (imageId: string) => string
  /** 図の表示サイズ */
  figureSize: (figure: Figure) => FigureSize
  /** 次のページの上へ送る図のまとまり（figureRow の ID）。選び方は figureFloat.ts */
  deferredGroups?: ReadonlySet<string>
  /** 表の行の高さ・左端の列の幅（行の高さを「そろえる」・左端の列を「中身に合わせる」表だけ。組んだ紙面で測ったもの：tableFit.ts） */
  tableFits?: TableFits
}

/** 図・表の番号を本文の出現順に振る。参照（図n）の解決にも使う */
export function numberFiguresAndTables(chapters: Chapter[]): Map<string, number> {
  const numbers = new Map<string, number>()
  let figure = 0
  let table = 0
  for (const chapter of chapters) {
    for (const block of chapter.blocks) {
      if (block.type === 'figureRow') {
        for (const f of block.figures) numbers.set(f.id, ++figure)
      } else if (block.type === 'table') {
        numbers.set(block.id, ++table)
      }
    }
  }
  return numbers
}

/** 図を横に並べる数（それより多いときは段を分ける：3枚は2＋1、4枚は2×2） */
export const FIGURES_PER_ROW = 2
/** 本文の幅（A4 の左右の余白を除く）と、横に並べるときの図の間のすき間・1枚の幅の上限 */
const TEXT_WIDTH_MM = 150
const FIGURE_GAP_MM = 8
const PAIR_MAX_MM = 72

/**
 * 横に並べる図の大きさ。1枚ならその図の大きさのまま、2枚なら高さをそろえ、本文の幅に収まるよう縮める
 */
export function rowSizes(sizes: FigureSize[]): FigureSize[] {
  if (sizes.length < 2) return sizes
  const ratios = sizes.map((s) => s.widthMm / s.heightMm)
  const height = Math.min(PAIR_MAX_MM, (TEXT_WIDTH_MM - FIGURE_GAP_MM * (sizes.length - 1)) / ratios.reduce((a, b) => a + b, 0), PAIR_MAX_MM / Math.max(...ratios))
  return ratios.map((r) => ({ widthMm: Math.round(r * height * 10) / 10, heightMm: Math.round(height * 10) / 10 }))
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

function renderBlock(block: BodyBlock, numbers: Map<string, number>, tableIds: Set<string>, options: BodyRenderOptions): string {
  switch (block.type) {
    case 'subheading':
      return '' // 番号付けのため renderChapter で処理する
    case 'paragraph': {
      const text = block.content
        .map((node) => {
          if (node.type === 'text') return escapeHtml(node.text)
          const label = `${tableIds.has(node.targetId) ? '表' : '図'}${numbers.get(node.targetId) ?? '?'}`
          // 「（図1）」は行の終わりで「（図」と「1）」に分かれないよう、ひとまとまりにする
          return `<span class="fig-ref">${node.withParens ? `（${label}）` : label}</span>`
        })
        .join('')
      // 空の段落には、ひな形の「ここに何を書くか」の説明（なければ操作の案内）を薄く出す（画面だけ）
      const placeholder = block.hint ? `（${block.hint}）` : '（クリックして文章を入力）'
      return `<p data-block-id="${escapeHtml(block.id)}" data-placeholder="${escapeHtml(placeholder)}">${text}</p>`
    }
    case 'figureRow': {
      // 図のまとまり：2枚ずつの段に分けて並べる（最後の段が1枚なら中央）
      const rows: Figure[][] = []
      for (let i = 0; i < block.figures.length; i += FIGURES_PER_ROW) rows.push(block.figures.slice(i, i + FIGURES_PER_ROW))
      let previousHeight = Infinity
      const rowHtml = rows.map((row) => {
        let sizes = rowSizes(row.map((f) => options.figureSize(f)))
        // 2＋1 のように最後の段が1枚のときは、上の段より大きくならないよう高さをそろえる
        if (sizes.length === 1 && sizes[0].heightMm > previousHeight) {
          const k = previousHeight / sizes[0].heightMm
          sizes = [{ widthMm: Math.round(sizes[0].widthMm * k * 10) / 10, heightMm: previousHeight }]
        }
        previousHeight = Math.min(...sizes.map((s) => s.heightMm))
        return `<div class="figure-row">${row.map((f, k) => renderFigure(f, sizes[k], numbers.get(f.id)!, options)).join('')}</div>`
      })
      const deferred = options.deferredGroups?.has(block.id) ? ' deferred' : ''
      return `<div class="figure-group${deferred}" data-group-id="${escapeHtml(block.id)}">${rowHtml.join('')}</div>`
    }
    case 'table':
      return renderTable(block, numbers.get(block.id)!, options)
    case 'pageBreak':
      // 画面では「改ページ」の印を出す（印は画面だけ。index.css）
      return `<div class="page-break" data-block-id="${escapeHtml(block.id)}"></div>`
  }
}

function renderFigure(f: Figure, size: FigureSize, number: number, options: BodyRenderOptions): string {
  const style = `width:${size.widthMm}mm;height:${size.heightMm}mm`
  // ひな形で用意した、まだ写真を入れていない枠は、クリックして写真を選ぶ枠にする
  const picture = f.imageId ? `<img src="${escapeHtml(options.imageSrc(f.imageId))}" style="${style}" alt="">` : `<div class="figure-slot" style="${style}"></div>`
  return `<figure data-figure-id="${escapeHtml(f.id)}"${f.imageId ? '' : ' data-empty-figure'}>${picture}<figcaption>${captionHtml('図', number, f.caption, f.id)}</figcaption></figure>`
}

/**
 * 表：タイトルは表の上。1行目は見出しの行。セルの画像は文字の上に、セルの幅に合わせて縮めて置く。
 * 列の幅は「そろえる（同じ幅）」か「中身に合わせる」。
 * 行の高さを「そろえる」表は、見出しの行のほかの行に、組んだ紙面で測った高さを書く（tableFit.ts。測る前は中身に合わせた高さ）。
 * 行の高さを「写真が入る高さ」にした表は、印の class（heights-photo）だけ付ける（高さは reportCss.ts。測らない）。
 * 左端の列を「中身に合わせる」表（列の幅が「そろえる」のときだけ）は、左端の列に、組んだ紙面で測った幅を書く（ほかの列は残りを同じ幅で分ける）。
 * どちらも、しない表の HTML は前と同じ（印の class も付けない）。
 * 列の幅を「自分で決める」表は、列ごとの幅（%）を colgroup に書く（table-layout: fixed。紙面・PDF・印刷とも同じ幅）
 */
function renderTable(block: TableBlock, number: number, options: BodyRenderOptions): string {
  // 列の幅「中身に合わせる」：短い字のセルは折り返さない（.nw。reportCss.ts）
  const limit = block.widths === 'auto' ? noWrapLimit(Math.max(1, ...block.rows.map((r) => r.cells.length))) : 0
  const cellHtml = (cell: TableCell, header: boolean) => {
    const tag = header ? 'th' : 'td'
    const img = cell.imageId ? `<img src="${escapeHtml(options.imageSrc(cell.imageId))}" alt="">` : ''
    const placeholder = header ? '（見出し）' : '（クリックして入力）'
    const nw = limit > 0 && shortText(cell.text, limit) ? ' class="nw"' : ''
    return `<${tag} data-cell-id="${escapeHtml(cell.id)}"${nw}>${img}<span data-block-id="${escapeHtml(cell.id)}" data-placeholder="${placeholder}">${escapeHtml(cell.text)}</span></${tag}>`
  }
  const [head, ...body] = block.rows
  const fit = options.tableFits?.[block.id]
  const rows = equalRows(block)
  const label = fitsLabel(block)
  // 印の class（測る前の紙面も、「中身に合わせる」の紙面と別の文書になるように）
  const widths = block.widths === 'auto' ? 'auto' : block.widths === 'custom' ? 'custom' : 'equal'
  const classes = [`widths-${widths}`, ...(rows ? ['heights-equal'] : []), ...(block.heights === 'photo' ? ['heights-photo'] : []), ...(label ? ['label-column'] : [])].join(' ')
  const custom = widths === 'custom' ? (colWidthsOf(block) ?? equalColumnWidths(Math.max(1, ...block.rows.map((r) => r.cells.length)))) : null
  const colgroup = custom
    ? `<colgroup>${custom.map((w) => `<col style="width:${w}%">`).join('')}</colgroup>`
    : label && fit?.label
      ? `<colgroup><col style="width:${ptText(fit.label)}"></colgroup>`
      : ''
  const tr = rows && fit?.row ? `<tr style="height:${ptText(fit.row)}">` : '<tr>'
  const thead = head ? `<thead><tr>${head.cells.map((c) => cellHtml(c, true)).join('')}</tr></thead>` : ''
  const tbody = `<tbody>${body.map((r) => `${tr}${r.cells.map((c) => cellHtml(c, false)).join('')}</tr>`).join('')}</tbody>`
  return `<div class="data-table" data-table-id="${escapeHtml(block.id)}"><p class="table-caption">${captionHtml('表', number, block.caption, block.id)}</p><table class="${classes}">${colgroup}${thead}${tbody}</table></div>`
}

/** 表のセルの左右の余白と枠線（pt。reportCss.ts の .data-table th, td） */
const CELL_CHROME_PT = 4 * 2 + 0.75

/**
 * 列の幅「中身に合わせる」の表で、折り返さないセルの字数の上限（全角の字の数）。どの列のセルもこの字数までなら、表の幅（本文の幅）に入る。
 * 前は、長い字の列に幅を取られた列が、「使用箇／所」「コットンサテ／ン」のように1字だけの行を作っていた（依頼者が嫌う）。
 * この字数までのセルは折り返さないので、その列はその字の幅より狭くならず、長い字の列が折り返しを受け持つ。
 * 例：2列 18字・3列 11字・4列 8字・6列 5字
 */
export function noWrapLimit(columns: number): number {
  const widthPt = (TEXT_WIDTH_MM / 25.4) * 72
  return Math.max(1, Math.floor((widthPt - columns * CELL_CHROME_PT) / ((FONT_SIZE_PT + LETTER_SPACING_PT) * columns)))
}

/**
 * 折り返さないセルか：字があり、どの行（改行で分けた行）も limit 字まで（半角は半分と数える）。
 * 行の頭・終わりの空白や、続いた空白のある字は除く（折り返さないセルは空白をそのまま出すので、見た目が変わらないように）
 */
export function shortText(text: string, limit: number): boolean {
  if (!text.trim()) return false
  return text.split('\n').every((line) => {
    if (/^\s|\s$|\s{2}/.test(line)) return false
    let units = 0
    for (const ch of line) units += /[ -~｡-ﾟ]/.test(ch) ? 0.5 : 1
    return units <= limit
  })
}

/**
 * 番号（自動）と、学生が入力した部分を分けて出力する。
 * 入力部分には data-block-id を付け、紙面上で編集する箇所を特定できるようにする。
 */
function labeledHtml(label: string, text: string, blockId: string, placeholder = '（クリックして入力）'): string {
  return `<span class="num">${escapeHtml(label)}</span><span data-block-id="${escapeHtml(blockId)}" data-placeholder="${escapeHtml(placeholder)}">${escapeHtml(text)}</span>`
}

function captionHtml(kind: '図' | '表', number: number, name: string, blockId: string): string {
  const full = figureCaption(kind, number, name)
  return labeledHtml(full.slice(0, full.length - name.length), name, blockId, `（${kind}のタイトルを入力）`)
}

function renderChapter(chapter: Chapter, index: number, numbers: Map<string, number>, tableIds: Set<string>, options: BodyRenderOptions): string {
  let subIndex = 0
  const blocks = chapter.blocks
    .map((block, i) =>
      block.type === 'subheading'
        ? `<h2 class="subheading">${labeledHtml(subheadingLabel(subIndex++), block.title, block.id)}</h2>`
        : // 章のいちばん最後の改ページ：次の章（または本文の終わり）はもう次のページから始まるので、改ページはしない（印だけ出す）。
          // 前は改ページが2つ重なって、何も書けない空のページができていた（先生の試し 2026-10-21）
          block.type === 'pageBreak' && i === chapter.blocks.length - 1
          ? `<div class="page-break end" data-block-id="${escapeHtml(block.id)}"></div>`
          : renderBlock(block, numbers, tableIds, options),
    )
    .join('\n')
  // 章の終わりの目印（高さなし）：組版エンジンは、次のページへ切り替わる直前（次の章の前・本文の終わり）の要素が入りきらないとき、
  // 次のページへ送らずにページからはみ出させることがある。目印を置き、図や表がその「直前の要素」にならないようにする
  return `<h1 class="chapter" id="${chapterAnchor(chapter.id)}">${labeledHtml(chapterLabel(index), chapter.title, chapter.id)}</h1>\n${blocks}\n<div class="flow-end"></div>`
}

/** 目次からページ番号を参照するための、大見出しの id */
export function chapterAnchor(chapterId: string): string {
  return `ch-${chapterId.replace(/[^A-Za-z0-9_-]/g, '_')}`
}

/** 本文（大見出し以下）の HTML。報告書全体の文書にも、本文だけの文書にも使う */
export function bodyContentHtml(chapters: Chapter[], options: BodyRenderOptions): string {
  return chapterHtmls(chapters, options).join('\n')
}

/** 章ごとの HTML（図・表の番号は本文全体で振る）。つなぐと bodyContentHtml と同じ */
export function chapterHtmls(chapters: Chapter[], options: BodyRenderOptions): string[] {
  const numbers = numberFiguresAndTables(chapters)
  const tableIds = new Set(chapters.flatMap((c) => c.blocks).filter((b) => b.type === 'table').map((b) => b.id))
  return chapters.map((c, i) => renderChapter(c, i, numbers, tableIds, options))
}

/**
 * 章を分けて組むとき、章の終わりに置く「次の章の始まり」の代わり（改ページして始まる大見出し。番号と題は次の章と同じ。
 * 書く欄の印（data-block-id）や目次の行き先（id）は付けない）。
 * 本文全体を組んだときと同じく、章の終わりの直後が改ページになるようにする（reportRenderer.ts。代わりの見出しのページは表示しない）
 */
export function chapterSentinelHtml(chapter: Chapter, index: number): string {
  return `<h1 class="chapter" data-sentinel=""><span class="num">${escapeHtml(chapterLabel(index))}</span><span>${escapeHtml(chapter.title)}</span></h1>`
}

/** 本文ページだけの HTML 文書（組版エンジンに渡す）を作る */
export function buildBodyDocument(chapters: Chapter[], options: BodyRenderOptions): string {
  const body = bodyContentHtml(chapters, options)
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>本文</title>
<style>${reportCss}</style>
</head>
<body>
${body}
</body>
</html>`
}
