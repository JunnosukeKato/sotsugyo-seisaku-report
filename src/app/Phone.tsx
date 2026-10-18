import { useRef, useState, type ReactNode } from 'react'
import type { YearConfig } from '../config'
import type { EditorSnapshot, ReportEditor } from '../editor/reportEditor'
import { findEditable, type EditableKind } from '../editor/reportOps'
import { BAND_SIDE_QUERY, forTouch, paragraphHint } from './bandText'
import { Icon } from './icons'
import { SelectionTools } from './Palette'
import { CheckBody, CourseNotice, DeadlineChip, DriveStoppedNote, HelpButton, PageThumbs, SaveChip, SourceNotice, Tally } from './SidePanel'
import { keepFocus, PAGE_CONTEXT, pageName } from './uiShared'
import { DriveChip, DriveMenu, type DriveControls } from './DriveUi'
import type { SaveState } from './useAutosave'
import { useDialogFocus } from './useDialogFocus'
import { UndoBar } from './UndoBar'
import { useUndoNotice } from './useUndoNotice'
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
 * 段落・見出しを削除すると、書く欄が閉じて中の「戻す」も見えなくなるので、画面の下に「戻す」の知らせが出る（UndoBar）
 */
function EditSheet({ editor, snap, hostRef }: { editor: ReportEditor; snap: EditorSnapshot; hostRef: React.RefObject<HTMLDivElement | null> }) {
  const id = snap.editingId
  const editable = id ? findEditable(snap.report, id) : undefined
  const hint = id && editable && !editable.text.trim() ? paragraphHint(snap.report, id) : undefined
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
      {/* 空の段落を書き始めるとき：ひな形の「ここに何を書くか」（紙面では小さくて読めないため。mockups/v32 ④ 案A） */}
      {hint && (
        <p className="es-hint">
          <b>ここに書くこと：</b>
          {hint}
        </p>
      )}
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
        {kind === 'cover' || kind === 'abstract' || kind === 'photos' ? `${PAGE_CONTEXT[kind].name}：${forTouch(PAGE_CONTEXT[kind].hint.replace('\n', ''))}。` : ''}
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

/** 削除の知らせと、その下の道具・帯との間（画面の px） */
const UNDO_GAP = 8

/**
 * 削除の「戻す」の知らせの位置（UndoBar の place）。画面の下の道具（ページ送り・「ページ全体に戻す」・選んでいる物の道具）と、
 * 紙面の下の帯に重ねず、そのいちばん上のものの上に出す（前は知らせがページ送りに重なり、出ている15秒の間、ページを送れなかった）。
 * 横向きで帯が紙面の右にあるときは、帯には重ねず、帯の左に出す
 */
function placeUndo(area: HTMLElement): void {
  area.style.bottom = ''
  area.style.right = ''
  const band = document.querySelector<HTMLElement>('.page-band')
  const side = !!band && matchMedia(BAND_SIDE_QUERY).matches
  if (band && side) area.style.right = `${Math.max(12, innerWidth - band.getBoundingClientRect().left + UNDO_GAP)}px`
  const a = area.getBoundingClientRect()
  // 書く欄（.edit-sheet.open）を開いている間に出す知らせ（表の行・列を消せないわけ）は、書く欄の上に出す（キーボードに隠れないように）
  const below = [...document.querySelectorAll<HTMLElement>(`.pager, .unzoom, .sel-bar > *, .edit-sheet.open${side ? '' : ', .page-band'}`)]
    .map((e) => e.getBoundingClientRect())
    .filter((r) => r.height > 0 && r.left < a.right && r.right > a.left)
  if (!below.length) return
  // CSS で決めた位置（下のタブのすぐ上）から、いちばん上の道具・帯の上まで上げる
  const lift = a.bottom - (Math.min(...below.map((r) => r.top)) - UNDO_GAP)
  if (lift > 0) area.style.bottom = `${parseFloat(getComputedStyle(area).bottom) + lift}px`
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
  /** 「？ 使い方」：画面いっぱいの使い方の欄を開く（メニューから。mockups/v27 案A） */
  onHelp: () => void
  sheetHostRef: React.RefObject<HTMLDivElement | null>
  /** 今年度だけ：メニューの「Word で書いた分を読み込む」の小さなリンク（mockups/v24 ① 案C）。渡したときだけ出す */
  onWordImport?: () => void
  /** 今年度だけ：Word から写したあとの「つぎにすること」（mockups/v24 ④）。チェックの欄のいちばん上に出す。onPick：紙面へ移る前に欄を閉じる */
  wordTodo?: (onPick: () => void) => ReactNode
  /** 増えたら、チェックの欄を開く（Word から写し終えたとき） */
  checkRequest?: number
}

/** スマホ版の、紙面のまわりの部品（紙面そのものは App の .stage） */
export function PhoneChrome({ editor, snap, config, saveState, drive, driveStopped, onBackup, onExport, exporting, onReferences, onHelp, sheetHostRef, onWordImport, wordTodo, checkRequest }: Props) {
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
  // 削除したあとの「戻す」の知らせ（mockups/v32 ② 案A）。削除した直後の原稿のまま（ほかを変えていない・書き始めていない）ときだけ出る
  // （ほかを変えたあとの「戻す」は、削除ではなく、その変更を戻してしまうため）
  const undo = useUndoNotice(snap)
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
        <div className="sel-bar">
          <SelectionTools editor={editor} snap={snap} phone />
        </div>
      )}
      {/* 知らせは、ページ送り・選んでいる物の道具・紙面の下の帯の上に出す（どれにも重ねない） */}
      <UndoBar editor={editor} notice={undo.notice} onClose={undo.close} place={placeUndo} />

      <nav className="p-nav">
        <button onClick={() => setSheet('pages')}>
          {PhoneIcon.pages}ページ一覧
        </button>
        <button className="add" onClick={() => setSheet('add')}>
          <span className="plus">{PhoneIcon.plus}</span>追加
        </button>
        <button className="nav-check" onClick={() => setSheet('check')}>
          {PhoneIcon.check}チェック{errors > 0 && <i className="badge">{errors}</i>}
        </button>
        <button className="nav-pdf" onClick={onExport} disabled={exporting}>
          {Icon.pdf}
          {exporting ? '確認中…' : 'PDF'}
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
            <HelpButton
              onClick={() => {
                close()
                onHelp()
              }}
            />
          </div>
          {onWordImport && (
            <WordImportLink
              onClick={() => {
                close()
                onWordImport()
              }}
            />
          )}
          <SourceNotice />
        </Sheet>
      )}
    </>
  )
}
