import { useState, type ReactNode } from 'react'
import type { EditorSnapshot, ReportEditor } from '../editor/reportEditor'
import { PHOTO_ARRANGEMENTS, photoGrid } from '../model/photos'
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

/** 表を入れる：空の表か、素材表のひな形かを選ぶ */
function TableMenu({ editor, disabled }: { editor: ReportEditor; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="menu-wrap">
      <Tool label="表を入れる" icon={Icon.table} title="書いている位置に「（表n）」が入り、この段落のすぐ下に表が入ります" disabled={disabled} onClick={() => setOpen(!open)} />
      {open && !disabled && (
        <div className="side-menu" onMouseLeave={() => setOpen(false)}>
          <div className="side-menu-title">どの表を入れますか</div>
          <button onMouseDown={keepFocus} onClick={() => { setOpen(false); editor.addTable('blank') }}>
            空の表（2列）
          </button>
          <button onMouseDown={keepFocus} onClick={() => { setOpen(false); editor.addTable('material') }}>
            素材表（名称・使用箇所・生地見本）
          </button>
        </div>
      )}
    </div>
  )
}

interface SelectionToolsProps extends Omit<Props, 'onReferences'> {
  /** スマホの下の道具（横に1列に並べるので、作品写真を選んでいるときは「この写真」の道具だけを出す） */
  phone?: boolean
  /** 図・表・改ページを削除した、作品写真を外した（スマホは、画面の下に「戻す」の知らせを出す） */
  onRemoved?: (message: string) => void
}

/** 書いている物・選んでいる物の道具 */
export function SelectionTools({ editor, snap, phone, onRemoved }: SelectionToolsProps) {
  const { editingKind, editingId, selection, report } = snap
  const kind = snap.layout?.kinds[snap.page]
  /** 削除する（外す）。原稿が変わったら、onRemoved で知らせる */
  const removing = (message: string, run: () => void) => {
    const before = editor.getSnapshot().report
    run()
    if (editor.getSnapshot().report !== before) onRemoved?.(message)
  }

  if (kind === 'photos') {
    const current = photoGrid(report.workPhotos)
    // 押して選んだ写真（写真が入っている枠だけ。図と同じく「差し替え」「外す」を出す。mockups/v23 ⑧ 案A）
    const photo = selection?.kind === 'photos' && selection.index !== undefined && selection.index < report.workPhotos.layout && report.workPhotos.imageIds[selection.index] ? selection.index : null
    const photoTools = photo !== null && (
      <div className="group ctx">
        <div className="ctx-label">{phone ? `この写真（${photo + 1}枚目）` : 'この写真'}</div>
        <Tool label="差し替え" icon={Icon.replace} title={`${photo + 1}枚目の写真を選び直す`} onClick={() => void editor.setPhoto(photo)} />
        <Tool
          label="外す"
          icon={Icon.remove}
          danger
          title={`${photo + 1}枚目の写真を外す（枠を空にする）`}
          onClick={() => removing('写真を外しました', () => editor.removePhoto(photo))}
        />
      </div>
    )
    if (phone && photoTools) return photoTools
    return (
      <>
        {photoTools}
        <div className="group ctx">
          <div className="ctx-label">並べ方</div>
          <div className="layouts">
            {PHOTO_ARRANGEMENTS.map((a) => (
              <button
                key={a.label}
                className={`lay${current === a ? ' on' : ''}`}
                title={`${a.label}（写真をつかんで動かすと、見える位置を変えられます）`}
                onClick={() => editor.setPhotoLayout(a.layout, a.columns)}
              >
                <span className="lay-grid" style={{ gridTemplate: `repeat(${a.rows}, 1fr) / repeat(${a.columns}, 1fr)` }}>
                  {Array.from({ length: a.layout }, (_, i) => (
                    <i key={i} />
                  ))}
                </span>
                <span className="lay-n">{a.layout}枚</span>
                {a.arrange && <span className="lay-sub">{a.arrange}</span>}
              </button>
            ))}
          </div>
          <div className="ctx-note">写真をつかんで動かすと、見える位置を変えられます</div>
        </div>
      </>
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
          onClick={() =>
            removing('図を削除しました', () => {
              editor.select({ kind: 'figure', id: figureId })
              editor.removeSelected()
            })
          }
        />
      </div>
    )
  }

  if (selection?.kind === 'pageBreak') {
    return (
      <div className="group ctx">
        <div className="ctx-label">改ページ</div>
        <Tool
          label="削除"
          icon={Icon.remove}
          danger
          title="この改ページを削除"
          onClick={() => removing('改ページを削除しました', () => editor.removeSelected())}
        />
      </div>
    )
  }

  const tableId = selection?.kind === 'table' ? selection.id : editingId && (editingKind === 'tableCaption' || editingKind === 'tableCell') ? editor.tableIdOf(editingId) : null
  const table = tableId ? snap.report.body.flatMap((c) => c.blocks).find((b) => b.type === 'table' && b.id === tableId) : undefined
  if (tableId && table?.type === 'table') {
    return (
      <div className="group ctx">
        <div className="ctx-label">この表</div>
        <Tool label="行を足す" icon={Icon.rowAdd} title="書いているセルの行の下に、行を足す" onClick={() => editor.addTableRow(tableId)} />
        <Tool label="列を足す" icon={Icon.colAdd} title="書いているセルの列の右に、列を足す" onClick={() => editor.addTableColumn(tableId)} />
        {editingKind === 'tableCell' &&
          (editor.currentCellHasImage(tableId) ? (
            <Tool label="画像を外す" icon={Icon.image} title="このセルの画像を外す" onClick={() => editor.removeCellImage(tableId)} />
          ) : (
            <Tool label="画像を入れる" icon={Icon.image} title="このセルに画像（生地見本など）を入れる" onClick={() => void editor.setCellImage(tableId)} />
          ))}
        <Tool label="行を消す" icon={Icon.rowRemove} title="書いているセルの行を消す（見出しの行は消せません）" onClick={() => editor.removeTableRow(tableId)} />
        <Tool label="列を消す" icon={Icon.colRemove} title="書いているセルの列を消す" onClick={() => editor.removeTableColumn(tableId)} />
        <div className="ctx-label sub">列の幅</div>
        <div className="seg">
          {(['equal', 'auto'] as const).map((w) => (
            <button key={w} className={table?.widths === w ? 'on' : ''} aria-pressed={table?.widths === w} onMouseDown={keepFocus} onClick={() => editor.setTableWidths(tableId, w)}>
              {w === 'equal' ? 'そろえる' : '中身に合わせる'}
            </button>
          ))}
        </div>
        <Tool
          label="削除"
          icon={Icon.remove}
          danger
          title="この表を削除"
          onClick={() =>
            removing('表を削除しました', () => {
              editor.select({ kind: 'table', id: tableId })
              editor.removeSelected()
            })
          }
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
  // 図・表は、段落を書いているとき（文中の入れたい位置にカーソルがあるとき）だけ入れられる
  const writing = snap.editingKind === 'paragraph'
  const kind = snap.layout?.kinds[snap.page] ?? 'unknown'
  const context = PAGE_CONTEXT[kind]
  const preview = (on: boolean) => editor.previewInsert(on)
  // 図・表・改ページを選んでいる（表のセルや図のタイトルを書いている）ときは、その物の道具だけを出す
  // （本文に足す道具まで並べると、ノートパソコンの画面では表の「削除」「元に戻す」が下にはみ出して押せなかったため）
  const onObject = !!snap.selection || ['tableCell', 'tableCaption', 'figureCaption'].includes(snap.editingKind ?? '')
  return (
    <nav className={`palette${onObject ? ' compact' : ''}`} aria-label="道具">
      <div className="p-head">
        <b>{context.name}</b>
        <span>{context.hint}</span>
      </div>
      {kind === 'body' && !onObject && (
        <>
          <div className="group">
            <Tool label="小見出し" icon={Icon.heading2} title="小見出し（ⅰ．）を足す" onPreview={preview} onClick={() => editor.addSubheading()} />
            <Tool label="大見出し" icon={Icon.heading1} title="大見出し（Ⅰ．）を足す" onPreview={preview} onClick={() => editor.addChapter()} />
            <Tool label="改ページ" icon={Icon.pageBreak} title="ここで改ページする（この後ろは次のページから始まります）" onPreview={preview} onClick={() => editor.addPageBreak()} />
          </div>
          <div className="group">
            <Tool
              label="図を入れる"
              icon={Icon.figure}
              title="書いている位置に「（図n）」が入り、この段落のすぐ下に図が入ります"
              disabled={!writing}
              onClick={() => void editor.addFigure()}
            />
            <TableMenu editor={editor} disabled={!writing} />
            {!writing && <div className="ctx-note">図・表は、文中の入れたい位置をクリックしてから押します</div>}
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
