import { useEffect, useRef, useState } from 'react'
import type { ReportFinding } from '../checker/reportChecks'
import { deviceName } from '../drive/device'
import type { ReportEditor } from '../editor/reportEditor'
import { buildPdf, downloadPdf, saveMode, sharePdf, sizeText, thumbnail, type BuiltPdf } from '../pdf/exportPdf'
import { Modal } from './dialogs'
import { Icon } from './icons'
import { AREA_LABELS } from './labels'

/**
 * 「PDFを書き出す」の窓（mockups/v28 案C「窓の中で、できたページを見せる」）。
 * 3つを確かめる → PDF をツールの中で作る（進み具合と、できたページの小さな絵が1枚ずつ並ぶ）→ できた。
 * パソコン・Android は、できたらそのまま「ダウンロード」に保存する。iPhone・iPad は「保存する」を押して、共有の画面から保存する。
 * エラーが残っているときは、「下書き」の透かし入りの PDF を同じ流れで作る（ファイル名に _下書き）。
 * 作れなかったとき・うまくいかないときのために、今までの印刷の画面から保存する道も残す（窓の左下と、下書きの欄の小さなリンク）
 */

const SELF_CHECKS = [
  'タイトル（サブタイトルを含む）は、以前提出した申告書と同じにした',
  '作品写真は、自分で撮影した写真だけを使った',
  '指導教員に内容を見てもらい、了承を得た',
]

/** 印刷の画面での PDF の保存のしかた（端末とブラウザによって、印刷の画面が違う） */
function PrintSteps() {
  const device = deviceName()
  if (/^(iPhone|iPad)/.test(device)) {
    return (
      <ul>
        <li>
          印刷の画面の右上（または下）の <b>共有のボタン（四角に上向きの矢印）</b> を押し、<b>「"ファイル"に保存」</b> を選ぶ
        </li>
        <li>保存する場所（「iCloud Drive」や「このiPhone内」など）を選んで「保存」</li>
        <li>うまく保存できないときは、パソコンで書き出してください</li>
      </ul>
    )
  }
  if (/^Android/.test(device)) {
    return (
      <ul>
        <li>
          上のプリンターを <b>「PDF 形式で保存」</b> にする
        </li>
        <li>
          用紙サイズ：<b>A4</b>　→　<b>PDF のボタン</b> を押して保存
        </li>
      </ul>
    )
  }
  if (/^Mac・Safari/.test(device)) {
    return (
      <ul>
        <li>
          「詳細を表示」を押し、用紙サイズ：<b>A4</b>　「背景をプリント」：<b>チェックを入れる</b>　「ヘッダとフッタをプリント」：<b>チェックを外す</b>
        </li>
        <li>
          左下の <b>「PDF」</b> から <b>「PDF として保存」</b> を選ぶ
        </li>
      </ul>
    )
  }
  return (
    <ul>
      <li>
        送信先：<b>{/Edge/.test(device) ? 'PDF として保存' : 'PDF に保存'}</b>
      </li>
      <li>
        用紙サイズ：<b>A4</b>　／　倍率：<b>既定（100%）</b>
      </li>
      <li>
        詳細設定の「ヘッダーとフッター」：<b>オフ</b>　「背景のグラフィック」：<b>オン</b>
      </li>
    </ul>
  )
}

/** 印刷の画面で選ぶことと、ファイル名（作れなかったとき・うまくいかないとき） */
function PrintGuide({ fileName }: { fileName: string }) {
  return (
    <div className="print-guide">
      <b>印刷の画面で、次のように選んでください（{deviceName()}）</b>
      <PrintSteps />
      ファイル名は「<span className="fn">{fileName}</span>」になります。保存したら PDF を開いて、ページの数と写真を確かめてください。
    </div>
  )
}

/** 保存するファイルの名前と、保存する場所（または、ページの数と大きさ） */
function FileBox({ fileName, note, draft }: { fileName: string; note: string; draft?: boolean }) {
  return (
    <div className={`pdf-file${draft ? ' draft' : ''}`}>
      {Icon.pdf}
      <div>
        <b className="fn">{fileName}</b>
        <small>{note}</small>
      </div>
    </div>
  )
}

/** できたページの小さな絵（できていないページは空の枠、いま作っているページは枠を光らせる） */
function Thumbs({ urls, total, draft }: { urls: string[]; total: number; draft: boolean }) {
  return (
    <div className={`pdf-thumbs${draft ? ' draft' : ''}`} aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <figure key={i}>
          {urls[i] ? <img src={urls[i]} alt="" /> : <span className={`tile${i === urls.length ? ' now' : ''}`} />}
          {i + 1}
        </figure>
      ))}
    </div>
  )
}

type Phase =
  | { kind: 'start' }
  | { kind: 'build'; draft: boolean; total: number }
  | { kind: 'done'; pdf: BuiltPdf; saved: '' | 'shared' | 'fallback' }
  | { kind: 'error'; draft: boolean; message: string }

interface Props {
  editor: ReportEditor
  findings: ReportFinding[]
  onClose: () => void
  /** PDF ができたとき（あとで先生のドライブに送るときに、作り直さずに使うための入り口） */
  onBuilt?: (pdf: BuiltPdf) => void
}

export function ExportDialog({ editor, findings, onClose, onBuilt }: Props) {
  const errors = findings.filter((f) => f.severity === 'error')
  const warnings = findings.length - errors.length
  const [checked, setChecked] = useState<boolean[]>(SELF_CHECKS.map(() => false))
  const allChecked = checked.every(Boolean)
  const [phase, setPhase] = useState<Phase>({ kind: 'start' })
  /** できたページの小さな絵（URL） */
  const [thumbs, setThumbs] = useState<string[]>([])
  /** 「うまくいかないとき：印刷の画面から保存」を開いた */
  const [printOpen, setPrintOpen] = useState(false)
  const mode = saveMode()
  const abort = useRef<AbortController | null>(null)
  /** 使い終えたら解放する URL（小さな絵・PDF） */
  const urls = useRef<string[]>([])
  const pdfUrls = useRef<string[]>([])
  const fileName = (draft: boolean) => `${editor.pdfTitle}${draft ? '_下書き' : ''}.pdf`

  const releaseUrls = () => {
    for (const url of urls.current) URL.revokeObjectURL(url)
    urls.current = []
    // PDF は、保存や開くのが終わるまで少し待ってから解放する（すぐ解放すると、保存が途中で止まることがある）
    const done = pdfUrls.current
    pdfUrls.current = []
    if (done.length) window.setTimeout(() => done.forEach((url) => URL.revokeObjectURL(url)), 60_000)
  }
  // 窓を閉じたら、作っている途中なら止め、絵と PDF の URL を解放する
  useEffect(
    () => () => {
      abort.current?.abort()
      releaseUrls()
    },
    [],
  )

  /** draft：下書き（どのページにも「下書き」の透かしを入れる。エラーが残っていても出せる。提出には使えない） */
  const print = (draft = false) => {
    const title = document.title
    document.title = draft ? `${editor.pdfTitle}_下書き` : editor.pdfTitle
    document.documentElement.classList.toggle('print-draft', draft)
    window.addEventListener(
      'afterprint',
      () => {
        document.title = title
        document.documentElement.classList.remove('print-draft')
      },
      { once: true },
    )
    onClose()
    // ダイアログが閉じてから印刷画面を開く
    setTimeout(() => window.print(), 50)
  }

  /** PDF を作る。できたら、パソコン・Android はそのまま保存する */
  const build = async (draft: boolean) => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    releaseUrls()
    setThumbs([])
    const pages = editor.pageElements()
    setPhase({ kind: 'build', draft, total: pages.filter((p) => !p.classList.contains('print-skip')).length })
    try {
      const pdf = await buildPdf(pages, {
        title: draft ? `${editor.pdfTitle}_下書き` : editor.pdfTitle,
        draft,
        signal: controller.signal,
        onPage: async ({ canvas }) => {
          const url = await thumbnail(canvas)
          // 絵を縮めている間に「やめる」・窓を閉じたときは、すぐ解放する（次に作るときの絵に混ざらないように）
          if (controller.signal.aborted) {
            if (url) URL.revokeObjectURL(url)
            return
          }
          urls.current.push(url)
          setThumbs((t) => [...t, url])
        },
      })
      pdfUrls.current.push(pdf.url)
      if (controller.signal.aborted) return
      setPhase({ kind: 'done', pdf, saved: '' })
      onBuilt?.(pdf)
      if (mode === 'download') downloadPdf(pdf)
    } catch (e) {
      // 「やめる」で止めたときは、最初の画面に戻っている
      if (controller.signal.aborted) return
      setPhase({ kind: 'error', draft, message: e instanceof Error ? e.message : String(e) })
    }
  }

  /** 「やめる」：ページとページの間で止めて、最初の画面に戻る */
  const cancel = () => {
    abort.current?.abort()
    releaseUrls()
    setThumbs([])
    setPhase({ kind: 'start' })
  }

  /** iPhone・iPad の「保存する」：共有の画面を開く（押した直後に開く。やめたときは、もう一度押せる） */
  const share = async (pdf: BuiltPdf) => {
    const result = await sharePdf(pdf)
    if (result !== 'cancelled') setPhase({ kind: 'done', pdf, saved: result })
  }

  // 段階（作っている・できた・作れなかった）ごとに窓を作り直す（key）：開いた窓の最初のボタンに移り、Tab で外に出ないように
  // ---- 作っている ----
  if (phase.kind === 'build') {
    const title = phase.draft ? '下書きの PDF を作っています' : 'PDF を作っています'
    return (
      <Modal key="build" title={title} onClose={onClose} className="pdf-modal">
        <p className="lead">この画面のまま、お待ちください。</p>
        <div className="pdf-progress" role="progressbar" aria-valuemin={0} aria-valuemax={phase.total} aria-valuenow={thumbs.length} aria-label="できたページの数">
          <div className="bar">
            <i style={{ width: `${(thumbs.length / Math.max(1, phase.total)) * 100}%` }} />
          </div>
          <span>
            <b>{thumbs.length}</b> / {phase.total}ページ
          </span>
        </div>
        <Thumbs urls={thumbs} total={phase.total} draft={phase.draft} />
        <p className="pdf-small">写真が多いと、少し時間がかかります（20ページで10秒ほど。スマホはもう少し）。</p>
        <div className="row-buttons">
          <span className="spacer" />
          <button onClick={cancel}>やめる</button>
        </div>
      </Modal>
    )
  }

  // ---- できた ----
  if (phase.kind === 'done') {
    const { pdf, saved } = phase
    const size = `${pdf.pageCount}ページ・${sizeText(pdf.blob.size)}`
    if (mode === 'share') {
      return (
        <Modal key="done" title={pdf.draft ? '下書きの PDF ができました' : 'PDF ができました'} onClose={onClose} className="pdf-modal">
          <FileBox fileName={pdf.fileName} note={size} draft={pdf.draft} />
          <Thumbs urls={thumbs} total={pdf.pageCount} draft={pdf.draft} />
          <p className="lead">
            {saved === 'shared'
              ? '保存しました。ほかの場所にも保存するときは、もう一度「保存する」を押します。'
              : saved === 'fallback'
                ? '保存の画面を開けなかったため、ダウンロードしました。「PDF を開く」からも保存できます。'
                : '「保存する」を押して、「"ファイル"に保存」を選んでください。'}
          </p>
          <button className="primary pdf-save" data-autofocus onClick={() => void share(pdf)}>
            {Icon.share}
            {saved ? 'もう一度保存する' : '保存する'}
          </button>
          <div className="row-buttons">
            <button className="link pdf-fallback" onClick={() => window.open(pdf.url, '_blank')}>
              PDF を開く
            </button>
            <span className="spacer" />
            <button onClick={onClose}>閉じる</button>
          </div>
        </Modal>
      )
    }
    return (
      <Modal key="done" title={pdf.draft ? '下書きの PDF を保存しました' : '保存しました'} heading={<><span className="pdf-ok">{Icon.check}</span>{pdf.draft ? '下書きの PDF を保存しました' : '保存しました'}</>} onClose={onClose} className="pdf-modal">
        <FileBox fileName={pdf.fileName} note={`${size}　「ダウンロード」のフォルダ`} draft={pdf.draft} />
        <Thumbs urls={thumbs} total={pdf.pageCount} draft={pdf.draft} />
        <p className="lead">{pdf.draft ? 'どのページにも「下書き」の透かしが入っています（提出には使えません）。' : '開いて、ページの数と写真を確かめてください。'}</p>
        <div className="row-buttons">
          <button className="link pdf-fallback" onClick={() => downloadPdf(pdf)}>
            保存されていないときは、もう一度保存
          </button>
          <span className="spacer" />
          <button onClick={onClose}>閉じる</button>
          <button className="primary pdf-open" data-autofocus onClick={() => window.open(pdf.url, '_blank')}>
            {Icon.open}PDF を開く
          </button>
        </div>
      </Modal>
    )
  }

  // ---- 作れなかった：印刷の画面から保存する ----
  if (phase.kind === 'error') {
    return (
      <Modal key="error" title="PDF を作れませんでした" heading={<><span className="pdf-ng">{Icon.warn}</span>PDF を作れませんでした</>} onClose={onClose} className="pdf-modal">
        <p className="lead">この端末では、ツールの中で PDF を作れませんでした（メモリが足りないなど）。印刷の画面から保存してください。</p>
        <PrintGuide fileName={fileName(phase.draft)} />
        <p className="pdf-small">くわしいこと：{phase.message}</p>
        <div className="row-buttons">
          <span className="spacer" />
          <button onClick={() => void build(phase.draft)}>もう一度作る</button>
          <button className="primary pdf-print" onClick={() => print(phase.draft)}>
            印刷の画面を開く
          </button>
        </div>
      </Modal>
    )
  }

  // ---- エラーが残っている：下書きの PDF ----
  if (errors.length > 0) {
    return (
      <Modal key="start" title="PDFを書き出す前に" onClose={onClose}>
        <p className="lead">
          手順書のルールに合っていない箇所（エラー）が <b className="ng">{errors.length}件</b> あります。エラーを0件にすると、提出用のPDFを書き出せます。
        </p>
        <ul className="error-list">
          {errors.slice(0, 8).map((f, i) => (
            <li key={i}>
              <button
                className="link"
                onClick={() => {
                  onClose()
                  editor.goToFinding(f)
                }}
              >
                {AREA_LABELS[f.area]}：{f.title}
              </button>
              {f.detail && <span className="detail">（{f.detail}）</span>}
            </li>
          ))}
          {errors.length > 8 && <li>ほか {errors.length - 8}件（セルフチェックを見てください）</li>}
        </ul>
        <div className="draft-box">
          <b>先生に途中経過を見せるとき</b>
          エラーが残っていても、どのページにも「下書き」の透かしが入った PDF を保存できます（提出には使えません）。
          <button className="primary pdf-draft" onClick={() => void build(true)}>
            {mode === 'share' ? '下書きの PDF を作る' : '下書きの PDF を保存する'}
          </button>
          <button className="pdf-fallback" aria-expanded={printOpen} onClick={() => setPrintOpen(!printOpen)}>
            うまくいかないとき：印刷の画面から保存
          </button>
          {printOpen && (
            <div className="pdf-print-box">
              <PrintSteps />
              <button className="pdf-print" onClick={() => print(true)}>
                印刷の画面を開く
              </button>
            </div>
          )}
        </div>
        <div className="row-buttons">
          <span className="spacer" />
          <button className="primary" onClick={onClose}>
            直しに戻る
          </button>
        </div>
      </Modal>
    )
  }

  // ---- 3つを確かめる ----
  return (
    <Modal key="start" title="提出用のPDFを書き出す" onClose={onClose}>
      <p className="lead">
        エラーはありません{warnings > 0 ? `（警告が${warnings}件あります。内容を確認してください）` : ''}。最後に、次のことを確認してください。
      </p>
      {editor.getSnapshot().report.abstract.started === false && (
        <p className="note">抄録はまだ書いていないため、このPDFには抄録のページは入りません（先生の許可が出たら、抄録のページの「先生の許可が出た」を押して書き始めます）。</p>
      )}
      <div className="checklist">
        {SELF_CHECKS.map((text, i) => (
          <label key={i}>
            <input type="checkbox" checked={checked[i]} onChange={(e) => setChecked(checked.map((c, j) => (j === i ? e.target.checked : c)))} />
            {text}
          </label>
        ))}
      </div>
      <FileBox fileName={fileName(false)} note={mode === 'share' ? 'できたら「保存する」を押し、「"ファイル"に保存」を選びます' : '「ダウンロード」のフォルダに保存します'} />
      {printOpen && (
        <div className="pdf-print-box">
          <PrintGuide fileName={fileName(false)} />
          <button className="pdf-print" disabled={!allChecked} onClick={() => print()}>
            印刷の画面を開く
          </button>
        </div>
      )}
      <div className="row-buttons">
        <button className="link pdf-fallback" aria-expanded={printOpen} onClick={() => setPrintOpen(!printOpen)}>
          うまくいかないとき：印刷の画面から保存
        </button>
        <span className="spacer" />
        <button onClick={onClose}>やめる</button>
        <button className="primary pdf-start" disabled={!allChecked} onClick={() => void build(false)}>
          {mode === 'share' ? 'PDF を作る' : 'PDF を保存する'}
        </button>
      </div>
    </Modal>
  )
}
