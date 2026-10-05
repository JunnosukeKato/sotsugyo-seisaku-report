// デザイン案（v8）の見本データ：コースごとの下書きのひな形。
// 映画・舞台衣装デザイナー以外のひな形は、見た目を確かめるための架空の例（実際の内容は各コースの先生が決める）
export const COURSES = [
  {
    id: 'film',
    name: '映画・舞台衣装デザイナー',
    abstractExample: '本制作報告書は、卒業イベント「シンドバッド」において、筆者が制作した〇〇の衣装についてである。',
    blocks: [
      { type: 'chapter', title: '企画・立案' },
      { type: 'sub', title: '担当衣装のキャラクター' },
      { type: 'para', hint: '担当したキャラクターの性格や、物語の中での役割を書く' },
      { type: 'sub', title: 'デザイン説明' },
      { type: 'para', hint: 'デザインのもとにした時代・地域の装いと、込めた意図を書く' },
      { type: 'figure', hint: 'デザイン画' },
      { type: 'sub', title: '使用素材' },
      { type: 'table', caption: '使用素材表' },
      { type: 'chapter', title: '制作過程' },
      { type: 'para', hint: 'パターン・縫製・装飾など、作った順に工夫した点を書く' },
      { type: 'chapter', title: 'まとめ' },
      { type: 'para', hint: '完成した衣装を振り返り、できたこと・課題を書く' },
    ],
  },
  {
    id: 'producer',
    name: 'プロデューサー・ジャーナリスト',
    abstractExample: '本制作報告書は、卒業イベント「シンドバッド」において、筆者が担当した〇〇の企画と運営についてである。',
    blocks: [
      { type: 'chapter', title: '企画の概要' },
      { type: 'sub', title: '目的' },
      { type: 'para', hint: '企画の目的と、届けたい相手（来場者など）を書く' },
      { type: 'sub', title: '担当した仕事' },
      { type: 'para', hint: '自分が担当した範囲と、ほかの担当との関わりを書く' },
      { type: 'chapter', title: '取材・制作の過程' },
      { type: 'para', hint: '取材・広報・運営で行ったことを、時間の順に書く' },
      { type: 'figure', hint: '制作物（ポスター・冊子など）' },
      { type: 'chapter', title: '成果と考察' },
      { type: 'para', hint: '来場者の反応などの成果と、次に生かすことを書く' },
    ],
  },
  {
    id: 'stylist',
    name: 'スタイリスト・コーディネーター',
    abstractExample: '本制作報告書は、卒業イベント「シンドバッド」において、筆者が担当した〇〇のスタイリングについてである。',
    blocks: [
      { type: 'chapter', title: 'スタイリングの企画' },
      { type: 'sub', title: 'テーマとイメージ' },
      { type: 'para', hint: 'スタイリングのテーマと、参考にしたイメージを書く' },
      { type: 'figure', hint: 'イメージボード' },
      { type: 'sub', title: 'アイテムの選定' },
      { type: 'para', hint: '選んだアイテムと、選んだ理由を書く' },
      { type: 'chapter', title: '当日までの準備' },
      { type: 'para', hint: 'フィッティング・小物の準備など、行ったことを書く' },
      { type: 'chapter', title: 'まとめ' },
      { type: 'para', hint: '本番を振り返り、できたこと・課題を書く' },
    ],
  },
]

const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ']
const SMALL = ['ⅰ', 'ⅱ', 'ⅲ', 'ⅳ', 'ⅴ', 'ⅵ', 'ⅶ', 'ⅷ']

/** ひな形の見出しに番号を付けた一覧（Ⅰ．企画・立案 など） */
export function numbered(blocks) {
  let ch = -1
  let sub = -1
  let fig = 0
  let tab = 0
  return blocks.map((b) => {
    if (b.type === 'chapter') {
      ch += 1
      sub = -1
      return { ...b, label: `${ROMAN[ch]}．${b.title}` }
    }
    if (b.type === 'sub') {
      sub += 1
      return { ...b, label: `${SMALL[sub]}．${b.title}` }
    }
    if (b.type === 'figure') return { ...b, label: `図${++fig}．` }
    if (b.type === 'table') return { ...b, label: `表${++tab}．${b.caption}` }
    return b
  })
}

/** ひな形から、学生が最初に見る本文の1ページ目（紙面）を作る */
export function draftPage(course) {
  const items = numbered(course.blocks)
    .map((b) => {
      if (b.type === 'chapter') return `<h1>${b.label}</h1>`
      if (b.type === 'sub') return `<h2>${b.label}</h2>`
      if (b.type === 'para') return `<p class="hint">（${b.hint}）</p>`
      if (b.type === 'figure') return `<figure><div class="ph">${b.hint}の写真</div><figcaption>${b.label}${b.hint}</figcaption></figure>`
      if (b.type === 'table') return `<div class="tcap">${b.label}</div><table><tr><th>名称</th><th>使用箇所</th><th>生地見本</th></tr><tr><td class="g">（名称）</td><td class="g">（使用箇所）</td><td></td></tr></table>`
      return ''
    })
    .join('')
  return `<div class="paper">${items}<div class="pno">1</div></div>`
}
