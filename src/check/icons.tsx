import type { ReactNode } from 'react'
import { Icon } from '../app/icons'

/** 提出前チェックのアイコン。学生用ツールのもの（app/icons.tsx）に、このページで使うものを足す（同じ線の太さ。mockups/v30） */
const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

export const CheckIcon = {
  ...Icon,
  doc: svg(<path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4M9 12h6M9 15.5h6" />),
  word: svg(
    <>
      <path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4" />
      <path d="M8.6 11.2l1.3 5.6 1.6-4.2 1.6 4.2 1.3-5.6" />
    </>,
  ),
  photo: Icon.image,
  text: Icon.paragraph,
  up: svg(<path d="M12 15.5v-11M7.5 9L12 4.5 16.5 9M5 15v4.5h14V15" />),
  plus: svg(<path d="M12 5.5v13M5.5 12h13" />),
  x: svg(<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />),
  lock: svg(
    <>
      <rect x="5.5" y="10.5" width="13" height="9.5" rx="1.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5" />
    </>,
  ),
  pages: svg(<path d="M8 3.5h11v14H8zM5 7v13.5h10.5" />),
}
