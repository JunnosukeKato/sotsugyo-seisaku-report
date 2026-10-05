import { useEffect, useRef } from 'react'
import type { YearConfig } from '../config'
import { abstractCharCount, type ReportFinding } from '../checker/reportChecks'
import type { EditorSnapshot, ReportEditor } from '../editor/reportEditor'
import type { PageKind } from '../layout/measure'
import { Icon } from './icons'
import { AREA_LABELS, AREA_ORDER, daysUntil, formatDeadline } from './labels'
import type { SaveState } from './useAutosave'

/**
 * 右の欄。上から：名前・保存のようす・締切・手順書とバックアップ／学科からのお知らせ／ページ一覧／セルフチェック／PDFの書き出し
 */

interface Props {
  editor: ReportEditor
  snap: EditorSnapshot
  config: YearConfig
  saveState: SaveState
  onBackup: () => void
  onExport: () => void
}

function SaveChip({ state }: { state: SaveState }) {
  const title = '原稿はこのブラウザに自動で保存されます'
  if (state.status === 'saving') return <span className="chip saved" title={title}><i className="dot busy" />保存しています…</span>
  if (state.status === 'error') return <span className="chip saved ng" title={state.message}><i className="dot ng" />保存できません。バックアップを保存してください</span>
  const at = state.status === 'saved' ? ` ${state.at.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}` : ''
  return <span className="chip saved" title={title}><i className="dot" />自動保存{at}</span>
}

function DeadlineChip({ deadline }: { deadline: string }) {
  const days = daysUntil(deadline)
  const title = `最終締切 ${formatDeadline(deadline)}`
  if (days < 0) return <span className="chip deadline ng" title={title}>締切を過ぎています</span>
  return <span className="chip deadline" title={title}>締切まで <b>{days}</b> 日</span>
}

const SHORT_NAMES: Record<PageKind, string> = { cover: '表紙', abstract: '抄録', toc: '目次', body: '本文', references: '参考文献', photos: '作品写真', unknown: '' }

/** ページ一覧。紙面を縮小した本物の見た目を出し、エラーのあるページに赤い点を付ける */
function PageThumbs({ editor, snap }: { editor: ReportEditor; snap: EditorSnapshot }) {
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

  return (
    <div className="thumb-list" ref={ref}>
      {names.map((name, i) => (
        <button key={i} className={`t${i === snap.page ? ' on' : ''}${errorPages.has(i) ? ' has-error' : ''}`} title={`${name}（${i + 1}ページ目）`} onClick={() => void editor.goToPage(i)}>
          <span className="mini" />
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

function Issue({ finding, editor }: { finding: ReportFinding; editor: ReportEditor }) {
  return (
    <li
      className={`issue ${finding.severity}`}
      onClick={() => void editor.goToFinding(finding)}
      onMouseEnter={() => editor.focusFinding(finding)}
      onMouseLeave={() => editor.focusFinding(null)}
    >
      <i className="dot" />
      <div>
        <div className="ttl">
          {finding.title}
          <span className="src">{finding.source === 'guide' ? '手順書' : '補助'}</span>
        </div>
        {finding.detail && <div className="detail">{finding.detail}</div>}
      </div>
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

export function SidePanel({ editor, snap, config, saveState, onBackup, onExport }: Props) {
  const { findings, layout, report } = snap
  const errors = findings.filter((f) => f.severity === 'error').length
  const chars = abstractCharCount(report)
  const { minChars, maxChars, minLines, maxLines } = config.abstract
  const bodyPages = layout?.bodyPages ?? 0
  const figures = report.body.flatMap((c) => c.blocks).reduce((n, b) => n + (b.type === 'figureRow' ? b.figures.length : 0), 0)
  const figureMax = Math.max(1, bodyPages * config.body.imagesPerPageGuide)

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
          <SaveChip state={saveState} />
          <DeadlineChip deadline={config.deadline} />
        </div>
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
      </header>

      {config.notice?.trim() && (
        <div className="notice">
          <b>学科からのお知らせ</b>
          <p>{config.notice}</p>
        </div>
      )}

      <section className="sec pages">
        <div className="sec-h">
          <span>ページ</span>
          {snap.pageCount > 0 && (
            <span className="pcount">
              <b>{snap.page + 1}</b> / {snap.pageCount}
            </span>
          )}
        </div>
        <PageThumbs editor={editor} snap={snap} />
      </section>

      <section className="sec check">
        <div className="sec-h">
          <span>セルフチェック</span>
          <span className="tally">
            <b className="e">{errors}</b> エラー　<b className="w">{findings.length - errors}</b> 警告
          </span>
        </div>
        <div className="meters">
          <Meter label="本文のページ数" value={`${bodyPages} / ${config.body.minPages}ページ以上`} ok={bodyPages >= config.body.minPages} ratio={bodyPages / config.body.minPages} />
          <Meter label="抄録の文字数" value={`${chars}字（${minChars}〜${maxChars}）`} ok={chars >= minChars && chars <= maxChars} ratio={chars / maxChars} />
          <Meter
            label="抄録の行数"
            value={`${layout?.abstractLines ?? 0}行（${minLines}〜${maxLines}）`}
            ok={!!layout && layout.abstractLines >= minLines && layout.abstractLines <= maxLines}
            ratio={(layout?.abstractLines ?? 0) / maxLines}
          />
          <Meter label="図の枚数" value={`${figures}枚（目安 ${figureMax}枚まで）`} ok={figures <= figureMax} ratio={figures / figureMax} />
        </div>
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
                    <Issue key={`${f.ruleId}-${f.blockId}-${f.start}-${i}`} finding={f} editor={editor} />
                  ))}
                </ul>
              </div>
            )
          })
        )}
      </section>

      <footer className="side-foot">
        <button className="export" disabled={snap.rendering && !snap.layout} onClick={onExport}>
          {Icon.pdf}PDFを書き出す
        </button>
        <p>{errors > 0 ? `エラーが${errors}件あります。0にしてから書き出しましょう` : '提出用のPDFを書き出せます'}</p>
        <SourceNotice />
      </footer>
    </aside>
  )
}
