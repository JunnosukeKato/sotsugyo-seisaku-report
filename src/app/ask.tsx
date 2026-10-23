import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { confirmParts, isList } from './confirmText'
import { useDialogFocus } from './useDialogFocus'

/**
 * 学生のツールの確認の窓・知らせの窓（画面の中に出す。管理ページの admin/confirm.tsx と同じ形：依頼者の選択 2026-10-23）。
 * 前はブラウザの確認（confirm・alert）だったが、学生の試し（iPhone の Chrome）で「読み込む前の原稿に戻す」を押しても何も起きなかった。
 * ブラウザの確認は、「このサイトのダイアログをブロック」（「このページでこれ以上ダイアログを表示しない」）を選ぶと、
 * それからは出ずに黙って「キャンセル」になり、アプリの中のブラウザでも出ないことがある
 */
export interface AskOptions {
  /** 窓の題（なければ、言葉の中の問いの文。例：「戻しますか？」） */
  title?: string
  /** 進めるボタンの名前（なければ「OK」） */
  ok?: string
  /** 消える・取り消せないこと（はじめは「やめる」を選んでおき、進めるボタンを赤くする） */
  danger?: boolean
}

export interface Ask {
  /** 確かめる（進めるなら true、やめる・閉じるなら false） */
  confirm: (text: string, options?: AskOptions) => Promise<boolean>
  /** 知らせる（「OK」か閉じるで終わる） */
  alert: (text: string, options?: { title?: string }) => Promise<void>
}

const AskContext = createContext<Ask>({ confirm: () => Promise.resolve(false), alert: () => Promise.resolve() })
/** 確認の窓を出している間か（その間は、押したボタンの「〜しています…」を出さない：Busy.tsx の BusyLabel） */
const AskingContext = createContext(false)

/** 確認の窓・知らせの窓を出す関数（AskProvider の中で使う） */
export const useAsk = (): Ask => useContext(AskContext)

/** 確認の窓・知らせの窓を出している間か */
export const useAsking = (): boolean => useContext(AskingContext)

interface Request {
  kind: 'confirm' | 'alert'
  text: string
  options: AskOptions
  resolve: (ok: boolean) => void
}

/** 確認の窓を出せるようにする（ツール全体を包む）。窓は1つずつ（開いているときに次を頼まれたら、前のものは「やめる」にする） */
export function AskProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null)
  const current = useRef<Request | null>(null)
  const open = useCallback(
    (kind: Request['kind'], text: string, options: AskOptions) =>
      new Promise<boolean>((resolve) => {
        current.current?.resolve(false)
        const next = { kind, text, options, resolve }
        current.current = next
        setRequest(next)
      }),
    [],
  )
  const [ask] = useState<Ask>(() => ({
    confirm: (text, options = {}) => open('confirm', text, options),
    alert: async (text, options = {}) => void (await open('alert', text, options)),
  }))
  const answer = (ok: boolean) => {
    const r = current.current
    current.current = null
    setRequest(null)
    r?.resolve(ok)
  }
  return (
    <AskContext.Provider value={ask}>
      <AskingContext.Provider value={request !== null}>
        {children}
        {request && <AskDialog request={request} onAnswer={answer} />}
      </AskingContext.Provider>
    </AskContext.Provider>
  )
}

function AskDialog({ request, onAnswer }: { request: Request; onAnswer: (ok: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref, () => onAnswer(false))
  const parts = request.kind === 'confirm' ? confirmParts(request.text) : { title: 'お知らせ', body: request.text.trim() }
  const title = request.options.title ?? parts.title
  const danger = request.options.danger === true
  return (
    <div className="modal-backdrop confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onAnswer(false)}>
      {/* data-text：言葉そのまま（確かめのスクリプトが読む：scripts/e2e/confirmUi.mjs） */}
      <div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="ask-title" aria-describedby="ask-body" data-text={request.text} ref={ref}>
        <header>
          <h2 id="ask-title">{title}</h2>
          <button className="close" onClick={() => onAnswer(false)} aria-label="閉じる">
            ×
          </button>
        </header>
        <div id="ask-body" className="confirm-body">
          {parts.body
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
        <div className="row-buttons confirm-buttons">
          {request.kind === 'confirm' && (
            <button data-confirm="cancel" data-autofocus={danger || undefined} onClick={() => onAnswer(false)}>
              やめる
            </button>
          )}
          <button className={danger ? 'danger-fill' : 'primary'} data-confirm="ok" data-autofocus={!danger || undefined} onClick={() => onAnswer(true)}>
            {request.options.ok ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}
