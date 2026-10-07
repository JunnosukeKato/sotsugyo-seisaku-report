// 通しテスト用の見本の Word（「Wordから読み込む」で使う）を作る。中身は架空（文化 花子・00ZZ0123・「―シンドバッドの衣装制作―」）。
// 学科のひな形（04_本文.docx・01_表紙.docx）と同じつくりにする：
// - 本文：1章ぶん（Ⅰ．企画・立案）を書き、2章（Ⅱ．制作過程）はひな形のまま（「〇〇〇〇」「～～～」）。
//   図は2枚（浮かせた画像を横に並べ、タイトルは文字の枠「図1 …」）、表は1つ（タイトルは文字の枠「表1 …」）
// - 表紙：表のセルに分けて書いた旧形式（「卒 業 研 究」「研究題目」）
// 読み込むと：大見出し1・小見出し3・段落3・図2・表1、ひな形から「制作過程」「まとめ」が続く。仮の文字だけの行は5行
// 使い方: node scripts/e2e/fixtures/make-word-sample.mjs
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { floatingImage, makeDocx, p, pageBreak, png, rid, table, textBox } from './docx.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const TILDES = '～'.repeat(60)

const front = png(240, 320, { figure: [47, 62, 117] })
const back = png(240, 320, { figure: [140, 60, 50] })

const body = makeDocx({
  media: { 'image1.png': front, 'image2.png': back },
  body: [
    p('Ⅰ．企画・立案'),
    p('ⅰ．担当衣装のキャラクター'),
    p(
      '　筆者が担当したのは、主人公のシンドバッドである。シンドバッドは七つの海を旅する船乗りで、明るく好奇心の強い人物として描かれている。物語の中では、困難に出会っても知恵と勇気で乗り越える役割を担う。',
    ),
    p(),
    p('ⅱ．デザイン説明'),
    p('　デザインは、中世のペルシャの船乗りの装いをもとにした（図1）。動きやすさを考えて上着は短い丈にし、腰には幅の広い帯を巻いた。後ろ姿では、帯の結び目が見えるようにした（図2）。'),
    // ひな形と同じく、空の段落に浮かせた画像を2枚並べ、下の段落にタイトルの文字の枠を2つ置く
    p(floatingImage(rid('image1.png'), { x: 702473, cx: 1447165, cy: 2045970 }), floatingImage(rid('image2.png'), { x: 3014508, cx: 1447165, cy: 2045970 })),
    p(),
    p(),
    p(),
    p(textBox('図1　デザイン画（前）', { x: 53503 }), textBox('図2　デザイン画（後ろ）', { x: 2365538 }), pageBreak),
    p('ⅲ．使用素材'),
    p(textBox('表1　使用材料表', { x: 1412875, y: 46990 }), '　表1に使用した素材をまとめる。'),
    p(),
    table([
      ['名称', '使用箇所', '生地見本'],
      ['綿ブロード', '上着', ''],
      ['サテン', '帯', ''],
      ['麻', 'ズボン', ''],
      ['', '', ''],
      ['', '', ''],
      ['', '', ''],
    ]),
    p(pageBreak),
    p('Ⅱ．制作過程'),
    p('ⅰ．〇〇〇〇'),
    p(`　${TILDES}（図3）。`),
    p(`${TILDES}（図4）。`),
    p(),
    p('ⅱ．〇〇〇〇'),
    p(TILDES),
  ].join(''),
})

const cover = makeDocx({
  body: [
    p(),
    table([
      [''],
      ['２０２６年度'],
      [''],
      ['卒 業 研 究'],
      ['', '研究題目', ''],
      ['', '卒業イベント「シンドバッド」について', ''],
      ['', '―シンドバッドの衣装制作―', ''],
      ['', '国際文化学部・国際ファッション文化学科', ''],
      ['', '映画・舞台衣装デザイナー', 'コース'],
      ['', '学籍番号　', '00ZZ0123'],
      ['', '氏　　名', '：', '文化　花子'],
      ['', '文 化 学 園 大 学', ''],
    ]),
    p(),
  ].join(''),
})

writeFileSync(join(here, 'word-sample-body.docx'), body)
writeFileSync(join(here, 'word-sample-cover.docx'), cover)
console.log(`word-sample-body.docx（${body.length} バイト）・word-sample-cover.docx（${cover.length} バイト）を作りました`)
