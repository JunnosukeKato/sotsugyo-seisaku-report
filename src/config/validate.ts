import { COVER_SUBTITLE, textUnits } from '../layout/document'
import type { Course, TemplateBlock, WordCheck, YearConfig } from './types'

/**
 * 年度設定の入力チェック。管理ページで公開する前と、学生のツールが読み込んだときに使う。
 * 戻り値は、問題の説明（なければ空）。設定の形が崩れていても（項目がない・文字でないなど）、例外は出さない。
 */
export interface ConfigProblem {
  field: string
  message: string
  /** 'error' は公開できない。'warning' は確認を促すだけ */
  severity: 'error' | 'warning'
}

/**
 * 文字数・数の上限（管理ページのサーバー gas/admin-project/Code.js の LIMITS と同じ値にする）。
 * tableColumns・tableRows：ひな形の表の列の数と、見出しの下の行の数（学生の表と同じ：model/table.ts の TABLE_SIZE）
 */
export const LIMITS = { blocks: 100, name: 100, hint: 300, abstractExample: 500, notice: 1000, words: 300, word: 50, wordNote: 200, tableColumns: 6, tableRows: 9 }

const BLOCK_LABELS: Record<TemplateBlock['type'], string> = { chapter: '大見出し', subheading: '小見出し', paragraph: '説明', figure: '図の枠', materialTable: '素材表', pageBreak: '改ページ', table: '表' }
const BLOCK_TYPES = new Set<unknown>(Object.keys(BLOCK_LABELS))

const isText = (v: unknown): v is string => typeof v === 'string'
/** 文字で、空白だけでない */
const filled = (v: unknown): v is string => isText(v) && v.trim() !== ''
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** ひな形の部品の、名前（段落は説明）の項目の名前（改ページは名前がない） */
export function templateTextKey(type: TemplateBlock['type']): 'title' | 'hint' | 'caption' | null {
  return type === 'chapter' || type === 'subheading' ? 'title' : type === 'paragraph' ? 'hint' : type === 'pageBreak' ? null : 'caption'
}

/** ひな形の部品の、名前（段落は説明）の文字（改ページは空） */
function blockText(block: TemplateBlock): string {
  const key = templateTextKey(block.type)
  return key ? ((block as Record<string, unknown>)[key] as string) : ''
}

/**
 * ひな形の表の、名前のほかの項目の形の問題（なければ null）。見出しの行（1〜6列の字）・行の数（1〜9）・列の幅などの切り替え
 * （サーバーの cleanTable_ と同じ決まり）
 */
export function templateTableProblem(block: Record<string, unknown>): 'shape' | { header: number; length: number } | null {
  const header = block.header
  if (!Array.isArray(header) || header.length < 1 || header.length > LIMITS.tableColumns || !header.every(isText)) return 'shape'
  const long = header.findIndex((h) => h.length > LIMITS.name)
  if (block.rows !== undefined && !(Number.isInteger(block.rows) && (block.rows as number) >= 1 && (block.rows as number) <= LIMITS.tableRows)) return 'shape'
  if (block.widths !== undefined && block.widths !== 'equal' && block.widths !== 'auto' && block.widths !== 'custom') return 'shape'
  if (block.heights !== undefined && block.heights !== 'equal' && block.heights !== 'auto') return 'shape'
  if (block.labelColumn !== undefined && typeof block.labelColumn !== 'boolean') return 'shape'
  const ws = block.colWidths
  if (ws !== undefined && !(Array.isArray(ws) && ws.length === header.length && ws.every((w) => isNumber(w) && w > 0 && w <= 100))) return 'shape'
  return long >= 0 ? { header: long, length: header[long].length } : null
}

/**
 * ひな形の行の呼び名（例：3行目の説明「デザインの意図を書く…」）。どの行か見つけやすいよう、種類と書き出しを付ける
 * （管理ページのサーバー gas/admin-project/Code.js の rowName_ と同じ言い方）
 */
export function templateRowName(index: number, type: TemplateBlock['type'], text: unknown): string {
  const head = typeof text === 'string' ? text.trim() : ''
  const preview = head ? `「${head.length > 12 ? `${head.slice(0, 12)}…` : head}」` : ''
  return `${index + 1}行目の${BLOCK_LABELS[type]}${preview}`
}

/** 長すぎる文字の説明（例：が長すぎます（300字まで。今は312字）） */
export const tooLong = (max: number, length: number) => `が長すぎます（${max}字まで。今は${length}字）`

/**
 * 下書きのひな形の問題（なければ空。説明の先頭に「…の下書きのひな形」を付けて使う）。
 * 管理ページの入力チェックと、学生のツールで崩れたひな形を使わないために使う（サーバーの cleanTemplate_ と同じ決まり）。
 * 部品の種類は決まったものだけ。大見出し・小見出し・図・表は名前が要る。段落の説明は空でもよいが、文字であること。
 * 改ページは名前がない。ふつうの表は、見出しの行（1〜6列）と行の数などの形も確かめる（templateTableProblem）。
 * いちばん上は大見出し（空のひな形は「標準のひな形を使う」の意味なので、問題にしない）
 */
export function templateProblems(template: unknown): string[] {
  if (!Array.isArray(template)) return ['の形が正しくありません']
  if (template.length > LIMITS.blocks) return [`の部品が多すぎます（${LIMITS.blocks}個まで）`]
  const problems: string[] = []
  const blocks: TemplateBlock[] = []
  template.forEach((block: unknown, i) => {
    if (!isObject(block) || !BLOCK_TYPES.has(block.type)) return problems.push(`の${i + 1}行目の形が正しくありません`)
    const type = block.type as TemplateBlock['type']
    const key = templateTextKey(type)
    if (!key) return blocks.push(block as unknown as TemplateBlock)
    const text = block[key]
    const max = type === 'paragraph' ? LIMITS.hint : LIMITS.name
    const table = type === 'table' ? templateTableProblem(block) : null
    if (!isText(text) || table === 'shape') problems.push(`の${templateRowName(i, type, null)}の形が正しくありません`)
    else if (text.length > max) problems.push(`の${templateRowName(i, type, text)}${tooLong(max, text.length)}`)
    else if (table) problems.push(`の${templateRowName(i, type, text)}の見出しの${table.header + 1}列目${tooLong(LIMITS.name, table.length)}`)
    else blocks.push(block as unknown as TemplateBlock)
  })
  if (problems.length) return problems
  // 部品の形が正しいときだけ、並びと名前を確かめる
  if (blocks.length > 0 && blocks[0].type !== 'chapter') problems.push('は、大見出しから始めてください')
  if (blocks.length > 0 && !blocks.some((b) => b.type === 'chapter')) problems.push('に大見出しがありません')
  const blank = blocks.find((b) => b.type !== 'paragraph' && b.type !== 'pageBreak' && !blockText(b).trim())
  if (blank) problems.push(`に、名前が空の${BLOCK_LABELS[blank.type]}があります`)
  return problems
}

/** 文字の項目の問題（任意の項目。ないときは問題にしない） */
function optionalTextProblem(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null
  if (!isText(value)) return 'の形が正しくありません'
  if (value.length > max) return tooLong(max, value.length)
  return null
}

/** 書き間違えやすい語の1行の形の問題（空の欄は、ここでは問題にしない） */
function wordShapeProblem(w: unknown): string | null {
  if (!isObject(w)) return 'の形が正しくありません'
  for (const [key, max] of [
    ['wrong', LIMITS.word],
    ['right', LIMITS.word],
    ['note', LIMITS.wordNote],
  ] as const) {
    const problem = optionalTextProblem(w[key], max)
    if (problem) return problem
  }
  if (w.severity !== 'error' && w.severity !== 'warning') return 'の重さが正しくありません'
  return null
}

/** コースの名前（問題の説明に使う） */
function courseLabel(c: unknown, i: number): string {
  return isObject(c) && filled(c.name) ? c.name : `${i + 1}番目のコース`
}

/** 実在する日付か（YYYY-MM-DD。2027-02-30 や、年が6桁の 202801-12-20 などは違う） */
export function isRealDate(value: unknown): value is string {
  const m = isText(value) ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null
  if (!m) return false
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return date.getUTCFullYear() === Number(m[1]) && date.getUTCMonth() === Number(m[2]) - 1 && date.getUTCDate() === Number(m[3])
}

/** 「2027-01-20」→「2027年1月20日」 */
const japaneseDate = (ymd: string) => ymd.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, y: string, m: string, d: string) => `${y}年${Number(m)}月${Number(d)}日`)

/**
 * 表紙の題目の1行に入る字数の目安（全角を1、半角を0.5として数える）。表紙の題目は、サブタイトルと同じ幅144.2mm・22pt で、
 * 小さくせずに1行で組む（src/layout/documentCss.ts の .cover .title）。全角の字（漢字）は 22pt の幅なので、18.6字分をこえると入らない
 */
export const COVER_TITLE_UNITS = COVER_SUBTITLE.widthMm / ((COVER_SUBTITLE.maxPt * 25.4) / 72)

export interface ValidateOptions {
  /**
   * 今日の日付（YYYY-MM-DD）。渡したときだけ、最終締切が今日より前なら確認を出す（管理ページだけが渡す。
   * 学生のツールが設定を読み込むときは渡さない。日によって結果が変わらないように）
   */
  today?: string
}

export function validateConfig(config: YearConfig, options: ValidateOptions = {}): ConfigProblem[] {
  const problems: ConfigProblem[] = []
  const error = (field: string, message: string) => problems.push({ field, message, severity: 'error' })
  const warning = (field: string, message: string) => problems.push({ field, message, severity: 'warning' })
  if (!isObject(config)) {
    error('config', '設定の形が正しくありません')
    return problems
  }

  if (!Number.isInteger(config.fiscalYear) || config.fiscalYear < 2000 || config.fiscalYear > 2100) error('fiscalYear', '年度は西暦4桁で入力してください')
  if (!filled(config.commonTitle)) error('commonTitle', '共通の題目を入力してください')
  else if (textUnits(config.commonTitle) > COVER_TITLE_UNITS)
    // 字数からの見積もり（かな・かっこは漢字より少し細いので、目安をこえても入ることがある。見本で確かめてもらう）
    warning('commonTitle', `共通の題目が長いため、表紙の1行に収まらないおそれがあります（表紙の題目は1行で、全角18字ほどまで。今は${Math.ceil(textUnits(config.commonTitle))}字分）。右の見本の表紙で、はみ出していないか確かめてください`)
  const fiscalYear = Number.isInteger(config.fiscalYear) ? config.fiscalYear : null
  if (!filled(config.deadline)) error('deadline', '最終締切の日付を入力してください')
  else if (!isRealDate(config.deadline)) error('deadline', `最終締切の日付が正しくありません（例：${fiscalYear ? fiscalYear + 1 : 2028}/01/20）`)
  else if (fiscalYear && (config.deadline < `${fiscalYear}-04-01` || config.deadline > `${fiscalYear + 1}-03-31`))
    // 前の年度からコピーした日付のままのことがあるので、年度の期間（4月1日〜翌年3月31日）の外なら確かめてもらう
    warning('deadline', `最終締切（${japaneseDate(config.deadline)}）が、${fiscalYear}年度（${fiscalYear}年4月1日〜${fiscalYear + 1}年3月31日）の外です。前の年度の日付のままでないか確かめてください`)
  else if (options.today && config.deadline < options.today) warning('deadline', `最終締切（${japaneseDate(config.deadline)}）が、今日より前です`)
  for (const [field, label] of [
    ['reportName', '報告書の名前'],
    ['university', '大学名'],
    ['faculty', '学部名'],
    ['department', '学科名'],
  ] as const) {
    if (!filled(config[field])) error(field, `${label}を入力してください`)
  }
  const cover: Partial<YearConfig['cover']> = isObject(config.cover) ? config.cover : {}
  if (!filled(cover.heading)) error('cover.heading', '表紙の見出しを入力してください')
  if (config.wordChecks !== undefined && config.wordChecks !== null && !Array.isArray(config.wordChecks)) error('wordChecks', '書き間違えやすい語の一覧の形が正しくありません')
  else if (Array.isArray(config.wordChecks)) {
    if (config.wordChecks.length > LIMITS.words) error('wordChecks', `書き間違えやすい語が多すぎます（${LIMITS.words}語まで）`)
    for (const [i, w] of config.wordChecks.entries()) {
      const shape = wordShapeProblem(w)
      if (shape) error(`wordChecks.${i}`, `書き間違えやすい語の${i + 1}行目${shape}`)
      else if (!filled(w.wrong) || !filled(w.right)) warning(`wordChecks.${i}`, `書き間違えやすい語の${i + 1}行目に空の欄があります（その行は使いません）`)
      else if (w.wrong.trim() === w.right.trim()) warning(`wordChecks.${i}`, `書き間違えやすい語「${w.wrong}」は、書き間違いと正しい語が同じです`)
    }
  }
  if (!filled(cover.titleLabel)) error('cover.titleLabel', '表紙の題目の見出しを入力してください')
  const a: Partial<YearConfig['abstract']> = isObject(config.abstract) ? config.abstract : {}
  if (!filled(a.heading)) error('abstract.heading', '抄録の見出しを入力してください')

  if (!(isNumber(a.minChars) && isNumber(a.maxChars) && a.minChars > 0 && a.maxChars >= a.minChars)) error('abstract.chars', '抄録の文字数の範囲を確認してください')
  if (!(isNumber(a.minLines) && isNumber(a.maxLines) && a.minLines > 0 && a.maxLines >= a.minLines)) error('abstract.lines', '抄録の行数の範囲を確認してください')
  const body: Partial<YearConfig['body']> = isObject(config.body) ? config.body : {}
  if (!(isNumber(body.minPages) && body.minPages > 0)) error('body.minPages', '本文の最低ページ数を入力してください')
  const photos: Partial<YearConfig['workPhotos']> = isObject(config.workPhotos) ? config.workPhotos : {}
  // 作品写真のページ数の上限：空（null）は上限なし。入れるなら1以上の整数
  if (!(photos.maxPages === null || photos.maxPages === undefined || (isNumber(photos.maxPages) && Number.isInteger(photos.maxPages) && photos.maxPages > 0)))
    error('workPhotos.maxPages', '作品写真のページ数の上限は、1以上の整数にしてください（空にすると上限なし）')
  if (config.studentIdPattern !== null && config.studentIdPattern !== undefined) {
    try {
      if (!isText(config.studentIdPattern)) throw new Error()
      if (config.studentIdPattern) new RegExp(config.studentIdPattern)
    } catch {
      error('studentIdPattern', '学籍番号の形式（正規表現）が正しくありません')
    }
  }

  if (!Array.isArray(config.courses)) {
    error('courses', 'コースの一覧の形が正しくありません')
    return problems
  }
  const visible = config.courses.filter((c) => isObject(c) && !c.hidden)
  if (visible.length === 0) error('courses', '学生に表示するコースが1つもありません')
  const names = new Map<string, number>()
  config.courses.forEach((c: unknown, i) => {
    const field = `courses.${i}`
    const label = `「${courseLabel(c, i)}」`
    if (!isObject(c) || !filled(c.id) || !isText(c.name) || !isText(c.subtitleTemplate) || !Array.isArray(c.advisors) || c.advisors.some((x) => !isText(x))) {
      error(field, `${i + 1}番目のコースの形が正しくありません`)
      return
    }
    const course = c as unknown as Course
    if (!course.name.trim()) error(field, `${i + 1}番目のコースの名前を入力してください`)
    names.set(course.name.trim(), (names.get(course.name.trim()) ?? 0) + 1)
    if (!course.subtitleTemplate.includes('{input}')) error(field, `${label}のサブタイトルの形式に、学生が入力する部分（{input}）がありません`)
    const advisors = course.advisors.filter((x) => x.trim())
    if (!course.hidden && advisors.length === 0) warning(field, `${label}の指導教員が登録されていません`)
    // 抄録の見出しは、学籍番号・氏名と指導教員を1行に収める（3名までを想定）
    if (advisors.length > 3) warning(field, `${label}の指導教員が4名以上です。抄録の見出しの1行に収めるため、文字が小さくなります`)
    for (const problem of courseProblems(course)) error(field, `${label}${problem}`)
  })
  for (const [name, count] of names) if (name && count > 1) error('courses', `コース名「${name}」が重複しています`)
  return problems
}

/**
 * コースの中だけの問題（下書きのひな形・抄録の書き出し例・お知らせ）。学生のツールでは、
 * 問題のある項目だけを使わずに（ひな形は標準のひな形にして）、ほかのコースや設定はそのまま使う
 */
function courseProblems(course: Course): string[] {
  const problems: string[] = []
  // 下書きのひな形（ないときは標準のひな形を使うので、なくてもよい）
  if (course.template !== undefined && course.template !== null) problems.push(...templateProblems(course.template).map((p) => `の下書きのひな形${p}`))
  const example = optionalTextProblem(course.abstractExample, LIMITS.abstractExample)
  if (example) problems.push(`の抄録の書き出し例${example}`)
  const notice = optionalTextProblem(course.notice, LIMITS.notice)
  if (notice) problems.push(`のお知らせ${notice}`)
  return problems
}

/**
 * 学生のツールで使うために、設定のうち崩れた部分だけを外す（設定全体は捨てない）。
 *   - コースの下書きのひな形が崩れていたら、そのコースは標準のひな形にする
 *   - 抄録の書き出し例・お知らせが崩れていたら、出さない
 *   - 書き間違えやすい語は、形の崩れた行だけを外す（一覧そのものが崩れていたら、ツールに入っている一覧を使う）
 *   - 作品写真のページ数の上限がない（前の版の設定。枚数の上限 maxImages は使わない）・崩れていたら、上限なし
 * それ以外の問題（題目がないなど）は直さない（validateConfig でエラーになり、前に読み込んだ設定か初期値を使う）
 */
export function repairConfig(config: YearConfig): YearConfig {
  if (!isObject(config)) return config
  const courses = Array.isArray(config.courses)
    ? config.courses.map((c: unknown) => {
        if (!isObject(c)) return c as Course
        const course = { ...c } as unknown as Course
        if (course.template !== undefined && course.template !== null && templateProblems(course.template).length > 0) delete course.template
        if (optionalTextProblem(course.abstractExample, LIMITS.abstractExample)) delete course.abstractExample
        if (optionalTextProblem(course.notice, LIMITS.notice)) delete course.notice
        return course
      })
    : config.courses
  const words: unknown = config.wordChecks
  const wordChecks = words === undefined || words === null ? undefined : Array.isArray(words) ? (words.slice(0, LIMITS.words).filter((w) => !wordShapeProblem(w)) as WordCheck[]) : undefined
  const repaired: YearConfig = { ...config, courses }
  // 作品写真：前の版の設定の枚数の上限（maxImages）は使わない。ページ数の上限がない・崩れているときは、上限なし（mockups/v38：依頼者の判断）
  const maxPages: unknown = isObject(config.workPhotos) ? config.workPhotos.maxPages : undefined
  repaired.workPhotos = { maxPages: isNumber(maxPages) && Number.isInteger(maxPages) && maxPages > 0 ? maxPages : null }
  if (wordChecks) repaired.wordChecks = wordChecks
  else delete repaired.wordChecks
  return repaired
}
