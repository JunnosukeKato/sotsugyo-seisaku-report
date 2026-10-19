import type { EditorSnapshot } from '../editor/reportEditor'
import type { EditableKind } from '../editor/reportOps'
import type { HelpTopic } from '../help/helpTopics'
import { photoGrid, shownPhotos } from '../model/photos'
import type { Report, WorkPhotoPage } from '../model/types'

/**
 * スマホの紙面の下の帯（mockups/v32 ④ 案A。帯そのものは PageBand.tsx）に出す言葉。
 * 紙面の中の小さな案内（スマホでは 6px ほどで読めず、指で広げることもできない）を、ふつうの文字の大きさで出すためのもの。
 */

/** 帯を紙面の右に出す画面の形（横向きのスマホ。紙面の下に出すと、紙面がとても小さくなるため）。index.css の @media と同じ */
export const BAND_SIDE_QUERY = '(min-aspect-ratio: 4/3)'

/**
 * 作品写真のページの道具（並べ方・押して選んだ写真の「差し替え」「外す」「全体を入れる（切らない）」）を、
 * 下の道具の代わりに、紙面の右の列（帯と同じ列）に出すか（mockups/v33 案A）。
 * side：帯を紙面の右に出す画面の形（BAND_SIDE_QUERY。横向きのスマホ）。書いている間・拡大している間は、今までどおり下の道具
 */
export function photoToolsAtSide(snap: Pick<EditorSnapshot, 'layout' | 'page' | 'editingId' | 'zoomed'>, side: boolean): boolean {
  return side && snap.layout?.kinds[snap.page] === 'photos' && !snap.editingId && !snap.zoomed
}

/** 空いている作品写真の枠の呼び方（2枚の並べ方は「下の枠」など、ほかは「3枚目の枠」） */
export function photoSlotName(photos: Pick<WorkPhotoPage, 'layout' | 'columns'>, index: number): string {
  if (photos.layout === 2) {
    const sideBySide = photoGrid(photos).columns === 2
    if (index === 0) return sideBySide ? '左の枠' : '上の枠'
    return sideBySide ? '右の枠' : '下の枠'
  }
  return `${index + 1}枚目の枠`
}

/** 作品写真のページの帯：空いている枠の言葉と、「写真を選ぶ」で入れる枠（空いている枠がなければ null） */
export function photoBand(photos: WorkPhotoPage): { text: string; index: number } | null {
  const empty = shownPhotos(photos).flatMap((p, i) => (p.imageId ? [] : [i]))
  if (!empty.length) return null
  if (photos.layout === 1) return { text: '作品写真が、まだ入っていません', index: 0 }
  if (empty.length === 1) return { text: `${photoSlotName(photos, empty[0])}に、まだ写真がありません`, index: empty[0] }
  return { text: `まだ写真がない枠が${empty.length}つあります（＋の枠）`, index: empty[0] }
}

/**
 * 目次のページの帯（目次は、本文の見出しから自動で作る。学生は書けないので、壊れている・さわれないと思わないように：mockups/v41 案C）。
 * ボタンはない（目次の行をタップすると、その見出しへ移る）
 */
export const TOC_BAND = {
  text: '目次は、本文の見出しから自動で作ります',
  sub: '目次の行をタップすると、その見出しへ移ります',
} as const

/** 紙面の、まだ書いていない所（帯の「書く」「写真を選ぶ」で、その所を開く） */
export type BandTodo =
  /** 書く欄（段落・見出し・図表のタイトル・表のセル・表紙の項目）。hint：ひな形の「ここに何を書くか」 */
  | { kind: 'field'; id: string; editable: EditableKind; hint?: string }
  /** 表紙のコース（選ぶ） */
  | { kind: 'course'; id: string }
  /** ひな形の、まだ写真を入れていない図の枠 */
  | { kind: 'figure'; id: string }

/** 表紙の項目の名前 */
const FIELD_NAMES: Record<string, string> = { 'basic:studentId': '学籍番号', 'basic:name': '氏名', 'basic:subtitleInput': 'サブタイトル' }

/** 書く欄の種類の名前 */
const KIND_NAMES: Record<EditableKind, string> = {
  field: '表紙の項目',
  abstractParagraph: '抄録の段落',
  chapter: '大見出し',
  subheading: '小見出し',
  paragraph: '段落',
  figureCaption: '図のタイトル',
  tableCaption: '表のタイトル',
  tableCell: '表のセル',
}

/**
 * まだ書いていない所の帯の言葉。todo：いちばん上の所、rest：同じページの、ほかのまだの所の数。
 * text：太字の1行目、sub：小さな2行目（なければ null）、button：押すボタンの名前
 */
export function todoBand(todo: BandTodo, rest: number): { text: string; sub: string | null; button: string } {
  const more = rest > 0 ? `このページで、ほかに${rest}か所（＋の印）` : null
  if (todo.kind === 'figure') return { text: '図の枠に、まだ写真がありません', sub: more, button: '写真を選ぶ' }
  if (todo.kind === 'course') return { text: 'コースを、まだ選んでいません', sub: more, button: '選ぶ' }
  const hint = todo.hint?.trim()
  // ひな形の段落は「ここに何を書くか」をそのまま出す（紙面では小さくて読めないため）
  if (hint) return { text: hint, sub: [`まだ書いていない${KIND_NAMES[todo.editable]}`, more].filter(Boolean).join('。'), button: '書く' }
  const name = FIELD_NAMES[todo.id] ?? KIND_NAMES[todo.editable]
  return { text: `${name}が、まだ空いています`, sub: more, button: '書く' }
}

/**
 * スマホ（指で押す）の画面に出す言葉：「クリック」を「タップ」にする（PC の言葉はそのまま）。
 * 紙面の中の仮の文字（「（クリックして入力）」など）は、index.css の「v32 の直し」で、スマホのときだけ同じように替える
 */
export function forTouch(text: string): string {
  return text.replace(/クリック/g, 'タップ')
}

/**
 * スマホの「？ 使い方」の項目：題・ひとこと・手順・補足の「クリック」を「タップ」にする（forTouch。PC はそのまま）。
 * 「クリック（スマホはタップ）」は「タップ」だけにする。パソコンのことを書いた補足（「パソコンでは」）と、端末ごとの手順は変えない。
 * 「クリック」で探しても見つかるよう、変えた項目は探す言葉に「クリック」を足す
 */
export function topicsForTouch(topics: HelpTopic[]): HelpTopic[] {
  const touch = (text: string) => forTouch(text.replace(/クリック[（(]スマホはタップ[）)]/g, 'タップ'))
  return topics.map((t) => {
    const next: HelpTopic = {
      ...t,
      title: touch(t.title),
      ...(t.lead !== undefined ? { lead: touch(t.lead) } : {}),
      ...(t.steps ? { steps: t.steps.map(touch) } : {}),
      ...(t.items ? { items: t.items.map((it) => (/パソコン/.test(it.h) ? it : { h: touch(it.h), t: touch(it.t) })) } : {}),
    }
    const changed = JSON.stringify(next) !== JSON.stringify(t)
    return changed ? { ...next, words: [t.words, 'クリック'].filter(Boolean).join(' ') } : t
  })
}

/** ひな形の段落（抄録・本文）の「ここに何を書くか」（なければ undefined） */
export function paragraphHint(report: Report, id: string): string | undefined {
  const block = [...report.abstract.paragraphs, ...report.body.flatMap((c) => c.blocks)].find((b) => b.id === id)
  return block?.type === 'paragraph' ? block.hint?.trim() || undefined : undefined
}
