// 試し用の Word ファイル（.docx）を作る小さな手伝い。中身は fflate で zip にした document.xml・rels・画像。
// 単体テスト（src/import/wordImport.test.ts）と、通しテスト用の見本を作るスクリプト（make-word-sample.mjs）で使う。
// 学科のひな形（04_本文.docx・01_表紙.docx）と同じつくり（文字の枠の図のタイトル、浮かせた画像、表）を作れる。
import { strToU8, zipSync, zlibSync } from 'fflate'

export const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  wStrict: 'http://purl.oclc.org/ooxml/wordprocessingml/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  v: 'urn:schemas-microsoft-com:vml',
  o: 'urn:schemas-microsoft-com:office:office',
  w14: 'http://schemas.microsoft.com/office/word/2010/wordml',
  wp14: 'http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing',
}

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 画像の関係の ID（document.xml の r:embed に書く）。makeDocx の media の名前から作る */
export const rid = (name) => `rId_${name.replace(/[^A-Za-z0-9]/g, '_')}`

/** 文字の並び（w:r） */
export const run = (text) => `<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`

/** 段落。中身は文字（そのまま1つの並びにする）か、w:r などの XML */
export const p = (...content) => `<w:p>${content.map((c) => (c.startsWith('<') ? c : run(c))).join('')}</w:p>`

/** スタイルを付けた段落（見出しなど） */
export const styled = (styleId, ...content) => `<w:p><w:pPr><w:pStyle w:val="${esc(styleId)}"/></w:pPr>${content.map((c) => (c.startsWith('<') ? c : run(c))).join('')}</w:p>`

/** 自動の段落番号を付けた段落 */
export const numbered = (numId, ilvl, text) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${run(text)}</w:p>`

/** 手で入れた改行（Shift+Enter） */
export const br = '<w:r><w:br/></w:r>'
/** 改ページ */
export const pageBreak = '<w:r><w:br w:type="page"/></w:r>'
export const tab = '<w:r><w:tab/></w:r>'

let shapeId = 0

function picture(id, cx, cy, crop) {
  const srcRect = crop ? `<a:srcRect l="${crop.l ?? 0}" t="${crop.t ?? 0}" r="${crop.r ?? 0}" b="${crop.b ?? 0}"/>` : ''
  return (
    `<a:graphic xmlns:a="${NS.a}"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="${NS.pic}"><pic:nvPicPr><pic:cNvPr id="${shapeId}" name="図 ${shapeId}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${id}"/>${srcRect}<a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic>`
  )
}

/** 行内に置いた画像（w:r）。crop は Word の切り抜き（1/1000 %） */
export function inlineImage(id, { cx = 1800000, cy = 2400000, crop } = {}) {
  shapeId++
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${shapeId}" name="図 ${shapeId}"/>${picture(id, cx, cy, crop)}</wp:inline></w:drawing></w:r>`
}

const anchor = (inner, { x, y, cx, cy, wrap }) =>
  `<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="${251658240 + shapeId}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
  `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="margin"><wp:posOffset>${x}</wp:posOffset></wp:positionH>` +
  `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${y}</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/>` +
  `<wp:effectExtent l="0" t="0" r="0" b="0"/>${wrap}<wp:docPr id="${shapeId}" name="図 ${shapeId}"/><wp:cNvGraphicFramePr/>${inner}</wp:anchor>`

/** 浮かせた画像（w:r。文字の前面・四角など）。x は余白からの左の位置（EMU） */
export function floatingImage(id, { x = 1580000, y = 385000, cx = 2237740, cy = 3162300, crop } = {}) {
  shapeId++
  return `<w:r><w:drawing>${anchor(picture(id, cx, cy, crop), { x, y, cx, cy, wrap: '<wp:wrapSquare wrapText="bothSides"/>' })}</w:drawing></w:r>`
}

/**
 * 文字の枠（w:r）。ひな形の図のタイトル「図1 デザイン画」と同じく、浮かせた図形の中に文字があり、
 * 新旧2通りの書き方（mc:Choice と mc:Fallback）で同じ文字が2回入る。lines は枠の中の段落
 */
export function textBox(lines, { x = 1324610, y = 3418923, cx = 2749550, cy = 546100 } = {}) {
  shapeId++
  const content = `<w:txbxContent>${[].concat(lines).map((l) => p(l)).join('')}</w:txbxContent>`
  const shape =
    `<a:graphic xmlns:a="${NS.a}"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">` +
    `<wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></wps:spPr>` +
    `<wps:txbx>${content}</wps:txbx><wps:bodyPr rot="0" vert="horz" wrap="square"/></wps:wsp></a:graphicData></a:graphic>`
  return (
    `<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>${anchor(shape, { x, y, cx, cy, wrap: '<wp:wrapNone/>' })}</w:drawing></mc:Choice>` +
    `<mc:Fallback><w:pict><v:shape id="テキスト ボックス ${shapeId}" type="#_x0000_t202" style="position:absolute;margin-left:104pt;margin-top:269pt;width:216pt;height:43pt" filled="f" stroked="f">` +
    `<v:textbox>${content}</v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r>`
  )
}

/** 表のセル。文字、または { text, images: [画像の関係の ID], span, vMerge } */
function cell(c) {
  const spec = typeof c === 'string' ? { text: c } : c
  const tcPr = `<w:tcPr>${spec.span ? `<w:gridSpan w:val="${spec.span}"/>` : ''}${spec.vMerge ? `<w:vMerge${spec.vMerge === 'restart' ? ' w:val="restart"' : ''}/>` : ''}</w:tcPr>`
  const lines = String(spec.text ?? '').split('\n')
  const images = (spec.images ?? []).map((id) => inlineImage(id, { cx: 900000, cy: 900000 })).join('')
  return `<w:tc>${tcPr}${lines.map((l, i) => p(...(l ? [l] : []), ...(i === 0 ? [images] : []).filter(Boolean))).join('')}</w:tc>`
}

/** 表。rows は行ごとのセルの並び（1行目は見出しの行） */
export function table(rows) {
  const columns = Math.max(...rows.map((r) => r.reduce((n, c) => n + (typeof c === 'object' && c.span ? c.span : 1), 0)))
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLook w:val="04A0"/></w:tblPr>` +
    `<w:tblGrid>${'<w:gridCol w:w="2900"/>'.repeat(columns)}</w:tblGrid>` +
    rows.map((r) => `<w:tr>${r.map(cell).join('')}</w:tr>`).join('') +
    `</w:tbl>`
  )
}

const CONTENT_TYPES = (media, extra) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
  [...new Set(Object.keys(media).map((n) => n.split('.').pop().toLowerCase()))]
    .map((ext) => `<Default Extension="${ext}" ContentType="${{ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', emf: 'image/x-emf', gif: 'image/gif', tif: 'image/tiff', tiff: 'image/tiff' }[ext] ?? 'application/octet-stream'}"/>`)
    .join('') +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  extra.map(([part, type]) => `<Override PartName="/word/${part}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/>`).join('') +
  `</Types>`

const wrapXml = (root, inner, wNs) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:${root} xmlns:w="${wNs}" xmlns:w14="${NS.w14}" xmlns:mc="${NS.mc}" mc:Ignorable="w14">${inner}</w:${root}>`

/**
 * Word のファイル（.docx）の中身を作る。
 * - body: w:body の中の XML（p・table などで作る）
 * - media: word/media に入れる画像（名前 → 中身）。document.xml からは rid(名前) で指す
 * - styles・numbering: w:styles・w:numbering の中の XML（なければ入れない）
 * - strict: Word の新しい保存形式（Strict Open XML）の名前空間にする
 */
export function makeDocx({ body, media = {}, styles, numbering, strict = false }) {
  const wNs = strict ? NS.wStrict : NS.w
  const ns = Object.entries({ ...NS, w: wNs })
    .filter(([k]) => k !== 'wStrict')
    .map(([k, v]) => `xmlns:${k}="${v}"`)
    .join(' ')
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${ns} mc:Ignorable="w14 wp14"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`
  const rels = [
    ...Object.keys(media).map((name) => `<Relationship Id="${rid(name)}" Type="${REL}/image" Target="media/${name}"/>`),
    ...(styles !== undefined ? [`<Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/>`] : []),
    ...(numbering !== undefined ? [`<Relationship Id="rIdNumbering" Type="${REL}/numbering" Target="numbering.xml"/>`] : []),
  ]
  const files = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES(media, [...(styles !== undefined ? [['styles.xml', 'styles']] : []), ...(numbering !== undefined ? [['numbering.xml', 'numbering']] : [])])),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    'word/document.xml': strToU8(document),
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`),
  }
  if (styles !== undefined) files['word/styles.xml'] = strToU8(wrapXml('styles', styles, wNs))
  if (numbering !== undefined) files['word/numbering.xml'] = strToU8(wrapXml('numbering', numbering, wNs))
  for (const [name, data] of Object.entries(media)) files[`word/media/${name}`] = data
  return zipSync(files)
}

// ---- 小さな PNG ----

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes) {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(strToU8(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/**
 * 小さな PNG。draw(x, y) が [r, g, b] を返す（省略したら、地の色 background に、真ん中に人の形（頭と体）を描く）
 */
export function png(width, height, { background = [235, 228, 214], figure = [47, 62, 117], draw } = {}) {
  const pixel =
    draw ??
    ((x, y) => {
      const cx = width / 2
      const head = (x - cx) ** 2 + (y - height * 0.22) ** 2 < (width * 0.12) ** 2
      const body = Math.abs(x - cx) < width * (0.12 + 0.18 * Math.min(1, Math.max(0, (y - height * 0.32) / (height * 0.5)))) && y > height * 0.32 && y < height * 0.88
      return head ? [226, 190, 160] : body ? figure : background
    })
  const raw = new Uint8Array((width * 3 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 3 + 1) + 1 + x * 3)
  }
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array())]
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** EMF（Word の図形や、ほかのソフトから貼り付けた図の形）の頭だけ。ツールでは使えない形の試しに使う */
export function emfHeader() {
  const out = new Uint8Array(88)
  const view = new DataView(out.buffer)
  view.setUint32(0, 1, true)
  view.setUint32(4, 88, true)
  out.set(strToU8(' EMF'), 40)
  return out
}
