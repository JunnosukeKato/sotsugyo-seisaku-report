// 動画 1：はじめ方（ログイン〜表紙）（パソコン）
// Google の確認の画面は録れない（ログインは偽物。本物の Google にはつながない）ので、字幕で伝える。
// 終わりに、右上の「≡ メニュー」（使い方・バックアップ・Word の読み込み）を開いて、「使い方」を見せる（2026-10-20 の画面）
export const meta = {
  number: '1',
  label: 'はじめ方（ログイン〜表紙）',
  device: 'pc',
  open: { login: false, tour: true },
  captions: {
    login: '最初に、大学の Google アカウントでログインします',
    consent: 'Google の確認の画面では、ドライブの項目にチェックを入れて「続行」を押します',
    course: 'はじめに、自分のコースを選びます',
    word: 'Word で書き始めていなければ、「いいえ」を押します',
    name: '学籍番号は自動で入ります。光っている欄に氏名を入れて、Enter を押します',
    subtitle: '続けて、サブタイトルを入れます',
    done: 'これで表紙ができました。「閉じる」を押します',
    tour: 'はじめての人には、画面の各部の案内が出ます。「次へ」で順に見られます',
    end: '困ったときの「使い方」は、右上の「メニュー」の中です',
    menu: 'メニューには、使い方・バックアップ・Word の読み込みがあります',
    help: '「使い方」を押すと、右の欄に使い方が出ます。言葉で探せます',
  },
}

const CUR = '.page-viewport.front [data-vivliostyle-page-container].is-current'

export async function run({ page, rec, h }) {
  // ログイン
  await page.waitForSelector('.login-over .login-btn')
  const card = await h.rectOf(page, '.login-card')
  const btn = await h.centerOf(page, '.login-btn')
  rec.mark('login', { focus: card })
  await h.sleep(900)
  await h.moveTo(page, btn.x, btn.y)
  await h.sleep(1500)
  rec.mark('consent')
  await h.sleep(3500)
  h.logClick(page, btn.x, btn.y)
  await page.mouse.click(btn.x, btn.y)
  await page.waitForFunction(() => !document.querySelector('.login-over'), { timeout: 60000 })

  // コース
  await page.waitForSelector('.guide.step-course .g-opts button')
  await h.ready(page)
  await h.sleep(400)
  rec.mark('course', { focus: await h.rectOf(page, '.g-tip') })
  await h.sleep(2000)
  await h.clickEl(page, '.guide .g-opts button', '映画・舞台衣装', { pause: 600 })

  // Word で書き始めているか
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await h.sleep(400)
  rec.mark('word', { focus: await h.rectOf(page, '.g-tip') })
  await h.sleep(2300)
  await h.clickEl(page, '.g-word-opt.no', null, { pause: 600 })

  // 学籍番号・氏名・サブタイトル
  const field = async (id) => {
    await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 30000 }, id)
    await h.ready(page)
    await h.sleep(400)
    const spot = await h.rectOf(page, '.g-spot')
    const tip = await h.rectOf(page, '.g-tip')
    return h.union(spot, tip)
  }
  // 学籍番号は、ログインしたアカウント（00zz0123@…）から自動で入っている。案内は氏名から
  const nameFocus = await field('basic:name')
  rec.mark('name', { focus: h.union(nameFocus, await h.blockRect(page, 'basic:studentId')) })
  await h.sleep(3000)
  await h.typeSlow(page, '文化　花子')
  await h.sleep(800)
  await page.keyboard.press('Enter')
  rec.mark('subtitle', { focus: await field('basic:subtitleInput') })
  await h.sleep(1000)
  await h.typeSlow(page, 'シンドバッド')
  await h.sleep(800)
  await page.keyboard.press('Enter')

  // できた表紙
  await page.waitForSelector('.guide.step-done')
  await h.ready(page)
  await h.sleep(400)
  rec.mark('done', { focus: h.union(await h.rectOf(page, CUR), await h.rectOf(page, '.g-tip')) })
  await h.sleep(2800)
  await h.clickEl(page, '.g-actions button', '閉じる', { pause: 600 })

  // 指差し確認（最後は「？ 使い方」：右上のメニューを指す）
  await page.waitForSelector('.tour .tour-tip', { timeout: 20000 })
  await h.sleep(500)
  rec.mark('tour', { full: true })
  // 案内の吹き出しが画面の下のほう（「PDFを書き出す」）にあるときは、字幕を上に出す（下の字幕に隠れないように）
  let low = false
  for (let i = 0; i < 10; i++) {
    const tip = await h.rectOf(page, '.tour .tour-tip')
    const nowLow = !!tip && tip.y + tip.h > page.viewport().height * 0.6
    if (nowLow !== low) {
      rec.mark(nowLow ? 'tourLow' : 'tourHigh', { full: true, place: nowLow ? 'top' : 'bottom' })
      low = nowLow
    }
    const next = await page.evaluate(() => document.querySelector('.tour-acts .next')?.textContent ?? '')
    if (next.includes('おわり')) {
      await h.sleep(300)
      rec.mark('end', { focus: h.union(await h.rectOf(page, '.tour .tour-tip'), await h.rectOf(page, '.side .menu-btn')) })
      await h.sleep(3000)
      await h.clickEl(page, '.tour-acts .next', null, { pause: 400 })
      break
    }
    await h.sleep(i === 0 ? 1900 : 750)
    await h.clickEl(page, '.tour-acts .next', null, { pause: 250 })
    await h.sleep(200)
  }
  await page.waitForFunction(() => !document.querySelector('.tour .tour-tip'), { timeout: 10000 })
  await h.sleep(500)

  // ≡ メニュー → 使い方
  await h.clickEl(page, '.side .menu-btn', null, { pause: 500 })
  await page.waitForSelector('.head-menu')
  await h.sleep(300)
  rec.mark('menu', { focus: h.union(await h.rectOf(page, '.head-menu'), await h.rectOf(page, '.side .menu-btn')) })
  await h.sleep(1100)
  const help = await h.centerOf(page, '.head-menu .hm-help')
  await h.moveTo(page, help.x - 20, help.y)
  await h.sleep(1800)
  await h.clickAt(page, help.x - 20, help.y, { pause: 400 })
  await h.sleep(700)
  // 右の欄の上のほう（言葉で探す欄と、はじめの項目）
  const side = await h.rectOf(page, '.side')
  rec.mark('help', { focus: { ...side, h: Math.min(side.h, 380) } })
  await h.sleep(3200)
}
