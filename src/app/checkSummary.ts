import type { YearConfig } from '../config'
import { notYetCount, progressRows, splitFindings, type ProgressTarget } from '../checker/progress'
import type { EditorSnapshot, ReportEditor } from '../editor/reportEditor'

/**
 * セルフチェックの指摘を分けたもの（mockups/v35 ① 案A。checker/progress.ts）：まだのところの行（rows）と数（notYet）、
 * 直すところ（fixes。書いた文の間違い）と、そのうちのエラーの数（errors。スマホの「チェック」の赤い数）。
 * 右の欄・スマホの「チェック」の欄（SidePanel.tsx の CheckBody・Tally・ExportNote）と、スマホの下のタブ（Phone.tsx）、
 * 「PDFを書き出す」の窓（ExportDialog.tsx。残っている直すところ・まだのところの一覧）で使う
 */
export function checkSummary(snap: EditorSnapshot, config: YearConfig) {
  const ctx = { report: snap.report, config, layout: snap.layout }
  const { fixes } = splitFindings(snap.findings, ctx)
  const rows = progressRows(snap.findings, ctx, snap.pageChecksPending)
  return { rows, notYet: notYetCount(rows), fixes, errors: fixes.filter((f) => f.severity === 'error').length }
}

/** まだのところの行を押したとき：その指摘の箇所へ（文字の欄なら書き始める）、またはそのページへ（右の欄と「PDFを書き出す」の窓の一覧） */
export function goToTarget(editor: ReportEditor, target: ProgressTarget): void {
  if (target.kind === 'finding') {
    void editor.goToFinding(target.finding)
    return
  }
  const kinds = editor.getSnapshot().layout?.kinds ?? []
  const index = target.last ? kinds.lastIndexOf(target.area) : kinds.indexOf(target.area)
  if (index >= 0) void editor.goToPage(index, 'fade')
}
