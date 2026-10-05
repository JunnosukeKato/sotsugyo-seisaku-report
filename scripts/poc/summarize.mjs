// PoC: 2方式（Vivliostyle＋ブラウザ印刷 / Typst）の PDF を同じ基準で採点して表にする。
// 使い方: node scripts/poc/summarize.mjs（先に render-pdf.mjs と typst compile で PDF を作っておく）
import { execFileSync } from 'node:child_process'

const FIXTURE = 'src/poc/fixtures/sample2025.private.json'
const TARGETS = [
  ['Vivliostyle', 'サンプル本文', 'poc-output/body.pdf'],
  ['Vivliostyle', '38字×38行', 'poc-output/variant-4.pdf'],
  ['Vivliostyle', '禁則', 'poc-output/vivliostyle-kinsoku.pdf'],
  ['Typst', 'サンプル本文', 'poc-output/typst-sample.pdf'],
  ['Typst', '38字×38行', 'poc-output/typst-grid.pdf'],
  ['Typst', '禁則', 'poc-output/typst-kinsoku.pdf'],
]

const rows = TARGETS.map(([engine, test, pdf]) => {
  const r = JSON.parse(execFileSync('node', ['scripts/poc/analyze-pdf.mjs', pdf, FIXTURE], { encoding: 'utf8' }))
  return {
    engine,
    test,
    pages: r.pages,
    pitchPt: r.linePitchPt,
    linesPage1: r.bodyLinesPerPage[0],
    maxChars: r.maxCharsPerLine,
    lines38: r.charsPerLineHistogram['38'] ?? 0,
    kinsokuNG: r.kinsokuViolations.length,
    kinsokuExamples: r.kinsokuViolations.slice(0, 3).join(' / '),
    breakMatch: test === 'サンプル本文' ? `${r.lineBreakMatch.matched}/${r.lineBreakMatch.expectedTotal} (${Math.round(r.lineBreakMatch.rate * 100)}%)` : '-',
    sameParas: test === 'サンプル本文' ? `${r.lineBreakMatch.identicalParas}/${r.lineBreakMatch.paragraphs}` : '-',
    embedded: r.fonts.every((f) => f.embedded),
    pageSizeMm: r.pageSizeMm.join(','),
  }
})
console.table(rows)
