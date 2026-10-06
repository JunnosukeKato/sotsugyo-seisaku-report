import { useEffect, useRef, useState } from 'react'
import { summarize, type DriveState, type RemoteCopy } from '../drive/driveSync'
import { UNIVERSITY_DOMAIN } from '../model/account'
import type { Report } from '../model/types'
import type { SaveState } from './useAutosave'

/**
 * Google ドライブへの保存の画面（mockups/v18 案3・v19 案A）。
 * - LoginGate：開いたら、まず大学のアカウントでログインする窓（紙面の上に重ねる）
 * - DriveChip：保存のようす（右の欄・スマホの上の帯）。押すとドライブの操作（DriveMenu）が開く
 * - ConflictDialog・WipeDialog・ReloginDialog・OtherAccountDialog：確認の窓
 */

const DOMAIN = UNIVERSITY_DOMAIN

const cloud = (check: boolean) => (
  <svg className="drive-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 18.5h10.5a4 4 0 0 0 .7-7.94A6 6 0 0 0 6.6 9.6 4.5 4.5 0 0 0 7 18.5z" />
    {check && <path d="M9.4 13.7l2 2 3.6-3.7" />}
  </svg>
)

/** Google のログインのボタンに付ける「G」の印 */
const googleMark = (
  <svg className="login-g" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
)

/** 時刻（今日なら「13:44」、ほかの日なら「10/6 13:44」） */
function formatTime(at: Date): string {
  const time = at.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  return at.toDateString() === new Date().toDateString() ? time : `${at.getMonth() + 1}/${at.getDate()} ${time}`
}

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  return online
}

// ---- ログイン ----

export type GateState =
  | { kind: 'login' }
  /** Google の窓でログインしている */
  | { kind: 'signing' }
  /** ドライブの原稿を確かめている・読み込んでいる */
  | { kind: 'loading'; done?: number; total?: number }
  | { kind: 'error'; message: string; detail?: string }

export function LoginGate({ gate, reportName, fiscalYear, onLogin }: { gate: GateState; reportName: string; fiscalYear: number; onLogin: () => void }) {
  const online = useOnline()
  const brand = (
    <div className="login-brand">
      <span className="login-mark">卒</span>
      <div>
        <b>{reportName}</b>
        <span>{fiscalYear}年度　作成ツール</span>
      </div>
    </div>
  )
  const note = (
    <p className="login-small">
      @{DOMAIN} のアカウントを選んでください。このツールが見られるのは、このツールで作ったファイルだけです。学科や先生が、あなたのドライブを見ることはありません。
    </p>
  )
  const button = (label: string) => (
    <button className="login-btn" disabled={!online || gate.kind === 'signing'} onClick={onLogin}>
      {googleMark}
      {gate.kind === 'signing' ? 'ログインしています…' : label}
    </button>
  )
  return (
    <div className="login-over" role="dialog" aria-label="ログイン">
      <div className="login-card">
        {brand}
        {gate.kind === 'loading' ? (
          <>
            <div className="login-spin">ドライブの原稿を確かめています…</div>
            {!!gate.total && (
              <>
                <div className="login-progress">
                  <i style={{ width: `${Math.round(((gate.done ?? 0) / gate.total) * 100)}%` }} />
                </div>
                <p className="login-small">
                  写真 {gate.done ?? 0} / {gate.total} 枚（写真が多いと、少し時間がかかります）
                </p>
              </>
            )}
          </>
        ) : (
          <>
            {!online ? (
              <div className="login-warn">インターネットにつながっていません。つながると、ログインできるようになります。</div>
            ) : gate.kind === 'error' ? (
              <div className="login-err">
                {gate.message}
                <small>ログインの窓が開かないときは、ブラウザのポップアップを許可してください</small>
              </div>
            ) : (
              <p className="login-lead">大学の Google アカウントでログインしてください。原稿は、あなたの Google ドライブ（「卒業制作報告書」フォルダ）に自動で保存されます。</p>
            )}
            {button(gate.kind === 'error' ? 'もう一度ログインする' : '大学のアカウントでログイン')}
            {online ? note : <p className="login-small">原稿はドライブに保存するため、ログインしてから書きます。</p>}
          </>
        )}
      </div>
    </div>
  )
}

// ---- 保存のようす ----

export interface DriveControls {
  state: DriveState
  /** この端末（ブラウザ）への保存 */
  local: SaveState
  lastSaved: Date | null
  /** 教職員のアカウント（学籍番号の形でないアドレス）で試している */
  staff: boolean
  onSaveNow: () => void
  onReload: () => void
  onWipe: () => void
  onRelogin: () => void
}

const localTime = (local: SaveState) => (local.status === 'saved' ? ` ${formatTime(local.at)}` : '')

/** 保存のようす。compact はスマホの上の帯 */
export function DriveChip({ drive, compact, onClick }: { drive: DriveControls; compact?: boolean; onClick?: () => void }) {
  const { status } = drive.state
  const props = { onClick, role: onClick ? 'button' : undefined, title: '原稿は、この端末とあなたの Google ドライブに保存されます' }
  const click = onClick ? ' click' : ''
  switch (status.kind) {
    case 'saving':
      return (
        <span className={`chip${click}`} {...props}>
          <i className="dot busy" />
          {compact ? '保存中' : 'ドライブに保存しています…'}
        </span>
      )
    case 'saved':
      return (
        <span className={`chip ok${click}`} {...props}>
          {cloud(true)}
          {compact ? formatTime(status.at) : `ドライブに保存 ${formatTime(status.at)}`}
          {onClick && <span className="caret">▾</span>}
        </span>
      )
    case 'offline':
      return (
        <span className={`chip warn${click}`} {...props} title="電波がないため、ドライブには送れていません。つながったら自動で送ります">
          <i className="dot warn" />
          {compact ? '電波なし' : `この端末にだけ保存${localTime(drive.local)}（電波なし）`}
        </span>
      )
    case 'expired':
    case 'conflict':
    case 'error':
      return (
        <span className={`chip ng${click}`} {...props} title={status.kind === 'error' ? status.message : undefined}>
          <i className="dot ng" />
          {compact ? '未保存' : status.kind === 'expired' ? (
            <>
              ドライブに保存できません　<u>ログインし直す</u>
            </>
          ) : status.kind === 'conflict' ? (
            '別の端末の原稿があります'
          ) : (
            'ドライブに保存できません'
          )}
        </span>
      )
    default:
      return (
        <span className={`chip ok${click}`} {...props}>
          {cloud(false)}
          {compact ? 'ドライブ' : 'ドライブにつながっています'}
          {onClick && <span className="caret">▾</span>}
        </span>
      )
  }
}

/** ドライブの操作（PC は保存のようすを押すと開く。スマホはメニューの中） */
export function DriveMenu({ drive, inline, onDone }: { drive: DriveControls; inline?: boolean; onDone?: () => void }) {
  const { status, email } = drive.state
  const lastSaved = status.kind === 'saved' ? status.at : drive.lastSaved
  const act = (fn: () => void) => () => {
    onDone?.()
    fn()
  }
  return (
    <div className={`drive-pop${inline ? ' inline' : ''}`}>
      <div className="who">
        {cloud(true)}
        <div>
          <b>ドライブにつないでいます</b>
          <small>{email}</small>
        </div>
      </div>
      <div className="when">
        {lastSaved ? `最後にドライブに保存：${formatTime(lastSaved)}` : 'まだドライブに保存していません'}
        <br />
        この端末（ブラウザ）にも保存しています
        {status.kind === 'offline' && <em>電波がないため、ドライブには送れていません。つながったら自動で送ります。</em>}
        {status.kind === 'error' && <em>{status.message}</em>}
      </div>
      {status.kind === 'expired' ? <button onClick={act(drive.onRelogin)}>ログインし直す</button> : <button onClick={act(drive.onSaveNow)}>今すぐドライブに保存</button>}
      <button onClick={act(drive.onReload)}>ドライブの原稿を読み込み直す</button>
      <button onClick={act(drive.onWipe)}>この端末から原稿を消す（共用のパソコンで）</button>
    </div>
  )
}

/** PC の右の欄：保存のようすと、押すと開くドライブの操作 */
export function DriveChipMenu({ drive }: { drive: DriveControls }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  return (
    <span className="drive-chip-wrap" ref={ref}>
      <DriveChip drive={drive} onClick={() => setOpen(!open)} />
      {open && <DriveMenu drive={drive} onDone={() => setOpen(false)} />}
    </span>
  )
}

// ---- 確認の窓 ----

const describe = (report: Report) => {
  const s = summarize(report)
  return `本文 ${s.chars.toLocaleString('ja-JP')}字・図 ${s.figures}枚・作品写真 ${s.photos}枚`
}

/** この端末とドライブの両方で書いているとき：どちらで続けるかを選ぶ */
export function ConflictDialog({
  local,
  remote,
  atLogin,
  busy,
  onChooseRemote,
  onChooseLocal,
}: {
  local: Report
  remote: RemoteCopy
  /** ログインした直後（この端末の原稿を、ドライブとつなぐ前に書いていた） */
  atLogin: boolean
  busy: boolean
  onChooseRemote: () => void
  onChooseLocal: () => void
}) {
  const remoteNewer = remote.savedAt >= local.updatedAt
  const at = (iso: string) => formatTime(new Date(iso))
  return (
    <div className="modal-backdrop">
      <div className="modal wide" role="dialog" aria-label="どちらの原稿で続けますか">
        <header>
          <h2>{atLogin ? 'この端末とドライブで、原稿が違います' : '別の端末で書いた原稿が、ドライブにあります'}</h2>
        </header>
        <p className="lead">どちらの原稿で続けますか？　選ばなかった方は「自動の控え」に残るので、あとで戻せます（「バックアップ」から）。</p>
        <div className="drive-two">
          <div className={remoteNewer ? 'new' : ''}>
            <b>
              {cloud(true)}ドライブの原稿{remoteNewer && <em>新しい</em>}
            </b>
            <span>
              {at(remote.savedAt)} に保存{remote.device ? `（${remote.device}）` : ''}
            </span>
            <span>{describe(remote.report)}</span>
          </div>
          <div className={remoteNewer ? '' : 'new'}>
            <b>この端末の原稿{!remoteNewer && <em>新しい</em>}</b>
            <span>{at(local.updatedAt)} に保存（この端末）</span>
            <span>{describe(local)}</span>
          </div>
        </div>
        <div className="row-buttons">
          <span className="spacer" />
          <button className={remoteNewer ? '' : 'primary'} disabled={busy} onClick={onChooseLocal}>
            この端末の原稿で続ける
          </button>
          <button className={remoteNewer ? 'primary' : ''} disabled={busy} onClick={onChooseRemote}>
            ドライブの原稿を開く
          </button>
        </div>
      </div>
    </div>
  )
}

/** 共用のパソコンで書き終えたとき：この端末から原稿を消す */
export function WipeDialog({ lastSaved, busy, onConfirm, onClose }: { lastSaved: Date | null; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal" role="dialog" aria-label="この端末から原稿を消しますか">
        <header>
          <h2>この端末から原稿を消しますか？</h2>
          <button className="close" onClick={onClose} disabled={busy} aria-label="閉じる">
            ×
          </button>
        </header>
        <p className="lead">
          原稿はドライブに保存されています{lastSaved ? `（${formatTime(lastSaved)}）` : ''}。大学のパソコン室など、共用のパソコンで書き終えたときに使います。
        </p>
        <p className="drive-small">
          消したあとは、このブラウザに原稿は残りません。次に書くときは、ツールを開いてログインすると、ドライブの原稿が開きます。Google からのログアウトは、ブラウザの Google の画面（右上のアカウントの印）で行ってください。
        </p>
        <div className="row-buttons">
          <span className="spacer" />
          <button onClick={onClose} disabled={busy}>
            やめる
          </button>
          <button className="primary" onClick={onConfirm} disabled={busy}>
            {busy ? 'ドライブに保存しています…' : 'この端末から消す（ドライブの原稿は残ります）'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 書いている途中で、Google の許可が切れたとき */
export function ReloginDialog({ busy, error, onLogin }: { busy: boolean; error: string | null; onLogin: () => void }) {
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-label="もう一度ログインしてください">
        <header>
          <h2>もう一度ログインしてください</h2>
        </header>
        <p className="lead">ドライブへの保存を続けるため、ログインし直してください（Google の決まりで、1時間ごとに必要です）。</p>
        {error && <p className="drive-err">{error}</p>}
        <p className="drive-small">押すまでのあいだも、書いた内容はこの端末に保存しています。</p>
        <div className="row-buttons">
          <span className="spacer" />
          <button className="primary" disabled={busy} onClick={onLogin}>
            {busy ? 'ログインしています…' : 'ログインし直す'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** この端末に、別のアカウントの原稿が残っているとき（共用のパソコンなど） */
export function OtherAccountDialog({ previousEmail, unsynced, onRelogin, onDiscard }: { previousEmail: string; unsynced: boolean; onRelogin: () => void; onDiscard: () => void }) {
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-label="別のアカウントの原稿があります">
        <header>
          <h2>この端末には、別のアカウントの原稿があります</h2>
        </header>
        <p className="lead">
          {previousEmail} の原稿が、この端末に残っています。
          {unsynced ? 'その原稿には、まだドライブに保存していない変更があります。' : 'その原稿は、そのアカウントのドライブに保存済みです。'}
        </p>
        <p className="drive-small">
          {unsynced
            ? '自分の原稿なら「前のアカウントでログインし直す」を押してください。ほかの人の原稿なら、その人に知らせてください（消すと、保存していない変更はなくなります）。'
            : 'この端末から前の原稿を消して、今のアカウントの原稿を開きます。'}
        </p>
        <div className="row-buttons">
          <span className="spacer" />
          <button onClick={onRelogin}>前のアカウントでログインし直す</button>
          <button className={unsynced ? 'danger' : 'primary'} onClick={onDiscard}>
            前の原稿を消して続ける
          </button>
        </div>
      </div>
    </div>
  )
}
