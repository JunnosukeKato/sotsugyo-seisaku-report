// PoC: Typst 版の本文組版（Vivliostyle 版 src/layout/reportCss.ts と同じ書式）
#let data = json(sys.inputs.at("data", default: "data.json"))
#let pitch = 18.4pt
#let tracking = 0.189pt

#set page(
  paper: "a4",
  margin: (top: 25mm, bottom: 25mm, right: 25mm, left: 35mm),
  footer: context align(center, counter(page).display()),
  footer-descent: 10mm,
)
#set text(font: "BIZ UDMincho", size: 11pt, lang: "ja", tracking: tracking, top-edge: 0.88em, bottom-edge: -0.12em)
#set par(justify: true, leading: pitch - 11pt, spacing: pitch - 11pt, first-line-indent: (amount: 1em + tracking, all: true))

#let chapter-numerals = ("Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ")
#let sub-numerals = ("ⅰ", "ⅱ", "ⅲ", "ⅳ", "ⅴ", "ⅵ", "ⅶ", "ⅷ", "ⅸ", "ⅹ")
#let heading-line(body) = block(sticky: true, above: pitch - 11pt, below: pitch - 11pt, par(first-line-indent: 0pt, body))

#for (ci, chapter) in data.chapters.enumerate() {
  if ci > 0 { pagebreak() }
  heading-line[#chapter-numerals.at(ci)．#chapter.title]
  let sub = 0
  let after-heading = true
  for block in chapter.blocks {
    if block.type == "subheading" {
      if not after-heading { v(pitch, weak: false) }
      heading-line[#sub-numerals.at(sub)．#block.title]
      sub += 1
    } else if block.type == "paragraph" {
      par(block.text)
    } else if block.type == "figures" {
      v(pitch)
      std.block(breakable: false, width: 100%, align(center, grid(
        columns: block.figures.len(),
        column-gutter: 20mm,
        ..block.figures.map(f => stack(
          spacing: pitch / 2,
          rect(width: f.size.at(0) * 1mm, height: f.size.at(1) * 1mm, fill: luma(217), stroke: none),
          [図#str(f.number).#f.caption],
        )),
      )))
      v(pitch)
    } else if block.type == "table" {
      std.block(sticky: true, align(center, [表#str(block.number).#block.caption]))
      table(
        columns: (1fr, 1fr, 1fr),
        align: center + horizon,
        stroke: 0.75pt,
        [名称], [使用箇所], [生地見本],
        ..block.rows.map(r => (
          par(first-line-indent: 0pt, r.at(0)),
          par(first-line-indent: 0pt, r.at(1)),
          rect(width: 35mm, height: 32mm, fill: luma(217), stroke: none),
        )).flatten(),
      )
      v(pitch)
    }
    after-heading = block.type == "subheading"
  }
}
