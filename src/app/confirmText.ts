/**
 * 確認の窓（画面の中に出すもの：学生のツールの app/ask.tsx・管理ページの admin/confirm.tsx）の言葉の分け方。
 * 確認の言葉を、窓の題（問いの文）と中身に分ける。問いは「？」で終わる最初の行の、最後の「。」のあと
 * （「保存していない変更があります。破棄して年度を切り替えますか？」→ 題「破棄して年度を切り替えますか？」、中身「保存していない変更があります。」）。
 * 問いがなければ、題は「確認」
 */
export function confirmParts(text: string): { title: string; body: string } {
  const lines = text.split('\n')
  const i = lines.findIndex((l) => l.trim().endsWith('？'))
  if (i < 0) return { title: '確認', body: text.trim() }
  const line = lines[i].trim()
  const cut = line.lastIndexOf('。')
  const lead = cut >= 0 ? [line.slice(0, cut + 1)] : []
  const body = [...lines.slice(0, i), ...lead, ...lines.slice(i + 1)].join('\n')
  return { title: line.slice(cut + 1), body: body.replace(/\n{3,}/g, '\n\n').trim() }
}

/** 段落のうち、どの行も「・」で始まるもの（変更の一覧など）は、囲んだ一覧にする */
export const isList = (paragraph: string): boolean => paragraph.split('\n').every((l) => l.startsWith('・'))
