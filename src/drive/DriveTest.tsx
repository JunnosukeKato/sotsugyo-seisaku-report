import { useState } from 'react'
import { account, DriveError, ensureFolder, findFile, findFolder, FOLDER_NAME, readFile, revoke, saveFile, signIn, trashFile, type Account, type Token } from './driveApi'

/**
 * Google ドライブの接続テスト（drive-test.html）。
 * 大学のアカウントで、このツールから学生本人のドライブに保存・読み込みができるか（大学の設定で止められていないか）を確かめる。
 * ドライブには「卒業制作報告書」フォルダと、テスト用のファイルだけを作る。結果は、個人のメールアドレスを除いた文にしてコピーできる。
 */

const SMALL_NAME = '接続テスト.json'
const LARGE_NAME = '接続テスト_大きいファイル.bin'
const LARGE_MB = 10
const CLIENT_KEY = 'sotsugyo-drive-test-client'

type StepKey = 'login' | 'save' | 'read' | 'large' | 'clean'
type Result = { ok: boolean; message: string; raw?: string }

const STEPS: { key: StepKey; title: string; hint: string }[] = [
  { key: 'login', title: 'ログインして、ドライブへの保存を許可する', hint: 'Google の小さな窓が開きます。大学のアカウントを選び、確認の画面で「許可」（または「続行」）を押してください。' },
  { key: 'save', title: '小さなファイルを保存し、上書きする', hint: `マイドライブに「${FOLDER_NAME}」フォルダを作り、「${SMALL_NAME}」を保存してから、もう一度上書きします。` },
  { key: 'read', title: '保存したファイルを読み込む', hint: '別の端末（スマホなど）でこのページを開き、1 と 3 だけを押すと、端末をまたいで読めるかも確かめられます。' },
  { key: 'large', title: `大きいファイル（${LARGE_MB}MB）を保存する`, hint: '写真がたくさん入った原稿くらいの大きさです。かかった時間を測ります（スマホのモバイル回線では時間がかかります）。' },
  { key: 'clean', title: 'テストで作ったファイルをゴミ箱に移す', hint: 'ゴミ箱からは30日で自動的に消えます。' },
]

const initialClientId = () => {
  const fromUrl = new URLSearchParams(location.search).get('client_id')
  if (fromUrl) return fromUrl
  if (import.meta.env.VITE_GOOGLE_CLIENT_ID) return import.meta.env.VITE_GOOGLE_CLIENT_ID as string
  try {
    return localStorage.getItem(CLIENT_KEY) ?? ''
  } catch {
    return ''
  }
}

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(bytes < 1024 ** 3 ? 2 : 1)}GB`

function browserName(): string {
  const ua = navigator.userAgent
  const device = /iPhone/.test(ua) ? 'iPhone' : /iPad|Macintosh.*Mobile/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Macintosh/.test(ua) ? 'Mac' : 'その他'
  const browser = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'その他'
  return `${device}・${browser}`
}

/** ログインが済んでいて、期限が切れていないこと */
function usable(token: Token | null): Token {
  if (!token || token.expiresAt < Date.now()) throw new DriveError('expired', '先に「1」でログインしてください')
  return token
}

/** 2〜5 の手順（成功したら結果の文を返す） */
const STEP_ACTIONS: Record<Exclude<StepKey, 'login'>, (token: Token | null) => Promise<string>> = {
  save: async (token) => {
    const t = usable(token)
    const folderId = await ensureFolder(t)
    const write = (n: number) => new Blob([JSON.stringify({ kind: 'connection-test', count: n, savedAt: new Date().toISOString(), device: browserName() })], { type: 'application/json' })
    const existing = await findFile(t, folderId, SMALL_NAME)
    const first = await saveFile(t, { name: SMALL_NAME, folderId, content: write(1), fileId: existing?.id })
    await saveFile(t, { name: SMALL_NAME, folderId, content: write(2), fileId: first.id })
    return `「${FOLDER_NAME}」フォルダに「${SMALL_NAME}」を保存し、上書きもできました`
  },
  read: async (token) => {
    const t = usable(token)
    const folderId = await findFolder(t)
    const file = folderId && (await findFile(t, folderId, SMALL_NAME))
    if (!file) throw new DriveError('missing', `「${SMALL_NAME}」が見つかりません。先に「2」で保存してください`)
    const body = JSON.parse(await (await readFile(t, file.id)).text())
    return `読み込めました（${new Date(body.savedAt).toLocaleString('ja-JP')} に ${body.device} で保存したもの）`
  },
  large: async (token) => {
    const t = usable(token)
    const folderId = await ensureFolder(t)
    const bytes = new Uint8Array(LARGE_MB * 1024 * 1024)
    for (let i = 0; i < bytes.length; i += 65536) crypto.getRandomValues(bytes.subarray(i, i + 65536))
    const existing = await findFile(t, folderId, LARGE_NAME)
    const started = performance.now()
    await saveFile(t, { name: LARGE_NAME, folderId, content: new Blob([bytes], { type: 'application/octet-stream' }), fileId: existing?.id })
    return `${LARGE_MB}MB を ${((performance.now() - started) / 1000).toFixed(1)}秒で保存できました`
  },
  clean: async (token) => {
    const t = usable(token)
    const folderId = await findFolder(t)
    if (!folderId) return 'テストで作ったものは、もうありません'
    for (const name of [SMALL_NAME, LARGE_NAME]) {
      const file = await findFile(t, folderId, name)
      if (file) await trashFile(t, file.id)
    }
    await trashFile(t, folderId)
    return `「${FOLDER_NAME}」フォルダとテストのファイルをゴミ箱に移しました`
  },
}

export function DriveTest() {
  const [clientId, setClientId] = useState(initialClientId)
  const [role, setRole] = useState<'' | '教職員' | '学生'>('')
  const [token, setToken] = useState<Token | null>(null)
  const [info, setInfo] = useState<Account | null>(null)
  const [results, setResults] = useState<Partial<Record<StepKey, Result>>>({})
  const [testedAt, setTestedAt] = useState('')
  const [running, setRunning] = useState<StepKey | null>(null)
  const [copied, setCopied] = useState(false)

  const run = async (key: StepKey, fn: () => Promise<string>) => {
    setRunning(key)
    setCopied(false)
    try {
      const message = await fn()
      setResults((r) => ({ ...r, [key]: { ok: true, message } }))
    } catch (e) {
      const err = e instanceof DriveError ? e : new DriveError('unknown', '思わぬエラーが起きました', String(e))
      setResults((r) => ({ ...r, [key]: { ok: false, message: err.message, raw: err.raw } }))
      if (err.code === 'expired') setToken(null)
    } finally {
      setRunning(null)
      setTestedAt(new Date().toLocaleString('ja-JP'))
    }
  }

  const login = async () => {
    const id = clientId.trim()
    if (!id) throw new DriveError('client', 'クライアント ID が入っていません')
    try {
      localStorage.setItem(CLIENT_KEY, id)
    } catch {
      // 覚えておけなくても、テストはできる
    }
    const t = await signIn(id)
    setToken(t)
    const a = await account(t)
    setInfo(a)
    return `ログインできました（${a.email}）`
  }

  // 結果の文（メールアドレスは、@ より後ろだけにする）
  const summary = [
    `ドライブ接続テスト ${testedAt}`,
    `立場：${role || '（未選択）'}　端末：${browserName()}`,
    `アカウント：${info ? `@${info.email.split('@')[1] ?? ''}` : '（未ログイン）'}`,
    ...STEPS.map((s, i) => {
      const r = results[s.key]
      return `${i + 1}. ${s.title}：${r ? `${r.ok ? '○' : '×'} ${r.message}${r.raw ? `［${r.raw}］` : ''}` : '（未実行）'}`
    }),
    `容量：${info ? `使用 ${gb(info.usage)}／上限 ${info.limit ? gb(info.limit) : 'なし（または共有の上限）'}` : '（未確認）'}`,
  ].join('\n')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary)
      setCopied(true)
    } catch {
      setCopied(false)
      alert('コピーできませんでした。下の結果の文を選んでコピーしてください')
    }
  }

  return (
    <main className="dt">
      <h1>Google ドライブの接続テスト</h1>
      <p className="lead">
        卒業制作報告書のツールから、大学のアカウントのドライブに原稿を保存できるか（大学の設定で止められていないか）を確かめるページです。ドライブには「{FOLDER_NAME}」フォルダとテスト用のファイルだけを作ります。このツールは、ほかのファイルを見ることはできません。
      </p>

      <section className="dt-card">
        <div className="dt-row">
          <span className="l">あなたは</span>
          {(['教職員', '学生'] as const).map((r) => (
            <label key={r} className="radio">
              <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} />
              {r}
            </label>
          ))}
        </div>
        {!import.meta.env.VITE_GOOGLE_CLIENT_ID && (
          <label className="dt-row">
            <span className="l">クライアント ID</span>
            <input className="in" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="〜.apps.googleusercontent.com" />
          </label>
        )}
      </section>

      <ol className="dt-steps">
        {STEPS.map((s, i) => {
          const r = results[s.key]
          return (
            <li key={s.key} className={r ? (r.ok ? 'ok' : 'ng') : ''}>
              <div className="head">
                <span className="no">{i + 1}</span>
                <b>{s.title}</b>
                <button className={i === 0 ? 'primary' : ''} disabled={running !== null || (i > 0 && !token)} onClick={() => void run(s.key, s.key === 'login' ? login : () => STEP_ACTIONS[s.key as Exclude<StepKey, 'login'>](token))}>
                  {running === s.key ? '実行中…' : r ? 'もう一度' : '実行'}
                </button>
              </div>
              <p className="hint">{s.hint}</p>
              {r && (
                <p className="result">
                  {r.ok ? '○ ' : '× '}
                  {r.message}
                  {r.raw && <small>{r.raw}</small>}
                </p>
              )}
            </li>
          )
        })}
      </ol>

      {info && (
        <p className="quota">
          ドライブの容量：使用 {gb(info.usage)}／上限 {info.limit ? gb(info.limit) : 'なし（または大学全体で共有の上限）'}
        </p>
      )}

      <section className="dt-card">
        <div className="dt-row">
          <b>結果</b>
          <span className="spacer" />
          <button onClick={() => void copy()}>{copied ? 'コピーしました' : '結果をコピー'}</button>
        </div>
        <p className="hint">この文をそのまま送ってください（メールアドレスは @ より後ろだけが入ります）。</p>
        <textarea className="in summary" readOnly value={summary} rows={9} />
      </section>

      {token && (
        <p className="revoke">
          <button
            className="link"
            onClick={async () => {
              await revoke(token)
              setToken(null)
              setInfo(null)
              alert('このツールへの許可を取り消しました')
            }}
          >
            テストが終わったら：このツールへの許可を取り消す
          </button>
        </p>
      )}
    </main>
  )
}
