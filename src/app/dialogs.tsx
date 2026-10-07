import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { YearConfig } from '../config'
import { newId } from '../editor/reportOps'
import { formatReference } from '../layout/document'
import type { Snapshot } from '../model/storage'
import type { Reference, Report } from '../model/types'
import { useDialogFocus } from './useDialogFocus'

/**
 * 画面の上に出す窓。keepOpen：窓の外を押しても Esc でも閉じない（書きかけの内容が消えないように。閉じるのは「×」とボタンだけ）。
 * className：窓の幅などを、窓ごとに変えるとき。heading：見出しに印（✓ など）を付けるとき（title は読み上げの名前）
 */
export function Modal({ title, heading, onClose, children, wide, keepOpen, className }: { title: string; heading?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean; keepOpen?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref, keepOpen ? undefined : onClose)
  return (
    <div className="modal-backdrop" onMouseDown={(e) => !keepOpen && e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}${className ? ` ${className}` : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header>
          <h2>{heading ?? title}</h2>
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
  useDialogFocus(ref, onClose)
  return (
    <div className="popover-backdrop" onMouseDown={onClose}>
      <div className="popover course-menu" ref={ref} role="dialog" aria-label="コースを選ぶ" style={{ left: rect.left, top: rect.bottom + 6 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="popover-title">コースを選ぶ</div>
        {config.courses.filter((c) => !c.hidden || c.id === current).map((c) => (
          <button
            key={c.id}
            className={c.id === current ? 'on' : ''}
            // 読み上げでも、いま選んでいるコースが分かるようにする
            aria-current={c.id === current ? 'true' : undefined}
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
    // 書きかけの内容が消えないよう、窓の外を押しても Esc でも閉じない（「×」と「やめる」「保存」だけ）
    <Modal title="引用・参考文献" onClose={onClose} wide keepOpen>
      <p className="lead">
        項目を埋めると、手順書の書き方（著者名、『書名』、出版社、出版年）に自動で整えます。なくても構いません。本文の後に改ページして載ります。
      </p>
      <div className="refs">
        {refs.map((ref, i) => (
          <div key={ref.id} className="ref-card">
            <div className="ref-head">
              <b>{i + 1}.</b>
              <select
                value={ref.type}
                aria-label={`${i + 1}つ目の種類`}
                onChange={(e) => {
                  // 書籍とWebサイトでは項目が違うため、入れ替えると書いた内容は消える。書いてあれば確かめる
                  const filled = Object.entries(ref).some(([k, v]) => k !== 'type' && k !== 'id' && k !== 'accessedOn' && typeof v === 'string' && v.trim())
                  if (filled && !confirm('種類を変えると、この文献に書いた内容は消えます。変えますか？')) return
                  setRefs(refs.map((r) => (r.id === ref.id ? emptyReference(e.target.value as Reference['type']) : r)))
                }}
              >
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

// ---- バックアップと復元 ----

export function BackupDialog({
  snapshots,
  driveStopped = false,
  onSaveBackup,
  onRestoreFile,
  onRestoreSnapshot,
  onStartOver,
  onClose,
}: {
  snapshots: Snapshot[]
  /** 管理ページでドライブ保存を止めている（説明の文を、この端末にだけ保存される、に変える） */
  driveStopped?: boolean
  onSaveBackup: () => void
  onRestoreFile: (file: File) => void
  onRestoreSnapshot: (s: Snapshot) => void
  onStartOver: () => void
  onClose: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <Modal title="バックアップと復元" onClose={onClose}>
      <p className="lead">
        {driveStopped
          ? '原稿は、書くたびに（書くのをやめて約1秒後に）このブラウザの中へ自動で保存されます。いまはドライブへの保存を止めているため（学科の判断）、原稿はこの端末にだけ保存されます。バックアップファイルは、念のための控えとして、ときどき保存しておくと安心です。'
          : '原稿は、書くたびに（書くのをやめて約1秒後に）このブラウザの中へ自動で保存され、大学のアカウントでログインしているあいだは Google ドライブにも保存されます（別の端末では、ログインすると続きが開きます）。バックアップファイルは、念のための控えとして、ときどき保存しておくと安心です。'}
      </p>
      <div className="backup-actions">
        <button className="primary" onClick={onSaveBackup}>
          バックアップファイルを保存
        </button>
        {/* キーボードでも選べるよう、ふつうのボタンからファイルを選ぶ画面を開く */}
        <button className="file-button" onClick={() => fileRef.current?.click()}>
          バックアップファイルから復元
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            // 選んだファイルを空に戻す（確かめる画面で「キャンセル」したあと、同じファイルを選び直せるように）
            e.target.value = ''
            if (file) onRestoreFile(file)
          }}
        />
      </div>
      <h3>自動の控え（誤って消したときに戻せる版。10分ごとに残します）</h3>
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
