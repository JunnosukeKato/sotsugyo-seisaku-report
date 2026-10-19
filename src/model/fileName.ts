/**
 * 提出する PDF のファイル名のもと（拡張子なし）。提出ガイドの決まり「学籍番号_氏名.pdf」（例：23AAA999_文化すみれ.pdf）に合わせる。
 * 氏名の空白は詰める。学籍番号・氏名がまだ空なら、その部分は付けない。両方とも空なら fallback（報告書の名前）
 * 学生用ツールの「PDFを書き出す」（reportEditor.ts・makePdf.ts）と、提出前チェックのまとめた PDF（check/parts.ts）で同じ形にする
 */
export function submissionTitle(studentId: string, name: string, fallback: string): string {
  return [studentId.trim(), name.replace(/[\s　]/g, '')].filter(Boolean).join('_') || fallback
}
