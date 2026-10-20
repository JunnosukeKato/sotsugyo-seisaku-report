import type { YearConfig } from '../config'
import { courseName } from './changes'
import type { YearStatus } from './server'

/**
 * 管理ページの、年度の状態（公開中・準備中・終了）によって変わる言葉。
 * 「保存」を押したあと学生に届くかどうかは状態で違うため、案内・確認・保存したあとの知らせの言葉をここでそろえる。
 *   公開中 … 「保存して学生に反映」で、学生のツールに届く
 *   準備中 … 「保存」では届かない（「この年度を学生に公開」を押してから）
 *   終了   … 「保存」で、その年度に書き始めた学生のツールに届く（配信の窓口は終了した年度も返し、学生は書き始めた年度の設定で開くため）
 */

type Who = 'admin' | 'teacher'

const WEEK = '日月火水木金土'

/** 「2027-01-20」→「2027年1月20日（水）」（日付として読めなければ、そのまま） */
export function formatDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (date.getUTCMonth() !== Number(m[2]) - 1) return ymd
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日（${WEEK[date.getUTCDay()]}）`
}

/** 見出しの欄の保存のボタンの名前 */
export const saveButtonLabel = (status: YearStatus) => (status === '公開中' ? '保存して学生に反映' : '保存')

/** 「反映する」の後に、どうすれば学生に届くか（ひな形・書き間違えやすい語を反映したときの知らせ） */
export function deliveryNote(status: YearStatus, who: Who): string {
  if (status === '公開中') return '「保存して学生に反映」を押すと、学生のツールに届きます'
  if (status === '終了') return '「保存」を押すと、この年度に書き始めた学生のツールに届きます'
  return `「保存」を押すと保存されます。学生に届くのは、${who === 'admin' ? '「この年度を学生に公開」を押して' : '管理者がこの年度を学生に公開して'}からです`
}

/** 下書きのひな形の窓のいちばん下の案内 */
export function templateFootNote(status: YearStatus): string {
  if (status === '公開中') return '「反映する」の後、「保存して学生に反映」で学生のツールに届きます。すでに書き始めた学生の原稿は変わりません。'
  if (status === '終了') return '「反映する」の後、「保存」で、この年度に書き始めた学生のツールに届きます。書き始めた学生の原稿は変わりません。'
  return '「反映する」の後、「保存」で保存します。学生に届くのは、この年度を学生に公開してからです。'
}

/** 保存できたときの知らせ */
export function savedMessage(status: YearStatus, who: Who): string {
  if (status === '公開中') return '保存し、学生のツールに反映しました（学生がツールを開き直すと、1分ほどで届きます）'
  if (status === '終了') return '保存しました（この年度に書き始めた学生のツールに、1分ほどで届きます）'
  return `保存しました（学生に届くのは、${who === 'admin' ? '「この年度を学生に公開」を押して' : '管理者がこの年度を学生に公開して'}からです）`
}

/** 確認の窓に並べる変更の一覧（多いときは「ほか○件」） */
function changeLines(changes: string[], max = 12): string {
  if (!changes.length) return '・（変更の内容を一覧にできませんでした）'
  const shown = changes.slice(0, max).map((c) => `・${c}`)
  if (changes.length > max) shown.push(`・ほか${changes.length - max}件`)
  return shown.join('\n')
}

/**
 * 保存する前の確認の言葉（学生に届く年度＝公開中・終了だけ。準備中は確認しないので null）。
 * 何が変わるか（保存してある内容と比べた変更）と、いつ・誰に届くかを示す
 */
export function saveConfirmText(status: YearStatus, year: number, changes: string[]): string | null {
  if (status === '準備中') return null
  const head =
    status === '公開中'
      ? `${year}年度は学生に公開中です。保存すると、次の変更が学生のツールに届きます（学生がツールを開き直すと、1分ほどで届きます）。`
      : `${year}年度は「終了」した年度ですが、この年度に書き始めた学生は、今もこの設定を使っています。保存すると、次の変更がその学生のツールに届きます（ツールを開き直すと、1分ほどで届きます）。`
  const template = changes.some((c) => c.endsWith('の下書きのひな形') || c.endsWith('の抄録の書き出し例'))
  const tail = `すでに書き始めた学生の原稿（書いた文章）は変わりません。${template ? '下書きのひな形と抄録の書き出し例は、これからコースを選ぶ学生に入ります。' : ''}`
  return `${head}\n\n${changeLines(changes)}\n\n${tail}\n保存しますか？`
}

/**
 * 公開する前の確認の言葉。学生に出る主な内容（共通の題目・最終締切・コースごとの指導教員）と、
 * 公開すると誰の画面がどうなるかを示す
 */
export function publishConfirmText(config: YearConfig, currentYear: number | null, unsaved: boolean): string {
  const courses = config.courses.filter((c) => !c.hidden).map((c) => `・${courseName(c)} コース：${c.advisors.filter((a) => a.trim()).join('、') || '（指導教員なし）'}`)
  const lines = [
    `${config.fiscalYear}年度の設定を学生に公開しますか？`,
    '',
    `共通の題目：${config.commonTitle}`,
    `最終締切：${formatDate(config.deadline)}`,
    '指導教員：',
    ...courses,
    '',
    `・まだ書き始めていない学生は、${config.fiscalYear}年度の設定で書き始めます。`,
    '・すでに書き始めた学生は、書き始めた年度の設定のままです。',
  ]
  if (currentYear !== null) lines.push(`・今公開中の${currentYear}年度は「終了」になります。`)
  if (unsaved) lines.push('・保存していない変更は、保存してから公開します。')
  return lines.join('\n')
}

/** 題目の中の、年度ごとに変わる言葉（「」『』の中。なければ題目そのもの） */
export function titleWords(title: string): string[] {
  const quoted = [...title.matchAll(/[「『"“]([^」』"”]{2,})[」』"”]/g)].map((m) => m[1].trim()).filter(Boolean)
  if (quoted.length) return [...new Set(quoted)]
  return title.trim().length >= 2 ? [title.trim()] : []
}

/** 知らせの箇条書きの1行（where：画面のどこで直すか。「場所：…」として小さな字で添える） */
export interface NoticeItem {
  text: string
  where: string
}

/** 箇条書きの知らせ（text：太字の1行目、detail：その下の文、items：箇条書き） */
export interface ListNotice {
  text: string
  detail: string
  items: NoticeItem[]
}

/** 管理ページの画面で、項目を直す場所（左の見出しの区切りと、その中の欄の名前） */
const PLACE = {
  commonTitle: '「年度の設定」の「共通の題目」',
  deadline: '「年度の設定」の「最終締切」',
  notice: '「コース」で、コースを開いた所の「お知らせ」',
  courseExample: '「コース」で、コースを開いた所の「ひな形を作る画面を開く」',
  openingExample: '「詳細設定」の「書き出しの例」',
}

/**
 * 新年度を作ったときの知らせ：前の年度のままの項目（確かめて直してもらう。mockups/v35-admin ③ 案A：箇条書きで、直す場所を添える）。
 * 共通の題目・最終締切（同じ日付）・お知らせのあるコース・抄録の書き出し例に前の年度の題目の言葉があるコース
 */
export function newYearNotice(from: YearConfig, newYear: number): ListNotice {
  const items: NoticeItem[] = [
    { text: '共通の題目', where: PLACE.commonTitle },
    { text: `最終締切（${formatDate(from.deadline)}。${from.fiscalYear}年度と同じ日付）`, where: PLACE.deadline },
  ]
  const shown = from.courses.filter((c) => !c.hidden)
  const withNotice = shown.filter((c) => typeof c.notice === 'string' && c.notice.trim())
  if (withNotice.length) items.push({ text: `お知らせ（${withNotice.map((c) => `${courseName(c)} コース`).join('、')}）`, where: PLACE.notice })
  const words = titleWords(from.commonTitle)
  const found = (text: unknown) => typeof text === 'string' && words.some((w) => text.includes(w))
  const courseExamples = shown.filter((c) => found(c.abstractExample)).map((c) => `${courseName(c)} コース`)
  const inOpening = found(from.abstract.openingExample)
  const examples = inOpening ? [...courseExamples, '詳細設定'] : courseExamples
  if (examples.length) {
    // コースの書き出し例はひな形の窓で、詳細設定の書き出し例は詳細設定の欄で直す
    const where = [courseExamples.length ? PLACE.courseExample : '', inOpening ? PLACE.openingExample : ''].filter(Boolean).join('と、')
    items.push({ text: `抄録の書き出し例（${examples.join('、')}。前の年度の題目の言葉「${words.join('」「')}」が入っています）`, where })
  }
  return {
    text: `${newYear}年度を作成しました（${from.fiscalYear}年度の設定のコピーです）。`,
    detail: `次の項目は${from.fiscalYear}年度のままです。確かめて直してください。`,
    items,
  }
}

/**
 * 準備中の年度を削除する前の確認の言葉（mockups/v35-admin ② の文）。
 * next：削除したあとに開く年度（公開中の年度。なければいちばん新しい年度）
 */
export function deleteConfirmText(year: number, next: { year: number; status: YearStatus }): string {
  return [
    `${year}年度（準備中）を削除しますか？`,
    '',
    '・この年度の設定（共通の題目・締切・コース・ひな形・お知らせなど）が、すべて消えます。元には戻せません。',
    '・まだ学生に公開していないので、学生のツールは変わりません。',
    `・削除したあとは、${next.year}年度（${next.status}）を開きます。`,
  ].join('\n')
}

/** 準備中の年度を削除したあとの知らせ（opened：いま開いている年度） */
export function deletedMessage(year: number, opened: { year: number; status: YearStatus } | undefined): string {
  return `${year}年度を削除しました。${opened ? `いまは${opened.year}年度（${opened.status}）を開いています。` : ''}`
}
