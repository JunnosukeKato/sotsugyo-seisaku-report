import type { HelpTopic } from './helpTopics'

/**
 * 使い方の「言葉で探す」。入れた言葉（空白で区切る）が、項目の題・文・よく使われる言い方（words）に
 * そのまま入っているかを数えるだけ（AI ではない。どこにも送らない）。
 * 全角・半角と、英字の大文字・小文字の違いだけはそろえる（ＰＤＦ → pdf）
 */

/** 比べるための形にそろえる（全角の英数字・空白を半角に、英字を小文字に） */
export const normalize = (s: string): string => s.normalize('NFKC').toLowerCase()

/** 入れた言葉を、空白・読点・中黒で区切る（同じ言葉は1つに） */
export function termsOf(query: string): string[] {
  return [...new Set(normalize(query).split(/[\s、,・]+/).filter(Boolean))]
}

/** 項目の中の、探す対象の1行（label：結果に出す小見出し。端末の名前など） */
export interface HelpLine {
  label?: string
  text: string
}

/** 項目の文を、1行ずつに分ける（題と words は含まない） */
export function linesOf(topic: HelpTopic): HelpLine[] {
  return [
    ...(topic.lead ? [{ text: topic.lead }] : []),
    ...(topic.steps ?? []).map((text) => ({ text })),
    ...(topic.items ?? []).map((it) => ({ label: it.h, text: it.t })),
    ...(topic.devices ?? []).flatMap((d) => d.lines.map((text) => ({ label: d.label, text }))),
  ]
}

export interface HelpHit {
  topic: HelpTopic
  /** 入っていた言葉（そろえた形） */
  found: string[]
  /** 結果に出す1行 */
  line: HelpLine
  /** 題にも出した1行にも見えない言葉（よく使われる言い方で見つかった言葉）。結果の下に小さく出す */
  hidden: string[]
}

const lineText = (l: HelpLine) => normalize(`${l.label ?? ''} ${l.text}`)

/**
 * 項目を探す。1つの項目につき1件。
 * 並べ方：入れた言葉のうち、いくつが入っているか（多い順）→ 題に入っている数 → 一覧の順。
 * 結果に出す1行は、題に入っていない言葉が多く入っている行（題と合わせて、入れた言葉がなるべくみな見えるように）
 */
export function searchTopics(topics: HelpTopic[], query: string): { terms: string[]; hits: HelpHit[] } {
  const terms = termsOf(query)
  if (!terms.length) return { terms, hits: [] }
  const scored: (HelpHit & { score: number; order: number })[] = []
  topics.forEach((topic, order) => {
    const lines = linesOf(topic)
    const title = normalize(topic.title)
    const all = normalize([topic.title, ...lines.map((l) => `${l.label ?? ''} ${l.text}`), topic.words ?? ''].join(' '))
    const found = terms.filter((t) => all.includes(t))
    if (!found.length) return
    const inTitle = found.filter((t) => title.includes(t))
    let line: HelpLine = lines[0] ?? { text: '' }
    let best = -1
    for (const l of lines) {
      const has = found.filter((t) => lineText(l).includes(t))
      const n = has.filter((t) => !inTitle.includes(t)).length * 2 + has.filter((t) => inTitle.includes(t)).length
      if (n > best) [line, best] = [l, n]
    }
    const seen = `${title} ${lineText(line)}`
    const hidden = found.filter((t) => !seen.includes(t))
    scored.push({ topic, found, line, hidden, score: found.length * 100 + inTitle.length * 10, order })
  })
  scored.sort((a, b) => b.score - a.score || a.order - b.order)
  return { terms, hits: scored.map(({ topic, found, line, hidden }) => ({ topic, found, line, hidden })) }
}

/**
 * 文の中の、言葉が入っているところに印を付けるため、文を「印あり・なし」の切れ目に分ける。
 * 全角・半角、大文字・小文字の違いがあっても見つける（見せる文字は、元の文のまま）
 */
export function highlightParts(text: string, terms: string[]): { text: string; hit: boolean }[] {
  if (!terms.length || !text) return text ? [{ text, hit: false }] : []
  // 1文字ずつそろえた形にし、そろえた形の文字が元の文の何文字目かを覚えておく
  const chars = [...text]
  let norm = ''
  const from: number[] = []
  chars.forEach((c, k) => {
    const n = normalize(c)
    norm += n
    for (let i = 0; i < n.length; i++) from.push(k)
  })
  // 印を付ける範囲（元の文の何文字目から何文字目まで）。重なる範囲はまとめる
  const marked = new Array<boolean>(chars.length).fill(false)
  for (const t of terms) {
    let i = norm.indexOf(t)
    while (i >= 0) {
      for (let k = from[i]; k <= from[i + t.length - 1]; k++) marked[k] = true
      i = norm.indexOf(t, i + t.length)
    }
  }
  const parts: { text: string; hit: boolean }[] = []
  chars.forEach((c, k) => {
    const last = parts[parts.length - 1]
    if (last && last.hit === marked[k]) last.text += c
    else parts.push({ text: c, hit: marked[k] })
  })
  return parts
}
