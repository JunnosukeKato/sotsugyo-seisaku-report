import { findCourse, type YearConfig } from '../config'
import type { Reference, Report } from '../model/types'
import { photoGrid, shownPhotos } from '../model/photos'
import { bodyContentHtml, chapterHtmls, chapterLabel, chapterSentinelHtml, escapeHtml, subheadingLabel, type BodyRenderOptions } from './bodyHtml'
import { documentCss } from './documentCss'

/**
 * 報告書全体の HTML 文書を作る。ページ順は手順書どおり：
 * 表紙 → 抄録 → 目次 → 本文 → 引用・参考文献（ある場合）→ 作品写真
 *
 * 学生がまだ入力していない項目は、画面だけに「（学籍番号）」のような仮の文字を出す（data-placeholder）。
 * 未入力の項目はセルフチェックのまだのところになる（PDF には仮の文字を出さず、空のまま）。
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
<div class="el subtitle" style="font-size:${subtitlePt}pt${subtitlePt < COVER_SUBTITLE.maxPt ? `;padding-top:${COVER_SUBTITLE.maxPt - subtitlePt}pt` : ''}">${escapeHtml(subtitleBefore)}${field(FIELD_IDS.subtitleInput, basicInfo.subtitleInput, '（クリックして入力）')}${escapeHtml(subtitleAfter)}</div>
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
 * 表紙のサブタイトル（幅144.2mm・22pt）。長いときは、枠の1行に入るまで行全体の文字を小さくする（mockups/v23 ① 案A）。
 * 本文の文字（10.5pt）より小さくはしない。それでも入らなければ、セルフチェックのエラーにする
 */
export const COVER_SUBTITLE: LineBox = { widthMm: 144.2, maxPt: 22, minPt: 11 }
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

/**
 * 抄録を書き始める前の案内の言葉（紙面の抄録の欄に出す。スマホは、同じ言葉を紙面の下の帯に出す。app/PageBand.tsx）
 */
export const ABSTRACT_LOCK_TEXT = {
  title: '抄録は、本文を書き終えて、先生のチェックで許可が出てから書きます。',
  note: '許可が出たら、下のボタンを押してください（それまで、このページは PDF には入りません）。',
  button: '先生の許可が出た（抄録を書き始める）',
} as const

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
    ? `<div class="abstract-lock"><b>${ABSTRACT_LOCK_TEXT.title}</b><span>${ABSTRACT_LOCK_TEXT.note}</span><span class="abstract-start" data-abstract-start>${ABSTRACT_LOCK_TEXT.button}</span></div>`
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

/**
 * 目次の行の行き先（大見出し・小見出しのブロック ID。引用・参考文献の行は REFERENCES_ANCHOR）。
 * 画面で目次の行を押すと、その見出しへ移って書き始める（mockups/v41 案C。reportEditor の onClick）。
 * 同じ名前の見出しがあっても取り違えないよう、文字ではなく ID で結ぶ。属性だけなので、紙面の見た目・PDF は変わらない
 */
export const TOC_TARGET_ATTR = 'data-toc-target'

/**
 * 目次のページの言葉（mockups/v41。画面だけ。紙面・PDF には出ない）。
 * jumped：目次の行から見出しへ移ったときの、画面の下の知らせ（案C）。
 * note：目次のページの、行のない所を押したときの、押した所の近くの知らせ（案B。app/TocNotice.tsx）
 */
export const TOC_TEXT = {
  jumped: 'この見出しを直すと、目次も変わります',
  noteTitle: '目次は自動です',
  noteBody: '見出しを直すと、ここも変わります',
  noteButton: '本文の見出しへ',
} as const

function tocHtml(report: Report, pageNumbers: Record<string, number>): string {
  const pno = (key: string) => (pageNumbers[key] ? String(pageNumbers[key]) : '')
  const target = (id: string) => `${TOC_TARGET_ATTR}="${escapeHtml(id)}"`
  const entries = report.body
    .map((chapter, i) => {
      let sub = 0
      const subs = chapter.blocks
        .filter((b) => b.type === 'subheading')
        // 小見出しの行も、見出しの字を span に入れる（大見出しの行と同じ形。画面でマウスを乗せたときの下線と「→ 見出しへ」の置き場所。紙面の見た目は変わらない）
        .map((b) => `<div class="toc-sub" ${target(b.id)}><span>${subheadingLabel(sub++)}${escapeHtml(b.title)}</span></div>`)
        .join('\n')
      return `<div class="toc-ch${i > 0 ? ' next' : ''}" ${target(chapter.id)}><span>${chapterLabel(i)}${escapeHtml(chapter.title)}</span><span class="leader"></span><span class="pno">${pno(chapter.id)}</span></div>\n${subs}`
    })
    .join('\n')
  const references = report.references.length
    ? `<div class="toc-ch${report.body.length ? ' next' : ''}" ${target(REFERENCES_ANCHOR)}><span>引用・参考文献</span><span class="leader"></span><span class="pno">${pno(REFERENCES_ANCHOR)}</span></div>`
    : ''
  return `<section class="toc">
<div class="toc-title">目次</div>
${entries}
${references}
</section>`
}

/** 出版年：全角の数字（「２０１９」）は半角にし、数字のほかは除く（「2019年」→「2019」。引用・参考文献の入力欄） */
export function yearDigits(text: string): string {
  const t = halfDigits(text)
  // 和暦（「令和3年」「平成元年」）は西暦にする（数字だけ残すと「3年」になってしまうため）
  const era = /(令和|平成|昭和|大正)\s*(元|\d+)/.exec(t)
  if (era) return String(ERA_START[era[1]] + (era[2] === '元' ? 1 : Number(era[2])))
  return t.replace(/[^0-9]/g, '')
}

/** 和暦の元年の前の年（令和元年＝2019年） */
const ERA_START: Record<string, number> = { 令和: 2018, 平成: 1988, 昭和: 1925, 大正: 1911 }

/** 全角の数字を半角にする（ほかの文字はそのまま。出版年を書いている途中に使う。「令和」などを途中で消さないように） */
export function halfDigits(text: string): string {
  return text.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
}

/** ページ（「12-30」）：全角の数字とつなぎの線を半角にする */
export function pageRange(text: string): string {
  return halfDigits(text.trim()).replace(/[－‐−―ー〜～]/g, '-')
}

/**
 * 書名：『』は自動で付けるので、学生が『』（「」）で囲んで入力していたら外す（『『書名』』と二重にならないように）。
 * 片方だけ打ったとき（『書名 ・ 書名』）も外す。書名の途中の『』はそのまま
 */
function bareTitle(title: string): string {
  const t = title.trim()
  if (/^『[^『』]*』$|^「[^「」]*」$/.test(t)) return t.slice(1, -1).trim()
  return t.replace(/^[『「](?=[^『』「」]*$)/, '').replace(/(?<=^[^『』「」]*)[』」]$/, '').trim()
}

/** 引用・参考文献の1項目を手順書の書式にする */
export function formatReference(ref: Reference): string {
  if (ref.type === 'book') {
    const pages = ref.pages.trim() ? `、p.${pageRange(ref.pages)}` : ''
    return `${ref.author}、『${bareTitle(ref.title)}』、${ref.publisher}、${yearDigits(ref.year)}年${pages}`
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

/**
 * 作品写真：枠いっぱいに切り抜いて並べる。切り抜く位置は学生が写真をつかんで動かして決める。
 * 「全体を入れる（切らない）」にした写真（whole）は、枠の中に全体を入れる（まわりは白。mockups/v32 ③ 案A）。
 * ページごとに1つの <section>（何ページ目か：data-photo-page。0 から。mockups/v38 案A）。並べ方はページごとに違ってよい
 */
function photosHtml(report: Report, options: DocumentRenderOptions): string {
  return report.workPhotos
    .map((page, k) => {
      const grid = photoGrid(page)
      const slots = shownPhotos(page)
        .map(({ imageId, position, whole }, i) => {
          // 全体を入れる写真は切り抜かないので、切り抜く位置は使わない（真ん中に置く）
          const at = position && !whole ? ` style="object-position:${position.x}% ${position.y}%"` : ''
          const img = imageId && options.photoSrc ? `<img src="${escapeHtml(options.photoSrc(imageId))}"${at} alt="">` : ''
          return `<div class="slot${img ? '' : ' empty-slot'}${img && whole ? ' whole' : ''}" data-photo-slot="${i}">${img}</div>`
        })
        .join('')
      return `<section class="photos grid-${grid.columns}x${grid.rows}" data-photo-page="${k}">${slots}</section>`
    })
    .join('\n')
}

/** HTML 文書の形（中身 body のまわり。報告書全体でも、一部だけでも同じ） */
function documentHtml(config: YearConfig, body: string): string {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${escapeHtml(config.reportName)}</title>
<style>${documentCss}</style>
</head>
<body>
${body}
</body>
</html>`
}

/** 本文から後ろ（本文・引用参考文献・作品写真）。ページ番号は本文の1ページ目を「1」とし、引用参考文献まで続ける */
function mainHtml(report: Report, options: DocumentRenderOptions): string {
  return `<section class="body">
${bodyContentHtml(report.body, options)}
</section>
${referencesHtml(report)}
${photosHtml(report, options)}`
}

export function buildReportDocument(report: Report, config: YearConfig, options: DocumentRenderOptions): string {
  return documentHtml(
    config,
    `${coverHtml(report, config, options)}
${abstractHtml(report, config)}
${tocHtml(report, options.tocPageNumbers ?? {})}
${mainHtml(report, options)}`,
  )
}

/**
 * 報告書を分けて組むときの部分（表示枠の中に、この順に並べる：表紙・抄録・目次・章ごと・残り）。
 * 表紙・抄録・目次・本文の各章は、それぞれ改ページで始まり、前の部分の組み方に影響されない。
 * 分けて組むと、変わった部分だけを組み直せる（段落を書いたときはその章だけ、目次のページ番号が変わったときは目次だけ、
 * 表紙のサブタイトルの大きさを直すときは表紙だけ）。
 * - chapters：章ごとの文書（最後の章を除く）。章の終わりには「次の章の始まり」の代わりを置き、本文全体を組んだときと同じく、
 *   章の終わりの直後を改ページにする（chapterSentinelHtml）。ページ番号は、組んだあとで本文から通しの番号に直す（reportRenderer.ts）
 * - tail：最後の章・引用参考文献・作品写真（分けない。本文の最後のページの図を次のページへ送るとき、次が何のページかで送り方が変わるため）。
 *   splitChapters が false のときは、本文全体と引用参考文献・作品写真（chapters は空）
 */
export interface ReportParts {
  cover: string
  abstract: string
  toc: string
  chapters: string[]
  tail: string
}

/** 報告書を部分ごとの HTML 文書にする（それぞれ、buildReportDocument の同じ部分と同じ中身・同じ CSS） */
export function buildReportParts(report: Report, config: YearConfig, options: DocumentRenderOptions, splitChapters = true): ReportParts {
  const chapters = chapterHtmls(report.body, options)
  const split = splitChapters && chapters.length > 1
  const section = (inner: string) => `<section class="body">\n${inner}\n</section>`
  return {
    cover: documentHtml(config, coverHtml(report, config, options)),
    abstract: documentHtml(config, abstractHtml(report, config)),
    toc: documentHtml(config, tocHtml(report, options.tocPageNumbers ?? {})),
    chapters: split ? chapters.slice(0, -1).map((html, i) => documentHtml(config, section(`${html}\n${chapterSentinelHtml(report.body[i + 1], i + 1)}`))) : [],
    tail: split ? documentHtml(config, `${section(chapters[chapters.length - 1])}\n${referencesHtml(report)}\n${photosHtml(report, options)}`) : documentHtml(config, mainHtml(report, options)),
  }
}

/** 部分の文書を、表示枠に並べる順に */
export function partList(parts: ReportParts): string[] {
  return [parts.cover, parts.abstract, parts.toc, ...parts.chapters, parts.tail]
}
