import { useEffect, useMemo, useRef, useState } from 'react'
import type { YearConfig } from '../config'
import { abstractHtml, coverHtml } from '../layout/document'
import { documentCss } from '../layout/documentCss'
import { DATA_FORMAT_VERSION, type Report } from '../model/types'

/**
 * 表紙と抄録の見本。学生用ツールと同じ組版の部品（document.ts・documentCss）で作る。
 * 年度設定から入る部分を黄色、学生が入力する部分を灰色で示す。
 * 管理ページの画面と CSS が混ざらないよう、iframe の中に表示する。
 */

function sampleReport(config: YearConfig, courseId: string): Report {
  return {
    formatVersion: DATA_FORMAT_VERSION,
    fiscalYear: config.fiscalYear,
    basicInfo: { studentId: '', name: '', courseId, subtitleInput: '' },
    abstract: { paragraphs: [{ type: 'paragraph', id: 'a', content: [{ type: 'text', text: `${config.abstract.openingExample}……（学生が入力する抄録の本文）` }] }] },
    body: [],
    references: [],
    workPhotos: { layout: 1, imageIds: [] },
    updatedAt: '',
  }
}

const PREVIEW_CSS = `
body { margin: 0; padding: 16px; background: #eef0f3; display: flex; gap: 16px; align-items: flex-start; letter-spacing: 0; text-align: left; }
.page { flex: none; width: 210mm; height: 297mm; box-sizing: border-box; background: #fff; box-shadow: 0 2px 10px rgba(0,0,0,.15); overflow: hidden; }
.page.cover-page { padding: 25mm; }
.page.abstract-page { padding: 25mm 25mm 25mm 35mm; }
[data-block-id]:empty::before { content: attr(data-placeholder); color: #9aa1ad; }
[data-block-id="basic:subtitleInput"]:empty::before { content: '（学生の入力）'; }
.abstract .body p { color: #9aa1ad; }
.abstract .head .subtitle { color: #9aa1ad; }
/* 年度設定から入る部分 */
.cover .year, .cover .heading, .cover .label, .cover .title, .cover .department, .cover .course, .cover .university,
.abstract .head .h, .abstract .head .row2, .abstract .head .row3 .advisors, .abstract .head .title { background: #fff3b0; }
`

export function Preview({ config, courseId }: { config: YearConfig; courseId: string }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(0.5)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      // 2ページ（210mm ≒ 794px ずつ）と余白が横に収まる倍率
      setZoom(Math.min(0.75, Math.max(0.3, (el.clientWidth - 24) / (794 * 2 + 48))))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const srcDoc = useMemo(() => {
    const report = sampleReport(config, courseId)
    return `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=BIZ+UDMincho&family=BIZ+UDPGothic&display=swap">
<style>${documentCss}${PREVIEW_CSS} body { zoom: ${zoom}; }</style></head>
<body><div class="page cover-page">${coverHtml(report, config)}</div><div class="page abstract-page">${abstractHtml(report, config)}</div></body></html>`
  }, [config, courseId, zoom])

  return (
    <div className="preview" ref={wrap}>
      <iframe title="表紙と抄録の見本" srcDoc={srcDoc} />
    </div>
  )
}
