import { findCourse, type YearConfig } from '../config'
import { usable } from '../config/remote'
import { migrateReport } from '../model/migrate'
import { TRIAL_PARAM } from '../model/scope'
import type { Report } from '../model/types'
import { FROM_ADMIN, NONCE_PATTERN } from '../template/protocol'

/**
 * お試し（学生のツールを ?trial=1 で、別のタブに開いたもの。先生が、見本の原稿で学生の画面を試す：依頼者の選択 2026-10-22 案1）と、
 * 管理ページのやり取り。管理ページは「見本の原稿で開く」を押したときに別のタブを開き、ブラウザの postMessage で、年度の設定と見本の原稿を渡す。
 *
 * 守ること（ひな形を作る画面：src/template/protocol.ts と同じ決まり）：
 * - 管理ページは、ツールの場所（toolOrigin）から、開いたタブが送った、開くたびに作る合言葉（nonce）の付いた返事だけを受け取る
 * - ツールは、管理ページの場所（isAllowedParentOrigin）から、このタブを開いた窓（window.opener）が送った「trial」だけを受け取る
 * - 見本の原稿（文章）は、管理ページのサーバーが、登録された先生と管理者にだけ渡す（学生は開けない）。写真はツールの public/trial/ に置く
 * - お試しは、学生の原稿・ドライブ・先生のフォルダには何も触れない。保存は、このブラウザの別の名前の入れ物だけ（src/model/scope.ts）
 */

export { TRIAL_PARAM }
/** ツールからの返事の送り主の印 */
export const FROM_TRIAL = 'sotsugyo-trial'
/** 管理ページが開くタブの名前（もう一度押すと、同じタブで開き直す） */
export const TRIAL_WINDOW = 'sotsugyo-trial'

/** 見本の写真：原稿の中の画像の ID と、ツールの public/trial/ の中のファイルの名前と、取り込む大きさ（長い辺の画素） */
export interface TrialImage {
  id: string
  file: string
  maxPx: number
}

/** 見本の原稿（管理ページのサーバーが、先生と管理者にだけ渡す：gas/admin-project/Code.js の getTrialSample） */
export interface TrialSample {
  report: Report
  images: TrialImage[]
}

/** 管理ページからツールへ渡すもの */
export interface TrialPayload {
  /** 公開中の年度の設定（学生が見るものと同じ） */
  config: YearConfig
  sample: TrialSample
}

export interface TrialMessage {
  source: typeof FROM_ADMIN
  type: 'trial'
  nonce: string
  payload: TrialPayload
}

/** ツールから管理ページへの返事（受け取った） */
export interface TrialAck {
  source: typeof FROM_TRIAL
  type: 'ack'
  nonce: string
}

/** ツールの URL から、お試しで開く URL（?trial=1）と、その場所（origin） */
export function trialToolUrls(base: string): { href: string; origin: string } {
  const url = new URL(base)
  url.search = ''
  url.hash = ''
  url.searchParams.set(TRIAL_PARAM, '1')
  return { href: url.href, origin: url.origin }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** 写真の ID とファイルの名前の形（ほかの場所のファイルを読まないよう、名前だけ） */
const IMAGE_ID = /^[\w-]{1,64}$/
const IMAGE_FILE = /^[\w-]{1,64}\.jpg$/

/** 受け取った見本の形を確かめる（崩れていたら null） */
export function readTrialSample(raw: unknown): TrialSample | null {
  if (!isObj(raw) || !Array.isArray(raw.images)) return null
  const images: TrialImage[] = []
  for (const img of raw.images) {
    if (!isObj(img) || typeof img.id !== 'string' || !IMAGE_ID.test(img.id) || typeof img.file !== 'string' || !IMAGE_FILE.test(img.file)) return null
    const maxPx = typeof img.maxPx === 'number' && img.maxPx >= 200 && img.maxPx <= 2400 ? Math.round(img.maxPx) : 1600
    images.push({ id: img.id, file: img.file, maxPx })
  }
  try {
    return { report: migrateReport(raw.report), images }
  } catch {
    return null
  }
}

/** 受け取ったもの（init の中身）の形を確かめる（崩れていたら null） */
export function readTrialPayload(raw: unknown): TrialPayload | null {
  if (!isObj(raw)) return null
  const config = usable(raw.config)
  const sample = readTrialSample(raw.sample)
  return config && sample ? { config, sample } : null
}

/**
 * 見本の原稿を、その年度の設定に合わせる（年度・コース。見本のコースがなければ、いちばん上のコース）。
 * 開くたびに新しい写しを作る（「見本に戻す」で、試した内容を消して最初の状態に戻すため）
 */
export function sampleReport({ config, sample }: TrialPayload): Report {
  const report = structuredClone(sample.report)
  const course = findCourse(config, report.basicInfo.courseId)
  const courseId = course && !course.hidden ? course.id : (config.courses.find((c) => !c.hidden)?.id ?? '')
  return { ...report, fiscalYear: config.fiscalYear, basicInfo: { ...report.basicInfo, courseId }, updatedAt: new Date().toISOString() }
}

/** ツールが受け取ってよい知らせか（形だけ。送り主の場所と窓は、受け取る側で確かめる） */
export function isTrialMessage(data: unknown): data is { source: typeof FROM_ADMIN; type: 'trial'; nonce: string; payload: unknown } {
  return isObj(data) && data.source === FROM_ADMIN && data.type === 'trial' && typeof data.nonce === 'string' && NONCE_PATTERN.test(data.nonce)
}
