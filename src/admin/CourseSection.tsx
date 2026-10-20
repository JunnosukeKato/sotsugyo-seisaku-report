import { Fragment, useId, useRef, useState, type ReactNode } from 'react'
import type { Course, YearConfig } from '../config'
import { AdminIcon } from './adminIcons'
import { courseChanged, courseName } from './changes'
import { endsWithCourse, joinSubtitle, splitSubtitle, subtitleExample } from './subtitleText'
import { templateSummary } from './templateText'
import { Chip, Row, SectionHead } from './ui'
import { useReorder } from './useReorder'

/**
 * 「コース」の区切り（mockups/v43 案B。コースは1行ずつに閉じておき、「開く」で、その行の中に全部の欄を出す）。
 * 管理者：コース名（欄の外に「コース」）・指導教員・お知らせ・ひな形・サブタイトル（「―」は欄の外）。並べ替えは ⋮⋮ をドラッグ。
 * 先生（teacher）：指導教員（見るだけ）・お知らせ・ひな形だけ。学生に表示しないコースは出さない
 */

export const NOTICE_HINT = 'このコースの学生のツールの、セルフチェック欄の上に表示されます。'
const NOTICE_EXAMPLE = '例：12月4日（金）の中間発表では、本文の下書きを印刷して持ってきてください'

interface Props {
  draft: YearConfig
  /** 保存してある内容（「変更あり」の印を付けるため） */
  base: YearConfig
  teacher?: boolean
  /** 開いているコースの ID（なければ、どれも閉じている） */
  openId: string | null
  onOpen: (id: string | null) => void
  /** 見本に出すコースを選んだ（カードの中を押した・欄に入った） */
  onFocusCourse: (id: string) => void
  setCourse: (i: number, c: Course) => void
  /** 並べ替え（管理者だけ。from 番目を to 番目に） */
  onMove?: (from: number, to: number) => void
  onAdd?: () => void
  onRemove?: (i: number) => void
  /** 公開したことのあるコース（削除できない） */
  publishedIds?: Set<string>
  /** 「ひな形を作る画面を開く」（学生と同じ紙面で作る画面を、管理ページの上に重ねて開く。mockups/v44 案A） */
  onOpenTemplate: (i: number) => void
  /** 「前の作り方で直す」（前のひな形の窓。予備） */
  onEditTemplate: (i: number) => void
  /** 区切りの見出しのすぐ下に出す知らせ（保存した・断られた、入力の誤りなど） */
  notices?: ReactNode
}

export function CourseSection({ draft, base, teacher = false, openId, onOpen, onFocusCourse, setCourse, onMove, onAdd, onRemove, publishedIds, onOpenTemplate, onEditTemplate, notices }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const order = useReorder(listRef, teacher ? 0 : draft.courses.length, (from, to) => onMove?.(from, to), '.course')
  const shown = draft.courses.map((c, i) => ({ c, i })).filter(({ c }) => !teacher || !c.hidden)
  return (
    <>
      <SectionHead title="コース" lead={teacher ? 'コースを開いて、お知らせとひな形を直します。' : '学生が最初に選ぶコースです。開いて直します。並べ替えは ⋮⋮ をドラッグします。'} />
      {notices}
      <div className="course-list" ref={listRef}>
        {shown.map(({ c, i }) => (
          <CourseItem
            key={c.id}
            course={c}
            base={base}
            draft={draft}
            teacher={teacher}
            open={openId === c.id}
            onToggle={() => onOpen(openId === c.id ? null : c.id)}
            onFocus={() => onFocusCourse(c.id)}
            onChange={(course) => setCourse(i, course)}
            grip={teacher ? null : order.gripProps(i, c.id)}
            dragging={order.drag?.from === i}
            published={!!publishedIds?.has(c.id)}
            onRemove={() => onRemove?.(i)}
            onOpenTemplate={() => onOpenTemplate(i)}
            onEditTemplate={() => onEditTemplate(i)}
          />
        ))}
        {order.drag?.line != null && <div className="drop-line" style={{ top: order.drag.line }} />}
      </div>
      <div className="sr-only" aria-live="polite">
        {order.message}
      </div>
      {!teacher && onAdd && (
        <button className="add" onClick={onAdd}>
          {AdminIcon.plus}コースを追加
        </button>
      )}
    </>
  )
}

function CourseItem({
  course,
  base,
  draft,
  teacher,
  open,
  onToggle,
  onFocus,
  onChange,
  grip,
  dragging,
  published,
  onRemove,
  onOpenTemplate,
  onEditTemplate,
}: {
  course: Course
  base: YearConfig
  draft: YearConfig
  teacher: boolean
  open: boolean
  onToggle: () => void
  onFocus: () => void
  onChange: (c: Course) => void
  grip: ReturnType<ReturnType<typeof useReorder>['gripProps']> | null
  dragging: boolean
  published: boolean
  onRemove: () => void
  onOpenTemplate: () => void
  onEditTemplate: () => void
}) {
  const bodyId = useId()
  const changed = (key?: string) => courseChanged(base, draft, course.id, key)
  const advisors = course.advisors.filter((a) => a.trim())
  return (
    <div className={`course${open ? ' open' : ''}${course.hidden ? ' hidden-course' : ''}${dragging ? ' dragging' : ''}`} data-course-id={course.id} onFocus={onFocus} onClick={onFocus}>
      <div className={`crow${grip ? "" : " nogrip"}`}>
        {/* 並べ替えのつまみ（カードの左上）。つかんで上下に動かす。キーボードでは ↑・↓ */}
        {grip && (
          <button className="grip" {...grip}>
            ⋮⋮
          </button>
        )}
        <div className="cmain">
          <b className="cname">{courseName(course)} コース</b>
          <span className="adv">指導教員：{advisors.join('、') || 'まだいません'}</span>
          {!open && (
            <span className="chips">
              {changed() && <Chip kind="chg">変更あり</Chip>}
              {course.hidden && <Chip kind="off">学生に表示しない</Chip>}
              {course.notice?.trim() ? (
                <Chip kind="acc">
                  {AdminIcon.notice}お知らせあり
                </Chip>
              ) : (
                <Chip>お知らせなし</Chip>
              )}
              {course.template?.length ? (
                <Chip kind="acc">
                  {AdminIcon.template}独自のひな形
                </Chip>
              ) : (
                <Chip>標準のひな形</Chip>
              )}
            </span>
          )}
        </div>
        <button className="btn sub sm open-btn" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={onToggle}>
          {open ? '閉じる' : '開く'}
        </button>
      </div>
      {open && (
        <div className="cbody" id={bodyId}>
          <div className="grid">
            {teacher ? (
              <Row label="指導教員">
                <div className="plain">{advisors.join('、') || 'まだいません'}</div>
              </Row>
            ) : (
              <>
                <NameRow course={course} changed={changed('name') || changed('hidden')} onChange={onChange} />
                <AdvisorRow course={course} changed={changed('advisors')} onChange={onChange} />
              </>
            )}
            <Row label="お知らせ" sub="任意" htmlFor={`c-${course.id}-notice`} hint={NOTICE_HINT} changed={changed('notice')}>
              {/* 書いてから消したときは「お知らせなし」に戻す（空の文字のまま残すと、保存していない変更があるように見えるため） */}
              <textarea id={`c-${course.id}-notice`} className="in notice" rows={teacher ? 3 : 2} value={course.notice ?? ''} placeholder={NOTICE_EXAMPLE} onChange={(e) => onChange({ ...course, notice: e.target.value || undefined })} />
            </Row>
            <Row label="ひな形" sub="下書き" changed={changed('template') || changed('abstractExample')} hint={teacher ? '組み立ては右の見本のとおりです' : undefined}>
              <div className={`tpl-line${course.template?.length ? '' : ' default'}`}>
                {/* 要約は「・」の切れ目で折り返す（「図の枠」と数を別の行に分けない） */}
                <b>
                  {templateSummary(course)
                    .split('・')
                    .map((part, k) => (
                      <Fragment key={k}>
                        {k > 0 && '・'}
                        <span className="part">{part}</span>
                      </Fragment>
                    ))}
                </b>
                {/* 学生と同じ紙面で作る画面を、管理ページの上に重ねて開く（mockups/v44 案A）。開けないときの予備に、前の窓も残す */}
                <span className="tpl-acts">
                  <button className="btn sub sm tpl-open" onClick={onOpenTemplate}>
                    {AdminIcon.template}ひな形を作る画面を開く
                  </button>
                  <button className="link tpl-old" onClick={onEditTemplate}>
                    前の作り方で直す
                  </button>
                </span>
              </div>
            </Row>
            {!teacher && <SubtitleRow course={course} changed={changed('subtitleTemplate')} onChange={onChange} />}
          </div>
          {!teacher && (
            <div className="cfoot">
              {published ? (
                <span>公開したことのあるコースは、消せません。「学生に表示」を外します。</span>
              ) : (
                <button className="btn sm danger" onClick={onRemove}>
                  このコースを削除
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** コース名（「コース」は欄の外に固定。名前には付けない）と「学生に表示」 */
function NameRow({ course, changed, onChange }: { course: Course; changed: boolean; onChange: (c: Course) => void }) {
  const warnId = useId()
  const warn = endsWithCourse(course.name)
  return (
    <Row label="コース名" htmlFor={`c-${course.id}-name`} changed={changed}>
      <span className="name-box">
        <input id={`c-${course.id}-name`} className="in name" value={course.name} placeholder="コース名" aria-describedby={warn ? warnId : undefined} onChange={(e) => onChange({ ...course, name: e.target.value })} />
        <span className="suffix">コース</span>
      </span>
      {warn && (
        <div className="name-warn" id={warnId}>
          名前の最後の「コース」は消してください（表紙では自動で付きます）
        </div>
      )}
      <label className="toggle-label">
        <input type="checkbox" checked={!course.hidden} onChange={(e) => onChange({ ...course, hidden: !e.target.checked })} />
        学生に表示
      </label>
    </Row>
  )
}

/** 指導教員（名前の札。欄に入れて Enter で足す） */
function AdvisorRow({ course, changed, onChange }: { course: Course; changed: boolean; onChange: (c: Course) => void }) {
  const [advisor, setAdvisor] = useState('')
  const add = () => {
    const name = advisor.trim()
    if (!name) return
    onChange({ ...course, advisors: [...course.advisors, name] })
    setAdvisor('')
  }
  return (
    <Row label="指導教員" htmlFor={`c-${course.id}-advisor`} hint="抄録に出ます" changed={changed}>
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
          id={`c-${course.id}-advisor`}
          className="in tag-input"
          value={advisor}
          placeholder="氏名を入れて Enter"
          onChange={(e) => setAdvisor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              add()
            }
          }}
          onBlur={add}
        />
      </div>
    </Row>
  )
}

/** サブタイトルの形式：「―」［前］〔学生が入力〕［後ろ］「―」。前後の「―」は固定の印（保存するときに付ける） */
function SubtitleRow({ course, changed, onChange }: { course: Course; changed: boolean; onChange: (c: Course) => void }) {
  const [before, after] = splitSubtitle(course.subtitleTemplate)
  return (
    <Row label="サブタイトル" htmlFor={`c-${course.id}-before`} hint={<span className="example">例：{subtitleExample(course.subtitleTemplate)}</span>} changed={changed}>
      <div className="template">
        <span className="dash" title="この線は自動で付きます">
          ―
        </span>
        <input id={`c-${course.id}-before`} className="in" aria-label="学生が入力する部分の前" value={before} onChange={(e) => onChange({ ...course, subtitleTemplate: joinSubtitle(e.target.value, after) })} />
        <span className="slot">学生が入力</span>
        <input className="in" aria-label="学生が入力する部分の後ろ" value={after} onChange={(e) => onChange({ ...course, subtitleTemplate: joinSubtitle(before, e.target.value) })} />
        <span className="dash" title="この線は自動で付きます">
          ―
        </span>
      </div>
    </Row>
  )
}
