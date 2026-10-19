import type { Course, TemplateBlock, WordCheck, YearConfig } from '../config'
import { LIMITS, templateRowName } from '../config/validate'
import type { TemplateSet } from './server'

/**
 * 管理ページのサーバー（gas/admin-project/Code.js）が保存の前に行う確かめを、試験用サーバー（mockServer.ts）でも同じに行うための写し。
 * 断る条件とエラーの言葉は Code.js と同じにする（gas/gas.test.ts で、同じ入力に同じ言葉を返すことを確かめている）。
 * 関数の名前は Code.js の名前から末尾の _ を取ったもの
 */

const BLOCK_TYPES = ['chapter', 'subheading', 'paragraph', 'figure', 'materialTable']
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object'

/** 文字の項目を確かめる（文字でない・長すぎるときはエラー） */
export function checkText(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string') throw new Error(label + 'の形が正しくありません')
  if (value.length > max) throw new Error(label + 'が長すぎます（' + max + '字まで。今は' + value.length + '字）')
  return value
}

/** 下書きのひな形を確かめ、決まった項目だけの形にして返す（Code.js の cleanTemplate_） */
export function cleanTemplate(template: unknown, courseName: string): TemplateBlock[] {
  const label = '「' + courseName + '」のひな形'
  if (!Array.isArray(template)) throw new Error(label + 'の形が正しくありません')
  if (template.length > LIMITS.blocks) throw new Error(label + 'の部品が多すぎます（' + LIMITS.blocks + '個まで）')
  const cleaned = template.map((block: unknown, i) => {
    if (!isObj(block) || BLOCK_TYPES.indexOf(block.type as string) < 0) throw new Error(label + 'の' + (i + 1) + '行目の形が正しくありません')
    const type = block.type as TemplateBlock['type']
    const key = type === 'chapter' || type === 'subheading' ? 'title' : type === 'paragraph' ? 'hint' : 'caption'
    const row = label + 'の' + templateRowName(i, type, block[key])
    const text = checkText(block[key], key === 'hint' ? LIMITS.hint : LIMITS.name, row)
    // 段落の説明は空でもよい（大見出し・小見出し・図・表の名前は空にしない）
    if (key !== 'hint' && !text.trim()) throw new Error(row + 'の名前が空です')
    return { type, [key]: text } as TemplateBlock
  })
  if (cleaned.length && cleaned[0].type !== 'chapter') throw new Error(label + 'は、大見出しから始めてください')
  return cleaned
}

/** 書き間違えやすい語の一覧を確かめて整える（Code.js の cleanWords_。空の行・同じ語の行は捨てる） */
export function cleanWords(words: unknown): WordCheck[] {
  if (!Array.isArray(words)) throw new Error('書き間違えやすい語の形が正しくありません')
  if (words.length > LIMITS.words) throw new Error('書き間違えやすい語が多すぎます（' + LIMITS.words + '語まで）')
  return words
    .map((w: unknown, i) => {
      const row = '書き間違えやすい語の' + (i + 1) + '行目'
      if (!isObj(w)) throw new Error(row + 'の形が正しくありません')
      const text = (key: string, max: number) => (w[key] === undefined || w[key] === null ? '' : checkText(w[key], max, row).trim())
      return { wrong: text('wrong', LIMITS.word), right: text('right', LIMITS.word), note: text('note', LIMITS.wordNote), severity: w.severity === 'warning' ? ('warning' as const) : ('error' as const) }
    })
    .filter((w) => w.wrong && w.right && w.wrong !== w.right)
}

/** 指定したコースのひな形と抄録の書き出し例を書き換える。書き換えたコースの名前を返す（Code.js の applyTemplates_） */
export function applyTemplates(config: YearConfig, templates: TemplateSet): string[] {
  const names: string[] = []
  config.courses.forEach((course) => {
    const t: unknown = templates[course.id]
    if (!t) return
    if (typeof t !== 'object') throw new Error('「' + course.name + '」のひな形の形が正しくありません')
    const { template, abstractExample } = t as { template?: unknown; abstractExample?: unknown }
    course.template = cleanTemplate(template, course.name)
    course.abstractExample = abstractExample === undefined || abstractExample === null ? '' : checkText(abstractExample, LIMITS.abstractExample, '「' + course.name + '」の抄録の書き出し例')
    names.push(course.name)
  })
  return names
}

/** 指定したコースのお知らせを書き換える。書き換えたコースの名前を返す（Code.js の applyNotices_） */
export function applyNotices(config: YearConfig, notices: Record<string, unknown>): string[] {
  const names: string[] = []
  config.courses.forEach((course) => {
    if (!Object.prototype.hasOwnProperty.call(notices, course.id)) return
    const notice = notices[course.id]
    course.notice = notice === null ? '' : checkText(notice, LIMITS.notice, '「' + course.name + '」のお知らせ')
    names.push(course.name)
  })
  return names
}

/** 保存する設定の形を確かめる（Code.js の checkConfig_。題目が空などの細かい確認は画面で行う） */
export function checkConfig(config: unknown): void {
  if (!isObj(config) || Array.isArray(config)) throw new Error('設定の形が正しくありません')
  const fiscalYear = config.fiscalYear as number
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1000 || fiscalYear > 9999) throw new Error('年度が正しくありません')
  if (!Array.isArray(config.courses)) throw new Error('コースの一覧がありません')
  config.courses.forEach((c: unknown, i) => {
    const course = c as Course
    const name = course && typeof course.name === 'string' && course.name ? course.name : i + 1 + '番目のコース'
    if (
      !course ||
      typeof course !== 'object' ||
      typeof course.id !== 'string' ||
      !course.id ||
      typeof course.name !== 'string' ||
      typeof course.subtitleTemplate !== 'string' ||
      !Array.isArray(course.advisors) ||
      course.advisors.some((a) => typeof a !== 'string')
    ) {
      throw new Error('「' + name + '」の形が正しくありません')
    }
    if (course.template !== undefined && course.template !== null) cleanTemplate(course.template, name)
    if (course.abstractExample !== undefined && course.abstractExample !== null) checkText(course.abstractExample, LIMITS.abstractExample, '「' + name + '」の抄録の書き出し例')
    if (course.notice !== undefined && course.notice !== null) checkText(course.notice, LIMITS.notice, '「' + name + '」のお知らせ')
  })
  if (config.wordChecks !== undefined && config.wordChecks !== null) cleanWords(config.wordChecks)
  if (JSON.stringify(config).length > 45000) throw new Error('設定が大きすぎます')
}

/** 画面を開いたあとに保存されていたときの説明（Code.js の changedMessage_。保存したのが自分なら、別のタブ・ウィンドウで保存したと伝える） */
export function changedMessage(updatedBy: string, user: string): string {
  const who = String(updatedBy || '').toLowerCase() === String(user || '').toLowerCase() ? '別のタブかウィンドウで（' + updatedBy + ' で）' : 'ほかの人（' + updatedBy + '）が'
  return 'この画面を開いたあとに、' + who + 'この年度の設定を保存しました。そのまま保存すると、その変更が消えてしまうため、保存しませんでした。ページを読み込み直してから、もう一度変更してください'
}
