import { useCallback, useEffect, useRef, useState } from 'react'
import { clearLeavingCopy, keepLeavingCopy, saveReport, saveSnapshot } from '../model/storage'
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
 * 保存する前にタブを閉じたり、読み込み直したり、ほかのアプリへ切り替えたりしたときは、すぐ保存する。
 * そのときの IndexedDB への保存は、閉じると途中で止まることがあるため、すぐ書き終わる localStorage にも写しておく（次に開いたときに使う。storage.ts）。
 * beforeLeave：閉じる・切り替える直前に呼ぶ（書いている欄の、まだ原稿に入っていない文字を入れる）
 */
export function useAutosave(beforeLeave?: () => void) {
  const [state, setState] = useState<SaveState>({ status: 'idle' })
  const timer = useRef<number | undefined>(undefined)
  const pending = useRef<Report | null>(null)
  /** まだ保存し終えていない最新の版（保存している途中の版も含む。閉じる直前に localStorage へ写す） */
  const unsaved = useRef<Report | null>(null)
  const lastSnapshot = useRef(0)
  const stopped = useRef(false)
  const leaving = useRef(beforeLeave)
  useEffect(() => {
    leaving.current = beforeLeave
  })

  const flush = useCallback(async function run(): Promise<void> {
    clearTimeout(timer.current)
    const report = pending.current
    if (!report || stopped.current) return
    pending.current = null
    try {
      await saveReport(report)
      // 保存し終えた：閉じる直前の写しは要らない（その後に書いた版があれば、それはまだ保存していない）
      if (unsaved.current === report) {
        unsaved.current = null
        clearLeavingCopy()
      }
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
      unsaved.current = report
      setState({ status: 'saving' })
      timer.current = window.setTimeout(() => void flush(), SAVE_DELAY_MS)
    },
    [flush],
  )

  useEffect(() => {
    // 閉じる・読み込み直す・切り替える直前：書いている文字を原稿に入れ、localStorage に写してから、保存を始める
    const leave = () => {
      if (stopped.current) return
      leaving.current?.()
      if (unsaved.current) keepLeavingCopy(unsaved.current)
      void flush()
    }
    const now = () => {
      if (document.visibilityState === 'hidden') leave()
    }
    document.addEventListener('visibilitychange', now)
    window.addEventListener('pagehide', leave)
    return () => {
      document.removeEventListener('visibilitychange', now)
      window.removeEventListener('pagehide', leave)
    }
  }, [flush])

  /** 保存をやめる（この端末から原稿を消すとき。消したあとに保存し直さないように） */
  const stop = useCallback(() => {
    stopped.current = true
    clearTimeout(timer.current)
    pending.current = null
    unsaved.current = null
    clearLeavingCopy()
  }, [])

  return { state, save, stop, flush }
}
