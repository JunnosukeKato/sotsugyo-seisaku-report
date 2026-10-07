import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { currentConfig, findCourse, type YearConfig } from './config'
import { loadConfig, loadYearConfig, type ConfigSource } from './config/remote'
import { ReportEditor, type EditorSnapshot } from './editor/reportEditor'
import { preloadGis } from './drive/driveApi'
import { DriveSync, hasContent, type DriveState, type RemoteCopy, type Resolution } from './drive/driveSync'
import { studentIdFromEmail } from './model/account'
import { backupFileName, createBackup, readBackup } from './model/backup'
import { createReport } from './model/newReport'
import { allImages, clearAll, listSnapshots, loadReport, keepSnapshot, putImage, usedImageIds, type Snapshot } from './model/storage'
import type { Report } from './model/types'
import { BackupDialog, CourseChangeDialog, CourseMenu, ExportDialog, ReferencesDialog } from './app/dialogs'
import { ConflictDialog, IdMismatchDialog, LoginGate, OtherAccountDialog, ReloginDialog, WipeDialog, type DriveControls, type GateState } from './app/DriveUi'
import { Icon } from './app/icons'
import { Palette } from './app/Palette'
import { PhoneChrome } from './app/Phone'
import { useKeyboardInset, useNarrow, useSwipe, useWheelPaging } from './app/uiShared'
import { SidePanel, PageColumn } from './app/SidePanel'
import { StartGuide, type GuideStep } from './app/StartGuide'
import { TabLockedOverlay } from './app/TabLock'
import { useTabLock } from './app/useTabLock'
import { useAutosave } from './app/useAutosave'
import { usePanelWidths } from './app/usePanelWidths'

const noopSubscribe = () => () => {}
const nullSnapshot = () => null

type Dialog =
  | { kind: 'export' }
  | { kind: 'references' }
  | { kind: 'backup'; snapshots: Snapshot[] }
  | { kind: 'course'; rect: DOMRect }
  | { kind: 'courseChange'; courseId: string }
  | null

/**
 * 原稿を Google ドライブにも保存する（ログイン必須。mockups/v18 案3・v19 案A）。
 * クライアント ID がなければ、今まで通りこの端末だけに保存する。開発中は ?nodrive で外せる（自動テスト用）
 */
const DRIVE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
const DRIVE_ENABLED = !!DRIVE_CLIENT_ID && !(import.meta.env.DEV && new URLSearchParams(location.search).has('nodrive'))

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
  const [loadError, setLoadError] = useState<string | null>(null)
  // はじめて使う学生への案内（コース → 学籍番号 → 氏名 → サブタイトル）
  const [guide, setGuide] = useState<GuideStep | null>(null)
  const [configSource, setConfigSource] = useState<ConfigSource>('remote')
  const autosave = useAutosave()
  const snap = useSyncExternalStore(editor?.subscribe ?? noopSubscribe, editor?.getSnapshot ?? nullSnapshot) as EditorSnapshot | null
  // ドライブ（ログイン必須）。このタブでログイン済みなら、ボタンを押さずに始める
  const [drive] = useState(() => (DRIVE_ENABLED ? new DriveSync(DRIVE_CLIENT_ID!) : null))
  const driveState = useSyncExternalStore(drive?.subscribe ?? noopSubscribe, drive?.getState ?? nullSnapshot) as DriveState | null
  const [gate, setGate] = useState<GateState | null>(() => (drive ? (drive.restoreToken() ? { kind: 'loading' } : { kind: 'login' }) : null))
  const [driveDialog, setDriveDialog] = useState<DriveDialog>(null)
  const [driveBusy, setDriveBusy] = useState(false)
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
  const configRef = useRef<YearConfig>(currentConfig)
  /** 公開中の年度の設定（「最初から作り直す」は、公開中の年度で作る） */
  const publishedRef = useRef<YearConfig>(currentConfig)
  /** 開いたときに、この端末にあった原稿（なければ null） */
  const localAtStart = useRef<Report | null>(null)
  // スマホ（画面の幅が狭いとき）は、並べ方と書き方を変える
  const narrow = useNarrow()
  const panels = usePanelWidths()
  const hasLayout = !!snap?.layout
  useKeyboardInset()
  useSwipe(stageRef, editor, narrow)
  // ホイールでページを送る（コースを選ぶ案内や、画面の上に出る窓が開いている間は送らない）
  useWheelPaging(stageRef, scrollerRef, editor, !dialog && !gate && !driveDialog && !tabLock.locked && guide !== 'course')
  useEffect(() => {
    if (editor && hasLayout) editor.setSheetHost(narrow ? sheetHostRef.current : null)
  }, [editor, narrow, hasLayout])

  // はじめて開いたときは、コースを選ぶところから案内する（コースが1つだけなら学籍番号から）。コースを選んでいない原稿も、コースを選ぶ案内を出す
  const startGuide = useCallback((cfg: YearConfig, report: Report, isNew: boolean) => {
    if (!findCourse(cfg, report.basicInfo.courseId)) setGuide('course')
    else if (isNew) setGuide(report.basicInfo.studentId.trim() ? 'name' : 'studentId')
  }, [])

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
          else if (r.kind === 'local' && !r.upload) alert('ドライブの原稿は、この端末の原稿と同じです（最新です）')
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

  useEffect(() => {
    if (started.current) return
    started.current = true
    // ログインのボタンを押したときに、すぐ Google の窓を開けるよう、部品を先に読み込んでおく
    if (drive) void preloadGis().catch(() => {})
    void (async () => {
      try {
        const { config: published, source } = await loadConfig()
        if (drive && published.driveSave === 'off') {
          stoppedRef.current = true
          setDriveStopped(true)
          setGate(null)
        }
        publishedRef.current = published
        const saved = await loadReport()
        localAtStart.current = saved
        // 原稿は、書き始めた年度の設定で開く（新年度を公開しても、前年度の学生の表紙が新年度の題目・教員に変わらないように）
        // ただし、読めた年度の設定に原稿のコースがない（同梱の初期値しか読めなかったなど）なら、コースのある公開中の設定で開く
        const yearConfig = saved && saved.fiscalYear !== published.fiscalYear ? await loadYearConfig(saved.fiscalYear) : null
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
          pickImage: pickImageFile,
        })
        ed.addImages(await allImages())
        editorRef.current = ed
        setEditor(ed)
        // 開発中だけ、自動テストから操作できるようにする
        if (import.meta.env.DEV) Object.assign(window, { __editor: ed })
        await ed.render()
        if (!drive || stoppedRef.current) startGuide(loaded, report, !saved)
        // 紙面の準備より先にログインが済んでいたら、ここで始める
        else if (drive.tokenValid) void enter(ed)
      } catch (e) {
        setLoadError(String(e))
      }
    })()
  }, [autosave, drive, enter, startGuide])

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
  const startExport = async () => {
    if (!editor || exporting) return
    setExporting(true)
    try {
      editor.commitEditing()
      await editor.render()
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
      alert(errorText(e))
    }
  }

  const driveControls: DriveControls | undefined =
    drive && driveState
      ? {
          state: driveState,
          local: autosave.state,
          lastSaved: drive.lastSaved,
          staff: !!driveState.email && !studentIdFromEmail(driveState.email, config.studentIdPattern),
          onSaveNow: () => {
            const ed = editorRef.current
            if (!ed) return
            ed.commitEditing()
            drive.schedule(ed.getSnapshot().report, 0)
          },
          onReload: () => void reloadFromDrive(),
          onWipe: () => setDriveDialog({ kind: 'wipe' }),
          onRelogin,
        }
      : undefined

  // キーボード：Ctrl+Z（入力欄の外）で元に戻す、Ctrl+S は保存されていることを示す（ブラウザの保存画面を出さない）
  // ←→・PageUp／PageDown（入力欄の外）でページを送る
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ログインするまでは、何もできないようにする
      if (!editor || gate || tabLock.locked) return
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !isTyping(e.target)) {
          e.preventDefault()
          editor.undo()
        } else if (e.key === 's') {
          e.preventDefault()
        }
        return
      }
      if (dialog || driveDialog || guide === 'course' || isTyping(e.target) || e.altKey) return
      // スマホの下から出る欄など、窓の中で押したキーでは、ページを送らない
      if (e.target instanceof Element && e.target.closest('[aria-modal="true"]')) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        editor.nextPage()
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        editor.prevPage()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor, dialog, guide, gate, driveDialog, tabLock.locked])

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
        if (!confirm(`${new Date(savedAt).toLocaleString('ja-JP')} に保存したバックアップで、今の原稿を置き換えますか？\n（今の原稿は自動の控えに残します）`)) return
        await keepSnapshot(snap.report)
        await Promise.all(images.map(putImage))
        editor.addImages(images)
        editor.replace(report)
        await matchYear(editor, report)
        setDialog(null)
      } catch (e) {
        alert(e instanceof Error ? e.message : String(e))
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

  const ready = editor && snap

  return (
    <div className={`app${narrow ? ' phone' : ''}`} style={narrow ? undefined : panels.style}>
      {!narrow && (ready ? <PageColumn editor={editor} snap={snap} /> : <aside className="thumbs-col" />)}
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
        {ready && snap.layout && !narrow && (
          <>
            <Palette editor={editor} snap={snap} onReferences={() => setDialog({ kind: 'references' })} />
            <button className="arrow prev" aria-label="前のページ" title="前のページ（←）" disabled={snap.page <= 0} onClick={() => editor.prevPage()}>
              {Icon.prev}
            </button>
            <button className="arrow next" aria-label="次のページ" title="次のページ（→）" disabled={snap.page >= snap.pageCount - 1} onClick={() => editor.nextPage()}>
              {Icon.next}
            </button>
            <div className="zoom" role="group" aria-label="表示の大きさ">
              <button className={snap.zoomed ? '' : 'on'} aria-pressed={!snap.zoomed} title="1ページ全体を表示" onClick={() => editor.setZoom(false)}>
                {Icon.fit}全体
              </button>
              <button className={snap.zoomed ? 'on' : ''} aria-pressed={snap.zoomed} title="文字を大きく表示（マウスのホイールで上下に動かす）" onClick={() => editor.setZoom(true)}>
                {Icon.zoom}拡大
              </button>
            </div>
          </>
        )}
        {(!snap || (snap.rendering && !snap.layout)) && !loadError && <div className="loading">紙面を準備しています…（初回は数秒かかります）</div>}
        {loadError && <div className="loading ng">読み込みに失敗しました：{loadError}</div>}
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
          onReferences={() => setDialog({ kind: 'references' })}
          onBackup={async () => setDialog({ kind: 'backup', snapshots: await listSnapshots() })}
          exporting={exporting}
          onExport={startExport}
        />
      ) : ready ? (
        <SidePanel
          editor={editor}
          snap={snap}
          config={config}
          onReferences={() => setDialog({ kind: 'references' })}
          saveState={autosave.state}
          drive={driveStopped ? undefined : driveControls}
          driveStopped={driveStopped}
          onBackup={async () => setDialog({ kind: 'backup', snapshots: await listSnapshots() })}
          exporting={exporting}
          onExport={startExport}
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
            await keepSnapshot(snap.report)
            editor.changeCourseWithTemplate(dialog.courseId)
            setDialog(null)
          }}
        />
      )}
      {ready && guide && snap.layout && !gate && (
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
            setGuide(editor.getSnapshot().report.basicInfo.studentId.trim() ? 'name' : 'studentId')
          }}
        />
      )}
      {dialog?.kind === 'references' && snap && editor && (
        <ReferencesDialog report={snap.report} onSave={(references) => editor.update((r) => ({ ...r, references }))} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'export' && snap && editor && <ExportDialog editor={editor} findings={snap.findings} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'backup' && editor && snap && (
        <BackupDialog
          driveStopped={driveStopped}
          snapshots={dialog.snapshots}
          onSaveBackup={() => void saveBackup()}
          onRestoreFile={(file) => void restoreFile(file)}
          onRestoreSnapshot={async (s) => {
            if (!confirm(`${new Date(s.savedAt).toLocaleString('ja-JP')} の控えに戻しますか？`)) return
            await keepSnapshot(snap.report)
            editor.replace(s.report)
            await matchYear(editor, s.report)
            setDialog(null)
          }}
          onStartOver={async () => {
            if (!confirm('今の原稿を消して、最初から作り直しますか？\n（今の原稿は自動の控えに残します）')) return
            await keepSnapshot(snap.report)
            // 作り直すときは、公開中の年度で作る（前年度の原稿だった学生も、新年度で書き直せる）
            const fresh = createReport(publishedRef.current)
            editor.replace(fresh)
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
          busy={driveBusy}
          onChooseRemote={async () => {
            // 窓を開いたまま許可が切れていたら、先にログインし直す（Google の窓は、押した直後にしか開けない）
            const login = drive.tokenValid ? null : drive.login()
            setDriveBusy(true)
            try {
              if (login) await login
              await openRemote(editor, driveDialog.remote)
              drive.activate()
              setDriveDialog(null)
              if (driveDialog.atLogin) {
                prefillStudentId(editor)
                startGuide(configRef.current, editor.getSnapshot().report, false)
              }
            } catch (e) {
              alert(errorText(e))
            } finally {
              setGate(null)
              setDriveBusy(false)
            }
          }}
          onChooseLocal={async () => {
            const login = drive.tokenValid ? null : drive.login()
            setDriveBusy(true)
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
            } catch (e) {
              alert(errorText(e))
            } finally {
              setDriveBusy(false)
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
              alert('ドライブに保存できていないため、消せません。インターネットにつながっているか、ログインし直す必要がないかを確かめてください。')
              return
            }
            autosave.stop()
            await clearAll()
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
              await matchYear(editor, fresh)
              setDriveDialog(null)
              await applyResolution(editor, await drive.compare(null), true, true)
            } catch (e) {
              alert(errorText(e))
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
            if (driveDialog.unsynced && !confirm('前の原稿の、ドライブに保存していない変更はなくなります。消して続けますか？')) return
            autosave.stop()
            await clearAll()
            drive.forgetLink()
            location.reload()
          }}
        />
      )}
      {drive && !gate && !driveDialog && !reloginLater && driveState?.status.kind === 'expired' && (
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
