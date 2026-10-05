import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { YearConfig } from '../config'
import { findCourse } from '../config'
import type { EditorSnapshot, ReportEditor } from '../editor/reportEditor'
import { FIELD_IDS } from '../layout/document'

/**
 * はじめて使う学生への案内（mockups/v8 案3「表紙の上で順に案内する」）。
 * 表紙のコース欄に光を当ててコースを選ばせ、選んだコースの下書きを本文に入れる。
 * 続けて、学籍番号・氏名・サブタイトルの欄を順に案内する（どの段階でも「あとで」で閉じられる）。
 */

export type GuideStep = 'course' | 'studentId' | 'name' | 'subtitle' | 'done'

const FIELD_OF: Partial<Record<GuideStep, string>> = {
  course: FIELD_IDS.course,
  studentId: FIELD_IDS.studentId,
  name: FIELD_IDS.name,
  subtitle: FIELD_IDS.subtitleInput,
}
const NEXT: Record<GuideStep, GuideStep | null> = { course: 'studentId', studentId: 'name', name: 'subtitle', subtitle: 'done', done: null }
const STEP_LABELS: [GuideStep, string][] = [
  ['course', 'コース'],
  ['studentId', '学籍番号'],
  ['name', '氏名'],
  ['subtitle', 'サブタイトル'],
]

interface Props {
  editor: ReportEditor
  snap: EditorSnapshot
  config: YearConfig
  narrow: boolean
  step: GuideStep
  onStep: (step: GuideStep | null) => void
  onChooseCourse: (courseId: string) => void
}

export function StartGuide({ editor, snap, config, narrow, step, onStep, onChooseCourse }: Props) {
  const field = FIELD_OF[step]
  const [rect, setRect] = useState<DOMRect | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const prevEditing = useRef<string | null>(null)

  // 案内している欄の位置（紙面を組み直したり、画面の大きさが変わったりしたら測り直す）
  useLayoutEffect(() => {
    const measure = () => {
      const el = field ? document.querySelector<HTMLElement>(`.page-viewport.front [data-block-id="${field}"]`) : null
      setRect(el && el.getBoundingClientRect().width > 0 ? el.getBoundingClientRect() : null)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [field, snap.version])

  // 表紙を表示する。PC は案内する欄の入力欄を開く（スマホは、タップしたときにキーボードが出るよう、学生にタップしてもらう）
  useEffect(() => {
    if (editor.getSnapshot().page !== 0) void editor.goToPage(0, 'none')
    if (!narrow && field && step !== 'course') editor.openWhenReady(field)
  }, [editor, narrow, field, step])

  // 案内している欄を書き終えたら（入力欄を閉じたら）、次の段階へ
  useEffect(() => {
    const was = prevEditing.current
    prevEditing.current = snap.editingId
    if (field && step !== 'course' && was === field && snap.editingId !== field) onStep(NEXT[step])
  }, [snap.editingId, field, step, onStep])

  // 案内の吹き出しを、欄のすぐ下に置く（画面からはみ出さないように）
  useLayoutEffect(() => {
    const tip = tipRef.current
    if (!tip || narrow) return
    if (!rect) {
      tip.style.left = `${(window.innerWidth - tip.offsetWidth) / 2}px`
      tip.style.top = `${Math.max(24, (window.innerHeight - tip.offsetHeight) / 2)}px`
      return
    }
    const left = Math.max(12, Math.min(rect.left - 24, window.innerWidth - tip.offsetWidth - 12))
    const below = rect.bottom + 18
    const top = below + tip.offsetHeight > window.innerHeight - 12 ? Math.max(12, rect.top - tip.offsetHeight - 18) : below
    tip.style.left = `${left}px`
    tip.style.top = `${top}px`
    tip.style.setProperty('--arrow-x', `${Math.max(18, Math.min(rect.left - left + 24, tip.offsetWidth - 30))}px`)
    tip.classList.toggle('above', top < rect.top)
  }, [rect, step, narrow])

  const course = findCourse(config, snap.report.basicInfo.courseId)
  const [subtitleBefore, subtitleAfter] = course ? course.subtitleTemplate.split('{input}') : ['', '']
  const pad = 8
  const close = () => onStep(null)
  const index = STEP_LABELS.findIndex(([s]) => s === step)

  const body = (() => {
    switch (step) {
      case 'course':
        return (
          <>
            <h2>はじめに、コースを選んでください</h2>
            <p>選んだコースの下書き（章立てと、それぞれに書くことの説明）が本文に入ります。そのあと、表紙の項目を順に案内します。</p>
            <div className="g-opts">
              {config.courses
                .filter((c) => !c.hidden)
                .map((c) => (
                  <button key={c.id} onClick={() => onChooseCourse(c.id)}>
                    {c.name} コース
                  </button>
                ))}
            </div>
            <span className="g-note">コースはあとから変えられます（下書きを入れ替えるときは確認します）</span>
          </>
        )
      case 'studentId':
        return (
          <>
            <h2>学籍番号を入力してください</h2>
            <p>{narrow ? '光っている欄をタップして入力し、「完了」を押します。' : '入力したら Enter で次へ進みます。'}</p>
          </>
        )
      case 'name':
        return (
          <>
            <h2>氏名を入力してください</h2>
            <p>姓と名の間は、全角の空白を入れます（例：文化　花子）。{narrow ? '欄をタップして入力します。' : ''}</p>
          </>
        )
      case 'subtitle':
        return (
          <>
            <h2>サブタイトルを入力してください</h2>
            <p>
              「{subtitleBefore}〇〇{subtitleAfter}」の〇〇の部分だけを入力します。前後は自動で付きます。
              {narrow ? '欄をタップして入力します。' : ''}
            </p>
          </>
        )
      case 'done':
        return (
          <>
            <h2>表紙ができました</h2>
            <p>次のページから、抄録と本文を書きます。紙面の薄い字は「ここに何を書くか」の説明で、書き始めると消えます（PDFには出ません）。</p>
            <div className="g-actions">
              <button className="primary" onClick={() => { close(); editor.nextPage() }}>
                次のページへ
              </button>
              <button onClick={close}>閉じる</button>
            </div>
          </>
        )
    }
  })()

  // スマホで欄を書いている間は、下から出る書く欄が暗くならないよう、紙面を暗くしない
  const typingOnPhone = narrow && !!field && snap.editingId === field
  return (
    <div className={`guide step-${step}${narrow ? ' narrow' : ''}`}>
      {/* コースを選ぶまでは、ほかの操作をできないようにする */}
      {step === 'course' && <div className="g-block" />}
      {typingOnPhone ? null : rect ? (
        <div className="g-spot" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      ) : (
        <div className="g-dim" />
      )}
      <div className="g-tip" ref={tipRef} role="dialog" aria-label="はじめての案内">
        {step !== 'done' && (
          <div className="g-steps">
            {STEP_LABELS.map(([s, label], i) => (
              <span key={s} className={i === index ? 'on' : i < index ? 'past' : ''}>
                {i + 1} {label}
              </span>
            ))}
          </div>
        )}
        {body}
        {step !== 'course' && step !== 'done' && (
          <button className="g-later" onClick={close}>
            あとで入力する（案内を閉じる）
          </button>
        )}
      </div>
    </div>
  )
}
