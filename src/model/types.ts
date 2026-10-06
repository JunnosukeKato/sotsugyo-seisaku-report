/**
 * 報告書の文書データ。内容だけを持ち、書式（フォント・サイズ・余白など）は持たない。
 * 書式は組版（src/layout）が一手に決める。
 */

/** 保存データの形式バージョン。公開後に形を変えるときは必ず上げ、古い形式の読み込みを残す */
export const DATA_FORMAT_VERSION = 1

export interface Report {
  formatVersion: number
  fiscalYear: number
  basicInfo: BasicInfo
  abstract: AbstractSection
  body: Chapter[]
  /** 引用・参考文献（任意） */
  references: Reference[]
  workPhotos: WorkPhotos
  /** ISO 8601 */
  updatedAt: string
}

/** 表紙と抄録の両方に反映する基本情報 */
export interface BasicInfo {
  studentId: string
  name: string
  courseId: string
  /** サブタイトルの可変部分（例: パリス）。前後の決まり文句はコース設定から付ける */
  subtitleInput: string
}

/** 抄録の本文。段落ごとに持つ（書き出しの1字下げは自動） */
export interface AbstractSection {
  paragraphs: ParagraphBlock[]
  /**
   * 抄録を書き始めたか。抄録は、本文を書き終えて先生のチェックで許可が出てから書く（学生が「先生の許可が出た」を押す）。
   * false の間は、抄録の欄に案内とボタンを出し、抄録の字数・行数のチェックはしない。省略したら書き始めている
   */
  started?: boolean
}

/** 大見出し（Ⅰ．Ⅱ．…は自動で付く） */
export interface Chapter {
  id: string
  title: string
  blocks: BodyBlock[]
}

export type BodyBlock = SubheadingBlock | ParagraphBlock | FigureRowBlock | MaterialTableBlock | PageBreakBlock

/** 改ページ（学生が好きな位置に入れる。この後ろは次のページから始まる） */
export interface PageBreakBlock {
  type: 'pageBreak'
  id: string
}

/** 小見出し（ⅰ．ⅱ．…は自動で付く） */
export interface SubheadingBlock {
  type: 'subheading'
  id: string
  title: string
}

/** 段落。書き出しの1字下げは組版で付けるので、本文に空白は含めない */
export interface ParagraphBlock {
  type: 'paragraph'
  id: string
  content: InlineNode[]
  /** ひな形の「ここに何を書くか」の説明。空の段落に薄く出す（画面だけ） */
  hint?: string
}

export type InlineNode = TextNode | ReferenceNode

export interface TextNode {
  type: 'text'
  text: string
}

/** 図表への参照。番号はリンク先から自動で決まり、表示は「（図1）」または「図1」 */
export interface ReferenceNode {
  type: 'ref'
  targetId: string
  withParens: boolean
}

/** 図の並び（1枚、または2枚横並び）。図ごとに番号が付く */
export interface FigureRowBlock {
  type: 'figureRow'
  id: string
  figures: Figure[]
}

export interface Figure {
  id: string
  /** 画像の ID。ひな形で用意した、まだ写真を入れていない枠は空文字 */
  imageId: string
  /** 名称のみ（例: デザイン画）。「図1.」は自動で付く */
  caption: string
}

/** 素材表。生地見本は写真で入れる */
export interface MaterialTableBlock {
  type: 'materialTable'
  id: string
  /** 名称のみ（例: 使用素材表）。「表1.」は自動で付く */
  caption: string
  rows: MaterialRow[]
}

export interface MaterialRow {
  id: string
  name: string
  usage: string
  swatchImageId: string | null
}

export type Reference = BookReference | WebReference

export interface BookReference {
  type: 'book'
  id: string
  author: string
  title: string
  publisher: string
  year: string
  /** 例: 17-24（「p.」は自動で付く） */
  pages: string
}

export interface WebReference {
  type: 'web'
  id: string
  siteTitle: string
  url: string
  /** 参照日（YYYY-MM-DD） */
  accessedOn: string
}

/** 作品写真のページに載せる枚数 */
export type WorkPhotoLayout = 1 | 2 | 4 | 6

/** 写真を枠に合わせて切り抜く位置（%）。50・50 が中央、0 が左（上）端、100 が右（下）端 */
export interface PhotoPosition {
  x: number
  y: number
}

export interface WorkPhotos {
  layout: WorkPhotoLayout
  /** 横に並べる数（2枚：2＝左右・1＝上下、6枚：2＝2列×3段・3＝3列×2段）。省略したら既定の並べ方（photoGrid） */
  columns?: number
  /**
   * 写真（1枚目から順）。枚数を減らしても消さずに残し、先頭から layout 枚を載せる（枚数を戻すと、また載る）
   */
  imageIds: string[]
  /** 写真ごとの切り抜く位置（imageIds と同じ順。null は中央） */
  positions?: (PhotoPosition | null)[]
}

/** 画像の実体は文書データとは別に保存し、ID で参照する */
export interface ImageAsset {
  id: string
  mimeType: string
  widthPx: number
  heightPx: number
  blob: Blob
}
