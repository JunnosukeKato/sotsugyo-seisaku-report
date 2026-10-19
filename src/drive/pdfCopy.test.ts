// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { currentConfig } from '../config'
import { createReport } from '../model/newReport'
import { blobToBase64, PdfCopyError, pdfCopyPayload, postPdfCopy, type PdfCopyPayload } from './pdfCopy'

/** base64 を読み戻した中身（1文字が1バイト） */
const decoded = (base64: string) => [...atob(base64)].map((c) => c.charCodeAt(0))
const pdfBlob = (text = 'body') => new Blob([`%PDF-1.4\n${text}\n%%EOF`], { type: 'application/pdf' })

describe('PDF の控えの中身', () => {
  it('base64 にした中身は、元のファイルと同じ（大きいファイルも、少しずつ文字にして同じ）', async () => {
    const bytes = new Uint8Array(200_000).map((_, i) => (i * 7919) % 256)
    const base64 = await blobToBase64(new Blob([bytes]))
    expect(base64).toMatch(/^[A-Za-z0-9+/]+=*$/)
    expect(decoded(base64)).toEqual([...bytes])
    expect(await blobToBase64(new Blob([]))).toBe('')
  })

  it('原稿の年度・コース・表紙の学籍番号と氏名（前後の空白を除く）と、ログインの許可を入れる', async () => {
    const report = createReport(currentConfig, currentConfig.courses[0].id)
    report.basicInfo = { ...report.basicInfo, studentId: ' 00ZZ0123 ', name: '文化　花子 ' }
    const payload = await pdfCopyPayload('token-1', report, pdfBlob())
    expect({ ...payload, pdf: undefined }).toEqual({ action: 'pdfCopy', token: 'token-1', year: currentConfig.fiscalYear, courseId: currentConfig.courses[0].id, studentId: '00ZZ0123', name: '文化　花子', pdf: undefined })
    expect(atob(payload.pdf)).toBe('%PDF-1.4\nbody\n%%EOF')
  })
})

describe('PDF の控えを送る', () => {
  const payload: PdfCopyPayload = { action: 'pdfCopy', token: 't', year: 2026, courseId: 'c', studentId: '00ZZ0123', name: '文化花子', pdf: 'JVBERg==' }
  const answer = (body: unknown, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })

  it('JSON を text/plain で1回送る（事前の問い合わせが要らない形。Google の cookie は送らない）', async () => {
    const fetch = vi.fn(async () => answer({ ok: true }))
    await postPdfCopy('https://script.google.com/macros/s/x/exec', payload, { fetch })
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://script.google.com/macros/s/x/exec')
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'text/plain;charset=utf-8' } })
    expect(JSON.parse(init.body as string)).toEqual(payload)
  })

  it('つながらなかったときだけ、1回やり直す', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(answer({ ok: true }))
    await postPdfCopy('u', payload, { fetch, retryDelayMs: 0 })
    expect(fetch).toHaveBeenCalledTimes(2)
    const twice = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(postPdfCopy('u', payload, { fetch: twice, retryDelayMs: 0 })).rejects.toThrow('Failed to fetch')
    expect(twice).toHaveBeenCalledTimes(2)
  })

  it('窓口が断ったとき・答えが読めないときは、やり直さずに理由を投げる', async () => {
    const refused = vi.fn(async () => answer({ ok: false, error: 'PDF の控えを置くフォルダが未設定' }))
    await expect(postPdfCopy('u', payload, { fetch: refused })).rejects.toThrow(new PdfCopyError('PDF の控えを置くフォルダが未設定'))
    expect(refused).toHaveBeenCalledTimes(1)
    await expect(postPdfCopy('u', payload, { fetch: vi.fn(async () => answer('<html>')) })).rejects.toThrow('窓口の答えを読めませんでした')
    await expect(postPdfCopy('u', payload, { fetch: vi.fn(async () => answer({ ok: true }, 500)) })).rejects.toThrow('500')
  })
})
