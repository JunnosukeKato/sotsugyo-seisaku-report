import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TemplateBlock, YearConfig } from '../config'
import { bodyContentHtml } from '../layout/bodyHtml'
import { abstractHtml, coverHtml } from '../layout/document'
import { documentCss } from '../layout/documentCss'
import { reportCss } from '../layout/reportCss'
import { bodyFromTemplate } from '../model/template'
import { DATA_FORMAT_VERSION, type Report } from '../model/types'

/**
 * 表紙・抄録と、本文のひな形の見本（mockups 案A：依頼者の選択 2026-10-22）。見開き（2ページずつ）で、下の「‹ ›」で送る。
 * 1枚目は表紙と抄録、2枚目からは本文のひな形のページ（目次・作品写真のページは出さない）。
 * 学生用ツールと同じ組版の部品（document.ts・documentCss・bodyHtml.ts・reportCss）で作る。年度設定から入る部分を黄色、学生が入力する部分を灰色で示す。
 * 本文は、ブラウザの段組み（CSS の multi-column）でページに分ける。大見出し・改ページで次のページへ。ページの切れ目は学生のツール（組版エンジン）とほぼ同じだが、
 * ページの下の端の1行などがずれることがある（正確な見え方は「ひな形を作る画面」）。
 * 管理ページの画面と CSS が混ざらないよう、iframe の中に表示する
 */

function sampleReport(config: YearConfig, courseId: string): Report {
  // 抄録の書き出し例は、コースのもの（なければ年度の設定のもの）
  const opening = config.courses.find((c) => c.id === courseId)?.abstractExample?.trim() || config.abstract.openingExample
  return {
    formatVersion: DATA_FORMAT_VERSION,
    fiscalYear: config.fiscalYear,
    basicInfo: { studentId: '', name: '', courseId, subtitleInput: '' },
    abstract: { paragraphs: [{ type: 'paragraph', id: 'a', content: [{ type: 'text', text: `${opening}……（学生が入力する抄録の本文）` }] }] },
    body: [],
    references: [],
    workPhotos: [{ layout: 1, imageIds: [] }],
    updatedAt: '',
  }
}

/** ひな形の本文の見本の字・枠（ここに書くことは薄い字、図は写真を入れる枠、表のマスは「（学生が書く）」、改ページは点線の印）。前の作り方の窓の見本（TemplateEditor.tsx）でも使う */
export const TEMPLATE_CONTENT_CSS = `
[data-block-id]:empty::before { content: attr(data-placeholder); color: #9aa1ad; }
p[data-block-id]:empty::before { color: #8a90a0; }
.figure-slot { margin: 0 auto; outline: 1px dashed #b9b9b9; background: repeating-linear-gradient(45deg, #f6f6f6 0 8px, #efefef 8px 16px); display: grid; place-items: center; }
.figure-slot::before { content: '（学生が写真を入れる枠）'; color: #9a9a9a; font-family: 'BIZ UDPGothic', sans-serif; font-size: 10pt; }
td [data-block-id]:empty::before { content: '（学生が書く）'; }
`

/** ページの幅（210mm）と、ページの間（px） */
const MM = 96 / 25.4
const PAGE_W = 210 * MM
const PAGE_H = 297 * MM
const GAP = 16
const PITCH = PAGE_W + GAP
const PAD = 16

const PREVIEW_CSS = `
html, body { margin: 0; overflow: hidden; background: #eef0f3; }
body { letter-spacing: 0; text-align: left; }
.strip { position: relative; width: ${PITCH * 2 - GAP}px; height: ${PAGE_H}px; margin: ${PAD}px; transform-origin: 0 0; clip-path: inset(-12px -8px); }
.rail { position: absolute; left: 0; top: 0; height: ${PAGE_H}px; transition: transform 0.2s ease; }
.page, .sheet { position: absolute; top: 0; width: 210mm; height: 297mm; box-sizing: border-box; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.15); overflow: hidden; }
.page.cover-page { left: 0; padding: 20mm; }
.page.abstract-page { left: ${PITCH}px; padding: 25mm 25mm 25mm 35mm; }
.sheet .no { position: absolute; left: 0; right: 0; top: calc(297mm - 15mm); text-align: center; font-family: 'BIZ UDMincho', serif; font-size: 11pt; }
[data-block-id]:empty::before { content: attr(data-placeholder); color: #9aa1ad; }
[data-block-id="basic:subtitleInput"]:empty::before { content: '（学生の入力）'; }
.abstract .body p { color: #9aa1ad; }
.abstract .head .subtitle { color: #9aa1ad; }
/* 年度設定から入る部分 */
.cover .year, .cover .heading, .cover .label, .cover .title, .cover .department, .cover .course, .cover .university,
.abstract .head .h, .abstract .head .row2, .abstract .head .row3 .advisors, .abstract .head .title { background: #fff3b0; }
/* 本文：段組みの1段が1ページの本文の領域（幅 150mm・高さ 247mm）。段の間は、ページの左右の余白とページの間 */
.flow { position: absolute; left: calc(${PITCH * 2}px + 35mm); top: 25mm; width: 150mm; height: 247mm; column-width: 150mm; column-gap: calc(60mm + ${GAP}px); column-fill: auto; }
.flow h1.chapter:not(:first-child) { break-before: column; }
.flow .page-break:not(.end) { break-after: column; }
.flow .page-break { position: relative; }
.flow .page-break::after { content: '改ページ'; position: absolute; left: 0; right: 0; top: 2mm; padding-top: 1mm; border-top: 1px dashed #9aa3c4; color: #7f88ab; font-family: 'BIZ UDPGothic', sans-serif; font-size: 8pt; letter-spacing: 0.2em; text-align: center; }
${TEMPLATE_CONTENT_CSS}
`

export function Preview({ config, courseId, template, startAtBody = false }: { config: YearConfig; courseId: string; template: TemplateBlock[]; startAtBody?: boolean }) {
  const wrap = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [scale, setScale] = useState(0.5)
  /** 本文のひな形のページ数（組んでから数える） */
  const [bodyPages, setBodyPages] = useState(0)
  /** 見開きの番号（0：表紙と抄録、1〜：本文） */
  const [spread, setSpread] = useState(startAtBody ? 1 : 0)
  const spreads = 1 + Math.ceil(bodyPages / 2)
  const shown = Math.min(spread, Math.max(0, spreads - 1))

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      // 2ページと余白が横に収まる倍率
      setScale(Math.min(0.75, Math.max(0.3, (el.clientWidth - 8) / (PITCH * 2 - GAP + PAD * 2))))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const srcDoc = useMemo(() => {
    const report = sampleReport(config, courseId)
    const chapters = bodyFromTemplate(template.some((b) => b.type === 'chapter') ? template : [])
    const body = bodyContentHtml(chapters, { imageSrc: () => '', figureSize: () => ({ widthMm: 60, heightMm: 45 }) })
    return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=BIZ+UDMincho&family=BIZ+UDPGothic&display=swap">
<style>${documentCss}${reportCss}${PREVIEW_CSS}</style></head>
<body><div class="strip"><div class="rail"><div class="page cover-page">${coverHtml(report, config)}</div><div class="page abstract-page">${abstractHtml(report, config)}</div><div class="sheets"></div><div class="flow"><section class="body">${body}</section></div></div></div></body></html>`
  }, [config, courseId, template])

  /** 組んだ本文のページ数を数え、ページの紙と番号を並べる（字の形が読み込まれてから） */
  const measure = useCallback(() => {
    const doc = frame.current?.contentDocument
    const flow = doc?.querySelector<HTMLElement>('.flow')
    const sheets = doc?.querySelector<HTMLElement>('.sheets')
    if (!doc || !flow || !sheets) return
    const count = Math.max(1, Math.round((flow.scrollWidth + 60 * MM + GAP) / PITCH))
    sheets.innerHTML = Array.from({ length: count }, (_, i) => `<div class="sheet" style="left:${PITCH * (2 + i)}px"><span class="no">${i + 1}</span></div>`).join('')
    setBodyPages(count)
  }, [])
  const onLoad = useCallback(() => {
    const doc = frame.current?.contentDocument
    measure()
    void doc?.fonts?.ready.then(measure)
  }, [measure])

  // 倍率と見開きを、iframe の中に当てる（組み直さない）
  useLayoutEffect(() => {
    const doc = frame.current?.contentDocument
    const strip = doc?.querySelector<HTMLElement>('.strip')
    const rail = doc?.querySelector<HTMLElement>('.rail')
    if (!strip || !rail) return
    strip.style.transform = `scale(${scale})`
    rail.style.transform = `translateX(${-shown * PITCH * 2}px)`
  })

  const label = shown === 0 ? '表紙・抄録' : bodyPageLabel(shown, bodyPages)
  return (
    <div className="preview paged" ref={wrap}>
      <iframe ref={frame} title="表紙・抄録と本文のひな形の見本" srcDoc={srcDoc} onLoad={onLoad} style={{ height: Math.ceil((PAGE_H + PAD * 2) * scale) }} />
      <div className="pv-nav">
        <button type="button" className="pv-turn" aria-label="前の見開き" disabled={shown === 0} onClick={() => setSpread(shown - 1)}>
          ‹
        </button>
        <span className="pv-label" aria-live="polite">
          {label}
          <small>
            {shown + 1} / {spreads}
          </small>
        </span>
        <button type="button" className="pv-turn" aria-label="次の見開き" disabled={shown >= spreads - 1} onClick={() => setSpread(shown + 1)}>
          ›
        </button>
      </div>
    </div>
  )
}

/** 本文の見開きの名前（例：本文 1–2 ページ。最後が1ページだけなら「本文 5 ページ」） */
export function bodyPageLabel(spread: number, bodyPages: number): string {
  const first = spread * 2 - 1
  const last = Math.min(first + 1, bodyPages)
  return last > first ? `本文 ${first}–${last} ページ` : `本文 ${first} ページ`
}
