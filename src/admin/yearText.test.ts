import { describe, expect, it } from 'vitest'
import { currentConfig } from '../config'
import { skippedWords } from './wordsText'
import { deleteConfirmText, deletedMessage, deliveryNote, formatDate, newYearNotice, publishConfirmText, saveConfirmText, savedMessage, templateFootNote } from './yearText'

describe('年度の状態で変わる言葉', () => {
  it('「反映する」の後どうすれば届くかは、公開中・準備中・終了で違う（ボタンの名前どおり）', () => {
    expect(deliveryNote('公開中', 'admin')).toBe('上の「保存して学生に反映」を押すと、学生のツールに届きます')
    expect(deliveryNote('準備中', 'admin')).toBe('上の「保存」を押すと保存されます。学生に届くのは、「この年度を学生に公開」を押してからです')
    expect(deliveryNote('準備中', 'teacher')).toBe('上の「保存」を押すと保存されます。学生に届くのは、管理者がこの年度を学生に公開してからです')
    expect(deliveryNote('終了', 'teacher')).toBe('上の「保存」を押すと、この年度に書き始めた学生のツールに届きます')
    expect(templateFootNote('公開中')).toContain('「保存して学生に反映」で学生のツールに届きます')
    expect(templateFootNote('準備中')).toContain('学生に届くのは、この年度を学生に公開してから')
    expect(savedMessage('公開中', 'admin')).toContain('反映しました')
    expect(savedMessage('準備中', 'admin')).toContain('「この年度を学生に公開」を押してから')
  })

  it('保存の確認：公開中・終了の年度だけ。変わる項目・届くまで・書き始めた学生の原稿のことを示す', () => {
    expect(saveConfirmText('準備中', 2027, ['共通の題目'])).toBeNull()
    const published = saveConfirmText('公開中', 2026, ['共通の題目', '映画・舞台衣装デザイナー コースの下書きのひな形'])!
    expect(published).toBe(
      '2026年度は学生に公開中です。保存すると、次の変更が学生のツールに届きます（学生がツールを開き直すと、1分ほどで届きます）。\n\n' +
        '・共通の題目\n・映画・舞台衣装デザイナー コースの下書きのひな形\n\n' +
        'すでに書き始めた学生の原稿（書いた文章）は変わりません。下書きのひな形と抄録の書き出し例は、これからコースを選ぶ学生に入ります。\n保存しますか？',
    )
    const ended = saveConfirmText('終了', 2025, ['最終締切'])!
    expect(ended).toContain('この年度に書き始めた学生は、今もこの設定を使っています')
    expect(ended).not.toContain('これからコースを選ぶ')
    const many = saveConfirmText('公開中', 2026, Array.from({ length: 15 }, (_, i) => `項目${i}`))!
    expect(many).toContain('・項目11\n・ほか3件')
  })

  it('公開の確認：題目・締切・コースごとの指導教員と、学生がどうなるか', () => {
    const text = publishConfirmText({ ...currentConfig, fiscalYear: 2027, deadline: '2028-01-19' }, 2026, true)
    expect(text).toContain('2027年度の設定を学生に公開しますか？')
    expect(text).toContain(`共通の題目：${currentConfig.commonTitle}`)
    expect(text).toContain('最終締切：2028年1月19日（水）')
    expect(text).toContain(`・映画・舞台衣装デザイナー コース：${currentConfig.courses[0].advisors.join('、')}`)
    expect(text).toContain('・まだ書き始めていない学生は、2027年度の設定で書き始めます。')
    expect(text).toContain('・すでに書き始めた学生は、書き始めた年度の設定のままです。')
    expect(text).toContain('・今公開中の2026年度は「終了」になります。')
    expect(text).toContain('保存していない変更は、保存してから公開します')
  })

  it('新年度を作ったときの知らせ：前の年度のままの項目（締切・お知らせ・書き出し例の題目の言葉）を、直す場所を添えて箇条書きに', () => {
    const from = { ...currentConfig, courses: currentConfig.courses.map((c, i) => (i === 0 ? { ...c, notice: '中間発表の準備' } : c)) }
    const notice = newYearNotice(from, 2027)
    expect(notice.text).toBe('2027年度を作成しました（2026年度の設定のコピーです）。')
    expect(notice.detail).toBe('次の項目は2026年度のままです。確かめて直してください。')
    expect(notice.items.map((i) => i.text)).toEqual([
      '共通の題目',
      '最終締切（2027年1月20日（水）。2026年度と同じ日付）',
      'お知らせ（映画・舞台衣装デザイナー コース）',
      '抄録の書き出し例（映画・舞台衣装デザイナー コース。前の年度の題目の言葉「シンドバッド」が入っています）',
    ])
    expect(notice.items.map((i) => i.where)).toEqual([
      'この下の「毎年設定する項目」のいちばん上',
      '共通の題目のすぐ下',
      'コースのカードの「このコースの学生へのお知らせ」',
      'コースのカードの「下書きのひな形」の「編集する」',
    ])
    // 詳細設定の書き出し例に題目の言葉があれば、詳細設定の欄も場所に添える
    const opening = { ...from, abstract: { ...from.abstract, openingExample: '本制作報告書は、卒業イベント「シンドバッド」において、' } }
    expect(newYearNotice(opening, 2027).items.at(-1)).toEqual({
      text: '抄録の書き出し例（映画・舞台衣装デザイナー コース、詳細設定。前の年度の題目の言葉「シンドバッド」が入っています）',
      where: 'コースのカードの「下書きのひな形」の「編集する」と、「詳細設定」の中の「抄録の書き出し例」',
    })
    // 題目の言葉が入っていなければ、書き出し例は出さない
    const plain = { ...currentConfig, courses: currentConfig.courses.map((c) => ({ ...c, abstractExample: '本制作報告書は、' })) }
    expect(newYearNotice(plain, 2027).items.some((i) => i.text.startsWith('抄録の書き出し例'))).toBe(false)
  })

  it('準備中の年度を削除するときの確認と、削除したあとの知らせ', () => {
    expect(deleteConfirmText(2027, { year: 2026, status: '公開中' })).toBe(
      '2027年度（準備中）を削除しますか？\n\n' +
        '・この年度の設定（共通の題目・締切・コース・ひな形・お知らせなど）が、すべて消えます。元には戻せません。\n' +
        '・まだ学生に公開していないので、学生のツールは変わりません。\n' +
        '・削除したあとは、2026年度（公開中）を開きます。',
    )
    expect(deletedMessage(2027, { year: 2026, status: '公開中' })).toBe('2027年度を削除しました。いまは2026年度（公開中）を開いています。')
  })

  it('日付は「2027年1月20日（水）」の形（日付でなければ、そのまま）', () => {
    expect(formatDate('2027-01-20')).toBe('2027年1月20日（水）')
    expect(formatDate('202801-12-20')).toBe('202801-12-20')
  })
})

describe('書き間違えやすい語の、使わない行', () => {
  it('空の行・片方が空の行・同じ語の行を、行の番号と語で示す', () => {
    const rows = [
      { wrong: '見頃', right: '身頃', severity: 'error' as const },
      { wrong: '', right: '', severity: 'error' as const },
      { wrong: '見頃', right: ' ', severity: 'error' as const },
      { wrong: '', right: '生地', severity: 'error' as const },
      { wrong: '同じ', right: ' 同じ ', severity: 'warning' as const },
    ]
    expect(skippedWords(rows)).toEqual(['2行目：空の行', '3行目「見頃」：正しい語が空です', '4行目「→ 生地」：書き間違いが空です', '5行目「同じ」：書き間違いと正しい語が同じです'])
  })
})
