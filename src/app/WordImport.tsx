import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { findCourse, renderSubtitle, type YearConfig } from '../config'
import type { EditorSnapshot, ReportEditor } from '../editor/reportEditor'
import { deviceName } from '../drive/device'
import type { OutlineItem, WordImportResult } from '../import/types'
import { chapterLabel, subheadingLabel } from '../layout/bodyHtml'
import { Modal } from './dialogs'
import { Icon } from './icons'
import type { WordTodo } from './useWordTodo'

/**
 * 今年度だけ：Word のひな形（04_本文.docx・01_表紙.docx）で書き始めた分を、ツールに写す「Wordから読み込む」の画面（mockups/v24）。
 * ① 入り口の小さなリンク（右の欄・スマホのメニュー。はじめての案内の段は StartGuide）
 * ② ファイルを選ぶ窓と、写す前に中身を確かめる窓（案A：読み取った中身を一覧で見せる）
 * ③ 写したあとの「つぎにすること」（案B：右の欄・スマホのチェックの欄の上に、閉じるまで残す）
 * Word の読み取りそのものは import/wordImport.ts。読み込みは学生のブラウザの中だけで行う（どこにも送らない）
 */

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

/** Word の書類（書類に W） */
export function WordIcon() {
  return svg(
    <>
      <path d="M6 3.5h8l4 4v13H6zM14 3.5v4h4" />
      <path d="M8.6 11.2l1.3 5.6 1.6-4.2 1.6 4.2 1.3-5.6" />
    </>,
  )
}
const keepIcon = svg(<path d="M5 4.5h14v15H5zM9 4.5v5h6v-5M8.5 14h7M8.5 17h5" />)
const checkIcon = svg(<path d="M5 12.5l4.5 4.5L19 7.5" />)

/** ファイル名（BIZ UDPゴシックは小さい字で「_」が見えないことがあるため、英数字の書体で出す） */
const FileName = ({ name }: { name: string }) => <span className="fn">{name}</span>

/** 文の中のファイル名（例「本文に選んだ「01_表紙.docx」は…」の 01_表紙.docx）も、英数字の書体で出す */
function WithFileNames({ text }: { text: string }) {
  const parts = text.split(/([^\s「」『』（）()、。：:]+\.docx)/i)
  return <>{parts.map((part, i) => (i % 2 === 1 ? <FileName key={i} name={part} /> : part))}</>
}

// ---- ① 入り口：右の欄（スマホはメニュー）の小さなリンク ----

export function WordImportLink({ onClick }: { onClick: () => void }) {
  return (
    <button className="word-link" onClick={onClick}>
      <WordIcon />
      Word で書いた分を読み込む（今年度だけ）
    </button>
  )
}

// ---- ② ファイルを選ぶ・中身を確かめる ----

/**
 * Word を読み取る部品（import/wordImport.ts）。使うときに初めて読み込む（今年度だけの機能で、ふだんは使わないため、最初に開くときの読み込みを増やさない）。
 * 読み込めなければ（ツールを新しくした直後に、古いページのまま使っているなど）、学生に分かる言葉の例外にする
 */
async function loadWordReader(): Promise<typeof import('../import/wordImport')> {
  try {
    return await import('../import/wordImport')
  } catch {
    throw new ReaderLoadError()
  }
}

/** 読み取る部品を読み込めなかった（message は学生に分かる言葉） */
class ReaderLoadError extends Error {
  message = 'Word を読み取る部品を読み込めませんでした。インターネットにつながっているかを確かめ、ページを読み込み直してから、もう一度試してください。'
}

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/**
 * 選んだファイルが、名前から見て明らかに読めない形なら、その理由（学生に分かる言葉で）。そうでなければ null。
 * 名前に .docx がなくても読み取りに回す（クラウドから選ぶと、名前に拡張子が付かないことがある。中身は読み取る側が確かめる）
 */
function fileProblem(file: File): string | null {
  const name = file.name.toLowerCase()
  if (name.endsWith('.docx') || file.type === DOCX_TYPE) return null
  if (name.endsWith('.doc'))
    return '古い形（.doc）の Word は読めません。Word で開いて「名前を付けて保存」で「Word 文書（*.docx）」にしてから選んでください。'
  if (name.endsWith('.pages')) return 'Pages のファイルは読めません。Pages の「ファイル」→「書き出す」→「Word」で .docx にしてから選んでください。'
  if (/\.(pdf|jpe?g|png|heic|gif|odt|rtf|txt|xlsx?|pptx?)$/.test(name))
    return 'Word のファイル（.docx）ではないため読めません。04_本文.docx（表紙は 01_表紙.docx）を選んでください。'
  return null
}

/** 読み取れなかったときの知らせ。読み取る側が学生向けに書いた理由（WordImportError）は、そのまま出す */
function readErrorText(e: unknown): string {
  if (e instanceof ReaderLoadError || (e instanceof Error && e.name === 'WordImportError')) return e.message
  const detail = e instanceof Error ? e.message.trim() : ''
  return `読み取れませんでした。ファイルが壊れていないか、学科のひな形で書いた Word（.docx）のファイルかを確かめてください。${detail ? `（くわしく：${detail}）` : ''}`
}

/** OneDrive・Google ドライブ・iCloud Drive の中から選ぶときの説明（端末によって、ファイルを選ぶ画面が違う） */
function CloudHint() {
  const device = deviceName()
  if (/^(iPhone|iPad)/.test(device))
    return (
      <p>
        <b>OneDrive・Google ドライブ・iCloud Drive にあるとき</b>：「ファイルを選ぶ」で開く画面の下の「ブラウズ」から、その場所を選びます（OneDrive・Google ドライブは、アプリを入れていると出ます）。
      </p>
    )
  if (/^Android/.test(device))
    return (
      <p>
        <b>Google ドライブ・OneDrive にあるとき</b>：「ファイルを選ぶ」で開く画面の左上の「≡」（メニュー）から、Google ドライブや OneDrive を選びます（OneDrive は、アプリを入れていると出ます）。
      </p>
    )
  if (/^Mac/.test(device))
    return (
      <p>
        <b>OneDrive・Google ドライブ・iCloud Drive にあるとき</b>：「ファイルを選ぶ」で開く画面の左の欄から、その場所を選びます。ブラウザでしか開けない場所にあるときは、先にパソコンへダウンロードしてください。
      </p>
    )
  return (
    <p>
      <b>OneDrive・Google ドライブにあるとき</b>：「ファイルを選ぶ」で開く画面で、OneDrive などのフォルダを選びます。ブラウザでしか開けない場所にあるときは、先にパソコンへダウンロードしてください。
    </p>
  )
}

type Slot = 'body' | 'cover'

const SLOT_TEXT: Record<Slot, { title: string; tag: string; example: string; note?: string }> = {
  body: { title: '本文の Word', tag: '必ず', example: '04_本文.docx' },
  cover: { title: '表紙の Word', tag: '書いていれば', example: '01_表紙.docx', note: '（学籍番号・氏名・サブタイトルを写します）' },
}

/** ファイルを選ぶ1行（本文・表紙） */
function FileRow({ slot, file, error, disabled, onPick, onClear }: { slot: Slot; file?: File; error?: string; disabled: boolean; onPick: (file: File) => void; onClear: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const text = SLOT_TEXT[slot]
  return (
    <div className={`word-file${slot === 'body' ? ' req' : ''}${file ? ' picked' : ''}`}>
      <span className="ic">
        <WordIcon />
      </span>
      <div className="txt">
        <b>
          {text.title}
          <em className={slot === 'body' ? 'must' : ''}>{text.tag}</em>
        </b>
        {file ? (
          <small className="chosen">
            <i>{checkIcon}</i>選んだファイル：<FileName name={file.name} />
          </small>
        ) : (
          <small>
            例：<FileName name={text.example} />
            {text.note}
          </small>
        )}
        {error && (
          <small className="err" role="alert">
            <WithFileNames text={error} />
          </small>
        )}
      </div>
      <div className="acts">
        {/* キーボードでも選べるよう、ふつうのボタンからファイルを選ぶ画面を開く */}
        <button className={slot === 'body' && !file ? 'primary' : ''} disabled={disabled} onClick={() => input.current?.click()}>
          {file ? '選び直す' : 'ファイルを選ぶ'}
        </button>
        {slot === 'cover' && file && (
          <button className="link" disabled={disabled} onClick={onClear}>
            外す
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept={`.docx,${DOCX_TYPE}`}
        hidden
        aria-label={`${text.title}を選ぶ`}
        onChange={(e) => {
          const picked = e.target.files?.[0]
          // 選んだファイルを空に戻す（同じファイルを選び直せるように）
          e.target.value = ''
          if (picked) onPick(picked)
        }}
      />
    </div>
  )
}

interface DialogProps {
  config: YearConfig
  courseId: string
  /** 「読み込む」：控えを残して原稿に写す（終わったら呼んだ側が窓を閉じる。失敗したら投げる） */
  onImport: (result: WordImportResult) => Promise<void>
  onClose: () => void
}

/** 「Wordから読み込む」の窓。ファイルを選ぶ → 読み取る → 中身を確かめる → 読み込む */
export function WordImportDialog({ config, courseId, onImport, onClose }: DialogProps) {
  const [files, setFiles] = useState<Partial<Record<Slot, File>>>({})
  const [rowErrors, setRowErrors] = useState<Partial<Record<Slot, string>>>({})
  const [result, setResult] = useState<WordImportResult | null>(null)
  const [busy, setBusy] = useState<'reading' | 'importing' | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 読み取りの途中で「やめる」（Esc・×）を押したら、その読み取りの結果は使わない */
  const run = useRef(0)

  const pick = (slot: Slot, file: File) => {
    const problem = fileProblem(file)
    setRowErrors((r) => ({ ...r, [slot]: problem ?? undefined }))
    setError(null)
    if (!problem) setFiles((f) => ({ ...f, [slot]: file }))
  }

  const read = async () => {
    if (!files.body) return
    const id = ++run.current
    setBusy('reading')
    setError(null)
    try {
      const { readWordFiles } = await loadWordReader()
      const r = await readWordFiles({ body: files.body, cover: files.cover }, { config, courseId })
      if (id === run.current) setResult(r)
    } catch (e) {
      if (id === run.current) setError(readErrorText(e))
    } finally {
      if (id === run.current) setBusy(null)
    }
  }

  const close = () => {
    // 写している途中は閉じない（途中で閉じると、原稿が半分だけ写ったように見えるため）
    if (busy === 'importing') return
    run.current++
    onClose()
  }

  if (result) {
    return (
      <Modal key="confirm" title="Word の中身を確かめてください" className="word-modal" keepOpen={busy === 'importing'} onClose={close}>
        <WordConfirm
          config={config}
          courseId={courseId}
          files={files}
          result={result}
          busy={busy === 'importing'}
          error={error}
          onBack={() => {
            setResult(null)
            setError(null)
          }}
          onCancel={close}
          onImport={async () => {
            setBusy('importing')
            setError(null)
            try {
              await onImport(result)
            } catch (e) {
              // 原稿を入れ替える前に止まったので、原稿はそのまま。この端末の空き容量が足りないときなどに起きる
              setError(`読み込めませんでした（原稿はそのままです）。もう一度「読み込む」を押してください。直らないときは、この端末の空き容量を確かめてください。（くわしく：${e instanceof Error ? e.message : String(e)}）`)
              setBusy(null)
            }
          }}
        />
      </Modal>
    )
  }

  return (
    <Modal key="pick" title="Word から読み込む（今年度だけ）" className="word-mid" onClose={close}>
      <p className="lead">
        学科のひな形（Word）に書いた分を、このツールに写します。見出し・段落・図・表と、表紙の学籍番号・氏名・サブタイトルを写します（Word の文字の大きさや配置は写さず、ツールの決まった形で組み直します）。
      </p>
      <div className="word-files">
        {(['body', 'cover'] as const).map((slot) => (
          <FileRow
            key={slot}
            slot={slot}
            file={files[slot]}
            error={rowErrors[slot]}
            disabled={!!busy}
            onPick={(file) => pick(slot, file)}
            onClear={() => setFiles((f) => ({ ...f, [slot]: undefined }))}
          />
        ))}
      </div>
      <div className="word-hint">
        <CloudHint />
        <p>Google ドキュメントに変えたものではなく、Word（.docx）のファイルを選びます。ファイルは、この端末のブラウザの中だけで読み取ります（どこにも送りません）。</p>
      </div>
      {/* 読み取っている間と、読み取れなかったときの知らせ（読み上げにも伝わるよう、いつも置いておく枠の中に出す） */}
      <div className="word-status" role="status">
        {busy === 'reading' && <p className="busy">読み取っています…（写真が多いと、少し時間がかかります）</p>}
      </div>
      {error && (
        <p className="word-error" role="alert">
          <WithFileNames text={error} />
        </p>
      )}
      <div className="row-buttons">
        <span className="spacer" />
        <button onClick={close}>やめる</button>
        <button className="primary" disabled={!files.body || !!busy} onClick={() => void read()}>
          {busy === 'reading' ? '読み取っています…' : '中身を確かめる'}
        </button>
      </div>
    </Modal>
  )
}

/** 一覧の1行の、段落・図・表の数（例「段落 2・図1」） */
function countText(item: OutlineItem, untitled: Set<string>): string {
  const parts = [item.paragraphs > 0 ? `段落 ${item.paragraphs}` : '', ...item.figures.map((l) => (untitled.has(l) ? `${l}（タイトルなし）` : l)), ...item.tables]
  return parts.filter(Boolean).join('・')
}

/** 本文の組み立ての一覧（大見出し・小見出しと、それぞれの段落・図・表の数） */
function Outline({ outline, untitled }: { outline: OutlineItem[]; untitled: Set<string> }) {
  // 番号（Ⅰ．ⅰ．）は、ツールで組んだときと同じに振る（小見出しは章ごとに振り直す）
  const labels: string[] = []
  let chapter = -1
  let sub = -1
  for (const item of outline) {
    if (item.level === 1) {
      chapter += 1
      sub = -1
      labels.push(chapterLabel(chapter))
    } else {
      sub += 1
      labels.push(subheadingLabel(sub))
    }
  }
  return (
    <ol className="word-outline">
      {outline.map((item, i) => {
        const counts = countText(item, untitled)
        // Word で見出しの名前を書いていない（「Ⅰ．」だけ）ときは、名前がないことが分かるように出す
        const title = item.title.trim()
        return (
          <li key={i} className={`${item.level === 1 ? 'ch' : 'sh'}${item.fromTemplate ? ' tpl' : ''}${item.problem ? ' problem' : ''}`}>
            <span className="ttl">
              {labels[i]}
              {title || <span className="noname">{item.level === 1 ? '（名前のない大見出し）' : '（名前のない小見出し）'}</span>}
            </span>
            {item.fromTemplate ? (
              <span className="cnt">ツールのひな形で続ける</span>
            ) : (
              (counts || item.problem) && (
                <span className="cnt">
                  {item.problem && <i className="word-dia" role="img" aria-label="読み取れなかった所があります" />}
                  {counts}
                </span>
              )
            )}
          </li>
        )
      })}
    </ol>
  )
}

/** 写す前の確認（案A：読み取った中身を一覧で見せる） */
function WordConfirm({
  config,
  courseId,
  files,
  result,
  busy,
  error,
  onBack,
  onCancel,
  onImport,
}: {
  config: YearConfig
  courseId: string
  files: Partial<Record<Slot, File>>
  result: WordImportResult
  busy: boolean
  error: string | null
  onBack: () => void
  onCancel: () => void
  onImport: () => void
}) {
  // 図の小さな画像（窓を閉じたら捨てる）
  const urls = useMemo(() => new Map(result.images.map((img) => [img.id, URL.createObjectURL(img.blob)])), [result])
  useEffect(() => () => urls.forEach((url) => URL.revokeObjectURL(url)), [urls])

  const { counts, cover, problems } = result
  const untitled = new Set(result.figures.filter((f) => !f.caption.trim()).map((f) => f.label))
  const fromTemplate = result.outline.some((o) => o.fromTemplate)
  // 本文から写せるものが何もない（表紙の Word を本文に選んだなど）：写すと本文がひな形だけになるので、読み込ませない
  const nothing = !result.outline.some((o) => !o.fromTemplate) && counts.paragraphs === 0 && counts.figures === 0 && counts.tables === 0
  const course = findCourse(config, courseId)
  const coverRows: [string, string | undefined][] = [
    ['学籍番号', cover.studentId],
    ['氏名', cover.name],
    ['サブタイトル', cover.subtitleInput === undefined ? undefined : course ? renderSubtitle(course, cover.subtitleInput) : cover.subtitleInput],
  ]
  return (
    <>
      {/* 開いたときは、ここから読み上げる（「読み込む」に移すと、中身を聞かずに押してしまうため） */}
      <div className="word-picked" tabIndex={-1} data-autofocus>
        <span>
          <WordIcon />
          本文：<b><FileName name={files.body?.name ?? ''} /></b>
        </span>
        {files.cover && (
          <span>
            <WordIcon />
            表紙：<b><FileName name={files.cover.name} /></b>
          </span>
        )}
        <button className="link" disabled={busy} onClick={onBack}>
          選び直す
        </button>
      </div>
      {nothing ? (
        <div className="word-warn">
          <b>本文の Word から、写せるものが見つかりませんでした</b>
          見出し（「Ⅰ．」「ⅰ．」）や段落が読み取れませんでした。本文の Word（例：<FileName name="04_本文.docx" />）を選んでいるかを確かめて、「選び直す」から選び直してください。
        </div>
      ) : (
        problems.length > 0 && (
          <div className="word-warn">
            <b>うまく読み取れなかったところが {problems.length}つあります</b>
            このまま読み込めます。読み込んだあと、ツールで直してください。
            <ul>
              {problems.map((p, i) => (
                <li key={i}>
                  <i className="word-dia" aria-hidden="true" />
                  <div>
                    <b><WithFileNames text={p.message} /></b>
                    {p.detail && <span><WithFileNames text={p.detail} /></span>}
                    {p.where && <span className="where">場所：{p.where}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      )}
      <div className="word-count" role="group" aria-label="読み取った数">
        <span>
          大見出し<b>{counts.chapters}</b>
        </span>
        <span>
          小見出し<b>{counts.subheadings}</b>
        </span>
        <span>
          段落<b>{counts.paragraphs}</b>
        </span>
        <span>
          図<b>{counts.figures}</b>
        </span>
        <span>
          表<b>{counts.tables}</b>
        </span>
      </div>
      <div className="word-cols">
        <section>
          <h3>本文の組み立て</h3>
          <Outline outline={result.outline} untitled={untitled} />
          {fromTemplate && <p className="word-skip">「ツールのひな形で続ける」の章は、Word でまだ書いていない章です。ツールのひな形（書くことの説明）が入るので、続きはツールで書きます。</p>}
          {result.skippedPlaceholders > 0 && <p className="word-skip">ひな形のままの行（「〇〇〇〇」「～～～～」だけの行）{result.skippedPlaceholders}行は写しません。</p>}
        </section>
        <section>
          <h3>表紙</h3>
          {files.cover ? (
            <dl className="word-cover">
              {coverRows.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  {value?.trim() ? <dd>{value}</dd> : <dd className="miss">（読み取れませんでした）</dd>}
                </div>
              ))}
            </dl>
          ) : (
            <p className="word-none">表紙の Word は選んでいません。表紙は、今のツールの表紙のままです。</p>
          )}
          <h3>図・表</h3>
          {result.figures.length === 0 && result.tables.length === 0 && <p className="word-none">図・表はありません。</p>}
          {result.figures.length > 0 && (
            <div className="word-figs">
              {result.figures.map((f) => {
                const url = f.imageId ? urls.get(f.imageId) : undefined
                const noTitle = !f.caption.trim()
                return (
                  <figure key={f.label} className={noTitle || !f.imageId ? 'problem' : ''}>
                    {url ? <img src={url} alt="" /> : <span className="noimg">{f.imageId ? '' : '画像なし'}</span>}
                    <figcaption>
                      {f.label}　{noTitle ? '（タイトルなし）' : f.caption}
                    </figcaption>
                  </figure>
                )
              })}
            </div>
          )}
          {result.tables.map((t) => (
            <div key={t.label} className="word-tbl">
              {Icon.table}
              {t.label}　{t.caption.trim() || '（タイトルなし）'}
              <small>{t.rows}行</small>
            </div>
          ))}
        </section>
      </div>
      <div className="word-keep">
        {keepIcon}
        <div>
          <b>いまのツールの原稿は「自動の控え」に残します</b>
          {files.cover
            ? '本文は Word の中身に入れ替わり、表紙の学籍番号・氏名・サブタイトルも Word のものになります（抄録・作品写真・引用・参考文献はそのまま）。'
            : '本文は Word の中身に入れ替わります（表紙・抄録・作品写真・引用・参考文献はそのまま）。'}
          元に戻したいときは「読み込む前の原稿に戻す」か「バックアップ」から戻せます。
        </div>
      </div>
      {error && (
        <p className="word-error" role="alert">
          <WithFileNames text={error} />
        </p>
      )}
      <div className="row-buttons">
        <span className="spacer" />
        <button disabled={busy} onClick={onCancel}>
          やめる
        </button>
        <button className="primary" disabled={busy || nothing} onClick={onImport}>
          {busy ? '読み込んでいます…' : '読み込む'}
        </button>
      </div>
    </>
  )
}

// ---- ③ 写したあと：「つぎにすること」 ----

interface TodoProps {
  editor: ReportEditor
  snap: EditorSnapshot
  todo: WordTodo
  onUpdate: (todo: WordTodo) => void
  onClose: () => void
  /** 「読み込む前の原稿に戻す」 */
  onRestore: () => void
  /** 紙面へ移る前に呼ぶ（スマホ：チェックの欄を閉じる） */
  onPick?: () => void
}

/**
 * 写したあとの「つぎにすること」（案B）。右の欄（スマホはチェックの欄）の上に、閉じる（×）まで残す。
 * 済んだものに ✓：エラーが0になった・「図1へ」から図を順に見た・表紙のページを開いた
 */
export function WordTodoCard({ editor, snap, todo, onUpdate, onClose, onRestore, onPick }: TodoProps) {
  const errors = snap.findings.filter((f) => f.severity === 'error').length
  const figures = snap.report.body.flatMap((c) => c.blocks).flatMap((b) => (b.type === 'figureRow' ? b.figures : []))
  const seen = Math.min(todo.figuresSeen, figures.length)
  const figuresDone = seen >= figures.length
  const steps = [errors === 0, ...(figures.length > 0 ? [figuresDone] : []), todo.coverChecked]
  const allDone = steps.every(Boolean)
  const when = new Date(todo.at).toLocaleString('ja-JP', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  const goFigure = async () => {
    const figure = figures[seen]
    if (!figure) return
    onPick?.()
    onUpdate({ ...todo, figuresSeen: seen + 1 })
    const page = editor.pageOfBlock(figure.id)
    if (page < 0) return
    await editor.goToPage(page, 'fade')
    editor.select({ kind: 'figure', id: figure.id })
  }
  const goCover = () => {
    onPick?.()
    onUpdate({ ...todo, coverChecked: true })
    void editor.goToPage(0, 'fade')
  }
  const box = (done: boolean) => (
    <i className="box" role="img" aria-label={done ? '済み' : 'まだ'}>
      {done && checkIcon}
    </i>
  )

  return (
    <section className="word-todo" aria-label="Word から写したあとに、つぎにすること">
      <div className="hd">
        <b>
          <WordIcon />
          Word から写しました
        </b>
        {/* close：スマホのチェックの欄を開いたとき、ここに移らないように（useDialogFocus） */}
        <button className="x close" aria-label="「つぎにすること」を閉じる" title="閉じる（もう出しません）" onClick={onClose}>
          ×
        </button>
      </div>
      <p>
        {when} に写しました。{allDone ? 'すべて済みました。× で閉じてください。' : `次の${steps.length}つを確かめたら、移しかえは終わりです。`}
      </p>
      <ul>
        <li className={errors === 0 ? 'done' : ''}>
          {box(errors === 0)}
          <div>
            <b>セルフチェックのエラーを直す</b>
            <small>
              {errors > 0 ? (
                <>
                  あと <em>{errors}件</em>（下の一覧）
                </>
              ) : (
                'エラーはありません'
              )}
            </small>
          </div>
          <span />
        </li>
        {figures.length > 0 && (
          <li className={figuresDone ? 'done' : ''}>
            {box(figuresDone)}
            <div>
              <b>図の位置を確かめる</b>
              <small>
                {figures.length === 1 ? '図1（1枚）' : `図1〜図${figures.length}（${figures.length}枚）`}
                {figuresDone ? 'を見ました' : seen > 0 ? `。図${seen}まで見ました` : ''}
              </small>
            </div>
            {figuresDone ? (
              <span />
            ) : (
              <button className="go" onClick={() => void goFigure()}>
                図{seen + 1}へ
              </button>
            )}
          </li>
        )}
        <li className={todo.coverChecked ? 'done' : ''}>
          {box(todo.coverChecked)}
          <div>
            <b>表紙を確かめる</b>
            <small>{todo.coverChecked ? '表紙のページを開いたので、済みにしました' : 'コース・学籍番号・氏名・サブタイトルが合っているか'}</small>
          </div>
          {todo.coverChecked ? (
            <span />
          ) : (
            <button className="go" onClick={goCover}>
              表紙へ
            </button>
          )}
        </li>
      </ul>
      <button className="undo" onClick={onRestore}>
        {Icon.undo}読み込む前の原稿に戻す
      </button>
    </section>
  )
}
