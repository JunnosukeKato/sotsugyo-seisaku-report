import { putImage, saveReport } from '../model/storage'
import type { Report } from '../model/types'
import { loadManuscript, makePdf, type SourceKind } from './makePdf'
import type { PagesToPdfOptions } from './pagesToPdf'
import { demoSample, longSample } from './samples'

/**
 * 開発中だけ使う、自動の確かめ（poc-output/pdf-poc のスクリプト）のための入り口（window.__pdfTest）。
 * - saveSample：見本の原稿を、この端末の原稿として保存する（学生用ツールで同じ原稿を開いて、印刷の PDF と比べるため）。
 *   今の原稿を上書きするので、まっさらなブラウザでだけ使う
 * - run：原稿を組版して PDF を作り、結果と PDF（base64）を返す
 */

const toBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

export function install(): void {
  Object.assign(window, {
    __pdfTest: {
      async saveSample(kind: 'demo' | 'long', change?: (r: Report) => Report) {
        const sample = kind === 'long' ? await longSample() : await demoSample()
        for (const img of sample.images) await putImage(img)
        await saveReport(change ? change(sample.report) : sample.report)
      },
      async run(kind: SourceKind, options: Omit<PagesToPdfOptions, 'title' | 'onPage'> = {}) {
        const paper = document.querySelector<HTMLElement>('.pt-paper')!
        const result = await makePdf(paper, await loadManuscript(kind), options)
        const { blob, ...rest } = result
        return { ...rest, size: blob.size, base64: await toBase64(blob) }
      },
    },
  })
}
