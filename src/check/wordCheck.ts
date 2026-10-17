import { checkReport, type Area, type ReportFinding } from '../checker/reportChecks'
import type { YearConfig } from '../config'
import { editables, normalizeParagraph, numbering } from '../editor/reportOps'
import { documentContext, readDocument, type WordBlock } from '../import/wordDocument'
import { applyWordImport, readCoverFile, readWordFiles } from '../import/wordImport'
import { openWordFile, type WordPackage } from '../import/wordPackage'
import type { LayoutInfo } from '../layout/measure'
import { createReport } from '../model/newReport'
import type { Report } from '../model/types'
import { templateFindings } from './docxSettings'
import { idAndName, type CheckFinding, type PartId } from './parts'
import { abstractParagraphs, blockLines, bodyHeadings, findCourseId, headingDifference, sniffWordBlocks, sniffWordStrict, tocHeadings } from './wordParts'

/**
 * 提出前チェック：Word（学科のひな形で書いたもの）を確かめる。学生用ツールのセルフチェック（checker/reportChecks.ts）と同じ決まり・同じ言い回し。
 * - 本文・表紙：「Word から読み込む」と同じ読み取り（import/wordImport.ts）でツールの原稿の形にして、セルフチェックに通す
 * - 抄録：02_抄録.docx の、上の決まった行より下の段落を、原稿の抄録にする（字数 600〜900 などのチェックが働く）
 * - 目次：目次の見出しと、本文の見出しが合っているか（警告）
 * - ページ設定：余白・文字数と行数・文字の大きさが、ひな形のままか（docxSettings.ts）
 * ツールの中でしか意味のない指摘（「抄録はまだ書いていない」・作品写真のページ・「直す」を押すように言うものなど）は出さないか、言い換える。
 * Word を読むのは、ファイルが変わったときだけ（PDF を入れ替えても読み直さない）。チェックは PDF のページの数を使うので、そのたびにする
 */

export interface WordInputs {
  cover?: File
  abstract?: File
  toc?: File
  body?: File
}

/** Word を読んだ結果 */
export interface WordReading {
  report: Report
  /** 入れて、読めた Word */
  has: Record<'cover' | 'abstract' | 'toc' | 'body', boolean>
  /** 読めなかった Word（学生に分かる言葉で） */
  errors: Partial<Record<PartId, string>>
  /** ページ設定と目次の指摘 */
  extra: CheckFinding[]
  /** Word には画像があるが、ツールでは使えない形（グラフ・Word の図形・リンクした画像など）の図表（例「図2」「表1」）。「画像が入っていない」とは言わない */
  imagesInWord: Set<string>
  /** ひな形の仮の画像のままの図（例「図1」） */
  templateImages: Set<string>
  /** 学籍番号・氏名（ファイル名に使う。表紙、なければ抄録から） */
  studentId?: string
  name?: string
}

/** PDF から分かった、ページのこと（その PDF がなければ undefined。抄録の行の数が分からなければ null） */
export interface PdfLayout {
  bodyPages?: number
  abstractPages?: number
  abstractLines?: number | null
  /** 本文の PDF に「引用・参考文献」のページがある */
  referencesExcluded?: boolean
}

/** 「Word から読み込む」の言葉（「本文に選んだ…」）を、このページの言葉にする */
const reword = (message: string) => message.replace(/に選んだ/g, 'に入れた').replace(/を選んでください/g, 'を入れてください').replace(/選ばなくてかまいません/g, '入れなくてかまいません')

const errorText = (e: unknown) =>
  e instanceof Error && e.name === 'WordImportError' ? reword(e.message) : 'Word のファイルを読めませんでした。Word で開けるかを確かめ、「名前を付けて保存」で .docx に保存し直してから、入れてください。'

/** どのパートの Word か（名前で分からないとき）。読めなければ null */
export async function sniffWord(file: File): Promise<Exclude<PartId, 'photo'> | null> {
  try {
    const pkg = await openWordFile(file, 'Word')
    return sniffWordBlocks(readDocument(pkg.document, documentContext(pkg.styles, pkg.numbering)))
  } catch {
    return null
  }
}

/**
 * どのパートの Word か。guess：いちばん近いパート（名前で分からないときに使う）、sure：はっきり分かるパート（入れた場所と違えば知らせる。言えなければ null）。
 * 読めなければ null
 */
export async function wordLooksLike(file: File): Promise<{ guess: Exclude<PartId, 'photo'>; sure: Exclude<PartId, 'photo'> | null } | null> {
  try {
    const pkg = await openWordFile(file, 'Word')
    const blocks = readDocument(pkg.document, documentContext(pkg.styles, pkg.numbering))
    return { guess: sniffWordBlocks(blocks), sure: sniffWordStrict(blocks) }
  } catch {
    return null
  }
}

const blocksOf = (pkg: WordPackage): WordBlock[] => readDocument(pkg.document, documentContext(pkg.styles, pkg.numbering))

/** 入れた Word を読む（読めなかったファイルは errors に入れ、ほかは続ける） */
export async function readWord(inputs: WordInputs, config: YearConfig): Promise<WordReading> {
  const errors: WordReading['errors'] = {}
  const extra: CheckFinding[] = []
  const has = { cover: false, abstract: false, toc: false, body: false }
  const packages: Partial<Record<'cover' | 'abstract' | 'toc' | 'body', WordPackage>> = {}
  for (const part of ['cover', 'abstract', 'toc', 'body'] as const) {
    const file = inputs[part]
    if (!file) continue
    try {
      packages[part] = await openWordFile(file, { cover: '表紙', abstract: '抄録', toc: '目次', body: '本文' }[part])
    } catch (e) {
      errors[part] = errorText(e)
    }
  }
  const lines = (part: 'cover' | 'abstract') => (packages[part] ? blockLines(blocksOf(packages[part])) : [])
  // コース：表紙（なければ抄録）に書いたコースの名前から。サブタイトルの決まった形を知るのに使う
  const courseId = findCourseId([...lines('cover'), ...lines('abstract')], config) ?? ''
  // 確かめる原稿（Word を入れたパートだけを入れる。ほかは空のまま）
  const report: Report = { ...createReport(config, courseId), body: [], abstract: { paragraphs: [], started: false } }

  const imagesInWord = new Set<string>()
  const templateImages = new Set<string>()
  if (inputs.body && packages.body) {
    try {
      const result = await readWordFiles({ body: inputs.body }, { config, courseId, images: false })
      // 「Word で書いた章」だけを確かめる（ツールのひな形から続ける、まだ書いていない章は入れない）
      report.body = applyWordImport(report, result).body.slice(0, result.counts.chapters)
      has.body = true
      for (const p of result.problems) {
        const label = /^([図表]\d+)/.exec(p.message)?.[1]
        if (!label) continue
        if (/グラフ|SmartArt|リンクした|使えない形/.test(p.message)) imagesInWord.add(label)
        if (/ひな形の仮の画像/.test(p.message)) templateImages.add(label)
      }
    } catch (e) {
      errors.body = errorText(e)
    }
  }
  if (inputs.cover && packages.cover) {
    try {
      const { cover } = await readCoverFile(inputs.cover, { config, courseId })
      report.basicInfo = { ...report.basicInfo, ...cover }
      has.cover = true
    } catch (e) {
      errors.cover = errorText(e)
    }
  }
  let abstractTexts: Set<string> = new Set()
  if (packages.abstract) {
    const texts = abstractParagraphs(blocksOf(packages.abstract), config)
    abstractTexts = new Set(texts.map((t) => t.replace(/[\s　]/g, '')))
    report.abstract = { paragraphs: texts.map((t, i) => ({ type: 'paragraph', id: `abstract-${i}`, content: [{ type: 'text', text: normalizeParagraph(t) }] })), started: true }
    has.abstract = true
  }
  if (packages.toc) has.toc = true

  // ページ設定（ひな形のままか）
  for (const part of ['cover', 'abstract', 'toc', 'body'] as const) {
    const pkg = packages[part]
    if (!pkg || errors[part]) continue
    const isAbstractBody = (text: string) => abstractTexts.has(text.replace(/[\s　]/g, ''))
    extra.push(...templateFindings(part, pkg.document, pkg.styles, isAbstractBody))
  }
  // 目次の見出しと、本文の見出し
  if (packages.toc && packages.body && !errors.body) {
    const diff = headingDifference(tocHeadings(blocksOf(packages.toc)), bodyHeadings(blocksOf(packages.body)))
    if (diff && (diff.onlyToc.length || diff.onlyBody.length)) {
      const list = (titles: string[]) => titles.slice(0, 3).map((t) => `「${t}」`).join('') + (titles.length > 3 ? `など${titles.length}つ` : '')
      extra.push({
        id: 'docx:toc:toc-headings',
        ruleId: 'toc-headings',
        part: 'toc',
        severity: 'warning',
        source: 'supplementary',
        title: '目次と本文の見出しを合わせる',
        detail: [diff.onlyToc.length ? `目次にだけある：${list(diff.onlyToc)}` : '', diff.onlyBody.length ? `本文にだけある：${list(diff.onlyBody)}` : ''].filter(Boolean).join('　'),
      })
    }
  }
  // ファイル名に使う学籍番号・氏名（表紙、なければ抄録）
  const fromAbstract = idAndName(lines('abstract'))
  return {
    report,
    has,
    errors,
    extra,
    imagesInWord,
    templateImages,
    studentId: report.basicInfo.studentId || fromAbstract.studentId,
    name: report.basicInfo.name || fromAbstract.name,
  }
}

// ---- セルフチェックの指摘を、このページの指摘にする ----

const PART_OF_AREA: Record<Area, PartId> = { cover: 'cover', abstract: 'abstract', toc: 'toc', body: 'body', references: 'body', photos: 'photo' }

/**
 * 出さない指摘：ツールの中でしか意味がないもの。
 * abstract-not-started（抄録を書き始める前の決まり）・photos-*（ツールの作品写真のページ）・manual-ref（「直す」で図とつなげる）・
 * paragraph-empty（Word で書いていない小見出しに、読み取りが足した空の段落）
 */
const DROPPED = new Set(['abstract-not-started', 'photos-required', 'photos-empty-slot', 'manual-ref', 'paragraph-empty'])

/** 指摘した文字のまわり（前は12字まで、後ろは8字まで） */
function quoteOf(text: string, start: number, end: number): [string, string, string] {
  const from = Math.max(0, start - 12)
  const to = Math.min(text.length, end + 8)
  return [`${from > 0 ? '…' : ''}${text.slice(from, start).trimStart()}`, text.slice(start, end), `${text.slice(end, to)}${to < text.length ? '…' : ''}`]
}

/**
 * Word のチェックの指摘。layout：PDF から分かったページのこと（本文のページの数・抄録のページと行の数）。
 * covered：ここで出した、ページの数の指摘（PDF の指摘で、同じものを出さないため）
 */
export function wordFindings(reading: WordReading, config: YearConfig, pdf: PdfLayout): { findings: CheckFinding[]; covered: Set<string> } {
  const { report, has } = reading
  const layout: LayoutInfo | null =
    pdf.bodyPages !== undefined || pdf.abstractPages !== undefined
      ? {
          kinds: [],
          bodyPages: pdf.bodyPages ?? config.body.minPages,
          abstractPages: pdf.abstractPages ?? 1,
          abstractLines: pdf.abstractLines ?? config.abstract.minLines,
          tocPageNumbers: {},
          figuresPerBodyPage: [],
          pageBreaks: [],
        }
      : null
  const covered = new Set<string>()
  if (has.body && pdf.bodyPages !== undefined) covered.add('body-pages').add('figures-per-page')
  if (has.abstract && pdf.abstractPages !== undefined) covered.add('abstract-one-page')
  // PDF がないと分からないもの（ページの数）は、その PDF があるときだけ
  const needsPdf = (f: ReportFinding) =>
    ((f.ruleId === 'body-pages' || f.ruleId === 'figures-per-page') && pdf.bodyPages === undefined) ||
    ((f.ruleId === 'abstract-one-page' || f.ruleId === 'abstract-lines') && pdf.abstractPages === undefined) ||
    (f.ruleId === 'abstract-lines' && (pdf.abstractLines === null || pdf.abstractLines === undefined))

  const list = editables(report)
  const textOf = new Map(list.map((e) => [e.id, e.text]))
  const num = numbering(report)
  /** 表のセルの ID → その表と、行の文字（場所を探すのに使う）と、Word のどこか（「表1：「綿ブロード」の行、「生地見本」の列」） */
  const cells = new Map<string, { table: string; rowText: string; where: string }>()
  for (const b of report.body.flatMap((c) => c.blocks))
    if (b.type === 'table') {
      const header = b.rows[0]?.cells ?? []
      b.rows.forEach((row, r) => {
        // 行の文字をつないだもの（PDF では、表の1行は1行の文字になる。「麻」のような短いセルだけでは探せない）
        const rowText = row.cells.map((x) => x.text).join('') || b.caption
        const first = row.cells.map((x) => x.text.trim()).find(Boolean)
        const rowName = r === 0 ? '見出しの行' : first ? `「${first.length > 12 ? `${first.slice(0, 12)}…` : first}」の行` : `見出しの下から${r}行目`
        row.cells.forEach((c, i) => {
          const head = header[i]?.text.trim()
          const colName = r > 0 && head ? `「${head}」の列` : `左から${i + 1}つ目`
          cells.set(c.id, { table: b.id, rowText, where: `表${num.numbers.get(b.id) ?? ''}：${rowName}、${colName}` })
        })
      })
    }

  const findings: CheckFinding[] = []
  const seen = new Map<string, number>()
  const all = checkReport(report, config, layout)
  // 生地見本の写真がないセルは、「表に空いているセルがある」とは言わない（同じセルの指摘が2つ並ばないように）
  const swatchCells = new Set(all.filter((f) => f.ruleId === 'swatch-image').map((f) => f.blockId))
  for (const f of all) {
    if (DROPPED.has(f.ruleId) || needsPdf(f)) continue
    if (f.ruleId === 'table-cell-empty' && swatchCells.has(f.blockId)) continue
    // Word を入れていないパートの指摘は出さない（確かめる原稿では、空のままのため。本文のページの数は、PDF の指摘で出す）
    if ((f.area === 'body' || f.area === 'references') && !has.body) continue
    if (f.area === 'abstract' && !has.abstract) continue
    if (f.area === 'cover' && !has.cover) continue
    // 表紙の項目は、表紙の Word を入れたときだけ。コースは、このページでは選ばない
    if (f.ruleId === 'required-field' && (f.blockId === 'basic:course' || !has.cover)) continue
    let detail = f.detail
    if (f.ruleId === 'figure-image' && f.blockId) {
      const label = `図${num.numbers.get(f.blockId)}`
      if (reading.imagesInWord.has(label)) continue
      if (reading.templateImages.has(label)) detail = 'ひな形の仮の画像のままです。自分の写真に入れ替える'
    }
    if (f.ruleId === 'swatch-image' && f.blockId && reading.imagesInWord.has(`表${num.numbers.get(cells.get(f.blockId)?.table ?? '')}`)) continue
    if (f.ruleId === 'required-field') detail = '表紙の Word から読み取れませんでした'
    if (f.ruleId === 'reference-missing') detail = '図表の番号と、図表のタイトル（「図1　〇〇」）の番号が合っているかを確かめる'
    if (f.ruleId === 'body-pages') detail = `現在 ${pdf.bodyPages}ページ（PDF のページの数${pdf.referencesExcluded ? '。引用・参考文献のページは数えない' : ''}）`

    const text = f.blockId ? textOf.get(f.blockId) : undefined
    let quote: CheckFinding['quote']
    const snippets: string[] = []
    if (text && f.start !== undefined && f.end !== undefined && f.end > f.start) {
      const [before, match, after] = quoteOf(text, f.start, f.end)
      if (match.trim() && !f.blockId?.startsWith('basic:')) quote = [before, match, after]
      const b = before.replace(/^…/, '')
      const a = after.replace(/…$/, '')
      snippets.push(b + match + a, match + a, b + match, match)
      // 指摘の説明は、直し方だけにする（直す文字は quote に出す）
      if (quote && f.replacement) detail = `→「${f.replacement}」`
    } else if (text?.trim()) {
      snippets.push(text.slice(0, 40))
    } else if (f.blockId && cells.has(f.blockId)) {
      const cell = cells.get(f.blockId)!
      snippets.push(cell.rowText)
      // 同じ表の指摘が並んでも、どのセルか分かるように
      detail = detail ? `${cell.where}。${detail}` : cell.where
    }
    // 選んだ指摘の目印（同じ箇所の同じ指摘が2つあれば、2つ目から番号を付ける）
    const key = `word:${f.ruleId}:${f.blockId ?? ''}:${f.start ?? ''}`
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    findings.push({
      id: n ? `${key}:${n}` : key,
      ruleId: f.ruleId,
      part: PART_OF_AREA[f.area],
      severity: f.severity === 'error' ? 'error' : 'warning',
      source: f.source,
      title: f.title,
      ...(detail ? { detail } : {}),
      ...(quote ? { quote } : {}),
      ...(snippets.length ? { snippets } : {}),
    })
  }
  return { findings: [...findings, ...reading.extra], covered }
}
