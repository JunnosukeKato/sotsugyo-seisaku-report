import { demoReport } from '../model/demoReport'
import type { StoredImage } from '../model/storage'
import { fromMaterialTable } from '../model/table'
import type { BodyBlock, Chapter, InlineNode, ParagraphBlock, Report } from '../model/types'

/**
 * PDF の試し（pdf-test.html）で使う見本の原稿。図や作品写真は、その場で描いた仮の画像。
 * - 見本：src/model/demoReport.ts の見本（シンドバッドの衣装）に、仮の図・生地見本・作品写真を入れたもの
 * - 長い見本：本文 16 ページほど・図 8 枚・作品写真 6 枚（写真の多い報告書で、時間と大きさを確かめる）
 */

export interface Sample {
  report: Report
  images: StoredImage[]
}

/** 写真に似せた仮の画像（色の移り変わり・丸・細かいざらつき・「仮の画像」の文字）を JPEG にする */
async function picture(id: string, width: number, height: number, hue: number, label: string): Promise<StoredImage> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const bg = ctx.createLinearGradient(0, 0, width, height)
  bg.addColorStop(0, `hsl(${hue} 45% 78%)`)
  bg.addColorStop(1, `hsl(${(hue + 40) % 360} 40% 38%)`)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, width, height)
  // 決まった並びの丸（毎回同じ絵になるよう、乱数は使わない）
  for (let i = 0; i < 14; i++) {
    const x = ((i * 0.37 + 0.11) % 1) * width
    const y = ((i * 0.61 + 0.23) % 1) * height
    const r = (0.06 + ((i * 0.13) % 0.12)) * Math.min(width, height)
    ctx.fillStyle = `hsl(${(hue + i * 23) % 360} 55% ${40 + ((i * 7) % 35)}% / 0.55)`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  // 写真らしいざらつき（JPEG の大きさを本物の写真に近づける）
  const data = ctx.getImageData(0, 0, width, height)
  let seed = hue * 7919 + width
  for (let i = 0; i < data.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    const n = ((seed >> 16) % 17) - 8
    data.data[i] += n
    data.data[i + 1] += n
    data.data[i + 2] += n
  }
  ctx.putImageData(data, 0, 0)
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.font = `700 ${Math.round(Math.min(width, height) / 12)}px 'BIZ UDPGothic', sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, width / 2, height / 2)
  ctx.font = `${Math.round(Math.min(width, height) / 22)}px 'BIZ UDPGothic', sans-serif`
  ctx.fillText('（仮の画像）', width / 2, height / 2 + Math.min(width, height) / 9)
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('仮の画像を作れませんでした'))), 'image/jpeg', 0.88))
  canvas.width = canvas.height = 0
  return { id, blob, widthPx: width, heightPx: height }
}

/** 見本の原稿（demoReport）に、仮の図・生地見本・作品写真を入れる */
export async function demoSample(): Promise<Sample> {
  const report = demoReport()
  const images = [
    await picture('demo-fig1', 1200, 1600, 20, 'デザイン画'),
    await picture('demo-sw1', 600, 450, 200, 'コットンサテン'),
    await picture('demo-sw2', 600, 450, 280, 'シルクシフォン'),
    await picture('demo-sw3', 600, 450, 40, 'ブロード'),
    await picture('demo-ph1', 1600, 2400, 210, '作品写真 1'),
    await picture('demo-ph2', 1600, 2400, 330, '作品写真 2'),
  ]
  const swatches = ['demo-sw1', 'demo-sw2', 'demo-sw3']
  const body = report.body.map((c) => ({
    ...c,
    blocks: c.blocks.map((b): BodyBlock => {
      if (b.type === 'figureRow') return { ...b, figures: b.figures.map((f) => ({ ...f, imageId: 'demo-fig1' })) }
      if (b.type === 'table') return { ...b, rows: b.rows.map((r, i) => (i === 0 ? r : { ...r, cells: r.cells.map((cell) => (cell.id.endsWith(':swatch') ? { ...cell, imageId: swatches[i - 1] ?? null } : cell)) })) }
      return b
    }),
  }))
  return { report: { ...report, body, workPhotos: { layout: 2, imageIds: ['demo-ph1', 'demo-ph2'] } }, images }
}

/** 長い見本の文（衣装制作の報告書らしい文を、決まった順に組み合わせる） */
const SENTENCES = [
  '衣装の形は、物語の時代と場面に合わせて何度も描き直した。',
  '布の厚さと落ち感を確かめるため、同じ型紙で三種類の生地を試した。',
  '肩の線は、舞台の上で遠くからでも分かるよう、少し強調して直線的にした。',
  '縫い代は、本番の後に寸法を直せるよう、通常より広めに残しておいた。',
  '照明の下では色が明るく見えるため、生地は一段暗い色を選んだ。',
  '装飾のブレードは、手縫いでまつり付け、動いても浮かないようにした。',
  '仮縫いでは、演者に実際に動いてもらい、腕の上がり方と裾の広がりを確かめた。',
  '袖の膨らみは、薄い芯を重ねて形を保ちつつ、重くならないように工夫した。',
  '刺繍の図案は、波と星を組み合わせ、旅の長さと希望を表すものにした。',
  '色の組み合わせは、主人公の成長に合わせて場面ごとに少しずつ変えている。',
  '裏地には滑りのよい生地を使い、早替えの場面でも素早く着られるようにした。',
  '帯の結び目は、舞台の袖からでも結び直せるよう、面ファスナーで留めた。',
  '資料として、中東の伝統衣装の写真集と、博物館の所蔵品の記録を参考にした。',
  '試作の段階で、布の端がほつれやすいことが分かり、端の始末を見直した。',
  'ボタンは貝を模したものを樹脂で作り、一つずつ色を付けて仕上げた。',
  '演出の担当者と話し合い、遠景で映える大きな柄と、近くで見える細かな装飾を両立させた。',
  '本番の前に二回の衣装合わせを行い、そのたびに丈と身幅を調整した。',
  '制作の記録は、毎日写真と一緒に残し、後から工程を振り返られるようにした。',
  'まとめとして、衣装は演者と観客をつなぐものであることを改めて学んだ。',
  '今回の経験を生かし、今後は素材の選び方をさらに深く研究していきたい。',
]

function paragraph(id: string, seed: number, sentences: number, tail: InlineNode[] = []): ParagraphBlock {
  const text = Array.from({ length: sentences }, (_, i) => SENTENCES[(seed * 7 + i * 3) % SENTENCES.length]).join('')
  return { type: 'paragraph', id, content: [{ type: 'text', text }, ...tail] }
}

/** 図を参照する段落（「…（図n）。」で終わる） */
function figureParagraph(id: string, seed: number, figureIds: string[]): ParagraphBlock {
  const tail: InlineNode[] = [{ type: 'text', text: 'その様子を示す' }]
  for (const fid of figureIds) tail.push({ type: 'ref', targetId: fid, withParens: true })
  tail.push({ type: 'text', text: '。' })
  return paragraph(id, seed, 4, tail)
}

/** 長い見本：本文 16 ページほど・図 8 枚（1枚・2枚横並び）・表 1 つ・作品写真 6 枚 */
export async function longSample(): Promise<Sample> {
  const base = demoReport()
  let n = 0
  const id = (p: string) => `${p}${++n}`
  const figureNames = ['デザイン画', '配色の計画', '資料の写真', '型紙', '仮縫い', '刺繍の図案', '完成した衣装', '舞台の様子']
  const images: StoredImage[] = []
  for (const [i, name] of figureNames.entries()) {
    const portrait = i % 3 !== 1
    images.push(await picture(`long-fig${i + 1}`, portrait ? 1200 : 1600, portrait ? 1600 : 1200, (i * 47) % 360, name))
  }
  for (let i = 0; i < 3; i++) images.push(await picture(`long-sw${i + 1}`, 600, 450, (i * 90 + 30) % 360, `生地 ${i + 1}`))
  for (let i = 0; i < 6; i++) images.push(await picture(`long-ph${i + 1}`, 1600, 2400, (i * 60 + 15) % 360, `作品写真 ${i + 1}`))

  const figures = figureNames.map((caption, i) => ({ id: `lf${i + 1}`, imageId: `long-fig${i + 1}`, caption }))
  // 図の入れ方：1枚目と2枚目は横並び、ほかは1枚ずつ（8枚）
  const rows = [[figures[0], figures[1]], [figures[2]], [figures[3]], [figures[4], figures[5]], [figures[6]], [figures[7]]]
  let row = 0
  const figureRow = (): BodyBlock[] => {
    const figs = rows[row++]
    return [figureParagraph(id('lp'), row, figs.map((f) => f.id)), { type: 'figureRow', id: id('lr'), figures: figs }]
  }
  const section = (title: string, paragraphs: number, withFigure: boolean): BodyBlock[] => [
    { type: 'subheading', id: id('ls'), title },
    ...Array.from({ length: paragraphs + 1 }, () => paragraph(id('lp'), n, 6)),
    ...(withFigure ? figureRow() : []),
  ]
  const body: Chapter[] = [
    {
      id: 'lc1',
      title: '企画・立案',
      blocks: [
        ...section('担当衣装のキャラクター', 3, false),
        ...section('デザイン説明', 3, true),
        { type: 'subheading', id: id('ls'), title: '使用素材' },
        paragraph(id('lp'), 3, 2),
        fromMaterialTable({
          id: 'lt1',
          caption: '使用素材表',
          rows: [
            { id: 'lm1', name: 'コットンサテン', usage: 'ジャケット', swatchImageId: 'long-sw1' },
            { id: 'lm2', name: 'シルクシフォン', usage: '袖\n帯', swatchImageId: 'long-sw2' },
            { id: 'lm3', name: 'ブロード', usage: 'シャツ', swatchImageId: 'long-sw3' },
          ],
        }),
      ],
    },
    { id: 'lc2', title: '資料調査', blocks: [...section('時代と地域の装い', 4, true), ...section('舞台衣装としての工夫', 4, false)] },
    {
      id: 'lc3',
      title: '制作過程',
      blocks: [...section('型紙の作成', 4, true), ...section('仮縫いと補正', 4, true), ...section('ジャケット', 5, false), ...section('帯と装飾', 4, true)],
    },
    { id: 'lc4', title: '着用と調整', blocks: [...section('衣装合わせ', 4, true), ...section('照明と色の見え方', 4, false), ...section('本番での着用', 4, false)] },
    { id: 'lc5', title: 'まとめ', blocks: [paragraph(id('lp'), 17, 6), paragraph(id('lp'), 18, 5), paragraph(id('lp'), 19, 4)] },
  ]
  return {
    report: {
      ...base,
      body,
      references: [
        ...base.references,
        { type: 'book', id: 'lref3', author: '文化太郎', title: '舞台衣装の技法', publisher: '文化出版', year: '2018', pages: '45-60' },
      ],
      workPhotos: { layout: 6, columns: 2, imageIds: ['long-ph1', 'long-ph2', 'long-ph3', 'long-ph4', 'long-ph5', 'long-ph6'] },
    },
    images,
  }
}
