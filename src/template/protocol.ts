import type { TemplateBlock, YearConfig } from '../config'
import { LIMITS, templateProblems, tooLong } from '../config/validate'

/**
 * ひな形を作る画面（学生のツールを ?template=1 で開いたもの）と、管理ページのやり取り（mockups/v44 案A・管理ページの上に重ねて開く）。
 * 管理ページは、重ねた窓の中の iframe に学生のツールを開き、ブラウザの postMessage でひな形を渡し、受け取る。
 *
 * 守ること：
 * - 管理ページは、ツールの場所（toolOrigin）から、その iframe が送った、開くたびに作る合言葉（nonce）の付いた知らせだけを受け取る
 * - ツールは、管理ページの場所（Apps Script のウェブアプリの枠 https://〜.googleusercontent.com。開発中だけ手元の開発サーバー）から、
 *   親の窓が送った「init」だけを受け取る。受け取ったら、その場所にだけ返事をする（ほかの場所には何も送らない）
 * - ひな形を作る画面は、学生の原稿・ドライブ・この端末の保存には何も触れない（src/template/TemplateApp.tsx）
 */

/** ひな形を作る画面で開く印（学生のツールの URL の ?template=1） */
export const TEMPLATE_PARAM = 'template'
/** 知らせの送り主の印 */
export const FROM_ADMIN = 'sotsugyo-admin'
export const FROM_TOOL = 'sotsugyo-template'

/** 学生のツールの場所（ふだん。toolUrl.ts） */
export { DEFAULT_TOOL_URL } from './toolUrl'

export type TemplateYearStatus = '公開中' | '準備中' | '終了'

/** 管理ページからツールへ渡すもの */
export interface InitPayload {
  courseId: string
  courseName: string
  /** 管理ページの、まだ保存していない変更も入ったひな形（空なら標準のひな形） */
  template: TemplateBlock[]
  abstractExample: string
  /** 表紙・抄録を組むための年度の設定（コースは、このコースだけ） */
  config: YearConfig
  /** 年度の状態（右の欄の「学生に届くのは…」の言葉を変える） */
  status: TemplateYearStatus
}

export interface InitMessage {
  source: typeof FROM_ADMIN
  type: 'init'
  nonce: string
  payload: InitPayload
}

/** ツールから管理ページへ送るもの */
export type ToolMessage =
  /** init を受け取った（管理ページは、これが来るまで init を送り直す） */
  | { type: 'ack' }
  /** 開いたときから直したか（「やめる」「×」で確かめるかどうか） */
  | { type: 'dirty'; dirty: boolean }
  /** 「管理ページに戻して反映」 */
  | { type: 'apply'; template: TemplateBlock[]; abstractExample: string }
  /** 「やめる」 */
  | { type: 'cancel' }

export type ToolEnvelope = ToolMessage & { source: typeof FROM_TOOL; nonce: string }

/** 合言葉の形（32字の16進） */
export const NONCE_PATTERN = /^[0-9a-f]{32}$/

/** 開くたびに作る合言葉（推測できない乱数） */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * ツールが init を受け取ってよい送り主の場所（origin）。
 * 本番：Apps Script のウェブアプリの枠（https://〜.googleusercontent.com。枠の名前は Google が決め、変わることがあるので、そのドメインの下ならよい）。
 * 開発中（dev）だけ：手元の開発サーバー（http://localhost・127.0.0.1）
 */
export function isAllowedParentOrigin(origin: string, dev: boolean): boolean {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  // origin の形そのもの（パス・ユーザー名などがない）であること
  if (url.origin !== origin) return false
  if (url.protocol === 'https:' && url.hostname.endsWith('.googleusercontent.com')) return true
  return dev && url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
}

/** ツールの URL から、iframe に開く URL（?template=1）と、その場所（origin） */
export function templateToolUrls(base: string): { src: string; origin: string } {
  const url = new URL(base)
  url.search = ''
  url.hash = ''
  url.searchParams.set(TEMPLATE_PARAM, '1')
  return { src: url.href, origin: url.origin }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** 受け取った init の中身の形を確かめる（崩れていたら null） */
export function readInitPayload(raw: unknown): InitPayload | null {
  if (!isObj(raw)) return null
  const { courseId, courseName, template, abstractExample, config, status } = raw
  if (typeof courseId !== 'string' || typeof courseName !== 'string' || !Array.isArray(template) || typeof abstractExample !== 'string' || !isObj(config)) return null
  if (status !== '公開中' && status !== '準備中' && status !== '終了') return null
  return { courseId, courseName: courseName.slice(0, 200), template: template as TemplateBlock[], abstractExample, config: config as unknown as YearConfig, status }
}

/** 管理ページが受け取ったひな形の問題（なければ空。保存のときのサーバーと同じ決まり：templateProblems。ふつうはツールが先に確かめるので起きない） */
export function receivedProblems(template: unknown, abstractExample: unknown): string[] {
  const problems: string[] = []
  if (!Array.isArray(template) || template.length === 0) problems.push('ひな形が空です')
  else problems.push(...templateProblems(template).map((p) => `ひな形${p}`))
  if (typeof abstractExample !== 'string') problems.push('抄録の書き出し例の形が正しくありません')
  else if (abstractExample.length > LIMITS.abstractExample) problems.push(`抄録の書き出し例${tooLong(LIMITS.abstractExample, abstractExample.length)}`)
  return problems
}
