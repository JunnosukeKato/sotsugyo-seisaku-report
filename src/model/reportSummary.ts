import { shownPhotos } from './photos'
import type { Report } from './types'

/**
 * 原稿の中身の目安（「バックアップ・作り直す」の窓の、自動の控えの一覧に出す。どの控えに戻せばよいか分かるように。
 * 学生の試し 2026-10-24：控えが時刻だけで並び、空の原稿の控えを選んで空に戻っていた。依頼者の選択 mockups/v53 ④ 案A）。
 * 本文の字数（空白を除く）・図（写真の入ったもの）・表・作品写真の枚数。本文を書いていなければ「本文はまだ書いていません」。
 * ページ数は組んでみないと分からないので、字数で示す
 */
export function reportSummary(report: Report): string {
  let chars = 0
  let figures = 0
  let tables = 0
  for (const chapter of report.body) {
    for (const b of chapter.blocks) {
      if (b.type === 'paragraph') chars += b.content.map((n) => (n.type === 'text' ? n.text : '')).join('').replace(/[\s　]/g, '').length
      else if (b.type === 'figureRow') figures += b.figures.filter((f) => f.imageId).length
      else if (b.type === 'table') tables += 1
    }
  }
  const photos = report.workPhotos.reduce((n, page) => n + shownPhotos(page).filter((p) => p.imageId).length, 0)
  return [
    chars > 0 ? `本文 ${chars.toLocaleString('ja-JP')}字` : '本文はまだ書いていません',
    figures > 0 ? `図 ${figures}枚` : '',
    tables > 0 ? `表 ${tables}つ` : '',
    photos > 0 ? `作品写真 ${photos}枚` : '',
  ]
    .filter(Boolean)
    .join('・')
}
