import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { currentConfig, findCourse, type YearConfig } from './config'
import { loadConfig } from './config/remote'
import { ReportEditor, type EditorSnapshot } from './editor/reportEditor'
import { backupFileName, createBackup, readBackup } from './model/backup'
import { createReport } from './model/newReport'
import { allImages, listSnapshots, loadReport, putImage, saveSnapshot, usedImageIds, type Snapshot } from './model/storage'
import { BackupDialog, CourseChangeDialog, CourseMenu, ExportDialog, ReferencesDialog } from './app/dialogs'
import { Icon } from './app/icons'
import { Palette } from './app/Palette'
import { PhoneChrome } from './app/Phone'
import { useKeyboardInset, useNarrow, useSwipe, useWheelPaging } from './app/uiShared'
import { SidePanel } from './app/SidePanel'
import { StartGuide, type GuideStep } from './app/StartGuide'
import { useAutosave } from './app/useAutosave'

const noopSubscribe = () => () => {}
const nullSnapshot = () => null

type Dialog =
  | { kind: 'export' }
  | { kind: 'references' }
  | { kind: 'backup'; snapshots: Snapshot[] }
  | { kind: 'course'; rect: DOMRect }
  | { kind: 'courseChange'; courseId: string }
  | null

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
  const autosave = useAutosave()
  const snap = useSyncExternalStore(editor?.subscribe ?? noopSubscribe, editor?.getSnapshot ?? nullSnapshot) as EditorSnapshot | null
  // スマホ（画面の幅が狭いとき）は、並べ方と書き方を変える
  const narrow = useNarrow()
  const hasLayout = !!snap?.layout
  useKeyboardInset()
  useSwipe(stageRef, editor, narrow)
  // ホイールでページを送る（コースを選ぶ案内や、画面の上に出る窓が開いている間は送らない）
  useWheelPaging(stageRef, scrollerRef, editor, !dialog && guide !== 'course')
  useEffect(() => {
    if (editor && hasLayout) editor.setSheetHost(narrow ? sheetHostRef.current : null)
  }, [editor, narrow, hasLayout])

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      try {
        const { config: loaded } = await loadConfig()
        setConfig(loaded)
        const saved = await loadReport()
        const report = saved ?? createReport(loaded)
        const ed = new ReportEditor(stageRef.current!, scrollerRef.current!, layerRef.current!, loaded, report, {
          onChange: autosave.save,
          onCourseClick: (rect) => setDialog({ kind: 'course', rect }),
          onReferencesClick: () => setDialog({ kind: 'references' }),
          pickImage: pickImageFile,
        })
        ed.addImages(await allImages())
        setEditor(ed)
        // 開発中だけ、自動テストから操作できるようにする
        if (import.meta.env.DEV) Object.assign(window, { __editor: ed })
        await ed.render()
        // はじめて開いたときは、コースを選ぶところから案内する（コースが1つだけなら学籍番号から）。コースを選んでいない原稿も、コースを選ぶ案内を出す
        if (!findCourse(loaded, report.basicInfo.courseId)) setGuide('course')
        else if (!saved) setGuide('studentId')
      } catch (e) {
        setLoadError(String(e))
      }
    })()
  }, [autosave.save])

  // キーボード：Ctrl+Z（入力欄の外）で元に戻す、Ctrl+S は保存されていることを示す（ブラウザの保存画面を出さない）
  // ←→・PageUp／PageDown（入力欄の外）でページを送る
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!editor) return
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !isTyping(e.target)) {
          e.preventDefault()
          editor.undo()
        } else if (e.key === 's') {
          e.preventDefault()
        }
        return
      }
      if (dialog || guide === 'course' || isTyping(e.target) || e.altKey) return
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
  }, [editor, dialog, guide])

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
    <div className={`app${narrow ? ' phone' : ''}`}>
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
          saveState={autosave.state}
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
      {ready && guide && snap.layout && (
        <StartGuide
          editor={editor}
          snap={snap}
          config={config}
          narrow={narrow}
          step={guide}
          onStep={setGuide}
          onChooseCourse={(courseId) => {
            editor.changeCourseWithTemplate(courseId)
            setGuide('studentId')
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
            setDialog(null)
            // 作り直したら、はじめての案内からやり直す
            setGuide(findCourse(config, fresh.basicInfo.courseId) ? 'studentId' : 'course')
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}
