/**
 * 年度ごとの設定。毎年の更新は教員用の管理ページで行い、ツールは公開中の設定を読み込む。
 * src/config/2026.json は、管理ページの設定を読み込めないときに使う初期値。
 * 値の根拠は「卒業制作報告書 作成の手順について」（手順書）。
 */
/** 書き間違えやすい語（学生のセルフチェックで指摘し、「直す」で正しい語にする） */
export interface WordCheck {
  wrong: string
  right: string
  /** 説明（任意。指摘の詳しい説明に出す） */
  note?: string
  /** error：ほぼ確実に誤り。warning：文脈によっては正しいこともある */
  severity: 'error' | 'warning'
}

export interface YearConfig {
  fiscalYear: number
  /** 書き間違えやすい語の一覧。省略したら、ツールに入っている一覧（DEFAULT_WORD_CHECKS）を使う */
  wordChecks?: WordCheck[]
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
  /** 下書きのひな形（学生が最初に見る本文の組み立て）。ないときは標準のひな形を使う */
  template?: TemplateBlock[]
  /** 抄録の書き出し例（学生の抄録の欄に薄く出す）。ないときは年度の設定の openingExample を使う */
  abstractExample?: string
  /** このコースの学生へのお知らせ（学生のツールの右の欄に出す。任意。管理者と先生が書く） */
  notice?: string
}

/**
 * 下書きのひな形の部品。並べた順に本文になる（最初は大見出し）。
 * 段落の hint は「ここに何を書くか」の説明で、空の段落に薄く出す（画面だけ。PDF には出ない）
 */
export type TemplateBlock =
  | { type: 'chapter'; title: string }
  | { type: 'subheading'; title: string }
  | { type: 'paragraph'; hint: string }
  | { type: 'figure'; caption: string }
  | { type: 'materialTable'; caption: string }
