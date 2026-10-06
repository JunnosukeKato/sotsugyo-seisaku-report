import { clampPercent, photoGrid } from './photos'
import { fromMaterialTable } from './table'
import type { BodyBlock, InlineNode, ParagraphBlock, Reference, Report } from './types'
import { DATA_FORMAT_VERSION } from './types'

/**
 * 保存データ（自動保存・バックアップファイル）を、今の形式の Report にする。
 * 公開後にデータの形を変えるときは DATA_FORMAT_VERSION を上げ、ここに古い形式からの変換を足す。
 * 学生の原稿を失わないことを最優先にし、欠けている項目は既定値で補う。
 */

export class UnsupportedDataError extends Error {}

type Raw = Record<string, unknown>

// 読み込むデータは、形を確かめてから使う（壊れたファイルや、細工したバックアップファイルで、画面が止まったり、紙面に何かを入れられたりしないように）
const str = (v: unknown) => (typeof v === 'string' ? v : '')
const obj = (v: unknown): Raw => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {})
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.map(obj) : [])
/** ID がなければ作る */
const idOf = (x: Raw, prefix: string) => str(x.id) || `${prefix}-${Math.random().toString(36).slice(2, 10)}`

function migrateInline(content: unknown): InlineNode[] {
  const nodes = list(content).flatMap((n): InlineNode[] => {
    if (n.type === 'text') return [{ type: 'text', text: str(n.text) }]
    if (n.type === 'ref' && typeof n.targetId === 'string') return [{ type: 'ref', targetId: n.targetId, withParens: n.withParens !== false }]
    return []
  })
  return nodes.length ? nodes : [{ type: 'text', text: '' }]
}

function migrateParagraph(b: Raw): ParagraphBlock {
  return { type: 'paragraph', id: idOf(b, 'p'), content: migrateInline(b.content), ...(typeof b.hint === 'string' ? { hint: b.hint } : {}) }
}

/** 本文の部品。知らない種類は捨てる。前の版の素材表（決まった3列）は、行と列を足せる表にする */
function migrateBlock(b: Raw): BodyBlock | null {
  switch (b.type) {
    case 'paragraph':
      return migrateParagraph(b)
    case 'subheading':
      return { type: 'subheading', id: idOf(b, 's'), title: str(b.title) }
    case 'pageBreak':
      return { type: 'pageBreak', id: idOf(b, 'pb') }
    case 'figureRow':
      return { type: 'figureRow', id: idOf(b, 'g'), figures: list(b.figures).map((f) => ({ id: idOf(f, 'f'), imageId: str(f.imageId), caption: str(f.caption) })) }
    case 'table':
      return {
        type: 'table',
        id: idOf(b, 't'),
        caption: str(b.caption),
        widths: b.widths === 'auto' ? 'auto' : 'equal',
        rows: list(b.rows).map((r) => ({ id: idOf(r, 'r'), cells: list(r.cells).map((c) => ({ id: idOf(c, 'c'), text: str(c.text), imageId: typeof c.imageId === 'string' ? c.imageId : null })) })),
      }
    case 'materialTable':
      return migrateBlock(fromMaterialTable({ ...b, id: idOf(b, 't'), rows: list(b.rows).map((r) => ({ ...r, id: idOf(r, 'r') })) } as Parameters<typeof fromMaterialTable>[0]) as unknown as Raw)
    default:
      return null
  }
}

function migrateBody(chapters: Raw[]): Report['body'] {
  return chapters.map((c) => ({
    id: idOf(c, 'c'),
    title: str(c.title),
    blocks: list(c.blocks)
      .map(migrateBlock)
      .filter((b): b is BodyBlock => b !== null),
  }))
}

function migrateReferences(refs: unknown): Reference[] {
  return list(refs).map((r): Reference =>
    r.type === 'web'
      ? { type: 'web', id: idOf(r, 'ref'), siteTitle: str(r.siteTitle), url: str(r.url), accessedOn: str(r.accessedOn) }
      : { type: 'book', id: idOf(r, 'ref'), author: str(r.author), title: str(r.title), publisher: str(r.publisher), year: str(r.year), pages: str(r.pages) },
  )
}

/** 抄録：「書き始めたか」がない前の版の原稿は、抄録をすでに書いていれば書き始めているとみなす（書いた抄録を隠さない） */
function migrateAbstract(abstract: Raw): Report['abstract'] {
  const paragraphs = list(abstract.paragraphs).map(migrateParagraph)
  const written = paragraphs.some((p) => p.content?.some((n) => n.type !== 'text' || n.text.trim()))
  if (typeof abstract.started === 'boolean') return { paragraphs, started: abstract.started || written }
  return written ? { paragraphs } : { paragraphs, started: false }
}

/** 作品写真：3枚の並べ方はなくしたため、4枚にする（写真は残る） */
function migratePhotos(photos: Raw): Report['workPhotos'] {
  const layout = photos.layout === 3 ? 4 : (([1, 2, 4, 6] as const).find((n) => n === photos.layout) ?? 1)
  const imageIds = Array.isArray(photos.imageIds) ? (photos.imageIds as unknown[]).map((x) => (typeof x === 'string' ? x : '')) : []
  const positions = Array.isArray(photos.positions)
    ? (photos.positions as unknown[]).map((p) => {
        const q = p as { x?: unknown; y?: unknown } | null
        return q && typeof q.x === 'number' && typeof q.y === 'number' ? { x: clampPercent(q.x), y: clampPercent(q.y) } : null
      })
    : undefined
  // 並べ方は、その枚数で選べるものだけ残す（なければ既定の並べ方）
  const columns = typeof photos.columns === 'number' && photoGrid({ layout, columns: photos.columns }).columns === photos.columns ? photos.columns : undefined
  return { layout, imageIds, ...(columns ? { columns } : {}), ...(positions ? { positions } : {}) }
}

export function migrateReport(input: unknown): Report {
  if (!input || typeof input !== 'object') throw new UnsupportedDataError('報告書のデータではありません')
  const raw = input as Raw
  const version = typeof raw.formatVersion === 'number' ? raw.formatVersion : 0
  if (version > DATA_FORMAT_VERSION) {
    throw new UnsupportedDataError('このデータは新しい版のツールで作られています。ページを再読み込みしてから開いてください')
  }
  if (!Array.isArray(raw.body)) throw new UnsupportedDataError('報告書のデータではありません（本文がありません）')

  const basic = (raw.basicInfo ?? {}) as Raw
  const abstract = (raw.abstract ?? {}) as Raw
  const photos = (raw.workPhotos ?? {}) as Raw
  return {
    formatVersion: DATA_FORMAT_VERSION,
    fiscalYear: typeof raw.fiscalYear === 'number' ? raw.fiscalYear : 0,
    basicInfo: { studentId: str(basic.studentId), name: str(basic.name), courseId: str(basic.courseId), subtitleInput: str(basic.subtitleInput) },
    abstract: migrateAbstract(abstract),
    body: migrateBody(list(raw.body)),
    references: migrateReferences(raw.references),
    ...(Array.isArray(raw.acknowledged) ? { acknowledged: (raw.acknowledged as unknown[]).filter((k): k is string => typeof k === 'string') } : {}),
    workPhotos: migratePhotos(photos),
    updatedAt: str(raw.updatedAt) || new Date().toISOString(),
  }
}
