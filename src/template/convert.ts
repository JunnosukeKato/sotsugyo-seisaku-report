import { currentConfig, type Course, type TemplateBlock, type TemplateTable, type YearConfig } from '../config'
import { LIMITS, repairConfig, templateProblems, tooLong } from '../config/validate'
import { contentToText, numbering } from '../editor/reportOps'
import { chapterLabel, subheadingLabel } from '../layout/bodyHtml'
import { createReport } from '../model/newReport'
import { colWidthsOf, isPlainMaterialTable } from '../model/table'
import { bodyFromTemplate, DEFAULT_TEMPLATE, emptyParagraph } from '../model/template'
import type { Chapter, ParagraphBlock, Report, TableBlock } from '../model/types'
import type { InitPayload } from './protocol'

/**
 * ひな形 ⇄ ひな形を作る画面の原稿（mockups/v44 案A）。
 * ひな形を作る画面は、学生と同じ紙面で書く。原稿は学生の原稿と同じ形で、この画面の中（メモリ）だけに置く（保存しない）。
 * - 本文の段落の字 ＝ ひな形の「ここに書くこと」（学生には、空の段落に薄い字で出る）
 * - 抄録の段落の字 ＝ 抄録の書き出し例
 * - 図は空の枠、表は見出しの行（中身の行は学生が書く。行の数だけを持つ）、改ページはそのまま
 * - 表紙の項目・作品写真・引用参考文献は、ひな形に入らない
 */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * 管理ページから受け取った年度の設定を、紙面を組める形にする。崩れた項目（ない・形が違う）は、ツールに入っている初期値の項目にする
 * （管理ページで直している途中の設定でも、紙面が止まらないように）。コースは、ひな形を作るコースだけ
 */
export function templateConfig(payload: Pick<InitPayload, 'config' | 'courseId' | 'courseName'>): YearConfig {
  const raw: Record<string, unknown> = isObj(payload.config) ? payload.config : {}
  const base = currentConfig as unknown as Record<string, unknown>
  const merged: Record<string, unknown> = {}
  const same = (a: unknown, b: unknown) => a !== null && b !== null && typeof a === typeof b && Array.isArray(a) === Array.isArray(b)
  for (const [key, value] of Object.entries(base)) {
    const got = raw[key]
    if (isObj(value)) merged[key] = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, isObj(got) && same(got[k], v) ? got[k] : v]))
    else merged[key] = same(got, value) ? got : value
  }
  const found = Array.isArray(raw.courses) ? raw.courses.find((c) => isObj(c) && c.id === payload.courseId) : undefined
  const c: Record<string, unknown> = isObj(found) ? found : {}
  const course: Course = {
    id: payload.courseId,
    name: typeof c.name === 'string' ? c.name : payload.courseName,
    advisors: Array.isArray(c.advisors) ? c.advisors.filter((a): a is string => typeof a === 'string') : [],
    subtitleTemplate: typeof c.subtitleTemplate === 'string' && c.subtitleTemplate.includes('{input}') ? c.subtitleTemplate : '―{input}―',
  }
  return repairConfig({ ...(merged as unknown as YearConfig), courses: [course] })
}

/** 受け取ったひな形（空・形が崩れていれば標準のひな形。学生のツールと同じ：model/template.ts の courseTemplate） */
export function usableTemplate(template: TemplateBlock[]): TemplateBlock[] {
  return template.length > 0 && templateProblems(template).length === 0 ? template : DEFAULT_TEMPLATE
}

/** 抄録の書き出し例が空のとき、学生に出る例（年度の設定の書き出し例）を、ひな形を作る画面で薄く出す */
export function abstractPlaceholder(config: YearConfig): string {
  return `書き出しの例を入力。空のときは「${config.abstract.openingExample}」`
}

/** 本文の段落の説明（hint）を、段落の字にする（ひな形を作る画面では、説明を書く字として直す） */
function hintAsText(chapters: Chapter[]): Chapter[] {
  return chapters.map((c) => ({
    ...c,
    blocks: c.blocks.map((b) => {
      if (b.type !== 'paragraph') return b
      const paragraph: ParagraphBlock = { type: 'paragraph', id: b.id, content: [{ type: 'text', text: b.hint ?? '' }] }
      return paragraph
    }),
  }))
}

/** ひな形の本文（ひな形を作る画面の原稿の本文。段落の字は説明） */
export function templateBody(template: TemplateBlock[]): Chapter[] {
  return hintAsText(bodyFromTemplate(template.length > 0 ? template : DEFAULT_TEMPLATE))
}

/**
 * ひな形を作る画面の原稿を作る（学生の原稿ではない。表紙の学生の項目は空、抄録は書き始めたことにして、書き出し例を字として入れる）
 */
export function templateReport(config: YearConfig, courseId: string, template: TemplateBlock[], abstractExample: string): Report {
  const base = createReport(config, courseId)
  const abstract = { ...emptyParagraph(abstractPlaceholder(config)), content: [{ type: 'text' as const, text: abstractExample }] }
  return { ...base, abstract: { started: true, paragraphs: [abstract] }, body: templateBody(template) }
}

/** 原稿から作ったひな形。ids：ひな形の部品ごとの、原稿の欄の ID（直すところを押したら、そこへ移るため）。abstractId：抄録の最初の段落 */
export interface TemplateResult {
  template: TemplateBlock[]
  abstractExample: string
  ids: string[]
  abstractId: string | null
}

/** 表を、ひな形の表にする（見出しの行と行の数・切り替え。素材表のひな形のままなら、素材表） */
function tableTemplate(table: TableBlock): TemplateBlock {
  if (isPlainMaterialTable(table)) return { type: 'materialTable', caption: table.caption }
  const header = table.rows[0]?.cells.map((c) => c.text) ?? ['']
  const rows = Math.max(1, table.rows.length - 1)
  const colWidths = colWidthsOf(table)
  const out: TemplateTable = { type: 'table', caption: table.caption, header }
  if (rows !== 1) out.rows = rows
  if (table.widths !== 'equal') out.widths = table.widths
  if (colWidths) out.colWidths = colWidths
  if (table.heights !== 'auto') out.heights = table.heights
  if (table.labelColumn) out.labelColumn = true
  return out
}

/**
 * ひな形を作る画面の原稿から、ひな形を作る（「管理ページに戻して反映」）。
 * 中身が空の段落1つだけの大見出しは、大見出しだけにする（学生の原稿を作るとき、空の大見出しには空の段落が入る：bodyFromTemplate）
 */
export function templateFromReport(report: Report): TemplateResult {
  const num = numbering(report)
  const template: TemplateBlock[] = []
  const ids: string[] = []
  const push = (block: TemplateBlock, id: string) => {
    template.push(block)
    ids.push(id)
  }
  for (const chapter of report.body) {
    push({ type: 'chapter', title: chapter.title }, chapter.id)
    const only = chapter.blocks.length === 1 ? chapter.blocks[0] : null
    if (only?.type === 'paragraph' && contentToText(only.content, num) === '') continue
    for (const b of chapter.blocks) {
      if (b.type === 'subheading') push({ type: 'subheading', title: b.title }, b.id)
      else if (b.type === 'paragraph') push({ type: 'paragraph', hint: contentToText(b.content, num) }, b.id)
      else if (b.type === 'figureRow') for (const f of b.figures) push({ type: 'figure', caption: f.caption }, f.id)
      else if (b.type === 'table') push(tableTemplate(b), b.id)
      else push({ type: 'pageBreak' }, b.id)
    }
  }
  const abstractExample = report.abstract.paragraphs
    .map((p) => contentToText(p.content, num))
    .join('')
    .trim()
  return { template, abstractExample, ids, abstractId: report.abstract.paragraphs[0]?.id ?? null }
}

/** 直してもらうこと（id：その欄。押すとそこへ移る。なければ null） */
export interface TemplateIssue {
  id: string | null
  text: string
}

/**
 * 「管理ページに戻して反映」の前に直してもらうこと（管理ページの前のひな形の窓と同じ決まり：名前が空・長すぎる・部品が多すぎる）。
 * 行の番号ではなく、紙面の番号（「Ⅱ．」「図2」「表1」）で示す。最後に、サーバーと同じ決まり（templateProblems）でも確かめる
 */
export function templateIssues({ template, abstractExample, ids, abstractId }: TemplateResult): TemplateIssue[] {
  const issues: TemplateIssue[] = []
  const push = (id: string | null, text: string) => issues.push({ id, text })
  if (abstractExample.length > LIMITS.abstractExample) push(abstractId, `抄録の書き出し例${tooLong(LIMITS.abstractExample, abstractExample.length)}`)
  if (template.length === 0) push(null, '大見出しを1つ以上入れてください')
  if (template.length > LIMITS.blocks) push(null, `見出し・説明・図表・改ページが多すぎます（あわせて${LIMITS.blocks}個まで。今は${template.length}個）`)
  let chapter = -1
  let sub = 0
  let figure = 0
  let table = 0
  template.forEach((b, i) => {
    const id = ids[i] ?? null
    if (b.type === 'chapter') {
      chapter += 1
      sub = 0
      const label = `大見出し「${chapterLabel(chapter)}」`
      if (!b.title.trim()) push(id, `${label}の名前が空です`)
      else if (b.title.length > LIMITS.name) push(id, `${label}の名前${tooLong(LIMITS.name, b.title.length)}`)
    } else if (b.type === 'subheading') {
      const label = `小見出し「${chapterLabel(Math.max(0, chapter))}${subheadingLabel(sub++)}」`
      if (!b.title.trim()) push(id, `${label}の名前が空です`)
      else if (b.title.length > LIMITS.name) push(id, `${label}の名前${tooLong(LIMITS.name, b.title.length)}`)
    } else if (b.type === 'paragraph') {
      if (b.hint.length > LIMITS.hint) push(id, `「${chapterLabel(Math.max(0, chapter))}」の中の説明${tooLong(LIMITS.hint, b.hint.length)}`)
    } else if (b.type === 'figure') {
      const label = `図${++figure}のタイトル`
      if (!b.caption.trim()) push(id, `${label}が空です`)
      else if (b.caption.length > LIMITS.name) push(id, `${label}${tooLong(LIMITS.name, b.caption.length)}`)
    } else if (b.type === 'materialTable' || b.type === 'table') {
      const label = `表${++table}`
      if (!b.caption.trim()) push(id, `${label}のタイトルが空です`)
      else if (b.caption.length > LIMITS.name) push(id, `${label}のタイトル${tooLong(LIMITS.name, b.caption.length)}`)
      if (b.type === 'table') b.header.forEach((h, k) => h.length > LIMITS.name && push(id, `${label}の見出しの${k + 1}列目${tooLong(LIMITS.name, h.length)}`))
    } else if (b.type === 'pageBreak') {
      // 大見出しは、いつも新しいページから始まる（reportCss.ts）。大見出しの終わり・続いた改ページは、学生の原稿に空のページを作る
      const next = template[i + 1]
      if (!next || next.type === 'chapter') push(id, `「${chapterLabel(Math.max(0, chapter))}」の終わりの改ページは要りません（大見出しは、いつも新しいページから始まります）`)
      else if (next.type === 'pageBreak') push(id, '改ページが続いています（空のページができます）')
    }
  })
  // 念のため、サーバーと同じ決まりでも確かめる（上で見つからなかった問題があれば、そのまま出す）
  if (issues.length === 0) for (const p of templateProblems(template)) push(null, `ひな形${p}`)
  return issues
}
