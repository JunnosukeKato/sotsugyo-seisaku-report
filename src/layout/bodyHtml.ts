import type { BodyBlock, Chapter, Figure, MaterialTableBlock } from '../model/types'
import { reportCss } from './reportCss'

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
  /** 素材表の生地見本のサイズ */
  swatchSize?: FigureSize
  /** 次のページの上へ送る図のまとまり（figureRow の ID）。選び方は figureFloat.ts */
  deferredGroups?: ReadonlySet<string>
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
      } else if (block.type === 'materialTable') {
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
          return node.withParens ? `（${label}）` : label
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
    case 'materialTable':
      return renderMaterialTable(block, numbers.get(block.id)!, options)
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

function renderMaterialTable(block: MaterialTableBlock, number: number, options: BodyRenderOptions): string {
  const swatch = options.swatchSize ?? { widthMm: 35, heightMm: 32 }
  const rows = block.rows
    .map((row) => {
      const img = row.swatchImageId
        ? `<img src="${escapeHtml(options.imageSrc(row.swatchImageId))}" style="width:${swatch.widthMm}mm;height:${swatch.heightMm}mm" alt="">`
        : ''
      const id = escapeHtml(row.id)
      return `<tr><td><span data-block-id="${id}:name" data-placeholder="（名称）">${escapeHtml(row.name)}</span></td><td><span data-block-id="${id}:usage" data-placeholder="（使用箇所）">${escapeHtml(row.usage)}</span></td><td class="swatch" data-swatch-row="${id}">${img}</td></tr>`
    })
    .join('')
  return `<div class="material-table"><p class="table-caption">${captionHtml('表', number, block.caption, block.id)}</p><table><thead><tr><th>名称</th><th>使用箇所</th><th>生地見本</th></tr></thead><tbody>${rows}</tbody></table></div>`
}

/**
 * 番号（自動）と、学生が入力した部分を分けて出力する。
 * 入力部分には data-block-id を付け、紙面上で編集する箇所を特定できるようにする。
 */
function labeledHtml(label: string, text: string, blockId: string): string {
  return `<span class="num">${escapeHtml(label)}</span><span data-block-id="${escapeHtml(blockId)}" data-placeholder="（クリックして入力）">${escapeHtml(text)}</span>`
}

function captionHtml(kind: '図' | '表', number: number, name: string, blockId: string): string {
  const full = figureCaption(kind, number, name)
  return labeledHtml(full.slice(0, full.length - name.length), name, blockId)
}

function renderChapter(chapter: Chapter, index: number, numbers: Map<string, number>, tableIds: Set<string>, options: BodyRenderOptions): string {
  let subIndex = 0
  const blocks = chapter.blocks
    .map((block) =>
      block.type === 'subheading'
        ? `<h2 class="subheading">${labeledHtml(subheadingLabel(subIndex++), block.title, block.id)}</h2>`
        : renderBlock(block, numbers, tableIds, options),
    )
    .join('\n')
  return `<h1 class="chapter" id="${chapterAnchor(chapter.id)}">${labeledHtml(chapterLabel(index), chapter.title, chapter.id)}</h1>\n${blocks}`
}

/** 目次からページ番号を参照するための、大見出しの id */
export function chapterAnchor(chapterId: string): string {
  return `ch-${chapterId.replace(/[^A-Za-z0-9_-]/g, '_')}`
}

/** 本文（大見出し以下）の HTML。報告書全体の文書にも、本文だけの文書にも使う */
export function bodyContentHtml(chapters: Chapter[], options: BodyRenderOptions): string {
  const numbers = numberFiguresAndTables(chapters)
  const tableIds = new Set(chapters.flatMap((c) => c.blocks).filter((b) => b.type === 'materialTable').map((b) => b.id))
  return chapters.map((c, i) => renderChapter(c, i, numbers, tableIds, options)).join('\n')
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
