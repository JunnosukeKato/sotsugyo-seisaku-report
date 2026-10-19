import { compact, type PdfFacts } from './pdfFacts'
import type { CheckFinding, PartId } from './parts'

/**
 * 指摘 → ページ（できるときだけ）。Word の指摘の文字（前後を少し含めたもの）を、そのパートの PDF のページの文字から探す。
 * 見つかれば「本文 3ページ目」、見つからなければパートだけ（「本文」）。
 * 短い文字は、ほかの所にもあることが多いので、1つのページにしかないときだけ使う
 */

/** 長さ8字より短い文字は、1つのページにしかないときだけ、場所に使う */
const SURE_LENGTH = 8
const MIN_LENGTH = 3

/** 文字のあるページ（1から）。見つからなければ null */
export function findPage(snippets: string[], facts: PdfFacts): number | null {
  for (const raw of snippets) {
    const s = compact(raw)
    if (s.length < MIN_LENGTH) continue
    const pages = facts.pages.flatMap((p, i) => (p.search.includes(s) ? [i + 1] : []))
    if (pages.length === 0) continue
    if (s.length >= SURE_LENGTH || pages.length === 1) return pages[0]
  }
  return null
}

/** 指摘に、ページを付ける（もとからページが分かっている指摘は、そのまま） */
export function locateFindings(findings: CheckFinding[], pdfs: Partial<Record<PartId, PdfFacts>>): CheckFinding[] {
  return findings.map((f) => {
    if (f.page) return f
    const facts = pdfs[f.part]
    if (!facts || !f.snippets?.length) return f
    const page = findPage(f.snippets, facts)
    return page ? { ...f, page } : f
  })
}

/** ページごとの指摘の数と、エラーがあるか（ページの絵の丸。赤＝エラーあり、茶＝要確認だけ） */
export function pagePins(findings: CheckFinding[]): Map<string, { count: number; error: boolean }> {
  const pins = new Map<string, { count: number; error: boolean }>()
  for (const f of findings) {
    if (!f.page) continue
    const key = `${f.part}:${f.page}`
    const at = pins.get(key) ?? { count: 0, error: false }
    pins.set(key, { count: at.count + 1, error: at.error || f.severity === 'error' })
  }
  return pins
}
