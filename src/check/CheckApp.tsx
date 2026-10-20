import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { BusyLabel, Spinner } from '../app/Busy'
import { useSlow } from '../app/useBusy'
import { Modal } from '../app/dialogs'
import { useDialogFocus } from '../app/useDialogFocus'
import { currentConfig, type YearConfig } from '../config'
import { loadConfig } from '../config/remote'
import type { BuiltPdf, SaveMode } from '../pdf/exportPdf'
import { CheckIcon as I } from './icons'
import { locateFindings, pagePins } from './locate'
import { chooseThumbWidth, isNotedRow, pageSlots, type PageSlot, type Segment } from './pageGrid'
import { maxPhotos, PHOTOS_PER_PAGE, photoPages } from './pageFit'
import { abstractLines, bodyPages, classifyPdf, pdfFindings, pdfLooksLike, pdfOks, type PdfFacts } from './pdfFacts'
import {
  PART_NAMES,
  PARTS,
  confirmText,
  fileKind,
  groupByPart,
  idAndName,
  isStale,
  mergedFileName,
  partFromName,
  placeFor,
  slotLabel,
  staleFinding,
  timeText,
  wrongPartFinding,
  type CheckFinding,
  type FileKind,
  type PartId,
  type PartInfo,
  type SlotKind,
} from './parts'
import type { PreparedPhoto } from './photo'
import type { WordReading } from './wordCheck'

/**
 * 提出前チェック（check.html。mockups/v30 案C2「ページを見せる＋指摘は右に」）。
 * Word のひな形で書いている学生が、Word・Word から保存した PDF・作品写真を入れると、Word を確かめ（学生用ツールのセルフチェックと同じ決まり）、
 * PDF から分かること（ページの数・A4・ページ番号）を確かめ、表紙 → 抄録 → 目次 → 本文 → 作品写真 の順に1つの PDF にまとめて保存する。
 * ファイルはこの端末の中だけで読む（どこにも送らない。ログインもしない）。読む部品（pdf.js・pdf-lib・Word の読み取り）は、使うときに読み込む
 */

// ---- 使うときに読み込む部品 ----
const loadPdf = () => import('./pdfjs')
const loadMerge = () => import('./merge')
const loadWord = () => import('./wordCheck')
const loadPhoto = () => import('./photo')
const loadSaver = () => import('../pdf/exportPdf')

const LOAD_ERROR = '読む部品を読み込めませんでした。インターネットにつながっているかを確かめ、ページを読み込み直してください。'

// ---- 入れたファイル ----

/** 置き場所に入れたファイル1つ */
interface Entry {
  id: number
  file: File
  kind: FileKind
  /** ready：使える、error：読めない・まとめられない（message に理由） */
  state: 'ready' | 'error'
  message?: string
  /** PDF から分かったこと */
  facts?: PdfFacts
  /** 作品写真の写真（並べた順。入れた順に4枚ずつ A4 のページに並べる。file は1枚目。mockups/v38 案1） */
  photos?: PhotoItem[]
  /** 写真を並べたページの絵（ページごと。data URL） */
  pageImages?: string[]
  /** ページの小さな絵（URL。作れなかったページは空） */
  thumbs: string[]
  /** 中身からはっきり分かるパート（入れた場所と違えば知らせる。言えなければ null） */
  looksLike?: PartId | null
}

/** 作品写真の写真1枚 */
interface PhotoItem {
  id: number
  file: File
  photo: PreparedPhoto
}

/** 入れたときの知らせ。info：ただの知らせ（入れ替えた など）。ほかは注意（入れられなかった・古いファイル など） */
interface Note {
  text: string
  info?: boolean
}

type SlotKey = `${PartId}:${SlotKind}`
type Slots = Partial<Record<SlotKey, Entry>>
const keyOf = (part: PartId, slot: SlotKind): SlotKey => `${part}:${slot}`

/** まとめるもの（読めた PDF・写真） */
const mergeEntry = (slots: Slots, part: PartId): Entry | null => {
  const e = slots[keyOf(part, 'pdf')]
  return e && e.state === 'ready' ? e : null
}
const pagesOf = (e: Entry | null) => (e ? (e.facts?.pages.length ?? (e.photos ? photoPages(e.photos).length : 0)) : 0)

/**
 * 読めなかった Word の知らせ。入れた場所と中身が違う Word（例：本文に入れた表紙の Word）は、「中身が〇〇のようです」の指摘を出すので、
 * 読み取りの失敗としては出さない（2回数えない。「04_本文.docx を入れてください」のような、学生のファイル名と違う言葉も出さない）
 */
const wordError = (slots: Slots, check: { wordErrors: Partial<Record<PartId, string>> }, part: PartId): string | undefined => {
  const e = slots[keyOf(part, 'word')]
  return e?.looksLike && e.looksLike !== part ? undefined : check.wordErrors[part]
}

/** 確かめた結果 */
interface CheckState {
  findings: CheckFinding[]
  /** Word を入れて、確かめた */
  hasWord: boolean
  /** どのファイル（checkKey）と設定で確かめた結果か（ファイルが変わったあと、確かめ終わるまでは「確かめています」） */
  forKey: string
  forConfig: YearConfig | null
  /** 読めなかった Word（パートごと） */
  wordErrors: Partial<Record<PartId, string>>
  /** PDF だけのとき、そろっていること */
  oks: { label: string; value: string }[]
  studentId?: string
  name?: string
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'confirm'; title: string; sub: string[] }
  | { kind: 'merging' }
  | { kind: 'done'; pdf: BuiltPdf; mode: SaveMode; size: string; saved: '' | 'shared' | 'fallback' }
  | { kind: 'error'; message: string }

/** 画面の幅が狭い（スマホ。check.css の @media と同じ幅） */
function useNarrow(): boolean {
  const query = '(max-width: 760px)'
  const [narrow, setNarrow] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const m = matchMedia(query)
    const on = () => setNarrow(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return narrow
}

/** 「動きを減らす」設定のときは、すっと動かさず、すぐに移す */
const scrollBehavior = (): ScrollBehavior => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth')

/** ファイル名（行を分けるときは「_」のあとで分ける。oneLine：1行に収め、入りきらなければ「…」にする（パートの見出しの下。高さがそろわなくなるため）） */
function FileName({ name, oneLine = false }: { name: string; oneLine?: boolean }) {
  if (oneLine) return <span className="fn">{name}</span>
  const parts = name.split('_')
  return (
    <span className="fn">
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && (
            <>
              _<wbr />
            </>
          )}
        </span>
      ))}
    </span>
  )
}

/** 英字で終わる言葉（「本文の PDF」）のあとに言葉を続けるときは、空けて読みやすくする */
const spaced = (label: string) => (/[A-Za-z]$/.test(label) ? `${label} ` : label)

const Ok = () => <span className="st ok">{I.check}</span>
const Wn = () => <i className="st wn" aria-hidden="true" />

/** 「Word のほうが新しい」の知らせ（行を分けるときは、言葉の切れ目で分ける） */
const STALE = (
  <>
    <span className="nb">PDF が Word より</span>
    <span className="nb">古いようです</span>
  </>
)

export function CheckApp() {
  const [config, setConfig] = useState<YearConfig>(currentConfig)
  /** 作品写真のページ数の上限（年度の設定。null は上限なし）。ファイルを入れる処理（落としたときにも使う）から、いつも新しい設定を読むため */
  const maxPagesRef = useRef<number | null>(null)
  maxPagesRef.current = config.workPhotos?.maxPages ?? null
  const [slots, setSlotsState] = useState<Slots>({})
  const slotsRef = useRef<Slots>({})
  const docs = useRef(new Map<number, PDFDocumentProxy>())
  const nextId = useRef(0)
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [announce, setAnnounce] = useState('')
  const [check, setCheck] = useState<CheckState>({ findings: [], hasWord: false, forKey: '', forConfig: null, wordErrors: {}, oks: [] })
  const [selected, setSelected] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [help, setHelp] = useState(false)
  /** 「はじめから」を押した（確かめの窓） */
  const [askStartOver, setAskStartOver] = useState(false)
  const [menu, setMenu] = useState<{ key: SlotKey; rect: DOMRect } | null>(null)
  /** 作品写真の「並べ替え・外す」の小さな窓（開いたボタンの位置） */
  const [photoMenu, setPhotoMenu] = useState<DOMRect | null>(null)
  const [manual, setManual] = useState({ studentId: '', name: '' })
  const [dragging, setDragging] = useState(false)
  const narrow = useNarrow()
  const fileInput = useRef<HTMLInputElement>(null)
  /** ファイルを選ぶ画面で選んだファイルを入れる場所（「PDF を入れ替える」「写真を入れる」。ふだんは名前と中身で分ける） */
  const pickTarget = useRef<{ part: PartId; slot: SlotKind } | undefined>(undefined)
  const wordCache = useRef<{ key: string; config: YearConfig; reading: WordReading } | null>(null)
  const checkRun = useRef(0)
  const savedRef = useRef<HTMLDivElement>(null)
  /** まとめた PDF の URL（ファイルが変わったら、少し待ってから解放する） */
  const mergedUrl = useRef<string | null>(null)
  /**
   * 保存の部品（pdf/exportPdf.ts）。まとめたときに読み込んでおく。iPhone・iPad の「保存する」は、押した処理の中ですぐ
   * 共有の画面を開かないと開けないため、押したあとに読み込まない
   */
  const saver = useRef<typeof import('../pdf/exportPdf') | null>(null)

  // 学科の年度の設定（管理ページで公開したもの。読めなければ、ツールに入っている設定）
  useEffect(() => {
    void loadConfig().then(({ config }) => setConfig(config))
  }, [])

  const commit = (next: Slots) => {
    slotsRef.current = next
    setSlotsState(next)
  }
  const releasePhoto = (p: PhotoItem) => {
    URL.revokeObjectURL(p.photo.url)
    p.photo.preview.close()
  }
  /** 外した・入れ替えたファイルの、絵の URL と PDF を解放する */
  const release = (e: Entry | undefined) => {
    if (!e) return
    for (const url of e.thumbs) if (url) URL.revokeObjectURL(url)
    for (const p of e.photos ?? []) releasePhoto(p)
    const doc = docs.current.get(e.id)
    if (doc) {
      void doc.loadingTask.destroy()
      docs.current.delete(e.id)
    }
  }
  /** ファイルが変わったら、保存したあとの知らせを閉じる（下の帯に戻る） */
  const filesChanged = () => {
    // まとめた PDF は、保存や開くのが終わるまで少し待ってから解放する（すぐ解放すると、保存が途中で止まることがある）
    const url = mergedUrl.current
    if (url) window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    mergedUrl.current = null
    setPhase((p) => (p.kind === 'merging' ? p : { kind: 'idle' }))
  }

  // ---- ファイルを入れる ----

  async function addFiles(list: File[], forced?: { part: PartId; slot: SlotKind }) {
    if (list.length === 0) return
    const out: Note[] = []
    let placed = 0
    let refused = 0
    /** 同じ名前の新しいファイルに入れ替えたもの（1行にまとめて知らせる） */
    const renewed: string[] = []
    const warn = (text: string) => out.push({ text })
    const info = (text: string) => out.push({ text, info: true })
    /** この回に入れた場所（同じ場所に2つ入ったら、新しいほうを使って知らせる） */
    const used = new Map<SlotKey, File>()
    setNotes([])
    setReading({ done: 0, total: list.length })
    for (const [i, file] of list.entries()) {
      const kind = fileKind(file)
      if (typeof kind !== 'string') {
        warn(`「${file.name}」：${kind.problem}`)
        refused++
        setReading({ done: i + 1, total: list.length })
        continue
      }
      const entry: Entry = { id: ++nextId.current, file, kind, state: 'ready', thumbs: [] }
      let sniffed: PartId | null = null
      try {
        if (kind === 'pdf') {
          const [{ readPdfInBrowser }, { mergeProblem }] = await Promise.all([loadPdf(), loadMerge()])
          const bytes = new Uint8Array(await file.arrayBuffer())
          try {
            const { doc, facts } = await readPdfInBrowser(bytes)
            docs.current.set(entry.id, doc)
            entry.facts = facts
            sniffed = classifyPdf(facts)
            entry.looksLike = pdfLooksLike(facts)
            const problem = await mergeProblem(bytes)
            if (problem) Object.assign(entry, { state: 'error', message: problem })
          } catch (e) {
            Object.assign(entry, { state: 'error', message: e instanceof Error && e.name === 'PdfReadError' ? e.message : 'PDF を読めませんでした。Word から PDF に保存し直してください。' })
          }
        } else if (kind === 'word') {
          // 名前で分かるときも、中身を見る（名前と中身が違えば知らせる）
          const looks = await (await loadWord()).wordLooksLike(file)
          if (!forced && !partFromName(file.name)) sniffed = looks?.guess ?? null
          entry.looksLike = looks?.sure ?? null
        } else {
          const { preparePhoto } = await loadPhoto()
          try {
            entry.photos = [{ id: entry.id, file, photo: await preparePhoto(file) }]
          } catch (e) {
            // 読めない写真は、入れない（入れてある写真は、そのまま）
            warn(`「${file.name}」：${e instanceof Error && e.name === 'PhotoError' ? e.message : 'この写真を読めませんでした。JPEG か PNG にしてから入れてください。'}`)
            refused++
            setReading({ done: i + 1, total: list.length })
            continue
          }
        }
      } catch {
        warn(`「${file.name}」：${LOAD_ERROR}`)
        refused++
        setReading({ done: i + 1, total: list.length })
        continue
      }
      // 作品写真の写真：入れてある写真の後ろに足す（4枚ずつのページに並べる。並べ方は枚数で決まる。ページ数の上限は年度の設定。null は上限なし）
      if (entry.photos) {
        const cur = slotsRef.current['photo:pdf']
        const have = cur?.photos ?? []
        const item = entry.photos[0]
        if (have.some((p) => p.file.name === file.name && p.file.size === file.size && p.file.lastModified === file.lastModified)) {
          info(`「${file.name}」は、もう入っています。`)
          releasePhoto(item)
        } else if (have.length >= maxPhotos(maxPagesRef.current)) {
          const max = maxPagesRef.current ?? 0
          warn(`「${file.name}」：作品写真は${max * PHOTOS_PER_PAGE}枚（${max}ページ）までです。入れるときは、「並べ替え・外す」から、どれかを外してください。`)
          releasePhoto(item)
          refused++
        } else {
          if (cur && !cur.photos) {
            info(`作品写真の PDF「${cur.file.name}」を外して、写真を並べるようにしました。`)
            release(cur)
          }
          await setPhotos([...have, item], false)
          placed++
        }
        setReading({ done: i + 1, total: list.length })
        continue
      }
      const place = forced && (forced.slot === 'word') === (kind === 'word') && !(kind === 'image' && forced.part !== 'photo') ? forced : placeFor(kind, file.name, sniffed)
      const key = keyOf(place.part, place.slot)
      const label = slotLabel(place.part, place.slot)
      /** 「本文の PDF を」のように、後ろに言葉を続けるとき（英字のあとは空ける） */
      const labelThen = spaced(label)
      const prev = slotsRef.current
      const before = used.get(key)
      if (before) {
        // 同じ回に、同じ場所へ2つ：ファイルの時刻が新しいほうを使う（入れた順ではなく。時刻が同じなら、あとのほう）
        const older = file.lastModified + 2000 < before.lastModified
        const [kept, dropped] = older ? [before, file] : [file, before]
        warn(`「${before.name}」と「${file.name}」が、同じ場所（${label}）に入りました。新しいほうの「${kept.name}」（${timeText(kept.lastModified)}）を使います。「${dropped.name}」を使うときは、そのファイルだけをもう一度入れてください。`)
        if (older) {
          release(entry)
          setReading({ done: i + 1, total: list.length })
          continue
        }
        // 前のファイルは、この回に入れて数えたもの（入れたファイルの数は増やさない）
        placed--
      } else if (prev[key]) {
        // 前に入れたファイルと入れ替える（黙って入れ替えない。古いファイルで入れ替えたときは、注意として言う）
        const old = prev[key]!
        if (old.photos) info(`作品写真の写真${old.photos.length}枚を外して、「${file.name}」にしました。`)
        else if (file.lastModified + 2000 < old.file.lastModified)
          warn(`${labelThen}を「${file.name}」に入れ替えました。前の「${old.file.name}」（${timeText(old.file.lastModified)}）より古いファイルです（${timeText(file.lastModified)}）。`)
        else if (old.file.name === file.name) renewed.push(file.name)
        else info(`${labelThen}を「${old.file.name}」から「${file.name}」に入れ替えました。`)
      }
      used.set(key, file)
      release(prev[key])
      commit({ ...prev, [key]: entry })
      placed++
      setReading({ done: i + 1, total: list.length })
    }
    setReading(null)
    // 同じ名前の新しいファイル（直して、入れ直した）は、1行にまとめる
    if (renewed.length === 1) info(`「${renewed[0]}」を、新しいものに入れ替えました。`)
    else if (renewed.length > 1) info(`${renewed.length}個のファイルを、同じ名前の新しいものに入れ替えました。`)
    setNotes(out)
    if (placed) {
      filesChanged()
      setAnnounce(`${placed}個のファイルを入れました。${refused ? '入れられなかったファイルがあります。' : ''}`)
    } else if (refused) setAnnounce('入れられなかったファイルがあります。')
  }

  /**
   * 作品写真の写真の並びを、list にする（並べたページの絵も描き直す）。空なら、作品写真を外す。
   * announce：変えたことを知らせ、保存したあとの知らせを閉じる（ファイルを入れているときは、入れ終わってからまとめて）
   */
  async function setPhotos(list: PhotoItem[], announce = true) {
    const prev = slotsRef.current
    const cur = prev['photo:pdf']
    if (list.length === 0) {
      const next = { ...prev }
      delete next['photo:pdf']
      commit(next)
    } else {
      const { photoPageImage } = await loadPhoto()
      const base = cur?.photos ? cur : null
      const pageImages = photoPages(list).map((page) => photoPageImage(page.map((p) => p.photo)))
      commit({ ...slotsRef.current, 'photo:pdf': { id: base?.id ?? ++nextId.current, file: list[0].file, kind: 'image', state: 'ready', thumbs: [], photos: list, pageImages } })
    }
    if (announce) filesChanged()
  }
  /** 作品写真の写真を1枚外す */
  const removePhoto = (id: number) => {
    const have = slotsRef.current['photo:pdf']?.photos ?? []
    const gone = have.find((p) => p.id === id)
    if (!gone) return
    releasePhoto(gone)
    void setPhotos(have.filter((p) => p.id !== id))
    setNotes([])
    setAnnounce(`「${gone.file.name}」を外しました`)
  }
  /** 作品写真の写真の順番を変える（dir：-1 は前へ、1 は後ろへ） */
  const movePhoto = (id: number, dir: -1 | 1) => {
    const have = [...(slotsRef.current['photo:pdf']?.photos ?? [])]
    const i = have.findIndex((p) => p.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= have.length) return
    ;[have[i], have[j]] = [have[j], have[i]]
    void setPhotos(have)
    setAnnounce(`「${have[j].file.name}」を${j + 1}枚目にしました`)
  }

  const removeEntry = (key: SlotKey) => {
    const prev = slotsRef.current
    const e = prev[key]
    if (!e) return
    release(e)
    const next = { ...prev }
    delete next[key]
    commit(next)
    filesChanged()
    setNotes([])
    setAnnounce(`「${e.file.name}」を外しました`)
  }

  /** ほかの場所に移す（移す先にファイルがあれば、入れ替える） */
  const moveEntry = (from: SlotKey, toPart: PartId) => {
    const prev = slotsRef.current
    const e = prev[from]
    if (!e) return
    const to = keyOf(toPart, from.endsWith(':word') ? 'word' : 'pdf')
    if (to === from) return
    const next = { ...prev, [to]: e }
    if (prev[to]) next[from] = prev[to]
    else delete next[from]
    commit(next)
    filesChanged()
    const [fromPart, slot] = from.split(':') as [PartId, SlotKind]
    const moved = `「${e.file.name}」を${spaced(slotLabel(toPart, slot))}に移しました。`
    // 移す先にあったファイルは、もとの場所へ入れ替わる（黙って入れ替えない）
    const swapped = prev[to] ? `もとの「${prev[to]!.file.name}」は、${spaced(slotLabel(fromPart, slot))}に移しました。` : ''
    setNotes(swapped ? [{ text: moved + swapped, info: true }] : [])
    setAnnounce(moved + swapped)
  }

  /** ファイルを選ぶ画面を開く。target：入れる場所を決めて選ぶとき。accept：選べる形 */
  const pick = (target?: { part: PartId; slot: SlotKind }, accept = '.docx,.pdf,.jpg,.jpeg,.png,.heic,.heif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*') => {
    pickTarget.current = target
    const input = fileInput.current
    if (!input) return
    input.accept = accept
    // 作品写真は、何枚かまとめて選べる（入れた順に4枚ずつのページに並べる）
    input.multiple = !target || target.part === 'photo'
    input.click()
  }

  // ページのどこに落としても入れる（入れる所から外れても、ブラウザがファイルを開いてしまわないように）
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      setDragging(true)
    }
    const leave = () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      void addFiles([...(e.dataTransfer?.files ?? [])])
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
    // addFiles は、いつも最新の置き場所（slotsRef）を使うので、はじめに1回つなげばよい
  }, [])

  // ---- 確かめる（ファイルが変わったとき・設定を読み込んだとき） ----

  const checkKey = useMemo(
    () =>
      PARTS.flatMap((p) => (['word', 'pdf'] as const).map((s) => slots[keyOf(p.id, s)]))
        .map((e) => (e ? `${e.id}${e.state}` : '-'))
        .join('|'),
    [slots],
  )
  useEffect(() => {
    const run = ++checkRun.current
    const current = slotsRef.current
    const pdfs: Partial<Record<PartId, PdfFacts>> = {}
    for (const p of PARTS) {
      const e = mergeEntry(current, p.id)
      if (e?.facts) pdfs[p.id] = e.facts
    }
    const words: Partial<Record<'cover' | 'abstract' | 'toc' | 'body', File>> = {}
    for (const p of ['cover', 'abstract', 'toc', 'body'] as const) {
      const e = current[keyOf(p, 'word')]
      if (e) words[p] = e.file
    }
    const hasWord = Object.keys(words).length > 0
    void (async () => {
      let findings: CheckFinding[] = []
      let covered = new Set<string>()
      let wordErrors: CheckState['wordErrors'] = {}
      let info: { studentId?: string; name?: string } = {}
      if (hasWord) {
        try {
          const mod = await loadWord()
          // Word を読み直すのは、Word か設定が変わったときだけ（PDF を入れ替えても読み直さない）
          const key = (['cover', 'abstract', 'toc', 'body'] as const).map((p) => current[keyOf(p, 'word')]?.id ?? '-').join('|')
          const cached = wordCache.current
          const reading = cached && cached.key === key && cached.config === config ? cached.reading : await mod.readWord(words, config)
          wordCache.current = { key, config, reading }
          const body = pdfs.body ? bodyPages(pdfs.body) : null
          const result = mod.wordFindings(reading, config, {
            bodyPages: body?.count,
            referencesExcluded: !!body?.referencesFrom,
            abstractPages: pdfs.abstract?.pages.length,
            abstractLines: pdfs.abstract ? abstractLines(pdfs.abstract) : undefined,
          })
          findings = result.findings
          covered = result.covered
          wordErrors = reading.errors
          info = { studentId: reading.studentId, name: reading.name }
        } catch {
          wordErrors = Object.fromEntries(Object.keys(words).map((p) => [p, LOAD_ERROR]))
        }
      }
      // 入れた場所と中身が違うファイル・Word より古い PDF（間違った PDF のまま、まとめないように）
      const slotFindings: CheckFinding[] = []
      for (const p of PARTS) {
        for (const s of ['word', 'pdf'] as const) {
          const e = current[keyOf(p.id, s)]
          if (e?.state === 'ready' && e.looksLike && e.looksLike !== p.id) slotFindings.push(wrongPartFinding(p.id, s, e.looksLike))
        }
        const word = current[keyOf(p.id, 'word')]
        const pdf = current[keyOf(p.id, 'pdf')]
        if (p.id !== 'photo' && word && pdf?.kind === 'pdf' && isStale(word.file, pdf.file)) slotFindings.push(staleFinding(p.id, word.file, pdf.file))
      }
      // 1ページだけのパート（表紙・抄録など）の指摘は、そのページの指摘
      const located = locateFindings([...slotFindings, ...findings, ...pdfFindings(pdfs, config, covered)], pdfs).map((f) => (!f.page && pdfs[f.part]?.pages.length === 1 ? { ...f, page: 1 } : f))
      if (run !== checkRun.current) return
      setCheck({ findings: located, hasWord, forKey: checkKey, forConfig: config, wordErrors, oks: hasWord ? [] : pdfOks(pdfs, config), ...info })
    })()
  }, [checkKey, config])

  // ---- ページの小さな絵（1枚ずつ、順に作る） ----

  const thumbBusy = useRef(false)
  useEffect(() => {
    if (thumbBusy.current) return
    const keys = PARTS.map((p) => keyOf(p.id, 'pdf'))
    const target = keys.map((k) => slotsRef.current[k]).find((e) => e && e.state === 'ready' && e.facts && e.thumbs.length < e.facts.pages.length && docs.current.has(e.id))
    if (!target) return
    thumbBusy.current = true
    void (async () => {
      let url = ''
      try {
        const { pageThumbnail } = await loadPdf()
        url = await pageThumbnail(docs.current.get(target.id)!, target.thumbs.length + 1, 300)
      } catch {
        // 作れなかったページは、白い紙のまま
      }
      thumbBusy.current = false
      const prev = slotsRef.current
      const at = keys.find((k) => prev[k]?.id === target.id)
      if (!at) {
        if (url) URL.revokeObjectURL(url)
        // 外したあとでも、ほかのファイルの絵を続けて作る
        commit({ ...prev })
        return
      }
      const e = prev[at]!
      commit({ ...prev, [at]: { ...e, thumbs: [...e.thumbs, url] } })
    })()
  }, [slots])

  // ---- まとめる ----

  const pdfs = useMemo(() => {
    const out: Partial<Record<PartId, PdfFacts>> = {}
    for (const p of PARTS) {
      const e = mergeEntry(slots, p.id)
      if (e?.facts) out[p.id] = e.facts
    }
    return out
  }, [slots])
  const anyFile = Object.values(slots).some(Boolean)
  const anyPdf = PARTS.some((p) => mergeEntry(slots, p.id))
  const totalPages = PARTS.reduce((n, p) => n + pagesOf(mergeEntry(slots, p.id)), 0)
  const missing = PARTS.filter((p) => !mergeEntry(slots, p.id)).map((p) => p.name)
  // 読めなかったファイル（まとめられない・チェックできない）も、エラーに数える
  const fileErrors = PARTS.flatMap((p) => (['word', 'pdf'] as const).filter((s) => slots[keyOf(p.id, s)] && (slots[keyOf(p.id, s)]!.state === 'error' || (s === 'word' && !!wordError(slots, check, p.id))))).length
  const findingErrors = check.findings.filter((f) => f.severity === 'error').length
  const errors = findingErrors + fileErrors
  const warnings = check.findings.length - findingErrors
  /** PDF はあるが Word を入れていないパート（Word をほかのパートに入れたとき、チェックの結果と確かめの窓で言う） */
  const noWord = PARTS.filter((p) => p.id !== 'photo' && mergeEntry(slots, p.id) && !slots[keyOf(p.id, 'word')]).map((p) => p.name)
  /** PDF が Word より古いパート（確かめの窓で言う） */
  const stale = PARTS.filter((p) => p.id !== 'photo' && slots[keyOf(p.id, 'pdf')]?.kind === 'pdf' && isStale(slots[keyOf(p.id, 'word')]?.file, slots[keyOf(p.id, 'pdf')]?.file)).map((p) => p.name)
  // ファイル名の学籍番号・氏名：Word（表紙・抄録）、なければ表紙の PDF、なければ学生が入れたもの
  const fromCoverPdf = useMemo(() => idAndName(pdfs.cover?.pages[0]?.lines.map((l) => l.text) ?? []), [pdfs])
  const known = { studentId: check.studentId || fromCoverPdf.studentId || '', name: check.name || fromCoverPdf.name || '' }
  const studentId = known.studentId || manual.studentId
  const studentName = known.name || manual.name
  const fileName = mergedFileName(config, studentId, studentName)

  const startMerge = () => {
    const ask = confirmText(errors, missing, stale, check.hasWord ? noWord : true)
    if (ask) setPhase({ kind: 'confirm', ...ask })
    else void merge()
  }

  async function merge() {
    setPhase({ kind: 'merging' })
    let modules: [typeof import('./merge'), typeof import('../pdf/exportPdf')]
    try {
      modules = await Promise.all([loadMerge(), loadSaver()])
    } catch {
      setPhase({ kind: 'error', message: LOAD_ERROR })
      return
    }
    const [{ mergeParts }, save] = modules
    saver.current = save
    try {
      const items: import('./merge').MergeItem[] = []
      for (const p of PARTS) {
        const e = mergeEntry(slotsRef.current, p.id)
        if (!e) continue
        if (e.photos) items.push({ type: 'photos', photos: e.photos.map((p) => ({ bytes: p.photo.bytes, format: 'jpg' as const, width: p.photo.width, height: p.photo.height })) })
        else items.push({ type: 'pdf', bytes: new Uint8Array(await e.file.arrayBuffer()) })
      }
      const { bytes, pageCount } = await mergeParts(items, fileName.replace(/\.pdf$/, ''))
      const blob = new Blob([bytes.slice()], { type: 'application/pdf' })
      const pdf: BuiltPdf = { blob, fileName, pageCount, url: URL.createObjectURL(blob) }
      mergedUrl.current = pdf.url
      const mode = save.saveMode()
      setPhase({ kind: 'done', pdf, mode, size: `${pageCount}ページ・${save.sizeText(blob.size)}`, saved: '' })
      // 入れたときの知らせは、保存したら閉じる
      setNotes([])
      setAnnounce(mode === 'download' ? `保存しました：${fileName}` : `PDF ができました。「保存する」を押してください`)
      if (mode === 'download') save.downloadPdf(pdf)
    } catch {
      setPhase({ kind: 'error', message: 'まとめられませんでした。入れた PDF を、Word から保存し直してから、もう一度試してください。' })
    }
  }

  // 入れたファイルがあるうちに、ページを閉じる・読み込み直すときは、ブラウザに確かめてもらう（入れたファイルは、このページの中にしかないため）。
  // 保存したあとは、閉じて終わりなので聞かない
  const guardLeave = anyFile && phase.kind !== 'done'
  useEffect(() => {
    if (!guardLeave) return
    const ask = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', ask)
    return () => window.removeEventListener('beforeunload', ask)
  }, [guardLeave])

  // 保存したら、結果に移る（読み上げでも分かるように）
  useEffect(() => {
    if (phase.kind === 'done') savedRef.current?.focus()
  }, [phase.kind])

  const startOver = () => {
    for (const e of Object.values(slotsRef.current)) release(e)
    commit({})
    setNotes([])
    setManual({ studentId: '', name: '' })
    setSelected(null)
    filesChanged()
  }

  /** iPhone・iPad の「保存する」：共有の画面を開く（押した直後に開く。やめたときは、もう一度押せる） */
  const share = async (pdf: BuiltPdf) => {
    if (!saver.current) return
    const result = await saver.current.sharePdf(pdf)
    if (result !== 'cancelled') setPhase((p) => (p.kind === 'done' ? { ...p, saved: result } : p))
  }

  // ---- 指摘とページ ----

  const pins = useMemo(() => pagePins(check.findings), [check.findings])
  const selectedFinding = check.findings.find((f) => f.id === selected) ?? null
  const selectedPage = selectedFinding?.page ? `${selectedFinding.part}:${selectedFinding.page}` : null
  const docRef = useRef<HTMLDivElement>(null)
  const sideRef = useRef<HTMLElement>(null)

  const pickFinding = (f: CheckFinding) => {
    const on = selected === f.id ? null : f.id
    setSelected(on)
    if (on && f.page) {
      // 選んだ指摘のページが見えるようにする
      // スマホは、ページの行を画面の真ん中に出す（「nearest」だと、画面の上の端で切れることがある）
      requestAnimationFrame(() => docRef.current?.querySelector(`[data-page="${f.part}:${f.page}"]`)?.scrollIntoView({ block: narrow ? 'center' : 'nearest', inline: 'center', behavior: scrollBehavior() }))
    }
  }
  /** ページの丸を押したとき：そのページの最初の指摘を選ぶ */
  const pickPage = (part: PartId, k: number) => {
    const f = check.findings.find((x) => x.part === part && x.page === k)
    if (!f) return
    setSelected(f.id)
    // スマホは下に帯があるので、指摘を画面の真ん中に出す（「nearest」だと、帯の裏に隠れる）
    requestAnimationFrame(() => sideRef.current?.querySelector(`[data-finding="${CSS.escape(f.id)}"]`)?.scrollIntoView({ block: narrow ? 'center' : 'nearest', behavior: scrollBehavior() }))
  }

  // ---- 画面 ----

  const empty = !anyFile
  const partState = (p: PartInfo) => {
    const word = p.id === 'photo' ? undefined : slots[keyOf(p.id, 'word')]
    const pdf = slots[keyOf(p.id, 'pdf')]
    return { word, pdf, stale: p.id !== 'photo' && pdf?.kind === 'pdf' && isStale(word?.file, pdf?.file) }
  }

  /** パートの見出しの下：入っているファイルの名前（押すと、移す・外すの小さな窓）と、外す × */
  const files = (p: PartInfo) => {
    const { word, pdf, stale } = partState(p)
    const one = (slot: SlotKind, e: Entry | undefined) => {
      const key = keyOf(p.id, slot)
      if (!e) {
        // 最初の画面は「Word」「PDF」だけ（見本の名前を出すと、名前を付け直すものと思われるため。mockups/v31 案1）
        const none = p.id === 'photo' ? (empty ? '写真' : 'まだありません') : empty ? (slot === 'word' ? 'Word' : 'PDF') : `${slot === 'word' ? 'Word' : 'PDF'} なし`
        return (
          <span key={slot} className="pf none">
            {none}
          </span>
        )
      }
      if (e.photos) {
        const open = (ev: React.MouseEvent<HTMLElement>) => setPhotoMenu(ev.currentTarget.getBoundingClientRect())
        return [
          <span key="photos" className="pf photos">
            <button type="button" className="fname" aria-haspopup="dialog" onClick={open}>
              {photoCountText(e.photos.length)}
            </button>
            <span className="pf-sub">（1ページ{PHOTOS_PER_PAGE}枚まで）</span>
          </span>,
          <button key="menu" type="button" className="link pf-link" aria-haspopup="dialog" onClick={open}>
            並べ替え・外す
          </button>,
        ]
      }
      const ng = e.state === 'error' || (slot === 'word' && !!wordError(slots, check, p.id))
      return (
        <span key={slot} className={`pf${slot === 'pdf' && stale ? ' stale' : ''}${ng ? ' ng' : ''}`}>
          {slot === 'pdf' && stale && <Wn />}
          {ng && <i className="st no-ng" aria-hidden="true" />}
          <button type="button" className="fname" aria-haspopup="dialog" aria-label={`${e.file.name}（${slotLabel(p.id, slot)}）：移す・外す`} onClick={(ev) => setMenu({ key, rect: ev.currentTarget.getBoundingClientRect() })}>
            <FileName name={e.file.name} oneLine />
          </button>
          <button type="button" className="x" aria-label={`「${e.file.name}」を外す`} onClick={() => removeEntry(key)}>
            {I.x}
          </button>
        </span>
      )
    }
    return p.id === 'photo' ? [one('pdf', pdf)] : [one('word', word), one('pdf', pdf)]
  }
  /** 「Word のほうが新しい」の知らせ。short：ページ1〜2枚分の細い段（短い言葉にする。くわしくはチェックの結果の一覧に出す） */
  const staleNote = (p: PartInfo, short = false) =>
    partState(p).stale && (
      <p className={`p-note${short ? ' short' : ''}`} title="PDF が Word より古いようです。Word を直したら、PDF も作り直してください">
        <Wn />
        <span>{short ? 'PDF が古い？' : STALE}</span>
        <button type="button" className="link" aria-label={`${p.name}の PDF を入れ替える`} onClick={() => pick({ part: p.id, slot: 'pdf' }, '.pdf,application/pdf')}>
          {short ? '入れ替える' : 'PDF を入れ替える'}
        </button>
      </p>
    )

  /** ページ1枚（選んだ指摘のページに枠。指摘のあるページに、数の丸） */
  const pageFigure = (it: PageSlot) => {
    const p = PARTS.find((x) => x.id === it.part)!
    const e = mergeEntry(slots, it.part)
    if (!it.no || !e) {
      if (p.id === 'photo' && !empty)
        return (
          <figure key={`${it.part}-${it.k}`}>
            <button type="button" className="pg none add" onClick={() => pick({ part: 'photo', slot: 'pdf' }, '.jpg,.jpeg,.png,.heic,.heif,.pdf,image/*,application/pdf')}>
              {I.plus}
              写真を入れる
            </button>
            {'　'}
          </figure>
        )
      const hint = p.id === 'body' && it.last && (
        <>
          {config.body.minPages}ページ
          <br />
          以上
        </>
      )
      // PDF がまだないパートの空の枠は、押すとそのパートの PDF を選べる（最初の画面は、上の「ファイルを選ぶ」から）
      if (!empty && !e)
        return (
          <figure key={`${it.part}-${it.k}`}>
            <button type="button" className="pg none pick" aria-label={`${p.name}の PDF を入れる`} onClick={() => pick({ part: p.id, slot: 'pdf' }, '.pdf,application/pdf')}>
              {hint}
            </button>
            {'　'}
          </figure>
        )
      return (
        <figure key={`${it.part}-${it.k}`} aria-hidden="true">
          <span className="pg none">{hint}</span>
          {'　'}
        </figure>
      )
    }
    const pageKey = `${it.part}:${it.k}`
    const pin = pins.get(pageKey)
    const src = e.photos ? e.pageImages?.[it.k - 1] : e.thumbs[it.k - 1]
    // 絵を作っている途中（まだ作っていない）か、作れなかった（白い紙のまま）。次に作るページ（now）には、回る小さな印を出す
    const tried = e.thumbs.length >= it.k
    const label = `${p.name}${pagesOf(e) > 1 ? ` ${it.k}ページ目` : ''}（全体の${it.no}ページ目）${pin ? `：指摘${pin.count}件` : ''}`
    const inner = (
      <>
        {src ? <img src={src} alt="" /> : <i className={tried ? 'pg-blank' : `pg-wait${it.k === e.thumbs.length + 1 ? ' now' : ''}`} />}
        {pin && <i className={`pin${pin.error ? '' : ' w'}`}>{pin.count}</i>}
      </>
    )
    return (
      <figure key={pageKey} data-page={pageKey}>
        {pin ? (
          <button type="button" className={`pg${selectedPage === pageKey ? ' sel' : ''}`} aria-label={label} onClick={() => pickPage(it.part, it.k)}>
            {inner}
          </button>
        ) : (
          <span className={`pg${selectedPage === pageKey ? ' sel' : ''}`} role="img" aria-label={label}>
            {inner}
          </span>
        )}
        {it.no}
      </figure>
    )
  }

  const minPages = config.body.minPages
  const parts = useMemo(() => pageSlots(PARTS.map((p) => ({ id: p.id, pages: pagesOf(mergeEntry(slots, p.id)), placeholder: p.id === 'body' ? minPages : 1 }))), [slots, minPages])

  // パソコン：画面の高さに収まる範囲で、ページの絵をできるだけ大きくする（ページを並べる所の幅と、使える高さを測る）
  const [box, setBox] = useState({ width: 0, available: 0 })
  useLayoutEffect(() => {
    if (narrow) return
    const el = docRef.current
    if (!el) return
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY
      // 下の余白（下の帯の分）と、空のときの説明の行
      const main = el.closest('main')
      const bottom = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0
      const cap = document.querySelector<HTMLElement>('.c-cap')?.offsetHeight ?? 0
      const next = { width: el.clientWidth, available: window.innerHeight - top - bottom - (cap ? cap + 18 : 0) - 4 }
      setBox((b) => (b.width === next.width && b.available === next.available ? b : next))
    }
    measure()
    // 上の知らせが増えたり減ったりしても測り直す（ページを並べる所の位置が変わる）
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    observer.observe(document.body)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [narrow, empty, phase.kind])
  /** 「Word のほうが新しい」の知らせがあるパート（その段の見出しを高くする） */
  const noted = useMemo(() => new Set(PARTS.filter((p) => p.id !== 'photo' && slots[keyOf(p.id, 'pdf')]?.kind === 'pdf' && isStale(slots[keyOf(p.id, 'word')]?.file, slots[keyOf(p.id, 'pdf')]?.file)).map((p) => p.id)), [slots])
  const grid = useMemo(() => (box.width ? chooseThumbWidth(parts, box.width, box.available, noted) : { tw: 96, rows: [] as Segment[][] }), [parts, box, noted])

  const segment = (s: Segment, i: number) => {
    const p = PARTS.find((x) => x.id === s.part)!
    const n = s.items.length
    const shown = pagesOf(mergeEntry(slots, p.id)) > 0
    const head = s.first ? (
      <header className="p-h">
        <b>{p.name}</b>
        <div className="p-f">{files(p)}</div>
        {staleNote(p, n < 3)}
      </header>
    ) : (
      <header className="p-h cont">
        <b>
          {p.name}
          <small>
            （つづき）{s.items[0].no ? `${s.items[0].k}〜${s.items[n - 1].k}ページ目` : ''}
          </small>
        </b>
      </header>
    )
    return (
      <section key={`${p.id}-${i}`} className={`grp p-seg${n >= 3 ? ' wide' : ''}${shown ? '' : ' todo'}`} style={{ '--n': n } as React.CSSProperties} aria-label={s.first ? p.name : `${p.name}（つづき）`}>
        {head}
        <div className="g-pages">{s.items.map(pageFigure)}</div>
      </section>
    )
  }

  // Word を確かめている途中（ファイルが変わったあと、確かめ終わるまで）は、まとめない（エラーの数が変わるため）
  const checking = (['cover', 'abstract', 'toc', 'body'] as const).some((p) => slots[keyOf(p, 'word')]) && (check.forKey !== checkKey || check.forConfig !== config)
  const busy = !!reading || phase.kind === 'merging' || checking

  return (
    <>
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            卒
          </span>
          <div>
            <h1>提出前チェック</h1>
            <small>
              {config.reportName}　{config.fiscalYear}年度
            </small>
          </div>
        </div>
        <p className="sub">Word で書いた報告書を確かめて、1つの PDF にまとめます</p>
        <span className="spacer" />
        <span className="safe">
          {I.lock}ファイルは外に送りません<small>（この端末の中だけで読みます）</small>
        </span>
        <button type="button" className="help-btn" onClick={() => setHelp(true)}>
          {I.help}使い方
        </button>
      </header>

      {/* data-busy：読んでいる・確かめている・まとめている途中（通しの確かめ scripts/e2e/check.mjs が待つのに使う） */}
      <main className={`c2${phase.kind === 'done' ? ' nobar' : ''}`} data-busy={busy}>
        <div className="c2-main">
          <div className="c-top">
            {phase.kind === 'done' ? (
              <Saved phase={phase} ref={savedRef} onOpen={() => window.open(phase.pdf.url, '_blank')} onAgain={() => saver.current?.downloadPdf(phase.pdf)} onShare={() => void share(phase.pdf)} onStartOver={() => setAskStartOver(true)} />
            ) : (
              <DropArea big={empty} dragging={dragging} reading={reading} onPick={() => pick()} />
            )}
          </div>
          {notes.length > 0 && (
            <ul className="add-notes">
              {notes.map((n, i) => (
                <li key={i} className={n.info ? 'info' : undefined}>
                  {n.info ? <Ok /> : <Wn />}
                  {n.text}
                </li>
              ))}
            </ul>
          )}
          <div className="c2-doc" id="doc" ref={docRef} style={{ '--tw': `${grid.tw}px` } as React.CSSProperties}>
            {narrow ? (
              <div className="card pp-list">
                {parts.map((items) => {
                  const p = PARTS.find((x) => x.id === items[0].part)!
                  const shown = pagesOf(mergeEntry(slots, p.id)) > 0
                  return (
                    <section key={p.id} className={`pp${shown ? '' : ' todo'}`} aria-label={p.name}>
                      <div className="pp-info">
                        <b>{p.name}</b>
                        <div className="p-f">{files(p)}</div>
                      </div>
                      <div className="pp-strip">{items.map(pageFigure)}</div>
                      {staleNote(p)}
                    </section>
                  )
                })}
              </div>
            ) : (
              grid.rows.map((row, i) => (
                <div key={i} className={`c-row${isNotedRow(row, noted) ? ' noted' : ''}`}>
                  {row.map(segment)}
                </div>
              ))
            )}
          </div>
          {empty && <p className="c-cap">この順に並べて、1つの PDF にまとめます。入れたファイルは、名前を見て自動で分けます。</p>}
        </div>
        <CheckPanel
          ref={sideRef}
          check={check}
          checking={checking}
          empty={empty}
          anyPdf={anyPdf}
          pdfCount={Object.keys(pdfs).length}
          noWord={noWord}
          slots={slots}
          errors={errors}
          warnings={warnings}
          selected={selected}
          pdfPages={(part) => pdfs[part]?.pages.length ?? 0}
          onPick={pickFinding}
          onAddWord={() => pick(undefined, '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document')}
        />
      </main>

      {phase.kind !== 'done' && (
        <MergeBar
          fileName={fileName}
          ready={anyPdf && !busy}
          empty={empty}
          anyPdf={anyPdf}
          totalPages={totalPages}
          missing={missing}
          errors={errors}
          hasWord={check.hasWord}
          merging={phase.kind === 'merging'}
          failure={phase.kind === 'error' ? phase.message : null}
          // 表紙を入れてから聞く（まだ入れていないのに「読み取れなかった」とは言わない）
          ask={anyPdf && (slots['cover:pdf'] || slots['cover:word']) ? { studentId: !known.studentId, name: !known.name } : null}
          manual={manual}
          onManual={setManual}
          onMerge={startMerge}
          placeholder={mergedFileName(config, '学籍番号', '氏名')}
        />
      )}

      <input
        ref={fileInput}
        type="file"
        hidden
        onChange={(e) => {
          const list = [...(e.target.files ?? [])]
          // 選んだファイルを空に戻す（同じファイルを、もう一度選べるように）
          e.target.value = ''
          void addFiles(list, pickTarget.current)
        }}
      />
      <p className="sr-only" role="status" aria-live="polite">
        {announce}
      </p>

      {phase.kind === 'confirm' && (
        <ConfirmDialog
          title={phase.title}
          sub={phase.sub}
          onBack={() => setPhase({ kind: 'idle' })}
          onGo={() => void merge()}
        />
      )}
      {askStartOver && (
        <ConfirmDialog
          title="入れたファイルを、すべて外しますか？"
          lead="このページから外すだけです。パソコンやスマホの中のファイルと、保存した PDF は、そのまま残ります。"
          sub={[]}
          goLabel="すべて外す"
          goClass="go-clear"
          backLabel="やめる"
          onBack={() => setAskStartOver(false)}
          onGo={() => {
            setAskStartOver(false)
            startOver()
          }}
        />
      )}
      {help && <HelpDialog onClose={() => setHelp(false)} />}
      {photoMenu && slots['photo:pdf']?.photos && (
        <PhotoMenu
          photos={slots['photo:pdf'].photos}
          max={maxPhotos(config.workPhotos?.maxPages ?? null)}
          rect={photoMenu}
          onMove={movePhoto}
          onRemove={removePhoto}
          onAdd={() => pick({ part: 'photo', slot: 'pdf' }, '.jpg,.jpeg,.png,.heic,.heif,image/*')}
          onClose={() => setPhotoMenu(null)}
        />
      )}
      {menu && slots[menu.key] && (
        <MoveMenu
          entry={slots[menu.key]!}
          from={menu.key}
          rect={menu.rect}
          onMove={(to) => moveEntry(menu.key, to)}
          onRemove={() => removeEntry(menu.key)}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}

// ---- ファイルを入れる所 ----

/**
 * ファイルを入れる所。読んでいる間は、ボタンに回る印と「読んでいます…」を出し（押せない）、何個目かを出す。
 * 2秒を過ぎたら「数秒かかることがあります」を足す（ページの多い PDF・写真は、スマホで数秒かかる。依頼者の要望 2026-10-20）
 */
function DropArea({ big, dragging, reading, onPick }: { big: boolean; dragging: boolean; reading: { done: number; total: number } | null; onPick: () => void }) {
  const slow = useSlow(!!reading)
  const status = reading ? (
    <span className="d-busy">
      ファイルを読んでいます（{Math.min(reading.done + 1, reading.total)} / {reading.total}）{slow && <span className="nb">数秒かかることがあります</span>}
    </span>
  ) : null
  const button = (
    <BusyLabel busy={!!reading} text="読んでいます…">
      ファイルを選ぶ
    </BusyLabel>
  )
  if (big)
    return (
      <div className={`drop big${dragging ? ' over' : ''}`}>
        <span className="d-ic">{I.up}</span>
        <b className="d-t">
          <span className="pc-only">ここにファイルを入れる</span>
          <span className="ph-only">ファイルを入れる</span>
        </b>
        <p className="d-s" role="status">
          {status ?? 'Word・PDF・作品写真を、まとめて入れられます。名前はそのままで大丈夫です'}
        </p>
        <button type="button" className="btn primary" onClick={onPick} disabled={!!reading}>
          {button}
        </button>
      </div>
    )
  return (
    <div className={`drop bar${dragging ? ' over' : ''}`}>
      {I.up}
      <div className="d-x">
        <b>ファイルを足す・入れ替える</b>
        <small role="status">{status ?? '同じ場所に入れると、新しいものに替わります'}</small>
      </div>
      <button type="button" className="btn quiet" onClick={onPick} disabled={!!reading}>
        {button}
      </button>
    </div>
  )
}

// ---- チェックの結果（右の欄。スマホはページの下） ----

interface PanelProps {
  check: CheckState
  checking: boolean
  empty: boolean
  anyPdf: boolean
  pdfCount: number
  /** PDF はあるが Word を入れていないパート */
  noWord: string[]
  slots: Slots
  errors: number
  warnings: number
  selected: string | null
  pdfPages: (part: PartId) => number
  onPick: (f: CheckFinding) => void
  onAddWord: () => void
  ref: React.Ref<HTMLElement>
}

/** エラーと要確認の意味（指摘の一覧の上。1つずつの札「手順書」「補助」の代わり。mockups/v31 案1） */
function SeverityLegend() {
  return (
    <p className="sev-legend">
      <span>
        <i className="st no-ng" aria-hidden="true" />
        <span>
          <b className="e">エラー</b>：直してから出す
        </span>
      </span>
      <span>
        <Wn />
        <span>
          <b className="w">要確認</b>：確かめて、必要なら直す
        </span>
      </span>
    </p>
  )
}

function Tally({ errors, warnings }: { errors: number; warnings: number }) {
  return (
    <span className="tally">
      <b className={errors ? 'e' : 'z'}>{errors}</b> エラー　<b className={warnings ? 'w' : 'z'}>{warnings}</b> 要確認
    </span>
  )
}

/** どこの指摘か（ページが分かれば「本文 3ページ目」、分からなければ「本文」。1ページだけのパートは、パートの名前） */
function Where({ f, pages }: { f: CheckFinding; pages: number }) {
  if (f.page && pages > 1) return <span className="loc">{`${PART_NAMES[f.part]} ${f.page}ページ目`}</span>
  return <span className={`loc${f.page ? '' : ' part'}`}>{PART_NAMES[f.part]}</span>
}

function Issue({ f, sel, pages, onPick }: { f: CheckFinding; sel: boolean; pages: number; onPick: () => void }) {
  return (
    <li className={`issue${f.severity === 'warning' ? ' warning' : ''}${sel ? ' sel' : ''}`} data-finding={f.id}>
      <i className="dot" />
      {/* 指摘を押すと、そのページに枠が付く（キーボードでは、このボタンに Tab で移る） */}
      <button type="button" className="go" aria-pressed={sel} aria-label={`${f.severity === 'error' ? 'エラー' : '要確認'}：${f.title}。${f.page ? `${PART_NAMES[f.part]}${pages > 1 ? ` ${f.page}ページ目` : ''}` : PART_NAMES[f.part]}${f.quote ? `。${f.quote.join('')}` : ''}${f.detail ? `。${f.detail}` : ''}`} onClick={onPick}>
        <span className="ttl">{f.title}</span>
        <span className="detail">
          <Where f={f} pages={pages} />
          {f.quote && (
            <>
              「{f.quote[0]}
              <mark>{f.quote[1]}</mark>
              {f.quote[2]}」
            </>
          )}
          {f.detail}
        </span>
      </button>
    </li>
  )
}

function CheckPanel({ check, checking, empty, anyPdf, pdfCount, noWord, slots, errors, warnings, selected, pdfPages, onPick, onAddWord, ref }: PanelProps) {
  const sideRef = useRef<HTMLElement | null>(null)
  const [more, setMore] = useState(false)
  // 指摘の一覧が欄より長いとき：下に続くことが分かるように、欄の下をぼかす
  useLayoutEffect(() => {
    const el = sideRef.current
    if (!el) return
    // ぼかしの飾り（check.css の .c2-side.more::after）は、欄の高さを 20px 縮める。その分を見込まないと、一覧が短くなっても（「はじめから」のあと）ぼかしが残る
    const measure = () => setMore(el.scrollHeight > el.clientHeight + 24 && el.scrollTop + el.clientHeight < el.scrollHeight - 24)
    measure()
    el.addEventListener('scroll', measure)
    window.addEventListener('resize', measure)
    return () => {
      el.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [check])
  const setRefs = (el: HTMLElement | null) => {
    sideRef.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) (ref as React.RefObject<HTMLElement | null>).current = el
  }
  const groups = groupByPart(check.findings)
  const readErrors = PARTS.flatMap((p) =>
    (['word', 'pdf'] as const).flatMap((s) => {
      const e = slots[keyOf(p.id, s)]
      const message = e?.state === 'error' ? e.message : s === 'word' && e ? wordError(slots, check, p.id) : undefined
      return e && message ? [{ name: e.file.name, message }] : []
    }),
  )
  let body: ReactNode
  if (empty) {
    body = (
      <>
        <ul className="what">
          <li>
            {I.text}
            <div>
              文の書き方<small>「である」調・「筆者」・「制作」・数字は半角</small>
            </div>
          </li>
          <li>
            {I.photo}
            <div>
              図と表<small>本文から「図1」のように参照しているか</small>
            </div>
          </li>
          <li>
            {I.doc}
            <div>
              抄録と表紙<small>抄録は600〜900字・表紙の空欄</small>
            </div>
          </li>
          <li>
            {I.pages}
            <div>
              ページの数と用紙<small>本文は5ページ以上・A4（PDF から確かめます）</small>
            </div>
          </li>
        </ul>
        <p className="cant">
          <b>ここでは、直せません</b>直すのは Word でします。PDF も、Word の「名前を付けて保存」で作ります。
        </p>
      </>
    )
  } else {
    const list = groups.map((g) => (
      <div key={g.part.id} className="igroup">
        <div className="ig-h">
          {g.part.name}
          <span>{g.items.length}件</span>
        </div>
        <ul className="issues">
          {g.items.map((f) => (
            <Issue key={f.id} f={f} sel={selected === f.id} pages={pdfPages(f.part)} onPick={() => onPick(f)} />
          ))}
        </ul>
      </div>
    ))
    body = (
      <>
        {readErrors.length > 0 && (
          <ul className="read-errors">
            {readErrors.map((r, i) => (
              <li key={i}>
                <b className="fn">{r.name}</b>
                {r.message}
              </li>
            ))}
          </ul>
        )}
        {check.hasWord && noWord.length > 0 && (
          <p className="unchecked-part">
            <Wn />
            <span>{noWord.join('・')}は Word を入れていないので、文や書式はチェックしていません。</span>
          </p>
        )}
        {!check.hasWord ? (
          <>
            <div className="unchecked">
              <Wn />
              <div>
                <b>Word を入れていないので、チェックしていません</b>
                <small>
                  文の書き方などは確かめていません。{anyPdf ? 'PDF から分かることだけ、確かめました。' : ''}
                  <span className="nb">PDF だけでも、まとめて保存できます。</span>
                </small>
              </div>
              <button type="button" className="btn quiet" onClick={onAddWord}>
                {I.word}Word を入れて、チェックする
              </button>
            </div>
            {check.findings.length > 0 && <SeverityLegend />}
            {check.oks.length > 0 && (
              <ul className="oks">
                {check.oks.map((o) => (
                  <li key={o.label}>
                    <Ok />
                    {o.label}
                    <span>{o.value}</span>
                  </li>
                ))}
              </ul>
            )}
            {list}
          </>
        ) : check.findings.length === 0 ? (
          checking ? (
            <p className="checking">
              <Spinner />
              確かめています…
            </p>
          ) : readErrors.length > 0 ? null : (
            <p className="empty-ok">
              <Ok />
              指摘はありません。{anyPdf ? '1つの PDF にまとめられます。' : ''}
            </p>
          )
        ) : (
          <>
            <p className="fix-hint">
              {I.word}
              <span>
                <span className="nb">直すのは Word で。</span>
                <span className="nb">直したら、もう一度ここに入れます。</span>
              </span>
            </p>
            <SeverityLegend />
            {pdfCount > 0 && (
              <p className="c2-legend">
                <span className="nb">指摘を押すと、そのページに枠が付きます</span>
                <span className="nb">（ページが分かるとき）</span>
              </p>
            )}
            {checking && (
              <p className="checking">
                <Spinner />
                確かめ直しています…
              </p>
            )}
            {list}
          </>
        )}
      </>
    )
  }
  return (
    <aside className={`card check c2-side${more ? ' more' : ''}`} ref={setRefs} aria-label="チェックの結果">
      <div className="sec-h">
        <h2>チェックの結果</h2>
        {!empty && check.hasWord && <Tally errors={errors} warnings={warnings} />}
      </div>
      {body}
    </aside>
  )
}

// ---- 1つにまとめる（下の帯） ----

interface MergeBarProps {
  fileName: string
  placeholder: string
  ready: boolean
  empty: boolean
  anyPdf: boolean
  totalPages: number
  missing: string[]
  errors: number
  hasWord: boolean
  merging: boolean
  failure: string | null
  /** 学籍番号・氏名を、学生に入れてもらう（読み取れなかったとき） */
  ask: { studentId: boolean; name: boolean } | null
  manual: { studentId: string; name: string }
  onManual: (v: { studentId: string; name: string }) => void
  onMerge: () => void
}

function MergeBar({ fileName, placeholder, ready, empty, anyPdf, totalPages, missing, errors, hasWord, merging, failure, ask, manual, onManual, onMerge }: MergeBarProps) {
  const mergeSlow = useSlow(merging)
  let small: ReactNode = `${totalPages}ページ${missing.length ? `（${missing.join('・')}はまだ）` : ''}`
  let note: ReactNode = null
  if (empty) {
    small = 'この名前で保存します（学籍番号と氏名は、表紙から読み取ります）'
    note = <p className="m-note">PDF を入れると、まとめられます</p>
  } else if (!anyPdf) {
    small = 'PDF がまだありません'
    note = <p className="m-note">PDF は、Word の「名前を付けて保存」で作って、ここに入れます</p>
  } else if (failure) note = <p className="m-note ng">{failure}</p>
  else if (errors > 0)
    note = (
      <p className="m-note">
        <b>エラーが{errors}件</b>残っています
      </p>
    )
  else if (!hasWord) note = <p className="m-note warn">チェックなしで、まとめます</p>
  // まとめている間：ボタンに回る印と「まとめています…」。2秒を過ぎたら、ボタンの横のひとことを「数秒かかることがあります」に
  if (mergeSlow) note = <p className="m-note slow-note on">数秒かかることがあります</p>
  const asking = ask && (ask.studentId || ask.name)
  return (
    <footer className={`merge${anyPdf ? '' : ' wait'}`}>
      <div className="merge-in">
        <div className="m-file">
          {I.pdf}
          <div>
            <b>
              <FileName name={empty ? placeholder : fileName} />
            </b>
            <small>{small}</small>
            {asking && (
              <div className="m-ask">
                <span>表紙から読み取れなかったので、入れてください：</span>
                {ask.studentId && (
                  <label>
                    学籍番号
                    <input value={manual.studentId} inputMode="text" autoComplete="off" onChange={(e) => onManual({ ...manual, studentId: e.target.value.replace(/[\s/\\:*?"<>|]/g, '') })} />
                  </label>
                )}
                {ask.name && (
                  <label>
                    氏名
                    <input value={manual.name} autoComplete="off" onChange={(e) => onManual({ ...manual, name: e.target.value.replace(/[/\\:*?"<>|]/g, '') })} />
                  </label>
                )}
              </div>
            )}
          </div>
        </div>
        <span className="spacer" />
        {note}
        <button type="button" className="btn primary big" disabled={!ready} onClick={onMerge}>
          {merging ? <Spinner /> : I.pdf}
          {merging ? 'まとめています…' : '1つの PDF にまとめる'}
        </button>
      </div>
    </footer>
  )
}

// ---- 保存した（学生用ツールの「PDFを書き出す」と同じ形） ----

function FileBox({ name, note, children }: { name: string; note: string; children?: ReactNode }) {
  return (
    <div className="pdf-file">
      {I.pdf}
      <div>
        <b>
          <FileName name={name} />
        </b>
        <small>{note}</small>
        {children}
      </div>
    </div>
  )
}

function Saved({
  phase,
  ref,
  onOpen,
  onAgain,
  onShare,
  onStartOver,
}: {
  phase: Extract<Phase, { kind: 'done' }>
  ref: React.Ref<HTMLDivElement>
  onOpen: () => void
  onAgain: () => void
  onShare: () => void
  onStartOver: () => void
}) {
  const { pdf, mode, size, saved } = phase
  if (mode === 'share')
    return (
      <div className="card c2-saved" ref={ref} tabIndex={-1} role="region" aria-label="PDF ができました">
        <h2 className="r-title">PDF ができました</h2>
        <FileBox name={pdf.fileName} note={size} />
        <p className="r-lead">
          {saved === 'shared'
            ? '保存しました。ほかの場所にも保存するときは、もう一度「保存する」を押します。'
            : saved === 'fallback'
              ? '保存の画面を開けなかったため、ダウンロードしました。「PDF を開く」からも保存できます。'
              : '「保存する」を押して、「"ファイル"に保存」を選んでください。'}
        </p>
        <button type="button" className="btn primary pdf-save" onClick={onShare}>
          {I.share}
          {saved ? 'もう一度保存する' : '保存する'}
        </button>
        <div className="row-buttons">
          <button type="button" className="link" onClick={onOpen}>
            PDF を開く
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onStartOver}>
            はじめから
          </button>
        </div>
      </div>
    )
  return (
    <div className="card c-saved" ref={ref} tabIndex={-1} role="region" aria-label="保存しました">
      <h2 className="r-title">
        <span className="pdf-ok">{I.check}</span>保存しました
      </h2>
      <FileBox name={pdf.fileName} note={`${size}　「ダウンロード」のフォルダ`}>
        <button type="button" className="link again" onClick={onAgain}>
          保存されていないときは、もう一度保存
        </button>
      </FileBox>
      <button type="button" className="btn" onClick={onStartOver}>
        はじめから
      </button>
      <button type="button" className="btn primary" onClick={onOpen}>
        {I.open}PDF を開く
      </button>
    </div>
  )
}

// ---- 窓 ----

/**
 * 確かめの窓。エラーが残ったまま（作品写真などがないまま）「1つの PDF にまとめる」を押したとき（はじめは「戻って直す」）と、「はじめから」を押したとき。
 * 窓の外を押しても閉じない（「まとめる」をダブルクリックすると、2回目が窓の外に当たって、すぐ閉じてしまうため）。Esc では閉じる
 */
function ConfirmDialog({
  title,
  lead = 'このまままとめますか？',
  sub,
  goLabel = 'このまままとめる',
  goClass = 'go-merge',
  backLabel = '戻って直す',
  onBack,
  onGo,
}: {
  title: string
  lead?: string
  sub: string[]
  goLabel?: string
  goClass?: string
  backLabel?: string
  onBack: () => void
  onGo: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref, onBack)
  return (
    <div className="modal-backdrop">
      <div className="modal confirm" role="alertdialog" aria-modal="true" aria-labelledby="cf-title" aria-describedby="cf-lead" ref={ref}>
        <header>
          <h2 id="cf-title">
            <span className="pdf-ng">{I.warn}</span>
            {title}
          </h2>
        </header>
        <p className="r-lead" id="cf-lead">
          {lead}
        </p>
        {sub.map((line) => (
          <p key={line} className="cf-sub">
            {line}
          </p>
        ))}
        <div className="row-buttons">
          <span className="spacer" />
          <button type="button" className={`btn ${goClass}`} onClick={onGo}>
            {goLabel}
          </button>
          <button type="button" className="btn primary go-back" data-autofocus onClick={onBack}>
            {backLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 「使い方」（短く。3つの手順） */
function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="使い方" onClose={onClose} className="help">
      <ol className="help-steps">
        <li>
          <b>Word で PDF を作る</b>
          <span>Windows：「ファイル → 名前を付けて保存」→ 種類を「PDF」</span>
          <span>Mac：「ファイル → 名前を付けて保存」→ 形式を「PDF」</span>
          {/* スマホの Word アプリのメニューの名前は、版によって違うため、手順は細かく書かない */}
          <span>スマホの Word：メニューの「エクスポート」か「共有」から PDF に（できればパソコンで）</span>
        </li>
        <li>
          <b>ここに全部入れる</b>
          <span>PDF（4つ）と作品写真を入れます。Word（4つ）も入れると、文や書式もチェックします。名前はそのままで大丈夫です。</span>
        </li>
        <li>
          <b>直して、入れ直す</b>
          <span>指摘は Word で直し、PDF を作り直して、もう一度入れます。最後に「1つの PDF にまとめる」。</span>
        </li>
      </ol>
      <p className="help-safe">
        {I.lock}ファイルは外に送りません（この端末の中だけで読みます）
      </p>
      <div className="row-buttons">
        <span className="spacer" />
        <button type="button" className="btn primary" onClick={onClose}>
          閉じる
        </button>
      </div>
    </Modal>
  )
}

/** 作品写真の枚数とページ数（「写真 5枚・2ページ」。1ページなら「写真 3枚」。入れた順に4枚ずつのページ。mockups/v38 案1）。photo：前に「写真 」を付ける */
function photoCountText(count: number, photo = true): string {
  const pages = Math.ceil(count / PHOTOS_PER_PAGE)
  return `${photo ? '写真 ' : ''}${count}枚${pages > 1 ? `・${pages}ページ` : ''}`
}

/** 作品写真の「並べ替え・外す」の小さな窓（写真の順番を変える・外す・足す。mockups/v31 案A） */
function PhotoMenu({ photos, max, rect, onMove, onRemove, onAdd, onClose }: { photos: PhotoItem[]; max: number; rect: DOMRect; onMove: (id: number, dir: -1 | 1) => void; onRemove: (id: number) => void; onAdd: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref, onClose)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const margin = 8
    el.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - el.offsetWidth - margin))}px`
    const below = rect.bottom + 6
    el.style.top = `${below + el.offsetHeight > window.innerHeight - margin ? Math.max(margin, rect.top - el.offsetHeight - 6) : below}px`
  }, [rect, photos.length])
  return (
    <div className="popover-backdrop" onMouseDown={onClose}>
      <div className="popover photo-menu" ref={ref} role="dialog" aria-label="作品写真の並べ替え・外す" onMouseDown={(e) => e.stopPropagation()}>
        <div className="popover-title">
          <b>作品写真</b>
          {photoCountText(photos.length, false)}（1ページに{PHOTOS_PER_PAGE}枚まで）
        </div>
        <ol>
          {photos.map((p, i) => (
            <Fragment key={p.id}>
              {/* 何ページかになるときは、ページの区切り「1ページ目 4枚」（入れた順に4枚ずつ。mockups/v38 案1） */}
              {photos.length > PHOTOS_PER_PAGE && i % PHOTOS_PER_PAGE === 0 && (
                <li className="pm-page" aria-hidden="true">
                  {i / PHOTOS_PER_PAGE + 1}ページ目<span>{Math.min(PHOTOS_PER_PAGE, photos.length - i)}枚</span>
                </li>
              )}
            <li>
              <img src={p.photo.url} alt="" />
              <span className="pm-name">
                {i + 1}. <FileName name={p.file.name} oneLine />
              </span>
              <button type="button" className="pm-b" aria-label={`「${p.file.name}」を前へ`} disabled={i === 0} onClick={() => onMove(p.id, -1)}>
                ↑
              </button>
              <button type="button" className="pm-b" aria-label={`「${p.file.name}」を後ろへ`} disabled={i === photos.length - 1} onClick={() => onMove(p.id, 1)}>
                ↓
              </button>
              <button type="button" className="pm-b x" aria-label={`「${p.file.name}」を外す`} onClick={() => onRemove(p.id)}>
                {I.x}
              </button>
            </li>
            </Fragment>
          ))}
        </ol>
        {photos.length < max && (
          <button
            type="button"
            className="pm-add"
            onClick={() => {
              onClose()
              onAdd()
            }}
          >
            {I.plus}写真を足す
          </button>
        )}
        <p className="pm-hint">{PHOTOS_PER_PAGE}枚ずつ、この順にページに並べます。写真は切らずに入れます。</p>
      </div>
    </div>
  )
}

/** ファイルの名前を押したときの小さな窓：ほかの場所に移す・外す（名前で分けた場所が違ったとき） */
function MoveMenu({ entry, from, rect, onMove, onRemove, onClose }: { entry: Entry; from: SlotKey; rect: DOMRect; onMove: (to: PartId) => void; onRemove: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref, onClose)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const margin = 8
    el.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - el.offsetWidth - margin))}px`
    const below = rect.bottom + 6
    el.style.top = `${below + el.offsetHeight > window.innerHeight - margin ? Math.max(margin, rect.top - el.offsetHeight - 6) : below}px`
  }, [rect])
  const [fromPart, fromSlot] = from.split(':') as [PartId, SlotKind]
  // Word は表紙〜本文へ、PDF はどこへでも（作品写真へも）、写真は作品写真だけ
  const targets = PARTS.filter((p) => p.id !== fromPart && (fromSlot === 'pdf' ? entry.kind !== 'image' : p.id !== 'photo'))
  return (
    <div className="popover-backdrop" onMouseDown={onClose}>
      <div className="popover move-menu" ref={ref} role="dialog" aria-label={`「${entry.file.name}」を移す・外す`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="popover-title">
          <FileName name={entry.file.name} />
        </div>
        {targets.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              onClose()
              onMove(p.id)
            }}
          >
            {slotLabel(p.id, fromSlot)}に移す
          </button>
        ))}
        <button
          type="button"
          className="danger"
          onClick={() => {
            onClose()
            onRemove()
          }}
        >
          外す
        </button>
      </div>
    </div>
  )
}
