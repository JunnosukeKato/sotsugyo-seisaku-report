import { Fragment, useEffect, useRef, type ReactNode } from 'react'
import { findCourse, type YearConfig } from '../config'
import { exportNote, type ProgressRow } from '../checker/progress'
import type { ReportFinding } from '../checker/reportChecks'
import type { EditorSnapshot, ReportEditor } from '../editor/reportEditor'
import type { PageKind } from '../layout/measure'
import { photoPageName } from '../model/photos'
import { Icon } from './icons'
import { AREA_LABELS, AREA_ORDER, daysUntil, formatDeadline } from './labels'
import { checkSummary, goToTarget } from './checkSummary'
import { DriveChipMenu, type DriveControls } from './DriveUi'
import { SideMenu } from './SideMenu'
import type { SaveState } from './useAutosave'

/**
 * 右の欄（PC）。上から：名前と年度・「≡ メニュー」（使い方・手順書・バックアップ・作り直す・今年度だけ Word の読み込み。app/SideMenu.tsx）／
 * 保存のようすと締切（1行）／Word から写したあとの「つぎにすること」（今年度だけ）／コースからのお知らせ／
 * セルフチェック（まだのところ・直すところ。数は小見出しの横）／PDFの書き出し。
 * 上の物をメニューに入れて減らし、字を大きく・行の間を広くしても、セルフチェックを広く見せる（mockups/v37 案C。前は mockups/v35 ①）。
 * 引用・参考文献を入れるボタンは、ここには置かない（使い方の「引用・参考文献」から入れる。入れた後は、そのページをクリックして直す）
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
  /** 「メニュー」の「？ 使い方」：右の欄を使い方に切り替える（mockups/v27 案A） */
  onHelp: () => void
  /** 今年度だけ：「メニュー」の「Word で書いた分を読み込む」（mockups/v24 ① 案C・v37 案C）。渡したときだけ出す */
  onWordImport?: () => void
  /** 今年度だけ：Word から写したあとの「つぎにすること」（mockups/v24 ③ 案B）。右の欄の上に出す */
  wordTodo?: ReactNode
}

/**
 * 保存のようす。role="status"：変わったら、読み上げでも（話の切れ目で）知らせる。
 * compact：スマホの上の帯（「戻す」「やり直す」を置いて狭いので、短い言葉にする。mockups/v39 案A）。
 * 保存した時刻は時刻だけ（ドライブに保存するときの「☁ 13:05」と同じ形。読み上げでは「自動保存 13:05」）、保存中は「保存中」、保存できないときは「保存エラー」。
 * くわしい言葉は、メニューの中の保存のようす（compact でないもの）に出る
 */
export function SaveChip({ state, compact }: { state: SaveState; compact?: boolean }) {
  const title = '原稿はこのブラウザに自動で保存されます'
  if (state.status === 'saving') return <span className="chip saved" role="status" title={title}><i className="dot busy" />{compact ? '保存中' : '保存しています…'}</span>
  if (state.status === 'error') return <span className="chip saved ng" role="status" title={state.message}><i className="dot ng" />{compact ? '保存エラー' : '保存できません。バックアップを保存してください'}</span>
  const at = state.status === 'saved' ? state.at.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : ''
  if (compact && at) return <span className="chip saved" role="status" title={`${title}（最後に保存：${at}）`}><i className="dot" /><span className="sr-only">自動保存 </span>{at}</span>
  return <span className="chip saved" role="status" title={title}><i className="dot" />自動保存{at ? ` ${at}` : ''}</span>
}

/** 管理ページでドライブ保存を止めているとき（mockups/v22 ②） */
export function DriveStoppedNote() {
  return <div className="drive-stopped">いまはドライブへの保存を止めています（学科の判断）。原稿はこの端末にだけ保存されます。再開されたら、ログインするとドライブにも保存されます。</div>
}

/**
 * 自分のコースへのお知らせ（管理ページで、コースごとに書く。mockups/v21）。
 * short：見出しを「コースからのお知らせ」だけにする（PC の右の欄。上の半分を詰める。mockups/v35 ①）
 */
export function CourseNotice({ config, courseId, short }: { config: YearConfig; courseId: string; short?: boolean }) {
  const course = findCourse(config, courseId)
  if (!course?.notice?.trim()) return null
  return (
    <div className="notice">
      <b>{short ? 'コースからのお知らせ' : `${course.name} コースからのお知らせ`}</b>
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

/** ページの一覧の名前。目次は、本文の見出しから自動で作ることが分かるように「目次（自動）」（mockups/v41） */
const SHORT_NAMES: Record<PageKind, string> = { cover: '表紙', abstract: '抄録', toc: '目次（自動）', body: '本文', references: '参考文献', photos: '作品写真', unknown: '' }

/** 画面の左端の、ページの一覧の欄（PC。PowerPoint と同じ形） */
export function PageColumn({ editor, snap }: { editor: ReportEditor; snap: EditorSnapshot }) {
  return (
    <aside className="thumbs-col" aria-label="ページの一覧">
      <div className="sec-h">
        <span>ページ</span>
        {snap.pageCount > 0 && (
          <span className="pcount">
            <b>{shownPagesLabel(snap)}</b> / {snap.pageCount}
          </span>
        )}
      </div>
      <PageThumbs editor={editor} snap={snap} />
    </aside>
  )
}

/** 見開き（mockups/v35 ③ 案A）で並べているページ（0 から。見開きでなければ、見ているページだけ） */
function shownPages(snap: EditorSnapshot): number[] {
  if (!snap.spread) return [snap.page]
  const first = snap.page - (snap.page % 2)
  return first + 1 < snap.pageCount ? [first, first + 1] : [first]
}

/** 見ているページの番号（見開きなら「5–6」） */
function shownPagesLabel(snap: EditorSnapshot): string {
  return shownPages(snap)
    .map((p) => p + 1)
    .join('–')
}

/** 親から受け継ぐ文字の設定（紙面の複製に写すもの） */
const INHERITED = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant', 'font-feature-settings', 'font-kerning',
  'line-height', 'letter-spacing', 'word-spacing', 'white-space', 'text-align', 'text-align-last', 'text-indent', 'text-transform',
  'color', 'word-break', 'line-break', 'overflow-wrap', 'hyphens', 'writing-mode', 'direction', 'text-orientation',
]

/** 組版エンジンが紙面の外側（.paper-part）に置く値。紙面の中の文字の大きさの計算に使う */
const ENGINE_VARS = ['--viv-layoutUnitAdj', '--viv-outputScale']

/**
 * 紙面の要素が親から受け継いでいる文字の設定（と組版エンジンの値）を、複製に写す。
 * 複製は一覧のボタンの中に置くので、写さないとボタンの設定（12px・折り返さない）を受け継ぎ、
 * 抄録のように大きさや行の高さを親から受け継ぐ段落が、折り返さずに紙の外へはみ出していた（2026-10-19、依頼者の画面で見つかった）
 */
function copyInherited(from: HTMLElement, to: HTMLElement): void {
  const cs = getComputedStyle(from)
  for (const name of [...INHERITED, ...ENGINE_VARS]) {
    const value = cs.getPropertyValue(name)
    if (value) to.style.setProperty(name, value)
  }
}

/** ページ一覧。紙面を縮小した本物の見た目を出し、エラーのあるページに赤い点を付ける */
export function PageThumbs({ editor, snap, onPick }: { editor: ReportEditor; snap: EditorSnapshot; onPick?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const kinds = snap.layout?.kinds ?? []
  let body = 0
  // 作品写真が何ページかあるときは「作品写真 1」「作品写真 2」（mockups/v38 案A）
  let photo = 0
  const photos = kinds.filter((k) => k === 'photos').length
  const names = kinds.map((k) => (k === 'body' ? `${SHORT_NAMES.body} ${++body}` : k === 'photos' ? photoPageName(photo++, photos) : SHORT_NAMES[k]))
  const errorPages = new Set(snap.findings.filter((f) => f.severity === 'error').map((f) => editor.pageOfFinding(f)))
  // 見ているページ（見開きなら、並べている2ページとも選んだ印）
  const shown = new Set(shownPages(snap))

  // 組み直すたびに、紙面のページを複製して縮小表示する。
  // 組み直した紙面を先に描いてから作る（長い原稿では、ページを複製して縮めるのにも時間がかかり、紙面が出るのを待たせていたため）
  useEffect(() => {
    let timer = 0
    const frame = requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        const boxes = ref.current?.querySelectorAll<HTMLElement>('.mini')
        const pages = editor.pageElements()
        boxes?.forEach((box, i) => {
          const page = pages[i]
          // 開いた直後で、まだ組んでいないページ（仮のページ）は、白いページではなく「準備中」と出す（index.css の .mini.preparing）
          const preparing = !!page?.hasAttribute('data-placeholder-page')
          box.classList.toggle('preparing', preparing)
          if (!page || preparing) return box.replaceChildren()
          const clone = page.cloneNode(true) as HTMLElement
          clone.className = 'mini-page'
          clone.removeAttribute('id')
          copyInherited(page, clone)
          // ID は同じものが2つにならないよう外す。組版エンジンは、文書全体の文字の大きさ・行の高さを ID に結び付けて決めているので、
          // 外す前に、その要素の受け継ぐ設定を写しておく（複製と元は同じ形なので、同じ順に並ぶ）
          const originals = page.querySelectorAll<HTMLElement>('[id]')
          clone.querySelectorAll<HTMLElement>('[id]').forEach((el, k) => {
            if (originals[k]) copyInherited(originals[k], el)
            el.removeAttribute('id')
          })
          box.replaceChildren(clone)
        })
      })
    })
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timer)
    }
  }, [editor, snap.layout])

  // 見ているページの見本が、一覧の中で見えるようにする
  useEffect(() => {
    ref.current?.querySelector('.t.on')?.scrollIntoView({ block: 'nearest' })
  }, [snap.page, snap.spread])

  return (
    <div className="thumb-list" ref={ref}>
      {names.map((name, i) => (
        <button
          key={i}
          className={`t${shown.has(i) ? ' on' : ''}${errorPages.has(i) ? ' has-error' : ''}`}
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

/** 「PDFを書き出す」の下のひとこと（まだのところ・直すところの数） */
export function ExportNote({ snap, config }: { snap: EditorSnapshot; config: YearConfig }) {
  const { fixes, notYet } = checkSummary(snap, config)
  return <p className="export-note">{exportNote({ fix: fixes.length, notYet, pending: snap.pageChecksPending, abstractWaiting: snap.report.abstract.started === false })}</p>
}

/**
 * まだのところの1行（灰色の ○、済むと緑の ✓、先生の許可のあとは点線の ○、目安は小さな点）。赤くしない。
 * 押すと、その場所へ移る
 */
function ProgressItem({ row, editor, onPick }: { row: ProgressRow; editor: ReportEditor; onPick?: () => void }) {
  const inner = (
    <>
      <i aria-hidden="true">{row.state === 'done' && Icon.check}</i>
      <span className="l">{row.label}</span>
      <span className="v">
        {row.value}
        {row.strong && <b>{row.strong}</b>}
      </span>
      {row.bar !== undefined && (
        <span className="bar" aria-hidden="true">
          <i style={{ width: `${Math.max(3, Math.min(100, row.bar * 100))}%` }} />
        </span>
      )}
    </>
  )
  const target = row.target
  return (
    <li className={row.state}>
      {target ? (
        <button
          type="button"
          className="row"
          onClick={() => {
            onPick?.()
            goToTarget(editor, target)
          }}
        >
          {inner}
        </button>
      ) : (
        <div className="row">{inner}</div>
      )}
    </li>
  )
}

/**
 * 済んだ（✓）行を1行にたたんだもの（PC の右の欄で、直すところがあるとき。mockups/v37 の承認：依頼者の判断）。
 * 灰色の字で「✓ 表紙・本文の段落・作品写真」。名前を押すと、たたむ前の行と同じく、その場所へ移る（開いたり閉じたりはしない）。
 * マウスを乗せると、たたむ前の右の字（「入れました」など）が出る
 */
function DoneLine({ rows, editor, onPick }: { rows: ProgressRow[]; editor: ReportEditor; onPick?: () => void }) {
  return (
    <li className="done-fold">
      <div className="row">
        <i aria-hidden="true">{Icon.check}</i>
        <span className="l">
          <span className="sr-only">済んだもの：</span>
          {rows.map((row, i) => {
            const target = row.target
            return (
              <Fragment key={row.id}>
                {i > 0 && '・'}
                {target ? (
                  <button
                    type="button"
                    title={`${row.label}：${row.value}（押すと、その場所へ）`}
                    onClick={() => {
                      onPick?.()
                      goToTarget(editor, target)
                    }}
                  >
                    {row.label}
                  </button>
                ) : (
                  <span title={`${row.label}：${row.value}`}>{row.label}</span>
                )}
              </Fragment>
            )
          })}
        </span>
      </div>
    </li>
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

/**
 * 指摘の1行。直すのは学生が自分でする（前の「直す」のボタンはなくした。押すとその箇所へ移り、直し方は detail に書いてある）
 */
function Issue({ finding, editor, onPick, active }: { finding: ReportFinding; editor: ReportEditor; onPick?: () => void; active?: 'here' | 'block' | null }) {
  return (
    // 行のどこを押しても、その箇所へ移る（「このままにする」は、その働きだけ）
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
      <button type="button" className="go" aria-label={`${finding.severity === 'error' ? 'エラー' : '要確認'}：${finding.title}${finding.detail ? `（${finding.detail}）` : ''}`}>
        <span className="ttl">{finding.title}</span>
        {finding.detail && <span className="detail">{finding.detail}</span>}
      </button>
      {/* 手順書のルールではない補助の指摘は、学生が確かめて「このままにする」にできる（mockups/v22 ① 案A）。
          書き間違えやすい語のエラーには目印（key）がないので出ない（checker/reportChecks.ts） */}
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

/**
 * エラーと要確認の意味（指摘の一覧の上。1つずつの札「手順書」「補助」の代わり。提出前チェックと同じ形。mockups/v31 案1）。
 * 補助の指摘にもエラーがあり、札と色が食い違って分かりにくかったため。印は指摘の一覧と同じ（エラー：× の丸、要確認：! のひし形）
 */
function SeverityLegend() {
  return (
    <p className="sev-legend">
      <span>
        <i className="dot" aria-hidden="true" />
        <span>
          <b className="e">エラー</b>：直してから出す
        </span>
      </span>
      <span>
        <i className="dot warning" aria-hidden="true" />
        <span>
          <b className="w">要確認</b>：確かめて、必要なら直す
        </span>
      </span>
    </p>
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
 * スマホのメニューの「？ 使い方」のボタン（mockups/v27 案A。押すと画面いっぱいの使い方の欄）。
 * PC は右の欄の「メニュー」の中の項目（app/SideMenu.tsx。押すと右の欄が使い方に替わる）。印刷用の手引き（PDF）は、使い方の一覧のいちばん下から開く
 */
export function HelpButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="link-btn help-btn" onClick={onClick}>
      {Icon.help}使い方
    </button>
  )
}

/**
 * セルフチェックの中身（mockups/v35 ① 案A）。PC は右の欄、スマホは下から出る欄に置く。
 * - まだのところ：まだ書いていない・入れていないだけのもの。決まった行の進み具合（赤くしない。押すとその場所へ）
 * - 直すところ：書いた文の間違い。エラーと要確認の意味（凡例）と、場所ごとにまとめた指摘（押すとその箇所へ）
 * pc：PC の右の欄（mockups/v37 案C）。数は小見出しの横の小さな札（直すところは赤。0 のときは出さない）、小見出しの右のひとことは
 * マウスを乗せたときだけ出す。直すところがあるときは、まだのところの済んだ（✓）行を1行にたたむ（DoneLine）。スマホは今までどおり
 */
export function CheckBody({ editor, snap, config, onPick, pc }: { editor: ReportEditor; snap: EditorSnapshot; config: YearConfig; onPick?: () => void; pc?: boolean }) {
  const { findings } = snap
  const listRef = useRef<HTMLDivElement>(null)
  // 書いている（選んでいる）箇所の指摘が変わったら、その指摘が一覧の見えるところに来るようにする
  const here = findings.filter((f) => activeKind(f, snap) === 'here').map((f) => `${f.ruleId}:${f.blockId}:${f.start}`).join('|')
  useEffect(() => {
    // 「動きを減らす」設定のときは、すっと動かさず、すぐに移す
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    if (here) listRef.current?.querySelector('.issue.here')?.scrollIntoView({ block: 'nearest', behavior })
  }, [here])
  const { rows, fixes, notYet } = checkSummary(snap, config)
  // PC：小見出しの横の数（紙面を組み終えるまでは出さない。ページ数などのチェックが加わって、数が変わるため）
  const count = (n: number, error?: boolean, prefix = '') => pc && !snap.pageChecksPending && n > 0 && <span className={`count-badge${error ? ' e' : ''}`}>{prefix}{n}</span>
  // PC で直すところがあるときは、済んだ行を1行にたたむ（まだ・先生の許可のあとなどの行は、そのまま）
  const fold = !!pc && fixes.length > 0
  const done = fold ? rows.filter((r) => r.state === 'done') : []
  return (
    <>
      <div className="check-sub" title={pc ? '押すと、その場所へ' : undefined}>
        {/* 見出しは「進み具合」（前は「まだのところ」。全部済んだときに合わないため。依頼者の選択）。残りの数は「あと3」 */}
        <b>進み具合</b>
        {pc ? count(notYet, false, 'あと') : <span>押すと、その場所へ</span>}
      </div>
      <ul className="check-prog">
        {rows
          .filter((row) => !done.includes(row))
          .map((row) => (
            <ProgressItem key={row.id} row={row} editor={editor} onPick={onPick} />
          ))}
        {done.length > 0 && <DoneLine rows={done} editor={editor} onPick={onPick} />}
      </ul>
      <div ref={listRef}>
      <div className="check-sub fix" title={pc ? '書いた文の間違い' : undefined}>
        <b>直すところ</b>
        {pc ? count(fixes.length, true) : <span>書いた文の間違い</span>}
      </div>
      {/* 開いた直後で、紙面を組み終えていない間は、ページ数などのチェックをまだしていない（「直すところはありません」とは言わない） */}
      {snap.pageChecksPending && fixes.length > 0 && <p className="check-pending">ページ数などのチェックは、紙面の準備ができてからします。</p>}
      {fixes.length > 0 && <SeverityLegend />}
      {fixes.length === 0 && snap.pageChecksPending ? (
        <div className="empty check-pending">確かめています…</div>
      ) : fixes.length === 0 ? (
        <p className="check-none">✓ いま直すところはありません</p>
      ) : (
        AREA_ORDER.map((area) => {
          const items = fixes.filter((f) => f.area === area)
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

/** 直すところと、まだのところの数（例：直すところ 3、まだ 2。直すところがあれば赤い数。mockups/v35 ① 案A） */
export function Tally({ snap, config }: { snap: EditorSnapshot; config: YearConfig }) {
  // 紙面を組み終えるまでは、件数を出さない（ページ数などのチェックが加わって、数が変わるため）
  if (snap.pageChecksPending) return <span className="tally">確かめています…</span>
  const { fixes, notYet } = checkSummary(snap, config)
  return (
    <span className="tally split">
      直すところ <b className={fixes.length ? 'e' : 'm'}>{fixes.length}</b>　まだ <b className="m">{notYet}</b>
    </span>
  )
}

export function SidePanel({ editor, snap, config, saveState, drive, driveStopped, onBackup, onExport, exporting, onHelp, onWordImport, wordTodo }: Props) {
  return (
    <aside className="side">
      <header className="side-head">
        <div className="brand-row">
          <span className="mark">卒</span>
          <div className="brand-text">
            <div className="brand-name">{config.reportName}</div>
            <div className="brand-sub">{config.fiscalYear}年度</div>
          </div>
          {/* 使い方・手順書・バックアップと「最初から作り直す」の窓（mockups/v34 案A）・今年度だけ Word の読み込み（mockups/v37 案C） */}
          <SideMenu handbookUrl={config.handbookUrl} onHelp={onHelp} onBackup={onBackup} onWordImport={onWordImport} />
        </div>
        <div className="meta">
          {drive ? <DriveChipMenu drive={drive} /> : <SaveChip state={saveState} />}
          <DeadlineChip deadline={config.deadline} />
        </div>
        {driveStopped && <DriveStoppedNote />}
        {drive?.staff && <p className="staff-note">教職員のアカウントで試しています（学籍番号は自動で入りません）</p>}
      </header>

      {wordTodo}

      <CourseNotice config={config} courseId={snap.report.basicInfo.courseId} short />

      <section className="sec check">
        {/* 数は、小見出し（まだのところ・直すところ）の横に出す（mockups/v37。スマホは見出しの横の Tally のまま） */}
        <div className="sec-h">
          <span>セルフチェック</span>
        </div>
        <CheckBody editor={editor} snap={snap} config={config} pc />
      </section>

      <footer className="side-foot">
        <button className="export" disabled={(snap.rendering && !snap.layout) || exporting} onClick={onExport}>
          {Icon.pdf}
          {exporting ? '確かめています…' : 'PDFを書き出す'}
        </button>
        <ExportNote snap={snap} config={config} />
        <SourceNotice />
      </footer>
    </aside>
  )
}
