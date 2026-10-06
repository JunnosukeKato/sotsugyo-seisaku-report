/**
 * 本文ページの組版 CSS。手順書の書式をここで固定する。
 * - A4、余白 上下右25mm・左35mm
 * - 11pt、1行38字（字間で調整）、1ページ38行（行送り18.4pt）
 * - 禁則（行頭の小書き仮名・長音を禁止）、句読点のぶら下げ、和欧間のすき間（Word の既定に合わせる）
 */

export const FONT_SIZE_PT = 11
const CHARS_PER_LINE = 38
const TEXT_WIDTH_MM = 210 - 35 - 25
const MM_TO_PT = 72 / 25.4
/** 38字ちょうどで1行が埋まる字間。丸め誤差で37字に落ちないよう、わずかに切り捨てる */
export const LETTER_SPACING_PT =
  Math.floor(((TEXT_WIDTH_MM * MM_TO_PT - CHARS_PER_LINE * FONT_SIZE_PT) / CHARS_PER_LINE) * 1000) / 1000
/** Word テンプレートの行送り（368twip） */
export const LINE_PITCH_PT = 18.4

export const reportCss = `
@page {
  size: A4;
  margin: 25mm 25mm 25mm 35mm;
  @bottom-center {
    content: counter(page);
    font-family: 'BIZ UDMincho', serif;
    font-size: ${FONT_SIZE_PT}pt;
    vertical-align: top;
    padding-top: 10mm;
  }
}

:root {
  font-family: 'BIZ UDMincho', serif;
  font-size: ${FONT_SIZE_PT}pt;
  line-height: ${LINE_PITCH_PT}pt;
}

body {
  margin: 0;
  text-align: justify;
  text-justify: inter-character;
  letter-spacing: ${LETTER_SPACING_PT}pt;
  line-break: strict;
  hanging-punctuation: allow-end;
  text-autospace: normal;
  text-spacing-trim: normal;
  /* テンプレートは「改ページ時1行残して段落を区切らない」がオフ */
  widows: 1;
  orphans: 1;
}

h1, h2 {
  font: inherit;
  margin: 0;
  /* 見出しだけがページの最後に取り残されないようにする */
  break-after: avoid;
}

/* 大見出しは改ページして始める（テンプレート・サンプルと同じ） */
h1.chapter:not(:first-child) {
  break-before: page;
}

h2.subheading {
  margin-top: ${LINE_PITCH_PT}pt;
}

h1.chapter + h2.subheading {
  margin-top: 0;
}

/* 学生が入れた改ページ：この後ろは次のページから始める */
.page-break {
  break-after: page;
  height: 0;
}

/* 小見出しの下に本文が3行以上入らないときは、小見出しごと次のページへ送る（見出しの下に1〜2行だけ残さない） */
h2.subheading + p {
  orphans: 3;
}

p {
  margin: 0;
  text-indent: calc(1em + ${LETTER_SPACING_PT}pt);
}

/* 図のまとまり（段落のすぐ下）。2枚ずつの段に分け、段の途中では改ページしない */
.figure-group {
  margin: ${LINE_PITCH_PT}pt 0;
}

/*
 * 段落のすぐ下に入りきらない図のまとまりは、次のページの上へ送り、後ろの文章で今のページを埋める。
 * 送るまとまりは、組んだ結果を見て figureFloat.ts が選ぶ（入りきるものまで送ると、段落より上に出てしまうため）
 */
.figure-group.deferred {
  float: block-start;
  float-reference: page;
  margin: 0 0 ${LINE_PITCH_PT}pt;
}

.figure-row {
  display: flex;
  justify-content: center;
  align-items: flex-end;
  column-gap: 8mm;
  break-inside: avoid;
}

.figure-row + .figure-row {
  margin-top: ${LINE_PITCH_PT / 2}pt;
}

figure {
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}

figure img {
  display: block;
}

figcaption,
.table-caption {
  text-align: center;
  text-indent: 0;
  margin-top: ${LINE_PITCH_PT / 2}pt;
}

.material-table {
  margin: 0 0 ${LINE_PITCH_PT}pt;
}

/* 表のタイトルは表の上。表と別のページに分かれないようにする */
.material-table .table-caption {
  margin: 0;
  break-after: avoid;
}

.material-table table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.material-table th,
.material-table td {
  border: 0.75pt solid #000;
  text-align: center;
  vertical-align: middle;
  text-indent: 0;
  padding: 2pt 4pt;
  white-space: pre-line;
}

.material-table tr {
  break-inside: avoid;
}

.material-table td img {
  margin: 0 auto;
}
`
