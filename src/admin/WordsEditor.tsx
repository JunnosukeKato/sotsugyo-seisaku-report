import { useState } from 'react'
import { checkText } from '../checker/textRules'
import type { WordCheck } from '../config'
import { cleanWords } from './wordsText'

/**
 * 書き間違えやすい語の一覧を編集する窓（mockups/v17 案3）。管理者・先生が使う。
 * 1行に「書き間違い・正しい語・重さ（エラー／注意）」。試しに文を入れて、どこが指摘されるかを確かめられる。
 * 「反映する」で年度の設定（下書き）に入れ、保存すると学生のツールのセルフチェックで使われる。
 */

let keyCounter = 0
/** 足したばかりの行（例を薄く出す） */
const blank = (w: WordCheck) => !w.wrong && !w.right
type Row = WordCheck & { key: number }

export function WordsEditor({ words, onApply, onClose }: { words: WordCheck[]; onApply: (words: WordCheck[]) => void; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => words.map((w) => ({ ...w, key: ++keyCounter })))
  const [trial, setTrial] = useState('前見頃と後ろ身頃を縫い合わせ、記事を選んだ。')
  const setRow = (key: number, patch: Partial<WordCheck>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  // 試しの文：いまの一覧で指摘される箇所に印を付ける
  const marks = checkText(trial, cleanWords(rows)).filter((f) => f.ruleId.startsWith('word-'))
  const pieces: { text: string; severity?: string; title?: string }[] = []
  let pos = 0
  for (const m of marks) {
    if (m.start < pos) continue
    if (m.start > pos) pieces.push({ text: trial.slice(pos, m.start) })
    pieces.push({ text: trial.slice(m.start, m.end), severity: m.severity, title: m.title })
    pos = m.end
  }
  pieces.push({ text: trial.slice(pos) })

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal words-modal" role="dialog" aria-label="書き間違えやすい語">
        <header>
          <h2>書き間違えやすい語</h2>
          <button className="close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </header>
        <p className="lead">学生のセルフチェックで指摘し、「直す」で正しい語に置き換えられるようにします。エラーは PDF の書き出しを止め、注意は知らせるだけです（文脈によっては正しいこともある語は、注意にします）。</p>
        <table className="wtable">
          <thead>
            <tr>
              <th>書き間違い</th>
              <th>正しい語</th>
              <th>説明（任意）</th>
              <th>重さ</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>
                  <input className="in" value={r.wrong} onChange={(e) => setRow(r.key, { wrong: e.target.value })} placeholder={blank(r) ? '例：見頃' : ''} />
                </td>
                <td>
                  <input className="in" value={r.right} onChange={(e) => setRow(r.key, { right: e.target.value })} placeholder={blank(r) ? '例：身頃' : ''} />
                </td>
                <td>
                  <input className="in" value={r.note ?? ''} onChange={(e) => setRow(r.key, { note: e.target.value })} placeholder={blank(r) ? '例：服の胴の部分' : ''} />
                </td>
                <td>
                  <select className="in" value={r.severity} onChange={(e) => setRow(r.key, { severity: e.target.value as WordCheck['severity'] })}>
                    <option value="error">エラー</option>
                    <option value="warning">注意</option>
                  </select>
                </td>
                <td>
                  <button className="x" title="この語を消す" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="add" onClick={() => setRows([...rows, { key: ++keyCounter, wrong: '', right: '', note: '', severity: 'error' }])}>
          ＋ 語を足す
        </button>
        <div className="wtry">
          <label>
            試しに文を入れて確かめる
            <input className="in" value={trial} onChange={(e) => setTrial(e.target.value)} />
          </label>
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
        </div>
        <div className="row-buttons">
          <span className="spacer" />
          <button onClick={onClose}>やめる</button>
          <button className="primary" onClick={() => onApply(cleanWords(rows))}>
            反映する
          </button>
        </div>
      </div>
    </div>
  )
}
