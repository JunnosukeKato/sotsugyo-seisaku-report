import type { YearConfig } from '../config'

/**
 * 提出前チェック（check.html。mockups/v30 案C2）の決まり：5つのパート、入れたファイルの分け方、ファイル名、確かめの窓。
 * Word のひな形（01_表紙〜04_本文）で書いている学生が、Word と、Word から保存した PDF と、作品写真を入れる。
 * 画面にも、読み取り（wordCheck.ts・pdfFacts.ts）にも使う、軽い部品だけを置く（重い部品は、使うときに読み込む）
 */

/** 5つのパート（まとめる順：表紙 → 抄録 → 目次 → 本文 → 作品写真） */
export type PartId = 'cover' | 'abstract' | 'toc' | 'body' | 'photo'

export interface PartInfo {
  id: PartId
  name: string
  /** 学科のひな形のファイル名（拡張子なし）。作品写真はひな形がない */
  base?: string
}

export const PARTS: PartInfo[] = [
  { id: 'cover', name: '表紙', base: '01_表紙' },
  { id: 'abstract', name: '抄録', base: '02_抄録' },
  { id: 'toc', name: '目次', base: '03_目次' },
  { id: 'body', name: '本文', base: '04_本文' },
  { id: 'photo', name: '作品写真' },
]

export const PART_NAMES: Record<PartId, string> = { cover: '表紙', abstract: '抄録', toc: '目次', body: '本文', photo: '作品写真' }

/** 置き場所：パートの Word（チェック用）と、PDF（まとめる用。作品写真は、写真か1ページの PDF） */
export type SlotKind = 'word' | 'pdf'

export type FileKind = 'word' | 'pdf' | 'image'

/** 指摘（学生用ツールのセルフチェックと同じ言い回し・同じ分け方。どのパートの話か、分かればどのページか） */
export interface CheckFinding {
  /** 選んだ指摘を見分ける印（同じ中身なら、確かめ直しても同じ） */
  id: string
  ruleId: string
  part: PartId
  severity: 'error' | 'warning'
  /** guide＝手順書のルール、supplementary＝手順書にない補助のチェック */
  source: 'guide' | 'supplementary'
  title: string
  detail?: string
  /** 指摘した文字のまわり（前・指摘した文字・後ろ）。画面では指摘した文字に印を付ける */
  quote?: [string, string, string]
  /** PDF の中から探す文字（前から順に試す） */
  snippets?: string[]
  /** そのパートの PDF の、何ページ目か（1から。見つかったときだけ） */
  page?: number
}

// ---- 入れたファイルの種類 ----

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** ファイルの種類（Word・PDF・写真）。使えない形なら、その理由（学生に分かる言葉で） */
export function fileKind(file: { name: string; type: string }): FileKind | { problem: string } {
  const name = file.name.toLowerCase()
  if (name.endsWith('.docx') || file.type === DOCX_TYPE) return 'word'
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf'
  if (/\.(jpe?g|png|heic|heif|webp)$/.test(name) || /^image\/(jpeg|png|heic|heif|webp)$/.test(file.type)) return 'image'
  if (name.endsWith('.doc')) return { problem: '古い形（.doc）の Word は読めません。Word で開いて「名前を付けて保存」で「Word 文書（*.docx）」にしてから入れてください。' }
  if (name.endsWith('.pages')) return { problem: 'Pages のファイルは読めません。Word（.docx）と PDF にしてから入れてください。' }
  return { problem: 'Word（.docx）・PDF・写真（JPEG・PNG）のほかは入れられません。' }
}

/** ファイルの名前から、どのパートか（01_ や「表紙」など）。名前で分からなければ null */
export function partFromName(fileName: string): PartId | null {
  const name = fileName.normalize('NFKC')
  const number = /^0?([1-4])(?![0-9])/.exec(name)
  if (number) return (['cover', 'abstract', 'toc', 'body'] as const)[Number(number[1]) - 1]
  // 名前の中の言葉（いちばん前にあるもの）。作品写真は「写真」
  const words: [RegExp, PartId][] = [
    [/表紙/, 'cover'],
    [/抄録|要旨/, 'abstract'],
    [/目次/, 'toc'],
    [/本文/, 'body'],
    [/写真/, 'photo'],
  ]
  let best: { at: number; part: PartId } | null = null
  for (const [re, part] of words) {
    const at = name.search(re)
    if (at >= 0 && (!best || at < best.at)) best = { at, part }
  }
  return best?.part ?? null
}

/**
 * 入れたファイルを置く場所。名前で分からないときは、中身から分かったパート（sniffed）。
 * 写真は作品写真。作品写真の PDF は、名前に「写真」があるか、中身から作品写真と分かったとき
 */
export function placeFor(kind: FileKind, fileName: string, sniffed: PartId | null): { part: PartId; slot: SlotKind } {
  if (kind === 'image') return { part: 'photo', slot: 'pdf' }
  const part = partFromName(fileName) ?? sniffed ?? 'body'
  if (kind === 'word') return { part: part === 'photo' ? 'body' : part, slot: 'word' }
  return { part, slot: 'pdf' }
}

/** 置き場所の名前（例「本文の PDF」「作品写真」） */
export function slotLabel(part: PartId, slot: SlotKind): string {
  if (part === 'photo') return PART_NAMES.photo
  return `${PART_NAMES[part]}の${slot === 'word' ? ' Word' : ' PDF'}`
}

/**
 * Word のほうが PDF より新しい（Word を直したあと、PDF を作り直していないかもしれない）。
 * ファイルの時刻は、保存する場所によって2秒刻みのことがあるため、2秒より大きく新しいときだけ
 */
export function isStale(word: { lastModified: number } | null | undefined, pdf: { lastModified: number } | null | undefined): boolean {
  return !!word && !!pdf && word.lastModified - pdf.lastModified > 2000
}

/**
 * まとめた PDF のファイル名（学生用ツールの「PDFを書き出す」と同じ形。reportEditor.ts の pdfTitle）。
 * 例：2026_卒業制作報告書_00ZZ0123_文化花子.pdf。学籍番号・氏名が分からなければ、その部分は付けない
 */
export function mergedFileName(config: Pick<YearConfig, 'fiscalYear' | 'reportName'>, studentId: string, name: string): string {
  return `${[String(config.fiscalYear), config.reportName, studentId.trim(), name.replace(/[\s　]/g, '')].filter(Boolean).join('_')}.pdf`
}

/**
 * 学籍番号と氏名（ファイル名に使う。抄録の Word・表紙の PDF の行から。表紙の Word は「Word から読み込む」と同じ読み取り）。
 * 学籍番号は数字2桁＋英字＋数字。仮の文字（●）のままなら入れない。ラベルの行に値がなければ、次の行を見る
 */
export function idAndName(lines: string[]): { studentId?: string; name?: string } {
  const result: { studentId?: string; name?: string } = {}
  const norm = (s: string) => s.normalize('NFKC').toUpperCase().replace(/\s/g, '')
  lines.forEach((line, i) => {
    const text = norm(line)
    if (!result.studentId && text.includes('学籍番号')) {
      const after = text.slice(text.indexOf('学籍番号') + 4) || norm(lines[i + 1] ?? '')
      const m = /^[:：]?(\d{2}[A-Z]{1,4}\d{2,6})(?![0-9A-Z])/.exec(after)
      if (m) result.studentId = m[1]
    }
    if (!result.name) {
      // 姓と名の間の全角の空白は残す（NFKC にすると半角になる）
      const m = /氏[\s　]*名[\s　]*[:：]?[\s　]*(.*)$/.exec(line)
      if (m) {
        const value = (m[1].trim() || (lines[i + 1] ?? '').trim()).replace(/^[:：\s　]+/, '').split(/[（(]|学籍番号|指導教員/)[0].trim()
        if (value && !/[●〇○◯]/.test(value)) result.name = value.replace(/[\s　]{2,}/g, '　')
      }
    }
  })
  return result
}

/** ファイルの時刻（例「10月14日 15:20」） */
export function timeText(ms: number): string {
  const d = new Date(ms)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 「Word のほうが新しい」パートの指摘（Word を直したあと、PDF を作り直していないかもしれない。まとめるのは PDF なので、直す前の PDF がまとまる） */
export function staleFinding(part: Exclude<PartId, 'photo'>, word: { lastModified: number }, pdf: { lastModified: number }): CheckFinding {
  return {
    id: `slot:${part}:stale`,
    ruleId: 'pdf-older',
    part,
    severity: 'warning',
    source: 'supplementary',
    title: 'Word を直したら、PDF も作り直す',
    detail: `PDF が Word より古いようです（Word：${timeText(word.lastModified)}、PDF：${timeText(pdf.lastModified)}）。まとめるのは PDF です`,
  }
}

/**
 * 入れた場所と中身が違うときの指摘（中身は本文なのに「表紙.pdf」という名前、1つにまとめた PDF を本文に入れた、など）。
 * looksLike：中身から分かったパート（pdfFacts.ts の pdfLooksLike・wordParts.ts の sniffWordStrict）
 */
export function wrongPartFinding(part: PartId, slot: SlotKind, looksLike: PartId): CheckFinding {
  return {
    id: `slot:${part}:${slot}:wrong-part`,
    ruleId: 'wrong-part',
    part,
    severity: 'error',
    source: 'supplementary',
    title:
      slot === 'pdf'
        ? `${part === 'photo' ? '作品写真' : `${PART_NAMES[part]}の PDF `}の1ページ目が、${PART_NAMES[looksLike]}のようです`
        : `${PART_NAMES[part]}の Word の中身が、${PART_NAMES[looksLike]}のようです`,
    detail: '入れたファイルを確かめる。違う場所に入ったときは、ファイルの名前を押して移す',
    ...(slot === 'pdf' ? { page: 1 } : {}),
  }
}

/**
 * 「1つの PDF にまとめる」を押したときの、確かめの窓（決まり：エラーが残っていても、確かめてから、そのまままとめる。透かしは入れない）。
 * エラーが残っているか、PDF が Word より古いパート（stale）か、まだ入れていないパート（missing。作品写真など）があれば出す。
 * なければ null（すぐまとめる）。unchecked：Word を1つも入れていない（true）か、Word を入れていないパート（PDF だけのパートの名前）
 */
export function confirmText(errors: number, missing: string[], stale: string[] = [], unchecked: boolean | string[] = false): { title: string; sub: string[] } | null {
  const staleLine = stale.length ? `${stale.join('・')}の PDF が、Word より古いようです。` : null
  const missingLine = missing.length ? `${missing.join('・')}も、まだありません。` : null
  const uncheckedLine =
    unchecked === true ? 'Word を入れていないので、書式や文はチェックしていません。' : Array.isArray(unchecked) && unchecked.length ? `${unchecked.join('・')}は Word を入れていないので、書式や文はチェックしていません。` : null
  const lines = (...xs: (string | null)[]) => xs.filter((x): x is string => !!x)
  if (errors > 0) return { title: `エラーが${errors}件残っています`, sub: lines(staleLine, missingLine, uncheckedLine) }
  if (stale.length > 0) return { title: `${stale.join('・')}の PDF が、Word より古いようです`, sub: lines(missingLine, uncheckedLine) }
  if (missing.length > 0) return { title: `${missing.join('・')}が、まだありません`, sub: lines(uncheckedLine) }
  return null
}

/** 指摘を、パートの順に分ける（パートの中は、ページの順。ページの分からないものは後ろ） */
export function groupByPart(findings: CheckFinding[]): { part: PartInfo; items: CheckFinding[] }[] {
  return PARTS.map((part) => ({
    part,
    items: findings.filter((f) => f.part === part.id).map((f, i) => ({ f, i })).sort((a, b) => (a.f.page ?? 1e6) - (b.f.page ?? 1e6) || a.i - b.i).map((x) => x.f),
  })).filter((g) => g.items.length > 0)
}
