// デザイン案（v2）用の見本の紙面（架空の内容）
const body = (text) => `<p>${text}</p>`

export function pagesHtml() {
  return [
    `<div class="page cover" data-name="表紙">
      <div class="frame">
        <div class="y">2026年度</div>
        <div class="big">卒 業 制 作</div>
        <div class="lbl">制作題目</div>
        <div class="t">卒業イベント「シンドバッド」について</div>
        <div class="st">―シンドバッドの衣装制作―</div>
        <div class="dep">国際文化学部・国際ファッション文化学科</div>
        <div class="crs">映画・舞台衣装デザイナー コース</div>
        <div class="id">学籍番号　00ZZ0123</div>
        <div class="nm">氏　名：　文化　花子</div>
        <div class="univ">文 化 学 園 大 学</div>
      </div>
    </div>`,
    `<div class="page" data-name="抄録">
      <div class="abs-h">2026年度　卒業制作　抄録</div>
      <div class="abs-row"><span>国際文化学部　国際ファッション文化学科</span><span>映画・舞台衣装デザイナー　コース</span></div>
      <div class="abs-row short">学籍番号　00ZZ0123　氏名　文化　花子</div>
      <div class="abs-row right">（指導教員　文化 太郎、学園 花子　）</div>
      <div class="abs-t">卒業イベント「シンドバッド」について</div>
      <div class="abs-st">―シンドバッドの衣装制作―</div>
      <div class="abs-body">
        ${body('本制作報告書は、卒業イベント「シンドバッド」において、筆者が制作したシンドバッドの衣装についてである。七つの航海を経て成長していく主人公の姿を、衣装で表すことを目標とした。')}
        ${body('中東の伝統的な装いをもとに、航海の力強さと冒険心を表すデザインを考えた。キーワードは自由、勇気、海である。袖は風をはらむように大きく膨らませ、腰には波の模様を刺繍した幅の広い帯を巻いた。')}
      </div>
    </div>`,
    `<div class="page" data-name="目次">
      <div>目次</div><br>
      <div class="toc">Ⅰ．企画・立案<span></span>1</div>
      <div class="toc-sub">ⅰ．担当衣装のキャラクター</div>
      <div class="toc-sub">ⅱ．デザイン説明</div>
      <div class="toc">Ⅱ．制作過程<span></span>2</div>
      <div class="toc">Ⅲ．まとめ<span></span>3</div>
    </div>`,
    `<div class="page" data-name="本文 1">
      <h1>Ⅰ．企画・立案</h1>
      <h2>ⅰ．担当衣装のキャラクター</h2>
      ${body('筆者が担当したのは、物語の主人公である船乗りシンドバッドの衣装である。七つの航海を経て成長していく人物であり、場面ごとに異なる表情を見せる。<span class="err">私は</span>、旅立ちの場面の若々しさと、帰還の場面の頼もしさの両方を衣装で表したいと考えた。')}
      <h2 class="gap">ⅱ．デザイン説明</h2>
      <div class="editing">${body('<span class="err">１５</span>世紀ごろの中東の装いをもとに、航海の力強さと冒険心を表すデザインを考えた（図1）。キーワードは自由、勇気、海である。袖は風をはらむように大きく膨らませ、腰には幅の広い帯を巻いた。')}</div>
      <figure><div class="ph"></div><figcaption>図1.デザイン画</figcaption></figure>
      <div class="pno">1</div>
    </div>`,
    `<div class="page" data-name="本文 2">
      <h1>Ⅱ．制作過程</h1>
      <h2>ⅰ．ジャケット</h2>
      ${body('前身頃には金のブレードを縫い付けた。衿は3段に重ね、裏には補強の芯を入れた。ボタンは貝を模したもので、全部で12個を制作した。')}
      ${body('袖口には細かいピンタックを施した。セーラーカラーの縁には6mm幅のテープを使った。')}
      <div class="pno">2</div>
    </div>`,
    `<div class="page photos" data-name="作品写真">
      <div class="ph"></div><div class="ph"></div>
    </div>`,
  ].join('')
}
