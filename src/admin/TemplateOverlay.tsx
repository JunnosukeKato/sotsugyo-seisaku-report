import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDialogFocus } from '../app/useDialogFocus'
import type { Course, TemplateBlock, YearConfig } from '../config'
import { DEFAULT_TOOL_URL, FROM_ADMIN, FROM_TOOL, newNonce, receivedProblems, templateToolUrls, type InitMessage, type InitPayload, type TemplateYearStatus } from '../template/protocol'
import { courseName } from './changes'
import { useConfirm } from './confirm'
import { useLeaveGuard } from './useLeaveGuard'
import { Waiting } from './Wait'

/**
 * 下書きのひな形を、学生と同じ紙面で作る画面を、管理ページの上に重ねて開く（mockups/v44 案A・重ねて開く）。
 * 窓の中の iframe に学生のツールを ?template=1 で開き、ひな形を postMessage で渡す・受け取る（やり取りの決まりは src/template/protocol.ts）。
 * - 受け取るのは、ツールの場所（toolOrigin）の、この iframe から来た、開くたびに作る合言葉（nonce）の付いた知らせだけ
 * - 「管理ページに戻して反映」：受け取ったひな形を確かめてから、今の「反映する」と同じく、まだ保存していない変更にする（onApply）
 * - 「やめる」・「×」：ツールで直していたら、確かめてから閉じる
 * 開けない（ツールの場所につながらないなど）ときは、前の作り方の窓（TemplateEditor.tsx）で直せる
 */

/**
 * 学生のツールの場所。開発中は、この開発サーバー（管理ページと同じ場所）。
 * 本番（Apps Script に載せる管理ページ）は、scripts/build-gas.mjs が入れる VITE_TOOL_URL（なければ GitHub Pages）
 */
const TOOL_URL: string = import.meta.env.DEV ? `${location.origin}/` : (import.meta.env.VITE_TOOL_URL as string | undefined) || DEFAULT_TOOL_URL

/** 開くのを待つ時間（これを過ぎても返事がなければ、開けなかったと知らせる） */
const OPEN_TIMEOUT_MS = 25000
/** 返事があるまで、init を送り直す間隔 */
const RESEND_MS = 500

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

interface Props {
  course: Course
  /** 管理ページの、まだ保存していない変更も入った年度の設定（表紙・抄録を組むため） */
  config: YearConfig
  status: TemplateYearStatus
  onApply: (template: TemplateBlock[], abstractExample: string) => void
  onClose: () => void
  /** 「前の作り方で直す」（開けなかったとき） */
  onFallback: () => void
}

export function TemplateOverlay({ course, config, status, onApply, onClose, onFallback }: Props) {
  const [nonce] = useState(newNonce)
  const { src, origin } = useMemo(() => templateToolUrls(TOOL_URL), [])
  const frame = useRef<HTMLIFrameElement>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading')
  /** ツールで、開いたときから直したか（ツールが知らせる） */
  const [dirty, setDirty] = useState(false)
  /** 受け取ったひな形に問題があった（ふつうはツールが先に確かめるので起きない） */
  const [error, setError] = useState<string | null>(null)
  // 直していれば、タブを閉じる・読み込み直すときに確かめる
  useLeaveGuard(dirty)

  // 渡すもの（開いたときの内容。年度の設定は、このコースだけにする。お知らせなど、紙面に要らないものは渡さない）
  const [payload] = useState<InitPayload>(() => {
    const own: Course = { id: course.id, name: course.name, advisors: course.advisors, subtitleTemplate: course.subtitleTemplate }
    return JSON.parse(
      JSON.stringify({
        courseId: course.id,
        courseName: course.name.trim(),
        template: course.template ?? [],
        abstractExample: course.abstractExample ?? '',
        config: { ...config, courses: [own] },
        status,
      } satisfies InitPayload),
    )
  })

  /** 確認の窓（画面の中に出す：confirm.tsx） */
  const ask = useConfirm()
  const close = useCallback(async () => {
    if (dirty && !(await ask('ひな形を作る画面で直した内容は、反映されずに消えます。閉じますか？', { ok: '消して閉じる', danger: true }))) return
    onClose()
  }, [dirty, onClose, ask])
  // 知らせを受け取る関数からは、いつも新しい関数を呼ぶ
  const latest = useRef({ close, onApply })
  useEffect(() => {
    latest.current = { close, onApply }
  })

  /** ひな形を渡す（その場所のツールにだけ。読み込み中など、ほかの場所のときは届かない） */
  const sendInit = useCallback(() => {
    const message: InitMessage = { source: FROM_ADMIN, type: 'init', nonce, payload }
    frame.current?.contentWindow?.postMessage(message, origin)
  }, [nonce, payload, origin])

  // 返事があるまで送り直す（iframe の読み込みと、ツールが聞き始めるのが前後することがあるため）。長く返事がなければ、開けなかったと知らせる
  useEffect(() => {
    if (phase !== 'loading') return
    const timer = window.setInterval(sendInit, RESEND_MS)
    const giveUp = window.setTimeout(() => setPhase('failed'), OPEN_TIMEOUT_MS)
    return () => {
      clearInterval(timer)
      clearTimeout(giveUp)
    }
  }, [phase, sendInit])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // ツールの場所の、この窓の iframe から来た、合言葉の合う知らせだけ
      if (e.origin !== origin || !frame.current || e.source !== frame.current.contentWindow) return
      const data: unknown = e.data
      if (!isObj(data) || data.source !== FROM_TOOL || data.nonce !== nonce) return
      if (data.type === 'ack') setPhase((p) => (p === 'loading' ? 'ready' : p))
      else if (data.type === 'dirty') setDirty(data.dirty === true)
      else if (data.type === 'cancel') latest.current.close()
      else if (data.type === 'apply') {
        const problems = receivedProblems(data.template, data.abstractExample)
        if (problems.length > 0) {
          setError(`受け取ったひな形を反映できませんでした：${problems[0]}`)
          return
        }
        setDirty(false)
        latest.current.onApply(data.template as TemplateBlock[], (data.abstractExample as string).trim())
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [origin, nonce])

  const dialogRef = useRef<HTMLDivElement>(null)
  useDialogFocus(dialogRef, close)
  const name = courseName(course)
  return (
    <div className="tpl-overlay">
      <div className="tpl-window" role="dialog" aria-modal="true" aria-label={`${name} コースのひな形を作る画面`} ref={dialogRef}>
        <iframe ref={frame} src={src} title={`ひな形を作る画面（${name} コース）`} data-autofocus onLoad={sendInit} />
        {phase !== 'ready' && (
          <div className="tpl-opening" role="status">
            {phase === 'loading' ? (
              <Waiting text="ひな形を作る画面を開いています…" />
            ) : (
              <div className="tpl-failed">
                <b>ひな形を作る画面を開けませんでした</b>
                <span>インターネットにつながっているかを確かめて、もう一度開いてください。</span>
                <span>開けないときは、前の作り方で直せます。</span>
                <div className="row-buttons">
                  <button className="btn" onClick={onClose}>
                    閉じる
                  </button>
                  <button className="btn primary" onClick={onFallback}>
                    前の作り方で直す
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        {error && (
          <div className="tpl-error" role="alert">
            {error}
          </div>
        )}
        <button className="close tpl-close" aria-label="ひな形を作る画面を閉じる" title="閉じる" onClick={close}>
          ×
        </button>
      </div>
    </div>
  )
}
