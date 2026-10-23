// 画面の中の確認の窓（管理ページ：src/admin/confirm.tsx・依頼者の選択 2026-10-22 案1／学生のツール：src/app/ask.tsx・2026-10-23）に、
// 確かめのスクリプトから答える道具。前のブラウザの確認（confirm・alert）と同じく、窓が出たらすぐ答える：
// decide(言葉) が true なら進めるボタン、false なら「やめる」（知らせの窓（OK だけ）は、いつも OK）。
// 言葉は、窓に出す前の確認の言葉そのまま（窓の data-text。前の confirm の言葉と同じ）

/**
 * 確認の窓が出たら、decide で答える（ページを開く前に呼ぶ。開いたあとでもよい。1つのページに1回だけ）。
 * done(言葉)：ボタンを押し終えたあとに呼ぶ（押す前に次の操作へ進まないように：confirmQueue）
 */
export async function answerConfirms(page, decide, done = () => {}) {
  await page.exposeFunction('__e2eConfirm', (text) => decide(text))
  await page.exposeFunction('__e2eConfirmDone', (text) => done(text))
  const watch = () => {
    const answer = async (modal) => {
      if (modal.dataset.answered) return
      modal.dataset.answered = '1'
      const ok = await window.__e2eConfirm(modal.dataset.text ?? '')
      const yes = modal.querySelector('[data-confirm="ok"]')
      const no = modal.querySelector('[data-confirm="cancel"]') ?? [...modal.querySelectorAll('.row-buttons .btn')].find((b) => b.textContent.trim() === 'やめる')
      ;(ok || !no ? yes : no)?.click()
      // 押したあとの画面（窓を閉じる・押したボタンの「〜しています…」を戻す）が描き終わってから知らせる
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
      await window.__e2eConfirmDone(modal.dataset.text ?? '')
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

/**
 * 確認の窓に、1回ずつ答えを決めて答える（前の page.once('dialog') と同じ使い方）。
 * next(ok)：次に出る窓にどう答えるかを決め、その窓の言葉を返す。決めていない窓には fallback で答える
 */
export async function confirmQueue(page, fallback = false) {
  const waiting = []
  /** 答えを決めた窓（押し終えたら、言葉を返す） */
  const answering = []
  await answerConfirms(
    page,
    (text) => {
      const w = waiting.shift()
      if (!w) return fallback
      answering.push(w)
      return w.ok
    },
    (text) => answering.shift()?.resolve(text),
  )
  return { next: (ok) => new Promise((resolve) => waiting.push({ ok, resolve })) }
}
