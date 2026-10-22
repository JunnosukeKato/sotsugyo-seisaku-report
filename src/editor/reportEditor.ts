import { findCourse, subtitleInputOnly, type YearConfig } from '../config'
import { checkReportDetailed, type ReportFinding } from '../checker/reportChecks'
import { FIELD_IDS, REFERENCES_ANCHOR, TOC_TEXT } from '../layout/document'
import type { LayoutInfo, PageKind } from '../layout/measure'
import { typedHeading, type HeadingText } from '../model/headingText'
import { FIGURE_MAX_PX, fitFigureSize, importImage, PHOTO_MAX_PX } from '../model/images'
import { putImage, type StoredImage } from '../model/storage'
import { skippedPages } from '../pdf/exportPages'
import { applyCourseTemplate, bodyWritten } from '../model/template'
import { addPhotoPage, canAddPhotoPage, changeArrangement, clampPercent, movePhoto, pageOfPhotoPage, pagePhotoCount, photoPageAt, photoSlots, placePhotos, putPhoto, removePhotoPage, updatePhotoPage, wholePhoto, type PhotoSlot } from '../model/photos'
import { addColumn, addRow, blankTable, cellPosition, colWidthsOf, columnCount, equalColumnWidths, materialTable, normalizeColumnWidths, removeColumn, removeRow, setCellImage } from '../model/table'
import type { BodyBlock, Chapter, PhotoPosition, Report, TableBlock, WorkPhotoLayout } from '../model/types'
import { abstractPasteNotice, stripFigureRefs } from './abstractRefs'
import { ColumnHandles, type ColumnTarget } from './columnHandles'
import { ContinueRow, endsPageWithRoom, type ContinueTarget } from './continueRow'
import { EditHistory } from './history'
import { OverlayEditor, offsetInCopy, type OverlayKind, type OverlayPlacement, type OverlayTarget } from './overlayEditor'
import { PageStage, TEXT_LEFT, TEXT_W } from './pageStage'
import { loadWritingZoom, PinchZoom, saveWritingZoom, type Point } from './pinchZoom'
import { blockPaperKey, fixedTitleNote, markFocusable, PAPER_FOCUSABLE, paperElement, paperKeyOf, paperOrder, rememberTabStop, setTabStop } from './paperFocus'
import * as ops from './reportOps'
import { ReportRenderer, type FirstShow, type PageEffect } from './reportRenderer'
import { PLACEHOLDER_ATTR } from './pageView'
import { copyRange, deleteRange, pasteClip, rangePieces, resolveRange, sameClipText, type Clip, type ModelPoint, type ModelRange } from './rangeOps'
import { caretAt, caretBefore, domPoint, includeClosing, markHangingSelection, paperPoint, type Caret } from './rangeSelection'
import { SelectionBar, type Bounds } from './selectionBar'
import { changedPlace, headingNotice, tableCutNotice, type ChangedPlace, type NoticeBody, type RemovedWhat, type UndoNotice } from './undoNotice'
import { submissionTitle } from '../model/fileName'

/**
 * 報告書の編集の中核（画面の部品から独立した、紙面まわりの処理）。
 * - 報告書データと「元に戻す」の履歴を持つ
 * - 紙面を組版して1ページずつ表示し、クリックした箇所に入力欄を重ねる
 * - ページを送る（めくる）。書いている文字が次のページへ移ったら、表示も追いかける
 * - セルフチェックを実行し、紙面に波線を引く
 * 画面の部品（React）は subscribe で変化を受け取り、snapshot で状態を読む。
 */

/** 作品写真をつかんで動かしている間の状態 */
interface PhotoDrag {
  /** 何ページ目の作品写真か（0 から） */
  page: number
  index: number
  img: HTMLImageElement
  pointerId: number
  startX: number
  startY: number
  from: PhotoPosition
  /** 枠からはみ出している写真の幅・高さ（画面の px）。この分だけ動かせる */
  spanX: number
  spanY: number
  moved: boolean
}

/** 紙面の作品写真の枠・ページ（の中の要素）が、何ページ目の作品写真か（0 から。layout/document.ts の data-photo-page） */
function photoPageOf(el: Element): number {
  return Number(el.closest<HTMLElement>('section.photos')?.dataset.photoPage) || 0
}

/** 紙面の、作品写真の page ページ目の index 枚目の枠（を探す CSS のセレクタ） */
const photoSlotSelector = (page: number, index: number) => `section.photos[data-photo-page="${page}"] [data-photo-slot="${index}"]`

export type Selection =
  | { kind: 'figure'; id: string }
  | { kind: 'table'; id: string }
  /**
   * 作品写真のページ。page：何ページ目の作品写真か（0 から。mockups/v38 案A）。
   * index：入っている写真を押して選んだとき、その写真（0 から。道具に「この写真：差し替え／外す」が出る）
   */
  | { kind: 'photos'; page: number; index?: number }
  | { kind: 'pageBreak'; id: string }
  | null

export interface EditorSnapshot {
  report: Report
  findings: ReportFinding[]
  /** 学生が「このままにする（確認済み）」にした指摘（エラーに数えない） */
  acknowledged: ReportFinding[]
  layout: LayoutInfo | null
  rendering: boolean
  renderMs: number
  /** 入力欄を開いているブロック */
  editingId: string | null
  editingKind: ops.EditableKind | null
  /** 最後に触ったブロック（追加の位置に使う） */
  currentId: string | null
  selection: Selection
  canUndo: boolean
  /** 「やり直す」ができるか（元に戻したあと、ほかを変えていない。書く欄で書き始めたら、もうできない。mockups/v35 ④） */
  canRedo: boolean
  /** 表示しているページ（0 から）とページ数。見開きのときは、並べた2ページのうち、書いている（最後に押した）方 */
  page: number
  pageCount: number
  /** 表示しているページが何ページ目の作品写真か（0 から。作品写真のページでなければ null。mockups/v38 案A） */
  photoPage: number | null
  /** 拡大して表示しているか */
  zoomed: boolean
  /** 見開き（いまのページと次のページを並べる。1–2、3–4…の組。PC だけ。mockups/v35 ③ 案A）で表示しているか */
  spread: boolean
  /** 紙面の台が、見開きを出せる広さか（狭いときは「見開き」を出さない） */
  spreadFits: boolean
  /** ページを送っている途中か */
  turning: boolean
  /** スマホ：下の欄で書いているか */
  sheet: boolean
  /** スマホで紙面に直接書く（app/phoneDirect.ts）：紙面に重ねた書く欄で書いているか */
  onPaper: boolean
  /** 書く欄の中で、書いた文字を戻せる・やり直せるか（紙面と同じ組み方で書いている段落。スマホのキーボードの上の道具の「戻す」「やり直す」） */
  typingUndo: boolean
  typingRedo: boolean
  /** 書いている欄のカーソルの位置（書いていなければ null） */
  caret: number | null
  /** 画面の下に出す、削除・戻したあとの知らせ（ほかを変えたら・書き始めたら null。mockups/v32 ② 案A） */
  notice: UndoNotice | null
  /** 紙面で文を選んでいる（コピー・切り取り・削除できる範囲。左の道具に「選んだ文」を出す。mockups/v36 案B） */
  textRange: boolean
  /** 段落を書いていて、紙面でコピーしたまとまりがある（左の道具の「この段落」に「貼り付け」を出す） */
  pasteReady: boolean
  /**
   * 紙面の情報（ページ数など）を使うチェックを、まだしていない（開いた直後で、紙面を組み終えていない）。
   * この間は、チェックの欄に「指摘はありません」と出さない（文字のチェックの指摘だけを出す）
   */
  pageChecksPending: boolean
  /** 開いた直後に紙面を組んでいる間の、残りのページの見込み（組み終えたら・分からなければ null。「紙面を準備しています…（あと3ページ）」） */
  pagesLeft: number | null
  /** 原稿を丸ごと入れ替えて（Word から読み込んだ・控えに戻したなど）、新しい紙面を組んでいる途中（前の原稿の紙面を見せない） */
  replacing: boolean
  version: number
}

export interface EditorCallbacks {
  /** 報告書が変わった（自動保存する） */
  onChange(report: Report): void
  /** 紙面のコース欄をクリックした */
  onCourseClick(rect: DOMRect): void
  /** 紙面の引用・参考文献をクリックした */
  onReferencesClick(): void
  /** 目次のページの、行のない所を押した（押した点。目次は自動であることを、その近くに知らせる：mockups/v41 案B。app/TocNotice.tsx） */
  onTocClick?(point: { x: number; y: number }): void
  /** 写真を選ぶ画面を開いてほしい */
  pickImage(purpose: 'figure' | 'swatch' | 'photo'): Promise<File | null>
  /** 写真を何枚かまとめて選ぶ画面を開いてほしい（作品写真の空いている枠を押したとき。やめたら空） */
  pickImages?(purpose: 'photo'): Promise<File[]>
  /**
   * 選んだ写真を縮めて、この端末に保存している間（画面に「写真を取り込んでいます…」を出す。依頼者の要望 2026-10-20）。
   * done・total：何枚目か（まとめて選んだとき）。終わったら null
   */
  onImageWork?(work: { done: number; total: number } | null): void
}

/** 編集の中核の動き方 */
export interface EditorOptions {
  /**
   * ひな形を作る画面（先生。mockups/v44 案A。src/template/TemplateApp.tsx）。学生の原稿ではないので：
   * セルフチェックをしない・写真を選ばない（図は空の枠）・表紙・作品写真・表の中身の行は書かない・段落を分けても「。」を付けない・
   * 図表を入れても本文に「（図n）」を足さない（段落の字は、学生に薄く出す説明のまま）・紙面の組み方をこの端末に覚えない
   */
  template?: boolean
}

/** ひな形を作る画面で書ける欄の種類（表のセルは、見出しの行だけ。templateEditable） */
const TEMPLATE_KINDS = new Set<ops.EditableKind>(['abstractParagraph', 'chapter', 'subheading', 'paragraph', 'figureCaption', 'tableCaption', 'tableCell'])

interface ImageEntry {
  url: string
  widthPx: number
  heightPx: number
}

/**
 * 足した欄を、紙面に出る前に入力欄で仮に置くときの目印（reopenAfterRender）。
 * id：目印のブロック（段落・見出し・図・表・表のセル）。place：after＝そのすぐ下に足した／over＝そのブロックと置き換えた（同じ位置）
 */
interface InsertNear {
  id: string
  place: 'after' | 'over'
}

const RENDER_DELAY_MS = 600
const FIGURE_MAX_MM = 80
/** 元に戻した所を光らせておく時間（mockups/v32 ② 案A） */
const UNDO_FLASH_MS = 1500
/** 目次の行から移った見出しを光らせておく時間（mockups/v41 案C。光り方は index.css の「v41」） */
const TOC_ARRIVE_MS = 1600
/** 原稿が変わっても出しておく知らせ（showNotice）を、出しておく時間（画面の知らせの部品 UndoBar は 8秒で閉じる。少し長めに） */
const STICKY_NOTICE_MS = 10000

/** 書き終えた欄の仮の表示を写したときの、ページ（何ページ目か・画面の位置と幅）と、仮の表示の要素の位置（画面座標）。realignFrozen */
interface FrozenPlace {
  page: number
  pageBox: { left: number; top: number; width: number }
  box: { left: number; top: number }
}

/**
 * 段落を見出しにしたこと（段落に「Ⅲ．まとめ」のように打った・見出しの形の行を貼り付けた）。元に戻すときに使う。
 * declined：戻したら、同じ文のままなら、もう見出しにしない段落の ID と、その文。notice：画面の下の知らせ（やり直したときも出す）
 */
interface HeadingStep {
  declined: [string, string][]
  notice: NoticeBody
}

/** 後ろの文章をずらしていた要素を元に戻す（shiftFollowing） */
function resetShift(elements: HTMLElement[]): void {
  for (const t of elements) {
    t.style.translate = ''
    t.style.visibility = ''
    t.style.clipPath = ''
  }
}

/** 紙面の欄の要素のすぐ後ろに続く、同じ要素の中の字（なければ undefined） */
function suffixAfter(el: HTMLElement): string | undefined {
  let text = ''
  for (let n = el.nextSibling; n; n = n.nextSibling) text += n.textContent ?? ''
  return text.trim() ? text : undefined
}

/** 原稿の抄録・本文にある ID（段落・章・ブロック・図）。削除して消えたものを見つけるため */
function bodyIds(report: Report): Set<string> {
  const ids = new Set(report.abstract.paragraphs.map((p) => p.id))
  for (const c of report.body) {
    ids.add(c.id)
    for (const b of c.blocks) {
      ids.add(b.id)
      if (b.type === 'figureRow') for (const f of b.figures) ids.add(f.id)
    }
  }
  return ids
}

export class ReportEditor {
  private report: Report
  private config: YearConfig
  private readonly callbacks: EditorCallbacks
  /** ひな形を作る画面（EditorOptions.template） */
  readonly template: boolean
  private readonly renderer: ReportRenderer
  private readonly overlay: OverlayEditor
  private readonly stage: PageStage
  private readonly scroller: HTMLElement
  private readonly layer: HTMLElement
  /** 紙面を置く台の要素 */
  private readonly stageEl: HTMLElement
  /** スマホ：2本の指で紙面を広げる・縮める（editor/pinchZoom.ts） */
  private readonly pinchZoom: PinchZoom
  private readonly marker: HTMLDivElement
  private readonly hideStyle: HTMLStyleElement
  /** 削除したものを、組み直すまで紙面で隠す（removed） */
  private readonly removedStyle: HTMLStyleElement
  /** 書き終えた欄を、組み直すまで紙面で隠す（frozen） */
  private readonly frozenStyle: HTMLStyleElement
  private caretPos = 0
  /** Enter で段落を分けたときに、前の段落へ自動で付けた「。」（直後の Backspace で元に戻すため） */
  private autoPeriod: { prevId: string; newId: string; original: string } | null = null
  private readonly images = new Map<string, ImageEntry>()
  private readonly listeners = new Set<() => void>()
  /** 「元に戻す」「やり直す」の履歴（やり直しの分には、やり直したときに出す知らせも持つ。history.ts） */
  private readonly history = new EditHistory<Report, NoticeBody>()
  /** 元に戻す履歴を変えた回数（積んだ・元に戻した・やり直した・入れ替えた。段落を見出しにした知らせを、ほかを変えたら出さないため） */
  private historySeq = 0
  /** 書く欄で文字を打った回数（段落を見出しにした知らせを、そのあと書き始めたら出さないため） */
  private inputSeq = 0
  /** 段落を見出しにする手前の原稿（履歴に積んだ原稿そのもの）→ そのときのこと。元に戻すと、その原稿に戻る */
  private readonly headingSteps = new WeakMap<Report, HeadingStep>()
  /** 見出しにした知らせ（やり直したときに出す知らせ）→ そのときのこと（やり直したあと、また元に戻せるように） */
  private readonly headingStepOfNotice = new WeakMap<NoticeBody, HeadingStep>()
  /** 見出しにしたのを戻した段落と、その文。同じ文のままなら、Enter・書き終えたときに、もう見出しにしない */
  private readonly declined = new Map<string, string>()
  /** 見出しにした知らせを出したときの、履歴と打った回数（どちらかが変わったら、もう出さない） */
  private headingNoticeAt: { history: number; input: number } | null = null
  /** 書いている欄を、段落のまま確定している途中（図を入れる・紙面で選ぶ範囲を広げるなど、その段落に続けて何かをするとき） */
  private keepParagraph = false
  private reportBeforeEdit: Report | null = null
  private findings: ReportFinding[] = []
  private acknowledged: ReportFinding[] = []
  private layout: LayoutInfo | null = null
  private rendering = false
  private renderAgain = false
  /** 組んでいる間に、急ぎの変更（書き終えた・段落を足した・削除・元に戻すなど。打っている途中の組み直しではないもの）があった */
  private renderUrgent = false
  /** 原稿を変えた回数（書き終えた欄の仮の表示を、その変更を含む紙面が出たら外すため） */
  private changeSeq = 0
  /** 表に出ている紙面の原稿 */
  private shownReport: Report | null = null
  private renderTimer: number | undefined
  private renderMs = 0
  private pendingOpen: { id: string; caret: number } | null = null
  /** 入力欄を開いたまま書く先を移し、紙面を組み直すのを待っている（anchor：その間、後ろの文章をずらす基準のブロック） */
  private continuing: { id: string; anchor: string | null; ghosts?: string[] } | null = null
  /** 図・表のすぐ下の「＋ ここに続きを書く」（mockups/v32 ① 案A） */
  private readonly continueRow: ContinueRow
  /** 列の幅を「自分で決める」表の、境目を動かす線・つまみ（columnHandles.ts） */
  private readonly columnHandles: ColumnHandles
  private currentId: string | null = null
  private selection: Selection = null
  private page = 0
  private turning: Promise<void> | null = null
  private version = 0
  private snapshotCache: EditorSnapshot | null = null
  private readonly highlights = { error: new Highlight(), warning: new Highlight(), focus: new Highlight() }

  /**
   * @param stage 紙面を置く台（大きさに合わせて紙面の倍率を決める）
   * @param scroller 紙面の表示枠（2つ。組み直すたびに表と裏を入れ替える）を入れる要素。拡大したときはスクロールする
   * @param layer 入力欄などを紙面に重ねる層
   */
  constructor(stage: HTMLElement, scroller: HTMLElement, layer: HTMLElement, config: YearConfig, report: Report, callbacks: EditorCallbacks, options: EditorOptions = {}) {
    this.config = config
    this.report = report
    this.callbacks = callbacks
    this.template = !!options.template
    this.scroller = scroller
    this.stageEl = stage
    this.layer = layer
    this.renderer = new ReportRenderer(scroller, { remember: !this.template })
    this.hideStyle = document.createElement('style')
    this.removedStyle = document.createElement('style')
    this.frozenStyle = document.createElement('style')
    document.head.append(this.hideStyle, this.removedStyle, this.frozenStyle)
    CSS.highlights.set('issue-error', this.highlights.error)
    CSS.highlights.set('issue-warning', this.highlights.warning)
    CSS.highlights.set('issue-focus', this.highlights.focus)
    this.marker = document.createElement('div')
    this.marker.className = 'insert-marker'
    this.marker.hidden = true
    this.marker.textContent = 'ここに入ります'
    layer.append(this.marker)
    this.continueRow = new ContinueRow(layer, (id) => this.continueAfter(id))
    this.columnHandles = new ColumnHandles(layer, { onCommit: (id, widths) => this.setTableColWidths(id, widths) })
    // 紙面で選んだ文のすぐ上の帯「コピー・切り取り・削除」と、書く欄の近くの「貼り付け」（mockups/v36 案A。selectionBar.ts）
    this.selectionBar = new SelectionBar(layer, {
      copy: () => this.copySelection(),
      cut: () => this.cutSelection(),
      remove: () => this.deleteSelection(),
      paste: () => this.pasteFromTool(),
    })
    // 拡大してスクロールしたら、「＋ ここに続きを書く」も紙面に合わせて動かす
    scroller.addEventListener('scroll', () => {
      // 選んだ文の帯は、スクロールしたら隠す（選び直す・マウスを離すと、また出る）
      this.suppressSelectionBar()
      this.placeContinueRow()
      // 書き終えた欄の仮の表示も、紙面と一緒に動かす（前は外していたため、スマホで「完了」を押してページ全体の表示に戻ると、すぐ消えていた）
      this.realignFrozen()
    })

    this.overlay = new OverlayEditor(layer, scroller, {
      onInput: (id, text) => {
        // 書き始めたら、書く欄の近くの「貼り付け」は出さない
        this.chipDismissed = true
        this.keepObjectShown = null
        this.inputSeq += 1
        this.report = ops.setText(this.report, id, text)
        this.afterChange({ render: 'debounce', save: true })
        // カーソルがページの下からはみ出した（書き足して、段落が次のページへ続いた）：打つ手が止まるのを待たずに組み直し、次のページへ移る（followCaret）。
        // スマホは、次の絵を描く前に調べる（runLiveFrame）
        if (!this.overlay.inSheet && this.caretBelowContent()) void this.render(false)
        // スマホで紙面に直接書く：書いている行が、キーボードの上の道具・キーボードに隠れないようにする
        if (this.writingOnPaper) this.scheduleCaretReveal()
      },
      onCommit: (id, text, byKey, frozen) => this.onCommitEdit(id, text, byKey, frozen),
      onSplit: (id, before, after) => {
        // 図・表のタイトル：Enter で、図・表の後ろに新しい段落を作る（mockups/v32 ① 案A）
        const editing = ops.findEditable(this.report, id)?.kind
        if (editing === 'figureCaption' || editing === 'tableCaption') return this.enterAfterCaption(id, before + after)
        // 本文の段落に「Ⅲ．まとめ」のように打って Enter：カーソルより前を見出しにして、後ろを次の段落にする（「。」は付けない）
        const heading = editing === 'paragraph' ? this.headingOf(id, before) : null
        if (heading) return this.enterAsHeading(id, before, after, heading)
        // 見出し：すぐ後ろに何も書いていない段落（「大見出し」を足すと付いてくる段落など）があれば、新しく作らずにそこへ移る
        const blank = editing === 'chapter' || editing === 'subheading' ? ops.blankParagraphAfterHeading(this.report, id) : null
        if (blank) return this.enterBelowHeading(id, before + after, blank)
        // 元に戻す：まず段落を分けたことだけを戻す（分ける前に書いた文字は残す。もう一度戻すと、書いた文字も戻る）。
        // 前は、書いた文字と分けたことを1回で戻していたため、紙面にまだ出ていない文字が、知らないうちに消えていた
        const typed = ops.setText(this.report, id, before + after)
        const start = this.reportBeforeEdit ?? this.report
        if (ops.findEditable(start, id)?.text !== ops.findEditable(typed, id)?.text) this.pushHistory(start)
        this.pushHistory(typed)
        // ひな形を作る画面では「。」を付けない（ひな形の説明は、先生が書いたまま）
        const result = ops.split(typed, id, before, after, { period: !this.template })
        this.report = result.report
        // 前の段落に「。」を自動で付けたときは覚えておく（すぐ Backspace でつなぎ直したら、元に戻す）
        const kind = ops.findEditable(this.report, id)?.kind
        this.autoPeriod = !this.template && (kind === 'paragraph' || kind === 'abstractParagraph') && ops.withPeriod(before) !== before ? { prevId: id, newId: result.newId, original: before } : null
        this.continueWriting(result.newId, 0, { ghostOf: id })
        // はじめて「。」を自動で付けたときだけ（開いている間に1回）、画面の下に知らせる（黙って付けると、付いたことに気づかない）
        if (this.autoPeriod) this.noticeAutoPeriodOnce()
      },
      onMergeBackward: (id, text) => {
        // Enter の直後に Backspace でつなぎ直した：自動で付けた「。」を取り消して、元の文に戻す
        const auto = this.autoPeriod?.newId === id ? this.autoPeriod : null
        this.autoPeriod = null
        const base = auto ? ops.setText(this.report, auto.prevId, auto.original) : this.report
        const result = ops.mergeBackward(ops.setText(base, id, text), id, text)
        if (!result) {
          // 空の段落・見出しで、前とつなげられない（前が図・表・見出し、章の初め、空の見出し）：消して、前の欄の終わりへ移る（removeEmptyBackward）
          const removed = ops.removeEmptyBackward(ops.setText(base, id, text), id, text)
          if (removed) {
            this.pushHistory(this.reportBeforeEdit ?? this.report)
            this.report = removed.report
            this.continueWriting(removed.targetId, removed.caret, { alsoHide: id })
            return
          }
          this.openEditor(id, 0)
          return
        }
        this.pushHistory(this.reportBeforeEdit ?? this.report)
        this.report = result.report
        this.continueWriting(result.targetId, result.caret, { alsoHide: id })
      },
      // 空の見出しで Backspace：消せるか（消せるなら、onMergeBackward で消して前の欄へ移る）
      canRemoveEmpty: (id) => !!ops.removeEmptyBackward(ops.setText(this.report, id, ''), id, ''),
      onNavigate: (id, text, direction) => {
        const found = ops.neighbor(ops.setText(this.report, id, text), id, direction)
        // ひな形を作る画面：表紙の項目・表の中身の行には移らない（その欄にとどまる）
        const next = found && (!this.template || this.templateEditable(found.id)) ? found : undefined
        // 段落を分けたばかりで、移る先の段落がまだ紙面にない（仮に表示している）：いまの欄を書き終えて（仮の表示はそのまま残る）、組み直したら移る
        if (next && this.overlay.ghostCount > 0 && this.renderer.pageView.fragments(next.id).length === 0) {
          // ↑↓で移るときは、見出しの形でも段落のまま（↑↓で移ったときは、ほかの所でも見出しにしない）
          this.commitAsParagraph()
          this.pendingOpen = { id: next.id, caret: direction === 'prev' ? next.text.length : 0 }
          return
        }
        this.report = ops.setText(this.report, id, text)
        this.continueWriting(next?.id ?? id, direction === 'prev' ? (next?.text.length ?? 0) : 0)
      },
      onTab: (id, text, backward) => {
        // 表のセル：Tab で隣のセルへ（最後のセルでは書き終わる）
        this.report = ops.setText(this.report, id, text)
        const table = this.report.body.flatMap((c) => c.blocks).find((b) => b.type === 'table' && b.rows.some((r) => r.cells.some((c) => c.id === id)))
        // ひな形を作る画面では、見出しの行の中だけを移る（中身の行は学生が書く）
        const cells = table?.type === 'table' ? (this.template ? (table.rows[0]?.cells ?? []) : table.rows.flatMap((r) => r.cells)) : []
        const next = cells[cells.findIndex((c) => c.id === id) + (backward ? -1 : 1)]
        if (next) this.continueWriting(next.id, next.text.length)
        else this.onCommitEdit(id, text, true)
      },
      onPasteParagraphs: (id, paragraphs, caretInLast) => {
        this.pushHistory(this.reportBeforeEdit ?? this.report)
        const result = ops.replaceWithParagraphs(this.report, id, paragraphs)
        this.report = result.report
        // 本文の段落に貼り付けた行のうち、見出しの形の行（「Ⅰ．企画・立案」など）は見出しにする（Word から読み込むときと同じ）
        const headed = this.pasteHeadings(result.ids)
        const last = headed?.headingIds.get(result.lastId)
        // 最後の行を見出しにしたときは、その見出しの終わりで書き続ける（Enter で、見出しの後ろに段落ができる）
        const caret = last ? (ops.findEditable(this.report, last)?.text.length ?? 0) : caretInLast
        this.reopenAfterRender(last ?? result.lastId, caret, { id, place: 'after' })
        if (headed) this.noticeHeading(headed.step)
      },
      // 貼り付けたものを、そのままの形では入れなかった（1行の欄の2行目から・表）：画面の下に知らせる
      onPasteNote: (what) => {
        // 貼り付けた行を見出しにした知らせが出ていれば、その知らせに添える（「戻す」を残す）
        const shown = this.currentNotice
        const step = this.shownHeadingStep
        if (what === 'table' && shown?.kind === 'headings' && step) {
          step.notice = { kind: 'headings', count: shown.count, note: '。表は文になりました（表は「表を入れる」で作ります）' }
          this.headingStepOfNotice.set(step.notice, step)
          return this.noticeHeading(step)
        }
        this.showNotice(what === 'table' ? '表は「表を入れる」で作ります（貼り付けた表は文になりました）' : 'この欄は1行なので、1行目だけを貼り付けました')
      },
      // 書く欄でまだ何も書いていないときの Ctrl+Z：左の道具の「元に戻す」と同じく、直前の操作を戻す（行を足した・図を入れた・段落を見出しにしたなど）。
      // 前は見出しにしたときだけで、ほかはブラウザに任せていたため、同じ書く欄で前に書いていたマスの字（消した字）が、
      // 足した行のマスに入ることがあった（はじめて使う学生の試し 2026-10-21）。戻すものがなければ何もしない
      onUndoEmpty: () => {
        if (this.history.canUndo) this.undo()
        return true
      },
      // 紙面で選んでコピーした・切り取ったまとまり（段落・図表など）を、書いている段落に貼り付ける（rangeOps.ts の pasteClip）
      onPasteClip: {
        matches: (pasted) => !!this.clip && sameClipText(pasted, this.clip.text),
        paste: (id, text, start, end) => this.pasteClipAt(id, text, start, end),
      },
      // ふつうの文字の貼り付け（ほかのアプリ・書く欄からコピーした文字。スマホも）：抄録には、図表の参照の括弧を除いて入れる（abstractRefs.ts）
      pasteText: (id, pasted) => {
        if (!this.report.abstract.paragraphs.some((p) => p.id === id)) return pasted
        const r = stripFigureRefs(pasted)
        const note = abstractPasteNotice(false, r.removed, r.kept)
        if (note) this.showNotice(note)
        return r.text
      },
      // 段落の最後の行で Shift+↓（最初の行で Shift+↑）：選ぶ範囲を、紙面の次（前）の欄へ広げる
      onExtend: (id, text, anchor, direction) => this.extendFromEditor(id, text, anchor, direction),
      onResize: () => {
        this.shiftFollowing()
        // スマホで紙面に直接書く：段落の行が増えた（日本語の変換中も）：書いている行が隠れないようにする
        if (this.writingOnPaper) this.scheduleCaretReveal()
      },
      // スマホ：打った字をその場で見せる写しを出した・やめた：紙面のその段落を隠す・見せる。後ろの文章を、写しの下端に合わせてずらす（やめたら戻す）
      // （見せはじめたときのずらしは、次の絵を描く前に。runLiveFrame）
      onLive: (on) => {
        this.hideLive(on ? this.overlay.blockId : null)
        if (on) this.scheduleLiveFrame(true)
        else this.shiftFollowing()
      },
      // スマホ：写しに打った字を入れた：次の絵を描く前に、書いている行が見えるようにし、本文の下へはみ出したら組み直す（runLiveFrame）
      onLiveUpdate: () => this.scheduleLiveFrame(false),
    })

    // 画面の大きさが変わって紙面の倍率・位置が変わったら、入力欄も合わせる
    this.stage = new PageStage(stage, () => {
      // 表示の大きさ（全体・見開き・拡大）・画面の大きさが変わった：選んだ文の帯は隠す
      this.suppressSelectionBar()
      // 見開きにした・やめた（台が狭くなって全体に戻したときも）：紙面に、並べるページの印を付け直す
      this.syncSpread()
      this.marker.hidden = true
      // 書き終えた欄の仮の表示は、紙面に合わせて動かし・大きさを変える（ページが替わっていれば外す）
      this.realignFrozen()
      // 段落を分けたばかりで、前の段落を仮に表示しているときは、紙面にある元の段落の位置から並べ直す
      this.realignOverlay()
      this.shiftFollowing()
      // スマホ：画面の向きを変えたときなど、書いている欄が隠れたら、見える所へ動かす
      if (this.phone) this.revealEditing(false)
      this.notify()
    })
    // スマホ：2本の指で紙面を広げる・縮める（紙面の倍率だけを変える。上の帯・道具・タブは大きくしない）
    this.pinchZoom = new PinchZoom(stage, {
      // 表の列の丸いつまみを動かしている間は、2本の指の拡大を始めない（columnHandles.ts）
      enabled: () => this.phone && !!this.layout && !this.columnHandles.dragging,
      start: (mid) => this.pinchStart(mid),
      move: (k, mid) => this.pinchMove(k, mid),
      end: () => this.pinchEnd(),
    })

    // カーソルが動いたら知らせる（右の一覧で、カーソルのある箇所の指摘を示すため）
    document.addEventListener('selectionchange', () => {
      if (!this.overlay.blockId || this.overlay.composing) return
      const caret = this.overlay.caret
      if (caret !== this.caretPos) {
        this.caretPos = caret
        // スマホ：打った字をその場で見せているとき、下の欄でカーソルを動かしたら、紙面のその行が見えるようにする（次の絵を描く前に。runLiveFrame）
        if (this.overlay.inSheet) {
          if (this.overlay.live && caret !== this.liveCaretSeen) this.scheduleLiveFrame(false)
        }
        // ページをまたぐ段落で、カーソルを見えているページの下の続き（次のページ）へ動かした（Ctrl+End など）：そのページへ移る
        else if (!this.turning && this.caretBelowContent() && this.renderer.pageView.pageOfOffset(this.overlay.blockId, caret) !== this.page) this.followCaret()
        // スマホで紙面に直接書く：カーソルを動かした行が、キーボードの上の道具・キーボードに隠れないようにする
        if (this.writingOnPaper) this.scheduleCaretReveal()
        this.notify()
      }
    })
    // 紙面で選んだ文の帯：選び直したら出す（マウスで選んでいる途中は出さず、離したら出す）。Esc で隠す
    document.addEventListener('selectionchange', () => {
      if (!this.mouseSelecting) this.barSuppressed = false
      this.scheduleSelectionUi()
      // 行末にぶら下げた「。」にも、選んだ色を付ける（PC。rangeSelection.ts）
      markHangingSelection(this.phone ? [] : [scroller, layer])
    })
    scroller.addEventListener('mousedown', (e) => {
      // スマホで紙面に直接書く：書いている間に紙面のほかの所を押しても、押した瞬間には書く欄からフォーカスを外さない
      // （外すとキーボードがいったん閉じ、押した段落を開くとまた出てくるため。書き終える・ほかの段落を開くのは、押したあと：onClick）
      if (this.writingOnPaper && !(e.target instanceof Node && this.overlay.element.contains(e.target))) e.preventDefault()
      if (e.button !== 0 || this.phone) return
      this.mouseSelecting = true
      this.selectionBar.hideBar()
      this.startMouseSelect(e)
    })
    window.addEventListener('mousemove', (e) => this.moveMouseSelect(e))
    window.addEventListener('mouseup', (e) => {
      this.endMouseSelect(e)
      if (!this.mouseSelecting) return
      this.mouseSelecting = false
      this.barSuppressed = false
      this.scheduleSelectionUi()
    })
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.selectionBar.barShown) this.suppressSelectionBar()
    })
    scroller.addEventListener('click', (e) => this.onClick(e))
    // 段落をまたいで選ぶ：書いている欄から Shift+クリックで選ぶ・紙面で選んだ範囲をコピーする（PC）
    scroller.addEventListener('mousedown', (e) => this.onPaperMouseDown(e), true)
    document.addEventListener('copy', (e) => this.onCopy(e))
    // 抄録のページで、書く欄を開かずに貼り付けた：何も入らない理由を知らせる
    document.addEventListener('paste', (e) => this.onPaperPaste(e))
    scroller.addEventListener('keydown', (e) => this.onPaperKey(e))
    // Tab で紙面に入ったときに止まる欄：最後にいた欄（はじめは、ページのいちばん上の欄）
    scroller.addEventListener('focusin', (e) => rememberTabStop(e.target))
    document.addEventListener('keydown', (e) => this.prepareTabStop(e), true)
    scroller.addEventListener('pointerdown', (e) => this.onPhotoPointerDown(e))
    // スマホ：指で押した点を覚える（押した欄を、ブラウザが寄せる前の点で決めるため。rawTouch）
    scroller.addEventListener('pointerdown', (e) => {
      this.touchPoint = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY, time: performance.now() } : null
      this.pointerType = e.pointerType
    })
    scroller.addEventListener('dragstart', (e) => {
      if ((e.target as HTMLElement).closest?.('[data-photo-slot]')) e.preventDefault()
    })
    window.addEventListener('pointermove', (e) => this.onPhotoPointerMove(e))
    window.addEventListener('pointerup', (e) => this.onPhotoPointerUp(e))
    window.addEventListener('pointercancel', () => this.cancelPhotoDrag())
    window.addEventListener('beforeprint', () => this.beforePrint())
    window.addEventListener('afterprint', () => this.refreshHighlights())
    // 紙面を組む前から、文字のチェック（紙面の情報を使わないもの）の指摘を出しておく（組み終えるまで、チェックの欄が空にならないように）
    this.runChecks()
  }

  /** いま見えている紙面の表示枠 */
  private get viewport(): HTMLElement {
    return this.renderer.viewport
  }

  // ---- 状態の受け渡し（React の useSyncExternalStore 用） ----

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): EditorSnapshot => {
    if (this.snapshotCache?.version === this.version) return this.snapshotCache
    const editable = this.overlay.blockId ? ops.findEditable(this.report, this.overlay.blockId) : undefined
    const typing = this.overlay.typingHistory
    this.snapshotCache = {
      report: this.report,
      findings: this.findings,
      acknowledged: this.acknowledged,
      layout: this.layout,
      rendering: this.rendering,
      renderMs: this.renderMs,
      editingId: this.overlay.blockId,
      editingKind: editable?.kind ?? null,
      currentId: this.currentId,
      selection: this.selection,
      canUndo: this.history.canUndo,
      // 書く欄で書き始めたら、閉じるときにその分が新しい変更になり、やり直しの分は消える（その前から押せないようにする）
      canRedo: this.history.canRedo && !(this.overlay.blockId && this.reportBeforeEdit && this.reportBeforeEdit !== this.report),
      page: this.page,
      pageCount: this.layout?.kinds.length ?? 0,
      photoPage: this.layout ? photoPageAt(this.layout.kinds, this.page) : null,
      zoomed: this.stage.zoomed,
      spread: this.stage.spread,
      spreadFits: this.stage.spreadFits,
      turning: this.turning !== null,
      sheet: this.overlay.inSheet,
      onPaper: this.direct && !!this.overlay.blockId && !this.overlay.inSheet,
      typingUndo: typing.undo,
      typingRedo: typing.redo,
      caret: this.overlay.blockId ? this.caretPos : null,
      notice: this.currentNotice,
      textRange: this.textRange,
      pasteReady: !!this.clip && !this.phone && (editable?.kind === 'paragraph' || editable?.kind === 'abstractParagraph'),
      pageChecksPending: !this.layout || this.provisional,
      pagesLeft: this.provisional || !this.layout ? this.pagesLeft : null,
      replacing: this.replacing !== null,
      version: this.version,
    }
    return this.snapshotCache
  }

  private notify(): void {
    this.scheduleSelectionUi()
    this.version += 1
    for (const listener of this.listeners) listener()
    this.placeContinueRow()
  }

  // ---- 写真 ----

  addImages(images: StoredImage[]): void {
    for (const img of images) {
      const old = this.images.get(img.id)
      if (old) URL.revokeObjectURL(old.url)
      this.images.set(img.id, { url: URL.createObjectURL(img.blob), widthPx: img.widthPx, heightPx: img.heightPx })
    }
  }

  private async importImage(purpose: 'figure' | 'swatch' | 'photo'): Promise<string | null> {
    // ひな形を作る画面では、写真を選ばない（図は空の枠のまま。写真は学生が入れる）
    if (this.template) return null
    const file = await this.callbacks.pickImage(purpose)
    if (!file) return null
    // 縮めて保存する間（大きな写真は、スマホで1〜数秒かかる）は、画面に「写真を取り込んでいます…」を出す
    this.callbacks.onImageWork?.({ done: 0, total: 1 })
    try {
      return await this.storeImage(file, purpose)
    } finally {
      this.callbacks.onImageWork?.(null)
    }
  }

  /** 選んだ写真を縮めて、この端末に保存する（読めない・保存できないときは、わけを出して null） */
  private async storeImage(file: File, purpose: 'figure' | 'swatch' | 'photo'): Promise<string | null> {
    let stored: StoredImage
    try {
      stored = await importImage(file, ops.newId('img'), purpose === 'photo' ? PHOTO_MAX_PX : FIGURE_MAX_PX)
    } catch {
      // 写真として読めない（パソコンで iPhone の HEIC を選んだ、壊れたファイルなど）。黙って何もしないと、押しても動かないように見える
      alert(
        `「${file.name}」を写真として読み込めませんでした。\n` +
          'iPhone の写真（HEIC）は、パソコンでは読めないことがあります。JPEG か PNG にしてから選んでください（iPhone の「設定」→「カメラ」→「フォーマット」で「互換性優先」にすると JPEG で撮れます）。',
      )
      return null
    }
    try {
      await putImage(stored)
    } catch (e) {
      alert(`写真をこの端末に保存できませんでした（空き容量が足りない可能性があります）。\n${e instanceof Error ? e.message : String(e)}`)
      return null
    }
    this.addImages([stored])
    return stored.id
  }

  // ---- 組版 ----

  private placeholderImage =
    'data:image/svg+xml,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#e4e4e4"/></svg>')

  // ---- 開いたとき（先に見せるページ） ----

  /** 開いてはじめて組むときに、先に見せるページ（renderFirst。組み始めたら null） */
  private firstPage: number | null = null
  /**
   * 開いたとき、見せるページのある部分だけを組み終えて先に見せ、ほかの部分を組んでいるところ（仮の紙面）。
   * この間は、そのページで書けるが、ほかのページへは移らない（組み終えたら移る：goToPage）。チェックは、紙面の情報を使わないものだけ
   */
  private provisional = false
  /** 先に見せたページ（先に見せなかったときは null。movedSinceFirstShow） */
  private firstShownPage: number | null = null
  /** 先に見せている間に、ページを送るよう頼まれた（組み終えてから送る：goToPage） */
  private turnQueued = false
  /** 先に見せている間に頼まれた、まだ組んでいないページへの移動（そのページを組み終えたら、1回だけ移る。最後に頼んだもの） */
  private queuedNav: { index: number; effect: PageEffect } | null = null
  private queuedNavDone: (() => void)[] = []
  /** 開いた直後に紙面を組んでいる間の、残りのページの見込み（「紙面を準備しています…（あと3ページ）」） */
  private pagesLeft: number | null = null

  /**
   * 開いてはじめて紙面を組む。page：見せるページ（0 から。前に開いたとき最後に見ていたページ。新しい原稿は表紙）。
   * 前に開いたときの組み方を覚えていれば（layout/memory.ts）、そのページのある部分を先に組んで、すぐ見せる（ほかの部分は、そのあと組む）。
   * 前は、報告書の全ページを組み終えるまで何も見えず、スマホでは開くたびに数秒〜十数秒待たせていた。
   * すべて組み終えたら（目次の番号・ページ数・チェックも正しくなったら）終わる
   */
  async renderFirst(page: number): Promise<void> {
    this.firstPage = Math.max(0, page)
    await this.render()
    await this.whenLaidOut()
  }

  /** 紙面を組み終えるのを待つ（組んでいる途中・先に見せたページのほかを組んでいる途中なら、終わるまで） */
  whenLaidOut(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.rendering || this.provisional || !this.layout) return
        off()
        resolve()
      }
      const off = this.subscribe(check)
      check()
    })
  }

  /** 紙面が見えるようになるのを待つ（見せるページを先に見せたとき・先に見せずに全部組み終えたとき） */
  whenShown(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (!this.layout) return
        off()
        resolve()
      }
      const off = this.subscribe(check)
      check()
    })
  }

  /** 先に見せたページから、学生がほかのページへ移った（移るよう頼んだ）か、書き始めた・物を選んだか（先に見せなかったときは false） */
  movedSinceFirstShow(): boolean {
    return this.firstShownPage !== null && (this.turnQueued || this.page !== this.firstShownPage || !!this.overlay.blockId || this.selection !== null)
  }

  /** 開いたとき：見せるページのある部分を組み終えた（ほかの部分は、このあと組む）。そのページを先に見せる */
  private showFirst(rendered: Report, page: number, layout: LayoutInfo): void {
    this.provisional = true
    this.layout = layout
    this.page = page
    this.firstShownPage = page
    this.shownReport = rendered
    markFocusable(this.viewport)
    this.markPrintSkip()
    this.runChecks()
    this.notify()
    performance.mark('open:shown')
  }

  /**
   * 開いたとき：部分を1つ組み終えた。残りのページの見込みを知らせる。先に見せたあとなら、ページの一覧（仮のページが組んだページに替わる）を新しくし、
   * まだ組んでいなかったページへの移動を頼まれていて、そのページを組み終えていれば移る
   */
  private onFirstProgress(pagesLeft: number, kinds: PageKind[] | null): void {
    this.pagesLeft = pagesLeft > 0 ? pagesLeft : null
    if (kinds && this.layout && this.provisional) {
      this.layout = { ...this.layout, kinds, bodyPages: kinds.filter((k) => k === 'body').length }
      this.markPrintSkip()
      // 見開き：並べている隣のページを組み終えたら、そのページも出す（組み終えるまでは、仮のページなので出ていない）
      if (this.stage.spread && !this.turning) this.renderer.show(this.page)
    }
    this.notify()
    this.flushQueuedNav()
  }

  /** page ページ目（0 から）を、もう組み終えているか（開いた直後の、まだ組んでいない部分の仮のページでない） */
  private pageReady(page: number): boolean {
    const el = this.renderer.pageView.pages()[page]
    return !!el && !el.hasAttribute(PLACEHOLDER_ATTR)
  }

  /** 先に見せている間に頼まれたページへの移動をやめる（待っている呼び出し元には、終わったと知らせる） */
  private cancelQueuedNav(): void {
    if (!this.queuedNav) return
    this.queuedNav = null
    for (const resolve of this.queuedNavDone.splice(0)) resolve()
  }

  /** 先に見せている間に頼まれたページへの移動を、そのページを組み終えていれば（すべて組み終えていれば）する */
  private flushQueuedNav(): void {
    const nav = this.queuedNav
    if (!nav || (this.provisional && !this.pageReady(nav.index))) return
    this.queuedNav = null
    const done = this.queuedNavDone.splice(0)
    void this.goToPage(nav.index, nav.effect).then(() => done.forEach((resolve) => resolve()))
  }

  /** 打つ手が止まったら組み直す（打っている途中の組み直しは急ぎでない：組んでいる間にまた打っても、組み終えた紙面を出す） */
  scheduleRender(delay = RENDER_DELAY_MS): void {
    clearTimeout(this.renderTimer)
    this.renderTimer = window.setTimeout(() => void this.render(false), delay)
  }

  /** 補助の指摘を「このままにする（確認済み）」にする（エラーに数えない）。戻すときは unacknowledge */
  acknowledge(key: string): void {
    this.update((r) => ({ ...r, acknowledged: [...new Set([...(r.acknowledged ?? []), key])] }))
  }

  unacknowledge(key: string): void {
    this.update((r) => ({ ...r, acknowledged: (r.acknowledged ?? []).filter((k) => k !== key) }))
  }

  /** 年度の設定を入れ替える（原稿を、書き始めた年度の設定で開くとき） */
  setConfig(config: YearConfig): void {
    this.config = config
    this.runChecks()
    this.notify()
    void this.render()
  }

  /**
   * 原稿を組み直して、表に出す。urgent：急ぎの変更（書き終えた・段落を足した・削除・元に戻すなど）のための組み直し。
   * 組んでいる間に急ぎの変更があったら、組んでいる紙面は出さずに、すぐ新しい原稿を組む
   * （途中の状態がちらっと見えないように。書き終えた欄の文字は、組み直した紙面が出るまで仮に表示している：freezeEdited）。
   * 打っている途中の組み直し（scheduleRender）は急ぎでない：組んでいる間にまた打っても、組み終えた紙面を出す（ページの終わりで、続きのページへ移れるように）
   */
  async render(urgent = true): Promise<void> {
    clearTimeout(this.renderTimer)
    if (this.rendering) {
      this.renderAgain = true
      if (urgent) this.renderUrgent = true
      return
    }
    this.rendering = true
    this.renderUrgent = false
    this.notify()
    const image = (id: string) => this.images.get(id)
    // 組む原稿（組んでいる間に原稿が変わっても、紙面に出るのはこの原稿）
    const rendered = this.report
    const seq = this.changeSeq
    let done = false
    let skipped = false
    // 開いてはじめて組むとき：見せるページを、そのページのある部分を組み終えたらすぐ見せる（renderFirst）
    const firstPage = this.firstPage
    this.firstPage = null
    const first: FirstShow | undefined =
      firstPage !== null && !this.layout
        ? { page: firstPage, onShow: (page, layout) => this.showFirst(rendered, page, layout), onProgress: (left, kinds) => this.onFirstProgress(left, kinds) }
        : undefined
    try {
      const result = await this.renderer.renderBack(
        rendered,
        this.config,
        {
          imageSrc: (id) => image(id)?.url ?? this.placeholderImage,
          photoSrc: (id) => image(id)?.url ?? this.placeholderImage,
          figureSize: (f) => {
            const img = image(f.imageId)
            return img ? fitFigureSize(img, FIGURE_MAX_MM) : { widthMm: 60, heightMm: 45 }
          },
        },
        () => this.renderUrgent,
        first,
      )
      done = true
      // 先に見せた紙面を組み直すことになった（resettle）ときも、もう一方の表示枠で、はじめから組み直す（先に見せた紙面は、組み終えるまで出したまま）
      if (result.stale || result.resettle || (this.renderUrgent && !result.unchanged)) {
        skipped = true
      } else {
        // ページを送っている途中なら、送り終わってから入れ替える
        if (this.turning) await this.turning
        this.renderMs = result.ms
        this.layout = result.layout
        this.provisional = false
        this.page = Math.max(0, Math.min(this.page, result.layout.kinds.length - 1))
        // 表に出ている紙面がすでにこの原稿の紙面なら（unchanged）、入れ替えない。先に見せた（early）ときは、組んだ表示枠がもう表に出ている
        const swap = !result.unchanged && !result.early
        const fresh = !result.unchanged
        // 紙面の欄にフォーカスがあれば、組み直した紙面の同じ欄に移し直す（要素が作り直されて、フォーカスが失われないように）
        const focused = swap ? this.paperFocus() : null
        if (swap) this.renderer.swap(this.page)
        else if (result.early) this.renderer.show(this.page)
        this.shownReport = rendered
        // 削除したものが出てこない紙面になったら、隠すのをやめる（組み始めたあとに削除したものは、まだ隠しておく。元に戻したものは隠さない）
        const shown = bodyIds(rendered)
        const now = bodyIds(this.report)
        for (const id of this.removed) if (!shown.has(id) || now.has(id)) this.removed.delete(id)
        this.hideRemoved()
        if (fresh) {
          markFocusable(this.viewport)
          if (focused) this.focusPaper(focused.key, focused.visible)
          this.markPrintSkip()
        }
        // 書き終えた欄の仮の表示を外す（その変更を含む紙面が出た）
        this.clearFrozen(seq)
        this.pagesLeft = null
        // 原稿を丸ごと入れ替えた：入れ替えた原稿の紙面が出た
        if (this.replacing !== null && seq >= this.replacing) this.replacing = null
      }
    } finally {
      this.rendering = false
      // 組めなかったときは、削除したものを隠し続けない（紙面を押せなくならないように）。書き終えた欄の仮の表示も外す
      if (!done) {
        if (this.removed.size > 0) {
          this.removed.clear()
          this.hideRemoved()
        }
        this.clearFrozen(Infinity)
        this.replacing = null
      }
    }
    if (skipped) {
      this.renderAgain = false
      void this.render()
      return
    }
    this.markSelection()
    this.runChecks()
    // 入力欄を開いたまま書く先を移していた：組み直した紙面に、その箇所が出たら合わせる
    const continuing = this.continuing
    if (continuing && this.overlay.blockId === continuing.id && this.renderer.pageView.fragments(continuing.id).length > 0) {
      this.settleContinued(continuing.id)
    } else if (this.pendingOpen && !this.renderAgain && this.renderer.pageView.fragments(this.pendingOpen.id).length > 0) {
      // 続けてもう一度組み直す場合や、開く予定の箇所がまだ紙面にない場合は、次の組版の後で開く
      const { id, caret } = this.pendingOpen
      this.pendingOpen = null
      this.openEditor(id, caret)
    } else if (this.overlay.blockId) {
      this.followCaret()
    }
    // スマホ：組み直した紙面が書いた字に追いついたら、打った字をその場で見せていた写しをやめて、紙面の段落を見せる
    this.syncLive()
    // 開いた直後に頼まれていたページへの移動（すべて組み終えたので、まだならここで移る）
    this.flushQueuedNav()
    // 元に戻した所を、組み直した紙面で見せる（続けてもう一度組み直すときは、その後で。戻したあとにほかを変えていたら見せない）
    const undone = this.undone
    if (undone && !this.renderAgain) {
      this.undone = null
      if (rendered === this.report) this.showUndone(undone)
    }
    this.notify()
    if (this.renderAgain) {
      this.renderAgain = false
      void this.render()
    }
  }

  // ---- セルフチェック ----

  private runChecks(): void {
    // ひな形を作る画面では、チェックをしない（学生の原稿ではないので、赤い印も出さない）
    if (this.template) {
      this.findings = []
      this.acknowledged = []
      this.refreshHighlights()
      return
    }
    // 先に見せたページのほかを組んでいる間は、紙面の情報（ページ数など）を使うチェックはしない（組み終えてからする）
    // 本文の段落に「Ⅲ．まとめ」と打っている途中：見出しになると消える番号（Ⅲ）には「機種依存文字を使わない」を出さない（checkReportDetailed の typing）
    const id = this.overlay.blockId
    const editing = id ? ops.findEditable(this.report, id) : undefined
    const typing = id && editing?.kind === 'paragraph' ? { id, text: editing.text, heading: this.headingOf(id, editing.text) } : null
    const checked = checkReportDetailed(this.report, this.config, this.provisional ? null : this.layout, typing)
    // 書いている途中の段落は「空の段落がある」と言わない（閉じても空のままなら言う）
    const writing = this.writingBlankIds()
    this.findings = writing.size ? checked.findings.filter((f) => !(f.ruleId === 'paragraph-empty' && f.blockId && writing.has(f.blockId))) : checked.findings
    this.acknowledged = checked.acknowledged
    this.refreshHighlights()
  }

  /**
   * 書いている途中の段落（「空の段落がある」と言わないもの）：入力欄を開いている段落と、書いている見出しのすぐ後ろの空の段落
   * （「大見出し」を足すと、見出しを書いている間に、付いてきた空の段落のことを言っていたため。見出しで Enter を押すと、その段落へ移る）
   */
  private writingBlankIds(): Set<string> {
    const id = this.overlay.blockId
    const kind = id ? ops.findEditable(this.report, id)?.kind : undefined
    if (!id || !kind) return new Set()
    if (kind === 'chapter' || kind === 'subheading') {
      const blank = ops.blankParagraphAfterHeading(this.report, id)
      return new Set(blank ? [blank] : [])
    }
    return new Set([id])
  }

  private refreshHighlights(): void {
    // 空いている欄（タイトル・表紙の項目など）のエラーは、欄を赤い点線と赤い字で示す
    for (const el of this.viewport.querySelectorAll('.has-issue')) el.classList.remove('has-issue')
    for (const f of this.findings) {
      if (f.severity === 'error' && f.blockId && f.start === undefined) for (const el of this.renderer.pageView.fragments(f.blockId)) el.classList.add('has-issue')
    }
    this.highlights.error.clear()
    this.highlights.warning.clear()
    for (const f of this.findings) {
      if (!f.blockId || f.start === undefined || f.end === undefined) continue
      const target = f.severity === 'error' ? this.highlights.error : this.highlights.warning
      if (f.blockId === this.overlay.blockId) {
        const range = this.overlay.range(f.start, f.end)
        if (range) target.add(range)
      } else {
        for (const range of this.renderer.pageView.ranges(f.blockId, f.start, f.end)) target.add(range)
      }
    }
  }

  /** 指摘にマウスを乗せたとき、紙面の該当箇所を強調する */
  focusFinding(finding: ReportFinding | null): void {
    this.highlights.focus.clear()
    if (!finding?.blockId) return
    if (finding.start !== undefined && finding.end !== undefined) {
      for (const r of this.renderer.pageView.ranges(finding.blockId, finding.start, finding.end)) this.highlights.focus.add(r)
    }
  }

  /** ブロックの文字位置 offset があるページ（0 から）。紙面になければ -1 */
  pageOfBlock(blockId: string, offset = 0): number {
    return this.renderer.pageView.pageOfOffset(blockId, offset)
  }

  /** page ページ目（0 から）で始まる欄のうち、いちばん上のものの ID（なければ null。最後に見ていたページを覚える目印に使う） */
  firstBlockOn(page: number): string | null {
    const view = this.renderer.pageView
    for (const el of view.pages()[page]?.querySelectorAll<HTMLElement>('[data-block-id]') ?? []) {
      const id = el.dataset.blockId!
      if (view.pageOfOffset(id, 0) === page) return id
    }
    return null
  }

  /** 指摘の箇所があるページ（0 から。offset：段落の中の何文字目のページか。ふだんは指摘の初め）。わからなければ -1 */
  pageOfFinding(finding: ReportFinding, offset = finding.start ?? 0): number {
    if (finding.blockId) {
      const page = this.renderer.pageView.pageOfOffset(finding.blockId, offset)
      if (page >= 0) return page
    }
    return this.pageOfArea(finding.area, finding.photoPage)
  }

  /** 種類（表紙・抄録など）の最初のページ（0 から。なければ -1）。作品写真は photoPage ページ目（0 から。mockups/v38 案A） */
  pageOfArea(area: string, photoPage?: number): number {
    const kinds = this.layout?.kinds ?? []
    if (area === 'photos' && photoPage !== undefined) {
      const page = pageOfPhotoPage(kinds, photoPage)
      if (page >= 0) return page
    }
    return kinds.indexOf(area as never)
  }

  /**
   * 目次の行から、その見出しへ移って書き始める（mockups/v41 案C。行き先は目次の行の data-toc-target：見出しの ID）。
   * 見出しの終わりにカーソルを置き、画面の下に「この見出しを直すと、目次も変わります」と知らせる。
   * 引用・参考文献の行は、そのページへ移るだけ（引用・参考文献は、そのページを押して開く窓で書く）
   */
  async goToHeading(id: string): Promise<void> {
    if (id === REFERENCES_ANCHOR) {
      const page = this.pageOfArea('references')
      if (page >= 0) await this.goToPage(page, 'fade')
      return
    }
    const editable = ops.findEditable(this.report, id)
    const page = this.pageOfBlock(id)
    if (!editable || page < 0) return
    await this.goToPage(page, 'fade')
    const view = this.renderer.pageView
    const fragment = view.fragments(id).find((f) => view.pageIndexOf(f) === this.page)
    if (this.stage.zoomed) fragment?.scrollIntoView({ block: 'center' })
    // スマホ：見出しのページへ移り、見出しを少しの間光らせるだけ（書き始めない。キーボードを出さない）。書き直すときは、見出しをもう一度押す
    // （前は押すと書き始めてキーボードが出たが、見出しへ移りたいだけのことが多かった：はじめて使う学生の試し 2026-10-21・mockups/v48 B）
    if (this.phone) {
      const heading = fragment?.closest<HTMLElement>('h1, h2') ?? fragment
      if (heading) {
        heading.classList.remove('toc-glow')
        void heading.offsetWidth
        heading.classList.add('toc-glow')
        window.setTimeout(() => heading.classList.remove('toc-glow'), TOC_ARRIVE_MS)
      }
      this.showNotice(TOC_TEXT.jumpedPhone)
      return
    }
    requestAnimationFrame(() => {
      this.openEditor(id, editable.text.length)
      // 移った見出しを少しの間うすく光らせる（どこへ移ったか分かるように。スマホは下の書く欄が開くので光らせない）
      if (this.overlay.blockId === id && !this.overlay.inSheet) {
        const el = this.overlay.element
        el.classList.remove('toc-arrived')
        void el.offsetWidth
        el.classList.add('toc-arrived')
        window.setTimeout(() => el.classList.remove('toc-arrived'), TOC_ARRIVE_MS)
      }
      this.showNotice(TOC_TEXT.jumped)
    })
  }

  /**
   * スマホ：指で押した点に近い目次の行（行の上下 10px まで。紙面の目次の行は細く、少しずれて押すと行のない所になるため）。なければ null
   */
  private tocLineNear(x: number, y: number): HTMLElement | null {
    const page = this.renderer.pageView.pages()[this.page]
    let best: { el: HTMLElement; d: number } | null = null
    for (const el of page?.querySelectorAll<HTMLElement>('[data-toc-target]') ?? []) {
      const r = el.getBoundingClientRect()
      if (x < r.left - 10 || x > r.right + 10) continue
      const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0
      if (d <= 10 && (!best || d < best.d)) best = { el, d }
    }
    return best?.el ?? null
  }

  /**
   * 指摘の箇所へ移動する（文字の指摘なら入力欄を開く）。
   * カーソルは指摘の文字の後ろに置く（Backspace でそのまま消して打ち直せるように。依頼者の要望）。位置だけの指摘（「。」がない など）は、その位置
   */
  async goToFinding(finding: ReportFinding): Promise<void> {
    const caret = finding.end ?? finding.start ?? 0
    const page = this.pageOfFinding(finding, caret)
    if (page < 0) return
    await this.goToPage(page, 'fade')
    const id = finding.blockId
    if (!id) return
    const fragment = this.renderer.pageView.fragments(id).find((f) => this.renderer.pageView.pageIndexOf(f) === this.page)
    if (this.stage.zoomed) fragment?.scrollIntoView({ block: 'center' })
    if (fragment && ops.findEditable(this.report, id)) requestAnimationFrame(() => this.openEditor(id, caret))
  }

  // ---- ページ送り ----

  /**
   * page ページ目（0 から）を表示する。
   * turn：隣のページは本のようにめくる（離れたページはふわっと切り替える）／fade：ふわっと切り替える／none：すぐ切り替える
   */
  goToPage(index: number, effect: PageEffect = 'turn'): Promise<void> {
    const to = Math.max(0, Math.min(index, this.renderer.pageCount() - 1))
    if (this.provisional) {
      // 開いたときに先に見せたページのほかを、まだ組んでいる。組み終えたときに、覚えていたページへ戻さない（movedSinceFirstShow）
      this.turnQueued = true
      // 移る先のページをまだ組んでいない（中が空）：そのページを組み終えたら、すぐ移る。何度押しても移るのは1回（最後に頼んだページへ。flushQueuedNav）。
      // 前は、すべて組み終えるまで（スマホで十数秒）待ってから移っていた
      if (!this.pageReady(to)) {
        this.queuedNav = { index: to, effect }
        return new Promise((resolve) => this.queuedNavDone.push(resolve))
      }
      // 組み終えたページへ移るなら、それまでに頼まれていた、まだ組んでいないページへの移動はやめる
      this.cancelQueuedNav()
    }
    // めくっている途中に、また送るよう頼まれた：いまの動きをすぐ終えて、続けて送る（押した数だけ送る。前は、めくっている間に押しても送らなかった）
    if (this.turning) {
      this.queuedTurn = { index: to, effect }
      this.renderer.hurryTurn()
      return this.turning.then(() => this.turning ?? undefined)
    }
    if (to === this.page || to < 0) return Promise.resolve()
    if (this.overlay.blockId) this.overlay.commit()
    // 見開きで、並べている隣のページへ移るだけなら、紙面はそのまま（書き終えた欄の仮の表示も残す）
    const samePair = this.samePair(to, this.page)
    this.clearFrozen(Infinity, (f) => samePair && this.samePair(f.place.page, to))
    this.marker.hidden = true
    this.selection = null
    this.markSelection()
    // 紙面で選んでいた文字は、見えなくなるページにあれば選ぶのをやめる（見えないまま Delete で消してしまわないように）
    if (!samePair) this.clearPaperSelection()
    this.suppressSelectionBar()
    const from = this.page
    // 紙面の欄にフォーカスがあったら、送った先のページの最初の欄に移す（前のページは隠れて、フォーカスが失われるため）
    const focused = this.paperFocus()
    this.page = to
    // スマホ：拡大したまま移ると、送った先のページの一部（作品写真のページでは白い所）しか見えず、ページ送りと帯も隠れたままだった。
    // ページを替えたら、ページ全体の表示に戻す（指摘へ移って書き始めるときは、書く欄を開くときにまた拡大する）
    if (this.phone && this.stage.zoomed) this.stage.setZoom(false)
    this.setRevealRoom(0, 0)
    this.scroller.scrollTop = 0
    this.turning = this.renderer.turn(from, to, effect).finally(() => {
      this.turning = null
      if (focused) this.focusPaper(null, focused.visible)
      this.notify()
      // めくっている間に、続けて送るよう頼まれていた
      const next = this.queuedTurn
      this.queuedTurn = null
      if (next) void this.goToPage(next.index, next.effect)
    })
    this.notify()
    return this.turning
  }

  /** めくっている間に頼まれた、次のページ送り（めくり終えたら、続けて送る） */
  private queuedTurn: { index: number; effect: PageEffect } | null = null

  /** 頼まれている移動の行き先（めくっている途中・組み終えるのを待っているなら、その行き先。なければ見ているページ） */
  private get pageAhead(): number {
    return this.queuedTurn?.index ?? this.queuedNav?.index ?? this.page
  }

  nextPage(): void {
    void this.turnBy(1)
  }

  prevPage(): void {
    void this.turnBy(-1)
  }

  /**
   * 次（dir が 1）・前（-1）のページへ送る。見開きのときは2ページずつ（次・前の組の左のページへ。1–2 → 3–4）。
   * 最初・最後のページ（組）から先へは送らない
   */
  turnBy(dir: 1 | -1): Promise<void> {
    const at = this.pageAhead
    const to = this.stage.spread ? at - (at % 2) + 2 * dir : at + dir
    if (to < 0 || to > this.renderer.pageCount() - 1) return Promise.resolve()
    return this.goToPage(to)
  }

  // ---- 見開き（mockups/v35 ③ 案A。PC だけ） ----

  /** 見開きで、a ページ目と b ページ目が同じ組（1–2、3–4…。0 からの番号では 0–1、2–3…）として並んでいるか（見開きでなければ false） */
  private samePair(a: number, b: number): boolean {
    return this.stage.spread && a >= 0 && b >= 0 && a - (a % 2) === b - (b % 2)
  }

  /** page ページ目（0 から）が、いま紙面に見えているか（見開きなら、並べている2ページのどちらか） */
  private isVisiblePage(page: number): boolean {
    return page >= 0 && (page === this.page || this.samePair(page, this.page))
  }

  /**
   * page ページ目を、めくらずに見せる（書く位置・カーソルが別のページへ移ったとき）。
   * 見開きで、並べている隣のページなら、紙面はそのままで、書くページだけを替える（書き終えた欄の仮の表示も残す）
   */
  private showPage(page: number, effect: 'none' | 'fade' = 'none'): void {
    const shown = this.isVisiblePage(page)
    this.page = page
    if (shown) return this.renderer.show(page)
    this.clearPaperSelection()
    this.clearFrozen(Infinity)
    this.setRevealRoom(0, 0)
    this.scroller.scrollTop = 0
    this.renderer.show(page, effect)
  }

  /** 見開きにした・やめたら、紙面の組版の表示に伝え、並べるページの印を付け直す（めくっている途中なら、めくり終えたときに付く） */
  private syncSpread(): void {
    const on = this.stage.spread
    if (this.renderer.spread === on) return
    this.renderer.spread = on
    if (!this.turning) this.renderer.show(this.page)
  }

  /** 種類（表紙・抄録など）の最初のページへ */
  goToArea(area: string): void {
    const index = this.layout?.kinds.indexOf(area as never) ?? -1
    if (index >= 0) void this.goToPage(index, 'fade')
  }

  /** 全体（1ページ全体を表示）と拡大（横幅いっぱい）を切り替える（見開きはやめる） */
  setZoom(zoomed: boolean): void {
    this.setView(zoomed ? 'zoom' : 'fit')
  }

  /**
   * 表示の仕方を変える：全体（1ページ全体）・見開き（いまのページと次のページを並べる。PC だけ。mockups/v35 ③ 案A）・拡大（横幅いっぱい）。
   * 見開きは、台が狭いとき（spreadFits でない）は全体にする
   */
  setView(view: 'fit' | 'spread' | 'zoom'): void {
    this.setRevealRoom(0, 0)
    this.scroller.scrollTop = 0
    this.scroller.scrollLeft = 0
    if (view === 'spread') this.stage.setSpread(true)
    else this.stage.setZoom(view === 'zoom')
  }

  /** 紙面のまわりに空ける幅（台の CSS の変数）を変えたとき、紙面の倍率と位置を求め直す（スマホの紙面の下の帯。app/PageBand.tsx） */
  refitPage(): void {
    this.stage.fit()
  }

  /**
   * スマホ：書く欄を画面の下に出す（host はその中の、入力欄を置く要素）。null なら紙面に重ねる（PC）。
   * direct：スマホで紙面に直接書く（スマホのふつう。app/phoneDirect.ts）。段落・見出し・図表のタイトル・表のセル・表紙の項目を、
   * PC と同じく紙面に重ねた書く欄で書く（紙面を拡大して）。host は、予備の ?direct=0 の端末で、下から出る書く欄にするときに使う
   */
  setSheetHost(host: HTMLElement | null, direct = false): void {
    this.hideStyle.textContent = ''
    this.sheetHostEl = host
    this.direct = !!host && direct
    // 書いていた欄は、段落のまま確定する（画面の並べ方が変わっただけで、見出しにしない）
    this.keepParagraph = true
    try {
      this.overlay.setSheetHost(this.direct ? null : host, this.direct)
    } finally {
      this.keepParagraph = false
    }
    // 画面の並べ方が変わると紙面のまわりの余白も変わるため、倍率を求め直す
    this.setZoom(false)
    this.notify()
  }

  /** スマホの書く欄を置く要素（PC は null） */
  private sheetHostEl: HTMLElement | null = null
  /** スマホで紙面に直接書く（setSheetHost。予備の ?direct=0 の端末では false） */
  private direct = false

  /** スマホの並べ方か（紙面で直接書く・予備の下の欄で書く、のどちらも） */
  private get phone(): boolean {
    return this.sheetHostEl !== null
  }

  /** スマホ：いま、紙面に重ねた書く欄で書いているか */
  private get writingOnPaper(): boolean {
    return this.direct && !this.overlay.inSheet && !!this.overlay.blockId
  }

  /** スマホ：紙面に直接書く欄か（紙面で直接書く端末では、書ける欄はすべて。段落・見出し・図表のタイトル・表のセル・表紙の項目） */
  private writesOnPaper(id: string): boolean {
    return this.direct && !!ops.findEditable(this.report, id)
  }

  /**
   * スマホ：書く欄を、紙面に重ねるか下の欄に置く（書き始める前に。置き場所を替えるときは、書いていた欄を書き終える）。
   * 紙面で直接書く端末では、いつも紙面に重ねる（下の欄に置くことはない）
   */
  private placeEditorFor(id: string): void {
    if (!this.direct) return
    const onPaper = this.writesOnPaper(id)
    if (this.overlay.inSheet === !onPaper) return
    this.overlay.setSheetHost(onPaper ? null : this.sheetHostEl, onPaper)
  }

  /**
   * スマホ：紙面に直接書き始める前に、紙面を拡大する（本文の幅を画面の幅に合わせる。スマホの「拡大」と同じ：pageStage.ts の --zoom-to-text）。
   * 書いている間に指で広げた・縮めた大きさを覚えていれば、その大きさにする（押した点が指の下から横に動かないように。editor/pinchZoom.ts）。
   * 入力欄の位置と倍率は、拡大したあとの紙面で測る
   */
  private zoomForPaper(): void {
    if (this.stage.zoomed) return
    this.setRevealRoom(0, 0)
    this.scroller.scrollTop = 0
    this.scroller.scrollLeft = 0
    const ratio = loadWritingZoom()
    // 拡大しない（ページ全体の大きさのまま書く）：拡大の表示のまま倍率だけ1ページ全体にする（書いている行は、紙面を送って見せる：revealCaret・scrollPaperTo）
    if (ratio === 0) return this.stage.setFreeZoom(this.stage.fitScale)
    if (Math.abs(ratio - 1) < 0.04) return this.stage.setZoom(true)
    const page = this.renderer.pageView.pages()[this.page]
    const before = page?.getBoundingClientRect()
    const tap = this.lastTap && performance.now() - this.lastTap.time < 1000 ? this.lastTap : null
    const s0 = this.stage.scale
    // 押した点の、紙面の上の横の位置（押していなければ、本文の左の端）
    const cx = tap && before ? (tap.x - before.left) / s0 : TEXT_LEFT
    this.stage.setFreeZoom(this.stage.textScale * ratio)
    const after = page?.getBoundingClientRect()
    if (!this.stage.panX || !after) return
    const x = tap ? tap.x : this.scroller.getBoundingClientRect().left + 10
    this.scroller.scrollLeft += after.left + cx * this.stage.scale - x
  }

  /**
   * スマホ：書く欄の「完了」。書き終えて、紙面を1ページ全体の表示に戻す（書いていたページ）。
   * 紙面で直接書くときも同じ（試作では拡大したままにしていたが、「ページ全体に戻す」を押すのが分かりにくかった。依頼者の判断）
   */
  finishEditing(): void {
    const onPaper = this.writingOnPaper
    const sheet = this.overlay.inSheet
    this.overlay.commit()
    // キーボードを閉じる（紙面に重ねた書く欄は閉じて隠れているが、フォーカスが残っていることがあるため）
    if (onPaper && document.activeElement === this.overlay.element) this.overlay.element.blur()
    if (onPaper || sheet) this.setZoom(false)
  }

  /** スマホの道具の「戻す」：書く欄の中で書いた文字を戻す（戻せたら true。なければ、呼び出し側が原稿を戻す） */
  undoTyping(): boolean {
    return this.overlay.undoTyping()
  }

  /** スマホの道具の「やり直す」：書く欄の中で戻した文字を、もう一度入れる（入れたら true） */
  redoTyping(): boolean {
    return this.overlay.redoTyping()
  }

  /**
   * スマホ：書いている欄を見せてよい、画面の中の高さの範囲（画面の上からの px）を返す関数（画面の部品が渡す：app/writingArea.ts）。
   * 上に出ているはじめての案内より下、下から出る書く欄・キーボードより上。field：書いている欄の紙面での位置
   */
  private visibleArea: ((field: DOMRect) => { top: number; bottom: number }) | null = null

  setVisibleArea(area: ((field: DOMRect) => { top: number; bottom: number }) | null): void {
    this.visibleArea = area
  }

  /** 書いている欄を見せるために、紙面の上・下に足している余白（px。revealEditing） */
  private revealTop = 0
  private revealBottom = 0

  /** 紙面の上・下に足す余白を変える（紙面の表示枠の CSS の変数 --reveal-top・--reveal-bottom。index.css） */
  private setRevealRoom(top: number, bottom: number): void {
    if (top === this.revealTop && bottom === this.revealBottom) return
    this.revealTop = top
    this.revealBottom = bottom
    for (const [name, px] of [['--reveal-top', top], ['--reveal-bottom', bottom]] as const) {
      if (px) this.scroller.style.setProperty(name, `${px}px`)
      else this.scroller.style.removeProperty(name)
    }
    this.placeContinueRow()
  }

  /**
   * スマホ：書いている欄が、紙面の見えている所（上の案内・下の書く欄・キーボードに隠れていない所）の上の方に来るよう、紙面を動かす。
   * 前は台の上の端に合わせていたため、はじめての案内でサブタイトルを書くとき、案内の下に隠れて、どこに入るのか見えなかった。
   * 紙面の上の端・下の端で動かしきれないとき（表紙の上の方の欄など）は、紙面の上（下）に余白を足してずらす（全体の表示に戻す・ページを替えると、なくす）。
   * force が false なら、欄がもう見えているときは動かさない（書く欄の高さやキーボードが変わったとき。学生が自分で動かした位置を崩さないように）
   */
  revealEditing(force = true): void {
    // 紙面で直接書く：紙面に重ねた書く欄の、カーソルの行を見せる
    if (this.writingOnPaper) return this.revealCaret()
    const id = this.overlay.blockId
    if (!id || !this.overlay.inSheet || !this.stage.zoomed) return
    const view = this.renderer.pageView
    const fragment = view.fragments(id).find((f) => view.pageIndexOf(f) === this.page)
    // 打った字をその場で見せているときは、その写しの見えている所（紙面の段落は、組み直すまで前の字のままで、隠している）
    const live = this.overlay.liveRect()
    const caret = this.overlay.liveCaretRect()
    const r = live ?? fragment?.getBoundingClientRect()
    if (!r) return
    const { top, bottom } = this.paperArea(r)
    const height = r.bottom - r.top
    const shown = (a: { top: number; bottom: number }) => a.top >= top + 2 && a.bottom <= bottom - 2
    // 写しを見せているときは、書いている行（写しのカーソルの行）が見えていれば、段落の全部が見えていなくても動かさない
    if (!force && (shown(r) || (caret && shown(caret)))) return
    // 欄の上端を、見えている所の上から少し下に（見えている所が低いときは、上下の真ん中あたりに。欄のほうが高いときは、上端に合わせる）
    const margin = Math.max(2, Math.min(16, (bottom - top - height) / 2))
    let delta = r.top - (top + margin)
    // 書いている行が下に隠れるなら、その行が見える所まで（段落の上の方は隠れてもよい）
    if (caret && caret.bottom - delta > bottom - 2) delta = caret.bottom - (bottom - Math.min(margin, 8))
    // 余白を足さない紙面での、移したいスクロールの位置（負なら、その分だけ紙面の上に余白を足す）
    this.scrollPaperTo(this.scroller.scrollTop - this.revealTop + delta)
  }

  /**
   * 紙面で直接書く：書き始めたとき、カーソルの行を置く高さ（画面の上からの px。押した点。NaN：見えている所の上の方。null：隠れていれば見せるだけ）。
   * revealCaret が1回使ったら null に戻す。図表のタイトルは、高さの代わりに、図・表とタイトルの行が一緒に見えるように置く
   */
  private revealAt: number | null = null
  /** 紙面で直接書く：紙面を押した点と時刻（押して書き始めたとき、押した行を指の下に置くため） */
  private lastTap: { x: number; y: number; time: number } | null = null
  /** 紙面で直接書く：入れたばかりの図・表のタイトル（紙面に出たら、図・表と一緒に見せる：settleContinued） */
  private revealObjectFor: string | null = null
  /**
   * 紙面で直接書く：図・表と一緒に見せた、入れたばかりのタイトル。書き始めるまでは、キーボードの上の道具の高さが変わっても（表の道具は2段）、
   * 図・表が隠れないように見せ直す（前は1段の道具の高さで見せたので、入れた素材表が2段の道具の下に隠れていた：はじめて使う学生の試し 2026-10-21）
   */
  private keepObjectShown: string | null = null
  /** 表の行・列を消す前に書いていたマスと位置（知らせの「戻す」で行・列を戻したら、そのマスを書き続ける） */
  private tableCutFrom: { id: string; caret: number } | null = null
  private caretFrame = 0

  /** 紙面で直接書く：次の絵を描く前に、カーソルの行が見えているか確かめる（打った・カーソルを動かした・行が増えた。何回呼ばれても1回） */
  private scheduleCaretReveal(): void {
    if (this.caretFrame) return
    this.caretFrame = requestAnimationFrame(() => {
      this.caretFrame = 0
      if (this.writingOnPaper) this.revealCaret()
    })
  }

  /**
   * 紙面で直接書く：書いているカーソルの行が、紙面の見えている所（上の帯より下、キーボードの上の道具・キーボードより上）に来るよう、紙面を動かす。
   * 書き始めたとき（revealAt）は、押した行を押した高さに置く（キーボードがまだ出ていなければ、キーボードに隠れない上の方に）。
   * 図のタイトルは、タイトルの行をキーボードに隠れない所に置き、その上の図をできるだけ見せる（図が高すぎれば、タイトルの行を優先）。
   * 表のタイトルは、タイトルの行を上の方に置き、その下の表をできるだけ見せる。
   * それ以外は、隠れているときだけ動かす（学生が自分で動かした位置を崩さないように）。指で広げて紙面が画面より広いときは、横にも動かす
   */
  private revealCaret(): void {
    const at = this.revealAt
    this.revealAt = null
    const id = this.overlay.blockId
    if (!id || !this.stage.zoomed || this.turning) return
    const box = this.overlay.element.getBoundingClientRect()
    // 何も書いていない欄（足したばかりのタイトル・空の表紙の項目など）は、カーソルの四角が取れないので、欄の四角（1行）で決める
    const caret = this.overlay.caretClientRect() ?? (box.height > 0 ? { left: box.left, top: box.top, bottom: box.bottom } : null)
    if (!caret) return
    const { top, bottom } = this.paperArea({ left: box.left, top: caret.top, right: box.right, bottom: caret.bottom })
    const line = caret.bottom - caret.top
    if (bottom - top < line + 4) return
    const margin = Math.min(12, (bottom - top - line) / 2)
    const kind = ops.findEditable(this.report, id)?.kind
    if (this.keepObjectShown !== id) this.keepObjectShown = null
    const object = at !== null || this.keepObjectShown === id ? this.captionObject(id, kind) : null
    let delta: number | null = null
    if (object) {
      const safe = this.keyboardSafeBottom(top, bottom) - margin
      // 動かす量の範囲 [lo, hi] のうち、いちばん小さく動かす量（範囲がなければ、タイトルの行を優先）
      const [lo, hi] = kind === 'figureCaption' ? [caret.bottom - safe, object.top - (top + margin)] : [object.bottom - safe, caret.top - (top + margin)]
      delta = lo <= hi ? Math.min(Math.max(0, lo), hi) : kind === 'figureCaption' ? lo : hi
    } else if (at !== null) {
      const limit = this.keyboardSafeBottom(top, bottom) - margin - line
      const y = Number.isNaN(at) ? top + (bottom - top) * 0.3 : at - line / 2
      delta = caret.top - Math.max(top + margin, Math.min(y, limit))
    } else if (caret.bottom > bottom - 2) delta = caret.bottom - (bottom - margin)
    else if (caret.top < top + 2) delta = caret.top - (top + margin)
    if (delta !== null && Math.abs(delta) >= 1) this.scrollPaperTo(this.scroller.scrollTop - this.revealTop + delta)
    // 指で広げて紙面が画面より広い：カーソルが左右に隠れていれば、横にも動かす
    if (this.stage.panX) {
      const s = this.scroller.getBoundingClientRect()
      const edge = Math.min(48, s.width / 4)
      if (caret.left < s.left + edge / 2) this.scroller.scrollLeft -= s.left + edge - caret.left
      else if (caret.left > s.right - edge / 2) this.scroller.scrollLeft += caret.left - (s.right - edge)
    }
  }

  /**
   * キーボードに隠れない、見えている所の下端（画面座標）。キーボードがまだ出ていなければ、出たときに隠れない高さの見込み
   * （キーボードは画面の高さの 4 割ほど。その上の道具の分も見込む）
   */
  private keyboardSafeBottom(top: number, bottom: number): number {
    const vv = window.visualViewport
    if (vv && vv.height < window.innerHeight * 0.85) return bottom
    return Math.max(top + 40, Math.min(bottom, window.innerHeight * 0.6 - 56))
  }

  /** 図・表のタイトル id と一緒に見せる、見ているページの図（写真）・表の上端と下端（画面座標。タイトルでなければ null） */
  private captionObject(id: string, kind: ops.EditableKind | undefined): { top: number; bottom: number } | null {
    if (kind !== 'figureCaption' && kind !== 'tableCaption') return null
    const view = this.renderer.pageView
    const e = CSS.escape(id)
    const selector = kind === 'figureCaption' ? `figure[data-figure-id="${e}"] > :is(img, .figure-slot)` : `.data-table[data-table-id="${e}"] table`
    const rects = [...this.viewport.querySelectorAll<HTMLElement>(selector)]
      .filter((el) => view.pageIndexOf(el) === this.page)
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.height > 0)
    if (!rects.length) return null
    return { top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)) }
  }

  // ---- スマホ：2本の指で紙面を広げる・縮める（依頼者の要望。指の動きは editor/pinchZoom.ts） ----
  // 指を置いている間は、紙面の表示枠と重ねる層を CSS の transform で広げて見せる（組み直さないので、なめらか）。
  // 指を離したら、本当の倍率にして（pageStage.ts の setFreeZoom）、指の間にあった紙面の点が、指の間の点に来るように紙面を動かす。
  // 1ページ全体の倍率より小さくはしない（近ければ全体の表示に戻す）。上限は、本文の幅に合わせる倍率の3倍（pageStage.ts の PINCH_MAX）。
  // 紙面で直接書いている間に広げた・縮めた大きさは覚えておき、次に段落を押して書き始めるときも、その大きさにする（zoomForPaper）

  /** 指で広げている途中：始めの倍率 s0・始めに指の間にあった紙面の点 c（縮小前の px）・始めの指の間の点 mid0・いまの倍率の比 k と指の間の点 mid */
  private pinch: { s0: number; c: Point; mid0: Point; k: number; mid: Point } | null = null

  private pinchStart(mid: Point): boolean {
    if (this.turning || this.removed.size > 0) return false
    const page = this.renderer.pageView.pages()[this.page]?.getBoundingClientRect()
    if (!page?.width) return false
    const s0 = this.stage.scale
    this.pinch = { s0, c: { x: (mid.x - page.left) / s0, y: (mid.y - page.top) / s0 }, mid0: mid, k: 1, mid }
    // 指で押した点は使わない（広げ終えたあとのタップで、書き始める欄を決めるのに使わないように）。写真を動かし始めていたら、やめる
    this.touchPoint = null
    this.cancelPhotoDrag()
    this.suppressSelectionBar()
    this.marker.hidden = true
    const st = this.stageEl.getBoundingClientRect()
    for (const el of [this.scroller, this.layer]) {
      el.style.transformOrigin = `${mid.x - st.left}px ${mid.y - st.top}px`
      el.style.willChange = 'transform'
    }
    return true
  }

  private pinchMove(k: number, mid: Point): void {
    const p = this.pinch
    if (!p) return
    p.k = this.stage.clampPinch(p.s0 * k) / p.s0
    p.mid = mid
    const transform = `translate(${mid.x - p.mid0.x}px, ${mid.y - p.mid0.y}px) scale(${p.k})`
    for (const el of [this.scroller, this.layer]) el.style.transform = transform
  }

  private pinchEnd(): void {
    const p = this.pinch
    this.pinch = null
    if (!p) return
    for (const el of [this.scroller, this.layer]) {
      el.style.transform = ''
      el.style.transformOrigin = ''
      el.style.willChange = ''
    }
    this.applyPinch(p.s0 * p.k, p.c, p.mid)
  }

  /**
   * 指を離した：紙面を倍率 scale にし、紙面の点 c（縮小前の px）が画面の点 at に来るよう、紙面を動かす。
   * 1ページ全体の倍率に近ければ、全体の表示に戻す。紙面で直接書いている間なら、その大きさを覚える
   */
  private applyPinch(scale: number, c: Point, at: Point): void {
    const writing = this.writingOnPaper
    const toFit = scale <= this.stage.fitScale * 1.03
    if (toFit && !writing) {
      if (this.stage.zoomed) this.setZoom(false)
      this.notify()
      return
    }
    // 書いている間にページ全体まで縮めた：ページ全体の大きさのまま書き続ける（拡大の表示のまま。書いている行を紙面を送って見せられるように）
    this.stage.setFreeZoom(toFit ? this.stage.fitScale : scale)
    const page = this.renderer.pageView.pages()[this.page]?.getBoundingClientRect()
    if (page) {
      const s = this.stage.scale
      if (this.stage.panX) this.scroller.scrollLeft += page.left + c.x * s - at.x
      else this.scroller.scrollLeft = 0
      this.scrollPaperTo(this.scroller.scrollTop - this.revealTop + (page.top + c.y * s - at.y))
    }
    // ページ全体まで縮めたら「拡大しない」を覚える（次からページ全体のまま書く：依頼者の選択 2026-10-22）
    if (writing) saveWritingZoom(toFit ? 0 : this.stage.scale / this.stage.textScale)
    this.realignOverlay()
    this.realignFrozen()
    this.placeContinueRow()
    this.notify()
  }

  /** スマホ：2本の指で紙面を広げている途中か、広げ終えた直後か（このときのタップ・はらいで、書き始めない・ページを送らない） */
  get pinching(): boolean {
    return this.pinchZoom.busy
  }

  /** スマホ：紙面のうち、書いている欄 r（画面座標）を見せてよい高さの範囲（画面座標。上の案内より下、下の書く欄・キーボードより上） */
  private paperArea(r: { left: number; top: number; right: number; bottom: number }): { top: number; bottom: number } {
    const s = this.scroller.getBoundingClientRect()
    const area = this.visibleArea?.(new DOMRect(r.left, r.top, r.right - r.left, r.bottom - r.top))
    const top = Math.max(s.top, area?.top ?? s.top)
    return { top, bottom: Math.max(top, Math.min(s.bottom, area?.bottom ?? s.bottom)) }
  }

  /**
   * スマホ：紙面を、余白を足さない紙面でのスクロールの位置 want まで動かす（revealEditing・keepCaretVisible）。
   * 上（下）に動かしきれない分は、紙面の上（下）に余白を足す。上の余白が変わると、紙面が表示枠の中で動くので、書いている欄の写しなども合わせる
   */
  private scrollPaperTo(want: number): void {
    const scroller = this.scroller
    const shift = Math.ceil(Math.max(0, -want))
    const scrollTop = Math.max(0, want)
    // 下に動かしきれない分は、紙面の下に余白を足す
    const natural = scroller.scrollHeight - this.revealTop - this.revealBottom
    const room = Math.ceil(Math.max(0, scrollTop - (shift + natural - scroller.clientHeight)))
    const moved = shift !== this.revealTop
    this.setRevealRoom(shift, room)
    scroller.scrollTop = scrollTop
    if (moved) {
      this.realignOverlay()
      this.realignFrozen()
    }
  }

  /** スマホ：次の絵を描く前に、写しに合わせてすること（runLiveFrame）を頼んである（requestAnimationFrame の番号）。shift：後ろの文章もずらす */
  private liveFrame = 0
  private liveShift = false
  /** runLiveFrame で見たカーソルの位置（打ったあとのカーソルの移動の知らせで、同じことを2回しないため） */
  private liveCaretSeen = -1

  /**
   * スマホ：打った字を写しに入れたあと、次の絵を描く前に、写しの位置を測ってすることを頼む（何字か続けて打っても1回）。
   * 打った処理の中で測ると、そのあと画面の部品を書き直したときに、画面の組み直しをもう一度することになり、遅いスマホで打つのが重くなるため
   */
  private scheduleLiveFrame(shift: boolean): void {
    this.liveShift ||= shift
    if (!this.liveFrame) this.liveFrame = requestAnimationFrame(() => this.runLiveFrame())
  }

  /**
   * スマホ：写しを見せはじめたら、後ろの文章をずらす。書いている行を見えるようにする。
   * 書いている行が本文の下へはみ出したら（PC と同じ）、そこが次のページにあれば移り、なければ打つ手が止まるのを待たずに組み直す（組み直すと次のページへ移る：followCaret）
   */
  private runLiveFrame(): void {
    this.liveFrame = 0
    const shift = this.liveShift
    this.liveShift = false
    const id = this.overlay.blockId
    if (!id || !this.overlay.live) return
    this.liveCaretSeen = this.overlay.caret
    if (shift) this.shiftFollowing()
    this.keepCaretVisible()
    if (this.turning || !this.caretBelowContent()) return
    if (this.renderer.pageView.pageOfOffset(id, this.overlay.caret) !== this.page) this.followCaret()
    else void this.render(false)
  }

  /**
   * スマホ：打った字をその場で見せているとき、書いている行（写しのカーソルの行）が、紙面の見えている所から外れたら、見える所まで紙面を動かす
   * （段落が長くなって、書いている行が下の書く欄・キーボードに隠れないように）。本文の下へはみ出した行（組み直すと次のページへ移る）は追わない
   */
  private keepCaretVisible(): void {
    if (!this.overlay.inSheet || !this.stage.zoomed || this.turning) return
    const live = this.overlay.liveRect()
    const caret = this.overlay.liveCaretRect()
    if (!live || !caret || caret.top >= live.bottom) return
    const { top, bottom } = this.paperArea(live)
    const line = caret.bottom - caret.top
    if (bottom - top < line) return
    const margin = Math.min(8, (bottom - top - line) / 2)
    const delta = caret.bottom > bottom - 2 ? caret.bottom - (bottom - margin) : caret.top < top + 2 ? caret.top - (top + margin) : 0
    if (delta) this.scrollPaperTo(this.scroller.scrollTop - this.revealTop + delta)
  }

  /** 書いている欄（入力欄・スマホの写し）を、紙面のいまの位置に合わせ直す（段落を分けたばかりで前の段落を仮に表示していれば、紙面にある元の段落から並べ直す） */
  private realignOverlay(): void {
    const id = this.overlay.blockId
    if (!id) return
    const anchor = this.continuing?.id === id && this.overlay.ghostCount > 0 ? this.continuing.anchor : null
    const anchorPlacement = anchor ? this.overlayPlacement(anchor) : null
    const placement = anchorPlacement ? null : this.overlayPlacement(id)
    if (anchorPlacement) this.overlay.restack(anchorPlacement)
    else if (placement) this.overlay.moveTo(placement)
  }

  /** いま見えている紙面の各ページの要素（ページ一覧の縮小表示に使う） */
  pageElements(): HTMLElement[] {
    return this.renderer.pageView.pages()
  }

  /**
   * PC：書いているカーソルが、見えているページの本文の領域（下の余白 25mm より上）の下へはみ出したか
   * （はみ出した文字は、組み直すと次のページへ移る。打つ手が止まるのを待たずに組み直し、次のページへ移る：followCaret）。
   * スマホも、打った字をその場で見せている写しで同じように調べる
   */
  private caretBelowContent(): boolean {
    // スマホ：打った字をその場で見せている写しの、カーソルの位置（写しを見せていなければ調べない）
    const caret = this.overlay.inSheet ? this.overlay.liveCaretRect() : this.overlay.caretRect()
    const page = this.renderer.pageView.pages()[this.page]?.getBoundingClientRect()
    if (!caret || !page || !page.height) return false
    return caret.bottom > page.top + (page.height * (297 - 25)) / 297 + 1
  }

  /**
   * スマホ：書いている段落の、打った字をその場で見せる写しを、紙面に合わせて出す・やめる（組み直した紙面が出たとき）。
   * 紙面の段落が書いた字に追いついていれば、写しをやめて紙面の段落を見せる（見た目は同じ。後ろの文章のずらしも戻す）。
   * 追いついていなければ（組んでいる間にまた打った・まだ紙面になかった段落が出たなど）、写しを見せる
   */
  private syncLive(): void {
    const id = this.overlay.blockId
    if (!id || !this.overlay.inSheet) return
    const fragments = this.renderer.pageView.fragments(id)
    const caughtUp = fragments.length > 0 && fragments.map((f) => f.textContent ?? '').join('') === this.overlay.text
    this.overlay.showLive(!caughtUp)
    // 写しを見せたままなら、組み直した紙面の段落（新しい要素）を隠し直す
    if (this.overlay.live) this.hideLive(id)
    // 追いついた紙面の段落の中身を、写しに写しておく（このあと打つときは、紙面と同じ組み方から始める）
    if (caughtUp) this.overlay.adoptPage(fragments)
  }

  /** スマホ：打った字をその場で見せている写しの代わりに、紙面で隠している段落の要素（index.css の「スマホ：打った字をその場で紙面に」） */
  private liveHidden: HTMLElement[] = []

  /**
   * スマホ：紙面の段落 id の要素を、写しを見せている間だけ隠す（null なら、隠すのをやめる）。
   * 紙面全体の書き方（style 要素）を書き換えると、紙面のすべての要素の見た目を計算し直すことになり、遅いスマホで 0.1 秒ほどかかっていたため、
   * その段落の要素にだけ印（live-hidden）を付ける
   */
  private hideLive(id: string | null): void {
    for (const el of this.liveHidden) el.classList.remove('live-hidden')
    this.liveHidden = id ? this.renderer.pageView.fragments(id) : []
    for (const el of this.liveHidden) el.classList.add('live-hidden')
  }

  /** 書いている文字が別のページへ移ったら、表示もそのページへ移り、入力欄を合わせる */
  private followCaret(): void {
    const id = this.overlay.blockId
    if (!id) return
    // 日本語の変換中は動かさない（変換の候補が見えなくなるため）
    if (!this.overlay.composing) {
      const page = this.renderer.pageView.pageOfOffset(id, this.overlay.caret)
      if (page >= 0 && page !== this.page && !this.turning) {
        // 見開きで、並べている隣のページへ続いたときは、紙面はそのまま（書くページだけを替える）
        this.showPage(page, 'fade')
        if (this.overlay.inSheet) this.revealEditing()
      }
    }
    const placement = this.overlayPlacement(id)
    if (placement) this.overlay.moveTo(placement)
    this.shiftFollowing()
    // スマホで紙面に直接書く：組み直した紙面・続きのページで、書いている行が隠れていれば見せる
    if (this.writingOnPaper) this.scheduleCaretReveal()
  }

  /** 入力欄を閉じて、書いた文字を確定する。frozen：閉じる前の入力欄の見た目を写した要素（紙面に重ねる。PC だけ） */
  private onCommitEdit(id: string, text: string, byKey: boolean, frozen: HTMLElement | null = null): void {
    // サブタイトル：自動で付く前後の決まり文句（「―」「の衣装制作―」など）まで入力していたら取る（表紙で二重にならないように）
    const course = id === FIELD_IDS.subtitleInput ? findCourse(this.config, this.report.basicInfo.courseId) : undefined
    const committed = ops.setText(this.report, id, course ? subtitleInputOnly(course, text) : text)
    // 本文の段落に「Ⅲ．まとめ」のように打って閉じた（ほかを押した・Esc・スマホの「完了」）：段落ごと見出しにする（headingOnClose）
    const heading = this.headingOnClose(id, text, committed)
    // 仮に表示する欄（見出しにしたときは、見出し。組み直して見出しが出るまで、打ったままの文を見せる）
    const shownId = heading?.headingId ?? id
    // 書いていた欄の文字が、表に出ている紙面と違えば、組み直した紙面が出るまで、閉じる前の見た目のまま仮に表示する（freezeEdited）。
    // 後ろの文章をずらしていれば、それもそのままにする
    // （段落を分けたばかりで、まだ紙面にない段落も。分けた前の段落の仮の表示も一緒に写してある）
    const shownText = this.shownReport ? ops.findEditable(this.shownReport, shownId)?.text : undefined
    const nextText = ops.findEditable(heading?.report ?? committed, shownId)?.text
    const unrendered = this.renderer.pageView.fragments(shownId).length === 0
    // 隠したままにする欄：PC は書いていたときのまま。スマホは、書いていた欄（枠で示していた）と、分けた前の段落（仮に表示していた）を隠す
    const pending = this.continuing?.id === id ? (this.continuing.ghosts ?? []) : []
    const hidden = this.overlay.inSheet ? [id, ...pending].map((x) => this.hiddenStyle(x)).join('\n') : (this.hideStyle.textContent ?? '')
    // 後ろの文章をずらす基準の段落（分けた前の段落を仮に表示していれば、紙面にある元の段落）
    const anchor = (this.continuing?.id === id && this.continuing.anchor) || id
    if (frozen && nextText !== undefined && (unrendered || nextText !== shownText || pending.length > 0)) this.freezeEdited(shownId, frozen, hidden, nextText, anchor)
    else {
      frozen?.remove()
      this.clearShift()
    }
    if (this.continuing?.id === id) this.continuing = null
    this.report = committed
    // 書く前と中身が同じなら、元に戻す1回分を積まない（打って消しただけでも、保存の時刻 updatedAt は変わるので、時刻は比べない。
    // 前は積んでいたので、そのあとの「元に戻す」の1回目が、見た目の変わらない空振りになっていた：はじめて使う学生の試し 2026-10-21）
    if (this.reportBeforeEdit && JSON.stringify({ ...this.reportBeforeEdit, updatedAt: '' }) !== JSON.stringify({ ...this.report, updatedAt: '' })) this.pushHistory(this.reportBeforeEdit)
    // 見出しにした：元に戻すと、まず打ったままの段落に戻る（もう一度戻すと、書く前に戻る）
    if (heading) {
      this.pushHistory(committed)
      this.report = heading.report
    }
    this.reportBeforeEdit = null
    this.hideStyle.textContent = ''
    // 閉じた段落が空のままなら、すぐ「空の段落がある」と言う（組み直すのを待たない）
    this.runChecks()
    if (byKey && !this.phone) {
      // Esc・Enter で書き終えた（PC）：書いていた紙面の欄にフォーカスを戻す（ページ全体に戻ると、どこにいたか分からなくなる）。
      // 欄がまだ紙面にない（分けたばかりの段落など）ときは、組み直してから戻す
      if (!this.focusPaper(blockPaperKey(shownId), true)) this.refocusKey = blockPaperKey(shownId)
      else this.ringFrozen(shownId)
    }
    this.afterChange({ render: 'now', save: true })
    if (heading) this.noticeHeading(heading.step)
    // スマホで紙面に直接書く：書き終えて、ほかの欄を開かなかったら、キーボードを閉じる（書く欄は隠れても、フォーカスが残ることがあるため）。
    // 図・表なども選ばず、続けて開く欄もなければ（紙面の外を押した・iPhone のキーボードの「完了」など）、「完了」と同じく1ページ全体の表示に戻す
    // （拡大したまま残り、「ページ全体に戻す」を押すのが分かりにくかったため。依頼者の判断）。
    // ただし表のセルをキーで書き終えたとき（Esc・最後のセルの Tab。セルの Enter は改行で、書き終えない）は、拡大したまま（続けて隣のセルを押して書けるように）
    if (this.direct) {
      const cellByKey = byKey && ops.findEditable(this.report, id)?.kind === 'tableCell'
      queueMicrotask(() => {
        if (this.overlay.blockId) return
        if (document.activeElement === this.overlay.element) this.overlay.element.blur()
        if (!cellByKey && !this.pendingOpen && !this.selection && !this.turning && this.stage.zoomed) this.setZoom(false)
      })
    }
  }

  /** 後ろの文章をずらしている要素（組み直す・書き終えると元に戻す） */
  private shifted: HTMLElement[] = []

  /**
   * 書いていて段落の行が増えた（減った）とき、紙面を組み直すのを待たずに、同じページの後ろの文章を下（上）へずらして見せる。
   * 入力欄が後ろの文章に重なって隠さないようにするため。ページの下からはみ出す分は見せない。組み直すと、新しい紙面で正しく並ぶ。
   */
  private shiftFollowing(): void {
    this.clearShift()
    const id = this.overlay.blockId
    if (!id) return
    // PC：書く欄（段落。見出し・表紙の項目などは1行で、行は増えない）の下端まで。
    // スマホ：打った字をその場で見せている段落（紙面の上の写し）の下端まで。写しを見せていなければ、段落を分けた前の段落を仮に表示しているときだけ、
    // その下端まで（書く欄は画面の下の欄にあり、紙面には重ならない）
    const pending = this.continuing?.id === id && this.overlay.ghostCount > 0
    const sheetBottom = this.overlay.live ? this.overlay.bottom : pending ? this.overlay.ghostsBottom : null
    const bottom = this.overlay.inSheet ? sheetBottom : this.overlay.kind === 'paragraph' ? this.overlay.bottom : null
    if (bottom === null) return
    // 書き終えた欄の仮の表示が後ろの文章をずらしていれば、外してから測る（同じ要素を2つの仕組みでずらさないように）
    this.clearFrozen(Infinity, (f) => f.shift.length === 0)
    // 組み直すのを待っているあいだ（段落を分けた・つなげた直後）は、紙面にある元の段落の後ろをずらす
    this.shifted = this.shiftBelow([this.continuing?.id === id ? this.continuing.anchor : null, id], bottom)
  }

  /**
   * 紙面の anchors（前から順に、紙面にある最初のもの）の段落より後ろの、同じページの文章を、その段落の下端が bottom（画面座標）に来た分だけずらす。
   * ずらした要素を返す（元に戻すときは resetShift）
   */
  private shiftBelow(anchors: (string | null | undefined)[], bottom: number): HTMLElement[] {
    const view = this.renderer.pageView
    const anchor = anchors.find((x): x is string => !!x && view.fragments(x).length > 0)
    const last = anchor ? view.fragments(anchor).at(-1) : undefined
    const shifted: HTMLElement[] = []
    // 段落が次のページへ続いているときは、このページに後ろの文章はない
    if (!last || view.pageIndexOf(last) !== this.page) return shifted
    const lastRect = last.getBoundingClientRect()
    const delta = bottom - lastRect.bottom
    if (Math.abs(delta) < 1) return shifted
    const page = view.pages()[this.page]
    const section = last.closest('section')
    if (!page || !section) return shifted
    const pageRect = page.getBoundingClientRect()
    // 本文の領域の下端（A4 の下の余白 25mm）
    const contentBottom = pageRect.top + (pageRect.height * (297 - 25)) / 297
    const scale = this.stage.scale
    // 書いている段落より後ろにある要素（親をさかのぼり、それぞれの後ろの兄弟）。ページの上に送った図などは除く
    const targets: HTMLElement[] = []
    for (let el: Element | null = last; el && el !== section; el = el.parentElement) {
      for (let next = el.nextElementSibling; next; next = next.nextElementSibling) {
        if (next instanceof HTMLElement && next.getBoundingClientRect().top >= lastRect.bottom - 1) targets.push(next)
      }
    }
    for (const t of targets) {
      const r = t.getBoundingClientRect()
      t.style.translate = `0 ${delta / scale}px`
      if (r.top + delta >= contentBottom) t.style.visibility = 'hidden'
      else if (r.bottom + delta > contentBottom) t.style.clipPath = `inset(0 0 ${(r.bottom + delta - contentBottom) / scale}px 0)`
      shifted.push(t)
    }
    return shifted
  }

  private clearShift(): void {
    resetShift(this.shifted)
    this.shifted = []
  }

  /**
   * 書き終えた欄の、閉じる前の見た目の写し（組み直した紙面が出るまで紙面に重ねる）。
   * id：書いていた欄。text：書き終えた文字。seq：その変更を含む原稿の、変更の回数。shift：ずらしたままにしている後ろの文章。hidden：隠したままにしている欄の CSS
   */
  private frozen: { id: string; text: string; element: HTMLElement; seq: number; shift: HTMLElement[]; hidden: string; place: FrozenPlace }[] = []

  /**
   * 書き終えた欄の文字を、組み直した紙面が出るまで、閉じる前の見た目のまま紙面に重ねて見せる（PC。スマホも、紙面の上の見えない写しから作る）。
   * 前は、閉じるとすぐ紙面の前の文字が見え、組み直すと（長い原稿では1〜3秒後）書いた文字に変わっていた。
   * 書いていた欄（と、段落を分けた前の段落）は隠したまま、後ろの文章のずらしもそのままにする。
   * 組み直した紙面が出たら外す（render の clearFrozen）。ページを送った・別の欄を書いて後ろの文章をずらすときも外す。
   * 拡大してスクロールした・画面の大きさや拡大を変えたときは、紙面に合わせて動かす（realignFrozen）
   */
  private freezeEdited(id: string, element: HTMLElement, hidden: string, text: string, anchor: string = id): void {
    // 書く欄より下に置く（同じ欄をまた書き始めたら、書く欄が上に出る）
    this.layer.insertBefore(element, this.layer.firstChild)
    // スマホ：書いた文字の仮の表示の下端に合わせて、後ろの文章をずらす（書いている間は、紙面に重ねていないので、ずらしていない）
    if (this.overlay.inSheet) {
      this.clearShift()
      const last = element.lastElementChild?.getBoundingClientRect()
      if (last) this.shifted = this.shiftBelow([anchor, id], last.bottom)
    }
    // 隠した欄は、見えないだけで押せるようにしておく（すぐ押し直して続きを書けるように。visibility: hidden だと押せない）
    hidden = hidden.replaceAll('visibility: hidden !important;', 'opacity: 0 !important;')
    const page = this.renderer.pageView.pages()[this.page]?.getBoundingClientRect()
    const box = element.getBoundingClientRect()
    const place: FrozenPlace = { page: this.page, pageBox: { left: page?.left ?? 0, top: page?.top ?? 0, width: page?.width ?? 0 }, box: { left: box.left, top: box.top } }
    this.frozen.push({ id, text, element, seq: this.changeSeq + 1, shift: this.shifted, hidden, place })
    this.shifted = []
    this.frozenStyle.textContent = this.frozen.map((f) => f.hidden).join('\n')
  }

  /**
   * 書き終えた欄の仮の表示を、いまの紙面の位置・倍率に合わせる（拡大してスクロールした・画面の大きさや拡大を変えたとき）。
   * 仮の表示を写したときのページの位置と幅から、動いた分と大きさの比を求めて、要素ごと動かす。ページが替わっていれば外す
   */
  private realignFrozen(): void {
    if (this.frozen.length === 0) return
    // 写したときのページ（見開きなら、並べている2ページのどちらでもよい）の、いまの位置と大きさ
    const pages = this.renderer.pageView.pages()
    const rectOf = (p: number) => pages[p]?.getBoundingClientRect()
    this.clearFrozen(Infinity, (f) => {
      const page = rectOf(f.place.page)
      return this.isVisiblePage(f.place.page) && !!page && page.width > 0 && f.place.pageBox.width > 0
    })
    for (const { element, place } of this.frozen) {
      const page = rectOf(place.page)
      if (!page) continue
      const { pageBox, box } = place
      element.style.transformOrigin = `${pageBox.left - box.left}px ${pageBox.top - box.top}px`
      element.style.transform = `translate(${page.left - pageBox.left}px, ${page.top - pageBox.top}px) scale(${page.width / pageBox.width})`
    }
  }

  /**
   * キーボードで書き終えて、書いていた欄にフォーカスを戻したとき：欄は組み直すまで隠しているので、フォーカスの目印（藍色の枠）を仮の表示に付ける。
   * フォーカスがほかへ移ったら外す
   */
  private ringFrozen(id: string): void {
    const active = document.activeElement
    const copy = this.frozen.findLast((f) => f.id === id)?.element.lastElementChild
    if (!(active instanceof HTMLElement) || !copy || !active.matches(':focus-visible')) return
    copy.classList.add('focus-ring')
    active.addEventListener('blur', () => copy.classList.remove('focus-ring'), { once: true })
  }

  /** 書き終えた欄の仮の表示のうち、変更の回数が upTo までのもの（keep が false を返すもの）を外す */
  private clearFrozen(upTo: number, keep: (f: ReportEditor['frozen'][number]) => boolean = () => false): void {
    if (this.frozen.length === 0) return
    const kept: ReportEditor['frozen'] = []
    for (const f of this.frozen) {
      if (f.seq > upTo || keep(f)) {
        kept.push(f)
        continue
      }
      f.element.remove()
      resetShift(f.shift)
    }
    this.frozen = kept
    this.frozenStyle.textContent = kept.map((f) => f.hidden).join('\n')
  }

  // ---- 入力欄 ----

  private overlayKind(kind: ops.EditableKind): OverlayKind {
    if (kind === 'paragraph' || kind === 'abstractParagraph') return 'paragraph'
    return kind === 'tableCell' ? 'cell' : 'line'
  }

  /** 入力欄を重ねる位置。いま見えているページにそのブロックがなければ null */
  private overlayPlacement(id: string): OverlayPlacement | null {
    const editable = ops.findEditable(this.report, id)
    const view = this.renderer.pageView
    const fragment = view.fragments(id).find((f) => view.pageIndexOf(f) === this.page)
    const page = view.pages()[this.page]
    if (!editable || !fragment || !page) return null
    const p = page.getBoundingClientRect()
    const clip = { left: p.left, top: p.top, right: p.right, bottom: p.bottom }
    const scale = this.stage.scale
    if (this.overlayKind(editable.kind) === 'paragraph') {
      const r = fragment.getBoundingClientRect()
      const alignOffset = view.charsBefore(id, fragment)
      // 前のページから続く段落は、前のページの部分（入力欄の上の方）がページの上の余白に見えないよう、段落の上端から下だけを見せる
      const shown = { ...clip, top: alignOffset > 0 ? r.top : clip.top }
      // スマホ：打った字をその場で見せる写しは、本文の領域（下の余白 25mm より上）までを見せる（はみ出した行は、組み直すと次のページへ移る。
      // 下の余白のページ番号に重ねない）
      if (this.overlay.inSheet) shown.bottom = p.top + (p.height * (297 - 25)) / 297
      return { rect: { left: r.left, top: r.top, right: r.right }, clip: shown, scale, alignOffset }
    }
    // 見出し・図のタイトル・表紙の項目・表のセル：入力部分の左端から、行（セル）の右端まで
    const kind = this.overlayKind(editable.kind)
    const box = (fragment.closest('td, th, h1, h2, figcaption, p, .el') as HTMLElement | null) ?? fragment
    const own = fragment.getBoundingClientRect()
    const boxRect = box.getBoundingClientRect()
    // 図表のタイトル：番号（「図4.」）も書く欄の前に出し（OverlayPlacement の label）、紙面と同じ幅の中で、番号とタイトルを一緒に真ん中にそろえる。
    // 図は、1枚だけの段なら段の幅（本文の幅）、2枚並べた段なら、その図の幅。表は、表のタイトルの行の幅。
    // 下の欄で書くとき（予備の ?direct=0 の端末）は今までどおり（番号は紙面のものを見せ、紙面の上の写しは番号の後ろから）
    if ((editable.kind === 'figureCaption' || editable.kind === 'tableCaption') && !this.overlay.inSheet) {
      const num = fragment.previousElementSibling
      const label = num?.classList.contains('num') ? (num.textContent ?? '') : ''
      const figure = fragment.closest('figure')
      const row = figure?.closest('.figure-row')
      const area = (row && row.querySelectorAll('figure').length === 1 ? row : figure) ?? box
      const a = area.getBoundingClientRect()
      return { rect: { left: a.left, top: boxRect.top, right: a.right }, clip, scale, alignOffset: 0, label }
    }
    // 表のセル：書く欄は、セルの枠線の内側だけ（細い欄でも広げない。前は 120px より狭くならず、右どなりのセルまで重なって、セルの罫線を隠していた）
    const left = kind === 'cell' ? boxRect.left + 2 * scale : own.left
    const right = kind === 'cell' ? boxRect.right - 2 * scale : Math.max(boxRect.right, own.left + 120 * scale)
    return { rect: { left, top: kind === 'cell' ? own.top : boxRect.top, right }, clip, scale, alignOffset: 0 }
  }

  private overlayTarget(id: string, caret: number): OverlayTarget | null {
    const editable = ops.findEditable(this.report, id)
    const placement = this.overlayPlacement(id)
    // 書体などは、段落の最初の部分から写し取る（ページをまたいだ続きの部分は字下げがないため）
    const styleSource = this.renderer.pageView.fragments(id)[0]
    if (!editable || !placement || !styleSource) return null
    return {
      ...placement,
      blockId: id,
      kind: this.overlayKind(editable.kind),
      text: editable.text,
      caret,
      styleSource,
      // 見出し・図表のタイトルの Enter は、その下に段落を作る（段落を足すボタンはない）
      enterCreatesParagraph: ['chapter', 'subheading', 'figureCaption', 'tableCaption'].includes(editable.kind),
      refs: this.refsFor(editable.kind, id),
      // 紙面の段落の中身（組版エンジンが句読点などを包んだもの）を、書く欄に写す（紙面と同じ所で折り返す。overlayEditor.ts の copyPage）
      page: this.renderer.pageView.fragments(id),
      // 表紙の項目のすぐ後ろに続く決まった字（サブタイトルの「の衣装制作―」）：書く欄の中で、字の後ろに見せる
      suffix: editable.kind === 'field' ? suffixAfter(styleSource) : undefined,
    }
  }

  /** 本文の段落の、確定すると図表へのリンクになる所（書く欄で「（図1）」を折り返さないため。抄録の段落は図表とつながらない） */
  private refsFor(kind: ops.EditableKind, id?: string): ((text: string) => [number, number][]) | undefined {
    if (kind !== 'paragraph') return undefined
    const num = ops.numbering(this.report)
    // 開いたときの文字のままなら、いま紙面にある参照（原稿のリンク）の位置。書き換えたら、確定したときにリンクになる所
    // （図を入れる前に「図1」と書いていた段落は、開いただけなら紙面と同じく折り返せる。書き換えると、確定したときにリンクになる）
    const paragraph = id ? this.report.body.flatMap((c) => c.blocks).find((b) => b.id === id) : undefined
    const opened = paragraph?.type === 'paragraph' ? { text: ops.contentToText(paragraph.content, num), refs: ops.contentRefRanges(paragraph.content, num) } : null
    return (text) => (opened && text === opened.text ? opened.refs : ops.refRanges(text, num))
  }

  /**
   * ひな形を作る画面で書ける欄か：抄録・本文の見出し・段落・図表のタイトルと、表の見出しの行のセル。
   * 表紙の項目（学籍番号・氏名など）と、表の中身の行は、学生が書く所なので書かない（mockups/v44）
   */
  templateEditable(id: string): boolean {
    const kind = ops.findEditable(this.report, id)?.kind
    if (!kind || !TEMPLATE_KINDS.has(kind)) return false
    if (kind !== 'tableCell') return true
    const table = this.report.body.flatMap((c) => c.blocks).find((b) => b.type === 'table' && b.rows.some((r) => r.cells.some((c) => c.id === id)))
    return table?.type === 'table' && !!table.rows[0]?.cells.some((c) => c.id === id)
  }

  openEditor(id: string, caret: number): void {
    // ひな形を作る画面：学生が書く所（表紙の項目・表の中身の行）は書かない。表の中身の行を押したら、その表を選ぶ（表の道具が出る）
    if (this.template && !this.templateEditable(id)) {
      const tableId = this.tableIdOf(id)
      if (tableId) this.select({ kind: 'table', id: tableId })
      else this.noticeInfo('学籍番号・氏名・サブタイトルは、学生が書きます（ひな形には入りません）')
      return
    }
    // 開いた直後に頼まれていたページへの移動は、書き始めたらやめる（書いている欄が、急にほかのページへ移って閉じないように）
    this.cancelQueuedNav()
    // 書く位置が別のページにあれば、そのページを表示する（見開きで、並べている隣のページなら、紙面はそのまま）
    const page = this.renderer.pageView.pageOfOffset(id, caret)
    if (page >= 0 && page !== this.page && !this.turning) {
      // 見開きで隣のページの欄を書き始める：書いていた欄は先に書き終える（書き終えた欄の仮の表示を、書いていたページに置くため）
      if (this.overlay.blockId && this.overlay.blockId !== id && this.samePair(page, this.page)) this.overlay.commit()
      this.showPage(page)
    }
    // 書き終えたばかりの同じ欄をまた書くときは、仮の表示を外す（書く欄が、組み直す前の紙面の上で開く）
    this.clearFrozen(Infinity, (f) => f.id !== id)
    // スマホで紙面に直接書く：紙面に重ねた書く欄で書く。先に紙面を拡大してから、書く欄の位置を測る。
    // 押して書き始めたときは、押した行を、押した高さに置く（キーボードがまだ出ていなければ、隠れない上の方に。図表のタイトルは、図・表と一緒に見せる：revealCaret）
    this.placeEditorFor(id)
    if (this.direct && !this.overlay.inSheet) {
      const zoomIn = !this.stage.zoomed
      this.zoomForPaper()
      const tap = this.lastTap && performance.now() - this.lastTap.time < 1000 ? this.lastTap.y : null
      this.lastTap = null
      const vv = window.visualViewport
      const keyboardUp = !!vv && vv.height < window.innerHeight * 0.85
      this.revealAt = tap !== null && (zoomIn || !keyboardUp) ? tap : zoomIn ? Number.NaN : null
    }
    const target = this.overlayTarget(id, caret)
    if (!target) {
      this.revealAt = null
      return
    }
    if (this.overlay.blockId && this.overlay.blockId !== id) this.overlay.commit()
    this.currentId = id
    this.selection = null
    this.markSelection()
    this.reportBeforeEdit = this.report
    this.hideStyle.textContent = this.editingStyle(id)
    this.overlay.open(target)
    // スマホ：紙面を拡大し、書いているところを見せる
    if (this.phone) {
      if (!this.stage.zoomed) this.stage.setZoom(true)
      this.revealEditing()
    }
    // 開いた段落の「空の段落がある」を消す（書いている間は言わない。runChecks）
    this.runChecks()
    this.notify()
  }

  /** 紙面で隠す欄（組み直すまで、仮の表示を重ねている欄） */
  private hiddenStyle(id: string): string {
    return `.page-viewport [data-block-id="${CSS.escape(id)}"] { visibility: hidden !important; }`
  }

  /** 書いているブロックの紙面での見せ方。PC は入力欄を重ねるので隠し、スマホは下の欄で書くので枠で示す */
  private editingStyle(id: string): string {
    const selector = `.page-viewport [data-block-id="${CSS.escape(id)}"]`
    // 表のセルを紙面に重ねて書くとき：書く欄は地が透けている（罫線を隠さない。index.css）ので、書いているセル（td・th。layout/bodyHtml.ts）を、
    // セルの中だけうすく色付けして示す
    const cell = `.page-viewport [data-cell-id="${CSS.escape(id)}"] { background-color: rgba(47, 62, 117, 0.07); }`
    return this.overlay.inSheet
      ? `${selector} { outline: 2px solid #2f3e75; outline-offset: 2px; background: rgba(47, 62, 117, 0.08); }`
      : [`${selector} { visibility: hidden !important; }`, cell].join(' ')
  }

  /**
   * 段落を分けた・つなげた・↑↓で移ったとき：紙面を組み直すのを待たずに、入力欄を開いたまま書く先を移す。
   * 組み直しは長い原稿だと数秒かかり、待つ間に打った文字が消えていたため。組み直したら正しい位置へ動かす（render の終わり）。
   * ghostOf：分けた前の段落（組み直すまで、入力欄の上に仮に表示する）。alsoHide：つなげて無くなった段落（組み直すまで隠す）。
   * inPlace：移る先の段落は、もう紙面にある（見出しの後ろの空の段落。後ろの文章は、その段落を基準にずらす）。
   * ghostText：仮に表示する前の段落の文字（なければ、原稿の ghostOf の文字。段落を見出しにしたときは、打ったままの文を見せる）
   */
  private continueWriting(id: string, caret: number, how: { ghostOf?: string; ghostText?: string; alsoHide?: string; inPlace?: boolean } = {}): void {
    const editable = ops.findEditable(this.report, id)
    if (!editable || !this.overlay.blockId) return this.reopenAfterRender(id, caret)
    const kind = this.overlayKind(editable.kind)
    const view = this.renderer.pageView
    const fragment = view.fragments(id)[0]
    // まだ紙面にない段落（分けた後ろ）は、同じ種類の段落の書体を写す
    const kinds = fragment ? null : new Map(ops.editables(this.report).map((e) => [e.id, e.kind]))
    const styleSource = fragment ?? [...document.querySelectorAll<HTMLElement>('.page-viewport.front [data-block-id]')].find((el) => kinds?.get(el.dataset.blockId!) === editable.kind)
    const ghost = how.ghostOf ? (how.ghostText ?? ops.findEditable(this.report, how.ghostOf)?.text ?? '') : undefined
    // まだ組み直していない前の段落の仮の表示（続けて Enter を押したときは、それまでの仮の表示も残す。組み直した紙面が出たら外す：settleContinued）
    const before = this.continuing && this.overlay.ghostCount > 0 ? this.continuing : null
    let ghosts = before?.ghosts ?? []
    // Enter のすぐ後に Backspace で、仮に表示していた前の段落とつなぎ直した：その仮の表示を外し、書く欄をその位置に戻す
    if (how.alsoHide && ghosts.at(-1) === id) {
      this.overlay.popGhost()
      ghosts = ghosts.slice(0, -1)
    }
    const ghostsBefore = this.overlay.ghostCount
    this.overlay.continueIn({ blockId: id, kind, text: editable.text, caret, styleSource, refs: this.refsFor(editable.kind, id), page: fragment ? view.fragments(id) : undefined }, ghost)
    if (how.ghostOf && this.overlay.ghostCount > ghostsBefore) ghosts = [...ghosts, how.ghostOf]
    if (this.overlay.ghostCount === 0) ghosts = []
    const placement = fragment ? this.overlayPlacement(id) : null
    if (placement) this.overlay.moveTo(placement)
    // 後ろの文章をずらす基準：紙面にある、いちばん上の仮の表示の段落（続けて Enter を押しても変えない）
    this.continuing = { id, anchor: how.inPlace ? null : (ghosts.length > 0 && before?.anchor ? before.anchor : (how.ghostOf ?? how.alsoHide ?? null)), ghosts }
    this.pendingOpen = null
    this.currentId = id
    this.selection = null
    // 紙面で隠す欄：書いている欄と、仮に表示している前の段落・つなげて無くなった段落（スマホは、書いている欄を枠で示し、仮に表示している段落と、
    // つなげて無くなった段落を隠す。つなげた段落は、打った字をその場で見せる写しで、つなげた字を見せる）
    this.hideStyle.textContent = this.overlay.inSheet
      ? [this.editingStyle(id), ...[...ghosts, how.alsoHide].filter((x): x is string => !!x).map((x) => this.hiddenStyle(x))].join('\n')
      : [id, ...ghosts, how.alsoHide].filter((x): x is string => !!x).map((x) => this.editingStyle(x)).join('\n')
    this.markSelection()
    this.shiftFollowing()
    this.afterChange({ render: 'now', save: true })
    // 書き始める前の原稿は、afterChange のあとで覚える（保存の時刻だけが違う原稿が、何も変わらない「元に戻す」の1回分にならないように。
    // 図・表のタイトルで Enter を押して、何も書かずに閉じたとき、元に戻す1回で作った段落が消えるように）
    this.reportBeforeEdit = this.report
  }

  /** 組み直した紙面に、書いている箇所が出た：入力欄を正しい位置・書体に合わせる（continueWriting のあと） */
  private settleContinued(id: string): void {
    this.continuing = null
    this.overlay.settle(this.renderer.pageView.fragments(id)[0], this.renderer.pageView.fragments(id))
    this.hideStyle.textContent = this.editingStyle(id)
    this.followCaret()
    // 入れたばかりの図・表のタイトルが紙面に出た：図・表と一緒に見せる（revealCaret）
    if (this.revealObjectFor === id && this.writingOnPaper) {
      this.revealAt = Number.NaN
      this.keepObjectShown = id
    }
    this.revealObjectFor = null
    if (this.phone) this.revealEditing()
    this.refreshHighlights()
  }

  /**
   * 原稿を変えたあと、id の欄を書き始める（小見出し・段落・大見出しを足した、図・表を入れた、「＋ ここに続きを書く」など）。
   * PC は、紙面を組み直すのを待たずに、すぐ入力欄を開く（openBeforeRender）。組み直しは長い原稿では1秒以上かかり、
   * 待つ間に打った文字が消えていたため（「小見出し」を押してすぐ打つと、見出しの文字が入らなかった）。
   * near：足した位置の目印（入力欄を、紙面に出るまで仮にその近くに置く）。開けないとき・スマホは、組み直してから開く
   */
  private reopenAfterRender(id: string, caret: number, near: InsertNear | null = null): void {
    this.hideStyle.textContent = this.editingStyle(id)
    this.pendingOpen = { id, caret }
    this.afterChange({ render: 'now', save: true })
    this.openBeforeRender(id, caret, near)
  }

  /**
   * 紙面を組み直すのを待たずに、id の欄を入力欄で開く（PC。開けたら true）。
   * - 欄がいま見えているページにあれば、その位置で開く（表の列を足したあとのセルなど。組み直すと位置が変わる）
   * - まだ紙面にない欄（足したばかりの見出し・段落、入れたばかりの図・表のタイトル）は、near の目印のすぐ下（over なら目印の位置）に仮に置く。
   *   目印が見えているページになければ、そのページの本文の最後の下に置く
   * 組み直した紙面に欄が出たら、正しい位置・書体に合わせる（render の終わりの settleContinued。別のページなら、そのページへ移る）。
   * 入力欄がすでに開いているとき（貼り付けで段落が増えたなど）は、確定せずに書く先を移す（前の欄の文字は、呼び出し側が原稿に入れ済み）
   */
  private openBeforeRender(id: string, caret: number, near: InsertNear | null): boolean {
    // スマホは、組み直してから開く（紙面で直接書くときは、PC と同じく、すぐ開く。紙面を拡大してから）
    if (this.phone && !this.writesOnPaper(id)) return false
    this.placeEditorFor(id)
    if (this.writesOnPaper(id)) this.zoomForPaper()
    const editable = ops.findEditable(this.report, id)
    const view = this.renderer.pageView
    const page = view.pages()[this.page]
    if (!editable || !page) return false
    const shown = view.fragments(id).some((f) => view.pageIndexOf(f) === this.page)
    const target = shown ? this.overlayTarget(id, caret) : this.unrenderedTarget(id, editable, caret, near, page)
    if (!target) return false
    this.overlay.open(target)
    if (this.writingOnPaper) {
      this.hideStyle.textContent = this.editingStyle(id)
      this.revealEditing()
      // 入れたばかりの図・表のタイトル：紙面に出たら、図・表と一緒に見せる（settleContinued）
      const kind = editable.kind
      this.revealObjectFor = !shown && (kind === 'figureCaption' || kind === 'tableCaption') ? id : null
    }
    this.pendingOpen = null
    this.continuing = { id, anchor: null }
    this.currentId = id
    this.selection = null
    this.markSelection()
    // 書き始める前の原稿（何も書かずに閉じたら、元に戻す1回分にしない）
    this.reportBeforeEdit = this.report
    this.runChecks()
    this.notify()
    return true
  }

  /** まだ紙面にない欄の入力欄を、仮に置く位置と書体（openBeforeRender） */
  private unrenderedTarget(id: string, editable: ops.Editable, caret: number, near: InsertNear | null, page: HTMLElement): OverlayTarget | null {
    const view = this.renderer.pageView
    const p = page.getBoundingClientRect()
    const scale = this.stage.scale
    // 目印のブロック（見えているページの部分）。なければ、見えているページの本文の最後
    const nearBox = near ? this.blockBox(near.id) : null
    const box = nearBox ?? [...page.querySelectorAll<HTMLElement>('section.body [data-block-id]:not(.page-break)')].map((el) => this.boxOf(el)).at(-1) ?? null
    const r = box?.getBoundingClientRect()
    // 本文の領域（上の余白 25mm・下の余白 25mm の内側）。下にはみ出すときは、本文の最後の行に置く（組み直すと、次のページへ移る）
    const contentTop = p.top + (p.height * 25) / 297
    const contentBottom = p.top + (p.height * (297 - 25)) / 297
    const top = Math.min(!r ? contentTop : nearBox && near?.place === 'over' ? r.top : r.bottom + 6 * scale, contentBottom - 24 * scale)
    // 書体：同じ種類の欄（見えているページのものを先に）から写す。なければ目印のブロックから
    const kinds = new Map(ops.editables(this.report).map((e) => [e.id, e.kind]))
    const same = [...this.viewport.querySelectorAll<HTMLElement>('[data-block-id]')].filter((el) => el.dataset.blockId !== id && kinds.get(el.dataset.blockId!) === editable.kind)
    const styleSource = same.find((el) => view.pageIndexOf(el) === this.page) ?? same[0] ?? box ?? page
    const left = p.left + TEXT_LEFT * scale
    // 入れたばかりの図・表のタイトル：番号（「図4.」）も書く欄の前に出す（紙面に出たら、紙面の番号に合わせる）
    const number = editable.kind === 'figureCaption' || editable.kind === 'tableCaption' ? ops.numbering(this.report).numbers.get(id) : undefined
    return {
      rect: { left, top: Math.max(top, contentTop), right: left + TEXT_W * scale },
      clip: { left: p.left, top: p.top, right: p.right, bottom: p.bottom },
      scale,
      alignOffset: 0,
      label: number === undefined ? undefined : `${editable.kind === 'figureCaption' ? '図' : '表'}${number}.`,
      blockId: id,
      kind: this.overlayKind(editable.kind),
      text: editable.text,
      caret,
      styleSource,
      enterCreatesParagraph: ['chapter', 'subheading', 'figureCaption', 'tableCaption'].includes(editable.kind),
      refs: this.refsFor(editable.kind, id),
    }
  }

  /** 紙面で、id のブロック（段落・見出し・図のまとまり・表・表の行・改ページの印）の、見えているページにある最後の部分 */
  private blockBox(id: string): HTMLElement | null {
    const view = this.renderer.pageView
    const e = CSS.escape(id)
    const els = [...this.viewport.querySelectorAll<HTMLElement>(`[data-block-id="${e}"], [data-figure-id="${e}"], [data-table-id="${e}"], [data-group-id="${e}"]`)]
    const last = els.filter((el) => view.pageIndexOf(el) === this.page).at(-1)
    return last ? this.boxOf(last) : null
  }

  /** 紙面の欄の要素から、それを含むブロックの要素（図のまとまり・表・表のセルの行・見出し・段落・改ページの印） */
  private boxOf(el: HTMLElement): HTMLElement {
    if (el.closest('[data-cell-id]')) return el.closest<HTMLElement>('tr') ?? el
    return el.closest<HTMLElement>('.figure-group, .data-table') ?? el.closest<HTMLElement>('h1, h2, p, .page-break') ?? el
  }

  // ---- 図・表のあとの続き（mockups/v32 ① 案A。「＋ ここに続きを書く」の部品は continueRow.ts） ----

  /**
   * 図・表のタイトルで Enter：タイトルを確定し、図・表のすぐ後ろに新しい段落を作って、続けて書く
   * （前は図の上の段落の終わりに戻ったため、次の文が図の前に入ってしまっていた）。
   * 元に戻すと、まず作った段落だけが消える（タイトルは残る）
   */
  private enterAfterCaption(id: string, text: string): void {
    const titled = ops.setText(this.report, id, text)
    const created = ops.paragraphAfter(titled, id)
    if (!created) return this.onCommitEdit(id, text, true)
    const before = this.reportBeforeEdit ?? this.report
    if (ops.findEditable(before, id)?.text !== ops.findEditable(titled, id)?.text) this.pushHistory(before)
    this.pushHistory(titled)
    this.report = created.report
    this.autoPeriod = null
    this.continueWriting(created.newId, 0, { ghostOf: id })
  }

  /**
   * 見出しで Enter：すぐ後ろの、何も書いていない段落（blankId）へ移って書く（新しい段落は作らない）。
   * 前は、もう1つ空の段落を作ったため、「大見出し」に付いてきた段落が空のまま残り、「空の段落がある」と言われていた
   */
  private enterBelowHeading(id: string, text: string, blankId: string): void {
    const before = this.reportBeforeEdit ?? this.report
    this.report = ops.setText(this.report, id, text)
    if (ops.findEditable(before, id)?.text !== ops.findEditable(this.report, id)?.text) this.pushHistory(before)
    this.autoPeriod = null
    this.continueWriting(blankId, 0, { ghostOf: id, inPlace: true })
  }

  // ---- 段落に打った見出し（「Ⅲ．まとめ」のように、手順書の番号の形で打った段落を、見出しにする。形を見分けるのは model/headingText.ts） ----

  /**
   * 段落 id に打った1行 line が、見出しにする形か（見出しにするなら、大見出しか小見出しかと、番号を除いた名前）。
   * 本文の段落だけ（抄録・図表のタイトル・表のセル・表紙・見出しはしない）。図表の参照（「（図1）」）のある行はしない。
   * 見出しにしたのを「戻す」で戻した段落は、同じ文のままなら、もうしない
   */
  private headingOf(id: string, line: string): HeadingText | null {
    const heading = typedHeading(line)
    if (!heading || this.declined.get(id) === line.trim()) return null
    if (ops.findEditable(this.report, id)?.kind !== 'paragraph' || ops.refRanges(line, ops.numbering(this.report)).length > 0) return null
    return heading
  }

  /**
   * 段落を見出しにしたことを覚える。typed：見出しにする手前の、打ったままの原稿（履歴に積んだもの。元に戻すと、これに戻る）。
   * declined：戻したら、もう見出しにしない段落と、その文
   */
  private headingStep(typed: Report, declined: [string, string][], notice: NoticeBody): HeadingStep {
    const step = { declined, notice }
    this.headingSteps.set(typed, step)
    this.headingStepOfNotice.set(notice, step)
    return step
  }

  /** いま出している、見出しにした知らせのこと（貼り付けた表の知らせを添えるとき） */
  private shownHeadingStep: HeadingStep | null = null

  /** 見出しにしたことを、画面の下に「大見出し「Ⅲ．まとめ」にしました［戻す］」と出す（書いている間も出す。書き始めたら・ほかを変えたら消える） */
  private noticeHeading(step: HeadingStep): void {
    this.notice = { notice: { ...step.notice, id: ++this.noticeCount }, report: this.report }
    this.headingNoticeAt = { history: this.historySeq, input: this.inputSeq }
    this.shownHeadingStep = step
    this.notify()
  }

  /** 見出しにした知らせの中身（自動で付いた番号と名前） */
  private headingNoticeBody(report: Report, headingId: string, heading: HeadingText): NoticeBody {
    return { kind: 'heading', level: heading.level, label: ops.headingLabel(report, headingId) ?? heading.title }
  }

  /**
   * 段落に「Ⅲ．まとめ」のように打って Enter：カーソルより前（before）を見出しにし、後ろ（after）を見出しのすぐ後ろの段落にして、続けて書く。
   * 大見出しなら、同じ章のその後ろのブロックも新しい章に入る。「。」は付けない（autoPeriod にしない）。
   * 元に戻す（知らせの「戻す」・Ctrl+Z・道具の「元に戻す」）と、まず打ったままの段落（Enter を押す前）に戻る（もう一度戻すと、書く前に戻る）
   */
  private enterAsHeading(id: string, before: string, after: string, heading: HeadingText): void {
    const typed = ops.setText(this.report, id, before + after)
    const result = ops.paragraphToHeading(typed, id, heading, after)
    if (!result?.nextId) return
    const start = this.reportBeforeEdit ?? this.report
    if (ops.findEditable(start, id)?.text !== ops.findEditable(typed, id)?.text) this.pushHistory(start)
    this.pushHistory(typed)
    this.report = result.report
    this.autoPeriod = null
    const step = this.headingStep(typed, [[id, before.trim()]], this.headingNoticeBody(result.report, result.headingId, heading))
    // 組み直すまでは、打ったままの文を仮に表示しておく（組み直すと、見出しになる）
    this.continueWriting(result.nextId, 0, { ghostOf: id, ghostText: before })
    this.noticeHeading(step)
  }

  /**
   * 書き終えた段落を、見出しにするか（段落に「Ⅲ．まとめ」のように打って閉じた：ほかを押した・Esc・スマホの「完了」）。
   * この欄で書き換えたときだけ（開いて閉じただけならしない）。元に戻す・図を入れるなど、続けて原稿を変えるために閉じたときもしない。
   * typed：書く欄の文字（まず形だけを見る）。見出しにするなら、見出しにした原稿・見出しの ID・そのこと（step。知らせを出す前）
   */
  private headingOnClose(id: string, typed: string, committed: Report): { report: Report; headingId: string; step: HeadingStep } | null {
    if (this.holdingRender || this.keepParagraph || !this.reportBeforeEdit || !typedHeading(typed)) return null
    const text = ops.findEditable(committed, id)?.text
    if (text === undefined || text === ops.findEditable(this.reportBeforeEdit, id)?.text) return null
    const heading = this.headingOf(id, text)
    const result = heading ? ops.paragraphToHeading(committed, id, heading) : null
    if (!heading || !result) return null
    const step = this.headingStep(committed, [[id, text.trim()]], this.headingNoticeBody(result.report, result.headingId, heading))
    return { report: result.report, headingId: result.headingId, step }
  }

  /**
   * 何行かの文を貼り付けて、段落に分けたあと（this.report。履歴には、貼り付ける前を積み済み）：見出しの形の行を見出しにする。
   * 本文の段落だけ（抄録に貼り付けたときはしない）。見出しにした行がなければ null（原稿はそのまま）。
   * 元に戻すと、まず見出しにする前（行ごとの段落）に戻る。headingIds：見出しにした段落の ID → 見出しの ID
   */
  private pasteHeadings(ids: string[]): { headingIds: Map<string, string>; step: HeadingStep } | null {
    const plain = this.report
    const texts = new Map(ops.editables(plain).map((e) => [e.id, e]))
    const num = ops.numbering(plain)
    let report = plain
    const headingIds = new Map<string, string>()
    const declined: [string, string][] = []
    for (const id of ids) {
      const line = texts.get(id)
      if (line?.kind !== 'paragraph' || this.declined.get(id) === line.text.trim() || ops.refRanges(line.text, num).length > 0) continue
      const heading = typedHeading(line.text)
      const result = heading ? ops.paragraphToHeading(report, id, heading) : null
      if (!result) continue
      report = result.report
      headingIds.set(id, result.headingId)
      declined.push([id, line.text.trim()])
    }
    if (headingIds.size === 0) return null
    this.pushHistory(plain)
    this.report = report
    return { headingIds, step: this.headingStep(plain, declined, { kind: 'headings', count: headingIds.size }) }
  }

  /** 書いている欄を、見出しにせず段落のまま確定する（図を入れる・紙面で選ぶ範囲を広げるなど、その段落に続けて何かをするとき） */
  private commitAsParagraph(): void {
    this.keepParagraph = true
    try {
      this.overlay.commit()
    } finally {
      this.keepParagraph = false
    }
  }

  /** 「＋ ここに続きを書く」：図・表・見出し（objectId は図・表・小見出しの ID か、大見出しの章の ID）のすぐ後ろに新しい段落を作り、書き始める */
  continueAfter(objectId: string): void {
    if (this.settlingRemoval || !ops.paragraphBelow(this.report, objectId)) return
    this.marker.hidden = true
    // 書いていたタイトル・見出しを確定してから作る（確定した原稿の後ろに作る）
    this.commitForChange()
    const created = ops.paragraphBelow(this.report, objectId)
    if (!created) return
    this.pushHistory(this.report)
    this.report = created.report
    this.selection = null
    this.markSelection()
    this.currentId = created.newId
    // 予備の下の書く欄（?direct=0）は、すぐ下の書く欄で開く（紙面で直接書くときは、PC と同じく、紙面の上ですぐ開く）
    if (this.phone && !this.direct) this.openUnrendered(created.newId)
    else this.reopenAfterRender(created.newId, 0, { id: objectId, place: 'after' })
  }

  /**
   * スマホ：まだ紙面にない段落を、すぐ下の書く欄で開く（組み直してから開くと、押した操作の外になり、キーボードが出ないため）。
   * 組み直した紙面にその段落が出たら、紙面の印を合わせる（render の終わりの settleContinued）
   */
  private openUnrendered(id: string): void {
    const none = { left: 0, top: 0, right: 0, bottom: 0 }
    this.hideStyle.textContent = this.editingStyle(id)
    this.overlay.open({ rect: none, clip: none, scale: this.stage.scale, alignOffset: 0, blockId: id, kind: 'paragraph', text: '', caret: 0, styleSource: this.viewport })
    this.continuing = { id, anchor: null }
    if (!this.stage.zoomed) this.stage.setZoom(true)
    this.afterChange({ render: 'now', save: true })
    this.reportBeforeEdit = this.report
  }

  /**
   * 「＋ ここに続きを書く」を出す図・表・見出し（なければ null）。
   * 見出し（大見出し・小見出し）は、章のいちばん最後にあるときだけ（見出しの下の空いた所を押して書くと、見出しの続きになっていたため）
   */
  private continueTarget(): ContinueTarget | null {
    // 削除・組み直しの途中、ページを送っている途中、段落などを書いている途中は出さない（書いて行が増えると、図・表が動くため）
    if (this.turning || this.removed.size > 0 || this.pendingOpen || this.continuing) return null
    if (this.overlay.blockId && this.overlay.kind === 'paragraph') return null
    const editing = this.overlay.blockId ? ops.findEditable(this.report, this.overlay.blockId) : undefined
    // 図・表のタイトルと、表のセルを書いているときは出す（セルを書いている間も消えず、紙面の余白を押さなくても出るように）。
    // 見出しを書いているときも、章の最後の見出しなら出す（書き終えて、すぐ下に続きを書けるように）
    const heading = editing?.kind === 'chapter' || editing?.kind === 'subheading'
    if (heading && !ops.headingEndsChapter(this.report, editing.id)) return null
    if (editing && !heading && editing.kind !== 'figureCaption' && editing.kind !== 'tableCaption' && editing.kind !== 'tableCell') return null
    const view = this.renderer.pageView
    const page = view.pages()[this.page]
    if (!page || !this.layout) return null
    const onPage = (objectId: string): ContinueTarget | null => {
      const owner = this.report.body.flatMap((c) => c.blocks).find((b) => (b.type === 'figureRow' && b.figures.some((f) => f.id === objectId)) || b.id === objectId)
      const selector = owner?.type === 'figureRow' ? `.figure-group[data-group-id="${CSS.escape(owner.id)}"]` : owner?.type === 'table' ? `.data-table[data-table-id="${CSS.escape(owner.id)}"]` : null
      // 図・表がページをまたぐときは、最後の部分（その後ろに段落ができる）。見出しは、見出しの行（番号も含む）
      const element = selector
        ? [...this.viewport.querySelectorAll<HTMLElement>(selector)].at(-1)
        : (view.fragments(objectId).map((f) => f.closest<HTMLElement>('h1, h2')).filter((h): h is HTMLElement => !!h).at(-1) ?? undefined)
      return element && view.pageIndexOf(element) === this.page ? { objectId, element, page } : null
    }
    // 選んでいる図・表（タイトル・表のセルを書いているときも）・書いている見出し。下が空いているときだけ（同じページで後ろに段落などが続くときは、文に重ねないよう出さない）
    const s = this.selection
    const focused = editing ? (editing.kind === 'tableCell' ? (ops.findTable(this.report, editing.id)?.id ?? null) : editing.id) : s?.kind === 'figure' || s?.kind === 'table' ? s.id : null
    if (focused) {
      const target = onPage(focused)
      // PC：セルの中で改行して、紙面に重ねた書く欄が表の下にはみ出したときは出さない（書く欄に重ねない）
      if (target && editing?.kind === 'tableCell' && !this.overlay.inSheet && this.overlay.bottom > target.element.getBoundingClientRect().bottom + 1) return null
      return target && endsPageWithRoom(page, target.element) ? target : null
    }
    // 章の最後の図・表・見出し（中に何もない章は、大見出し）が、ページの最後で、下が空いているとき（選ばなくても出す）
    for (const chapter of this.report.body) {
      const last = chapter.blocks.at(-1)
      const objectId = !last ? chapter.id : last.type === 'figureRow' ? last.figures[0]?.id : last.type === 'table' || last.type === 'subheading' ? last.id : undefined
      const target = objectId ? onPage(objectId) : null
      if (target && endsPageWithRoom(page, target.element)) return target
    }
    return null
  }

  /** 「＋ ここに続きを書く」を出し直す（紙面・選んでいる物・書いている欄が変わったとき。同じ描画の間に何度呼ばれても1回だけ測る） */
  private continueFrame = 0
  private placeContinueRow(): void {
    if (this.continueFrame) return
    this.continueFrame = requestAnimationFrame(() => {
      this.continueFrame = 0
      this.continueRow.show(this.continueTarget())
      // 列の幅を「自分で決める」表の、境目を動かす線・つまみも、同じときに出し直す
      this.columnHandles.sync(this.columnTarget(), this.viewport, this.phone)
    })
  }

  commitEditing(): void {
    this.overlay.commit()
  }

  /**
   * 書いている欄の文字を、欄を開いたまま原稿に入れる（ページを閉じる・読み込み直す・ほかのアプリへ切り替える直前に、保存に間に合わせるため）。
   * ふだんも打つたびに原稿へ入れているが、日本語の変換中の文字は、変換を終えるまで入らないため
   */
  saveEditing(): void {
    const id = this.overlay.blockId
    if (!id) return
    const next = ops.setText(this.report, id, this.overlay.text)
    if (ops.findEditable(next, id)?.text === ops.findEditable(this.report, id)?.text) return
    this.report = next
    this.afterChange({ render: 'debounce', save: true })
  }

  // ---- クリック ----

  /**
   * 紙面を押した（クリック・タップ）。紙面の欄にキーボードで移って Enter を押したときも、ここで同じことをする（onPaperKey）。
   * keyHit：キーボードのとき、書き始める欄と位置（押した点から求める代わりに使う。書く欄でなければ null）
   */
  private onClick(e: Pick<MouseEvent, 'target' | 'clientX' | 'clientY'>, keyHit?: { blockId: string; offset: number } | null): void {
    // 作品写真をつかんで動かした直後のクリックでは、写真を選び直さない
    if (this.suppressClick) {
      this.suppressClick = false
      return
    }
    // 2本の指で紙面を広げている途中・広げ終えた直後のタップ：書き始めない（editor/pinchZoom.ts）
    if (this.pinchZoom.busy) {
      this.touchPoint = null
      return
    }
    // スマホで紙面に直接書く：紙面に重ねた書く欄（紙面の表示枠の中にある）を押した：書く欄の中でカーソルが動くだけ（開き直さない）
    if (this.writingOnPaper && e.target instanceof Node && this.overlay.element.contains(e.target)) {
      this.touchPoint = null
      return
    }
    // 紙面をマウスでなぞって文字を選んだ（Shift+クリックで広げたときも）：書く欄は開かない（選んだ所をコピー・切り取り・削除できるように）。
    // 指で押したとき（スマホ・タブレット）は今までどおり
    if (keyHit === undefined && this.pointerType !== 'touch' && this.hasPaperSelection()) return
    // 削除して、組み直した紙面がまだ出ていない間は、紙面を押しても何もしない（古い紙面で、消したブロックの隣を開いてしまわないように）
    if (this.removed.size > 0) return
    // スマホ：指で押した点で決める（ブラウザが近くの欄へ寄せたあとの点ではなく。rawTouch）
    const touch = keyHit === undefined ? this.rawTouch(e) : null
    const { clientX: x, clientY: y } = touch ?? e
    const target = (touch?.target ?? e.target) as HTMLElement
    if (this.writingOnPaper && this.overlay.element.contains(target)) return
    // スマホで紙面に直接書く：押した点（書き始めるとき、押した行をその高さに置く。覚えた大きさで広げるとき、押した点を指の下に置く）
    this.lastTap = this.direct && keyHit === undefined ? { x, y, time: performance.now() } : null
    // 見開き：並べている隣のページを押した：紙面はそのままで、そのページで書く（このあとは、そのページを押したときと同じ）
    if (this.stage.spread) {
      const at = this.renderer.pageView.pageIndexOf(target)
      if (at !== this.page && this.samePair(at, this.page)) this.focusPartner(at)
    }
    // スマホ：まだ書いていない欄の「＋」の印（とそのまわり 44px 四方）を押した：その欄を開く（markerAt）
    const marked = touch ? this.markerAt(x, y, target) : null
    if (marked === FIELD_IDS.course) return this.callbacks.onCourseClick(this.renderer.pageView.fragments(marked)[0].getBoundingClientRect())
    if (marked) return this.openOrSelect(marked, ops.findEditable(this.report, marked)?.text.length ?? 0, false)
    // 紙の外（まわりの灰色の所）を押した：書いている欄を閉じる（Esc と同じ。近くの欄は開かない）。
    // 前は、閉じた直後に、押した所にいちばん近い欄が開き直していたため、紙の外を押しても書く欄を閉じられなかった
    if (keyHit === undefined && this.outsidePaper(x, y)) return this.select(null)
    // 抄録の「先生の許可が出た」
    if (target.closest('[data-abstract-start]')) return this.startAbstract()
    // 目次のページ（本文の見出しから自動で作る。書けない）：行を押すと、その見出しへ移って書き始める（mockups/v41 案C）。
    // 行のない所を押すと、目次は自動であることを、押した所の近くに知らせる（案B）。前は、押しても何も起きなかった
    if (this.layout?.kinds[this.page] === 'toc') {
      const line = target.closest<HTMLElement>('[data-toc-target]') ?? (touch ? this.tocLineNear(x, y) : null)
      if (line) return void this.goToHeading(line.dataset.tocTarget!)
      this.select(null)
      return this.callbacks.onTocClick?.({ x, y })
    }
    // 改ページの印：選ぶ（道具の「削除」で消せる）
    const pageBreak = target.closest<HTMLElement>('.page-break[data-block-id]')
    if (pageBreak) return this.select({ kind: 'pageBreak', id: pageBreak.dataset.blockId! })
    // 表紙の題目（研究題目）は学科で決まっていて書けない。押しても何も起きないと理由が分からないので、画面の下に知らせる（PC のマウスを重ねたときの説明は paperFocus.ts）
    if (target.closest('section.cover .el.title')) return this.noticeInfo(fixedTitleNote(this.config.cover.titleLabel))
    // スマホ：打った字をその場で見せている写し・書き終えた段落の仮の表示を押した：その字の位置から書く
    // （紙面の段落は、組み直すまで前の字のままで隠しているので、紙面の字で決めると、押した所と違う所が開く）
    const copied = this.phone && keyHit === undefined ? this.copyHit(x, y) : null
    if (copied) return this.openOrSelect(copied.blockId, copied.offset, false)
    // 押した要素の欄を先に見る。文字の位置（押した点にいちばん近い文字）は、その欄の中のときだけ使う。
    // 空の項目は仮の文字（::before）や「＋」の印しかなく、近い文字は別の欄（上の見出しなど）になるため
    // （スマホの横向きで、空の段落の「＋」を押したら、上の見出し「まとめ」の途中が開いていた）。押した要素が欄でなければ、近い文字の欄
    const clickedBlock = target.closest<HTMLElement>('[data-block-id]')?.dataset.blockId
    const point = keyHit === undefined ? this.renderer.pageView.offsetFromPoint(x, y) : null
    let hit = keyHit !== undefined ? keyHit : clickedBlock ? { blockId: clickedBlock, offset: point?.blockId === clickedBlock ? point.offset : 0 } : point
    // 押した点が、見出し・図表のタイトルの行より下（その下の空いた所）なら、その欄は開かない。
    // 近い文字が見出しになり、足したばかりの小見出しの下を押して書くと、見出しの続きになっていた（「素材の選定使う布」）。続きは「＋ ここに続きを書く」から
    if (hit && !clickedBlock && keyHit === undefined && this.belowLine(hit.blockId, y)) hit = null
    if (hit?.blockId === FIELD_IDS.course || target.closest(`[data-block-id="${FIELD_IDS.course}"]`)) {
      this.callbacks.onCourseClick((target.closest('[data-block-id]') ?? target).getBoundingClientRect())
      return
    }
    if (hit && ops.findEditable(this.report, hit.blockId)) {
      this.openOrSelect(hit.blockId, hit.offset, keyHit !== undefined)
      return
    }
    const figure = target.closest<HTMLElement>('figure[data-figure-id]')
    if (figure) {
      this.select({ kind: 'figure', id: figure.dataset.figureId! })
      // ひな形で用意した、まだ写真を入れていない枠は、すぐ写真を選ぶ
      if (figure.hasAttribute('data-empty-figure')) void this.replaceFigureImage(figure.dataset.figureId!)
      return
    }
    // 表のセル（画像の上や、文字のないところ）：そのセルを書く
    const cell = target.closest<HTMLElement>('[data-cell-id]')
    if (cell) {
      this.openEditor(cell.dataset.cellId!, ops.findEditable(this.report, cell.dataset.cellId!)?.text.length ?? 0)
      return
    }
    const table = target.closest('.data-table')
    if (table) {
      const caption = table.querySelector<HTMLElement>('.table-caption [data-block-id]')
      if (caption) return this.select({ kind: 'table', id: caption.dataset.blockId! })
    }
    // ひな形を作る画面：作品写真のページは、学生が入れる所（ひな形に入らない）
    if (this.template && target.closest('section.photos')) {
      this.select(null)
      return this.noticeInfo('作品写真は、学生が入れます（ひな形には入りません）')
    }
    const slot = target.closest<HTMLElement>('[data-photo-slot]')
    if (slot) {
      const page = photoPageOf(slot)
      const index = Number(slot.dataset.photoSlot)
      // 写真が入っている枠：その写真を選ぶ（道具の「差し替え」「外す」で操作する）。空の枠：すぐ写真を選ぶ（何枚かまとめて選べる）
      if (this.report.workPhotos[page]?.imageIds[index]) return this.select({ kind: 'photos', page, index })
      this.select({ kind: 'photos', page })
      void this.addPhotos(page, index)
      return
    }
    const photoSection = target.closest<HTMLElement>('section.photos')
    if (photoSection) return this.select({ kind: 'photos', page: photoPageOf(photoSection) })
    if (target.closest('section.references')) return this.callbacks.onReferencesClick()
    // スマホ：紙面の欄は小さく、少しずれて押すと開かなかった。指の幅ほどの近さにある欄を開く
    const near = this.phone && keyHit === undefined ? this.nearestEditable(x, y, 18) : null
    if (near === FIELD_IDS.course) return this.callbacks.onCourseClick(this.renderer.pageView.fragments(near)[0].getBoundingClientRect())
    if (near) return this.openOrSelect(near, ops.findEditable(this.report, near)?.text.length ?? 0, false)
    this.select(null)
  }

  /**
   * スマホ：画面の点 (x, y) が、打った字をその場で見せている写し、または書き終えた段落の仮の表示（組み直す前）の上なら、その段落と字の位置。
   * 仮の表示は、段落の字が、書き終えたときのままのものだけ（見出しにした段落などは、紙面の字で決める）。どちらでもなければ null
   */
  private copyHit(x: number, y: number): { blockId: string; offset: number } | null {
    const id = this.overlay.blockId
    const live = id ? this.overlay.liveOffsetAt(x, y) : null
    if (id && live !== null) return { blockId: id, offset: live }
    for (const f of [...this.frozen].reverse()) {
      const copy = f.element.lastElementChild
      const editable = ops.findEditable(this.report, f.id)
      if (!(copy instanceof HTMLElement) || !editable || this.overlayKind(editable.kind) !== 'paragraph' || editable.text !== f.text || copy.textContent !== f.text) continue
      const offset = offsetInCopy(copy, x, y, f.element)
      if (offset !== null) return { blockId: f.id, offset }
    }
    return null
  }

  /**
   * 見開き：並べている隣のページ（page）で書く・選ぶようにする（紙面はそのまま。ページは送らない）。
   * 書いていた欄は先に書き終える（書き終えた欄の仮の表示を、書いていたページに置くため）。選んでいた物は、押した物で選び直す
   */
  private focusPartner(page: number): void {
    if (this.overlay.blockId) this.overlay.commit()
    this.marker.hidden = true
    this.showPage(page)
    this.notify()
  }

  /**
   * スマホ：指で押した点（ブラウザが、押せそうな近くの要素へ寄せる前の点。pointerdown で覚える）。
   * ブラウザは、指で押した点を近くの押せそうな要素へ寄せる（タッチの補正）。横向きの小さな紙面では、空の段落の「＋」の印を押しても
   * 上の見出しへ寄せられ、見出し「まとめ」の途中が開いていた。紙面を押したときは、寄せる前の点にある要素で、押した欄を決める
   * （少しずれて押したときは、指の幅ほどの近さにある欄を開く：nearestEditable）
   */
  private touchPoint: { x: number; y: number; time: number } | null = null

  /** このクリックが指で押したもので、寄せる前の点が分かれば、その点と、そこにある紙面の要素（なければ null） */
  private rawTouch(e: Pick<MouseEvent, 'clientX' | 'clientY'>): { clientX: number; clientY: number; target: HTMLElement } | null {
    const t = this.touchPoint
    this.touchPoint = null
    if (!t || performance.now() - t.time > 1000 || Math.hypot(t.x - e.clientX, t.y - e.clientY) > 48) return null
    const el = document.elementFromPoint(t.x, t.y)
    return el instanceof HTMLElement && this.scroller.contains(el) ? { clientX: t.x, clientY: t.y, target: el } : null
  }

  /**
   * 押した欄を書き始める。ただしスマホで表のタイトルを押したときは、まず表を選ぶ（下に「この表」の道具が出て、「削除」で表ごと消せる）。
   * 選んでいる表のタイトルをもう一度押すと、タイトルを書く。
   * 表を選ぶには表の外側を押すしかなかったため（小さな紙面では、ほぼ押せない）。セルを書いている間は、書く欄の「この表を削除」でも消せる。
   * byKey：キーボードで紙面の欄に移って Enter を押した（すぐ書き始める）
   */
  private openOrSelect(id: string, offset: number, byKey: boolean): void {
    const selectFirst = this.phone && !this.direct && !byKey && ops.findEditable(this.report, id)?.kind === 'tableCaption'
    if (selectFirst && !(this.selection?.kind === 'table' && this.selection.id === id)) return this.select({ kind: 'table', id })
    this.openEditor(id, offset)
  }

  // ---- キーボードで紙面の欄に移る（mockups/v23 ④。Tab で止まる印は paperFocus.ts） ----

  /** Esc・Enter で書き終えたあと、組み直した紙面でフォーカスを戻す欄（書いていた欄が、まだ紙面になかったとき） */
  private refocusKey: string | null = null

  /** 紙面の欄で Enter・スペースを押した：クリックしたときと同じことをする（書く欄は書き始める、図・写真の枠は選ぶ など） */
  private onPaperKey(e: KeyboardEvent): void {
    const el = e.target instanceof HTMLElement && e.target.matches(PAPER_FOCUSABLE) ? e.target : null
    if (!el || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Tab') {
      // 紙面の中は、上から順に移る。ページのいちばん上・下の欄からは、ブラウザに任せて紙面の外へ出る（ほかの欄は tabindex -1）
      const order = paperOrder(this.renderer.pageView.pages()[this.page])
      const next = order.includes(el) ? order[order.indexOf(el) + (e.shiftKey ? -1 : 1)] : undefined
      if (next) {
        e.preventDefault()
        next.focus()
      }
      return
    }
    if ((e.key !== 'Enter' && e.key !== ' ') || e.repeat) return
    // 入力欄が開いたあとに、押した Enter・スペースが字として入らないようにする
    e.preventDefault()
    const r = el.getBoundingClientRect()
    this.onClick({ target: el, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }, this.keyboardHit(el))
  }

  /**
   * キーボードで書き始める欄と位置：欄の終わりから。
   * ページをまたぐ段落の、次のページへ続く部分なら、その部分の始めから（書く位置が、見ているページにあるように）
   */
  private keyboardHit(el: HTMLElement): { blockId: string; offset: number } | null {
    const id = el.dataset.blockId
    const editable = id ? ops.findEditable(this.report, id) : undefined
    if (!id || !editable) return null
    const view = this.renderer.pageView
    return { blockId: id, offset: view.fragments(id).at(-1) === el ? editable.text.length : view.charsBefore(id, el) }
  }

  /** フォーカスしている紙面の欄（なければ null）。visible：キーボードで移った（目印が出ている）か */
  private paperFocus(): { key: string; visible: boolean } | null {
    const active = document.activeElement
    const key = active && this.viewport.contains(active) ? paperKeyOf(active) : null
    const pending = this.refocusKey
    this.refocusKey = null
    if (key) return { key, visible: active!.matches(':focus-visible') }
    // 書き終えたあと、ほかの所へ移っていなければ
    if (pending && (!active || active === document.body)) return { key: pending, visible: true }
    return null
  }

  /** 見えているページの key の欄（null なら、ページのいちばん上の欄）にフォーカスを移す。移せたら true */
  private focusPaper(key: string | null, visible: boolean): boolean {
    const page = this.renderer.pageView.pages()[this.page]
    const el = key ? paperElement(page, key) : (paperOrder(page)[0] ?? null)
    el?.focus({ preventScroll: true, focusVisible: visible })
    return !!el && document.activeElement === el
  }

  /** 紙面の外で Tab を押した：見えているページに、Tab で入ったときに止まる欄がなければ、いちばん上の欄にする */
  private prepareTabStop(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || paperKeyOf(document.activeElement)) return
    const page = this.renderer.pageView.pages()[this.page]
    if (page && !page.querySelector(`${PAPER_FOCUSABLE}[tabindex="0"]`)) setTabStop(page, paperOrder(page)[0] ?? null)
  }

  /** 見えているページで、(x, y) から within 以内（画面の px）にある、いちばん近い書ける欄 */
  private nearestEditable(x: number, y: number, within: number): string | null {
    const page = this.renderer.pageView.pages()[this.page]
    // 紙の外（まわりの灰色の所）を押したときは開かない
    const paper = page?.getBoundingClientRect()
    if (!paper || x < paper.left || x > paper.right || y < paper.top || y > paper.bottom) return null
    let best: { id: string; d: number } | null = null
    for (const el of page?.querySelectorAll<HTMLElement>('[data-block-id]') ?? []) {
      const id = el.dataset.blockId!
      if (id !== FIELD_IDS.course && !ops.findEditable(this.report, id)) continue
      const r = el.getBoundingClientRect()
      if (!r.width && !r.height) continue
      const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom))
      if (d <= within && (!best || d < best.d)) best = { id, d }
    }
    return best?.id ?? null
  }

  /** (x, y) が、見えているページの紙の外（まわりの灰色の所）か（紙面がまだなければ false） */
  private outsidePaper(x: number, y: number): boolean {
    const paper = this.renderer.pageView.pages()[this.page]?.getBoundingClientRect()
    return !!paper && paper.width > 0 && (x < paper.left || x > paper.right || y < paper.top || y > paper.bottom)
  }

  /** id が見出し・図表のタイトルで、y がその行（見えているページの部分）より下か */
  private belowLine(id: string, y: number): boolean {
    const kind = ops.findEditable(this.report, id)?.kind
    if (kind !== 'chapter' && kind !== 'subheading' && kind !== 'figureCaption' && kind !== 'tableCaption') return false
    const view = this.renderer.pageView
    const fragment = view.fragments(id).filter((f) => view.pageIndexOf(f) === this.page).at(-1)
    const line = fragment?.closest<HTMLElement>('h1, h2, figcaption, .table-caption') ?? fragment
    return !!line && y > line.getBoundingClientRect().bottom + 2
  }

  /**
   * スマホ：まだ書いていない欄の「＋」の印（紙面の下の帯を出している間だけ出る。見た目は index.css の「v32 ④」「v32 の直し」）を押したか。
   * 押した欄の ID（なければ null）。印は紙面では 14px ほどで、横向きの小さな紙面では、印の上の方を押すと上の見出しが開いていたため、
   * 印のまわり 44px 四方を、その欄の押せる範囲にする。ただし、ほかの欄（見出しなどの文字・図・表のセル・写真の枠）の上を押したときは、
   * そちらを開く（印そのものの上は、印が上に描かれているので、印の欄）。いくつかの印が近いときは、いちばん近い印
   */
  private markerAt(x: number, y: number, target: HTMLElement): string | null {
    if (this.scroller.closest<HTMLElement>('.stage')?.dataset.band !== 'fields') return null
    const page = this.renderer.pageView.pages()[this.page]
    if (!page) return null
    const scale = this.stage.scale
    // 押した所にある、紙面の物
    const content = target.closest<HTMLElement>('[data-block-id], h1, h2, p, figure, figcaption, td, th, [data-photo-slot], [data-abstract-start], .el')
    let best: { id: string; d: number } | null = null
    for (const el of page.querySelectorAll<HTMLElement>('[data-block-id][data-placeholder]:empty')) {
      const mark = getComputedStyle(el, '::after')
      const size = parseFloat(mark.width) * scale
      if (mark.content === 'none' || mark.content === 'normal' || !(size > 0)) continue
      // 印の真ん中（印は、上端の位置を真ん中にして描いている：translateY(-50%)）
      const r = el.getBoundingClientRect()
      const cx = r.left + parseFloat(mark.left) * scale + size / 2
      const cy = r.top + parseFloat(mark.top) * scale
      const d = Math.hypot(x - cx, y - cy)
      const onMark = d <= size / 2 + 1
      if (!onMark && (Math.abs(x - cx) > 22 || Math.abs(y - cy) > 22)) continue
      if (!onMark && content && content !== el && !content.contains(el)) continue
      if (!best || d < best.d) best = { id: el.dataset.blockId!, d }
    }
    return best?.id ?? null
  }

  select(selection: Selection): void {
    if (this.overlay.blockId) this.overlay.commit()
    this.selection = selection
    if (selection && selection.kind !== 'photos') this.currentId = selection.id
    this.markSelection()
    this.notify()
  }

  /** 表のタイトル・セルの ID から、その表の ID を求める */
  tableIdOf(id: string): string | null {
    return ops.findTable(this.report, id)?.id ?? null
  }

  /** 選んでいる図・表に枠を付ける */
  private markSelection(): void {
    for (const el of this.viewport.querySelectorAll('.is-selected')) el.classList.remove('is-selected')
    const s = this.selection
    if (s?.kind === 'figure') this.viewport.querySelector(`figure[data-figure-id="${CSS.escape(s.id)}"]`)?.classList.add('is-selected')
    if (s?.kind === 'table') this.renderer.pageView.fragments(s.id)[0]?.closest('.data-table')?.classList.add('is-selected')
    if (s?.kind === 'pageBreak') this.renderer.pageView.fragments(s.id)[0]?.classList.add('is-selected')
    // 選んだ作品写真（写真が入っている枠だけ）
    if (s?.kind === 'photos' && s.index !== undefined) {
      const slot = this.viewport.querySelector<HTMLElement>(photoSlotSelector(s.page, s.index))
      if (slot?.querySelector('img')) {
        slot.dataset.photoLabel = `${s.index + 1}枚目`
        slot.classList.add('is-selected')
      }
    }
  }

  // ---- 変更 ----

  /** 原稿を変える前の状態を、元に戻せるように覚える（新しく変えたので、やり直しの分は消える） */
  private pushHistory(report: Report): void {
    this.history.push(report)
    this.historySeq += 1
  }

  private afterChange({ render, save }: { render: 'now' | 'debounce'; save: boolean }): void {
    this.report = { ...this.report, updatedAt: new Date().toISOString() }
    this.changeSeq += 1
    // 書き終えた欄の仮の表示は、その欄の文字が変わった（元に戻した・消したなど）ら外す
    this.clearFrozen(Infinity, (f) => ops.findEditable(this.report, f.id)?.text === f.text)
    if (save) this.callbacks.onChange(this.report)
    // 書いている欄を確定して、続けて原稿を変えるところ（commitForChange）：変えたあとの原稿で1回だけ組み直す
    if (this.holdingRender) {
      this.renderOwed = true
      return
    }
    this.renderOwed = false
    if (render === 'now') void this.render()
    else {
      // 入力中も、文字の指摘はすぐに更新する（組版を待たない）
      this.runChecks()
      this.scheduleRender()
    }
    this.notify()
  }

  /** 書いている欄を確定している途中か（commitForChange）。確定のための組み直しを待たせ、待たせたら renderOwed */
  private holdingRender = false
  private renderOwed = false

  /**
   * 書いている欄を確定してから、続けて原稿を変えるとき（削除・元に戻すなど）。確定した原稿では組み直さず、変えたあとの原稿で1回だけ組み直す。
   * 確定の組み直しが先に始まると、変える前の原稿を組み終えるのを待ってからもう一度組むため、段落の削除などが紙面に出るまで倍の時間がかかっていた。
   * 続けて原稿を変えなかったとき（元に戻すものがなかったなど）は、確定した原稿で組み直す
   */
  private commitForChange(): void {
    if (!this.overlay.blockId) return
    this.holdingRender = true
    try {
      this.overlay.commit()
    } finally {
      this.holdingRender = false
    }
    queueMicrotask(() => {
      if (!this.renderOwed) return
      this.renderOwed = false
      void this.render()
      this.notify()
    })
  }

  /** 報告書を変更する（元に戻せる） */
  update(fn: (report: Report) => Report): void {
    this.commitForChange()
    this.pushHistory(this.report)
    this.report = fn(this.report)
    this.afterChange({ render: 'now', save: true })
  }

  undo(): void {
    // 削除の知らせが出ている間に戻した（知らせの「戻す」でも、道具の「元に戻す」でも）：「〜を戻しました」と知らせる。
    // 「抄録を書き始めました」が出ている間に戻した：「抄録を書き始める前に戻しました」
    const shown = this.currentNotice
    // 表の行・列を消した知らせの「戻す」：消す前に書いていたマスを、戻したあと書き続ける（消したあとも書き続けているため）
    const keepWriting = shown && tableCutNotice(shown) && this.overlay.blockId ? (this.tableCutFrom ?? { id: this.overlay.blockId, caret: this.overlay.caret }) : null
    this.tableCutFrom = null
    this.commitForChange()
    // 段落を見出しにしたのを戻す（知らせの「戻す」でも、Ctrl+Z・道具の「元に戻す」でも）：打ったままの段落に戻る
    const heading = this.history.last ? this.headingSteps.get(this.history.last) : undefined
    // やり直したときは、いま出ている知らせ（「段落を削除しました［戻す］」など）を、もう一度出す（見出しにしたのは、いつも）
    const again: NoticeBody | null = heading ? heading.notice : shown?.kind === 'removed' ? { kind: 'removed', what: shown.what, note: shown.note } : shown?.kind === 'started' ? { kind: 'started' } : null
    const previous = this.history.undo(this.report, again)
    if (!previous) return
    this.historySeq += 1
    // 戻した段落は、同じ文のままなら、もう見出しにしない（Enter をもう一度押しても、ふつうに段落を分ける）
    if (heading) for (const [id, line] of heading.declined) this.declined.set(id, line)
    // 戻した所は、組み直した紙面で見せる（ほかのページでも、そこへ移って少しの間光らせる）
    this.undone = changedPlace(this.report, previous)
    this.report = previous
    this.afterChange({ render: 'now', save: true })
    const restored: NoticeBody | null = heading ? { kind: 'unheaded' } : shown?.kind === 'removed' ? { kind: 'restored', what: shown.what } : shown?.kind === 'started' ? { kind: 'unstarted' } : null
    this.notice = restored ? { notice: { ...restored, id: ++this.noticeCount }, report: this.report } : null
    // 削除して、まだ組み直していない間に戻したもの：すぐまた見せる
    this.hideRemoved()
    this.notify()
    if (keepWriting && ops.findEditable(this.report, keepWriting.id)) this.openWhenReady(keepWriting.id, keepWriting.caret)
  }

  /**
   * やり直す（mockups/v35 ④ 案A）：元に戻した操作を、もう一度する（戻しすぎたとき）。元に戻したあと、ほかを変えていなければできる。
   * 変わった所は、元に戻したときと同じく、組み直した紙面で見せる（ほかのページなら、そこへ移って光らせる）。
   * 削除をやり直したときは、削除したときと同じく、組み直すのを待たずに紙面から隠し、「〜を削除しました［戻す］」をもう一度出す
   */
  redo(): void {
    this.commitForChange()
    const before = bodyIds(this.report)
    const next = this.history.redo(this.report)
    if (!next) return
    this.historySeq += 1
    // 見出しにしたのをやり直した：また元に戻せるように、積んだ原稿（打ったままの段落）に、そのことを付け直す
    const heading = next.note ? this.headingStepOfNotice.get(next.note) : undefined
    if (heading && this.history.last) {
      this.headingSteps.set(this.history.last, heading)
      for (const [id] of heading.declined) this.declined.delete(id)
    }
    this.undone = changedPlace(this.report, next.state)
    this.report = next.state
    this.afterChange({ render: 'now', save: true })
    const after = bodyIds(this.report)
    for (const id of before) if (!after.has(id)) this.removed.add(id)
    this.hideRemoved()
    this.notice = next.note ? { notice: { ...next.note, id: ++this.noticeCount }, report: this.report } : null
    if (heading) {
      this.headingNoticeAt = { history: this.historySeq, input: this.inputSeq }
      this.shownHeadingStep = heading
    }
    this.notify()
  }

  /** 報告書を丸ごと入れ替える（復元・新規作成）。履歴は消す */
  replace(report: Report): void {
    this.commitForChange()
    // 履歴は原稿ごと（入れ替えた原稿では、元に戻す・やり直すの両方とも、はじめから）
    this.history.clear()
    this.historySeq += 1
    this.declined.clear()
    this.report = report
    this.selection = null
    this.currentId = null
    this.undone = null
    this.removed.clear()
    this.hideRemoved()
    this.clearFrozen(Infinity)
    // 入れ替えた原稿の紙面が出るまで、前の原稿の紙面を見せない（Word から読み込んだ直後に、読み込む前の表紙が一瞬見えていた）
    this.replacing = this.changeSeq + 1
    this.afterChange({ render: 'now', save: true })
  }

  /** 原稿を丸ごと入れ替えたときの、変更の回数（その変更を含む紙面が出るまで「紙面を準備しています…」を出す。null なら入れ替えていない） */
  private replacing: number | null = null

  /**
   * 削除したブロック・図・表の ID。組み直した紙面に出なくなるまで、今の紙面ですぐ隠す。
   * 組み直しは長い原稿では1秒ほどかかり、その間は削除したものが紙面に残って見えたため（押しても消えないと思い、もう一度押してしまう）。
   * 隠している間（組み直した紙面がまだ出ていない間）は、紙面を押しても開かず、続けて削除もしない（古い紙面の隣のブロックを開いて消さないように）
   */
  private readonly removed = new Set<string>()

  /** 原稿を削除で変える（元に戻せる）。消えたものは、組み直すのを待たずに紙面から隠す。what：消したもの（画面の下に知らせる） */
  private removeNow(fn: (report: Report) => Report, what: RemovedWhat, note?: string): void {
    const before = bodyIds(this.report)
    this.update(fn)
    // 隠した分だけ紙面の後ろの文章が詰まり、書き終えた欄の仮の表示と位置が合わなくなるので外す
    this.clearFrozen(Infinity)
    const after = bodyIds(this.report)
    const gone = [...before].filter((id) => !after.has(id))
    for (const id of gone) this.removed.add(id)
    this.hideRemoved()
    if (gone.length > 0) this.noticeRemoved(what, note)
  }

  // ---- 削除の「戻す」の知らせと、元に戻した所（mockups/v32 ② 案A。言葉と比べ方は undoNotice.ts、知らせの部品は app/UndoBar.tsx） ----

  /**
   * 画面の下に出す知らせと、出したときの原稿（ほかを変えたら出さない）。
   * until：原稿が変わっても出しておく知らせ（showNotice。貼り付けた・「。」を付けたなど、書いている途中の知らせ）の、出しておく時刻の終わり
   */
  private notice: { notice: UndoNotice; report: Report; until?: number } | null = null
  private noticeCount = 0
  /** 元に戻して変わった所（組み直したら、そこへ移って光らせる） */
  private undone: ChangedPlace | null = null

  /** いま出す知らせ：削除した・戻した直後の原稿のまま（ほかを変えていない）で、書き始めていないとき */
  private get currentNotice(): UndoNotice | null {
    if (!this.notice) return null
    // 段落を見出しにした知らせ：そのあと、ほかを変えず（元に戻す・やり直すもせず）、書き始めてもいない間だけ出す。
    // 書いている間も出す（Enter で見出しにすると、すぐ後ろの段落を書いているため）
    if (headingNotice(this.notice.notice)) {
      const at = this.headingNoticeAt
      return at && at.history === this.historySeq && at.input === this.inputSeq ? this.notice.notice : null
    }
    const fresh = this.notice.until !== undefined ? Date.now() < this.notice.until : this.notice.report === this.report
    // 戻すもののない知らせ（表の行・列を消せないわけ）と、表の行・列を消した知らせは、書いている間も出す（セルを書いている間に押すため。
    // 消したあとも、となりのマスを書き続ける）
    const n = this.notice.notice
    const whileEditing = n.kind === 'info' || tableCutNotice(n)
    return fresh && (!this.overlay.blockId || whileEditing) ? n : null
  }

  /**
   * 戻すもののない短い知らせを、画面の下に出す。原稿が変わっても（書き続けても）、しばらく出しておく
   * （貼り付けたものを、そのままの形では入れなかった・「。」を自動で付けた・引用・参考文献を反映した、など）
   */
  showNotice(text: string): void {
    this.notice = { notice: { kind: 'info', text, id: ++this.noticeCount }, report: this.report, until: Date.now() + STICKY_NOTICE_MS }
    this.notify()
  }

  /** Enter で「。」を自動で付けたことを、開いている間に1回だけ知らせる（すぐ Backspace で取り消せることも） */
  private noticeAutoPeriodOnce(): void {
    if (this.autoPeriodNoticed) return
    this.autoPeriodNoticed = true
    this.showNotice('段落の終わりに「。」を付けました（すぐ Backspace で取り消せます）')
  }
  private autoPeriodNoticed = false

  /** 削除した（画面の下に「〜を削除しました［戻す］」を出す） */
  private noticeRemoved(what: RemovedWhat, note?: string): void {
    this.notice = { notice: { kind: 'removed', what, ...(note ? { note } : {}), id: ++this.noticeCount }, report: this.report }
    this.notify()
  }

  /** 元に戻した所へ移り（ほかのページならめくる。拡大していれば、そこまで動かす）、少しの間光らせる */
  private showUndone(place: ChangedPlace): void {
    const view = this.renderer.pageView
    const targets = this.undoneElements(place)
    const page = targets.length ? view.pageIndexOf(targets[0]) : place.kind === 'area' ? this.pageOfArea(place.area, place.page) : -1
    if (page < 0) return
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    const light = (here: HTMLElement[]) => {
      for (const el of here) el.classList.add('undo-flash')
      window.setTimeout(() => here.forEach((el) => el.classList.remove('undo-flash')), UNDO_FLASH_MS)
    }
    // 光らせるのは、そこが見えてから（ページをめくり終え、拡大していればそこまで動かし終えてから）。
    // 前は動かし始めると同時に光らせたため、画面の下の方の段落では、見えたときには光が消えていた
    // 見開きのときは、並べている2ページのどちらにあっても、めくらずに光らせる
    const flash = () => {
      const here = targets.filter((el) => this.isVisiblePage(view.pageIndexOf(el)))
      if (here.length && this.stage.zoomed && !this.inView(here[0])) this.scrollThen(here[0], still, () => light(here))
      else light(here)
    }
    if (this.isVisiblePage(page)) flash()
    else void this.goToPage(page).then(flash)
  }

  /** el が、紙面の表示枠の中に見えているか（上下とも） */
  private inView(el: HTMLElement): boolean {
    const r = el.getBoundingClientRect()
    const s = this.scroller.getBoundingClientRect()
    return r.top >= s.top && r.bottom <= s.bottom
  }

  /** el が表示枠の真ん中に来るまで動かし、動かし終えたら done（動かせないときはすぐ。終わりが分からないときも、少し待って done） */
  private scrollThen(el: HTMLElement, still: boolean, done: () => void): void {
    const scroller = this.scroller
    const r = el.getBoundingClientRect()
    const s = scroller.getBoundingClientRect()
    const top = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, scroller.scrollTop + r.top - s.top - (s.height - r.height) / 2))
    // それ以上動かせない（すでに端まで来ている）ときは、すぐ
    if (Math.abs(top - scroller.scrollTop) < 2) return done()
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      scroller.removeEventListener('scrollend', finish)
      clearTimeout(timer)
      done()
    }
    const timer = window.setTimeout(finish, still ? 150 : 1200)
    scroller.addEventListener('scrollend', finish)
    scroller.scrollTo({ top, behavior: still ? 'auto' : 'smooth' })
  }

  /** 元に戻した所の、紙面の要素（段落・見出しごと、図・表ごと） */
  private undoneElements(place: ChangedPlace): HTMLElement[] {
    const all = (selector: string) => [...this.viewport.querySelectorAll<HTMLElement>(selector)]
    switch (place.kind) {
      case 'block':
        return this.renderer.pageView.fragments(place.id).map((el) => el.closest<HTMLElement>('h1, h2, figure, td, th, .table-caption') ?? el)
      case 'figure':
        return all(`figure[data-figure-id="${CSS.escape(place.id)}"]`)
      case 'group':
        // 図のまとまりは本文の幅いっぱいなので、図（写真とタイトル）ごとに光らせる
        return all(`.figure-group[data-group-id="${CSS.escape(place.id)}"] figure`)
      case 'table':
        return all(`.data-table[data-table-id="${CSS.escape(place.id)}"]`)
      case 'photo':
        return all(photoSlotSelector(place.page, place.index))
      case 'area':
        return []
    }
  }

  /** 削除したものを紙面で隠す（元に戻して、原稿にまたあるものは隠さない） */
  private hideRemoved(): void {
    const present = bodyIds(this.report)
    const selectors = [...this.removed]
      .filter((id) => !present.has(id))
      .flatMap((id) => {
        const e = CSS.escape(id)
        // 段落・見出しの文字、図、表、図のまとまり、見出しの番号（Ⅰ．ⅰ．）ごと
        return [`[data-block-id="${e}"]`, `[data-figure-id="${e}"]`, `[data-table-id="${e}"]`, `[data-group-id="${e}"]`, `:is(h1, h2):has(> [data-block-id="${e}"])`].map((s) => `.page-viewport ${s}`)
      })
    this.removedStyle.textContent = selectors.length ? `${selectors.join(',\n')} { display: none !important; }` : ''
  }

  setCourse(courseId: string): void {
    this.update((r) => ops.setCourse(r, courseId))
  }

  /** 本文を書き始めているか（そのコースのひな形のままでなければ、書き始めているとみなす） */
  bodyWritten(): boolean {
    return bodyWritten(this.report, this.config)
  }

  /** コースを変え、本文の下書きをそのコースのひな形に入れ替える（元に戻せる） */
  changeCourseWithTemplate(courseId: string): void {
    // 書き始めていた本文を入れ替えたときは、画面の下に「下書きを入れ替えました［戻す］」を出す（ひな形のままなら出さない）
    const written = this.bodyWritten()
    this.currentId = null
    this.selection = null
    this.update((r) => applyCourseTemplate(r, this.config, courseId))
    if (written) this.noticeRemoved('下書き')
  }

  /** ブロックの入力欄を開く。組み直しの途中なら、組み終わってから開く */
  openWhenReady(id: string, caret = 0): void {
    const page = this.renderer.pageView.pageOfOffset(id, caret)
    if (this.rendering || page < 0) {
      this.pendingOpen = { id, caret }
      if (!this.rendering) void this.render()
      return
    }
    this.openEditor(id, caret)
  }

  // ---- ブロックの追加 ----

  /**
   * 段落などを足す位置（このブロックの後ろに入る）。紙面ではなく原稿から決める：
   * - 本文を書いているときは、書いているブロックの後ろ（Enter で分けたばかりで、まだ紙面に出ていない段落も）
   * - 書いていなければ、最後に触ったブロックが見えているページにある（足したばかりで、まだ紙面に出ていないときも）ならその後ろ
   * - どちらでもなければ、見えているページの最後の後ろ
   * 前は、紙面に出ているかで決めていたため、分けたばかりの段落を書いてすぐ「小見出し」を押すと、その段落の前に入っていた
   */
  private insertionAnchor(): string | null {
    const view = this.renderer.pageView
    const editing = this.overlay.blockId
    if (editing && ops.inBody(this.report, editing)) {
      // スマホのキーボードの上の「追加」→「改ページ」で、書いている欄のすぐ後ろに入れた改ページ：続けて足すものは、その後ろ（次のページ）へ（PC で改ページを入れたあとと同じ）
      const pb = this.breakAfterEditing
      if (pb?.id === editing) {
        const blocks = this.report.body.flatMap((c) => c.blocks)
        if (blocks[blocks.findIndex((b) => b.id === editing) + 1]?.id === pb.pb) return pb.pb
      }
      return editing
    }
    const id = this.currentId
    if (id && ops.inBody(this.report, id)) {
      const fragments = view.fragments(id)
      if (fragments.length === 0 || fragments.some((f) => view.pageIndexOf(f) === this.page)) return id
    }
    const blocks = view.pages()[this.page]?.querySelectorAll<HTMLElement>('section.body [data-block-id]:not(.page-break)')
    return blocks?.length ? blocks[blocks.length - 1].dataset.blockId! : (editing ?? id)
  }

  /** 段落などを足す道具にマウスを重ねたとき、紙面のどこに入るかを線で示す */
  previewInsert(on: boolean): void {
    this.marker.hidden = true
    if (!on) return
    const id = this.insertionAnchor()
    const view = this.renderer.pageView
    const fragments = id ? view.fragments(id).filter((f) => view.pageIndexOf(f) === this.page) : []
    const last = fragments[fragments.length - 1]
    if (!last) return
    const block = (last.closest('figure, .data-table, h1, h2, p') as HTMLElement | null) ?? last
    const r = block.getBoundingClientRect()
    const l = this.layer.getBoundingClientRect()
    Object.assign(this.marker.style, { left: `${r.left - l.left}px`, top: `${r.bottom - l.top + 2}px`, width: `${r.width}px` })
    this.marker.hidden = false
  }

  private insertAndEdit(block: BodyBlock, editId: string, after = this.insertionAnchor()): void {
    this.marker.hidden = true
    this.commitForChange()
    this.pushHistory(this.report)
    // 何も書いていない段落（ひな形の説明もない）で小見出しを押したときは、その段落を小見出しに置き換える（同じ位置。空の段落を残さない）
    const replace = block.type === 'subheading' && !!after && ops.isBlankParagraph(this.report, after)
    this.report = replace && after ? ops.replaceBlock(this.report, after, block) : ops.insertAfter(this.report, after, block)
    this.reopenAfterRender(editId, 0, after ? { id: after, place: replace ? 'over' : 'after' } : null)
  }

  /** 抄録を書き始めるまでは、抄録のページを PDF（印刷）に入れない（画面には、案内と「先生の許可が出た」ボタンを出す） */
  private markPrintSkip(): void {
    const skip = this.report.abstract.started === false
    this.renderer.pageView.pages().forEach((page, i) => page.classList.toggle('print-skip', skip && this.layout?.kinds[i] === 'abstract'))
  }

  /**
   * 抄録を書き始める（先生の許可が出た）。画面の下に「抄録を書き始めました［戻す］」を出す（削除と同じ知らせ。戻すと、書き始める前に戻る）。
   * 押すと確かめずに変わり、戻し方が見えなかったため。書く欄は開かない（開くと、書いている間は知らせが隠れるため。抄録の段落を押すと書き始められる）
   */
  startAbstract(): void {
    if (this.report.abstract.started !== false) return
    // キーボードで押したとき：押した欄は無くなるので、組み直したあと、抄録の最初の段落に移る（Enter で書き始められる）
    const first = this.report.abstract.paragraphs[0]
    const active = document.activeElement
    if (first && active instanceof HTMLElement && active.closest('[data-abstract-start]') && active.matches(':focus-visible')) {
      active.blur()
      this.refocusKey = blockPaperKey(first.id)
    }
    this.update((r) => ({ ...r, abstract: { ...r.abstract, started: true } }))
    this.notice = { notice: { kind: 'started', id: ++this.noticeCount }, report: this.report }
    this.notify()
  }

  /**
   * 削除したばかりで、まだ組み直した紙面が出ていない（removed）。この間は、道具で足す・入れるも何もしない
   * （図の「削除」をすばやく2回押すと、2回目が、入れ替わった道具の「改ページ」などに当たってしまうため）
   */
  private get settlingRemoval(): boolean {
    return this.removed.size > 0
  }

  /** スマホで書いている間に「追加」→「改ページ」で入れた改ページと、書いていた欄（続けて足すものを、改ページの後ろに入れる：insertionAnchor） */
  private breakAfterEditing: { id: string; pb: string } | null = null

  /** 改ページを入れる（足す位置の後ろ。この後ろは次のページから始まる） */
  addPageBreak(): void {
    if (this.settlingRemoval) return
    const after = this.insertionAnchor()
    const id = ops.newId('pb')
    this.marker.hidden = true
    // スマホで紙面に直接書いている間（キーボードの上の「追加」）：入れたあとも、同じ欄を同じ所から書き続ける（キーボードを閉じない）
    const keep = this.writingOnPaper && this.overlay.blockId ? { id: this.overlay.blockId, caret: this.overlay.caret } : null
    if (keep) {
      this.breakAfterEditing = { id: keep.id, pb: id }
      this.commitForChange()
      this.pushHistory(this.report)
      this.report = ops.insertAfter(this.report, after, { type: 'pageBreak', id })
      this.reopenAfterRender(keep.id, keep.caret)
      return
    }
    this.update((r) => ops.insertAfter(r, after, { type: 'pageBreak', id }))
    this.currentId = id
  }

  addParagraph(): void {
    if (this.settlingRemoval) return
    const id = ops.newId('p')
    this.insertAndEdit({ type: 'paragraph', id, content: [{ type: 'text', text: '' }] }, id)
  }

  addSubheading(): void {
    if (this.settlingRemoval) return
    const id = ops.newId('s')
    this.insertAndEdit({ type: 'subheading', id, title: '' }, id)
  }

  addChapter(): void {
    if (this.settlingRemoval) return
    const after = this.insertionAnchor()
    this.marker.hidden = true
    this.commitForChange()
    const chapter: Chapter = { id: ops.newId('c'), title: '', blocks: [{ type: 'paragraph', id: ops.newId('p'), content: [{ type: 'text', text: '' }] }] }
    this.pushHistory(this.report)
    this.report = ops.insertChapterAfter(this.report, after, chapter)
    // 入力欄は、前の章の最後のブロックのすぐ下に仮に置く（組み直したら、新しい章の見出しの位置へ）
    const prev = this.report.body[this.report.body.findIndex((c) => c.id === chapter.id) - 1]
    this.reopenAfterRender(chapter.id, 0, prev ? { id: prev.blocks.at(-1)?.id ?? prev.id, place: 'after' } : null)
  }

  /**
   * 図を入れる。必ず文中の入れたい位置で入れる：段落を書いているカーソルのある文の終わり（「。」の前）に「（図n）」を入れ、その段落のすぐ下に図を置く
   * （同じ段落の図はひとまとまり）。写真を選んだら図のタイトルの入力欄を開き、Enter で図の後ろに新しい段落ができる（mockups/v32 ① 案A）
   */
  async addFigure(): Promise<void> {
    if (this.settlingRemoval) return
    const paragraphId = this.editingParagraph()
    if (paragraphId) return this.insertFigureAtCaret(paragraphId)
  }

  /** 本文の段落を書いているなら、その段落の ID */
  private editingParagraph(): string | null {
    const id = this.overlay.blockId
    return id && ops.findEditable(this.report, id)?.kind === 'paragraph' ? id : null
  }

  private async insertFigureAtCaret(paragraphId: string): Promise<void> {
    const caret = this.overlay.caret
    this.marker.hidden = true
    // 書いた文字を確定してから写真を選ぶ（写真を選ぶ画面を開くと入力欄は閉じる。段落のまま確定する：見出しの形でも見出しにしない）
    this.commitAsParagraph()
    // ひな形を作る画面：写真は選ばず、空の枠を入れる（学生が写真を入れる）
    const imageId = this.template ? '' : await this.importImage('figure')
    if (imageId === null) {
      this.reopenAfterRender(paragraphId, caret)
      return
    }
    const figure = { id: ops.newId('f'), imageId, caption: '' }
    this.pushHistory(this.report)
    const near = this.placeObject(paragraphId, caret, figure.id, { type: 'figureRow', id: ops.newId('r'), figures: [figure] }, (r) => ops.addFigureBelow(r, paragraphId, figure))
    this.reopenAfterRender(figure.id, 0, near)
  }

  /**
   * 段落 paragraphId で入れた図・表（objectId。block：図のまとまり・表）を、原稿に置く。below：段落のすぐ下に置く処理。
   * - 書いてある段落：カーソルのある文の終わりに「（図n）」を入れ、段落の下に置く（段落にその番号を手で書いていれば「図1に示す」、
   *   （図1）は足さずに、書いた番号を図表につなげる）
   * - 何も書いていない段落：「（表1）。」だけの段落を作らない（PDF にも出ていたため）。説明のない段落は図・表と置き換え（同じ位置）、
   *   ひな形の説明がある段落は残して、その下に置く。本文で参照していないことは、セルフチェックで知らせる（「本文中に「図n」…を入れる」）
   * 返り値：図・表のタイトルの入力欄を、紙面に出るまで仮に置く目印
   */
  private placeObject(paragraphId: string, caret: number, objectId: string, block: BodyBlock, below: (report: Report) => Report): InsertNear {
    if (ops.isBlankParagraph(this.report, paragraphId)) {
      this.report = ops.replaceBlock(this.report, paragraphId, block)
      return { id: paragraphId, place: 'over' }
    }
    // ひな形を作る画面：段落の字は学生に薄く出す説明なので、「（図n）」は足さずに、段落の下に置く
    if (ops.paragraphEmpty(this.report, paragraphId) || this.template) {
      this.report = below(this.report)
      return { id: paragraphId, place: 'after' }
    }
    const next = below(ops.insertRef(this.report, paragraphId, caret, objectId))
    this.report = ops.linkWrittenRef(next, paragraphId, objectId) ?? next
    return { id: paragraphId, place: 'after' }
  }

  /**
   * 表を入れる（空の表か、素材表のひな形）。図と同じく、カーソルのある文の終わりに「（表n）」が入り、段落のすぐ下に表が入る。
   * タイトルを書いて Enter を押すと、表の後ろに新しい段落ができる。
   * size：空の表の大きさ（列・行。行は見出しの行も数える。入れる前に選ぶ：mockups/v35 ②。なければ 2列×2行）
   */
  addTable(kind: 'blank' | 'material', size?: { columns: number; rows: number }): void {
    const paragraphId = this.editingParagraph()
    if (!paragraphId || this.settlingRemoval) return
    const caret = this.overlay.caret
    this.commitForChange()
    const tableId = ops.newId('t')
    const table = kind === 'material' ? materialTable(tableId, ops.newId) : blankTable(tableId, ops.newId, '', size?.columns, size?.rows)
    this.pushHistory(this.report)
    const near = this.placeObject(paragraphId, caret, tableId, table, (r) => ops.addTableBelow(r, paragraphId, table))
    // 仮のタイトル（素材表の「使用素材表」）があれば、その後ろから書く（前に付け足してしまわないように）
    this.reopenAfterRender(tableId, ops.findEditable(this.report, tableId)?.text.length ?? 0, near)
  }

  // ---- 選んでいる図・表の操作 ----

  async replaceFigureImage(figureId: string): Promise<void> {
    const imageId = await this.importImage('figure')
    if (!imageId) return
    this.update((r) => ({
      ...r,
      body: r.body.map((c) => ({
        ...c,
        blocks: c.blocks.map((b) => (b.type === 'figureRow' ? { ...b, figures: b.figures.map((f) => (f.id === figureId ? { ...f, imageId } : f)) } : b)),
      })),
    }))
  }

  /**
   * 選んでいる図（のまとまり）を、その小見出しのまとまりのいちばん下へ（'sectionEnd'）・最初に参照している段落のすぐ下へ（'paragraph'）動かす
   * （依頼者の選択 2026-10-22 案A）。元に戻す1回で戻る。動かした先のページを見せ、図は選んだまま
   */
  async moveFigure(figureId: string, to: 'sectionEnd' | 'paragraph'): Promise<void> {
    const next = ops.moveFigureRow(this.report, figureId, to)
    if (next === this.report) return
    this.update(() => next)
    this.select({ kind: 'figure', id: figureId })
    await this.whenLaidOut()
    const page = this.pageOfBlock(figureId)
    // 別のページへ動いたら、そのページを見せて、図を選び直す（ページを送ると、選んでいたものは外れるため）
    if (page >= 0 && page !== this.page) {
      await this.goToPage(page, 'none')
      this.select({ kind: 'figure', id: figureId })
    }
    this.markSelection()
  }

  /** 選んでいる図の横に、もう1枚並べる（2枚まで） */
  /** 選んでいる図のすぐ後ろに、もう1枚加える。本文のその図への参照のすぐ後ろにも「（図n）」を足す */
  async addFigureBeside(figureId: string): Promise<void> {
    const imageId = await this.importImage('figure')
    if (!imageId) return
    const newFigure = { id: ops.newId('f'), imageId, caption: '' }
    this.pushHistory(this.report)
    this.report = ops.insertRefAfterRef(ops.addFigureAfter(this.report, figureId, newFigure), figureId, newFigure.id)
    // 段落にその図の番号を手で書いていたら（「図2に示す」）、（図2）は足さずに、書いた番号を図につなげる
    const paragraph = this.report.body.flatMap((c) => c.blocks).find((b) => b.type === 'paragraph' && b.content.some((n) => n.type === 'ref' && n.targetId === newFigure.id))
    if (paragraph) this.report = ops.linkWrittenRef(this.report, paragraph.id, newFigure.id) ?? this.report
    this.reopenAfterRender(newFigure.id, 0, { id: figureId, place: 'after' })
  }

  /** 段落・小見出し・大見出し（章ごと）を削除する。削除したばかりで、まだ組み直していなければ何もしない（removed） */
  removeBlock(id: string): void {
    const editable = ops.findEditable(this.report, id)
    if (!editable || this.removed.size > 0) return
    this.hideStyle.textContent = ''
    this.currentId = null
    const what = editable.kind === 'chapter' ? '大見出し（章）' : editable.kind === 'subheading' ? '小見出し' : '段落'
    this.removeNow((r) => (editable.kind === 'chapter' ? ops.removeChapter(r, id) : ops.removeBlock(r, id)), what)
  }

  removeSelected(): void {
    const s = this.selection
    if (!s || s.kind === 'photos' || this.removed.size > 0) return
    this.selection = null
    // 図・表を消すときは、本文のその図・表への参照も一緒に消す（文の中の参照は「図?」になり、チェックで指摘される）
    this.removeNow(
      (r) => (s.kind === 'figure' ? ops.removeFigure(r, s.id) : s.kind === 'table' ? ops.removeTable(r, s.id) : ops.removeBlock(r, s.id)),
      s.kind === 'figure' ? '図' : s.kind === 'table' ? '表' : '改ページ',
    )
  }

  /** 表を書いているセル（書いていなければ最後に触ったセル） */
  private currentCell(tableId: string): { table: TableBlock; row: number; column: number; cellId: string } | null {
    const table = ops.findTable(this.report, tableId)
    if (!table) return null
    const id = this.overlay.blockId ?? this.currentId
    const at = id ? cellPosition(table, id) : null
    const row = at?.row ?? table.rows.length - 1
    const column = at?.column ?? (table.rows[0]?.cells.length ?? 1) - 1
    return { table, row, column, cellId: table.rows[row]?.cells[column]?.id ?? '' }
  }

  /** 行を足す（書いているセルの行の下。足した行の最初のセルを書く） */
  addTableRow(tableId: string): void {
    const at = this.currentCell(tableId)
    if (!at) return
    this.commitForChange()
    this.pushHistory(this.report)
    const { table, firstCellId } = addRow(at.table, at.row, ops.newId)
    this.report = ops.updateTable(this.report, tableId, () => table)
    this.reopenAfterRender(firstCellId, 0, { id: at.cellId, place: 'after' })
  }

  /**
   * 書いているセルの行を消す（見出しの行と、最後の1行は残す）。
   * 消せないときは、わけと表ごと消す方法を画面の下に知らせる（前は押しても何も起きず、表を消す方法も分からなかった）
   */
  removeTableRow(tableId: string): void {
    const at = this.currentCell(tableId)
    if (!at) return
    if (at.table.rows.length <= 2) return this.noticeInfo(`表には、見出しの行ともう1行が要ります。${this.removeTableHow()}`)
    if (at.row <= 0) return this.noticeInfo(`見出しの行（1行目）は消せません。ほかの行は、その行のセルを書いているときに「行を消す」で消せます。`)
    // 書いていたら、消したあとは1つ上の行の同じ列のマスを書く（前は書き終わりになり、スマホではキーボードが閉じて、次の「行を消す」が
    // 見えない行を消していた）。画面の下に「表の行を消しました［戻す］」（はじめて使う学生の試し 2026-10-21）
    const keep = this.overlay.blockId ? at.table.rows[at.row - 1]?.cells[at.column]?.id : undefined
    const caret = this.overlay.blockId ? this.overlay.caret : 0
    this.changeTable(tableId, (t) => removeRow(t, at.row), keep)
    this.tableCutFrom = keep ? { id: at.cellId, caret } : null
    this.noticeRemoved('表の行')
  }

  /** 表を消せない操作のあとに添える、表ごと消す方法（その画面で、表の「削除」がどこにあるか） */
  private removeTableHow(): string {
    // PC：表のセル・タイトルを書いている間も、表を選んでいる間も、左の道具に「この表」の「削除」がある
    if (!this.phone) return '表ごと消すときは、左の「この表」の「削除」を押します。'
    // スマホ：表のセル・タイトルを書いている間は、キーボードの上の道具に「表を削除」がある（予備の下の書く欄では「この表を削除」）。
    // 表を選んでいる間は、下の「この表」の道具に「削除」がある
    if (!this.overlay.blockId) return '表ごと消すときは、「この表」の「削除」を押します。'
    return this.direct ? '表ごと消すときは、キーボードの上の道具の「表を削除」を押します。' : '表ごと消すときは、書く欄の「この表を削除」を押します。'
  }

  /**
   * 表を削除する（表のセル・タイトルを書いている間も。スマホの書く欄の「この表を削除」）。書く欄は閉じ、スマホはページ全体の表示に戻す。
   * 画面の下に「表を削除しました［戻す］」が出る。前は、スマホで表を消すには表のタイトル（ページ全体の表示では高さ 7px ほど）をタップするしかなかった
   */
  removeTable(tableId: string): void {
    if (!ops.findTable(this.report, tableId) || this.removed.size > 0) return
    // 書いていたセルの文字を確定してから消す（組み直すのは、消したあとの1回だけ）
    this.commitForChange()
    if (this.phone) this.setZoom(false)
    this.selection = { kind: 'table', id: tableId }
    this.removeSelected()
  }

  /** 戻すもののない短い知らせを、画面の下に出す（書いている間も出す。ほかを変えたら消える） */
  private noticeInfo(text: string): void {
    this.notice = { notice: { kind: 'info', text, id: ++this.noticeCount }, report: this.report }
    this.notify()
  }

  /** 列を足す（書いているセルの列の右） */
  addTableColumn(tableId: string): void {
    const at = this.currentCell(tableId)
    if (!at) return
    // 足した列の、書いていた行のマスへ移る（行を足すと足した行のマスへ移るのと同じ。前は書いていたマスのままで、
    // 生地見本の画像のマスを書いていたときは、続けて打った字が画像の下に入っていた：はじめて使う学生の試し 2026-10-21）
    let added: string | undefined
    this.changeTable(
      tableId,
      (t) => {
        const next = addColumn(t, at.column, ops.newId)
        added = next.rows[at.row]?.cells[at.column + 1]?.id
        return next
      },
      () => added,
    )
  }

  /** 書いているセルの列を消す（最後の1列は残す。消せないときは、わけと表ごと消す方法を知らせる） */
  removeTableColumn(tableId: string): void {
    const at = this.currentCell(tableId)
    if (!at) return
    if (Math.max(...at.table.rows.map((r) => r.cells.length)) <= 1) return this.noticeInfo(`表には1列以上が要ります。${this.removeTableHow()}`)
    // 書いていたら、消したあとは同じ行の左のマス（いちばん左の列なら、右にあったマス）を書く。画面の下に「表の列を消しました［戻す］」
    const row = at.table.rows[at.row]?.cells ?? []
    const keep = this.overlay.blockId ? row[at.column > 0 ? at.column - 1 : at.column + 1]?.id : undefined
    const caret = this.overlay.blockId ? this.overlay.caret : 0
    this.changeTable(tableId, (t) => removeColumn(t, at.column), keep)
    this.tableCutFrom = keep ? { id: at.cellId, caret } : null
    this.noticeRemoved('表の列')
  }

  /**
   * 列の幅：そろえる（同じ幅）／中身に合わせる／自分で決める（mockups/v42）。
   * 自分で決めるにするときは、前に決めた幅があればその幅、なければ、いま紙面に見えている幅から始める（見た目を変えない）
   */
  setTableWidths(tableId: string, widths: TableBlock['widths']): void {
    const table = ops.findTable(this.report, tableId)
    if (!table || table.widths === widths) return
    const colWidths = widths === 'custom' ? (colWidthsOf(table) ?? this.shownColumnWidths(table) ?? equalColumnWidths(columnCount(table))) : null
    this.changeTable(tableId, (t) => ({ ...t, widths, ...(colWidths ? { colWidths } : {}) }))
  }

  /** 自分で決めた列の幅を変える（パソコンは縦の線のドラッグ、スマホは丸いつまみ：columnHandles.ts）。元に戻す1回で戻る */
  setTableColWidths(tableId: string, colWidths: number[]): void {
    const table = ops.findTable(this.report, tableId)
    const next = table ? normalizeColumnWidths(colWidths, columnCount(table)) : null
    if (!table || !next || JSON.stringify(next) === JSON.stringify(colWidthsOf(table))) return
    this.changeTable(tableId, (t) => ({ ...t, colWidths: next }))
  }

  /** 幅をそろえ直す（どの列も同じ幅。自分で決めるのまま） */
  resetTableColWidths(tableId: string): void {
    const table = ops.findTable(this.report, tableId)
    if (table) this.setTableColWidths(tableId, equalColumnWidths(columnCount(table)))
  }

  /** 紙面に見えている表の列の幅（%）。見出しの行のセルの幅から求める（表が紙面になければ null） */
  private shownColumnWidths(table: TableBlock): number[] | null {
    const viewport = this.viewport
    const measuring = viewport.classList.contains('measuring')
    // 表のあるページが表に出ていなくても測れるよう、測る間だけ、どのページも出す（同じ処理の中で戻すので、画面には出ない）
    if (!measuring) viewport.classList.add('measuring')
    try {
      const row = viewport.querySelector(`.data-table[data-table-id="${CSS.escape(table.id)}"] table tr`)
      const ws = row ? [...row.children].map((c) => c.getBoundingClientRect().width) : []
      return ws.length === columnCount(table) ? normalizeColumnWidths(ws, ws.length) : null
    } finally {
      if (!measuring) viewport.classList.remove('measuring')
    }
  }

  /**
   * 列の幅を「自分で決める」表の、境目を動かす線・つまみを出す表（columnHandles.ts）。
   * パソコン：表のセル・タイトルを書いている間と、表を選んでいる間。スマホ：表のセルを書いている間（その列を選ぶ）
   */
  private columnTarget(): ColumnTarget | null {
    if (this.turning || this.removed.size > 0 || !this.layout) return null
    const id = this.overlay.blockId
    const tableId = id ? this.tableIdOf(id) : this.selection?.kind === 'table' ? this.selection.id : null
    const table = tableId ? ops.findTable(this.report, tableId) : null
    if (!table || table.widths !== 'custom') return null
    const cell = id && ops.findEditable(this.report, id)?.kind === 'tableCell' ? id : null
    if (this.phone && !cell) return null
    return { tableId: table.id, widths: colWidthsOf(table) ?? equalColumnWidths(columnCount(table)), cellId: this.phone ? cell : null }
  }

  /** 行の高さ：そろえる（見出しの行のほかを、いちばん高い行に合わせる）／写真が入る高さ／中身に合わせる。列の幅と同じく、元に戻す1回で戻る */
  setTableHeights(tableId: string, heights: TableBlock['heights']): void {
    if (ops.findTable(this.report, tableId)?.heights === heights) return
    this.changeTable(tableId, (t) => ({ ...t, heights }))
  }

  /** 左端の列：中身に合わせる（on）／ほかの列とそろえる。列の幅が「そろえる」のときだけ効く */
  setTableLabelColumn(tableId: string, on: boolean): void {
    if ((ops.findTable(this.report, tableId)?.labelColumn === true) === on) return
    this.changeTable(tableId, (t) => ({ ...t, labelColumn: on }))
  }

  /** 書いているセルに画像（生地見本など）を入れる・外す */
  async setCellImage(tableId: string): Promise<void> {
    const at = this.currentCell(tableId)
    if (!at?.cellId) return
    const imageId = await this.importImage('swatch')
    if (imageId) this.changeTable(tableId, (t) => setCellImage(t, at.cellId, imageId), at.cellId)
  }

  removeCellImage(tableId: string): void {
    const at = this.currentCell(tableId)
    if (at?.cellId) this.changeTable(tableId, (t) => setCellImage(t, at.cellId, null), at.cellId)
  }

  /**
   * 表を書き換える。書いていたセル（keep を渡せばそのセル）が残っていれば、続けてそのセルを書く。
   * なくなったら表を選んだ状態にする（どちらでも、表の道具が出たままになり、続けて操作できる）
   */
  private changeTable(tableId: string, fn: (table: TableBlock) => TableBlock, keep?: string | (() => string | undefined)): void {
    const editing = this.overlay.blockId
    const caret = editing ? this.overlay.caret : 0
    this.commitForChange()
    this.pushHistory(this.report)
    this.report = ops.updateTable(this.report, tableId, fn)
    // keep：変えたあとに書くマス（関数なら、表を変えてから決める：足した列のマス）
    const cellId = (typeof keep === 'function' ? keep() : keep) ?? editing
    if (cellId && ops.findEditable(this.report, cellId)) {
      this.reopenAfterRender(cellId, cellId === editing ? caret : (ops.findEditable(this.report, cellId)?.text.length ?? 0))
    } else {
      this.selection = { kind: 'table', id: tableId }
      this.afterChange({ render: 'now', save: true })
    }
  }

  /** 書いているセルに画像があるか */
  currentCellHasImage(tableId: string): boolean {
    const at = this.currentCell(tableId)
    return !!at && !!at.table.rows[at.row]?.cells[at.column]?.imageId
  }

  // ---- 段落をまたいで選ぶ（紙面をマウスでなぞって選び、コピー・切り取り・削除・貼り付け。PC だけ。範囲の決まりは rangeOps.ts） ----

  /** 紙面で選んでコピーした・切り取ったもの（書く欄で貼り付けたとき、クリップボードの文字がこれと同じなら、まとまりのまま入れる） */
  private clip: Clip | null = null
  /** 最後に紙面を押したものの種類（mouse・touch・pen。指で押したときは、選んだ文字があっても今までどおり書く欄を開く） */
  private pointerType = ''

  // ---- 選んだ文の道具（mockups/v36：案B 左の道具の「選んだ文」・案A 選んだ所のすぐ上の帯と、書く欄の近くの「貼り付け」） ----

  /** 紙面で選んだ文の帯・書く欄の近くの「貼り付け」（selectionBar.ts） */
  private readonly selectionBar: SelectionBar
  /** 紙面で、コピー・切り取り・削除できる範囲を選んでいる（スナップショットの textRange） */
  private textRange = false
  /** 紙面をマウスでなぞっている途中（帯は、離してから出す） */
  private mouseSelecting = false
  /** 帯を隠しておく（スクロールした・ページを替えた・表示の大きさを変えた・Esc。選び直すと、また出す） */
  private barSuppressed = false
  /** 書く欄の近くの「貼り付け」を、この書く欄では出さない（書き始めた）。出していた書く欄（別の欄を開いたら、また出す） */
  private chipDismissed = false
  private chipBlock: string | null = null
  /** 貼り付けに使ったまとまり（そのまとまりでは、書く欄の近くの「貼り付け」を、もう出さない。左の道具の「貼り付け」は出す） */
  private clipPasted: Clip | null = null
  private selectionUiFrame = 0

  /** 帯と「貼り付け」を出し直す（同じ描画の間に何度呼ばれても1回だけ） */
  private scheduleSelectionUi(): void {
    if (this.selectionUiFrame) return
    this.selectionUiFrame = requestAnimationFrame(() => {
      this.selectionUiFrame = 0
      this.updateSelectionUi()
    })
  }

  /** 帯を隠す（選び直すと、また出る） */
  private suppressSelectionBar(): void {
    this.barSuppressed = true
    this.selectionBar.hideBar()
  }

  /** 見えている紙面のあたり（帯・「貼り付け」を置いてよい範囲。見開きなら2ページ） */
  private visibleBounds(): Bounds | null {
    const view = this.renderer.pageView
    const pages = view.pages().filter((_, i) => this.isVisiblePage(i)).map((p) => p.getBoundingClientRect()).filter((r) => r.width > 0)
    if (pages.length === 0) return null
    const s = this.scroller.getBoundingClientRect()
    return { top: Math.max(s.top, Math.min(...pages.map((r) => r.top))), bottom: Math.min(s.bottom, Math.max(...pages.map((r) => r.bottom))), left: Math.min(...pages.map((r) => r.left)), right: Math.max(...pages.map((r) => r.right)) }
  }

  /**
   * 紙面で選んでいる範囲・書いている欄に合わせて、左の道具の「選んだ文」（textRange）と、選んだ所のすぐ上の帯、
   * 書く欄の近くの「貼り付け」を出す・隠す（スマホは出さない）
   */
  private updateSelectionUi(): void {
    const sheet = this.phone
    const found = !sheet && !this.overlay.blockId && this.hasPaperSelection() ? this.paperRange() : null
    if (found && this.selection) {
      // 紙面で文を選んだら、選んでいた図・表などは選ぶのをやめる（左の道具は「選んだ文」になる）
      this.selection = null
      this.markSelection()
    }
    if (!!found !== this.textRange) {
      this.textRange = !!found
      this.version += 1
      for (const listener of this.listeners) listener()
    }
    const bounds = this.visibleBounds()
    // 帯：選んだ所のすぐ上（なぞっている途中・隠しておくときは出さない）
    if (found && bounds && !this.mouseSelecting && !this.barSuppressed) {
      const sel = getSelection()!
      const lines = [...sel.getRangeAt(0).getClientRects()].filter((r) => r.width > 1 && r.height > 2 && r.bottom > bounds.top && r.top < bounds.bottom && r.right > bounds.left && r.left < bounds.right)
      this.selectionBar.showBar(lines, bounds)
    } else this.selectionBar.hideBar()
    // 書く欄の近くの「貼り付け」：紙面でコピーしたあと、段落の書く欄を開いたとき（書き始めた・使ったら出さない）
    const id = this.overlay.blockId
    if (id !== this.chipBlock) {
      this.chipBlock = id
      this.chipDismissed = false
    }
    const kind = id ? ops.findEditable(this.report, id)?.kind : undefined
    const caret = id && !sheet && this.clip && this.clip !== this.clipPasted && !this.chipDismissed && (kind === 'paragraph' || kind === 'abstractParagraph') ? this.overlay.caretClientRect() : null
    if (caret && bounds) this.selectionBar.showChip(caret, bounds)
    else this.selectionBar.hideChip()
  }

  /**
   * 道具・帯の「コピー」：紙面で選んだ範囲をコピーする（Ctrl+C と同じまとまりを覚え、ふつうの文字をクリップボードに入れる。
   * クリップボードに入れられなかったときも、まとまりは覚えておく（このツールの「貼り付け」で使える））
   */
  copySelection(): void {
    const found = this.paperRange()
    if (!found) return
    const clip = copyRange(found.report, found.range)
    this.clip = clip
    this.clipPasted = null
    navigator.clipboard?.writeText(clip.text).catch(() => {})
    this.notify()
  }

  /** 道具・書く欄の近くの「貼り付け」：紙面でコピーしたまとまりを、書いている段落のカーソルの所に入れる（Ctrl+V と同じ） */
  pasteFromTool(): void {
    if (!this.clip || !this.overlay.blockId) return
    this.overlay.pasteClip()
  }

  /** 紙面で選んでいる文字を、選ばないようにする（ページを替えたとき） */
  private clearPaperSelection(): void {
    if (this.hasPaperSelection()) getSelection()?.removeAllRanges()
  }

  /** 紙面で文字を選んでいるか（選んだ所が紙面の中にある。書く欄の中の選択は数えない。スマホは数えない） */
  hasPaperSelection(): boolean {
    if (this.phone) return false
    const sel = getSelection()
    return !!sel && sel.rangeCount > 0 && !sel.isCollapsed && this.viewport.contains(sel.anchorNode) && this.viewport.contains(sel.focusNode)
  }

  /**
   * 紙面で選んでいる範囲（原稿の範囲と、その範囲を求めた原稿＝表に出ている紙面の原稿・選んだ点）。
   * 選んでいない・本文と抄録をまたぐ・表紙や目次など本文と抄録の外にかかる・何も文字がかからないときは null
   */
  private paperRange(): { range: ModelRange; report: Report; points: [ModelPoint, ModelPoint] } | null {
    if (!this.hasPaperSelection()) return null
    const r = getSelection()!.getRangeAt(0)
    const report = this.shownReport ?? this.report
    const a = paperPoint(this.viewport, r.startContainer, r.startOffset, 'start')
    const b = paperPoint(this.viewport, r.endContainer, r.endOffset, 'end')
    if (!a || !b) return null
    const range = resolveRange(report, a, b)
    return range && rangePieces(report, range).length > 0 ? { range, report, points: [a, b] } : null
  }

  /**
   * コピー（Ctrl+C・⌘+C。切り取りのときも）：紙面で選んだ範囲を、ふつうの文字としてクリップボードに入れ、まとまり（段落・図表など）を覚える。
   * 範囲にできないとき（表紙・目次にかかるなど）は、ブラウザのふつうのコピーのまま（覚えていたまとまりは忘れる）
   */
  private onCopy(e: ClipboardEvent): void {
    if (e.defaultPrevented || this.phone) return
    if (e.target instanceof Node && this.overlay.element.contains(e.target)) return
    const found = this.paperRange()
    if (!found) {
      if (this.hasPaperSelection()) this.clip = null
      return
    }
    const clip = copyRange(found.report, found.range)
    if (!clip.text && clip.blocks.length === 0) return
    e.clipboardData?.setData('text/plain', clip.text)
    e.preventDefault()
    this.clip = clip
    this.clipPasted = null
    this.notify()
  }

  /**
   * 書く欄を開かずに貼り付けた（Ctrl+V・⌘+V）：抄録のページなら、何も入らない理由を知らせる
   * （まだ書き始めていない：「先生の許可が出た」を押してから。書き始めている：段落を押して、書く欄を開いてから）
   */
  private onPaperPaste(e: ClipboardEvent): void {
    if (e.defaultPrevented || this.overlay.blockId || !this.layout) return
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return
    const first = this.stage.spread ? this.page - (this.page % 2) : this.page
    const shown = this.stage.spread ? [first, first + 1] : [first]
    if (!shown.some((i) => this.layout?.kinds[i] === 'abstract')) return
    this.showNotice(this.report.abstract.started === false ? '抄録は「先生の許可が出た」を押してから書きます' : '抄録の段落を押して、書く欄を開いてから貼り付けます')
  }

  /**
   * 紙面で選んだ範囲を、いまの原稿の範囲にする（紙面を組み直す前に書き換えていたら、選んだ欄の文字が紙面と同じときだけ）。
   * 組み直すのを待っているときは、知らせて null
   */
  private currentRange(found: { range: ModelRange; report: Report; points: [ModelPoint, ModelPoint] }): ModelRange | null {
    if (found.report === this.report) return found.range
    const same = found.points.every((p) => ops.findEditable(found.report, p.id)?.text === ops.findEditable(this.report, p.id)?.text)
    const range = same ? resolveRange(this.report, found.points[0], found.points[1]) : null
    if (!range) this.noticeInfo('紙面を組み直しています。少し待ってから、もう一度選んでください')
    return range
  }

  /** 切り取り（Ctrl+X・⌘+X）：紙面で選んだ範囲をコピーしてから消す（1回で元に戻せる）。範囲がなければ false（ほかに任せる） */
  cutSelection(): boolean {
    const found = this.paperRange()
    if (!found || this.overlay.blockId) return false
    if (this.removed.size > 0) return true
    const range = this.currentRange(found)
    if (!range) return true
    // ブラウザのコピーを通して、クリップボードに入れる（onCopy）
    document.execCommand('copy')
    this.removeRange(range, '切り取り')
    return true
  }

  /** 削除（Delete・Backspace）：紙面で選んだ範囲を消す（1回で元に戻せる）。範囲がなければ false（ほかに任せる） */
  deleteSelection(): boolean {
    const found = this.paperRange()
    if (!found || this.overlay.blockId) return false
    if (this.removed.size > 0) return true
    const range = this.currentRange(found)
    if (range) this.removeRange(range, '選んだ文')
    return true
  }

  /** 範囲を消す。画面の下に「選んだ文を削除しました［戻す］」（切り取りは「切り取りました［戻す］」）を出す */
  private removeRange(range: ModelRange, what: '選んだ文' | '切り取り'): void {
    const result = deleteRange(this.report, range)
    getSelection()?.removeAllRanges()
    this.selection = null
    this.currentId = null
    const note = result.keptChapters ? '（大見出しは残しました）' : undefined
    this.removeNow(() => result.report, what, note)
    // 段落の中の文字だけを消したとき（消えたブロックがない）も知らせる
    if (this.notice?.notice.kind !== 'removed' || this.notice.report !== this.report) this.noticeRemoved(what, note)
  }

  /**
   * 書いている段落 id に、紙面で選んでコピーしたまとまりを貼り付ける（書いている文字 text の start〜end を置き換える）。
   * 元に戻すと、まず貼り付けたことだけを戻す（その前に書いた文字は残る。もう一度戻すと、書いた文字も戻る：段落を分けたときと同じ）
   */
  private pasteClipAt(id: string, text: string, start: number, end: number): void {
    const clip = this.clip
    if (!clip) return
    const typed = ops.setText(this.report, id, text.slice(0, start) + text.slice(end))
    const before = this.reportBeforeEdit ?? this.report
    if (ops.findEditable(before, id)?.text !== ops.findEditable(typed, id)?.text) this.pushHistory(before)
    this.pushHistory(typed)
    // 入れる位置（確定した文字は、先頭の空白などを除くので、後ろの文字の数から数える）
    const typedText = ops.findEditable(typed, id)?.text ?? ''
    const offset = Math.max(0, typedText.length - text.slice(end).length)
    const result = pasteClip(typed, id, offset, clip)
    this.report = result.report
    // このまとまりでは、書く欄の近くの「貼り付け」を、もう出さない
    this.clipPasted = clip
    this.autoPeriod = null
    // 抄録：見出し・図・表と、図表の参照の括弧は入れない。文の中の参照（「図1に示すように」）は、書き直してもらう（abstractRefs.ts）
    const abstractNote = typed.abstract.paragraphs.some((p) => p.id === id) ? abstractPasteNotice(result.droppedForAbstract || result.skippedChapters, result.removedRefs, result.keptRefs) : null
    if (abstractNote) this.showNotice(abstractNote)
    else if (result.skippedChapters) this.showNotice('大見出し（Ⅰ．など）は貼り付けていません（大見出しは「大見出し」で足します）')
    if (result.caret) {
      this.reopenAfterRender(result.caret.id, result.caret.offset, { id, place: 'after' })
      return
    }
    // 図・表で終わり、続けて書く段落がない：書く欄を閉じる
    this.hideStyle.textContent = ''
    this.reportBeforeEdit = null
    this.afterChange({ render: 'now', save: true })
  }

  /**
   * 書いている欄で Shift+↓（↑）を押した（段落の最後（最初）の行で）：書いた文字が紙面と同じなら、書く欄を閉じて、紙面で選ぶ。
   * 書く欄で選び始めた所から、次（前）の欄の1行まで（そのあとは、紙面で Shift+↑↓ で広げられる）。
   * 書き換えていたとき（紙面の文字と違う）は広げない（false。今までどおり次の欄へ移る）
   */
  private extendFromEditor(id: string, text: string, anchor: number, direction: 'prev' | 'next'): boolean {
    const shown = this.shownReport ? ops.findEditable(this.shownReport, id)?.text : undefined
    const a = domPoint(this.viewport, id, anchor)
    const b = domPoint(this.viewport, id, direction === 'next' ? text.length : 0)
    if (shown !== text || this.phone || !a || !b) return false
    this.commitAsParagraph()
    const sel = getSelection()
    if (!sel) return true
    sel.setBaseAndExtent(a.node, a.offset, b.node, b.offset)
    sel.modify('extend', direction === 'next' ? 'forward' : 'backward', 'line')
    return true
  }

  /**
   * 書いている欄があるときに、紙面を Shift+クリックした：書いている欄のカーソルの所から、押した所までを紙面で選ぶ
   * （書いた文字が紙面と同じときだけ。書き換えていたときは、今までどおり押した所を書き始める）
   */
  private onPaperMouseDown(e: MouseEvent): void {
    if (!e.shiftKey || e.button !== 0 || this.phone) return
    const id = this.overlay.blockId
    if (!id || !(e.target instanceof Node) || this.overlay.element.contains(e.target)) return
    const shown = this.shownReport ? ops.findEditable(this.shownReport, id)?.text : undefined
    if (shown !== this.overlay.text) return
    const anchor = domPoint(this.viewport, id, this.overlay.caret)
    let focus = caretAt(this.viewport, e.clientX, e.clientY)
    if (!anchor || !focus) return
    e.preventDefault()
    this.commitAsParagraph()
    // 句読点の上を押したら、句読点も選ぶ（後ろへ広げるとき）
    if (caretBefore(anchor, focus)) focus = includeClosing(focus, e.clientX, e.clientY)
    getSelection()?.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset)
  }

  /**
   * 紙面をマウスでなぞって選ぶ・Shift+クリックで広げる：選ぶ範囲の境目を、このツールで決め直す（PC）。
   * ブラウザに任せると、句読点（組版エンジンが包んだ「。」など）のまわりで、次のようになっていた（依頼者の指摘。2026-10-20）：
   * - 「。」の点の上で離すと、字の真ん中より左なので「。」の前で終わる（文と一緒に選べたり選べなかったりした）
   * - 段落の終わりの「。」から前へなぞると、「。」しか選べない・何も選べない
   * - 行末にぶら下げた「。」は、どこで離しても選べない
   * 押した所・いまの所の文字の境目（caretAt）から選び、句読点の上なら字ごと入れる（includeClosing）。
   * 2回・3回続けて押した（語・行を選ぶ）ときと、紙面の文字の外は、ブラウザのまま
   */
  private mouseSelect: { x: number; y: number; anchor: Caret; moved: boolean; extend: boolean } | null = null
  private mouseSelectFrame = 0

  private startMouseSelect(e: MouseEvent): void {
    this.mouseSelect = null
    if (e.detail > 1 || !(e.target instanceof Element) || this.overlay.element.contains(e.target)) return
    // 写真・ボタンなど（なぞっても文を選ばない所）は、ブラウザに任せる（紙面の欄は、キーボードで押せるよう role="button" なので、role では見ない）
    if (e.target.closest('[data-photo-slot], .range-bar, .range-chip, button, a[href], input, select, textarea') || getComputedStyle(e.target).userSelect === 'none') return
    const sel = getSelection()
    // Shift+クリック：前に選んでいた所から広げる（書く欄を開いていたときは onPaperMouseDown）
    if (e.shiftKey) {
      if (!this.overlay.blockId && sel?.anchorNode && this.hasPaperSelection()) this.mouseSelect = { x: e.clientX, y: e.clientY, anchor: { node: sel.anchorNode, offset: sel.anchorOffset }, moved: true, extend: true }
      return
    }
    const anchor = caretAt(this.viewport, e.clientX, e.clientY)
    if (anchor) this.mouseSelect = { x: e.clientX, y: e.clientY, anchor, moved: false, extend: false }
  }

  private moveMouseSelect(e: MouseEvent): void {
    const m = this.mouseSelect
    if (!m || !(e.buttons & 1)) return
    if (!m.moved && Math.hypot(e.clientX - m.x, e.clientY - m.y) < 4) return
    m.moved = true
    const { clientX: x, clientY: y } = e
    // ブラウザが選ぶ範囲を変えたあと（同じ描画の前）に、決め直す
    cancelAnimationFrame(this.mouseSelectFrame)
    this.mouseSelectFrame = requestAnimationFrame(() => this.applyMouseSelect(x, y))
  }

  private endMouseSelect(e: MouseEvent): void {
    const m = this.mouseSelect
    if (!m) return
    if (!m.moved) {
      this.mouseSelect = null
      return
    }
    const { clientX: x, clientY: y } = e
    cancelAnimationFrame(this.mouseSelectFrame)
    // マウスを離したあとのブラウザの処理のあとで、決め直す（このあとのクリックでは、選んだ所があるので書く欄を開かない）
    this.applyMouseSelect(x, y)
    this.mouseSelectFrame = requestAnimationFrame(() => {
      this.applyMouseSelect(x, y)
      this.mouseSelect = null
    })
  }

  /** なぞり始めた所から (x, y) までを選ぶ（句読点の上なら字ごと） */
  private applyMouseSelect(x: number, y: number): void {
    const m = this.mouseSelect
    if (!m || !m.anchor.node.isConnected) return
    let focus = caretAt(this.viewport, x, y)
    if (!focus) return
    let anchor = m.anchor
    if (caretBefore(anchor, focus)) focus = includeClosing(focus, x, y)
    else if (!m.extend) anchor = includeClosing(anchor, m.x, m.y)
    const sel = getSelection()
    if (!sel) return
    if (sel.anchorNode === anchor.node && sel.anchorOffset === anchor.offset && sel.focusNode === focus.node && sel.focusOffset === focus.offset) return
    sel.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset)
  }

  // ---- 作品写真（何ページかにできる。ページごとに並べ方を選ぶ。page は何ページ目の作品写真か（0 から）。mockups/v38 案A） ----

  /** 作品写真のページ数の上限（学科の設定 workPhotos.maxPages。null は上限なし） */
  get maxPhotoPages(): number | null {
    return this.config.workPhotos?.maxPages ?? null
  }

  /** 作品写真のページを、まだ足せるか（ページ数の上限に達していない） */
  canAddPhotoPage(): boolean {
    return canAddPhotoPage(this.report.workPhotos, this.maxPhotoPages)
  }

  /** page ページ目の並べ方を変える（写真は消さずに先頭へ詰める。枚数を減らすと、1枚目から順に載る） */
  setPhotoLayout(page: number, layout: WorkPhotoLayout, columns: number): void {
    // 写真の順番が変わることがあるので、選んでいた写真は選び直してもらう
    if (this.selection?.kind === 'photos') this.selection = { kind: 'photos', page }
    this.update((r) => ({ ...r, workPhotos: updatePhotoPage(r.workPhotos, page, (p) => changeArrangement(p, layout, columns)) }))
    // 写真の数より枠の少ない並べ方にした：後ろの写真は消さずに残しているが、ページには出ないことを知らせる
    const filled = this.report.workPhotos[page]?.imageIds.filter(Boolean).length ?? 0
    if (filled > layout) this.noticeInfo(`${layout + 1}枚目からは隠れています（並べ方を戻すと出ます）`)
  }

  /**
   * after ページ目の後ろに、そのページと同じ並べ方の空のページを足して、足したページを見せる（左の道具の「＋ 写真のページを足す」）。
   * ページ数の上限（学科の設定）に達していれば、足さずに知らせる（道具のボタンも押せない）
   */
  async addPhotoPage(after: number): Promise<void> {
    if (!this.canAddPhotoPage()) return this.noticeInfo(`作品写真は${this.maxPhotoPages}ページまでです`)
    this.selection = null
    this.update((r) => ({ ...r, workPhotos: addPhotoPage(r.workPhotos, after) }))
    await this.goToPhotoPage(after + 1)
  }

  /**
   * page ページ目を、中の写真ごと消す（左の道具の「このページを消す」。元に戻せる。画面の下に「作品写真のページを消しました［戻す］」）。
   * 1ページだけのときは消さない（作品写真のページは、いつも1ページはある）。消したら、前のページ（1ページ目を消したら、新しい1ページ目）を見せる
   */
  async removePhotoPage(page: number): Promise<void> {
    const pages = this.report.workPhotos
    if (pages.length <= 1 || !pages[page]) return
    const photos = pagePhotoCount(pages[page])
    this.selection = null
    this.update((r) => ({ ...r, workPhotos: removePhotoPage(r.workPhotos, page) }))
    this.noticeRemoved('作品写真のページ', photos ? `（写真${photos}枚も）` : undefined)
    await this.goToPhotoPage(Math.max(0, page - 1))
  }

  /** k ページ目（0 から）の作品写真を見せる（ページを足した・消したときは、組み直し終えてから） */
  private async goToPhotoPage(k: number): Promise<void> {
    await this.whenLaidOut()
    const index = pageOfPhotoPage(this.layout?.kinds ?? [], k)
    if (index >= 0 && index !== this.page) await this.goToPage(index, 'fade')
  }

  async setPhoto(page: number, index: number): Promise<void> {
    const imageId = await this.importImage('photo')
    if (!imageId) return
    this.update((r) => ({ ...r, workPhotos: updatePhotoPage(r.workPhotos, page, (p) => putPhoto(p, index, imageId)) }))
  }

  /**
   * 空いている枠を押した：写真を選ぶ（何枚かまとめて選べる）。押した枠から後ろ、そのあと前の、そのページの空いている枠 →
   * 後ろのページの空いている枠に順に入れ、それでも足りなければ、最後のページと同じ並べ方のページを後ろに足して、選んだ写真を全部入れる
   * （mockups/v38：依頼者の判断。足したときは画面の下で知らせる）。
   * 学科の設定でページ数の上限があって入りきらなかったときだけ、入れなかった枚数とわけを知らせる（上限がなければ、いつも全部入る）
   */
  async addPhotos(page: number, index: number): Promise<void> {
    if (this.template) return
    const files = this.callbacks.pickImages ? await this.callbacks.pickImages('photo') : await this.callbacks.pickImage('photo').then((f) => (f ? [f] : []))
    if (files.length === 0) return
    const max = this.maxPhotoPages
    const before = this.report.workPhotos.length
    const slots = photoSlots(this.report.workPhotos, page, index, files.length, max)
    const stored: (PhotoSlot & { imageId: string })[] = []
    let tried = 0
    // 縮めて保存する間は、画面に「写真を取り込んでいます…（2 / 5枚）」を出す
    const total = Math.min(files.length, slots.length)
    try {
      for (const file of files) {
        if (stored.length >= slots.length) break
        this.callbacks.onImageWork?.({ done: tried, total })
        tried++
        const imageId = await this.storeImage(file, 'photo')
        if (imageId) stored.push({ ...slots[stored.length], imageId })
      }
    } finally {
      this.callbacks.onImageWork?.(null)
    }
    if (stored.length > 0) this.update((r) => ({ ...r, workPhotos: placePhotos(r.workPhotos, stored) }))
    const added = this.report.workPhotos.length - before
    const left = files.length - tried
    const notes = [
      added > 0 ? `作品写真のページを${added}つ足して、${stored.filter((s) => s.page >= before).length}枚入れました` : '',
      left > 0 && max !== null ? `${left}枚は入れていません（作品写真は${max}ページまでです）` : '',
    ].filter(Boolean)
    if (notes.length) this.noticeInfo(notes.join('。'))
  }

  /** page ページ目の index 枚目の写真を外して、枠を空にする（元に戻せる。画面の下に「作品写真を外しました［戻す］」を出す） */
  removePhoto(page: number, index: number): void {
    if (this.selection?.kind === 'photos') this.selection = { kind: 'photos', page }
    const had = !!this.report.workPhotos[page]?.imageIds[index]
    this.update((r) => ({ ...r, workPhotos: updatePhotoPage(r.workPhotos, page, (p) => putPhoto(p, index, '')) }))
    if (had) this.noticeRemoved('作品写真')
  }

  /** 写真の切り抜く位置を変える（x・y は %。50 が中央） */
  setPhotoPosition(page: number, index: number, position: PhotoPosition): void {
    this.update((r) => ({ ...r, workPhotos: updatePhotoPage(r.workPhotos, page, (p) => movePhoto(p, index, position)) }))
  }

  /**
   * page ページ目の index 枚目の写真を「全体を入れる（切らない）」にする・枠いっぱいに切り抜くのに戻す（元に戻せる。mockups/v32 ③ 案A）。
   * 選んでいる写真は、選んだまま（道具のスイッチを続けて押せるように）
   */
  setPhotoWhole(page: number, index: number, on: boolean): void {
    this.update((r) => ({ ...r, workPhotos: updatePhotoPage(r.workPhotos, page, (p) => wholePhoto(p, index, on)) }))
  }

  // 作品写真をつかんで動かし、枠の中で見える位置を変える（つかまずに離したらクリック＝写真を選び直す）
  private photoDrag: PhotoDrag | null = null
  private suppressClick = false

  private onPhotoPointerDown(e: PointerEvent): void {
    const img = (e.target as HTMLElement).closest?.<HTMLImageElement>('[data-photo-slot] img')
    if (!img || e.button !== 0 || !img.naturalWidth) return
    const slot = img.closest<HTMLElement>('[data-photo-slot]')!
    const page = photoPageOf(slot)
    const index = Number(slot.dataset.photoSlot)
    const photos = this.report.workPhotos[page]
    // 全体を入れている写真は切り抜いていないので、動かさない（押すと、ふつうのクリック＝写真を選ぶ）
    if (!photos || photos.whole?.[index] || slot.classList.contains('whole')) return
    // スマホ：押して選んだ写真だけを、指で動かせる（選んでいない写真の上で左右にはらうとページを送り、拡大中は紙面を動かす。
    // 前は、ページを送ろうとして写真の見える所を動かしてしまうことが多かった。依頼者の判断：案A）。PC は今までどおり、選ばずに動かせる
    if (this.phone && !(this.selection?.kind === 'photos' && this.selection.page === page && this.selection.index === index)) return
    // 2本の指を置いた（紙面を広げる）ときは動かさない
    if (this.pinchZoom.active) return
    const cell = slot.getBoundingClientRect()
    const k = Math.max(cell.width / img.naturalWidth, cell.height / img.naturalHeight)
    this.photoDrag = {
      page,
      index,
      img,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      from: photos.positions?.[index] ?? { x: 50, y: 50 },
      spanX: img.naturalWidth * k - cell.width,
      spanY: img.naturalHeight * k - cell.height,
      moved: false,
    }
  }

  private onPhotoPointerMove(e: PointerEvent): void {
    const d = this.photoDrag
    if (!d || e.pointerId !== d.pointerId) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    if (!d.moved) {
      d.moved = true
      d.img.classList.add('dragging')
      // 表の紙面の写真の見え方を、組版エンジンを通さずに変える。この紙面は、あとで使い回さない
      this.renderer.frontTouched()
    }
    e.preventDefault()
    const p = this.photoDragPosition(d, dx, dy)
    d.img.style.objectPosition = `${p.x}% ${p.y}%`
  }

  private onPhotoPointerUp(e: PointerEvent): void {
    const d = this.photoDrag
    if (!d || e.pointerId !== d.pointerId) return
    this.photoDrag = null
    if (!d.moved) return
    d.img.classList.remove('dragging')
    // 離した後に届くクリックを無視する（届かなかったときのため、すぐ後に戻す）
    this.suppressClick = true
    setTimeout(() => (this.suppressClick = false), 0)
    this.setPhotoPosition(d.page, d.index, this.photoDragPosition(d, e.clientX - d.startX, e.clientY - d.startY))
  }

  private cancelPhotoDrag(): void {
    const d = this.photoDrag
    this.photoDrag = null
    if (d?.moved) {
      d.img.classList.remove('dragging')
      d.img.style.objectPosition = `${d.from.x}% ${d.from.y}%`
    }
  }

  /** 指（マウス）を右へ動かすと写真も右へ動き、左側が見えてくる（位置の % は小さくなる） */
  private photoDragPosition(d: PhotoDrag, dx: number, dy: number): PhotoPosition {
    return {
      x: d.spanX > 0.5 ? clampPercent(d.from.x - (dx / d.spanX) * 100) : d.from.x,
      y: d.spanY > 0.5 ? clampPercent(d.from.y - (dy / d.spanY) * 100) : d.from.y,
    }
  }

  // ---- 印刷（PDF に保存） ----

  private beforePrint(): void {
    if (this.overlay.blockId) this.overlay.commit()
    for (const h of Object.values(this.highlights)) h.clear()
    for (const el of this.viewport.querySelectorAll('.is-selected')) el.classList.remove('is-selected')
    // 「PDFを書き出す」の窓を通らずに、ブラウザの印刷（Ctrl+P など）で出したとき：窓から出すときと同じにする
    // （ファイル名のもとになるページの題を合わせ、作品写真がまだなければ空の作品写真のページを入れない。pdf/exportPages.ts）
    if (document.title === this.pdfTitle) return
    const title = document.title
    document.title = this.pdfTitle
    const skipped = skippedPages(this.pageElements(), this.report, this.layout).filter((p) => !p.classList.contains('print-skip'))
    for (const p of skipped) p.classList.add('print-skip')
    window.addEventListener(
      'afterprint',
      () => {
        document.title = title
        for (const p of skipped) p.classList.remove('print-skip')
      },
      { once: true },
    )
  }

  /** PDF のファイル名のもと（提出ガイドの決まり。例：00ZZ0123_文化花子）。学籍番号・氏名がまだ空なら、その部分は付けない（model/fileName.ts） */
  get pdfTitle(): string {
    const { studentId, name } = this.report.basicInfo
    return submissionTitle(studentId, name, this.config.reportName)
  }
}
