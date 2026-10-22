// スマホのキーボードを仮に出す・しまう（使い方の写真 make-help-images.mjs・手引き make-guides.mjs・使い方の動画 video/session.mjs で使う）。
// ヘッドレスの Edge では本物のキーボードが出ないので、iPhone の日本語のキーボードの絵（依頼者が用意した画面の写真の、キーボードの部分。
// assets/iphone-keyboard.png、320×286）を画面の下に置き、iPhone と同じく、見えている所（visualViewport）をその高さだけ低くする（押せない）。
// 前は灰色の板に「キーボード」と書いていたが、使い方の写真では何か分からなかった（依頼者 2026-10-22）
import { readFileSync } from 'node:fs'

const IMAGE = `data:image/png;base64,${readFileSync(new URL('./assets/iphone-keyboard.png', import.meta.url)).toString('base64')}`
/** 絵の縦と横の比（286 / 320）。画面の幅いっぱいに置き、高さはこの比で決める（幅 390px なら約 349px） */
const RATIO = 286 / 320

/** キーボードを出す（on）・しまう。出したキーボードの高さ（px）を返す。id：置く絵の要素の id */
export function showPhoneKeyboard(page, on, id = 'fake-kb') {
  return page.evaluate(
    async (on, image, ratio, id) => {
      document.getElementById(id)?.remove()
      const height = Math.round(window.innerWidth * ratio)
      if (on) Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => window.innerHeight - height })
      else delete window.visualViewport.height
      window.visualViewport.dispatchEvent(new Event('resize'))
      if (!on) return 0
      const k = document.createElement('img')
      k.id = id
      k.alt = ''
      k.src = image
      Object.assign(k.style, { position: 'fixed', left: '0', bottom: '0', width: '100%', height: `${height}px`, zIndex: '200', pointerEvents: 'none' })
      document.body.append(k)
      await k.decode().catch(() => {})
      return height
    },
    on,
    IMAGE,
    RATIO,
    id,
  )
}
