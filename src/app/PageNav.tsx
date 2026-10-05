import type { EditorSnapshot, ReportEditor } from '../editor/reportEditor'
import { pageLabels } from './labels'

interface Props {
  editor: ReportEditor
  snap: EditorSnapshot
}

export function PageNav({ editor, snap }: Props) {
  const kinds = snap.layout?.kinds ?? []
  const labels = pageLabels(kinds)
  const errorsByArea = new Map<string, number>()
  for (const f of snap.findings) if (f.severity === 'error') errorsByArea.set(f.area, (errorsByArea.get(f.area) ?? 0) + 1)
  return (
    <nav className="page-nav">
      <h3>ページ</h3>
      {kinds.map((kind, i) => {
        // 指摘の件数は、その種類の最初のページにまとめて表示する
        const first = kinds.indexOf(kind) === i
        const errors = first ? (errorsByArea.get(kind) ?? 0) : 0
        return (
          <div key={i} className={`thumb ${kind}`} onClick={() => editor.scrollToPage(i)}>
            <span className="mini" />
            {labels[i]}
            {errors > 0 && <span className="badge">{errors}</span>}
          </div>
        )
      })}
    </nav>
  )
}
