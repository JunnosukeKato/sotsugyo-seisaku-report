import { describe, expect, it } from 'vitest'
import type { Chapter } from '../model/types'
import { buildBodyDocument, chapterLabel, figureCaption, numberFiguresAndTables, subheadingLabel } from './bodyHtml'

const options = {
  imageSrc: (id: string) => `img/${id}`,
  figureSize: () => ({ widthMm: 50, heightMm: 40 }),
}

const chapters: Chapter[] = [
  {
    id: 'c1',
    title: '企画・立案',
    blocks: [
      { type: 'subheading', id: 's1', title: 'デザイン説明' },
      {
        type: 'paragraph',
        id: 'p1',
        content: [
          { type: 'text', text: 'デザインを考えた' },
          { type: 'ref', targetId: 'f1', withParens: true },
          { type: 'text', text: '。' },
        ],
      },
      { type: 'figureRow', id: 'r1', figures: [{ id: 'f1', imageId: 'i1', caption: 'デザイン画' }] },
      { type: 'table', id: 't1', caption: '使用素材表', widths: 'equal', heights: 'auto', rows: [] },
    ],
  },
  {
    id: 'c2',
    title: '制作過程',
    blocks: [
      { type: 'subheading', id: 's2', title: 'ジャケット' },
      {
        type: 'figureRow',
        id: 'r2',
        figures: [
          { id: 'f2', imageId: 'i2', caption: 'ジャケット前' },
          { id: 'f3', imageId: 'i3', caption: 'ジャケット後ろ' },
        ],
      },
    ],
  },
]

describe('番号付け', () => {
  it('大見出しと小見出しはテンプレートの形式', () => {
    expect(chapterLabel(0)).toBe('Ⅰ．')
    expect(chapterLabel(2)).toBe('Ⅲ．')
    expect(subheadingLabel(0)).toBe('ⅰ．')
    expect(subheadingLabel(7)).toBe('ⅷ．')
  })

  it('図表のタイトルは手順書の形式', () => {
    expect(figureCaption('図', 1, 'デザイン画')).toBe('図1.デザイン画')
    expect(figureCaption('表', 1, '使用素材表')).toBe('表1.使用素材表')
  })

  it('図は本文全体で通し番号、表は別に数える（重複は起こらない）', () => {
    const numbers = numberFiguresAndTables(chapters)
    expect(numbers.get('f1')).toBe(1)
    expect(numbers.get('f2')).toBe(2)
    expect(numbers.get('f3')).toBe(3)
    expect(numbers.get('t1')).toBe(1)
  })
})

describe('buildBodyDocument', () => {
  const html = buildBodyDocument(chapters, options)

  const text = (s: string) => s.replace(/<[^>]+>/g, '')

  it('小見出しの番号は章ごとに振り直す', () => {
    expect(text(html)).toContain('Ⅱ．制作過程')
    expect(text(html)).toContain('ⅰ．ジャケット')
  })

  it('番号と入力部分を分け、入力部分に編集用の目印を付ける', () => {
    expect(html).toMatch(/<h1 class="chapter" id="ch-c2"><span class="num">Ⅱ．<\/span><span data-block-id="c2"[^>]*>制作過程<\/span><\/h1>/)
    expect(html).toMatch(/<figcaption><span class="num">図3.<\/span><span data-block-id="f3"[^>]*>ジャケット後ろ<\/span><\/figcaption>/)
  })

  it('図の参照は番号に置き換わり、句点は括弧の後ろに来る', () => {
    expect(html).toContain('デザインを考えた<span class="fig-ref">（図1）</span>。')
    expect(text(html)).toContain('デザインを考えた（図1）。')
  })

  it('図と表のタイトルが入る', () => {
    expect(text(html)).toContain('図3.ジャケット後ろ')
    expect(text(html)).toContain('表1.使用素材表')
  })

  it('表のセルの画像：ふつうは全体を入れ、切り抜いた画像は印（crop）と見える位置を付ける（依頼者の選択 2026-10-23 案A）', () => {
    const doc = buildBodyDocument(
      [
        {
          id: 'c',
          title: '企画',
          blocks: [
            {
              type: 'table',
              id: 't',
              caption: '使用素材表',
              widths: 'equal',
              heights: 'photo',
              rows: [
                { id: 'h', cells: [{ id: 'h1', text: '生地見本', imageId: null }] },
                { id: 'r1', cells: [{ id: 'a', text: '', imageId: 'sw1' }] },
                { id: 'r2', cells: [{ id: 'b', text: '', imageId: 'sw2', crop: { x: 20, y: 75 } }] },
              ],
            },
          ],
        },
      ],
      options,
    )
    expect(doc).toContain('<td data-cell-id="a"><img src="img/sw1" alt="">')
    expect(doc).toContain('<td data-cell-id="b"><img src="img/sw2" class="crop" style="object-position:20% 75%" alt="">')
  })

  it('入力の HTML 特殊文字はエスケープする', () => {
    const doc = buildBodyDocument(
      [{ id: 'c', title: 'A&B', blocks: [{ type: 'paragraph', id: 'p', content: [{ type: 'text', text: '<b>x</b>' }] }] }],
      options,
    )
    expect(doc).toContain('A&#38;B')
    expect(doc).not.toContain('<b>x</b>')
  })
})

describe('改ページ', () => {
  it('章の途中の改ページは改ページする。章のいちばん最後の改ページは、印だけで改ページしない（次の章はもう次のページから始まり、空のページができていた）', () => {
    const withBreaks: Chapter[] = [
      { id: 'b1', title: '一', blocks: [{ type: 'paragraph', id: 'q1', content: [{ type: 'text', text: '前' }] }, { type: 'pageBreak', id: 'pb1' }, { type: 'paragraph', id: 'q2', content: [{ type: 'text', text: '後' }] }, { type: 'pageBreak', id: 'pb2' }] },
      { id: 'b2', title: '二', blocks: [{ type: 'paragraph', id: 'q3', content: [{ type: 'text', text: '次' }] }] },
    ]
    const html = buildBodyDocument(withBreaks, options)
    expect(html).toContain('<div class="page-break" data-block-id="pb1"></div>')
    expect(html).toContain('<div class="page-break end" data-block-id="pb2"></div>')
    expect(html).toMatch(/\.page-break\.end\s*\{\s*break-after: auto;/)
  })
})
