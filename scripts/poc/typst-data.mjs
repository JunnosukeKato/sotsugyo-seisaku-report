// PoC: Typst 版の比較用に、本文データを Typst テンプレートが読む JSON に変換する。
// 使い方: node scripts/poc/typst-data.mjs <sample|grid|kinsoku> <out.json>
import { readFileSync, writeFileSync } from 'node:fs'

const [mode = 'sample', out = 'poc-output/typst/data.json'] = process.argv.slice(2)

// src/poc/main.ts と同じ値
const SIZES = {
  デザイン画: [57, 84], ジャケット前: [40, 56], ジャケット後ろ: [40, 55], シャツ: [38, 48], アスコットタイ: [54, 47],
  パンツ: [56, 41], ベスト: [47, 52], 帽子: [64, 41], 靴: [62, 61], 仮面: [65, 42], 葬式用コート: [47, 60], 葬式用帽子: [60, 56],
}
const TABLE_ROWS = [
  ['ポリエステル\nジャガード', 'ジャケット身頃\n衿'], ['プレミアムフラノ', '帽子\n袖'], ['T/Cブロード', 'シャツ'],
  ['ウォッシャブル\nアムンゼン', 'パンツ'], ['プレミアムフラノ', 'ベスト'], ['シルク羽二重', 'フリル'],
]
const KINSOKU_SENTENCES = [
  'ジャケットはセーラーカラーで、ショート丈のシルエットにした。',
  'シャツはフリルのチョーカーとリボンを合わせ、ボリュームを出した。',
  'ブーツにはゴールドのコードでショートチェーンのようなモチーフをつけた。',
]

let chapters
if (mode === 'grid') {
  const kana = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん'
  chapters = [{ title: '行数の確認', blocks: [{ type: 'paragraph', text: Array.from({ length: 1600 }, (_, i) => kana[i % kana.length]).join('') }] }]
} else if (mode === 'kinsoku') {
  chapters = [{ title: '禁則の確認', blocks: [{ type: 'paragraph', text: Array.from({ length: 40 }, (_, i) => KINSOKU_SENTENCES[i % 3]).join('') }] }]
} else {
  const fixture = JSON.parse(readFileSync('src/poc/fixtures/sample2025.private.json', 'utf8'))
  let fig = 0
  chapters = fixture.chapters.map((c) => ({
    title: c.title,
    blocks: c.blocks.flatMap((b) => {
      if (b.type === 'subheading') return [{ type: 'subheading', title: b.title }]
      if (b.type === 'paragraph') {
        const p = { type: 'paragraph', text: b.content[0].text }
        return b.id === 'p-table-intro' ? [p, { type: 'table', number: 1, caption: '使用素材表', rows: TABLE_ROWS }] : [p]
      }
      return [{ type: 'figures', figures: b.figures.map((f) => ({ number: ++fig, caption: f.caption, size: SIZES[f.caption] ?? [50, 50] })) }]
    }),
  }))
}
writeFileSync(out, JSON.stringify({ chapters }))
