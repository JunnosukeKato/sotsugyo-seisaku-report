import { PDFDocument, rgb } from 'pdf-lib'
import { A4, photoPages, photoPlaces } from './pageFit'

/**
 * 提出前チェック：表紙 → 抄録 → 目次 → 本文 → 作品写真 を、1つの PDF にまとめる（pdf-lib）。
 * PDF のページは、そのまま写す（文字は文字のまま。画像にしない）。作品写真の写真は、入れた順に4枚ずつ A4 のページに分け（pageFit.ts の photoPages。mockups/v38 案1）、
 * 枚数で決まる並べ方で、切らずに全体が入る大きさで置く（pageFit.ts の photoPlaces）。透かしは入れない（決まったこと：エラーが残っていても、そのまままとめる）
 */

/** まとめるもの（まとめる順に並べて渡す） */
export type MergeItem =
  | { type: 'pdf'; bytes: Uint8Array }
  /** 作品写真のページ（写真は JPEG か PNG。width・height は点の数。並べた順。4枚ずつのページになる） */
  | { type: 'photos'; photos: { bytes: Uint8Array; format: 'jpg' | 'png'; width: number; height: number }[] }

/**
 * まとめられない PDF なら、その理由（学生に分かる言葉で）。まとめられれば null。
 * パスワードで開けない PDF は pdf.js で読むときに分かるが、編集を止めるパスワードだけが付いた PDF は、ここで分かる
 */
export async function mergeProblem(bytes: Uint8Array): Promise<string | null> {
  try {
    await PDFDocument.load(bytes, { updateMetadata: false })
    return null
  } catch (e) {
    // pdf-lib の EncryptedPDFError は instanceof で見分けられない（古い形の JavaScript にしてあるため）ので、知らせの言葉で見分ける
    if (e instanceof Error && /encrypted/i.test(e.message)) return 'パスワード（保護）が付いているため、まとめられません。Word から、パスワードを付けずに PDF に保存し直してください。'
    return 'ファイルが壊れているため、まとめられません。Word から PDF に保存し直してください。'
  }
}

/** まとめる。title：PDF の題（ファイル名から .pdf を除いたもの） */
export async function mergeParts(items: MergeItem[], title: string): Promise<{ bytes: Uint8Array; pageCount: number }> {
  const out = await PDFDocument.create()
  for (const item of items) {
    if (item.type === 'pdf') {
      const src = await PDFDocument.load(item.bytes, { updateMetadata: false })
      const pages = await out.copyPages(src, src.getPageIndices())
      for (const page of pages) out.addPage(page)
    } else {
      for (const photos of photoPages(item.photos)) {
        const page = out.addPage([A4.width, A4.height])
        page.drawRectangle({ x: 0, y: 0, width: A4.width, height: A4.height, color: rgb(1, 1, 1) })
        const places = photoPlaces(photos)
        for (const [i, photo] of photos.entries()) page.drawImage(photo.format === 'jpg' ? await out.embedJpg(photo.bytes) : await out.embedPng(photo.bytes), places[i])
      }
    }
  }
  out.setTitle(title)
  out.setCreator('卒業制作報告書 提出前チェック')
  out.setProducer('卒業制作報告書 提出前チェック')
  const bytes = await out.save()
  return { bytes, pageCount: out.getPageCount() }
}
