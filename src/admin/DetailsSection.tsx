import type { ReactNode } from 'react'
import type { YearConfig } from '../config'
import { NumberInput, OptionalNumberInput, Row, SectionHead, TextInput } from './ui'

/**
 * 「詳細設定」の区切り（ふだんは変えない項目。mockups/v43 案A の詳細設定の分け方を、案B の区切りに入れたもの）。
 * Google の障害のとき・表紙と抄録の言葉・分量の決まり・学籍番号の4つに分けて、1列に並べる
 */
/** 学籍番号の形式の説明（何に使うか・空のときどうなるか。依頼者から「この欄は何か」と聞かれた 2026-10-22） */
const STUDENT_ID_HINT = '学籍番号の形の決まりです。学生がログインした大学のアカウント（wu22fa0001@… など）から学籍番号を読み取るとき（学生か先生かの見分けにも使います）と、表紙に打った学籍番号を確かめるときに使います。空なら、ツールに入っている形（数字2桁・英字2〜3字・数字3〜4桁）で読み取り、表紙の学籍番号は確かめません。'

export function DetailsSection({ draft, set, changed, notices }: { draft: YearConfig; set: (patch: Partial<YearConfig>) => void; changed: (path: string) => boolean; notices?: ReactNode }) {
  const off = draft.driveSave === 'off'
  return (
    <>
      <SectionHead title="詳細設定" lead="ふだんは変えません。手順書が変わったときや、Google の障害のときに使います。" />
      {notices}
      <div className="card">
        <h2 className="card-h">Google の障害のとき</h2>
        <div className="grid">
          {/* Google の障害や大学の設定変更で学生がログインできないときだけ止める（mockups/v22 ② 案B） */}
          <Row label="ドライブ保存" sub="学生の原稿" changed={changed('driveSave')}>
            <div className={`drive-switch${off ? ' off' : ''}`}>
              <div className="seg2" role="group" aria-label="学生のドライブ保存">
                <button aria-pressed={!off} className={!off ? 'on' : ''} onClick={() => set({ driveSave: 'required' })}>
                  必須（ふだん）
                </button>
                <button aria-pressed={off} className={off ? 'on stop' : 'stop'} onClick={() => set({ driveSave: 'off' })}>
                  止める
                </button>
              </div>
              {off ? (
                <span className="warn">止めているあいだ、学生はログインせずに書けます（原稿はその端末にだけ保存されます）。Google が使えるようになったら「必須」に戻して保存してください。</span>
              ) : (
                <span className="hint">Google の障害や大学の設定変更で、学生がログインできないときだけ「止める」にして保存します。</span>
              )}
            </div>
          </Row>
        </div>
      </div>
      <div className="card">
        <h2 className="card-h">表紙と抄録の言葉</h2>
        <div className="grid">
          <Row label="報告書の名前" htmlFor="d-reportName" changed={changed('reportName')}>
            <TextInput id="d-reportName" value={draft.reportName} onChange={(v) => set({ reportName: v })} />
          </Row>
          <Row label="表紙の見出し" htmlFor="d-coverHeading" changed={changed('cover.heading')}>
            <TextInput id="d-coverHeading" value={draft.cover.heading} onChange={(v) => set({ cover: { ...draft.cover, heading: v } })} />
          </Row>
          <Row label="題目の見出し" sub="表紙" htmlFor="d-titleLabel" changed={changed('cover.titleLabel')}>
            <TextInput id="d-titleLabel" value={draft.cover.titleLabel} onChange={(v) => set({ cover: { ...draft.cover, titleLabel: v } })} />
          </Row>
          <Row label="抄録の見出し" htmlFor="d-abstractHeading" changed={changed('abstract.heading')}>
            <TextInput id="d-abstractHeading" value={draft.abstract.heading} onChange={(v) => set({ abstract: { ...draft.abstract, heading: v } })} />
          </Row>
          <Row label="書き出しの例（共通）" sub="抄録" htmlFor="d-openingExample" hint="コースで決めていないときに、学生の抄録の欄に薄く出します（コースの書き出し例は、コースの「ひな形」で決めます）" changed={changed('abstract.openingExample')}>
            <TextInput id="d-openingExample" value={draft.abstract.openingExample} onChange={(v) => set({ abstract: { ...draft.abstract, openingExample: v } })} />
          </Row>
          <Row label="大学名" htmlFor="d-university" changed={changed('university')}>
            <TextInput id="d-university" value={draft.university} onChange={(v) => set({ university: v })} />
          </Row>
          <Row label="学部名" htmlFor="d-faculty" changed={changed('faculty')}>
            <TextInput id="d-faculty" value={draft.faculty} onChange={(v) => set({ faculty: v })} />
          </Row>
          <Row label="学科名" htmlFor="d-department" changed={changed('department')}>
            <TextInput id="d-department" value={draft.department} onChange={(v) => set({ department: v })} />
          </Row>
        </div>
      </div>
      <div className="card">
        <h2 className="card-h">分量の決まり</h2>
        <div className="grid">
          <Row label="抄録の字数" htmlFor="d-minChars" changed={changed('abstract.minChars') || changed('abstract.maxChars')}>
            <span className="range">
              <NumberInput id="d-minChars" label="抄録の字数（最少）" value={draft.abstract.minChars} onChange={(v) => set({ abstract: { ...draft.abstract, minChars: v } })} />〜
              <NumberInput label="抄録の字数（最多）" value={draft.abstract.maxChars} onChange={(v) => set({ abstract: { ...draft.abstract, maxChars: v } })} />字
            </span>
          </Row>
          <Row label="抄録の行数" htmlFor="d-minLines" changed={changed('abstract.minLines') || changed('abstract.maxLines')}>
            <span className="range">
              <NumberInput id="d-minLines" label="抄録の行数（最少）" value={draft.abstract.minLines} onChange={(v) => set({ abstract: { ...draft.abstract, minLines: v } })} />〜
              <NumberInput label="抄録の行数（最多）" value={draft.abstract.maxLines} onChange={(v) => set({ abstract: { ...draft.abstract, maxLines: v } })} />行
            </span>
          </Row>
          <Row label="本文" htmlFor="d-minPages" changed={changed('body.minPages')}>
            <span className="range">
              <NumberInput id="d-minPages" label="本文の最低ページ数" value={draft.body.minPages} onChange={(v) => set({ body: { ...draft.body, minPages: v } })} />
              ページ以上
            </span>
          </Row>
          <Row label="画像の目安" htmlFor="d-images" changed={changed('body.imagesPerPageGuide')}>
            <span className="range">
              1ページに
              <NumberInput id="d-images" label="1ページあたりの画像の目安" value={draft.body.imagesPerPageGuide} onChange={(v) => set({ body: { ...draft.body, imagesPerPageGuide: v } })} />枚
            </span>
          </Row>
          <Row label="作品写真" htmlFor="d-photoPages" hint="空なら上限なし（1ページに写真4枚まで）" changed={changed('workPhotos.maxPages')}>
            <span className="range">
              <OptionalNumberInput id="d-photoPages" value={draft.workPhotos?.maxPages ?? null} placeholder="なし" onChange={(v) => set({ workPhotos: { maxPages: v } })} />
              ページまで
            </span>
          </Row>
        </div>
      </div>
      <div className="card">
        <h2 className="card-h">学籍番号</h2>
        <div className="grid">
          <Row label="形式" sub="正規表現" htmlFor="d-studentId" hint={STUDENT_ID_HINT} changed={changed('studentIdPattern')}>
            <TextInput id="d-studentId" value={draft.studentIdPattern ?? ''} onChange={(v) => set({ studentIdPattern: v.trim() ? v : null })} placeholder="例：^\d{2}FA[A-Z]?\d{3,4}$" />
          </Row>
        </div>
      </div>
    </>
  )
}
