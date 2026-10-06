import { useCallback, useEffect, useRef, useState } from 'react'
import { saveReport, saveSnapshot } from '../model/storage'
import type { Report } from '../model/types'

export type SaveState = { status: 'idle' } | { status: 'saving' } | { status: 'saved'; at: Date } | { status: 'error'; message: string }

const SAVE_DELAY_MS = 800
/** 控え（誤って消したときに戻せる版）を残す間隔 */
const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000

/**
 * 報告書が変わるたびに、少し待ってから（書くのをやめて約1秒後に）ブラウザ内に保存する。
 * 1文字ごとに保存すると書く速さに追いつかないため、まとめて保存する。
 * 保存する前にタブを閉じたり、ほかのアプリへ切り替えたりしたときは、すぐ保存する。
 */
export function useAutosave() {
  const [state, setState] = useState<SaveState>({ status: 'idle' })
  const timer = useRef<number | undefined>(undefined)
  const pending = useRef<Report | null>(null)
  const lastSnapshot = useRef(0)

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const report = pending.current
    if (!report) return
    pending.current = null
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
  }, [])

  const save = useCallback(
    (report: Report) => {
      clearTimeout(timer.current)
      pending.current = report
      setState({ status: 'saving' })
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS)
    },
    [flush],
  )

  useEffect(() => {
    const now = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    const onHide = () => void flush()
    document.addEventListener('visibilitychange', now)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', now)
      window.removeEventListener('pagehide', onHide)
    }
  }, [flush])

  return { state, save }
}
