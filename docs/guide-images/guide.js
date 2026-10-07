// 使い方の手引き（docs/手引き_*.html）の画面の画像に、番号の吹き出しと囲みの枠を重ねる。
// 画像と吹き出しの場所は scripts/make-guides.mjs が撮って書き出す（guide-images/g-*.jpg と marks.js）。
// HTML には、置き場所だけを書く：
//   <figure class="shot" data-shot="g-write" data-badges="1,2" data-hl="2" data-labels="1:A"></figure>
//   data-badges：出す番号（省略ですべて。空ならなし）／data-hl：枠で囲む番号／data-labels：番号の代わりに出す文字
// 画像がそろったら <body data-ready="true"> にする（PDF を作るスクリプトが待つ）
;(function () {
  var MARKS = window.GUIDE_MARKS || {}
  var f = function (v) {
    return +v.toFixed(2)
  }
  var list = function (s) {
    return s === undefined ? null : s.split(',').filter(Boolean).map(Number)
  }
  // 吹き出しの中心：部品の外側に、吹き出しの半径（--mkr）とすき間（--mkgap）だけ離す
  var place = function (x) {
    var b = x.box
    var L = f(b.x + x.dx)
    var R = f(b.x + b.w + x.dx)
    var T = f(b.y + x.dy)
    var B = f(b.y + b.h + x.dy)
    var cx = f((L + R) / 2)
    var cy = f((T + B) / 2)
    var away = 'var(--mkr) + var(--mkgap)'
    return {
      l: 'left:calc(' + L + '% - ' + away + ');top:' + cy + '%',
      r: 'left:calc(' + R + '% + ' + away + ');top:' + cy + '%',
      t: 'left:' + cx + '%;top:calc(' + T + '% - ' + away + ')',
      b: 'left:' + cx + '%;top:calc(' + B + '% + ' + away + ')',
      tl: 'left:' + L + '%;top:' + T + '%',
      tr: 'left:' + R + '%;top:' + T + '%',
      bl: 'left:' + L + '%;top:' + B + '%',
      br: 'left:' + R + '%;top:' + B + '%',
      c: 'left:' + cx + '%;top:' + cy + '%',
      // 画像の左の外（余白）に置き、部品の左の端まで線を引く（部品が詰まっていて、近くに置くと字が隠れるとき）
      ol: 'left:calc(0% - ' + away + ' - var(--mkout));top:' + cy + '%',
    }[x.at]
  }
  var figures = document.querySelectorAll('figure[data-shot]')
  for (var i = 0; i < figures.length; i++) {
    var fig = figures[i]
    var name = fig.getAttribute('data-shot')
    var m = MARKS[name]
    if (!m) {
      fig.textContent = '（画像 ' + name + ' がありません。node scripts/make-guides.mjs で撮ってください）'
      continue
    }
    var badges = list(fig.dataset.badges)
    var hl = list(fig.dataset.hl) || []
    var labels = {}
    ;(fig.dataset.labels || '').split(',').filter(Boolean).forEach(function (p) {
      var kv = p.split(':')
      labels[kv[0]] = kv[1]
    })
    fig.style.aspectRatio = m.w + ' / ' + m.h
    var html = '<img src="guide-images/' + name + '.jpg" alt="' + (fig.getAttribute('aria-label') || '') + '">'
    m.marks.forEach(function (x) {
      if (hl.indexOf(x.n) >= 0)
        html += '<span class="hl" style="left:calc(' + x.box.x + '% - 0.6mm);top:calc(' + x.box.y + '% - 0.6mm);width:calc(' + x.box.w + '% + 1.2mm);height:calc(' + x.box.h + '% + 1.2mm)"></span>'
    })
    var shown = m.marks.filter(function (x) {
      return !badges || badges.indexOf(x.n) >= 0
    })
    shown.forEach(function (x) {
      if (x.at === 'ol')
        html += '<span class="ld" style="left:calc(0% - var(--mkgap) - var(--mkout));top:' + f(x.box.y + x.dy + x.box.h / 2) + '%;width:calc(' + f(x.box.x + x.dx) + '% + var(--mkgap) + var(--mkout) - 0.6mm)"></span>'
    })
    shown.forEach(function (x) {
      html += '<i class="mk' + (labels[x.n] ? ' sub' : '') + '" style="' + place(x) + '">' + (labels[x.n] || x.n) + '</i>'
    })
    fig.innerHTML = html
  }
  var images = Array.prototype.slice.call(document.images)
  Promise.all(
    images.map(function (img) {
      return img.decode ? img.decode().catch(function () {}) : Promise.resolve()
    }),
  ).then(function () {
    document.body.setAttribute('data-ready', 'true')
  })
})()
