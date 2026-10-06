import { useEffect, useState } from 'react'

/**
 * 試し：文字を書いているときの見え方を切り替えて打ち比べる（mockups/v10）。
 * アドレスの末尾に ?typing=1（2・3）を付けると出る。案が決まったら、この部品は外して1つの見え方にする。
 */
const OPTIONS = [
  ['0', '今'],
  ['1', '案1 枠なし'],
  ['2', '案2 左に細い線'],
  ['3', '案3 薄い色'],
] as const

export function TypingTrial() {
  const [value, setValue] = useState(() => new URLSearchParams(location.search).get('typing'))
  useEffect(() => {
    if (value && value !== '0') document.documentElement.dataset.typing = value
    else delete document.documentElement.dataset.typing
  }, [value])
  if (value === null) return null
  const choose = (v: string) => {
    setValue(v)
    const url = new URL(location.href)
    url.searchParams.set('typing', v)
    history.replaceState(null, '', url)
  }
  return (
    <div className="typing-trial" onMouseDown={(e) => e.preventDefault()}>
      <b>入力の見え方（試し）</b>
      {OPTIONS.map(([v, label]) => (
        <button key={v} className={value === v ? 'on' : ''} onClick={() => choose(v)}>
          {label}
        </button>
      ))}
    </div>
  )
}
