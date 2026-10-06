import { useRef, useState } from 'react'
import { useDialogFocus } from './useDialogFocus'

/** 別のタブで開いているときの窓（このタブでは書けない） */
export function TabLockedOverlay({ onTakeOver }: { onTakeOver: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  useDialogFocus(ref)
  return (
    <div className="login-over tab-locked" role="dialog" aria-modal="true" aria-label="別のタブで開いています">
      <div className="login-card" ref={ref}>
        <h2 className="tab-locked-title">このツールは、別のタブで開いています</h2>
        <p className="login-lead">
          同じ原稿を2か所で書くと、新しく書いた内容が消えることがあるため、このタブでは書けないようにしています。もう一方のタブを閉じてから「こちらで続ける」を押してください。
        </p>
        <button
          className="login-btn"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            onTakeOver()
          }}
        >
          {busy ? '切り替えています…' : 'こちらで続ける'}
        </button>
      </div>
    </div>
  )
}
