import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { currentConfig, findCourse, type YearConfig } from './config'
import { loadYearConfig, sameConfig, startConfigLoad, type ConfigSource } from './config/remote'
import { ReportEditor, type EditorSnapshot } from './editor/reportEditor'
import { preloadGis } from './drive/driveApi'
import { DriveSync, hasContent, type DriveState, type RemoteCopy, type Resolution } from './drive/driveSync'
import { studentIdFromEmail } from './model/account'
import { backupFileName, createBackup, readBackup } from './model/backup'
import { createReport } from './model/newReport'
import { trialMode } from './model/scope'
import { allImages, clearAll, listSnapshots, loadReport, keepSnapshot, putImage, saveSnapshot, usedImageIds, type Snapshot } from './model/storage'
import type { Report } from './model/types'
import type { WordImportResult } from './import/types'
import { Spinner, WaitToast } from './app/Busy'
import { ImageWorkToast } from './app/ImageWork'
import { ImageWork } from './app/imageWorkStore'
import { nextPaint, useSlow } from './app/useBusy'
import { BackupDialog, CourseChangeDialog, CourseMenu, ReferencesDialog } from './app/dialogs'
import { ExportDialog } from './app/ExportDialog'
import { ConflictDialog, IdMismatchDialog, LoginGate, OtherAccountDialog, ReloginDialog, WipeDialog, type DriveControls, type GateState } from './app/DriveUi'
import { Icon } from './app/icons'
import { loadPlace, openLastPlace, useRememberPlace, useRememberZoom } from './app/lastPlace'
import { Palette, ViewBar } from './app/Palette'
import { PageBand } from './app/PageBand'
import { TocNotice } from './app/TocNotice'
import { PhoneChrome } from './app/Phone'
import { readPhoneDirect, useNoFocusZoom } from './app/phoneDirect'
import { UndoBar } from './app/UndoBar'
import { useUndoNotice } from './app/useUndoNotice'
import { useKeyboardInset, useNarrow, useSwipe, useWheelPaging } from './app/uiShared'
import { topicsForTouch } from './app/bandText'
import { SidePanel, PageColumn } from './app/SidePanel'
import { StartGuide, type GuideStep } from './app/StartGuide'
import { TabLockedOverlay } from './app/TabLock'
import { Tour } from './app/Tour'
import { firstOpenInTab, forgetGuide, guideLeftAt, markTourSeen, markTourShown, rememberGuide, tourSeen } from './app/tourMemory'
import { useTabLock } from './app/useTabLock'
import { useTokenRenewal } from './app/useTokenRenewal'
import { useDrivePdf } from './app/useDrivePdf'
import { usePdfCopy } from './app/usePdfCopy'
import { useAutosave } from './app/useAutosave'
import { usePanelWidths } from './app/usePanelWidths'
import { WordImportDialog, WordTodoCard } from './app/WordImport'
import { useAsk } from './app/ask'
import { NewVersionBanner, useNewVersion } from './app/newVersion'
import { useKeepWritingVisible, writingArea } from './app/writingArea'
import { useWordTodo, wordImportOffered } from './app/useWordTodo'
import { HelpView } from './help/HelpView'
import { STUDENT_TOPICS } from './help/helpTopics'
import { STUDENT_GUIDE_PATH, STUDENT_HELP_IMAGES } from './help/links'
import { freshSample, openTrial, TrialMissingError } from './trial/openTrial'
import { TrialBanner } from './trial/TrialBanner'

const noopSubscribe = () => () => {}
/** スマホの「？ 使い方」の項目（「クリック」を「タップ」に。PC は STUDENT_TOPICS のまま） */
const STUDENT_TOPICS_TOUCH = topicsForTouch(STUDENT_TOPICS)
const nullSnapshot = () => null

type Dialog =
  | { kind: 'export' }
  | { kind: 'references' }
  /** snapshots：自動の控え（読み込んでいる間は null。窓はすぐ開く） */
  | { kind: 'backup'; snapshots: Snapshot[] | null }
  | { kind: 'course'; rect: DOMRect }
  | { kind: 'courseChange'; courseId: string }
  /** 今年度だけ：Word から読み込む（mockups/v24） */
  | { kind: 'word' }
  | null

/** 組み直しが終わるのを待つ */
const rendered = (ed: ReportEditor) =>
  new Promise<void>((resolve) => {
    if (!ed.getSnapshot().rendering) return resolve()
    const off = ed.subscribe(() => {
      if (ed.getSnapshot().rendering) return
      off()
      resolve()
    })
  })

/** 表紙の項目のうち、まだ入っていない最初のもの（はじめての案内で、その項目から案内する） */
const firstEmptyCoverStep = (report: Report): GuideStep | null => {
  const b = report.basicInfo
  return !b.studentId.trim() ? 'studentId' : !b.name.trim() ? 'name' : !b.subtitleInput.trim() ? 'subtitle' : null
}

/**
 * 原稿を Google ドライブにも保存する（ログイン必須。mockups/v18 案3・v19 案A）。
 * クライアント ID がなければ、今まで通りこの端末だけに保存する。開発中は ?nodrive で外せる（自動テスト用）。
 * お試し（?trial=1：先生が見本の原稿で試す。src/trial/）は、ドライブにつながない（ログインもしない）
 */
const DRIVE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
const DRIVE_ENABLED = !!DRIVE_CLIENT_ID && !trialMode && !((import.meta.env.DEV || import.meta.env.MODE === 'e2e') && new URLSearchParams(location.search).has('nodrive'))

type DriveDialog =
  | { kind: 'conflict'; remote: RemoteCopy; atLogin: boolean }
  | { kind: 'wipe' }
  | { kind: 'otherAccount'; previousEmail: string; unsynced: boolean }
  /** 表紙の学籍番号と、ログインしたアカウントが違う（どの原稿で始めるかは、選んでから続ける） */
  | { kind: 'idMismatch'; resolution: Resolution; coverId: string; accountId: string }
  | null

/** 学籍番号が違っていても「このまま続ける」を選んだ組み合わせ（次からは聞かない） */
const ID_OK_KEY = 'sotsugyo-seisaku-report-id-ok'
const idAccepted = (email: string, coverId: string) => {
  try {
    return localStorage.getItem(ID_OK_KEY) === `${email}|${coverId}`
  } catch {
    return false
  }
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * 開くまでの時間を測るための印（ブラウザの開発ツールの「パフォーマンス」や、自動の測定 poc-output/phone-speed/ で見る）。
 * 画面にも原稿にも何も変えない
 */
const markOpen = (name: string) => performance.mark(`open:${name}`)

/**
 * 原稿の年度の設定（公開中の年度と違う原稿を開いたとき）。2回目から（quick）は、このブラウザの控えですぐ。
 * そうでなければ窓口の返事を待つ。読めなければ控え、それもなければ同梱の初期値（同じ年度のとき。config/remote.ts の loadYearConfig と同じ順）
 */
async function yearConfigOf(year: number, load: { cached: YearConfig | null; remote: Promise<YearConfig | null> }, quick: boolean): Promise<YearConfig | null> {
  if (quick && load.cached) return load.cached
  return (await load.remote) ?? load.cached ?? (currentConfig.fiscalYear === year ? currentConfig : null)
}

/** Word から読み込む直前の原稿の控えの名前（「バックアップ・作り直す」の控えの一覧に出す） */
const WORD_SNAPSHOT_LABEL = 'Word を読み込む前'
/** コースを変えて「下書きを入れ替える」直前の原稿の控えの名前（どの控えに戻せばよいか分かるように） */
const REPLACE_SNAPSHOT_LABEL = '下書きを入れ替える前'

/**
 * 控え・バックアップファイルに戻すとき、コースも変わるなら、確かめる文に足す一言（変わらなければ空）。
 * 前は、「下書きを入れ替える」でコースを変えたあと「この時点に戻す」を押すと、黙ってコースも前に戻り、
 * 表紙と抄録（指導教員はコースで決まる）が、違うコースのまま PDF になっていた
 */
function courseChangeNote(config: YearConfig, current: Report, restored: Report): string {
  const to = restored.basicInfo.courseId
  if (current.basicInfo.courseId === to) return ''
  if (!to) return '\nコースも、選んでいない状態に戻ります'
  const name = findCourse(config, to)?.name
  return name ? `\nコースも「${name}」に戻ります（表紙と抄録の指導教員も、そのコースになります）` : '\nコースも、その控えのときのコースに戻ります'
}

/** 写真を選ぶ画面を開き、選ばれたファイルを返す（やめたら null） */
function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => resolve(null), { once: true })
    input.click()
  })
}

/** 写真を何枚かまとめて選ぶ画面を開き、選ばれたファイルを返す（作品写真の空いている枠。やめたら空） */
function pickImageFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.addEventListener('change', () => resolve([...(input.files ?? [])]), { once: true })
    input.addEventListener('cancel', () => resolve([]), { once: true })
    input.click()
  })
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 文字を入力している場所（ここでは ←→ などのキーをページ送りに使わない） */
const isTyping = (target: EventTarget | null) => !!(target as HTMLElement | null)?.closest?.('.overlay-editor, input, textarea, select, [contenteditable]')

export default function App() {
  const stageRef = useRef<HTMLElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const sheetHostRef = useRef<HTMLDivElement>(null)
  const started = useRef(false)
  const [config, setConfig] = useState<YearConfig>(currentConfig)
  const [editor, setEditor] = useState<ReportEditor | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  // 確認の窓・知らせの窓（画面の中に出す。前はブラウザの confirm・alert で、iPhone の Chrome などで出ないことがあった：app/ask.tsx）
  const ask = useAsk()
  // 新しい版の知らせ（× で閉じたら、この画面では出さない）
  const newVersion = useNewVersion()
  const [newVersionClosed, setNewVersionClosed] = useState(false)
  // 目次のページの、行のない所を押した点（目次は自動であることを、その近くに知らせる：mockups/v41 案B。app/TocNotice.tsx）
  const [tocPoint, setTocPoint] = useState<{ x: number; y: number } | null>(null)
  const closeTocNotice = useCallback(() => setTocPoint(null), [])
  const [loadError, setLoadError] = useState<string | null>(null)
  // お試し：管理ページから開いていない（見本の原稿を受け取れなかった）
  const [trialMissing, setTrialMissing] = useState(false)
  // はじめて使う学生への案内（コース →（今年度だけ）Word で書き始めているか → 学籍番号 → 氏名 → サブタイトル）
  const [guide, setGuide] = useState<GuideStep | null>(null)
  // 使い方（ヘルプ）：PC は右の欄が使い方に替わり、スマホは画面いっぱいの欄（mockups/v27 案A）
  const [help, setHelp] = useState(false)
  // 指差し確認（mockups/v27 案A）：出したい（tourWanted）→ ほかの窓や案内がなく、紙面が落ち着いたら出す（tourOn）
  const [tourWanted, setTourWanted] = useState(false)
  const [tourOn, setTourOn] = useState(false)
  const [configSource, setConfigSource] = useState<ConfigSource>('remote')
  // はじめて開いた（この端末に原稿がない）。紙面の準備に数秒かかるので、そう知らせる（2回目からは、先に見せるページがすぐ出る）
  const [firstOpen, setFirstOpen] = useState(false)
  // 閉じる・読み込み直す直前に、書いている欄のまだ原稿に入っていない文字（変換中など）を原稿に入れてから保存する
  const autosave = useAutosave(() => editorRef.current?.saveEditing())
  const snap = useSyncExternalStore(editor?.subscribe ?? noopSubscribe, editor?.getSnapshot ?? nullSnapshot) as EditorSnapshot | null
  // 今年度だけ：Word から写したあとの「つぎにすること」（閉じるまで、この端末に覚えておく）
  const { todo: wordTodo, update: setWordTodo } = useWordTodo(snap)
  // PC：削除したあとの「戻す」の知らせ（出しておく時間が過ぎたら閉じる。mockups/v32 ② 案A）
  const undoNotice = useUndoNotice(snap)
  /** スマホ：Word から写し終えたら、チェックの欄を開く（増やすと開く） */
  const [checkRequest, setCheckRequest] = useState(0)
  // ドライブ（ログイン必須）。このタブでログイン済みなら、ボタンを押さずに始める
  const [drive] = useState(() => (DRIVE_ENABLED ? new DriveSync(DRIVE_CLIENT_ID!) : null))
  const driveState = useSyncExternalStore(drive?.subscribe ?? noopSubscribe, drive?.getState ?? nullSnapshot) as DriveState | null
  const [gate, setGate] = useState<GateState | null>(() => (drive ? (drive.restoreToken() ? { kind: 'loading' } : { kind: 'login' }) : null))
  const [driveDialog, setDriveDialog] = useState<DriveDialog>(null)
  const [driveBusy, setDriveBusy] = useState(false)
  /** どちらの原稿で続けるかの窓で、選んだほうを開いている・保存している途中（押したボタンに「開いています…」など） */
  const [conflictBusy, setConflictBusy] = useState<'remote' | 'local' | null>(null)
  /**
   * 選んだ写真を縮めて保存している間（紙面の上に「写真を取り込んでいます…」。依頼者の要望 2026-10-20。app/ImageWork.tsx）。
   * 画面全体を描き直さないよう、知らせの部品だけが見張る
   */
  const [imageWork] = useState(() => new ImageWork())
  const [reloginError, setReloginError] = useState<string | null>(null)
  /** 「もう一度ログイン」の窓を「あとで」にした（しばらく出さない） */
  const [reloginLater, setReloginLater] = useState(false)
  /** 管理ページでドライブ保存を止めている（Google の障害など）。ログインせずに書け、原稿はこの端末にだけ保存する */
  const [driveStopped, setDriveStopped] = useState(false)
  const stoppedRef = useRef(false)
  // 同じパソコンで2つめのタブを開いたら、そのタブでは書けないようにする（mockups/v22 ③）。取り上げられたら、送っていない変更を保存する
  const tabLock = useTabLock(() => {
    editorRef.current?.commitEditing()
    void autosave.flush()
    void drive?.flush()
  })
  const editorRef = useRef<ReportEditor | null>(null)
  /**
   * ページを読み込み直す（新しい版にする。依頼者の選択 2026-10-23）：書いている字を原稿に入れ、この端末とドライブに保存してから。
   * ドライブは、つながらないときに待ち続けないよう、5秒まで待つ（この端末には保存してあり、読み込み直したあとに送る）
   */
  const reloadTool = async () => {
    editorRef.current?.commitEditing()
    await autosave.flush()
    if (drive) await Promise.race([drive.flush(), new Promise((r) => setTimeout(r, 5000))])
    location.reload()
  }
  // 最後に見ていたページ：開いたときにそのページを見せ（placeOpened）、そのあとは見ているページを覚える（別のタブで開いて書けない間は覚えない）
  const [placeOpened, setPlaceOpened] = useState(false)
  useRememberPlace(editor, snap, placeOpened && !tabLock.locked)
  const configRef = useRef<YearConfig>(currentConfig)
  /** 公開中の年度の設定（「最初から作り直す」は、公開中の年度で作る） */
  const publishedRef = useRef<YearConfig>(currentConfig)
  /** 開いたときに、この端末にあった原稿（なければ null） */
  const localAtStart = useRef<Report | null>(null)
  // スマホ（画面の幅が狭いとき）は、並べ方と書き方を変える
  const narrow = useNarrow()
  // スマホは紙面に直接書く（予備：リンクの ?direct=0 で、その端末だけ前の「下から出る書く欄」に。app/phoneDirect.ts）
  const [direct] = useState(readPhoneDirect)
  const phoneDirect = narrow && direct
  // 紙面に直接書く間、iPhone で書き始めるたびに画面が勝手に拡大されないようにする
  useNoFocusZoom(phoneDirect)
  const panels = usePanelWidths()
  const hasLayout = !!snap?.layout
  useKeyboardInset()
  useSwipe(stageRef, editor, narrow)
  // ホイールでページを送る（コースを選ぶ案内・Word で書き始めているかを聞く案内や、画面の上に出る窓が開いている間は送らない）
  useWheelPaging(stageRef, scrollerRef, editor, !dialog && !gate && !driveDialog && !tabLock.locked && !tourOn && guide !== 'course' && guide !== 'word')
  useEffect(() => {
    if (!editor || !hasLayout) return
    editor.setSheetHost(narrow ? sheetHostRef.current : null, phoneDirect)
    // スマホ：書いている欄を、上の案内・下の書く欄・キーボードに隠れない所に見せる（app/writingArea.ts）
    editor.setVisibleArea(narrow ? writingArea : null)
  }, [editor, narrow, hasLayout, phoneDirect])
  useKeepWritingVisible(editor, snap?.editingId ?? null, narrow, guide)
  // PC：表示の大きさ（全体・拡大）も覚えて、開いたときに戻す（上の setSheetHost が「全体」にしたあとで戻すため、ここに置く）
  useRememberZoom(editor, snap, placeOpened && !tabLock.locked, narrow)

  // はじめて開いたときは、コースを選ぶところから案内する（コースが1つだけなら学籍番号から）。コースを選んでいない原稿も、コースを選ぶ案内を出す。
  // 今年度だけ、コースが決まっている新しい原稿は、Word で書き始めているかを聞くところから。
  // 案内を出さないとき（書き始めている原稿を開いた）は、この端末でまだ見ていなければ、指差し確認を出す
  // （このツールに指差し確認ができる前に、案内を終えていた学生にも1回。ログインやどの原稿で続けるかが決まってから呼ばれる）。
  // ただし、このタブで書いている途中に読み込み直したときは出さない（次に開いたときに出す。tourMemory.ts の firstOpenInTab）。
  // 案内を閉じず・終えずに読み込み直した（タブを閉じた）原稿は、表紙の項目がまだ空いていれば、案内の続きから出す
  // （「Word で書き始めていますか？」の途中ならそこから、ほかは空いている最初の項目から。tourMemory.ts の guideLeftAt）
  const startGuide = useCallback((cfg: YearConfig, report: Report, isNew: boolean) => {
    if (!findCourse(cfg, report.basicInfo.courseId)) setGuide('course')
    else if (isNew) setGuide(wordImportOffered(cfg) ? 'word' : report.basicInfo.studentId.trim() ? 'name' : 'studentId')
    else {
      // コースを選ぶ段階で止まっていた（コースの一覧を読めなかったなど）ときは、続きを出さない（コースは、その案内の外で決まっている）
      const left = guideLeftAt()
      const empty = firstEmptyCoverStep(report)
      if (left && left !== 'course' && empty) setGuide(left === 'word' && wordImportOffered(cfg) ? 'word' : empty)
      else {
        if (left) forgetGuide()
        if (!tourSeen() && firstOpenInTab()) setTourWanted(true)
      }
    }
  }, [])

  // 案内を出している段階を、この端末に覚える（閉じた・終えたら消す。開いた直後の、まだ案内を出していないときは消さない）
  const guideShown = useRef(false)
  useEffect(() => {
    if (guide && guide !== 'done') {
      guideShown.current = true
      rememberGuide(guide)
    } else if (guideShown.current) forgetGuide()
  }, [guide])

  /** 学生のアカウントなら、表紙の学籍番号が空のときだけ、メールアドレスの学籍番号を入れる（学生は直せる） */
  const prefillStudentId = useCallback(
    (ed: ReportEditor) => {
      const id = drive ? studentIdFromEmail(drive.getState().email, configRef.current.studentIdPattern) : null
      if (id && !ed.getSnapshot().report.basicInfo.studentId.trim()) ed.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, studentId: id } }))
    },
    [drive],
  )

  /** 原稿の年度が今の設定と違えば、その年度の設定に切り替える（別の年度の原稿を開いたとき。読めなければ今のまま） */
  const matchYear = useCallback(async (ed: ReportEditor, report: Report) => {
    if (report.fiscalYear === configRef.current.fiscalYear) return
    const yearConfig = report.fiscalYear === publishedRef.current.fiscalYear ? publishedRef.current : await loadYearConfig(report.fiscalYear)
    if (!yearConfig) return
    // 読めた設定に原稿のコースがない（同梱の初期値しか読めなかったなど）なら、コースのある今の設定のままにする
    const courseId = report.basicInfo.courseId
    if (courseId && !findCourse(yearConfig, courseId) && findCourse(configRef.current, courseId)) return
    configRef.current = yearConfig
    setConfig(yearConfig)
    ed.setConfig(yearConfig)
  }, [])

  /** ドライブの原稿を開く（写真を読み込んでから、原稿を入れ替える。それまでの原稿は控えに残す） */
  const openRemote = useCallback(
    async (ed: ReportEditor, remote: RemoteCopy) => {
      if (!drive) return
      setGate({ kind: 'loading' })
      const current = ed.getSnapshot().report
      if (hasContent(current)) await keepSnapshot(current)
      ed.addImages(await drive.downloadImages(remote.report, (done, total) => setGate({ kind: 'loading', done, total })))
      ed.replace(remote.report)
      drive.adopt(remote, ed.getSnapshot().report)
      await matchYear(ed, remote.report)
    },
    [drive, matchYear],
  )

  /**
   * 表紙の学籍番号が、ログインしたアカウントの学籍番号と違うか（共用のパソコンで、ほかの人の原稿が残っていた・打ち間違い）。
   * 教職員のアカウント（学籍番号の形でないアドレス）と、何も書いていない原稿は見ない
   */
  const idMismatch = useCallback(
    (report: Report): { coverId: string; accountId: string } | null => {
      const email = drive?.getState().email ?? null
      const accountId = studentIdFromEmail(email, configRef.current.studentIdPattern)
      const coverId = report.basicInfo.studentId.trim()
      if (!email || !accountId || !coverId || !hasContent(report)) return null
      if (coverId.normalize('NFKC').toUpperCase() === accountId || idAccepted(email, coverId)) return null
      return { coverId, accountId }
    },
    [drive],
  )

  /**
   * どの原稿で始めるか（続けるか）が決まったら、そのとおりにする。atLogin：ログインした直後。
   * idChecked：表紙の学籍番号の確かめが済んでいる
   */
  const applyResolution = useCallback(
    async (ed: ReportEditor, r: Resolution, atLogin: boolean, idChecked = false): Promise<void> => {
      if (!drive) return
      // この端末の原稿を使う（ドライブに送る）前に、表紙の学籍番号がこのアカウントのものかを確かめる（ログインの窓は出したまま）
      const mismatch = atLogin && !idChecked && (r.kind === 'local' || r.kind === 'conflict') ? idMismatch(ed.getSnapshot().report) : null
      if (mismatch) {
        setDriveDialog({ kind: 'idMismatch', resolution: r, ...mismatch })
        return
      }
      switch (r.kind) {
        case 'new':
        case 'local': {
          setGate(null)
          const report = ed.getSnapshot().report
          drive.activate(r.kind === 'local' && r.upload ? report : undefined)
          if (atLogin) {
            prefillStudentId(ed)
            startGuide(configRef.current, ed.getSnapshot().report, r.kind === 'new')
          }
          else if (r.kind === 'local' && !r.upload) void ask.alert('ドライブの原稿は、この端末の原稿と同じです（最新です）')
          return
        }
        case 'remote':
          await openRemote(ed, r.remote)
          setGate(null)
          drive.activate()
          if (atLogin) {
            prefillStudentId(ed)
            // ドライブの原稿の年度に切り替えたあとの設定で決める
            startGuide(configRef.current, ed.getSnapshot().report, false)
          }
          // 「ドライブの原稿を読み込み直す」で、ドライブの原稿に入れ替えた：画面の下に知らせる
          else ed.showNotice('ドライブの原稿を読み込みました')
          return
        case 'conflict':
          setGate(null)
          setDriveDialog({ kind: 'conflict', remote: r.remote, atLogin })
          return
        case 'otherAccount':
          setDriveDialog({ kind: 'otherAccount', previousEmail: r.previousEmail, unsynced: r.unsynced })
          return
      }
    },
    [drive, openRemote, startGuide, prefillStudentId, idMismatch],
  )

  /**
   * ログインしたあと：ドライブの原稿と比べて、どの原稿で始めるかを決める。
   * ログインの完了と紙面の準備がほぼ同時だと2回呼ばれることがあるので、1回だけにする（2回だとフォルダが2つできることがある）
   */
  const entering = useRef(false)
  const enter = useCallback(
    async (ed: ReportEditor) => {
      if (!drive || entering.current) return
      entering.current = true
      setGate({ kind: 'loading' })
      try {
        await applyResolution(ed, await drive.resolve(localAtStart.current), true)
      } catch (e) {
        entering.current = false
        setGate({ kind: 'error', message: errorText(e) })
      }
    },
    [drive, applyResolution],
  )

  /** 開いたときの準備（原稿を読み、最初の紙面を組み終えるまで）が済んだ */
  const startedUp = useRef(false)

  /**
   * 控えの設定で開いたとき（2回目から）：窓口から読んだ設定が控えと違えば、入れ替える（管理ページで直した題目・コースの名前などを、開いている紙面にも出す）。
   * used：開いたときに使った公開中の年度の設定。year：原稿の年度が公開中の年度と違い、その年度の控えで開いたとき、その窓口の返事と使った設定
   */
  const refreshConfig = useCallback(
    async (ed: ReportEditor, remote: Promise<YearConfig | null>, used: YearConfig, year: { remote: Promise<YearConfig | null>; used: YearConfig } | null) => {
      const fresh = await remote
      if (fresh && !sameConfig(fresh, used)) {
        publishedRef.current = fresh
        if (configRef.current === used) {
          configRef.current = fresh
          setConfig(fresh)
          ed.setConfig(fresh)
        }
        // 管理ページでドライブ保存を止めた（Google の障害など）：まだログインして始めていなければ、ログインせずに書けるようにする
        if (drive && fresh.driveSave === 'off' && !stoppedRef.current && !entering.current) {
          stoppedRef.current = true
          setDriveStopped(true)
          setGate(null)
          if (startedUp.current) startGuide(configRef.current, ed.getSnapshot().report, false)
        }
      }
      const freshYear = year ? await year.remote : null
      if (!year || !freshYear || sameConfig(freshYear, year.used) || configRef.current !== year.used) return
      // 読めた年度の設定に原稿のコースがない（同梱の初期値しか読めなかったなど）なら、今のまま
      const courseId = ed.getSnapshot().report.basicInfo.courseId
      if (courseId && !findCourse(freshYear, courseId) && findCourse(year.used, courseId)) return
      configRef.current = freshYear
      setConfig(freshYear)
      ed.setConfig(freshYear)
    },
    [drive, startGuide],
  )

  useEffect(() => {
    if (started.current) return
    started.current = true
    // このタブで開くのが初めてか（書いている途中に読み込み直したのか）を、読み込んですぐ覚えておく（指差し確認を出すかに使う）
    firstOpenInTab()
    // ログインのボタンを押したとき（パソコンで許可を延ばすときも）に、すぐ Google の窓を開けるよう、部品と窓の準備を先にしておく
    if (drive) void preloadGis(DRIVE_CLIENT_ID).catch(() => {})
    void (async () => {
      try {
        // 設定は窓口から読み始め（返事には1〜数秒かかる）、待つ間に、この端末の原稿を読む。
        // お試しは、管理ページから受け取った設定と見本の原稿（このブラウザのお試しの入れ物に置いたもの）で開く
        const configLoad = trialMode ? await openTrial() : startConfigLoad()
        const saved = await loadReport()
        markOpen('report')
        localAtStart.current = saved
        // はじめて開いた（この端末に原稿がない）ときだけ、「（初回は数秒かかります）」と出す
        if (!saved) setFirstOpen(true)
        // 2回目から（この端末に原稿と、前に読み込んだ設定の控えがある）は、控えの設定ですぐ開き、窓口の返事はあとで確かめる（refreshConfig）。
        // はじめて・控えがない・控えでドライブ保存を止めていた（Google の障害など）ときは、今までどおり窓口の返事を待つ
        const quick = !!saved && !!configLoad.cached && configLoad.cached.driveSave !== 'off'
        const remote = quick ? null : await configLoad.remote
        const published = quick && configLoad.cached ? configLoad.cached : (remote ?? configLoad.cached ?? currentConfig)
        const source: ConfigSource = quick || (!remote && configLoad.cached) ? 'cache' : remote ? 'remote' : 'bundled'
        markOpen('config')
        if (drive && published.driveSave === 'off') {
          stoppedRef.current = true
          setDriveStopped(true)
          setGate(null)
        }
        publishedRef.current = published
        // 原稿は、書き始めた年度の設定で開く（新年度を公開しても、前年度の学生の表紙が新年度の題目・教員に変わらないように）
        // ただし、読めた年度の設定に原稿のコースがない（同梱の初期値しか読めなかったなど）なら、コースのある公開中の設定で開く
        const yearLoad = saved && saved.fiscalYear !== published.fiscalYear ? startConfigLoad(saved.fiscalYear) : null
        const yearConfig = saved && yearLoad ? await yearConfigOf(saved.fiscalYear, yearLoad, quick) : null
        const savedCourse = saved?.basicInfo.courseId
        const loaded = yearConfig && !(savedCourse && !findCourse(yearConfig, savedCourse) && findCourse(published, savedCourse)) ? yearConfig : published
        setConfig(loaded)
        setConfigSource(source)
        configRef.current = loaded
        // 設定を一度も読み込めていない（同梱の初期値で動く）ときは、コースを勝手に決めない
        const report = saved ?? createReport(loaded, source === 'bundled' ? '' : undefined)
        const ed = new ReportEditor(stageRef.current!, scrollerRef.current!, layerRef.current!, loaded, report, {
          onChange: (r) => {
            autosave.save(r)
            drive?.schedule(r)
          },
          onCourseClick: (rect) => setDialog({ kind: 'course', rect }),
          onReferencesClick: () => setDialog({ kind: 'references' }),
          onTocClick: (point) => setTocPoint(point),
          pickImage: pickImageFile,
          pickImages: pickImageFiles,
          onImageWork: (work) => imageWork.set(work),
          onAlert: (text) => void ask.alert(text),
        })
        ed.addImages(await allImages())
        markOpen('images')
        editorRef.current = ed
        setEditor(ed)
        // 自動テストから操作できるようにする（開発サーバーと、自動テスト用にまとめた版 vite build --mode e2e。公開する版では入らない）
        if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') Object.assign(window, { __editor: ed })
        // 控えの設定で開いたときは、窓口の返事を待って、変わっていれば入れ替える
        if (quick) void refreshConfig(ed, configLoad.remote, published, yearLoad && yearConfig === loaded ? { remote: yearLoad.remote, used: loaded } : null)
        // このタブでログイン済みなら、紙面を組むのと並べて、ドライブの原稿を確かめる（前は、紙面を組み終えてから確かめていた）
        if (drive && !stoppedRef.current && drive.tokenValid) void enter(ed)
        // 前に開いたとき最後に見ていたページを、そのページのある部分を組み終えたら先に見せる（新しい原稿は表紙から。はじめての案内が出るときは、案内が表紙に戻す）
        const laidOut = ed.renderFirst(saved ? (loadPlace()?.page ?? 0) : 0)
        // はじめて開いた（新しい原稿。ドライブに保存しないとき）：表紙が見えたら、ほかのページを組み終えるのを待たずに、はじめての案内を始める
        // （ドライブに保存するときは、ログインして、どの原稿で始めるかが決まってから：applyResolution）
        const guideEarly = !saved && (!drive || stoppedRef.current)
        if (guideEarly) {
          await ed.whenShown()
          startGuide(loaded, report, true)
        }
        await laidOut
        markOpen('layout')
        // すべて組み終えたら、覚えている欄のあるページへ（ページがずれていたとき。先に見せたページから、学生がまだ動いていなければ）
        if (saved && !ed.movedSinceFirstShow()) await openLastPlace(ed)
        markOpen('place')
        setPlaceOpened(true)
        startedUp.current = true
        if (!drive || stoppedRef.current) {
          if (!guideEarly) startGuide(loaded, report, !saved)
        }
        // 紙面の準備より先にログインが済んでいたら、ここで始める（上で始めていれば、何もしない）
        else if (drive.tokenValid) void enter(ed)
      } catch (e) {
        if (e instanceof TrialMissingError) setTrialMissing(true)
        else setLoadError(String(e))
      }
    })()
  }, [autosave, drive, enter, startGuide, refreshConfig, imageWork])

  // ほかのアプリやタブに切り替えたら、送っていない変更をすぐドライブに送る
  useEffect(() => {
    if (!drive) return
    const onHide = () => {
      if (document.visibilityState === 'hidden') void drive.flush()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [drive])

  /** 「PDFを書き出す」：紙面を組み直し終えてから窓を開く（長い原稿では数秒かかるので、その間は「確かめています…」と出す） */
  const [exporting, setExporting] = useState(false)
  // スマホ：下のタブの「PDF」は小さいので、確かめるのが2秒を過ぎたら、紙面の上にも「数秒かかることがあります」を出す（PC は右の欄のボタンの下）
  const exportSlowPhone = useSlow(exporting && narrow)
  const startExport = async () => {
    if (!editor || exporting) return
    setExporting(true)
    try {
      // ボタンの「確かめています…」を先に見せてから、紙面を組み直す（遅いスマホでは、組み直しの始めの重い処理の間、ボタンが変わらなかった）
      await nextPaint()
      editor.commitEditing()
      await editor.render()
      // 開いた直後で、先に見せたページのほかをまだ組んでいるときは、組み終えるまで待つ（全部のページがそろってから PDF にする）
      await editor.whenLaidOut()
      setDialog({ kind: 'export' })
    } finally {
      setExporting(false)
    }
  }

  // ドライブに送れていない変更があるまま閉じようとしたら、ブラウザの確認を出す（ほかの端末で古い原稿が開いたり、共用のパソコンで次の人に消されたりしないように）
  useEffect(() => {
    if (!drive) return
    const warn = (e: BeforeUnloadEvent) => {
      if (!stoppedRef.current && drive.unsent) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [drive])

  // 別の端末が、この端末より後にドライブに保存した：どちらで続けるかを選んでもらう
  const driveStatus = driveState?.status.kind
  useEffect(() => {
    if (!drive || driveStatus !== 'conflict' || driveDialog) return
    drive.fetchRemote().then(
      (remote) => {
        if (remote) setDriveDialog({ kind: 'conflict', remote, atLogin: false })
        else if (editorRef.current) void drive.overwrite(editorRef.current.getSnapshot().report)
      },
      () => {},
    )
  }, [drive, driveStatus, driveDialog])

  /** ログインのボタン（Google の窓は、押した処理の中ですぐ開く） */
  const onGateLogin = (chooseAccount = false) => {
    if (!drive) return
    setGate({ kind: 'signing' })
    drive.login({ chooseAccount }).then(
      () => {
        if (stoppedRef.current) setGate(null)
        else if (editorRef.current) void enter(editorRef.current)
        else setGate({ kind: 'loading' })
      },
      (e) => setGate({ kind: 'error', message: errorText(e) }),
    )
  }

  /** 書いている途中で許可が切れたとき：ログインし直す */
  const onRelogin = () => {
    if (!drive) return
    setDriveBusy(true)
    setReloginError(null)
    drive.login().then(
      () => setDriveBusy(false),
      (e) => {
        setDriveBusy(false)
        setReloginError(errorText(e))
      },
    )
  }

  const reloadFromDrive = async () => {
    const ed = editorRef.current
    if (!drive || !ed) return
    ed.commitEditing()
    setGate({ kind: 'loading' })
    try {
      await applyResolution(ed, await drive.compare(ed.getSnapshot().report), false)
    } catch (e) {
      setGate(null)
      void ask.alert(errorText(e))
    }
  }

  const driveControls: DriveControls | undefined =
    drive && driveState
      ? {
          state: driveState,
          local: autosave.state,
          lastSaved: drive.lastSaved,
          staff: !!driveState.email && !studentIdFromEmail(driveState.email, config.studentIdPattern),
          unsent: () => drive.unsent,
          // 「今すぐドライブに保存」：送り終えるまで待つ（その間、ボタンに「ドライブに保存しています…」。DriveUi.tsx の DriveMenu）
          onSaveNow: async () => {
            const ed = editorRef.current
            if (!ed) return
            ed.commitEditing()
            await drive.saveNow(ed.getSnapshot().report)
          },
          onReload: () => void reloadFromDrive(),
          onWipe: () => setDriveDialog({ kind: 'wipe' }),
          onRelogin,
        }
      : undefined

  // キーボード：Ctrl+Z（入力欄の外）で元に戻す、Ctrl+Y・Ctrl+Shift+Z（Mac は ⌘+Shift+Z。入力欄の外）でやり直す、
  // Ctrl+S は保存されていることを示す（ブラウザの保存画面を出さない）。書く欄の中では、元に戻す・やり直すとも、ブラウザの文字の元に戻す・やり直す
  // ←→・PageUp／PageDown（入力欄の外）でページを送る
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ログインするまでは、何もできないようにする（指差し確認の間も）
      if (!editor || gate || tabLock.locked || tourOn) return
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase()
        // ⌘+Y は Mac のブラウザの履歴なので使わない（Mac は ⌘+Shift+Z）
        const redo = (key === 'z' && e.shiftKey) || (key === 'y' && e.ctrlKey && !e.shiftKey)
        if (redo && !isTyping(e.target)) {
          e.preventDefault()
          editor.redo()
        } else if (key === 'z' && !e.shiftKey && !isTyping(e.target)) {
          e.preventDefault()
          editor.undo()
        } else if (e.key === 's') {
          e.preventDefault()
        } else if (key === 'x' && !e.shiftKey && !e.altKey && !isTyping(e.target) && !dialog && !driveDialog && editor.cutSelection()) {
          // 紙面をなぞって選んだ範囲を切り取る（段落をまたいでも。コピー（Ctrl+C）は、編集の中核がブラウザのコピーを受け取る：editor/reportEditor.ts の onCopy）
          e.preventDefault()
        }
        return
      }
      if (dialog || driveDialog || guide === 'course' || guide === 'word' || isTyping(e.target) || e.altKey) return
      // 紙面で文字を選んでいるとき：Shift+矢印は選ぶ範囲を広げる（ページは送らない）
      if (e.shiftKey && /^(Arrow|Page|Home|End)/.test(e.key) && editor.hasPaperSelection()) return
      // スマホの下から出る欄など、窓の中で押したキーでは、ページを送らない
      if (e.target instanceof Element && e.target.closest('[aria-modal="true"]')) return
      // キーを押したままのときは、めくり終えてから次へ（続けて押した分は、押した数だけ送るが、押したままの繰り返しで一気に送らない）
      const paging = ['ArrowRight', 'PageDown', 'ArrowLeft', 'PageUp'].includes(e.key)
      if (paging && e.repeat && editor.getSnapshot().turning) {
        e.preventDefault()
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        editor.nextPage()
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        editor.prevPage()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // 紙面をなぞって選んだ範囲（段落をまたいでも）を消す
        if (editor.deleteSelection()) {
          e.preventDefault()
          return
        }
        // 図・表・改ページ・作品写真を選んでいるとき（書いていないとき）は、Delete（Mac は delete）で消す。左の道具の「削除」「外す」と同じ（依頼者の要望。2026-10-19）
        const sel = editor.getSnapshot().selection
        if (!sel || (sel.kind === 'photos' && sel.index === undefined)) return
        e.preventDefault()
        if (sel.kind === 'photos') editor.removePhoto(sel.page, sel.index!)
        else editor.removeSelected()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor, dialog, guide, gate, driveDialog, tabLock.locked, tourOn])

  /**
   * 「バックアップ・作り直す」の窓を開く。窓はすぐ開き、自動の控えの一覧は読み込んでから出す
   * （控えが多いと、読み込むのに少しかかる。前は、読み込み終えるまで窓が開かず、押しても何も起きないように見えた）
   */
  const openBackup = useCallback(() => {
    setDialog({ kind: 'backup', snapshots: null })
    void listSnapshots().then(
      (snapshots) => setDialog((d) => (d?.kind === 'backup' && d.snapshots === null ? { kind: 'backup', snapshots } : d)),
      () => setDialog((d) => (d?.kind === 'backup' && d.snapshots === null ? { kind: 'backup', snapshots: [] } : d)),
    )
  }, [])

  const saveBackup = useCallback(async () => {
    if (!snap) return
    const used = new Set(usedImageIds(snap.report))
    const images = (await allImages()).filter((img) => used.has(img.id))
    download(backupFileName(snap.report), await createBackup(snap.report, images))
  }, [snap])

  const restoreFile = useCallback(
    async (file: File) => {
      if (!editor || !snap) return
      try {
        const { report, images, savedAt } = readBackup(await file.text())
        if (!(await ask.confirm(`${new Date(savedAt).toLocaleString('ja-JP')} に保存したバックアップで、今の原稿を置き換えますか？${courseChangeNote(configRef.current, snap.report, report)}\n（今の原稿は自動の控えに残します）`, { ok: '置き換える' }))) return
        await keepSnapshot(snap.report)
        await Promise.all(images.map(putImage))
        editor.addImages(images)
        editor.replace(report)
        await matchYear(editor, report)
        setDialog(null)
        editor.showNotice('バックアップファイルから戻しました')
      } catch (e) {
        void ask.alert(e instanceof Error ? e.message : String(e))
      }
    },
    [editor, snap, matchYear],
  )

  const chooseCourse = useCallback(
    (courseId: string) => {
      if (!editor || editor.getSnapshot().report.basicInfo.courseId === courseId) return
      if (editor.bodyWritten()) setDialog({ kind: 'courseChange', courseId })
      else editor.changeCourseWithTemplate(courseId)
    },
    [editor],
  )

  /**
   * 今年度だけ：Word から読み取った中身を写す（mockups/v24）。
   * 今の原稿を控えに残す → 図の画像をこの端末に保存する → 原稿に写す（年度・コースの設定はそのまま）→ 「つぎにすること」を出す。
   * 表紙の項目が読み取れず空のままなら、はじめての案内でその項目から案内する。読み取れていれば案内を閉じ、本文の最初のページへ
   */
  const importWord = useCallback(
    async (result: WordImportResult, courseId?: string) => {
      if (!editor) return
      // 読み取る部品は、Word を読み取ったときに読み込み済み（使うときに初めて読み込む。WordImport.tsx）
      const { applyWordImport } = await import('./import/wordImport')
      editor.commitEditing()
      const before = editor.getSnapshot().report
      // 「読み込む前の原稿に戻す」で探せるよう、控えの時刻を覚えておく（keepSnapshot と同じ、押し出されない控え）。
      // 「つぎにすること」を閉じたあとも「バックアップ」の控えの一覧から探せるよう、名前を付ける
      const snapshotAt = new Date().toISOString()
      await saveSnapshot(before, snapshotAt, true, WORD_SNAPSHOT_LABEL)
      await Promise.all(result.images.map(putImage))
      editor.addImages(result.images)
      // courseId：確認の窓で、表紙の Word のコースを選んだ（本文は読み込む本文のまま、コースの名前を変える）
      editor.replace(applyWordImport(before, result, courseId ? { courseId, config: configRef.current } : undefined))
      setWordTodo({ at: new Date().toISOString(), snapshotAt, figuresSeen: 0, coverSeen: false, coverChecked: false, pagesSeen: false, pagesChecked: false })
      setDialog(null)
      const next = firstEmptyCoverStep(editor.getSnapshot().report)
      setGuide(next)
      if (next) return
      await rendered(editor)
      editor.goToArea('body')
      // スマホは、チェックの欄を開き、そのいちばん上に「つぎにすること」を出す
      if (narrow) setCheckRequest((n) => n + 1)
    },
    [editor, setWordTodo, narrow],
  )

  /** 引用・参考文献を「反映する」：組み直したら、そのページへ移り、画面の下に知らせる（前は、反映しても何も変わらないように見えた） */
  const showReferences = useCallback(async (ed: ReportEditor) => {
    await rendered(ed)
    if (ed.getSnapshot().report.references.length > 0) ed.goToArea('references')
    ed.showNotice('引用・参考文献を反映しました')
  }, [])

  /** 「つぎにすること」の「読み込む前の原稿に戻す」：写す前に残した控えに戻す（今の原稿も控えに残す） */
  const restoreBeforeWord = useCallback(async () => {
    const at = wordTodo?.snapshotAt
    if (!editor || !at) return
    const kept = (await listSnapshots()).find((s) => s.savedAt === at)
    if (!kept) {
      void ask.alert(`読み込む前の原稿の控えが見つかりませんでした。「バックアップ・作り直す」の「自動の控え」から、「${WORD_SNAPSHOT_LABEL}」の控えを選んで戻してください。`)
      return
    }
    if (!(await ask.confirm(`Word から読み込む前の原稿に戻しますか？${courseChangeNote(configRef.current, editor.getSnapshot().report, kept.report)}\n（今の原稿は自動の控えに残します）`, { ok: '戻す' }))) return
    editor.commitEditing()
    await keepSnapshot(editor.getSnapshot().report)
    editor.replace(kept.report)
    await matchYear(editor, kept.report)
    setWordTodo(null)
    editor.showNotice('Word から読み込む前の原稿に戻しました')
  }, [editor, wordTodo, setWordTodo, matchYear])

  /** お試しの「見本に戻す」：試した内容を消して、最初の見本の原稿にする（確かめてから） */
  const resetTrial = useCallback(async () => {
    if (!editor || !(await ask.confirm('見本の原稿に戻しますか？\n（試した内容は消えます）', { ok: '見本に戻す', danger: true }))) return
    editor.commitEditing()
    try {
      const sample = await freshSample()
      editor.addImages(await allImages())
      editor.replace(sample)
      setWordTodo(null)
      setDialog(null)
      editor.showNotice('見本の原稿に戻しました')
    } catch (e) {
      void ask.alert(errorText(e))
    }
  }, [editor, setWordTodo])

  /** 使い方の「指差し確認をもう一度見る」：使い方を閉じて、指差し確認を出す */
  const replayTour = useCallback(() => {
    setHelp(false)
    editorRef.current?.finishEditing()
    setTourWanted(true)
  }, [])
  const endTour = useCallback(() => {
    markTourSeen()
    setTourWanted(false)
    setTourOn(false)
  }, [])
  const reloginShown = !!drive && !gate && !driveDialog && !reloginLater && driveState?.status.kind === 'expired'
  // パソコン：許可が切れる少し前にクリックしたら、許可を延ばす（ログインにかかわる窓が開いているとき・別のタブで開いているときは延ばさない）
  useTokenRenewal(drive, !!gate || !!driveDialog || reloginShown || tabLock.locked || driveStopped)
  // 書き出した PDF の控えを、先生のドライブのフォルダに送る（ドライブにログインして使っているときだけ。学生の画面には出さない）
  const pdfCopy = usePdfCopy(drive, !driveStopped)
  // 書き出した PDF を、自分のドライブの「卒業制作報告書」フォルダにも置く（ログインして使っているときだけ。PDF の窓に1行で知らせる）
  const drivePdf = useDrivePdf(drive, !driveStopped)
  // 指差し確認を出さないとき：ログインの窓・どの原稿で続けるか・学籍番号の確かめ・Word の読み込みなどの窓・別のタブで開いている・
  // はじめての案内・使い方を開いている
  const tourBlocked = !snap?.layout || !!loadError || !!guide || !!gate || !!dialog || !!driveDialog || tabLock.locked || help || reloginShown
  // 紙面を組み直している・ページを送っている・書いている途中は、始めない（光を当てる場所が動くため）
  const tourSettling = !snap || snap.rendering || snap.turning || !!snap.editingId
  // 出したいとき、出せるようになったら出す（描く途中で合わせる。一度出したら、とばすか見終えるまで出したまま）
  if (tourWanted && !tourOn && !tourBlocked && !tourSettling) setTourOn(true)
  // 出したら、すぐこの端末に覚える（見終える前に読み込み直しても、また初めから出さない。使い方から、もう一度見られる）
  useEffect(() => {
    if (tourOn) markTourShown()
  }, [tourOn])
  // PC：使い方を閉じたら、右の欄の「メニュー」（「？ 使い方」はこの中。mockups/v37 案C）に戻る（キーボードで続けられるように）
  const helpWasOpen = useRef(false)
  useEffect(() => {
    if (!help && helpWasOpen.current && !narrow) document.querySelector<HTMLElement>('.side .menu-btn')?.focus()
    helpWasOpen.current = help
  }, [help, narrow])
  const helpView = (variant: 'side' | 'sheet') => (
    <HelpView
      topics={narrow ? STUDENT_TOPICS_TOUCH : STUDENT_TOPICS}
      who="student"
      imageBase={STUDENT_HELP_IMAGES}
      guides={[{ label: '学生用', href: STUDENT_GUIDE_PATH }]}
      variant={variant}
      onClose={() => setHelp(false)}
      onTour={replayTour}
      // 使い方の「引用・参考文献」のボタン（mockups/v35 ①）：引用・参考文献の窓を開く（入れた文献があれば、それを直せる）。
      // スマホは、使い方の欄（窓と同じ扱い）を閉じてから開く。PC は、右の欄の使い方を開いたまま（窓を閉じると、ボタンに戻る）
      onReferences={() => {
        if (narrow) setHelp(false)
        setDialog({ kind: 'references' })
      }}
    />
  )

  const ready = editor && snap
  const wordOffered = wordImportOffered(config)
  const showNewVersion = newVersion && !newVersionClosed
  // 右の欄（スマホはメニュー）の小さなリンク。写したあとの「つぎにすること」が出ている間は出さない（読み直すときは「読み込む前の原稿に戻す」から）
  const openWord = wordOffered && !wordTodo ? () => setDialog({ kind: 'word' }) : undefined
  const todoCard = (onPick?: () => void) =>
    editor && snap && wordTodo ? (
      <WordTodoCard editor={editor} snap={snap} config={config} todo={wordTodo} onUpdate={setWordTodo} onClose={() => setWordTodo(null)} onRestore={restoreBeforeWord} onPick={onPick} />
    ) : null

  return (
    <div className={`app${narrow ? ' phone' : ''}${phoneDirect ? ' phone-direct' : ''}${trialMode ? ' trial' : ''}`} style={narrow ? undefined : panels.style}>
      {/* お試し：画面の上の帯（お試し中であることと「見本に戻す」。依頼者の選択 2026-10-22 案1）。画面はその下に置く（index.css の .app.trial） */}
      {trialMode && <TrialBanner onReset={ready ? () => void resetTrial() : undefined} />}
      {/* 新しい版が公開されたら、画面の上に知らせる（依頼者の選択 2026-10-23。app/newVersion.tsx） */}
      {showNewVersion && <NewVersionBanner onReload={() => void reloadTool()} onClose={() => setNewVersionClosed(true)} />}
      {!narrow && (ready ? <PageColumn editor={editor} snap={snap} config={config} /> : <aside className="thumbs-col" />)}
      {/* 左右の欄の境目：つかんで動かすと幅が変わる。ダブルクリックで元の幅 */}
      {!narrow &&
        (['left', 'right'] as const).map((side) => (
          <div
            key={side}
            className={`resize-handle ${side}`}
            role="separator"
            aria-orientation="vertical"
            title="つかんで動かすと、欄の幅が変わります（ダブルクリックで元の幅）"
            onPointerDown={(e) => panels.startDrag(side, e)}
            onDoubleClick={() => panels.reset(side)}
          />
        ))}
      <main className="stage" ref={stageRef}>
        <div className="page-scroller" ref={scrollerRef} />
        <div id="overlay-layer" ref={layerRef} />
        {/* スマホ：紙面の中の小さな案内とボタンを、紙面の下（横向きは右）の帯に出す（mockups/v32 ④ 案A） */}
        {ready && snap.layout && narrow && <PageBand editor={editor} snap={snap} hidden={!!guide} />}
        {/* 目次のページの、行のない所を押したときの小さな知らせ（PC・スマホ。mockups/v41 案B） */}
        {ready && snap.layout && <TocNotice editor={editor} snap={snap} point={tocPoint} onClose={closeTocNotice} />}
        {ready && snap.layout && !narrow && (
          <>
            <Palette editor={editor} snap={snap} onReferences={() => setDialog({ kind: 'references' })} />
            {/* 見開きのときは2ページずつ送る（最初の組・最後の組では押せない） */}
            <button className="arrow prev" aria-label="前のページ" title="前のページ（←）" disabled={(snap.spread ? snap.page - (snap.page % 2) : snap.page) <= 0} onClick={() => editor.prevPage()}>
              {Icon.prev}
            </button>
            <button className="arrow next" aria-label="次のページ" title="次のページ（→）" disabled={(snap.spread ? snap.page - (snap.page % 2) + 1 : snap.page) >= snap.pageCount - 1} onClick={() => editor.nextPage()}>
              {Icon.next}
            </button>
            {/* 右下：元に戻す・やり直す と、全体／見開き／拡大（mockups/v47 案C・v35 ③ 案A） */}
            <ViewBar editor={editor} snap={snap} />
            {/* 削除したあとの「段落を削除しました［戻す］」（紙面の台の下の真ん中。スマホは PhoneChrome の中。mockups/v32 ② 案A） */}
            <UndoBar editor={editor} notice={undoNotice.notice} onClose={undoNotice.close} className="on-stage" />
          </>
        )}
        {/* 紙面の準備中：残りのページの見込みも出す（スマホで十数秒かかるとき、進んでいるのが分かるように）。原稿を丸ごと入れ替えたときも、前の原稿の紙面を見せない */}
        {(!snap || (snap.rendering && !snap.layout) || snap.replacing) && !loadError && !trialMissing && (
          <div className="loading" role="status">
            <span className="loading-line">
              <Spinner />
              {/* 狭い画面では「（」の前で折り返す（1字だけ次の行に残らないように） */}
              <span>
                <span className="nb">紙面を準備しています…</span>
                <span className="nb">{firstOpen ? '（初回は数秒かかります）' : snap?.pagesLeft ? `（あと${snap.pagesLeft}ページほど）` : ''}</span>
              </span>
            </span>
          </div>
        )}
        {/* 選んだ写真を縮めて保存し、紙面に出るまで（紙面の上の真ん中に小さく。依頼者の要望 2026-10-20） */}
        {ready && snap.layout && <ImageWorkToast work={imageWork} editor={editor} />}
        {exportSlowPhone && <WaitToast className="on-stage" text="PDF の前に、紙面を確かめています…" slowMs={0} />}
        {loadError && <div className="loading ng">読み込みに失敗しました：{loadError}</div>}
        {trialMissing && <div className="loading trial-missing">{new TrialMissingError().message}</div>}
      </main>

      {ready && narrow ? (
        <PhoneChrome
          editor={editor}
          snap={snap}
          config={config}
          saveState={autosave.state}
          drive={driveStopped ? undefined : driveControls}
          driveStopped={driveStopped}
          sheetHostRef={sheetHostRef}
          onHelp={() => setHelp(true)}
          onBackup={openBackup}
          exporting={exporting}
          onExport={startExport}
          onWordImport={openWord}
          onReload={() => void reloadTool()}
          wordTodo={wordTodo ? todoCard : undefined}
          checkRequest={checkRequest}
          direct={phoneDirect}
          guiding={!!guide || tourOn}
        />
      ) : ready && help ? (
        // PC の使い方：右の欄がまるごと使い方に替わる（紙面と道具は、そのまま使える）
        <aside className="side">{helpView('side')}</aside>
      ) : ready ? (
        <SidePanel
          editor={editor}
          snap={snap}
          config={config}
          onHelp={() => setHelp(true)}
          saveState={autosave.state}
          drive={driveStopped ? undefined : driveControls}
          driveStopped={driveStopped}
          onBackup={openBackup}
          exporting={exporting}
          onExport={startExport}
          onWordImport={openWord}
          onReload={() => void reloadTool()}
          wordTodo={todoCard()}
        />
      ) : (
        <aside className="side" />
      )}

      {dialog?.kind === 'course' && snap && editor && (
        <CourseMenu config={config} rect={dialog.rect} current={snap.report.basicInfo.courseId} onSelect={chooseCourse} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'courseChange' && snap && editor && (
        <CourseChangeDialog
          courseName={findCourse(config, dialog.courseId)?.name ?? ''}
          onClose={() => setDialog(null)}
          onNameOnly={() => {
            editor.setCourse(dialog.courseId)
            setDialog(null)
          }}
          onReplace={async () => {
            // 「この時点に戻す」で探せるよう、名前を付けて残す（戻すと、コースも前のコースに戻ることを、戻すときに知らせる）
            await saveSnapshot(snap.report, new Date().toISOString(), true, REPLACE_SNAPSHOT_LABEL)
            editor.changeCourseWithTemplate(dialog.courseId)
            setDialog(null)
          }}
        />
      )}
      {/* Word を選ぶ窓を開いている間は、案内を隠す（「やめる」で窓を閉じると、案内の「Word で書き始めていますか？」に戻る） */}
      {ready && guide && snap.layout && !gate && dialog?.kind !== 'word' && (
        <StartGuide
          editor={editor}
          snap={snap}
          config={config}
          configMissing={configSource === 'bundled'}
          narrow={narrow}
          step={guide}
          onStep={setGuide}
          onChooseCourse={(courseId) => {
            // 本文を書き始めている原稿（設定が読めずにコースが見つからなかったときなど）は、確かめずに本文を入れ替えない
            if (editor.bodyWritten()) {
              setGuide(null)
              setDialog({ kind: 'courseChange', courseId })
              return
            }
            editor.changeCourseWithTemplate(courseId)
            // 今年度だけ：コースを選んだら、Word で書き始めているかを聞く
            setGuide(wordImportOffered(configRef.current) ? 'word' : editor.getSnapshot().report.basicInfo.studentId.trim() ? 'name' : 'studentId')
          }}
          wordImport={wordOffered}
          onWordImport={() => setDialog({ kind: 'word' })}
          onFinish={() => {
            // 案内を終えたら、指差し確認を出す（この端末でまだ見ていなければ）
            if (!tourSeen()) setTourWanted(true)
          }}
        />
      )}
      {/* スマホの使い方：画面いっぱいの欄（メニューの「？ 使い方」から） */}
      {ready && narrow && help && helpView('sheet')}
      {/* 指差し確認（ほかの窓や案内が出ている間は出さない） */}
      {ready && tourOn && !tourBlocked && <Tour narrow={narrow} drive={!!drive && !driveStopped} direct={direct} onDone={endTour} />}
      {dialog?.kind === 'word' && snap && editor && (
        <WordImportDialog config={config} report={snap.report} onImport={importWord} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'references' && snap && editor && (
        <ReferencesDialog
          report={snap.report}
          // 紙面を組み直し、そのページへ移って知らせるまで、窓に「反映しています…」を出しておく（終わったら窓が閉じる）
          onSave={async (references) => {
            editor.update((r) => ({ ...r, references }))
            await showReferences(editor)
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'export' && snap && editor && (
        <ExportDialog
          editor={editor}
          snap={snap}
          config={config}
          onStart={pdfCopy.onStart}
          onBuilt={(pdf) => {
            pdfCopy.onBuilt(pdf, editor.getSnapshot().report)
            drivePdf.onBuilt(pdf)
          }}
          drivePdf={drivePdf.state}
          onClose={() => {
            setDialog(null)
            pdfCopy.onClosed()
          }}
        />
      )}
      {dialog?.kind === 'backup' && editor && snap && (
        <BackupDialog
          driveStopped={driveStopped}
          snapshots={dialog.snapshots}
          onSaveBackup={saveBackup}
          onRestoreFile={restoreFile}
          onRestoreSnapshot={async (s) => {
            if (!(await ask.confirm(`${new Date(s.savedAt).toLocaleString('ja-JP')}${s.label ? `（${s.label}）` : ''} の控えに戻しますか？${courseChangeNote(configRef.current, snap.report, s.report)}`, { ok: '戻す' }))) return
            await keepSnapshot(snap.report)
            editor.replace(s.report)
            await matchYear(editor, s.report)
            setDialog(null)
            editor.showNotice(`${new Date(s.savedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} の控えに戻しました`)
          }}
          onStartOver={async () => {
            if (!(await ask.confirm('今の原稿を消して、最初から作り直しますか？\n（今の原稿は自動の控えに残します）', { ok: '作り直す', danger: true }))) return
            await keepSnapshot(snap.report)
            // 作り直すときは、公開中の年度で作る（前年度の原稿だった学生も、新年度で書き直せる）
            const fresh = createReport(publishedRef.current)
            editor.replace(fresh)
            // Word から写したあとの「つぎにすること」も消す（作り直した原稿には当てはまらない）
            setWordTodo(null)
            await matchYear(editor, fresh)
            prefillStudentId(editor)
            setDialog(null)
            // 作り直したら、はじめての案内からやり直す（年度を切り替えたあとの設定で）
            startGuide(configRef.current, editor.getSnapshot().report, true)
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {/* ---- 別のタブで開いているとき（このタブでは書けない） ---- */}
      {tabLock.locked && <TabLockedOverlay onTakeOver={tabLock.takeOver} />}

      {/* ---- ドライブ（ログイン必須） ---- */}
      {gate && (
        <LoginGate
          gate={gate}
          reportName={config.reportName}
          fiscalYear={config.fiscalYear}
          previousEmail={drive?.previousEmail ?? null}
          onLogin={() => onGateLogin()}
          onLoginOther={() => onGateLogin(true)}
        />
      )}
      {drive && editor && snap && driveDialog?.kind === 'conflict' && (
        <ConflictDialog
          local={snap.report}
          remote={driveDialog.remote}
          atLogin={driveDialog.atLogin}
          busy={conflictBusy}
          onChooseRemote={async () => {
            // 窓を開いたまま許可が切れていたら、先にログインし直す（Google の窓は、押した直後にしか開けない）
            const login = drive.tokenValid ? null : drive.login()
            setConflictBusy('remote')
            try {
              if (login) await login
              await openRemote(editor, driveDialog.remote)
              drive.activate()
              setDriveDialog(null)
              if (driveDialog.atLogin) {
                prefillStudentId(editor)
                startGuide(configRef.current, editor.getSnapshot().report, false)
              }
              editor.showNotice('ドライブの原稿を開きました')
            } catch (e) {
              void ask.alert(errorText(e))
            } finally {
              setGate(null)
              setConflictBusy(null)
            }
          }}
          onChooseLocal={async () => {
            const login = drive.tokenValid ? null : drive.login()
            setConflictBusy('local')
            try {
              if (login) await login
              // ドライブの原稿は、写真ごとこの端末の控えに残す（あとで戻せるように）
              await drive.downloadImages(driveDialog.remote.report)
              await keepSnapshot(driveDialog.remote.report)
              drive.activate()
              // 選ばなかったドライブの原稿のファイルに上書きする（原稿のファイルを2つにしない）
              await drive.overwrite(editor.getSnapshot().report, driveDialog.remote)
              setDriveDialog(null)
              if (driveDialog.atLogin) {
                prefillStudentId(editor)
                startGuide(configRef.current, editor.getSnapshot().report, false)
              }
              if (drive.getState().status.kind === 'saved') editor.showNotice('この端末の原稿をドライブに保存しました')
            } catch (e) {
              void ask.alert(errorText(e))
            } finally {
              setConflictBusy(null)
            }
          }}
        />
      )}
      {drive && snap && driveDialog?.kind === 'wipe' && (
        <WipeDialog
          lastSaved={drive.lastSaved}
          busy={driveBusy}
          onClose={() => setDriveDialog(null)}
          onConfirm={async () => {
            setDriveBusy(true)
            editor?.commitEditing()
            const report = editor?.getSnapshot().report ?? snap.report
            if (!(await drive.finish(report))) {
              setDriveBusy(false)
              void ask.alert('ドライブに保存できていないため、消せません。インターネットにつながっているか、ログインし直す必要がないかを確かめてください。')
              return
            }
            autosave.stop()
            await clearAll()
            setWordTodo(null)
            // 案内の途中の段階も消す（次にこの端末を使う人の原稿で、続きを出さないように）
            forgetGuide()
            drive.forget()
            location.reload()
          }}
        />
      )}
      {drive && editor && driveDialog?.kind === 'idMismatch' && (
        <IdMismatchDialog
          coverId={driveDialog.coverId}
          accountEmail={driveState?.email ?? ''}
          accountId={driveDialog.accountId}
          busy={driveBusy}
          onFix={() => {
            editor.update((r) => ({ ...r, basicInfo: { ...r.basicInfo, studentId: driveDialog.accountId } }))
            setDriveDialog(null)
            void applyResolution(editor, driveDialog.resolution, true, true)
          }}
          onKeep={() => {
            try {
              localStorage.setItem(ID_OK_KEY, `${driveState?.email}|${driveDialog.coverId}`)
            } catch {
              // 覚えておけなければ、次にログインしたときにもう一度聞く
            }
            setDriveDialog(null)
            void applyResolution(editor, driveDialog.resolution, true, true)
          }}
          onNotMine={async () => {
            // ほかの人の原稿：この端末の控えに残し（その人があとで戻せるように）、自分のドライブには送らない。自分の原稿（ドライブ）か、新しい原稿で始める
            setDriveBusy(true)
            try {
              await keepSnapshot(editor.getSnapshot().report)
              const fresh = createReport(publishedRef.current)
              editor.replace(fresh)
              setWordTodo(null)
              await matchYear(editor, fresh)
              setDriveDialog(null)
              await applyResolution(editor, await drive.compare(null), true, true)
            } catch (e) {
              void ask.alert(errorText(e))
            } finally {
              setDriveBusy(false)
            }
          }}
        />
      )}
      {drive && driveDialog?.kind === 'otherAccount' && (
        <OtherAccountDialog
          previousEmail={driveDialog.previousEmail}
          unsynced={driveDialog.unsynced}
          onRelogin={() => {
            drive.forgetToken()
            location.reload()
          }}
          onDiscard={async () => {
            if (driveDialog.unsynced && !(await ask.confirm('前の原稿の、ドライブに保存していない変更はなくなります。消して続けますか？', { ok: '消して続ける', danger: true }))) return
            autosave.stop()
            await clearAll()
            setWordTodo(null)
            drive.forgetLink()
            location.reload()
          }}
        />
      )}
      {reloginShown && (
        <ReloginDialog
          busy={driveBusy}
          error={reloginError}
          onLogin={onRelogin}
          onLater={() => {
            // 10分は窓を出さない（右の欄の赤い表示から、いつでもログインし直せる）
            setReloginLater(true)
            window.setTimeout(() => setReloginLater(false), 10 * 60 * 1000)
          }}
        />
      )}
    </div>
  )
}
