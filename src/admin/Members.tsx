import { useEffect, useRef, useState } from 'react'
import { useDialogFocus } from '../app/useDialogFocus'
import { isUniversityAddress, parseAddresses, studentIdFromEmail } from '../model/account'
import { server, type Member } from './server'

/**
 * 管理者と先生の登録（管理者だけが使う）。
 * 先生は、どのコースの「下書きのひな形」と「書き間違えやすい語」も編集できる（年度の設定はほかには変えられない）。
 * 登録の欄には、1人分でも、メーリングリストの宛先を何人分でも貼り付けられる（mockups/v20 案3）。
 * 2人以上なら、読み取った結果を一覧で見せてから登録する（学生のアドレス・大学のアドレスでないもの・登録済みの人は登録しない）
 */

type Row = { name: string; email: string; kind: 'ok' | 'muted' | 'ng'; state: string }

export function MembersDialog({ me, studentIdPattern, onClose }: { me: string; studentIdPattern: string | null; onClose: () => void }) {
  const [members, setMembers] = useState<Member[] | null>(null)
  const [text, setText] = useState('')
  const [role, setRole] = useState<Member['role']>('先生')
  /** 読み取った結果で、チェックを外した人 */
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useDialogFocus(ref, onClose)

  useEffect(() => {
    server.getMembers().then(setMembers, (e) => setError(String(e?.message ?? e)))
  }, [])

  const run = async (fn: () => Promise<Member[]>) => {
    setError('')
    try {
      setMembers(await fn())
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    }
  }

  const rows: Row[] = parseAddresses(text).map((p) => {
    const existing = members?.find((m) => m.email.toLowerCase() === p.email)
    if (existing) return { ...p, kind: 'muted', state: `登録済み（${existing.role}）` }
    if (!isUniversityAddress(p.email)) return { ...p, kind: 'ng', state: '大学のアドレスでないため登録しない' }
    if (studentIdFromEmail(p.email, studentIdPattern)) return { ...p, kind: 'ng', state: '学生のアドレスのため登録しない' }
    return { ...p, kind: 'ok', state: '新しく登録' }
  })
  const chosen = rows.filter((r) => r.kind === 'ok' && !unchecked.has(r.email))
  const many = rows.length >= 2
  const showRows = many || (rows.length === 1 && rows[0].kind !== 'ok')
  const toggle = (email: string) => {
    const next = new Set(unchecked)
    if (next.has(email)) next.delete(email)
    else next.add(email)
    setUnchecked(next)
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal members" role="dialog" aria-modal="true" aria-label="管理者と先生の登録" ref={ref}>
        <header>
          <h2>管理者と先生の登録</h2>
          <button className="close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </header>
        <p className="lead">
          大学の Google アカウントのメールアドレスで登録します。<b>先生</b>は、どのコースの「下書きのひな形」と「書き間違えやすい語」を編集できます（ほかの設定は変えられません）。<b>管理者</b>は、すべての設定の変更と公開ができます。
        </p>
        {error && <div className="message ng">{error}</div>}
        {!members ? (
          <p className="lead">読み込んでいます…</p>
        ) : (
          <ul className="member-list">
            {members.map((m) => (
              <li key={m.email}>
                <span className="who">
                  {m.email}
                  {m.memo && <small>{m.memo}</small>}
                </span>
                <select className="sel" value={m.role} disabled={m.email.toLowerCase() === me.toLowerCase()} onChange={(e) => void run(() => server.addMember(m.email, e.target.value as Member['role'], m.memo))}>
                  <option value="先生">先生</option>
                  <option value="管理者">管理者</option>
                </select>
                {m.email.toLowerCase() === me.toLowerCase() ? (
                  <span className="hint">（自分）</span>
                ) : (
                  <button className="danger" onClick={() => confirm(`${m.email} の登録を外しますか？`) && void run(() => server.removeMember(m.email))}>
                    外す
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="member-add">
          <textarea
            className="in"
            rows={many || text.includes('\n') ? 3 : 1}
            value={text}
            placeholder="メールアドレス（例：sensei@…ac.jp）。メーリングリストの宛先を、そのまま何人分でも貼り付けられます"
            onChange={(e) => {
              setText(e.target.value)
              setUnchecked(new Set())
            }}
          />
          <select className="sel" value={role} onChange={(e) => setRole(e.target.value as Member['role'])}>
            <option value="先生">先生</option>
            <option value="管理者">管理者</option>
          </select>
          <button
            className="primary"
            disabled={!chosen.length}
            onClick={() =>
              void run(async () => {
                const list = await server.addMembers(
                  chosen.map((r) => ({ email: r.email, memo: r.name })),
                  role,
                )
                setText('')
                setUnchecked(new Set())
                return list
              })
            }
          >
            {many ? `${chosen.length}人を登録する` : '登録する'}
          </button>
        </div>
        {text.trim() && !rows.length && <p className="bulk-hint">メールアドレスが見つかりません</p>}
        {showRows && (
          <>
            <p className="bulk-hint">
              {rows.length}件読み取りました。{many ? 'チェックの入った人を登録します（名前はメモになります）。' : ''}
            </p>
            <table className="bulk-table">
              <thead>
                <tr>
                  <th />
                  <th>名前（メモになる）</th>
                  <th>メールアドレス</th>
                  <th>読み取った結果</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.email} className={r.kind}>
                    <td>
                      <input type="checkbox" checked={r.kind === 'ok' && !unchecked.has(r.email)} disabled={r.kind !== 'ok'} onChange={() => toggle(r.email)} />
                    </td>
                    <td>{r.name || <span className="none">（名前なし）</span>}</td>
                    <td>{r.email}</td>
                    <td className="st">{r.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        <div className="row-buttons">
          <span className="spacer" />
          <button onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  )
}
