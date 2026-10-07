// デザイン案 v27：指差し確認（案A・B・C）と「？ 使い方」（案A・B・C）の部品を作る（ブラウザで動かす）。
// help-data.js を先に読むこと。scripts/mockup-shots-v27.mjs が本物のツールに重ねて撮る。help-try.html でも使う
;(function (g) {
  const H = g.V27_HELP
  const img = (f) => `${g.V27_IMG_BASE ?? '/docs/guide-images/'}${f}`
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
  const IC = {
    help: svg('<circle cx="12" cy="12" r="8.6"/><path d="M9.6 9.7a2.45 2.45 0 014.75.85c0 1.65-2.35 1.95-2.35 3.5"/><path d="M12 16.9v.15" stroke-width="2.3"/>'),
    search: svg('<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5L20 20"/>'),
    back: svg('<path d="M14.5 5l-7 7 7 7"/>'),
    play: svg('<circle cx="12" cy="12" r="8.6"/><path d="M10.3 8.7v6.6l5.2-3.3z" fill="currentColor" stroke="none"/>'),
    left: svg('<path d="M14 6l-6 6 6 6"/>'),
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  /** 言葉の入っているところに印（黄色）を付ける */
  const hl = (s, terms) => {
    const t = esc(s)
    if (!terms || !terms.length) return t
    const re = new RegExp(terms.map((x) => esc(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi')
    return t.replace(re, (m) => `<mark class="v27-hit">${m}</mark>`)
  }
  const setOf = (who) => (who === 'teacher' ? H.teacher : H.student)
  const findTopic = (who, id) => setOf(who).find((t) => t.id === id)

  // ================= 「？ 使い方」の中身 =================

  /** 言葉で探す欄 */
  function searchBox(q, { placeholder = '言葉で探す（例：PDF 出ない）', note = true, who } = {}) {
    if (who === 'teacher') placeholder = '言葉で探す（例：反映 されない）'
    return `<div class="v27h-search${q ? ' filled' : ''}">${IC.search}<input type="text" value="${esc(q ?? '')}" placeholder="${esc(placeholder)}" aria-label="言葉で探す">${q ? '<button class="clear" aria-label="消す">×</button>' : ''}</div>${
      note ? '<p class="v27h-note">言葉が入っている項目を出します（どこにも送りません）</p>' : ''
    }`
  }

  /** 項目の一覧（まとまりごと）。selected：選んでいる項目 */
  function list(who, { selected } = {}) {
    const groups = []
    for (const t of setOf(who)) {
      let gr = groups.find((x) => x.name === t.group)
      if (!gr) groups.push((gr = { name: t.group, items: [] }))
      gr.items.push(t)
    }
    return (
      groups
        .map(
          (gr) =>
            `<div class="v27h-group"><b>${esc(gr.name)}</b><ul class="v27h-list">${gr.items
              .map(
                (t) =>
                  `<li><button class="${t.id === selected ? 'on' : ''}${t.id === 'tour' ? ' tour' : ''}" data-topic="${t.id}"><span class="tx">${esc(t.title)}</span><span class="mk">${t.video ? `<span class="vid">${IC.play}</span>` : ''}</span></button></li>`,
              )
              .join('')}</ul></div>`,
        )
        .join('') +
      `<div class="v27h-legend"><span><span class="vid">${IC.play}</span>動画あり（音なし・字幕つき）</span></div>` +
      `<p class="v27h-foot">それでも困ったら、${who === 'teacher' ? '管理者' : '担当の先生'}に相談してください。</p>`
    )
  }

  /** 動画の見本（まだない。画面の写真を暗くした上に再生の印） */
  const video = (t) =>
    `<div class="v27h-video"><div class="v27h-thumb"><span class="play"></span><span class="cc">${esc((t.steps ?? [t.lead ?? ''])[0])}</span></div><div><b>動画で見る<em>準備中</em></b><small>${t.video}秒・音なし</small></div></div>`

  /** 端末ごとの手順（device：選んでいる端末。here：いま使っている端末を選んでいると示す） */
  const devices = (t, device, terms) => {
    const on = t.devices.find((d) => d.id === device) ?? t.devices[0]
    return `<div class="v27h-dev"><div class="tabs">${t.devices.map((d) => `<button class="${d === on ? 'on' : ''}">${esc(d.label)}</button>`).join('')}</div><span class="here">✓ いま使っている端末を選んでいます</span><ul>${on.lines.map((l) => `<li>${hl(l, terms)}</li>`).join('')}</ul></div>`
  }

  /**
   * 開いた項目。wide：広い窓（文は左、動画と画面は右）。back：「一覧へ」を出す。device：端末ごとの手順で選んでいる端末。terms：探した言葉（印を付ける）
   */
  function topic(who, id, { wide = false, back = true, device, terms, backLabel = '一覧へ' } = {}) {
    const t = findTopic(who, id)
    const head = `${back ? `<button class="v27h-back">${IC.back}${esc(backLabel)}</button>` : ''}<div class="v27h-crumb">${esc(t.group)}</div><h3>${hl(t.title, terms)}</h3>`
    const body = [
      t.lead ? `<p class="v27h-lead">${hl(t.lead, terms)}</p>` : '',
      t.steps ? `<ol class="v27h-steps">${t.steps.map((s) => `<li><span>${hl(s, terms)}</span></li>`).join('')}</ol>` : '',
      t.devices ? devices(t, device, terms) : '',
      (t.items ?? []).map((it) => `<div class="v27h-item${/とき$/.test(it.h) ? ' warn' : ''}"><b>${hl(it.h, terms)}</b>${hl(it.t, terms)}</div>`).join(''),
      t.action ? `<button class="v27h-action">${IC.play}${esc(t.action)}</button>` : '',
    ].join('')
    const shot = t.shot ? `<figure class="v27h-shot"><img src="${img(t.shot)}" alt=""><figcaption>${esc(t.shotCap ?? '')}<span class="v27h-zoom">押すと大きく</span></figcaption></figure>` : ''
    const rel = t.related ? `<div class="v27h-rel">関係する項目：${t.related.map((r) => `<button>${esc(findTopic(who, r).title)}</button>`).join('')}</div>` : ''
    if (wide) return `<div class="v27h-topic wide"><div class="txt">${head}${body}${rel}</div><div class="media">${t.video ? video(t) : ''}${shot}</div></div>`
    return `<div class="v27h-topic">${head}${t.video ? video(t) : ''}${body}${shot}${rel}</div>`
  }

  /** 探した結果。selected：選んでいる結果の項目 */
  function results(who, q, { selected } = {}) {
    const { terms, hits } = H.search(setOf(who), q)
    const words = q.split(/[\s　、,]+/).filter(Boolean)
    let out = `<p class="v27h-count">${words.map((w) => `「${esc(w)}」`).join('')}が入っている項目：<b>${hits.length}件</b></p><ul class="v27h-res">`
    let partShown = false
    for (const h of hits) {
      if (!partShown && h.found.length < terms.length) {
        out += `<li class="part">一部の言葉だけ入っている項目</li>`
        partShown = true
      }
      const s = h.snippet
      // 題と出した1行に見えない言葉（「よく使われる言い方」で見つかった言葉）は、下に小さく出す
      const seen = H.norm(`${h.topic.title} ${s.label ?? ''} ${s.text}`)
      const hidden = h.found.filter((t) => !seen.includes(t))
      out += `<li><button class="${h.topic.id === selected ? 'on' : ''}" data-topic="${h.topic.id}"><span class="t">${hl(h.topic.title, terms)}${h.topic.video ? `<span class="mk">${IC.play}</span>` : ''}</span><span class="s">${s.label ? `<em>${hl(s.label, terms)}：</em>` : ''}${hl(s.text, terms)}</span>${hidden.length ? `<span class="kw">${hidden.map((t) => `<mark class="v27-hit">${esc(t)}</mark>`).join('・')} でも探せる項目</span>` : ''}</button></li>`
    }
    out += `</ul><p class="v27h-miss">見つからないときは、ほかの言葉で（例：保存・ログイン）。</p>`
    return { html: out, terms, hits }
  }

  /** 中身（mode：list・topic・search） */
  function content(o) {
    if (o.mode === 'topic') return topic(o.who, o.topic, { device: o.device, wide: o.wide, terms: o.terms })
    if (o.mode === 'search') return results(o.who, o.q, { selected: o.selected }).html
    return list(o.who, { selected: o.selected })
  }

  const head = (o, close = '<button class="v27h-close" aria-label="閉じる">×</button>') =>
    `<div class="v27h-head"><span class="v27h-title">${IC.help}使い方${o.who === 'teacher' ? '<small>先生用</small>' : ''}</span>${close}</div>`

  // ---------- 案A：右の欄が切り替わる（スマホは画面いっぱいの欄） ----------
  function shellA(o) {
    const q = o.mode === 'search' ? o.q : ''
    if (o.narrow)
      return `<div class="v27h-scrim"></div><div class="v27h v27h-sheet"><div class="grab"></div><div class="top">${head(o)}${searchBox(q, o)}</div><div class="body">${content(o)}</div></div>`
    return `<div class="v27h v27h-panel${o.dock ? ' dock' : ''}${o.admin ? ' v27-admin' : ''}"><div class="top">${head(o, '<button class="v27h-close">閉じる<span>×</span></button>')}${searchBox(q, o)}</div><div class="body">${content(o)}</div></div>`
  }

  // ---------- 案B：真ん中の大きな窓（一覧は左、中身は右。スマホは1つずつ） ----------
  function shellB(o) {
    const q = o.mode === 'search' ? o.q : ''
    if (o.narrow)
      return `<div class="v27h v27h-backdrop"><div class="v27h-modal narrow"><div class="top">${head(o)}${searchBox(q, o)}</div><div class="one">${content(o)}</div></div></div>`
    let left
    let right
    if (o.mode === 'search') {
      const r = results(o.who, o.q, { selected: o.topic })
      left = r.html
      right = topic(o.who, o.topic ?? r.hits[0].topic.id, { wide: true, back: false, device: o.device, terms: r.terms })
    } else {
      left = `${list(o.who, { selected: o.topic })}`
      right = topic(o.who, o.topic, { wide: true, back: false, device: o.device })
    }
    return `<div class="v27h v27h-backdrop${o.admin ? ' v27-admin' : ''}"><div class="v27h-modal"><div class="top">${head(o, '')}${searchBox(q, { note: false, who: o.who })}<button class="v27h-close" aria-label="閉じる">×</button></div><div class="cols"><div class="left">${left}${o.mode === 'search' ? '' : ''}</div><div class="right">${right}</div></div></div></div>`
  }

  // ---------- 案C：左から出る引き出し ----------
  function shellC(o) {
    const q = o.mode === 'search' ? o.q : ''
    const close = `<button class="v27h-close">${IC.left}閉じる</button>`
    if (o.narrow)
      return `<div class="v27h-scrim"></div><div class="v27h v27h-drawer narrow"><div class="top">${head(o, close)}${searchBox(q, o)}</div><div class="body">${content(o)}</div></div>`
    return `<div class="v27h v27h-drawer${o.admin ? ' v27-admin' : ''}"><div class="top">${head(o, close)}${searchBox(q, o)}</div><div class="body">${content(o)}</div><button class="tab" aria-label="閉じる">${IC.left}</button></div>`
  }

  /** 「？ 使い方」を出す。design：a・b・c。o：{ who, mode, topic, q, device, narrow, admin } */
  function showHelp(design, o) {
    clear()
    const html = { a: shellA, b: shellB, c: shellC }[design](o)
    if (design === 'a' && !o.narrow && !o.dock) {
      const side = document.querySelector('.side')
      side.classList.add('v27-helpmode')
      side.insertAdjacentHTML('beforeend', html)
    } else {
      document.body.insertAdjacentHTML('beforeend', `<div class="v27-layer">${html}</div>`)
    }
    // 結果・開いた項目は、いちばん上から見せる
    for (const el of document.querySelectorAll('.v27h .body, .v27h .one, .v27h .right, .v27h .left')) el.scrollTop = 0
    const left = document.querySelector('.v27h-modal .left')
    const on = left?.querySelector('.v27h-list button.on')
    if (left && on) left.scrollTop = Math.max(0, on.offsetTop - left.clientHeight / 2)
  }

  // ================= 指差し確認 =================

  const PC_STEPS = [
    { key: 'paper', title: '紙面', text: '文をクリックすると、その場で書けます。', short: 'クリックして、その場で書く' },
    { key: 'tools', title: '道具', text: '図・表は、文中をクリックしてから、ここで入れます。', short: '図・表は、文中をクリックしてから' },
    { key: 'pages', title: 'ページの一覧', text: '押すと、そのページへ。赤い点は、エラーのあるページです。', short: '赤い点は、エラーのあるページ' },
    { key: 'save', title: '保存のようす', text: '書くたびに、ドライブに自動で保存。時刻は、最後に保存した時刻です。', short: 'ドライブに自動で保存' },
    { key: 'check', title: 'セルフチェック', text: '直すところの一覧です。× を0件にします。', short: '× を0件にする' },
    { key: 'pdf', title: 'PDFを書き出す', text: 'エラーが0件になったら、ここから提出用の PDF に。', short: 'エラー0件で、提出用の PDF' },
    { key: 'help', title: '使い方', text: '困ったら、ここを押します。言葉で探せます。', short: '困ったら、ここ（言葉で探せる）' },
  ]
  const PHONE_STEPS = [
    { key: 'paper', title: '紙面', text: '文をタップすると、書く欄が出ます。', short: 'タップして書く（下に書く欄）' },
    { key: 'nav', title: 'チェックと PDF', text: '直すところの一覧と、PDF の書き出しは、ここ。', short: '直すところと、PDF の書き出し' },
    { key: 'menu', title: 'メニュー', text: '手順書・バックアップ・？使い方は、ここ。', short: '手順書・バックアップ・？使い方' },
    { key: 'save', title: '保存のようす', text: 'ドライブに自動で保存。時刻は、最後に保存した時刻です。', short: 'ドライブに自動で保存' },
  ]

  function clear() {
    for (const el of document.querySelectorAll('.v27-layer, .v27t')) el.remove()
    for (const el of document.querySelectorAll('.side.v27-helpmode')) {
      el.classList.remove('v27-helpmode')
      el.querySelector('.v27h-panel')?.remove()
    }
  }
  const layer = (narrow, cls = '') => {
    document.body.insertAdjacentHTML('beforeend', `<div class="v27t${narrow ? ' narrow' : ''} ${cls}"></div>`)
    return document.body.lastElementChild
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
  /** 範囲を画面の中（端から m px）に収める */
  const inView = (o, m = 3) => {
    const x = Math.max(m, o.x)
    const y = Math.max(m, o.y)
    return { ...o, x, y, w: Math.min(innerWidth - m, o.x + o.w) - x, h: Math.min(innerHeight - m, o.y + o.h) - y }
  }

  /** 吹き出し（el）を、範囲 r の side 側に置き、矢印を r に向ける */
  function place(el, r, side, { gap = 14, narrow = false, arrow = 9 } = {}) {
    const W = innerWidth
    const Hh = innerHeight
    // スマホ：横いっぱい（左右 10px）にしてから、高さを測る
    if (narrow) el.style.left = '10px'
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left
    let top
    if (side === 'below' || side === 'above') {
      left = narrow ? 10 : clamp(r.left + r.width / 2 - Math.min(w / 2, 60), 10, W - w - 10)
      top = side === 'below' ? r.top + r.height + gap : r.top - gap - h
      el.style.setProperty('--ax', `${clamp(r.left + r.width / 2 - left - arrow, 16, w - 34)}px`)
    } else {
      left = side === 'right' ? r.left + r.width + gap : r.left - gap - w
      top = clamp(r.top + Math.min(r.height / 2, 40) - 30, 10, Hh - h - 10)
      el.style.setProperty('--ay', `${clamp(r.top + Math.min(r.height / 2, 40) - top - arrow, 14, h - 30)}px`)
    }
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.dataset.side = side
  }

  /** 案A：スポットライト。r：光を当てる範囲。step：何番目（1から） */
  function tourA({ r, side, step, total, narrow, pad = 6 }) {
    clear()
    const s = (narrow ? PHONE_STEPS : PC_STEPS)[step - 1]
    const L = layer(narrow)
    const last = step === total
    const o = inView({ x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 })
    L.innerHTML =
      `<div class="v27t-spot" style="left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.h}px"></div>` +
      `<div class="v27t-tip"${narrow ? ' style="right:10px"' : ''}><div class="v27t-k">指差し確認<span>${step} / ${total}</span><span class="v27t-dots">${Array.from({ length: total }, (_, i) => `<i class="${i + 1 === step ? 'on' : i + 1 < step ? 'past' : ''}"></i>`).join('')}</span></div>` +
      `<h3>${esc(s.title)}</h3><p>${esc(s.text)}</p>` +
      `<div class="v27t-acts">${last ? '' : '<button class="skip">とばす</button>'}<button class="next">${last ? 'おわり' : '次へ'}</button></div>` +
      (last ? `<span class="v27t-again">もう一度見るときは、<b>？使い方</b>の中から</span>` : '') +
      `</div>`
    place(L.querySelector('.v27t-tip'), { left: o.x, top: o.y, width: o.w, height: o.h }, side, { narrow })
  }

  /** 案B：番号の付箋を一度に。spots：[{ r, at（番号の位置：tl・tr・bl・br） }]、card：{ left, top, width } */
  function tourB({ spots, card, narrow, pad = 5 }) {
    clear()
    const steps = narrow ? PHONE_STEPS : PC_STEPS
    const L = layer(narrow)
    const W = innerWidth
    const Hh = innerHeight
    const holes = spots.map((s) => inView({ ...s, x: s.r.left - pad, y: s.r.top - pad, w: s.r.width + pad * 2, h: s.r.height + pad * 2 }))
    let html = `<svg class="v27b-dim" viewBox="0 0 ${W} ${Hh}"><defs><mask id="v27b-m"><rect width="${W}" height="${Hh}" fill="#fff"/>${holes
      .map((o) => `<rect x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="10" fill="#000"/>`)
      .join('')}</mask></defs><rect width="${W}" height="${Hh}" fill="rgba(22,22,28,0.5)" mask="url(#v27b-m)"/></svg>`
    holes.forEach((o, i) => {
      html += `<div class="v27b-ring" style="left:${o.x}px;top:${o.y}px;width:${o.w}px;height:${o.h}px"></div>`
      // 番号の位置：tl・tr・bl・br は角、b は下のまん中の外、l は左のまん中の外
      const at = o.at ?? 'tl'
      const pos = {
        b: [o.x + o.w / 2 - 14, o.y + o.h + 4],
        l: [o.x - 34, o.y + o.h / 2 - 14],
      }[at] ?? [at.includes('l') ? o.x - 12 : o.x + o.w - 16, at.includes('t') ? o.y - 12 : o.y + o.h - 16]
      const nx = clamp(pos[0], 4, W - 32)
      const ny = clamp(pos[1], 4, Hh - 32)
      html += `<div class="v27b-num" style="left:${nx}px;top:${ny}px">${i + 1}</div>`
    })
    html += `<div class="v27b-card" style="left:${card.left}px;top:${card.top}px;width:${card.width}px"><div class="v27t-k">指差し確認</div><h3>画面の見かた</h3><ol>${steps
      .map((s, i) => `<li><i>${i + 1}</i><div><b>${esc(s.title)}</b><span>${esc(s.short)}</span></div></li>`)
      .join('')}</ol><div class="acts"><small>もう一度見るには<br><b>？使い方</b> →「指差し確認」</small><button>わかった</button></div></div>`
    L.innerHTML = html
    // 置いた窓の高さに合わせて、下の位置を決める（card.bottom を渡したとき）
    const c = L.querySelector('.v27b-card')
    if (card.bottom !== undefined) c.style.top = `${card.bottom - c.offsetHeight}px`
  }

  /** 案C：光る点。dots：[{ x, y, step }]、open：吹き出しを出す点の step（side：吹き出しの向き）、left：残りの数の札の位置 */
  function tourC({ dots, open, side = 'right', left, narrow, live = false }) {
    clear()
    const steps = narrow ? PHONE_STEPS : PC_STEPS
    const L = layer(narrow, live ? 'v27c-live' : '')
    let html = dots.map((d) => `<span class="v27c-dot${d.step === open ? ' hot' : ''}" style="left:${d.x}px;top:${d.y}px" title="${esc(steps[d.step - 1].title)}"></span>`).join('')
    if (left)
      html += `<div class="v27c-left" style="left:${left.x}px;${left.bottom !== undefined ? `bottom:${left.bottom}px` : `top:${left.y}px`}"><i></i>光る点 あと<b>${dots.length}</b><button>すべて消す</button></div>`
    if (open) {
      const s = steps[open - 1]
      html += `<div class="v27c-tip"><b>${esc(s.title)}</b>${esc(s.text)}<small>${narrow ? 'ここを使うと、点は消えます' : 'ここを使うと、点は消えます'}</small></div>`
    }
    L.innerHTML = html
    if (open) {
      const d = dots.find((x) => x.step === open)
      place(L.querySelector('.v27c-tip'), { left: d.x - 8, top: d.y - 8, width: 16, height: 16 }, side, { gap: 10, narrow, arrow: 6 })
    }
  }

  g.v27 = { IC, list, topic, results, searchBox, showHelp, tourA, tourB, tourC, clear, PC_STEPS, PHONE_STEPS, hl }
})(window)
