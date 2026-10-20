import type { LayoutInfo, PageKind } from './measure'
import type { TableFit } from './tableFit'

/**
 * 前に開いたときの紙面の組み方を、この端末（ブラウザ）に覚えておく。
 * 開くたびに紙面をはじめから組み直していたため、スマホでは使えるようになるまで数秒〜十数秒かかっていた。
 * 覚えるのは、組み終えて落ち着いたときの状態（目次のページ番号・次のページへ送った図・表紙のサブタイトルの文字の大きさ・章を分けて組んだか・
 * 行の高さを「そろえる」表などの、測った寸法）と、
 * 部分（表紙・抄録・目次・章ごと・残り）ごとの文書の要約（documentHash）とページの種類、紙面の情報（ページ数など）だけ。原稿の文字は入れない。
 * 次に開いたとき（editor/reportRenderer.ts）：
 * - 覚えた状態から組み始める（同じ原稿なら、組み直しが1回で済む）
 * - 覚えたときと同じ文書の部分はページ数が分かるので、見せるページのある部分を先に組んで、すぐ見せる（ほかの部分は、そのあと組む）
 * どちらも、組み終えたら確かめ直す（覚えたものが合っていなくても、出来上がる紙面は同じ）
 */
export interface LayoutMemory {
  v: 1
  /**
   * subtitle.line は、表紙のサブタイトルの1行の要約（documentHash。文字そのものは入れない）。
   * tables：表の ID → 測った行の高さ・左端の列の幅（layout/tableFit.ts。前の版で覚えたものにはない。読むときに形を確かめる：readTableFits）。
   * 部分ごとの文書（parts の hash）は、この寸法を書いた HTML のものなので、同じ寸法から組み始めれば、表のある章も覚えたときと同じ文書になる
   */
  state: { toc: Record<string, number>; deferred: string[]; subtitle: { line: string; pt: number }; split: boolean; tables?: Record<string, TableFit> }
  /** 部分ごとの文書の要約と、その部分のページの種類（ページ数＝種類の数） */
  parts: { hash: string; kinds: PageKind[] }[]
  layout: LayoutInfo
}

const KEY = 'sotsugyo-seisaku-report-layout'

/** 覚えている組み方（なければ・読めなければ・形が違えば null） */
export function loadLayoutMemory(): LayoutMemory | null {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) ?? 'null') as LayoutMemory | null
    const ok =
      m?.v === 1 &&
      typeof m.state?.split === 'boolean' &&
      Array.isArray(m.state.deferred) &&
      typeof m.state.subtitle?.pt === 'number' &&
      Array.isArray(m.parts) &&
      m.parts.every((p) => typeof p.hash === 'string' && Array.isArray(p.kinds)) &&
      Array.isArray(m.layout?.kinds)
    return ok ? m : null
  } catch {
    return null
  }
}

export function saveLayoutMemory(memory: LayoutMemory): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory))
  } catch {
    // 覚えておけなくても、次に開いたときに、はじめから組むだけ
  }
}

/** 忘れる（この端末から原稿を消すとき） */
export function forgetLayoutMemory(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // 使えないブラウザ
  }
}

/**
 * 文書の要約（同じ文書かどうかを見分けるため。53ビットの cyrb53 と文字数）。
 * 写真の場所（blob:〜）は開くたびに変わるので、除いてから求める（写真の大きさは、文書の図の幅・高さに入っている）
 */
export function documentHash(html: string): string {
  const text = html.replace(/blob:[^"')\s]+/g, 'blob:')
  let h1 = 0xdeadbeef ^ text.length
  let h2 = 0x41c6ce57 ^ text.length
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}:${text.length.toString(36)}`
}

/**
 * ページ数が分からない部分の、ふつうのページの種類（抄録・目次は1ページ、章ごとは本文1ページ、最後の部分は本文1ページと作品写真）。
 * 組み終えれば正しい数になる（それまでの仮のページの数にだけ使う）
 */
export function usualKinds(index: number, count: number): PageKind[] {
  return index === 0 ? ['cover'] : index === 1 ? ['abstract'] : index === 2 ? ['toc'] : index === count - 1 ? ['body', 'photos'] : ['body']
}

/**
 * 開いたときに、先に組んで見せる部分を決める（editor/reportRenderer.ts）。
 * docs：組む部分の文書、memory：前に開いたときに覚えた組み方（なければ null）、page：見せるページ（0 から。全体の通しのページ）。
 * 見せるページの前の部分がすべて、覚えたときと同じ文書なら（ページ数が分かり、見せるページの位置が決まる）、
 * その部分の番号と、部分ごとのページの種類（まだ組んでいない部分の仮のページに使う。覚えたときと違う部分は、同じ番号の部分のもの・なければふつうの数）を返す。
 * 見せるページのある部分だけが変わっていても（前に書いて、組み終える前に閉じた・読み込み直した）、その部分の始まりの位置は決まるので、
 * 覚えたページ数で見せるページを探す（組んだあと、見せるページがその部分の中にあるかを確かめてから見せる：reportRenderer.ts）。
 * 表紙（page が 0）は紙面のいちばん初めなので、覚えていなくても（はじめて開いた・原稿が変わった）位置が決まり、先に見せられる。
 * 決まらなければ null
 */
export function firstShowPlan(docs: string[], memory: LayoutMemory | null, page: number): { part: number; kinds: PageKind[][] } | null {
  const known = docs.map((doc, i) => (memory && memory.parts[i]?.hash === documentHash(doc) ? memory.parts[i].kinds : null))
  const kinds = known.map((k, i) => k ?? memory?.parts[i]?.kinds ?? usualKinds(i, docs.length))
  if (page === 0 && docs.length > 0) return { part: 0, kinds: [['cover'], ...kinds.slice(1)] }
  let start = 0
  for (let i = 0; i < docs.length; i++) {
    const k = known[i]
    if (!k) return page < start + kinds[i].length ? { part: i, kinds } : null
    if (page < start + k.length) return { part: i, kinds }
    start += k.length
  }
  return null
}
