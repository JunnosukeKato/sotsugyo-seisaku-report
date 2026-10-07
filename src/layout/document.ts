import { findCourse, type YearConfig } from '../config'
import type { Reference, Report } from '../model/types'
import { photoGrid, shownPhotos } from '../model/photos'
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
  /**
   * 表紙のサブタイトルの文字の大きさ（pt）。組んだ紙面で枠に入るかを測って決めたもの（reportRenderer.ts）。
   * なければ字数から見積もる（coverSubtitleFontPt）
   */
  coverSubtitlePt?: number
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

/** サブタイトルの決まり文句（「―」と「の衣装制作―」など。学生が入力する部分の前と後ろ） */
function subtitleParts(report: Report, config: YearConfig): [string, string] {
  const course = findCourse(config, report.basicInfo.courseId)
  const [before, after] = course ? course.subtitleTemplate.split('{input}') : ['', '']
  return [before ?? '', after ?? '']
}

/** サブタイトルの1行全体（決まり文句と入力した部分） */
export function subtitleLine(report: Report, config: YearConfig): string {
  const [before, after] = subtitleParts(report, config)
  return before + report.basicInfo.subtitleInput + after
}

export function coverHtml(report: Report, config: YearConfig, options: Pick<DocumentRenderOptions, 'coverSubtitlePt'> = {}): string {
  const course = findCourse(config, report.basicInfo.courseId)
  const { basicInfo } = report
  // サブタイトルは「―」「の衣装制作―」などの決まり文句と、学生が入力する部分を分けて出す
  const [subtitleBefore, subtitleAfter] = subtitleParts(report, config)
  // 長いときは、枠の1行に入るまで行全体の文字を小さくする（mockups/v23 ① 案A）
  const subtitlePt = options.coverSubtitlePt ?? fitLineFontPt(subtitleLine(report, config), COVER_SUBTITLE)
  const fullWidthYear = String(config.fiscalYear).replace(/[0-9]/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0))
  return `<section class="cover">
<div class="frame"></div>
<div class="el center year">${escapeHtml(fullWidthYear)}年度</div>
<div class="el center heading">${escapeHtml(spaced(config.cover.heading))}</div>
<div class="el label">${escapeHtml(config.cover.titleLabel)}</div>
<div class="el title">${escapeHtml(config.commonTitle)}</div>
<div class="rule title-rule"></div>
<div class="el subtitle" style="font-size:${subtitlePt}pt">${escapeHtml(subtitleBefore)}${field(FIELD_IDS.subtitleInput, basicInfo.subtitleInput, '（クリックして入力）')}${escapeHtml(subtitleAfter)}</div>
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

/** 抄録の見出しの1行（学籍番号・氏名と指導教員）の幅。本文の幅 150mm に収まる文字の大きさを選ぶ */
const ABSTRACT_ROW_WIDTH_MM = 150
const PT_TO_MM = 25.4 / 72
const ABSTRACT_ROW_SIZES_PT = [10, 9.5, 9, 8.5, 8]

/** 文字列の幅（全角を1、半角を0.5として数える） */
export function textUnits(text: string): number {
  return [...text].reduce((n, c) => n + (/[\u0020-\u007e\uff61-\uff9f]/.test(c) ? 0.5 : 1), 0)
}

/** 左右に振り分けた2つの文字列が1行に収まる文字の大きさ（pt）。間に全角2字分のすき間を空ける */
export function abstractRowFontPt(left: string, right: string): number {
  const units = textUnits(left) + textUnits(right) + 2
  return ABSTRACT_ROW_SIZES_PT.find((pt) => units * pt * PT_TO_MM <= ABSTRACT_ROW_WIDTH_MM) ?? ABSTRACT_ROW_SIZES_PT[ABSTRACT_ROW_SIZES_PT.length - 1]
}

/** 1行の欄：幅（mm）と、文字の大きさのいちばん大きい値・いちばん小さい値（pt） */
export interface LineBox {
  widthMm: number
  maxPt: number
  minPt: number
}

/**
 * 表紙のサブタイトル（幅135.8mm・22pt）。長いときは、枠の1行に入るまで行全体の文字を小さくする（mockups/v23 ① 案A）。
 * 本文の文字（10.5pt）より小さくはしない。それでも入らなければ、セルフチェックのエラーにする
 */
export const COVER_SUBTITLE: LineBox = { widthMm: 135.8, maxPt: 22, minPt: 11 }
/** 抄録の見出しのサブタイトル（本文の幅150mm・12pt）。表紙と同じく、1行に入るまで小さくする */
export const ABSTRACT_SUBTITLE: LineBox = { widthMm: 150, maxPt: 12, minPt: 9 }
/** 文字を小さくする刻み（pt） */
const FIT_STEP_PT = 0.5

/** 文字の幅 ÷ 欄の幅（組んだ紙面で測った値）が、この値をこえたら「はみ出している」とする（測り方の細かい誤差は見ない） */
export const OVERFLOW_RATIO = 1.002

/** 1行に収まる文字の大きさ（pt）を字数から見積もる（全角を1、半角を0.5字として数える）。いちばん小さくしても入らなければ、いちばん小さい値 */
export function fitLineFontPt(text: string, box: LineBox): number {
  const units = textUnits(text)
  for (let pt = box.maxPt; pt >= box.minPt; pt -= FIT_STEP_PT) {
    if (units * pt * PT_TO_MM <= box.widthMm) return pt
  }
  return box.minPt
}

/**
 * 組んだ紙面で測った「文字の幅 ÷ 欄の幅」（ratio）から、次に組むときの文字の大きさを決める。
 * 文字の幅は大きさに比例するので、入る大きさを 0.5pt 刻みで切り捨てて求める（字数からの見積もりより正確。表紙の書体は字によって幅が違うため）。
 * tooBig：これまでに組んで、はみ出した大きさ（それ以上にはしない。行ったり来たりしないように）
 */
export function refitLineFontPt(pt: number, ratio: number, box: LineBox, tooBig = Infinity): number {
  if (!(ratio > 0)) return pt
  let next = Math.floor(pt / ratio / FIT_STEP_PT + 1e-6) * FIT_STEP_PT
  if (ratio > OVERFLOW_RATIO) next = Math.min(next, pt - FIT_STEP_PT)
  else next = Math.max(next, pt)
  next = Math.min(next, box.maxPt, tooBig - FIT_STEP_PT)
  return Math.max(box.minPt, next)
}

export function abstractHtml(report: Report, config: YearConfig): string {
  const course = findCourse(config, report.basicInfo.courseId)
  const { basicInfo } = report
  // サブタイトルは、本文の幅の1行に入るまで小さくする（抄録の書体は字の幅がそろっているので、字数から決める）
  const subtitle = subtitleLine(report, config)
  const subtitlePt = fitLineFontPt(subtitle, ABSTRACT_SUBTITLE)
  const advisors = course ? course.advisors.join('、') : ''
  // 学籍番号・氏名（左）と指導教員（右）は1行にまとめる。長いときは文字を少し小さくする
  const studentPart = `学籍番号　${basicInfo.studentId}　　氏名　${basicInfo.name}`
  const advisorPart = `（指導教員　${advisors}　）`
  const rowFontPt = abstractRowFontPt(studentPart, advisorPart)
  // 書き始めるまでは、抄録の欄に案内と「先生の許可が出た」ボタンを出す（画面だけ。PDF では空欄）
  const locked = report.abstract.started === false
  const paragraphs = locked
    ? `<div class="abstract-lock"><b>抄録は、本文を書き終えて、先生のチェックで許可が出てから書きます。</b><span>許可が出たら、下のボタンを押してください（それまで、このページは PDF には入りません）。</span><span class="abstract-start" data-abstract-start>先生の許可が出た（抄録を書き始める）</span></div>`
    : report.abstract.paragraphs
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
<div class="el row row3" style="font-size:${rowFontPt}pt"><span class="student">${escapeHtml(studentPart)}</span><span class="advisors">${escapeHtml(advisorPart)}</span></div>
<div class="el title">${escapeHtml(config.commonTitle)}</div>
<div class="el subtitle" style="font-size:${subtitlePt}pt">${escapeHtml(subtitle)}</div>
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

/** 作品写真：枠いっぱいに切り抜いて並べる。切り抜く位置は学生が写真をつかんで動かして決める */
function photosHtml(report: Report, options: DocumentRenderOptions): string {
  const grid = photoGrid(report.workPhotos)
  const slots = shownPhotos(report.workPhotos)
    .map(({ imageId, position }, i) => {
      const at = position ? ` style="object-position:${position.x}% ${position.y}%"` : ''
      const img = imageId && options.photoSrc ? `<img src="${escapeHtml(options.photoSrc(imageId))}"${at} alt="">` : ''
      return `<div class="slot${img ? '' : ' empty-slot'}" data-photo-slot="${i}">${img}</div>`
    })
    .join('')
  return `<section class="photos grid-${grid.columns}x${grid.rows}">${slots}</section>`
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
${coverHtml(report, config, options)}
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
