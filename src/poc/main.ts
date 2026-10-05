// PoC: 2025年度サンプルの本文を組版し、PDF として書き出せる状態にする。
// 書き出しと計測は scripts/poc/ のスクリプトが行う（window.__pocLayoutDone を待つ）。
import '@fontsource/biz-udmincho/400.css'
import '@fontsource/biz-udpgothic/400.css'
import { CoreViewer } from '@vivliostyle/core'
import { currentConfig } from '../config'
import { buildBodyDocument } from '../layout/bodyHtml'
import { buildReportDocument } from '../layout/document'
import { ReportRenderer } from '../editor/reportRenderer'
import { demoReport } from '../model/demoReport'
import type { Chapter } from '../model/types'
import { PLACEHOLDER_IMAGE, SAMPLE_FIGURE_SIZES, sampleChapters } from './sampleData'

declare global {
  interface Window {
    __pocLayoutDone?: boolean
    __pocError?: string
  }
}

// ?mode=grid … 全角文字だけのページで 38字×38行 を確かめる
// ?mode=kinsoku … 禁則処理を確かめる
// ?extraCss=… … 組版 CSS の比較実験用に CSS を追加する
const params = new URLSearchParams(location.search)

function gridTestChapters(): Chapter[] {
  const kana = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん'
  const text = Array.from({ length: 1600 }, (_, i) => kana[i % kana.length]).join('')
  return [{ id: 'g', title: '行数の確認', blocks: [{ type: 'paragraph', id: 'g1', content: [{ type: 'text', text }] }] }]
}

/** 小書き仮名と長音が行頭に来やすい文章（禁則処理の確認用）。scripts/poc/typst-data.mjs と同じ文 */
const KINSOKU_SENTENCES = [
  'ジャケットはセーラーカラーで、ショート丈のシルエットにした。',
  'シャツはフリルのチョーカーとリボンを合わせ、ボリュームを出した。',
  'ブーツにはゴールドのコードでショートチェーンのようなモチーフをつけた。',
]

function kinsokuTestChapters(): Chapter[] {
  const text = Array.from({ length: 40 }, (_, i) => KINSOKU_SENTENCES[i % 3]).join('')
  return [{ id: 'k', title: '禁則の確認', blocks: [{ type: 'paragraph', id: 'k1', content: [{ type: 'text', text }] }] }]
}

function buildHtml(): string {
  const mode = params.get('mode')
  const imageOptions = {
    imageSrc: () => PLACEHOLDER_IMAGE,
    photoSrc: () => PLACEHOLDER_IMAGE,
    figureSize: (f: { caption: string }) => SAMPLE_FIGURE_SIZES[f.caption] ?? { widthMm: 50, heightMm: 50 },
  }
  // ?mode=report … 報告書全体（表紙〜作品写真）を架空の見本で組む
  if (mode === 'report') return buildReportDocument(demoReport(), currentConfig, imageOptions)
  const chapters = mode === 'grid' ? gridTestChapters() : mode === 'kinsoku' ? kinsokuTestChapters() : sampleChapters()
  if (!chapters) throw new Error('src/poc/fixtures/*.private.json がありません（scripts/poc/build-fixture.mjs で作成）')
  return buildBodyDocument(chapters, imageOptions)
}

async function renderReport() {
  const renderer = new ReportRenderer(document.getElementById('vivliostyle-viewer-viewport')!)
  const { layout } = await renderer.renderBack(demoReport(), currentConfig, {
    imageSrc: () => PLACEHOLDER_IMAGE,
    photoSrc: () => PLACEHOLDER_IMAGE,
    figureSize: (f) => SAMPLE_FIGURE_SIZES[f.caption] ?? { widthMm: 50, heightMm: 50 },
  })
  renderer.swap(0)
  console.log('layout', layout)
  window.__pocLayoutDone = true
}

async function main() {
  if (params.get('mode') === 'report') return renderReport()
  let html = buildHtml()
  const extraCss = params.get('extraCss')
  if (extraCss) html = html.replace('</style>', `${extraCss}</style>`)

  // 文字の範囲ごとに分かれたフォントを、組版の前にすべて読み込んでおく（後から読み込まれると改行位置がずれる）
  const allText = html.replace(/<[^>]+>/g, '') + '0123456789'
  await document.fonts.load(`11pt "BIZ UDMincho"`, allText)
  await document.fonts.load(`11pt "BIZ UDPGothic"`, allText)

  const viewer = new CoreViewer(
    { viewportElement: document.getElementById('vivliostyle-viewer-viewport')!, window, debug: true },
    { renderAllPages: true, autoResize: false },
  )
  viewer.addListener('readystatechange', () => {
    if (viewer.readyState === 'complete') window.__pocLayoutDone = true
  })
  viewer.addListener('error', (payload) => {
    window.__pocError = String(payload.content?.error ?? payload.content?.messages)
  })
  viewer.loadDocument({ url: URL.createObjectURL(new Blob([html], { type: 'text/html' })) })
}

main().catch((e) => {
  window.__pocError = String(e)
  console.error(e)
})
