import { fromMaterialTable } from './table'
import type { Chapter, ParagraphBlock, Report } from './types'
import { DATA_FORMAT_VERSION } from './types'

/**
 * 見本用の架空の報告書（シンドバッドの衣装）。画面の確認やテストに使う。
 * セルフチェックの指摘が出るよう、わざと誤りを含めている。
 */

const p = (id: string, text: string): ParagraphBlock => ({ type: 'paragraph', id, content: [{ type: 'text', text }] })

const body: Chapter[] = [
  {
    id: 'c1',
    title: '企画・立案',
    blocks: [
      { type: 'subheading', id: 's1', title: '担当衣装のキャラクター' },
      p('p1', '筆者が担当したのは、物語の主人公である船乗りシンドバッドの衣装である。七つの航海を経て成長していく人物であり、場面ごとに異なる表情を見せる。私は、旅立ちの場面の若々しさと、帰還の場面の頼もしさの両方を衣装で表したいと考えた。'),
      { type: 'subheading', id: 's2', title: 'デザイン説明' },
      p('p2', '１５世紀ごろの中東の装いをもとに、航海の力強さと冒険心を表すデザインを考えた（図1）。キーワードは自由、勇気、海である。袖は風をはらむように大きく膨らませ、腰には幅の広い帯を巻いた。帯には波の模様を刺繍で入れ、海の青と砂の金。'),
      { type: 'figureRow', id: 'r1', figures: [{ id: 'f1', imageId: '', caption: 'デザイン画' }] },
      { type: 'subheading', id: 's3', title: '使用素材' },
      p('p3', '表1に使用した素材をまとめる。'),
      fromMaterialTable({
        id: 't1',
        caption: '使用素材表',
        rows: [
          { id: 'm1', name: 'コットンサテン', usage: 'ジャケット', swatchImageId: null },
          { id: 'm2', name: 'シルクシフォン', usage: '袖\n帯', swatchImageId: null },
          { id: 'm3', name: 'ブロード', usage: 'シャツ', swatchImageId: null },
        ],
      }),
    ],
  },
  {
    id: 'c2',
    title: '制作過程',
    blocks: [
      { type: 'subheading', id: 's4', title: 'ジャケット' },
      p('p4', '前身頃には金のブレードを縫い付けました。衿は３段に重ね、裏には補強の芯を入れた。ボタンは貝を模したもので、全部で12個を製作した。'),
      p('p5', '袖口には指導の山田先生に教わった技法で、細かいピンタックを施した。セーラ―カラーの縁には6㎜幅のテープを使った。'),
    ],
  },
  {
    id: 'c3',
    title: 'まとめ',
    blocks: [
      p('p6', '今回の衣装制作では、物語の主人公らしい華やかさと、旅人らしい動きやすさを両立させることを目標とした。何度もデザインを練り直し、他コースの意見も取り入れながら完成させることができた。'),
    ],
  },
]

export function demoReport(): Report {
  return {
    formatVersion: DATA_FORMAT_VERSION,
    fiscalYear: 2026,
    basicInfo: { studentId: '23FA0123', name: '文化　花子', courseId: 'film-stage-costume', subtitleInput: 'シンドバッド' },
    abstract: {
      paragraphs: [
        p('a1', '本制作報告書は、卒業イベント「シンドバッド」において、筆者が制作したシンドバッドの衣装についてである。七つの航海を経て成長していく主人公の姿を、衣装で表すことを目標とした。'),
        p('a2', '中東の伝統的な装いをもとに、航海の力強さと冒険心を表すデザインを考えた。キーワードは自由、勇気、海である。袖は風をはらむように大きく膨らませ、腰には波の模様を刺繍した幅の広い帯を巻いた。ジャケットの前身頃には金のブレードを縫い付け、衿は3段に重ねて華やかさを出した。'),
        p('a3', '制作を通して、物語の場面に合わせて衣装の見え方を考えることの大切さを学んだ。'),
      ],
    },
    body,
    references: [
      { type: 'book', id: 'ref1', author: '文化花子', title: '中東の服飾史', publisher: '文化出版', year: '2020', pages: '17-24' },
      { type: 'web', id: 'ref2', siteTitle: 'シンドバッド - Wikipedia', url: 'https://ja.wikipedia.org/wiki/シンドバッド', accessedOn: '2026-08-18' },
    ],
    workPhotos: { layout: 2, imageIds: [] },
    updatedAt: '2026-10-05T00:00:00.000Z',
  }
}
