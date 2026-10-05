// PoC 用の見本データ。
// - 2025年度サンプル（src/poc/fixtures/*.private.json。他人の作品のため Git の管理対象外）
// - 架空の文章（どこでも使える。セルフチェックの指摘が出るよう、わざと誤りを含めている）
import type { FigureSize } from '../layout/bodyHtml'
import type { BodyBlock, Chapter, MaterialTableBlock } from '../model/types'

// サンプル PDF から測った図のおおよその大きさ（mm）
export const SAMPLE_FIGURE_SIZES: Record<string, FigureSize> = {
  デザイン画: { widthMm: 57, heightMm: 84 },
  ジャケット前: { widthMm: 40, heightMm: 56 },
  ジャケット後ろ: { widthMm: 40, heightMm: 55 },
  シャツ: { widthMm: 38, heightMm: 48 },
  アスコットタイ: { widthMm: 54, heightMm: 47 },
  パンツ: { widthMm: 56, heightMm: 41 },
  ベスト: { widthMm: 47, heightMm: 52 },
  帽子: { widthMm: 64, heightMm: 41 },
  靴: { widthMm: 62, heightMm: 61 },
  仮面: { widthMm: 65, heightMm: 42 },
  葬式用コート: { widthMm: 47, heightMm: 60 },
  葬式用帽子: { widthMm: 60, heightMm: 56 },
}

export const SAMPLE_MATERIAL_TABLE: MaterialTableBlock = {
  type: 'materialTable',
  id: 'table-materials',
  caption: '使用素材表',
  rows: [
    ['ポリエステル\nジャガード', 'ジャケット身頃\n衿'],
    ['プレミアムフラノ', '帽子\n袖'],
    ['T/Cブロード', 'シャツ'],
    ['ウォッシャブル\nアムンゼン', 'パンツ'],
    ['プレミアムフラノ', 'ベスト'],
    ['シルク羽二重', 'フリル'],
  ].map(([name, usage], i) => ({ id: `m${i}`, name, usage, swatchImageId: `swatch${i}` })),
}

export const PLACEHOLDER_IMAGE =
  'data:image/svg+xml,' +
  encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#d9d9d9"/></svg>')

interface PocFixture {
  chapters: Chapter[]
}

const fixtures = import.meta.glob<PocFixture>('./fixtures/*.private.json', { eager: true, import: 'default' })

/** 2025年度サンプルの本文（なければ null）。素材表は抽出できないため、紹介文の直後に差し込む */
export function sampleChapters(): Chapter[] | null {
  const fixture = Object.values(fixtures)[0]
  if (!fixture) return null
  return fixture.chapters.map((c) => ({
    ...c,
    blocks: c.blocks.flatMap((b): BodyBlock[] => (b.id === 'p-table-intro' ? [b, SAMPLE_MATERIAL_TABLE] : [b])),
  }))
}

const p = (id: string, text: string): BodyBlock => ({ type: 'paragraph', id, content: [{ type: 'text', text }] })

/** 架空の文章（シンドバッドの衣装）。セルフチェックの指摘が出る誤りを含む */
export function demoChapters(): Chapter[] {
  return [
    {
      id: 'c1',
      title: '企画・立案',
      blocks: [
        { type: 'subheading', id: 's1', title: '担当衣装のキャラクター' },
        p('p1', '筆者が担当したのは、物語の主人公である船乗りシンドバッドの衣装である。七つの航海を経て成長していく人物であり、場面ごとに異なる表情を見せる。私は、旅立ちの場面の若々しさと、帰還の場面の頼もしさの両方を衣装で表したいと考えた。'),
        { type: 'subheading', id: 's2', title: 'デザイン説明' },
        p('p2', '１５世紀ごろの中東の装いをもとに、航海の力強さと冒険心を表すデザインを考えた（図1）。キーワードは自由、勇気、海である。袖は風をはらむように大きく膨らませ、腰には幅の広い帯を巻いた。帯には波の模様を刺繍で入れ、海の青と砂の金。'),
        { type: 'figureRow', id: 'r1', figures: [{ id: 'f1', imageId: '', caption: 'デザイン画' }] },
      ],
    },
    {
      id: 'c2',
      title: '制作過程',
      blocks: [
        { type: 'subheading', id: 's3', title: 'ジャケット' },
        p('p3', '前身頃には金のブレードを縫い付けました。衿は３段に重ね、裏には補強の芯を入れた。ボタンは貝を模したもので、全部で12個を製作した。'),
        p('p4', '袖口には指導の山田先生に教わった技法で、細かいピンタックを施した。セーラ―カラーの縁には6㎜幅のテープを使った。'),
      ],
    },
    {
      id: 'c3',
      title: 'まとめ',
      blocks: [
        p('p5', '今回の衣装制作では、物語の主人公らしい華やかさと、旅人らしい動きやすさを両立させることを目標とした。何度もデザインを練り直し、他コースの意見も取り入れながら完成させることができた。'),
      ],
    },
  ]
}
