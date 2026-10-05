import { useCallback, useRef, useState } from 'react'
import { saveReport, saveSnapshot } from '../model/storage'
import type { Report } from '../model/types'

export type SaveState = { status: 'idle' } | { status: 'saving' } | { status: 'saved'; at: Date } | { status: 'error'; message: string }

const SAVE_DELAY_MS = 800
/** 控え（誤って消したときに戻せる版）を残す間隔 */
const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000

/** 報告書が変わるたびに、少し待ってからブラウザ内に保存する */
export function useAutosave() {
  const [state, setState] = useState<SaveState>({ status: 'idle' })
  const timer = useRef<number | undefined>(undefined)
  const lastSnapshot = useRef(0)

  const save = useCallback((report: Report) => {
    clearTimeout(timer.current)
    setState({ status: 'saving' })
    timer.current = window.setTimeout(async () => {
      try {
        await saveReport(report)
        if (Date.now() - lastSnapshot.current > SNAPSHOT_INTERVAL_MS) {
          lastSnapshot.current = Date.now()
          await saveSnapshot(report)
        }
        setState({ status: 'saved', at: new Date() })
      } catch (e) {
        setState({ status: 'error', message: String(e) })
      }
    }, SAVE_DELAY_MS)
  }, [])

  return { state, save }
}
