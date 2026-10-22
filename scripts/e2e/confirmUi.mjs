// 管理ページの確認の窓（src/admin/confirm.tsx。画面の中に出す：依頼者の選択 2026-10-22 案1）に、確かめのスクリプトから答える道具。
// 前のブラウザの確認（confirm）と同じく、窓が出たらすぐ答える：decide(言葉) が true なら進めるボタン、false なら「やめる」。
// 言葉は、窓に出す前の確認の言葉そのまま（窓の data-text。前の confirm の言葉と同じ）。admin.mjs・templateMode.mjs・trialFixesAdmin.mjs・trialMode.mjs から使う

/** 確認の窓が出たら、decide で答える（ページを開く前に呼ぶ。開いたあとでもよい） */
export async function answerConfirms(page, decide) {
  await page.exposeFunction('__e2eConfirm', (text) => decide(text))
  const watch = () => {
    const answer = async (modal) => {
      if (modal.dataset.answered) return
      modal.dataset.answered = '1'
      const ok = await window.__e2eConfirm(modal.dataset.text ?? '')
      const button = ok ? modal.querySelector('[data-confirm="ok"]') : [...modal.querySelectorAll('.row-buttons .btn')].find((b) => b.textContent.trim() === 'やめる')
      button?.click()
    }
    const scan = () => document.querySelectorAll('.confirm-modal').forEach((m) => void answer(m))
    // ページを開く前（まだ html の要素がない）から見るので、document を見る
    new MutationObserver(scan).observe(document, { childList: true, subtree: true })
    scan()
  }
  await page.evaluateOnNewDocument(watch)
  // もう開いているページにも
  await page.evaluate(watch).catch(() => {})
}
