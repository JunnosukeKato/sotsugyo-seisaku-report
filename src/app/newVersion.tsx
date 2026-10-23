import { useEffect, useState } from 'react'
import { Icon } from './icons'

/**
 * 新しい版を知らせる（依頼者の選択 2026-10-23：学生の試しで、ツールを新しくしようと紙面を下に引っぱると、ページをめくってしまい、
 * 毎回ブラウザのタブを閉じて開き直していた）。
 * 公開するたびに、版の印（__BUILD_ID__）と同じものを version.json に出す（vite.config.ts）。ツールは、開いたとき・画面に戻ったとき・
 * 10分ごとに version.json を読み、印が違えば、画面の上に「新しい版があります［新しくする］」を出す。
 * 開発サーバー（__BUILD_ID__ が 'dev'）では調べない
 */

/** 調べる間（ミリ秒） */
const CHECK_EVERY_MS = 10 * 60 * 1000

/** いまの版の印（ビルドのときに決まる。開発サーバーでは 'dev'） */
export const BUILD_ID: string = __BUILD_ID__

/** 公開されている版の印（読めなければ null） */
export async function publishedBuildId(): Promise<string | null> {
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const body = (await res.json()) as { id?: unknown }
    return typeof body.id === 'string' ? body.id : null
  } catch {
    return null
  }
}

/** 新しい版が公開されているか（見つけたら true のまま） */
export function useNewVersion(): boolean {
  const [newer, setNewer] = useState(false)
  useEffect(() => {
    if (BUILD_ID === 'dev') return
    let stopped = false
    const check = async () => {
      const id = await publishedBuildId()
      if (!stopped && id && id !== BUILD_ID) setNewer(true)
    }
    void check()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [])
  return newer
}

/** 画面の上の知らせ（「新しくする」で、書いたものを保存してから読み込み直す。× で、この画面では出さない） */
export function NewVersionBanner({ onReload, onClose }: { onReload: () => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className="new-version" role="status">
      <span>新しい版があります</span>
      <button
        className="nv-reload"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          onReload()
        }}
      >
        {Icon.reload}
        {busy ? '保存しています…' : '新しくする'}
      </button>
      <button className="nv-close" aria-label="閉じる（新しくしない）" onClick={onClose}>
        ×
      </button>
    </div>
  )
}
