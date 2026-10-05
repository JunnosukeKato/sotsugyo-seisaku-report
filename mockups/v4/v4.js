// デザイン案（v4）共通：右の欄は案A。道具を紙面のそばに置く3案で使う
import { ICONS, PAGES_BOX, CHECK_BOX, start } from '../v3/v3.js'

export const SIDE_A = `
  <section class="head">
    <div class="brand">卒業制作報告書<small>2026年度</small></div>
    <div class="status">✓ 自動保存しました（14:32）</div>
    <div class="deadline-line">最終締切 1月20日（水）まで <b>あと107日</b></div>
    <div class="links"><button class="btn sm">${ICONS.handbook}手順書</button><button class="btn sm">${ICONS.backup}バックアップ</button></div>
  </section>
  ${PAGES_BOX}
  ${CHECK_BOX}
  <div class="foot"><button class="btn primary big">${ICONS.pdf}PDFを書き出す</button><small>エラーを0にしてから書き出しましょう</small></div>`

export function startV4(inset, onLayout) {
  document.getElementById('side').innerHTML = SIDE_A
  start(inset, onLayout)
  // 見本：紙面の段落をクリックすると、そこを書いている状態にする
  document.getElementById('book').addEventListener('click', (e) => {
    const el = e.target.closest('.page.current p, .page.current h2, .page.current figure, .page.current .abs-body')
    if (!el) return
    document.querySelectorAll('.page .editing').forEach((x) => x.classList.remove('editing'))
    el.classList.add('editing')
    onLayout?.()
  })
}
