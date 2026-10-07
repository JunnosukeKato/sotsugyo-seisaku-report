import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import type { YearConfig } from '../config'
import { findCourse } from '../config'
import type { EditorSnapshot, ReportEditor } from '../editor/reportEditor'
import { FIELD_IDS } from '../layout/document'
import { useDialogFocus } from './useDialogFocus'
import { WordIcon } from './WordImport'

/**
 * はじめて使う学生への案内（mockups/v8 案3「表紙の上で順に案内する」）。
 * 表紙のコース欄に光を当ててコースを選ばせ、選んだコースの下書きを本文に入れる。
 * 続けて、学籍番号・氏名・サブタイトルの欄を順に案内する（どの段階でも「あとで」で閉じられる）。
 * 今年度だけ、コースを選んだあとに「Word で書き始めていますか？」と聞き、「はい」なら Word から読み込む（mockups/v24 ① 案C）。
 */

/** word：今年度だけ、コースを選んだあとに「Word で書き始めていますか？」と聞く（mockups/v24 ① 案C） */
export type GuideStep = 'course' | 'word' | 'studentId' | 'name' | 'subtitle' | 'done'

const FIELD_OF: Partial<Record<GuideStep, string>> = {
  course: FIELD_IDS.course,
  studentId: FIELD_IDS.studentId,
  name: FIELD_IDS.name,
  subtitle: FIELD_IDS.subtitleInput,
}
const NEXT: Record<GuideStep, GuideStep | null> = { course: 'studentId', word: 'studentId', studentId: 'name', name: 'subtitle', subtitle: 'done', done: null }
const STEP_LABELS: [GuideStep, string][] = [
  ['course', 'コース'],
  ['word', 'Word'],
  ['studentId', '学籍番号'],
  ['name', '氏名'],
  ['subtitle', 'サブタイトル'],
]

/** 選ぶまで、ほかの操作をできないようにする段階（コースを選ぶ・Word で書き始めているか） */
const isChoiceStep = (step: GuideStep) => step === 'course' || step === 'word'

/**
 * コースを選ぶ段階（と、Word で書き始めているかを聞く段階）の間だけ、案内を窓として扱う
 * （開くと案内の見出しに移り、Tab で裏のボタンへ行かない。Esc では閉じない）。
 * 段階が変わって外れると、開く前の場所に戻る
 */
function CourseStepFocus({ tip }: { tip: RefObject<HTMLDivElement | null> }) {
  const target = useRef<HTMLDivElement | null>(null)
  // 案内より上に出る窓（「別のタブで開いています」など）がすでに開いていれば、そちらを優先する（案内に移さない・Tab を案内に閉じ込めない）。
  // useDialogFocus より前に書く（同じ部品の useEffect は書いた順に動く。この時点では案内の ref も入っている）
  useEffect(() => {
    target.current = document.querySelector('[aria-modal="true"]:not(.g-tip)') ? null : tip.current
  }, [tip])
  useDialogFocus(target)
  return null
}

/**
 * 見出しにいるときの Shift+Tab：案内の最後のボタンへ（見出しは Tab の順に入らないため、そのままだと裏へ出てしまう）
 */
function wrapToLast(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== 'Tab' || !e.shiftKey) return
  const buttons = e.currentTarget.closest('.g-tip')?.querySelectorAll<HTMLElement>('button:not([disabled])')
  const last = buttons?.[buttons.length - 1]
  if (!last) return
  e.preventDefault()
  last.focus()
}

interface Props {
  editor: ReportEditor
  snap: EditorSnapshot
  config: YearConfig
  /** 学科の設定（コースの一覧など）を読み込めていない */
  configMissing?: boolean
  narrow: boolean
  step: GuideStep
  onStep: (step: GuideStep | null) => void
  onChooseCourse: (courseId: string) => void
  /** 今年度だけ：コースを選んだあとに「Word で書き始めていますか？」と聞く（mockups/v24 ① 案C） */
  wordImport?: boolean
  /** 「はい、Word から読み込む」（ファイルを選ぶ窓を開く） */
  onWordImport?: () => void
  /** 最後の「表紙ができました」で「本文へ進む」「閉じる」を押した（このあと指差し確認を出す。mockups/v27） */
  onFinish?: () => void
}

export function StartGuide({ editor, snap, config, configMissing, narrow, step, onStep, onChooseCourse, wordImport, onWordImport, onFinish }: Props) {
  const field = FIELD_OF[step]
  const [rect, setRect] = useState<DOMRect | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const prevEditing = useRef<string | null>(null)
  const titleId = useId()

  // 案内している欄の位置。PC で入力欄が開いていれば、入力欄に光を当てる（紙面の仮の文字より広いことがある）。
  // 紙面の組み直し・画面の大きさ・キーボード・文字の読み込みなどで位置が変わるため、毎フレーム確かめ、変わったときだけ動かす
  useLayoutEffect(() => {
    let frame = 0
    let last = ''
    const measure = () => {
      let el: HTMLElement | null | undefined = null
      if (field) {
        if (!narrow && editor.getSnapshot().editingId === field) el = document.querySelector<HTMLElement>('.overlay-clip:not([hidden]) .overlay-editor')
        el ??= [...document.querySelectorAll<HTMLElement>(`.page-viewport.front [data-block-id="${CSS.escape(field)}"]`)].find((e) => e.getBoundingClientRect().width > 0)
      }
      const r = el?.getBoundingClientRect()
      const next = r && r.width > 0 ? r : null
      const key = next ? [next.left, next.top, next.width, next.height].map(Math.round).join() : ''
      if (key !== last) {
        last = key
        setRect(next)
      }
      frame = requestAnimationFrame(measure)
    }
    measure()
    return () => cancelAnimationFrame(frame)
  }, [editor, field, narrow])

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

  // 光を当てる欄。Word で書き始めているかを聞く段階は、どの欄も指さない（画面の真ん中に出し、紙面は一様に暗くする。mockups/v24 ① 案C）
  const spot = step === 'word' ? null : rect

  // 案内の吹き出しを、欄のすぐ下に置く（画面からはみ出さないように）
  useLayoutEffect(() => {
    const tip = tipRef.current
    if (!tip || narrow) return
    if (!spot) {
      tip.style.left = `${(window.innerWidth - tip.offsetWidth) / 2}px`
      tip.style.top = `${Math.max(24, (window.innerHeight - tip.offsetHeight) / 2)}px`
      return
    }
    const left = Math.max(12, Math.min(spot.left - 24, window.innerWidth - tip.offsetWidth - 12))
    const below = spot.bottom + 18
    const top = below + tip.offsetHeight > window.innerHeight - 12 ? Math.max(12, spot.top - tip.offsetHeight - 18) : below
    tip.style.left = `${left}px`
    tip.style.top = `${top}px`
    tip.style.setProperty('--arrow-x', `${Math.max(18, Math.min(spot.left - left + 24, tip.offsetWidth - 30))}px`)
    tip.classList.toggle('above', top < spot.top)
  }, [spot, step, narrow])

  const course = findCourse(config, snap.report.basicInfo.courseId)
  const [subtitleBefore, subtitleAfter] = course ? course.subtitleTemplate.split('{input}') : ['', '']
  const pad = 8
  const close = () => onStep(null)
  // 「Word」の段は、今年度だけ出す
  const stepLabels = wordImport ? STEP_LABELS : STEP_LABELS.filter(([s]) => s !== 'word')
  const index = stepLabels.findIndex(([s]) => s === step)
  // コースを選ぶ段階の見出し：開いたときはここに移る（読み上げで、案内の初めから読まれるように）。
  // 最初のコースのボタンに移すと、そのコースを選んでいるように見えてしまうため、見出しにする（見出しの枠は出さない。CSS）
  const courseTitle = { id: titleId, tabIndex: -1, 'data-autofocus': true, onKeyDown: wrapToLast }

  const body = (() => {
    switch (step) {
      case 'course':
        // コースの一覧を読み込めていないときは、選ばせずに読み込み直してもらう（違うコースの下書きで始めないように）
        if (configMissing)
          return (
            <>
              <h2 {...courseTitle}>コースの一覧を読み込めませんでした</h2>
              <p>通信の状態を確かめて、ページを読み込み直してください。</p>
              <div className="g-actions">
                <button className="primary" onClick={() => location.reload()}>
                  読み込み直す
                </button>
              </div>
            </>
          )
        return (
          <>
            <h2 {...courseTitle}>はじめに、コースを選んでください</h2>
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
            {wordImport && (
              <div className="g-word">
                <b>
                  <WordIcon />
                  Word のひな形で書き始めている人へ
                </b>
                まずコースを選んでください。次の画面で、書いた Word を読み込めます（学籍番号・氏名・サブタイトルも写ります）。
              </div>
            )}
          </>
        )
      case 'word':
        return (
          <>
            <h2 {...courseTitle}>Word で書き始めていますか？</h2>
            <p>
              学科が配った Word のひな形（<span className="fn">04_本文.docx</span> など）に書いた分があれば、このツールに写せます。
            </p>
            <div className="g-opts">
              <button className="g-word-opt yes" onClick={onWordImport}>
                <WordIcon />
                <span>
                  はい、Word から読み込む
                  <small>本文の Word と、書いていれば表紙の Word を選びます</small>
                </span>
              </button>
              <button className="g-word-opt no" onClick={() => onStep(snap.report.basicInfo.studentId.trim() ? 'name' : 'studentId')}>
                <span>
                  いいえ、ここから書き始める
                  <small>学籍番号・氏名・サブタイトルを順に案内します</small>
                </span>
              </button>
            </div>
            <span className="g-note">あとからでも、{narrow ? 'メニュー' : '右の欄'}の「Word で書いた分を読み込む」から読み込めます（今年度だけ）。</span>
          </>
        )
      case 'studentId':
        return (
          <>
            <h2 id={titleId}>学籍番号を入力してください</h2>
            <p>{narrow ? '光っている欄をタップして入力し、「完了」を押します。' : '入力したら Enter で次へ進みます。'}</p>
          </>
        )
      case 'name':
        return (
          <>
            <h2 id={titleId}>氏名を入力してください</h2>
            <p>姓と名の間は、全角の空白を入れます（例：文化　花子）。{narrow ? '欄をタップして入力します。' : ''}</p>
          </>
        )
      case 'subtitle':
        return (
          <>
            <h2 id={titleId}>サブタイトルを入力してください</h2>
            <p>
              「{subtitleBefore}〇〇{subtitleAfter}」の〇〇の部分だけを入力します。前後は自動で付きます。
              {narrow ? '欄をタップして入力します。' : ''}
            </p>
          </>
        )
      case 'done':
        return (
          <>
            <h2 id={titleId}>表紙ができました</h2>
            <p>次は本文を書きます（抄録は、本文を書き終えて先生の許可が出てから書きます）。紙面の薄い字は「ここに何を書くか」の説明で、書き始めると消えます（PDFには出ません）。</p>
            <div className="g-actions">
              {/* 表紙の次は抄録・目次のページなので、本文の最初のページへ移る */}
              <button
                className="primary"
                onClick={() => {
                  close()
                  editor.goToArea('body')
                  onFinish?.()
                }}
              >
                本文へ進む
              </button>
              <button
                onClick={() => {
                  close()
                  onFinish?.()
                }}
              >
                閉じる
              </button>
            </div>
          </>
        )
    }
  })()

  // スマホで欄を書いている間は、下から出る書く欄が暗くならないよう、紙面を暗くしない
  const typingOnPhone = narrow && !!field && snap.editingId === field
  return (
    <div className={`guide step-${step}${narrow ? ' narrow' : ''}`}>
      {/* コースを選ぶまで（Word で書き始めているかを答えるまで）は、ほかの操作をできないようにする（指・マウスは g-block、キーボードと読み上げは CourseStepFocus と aria-modal）。
          段階が変わったら、新しい段階の見出しに移す（key） */}
      {isChoiceStep(step) && <div className="g-block" />}
      {isChoiceStep(step) && <CourseStepFocus key={step} tip={tipRef} />}
      {typingOnPhone ? null : spot ? (
        <div className="g-spot" style={{ left: spot.left - pad, top: spot.top - pad, width: spot.width + pad * 2, height: spot.height + pad * 2 }} />
      ) : (
        <div className="g-dim" />
      )}
      {/* 案内の中を押しても入力欄から文字のカーソルが外れないようにする（外れると次の段階へ進み、案内が動いてしまう） */}
      <div
        className="g-tip"
        ref={tipRef}
        role="dialog"
        aria-modal={isChoiceStep(step) ? true : undefined}
        aria-label="はじめての案内"
        aria-describedby={titleId}
        onMouseDown={(e) => e.preventDefault()}
      >
        {step !== 'done' && (
          <div className="g-steps">
            {stepLabels.map(([s, label], i) => (
              <span key={s} className={i === index ? 'on' : i < index ? 'past' : ''}>
                {i + 1} {label}
              </span>
            ))}
          </div>
        )}
        {body}
        {!isChoiceStep(step) && step !== 'done' && (
          <button className="g-later" onClick={close}>
            あとで入力する（案内を閉じる）
          </button>
        )}
      </div>
    </div>
  )
}
