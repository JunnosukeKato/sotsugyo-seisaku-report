import type { ReactNode } from 'react'

/** 道具などのアイコン。線の太さと大きさをそろえて描いたもの（mockups/v6 と同じ） */
const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

const numeral = (x: number, y: number, size: number, text: string) => (
  <text x={x} y={y} textAnchor="middle" fontSize={size} fontWeight={700} fill="currentColor" stroke="none">
    {text}
  </text>
)

export const Icon = {
  paragraph: svg(<path d="M8.5 6.5H19M5 10.5h14M5 14.5h14M5 18.5h9" />),
  // 見出しは、報告書の番号の付け方（Ⅰ．ⅰ．）をそのまま絵にする
  heading2: svg(
    <>
      {numeral(7.6, 11.6, 8.5, 'ⅰ')}
      <path d="M11.5 8.4h7" strokeWidth={2.2} />
      <path d="M6 14.5h13M6 18.5h9" />
    </>,
  ),
  heading1: svg(
    <>
      {numeral(6.6, 12, 10.5, 'Ⅰ')}
      <path d="M11 8.2h9" strokeWidth={2.8} />
      <path d="M4 14.5h16M4 18.5h11" />
    </>,
  ),
  figure: svg(
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <circle cx="9.5" cy="10" r="1.5" />
      <path d="M5 17.5l4.5-4.5 3 3 2-2 4.5 4.5" />
    </>,
  ),
  table: svg(
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M4 10h16M4 14.5h16M10 10v9M15 10v9" />
    </>,
  ),
  refs: svg(<path d="M6 4.5h12v15H6zM9 8.5h6M9 12h6M9 15.5h4" />),
  ref: svg(
    <>
      <path d="M7.5 4.5c-3.3 4.2-3.3 10.8 0 15M16.5 4.5c3.3 4.2 3.3 10.8 0 15" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </>,
  ),
  replace: svg(
    <>
      <rect x="4" y="6" width="12" height="11" rx="1.5" />
      <path d="M14 4.5h5.5V10M19.5 4.5l-6 6" />
    </>,
  ),
  beside: svg(
    <>
      <rect x="3.5" y="6" width="7.5" height="11" rx="1.2" />
      <rect x="13" y="6" width="7.5" height="11" rx="1.2" strokeDasharray="2 2" />
    </>,
  ),
  rowAdd: svg(
    <>
      <rect x="4" y="5" width="16" height="10" rx="1.5" />
      <path d="M4 10h16M12 17.5v4M10 19.5h4" />
    </>,
  ),
  rowRemove: svg(
    <>
      <rect x="4" y="5" width="16" height="10" rx="1.5" />
      <path d="M4 10h16M10 19.5h4" />
    </>,
  ),
  remove: svg(<path d="M5 7h14M10 7V5.5h4V7M7 7l.9 12h8.2L17 7" />),
  undo: svg(<path d="M9 7.5L5 11.5l4 4M5 11.5h9.5a4.5 4.5 0 010 9H12" />),
  handbook: svg(<path d="M4 5.5A1.5 1.5 0 015.5 4H11v16H5.5A1.5 1.5 0 014 18.5zM20 5.5A1.5 1.5 0 0018.5 4H13v16h5.5a1.5 1.5 0 001.5-1.5z" />),
  backup: svg(<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 17v2.5h14V17" />),
  pdf: svg(<path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4M12 11v6M9.5 14.5L12 17l2.5-2.5" />),
  prev: svg(<path d="M14.5 5l-7 7 7 7" />),
  next: svg(<path d="M9.5 5l7 7-7 7" />),
  fit: svg(<rect x="6" y="3.5" width="12" height="17" rx="1.5" />),
  zoom: svg(
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M15.5 15.5L20 20M11 8.5v5M8.5 11h5" />
    </>,
  ),
}
