import { useEffect, useMemo, useRef, useState } from 'react'
import type { YearConfig } from '../config'
import { DEFAULT_TOOL_URL, FROM_ADMIN, newNonce } from '../template/protocol'
import { FROM_TRIAL, TRIAL_WINDOW, trialToolUrls, type TrialMessage, type TrialPayload } from '../trial/protocol'
import { AdminIcon } from './adminIcons'
import { server } from './server'
import { SectionHead } from './ui'
import { Waiting } from './Wait'

/**
 * 「学生の画面を試す」の区切り（依頼者の選択 2026-10-22 案1：別のタブで開き、上に「お試し中」の帯）。
 * 「見本の原稿で開く」で、学生のツールを ?trial=1 で別のタブに開き、公開中の年度の設定と見本の原稿を postMessage で渡す
 * （やり取りの決まりは src/trial/protocol.ts）。見本の原稿は、サーバーが登録された先生と管理者にだけ渡す（getTrialSample）。
 * お試しの内容は、開いた先生のブラウザにだけ残る（学生・ほかの先生には見えず、提出・ドライブにも届かない）
 */

/** 学生のツールの場所（TemplateOverlay.tsx と同じ。開発中・自動テスト用にまとめた版は、管理ページと同じ場所） */
const TOOL_URL: string = import.meta.env.DEV || import.meta.env.MODE === 'e2e' ? `${location.origin}/` : (import.meta.env.VITE_TOOL_URL as string | undefined) || DEFAULT_TOOL_URL

/** 開いたタブの返事を待つ時間（これを過ぎても返事がなければ、開けなかったと知らせる） */
const OPEN_TIMEOUT_MS = 30000
/** 返事があるまで、見本を送り直す間隔 */
const RESEND_MS = 500

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

type Phase = 'idle' | 'opening' | 'opened' | 'failed' | 'blocked'

export function TrialSection({ config }: { config: YearConfig }) {
  const { href, origin } = useMemo(() => trialToolUrls(TOOL_URL), [])
  /** サーバーから受け取った見本の原稿（読み込み中は undefined、読めなければ null） */
  const [sample, setSample] = useState<unknown>(undefined)
  const [loadError, setLoadError] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  /** 開いたタブと、開くたびに作る合言葉 */
  const target = useRef<{ win: Window; nonce: string } | null>(null)

  // 区切りを開いたら、見本の原稿を先に読んでおく（押してから待たないように）
  useEffect(() => {
    let live = true
    server.getTrialSample().then(
      (s) => live && setSample(s),
      (e) => {
        if (!live) return
        setSample(null)
        setLoadError(String((e as Error)?.message ?? e))
      },
    )
    return () => {
      live = false
    }
  }, [])

  // 開いたタブに、返事があるまで送り直す（タブの読み込みと、ツールが聞き始めるのが前後するため）。長く返事がなければ、開けなかったと知らせる
  useEffect(() => {
    if (phase !== 'opening' || !sample || !target.current) return
    const { win, nonce } = target.current
    const message: TrialMessage = { source: FROM_ADMIN, type: 'trial', nonce, payload: { config, sample } as TrialPayload }
    const send = () => win.postMessage(message, origin)
    send()
    const timer = window.setInterval(send, RESEND_MS)
    const giveUp = window.setTimeout(() => setPhase('failed'), OPEN_TIMEOUT_MS)
    return () => {
      clearInterval(timer)
      clearTimeout(giveUp)
    }
  }, [phase, sample, config, origin])

  // 返事は、ツールの場所の、開いたタブから来た、合言葉の合うものだけ
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const t = target.current
      if (!t || e.origin !== origin || e.source !== t.win) return
      const data: unknown = e.data
      if (isObj(data) && data.source === FROM_TRIAL && data.type === 'ack' && data.nonce === t.nonce) setPhase((p) => (p === 'opening' ? 'opened' : p))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [origin])

  /** 押したらすぐ開く（ブラウザが、押した直後でない新しいタブを止めるため）。見本は、読めしだい送る */
  const open = () => {
    const win = window.open(href, TRIAL_WINDOW)
    if (!win) {
      setPhase('blocked')
      return
    }
    target.current = { win, nonce: newNonce() }
    setPhase('opening')
  }

  return (
    <div className="trial-sec">
      <SectionHead title="学生の画面を試す" lead="学生と同じ画面を、書き上がった見本の原稿が入った状態で、別のタブに開きます。" />
      <div className="card">
        <ul className="trial-points">
          <li>書く・図や表を入れる・セルフチェック・PDF を作る、などを自由に試せます。</li>
          <li>試した内容は、このパソコンのブラウザにだけ残ります。学生やほかの先生には見えず、提出やドライブにも届きません。</li>
          <li>「見本に戻す」で、いつでも最初の状態に戻せます。</li>
        </ul>
        <div className="trial-open">
          <button className="btn primary" disabled={sample === null} onClick={open}>
            {AdminIcon.open}
            見本の原稿で開く
          </button>
          <span className="trial-state" role="status">
            {sample === null ? (
              <span className="ng">見本の原稿を読み込めませんでした：{loadError}</span>
            ) : phase === 'opening' ? (
              <Waiting text="開いています…" />
            ) : phase === 'opened' ? (
              '別のタブで開きました'
            ) : phase === 'failed' ? (
              <span className="ng">開けませんでした。もう一度押してください</span>
            ) : phase === 'blocked' ? (
              <span className="ng">新しいタブが止められました。ブラウザで、このページのポップアップを許可してから押してください</span>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  )
}
