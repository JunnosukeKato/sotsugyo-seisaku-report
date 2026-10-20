import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../app/icons'
import { useDialogFocus } from '../app/useDialogFocus'
import { DEFAULT_WORD_CHECKS } from '../checker/textRules'
import type { Course, WordCheck, YearConfig } from '../config'
import { LIMITS, tooLong, validateConfig } from '../config/validate'
import { HelpView } from '../help/HelpView'
import { TEACHER_TOPICS } from '../help/helpTopics'
import { ADMIN_GUIDE_URL, TEACHER_GUIDE_URL, TEACHER_HELP_IMAGES } from '../help/links'
import { halfDigits } from '../layout/document'
import { describeChanges, mergeEdits, sameConfig, shortChanges } from './changes'
import { MembersDialog } from './Members'
import { Preview } from './Preview'
import { isMockServer, roleOf, server, type AdminState, type HistoryRow, type TemplateSet, type YearRow } from './server'
import { endsWithCourse, joinSubtitle, splitSubtitle, subtitleExample } from './subtitleText'
import { TemplateEditor } from './TemplateEditor'
import { templateSummary } from './templateText'
import { useFormWidth } from './useFormWidth'
import { useLeaveGuard } from './useLeaveGuard'
import { useReorder } from './useReorder'
import { useDone, useSlow } from './useWait'
import { DoneNote, PageLoading, SlowNote, Waiting } from './Wait'
import { WordsEditor } from './WordsEditor'
import { wordSummary } from './wordsText'
import { deleteConfirmText, deletedMessage, deliveryNote, newYearNotice, publishConfirmText, saveButtonLabel, saveConfirmText, savedMessage, templateFootNote, type NoticeItem } from './yearText'

/**
 * 管理ページ（案2：設定と見本を並べる型）。デザインは mockups/admin-2.html。
 * 毎年変わる設定（共通の題目、コース、指導教員、締切など）を編集し、学生のツールに公開する。
 * コースごとの「下書きのひな形」は、コースのカードの「編集する」から編集する（mockups/v8 案1）。
 * 「書き間違えやすい語」は、ボタンから開く窓で編集する（mockups/v17 案3）。
 * 「先生」として登録された人には、ひな形・お知らせ・書き間違えやすい語だけを編集できる画面（TeacherView）を出す。
 */

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * サーバーを待っている操作。押したボタンに、回る印と「保存しています…」などをすぐ出し、終わるまで押せなくする
 * （ほかのサーバーの操作と、保存・公開などの間は入力欄も）。長く待つと「数秒〜十数秒かかることがあります」を足し、
 * 終わったら「保存しました」などを数秒出す（useWait.ts）。年度の切り替えと「この内容を読み込む」は、読み込んである内容を出すだけなので待たない
 */
type Busy = 'save' | 'publish' | 'create' | 'delete' | 'history'
const WAIT_TEXT: Record<Busy, string> = { save: '保存しています…', publish: '公開しています…', create: '作成しています…', delete: '削除しています…', history: '読み込んでいます…' }
const DONE_TEXT: Record<Busy, string> = { save: '保存しました', publish: '公開しました', create: '作成しました', delete: '削除しました', history: '' }

/** 画面の上の知らせ。items があれば箇条書きにする（text は太字の1行目、detail はその下の文） */
type Notice = { kind: 'ok' | 'ng'; text: string; detail?: string; items?: NoticeItem[] }

/**
 * 画面の上の知らせ（緑・赤の枠）。箇条書きの知らせ（新年度を作ったあとの、前の年度のままの項目）は、
 * 1行に1つ、直す場所を小さな字で添える（mockups/v35-admin ③ 案A）
 */
function MessageBox({ message }: { message: Notice }) {
  if (!message.items?.length) return <div className={`message ${message.kind}`}>{message.text}</div>
  return (
    <div className={`message ${message.kind} list`}>
      <div className="h">{message.text}</div>
      {message.detail && <p>{message.detail}</p>}
      <ul>
        {message.items.map((item, i) => (
          <li key={i}>
            {item.text}
            {item.where && <small>場所：{item.where}</small>}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * 変更履歴の i 番目の記録で、1つ前の記録から何が変わったか（短く。いちばん古い記録は、比べる相手がないので空）。
 * 一覧は新しい順なので、1つ前の記録は i + 1 番目
 */
function historyChanges(history: HistoryRow[], i: number): string {
  return history[i + 1] ? shortChanges(describeChanges(history[i + 1].config, history[i].config)) : ''
}

/** 最後に開いた年度（このブラウザに、年度の数字だけを覚える。次に開いたとき、その年度から） */
const LAST_YEAR_KEY = 'sotsugyo-admin-year'
function lastYear(): number | null {
  try {
    const year = Number(localStorage.getItem(LAST_YEAR_KEY))
    return Number.isInteger(year) && year > 0 ? year : null
  } catch {
    return null
  }
}
function rememberYear(year: number): void {
  try {
    localStorage.setItem(LAST_YEAR_KEY, String(year))
  } catch {
    // 覚えられなくても、次は公開中の年度から開くだけ
  }
}

/** 今日の日付（YYYY-MM-DD。この端末の日付） */
function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 書き間違えやすい語の欄：見出しと、語の数を出すボタン（押すと窓が開く） */
function WordsSection({ words, onOpen }: { words: WordCheck[]; onOpen: () => void }) {
  return (
    <>
      <h2 className="words-head">書き間違えやすい語</h2>
      <p className="hint words-hint">学生のセルフチェックで指摘し、正しい語を示します（直すのは学生自身です）。</p>
      <button className="words-btn" onClick={onOpen}>
        書き間違えやすい語の一覧を編集<span>{wordSummary(words)}</span>
      </button>
    </>
  )
}

/** ソースコードの場所（AGPL-3.0。管理者・先生・登録されていない人のどの画面にも出す） */
function SourceLink() {
  if (!import.meta.env.VITE_SOURCE_URL) return null
  return (
    <p className="source">
      <a href={import.meta.env.VITE_SOURCE_URL} target="_blank" rel="noreferrer">
        このツールのソースコード（AGPL-3.0）
      </a>
    </p>
  )
}

/**
 * 「？ 使い方」のボタン（見出しの横。管理者と先生の画面に出す。mockups/v27 案A）。押すと、右の端に先生用の使い方の欄が出る。
 * 印刷用の手引き（先生用・管理者用の PDF）は、使い方の一覧のいちばん下から開く
 */
function HelpButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button className={`help-open${open ? ' on' : ''}`} aria-pressed={open} onClick={onClick}>
      {Icon.help}使い方
    </button>
  )
}

/**
 * 先生用の使い方の欄（右の端に重ねる）。画面の写真と印刷用の手引きは、学生用ツールといっしょに GitHub Pages で公開している
 * （管理ページは Apps Script に置くので、学生用ツールの URL から読む。src/help/links.ts。開発中だけは、開発サーバーの public/help/ から読む）
 */
function AdminHelp({ onClose, admin = false }: { onClose: () => void; admin?: boolean }) {
  return (
    <HelpView
      topics={TEACHER_TOPICS}
      who={admin ? 'admin' : 'teacher'}
      imageBase={import.meta.env.DEV ? '/help/' : TEACHER_HELP_IMAGES}
      guides={[
        { label: '先生用', href: TEACHER_GUIDE_URL },
        { label: '管理者用', href: ADMIN_GUIDE_URL },
      ]}
      variant="dock"
      onClose={onClose}
    />
  )
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="f">
      <span className="l">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  )
}

function TextInput({ value, onChange, placeholder, type = 'text', max }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; max?: string }) {
  return <input className="in" type={type} value={value} placeholder={placeholder} max={max} onChange={(e) => onChange(e.target.value)} />
}

/**
 * 数の欄。入力の途中は空にできる（消して打ち直すときに「0」が入って「0600」にならないように）。
 * 空のあいだは設定を変えず、欄を離れると設定の値を出し直す
 */
function NumberInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value))
  const [shown, setShown] = useState(value)
  // 年度の切り替え・変更履歴の読み込みなどで値が変わったら、表示を合わせる
  if (value !== shown) {
    setShown(value)
    setText(String(value))
  }
  return (
    <input
      className="in num"
      type="number"
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value.trim() !== '' && Number.isFinite(n)) {
          setShown(n)
          onChange(n)
        }
      }}
      onBlur={() => setText(String(value))}
    />
  )
}

/**
 * 空にできる数の欄（空は「なし」＝ null。作品写真のページ数の上限：空なら上限なし。mockups/v38）。
 * 入力の途中の扱いは NumberInput と同じ
 */
function OptionalNumberInput({ value, onChange, placeholder }: { value: number | null; onChange: (v: number | null) => void; placeholder?: string }) {
  const show = (v: number | null) => (v === null ? '' : String(v))
  const [text, setText] = useState(show(value))
  const [shown, setShown] = useState(value)
  if (value !== shown) {
    setShown(value)
    setText(show(value))
  }
  return (
    <input
      className="in num"
      type="number"
      min={1}
      step={1}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value)
        if (e.target.value.trim() === '') {
          setShown(null)
          onChange(null)
          return
        }
        const n = Number(e.target.value)
        if (Number.isFinite(n)) {
          setShown(n)
          onChange(n)
        }
      }}
      onBlur={() => setText(show(value))}
    />
  )
}

function CourseCard({
  course,
  published,
  onChange,
  grip,
  dragging,
  onRemove,
  onFocus,
  focused,
  onEditTemplate,
}: {
  course: Course
  published: boolean
  onChange: (c: Course) => void
  /** 並べ替えのつまみ（⋮⋮）に付ける属性（useReorder の gripProps） */
  grip: ReturnType<ReturnType<typeof useReorder>['gripProps']>
  /** つかんで動かしているところ */
  dragging: boolean
  onRemove: () => void
  onFocus: () => void
  focused: boolean
  onEditTemplate: () => void
}) {
  // サブタイトルの形式の前後の「―」は、欄の外に固定の印として出す（欄には「―」を除いた部分だけ。保存するときに付け直す）
  const [before, after] = splitSubtitle(course.subtitleTemplate)
  const [advisor, setAdvisor] = useState('')
  const nameWarnId = useId()
  const nameWarn = endsWithCourse(course.name)
  const addAdvisor = () => {
    const name = advisor.trim()
    if (!name) return
    onChange({ ...course, advisors: [...course.advisors, name] })
    setAdvisor('')
  }
  return (
    <div className={`course${focused ? ' on' : ''}${course.hidden ? ' hidden-course' : ''}${dragging ? ' dragging' : ''}`} onFocus={onFocus} onClick={onFocus}>
      <div className="top">
        {/* 並べ替えのつまみ（カードの左上）。つかんで上下に動かす。キーボードでは ↑・↓ */}
        <button className="grip" {...grip}>
          ⋮⋮
        </button>
        {/* 「コース」は欄の外に固定で付ける（名前には付けない。表紙では自動で付く） */}
        <span className="name-box">
          <input className="in name" value={course.name} placeholder="コース名" aria-describedby={nameWarn ? nameWarnId : undefined} onChange={(e) => onChange({ ...course, name: e.target.value })} />
          <span className="suffix">コース</span>
        </span>
        <label className="toggle-label">
          <input type="checkbox" checked={!course.hidden} onChange={(e) => onChange({ ...course, hidden: !e.target.checked })} />
          学生に表示
        </label>
      </div>
      {nameWarn && (
        <div className="name-warn" id={nameWarnId}>
          名前の最後の「コース」は消してください（表紙では自動で付きます）
        </div>
      )}
      <div className="l">サブタイトルの形式</div>
      <div className="template">
        <span className="dash" title="この線は自動で付きます">
          ―
        </span>
        <input className="in" aria-label="学生が入力する部分の前" value={before} onChange={(e) => onChange({ ...course, subtitleTemplate: joinSubtitle(e.target.value, after) })} />
        <span className="slot">学生が入力</span>
        <input className="in" aria-label="学生が入力する部分の後ろ" value={after} onChange={(e) => onChange({ ...course, subtitleTemplate: joinSubtitle(before, e.target.value) })} />
        <span className="dash" title="この線は自動で付きます">
          ―
        </span>
      </div>
      <div className="hint">例：{subtitleExample(course.subtitleTemplate)}</div>
      <div className="l">指導教員（抄録に表示）</div>
      <div className="tags">
        {course.advisors.map((name, i) => (
          <span key={`${name}-${i}`} className="tag">
            {name}
            <button aria-label={`${name}を削除`} onClick={() => onChange({ ...course, advisors: course.advisors.filter((_, j) => j !== i) })}>
              ×
            </button>
          </span>
        ))}
        <input
          className="in tag-input"
          value={advisor}
          placeholder="氏名を入力して Enter"
          onChange={(e) => setAdvisor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              addAdvisor()
            }
          }}
          onBlur={addAdvisor}
        />
      </div>
      <TemplateRow course={course} onEdit={onEditTemplate} />
      <NoticeField course={course} onChange={(notice) => onChange({ ...course, notice })} />
      <div className="course-actions">
        <span className="spacer" />
        {published ? (
          <span className="hint">公開したことのあるコースは、削除せずに「学生に表示」を外してください</span>
        ) : (
          <button className="danger" onClick={onRemove}>
            削除
          </button>
        )}
      </div>
    </div>
  )
}

/** コースのカードの「下書きのひな形」の行 */
function TemplateRow({ course, onEdit }: { course: Course; onEdit: () => void }) {
  return (
    <div className={`tpl-row${course.template?.length ? '' : ' default'}`}>
      <span className="l">下書きのひな形</span>
      <b>{templateSummary(course)}</b>
      <button className="btn sm" onClick={onEdit}>
        編集する
      </button>
    </div>
  )
}

/** コースのカードの「このコースの学生へのお知らせ」（mockups/v21 案A。管理者と先生が書く） */
function NoticeField({ course, onChange }: { course: Course; onChange: (notice: string | undefined) => void }) {
  return (
    <label className="notice-field">
      <span className="l">このコースの学生へのお知らせ（任意）</span>
      {/* 書いてから消したときは「お知らせなし」に戻す（空の文字のまま残すと、保存していない変更があるように見えるため） */}
      <textarea className="in" rows={2} value={course.notice ?? ''} placeholder="例：12月4日（金）の中間発表では、本文の下書きを印刷して持ってきてください" onChange={(e) => onChange(e.target.value || undefined)} />
      <span className="hint">このコースの学生のツールの、セルフチェック欄の上に表示されます。</span>
    </label>
  )
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref, onClose)
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
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

export function AdminApp() {
  const [state, setState] = useState<AdminState | null>(null)
  const [year, setYear] = useState<number | null>(null)
  const [draft, setDraft] = useState<YearConfig | null>(null)
  /** サーバーを待っている操作（なければ null） */
  const [busy, setBusy] = useState<Busy | null>(null)
  /** 長く待っている（「数秒〜十数秒かかることがあります」を出す） */
  const slow = useSlow(busy !== null)
  /** 終わったときの短い知らせ（「保存しました」など。数秒で消える） */
  const [doneText, showDone] = useDone()
  const [message, setMessage] = useState<Notice | null>(null)
  const [focusedCourse, setFocusedCourse] = useState(0)
  const [dialog, setDialog] = useState<'newYear' | 'history' | 'members' | null>(null)
  const [editingTemplate, setEditingTemplate] = useState<number | null>(null)
  const [editingWords, setEditingWords] = useState(false)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [newYear, setNewYear] = useState('')
  /** 「？ 使い方」の欄を開いている */
  const [help, setHelp] = useState(false)
  // コースのカードの並べ替え（つまみをつかんで動かす・キーボードの ↑↓。前の「↑ 上へ」「↓ 下へ」と同じく、保存するまでは画面の中だけ）
  const courseListRef = useRef<HTMLDivElement>(null)
  const courseOrder = useReorder(
    courseListRef,
    draft?.courses.length ?? 0,
    (from, to) => {
      setDraft((d) => {
        if (!d) return d
        const courses = [...d.courses]
        const [c] = courses.splice(from, 1)
        courses.splice(to, 0, c)
        return { ...d, courses }
      })
      setFocusedCourse(to)
    },
    '.course',
  )
  // 左の入力欄の幅（右の見本との境目をつかんで変える）
  const formWidth = useFormWidth()
  // 最初の読み込み（年度の設定の一覧）が長くかかっている
  const loadingSlow = useSlow(!state && !message)

  const row: YearRow | undefined = state?.years.find((y) => y.year === year)
  // 意味の同じ書き方の違い（空のお知らせとお知らせなし など）は、変更とみなさない
  const dirty = !!row && !!draft && !sameConfig(row.config, draft)
  // 最終締切が今日より前かは、終了した年度では確かめない（締切が過ぎているのが当たり前のため）
  const problems = useMemo(() => (draft ? validateConfig(draft, { today: row && row.status !== '終了' ? today() : undefined }) : []), [draft, row])
  const errors = problems.filter((p) => p.severity === 'error')

  const select = useCallback((s: AdminState, y: number) => {
    const target = s.years.find((r) => r.year === y) ?? s.years[0]
    setYear(target?.year ?? null)
    setDraft(target ? clone(target.config) : null)
    setFocusedCourse(0)
    if (target) rememberYear(target.year)
  }, [])

  useEffect(() => {
    server
      .getState()
      .then((s) => {
        setState(s)
        // 前に開いていた年度から（なければ公開中の年度）
        const last = lastYear()
        const start = s.years.find((y) => y.year === last) ?? s.years.find((y) => y.status === '公開中') ?? s.years[0]
        if (start) select(s, start.year)
      })
      .catch((e) => setMessage({ kind: 'ng', text: `読み込めませんでした：${String(e?.message ?? e)}` }))
  }, [select])

  useLeaveGuard(dirty)

  /**
   * 保存・公開が断られたとき：この画面を開いたあとに、別のタブ（またはほかの人）がこの年度を保存していたなら、
   * 最新の内容を読み込み、自分が変えた項目だけを入れ直して画面に出す（保存はしない。確かめてから、もう一度押してもらう）。
   * 同じ項目を両方で変えていたら、入れ直さずに読み込み直しを頼む。保存されていなかった（ほかの理由で断られた）なら null
   */
  const recoverConflict = async (base: YearRow, mine: YearConfig, verb: string, button: string): Promise<Notice | null> => {
    const latest = await server.getState()
    const fresh = latest.years.find((y) => y.year === base.year)
    if (!fresh || fresh.updatedAt === base.updatedAt) return null
    if (sameConfig(fresh.config, mine)) {
      // 自分の内容がもう保存されていた（公開の前の保存だけが済んだなど）：最新の状態にして、元のエラーを出す
      setState(latest)
      select(latest, base.year)
      return null
    }
    const by = String(fresh.updatedBy ?? '').toLowerCase() === String(latest.user ?? '').toLowerCase() ? '別のタブかウィンドウで、この年度の設定が保存されていた' : `ほかの人（${fresh.updatedBy}）が、この年度の設定を保存していた`
    const merged = mergeEdits(base.config, mine, fresh.config)
    if (merged.conflicts.length)
      return { kind: 'ng', text: `${verb}しませんでした。この画面を開いたあとに${by}ためです。同じ項目（${merged.conflicts.join('、')}）がそちらでも変わっているため、自動では入れ直せません。ページを読み込み直してから、もう一度変更してください` }
    const changes = describeChanges(base.config, mine)
    setState(latest)
    setYear(base.year)
    setDraft(merged.config)
    return {
      kind: 'ng',
      text: `${verb}しませんでした。この画面を開いたあとに${by}ためです。その内容を読み込み、${changes.length ? `あなたの変更（${shortChanges(changes, 5)}）を入れ直しました` : '最新の内容にしました'}。確かめてから、もう一度「${button}」を押してください`,
    }
  }

  /**
   * サーバーの操作。done は、できたときの知らせ（文・箇条書きの知らせ、またはサーバーから返った状態で決める文）。
   * recover を渡すと、別のタブ・ほかの人が先に保存していて断られたときに、自分の変更を入れ直す
   */
  const run = async (
    kind: Busy,
    done: string | Omit<Notice, 'kind'> | ((s: AdminState) => string),
    fn: () => Promise<AdminState>,
    options: { nextYear?: number; recover?: { verb: string; button: string } } = {},
  ) => {
    // 押したときの年度と内容（断られたときに、最新の内容と合わせるため）
    const base = row
    const mine = draft
    setBusy(kind)
    setMessage(null)
    try {
      const s = await fn()
      setState(s)
      select(s, options.nextYear ?? year!)
      const notice = typeof done === 'function' ? done(s) : done
      setMessage(typeof notice === 'string' ? { kind: 'ok', text: notice } : { kind: 'ok', ...notice })
      showDone(DONE_TEXT[kind])
    } catch (e) {
      const recovered = base && mine && options.recover ? await recoverConflict(base, mine, options.recover.verb, options.recover.button).catch(() => null) : null
      setMessage(recovered ?? { kind: 'ng', text: `できませんでした：${String((e as Error)?.message ?? e)}` })
    } finally {
      setBusy(null)
    }
  }

  // 最初の読み込み：画面の真ん中に、回る印と「読み込んでいます…」（長くかかるときは「数秒〜十数秒かかることがあります」も）
  if (!state) return message ? <div className="admin-loading">{message.text}</div> : <PageLoading slow={loadingSlow} />
  const role = roleOf(state)
  if (!role)
    return (
      <div className="admin-loading">
        <div>
          このページは、登録された管理者と先生だけが使えます。
          <br />
          ログイン中：{state.user || '（不明）'}
          <SourceLink />
        </div>
      </div>
    )
  if (!draft || !row) return <div className="admin-loading">年度設定がありません。</div>
  if (role === 'teacher')
    return (
      <TeacherView
        state={state}
        row={row}
        draft={draft}
        setDraft={setDraft}
        dirty={dirty}
        busy={busy}
        slow={slow}
        doneText={doneText}
        message={message}
        onMessage={setMessage}
        onSelectYear={(y) => select(state, y)}
        onSave={(templates, words, notices) =>
          // ひな形・お知らせ・書き間違えやすい語を、まとめて1回で保存する（途中で失敗して一部だけ保存されないように）
          // 画面を開いたときの更新日時も送る（そのあとにほかの先生などが保存していたら、その変更を消さないよう保存しない）
          void run('save', savedMessage(row.status, 'teacher'), () => server.saveTeacherEdits(row.year, { templates, notices, ...(words ? { words } : {}) }, row.updatedAt), {
            recover: { verb: '保存', button: saveButtonLabel(row.status) },
          })
        }
      />
    )

  const set = (patch: Partial<YearConfig>) => setDraft({ ...draft, ...patch })
  const setCourse = (i: number, c: Course) => set({ courses: draft.courses.map((x, j) => (j === i ? c : x)) })
  const publishedIds = new Set(state.years.filter((y) => y.status !== '準備中').flatMap((y) => y.config.courses.map((c) => c.id)))
  const isPublished = row.status === '公開中'
  const saveLabel = saveButtonLabel(row.status)

  const save = () => {
    // 公開中の年度と、終了した年度（その年度に書き始めた学生が今も読む）は、エラーがあると学生のツールで使えないので保存しない
    if (row.status !== '準備中' && errors.length)
      return setMessage({ kind: 'ng', text: isPublished ? '公開中の年度は、エラーを直してから保存してください' : '終了した年度も、この年度に書き始めた学生が使っているため、エラーを直してから保存してください' })
    const text = saveConfirmText(row.status, row.year, describeChanges(row.config, draft))
    if (text && !confirm(text)) return
    void run('save', savedMessage(row.status, 'admin'), () => server.saveYear(draft, row.updatedAt), { recover: { verb: '保存', button: saveLabel } })
  }
  const publish = () => {
    if (errors.length) return setMessage({ kind: 'ng', text: 'エラーを直してから公開してください' })
    const current = state.years.find((y) => y.status === '公開中')
    if (!confirm(publishConfirmText(draft, current?.year ?? null, dirty))) return
    // 画面を開いたあとにほかの人が保存していたら、見ていない内容を公開しないよう、公開せずに知らせる
    void run(
      'publish',
      `${draft.fiscalYear}年度を学生に公開しました。まだ書き始めていない学生は、この年度の設定で書き始めます（学生がツールを開き直すと、1分ほどで届きます）`,
      async () => {
        let updatedAt = row.updatedAt
        if (dirty) updatedAt = (await server.saveYear(draft, row.updatedAt)).years.find((y) => y.year === draft.fiscalYear)?.updatedAt ?? updatedAt
        return server.publishYear(draft.fiscalYear, updatedAt)
      },
      { recover: { verb: '公開', button: 'この年度を学生に公開' } },
    )
  }

  /** 変更履歴を読み込んで開く（読み込めなかったら、理由を知らせる） */
  const openHistory = async () => {
    setBusy('history')
    try {
      setHistory(await server.getHistory(row.year))
      setDialog('history')
    } catch (e) {
      setMessage({ kind: 'ng', text: `変更履歴を読み込めませんでした：${String((e as Error)?.message ?? e)}` })
    } finally {
      setBusy(null)
    }
  }

  // 削除できる年度（一度も公開していない「準備中」。サーバーの deleteYear と同じ決まりで、サーバーが deletable を付けて返す）。
  // ほかに年度がないときは出さない（消すと開く年度がなくなり、新年度も作れなくなるため）
  const otherYears = state.years.filter((y) => y.year !== row.year)
  const canDelete = row.deletable === true && otherYears.length > 0
  /** 準備中の年度を削除する（mockups/v35-admin ② 案A）。確かめてから消し、公開中の年度（なければいちばん新しい年度）を開く */
  const removeYear = () => {
    // 年度を切り替えるときと同じく、保存していない変更は確かめる（削除すると、その変更も消えるため）
    if (dirty && !confirm('保存していない変更があります。破棄して、この年度の削除に進みますか？')) return
    const next = otherYears.find((y) => y.status === '公開中') ?? otherYears[0]
    if (!confirm(deleteConfirmText(row.year, next))) return
    void run(
      'delete',
      (s) => deletedMessage(row.year, s.years.find((y) => y.year === next.year) ?? s.years[0]),
      () => server.deleteYear(row.year, row.updatedAt),
      { nextYear: next.year },
    )
  }

  return (
    <div className={help ? 'admin help-on' : 'admin'}>
      {/* 見出しは2段（mockups/v35-admin ① 案A）。上の段は年度と保存・公開（どの広さの画面でも見える）、下の細い段はログイン中の人と、ときどき使うリンク */}
      <header className="admin-header">
        <div className="head-row">
          <b>卒業制作報告書 管理ページ</b>
          <HelpButton open={help} onClick={() => setHelp(!help)} />
          <select
            className="sel"
            value={year ?? ''}
            disabled={!!busy}
            onChange={(e) => {
              if (dirty && !confirm('保存していない変更があります。破棄して年度を切り替えますか？')) return
              select(state, Number(e.target.value))
            }}
          >
            {state.years.map((y) => (
              <option key={y.year} value={y.year}>
                {y.year}年度（{y.status}）
              </option>
            ))}
          </select>
          <span className={`badge ${isPublished ? 'pub' : row.status === '準備中' ? 'draft' : 'old'}`}>{row.status}</span>
          {/* 保存・公開している間は、「保存していない変更があります」の代わりに、ボタンの「保存しています…」を見てもらう */}
          {dirty && busy !== 'save' && busy !== 'publish' && <span className="badge warn">保存していない変更があります</span>}
          <span className="spacer" />
          <DoneNote text={doneText} />
          <button className={`btn${busy === 'save' ? ' busy' : ''}`} disabled={!!busy || !dirty} aria-busy={busy === 'save'} onClick={save}>
            {busy === 'save' ? <Waiting text={WAIT_TEXT.save} /> : saveLabel}
          </button>
          {!isPublished && (
            <button className={`btn primary${busy === 'publish' ? ' busy' : ''}`} disabled={!!busy} aria-busy={busy === 'publish'} onClick={publish}>
              {busy === 'publish' ? <Waiting text={WAIT_TEXT.publish} /> : 'この年度を学生に公開'}
            </button>
          )}
        </div>
        <div className="head-sub">
          <span className="who">ログイン中：</span>
          <span className="user">{state.user}</span>
          {isMockServer && <span className="badge old">試験用サーバー</span>}
          <span className="spacer" />
          <button className={`link${busy === 'history' ? ' busy' : ''}`} disabled={!!busy} aria-busy={busy === 'history'} onClick={() => void openHistory()}>
            {busy === 'history' ? <Waiting text={WAIT_TEXT.history} /> : '変更履歴'}
          </button>
          {canDelete && (
            <button className={`link del${busy === 'delete' ? ' busy' : ''}`} disabled={!!busy} aria-busy={busy === 'delete'} onClick={removeYear}>
              {busy === 'delete' ? <Waiting text={WAIT_TEXT.delete} /> : <>{Icon.remove}この年度を削除</>}
            </button>
          )}
          <span className="sep" />
          <button className="link" disabled={!!busy} onClick={() => setDialog('members')}>
            先生の登録
          </button>
          <span className="sep" />
          <button
            className="link"
            disabled={!!busy}
            onClick={() => {
              // 新年度は保存されている内容からコピーするので、保存していない変更は入らない（年度を切り替えるときと同じく確かめる）
              if (dirty && !confirm('保存していない変更があります。新年度は保存されている内容からコピーして作るため、この変更は入りません。破棄して新年度を作成しますか？')) return
              setNewYear(String(Math.max(...state.years.map((y) => y.year)) + 1))
              setDialog('newYear')
            }}
          >
            新年度を作成
          </button>
          {/* 長く待っているときの1行（保存・公開のボタンのすぐ下。新年度の作成は、窓の中に出す） */}
          <SlowNote show={slow && busy !== 'create'} />
        </div>
      </header>

      <main className="admin-main" style={formWidth.style}>
        {/* 保存・公開・作成・削除の間は、入力欄を触れなくする（終わると、サーバーから返った内容に置き換わり、その間に書いた分が消えるため） */}
        <section className="form" inert={busy !== null && busy !== 'history'} aria-busy={busy !== null && busy !== 'history'}>
          {message && <MessageBox message={message} />}
          {problems.length > 0 && (
            <div className="problems">
              {problems.map((p, i) => (
                <div key={i} className={p.severity}>
                  {p.severity === 'error' ? 'エラー' : '確認'}：{p.message}
                </div>
              ))}
            </div>
          )}

          <h2>毎年設定する項目（{draft.fiscalYear}年度）</h2>
          <Field label="共通の題目" hint="表紙と抄録に表示され、学生は変更できません">
            <TextInput value={draft.commonTitle} onChange={(v) => set({ commonTitle: v })} placeholder="例：卒業イベント「シンドバッド」について" />
          </Field>
          <Field label="最終締切">
            {/* max を付けると、年の欄に5桁以上を打てなくなる（「2028」と打つと月の欄に移る。付けないと「202801」のような年になる） */}
            <TextInput type="date" max="9999-12-31" value={draft.deadline} onChange={(v) => set({ deadline: v })} />
          </Field>
          <Field label="手順書のリンク（任意）" hint="学生のツールの上部に「手順書」ボタンとして表示されます">
            <TextInput value={draft.handbookUrl ?? ''} onChange={(v) => set({ handbookUrl: v })} placeholder="https://drive.google.com/…" />
          </Field>

          <h2>コースと指導教員</h2>
          {/* カードは左上のつまみ（⋮⋮）をつかんで並べ替える。落とす場所に線を出す */}
          <div className="course-list" ref={courseListRef}>
            {draft.courses.map((c, i) => (
              <CourseCard
                key={c.id}
                course={c}
                published={publishedIds.has(c.id)}
                focused={focusedCourse === i}
                onFocus={() => setFocusedCourse(i)}
                onChange={(course) => setCourse(i, course)}
                grip={courseOrder.gripProps(i, c.id)}
                dragging={courseOrder.drag?.from === i}
                onRemove={() => {
                  set({ courses: draft.courses.filter((_, j) => j !== i) })
                  setFocusedCourse(0)
                }}
                onEditTemplate={() => setEditingTemplate(i)}
              />
            ))}
            {courseOrder.drag?.line != null && <div className="drop-line" style={{ top: courseOrder.drag.line }} />}
          </div>
          <div className="sr-only" aria-live="polite">
            {courseOrder.message}
          </div>
          <button
            className="add"
            onClick={() => {
              set({ courses: [...draft.courses, { id: `course-${Date.now().toString(36)}`, name: '', advisors: [], subtitleTemplate: '―{input}の制作―' }] })
              setFocusedCourse(draft.courses.length)
            }}
          >
            ＋ コースを追加
          </button>

          <WordsSection words={draft.wordChecks ?? DEFAULT_WORD_CHECKS} onOpen={() => setEditingWords(true)} />

          <details className="details">
            <summary>詳細設定（手順書の改訂・Google の障害のとき）</summary>
            {/* Google の障害や大学の設定変更で学生がログインできないときだけ止める（mockups/v22 ② 案B） */}
            <div className={`drive-switch${draft.driveSave === 'off' ? ' off' : ''}`}>
              <span className="l">学生のドライブ保存</span>
              <div className="seg2" role="group" aria-label="学生のドライブ保存">
                <button aria-pressed={draft.driveSave !== 'off'} className={draft.driveSave !== 'off' ? 'on' : ''} onClick={() => set({ driveSave: 'required' })}>
                  必須（ふだん）
                </button>
                <button aria-pressed={draft.driveSave === 'off'} className={draft.driveSave === 'off' ? 'on stop' : 'stop'} onClick={() => set({ driveSave: 'off' })}>
                  止める
                </button>
              </div>
              {draft.driveSave === 'off' ? (
                <span className="warn">止めているあいだ、学生はログインせずに書けます（原稿はその端末にだけ保存されます）。Google が使えるようになったら「必須」に戻して保存してください。</span>
              ) : (
                <span className="hint">Google の障害や大学の設定変更で、学生がログインできないときだけ「止める」にして保存します。</span>
              )}
            </div>
            <div className="grid">
              <Field label="報告書の名前">
                <TextInput value={draft.reportName} onChange={(v) => set({ reportName: v })} />
              </Field>
              <Field label="表紙の見出し">
                <TextInput value={draft.cover.heading} onChange={(v) => set({ cover: { ...draft.cover, heading: v } })} />
              </Field>
              <Field label="表紙の題目の見出し">
                <TextInput value={draft.cover.titleLabel} onChange={(v) => set({ cover: { ...draft.cover, titleLabel: v } })} />
              </Field>
              <Field label="抄録の見出し">
                <TextInput value={draft.abstract.heading} onChange={(v) => set({ abstract: { ...draft.abstract, heading: v } })} />
              </Field>
              <Field label="抄録の書き出し例">
                <TextInput value={draft.abstract.openingExample} onChange={(v) => set({ abstract: { ...draft.abstract, openingExample: v } })} />
              </Field>
              <Field label="大学名">
                <TextInput value={draft.university} onChange={(v) => set({ university: v })} />
              </Field>
              <Field label="学部名">
                <TextInput value={draft.faculty} onChange={(v) => set({ faculty: v })} />
              </Field>
              <Field label="学科名">
                <TextInput value={draft.department} onChange={(v) => set({ department: v })} />
              </Field>
              <Field label="抄録の文字数（最少〜最多）">
                <span className="range">
                  <NumberInput value={draft.abstract.minChars} onChange={(v) => set({ abstract: { ...draft.abstract, minChars: v } })} />〜
                  <NumberInput value={draft.abstract.maxChars} onChange={(v) => set({ abstract: { ...draft.abstract, maxChars: v } })} />字
                </span>
              </Field>
              <Field label="抄録の行数（最少〜最多）">
                <span className="range">
                  <NumberInput value={draft.abstract.minLines} onChange={(v) => set({ abstract: { ...draft.abstract, minLines: v } })} />〜
                  <NumberInput value={draft.abstract.maxLines} onChange={(v) => set({ abstract: { ...draft.abstract, maxLines: v } })} />行
                </span>
              </Field>
              <Field label="本文の最低ページ数">
                <NumberInput value={draft.body.minPages} onChange={(v) => set({ body: { ...draft.body, minPages: v } })} />
              </Field>
              <Field label="1ページあたりの画像の目安">
                <NumberInput value={draft.body.imagesPerPageGuide} onChange={(v) => set({ body: { ...draft.body, imagesPerPageGuide: v } })} />
              </Field>
              <Field label="作品写真のページ数の上限" hint="空なら上限なし（1ページに写真4枚まで）">
                <OptionalNumberInput value={draft.workPhotos?.maxPages ?? null} placeholder="上限なし" onChange={(v) => set({ workPhotos: { maxPages: v } })} />
              </Field>
              <Field label="学籍番号の形式（正規表現。空なら確認しない）">
                <TextInput value={draft.studentIdPattern ?? ''} onChange={(v) => set({ studentIdPattern: v.trim() ? v : null })} placeholder="例：^\d{2}FA[A-Z]?\d{3,4}$" />
              </Field>
            </div>
          </details>
          <SourceLink />
        </section>

        <section className="stage">
          <div className="caption">
            <span>見本（入力するとすぐ反映されます）</span>
            <span className="spacer" />
            <span className="legend">
              <i className="y" />
              年度の設定から入る部分　<i className="g" />
              学生が入力する部分
            </span>
          </div>
          <Preview config={draft} courseId={draft.courses[focusedCourse]?.id ?? draft.courses[0]?.id ?? ''} />
        </section>
        {/* 入力欄と見本の境目：つかんで動かすと入力欄の幅が変わる。ダブルクリックで元の幅。選んで ←・→ でも変わる */}
        <div className="form-resize" {...formWidth.handleProps} />
      </main>
      {help && <AdminHelp admin onClose={() => setHelp(false)} />}

      {editingTemplate !== null && draft.courses[editingTemplate] && (
        <TemplateEditor
          course={draft.courses[editingTemplate]}
          config={draft}
          footNote={templateFootNote(row.status)}
          onClose={() => setEditingTemplate(null)}
          onApply={(template, abstractExample) => {
            setCourse(editingTemplate, { ...draft.courses[editingTemplate], template, abstractExample })
            setEditingTemplate(null)
            setMessage({ kind: 'ok', text: `ひな形を反映しました。${deliveryNote(row.status, 'admin')}` })
          }}
        />
      )}

      {editingWords && (
        <WordsEditor
          words={draft.wordChecks ?? DEFAULT_WORD_CHECKS}
          onClose={() => setEditingWords(false)}
          onApply={(wordChecks) => {
            set({ wordChecks })
            setEditingWords(false)
            setMessage({ kind: 'ok', text: `書き間違えやすい語を反映しました。${deliveryNote(row.status, 'admin')}` })
          }}
        />
      )}

      {dialog === 'members' && <MembersDialog me={state.user} studentIdPattern={draft.studentIdPattern} onClose={() => setDialog(null)} />}

      {dialog === 'newYear' && (
        <Modal title="新年度を作成" onClose={() => busy !== 'create' && setDialog(null)}>
          {/* コピーするのは、保存されている設定（保存していない変更は入らない。作成の前に確かめている） */}
          <p className="lead">{row.year}年度の、保存されている設定をコピーして、新しい年度を作ります。作った年度は「準備中」になり、公開するまで学生には見えません。</p>
          <Field label="新しい年度">
            {/* 全角の数字（２０２７）も受け付ける（日本語入力のまま打っても消えないように） */}
            <TextInput value={newYear} onChange={(v) => setNewYear(v.replace(/[^0-9０-９]/g, ''))} />
          </Field>
          <div className="row-buttons">
            <SlowNote show={slow && busy === 'create'} />
            <span className="spacer" />
            <button disabled={busy === 'create'} onClick={() => setDialog(null)}>
              やめる
            </button>
            <button
              className={`primary${busy === 'create' ? ' busy' : ''}`}
              disabled={!/^\d{4}$/.test(halfDigits(newYear)) || !!busy}
              aria-busy={busy === 'create'}
              onClick={() => {
                const n = Number(halfDigits(newYear))
                // 作っている間は窓を開いたまま、ボタンに「作成しています…」を出す。終わったら閉じて、
                // 前の年度のままの項目（題目・締切・お知らせなど）を知らせる（できなかったときも閉じて、理由を知らせる）
                void run('create', newYearNotice(row.config, n), () => server.createYear(row.year, n), { nextYear: n }).finally(() => setDialog(null))
              }}
            >
              {busy === 'create' ? <Waiting text={WAIT_TEXT.create} /> : '作成する'}
            </button>
          </div>
        </Modal>
      )}

      {dialog === 'history' && (
        <Modal title={`変更履歴（${row.year}年度）`} onClose={() => setDialog(null)}>
          {history.length === 0 ? (
            <p className="lead">まだ変更履歴はありません。</p>
          ) : (
            <ul className="history">
              {history.map((h, i) => (
                <li key={i}>
                  <span>
                    {new Date(h.at).toLocaleString('ja-JP')}　{h.action}
                    <small>
                      {h.user}
                      {historyChanges(history, i) && `　変更：${historyChanges(history, i)}`}
                    </small>
                  </span>
                  <button
                    onClick={() => {
                      if (dirty && !confirm('保存していない変更があります。破棄して、この時点の内容を読み込みますか？')) return
                      setDraft(clone(h.config))
                      setDialog(null)
                      setMessage({ kind: 'ok', text: 'この時点の内容を読み込みました。確認して保存すると元に戻ります' })
                    }}
                  >
                    この内容を読み込む
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </div>
  )
}

/**
 * 先生の画面：コースの一覧と「下書きのひな形」「お知らせ」、書き間違えやすい語の編集だけ。
 * 保存はひな形・お知らせ・書き間違えやすい語だけを送る（ほかの設定はサーバー側でも変えられない）
 */
function TeacherView({
  state,
  row,
  draft,
  setDraft,
  dirty,
  busy,
  slow,
  doneText,
  message,
  onMessage,
  onSelectYear,
  onSave,
}: {
  state: AdminState
  row: YearRow
  draft: YearConfig
  setDraft: (c: YearConfig) => void
  dirty: boolean
  /** サーバーを待っている操作（先生の画面では保存だけ） */
  busy: Busy | null
  /** 長く待っている（「数秒〜十数秒かかることがあります」を出す） */
  slow: boolean
  /** 終わったときの短い知らせ（「保存しました」） */
  doneText: string | null
  message: Notice | null
  /** 画面の上の知らせ（ひな形を反映した、など） */
  onMessage: (message: Notice | null) => void
  onSelectYear: (year: number) => void
  /** words は、書き間違えやすい語を変えたときだけ（変えていなければ null） */
  /** notices は、書き換えたコースのお知らせだけ（コースの ID → お知らせ） */
  onSave: (templates: TemplateSet, words: WordCheck[] | null, notices: Record<string, string>) => void
}) {
  const [editing, setEditing] = useState<number | null>(null)
  const [editingWords, setEditingWords] = useState(false)
  /** 「？ 使い方」の欄を開いている */
  const [help, setHelp] = useState(false)
  const isPublished = row.status === '公開中'
  const save = () => {
    const templates: TemplateSet = {}
    draft.courses.forEach((c) => {
      const before = row.config.courses.find((x) => x.id === c.id)
      if (c.template && !same([c.template, c.abstractExample ?? ''], [before?.template, before?.abstractExample ?? ''])) {
        templates[c.id] = { template: c.template, abstractExample: c.abstractExample ?? '' }
      }
    })
    const words = draft.wordChecks && !same(draft.wordChecks, row.config.wordChecks) ? draft.wordChecks : null
    const notices: Record<string, string> = {}
    draft.courses.forEach((c) => {
      const before = row.config.courses.find((x) => x.id === c.id)
      if ((c.notice ?? '') !== (before?.notice ?? '')) notices[c.id] = c.notice ?? ''
    })
    // 長すぎるお知らせは、送る前に知らせる（サーバーでも同じ言葉で断られる）
    const long = draft.courses.find((c) => c.id in notices && notices[c.id].length > LIMITS.notice)
    if (long) return onMessage({ kind: 'ng', text: `「${long.name}」のお知らせ${tooLong(LIMITS.notice, notices[long.id].length)}` })
    // 学生に届く年度（公開中・終了）は、何が変わるかを示して確かめる
    const text = saveConfirmText(row.status, row.year, describeChanges(row.config, draft))
    if (text && !confirm(text)) return
    onSave(templates, words, notices)
  }
  return (
    <div className={help ? 'admin help-on' : 'admin'}>
      {/* 管理者の画面とそろえて2段（mockups/v35-admin ① 案A）。ログイン中の人は下の段 */}
      <header className="admin-header">
        <div className="head-row">
          <b>卒業制作報告書 管理ページ</b>
          <HelpButton open={help} onClick={() => setHelp(!help)} />
          <select
            className="sel"
            value={row.year}
            disabled={!!busy}
            onChange={(e) => {
              if (dirty && !confirm('保存していない変更があります。破棄して年度を切り替えますか？')) return
              onSelectYear(Number(e.target.value))
            }}
          >
            {state.years.map((y) => (
              <option key={y.year} value={y.year}>
                {y.year}年度（{y.status}）
              </option>
            ))}
          </select>
          <span className={`badge ${isPublished ? 'pub' : row.status === '準備中' ? 'draft' : 'old'}`}>{row.status}</span>
          {dirty && busy !== 'save' && <span className="badge warn">保存していない変更があります</span>}
          <span className="spacer" />
          <DoneNote text={doneText} />
          <button className={`btn primary${busy === 'save' ? ' busy' : ''}`} disabled={!!busy || !dirty} aria-busy={busy === 'save'} onClick={save}>
            {busy === 'save' ? <Waiting text={WAIT_TEXT.save} /> : saveButtonLabel(row.status)}
          </button>
        </div>
        <div className="head-sub">
          <span className="who">ログイン中：</span>
          <span className="user">{state.user}（先生）</span>
          {isMockServer && <span className="badge old">試験用サーバー</span>}
          {/* 長く待っているときの1行（保存のボタンのすぐ下） */}
          {slow && <span className="spacer" />}
          <SlowNote show={slow} />
        </div>
      </header>
      {/* 保存している間は、入力欄を触れなくする（終わると、保存した内容に置き換わるため） */}
      <main className="teacher-main" inert={!!busy} aria-busy={!!busy}>
        {message && <MessageBox message={message} />}
        <h2>コースごとの下書きのひな形とお知らせ（{draft.fiscalYear}年度）</h2>
        <p className="hint">学生が最初に見る本文の組み立て（大見出し・小見出し・書くことの説明・図の枠・素材表）と、そのコースの学生へのお知らせを、コースごとに決めます。先生は、どのコースも編集できます。</p>
        {draft.courses
          .map((c, i) => ({ c, i }))
          .filter(({ c }) => !c.hidden)
          .map(({ c, i }) => (
            <div key={c.id} className="course">
              <div className="top">
                <b className="name">{c.name} コース</b>
              </div>
              <div className="hint">指導教員：{c.advisors.join('、') || '（未登録）'}</div>
              <TemplateRow course={c} onEdit={() => setEditing(i)} />
              <NoticeField course={c} onChange={(notice) => setDraft({ ...draft, courses: draft.courses.map((x, j) => (j === i ? { ...x, notice } : x)) })} />
            </div>
          ))}
        <WordsSection words={draft.wordChecks ?? DEFAULT_WORD_CHECKS} onOpen={() => setEditingWords(true)} />
        <SourceLink />
      </main>
      {help && <AdminHelp onClose={() => setHelp(false)} />}
      {editingWords && (
        <WordsEditor
          words={draft.wordChecks ?? DEFAULT_WORD_CHECKS}
          onClose={() => setEditingWords(false)}
          onApply={(wordChecks) => {
            setDraft({ ...draft, wordChecks })
            setEditingWords(false)
            onMessage({ kind: 'ok', text: `書き間違えやすい語を反映しました。${deliveryNote(row.status, 'teacher')}` })
          }}
        />
      )}
      {editing !== null && draft.courses[editing] && (
        <TemplateEditor
          course={draft.courses[editing]}
          config={draft}
          footNote={templateFootNote(row.status)}
          onClose={() => setEditing(null)}
          onApply={(template, abstractExample) => {
            setDraft({ ...draft, courses: draft.courses.map((c, j) => (j === editing ? { ...c, template, abstractExample } : c)) })
            setEditing(null)
            onMessage({ kind: 'ok', text: `ひな形を反映しました。${deliveryNote(row.status, 'teacher')}` })
          }}
        />
      )}
    </div>
  )
}
