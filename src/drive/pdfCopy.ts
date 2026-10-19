import type { Report } from '../model/types'

/**
 * 書き出した PDF の控えを、先生のドライブのフォルダ（学科の Apps Script「卒業制作報告書_配信」が置く。学生からは見えない）に送る。
 * 学生が「PDFを書き出す」で PDF を作るたびに、同じ PDF を後ろで送る（学生の画面には何も出さない。決まったこと。送れなかったら、開発ツールのコンソールにだけ書く）。
 * - 送り先は年度の設定と同じ窓口（VITE_CONFIG_API_URL）。中身は JSON を text/plain で送る（ブラウザの事前の問い合わせ（CORS の preflight）が要らない形）
 * - 誰が送ったかは、ログインの許可（アクセストークン）で窓口が Google に確かめる（gas/api-project/Code.js の doPost）
 * - フォルダには、学生ごとに1つのファイル（送るたびに中身を新しくする。前の版はドライブの「版の管理」に残る）
 */

/** 窓口が受け取る形（gas/api-project/Code.js の pdfCopy_） */
export interface PdfCopyPayload {
  action: 'pdfCopy'
  /** ログインの許可（アクセストークン）。窓口が Google に確かめるだけで、保存しない */
  token: string
  /** 原稿の年度 */
  year: number
  courseId: string
  /** 表紙の学籍番号（学生のアカウントなら、窓口がアカウントの学籍番号と同じかを確かめる） */
  studentId: string
  /** 表紙の氏名（ファイル名では、空白を詰める） */
  name: string
  /** PDF の中身（base64） */
  pdf: string
}

/** 送れる PDF の大きさの上限（窓口の上限と同じ 40MB。ふつうは数 MB） */
export const PDF_COPY_MAX_BYTES = 40 * 1024 * 1024

/** ファイルの中身を base64 の文字にする（少しずつ文字にして、大きな PDF でも止まらないように） */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const chunks: string[] = []
  const size = 0x8000
  for (let i = 0; i < bytes.length; i += size) chunks.push(String.fromCharCode(...bytes.subarray(i, i + size)))
  return btoa(chunks.join(''))
}

/** 窓口に送る中身を作る（原稿の年度・コース・表紙の学籍番号と氏名、PDF） */
export async function pdfCopyPayload(token: string, report: Report, pdf: Blob): Promise<PdfCopyPayload> {
  const { courseId, studentId, name } = report.basicInfo
  return { action: 'pdfCopy', token, year: report.fiscalYear, courseId: courseId ?? '', studentId: studentId.trim(), name: name.trim(), pdf: await blobToBase64(pdf) }
}

/** 窓口が断った・答えが読めなかった（やり直さない） */
export class PdfCopyError extends Error {}

/**
 * 窓口に送る。つながらなかった（fetch が投げた）ときだけ、少し待って1回やり直す。
 * 窓口が ok を返さなければ PdfCopyError を投げる（理由は error）。
 * Google のログインの情報（cookie）は送らない（誰かは、トークンで確かめる）
 */
export async function postPdfCopy(url: string, payload: PdfCopyPayload, options: { fetch?: typeof fetch; retryDelayMs?: number } = {}): Promise<void> {
  const send = options.fetch ?? fetch
  const body = JSON.stringify(payload)
  const once = () => send(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, credentials: 'omit', redirect: 'follow' })
  let res: Response
  try {
    res = await once()
  } catch {
    await new Promise((resolve) => setTimeout(resolve, options.retryDelayMs ?? 3000))
    res = await once()
  }
  if (!res.ok) throw new PdfCopyError(`窓口の答え：${res.status}`)
  let answer: { ok?: boolean; error?: string }
  try {
    answer = await res.json()
  } catch {
    throw new PdfCopyError('窓口の答えを読めませんでした')
  }
  if (answer?.ok !== true) throw new PdfCopyError(answer?.error || '窓口が受け取りませんでした')
}
