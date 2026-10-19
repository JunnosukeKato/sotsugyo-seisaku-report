/**
 * 「元に戻す」「やり直す」の履歴（mockups/v35 ④ 案A）。原稿（など、変えない値）の前の状態を積んでおく。
 * - 原稿を変える前に push で前の状態を積む。新しく変えたら、やり直しの分は消える（戻したあとに書き直したら、もう進めない）
 * - 元に戻す（undo）：ひとつ前の状態を返し、いまの状態をやり直しの分に積む
 * - やり直す（redo）：やり直しの分から1つ取り出して返し、いまの状態を元に戻す分に積む
 * やり直しの分には、やり直したときに出す知らせ（note。削除をやり直したら「〜を削除しました［戻す］」など）も一緒に持てる。
 * 原稿を丸ごと入れ替えたとき（別の原稿にした・控えに戻した）は clear で両方とも消す（履歴は原稿ごと）
 */
export class EditHistory<T, N = unknown> {
  private past: T[] = []
  private future: { state: T; note: N | null }[] = []
  private readonly limit: number

  /** limit：覚えておく数（古いものから捨てる） */
  constructor(limit = 200) {
    this.limit = limit
  }

  get canUndo(): boolean {
    return this.past.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  /** 原稿を新しく変える前の状態を積む（やり直しの分は消える） */
  push(state: T): void {
    this.past.push(state)
    if (this.past.length > this.limit) this.past.shift()
    this.future = []
  }

  /** 元に戻す：ひとつ前の状態（なければ undefined）。current：いまの状態（やり直すと、これに戻る）。note：やり直したときに出す知らせ */
  undo(current: T, note: N | null = null): T | undefined {
    const previous = this.past.pop()
    if (previous === undefined) return undefined
    this.future.push({ state: current, note })
    return previous
  }

  /** やり直す：戻す前の状態と、そのときに出す知らせ（なければ undefined）。current：いまの状態（もう一度元に戻すと、これに戻る） */
  redo(current: T): { state: T; note: N | null } | undefined {
    const next = this.future.pop()
    if (!next) return undefined
    this.past.push(current)
    if (this.past.length > this.limit) this.past.shift()
    return next
  }

  /** 両方とも消す（原稿を丸ごと入れ替えたとき） */
  clear(): void {
    this.past = []
    this.future = []
  }
}
