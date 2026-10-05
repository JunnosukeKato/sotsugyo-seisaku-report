import type { YearConfig } from '../config'
import { abstractCharCount, type ReportFinding } from '../checker/reportChecks'
import type { EditorSnapshot, ReportEditor } from '../editor/reportEditor'
import { AREA_LABELS, AREA_ORDER } from './labels'

interface Props {
  editor: ReportEditor
  snap: EditorSnapshot
  config: YearConfig
}

function Meter({ label, value, ok, ratio }: { label: string; value: string; ok: boolean; ratio: number }) {
  return (
    <div className="meter">
      <div className="row">
        <span>{label}</span>
        <b className={ok ? 'ok' : 'ng'}>{value}</b>
      </div>
      <div className="bar">
        <i className={ok ? 'ok' : ''} style={{ width: `${Math.max(2, Math.min(100, ratio * 100))}%` }} />
      </div>
    </div>
  )
}

function Issue({ finding, editor }: { finding: ReportFinding; editor: ReportEditor }) {
  return (
    <div
      className={`issue ${finding.severity}`}
      onClick={() => editor.goToFinding(finding)}
      onMouseEnter={() => editor.focusFinding(finding)}
      onMouseLeave={() => editor.focusFinding(null)}
    >
      <b>{finding.title}</b>
      <span className="src">{finding.source === 'guide' ? '手順書' : '補助'}</span>
      {finding.detail && <div className="detail">{finding.detail}</div>}
      {finding.replacement !== undefined && (
        <div className="acts">
          <button
            className="fix"
            onClick={(e) => {
              e.stopPropagation()
              editor.applyFinding(finding)
            }}
          >
            修正する
          </button>
        </div>
      )}
    </div>
  )
}

export function CheckPanel({ editor, snap, config }: Props) {
  const { findings, layout, report } = snap
  const errors = findings.filter((f) => f.severity === 'error').length
  const chars = abstractCharCount(report)
  const { minChars, maxChars, minLines, maxLines } = config.abstract
  const bodyPages = layout?.bodyPages ?? 0
  const figures = report.body.flatMap((c) => c.blocks).reduce((n, b) => n + (b.type === 'figureRow' ? b.figures.length : 0), 0)
  const figureMax = Math.max(1, bodyPages * config.body.imagesPerPageGuide)

  return (
    <aside className="check-panel">
      {config.notice?.trim() && (
        <div className="notice">
          <b>学科からのお知らせ</b>
          <p>{config.notice}</p>
        </div>
      )}
      <h2>セルフチェック</h2>
      <div className="counts">
        <div className="count e">
          <b>{errors}</b>エラー
        </div>
        <div className="count w">
          <b>{findings.length - errors}</b>警告
        </div>
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
            <section key={area} className="issue-group">
              <h3>
                {AREA_LABELS[area]}
                <span>{items.length}件</span>
              </h3>
              {items.map((f, i) => (
                <Issue key={`${f.ruleId}-${f.blockId}-${f.start}-${i}`} finding={f} editor={editor} />
              ))}
            </section>
          )
        })
      )}
    </aside>
  )
}
