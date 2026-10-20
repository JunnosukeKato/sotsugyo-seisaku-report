import type { ReactNode } from 'react'

/** 管理ページのアイコン（左の見出しなど。mockups/v43 と同じ形。線の太さは学生用ツールの src/app/icons.tsx と同じ） */
const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

export const AdminIcon = {
  calendar: svg(<path d="M5.5 5.5h13a1.5 1.5 0 011.5 1.5v11a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18V7a1.5 1.5 0 011.5-1.5zM4 10h16M8.5 3.5v4M15.5 3.5v4" />),
  course: svg(<path d="M4 7.5h16M4 12h16M4 16.5h10" />),
  notice: svg(<path d="M5 10v4h3l5 4V6L8 10zM16.5 9.5a3.5 3.5 0 010 5" />),
  template: svg(<path d="M6.5 3.5h11A1.5 1.5 0 0119 5v14a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 015 19V5a1.5 1.5 0 011.5-1.5zM8.5 8h7M8.5 11.5h7M8.5 15h4" />),
  words: svg(<path d="M4 18l5-12 5 12M5.8 14h6.4M15.5 15.5l2 2 3.5-4" />),
  people: svg(
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0111 0" />
      <circle cx="16.5" cy="9.5" r="2.5" />
      <path d="M15.5 14.2a4.6 4.6 0 015.2 4.8" />
    </>,
  ),
  history: svg(<path d="M4.5 12a7.5 7.5 0 102.2-5.3M4.5 4.5v3.5H8M12 8v4.5l3 2" />),
  gear: svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4L18 18M6 18l1.6-1.6M16.4 7.6L18 6" />
    </>,
  ),
  sprout: svg(<path d="M12 20v-8M12 12c0-3.5 2.5-6 6.5-6 0 3.8-2.6 6-6.5 6zM12 14c0-3-2.2-5.2-5.8-5.2 0 3.3 2.3 5.2 5.8 5.2z" />),
  eye: svg(
    <>
      <path d="M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6z" />
      <circle cx="12" cy="12" r="2.6" />
    </>,
  ),
  plus: svg(<path d="M12 5v14M5 12h14" />),
  next: svg(<path d="M9.5 5l7 7-7 7" />),
  checkBold: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  ),
}
