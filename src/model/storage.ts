import { migrateReport } from './migrate'
import type { Report } from './types'

/**
 * ブラウザ内への自動保存（IndexedDB）。学生のデータは外部に送らない。
 * - report: 書きかけの報告書（1件）
 * - images: 写真（Blob）。報告書からは ID で参照する
 * - snapshots: 一定時間ごとの控え（最新の数件を残し、誤って消したときに戻せるようにする）
 */

const DB_NAME = 'sotsugyo-seisaku-report'
const DB_VERSION = 1
const REPORT_KEY = 'current'
const MAX_SNAPSHOTS = 20

export interface StoredImage {
  id: string
  blob: Blob
  widthPx: number
  heightPx: number
}

export interface Snapshot {
  savedAt: string
  report: Report
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('report')) db.createObjectStore('report')
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots', { keyPath: 'savedAt' })
    }
    request.onsuccess = () => {
      const db = request.result
      // つながりが切れたら（iPhone の Safari で起きることがある）、次に使うときにつなぎ直す
      db.onclose = () => {
        dbPromise = null
      }
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    request.onerror = () => {
      dbPromise = null
      reject(request.error)
    }
  })
  return dbPromise
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function store(name: string, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  try {
    return (await openDb()).transaction(name, mode).objectStore(name)
  } catch {
    // つながりが使えなくなっていた：一度だけ、つなぎ直してやり直す
    dbPromise = null
    return (await openDb()).transaction(name, mode).objectStore(name)
  }
}

export async function loadReport(): Promise<Report | null> {
  const raw = await promisify((await store('report', 'readonly')).get(REPORT_KEY))
  return raw ? migrateReport(raw) : null
}

export async function saveReport(report: Report): Promise<void> {
  await promisify((await store('report', 'readwrite')).put(report, REPORT_KEY))
}

export async function putImage(image: StoredImage): Promise<void> {
  await promisify((await store('images', 'readwrite')).put(image))
}

export async function getImage(id: string): Promise<StoredImage | undefined> {
  return promisify((await store('images', 'readonly')).get(id))
}

export async function allImages(): Promise<StoredImage[]> {
  return promisify((await store('images', 'readonly')).getAll())
}

export async function deleteImage(id: string): Promise<void> {
  await promisify((await store('images', 'readwrite')).delete(id))
}

/** 控えを保存し、古いものは消す */
export async function saveSnapshot(report: Report, savedAt = new Date().toISOString()): Promise<void> {
  await promisify((await store('snapshots', 'readwrite')).put({ savedAt, report }))
  const keys = (await promisify((await store('snapshots', 'readonly')).getAllKeys())) as string[]
  const old = keys.sort().slice(0, Math.max(0, keys.length - MAX_SNAPSHOTS))
  const s = await store('snapshots', 'readwrite')
  await Promise.all(old.map((k) => promisify(s.delete(k))))
}

export async function listSnapshots(): Promise<Snapshot[]> {
  const all = (await promisify((await store('snapshots', 'readonly')).getAll())) as Snapshot[]
  return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

/** この端末（ブラウザ）から、原稿・写真・控えをすべて消す（共用のパソコンで書き終えたとき） */
export async function clearAll(): Promise<void> {
  for (const name of ['report', 'images', 'snapshots']) await promisify((await store(name, 'readwrite')).clear())
}

/** 報告書で使われていない写真を消す（容量の節約） */
export async function removeUnusedImages(report: Report): Promise<number> {
  const used = new Set(usedImageIds(report))
  const unused = (await allImages()).filter((img) => !used.has(img.id))
  await Promise.all(unused.map((img) => deleteImage(img.id)))
  return unused.length
}

export function usedImageIds(report: Report): string[] {
  const ids: string[] = []
  for (const block of report.body.flatMap((c) => c.blocks)) {
    if (block.type === 'figureRow') ids.push(...block.figures.map((f) => f.imageId))
    if (block.type === 'table') ids.push(...block.rows.flatMap((r) => r.cells.map((c) => c.imageId ?? '')))
  }
  ids.push(...report.workPhotos.imageIds)
  return ids.filter(Boolean)
}
