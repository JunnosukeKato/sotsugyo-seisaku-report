import { collectUsedText, documentFontFiles, FontCache, pickFontFiles } from './fontCss'

/**
 * 組版した紙面の各ページを画像にして、A4 の PDF（Blob）にまとめる。
 * 印刷の画面（「PDF に保存」）を通さずに、ツールの手元で PDF を作るためのもの（学生が書き出した PDF の控えを先生のドライブに送るのに使う）。
 * 文字は画像になるので、PDF の中の文字は選べない（先生が読めればよい控え用）。
 *
 * 印刷と同じ中身にする（index.css の @media print と同じこと）：
 * - 紙面のページを複製し、画面の CSS が効かない場所に原寸で置いて撮る。入力欄の仮の文字・選んだ印・指摘の下線・ページの影などは、
 *   画面の CSS（.page-viewport の中だけに効く）か紙面の外の部品なので、複製には出ない。画面では紙面を縮小して表示しているが、複製は縮小しない
 * - 抄録を書き始める前の抄録のページ（.print-skip）は入れない。抄録の欄の案内とボタン（.abstract-lock）は消す
 * - 下書きなら、どのページにも「下書き」の透かしを入れる（印刷の透かしと同じ見た目）
 *
 * 画像にする部品は modern-screenshot：複製を SVG に入れて、ブラウザ自身に描かせる（字の位置・字間・行が印刷とそろう）。
 * 試作では html-to-image（字間が崩れて行の折り返しがずれた）・html2canvas（字が少し下にずれ、作品写真の切り抜きが効かず、遅い）とも比べた。
 * PDF にまとめる部品は jsPDF。どちらも、使うときに読み込む（ふだんのツールの読み込みを重くしない）。
 * iPhone の Safari でメモリが足りなくならないよう、1ページずつ画像にして JPEG にし、画像の作業領域はすぐ解放する。
 */

export interface PagesToPdfOptions {
  /** 下書き：どのページにも「下書き」の透かしを入れる */
  draft?: boolean
  /** 画像の細かさ（1インチあたりの点の数）。150 で A4 が 1240×1754 点 */
  dpi?: number
  /** JPEG の画質（0〜1） */
  quality?: number
  /** PDF の題（ファイルの情報に入る） */
  title?: string
  /** 1ページ画像にするたびに呼ぶ（進み具合の表示や、縮小画像を作るのに使う。canvas は、この後すぐ解放する） */
  onPage?: (page: CapturedPage) => void | Promise<void>
}

export interface CapturedPage {
  /** 何ページ目か（0 から。PDF に入れるページだけで数える） */
  index: number
  total: number
  canvas: HTMLCanvasElement
  /** JPEG の大きさ（バイト） */
  bytes: number
  /** このページにかかった時間（ミリ秒） */
  ms: number
}

/** 画像にする時間の内訳（ミリ秒。全ページの合計）：複製を置く・書体を用意する・SVG にする・描く・JPEG にする */
export interface Steps {
  clone: number
  fonts: number
  svg: number
  draw: number
  jpeg: number
}

export interface PagesToPdfResult {
  blob: Blob
  pageCount: number
  /** 1ページの画像の大きさ（点） */
  widthPx: number
  heightPx: number
  /** かかった時間（ミリ秒）：部品の読み込み・画像にする・PDF にまとめる・合計 */
  ms: { load: number; capture: number; assemble: number; total: number }
  steps: Steps
  /** 各ページの JPEG の大きさ（バイト） */
  pageBytes: number[]
}

/** 画像の細かさと JPEG の画質（試作で、読みやすさと大きさの釣り合いから決めた） */
export const DEFAULT_DPI = 150
export const DEFAULT_QUALITY = 0.8

/** CSS の 1px ＝ 1/96 インチ */
const CSS_DPI = 96
/** A4 の大きさ（PDF の単位 pt ＝ 1/72 インチ） */
const A4_PT = { width: (210 / 25.4) * 72, height: (297 / 25.4) * 72 }

/** 画面でページに付けるクラス（ページ送りの動き・表示中・選んだ印・指摘の印・PDF に入れない印） */
const SCREEN_CLASSES = ['is-current', 'is-under', 'is-under-current', 'turn-out', 'turn-in', 'fade-out', 'fade-in', 'print-skip', 'is-selected', 'has-issue']

/**
 * 組版エンジンが紙面の外側の要素に置く CSS の変数（--viv-layoutUnitAdj など）。紙面の文字の大きさなどは
 * 「calc(48pt - var(--viv-layoutUnitAdj))」のように、この変数を使って書かれているので、複製にも写す（写さないと文字の大きさが崩れる）
 */
const KNOWN_VARIABLES = ['--viv-layoutUnitAdj', '--viv-outputScale']

/**
 * Safari・Firefox は、SVG の中の画像や書体を読み込み終える前に描いてしまうことがある。
 * 描き直して、絵が変わらなくなるまで待つ（最大の回数と、待つ時間）
 */
const REDRAW_MAX = 5
const REDRAW_WAIT_MS = 120
const needsRedraw = () => (navigator.vendor ?? '').startsWith('Apple') || /Firefox\//.test(navigator.userAgent)

const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 「下書き」の透かし（index.css の印刷のときの .print-draft と同じ見た目） */
function watermark(): HTMLElement {
  const el = document.createElement('div')
  el.textContent = '下書き'
  el.style.cssText = [
    'position:absolute',
    'left:50%',
    'top:50%',
    'transform:translate(-50%,-50%) rotate(-32deg)',
    "font-family:'BIZ UDPGothic',sans-serif",
    'font-weight:700',
    'font-size:96pt',
    'line-height:normal',
    'letter-spacing:0.3em',
    'color:rgba(181,68,59,0.14)',
    'white-space:nowrap',
    'pointer-events:none',
    'z-index:10',
  ].join(';')
  return el
}

/**
 * 複製を置く場所。まわりの CSS を受け継がない（all: initial）。画面の左上に、見えないように（透明・いちばん奥）置く
 * （撮るときは複製の見た目だけを写すので、置き場所の透明は写らない）
 */
function makeHost(): HTMLElement {
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'all:initial;display:block;position:fixed;left:0;top:0;z-index:-1;opacity:0;pointer-events:none'
  document.body.append(host)
  return host
}

function engineVariables(page: HTMLElement): [string, string][] {
  const style = getComputedStyle(page)
  const names = new Set(KNOWN_VARIABLES)
  for (let i = 0; i < style.length; i++) if (style[i].startsWith('--viv')) names.add(style[i])
  return [...names].map((name): [string, string] => [name, style.getPropertyValue(name).trim()]).filter(([, value]) => value)
}

/** ページを複製し、印刷と同じ中身にする（画面だけの印を外し、原寸・白地にする）。variables：組版エンジンの CSS の変数 */
function printableClone(page: HTMLElement, variables: [string, string][], draft: boolean): HTMLElement {
  const clone = page.cloneNode(true) as HTMLElement
  for (const [name, value] of variables) clone.style.setProperty(name, value)
  for (const el of [clone, ...clone.querySelectorAll<HTMLElement>(SCREEN_CLASSES.map((c) => `.${c}`).join(','))]) el.classList.remove(...SCREEN_CLASSES)
  for (const el of clone.querySelectorAll('.abstract-lock')) el.remove()
  const fixed: Record<string, string> = {
    position: 'relative',
    left: '0',
    top: '0',
    margin: '0',
    transform: 'none',
    display: 'block',
    animation: 'none',
    'box-shadow': 'none',
    opacity: '1',
    'background-color': '#fff',
    overflow: 'hidden',
  }
  for (const [name, value] of Object.entries(fixed)) clone.style.setProperty(name, value, 'important')
  clone.setAttribute('lang', 'ja')
  if (draft) clone.append(watermark())
  return clone
}

async function imagesReady(root: HTMLElement): Promise<void> {
  await Promise.all([...root.querySelectorAll('img')].map((img) => img.decode().catch(() => {})))
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('紙面を画像にできませんでした（SVG を読み込めません）'))
    img.src = url
  })
}

/** 絵の大まかな特徴（描き直して変わったかを調べるため。小さく縮めて画素を足し合わせる） */
function fingerprint(canvas: HTMLCanvasElement): string {
  const small = document.createElement('canvas')
  small.width = 48
  small.height = 68
  const ctx = small.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(canvas, 0, 0, small.width, small.height)
  const data = ctx.getImageData(0, 0, small.width, small.height).data
  let hash = 0
  for (let i = 0; i < data.length; i++) hash = (hash * 31 + data[i]) | 0
  small.width = small.height = 0
  return String(hash)
}

/** SVG（data: URL）を、白地の canvas に描く */
async function drawSvg(url: string, width: number, height: number, scale: number): Promise<HTMLCanvasElement> {
  const img = await loadImage(url)
  await img.decode().catch(() => {})
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  const ctx = canvas.getContext('2d')!
  const draw = () => {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  }
  draw()
  if (needsRedraw()) {
    let before = fingerprint(canvas)
    for (let i = 0; i < REDRAW_MAX; i++) {
      await sleep(REDRAW_WAIT_MS)
      draw()
      const after = fingerprint(canvas)
      if (after === before) break
      before = after
    }
  }
  img.src = ''
  return canvas
}

type ShotContext = Awaited<ReturnType<(typeof import('modern-screenshot'))['createContext']>>

/**
 * ページの複製を、SVG を通して canvas に描く。steps に、SVG にする時間と描く時間を足す。
 * modern-screenshot の作業の入れ物（shared.context）は、ページごとに作り直すと、毎回、要素の標準の見た目を調べ直す（隠した iframe を作る）ので、
 * 1回の書き出しの間は使い回し、ページごとに中身（撮る要素・書体・SVG の CSS）だけを入れ替える（長い原稿で 2 割ほど速くなる）
 */
async function rasterize(node: HTMLElement, width: number, height: number, scale: number, fontCss: string, steps: Steps, shared: { context: ShotContext | null }): Promise<HTMLCanvasElement> {
  const started = performance.now()
  const { createContext, domToForeignObjectSvg } = await import('modern-screenshot')
  let context = shared.context
  if (!context) {
    context = shared.context = await createContext(node, { width, height, backgroundColor: '#ffffff', font: { cssText: fontCss } })
  } else {
    context.node = node
    context.font = { cssText: fontCss }
    context.svgStyleElement = document.createElement('style')
    context.svgDefsElement = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
    context.svgStyles.clear()
    context.fontFamilies.clear()
    // 前のページの写真（data: URL）を持ち続けないよう、読み込んだものは忘れる
    context.requests.clear()
  }
  const svg = await domToForeignObjectSvg(context)
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`
  const drawStarted = performance.now()
  steps.svg += drawStarted - started
  const canvas = await drawSvg(url, width, height, scale)
  steps.draw += performance.now() - drawStarted
  return canvas
}

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像を JPEG にできませんでした'))), 'image/jpeg', quality))
}

/**
 * JPEG を A4 のページに1枚ずつ敷いて、PDF にまとめる（jsPDF。JPEG は作り直さずに、そのまま PDF に入れる）。
 * 試作では pdf-lib とも比べた（時間はどちらも 0.1 秒ほど。jsPDF のほうが読み込む量が少なく（圧縮して約130KB・pdf-lib は約210KB）、今も手入れされている）
 */
async function assemble(jpegs: Blob[], title: string): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  doc.setProperties({ title, creator: '卒業制作報告書ツール' })
  for (const [i, jpeg] of jpegs.entries()) {
    if (i > 0) doc.addPage('a4')
    doc.addImage(new Uint8Array(await jpeg.arrayBuffer()), 'JPEG', 0, 0, A4_PT.width, A4_PT.height, undefined, 'NONE')
  }
  return doc.output('blob')
}

/**
 * 紙面のページ（組版エンジンのページの要素。PageView.pages()）を画像にして、A4 の PDF にする。
 * .print-skip の付いたページは入れない。ページは文書の中に置いたまま渡すこと（表示していなくてもよい）
 */
export async function pagesToPdf(pages: HTMLElement[], options: PagesToPdfOptions = {}): Promise<PagesToPdfResult> {
  const { draft = false, dpi = DEFAULT_DPI, quality = DEFAULT_QUALITY, title = '', onPage } = options
  const started = performance.now()
  // 部品を先に読み込んでおく（読み込みの時間を、画像にする時間と分けて測る）
  await Promise.all([import('modern-screenshot'), import('jspdf')])
  // 透かしの太字は、紙面では使っていないので、読み込んでおく
  if (draft) await document.fonts.load(`700 96pt "BIZ UDPGothic"`, '下書き').catch(() => [])
  const loaded = performance.now()

  const printed = pages.filter((p) => !p.classList.contains('print-skip'))
  // 組版エンジンの CSS の変数は、はじめに読んでおく（書き出しの途中で紙面が組み直されて、ページが文書から外れても困らないように）
  const variables = printed.length ? engineVariables(printed[0]) : []
  const scale = dpi / CSS_DPI
  const fontFiles = documentFontFiles()
  const fonts = new FontCache()
  const host = makeHost()
  const shared: { context: ShotContext | null } = { context: null }
  const steps: Steps = { clone: 0, fonts: 0, svg: 0, draw: 0, jpeg: 0 }
  const jpegs: Blob[] = []
  let widthPx = 0
  let heightPx = 0
  try {
    for (const [index, page] of printed.entries()) {
      const pageStarted = performance.now()
      const clone = printableClone(page, variables, draft)
      host.replaceChildren(clone)
      const { width, height } = clone.getBoundingClientRect()
      await imagesReady(clone)
      const fontsStarted = performance.now()
      steps.clone += fontsStarted - pageStarted
      const fontCss = await fonts.css(pickFontFiles(fontFiles, collectUsedText(clone)))
      steps.fonts += performance.now() - fontsStarted
      const canvas = await rasterize(clone, width, height, scale, fontCss, steps, shared)
      widthPx = canvas.width
      heightPx = canvas.height
      const jpegStarted = performance.now()
      const jpeg = await toJpeg(canvas, quality)
      steps.jpeg += performance.now() - jpegStarted
      jpegs.push(jpeg)
      await onPage?.({ index, total: printed.length, canvas, bytes: jpeg.size, ms: performance.now() - pageStarted })
      // 画像の作業領域を解放する（iPhone の Safari は、canvas のメモリの上限が小さい）
      canvas.width = canvas.height = 0
      host.replaceChildren()
      // 画面が固まらないよう、ページごとに一息つく
      await nextFrame()
    }
  } finally {
    host.remove()
    if (shared.context) (await import('modern-screenshot')).destroyContext(shared.context)
  }
  const captured = performance.now()
  const blob = await assemble(jpegs, title)
  const finished = performance.now()
  return {
    blob,
    pageCount: jpegs.length,
    widthPx,
    heightPx,
    ms: { load: loaded - started, capture: captured - loaded, assemble: finished - captured, total: finished - started },
    steps,
    pageBytes: jpegs.map((j) => j.size),
  }
}
