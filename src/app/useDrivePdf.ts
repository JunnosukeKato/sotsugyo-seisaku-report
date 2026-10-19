import { useEffect, useMemo, useRef, useState } from 'react'
import { DriveError } from '../drive/driveApi'
import type { DriveSync } from '../drive/driveSync'
import type { BuiltPdf } from '../pdf/exportPdf'

/** 自分のドライブに PDF を置いている途中（sending）・置いた（done）。置かない・置けなかったときは null（何も出さない） */
export type DrivePdfState = 'sending' | 'done' | null

/** 置けなかったとき、やり直すまで（1回だけ。先生のフォルダへの控えと同じ。drive/pdfCopy.ts） */
const RETRY_MS = 3000

/** やり直せば置けるかもしれないエラーか（電波・Google 側の一時的な問題）。許可切れ・容量がいっぱいなどは、やり直さない */
const retryable = (e: unknown) => !(e instanceof DriveError) || ['network', 'server', 'rate', 'unknown'].includes(e.code)

/**
 * 書き出した PDF を、学生本人のドライブの「卒業制作報告書」フォルダ（原稿.json と同じ所）にも置く（drive/driveSync.ts の savePdf）。
 * 提出用の名前（例：00ZZ0123_文化花子.pdf）の1つのファイルを、書き出すたびに新しくする（前の版はドライブに残る）。作り直さずに、できた PDF をそのまま置く。
 * ドライブにログインして使っているときだけ。この端末だけに保存するとき・?nodrive・管理ページでドライブ保存を止めている・
 * 許可が切れているときは、黙って飛ばす（ログインの窓は出さない）。
 * 置くのは後ろで（保存・共有を待たせない）。置けなかったら、少し待って1回だけやり直し、だめなら開発ツールのコンソールにだけ書く。
 * state は PDF の窓に1行で出す（置いています… → 置きました。置かない・置けなかったときは出さない。app/ExportDialog.tsx）
 */
export function useDrivePdf(drive: DriveSync | null, enabled: boolean) {
  const [state, setState] = useState<DrivePdfState>(null)
  const enabledRef = useRef(enabled)
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])
  /** 何回目に書き出した PDF か（前に書き出した PDF の結果で、今の窓の1行を変えないように） */
  const seq = useRef(0)

  const actions = useMemo(() => {
    const put = async (pdf: BuiltPdf, id: number) => {
      const finish = (next: DrivePdfState) => {
        if (seq.current === id) setState(next)
      }
      try {
        let placed: boolean
        try {
          placed = await drive!.savePdf(pdf.blob, pdf.fileName)
        } catch (e) {
          if (!retryable(e)) throw e
          await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
          placed = await drive!.savePdf(pdf.blob, pdf.fileName)
        }
        finish(placed ? 'done' : null)
      } catch (e) {
        console.error('PDF をドライブの「卒業制作報告書」フォルダに置けませんでした：', e instanceof Error ? e.message : e)
        finish(null)
      }
    }
    return {
      /** PDF ができたとき（後ろで置く） */
      onBuilt: (pdf: BuiltPdf) => {
        const id = ++seq.current
        if (!drive || !enabledRef.current || !drive.canSavePdf) {
          setState(null)
          return
        }
        setState('sending')
        void put(pdf, id)
      },
    }
  }, [drive])

  return { state, ...actions }
}
