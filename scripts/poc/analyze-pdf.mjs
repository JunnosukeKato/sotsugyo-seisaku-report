// PoC: 書き出した PDF を解析し、サンプル（Word 版）との違いを数値で示す。
// - 用紙サイズ、ページ数、フォントの埋め込み
// - 1行の字数、1ページの行数、行送り
// - 禁則（行頭の小書き仮名・長音）
// - 段落ごとの改行位置がサンプルと一致する割合
// 使い方: node scripts/poc/analyze-pdf.mjs <body.pdf> <fixture.private.json>
import { readFileSync } from 'node:fs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const [pdfPath, fixturePath] = process.argv.slice(2)
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'))
const doc = await getDocument({ data: new Uint8Array(readFileSync(pdfPath)), verbosity: 0 }).promise

const MM = 72 / 25.4
const TEXT_LEFT = 35 * MM
const TEXT_TOP_FROM_BOTTOM = (297 - 25) * MM
const TEXT_BOTTOM_FROM_BOTTOM = 25 * MM
const NO_LINE_START = /^[ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶㇰ-ㇿー]/
const width = (s) => [...s].reduce((n, c) => n + (/[\x20-\x7e]/.test(c) ? 0.5 : 1), 0)

const pages = []
const fonts = new Map()
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n)
  const { width: w, height: h } = page.getViewport({ scale: 1 })
  const ops = await page.getOperatorList()
  for (let i = 0; i < ops.fnArray.length; i++) {
    const args = ops.argsArray[i]
    if (Array.isArray(args) && typeof args[0] === 'string' && args[0].startsWith('g_d') && !fonts.has(args[0])) {
      try {
        const f = page.commonObjs.get(args[0])
        fonts.set(args[0], { name: f.name, embedded: !f.missingFile })
      } catch {}
    }
  }
  const content = await page.getTextContent()
  const rows = new Map()
  for (const item of content.items) {
    if (!item.str || !item.str.trim()) continue
    const y = Math.round(item.transform[5] * 10) / 10
    const x = item.transform[4]
    if (!rows.has(y)) rows.set(y, [])
    rows.get(y).push({ x, str: item.str, w: item.width })
  }
  const lines = [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([y, items]) => {
      items.sort((a, b) => a.x - b.x)
      const text = items.map((i) => i.str).join('').replace(/\s+/g, '').normalize('NFKC')
      const right = Math.max(...items.map((i) => i.x + i.w))
      return { y, x: items[0].x, right, text }
    })
  pages.push({ n, w, h, lines })
}

// 本文の行（本文領域の左端から始まる行。中央揃えの図表タイトルや表の中、ページ番号は除く）
const isBodyLine = (l) =>
  l.y < TEXT_TOP_FROM_BOTTOM + 2 && l.y > TEXT_BOTTOM_FROM_BOTTOM - 2 && Math.abs(l.x - TEXT_LEFT) < 12
const bodyLines = pages.flatMap((p) => p.lines.filter(isBodyLine).map((l) => ({ ...l, page: p.n })))

// 段落ごとの改行位置の比較
const stream = bodyLines.map((l) => l.text)
const joined = stream.join('')
const ourBreaks = new Set()
let pos = 0
for (const t of stream) ourBreaks.add((pos += t.length))
const paragraphs = fixture.chapters.flatMap((c) => c.blocks).filter((b) => b.type === 'paragraph')
let expectedTotal = 0
let matched = 0
let identicalParas = 0
const diffs = []
for (const p of paragraphs) {
  const text = p.expectedLines.join('').normalize('NFKC')
  const start = joined.indexOf(text)
  if (start < 0) {
    diffs.push({ para: text.slice(0, 20), problem: 'PDF の中に段落の文字列が見つからない' })
    continue
  }
  const expected = []
  let acc = 0
  for (const l of p.expectedLines.slice(0, -1)) expected.push((acc += l.normalize('NFKC').length))
  const ours = [...ourBreaks].filter((b) => b > start && b < start + text.length).map((b) => b - start)
  const ok = expected.filter((b) => ours.includes(b)).length
  expectedTotal += expected.length
  matched += ok
  if (ok === expected.length && ours.length === expected.length) identicalParas++
  else
    diffs.push({
      para: text.slice(0, 16) + '…',
      sample: p.expectedLines.map((l) => l.slice(-6)).join(' | '),
      ours: ours.concat(text.length).map((b) => text.slice(b - 6, b)).join(' | '),
    })
}

// 1ページの行数・行送り（文字だけのページで測る）
const pitches = []
for (const p of pages) {
  const ys = p.lines.filter(isBodyLine).map((l) => l.y)
  for (let i = 1; i < ys.length; i++) pitches.push(+(ys[i - 1] - ys[i]).toFixed(1))
}
const pitchCount = pitches.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map())
const commonPitch = [...pitchCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
const textArea = (297 - 50) * MM
const kinsoku = bodyLines.filter((l) => NO_LINE_START.test(l.text))
const widths = bodyLines.map((l) => width(l.text))

console.log(
  JSON.stringify(
    {
      pageSizePt: pages.map((p) => `${p.w.toFixed(2)}x${p.h.toFixed(2)}`).filter((v, i, a) => a.indexOf(v) === i),
      pageSizeMm: pages.map((p) => `${(p.w / MM).toFixed(1)}x${(p.h / MM).toFixed(1)}`).filter((v, i, a) => a.indexOf(v) === i),
      pages: pages.length,
      fonts: [...fonts.values()].filter((v, i, a) => a.findIndex((x) => x.name === v.name) === i),
      linePitchPt: commonPitch,
      linesPerFullPage: commonPitch ? Math.floor(textArea / commonPitch + 0.01) : null,
      bodyLinesPerPage: pages.map((p) => p.lines.filter(isBodyLine).length),
      maxCharsPerLine: Math.max(...widths),
      charsPerLineHistogram: widths.reduce((m, v) => ({ ...m, [v]: (m[v] ?? 0) + 1 }), {}),
      kinsokuViolations: kinsoku.map((l) => l.text.slice(0, 10)),
      lineBreakMatch: { matched, expectedTotal, rate: +(matched / expectedTotal).toFixed(3), identicalParas, paragraphs: paragraphs.length },
      pageNumbers: pages.map((p) => p.lines.filter((l) => l.y < TEXT_BOTTOM_FROM_BOTTOM - 2).map((l) => l.text).join(' ')),
      diffs,
    },
    null,
    2,
  ),
)
