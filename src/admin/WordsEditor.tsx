import { useRef, useState } from 'react'
import { useDialogFocus } from '../app/useDialogFocus'
import { checkText } from '../checker/textRules'
import type { WordCheck } from '../config'
import { useLeaveGuard } from './useLeaveGuard'
import { cleanWords, skippedWords } from './wordsText'

/**
 * 書き間違えやすい語の一覧を編集する窓（mockups/v17 案3）。管理者・先生が使う。
 * 1行に「書き間違い・正しい語・重さ（エラー／要確認）」。試しに文を入れて、どこが指摘されるかを確かめられる。
 * 「反映する」で年度の設定（下書き）に入れ、保存すると学生のツールのセルフチェックで使われる。
 * 空の行・書き間違いと正しい語が同じ行は使わない（「反映する」のときに、どの行を外すかを示して確かめる）。
 */

let keyCounter = 0
/** 足したばかりの行（例を薄く出す） */
const blank = (w: WordCheck) => !w.wrong && !w.right
type Row = WordCheck & { key: number }

export function WordsEditor({ words, onApply, onClose }: { words: WordCheck[]; onApply: (words: WordCheck[]) => void; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>(() => words.map((w) => ({ ...w, key: ++keyCounter })))
  const [trial, setTrial] = useState('前見頃と後ろ身頃を縫い合わせ、記事を選んだ。')
  const setRow = (key: number, patch: Partial<WordCheck>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  // 開いたときの一覧（直したかどうかを見るため。説明なしと空の説明は同じとみなす）
  const plain = (list: WordCheck[]) => JSON.stringify(list.map((w) => [w.wrong, w.right, w.note ?? '', w.severity]))
  const [initial] = useState(() => plain(words))
  const changed = plain(rows) !== initial
  // 直して「反映する」を押していないあいだは、タブを閉じる・読み込み直すときに確かめる
  useLeaveGuard(changed)
  /** 「×」「やめる」・Esc：直していたら、消えてよいか確かめてから閉じる */
  const close = () => {
    if (changed && !confirm('直した内容は反映されずに消えます。閉じますか？')) return
    onClose()
  }
  /** 「反映する」：使わない行（空の行・同じ語の行）があれば、どの行かを示して確かめる */
  const apply = () => {
    const skipped = skippedWords(rows)
    if (skipped.length && !confirm(`次の行は使わずに外します。\n\n${skipped.map((s) => `・${s}`).join('\n')}\n\nこのまま反映しますか？（直すときは「キャンセル」）`)) return
    onApply(cleanWords(rows))
  }

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

  const ref = useRef<HTMLDivElement>(null)
  // 日本語の変換中に Esc（変換の取り消し）を押したときは、窓を閉じる確かめを出さない
  const composing = useRef(false)
  useDialogFocus(ref, () => !composing.current && close())
  return (
    // 書きかけの一覧が消えないよう、窓の外を押しても閉じない（「×」「やめる」・Esc は、直していたら確かめてから閉じる）
    <div className="modal-backdrop">
      <div
        className="modal words-modal"
        role="dialog"
        aria-modal="true"
        aria-label="書き間違えやすい語"
        ref={ref}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => (composing.current = false)}
      >
        <header>
          <h2>書き間違えやすい語</h2>
          <button className="close" onClick={close} aria-label="閉じる">
            ×
          </button>
        </header>
        <p className="lead">学生のセルフチェックで指摘し、正しい語を示します（直すのは学生自身です）。エラーは PDF の書き出しを止め、学生が「このままにする」で消すこともできません。要確認は知らせるだけです（文脈によっては正しいこともある語は、注意にします）。</p>
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
                    <option value="warning">要確認</option>
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
          <button onClick={close}>やめる</button>
          <button className="primary" onClick={apply}>
            反映する
          </button>
        </div>
      </div>
    </div>
  )
}
