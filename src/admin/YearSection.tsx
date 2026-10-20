import type { ReactNode } from 'react'
import type { YearConfig } from '../config'
import { AdminIcon } from './adminIcons'
import type { NewYearStep } from './newYearSteps'
import { Row, SectionHead, TextInput } from './ui'
import { Waiting } from './Wait'

/**
 * 「年度の設定」の区切り（mockups/v43 案B）：共通の題目・最終締切・手順書のリンクと、次の年度を作るボタン。
 * まだ公開していない（準備中の）年度には、いちばん上に新年度の手順（題目 → 締切 → コース → 確かめる → 公開）を出す。
 * 手順を押すと、直す所へ移る（onStep）。間違えて作った準備中の年度は、いちばん下で削除できる
 */
export function YearSection({
  draft,
  set,
  changed,
  steps,
  onStep,
  nextYear,
  onNewYear,
  canDelete,
  onDelete,
  deleting,
  disabled,
  notices,
}: {
  draft: YearConfig
  set: (patch: Partial<YearConfig>) => void
  changed: (path: string) => boolean
  /** 新年度の手順（準備中の年度だけ。公開したら null） */
  steps: NewYearStep[] | null
  onStep: (step: NewYearStep) => void
  /** 新年度を作ると、何年度になるか */
  nextYear: number
  onNewYear: () => void
  canDelete: boolean
  onDelete: () => void
  /** 削除している（回る印と「削除しています…」） */
  deleting: boolean
  /** サーバーを待っている間は、ボタンを押せない */
  disabled: boolean
  /** 区切りの見出しのすぐ下に出す知らせ（保存した・断られた、入力の誤りなど） */
  notices?: ReactNode
}) {
  const next = steps?.findIndex((s) => !s.done) ?? -1
  return (
    <>
      <SectionHead title="年度の設定" lead={`${draft.fiscalYear}年度の、毎年変わる項目です。表紙と抄録に入ります（右の見本）。`} />
      {steps && (
        <div className="card steps-card">
          <h2 className="card-h">
            {AdminIcon.sprout}新年度の準備
            <span className="prog">
              {steps.filter((s) => s.done).length}/{steps.length}
            </span>
          </h2>
          <p className="card-lead">上から順に確かめます。押すと、直す所に移ります。</p>
          <ol className="steps">
            {steps.map((s, i) => (
              <li key={s.key} className={s.done ? 'done' : i === next ? 'now' : ''}>
                <button onClick={() => onStep(s)}>
                  <i aria-hidden="true">{s.done ? AdminIcon.checkBold : i + 1}</i>
                  <b>{s.name}</b>
                  <span className="sr-only">{s.done ? '（済み）' : '（まだ）'}</span>
                  <span className="st">{s.text}</span>
                  {AdminIcon.next}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
      {notices}
      <div className="card">
        <div className="grid">
          <Row label="共通の題目" htmlFor="y-commonTitle" hint="学生は変えられません" changed={changed('commonTitle')}>
            <TextInput id="y-commonTitle" value={draft.commonTitle} onChange={(v) => set({ commonTitle: v })} placeholder="例：卒業イベント「シンドバッド」について" />
          </Row>
          <Row label="最終締切" htmlFor="y-deadline" changed={changed('deadline')}>
            {/* max を付けると、年の欄に5桁以上を打てなくなる（「2028」と打つと月の欄に移る。付けないと「202801」のような年になる） */}
            <TextInput id="y-deadline" className="date" type="date" max="9999-12-31" value={draft.deadline} onChange={(v) => set({ deadline: v })} />
          </Row>
          <Row label="手順書のリンク" sub="任意" htmlFor="y-handbook" hint="学生のツールの上に「手順書」ボタンで出ます" changed={changed('handbookUrl')}>
            <TextInput id="y-handbook" value={draft.handbookUrl ?? ''} onChange={(v) => set({ handbookUrl: v })} placeholder="https://drive.google.com/…" />
          </Row>
        </div>
      </div>
      <div className="card next-year">
        <h2 className="card-h">{AdminIcon.sprout}次の年度</h2>
        <p className="card-lead">この年度の設定をコピーして、{nextYear}年度を作ります。公開するまで、学生には見えません。</p>
        <button className="btn sub" disabled={disabled} onClick={onNewYear}>
          {AdminIcon.plus}新年度を作成
        </button>
      </div>
      {canDelete && (
        <div className="card delete-year">
          <h2 className="card-h">この年度を削除</h2>
          <p className="card-lead">まだ学生に公開していない年度です。間違えて作ったときは、削除できます。</p>
          <button className={`btn danger${deleting ? ' busy' : ''}`} disabled={disabled} aria-busy={deleting} onClick={onDelete}>
            {deleting ? <Waiting text="削除しています…" /> : 'この年度を削除'}
          </button>
        </div>
      )}
    </>
  )
}
