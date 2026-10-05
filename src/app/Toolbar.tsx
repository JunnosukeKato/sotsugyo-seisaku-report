import { useState } from 'react'
import type { EditorSnapshot, ReportEditor } from '../editor/reportEditor'
import { numbering } from '../editor/reportOps'
import type { WorkPhotoLayout } from '../model/types'

interface Props {
  editor: ReportEditor
  snap: EditorSnapshot
}

/** ボタンを押しても入力欄から文字のカーソルが外れないようにする */
const keepFocus = (e: React.MouseEvent) => e.preventDefault()

function ReferenceMenu({ editor, snap }: Props) {
  const [open, setOpen] = useState(false)
  const n = numbering(snap.report)
  const items = [
    ...[...n.figureByNumber.entries()].map(([num, id]) => ({ id, label: `図${num}` })),
    ...[...n.tableByNumber.entries()].map(([num, id]) => ({ id, label: `表${num}` })),
  ]
  const enabled = snap.editingKind === 'paragraph' && items.length > 0
  return (
    <span className="menu-wrap">
      <button onMouseDown={keepFocus} onClick={() => setOpen(!open)} disabled={!enabled} title="段落を編集中に使えます">
        図表を参照（図n）▾
      </button>
      {open && enabled && (
        <div className="menu" onMouseLeave={() => setOpen(false)}>
          {items.map((item) => (
            <button
              key={item.id}
              onMouseDown={keepFocus}
              onClick={() => {
                editor.insertReference(item.id)
                setOpen(false)
              }}
            >
              （{item.label}）を入れる
            </button>
          ))}
        </div>
      )}
    </span>
  )
}

const REMOVABLE: Partial<Record<string, string>> = {
  paragraph: 'この段落を削除',
  abstractParagraph: 'この段落を削除',
  subheading: 'この小見出しを削除',
  chapter: 'この大見出しを削除',
}

/** 入力欄を開いている段落・見出しを削除する */
function RemoveButton({ editor, snap }: Props) {
  const label = snap.editingKind ? REMOVABLE[snap.editingKind] : undefined
  if (!label || !snap.editingId) return null
  const id = snap.editingId
  return (
    <button
      className="danger"
      onMouseDown={keepFocus}
      onClick={() => {
        if (snap.editingKind === 'chapter' && !confirm('大見出しを削除すると、その中の小見出し・段落・図表もすべて消えます。削除しますか？\n（「元に戻す」で戻せます）')) return
        editor.removeBlock(id)
      }}
    >
      {label}
    </button>
  )
}

export function Toolbar({ editor, snap }: Props) {
  const { selection, editingKind } = snap

  if (selection?.kind === 'figure') {
    const figureId = selection.id
    return (
      <div className="toolbar">
        <span className="context">図を選んでいます</span>
        <button onClick={() => void editor.replaceFigureImage(figureId)}>画像を差し替え</button>
        <button onClick={() => void editor.addFigureBeside(figureId)}>横にもう1枚並べる</button>
        <button className="danger" onClick={() => editor.removeSelected()}>
          この図を削除
        </button>
        <span className="sep" />
        <button onClick={() => editor.select(null)}>選択を解除</button>
        <span className="hint">図のタイトルは、紙面のタイトルをクリックして入力します</span>
      </div>
    )
  }
  if (selection?.kind === 'table') {
    const tableId = selection.id
    return (
      <div className="toolbar">
        <span className="context">素材表を選んでいます</span>
        <button onClick={() => editor.addTableRow(tableId)}>行を追加</button>
        <button onClick={() => editor.removeTableRow(tableId)}>最後の行を削除</button>
        <button className="danger" onClick={() => editor.removeSelected()}>
          この表を削除
        </button>
        <span className="sep" />
        <button onClick={() => editor.select(null)}>選択を解除</button>
        <span className="hint">生地見本の欄をクリックすると写真を選べます</span>
      </div>
    )
  }
  if (selection?.kind === 'photos') {
    const layouts: WorkPhotoLayout[] = [1, 2, 3, 4, 6]
    return (
      <div className="toolbar">
        <span className="context">作品写真の並べ方</span>
        {layouts.map((n) => (
          <button key={n} className={snap.report.workPhotos.layout === n ? 'on' : ''} onClick={() => editor.setPhotoLayout(n)}>
            {n}枚
          </button>
        ))}
        <span className="sep" />
        <span className="hint">枠をクリックして写真を選びます（自分で撮影した写真を6枚まで。文字は入れられません）</span>
      </div>
    )
  }
  const inBody = !editingKind || ['chapter', 'subheading', 'paragraph', 'figureCaption', 'tableCaption', 'tableCell'].includes(editingKind)
  return (
    <div className="toolbar">
      <button onMouseDown={keepFocus} onClick={() => editor.addParagraph()} disabled={!inBody}>
        ＋ 段落
      </button>
      <button onMouseDown={keepFocus} onClick={() => editor.addSubheading()} disabled={!inBody}>
        ＋ 小見出し
      </button>
      <button onMouseDown={keepFocus} onClick={() => editor.addChapter()} disabled={!inBody}>
        ＋ 大見出し
      </button>
      <span className="sep" />
      <button onMouseDown={keepFocus} onClick={() => void editor.addFigure()} disabled={!inBody}>
        ＋ 図（写真）
      </button>
      <button onMouseDown={keepFocus} onClick={() => editor.addMaterialTable()} disabled={!inBody}>
        ＋ 素材表
      </button>
      <span className="sep" />
      <ReferenceMenu editor={editor} snap={snap} />
      <RemoveButton editor={editor} snap={snap} />
      <span className="hint">
        {editingKind === 'abstractParagraph'
          ? '抄録：本文の内容を600〜900字にまとめます'
          : editingKind === 'field'
            ? '表紙の項目：Enter で確定します'
            : '紙面の文字をクリックすると、その場で書けます'}
      </span>
    </div>
  )
}
