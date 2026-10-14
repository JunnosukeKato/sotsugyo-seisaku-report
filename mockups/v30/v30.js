// デザイン案 v30：「提出前チェック」の画面を描く（見た目だけ。ファイルは読まない・何も保存しない）。
// a.html（案A 一覧）・b.html（案B 手順）・c.html（案C ページを見せる）・c2.html（案C2 ページを見せる＋指摘は右に）・
// errors.html（エラーが残っているときの決まりの比べ）が読み込む。
//   ?state=empty   開いたところ
//   ?state=word    Word だけ入れたところ（PDF はまだ）
//   ?state=loaded  Word と PDF を入れたところ（5 エラー・1 警告、作品写真はまだ、本文は Word のほうが新しい）
//   ?state=done    まとめて保存したところ
//   ?state=pdfonly PDF と作品写真だけ入れたところ（Word なし）。&req=1 は「Word が要る」決まりのとき
//   &case=long     長い原稿（本文 12ページ、18 エラー・6 警告）
//   &confirm=1     エラーが残ったまま「1つの PDF にまとめる」を押したときの、確かめの窓
//   &result=iphone 保存したあとを iPhone の形にする（「保存する」をもう一度押す。v28 と同じ）
// 決まったこと：エラーが残っていても、確かめの窓を出して、そのまままとめる（透かしなし・ファイル名はそのまま）。Word はなくてもまとめられる。
// 中身の例：衣装コースの学生（文化花子・00ZZ0123。架空）。ページの絵は pages/*.jpg（学生用ツールの見本の原稿）
;(() => {
  const q = new URLSearchParams(location.search)
  const STATE = q.get('state') || 'empty'
  const REQ = q.get('req') === '1'
  const LONG = q.get('case') === 'long'
  const CONFIRM = q.get('confirm') === '1'
  const IPHONE = q.get('result') === 'iphone'
  const LAYOUT = document.body.dataset.layout
  const PHONE = innerWidth < 760

  // ---- アイコン（src/app/icons.tsx と同じ線の太さ） ----
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`
  const IC = {
    pdf: svg('<path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4M12 11v6M9.5 14.5L12 17l2.5-2.5"/>'),
    doc: svg('<path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4M9 12h6M9 15.5h6"/>'),
    word: svg('<path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4"/><path d="M8.6 11.2l1.3 5.6 1.6-4.2 1.6 4.2 1.3-5.6"/>'),
    photo: svg('<path d="M4.5 5.5h15v13h-15zM4.5 15.5l4-4 3.5 3.5 2.5-2.5 5 4M15 9.5h.01"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    warn: svg('<path d="M12 4l9 16H3zM12 10v4.5M12 17.2v.1"/>'),
    open: svg('<path d="M14 4.5h5.5V10M19.5 4.5L11 13M17 13.5v6H4.5V7H11"/>'),
    share: svg('<path d="M12 3.5v11M8 7.5l4-4 4 4M6.5 11H5v9.5h14V11h-1.5"/>'),
    up: svg('<path d="M12 15.5v-11M7.5 9L12 4.5 16.5 9M5 15v4.5h14V15"/>'),
    plus: svg('<path d="M12 5.5v13M5.5 12h13"/>'),
    x: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
    lock: svg('<rect x="5.5" y="10.5" width="13" height="9.5" rx="1.5"/><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5"/>'),
    help: svg('<circle cx="12" cy="12" r="8.6"/><path d="M9.6 9.7a2.45 2.45 0 014.75.85c0 1.65-2.35 1.95-2.35 3.5"/><path d="M12 16.9v.15" stroke-width="2.3"/>'),
    text: svg('<path d="M8.5 6.5H19M5 10.5h14M5 14.5h14M5 18.5h9"/>'),
    pages: svg('<path d="M8 3.5h11v14H8zM5 7v13.5h10.5"/>'),
  }
  const ok = `<span class="st ok">${IC.check}</span>`
  const wn = '<i class="st wn"></i>'
  const no = '<span class="st no"></span>'
  /** ファイル名（行を分けるときは「_」のあとで分ける） */
  const fn = (name) => `<span class="fn">${name.replace(/_/g, '_<wbr>')}</span>`
  const STALE = '<span class="nb">Word のほうが新しいです。</span><span class="nb">PDF を作り直しましたか？</span>'

  // ---- 中身（その場面で、何が入っていて、何を指摘するか） ----
  const FILE = (draft) => `2026_卒業制作報告書_00ZZ0123_文化花子${draft ? '_下書き' : ''}.pdf`
  const hasWord = ['word', 'loaded', 'done'].includes(STATE)
  const hasPdf = ['loaded', 'done', 'pdfonly'].includes(STATE)
  const hasPhoto = ['done', 'pdfonly'].includes(STATE)
  const fixed = STATE === 'done' || STATE === 'pdfonly'
  const bodyPages = LONG ? Array.from({ length: 12 }, (_, i) => `long-body-${i + 1}`) : fixed ? ['body-1', 'body-2', 'body-3', 'body-4', 'body-6'] : ['body-1', 'body-2', 'body-4', 'body-6']
  // 指摘の言い回しと、エラー・警告の分け方は、学生用ツールのセルフチェック（src/checker）と同じ。
  // page：本文の何ページ目か（Word の文と PDF の文を突き合わせて分かったときだけ。分からないものは、パートまで）
  const E = (title, detail, page, more = {}) => ({ sev: 'error', title, detail, page, ...more })
  const W = (title, detail, page, more = {}) => ({ sev: 'warning', title, detail, page, ...more })
  const DESU = '「です・ます」ではなく「である」調で書く'
  const HISSHA = '一人称は「筆者」にする'
  const SEISAKU = '「製作」ではなく「制作」で統一する'
  const SUJI = '数字は半角で書く'
  const ISSUES = LONG
    ? {
        cover: [W('姓と名の間は全角の空白にする', '半角の空白 → 全角の空白（例：文化　花子）')],
        abstract: [E('抄録は600〜900字にする', '現在 512字（あと88字）')],
        body: [
          E(DESU, '「…異なる表情を見せ<mark>ます</mark>。」を「である」調に直す', 1),
          E(SEISAKU, '「衣装の<mark>製作</mark>にあたり…」→「制作」', 2),
          E('本文中に「図2」または「（図2）」を入れる', '図2「イメージボード」が本文から参照されていない', 2),
          E(DESU, '「…腕が下がって見えたため<mark>です</mark>。」→「である」', 3, { sel: true }),
          E(DESU, '「…袖幅も細くし<mark>ました</mark>。」を「である」調に直す', 3),
          E(SUJI, '全角の「<mark>３</mark>」→ 半角の「3」', 4),
          W('人名に敬称（さん・氏・女史・先生）を付けない', '人名の後の「<mark>さん</mark>」を取る', 4),
          E(HISSHA, '「…<mark>私</mark>は図案を描き直した。」→「筆者」', 5),
          E(SEISAKU, '「…<mark>製作</mark>の過程で…」→「制作」', 6),
          E('「見頃」ではなく「身頃」と書く', '「前<mark>見頃</mark>の丈を…」→「身頃」（服の胴の部分）', 6, { src: '補助' }),
          E(DESU, '「…一針ずつ刺し<mark>ました</mark>。」を「である」調に直す', 7),
          E('本文中に「図5」または「（図5）」を入れる', '図5「重ね布のシルクシフォン」が本文から参照されていない', 7),
          E(SUJI, '全角の「<mark>２０</mark>」→ 半角の「20」', 8),
          E(HISSHA, '「<mark>私たち</mark>の班では…」→「筆者ら」など', 9),
          W('体言止めを使わない', '文末を「〜である」「〜した」などで終える（「…という課題<mark>。</mark>」）', 10),
          E(SUJI, '全角の「<mark>１５</mark>」→ 半角の「15」', 11),
          W('体言止めを使わない', '文末を「〜である」「〜した」などで終える（「…学んだこと<mark>。</mark>」）', 12),
          E(HISSHA, '「<mark>私</mark>が担当したのは、物語の…」→「筆者」', null),
          E(SEISAKU, '「…<mark>製作</mark>期間は…」→「制作」', null),
          E('文末に「。」を付ける', '段落の終わりに「。」がない（「…完成とした」）', null, { src: '補助' }),
          W('人名に敬称（さん・氏・女史・先生）を付けない', '人名の後の「<mark>先生</mark>」を取る', null),
          W('画像は1ページあたり2枚程度にする', '図 26枚・本文 12ページ（目安は24枚まで）', null),
        ],
      }
    : {
        cover: [W('姓と名の間は全角の空白にする', '半角の空白 → 全角の空白（例：文化　花子）')],
        abstract: [E('抄録は600〜900字にする', '現在 512字（あと88字）')],
        body: [
          E(DESU, '「…腕が下がって見えたため<mark>です</mark>。」→「である」', 3, { sel: true }),
          E(HISSHA, '「<mark>私</mark>が担当したのは、物語の…」→「筆者」', null),
          E('本文中に「図2」または「（図2）」を入れる', '図2「イメージボード」が本文から参照されていない', 2),
          E('本文はA4で5ページ以上にする', '現在 4ページ（PDF のページの数）', null, { needsPdf: true }),
        ],
      }
  const PARTS = [
    { id: 'cover', name: '表紙', base: '01_表紙', pages: ['cover'] },
    { id: 'abstract', name: '抄録', base: '02_抄録', pages: ['abstract'] },
    { id: 'toc', name: '目次', base: '03_目次', pages: [LONG ? 'long-toc' : 'toc'] },
    { id: 'body', name: '本文', base: '04_本文', pages: bodyPages, min: 5 },
    { id: 'photo', name: '作品写真', pages: ['photo'], photo: true },
  ].map((p) => ({
    ...p,
    word: !p.photo && hasWord ? `${p.base}.docx` : null,
    pdf: !p.photo && hasPdf ? `${p.base}.pdf` : null,
    img: p.photo && hasPhoto ? 'IMG_2041.jpg' : null,
    stale: p.id === 'body' && STATE === 'loaded',
    // PDF がないうちは、どのページかは分からない
    issues: (STATE === 'word' || STATE === 'loaded' ? ISSUES[p.id] ?? [] : []).filter((i) => !i.needsPdf || hasPdf).map((i) => (hasPdf ? i : { ...i, page: null, sel: false })),
  }))
  for (const p of PARTS) p.shown = p.photo ? !!p.img : !!p.pdf
  const allIssues = PARTS.flatMap((p) => p.issues)
  const errors = allIssues.filter((i) => i.sev === 'error').length
  const warnings = allIssues.length - errors
  const totalPages = PARTS.reduce((n, p) => n + (p.shown ? p.pages.length : 0), 0)
  const tally = (cls = '') => `<span class="tally ${cls}"><b class="${errors ? 'e' : 'z'}">${errors}</b> エラー　<b class="${warnings ? 'w' : 'z'}">${warnings}</b> 警告</span>`

  // ---- 上の帯 ----
  const top = () => `<header class="top">
    <div class="brand"><span class="mark">卒</span><div><b>提出前チェック</b><small>卒業制作報告書　2026年度</small></div></div>
    <p class="sub">Word で書いた報告書を確かめて、1つの PDF にまとめます</p>
    <span class="spacer"></span>
    <span class="safe">${IC.lock}ファイルは外に送りません<small>（この端末の中だけで読みます）</small></span>
    <button class="help-btn">${IC.help}使い方</button>
  </header>`

  // ---- ファイルを入れる所 ----
  const dropBig = () => `<div class="drop big">
    <span class="d-ic">${IC.up}</span>
    <b class="d-t"><span class="pc-only">ここにファイルを入れる</span><span class="ph-only">ファイルを入れる</span></b>
    <p class="d-s">Word・PDF・作品写真を、まとめて入れられます</p>
    <button class="btn primary">ファイルを選ぶ</button>
    <ul class="d-kinds"><li>${IC.word}<b>Word</b>確かめる</li><li>${IC.pdf}<b>PDF</b>まとめる</li><li>${IC.photo}<b>写真</b>最後のページ</li></ul>
  </div>`
  const dropMini = () => `<div class="drop bar">${IC.up}<div class="d-x"><b>ファイルを足す・入れ替える</b><small>同じ場所に入れると、新しいものに替わります</small></div><button class="btn quiet">ファイルを選ぶ</button></div>`

  // ---- 1ページ目の小さな絵 ----
  const mini = (p) => (p.shown ? `<span class="mini"><img src="pages/${p.pages[0]}.jpg" alt=""></span>` : '<span class="mini none"></span>')

  // ---- 5つの置き場所（案A・スマホ） ----
  function slots() {
    const cell = (p, kind) => {
      const name = kind === 'word' ? p.word : p.pdf
      const label = kind === 'word' ? 'Word' : 'PDF'
      if (!name) {
        const text = STATE === 'empty' ? fn(`${p.base}.${kind === 'word' ? 'docx' : 'pdf'}`) : `<span>${kind === 'pdf' ? 'PDF がまだありません' : 'まだありません'}</span>`
        return `<div class="sl-f none"><span class="kd">${label}</span>${text}</div>`
      }
      const pages = kind === 'pdf' ? `<em>${p.pages.length}ページ</em>` : ''
      return `<div class="sl-f${kind === 'pdf' && p.stale ? ' stale' : ''}"><span class="kd">${label}</span>${kind === 'pdf' && p.stale ? wn : ok}${fn(name)}${pages}<button class="x" aria-label="外す">${IC.x}</button></div>`
    }
    // スマホ：そろっている所は1行にたたむ（気を付ける所だけ、ファイルを出す）
    const sum = (p) => {
      if (STATE === 'empty') return `<span class="sl-sum"><span class="off">${p.photo ? '写真' : 'Word と PDF'}</span></span>`
      if (p.photo) return `<span class="sl-sum"><span>${ok}写真</span><i class="chev">›</i></span>`
      return `<span class="sl-sum"><span class="${p.word ? '' : 'off'}">${p.word ? ok : no}Word</span><span class="${p.pdf ? '' : 'off'}">${p.pdf ? ok : no}PDF${p.pdf ? ` ${p.pages.length}ページ` : ''}</span><i class="chev">›</i></span>`
    }
    const row = (p) => {
      const head = `<div class="sl-name">${mini(p)}<b>${p.name}</b>${sum(p)}</div>`
      if (p.photo) {
        const f = p.img
          ? `<div class="sl-f wide"><span class="kd">写真</span>${ok}${fn(p.img)}<em>A4 の1ページにします</em><button class="x" aria-label="外す">${IC.x}</button></div>`
          : `<div class="sl-f wide none"><span class="kd">写真</span><span>${STATE === 'empty' ? '写真（JPEG・PNG など）' : '作品写真がまだありません'}</span>${STATE === 'empty' ? '' : '<button class="link pick">写真を選ぶ</button>'}</div>`
        return `<div class="sl ${STATE === 'empty' || p.img ? 'fold' : 'unfold'}">${head}${f}</div>`
      }
      const note = p.stale ? `<p class="sl-note">${wn}<span>${STALE}</span><button class="link">PDF を入れ替える</button></p>` : ''
      const fold = STATE === 'empty' || (!p.stale && (STATE === 'pdfonly' || (p.word && p.pdf)))
      return `<div class="sl ${fold ? 'fold' : 'unfold'}">${head}${cell(p, 'word')}${cell(p, 'pdf')}${note}</div>`
    }
    return `<section class="card slots">
      <div class="sl-h"><span></span><span><b>Word</b>チェック用</span><span><b>PDF</b>まとめる用</span></div>
      ${PARTS.map(row).join('')}
    </section>`
  }

  // ---- チェックの結果 ----
  /**
   * 指摘の1件。mode：'c' は案C（札の中に「3ページ目」）、'c2' は案C2（どこの指摘かの札。ページが分かれば「本文 3ページ目」、分からなければ「本文」）
   */
  const issueHtml = (i, part, mode = '') => {
    let chip = ''
    if (mode === 'c' && i.page) chip = `<span class="where">${i.page}ページ目</span>`
    if (mode === 'c2') chip = i.page ? `<span class="loc">${part.name} ${i.page}ページ目</span>` : `<span class="loc${part.pages.length > 1 ? ' part' : ''}">${part.name}</span>`
    return `<li class="issue${i.sev === 'warning' ? ' warning' : ''}${mode === 'c2' && i.sel ? ' sel' : ''}"><i class="dot"></i><div><span class="ttl">${i.title}<span class="src">${i.src ?? '手順書'}</span></span><span class="detail">${chip}${i.detail}</span></div></li>`
  }
  const what = () => `<ul class="what">
      <li>${IC.text}<div>文の書き方<small>「である」調・「筆者」・「制作」・数字は半角</small></div></li>
      <li>${IC.photo}<div>図と表<small>本文から「図1」のように参照しているか</small></div></li>
      <li>${IC.doc}<div>抄録と表紙<small>抄録は600〜900字・表紙の空欄</small></div></li>
      <li>${IC.pages}<div>ページの数と用紙<small>本文は5ページ以上・A4（PDF から確かめます）</small></div></li>
    </ul>`
  function checkBody(mode = '') {
    if (STATE === 'empty') return `${what()}<p class="cant"><b>ここでは、直せません</b>直すのは Word でします。PDF も、Word の「名前を付けて保存」で作ります。</p>`
    if (!hasWord)
      return `<div class="unchecked">${wn}<div><b>Word を入れていないので、チェックしていません</b><small>${REQ ? 'Word（4つ）を入れると、文の書き方などを確かめて、まとめられます。' : '文の書き方などは確かめていません。PDF から分かることだけ、確かめました。'}</small></div><button class="btn quiet">${IC.word}Word を入れて、チェックする</button></div>
        <ul class="oks"><li>${ok}本文のページの数<span>5ページ（5ページ以上）</span></li><li>${ok}抄録のページの数<span>1ページ</span></li><li>${ok}用紙の大きさ<span>どのページも A4</span></li></ul>`
    if (!allIssues.length) return `<p class="empty-ok">${ok}指摘はありません。${STATE === 'done' ? '' : '1つの PDF にまとめられます。'}</p>`
    const legend = mode === 'c2' && hasPdf ? '<p class="c2-legend"><span class="nb">指摘を押すと、そのページに枠が付きます</span><span class="nb">（ページが分かるとき）</span></p>' : ''
    return `<p class="fix-hint">${IC.word}<span><span class="nb">直すのは Word で。</span><span class="nb">直したら、もう一度ここに入れます。</span></span></p>${legend}
      ${PARTS.filter((p) => p.issues.length).map((p) => `<div class="igroup"><div class="ig-h">${p.name}<span>${p.issues.length}件</span></div><ul class="issues">${p.issues.map((i) => issueHtml(i, p, mode)).join('')}</ul></div>`).join('')}`
  }
  const checkHead = () => `<div class="sec-h"><span>チェックの結果</span>${STATE === 'empty' || !hasWord ? '' : tally()}</div>`

  // ---- 1つにまとめる（下の帯）。エラーが残っていても、まとめられる（押すと、確かめの窓） ----
  function mergeBar() {
    let cls = ''
    let name = fn(FILE(false))
    let small = `${totalPages}ページ`
    let note = ''
    let btn = `<button class="btn primary big">${IC.pdf}1つの PDF にまとめる</button>`
    if (STATE === 'empty') {
      cls = 'wait'
      name = fn('2026_卒業制作報告書_学籍番号_氏名.pdf')
      small = 'この名前で保存します（学籍番号と氏名は、表紙から読み取ります）'
      note = '<p class="m-note">PDF を入れると、まとめられます</p>'
      btn = `<button class="btn primary big" disabled>${IC.pdf}1つの PDF にまとめる</button>`
    } else if (STATE === 'word') {
      cls = 'wait'
      small = 'PDF がまだありません'
      note = '<p class="m-note">PDF は、Word の「名前を付けて保存」で作って、ここに入れます</p>'
      btn = `<button class="btn primary big" disabled>${IC.pdf}1つの PDF にまとめる</button>`
    } else if (STATE === 'loaded') {
      small = `${totalPages}ページ（作品写真はまだ）`
      note = `<p class="m-note"><b>エラーが${errors}件</b>残っています</p>`
    } else if (STATE === 'pdfonly') {
      if (REQ) {
        note = '<p class="m-note warn">Word（4つ）を入れて、チェックしてから、まとめられます</p>'
        btn = `<button class="btn primary big" disabled>${IC.pdf}1つの PDF にまとめる</button>`
      } else note = '<p class="m-note warn">チェックなしで、まとめます</p>'
    }
    return `<footer class="merge ${cls}"><div class="merge-in"><div class="m-file">${IC.pdf}<div><b>${name}</b><small>${small}</small></div></div><span class="spacer"></span>${note}${btn}</div></footer>`
  }
  /** エラーが残ったまま「1つの PDF にまとめる」を押したときの、確かめの窓（「戻って直す」が、はじめに選ばれている） */
  const confirmModal = () => `<div class="modal-backdrop"><div class="modal confirm" role="alertdialog">
      <header><h2><span class="pdf-ng">${IC.warn}</span>エラーが${errors}件残っています</h2></header>
      <p class="r-lead">このまままとめますか？</p>
      ${PARTS.some((p) => p.photo && !p.img) ? '<p class="cf-sub">作品写真も、まだありません。</p>' : ''}
      <div class="row-buttons"><span class="spacer"></span><button class="btn">このまままとめる</button><button class="btn primary focus">戻って直す</button></div>
    </div></div>`

  // ---- 保存した（v28 の「保存しました」と同じ形） ----
  function thumbs({ parts = PARTS, cols, wm = false } = {}) {
    const shown = parts.filter((p) => p.shown)
    let n = 0
    const labels = shown.map((p) => `<span class="r-l" style="--n:${p.pages.length}">${p.name}</span>`).join('')
    const figs = shown.flatMap((p) => p.pages.map((pg) => `<figure class="${wm ? 'wm' : ''}"><img src="pages/${pg}.jpg" alt=""><figcaption>${++n}<i>${p.name}</i></figcaption></figure>`)).join('')
    return `<div class="r-thumbs" style="--cols:${cols ?? n}">${labels}${figs}</div>`
  }
  const fileBox = (small, draft = false) => `<div class="pdf-file${draft ? ' draft' : ''}">${IC.pdf}<div><b>${fn(FILE(draft))}</b><small>${small}</small></div></div>`
  const SIZE = `${totalPages}ページ・3.4MB`
  const resultTitle = () => (IPHONE ? 'PDF ができました' : `<span class="pdf-ok">${IC.check}</span>保存しました`)
  const resultBody = () =>
    IPHONE
      ? `${fileBox(SIZE)}${thumbs()}<p class="r-lead">「保存する」を押して、「"ファイル"に保存」を選んでください。</p>
         <button class="btn primary pdf-save">${IC.share}保存する</button>
         <div class="row-buttons"><span class="spacer"></span><button class="btn">閉じる</button></div>`
      : `${fileBox(`${SIZE}　「ダウンロード」のフォルダ`)}${thumbs()}<p class="r-lead">開いて、ページの数と写真を確かめてください。</p>
         <div class="row-buttons"><span class="spacer"></span><button class="btn">閉じる</button><button class="btn primary">${IC.open}PDF を開く</button></div>`
  const resultModal = () => `<div class="modal-backdrop"><div class="modal" role="dialog"><header><h2>${resultTitle()}</h2><button class="close" aria-label="閉じる">×</button></header>${resultBody()}</div></div>`

  // =====================================================================
  // 案A　一覧
  // =====================================================================
  const layoutA = () => ({
    html: `${top()}
    <main class="a">
      <div class="a-left">${STATE === 'empty' ? dropBig() : dropMini()}${slots()}</div>
      <section class="card check">${checkHead()}${checkBody()}</section>
    </main>
    ${mergeBar()}${STATE === 'done' ? resultModal() : ''}${CONFIRM ? confirmModal() : ''}`,
  })

  // =====================================================================
  // 案B　手順
  // =====================================================================
  function layoutB() {
    const tile = (p) => {
      if (STATE === 'empty') return `<div class="tile none"><b>${p.name}</b>${p.photo ? '<span>写真</span>' : `<span class="fn">${p.base}</span><span>Word と PDF</span>`}</div>`
      if (p.photo) return `<div class="tile${p.img ? '' : ' none'}"><b>${p.name}</b><span>${p.img ? `${ok}写真` : `${no}まだありません`}</span></div>`
      return `<div class="tile"><b>${p.name}</b><span>${p.word ? ok : no}Word</span><span>${p.pdf ? (p.stale ? wn : ok) : no}PDF${p.pdf ? `　${p.pages.length}ページ` : ''}</span></div>`
    }
    const num = (n, cls) => `<span class="n">${cls === 'done' ? IC.check : n}</span>`
    const step = (n, cls, title, sum, body = '') => `<li class="step card ${cls}"><header>${num(n, cls)}<h2>${title}</h2><div class="sum">${sum}</div>${cls === 'done' || cls === 'note' ? '<button class="link">開く</button>' : ''}</header>${body ? `<div class="step-body">${body}</div>` : ''}</li>`
    let s1, s2, s3
    if (STATE === 'empty') {
      s1 = step(1, 'open', 'ファイルを入れる', '', `${dropBig()}<div class="tiles">${PARTS.map(tile).join('')}</div>`)
      s2 = step(2, 'wait', 'チェックを直す', 'ファイルを入れると、直すところが出ます')
      s3 = step(3, 'wait', '1つにまとめる', 'PDF がそろうと、まとめられます')
    } else if (STATE === 'loaded') {
      s1 = step(1, 'note', 'ファイルを入れる', `<span>Word 4つ・PDF 4つ</span><span class="w">${wn}本文は Word のほうが新しい</span><span class="w">${wn}作品写真がまだ</span>`)
      s2 = step(
        2,
        'open',
        'チェックを直す',
        tally(),
        `<section class="check">${checkBody()}</section><div class="step-foot"><span>直したら、① でファイルを入れ直します</span><span class="spacer"></span><button class="btn">① に戻る</button><button class="btn quiet">このまま、つぎへ</button></div>`,
      )
      s3 = step(3, 'wait', '1つにまとめる', 'エラーが残っているときは、確かめてから、まとめます')
    } else {
      s1 = step(1, 'done', 'ファイルを入れる', '<span>5つ、そろいました（9ページ）</span>')
      s2 = step(2, 'done', 'チェックを直す', '<span>指摘はありません</span>')
      s3 = step(3, 'open', '1つにまとめる', '', `<h3 class="r-title" style="margin:0 0 10px">${resultTitle()}</h3>${resultBody().replace('<button class="btn">閉じる</button>', '<button class="btn">はじめから</button>')}`)
    }
    return { html: `${top()}<main class="b"><ol class="steps">${s1}${s2}${s3}</ol></main>` }
  }

  // =====================================================================
  // 案C・C2 で使う：ページを、まとめる順に並べる
  // =====================================================================
  /** そのパートの枠（PDF・写真があればページの絵、なければ空の枠）。no：まとめた PDF での通しのページ番号 */
  function partItems() {
    let no = 0
    return PARTS.map((p) => {
      const count = p.shown ? p.pages.length : p.min && !p.photo ? p.min : 1
      const pinned = new Map()
      for (const i of p.issues) {
        if (!i.page) continue
        const at = pinned.get(i.page) ?? { n: 0, err: false, sel: false }
        pinned.set(i.page, { n: at.n + 1, err: at.err || i.sev === 'error', sel: at.sel || !!i.sel })
      }
      return Array.from({ length: count }, (_, k) => ({ part: p, k: k + 1, last: k === count - 1, img: p.shown ? p.pages[k] : null, no: p.shown ? ++no : null, pin: pinned.get(k + 1) }))
    })
  }
  /**
   * 幅 width の中に、ページを左から並べて、入りきらなければ次の段へ送る。
   * パートが1段に収まるなら途中で切らない（次の段から始める）。収まらない長いパート（本文）は、続きを次の段へ送る（「つづき」）
   */
  function packRows(width, tw, gap, ggap) {
    const rows = [[]]
    let x = 0
    for (const items of partItems()) {
      const whole = items.length * tw + (items.length - 1) * gap
      let row = rows[rows.length - 1]
      if (row.length && x + ggap + whole > width && whole <= width) {
        rows.push((row = []))
        x = 0
      }
      let seg = null
      items.forEach((it, i) => {
        let cost = seg ? gap + tw : (row.length ? ggap : 0) + tw
        if (x + cost > width && row.length) {
          rows.push((row = []))
          x = 0
          seg = null
          cost = tw
        }
        if (!seg) {
          seg = { part: it.part, items: [], first: i === 0 }
          row.push(seg)
        }
        seg.items.push(it)
        x += cost
      })
    }
    return rows
  }
  /** ページ1枚（mode 'c2' は、選んだ指摘のページに枠を付ける） */
  const pageFig = (it, mode = '') => {
    const p = it.part
    if (!it.img) {
      if (p.photo && STATE !== 'empty') return `<figure><span class="pg none add">${IC.plus}写真を入れる</span>　</figure>`
      return `<figure><span class="pg none">${p.min && it.last ? '5ページ<br>以上' : ''}</span>　</figure>`
    }
    const pin = it.pin ? `<i class="pin${it.pin.err ? '' : ' w'}">${it.pin.n}</i>` : ''
    return `<figure><span class="pg${mode === 'c2' && it.pin?.sel ? ' sel' : ''}"><img src="pages/${it.img}.jpg" alt="">${pin}</span>${it.no}</figure>`
  }
  const contHead = (s, cls) => `<header class="${cls} cont"><b>${s.part.name}<small>（つづき）${s.items[0].no ? `${s.items[0].k}〜${s.items[s.items.length - 1].k}ページ目` : ''}</small></b></header>`

  // =====================================================================
  // 案C　ページを見せる（指摘は、そのパートのページの下に付ける）
  // =====================================================================
  function layoutC() {
    const empty = STATE === 'empty'
    const seg = (s) => {
      const p = s.part
      const n = s.items.length
      const files = p.photo
        ? `<span class="${p.img ? '' : 'off'}">${p.img ? ok : no}写真</span>`
        : empty
          ? `<span class="off fn">${p.base}</span><span class="off">Word と PDF</span>`
          : `<span class="${p.word ? '' : 'off'}">${p.word ? ok : no}Word</span><span class="${p.pdf ? '' : 'off'}">${p.pdf ? (p.stale ? wn : ok) : no}PDF${p.pdf ? `　${p.pages.length}ページ` : ''}</span>`
      const note = p.stale ? `<p class="g-note">${wn}<span>${STALE}</span></p>` : ''
      const more = !empty && (p.shown || p.word) ? '<button class="g-more" aria-label="入れ替える・外す">⋯</button>' : ''
      const head = s.first ? `<header class="g-h"><b>${p.name}</b>${more}<div class="g-f">${files}</div>${note}</header>` : contHead(s, 'g-h')
      // この段にあるページの指摘（ページが分からない指摘は、パートの最初の段に付ける）
      const mine = p.issues.filter((i) => (i.page ? s.items.some((it) => it.k === i.page) : s.first))
      const issues = mine.length
        ? `<ul class="issues g-issues${n >= 6 ? ' three' : n >= 4 ? ' two' : ''}">${mine.map((i) => issueHtml(i, p, 'c')).join('')}</ul>`
        : STATE === 'loaded' && p.shown && s.first && !p.issues.length
          ? `<p class="g-ok">${ok}指摘なし</p>`
          : ''
      return `<section class="grp${p.shown ? '' : ' todo'}" style="--n:${n}">${head}<div class="g-pages">${s.items.map((it) => pageFig(it)).join('')}</div>${issues}</section>`
    }
    const head = empty
      ? dropBig()
      : STATE === 'done'
        ? `<div class="card c-saved"><h2 class="r-title">${resultTitle()}</h2>${fileBox(`${SIZE}　「ダウンロード」のフォルダ`)}<button class="btn">はじめから</button><button class="btn primary">${IC.open}PDF を開く</button></div>`
        : `${dropMini()}<div class="card c-tally"><div class="sec-h"><span>チェックの結果</span>${tally()}</div><p>直すのは Word で。直したら、もう一度ここに入れます。</p></div>`
    const cap = empty ? '<p class="c-cap">この順に並べて、1つの PDF にまとめます。入れたファイルは、名前を見て自動で分けます。</p>' : ''
    return {
      html: `${top()}<main class="c"><div class="c-top">${head}</div><div class="c-doc" id="doc"></div>${cap}</main>${STATE === 'done' ? '' : mergeBar()}${CONFIRM ? confirmModal() : ''}`,
      after() {
        const doc = document.getElementById('doc')
        const rows = packRows(doc.clientWidth, 136, 10, 26)
        doc.classList.toggle('one', rows.length === 1)
        doc.innerHTML = rows.map((r) => `<div class="c-row">${r.map(seg).join('')}</div>`).join('')
      },
    }
  }

  // =====================================================================
  // 案C2　ページを見せる＋指摘は右に（ページの並びは案C、指摘の一覧は案A と同じ）
  // =====================================================================
  function layoutC2() {
    const empty = STATE === 'empty'
    /** パートの見出しの下：入っているファイルの名前と、外す × */
    const files = (p) => {
      const x = `<button class="x" aria-label="外す">${IC.x}</button>`
      if (p.photo) return p.img ? `<span class="pf">${fn(p.img)}${x}</span>` : `<span class="pf none">${empty ? '写真' : 'まだありません'}</span>`
      return ['word', 'pdf']
        .map((kind) => {
          const name = p[kind]
          if (!name) return `<span class="pf none">${empty ? fn(`${p.base}.${kind === 'word' ? 'docx' : 'pdf'}`) : `${kind === 'word' ? 'Word' : 'PDF'} なし`}</span>`
          const stale = kind === 'pdf' && p.stale
          return `<span class="pf${stale ? ' stale' : ''}">${stale ? wn : ''}${fn(name)}${x}</span>`
        })
        .join('')
    }
    const note = (p) => (p.stale ? `<p class="p-note">${wn}<span>${STALE}</span><button class="link">PDF を入れ替える</button></p>` : '')
    const seg = (s) => {
      const p = s.part
      const n = s.items.length
      const head = s.first ? `<header class="p-h"><b>${p.name}</b><div class="p-f">${files(p)}</div>${note(p)}</header>` : contHead(s, 'p-h')
      return `<section class="grp p-seg${n >= 3 ? ' wide' : ''}${p.shown ? '' : ' todo'}" style="--n:${n}">${head}<div class="g-pages">${s.items.map((it) => pageFig(it, 'c2')).join('')}</div></section>`
    }
    /** スマホ：パートを縦に並べる。ページの絵は、その行の中だけで横に動かす */
    const partPhone = (items) => {
      const p = items[0].part
      return `<section class="pp${p.shown ? '' : ' todo'}"><div class="pp-info"><b>${p.name}</b><div class="p-f">${files(p)}</div></div><div class="pp-strip">${items.map((it) => pageFig(it, 'c2')).join('')}</div>${note(p)}</section>`
    }
    const saved = IPHONE
      ? `<div class="card c2-saved"><h2 class="r-title">PDF ができました</h2>${fileBox(SIZE)}<p class="r-lead">「保存する」を押して、「"ファイル"に保存」を選んでください。</p><button class="btn primary pdf-save">${IC.share}保存する</button></div>`
      : `<div class="card c-saved"><h2 class="r-title">${resultTitle()}</h2>${fileBox(`${SIZE}　「ダウンロード」のフォルダ`)}<button class="btn">はじめから</button><button class="btn primary">${IC.open}PDF を開く</button></div>`
    const head = empty ? dropBig() : STATE === 'done' ? saved : dropMini()
    const cap = empty ? '<p class="c-cap">この順に並べて、1つの PDF にまとめます。入れたファイルは、名前を見て自動で分けます。</p>' : ''
    const side = `<aside class="card check c2-side">${checkHead()}${checkBody('c2')}</aside>`
    return {
      html: `${top()}<main class="c2${STATE === 'done' ? ' nobar' : ''}"><div class="c2-main"><div class="c-top">${head}</div><div class="c2-doc" id="doc"></div>${cap}</div>${side}</main>${STATE === 'done' ? '' : mergeBar()}${CONFIRM ? confirmModal() : ''}`,
      after() {
        const doc = document.getElementById('doc')
        if (PHONE) {
          doc.innerHTML = `<div class="card pp-list">${partItems().map(partPhone).join('')}</div>`
          return
        }
        // 画面の高さに収まる範囲で、ページの絵をできるだけ大きくする（収まらなければ、いちばん小さい大きさで、縦に動かす）
        const width = doc.clientWidth
        for (let tw = 150; tw >= 96; tw -= 2) {
          doc.style.setProperty('--tw', `${tw}px`)
          doc.innerHTML = packRows(width, tw, 8, 20).map((r) => `<div class="c-row">${r.map(seg).join('')}</div>`).join('')
          if (document.documentElement.scrollHeight <= innerHeight) break
        }
        // 指摘の一覧が欄より長いとき：下に続くことが分かるように、欄の下をぼかす
        const sideEl = document.querySelector('.c2-side')
        sideEl.classList.toggle('more', sideEl.scrollHeight > sideEl.clientHeight + 4)
      },
    }
  }

  // =====================================================================
  // エラーが残っているとき（まとめる所だけを、3つの決まりで並べる。決まったのは (c)）
  // =====================================================================
  function layoutErrors() {
    const seven = PARTS.slice(0, 4).map((p) => ({ ...p, pages: p.id === 'body' ? ['body-1', 'body-2', 'body-4', 'body-6'] : p.pages, shown: true }))
    const head = `<div class="sec-h"><span>1つにまとめる</span><span class="tally"><b class="e">5</b> エラー　<b class="w">1</b> 警告</span></div>`
    const file = (d) => fileBox('7ページ', d)
    const a = `<section class="card err" id="err-a">${head}${file(false)}
      <p class="e-note"><b>エラーが5件</b>あります。0件にすると、まとめられます。</p>
      <div class="e-foot"><button class="btn primary big" disabled>${IC.pdf}1つの PDF にまとめる</button></div>
      <p class="ghost">先生に途中を見せるための PDF も、作れません。</p></section>`
    const b = `<section class="card err" id="err-b">${head}${file(true)}
      <p class="e-note"><b>エラーが5件</b>あります。どのページにも「下書き」の透かしが入ります（提出には使えません）。</p>
      <div class="e-foot"><button class="btn primary big">${IC.pdf}下書きの PDF にまとめる</button></div>
      ${thumbs({ parts: seven, wm: true })}</section>`
    const c = `<section class="card err" id="err-c">${head}${file(false)}
      <p class="e-note"><b>エラーが5件</b>残っています。</p>
      <div class="e-foot"><button class="btn primary big">${IC.pdf}1つの PDF にまとめる</button></div>
      <div class="ask"><b>エラーが5件残っています</b><p>このまままとめますか？</p><div class="row-buttons"><button class="btn">このまままとめる</button><button class="btn primary">戻って直す</button></div></div></section>`
    return { html: `<div class="errs">${a}${b}${c}</div>` }
  }

  const out = { a: layoutA, b: layoutB, c: layoutC, c2: layoutC2, errors: layoutErrors }[LAYOUT]()
  document.body.insertAdjacentHTML('afterbegin', out.html)
  out.after?.()
  document.documentElement.dataset.ready = '1'
})()
