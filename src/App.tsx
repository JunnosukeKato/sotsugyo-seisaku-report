import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { currentConfig, findCourse, type YearConfig } from './config'
import { loadConfig, type ConfigSource } from './config/remote'
import { ReportEditor, type EditorSnapshot } from './editor/reportEditor'
import { preloadGis } from './drive/driveApi'
import { DriveSync, hasContent, type DriveState, type RemoteCopy, type Resolution } from './drive/driveSync'
import { studentIdFromEmail } from './model/account'
import { backupFileName, createBackup, readBackup } from './model/backup'
import { createReport } from './model/newReport'
import { allImages, clearAll, listSnapshots, loadReport, putImage, saveSnapshot, usedImageIds, type Snapshot } from './model/storage'
import type { Report } from './model/types'
import { BackupDialog, CourseChangeDialog, CourseMenu, ExportDialog, ReferencesDialog } from './app/dialogs'
import { ConflictDialog, LoginGate, OtherAccountDialog, ReloginDialog, WipeDialog, type DriveControls, type GateState } from './app/DriveUi'
import { Icon } from './app/icons'
import { Palette } from './app/Palette'
import { PhoneChrome } from './app/Phone'
import { useKeyboardInset, useNarrow, useSwipe, useWheelPaging } from './app/uiShared'
import { SidePanel, PageColumn } from './app/SidePanel'
import { StartGuide, type GuideStep } from './app/StartGuide'
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
  | null

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
  const editorRef = useRef<ReportEditor | null>(null)
  const configRef = useRef<YearConfig>(currentConfig)
  /** 開いたときに、この端末にあった原稿（なければ null） */
  const localAtStart = useRef<Report | null>(null)
  // スマホ（画面の幅が狭いとき）は、並べ方と書き方を変える
  const narrow = useNarrow()
  const panels = usePanelWidths()
  const hasLayout = !!snap?.layout
  useKeyboardInset()
  useSwipe(stageRef, editor, narrow)
  // ホイールでページを送る（コースを選ぶ案内や、画面の上に出る窓が開いている間は送らない）
  useWheelPaging(stageRef, scrollerRef, editor, !dialog && !gate && !driveDialog && guide !== 'course')
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

  /** ドライブの原稿を開く（写真を読み込んでから、原稿を入れ替える。それまでの原稿は控えに残す） */
  const openRemote = useCallback(
    async (ed: ReportEditor, remote: RemoteCopy) => {
      if (!drive) return
      setGate({ kind: 'loading' })
      const current = ed.getSnapshot().report
      if (hasContent(current)) await saveSnapshot(current)
      ed.addImages(await drive.downloadImages(remote.report, (done, total) => setGate({ kind: 'loading', done, total })))
      ed.replace(remote.report)
      drive.adopt(remote, ed.getSnapshot().report)
    },
    [drive],
  )

  /** どの原稿で始めるか（続けるか）が決まったら、そのとおりにする。atLogin：ログインした直後 */
  const applyResolution = useCallback(
    async (ed: ReportEditor, r: Resolution, atLogin: boolean) => {
      if (!drive) return
      const cfg = configRef.current
      switch (r.kind) {
        case 'new':
        case 'local': {
          setGate(null)
          const report = ed.getSnapshot().report
          drive.activate(r.kind === 'local' && r.upload ? report : undefined)
          if (atLogin) {
            prefillStudentId(ed)
            startGuide(cfg, ed.getSnapshot().report, r.kind === 'new')
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
            startGuide(cfg, ed.getSnapshot().report, false)
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
    [drive, openRemote, startGuide, prefillStudentId],
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
        const { config: loaded, source } = await loadConfig()
        setConfig(loaded)
        setConfigSource(source)
        configRef.current = loaded
        const saved = await loadReport()
        localAtStart.current = saved
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
        if (!drive) startGuide(loaded, report, !saved)
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
  const onGateLogin = () => {
    if (!drive) return
    setGate({ kind: 'signing' })
    drive.login().then(
      () => {
        if (editorRef.current) void enter(editorRef.current)
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
      if (!editor || gate) return
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
  }, [editor, dialog, guide, gate, driveDialog])

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
        await saveSnapshot(snap.report)
        await Promise.all(images.map(putImage))
        editor.addImages(images)
        editor.replace(report)
        setDialog(null)
      } catch (e) {
        alert(e instanceof Error ? e.message : String(e))
      }
    },
    [editor, snap],
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
              <button className={snap.zoomed ? '' : 'on'} title="1ページ全体を表示" onClick={() => editor.setZoom(false)}>
                {Icon.fit}全体
              </button>
              <button className={snap.zoomed ? 'on' : ''} title="文字を大きく表示（マウスのホイールで上下に動かす）" onClick={() => editor.setZoom(true)}>
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
          drive={driveControls}
          sheetHostRef={sheetHostRef}
          onReferences={() => setDialog({ kind: 'references' })}
          onBackup={async () => setDialog({ kind: 'backup', snapshots: await listSnapshots() })}
          onExport={async () => {
            editor.commitEditing()
            await editor.render()
            setDialog({ kind: 'export' })
          }}
        />
      ) : ready ? (
        <SidePanel
          editor={editor}
          snap={snap}
          config={config}
          onReferences={() => setDialog({ kind: 'references' })}
          saveState={autosave.state}
          drive={driveControls}
          onBackup={async () => setDialog({ kind: 'backup', snapshots: await listSnapshots() })}
          onExport={async () => {
            editor.commitEditing()
            await editor.render()
            setDialog({ kind: 'export' })
          }}
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
            await saveSnapshot(snap.report)
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
          snapshots={dialog.snapshots}
          onSaveBackup={() => void saveBackup()}
          onRestoreFile={(file) => void restoreFile(file)}
          onRestoreSnapshot={async (s) => {
            if (!confirm(`${new Date(s.savedAt).toLocaleString('ja-JP')} の控えに戻しますか？`)) return
            await saveSnapshot(snap.report)
            editor.replace(s.report)
            setDialog(null)
          }}
          onStartOver={async () => {
            if (!confirm('今の原稿を消して、最初から作り直しますか？\n（今の原稿は自動の控えに残します）')) return
            await saveSnapshot(snap.report)
            const fresh = createReport(config)
            editor.replace(fresh)
            prefillStudentId(editor)
            setDialog(null)
            // 作り直したら、はじめての案内からやり直す
            startGuide(config, editor.getSnapshot().report, true)
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {/* ---- ドライブ（ログイン必須） ---- */}
      {gate && <LoginGate gate={gate} reportName={config.reportName} fiscalYear={config.fiscalYear} onLogin={onGateLogin} />}
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
                startGuide(config, editor.getSnapshot().report, false)
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
              await saveSnapshot(driveDialog.remote.report)
              drive.activate()
              // 選ばなかったドライブの原稿のファイルに上書きする（原稿のファイルを2つにしない）
              await drive.overwrite(editor.getSnapshot().report, driveDialog.remote)
              setDriveDialog(null)
              if (driveDialog.atLogin) {
                prefillStudentId(editor)
                startGuide(config, editor.getSnapshot().report, false)
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
