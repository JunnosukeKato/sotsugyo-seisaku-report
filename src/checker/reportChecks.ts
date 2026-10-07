import { findCourse, type YearConfig } from '../config'
import { contentToText, editables, numbering, type EditableKind } from '../editor/reportOps'
import { COVER_SUBTITLE, OVERFLOW_RATIO } from '../layout/document'
import type { LayoutInfo } from '../layout/measure'
import type { Report } from '../model/types'
import { swatchColumn } from '../model/table'
import { checkText, DEFAULT_WORD_CHECKS, type TextFinding } from './textRules'
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
  /**
   * 学生が「このままにする（確認済み）」にできる指摘（手順書のルールではない、文章の補助のチェック）の目印。
   * 規則・場所・指摘した文字で決まるので、文を書き足しても同じ指摘なら同じ目印になる
   */
  key?: string
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

/** 指摘（findings）と、学生が「確認済み」にした指摘（acknowledged。エラーに数えない） */
export function checkReportDetailed(report: Report, config: YearConfig, layout?: LayoutInfo | null): { findings: ReportFinding[]; acknowledged: ReportFinding[] } {
  const all = checkReport(report, config, layout, true)
  const keys = new Set(report.acknowledged ?? [])
  return { findings: all.filter((f) => !f.key || !keys.has(f.key)), acknowledged: all.filter((f) => f.key && keys.has(f.key)) }
}

/** セルフチェック。includeAcknowledged を付けないと、学生が「確認済み」にした指摘は除く */
export function checkReport(report: Report, config: YearConfig, layout?: LayoutInfo | null, includeAcknowledged = false): ReportFinding[] {
  const findings: ReportFinding[] = []
  const num = numbering(report)
  const list = editables(report)
  // 書き間違えやすい語：年度の設定にあればそれを、なければツールに入っている一覧を使う
  const words = config.wordChecks ?? DEFAULT_WORD_CHECKS

  // ---- 文章のルール ----
  for (const e of list) {
    const area = AREA_OF_KIND[e.kind]
    for (const f of checkText(e.text, words) as TextFinding[]) {
      if ((f.ruleId === 'taigen-dome' || f.ruleId === 'sentence-end') && !SENTENCE_KINDS.includes(e.kind)) continue
      const key = f.source === 'supplementary' ? `${f.ruleId}|${e.id}|${e.text.slice(f.start, f.end)}` : undefined
      findings.push({ ...f, area, blockId: e.id, ...(key ? { key } : {}) })
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
  // 姓と名の間は全角の空白（はじめての案内でも、そう伝えている）。半角の空白なら、全角に直せる
  const halfSpace = basicInfo.name.search(/(?<=\S) +(?=\S)/)
  if (halfSpace >= 0) {
    const end = basicInfo.name.slice(halfSpace).search(/[^ ]/) + halfSpace
    findings.push(
      guide('name-space', 'warning', '姓と名の間は全角の空白にする', 'cover', { blockId: 'basic:name', start: halfSpace, end, replacement: '　', detail: '半角の空白 → 全角の空白（例：文化　花子）' }),
    )
  }
  if (config.studentIdPattern && basicInfo.studentId.trim() && !new RegExp(config.studentIdPattern).test(basicInfo.studentId.trim())) {
    findings.push(guide('student-id-format', 'warning', '学籍番号の形式を確認する', 'cover', { blockId: 'basic:studentId' }))
  }
  // サブタイトルは、枠の1行に入るまで文字を小さくする（document.ts）。いちばん小さくしても入らないとき（組んだ紙面で測る）。
  // 題目は申告書と同じにする決まりなので、短くするようには言わず、確かめ方と相談先を伝える
  const subtitleFit = layout?.coverSubtitle
  if (subtitleFit && subtitleFit.ratio > OVERFLOW_RATIO && basicInfo.subtitleInput.trim()) {
    findings.push(
      guide('cover-subtitle-fit', 'error', 'サブタイトルが長く、表紙の1行に入りません', 'cover', {
        blockId: 'basic:subtitleInput',
        start: 0,
        end: basicInfo.subtitleInput.length,
        detail:
          `いちばん小さい文字（${COVER_SUBTITLE.minPt}pt）にしても、枠からはみ出します（今 ${subtitleFit.chars}字・${subtitleFit.fitChars}字くらいまで入ります）。` +
          '題目は申告書と同じにする決まりです。申告書のとおりに入力しているか（よけいな字や空白がないか）を確かめ、申告書のとおりでも入らないときは、指導の先生に相談してください',
      }),
    )
  }

  // ---- 抄録 ----
  // 抄録は、先生の許可が出てから書く。書き始めるまでは字数・行数を確かめず、まだ書いていないことだけを知らせる。
  // 抄録のない報告書は提出できないので、エラーにする（途中経過を先生に見せるときは、下書きの PDF で出せる）
  const chars = abstractCharCount(report)
  const { minChars, maxChars, minLines, maxLines } = config.abstract
  const abstractStarted = report.abstract.started !== false
  if (!abstractStarted) {
    findings.push(
      guide('abstract-not-started', 'error', '抄録はまだ書いていない', 'abstract', {
        detail: '本文を書き終えて、先生のチェックで許可が出たら、抄録のページの「先生の許可が出た」を押して書き始めます（それまでの途中経過は、下書きの PDF で先生に見せられます）',
      }),
    )
  }
  if (abstractStarted && (chars < minChars || chars > maxChars)) {
    findings.push(
      guide('abstract-length', 'error', `抄録は${minChars}〜${maxChars}字にする`, 'abstract', {
        detail: `現在 ${chars}字（${chars < minChars ? `あと${minChars - chars}字` : `${chars - maxChars}字多い`}）`,
      }),
    )
  }
  if (layout && abstractStarted) {
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
    if (!e.text.trim() && ['chapter', 'subheading', 'figureCaption', 'tableCaption'].includes(e.kind)) {
      const what = { chapter: '大見出し', subheading: '小見出し', figureCaption: '図のタイトル', tableCaption: '表のタイトル' }[e.kind as string]
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

  // 表のセル：見出しの行の空欄はエラー。ほかの空いているセル（画像もない）は注意
  for (const block of report.body.flatMap((c) => c.blocks)) {
    if (block.type !== 'table') continue
    block.rows.forEach((row, i) => {
      for (const c of row.cells) {
        if (c.text.trim() || c.imageId) continue
        if (i === 0) findings.push(guide('required-text', 'error', '表の見出しが入力されていない', 'body', { blockId: c.id }))
        else findings.push({ ruleId: 'table-cell-empty', severity: 'warning', source: 'supplementary', title: '表に空いているセルがある', area: 'body', blockId: c.id })
      }
    })
  }

  // 図表の番号を手で書いている：「図を入れる」「表を入れる」で入れた（図n）は図表とつながっていて、番号が自動でそろう。
  // 手で書いた（図n）も、その番号の図表があれば確定したときにつながる。つながらずに文字のまま残ったものを知らせる
  const manual = /[（(]\s*([図表])\s*([0-9０-９]+)\s*[）)]|(?<![㐀-鿿々])([図表])([0-9０-９]+)/g
  for (const block of report.body.flatMap((c) => c.blocks)) {
    if (block.type !== 'paragraph') continue
    let offset = 0
    for (const node of block.content) {
      const length = contentToText([node], num).length
      if (node.type === 'text') {
        for (const m of node.text.matchAll(manual)) {
          const kind = (m[1] ?? m[3]) as '図' | '表'
          const n = Number((m[2] ?? m[4]).replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)))
          const exists = (kind === '表' ? num.tableByNumber : num.figureByNumber).has(n)
          if (!exists) continue
          findings.push({
            ruleId: 'manual-ref',
            severity: 'error',
            source: 'supplementary',
            title: `${kind}の番号を手で書いている`,
            detail: `「直す」で${kind}${n}とつなげます（つなげると、${kind}を足したり消したりしても番号が自動でそろいます）`,
            area: 'body',
            blockId: block.id,
            start: offset + m.index,
            end: offset + m.index + m[0].length,
            replacement: `（${kind}${n}）`,
          })
        }
      }
      offset += length
    }
  }

  // 改ページ：ページの半分以上が空いている（ページ数を増やすためだけの改ページになっていないか）
  for (const b of layout?.pageBreaks ?? []) {
    if (b.emptyRatio > 0.5) {
      findings.push({
        ruleId: 'page-break-gap',
        severity: 'warning',
        source: 'supplementary',
        title: '改ページで、ページの半分以上が空いている',
        detail: `ページの約${Math.round(b.emptyRatio * 10) * 10}%が空いています。改ページが要るか確かめましょう`,
        area: 'body',
        blockId: b.id,
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
    } else if (block.type === 'table') {
      const n = num.numbers.get(block.id)
      if (!referenced.has(block.id))
        findings.push(guide('table-unreferenced', 'error', `本文中に「表${n}」または「（表${n}）」を入れる`, 'body', { blockId: block.id, detail: `表${n}が本文から参照されていない` }))
      // 素材表（見出しに「生地見本」の列がある表）：生地見本に写真を入れる
      const swatch = swatchColumn(block)
      if (swatch >= 0) {
        for (const row of block.rows.slice(1)) {
          const c = row.cells[swatch]
          if (c && !c.imageId) findings.push(guide('swatch-image', 'error', '素材表の生地見本に写真を入れる', 'body', { blockId: c.id }))
        }
      }
    }
  }
  // 存在しない図表の番号（削除された図への参照「図?」や、手で書いた「（図9）」）
  for (const e of list.filter((x) => x.kind === 'paragraph')) {
    for (const m of e.text.matchAll(/[（(]?([図表])\s*(\d+|\?)[）)]?/g)) {
      if (/[㐀-鿿々]/.test(e.text[m.index - 1] ?? '') && !m[0].startsWith('（') && !m[0].startsWith('(')) continue
      const exists = m[2] !== '?' && (m[1] === '表' ? num.tableByNumber : num.figureByNumber).has(Number(m[2]))
      if (!exists)
        findings.push(
          guide('reference-missing', 'error', `「${m[0]}」の${m[1]}がない`, 'body', {
            blockId: e.id,
            start: m.index,
            end: m.index + m[0].length,
            detail: '図は「図を入れる」、表は「表を入れる」で入れます。前に入れた図表を指すときは、その番号を（図1）のように書くと自動でつながります',
          }),
        )
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

  if (includeAcknowledged) return findings
  const acknowledged = new Set(report.acknowledged ?? [])
  return findings.filter((f) => !f.key || !acknowledged.has(f.key))
}
