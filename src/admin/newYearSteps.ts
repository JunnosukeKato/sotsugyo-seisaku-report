import type { YearConfig } from '../config'
import type { ConfigProblem } from '../config/validate'
import { courseName } from './changes'
import { formatDate, titleWords } from './yearText'

/**
 * まだ公開していない（準備中の）年度の「年度の設定」に出す、新年度の手順（mockups/v43 案C の手順を、案B の画面に入れたもの）。
 * 題目 → 締切 → コース → 確かめる → 公開。それぞれ、済んだか・まだか（まだのときは、その理由）を返す。
 * prev は比べる前の年度の設定（コピーした元。前の年度、なければ公開中の年度）。なければ、前の年度と同じかは見ない
 */

export type StepKey = 'title' | 'deadline' | 'course' | 'check' | 'publish'
export interface NewYearStep {
  key: StepKey
  /** 手順の名前 */
  name: string
  done: boolean
  /** 済んだとき・まだのときの短い説明 */
  text: string
  /** コースの手順：直すコースの ID（まだのとき） */
  courseId?: string
}

const STEP_NAMES: Record<StepKey, string> = { title: '題目', deadline: '締切', course: 'コース', check: '確かめる', publish: '公開' }

export function newYearSteps(config: YearConfig, prev: YearConfig | undefined, problems: ConfigProblem[]): NewYearStep[] {
  const year = config.fiscalYear
  const step = (key: StepKey, done: boolean, text: string, courseId?: string): NewYearStep => ({ key, name: STEP_NAMES[key], done, text, ...(courseId ? { courseId } : {}) })

  // 題目：入っていて、前の年度と違う
  const title = config.commonTitle.trim()
  const sameTitle = !!prev && title === prev.commonTitle.trim()
  const titleStep = !title ? step('title', false, 'まだ入っていません') : sameTitle ? step('title', false, `${prev!.fiscalYear}年度と同じです`) : step('title', true, prev ? '直しました' : '入っています')

  // 締切：この年度の期間（4月1日〜次の年の3月31日）の中で、前の年度と同じ日付でない
  const inYear = config.deadline >= `${year}-04-01` && config.deadline <= `${year + 1}-03-31`
  const sameDeadline = !!prev && config.deadline === prev.deadline
  const deadlineStep = !config.deadline
    ? step('deadline', false, 'まだ入っていません')
    : sameDeadline
      ? step('deadline', false, `${prev!.fiscalYear}年度と同じ日付です`)
      : !inYear
        ? step('deadline', false, `${year}年度の期間の外です`)
        : step('deadline', true, formatDate(config.deadline))

  // コース：学生に表示するコースがあり、指導教員があり、お知らせ・抄録の書き出し例が前の年度のままでない
  const shown = config.courses.filter((c) => !c.hidden)
  const prevCourse = (id: string) => prev?.courses.find((c) => c.id === id)
  const oldNotice = shown.find((c) => (c.notice ?? '').trim() && (c.notice ?? '').trim() === (prevCourse(c.id)?.notice ?? '').trim())
  const words = prev ? titleWords(prev.commonTitle) : []
  const oldExample = words.length ? shown.find((c) => typeof c.abstractExample === 'string' && words.some((w) => c.abstractExample!.includes(w))) : undefined
  const noAdvisor = shown.find((c) => !c.advisors.some((a) => a.trim()))
  const courseStep = !shown.length
    ? step('course', false, '学生に表示するコースがありません')
    : oldNotice
      ? step('course', false, `お知らせが${prev!.fiscalYear}年度のままです（${courseName(oldNotice)} コース）`, oldNotice.id)
      : oldExample
        ? step('course', false, `抄録の書き出し例に、${prev!.fiscalYear}年度の題目の言葉があります（${courseName(oldExample)} コース）`, oldExample.id)
        : noAdvisor
          ? step('course', false, `指導教員がいません（${courseName(noAdvisor)} コース）`, noAdvisor.id)
          : step('course', true, `${shown.length}コース。直す所はありません`)

  // 確かめる：エラーも確認もない
  const errors = problems.filter((p) => p.severity === 'error').length
  const warnings = problems.length - errors
  const checkStep = errors ? step('check', false, `エラーが${errors}件あります`) : warnings ? step('check', false, `確認が${warnings}件あります`) : step('check', true, 'エラーも確認もありません')

  return [titleStep, deadlineStep, courseStep, checkStep, step('publish', false, '上の「この年度を学生に公開」で公開します')]
}
