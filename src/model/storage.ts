import { forgetLayoutMemory } from '../layout/memory'
import { migrateReport } from './migrate'
import { scoped } from './scope'
import type { Report } from './types'

/**
 * ブラウザ内への自動保存（IndexedDB）。学生のデータは外部に送らない。
 * - report: 書きかけの報告書（1件）
 * - images: 写真（Blob）。報告書からは ID で参照する
 * - snapshots: 一定時間ごとの控え（最新の数件を残し、誤って消したときに戻せるようにする）
 */

const DB_NAME = scoped('sotsugyo-seisaku-report')
const DB_VERSION = 1
const REPORT_KEY = 'current'
const MAX_SNAPSHOTS = 20
/** 入れ替える前の原稿の控え（選ばなかった原稿など）は、これとは別に最大10件残す */
const MAX_KEPT_SNAPSHOTS = 10

export interface StoredImage {
  id: string
  blob: Blob
  widthPx: number
  heightPx: number
}

export interface Snapshot {
  savedAt: string
  report: Report
  /** 入れ替える前の原稿の控え（押し出されない） */
  keep?: boolean
  /** 控えの一覧に、時刻と並べて出す名前（例：Word を読み込む前）。どの控えに戻せばよいか分かるように */
  label?: string
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

/**
 * 閉じる直前の原稿の写し（localStorage）。書いてすぐ読み込み直す・閉じると、IndexedDB への保存は途中で止まることがあるため、
 * 閉じる直前に、すぐ書き終わる localStorage にも写しておく（useAutosave）。次に開いたとき、保存した原稿より新しければこちらを使う
 */
const LEAVING_KEY = scoped('sotsugyo-seisaku-report-leaving')

/** 閉じる直前の原稿を写しておく（すぐ書き終わる。写せなければ何もしない） */
export function keepLeavingCopy(report: Report): void {
  try {
    localStorage.setItem(LEAVING_KEY, JSON.stringify(report))
  } catch {
    // 空きがない・使えないブラウザ：IndexedDB への保存に任せる
  }
}

/** 閉じる直前の写しを消す（IndexedDB に保存できたとき・この端末から原稿を消すとき） */
export function clearLeavingCopy(): void {
  try {
    localStorage.removeItem(LEAVING_KEY)
  } catch {
    // 使えないブラウザ
  }
}

/** 閉じる直前の写し（なければ・読めなければ null） */
function readLeavingCopy(): Report | null {
  try {
    const raw = localStorage.getItem(LEAVING_KEY)
    return raw ? migrateReport(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export async function loadReport(): Promise<Report | null> {
  const raw = await promisify((await store('report', 'readonly')).get(REPORT_KEY))
  const saved = raw ? migrateReport(raw) : null
  // 閉じる直前の写しが、保存した原稿より新しい（保存が間に合わなかった）：写しを保存して使う
  const leaving = readLeavingCopy()
  if (leaving && (!saved || leaving.updatedAt > saved.updatedAt)) {
    await saveReport(leaving)
    clearLeavingCopy()
    return leaving
  }
  if (leaving) clearLeavingCopy()
  return saved
}

export async function saveReport(report: Report): Promise<void> {
  await promisify((await store('report', 'readwrite')).put(report, REPORT_KEY))
}

/** 原稿の入れ物に、原稿とは別の名前で置いたもの（お試しで、管理ページから受け取った年度の設定と見本の原稿：src/trial/openTrial.ts） */
export async function loadValue<T>(key: string): Promise<T | undefined> {
  return (await promisify((await store('report', 'readonly')).get(key))) as T | undefined
}

export async function saveValue(key: string, value: unknown): Promise<void> {
  await promisify((await store('report', 'readwrite')).put(value, key))
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

/**
 * 控えを保存し、古いものは消す。
 * keep：選ばなかった原稿・作り直す前の原稿など、入れ替える前の原稿の控え。10分ごとの控えに押し出されて消えないよう、別に数える。
 * label：控えの一覧に出す名前（例：Word を読み込む前）
 */
export async function saveSnapshot(report: Report, savedAt = new Date().toISOString(), keep = false, label?: string): Promise<void> {
  await promisify((await store('snapshots', 'readwrite')).put({ savedAt, report, ...(keep ? { keep } : {}), ...(label ? { label } : {}) }))
  const all = (await promisify((await store('snapshots', 'readonly')).getAll())) as Snapshot[]
  const oldest = (list: Snapshot[], max: number) => list.sort((a, b) => a.savedAt.localeCompare(b.savedAt)).slice(0, Math.max(0, list.length - max))
  const old = [...oldest(all.filter((x) => !x.keep), MAX_SNAPSHOTS), ...oldest(all.filter((x) => x.keep), MAX_KEPT_SNAPSHOTS)]
  const s = await store('snapshots', 'readwrite')
  await Promise.all(old.map((x) => promisify(s.delete(x.savedAt))))
}

/** 入れ替える前の原稿の控え（押し出されない控え）を保存する。label：控えの一覧に出す名前（例：作り直す前） */
export const keepSnapshot = (report: Report, label?: string) => saveSnapshot(report, new Date().toISOString(), true, label)

export async function listSnapshots(): Promise<Snapshot[]> {
  const all = (await promisify((await store('snapshots', 'readonly')).getAll())) as Snapshot[]
  return all.sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

/** この端末（ブラウザ）から、原稿・写真・控えをすべて消す（共用のパソコンで書き終えたとき） */
export async function clearAll(): Promise<void> {
  for (const name of ['report', 'images', 'snapshots']) await promisify((await store(name, 'readwrite')).clear())
  clearLeavingCopy()
  // 前に開いたときの紙面の組み方（ページ数など。原稿の文字は入っていない）も忘れる
  forgetLayoutMemory()
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
  // 作品写真は、どのページの写真も（並べ方で隠れている写真も、並べ方を戻すと出るので残す）
  ids.push(...report.workPhotos.flatMap((p) => p.imageIds))
  return ids.filter(Boolean)
}
