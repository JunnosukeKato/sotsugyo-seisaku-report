import { describe, expect, it } from 'vitest'
import { applyFix, checkText } from './textRules'

const ids = (text: string) => checkText(text).map((f) => f.ruleId)
const fixAll = (text: string) => {
  let out = text
  for (;;) {
    const f = checkText(out).find((x) => x.replacement !== undefined)
    if (!f) return out
    out = applyFix(out, f)
  }
}

describe('手順書の例文', () => {
  it('【誤】私が好きな花はバラ。→ 一人称と体言止めを指摘する', () => {
    expect(ids('私が好きな花はバラ。')).toEqual(['first-person', 'taigen-dome'])
  })

  it('【正】筆者が好きな花はバラである。→ 指摘しない', () => {
    expect(checkText('筆者が好きな花はバラである。')).toEqual([])
  })

  it('【例】袖や首回りには肌の色に合わせたパワーネットを使用した（図1）。→ 指摘しない', () => {
    expect(checkText('袖や首回りには肌の色に合わせたパワーネットを使用した（図1）。')).toEqual([])
  })
})

describe('数字は半角', () => {
  it('全角数字を見つけ、半角に直せる', () => {
    const [f] = checkText('４年間のまとめである。')
    expect(f).toMatchObject({ ruleId: 'digit-fullwidth', severity: 'error', start: 0, end: 1, replacement: '4' })
    expect(f.detail).toBe('全角の「４」→ 半角の「4」')
  })

  it('漢数字の慣用表現は対象外', () => {
    expect(checkText('一人娘の婚約者として一つの舞台を作り上げた。')).toEqual([])
  })
})

describe('である調', () => {
  it('です・ます・でした・ました・ませんを見つける', () => {
    expect(ids('衣装です。')).toEqual(['desu-masu'])
    expect(ids('縫い付けました。')).toEqual(['desu-masu'])
    expect(ids('使いませんでした。')).toEqual(['desu-masu'])
  })

  it('「です」「でした」は自動で直せる', () => {
    expect(fixAll('主人公の衣装です。')).toBe('主人公の衣装である。')
    expect(fixAll('難しい工程でした。')).toBe('難しい工程であった。')
  })

  it('「難しかったです」「かわいいです」「広げたいです」は、「である」に置き換えると誤った日本語になるので、自動では直さない', () => {
    for (const text of ['難しかったです。', 'かわいいです。', '広げたいです。', '重かったでした。']) {
      const [f] = checkText(text)
      expect(f.ruleId).toBe('desu-masu')
      expect(f.replacement).toBeUndefined()
    }
  })

  it('「ますます」のような語は指摘しない', () => {
    expect(ids('ますます華やかになった。')).toEqual([])
  })
})

describe('一人称', () => {
  it('「私」を「筆者」に直せる', () => {
    expect(fixAll('私が担当した。')).toBe('筆者が担当した。')
  })

  it('「私服」「私物」は対象外', () => {
    expect(ids('私服と私物を参考にした。')).toEqual([])
  })

  it('「私たち」「私達」「我々」は指摘するが自動では直さない。「わたくし」は「筆者」に直せる', () => {
    for (const text of ['私たちが制作した。', '私達が制作した。', '我々が制作した。']) {
      const [f] = checkText(text)
      expect(f.ruleId).toBe('first-person')
      expect(f.replacement).toBeUndefined()
    }
    expect(fixAll('わたくしが担当した。')).toBe('筆者が担当した。')
  })
})

describe('「制作」で統一', () => {
  it('「製作」を「制作」に直せる。「縫製」「製図」は対象外', () => {
    expect(fixAll('衣装を製作した。')).toBe('衣装を制作した。')
    expect(ids('縫製の工程と製図を見直した。')).toEqual([])
  })
})

describe('敬称', () => {
  it('人名の後の敬称を指摘する（警告）', () => {
    const findings = checkText('山田先生と田中さんに教わった。')
    expect(findings.map((f) => [f.ruleId, f.severity])).toEqual([
      ['honorific', 'warning'],
      ['honorific', 'warning'],
    ])
  })

  it('「先生方」「氏名」は対象外', () => {
    expect(ids('先生方に氏名を確認した。')).toEqual([])
  })
})

describe('図表の参照', () => {
  it('「。（図1）」を「（図1）。」に直せる', () => {
    expect(fixAll('パワーネットを使用した。（図1）')).toBe('パワーネットを使用した（図1）。')
  })

  it('半角の括弧は全角に直せる（補助チェック）', () => {
    const [f] = checkText('デザインを考えた(図 1)。')
    expect(f).toMatchObject({ ruleId: 'figure-ref-halfwidth-paren', severity: 'warning', source: 'supplementary' })
    expect(applyFix('デザインを考えた(図 1)。', f)).toBe('デザインを考えた（図1）。')
  })
})

describe('体言止め（暫定版）', () => {
  it('文末が名詞のときに警告する', () => {
    expect(ids('帯には海の青と砂の金。')).toEqual(['taigen-dome'])
  })

  it('図の参照の前で文が終わっていれば指摘しない', () => {
    expect(ids('帽子を制作した（図7）。')).toEqual([])
  })
})

describe('2025年度サンプルで見つかった違反', () => {
  it('「セーラ―カラー」のダッシュを長音に直せる', () => {
    expect(fixAll('セーラ―カラー部のみ衿として作った。')).toBe('セーラーカラー部のみ衿として作った。')
  })

  it('「㎜」を「mm」に直せる', () => {
    expect(fixAll('6㎜スパングルで周囲を一周した。')).toBe('6mmスパングルで周囲を一周した。')
  })
})

describe('変換を間違えやすい語', () => {
  it('「見頃」は「身頃」に直す（前身頃・後ろ身頃）', () => {
    const f = checkText('前見頃と後ろ見頃を縫い合わせた。').filter((x) => x.ruleId === 'word-見頃')
    expect(f.map((x) => x.replacement)).toEqual(['身頃', '身頃'])
    expect(checkText('前身頃を縫い合わせた。').some((x) => x.ruleId === 'word-見頃')).toBe(false)
  })

  it('服作り・舞台の言葉の書き間違いを見つけて直す', () => {
    const text = '再寸して寸方を決め、友布で身返しを作った。見幅と見丈を整え、記事を選んだ。証明の中の講演で、部隊に立つ意匠（衣裳）を確かめた。'
    const fixed = checkText(text)
      .filter((x) => x.ruleId.startsWith('word-'))
      .sort((a, b) => b.start - a.start)
      .reduce((t, f) => applyFix(t, { ...f, replacement: f.replacement! }), text)
    expect(fixed).toBe('採寸して寸法を決め、共布で見返しを作った。身幅と身丈を整え、生地を選んだ。照明の中の公演で、舞台に立つ衣装（衣装）を確かめた。')
  })

  it('ほぼ確実に誤りの語はエラー、文脈によっては正しいこともある語は注意', () => {
    const sev = (word: string) => checkText(`${word}を確かめた。`).find((x) => x.ruleId === `word-${word}`)?.severity
    expect(['身返し', '見幅', '見丈', '再寸', '寸方', '友布', '見頃'].map(sev)).toEqual(Array(7).fill('error'))
    expect(['記事', '証明', '講演', '部隊', '意匠', '衣裳'].map(sev)).toEqual(Array(6).fill('warning'))
  })

  it('管理ページで決めた一覧を渡すと、その語だけを指摘する（記号はそのままの文字として探す）', () => {
    const words = [
      { wrong: '芯地(仮)', right: '芯地', note: '仮は書かない', severity: 'warning' as const },
      { wrong: 'ダーツ.', right: 'ダーツ', severity: 'error' as const },
      { wrong: '', right: '空', severity: 'error' as const },
    ]
    const f = checkText('前見頃に芯地(仮)を貼り、ダーツを縫った。', words).filter((x) => x.ruleId.startsWith('word-'))
    expect(f.map((x) => [x.ruleId, x.severity, x.replacement, x.detail])).toEqual([['word-芯地(仮)', 'warning', '芯地', '「芯地(仮)」→「芯地」（仮は書かない）']])
    expect(checkText('前見頃を縫った。', []).some((x) => x.ruleId.startsWith('word-'))).toBe(false)
  })
})

describe('「」『』の中（人の言葉の引用・作品名）', () => {
  it('引用の中の「です・ます」「私」「製作」は指摘しない（地の文は指摘する）', () => {
    expect(ids('監督は「もっと軽やかにしてほしいです」と言った。')).toEqual([])
    expect(ids('作品『私の製作日記』を参考にした。')).toEqual([])
    expect(ids('監督は「軽やかに」と言いました。').filter((id) => id === 'desu-masu')).toEqual(['desu-masu'])
  })
})

describe('その他', () => {
  it('テンプレートの仮の文字はエラー', () => {
    expect(ids('―●●●の衣装制作―').filter((id) => id !== 'sentence-end')).toEqual(['placeholder'])
    expect(ids('筆者が担当したのは、～～～である。')).toEqual(['placeholder'])
  })

  it('全角英字と半角カナを直せる', () => {
    expect(fixAll('Ｔ／Ｃブロードとｼﾙｸを使った。')).toBe('T／Cブロードとシルクを使った。')
  })

  it('指摘は文中の位置の順に並ぶ', () => {
    const findings = checkText('１５世紀の衣装を私が製作した。')
    expect(findings.map((f) => f.ruleId)).toEqual(['digit-fullwidth', 'first-person', 'seisaku'])
  })
})
