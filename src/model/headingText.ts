/**
 * 見出しの形の行（手順書の番号の形：「Ⅲ．まとめ」「ⅱ．袖の刺繍」「II. 制作過程」など。番号はローマ数字）を見分ける。
 * - Word から読み込むとき・Word のファイルのチェック（import/wordImport.ts・check/）：headingFromText
 * - 段落に見出しの形で打ったとき（Enter・書き終えたとき）と、何行かの文を貼り付けたときに、見出しにする（editor/reportEditor.ts）：typedHeading
 * 算用数字の形（「1．」「（1）」「第1章」）は、どちらも見出しにしない
 */

/** 空白（全角も） */
const SP = '[\\s\\u3000]'
const UPPER_ROMAN = 'ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫ'
const LOWER_ROMAN = 'ⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹⅺⅻ'
const HEADING_SEP = `${SP}*[．.、，,:：)）]${SP}*`
const ROMAN_WORD = /^(X{0,3})(IX|IV|V?I{0,3})$/

export interface HeadingText {
  level: 1 | 2
  title: string
}

/** 行の頭のローマ数字（Ⅰ．ⅰ．I. i. など）で見出しを見分ける。番号は除き、名前だけにする */
export function headingFromText(raw: string): HeadingText | null {
  const t = raw.replace(/[\n\t]/g, '').trim()
  const tryLevel = (level: 1 | 2, unicode: string, ascii: string): HeadingText | null => {
    // 機種依存のローマ数字（Ⅰ・ⅰ）は、区切り（．）がなくてもよい（短い行だけ）
    const u = new RegExp(`^([${unicode}]{1,3})(${HEADING_SEP}|${SP}*)(\\S.*)$`).exec(t)
    if (u) {
      const title = u[3].trim()
      if (u[2].length > 0 || (title.length <= 30 && !/[。！？]$/.test(title))) return { level, title }
    }
    // 英字・全角英字のローマ数字（I. Ⅱ を II と打ったなど）は、区切りがあり、短い行だけ
    const a = new RegExp(`^([${ascii}]{1,4})${HEADING_SEP}(\\S.*)$`).exec(t)
    if (a && ROMAN_WORD.test(a[1].normalize('NFKC').toUpperCase()) && a[2].length <= 40 && !/[。！？]$/.test(a[2])) return { level, title: a[2].trim() }
    return null
  }
  return tryLevel(1, UPPER_ROMAN, 'IVXＩＶＸ') ?? tryLevel(2, LOWER_ROMAN, 'ivxｉｖｘ')
}

/** 段落に打った見出しの名前の長さの上限（これより長い行は、文として段落のままにする） */
const TYPED_TITLE_MAX = 40

/**
 * 段落に打った1行（貼り付けた1行も）が、見出しにしてよい形か。見出しにするなら、大見出し（1）か小見出し（2）かと、番号を除いた名前。
 * headingFromText の形のうち、次のものだけ（段落の文を、知らないうちに見出しにしないように）：
 * - 番号のあとに名前がある（「Ⅲ．」だけは見出しにしない。名前に文字か数字が1つ以上ある）
 * - 文ではない（「。」「！」「？」で終わらない）。名前は 40字まで
 */
export function typedHeading(line: string): HeadingText | null {
  const found = headingFromText(line)
  if (!found) return null
  const title = found.title
  if (!/[\p{L}\p{Nd}]/u.test(title) || title.length > TYPED_TITLE_MAX || /[。！？!?]$/.test(title)) return null
  return found
}
