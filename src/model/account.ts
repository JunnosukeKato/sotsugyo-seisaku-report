/**
 * 大学のアカウント（メールアドレス）について。
 * 学生のアドレスの @ より前は学籍番号（小文字）。学籍番号の形でないアドレスは教職員。
 */

/** 大学のアカウントのドメイン */
export const UNIVERSITY_DOMAIN = (import.meta.env.VITE_GOOGLE_DOMAIN as string | undefined) || 'bunka-wu.ac.jp'

/** 学籍番号の形（手順書の例：23FA●●●・22FAC●●●）。管理ページで形式を決めていれば、そちらを使う */
const DEFAULT_STUDENT_ID = /^\d{2}[A-Z]{2,3}\d{3,4}$/

/** 学生のアドレスなら、@ より前を大文字にした学籍番号。学籍番号の形でなければ（教職員のアカウント）null */
export function studentIdFromEmail(email: string | null, pattern: string | null): string | null {
  const id = (email ?? '').split('@')[0].trim().toUpperCase()
  if (!id) return null
  let re = DEFAULT_STUDENT_ID
  try {
    if (pattern) re = new RegExp(pattern)
  } catch {
    // 形式が正しくなければ、手順書の例の形で見る
  }
  return re.test(id) ? id : null
}

/**
 * アドレスの一部を伏せる（例：00zz0123@bunka-wu.ac.jp → 00zz01**@bunka-wu.ac.jp）。
 * 共用のパソコンで、前の人のアカウントを次の人に見せるとき、学籍番号が全部は分からないようにする（本人には見分けがつく）
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  const local = at < 0 ? email : email.slice(0, at)
  const hidden = local.length > 4 ? 2 : Math.max(local.length - 1, 0)
  return local.slice(0, local.length - hidden) + '*'.repeat(hidden) + (at < 0 ? '' : email.slice(at))
}

export const isUniversityAddress = (email: string) => email.toLowerCase().endsWith(`@${UNIVERSITY_DOMAIN.toLowerCase()}`)

/**
 * メーリングリストの宛先などから、名前とメールアドレスを読み取る。
 * 「文化 太郎 <t-bunka@…>」「"衣装 花子" <…>」の形や、カンマ・セミコロン・読点・改行・空白で区切ったアドレスに対応する。
 * 同じアドレスは1つにまとめる（大文字・小文字は区別しない）
 */
export function parseAddresses(text: string): { name: string; email: string }[] {
  const found = new Map<string, { name: string; email: string }>()
  for (const segment of text.normalize('NFKC').split(/[,;、\n]+/)) {
    const emails = [...segment.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)]
    emails.forEach((m, i) => {
      const email = m[0].toLowerCase()
      const before = segment.slice(0, m.index)
      // 名前は「名前 <アドレス>」の形のときだけ（区切りの中の、最初のアドレスの前）
      const name = i === 0 && before.includes('<') ? before.replace(/[<>"'“”「」]/g, '').trim() : ''
      if (!found.has(email)) found.set(email, { name, email })
    })
  }
  return [...found.values()]
}
