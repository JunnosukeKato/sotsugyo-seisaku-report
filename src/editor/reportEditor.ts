import type { YearConfig } from '../config'
import { checkReportDetailed, type ReportFinding } from '../checker/reportChecks'
import { applyFix } from '../checker/textRules'
import { FIELD_IDS } from '../layout/document'
import type { LayoutInfo } from '../layout/measure'
import { FIGURE_MAX_PX, fitFigureSize, importImage, PHOTO_MAX_PX } from '../model/images'
import { putImage, type StoredImage } from '../model/storage'
import { applyCourseTemplate, bodyWritten } from '../model/template'
import { changeArrangement, clampPercent, movePhoto, putPhoto } from '../model/photos'
import { addColumn, addRow, blankTable, cellPosition, materialTable, removeColumn, removeRow, setCellImage } from '../model/table'
import type { BodyBlock, Chapter, PhotoPosition, Report, TableBlock, WorkPhotoLayout } from '../model/types'
import { OverlayEditor, type OverlayKind, type OverlayPlacement, type OverlayTarget } from './overlayEditor'
import { PageStage } from './pageStage'
import { blockPaperKey, markFocusable, PAPER_FOCUSABLE, paperElement, paperKeyOf, paperOrder, rememberTabStop, setTabStop } from './paperFocus'
import * as ops from './reportOps'
import { ReportRenderer, type PageEffect } from './reportRenderer'

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

const RENDER_DELAY_MS = 600
const FIGURE_MAX_MM = 80

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
  private renderTimer: number | undefined
  private renderMs = 0
  private pendingOpen: { id: string; caret: number } | null = null
  /** 入力欄を開いたまま書く先を移し、紙面を組み直すのを待っている（anchor：その間、後ろの文章をずらす基準のブロック） */
  private continuing: { id: string; anchor: string | null } | null = null
  /** 「図を入れる」の後、図のタイトルを Enter で確定したら、書いていた段落のこの位置に戻る */
  private returnTo: { from: string; id: string; caret: number } | null = null
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
    document.head.append(this.hideStyle)
    CSS.highlights.set('issue-error', this.highlights.error)
    CSS.highlights.set('issue-warning', this.highlights.warning)
    CSS.highlights.set('issue-focus', this.highlights.focus)
    this.marker = document.createElement('div')
    this.marker.className = 'insert-marker'
    this.marker.hidden = true
    this.marker.textContent = 'ここに入ります'
    layer.append(this.marker)

    this.overlay = new OverlayEditor(layer, scroller, {
      onInput: (id, text) => {
        this.report = ops.setText(this.report, id, text)
        this.afterChange({ render: 'debounce', save: true })
      },
      onCommit: (id, text, byKey) => this.onCommitEdit(id, text, byKey),
      onSplit: (id, before, after) => {
        // 図・表を入れた直後のタイトル：Enter で、書いていた段落の続きに戻る
        if (this.returnTo?.from === id) return this.onCommitEdit(id, before + after, true)
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
        this.reopenAfterRender(result.lastId, caretInLast)
      },
      onResize: () => this.shiftFollowing(),
    })

    // 画面の大きさが変わって紙面の倍率・位置が変わったら、入力欄も合わせる
    this.stage = new PageStage(stage, () => {
      this.marker.hidden = true
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
      version: this.version,
    }
    return this.snapshotCache
  }

  private notify(): void {
    this.version += 1
    for (const listener of this.listeners) listener()
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

  scheduleRender(delay = RENDER_DELAY_MS): void {
    clearTimeout(this.renderTimer)
    this.renderTimer = window.setTimeout(() => void this.render(), delay)
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

  async render(): Promise<void> {
    clearTimeout(this.renderTimer)
    if (this.rendering) {
      this.renderAgain = true
      return
    }
    this.rendering = true
    this.notify()
    const image = (id: string) => this.images.get(id)
    try {
      const result = await this.renderer.renderBack(this.report, this.config, {
        imageSrc: (id) => image(id)?.url ?? this.placeholderImage,
        photoSrc: (id) => image(id)?.url ?? this.placeholderImage,
        figureSize: (f) => {
          const img = image(f.imageId)
          return img ? fitFigureSize(img, FIGURE_MAX_MM) : { widthMm: 60, heightMm: 45 }
        },
      })
      // ページを送っている途中なら、送り終わってから入れ替える
      if (this.turning) await this.turning
      this.renderMs = result.ms
      this.layout = result.layout
      this.page = Math.max(0, Math.min(this.page, result.layout.kinds.length - 1))
      // 紙面の欄にフォーカスがあれば、組み直した紙面の同じ欄に移し直す（要素が作り直されて、フォーカスが失われないように）
      const focused = this.paperFocus()
      this.renderer.swap(this.page)
      markFocusable(this.viewport)
      if (focused) this.focusPaper(focused.key, focused.visible)
      this.markPrintSkip()
    } finally {
      this.rendering = false
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
    this.notify()
    if (this.renderAgain) {
      this.renderAgain = false
      void this.render()
    }
  }

  // ---- セルフチェック ----

  private runChecks(): void {
    const checked = checkReportDetailed(this.report, this.config, this.layout)
    this.findings = checked.findings
    this.acknowledged = checked.acknowledged
    this.refreshHighlights()
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
    this.marker.hidden = true
    this.selection = null
    this.markSelection()
    const from = this.page
    // 紙面の欄にフォーカスがあったら、送った先のページの最初の欄に移す（前のページは隠れて、フォーカスが失われるため）
    const focused = this.paperFocus()
    this.page = to
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
        this.scroller.scrollTop = 0
        this.renderer.show(page, 'fade')
        if (this.overlay.inSheet) this.revealEditing()
      }
    }
    const placement = this.overlayPlacement(id)
    if (placement) this.overlay.moveTo(placement)
    this.shiftFollowing()
  }

  /** 入力欄を閉じて、書いた文字を確定する */
  private onCommitEdit(id: string, text: string, byKey: boolean): void {
    this.clearShift()
    if (this.continuing?.id === id) this.continuing = null
    this.report = ops.setText(this.report, id, text)
    if (this.reportBeforeEdit && JSON.stringify(this.reportBeforeEdit) !== JSON.stringify(this.report)) this.pushHistory(this.reportBeforeEdit)
    this.reportBeforeEdit = null
    this.hideStyle.textContent = ''
    // 図を入れた後、タイトルを Enter で確定したら、書いていた段落の続きに戻る
    const back = this.returnTo?.from === id ? this.returnTo : null
    if (this.returnTo?.from === id) this.returnTo = null
    if (back && byKey) {
      this.hideStyle.textContent = this.editingStyle(back.id)
      this.pendingOpen = { id: back.id, caret: back.caret }
    } else if (byKey && !this.overlay.inSheet) {
      // Esc・Enter で書き終えた（PC）：書いていた紙面の欄にフォーカスを戻す（ページ全体に戻ると、どこにいたか分からなくなる）。
      // 欄がまだ紙面にない（分けたばかりの段落など）ときは、組み直してから戻す
      if (!this.focusPaper(blockPaperKey(id), true)) this.refocusKey = blockPaperKey(id)
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
    for (const t of this.shifted) {
      t.style.translate = ''
      t.style.visibility = ''
      t.style.clipPath = ''
    }
    this.shifted = []
  }

  applyFinding(finding: ReportFinding): void {
    if (!finding.blockId || finding.replacement === undefined) return
    if (this.overlay.blockId) this.overlay.commit()
    const editable = ops.findEditable(this.report, finding.blockId)
    if (!editable) return
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
      this.scroller.scrollTop = 0
      this.renderer.show(page)
    }
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
    this.refreshHighlights()
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
   * ghostOf：分けた前の段落（組み直すまで、入力欄の上に仮に表示する）。alsoHide：つなげて無くなった段落（組み直すまで隠す）
   */
  private continueWriting(id: string, caret: number, how: { ghostOf?: string; alsoHide?: string } = {}): void {
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
    this.continuing = { id, anchor: how.ghostOf ?? how.alsoHide ?? null }
    this.pendingOpen = null
    this.currentId = id
    this.selection = null
    this.reportBeforeEdit = this.report
    const hidden = this.overlay.inSheet ? [id] : [id, how.ghostOf, how.alsoHide].filter((x): x is string => !!x)
    this.hideStyle.textContent = hidden.map((x) => this.editingStyle(x)).join('\n')
    this.markSelection()
    this.shiftFollowing()
    this.afterChange({ render: 'now', save: true })
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

  private reopenAfterRender(id: string, caret: number): void {
    this.hideStyle.textContent = this.editingStyle(id)
    this.pendingOpen = { id, caret }
    this.afterChange({ render: 'now', save: true })
  }

  commitEditing(): void {
    this.overlay.commit()
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
    const target = e.target as HTMLElement
    // 抄録の「先生の許可が出た」
    if (target.closest('[data-abstract-start]')) return this.startAbstract()
    // 改ページの印：選ぶ（道具の「削除」で消せる）
    const pageBreak = target.closest<HTMLElement>('.page-break[data-block-id]')
    if (pageBreak) return this.select({ kind: 'pageBreak', id: pageBreak.dataset.blockId! })
    // 空の項目は仮の文字（::before）しかないため、文字の位置からは特定できない。クリックした要素から探す
    const clickedBlock = target.closest<HTMLElement>('[data-block-id]')?.dataset.blockId
    const hit = keyHit !== undefined ? keyHit : (this.renderer.pageView.offsetFromPoint(e.clientX, e.clientY) ?? (clickedBlock ? { blockId: clickedBlock, offset: 0 } : null))
    if (hit?.blockId === FIELD_IDS.course || target.closest(`[data-block-id="${FIELD_IDS.course}"]`)) {
      this.callbacks.onCourseClick((target.closest('[data-block-id]') ?? target).getBoundingClientRect())
      return
    }
    if (hit && ops.findEditable(this.report, hit.blockId)) {
      this.openEditor(hit.blockId, hit.offset)
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
    const near = this.overlay.inSheet && keyHit === undefined ? this.nearestEditable(e.clientX, e.clientY, 18) : null
    if (near === FIELD_IDS.course) return this.callbacks.onCourseClick(this.renderer.pageView.fragments(near)[0].getBoundingClientRect())
    if (near) return this.openEditor(near, ops.findEditable(this.report, near)?.text.length ?? 0)
    this.select(null)
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
    if (save) this.callbacks.onChange(this.report)
    if (render === 'now') void this.render()
    else {
      // 入力中も、文字の指摘はすぐに更新する（組版を待たない）
      this.runChecks()
      this.scheduleRender()
    }
    this.notify()
  }

  /** 報告書を変更する（元に戻せる） */
  update(fn: (report: Report) => Report): void {
    if (this.overlay.blockId) this.overlay.commit()
    this.pushHistory(this.report)
    this.report = fn(this.report)
    this.afterChange({ render: 'now', save: true })
  }

  undo(): void {
    if (this.overlay.blockId) this.overlay.commit()
    const previous = this.history.pop()
    if (!previous) return
    this.report = previous
    this.afterChange({ render: 'now', save: true })
  }

  /** 報告書を丸ごと入れ替える（復元・新規作成）。履歴は消す */
  replace(report: Report): void {
    if (this.overlay.blockId) this.overlay.commit()
    this.history = []
    this.report = report
    this.selection = null
    this.currentId = null
    this.afterChange({ render: 'now', save: true })
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
    this.currentId = null
    this.selection = null
    this.update((r) => applyCourseTemplate(r, this.config, courseId))
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
   * 段落などを足す位置（このブロックの後ろに入る）。
   * 書いている・最後に触ったブロックが見えているページにあればその後ろ、なければ見えているページの最後の後ろ
   */
  private insertionAnchor(): string | null {
    const view = this.renderer.pageView
    const id = this.overlay.blockId ?? this.currentId
    if (id && view.fragments(id).some((f) => view.pageIndexOf(f) === this.page)) return id
    const blocks = view.pages()[this.page]?.querySelectorAll<HTMLElement>('section.body [data-block-id]:not(.page-break)')
    return blocks?.length ? blocks[blocks.length - 1].dataset.blockId! : id
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
    if (this.overlay.blockId) this.overlay.commit()
    this.pushHistory(this.report)
    this.report = ops.insertAfter(this.report, after, block)
    this.reopenAfterRender(editId, 0)
  }

  /** 抄録を書き始めるまでは、抄録のページを PDF（印刷）に入れない（画面には、案内と「先生の許可が出た」ボタンを出す） */
  private markPrintSkip(): void {
    const skip = this.report.abstract.started === false
    this.renderer.pageView.pages().forEach((page, i) => page.classList.toggle('print-skip', skip && this.layout?.kinds[i] === 'abstract'))
  }

  /** 抄録を書き始める（先生の許可が出た）。抄録の最初の段落を開く */
  startAbstract(): void {
    if (this.report.abstract.started !== false) return
    if (this.overlay.blockId) this.overlay.commit()
    this.pushHistory(this.report)
    this.report = { ...this.report, abstract: { ...this.report.abstract, started: true } }
    const first = this.report.abstract.paragraphs[0]
    if (first) this.reopenAfterRender(first.id, 0)
    else this.afterChange({ render: 'now', save: true })
  }

  /** 改ページを入れる（足す位置の後ろ。この後ろは次のページから始まる） */
  addPageBreak(): void {
    const after = this.insertionAnchor()
    const id = ops.newId('pb')
    this.marker.hidden = true
    this.update((r) => ops.insertAfter(r, after, { type: 'pageBreak', id }))
    this.currentId = id
  }

  addParagraph(): void {
    const id = ops.newId('p')
    this.insertAndEdit({ type: 'paragraph', id, content: [{ type: 'text', text: '' }] }, id)
  }

  addSubheading(): void {
    const id = ops.newId('s')
    this.insertAndEdit({ type: 'subheading', id, title: '' }, id)
  }

  addChapter(): void {
    const after = this.insertionAnchor()
    this.marker.hidden = true
    if (this.overlay.blockId) this.overlay.commit()
    const chapter: Chapter = { id: ops.newId('c'), title: '', blocks: [{ type: 'paragraph', id: ops.newId('p'), content: [{ type: 'text', text: '' }] }] }
    this.pushHistory(this.report)
    this.report = ops.insertChapterAfter(this.report, after, chapter)
    this.reopenAfterRender(chapter.id, 0)
  }

  /**
   * 図を入れる。必ず文中の入れたい位置で入れる：段落を書いているカーソルの位置に「（図n）」を入れ、その段落のすぐ下に図を置く
   * （同じ段落の図はひとまとまり）。写真を選んだら図のタイトルの入力欄を開き、Enter で段落の続きに戻る
   */
  async addFigure(): Promise<void> {
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
    const figureId = ops.newId('f')
    this.pushHistory(this.report)
    let next = ops.insertRef(this.report, paragraphId, caret, figureId)
    next = ops.addFigureBelow(next, paragraphId, { id: figureId, imageId, caption: '' })
    this.report = next
    this.returnTo = { from: figureId, id: paragraphId, caret: ops.refEnd(next, paragraphId, figureId) }
    this.reopenAfterRender(figureId, 0)
  }

  /**
   * 表を入れる（空の表か、素材表のひな形）。図と同じく、文中の入れたい位置に「（表n）」が入り、段落のすぐ下に表が入る。
   * タイトルを書いて Enter を押すと、書いていた段落の続きに戻る
   */
  addTable(kind: 'blank' | 'material'): void {
    const paragraphId = this.editingParagraph()
    if (!paragraphId) return
    const caret = this.overlay.caret
    this.overlay.commit()
    const tableId = ops.newId('t')
    this.pushHistory(this.report)
    let next = ops.insertRef(this.report, paragraphId, caret, tableId)
    next = ops.addTableBelow(next, paragraphId, kind === 'material' ? materialTable(tableId, ops.newId) : blankTable(tableId, ops.newId))
    this.report = next
    this.returnTo = { from: tableId, id: paragraphId, caret: ops.refEnd(next, paragraphId, tableId) }
    // 仮のタイトル（素材表の「使用素材表」）があれば、その後ろから書く（前に付け足してしまわないように）
    this.reopenAfterRender(tableId, ops.findEditable(next, tableId)?.text.length ?? 0)
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
    // タイトルを書いて Enter を押したら、1枚目と同じく、その図を参照している段落の続きに戻る
    const paragraph = this.report.body.flatMap((c) => c.blocks).find((b) => b.type === 'paragraph' && b.content.some((n) => n.type === 'ref' && n.targetId === newFigure.id))
    if (paragraph) this.returnTo = { from: newFigure.id, id: paragraph.id, caret: ops.refEnd(this.report, paragraph.id, newFigure.id) }
    this.reopenAfterRender(newFigure.id, 0)
  }

  /** 段落・小見出し・大見出し（章ごと）を削除する */
  removeBlock(id: string): void {
    const editable = ops.findEditable(this.report, id)
    if (!editable) return
    this.hideStyle.textContent = ''
    this.currentId = null
    this.update((r) => (editable.kind === 'chapter' ? ops.removeChapter(r, id) : ops.removeBlock(r, id)))
  }

  removeSelected(): void {
    const s = this.selection
    if (!s || s.kind === 'photos') return
    this.selection = null
    // 図・表を消すときは、本文のその図・表への参照「（図n）」「（表n）」も一緒に消す
    this.update((r) => (s.kind === 'figure' ? ops.removeFigure(r, s.id) : s.kind === 'table' ? ops.removeTable(r, s.id) : ops.removeBlock(r, s.id)))
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
    if (this.overlay.blockId) this.overlay.commit()
    this.pushHistory(this.report)
    const { table, firstCellId } = addRow(at.table, at.row, ops.newId)
    this.report = ops.updateTable(this.report, tableId, () => table)
    this.reopenAfterRender(firstCellId, 0)
  }

  /** 書いているセルの行を消す（見出しの行と、最後の1行は残す） */
  removeTableRow(tableId: string): void {
    const at = this.currentCell(tableId)
    if (at) this.changeTable(tableId, (t) => removeRow(t, at.row))
  }

  /** 列を足す（書いているセルの列の右） */
  addTableColumn(tableId: string): void {
    const at = this.currentCell(tableId)
    if (at) this.changeTable(tableId, (t) => addColumn(t, at.column, ops.newId))
  }

  /** 書いているセルの列を消す（最後の1列は残す） */
  removeTableColumn(tableId: string): void {
    const at = this.currentCell(tableId)
    if (at) this.changeTable(tableId, (t) => removeColumn(t, at.column))
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
    if (this.overlay.blockId) this.overlay.commit()
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

  /** index 枚目の写真を外して、枠を空にする（元に戻せる） */
  removePhoto(index: number): void {
    if (this.selection?.kind === 'photos') this.selection = { kind: 'photos' }
    this.update((r) => ({ ...r, workPhotos: putPhoto(r.workPhotos, index, '') }))
  }

  /** 写真の切り抜く位置を変える（x・y は %。50 が中央） */
  setPhotoPosition(index: number, position: PhotoPosition): void {
    this.update((r) => ({ ...r, workPhotos: movePhoto(r.workPhotos, index, position) }))
  }

  // 作品写真をつかんで動かし、枠の中で見える位置を変える（つかまずに離したらクリック＝写真を選び直す）
  private photoDrag: PhotoDrag | null = null
  private suppressClick = false

  private onPhotoPointerDown(e: PointerEvent): void {
    const img = (e.target as HTMLElement).closest?.<HTMLImageElement>('[data-photo-slot] img')
    if (!img || e.button !== 0 || !img.naturalWidth) return
    const slot = img.closest<HTMLElement>('[data-photo-slot]')!
    const index = Number(slot.dataset.photoSlot)
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

  get pdfTitle(): string {
    const { studentId, name } = this.report.basicInfo
    return `${this.config.fiscalYear}_${this.config.reportName}_${studentId.trim()}_${name.replace(/[\s　]/g, '')}`
  }
}
