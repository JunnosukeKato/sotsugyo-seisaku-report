import { useEffect, useRef, useState } from 'react'
import { useDialogFocus } from '../app/useDialogFocus'
import { parseAddresses, studentIdFromEmail, UNIVERSITY_DOMAIN } from '../model/account'
import { isMockServer, server, type Member } from './server'

/**
 * 管理者と先生の登録（管理者だけが使う）。
 * 先生は、どのコースの「下書きのひな形」「お知らせ」と「書き間違えやすい語」を編集できる（年度の設定はほかには変えられない）。
 * 登録の欄には、1人分でも、メーリングリストの宛先を何人分でも貼り付けられる（mockups/v20 案3）。
 * 2人以上なら、読み取った結果を一覧で見せてから登録する（学生のアドレス・大学のアドレスでないもの・登録済みの人は登録しない）
 */

type Row = { name: string; email: string; kind: 'ok' | 'muted' | 'ng'; state: string }

/**
 * 登録できるアドレスのドメイン（大学のアドレスだけ）。試験用サーバーでは、試験用の管理者・先生と同じ example.ac.jp も
 * 登録できるようにする（本番の Apps Script では使わない）
 */
const DOMAINS = [UNIVERSITY_DOMAIN, ...(isMockServer ? ['example.ac.jp'] : [])]
const allowed = (email: string) => DOMAINS.some((d) => email.toLowerCase().endsWith(`@${d.toLowerCase()}`))
const DOMAIN_TEXT = `大学のアドレス（@${UNIVERSITY_DOMAIN}${isMockServer ? '。試験用サーバーでは @example.ac.jp も' : ''}）だけ登録できます`

/** 管理者を2人以上にしておく（1人だけだと、その人が使えなくなったときに、だれも設定を変えられなくなる） */
const ONE_ADMIN = '管理者が1人だけになります。その人が異動などで使えなくなると、だれも年度の設定を変えられなくなるため、管理者は2人以上にしておいてください。'

export function MembersDialog({ me, studentIdPattern, onClose }: { me: string; studentIdPattern: string | null; onClose: () => void }) {
  const [members, setMembers] = useState<Member[] | null>(null)
  const [text, setText] = useState('')
  const [role, setRole] = useState<Member['role']>('先生')
  /** 読み取った結果で、チェックを外した人 */
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  /** 役割を変えた・登録を外したときの知らせ */
  const [info, setInfo] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  /** 窓の外・「×」「閉じる」・Esc：登録の欄に入力したまま（まだ登録していない）なら、消えてよいか確かめてから閉じる */
  const close = () => {
    if (text.trim() && !confirm('登録の欄に入力したメールアドレスは、まだ登録していません。閉じると消えます。閉じますか？')) return
    onClose()
  }
  useDialogFocus(ref, close)

  useEffect(() => {
    server.getMembers().then(setMembers, (e) => setError(String(e?.message ?? e)))
  }, [])

  const run = async (fn: () => Promise<Member[]>, done = '') => {
    setError('')
    setInfo('')
    try {
      setMembers(await fn())
      setInfo(done)
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    }
  }

  /** 変えたあとの管理者の人数 */
  const adminsAfter = (list: Member[]) => list.filter((m) => m.role === '管理者').length
  const changeRole = (m: Member, next: Member['role']) => {
    if (!members) return
    const after = members.map((x) => (x.email === m.email ? { ...x, role: next } : x))
    const lines = [
      `${m.email} を「${next}」にしますか？`,
      next === '管理者' ? '管理者は、すべての設定の変更と公開、先生の登録ができます。' : '先生は、ひな形・お知らせ・書き間違えやすい語だけを編集できます（年度の設定の変更・公開・先生の登録はできなくなります）。',
    ]
    if (adminsAfter(after) === 1) lines.push('', ONE_ADMIN)
    // 「キャンセル」なら何もしない（選ぶ欄は、元の役割に戻る）
    if (!confirm(lines.join('\n'))) return
    void run(() => server.addMember(m.email, next, m.memo), `${m.email} を「${next}」にしました（その人が管理ページを開き直すと、${next}の画面になります）`)
  }
  const remove = (m: Member) => {
    if (!members) return
    const lines = [`${m.email} の登録を外しますか？`]
    if (adminsAfter(members.filter((x) => x.email !== m.email)) === 1) lines.push('', ONE_ADMIN)
    if (!confirm(lines.join('\n'))) return
    void run(() => server.removeMember(m.email), `${m.email} の登録を外しました`)
  }

  const rows: Row[] = parseAddresses(text).map((p) => {
    const existing = members?.find((m) => m.email.toLowerCase() === p.email)
    if (existing) return { ...p, kind: 'muted', state: `登録済み（${existing.role}）` }
    if (!allowed(p.email)) return { ...p, kind: 'ng', state: DOMAIN_TEXT }
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
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal members" role="dialog" aria-modal="true" aria-label="管理者と先生の登録" ref={ref}>
        <header>
          <h2>管理者と先生の登録</h2>
          <button className="close" onClick={close} aria-label="閉じる">
            ×
          </button>
        </header>
        <p className="lead">
          大学の Google アカウントのメールアドレスで登録します。<b>先生</b>は、どのコースの「下書きのひな形」「お知らせ」と「書き間違えやすい語」を編集できます（ほかの設定は変えられません）。<b>管理者</b>は、すべての設定の変更と公開ができます。管理者は2人以上にしておいてください。
        </p>
        {error && <div className="message ng">{error}</div>}
        {!error && info && <div className="message ok">{info}</div>}
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
                <select className="sel" value={m.role} disabled={m.email.toLowerCase() === me.toLowerCase()} onChange={(e) => changeRole(m, e.target.value as Member['role'])}>
                  <option value="先生">先生</option>
                  <option value="管理者">管理者</option>
                </select>
                {m.email.toLowerCase() === me.toLowerCase() ? (
                  <span className="hint">（自分）</span>
                ) : (
                  <button className="danger" onClick={() => remove(m)}>
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
          <button onClick={close}>閉じる</button>
        </div>
      </div>
    </div>
  )
}
