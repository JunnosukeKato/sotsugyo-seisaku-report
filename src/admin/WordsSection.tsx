import { useEffect, useState, type ReactNode } from 'react'
import { checkText } from '../checker/textRules'
import type { WordCheck } from '../config'
import { AdminIcon } from './adminIcons'
import { SectionHead } from './ui'
import { useConfirm } from './confirm'
import { useLeaveGuard } from './useLeaveGuard'
import { cleanWords, wordRowProblem } from './wordsText'

/**
 * 「書き方のチェック」の区切り：書き間違えやすい語の一覧（mockups/v43 案B。前の版の窓の代わりに、画面の中に出す）。
 * 行を押すと、その行だけを直す欄が開く。「反映する」で年度の設定（下書き）に入れ、保存すると学生のツールのセルフチェックで使われる。
 * 右の「試しに確かめる」に文を入れると、いまの一覧（直している行も含めて）で指摘される所に印が付く。管理者・先生が使う
 */

const TRIAL = '前見頃と後ろ身頃を縫い合わせ、記事を選んだ。'
/** 直している行（index：一覧の何行目か。足すときは一覧の長さ） */
type Edit = { index: number; row: WordCheck; isNew: boolean }
const same = (a: WordCheck, b: WordCheck | undefined) => !!b && a.wrong === b.wrong && a.right === b.right && (a.note ?? '') === (b.note ?? '') && a.severity === b.severity
const UNSAVED = '直している語は、まだ反映していません。反映せずに閉じますか？'

export function WordsSection({ words, onChange, onPending, notices }: { words: WordCheck[]; onChange: (words: WordCheck[]) => void; onPending: (message: string | null) => void; notices?: ReactNode }) {
  const [edit, setEdit] = useState<Edit | null>(null)
  const [error, setError] = useState('')
  const [trial, setTrial] = useState(TRIAL)
  /** 確認の窓（画面の中に出す：confirm.tsx） */
  const ask = useConfirm()
  const pending = !!edit && (edit.isNew ? !!(edit.row.wrong.trim() || edit.row.right.trim() || edit.row.note?.trim()) : !same(edit.row, words[edit.index]))
  // 直して「反映する」を押していないあいだは、タブを閉じる・ほかの区切りに移るときに確かめる
  useLeaveGuard(pending)
  useEffect(() => {
    onPending(pending ? UNSAVED : null)
    return () => onPending(null)
  }, [pending, onPending])

  const start = async (next: Edit) => {
    if (pending && !(await ask(UNSAVED, { ok: '反映せずに閉じる', danger: true }))) return
    setEdit(next)
    setError('')
  }
  const openRow = (i: number) => start({ index: i, row: { ...words[i], note: words[i].note ?? '' }, isNew: false })
  const addRow = () => start({ index: words.length, row: { wrong: '', right: '', note: '', severity: 'error' }, isNew: true })
  const setRow = (patch: Partial<WordCheck>) => edit && setEdit({ ...edit, row: { ...edit.row, ...patch } })
  const apply = () => {
    if (!edit) return
    const problem = wordRowProblem(edit.row, words, edit.isNew ? -1 : edit.index)
    if (problem) return setError(problem)
    const clean: WordCheck = { wrong: edit.row.wrong.trim(), right: edit.row.right.trim(), note: (edit.row.note ?? '').trim(), severity: edit.row.severity }
    onChange(edit.isNew ? [...words, clean] : words.map((w, i) => (i === edit.index ? clean : w)))
    setEdit(null)
    setError('')
  }
  const remove = () => {
    if (!edit || edit.isNew) return
    onChange(words.filter((_, i) => i !== edit.index))
    setEdit(null)
    setError('')
  }

  // 試しの文：いまの一覧（直している行も、正しく入っていれば入れて）で指摘される箇所に印を付ける
  const trialList = edit && !wordRowProblem(edit.row, words, edit.isNew ? -1 : edit.index) ? (edit.isNew ? [...words, edit.row] : words.map((w, i) => (i === edit.index ? edit.row : w))) : words
  const marks = checkText(trial, cleanWords(trialList)).filter((f) => f.ruleId.startsWith('word-'))
  const pieces: { text: string; severity?: string; title?: string }[] = []
  let pos = 0
  for (const m of marks) {
    if (m.start < pos) continue
    if (m.start > pos) pieces.push({ text: trial.slice(pos, m.start) })
    pieces.push({ text: trial.slice(m.start, m.end), severity: m.severity, title: m.title })
    pos = m.end
  }
  pieces.push({ text: trial.slice(pos) })

  const editor = (e: Edit) => (
    <div className="wedit" role="group" aria-label={e.isNew ? '足す語' : `「${words[e.index]?.wrong}」を直す`}>
      <div className="g3">
        <label>
          書き間違い
          {/* 開いたら、書き間違いの欄に入る（行ごとに作り直すので、開くたびに） */}
          <input autoFocus className="in" value={e.row.wrong} placeholder={e.isNew ? '例：見頃' : ''} onChange={(ev) => setRow({ wrong: ev.target.value })} />
        </label>
        <label>
          正しい語
          <input className="in" value={e.row.right} placeholder={e.isNew ? '例：身頃' : ''} onChange={(ev) => setRow({ right: ev.target.value })} />
        </label>
        <label>
          重さ
          <select className="in" value={e.row.severity} onChange={(ev) => setRow({ severity: ev.target.value as WordCheck['severity'] })}>
            <option value="error">エラー</option>
            <option value="warning">要確認</option>
          </select>
        </label>
      </div>
      <label className="wide">
        説明（任意）
        <input className="in" value={e.row.note ?? ''} placeholder={e.isNew ? '例：服の胴の部分' : ''} onChange={(ev) => setRow({ note: ev.target.value })} />
      </label>
      {error && (
        <div className="werr" role="alert">
          {error}
        </div>
      )}
      <div className="wbtns">
        {!e.isNew && (
          <button className="btn sm danger" onClick={remove}>
            この語を消す
          </button>
        )}
        <span className="spacer" />
        <button
          className="btn sm"
          onClick={() => {
            setEdit(null)
            setError('')
          }}
        >
          やめる
        </button>
        <button className="btn sm primary" onClick={apply}>
          反映する
        </button>
      </div>
    </div>
  )

  return (
    <>
      <SectionHead title="書き方のチェック（言葉）" lead="学生のセルフチェックで指摘する、書き間違えやすい語です。行を押すと直せます。" />
      {notices}
      <div className="words">
        <div className="card wtable">
          <div className="wh" aria-hidden="true">
            <span>書き間違い</span>
            <span />
            <span>正しい語</span>
            <span>重さ</span>
            <span>説明</span>
          </div>
          {words.map((w, i) =>
            edit && !edit.isNew && edit.index === i ? (
              <div key={i}>{editor(edit)}</div>
            ) : (
              <button key={i} className="wrow" onClick={() => openRow(i)} aria-label={`「${w.wrong}」→「${w.right}」（${w.severity === 'error' ? 'エラー' : '要確認'}）を直す`}>
                <span className="w">{w.wrong}</span>
                <span className="ar">→</span>
                <span className="w">{w.right}</span>
                <span>
                  <span className={`sev ${w.severity === 'error' ? 'e' : 'w'}`}>{w.severity === 'error' ? 'エラー' : '要確認'}</span>
                </span>
                <span className="nt">{w.note}</span>
              </button>
            ),
          )}
          {edit?.isNew && editor(edit)}
          {!edit?.isNew && (
            <button className="add" onClick={addRow}>
              {AdminIcon.plus}語を足す
            </button>
          )}
        </div>
        <aside className="card wtry">
          <h2 className="card-h">{AdminIcon.eye}試しに確かめる</h2>
          <p>文を入れると、いまの一覧で指摘される所に印が付きます。</p>
          <input className="in" aria-label="試しの文" value={trial} onChange={(e) => setTrial(e.target.value)} />
          <div className="s">
            {pieces.map((p, i) =>
              p.severity ? (
                <mark key={i} className={p.severity === 'error' ? 'e' : 'w'} title={p.title}>
                  {p.text}
                </mark>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
          </div>
          <dl>
            <dt>
              <span className="sev e">エラー</span>
            </dt>
            <dd>PDF の書き出しを止めます。学生は消せません。</dd>
            <dt>
              <span className="sev w">要確認</span>
            </dt>
            <dd>知らせるだけです。文脈によっては正しい語に使います。</dd>
          </dl>
        </aside>
      </div>
    </>
  )
}
