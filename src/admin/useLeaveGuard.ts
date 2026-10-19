import { useEffect } from 'react'

/**
 * active のあいだ、タブを閉じる・読み込み直すときにブラウザの確認を出す
 * （保存していない変更や、窓の中で直して「反映する」を押していない内容が、黙って消えないように）
 */
export function useLeaveGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [active])
}
