import { findCourse, type YearConfig } from '../config'
import { contentToText, editables, numbering, type EditableKind } from '../editor/reportOps'
import type { LayoutInfo } from '../layout/measure'
import type { Report } from '../model/types'
import { checkText, type TextFinding } from './textRules'
import type { Severity } from './types'

/**
 * 報告書全体のセルフチェック。
 * - 文章のルール（textRules）を、紙面上で編集できるすべての文字列に当てる
 * - 手順書の分量・構成のルール（抄録の字数と行数、本文のページ数、図表の参照など）を確かめる
 * 組版の結果（layout）が必要なルールは、layout が渡されたときだけ判定する。
 */

export type Area = 'cover' | 'abstract' | 'toc' | 'body' | 'references' | 'photos'

export interface ReportFinding {
  ruleId: string
  severity: Severity
  source: 'guide' | 'supplementary'
  title: string
  detail?: string
  area: Area
  /** 紙面上の位置（文字列の指摘のとき） */
  blockId?: string
  start?: number
  end?: number
  replacement?: string
}

const AREA_OF_KIND: Record<EditableKind, Area> = {
  field: 'cover',
  abstractParagraph: 'abstract',
  chapter: 'body',
  subheading: 'body',
  paragraph: 'body',
  figureCaption: 'body',
  tableCaption: 'body',
  tableCell: 'body',
}

/** 体言止めの判定は段落だけにする（見出しや図のタイトル、表のセルは名詞で終わるのが普通） */
const SENTENCE_KINDS: EditableKind[] = ['paragraph', 'abstractParagraph']

function guide(ruleId: string, severity: Severity, title: string, area: Area, extra: Partial<ReportFinding> = {}): ReportFinding {
  return { ruleId, severity, source: 'guide', title, area, ...extra }
}

/** 抄録の文字数（空白と改行を除く） */
export function abstractCharCount(report: Report): number {
  const num = numbering(report)
  return report.abstract.paragraphs.reduce((n, p) => n + contentToText(p.content, num).replace(/[\s　]/g, '').length, 0)
}

export function checkReport(report: Report, config: YearConfig, layout?: LayoutInfo | null): ReportFinding[] {
  const findings: ReportFinding[] = []
  const num = numbering(report)
  const list = editables(report)

  // ---- 文章のルール ----
  for (const e of list) {
    const area = AREA_OF_KIND[e.kind]
    for (const f of checkText(e.text) as TextFinding[]) {
      if (f.ruleId === 'taigen-dome' && !SENTENCE_KINDS.includes(e.kind)) continue
      findings.push({ ...f, area, blockId: e.id })
    }
  }

  // ---- 表紙・基本情報 ----
  const { basicInfo } = report
  const required: [string, string, string][] = [
    ['basic:studentId', basicInfo.studentId, '学籍番号'],
    ['basic:name', basicInfo.name, '氏名'],
    ['basic:subtitleInput', basicInfo.subtitleInput, 'サブタイトル'],
  ]
  for (const [blockId, value, label] of required) {
    if (!value.trim()) findings.push(guide('required-field', 'error', `表紙の${label}が入力されていない`, 'cover', { blockId }))
  }
  if (!findCourse(config, basicInfo.courseId)) {
    findings.push(guide('required-field', 'error', 'コースが選ばれていない', 'cover', { blockId: 'basic:course' }))
  }
  if (config.studentIdPattern && basicInfo.studentId.trim() && !new RegExp(config.studentIdPattern).test(basicInfo.studentId.trim())) {
    findings.push(guide('student-id-format', 'warning', '学籍番号の形式を確認する', 'cover', { blockId: 'basic:studentId' }))
  }

  // ---- 抄録 ----
  const chars = abstractCharCount(report)
  const { minChars, maxChars, minLines, maxLines } = config.abstract
  if (chars < minChars || chars > maxChars) {
    findings.push(
      guide('abstract-length', 'error', `抄録は${minChars}〜${maxChars}字にする`, 'abstract', {
        detail: `現在 ${chars}字（${chars < minChars ? `あと${minChars - chars}字` : `${chars - maxChars}字多い`}）`,
      }),
    )
  }
  if (layout) {
    if (layout.abstractPages > 1) {
      findings.push(guide('abstract-one-page', 'error', '抄録は1ページに収める', 'abstract', { detail: `現在 ${layout.abstractPages}ページ` }))
    }
    if (layout.abstractLines < minLines || layout.abstractLines > maxLines) {
      findings.push(guide('abstract-lines', 'error', `抄録は${minLines}〜${maxLines}行にする`, 'abstract', { detail: `現在 ${layout.abstractLines}行` }))
    }
  }

  // ---- 本文 ----
  if (layout && layout.bodyPages < config.body.minPages) {
    findings.push(
      guide('body-pages', 'error', `本文はA4で${config.body.minPages}ページ以上にする`, 'body', {
        detail: `現在 ${layout.bodyPages}ページ（引用・参考文献のページは含めない）`,
      }),
    )
  }
  if (layout) {
    const figures = num.figureByNumber.size
    const guideMax = layout.bodyPages * config.body.imagesPerPageGuide
    if (figures > guideMax) {
      findings.push(
        guide('figures-per-page', 'warning', `画像は1ページあたり${config.body.imagesPerPageGuide}枚程度にする`, 'body', {
          detail: `図 ${figures}枚・本文 ${layout.bodyPages}ページ（目安は${guideMax}枚まで）`,
        }),
      )
    }
  }
  for (const e of list) {
    if (!e.text.trim() && ['chapter', 'subheading', 'figureCaption', 'tableCaption', 'tableCell'].includes(e.kind)) {
      const what = { chapter: '大見出し', subheading: '小見出し', figureCaption: '図のタイトル', tableCaption: '表のタイトル', tableCell: '表のセル' }[e.kind as string]
      findings.push(guide('required-text', 'error', `${what}が入力されていない`, 'body', { blockId: e.id }))
    }
  }

  // 書き忘れ：まだ何も書いていない段落（ひな形の「書くことの説明」だけが残っている段落）
  for (const block of report.body.flatMap((c) => c.blocks)) {
    if (block.type === 'paragraph' && !contentToText(block.content, num).trim()) {
      findings.push({
        ruleId: 'paragraph-empty',
        severity: 'warning',
        source: 'supplementary',
        title: block.hint ? 'まだ書いていない段落がある' : '空の段落がある',
        detail: block.hint,
        area: 'body',
        blockId: block.id,
      })
    }
  }

  // 図表：画像、本文中での参照（リンクになった参照も、手で書いた「表1」も、文字列として数える）
  const referenced = new Set<string>()
  for (const e of list.filter((x) => x.kind === 'paragraph')) {
    for (const m of e.text.matchAll(/([図表])\s*(\d+)/g)) {
      const id = (m[1] === '表' ? num.tableByNumber : num.figureByNumber).get(Number(m[2]))
      if (id) referenced.add(id)
    }
  }
  for (const block of report.body.flatMap((c) => c.blocks)) {
    if (block.type === 'figureRow') {
      for (const f of block.figures) {
        const n = num.numbers.get(f.id)
        if (!f.imageId) findings.push(guide('figure-image', 'error', `図${n}の画像が入っていない`, 'body', { blockId: f.id }))
        if (!referenced.has(f.id))
          findings.push(guide('figure-unreferenced', 'error', `本文中に「図${n}」または「（図${n}）」を入れる`, 'body', { blockId: f.id, detail: `図${n}が本文から参照されていない` }))
      }
    } else if (block.type === 'materialTable') {
      const n = num.numbers.get(block.id)
      if (!referenced.has(block.id))
        findings.push(guide('table-unreferenced', 'error', `本文中に「表${n}」または「（表${n}）」を入れる`, 'body', { blockId: block.id, detail: `表${n}が本文から参照されていない` }))
      for (const row of block.rows) {
        if (!row.swatchImageId) findings.push(guide('swatch-image', 'error', '素材表の生地見本に写真を入れる', 'body', { blockId: `${row.id}:name` }))
      }
    }
  }
  // 存在しない図表の番号（削除された図への参照「図?」や、手で書いた「（図9）」）
  for (const e of list.filter((x) => x.kind === 'paragraph')) {
    for (const m of e.text.matchAll(/[（(]?([図表])\s*(\d+|\?)[）)]?/g)) {
      if (/[㐀-鿿々]/.test(e.text[m.index - 1] ?? '') && !m[0].startsWith('（') && !m[0].startsWith('(')) continue
      const exists = m[2] !== '?' && (m[1] === '表' ? num.tableByNumber : num.figureByNumber).has(Number(m[2]))
      if (!exists)
        findings.push(guide('reference-missing', 'error', `「${m[0]}」の${m[1]}がない`, 'body', { blockId: e.id, start: m.index, end: m.index + m[0].length }))
    }
  }

  // ---- 引用・参考文献 ----
  for (const ref of report.references) {
    const missing =
      ref.type === 'book'
        ? [['著者名', ref.author], ['書名', ref.title], ['出版社', ref.publisher], ['出版年', ref.year]]
        : [['サイト名', ref.siteTitle], ['アドレス（URL）', ref.url], ['参照日', ref.accessedOn]]
    for (const [label, value] of missing) {
      if (!value.trim()) findings.push(guide('reference-field', 'error', `引用・参考文献の${label}が入力されていない`, 'references'))
    }
  }

  // ---- 作品写真 ----
  // ページに載るのは先頭から layout 枚（枚数を減らしても、後ろの写真は消さずに残している）
  const photos = report.workPhotos.imageIds.slice(0, report.workPhotos.layout).filter(Boolean)
  if (photos.length === 0) findings.push(guide('photos-required', 'error', '作品写真を入れる', 'photos'))
  else if (photos.length < report.workPhotos.layout)
    findings.push(guide('photos-empty-slot', 'warning', '作品写真のページに空いている枠がある', 'photos', { detail: `${report.workPhotos.layout}枚の配置に${photos.length}枚` }))

  return findings
}
