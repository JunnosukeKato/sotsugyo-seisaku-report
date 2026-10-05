// PoC 用: 2025年度サンプル本文（pdftotext -layout の出力）から、比較用の正解（行ごとの文字列）付きの本文データを作る。
// 使い方: node scripts/poc/build-fixture.mjs <layout.txt> <out.json>
// サンプルは他人の作品なので、出力は *.private.json として Git の管理対象外にする。
import { readFileSync, writeFileSync } from 'node:fs'

const [input, output] = process.argv.slice(2)
const raw = readFileSync(input, 'utf8').replace(/\r/g, '')

const CJK = '[\\u3000-\\u30ff\\u3400-\\u9fff\\uff00-\\uffef]'
// Word の和欧間の自動スペースが抽出時に半角スペースとして入るので取り除く
const unspace = (s) =>
  s
    .replace(new RegExp(`(${CJK}|[（(])\\s+(?=[0-9A-Za-z])`, 'g'), '$1')
    .replace(new RegExp(`([0-9A-Za-z])\\s+(?=${CJK}|[)）])`, 'g'), '$1')
    .trim()

const CHAPTER = /^[ⅠⅡⅢⅣⅤ]．/
const SUB = /^[ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ]．/
const CAPTION = /図\s*\d+\s+\S+/g

const lines = raw.split('\n')
const chapters = []
let chapter = null
let para = null
let inTable = false

const closePara = () => {
  if (para) chapter.blocks.push(para)
  para = null
}

for (const rawLine of lines) {
  if (rawLine.includes('\f')) inTable = false
  const line = rawLine.replace(/\f/g, '')
  const trimmed = line.trim()
  if (!trimmed || trimmed === 'SAMPLE' || /^\d+$/.test(trimmed)) continue

  const head = trimmed.replace(/\s+SAMPLE$/, '').replace(/\s{2,}.*$/, '')
  if (CHAPTER.test(head)) {
    closePara()
    chapter = { id: `c${chapters.length + 1}`, title: head.slice(2), blocks: [] }
    chapters.push(chapter)
    continue
  }
  if (SUB.test(head)) {
    closePara()
    chapter.blocks.push({ type: 'subheading', id: `s${chapter.blocks.length}`, title: head.slice(2) })
    if (head.includes('使用素材')) inTable = true
    continue
  }
  if (inTable) {
    // 表のページは本文データでは手で組み立てる（下の materialTable）
    if (trimmed.startsWith('表') && trimmed.includes('まとめる')) {
      chapter.blocks.push({ type: 'paragraph', id: 'p-table-intro', content: [{ type: 'text', text: unspace(trimmed) }], expectedLines: [unspace(trimmed)] })
    }
    continue
  }
  const captions = trimmed.match(CAPTION)
  if (captions && trimmed.replace(CAPTION, '').trim() === '') {
    closePara()
    chapter.blocks.push({
      type: 'figureRow',
      id: `f${chapter.blocks.length}`,
      figures: captions.map((c) => {
        const m = c.match(/図\s*(\d+)\s+(\S+)/)
        return { id: `fig${m[1]}-${m[2]}`, imageId: '', caption: m[2], sampleNumber: Number(m[1]) }
      }),
    })
    continue
  }
  const indented = /^ {2,}\S/.test(line) || /^　/.test(line)
  if (!para || indented) {
    closePara()
    para = { type: 'paragraph', id: `p${chapters.length}-${chapter.blocks.length}`, content: [{ type: 'text', text: '' }], expectedLines: [] }
  }
  const text = unspace(trimmed)
  para.expectedLines.push(text)
  para.content[0].text += text
}
closePara()

writeFileSync(output, JSON.stringify({ source: '2025年度サンプル本文', chapters }, null, 2))
const paragraphs = chapters.flatMap((c) => c.blocks).filter((b) => b.type === 'paragraph')
console.log(`chapters=${chapters.length} paragraphs=${paragraphs.length} lines=${paragraphs.reduce((n, p) => n + p.expectedLines.length, 0)}`)
