import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { currentConfig, type YearConfig } from './config'
import { loadConfig } from './config/remote'
import { ReportEditor, type EditorSnapshot } from './editor/reportEditor'
import { backupFileName, createBackup, readBackup } from './model/backup'
import { createReport } from './model/newReport'
import { allImages, listSnapshots, loadReport, putImage, saveSnapshot, usedImageIds, type Snapshot } from './model/storage'
import { CheckPanel } from './app/CheckPanel'
import { BackupDialog, CourseMenu, ExportDialog, ReferencesDialog } from './app/dialogs'
import { daysUntil, formatDeadline } from './app/labels'
import { PageNav } from './app/PageNav'
import { Toolbar } from './app/Toolbar'
import { useAutosave, type SaveState } from './app/useAutosave'


const noopSubscribe = () => () => {}
const nullSnapshot = () => null

type Dialog = { kind: 'export' } | { kind: 'references' } | { kind: 'backup'; snapshots: Snapshot[] } | { kind: 'course'; rect: DOMRect } | null

function SaveStatus({ state }: { state: SaveState }) {
  if (state.status === 'saving') return <span className="save-status">保存しています…</span>
  if (state.status === 'saved')
    return <span className="save-status ok">✓ 自動保存しました（{state.at.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}）</span>
  if (state.status === 'error') return <span className="save-status ng">保存できませんでした。バックアップファイルを保存してください</span>
  return <span className="save-status">原稿はこのブラウザに自動で保存されます</span>
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

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function App() {
  const viewportRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const started = useRef(false)
  const [config, setConfig] = useState<YearConfig>(currentConfig)
  const [editor, setEditor] = useState<ReportEditor | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const autosave = useAutosave()
  const snap = useSyncExternalStore(editor?.subscribe ?? noopSubscribe, editor?.getSnapshot ?? nullSnapshot) as EditorSnapshot | null

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      try {
        const { config: loaded } = await loadConfig()
        setConfig(loaded)
        const report = (await loadReport()) ?? createReport(loaded)
        const ed = new ReportEditor(viewportRef.current!, layerRef.current!, loaded, report, {
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
      } catch (e) {
        setLoadError(String(e))
      }
    })()
  }, [autosave.save])

  // Ctrl+Z（入力欄の外）：元に戻す。Ctrl+S：保存されていることを示す（ブラウザの保存画面を出さない）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !editor) return
      const inEditor = (e.target as HTMLElement).closest('.overlay-editor, input, textarea')
      if (e.key === 'z' && !inEditor) {
        e.preventDefault()
        editor.undo()
      } else if (e.key === 's') {
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor])

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

  const days = daysUntil(config.deadline)

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          {config.reportName}
          <small>{config.fiscalYear}年度</small>
        </div>
        <SaveStatus state={autosave.state} />
        <span className="spacer" />
        <span className="deadline">
          最終締切 {formatDeadline(config.deadline)} {days >= 0 ? <b>あと{days}日</b> : <b className="ng">締切を過ぎています</b>}
        </span>
        {config.handbookUrl && (
          <a className="btn" href={config.handbookUrl} target="_blank" rel="noreferrer">
            手順書
          </a>
        )}
        <button className="btn" onClick={() => editor?.undo()} disabled={!snap?.canUndo}>
          元に戻す
        </button>
        <button className="btn" onClick={async () => setDialog({ kind: 'backup', snapshots: await listSnapshots() })} disabled={!editor}>
          バックアップ
        </button>
        <button
          className="btn primary"
          disabled={!snap || snap.rendering}
          onClick={async () => {
            editor?.commitEditing()
            await editor?.render()
            setDialog({ kind: 'export' })
          }}
        >
          PDFを書き出す
        </button>
      </header>

      <main className="app-main">
        {editor && snap ? <PageNav editor={editor} snap={snap} /> : <nav className="page-nav" />}
        <section className="center">
          {editor && snap ? <Toolbar editor={editor} snap={snap} /> : <div className="toolbar" />}
          <div className="canvas">
            <div id="vivliostyle-viewer-viewport" ref={viewportRef} />
            <div id="overlay-layer" ref={layerRef} />
            {(!snap || (snap.rendering && !snap.layout)) && !loadError && <div className="loading">紙面を準備しています…（初回は数秒かかります）</div>}
            {loadError && <div className="loading ng">読み込みに失敗しました：{loadError}</div>}
          </div>
        </section>
        {editor && snap ? <CheckPanel editor={editor} snap={snap} config={config} /> : <aside className="check-panel" />}
      </main>

      {dialog?.kind === 'course' && snap && editor && (
        <CourseMenu config={config} rect={dialog.rect} current={snap.report.basicInfo.courseId} onSelect={(id) => editor.setCourse(id)} onClose={() => setDialog(null)} />
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
            editor.replace(createReport(config))
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}
