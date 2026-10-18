import type { EditableKind } from '../editor/reportOps'
import { photoGrid, shownPhotos } from '../model/photos'
import type { Report, WorkPhotos } from '../model/types'

/**
 * スマホの紙面の下の帯（mockups/v32 ④ 案A。帯そのものは PageBand.tsx）に出す言葉。
 * 紙面の中の小さな案内（スマホでは 6px ほどで読めず、指で広げることもできない）を、ふつうの文字の大きさで出すためのもの。
 */

/** 帯を紙面の右に出す画面の形（横向きのスマホ。紙面の下に出すと、紙面がとても小さくなるため）。index.css の @media と同じ */
export const BAND_SIDE_QUERY = '(min-aspect-ratio: 4/3)'

/** 空いている作品写真の枠の呼び方（2枚の並べ方は「下の枠」など、ほかは「3枚目の枠」） */
export function photoSlotName(photos: Pick<WorkPhotos, 'layout' | 'columns'>, index: number): string {
  if (photos.layout === 2) {
    const sideBySide = photoGrid(photos).columns === 2
    if (index === 0) return sideBySide ? '左の枠' : '上の枠'
    return sideBySide ? '右の枠' : '下の枠'
  }
  return `${index + 1}枚目の枠`
}

/** 作品写真のページの帯：空いている枠の言葉と、「写真を選ぶ」で入れる枠（空いている枠がなければ null） */
export function photoBand(photos: WorkPhotos): { text: string; index: number } | null {
  const empty = shownPhotos(photos).flatMap((p, i) => (p.imageId ? [] : [i]))
  if (!empty.length) return null
  if (photos.layout === 1) return { text: '作品写真が、まだ入っていません', index: 0 }
  if (empty.length === 1) return { text: `${photoSlotName(photos, empty[0])}に、まだ写真がありません`, index: empty[0] }
  return { text: `まだ写真がない枠が${empty.length}つあります（＋の枠）`, index: empty[0] }
}

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

/** ひな形の段落（抄録・本文）の「ここに何を書くか」（なければ undefined） */
export function paragraphHint(report: Report, id: string): string | undefined {
  const block = [...report.abstract.paragraphs, ...report.body.flatMap((c) => c.blocks)].find((b) => b.id === id)
  return block?.type === 'paragraph' ? block.hint?.trim() || undefined : undefined
}
