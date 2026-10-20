import type { ReactNode } from 'react'
import { describeChanges, shortChanges } from './changes'
import type { HistoryRow } from './server'
import { SectionHead } from './ui'
import { SlowNote, Waiting } from './Wait'

/**
 * 「変更履歴」の区切り（mockups/v43 案B。前の版の窓の中身を、画面の中に出す）。
 * 保存・公開などの記録を新しい順に並べ、1つ前の記録から何が変わったかを短く添える。「この内容を読み込む」で、その時点の内容を画面に出す（保存はしない）
 */

/**
 * 変更履歴の i 番目の記録で、1つ前の記録から何が変わったか（短く。いちばん古い記録は、比べる相手がないので空）。
 * 一覧は新しい順なので、1つ前の記録は i + 1 番目
 */
function historyChanges(history: HistoryRow[], i: number): string {
  return history[i + 1] ? shortChanges(describeChanges(history[i + 1].config, history[i].config)) : ''
}

export function HistorySection({ year, history, loading, slow, onRestore, notices }: { year: number; history: HistoryRow[] | null; loading: boolean; slow: boolean; onRestore: (row: HistoryRow) => void; notices?: ReactNode }) {
  return (
    <div className="history-sec">
      <SectionHead title="変更履歴" lead={`${year}年度の、保存・公開などの記録です（新しい順）。「この内容を読み込む」で、その時点の内容を画面に出します。保存するまでは、学生に届きません。`} />
      {notices}
      <div className="card">
        {loading ? (
          <p className="wait-line" role="status">
            <Waiting text="読み込んでいます…" />
            <SlowNote show={slow} />
          </p>
        ) : !history ? (
          <p className="empty">読み込めませんでした。</p>
        ) : history.length === 0 ? (
          <p className="empty">まだ変更履歴はありません。</p>
        ) : (
          <ul className="history">
            {history.map((h, i) => (
              <li key={i}>
                <span className="what">
                  <b>
                    {new Date(h.at).toLocaleString('ja-JP')}　{h.action}
                  </b>
                  <small>
                    {h.user}
                    {historyChanges(history, i) && `　変更：${historyChanges(history, i)}`}
                  </small>
                </span>
                <button className="btn sm" onClick={() => onRestore(h)}>
                  この内容を読み込む
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
