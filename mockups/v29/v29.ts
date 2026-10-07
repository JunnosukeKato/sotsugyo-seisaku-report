// v29 表紙と目次の調整の見本。本物の組版の部品（coverHtml・documentCss）に、案ごとの上書きの CSS を足して並べる
import config from '../../scripts/e2e/config-fixture.json'
import type { YearConfig } from '../../src/config'
import { coverHtml } from '../../src/layout/document'
import { documentCss } from '../../src/layout/documentCss'
import { chapterLabel, subheadingLabel } from '../../src/layout/bodyHtml'
import { DATA_FORMAT_VERSION, type Report } from '../../src/model/types'

const cfg = config as unknown as YearConfig
const report: Report = {
  formatVersion: DATA_FORMAT_VERSION,
  fiscalYear: cfg.fiscalYear,
  basicInfo: { studentId: '00ZZ0123', name: '文化　花子', courseId: 'film-stage-costume', subtitleInput: 'シンドバッド' },
  abstract: { paragraphs: [] },
  body: [],
  references: [],
  workPhotos: { layout: 1, imageIds: [] },
  updatedAt: '',
}

const ZOOM = 0.45
/** 目次は字が小さいので大きめに出し、ページの上の6割だけを見せる */
const TOC_ZOOM = 0.62
const TOC_SHOW = 0.55
const PT = 25.4 / 72
const FONT_22 = 22 * PT

/** 今の表紙の位置（documentCss の値。枠の左上からの mm） */
const BASE = { margin: 25, frameW: 161, frameH: 242 }
const TOPS: Record<string, number> = {
  year: 16.7, heading: 39.6, label: 69.8, department: 141.4, course: 152.4,
  'id-label': 169.5, 'id-value': 169.5, 'name-label': 191.3, 'name-value': 191.3, university: 228,
}
const LEFTS: Record<string, number> = { label: 9.4, title: 12.7, subtitle: 12.7, department: 14.4, 'id-value': 109.7, 'name-label': 21.8, 'name-value': 59.2 }
const RIGHTS: Record<string, number> = { course: 13.7, 'id-label': 53.4 }
const RULES: Record<string, { top: number; left?: number; width?: number }> = {
  'title-rule': { top: 102 },
  'subtitle-rule': { top: 117.7 },
  'id-rule': { top: 179, left: 109.7, width: 38.3 },
  'name-rule': { top: 201.7, left: 57.6, width: 90.4 },
  'bottom-rule': { top: 225.5 },
}

/** 外の余白 margin（mm）と、題目・サブタイトルの文字の下から罫線までの間 gap（mm）の表紙の CSS */
function coverCss(margin: number, gap: number): string {
  const grow = 2 * (BASE.margin - margin)
  const w = BASE.frameW + grow
  const h = BASE.frameH + grow
  const sx = w / BASE.frameW
  const sy = h / BASE.frameH
  const mm = (v: number) => `${v.toFixed(2)}mm`
  const lines = [
    `.page.cover-page { padding: ${mm(margin)}; }`,
    `.cover { height: ${mm(h + 5)}; }`,
    `.cover .frame { width: ${mm(w)}; height: ${mm(h)}; }`,
    `.cover .center { width: ${mm(w)}; }`,
    `.cover .rule { left: ${mm(12.7 * sx)}; width: ${mm(135.8 * sx)}; }`,
    `.cover .title, .cover .subtitle { left: ${mm(12.7 * sx)}; width: ${mm(135.8 * sx)}; }`,
  ]
  for (const [k, v] of Object.entries(TOPS)) lines.push(`.cover .${k} { top: ${mm(v * sy)}; }`)
  for (const [k, v] of Object.entries(LEFTS)) lines.push(`.cover .${k} { left: ${mm(v * sx)}; }`)
  for (const [k, v] of Object.entries(RIGHTS)) lines.push(`.cover .${k} { right: ${mm(v * sx)}; }`)
  for (const [k, r] of Object.entries(RULES)) {
    lines.push(`.cover .rule.${k} { top: ${mm(r.top * sy)};${r.left !== undefined ? ` left: ${mm(r.left * sx)};` : ''}${r.width !== undefined ? ` width: ${mm(r.width * sx)};` : ''} }`)
  }
  // 題目・サブタイトルは、罫線の gap mm 上に文字の下がくるように置く
  lines.push(`.cover .title { top: ${mm(RULES['title-rule'].top * sy - gap - FONT_22)}; }`)
  lines.push(`.cover .subtitle { top: ${mm(RULES['subtitle-rule'].top * sy - gap - FONT_22)}; }`)
  return lines.join('\n')
}

const PAGE_CSS = `
html, body { overflow: hidden; }
body { margin: 0; background: #fff; letter-spacing: 0; text-align: left; }
.page { width: 210mm; height: 297mm; box-sizing: border-box; background: #fff; overflow: hidden; }
.page.cover-page { padding: 25mm; }
.page.toc-page { padding: 25mm 25mm 25mm 35mm; }
`

function frame(html: string, css: string, zoom = ZOOM, show = 1): HTMLIFrameElement {
  const f = document.createElement('iframe')
  f.style.width = `${Math.round(794 * zoom)}px`
  f.style.height = `${Math.round(1123 * zoom * show)}px`
  f.srcdoc = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=BIZ+UDMincho&family=BIZ+UDPGothic&display=swap">
<style>${documentCss}${PAGE_CSS} body { zoom: ${zoom}; } ${css}</style></head><body>${html}</body></html>`
  return f
}

function cell(parent: HTMLElement, title: string, note: string, el: HTMLElement) {
  const c = document.createElement('div')
  c.className = 'cell'
  c.innerHTML = `<b>${title}</b><small>${note}</small>`
  c.append(el)
  parent.append(c)
}

const coverPage = `<div class="page cover-page">${coverHtml(report, cfg)}</div>`
const covers = document.getElementById('covers')!
cell(covers, '今', '外の余白 25mm。題目は罫線の約8mm上、サブタイトルは約5mm上', frame(coverPage, ''))
cell(covers, '案A 少し', '余白 22mm。題目・サブタイトルを罫線の4mm上に<br>（学籍番号の欄と同じくらい）', frame(coverPage, coverCss(22, 4)))
cell(covers, '案B 中くらい', '余白 20mm。罫線の3mm上に<br>（氏名の欄と同じくらい）', frame(coverPage, coverCss(20, 3)))
cell(covers, '案C しっかり', '余白 18mm。罫線の2mm上に', frame(coverPage, coverCss(18, 2)))

/** 見本の原稿の目次（document.ts の tocHtml と同じ形） */
const chapters: [string, number, string[]][] = [
  ['企画・立案', 1, ['担当衣装のキャラクター', 'デザイン説明', '使用素材']],
  ['制作過程', 4, ['パターンと仮縫い', '袖の刺繍', '帯とズボン', '仕上げ']],
  ['まとめ', 6, ['成果', '今後の課題']],
]
const tocPage = `<div class="page toc-page"><section class="toc">
<div class="toc-title">目次</div>
${chapters
  .map(
    ([t, p, subs], i) =>
      `<div class="toc-ch"><span>${chapterLabel(i)}${t}</span><span class="leader"></span><span class="pno">${p}</span></div>\n` +
      subs.map((s, j) => `<div class="toc-sub">${subheadingLabel(j)}${s}</div>`).join('\n'),
  )
  .join('\n')}
<div class="toc-ch"><span>引用・参考文献</span><span class="leader"></span><span class="pno">7</span></div>
</section></div>`
const tocGap = (lines: number) => `.toc .toc-ch ~ .toc-ch { margin-top: ${(18.4 * lines).toFixed(1)}pt; }`
const tocs = document.getElementById('tocs')!
cell(tocs, '今', 'すき間なし', frame(tocPage, '', TOC_ZOOM, TOC_SHOW))
cell(tocs, '案A 半行', '大見出しの前に半行（約3mm）', frame(tocPage, tocGap(0.5), TOC_ZOOM, TOC_SHOW))
cell(tocs, '案B 1行', '大見出しの前に1行（約6.5mm）', frame(tocPage, tocGap(1), TOC_ZOOM, TOC_SHOW))
cell(tocs, '案C 1行半', '大見出しの前に1行半（約10mm）', frame(tocPage, tocGap(1.5), TOC_ZOOM, TOC_SHOW))
