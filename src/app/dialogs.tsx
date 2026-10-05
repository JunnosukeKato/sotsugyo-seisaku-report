import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { YearConfig } from '../config'
import type { ReportFinding } from '../checker/reportChecks'
import type { ReportEditor } from '../editor/reportEditor'
import { newId } from '../editor/reportOps'
import { formatReference } from '../layout/document'
import type { Snapshot } from '../model/storage'
import type { Reference, Report } from '../model/types'
import { AREA_LABELS } from './labels'

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}

// ---- コースの選択（表紙のコース欄をクリックしたとき） ----
// PC はコース欄のすぐ下（画面からはみ出すときは内側へずらす）、スマホは画面の下から出す（CSS）

export function CourseMenu({ config, rect, current, onSelect, onClose }: { config: YearConfig; rect: DOMRect; current: string; onSelect: (id: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const margin = 8
    const left = Math.max(margin, Math.min(rect.left, window.innerWidth - el.offsetWidth - margin))
    const below = rect.bottom + 6
    const top = below + el.offsetHeight > window.innerHeight - margin ? Math.max(margin, rect.top - el.offsetHeight - 6) : below
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [rect])
  return (
    <div className="popover-backdrop" onMouseDown={onClose}>
      <div className="popover course-menu" ref={ref} style={{ left: rect.left, top: rect.bottom + 6 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="popover-title">コースを選ぶ</div>
        {config.courses.filter((c) => !c.hidden || c.id === current).map((c) => (
          <button
            key={c.id}
            className={c.id === current ? 'on' : ''}
            onClick={() => {
              // 先に閉じる（選んだ後に確かめる画面を出すことがあるため）
              onClose()
              onSelect(c.id)
            }}
          >
            {c.name} コース
          </button>
        ))}
      </div>
    </div>
  )
}

// ---- 本文を書き始めてからコースを変えるとき ----

export function CourseChangeDialog({ courseName, onReplace, onNameOnly, onClose }: { courseName: string; onReplace: () => void; onNameOnly: () => void; onClose: () => void }) {
  return (
    <Modal title="コースを変えますか？" onClose={onClose}>
      <p className="lead">
        「{courseName}」コースに変えると、本文の下書きを、そのコースのひな形（章立てと、書くことの説明）に入れ替えます。
        いま書いている本文は「自動の控え」に残すので、あとで「バックアップ」から戻せます。
      </p>
      <p className="muted">表紙の学籍番号・氏名・サブタイトル、抄録、引用・参考文献、作品写真はそのまま残ります。</p>
      <div className="row-buttons">
        <button onClick={onClose}>やめる</button>
        <span className="spacer" />
        <button onClick={onNameOnly}>コース名だけ変える</button>
        <button className="primary" onClick={onReplace}>
          下書きを入れ替える
        </button>
      </div>
    </Modal>
  )
}

// ---- 引用・参考文献 ----

function emptyReference(type: Reference['type']): Reference {
  return type === 'book'
    ? { type, id: newId('ref'), author: '', title: '', publisher: '', year: '', pages: '' }
    : { type, id: newId('ref'), siteTitle: '', url: '', accessedOn: new Date().toISOString().slice(0, 10) }
}

function Field({ label, value, onChange, placeholder, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

export function ReferencesDialog({ report, onSave, onClose }: { report: Report; onSave: (refs: Reference[]) => void; onClose: () => void }) {
  const [refs, setRefs] = useState<Reference[]>(report.references)
  const update = (id: string, patch: Partial<Reference>) => setRefs(refs.map((r) => (r.id === id ? ({ ...r, ...patch } as Reference) : r)))
  return (
    <Modal title="引用・参考文献" onClose={onClose} wide>
      <p className="lead">
        項目を埋めると、手順書の書き方（著者名、『書名』、出版社、出版年）に自動で整えます。なくても構いません。本文の後に改ページして載ります。
      </p>
      <div className="refs">
        {refs.map((ref, i) => (
          <div key={ref.id} className="ref-card">
            <div className="ref-head">
              <b>{i + 1}.</b>
              <select value={ref.type} onChange={(e) => setRefs(refs.map((r) => (r.id === ref.id ? emptyReference(e.target.value as Reference['type']) : r)))}>
                <option value="book">書籍</option>
                <option value="web">Webサイト</option>
              </select>
              <span className="spacer" />
              <button className="danger" onClick={() => setRefs(refs.filter((r) => r.id !== ref.id))}>
                削除
              </button>
            </div>
            {ref.type === 'book' ? (
              <div className="ref-fields">
                <Field label="著者名" value={ref.author} onChange={(v) => update(ref.id, { author: v })} placeholder="例：浜松隆志" />
                <Field label="書名" value={ref.title} onChange={(v) => update(ref.id, { title: v })} placeholder="『』は自動で付きます" />
                <Field label="出版社" value={ref.publisher} onChange={(v) => update(ref.id, { publisher: v })} />
                <Field label="出版年" value={ref.year} onChange={(v) => update(ref.id, { year: v.replace(/[^0-9]/g, '') })} placeholder="例：1998" />
                <Field label="ページ（任意）" value={ref.pages} onChange={(v) => update(ref.id, { pages: v })} placeholder="例：17-24" />
              </div>
            ) : (
              <div className="ref-fields">
                <Field label="サイト名" value={ref.siteTitle} onChange={(v) => update(ref.id, { siteTitle: v })} placeholder="例：クラウン（紋章学）- Wikipedia" />
                <Field label="アドレス（URL）" value={ref.url} onChange={(v) => update(ref.id, { url: v })} placeholder="https://" />
                <Field label="参照日" type="date" value={ref.accessedOn} onChange={(v) => update(ref.id, { accessedOn: v })} />
              </div>
            )}
            <div className="ref-preview">・{formatReference(ref)}</div>
          </div>
        ))}
      </div>
      <div className="row-buttons">
        <button onClick={() => setRefs([...refs, emptyReference('book')])}>＋ 書籍を追加</button>
        <button onClick={() => setRefs([...refs, emptyReference('web')])}>＋ Webサイトを追加</button>
        <span className="spacer" />
        <button onClick={onClose}>やめる</button>
        <button
          className="primary"
          onClick={() => {
            onSave(refs)
            onClose()
          }}
        >
          反映する
        </button>
      </div>
    </Modal>
  )
}

// ---- PDF の書き出し ----

const SELF_CHECKS = [
  'タイトル（サブタイトルを含む）は、以前提出した申告書と同じにした',
  '作品写真は、自分で撮影した写真だけを使った',
  '指導教員に内容を見てもらい、了承を得た',
]

export function ExportDialog({ editor, findings, onClose }: { editor: ReportEditor; findings: ReportFinding[]; onClose: () => void }) {
  const errors = findings.filter((f) => f.severity === 'error')
  const warnings = findings.length - errors.length
  const [checked, setChecked] = useState<boolean[]>(SELF_CHECKS.map(() => false))
  const allChecked = checked.every(Boolean)

  const print = () => {
    const title = document.title
    document.title = editor.pdfTitle
    window.addEventListener('afterprint', () => (document.title = title), { once: true })
    onClose()
    // ダイアログが閉じてから印刷画面を開く
    setTimeout(() => window.print(), 50)
  }

  if (errors.length > 0) {
    return (
      <Modal title="PDFを書き出す前に" onClose={onClose}>
        <p className="lead">
          手順書のルールに合っていない箇所（エラー）が <b className="ng">{errors.length}件</b> あります。エラーを0件にすると、提出用のPDFを書き出せます。
        </p>
        <ul className="error-list">
          {errors.slice(0, 8).map((f, i) => (
            <li key={i}>
              <button
                className="link"
                onClick={() => {
                  onClose()
                  editor.goToFinding(f)
                }}
              >
                {AREA_LABELS[f.area]}：{f.title}
              </button>
              {f.detail && <span className="detail">（{f.detail}）</span>}
            </li>
          ))}
          {errors.length > 8 && <li>ほか {errors.length - 8}件（右のセルフチェックを見てください）</li>}
        </ul>
        <div className="row-buttons">
          <span className="spacer" />
          <button className="primary" onClick={onClose}>
            直しに戻る
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="提出用のPDFを書き出す" onClose={onClose}>
      <p className="lead">
        エラーはありません{warnings > 0 ? `（警告が${warnings}件あります。内容を確認してください）` : ''}。最後に、次のことを確認してください。
      </p>
      <div className="checklist">
        {SELF_CHECKS.map((text, i) => (
          <label key={i}>
            <input type="checkbox" checked={checked[i]} onChange={(e) => setChecked(checked.map((c, j) => (j === i ? e.target.checked : c)))} />
            {text}
          </label>
        ))}
      </div>
      <div className="print-guide">
        <b>印刷の画面で、次のように選んでください</b>
        <ul>
          <li>送信先：<b>PDFに保存</b></li>
          <li>用紙サイズ：<b>A4</b>　／　倍率：<b>既定（100%）</b></li>
          <li>詳細設定の「ヘッダーとフッター」：<b>オフ</b>　「背景のグラフィック」：<b>オン</b></li>
        </ul>
        ファイル名は「{editor.pdfTitle}.pdf」になります。
      </div>
      <div className="row-buttons">
        <span className="spacer" />
        <button onClick={onClose}>やめる</button>
        <button className="primary" disabled={!allChecked} onClick={print}>
          印刷の画面を開く
        </button>
      </div>
    </Modal>
  )
}

// ---- バックアップと復元 ----

export function BackupDialog({
  snapshots,
  onSaveBackup,
  onRestoreFile,
  onRestoreSnapshot,
  onStartOver,
  onClose,
}: {
  snapshots: Snapshot[]
  onSaveBackup: () => void
  onRestoreFile: (file: File) => void
  onRestoreSnapshot: (s: Snapshot) => void
  onStartOver: () => void
  onClose: () => void
}) {
  return (
    <Modal title="バックアップと復元" onClose={onClose}>
      <p className="lead">
        原稿はこのブラウザの中に自動で保存されています。別のパソコンで続きを書くときや、念のための控えとして、ときどきバックアップファイルを保存してください。
      </p>
      <div className="backup-actions">
        <button className="primary" onClick={onSaveBackup}>
          バックアップファイルを保存
        </button>
        <label className="file-button">
          バックアップファイルから復元
          <input type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && onRestoreFile(e.target.files[0])} />
        </label>
      </div>
      <h3>自動の控え（10分ごと）</h3>
      {snapshots.length === 0 ? (
        <p className="muted">まだ控えはありません。</p>
      ) : (
        <ul className="snapshots">
          {snapshots.map((s) => (
            <li key={s.savedAt}>
              <span>{new Date(s.savedAt).toLocaleString('ja-JP')}</span>
              <button onClick={() => onRestoreSnapshot(s)}>この時点に戻す</button>
            </li>
          ))}
        </ul>
      )}
      <div className="row-buttons">
        <button className="danger" onClick={onStartOver}>
          最初から作り直す
        </button>
        <span className="spacer" />
        <button onClick={onClose}>閉じる</button>
      </div>
    </Modal>
  )
}
