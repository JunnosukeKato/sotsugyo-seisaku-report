import { useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import type { YearConfig } from '../config'
import type { EditorSnapshot, ReportEditor } from '../editor/reportEditor'
import { findEditable, type EditableKind } from '../editor/reportOps'
import { BAND_SIDE_QUERY, forTouch, paragraphHint, photoToolsAtSide } from './bandText'
import { Icon } from './icons'
import { SelectionTools } from './Palette'
import { TableSizeSheet } from './TableSize'
import { BackupLabel } from './dialogs'
import { CheckBody, CourseNotice, DeadlineChip, DriveStoppedNote, ExportNote, HelpButton, PageThumbs, SaveChip, SourceNotice, Tally } from './SidePanel'
import { checkSummary } from './checkSummary'
import { keepFocus, PAGE_CONTEXT, pageName, useBandSide } from './uiShared'
import { DriveChip, DriveMenu, type DriveControls } from './DriveUi'
import type { SaveState } from './useAutosave'
import { useDialogFocus } from './useDialogFocus'
import { UndoBar } from './UndoBar'
import { useUndoNotice } from './useUndoNotice'
import { WordImportLink } from './WordImport'

/**
 * スマホ版の画面（mockups/v7 案2「下から書く欄が出る」）。
 * 上：細い帯（名前・保存・戻す・やり直す・メニュー）／中：紙面（左右・上下にはらってめくる。上下は拡大していないとき）／下：タブ（ページ一覧・追加・チェック・PDF）
 * 紙面の段落をタップすると、画面の下から大きな文字の書く欄が出る。
 * 試作（リンクの ?direct=1。app/phoneDirect.ts）：段落・見出しは、紙面を拡大して紙面の上でそのまま書き、キーボードのすぐ上に細い道具を出す（DirectBar）
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
 * 段落・見出し・表（表のセル・タイトルを書いているときの「この表を削除」）を削除すると、書く欄が閉じて中の「戻す」も見えなくなるので、
 * 画面の下に「戻す」の知らせが出る（UndoBar）。
 * キーボードを閉じているときは、下のタブ（ページ一覧・追加など）の上に出す（タブを隠さない。index.css の「はじめて使う学生の試し（2回目）」）
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
  // 「表を入れる」で出す、表の大きさを選ぶ欄（mockups/v35 ②）
  const [tableSheet, setTableSheet] = useState(false)
  // 書く欄の「戻す」「やり直す」：戻した（やり直した）あとも、書いていた欄が残っていれば、書く欄を開いたままにする
  // （閉じると、続けて「やり直す」を押せないため。mockups/v35 ④）
  const undoRedo = (run: () => void) => {
    run()
    const still = id ? findEditable(editor.getSnapshot().report, id) : undefined
    if (id && still) editor.openWhenReady(id, still.text.length)
  }
  return (
    <>
    {/* 試作（紙面で直接書く）で、紙面に重ねた書く欄で書いている間は出さない（下の欄で書く表紙の項目・図表のタイトル・表のセルのときだけ出す） */}
    <section className={`edit-sheet${snap.editingId && snap.sheet ? ' open' : ''}`} aria-label="書く欄">
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
        {/* 表を入れる：大きさ（列・行）を選ぶ小さな欄を出す。素材表もその欄の中（mockups/v35 ②） */}
        {snap.editingKind === 'paragraph' && (
          <button className={tableSheet ? 'on' : undefined} onMouseDown={keepFocus} onClick={() => setTableSheet(true)}>
            {Icon.table}表を入れる
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
            {/* 表ごと消す（画面の下に「表を削除しました［戻す］」）。前は、閉じてから表のタイトル（ページ全体の表示では高さ 7px ほど）をタップするしかなかった */}
            <button className="danger" onMouseDown={keepFocus} onClick={() => editor.removeTable(tableId)}>
              {Icon.remove}この表を削除
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
        {/* 「戻す」の横に「やり直す」（戻しすぎたときに進める。mockups/v35 ④）。折り返すときも2つ並べたまま */}
        <span className="es-undo">
          <button onMouseDown={keepFocus} disabled={!snap.canUndo} onClick={() => undoRedo(() => editor.undo())}>
            {Icon.undo}戻す
          </button>
          <button onMouseDown={keepFocus} disabled={!snap.canRedo} onClick={() => undoRedo(() => editor.redo())}>
            {Icon.redo}やり直す
          </button>
        </span>
      </div>
    </section>
    {/* 表の大きさを選ぶ欄（書く欄の外に置く。書く欄より上に重ねるため） */}
    {tableSheet && snap.editingKind === 'paragraph' && (
      <TableSizeSheet
        onInsert={(size) => {
          editor.addTable('blank', size)
          setTableSheet(false)
        }}
        onMaterial={() => {
          editor.addTable('material')
          setTableSheet(false)
        }}
        onClose={() => setTableSheet(false)}
      />
    )}
    </>
  )
}

/**
 * 試作（スマホで紙面に直接書く。app/phoneDirect.ts）：紙面に重ねた書く欄で書いている間、キーボードのすぐ上に出す細い道具。
 * 「戻す」「やり直す」は、まず書く欄の中で打った字を戻す（キーボードは出たまま）。戻す字がなければ、下の書く欄と同じく原稿を戻す。
 * 本文の段落なら「図を入れる」「表を入れる」。「完了」は書き終えて、紙面は拡大したまま（全体に戻すのは「ページ全体に戻す」）
 */
function DirectBar({ editor, snap }: { editor: ReportEditor; snap: EditorSnapshot }) {
  const id = snap.editingId
  const editable = id ? findEditable(snap.report, id) : undefined
  // 空の段落を書き始めるとき：ひな形の「ここに何を書くか」（下の書く欄と同じ）
  const hint = id && editable && !editable.text.trim() ? paragraphHint(snap.report, id) : undefined
  const paragraph = snap.editingKind === 'paragraph'
  const [tableSheet, setTableSheet] = useState(false)
  // 書く欄の中で戻せなければ、原稿を戻す（書く欄はいったん閉じ、欄が残っていれば、組み直してから開き直す。下の書く欄と同じ）
  const undoRedo = (typing: () => boolean, run: () => void) => {
    if (typing()) return
    run()
    const still = id ? findEditable(editor.getSnapshot().report, id) : undefined
    if (id && still) editor.openWhenReady(id, still.text.length)
  }
  return (
    <>
      <div className="direct-bar" role="toolbar" aria-label="書く道具">
        {hint && (
          <p className="db-hint">
            <b>ここに書くこと：</b>
            {hint}
          </p>
        )}
        <div className="db-row">
          <button onMouseDown={keepFocus} disabled={!snap.typingUndo && !snap.canUndo} onClick={() => undoRedo(() => editor.undoTyping(), () => editor.undo())}>
            {Icon.undo}
            <span>戻す</span>
          </button>
          <button onMouseDown={keepFocus} disabled={!snap.typingRedo && !snap.canRedo} onClick={() => undoRedo(() => editor.redoTyping(), () => editor.redo())}>
            {Icon.redo}
            <span>やり直す</span>
          </button>
          {paragraph && (
            <button onMouseDown={keepFocus} onClick={() => void editor.addFigure()}>
              {Icon.figure}
              <span>図を入れる</span>
            </button>
          )}
          {paragraph && (
            <button className={tableSheet ? 'on' : undefined} onMouseDown={keepFocus} onClick={() => setTableSheet(true)}>
              {Icon.table}
              <span>表を入れる</span>
            </button>
          )}
          <button className="db-done" onMouseDown={keepFocus} onClick={() => editor.finishEditing()}>
            完了
          </button>
        </div>
      </div>
      {tableSheet && paragraph && (
        <TableSizeSheet
          onInsert={(size) => {
            editor.addTable('blank', size)
            setTableSheet(false)
          }}
          onMaterial={() => {
            editor.addTable('material')
            setTableSheet(false)
          }}
          onClose={() => setTableSheet(false)}
        />
      )}
    </>
  )
}

/** 「追加」の欄：本文のページなら段落・見出し・図・表を足す */
function AddTools({ editor, snap, onDone, direct }: { editor: ReportEditor; snap: EditorSnapshot; onDone: () => void; direct?: boolean }) {
  // 開いた直後で、まだ紙面が出ていない：どのページかが分からないので「本文のページで足せます」とは言わない（本文のページを開いていた学生が迷っていた）
  if (!snap.layout) return <p className="sheet-hint">紙面を準備しています。準備ができたら、ここから段落や見出しを足せます。</p>
  const kind = snap.layout.kinds[snap.page] ?? 'unknown'
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
        // 試作（紙面で直接書く）：足した見出しは、紙面の上ですぐ書き始める。先にこの欄を閉じ終えてから足す
        // （閉じるときにフォーカスが下の「追加」に戻り、書き始めた見出しが閉じてしまうため）
        if (direct) flushSync(onDone)
        else onDone()
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
      <p className="sheet-hint">図・表は、文中の入れたい位置をタップして、書く欄の「図を入れる」「表を入れる」で入れます（素材表も「表を入れる」から）。</p>
      {/* 引用・参考文献は、使い方の「引用・参考文献」から入れる（mockups/v35 ①。入れた後は、そのページをタップして直す） */}
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
  // 横向きの作品写真のページの右の列（帯と作品写真の道具。mockups/v33 案A）にも重ねず、列の左に出す
  const column = document.querySelector<HTMLElement>('.page-side') ?? (band && matchMedia(BAND_SIDE_QUERY).matches ? band : null)
  const side = !!column
  if (column) area.style.right = `${Math.max(12, innerWidth - column.getBoundingClientRect().left + UNDO_GAP)}px`
  const a = area.getBoundingClientRect()
  // 書く欄（.edit-sheet.open）を開いている間に出す知らせ（表の行・列を消せないわけ）は、書く欄の上に出す（キーボードに隠れないように）。
  // 試作（紙面で直接書く）の、キーボードの上の道具（.direct-bar）の上にも
  const below = [...document.querySelectorAll<HTMLElement>(`.pager, .unzoom, .sel-bar > *, .edit-sheet.open, .direct-bar${side ? '' : ', .page-band'}`)]
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
  /** 「？ 使い方」：画面いっぱいの使い方の欄を開く（メニューから。mockups/v27 案A） */
  onHelp: () => void
  sheetHostRef: React.RefObject<HTMLDivElement | null>
  /** 今年度だけ：メニューの「Word で書いた分を読み込む」の小さなリンク（mockups/v24 ① 案C）。渡したときだけ出す */
  onWordImport?: () => void
  /** 今年度だけ：Word から写したあとの「つぎにすること」（mockups/v24 ④）。チェックの欄のいちばん上に出す。onPick：紙面へ移る前に欄を閉じる */
  wordTodo?: (onPick: () => void) => ReactNode
  /** 増えたら、チェックの欄を開く（Word から写し終えたとき） */
  checkRequest?: number
  /** 試作：スマホで紙面に直接書く（app/phoneDirect.ts）。使っている間は、上の帯の下に小さな印を出し、メニューに「下の書く欄に戻す」を出す */
  direct?: boolean
  /** 試作をやめる（メニューの「下の書く欄に戻す」） */
  onDirectOff?: () => void
}

/** スマホ版の、紙面のまわりの部品（紙面そのものは App の .stage） */
export function PhoneChrome({ editor, snap, config, saveState, drive, driveStopped, onBackup, onExport, exporting, onHelp, sheetHostRef, onWordImport, wordTodo, checkRequest, direct, onDirectOff }: Props) {
  const [sheet, setSheet] = useState<SheetKind>(null)
  const close = () => setSheet(null)
  // checkRequest が増えたら、チェックの欄を開く（描く途中で合わせる。React の「前の値と比べて state を変える」書き方）
  const [handledRequest, setHandledRequest] = useState(checkRequest)
  if (checkRequest !== handledRequest) {
    setHandledRequest(checkRequest)
    setSheet('check')
  }
  // 下の「チェック」の赤い数は、直すところのエラーの数だけ（まだのところは数えない。mockups/v35 ① 案A）
  const errors = checkSummary(snap, config).errors
  const kind = snap.layout?.kinds[snap.page]
  // 横向きの作品写真のページでは、作品写真の道具は紙面の右の列に出す（mockups/v33 案A。PageBand.tsx）
  const bandSide = useBandSide()
  const showSelection = !snap.editingId && (snap.selection || kind === 'photos') && !photoToolsAtSide(snap, bandSide)
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
        {drive ? <DriveChip drive={drive} compact /> : <SaveChip state={saveState} compact />}
        {/* ≡ の左に「戻す」「やり直す」（mockups/v39 案A）。段落などをタップしていなくても戻せる（パソコンの左の道具と同じ動き）。
            書く欄を開いている間は出さない（書く欄の中に同じものがあり、2か所に出さない） */}
        {!snap.editingId && (
          <span className="p-undo">
            <button aria-label="元に戻す" disabled={!snap.canUndo} onClick={() => editor.undo()}>
              {Icon.undo}
              <span>戻す</span>
            </button>
            <button aria-label="やり直す" disabled={!snap.canRedo} onClick={() => editor.redo()}>
              {Icon.redo}
              <span>やり直す</span>
            </button>
          </span>
        )}
        <button className="icon-btn" aria-label="メニュー（手順書・バックアップ・作り直す・使い方など）" onClick={() => setSheet('menu')}>
          {PhoneIcon.menu}
        </button>
      </header>
      {/* 試作の印（上の帯の下の細い段。紙面には重ねない。やめるのはメニューの「下の書く欄に戻す」） */}
      {direct && (
        <div className="direct-badge">
          <span>試作：紙面で直接書く</span>
        </div>
      )}

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
          {/* 紙面を組み終えるまでは、エラーの数を出さない（ページ数などのチェックが加わって、数が変わるため） */}
          {PhoneIcon.check}チェック{errors > 0 && !snap.pageChecksPending && <i className="badge">{errors}</i>}
        </button>
        <button className="nav-pdf" onClick={onExport} disabled={exporting}>
          {Icon.pdf}
          {exporting ? '確認中…' : 'PDF'}
        </button>
      </nav>

      <EditSheet editor={editor} snap={snap} hostRef={sheetHostRef} />
      {snap.editingId && snap.onPaper && <DirectBar editor={editor} snap={snap} />}

      {sheet === 'pages' && (
        <Sheet title="ページ一覧" extra={<span className="pcount"><b>{snap.page + 1}</b> / {snap.pageCount}</span>} onClose={close}>
          <PageThumbs editor={editor} snap={snap} onPick={close} />
        </Sheet>
      )}
      {sheet === 'add' && (
        <Sheet title="追加" onClose={close}>
          <AddTools editor={editor} snap={snap} onDone={close} direct={direct} />
        </Sheet>
      )}
      {sheet === 'check' && (
        <Sheet title="セルフチェック" extra={<Tally snap={snap} config={config} />} onClose={close}>
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
          {/* PDF のボタンの下のひとこと（右の欄と同じ。mockups/v35 ① 案A） */}
          <ExportNote snap={snap} config={config} />
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
              className="link-btn backup-btn"
              onClick={() => {
                close()
                onBackup()
              }}
            >
              {Icon.backup}
              <BackupLabel />
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
          {/* 試作（紙面で直接書く）をやめて、今までの下の書く欄に戻す */}
          {direct && onDirectOff && (
            <div className="direct-off">
              <p>いまは試作の「紙面で直接書く」です。</p>
              <button
                className="link-btn"
                onClick={() => {
                  close()
                  onDirectOff()
                }}
              >
                下の書く欄に戻す
              </button>
            </div>
          )}
          <SourceNotice />
        </Sheet>
      )}
    </>
  )
}
