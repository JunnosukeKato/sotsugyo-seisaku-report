import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { YearConfig } from '../config'
import type { EditorSnapshot, ReportEditor } from '../editor/reportEditor'
import { findEditable, type EditableKind } from '../editor/reportOps'
import type { Report } from '../model/types'
import { Icon } from './icons'
import { SelectionTools } from './Palette'
import { CheckBody, CourseNotice, DeadlineChip, DriveStoppedNote, GuideLink, PageThumbs, SaveChip, SourceNotice, Tally } from './SidePanel'
import { keepFocus, PAGE_CONTEXT, pageName } from './uiShared'
import { DriveChip, DriveMenu, type DriveControls } from './DriveUi'
import type { SaveState } from './useAutosave'
import { useDialogFocus } from './useDialogFocus'
import { WordImportLink } from './WordImport'

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

/**
 * 画面の下から出る欄（ページ一覧・追加・チェック・メニュー）。
 * 窓と同じく、開くと中に移り、Tab で外に出ず、Esc で閉じ、閉じると開く前の場所（下のタブなど）に戻る
 */
function Sheet({ title, extra, onClose, children }: { title: string; extra?: ReactNode; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  useDialogFocus(ref, onClose)
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="grab" />
        <header className="sheet-head">
          <h2>{title}</h2>
          {extra}
          {/* close：開いたときは「×」ではなく、中の最初の操作できるものに移る（useDialogFocus） */}
          <button className="sheet-close close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </section>
    </>
  )
}

/**
 * 下から出る書く欄。入力欄そのもの（.overlay-editor）は、編集の中核が host の中に入れる。
 * onRemoved：段落・見出しを削除した（書く欄が閉じて、中の「戻す」も見えなくなるので、画面の下に「戻す」の知らせを出す）
 */
function EditSheet({ editor, snap, hostRef, onRemoved }: { editor: ReportEditor; snap: EditorSnapshot; hostRef: React.RefObject<HTMLDivElement | null>; onRemoved: (message: string) => void }) {
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
              const before = editor.getSnapshot().report
              editor.removeBlock(id!)
              if (editor.getSnapshot().report !== before) onRemoved(snap.editingKind === 'chapter' || snap.editingKind === 'subheading' ? '見出しを削除しました' : '段落を削除しました')
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

/** 削除したあとの知らせ。report：削除した直後の原稿 */
interface UndoNotice {
  message: string
  report: Report
}

/** 知らせを出しておく時間 */
const UNDO_NOTICE_MS = 6000

/**
 * 図・表・改ページを削除した（作品写真を外した・書く欄で段落や見出しを削除した）あと、画面の下に「〜しました［戻す］」を出す（mockups/v23 ⑦ 案A）。
 * スマホは「戻す」が書く欄の中にしかなく、削除したあとに戻す方法が見えなかったため。
 * 6秒ほどで消え、ほかの所を触っても消える（キーボードで知らせの中に移っている間は消さない）。
 * 読み上げにも伝わるよう、いつも置いておく枠（role="status"）の中に、知らせを出し入れする
 */
function UndoToast({ notice, onUndo, onClose }: { notice: UndoNotice | null; onUndo: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [holding, setHolding] = useState<UndoNotice | null>(null)
  const held = !!notice && holding === notice
  useEffect(() => {
    if (!notice || held) return
    const timer = window.setTimeout(onClose, UNDO_NOTICE_MS)
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [notice, held, onClose])
  return (
    <div className="undo-area" role="status" ref={ref}>
      {notice && (
        <div className="undo-toast" onFocus={() => setHolding(notice)} onBlur={() => setHolding(null)}>
          <span>{notice.message}</span>
          <button onClick={onUndo}>
            {Icon.undo}戻す
          </button>
        </div>
      )}
    </div>
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
  /** ドライブに保存しているとき（ログイン必須） */
  drive?: DriveControls
  /** 管理ページでドライブ保存を止めている */
  driveStopped?: boolean
  onBackup: () => void
  onExport: () => void
  /** 「PDFを書き出す」を押して、紙面を確かめている途中 */
  exporting?: boolean
  onReferences: () => void
  sheetHostRef: React.RefObject<HTMLDivElement | null>
  /** 今年度だけ：メニューの「Word で書いた分を読み込む」の小さなリンク（mockups/v24 ① 案C）。渡したときだけ出す */
  onWordImport?: () => void
  /** 今年度だけ：Word から写したあとの「つぎにすること」（mockups/v24 ④）。チェックの欄のいちばん上に出す。onPick：紙面へ移る前に欄を閉じる */
  wordTodo?: (onPick: () => void) => ReactNode
  /** 増えたら、チェックの欄を開く（Word から写し終えたとき） */
  checkRequest?: number
}

/** スマホ版の、紙面のまわりの部品（紙面そのものは App の .stage） */
export function PhoneChrome({ editor, snap, config, saveState, drive, driveStopped, onBackup, onExport, exporting, onReferences, sheetHostRef, onWordImport, wordTodo, checkRequest }: Props) {
  const [sheet, setSheet] = useState<SheetKind>(null)
  const close = () => setSheet(null)
  // checkRequest が増えたら、チェックの欄を開く（描く途中で合わせる。React の「前の値と比べて state を変える」書き方）
  const [handledRequest, setHandledRequest] = useState(checkRequest)
  if (checkRequest !== handledRequest) {
    setHandledRequest(checkRequest)
    setSheet('check')
  }
  const errors = snap.findings.filter((f) => f.severity === 'error').length
  const kind = snap.layout?.kinds[snap.page]
  const showSelection = !snap.editingId && (snap.selection || kind === 'photos')
  // 削除したあとの「戻す」の知らせ。削除した直後の原稿のまま（ほかを変えていない・書き始めていない）ときだけ出す
  // （ほかを変えたあとの「戻す」は、削除ではなく、その変更を戻してしまうため）
  const [undoNotice, setUndoNotice] = useState<UndoNotice | null>(null)
  const notice = undoNotice && undoNotice.report === snap.report && !snap.editingId ? undoNotice : null
  const closeNotice = useCallback(() => setUndoNotice(null), [])
  const showUndo = (message: string) => setUndoNotice({ message, report: editor.getSnapshot().report })
  return (
    <>
      <header className="p-top">
        <span className="mark">卒</span>
        <div className="p-title">
          <div className="title">{config.reportName}</div>
          <div className="sub">{pageName(snap)}</div>
        </div>
        {drive ? <DriveChip drive={drive} compact /> : <SaveChip state={saveState} />}
        <button className="icon-btn" aria-label="メニュー（手順書・バックアップ・使い方など）" onClick={() => setSheet('menu')}>
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
        // 知らせが出ている間は、知らせに重ならないよう、少し上に出す（作品写真を外したあとの並べ方）
        <div className={`sel-bar${notice ? ' above-undo' : ''}`}>
          <SelectionTools editor={editor} snap={snap} phone onRemoved={showUndo} />
        </div>
      )}
      <UndoToast
        notice={notice}
        onClose={closeNotice}
        onUndo={() => {
          setUndoNotice(null)
          editor.undo()
        }}
      />

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
        <button onClick={onExport} disabled={exporting}>
          {Icon.pdf}
          {exporting ? '確認中…' : 'PDF'}
        </button>
      </nav>

      <EditSheet editor={editor} snap={snap} hostRef={sheetHostRef} onRemoved={showUndo} />

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
          {wordTodo?.(close)}
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
            {drive ? <DriveChip drive={drive} /> : <SaveChip state={saveState} />}
            <DeadlineChip deadline={config.deadline} />
          </div>
          {drive && <DriveMenu drive={drive} inline onDone={close} />}
          {driveStopped && <DriveStoppedNote />}
          {drive?.staff && <p className="staff-note">教職員のアカウントで試しています（学籍番号は自動で入りません）</p>}
          <CourseNotice config={config} courseId={snap.report.basicInfo.courseId} />
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
          {onWordImport && (
            <WordImportLink
              onClick={() => {
                close()
                onWordImport()
              }}
            />
          )}
          <GuideLink />
          <SourceNotice />
        </Sheet>
      )}
    </>
  )
}
