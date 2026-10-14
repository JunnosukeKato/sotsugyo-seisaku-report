import { headingFromText, isPlaceholderOnly, parseCaptionLine } from '../import/wordImport'
import { attr, child, elements, is } from '../import/wordDocument'
import type { CheckFinding, PartId } from './parts'

/**
 * 提出前チェック：Word のページ設定が、学科のひな形のままか（手順書「ページ設定・文字数・文字の大きさについて」）。
 * - 余白（w:pgMar）：本文・抄録・目次は 上・下・右 25mm、左 35mm。表紙のひな形は 上下左右 25mm
 * - 文字数と行数（w:docGrid）：「文字数と行数を指定する」と、ひな形の行送り（linePitch）・字送り（charSpace）
 * - 文字の大きさ：本文は 11pt、抄録の本文は 10.5pt（本文の段落の、いちばん多い大きさで見る）
 * 値は、学科のひな形（01_表紙.docx〜04_本文.docx の w:sectPr とスタイル）から写したもの。ずれは ±1mm まで見逃す
 */

type WordPart = Exclude<PartId, 'photo'>

interface Template {
  /** 上・右・下・左（twip。1mm ≒ 56.7） */
  margins: [number, number, number, number]
  /** 文字数と行数（行送り・字送りは Word の値。chars×lines は、ページ設定の画面に出る数） */
  grid?: { linePitch: number; charSpace: number; chars: number; lines: number }
  /** 本文の文字の大きさ（半ポイント。22＝11pt） */
  fontHalfPt?: number
}

export const TEMPLATES: Record<WordPart, Template> = {
  cover: { margins: [1418, 1418, 1418, 1418] },
  abstract: { margins: [1418, 1418, 1418, 1985], grid: { linePitch: 460, charSpace: 527, chars: 40, lines: 30 }, fontHalfPt: 21 },
  toc: { margins: [1418, 1418, 1418, 1985], grid: { linePitch: 368, charSpace: 770, chars: 38, lines: 38 } },
  body: { margins: [1418, 1418, 1418, 1985], grid: { linePitch: 368, charSpace: 770, chars: 38, lines: 38 }, fontHalfPt: 22 },
}

/** 余白の見逃す幅（1mm） */
const MARGIN_TOLERANCE = 57
/** 行送り（twip）・字送り（1/4096pt）の見逃す幅（1行・1字の数がずれない程度） */
const PITCH_TOLERANCE = 4
const CHAR_SPACE_TOLERANCE = 120

const toMm = (twip: number) => Math.round(twip / 56.7)
const SIDES = ['上', '右', '下', '左'] as const

/** 本文の w:sectPr（区切りごとに1つ。最後のものは w:body の直下、ほかは段落の w:pPr の中） */
function sections(document: Document): Element[] {
  const body = elements(document.documentElement).find((e) => is(e, 'w', 'body'))
  if (!body) return []
  const found: Element[] = []
  const walk = (el: Element) => {
    for (const c of elements(el)) {
      if (is(c, 'w', 'sectPr')) found.push(c)
      else if (is(c, 'w', 'p')) {
        const s = child(child(c, 'w', 'pPr'), 'w', 'sectPr')
        if (s) found.push(s)
      } else if (is(c, 'w', 'sdt') || is(c, 'w', 'sdtContent') || is(c, 'w', 'customXml')) walk(c)
    }
  }
  walk(body)
  return found
}

const num = (el: Element | undefined, name: string): number | null => {
  const v = attr(el, name)
  return v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v)
}

// ---- 文字の大きさ ----

interface StyleRun {
  basedOn: string | null
  size: number | null
  type: string
  isDefault: boolean
}

function styleTable(styles: Document | null): { styles: Map<string, StyleRun>; docDefault: number | null } {
  const map = new Map<string, StyleRun>()
  let docDefault: number | null = null
  if (!styles) return { styles: map, docDefault }
  for (const el of elements(styles.documentElement)) {
    if (is(el, 'w', 'docDefaults')) docDefault = num(child(child(child(el, 'w', 'rPrDefault'), 'w', 'rPr'), 'w', 'sz'), 'val')
    if (!is(el, 'w', 'style')) continue
    const id = attr(el, 'styleId')
    if (!id) continue
    map.set(id, {
      basedOn: attr(child(el, 'w', 'basedOn'), 'val'),
      size: num(child(child(el, 'w', 'rPr'), 'w', 'sz'), 'val'),
      type: attr(el, 'type') ?? 'paragraph',
      isDefault: ['1', 'true', 'on'].includes(attr(el, 'default') ?? ''),
    })
  }
  return { styles: map, docDefault }
}

/** スタイルに書いた大きさ（もとにしたスタイルもたどる） */
function styleSize(table: Map<string, StyleRun>, id: string | null): number | null {
  for (let depth = 0; id && depth < 10; depth++) {
    const s = table.get(id)
    if (!s) return null
    if (s.size !== null) return s.size
    id = s.basedOn
  }
  return null
}

/**
 * 本文の段落（見出し・図表のタイトル・仮の文字の行・表と文字の枠の中を除く）の、文字の大きさごとの字数（半ポイント → 字数）。
 * 大きさの分からない字は数えない
 */
export function bodyFontSizes(document: Document, stylesDoc: Document | null, isBodyText: (text: string) => boolean = defaultBodyText): Map<number, number> {
  const { styles, docDefault } = styleTable(stylesDoc)
  const defaultParagraph = [...styles.entries()].find(([, s]) => s.type === 'paragraph' && s.isDefault)?.[0] ?? null
  const sizes = new Map<number, number>()
  const body = elements(document.documentElement).find((e) => is(e, 'w', 'body'))
  if (!body) return sizes
  for (const p of elements(body).filter((e) => is(e, 'w', 'p'))) {
    const pStyle = attr(child(child(p, 'w', 'pPr'), 'w', 'pStyle'), 'val') ?? defaultParagraph
    const paragraphSize = styleSize(styles, pStyle) ?? styleSize(styles, defaultParagraph) ?? docDefault
    const runs: { text: string; size: number | null }[] = []
    const readRuns = (node: Element) => {
      for (const el of elements(node)) {
        if (is(el, 'w', 'r')) {
          const rPr = child(el, 'w', 'rPr')
          if (child(rPr, 'w', 'vanish')) continue
          const text = elements(el)
            .filter((t) => is(t, 'w', 't'))
            .map((t) => t.textContent ?? '')
            .join('')
          const size = num(child(rPr, 'w', 'sz'), 'val') ?? styleSize(styles, attr(child(rPr, 'w', 'rStyle'), 'val')) ?? paragraphSize
          if (text) runs.push({ text, size })
        } else if (is(el, 'w', 'hyperlink') || is(el, 'w', 'ins') || is(el, 'w', 'smartTag') || is(el, 'w', 'sdt') || is(el, 'w', 'sdtContent') || is(el, 'w', 'customXml')) readRuns(el)
      }
    }
    readRuns(p)
    const text = runs.map((r) => r.text).join('')
    if (!isBodyText(text)) continue
    for (const r of runs) {
      if (r.size === null) continue
      const chars = r.text.replace(/[\s　]/g, '').length
      if (chars) sizes.set(r.size, (sizes.get(r.size) ?? 0) + chars)
    }
  }
  return sizes
}

/** 本文の段落か（見出し・図表のタイトル・仮の文字だけの行・短い行は除く） */
function defaultBodyText(text: string): boolean {
  const t = text.trim()
  return t.length >= 20 && !headingFromText(t) && !parseCaptionLine(t) && !isPlaceholderOnly(t)
}

/** いちばん多い大きさ（半ポイント）。本文の字が少なすぎる（100字まで）ときは null */
export function mainFontSize(sizes: Map<number, number>): number | null {
  const total = [...sizes.values()].reduce((a, b) => a + b, 0)
  if (total < 100) return null
  return [...sizes.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

const pt = (halfPt: number) => `${halfPt / 2}`.replace(/\.0$/, '')

// ---- 指摘 ----

/**
 * ひな形のページ設定と違うところ（エラー・手順書）。document・styles は Word の中の XML（wordPackage.ts で開いたもの）。
 * abstractBody：抄録の本文の段落か（抄録は、上の決まった行が 10pt なので、本文の段落だけで大きさを見る）
 */
export function templateFindings(part: WordPart, document: Document, styles: Document | null, abstractBody?: (text: string) => boolean): CheckFinding[] {
  const template = TEMPLATES[part]
  const out: CheckFinding[] = []
  const add = (ruleId: string, title: string, detail: string) => out.push({ id: `docx:${part}:${ruleId}`, ruleId, part, severity: 'error', source: 'guide', title, detail })
  const list = sections(document)
  // 余白
  const wrong = new Map<string, number>()
  for (const sect of list) {
    const pgMar = child(sect, 'w', 'pgMar')
    const values = [num(pgMar, 'top'), num(pgMar, 'right'), num(pgMar, 'bottom'), num(pgMar, 'left')]
    values.forEach((v, i) => {
      // 上下の余白は、ヘッダー・フッターに合わせて負の値（固定）にすることがあるので、大きさで比べる
      if ((v === null || Math.abs(Math.abs(v) - template.margins[i]) > MARGIN_TOLERANCE) && !wrong.has(SIDES[i])) wrong.set(SIDES[i], v === null ? NaN : Math.abs(v))
    })
  }
  if (list.length && wrong.size) {
    const want = part === 'cover' ? '上下左右 25mm' : '上・下・右 25mm、左 35mm'
    const now = [...wrong.entries()].map(([side, v]) => `${side} ${Number.isNaN(v) ? '（なし）' : `${toMm(v)}mm`}`).join('・')
    add('template-margins', `余白は、ひな形のまま（${want}）にする`, `今は ${now}。Word の「レイアウト → ページ設定」の「余白」で直す`)
  }
  // 文字数と行数
  const grid = template.grid
  if (grid && list.length) {
    const ok = list.every((sect) => {
      const g = child(sect, 'w', 'docGrid')
      return attr(g, 'type') === 'linesAndChars' && Math.abs((num(g, 'linePitch') ?? 0) - grid.linePitch) <= PITCH_TOLERANCE && Math.abs((num(g, 'charSpace') ?? 0) - grid.charSpace) <= CHAR_SPACE_TOLERANCE
    })
    if (!ok)
      add(
        'template-grid',
        `文字数と行数は、ひな形のまま（${grid.chars}字×${grid.lines}行）にする`,
        `Word の「レイアウト → ページ設定」の「文字数と行数」で、「文字数と行数を指定する」にして ${grid.chars}字・${grid.lines}行にする`,
      )
  }
  // 文字の大きさ
  if (template.fontHalfPt) {
    const size = mainFontSize(bodyFontSizes(document, styles, part === 'abstract' ? abstractBody : undefined))
    if (size !== null && size !== template.fontHalfPt)
      add('template-font-size', `${part === 'abstract' ? '抄録の本文' : '本文'}の文字の大きさは ${pt(template.fontHalfPt)}ポイントにする`, `今は ${pt(size)}ポイント。文字を選んで、「ホーム」の文字の大きさを ${pt(template.fontHalfPt)} にする`)
  }
  return out
}
