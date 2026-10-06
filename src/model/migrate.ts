import { clampPercent, photoGrid } from './photos'
import { fromMaterialTable } from './table'
import type { Report } from './types'
import { DATA_FORMAT_VERSION } from './types'

/**
 * 保存データ（自動保存・バックアップファイル）を、今の形式の Report にする。
 * 公開後にデータの形を変えるときは DATA_FORMAT_VERSION を上げ、ここに古い形式からの変換を足す。
 * 学生の原稿を失わないことを最優先にし、欠けている項目は既定値で補う。
 */

export class UnsupportedDataError extends Error {}

type Raw = Record<string, unknown>

/** 本文：前の版の素材表（決まった3列）は、行と列を足せる表にする */
function migrateBody(chapters: Raw[]): Report['body'] {
  return chapters.map((c) => ({
    ...(c as unknown as Report['body'][number]),
    blocks: ((c.blocks ?? []) as Raw[]).map((b) =>
      b.type === 'materialTable' ? fromMaterialTable(b as Parameters<typeof fromMaterialTable>[0]) : (b as unknown as Report['body'][number]['blocks'][number]),
    ),
  }))
}

/** 抄録：「書き始めたか」がない前の版の原稿は、抄録をすでに書いていれば書き始めているとみなす（書いた抄録を隠さない） */
function migrateAbstract(abstract: Raw): Report['abstract'] {
  const paragraphs = Array.isArray(abstract.paragraphs) ? (abstract.paragraphs as Report['abstract']['paragraphs']) : []
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
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  return {
    formatVersion: DATA_FORMAT_VERSION,
    fiscalYear: typeof raw.fiscalYear === 'number' ? raw.fiscalYear : 0,
    basicInfo: { studentId: str(basic.studentId), name: str(basic.name), courseId: str(basic.courseId), subtitleInput: str(basic.subtitleInput) },
    abstract: migrateAbstract(abstract),
    body: migrateBody(raw.body as Raw[]),
    references: Array.isArray(raw.references) ? (raw.references as Report['references']) : [],
    workPhotos: migratePhotos(photos),
    updatedAt: str(raw.updatedAt) || new Date().toISOString(),
  }
}
