/**
 * セルフチェックの型。
 * - error: 手順書のルール違反。0件にしないと提出用PDFを書き出せない
 * - warning / hint: 手順書にない補助的な注意。提出は妨げない
 */
export type Severity = 'error' | 'warning' | 'hint'

/** guide = 手順書に書かれたルール、supplementary = 手順書にない補助チェック */
export type RuleSource = 'guide' | 'supplementary'

export interface RuleDefinition {
  id: string
  source: RuleSource
  severity: Severity
  title: string
  description: string
  example?: { wrong: string; right: string }
}

/** 指摘箇所。ブロック ID と、その中の文字位置で示す */
export interface FindingLocation {
  section: 'basicInfo' | 'abstract' | 'body' | 'references' | 'workPhotos'
  blockId?: string
  start?: number
  end?: number
}

export interface Finding {
  ruleId: string
  severity: Severity
  message: string
  location: FindingLocation
  /** 自動修正できる場合の置き換え後の文字列 */
  replacement?: string
}
