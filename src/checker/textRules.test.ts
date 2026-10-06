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

  it('「私たち」は指摘するが自動では直さない', () => {
    const [f] = checkText('私たちが制作した。')
    expect(f.ruleId).toBe('first-person')
    expect(f.replacement).toBeUndefined()
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
