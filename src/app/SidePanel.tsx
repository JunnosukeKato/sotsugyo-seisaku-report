import { useEffect, useRef, type ReactNode } from 'react'
import { findCourse, type YearConfig } from '../config'
import { abstractCharCount, type ReportFinding } from '../checker/reportChecks'
import type { EditorSnapshot, ReportEditor } from '../editor/reportEditor'
import type { PageKind } from '../layout/measure'
import { Icon } from './icons'
import { AREA_LABELS, AREA_ORDER, daysUntil, formatDeadline } from './labels'
import { DriveChipMenu, type DriveControls } from './DriveUi'
import type { SaveState } from './useAutosave'
import { WordImportLink } from './WordImport'

/**
 * 右の欄。上から：名前・保存のようす・締切・手順書とバックアップ（今年度だけ「Word で書いた分を読み込む」）・使い方（手引き）／
 * Word から写したあとの「つぎにすること」（今年度だけ）／学科からのお知らせ／ページ一覧／セルフチェック／PDFの書き出し
 */

interface Props {
  editor: ReportEditor
  snap: EditorSnapshot
  config: YearConfig
  saveState: SaveState
  /** ドライブに保存しているとき（ログイン必須）。保存のようすをドライブのものにする */
  drive?: DriveControls
  /** 管理ページでドライブ保存を止めている */
  driveStopped?: boolean
  onBackup: () => void
  onExport: () => void
  /** 「PDFを書き出す」を押して、紙面を確かめている途中 */
  exporting?: boolean
  onReferences: () => void
  /** 今年度だけ：「Word で書いた分を読み込む」の小さなリンク（mockups/v24 ① 案C）。渡したときだけ出す */
  onWordImport?: () => void
  /** 今年度だけ：Word から写したあとの「つぎにすること」（mockups/v24 ③ 案B）。右の欄の上に出す */
  wordTodo?: ReactNode
}

/** 保存のようす。role="status"：変わったら、読み上げでも（話の切れ目で）知らせる */
export function SaveChip({ state }: { state: SaveState }) {
  const title = '原稿はこのブラウザに自動で保存されます'
  if (state.status === 'saving') return <span className="chip saved" role="status" title={title}><i className="dot busy" />保存しています…</span>
  if (state.status === 'error') return <span className="chip saved ng" role="status" title={state.message}><i className="dot ng" />保存できません。バックアップを保存してください</span>
  const at = state.status === 'saved' ? ` ${state.at.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}` : ''
  return <span className="chip saved" role="status" title={title}><i className="dot" />自動保存{at}</span>
}

/** 管理ページでドライブ保存を止めているとき（mockups/v22 ②） */
export function DriveStoppedNote() {
  return <div className="drive-stopped">いまはドライブへの保存を止めています（学科の判断）。原稿はこの端末にだけ保存されます。再開されたら、ログインするとドライブにも保存されます。</div>
}

/** 自分のコースへのお知らせ（管理ページで、コースごとに書く。mockups/v21） */
export function CourseNotice({ config, courseId }: { config: YearConfig; courseId: string }) {
  const course = findCourse(config, courseId)
  if (!course?.notice?.trim()) return null
  return (
    <div className="notice">
      <b>{course.name} コースからのお知らせ</b>
      <p>{course.notice.trim()}</p>
    </div>
  )
}

export function DeadlineChip({ deadline }: { deadline: string }) {
  const days = daysUntil(deadline)
  const title = `最終締切 ${formatDeadline(deadline)}`
  if (days < 0) return <span className="chip deadline ng" title={title}>締切を過ぎています</span>
  if (days === 0) return <span className="chip deadline ng" title={title}>今日が締切です</span>
  return <span className="chip deadline" title={title}>締切まで <b>{days}</b> 日</span>
}

const SHORT_NAMES: Record<PageKind, string> = { cover: '表紙', abstract: '抄録', toc: '目次', body: '本文', references: '参考文献', photos: '作品写真', unknown: '' }

/** 画面の左端の、ページの一覧の欄（PC。PowerPoint と同じ形） */
export function PageColumn({ editor, snap }: { editor: ReportEditor; snap: EditorSnapshot }) {
  return (
    <aside className="thumbs-col" aria-label="ページの一覧">
      <div className="sec-h">
        <span>ページ</span>
        {snap.pageCount > 0 && (
          <span className="pcount">
            <b>{snap.page + 1}</b> / {snap.pageCount}
          </span>
        )}
      </div>
      <PageThumbs editor={editor} snap={snap} />
    </aside>
  )
}

/** ページ一覧。紙面を縮小した本物の見た目を出し、エラーのあるページに赤い点を付ける */
export function PageThumbs({ editor, snap, onPick }: { editor: ReportEditor; snap: EditorSnapshot; onPick?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const kinds = snap.layout?.kinds ?? []
  let body = 0
  const names = kinds.map((k) => (k === 'body' ? `${SHORT_NAMES.body} ${++body}` : SHORT_NAMES[k]))
  const errorPages = new Set(snap.findings.filter((f) => f.severity === 'error').map((f) => editor.pageOfFinding(f)))

  // 組み直すたびに、紙面のページを複製して縮小表示する
  useEffect(() => {
    const boxes = ref.current?.querySelectorAll<HTMLElement>('.mini')
    const pages = editor.pageElements()
    boxes?.forEach((box, i) => {
      const page = pages[i]
      if (!page) return box.replaceChildren()
      const clone = page.cloneNode(true) as HTMLElement
      clone.className = 'mini-page'
      clone.removeAttribute('id')
      for (const el of clone.querySelectorAll('[id]')) el.removeAttribute('id')
      box.replaceChildren(clone)
    })
  }, [editor, snap.layout])

  // 見ているページの見本が、一覧の中で見えるようにする
  useEffect(() => {
    ref.current?.querySelector('.t.on')?.scrollIntoView({ block: 'nearest' })
  }, [snap.page])

  return (
    <div className="thumb-list" ref={ref}>
      {names.map((name, i) => (
        <button
          key={i}
          className={`t${i === snap.page ? ' on' : ''}${errorPages.has(i) ? ' has-error' : ''}`}
          title={`${name}（${i + 1}ページ目）${errorPages.has(i) ? '：エラーがあります' : ''}`}
          // 読み上げの名前（縮小した紙面の中の文字まで読まないように、短い名前を付ける）
          aria-label={`${name}（${i + 1}ページ目）${errorPages.has(i) ? 'エラーあり' : ''}`}
          aria-current={i === snap.page ? 'page' : undefined}
          // スマホの「ページ一覧」の欄を開いたときは、見ているページに移る（useDialogFocus）
          data-autofocus={onPick && i === snap.page ? true : undefined}
          onClick={() => {
            onPick?.()
            void editor.goToPage(i)
          }}>
          {/* 縮小した紙面は見た目だけ（読み上げない・中のボタンにも移らない） */}
          <span className="mini" aria-hidden="true" inert />
          {name}
        </button>
      ))}
    </div>
  )
}

function Meter({ label, value, ok, ratio }: { label: string; value: string; ok: boolean; ratio: number }) {
  return (
    <div className="meter">
      <div className="row">
        <span>{label}</span>
        <b className={ok ? 'ok' : 'ng'}>{value}</b>
      </div>
      <div className="bar">
        <i className={ok ? 'ok' : 'ng'} style={{ width: `${Math.max(2, Math.min(100, ratio * 100))}%` }} />
      </div>
    </div>
  )
}

/**
 * 書いている（選んでいる）箇所の指摘か。here：カーソルがその箇所にある・選んでいる図表の指摘、block：書いている欄のほかの指摘
 */
function activeKind(f: ReportFinding, snap: EditorSnapshot): 'here' | 'block' | null {
  const selected = snap.selection && snap.selection.kind !== 'photos' ? snap.selection.id : null
  if (f.blockId && f.blockId === selected) return 'here'
  if (!f.blockId || f.blockId !== snap.editingId) return null
  if (f.start === undefined || f.end === undefined || snap.caret === null) return 'here'
  return snap.caret >= f.start && snap.caret <= f.end ? 'here' : 'block'
}

function Issue({ finding, editor, onPick, active }: { finding: ReportFinding; editor: ReportEditor; onPick?: () => void; active?: 'here' | 'block' | null }) {
  return (
    // 行のどこを押しても、その箇所へ移る（「直す」「このままにする」は、それぞれの働きだけ）
    <li
      className={`issue ${finding.severity}${active ? ` active ${active}` : ''}`}
      onClick={() => {
        onPick?.()
        void editor.goToFinding(finding)
      }}
      onMouseEnter={() => editor.focusFinding(finding)}
      onMouseLeave={() => editor.focusFinding(null)}
    >
      <i className="dot" />
      {/* キーボードでは、題名の部分のボタンに Tab で移り、Enter でその箇所へ（押すと上の li の onClick が働く） */}
      <button type="button" className="go" aria-label={`${finding.severity === 'error' ? 'エラー' : '注意'}：${finding.title}${finding.detail ? `（${finding.detail}）` : ''}`}>
        <span className="ttl">
          {finding.title}
          <span className="src">{finding.source === 'guide' ? '手順書' : '補助'}</span>
        </span>
        {finding.detail && <span className="detail">{finding.detail}</span>}
      </button>
      {finding.replacement !== undefined ? (
        <button
          className="fix"
          onClick={(e) => {
            e.stopPropagation()
            editor.applyFinding(finding)
          }}
        >
          直す
        </button>
      ) : (
        <span />
      )}
      {/* 手順書のルールではない補助の指摘は、学生が確かめて「このままにする」にできる（mockups/v22 ① 案A） */}
      {finding.key && (
        <button
          className="keep"
          onClick={(e) => {
            e.stopPropagation()
            editor.acknowledge(finding.key!)
          }}
        >
          このままにする（確認済み）
        </button>
      )}
    </li>
  )
}

/** ライセンス（AGPL-3.0）に従い、利用者にソースコードの場所を示す */
export function SourceNotice() {
  const url = import.meta.env.VITE_SOURCE_URL as string | undefined
  if (!url) return null
  return (
    <a className="source-notice" href={url} target="_blank" rel="noreferrer">
      このツールのソースコード（AGPL-3.0）
    </a>
  )
}

/**
 * 使い方の手引き（学生用の PDF）を新しいタブで開く小さなリンク。PDF は public/guides/ に置き、ツールといっしょに公開する
 * （scripts/make-guides.mjs で作る）。PC は右の欄の上、スマホはメニューに出す
 */
export function GuideLink() {
  return (
    <a className="howto-link" href="./guides/student-guide.pdf" target="_blank" rel="noreferrer">
      使い方（手引き）
    </a>
  )
}

/** セルフチェックの中身（進み具合のメーターと、場所ごとにまとめた指摘）。PC は右の欄、スマホは下から出る欄に置く */
export function CheckBody({ editor, snap, config, onPick }: { editor: ReportEditor; snap: EditorSnapshot; config: YearConfig; onPick?: () => void }) {
  const { findings, layout, report } = snap
  const listRef = useRef<HTMLDivElement>(null)
  // 書いている（選んでいる）箇所の指摘が変わったら、その指摘が一覧の見えるところに来るようにする
  const here = findings.filter((f) => activeKind(f, snap) === 'here').map((f) => `${f.ruleId}:${f.blockId}:${f.start}`).join('|')
  useEffect(() => {
    // 「動きを減らす」設定のときは、すっと動かさず、すぐに移す
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    if (here) listRef.current?.querySelector('.issue.here')?.scrollIntoView({ block: 'nearest', behavior })
  }, [here])
  const chars = abstractCharCount(report)
  const { minChars, maxChars, minLines, maxLines } = config.abstract
  const bodyPages = layout?.bodyPages ?? 0
  const figures = report.body.flatMap((c) => c.blocks).reduce((n, b) => n + (b.type === 'figureRow' ? b.figures.length : 0), 0)
  const figureMax = Math.max(1, bodyPages * config.body.imagesPerPageGuide)
  return (
    <>
      <div className="meters">
        <Meter label="本文のページ数" value={`${bodyPages} / ${config.body.minPages}ページ以上`} ok={bodyPages >= config.body.minPages} ratio={bodyPages / config.body.minPages} />
        {report.abstract.started === false ? (
          <Meter label="抄録" value="先生の許可が出てから書きます" ok ratio={0} />
        ) : (
          <>
            <Meter label="抄録の文字数" value={`${chars}字（${minChars}〜${maxChars}）`} ok={chars >= minChars && chars <= maxChars} ratio={chars / maxChars} />
            <Meter
              label="抄録の行数"
              value={`${layout?.abstractLines ?? 0}行（${minLines}〜${maxLines}）`}
              ok={!!layout && layout.abstractLines >= minLines && layout.abstractLines <= maxLines}
              ratio={(layout?.abstractLines ?? 0) / maxLines}
            />
          </>
        )}
        <Meter label="図の枚数" value={`${figures}枚（目安 ${figureMax}枚まで）`} ok={figures <= figureMax} ratio={figures / figureMax} />
      </div>
      <div ref={listRef}>
      {findings.length === 0 ? (
        <div className="empty">✓ 指摘はありません。PDFを書き出せます。</div>
      ) : (
        AREA_ORDER.map((area) => {
          const items = findings.filter((f) => f.area === area)
          if (items.length === 0) return null
          return (
            <div key={area} className="igroup">
              <div className="ig-h">
                {AREA_LABELS[area]}
                <span>{items.length}件</span>
              </div>
              <ul className="issues">
                {items.map((f, i) => (
                  <Issue key={`${f.ruleId}-${f.blockId}-${f.start}-${i}`} finding={f} editor={editor} onPick={onPick} active={activeKind(f, snap)} />
                ))}
              </ul>
            </div>
          )
        })
      )}
      {snap.acknowledged.length > 0 && (
        <details className="acked">
          <summary>確認済み {snap.acknowledged.length}件（エラーに数えない）</summary>
          <ul>
            {snap.acknowledged.map((f) => (
              <li key={f.key}>
                <span>
                  {f.title}
                  {f.detail && <small>{f.detail}</small>}
                </span>
                <button onClick={() => f.key && editor.unacknowledge(f.key)}>戻す</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      </div>
    </>
  )
}

/** エラーと警告の件数 */
export function Tally({ snap }: { snap: EditorSnapshot }) {
  const errors = snap.findings.filter((f) => f.severity === 'error').length
  return (
    <span className="tally">
      <b className="e">{errors}</b> エラー　<b className="w">{snap.findings.length - errors}</b> 警告
    </span>
  )
}

export function SidePanel({ editor, snap, config, saveState, drive, driveStopped, onBackup, onExport, exporting, onReferences, onWordImport, wordTodo }: Props) {
  const errors = snap.findings.filter((f) => f.severity === 'error').length
  return (
    <aside className="side">
      <header className="side-head">
        <div className="brand-row">
          <span className="mark">卒</span>
          <div>
            <div className="brand-name">{config.reportName}</div>
            <div className="brand-sub">{config.fiscalYear}年度</div>
          </div>
        </div>
        <div className="meta">
          {drive ? <DriveChipMenu drive={drive} /> : <SaveChip state={saveState} />}
          <DeadlineChip deadline={config.deadline} />
        </div>
        {driveStopped && <DriveStoppedNote />}
        {drive?.staff && <p className="staff-note">教職員のアカウントで試しています（学籍番号は自動で入りません）</p>}
        <div className="links">
          {config.handbookUrl && (
            <a className="link-btn" href={config.handbookUrl} target="_blank" rel="noreferrer">
              {Icon.handbook}手順書
            </a>
          )}
          <button className="link-btn" onClick={onBackup}>
            {Icon.backup}バックアップ
          </button>
        </div>
        {onWordImport && <WordImportLink onClick={onWordImport} />}
        <GuideLink />
      </header>

      {wordTodo}

      <CourseNotice config={config} courseId={snap.report.basicInfo.courseId} />

      {/* 引用・参考文献はない報告書が多いため、使うときだけここから入れる（入れた後は、そのページをクリックして編集する） */}
      {snap.report.references.length === 0 && (
        <div className="refs-link">
          <button className="add-refs" onClick={onReferences}>
            ＋ 引用・参考文献を入れる（使うときだけ）
          </button>
        </div>
      )}

      <section className="sec check">
        <div className="sec-h">
          <span>セルフチェック</span>
          <Tally snap={snap} />
        </div>
        <CheckBody editor={editor} snap={snap} config={config} />
      </section>

      <footer className="side-foot">
        <button className="export" disabled={(snap.rendering && !snap.layout) || exporting} onClick={onExport}>
          {Icon.pdf}
          {exporting ? '確かめています…' : 'PDFを書き出す'}
        </button>
        <p>{errors > 0 ? `エラーが${errors}件あります。0にしてから書き出しましょう` : '提出用のPDFを書き出せます'}</p>
        <SourceNotice />
      </footer>
    </aside>
  )
}
