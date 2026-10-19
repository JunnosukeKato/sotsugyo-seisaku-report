import type { YearConfig } from '../config'
import type { LayoutInfo } from '../layout/measure'
import type { ParagraphBlock, Report } from '../model/types'
import { abstractCharCount, type Area, type ReportFinding } from './reportChecks'

/**
 * セルフチェックの指摘を「まだのところ」と「直すところ」に分ける（mockups/v35 ① 案A）。
 * - まだのところ：まだ書いていない・入れていないだけのもの。決まった行の進み具合（灰色の ○、済むと緑の ✓、「あと2」）で見せ、赤くしない
 * - 直すところ：書いた文の間違い。今までどおり、エラー（赤）・要確認（黄）の一覧
 * 提出用の PDF の決まりは変えない（どちらに分けても、エラーが残っていれば提出用の PDF は書き出せない。app/ExportDialog.tsx）
 */

/**
 * まだのところに分ける規則（checker/reportChecks.ts の ruleId）。
 * - required-field：表紙の学籍番号・氏名・サブタイトル（・コース）が空
 * - body-pages：本文のページが足りない
 * - paragraph-empty：ひな形の段落（書くことの説明がある段落）を、まだ書いていない。説明のない空の段落（Enter を押して残ったもの）は直すところ
 * - photos-required：作品写真がまだ1枚もない
 * - abstract-not-started：抄録は先生の許可のあと（灰色の「先生の許可のあと」。まだの数にも数えない。提出用の PDF は今までどおり止める）
 * - abstract-length・abstract-lines：書き始めた抄録が、まだ短い（字数・行数が足りない）。多すぎるときは直すところ
 * - figure-image・swatch-image・table-cell-empty：図の枠・素材表の生地見本に、まだ写真を入れていない／表のセルがまだ空（ひな形の図の枠と素材表は、書き始めたときから空）
 * - figure-unreferenced・table-unreferenced：図表のすぐ前の、ひな形の段落をまだ書いていない（書いたのに「図1」がなければ、直すところ）
 */
export const NOT_YET_RULES = [
  'required-field',
  'body-pages',
  'paragraph-empty',
  'photos-required',
  'abstract-not-started',
  'abstract-length',
  'abstract-lines',
  'figure-image',
  'swatch-image',
  'table-cell-empty',
  'figure-unreferenced',
  'table-unreferenced',
] as const

export interface ProgressContext {
  report: Report
  config: YearConfig
  /** 組んだ紙面（まだ組み終えていなければ null） */
  layout?: LayoutInfo | null
}

/** まだ何も書いていない段落か（参照も文字もない） */
const blank = (p: ParagraphBlock) => p.content.every((n) => n.type === 'text' && !n.text.trim())

/** 指摘が「まだのところ」か（ほかは「直すところ」）を決める関数。ひな形の段落と抄録の字数は、はじめに1回だけ数える */
export function notYetTester(ctx: ProgressContext): (f: ReportFinding) => boolean {
  const { report, config, layout } = ctx
  const blocks = report.body.flatMap((c) => c.blocks)
  const templateParagraphs = new Set(blocks.flatMap((b) => (b.type === 'paragraph' && b.hint ? [b.id] : [])))
  // 図表（図は1つずつ、表は表ごと）の、すぐ前の段落が、まだ書いていないひな形の段落か
  const beforeUnwritten = new Set<string>()
  let previous: ParagraphBlock | null = null
  for (const b of blocks) {
    if (b.type === 'paragraph') previous = b
    const unwritten = !!previous?.hint && blank(previous)
    if (b.type === 'figureRow' && unwritten) b.figures.forEach((f) => beforeUnwritten.add(f.id))
    if (b.type === 'table' && unwritten) beforeUnwritten.add(b.id)
  }
  const abstractShort = abstractCharCount(report) < config.abstract.minChars
  const linesShort = !!layout && layout.abstractLines < config.abstract.minLines
  return (f) => {
    switch (f.ruleId) {
      case 'required-field':
      case 'body-pages':
      case 'photos-required':
      case 'abstract-not-started':
      case 'figure-image':
      case 'swatch-image':
      case 'table-cell-empty':
        return true
      case 'paragraph-empty':
        return !!f.blockId && templateParagraphs.has(f.blockId)
      case 'figure-unreferenced':
      case 'table-unreferenced':
        return !!f.blockId && beforeUnwritten.has(f.blockId)
      case 'abstract-length':
        return abstractShort
      case 'abstract-lines':
        return linesShort
      default:
        return false
    }
  }
}

/** 指摘を「まだのところ」と「直すところ」に分ける（並び順はそのまま） */
export function splitFindings(findings: ReportFinding[], ctx: ProgressContext): { notYet: ReportFinding[]; fixes: ReportFinding[] } {
  const test = notYetTester(ctx)
  const notYet: ReportFinding[] = []
  const fixes: ReportFinding[] = []
  for (const f of findings) (test(f) ? notYet : fixes).push(f)
  return { notYet, fixes }
}

/** todo：まだ（灰色の ○）、done：済んだ（緑の ✓）、wait：先生の許可のあと（点線の ○。数えない）、info：目安だけ（数えない）、pending：紙面を確かめている途中（数えない） */
export type ProgressState = 'todo' | 'done' | 'wait' | 'info' | 'pending'

/** 行を押したときに移る先：その指摘の箇所、またはその種類のページ（last：最後のページ） */
export type ProgressTarget = { kind: 'finding'; finding: ReportFinding } | { kind: 'area'; area: Area; last?: boolean }

export interface ProgressRow {
  id: 'cover' | 'bodyPages' | 'paragraphs' | 'figuresTables' | 'photos' | 'abstract' | 'figures'
  label: string
  state: ProgressState
  /** 右の字 */
  value: string
  /** value の後ろに太字で出す数（「あと2」の 2） */
  strong?: string
  /** 進み具合の棒（0〜1。まだのときだけ） */
  bar?: number
  target?: ProgressTarget
}

/** 表紙の項目の名前（必須の項目の指摘の blockId から） */
const COVER_FIELDS: Record<string, string> = { 'basic:studentId': '学籍番号', 'basic:name': '氏名', 'basic:subtitleInput': 'サブタイトル', 'basic:course': 'コース' }

/**
 * まだのところの行（表紙・本文のページ・本文の段落・（空いている所があれば）図・表・作品写真・抄録・図の枚数）。
 * findings はツールの指摘（セルフチェック）、pending は紙面を組み終えていない（ページ数のチェックをまだしていない）とき
 */
export function progressRows(findings: ReportFinding[], ctx: ProgressContext, pending = false): ProgressRow[] {
  const { report, config, layout } = ctx
  const test = notYetTester(ctx)
  const notYet = findings.filter(test)
  const of = (...ruleIds: string[]) => notYet.filter((f) => ruleIds.includes(f.ruleId))
  const at = (f: ReportFinding): ProgressTarget => ({ kind: 'finding', finding: f })
  const blocks = report.body.flatMap((c) => c.blocks)
  const rows: ProgressRow[] = []

  // 表紙
  const cover = of('required-field')
  if (cover.length) {
    const names = [...new Set(cover.map((f) => COVER_FIELDS[f.blockId ?? ''] ?? '項目'))]
    rows.push({ id: 'cover', label: '表紙', state: 'todo', value: `${names.join('・')}がまだ`, target: at(cover[0]) })
  } else rows.push({ id: 'cover', label: '表紙', state: 'done', value: '入れました', target: { kind: 'area', area: 'cover' } })

  // 本文のページ（足りないときは、本文の最後のページへ）
  const bodyPages = layout?.bodyPages ?? 0
  const min = config.body.minPages
  const lastBody: ProgressTarget = { kind: 'area', area: 'body', last: true }
  if (pending) rows.push({ id: 'bodyPages', label: '本文のページ', state: 'pending', value: '確かめています…', target: lastBody })
  else if (of('body-pages').length && bodyPages < min)
    rows.push({ id: 'bodyPages', label: '本文のページ', state: 'todo', value: `${bodyPages} / ${min}ページ　あと`, strong: String(min - bodyPages), bar: bodyPages / min, target: lastBody })
  else rows.push({ id: 'bodyPages', label: '本文のページ', state: 'done', value: `${bodyPages} / ${min}ページ`, target: lastBody })

  // 本文の段落（ひな形の段落を、まだ書いていない。何段落あっても1行。図表のすぐ前の段落を書いていないための「図1を入れる」も、ここに含める）
  const empty = of('paragraph-empty')
  if (empty.length) rows.push({ id: 'paragraphs', label: '本文の段落', state: 'todo', value: '書いていない段落 ', strong: String(empty.length), target: at(empty[0]) })
  else rows.push({ id: 'paragraphs', label: '本文の段落', state: 'done', value: 'すべて書きました', target: { kind: 'area', area: 'body' } })

  // 図・表：図の枠・素材表の生地見本に写真がない／表のセルが空（ひな形の図の枠・素材表など）。空いている所（枠・セル）の数。
  // 空いている所があるときだけ出す（mockups/v35 の6行には無い行。ひな形に図の枠・素材表があるコースで、書き始めから赤くしないため）
  const holes = of('figure-image', 'swatch-image', 'table-cell-empty')
  if (holes.length) {
    // 押したときは、本文の中でいちばん前の空いている所へ（指摘は、表のセル → 図の順に並んでいるため、並べ直す）
    const order = new Map<string, number>()
    for (const b of blocks) {
      if (b.type === 'figureRow') b.figures.forEach((f) => order.set(f.id, order.size))
      if (b.type === 'table') b.rows.forEach((row) => row.cells.forEach((c) => order.set(c.id, order.size)))
    }
    holes.sort((a, b) => (order.get(a.blockId ?? '') ?? 0) - (order.get(b.blockId ?? '') ?? 0))
    const count = new Set(holes.map((f) => f.blockId)).size
    rows.push({ id: 'figuresTables', label: '図・表', state: 'todo', value: '空いている所 ', strong: String(count), target: at(holes[0]) })
  }

  // 作品写真
  const photos = report.workPhotos.imageIds.slice(0, report.workPhotos.layout).filter(Boolean).length
  const noPhotos = of('photos-required')
  if (noPhotos.length) rows.push({ id: 'photos', label: '作品写真', state: 'todo', value: 'まだ', target: at(noPhotos[0]) })
  else rows.push({ id: 'photos', label: '作品写真', state: 'done', value: `${photos}枚`, target: { kind: 'area', area: 'photos' } })

  // 抄録（先生の許可の前は、灰色の「先生の許可のあと」。書き始めたら、字数・行数が足りない間は「あと」）
  const abstractArea: ProgressTarget = { kind: 'area', area: 'abstract' }
  const { minChars, minLines } = config.abstract
  const short = of('abstract-length')[0]
  const fewLines = of('abstract-lines')[0]
  if (report.abstract.started === false) rows.push({ id: 'abstract', label: '抄録', state: 'wait', value: '先生の許可のあと', target: abstractArea })
  else if (short) {
    const chars = abstractCharCount(report)
    rows.push({ id: 'abstract', label: '抄録', state: 'todo', value: `${chars} / ${minChars}字　あと`, strong: String(minChars - chars), bar: chars / minChars, target: at(short) })
  } else if (fewLines && layout) {
    const lines = layout.abstractLines
    rows.push({ id: 'abstract', label: '抄録', state: 'todo', value: `${lines} / ${minLines}行　あと`, strong: String(minLines - lines), bar: lines / minLines, target: at(fewLines) })
  } else rows.push({ id: 'abstract', label: '抄録', state: 'done', value: '書いています', target: abstractArea })

  // 図の枚数（目安だけ。多すぎるときは、直すところの「画像は1ページあたり…」）
  const figures = blocks.reduce((n, b) => n + (b.type === 'figureRow' ? b.figures.length : 0), 0)
  const figureMax = Math.max(1, bodyPages * config.body.imagesPerPageGuide)
  rows.push({ id: 'figures', label: '図の枚数', state: 'info', value: `${figures}枚（目安 ${figureMax}枚まで）` })
  return rows
}

/** まだのところの数（「まだ」の行の数。抄録の「先生の許可のあと」と図の枚数は数えない） */
export const notYetCount = (rows: ProgressRow[]): number => rows.filter((r) => r.state === 'todo').length

/**
 * 「PDFを書き出す」の下のひとこと。fix：直すところの数、notYet：まだのところの数、
 * pending：紙面を確かめている途中、abstractWaiting：抄録を先生の許可の前で、まだ書き始めていない（提出用の PDF は書き出せない）
 */
export function exportNote({ fix, notYet, pending, abstractWaiting }: { fix: number; notYet: number; pending: boolean; abstractWaiting: boolean }): string {
  if (fix > 0 && notYet > 0) return `直すところが${fix}つ、まだのところが${notYet}つあります`
  if (fix > 0) return `直すところが${fix}つあります`
  if (notYet > 0) return `まだのところが${notYet}つあります`
  if (pending) return '紙面を確かめています…'
  // 残っているのは、抄録（先生の許可のあと）だけ。提出用の PDF は、抄録を書いてから
  if (abstractWaiting) return '抄録を書くと、提出用のPDFを書き出せます'
  return '提出用のPDFを書き出せます'
}
