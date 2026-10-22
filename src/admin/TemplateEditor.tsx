import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../app/icons'
import { useDialogFocus } from '../app/useDialogFocus'
import type { Course, TemplateBlock, YearConfig } from '../config'
import { LIMITS, templateRowName, tooLong } from '../config/validate'
import { bodyContentHtml } from '../layout/bodyHtml'
import { reportCss } from '../layout/reportCss'
import { bodyFromTemplate, DEFAULT_TEMPLATE } from '../model/template'
import { useConfirm } from './confirm'
import { TEMPLATE_CONTENT_CSS } from './Preview'
import { useLeaveGuard } from './useLeaveGuard'
import { useReorder } from './useReorder'

/**
 * コースの「下書きのひな形」を編集する画面（mockups/v8 案1：コースのカードから開く）。
 * 左で本文の組み立て（大見出し・小見出し・書くことの説明・図の枠・素材表）を並べ、右で学生が最初に見る本文を確かめる。
 * mockups/v44 からは、学生と同じ紙面で作る画面（TemplateOverlay.tsx）がふつうの作り方で、この窓は「前の作り方で直す」から開く予備。
 * 改ページ・ふつうの表（新しい画面で作ったもの）も消さずに残し、並べ替え・削除・表のタイトルの直しはできる（表の見出しの行は新しい画面で直す）
 */

const KIND_LABELS: Record<TemplateBlock['type'], string> = { chapter: '大見出し', subheading: '小見出し', paragraph: '説明', figure: '図の枠', materialTable: '素材表', pageBreak: '改ページ', table: '表' }
const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ']
const SMALL = ['ⅰ', 'ⅱ', 'ⅲ', 'ⅳ', 'ⅴ', 'ⅵ', 'ⅶ', 'ⅷ', 'ⅸ', 'ⅹ']

/** 行ごとの番号（Ⅰ．ⅰ．図1 など） */
function numbers(blocks: TemplateBlock[]): string[] {
  let ch = -1
  let sub = 0
  let fig = 0
  let tab = 0
  return blocks.map((b) => {
    if (b.type === 'chapter') {
      ch += 1
      sub = 0
      return `${ROMAN[ch] ?? ch + 1}．`
    }
    if (b.type === 'subheading') return `${SMALL[sub++] ?? sub}．`
    if (b.type === 'figure') return `図${++fig}`
    if (b.type === 'materialTable' || b.type === 'table') return `表${++tab}`
    return ''
  })
}

/**
 * 直してもらうことの1つ。text：左の欄のいちばん下の一覧に出す文（長すぎる行は、行の書き出しも示す）。
 * short：「反映する」のとなりに出す短い文（行の書き出しを外したもの）
 */
interface Problem {
  text: string
  short: string
}

/**
 * 「反映する」の前に直してもらうこと（空の名前・長すぎる文字など）。保存のときにサーバーで断られる前に、窓の中で知らせる
 * （上限は src/config/validate.ts の LIMITS。サーバーの gas/admin-project/Code.js と同じ値）
 */
function problemsOf(blocks: TemplateBlock[], abstractExample: string): Problem[] {
  const problems: Problem[] = []
  const push = (text: string, short = text) => problems.push({ text, short })
  if (abstractExample.trim().length > LIMITS.abstractExample) push(`抄録の書き出し例${tooLong(LIMITS.abstractExample, abstractExample.trim().length)}`)
  if (blocks.length === 0) push('大見出しを1つ以上入れてください')
  else if (blocks[0].type !== 'chapter') push('いちばん上は大見出しにしてください')
  if (blocks.length > LIMITS.blocks) push(`行が多すぎます（${LIMITS.blocks}行まで。今は${blocks.length}行）`)
  blocks.forEach((b, i) => {
    const empty = b.type === 'chapter' || b.type === 'subheading' ? !b.title.trim() : b.type === 'figure' || b.type === 'materialTable' || b.type === 'table' ? !b.caption.trim() : false
    if (empty) push(`${i + 1}行目の${KIND_LABELS[b.type]}の名前が空です`)
    const max = b.type === 'paragraph' ? LIMITS.hint : LIMITS.name
    // 短い文は「3行目の説明が長すぎます（…）」（行の書き出し「…」を外す）
    if (textOf(b).length > max) push(`${templateRowName(i, b.type, textOf(b))}${tooLong(max, textOf(b).length)}`, `${templateRowName(i, b.type, '')}${tooLong(max, textOf(b).length)}`)
  })
  return problems
}

const textOf = (b: TemplateBlock) => (b.type === 'chapter' || b.type === 'subheading' ? b.title : b.type === 'paragraph' ? b.hint : b.type === 'pageBreak' ? '' : b.caption)
const withText = (b: TemplateBlock, text: string): TemplateBlock =>
  b.type === 'chapter' || b.type === 'subheading' ? { ...b, title: text } : b.type === 'paragraph' ? { ...b, hint: text } : b.type === 'pageBreak' ? b : { ...b, caption: text }
const PLACEHOLDERS: Record<TemplateBlock['type'], string> = {
  chapter: '大見出しの名前（例：企画・立案）',
  subheading: '小見出しの名前（例：デザイン説明）',
  paragraph: '学生に薄い字で見せる「ここに何を書くか」（例：デザインの意図を書く）',
  figure: '図のタイトル（例：デザイン画）',
  materialTable: '表のタイトル（例：使用素材表）',
  pageBreak: '',
  table: '表のタイトル（例：寸法表）',
}
const NEW_BLOCKS: Record<TemplateBlock['type'], TemplateBlock> = {
  chapter: { type: 'chapter', title: '' },
  subheading: { type: 'subheading', title: '' },
  paragraph: { type: 'paragraph', hint: '' },
  figure: { type: 'figure', caption: '' },
  materialTable: { type: 'materialTable', caption: '使用素材表' },
  pageBreak: { type: 'pageBreak' },
  table: { type: 'table', caption: '', header: ['', ''] },
}

const PREVIEW_CSS = `
body { margin: 0; padding: 14px; background: #eef0f3; }
.page { width: 210mm; min-height: 297mm; box-sizing: border-box; margin: 0 auto; padding: 25mm 25mm 25mm 35mm; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.15); }
${TEMPLATE_CONTENT_CSS}
h1.chapter:not(:first-child) { margin-top: 2em; }
.page-break { position: relative; height: 9mm; }
.page-break::after { content: '改ページ'; position: absolute; left: 0; right: 0; top: 3mm; padding-top: 1mm; border-top: 1px dashed #9aa3c4; color: #7f88ab; font-family: 'BIZ UDPGothic', sans-serif; font-size: 8pt; letter-spacing: 0.2em; text-align: center; }
`

export function TemplatePreview({ blocks }: { blocks: TemplateBlock[] }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(0.6)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const observer = new ResizeObserver(() => setZoom(Math.min(0.9, Math.max(0.3, (el.clientWidth - 30) / 794))))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const srcDoc = useMemo(() => {
    const chapters = bodyFromTemplate(blocks.some((b) => b.type === 'chapter') ? blocks : [])
    const body = bodyContentHtml(chapters, { imageSrc: () => '', figureSize: () => ({ widthMm: 60, heightMm: 45 }) })
    return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=BIZ+UDMincho&family=BIZ+UDPGothic&display=swap">
<style>${reportCss}${PREVIEW_CSS} body { zoom: ${zoom}; }</style></head>
<body><div class="page"><section class="body">${body}</section></div></body></html>`
  }, [blocks, zoom])
  return (
    <div className="tpl-preview" ref={wrap}>
      <iframe title="学生が最初に見る本文の見本" srcDoc={srcDoc} />
    </div>
  )
}

interface Props {
  course: Course
  config: YearConfig
  /** いちばん下の案内（「反映する」の後、どうすれば学生に届くか。年度の状態で変わる。yearText.ts の templateFootNote） */
  footNote: string
  onApply: (template: TemplateBlock[], abstractExample: string) => void
  onClose: () => void
}

// 行を入れ替えても入力欄が混ざらないよう、行ごとに目印（key）を付けて持つ
let keyCounter = 0
const withKeys = (list: TemplateBlock[]) => list.map((block) => ({ key: ++keyCounter, block }))

/**
 * 編集を始めるひな形（ないときは標準のひな形）。崩れたひな形でも画面が止まらないよう、知らない種類の部品は外し、名前や説明は文字にそろえる。
 * ふつうの表は、見出しの行などの項目もそのまま残す（この窓では、タイトルだけを直す）
 */
function startBlocks(template: unknown): TemplateBlock[] {
  if (!Array.isArray(template) || template.length === 0) return DEFAULT_TEMPLATE
  return template.flatMap((b: unknown) => {
    const type = b && typeof b === 'object' ? (b as { type?: unknown }).type : undefined
    if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(NEW_BLOCKS, type)) return []
    const text: unknown = textOf(b as TemplateBlock)
    const base = type === 'table' ? { ...NEW_BLOCKS.table, ...(b as object) } : NEW_BLOCKS[type as TemplateBlock['type']]
    return [withText(base as TemplateBlock, typeof text === 'string' ? text : '')]
  })
}

export function TemplateEditor({ course, config, footNote, onApply, onClose }: Props) {
  const [rows, setRows] = useState(() => withKeys(startBlocks(course.template)))
  const [abstractExample, setAbstractExample] = useState(course.abstractExample ?? '')
  const [selected, setSelected] = useState(0)
  const [focusKey, setFocusKey] = useState<number | null>(null)
  const blocks = rows.map((r) => r.block)
  const nums = numbers(blocks)
  const problems = problemsOf(blocks, abstractExample)
  // 開いたときの内容（直したかどうかを見るため）
  const [initial] = useState(() => JSON.stringify([startBlocks(course.template), course.abstractExample ?? '']))
  const changed = JSON.stringify([blocks, abstractExample]) !== initial
  // 直して「反映する」を押していないあいだは、タブを閉じる・読み込み直すときに確かめる
  useLeaveGuard(changed)
  /** 確認の窓（画面の中に出す：confirm.tsx） */
  const ask = useConfirm()
  /** 「×」「やめる」・Esc：直していたら、消えてよいか確かめてから閉じる */
  const close = async () => {
    if (changed && !(await ask('直した内容は反映されずに消えます。閉じますか？', { ok: '消して閉じる', danger: true }))) return
    onClose()
  }
  const inputs = useRef(new Map<number, HTMLInputElement>())
  /** 左の欄（「ほか○件」を押すと、いちばん下の一覧まで動かす） */
  const editRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (focusKey !== null) inputs.current.get(focusKey)?.focus()
  }, [focusKey])

  const setBlock = (i: number, block: TemplateBlock) => setRows(rows.map((r, j) => (j === i ? { ...r, block } : r)))
  // 行の並べ替え：行の左のつまみ（⋮⋮）をつかんで動かす（コースのカードと同じ。キーボードでは ↑・↓）
  const listRef = useRef<HTMLDivElement>(null)
  const order = useReorder(
    listRef,
    rows.length,
    (from, to) => {
      setRows((list) => {
        const next = [...list]
        const [r] = next.splice(from, 1)
        next.splice(to, 0, r)
        return next
      })
      setSelected(to)
    },
    '.row',
  )
  const remove = (i: number) => {
    setRows(rows.filter((_, j) => j !== i))
    setSelected(Math.max(0, Math.min(i, rows.length - 2)))
  }
  const add = (type: TemplateBlock['type']) => {
    const at = rows.length ? Math.min(selected, rows.length - 1) + 1 : 0
    const row = { key: ++keyCounter, block: { ...NEW_BLOCKS[type] } }
    setRows([...rows.slice(0, at), row, ...rows.slice(at)])
    setSelected(at)
    setFocusKey(row.key)
  }

  const dialogRef = useRef<HTMLDivElement>(null)
  // 日本語の変換中に Esc（変換の取り消し）を押したときは、窓を閉じる確かめを出さない
  const composing = useRef(false)
  useDialogFocus(dialogRef, () => !composing.current && close())
  return (
    // 書きかけのひな形が消えないよう、窓の外を押しても閉じない（「×」「やめる」・Esc は、直していたら確かめてから閉じる）
    <div className="modal-backdrop">
      <div
        className="modal tpl-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${course.name} コースの下書きのひな形`}
        ref={dialogRef}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => (composing.current = false)}
      >
        <header>
          <h2>{course.name || '（名前のないコース）'} コース　下書きのひな形</h2>
          <button className="close" onClick={close} aria-label="閉じる">
            ×
          </button>
        </header>
        <div className="tpl-body">
          <div className="tpl-edit" ref={editRef}>
            <label className="f">
              <span className="l">抄録の書き出し例（学生の抄録の欄に薄く出す。空なら「{config.abstract.openingExample}」）</span>
              <textarea className="in" rows={2} value={abstractExample} placeholder={`例：${config.abstract.openingExample}卒業イベント「…」において、筆者が制作した〇〇についてである。`} onChange={(e) => setAbstractExample(e.target.value)} />
            </label>
            <div className="tpl-h">
              <span className="l">本文の組み立て（上から順に、学生の本文になります）</span>
              <button
                className="link"
                onClick={async () => {
                  if (await ask('標準のひな形（企画・立案／制作過程／まとめ）に戻しますか？', { ok: '標準に戻す' })) {
                    setRows(withKeys(DEFAULT_TEMPLATE))
                    setSelected(0)
                  }
                }}
              >
                標準のひな形に戻す
              </button>
            </div>
            <div className="ol" ref={listRef}>
              {rows.map(({ key, block }, i) => (
                <div key={key} className={`row ${block.type}${i === selected ? ' on' : ''}${order.drag?.from === i ? ' dragging' : ''}`} onClick={() => setSelected(i)}>
                  <button className="grip" {...order.gripProps(i, key)} onFocus={() => setSelected(i)}>
                    ⋮⋮
                  </button>
                  <span className="kind">
                    {KIND_LABELS[block.type]}
                    {nums[i] && <b>{nums[i]}</b>}
                  </span>
                  {block.type === 'pageBreak' ? (
                    // 改ページは名前がない（この後ろは、学生の原稿でも次のページから始まる）
                    <span className="brk">ここで次のページへ</span>
                  ) : (
                    <span className="in-wrap">
                      <input
                        ref={(el) => {
                          if (el) inputs.current.set(key, el)
                          else inputs.current.delete(key)
                        }}
                        value={textOf(block)}
                        placeholder={PLACEHOLDERS[block.type]}
                        onFocus={() => setSelected(i)}
                        onChange={(e) => setBlock(i, withText(block, e.target.value))}
                      />
                      {/* ふつうの表の見出しの行は、紙面で作る画面で直す（ここでは見るだけ） */}
                      {block.type === 'table' && <small className="tbl-head">見出し：{block.header.map((h) => h.trim() || '（空）').join('・')}</small>}
                    </span>
                  )}
                  <span className="acts">
                    <button title="この行を削除" onClick={() => remove(i)}>
                      ✕
                    </button>
                  </span>
                </div>
              ))}
              {order.drag?.line != null && <div className="drop-line" style={{ top: order.drag.line }} />}
            </div>
            <div className="sr-only" aria-live="polite">
              {order.message}
            </div>
            <div className="adds">
              <span className="l">選んでいる行の下に足す：</span>
              {(['chapter', 'subheading', 'paragraph', 'figure', 'materialTable', 'pageBreak'] as const).map((type) => (
                <button key={type} onClick={() => add(type)}>
                  ＋ {KIND_LABELS[type]}
                </button>
              ))}
            </div>
            {problems.length > 0 && (
              <div className="problems" id="tpl-problems">
                {problems.map((p) => (
                  <div key={p.text} className="error">
                    {p.text}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="tpl-pv">
            <div className="caption">
              学生が最初に見る本文（見本）<span className="legend"><i className="g" />薄い字＝書くことの説明（PDFには出ない）</span>
            </div>
            <TemplatePreview blocks={blocks} />
          </div>
        </div>
        <footer className="tpl-foot">
          {problems.length === 0 && <span className="hint">{footNote}</span>}
          <span className="spacer" />
          {/* 押せないときは、1つ目の理由を「反映する」のとなりに出す（mockups/v35-admin ④ 案A）。2つ以上なら「ほか○件」を押すと、左の欄のいちばん下の一覧へ動く */}
          {problems.length > 0 && (
            <span className="why" id="tpl-why">
              {Icon.warn}
              <span>{problems[0].short}</span>
              {problems.length > 1 && (
                <button className="more" aria-controls="tpl-problems" onClick={() => editRef.current?.scrollTo({ top: editRef.current.scrollHeight, behavior: 'smooth' })}>
                  ほか{problems.length - 1}件
                </button>
              )}
            </span>
          )}
          <button onClick={close}>やめる</button>
          {/* 押せないときは、理由（左の欄のいちばん下の赤い字と同じ）を、ボタンに重ねたときにも出す */}
          <button
            className="primary"
            disabled={problems.length > 0}
            title={problems.map((p) => p.text).join('\n') || undefined}
            aria-describedby={problems.length ? 'tpl-why' : undefined}
            onClick={() => onApply(blocks, abstractExample.trim())}
          >
            反映する
          </button>
        </footer>
      </div>
    </div>
  )
}
