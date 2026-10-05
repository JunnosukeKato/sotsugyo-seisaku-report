/**
 * 報告書全体（表紙・抄録・目次・本文・引用参考文献・作品写真）の組版 CSS。
 * 位置や大きさは、テンプレートと 2025年度サンプル PDF から読み取った値（mm・pt）。
 * 表紙はテンプレートの「指定のフォーマットにそのまま入力する」に従い、要素を決まった位置に置く。
 */
import { FONT_SIZE_PT, LETTER_SPACING_PT, LINE_PITCH_PT, reportCss } from './reportCss'

const MM_TO_PT = 72 / 25.4

/** 抄録：10.5pt、横40字、行送り23pt（手順書・テンプレート） */
export const ABSTRACT_FONT_PT = 10.5
export const ABSTRACT_LINE_PITCH_PT = 23
export const ABSTRACT_CHARS_PER_LINE = 40
const ABSTRACT_LETTER_SPACING_PT =
  Math.floor(((150 * MM_TO_PT - ABSTRACT_CHARS_PER_LINE * ABSTRACT_FONT_PT) / ABSTRACT_CHARS_PER_LINE) * 1000) / 1000

/** 作品写真のページの余白（手順書に定めがないため、写真を大きく載せられるよう狭めにする） */
export const PHOTO_PAGE_MARGIN_MM = 15

const COVER_FONT = `'BIZ UDPGothic', sans-serif`
const MINCHO = `'BIZ UDMincho', serif`

export const documentCss = `
${reportCss}

/* ---- ページの種類 ---- */
@page cover { margin: 25mm; @bottom-center { content: none; } }
@page abstract { @bottom-center { content: none; } }
@page toc { @bottom-center { content: none; } }
@page photos { margin: ${PHOTO_PAGE_MARGIN_MM}mm; @bottom-center { content: none; } }

section { break-before: page; }
section:first-child { break-before: auto; }
section.cover { page: cover; }
section.abstract { page: abstract; }
section.toc { page: toc; }
section.photos { page: photos; }
/* ページ番号は本文の1ページ目を「1」とする（表紙・抄録・目次は数えない） */
section.body { counter-reset: page 1; }

/* ---- 表紙（BIZ UDPゴシック。テンプレートは MS Pゴシック） ---- */
.cover { position: relative; height: 247mm; font-family: ${COVER_FONT}; letter-spacing: 0; text-indent: 0; line-height: 1; text-align: left; }
.cover .frame { position: absolute; left: 0; top: 0; width: 161mm; height: 242mm; border: 0.75pt solid #000; }
.cover .el { position: absolute; white-space: nowrap; }
.cover .center { left: 0; width: 161mm; text-align: center; }
.cover .year { top: 16.7mm; font-size: 22pt; }
.cover .heading { top: 39.6mm; font-size: 48pt; }
.cover .label { top: 69.8mm; left: 9.4mm; font-size: 20pt; }
.cover .title { top: 86.2mm; left: 12.7mm; width: 135.8mm; text-align: center; font-size: 22pt; }
.cover .subtitle { top: 105.2mm; left: 12.7mm; width: 135.8mm; text-align: center; font-size: 22pt; }
.cover .rule { position: absolute; left: 12.7mm; width: 135.8mm; border-top: 0.75pt solid #000; }
.cover .rule.title-rule { top: 102mm; }
.cover .rule.subtitle-rule { top: 117.7mm; }
.cover .department { top: 141.4mm; left: 14.4mm; font-size: 18pt; }
.cover .course { top: 152.4mm; right: 13.7mm; font-size: 18pt; }
.cover .id-label { top: 169.5mm; right: 53.4mm; font-size: 16pt; }
.cover .id-value { top: 169.5mm; left: 109.7mm; width: 38.3mm; text-align: center; font-size: 16pt; }
.cover .rule.id-rule { top: 179mm; left: 109.7mm; width: 38.3mm; }
.cover .name-label { top: 191.3mm; left: 21.8mm; font-size: 20pt; }
.cover .name-value { top: 191.3mm; left: 59.2mm; font-size: 20pt; }
.cover .rule.name-rule { top: 201.7mm; left: 57.6mm; width: 90.4mm; }
.cover .rule.bottom-rule { top: 225.5mm; border-top-width: 2pt; }
.cover .university { top: 228mm; font-size: 24pt; }

/* ---- 抄録（10.5pt、横40字、行送り23pt。上部はテンプレートの配置） ---- */
.abstract { font-family: ${MINCHO}; }
.abstract .head { position: relative; height: 59mm; letter-spacing: 0; text-indent: 0; line-height: 1; }
.abstract .head .el { position: absolute; white-space: nowrap; }
.abstract .head .h { top: 2.15mm; left: 0; width: 150mm; text-align: center; font-size: 14pt; }
.abstract .head .row { left: 0; width: 150mm; font-size: 10pt; }
.abstract .head .row2 { top: 11.4mm; display: flex; justify-content: space-between; border-bottom: 0.75pt solid #000; padding-bottom: 1.2mm; }
.abstract .head .row2 .course-part { padding-right: 3.6mm; }
.abstract .head .row3 { top: 19.9mm; width: auto; border-bottom: 0.75pt solid #000; padding: 0 6mm 1.2mm 0; }
.abstract .head .row4 { top: 27.9mm; left: auto; right: 0; width: auto; border-bottom: 0.75pt solid #000; padding: 0 0 1.2mm 8mm; }
.abstract .head .title { top: 35.65mm; left: 0; font-size: 14pt; }
.abstract .head .subtitle { top: 44.8mm; left: 0; font-size: 12pt; }
.abstract .body p {
  font-size: ${ABSTRACT_FONT_PT}pt;
  line-height: ${ABSTRACT_LINE_PITCH_PT}pt;
  letter-spacing: ${ABSTRACT_LETTER_SPACING_PT}pt;
  text-indent: calc(1em + ${ABSTRACT_LETTER_SPACING_PT}pt);
}

/* ---- 目次（11pt。大見出しにリーダーとページ番号、小見出しは字下げのみ） ---- */
.toc { font-family: ${MINCHO}; text-indent: 0; letter-spacing: 0.189pt; }
.toc .toc-title { margin-bottom: ${LINE_PITCH_PT}pt; }
.toc .toc-ch { display: flex; align-items: baseline; }
.toc .toc-ch .leader { flex: 1; overflow: hidden; white-space: nowrap; margin: 0 1pt; }
.toc .toc-ch .leader::before { content: '${'・'.repeat(60)}'; }
.toc .toc-ch .pno { flex: none; }
.toc .toc-sub { padding-left: 5mm; }

/* ---- 引用・参考文献（本文に続けてページ番号を振る） ---- */
.references h1 { margin-bottom: 0; }
.references ul { list-style: none; margin: 0; padding: 0; }
.references li { text-indent: -1em; padding-left: 1em; }

/* ---- 作品写真（文字を置かない。写真は切り取らずに枠内に収める） ---- */
.photos { height: ${297 - PHOTO_PAGE_MARGIN_MM * 2}mm; display: grid; gap: 4mm; }
.photos.layout-1 { grid-template: 1fr / 1fr; }
.photos.layout-2 { grid-template: 1fr / 1fr 1fr; }
.photos.layout-3 { grid-template: 1fr / 1fr 1fr 1fr; }
.photos.layout-4 { grid-template: 1fr 1fr / 1fr 1fr; }
.photos.layout-6 { grid-template: 1fr 1fr 1fr / 1fr 1fr; }
.photos .slot { position: relative; min-width: 0; min-height: 0; }
.photos .slot img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
`

export { FONT_SIZE_PT, LETTER_SPACING_PT, LINE_PITCH_PT }
