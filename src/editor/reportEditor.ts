import type { YearConfig } from '../config'
import { checkReport, type ReportFinding } from '../checker/reportChecks'
import { applyFix } from '../checker/textRules'
import { FIELD_IDS } from '../layout/document'
import type { LayoutInfo } from '../layout/measure'
import { FIGURE_MAX_PX, fitFigureSize, importImage, PHOTO_MAX_PX } from '../model/images'
import { putImage, type StoredImage } from '../model/storage'
import type { BodyBlock, Chapter, Report, WorkPhotoLayout } from '../model/types'
import { OverlayEditor, type OverlayKind, type OverlayTarget } from './overlayEditor'
import * as ops from './reportOps'
import { ReportRenderer } from './reportRenderer'

/**
 * 報告書の編集の中核（画面の部品から独立した、紙面まわりの処理）。
 * - 報告書データと「元に戻す」の履歴を持つ
 * - 紙面を組版して表示し、クリックした箇所に入力欄を重ねる
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
  private readonly viewport: HTMLElement
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
  private version = 0
  private snapshotCache: EditorSnapshot | null = null
  private readonly highlights = { error: new Highlight(), warning: new Highlight(), focus: new Highlight() }

  constructor(viewport: HTMLElement, layer: HTMLElement, config: YearConfig, report: Report, callbacks: EditorCallbacks) {
    this.viewport = viewport
    this.config = config
    this.report = report
    this.callbacks = callbacks
    this.renderer = new ReportRenderer(viewport)
    this.hideStyle = document.createElement('style')
    document.head.append(this.hideStyle)
    CSS.highlights.set('issue-error', this.highlights.error)
    CSS.highlights.set('issue-warning', this.highlights.warning)
    CSS.highlights.set('issue-focus', this.highlights.focus)

    this.overlay = new OverlayEditor(layer, viewport, {
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

    viewport.addEventListener('click', (e) => this.onClick(e))
    window.addEventListener('beforeprint', () => this.beforePrint())
    window.addEventListener('afterprint', () => this.refreshHighlights())
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
    const scrollTop = this.viewport.scrollTop
    const image = (id: string) => this.images.get(id)
    try {
      const result = await this.renderer.render(this.report, this.config, {
        imageSrc: (id) => image(id)?.url ?? this.placeholderImage,
        photoSrc: (id) => image(id)?.url ?? this.placeholderImage,
        figureSize: (f) => {
          const img = image(f.imageId)
          return img ? fitFigureSize(img, FIGURE_MAX_MM) : { widthMm: 60, heightMm: 45 }
        },
      })
      this.renderMs = result.ms
      this.layout = result.layout
    } finally {
      this.viewport.scrollTop = scrollTop
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
      const target = this.overlayTarget(this.overlay.blockId, 0)
      if (target) this.overlay.moveTo(target.rect)
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

  /** 指摘の箇所へ移動する（文字の指摘なら入力欄を開く） */
  goToFinding(finding: ReportFinding): void {
    if (finding.blockId) {
      const fragment = this.renderer.pageView.fragments(finding.blockId)[0]
      fragment?.scrollIntoView({ block: 'center' })
      if (fragment && ops.findEditable(this.report, finding.blockId)) {
        requestAnimationFrame(() => this.openEditor(finding.blockId!, finding.start ?? 0))
      }
      return
    }
    this.scrollToArea(finding.area)
  }

  scrollToArea(area: string): void {
    const index = this.layout?.kinds.indexOf(area as never) ?? -1
    this.renderer.pageView.pages()[index]?.scrollIntoView({ block: 'start' })
  }

  scrollToPage(index: number): void {
    this.renderer.pageView.pages()[index]?.scrollIntoView({ block: 'start' })
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

  private overlayTarget(id: string, caret: number): OverlayTarget | null {
    const editable = ops.findEditable(this.report, id)
    const fragment = this.renderer.pageView.fragments(id)[0]
    if (!editable || !fragment) return null
    const kind = this.overlayKind(editable.kind)
    if (kind === 'paragraph') {
      const r = fragment.getBoundingClientRect()
      return { blockId: id, kind, text: editable.text, caret, rect: { left: r.left, top: r.top, right: r.right }, styleSource: fragment }
    }
    // 見出し・図のタイトル・表紙の項目・表のセル：入力部分の左端から、行（セル）の右端まで
    const box = (fragment.closest('td, h1, h2, figcaption, p, .el') as HTMLElement | null) ?? fragment
    const own = fragment.getBoundingClientRect()
    const boxRect = box.getBoundingClientRect()
    const left = kind === 'cell' ? boxRect.left + 2 : own.left
    const right = Math.max(boxRect.right - (kind === 'cell' ? 2 : 0), own.left + 120)
    return {
      blockId: id,
      kind,
      text: editable.text,
      caret,
      rect: { left, top: kind === 'cell' ? own.top : boxRect.top, right },
      styleSource: fragment,
      enterCreatesParagraph: editable.kind === 'chapter' || editable.kind === 'subheading',
    }
  }

  openEditor(id: string, caret: number): void {
    const target = this.overlayTarget(id, caret)
    if (!target) return
    if (this.overlay.blockId && this.overlay.blockId !== id) this.overlay.commit()
    this.currentId = id
    this.selection = null
    this.markSelection()
    this.reportBeforeEdit = this.report
    this.hideStyle.textContent = `[data-block-id="${CSS.escape(id)}"] { visibility: hidden !important; }`
    this.overlay.open(target)
    this.refreshHighlights()
    this.notify()
  }

  private reopenAfterRender(id: string, caret: number): void {
    this.hideStyle.textContent = `[data-block-id="${CSS.escape(id)}"] { visibility: hidden !important; }`
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
    if (figure) return this.select({ kind: 'figure', id: figure.dataset.figureId! })
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

  // ---- ブロックの追加 ----

  private insertAndEdit(block: BodyBlock, editId: string): void {
    const after = this.overlay.blockId ?? this.currentId
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
    const after = this.overlay.blockId ?? this.currentId
    if (this.overlay.blockId) this.overlay.commit()
    const chapter: Chapter = { id: ops.newId('c'), title: '', blocks: [{ type: 'paragraph', id: ops.newId('p'), content: [{ type: 'text', text: '' }] }] }
    this.pushHistory(this.report)
    this.report = ops.insertChapterAfter(this.report, after, chapter)
    this.reopenAfterRender(chapter.id, 0)
  }

  async addFigure(): Promise<void> {
    const after = this.overlay.blockId ?? this.currentId
    const imageId = await this.importImage('figure')
    if (!imageId) return
    const figureId = ops.newId('f')
    this.currentId = after
    this.insertAndEdit({ type: 'figureRow', id: ops.newId('r'), figures: [{ id: figureId, imageId, caption: '' }] }, figureId)
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
