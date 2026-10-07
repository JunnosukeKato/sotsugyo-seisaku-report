// デザイン案 v27：ツールの中の「？ 使い方」に入れる項目（学生用 16・教員用 10）と、言葉で探すしくみ。
// 中身は、今の手引き（docs/手引き_学生用.html・docs/手引き_教員用.html）から短くしたもの。1つの項目は、数行まで。
// 言葉で探す：入れた言葉（空白で区切る）が、項目の題・文に「そのまま入っているか」を数えるだけ（AI ではない・どこにも送らない）。
//   全角・半角と、英字の大文字・小文字の違いだけはそろえる（ＰＤＦ → pdf）。words は、文に出てこないが学生がよく使う言い方
// 画面の画像（shot）は docs/guide-images/ のもの。動画（video）は、あとで作る（音なし・字幕つき 20〜40秒。今は「準備中」の見本）
// ブラウザ（window）と Node（globalThis）のどちらで読んでも使える
;(function (g) {
  const student = [
    // ---------------- はじめる ----------------
    {
      id: 'login', group: 'はじめる', title: 'はじめ方・ログインできない',
      lead: '大学の Google アカウント（@bunka-wu.ac.jp）でログインします。',
      items: [
        { h: 'ログインできないとき', t: 'LINE・Instagram などのアプリの中では開けません。Safari・Chrome で開き直します。' },
        { h: 'ログインの窓が出ないとき', t: 'ブラウザのポップアップを許可します。' },
      ],
      shot: 'g-login.jpg', shotCap: 'ログインの窓',
      words: 'はじめて 開けない アカウント',
    },
    {
      id: 'relogin', group: 'はじめる', title: 'もう一度ログイン',
      lead: 'ログインの許可は、約1時間で切れます。「ログインし直す」を押します。',
      items: [{ h: '書いた分は？', t: 'この端末に残っています。消えません。' }],
      shot: 'g-relogin.jpg', shotCap: '「もう一度ログインしてください」の窓',
      words: '切れた ログアウト',
    },
    // ---------------- 書く ----------------
    {
      id: 'write', group: '書く', title: '書き方（クリックして書く）',
      lead: '紙面の文をクリック（スマホはタップ）すると、その場で書けます。',
      steps: ['Enter で次の段落へ', '薄い字は「何を書くか」の説明。書くと消えます', '見出しは、道具の「小見出し」「大見出し」'],
      shot: 'g-write.jpg', shotCap: '段落を書いているところ', video: 25,
      words: '入力 文字 段落 見出し 打てない',
    },
    {
      id: 'figure', group: '書く', title: '図・表の入れ方',
      lead: '文中の入れたい位置をクリックしてから、道具の「図を入れる」「表を入れる」。',
      steps: ['本文に「（図1）」、すぐ下に図が入ります', '図を押すと「差し替え」「削除」が出ます'],
      video: 30,
      words: '写真 画像 素材表 押せない',
    },
    {
      id: 'photos', group: '書く', title: '作品写真',
      lead: '作品写真のページの枠をクリックして、写真を選びます。',
      steps: ['並べ方は、道具で選びます', '写真をつかんで動かすと、見える位置が変わります'],
      video: 20,
      words: '画像 並べ方',
    },
    {
      id: 'abstract', group: '書く', title: '抄録（先生の許可）',
      lead: '本文を書き終えて、先生の許可が出てから書きます。',
      steps: ['抄録のページの「先生の許可が出た」を押す', '押すまで、抄録のページは PDF に入りません'],
      shot: 'g-abstract.jpg', shotCap: '抄録のページ',
      words: '要旨 許可',
    },
    {
      id: 'word', group: '書く', title: 'Word からの移し方（今年度だけ）',
      lead: '右の欄（スマホはメニュー）の「Word で書いた分を読み込む」から。',
      steps: ['本文の Word（04_本文.docx）を選ぶ', '中身を確かめて「読み込む」', '「つぎにすること」の3つを確かめる'],
      shot: 'g-word.jpg', shotCap: 'はじめての案内の「Word で書いた？」', video: 40,
      words: 'docx ワード 読み込み 移す',
    },
    // ---------------- 確かめる・直す ----------------
    {
      id: 'check', group: '確かめる・直す', title: 'セルフチェック（エラー・警告）',
      lead: '手順書のルールに合っているかを、ツールが確かめます。',
      items: [
        { h: '× エラー', t: '0件にしないと、提出用の PDF を書き出せません。' },
        { h: '! 警告', t: '確かめて、よければそのままで。' },
        { h: '直す', t: '押すと、正しい形に直ります。' },
        { h: 'このままにする', t: '「補助」の指摘で、書いたとおりで正しいとき。' },
      ],
      shot: 'g-check.jpg', shotCap: '右の欄のセルフチェック', video: 30,
      words: '指摘 間違い 赤い 消えない',
    },
    {
      id: 'undo', group: '確かめる・直す', title: '原稿を前に戻す（元に戻す・自動の控え）',
      lead: '直前の操作は、道具の「元に戻す」で戻せます。',
      items: [{ h: 'もっと前に戻すとき', t: '「バックアップ」→ 自動の控え（10分ごと）→「この時点に戻す」。' }],
      shot: 'g-backup.jpg', shotCap: '「バックアップ」の窓', video: 25,
      words: '消えた なくなった 戻したい 消した',
    },
    // ---------------- 保存と端末 ----------------
    {
      id: 'save', group: '保存と端末', title: '自動保存とドライブ',
      lead: '書くたびに、この端末と自分の Google ドライブに保存されます。',
      items: [
        { h: '時刻', t: '「ドライブに保存 14:32」は、最後に保存した時刻です。' },
        { h: '家のパソコン・スマホで', t: '同じアカウントでログインすれば、続きが開きます。' },
      ],
      shot: 'g-drive.jpg', shotCap: '保存のようす',
      words: '保存されない 保存ボタン',
    },
    {
      id: 'shared', group: '保存と端末', title: '共用のパソコン',
      lead: '使い終わったら、原稿をこの端末から消します。',
      steps: ['「ドライブに保存」を押す', '「この端末から原稿を消す」', 'Google からもログアウト'],
      shot: 'g-drive.jpg', shotCap: '「ドライブに保存」を押したところ',
      words: '大学のパソコン 学校 消す',
    },
    {
      id: 'tabs', group: '保存と端末', title: '2つのタブ',
      lead: '2つのタブで開くと、あとから開いた方では書けません。',
      items: [{ h: 'すること', t: 'もう一方を閉じて「こちらで続ける」。' }],
      shot: 'g-tablock.jpg', shotCap: '「別のタブで開いています」',
      words: '書けない タブ',
    },
    {
      id: 'conflict', group: '保存と端末', title: '別の端末で書いた原稿',
      lead: '2つの端末で書いて食い違うと、どちらで続けるかを聞かれます。',
      items: [{ h: 'どちらを選ぶ？', t: 'ふつうは「新しい」の印の方。選ばなかった方も、自動の控えに残ります。' }],
      shot: 'g-conflict.jpg', shotCap: 'どちらで続けるかを聞く窓',
      words: 'スマホ 家 食い違い 消えた 古い',
    },
    // ---------------- PDF ----------------
    {
      id: 'pdf', group: 'PDF', title: 'PDF の出し方（端末ごと）',
      lead: 'エラーを0件にしてから書き出します。',
      steps: ['「PDFを書き出す」を押す（スマホは「PDF」）', '3つにチェック →「印刷の画面を開く」', '印刷の画面で、PDF に保存（下の手順）'],
      devices: [
        { id: 'pc', label: 'パソコン', lines: ['送信先：PDF に保存', '用紙：A4・倍率：既定', '背景のグラフィック：オン'] },
        { id: 'mac', label: 'Mac', lines: ['詳細を表示 → 用紙：A4', '「背景をプリント」を入れる', '左下の PDF →「PDF として保存」'] },
        { id: 'iphone', label: 'iPhone', lines: ['共有（□↑）→「ファイル」に保存', '場所を選んで「保存」', 'うまく出ないときは、パソコンで'] },
        { id: 'android', label: 'Android', lines: ['プリンター：PDF 形式で保存', '用紙：A4 → PDF のボタン'] },
      ],
      items: [{ h: '提出用の PDF が出ないとき', t: 'エラーが残っています。セルフチェックで × を0件に。' }],
      shot: 'g-export.jpg', shotCap: 'エラーが0件のときに出る窓', video: 35,
      related: ['draft', 'check'],
      words: '提出 印刷 書き出し 保存できない',
    },
    {
      id: 'draft', group: 'PDF', title: '下書きの PDF',
      lead: '途中経過を先生に見せるときに使います。',
      steps: ['「PDFを書き出す」→「下書きの PDF を書き出す」', 'どのページにも「下書き」の透かし（提出には使えません）'],
      items: [{ h: '提出用が出ないとき', t: 'エラーが残っていても、下書きなら出せます。' }],
      shot: 'g-export-draft.jpg', shotCap: 'エラーが残っているときの窓',
      words: '途中点検 見せる 透かし',
    },
    // ---------------- そのほか ----------------
    {
      id: 'tour', group: 'そのほか', title: '指差し確認をもう一度見る',
      lead: '画面のどこに何があるかを、もう一度たどります（1分ほど）。',
      action: 'いま見る',
      words: 'ツアー 案内 画面の見かた',
    },
  ]

  const teacher = [
    {
      id: 't-open', group: '管理ページ', title: '管理ページの開き方と役割',
      lead: '大学の Google アカウントでログイン。登録された先生だけが開けます。',
      items: [
        { h: '管理者', t: '年度の設定・新年度・先生の登録もできます。' },
        { h: '先生', t: 'コースのひな形・お知らせ・書き間違えやすい語。' },
      ],
      shot: 'g-admin-teacher.jpg', shotCap: '先生の画面',
      words: 'ログイン 権限',
    },
    {
      id: 't-year', group: '管理ページ', title: '年度の設定（題目・締切・コース・指導教員）',
      lead: '入力すると、右の見本（表紙と抄録）にすぐ出ます。',
      steps: ['年度を選ぶ（公開中・準備中）', '題目・最終締切・コース・指導教員を直す', '「保存して学生に反映」'],
      shot: 'g-admin-main.jpg', shotCap: '年度の設定の画面', video: 40,
      words: 'サブタイトル 締め切り',
    },
    {
      id: 't-publish', group: '管理ページ', title: '保存と反映（学生に届くまで）',
      lead: '「保存して学生に反映」を押すまで、学生には届きません。',
      items: [
        { h: '届くまで', t: '1分ほど。学生がツールを開き直すと反映されます。' },
        { h: '書き始めた学生は', t: '原稿は変わりません（ひな形は、これからコースを選ぶ学生に）。' },
      ],
      words: '反映されない 届かない 出ない 変わらない',
    },
    {
      id: 't-template', group: 'コース', title: 'コースの下書きのひな形',
      lead: '学生が最初に見る本文の組み立てを、コースごとに決めます。',
      steps: ['コースのカードの「編集する」', '見出し・説明・図の枠を直して「反映する」', '上の「保存」で学生に届きます'],
      shot: 'g-admin-template.jpg', shotCap: 'ひな形の窓', video: 40,
      words: 'テンプレート 章立て',
    },
    {
      id: 't-notice', group: 'コース', title: 'コースのお知らせ',
      lead: 'そのコースの学生のツールの、右の欄に出ます（1000字まで）。',
      items: [{ h: '気をつけること', t: '誰でも読めるので、連絡先などは書きません。' }],
      shot: 'g-admin-course.jpg', shotCap: 'コースのカード',
      words: '連絡 告知',
    },
    {
      id: 't-words', group: 'コース', title: '書き間違えやすい語',
      lead: '学生のセルフチェックで指摘し、「直す」で置き換えます（例：見頃 → 身頃）。',
      items: [{ h: '重さ', t: 'エラーは提出用の PDF を止め、注意は知らせるだけです。' }],
      shot: 'g-admin-words.jpg', shotCap: '書き間違えやすい語の窓',
      words: '誤字 用語',
    },
    {
      id: 't-newyear', group: '年度と先生', title: '新年度の準備と公開・変更履歴',
      lead: 'いまの年度をコピーして「準備中」で作り、直してから公開します。',
      steps: ['「新年度を作成」', '直して「保存」（学生にはまだ見えません）', '「この年度を学生に公開」'],
      items: [{ h: '元に戻すとき', t: '「変更履歴」→「この内容を読み込む」→ 保存。' }],
      shot: 'g-admin-history.jpg', shotCap: '変更履歴', video: 35,
      words: '来年度 履歴 戻す',
    },
    {
      id: 't-members', group: '年度と先生', title: '先生の登録',
      lead: '「先生の登録」で、メールアドレスを貼り付けます（何人分でも）。',
      items: [{ h: '役割', t: '先生／管理者を選んで登録。管理者は2人以上に。' }],
      shot: 'g-admin-members.jpg', shotCap: '先生の登録の窓',
      words: '追加 管理者',
    },
    {
      id: 't-student', group: '学生の指導', title: '学生の画面と指導（途中点検・抄録）',
      lead: '途中点検は、学生が書き出す「下書きの PDF」で見ます。',
      items: [
        { h: '抄録', t: '本文のチェックのあと、許可を出します。学生が「先生の許可が出た」を押して書きます。' },
        { h: '学生の原稿', t: '学生の端末とドライブだけにあります。先生からは見られません。' },
      ],
      shot: 'g-pc-full.jpg', shotCap: '学生の画面',
      words: '下書き 点検',
    },
    {
      id: 't-trouble', group: '学生の指導', title: '困ったとき（学生の相談・Google の障害）',
      items: [
        { h: '学生がログインできない', t: 'アプリの中ではなく Safari・Chrome で。ポップアップを許可。' },
        { h: '学生が原稿をなくした', t: '「バックアップ」→「自動の控え」。ドライブの「原稿.json」の版も。' },
        { h: '全員がログインできない', t: '管理者が「詳細設定」でドライブ保存を「止める」。直ったら「必須」に。' },
      ],
      shot: 'g-admin-switch.jpg', shotCap: '詳細設定のドライブ保存',
      words: '障害 なくした',
    },
  ]

  // ---------------- 言葉で探す ----------------
  const norm = (s) => String(s).normalize('NFKC').toLowerCase()
  /** 入れた言葉を、空白・読点で区切る */
  const termsOf = (q) => [...new Set(norm(q).split(/[\s、,・]+/).filter(Boolean))]
  /** 項目の中の、探す対象の文（label：結果に出す小見出し） */
  const units = (tp) => [
    ...(tp.lead ? [{ text: tp.lead }] : []),
    ...(tp.steps ?? []).map((s) => ({ text: s })),
    ...(tp.items ?? []).map((it) => ({ label: it.h, text: it.t })),
    ...(tp.devices ?? []).flatMap((d) => d.lines.map((l) => ({ label: d.label, text: l }))),
  ]
  /**
   * 項目を探す。1つの項目につき1件。並べ方：入れた言葉のうち、いくつが入っているか（多い順）→ 題に入っているか。
   * 文の中で言葉がいちばん多く入っている1行を、結果に出す（題と words にしか入っていなければ、最初の1行）
   */
  function search(list, q) {
    const terms = termsOf(q)
    if (!terms.length) return { terms, hits: [] }
    const hits = []
    for (const tp of list) {
      const us = units(tp)
      const inTitle = terms.filter((t) => norm(tp.title).includes(t))
      const all = norm([tp.title, ...us.map((u) => `${u.label ?? ''} ${u.text}`), tp.words ?? ''].join(' '))
      const found = terms.filter((t) => all.includes(t))
      if (!found.length) continue
      let best = us[0] ?? { text: '' }
      let bestN = -1
      for (const u of us) {
        // 題に入っていない言葉が入っている行を先に（題と合わせて、入れた言葉がみな見えるように）
        const has = terms.filter((t) => norm(`${u.label ?? ''} ${u.text}`).includes(t))
        const n = has.filter((t) => !inTitle.includes(t)).length * 2 + has.filter((t) => inTitle.includes(t)).length
        if (n > bestN) [best, bestN] = [u, n]
      }
      hits.push({ topic: tp, found, inTitle, snippet: best, score: found.length * 10 + inTitle.length * 3 + Math.max(0, bestN) })
    }
    hits.sort((a, b) => b.score - a.score)
    return { terms, hits }
  }

  g.V27_HELP = { student, teacher, search, termsOf, norm }
})(typeof window !== 'undefined' ? window : globalThis)
