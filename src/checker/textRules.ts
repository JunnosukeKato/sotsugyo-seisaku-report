import type { WordCheck } from '../config/types'
import type { Severity } from './types'

/**
 * 文字の並びで判定できるセルフチェックのルール。段落など1つの文字列を受け取り、指摘を返す。
 * - source: 'guide' は手順書のルール、'supplementary' は手順書にない補助チェック（§3.7）
 * - 体言止めは単語の分解を使う判定に置き換えるまで、文末の文字で判定する暫定版
 */

export interface TextFinding {
  ruleId: string
  severity: Severity
  source: 'guide' | 'supplementary'
  title: string
  start: number
  end: number
  /** 自動修正できる場合の置き換え後の文字列 */
  replacement?: string
  /** 「全角の『１５』→ 半角の『15』」のような説明 */
  detail?: string
}

interface TextRule {
  id: string
  severity: Severity
  source: 'guide' | 'supplementary'
  title: string
  find: (text: string) => Omit<TextFinding, 'ruleId' | 'severity' | 'source' | 'title'>[]
}

function matches(text: string, re: RegExp) {
  return [...text.matchAll(re)].map((m) => ({ match: m, start: m.index, end: m.index + m[0].length }))
}

const KATAKANA = 'ァ-ヶ'
const KANJI = '\\u3400-\\u9fff々'

/**
 * 変換を間違えやすい語（ツールに入っている一覧。管理ページで年度ごとに追加・編集できる：YearConfig.wordChecks）
 * - error：報告書ではまず使わない形（ほぼ確実に誤り）
 * - warning：文脈によっては正しいこともある形（正しく使っているならそのままでよい）
 */
const MISCONVERSIONS: [string, string, string, WordCheck['severity']][] = [
  ['見頃', '身頃', '服の胴の部分', 'error'],
  ['身返し', '見返し', '前端などの裏に付ける布', 'error'],
  ['見幅', '身幅', '', 'error'],
  ['見丈', '身丈', '', 'error'],
  ['再寸', '採寸', '', 'error'],
  ['寸方', '寸法', '', 'error'],
  ['友布', '共布', '同じ布', 'error'],
  ['記事', '生地', '布のこと。雑誌などの記事のことなら、そのままでよい', 'warning'],
  ['証明', '照明', '舞台の明かりのこと。「証明する」の意味なら、そのままでよい', 'warning'],
  ['講演', '公演', '舞台の上演のこと。講演会のことなら、そのままでよい', 'warning'],
  ['部隊', '舞台', '舞台のこと。軍などの部隊のことなら、そのままでよい', 'warning'],
  ['意匠', '衣装', '衣装のこと。デザインの意味の「意匠」なら、そのままでよい', 'warning'],
  ['衣裳', '衣装', '誤りではないが、学科の表記（衣装）にそろえる', 'warning'],
]

export const TEXT_RULES: TextRule[] = [
  {
    id: 'digit-fullwidth',
    severity: 'error',
    source: 'guide',
    title: '数字は半角で書く',
    find: (text) =>
      matches(text, /[０-９]+/g).map(({ match, start, end }) => {
        const half = match[0].normalize('NFKC')
        return { start, end, replacement: half, detail: `全角の「${match[0]}」→ 半角の「${half}」` }
      }),
  },
  {
    id: 'desu-masu',
    severity: 'error',
    source: 'guide',
    title: '「です・ます」ではなく「である」調で書く',
    find: (text) =>
      matches(text, /(でしょう|でした|です|ました|ません|ます)(?=[。、」）！？]|$)/g).map(({ match, start, end }) => {
        const fixes: Record<string, string> = { です: 'である', でした: 'であった' }
        const replacement = fixes[match[0]]
        return { start, end, replacement, detail: replacement ? `「${match[0]}」→「${replacement}」` : `「${match[0]}」を「である」調に直す` }
      }),
  },
  {
    id: 'first-person',
    severity: 'error',
    source: 'guide',
    title: '一人称は「筆者」にする',
    find: (text) =>
      matches(text, /私たち|わたしたち|僕たち|僕ら|私(?![服物立鉄語的有見案事情設費淑信])|わたし|僕/g).map(({ match, start, end }) => {
        const plural = /たち|ら$/.test(match[0])
        return plural
          ? { start, end, detail: `「${match[0]}」→「筆者ら」など` }
          : { start, end, replacement: '筆者', detail: `「${match[0]}」→「筆者」` }
      }),
  },
  {
    id: 'seisaku',
    severity: 'error',
    source: 'guide',
    title: '「製作」ではなく「制作」で統一する',
    find: (text) => matches(text, /製作/g).map(({ start, end }) => ({ start, end, replacement: '制作', detail: '「製作」→「制作」' })),
  },
  {
    id: 'honorific',
    severity: 'warning',
    source: 'guide',
    title: '人名に敬称（さん・氏・女史・先生）を付けない',
    find: (text) =>
      matches(text, new RegExp(`(?<=[${KANJI}${KATAKANA}ー])(さん|女史|先生(?!方)|氏(?![名族]))`, 'g')).map(({ match, start, end }) => ({
        start,
        end,
        replacement: '',
        detail: `人名の後の「${match[0]}」を取る`,
      })),
  },
  {
    id: 'figure-ref-period',
    severity: 'error',
    source: 'guide',
    title: '文末の図表は「〜（図1）。」の順に書く',
    find: (text) =>
      matches(text, /。[\s　]*[（(]([図表])[\s　]*(\d+)[）)]/g).map(({ match, start, end }) => {
        const fixed = `（${match[1]}${match[2]}）。`
        return { start, end, replacement: fixed, detail: `「${match[0]}」→「${fixed}」` }
      }),
  },
  {
    // 段落の終わりには「。」を付ける（段落だけに当てる。見出しや図表のタイトルには当てない）
    id: 'sentence-end',
    severity: 'error',
    source: 'supplementary',
    title: '文末に「。」を付ける',
    find: (text) => {
      const t = text.replace(/[\s　]+$/, '')
      if (!t || /[。！？!?]$/.test(t)) return []
      return [{ start: t.length - 1, end: t.length, replacement: `${t[t.length - 1]}。`, detail: '段落の終わりに「。」がない' }]
    },
  },
  {
    // 「。。」のように続いた句点は1つにする（確定するときにも自動で1つにする）
    id: 'period-repeat',
    severity: 'error',
    source: 'supplementary',
    title: '「。」が続いている',
    find: (text) => matches(text, /。{2,}/g).map(({ start, end }) => ({ start, end, replacement: '。', detail: '「。」を1つにする' })),
  },
  {
    id: 'taigen-dome',
    severity: 'warning',
    source: 'guide',
    title: '体言止めを使わない',
    find: (text) =>
      matches(text, /[^。]+。/g).flatMap(({ match, start, end }) => {
        const body = match[0].slice(0, -1).replace(/[（(][図表][\s　]*\d+[）)]$/, '')
        const nounLike = new RegExp(`([${KANJI}${KATAKANA}ーA-Za-z0-9０-９]|こと|もの|ところ|ため)$`)
        // 下線は文全体ではなく文末（最後の1字と句点）だけに引く
        return nounLike.test(body) ? [{ start: Math.max(start, end - 2), end, detail: '文末を「〜である」「〜した」などで終える' }] : []
      }),
  },
  {
    id: 'placeholder',
    severity: 'error',
    source: 'guide',
    title: 'テンプレートの仮の文字が残っている',
    find: (text) => matches(text, /●+|〇〇+|～～+/g).map(({ start, end }) => ({ start, end, detail: '自分の内容に書き換える' })),
  },
  {
    id: 'figure-ref-halfwidth-paren',
    severity: 'warning',
    source: 'supplementary',
    title: '図表の参照の括弧は全角にする',
    find: (text) =>
      matches(text, /\(([図表])[\s　]*(\d+)\)/g).map(({ match, start, end }) => {
        const fixed = `（${match[1]}${match[2]}）`
        return { start, end, replacement: fixed, detail: `「${match[0]}」→「${fixed}」` }
      }),
  },
  {
    id: 'choon-dash',
    severity: 'warning',
    source: 'supplementary',
    title: '長音は「ー」で書く（記号の「―」になっている）',
    find: (text) =>
      matches(text, new RegExp(`(?<=[${KATAKANA}])[―‐−–—]`, 'g')).map(({ match, start, end }) => ({
        start,
        end,
        replacement: 'ー',
        detail: `記号の「${match[0]}」→ 長音の「ー」`,
      })),
  },
  {
    id: 'machine-dependent',
    severity: 'warning',
    source: 'supplementary',
    title: '機種依存文字を使わない',
    find: (text) =>
      // 見出しの番号（Ⅰ．ⅰ．）は組版で付けるため、ここで見つかるのは学生が入力したものだけ
      matches(text, /[㎜㎝㎞㎏㎡①-⑳Ⅰ-Ⅹⅰ-ⅹ]/g).map(({ match, start, end }) => {
        const replacement = match[0].normalize('NFKC')
        return { start, end, replacement, detail: `「${match[0]}」→「${replacement}」` }
      }),
  },
  {
    id: 'fullwidth-alpha',
    severity: 'warning',
    source: 'supplementary',
    title: '英字は半角で書く',
    find: (text) =>
      matches(text, /[Ａ-Ｚａ-ｚ]+/g).map(({ match, start, end }) => {
        const half = match[0].normalize('NFKC')
        return { start, end, replacement: half, detail: `全角の「${match[0]}」→ 半角の「${half}」` }
      }),
  },
  {
    id: 'halfwidth-kana',
    severity: 'warning',
    source: 'supplementary',
    title: '半角カナを使わない',
    find: (text) =>
      matches(text, /[ｦ-ﾟ]+/g).map(({ match, start, end }) => {
        const full = match[0].normalize('NFKC')
        return { start, end, replacement: full, detail: `半角の「${match[0]}」→ 全角の「${full}」` }
      }),
  },
]

export const DEFAULT_WORD_CHECKS: WordCheck[] = MISCONVERSIONS.map(([wrong, right, note, severity]) => ({ wrong, right, note, severity }))

/** 書き間違えやすい語のルール（「直す」で正しい語にする） */
function wordRules(words: WordCheck[]): TextRule[] {
  return words
    .filter((w) => w.wrong && w.right && w.wrong !== w.right)
    .map((w) => ({
      id: `word-${w.wrong}`,
      severity: w.severity,
      source: 'supplementary',
      title: `「${w.wrong}」ではなく「${w.right}」と書く`,
      find: (text: string) =>
        matches(text, new RegExp(w.wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')).map(({ start, end }) => ({
          start,
          end,
          replacement: w.right,
          detail: `「${w.wrong}」→「${w.right}」${w.note ? `（${w.note}）` : ''}`,
        })),
    }))
}

/** 1つの文字列にすべてのルールを当てる（書き間違えやすい語は words）。位置の順に並べて返す */
export function checkText(text: string, words: WordCheck[] = DEFAULT_WORD_CHECKS): TextFinding[] {
  return [...TEXT_RULES, ...wordRules(words)].flatMap((rule) =>
    rule.find(text).map((f) => ({ ruleId: rule.id, severity: rule.severity, source: rule.source, title: rule.title, ...f })),
  ).sort((a, b) => a.start - b.start || a.end - b.end)
}

/** 指摘の自動修正を文字列に当てる */
export function applyFix(text: string, finding: TextFinding): string {
  if (finding.replacement === undefined) return text
  return text.slice(0, finding.start) + finding.replacement + text.slice(finding.end)
}
