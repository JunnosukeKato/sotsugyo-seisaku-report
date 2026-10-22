import { describe, expect, it } from 'vitest'
import { confirmParts } from './confirm'
import { saveConfirmText } from './yearText'

describe('確認の窓の題と中身（confirm.tsx）', () => {
  it('問いの文（「？」で終わる最初の行の、最後の「。」のあと）を題にし、ほかを中身にする', () => {
    expect(confirmParts('保存していない変更があります。破棄して年度を切り替えますか？')).toEqual({ title: '破棄して年度を切り替えますか？', body: '保存していない変更があります。' })
    expect(confirmParts('標準のひな形（企画・立案／制作過程／まとめ）に戻しますか？')).toEqual({ title: '標準のひな形（企画・立案／制作過程／まとめ）に戻しますか？', body: '' })
    // 問いが最初の行（先生の役割・年度の削除など）
    expect(confirmParts('a@example.com を「先生」にしますか？\n先生は、ひな形だけを編集できます。')).toEqual({ title: 'a@example.com を「先生」にしますか？', body: '先生は、ひな形だけを編集できます。' })
    // 問いがなければ「確認」
    expect(confirmParts('消えます。')).toEqual({ title: '確認', body: '消えます。' })
  })

  it('保存の確認：題は「保存しますか？」、中身は、学生に届くこと・変更の一覧・書き始めた原稿は変わらないこと', () => {
    const text = saveConfirmText('公開中', 2026, ['映画・舞台衣装デザイナー コースの下書きのひな形'])
    const { title, body } = confirmParts(text ?? '')
    expect(title).toBe('保存しますか？')
    expect(body.split('\n\n')).toEqual([
      '2026年度は学生に公開中です。保存すると、次の変更が学生のツールに届きます（学生がツールを開き直すと、1分ほどで届きます）。',
      '・映画・舞台衣装デザイナー コースの下書きのひな形',
      'すでに書き始めた学生の原稿（書いた文章）は変わりません。下書きのひな形と抄録の書き出し例は、これからコースを選ぶ学生に入ります。',
    ])
  })
})
