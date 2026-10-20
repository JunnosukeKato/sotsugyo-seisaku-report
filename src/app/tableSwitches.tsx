import type { ReactNode } from 'react'
import type { ReportEditor } from '../editor/reportEditor'
import type { TableBlock } from '../model/types'

/**
 * 表の形の切り替え：列の幅・左端の列（列の幅が「そろえる」のときだけ）・行の高さ。
 * PC の左の道具では2つのボタンから選び（app/Palette.tsx）、スマホの道具では、いまの形を出すボタン1つを押すたびに切り替える（Palette.tsx・Phone.tsx）。
 * on：列の幅・行の高さは「そろえる」、左端の列は「中身に合わせる」。どれも、元に戻す1回で戻る（editor/reportEditor.ts の changeTable）
 */
export interface TableSwitch {
  key: 'widths' | 'label' | 'heights'
  /** 道具の名前（「列の幅」など） */
  label: string
  /** 出すか（左端の列は、列の幅が「そろえる」のときだけ） */
  shown: (table: TableBlock) => boolean
  on: (table: TableBlock) => boolean
  /** 形の名前（「そろえる」「中身に合わせる」など） */
  value: (on: boolean) => string
  /** いまの形と、押すとどうなるか（例：列の幅：そろえる（押すと、中身に合わせる）） */
  title: (on: boolean) => string
  set: (editor: ReportEditor, tableId: string, on: boolean) => void
}

const pair = (label: string, onValue: string, offValue: string, offLong = offValue) => ({
  label,
  value: (on: boolean) => (on ? onValue : offValue),
  title: (on: boolean) => (on ? `${label}：${onValue}（押すと、${offLong}）` : `${label}：${offLong}（押すと、${onValue}）`),
})

export const TABLE_SWITCHES: TableSwitch[] = [
  {
    key: 'widths',
    ...pair('列の幅', 'そろえる', '中身に合わせる'),
    shown: () => true,
    on: (t) => t.widths !== 'auto',
    set: (editor, id, on) => editor.setTableWidths(id, on ? 'equal' : 'auto'),
  },
  {
    key: 'label',
    ...pair('左端の列', '中身に合わせる', 'ほかとそろえる', 'ほかの列とそろえる'),
    shown: (t) => t.widths !== 'auto',
    on: (t) => t.labelColumn === true,
    set: (editor, id, on) => editor.setTableLabelColumn(id, on),
  },
  {
    key: 'heights',
    ...pair('行の高さ', 'そろえる', '中身に合わせる'),
    shown: () => true,
    on: (t) => t.heights === 'equal',
    set: (editor, id, on) => editor.setTableHeights(id, on ? 'equal' : 'auto'),
  },
]

/** 折り返してよい所（スマホの下の道具で、2行にするとき。1字だけの行ができないよう、言葉の切れ目で分ける） */
const BREAKS: Record<string, [string, string]> = {
  中身に合わせる: ['中身に', '合わせる'],
  ほかとそろえる: ['ほかと', 'そろえる'],
}

/** 形の名前を、言葉の切れ目でだけ折り返せるようにする（index.css の word-break: keep-all と一緒に使う） */
export function twoLines(text: string): ReactNode {
  const parts = BREAKS[text]
  if (!parts) return text
  return (
    <>
      {parts[0]}
      <wbr />
      {parts[1]}
    </>
  )
}

/** 予備の下の書く欄（?direct=0）の道具で使う、短い名前（「幅：そろえる」のように出す。前から「幅：」だった） */
export const SHORT_SWITCH_NAMES: Record<TableSwitch['key'], string> = { widths: '幅', label: '左端', heights: '高さ' }
