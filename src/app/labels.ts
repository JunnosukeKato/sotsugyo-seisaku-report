import type { Area } from '../checker/reportChecks'
import type { PageKind } from '../layout/measure'

export const AREA_LABELS: Record<Area, string> = {
  cover: '表紙',
  abstract: '抄録',
  toc: '目次',
  body: '本文',
  references: '引用・参考文献',
  photos: '作品写真',
}

export const AREA_ORDER: Area[] = ['cover', 'abstract', 'toc', 'body', 'references', 'photos']

/** ページ一覧に出す名前（本文は何ページ目かを付ける） */
export function pageLabels(kinds: PageKind[]): string[] {
  let body = 0
  return kinds.map((kind) => {
    if (kind === 'body') return `本文 ${++body}`
    if (kind === 'toc') return '目次（自動）'
    return kind === 'unknown' ? '' : AREA_LABELS[kind]
  })
}

export function daysUntil(deadline: string, today = new Date()): number {
  const end = new Date(`${deadline}T23:59:59`)
  return Math.ceil((end.getTime() - today.getTime()) / 86400000)
}

export function formatDeadline(deadline: string): string {
  const d = new Date(`${deadline}T00:00:00`)
  return `${d.getMonth() + 1}月${d.getDate()}日（${'日月火水木金土'[d.getDay()]}）`
}
