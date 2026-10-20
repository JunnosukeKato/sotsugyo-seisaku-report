/**
 * 抄録には図表を入れない（依頼者の決まり。2026-10-20）。抄録に貼り付ける文から、図表の参照を除く。
 * - 括弧で添えた参照（「（図1）」「(図1)」「（表2）」「（図1・図2）」「（図1、表1）」。全角の数字も）：括弧ごと除き、前後の空白・句読点を整える
 *   （「を作った（図1）。」→「を作った。」）
 * - 文の中の参照（「図1に示すように」）：除くと文が崩れるので残し、書き直してもらう（kept。呼び出し側が知らせる）
 * 本文の段落を紙面で選んでコピーしたまとまり（rangeOps.ts の pasteClip）・ふつうの文字の貼り付け（reportEditor の pasteText）の両方で使う
 */

/** 図表の番号（「図?」は、消した図表を指していた所） */
const NUM = '(?:[0-9０-９]+|[?？])'
/** 括弧で添えた参照（「（図1）」「（図1・図2）」「（図1、表1）」「（図1〜3）」「（図1参照）」） */
const PAREN_REF = new RegExp(
  `[（(][ \\t　]*[図表][ \\t　]*${NUM}(?:[ \\t　]*[・、，,～〜~\\-－‐―][ \\t　]*(?:[図表][ \\t　]*)?${NUM})*(?:[ \\t　]*を?参照)?[ \\t　]*[）)]`,
  'g',
)
/** 文の中の参照（「図1に示すように」。「地図1枚」のように漢字に続くものは除く） */
const IN_SENTENCE = /(?<![㐀-鿿々])([図表])[ \t　]*([0-9０-９]+)/g
const SPACES = /[ \t　]+$/
/** 参照を除いた後ろに続くと、前の空白を詰める字（句読点・閉じ括弧） */
const CLOSING = /^[。、，．,.！？!?」』）)]/
const PUNCT = /[。、，．]/

export interface StrippedRefs {
  text: string
  /** 除いた参照（「（図1）」など。除いた順） */
  removed: string[]
  /** 文の中に残した参照（「図1」「表1」。数字は半角。重なりなし） */
  kept: string[]
}

const halfDigits = (s: string) => s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))

/** 抄録に入れる文から、括弧で添えた図表の参照を除く（文の中の参照は残して kept に入れる） */
export function stripFigureRefs(text: string): StrippedRefs {
  const removed: string[] = []
  let out = ''
  let last = 0
  for (const m of text.matchAll(PAREN_REF)) {
    out += text.slice(last, m.index)
    removed.push(m[0])
    last = m.index + m[0].length
    const after = text.slice(last)
    const rest = after.replace(/^[ \t　]+/, '')
    const next = rest[0] ?? ''
    // 「作った （図1） 。」→「作った。」：後ろが句読点・閉じ括弧・段落の終わりなら、前後の空白を詰める。前が空白（・段落の始め）なら、後ろの空白を詰める
    if (!next || CLOSING.test(rest)) {
      out = out.replace(SPACES, '')
      last += after.length - rest.length
    } else if (!out || SPACES.test(out)) last += after.length - rest.length
    // 「、（図1）。」「。（図1）。」：句読点が2つ続かないようにする（「、。」は「。」に）
    const prev = out.at(-1) ?? ''
    if (PUNCT.test(prev) && PUNCT.test(next)) {
      if (prev === next || /[、，]/.test(prev)) out = out.slice(0, -1)
      else last += 1
    }
  }
  out += text.slice(last)
  const kept = [...new Set([...out.matchAll(IN_SENTENCE)].map((m) => `${m[1]}${halfDigits(m[2])}`))]
  return { text: out, removed, kept }
}

/**
 * 抄録に貼り付けたときの知らせ（そのまま入れなかったときだけ。なければ null）。
 * dropped：見出し・図・表を入れなかった。removed・kept：stripFigureRefs の結果
 */
export function abstractPasteNotice(dropped: boolean, removed: readonly string[], kept: readonly string[]): string | null {
  if (kept.length > 0) return `抄録には図表を入れません。${kept.slice(0, 2).map((k) => `「${k}」`).join('')}の入った文を書き直してください`
  const example = removed.length > 0 ? `「${removed[0]}」` : ''
  if (dropped && example) return `抄録には文だけを貼り付けました（見出し・図・表と${example}は除きました）`
  if (dropped) return '抄録には文だけを貼り付けました（見出し・図・表は入れません）'
  if (example) return `抄録には図表を入れないので、${example}を除いて貼り付けました`
  return null
}
