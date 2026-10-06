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

/** 文字数・数の上限（管理ページのサーバー gas/admin-project/Code.js の LIMITS と同じ値にする） */
export const LIMITS = { blocks: 100, name: 100, hint: 300, abstractExample: 500, notice: 1000, words: 300, word: 50, wordNote: 200 }

const BLOCK_LABELS: Record<TemplateBlock['type'], string> = { chapter: '大見出し', subheading: '小見出し', paragraph: '説明', figure: '図', materialTable: '素材表' }
const BLOCK_TYPES = new Set<unknown>(Object.keys(BLOCK_LABELS))

const isText = (v: unknown): v is string => typeof v === 'string'
/** 文字で、空白だけでない */
const filled = (v: unknown): v is string => isText(v) && v.trim() !== ''
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** ひな形の部品の、名前（段落は説明）の文字 */
function blockText(block: TemplateBlock): string {
  return block.type === 'chapter' || block.type === 'subheading' ? block.title : block.type === 'paragraph' ? block.hint : block.caption
}

/**
 * 下書きのひな形の問題（なければ空。説明の先頭に「…の下書きのひな形」を付けて使う）。
 * 管理ページの入力チェックと、学生のツールで崩れたひな形を使わないために使う（サーバーの cleanTemplate_ と同じ決まり）。
 * 部品の種類は決まったものだけ。大見出し・小見出し・図・表は名前が要る。段落の説明は空でもよいが、文字であること。
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
    const text = block[type === 'chapter' || type === 'subheading' ? 'title' : type === 'paragraph' ? 'hint' : 'caption']
    const max = type === 'paragraph' ? LIMITS.hint : LIMITS.name
    if (!isText(text)) problems.push(`の${i + 1}行目の形が正しくありません`)
    else if (text.length > max) problems.push(`の${i + 1}行目が長すぎます（${max}字まで）`)
    else blocks.push(block as unknown as TemplateBlock)
  })
  if (problems.length) return problems
  // 部品の形が正しいときだけ、並びと名前を確かめる
  if (blocks.length > 0 && blocks[0].type !== 'chapter') problems.push('は、大見出しから始めてください')
  if (blocks.length > 0 && !blocks.some((b) => b.type === 'chapter')) problems.push('に大見出しがありません')
  const blank = blocks.find((b) => b.type !== 'paragraph' && !blockText(b).trim())
  if (blank) problems.push(`に、名前が空の${BLOCK_LABELS[blank.type]}があります`)
  return problems
}

/** 文字の項目の問題（任意の項目。ないときは問題にしない） */
function optionalTextProblem(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null
  if (!isText(value)) return 'の形が正しくありません'
  if (value.length > max) return `が長すぎます（${max}字まで）`
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

export function validateConfig(config: YearConfig): ConfigProblem[] {
  const problems: ConfigProblem[] = []
  const error = (field: string, message: string) => problems.push({ field, message, severity: 'error' })
  const warning = (field: string, message: string) => problems.push({ field, message, severity: 'warning' })
  if (!isObject(config)) {
    error('config', '設定の形が正しくありません')
    return problems
  }

  if (!Number.isInteger(config.fiscalYear) || config.fiscalYear < 2000 || config.fiscalYear > 2100) error('fiscalYear', '年度は西暦4桁で入力してください')
  if (!filled(config.commonTitle)) error('commonTitle', '共通の題目を入力してください')
  if (!isText(config.deadline) || !/^\d{4}-\d{2}-\d{2}$/.test(config.deadline)) error('deadline', '最終締切の日付を入力してください')
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
  if (!(isNumber(photos.maxImages) && photos.maxImages > 0)) error('workPhotos.maxImages', '作品写真の上限を入力してください')
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
  if (wordChecks) repaired.wordChecks = wordChecks
  else delete repaired.wordChecks
  return repaired
}
