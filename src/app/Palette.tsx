import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { EditorSnapshot, ReportEditor } from '../editor/reportEditor'
import { PHOTO_ARRANGEMENTS, photoGrid } from '../model/photos'
import { Icon } from './icons'
import { TableSizeMenu } from './TableSize'
import { keepFocus, PAGE_CONTEXT } from './uiShared'

/**
 * 紙面の左わきに置く道具。表示しているページの種類と、書いている物・選んでいる物に合わせて入れ替わる。
 * 上から：ページの名前とひとこと／足す道具／選んでいる物の道具／元に戻す・やり直す
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

/** 表を入れる：ます目で大きさを選んで空の表を入れるか、素材表のひな形を入れる（mockups/v35 ②。メニューの中身は TableSize.tsx） */
function TableMenu({ editor, disabled }: { editor: ReportEditor; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="menu-wrap">
      <Tool label="表を入れる" icon={Icon.table} title="書いている文の終わりに「（表n）」が入り、この段落のすぐ下に表が入ります" disabled={disabled} onClick={() => setOpen(!open)} />
      {open && !disabled && (
        <TableSizeMenu
          onPick={(size) => {
            setOpen(false)
            editor.addTable('blank', size)
          }}
          onMaterial={() => {
            setOpen(false)
            editor.addTable('material')
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

/** 「元に戻す」「やり直す」のキーボードでの押し方（マウスを乗せると出す。mockups/v35 ④ 案A） */
const UNDO_TIP = ['元に戻す（Ctrl+Z）']
const REDO_TIP = ['やり直す（Ctrl+Y）', 'Mac は ⌘+Shift+Z']

/**
 * 道具のいちばん下の「元に戻す」「やり直す」（mockups/v35 ④ 案A：いまの場所に2つ並べる）。
 * マウスを乗せる（キーボードで移る）と、少しして、ボタンの右に黒い吹き出しでキーボードでの押し方を出す
 * （道具が画面に入りきらず、道具の中を上下に動かすときも切れないよう、画面に重ねて出す）
 */
function UndoRedo({ editor, snap }: { editor: ReportEditor; snap: EditorSnapshot }) {
  const [tip, setTip] = useState<{ lines: string[]; left: number; top: number } | null>(null)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  const show = (el: HTMLElement, lines: string[]) => {
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const r = el.getBoundingClientRect()
      setTip({ lines, left: r.right + 10, top: r.top + r.height / 2 })
    }, 350)
  }
  const hide = () => {
    clearTimeout(timer.current)
    setTip(null)
  }
  const button = (label: string, icon: ReactNode, lines: string[], keys: string, enabled: boolean, run: () => void) => (
    <button
      className="tb"
      aria-label={lines.join(' ')}
      aria-keyshortcuts={keys}
      disabled={!enabled}
      onMouseDown={keepFocus}
      onPointerEnter={(e) => e.pointerType === 'mouse' && show(e.currentTarget, lines)}
      onPointerLeave={hide}
      onFocus={(e) => e.currentTarget.matches(':focus-visible') && show(e.currentTarget, lines)}
      onBlur={hide}
      onClick={() => {
        hide()
        run()
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
  return (
    <div className="group undo-redo">
      {button('元に戻す', Icon.undo, UNDO_TIP, 'Control+Z Meta+Z', snap.canUndo, () => editor.undo())}
      {button('やり直す', Icon.redo, REDO_TIP, 'Control+Y Control+Shift+Z Meta+Shift+Z', snap.canRedo, () => editor.redo())}
      {tip && (
        <div className="ur-tip" role="tooltip" style={{ left: tip.left, top: tip.top }}>
          {tip.lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 作品写真のスイッチ「全体を入れる（切らない）」（mockups/v32 ③ 案A）。その写真だけ、枠の中に全体を入れる（まわりは白）。
 * 切ると、今までどおり枠いっぱいに切り抜く（つかんで動かすと、見える位置を変えられる）
 */
function WholeSwitch({ on, index, onToggle }: { on: boolean; index: number; onToggle: (on: boolean) => void }) {
  return (
    <button
      className={`photo-sw${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on}
      title={on ? `${index + 1}枚目の写真は、全体を入れています（切ると、枠いっぱいに切り抜きます）` : `${index + 1}枚目の写真を、切らずに全体を枠の中に入れます（まわりは白）`}
      onMouseDown={keepFocus}
      onClick={() => onToggle(!on)}
    >
      <i aria-hidden="true" />
      <span>
        全体を入れる
        <br />
        （切らない）
      </span>
    </button>
  )
}

interface SelectionToolsProps extends Omit<Props, 'onReferences'> {
  /**
   * スマホの下の道具（横に1列に並べるので、作品写真を選んでいるときは「この写真」の道具だけを出す）。
   * 横向きのスマホの作品写真のページでは、同じ道具を紙面の右の列に出す（mockups/v33 案A。app/PageBand.tsx。並べ方は 3列×2段：index.css の「v33」）
   */
  phone?: boolean
}

/** 書いている物・選んでいる物の道具（削除する・外すと、画面の下に「戻す」の知らせが出る。UndoBar） */
export function SelectionTools({ editor, snap, phone }: SelectionToolsProps) {
  const { editingKind, editingId, selection, report } = snap
  const kind = snap.layout?.kinds[snap.page]

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
          onClick={() => editor.removePhoto(photo)}
        />
        <WholeSwitch on={report.workPhotos.whole?.[photo] === true} index={photo} onToggle={(on) => editor.setPhotoWhole(photo, on)} />
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
                aria-pressed={current === a}
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
          onClick={() => {
            editor.select({ kind: 'figure', id: figureId })
            editor.removeSelected()
          }}
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
          onClick={() => editor.removeSelected()}
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
        {phone ? (
          // スマホの下の道具：「そろえる」「中身に合わせる」を2つ並べると、指で押すには小さすぎた（高さ 21px）。
          // 書く欄の道具と同じく、いまの幅を出すボタン1つにして、押すたびに切り替える（高さ 44px 以上。index.css）
          <button
            className="tb width-toggle"
            title={table.widths === 'equal' ? '列の幅：そろえる（押すと、中身に合わせる）' : '列の幅：中身に合わせる（押すと、そろえる）'}
            onMouseDown={keepFocus}
            onClick={() => editor.setTableWidths(tableId, table.widths === 'equal' ? 'auto' : 'equal')}
          >
            <span>列の幅</span>
            {/* 「中身に合わせる」は、道具が画面の幅に入るよう、「中身に／合わせる」の2行にする */}
            <b>
              {table.widths === 'equal' ? (
                'そろえる'
              ) : (
                <>
                  中身に
                  <wbr />
                  合わせる
                </>
              )}
            </b>
          </button>
        ) : (
          <>
            <div className="ctx-label sub">列の幅</div>
            <div className="seg">
              {(['equal', 'auto'] as const).map((w) => (
                <button key={w} className={table?.widths === w ? 'on' : ''} aria-pressed={table?.widths === w} onMouseDown={keepFocus} onClick={() => editor.setTableWidths(tableId, w)}>
                  {w === 'equal' ? 'そろえる' : '中身に合わせる'}
                </button>
              ))}
            </div>
          </>
        )}
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
              title="書いている文の終わりに「（図n）」が入り、この段落のすぐ下に図が入ります"
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
      <UndoRedo editor={editor} snap={snap} />
    </nav>
  )
}
