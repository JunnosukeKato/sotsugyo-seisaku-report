/**
 * 使い方（ヘルプ）と印刷用の手引きの置き場所。
 * 学生用ツールは GitHub Pages に置くので、手引きの PDF（public/guides/）と使い方の画面の写真（public/help/）は相対パスで読む。
 * 管理ページは Apps Script に置くので、学生用ツールの URL（PAGES_URL）から読む（GitHub のリポジトリを移したら、ここだけ直す）
 */

/** 学生用ツールを公開している場所（GitHub Pages） */
export const PAGES_URL = 'https://junnosukekato.github.io/sotsugyo-seisaku-report/'

/** 学生用ツール：印刷用の手引き（学生用の PDF） */
export const STUDENT_GUIDE_PATH = './guides/student-guide.pdf'
/** 学生用ツール：使い方の画面の写真 */
export const STUDENT_HELP_IMAGES = './help/'

/** 管理ページ：印刷用の手引き（先生用・管理者用の PDF） */
export const TEACHER_GUIDE_URL = `${PAGES_URL}guides/teacher-guide.pdf`
export const ADMIN_GUIDE_URL = `${PAGES_URL}guides/admin-guide.pdf`
/** 管理ページ：使い方の画面の写真（学生用ツールといっしょに公開している public/help/） */
export const TEACHER_HELP_IMAGES = `${PAGES_URL}help/`
