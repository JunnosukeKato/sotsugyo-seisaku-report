import { describe, expect, it, vi } from 'vitest'
import { explainApiError, explainAuthError, explainPopupError, multipartBody, quote, saveFile, signIn, signInReady } from './driveApi'

describe('ドライブのエラーの説明', () => {
  it('大学の設定で止められているときは、そうと分かる言葉にする', () => {
    expect(explainAuthError('admin_policy_enforced')).toMatchObject({ code: 'blocked', message: expect.stringContaining('大学の管理者の設定') })
    expect(explainApiError(403, 'domainPolicy', 'The domain administrators have disabled Drive apps.')).toMatchObject({ code: 'blocked', raw: '403 domainPolicy The domain administrators have disabled Drive apps.' })
  })

  it('ツールの登録の不備・容量・期限切れ・ポップアップを見分ける', () => {
    expect(explainApiError(403, 'accessNotConfigured').code).toBe('api')
    expect(explainApiError(403, 'storageQuotaExceeded').code).toBe('quota')
    expect(explainApiError(401, '').code).toBe('expired')
    expect(explainApiError(403, 'insufficientPermissions').code).toBe('scope')
    expect(explainApiError(503, '').code).toBe('server')
    expect(explainPopupError('popup_failed_to_open').code).toBe('popup')
    expect(explainPopupError('popup_closed').message).toContain('admin_policy_enforced')
  })
})

describe('ドライブへの送り方', () => {
  it('情報と中身を1回で送る本文を作る', async () => {
    const body = await multipartBody({ name: 'a.json' }, new Blob(['{"x":1}'], { type: 'application/json' }), 'B').text()
    expect(body).toBe('--B\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"name":"a.json"}\r\n--B\r\nContent-Type: application/json\r\n\r\n{"x":1}\r\n--B--')
  })

  it('上書きするとき、rename なら名前も今の名前にする（書き出した PDF）。rename でなければ名前は送らない（原稿.json）', async () => {
    const sent: { at: string; body: string }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      sent.push({ at: `${init.method} ${url}`, body: await (init.body as Blob).text() })
      return new Response(JSON.stringify({ id: 'f1', name: 'x', modifiedTime: 't' }), { status: 200 })
    })
    try {
      const token = { accessToken: 'tok', expiresAt: Date.now() + 3600_000 }
      const content = new Blob(['%PDF-1'], { type: 'application/pdf' })
      await saveFile(token, { name: '00ZZ0123_文化花子.pdf', content, folderId: 'folder', fileId: 'f1', appProperties: { kind: 'pdf' }, rename: true })
      await saveFile(token, { name: '原稿.json', content, folderId: 'folder', fileId: 'f2', appProperties: { writer: 'w' } })
      // 本文の1つめの部分（情報）
      const metadata = (body: string) => JSON.parse(body.split('\r\n\r\n')[1].split('\r\n')[0])
      expect(sent[0].at).toMatch(/^PATCH https:\/\/www\.googleapis\.com\/upload\/drive\/v3\/files\/f1\?uploadType=multipart/)
      expect(metadata(sent[0].body)).toEqual({ name: '00ZZ0123_文化花子.pdf', appProperties: { kind: 'pdf' } })
      expect(metadata(sent[1].body)).toEqual({ appProperties: { writer: 'w' } })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('大きい PDF（4MB を超える）は分けて送れる方式で送り、上書きのときも、はじめの問い合わせで名前を今の名前にする', async () => {
    const sent: { at: string; body: unknown; type?: string }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      sent.push({ at: `${init.method} ${url}`, body: init.body, type: (init.headers as Record<string, string> | undefined)?.['X-Upload-Content-Type'] })
      if (url.includes('uploadType=resumable')) return new Response('', { status: 200, headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files/f1?upload_id=u1' } })
      return new Response(JSON.stringify({ id: 'f1', name: 'x', modifiedTime: 't' }), { status: 200 })
    })
    try {
      const content = new Blob([new Uint8Array(4 * 1024 * 1024 + 1)], { type: 'application/pdf' })
      await saveFile({ accessToken: 'tok', expiresAt: Date.now() + 3600_000 }, { name: '00ZZ0123_文化花子.pdf', content, folderId: 'folder', fileId: 'f1', appProperties: { kind: 'pdf' }, rename: true })
      expect(sent.map((s) => s.at.replace(/\?.*$/, ''))).toEqual(['PATCH https://www.googleapis.com/upload/drive/v3/files/f1', 'PUT https://www.googleapis.com/upload/drive/v3/files/f1'])
      expect(JSON.parse(sent[0].body as string)).toEqual({ name: '00ZZ0123_文化花子.pdf', appProperties: { kind: 'pdf' } })
      expect(sent[0].type).toBe('application/pdf')
      expect(sent[1].body).toBe(content)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('検索の条件に入れる名前の \' と \\ をエスケープする', () => {
    expect(quote("学生's 報告書\\")).toBe("'学生\\'s 報告書\\\\'")
  })
})

describe('ログイン（Google の窓）', () => {
  it('窓を開く準備は一度だけ作り、押したら待たずにその場で窓を開く（続けて開いたときは、どちらにも同じ返事を渡す）', async () => {
    const opened: unknown[] = []
    let answer: ((r: { access_token: string; expires_in: number; scope: string }) => void) | null = null
    const initTokenClient = vi.fn((cfg: { callback: typeof answer }) => {
      answer = cfg.callback
      return { requestAccessToken: (options: unknown) => opened.push(options) }
    })
    vi.stubGlobal('window', { google: { accounts: { oauth2: { initTokenClient, hasGrantedAllScopes: () => true, revoke: () => {} } } } })
    try {
      expect(signInReady()).toBe(true)
      const first = signIn('client', { prompt: '', hint: 'a@example.ac.jp' })
      // 待たずに、この場で窓を開いている（間に待ちが入ると、ブラウザが窓を止める）
      expect(opened).toEqual([{ prompt: '', login_hint: 'a@example.ac.jp', hint: 'a@example.ac.jp' }])
      const second = signIn('client')
      expect(opened).toEqual([{ prompt: '', login_hint: 'a@example.ac.jp', hint: 'a@example.ac.jp' }, { prompt: 'select_account' }])
      expect(initTokenClient).toHaveBeenCalledTimes(1)
      answer!({ access_token: 'tok', expires_in: 3600, scope: 'x' })
      expect((await first).accessToken).toBe('tok')
      expect((await second).accessToken).toBe('tok')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
