import { clampPercent, photoGrid } from './photos'
import { fromMaterialTable } from './table'
import type { BodyBlock, InlineNode, ParagraphBlock, Reference, Report, WorkPhotoLayout, WorkPhotoPage } from './types'
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
        widths: b.widths === 'auto' ? 'auto' : b.widths === 'custom' ? 'custom' : 'equal',
        // 自分で決めた列の幅（数だけ。列の数と合うか・合計は、使うときに確かめる：model/table.ts の colWidthsOf）
        ...(Array.isArray(b.colWidths) && b.colWidths.length > 0 && b.colWidths.every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0) ? { colWidths: b.colWidths as number[] } : {}),
        // 行の高さ・左端の列：前の版の原稿にはないので、今までどおり（中身に合わせる・ほかの列とそろえる）
        heights: b.heights === 'equal' || b.heights === 'photo' ? b.heights : 'auto',
        ...(b.labelColumn === true ? { labelColumn: true } : {}),
        rows: list(b.rows).map((r) => ({ id: idOf(r, 'r'), cells: list(r.cells).map((c) => ({ id: idOf(c, 'c'), text: str(c.text), imageId: typeof c.imageId === 'string' ? c.imageId : null, ...cellCrop(c.crop) })) })),
      }
    case 'materialTable':
      return migrateBlock(fromMaterialTable({ ...b, id: idOf(b, 't'), rows: list(b.rows).map((r) => ({ ...r, id: idOf(r, 'r') })) } as Parameters<typeof fromMaterialTable>[0]) as unknown as Raw)
    default:
      return null
  }
}

/** セルの画像の切り抜く位置（数でなければ、切り抜かない） */
function cellCrop(raw: unknown): { crop?: { x: number; y: number } } {
  const q = raw as { x?: unknown; y?: unknown } | null | undefined
  return q && typeof q.x === 'number' && typeof q.y === 'number' && Number.isFinite(q.x) && Number.isFinite(q.y) ? { crop: { x: clampPercent(q.x), y: clampPercent(q.y) } } : {}
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

/**
 * 作品写真の1ページ（前の版の原稿は、作品写真が1ページだけで、この形のまま workPhotos に入っていた）。
 * 3枚の並べ方はなくしたため4枚にする。6枚の並べ方もなくしたため（mockups/v38）、4枚にして、5・6枚目の写真は次のページに移す
 * （写真は消さない。次のページは、移した写真の数に合わせて1枚か2枚（上下）にする。空いている枠を作らないため）
 */
function migratePhotoPage(photos: Raw): WorkPhotoPage[] {
  const raw = photos.layout === 3 ? 4 : photos.layout
  const imageIds = Array.isArray(photos.imageIds) ? (photos.imageIds as unknown[]).map((x) => (typeof x === 'string' ? x : '')) : []
  const positions = Array.isArray(photos.positions)
    ? (photos.positions as unknown[]).map((p) => {
        const q = p as { x?: unknown; y?: unknown } | null
        return q && typeof q.x === 'number' && typeof q.y === 'number' ? { x: clampPercent(q.x), y: clampPercent(q.y) } : null
      })
    : undefined
  // 「全体を入れる（切らない）」（mockups/v32 ③）。前の版の原稿にはないので、今までどおり、どの写真も枠いっぱいに切り抜く
  const whole = Array.isArray(photos.whole) ? (photos.whole as unknown[]).map((x) => x === true) : []
  /** 写真ごとに並べて持つ値を、枠の番号 indexes の分だけ取り出して1ページにする */
  const page = (layout: WorkPhotoLayout, indexes: number[], columns?: number): WorkPhotoPage => {
    const w = indexes.map((i) => whole[i] === true)
    return {
      layout,
      imageIds: indexes.map((i) => imageIds[i] ?? ''),
      ...(columns ? { columns } : {}),
      ...(positions ? { positions: indexes.map((i) => positions[i] ?? null) } : {}),
      ...(w.some(Boolean) ? { whole: w } : {}),
    }
  }
  const all = (from: number) => Array.from({ length: Math.max(0, imageIds.length - from) }, (_, i) => from + i)
  if (raw === 6) {
    // 1ページ目：1〜4枚目の枠（と、前の版でも隠れていた7枚目から後ろ）。2ページ目：5・6枚目の枠の写真
    const first = page(4, [0, 1, 2, 3, ...all(6)])
    const moved = [4, 5].filter((i) => imageIds[i])
    if (moved.length === 0) return [first]
    return [first, moved.length === 2 ? page(2, moved, 1) : page(1, moved)]
  }
  const layout = ([1, 2, 4] as const).find((n) => n === raw) ?? 1
  // 並べ方は、その枚数で選べるものだけ残す（なければ既定の並べ方）
  const columns = typeof photos.columns === 'number' && photoGrid({ layout, columns: photos.columns }).columns === photos.columns ? photos.columns : undefined
  return [page(layout, all(0), columns)]
}

/** 作品写真のページの並び（前の版の原稿は1ページの形。ページがなければ、空の1ページ） */
function migratePhotos(photos: unknown): WorkPhotoPage[] {
  // ページの並び（新しい形）の中の、ページでないもの（壊れた値）は捨てる
  const pages = Array.isArray(photos) ? list(photos.filter((p) => obj(p) === p)).flatMap(migratePhotoPage) : migratePhotoPage(obj(photos))
  return pages.length ? pages : [{ layout: 1, imageIds: [] }]
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
  return {
    formatVersion: DATA_FORMAT_VERSION,
    fiscalYear: typeof raw.fiscalYear === 'number' ? raw.fiscalYear : 0,
    basicInfo: { studentId: str(basic.studentId), name: str(basic.name), courseId: str(basic.courseId), subtitleInput: str(basic.subtitleInput) },
    abstract: migrateAbstract(abstract),
    body: migrateBody(list(raw.body)),
    references: migrateReferences(raw.references),
    ...(Array.isArray(raw.acknowledged) ? { acknowledged: (raw.acknowledged as unknown[]).filter((k): k is string => typeof k === 'string') } : {}),
    workPhotos: migratePhotos(raw.workPhotos),
    updatedAt: str(raw.updatedAt) || new Date().toISOString(),
  }
}
