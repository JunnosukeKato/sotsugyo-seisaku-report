import type { YearConfig } from '../config'
import { checkReport, type ReportFinding } from '../checker/reportChecks'
import { applyFix } from '../checker/textRules'
import { FIELD_IDS } from '../layout/document'
import type { LayoutInfo } from '../layout/measure'
import { FIGURE_MAX_PX, fitFigureSize, importImage, PHOTO_MAX_PX } from '../model/images'
import { putImage, type StoredImage } from '../model/storage'
import { applyCourseTemplate, bodyWritten } from '../model/template'
import type { BodyBlock, Chapter, Report, WorkPhotoLayout } from '../model/types'
import { OverlayEditor, type OverlayKind, type OverlayPlacement, type OverlayTarget } from './overlayEditor'
import { PageStage } from './pageStage'
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

export type Selection =
  | { kind: 'figure'; id: string }
  | { kind: 'table'; id: string }
  | { kind: 'photos' }
  | null

export interface EditorSnapshot {
  report: Report
  findings: ReportFinding[]
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
  private readonly config: YearConfig
  private readonly callbacks: EditorCallbacks
  private readonly renderer: ReportRenderer
  private readonly overlay: OverlayEditor
  private readonly stage: PageStage
  private readonly scroller: HTMLElement
  private readonly layer: HTMLElement
  private readonly marker: HTMLDivElement
  private readonly hideStyle: HTMLStyleElement
  private readonly images = new Map<string, ImageEntry>()
  private readonly listeners = new Set<() => void>()
  private history: Report[] = []
  private reportBeforeEdit: Report | null = null
  private findings: ReportFinding[] = []
  private layout: LayoutInfo | null = null
  private rendering = false
  private renderAgain = false
  private renderTimer: number | undefined
  private renderMs = 0
  private pendingOpen: { id: string; caret: number } | null = null
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
      onCommit: (id, text) => {
        this.report = ops.setText(this.report, id, text)
        if (this.reportBeforeEdit && JSON.stringify(this.reportBeforeEdit) !== JSON.stringify(this.report)) this.pushHistory(this.reportBeforeEdit)
        this.reportBeforeEdit = null
        this.hideStyle.textContent = ''
        this.afterChange({ render: 'now', save: true })
      },
      onSplit: (id, before, after) => {
        this.pushHistory(this.reportBeforeEdit ?? this.report)
        const result = ops.split(ops.setText(this.report, id, before + after), id, before, after)
        this.report = result.report
        this.reopenAfterRender(result.newId, 0)
      },
      onMergeBackward: (id, text) => {
        const result = ops.mergeBackward(ops.setText(this.report, id, text), id, text)
        if (!result) {
          this.openEditor(id, 0)
          return
        }
        this.pushHistory(this.reportBeforeEdit ?? this.report)
        this.report = result.report
        this.reopenAfterRender(result.targetId, result.caret)
      },
      onNavigate: (id, text, direction) => {
        this.report = ops.setText(this.report, id, text)
        const next = ops.neighbor(this.report, id, direction)
        this.reopenAfterRender(next?.id ?? id, direction === 'prev' ? (next?.text.length ?? 0) : 0)
      },
      onPasteParagraphs: (id, paragraphs, caretInLast) => {
        this.pushHistory(this.reportBeforeEdit ?? this.report)
        const result = ops.replaceWithParagraphs(this.report, id, paragraphs)
        this.report = result.report
        this.reopenAfterRender(result.lastId, caretInLast)
      },
    })

    // 画面の大きさが変わって紙面の倍率・位置が変わったら、入力欄も合わせる
    this.stage = new PageStage(stage, () => {
      this.marker.hidden = true
      const id = this.overlay.blockId
      const placement = id ? this.overlayPlacement(id) : null
      if (placement) this.overlay.moveTo(placement)
      this.notify()
    })

    scroller.addEventListener('click', (e) => this.onClick(e))
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
    const stored = await importImage(file, ops.newId('img'), purpose === 'photo' ? PHOTO_MAX_PX : FIGURE_MAX_PX)
    await putImage(stored)
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
      this.renderer.swap(this.page)
    } finally {
      this.rendering = false
    }
    this.markSelection()
    this.runChecks()
    // 続けてもう一度組み直す場合や、開く予定の箇所がまだ紙面にない場合は、次の組版の後で開く
    if (this.pendingOpen && !this.renderAgain && this.renderer.pageView.fragments(this.pendingOpen.id).length > 0) {
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
    this.findings = checkReport(this.report, this.config, this.layout)
    this.refreshHighlights()
  }

  private refreshHighlights(): void {
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
    this.page = to
    this.scroller.scrollTop = 0
    this.turning = this.renderer.turn(from, to, effect).finally(() => {
      this.turning = null
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
      enterCreatesParagraph: editable.kind === 'chapter' || editable.kind === 'subheading',
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

  private reopenAfterRender(id: string, caret: number): void {
    this.hideStyle.textContent = this.editingStyle(id)
    this.pendingOpen = { id, caret }
    this.afterChange({ render: 'now', save: true })
  }

  /** カーソルの位置に「（図1）」などを入れる */
  insertReference(targetId: string): void {
    const n = ops.numbering(this.report)
    const label = `${n.tableIds.has(targetId) ? '表' : '図'}${n.numbers.get(targetId)}`
    this.overlay.insertText(`（${label}）`)
  }

  commitEditing(): void {
    this.overlay.commit()
  }

  // ---- クリック ----

  private onClick(e: MouseEvent): void {
    const target = e.target as HTMLElement
    // 空の項目は仮の文字（::before）しかないため、文字の位置からは特定できない。クリックした要素から探す
    const clickedBlock = target.closest<HTMLElement>('[data-block-id]')?.dataset.blockId
    const hit = this.renderer.pageView.offsetFromPoint(e.clientX, e.clientY) ?? (clickedBlock ? { blockId: clickedBlock, offset: 0 } : null)
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
    const swatch = target.closest<HTMLElement>('td[data-swatch-row]')
    if (swatch) {
      void this.setSwatch(swatch.dataset.swatchRow!)
      return
    }
    const table = target.closest('.material-table')
    if (table) {
      const caption = table.querySelector<HTMLElement>('.table-caption [data-block-id]')
      if (caption) return this.select({ kind: 'table', id: caption.dataset.blockId! })
    }
    const slot = target.closest<HTMLElement>('[data-photo-slot]')
    if (slot) {
      this.select({ kind: 'photos' })
      void this.setPhoto(Number(slot.dataset.photoSlot))
      return
    }
    if (target.closest('section.photos')) return this.select({ kind: 'photos' })
    if (target.closest('section.references')) return this.callbacks.onReferencesClick()
    this.select(null)
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
    const rowId = id.split(':')[0]
    for (const chapter of this.report.body) {
      for (const b of chapter.blocks) {
        if (b.type === 'materialTable' && (b.id === id || b.rows.some((r) => r.id === rowId))) return b.id
      }
    }
    return null
  }

  /** 選んでいる図・表に枠を付ける */
  private markSelection(): void {
    for (const el of this.viewport.querySelectorAll('.is-selected')) el.classList.remove('is-selected')
    const s = this.selection
    if (s?.kind === 'figure') this.viewport.querySelector(`figure[data-figure-id="${CSS.escape(s.id)}"]`)?.classList.add('is-selected')
    if (s?.kind === 'table') this.renderer.pageView.fragments(s.id)[0]?.closest('.material-table')?.classList.add('is-selected')
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
    const blocks = view.pages()[this.page]?.querySelectorAll<HTMLElement>('section.body [data-block-id]')
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
    const block = (last.closest('figure, .material-table, h1, h2, p') as HTMLElement | null) ?? last
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

  async addFigure(): Promise<void> {
    // 写真を選んでいる間に入力欄が閉じるため、入れる位置を先に決めておく
    const after = this.insertionAnchor()
    this.marker.hidden = true
    const imageId = await this.importImage('figure')
    if (!imageId) return
    const figureId = ops.newId('f')
    this.insertAndEdit({ type: 'figureRow', id: ops.newId('r'), figures: [{ id: figureId, imageId, caption: '' }] }, figureId, after)
  }

  addMaterialTable(): void {
    const tableId = ops.newId('t')
    this.insertAndEdit({ type: 'materialTable', id: tableId, caption: '使用素材表', rows: [{ id: ops.newId('m'), name: '', usage: '', swatchImageId: null }] }, `${tableId}`)
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
  async addFigureBeside(figureId: string): Promise<void> {
    const imageId = await this.importImage('figure')
    if (!imageId) return
    const newFigure = { id: ops.newId('f'), imageId, caption: '' }
    this.pushHistory(this.report)
    this.report = {
      ...this.report,
      body: this.report.body.map((c) => ({
        ...c,
        blocks: c.blocks.map((b) =>
          b.type === 'figureRow' && b.figures.some((f) => f.id === figureId) && b.figures.length < 2 ? { ...b, figures: [...b.figures, newFigure] } : b,
        ),
      })),
    }
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
    this.update((r) => ops.removeBlock(r, s.id))
  }

  addTableRow(tableId: string): void {
    const rowId = ops.newId('m')
    this.pushHistory(this.report)
    this.report = {
      ...this.report,
      body: this.report.body.map((c) => ({
        ...c,
        blocks: c.blocks.map((b) => (b.type === 'materialTable' && b.id === tableId ? { ...b, rows: [...b.rows, { id: rowId, name: '', usage: '', swatchImageId: null }] } : b)),
      })),
    }
    this.reopenAfterRender(`${rowId}:name`, 0)
  }

  removeTableRow(tableId: string): void {
    this.update((r) => ({
      ...r,
      body: r.body.map((c) => ({
        ...c,
        blocks: c.blocks.map((b) => (b.type === 'materialTable' && b.id === tableId && b.rows.length > 1 ? { ...b, rows: b.rows.slice(0, -1) } : b)),
      })),
    }))
  }

  async setSwatch(rowId: string): Promise<void> {
    const imageId = await this.importImage('swatch')
    if (!imageId) return
    this.update((r) => ({
      ...r,
      body: r.body.map((c) => ({
        ...c,
        blocks: c.blocks.map((b) => (b.type === 'materialTable' ? { ...b, rows: b.rows.map((row) => (row.id === rowId ? { ...row, swatchImageId: imageId } : row)) } : b)),
      })),
    }))
  }

  // ---- 作品写真 ----

  setPhotoLayout(layout: WorkPhotoLayout): void {
    this.update((r) => ({ ...r, workPhotos: { layout, imageIds: r.workPhotos.imageIds.slice(0, layout) } }))
  }

  async setPhoto(index: number): Promise<void> {
    const imageId = await this.importImage('photo')
    if (!imageId) return
    this.update((r) => {
      const imageIds = [...r.workPhotos.imageIds]
      imageIds[index] = imageId
      return { ...r, workPhotos: { ...r.workPhotos, imageIds: imageIds.map((x) => x ?? '') } }
    })
  }

  removePhoto(index: number): void {
    this.update((r) => ({ ...r, workPhotos: { ...r.workPhotos, imageIds: r.workPhotos.imageIds.map((x, i) => (i === index ? '' : x)) } }))
  }

  // ---- 印刷（PDF に保存） ----

  private beforePrint(): void {
    if (this.overlay.blockId) this.overlay.commit()
    for (const h of Object.values(this.highlights)) h.clear()
    for (const el of this.viewport.querySelectorAll('.is-selected')) el.classList.remove('is-selected')
  }

  get pdfTitle(): string {
    const { studentId, name } = this.report.basicInfo
    return `${this.config.fiscalYear}_${this.config.reportName}_${studentId.trim()}_${name.replace(/[\s　]/g, '')}`
  }
}
