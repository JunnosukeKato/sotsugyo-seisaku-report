import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { EditorSnapshot, ReportEditor } from '../editor/reportEditor'
import { figurePairing, figurePlacement } from '../editor/reportOps'
import type { TableBlock } from '../model/types'
import { PHOTO_ARRANGEMENTS, photoGrid, photoPageName } from '../model/photos'
import { SELECTION_TEXTS } from '../editor/selectionBar'
import { Icon } from './icons'
import { useAsk } from './ask'
import { TableSizeMenu } from './TableSize'
import { ShapeFace, TableShapeSheet, TableShapeTool } from './tableShape'
import { keepFocus, PAGE_CONTEXT, TOC_PALETTE_NOTE } from './uiShared'

/** マウスの指の絵（目次の行を押せること。mockups/v41 案C） */
const TOC_HAND = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinejoin="round" aria-hidden="true">
    <path d="M9.2 3.2a1.5 1.5 0 0 1 3 0v6.9h.4V8.6a1.5 1.5 0 0 1 3 0v1.9h.3V9.6a1.5 1.5 0 0 1 3 0v6.2a5.6 5.6 0 0 1-5.6 5.6h-1.6a5.6 5.6 0 0 1-4.6-2.4l-3.3-4.7a1.5 1.5 0 0 1 2.3-1.9l1.7 1.9h.4z" />
  </svg>
)

/**
 * 紙面の左わきに置く道具。表示しているページの種類と、書いている物・選んでいる物に合わせて入れ替わる。
 * 上から：ページの名前とひとこと／足す道具／選んでいる物の道具／元に戻す・やり直す
 */

interface Props {
  editor: ReportEditor
  snap: EditorSnapshot
  onReferences: () => void
  /**
   * ひな形を作る画面（mockups/v44 案A）：写真・セルの画像を入れる道具は出さない（図は空の枠、写真は学生が入れる）。
   * 表紙・作品写真のページは「見るだけ」（ひな形に入らない）
   */
  template?: boolean
}

/** ひな形を作る画面の、ページの名前の下のひとこと（言葉の切れ目で折り返す。1字だけの行にしない） */
const TEMPLATE_CONTEXT: Partial<Record<string, string>> = {
  cover: '学生が書く所\n（見るだけ）',
  abstract: '書き出しの\n例を書く',
  photos: '学生が\n入れる所\n（見るだけ）',
}

function Tool({
  label,
  icon,
  onClick,
  danger,
  disabled,
  title,
  onPreview,
  className,
  onWhy,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
  title?: string
  /** マウスを重ねたとき、紙面に入る位置を示す */
  onPreview?: (on: boolean) => void
  className?: string
  /**
   * 押せないときに押したら、押せないわけ（title）を知らせる（スマホ：マウスを重ねて title を見られないため。学生の試し 2026-10-24。mockups/v53 ⑧）。
   * 渡したときは、押せない形（薄い）のまま押せるボタンにする
   */
  onWhy?: (why: string) => void
}) {
  const why = disabled && onWhy && title ? onWhy : undefined
  return (
    <button
      className={`tb${danger ? ' danger' : ''}${className ? ` ${className}` : ''}${why ? ' why-off' : ''}`}
      title={title ?? label.replace(/\n/g, '')}
      disabled={disabled && !why}
      aria-disabled={why ? true : undefined}
      onMouseDown={keepFocus}
      onMouseEnter={() => onPreview?.(true)}
      onMouseLeave={() => onPreview?.(false)}
      onClick={() => {
        onPreview?.(false)
        if (why) return why(title!)
        onClick()
      }}
    >
      {icon}
      {/* 名前の \n：パソコンの左の道具（幅が狭い）で、言葉の切れ目で折り返す（1字だけ次の行に残らないように）。スマホの道具の帯では1行 */}
      <span>{label.includes('\n') ? label.split('\n').map((line, i) => <span key={i} className="tb-line">{line}</span>) : label}</span>
    </button>
  )
}

/** 表を入れる：ます目で大きさを選んで空の表を入れるか、素材表のひな形を入れる（mockups/v35 ②。メニューの中身は TableSize.tsx） */
function TableMenu({ editor, disabled, template }: { editor: ReportEditor; disabled: boolean; template?: boolean }) {
  const [open, setOpen] = useState(false)
  const title = template ? 'この段落のすぐ下に表が入ります（見出しの行を書きます。中身は学生が書きます）' : '書いている文の終わりに「（表n）」が入り、この段落のすぐ下に表が入ります'
  return (
    <div className="menu-wrap">
      <Tool label="表を入れる" icon={Icon.table} title={title} disabled={disabled} onClick={() => setOpen(!open)} />
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
 * 紙面の右下の「元に戻す」「やり直す」（ViewBar の中。前は左の道具のいちばん下にあったが、低い画面で道具が入りきらず隠れたため移した：mockups/v47 案C）。
 * マウスを乗せる（キーボードで移る）と、少しして、ボタンの上に黒い吹き出しでキーボードでの押し方を出す（画面に重ねて出す）
 */
function UndoRedo({ editor, snap }: { editor: ReportEditor; snap: EditorSnapshot }) {
  const [tip, setTip] = useState<{ lines: string[]; left: number; top: number } | null>(null)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  const show = (el: HTMLElement, lines: string[]) => {
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const r = el.getBoundingClientRect()
      setTip({ lines, left: r.left + r.width / 2, top: r.top - 8 })
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
        <div className="ur-tip above" role="tooltip" style={{ left: tip.left, top: tip.top }}>
          {tip.lines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 紙面の右下の道具：「元に戻す」「やり直す」と、表示の大きさ（全体／見開き／拡大。mockups/v35 ③ 案A。見開きは、台が狭いときは出さない）。
 * 学生のツール（App）と、ひな形を作る画面（TemplateApp）で使う
 */
export function ViewBar({ editor, snap }: { editor: ReportEditor; snap: EditorSnapshot }) {
  return (
    <div className="view-bar">
      <UndoRedo editor={editor} snap={snap} />
      <div className="zoom" role="group" aria-label="表示の大きさ">
        <button className={!snap.zoomed && !snap.spread ? 'on' : ''} aria-pressed={!snap.zoomed && !snap.spread} title="1ページずつ、ページ全体を表示" onClick={() => editor.setView('fit')}>
          {/* 前は「全体」。見開きもページ全体が見えるので、何ページ見えるかの名前にした（依頼者の選択 2026-10-24） */}
          {Icon.fit}1ページ
        </button>
        {(snap.spreadFits || snap.spread) && (
          <button className={snap.spread ? 'on' : ''} aria-pressed={snap.spread} title="いまのページと次のページを並べて表示（2ページずつめくる）" onClick={() => editor.setView('spread')}>
            {Icon.spread}見開き
          </button>
        )}
        <button className={snap.zoomed ? 'on' : ''} aria-pressed={snap.zoomed} title="文字を大きく表示（マウスのホイールで上下に動かす）" onClick={() => editor.setView('zoom')}>
          {Icon.zoom}拡大
        </button>
      </div>
    </div>
  )
}

/**
 * 作品写真のスイッチ「全体を入れる（切らない）」（mockups/v32 ③ 案A）。その写真だけ、枠の中に全体を入れる（まわりは白）。
 * 切ると、今までどおり枠いっぱいに切り抜く（つかんでずらすと、トリミングを調整できる）
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

/** スマホの、表を選んだときの下の道具の「表の形」：押すと、下から欄が出る（app/tableShape.tsx の TableShapeSheet） */
function ShapeSheetButton({ editor, table, tableId }: { editor: ReportEditor; table: TableBlock; tableId: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className={`tb shape-btn${open ? ' open' : ''}`} aria-haspopup="dialog" aria-expanded={open} title="列の幅・項目の列・行の高さを、絵を見て選ぶ" onMouseDown={keepFocus} onClick={() => setOpen(true)}>
        <ShapeFace />
      </button>
      {open && <TableShapeSheet editor={editor} table={table} tableId={tableId} onClose={() => setOpen(false)} />}
    </>
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
export function SelectionTools({ editor, snap, phone, template }: SelectionToolsProps) {
  const ask = useAsk()
  const { editingKind, editingId, selection, report } = snap
  const kind = snap.layout?.kinds[snap.page]

  // ひな形を作る画面：作品写真は学生が入れる（道具は出さない）
  if (kind === 'photos' && template) return null
  if (kind === 'photos') {
    // 何ページ目の作品写真か（写真を押して選んでいれば、その写真のページ。mockups/v38 案A）
    const page = selection?.kind === 'photos' ? selection.page : (snap.photoPage ?? 0)
    const photos = report.workPhotos[page] ?? report.workPhotos[0]
    const current = photoGrid(photos)
    // 押して選んだ写真（写真が入っている枠だけ。図と同じく「差し替え」「外す」を出す。mockups/v23 ⑧ 案A）
    const photo = selection?.kind === 'photos' && selection.index !== undefined && selection.index < photos.layout && photos.imageIds[selection.index] ? selection.index : null
    const photoTools = photo !== null && (
      <div className="group ctx">
        <div className="ctx-label">{phone ? `この写真（${photo + 1}枚目）` : 'この写真'}</div>
        <Tool label="差し替え" icon={Icon.replace} title={`${photo + 1}枚目の写真を選び直す`} onClick={() => void editor.setPhoto(page, photo)} />
        <Tool
          label="外す"
          icon={Icon.remove}
          danger
          title={`${photo + 1}枚目の写真を外す（枠を空にする）`}
          onClick={() => editor.removePhoto(page, photo)}
        />
        <WholeSwitch on={photos.whole?.[photo] === true} index={photo} onToggle={(on) => editor.setPhotoWhole(page, photo, on)} />
      </div>
    )
    if (phone && photoTools) return photoTools
    // 写真のページを足す・消す（mockups/v38 案A）。ページ数の上限（学科の設定）に達していたら足せない。1ページだけのときは消せない
    const pageCount = report.workPhotos.length
    const canAdd = editor.canAddPhotoPage()
    const max = editor.maxPhotoPages
    const pageTools = (
      <>
        <Tool
          label={phone ? 'ページを\n足す' : '写真の\nページを足す'}
          icon={Icon.photoPageAdd}
          title={canAdd ? '作品写真のページを、このページの後ろに1つ足す（このページと同じ並べ方）' : `作品写真は${max}ページまでです`}
          disabled={!canAdd}
          onClick={() => void editor.addPhotoPage(page)}
        />
        <Tool
          label={phone ? 'ページを\n消す' : 'この\nページを消す'}
          icon={Icon.remove}
          danger
          title={pageCount > 1 ? 'このページを、中の写真ごと消す（「戻す」で戻せます）' : '作品写真のページが1つだけのときは、消せません'}
          disabled={pageCount <= 1}
          onClick={() => void editor.removePhotoPage(page)}
        />
      </>
    )
    return (
      <>
        {photoTools}
        <div className="group ctx photo-arrange">
          <div className="ctx-label">並べ方</div>
          <div className="layouts">
            {PHOTO_ARRANGEMENTS.map((a) => (
              <button
                key={a.label}
                className={`lay${current === a ? ' on' : ''}`}
                aria-pressed={current === a}
                title={`${a.label}（つかんでずらして、トリミングを調整）`}
                onClick={() => editor.setPhotoLayout(page, a.layout, a.columns)}
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
          {/* 並べ方の枠の中は1行6字ほど。言葉の切れ目で折り返す（1字だけ次の行に残らないように。言葉は依頼者の判断） */}
          <div className="ctx-note">
            つかんで
            <br />
            ずらして、
            <br />
            トリミングを
            <br />
            調整
          </div>
          {/* スマホ：並べ方の横に、区切りの線と「ページを足す」「ページを消す」（下の道具は1列に並べるため） */}
          {phone && (
            <>
              <span className="photo-pages-sep" aria-hidden="true" />
              {pageTools}
            </>
          )}
        </div>
        {!phone && (
          <div className="group ctx photo-pages">
            <div className="ctx-label">ページ</div>
            {pageTools}
          </div>
        )}
      </>
    )
  }

  const figureId = selection?.kind === 'figure' ? selection.id : editingKind === 'figureCaption' ? editingId : null
  if (figureId) {
    const place = figurePlacement(report, figureId)
    const pairing = figurePairing(report, figureId)
    return (
      <div className="group ctx">
        <div className="ctx-label">この図</div>
        {/* ひな形を作る画面では、写真は選ばない（図は空の枠。写真は学生が入れる） */}
        {!template && <Tool label="差し替え" icon={Icon.replace} title="写真を差し替える" onClick={() => void editor.replaceFigureImage(figureId)} />}
        {!template && <Tool label="もう1枚" icon={Icon.beside} title="この図のすぐ後ろにもう1枚入れる（本文の参照の後ろにも「（図n）」が入ります）" onClick={() => void editor.addFigureBeside(figureId)} />}
        {/* 1つ上へ・1つ下へ（段落・表を1つずつ越える。小見出しの中だけ。上は本文の（図n）の段落まで。依頼者の選択 2026-10-23・24） */}
        <Tool label="上へ" className="tb-move" icon={Icon.moveUp} title={place.up ? 'この図を、1つ上（前の段落などの上）へ動かす（図の番号は、紙面の順にそろいます）' : '図は、本文の「（図n）」がある段落より上・小見出しの外には動かせません'} disabled={!place.up} onWhy={phone ? (why) => editor.showNotice(why) : undefined} onClick={() => void editor.moveFigure(figureId, 'up')} />
        <Tool label="下へ" className="tb-move" icon={Icon.moveDown} title={place.down ? 'この図を、1つ下（次の段落などの下）へ動かす（図の番号は、紙面の順にそろいます）' : '図は、小見出しの外には動かせません'} disabled={!place.down} onWhy={phone ? (why) => editor.showNotice(why) : undefined} onClick={() => void editor.moveFigure(figureId, 'down')} />
        {/* 図の置き場所（依頼者の選択 2026-10-22 案A）：小見出しのまとまりのいちばん下へ。そこにあれば、参照している段落の下へ戻す。
            スマホの帯は、1列に入る5つ（差し替え・もう1枚・上へ・下へ・削除。依頼者の選択 2026-10-23 の見本）にするので出さない */}
        {phone ? null : place.toSectionEnd ? (
          <Tool label={'小見出しの\n終わりへ'} icon={Icon.toSectionEnd} title="この図を、小見出しのまとまりのいちばん下へ動かす（図の番号は、紙面の順にそろいます）" onClick={() => void editor.moveFigure(figureId, 'sectionEnd')} />
        ) : place.toParagraph ? (
          <Tool label={'段落の下へ\n戻す'} icon={Icon.toParagraph} title="この図を、この図のことを書いた段落のすぐ下へ戻す" onClick={() => void editor.moveFigure(figureId, 'paragraph')} />
        ) : null}
        {/* 並んでいる図は「並びから外す」、1枚だけの図がすぐ上・下に続くときは「横に並べる」（依頼者の選択 2026-10-24：帯に1つ足す） */}
        {pairing.split && <Tool label={'並びから\n外す'} className="tb-pair" icon={Icon.splitRow} title="この図を並びから外して、1枚ずつの図にする（図の番号はそのまま）" onClick={() => void editor.splitFigure(figureId)} />}
        {!pairing.split && pairing.join && (
          <Tool label={'横に\n並べる'} className="tb-pair" icon={Icon.joinRow} title={pairing.join === 'above' ? 'すぐ上の図と、横に並べる' : 'すぐ下の図と、横に並べる'} onClick={() => void editor.joinFigure(figureId)} />
        )}
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

  // 表のセルの画像（依頼者の選択 2026-10-23 案A：必要なときだけ切り抜く）
  if (selection?.kind === 'cellImage') {
    const cellId = selection.id
    const { crop } = editor.cellImageState(cellId)
    return (
      <div className="group ctx">
        <div className="ctx-label">この画像</div>
        <Tool label="差し替え" icon={Icon.replace} title="この画像を選び直す" onClick={() => void editor.replaceCellImageAt(cellId)} />
        {crop ? (
          <Tool label="全体に戻す" icon={Icon.whole} title="切り抜くのをやめて、画像の全体を入れる" onClick={() => editor.setCellCropOn(cellId, false)} />
        ) : (
          <Tool label="切り抜く" icon={Icon.crop} title="マスいっぱいに広げて、写る所をずらして選べるようにする" onClick={() => editor.setCellCropOn(cellId, true)} />
        )}
        <Tool label="外す" icon={Icon.remove} danger title="この画像を外す（マスの文字は残ります）" onClick={() => editor.removeCellImageAt(cellId)} />
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
        {/* 画像は、書いているマス1つに入れるので、表全体を変える道具（行・列・表の形・削除）より前に置く（依頼者の判断） */}
        {/* マスを書いていないとき（表を選んでいる・表のタイトルを書いている）も、薄くして同じ所に出す（あるときとないときで、下のボタンの位置がずれて押し間違えていた：mockups/v47） */}
        {!template &&
          (editingKind !== 'tableCell' ? (
            <Tool label="画像を入れる" icon={Icon.image} title="マスを書いているときに、そのマスに画像（生地見本など）を入れます" disabled onClick={() => {}} />
          ) : editor.currentCellHasImage(tableId) ? (
            <Tool label="画像を外す" icon={Icon.image} title="このセルの画像を外す" onClick={() => editor.removeCellImage(tableId)} />
          ) : (
            <Tool label="画像を入れる" icon={Icon.image} title="このセルに画像（生地見本など）を入れる" onClick={() => void editor.setCellImage(tableId)} />
          ))}
        <Tool label="行を足す" icon={Icon.rowAdd} title="書いているセルの行の下に、行を足す" onClick={() => editor.addTableRow(tableId)} />
        <Tool label="列を足す" icon={Icon.colAdd} title="書いているセルの列の右に、列を足す" onClick={() => editor.addTableColumn(tableId)} />
        <Tool label="行を消す" icon={Icon.rowRemove} title="書いているセルの行を消す（見出しの行は消せません）" onClick={() => editor.removeTableRow(tableId)} />
        <Tool label="列を消す" icon={Icon.colRemove} title="書いているセルの列を消す" onClick={() => editor.removeTableColumn(tableId)} />
        {/* 表の形（列の幅・項目の列・行の高さ）は、ボタン1つ。パソコンは左の道具のとなりに窓、スマホは下から出る欄で、絵を見て選ぶ（mockups/v45 案A。app/tableShape.tsx） */}
        {phone ? <ShapeSheetButton editor={editor} table={table} tableId={tableId} /> : <TableShapeTool editor={editor} table={table} tableId={tableId} />}
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

  // 紙面で文を選んでいる：コピー・切り取り・削除（Ctrl+C・Ctrl+X・Delete と同じ。mockups/v36 案B）
  if (!editingId && snap.textRange) {
    return (
      <div className="group ctx sel-tools">
        <div className="ctx-label">{SELECTION_TEXTS.group}</div>
        <Tool label={SELECTION_TEXTS.copy.label} icon={Icon.copy} title={SELECTION_TEXTS.copy.title()} onClick={() => editor.copySelection()} />
        <Tool label={SELECTION_TEXTS.cut.label} icon={Icon.cut} title={SELECTION_TEXTS.cut.title()} onClick={() => editor.cutSelection()} />
        <Tool label={SELECTION_TEXTS.remove.label} icon={Icon.remove} danger title={SELECTION_TEXTS.remove.title()} onClick={() => editor.deleteSelection()} />
      </div>
    )
  }
  if (!editingId) return null
  // 紙面でコピーしたまとまりがあるときの「貼り付け」（Ctrl+V と同じ。コピーしていないときは出さない）
  const paste = snap.pasteReady && <Tool label={SELECTION_TEXTS.paste.label} icon={Icon.paste} title={SELECTION_TEXTS.paste.title()} onClick={() => editor.pasteFromTool()} />
  const remove = async () => {
    if (editingKind === 'chapter' && !(await ask.confirm('大見出しを削除すると、その中の小見出し・段落・図表もすべて消えます。削除しますか？\n（「元に戻す」で戻せます）', { ok: '削除する', danger: true }))) return
    editor.removeBlock(editingId)
  }
  if (editingKind === 'paragraph') {
    return (
      <div className="group ctx">
        <div className="ctx-label">この段落</div>
        {paste}
        <Tool label="削除" icon={Icon.remove} danger title="この段落を削除" onClick={remove} />
      </div>
    )
  }
  if (editingKind === 'abstractParagraph') {
    return (
      <div className="group ctx">
        <div className="ctx-label">この段落</div>
        {paste}
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

export function Palette({ editor, snap, onReferences, template }: Props) {
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
      {/* 低い画面では、ひとこと（span）を出さず、マウスを乗せると出す（title。index.css の「低い画面の左の道具」） */}
      <div className="p-head" title={(template && TEMPLATE_CONTEXT[kind]) || context.hint}>
        {/* 作品写真が何ページかあるときは「作品写真 2」（mockups/v38 案A） */}
        <b className={kind === 'photos' ? 'photo-name' : undefined}>{kind === 'photos' && snap.photoPage !== null ? photoPageName(snap.photoPage, snap.report.workPhotos.length) : context.name}</b>
        <span>{(template && TEMPLATE_CONTEXT[kind]) || context.hint}</span>
      </div>
      {/* 目次のページ：行を押すと、その見出しへ移れること（mockups/v41 案C） */}
      {kind === 'toc' && (
        <div className="group toc-note">
          {TOC_HAND}
          <span>{TOC_PALETTE_NOTE}</span>
        </div>
      )}
      {kind === 'body' && !onObject && (
        <>
          <div className="group">
            {/* 大きい順（大見出し → 小見出し）に並べる（依頼者の判断 2026-10-21） */}
            <Tool label="大見出し" icon={Icon.heading1} title="大見出し（Ⅰ．）を足す" onPreview={preview} onClick={() => editor.addChapter()} />
            <Tool label="小見出し" icon={Icon.heading2} title="小見出し（ⅰ．）を足す" onPreview={preview} onClick={() => editor.addSubheading()} />
            <Tool label="改ページ" icon={Icon.pageBreak} title="ここで改ページする（この後ろは次のページから始まります）" onPreview={preview} onClick={() => editor.addPageBreak()} />
          </div>
          <div className="group">
            <Tool
              label="図を入れる"
              icon={Icon.figure}
              title={template ? 'この段落のすぐ下に、図の枠が入ります（写真は学生が入れます）' : '書いている文の終わりに「（図n）」が入り、この段落のすぐ下に図が入ります'}
              disabled={!writing}
              onClick={() => void editor.addFigure()}
            />
            <TableMenu editor={editor} disabled={!writing} template={template} />
            {/* 道具の幅（1行6字ほど）で、言葉の切れ目で折り返す（1字だけ次の行に残らないように） */}
            {!writing && (
              <div className="ctx-note">
                図・表は、
                <br />
                入れたい所を
                <br />
                クリックして
                <br />
                から押します
              </div>
            )}
          </div>
        </>
      )}
      {kind === 'references' && (
        <div className="group">
          <Tool label="参考文献" icon={Icon.refs} title="引用・参考文献を編集する" onClick={onReferences} />
        </div>
      )}
      <SelectionTools editor={editor} snap={snap} template={template} />
    </nav>
  )
}
