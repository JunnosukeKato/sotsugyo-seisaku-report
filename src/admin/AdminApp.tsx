import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from '../app/icons'
import { useDialogFocus } from '../app/useDialogFocus'
import { DEFAULT_WORD_CHECKS } from '../checker/textRules'
import type { Course, WordCheck, YearConfig } from '../config'
import { LIMITS, tooLong, validateConfig } from '../config/validate'
import { HelpView } from '../help/HelpView'
import { TEACHER_TOPICS } from '../help/helpTopics'
import { ADMIN_GUIDE_URL, TEACHER_GUIDE_URL, TEACHER_HELP_IMAGES } from '../help/links'
import { halfDigits } from '../layout/document'
import { DEFAULT_TEMPLATE } from '../model/template'
import { AdminIcon } from './adminIcons'
import { courseName, fieldChanged, listChanges, mergeEdits, sameConfig, shortChanges, describeChanges, type Change, type ChangeSection } from './changes'
import { CourseSection } from './CourseSection'
import { DetailsSection } from './DetailsSection'
import { HistorySection } from './HistorySection'
import { MembersSection } from './Members'
import { newYearSteps, type NewYearStep } from './newYearSteps'
import { Preview } from './Preview'
import { isMockServer, roleOf, server, type AdminState, type HistoryRow, type Member, type TemplateSet, type YearRow } from './server'
import { TemplateEditor, TemplatePreview } from './TemplateEditor'
import { useFormWidth } from './useFormWidth'
import { useLeaveGuard } from './useLeaveGuard'
import { useDone, useSlow } from './useWait'
import { DoneNote, PageLoading, SlowNote, Waiting } from './Wait'
import { WordsSection } from './WordsSection'
import { wordSummary } from './wordsText'
import { YearSection } from './YearSection'
import { deleteConfirmText, deletedMessage, deliveryNote, newYearNotice, publishConfirmText, saveButtonLabel, saveConfirmText, savedMessage, templateFootNote, type NoticeItem } from './yearText'

/**
 * 管理ページ（mockups/v43 案B 左の見出し）。左に区切りの一覧（年度の設定・コース・書き方のチェック・先生の登録・変更履歴・詳細設定）、
 * 右には選んだ区切りだけを出す。表紙と抄録の見本は、要る区切り（年度の設定・コース・詳細設定）だけ、いちばん右に出す。
 * 直して保存していない間は、画面の下に帯（変更の数と保存のボタン）を出し、直した欄に「変更あり」を付ける。
 * まだ公開していない（準備中の）年度は、「年度の設定」に新年度の手順（題目 → 締切 → コース → 確かめる → 公開）を出す。
 * 「先生」として登録された人には、コースと書き方のチェックだけの画面（TeacherView）を出す。
 * コースごとの「下書きのひな形」は、コースの「ひな形を直す」から開く窓で編集する（mockups/v8 案1）
 */

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** 画面の上の知らせ。items があれば箇条書きにする（text は太字の1行目、detail はその下の文） */
type Notice = { kind: 'ok' | 'ng'; text: string; detail?: string; items?: NoticeItem[] }

/**
 * サーバーを待っている操作。押したボタンに、回る印と「保存しています…」などをすぐ出し、終わるまで押せなくする
 * （ほかのサーバーの操作と、保存・公開などの間は入力欄も）。長く待つと「数秒〜十数秒かかることがあります」を足し、
 * 終わったら「保存しました」などを数秒出す（useWait.ts）。年度の切り替えと「この内容を読み込む」は、読み込んである内容を出すだけなので待たない
 */
type Busy = 'save' | 'publish' | 'create' | 'delete'
const WAIT_TEXT: Record<Busy, string> = { save: '保存しています…', publish: '公開しています…', create: '作成しています…', delete: '削除しています…' }
const DONE_TEXT: Record<Busy, string> = { save: '保存しました', publish: '公開しました', create: '作成しました', delete: '削除しました' }

/** 左の見出しの区切り */
type Section = 'year' | 'course' | 'words' | 'members' | 'history' | 'details'
const SECTIONS: Section[] = ['year', 'course', 'words', 'members', 'history', 'details']
const TEACHER_SECTIONS: Section[] = ['course', 'words']
/** 表紙と抄録の見本を右に出す区切り（ほかは、区切りを画面の幅いっぱいに出す） */
const WITH_PREVIEW: Section[] = ['year', 'course', 'details']

/** 選んでいる区切り（このタブのあいだだけ覚える。読み込み直しても、同じ区切りから） */
const SECTION_KEY = 'sotsugyo-admin-section'
function loadSection(allowed: Section[]): Section {
  try {
    const s = sessionStorage.getItem(SECTION_KEY) as Section | null
    if (s && allowed.includes(s)) return s
  } catch {
    // 覚えておけなくても、はじめの区切りから
  }
  return allowed[0]
}
function saveSection(s: Section): void {
  try {
    sessionStorage.setItem(SECTION_KEY, s)
  } catch {
    // 覚えておけなくても、いまの区切りのまま
  }
}

/** 区切りごとの変更の数（左の見出しに出す） */
function countBySection(changes: Change[]): Partial<Record<ChangeSection, number>> {
  const out: Partial<Record<ChangeSection, number>> = {}
  for (const c of changes) out[c.section] = (out[c.section] ?? 0) + 1
  return out
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

/** 最後に保存した日（左の見出しの「変更履歴」の下に出す） */
function lastSaved(at: string | undefined): string {
  const t = at ? new Date(at) : null
  return t && !Number.isNaN(t.getTime()) ? `最後：${t.getMonth() + 1}月${t.getDate()}日` : 'まだありません'
}

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

/** 入力の誤り・確かめてほしいこと（区切りのいちばん上） */
function Problems({ problems }: { problems: ReturnType<typeof validateConfig> }) {
  if (!problems.length) return null
  return (
    <div className="problems" tabIndex={-1}>
      {problems.map((p, i) => (
        <div key={i} className={p.severity}>
          {p.severity === 'error' ? 'エラー' : '確認'}：{p.message}
        </div>
      ))}
    </div>
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

function Modal({ title, children, onClose, className = '' }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref, onClose)
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
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

/** 「変更を見る」：まだ保存していない変更の一覧（保存の確認と同じ言葉） */
function ChangesDialog({ changes, onClose }: { changes: string[]; onClose: () => void }) {
  return (
    <Modal title="まだ保存していない変更" onClose={onClose} className="changes-modal">
      <ul className="change-list">
        {changes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="row-buttons">
        <span className="spacer" />
        <button className="btn" onClick={onClose}>
          閉じる
        </button>
      </div>
    </Modal>
  )
}

/**
 * 見出し（1段。mockups/v43 案B）：年度を選ぶ欄と状態の印、右に保存の状態と保存・公開のボタン。
 * 変更がないときは「変更はありません」と、静かな（押せない）保存のボタン。長く待つと「数秒〜十数秒かかることがあります」
 */
function HeaderBar({
  state,
  row,
  teacher,
  help,
  onHelp,
  onSelectYear,
  busy,
  slow,
  doneText,
  changes,
  onSave,
  onPublish,
}: {
  state: AdminState
  row: YearRow
  teacher: boolean
  help: boolean
  onHelp: () => void
  onSelectYear: (year: number) => void
  busy: Busy | null
  slow: boolean
  doneText: string | null
  changes: string[]
  onSave: () => void
  onPublish?: () => void
}) {
  const dirty = changes.length > 0
  const isPublished = row.status === '公開中'
  return (
    <header className="admin-header">
      <b className="title">卒業制作報告書 管理ページ</b>
      <HelpButton open={help} onClick={onHelp} />
      <select className="sel" aria-label="年度" value={row.year} disabled={!!busy} onChange={(e) => onSelectYear(Number(e.target.value))}>
        {state.years.map((y) => (
          <option key={y.year} value={y.year}>
            {y.year}年度（{y.status}）
          </option>
        ))}
      </select>
      <span className={`badge ${isPublished ? 'pub' : row.status === '準備中' ? 'draft' : 'old'}`}>{row.status}</span>
      <span className="spacer" />
      {slow ? <SlowNote show /> : doneText ? <DoneNote text={doneText} /> : <span className={`save-state${dirty ? ' dirty' : ''}`}>{dirty ? `保存していない変更 ${changes.length}か所` : '変更はありません'}</span>}
      <button
        className={`btn ${dirty ? (isPublished || teacher || !onPublish ? 'primary' : '') : 'quiet'}${busy === 'save' ? ' busy' : ''}`}
        disabled={!!busy || !dirty}
        aria-busy={busy === 'save'}
        onClick={onSave}
      >
        {busy === 'save' ? <Waiting text={WAIT_TEXT.save} /> : saveButtonLabel(row.status)}
      </button>
      {!isPublished && onPublish && (
        <button id="publish-btn" className={`btn primary${busy === 'publish' ? ' busy' : ''}`} disabled={!!busy} aria-busy={busy === 'publish'} onClick={onPublish}>
          {busy === 'publish' ? <Waiting text={WAIT_TEXT.publish} /> : 'この年度を学生に公開'}
        </button>
      )}
    </header>
  )
}

interface NavItem {
  key: Section
  icon: ReactNode
  title: string
  sub: ReactNode
  /** 保存していない変更の数 */
  count?: number
  /** この前に区切りの線を引く */
  sep?: boolean
}

/** 左の見出し（ボタンの一覧。選んでいる区切りに aria-current）。下に、ログイン中の人 */
function SideNav({ items, active, onSelect, user, teacher }: { items: NavItem[]; active: Section; onSelect: (s: Section) => void; user: string; teacher: boolean }) {
  return (
    <nav className="side-nav" aria-label="管理ページの区切り">
      <ul>
        {items.map((it) => (
          <li key={it.key} className={it.sep ? 'sep' : ''}>
            <button className={active === it.key ? 'on' : ''} aria-current={active === it.key ? 'page' : undefined} onClick={() => onSelect(it.key)}>
              {it.icon}
              <span className="nt">
                <b>
                  {it.title}
                  {!!it.count && (
                    <em className="cnt" title="保存していない変更の数">
                      <span className="sr-only">保存していない変更</span>
                      {it.count}
                    </em>
                  )}
                </b>
                <small>{it.sub}</small>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="me">
        <span>ログイン中</span>
        {/* 長いアドレスは「@」の前で折り返す（途中の字で切らない） */}
        <span className="user">
          {user.includes('@') ? (
            <>
              {user.slice(0, user.indexOf('@'))}
              <wbr />
              {user.slice(user.indexOf('@'))}
            </>
          ) : (
            user
          )}
        </span>
        {teacher && <span>（先生）</span>}
        {isMockServer && <span className="badge old">試験用サーバー</span>}
        <SourceLink />
      </div>
    </nav>
  )
}

/** 保存していない変更があるあいだ、画面の下にずっと出る帯（変更の数・一覧の短い文・「変更を見る」・保存のボタン） */
function DirtyBar({ changes, row, teacher, busy, onSave, onShow }: { changes: string[]; row: YearRow; teacher: boolean; busy: Busy | null; onSave: () => void; onShow: () => void }) {
  const n = changes.length
  const reach = row.status !== '準備中'
  const head = reach ? `まだ学生に届いていない変更が${n}か所あります` : `保存していない変更が${n}か所あります`
  const tail = reach ? '' : `学生に届くのは、${teacher ? '管理者がこの年度を公開して' : 'この年度を公開して'}からです。`
  return (
    <div className="dirty-bar" role="region" aria-label="保存していない変更">
      <span className="mk" aria-hidden="true">
        {n}
      </span>
      <div className="tx">
        <b>{head}</b>
        <span>
          {shortChanges(changes, 3)}
          {tail && `　${tail}`}
        </span>
      </div>
      <button className="btn big soft" onClick={onShow}>
        変更を見る
      </button>
      <button className={`btn big primary${busy === 'save' ? ' busy' : ''}`} disabled={!!busy} aria-busy={busy === 'save'} onClick={onSave}>
        {busy === 'save' ? <Waiting text={WAIT_TEXT.save} /> : saveButtonLabel(row.status)}
      </button>
    </div>
  )
}

/**
 * 区切りの中身と見本を並べる所。見本のある区切りは、中身と見本の境目をつかんで中身の幅を変えられる（useFormWidth.ts）。
 * 保存などでサーバーを待つ間は、中身を触れなくする（終わると、サーバーから返った内容に置き換わり、その間に書いた分が消えるため）
 */
function Work({ content, stage, locked, formWidth }: { content: ReactNode; stage: ReactNode | null; locked: boolean; formWidth: ReturnType<typeof useFormWidth> }) {
  return (
    <div className={`work${stage ? '' : ' wide'}`} style={stage ? formWidth.style : undefined}>
      <section className="content" inert={locked} aria-busy={locked}>
        {content}
      </section>
      {stage && (
        <>
          <section className="stage" tabIndex={-1}>
            {stage}
          </section>
          {/* 中身と見本の境目：つかんで動かすと中身の幅が変わる。ダブルクリックで元の幅。選んで ←・→ でも変わる */}
          <div className="form-resize" {...formWidth.handleProps} />
        </>
      )}
    </div>
  )
}

/** 表紙と抄録の見本（見出しの行と、見本の絵） */
function CoverStage({ config, course }: { config: YearConfig; course: Course | undefined }) {
  return (
    <>
      <div className="caption">
        <b>見本</b>
        <span>表紙と抄録（{course ? `${courseName(course)} コース` : 'コースなし'}）</span>
        <span className="spacer" />
        <span className="legend">
          <span>
            <i className="y" />
            年度の設定から入る所
          </span>
          <span>
            <i className="g" />
            学生が書く所
          </span>
        </span>
      </div>
      <Preview config={config} courseId={course?.id ?? ''} />
    </>
  )
}

/** 区切りを移ったあと・手順を押したあとに、その欄へ移る（描き終えてから。見えるところまで動かす） */
function useFocusLater(): (selector: string) => void {
  const pending = useRef<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const sel = pending.current
    if (!sel) return
    pending.current = null
    const el = document.querySelector<HTMLElement>(sel)
    el?.scrollIntoView({ block: 'center' })
    el?.focus()
  }, [tick])
  return useCallback((selector: string) => {
    pending.current = selector
    setTick((t) => t + 1)
  }, [])
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
  const [section, setSectionState] = useState<Section>(() => loadSection(SECTIONS))
  /** 区切りの中で、まだ反映していない入力（ほかの区切りに移る前に確かめる言葉。なければ null） */
  const pending = useRef<string | null>(null)
  const setPending = useCallback((m: string | null) => {
    pending.current = m
  }, [])
  /** ほかの区切り・年度に移ってよいか（まだ反映していない入力があれば確かめる） */
  const confirmLeave = useCallback(() => {
    if (pending.current && !confirm(pending.current)) return false
    pending.current = null
    return true
  }, [])
  /** 開いているコース（undefined：まだ選んでいない＝いちばん上のコースを開く。null：どれも閉じている） */
  const [openCourse, setOpenCourse] = useState<string | null | undefined>(undefined)
  /** 見本に出すコース（なければ、開いているコースか、いちばん上のコース） */
  const [previewCourse, setPreviewCourse] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'newYear' | 'changes' | null>(null)
  const [editingTemplate, setEditingTemplate] = useState<number | null>(null)
  const [newYear, setNewYear] = useState('')
  /** 「？ 使い方」の欄を開いている */
  const [help, setHelp] = useState(false)
  /** 先生の登録（左の見出しに人数を出すため、はじめに読む） */
  const [members, setMembers] = useState<Member[] | null>(null)
  const [membersError, setMembersError] = useState('')
  /** 変更履歴（「変更履歴」の区切りを開いたときに読む。key：読んだ年度と、その年度を最後に保存した日時。rows：読めなかったら null） */
  const [historyData, setHistoryData] = useState<{ key: string; rows: HistoryRow[] | null } | null>(null)
  // 中身の幅（中身と見本の境目をつかんで変える）
  const formWidth = useFormWidth()
  // 最初の読み込み（年度の設定の一覧）が長くかかっている
  const loadingSlow = useSlow(!state && !message)
  const focusLater = useFocusLater()

  const row: YearRow | undefined = state?.years.find((y) => y.year === year)
  const changes = useMemo(() => (row && draft ? listChanges(row.config, draft) : []), [row, draft])
  const labels = changes.map((c) => c.label)
  // 意味の同じ書き方の違い（空のお知らせとお知らせなし など）は、変更とみなさない
  const dirty = !!row && !!draft && !sameConfig(row.config, draft)
  // 最終締切が今日より前かは、終了した年度では確かめない（締切が過ぎているのが当たり前のため）
  const problems = useMemo(() => (draft ? validateConfig(draft, { today: row && row.status !== '終了' ? today() : undefined }) : []), [draft, row])
  const errors = problems.filter((p) => p.severity === 'error')

  const select = useCallback((s: AdminState, y: number) => {
    const target = s.years.find((r) => r.year === y) ?? s.years[0]
    setYear(target?.year ?? null)
    setDraft(target ? clone(target.config) : null)
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
        // 管理者なら、先生の登録の人数を読む（左の見出しに出す）
        if (roleOf(s) === 'admin') server.getMembers().then(setMembers, (e) => setMembersError(`先生の登録を読み込めませんでした：${String(e?.message ?? e)}`))
      })
      .catch((e) => setMessage({ kind: 'ng', text: `読み込めませんでした：${String(e?.message ?? e)}` }))
  }, [select])

  // 「変更履歴」の区切りを開いたら（年度を変えた・保存したときも）、その年度の記録を読む
  const historyKey = section === 'history' && row ? `${row.year}:${row.updatedAt}` : null
  const historyLoading = !!historyKey && historyData?.key !== historyKey
  const historySlow = useSlow(historyLoading)
  useEffect(() => {
    if (!historyKey) return
    let live = true
    server.getHistory(Number(historyKey.split(':')[0])).then(
      (rows) => live && setHistoryData({ key: historyKey, rows }),
      (e) => {
        if (!live) return
        setHistoryData({ key: historyKey, rows: null })
        setMessage({ kind: 'ng', text: `変更履歴を読み込めませんでした：${String(e?.message ?? e)}` })
      },
    )
    return () => {
      live = false
    }
  }, [historyKey])

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
    const changed = describeChanges(base.config, mine)
    setState(latest)
    setYear(base.year)
    setDraft(merged.config)
    return {
      kind: 'ng',
      text: `${verb}しませんでした。この画面を開いたあとに${by}ためです。その内容を読み込み、${changed.length ? `あなたの変更（${shortChanges(changed, 5)}）を入れ直しました` : '最新の内容にしました'}。確かめてから、もう一度「${button}」を押してください`,
    }
  }

  /**
   * サーバーの操作。done は、できたときの知らせ（文・箇条書きの知らせ、またはサーバーから返った状態で決める文）。
   * recover を渡すと、別のタブ・ほかの人が先に保存していて断られたときに、自分の変更を入れ直す。できたら true を返す
   */
  const run = async (
    kind: Busy,
    done: string | Omit<Notice, 'kind'> | ((s: AdminState) => string),
    fn: () => Promise<AdminState>,
    options: { nextYear?: number; recover?: { verb: string; button: string } } = {},
  ): Promise<boolean> => {
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
      return true
    } catch (e) {
      const recovered = base && mine && options.recover ? await recoverConflict(base, mine, options.recover.verb, options.recover.button).catch(() => null) : null
      setMessage(recovered ?? { kind: 'ng', text: `できませんでした：${String((e as Error)?.message ?? e)}` })
      return false
    } finally {
      setBusy(null)
    }
  }

  /** 左の見出しの区切りを選ぶ（区切りの中で、まだ反映していない入力があれば確かめる） */
  const go = (s: Section) => {
    if (s === section) return true
    if (!confirmLeave()) return false
    setSectionState(s)
    saveSection(s)
    return true
  }
  /** 年度を切り替える（保存していない変更・まだ反映していない入力があれば確かめる） */
  const switchYear = (s: AdminState, y: number) => {
    if (dirty && !confirm('保存していない変更があります。破棄して年度を切り替えますか？')) return
    if (!confirmLeave()) return
    select(s, y)
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
        changes={changes}
        busy={busy}
        slow={slow}
        doneText={doneText}
        message={message}
        onMessage={setMessage}
        onSelectYear={(y) => switchYear(state, y)}
        confirmLeave={confirmLeave}
        onPending={setPending}
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
  const changed = (path: string) => fieldChanged(row.config, draft, path)
  const counts = countBySection(changes)
  const openId = openCourse === undefined ? (draft.courses[0]?.id ?? null) : openCourse
  const shownCourse = draft.courses.find((c) => c.id === (previewCourse ?? openId)) ?? draft.courses[0]

  const save = () => {
    // 公開中の年度と、終了した年度（その年度に書き始めた学生が今も読む）は、エラーがあると学生のツールで使えないので保存しない
    if (row.status !== '準備中' && errors.length)
      return setMessage({ kind: 'ng', text: isPublished ? '公開中の年度は、エラーを直してから保存してください' : '終了した年度も、この年度に書き始めた学生が使っているため、エラーを直してから保存してください' })
    const text = saveConfirmText(row.status, row.year, labels)
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
  const nextYearNumber = Math.max(...state.years.map((y) => y.year)) + 1
  const openNewYear = () => {
    // 新年度は保存されている内容からコピーするので、保存していない変更は入らない（年度を切り替えるときと同じく確かめる）
    if (dirty && !confirm('保存していない変更があります。新年度は保存されている内容からコピーして作るため、この変更は入りません。破棄して新年度を作成しますか？')) return
    setNewYear(String(nextYearNumber))
    setDialog('newYear')
  }

  // 新年度の手順（準備中の年度だけ）。比べるのは、前の年度（なければ公開中の年度）
  const prevRow = state.years.find((y) => y.year === row.year - 1) ?? state.years.find((y) => y.status === '公開中' && y.year !== row.year)
  const steps = row.status === '準備中' ? newYearSteps(draft, prevRow?.config, problems) : null
  /** 手順を押した：直す所へ移る */
  const onStep = (step: NewYearStep) => {
    if (step.key === 'title' || step.key === 'deadline') {
      if (go('year')) focusLater(step.key === 'title' ? '#y-commonTitle' : '#y-deadline')
    } else if (step.key === 'course') {
      if (!go('course')) return
      const id = step.courseId ?? draft.courses[0]?.id
      if (!id) return focusLater('.content .add')
      setOpenCourse(id)
      setPreviewCourse(id)
      focusLater(step.text.startsWith('指導教員') ? `#c-${id}-advisor` : step.text.startsWith('抄録') ? `[data-course-id="${id}"] .tpl-line button` : `#c-${id}-notice`)
    } else if (step.key === 'check') {
      if (go('year')) focusLater(problems.length ? '.content .problems' : '.stage')
    } else focusLater('#publish-btn')
  }

  const navItems: NavItem[] = [
    { key: 'year', icon: AdminIcon.calendar, title: '年度の設定', sub: '題目・締切・新年度', count: counts.year },
    { key: 'course', icon: AdminIcon.course, title: 'コース', sub: 'お知らせ・ひな形', count: counts.course },
    { key: 'words', icon: AdminIcon.words, title: '書き方のチェック', sub: wordSummary(draft.wordChecks ?? DEFAULT_WORD_CHECKS), count: counts.words },
    { key: 'members', icon: AdminIcon.people, title: '先生の登録', sub: members ? `${members.length}人` : membersError ? '読み込めません' : '読み込んでいます…', sep: true },
    { key: 'history', icon: AdminIcon.history, title: '変更履歴', sub: lastSaved(row.updatedAt) },
    { key: 'details', icon: AdminIcon.gear, title: '詳細設定', sub: 'ふだんは変えません', count: (counts.details ?? 0) + (counts.other ?? 0) },
  ]

  // 知らせと入力の誤りは、区切りの見出しのすぐ下に（準備中の年度は、新年度の手順の下に）
  const notices = (
    <>
      {message && <MessageBox message={message} />}
      {['year', 'course', 'words', 'details'].includes(section) && <Problems problems={problems} />}
    </>
  )
  let content: ReactNode
  if (section === 'year')
    content = (
      <YearSection
        draft={draft}
        set={set}
        changed={changed}
        steps={steps}
        onStep={onStep}
        nextYear={nextYearNumber}
        onNewYear={openNewYear}
        canDelete={canDelete}
        onDelete={removeYear}
        deleting={busy === 'delete'}
        disabled={!!busy}
        notices={notices}
      />
    )
  else if (section === 'course')
    content = (
      <CourseSection
        draft={draft}
        base={row.config}
        openId={openId}
        onOpen={(id) => {
          setOpenCourse(id)
          if (id) setPreviewCourse(id)
        }}
        onFocusCourse={setPreviewCourse}
        setCourse={setCourse}
        onMove={(from, to) =>
          setDraft((d) => {
            if (!d) return d
            const courses = [...d.courses]
            const [c] = courses.splice(from, 1)
            courses.splice(to, 0, c)
            return { ...d, courses }
          })
        }
        onAdd={() => {
          const id = `course-${Date.now().toString(36)}`
          set({ courses: [...draft.courses, { id, name: '', advisors: [], subtitleTemplate: '―{input}の制作―' }] })
          setOpenCourse(id)
          setPreviewCourse(id)
          focusLater(`#c-${id}-name`)
        }}
        onRemove={(i) => {
          const id = draft.courses[i]?.id
          set({ courses: draft.courses.filter((_, j) => j !== i) })
          if (openId === id) setOpenCourse(null)
          if (previewCourse === id) setPreviewCourse(null)
        }}
        publishedIds={publishedIds}
        onEditTemplate={setEditingTemplate}
        notices={notices}
      />
    )
  else if (section === 'words') content = <WordsSection key={row.year} words={draft.wordChecks ?? DEFAULT_WORD_CHECKS} onChange={(wordChecks) => set({ wordChecks })} onPending={setPending} notices={notices} />
  else if (section === 'members') content = <MembersSection me={state.user} studentIdPattern={draft.studentIdPattern} members={members} loadError={membersError} onMembers={setMembers} onPending={setPending} notices={notices} />
  else if (section === 'history')
    content = (
      <HistorySection
        year={row.year}
        history={historyData?.rows ?? null}
        loading={historyLoading}
        slow={historySlow}
        notices={notices}
        onRestore={(h) => {
          if (dirty && !confirm('保存していない変更があります。破棄して、この時点の内容を読み込みますか？')) return
          setDraft(clone(h.config))
          setMessage({ kind: 'ok', text: 'この時点の内容を読み込みました。確認して保存すると元に戻ります' })
        }}
      />
    )
  else content = <DetailsSection draft={draft} set={set} changed={changed} notices={notices} />

  return (
    <div className={`admin${help ? ' help-on' : ''}${dirty ? ' has-bar' : ''}`}>
      <HeaderBar
        state={state}
        row={row}
        teacher={false}
        help={help}
        onHelp={() => setHelp(!help)}
        onSelectYear={(y) => switchYear(state, y)}
        busy={busy}
        slow={slow && busy !== 'create'}
        doneText={doneText}
        changes={labels}
        onSave={save}
        onPublish={publish}
      />
      <main className="admin-main">
        <SideNav items={navItems} active={section} onSelect={go} user={state.user} teacher={false} />
        <Work
          formWidth={formWidth}
          locked={busy !== null}
          content={content}
          stage={WITH_PREVIEW.includes(section) ? <CoverStage config={draft} course={shownCourse} /> : null}
        />
      </main>
      {dirty && <DirtyBar changes={labels} row={row} teacher={false} busy={busy} onSave={save} onShow={() => setDialog('changes')} />}
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

      {dialog === 'changes' && <ChangesDialog changes={labels} onClose={() => setDialog(null)} />}

      {dialog === 'newYear' && (
        <Modal title="新年度を作成" onClose={() => busy !== 'create' && setDialog(null)}>
          {/* コピーするのは、保存されている設定（保存していない変更は入らない。作成の前に確かめている） */}
          <p className="lead">{row.year}年度の、保存されている設定をコピーして、新しい年度を作ります。作った年度は「準備中」になり、公開するまで学生には見えません。</p>
          <label className="f">
            <span className="l">新しい年度</span>
            {/* 全角の数字（２０２７）も受け付ける（日本語入力のまま打っても消えないように） */}
            <input className="in" value={newYear} onChange={(e) => setNewYear(e.target.value.replace(/[^0-9０-９]/g, ''))} />
          </label>
          <div className="row-buttons">
            <SlowNote show={slow && busy === 'create'} />
            <span className="spacer" />
            <button className="btn" disabled={busy === 'create'} onClick={() => setDialog(null)}>
              やめる
            </button>
            <button
              className={`btn primary${busy === 'create' ? ' busy' : ''}`}
              disabled={!/^\d{4}$/.test(halfDigits(newYear)) || !!busy}
              aria-busy={busy === 'create'}
              onClick={() => {
                const n = Number(halfDigits(newYear))
                // 作っている間は窓を開いたまま、ボタンに「作成しています…」を出す。終わったら閉じて、
                // 前の年度のままの項目（題目・締切・お知らせなど）を知らせ、「年度の設定」（新年度の手順）を開く（できなかったときも閉じて、理由を知らせる）
                void run('create', newYearNotice(row.config, n), () => server.createYear(row.year, n), { nextYear: n }).then((ok) => {
                  setDialog(null)
                  if (ok) go('year')
                })
              }}
            >
              {busy === 'create' ? <Waiting text={WAIT_TEXT.create} /> : '作成する'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

/**
 * 先生の画面（mockups/v43 案B の先生の画面）：左の見出しは「コース」と「書き方のチェック」の2つだけ。
 * コースでは、お知らせとひな形を直す（右に、学生が最初に見る本文の組み立て）。
 * 保存はひな形・お知らせ・書き間違えやすい語だけを送る（ほかの設定はサーバー側でも変えられない）
 */
function TeacherView({
  state,
  row,
  draft,
  setDraft,
  changes,
  busy,
  slow,
  doneText,
  message,
  onMessage,
  onSelectYear,
  confirmLeave,
  onPending,
  onSave,
}: {
  state: AdminState
  row: YearRow
  draft: YearConfig
  setDraft: (c: YearConfig) => void
  changes: Change[]
  busy: Busy | null
  slow: boolean
  doneText: string | null
  message: Notice | null
  /** 画面の上の知らせ（ひな形を反映した、など） */
  onMessage: (message: Notice | null) => void
  onSelectYear: (year: number) => void
  /** ほかの区切りに移ってよいか（まだ反映していない入力があれば確かめる） */
  confirmLeave: () => boolean
  onPending: (message: string | null) => void
  /** words は、書き間違えやすい語を変えたときだけ（変えていなければ null） */
  /** notices は、書き換えたコースのお知らせだけ（コースの ID → お知らせ） */
  onSave: (templates: TemplateSet, words: WordCheck[] | null, notices: Record<string, string>) => void
}) {
  const [section, setSectionState] = useState<Section>(() => loadSection(TEACHER_SECTIONS))
  const [editing, setEditing] = useState<number | null>(null)
  const [openCourse, setOpenCourse] = useState<string | null | undefined>(undefined)
  const [previewCourse, setPreviewCourse] = useState<string | null>(null)
  const [showChanges, setShowChanges] = useState(false)
  /** 「？ 使い方」の欄を開いている */
  const [help, setHelp] = useState(false)
  const formWidth = useFormWidth()
  const labels = changes.map((c) => c.label)
  const dirty = changes.length > 0
  const counts = countBySection(changes)
  const shown = draft.courses.filter((c) => !c.hidden)
  const openId = openCourse === undefined ? (shown[0]?.id ?? null) : openCourse
  const shownCourse = shown.find((c) => c.id === (previewCourse ?? openId)) ?? shown[0]

  const go = (s: Section) => {
    if (s === section) return
    if (!confirmLeave()) return
    setSectionState(s)
    saveSection(s)
  }
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
    const text = saveConfirmText(row.status, row.year, labels)
    if (text && !confirm(text)) return
    onSave(templates, words, notices)
  }
  const navItems: NavItem[] = [
    { key: 'course', icon: AdminIcon.course, title: 'コース', sub: 'お知らせ・ひな形', count: counts.course },
    { key: 'words', icon: AdminIcon.words, title: '書き方のチェック', sub: wordSummary(draft.wordChecks ?? DEFAULT_WORD_CHECKS), count: counts.words },
  ]
  const editingCourse = editing !== null ? draft.courses[editing] : undefined
  return (
    <div className={`admin${help ? ' help-on' : ''}${dirty ? ' has-bar' : ''}`}>
      <HeaderBar
        state={state}
        row={row}
        teacher
        help={help}
        onHelp={() => setHelp(!help)}
        onSelectYear={onSelectYear}
        busy={busy}
        slow={slow}
        doneText={doneText}
        changes={labels}
        onSave={save}
      />
      <main className="admin-main">
        <SideNav items={navItems} active={section} onSelect={go} user={state.user} teacher />
        <Work
          formWidth={formWidth}
          locked={busy !== null}
          content={
            section === 'course' ? (
                <CourseSection
                  draft={draft}
                  base={row.config}
                  teacher
                  openId={openId}
                  onOpen={(id) => {
                    setOpenCourse(id)
                    if (id) setPreviewCourse(id)
                  }}
                  onFocusCourse={setPreviewCourse}
                  setCourse={(i, c) => setDraft({ ...draft, courses: draft.courses.map((x, j) => (j === i ? c : x)) })}
                  onEditTemplate={setEditing}
                  notices={message && <MessageBox message={message} />}
                />
              ) : (
                <WordsSection key={row.year} words={draft.wordChecks ?? DEFAULT_WORD_CHECKS} onChange={(wordChecks) => setDraft({ ...draft, wordChecks })} onPending={onPending} notices={message && <MessageBox message={message} />} />
              )
          }
          stage={
            section === 'course' && shownCourse ? (
              <>
                <div className="caption">
                  <b>見本</b>
                  <span>学生が最初に見る本文（{courseName(shownCourse)} コース）</span>
                </div>
                <TemplatePreview blocks={shownCourse.template?.length ? shownCourse.template : DEFAULT_TEMPLATE} />
              </>
            ) : null
          }
        />
      </main>
      {dirty && <DirtyBar changes={labels} row={row} teacher busy={busy} onSave={save} onShow={() => setShowChanges(true)} />}
      {help && <AdminHelp onClose={() => setHelp(false)} />}
      {showChanges && <ChangesDialog changes={labels} onClose={() => setShowChanges(false)} />}
      {editing !== null && editingCourse && (
        <TemplateEditor
          course={editingCourse}
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
