import type { YearConfig } from './types'

/**
 * 年度設定の入力チェック。管理ページで公開する前と、学生のツールが読み込んだときに使う。
 * 戻り値は、問題の説明（なければ空）。
 */
export interface ConfigProblem {
  field: string
  message: string
  /** 'error' は公開できない。'warning' は確認を促すだけ */
  severity: 'error' | 'warning'
}

export function validateConfig(config: YearConfig): ConfigProblem[] {
  const problems: ConfigProblem[] = []
  const error = (field: string, message: string) => problems.push({ field, message, severity: 'error' })
  const warning = (field: string, message: string) => problems.push({ field, message, severity: 'warning' })

  if (!Number.isInteger(config.fiscalYear) || config.fiscalYear < 2000 || config.fiscalYear > 2100) error('fiscalYear', '年度は西暦4桁で入力してください')
  if (!config.commonTitle?.trim()) error('commonTitle', '共通の題目を入力してください')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(config.deadline ?? '')) error('deadline', '最終締切の日付を入力してください')
  for (const [field, label] of [
    ['reportName', '報告書の名前'],
    ['university', '大学名'],
    ['faculty', '学部名'],
    ['department', '学科名'],
  ] as const) {
    if (!config[field]?.trim()) error(field, `${label}を入力してください`)
  }
  if (!config.cover?.heading?.trim()) error('cover.heading', '表紙の見出しを入力してください')
  if (!config.cover?.titleLabel?.trim()) error('cover.titleLabel', '表紙の題目の見出しを入力してください')
  if (!config.abstract?.heading?.trim()) error('abstract.heading', '抄録の見出しを入力してください')

  const a = config.abstract
  if (!(a.minChars > 0 && a.maxChars >= a.minChars)) error('abstract.chars', '抄録の文字数の範囲を確認してください')
  if (!(a.minLines > 0 && a.maxLines >= a.minLines)) error('abstract.lines', '抄録の行数の範囲を確認してください')
  if (!(config.body?.minPages > 0)) error('body.minPages', '本文の最低ページ数を入力してください')
  if (!(config.workPhotos?.maxImages > 0)) error('workPhotos.maxImages', '作品写真の上限を入力してください')
  if (config.studentIdPattern) {
    try {
      new RegExp(config.studentIdPattern)
    } catch {
      error('studentIdPattern', '学籍番号の形式（正規表現）が正しくありません')
    }
  }

  const visible = config.courses.filter((c) => !c.hidden)
  if (visible.length === 0) error('courses', '学生に表示するコースが1つもありません')
  const names = new Map<string, number>()
  config.courses.forEach((c, i) => {
    const field = `courses.${i}`
    if (!c.name.trim()) error(field, `${i + 1}番目のコースの名前を入力してください`)
    names.set(c.name.trim(), (names.get(c.name.trim()) ?? 0) + 1)
    if (!c.subtitleTemplate.includes('{input}')) error(field, `「${c.name || `${i + 1}番目のコース`}」のサブタイトルの形式に、学生が入力する部分（{input}）がありません`)
    if (!c.hidden && c.advisors.filter((x) => x.trim()).length === 0) warning(field, `「${c.name || `${i + 1}番目のコース`}」の指導教員が登録されていません`)
  })
  for (const [name, count] of names) if (name && count > 1) error('courses', `コース名「${name}」が重複しています`)
  return problems
}
