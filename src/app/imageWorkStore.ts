/**
 * 写真を取り込んでいる様子（何枚目か）。編集の中核（editor/reportEditor.ts の onImageWork）から受けて、知らせの部品（app/ImageWork.tsx）に渡す
 */

export type ImageWorkState = { done: number; total: number } | null

/** 写真を取り込んでいる様子（何枚目か。終わったら null） */
export class ImageWork {
  private state: ImageWorkState = null
  private listeners = new Set<() => void>()

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  get = () => this.state

  private ending = 0

  /**
   * 取り込んでいる様子を変える。終わった（null）ことは、少しあとで知らせる
   * （保存し終えたあと、編集の中核が写真を原稿に入れて組み直し始めてから。組み直し終えるまで、知らせを出しておくため）
   */
  set = (state: ImageWorkState) => {
    window.clearTimeout(this.ending)
    if (state) this.notify(state)
    else this.ending = window.setTimeout(() => this.notify(null), 0)
  }

  private notify(state: ImageWorkState) {
    this.state = state
    for (const listener of this.listeners) listener()
  }
}
