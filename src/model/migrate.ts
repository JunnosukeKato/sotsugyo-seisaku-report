import type { Report } from './types'
import { DATA_FORMAT_VERSION } from './types'

/**
 * 保存データ（自動保存・バックアップファイル）を、今の形式の Report にする。
 * 公開後にデータの形を変えるときは DATA_FORMAT_VERSION を上げ、ここに古い形式からの変換を足す。
 * 学生の原稿を失わないことを最優先にし、欠けている項目は既定値で補う。
 */

export class UnsupportedDataError extends Error {}

type Raw = Record<string, unknown>

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
    abstract: { paragraphs: Array.isArray(abstract.paragraphs) ? (abstract.paragraphs as Report['abstract']['paragraphs']) : [] },
    body: raw.body as Report['body'],
    references: Array.isArray(raw.references) ? (raw.references as Report['references']) : [],
    workPhotos: {
      layout: ([1, 2, 3, 4, 6] as const).find((n) => n === photos.layout) ?? 1,
      imageIds: Array.isArray(photos.imageIds) ? (photos.imageIds as string[]) : [],
    },
    updatedAt: str(raw.updatedAt) || new Date().toISOString(),
  }
}
