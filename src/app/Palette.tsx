import { useState, type ReactNode } from 'react'
import type { EditorSnapshot, ReportEditor } from '../editor/reportEditor'
import { numbering } from '../editor/reportOps'
import type { WorkPhotoLayout } from '../model/types'
import { Icon } from './icons'
import { keepFocus, PAGE_CONTEXT } from './uiShared'

/**
 * 紙面の左わきに置く道具。表示しているページの種類と、書いている物・選んでいる物に合わせて入れ替わる。
 * 上から：ページの名前とひとこと／足す道具／選んでいる物の道具／元に戻す
 */

interface Props {
  editor: ReportEditor
  snap: EditorSnapshot
  onReferences: () => void
}

const PHOTO_LAYOUTS: WorkPhotoLayout[] = [1, 2, 3, 4, 6]

function Tool({
  label,
  icon,
  onClick,
  danger,
  disabled,
  title,
  onPreview,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  title?: string
  /** マウスを重ねたとき、紙面に入る位置を示す */
  onPreview?: (on: boolean) => void
}) {
  return (
    <button
      className={`tb${danger ? ' danger' : ''}`}
      title={title ?? label}
      disabled={disabled}
      onMouseDown={keepFocus}
      onMouseEnter={() => onPreview?.(true)}
      onMouseLeave={() => onPreview?.(false)}
      onClick={() => {
        onPreview?.(false)
        onClick()
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

/** 段落を書いているとき：カーソルの位置に「（図1）」などを入れる */
function ReferenceMenu({ editor, snap }: Omit<Props, 'onReferences'>) {
  const [open, setOpen] = useState(false)
  const n = numbering(snap.report)
  const items = [
    ...[...n.figureByNumber.entries()].map(([num, id]) => ({ id, label: `図${num}` })),
    ...[...n.tableByNumber.entries()].map(([num, id]) => ({ id, label: `表${num}` })),
  ]
  return (
    <div className="menu-wrap">
      <Tool label="図表を参照" icon={Icon.ref} title={items.length ? '文中に（図1）などを入れる' : 'まだ図・表がありません'} disabled={items.length === 0} onClick={() => setOpen(!open)} />
      {open && (
        <div className="side-menu" onMouseLeave={() => setOpen(false)}>
          <div className="side-menu-title">カーソルの位置に入れる</div>
          {items.map((item) => (
            <button
              key={item.id}
              onMouseDown={keepFocus}
              onClick={() => {
                editor.insertReference(item.id)
                setOpen(false)
              }}
            >
              （{item.label}）
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** 書いている物・選んでいる物の道具 */
export function SelectionTools({ editor, snap }: Omit<Props, 'onReferences'>) {
  const { editingKind, editingId, selection, report } = snap
  const kind = snap.layout?.kinds[snap.page]

  if (kind === 'photos') {
    return (
      <div className="group ctx">
        <div className="ctx-label">並べ方</div>
        <div className="layouts">
          {PHOTO_LAYOUTS.map((n) => (
            <button key={n} className={`lay${report.workPhotos.layout === n ? ' on' : ''}`} onClick={() => editor.setPhotoLayout(n)}>
              {n}枚
            </button>
          ))}
        </div>
      </div>
    )
  }

  const figureId = selection?.kind === 'figure' ? selection.id : editingKind === 'figureCaption' ? editingId : null
  if (figureId) {
    return (
      <div className="group ctx">
        <div className="ctx-label">この図</div>
        <Tool label="差し替え" icon={Icon.replace} title="写真を差し替える" onClick={() => void editor.replaceFigureImage(figureId)} />
        <Tool label="もう1枚" icon={Icon.beside} title="この図のすぐ後ろにもう1枚入れる（本文の参照の後ろにも「（図n）」が入ります）" onClick={() => void editor.addFigureBeside(figureId)} />
        <Tool
          label="削除"
          icon={Icon.remove}
          danger
          title="この図を削除（本文の「（図n）」も消えます）"
          onClick={() => {
            editor.select({ kind: 'figure', id: figureId })
            editor.removeSelected()
          }}
        />
      </div>
    )
  }

  const tableId = selection?.kind === 'table' ? selection.id : editingId && (editingKind === 'tableCaption' || editingKind === 'tableCell') ? editor.tableIdOf(editingId) : null
  if (tableId) {
    return (
      <div className="group ctx">
        <div className="ctx-label">この表</div>
        <Tool label="行を追加" icon={Icon.rowAdd} onClick={() => editor.addTableRow(tableId)} />
        <Tool label="行を削除" icon={Icon.rowRemove} title="最後の行を削除" onClick={() => editor.removeTableRow(tableId)} />
        <Tool
          label="削除"
          icon={Icon.remove}
          danger
          title="この表を削除"
          onClick={() => {
            editor.select({ kind: 'table', id: tableId })
            editor.removeSelected()
          }}
        />
      </div>
    )
  }

  if (!editingId) return null
  const remove = () => {
    if (editingKind === 'chapter' && !confirm('大見出しを削除すると、その中の小見出し・段落・図表もすべて消えます。削除しますか？\n（「元に戻す」で戻せます）')) return
    editor.removeBlock(editingId)
  }
  if (editingKind === 'paragraph') {
    return (
      <div className="group ctx">
        <div className="ctx-label">この段落</div>
        <ReferenceMenu editor={editor} snap={snap} />
        <Tool label="削除" icon={Icon.remove} danger title="この段落を削除" onClick={remove} />
      </div>
    )
  }
  if (editingKind === 'abstractParagraph') {
    return (
      <div className="group ctx">
        <div className="ctx-label">この段落</div>
        <Tool label="削除" icon={Icon.remove} danger title="この段落を削除" onClick={remove} />
      </div>
    )
  }
  if (editingKind === 'chapter' || editingKind === 'subheading') {
    return (
      <div className="group ctx">
        <div className="ctx-label">この見出し</div>
        <Tool label="削除" icon={Icon.remove} danger title={editingKind === 'chapter' ? 'この大見出しを削除（中の段落なども消えます）' : 'この小見出しを削除'} onClick={remove} />
      </div>
    )
  }
  return null
}

export function Palette({ editor, snap, onReferences }: Props) {
  const kind = snap.layout?.kinds[snap.page] ?? 'unknown'
  const context = PAGE_CONTEXT[kind]
  const preview = (on: boolean) => editor.previewInsert(on)
  return (
    <nav className="palette" aria-label="道具">
      <div className="p-head">
        <b>{context.name}</b>
        <span>{context.hint}</span>
      </div>
      {kind === 'body' && (
        <>
          <div className="group">
            <Tool label="段落" icon={Icon.paragraph} title="段落を足す" onPreview={preview} onClick={() => editor.addParagraph()} />
            <Tool label="小見出し" icon={Icon.heading2} title="小見出し（ⅰ．）を足す" onPreview={preview} onClick={() => editor.addSubheading()} />
            <Tool label="大見出し" icon={Icon.heading1} title="大見出し（Ⅰ．）を足す" onPreview={preview} onClick={() => editor.addChapter()} />
          </div>
          <div className="group">
            <Tool
              label="図を入れる"
              icon={Icon.figure}
              title={snap.editingKind === 'paragraph' ? '書いている位置に「（図n）」が入り、この段落のすぐ下に図が入ります' : '図（写真）を入れる（段落を書いている途中で押すと、その位置に「（図n）」も入ります）'}
              onPreview={snap.editingKind === 'paragraph' ? undefined : preview}
              onClick={() => void editor.addFigure()}
            />
            <Tool label="素材表" icon={Icon.table} title="使用素材表を入れる" onPreview={preview} onClick={() => editor.addMaterialTable()} />
            <Tool label="参考文献" icon={Icon.refs} title="引用・参考文献を編集する" onClick={onReferences} />
          </div>
        </>
      )}
      {kind === 'references' && (
        <div className="group">
          <Tool label="参考文献" icon={Icon.refs} title="引用・参考文献を編集する" onClick={onReferences} />
        </div>
      )}
      <SelectionTools editor={editor} snap={snap} />
      <div className="group">
        <Tool label="元に戻す" icon={Icon.undo} title="元に戻す（Ctrl+Z）" disabled={!snap.canUndo} onClick={() => editor.undo()} />
      </div>
    </nav>
  )
}
