// デザイン案（v8）：管理ページのひな形編集で共有する部品
import { COURSES, draftPage, numbered } from './data.js'

export { COURSES, draftPage }

const KIND = { chapter: '大見出し', sub: '小見出し', para: '説明', figure: '図', table: '素材表' }

export const HEADER = (extra = '') => `
  <header class="admin-header">
    <b>管理ページ</b>
    <select class="sel"><option>2026年度</option></select>
    <span class="badge ok">公開中</span>
    ${extra}
    <span class="spacer"></span>
    <a class="link">変更履歴</a><a class="link">管理者</a>
    <span class="user">kato@…（先生）</span>
    <button class="btn">保存</button>
    <button class="btn primary">学生に公開</button>
  </header>`

/** ひな形の組み立てを、行の一覧として編集する */
export function outlineHtml(course, selectedIndex = 2) {
  const rows = numbered(course.blocks)
    .map((b, i) => {
      const cls = { chapter: 'ch', sub: 'sub', para: 'para', figure: 'fig', table: 'tab' }[b.type]
      const num = b.type === 'chapter' || b.type === 'sub' ? `<b>${b.label.split('．')[0]}．</b>` : ''
      const value = b.type === 'para' ? b.hint : b.type === 'figure' ? b.hint : b.type === 'table' ? b.caption : b.title
      const placeholder = b.type === 'para' ? '学生に薄い字で見せる「書くことの説明」' : ''
      return `<div class="row ${cls}${i === selectedIndex ? ' on' : ''}"><span class="grip">⋮⋮</span><span class="kind">${KIND[b.type]}${num}</span><input value="${value}" placeholder="${placeholder}"><span class="acts"><button title="上へ">↑</button><button title="下へ">↓</button><button title="削除">✕</button></span></div>`
    })
    .join('')
  return `<div class="ol">${rows}</div>
    <div class="adds"><button>＋ 大見出し</button><button>＋ 小見出し</button><button>＋ 説明（段落）</button><button>＋ 図の枠</button><button>＋ 素材表</button></div>`
}

export const ABSTRACT_FIELD = (course) => `
  <div class="fieldset"><span class="l">抄録の書き出し例（学生の抄録の欄に薄く出す）</span><textarea rows="3">${course.abstractExample}</textarea></div>`

/** 紙面の見本を、入れ物の大きさに合わせて縮小して置く */
export function fitPaper(box, maxW, maxH) {
  const s = Math.min(maxW / 794, maxH / 1123)
  box.style.width = `${794 * s}px`
  box.style.height = `${1123 * s}px`
  box.style.position = 'relative'
  box.style.overflow = 'hidden'
  const paper = box.querySelector('.paper')
  paper.style.position = 'absolute'
  paper.style.left = '0'
  paper.style.top = '0'
  paper.style.transformOrigin = '0 0'
  paper.style.transform = `scale(${s})`
}
