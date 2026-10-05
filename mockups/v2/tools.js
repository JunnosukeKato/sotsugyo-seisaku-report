// デザイン案（v2）用の道具ボタン
const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
const text = (t, size = 9) => `<text x="12" y="16" text-anchor="middle" font-size="${size}" font-family="sans-serif" font-weight="700" fill="currentColor" stroke="none">${t}</text>`

export const TOOLS = [
  { label: '段落', icon: svg('<path d="M5 7h14M5 11h14M5 15h14M5 19h9"/>') },
  { label: '小見出し', icon: svg(text('ⅰ．', 10)) },
  { label: '大見出し', icon: svg(text('Ⅰ．', 11)) },
  { label: '図（写真）', icon: svg('<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M5 18l5-5 3 3 2-2 4 4"/>') },
  { label: '素材表', icon: svg('<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M3.5 10h17M3.5 14.5h17M9.5 5v14M15 5v14"/>') },
  { label: '図表を参照', icon: svg(text('（図）', 7.5)) },
  { label: '削除', icon: svg('<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>'), danger: true },
  { label: '元に戻す', icon: svg('<path d="M9 7L5 11l4 4"/><path d="M5 11h9a5 5 0 010 10h-3"/>') },
]

export function toolsHtml({ withLabels = true } = {}) {
  return TOOLS.map((t) => `<button class="tool${t.danger ? ' danger' : ''}" title="${t.label}">${t.icon}${withLabels ? `<span>${t.label}</span>` : ''}</button>`).join('')
}

export const CHECK_PANEL = `
  <h2>セルフチェック</h2>
  <div class="counts"><div class="count e"><b>2</b>エラー</div><div class="count w"><b>0</b>警告</div></div>
  <div class="issue"><b>一人称は「筆者」にする</b><br>本文 1ページ　「私は」→「筆者は」</div>
  <div class="issue"><b>数字は半角で書く</b><br>本文 1ページ　全角の「１５」→ 半角の「15」</div>`

export const STYLE_SELECT = `<div class="style-select"><span>（見本）ページ送りの動き</span><button class="on" data-style="turn">めくる</button><button data-style="slide">スライド</button><button data-style="fade">フェード</button></div>`
