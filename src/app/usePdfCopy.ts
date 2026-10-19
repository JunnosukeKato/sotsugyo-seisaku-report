import { useEffect, useMemo, useRef } from 'react'
import type { DriveSync } from '../drive/driveSync'
import { PDF_COPY_MAX_BYTES, pdfCopyPayload, postPdfCopy } from '../drive/pdfCopy'
import type { Report } from '../model/types'
import type { BuiltPdf } from '../pdf/exportPdf'

/** 送り先：年度の設定と同じ、学科の Apps Script の窓口 */
const API_URL = import.meta.env.VITE_CONFIG_API_URL as string | undefined

/**
 * 書き出した PDF の控えを、先生のドライブのフォルダに送る（drive/pdfCopy.ts）。
 * ドライブにログインして使っているときだけ（この端末だけに保存するとき・?nodrive・管理ページでドライブ保存を止めているときは送らない）。
 * 学生の画面には何も出さない（決まったこと）。送れなかったら、開発ツールのコンソールにだけ書く。
 * - onStart：「PDF を保存する（作る）」を押したとき。許可が切れそうなら延ばしておく（パソコンだけ）
 * - onBuilt：PDF ができたとき。後ろで送る（保存・共有を待たせない）。許可が切れていたら、ログインし直すまで待つ（いちばん新しい PDF だけ）
 * - onClosed：PDF の窓を閉じたとき。許可が切れて待っていたら、「もう一度ログイン」の窓を出す
 */
export function usePdfCopy(drive: DriveSync | null, enabled: boolean) {
  /** 許可が切れていて、まだ送れていない控え */
  const waiting = useRef<{ pdf: Blob; report: Report } | null>(null)
  const enabledRef = useRef(enabled)
  useEffect(() => {
    enabledRef.current = enabled
    if (!enabled) waiting.current = null
  }, [enabled])

  const copier = useMemo(() => {
    const send = async (pdf: Blob, report: Report) => {
      if (!drive || !API_URL || !enabledRef.current) return
      if (pdf.size > PDF_COPY_MAX_BYTES) {
        console.warn(`PDF の控えを先生のフォルダに送りませんでした（大きすぎます：${Math.round(pdf.size / 1024 / 1024)}MB）`)
        return
      }
      const token = await drive.copyToken()
      if (!token) {
        waiting.current = { pdf, report }
        return
      }
      waiting.current = null
      try {
        await postPdfCopy(API_URL, await pdfCopyPayload(token.accessToken, report, pdf))
      } catch (e) {
        console.error('PDF の控えを先生のフォルダに送れませんでした：', e instanceof Error ? e.message : e)
      }
    }
    return {
      onStart: () => {
        if (drive && API_URL && enabledRef.current) drive.renewForExport()
      },
      onBuilt: (pdf: BuiltPdf, report: Report) => {
        void send(pdf.blob, report)
      },
      onClosed: () => {
        if (waiting.current) drive?.noticeExpired()
      },
      /** 許可が使えるようになったら（ログインし直した）、待っていた控えを送る */
      retry: () => {
        const w = waiting.current
        if (w && drive?.tokenValid) {
          waiting.current = null
          void send(w.pdf, w.report)
        }
      },
    }
  }, [drive])

  useEffect(() => (drive ? drive.subscribe(copier.retry) : undefined), [drive, copier])
  return copier
}
