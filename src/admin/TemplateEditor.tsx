import { useEffect, useMemo, useRef, useState } from 'react'
import type { Course, TemplateBlock, YearConfig } from '../config'
import { bodyContentHtml } from '../layout/bodyHtml'
import { reportCss } from '../layout/reportCss'
import { bodyFromTemplate, DEFAULT_TEMPLATE } from '../model/template'

/**
 * コースの「下書きのひな形」を編集する画面（mockups/v8 案1：コースのカードから開く）。
 * 左で本文の組み立て（大見出し・小見出し・書くことの説明・図の枠・素材表）を並べ、右で学生が最初に見る本文を確かめる。
 */

const KIND_LABELS: Record<TemplateBlock['type'], string> = { chapter: '大見出し', subheading: '小見出し', paragraph: '説明', figure: '図の枠', materialTable: '素材表' }
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
    if (b.type === 'materialTable') return `表${++tab}`
    return ''
  })
}

function problemsOf(blocks: TemplateBlock[]): string[] {
  const problems: string[] = []
  if (blocks.length === 0) problems.push('大見出しを1つ以上入れてください')
  else if (blocks[0].type !== 'chapter') problems.push('いちばん上は大見出しにしてください')
  blocks.forEach((b, i) => {
    const empty = b.type === 'chapter' || b.type === 'subheading' ? !b.title.trim() : b.type === 'figure' || b.type === 'materialTable' ? !b.caption.trim() : false
    if (empty) problems.push(`${i + 1}行目の${KIND_LABELS[b.type]}の名前が空です`)
  })
  return problems
}

const textOf = (b: TemplateBlock) => (b.type === 'chapter' || b.type === 'subheading' ? b.title : b.type === 'paragraph' ? b.hint : b.caption)
const withText = (b: TemplateBlock, text: string): TemplateBlock =>
  b.type === 'chapter' || b.type === 'subheading' ? { ...b, title: text } : b.type === 'paragraph' ? { ...b, hint: text } : { ...b, caption: text }
const PLACEHOLDERS: Record<TemplateBlock['type'], string> = {
  chapter: '大見出しの名前（例：企画・立案）',
  subheading: '小見出しの名前（例：デザイン説明）',
  paragraph: '学生に薄い字で見せる「ここに何を書くか」（例：デザインの意図を書く）',
  figure: '図のタイトル（例：デザイン画）',
  materialTable: '表のタイトル（例：使用素材表）',
}
const NEW_BLOCKS: Record<TemplateBlock['type'], TemplateBlock> = {
  chapter: { type: 'chapter', title: '' },
  subheading: { type: 'subheading', title: '' },
  paragraph: { type: 'paragraph', hint: '' },
  figure: { type: 'figure', caption: '' },
  materialTable: { type: 'materialTable', caption: '使用素材表' },
}

const PREVIEW_CSS = `
body { margin: 0; padding: 14px; background: #eef0f3; }
.page { width: 210mm; min-height: 297mm; box-sizing: border-box; margin: 0 auto; padding: 25mm 25mm 25mm 35mm; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.15); }
[data-block-id]:empty::before { content: attr(data-placeholder); color: #9aa1ad; }
p[data-block-id]:empty::before { color: #8a90a0; }
.figure-slot { margin: 0 auto; outline: 1px dashed #b9b9b9; background: repeating-linear-gradient(45deg, #f6f6f6 0 8px, #efefef 8px 16px); display: grid; place-items: center; }
.figure-slot::before { content: '（学生が写真を入れる枠）'; color: #9a9a9a; font-family: 'BIZ UDPGothic', sans-serif; font-size: 10pt; }
h1.chapter:not(:first-child) { margin-top: 2em; }
`

function TemplatePreview({ blocks }: { blocks: TemplateBlock[] }) {
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
  onApply: (template: TemplateBlock[], abstractExample: string) => void
  onClose: () => void
}

// 行を入れ替えても入力欄が混ざらないよう、行ごとに目印（key）を付けて持つ
let keyCounter = 0
const withKeys = (list: TemplateBlock[]) => list.map((block) => ({ key: ++keyCounter, block }))

export function TemplateEditor({ course, config, onApply, onClose }: Props) {
  const [rows, setRows] = useState(() => withKeys(course.template && course.template.length ? course.template : DEFAULT_TEMPLATE))
  const [abstractExample, setAbstractExample] = useState(course.abstractExample ?? '')
  const [selected, setSelected] = useState(0)
  const [focusKey, setFocusKey] = useState<number | null>(null)
  const blocks = rows.map((r) => r.block)
  const nums = numbers(blocks)
  const problems = problemsOf(blocks)
  const inputs = useRef(new Map<number, HTMLInputElement>())

  useEffect(() => {
    if (focusKey !== null) inputs.current.get(focusKey)?.focus()
  }, [focusKey])

  const setBlock = (i: number, block: TemplateBlock) => setRows(rows.map((r, j) => (j === i ? { ...r, block } : r)))
  const move = (i: number, delta: number) => {
    const next = [...rows]
    const [r] = next.splice(i, 1)
    next.splice(i + delta, 0, r)
    setRows(next)
    setSelected(i + delta)
  }
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

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal tpl-modal" role="dialog" aria-label={`${course.name} コースの下書きのひな形`}>
        <header>
          <h2>{course.name || '（名前のないコース）'} コース　下書きのひな形</h2>
          <button className="close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </header>
        <div className="tpl-body">
          <div className="tpl-edit">
            <label className="f">
              <span className="l">抄録の書き出し例（学生の抄録の欄に薄く出す。空なら「{config.abstract.openingExample}」）</span>
              <textarea className="in" rows={2} value={abstractExample} placeholder={`例：${config.abstract.openingExample}卒業イベント「…」において、筆者が制作した〇〇についてである。`} onChange={(e) => setAbstractExample(e.target.value)} />
            </label>
            <div className="tpl-h">
              <span className="l">本文の組み立て（上から順に、学生の本文になります）</span>
              <button
                className="link"
                onClick={() => {
                  if (confirm('標準のひな形（企画・立案／制作過程／まとめ）に戻しますか？')) {
                    setRows(withKeys(DEFAULT_TEMPLATE))
                    setSelected(0)
                  }
                }}
              >
                標準のひな形に戻す
              </button>
            </div>
            <div className="ol">
              {rows.map(({ key, block }, i) => (
                <div key={key} className={`row ${block.type}${i === selected ? ' on' : ''}`} onClick={() => setSelected(i)}>
                  <span className="kind">
                    {KIND_LABELS[block.type]}
                    {nums[i] && <b>{nums[i]}</b>}
                  </span>
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
                  <span className="acts">
                    <button title="上へ" disabled={i === 0} onClick={() => move(i, -1)}>
                      ↑
                    </button>
                    <button title="下へ" disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                      ↓
                    </button>
                    <button title="この行を削除" onClick={() => remove(i)}>
                      ✕
                    </button>
                  </span>
                </div>
              ))}
            </div>
            <div className="adds">
              <span className="l">選んでいる行の下に足す：</span>
              {(['chapter', 'subheading', 'paragraph', 'figure', 'materialTable'] as const).map((type) => (
                <button key={type} onClick={() => add(type)}>
                  ＋ {KIND_LABELS[type]}
                </button>
              ))}
            </div>
            {problems.length > 0 && (
              <div className="problems">
                {problems.map((p) => (
                  <div key={p} className="error">
                    {p}
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
          <span className="hint">「反映する」の後、上の「保存」で学生のツールに届きます。すでに書き始めた学生の原稿は変わりません。</span>
          <span className="spacer" />
          <button onClick={onClose}>やめる</button>
          <button className="primary" disabled={problems.length > 0} onClick={() => onApply(blocks, abstractExample.trim())}>
            反映する
          </button>
        </footer>
      </div>
    </div>
  )
}
