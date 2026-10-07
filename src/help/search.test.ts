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
  it('「PDF 出ない」：両方の言葉が入っている項目（PDF の出し方・下書きの PDF）を先に、片方だけの項目をその下に出す', () => {
    const { terms, hits } = searchTopics(STUDENT_TOPICS, 'PDF 出ない')
    expect(terms).toEqual(['pdf', '出ない'])
    expect(ids(hits).slice(0, 2)).toEqual(['pdf', 'draft'])
    expect(hits[0].found).toEqual(['pdf', '出ない'])
    expect(hits.slice(2).every((h) => h.found.length === 1)).toBe(true)
    expect(ids(hits)).toContain('login')
    // 結果に出す1行は、題に入っていない「出ない」が入っている行
    expect(hits[0].line.label).toBe('提出用の PDF が出ないとき')
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

  it('どこにも入っていない言葉では、何も出ない', () => {
    expect(searchTopics(STUDENT_TOPICS, 'ラーメン').hits).toEqual([])
  })

  it('先生用：「反映 されない」で「保存と反映」が先に出る', () => {
    expect(ids(searchTopics(TEACHER_TOPICS, '反映 されない').hits)[0]).toBe('t-publish')
  })
})

describe('言葉で探す：印を付ける', () => {
  it('大文字・小文字、全角・半角が違っても、元の文字のまま印を付ける', () => {
    const parts = highlightParts('提出用の PDF が出ないとき', termsOf('pdf 出ない'))
    expect(parts.map((p) => p.text).join('')).toBe('提出用の PDF が出ないとき')
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

  it('学生用は16項目、先生用は10項目。id は重ならない', () => {
    expect(STUDENT_TOPICS).toHaveLength(16)
    expect(TEACHER_TOPICS).toHaveLength(10)
    expect(new Set(all.map((t) => t.id)).size).toBe(all.length)
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
