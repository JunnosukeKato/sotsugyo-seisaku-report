import { useEffect, useRef, useState } from 'react'
import { deviceName } from '../drive/device'
import { loadManuscript, loadMine, makePdf, type MakePdfResult, type Progress, type SourceKind } from './makePdf'
import { DEFAULT_DPI, DEFAULT_QUALITY } from './pagesToPdf'

/**
 * PDF を手元で作る試し（pdf-test.html）。
 * 学生が「PDFを書き出す」を押したときに、先生のドライブへ送る控えの PDF を、印刷の画面を通さずにツールの中で作れるかを確かめる。
 * 紙面の各ページを画像にして、A4 の PDF にまとめる（文字は選べない）。原稿はこの端末の外には送らない。
 */

const SOURCES: { key: SourceKind; title: string; hint: string }[] = [
  { key: 'demo', title: '見本の原稿', hint: '表紙・抄録・目次・本文・作品写真の、ふつうの長さの見本です。図と写真は仮の画像です。' },
  { key: 'long', title: '長い見本', hint: '本文16ページほど・図8枚・作品写真6枚。写真の多い報告書で、時間と大きさを確かめます。' },
  { key: 'mine', title: 'この端末に保存されている自分の原稿', hint: 'このブラウザで書いている原稿を使います（原稿は変えません）。' },
]

const DPI_CHOICES = [
  { value: 100, label: '100（粗い）' },
  { value: 150, label: '150（標準）' },
  { value: 200, label: '200（細かい）' },
]
const QUALITY_CHOICES = [
  { value: 0.6, label: '60' },
  { value: 0.7, label: '70' },
  { value: 0.8, label: '80（標準）' },
  { value: 0.9, label: '90' },
]

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}秒`
const megabytes = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`)

/** 縮小画像（幅 140 点の JPEG） */
function thumbnail(canvas: HTMLCanvasElement): Promise<string> {
  const small = document.createElement('canvas')
  small.width = 140
  small.height = Math.round((140 * canvas.height) / canvas.width)
  small.getContext('2d')!.drawImage(canvas, 0, 0, small.width, small.height)
  return new Promise((resolve) =>
    small.toBlob((b) => {
      small.width = small.height = 0
      resolve(b ? URL.createObjectURL(b) : '')
    }, 'image/jpeg', 0.8),
  )
}

export function PdfTest() {
  const paperRef = useRef<HTMLDivElement>(null)
  const [source, setSource] = useState<SourceKind>('demo')
  const [mine, setMine] = useState<{ savedAt: string } | null | undefined>(undefined)
  const [dpi, setDpi] = useState(DEFAULT_DPI)
  const [quality, setQuality] = useState(DEFAULT_QUALITY)
  const [draft, setDraft] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [result, setResult] = useState<(MakePdfResult & { url: string; sourceTitle: string; settings: string; at: string }) | null>(null)
  const [thumbs, setThumbs] = useState<string[]>([])
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    loadMine()
      .then((m) => setMine(m ? { savedAt: m.report.updatedAt } : null))
      .catch(() => setMine(null))
  }, [])

  const run = async () => {
    setError('')
    setCopied(false)
    if (result) URL.revokeObjectURL(result.url)
    for (const t of thumbs) URL.revokeObjectURL(t)
    setResult(null)
    setThumbs([])
    setProgress({ step: 'compose' })
    try {
      const manuscript = await loadManuscript(source)
      const made = await makePdf(paperRef.current!, manuscript, {
        draft,
        dpi,
        quality,
        onProgress: setProgress,
        onPage: async ({ canvas }) => {
          const url = await thumbnail(canvas)
          setThumbs((t) => [...t, url])
        },
      })
      setResult({
        ...made,
        url: URL.createObjectURL(made.blob),
        sourceTitle: SOURCES.find((s) => s.key === source)!.title,
        settings: `${dpi}dpi・画質${Math.round(quality * 100)}${draft ? '・下書きの透かし' : ''}`,
        at: new Date().toLocaleString('ja-JP'),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setProgress(null)
    }
  }

  const fileName = result ? `${result.title}.pdf` : ''
  const canShare = !!result && typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File([result.blob], fileName, { type: 'application/pdf' })] })
  const share = async () => {
    if (!result) return
    try {
      await navigator.share({ files: [new File([result.blob], fileName, { type: 'application/pdf' })], title: result.title })
    } catch {
      // 共有をやめたときは何もしない
    }
  }

  const summary = result
    ? [
        `PDF の試し ${result.at}`,
        `端末：${deviceName()}　画面：${screen.width}×${screen.height}（${devicePixelRatio}倍）`,
        `原稿：${result.sourceTitle}　設定：${result.settings}`,
        `ページ数：${result.pageCount}ページ（画像 ${result.widthPx}×${result.heightPx}点）`,
        `PDF の大きさ：${megabytes(result.blob.size)}（1ページ平均 ${megabytes(result.blob.size / Math.max(1, result.pageCount))}）`,
        `時間：合計 ${seconds(result.composeMs + result.ms.total)}（組版 ${seconds(result.composeMs)}・画像 ${seconds(result.ms.capture)}［1ページ ${seconds(result.ms.capture / Math.max(1, result.pageCount))}］・まとめ ${seconds(result.ms.assemble)}・準備 ${seconds(result.ms.load)}）`,
        `画像の内訳：複製 ${seconds(result.steps.clone)}・書体 ${seconds(result.steps.fonts)}・SVG ${seconds(result.steps.svg)}・描く ${seconds(result.steps.draw)}・JPEG ${seconds(result.steps.jpeg)}`,
      ].join('\n')
    : ''

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summary)
      setCopied(true)
    } catch {
      alert('コピーできませんでした。結果の文を選んでコピーしてください')
    }
  }

  const running = progress !== null
  const progressText =
    progress?.step === 'compose'
      ? '原稿を組版しています…'
      : progress && progress.done < progress.total
        ? `ページを画像にしています… ${progress.done}／${progress.total}ページ`
        : progress
          ? 'PDF にまとめています…'
          : ''

  return (
    <>
      <main className="pt">
        <h1>PDF を手元で作る試し</h1>
        <p className="lead">
          学生が「PDFを書き出す」を押したときに、先生のドライブへ送る控えの PDF を、このツールの中で作れるかを確かめるページです。紙面の各ページを画像にして、A4 の PDF にまとめます（文字は画像になるので、選んだりコピーしたりはできません）。原稿や PDF は、この端末の外には送りません。
        </p>

        <section className="pt-card">
          <b>1. 原稿を選ぶ</b>
          {SOURCES.map((s) => {
            const disabled = s.key === 'mine' && !mine
            return (
              <label key={s.key} className={`pt-choice${disabled ? ' disabled' : ''}`}>
                <input type="radio" name="source" checked={source === s.key} disabled={disabled || running} onChange={() => setSource(s.key)} />
                <span>
                  {s.title}
                  <small>
                    {s.key === 'mine'
                      ? mine === undefined
                        ? '確かめています…'
                        : mine
                          ? `${s.hint}（${new Date(mine.savedAt).toLocaleString('ja-JP')} に保存したもの）`
                          : 'この端末には、まだ原稿が保存されていません。'
                      : s.hint}
                  </small>
                </span>
              </label>
            )
          })}
        </section>

        <section className="pt-card">
          <b>2. 作り方を選ぶ</b>
          <div className="pt-row">
            <span className="l">画像の細かさ（dpi）</span>
            {DPI_CHOICES.map((c) => (
              <label key={c.value} className="radio">
                <input type="radio" name="dpi" checked={dpi === c.value} disabled={running} onChange={() => setDpi(c.value)} />
                {c.label}
              </label>
            ))}
          </div>
          <div className="pt-row">
            <span className="l">画質</span>
            {QUALITY_CHOICES.map((c) => (
              <label key={c.value} className="radio">
                <input type="radio" name="quality" checked={quality === c.value} disabled={running} onChange={() => setQuality(c.value)} />
                {c.label}
              </label>
            ))}
          </div>
          <label className="pt-check">
            <input type="checkbox" checked={draft} disabled={running} onChange={(e) => setDraft(e.target.checked)} />
            <span>「下書き」の透かしを入れる（エラーが残っているときの PDF）</span>
          </label>
        </section>

        <div className="pt-go">
          <button className="primary" disabled={running || (source === 'mine' && !mine)} onClick={() => void run()}>
            {running ? '作っています…' : '3. PDF を作る'}
          </button>
          {running && <span className="pt-progress">{progressText}（この画面のまま、お待ちください）</span>}
        </div>
        {running && progress?.step === 'capture' && (
          <div className="pt-bar" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
            <span style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
        )}
        {error && <p className="pt-error">× PDF を作れませんでした：{error}</p>}

        {result && (
          <section className="pt-card pt-result">
            <b>結果</b>
            <dl>
              <dt>ページ数</dt>
              <dd>
                {result.pageCount}ページ（画像 {result.widthPx}×{result.heightPx}点）
              </dd>
              <dt>PDF の大きさ</dt>
              <dd>
                {megabytes(result.blob.size)}（1ページ平均 {megabytes(result.blob.size / Math.max(1, result.pageCount))}）
              </dd>
              <dt>かかった時間</dt>
              <dd>
                合計 {seconds(result.composeMs + result.ms.total)}
                <small>
                  組版 {seconds(result.composeMs)}・画像にする {seconds(result.ms.capture)}（1ページ {seconds(result.ms.capture / Math.max(1, result.pageCount))}）・PDF にまとめる {seconds(result.ms.assemble)}・部品の読み込み {seconds(result.ms.load)}
                </small>
              </dd>
            </dl>
            <div className="pt-row">
              <a className="button primary" href={result.url} target="_blank" rel="noopener">
                PDF を開く
              </a>
              <a className="button" href={result.url} download={fileName}>
                PDF を保存
              </a>
              {canShare && <button onClick={() => void share()}>共有・「ファイル」に保存</button>}
            </div>
            <p className="hint">開いた PDF で、文字が読めるか・字がずれていないか・図と写真が出ているかを確かめてください。下の結果の文は「結果をコピー」で送れます。</p>
            <div className="pt-row">
              <span className="spacer" />
              <button onClick={() => void copy()}>{copied ? 'コピーしました' : '結果をコピー'}</button>
            </div>
            <textarea className="summary" readOnly value={summary} rows={7} />
          </section>
        )}

        {thumbs.length > 0 && (
          <section className="pt-thumbs" aria-label="各ページの縮小画像">
            {thumbs.map((t, i) => (
              <figure key={t}>
                <img src={t} alt={`${i + 1}ページ目`} />
                <figcaption>{i + 1}</figcaption>
              </figure>
            ))}
          </section>
        )}
      </main>
      {/* 組版した紙面を置く場所（見えないように置く。PDF の画像は、ここの紙面を複製して作る） */}
      <div className="pt-paper" ref={paperRef} aria-hidden="true" />
    </>
  )
}
