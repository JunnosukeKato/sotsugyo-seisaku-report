/**
 * 紙面の画像に埋め込む書体（@font-face）を用意する。
 *
 * 紙面を画像にするときは、紙面の複製を SVG の中に入れて描く。SVG の中では、ページの書体の設定が使えないため、
 * 書体のファイルを SVG に埋め込む必要がある。BIZ UD明朝・BIZ UDPゴシック（@fontsource）は、文字の範囲（unicode-range）
 * ごとに 100 以上のファイルに分かれているので、そのページで使っている文字を含むファイルだけを選んで埋め込む
 * （すべて埋め込むと、1ページごとに数 MB になり、遅くなる）。
 *
 * 組版エンジン（Vivliostyle）も、句読点のぶら下げ・詰めのために、自分の小さな書体（「-viv-ts-sp」。空白の幅だけを持つ）を
 * 使っている。この書体は、紙面の文字ではなく ::after の空白で使うため、使っている文字からは見つけられない。いつも埋め込む
 * （埋め込まないと、句読点のぶら下げが効かず、行の折り返しが印刷とずれる）。
 */

/** 組版エンジンが自分で使う書体の名前のはじまり（いつも埋め込む） */
const ENGINE_FONT_PREFIX = '-viv-'

/** 書体の1ファイル（@font-face の1つ） */
export interface FontFile {
  family: string
  weight: string
  style: string
  /** 含む文字の範囲（コードポイントの [はじめ, おわり]） */
  ranges: [number, number][]
  /** unicode-range の元の文字列（埋め込む CSS にそのまま書く。なければ空） */
  rangeText: string
  url: string
  format: string
}

/** unicode-range（「U+3000-303F, U+4E00, U+4??」など）を、コードポイントの範囲にする。空なら、すべての文字 */
export function parseUnicodeRange(text: string): [number, number][] {
  const parts = text
    .split(',')
    .map((s) => s.trim().replace(/^U\+/i, ''))
    .filter(Boolean)
  if (!parts.length) return [[0, 0x10ffff]]
  return parts.map((part): [number, number] => {
    if (part.includes('?')) return [parseInt(part.replace(/\?/g, '0'), 16), parseInt(part.replace(/\?/g, 'F'), 16)]
    const [a, b] = part.split('-')
    return [parseInt(a, 16), parseInt(b ?? a, 16)]
  })
}

/** 文字の集まりのうち、どれか1字でも範囲に入っているか */
export function coversAny(ranges: [number, number][], codePoints: Iterable<number>): boolean {
  for (const cp of codePoints) {
    if (ranges.some(([a, b]) => cp >= a && cp <= b)) return true
  }
  return false
}

const unquote = (s: string) => s.trim().replace(/^['"]|['"]$/g, '')

/** font-family の値（「'BIZ UDMincho', serif」など）を、書体名の並びにする */
export function familyList(value: string): string[] {
  return value.split(',').map(unquote).filter(Boolean)
}

/** src の値から、使うファイルの URL と形式を選ぶ（woff2 を優先） */
export function pickSource(src: string): { url: string; format: string } | null {
  const found = [...src.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)\s*(?:format\(\s*(['"]?)(.*?)\3\s*\))?/g)].map((m) => ({ url: m[2], format: m[4] ?? '' }))
  return found.find((f) => f.format === 'woff2') ?? found[0] ?? null
}

function* fontFaceRules(rules: CSSRuleList): Generator<{ rule: CSSFontFaceRule; base: string }> {
  for (const rule of rules) {
    if (rule instanceof CSSFontFaceRule) {
      yield { rule, base: rule.parentStyleSheet?.href ?? document.baseURI }
    } else if (rule instanceof CSSImportRule) {
      const sheet = rule.styleSheet
      if (sheet) {
        try {
          yield* fontFaceRules(sheet.cssRules)
        } catch {
          // 読めない（別のサイトの）CSS は飛ばす
        }
      }
    } else if ('cssRules' in rule) {
      // @media・@supports・@layer の中
      yield* fontFaceRules((rule as CSSGroupingRule).cssRules)
    }
  }
}

/** このページで読み込んでいる書体のファイルの一覧 */
export function documentFontFiles(): FontFile[] {
  const files: FontFile[] = []
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (const { rule, base } of fontFaceRules(rules)) {
      const style = rule.style
      const source = pickSource(style.getPropertyValue('src'))
      const family = unquote(style.getPropertyValue('font-family'))
      if (!source || !family) continue
      const rangeText = style.getPropertyValue('unicode-range').trim()
      files.push({
        family,
        weight: style.getPropertyValue('font-weight').trim() || '400',
        style: style.getPropertyValue('font-style').trim() || 'normal',
        ranges: parseUnicodeRange(rangeText),
        rangeText,
        url: source.url.startsWith('data:') ? source.url : new URL(source.url, base).href,
        format: source.format,
      })
    }
  }
  return files
}

/** 書体の名前と太さごとの、使っている文字 */
export type UsedText = Map<string, { family: string; weight: string; codePoints: Set<number> }>

const normalWeight = (w: string) => (w === 'normal' ? '400' : w === 'bold' ? '700' : w)

/** 要素の中の文字を、書体（font-family の並び）と太さごとに集める。要素は文書の中に置いておくこと（書体を読み取るため） */
export function collectUsedText(root: Element, used: UsedText = new Map()): UsedText {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const styleOf = new Map<Element, CSSStyleDeclaration>()
  while (walker.nextNode()) {
    const text = walker.currentNode.nodeValue ?? ''
    const parent = walker.currentNode.parentElement
    if (!parent || !text.trim()) continue
    let style = styleOf.get(parent)
    if (!style) {
      style = getComputedStyle(parent)
      styleOf.set(parent, style)
    }
    const weight = normalWeight(style.fontWeight)
    // 並びのどの書体で描かれるかは文字によるので、並びの書体すべてに数える
    for (const family of familyList(style.fontFamily)) {
      const key = `${family.toLowerCase()}|${weight}`
      let entry = used.get(key)
      if (!entry) used.set(key, (entry = { family, weight, codePoints: new Set() }))
      for (const ch of text) entry.codePoints.add(ch.codePointAt(0)!)
    }
  }
  return used
}

/** 使っている文字を含むファイルを選ぶ。同じ太さのファイルがなければ、その書体のほかの太さのファイルを使う（ブラウザが太字を作る） */
export function pickFontFiles(files: FontFile[], used: UsedText): FontFile[] {
  const picked = new Set<FontFile>(files.filter((f) => f.family.startsWith(ENGINE_FONT_PREFIX)))
  for (const { family, weight, codePoints } of used.values()) {
    const sameFamily = files.filter((f) => f.family.toLowerCase() === family.toLowerCase() && f.style === 'normal')
    if (!sameFamily.length) continue
    const sameWeight = sameFamily.filter((f) => normalWeight(f.weight) === weight)
    for (const f of sameWeight.length ? sameWeight : sameFamily) {
      if (coversAny(f.ranges, codePoints)) picked.add(f)
    }
  }
  return [...picked]
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** 書体のファイルを読み込み、data: URL にしたもの（1回の書き出しの間、同じファイルは読み込み直さない） */
export class FontCache {
  private readonly dataUrls = new Map<string, Promise<string>>()

  private dataUrl(url: string): Promise<string> {
    if (url.startsWith('data:')) return Promise.resolve(url)
    let p = this.dataUrls.get(url)
    if (!p) {
      p = fetch(url, { cache: 'force-cache' })
        .then((r) => {
          if (!r.ok) throw new Error(`書体のファイルを読み込めませんでした（${r.status}）`)
          return r.blob()
        })
        .then(blobToDataUrl)
      this.dataUrls.set(url, p)
    }
    return p
  }

  /** 選んだファイルを埋め込んだ @font-face の CSS */
  async css(files: FontFile[]): Promise<string> {
    const rules = await Promise.all(
      files.map(async (f) => {
        const data = await this.dataUrl(f.url)
        const format = f.format ? ` format("${f.format}")` : ''
        const range = f.rangeText ? `unicode-range:${f.rangeText};` : ''
        return `@font-face{font-family:"${f.family}";font-style:${f.style};font-weight:${f.weight};font-display:block;src:url(${data})${format};${range}}`
      }),
    )
    return rules.join('\n')
  }
}
