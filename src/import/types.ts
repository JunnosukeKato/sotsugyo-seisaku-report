import type { StoredImage } from '../model/storage'
import type { BasicInfo, Chapter } from '../model/types'

/**
 * 今年度だけ：Word のひな形（01_表紙.docx・04_本文.docx）で書き始めた分を、ツールの原稿に写す（mockups/v24）。
 * 読み取り（wordImport.ts）と画面（app/WordImport.tsx）の受け渡しの形。
 */

/** 学生が選んだファイル（本文は必ず、表紙は書いていれば） */
export interface WordFiles {
  body: File
  cover?: File
}

/** 本文の組み立て（写す前の確認の窓に出す一覧の1行） */
export interface OutlineItem {
  level: 1 | 2
  /** 番号（Ⅰ．ⅰ．）を除いた見出し */
  title: string
  paragraphs: number
  /** その見出しの下の図（例「図1」） */
  figures: string[]
  /** その見出しの下の表（例「表1」） */
  tables: string[]
  /** Word ではまだ書いていないため、ツールのひな形から続ける章（大見出しだけ） */
  fromTemplate?: boolean
  /** 読み取れなかった所がある（確認の窓で、その行に印を付ける） */
  problem?: boolean
}

/** 図（確認の窓に、小さな画像とタイトルを出す） */
export interface FigurePreview {
  /** 例「図1」 */
  label: string
  caption: string
  /** images の中の画像の ID。画像を読めなかった図は null */
  imageId: string | null
}

export interface TablePreview {
  label: string
  caption: string
  /** 見出しの行を除いた行の数 */
  rows: number
}

/** 読み取れなかったもの（確認の窓の上に知らせる） */
export interface ImportProblem {
  /** 学生に分かる言葉で（例「図2のタイトルが見つかりませんでした」） */
  message: string
  /** どこの話か（例「Ⅱ．制作過程」）。分からなければ省く */
  where?: string
  /** どう写すか・どうすればよいかの説明（例「写真の近くに図2のタイトルの行がないため、タイトルを空けて写します」）。なければ省く */
  detail?: string
}

export interface WordImportResult {
  /** 写す本文：Word で書いた章のあとに、まだ書いていない章をツールのひな形から続けたもの */
  body: Chapter[]
  /** 表紙から読み取れた項目（読み取れなかったものは入れない） */
  cover: Partial<Pick<BasicInfo, 'studentId' | 'name' | 'subtitleInput'>>
  /** 写す画像（図・表のセルの画像）。写すときに端末に保存する */
  images: StoredImage[]
  outline: OutlineItem[]
  figures: FigurePreview[]
  tables: TablePreview[]
  counts: { chapters: number; subheadings: number; paragraphs: number; figures: number; tables: number }
  /** ひな形のままで写さなかった行（「〇〇〇〇」「～～～」だけの行）の数 */
  skippedPlaceholders: number
  problems: ImportProblem[]
}
