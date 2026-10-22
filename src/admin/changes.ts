import { DEFAULT_WORD_CHECKS } from '../checker/textRules'
import type { Course, YearConfig } from '../config'

/**
 * 年度の設定の「どこが変わったか」。保存の確認・変更履歴の要約・「保存していない変更があります」の判定と、
 * 別のタブ（ほかの人）が先に保存していたときに、自分が変えた項目だけを最新の設定に入れ直すのに使う。
 * 設定を項目に分けて比べる（cover・abstract などの入れ物は中の項目ごと、コースは ID ごとに中の項目ごと）。
 * 意味の同じ書き方（空のお知らせとお知らせなし、「必須」と省略 など）は、同じとみなす
 */

type Obj = Record<string, unknown>
/** 項目の場所（例：['commonTitle']、['abstract', 'minChars']） */
type Path = [string] | [string, string]

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

/** 画面の並び順の項目の名前（1つ目の組：上の欄、2つ目の組：書き間違えやすい語、3つ目の組：詳細設定） */
const TOP_LABELS: [string, string][] = [
  ['commonTitle', '共通の題目'],
  ['deadline', '最終締切'],
  ['handbookUrl', '手順書のリンク'],
]
const WORDS_LABEL: [string, string] = ['wordChecks', '書き間違えやすい語']
const DETAIL_LABELS: [string, string][] = [
  ['driveSave', '学生のドライブ保存'],
  ['reportName', '報告書の名前'],
  ['cover.heading', '表紙の見出し'],
  ['cover.titleLabel', '表紙の題目の見出し'],
  ['abstract.heading', '抄録の見出し'],
  ['abstract.openingExample', '抄録の書き出し例（詳細設定）'],
  ['university', '大学名'],
  ['faculty', '学部名'],
  ['department', '学科名'],
  ['abstract.minChars', '抄録の文字数'],
  ['abstract.maxChars', '抄録の文字数'],
  ['abstract.minLines', '抄録の行数'],
  ['abstract.maxLines', '抄録の行数'],
  ['body.minPages', '本文の最低ページ数'],
  ['body.imagesPerPageGuide', '1ページあたりの画像の目安'],
  ['workPhotos.maxPages', '作品写真のページ数の上限'],
  ['studentIdPattern', '学籍番号の形式'],
  ['fiscalYear', '年度'],
]
const COURSE_LABELS: Record<string, string> = {
  name: '名前',
  hidden: '「学生に表示」',
  subtitleTemplate: 'サブタイトルの形式',
  advisors: '指導教員',
  template: '下書きのひな形',
  abstractExample: '抄録の書き出し例',
  blankRowsOk: '表の空の行',
  notice: 'お知らせ',
}
const OTHER = 'そのほかの設定'

/** コースの名前（「コース」は付けない。名前が空なら「（名前のないコース）」） */
export function courseName(course: { name?: unknown } | undefined): string {
  const name = typeof course?.name === 'string' ? course.name.trim() : ''
  return name || '（名前のないコース）'
}

/** 書き間違えやすい語の一覧（省略はツールに入っている一覧。説明なしは空の説明） */
function words(value: unknown): unknown {
  const list = value === undefined || value === null ? DEFAULT_WORD_CHECKS : value
  return Array.isArray(list) ? list.map((w) => (isObj(w) ? { wrong: w.wrong, right: w.right, note: w.note ?? '', severity: w.severity } : w)) : list
}

/** 年度の項目の、意味の同じ書き方をそろえる */
function normTop(key: string, value: unknown): unknown {
  if (key === 'handbookUrl') return value === '' ? undefined : value
  if (key === 'driveSave') return value === 'required' ? undefined : value
  if (key === 'studentIdPattern') return value === '' || value === undefined ? null : value
  // 前の版の設定の作品写真の枚数の上限は、もう使わない（ページ数の上限 maxPages に変えた。mockups/v38）。比べない
  if (key === 'workPhotos.maxImages') return undefined
  if (key === 'wordChecks') return words(value)
  return value
}

/** コースの項目の、意味の同じ書き方をそろえる（空のお知らせ・書き出し例・ひな形は「ない」と同じ） */
function normCourse(key: string, value: unknown): unknown {
  if (key === 'notice' || key === 'abstractExample') return value === '' ? undefined : value
  if (key === 'hidden' || key === 'blankRowsOk') return value ? true : undefined
  if (key === 'template') return Array.isArray(value) && value.length === 0 ? undefined : value
  return value
}

/** 項目の並びに左右されない文字列（ない・null は同じ） */
function stable(v: unknown): string {
  if (v === undefined || v === null) return 'null'
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (isObj(v))
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(v[k])}`)
      .join(',')}}`
  return JSON.stringify(v)
}

const get = (config: unknown, path: Path): unknown => {
  const first = isObj(config) ? config[path[0]] : undefined
  return path.length === 1 ? first : isObj(first) ? first[path[1]] : undefined
}
const sameTop = (path: Path, a: unknown, b: unknown) => stable(normTop(path.join('.'), get(a, path))) === stable(normTop(path.join('.'), get(b, path)))
const sameCourseKey = (key: string, a: unknown, b: unknown) => stable(normCourse(key, isObj(a) ? a[key] : undefined)) === stable(normCourse(key, isObj(b) ? b[key] : undefined))

/** 比べる項目の一覧（コースを除く）。入れ物（cover・abstract など）は中の項目ごと */
function topPaths(configs: unknown[]): Path[] {
  const keys = new Set<string>()
  configs.forEach((c) => isObj(c) && Object.keys(c).forEach((k) => keys.add(k)))
  const paths: Path[] = []
  for (const key of keys) {
    if (key === 'courses') continue
    const boxes = configs.map((c) => (isObj(c) ? c[key] : undefined)).filter(isObj)
    if (boxes.length) new Set(boxes.flatMap((b) => Object.keys(b))).forEach((sub) => paths.push([key, sub]))
    else paths.push([key])
  }
  return paths
}

const courseList = (config: unknown): Course[] => (isObj(config) && Array.isArray(config.courses) ? (config.courses.filter(isObj) as unknown as Course[]) : [])
/** コースの項目の名前（カードの並び順。知らない項目は後ろ） */
const courseKeys = (...courses: (Course | undefined)[]) => {
  const rank = (k: string) => (k in COURSE_LABELS ? Object.keys(COURSE_LABELS).indexOf(k) : Infinity)
  return [...new Set(courses.flatMap((c) => (c ? Object.keys(c) : [])))].filter((k) => k !== 'id').sort((a, b) => rank(a) - rank(b))
}
const sameCourse = (a: Course, b: Course) => courseKeys(a, b).every((k) => sameCourseKey(k, a, b))
const order = (list: Course[]) => list.map((c) => c.id).join('\n')
const topLabel = (path: Path) => [...TOP_LABELS, WORDS_LABEL, ...DETAIL_LABELS].find(([p]) => p === path.join('.'))?.[1] ?? OTHER
const courseLabel = (course: Course | undefined, key: string) => `${courseName(course)} コースの${COURSE_LABELS[key] ?? OTHER}`

/** 2つの設定が同じか（意味の同じ書き方の違いは見ない）。「保存していない変更があります」の判定に使う */
export function sameConfig(a: YearConfig, b: YearConfig): boolean {
  if (!topPaths([a, b]).every((p) => sameTop(p, a, b))) return false
  const ca = courseList(a)
  const cb = courseList(b)
  return order(ca) === order(cb) && ca.every((c, i) => sameCourse(c, cb[i]))
}

/**
 * 変更が、管理ページの左の見出しのどの区切りにあるか（左の見出しに、区切りごとの変更の数を出すため）。
 * year：年度の設定、course：コース、words：書き方のチェック、details：詳細設定、other：そのほか
 */
export type ChangeSection = 'year' | 'course' | 'words' | 'details' | 'other'
export interface Change {
  label: string
  section: ChangeSection
  /** 変更前と変更後（短い文字や数の項目だけ。ひな形・語の一覧などは出さない：mockups/v49 I） */
  before?: string
  after?: string
  /** 「この欄へ」で開くコースと、入る欄（id） */
  courseId?: string
  target?: string
}

/** 「この欄へ」で入る欄の id（年度の項目） */
const TOP_TARGETS: Record<string, string> = {
  commonTitle: 'y-commonTitle',
  deadline: 'y-deadline',
  handbookUrl: 'y-handbook',
  reportName: 'd-reportName',
  'cover.heading': 'd-coverHeading',
  'cover.titleLabel': 'd-titleLabel',
  'abstract.heading': 'd-abstractHeading',
  'abstract.openingExample': 'd-openingExample',
  university: 'd-university',
  faculty: 'd-faculty',
  department: 'd-department',
  'abstract.minChars': 'd-minChars',
  'abstract.maxChars': 'd-minChars',
  'abstract.minLines': 'd-minLines',
  'abstract.maxLines': 'd-minLines',
  'body.minPages': 'd-minPages',
  'body.imagesPerPageGuide': 'd-images',
  'workPhotos.maxPages': 'd-photoPages',
  studentIdPattern: 'd-studentId',
}
/** 「この欄へ」で入る欄の id（コースの項目） */
const COURSE_TARGETS: Record<string, string> = { name: 'name', advisors: 'advisor', subtitleTemplate: 'before', notice: 'notice', blankRowsOk: 'blankrows' }

/** 変更前・変更後に出す、短い文字（長い文は縮める。空は「（なし）」） */
function brief(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return '（なし）'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') {
    const one = v.replace(/\s+/g, ' ').trim()
    return one ? (one.length > 40 ? `${one.slice(0, 40)}…` : one) : '（なし）'
  }
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.length ? v.join('・') : '（なし）'
  return undefined
}
/** 年度の項目の、変更前・変更後に出す文字（字数・行数は「最少〜最多」を一緒に） */
function topValue(config: unknown, path: string): string | undefined {
  const range = (a: string, b: string, unit: string) => `${brief(get(config, ['abstract', a]))}〜${brief(get(config, ['abstract', b]))}${unit}`
  if (path === 'abstract.minChars' || path === 'abstract.maxChars') return range('minChars', 'maxChars', '字')
  if (path === 'abstract.minLines' || path === 'abstract.maxLines') return range('minLines', 'maxLines', '行')
  if (path === 'workPhotos.maxPages') {
    const v = get(config, ['workPhotos', 'maxPages'])
    return v === undefined || v === null ? '上限なし' : `${v}ページ`
  }
  if (!(path in TOP_TARGETS)) return undefined
  const [a, b] = path.split('.')
  return brief(get(config, b === undefined ? [a] : [a, b]))
}
/** コースの項目の、変更前・変更後に出す文字 */
function courseValue(course: Course, key: string): string | undefined {
  if (key === 'hidden') return course.hidden ? '表示しない' : '表示する'
  if (key === 'blankRowsOk') return course.blankRowsOk ? '空のままでよい' : '空いている所に数える'
  if (key === 'name' || key === 'advisors' || key === 'subtitleTemplate' || key === 'notice') return brief(course[key as keyof Course])
  return undefined
}

/** before から after への変更を、項目の名前と区切りで返す（画面の並び順。同じ名前は1つにまとめる） */
export function listChanges(before: YearConfig, after: YearConfig): Change[] {
  const out: Change[] = []
  const push = (label: string, section: ChangeSection, more: Omit<Change, 'label' | 'section'> = {}) => {
    if (!out.some((c) => c.label === label)) out.push({ label, section, ...more })
  }
  const paths = topPaths([before, after]).filter((p) => !sameTop(p, before, after))
  const values = (p: string) => {
    const b = topValue(before, p)
    const a = topValue(after, p)
    return b !== undefined && a !== undefined && b !== a ? { before: b, after: a } : {}
  }
  const inGroup = (labels: [string, string][], section: ChangeSection) =>
    labels.forEach(([p, label]) => paths.some((x) => x.join('.') === p) && push(label, section, { ...values(p), target: TOP_TARGETS[p] }))
  inGroup(TOP_LABELS, 'year')
  // コース（追加・削除・順番・中の項目）
  const b = courseList(before)
  const a = courseList(after)
  for (const course of a) {
    const old = b.find((x) => x.id === course.id)
    if (!old) push(`${courseName(course)} コース（追加）`, 'course', { courseId: course.id })
    else
      courseKeys(old, course).forEach((k) => {
        if (sameCourseKey(k, old, course)) return
        const b = courseValue(old, k)
        const a = courseValue(course, k)
        const more = { courseId: course.id, target: k in COURSE_TARGETS ? `c-${course.id}-${COURSE_TARGETS[k]}` : undefined, ...(b !== undefined && a !== undefined && b !== a ? { before: b, after: a } : {}) }
        push(k === 'name' ? `${courseName(course)} コースの名前（元は「${courseName(old)}」）` : courseLabel(course, k), 'course', more)
      })
  }
  for (const old of b) if (!a.some((x) => x.id === old.id)) push(`${courseName(old)} コース（削除）`, 'course')
  const kept = (list: Course[], other: Course[]) => order(list.filter((c) => other.some((x) => x.id === c.id)))
  if (kept(a, b) !== kept(b, a)) push('コースの順番', 'course')
  inGroup([WORDS_LABEL], 'words')
  inGroup(DETAIL_LABELS, 'details')
  if (paths.some((p) => topLabel(p) === OTHER)) push(OTHER, 'other')
  return out
}

/**
 * before から after への変更を、項目の名前で返す（画面の並び順。同じ名前は1つにまとめる）。
 * 例：「共通の題目」「映画・舞台衣装デザイナー コースの下書きのひな形」「書き間違えやすい語」
 */
export function describeChanges(before: YearConfig, after: YearConfig): string[] {
  return listChanges(before, after).map((c) => c.label)
}

/** 年度の項目（例：'commonTitle'・'abstract.minChars'・'wordChecks'）が変わったか（意味の同じ書き方の違いは見ない）。「変更あり」の印に使う */
export function fieldChanged(before: YearConfig, after: YearConfig, path: string): boolean {
  const [a, b] = path.split('.')
  return !sameTop(b === undefined ? [a] : [a, b], before, after)
}

/** コース（ID）が変わったか。key を渡すとその項目だけを見る（なければ、追加したコースか、どれかの項目が変わったか） */
export function courseChanged(before: YearConfig, after: YearConfig, id: string, key?: string): boolean {
  const old = courseList(before).find((c) => c.id === id)
  const now = courseList(after).find((c) => c.id === id)
  if (!now) return false
  if (!old) return true
  return key ? !sameCourseKey(key, old, now) : !sameCourse(old, now)
}

/** 変更の一覧を短く（変更履歴の1行に出す。多いときは「ほか○件」） */
export function shortChanges(changes: string[], max = 3): string {
  return changes.length > max ? `${changes.slice(0, max).join('、')} ほか${changes.length - max}件` : changes.join('、')
}

/**
 * 別のタブ（ほかの人）が先に保存していたとき、最新の設定（theirs）に、自分が変えた項目（base → mine）だけを入れ直す。
 * 同じ項目を両方が別の内容に変えていたら、入れ直さずに conflicts に項目の名前を返す（どちらを残すかは人が決める）。
 * 入れ直した設定は保存しない（画面に出して、確かめてから保存してもらう）
 */
export function mergeEdits(base: YearConfig, mine: YearConfig, theirs: YearConfig): { config: YearConfig; conflicts: string[] } {
  const result = clone(theirs) as unknown as Obj
  const conflicts: string[] = []
  const conflict = (label: string) => {
    if (!conflicts.includes(label)) conflicts.push(label)
  }
  for (const path of topPaths([base, mine, theirs])) {
    if (sameTop(path, base, mine)) continue
    if (!sameTop(path, base, theirs) && !sameTop(path, mine, theirs)) {
      conflict(topLabel(path))
      continue
    }
    const value = clone(get(mine, path))
    if (path.length === 1) {
      if (value === undefined) delete result[path[0]]
      else result[path[0]] = value
    } else {
      const box = isObj(result[path[0]]) ? (result[path[0]] as Obj) : (result[path[0]] = {})
      if (value === undefined) delete box[path[1]]
      else box[path[1]] = value
    }
  }
  // コース：追加・削除・順番は、片方だけが変えていればその並びに。両方が別々に変えていたら入れ直さない
  const B = courseList(base)
  const M = courseList(mine)
  const T = courseList(theirs)
  const mineMoved = order(M) !== order(B)
  const theirsMoved = order(T) !== order(B)
  if (mineMoved && theirsMoved && order(M) !== order(T)) conflict('コースの追加・削除・順番')
  else {
    const courses = (mineMoved ? M : T).map((c) => {
      const b = B.find((x) => x.id === c.id)
      const m = M.find((x) => x.id === c.id)
      const t = T.find((x) => x.id === c.id)
      if (!b || !m || !t) return clone(m ?? t ?? c)
      const merged = clone(t) as unknown as Obj
      for (const key of courseKeys(b, m, t)) {
        if (sameCourseKey(key, b, m)) continue
        if (!sameCourseKey(key, b, t) && !sameCourseKey(key, m, t)) conflict(courseLabel(m, key))
        else if (m[key as keyof Course] === undefined) delete merged[key]
        else merged[key] = clone(m[key as keyof Course])
      }
      return merged as unknown as Course
    })
    // 片方が消したコースを、もう片方が直していた
    for (const b of B) {
      const m = M.find((x) => x.id === b.id)
      const t = T.find((x) => x.id === b.id)
      if ((!m && t && !sameCourse(b, t)) || (!t && m && !sameCourse(b, m))) conflict(`${courseName(b)} コース（削除）`)
    }
    result.courses = courses
  }
  return { config: result as unknown as YearConfig, conflicts }
}
