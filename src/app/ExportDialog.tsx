import { useEffect, useRef, useState } from 'react'
import type { YearConfig } from '../config'
import { exportNote, type ProgressRow } from '../checker/progress'
import type { ReportFinding } from '../checker/reportChecks'
import { deviceName } from '../drive/device'
import type { EditorSnapshot, ReportEditor } from '../editor/reportEditor'
import { buildPdf, downloadPdf, saveMode, sharePdf, sizeText, thumbnail, type BuiltPdf } from '../pdf/exportPdf'
import { skippedPages } from '../pdf/exportPages'
import { Spinner } from './Busy'
import { checkSummary, goToTarget } from './checkSummary'
import { Modal } from './dialogs'
import { Icon } from './icons'
import { AREA_LABELS } from './labels'
import type { DrivePdfState } from './useDrivePdf'

/** 保存の画面が開くのを待つ長さ（これを過ぎたら「保存しました」にする。保存の画面を出さずに「ダウンロード」へ保存するブラウザのため） */
const SAVE_WAIT_MS = 4000

/**
 * 「PDFを書き出す」の窓（mockups/v28 案C「窓の中で、できたページを見せる」）。
 * PDF をツールの中で作る（進み具合と、できたページの小さな絵が1枚ずつ並ぶ）→ できた。
 * パソコン・Android は、できたらそのまま「ダウンロード」に保存する。iPhone・iPad は「保存する」を押して、共有の画面から保存する。
 * パソコン・Android は、ブラウザが保存の画面を開くまで数秒かかることがあるので、その間は「保存の画面を開いています…」と出し、
 * 保存の画面が開いたら（窓のフォーカスが外れたら）か、約4秒で「保存しました」にする（依頼者の判断 2026-10-19 案A）。
 * ドライブにログインして使っているときは、同じ PDF を自分のドライブの「卒業制作報告書」フォルダにも置き、できた窓に1行で知らせる（app/useDrivePdf.ts）。
 * PDF は1つだけ（依頼者の判断 2026-10-19）：前の「下書きの PDF」（透かし入り）と、提出用の PDF の前の3つの確かめ（チェック欄）はなくした。
 * 直すところ・まだのところが残っているときは、右の欄と同じ言葉で一覧にし（押すと、その場所へ）、提出の前に直すよう伝える。そのまま書き出すこともできる。
 * 作れなかったとき・うまくいかないときのために、今までの印刷の画面から保存する道も残す（窓の左下）
 */

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
function FileBox({ fileName, note }: { fileName: string; note: string }) {
  return (
    <div className="pdf-file">
      {Icon.pdf}
      <div>
        <b className="fn">{fileName}</b>
        <small>{note}</small>
      </div>
    </div>
  )
}

/**
 * 自分のドライブにも置いたこと（置いている途中・置いた）の1行。置かない・置けなかったときは出さない。
 * 狭い画面では言葉の切れ目で折り返す（1字だけ次の行に残らないように）
 */
function DriveLine({ state }: { state: DrivePdfState }) {
  if (!state) return null
  return (
    <p className={`pdf-drive ${state}`} role="status">
      <i aria-hidden="true">{state === 'done' && Icon.check}</i>
      <span>
        <span>ドライブの「卒業制作報告書」</span>
        <span>フォルダにも</span>
        <span>{state === 'done' ? '置きました' : '置いています…'}</span>
      </span>
    </p>
  )
}

/** できたページの小さな絵（できていないページは空の枠、いま作っているページは枠を光らせる） */
function Thumbs({ urls, total }: { urls: string[]; total: number }) {
  return (
    <div className="pdf-thumbs" aria-hidden="true">
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
  | { kind: 'build'; total: number }
  | { kind: 'done'; pdf: BuiltPdf; saved: '' | 'shared' | 'fallback' }
  | { kind: 'error'; message: string }

interface Props {
  editor: ReportEditor
  snap: EditorSnapshot
  config: YearConfig
  onClose: () => void
  /** 「PDF を保存する（作る）」を押したとき（押した処理の中で呼ぶ。ドライブの許可が切れそうなら延ばしておく。app/usePdfCopy.ts） */
  onStart?: () => void
  /** PDF ができたとき（作り直さずに、同じ PDF の控えを先生のドライブのフォルダに送る。app/usePdfCopy.ts。自分のドライブにも置く。app/useDrivePdf.ts） */
  onBuilt?: (pdf: BuiltPdf) => void
  /** 自分のドライブの「卒業制作報告書」フォルダにも置いている途中・置いた（できた窓に1行で出す。置かないときは null） */
  drivePdf?: DrivePdfState
}

/** 直すところの一覧で、はじめに見せる数（多いときは「ほか◯件」で開く） */
const FIXES_SHOWN = 5

/**
 * 残っている直すところの一覧（右の欄の「直すところ」と同じ指摘。エラーを先に、要確認はその後に「（要確認）」を付けて）。
 * 押すと、その場所へ移る。前は、要確認が「警告が10件あります」とだけ出て、何の指摘かが分からなかった（多いときは5件と「ほか◯件」）
 */
function FixList({ fixes, editor, onClose }: { fixes: ReportFinding[]; editor: ReportEditor; onClose: () => void }) {
  const [all, setAll] = useState(false)
  const sorted = [...fixes.filter((f) => f.severity === 'error'), ...fixes.filter((f) => f.severity !== 'error')]
  const shown = all ? sorted : sorted.slice(0, FIXES_SHOWN)
  return (
    <ul className="error-list fix-list">
      {shown.map((f, i) => {
        const warning = f.severity !== 'error'
        const detail = warning ? (f.detail ? `要確認。${f.detail}` : '要確認') : f.detail
        return (
          <li key={i} className={warning ? 'warning' : undefined}>
            <button
              className="link"
              onClick={() => {
                onClose()
                void editor.goToFinding(f)
              }}
            >
              {AREA_LABELS[f.area]}：{f.title}
            </button>
            {detail && <span className="detail">（{detail}）</span>}
          </li>
        )
      })}
      {!all && sorted.length > FIXES_SHOWN && (
        <li className="more">
          <button className="link" onClick={() => setAll(true)}>
            ほか{sorted.length - FIXES_SHOWN}件
          </button>
        </li>
      )}
    </ul>
  )
}

/** まだのところの一覧（右の欄の「まだのところ」の、まだの行。例：「本文のページ：3 / 4ページ あと1」）。押すと、その場所へ移る */
function NotYetList({ rows, editor, onClose }: { rows: ProgressRow[]; editor: ReportEditor; onClose: () => void }) {
  return (
    <ul className="error-list notyet-list">
      {rows.map((row) => {
        const text = `${row.label}：${row.value}${row.strong ?? ''}`
        const target = row.target
        return (
          <li key={row.id}>
            {target ? (
              <button
                className="link"
                onClick={() => {
                  onClose()
                  goToTarget(editor, target)
                }}
              >
                {text}
              </button>
            ) : (
              text
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function ExportDialog({ editor, snap, config, onClose, onStart, onBuilt, drivePdf = null }: Props) {
  // 残っている直すところ（書いた文の間違い。要確認も含む）と、まだのところ（まだの行。抄録の「先生の許可のあと」は数えない）。右の欄と同じ分け方
  const { rows, fixes } = checkSummary(snap, config)
  const notYet = rows.filter((r) => r.state === 'todo')
  const left = fixes.length > 0 || notYet.length > 0
  const abstractWaiting = snap.report.abstract.started === false
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
  /** 保存の画面が開くのを待っている（パソコン・Android。「保存の画面を開いています…」） */
  const [waiting, setWaiting] = useState(false)
  /** 待つのをやめる（時計と、フォーカス・画面の切り替えの見張りを外す） */
  const stopWatch = useRef<(() => void) | null>(null)
  const fileName = `${editor.pdfTitle}.pdf`

  /** PDF に入れるページ（写真のない作品写真のページは入れない。pdf/exportPages.ts） */
  const pagesToExport = () => {
    const pages = editor.pageElements()
    const { report, layout } = editor.getSnapshot()
    const skipped = new Set(skippedPages(pages, report, layout))
    return pages.filter((p) => !skipped.has(p))
  }

  const releaseUrls = () => {
    for (const url of urls.current) URL.revokeObjectURL(url)
    urls.current = []
    // PDF は、保存や開くのが終わるまで少し待ってから解放する（すぐ解放すると、保存が途中で止まることがある）
    const done = pdfUrls.current
    pdfUrls.current = []
    if (done.length) window.setTimeout(() => done.forEach((url) => URL.revokeObjectURL(url)), 60_000)
  }
  /** 保存の画面を待つのをやめる */
  const endWatch = () => {
    stopWatch.current?.()
    stopWatch.current = null
  }
  // 窓を閉じたら、作っている途中なら止め、保存の画面を待つのもやめ、絵と PDF の URL を解放する
  useEffect(
    () => () => {
      abort.current?.abort()
      endWatch()
      releaseUrls()
    },
    [],
  )

  /**
   * パソコン・Android：「ダウンロード」に保存する。ブラウザが保存の画面を開くまで（数秒かかることがある）「保存の画面を開いています…」と出し、
   * 保存の画面が開いたら（窓のフォーカスが外れた・画面が隠れた）か、SAVE_WAIT_MS たったら「保存しました」にする。
   * 「保存されていないときは、もう一度保存」で保存し直したときも、同じように待つ
   */
  const save = (pdf: BuiltPdf) => {
    endWatch()
    downloadPdf(pdf)
    setWaiting(true)
    const opened = () => {
      endWatch()
      setWaiting(false)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') opened()
    }
    const timer = window.setTimeout(opened, SAVE_WAIT_MS)
    window.addEventListener('blur', opened)
    document.addEventListener('visibilitychange', onVisibility)
    stopWatch.current = () => {
      window.clearTimeout(timer)
      window.removeEventListener('blur', opened)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }

  /** 印刷の画面から保存する（作れなかったとき・うまくいかないとき） */
  const print = () => {
    const title = document.title
    document.title = editor.pdfTitle
    // 写真のない作品写真のページは印刷しない（印刷が終わったら戻す）
    const kept = new Set(pagesToExport())
    const skipped = editor.pageElements().filter((p) => !kept.has(p) && !p.classList.contains('print-skip'))
    for (const p of skipped) p.classList.add('print-skip')
    window.addEventListener(
      'afterprint',
      () => {
        document.title = title
        for (const p of skipped) p.classList.remove('print-skip')
      },
      { once: true },
    )
    onClose()
    // ダイアログが閉じてから印刷画面を開く
    setTimeout(() => window.print(), 50)
  }

  /** PDF を作る。できたら、パソコン・Android はそのまま保存する */
  const build = async () => {
    abort.current?.abort()
    const controller = new AbortController()
    abort.current = controller
    endWatch()
    setWaiting(false)
    releaseUrls()
    setThumbs([])
    const pages = pagesToExport()
    setPhase({ kind: 'build', total: pages.filter((p) => !p.classList.contains('print-skip')).length })
    try {
      const pdf = await buildPdf(pages, {
        title: editor.pdfTitle,
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
      if (mode === 'download') save(pdf)
      // 保存を始めてから、先生のフォルダへの控えを送り、自分のドライブにも置く（後ろで。保存・共有を待たせない）
      onBuilt?.(pdf)
    } catch (e) {
      // 「やめる」で止めたときは、最初の画面に戻っている
      if (controller.signal.aborted) return
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  /** 「PDF を保存する（作る）」・「もう一度作る」を押したとき */
  const start = () => {
    onStart?.()
    void build()
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
    return (
      <Modal key="build" title="PDF を作っています" onClose={onClose} className="pdf-modal">
        <p className="lead">この画面のまま、お待ちください。</p>
        <div className="pdf-progress" role="progressbar" aria-valuemin={0} aria-valuemax={phase.total} aria-valuenow={thumbs.length} aria-label="できたページの数">
          <div className="bar">
            <i style={{ width: `${(thumbs.length / Math.max(1, phase.total)) * 100}%` }} />
          </div>
          <span>
            <b>{thumbs.length}</b> / {phase.total}ページ
          </span>
        </div>
        <Thumbs urls={thumbs} total={phase.total} />
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
        <Modal key="done" title="PDF ができました" onClose={onClose} className="pdf-modal">
          <FileBox fileName={pdf.fileName} note={size} />
          <Thumbs urls={thumbs} total={pdf.pageCount} />
          <p className="lead">
            {saved === 'shared'
              ? '保存しました。ほかの場所にも保存するときは、もう一度「保存する」を押します。'
              : saved === 'fallback'
                ? '保存の画面を開けなかったため、ダウンロードしました。「PDF を開く」からも保存できます。'
                : '「保存する」を押して、「"ファイル"に保存」を選んでください。'}
          </p>
          <DriveLine state={drivePdf} />
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
    // 保存の画面を待っている間も、同じ窓のまま（ボタンは押せる。「保存しました」に変わっても、いま選んでいるボタンから動かない）
    const title = waiting ? '保存の画面を開いています…' : '保存しました'
    return (
      <Modal
        key="done"
        title={title}
        heading={
          <>
            {waiting ? <Spinner className="pdf-wait" /> : <span className="pdf-ok">{Icon.check}</span>}
            {title}
          </>
        }
        onClose={onClose}
        className="pdf-modal"
      >
        <FileBox fileName={pdf.fileName} note={`${size}　「ダウンロード」のフォルダ`} />
        <Thumbs urls={thumbs} total={pdf.pageCount} />
        <p className="lead">{waiting ? '数秒かかることがあります' : '開いて、ページの数と写真を確かめてください。'}</p>
        {!waiting && <DriveLine state={drivePdf} />}
        <div className="row-buttons">
          <button className="link pdf-fallback" onClick={() => save(pdf)}>
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
        <PrintGuide fileName={fileName} />
        <p className="pdf-small">くわしいこと：{phase.message}</p>
        <div className="row-buttons">
          <span className="spacer" />
          <button onClick={start}>もう一度作る</button>
          <button className="primary pdf-print" onClick={print}>
            印刷の画面を開く
          </button>
        </div>
      </Modal>
    )
  }

  // ---- 書き出す前（直すところ・まだのところが残っていれば、その一覧も） ----
  return (
    <Modal key="start" title="PDFを書き出す" onClose={onClose}>
      {left ? (
        <>
          <p className="lead">{exportNote({ fix: fixes.length, notYet: notYet.length, pending: false, abstractWaiting: false })}。</p>
          <div className="pdf-left">
            {fixes.length > 0 && (
              <>
                <b className="pdf-left-h">直すところ</b>
                <FixList fixes={fixes} editor={editor} onClose={onClose} />
              </>
            )}
            {notYet.length > 0 && (
              <>
                <b className="pdf-left-h">まだのところ</b>
                <NotYetList rows={notYet} editor={editor} onClose={onClose} />
              </>
            )}
          </div>
          <p className="lead pdf-anyway">提出の前に直しましょう。このまま書き出すこともできます（途中で先生に見せるときなど）。</p>
        </>
      ) : (
        <p className="lead">直すところ・まだのところはありません。</p>
      )}
      {abstractWaiting && (
        <p className="note">抄録はまだ書いていないため、このPDFには抄録のページは入りません（先生の許可が出たら、抄録のページの「先生の許可が出た」を押して書き始めます）。</p>
      )}
      <FileBox fileName={fileName} note={mode === 'share' ? 'できたら「保存する」を押し、「"ファイル"に保存」を選びます' : '「ダウンロード」のフォルダに保存します'} />
      {printOpen && (
        <div className="pdf-print-box">
          <PrintGuide fileName={fileName} />
          <button className="pdf-print" onClick={print}>
            印刷の画面を開く
          </button>
        </div>
      )}
      <div className="row-buttons">
        <button className="link pdf-fallback" aria-expanded={printOpen} onClick={() => setPrintOpen(!printOpen)}>
          うまくいかないとき：印刷の画面から保存
        </button>
        <span className="spacer" />
        <button onClick={onClose}>{left ? '直しに戻る' : 'やめる'}</button>
        <button className="primary pdf-start" onClick={start}>
          {mode === 'share' ? 'PDF を作る' : 'PDF を保存する'}
        </button>
      </div>
    </Modal>
  )
}
