import { describe, expect, it } from 'vitest'
import { STUDENT_TOPICS, TEACHER_TOPICS, type HelpTopic } from './helpTopics'
import { highlightParts, searchTopics, termsOf } from './search'

// 画面の写真があるかを確かめるため（ブラウザ用の型だけを使う設定なので、wordImport.test.ts と同じく、型を書いて読み込む）
const fs: { existsSync(p: string): boolean } = await import(/* @vite-ignore */ `node:${'fs'}`)

const ids = (hits: { topic: HelpTopic }[]) => hits.map((h) => h.topic.id)
const marked = (parts: { text: string; hit: boolean }[]) => parts.filter((p) => p.hit).map((p) => p.text)

describe('言葉で探す：言葉の区切り', () => {
  it('半角・全角の空白、読点で区切り、全角の英字は半角の小文字にそろえる（同じ言葉は1つ）', () => {
    expect(termsOf('ＰＤＦ　出ない、PDF')).toEqual(['pdf', '出ない'])
  })

  it('空白だけなら、言葉はない（何も探さない）', () => {
    expect(termsOf('  　 ')).toEqual([])
    expect(searchTopics(STUDENT_TOPICS, '  ').hits).toEqual([])
  })
})

describe('言葉で探す：項目を探す', () => {
  it('「PDF 出ない」：両方の言葉が入っている項目（PDF の出し方）を先に、片方だけの項目をその下に出す', () => {
    const { terms, hits } = searchTopics(STUDENT_TOPICS, 'PDF 出ない')
    expect(terms).toEqual(['pdf', '出ない'])
    expect(ids(hits)[0]).toBe('pdf')
    expect(hits[0].found).toEqual(['pdf', '出ない'])
    expect(hits.slice(1).every((h) => h.found.length === 1)).toBe(true)
    expect(ids(hits)).toContain('login')
    // 結果に出す1行は、題に入っていない「出ない」が入っている行
    expect(hits[0].line.label).toBe('PDF が出ないとき')
  })

  it('「PDF ドライブ」「PDF どこ」：PDF の出し方の項目が先に出る（同じ PDF が、自分のドライブの「卒業制作報告書」フォルダにも入る）', () => {
    for (const q of ['PDF ドライブ', 'PDF どこ', 'PDF グーグルドライブ']) expect(ids(searchTopics(STUDENT_TOPICS, q).hits)[0], q).toBe('pdf')
    expect(searchTopics(STUDENT_TOPICS, 'PDF ドライブ').hits[0].line.text).toContain('「卒業制作報告書」フォルダにも入ります')
  })

  it('全角・大文字で入れても、同じ項目が見つかる', () => {
    expect(ids(searchTopics(STUDENT_TOPICS, 'ｐｄｆ').hits)).toEqual(ids(searchTopics(STUDENT_TOPICS, 'PDF').hits))
  })

  it('文に出てこない言い方（words）でも見つかり、その言葉は「見えない言葉」として返す', () => {
    const { hits } = searchTopics(STUDENT_TOPICS, '消えた')
    expect(ids(hits)).toContain('undo')
    expect(hits.find((h) => h.topic.id === 'undo')?.hidden).toEqual(['消えた'])
  })

  it('端末ごとの手順の行も探し、端末の名前を小見出しにする', () => {
    const hit = searchTopics(STUDENT_TOPICS, '共有のボタン').hits[0]
    expect(hit.topic.id).toBe('pdf')
    expect(hit.line.label).toBe('iPhone')
  })

  it('学生が探した言葉（引用・参考文献・最初から・作り直す・新しく）で、引用・参考文献と、最初から作り直す項目が先に出る', () => {
    for (const q of ['引用', '参考文献']) expect(ids(searchTopics(STUDENT_TOPICS, q).hits)[0], q).toBe('references')
    for (const q of ['最初から', '作り直す', '作り直', '新しく']) expect(ids(searchTopics(STUDENT_TOPICS, q).hits)[0], q).toBe('restart')
  })

  it('「ローマ数字」「見出し 番号」「勝手に」では、書き方の項目が先に出て、段落に「Ⅲ．まとめ」と打って見出しにする行を示す', () => {
    for (const q of ['ローマ数字', '見出し 番号', '勝手に']) expect(ids(searchTopics(STUDENT_TOPICS, q).hits)[0], q).toBe('write')
    const write = STUDENT_TOPICS.find((t) => t.id === 'write')!
    expect(write.items?.some((i) => i.t.includes('段落に「Ⅲ．まとめ」のように打って Enter でも、大見出しになります（「ⅰ．」なら小見出し）'))).toBe(true)
  })

  it('「やり直す」「やり直」では、元に戻す・やり直すの項目が先に出る（最初から作り直す項目は、その下に出る）', () => {
    for (const q of ['やり直す', 'やり直']) {
      const found = ids(searchTopics(STUDENT_TOPICS, q).hits)
      expect(found[0], q).toBe('undo')
      expect(found, q).toContain('restart')
    }
  })

  it('「見開き」で、書き方の項目（右下の「見開き」）が見つかる', () => {
    const hit = searchTopics(STUDENT_TOPICS, '見開き').hits[0]
    expect(hit?.topic.id).toBe('write')
    expect(hit?.line.label).toBe('見開き（パソコン）')
  })

  it('作品写真の「全体を入れる（切らない）」は、「全体」「切らない」「写真 切れる」で探すと、作品写真の項目が先に出る（「切れる」だけでも出る）', () => {
    for (const q of ['全体', '切らない', '写真 切れる']) {
      const { hits } = searchTopics(STUDENT_TOPICS, q)
      expect(ids(hits)[0], q).toBe('photos')
      expect(hits[0].line.text, q).toContain('全体を入れる（切らない）')
    }
    // 「切れる」だけでは、ログインの許可が切れる項目と並ぶ（どちらも出す）
    expect(ids(searchTopics(STUDENT_TOPICS, '切れる').hits)).toContain('photos')
  })

  it('どこにも入っていない言葉では、何も出ない', () => {
    expect(searchTopics(STUDENT_TOPICS, 'ラーメン').hits).toEqual([])
  })

  it('先生用：「反映 されない」で「保存と反映」が先に出る', () => {
    expect(ids(searchTopics(TEACHER_TOPICS, '反映 されない').hits)[0]).toBe('t-publish')
  })

  it('先生用：学生によく聞かれること（保存・PDF・別のパソコン）と、途中の締切で探せる', () => {
    for (const q of ['保存されていない', 'PDF 出せない', '別のパソコン', '大学のパソコン']) expect(ids(searchTopics(TEACHER_TOPICS, q).hits)[0], q).toBe('t-faq')
    expect(ids(searchTopics(TEACHER_TOPICS, '途中の締切').hits)).toEqual(expect.arrayContaining(['t-year', 't-notice']))
  })
})

describe('言葉で探す：印を付ける', () => {
  it('大文字・小文字、全角・半角が違っても、元の文字のまま印を付ける', () => {
    const parts = highlightParts('PDF が出ないとき', termsOf('pdf 出ない'))
    expect(parts.map((p) => p.text).join('')).toBe('PDF が出ないとき')
    expect(marked(parts)).toEqual(['PDF', '出ない'])
    expect(marked(highlightParts('ＰＤＦを書き出す', ['pdf']))).toEqual(['ＰＤＦ'])
  })

  it('重なる言葉は、1つの印にまとめる', () => {
    expect(marked(highlightParts('ドライブに保存', ['ドライブ', 'ブに保']))).toEqual(['ドライブに保'])
  })

  it('言葉がなければ、印は付けない', () => {
    expect(highlightParts('文', [])).toEqual([{ text: '文', hit: false }])
  })
})

describe('使い方の項目', () => {
  const all = [...STUDENT_TOPICS, ...TEACHER_TOPICS]

  it('学生用は17項目、先生用は11項目。id は重ならない', () => {
    expect(STUDENT_TOPICS).toHaveLength(17)
    expect(TEACHER_TOPICS).toHaveLength(11)
    expect(new Set(all.map((t) => t.id)).size).toBe(all.length)
  })

  it('先生用：管理者だけの項目は、題に（管理者だけ）と書く。保存のボタンは、公開中と準備中の両方の名前を書く', () => {
    for (const id of ['t-year', 't-newyear', 't-members']) expect(TEACHER_TOPICS.find((t) => t.id === id)?.title, id).toContain('（管理者だけ）')
    const text = (id: string) => JSON.stringify(TEACHER_TOPICS.find((t) => t.id === id))
    for (const id of ['t-year', 't-publish', 't-template']) {
      expect(text(id), id).toContain('保存して学生に反映')
      expect(text(id), id).toContain('準備中')
    }
  })

  it('1つの項目は短く：手順は3つまで、補足は3つまで。ひとことか補足がある', () => {
    for (const t of all) {
      expect((t.steps ?? []).length, t.id).toBeLessThanOrEqual(3)
      expect((t.items ?? []).length, t.id).toBeLessThanOrEqual(3)
      expect(!!t.lead || !!t.items?.length, t.id).toBe(true)
    }
  })

  it('関係する項目は、同じ一覧にある', () => {
    for (const list of [STUDENT_TOPICS, TEACHER_TOPICS])
      for (const t of list) for (const r of t.related ?? []) expect(list.some((x) => x.id === r), `${t.id} → ${r}`).toBe(true)
  })

  it('画面の写真は public/help/ にある', () => {
    for (const t of all) if (t.shot) expect(fs.existsSync(`public/help/${t.shot.file}`), t.shot.file).toBe(true)
  })

  it('「指差し確認をもう一度見る」の項目がある（学生用）', () => {
    expect(STUDENT_TOPICS.find((t) => t.action?.kind === 'tour')?.title).toBe('指差し確認をもう一度見る')
  })
})

describe('目次（mockups/v41：目次は本文の見出しから自動で作る）', () => {
  it('「目次」「目次 直せない」で、書き方の項目の見出しの手順（目次は自動・行を押すと見出しへ）が出る', () => {
    for (const q of ['目次', '目次 直せない', 'もくじ']) {
      const { hits } = searchTopics(STUDENT_TOPICS, q)
      expect(hits[0]?.topic.id, q).toBe('write')
    }
    expect(searchTopics(STUDENT_TOPICS, '目次').hits[0].line.text).toContain('目次は見出しから自動で作ります（行をクリックで、その見出しへ）')
  })
})
