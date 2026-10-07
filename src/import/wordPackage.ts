import { strFromU8, unzipSync } from 'fflate'

/**
 * Word のファイル（.docx）を開く。.docx は zip で、中に本文（word/document.xml）・画像（word/media）などが入っている。
 * 読み取りは学生のブラウザの中だけで行う（どこにも送らない）。
 */

/** 学生に見せる言葉の例外（画面は message をそのまま出す） */
export class WordImportError extends Error {
  name = 'WordImportError'
}

export interface Relationship {
  type: string
  /** zip の中の場所（外部へのリンクなら、そのままの値） */
  target: string
  external: boolean
}

export interface WordPackage {
  fileName: string
  /** 本文（word/document.xml） */
  document: Document
  /** 本文の関係（画像の ID → 画像の場所） */
  rels: Map<string, Relationship>
  styles: Document | null
  numbering: Document | null
  /** zip の中のファイル（画像など）を取り出す。見つからない・読めないものは入らない */
  readFiles(paths: string[]): Map<string, Uint8Array>
}

const SAVE_AS_DOCX = 'Word で開いて「名前を付けて保存」で「Word 文書（*.docx）」にしてから選んでください。'

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((v, i) => bytes[i] === v)
}

/** zip でないファイルを見分けて、学生に分かる言葉で知らせる */
function notZipError(bytes: Uint8Array, label: string, fileName: string): WordImportError {
  const lower = fileName.toLowerCase()
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    // .docx にパスワードをかけると、この形になる
    if (lower.endsWith('.docx')) return new WordImportError(`${label}は、パスワードがかかっているか、古い形（.doc）のため読めません。Word で開き、パスワードがかかっていれば外して、「名前を付けて保存」で .docx にしてから選んでください。`)
    return new WordImportError(`${label}は Word 97-2003 の形（.doc）のため読めません。${SAVE_AS_DOCX}`)
  }
  const head = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart()
  if (head.startsWith('%PDF')) return new WordImportError(`${label}は PDF のため読めません。Word のファイル（.docx）を選んでください。`)
  if (head.startsWith('{\\rtf')) return new WordImportError(`${label}はリッチテキスト（.rtf）の形のため読めません。${SAVE_AS_DOCX}`)
  if (startsWith(bytes, [0xff, 0xd8]) || startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || lower.match(/\.(jpe?g|png|heic|gif)$/))
    return new WordImportError(`${label}は画像です。Word のファイル（.docx）を選んでください。`)
  return new WordImportError(`${label}は Word のファイル（.docx）ではないため読めません。04_本文.docx（表紙は 01_表紙.docx）を選んでください。`)
}

function brokenError(label: string): WordImportError {
  return new WordImportError(`${label}は、ファイルが壊れているため読めません。Word で開けるかを確かめ、開けたら「名前を付けて保存」で保存し直してから選んでください。`)
}

/** XML を読む。読めなければ null */
export function parseXml(text: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(text, 'application/xml')
    if (!doc?.documentElement || doc.getElementsByTagName('parsererror').length > 0) return null
    return doc
  } catch {
    return null
  }
}

/** zip の中の場所をつなげる（"word/" と "media/a.png" → "word/media/a.png"、"../x" も解く） */
export function joinPath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = base.split('/').filter(Boolean)
  for (const part of target.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '')
const relsPathOf = (path: string) => `${dirOf(path)}_rels/${path.slice(path.lastIndexOf('/') + 1)}.rels`

/** 関係（.rels）を読む */
function readRels(doc: Document | null, partPath: string): Map<string, Relationship> {
  const map = new Map<string, Relationship>()
  if (!doc) return map
  const list = doc.getElementsByTagName('Relationship')
  for (let i = 0; i < list.length; i++) {
    const el = list[i]
    const id = el.getAttribute('Id')
    const target = el.getAttribute('Target') ?? ''
    if (!id) continue
    const external = el.getAttribute('TargetMode') === 'External'
    map.set(id, { type: el.getAttribute('Type') ?? '', target: external ? target : joinPath(dirOf(partPath), decodeURIComponentSafe(target)), external })
  }
  return map
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/**
 * 学生が選んだファイルを Word のファイルとして開く。Word でないもの・古い形（.doc）・壊れたものは WordImportError。
 * role は学生に見せる言葉（「本文」「表紙」）
 */
export async function openWordFile(file: File, role: string): Promise<WordPackage> {
  const label = `${role}に選んだ「${file.name}」`
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.length === 0) throw new WordImportError(`${label}は空のファイルです。Word で開けるかを確かめてから選んでください。`)
  if (!startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) throw notZipError(bytes, label, file.name)

  // まず文字のファイル（XML）だけを取り出す。画像は、使うものだけを後で取り出す（大きい Word でも重くならないように）
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes, { filter: (f) => /\.(xml|rels)$/i.test(f.name) || f.name === 'mimetype' })
  } catch {
    throw brokenError(label)
  }
  // zip の中の名前は、大文字・小文字を区別せずに探す
  const names = new Map(Object.keys(entries).map((n) => [n.replace(/^\//, '').toLowerCase(), n]))
  const text = (path: string): string | null => {
    const name = names.get(path.toLowerCase())
    return name ? strFromU8(entries[name]) : null
  }
  const xml = (path: string): Document | null => {
    const t = text(path)
    return t === null ? null : parseXml(t)
  }

  const mimetype = text('mimetype')
  if (mimetype?.includes('opendocument'))
    throw new WordImportError(`${label}は OpenDocument（.odt）の形のため読めません。Word か Google ドキュメントで開き、Word の形（.docx）で保存し直してから選んでください。`)

  // 本文の場所は _rels/.rels に書いてある（ふつうは word/document.xml）
  const rootRels = readRels(xml('_rels/.rels'), '')
  const main = [...rootRels.values()].find((r) => r.type.endsWith('/officeDocument'))?.target ?? 'word/document.xml'
  const documentText = text(main)
  if (documentText === null) {
    if (text('[Content_Types].xml') === null) throw notZipError(new Uint8Array(), label, file.name)
    throw new WordImportError(`${label}は Word のファイル（.docx）ではないため読めません。04_本文.docx（表紙は 01_表紙.docx）を選んでください。`)
  }
  const document = parseXml(documentText)
  if (!document) throw brokenError(label)

  const rels = readRels(xml(relsPathOf(main)), main)
  const partOf = (suffix: string) => [...rels.values()].find((r) => r.type.endsWith(suffix) && !r.external)?.target
  const stylesPath = partOf('/styles')
  const numberingPath = partOf('/numbering')

  return {
    fileName: file.name,
    document,
    rels,
    styles: stylesPath ? xml(stylesPath) : null,
    numbering: numberingPath ? xml(numberingPath) : null,
    readFiles(paths: string[]) {
      const wanted = new Set(paths.map((p) => p.toLowerCase()))
      const result = new Map<string, Uint8Array>()
      if (wanted.size === 0) return result
      let files: Record<string, Uint8Array>
      try {
        files = unzipSync(bytes, { filter: (f) => wanted.has(f.name.replace(/^\//, '').toLowerCase()) })
      } catch {
        return result
      }
      for (const [name, data] of Object.entries(files)) {
        const path = paths.find((p) => p.toLowerCase() === name.replace(/^\//, '').toLowerCase())
        if (path) result.set(path, data)
      }
      return result
    },
  }
}
