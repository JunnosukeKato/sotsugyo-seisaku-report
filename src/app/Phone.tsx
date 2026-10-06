import { useState, type ReactNode } from 'react'
import type { YearConfig } from '../config'
import type { EditorSnapshot, ReportEditor } from '../editor/reportEditor'
import { findEditable, numbering, type EditableKind } from '../editor/reportOps'
import { Icon } from './icons'
import { SelectionTools } from './Palette'
import { CheckBody, DeadlineChip, PageThumbs, SaveChip, SourceNotice, Tally } from './SidePanel'
import { keepFocus, PAGE_CONTEXT, pageName } from './uiShared'
import type { SaveState } from './useAutosave'

/**
 * スマホ版の画面（mockups/v7 案2「下から書く欄が出る」）。
 * 上：細い帯（名前・保存・メニュー）／中：紙面（左右にはらってめくる）／下：タブ（ページ一覧・追加・チェック・PDF）
 * 紙面の段落をタップすると、画面の下から大きな文字の書く欄が出る。
 */

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)
const PhoneIcon = {
  menu: svg(<path d="M4 7h16M4 12h16M4 17h16" />),
  pages: svg(<path d="M4 4h7v9H4zM13 4h7v9h-7zM4 15h7v5H4zM13 15h7v5h-7z" />),
  plus: svg(<path d="M12 5v14M5 12h14" />),
  check: svg(<path d="M5 12.5l4.5 4.5L19 7.5" />),
}

const KIND_LABELS: Record<EditableKind, string> = {
  field: '表紙の項目',
  abstractParagraph: '段落',
  chapter: '大見出し',
  subheading: '小見出し',
  paragraph: '段落',
  figureCaption: '図のタイトル',
  tableCaption: '表のタイトル',
  tableCell: '表のセル',
}

/** 表紙の項目の名前 */
const FIELD_LABELS: Record<string, string> = { 'basic:studentId': '学籍番号', 'basic:name': '氏名', 'basic:subtitleInput': 'サブタイトル' }

type SheetKind = 'pages' | 'add' | 'check' | 'menu' | null

/** 画面の下から出る欄（ページ一覧・追加・チェック・メニュー） */
function Sheet({ title, extra, onClose, children }: { title: string; extra?: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section className="sheet" role="dialog" aria-label={title}>
        <div className="grab" />
        <header className="sheet-head">
          <h2>{title}</h2>
          {extra}
          <button className="sheet-close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </>
  )
}

/** 段落を書いているとき：カーソルの位置に「（図1）」などを入れる */
function RefButtons({ editor, snap }: { editor: ReportEditor; snap: EditorSnapshot }) {
  const [open, setOpen] = useState(false)
  const n = numbering(snap.report)
  const items = [
    ...[...n.figureByNumber.entries()].map(([num, id]) => ({ id, label: `図${num}` })),
    ...[...n.tableByNumber.entries()].map(([num, id]) => ({ id, label: `表${num}` })),
  ]
  if (snap.editingKind !== 'paragraph') return null
  return (
    <>
      <button onMouseDown={keepFocus} disabled={items.length === 0} onClick={() => setOpen(!open)}>
        {Icon.ref}図表を参照
      </button>
      {open &&
        items.map((item) => (
          <button
            key={item.id}
            className="chip-btn"
            onMouseDown={keepFocus}
            onClick={() => {
              editor.insertReference(item.id)
              setOpen(false)
            }}
          >
            （{item.label}）
          </button>
        ))}
    </>
  )
}

/** 下から出る書く欄。入力欄そのもの（.overlay-editor）は、編集の中核が host の中に入れる */
function EditSheet({ editor, snap, hostRef }: { editor: ReportEditor; snap: EditorSnapshot; hostRef: React.RefObject<HTMLDivElement | null> }) {
  const id = snap.editingId
  const editable = id ? findEditable(snap.report, id) : undefined
  const issues = id ? snap.findings.filter((f) => f.blockId === id) : []
  const removable = snap.editingKind === 'paragraph' || snap.editingKind === 'abstractParagraph' || snap.editingKind === 'subheading' || snap.editingKind === 'chapter'
  // 表のセル・タイトルを書いているときの表
  const tableId = id && (snap.editingKind === 'tableCell' || snap.editingKind === 'tableCaption') ? editor.tableIdOf(id) : null
  const tableBlock = tableId ? snap.report.body.flatMap((c) => c.blocks).find((b) => b.id === tableId) : undefined
  const tableWidths = tableBlock?.type === 'table' ? tableBlock.widths : 'equal'
  return (
    <section className={`edit-sheet${snap.editingId ? ' open' : ''}`} aria-label="書く欄">
      <header className="es-head">
        <span className="where">
          {pageName(snap)} ・ <b>{(id && FIELD_LABELS[id]) ?? (snap.editingKind ? KIND_LABELS[snap.editingKind] : '')}</b>を書いています
        </span>
        <button className="done" onMouseDown={keepFocus} onClick={() => editor.finishEditing()}>
          完了
        </button>
      </header>
      <div className="es-host" ref={hostRef} />
      <div className="es-meta">
        <span>{editable ? `${editable.text.length}字` : ''}</span>
        {issues.length > 0 && <span className="ng">{issues[0].title}{issues.length > 1 ? ` ほか${issues.length - 1}件` : ''}</span>}
      </div>
      <div className="es-tools">
        {snap.editingKind === 'paragraph' && (
          <button onMouseDown={keepFocus} onClick={() => void editor.addFigure()}>
            {Icon.figure}図を入れる
          </button>
        )}
        {snap.editingKind === 'paragraph' && (
          <button onMouseDown={keepFocus} onClick={() => editor.addTable('blank')}>
            {Icon.table}表を入れる
          </button>
        )}
        {snap.editingKind === 'paragraph' && (
          <button onMouseDown={keepFocus} onClick={() => editor.addTable('material')}>
            {Icon.table}素材表
          </button>
        )}
        <RefButtons editor={editor} snap={snap} />
        {tableId && (
          <>
            <button onMouseDown={keepFocus} onClick={() => editor.addTableRow(tableId)}>
              {Icon.rowAdd}行
            </button>
            <button onMouseDown={keepFocus} onClick={() => editor.addTableColumn(tableId)}>
              {Icon.colAdd}列
            </button>
            {snap.editingKind === 'tableCell' && (
              <button onMouseDown={keepFocus} onClick={() => (editor.currentCellHasImage(tableId) ? editor.removeCellImage(tableId) : void editor.setCellImage(tableId))}>
                {Icon.image}
                {editor.currentCellHasImage(tableId) ? '画像を外す' : '画像'}
              </button>
            )}
            <button onMouseDown={keepFocus} onClick={() => editor.removeTableRow(tableId)}>
              {Icon.rowRemove}行を消す
            </button>
            <button onMouseDown={keepFocus} onClick={() => editor.removeTableColumn(tableId)}>
              {Icon.colRemove}列を消す
            </button>
            <button onMouseDown={keepFocus} onClick={() => editor.setTableWidths(tableId, tableWidths === 'equal' ? 'auto' : 'equal')}>
              {tableWidths === 'equal' ? '幅：そろえる' : '幅：中身に合わせる'}
            </button>
          </>
        )}
        {removable && (
          <button
            className="danger"
            onMouseDown={keepFocus}
            onClick={() => {
              if (snap.editingKind === 'chapter' && !confirm('大見出しを削除すると、その中の小見出し・段落・図表もすべて消えます。削除しますか？\n（「元に戻す」で戻せます）')) return
              editor.removeBlock(id!)
            }}
          >
            {Icon.remove}削除
          </button>
        )}
        <button onMouseDown={keepFocus} disabled={!snap.canUndo} onClick={() => editor.undo()}>
          {Icon.undo}戻す
        </button>
      </div>
    </section>
  )
}

/** 「追加」の欄：本文のページなら段落・見出し・図・表を足す */
function AddTools({ editor, snap, onDone, onReferences }: { editor: ReportEditor; snap: EditorSnapshot; onDone: () => void; onReferences: () => void }) {
  const kind = snap.layout?.kinds[snap.page] ?? 'unknown'
  if (kind !== 'body') {
    return (
      <p className="sheet-hint">
        {kind === 'cover' || kind === 'abstract' || kind === 'photos' ? `${PAGE_CONTEXT[kind].name}：${PAGE_CONTEXT[kind].hint.replace('\n', '')}。` : ''}
        段落や図は、本文のページで足せます。
      </p>
    )
  }
  const tool = (label: string, icon: ReactNode, run: () => void) => (
    <button
      className="tb"
      onClick={() => {
        onDone()
        run()
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
  return (
    <>
      <p className="sheet-hint">{pageName(snap)}の、最後に触ったところの後ろに入ります。段落は、書く欄で改行すると分かれます。</p>
      <div className="add-grid">
        {tool('小見出し', Icon.heading2, () => editor.addSubheading())}
        {tool('大見出し', Icon.heading1, () => editor.addChapter())}
        {tool('改ページ', Icon.pageBreak, () => editor.addPageBreak())}
      </div>
      <p className="sheet-hint">図・表は、文中の入れたい位置をタップして、書く欄の「図を入れる」「表を入れる」「素材表」で入れます。</p>
      {snap.report.references.length === 0 && (
        <button className="add-refs" onClick={() => { onDone(); onReferences() }}>
          ＋ 引用・参考文献を入れる（使うときだけ）
        </button>
      )}
    </>
  )
}

interface Props {
  editor: ReportEditor
  snap: EditorSnapshot
  config: YearConfig
  saveState: SaveState
  onBackup: () => void
  onExport: () => void
  onReferences: () => void
  sheetHostRef: React.RefObject<HTMLDivElement | null>
}

/** スマホ版の、紙面のまわりの部品（紙面そのものは App の .stage） */
export function PhoneChrome({ editor, snap, config, saveState, onBackup, onExport, onReferences, sheetHostRef }: Props) {
  const [sheet, setSheet] = useState<SheetKind>(null)
  const close = () => setSheet(null)
  const errors = snap.findings.filter((f) => f.severity === 'error').length
  const kind = snap.layout?.kinds[snap.page]
  const showSelection = !snap.editingId && (snap.selection || kind === 'photos')
  return (
    <>
      <header className="p-top">
        <span className="mark">卒</span>
        <div className="p-title">
          <div className="title">{config.reportName}</div>
          <div className="sub">{pageName(snap)}</div>
        </div>
        <SaveChip state={saveState} />
        <button className="icon-btn" aria-label="メニュー（手順書・バックアップなど）" onClick={() => setSheet('menu')}>
          {PhoneIcon.menu}
        </button>
      </header>

      {snap.layout && !snap.zoomed && (
        <div className="pager">
          <button aria-label="前のページ" disabled={snap.page <= 0} onClick={() => editor.prevPage()}>
            {Icon.prev}
          </button>
          <span className="lbl">
            {pageName(snap)}　<b>{snap.page + 1}</b> / {snap.pageCount}
          </span>
          <button aria-label="次のページ" disabled={snap.page >= snap.pageCount - 1} onClick={() => editor.nextPage()}>
            {Icon.next}
          </button>
        </div>
      )}
      {snap.zoomed && !snap.editingId && (
        <button className="unzoom" onClick={() => editor.setZoom(false)}>
          {Icon.fit}ページ全体に戻す
        </button>
      )}

      {showSelection && (
        <div className="sel-bar">
          <SelectionTools editor={editor} snap={snap} />
        </div>
      )}

      <nav className="p-nav">
        <button onClick={() => setSheet('pages')}>
          {PhoneIcon.pages}ページ一覧
        </button>
        <button className="add" onClick={() => setSheet('add')}>
          <span className="plus">{PhoneIcon.plus}</span>追加
        </button>
        <button onClick={() => setSheet('check')}>
          {PhoneIcon.check}チェック{errors > 0 && <i className="badge">{errors}</i>}
        </button>
        <button onClick={onExport}>
          {Icon.pdf}PDF
        </button>
      </nav>

      <EditSheet editor={editor} snap={snap} hostRef={sheetHostRef} />

      {sheet === 'pages' && (
        <Sheet title="ページ一覧" extra={<span className="pcount"><b>{snap.page + 1}</b> / {snap.pageCount}</span>} onClose={close}>
          <PageThumbs editor={editor} snap={snap} onPick={close} />
        </Sheet>
      )}
      {sheet === 'add' && (
        <Sheet title="追加" onClose={close}>
          <AddTools editor={editor} snap={snap} onDone={close} onReferences={onReferences} />
        </Sheet>
      )}
      {sheet === 'check' && (
        <Sheet title="セルフチェック" extra={<Tally snap={snap} />} onClose={close}>
          <CheckBody editor={editor} snap={snap} config={config} onPick={close} />
          <button
            className="export"
            onClick={() => {
              close()
              onExport()
            }}
          >
            {Icon.pdf}PDFを書き出す
          </button>
        </Sheet>
      )}
      {sheet === 'menu' && (
        <Sheet title={config.reportName} extra={<span className="brand-sub">{config.fiscalYear}年度</span>} onClose={close}>
          <div className="meta">
            <SaveChip state={saveState} />
            <DeadlineChip deadline={config.deadline} />
          </div>
          {config.notice?.trim() && (
            <div className="notice">
              <b>学科からのお知らせ</b>
              <p>{config.notice}</p>
            </div>
          )}
          <div className="links">
            {config.handbookUrl && (
              <a className="link-btn" href={config.handbookUrl} target="_blank" rel="noreferrer">
                {Icon.handbook}手順書
              </a>
            )}
            <button
              className="link-btn"
              onClick={() => {
                close()
                onBackup()
              }}
            >
              {Icon.backup}バックアップ
            </button>
          </div>
          <SourceNotice />
        </Sheet>
      )}
    </>
  )
}
