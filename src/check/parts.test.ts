import { describe, expect, it } from 'vitest'
import { findPage, locateFindings, pagePins } from './locate'
import { chooseThumbWidth, packRows, pageSlots } from './pageGrid'
import { A4, fitInPage, photoGrid, photoPixels, photoPlaces } from './pageFit'
import { confirmText, fileKind, groupByPart, idAndName, isStale, mergedFileName, partFromName, placeFor, staleFinding, timeText, wrongPartFinding, type CheckFinding } from './parts'
import type { PdfFacts, PdfPageFacts } from './pdfFacts'

const config = { fiscalYear: 2026, reportName: '卒業制作報告書' }

describe('入れたファイルの種類', () => {
  it('Word・PDF・写真を見分け、使えない形は理由を返す', () => {
    expect(fileKind({ name: '04_本文.docx', type: '' })).toBe('word')
    expect(fileKind({ name: 'scan', type: 'application/pdf' })).toBe('pdf')
    expect(fileKind({ name: 'IMG_2041.JPG', type: '' })).toBe('image')
    expect(fileKind({ name: 'IMG_2041.HEIC', type: '' })).toBe('image')
    expect(fileKind({ name: 'photo', type: 'image/png' })).toBe('image')
    expect(fileKind({ name: '04_本文.doc', type: '' })).toEqual({ problem: expect.stringContaining('.doc') })
    expect(fileKind({ name: 'メモ.txt', type: 'text/plain' })).toEqual({ problem: expect.stringContaining('入れられません') })
  })
})

describe('名前で分ける', () => {
  it('01_〜04_ の番号（全角も）で分ける', () => {
    expect(partFromName('01_表紙.pdf')).toBe('cover')
    expect(partFromName('02_抄録.docx')).toBe('abstract')
    expect(partFromName('３_目次.pdf')).toBe('toc')
    expect(partFromName('04_本文 (1).pdf')).toBe('body')
    expect(partFromName('1-cover.pdf')).toBe('cover')
  })
  it('番号がなければ、名前の中の言葉（いちばん前のもの）で分ける', () => {
    expect(partFromName('＜SAMPLE＞01_表紙.pdf')).toBe('cover')
    expect(partFromName('文化花子_抄録.pdf')).toBe('abstract')
    expect(partFromName('本文と目次.pdf')).toBe('body')
    expect(partFromName('作品写真.pdf')).toBe('photo')
  })
  it('名前で分からないもの（年度で始まる名前・写真の名前）は null', () => {
    expect(partFromName('2026_卒業制作報告書_00ZZ0123_文化花子.pdf')).toBeNull()
    expect(partFromName('scan0001.pdf')).toBeNull()
    expect(partFromName('IMG_2041.jpg')).toBeNull()
  })
  it('置き場所：写真は作品写真、Word は Word の場所、名前で分からなければ中身から分かったパート、それもなければ本文', () => {
    expect(placeFor('image', 'IMG_2041.jpg', null)).toEqual({ part: 'photo', slot: 'pdf' })
    expect(placeFor('word', '01_表紙.docx', 'body')).toEqual({ part: 'cover', slot: 'word' })
    expect(placeFor('word', 'report.docx', 'abstract')).toEqual({ part: 'abstract', slot: 'word' })
    expect(placeFor('pdf', 'scan.pdf', 'toc')).toEqual({ part: 'toc', slot: 'pdf' })
    expect(placeFor('pdf', 'scan.pdf', null)).toEqual({ part: 'body', slot: 'pdf' })
    expect(placeFor('pdf', '作品写真.pdf', 'body')).toEqual({ part: 'photo', slot: 'pdf' })
    // Word は作品写真の場所には入れない
    expect(placeFor('word', '写真の説明.docx', null)).toEqual({ part: 'body', slot: 'word' })
  })
})

describe('Word のほうが新しい', () => {
  it('Word が PDF より2秒より大きく新しいときだけ', () => {
    expect(isStale({ lastModified: 10_000 }, { lastModified: 5_000 })).toBe(true)
    expect(isStale({ lastModified: 6_000 }, { lastModified: 5_000 })).toBe(false)
    expect(isStale({ lastModified: 5_000 }, { lastModified: 10_000 })).toBe(false)
    expect(isStale(undefined, { lastModified: 5_000 })).toBe(false)
    expect(isStale({ lastModified: 5_000 }, null)).toBe(false)
  })
})

describe('まとめた PDF のファイル名', () => {
  it('学生用ツールと同じ形（氏名の空白は除く。分からない部分は付けない）', () => {
    // 提出ガイドの決まり「学籍番号_氏名.pdf」
    expect(mergedFileName(config, '00ZZ0123', '文化　花子')).toBe('00ZZ0123_文化花子.pdf')
    expect(mergedFileName(config, ' 00ZZ0123 ', '文化 花子')).toBe('00ZZ0123_文化花子.pdf')
    expect(mergedFileName(config, '', '文化花子')).toBe('文化花子.pdf')
    expect(mergedFileName(config, '00ZZ0123', '')).toBe('00ZZ0123.pdf')
    expect(mergedFileName(config, '', '')).toBe('卒業制作報告書.pdf')
  })
  it('学籍番号と氏名を、表紙・抄録の行から読む（仮の文字のままなら読まない）', () => {
    expect(idAndName(['学籍番号　００ＺＺ０１２３', '氏名：文化　花子'])).toEqual({ studentId: '00ZZ0123', name: '文化　花子' })
    expect(idAndName(['学籍番号　00ZZ0123　氏名　文化　花子'])).toEqual({ studentId: '00ZZ0123', name: '文化　花子' })
    expect(idAndName(['学籍番号', '00ZZ0123', '氏　　名', '文化花子'])).toEqual({ studentId: '00ZZ0123', name: '文化花子' })
    expect(idAndName(['学籍番号22FAC●●●', '氏名：●●●●●'])).toEqual({})
  })
})

describe('確かめの窓（エラーが残っているとき・まだ入れていないものがあるとき）', () => {
  it('エラーが残っていれば、件数を出す。作品写真もなければ、それも言う', () => {
    expect(confirmText(5, ['作品写真'])).toEqual({ title: 'エラーが5件残っています', sub: ['作品写真も、まだありません。'] })
    expect(confirmText(1, [])).toEqual({ title: 'エラーが1件残っています', sub: [] })
  })
  it('エラーがなくても、作品写真などがまだなければ確かめる。そろっていれば出さない', () => {
    expect(confirmText(0, ['目次', '作品写真'])).toEqual({ title: '目次・作品写真が、まだありません', sub: [] })
    expect(confirmText(0, [])).toBeNull()
  })
  it('PDF が Word より古いパートがあれば、エラーがなくても確かめる。Word を入れていなければ、そうも言う', () => {
    expect(confirmText(0, [], ['抄録'])).toEqual({ title: '抄録の PDF が、Word より古いようです', sub: [] })
    expect(confirmText(2, ['作品写真'], ['表紙', '抄録'])).toEqual({
      title: 'エラーが2件残っています',
      sub: ['表紙・抄録の PDF が、Word より古いようです。', '作品写真も、まだありません。'],
    })
    expect(confirmText(1, [], [], true)).toEqual({ title: 'エラーが1件残っています', sub: ['Word を入れていないので、書式や文はチェックしていません。'] })
    // Word がなくても、ほかに確かめることがなければ、窓は出さない（下の帯に「チェックなしで、まとめます」）
    expect(confirmText(0, [], [], true)).toBeNull()
    // 本文だけ Word がないときは、そのパートの名前を言う
    expect(confirmText(1, [], [], ['本文'])?.sub).toEqual(['本文は Word を入れていないので、書式や文はチェックしていません。'])
  })
})

describe('入れた場所と中身・Word より古い PDF の指摘', () => {
  it('PDF の1ページ目が、ほかのパートのようなら、エラー（そのページに枠）', () => {
    expect(wrongPartFinding('cover', 'pdf', 'body')).toMatchObject({ severity: 'error', title: '表紙の PDF の1ページ目が、本文のようです', page: 1 })
    expect(wrongPartFinding('photo', 'pdf', 'body').title).toBe('作品写真の1ページ目が、本文のようです')
    expect(wrongPartFinding('abstract', 'word', 'toc')).toMatchObject({ title: '抄録の Word の中身が、目次のようです' })
    expect(wrongPartFinding('abstract', 'word', 'toc').page).toBeUndefined()
  })
  it('Word より古い PDF は警告。両方の時刻を出す', () => {
    const f = staleFinding('abstract', { lastModified: new Date(2026, 9, 14, 16, 5).getTime() }, { lastModified: new Date(2026, 9, 14, 15, 20).getTime() })
    expect(f).toMatchObject({ severity: 'warning', part: 'abstract', title: 'Word を直したら、PDF も作り直す' })
    expect(f.detail).toContain('Word：10月14日 16:05、PDF：10月14日 15:20')
  })
  it('ファイルの時刻は「10月14日 9:05」の形', () => {
    expect(timeText(new Date(2026, 9, 14, 9, 5).getTime())).toBe('10月14日 9:05')
  })
})

// ---- 指摘 → ページ ----

const page = (search: string, extra: Partial<PdfPageFacts> = {}): PdfPageFacts => ({ widthPt: 595.28, heightPt: 841.89, lines: [], search, pageNumber: null, images: 0, ...extra })
const finding = (part: CheckFinding['part'], snippets: string[], extra: Partial<CheckFinding> = {}): CheckFinding => ({ id: snippets.join('|'), ruleId: 'desu-masu', part, severity: 'error', source: 'guide', title: 't', snippets, ...extra })

describe('指摘 → ページ', () => {
  const body: PdfFacts = { pages: [page('Ⅰ.企画・立案筆者が担当したのは主人公である。'), page('袖幅も細くしました。腕が下がって見えたためです。'), page('まとめ製作の過程で学んだ。')] }
  it('Word の文（前後を含めた文字）を、PDF のページの文字（空白を除き NFKC）から探す', () => {
    expect(findPage(['腕が 下がって見えたため です。'], body)).toBe(2)
    expect(findPage(['見つからない文字', '製作の過程'], body)).toBe(3)
  })
  it('短い文字は、1つのページにしかないときだけ使う', () => {
    const facts: PdfFacts = { pages: [page('です。です。'), page('です。')] }
    expect(findPage(['です'], facts)).toBeNull()
    expect(findPage(['袖幅も'], body)).toBe(2)
    // 2字までは、場所に使わない
    expect(findPage(['袖幅'], body)).toBeNull()
  })
  it('ページの分かった指摘にはページを付け、ページごとの数（赤＝エラーあり、茶＝警告だけ）を数える', () => {
    const located = locateFindings(
      [finding('body', ['腕が下がって見えたためです']), finding('body', ['袖幅も細く'], { severity: 'warning' }), finding('body', ['どこにもない文']), finding('abstract', ['抄録の文'])],
      { body },
    )
    expect(located.map((f) => f.page)).toEqual([2, 2, undefined, undefined])
    expect(pagePins(located).get('body:2')).toEqual({ count: 2, error: true })
    expect(pagePins([{ ...located[1] }]).get('body:2')).toEqual({ count: 1, error: false })
  })
  it('パートの順・ページの順に並べる（ページの分からないものは後ろ）', () => {
    const list = [finding('body', ['a'], { page: 3 }), finding('cover', ['b']), finding('body', ['c']), finding('body', ['d'], { page: 1 })]
    const groups = groupByPart(list)
    expect(groups.map((g) => g.part.id)).toEqual(['cover', 'body'])
    expect(groups[1].items.map((f) => f.snippets?.[0])).toEqual(['d', 'a', 'c'])
  })
})

describe('作品写真を A4 の1ページに置く', () => {
  it('写真の全体が入る、いちばん大きな大きさにして、真ん中に置く（切らない）', () => {
    const tall = fitInPage(3000, 4000)
    expect(tall.width).toBeCloseTo(595.28, 1)
    expect(tall.height).toBeCloseTo(793.7, 1)
    expect(tall.x).toBeCloseTo(0, 5)
    expect(tall.y).toBeCloseTo((841.89 - 793.7) / 2, 1)
    const wide = fitInPage(4000, 3000)
    expect(wide.width).toBeCloseTo(595.28, 1)
    expect(wide.height).toBeCloseTo(446.46, 1)
    expect(wide.y).toBeCloseTo((841.89 - 446.46) / 2, 1)
  })
  it('大きすぎる写真は、A4 で約 200dpi の大きさまで縮める（小さい写真はそのまま）', () => {
    const big = photoPixels(6000, 8000)
    expect(big.width).toBeLessThanOrEqual(1654)
    expect(big.width).toBeGreaterThan(1600)
    expect(big.height / big.width).toBeCloseTo(8000 / 6000, 2)
    expect(photoPixels(800, 600)).toEqual({ width: 800, height: 600 })
  })
  it('並べ方は枚数で決まる（2枚は、縦長だけなら左右、横長があれば上下。3〜4枚は 2×2、5〜6枚は 2×3）', () => {
    const tall = { width: 3, height: 4 }
    const wide = { width: 4, height: 3 }
    expect(photoGrid([tall])).toEqual({ cols: 1, rows: 1 })
    expect(photoGrid([tall, tall])).toEqual({ cols: 2, rows: 1 })
    expect(photoGrid([tall, wide])).toEqual({ cols: 1, rows: 2 })
    expect(photoGrid([tall, tall, wide])).toEqual({ cols: 2, rows: 2 })
    expect(photoGrid(Array(6).fill(tall))).toEqual({ cols: 2, rows: 3 })
  })
  it('並べた写真は、10mm の余白の内側に、切らずに、重ならずに入る（左上から右へ、上の段から下の段へ）', () => {
    const photos = [{ width: 3000, height: 4000 }, { width: 4000, height: 3000 }, { width: 3000, height: 3000 }, { width: 3000, height: 4000 }]
    const places = photoPlaces(photos)
    const margin = (10 / 25.4) * 72
    for (const [i, p] of places.entries()) {
      expect(p.x).toBeGreaterThanOrEqual(margin - 0.01)
      expect(p.y).toBeGreaterThanOrEqual(margin - 0.01)
      expect(p.x + p.width).toBeLessThanOrEqual(A4.width - margin + 0.01)
      expect(p.y + p.height).toBeLessThanOrEqual(A4.height - margin + 0.01)
      // 写真の縦横の比は変えない
      expect(p.width / p.height).toBeCloseTo(photos[i].width / photos[i].height, 5)
    }
    // 1枚目は左上、2枚目は右上、3枚目は左下（pt は下が 0）
    expect(places[1].x).toBeGreaterThan(places[0].x)
    expect(places[2].y).toBeLessThan(places[0].y)
    expect(places[2].x).toBeCloseTo(margin, 0)
  })
})

describe('ページの並べ方（パソコン）', () => {
  const parts = pageSlots([
    { id: 'cover', pages: 1, placeholder: 1 },
    { id: 'abstract', pages: 1, placeholder: 1 },
    { id: 'toc', pages: 0, placeholder: 1 },
    { id: 'body', pages: 12, placeholder: 5 },
    { id: 'photo', pages: 0, placeholder: 1 },
  ])
  it('通しのページ番号は、入っているページだけに付ける', () => {
    expect(parts.map((p) => p.map((s) => s.no))).toEqual([[1], [2], [null], [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], [null]])
  })
  it('1段に収まるパートは途中で切らず、長い本文は次の段へ続ける', () => {
    const rows = packRows(parts, 1000, 100, 8, 20)
    expect(rows[0].map((s) => s.part)).toEqual(['cover', 'abstract', 'toc', 'body'])
    expect(rows[1][0]).toMatchObject({ part: 'body', first: false })
    expect(rows.flat().filter((s) => s.part === 'body').reduce((n, s) => n + s.items.length, 0)).toBe(12)
  })
  it('高さに収まる範囲で、いちばん大きな絵の幅を選ぶ', () => {
    expect(chooseThumbWidth(parts, 1000, 5000).tw).toBe(150)
    expect(chooseThumbWidth(parts, 1000, 300).tw).toBe(96)
  })
})
