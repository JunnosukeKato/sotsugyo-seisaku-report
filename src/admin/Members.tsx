import { useEffect, useState, type ReactNode } from 'react'
import { parseAddresses, studentIdFromEmail, UNIVERSITY_DOMAIN } from '../model/account'
import { useConfirm } from './confirm'
import { isMockServer, server, type Member } from './server'
import { SectionHead } from './ui'
import { useDone, useSlow } from './useWait'
import { DoneNote, SlowNote, Waiting } from './Wait'

/**
 * 「先生の登録」の区切り（管理者だけ。mockups/v43 案B。前の版の窓の中身を、画面の中に出す）。
 * 先生は、すべてのコースの「下書きのひな形」「お知らせ」と、「書き間違えやすい語」を編集できる（年度の設定はほかには変えられない）。
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
/** 登録の欄に入力したまま、ほかの区切りに移る・タブを閉じるとき */
const UNSAVED = '登録の欄に入力したメールアドレスは、まだ登録していません。ほかの所に移ると消えます。移りますか？'

/**
 * サーバーを待っている操作（押したボタンに回る印と「登録しています…」などを出し、ほかの操作は終わるまで押せなくする）。
 * email は、役割を変えている・外している人
 */
type Busy = { kind: 'add' | 'role' | 'remove'; email?: string }
const WAIT_TEXT: Record<Busy['kind'], string> = { add: '登録しています…', role: '変更しています…', remove: '外しています…' }

export function MembersSection({
  me,
  studentIdPattern,
  members,
  loadError,
  onMembers,
  onPending,
  notices,
}: {
  me: string
  studentIdPattern: string | null
  /** 登録されている人（読み込み中は null） */
  members: Member[] | null
  /** 一覧を読み込めなかったときの理由 */
  loadError: string
  onMembers: (members: Member[]) => void
  /** 登録の欄に入力したままのとき、ほかの区切りに移る前に確かめる言葉（なければ null） */
  onPending: (message: string | null) => void
  /** 区切りの見出しのすぐ下に出す知らせ（保存した・断られた、入力の誤りなど） */
  notices?: ReactNode
}) {
  const [text, setText] = useState('')
  const [role, setRole] = useState<Member['role']>('先生')
  /** 読み取った結果で、チェックを外した人 */
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  /** 役割を変えた・登録を外したときの知らせ */
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState<Busy | null>(null)
  // 長く待っている（一覧の読み込み・登録・変更）ときは「数秒〜十数秒かかることがあります」
  const slow = useSlow(busy !== null || (members === null && !loadError))
  /** 終わったときの短い知らせ（「登録しました」など。数秒で消える） */
  const [doneText, showDone] = useDone()
  /** 確認の窓（画面の中に出す：confirm.tsx） */
  const ask = useConfirm()
  // 入力したまま、ほかの区切りに移るときは確かめる
  useEffect(() => {
    onPending(text.trim() ? UNSAVED : null)
    return () => onPending(null)
  }, [text, onPending])

  const run = async (what: Busy, fn: () => Promise<Member[]>, done = '') => {
    setError('')
    setInfo('')
    setBusy(what)
    try {
      onMembers(await fn())
      setInfo(done)
      showDone(what.kind === 'add' ? '登録しました' : what.kind === 'role' ? '変更しました' : '外しました')
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setBusy(null)
    }
  }

  /** 変えたあとの管理者の人数 */
  const adminsAfter = (list: Member[]) => list.filter((m) => m.role === '管理者').length
  const changeRole = async (m: Member, next: Member['role']) => {
    if (!members) return
    const after = members.map((x) => (x.email === m.email ? { ...x, role: next } : x))
    const lines = [
      `${m.email} を「${next}」にしますか？`,
      next === '管理者' ? '管理者は、すべての設定の変更と公開、先生の登録ができます。' : '先生は、ひな形・お知らせ・書き間違えやすい語だけを編集できます（年度の設定の変更・公開・先生の登録はできなくなります）。',
    ]
    if (adminsAfter(after) === 1) lines.push('', ONE_ADMIN)
    // 「やめる」なら何もしない（選ぶ欄は、元の役割に戻る）
    if (!(await ask(lines.join('\n'), { ok: `「${next}」にする` }))) return
    void run({ kind: 'role', email: m.email }, () => server.addMember(m.email, next, m.memo), `${m.email} を「${next}」にしました（その人が管理ページを開き直すと、${next}の画面になります）`)
  }
  const remove = async (m: Member) => {
    if (!members) return
    const lines = [`${m.email} の登録を外しますか？`]
    if (adminsAfter(members.filter((x) => x.email !== m.email)) === 1) lines.push('', ONE_ADMIN)
    if (!(await ask(lines.join('\n'), { ok: '登録を外す', danger: true }))) return
    void run({ kind: 'remove', email: m.email }, () => server.removeMember(m.email), `${m.email} の登録を外しました`)
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
    <div className="members">
      <SectionHead
        title="先生の登録"
        lead={
          <>
            大学の Google アカウントのメールアドレスで登録します。<b>先生</b>は、すべてのコースの「下書きのひな形」「お知らせ」と、「書き間違えやすい語」を編集できます（ほかの設定は変えられません）。<b>管理者</b>は、すべての設定の変更と公開ができます。管理者は2人以上にしておいてください。
          </>
        }
      />
      {notices}
      {(error || loadError) && <div className="message ng member-info">{error || loadError}</div>}
      {!error && !loadError && info && <div className="message ok member-info">{info}</div>}
      <div className="card">
        {!members ? (
          !loadError && (
            <p className="wait-line" role="status">
              <Waiting text="読み込んでいます…" />
            </p>
          )
        ) : (
          <ul className="member-list">
            {members.map((m) => (
              <li key={m.email}>
                <span className="who">
                  {m.email}
                  {m.memo && <small>{m.memo}</small>}
                </span>
                <select className="sel" aria-label={`${m.email} の役割`} value={m.role} disabled={m.email.toLowerCase() === me.toLowerCase() || !!busy} onChange={(e) => changeRole(m, e.target.value as Member['role'])}>
                  <option value="先生">先生</option>
                  <option value="管理者">管理者</option>
                </select>
                {m.email.toLowerCase() === me.toLowerCase() ? (
                  <span className="self">（自分）</span>
                ) : busy?.kind === 'role' && busy.email === m.email ? (
                  // 役割を変えている間は、「外す」の代わりに回る印と「変更しています…」
                  <span className="wait-line" role="status">
                    <Waiting text={WAIT_TEXT.role} />
                  </span>
                ) : (
                  <button className={`btn sm danger${busy?.kind === 'remove' && busy.email === m.email ? ' busy' : ''}`} disabled={!!busy} aria-busy={busy?.kind === 'remove' && busy.email === m.email} onClick={() => remove(m)}>
                    {busy?.kind === 'remove' && busy.email === m.email ? <Waiting text={WAIT_TEXT.remove} /> : '外す'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <h2 className="card-h">登録する</h2>
        <div className="member-add">
          <textarea
            className="in"
            aria-label="登録するメールアドレス"
            rows={many || text.includes('\n') ? 3 : 2}
            value={text}
            placeholder="メールアドレス（例：sensei@…ac.jp）。メーリングリストの宛先を、そのまま何人分でも貼り付けられます"
            onChange={(e) => {
              setText(e.target.value)
              setUnchecked(new Set())
            }}
          />
          <select className="sel" aria-label="登録する人の役割" value={role} onChange={(e) => setRole(e.target.value as Member['role'])}>
            <option value="先生">先生</option>
            <option value="管理者">管理者</option>
          </select>
          <button
            className={`btn primary${busy?.kind === 'add' ? ' busy' : ''}`}
            disabled={!chosen.length || !!busy}
            aria-busy={busy?.kind === 'add'}
            onClick={() =>
              void run({ kind: 'add' }, async () => {
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
            {busy?.kind === 'add' ? <Waiting text={WAIT_TEXT.add} /> : many ? `${chosen.length}人を登録する` : '登録する'}
          </button>
        </div>
        {/* 長く待っているときの1行と、終わったときの短い知らせ（「登録しました」など） */}
        <div className="wait-row">
          <SlowNote show={slow} />
          {!slow && <DoneNote text={doneText} />}
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
                      <input type="checkbox" aria-label={`${r.email} を登録する`} checked={r.kind === 'ok' && !unchecked.has(r.email)} disabled={r.kind !== 'ok'} onChange={() => toggle(r.email)} />
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
      </div>
    </div>
  )
}
