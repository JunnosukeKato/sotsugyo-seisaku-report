import type { YearConfig } from '../config'
import type { FigureSize } from '../layout/bodyHtml'
import { buildReportParts, COVER_SUBTITLE, fitLineFontPt, OVERFLOW_RATIO, partList, refitLineFontPt, subtitleLine } from '../layout/document'
import { FONT_SIZE_PT } from '../layout/documentCss'
import { reviseDeferredGroups, sameSet } from '../layout/figureFloat'
import { measureLayout, pageKind, samePageNumbers, type LayoutInfo, type PageKind } from '../layout/measure'
import { documentHash, firstShowPlan, loadLayoutMemory, saveLayoutMemory, usualKinds, type LayoutMemory } from '../layout/memory'
import { fitsFor, measureTableFits, readTableFits, sameTableFits, type TableFits } from '../layout/tableFit'
import type { Figure, Report } from '../model/types'
import { PageView, SENTINEL_PAGE_ATTR, type PartView } from './pageView'

export interface ImageSources {
  imageSrc: (imageId: string) => string
  photoSrc: (imageId: string) => string
  figureSize: (figure: Figure) => FigureSize
}

export type PageEffect = 'turn' | 'fade' | 'none'

/**
 * 組んだ結果。
 * - unchanged：表に出ている紙面が、すでにこの原稿の紙面だった（組み直していない。swap しない）
 * - stale：組んでいる間に原稿がまた変わったので、途中でやめた（裏側の紙面は使えない。swap しない）
 */
export interface RenderResult {
  ms: number
  layout: LayoutInfo
  unchanged?: boolean
  stale?: boolean
  /** はじめて組むとき、見せるページを先に見せた（組んだ表示枠は、もう表に出ている。swap しない：FirstShow） */
  early?: boolean
  /** 先に見せた部分を組み直すことになった（表に出ている紙面は組み直さない。もう一方の表示枠で、はじめから組み直してほしい） */
  resettle?: boolean
}

/**
 * はじめて組むとき（開いたとき）に、先に見せるページ（editor の renderFirst）。
 * 前に開いたときの組み方を覚えていれば（layout/memory.ts）、そのページのある部分を先に組み、組み終えたらすぐ表に出して onShow を呼ぶ。
 * ほかの部分は、そのあと見えないまま組む（まだ組んでいない部分には、ページの番号がずれないよう、仮のページを置く）
 */
export interface FirstShow {
  /** 先に見せるページ（0 から。全体の通しのページ） */
  page: number
  /** 先に見せた。layout：仮の紙面の情報（ページの種類は、まだ組んでいない部分の仮のページも含めた今の紙面のもの。ほかは前に開いたときのもの） */
  onShow: (page: number, layout: LayoutInfo) => void
  /**
   * 部分を1つ組み終えた（はじめて組んでいる間だけ）。pagesLeft：まだ組んでいないページの見込み（「紙面を準備しています…（あと3ページ）」）。
   * kinds：先に見せたあとなら、今の紙面のページの種類（仮のページが組んだページに替わって、ページ数が変わることがある）
   */
  onProgress?: (pagesLeft: number, kinds: PageKind[] | null) => void
}

/** 前に開いたときの組み方を覚えていないときの、先に見せている間の仮の紙面の情報（ページの種類のほか。組み終えたら正しいものになる） */
const EMPTY_LAYOUT: LayoutInfo = { kinds: [], bodyPages: 0, abstractPages: 1, abstractLines: 0, tocPageNumbers: {}, figuresPerBodyPage: [], pageBreaks: [] }

/** 組み直しの上限（図の送り方と目次のページ番号が落ち着くまで） */
const MAX_PASSES = 4

/** ページを送る動きのクラス（終わったら外す） */
const MOTION_CLASSES = ['is-under', 'is-under-current', 'turn-out', 'turn-in', 'fade-out', 'fade-in']

/** 表示枠の初めの3つの部分（表紙・抄録・目次）の数。そのあとに章ごとの部分、最後に本文の残りから後ろ（layout/document.ts の partList） */
const FRONT_PARTS = 3

/**
 * 紙面を組んだときの状態（目次のページ番号・次のページへ送った図・表紙のサブタイトルの大きさ・章を分けて組んだか・表の行の高さと左端の列の幅）。
 * これと原稿から、組む HTML が決まる
 */
interface LayoutState {
  toc: Record<string, number>
  deferred: Set<string>
  subtitle: { line: string; pt: number }
  split: boolean
  /** 行の高さを「そろえる」・左端の列を「中身に合わせる」表の、組んだ紙面で測った寸法（layout/tableFit.ts） */
  tables: TableFits
}

interface Buffer {
  element: HTMLElement
  view: PageView
  /** この表示枠の紙面を組んだときの状態と、測った紙面の情報（組み終えて落ち着いた紙面のときだけ。途中でやめた・組めなかったときは null） */
  state: LayoutState | null
  layout: LayoutInfo | null
}

/** 落ち着いた紙面の状態を覚えておく数（元に戻したときに、前と同じ組み方からすぐ始めるため） */
const STATE_CACHE_SIZE = 20

/** これまでに読み込んだ文字（書体の、文字の範囲ごとに分かれたファイルは、一度読み込めば残る） */
const loadedChars = new Set<string>()

/**
 * 報告書全体を組版し、紙面を1ページずつ表示する。
 *
 * 画面のちらつきを防ぐため、紙面の表示枠を2つ持つ（ダブルバッファ）。
 * 見えていない側で組み直し（renderBack）、組み終わったら表と裏を入れ替える（swap）。
 * 組版の間は、組版エンジンが寸法を測れるよう、裏側のすべてのページを表示しておく（.measuring）。
 * 目次のページ番号は組版した結果から読み取るため、番号が変わったときだけもう一度組み直す。
 * 段落のすぐ下に入りきらない図は次のページの上へ送る（figureFloat.ts）。送る図が変わったときも組み直す。
 * 表紙のサブタイトルが枠に入らないときも、文字を小さくして組み直す（文字の幅は書体によって違うため、組んだ紙面で測る）。
 * 行の高さを「そろえる」表・左端の列を「中身に合わせる」表も、組んだ紙面で行の高さ・列の幅を測り、変わったら組み直す（layout/tableFit.ts）。
 *
 * 速くするため（組み直しは長い原稿では数秒かかっていた）：
 * - 表紙・抄録・目次・本文の章ごと・残りを、別々に組む（layout/document.ts の buildReportParts）。表示枠に組んである部分と同じ HTML なら組み直さない
 *   （段落を書いたときはその章だけ、目次のページ番号が変わったときは目次だけを組み直す）。
 *   章ごとに組んだページのページ番号は、組んだあとで、本文の1ページ目から数えた通しの番号に直す（numberPages）。
 *   章の中身が章の終わりを越えて次のページへはみ出したときは（送った図など）、本文をまとめて組み直す（分けずに組んだときと同じ紙面にするため）
 * - 表に出ている紙面が、すでにその原稿の紙面なら、何もしない（unchanged）
 * - 裏側に残っている、ひとつ前の紙面が、その原稿の紙面なら（削除してすぐ元に戻したなど）、組まずにそのまま使う
 * - 前に組んで落ち着いた原稿なら、そのときの状態（目次の番号・送る図・サブタイトルの大きさ）から始める（組み直しの回数が減る）
 * - 表に出ている紙面に、組む文書と同じ部分があれば、組まずに借りる（組み終えて入れ替えるときに、その部分の要素を裏から表へ移す：swap）。
 *   開いたあと、もう一方の表示枠は空なので、前は、はじめて書いたときに報告書の全部を組み直していた（スマホでは十数秒、書いた文字が紙面に出なかった）
 * - 開いたとき（はじめて組むとき）：前に開いたときの組み方（この端末に覚えたもの。layout/memory.ts）から始め、見せるページのある部分を先に組んで、
 *   すぐ表に出す（FirstShow。ほかの部分は、そのあと見えないまま組む）。前は、開くたびに全ページを組み終えるまで何も見えなかった
 * 分けて組んでも、組み直しの判断（目次・図の送り方・サブタイトル）は全体を組んだときと同じで、出来上がる紙面も同じ。
 */
export class ReportRenderer {
  private readonly buffers: [Buffer, Buffer]
  private frontIndex = 0
  private tocPageNumbers: Record<string, number> = {}
  /** 前に組んだときに次のページへ送った図のまとまり（たいていそのままでよいので、次もここから始める） */
  private deferredGroups = new Set<string>()
  /** 前に組んだときの表紙のサブタイトル（1行全体）と文字の大きさ。サブタイトルが変わらなければ、次もこの大きさで組む */
  private coverSubtitle: { line: string; pt: number } | null = null
  /** 前に組んだときの表の行の高さ・左端の列の幅（表が変わらなければ、次もこの寸法で組む） */
  private tableFits: TableFits = {}
  /** 組んで落ち着いた原稿（状態によらない部分の HTML）と、そのときの状態 */
  private readonly settled = new Map<string, LayoutState>()
  /** 前に開いたときに覚えた組み方（layout/memory.ts）を、もう見たか（開いてはじめて組むときだけ使う） */
  private memoryTried = false
  /** 組み終えた裏側の紙面が、表の表示枠から借りている部分（裏側の部分の番号 → 表の部分）。表と裏を入れ替えるときに、裏へ移す（swap） */
  private borrow: { back: Buffer; lender: Buffer; parts: Map<number, PartView> } | null = null
  /** めくっている途中の動きを、すぐ終える（hurryTurn。めくっていなければ null） */
  private finishTurn: (() => void) | null = null
  /**
   * 見開き（mockups/v35 ③ 案A。PC だけ）：表示しているページ（is-current）と同じ組（1–2、3–4…）の隣のページも出す（is-pair）。
   * 組の右のページには is-right を付け、index.css で右へずらす。組を替えるときは、めくらずに、ふわっと替える
   */
  spread = false

  constructor(container: HTMLElement) {
    const make = (): Buffer => {
      const element = document.createElement('div')
      element.className = 'page-viewport'
      container.append(element)
      return { element, view: new PageView(element), state: null, layout: null }
    }
    this.buffers = [make(), make()]
    this.buffers[0].element.classList.add('front')
    hideBack(this.buffers[1].element, true)
  }

  /** いま見えている紙面 */
  get pageView(): PageView {
    return this.buffers[this.frontIndex].view
  }

  get viewport(): HTMLElement {
    return this.buffers[this.frontIndex].element
  }

  /** 覚えている組み方をすべて忘れる（次は、まっさらな状態から全体を組む。出来上がりの確かめ（e2e）で、まっさらな状態から組んだ紙面と比べるときに使う） */
  forget(): void {
    this.tocPageNumbers = {}
    this.deferredGroups = new Set()
    this.coverSubtitle = null
    this.tableFits = {}
    this.settled.clear()
    this.borrow = null
    for (const b of this.buffers) {
      b.state = null
      b.layout = null
      for (const part of b.view.parts) part.html = null
    }
  }

  /**
   * 表に出ている紙面に、組版エンジンのほかに手を加えた（作品写真をつかんで動かしたなど）。
   * この紙面は使い回さず、次にこの表示枠で組むときは組み直す
   */
  frontTouched(): void {
    const front = this.buffers[this.frontIndex]
    front.state = null
    for (const part of front.view.parts) part.html = null
  }

  /**
   * 見えていない側で組版し、紙面の情報を測る（まだ表には出さない。first を渡したときは、見せるページを先に表に出すことがある：FirstShow）。
   * stale：組んでいる途中で原稿がまた変わったか（変わっていたら、組み直しの回の区切りでやめる）
   */
  async renderBack(report: Report, config: YearConfig, sources: ImageSources, stale: () => boolean = () => false, first?: FirstShow): Promise<RenderResult> {
    const front = this.buffers[this.frontIndex]
    const back = this.buffers[1 - this.frontIndex]
    const groupIds = new Set(report.body.flatMap((c) => c.blocks).filter((b) => b.type === 'figureRow').map((b) => b.id))
    const line = subtitleLine(report, config)
    const build = (toc: Record<string, number>, deferred: ReadonlySet<string>, pt: number, split: boolean, tables: TableFits) =>
      partList(buildReportParts(report, config, { ...sources, tocPageNumbers: toc, deferredGroups: deferred, coverSubtitlePt: pt, tableFits: tables }, split))
    const docsOf = (s: LayoutState) => build(s.toc, s.deferred, s.subtitle.pt, s.split, s.tables)
    const adopt = (s: LayoutState) => {
      this.tocPageNumbers = s.toc
      this.deferredGroups = s.deferred
      this.coverSubtitle = s.subtitle
      this.tableFits = s.tables
    }
    // 表に出ている紙面が、すでにこの原稿の紙面なら、組み直さない（書く欄を開いて何も変えずに閉じた、など）
    if (front.state && front.layout && sameDocs(front.view, docsOf(front.state))) {
      adopt(front.state)
      return { ms: 0, layout: front.layout, unchanged: true }
    }
    // 組む原稿の、状態によらない部分（覚えた状態を探す手がかり。どの部分にも同じ CSS が付くので、body から後ろだけ）
    const key = build({}, new Set(), 0, true, {})
      .map((d) => d.slice(d.indexOf('<body>')))
      .join('\n')
    // 裏側に残っている紙面（ひとつ前の紙面）がこの原稿の紙面なら、そのときの状態から始める（組まずに済む。削除してすぐ元に戻したなど）。
    // そうでなくても、前に組んで落ち着いた原稿なら、そのときの状態から始める（目次の番号・送る図が初めから合っていて、組み直しの回数が減る）
    const known = back.state && sameDocs(back.view, docsOf(back.state)) ? back.state : this.settled.get(key)
    if (known) adopt(known)
    // 開いてはじめて組むとき：前に開いたときに覚えた組み方（この端末の。layout/memory.ts）から始める（同じ原稿なら、組み直しが1回で済む）
    const memory = !known && !this.memoryTried ? loadLayoutMemory() : null
    this.memoryTried = true
    if (memory) {
      // サブタイトルの文字の大きさは、サブタイトルの1行が覚えたときと同じときだけ使う（覚えているのは1行の要約だけ）
      const subtitle = { line: memory.state.subtitle.line === documentHash(line) ? line : '', pt: memory.state.subtitle.pt }
      adopt({ toc: memory.state.toc, deferred: new Set(memory.state.deferred), subtitle, split: memory.state.split, tables: readTableFits(memory.state.tables) })
    }

    let deferred = new Set([...this.deferredGroups].filter((id) => groupIds.has(id)))
    // 表の寸法：前に組んだときのもの（消した表・「中身に合わせる」に戻した表の分は除く）。組んだ紙面で測って直す
    let tables = fitsFor(report.body, this.tableFits)
    // 表紙のサブタイトルの文字の大きさ：はじめは字数から見積もり、組んだ紙面で枠に入るかを測って直す（入りきる大きさまで小さく）
    let subtitlePt = this.coverSubtitle?.line === line ? this.coverSubtitle.pt : fitLineFontPt(line, COVER_SUBTITLE)
    let subtitleTooBig = Infinity
    // 章を分けて組むか（章の中身がはみ出したら、この組み直しの間は分けない）
    let split = known?.split ?? memory?.state.split ?? true
    let docs = build(this.tocPageNumbers, deferred, subtitlePt, split, tables)
    // 開いたとき：見せるページのある部分を先に組んで見せられるか（覚えたときと同じ文書の部分は、ページ数が分かる。表紙は、いつも見せられる）
    const plan = first && !back.view.parts.some((p) => p.html !== null) ? firstShowPlan(docs, memory, first.page) : null
    /** 先に見せた部分（この表示枠は、もう表に出ている。null なら、まだ見せていない） */
    let shownPart: number | null = null
    /** 表の表示枠から借りる部分（組み上げる紙面の部分の番号 → 表の表示枠の部分。組まずに使い、表と裏を入れ替えるときに裏へ移す：swap） */
    const borrowed = new Map<number, PartView>()
    /** 組み上げる紙面の部分（裏側で組んだ部分と、表から借りる部分） */
    const assembly = () => back.view.parts.map((part, i) => borrowed.get(i) ?? part)
    /** 組み上げる紙面のページを測る（借りた部分のページも、測る間だけ出しておく。同じ処理の中で戻すので、画面には出ない） */
    const measure = <T>(fn: (pages: HTMLElement[]) => T): T => {
      const lend = borrowed.size > 0 && !front.element.classList.contains('measuring')
      if (lend) front.element.classList.add('measuring')
      try {
        return fn(assembly().flatMap((part) => part.pageElements()))
      } finally {
        if (lend) front.element.classList.remove('measuring')
      }
    }
    /** 見せるページを先に表に出す（ほかの部分は、このあと見えないまま組む） */
    const showEarly = (part: number) => {
      if (!first) return
      shownPart = part
      numberPages(back.view.pages())
      this.bringFront(back)
      this.setCurrent(back.view, first.page)
      const kinds = back.view.pages().map(pageKind)
      first.onShow(first.page, { ...(memory?.layout ?? EMPTY_LAYOUT), kinds, bodyPages: kinds.filter((k) => k === 'body').length })
    }
    /** はじめて組んでいる間：部分を1つ組み終えるたびに知らせる。覚えた組み方で先に見せられなかったときは、見せるページの部分までを順に組み終えたら見せる */
    const onPart = (i: number) => {
      if (!first) return
      if (shownPart === null) {
        const parts = back.view.parts
        // 見せるページの部分まで、前から順に組み終えている（ページ数が分かり、見せるページの位置が決まる）
        let start = 0
        for (let k = 0; k <= i && parts[k]?.html === docs[k]; k++) {
          const count = parts[k].pageElements().length
          if (first.page < start + count) {
            // まだ組んでいない後ろの部分には、仮のページを置く（数は、覚えたもの・ふつうの数。組み終えれば正しい数になる）
            parts.forEach((part, j) => {
              if (j > i && part.html === null) part.showPlaceholder(memory?.parts[j]?.kinds ?? usualKinds(j, docs.length))
            })
            showEarly(k)
            break
          }
          start += count
        }
      }
      first.onProgress?.(pagesLeft(back, docs, memory), shownPart === null ? null : back.view.pages().map(pageKind))
    }

    back.state = null
    back.layout = null
    this.borrow = null
    back.element.classList.add('measuring')
    try {
      let ms = 0
      // 組み始めに、残りのページの見込みを知らせる（「紙面を準備しています…（あと20ページほど）」。部分を組み終えるたびに減る）
      if (first) first.onProgress?.(pagesLeft(back, docs, memory), null)
      if (first && plan) {
        // まだ組んでいない部分に仮のページを置き（見せるページの番号がずれないように）、見せるページのある部分を先に組む（書体も、その部分の文字を先に読み込む）
        back.view.setPartCount(docs.length)
        back.view.parts.forEach((part, i) => part.showPlaceholder(plan.kinds[i]))
        await loadFonts(docs[plan.part])
        ms += await renderPart(back.view, docs, plan.part)
        // 見せるページが、組んだ部分の中にあれば、すぐ表に出す（その前の部分のページ数は分かっているので、位置は決まる。
        // 見せる部分が変わっていてページ数が覚えたときと違っても、後ろの部分の仮のページの数がずれるだけ。なければ、前から順に組んでから出す）
        const start = plan.kinds.slice(0, plan.part).reduce((n, k) => n + k.length, 0)
        if (first.page - start < back.view.parts[plan.part].pageElements().length) showEarly(plan.part)
        else back.view.parts.forEach((part) => part.html === null && part.removePlaceholder())
        first.onProgress?.(pagesLeft(back, docs, memory), shownPart === null ? null : back.view.pages().map(pageKind))
      }
      // 文字の範囲ごとに分かれたフォントを、組版の前に読み込んでおく（後から読み込まれると改行位置がずれる）。読み込み済みの文字は読み込まない
      await loadFonts(docs.join(''))
      let layout: LayoutInfo
      const blocked = new Set<string>()
      let fallback = false
      for (let pass = 1; ; pass++) {
        // 変わった部分だけを組む。表の表示枠に同じ文書の部分があれば、組まずに借りる。
        // 先に見せたあとは、原稿が変わっても途中でやめない（組んだ部分は、次の組み直しで借りるので、むだにならない。
        // 前は、もう一方の空の表示枠で、はじめから全部を組み直していた）
        for (;;) {
          ms += await this.assemble(back, front, docs, borrowed, first ? onPart : undefined)
          if (shownPart !== null && stale()) return { ms, layout: measure((pages) => measureLayout(pages, report.body)), stale: true, early: true }
          // 章の中身が、章の終わりを越えて次のページへはみ出した：本文をまとめて組み直す（先に見せた紙面は組み直さず、もう一方の表示枠で）
          if (!split || chaptersFit(assembly())) break
          if (shownPart !== null) return { ms, layout: measure((pages) => measureLayout(pages, report.body)), early: true, resettle: true }
          split = false
          docs = build(this.tocPageNumbers, deferred, subtitlePt, split, tables)
        }
        // 紙面の情報と、次に送る図と、表の寸法を、まとめて測る（借りた部分のページを出して測るのを、1回で済ませる）
        const measured = measure((pages) => ({
          layout: measureLayout(pages, report.body),
          next: fallback ? deferred : reviseDeferredGroups(pages, report.body, deferred, blocked),
          tables: measureTableFits(pages, report.body, tables),
        }))
        layout = measured.layout
        const tocChanged = !samePageNumbers(layout.tocPageNumbers, this.tocPageNumbers)
        if (tocChanged) this.tocPageNumbers = layout.tocPageNumbers
        let next = measured.next
        // 図の送り方が落ち着かないときは、送るのをやめて段落のすぐ下に置く（ページの下に空白が残るだけで、順番は崩れない）
        if (!fallback && pass >= MAX_PASSES && !sameSet(next, deferred)) {
          fallback = true
          next = new Set()
        }
        const ratio = layout.coverSubtitle?.ratio ?? 0
        if (ratio > OVERFLOW_RATIO) subtitleTooBig = Math.min(subtitleTooBig, subtitlePt)
        const nextPt = refitLineFontPt(subtitlePt, ratio, COVER_SUBTITLE, subtitleTooBig)
        const tablesChanged = !sameTableFits(measured.tables, tables)
        const settled = sameSet(next, deferred) && !tocChanged && nextPt === subtitlePt && !tablesChanged
        if (settled || pass >= MAX_PASSES + 2) {
          if (settled) {
            back.state = { toc: this.tocPageNumbers, deferred, subtitle: { line, pt: subtitlePt }, split, tables }
            back.layout = layout
            this.remember(key, back.state)
            // 次に開いたときのために、この端末に覚えておく（layout/memory.ts）
            saveLayoutMemory({
              v: 1,
              state: { toc: back.state.toc, deferred: [...deferred], subtitle: { line: documentHash(line), pt: subtitlePt }, split, tables },
              parts: assembly().map((part, i) => ({ hash: documentHash(docs[i]), kinds: part.pageKinds() })),
              layout,
            })
          }
          break
        }
        // 組んでいる間に原稿が変わったら、この原稿の組み直しはここでやめる（すぐ新しい原稿を組む）
        if (stale()) return { ms, layout, stale: true, early: shownPart !== null }
        deferred = next
        subtitlePt = nextPt
        tables = measured.tables
        docs = build(this.tocPageNumbers, deferred, subtitlePt, split, tables)
        // 先に見せた紙面で、見せている部分か、その前の部分（ページ数が変わると、見せているページの番号がずれる）を組み直すことになった：
        // 表に出ている紙面は組み直さず、もう一方の表示枠で、はじめから組み直す（後ろの部分だけなら、見えないまま、この表示枠で組み直す）
        if (shownPart !== null && (docs.length !== back.view.parts.length || docs.slice(0, shownPart + 1).some((d, i) => d !== back.view.parts[i].html))) {
          this.deferredGroups = deferred
          this.coverSubtitle = { line, pt: subtitlePt }
          this.tableFits = tables
          return { ms, layout, early: true, resettle: true }
        }
      }
      // ページ番号を、本文の1ページ目から数えた通しの番号にする。借りた部分のページは、表と裏を入れ替えるときに付け直す（表に出ている紙面の番号を先に変えないように）
      const lentPages = new Set([...borrowed.values()].flatMap((part) => part.pageElements()))
      numberPages(assembly().flatMap((part) => part.pageElements()), lentPages)
      this.borrow = borrowed.size > 0 ? { back, lender: front, parts: new Map(borrowed) } : null
      this.deferredGroups = deferred
      this.coverSubtitle = { line, pt: subtitlePt }
      this.tableFits = tables
      return { ms, layout, early: shownPart !== null }
    } finally {
      back.element.classList.remove('measuring')
    }
  }

  /**
   * 表示枠の部分を docs の数にそろえ、組んである文書と違う部分だけを組む。かかった時間（ミリ秒）を返す。
   * 表の表示枠（lender）に同じ文書の部分があれば、組まずに借りる（borrowed に入れる。表と裏を入れ替えるときに移す：swap）。
   * onPart：部分を1つ組み終えるたびに呼ぶ
   */
  private async assemble(back: Buffer, lender: Buffer, docs: string[], borrowed: Map<number, PartView>, onPart?: (i: number) => void): Promise<number> {
    back.view.setPartCount(docs.length)
    // 表の表示枠の部分を、組んである文書ごとに（章を足した・消したときは、同じ文書の部分の番号がずれるので、番号ではなく文書で探す）
    const lendable = new Map<string, PartView>()
    if (lender !== back) for (const part of lender.view.parts) if (part.html !== null && !lendable.has(part.html)) lendable.set(part.html, part)
    borrowed.clear()
    let ms = 0
    for (let i = 0; i < docs.length; i++) {
      if (back.view.parts[i].html === docs[i]) continue
      const lent = lendable.get(docs[i])
      if (lent) {
        borrowed.set(i, lent)
        lendable.delete(docs[i])
        continue
      }
      ms += await renderPart(back.view, docs, i)
      onPart?.(i)
    }
    return ms
  }

  private remember(key: string, state: LayoutState): void {
    this.settled.delete(key)
    this.settled.set(key, state)
    if (this.settled.size > STATE_CACHE_SIZE) this.settled.delete(this.settled.keys().next().value!)
  }

  /** 組み終えた裏側を表に出し、page ページ目（0 から）を見せる。表から借りていた部分は、裏側へ移してから入れ替える */
  swap(page: number): void {
    const back = this.buffers[1 - this.frontIndex]
    const borrow = this.borrow?.back === back ? this.borrow : null
    this.borrow = null
    if (borrow) {
      for (const [i, part] of borrow.parts) {
        const j = borrow.lender.view.parts.indexOf(part)
        if (j >= 0) back.view.exchangePart(i, borrow.lender.view, j)
      }
      // 部分を入れ替えた表示枠は、ひとつ前の紙面そのままではなくなった（その紙面の状態は使い回さない）
      borrow.lender.state = null
      borrow.lender.layout = null
      numberPages(back.view.pages())
    }
    this.setCurrent(back.view, page)
    this.bringFront(back)
  }

  /** buffer の表示枠を表に出す（もう一方は裏に回す） */
  private bringFront(buffer: Buffer): void {
    const front = this.buffers[this.frontIndex]
    if (front === buffer) return
    buffer.element.classList.add('front')
    front.element.classList.remove('front')
    hideBack(buffer.element, false)
    hideBack(front.element, true)
    this.frontIndex = this.buffers.indexOf(buffer)
    // 裏に回した表示枠に、開いたときの仮のページが残っていれば外す（まだ組んでいない部分。次にこの表示枠で組むときに組む）
    for (const part of front.view.parts) part.removePlaceholder()
  }

  pageCount(): number {
    return this.pageView.pages().length
  }

  /** めくっている途中なら、その動きをすぐ終える（続けてページ送りを押したとき。押した数だけ送るため：editor の goToPage） */
  hurryTurn(): void {
    this.finishTurn?.()
  }

  /** 表の紙面で page ページ目を見せる（動きなし。fade なら、ふわっと出す） */
  show(page: number, effect: 'none' | 'fade' = 'none'): void {
    this.setCurrent(this.pageView, page)
    if (effect === 'fade' && !reducedMotion()) fadeIn(this.shownPages(this.pageView, page))
  }

  /** 見えているページ（見開きなら、並べている2ページ） */
  private shownPages(view: PageView, page: number): HTMLElement[] {
    const pages = view.pages()
    if (!this.spread) return pages[page] ? [pages[page]] : []
    const first = page - (page % 2)
    return [pages[first], pages[first + 1]].filter((p): p is HTMLElement => !!p)
  }

  private setCurrent(view: PageView, page: number): void {
    // 見開き：同じ組（0–1、2–3…）の隣のページも出し、右のページに印を付ける
    const first = this.spread ? page - (page % 2) : -1
    view.pages().forEach((p, i) => {
      p.classList.remove(...MOTION_CLASSES)
      p.classList.toggle('is-current', i === page)
      const paired = this.spread && (i === first || i === first + 1)
      p.classList.toggle('is-pair', paired && i !== page)
      p.classList.toggle('is-right', paired && i === first + 1)
    })
    stackParts(view)
  }

  /**
   * ページを送る。隣のページは本のようにめくり、離れたページへはふわっと切り替える。
   * 動きが終わったら解決する。
   */
  turn(from: number, to: number, effect: PageEffect): Promise<void> {
    const view = this.pageView
    if (this.spread) return this.turnSpread(view, from, to, effect)
    const pages = view.pages()
    const a = pages[from]
    const b = pages[to]
    if (!a || !b || effect === 'none' || reducedMotion()) {
      this.setCurrent(view, to)
      return Promise.resolve()
    }
    let moving: HTMLElement
    if (effect === 'fade' || Math.abs(to - from) !== 1) {
      b.classList.add('is-under')
      a.classList.add('fade-out')
      moving = a
    } else if (to > from) {
      // 今のページが右端から持ち上がり、左へめくれて、下の次のページが見える
      b.classList.add('is-under')
      a.classList.add('turn-out')
      moving = a
    } else {
      // 前のページが左からめくれて戻ってくる
      a.classList.add('is-under-current')
      b.classList.add('turn-in')
      moving = b
    }
    stackParts(view)
    return new Promise((resolve) => {
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        if (this.finishTurn === finish) this.finishTurn = null
        moving.removeEventListener('animationend', onEnd)
        this.setCurrent(view, to)
        resolve()
      }
      this.finishTurn = finish
      // ページの影（::after）の動きの終わりも届くため、ページ本体の動きの終わりだけを見る
      const onEnd = (e: AnimationEvent) => {
        if (e.target === moving && !e.pseudoElement) finish()
      }
      moving.addEventListener('animationend', onEnd)
      setTimeout(finish, 1500)
    })
  }

  /**
   * 見開きのページ送り：同じ組の隣のページへ移るだけなら、紙面はそのまま（印だけ付け替える）。
   * ほかの組へは、めくらずに、並べた2ページをふわっと出す（1ページの「めくる」動きは、2ページ並べたときには合わないため）
   */
  private turnSpread(view: PageView, from: number, to: number, effect: PageEffect): Promise<void> {
    const samePair = from - (from % 2) === to - (to % 2)
    this.setCurrent(view, to)
    if (samePair || effect === 'none' || reducedMotion()) return Promise.resolve()
    fadeIn(this.shownPages(view, to))
    return new Promise((resolve) => {
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        if (this.finishTurn === finish) this.finishTurn = null
        resolve()
      }
      this.finishTurn = finish
      // ふわっと出す動き（index.css の fade-in。0.2秒）が終わるころ
      setTimeout(finish, 220)
    })
  }
}

/** ページをふわっと出す（動きが終わったら印を外す） */
function fadeIn(pages: HTMLElement[]): void {
  for (const el of pages) {
    el.classList.add('fade-in')
    el.addEventListener('animationend', () => el.classList.remove('fade-in'), { once: true })
  }
}

/** 表示枠に組んである部分が、すべて docs と同じか */
function sameDocs(view: PageView, docs: string[]): boolean {
  return view.parts.length === docs.length && docs.every((d, i) => view.parts[i].html === d)
}

/** まだ組んでいないページの見込み（仮のページを置いた部分は仮のページの数、置いていない部分は覚えた数・ふつうの数） */
function pagesLeft(back: Buffer, docs: string[], memory: LayoutMemory | null): number {
  return back.view.parts.reduce((n, part, i) => {
    if (part.html === docs[i]) return n
    const standIns = part.html === null ? part.pageElements().length : 0
    return n + (standIns || memory?.parts[i]?.kinds.length || usualKinds(i, docs.length).length)
  }, 0)
}

/** i 番目の部分を、組んである文書と違えば組む（表示枠の部分の数は、docs の数にそろえてあること） */
async function renderPart(view: PageView, docs: string[], i: number): Promise<number> {
  const part = view.parts[i]
  if (part.html === docs[i]) return 0
  const ms = await part.render(docs[i])
  if (i >= FRONT_PARTS && i < docs.length - 1) markSentinel(part)
  // 組み終えて、章の終わりの印も付けたので、仮のページ（開いたとき）をやめて、組んだページを数える
  part.removePlaceholder()
  return ms
}

/** 章ごとの部分の最後のページ（章の終わりの「次の章の始まり」の代わり）に印を付ける（表示しない・ページの一覧に入れない） */
function markSentinel(part: PartView): void {
  const pages = part.element.querySelectorAll<HTMLElement>('[data-vivliostyle-page-container]')
  const last = pages[pages.length - 1]
  if (last?.querySelector('[data-sentinel]')) last.setAttribute(SENTINEL_PAGE_ATTR, '')
}

/**
 * 章ごとの部分が、章の中だけで収まっているか：章の終わりの目印（.flow-end）のあるページのすぐ次が、「次の章の始まり」の代わりだけのページになっている。
 * 収まっていない（送った図などが、次のページへはみ出した）ときは、本文全体を組んだときと紙面が変わりうる
 * （本文全体では、はみ出したものは次の章の最初のページに載る）
 */
function chaptersFit(parts: PartView[]): boolean {
  return parts.slice(FRONT_PARTS, -1).every((part) => {
    const pages = [...part.element.querySelectorAll<HTMLElement>('[data-vivliostyle-page-container]')]
    const end = pages.findIndex((p) => p.querySelector('.flow-end'))
    const sentinel = pages[end + 1]
    return end >= 0 && pages.length === end + 2 && sentinel?.hasAttribute(SENTINEL_PAGE_ATTR) && !sentinel.querySelector('[data-block-id], figure, .figure-group, .data-table, p, h2, li')
  })
}

/**
 * 本文・引用参考文献のページのページ番号を、本文の1ページ目から数えた通しの番号にする
 * （章ごとに組んだ部分は、それぞれ1から数えている。番号の欄の大きさと位置は番号によらず同じなので、文字だけを直せば、全体を組んだときと同じ紙面になる）。
 * pages：紙面の全ページ（順に）。skip のページは直さない（表に出ている紙面から借りた部分。表と裏を入れ替えるときに直す）
 */
function numberPages(pages: HTMLElement[], skip: ReadonlySet<HTMLElement> = new Set()): void {
  const kinds = pages.map(pageKind)
  const bodyStart = kinds.indexOf('body')
  if (bodyStart < 0) return
  pages.forEach((page, i) => {
    if ((kinds[i] !== 'body' && kinds[i] !== 'references') || skip.has(page)) return
    const counter = page.querySelector('[data-vivliostyle-page-margin-box="bottom-center"] [data-vivliostyle-page-counter]')
    const n = String(i - bodyStart + 1)
    if (counter && counter.textContent !== n) counter.textContent = n
  })
}

/** 組む文書の文字のうち、まだ読み込んでいない文字の書体を読み込む */
async function loadFonts(html: string): Promise<void> {
  const text = html.replace(/<[^>]+>/g, '') + '0123456789'
  const fresh = [...new Set(text)].filter((c) => !loadedChars.has(c)).join('')
  if (!fresh) return
  await Promise.all([document.fonts.load(`${FONT_SIZE_PT}pt "BIZ UDMincho"`, fresh), document.fonts.load(`${FONT_SIZE_PT}pt "BIZ UDPGothic"`, fresh)])
  for (const c of fresh) loadedChars.add(c)
}

/**
 * ページの重なりの順（z-index）を、部分（組版エンジンごとの枠）にも付ける。
 * ページの重なりの順は、同じ部分の中でしか効かない（部分ごとに別の重なりの単位になる）ため、
 * めくっているページ・表示しているページ・下に見えるページのある部分を、その順に上へ出す
 */
function stackParts(view: PageView): void {
  for (const part of view.parts) {
    const pages = [...part.element.querySelectorAll<HTMLElement>('[data-vivliostyle-page-container]')]
    const level = Math.max(
      0,
      ...pages.map((p) => (p.matches('.turn-out, .turn-in, .fade-out') ? 3 : p.matches('.is-current, .is-pair') ? 2 : p.matches('.is-under, .is-under-current') ? 1 : 0)),
    )
    part.element.style.zIndex = String(level)
  }
}

/**
 * 裏側の表示枠（見えていない・古い内容のこともある）を、読み上げにも Tab にも出さない。
 * 出しておくと、読み上げで紙面が2回（片方は古い内容で）読まれてしまう
 */
function hideBack(element: HTMLElement, hidden: boolean): void {
  element.inert = hidden
  if (hidden) element.setAttribute('aria-hidden', 'true')
  else element.removeAttribute('aria-hidden')
}

function reducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches
}
