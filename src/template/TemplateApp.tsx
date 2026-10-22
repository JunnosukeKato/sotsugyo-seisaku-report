import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ReportEditor, type EditorSnapshot } from '../editor/reportEditor'
import type { PageKind } from '../layout/measure'
import { Spinner } from '../app/Busy'
import { Icon } from '../app/icons'
import { Palette, ViewBar } from '../app/Palette'
import { PageColumn } from '../app/SidePanel'
import { TocNotice } from '../app/TocNotice'
import { UndoBar } from '../app/UndoBar'
import { panelStyle } from '../app/usePanelWidths'
import { useUndoNotice } from '../app/useUndoNotice'
import { useNarrow, useWheelPaging } from '../app/uiShared'
import { DEFAULT_TEMPLATE } from '../model/template'
import { inFrame, initPayload, onInit, sendToAdmin } from './bridge'
import { templateBody, templateConfig, templateFromReport, templateIssues, templateReport, usableTemplate, type TemplateIssue, type TemplateResult } from './convert'
import type { InitPayload, TemplateYearStatus } from './protocol'

/**
 * ひな形を作る画面（mockups/v44 案A）。管理ページの上に重ねた窓（iframe）の中で、学生のツールを ?template=1 で開いたもの。
 * 紙面・左の道具は学生と同じ。本文の段落の字は、学生に薄い字で出す「ここに書くこと」になる。
 * 学生の原稿ではないので：ログイン・ドライブ・この端末への保存（自動保存・控え）・PDF・セルフチェックはしない。学生の原稿にも触れない。
 * 原稿はこの画面の中（メモリ）だけに置き、「管理ページに戻して反映」で、ひな形にして管理ページへ渡す（bridge.ts）
 */

const noopSubscribe = () => () => {}
const nullSnapshot = () => null

/** 文字を入力している場所（ここでは ←→ などのキーをページ送りに使わない。App.tsx と同じ） */
const isTyping = (target: EventTarget | null) => !!(target as HTMLElement | null)?.closest?.('.overlay-editor, input, textarea, select, [contenteditable]')

/** ひな形の比べ方（開いたときから直したか） */
const resultKey = (r: TemplateResult) => JSON.stringify([r.template, r.abstractExample])

/** 右の欄の、学生に届くまでのひとこと（年度の状態で変わる。2行に分ける） */
const DELIVERY: Record<TemplateYearStatus, [string, string]> = {
  公開中: ['学生に届くのは、管理ページで', '「保存して学生に反映」を押してから'],
  準備中: ['管理ページで「保存」したあと、', 'この年度を学生に公開すると届きます'],
  終了: ['学生に届くのは、管理ページで', '「保存」を押してから'],
}

/** ひな形に入らないページ（表紙・作品写真）。ページの一覧で薄くし、札を付ける */
const excluded = (kind: PageKind) => kind === 'cover' || kind === 'photos'

/** いちばん上の帯（学生の画面ではないと、ひと目で分かるように） */
function Banner({ courseName }: { courseName: string | null }) {
  return (
    <div className="tpl-banner" role="note">
      {Icon.template}
      <b>{courseName === null ? 'ひな形を作る画面' : `ひな形を作っています：${courseName || '（名前のないコース）'} コース`}</b>
      <span>（学生の画面ではありません）</span>
    </div>
  )
}

export function TemplateApp() {
  const [init, setInit] = useState<InitPayload | null>(initPayload)
  useEffect(() => onInit(setInit), [])
  const narrow = useNarrow()
  // しばらく待っても受け取れない（管理ページから開いていない）ときは、開き方を出す
  const [late, setLate] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setLate(true), 8000)
    return () => clearTimeout(timer)
  }, [])
  return (
    <div className="tpl-mode">
      <Banner courseName={init ? init.courseName : null} />
      {!init ? (
        <div className="tpl-wait" role="status">
          {late || !inFrame() ? (
            <p>
              <b>この画面は、管理ページから開きます</b>
              <span>管理ページのコースの「ひな形を作る画面を開く」を押してください。</span>
            </p>
          ) : (
            <p className="loading-line">
              <Spinner />
              <span>ひな形を受け取っています…</span>
            </p>
          )}
        </div>
      ) : narrow ? (
        // ひな形を作る画面は、パソコンで使う（紙面と道具・右の欄を並べるため）
        <div className="tpl-wait tpl-phone" role="status">
          <p>
            <b>ひな形を作る画面は、パソコンで使います</b>
            <span>画面の広いパソコンで、管理ページから開いてください。</span>
          </p>
          <button className="tpl-sub" onClick={() => sendToAdmin({ type: 'cancel' })}>
            やめる
          </button>
        </div>
      ) : (
        <TemplateScreen init={init} />
      )}
    </div>
  )
}

/**
 * 書いている段落の左の余白の札（「ここに書くこと」・抄録は「書き出しの例」）。
 * 紙面の段落の札（index.css の「ひな形を作る画面」）は、書いている間は段落ごと隠れるので、書く欄の横に同じ札を出す
 */
function EditingTag({ snap, stage }: { snap: EditorSnapshot | null; stage: React.RefObject<HTMLElement | null> }) {
  const kind = snap?.editingKind
  const on = kind === 'paragraph' || kind === 'abstractParagraph'
  const [at, setAt] = useState<string | null>(null)
  useEffect(() => {
    if (!on) return
    // 書く欄は、書くにつれて大きさ・位置が変わる（ページを送る・拡大して動かすなど）ので、少しずつ見直す
    const place = () => {
      const editor = document.querySelector<HTMLElement>('.overlay-editor')
      const r = editor?.getBoundingClientRect()
      const s = stage.current?.getBoundingClientRect()
      const shown = r && s && r.width > 0 && r.top >= s.top && r.top <= s.bottom - 16
      setAt(shown ? `${Math.round(r.left)},${Math.round(r.top)}` : null)
    }
    const frame = requestAnimationFrame(place)
    const timer = window.setInterval(place, 150)
    return () => {
      cancelAnimationFrame(frame)
      clearInterval(timer)
      setAt(null)
    }
  }, [on, snap?.editingId, stage])
  if (!on || !at) return null
  const [left, top] = at.split(',').map(Number)
  return (
    <div className="tpl-editing-tag" style={{ left, top }} aria-hidden="true">
      {kind === 'abstractParagraph' ? '書き出しの例' : 'ここに書くこと'}
    </div>
  )
}

function TemplateScreen({ init }: { init: InitPayload }) {
  const stageRef = useRef<HTMLElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const [editor, setEditor] = useState<ReportEditor | null>(null)
  const snap = useSyncExternalStore(editor?.subscribe ?? noopSubscribe, editor?.getSnapshot ?? nullSnapshot) as EditorSnapshot | null
  const config = useMemo(() => templateConfig(init), [init])
  /** 開いたときのひな形（直したかを比べる） */
  const startKey = useRef('')
  const dirty = useRef(false)
  /** 直してもらうこと（「管理ページに戻して反映」を押すまでは null） */
  const [issues, setIssues] = useState<TemplateIssue[] | null>(null)
  /** 管理ページへ送った（管理ページが窓を閉じるまで、ボタンに「戻しています…」） */
  const [sent, setSent] = useState(false)
  /** 「標準のひな形に戻す」を確かめている */
  const [askReset, setAskReset] = useState(false)
  const [tocPoint, setTocPoint] = useState<{ x: number; y: number } | null>(null)
  const undoNotice = useUndoNotice(snap)
  useWheelPaging(stageRef, scrollerRef, editor, !askReset)

  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    const report = templateReport(config, init.courseId, usableTemplate(init.template), init.abstractExample)
    startKey.current = resultKey(templateFromReport(report))
    const ed: ReportEditor = new ReportEditor(
      stageRef.current!,
      scrollerRef.current!,
      layerRef.current!,
      config,
      report,
      {
        // 保存はしない。開いたときから直したかだけを、管理ページに知らせる（「やめる」「×」で確かめるため）
        onChange: (r) => {
          const result = templateFromReport(r)
          const now = resultKey(result) !== startKey.current
          if (now !== dirty.current) {
            dirty.current = now
            sendToAdmin({ type: 'dirty', dirty: now })
          }
          // 直すところを出しているときは、直したら出し直す（全部直したら消える）
          setIssues((shown) => (shown ? templateIssues(result) : shown))
        },
        onCourseClick: () => ed.showNotice('コースは、管理ページで開いたコースです'),
        onReferencesClick: () => {},
        onTocClick: (point) => setTocPoint(point),
        pickImage: async () => null,
        pickImages: async () => [],
      },
      { template: true },
    )
    setEditor(ed)
    // 自動テストから操作できるようにする（開発サーバーと、自動テスト用にまとめた版 vite build --mode e2e。公開する版では入らない）
    if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') Object.assign(window, { __editor: ed })
    void (async () => {
      await ed.renderFirst(0)
      // 本文の最初のページから（表紙・抄録はひな形にほとんど入らないため）。はじめはページ全体を見せる（前は拡大で開いていた。依頼者の希望 2026-10-22）
      const body = ed.pageOfArea('body')
      if (body >= 0) await ed.goToPage(body, 'none')
    })()
  }, [config, init])

  // キーボード：Ctrl+Z・Ctrl+Y（入力欄の外）、←→・PageUp／PageDown でページを送る、選んだ図・表・改ページを Delete で消す（学生のツールと同じ）
  useEffect(() => {
    if (!editor) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase()
        const redo = (key === 'z' && e.shiftKey) || (key === 'y' && e.ctrlKey && !e.shiftKey)
        if (redo && !isTyping(e.target)) {
          e.preventDefault()
          editor.redo()
        } else if (key === 'z' && !e.shiftKey && !isTyping(e.target)) {
          e.preventDefault()
          editor.undo()
        } else if (e.key === 's') {
          e.preventDefault()
        } else if (key === 'x' && !e.shiftKey && !e.altKey && !isTyping(e.target) && editor.cutSelection()) {
          e.preventDefault()
        }
        return
      }
      if (askReset || isTyping(e.target) || e.altKey) return
      if (e.shiftKey && /^(Arrow|Page|Home|End)/.test(e.key) && editor.hasPaperSelection()) return
      if (e.target instanceof Element && e.target.closest('[aria-modal="true"], .tpl-side')) return
      const paging = ['ArrowRight', 'PageDown', 'ArrowLeft', 'PageUp'].includes(e.key)
      if (paging && e.repeat && editor.getSnapshot().turning) {
        e.preventDefault()
        return
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        editor.nextPage()
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        editor.prevPage()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (editor.deleteSelection()) {
          e.preventDefault()
          return
        }
        const sel = editor.getSnapshot().selection
        if (!sel || sel.kind === 'photos') return
        e.preventDefault()
        editor.removeSelected()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editor, askReset])

  /** 「管理ページに戻して反映」：書いている欄を確かめ、直すところがなければ、ひな形にして管理ページへ送る */
  const apply = () => {
    if (!editor || sent) return
    editor.commitEditing()
    const result = templateFromReport(editor.getSnapshot().report)
    const found = templateIssues(result)
    setIssues(found)
    if (found.length > 0) return
    setSent(true)
    sendToAdmin({ type: 'apply', template: result.template, abstractExample: result.abstractExample })
    // 管理ページがふつうは窓を閉じる。閉じなかったとき（受け取れなかった）は、もう一度押せるように戻す
    window.setTimeout(() => setSent(false), 4000)
  }
  /** 「やめる」：書いている欄を確かめてから（直したかを正しく知らせて）、管理ページに閉じてもらう（直していれば、管理ページが確かめる） */
  const cancel = () => {
    editor?.commitEditing()
    sendToAdmin({ type: 'cancel' })
  }
  /** 「標準のひな形に戻す」（本文だけ。抄録の書き出し例はそのまま。「元に戻す」で戻せる） */
  const reset = () => {
    setAskReset(false)
    if (!editor) return
    editor.update((r) => ({ ...r, body: templateBody(DEFAULT_TEMPLATE) }))
    editor.showNotice('標準のひな形に戻しました（「元に戻す」で戻せます）')
    const body = editor.pageOfArea('body')
    if (body >= 0) void editor.goToPage(body, 'none')
  }
  /** 直すところを押した：その欄へ移って書き始める（改ページは、そのページへ移って選ぶ。道具の「削除」で消せる） */
  const jump = (issue: TemplateIssue) => {
    if (!editor || !issue.id) return
    const brk = editor.getSnapshot().report.body.flatMap((c) => c.blocks).find((b) => b.id === issue.id && b.type === 'pageBreak')
    if (!brk) return editor.openWhenReady(issue.id, 0)
    editor.finishEditing()
    void editor.goToPage(editor.pageOfBlock(brk.id), 'none').then(() => editor.select({ kind: 'pageBreak', id: brk.id }))
  }

  const ready = editor && snap
  const kind = snap?.layout?.kinds[snap.page]
  // 表紙・作品写真のページ（ひな形に入らない）：紙面を薄くし、真ん中に札を出す（見開きのときは出さない）
  const off = !!snap && !snap.spread && (kind === 'cover' || kind === 'photos')
  const [l1, l2] = DELIVERY[init.status]
  return (
    <div className="app tpl-app" style={panelStyle()}>
      {ready ? <PageColumn editor={editor} snap={snap} excluded={excluded} /> : <aside className="thumbs-col" />}
      <main className={`stage${off ? ' tpl-off' : ''}`} ref={stageRef}>
        <div className="page-scroller" ref={scrollerRef} />
        <div id="overlay-layer" ref={layerRef} />
        {ready && snap.layout && <TocNotice editor={editor} snap={snap} point={tocPoint} onClose={() => setTocPoint(null)} />}
        {ready && snap.layout && (
          <>
            <Palette editor={editor} snap={snap} onReferences={() => {}} template />
            <button className="arrow prev" aria-label="前のページ" title="前のページ（←）" disabled={(snap.spread ? snap.page - (snap.page % 2) : snap.page) <= 0} onClick={() => editor.prevPage()}>
              {Icon.prev}
            </button>
            <button className="arrow next" aria-label="次のページ" title="次のページ（→）" disabled={(snap.spread ? snap.page - (snap.page % 2) + 1 : snap.page) >= snap.pageCount - 1} onClick={() => editor.nextPage()}>
              {Icon.next}
            </button>
            <ViewBar editor={editor} snap={snap} />
            <UndoBar editor={editor} notice={undoNotice.notice} onClose={undoNotice.close} className="on-stage" />
            {off && (
              <div className="tpl-off-note" role="note">
                <b>{kind === 'cover' ? '表紙は、学生が書きます' : '作品写真は、学生が入れます'}</b>
                <span>ひな形には入りません（見るだけ）</span>
              </div>
            )}
          </>
        )}
        {(!snap || (snap.rendering && !snap.layout)) && (
          <div className="loading" role="status">
            <span className="loading-line">
              <Spinner />
              <span>紙面を準備しています…</span>
            </span>
          </div>
        )}
      </main>
      <aside className="side tpl-side" aria-label="このコースのひな形">
        <header className="side-head">
          <div className="brand-row">
            <span className="mark">卒</span>
            <div className="brand-text">
              <div className="brand-name">{config.reportName}</div>
              <div className="brand-sub">{config.fiscalYear}年度</div>
            </div>
          </div>
        </header>
        <section className="tpl-panel">
          <h2>
            {Icon.template}
            このコースのひな形
          </h2>
          <p className="tpl-course">{init.courseName || '（名前のないコース）'} コース</p>
          <ul className="tpl-points">
            <li>学生と同じように、紙面に書きます</li>
            <li>本文の字は、学生には薄い字で出ます</li>
            <li>表紙・作品写真は、ひな形に入りません</li>
          </ul>
          {issues && issues.length > 0 && (
            <div className="tpl-issues" role="alert">
              <b>直してから、もう一度押してください</b>
              <ul>
                {issues.map((issue, i) => (
                  <li key={`${issue.id}-${i}`}>
                    {issue.id ? (
                      <button type="button" onClick={() => jump(issue)}>
                        {issue.text}
                      </button>
                    ) : (
                      <span>{issue.text}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="spacer" />
          <div className="tpl-foot">
            <button className="tpl-primary" disabled={!ready || sent} aria-busy={sent} onClick={apply}>
              {sent ? <Spinner /> : Icon.back}
              {sent ? '管理ページに戻しています…' : '管理ページに戻して反映'}
            </button>
            <button className="tpl-sub" onClick={cancel}>
              やめる
            </button>
            <p className="tpl-note">
              <span>{l1}</span>
              <span>{l2}</span>
            </p>
            {askReset ? (
              <div className="tpl-reset-ask" role="group" aria-label="標準のひな形に戻すか">
                <span>本文を、標準のひな形（企画・立案／制作過程／まとめ）に戻しますか？</span>
                <span className="btns">
                  <button className="tpl-sub sm" onClick={() => setAskReset(false)}>
                    やめる
                  </button>
                  <button className="tpl-danger sm" onClick={reset}>
                    戻す
                  </button>
                </span>
              </div>
            ) : (
              <button className="tpl-link" disabled={!ready} onClick={() => setAskReset(true)}>
                標準のひな形に戻す
              </button>
            )}
          </div>
        </section>
      </aside>
      <EditingTag snap={snap} stage={stageRef} />
    </div>
  )
}
