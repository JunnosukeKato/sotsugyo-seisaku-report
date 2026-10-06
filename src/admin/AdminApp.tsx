import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useDialogFocus } from '../app/useDialogFocus'
import { DEFAULT_WORD_CHECKS } from '../checker/textRules'
import type { Course, WordCheck, YearConfig } from '../config'
import { validateConfig } from '../config/validate'
import { MembersDialog } from './Members'
import { Preview } from './Preview'
import { isMockServer, roleOf, server, type AdminState, type HistoryRow, type TemplateSet, type YearRow } from './server'
import { TemplateEditor } from './TemplateEditor'
import { templateSummary } from './templateText'
import { WordsEditor } from './WordsEditor'
import { wordSummary } from './wordsText'

/**
 * 管理ページ（案2：設定と見本を並べる型）。デザインは mockups/admin-2.html。
 * 毎年変わる設定（共通の題目、コース、指導教員、締切など）を編集し、学生のツールに公開する。
 * コースごとの「下書きのひな形」は、コースのカードの「編集する」から編集する（mockups/v8 案1）。
 * 「書き間違えやすい語」は、ボタンから開く窓で編集する（mockups/v17 案3）。
 * 「先生」として登録された人には、ひな形と書き間違えやすい語だけを編集できる画面（TeacherView）を出す。
 */

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function splitTemplate(template: string): [string, string] {
  const i = template.indexOf('{input}')
  return i < 0 ? [template, ''] : [template.slice(0, i), template.slice(i + '{input}'.length)]
}

/** 書き間違えやすい語の欄：見出しと、語の数を出すボタン（押すと窓が開く） */
function WordsSection({ words, onOpen }: { words: WordCheck[]; onOpen: () => void }) {
  return (
    <>
      <h2 className="words-head">書き間違えやすい語</h2>
      <p className="hint words-hint">学生のセルフチェックで指摘し、「直す」で正しい語に置き換えられるようにします。</p>
      <button className="words-btn" onClick={onOpen}>
        書き間違えやすい語の一覧を編集<span>{wordSummary(words)}</span>
      </button>
    </>
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

function TextInput({ value, onChange, placeholder, type = 'text' }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return <input className="in" type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
}

function NumberInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <input className="in num" type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} />
}

function CourseCard({
  course,
  index,
  count,
  published,
  onChange,
  onMove,
  onRemove,
  onFocus,
  focused,
  onEditTemplate,
}: {
  course: Course
  index: number
  count: number
  published: boolean
  onChange: (c: Course) => void
  onMove: (delta: number) => void
  onRemove: () => void
  onFocus: () => void
  focused: boolean
  onEditTemplate: () => void
}) {
  const [before, after] = splitTemplate(course.subtitleTemplate)
  const [advisor, setAdvisor] = useState('')
  const addAdvisor = () => {
    const name = advisor.trim()
    if (!name) return
    onChange({ ...course, advisors: [...course.advisors, name] })
    setAdvisor('')
  }
  return (
    <div className={`course${focused ? ' on' : ''}${course.hidden ? ' hidden-course' : ''}`} onFocus={onFocus} onClick={onFocus}>
      <div className="top">
        <input className="in name" value={course.name} placeholder="コース名（「コース」は付けない）" onChange={(e) => onChange({ ...course, name: e.target.value })} />
        <label className="toggle-label">
          <input type="checkbox" checked={!course.hidden} onChange={(e) => onChange({ ...course, hidden: !e.target.checked })} />
          学生に表示
        </label>
      </div>
      <div className="l">サブタイトルの形式</div>
      <div className="template">
        <input className="in" value={before} onChange={(e) => onChange({ ...course, subtitleTemplate: `${e.target.value}{input}${after}` })} />
        <span className="slot">学生が入力</span>
        <input className="in" value={after} onChange={(e) => onChange({ ...course, subtitleTemplate: `${before}{input}${e.target.value}` })} />
      </div>
      <div className="hint">例：{before}シンドバッド{after}</div>
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
        <button disabled={index === 0} onClick={() => onMove(-1)}>
          ↑ 上へ
        </button>
        <button disabled={index === count - 1} onClick={() => onMove(1)}>
          ↓ 下へ
        </button>
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
function NoticeField({ course, onChange }: { course: Course; onChange: (notice: string) => void }) {
  return (
    <label className="notice-field">
      <span className="l">このコースの学生へのお知らせ（任意）</span>
      <textarea className="in" rows={2} value={course.notice ?? ''} placeholder="例：12月4日（金）の中間発表では、本文の下書きを印刷して持ってきてください" onChange={(e) => onChange(e.target.value)} />
      <span className="hint">このコースの学生のツールの、セルフチェック欄の上に表示されます</span>
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
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'ng'; text: string } | null>(null)
  const [focusedCourse, setFocusedCourse] = useState(0)
  const [dialog, setDialog] = useState<'newYear' | 'history' | 'members' | null>(null)
  const [editingTemplate, setEditingTemplate] = useState<number | null>(null)
  const [editingWords, setEditingWords] = useState(false)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [newYear, setNewYear] = useState('')

  const row: YearRow | undefined = state?.years.find((y) => y.year === year)
  const dirty = !!row && !!draft && !same(row.config, draft)
  const problems = useMemo(() => (draft ? validateConfig(draft) : []), [draft])
  const errors = problems.filter((p) => p.severity === 'error')

  const select = useCallback((s: AdminState, y: number) => {
    const target = s.years.find((r) => r.year === y) ?? s.years[0]
    setYear(target?.year ?? null)
    setDraft(target ? clone(target.config) : null)
    setFocusedCourse(0)
  }, [])

  useEffect(() => {
    server
      .getState()
      .then((s) => {
        setState(s)
        const published = s.years.find((y) => y.status === '公開中') ?? s.years[0]
        if (published) select(s, published.year)
      })
      .catch((e) => setMessage({ kind: 'ng', text: `読み込めませんでした：${String(e?.message ?? e)}` }))
  }, [select])

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const run = async (label: string, fn: () => Promise<AdminState>, nextYear?: number) => {
    setBusy(true)
    setMessage(null)
    try {
      const s = await fn()
      setState(s)
      select(s, nextYear ?? year!)
      setMessage({ kind: 'ok', text: label })
    } catch (e) {
      setMessage({ kind: 'ng', text: `できませんでした：${String((e as Error)?.message ?? e)}` })
    } finally {
      setBusy(false)
    }
  }

  if (!state) return <div className="admin-loading">{message ? message.text : '読み込んでいます…'}</div>
  const role = roleOf(state)
  if (!role)
    return (
      <div className="admin-loading">
        このページは、登録された管理者と先生だけが使えます。
        <br />
        ログイン中：{state.user || '（不明）'}
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
        message={message}
        onSelectYear={(y) => select(state, y)}
        onSave={(templates, words, notices) =>
          // ひな形・お知らせ・書き間違えやすい語を、まとめて1回で保存する（途中で失敗して一部だけ保存されないように）
          void run(row.status === '公開中' ? '保存し、学生のツールに反映しました' : '保存しました', () =>
            server.saveTeacherEdits(row.year, { templates, notices, ...(words ? { words } : {}) }),
          )
        }
      />
    )

  const set = (patch: Partial<YearConfig>) => setDraft({ ...draft, ...patch })
  const setCourse = (i: number, c: Course) => set({ courses: draft.courses.map((x, j) => (j === i ? c : x)) })
  const moveCourse = (i: number, delta: number) => {
    const courses = [...draft.courses]
    const [c] = courses.splice(i, 1)
    courses.splice(i + delta, 0, c)
    set({ courses })
    setFocusedCourse(i + delta)
  }
  const publishedIds = new Set(state.years.filter((y) => y.status !== '準備中').flatMap((y) => y.config.courses.map((c) => c.id)))
  const isPublished = row.status === '公開中'

  const save = () => {
    if (isPublished && errors.length) return setMessage({ kind: 'ng', text: '公開中の年度は、エラーを直してから保存してください' })
    if (isPublished && !confirm('この年度は学生に公開中です。保存すると、すぐに学生のツールに反映されます。保存しますか？')) return
    void run(isPublished ? '保存し、学生のツールに反映しました' : '保存しました', () => server.saveYear(draft, row.updatedAt))
  }
  const publish = () => {
    if (errors.length) return setMessage({ kind: 'ng', text: 'エラーを直してから公開してください' })
    const current = state.years.find((y) => y.status === '公開中')
    if (!confirm(`${draft.fiscalYear}年度の設定を学生に公開しますか？${current ? `\n今公開中の${current.year}年度は「終了」になります。` : ''}`)) return
    void run(`${draft.fiscalYear}年度を学生に公開しました`, async () => {
      if (dirty) await server.saveYear(draft, row.updatedAt)
      return server.publishYear(draft.fiscalYear)
    })
  }

  return (
    <div className="admin">
      <header className="admin-header">
        <b>卒業制作報告書 管理ページ</b>
        <select
          className="sel"
          value={year ?? ''}
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
        {dirty && <span className="badge warn">保存していない変更があります</span>}
        {isMockServer && <span className="badge old">試験用サーバー</span>}
        <span className="spacer" />
        <span className="user">{state.user}</span>
        <button
          className="link"
          onClick={async () => {
            setHistory(await server.getHistory(row.year))
            setDialog('history')
          }}
        >
          変更履歴
        </button>
        <button className="link" onClick={() => setDialog('members')}>
          先生の登録
        </button>
        <button
          className="btn"
          onClick={() => {
            setNewYear(String(Math.max(...state.years.map((y) => y.year)) + 1))
            setDialog('newYear')
          }}
        >
          新年度を作成
        </button>
        <button className="btn" disabled={busy || !dirty} onClick={save}>
          {isPublished ? '保存して学生に反映' : '保存'}
        </button>
        {!isPublished && (
          <button className="btn primary" disabled={busy} onClick={publish}>
            この年度を学生に公開
          </button>
        )}
      </header>

      <main className="admin-main">
        <section className="form">
          {message && <div className={`message ${message.kind}`}>{message.text}</div>}
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
            <TextInput type="date" value={draft.deadline} onChange={(v) => set({ deadline: v })} />
          </Field>
          <Field label="手順書のリンク（任意）" hint="学生のツールの上部に「手順書」ボタンとして表示されます">
            <TextInput value={draft.handbookUrl ?? ''} onChange={(v) => set({ handbookUrl: v })} placeholder="https://drive.google.com/…" />
          </Field>

          <h2>コースと指導教員</h2>
          {draft.courses.map((c, i) => (
            <CourseCard
              key={c.id}
              course={c}
              index={i}
              count={draft.courses.length}
              published={publishedIds.has(c.id)}
              focused={focusedCourse === i}
              onFocus={() => setFocusedCourse(i)}
              onChange={(course) => setCourse(i, course)}
              onMove={(delta) => moveCourse(i, delta)}
              onRemove={() => {
                set({ courses: draft.courses.filter((_, j) => j !== i) })
                setFocusedCourse(0)
              }}
              onEditTemplate={() => setEditingTemplate(i)}
            />
          ))}
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
            <summary>詳細設定（手順書が改訂されたときだけ変更）</summary>
            {/* Google の障害や大学の設定変更で学生がログインできないときだけ止める（mockups/v22 ② 案B） */}
            <div className={`drive-switch${draft.driveSave === 'off' ? ' off' : ''}`}>
              <span className="l">学生のドライブ保存</span>
              <div className="seg2" role="group" aria-label="学生のドライブ保存">
                <button aria-pressed={draft.driveSave !== 'off'} className={draft.driveSave !== 'off' ? 'on' : ''} onClick={() => set({ driveSave: 'required' })}>
                  必須（ふだん）
                </button>
                <button aria-pressed={draft.driveSave === 'off'} className={draft.driveSave === 'off' ? 'on stop' : 'stop'} onClick={() => set({ driveSave: 'off' })}>
                  止める（Google の障害のとき）
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
              <Field label="作品写真の上限（枚）">
                <NumberInput value={draft.workPhotos.maxImages} onChange={(v) => set({ workPhotos: { maxImages: v } })} />
              </Field>
              <Field label="学籍番号の形式（正規表現。空なら確認しない）">
                <TextInput value={draft.studentIdPattern ?? ''} onChange={(v) => set({ studentIdPattern: v.trim() ? v : null })} placeholder="例：^\d{2}FA[A-Z]?\d{3,4}$" />
              </Field>
            </div>
          </details>
          {import.meta.env.VITE_SOURCE_URL && (
            <p className="source">
              <a href={import.meta.env.VITE_SOURCE_URL} target="_blank" rel="noreferrer">
                このツールのソースコード（AGPL-3.0）
              </a>
            </p>
          )}
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
      </main>

      {editingTemplate !== null && draft.courses[editingTemplate] && (
        <TemplateEditor
          course={draft.courses[editingTemplate]}
          config={draft}
          onClose={() => setEditingTemplate(null)}
          onApply={(template, abstractExample) => {
            setCourse(editingTemplate, { ...draft.courses[editingTemplate], template, abstractExample })
            setEditingTemplate(null)
            setMessage({ kind: 'ok', text: 'ひな形を反映しました。「保存」を押すと学生のツールに届きます' })
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
            setMessage({ kind: 'ok', text: '書き間違えやすい語を反映しました。「保存」を押すと学生のツールに届きます' })
          }}
        />
      )}

      {dialog === 'members' && <MembersDialog me={state.user} studentIdPattern={draft.studentIdPattern} onClose={() => setDialog(null)} />}

      {dialog === 'newYear' && (
        <Modal title="新年度を作成" onClose={() => setDialog(null)}>
          <p className="lead">今表示している{draft.fiscalYear}年度の設定をコピーして、新しい年度を作ります。作った年度は「準備中」になり、公開するまで学生には見えません。</p>
          <Field label="新しい年度">
            <TextInput value={newYear} onChange={(v) => setNewYear(v.replace(/[^0-9]/g, ''))} />
          </Field>
          <div className="row-buttons">
            <span className="spacer" />
            <button onClick={() => setDialog(null)}>やめる</button>
            <button
              className="primary"
              disabled={!/^\d{4}$/.test(newYear)}
              onClick={() => {
                setDialog(null)
                void run(`${newYear}年度を作成しました`, () => server.createYear(draft.fiscalYear, Number(newYear)), Number(newYear))
              }}
            >
              作成する
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
                    <small>{h.user}</small>
                  </span>
                  <button
                    onClick={() => {
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
 * 先生の画面：コースの一覧と「下書きのひな形」、書き間違えやすい語の編集だけ。
 * 保存はひな形と書き間違えやすい語だけを送る（ほかの設定はサーバー側でも変えられない）
 */
function TeacherView({
  state,
  row,
  draft,
  setDraft,
  dirty,
  busy,
  message,
  onSelectYear,
  onSave,
}: {
  state: AdminState
  row: YearRow
  draft: YearConfig
  setDraft: (c: YearConfig) => void
  dirty: boolean
  busy: boolean
  message: { kind: 'ok' | 'ng'; text: string } | null
  onSelectYear: (year: number) => void
  /** words は、書き間違えやすい語を変えたときだけ（変えていなければ null） */
  /** notices は、書き換えたコースのお知らせだけ（コースの ID → お知らせ） */
  onSave: (templates: TemplateSet, words: WordCheck[] | null, notices: Record<string, string>) => void
}) {
  const [editing, setEditing] = useState<number | null>(null)
  const [editingWords, setEditingWords] = useState(false)
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
    if (isPublished && !confirm('この年度は学生に公開中です。保存すると、すぐに学生のツールに反映されます（すでに書き始めた学生の原稿は変わりません）。保存しますか？')) return
    onSave(templates, words, notices)
  }
  return (
    <div className="admin">
      <header className="admin-header">
        <b>卒業制作報告書 管理ページ</b>
        <select
          className="sel"
          value={row.year}
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
        {dirty && <span className="badge warn">保存していない変更があります</span>}
        {isMockServer && <span className="badge old">試験用サーバー</span>}
        <span className="spacer" />
        <span className="user">{state.user}（先生）</span>
        <button className="btn primary" disabled={busy || !dirty} onClick={save}>
          {isPublished ? '保存して学生に反映' : '保存'}
        </button>
      </header>
      <main className="teacher-main">
        {message && <div className={`message ${message.kind}`}>{message.text}</div>}
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
      </main>
      {editingWords && (
        <WordsEditor
          words={draft.wordChecks ?? DEFAULT_WORD_CHECKS}
          onClose={() => setEditingWords(false)}
          onApply={(wordChecks) => {
            setDraft({ ...draft, wordChecks })
            setEditingWords(false)
          }}
        />
      )}
      {editing !== null && draft.courses[editing] && (
        <TemplateEditor
          course={draft.courses[editing]}
          config={draft}
          onClose={() => setEditing(null)}
          onApply={(template, abstractExample) => {
            setDraft({ ...draft, courses: draft.courses.map((c, j) => (j === editing ? { ...c, template, abstractExample } : c)) })
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
