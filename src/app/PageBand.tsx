import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import type { EditorSnapshot, ReportEditor } from '../editor/reportEditor'
import { editables } from '../editor/reportOps'
import { FIELD_IDS, ABSTRACT_LOCK_TEXT } from '../layout/document'
import { BAND_SIDE_QUERY, paragraphHint, photoBand, photoToolsAtSide, todoBand, type BandTodo } from './bandText'
import { SelectionTools } from './Palette'
import { useBandSide } from './uiShared'

/**
 * スマホ：紙面の中の小さな案内とボタンを、紙面の下の帯に、ふつうの文字の大きさで出す（mockups/v32 ④ 案A）。
 * 紙面は画面の幅に合わせて縮めているので、紙面の中の案内（「（クリックして写真を選ぶ）」・抄録の「先生の許可が出た」など）は
 * 6px ほどになり、指で広げることもできなかった。紙面には小さな印（↓・＋）だけを残す（印の見た目は index.css の「v32 ④」。
 * 抄録の ↓ は、帯が紙面の右に出る横向きでは → にする）。
 * - 抄録を書き始める前：抄録の説明と「先生の許可が出た（抄録を書き始める）」
 * - 作品写真のページに空いている枠：「下の枠に、まだ写真がありません」と「写真を選ぶ」
 * - まだ書いていない欄（ひな形の段落・見出し・表紙の項目など）・写真を入れていない図の枠：いちばん上の所の言葉と「書く」「写真を選ぶ」
 * 帯は紙面の外の部品なので、PDF・印刷には出ない。横向きのスマホでは、紙面の右に出す（紙面の下に出すと、紙面がとても小さくなるため）。
 * 書いている間（下の書く欄）・図や表を選んでいる間・はじめての案内の間は出さない。
 * 横向きの作品写真のページでは、帯と作品写真の道具（並べ方・選んだ写真の道具）を、紙面の右の列に縦に並べる（mockups/v33 案A。SideColumn）
 */

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)
const Mark = {
  down: svg(<path d="M12 5v13M6.5 12.5L12 18l5.5-5.5" />),
  plus: svg(<path d="M12 5v14M5 12h14" />),
}

/** 帯に出すもの */
type Band =
  | { kind: 'abstract' }
  | { kind: 'photos'; text: string; index: number }
  | { kind: 'fields'; todo: BandTodo; text: string; sub: string | null; button: string }

/** 紙面と帯の間・帯と下の道具の間（画面の px） */
const GAP = 10

/** いま見ているページの帯（出すものがなければ null） */
function bandOf(editor: ReportEditor, snap: EditorSnapshot): Band | null {
  const kind = snap.layout?.kinds[snap.page]
  if (kind === 'abstract' && snap.report.abstract.started === false) return { kind: 'abstract' }
  if (kind === 'photos') {
    const photo = photoBand(snap.report.workPhotos)
    return photo && { kind: 'photos', ...photo }
  }
  // まだ書いていない欄（空の欄は、紙面に仮の文字（data-placeholder）を出している）と、写真を入れていない図の枠。紙面の上から順に
  const page = editor.pageElements()[snap.page]
  if (!page) return null
  const kinds = new Map(editables(snap.report).map((e) => [e.id, e.kind]))
  const todos = [...page.querySelectorAll<HTMLElement>('figure[data-empty-figure], [data-block-id][data-placeholder]:empty')].flatMap((el): BandTodo[] => {
    if (el.tagName === 'FIGURE') return el.dataset.figureId ? [{ kind: 'figure', id: el.dataset.figureId }] : []
    // 画像（生地見本など）を入れた表のセルは、文字がなくても空いている所にしない（紙面にも仮の文字を出さない。index.css）
    if (el.closest('[data-cell-id]')?.querySelector('img')) return []
    const id = el.dataset.blockId!
    if (id === FIELD_IDS.course) return [{ kind: 'course', id }]
    const editable = kinds.get(id)
    return editable ? [{ kind: 'field', id, editable, hint: paragraphHint(snap.report, id) }] : []
  })
  if (!todos.length) return null
  return { kind: 'fields', todo: todos[0], ...todoBand(todos[0], todos.length - 1) }
}

/**
 * 帯を置く。縦向き：紙面の下（ページ送り・選んでいる物の道具のすぐ上）。横向き：紙面の右（下の道具に重ならない高さの真ん中）。
 * 縦向きのときは、帯の分だけ紙面を上に寄せる幅（台の --inset-band）を返す
 */
function place(band: HTMLElement, stage: HTMLElement): number {
  const st = stage.getBoundingClientRect()
  // 画面の下の道具（ページ送り・選んでいる物の道具。どちらも画面に固定して置いている）
  const bars = [...document.querySelectorAll<HTMLElement>('.pager, .sel-bar > *')].map((e) => e.getBoundingClientRect()).filter((r) => r.height > 0)
  if (!matchMedia(BAND_SIDE_QUERY).matches) {
    const above = st.bottom - Math.min(st.bottom, ...bars.map((r) => r.top)) + GAP
    band.style.top = ''
    band.style.maxHeight = ''
    band.style.bottom = `${above}px`
    return above + band.offsetHeight + GAP
  }
  band.style.bottom = ''
  band.style.maxHeight = ''
  band.style.top = `${GAP}px`
  const b = band.getBoundingClientRect()
  const limit = Math.min(st.bottom, ...bars.filter((r) => r.left < b.right && r.right > b.left).map((r) => r.top)) - GAP
  const room = Math.max(0, limit - st.top - GAP)
  band.style.maxHeight = `${room}px`
  band.style.top = `${GAP + Math.max(0, (room - band.offsetHeight) / 2)}px`
  return 0
}

/** 紙面のその所を押したのと同じことをする（書く欄を開く・コースを選ぶ・写真を選ぶ。紙面を押したときの動きを、そのまま使う） */
function tapPaper(editor: ReportEditor, todo: BandTodo): void {
  const page = editor.pageElements()[editor.getSnapshot().page]
  const selector = todo.kind === 'figure' ? `figure[data-figure-id="${CSS.escape(todo.id)}"] .figure-slot` : `[data-block-id="${CSS.escape(todo.id)}"]`
  const el = page?.querySelector<HTMLElement>(selector)
  if (!el) return
  const r = el.getBoundingClientRect()
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: r.left + Math.min(r.width / 2, 20), clientY: r.top + r.height / 2 }))
}

/**
 * 帯の部品。inColumn：横向きの作品写真のページで、紙面の右の列（SideColumn）の中に置く（列が置き場所を決めるので、ここでは置かない）
 */
function BandView({ editor, band, inColumn }: { editor: ReportEditor; band: Band; inColumn?: boolean }) {
  const ref = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLElement | null>(null)
  // 帯を出している間だけ、台に印（data-band）を付けて紙面の中の案内を小さな印にし、帯の分だけ紙面を上に寄せる。帯を消したら元に戻す
  useLayoutEffect(() => {
    const stage = ref.current?.closest<HTMLElement>('.stage') ?? null
    stageRef.current = stage
    return () => {
      if (!stage) return
      delete stage.dataset.band
      stage.style.removeProperty('--inset-band')
      editor.refitPage()
    }
  }, [editor])
  // 描くたびに置き直す（帯の中身・画面の向き・下の道具が変わるため）。紙面を寄せる幅が変わったときだけ、紙面の倍率を求め直す
  useLayoutEffect(() => {
    const el = ref.current
    const stage = stageRef.current
    if (!el || !stage) return
    stage.dataset.band = band.kind
    const inset = inColumn ? '0px' : `${Math.round(place(el, stage))}px`
    if (stage.style.getPropertyValue('--inset-band') !== inset) {
      stage.style.setProperty('--inset-band', inset)
      editor.refitPage()
    }
  })

  if (band.kind === 'abstract') {
    return (
      <section className="page-band" aria-label="このページの案内" ref={ref}>
        <div className="t">
          {/* 紙面の印と同じ向きの矢印（縦向きは ↓、帯が紙面の右に出る横向きは →。向きは index.css） */}
          <span className="mk mk-dir">{Mark.down}</span>
          <span>{ABSTRACT_LOCK_TEXT.title}</span>
        </div>
        <p>{ABSTRACT_LOCK_TEXT.note}</p>
        <button onClick={() => editor.startAbstract()}>{ABSTRACT_LOCK_TEXT.button}</button>
      </section>
    )
  }
  const { text, sub, button, run }: { text: string; sub: string | null; button: string; run: () => void } =
    band.kind === 'photos'
      ? {
          text: band.text,
          sub: null,
          button: '写真を選ぶ',
          run: () => {
            // 紙面の空いている枠を押したときと同じ（写真を選ぶ画面を開く）
            editor.select({ kind: 'photos' })
            void editor.setPhoto(band.index)
          },
        }
      : { text: band.text, sub: band.sub, button: band.button, run: () => tapPaper(editor, band.todo) }
  return (
    <section className="page-band row" aria-label="このページの案内" ref={ref}>
      <div className="t">
        <span className="mk">{Mark.plus}</span>
        <span>
          {text}
          {sub && <small>{sub}</small>}
        </span>
      </div>
      <button onClick={run}>{button}</button>
    </section>
  )
}

/** 紙面と右の列の間（帯を紙面の右に出すときと同じ。index.css）・ページ送りと右の列の間（画面の px） */
const SIDE_PAGE_GAP = 18
const SIDE_PAGER_GAP = 12
/** 右の列のいちばん広い幅（帯を紙面の右に出すときと同じ。index.css） */
const SIDE_MAX_W = 380

/**
 * 右の列を置く：紙面の右から 18px、ページ送りより右（ページ送りに重ならないので、列は台の上から下まで使える）。
 * 幅は画面の右から 10px まで（いちばん広くて 380px）。上下は CSS で決める（台の上下から 10px。index.css の「v33」）
 */
function placeSide(col: HTMLElement, stage: HTMLElement): void {
  const st = stage.getBoundingClientRect()
  // 紙面の右の端（台の中の位置。紙面の倍率と位置は editor/pageStage.ts が台に書き込む）
  const pageRight = parseFloat(stage.style.getPropertyValue('--page-left')) + parseFloat(stage.style.getPropertyValue('--page-w'))
  const pager = document.querySelector('.pager')?.getBoundingClientRect()
  const left = Math.max(Number.isFinite(pageRight) ? pageRight + SIDE_PAGE_GAP : 0, pager?.width ? pager.right - st.left + SIDE_PAGER_GAP : 0)
  col.style.left = `${left}px`
  col.style.width = `${Math.max(0, Math.min(SIDE_MAX_W, st.width - GAP - left))}px`
  // 中身が列に入りきらない（とても低い画面）ときだけ、列の中を上下に動かせるようにする（ふだんは札の影を切らないよう、動かせるようにしない）
  col.classList.remove('scroll')
  col.classList.toggle('scroll', col.scrollHeight > col.clientHeight + 1)
}

/**
 * 横向きのスマホの、作品写真のページの右の列（mockups/v33 案A）。上から：帯（空いている枠があるとき）・作品写真の道具。
 * 道具は下の道具と同じもの（SelectionTools）：何も選んでいないときは「並べ方」（3列×2段）、写真を押して選んでいるときは「この写真」の道具。
 * 紙面は今の大きさのまま、何にも隠れない（前は、下の並べ方の道具が紙面の大半を隠し、写真を見ながら選べなかった）
 */
function SideColumn({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  // 描くたびに置き直す（紙面の大きさ・ページ送りの幅・画面の向きが変わるため）
  useLayoutEffect(() => {
    const el = ref.current
    const stage = el?.closest<HTMLElement>('.stage')
    if (el && stage) placeSide(el, stage)
  })
  // ページ送りの幅だけが変わったとき（文字の書体が届いたときなど）も置き直す
  useEffect(() => {
    const el = ref.current
    const stage = el?.closest<HTMLElement>('.stage')
    const pager = document.querySelector('.pager')
    if (!el || !stage || !pager) return
    const observer = new ResizeObserver(() => placeSide(el, stage))
    observer.observe(pager)
    return () => observer.disconnect()
  }, [])
  return (
    <div className="page-side" ref={ref}>
      {children}
    </div>
  )
}

/**
 * スマホの紙面の下の帯。hidden：はじめての案内を出している間など。
 * 横向きの作品写真のページでは、帯と作品写真の道具を、紙面の右の列に縦に並べる（mockups/v33 案A。このときは下の道具に出さない：Phone.tsx）
 */
export function PageBand({ editor, snap, hidden }: { editor: ReportEditor; snap: EditorSnapshot; hidden?: boolean }) {
  const side = useBandSide()
  const kind = snap.layout?.kinds[snap.page]
  const quiet = hidden || !snap.layout || !!snap.editingId || snap.zoomed || (!!snap.selection && kind !== 'photos')
  const band = quiet ? null : bandOf(editor, snap)
  if (photoToolsAtSide(snap, side)) {
    return (
      <SideColumn>
        {band && <BandView editor={editor} band={band} inColumn />}
        <SelectionTools editor={editor} snap={snap} phone />
      </SideColumn>
    )
  }
  return band ? <BandView editor={editor} band={band} /> : null
}
