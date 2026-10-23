import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { confirmParts, isList } from '../app/confirmText'
import { useDialogFocus } from '../app/useDialogFocus'

/**
 * 管理ページの確認の窓（画面の中に出す。「変更を見る」の窓と同じ形：依頼者の選択 2026-10-22 案1）。
 * 前はブラウザの確認（confirm）だったが、アプリ内ブラウザでは窓が出ずに「キャンセル」になり、「保存して学生に反映」を押しても何も起こらなかった。
 * Chrome などでも、確認の窓の「このページでこれ以上ダイアログを表示しない」に印を付けると、それからは黙って「キャンセル」になる
 */
export interface ConfirmOptions {
  /** 窓の題（なければ、言葉の中の問いの文。例：「保存しますか？」） */
  title?: string
  /** 進めるボタンの名前（なければ「OK」） */
  ok?: string
  /** 入力が消える・削除するなど、取り消せないこと（はじめは「やめる」を選んでおく） */
  danger?: boolean
}

/** 確かめる（進めるなら true、やめるなら false） */
export type Confirm = (text: string, options?: ConfirmOptions) => Promise<boolean>

// 確認の言葉の分け方は、学生のツールの確認の窓（app/ask.tsx）と同じ
export { confirmParts }

const ConfirmContext = createContext<Confirm>(() => Promise.resolve(false))

/** 確認の窓を出す関数（ConfirmProvider の中で使う） */
export const useConfirm = (): Confirm => useContext(ConfirmContext)

interface Request {
  text: string
  options: ConfirmOptions
  resolve: (ok: boolean) => void
}

/** 確認の窓を出せるようにする（管理ページ全体を包む）。窓は1つずつ（開いているときに次を頼まれたら、前のものは「やめる」にする） */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null)
  const current = useRef<Request | null>(null)
  const ask = useCallback<Confirm>(
    (text, options = {}) =>
      new Promise<boolean>((resolve) => {
        current.current?.resolve(false)
        const next = { text, options, resolve }
        current.current = next
        setRequest(next)
      }),
    [],
  )
  const answer = (ok: boolean) => {
    const r = current.current
    current.current = null
    setRequest(null)
    r?.resolve(ok)
  }
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {request && <ConfirmDialog request={request} onAnswer={answer} />}
    </ConfirmContext.Provider>
  )
}

function ConfirmDialog({ request, onAnswer }: { request: Request; onAnswer: (ok: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref, () => onAnswer(false))
  const { title: asked, body } = confirmParts(request.text)
  const title = request.options.title ?? asked
  const danger = request.options.danger === true
  return (
    <div className="modal-backdrop confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onAnswer(false)}>
      {/* data-text：確認の言葉そのまま（確かめのスクリプトが読む：scripts/e2e/confirmUi.mjs） */}
      <div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-body" data-text={request.text} ref={ref}>
        <header>
          <h2 id="confirm-title">{title}</h2>
          <button className="close" onClick={() => onAnswer(false)} aria-label="閉じる">
            ×
          </button>
        </header>
        <div id="confirm-body" className="confirm-body">
          {body
            .split(/\n{2,}/)
            .filter(Boolean)
            .map((p, i) =>
              isList(p) ? (
                <ul key={i} className="confirm-list">
                  {p.split('\n').map((l) => (
                    <li key={l}>{l.slice(1)}</li>
                  ))}
                </ul>
              ) : (
                <p key={i}>{p}</p>
              ),
            )}
        </div>
        <div className="row-buttons">
          <span className="spacer" />
          <button className="btn" data-autofocus={danger || undefined} onClick={() => onAnswer(false)}>
            やめる
          </button>
          <button className={`btn ${danger ? 'danger-fill' : 'primary'}`} data-autofocus={!danger || undefined} data-confirm="ok" onClick={() => onAnswer(true)}>
            {request.options.ok ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}
