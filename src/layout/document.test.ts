import { describe, expect, it } from 'vitest'
import { currentConfig } from '../config'
import { createReport } from '../model/newReport'
import { ABSTRACT_SUBTITLE, abstractHtml, abstractRowFontPt, buildReportDocument, buildReportParts, COVER_SUBTITLE, coverHtml, fitLineFontPt, formatReference, partList, refitLineFontPt, subtitleLine, textUnits, TOC_TARGET_ATTR, TOC_TEXT, yearDigits } from './document'
import { documentCss } from './documentCss'

describe('抄録の見出し（学籍番号・氏名と指導教員を1行に）', () => {
  it('文字の幅は全角を1、半角を0.5として数える', () => {
    expect(textUnits('学籍番号　00ZZ0123')).toBe(9)
  })

  it('1行に収まる文字の大きさを選ぶ（短ければ10pt、指導教員3名なら9pt）', () => {
    expect(abstractRowFontPt('学籍番号　00ZZ0123　　氏名　文化　花子', '（指導教員　文化　太郎　）')).toBe(10)
    expect(abstractRowFontPt('学籍番号　00ZZ0123　　氏名　文化　花子', '（指導教員　梶田　貴子、佐藤　綾、加藤　淳之介　）')).toBe(9)
  })

  it('学籍番号・氏名と指導教員を同じ行（左と右）に出す', () => {
    const report = createReport(currentConfig)
    report.basicInfo = { ...report.basicInfo, studentId: '00ZZ0123', name: '文化　花子' }
    const html = abstractHtml(report, currentConfig)
    expect(html).toMatch(/<div class="el row row3" style="font-size:9pt"><span class="student">学籍番号　00ZZ0123　　氏名　文化　花子<\/span><span class="advisors">（指導教員　梶田　貴子、佐藤　綾、加藤　淳之介　）<\/span><\/div>/)
    expect(html).not.toContain('row4')
  })
})

describe('サブタイトルが長いとき、1行に入るまで文字を小さくする（mockups/v23 ① 案A）', () => {
  const withSubtitle = (subtitleInput: string) => {
    const report = createReport(currentConfig)
    report.basicInfo = { ...report.basicInfo, courseId: 'film-stage-costume', subtitleInput }
    return report
  }
  // 映画・舞台衣装コースの「―{入力}の衣装制作―」。決まり文句は7字
  const EIGHT = 'アラビアンナイト'
  const SIXTEEN = 'オペラ『魔笛』に登場する夜の女王'
  const TWENTY_SIX = '映画『千夜一夜物語』に登場する砂漠の王子シンドバッド'

  it('表紙：字数から見積もる。短ければ 22pt のまま、長いほど 0.5pt ずつ小さく、いちばん小さくて 11pt', () => {
    const pt = (input: string) => fitLineFontPt(subtitleLine(withSubtitle(input), currentConfig), COVER_SUBTITLE)
    expect(subtitleLine(withSubtitle(EIGHT), currentConfig)).toBe('―アラビアンナイトの衣装制作―')
    expect(pt(EIGHT)).toBe(22)
    expect(pt(SIXTEEN)).toBe(17.5)
    expect(pt(TWENTY_SIX)).toBe(12)
    expect(pt('あ'.repeat(40))).toBe(11)
    // どの大きさでも、見積もった幅は枠（144.2mm）に収まる
    for (const input of [EIGHT, SIXTEEN, TWENTY_SIX]) {
      const line = subtitleLine(withSubtitle(input), currentConfig)
      expect(textUnits(line) * pt(input) * (25.4 / 72)).toBeLessThanOrEqual(COVER_SUBTITLE.widthMm)
    }
  })

  it('表紙：組んだ紙面で測ったはみ出し（文字の幅 ÷ 枠の幅）から、入りきる大きさに直す', () => {
    // はみ出している → 比例して小さく（0.5pt 刻みで切り捨て）
    expect(refitLineFontPt(22, 1.3, COVER_SUBTITLE)).toBe(16.5)
    // 見積もりが小さすぎた（表紙の書体はかなの幅が狭い）→ 入る大きさまで大きく
    expect(refitLineFontPt(16.5, 0.93, COVER_SUBTITLE)).toBe(17.5)
    // 入っている・ちょうど → そのまま。22pt より大きくはしない
    expect(refitLineFontPt(17.5, 0.99, COVER_SUBTITLE)).toBe(17.5)
    expect(refitLineFontPt(22, 0.5, COVER_SUBTITLE)).toBe(22)
    // 測り方の細かい誤差くらいのはみ出しは見ない
    expect(refitLineFontPt(22, 1.001, COVER_SUBTITLE)).toBe(22)
    // わずかにはみ出す → 少なくとも 0.5pt 小さく
    expect(refitLineFontPt(17.5, 1.01, COVER_SUBTITLE)).toBe(17)
    // いちばん小さくしても入らない → 11pt のまま（セルフチェックのエラーになる）
    expect(refitLineFontPt(11, 1.2, COVER_SUBTITLE)).toBe(11)
    expect(refitLineFontPt(12, 1.5, COVER_SUBTITLE)).toBe(11)
    // 一度はみ出した大きさには戻さない（行ったり来たりしない）
    expect(refitLineFontPt(17, 0.97, COVER_SUBTITLE, 17.5)).toBe(17)
    // 測れなかったときは変えない
    expect(refitLineFontPt(20, 0, COVER_SUBTITLE)).toBe(20)
  })

  it('表紙：決めた大きさで、サブタイトルの行全体（決まり文句も）を組む。小さくしたときは上をあけて、文字の下を罫線の上にそろえる', () => {
    expect(coverHtml(withSubtitle(EIGHT), currentConfig)).toContain('<div class="el subtitle" style="font-size:22pt">―<span data-block-id="basic:subtitleInput"')
    expect(coverHtml(withSubtitle(SIXTEEN), currentConfig, { coverSubtitlePt: 17.5 })).toContain('<div class="el subtitle" style="font-size:17.5pt;padding-top:4.5pt">')
  })

  it('抄録の見出し：12pt から、本文の幅（150mm）の1行に入るまで小さくする（いちばん小さくて 9pt）', () => {
    const subtitleHtml = (input: string) => abstractHtml(withSubtitle(input), currentConfig).match(/<div class="el subtitle"[^>]*>[^<]*<\/div>/)?.[0]
    expect(subtitleHtml(EIGHT)).toBe('<div class="el subtitle" style="font-size:12pt">―アラビアンナイトの衣装制作―</div>')
    // 30字：37字分は 12pt（150mm に 35字ほど）では入らない
    expect(subtitleHtml('あ'.repeat(30))).toContain('style="font-size:11pt"')
    expect(fitLineFontPt('あ'.repeat(60), ABSTRACT_SUBTITLE)).toBe(9)
  })
})

describe('引用・参考文献の書き方', () => {
  const book = { type: 'book' as const, id: 'b', author: '浜松隆志', title: 'ファッションの歴史', publisher: '文化出版局', year: '2019', pages: '' }

  it('書名を『』で囲んで入力していても、『『』』と二重にしない（「」で囲んでいても）', () => {
    expect(formatReference(book)).toBe('浜松隆志、『ファッションの歴史』、文化出版局、2019年')
    expect(formatReference({ ...book, title: '『ファッションの歴史』' })).toBe('浜松隆志、『ファッションの歴史』、文化出版局、2019年')
    expect(formatReference({ ...book, title: '「ファッションの歴史」' })).toBe('浜松隆志、『ファッションの歴史』、文化出版局、2019年')
    // 書名の途中の『』は残す
    expect(formatReference({ ...book, title: '『源氏物語』の衣装' })).toBe('浜松隆志、『『源氏物語』の衣装』、文化出版局、2019年')
  })

  it('出版年は、全角の数字（２０１９）を消さずに半角にする。数字のほか（年）は除く', () => {
    expect(yearDigits('２０１９')).toBe('2019')
    expect(yearDigits('2019年')).toBe('2019')
    expect(formatReference({ ...book, year: '２０１９' })).toBe('浜松隆志、『ファッションの歴史』、文化出版局、2019年')
  })

  it('和暦の出版年は西暦にする（「令和3年」を「3年」にしない。元年も）', () => {
    expect(yearDigits('令和3年')).toBe('2021')
    expect(yearDigits('令和元年')).toBe('2019')
    expect(yearDigits('平成３０年')).toBe('2018')
    expect(yearDigits('昭和 63')).toBe('1988')
    expect(formatReference({ ...book, year: '令和元年' })).toBe('浜松隆志、『ファッションの歴史』、文化出版局、2019年')
  })

  it('書名の『』を片方だけ打ったときも二重にしない。ページの全角の数字とつなぎの線は半角にする', () => {
    expect(formatReference({ ...book, title: '『ファッションの歴史' })).toBe('浜松隆志、『ファッションの歴史』、文化出版局、2019年')
    expect(formatReference({ ...book, title: 'ファッションの歴史』' })).toBe('浜松隆志、『ファッションの歴史』、文化出版局、2019年')
    expect(formatReference({ ...book, pages: '１２－３０' })).toBe('浜松隆志、『ファッションの歴史』、文化出版局、2019年、p.12-30')
  })
})

describe('作品写真の「全体を入れる（切らない）」（mockups/v32 ③ 案A）', () => {
  const photosOf = (page: ReturnType<typeof createReport>['workPhotos'][number]) => {
    const report = { ...createReport(currentConfig), workPhotos: [page] }
    const html = buildReportDocument(report, currentConfig, { imageSrc: (id) => `img/${id}`, photoSrc: (id) => `photo/${id}`, figureSize: () => ({ widthMm: 60, heightMm: 45 }) })
    return html.slice(html.indexOf('<section class="photos'))
  }

  it('全体を入れる写真の枠には whole を付け、切り抜く位置は使わない（ほかの写真は今までどおり切り抜く）', () => {
    const html = photosOf({ layout: 2, columns: 1, imageIds: ['a', 'b'], positions: [{ x: 10, y: 20 }, { x: 30, y: 40 }], whole: [true, false] })
    expect(html).toContain('<div class="slot whole" data-photo-slot="0"><img src="photo/a" alt=""></div>')
    expect(html).toContain('<div class="slot" data-photo-slot="1"><img src="photo/b" style="object-position:30% 40%" alt=""></div>')
  })

  it('空いている枠には付けない。前の版の原稿（項目なし）は、どれも切り抜く', () => {
    expect(photosOf({ layout: 2, imageIds: ['', 'b'], whole: [true, false] })).toContain('<div class="slot empty-slot" data-photo-slot="0"></div>')
    expect(photosOf({ layout: 2, imageIds: ['a', 'b'] })).not.toContain('whole')
  })

  it('組版の CSS：切り抜くのは object-fit: cover、全体を入れるのは contain（画面と PDF で同じ）', () => {
    expect(documentCss).toContain('.photos .slot img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }')
    expect(documentCss).toMatch(/\.photos \.slot\.whole img \{ object-fit: contain;/)
  })
})

describe('報告書を部分ごと（表紙・抄録・目次・章ごと・残り）に分けて組む（組み直しを速くするため。editor/reportRenderer.ts）', () => {
  const options = { imageSrc: (id: string) => `img/${id}`, photoSrc: (id: string) => `photo/${id}`, figureSize: () => ({ widthMm: 60, heightMm: 45 }) }
  const p = (id: string, text: string) => ({ type: 'paragraph' as const, id, content: [{ type: 'text' as const, text }] })
  const report = {
    ...createReport(currentConfig),
    body: [
      { id: 'c1', title: '企画', blocks: [p('p1', '一つ目の章。')] },
      { id: 'c2', title: '制作', blocks: [p('p2', '二つ目の章。')] },
      { id: 'c3', title: 'まとめ', blocks: [p('p3', '三つ目の章。')] },
    ],
  }
  const bodyOf = (doc: string) => doc.slice(doc.indexOf('<body>') + 7, doc.lastIndexOf('</body>') - 1)

  it('部分は、表紙・抄録・目次・最後の章を除く章ごと・残り（最後の章と引用参考文献・作品写真）。どれも全体と同じ CSS', () => {
    const parts = buildReportParts(report, currentConfig, options)
    expect(partList(parts)).toHaveLength(3 + 2 + 1)
    const whole = buildReportDocument(report, currentConfig, options)
    const head = whole.slice(0, whole.indexOf('<body>'))
    for (const doc of partList(parts)) expect(doc.startsWith(head)).toBe(true)
  })

  it('章ごとの部分は、章の終わりのすぐ後ろに、次の章の始まりの代わり（改ページする大見出し。書く欄の印や目次の行き先はない）を置く', () => {
    const [first] = buildReportParts(report, currentConfig, options).chapters
    expect(first).toContain('data-block-id="p1"')
    expect(first).not.toContain('data-block-id="p2"')
    expect(first).toMatch(/<div class="flow-end"><\/div>\n<h1 class="chapter" data-sentinel=""><span class="num">Ⅱ．<\/span><span>制作<\/span><\/h1>\n<\/section>/)
    expect(first.match(/data-sentinel/g)).toHaveLength(1)
  })

  it('分けないとき（章が1つ、または splitChapters が false）は、残りの部分が本文全体と引用参考文献・作品写真で、全体の文書の本文から後ろと同じ', () => {
    const whole = bodyOf(buildReportDocument(report, currentConfig, options))
    const parts = buildReportParts(report, currentConfig, options, false)
    expect(parts.chapters).toEqual([])
    expect(whole.endsWith(bodyOf(parts.tail))).toBe(true)
    const one = { ...report, body: report.body.slice(0, 1) }
    expect(buildReportParts(one, currentConfig, options).chapters).toEqual([])
  })

  it('全体の文書の本文は、表紙・抄録・目次と章ごとの HTML を順につないだもの（分けて組んでも、中身は同じ）', () => {
    const whole = bodyOf(buildReportDocument(report, currentConfig, options))
    const parts = buildReportParts(report, currentConfig, options)
    const strip = (doc: string) => bodyOf(doc).replace(/\n<h1 class="chapter" data-sentinel="">.*?<\/h1>\n<\/section>$/, '\n</section>')
    const front = [parts.cover, parts.abstract, parts.toc].map(bodyOf).join('\n')
    const chapters = parts.chapters.map((d) => strip(d).replace(/^<section class="body">\n/, '').replace(/\n<\/section>$/, ''))
    const tail = bodyOf(parts.tail).replace(/^<section class="body">\n/, '')
    expect(`${front}\n<section class="body">\n${[...chapters, tail].join('\n')}`).toBe(whole)
  })
})

describe('作品写真の何ページか（mockups/v38 案A）', () => {
  const html = (workPhotos: ReturnType<typeof createReport>['workPhotos']) =>
    buildReportDocument({ ...createReport(currentConfig), workPhotos }, currentConfig, { imageSrc: (id) => `img/${id}`, photoSrc: (id) => `photo/${id}`, figureSize: () => ({ widthMm: 60, heightMm: 45 }) })

  it('ページごとに作品写真の section を作り、何ページ目か（data-photo-page）と、ページごとの並べ方を付ける', () => {
    const doc = html([
      { layout: 4, imageIds: ['a', 'b', 'c', 'd'] },
      { layout: 2, columns: 1, imageIds: ['e', 'f'] },
    ])
    expect(doc.match(/<section class="photos/g)).toHaveLength(2)
    expect(doc).toContain('<section class="photos grid-2x2" data-photo-page="0">')
    expect(doc).toContain('<section class="photos grid-1x2" data-photo-page="1"><div class="slot" data-photo-slot="0"><img src="photo/e" alt=""></div>')
  })

  it('組版の CSS に、6枚の並べ方（2×3・3×2）はない', () => {
    expect(documentCss).not.toContain('grid-2x3')
    expect(documentCss).not.toContain('grid-3x2')
  })
})

describe('目次の行の行き先（mockups/v41 案C：目次の行を押すと、その見出しへ移る）', () => {
  const options = { imageSrc: (id: string) => `img/${id}`, figureSize: () => ({ widthMm: 60, heightMm: 45 }) }
  const report = {
    ...createReport(currentConfig),
    body: [
      { id: 'c1', title: '制作過程', blocks: [{ type: 'subheading' as const, id: 's1', title: '仮縫い' }] },
      { id: 'c2', title: '制作過程', blocks: [{ type: 'subheading' as const, id: 's2', title: '仮縫い' }] },
    ],
    references: [{ type: 'book' as const, id: 'r1', author: '文化花子', title: '衣装', publisher: '文化出版局', year: '2020', pages: '1-2' }],
  }
  const toc = buildReportParts(report, currentConfig, options).toc

  it('大見出し・小見出しの行は、見出しの ID で結ぶ（同じ名前の見出しでも、別の行き先）', () => {
    expect(toc).toContain(`<div class="toc-ch" ${TOC_TARGET_ATTR}="c1"><span>Ⅰ．制作過程</span>`)
    expect(toc).toContain(`<div class="toc-ch next" ${TOC_TARGET_ATTR}="c2"><span>Ⅱ．制作過程</span>`)
    expect(toc).toContain(`<div class="toc-sub" ${TOC_TARGET_ATTR}="s1"><span>ⅰ．仮縫い</span></div>`)
    expect(toc).toContain(`<div class="toc-sub" ${TOC_TARGET_ATTR}="s2"><span>ⅰ．仮縫い</span></div>`)
  })

  it('引用・参考文献の行は references（そのページへ移る）', () => {
    expect(toc).toContain(`<div class="toc-ch next" ${TOC_TARGET_ATTR}="references"><span>引用・参考文献</span>`)
  })

  it('画面だけの言葉は、紙面（目次の文書）には入らない', () => {
    for (const text of Object.values(TOC_TEXT)) expect(toc).not.toContain(text)
    expect(toc).not.toContain('見出しへ')
  })
})
