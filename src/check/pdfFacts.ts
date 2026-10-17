import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { YearConfig } from '../config'
import { PART_NAMES, type CheckFinding, type PartId } from './parts'

/**
 * 提出前チェック：Word から保存した PDF から分かること（ページの数・用紙の大きさ・ページ番号・画像の数・ページの文字）。
 * PDF を読む部品（pdf.js）は、呼ぶ側が渡す（画面は pdfjs.ts、単体テストは Node 用の pdf.js）。
 * 学科の見本の PDF で、pdf.js が文字を読め、下のページ番号（本文だけ 1〜7）と、ページごとの画像の数が分かることを確かめてある
 */

/** pdf.js のうち、ここで使うもの */
export interface PdfJs {
  getDocument: typeof import('pdfjs-dist').getDocument
  OPS: typeof import('pdfjs-dist').OPS
}

/** ページの1行（上から順） */
export interface PdfLine {
  text: string
  /** ページの上の端からの位置（0＝上の端、1＝下の端） */
  top: number
  /** 文字の大きさ（pt） */
  size: number
}

export interface PdfPageFacts {
  /** 用紙の大きさ（pt） */
  widthPt: number
  heightPt: number
  lines: PdfLine[]
  /** 指摘の場所を探すための文字（NFKC にして空白を除き、行を上から順につないだもの） */
  search: string
  /** 下（か上）の端のページ番号。なければ null */
  pageNumber: string | null
  /** 画像の数（小さな飾りは数えない） */
  images: number
}

export interface PdfFacts {
  pages: PdfPageFacts[]
}

/** 読めない PDF（message は学生に分かる言葉） */
export class PdfReadError extends Error {
  name = 'PdfReadError'
}

/** 比べるための形（NFKC にし、空白を除く） */
export const compact = (s: string) => s.normalize('NFKC').replace(/[\s　]/g, '')

const A4 = { w: 595.28, h: 841.89 }
/** A4 と見なす幅（約2mm） */
const A4_TOLERANCE = 6

export function isA4(page: Pick<PdfPageFacts, 'widthPt' | 'heightPt'>): boolean {
  const near = (a: number, b: number) => Math.abs(a - b) <= A4_TOLERANCE
  return (near(page.widthPt, A4.w) && near(page.heightPt, A4.h)) || (near(page.widthPt, A4.h) && near(page.heightPt, A4.w))
}

const mm = (pt: number) => Math.round((pt / 72) * 25.4)

// ---- 1ページを読む ----

interface RawItem {
  str: string
  transform: number[]
}

/** ページ番号の形（「3」「- 3 -」「3/7」「（3）」） */
const PAGE_NUMBER = /^(?:[-‐−–—―－]?\d{1,3}[-‐−–—―－]?|\d{1,3}\/\d{1,3}|[(（]\d{1,3}[)）]|p\.?\d{1,3})$/i

/**
 * 文字の並び（pdf.js の getTextContent）と、画像を描く命令（getOperatorList）から、1ページのことを求める。
 * toTop：PDF の座標（左下が原点）を、ページの上からの位置（0〜1）にする
 */
export function pageFacts(items: RawItem[], size: { widthPt: number; heightPt: number }, toTop: (x: number, y: number) => number, images: number): PdfPageFacts {
  // 同じ高さの文字を1行にまとめる
  const placed = items
    .filter((it) => it.str.trim())
    .map((it) => ({ str: it.str, x: it.transform[4], top: toTop(it.transform[4], it.transform[5]), size: Math.hypot(it.transform[2], it.transform[3]) || Math.abs(it.transform[0]) }))
    .sort((a, b) => a.top - b.top || a.x - b.x)
  const rows: { top: number; size: number; parts: { x: number; str: string }[] }[] = []
  for (const it of placed) {
    const near = rows.find((r) => Math.abs(r.top - it.top) * size.heightPt < Math.max(2, Math.min(r.size, it.size) * 0.4))
    if (near) {
      near.parts.push({ x: it.x, str: it.str })
      near.size = Math.max(near.size, it.size)
    } else rows.push({ top: it.top, size: it.size, parts: [{ x: it.x, str: it.str }] })
  }
  const lines = rows
    .sort((a, b) => a.top - b.top)
    .map((r) => ({ text: r.parts.sort((a, b) => a.x - b.x).map((p) => p.str).join(''), top: r.top, size: Math.round(r.size * 10) / 10 }))
  // ページ番号：いちばん下の行（下の端の近く）か、いちばん上の行（上の端の近く）が、数字だけのとき
  const last = lines[lines.length - 1]
  const first = lines[0]
  const numberOf = (line: PdfLine | undefined, inBand: boolean) => (line && inBand && PAGE_NUMBER.test(compact(line.text)) ? compact(line.text) : null)
  const pageNumber = numberOf(last, !!last && last.top > 0.85) ?? (lines.length > 1 ? numberOf(first, !!first && first.top < 0.1) : null)
  return {
    widthPt: size.widthPt,
    heightPt: size.heightPt,
    lines,
    search: lines.map((l) => compact(l.text)).join(''),
    pageNumber,
    images,
  }
}

/** 画像を描く命令の数（同じ画像のくり返しは1つ。32×32 点より小さい飾りは数えない） */
export function countImages(fnArray: number[], argsArray: unknown[], OPS: PdfJs['OPS']): number {
  let n = 0
  fnArray.forEach((fn, i) => {
    const args = argsArray[i] as unknown[]
    if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
      const [, w, h] = args as [unknown, number, number]
      if (fn === OPS.paintImageXObjectRepeat || !(typeof w === 'number' && typeof h === 'number') || w * h >= 32 * 32) n++
    } else if (fn === OPS.paintInlineImageXObject) {
      const img = args?.[0] as { width?: number; height?: number } | undefined
      if (!img?.width || !img.height || img.width * img.height >= 32 * 32) n++
    }
  })
  return n
}

/**
 * PDF を読む（ページごとの文字・大きさ・ページ番号・画像の数）。読めない PDF（パスワード・壊れている）は PdfReadError。
 * doc は、ページの小さな絵を作るのに使う（使い終えたら doc.loadingTask.destroy()）
 */
export async function readPdf(bytes: Uint8Array, pdfjs: PdfJs, worker?: import('pdfjs-dist').PDFWorker): Promise<{ doc: PDFDocumentProxy; facts: PdfFacts }> {
  let doc: PDFDocumentProxy
  try {
    // data は pdf.js の中へ渡すと使えなくなるので、写しを渡す。知らせ（警告）は出さない。worker：読む手伝いをする部品（ブラウザでは、1つを使い回す）
    doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0, ...(worker ? { worker } : {}) }).promise
  } catch (e) {
    const name = e instanceof Error ? e.name : ''
    if (name === 'PasswordException') throw new PdfReadError('パスワードがかかっているため、読めません。Word から、パスワードを付けずに PDF に保存し直してください。')
    throw new PdfReadError('ファイルが壊れているか、PDF ではないため、読めません。Word から PDF に保存し直してください。')
  }
  const pages: PdfPageFacts[] = []
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const viewport = page.getViewport({ scale: 1 })
      const text = await page.getTextContent()
      const ops = await page.getOperatorList()
      pages.push(
        pageFacts(
          text.items.flatMap((it) => ('str' in it ? [{ str: it.str, transform: it.transform as number[] }] : [])),
          { widthPt: viewport.width, heightPt: viewport.height },
          (x, y) => viewport.convertToViewportPoint(x, y)[1] / viewport.height,
          countImages(ops.fnArray, ops.argsArray, pdfjs.OPS),
        ),
      )
    }
  } catch {
    await doc.loadingTask.destroy()
    throw new PdfReadError('PDF の中を読めませんでした（壊れているかもしれません）。Word から PDF に保存し直してください。')
  }
  return { doc, facts: { pages } }
}

// ---- 中身から、どのパートかを見分ける ----

/**
 * 1ページ目の文字から、どのパートの PDF か。目次：上に「目次」、抄録：上のほうに「抄録」、
 * 表紙：学籍番号・氏名と大きな題、作品写真：文字がほとんどなく写真がある、ほかは本文
 */
export function classifyPdf(facts: PdfFacts): PartId {
  const first = facts.pages[0]
  if (!first) return 'body'
  const lines = first.lines.map((l) => compact(l.text)).filter(Boolean)
  const all = lines.join('')
  if (facts.pages.length === 1 && all.length < 20 && first.images > 0) return 'photo'
  if (lines.slice(0, 3).some((l) => l.startsWith('目次'))) return 'toc'
  if (lines.slice(0, 8).some((l) => l.includes('抄録') || l.includes('要旨'))) return 'abstract'
  const largest = Math.max(0, ...first.lines.map((l) => l.size))
  if (all.includes('学籍番号') && all.includes('氏名') && largest >= 20) return 'cover'
  return 'body'
}

/**
 * 1ページ目の中身から、はっきり分かるパート（入れた場所と中身が違うのを見つけるのに使う）。
 * 本文は、1ページ目にページ番号があるときだけ。どれとも言えなければ null（classifyPdf のように本文とはしない）
 */
export function pdfLooksLike(facts: PdfFacts): PartId | null {
  const part = classifyPdf(facts)
  if (part !== 'body') return part
  return facts.pages[0]?.pageNumber ? 'body' : null
}

// ---- 本文・抄録 ----

const REFERENCES_HEADING = /^(?:[IVXⅠ-Ⅻ]+[.、．]?|[0-9]+[.、．]?)?(?:引用・?参考文献|引用文献|参考文献|参考資料)(?:一覧)?$/

/**
 * 本文のページの数（「引用・参考文献」の見出しから後ろのページは数えない。見出しがページの途中にあれば、そのページは本文に数える）。
 * referencesFrom：見出しのあるページ（1から。なければ null）
 */
export function bodyPages(facts: PdfFacts): { count: number; referencesFrom: number | null } {
  for (const [i, page] of facts.pages.entries()) {
    const lines = page.lines.filter((l) => compact(l.text) && compact(l.text) !== page.pageNumber)
    const at = lines.findIndex((l) => REFERENCES_HEADING.test(compact(l.text)))
    if (at >= 0) return { count: at === 0 ? i : i + 1, referencesFrom: i + 1 }
  }
  return { count: facts.pages.length, referencesFrom: null }
}

const DASH = '―－—–\\-‐−─━ー'
const SUBTITLE_LINE = new RegExp(`^[${DASH}].+[${DASH}]$`)

/**
 * 抄録の本文の行の数（サブタイトル「―…―」の行より下の行。ページ番号は数えない）。サブタイトルが見つからなければ null
 */
export function abstractLines(facts: PdfFacts): number | null {
  let count = 0
  let found = false
  for (const page of facts.pages) {
    const lines = page.lines.filter((l) => compact(l.text) && compact(l.text) !== page.pageNumber)
    if (!found) {
      const at = lines.findIndex((l, i) => i < 10 && SUBTITLE_LINE.test(compact(l.text)))
      if (at < 0) continue
      found = true
      count += lines.length - at - 1
    } else count += lines.length
  }
  return found ? count : null
}

// ---- PDF から分かる指摘 ----

const pageList = (pages: number[]) => `${pages.join('・')}ページ目`

/**
 * PDF から分かる指摘（用紙・ページ番号・ページの数・画像の数）。
 * covered：Word のチェック（学生用ツールのセルフチェック）で、すでに出した指摘（同じ ruleId は出さない）
 */
export function pdfFindings(pdfs: Partial<Record<PartId, PdfFacts>>, config: YearConfig, covered: Set<string> = new Set()): CheckFinding[] {
  const out: CheckFinding[] = []
  const add = (f: Omit<CheckFinding, 'id' | 'source'> & { source?: CheckFinding['source'] }) => out.push({ source: 'guide', ...f, id: `pdf:${f.part}:${f.ruleId}` })
  for (const part of ['cover', 'abstract', 'toc', 'body', 'photo'] as PartId[]) {
    const facts = pdfs[part]
    if (!facts || facts.pages.length === 0) continue
    // 用紙の大きさ
    const notA4 = facts.pages.flatMap((p, i) => (isA4(p) ? [] : [i + 1]))
    if (notA4.length) {
      const p = facts.pages[notA4[0] - 1]
      add({ ruleId: 'pdf-a4', part, severity: 'error', title: '用紙は A4 にする', detail: `A4 でないページ：${pageList(notA4)}（${mm(p.widthPt)}×${mm(p.heightPt)}mm）`, page: notA4[0] })
    }
    if (part === 'photo') {
      if (facts.pages.length > 1) add({ ruleId: 'photo-one-page', part, severity: 'error', title: '作品写真は A4 1枚にする', detail: `今 ${facts.pages.length}ページ` })
      continue
    }
    // ページ番号：本文の各ページに付ける。表紙・抄録・目次には付けない（手順書「目次・抄録はページ数に入れない」）
    if (part === 'body') {
      const { count } = bodyPages(facts)
      const missing = facts.pages.slice(0, Math.max(count, 1)).flatMap((p, i) => (p.pageNumber ? [] : [i + 1]))
      if (missing.length) add({ ruleId: 'page-number-missing', part, severity: 'warning', title: '本文の各ページにページ番号を付ける', detail: `ページ番号が見つからないページ：${pageList(missing)}`, page: missing[0] })
      if (!covered.has('body-pages') && count < config.body.minPages)
        add({ ruleId: 'body-pages', part, severity: 'error', title: `本文はA4で${config.body.minPages}ページ以上にする`, detail: `現在 ${count}ページ（PDF のページの数${count < facts.pages.length ? '。引用・参考文献のページは数えない' : ''}）` })
      if (!covered.has('figures-per-page')) {
        const images = facts.pages.slice(0, count).reduce((n, p) => n + p.images, 0)
        const max = count * config.body.imagesPerPageGuide
        if (count > 0 && images > max)
          add({ ruleId: 'figures-per-page', part, severity: 'warning', title: `画像は1ページあたり${config.body.imagesPerPageGuide}枚程度にする`, detail: `画像 ${images}枚・本文 ${count}ページ（目安は${max}枚まで）` })
      }
    } else {
      const numbered = facts.pages.flatMap((p, i) => (p.pageNumber ? [i + 1] : []))
      if (numbered.length) add({ ruleId: 'page-number-extra', part, severity: 'warning', title: `${PART_NAMES[part]}にはページ番号を付けない`, detail: `ページ番号があるページ：${pageList(numbered)}`, page: numbered[0] })
    }
    // 表紙は1ページ（4つを自分で1つにまとめた PDF を入れると、表紙の場所に入り、まとめると2回ずつ入る）
    if (part === 'cover' && facts.pages.length > 1)
      add({ ruleId: 'cover-one-page', part, severity: 'error', title: '表紙は1ページにする', detail: `今 ${facts.pages.length}ページ。1つにまとめた PDF ではなく、表紙だけの PDF を入れる` })
    if (part === 'abstract' && !covered.has('abstract-one-page') && facts.pages.length > 1)
      add({ ruleId: 'abstract-one-page', part, severity: 'error', title: '抄録は1ページに収める', detail: `現在 ${facts.pages.length}ページ` })
  }
  return out
}

/** PDF だけを入れたとき（Word のチェックをしていないとき）に、確かめられたこと（そろっているもの）の一覧 */
export function pdfOks(pdfs: Partial<Record<PartId, PdfFacts>>, config: YearConfig): { label: string; value: string }[] {
  const oks: { label: string; value: string }[] = []
  const body = pdfs.body
  if (body) {
    const { count } = bodyPages(body)
    if (count >= config.body.minPages) oks.push({ label: '本文のページの数', value: `${count}ページ（${config.body.minPages}ページ以上）` })
    if (body.pages.slice(0, Math.max(count, 1)).every((p) => p.pageNumber)) oks.push({ label: '本文のページ番号', value: 'どのページにもあります' })
  }
  if (pdfs.abstract?.pages.length === 1) oks.push({ label: '抄録のページの数', value: '1ページ' })
  const all = Object.values(pdfs).flatMap((f) => f?.pages ?? [])
  if (all.length && all.every(isA4)) oks.push({ label: '用紙の大きさ', value: 'どのページも A4' })
  return oks
}
