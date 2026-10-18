import { findCourse, subtitleInputOnly, type YearConfig } from '../config'
import { checkReportDetailed, type ReportFinding } from '../checker/reportChecks'
import { applyFix } from '../checker/textRules'
import { FIELD_IDS } from '../layout/document'
import type { LayoutInfo } from '../layout/measure'
import { FIGURE_MAX_PX, fitFigureSize, importImage, PHOTO_MAX_PX } from '../model/images'
import { putImage, type StoredImage } from '../model/storage'
import { applyCourseTemplate, bodyWritten } from '../model/template'
import { changeArrangement, clampPercent, movePhoto, putPhoto, wholePhoto } from '../model/photos'
import { addColumn, addRow, blankTable, cellPosition, materialTable, removeColumn, removeRow, setCellImage } from '../model/table'
import type { BodyBlock, Chapter, PhotoPosition, Report, TableBlock, WorkPhotoLayout } from '../model/types'
import { ContinueRow, endsPageWithRoom, type ContinueTarget } from './continueRow'
import { OverlayEditor, type OverlayKind, type OverlayPlacement, type OverlayTarget } from './overlayEditor'
import { PageStage, TEXT_LEFT, TEXT_W } from './pageStage'
import { blockPaperKey, fixedTitleNote, markFocusable, PAPER_FOCUSABLE, paperElement, paperKeyOf, paperOrder, rememberTabStop, setTabStop } from './paperFocus'
import * as ops from './reportOps'
import { ReportRenderer, type PageEffect } from './reportRenderer'
import { changedPlace, type ChangedPlace, type NoticeBody, type RemovedWhat, type UndoNotice } from './undoNotice'

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

export type Selection =
  | { kind: 'figure'; id: string }
  | { kind: 'table'; id: string }
  /** 作品写真のページ。index：入っている写真を押して選んだとき、その写真（0 から。道具に「この写真：差し替え／外す」が出る） */
  | { kind: 'photos'; index?: number }
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
  /** 表示しているページ（0 から）とページ数 */
  page: number
  pageCount: number
  /** 拡大して表示しているか */
  zoomed: boolean
  /** ページを送っている途中か */
  turning: boolean
  /** スマホ：下の欄で書いているか */
  sheet: boolean
  /** 書いている欄のカーソルの位置（書いていなければ null） */
  caret: number | null
  /** 画面の下に出す、削除・戻したあとの知らせ（ほかを変えたら・書き始めたら null。mockups/v32 ② 案A） */
  notice: UndoNotice | null
  version: number
}

export interface EditorCallbacks {
  /** 報告書が変わった（自動保存する） */
  onChange(report: Report): void
  /** 紙面のコース欄をクリックした */
  onCourseClick(rect: DOMRect): void
  /** 紙面の引用・参考文献をクリックした */
  onReferencesClick(): void
  /** 写真を選ぶ画面を開いてほしい */
  pickImage(purpose: 'figure' | 'swatch' | 'photo'): Promise<File | null>
}

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

/** 後ろの文章をずらしていた要素を元に戻す（shiftFollowing） */
function resetShift(elements: HTMLElement[]): void {
  for (const t of elements) {
    t.style.translate = ''
    t.style.visibility = ''
    t.style.clipPath = ''
  }
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
  private readonly renderer: ReportRenderer
  private readonly overlay: OverlayEditor
  private readonly stage: PageStage
  private readonly scroller: HTMLElement
  private readonly layer: HTMLElement
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
  private history: Report[] = []
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
  private continuing: { id: string; anchor: string | null } | null = null
  /** 図・表のすぐ下の「＋ ここに続きを書く」（mockups/v32 ① 案A） */
  private readonly continueRow: ContinueRow
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
  constructor(stage: HTMLElement, scroller: HTMLElement, layer: HTMLElement, config: YearConfig, report: Report, callbacks: EditorCallbacks) {
    this.config = config
    this.report = report
    this.callbacks = callbacks
    this.scroller = scroller
    this.layer = layer
    this.renderer = new ReportRenderer(scroller)
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
    // 拡大してスクロールしたら、「＋ ここに続きを書く」も紙面に合わせて動かす
    scroller.addEventListener('scroll', () => {
      this.placeContinueRow()
      // 書き終えた欄の仮の表示は、紙面と一緒には動かないので外す
      this.clearFrozen(Infinity)
    })

    this.overlay = new OverlayEditor(layer, scroller, {
      onInput: (id, text) => {
        this.report = ops.setText(this.report, id, text)
        this.afterChange({ render: 'debounce', save: true })
      },
      onCommit: (id, text, byKey, frozen) => this.onCommitEdit(id, text, byKey, frozen),
      onSplit: (id, before, after) => {
        // 図・表のタイトル：Enter で、図・表の後ろに新しい段落を作る（mockups/v32 ① 案A）
        const editing = ops.findEditable(this.report, id)?.kind
        if (editing === 'figureCaption' || editing === 'tableCaption') return this.enterAfterCaption(id, before + after)
        // 見出し：すぐ後ろに何も書いていない段落（「大見出し」を足すと付いてくる段落など）があれば、新しく作らずにそこへ移る
        const blank = editing === 'chapter' || editing === 'subheading' ? ops.blankParagraphAfterHeading(this.report, id) : null
        if (blank) return this.enterBelowHeading(id, before + after, blank)
        this.pushHistory(this.reportBeforeEdit ?? this.report)
        const result = ops.split(ops.setText(this.report, id, before + after), id, before, after)
        this.report = result.report
        // 前の段落に「。」を自動で付けたときは覚えておく（すぐ Backspace でつなぎ直したら、元に戻す）
        const kind = ops.findEditable(this.report, id)?.kind
        this.autoPeriod = (kind === 'paragraph' || kind === 'abstractParagraph') && ops.withPeriod(before) !== before ? { prevId: id, newId: result.newId, original: before } : null
        this.continueWriting(result.newId, 0, { ghostOf: id })
      },
      onMergeBackward: (id, text) => {
        // Enter の直後に Backspace でつなぎ直した：自動で付けた「。」を取り消して、元の文に戻す
        const auto = this.autoPeriod?.newId === id ? this.autoPeriod : null
        this.autoPeriod = null
        const base = auto ? ops.setText(this.report, auto.prevId, auto.original) : this.report
        const result = ops.mergeBackward(ops.setText(base, id, text), id, text)
        if (!result) {
          this.openEditor(id, 0)
          return
        }
        this.pushHistory(this.reportBeforeEdit ?? this.report)
        this.report = result.report
        this.continueWriting(result.targetId, result.caret, { alsoHide: id })
      },
      onNavigate: (id, text, direction) => {
        this.report = ops.setText(this.report, id, text)
        const next = ops.neighbor(this.report, id, direction)
        this.continueWriting(next?.id ?? id, direction === 'prev' ? (next?.text.length ?? 0) : 0)
      },
      onTab: (id, text, backward) => {
        // 表のセル：Tab で隣のセルへ（最後のセルでは書き終わる）
        this.report = ops.setText(this.report, id, text)
        const table = this.report.body.flatMap((c) => c.blocks).find((b) => b.type === 'table' && b.rows.some((r) => r.cells.some((c) => c.id === id)))
        const cells = table?.type === 'table' ? table.rows.flatMap((r) => r.cells) : []
        const next = cells[cells.findIndex((c) => c.id === id) + (backward ? -1 : 1)]
        if (next) this.continueWriting(next.id, next.text.length)
        else this.onCommitEdit(id, text, true)
      },
      onPasteParagraphs: (id, paragraphs, caretInLast) => {
        this.pushHistory(this.reportBeforeEdit ?? this.report)
        const result = ops.replaceWithParagraphs(this.report, id, paragraphs)
        this.report = result.report
        this.reopenAfterRender(result.lastId, caretInLast, { id, place: 'after' })
      },
      onResize: () => this.shiftFollowing(),
    })

    // 画面の大きさが変わって紙面の倍率・位置が変わったら、入力欄も合わせる
    this.stage = new PageStage(stage, () => {
      this.marker.hidden = true
      this.clearFrozen(Infinity)
      const id = this.overlay.blockId
      const placement = id ? this.overlayPlacement(id) : null
      if (placement) this.overlay.moveTo(placement)
      this.shiftFollowing()
      this.notify()
    })

    // カーソルが動いたら知らせる（右の一覧で、カーソルのある箇所の指摘を示すため）
    document.addEventListener('selectionchange', () => {
      if (!this.overlay.blockId || this.overlay.composing) return
      const caret = this.overlay.caret
      if (caret !== this.caretPos) {
        this.caretPos = caret
        this.notify()
      }
    })
    scroller.addEventListener('click', (e) => this.onClick(e))
    scroller.addEventListener('keydown', (e) => this.onPaperKey(e))
    // Tab で紙面に入ったときに止まる欄：最後にいた欄（はじめは、ページのいちばん上の欄）
    scroller.addEventListener('focusin', (e) => rememberTabStop(e.target))
    document.addEventListener('keydown', (e) => this.prepareTabStop(e), true)
    scroller.addEventListener('pointerdown', (e) => this.onPhotoPointerDown(e))
    // スマホ：指で押した点を覚える（押した欄を、ブラウザが寄せる前の点で決めるため。rawTouch）
    scroller.addEventListener('pointerdown', (e) => {
      this.touchPoint = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY, time: performance.now() } : null
    })
    scroller.addEventListener('dragstart', (e) => {
      if ((e.target as HTMLElement).closest?.('[data-photo-slot]')) e.preventDefault()
    })
    window.addEventListener('pointermove', (e) => this.onPhotoPointerMove(e))
    window.addEventListener('pointerup', (e) => this.onPhotoPointerUp(e))
    window.addEventListener('pointercancel', () => this.cancelPhotoDrag())
    window.addEventListener('beforeprint', () => this.beforePrint())
    window.addEventListener('afterprint', () => this.refreshHighlights())
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
      canUndo: this.history.length > 0,
      page: this.page,
      pageCount: this.layout?.kinds.length ?? 0,
      zoomed: this.stage.zoomed,
      turning: this.turning !== null,
      sheet: this.overlay.inSheet,
      caret: this.overlay.blockId ? this.caretPos : null,
      notice: this.currentNotice,
      version: this.version,
    }
    return this.snapshotCache
  }

  private notify(): void {
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
    const file = await this.callbacks.pickImage(purpose)
    if (!file) return null
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
      )
      done = true
      if (result.stale || (this.renderUrgent && !result.unchanged)) {
        skipped = true
      } else {
        // ページを送っている途中なら、送り終わってから入れ替える
        if (this.turning) await this.turning
        this.renderMs = result.ms
        this.layout = result.layout
        this.page = Math.max(0, Math.min(this.page, result.layout.kinds.length - 1))
        // 表に出ている紙面がすでにこの原稿の紙面なら（unchanged）、入れ替えない
        const swap = !result.unchanged
        // 紙面の欄にフォーカスがあれば、組み直した紙面の同じ欄に移し直す（要素が作り直されて、フォーカスが失われないように）
        const focused = swap ? this.paperFocus() : null
        if (swap) this.renderer.swap(this.page)
        this.shownReport = rendered
        // 削除したものが出てこない紙面になったら、隠すのをやめる（組み始めたあとに削除したものは、まだ隠しておく。元に戻したものは隠さない）
        const shown = bodyIds(rendered)
        const now = bodyIds(this.report)
        for (const id of this.removed) if (!shown.has(id) || now.has(id)) this.removed.delete(id)
        this.hideRemoved()
        if (swap) {
          markFocusable(this.viewport)
          if (focused) this.focusPaper(focused.key, focused.visible)
          this.markPrintSkip()
        }
        // 書き終えた欄の仮の表示を外す（その変更を含む紙面が出た）
        this.clearFrozen(seq)
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
    const checked = checkReportDetailed(this.report, this.config, this.layout)
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

  /** 指摘の箇所があるページ（0 から）。わからなければ -1 */
  pageOfFinding(finding: ReportFinding): number {
    if (finding.blockId) {
      const page = this.renderer.pageView.pageOfOffset(finding.blockId, finding.start ?? 0)
      if (page >= 0) return page
    }
    return this.layout?.kinds.indexOf(finding.area) ?? -1
  }

  /** 指摘の箇所へ移動する（文字の指摘なら入力欄を開く） */
  async goToFinding(finding: ReportFinding): Promise<void> {
    const page = this.pageOfFinding(finding)
    if (page < 0) return
    await this.goToPage(page, 'fade')
    const id = finding.blockId
    if (!id) return
    const fragment = this.renderer.pageView.fragments(id).find((f) => this.renderer.pageView.pageIndexOf(f) === this.page)
    if (this.stage.zoomed) fragment?.scrollIntoView({ block: 'center' })
    if (fragment && ops.findEditable(this.report, id)) requestAnimationFrame(() => this.openEditor(id, finding.start ?? 0))
  }

  // ---- ページ送り ----

  /**
   * page ページ目（0 から）を表示する。
   * turn：隣のページは本のようにめくる（離れたページはふわっと切り替える）／fade：ふわっと切り替える／none：すぐ切り替える
   */
  goToPage(index: number, effect: PageEffect = 'turn'): Promise<void> {
    const to = Math.max(0, Math.min(index, this.renderer.pageCount() - 1))
    if (this.turning) return this.turning
    if (to === this.page || to < 0) return Promise.resolve()
    if (this.overlay.blockId) this.overlay.commit()
    this.clearFrozen(Infinity)
    this.marker.hidden = true
    this.selection = null
    this.markSelection()
    const from = this.page
    // 紙面の欄にフォーカスがあったら、送った先のページの最初の欄に移す（前のページは隠れて、フォーカスが失われるため）
    const focused = this.paperFocus()
    this.page = to
    // スマホ：拡大したまま移ると、送った先のページの一部（作品写真のページでは白い所）しか見えず、ページ送りと帯も隠れたままだった。
    // ページを替えたら、ページ全体の表示に戻す（指摘へ移って書き始めるときは、書く欄を開くときにまた拡大する）
    if (this.overlay.inSheet && this.stage.zoomed) this.stage.setZoom(false)
    this.scroller.scrollTop = 0
    this.turning = this.renderer.turn(from, to, effect).finally(() => {
      this.turning = null
      if (focused) this.focusPaper(null, focused.visible)
      this.notify()
    })
    this.notify()
    return this.turning
  }

  nextPage(): void {
    void this.goToPage(this.page + 1)
  }

  prevPage(): void {
    void this.goToPage(this.page - 1)
  }

  /** 種類（表紙・抄録など）の最初のページへ */
  goToArea(area: string): void {
    const index = this.layout?.kinds.indexOf(area as never) ?? -1
    if (index >= 0) void this.goToPage(index, 'fade')
  }

  /** 全体（1ページ全体を表示）と拡大（横幅いっぱい）を切り替える */
  setZoom(zoomed: boolean): void {
    this.scroller.scrollTop = 0
    this.stage.setZoom(zoomed)
  }

  /** 紙面のまわりに空ける幅（台の CSS の変数）を変えたとき、紙面の倍率と位置を求め直す（スマホの紙面の下の帯。app/PageBand.tsx） */
  refitPage(): void {
    this.stage.fit()
  }

  /**
   * スマホ：書く欄を画面の下に出す（host はその中の、入力欄を置く要素）。null なら紙面に重ねる（PC）
   */
  setSheetHost(host: HTMLElement | null): void {
    this.hideStyle.textContent = ''
    this.overlay.setSheetHost(host)
    // 画面の並べ方が変わると紙面のまわりの余白も変わるため、倍率を求め直す
    this.setZoom(false)
    this.notify()
  }

  /** スマホ：書く欄の「完了」。書き終えて、紙面を1ページ全体の表示に戻す */
  finishEditing(): void {
    this.overlay.commit()
    if (this.overlay.inSheet) this.setZoom(false)
  }

  /** スマホ：書いているブロックが、紙面の見えている部分の上の方に来るようにスクロールする */
  private revealEditing(): void {
    const id = this.overlay.blockId
    const view = this.renderer.pageView
    const fragment = id ? view.fragments(id).find((f) => view.pageIndexOf(f) === this.page) : undefined
    if (!fragment) return
    const top = fragment.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top
    this.scroller.scrollTop += top - 16
  }

  /** いま見えている紙面の各ページの要素（ページ一覧の縮小表示に使う） */
  pageElements(): HTMLElement[] {
    return this.renderer.pageView.pages()
  }

  /** 書いている文字が別のページへ移ったら、表示もそのページへ移り、入力欄を合わせる */
  private followCaret(): void {
    const id = this.overlay.blockId
    if (!id) return
    // 日本語の変換中は動かさない（変換の候補が見えなくなるため）
    if (!this.overlay.composing) {
      const page = this.renderer.pageView.pageOfOffset(id, this.overlay.caret)
      if (page >= 0 && page !== this.page && !this.turning) {
        this.page = page
        this.clearFrozen(Infinity)
        this.scroller.scrollTop = 0
        this.renderer.show(page, 'fade')
        if (this.overlay.inSheet) this.revealEditing()
      }
    }
    const placement = this.overlayPlacement(id)
    if (placement) this.overlay.moveTo(placement)
    this.shiftFollowing()
  }

  /** 入力欄を閉じて、書いた文字を確定する。frozen：閉じる前の入力欄の見た目を写した要素（紙面に重ねる。PC だけ） */
  private onCommitEdit(id: string, text: string, byKey: boolean, frozen: HTMLElement | null = null): void {
    // サブタイトル：自動で付く前後の決まり文句（「―」「の衣装制作―」など）まで入力していたら取る（表紙で二重にならないように）
    const course = id === FIELD_IDS.subtitleInput ? findCourse(this.config, this.report.basicInfo.courseId) : undefined
    const committed = ops.setText(this.report, id, course ? subtitleInputOnly(course, text) : text)
    // 書いていた欄の文字が、表に出ている紙面と違えば、組み直した紙面が出るまで、閉じる前の見た目のまま仮に表示する（freezeEdited）。
    // 後ろの文章をずらしていれば、それもそのままにする
    // （段落を分けたばかりで、まだ紙面にない段落も。分けた前の段落の仮の表示も一緒に写してある）
    const shownText = this.shownReport ? ops.findEditable(this.shownReport, id)?.text : undefined
    const nextText = ops.findEditable(committed, id)?.text
    const unrendered = this.renderer.pageView.fragments(id).length === 0
    if (frozen && nextText !== undefined && (unrendered || nextText !== shownText)) this.freezeEdited(id, frozen, this.hideStyle.textContent ?? '', nextText)
    else {
      frozen?.remove()
      this.clearShift()
    }
    if (this.continuing?.id === id) this.continuing = null
    this.report = committed
    if (this.reportBeforeEdit && JSON.stringify(this.reportBeforeEdit) !== JSON.stringify(this.report)) this.pushHistory(this.reportBeforeEdit)
    this.reportBeforeEdit = null
    this.hideStyle.textContent = ''
    // 閉じた段落が空のままなら、すぐ「空の段落がある」と言う（組み直すのを待たない）
    this.runChecks()
    if (byKey && !this.overlay.inSheet) {
      // Esc・Enter で書き終えた（PC）：書いていた紙面の欄にフォーカスを戻す（ページ全体に戻ると、どこにいたか分からなくなる）。
      // 欄がまだ紙面にない（分けたばかりの段落など）ときは、組み直してから戻す
      if (!this.focusPaper(blockPaperKey(id), true)) this.refocusKey = blockPaperKey(id)
      else this.ringFrozen(id)
    }
    this.afterChange({ render: 'now', save: true })
  }

  /** 後ろの文章をずらしている要素（組み直す・書き終えると元に戻す） */
  private shifted: HTMLElement[] = []

  /**
   * 書いていて段落の行が増えた（減った）とき、紙面を組み直すのを待たずに、同じページの後ろの文章を下（上）へずらして見せる。
   * 入力欄が後ろの文章に重なって隠さないようにするため。ページの下からはみ出す分は見せない。組み直すと、新しい紙面で正しく並ぶ。
   */
  private shiftFollowing(): void {
    this.clearShift()
    // 書き終えた欄の仮の表示が後ろの文章をずらしていれば、外してから測る（同じ要素を2つの仕組みでずらさないように）
    this.clearFrozen(Infinity, (f) => f.shift.length === 0)
    const id = this.overlay.blockId
    // 行が増えるのは段落（見出し・表紙の項目などは1行）
    if (!id || this.overlay.inSheet || this.overlay.kind !== 'paragraph') return
    const view = this.renderer.pageView
    // 組み直すのを待っているあいだ（段落を分けた・つなげた直後）は、元の段落の後ろをずらす
    const anchor = (this.continuing?.id === id && this.continuing.anchor) || id
    const last = view.fragments(anchor).at(-1)
    // 段落が次のページへ続いているときは、このページに後ろの文章はない
    if (!last || view.pageIndexOf(last) !== this.page) return
    const lastRect = last.getBoundingClientRect()
    const delta = this.overlay.bottom - lastRect.bottom
    if (Math.abs(delta) < 1) return
    const page = view.pages()[this.page]
    const section = last.closest('section')
    if (!page || !section) return
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
      this.shifted.push(t)
    }
  }

  private clearShift(): void {
    resetShift(this.shifted)
    this.shifted = []
  }

  /**
   * 書き終えた欄の、閉じる前の見た目の写し（組み直した紙面が出るまで紙面に重ねる）。
   * id：書いていた欄。text：書き終えた文字。seq：その変更を含む原稿の、変更の回数。shift：ずらしたままにしている後ろの文章。hidden：隠したままにしている欄の CSS
   */
  private frozen: { id: string; text: string; element: HTMLElement; seq: number; shift: HTMLElement[]; hidden: string }[] = []

  /**
   * 書き終えた欄の文字を、組み直した紙面が出るまで、閉じる前の見た目のまま紙面に重ねて見せる（PC）。
   * 前は、閉じるとすぐ紙面の前の文字が見え、組み直すと（長い原稿では1〜3秒後）書いた文字に変わっていた。
   * 書いていた欄（と、段落を分けた前の段落）は隠したまま、後ろの文章のずらしもそのままにする。
   * 組み直した紙面が出たら外す（render の clearFrozen）。ページを送った・画面の大きさが変わった・別の欄を書いて後ろの文章をずらすときも外す
   */
  private freezeEdited(id: string, element: HTMLElement, hidden: string, text: string): void {
    // 書く欄より下に置く（同じ欄をまた書き始めたら、書く欄が上に出る）
    this.layer.insertBefore(element, this.layer.firstChild)
    // 隠した欄は、見えないだけで押せるようにしておく（すぐ押し直して続きを書けるように。visibility: hidden だと押せない）
    hidden = hidden.replaceAll('visibility: hidden !important;', 'opacity: 0 !important;')
    this.frozen.push({ id, text, element, seq: this.changeSeq + 1, shift: this.shifted, hidden })
    this.shifted = []
    this.frozenStyle.textContent = this.frozen.map((f) => f.hidden).join('\n')
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

  applyFinding(finding: ReportFinding): void {
    if (!finding.blockId || finding.replacement === undefined) return
    this.commitForChange()
    const editable = ops.findEditable(this.report, finding.blockId)
    if (!editable) return
    // 空の段落（ひな形の説明のないもの）：「直す」で段落ごと消す（画面の下に「段落を削除しました［戻す］」が出る）
    if (finding.ruleId === 'paragraph-empty') {
      if (ops.isBlankParagraph(this.report, finding.blockId)) this.removeBlock(finding.blockId)
      return
    }
    // 手で書いた図表の番号をつなげるときは、同じ段落に自動で入れた（図n）があれば除く（二重にしない）
    if (finding.ruleId === 'manual-ref') return this.update((r) => ops.linkManualRef(r, finding.blockId!, finding.start!, finding.end!, finding.replacement!))
    this.update((r) => ops.setText(r, finding.blockId!, applyFix(editable.text, { ...finding, start: finding.start!, end: finding.end! })))
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
      return { rect: { left: r.left, top: r.top, right: r.right }, clip: alignOffset > 0 ? { ...clip, top: r.top } : clip, scale, alignOffset }
    }
    // 見出し・図のタイトル・表紙の項目・表のセル：入力部分の左端から、行（セル）の右端まで
    const kind = this.overlayKind(editable.kind)
    const box = (fragment.closest('td, h1, h2, figcaption, p, .el') as HTMLElement | null) ?? fragment
    const own = fragment.getBoundingClientRect()
    const boxRect = box.getBoundingClientRect()
    const left = kind === 'cell' ? boxRect.left + 2 * scale : own.left
    const right = Math.max(boxRect.right - (kind === 'cell' ? 2 * scale : 0), own.left + 120 * scale)
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
    }
  }

  openEditor(id: string, caret: number): void {
    // 書く位置が別のページにあれば、そのページを表示する
    const page = this.renderer.pageView.pageOfOffset(id, caret)
    if (page >= 0 && page !== this.page && !this.turning) {
      this.page = page
      this.clearFrozen(Infinity)
      this.scroller.scrollTop = 0
      this.renderer.show(page)
    }
    // 書き終えたばかりの同じ欄をまた書くときは、仮の表示を外す（書く欄が、組み直す前の紙面の上で開く）
    this.clearFrozen(Infinity, (f) => f.id !== id)
    const target = this.overlayTarget(id, caret)
    if (!target) return
    if (this.overlay.blockId && this.overlay.blockId !== id) this.overlay.commit()
    this.currentId = id
    this.selection = null
    this.markSelection()
    this.reportBeforeEdit = this.report
    this.hideStyle.textContent = this.editingStyle(id)
    this.overlay.open(target)
    // スマホ：紙面を拡大し、書いているところを見せる
    if (this.overlay.inSheet) {
      if (!this.stage.zoomed) this.stage.setZoom(true)
      this.revealEditing()
    }
    // 開いた段落の「空の段落がある」を消す（書いている間は言わない。runChecks）
    this.runChecks()
    this.notify()
  }

  /** 書いているブロックの紙面での見せ方。PC は入力欄を重ねるので隠し、スマホは下の欄で書くので枠で示す */
  private editingStyle(id: string): string {
    const selector = `.page-viewport [data-block-id="${CSS.escape(id)}"]`
    return this.overlay.inSheet
      ? `${selector} { outline: 2px solid #2f3e75; outline-offset: 2px; background: rgba(47, 62, 117, 0.08); }`
      : `${selector} { visibility: hidden !important; }`
  }

  /**
   * 段落を分けた・つなげた・↑↓で移ったとき：紙面を組み直すのを待たずに、入力欄を開いたまま書く先を移す。
   * 組み直しは長い原稿だと数秒かかり、待つ間に打った文字が消えていたため。組み直したら正しい位置へ動かす（render の終わり）。
   * ghostOf：分けた前の段落（組み直すまで、入力欄の上に仮に表示する）。alsoHide：つなげて無くなった段落（組み直すまで隠す）。
   * inPlace：移る先の段落は、もう紙面にある（見出しの後ろの空の段落。後ろの文章は、その段落を基準にずらす）
   */
  private continueWriting(id: string, caret: number, how: { ghostOf?: string; alsoHide?: string; inPlace?: boolean } = {}): void {
    const editable = ops.findEditable(this.report, id)
    if (!editable || !this.overlay.blockId) return this.reopenAfterRender(id, caret)
    const kind = this.overlayKind(editable.kind)
    const view = this.renderer.pageView
    const fragment = view.fragments(id)[0]
    // まだ紙面にない段落（分けた後ろ）は、同じ種類の段落の書体を写す
    const kinds = fragment ? null : new Map(ops.editables(this.report).map((e) => [e.id, e.kind]))
    const styleSource = fragment ?? [...document.querySelectorAll<HTMLElement>('.page-viewport.front [data-block-id]')].find((el) => kinds?.get(el.dataset.blockId!) === editable.kind)
    const ghost = how.ghostOf ? (ops.findEditable(this.report, how.ghostOf)?.text ?? '') : undefined
    this.overlay.continueIn({ blockId: id, kind, text: editable.text, caret, styleSource }, ghost)
    const placement = fragment ? this.overlayPlacement(id) : null
    if (placement) this.overlay.moveTo(placement)
    this.continuing = { id, anchor: how.inPlace ? null : (how.ghostOf ?? how.alsoHide ?? null) }
    this.pendingOpen = null
    this.currentId = id
    this.selection = null
    const hidden = this.overlay.inSheet ? [id] : [id, how.ghostOf, how.alsoHide].filter((x): x is string => !!x)
    this.hideStyle.textContent = hidden.map((x) => this.editingStyle(x)).join('\n')
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
    this.overlay.settle(this.renderer.pageView.fragments(id)[0])
    this.hideStyle.textContent = this.editingStyle(id)
    this.followCaret()
    if (this.overlay.inSheet) this.revealEditing()
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
    if (this.overlay.inSheet) return false
    const editable = ops.findEditable(this.report, id)
    const view = this.renderer.pageView
    const page = view.pages()[this.page]
    if (!editable || !page) return false
    const shown = view.fragments(id).some((f) => view.pageIndexOf(f) === this.page)
    const target = shown ? this.overlayTarget(id, caret) : this.unrenderedTarget(id, editable, caret, near, page)
    if (!target) return false
    this.overlay.open(target)
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
    return {
      rect: { left, top: Math.max(top, contentTop), right: left + TEXT_W * scale },
      clip: { left: p.left, top: p.top, right: p.right, bottom: p.bottom },
      scale,
      alignOffset: 0,
      blockId: id,
      kind: this.overlayKind(editable.kind),
      text: editable.text,
      caret,
      styleSource,
      enterCreatesParagraph: ['chapter', 'subheading', 'figureCaption', 'tableCaption'].includes(editable.kind),
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
    if (this.overlay.inSheet) this.openUnrendered(created.newId)
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
    // 削除して、組み直した紙面がまだ出ていない間は、紙面を押しても何もしない（古い紙面で、消したブロックの隣を開いてしまわないように）
    if (this.removed.size > 0) return
    // スマホ：指で押した点で決める（ブラウザが近くの欄へ寄せたあとの点ではなく。rawTouch）
    const touch = keyHit === undefined ? this.rawTouch(e) : null
    const { clientX: x, clientY: y } = touch ?? e
    const target = (touch?.target ?? e.target) as HTMLElement
    // スマホ：まだ書いていない欄の「＋」の印（とそのまわり 44px 四方）を押した：その欄を開く（markerAt）
    const marked = touch ? this.markerAt(x, y, target) : null
    if (marked === FIELD_IDS.course) return this.callbacks.onCourseClick(this.renderer.pageView.fragments(marked)[0].getBoundingClientRect())
    if (marked) return this.openOrSelect(marked, ops.findEditable(this.report, marked)?.text.length ?? 0, false)
    // 紙の外（まわりの灰色の所）を押した：書いている欄を閉じる（Esc と同じ。近くの欄は開かない）。
    // 前は、閉じた直後に、押した所にいちばん近い欄が開き直していたため、紙の外を押しても書く欄を閉じられなかった
    if (keyHit === undefined && this.outsidePaper(x, y)) return this.select(null)
    // 抄録の「先生の許可が出た」
    if (target.closest('[data-abstract-start]')) return this.startAbstract()
    // 改ページの印：選ぶ（道具の「削除」で消せる）
    const pageBreak = target.closest<HTMLElement>('.page-break[data-block-id]')
    if (pageBreak) return this.select({ kind: 'pageBreak', id: pageBreak.dataset.blockId! })
    // 表紙の題目（研究題目）は学科で決まっていて書けない。押しても何も起きないと理由が分からないので、画面の下に知らせる（PC のマウスを重ねたときの説明は paperFocus.ts）
    if (target.closest('section.cover .el.title')) return this.noticeInfo(fixedTitleNote(this.config.cover.titleLabel))
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
    const slot = target.closest<HTMLElement>('[data-photo-slot]')
    if (slot) {
      const index = Number(slot.dataset.photoSlot)
      // 写真が入っている枠：その写真を選ぶ（道具の「差し替え」「外す」で操作する）。空の枠：すぐ写真を選ぶ
      if (this.report.workPhotos.imageIds[index]) return this.select({ kind: 'photos', index })
      this.select({ kind: 'photos' })
      void this.setPhoto(index)
      return
    }
    if (target.closest('section.photos')) return this.select({ kind: 'photos' })
    if (target.closest('section.references')) return this.callbacks.onReferencesClick()
    // スマホ：紙面の欄は小さく、少しずれて押すと開かなかった。指の幅ほどの近さにある欄を開く
    const near = this.overlay.inSheet && keyHit === undefined ? this.nearestEditable(x, y, 18) : null
    if (near === FIELD_IDS.course) return this.callbacks.onCourseClick(this.renderer.pageView.fragments(near)[0].getBoundingClientRect())
    if (near) return this.openOrSelect(near, ops.findEditable(this.report, near)?.text.length ?? 0, false)
    this.select(null)
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
    const selectFirst = this.overlay.inSheet && !byKey && ops.findEditable(this.report, id)?.kind === 'tableCaption'
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
      const slot = this.viewport.querySelector<HTMLElement>(`[data-photo-slot="${s.index}"]`)
      if (slot?.querySelector('img')) {
        slot.dataset.photoLabel = `${s.index + 1}枚目`
        slot.classList.add('is-selected')
      }
    }
  }

  // ---- 変更 ----

  private pushHistory(report: Report): void {
    this.history.push(report)
    if (this.history.length > 200) this.history.shift()
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
    this.commitForChange()
    const previous = this.history.pop()
    if (!previous) return
    // 戻した所は、組み直した紙面で見せる（ほかのページでも、そこへ移って少しの間光らせる）
    this.undone = changedPlace(this.report, previous)
    this.report = previous
    this.afterChange({ render: 'now', save: true })
    const restored: NoticeBody | null = shown?.kind === 'removed' ? { kind: 'restored', what: shown.what } : shown?.kind === 'started' ? { kind: 'unstarted' } : null
    this.notice = restored ? { notice: { ...restored, id: ++this.noticeCount }, report: this.report } : null
    // 削除して、まだ組み直していない間に戻したもの：すぐまた見せる
    this.hideRemoved()
    this.notify()
  }

  /** 報告書を丸ごと入れ替える（復元・新規作成）。履歴は消す */
  replace(report: Report): void {
    this.commitForChange()
    this.history = []
    this.report = report
    this.selection = null
    this.currentId = null
    this.undone = null
    this.removed.clear()
    this.hideRemoved()
    this.clearFrozen(Infinity)
    this.afterChange({ render: 'now', save: true })
  }

  /**
   * 削除したブロック・図・表の ID。組み直した紙面に出なくなるまで、今の紙面ですぐ隠す。
   * 組み直しは長い原稿では1秒ほどかかり、その間は削除したものが紙面に残って見えたため（押しても消えないと思い、もう一度押してしまう）。
   * 隠している間（組み直した紙面がまだ出ていない間）は、紙面を押しても開かず、続けて削除もしない（古い紙面の隣のブロックを開いて消さないように）
   */
  private readonly removed = new Set<string>()

  /** 原稿を削除で変える（元に戻せる）。消えたものは、組み直すのを待たずに紙面から隠す。what：消したもの（画面の下に知らせる） */
  private removeNow(fn: (report: Report) => Report, what: RemovedWhat): void {
    const before = bodyIds(this.report)
    this.update(fn)
    // 隠した分だけ紙面の後ろの文章が詰まり、書き終えた欄の仮の表示と位置が合わなくなるので外す
    this.clearFrozen(Infinity)
    const after = bodyIds(this.report)
    const gone = [...before].filter((id) => !after.has(id))
    for (const id of gone) this.removed.add(id)
    this.hideRemoved()
    if (gone.length > 0) this.noticeRemoved(what)
  }

  // ---- 削除の「戻す」の知らせと、元に戻した所（mockups/v32 ② 案A。言葉と比べ方は undoNotice.ts、知らせの部品は app/UndoBar.tsx） ----

  /** 画面の下に出す知らせと、出したときの原稿（ほかを変えたら出さない） */
  private notice: { notice: UndoNotice; report: Report } | null = null
  private noticeCount = 0
  /** 元に戻して変わった所（組み直したら、そこへ移って光らせる） */
  private undone: ChangedPlace | null = null

  /** いま出す知らせ：削除した・戻した直後の原稿のまま（ほかを変えていない）で、書き始めていないとき */
  private get currentNotice(): UndoNotice | null {
    // 戻すもののない知らせ（表の行・列を消せないわけ）は、書いている間も出す（セルを書いている間に押すため）
    return this.notice && this.notice.report === this.report && (!this.overlay.blockId || this.notice.notice.kind === 'info') ? this.notice.notice : null
  }

  /** 削除した（画面の下に「〜を削除しました［戻す］」を出す） */
  private noticeRemoved(what: RemovedWhat): void {
    this.notice = { notice: { kind: 'removed', what, id: ++this.noticeCount }, report: this.report }
    this.notify()
  }

  /** 元に戻した所へ移り（ほかのページならめくる。拡大していれば、そこまで動かす）、少しの間光らせる */
  private showUndone(place: ChangedPlace): void {
    const view = this.renderer.pageView
    const targets = this.undoneElements(place)
    const page = targets.length ? view.pageIndexOf(targets[0]) : place.kind === 'area' ? (this.layout?.kinds.indexOf(place.area) ?? -1) : -1
    if (page < 0) return
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    const light = (here: HTMLElement[]) => {
      for (const el of here) el.classList.add('undo-flash')
      window.setTimeout(() => here.forEach((el) => el.classList.remove('undo-flash')), UNDO_FLASH_MS)
    }
    // 光らせるのは、そこが見えてから（ページをめくり終え、拡大していればそこまで動かし終えてから）。
    // 前は動かし始めると同時に光らせたため、画面の下の方の段落では、見えたときには光が消えていた
    const flash = () => {
      const here = targets.filter((el) => view.pageIndexOf(el) === this.page)
      if (here.length && this.stage.zoomed && !this.inView(here[0])) this.scrollThen(here[0], still, () => light(here))
      else light(here)
    }
    if (page === this.page) flash()
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
        return all(`[data-photo-slot="${place.index}"]`)
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
    if (editing && ops.inBody(this.report, editing)) return editing
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

  /** 改ページを入れる（足す位置の後ろ。この後ろは次のページから始まる） */
  addPageBreak(): void {
    if (this.settlingRemoval) return
    const after = this.insertionAnchor()
    const id = ops.newId('pb')
    this.marker.hidden = true
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
    // 書いた文字を確定してから写真を選ぶ（写真を選ぶ画面を開くと入力欄は閉じる）
    this.overlay.commit()
    const imageId = await this.importImage('figure')
    if (!imageId) {
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
    if (ops.paragraphEmpty(this.report, paragraphId)) {
      this.report = below(this.report)
      return { id: paragraphId, place: 'after' }
    }
    const next = below(ops.insertRef(this.report, paragraphId, caret, objectId))
    this.report = ops.linkWrittenRef(next, paragraphId, objectId) ?? next
    return { id: paragraphId, place: 'after' }
  }

  /**
   * 表を入れる（空の表か、素材表のひな形）。図と同じく、カーソルのある文の終わりに「（表n）」が入り、段落のすぐ下に表が入る。
   * タイトルを書いて Enter を押すと、表の後ろに新しい段落ができる
   */
  addTable(kind: 'blank' | 'material'): void {
    const paragraphId = this.editingParagraph()
    if (!paragraphId || this.settlingRemoval) return
    const caret = this.overlay.caret
    this.commitForChange()
    const tableId = ops.newId('t')
    const table = kind === 'material' ? materialTable(tableId, ops.newId) : blankTable(tableId, ops.newId)
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
    this.changeTable(tableId, (t) => removeRow(t, at.row))
  }

  /** 表を消せない操作のあとに添える、表ごと消す方法（その画面で、表の「削除」がどこにあるか） */
  private removeTableHow(): string {
    // PC：表のセル・タイトルを書いている間も、表を選んでいる間も、左の道具に「この表」の「削除」がある
    if (!this.overlay.inSheet) return '表ごと消すときは、左の「この表」の「削除」を押します。'
    // スマホ：表のセル・タイトルを書いている間は、書く欄の道具に「この表を削除」がある。表を選んでいる間は、下の「この表」の道具に「削除」がある
    return this.overlay.blockId ? '表ごと消すときは、書く欄の「この表を削除」を押します。' : '表ごと消すときは、「この表」の「削除」を押します。'
  }

  /**
   * 表を削除する（表のセル・タイトルを書いている間も。スマホの書く欄の「この表を削除」）。書く欄は閉じ、スマホはページ全体の表示に戻す。
   * 画面の下に「表を削除しました［戻す］」が出る。前は、スマホで表を消すには表のタイトル（ページ全体の表示では高さ 7px ほど）をタップするしかなかった
   */
  removeTable(tableId: string): void {
    if (!ops.findTable(this.report, tableId) || this.removed.size > 0) return
    // 書いていたセルの文字を確定してから消す（組み直すのは、消したあとの1回だけ）
    this.commitForChange()
    if (this.overlay.inSheet) this.setZoom(false)
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
    if (at) this.changeTable(tableId, (t) => addColumn(t, at.column, ops.newId))
  }

  /** 書いているセルの列を消す（最後の1列は残す。消せないときは、わけと表ごと消す方法を知らせる） */
  removeTableColumn(tableId: string): void {
    const at = this.currentCell(tableId)
    if (!at) return
    if (Math.max(...at.table.rows.map((r) => r.cells.length)) <= 1) return this.noticeInfo(`表には1列以上が要ります。${this.removeTableHow()}`)
    this.changeTable(tableId, (t) => removeColumn(t, at.column))
  }

  /** 列の幅：そろえる（同じ幅）／中身に合わせる */
  setTableWidths(tableId: string, widths: TableBlock['widths']): void {
    this.changeTable(tableId, (t) => ({ ...t, widths }))
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
  private changeTable(tableId: string, fn: (table: TableBlock) => TableBlock, keep?: string): void {
    const editing = this.overlay.blockId
    const caret = editing ? this.overlay.caret : 0
    this.commitForChange()
    this.pushHistory(this.report)
    this.report = ops.updateTable(this.report, tableId, fn)
    const cellId = keep ?? editing
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

  // ---- 作品写真 ----

  /** 並べ方を変える（写真は消さずに先頭へ詰める。枚数を減らすと、1枚目から順に載る） */
  setPhotoLayout(layout: WorkPhotoLayout, columns: number): void {
    // 写真の順番が変わることがあるので、選んでいた写真は選び直してもらう
    if (this.selection?.kind === 'photos') this.selection = { kind: 'photos' }
    this.update((r) => ({ ...r, workPhotos: changeArrangement(r.workPhotos, layout, columns) }))
  }

  async setPhoto(index: number): Promise<void> {
    const imageId = await this.importImage('photo')
    if (!imageId) return
    this.update((r) => ({ ...r, workPhotos: putPhoto(r.workPhotos, index, imageId) }))
  }

  /** index 枚目の写真を外して、枠を空にする（元に戻せる。画面の下に「作品写真を外しました［戻す］」を出す） */
  removePhoto(index: number): void {
    if (this.selection?.kind === 'photos') this.selection = { kind: 'photos' }
    const had = !!this.report.workPhotos.imageIds[index]
    this.update((r) => ({ ...r, workPhotos: putPhoto(r.workPhotos, index, '') }))
    if (had) this.noticeRemoved('作品写真')
  }

  /** 写真の切り抜く位置を変える（x・y は %。50 が中央） */
  setPhotoPosition(index: number, position: PhotoPosition): void {
    this.update((r) => ({ ...r, workPhotos: movePhoto(r.workPhotos, index, position) }))
  }

  /**
   * index 枚目の写真を「全体を入れる（切らない）」にする・枠いっぱいに切り抜くのに戻す（元に戻せる。mockups/v32 ③ 案A）。
   * 選んでいる写真は、選んだまま（道具のスイッチを続けて押せるように）
   */
  setPhotoWhole(index: number, on: boolean): void {
    this.update((r) => ({ ...r, workPhotos: wholePhoto(r.workPhotos, index, on) }))
  }

  // 作品写真をつかんで動かし、枠の中で見える位置を変える（つかまずに離したらクリック＝写真を選び直す）
  private photoDrag: PhotoDrag | null = null
  private suppressClick = false

  private onPhotoPointerDown(e: PointerEvent): void {
    const img = (e.target as HTMLElement).closest?.<HTMLImageElement>('[data-photo-slot] img')
    if (!img || e.button !== 0 || !img.naturalWidth) return
    const slot = img.closest<HTMLElement>('[data-photo-slot]')!
    const index = Number(slot.dataset.photoSlot)
    // 全体を入れている写真は切り抜いていないので、動かさない（押すと、ふつうのクリック＝写真を選ぶ）
    if (this.report.workPhotos.whole?.[index] || slot.classList.contains('whole')) return
    const cell = slot.getBoundingClientRect()
    const k = Math.max(cell.width / img.naturalWidth, cell.height / img.naturalHeight)
    this.photoDrag = {
      index,
      img,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      from: this.report.workPhotos.positions?.[index] ?? { x: 50, y: 50 },
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
    this.setPhotoPosition(d.index, this.photoDragPosition(d, e.clientX - d.startX, e.clientY - d.startY))
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
    // 「PDFを書き出す」の窓を通らずに、ブラウザの印刷（Ctrl+P など）で出したとき：エラーが残っていれば下書き（透かし入り）にする。
    // 提出用に見える PDF が、エラーを残したまま出ないように。ファイル名のもとになるページの題も合わせる
    const fromDialog = document.title === this.pdfTitle || document.title === `${this.pdfTitle}_下書き`
    if (fromDialog) return
    const draft = this.findings.some((f) => f.severity === 'error')
    const title = document.title
    document.title = draft ? `${this.pdfTitle}_下書き` : this.pdfTitle
    document.documentElement.classList.toggle('print-draft', draft)
    window.addEventListener(
      'afterprint',
      () => {
        document.title = title
        document.documentElement.classList.remove('print-draft')
      },
      { once: true },
    )
  }

  /** PDF のファイル名のもと（例：2026_卒業制作報告書_00ZZ0123_文化花子）。学籍番号・氏名がまだ空なら、その部分は付けない */
  get pdfTitle(): string {
    const { studentId, name } = this.report.basicInfo
    return [String(this.config.fiscalYear), this.config.reportName, studentId.trim(), name.replace(/[\s　]/g, '')].filter(Boolean).join('_')
  }
}
