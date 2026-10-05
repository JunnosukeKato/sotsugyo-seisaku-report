// PoC: 組版設定の違いでサンプルとの一致率がどう変わるかを比べる。
// 使い方: node scripts/poc/experiment.mjs（開発サーバーが http://localhost:5173 で動いていること）
import { execFileSync } from 'node:child_process'

const FIXTURE = 'src/poc/fixtures/sample2025.private.json'
const VARIANTS = [
  { name: 'A 標準（約物の詰めは隣接時のみ）', css: '' },
  { name: 'B 約物をすべて半角に詰める', css: 'body{text-spacing-trim:trim-all}' },
  { name: 'C 約物を詰めない', css: 'body{text-spacing-trim:space-all}' },
  { name: 'D ぶら下げなし', css: 'body{hanging-punctuation:none}' },
  { name: 'G 全角文字だけのページ（38字×38行の確認）', css: '', mode: 'grid' },
]

const rows = []
for (const [i, v] of VARIANTS.entries()) {
  const params = new URLSearchParams()
  if (v.css) params.set('extraCss', v.css)
  if (v.mode) params.set('mode', v.mode)
  const out = `poc-output/variant-${i}.pdf`
  execFileSync('node', ['scripts/poc/render-pdf.mjs', `http://localhost:5173/poc.html?${params}`, out], { stdio: 'ignore' })
  const r = JSON.parse(execFileSync('node', ['scripts/poc/analyze-pdf.mjs', out, FIXTURE], { encoding: 'utf8' }))
  rows.push({
    variant: v.name,
    pages: r.pages,
    pitchPt: r.linePitchPt,
    linesPage1: r.bodyLinesPerPage[0],
    maxChars: r.maxCharsPerLine,
    chars38: r.charsPerLineHistogram['38'] ?? 0,
    kinsokuNG: r.kinsokuViolations.length,
    breakMatch: v.mode ? '-' : `${r.lineBreakMatch.matched}/${r.lineBreakMatch.expectedTotal} (${Math.round(r.lineBreakMatch.rate * 100)}%)`,
    sameParas: v.mode ? '-' : `${r.lineBreakMatch.identicalParas}/${r.lineBreakMatch.paragraphs}`,
    pageSizePt: r.pageSizePt.join(','),
  })
}
console.table(rows)
