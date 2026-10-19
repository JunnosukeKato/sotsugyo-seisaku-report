import type { YearConfig } from '../config'
import { notYetCount, progressRows, splitFindings } from '../checker/progress'
import type { EditorSnapshot } from '../editor/reportEditor'

/**
 * セルフチェックの指摘を分けたもの（mockups/v35 ① 案A。checker/progress.ts）：まだのところの行（rows）と数（notYet）、
 * 直すところ（fixes。書いた文の間違い）と、そのうちのエラーの数（errors。スマホの「チェック」の赤い数）。
 * 右の欄・スマホの「チェック」の欄（SidePanel.tsx の CheckBody・Tally・ExportNote）と、スマホの下のタブ（Phone.tsx）で使う
 */
export function checkSummary(snap: EditorSnapshot, config: YearConfig) {
  const ctx = { report: snap.report, config, layout: snap.layout }
  const { fixes } = splitFindings(snap.findings, ctx)
  const rows = progressRows(snap.findings, ctx, snap.pageChecksPending)
  return { rows, notYet: notYetCount(rows), fixes, errors: fixes.filter((f) => f.severity === 'error').length }
}
