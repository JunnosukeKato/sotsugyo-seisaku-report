/**
 * 年度ごとの設定。毎年の更新は教員用の管理ページで行い、ツールは公開中の設定を読み込む。
 * src/config/2026.json は、管理ページの設定を読み込めないときに使う初期値。
 * 値の根拠は「卒業制作報告書 作成の手順について」（手順書）。
 */
export interface YearConfig {
  fiscalYear: number
  reportName: string
  /** 最終締切（YYYY-MM-DD） */
  deadline: string
  university: string
  faculty: string
  department: string
  /** 全員共通の題目（学生は編集できない） */
  commonTitle: string
  cover: {
    /** 表紙の大見出し（例: 卒業制作） */
    heading: string
    /** 題目の見出し（例: 制作題目） */
    titleLabel: string
  }
  abstract: {
    heading: string
    /** 抄録の入力欄に薄く表示する書き出し例 */
    openingExample: string
    minChars: number
    maxChars: number
    minLines: number
    maxLines: number
  }
  body: {
    /** 本文の最低ページ数（引用・参考文献のページは含めない） */
    minPages: number
    /** 1ページあたりの画像枚数の目安 */
    imagesPerPageGuide: number
  }
  workPhotos: {
    maxImages: number
  }
  /** 学籍番号の形式（正規表現）。未確定の間は null とし、形式チェックを行わない */
  studentIdPattern: string | null
  courses: Course[]
  /** 学生へのお知らせ（ツールの画面に表示する。任意） */
  notice?: string
  /** その年度の手順書へのリンク（任意） */
  handbookUrl?: string
}

export interface Course {
  id: string
  /** コース名（「コース」は含めない。例: 映画・舞台衣装デザイナー） */
  name: string
  /** 抄録に載せる指導教員 */
  advisors: string[]
  /** サブタイトルの「指定の内容」。{input} が学生の入力に置き換わる */
  subtitleTemplate: string
  /**
   * 学生のコースの選択肢に出さない。公開した後のコースは、選んでいた学生のデータが宙に浮かないよう、
   * 削除せずに非表示にする（ID は変えない）
   */
  hidden?: boolean
}
