import { useEffect, useState } from 'react'
import { server, type Member } from './server'

/**
 * 管理者と先生の登録（管理者だけが使う）。
 * 先生は、どのコースの「下書きのひな形」も編集できる（年度の設定はほかには変えられない）。
 */
export function MembersDialog({ me, onClose }: { me: string; onClose: () => void }) {
  const [members, setMembers] = useState<Member[] | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Member['role']>('先生')
  const [memo, setMemo] = useState('')
  const [error, setError] = useState('')

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

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal members" role="dialog" aria-label="管理者と先生の登録">
        <header>
          <h2>管理者と先生の登録</h2>
          <button className="close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </header>
        <p className="lead">
          大学の Google アカウントのメールアドレスで登録します。<b>先生</b>は、どのコースの「下書きのひな形」も編集できます（ほかの設定は変えられません）。<b>管理者</b>は、すべての設定の変更と公開ができます。
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
          <input className="in" type="email" value={email} placeholder="メールアドレス（例：sensei@…ac.jp）" onChange={(e) => setEmail(e.target.value)} />
          <select className="sel" value={role} onChange={(e) => setRole(e.target.value as Member['role'])}>
            <option value="先生">先生</option>
            <option value="管理者">管理者</option>
          </select>
          <input className="in" value={memo} placeholder="メモ（例：衣装コースの先生）" onChange={(e) => setMemo(e.target.value)} />
          <button
            className="primary"
            disabled={!email.trim()}
            onClick={() =>
              void run(async () => {
                const list = await server.addMember(email.trim(), role, memo.trim())
                setEmail('')
                setMemo('')
                return list
              })
            }
          >
            登録する
          </button>
        </div>
        <div className="row-buttons">
          <span className="spacer" />
          <button onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  )
}
