// デザイン案（v9）：抄録の見出し部分の「学籍番号・氏名」と「指導教員」の並べ方。
// 学生のツールと同じ部品（abstractHtml・documentCss）で組み、見出しの2行だけを差し替えて比べる
import '../fonts.ts'
import { currentConfig } from '../../src/config'
import { abstractHtml } from '../../src/layout/document'
import { documentCss } from '../../src/layout/documentCss'
import { createReport } from '../../src/model/newReport'

const report = createReport(currentConfig)
report.basicInfo = { ...report.basicInfo, studentId: '23FA0123', name: '文化　花子', subtitleInput: 'シンドバッド' }
report.abstract.paragraphs[0].content = [
  { type: 'text', text: '本制作報告書は、卒業イベント「シンドバッド」において、筆者が制作したシンドバッドの衣装についてである。七つの航海を経て成長していく主人公の姿を、衣装で表すことを目標とした。中東の伝統的な装いをもとに、航海の力強さと冒険心を表すデザインを考えた。' },
]
const course = currentConfig.courses[0]
const advisors = course.advisors.join('、')
const id = report.basicInfo.studentId
const name = report.basicInfo.name

const ROW3 = /<div class="el row row3">[^\n]*<\/div>\n<div class="el row row4">[^\n]*<\/div>/

const VARIANTS = [
  {
    key: 'now',
    title: '今（手順書のテンプレートどおり）',
    note: '学籍番号・氏名は左、指導教員は次の行の右。下線の長さがそろわず、段違いに見える',
    rows: null as string | null,
  },
  {
    key: 'a',
    title: '案A　1行に収める',
    note: '左に学籍番号・氏名、右に指導教員。収まらないときは文字を少し小さくする（この例は指導教員3名で 9pt）。4名以上で収まらなければ2行にする',
    rows: `<div class="el row row3 one"><span>学籍番号　${id}　　氏名　${name}</span><span>（指導教員　${advisors}　）</span></div>`,
  },
  {
    key: 'b',
    title: '案B　2行で左をそろえる',
    note: '項目名の位置をそろえ、下線はどちらも本文の幅いっぱい。上の「学部・学科／コース」の行と同じ形になる',
    rows: `<div class="el row row3 b"><span class="k">学籍番号</span><span>${id}</span><span class="k">氏名</span><span>${name}</span></div>\n<div class="el row row4 b"><span class="k">指導教員</span><span>${advisors}</span></div>`,
  },
  {
    key: 'c',
    title: '案C　表のように区切る',
    note: '学籍番号・氏名・指導教員を罫線で区切った2段の欄にする。書類らしく、項目がはっきりする',
    rows: `<div class="el row row3 c"><table><tr><th>学籍番号</th><td class="id">${id}</td><th>氏名</th><td>${name}</td></tr><tr><th>指導教員</th><td colspan="3">${advisors}</td></tr></table></div>`,
  },
]

const VARIANT_CSS = `
/* 案A：1行。見出しの高さを1行分つめ、題目・サブタイトルを上げる */
.v-a .abstract .head { height: 51mm; }
.v-a .abstract .head .row3.one { width: 150mm; display: flex; justify-content: space-between; padding: 0 0 1.2mm; font-size: 9pt; }
.v-a .abstract .head .title { top: 28.1mm; }
.v-a .abstract .head .subtitle { top: 37.25mm; }
/* 案B：2行・左そろえ */
.v-b .abstract .head .row.b { width: 150mm; display: grid; grid-template-columns: 17mm 43mm 11mm 1fr; padding: 0 0 1.2mm; }
.v-b .abstract .head .row4.b { left: 0; right: auto; grid-template-columns: 17mm 1fr; }
/* 案C：表 */
.v-c .abstract .head .row3.c { width: 150mm; border-bottom: 0; padding: 0; }
.v-c .abstract .head .title { top: 37mm; }
.v-c .abstract .head .subtitle { top: 46.15mm; }
.v-c .abstract .head .row3.c table { width: 150mm; border-collapse: collapse; font-size: 10pt; }
.v-c .abstract .head .row3.c th, .v-c .abstract .head .row3.c td { border: 0.75pt solid #000; padding: 1.3mm 2mm; text-align: left; font-weight: 400; white-space: nowrap; }
.v-c .abstract .head .row3.c th { width: 16mm; text-align: center; letter-spacing: 0.1em; }
.v-c .abstract .head .row3.c td.id { width: 34mm; }
`

const cards = VARIANTS.map((v) => {
  const html = abstractHtml(report, currentConfig)
  const body = v.rows ? html.replace(ROW3, v.rows) : html
  return `<figure class="card v-${v.key}"><figcaption><b>${v.title}</b><span>${v.note}</span></figcaption><div class="sheet"><div class="page">${body}</div></div></figure>`
}).join('')

const style = document.createElement('style')
style.textContent = documentCss + VARIANT_CSS
document.head.append(style)
document.getElementById('cards')!.innerHTML = cards
