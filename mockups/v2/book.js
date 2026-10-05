// デザイン案（v2）共通：紙面を1ページずつ全面表示し、左右のボタンや←→キーでページを送る。
// ページ送りの動き：turn（めくる）／slide（スライド）／fade（フェード）
export function setupBook({ stage, book, indicator, prev, next, thumbs, styleSelect }) {
  const pages = [...book.querySelectorAll('.page')]
  const names = pages.map((p) => p.dataset.name)
  // ページごとの種類（cover・photos など）は、状態の切り替えで消さないよう控えておく
  const base = pages.map((p) => p.className)
  const setState = (i, state) => (pages[i].className = `${base[i]} ${state}`.trim())
  let index = 0
  let busy = false
  let style = 'turn'

  // 画面の大きさに合わせて、1ページ全体が収まる倍率にし、中央に置く（A4：794×1123px）
  const fit = () => {
    const pad = 28
    const s = Math.min((stage.clientWidth - 150) / 794, (stage.clientHeight - pad * 2) / 1123)
    book.style.transform = `translate(-50%, -50%) scale(${Math.max(0.3, s)})`
  }
  new ResizeObserver(fit).observe(stage)

  const render = () => {
    pages.forEach((_, i) => setState(i, i === index ? 'current' : ''))
    indicator.textContent = `${names[index]}（${index + 1} / ${pages.length}ページ）`
    prev.disabled = index === 0
    next.disabled = index === pages.length - 1
    thumbs?.querySelectorAll('.t').forEach((t, i) => t.classList.toggle('on', i === index))
  }

  const go = (to) => {
    if (busy || to < 0 || to >= pages.length || to === index) return
    const from = pages[index]
    const target = pages[to]
    const forward = to > index
    if (style === 'fade' || Math.abs(to - index) > 1) {
      busy = true
      setState(to, 'under')
      from.classList.add('fade-out')
      from.addEventListener('animationend', () => finish(to), { once: true })
      return
    }
    busy = true
    if (style === 'slide') {
      setState(to, `slide-in-${forward ? 'right' : 'left'}`)
      from.classList.add(`slide-out-${forward ? 'left' : 'right'}`)
      target.addEventListener('animationend', () => finish(to), { once: true })
    } else if (forward) {
      // めくる：今のページが右端から持ち上がり、左へめくれて下の次のページが見える
      setState(to, 'under')
      from.classList.add('turn-out')
      from.addEventListener('animationend', () => finish(to), { once: true })
    } else {
      // 戻る：前のページが左からめくれて戻ってくる
      setState(to, 'turn-in')
      from.classList.add('under-current')
      target.addEventListener('animationend', () => finish(to), { once: true })
    }
  }

  const finish = (to) => {
    index = to
    busy = false
    render()
  }

  prev.addEventListener('click', () => go(index - 1))
  next.addEventListener('click', () => go(index + 1))
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') go(index + 1)
    if (e.key === 'ArrowLeft') go(index - 1)
  })
  if (thumbs) {
    thumbs.innerHTML = names.map((n) => `<button class="t" title="${n}"><span></span>${n.replace(/（.*/, '')}</button>`).join('')
    thumbs.querySelectorAll('.t').forEach((t, i) => t.addEventListener('click', () => go(i)))
  }
  styleSelect?.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => {
      style = b.dataset.style
      styleSelect.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b))
    }),
  )
  render()
  fit()
}
