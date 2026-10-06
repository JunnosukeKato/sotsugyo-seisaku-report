import { migrateReport } from './migrate'
import type { StoredImage } from './storage'
import type { Report } from './types'

/**
 * バックアップファイル（.json）。報告書と写真を1つのファイルにまとめる。
 * 別のパソコンで続きを書くときや、ブラウザのデータが消えたときに、このファイルから復元する。
 */

const KIND = 'sotsugyo-seisaku-report-backup'

interface BackupFile {
  kind: typeof KIND
  savedAt: string
  report: unknown
  images: { id: string; type: string; widthPx: number; heightPx: number; base64: string }[]
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function createBackup(report: Report, images: StoredImage[], savedAt = new Date().toISOString()): Promise<string> {
  const file: BackupFile = {
    kind: KIND,
    savedAt,
    report,
    images: await Promise.all(
      images.map(async (img) => ({
        id: img.id,
        type: img.blob.type,
        widthPx: img.widthPx,
        heightPx: img.heightPx,
        base64: toBase64(new Uint8Array(await img.blob.arrayBuffer())),
      })),
    ),
  }
  return JSON.stringify(file)
}

export class BackupFormatError extends Error {}

export function readBackup(text: string): { report: Report; images: StoredImage[]; savedAt: string } {
  let parsed: BackupFile
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new BackupFormatError('バックアップファイルを読み込めませんでした（ファイルが壊れているか、別のファイルです）')
  }
  if (parsed?.kind !== KIND) throw new BackupFormatError('このツールのバックアップファイルではありません')
  return {
    report: migrateReport(parsed.report),
    savedAt: parsed.savedAt,
    images: (parsed.images ?? []).map((img) => ({
      id: img.id,
      widthPx: img.widthPx,
      heightPx: img.heightPx,
      blob: new Blob([fromBase64(img.base64) as BlobPart], { type: img.type }),
    })),
  }
}

/** バックアップファイルの名前（例：卒業制作報告書_バックアップ_00ZZ0123_20261005-1432.json） */
export function backupFileName(report: Report, now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  const who = report.basicInfo.studentId.trim() || '未入力'
  return `卒業制作報告書_バックアップ_${who}_${stamp}.json`
}
