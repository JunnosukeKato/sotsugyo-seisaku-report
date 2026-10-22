// スマホのキーボードを仮に出す・しまう（使い方の写真 make-help-images.mjs・手引き make-guides.mjs・使い方の動画 video/session.mjs で使う）。
// ヘッドレスの Edge では本物のキーボードが出ないので、キーボードの絵を画面の下に置き、iPhone と同じく、見えている所（visualViewport）を
// その高さだけ低くする（押せない）。前は灰色の板に「キーボード」と書いていたが、使い方の写真では何か分からなかった（依頼者 2026-10-22）。
// 絵は、依頼者が用意したスマホのキーボードの素材（Illustrator のファイル）を書き出したもの（assets/keyboard.private.png）。
// 素材そのものは公開しない（git に入れない。写真・動画に写すだけ）。このファイルがない端末では、前の灰色の板で撮る
import { existsSync, readFileSync } from 'node:fs'

const FILE = new URL('./assets/keyboard.private.png', import.meta.url)
const png = existsSync(FILE) ? readFileSync(FILE) : null
const IMAGE = png ? `data:image/png;base64,${png.toString('base64')}` : null
/** 絵の縦と横の比（PNG の頭に書いてある幅と高さから）。画面の幅いっぱいに置き、高さはこの比で決める。絵がなければ、前の灰色の板の高さ（幅 390px で 336px） */
const RATIO = png ? png.readUInt32BE(20) / png.readUInt32BE(16) : 336 / 390

/** キーボードを出す（on）・しまう。出したキーボードの高さ（px）を返す。id：置く要素の id */
export function showPhoneKeyboard(page, on, id = 'fake-kb') {
  return page.evaluate(
    async (on, image, ratio, id) => {
      document.getElementById(id)?.remove()
      const height = Math.round(window.innerWidth * ratio)
      if (on) Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => window.innerHeight - height })
      else delete window.visualViewport.height
      window.visualViewport.dispatchEvent(new Event('resize'))
      if (!on) return 0
      const k = document.createElement(image ? 'img' : 'div')
      k.id = id
      Object.assign(k.style, { position: 'fixed', left: '0', bottom: '0', width: '100%', height: `${height}px`, zIndex: '200', pointerEvents: 'none' })
      if (image) {
        k.alt = ''
        k.src = image
      } else {
        k.textContent = 'キーボード'
        Object.assign(k.style, { background: '#d3d6dc', color: '#6b6f78', display: 'grid', placeItems: 'center', font: '15px sans-serif' })
      }
      document.body.append(k)
      if (image) await k.decode().catch(() => {})
      return height
    },
    on,
    IMAGE,
    RATIO,
    id,
  )
}
