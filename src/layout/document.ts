import { findCourse, type YearConfig } from '../config'
import type { Reference, Report } from '../model/types'
import { bodyContentHtml, chapterLabel, escapeHtml, subheadingLabel, type BodyRenderOptions } from './bodyHtml'
import { documentCss } from './documentCss'

/**
 * 報告書全体の HTML 文書を作る。ページ順は手順書どおり：
 * 表紙 → 抄録 → 目次 → 本文 → 引用・参考文献（ある場合）→ 作品写真
 *
 * 学生がまだ入力していない項目は、画面だけに「（学籍番号）」のような仮の文字を出す（data-placeholder）。
 * 未入力の項目はセルフチェックのエラーになるため、空のまま提出用 PDF を書き出すことはできない。
 */

/** 編集できる項目の ID（紙面上でクリックした場所の特定に使う） */
export const FIELD_IDS = {
  studentId: 'basic:studentId',
  name: 'basic:name',
  subtitleInput: 'basic:subtitleInput',
  course: 'basic:course',
} as const

export interface DocumentRenderOptions extends BodyRenderOptions {
  /** 作品写真の表示用 URL */
  photoSrc?: (imageId: string) => string
  /**
   * 目次に載せるページ番号（大見出しの ID → 本文のページ番号。引用・参考文献は 'references'）。
   * 組版エンジンのページ参照は本文から振り直した番号に対応しないため、組版した結果から読み取って渡す（measureTocPageNumbers）。
   */
  tocPageNumbers?: Record<string, number>
}

/** 引用・参考文献の見出しの id（目次のページ番号を読み取るのに使う） */
export const REFERENCES_ANCHOR = 'references'

/** 文字の間に半角スペースを入れる（表紙の「卒 業 制 作」「文 化 学 園 大 学」） */
function spaced(text: string): string {
  return [...text].join(' ')
}

/**
 * 学生が入力する項目。空のときの仮の文字（「（学籍番号）」など）は data-placeholder に入れ、
 * 画面の CSS で表示する（紙面の文字としては持たないため、PDF には出ない）。
 */
function field(id: string, value: string, placeholder: string): string {
  return `<span data-block-id="${id}" data-placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</span>`
}

export function coverHtml(report: Report, config: YearConfig): string {
  const course = findCourse(config, report.basicInfo.courseId)
  const { basicInfo } = report
  // サブタイトルは「―」「の衣装制作―」などの決まり文句と、学生が入力する部分を分けて出す
  const [subtitleBefore, subtitleAfter] = course ? course.subtitleTemplate.split('{input}') : ['', '']
  const fullWidthYear = String(config.fiscalYear).replace(/[0-9]/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0))
  return `<section class="cover">
<div class="frame"></div>
<div class="el center year">${escapeHtml(fullWidthYear)}年度</div>
<div class="el center heading">${escapeHtml(spaced(config.cover.heading))}</div>
<div class="el label">${escapeHtml(config.cover.titleLabel)}</div>
<div class="el title">${escapeHtml(config.commonTitle)}</div>
<div class="rule title-rule"></div>
<div class="el subtitle">${escapeHtml(subtitleBefore ?? '')}${field(FIELD_IDS.subtitleInput, basicInfo.subtitleInput, '（クリックして入力）')}${escapeHtml(subtitleAfter ?? '')}</div>
<div class="rule subtitle-rule"></div>
<div class="el department">${escapeHtml(config.faculty)}・${escapeHtml(config.department)}</div>
<div class="el course">${field(FIELD_IDS.course, course?.name ?? '', '（コースを選ぶ）')} コース</div>
<div class="el id-label">学籍番号</div>
<div class="el id-value">${field(FIELD_IDS.studentId, basicInfo.studentId, '（学籍番号）')}</div>
<div class="rule id-rule"></div>
<div class="el name-label">氏　名　：</div>
<div class="el name-value">${field(FIELD_IDS.name, basicInfo.name, '（氏名）')}</div>
<div class="rule name-rule"></div>
<div class="rule bottom-rule"></div>
<div class="el center university">${escapeHtml(spaced(config.university))}</div>
</section>`
}

export function abstractHtml(report: Report, config: YearConfig): string {
  const course = findCourse(config, report.basicInfo.courseId)
  const [subtitleBefore, subtitleAfter] = course ? course.subtitleTemplate.split('{input}') : ['', '']
  const { basicInfo } = report
  const advisors = course ? course.advisors.join('、') : ''
  const paragraphs = report.abstract.paragraphs
    .map((p) => {
      const text = p.content.map((n) => (n.type === 'text' ? n.text : '')).join('')
      const placeholder = p.hint ? `（${p.hint}）` : '（クリックして抄録を入力）'
      return `<p data-block-id="${escapeHtml(p.id)}" data-placeholder="${escapeHtml(placeholder)}">${escapeHtml(text)}</p>`
    })
    .join('\n')
  return `<section class="abstract">
<div class="head">
<div class="el h">${config.fiscalYear}年度　${escapeHtml(config.abstract.heading)}</div>
<div class="el row row2"><span>${escapeHtml(config.faculty)}　${escapeHtml(config.department)}</span><span class="course-part">${escapeHtml(course?.name ?? '')}　コース</span></div>
<div class="el row row3">学籍番号　${escapeHtml(basicInfo.studentId)}　氏名　${escapeHtml(basicInfo.name)}</div>
<div class="el row row4">（指導教員　${escapeHtml(advisors)}　）</div>
<div class="el title">${escapeHtml(config.commonTitle)}</div>
<div class="el subtitle">${escapeHtml(subtitleBefore ?? '')}${escapeHtml(basicInfo.subtitleInput)}${escapeHtml(subtitleAfter ?? '')}</div>
</div>
<div class="body">
${paragraphs}
</div>
</section>`
}

function tocHtml(report: Report, pageNumbers: Record<string, number>): string {
  const pno = (key: string) => (pageNumbers[key] ? String(pageNumbers[key]) : '')
  const entries = report.body
    .map((chapter, i) => {
      let sub = 0
      const subs = chapter.blocks
        .filter((b) => b.type === 'subheading')
        .map((b) => `<div class="toc-sub">${subheadingLabel(sub++)}${escapeHtml(b.title)}</div>`)
        .join('\n')
      return `<div class="toc-ch"><span>${chapterLabel(i)}${escapeHtml(chapter.title)}</span><span class="leader"></span><span class="pno">${pno(chapter.id)}</span></div>\n${subs}`
    })
    .join('\n')
  const references = report.references.length
    ? `<div class="toc-ch"><span>引用・参考文献</span><span class="leader"></span><span class="pno">${pno(REFERENCES_ANCHOR)}</span></div>`
    : ''
  return `<section class="toc">
<div class="toc-title">目次</div>
${entries}
${references}
</section>`
}

/** 引用・参考文献の1項目を手順書の書式にする */
export function formatReference(ref: Reference): string {
  if (ref.type === 'book') {
    const pages = ref.pages.trim() ? `、p.${ref.pages.trim()}` : ''
    return `${ref.author}、『${ref.title}』、${ref.publisher}、${ref.year}年${pages}`
  }
  const date = ref.accessedOn ? ref.accessedOn.replace(/^(\d{4})-0?(\d{1,2})-0?(\d{1,2})$/, '$1/$2/$3') : ''
  return `${ref.siteTitle}（${ref.url}）${date}参照`
}

function referencesHtml(report: Report): string {
  if (!report.references.length) return ''
  const items = report.references.map((r) => `<li data-ref-id="${escapeHtml(r.id)}">・${escapeHtml(formatReference(r))}</li>`).join('\n')
  return `<section class="references body-continued">
<h1 id="${REFERENCES_ANCHOR}">引用・参考文献</h1>
<ul>
${items}
</ul>
</section>`
}

function photosHtml(report: Report, options: DocumentRenderOptions): string {
  const { layout, imageIds } = report.workPhotos
  const slots = Array.from({ length: layout }, (_, i) => {
    const id = imageIds[i]
    const img = id && options.photoSrc ? `<img src="${escapeHtml(options.photoSrc(id))}" alt="">` : ''
    return `<div class="slot${img ? '' : ' empty-slot'}" data-photo-slot="${i}">${img}</div>`
  }).join('')
  return `<section class="photos layout-${layout}">${slots}</section>`
}

export function buildReportDocument(report: Report, config: YearConfig, options: DocumentRenderOptions): string {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${escapeHtml(config.reportName)}</title>
<style>${documentCss}</style>
</head>
<body>
${coverHtml(report, config)}
${abstractHtml(report, config)}
${tocHtml(report, options.tocPageNumbers ?? {})}
<section class="body">
${bodyContentHtml(report.body, options)}
</section>
${referencesHtml(report)}
${photosHtml(report, options)}
</body>
</html>`
}
