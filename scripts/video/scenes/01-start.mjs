// 動画 1：はじめ方（ログイン〜表紙）（パソコン）
// Google の確認の画面は録れない（ログインは偽物。本物の Google にはつながない）ので、字幕で伝える
export const meta = {
  number: '1',
  label: 'はじめ方（ログイン〜表紙）',
  device: 'pc',
  open: { login: false, tour: true },
  captions: {
    login: '最初に、大学の Google アカウントでログインします',
    consent: 'Google の確認の画面が出たら、ドライブの項目にチェックを入れて「続行」を押します',
    course: 'はじめに、自分のコースを選びます',
    word: 'Word で書き始めていなければ、「いいえ」を押します',
    name: '学籍番号は自動で入ります。光っている欄に氏名を入れて、Enter を押します',
    subtitle: '続けて、サブタイトルを入れます',
    done: 'これで表紙ができました。「閉じる」を押します',
    tour: 'はじめての人には、画面の各部の案内が出ます。「次へ」で順に見られます',
    end: '案内は、右上の「メニュー」の「？ 使い方」からもう一度見られます',
  },
}

const CUR = '.page-viewport.front [data-vivliostyle-page-container].is-current'

export async function run({ page, rec, h }) {
  // ログイン
  await page.waitForSelector('.login-over .login-btn')
  const card = await h.rectOf(page, '.login-card')
  const btn = await h.centerOf(page, '.login-btn')
  rec.mark('login', { focus: card })
  await h.sleep(1200)
  await h.moveTo(page, btn.x, btn.y)
  await h.sleep(2400)
  rec.mark('consent')
  await h.sleep(4200)
  h.logClick(page, btn.x, btn.y)
  await page.mouse.click(btn.x, btn.y)
  await page.waitForFunction(() => !document.querySelector('.login-over'), { timeout: 60000 })

  // コース
  await page.waitForSelector('.guide.step-course .g-opts button')
  await h.ready(page)
  await h.sleep(500)
  rec.mark('course', { focus: await h.rectOf(page, '.g-tip') })
  await h.sleep(2200)
  await h.clickEl(page, '.guide .g-opts button', '映画・舞台衣装', { pause: 700 })

  // Word で書き始めているか
  await page.waitForSelector('.guide.step-word .g-word-opt.no')
  await h.sleep(500)
  rec.mark('word', { focus: await h.rectOf(page, '.g-tip') })
  await h.sleep(2600)
  await h.clickEl(page, '.g-word-opt.no', null, { pause: 700 })

  // 学籍番号・氏名・サブタイトル
  const field = async (id) => {
    await page.waitForFunction((id) => window.__editor.getSnapshot().editingId === id, { timeout: 30000 }, id)
    await h.ready(page)
    await h.sleep(500)
    const spot = await h.rectOf(page, '.g-spot')
    const tip = await h.rectOf(page, '.g-tip')
    return h.union(spot, tip)
  }
  // 学籍番号は、ログインしたアカウント（00zz0123@…）から自動で入っている。案内は氏名から
  const nameFocus = await field('basic:name')
  rec.mark('name', { focus: h.union(nameFocus, await h.blockRect(page, 'basic:studentId')) })
  await h.sleep(3400)
  await h.typeSlow(page, '文化　花子')
  await h.sleep(900)
  await page.keyboard.press('Enter')
  rec.mark('subtitle', { focus: await field('basic:subtitleInput') })
  await h.sleep(1200)
  await h.typeSlow(page, 'シンドバッド')
  await h.sleep(900)
  await page.keyboard.press('Enter')

  // できた表紙
  await page.waitForSelector('.guide.step-done')
  await h.ready(page)
  await h.sleep(500)
  rec.mark('done', { focus: h.union(await h.rectOf(page, CUR), await h.rectOf(page, '.g-tip')) })
  await h.sleep(3200)
  await h.clickEl(page, '.g-actions button', '閉じる', { pause: 700 })

  // 指差し確認
  await page.waitForSelector('.tour .tour-tip', { timeout: 20000 })
  await h.sleep(600)
  rec.mark('tour', { full: true })
  for (let i = 0; i < 10; i++) {
    const next = await page.evaluate(() => document.querySelector('.tour-acts .next')?.textContent ?? '')
    if (next.includes('おわり')) {
      rec.mark('end', { full: true })
      await h.sleep(3600)
      await h.clickEl(page, '.tour-acts .next', null, { pause: 500 })
      break
    }
    await h.sleep(i === 0 ? 2600 : 1500)
    await h.clickEl(page, '.tour-acts .next', null, { pause: 350 })
    await h.sleep(300)
  }
  await h.sleep(800)
}
