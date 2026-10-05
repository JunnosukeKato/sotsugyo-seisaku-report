// PoC: 書き出した PDF を pdf.js で描画して目で確かめる。
//   ?file=poc-output/body.pdf&scale=1
//   ?file=a.pdf&compare=b.pdf … 2つの PDF をページごとに左右に並べる
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const params = new URLSearchParams(location.search)
const files = [params.get('file') ?? 'poc-output/body.pdf', params.get('compare')].filter((f): f is string => !!f)
const labels = (params.get('labels') ?? '').split(',')
const scale = Number(params.get('scale') ?? '1')

const docs = await Promise.all(files.map((f) => pdfjs.getDocument({ url: `/${f}` }).promise))
const pageCount = Math.max(...docs.map((d) => d.numPages))
for (let n = 1; n <= pageCount; n++) {
  const row = document.createElement('div')
  row.className = 'row'
  document.body.append(row)
  for (const [i, doc] of docs.entries()) {
    const cell = document.createElement('div')
    cell.className = 'cell'
    cell.textContent = `${labels[i] ?? files[i]}  p.${n}`
    row.append(cell)
    if (n > doc.numPages) continue
    const page = await doc.getPage(n)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    cell.append(canvas)
    // intent: 'print' は描画に requestAnimationFrame を使わないため、画面が隠れていても止まらない
    await page.render({ canvas, viewport, intent: 'print' }).promise
  }
}
document.body.dataset.rendered = 'true'
