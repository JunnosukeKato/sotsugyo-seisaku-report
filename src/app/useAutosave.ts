import { useCallback, useEffect, useRef, useState } from 'react'
import { saveReport, saveSnapshot } from '../model/storage'
import type { Report } from '../model/types'

export type SaveState = { status: 'idle' } | { status: 'saving' } | { status: 'saved'; at: Date } | { status: 'error'; message: string }

const SAVE_DELAY_MS = 800
/** 控え（誤って消したときに戻せる版）を残す間隔 */
const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000
/** 保存できなかったときに、保存し直すまで */
const RETRY_MS = 5000

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
  const stopped = useRef(false)

  const flush = useCallback(async function run(): Promise<void> {
    clearTimeout(timer.current)
    const report = pending.current
    if (!report || stopped.current) return
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
      // 保存できなかった版は残しておき、少したってから保存し直す（その間に書いた新しい版があれば、そちらを保存する）
      pending.current ??= report
      clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void run(), RETRY_MS)
    }
  }, [])

  const save = useCallback(
    (report: Report) => {
      if (stopped.current) return
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

  /** 保存をやめる（この端末から原稿を消すとき。消したあとに保存し直さないように） */
  const stop = useCallback(() => {
    stopped.current = true
    clearTimeout(timer.current)
    pending.current = null
  }, [])

  return { state, save, stop, flush }
}
