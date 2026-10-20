// 待つ間の表示（依頼者の要望 2026-10-20「保存中に何も表示がなく待たされるので不安になる」）を確かめる道具。
// waiting.mjs（学生用ツール・ドライブ）と check.mjs（提出前チェック）で使う。
// - watchBusy：押したボタン（selector）の中に、回る印（.busy-spin）が出た時刻・そのときボタンが押せないか・言葉・消えた時刻を、ページの中で記録する
//   （押した時刻は、startBusy で決めるか、ファイルを選んだとき（change）に自動で決まる。とても速く終わっても、出たことを見落とさない）
// - slowDown：ファイル・写真を読む処理を、わざと遅くする（待つ間の画面の写真を撮る・「数秒かかることがあります」を確かめるため。ふだんは 0）

/** ファイル（Blob・File）を読む・写真を開く処理を、window.__slowMs だけ遅くする（ページを開く前に呼ぶ） */
export const slowDown = (page) =>
  page.evaluateOnNewDocument(() => {
    const later = (p) => {
      const ms = window.__slowMs || 0
      return ms ? p.then((v) => new Promise((resolve) => setTimeout(() => resolve(v), ms))) : p
    }
    for (const name of ['arrayBuffer', 'text']) {
      const original = Blob.prototype[name]
      Blob.prototype[name] = function (...args) {
        return later(original.apply(this, args))
      }
    }
    const bitmap = window.createImageBitmap
    window.createImageBitmap = function (...args) {
      return later(bitmap.apply(this, args))
    }
    // 写真を選ぶ画面（ページに置かない入力欄）で選んだ時刻も、押した時刻として記録する
    const click = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file') this.addEventListener('change', () => window.__busy && (window.__busy.t0 ??= performance.now()), { once: true, capture: true })
      return click.call(this)
    }
  })

/**
 * 測るとき（WAIT_MEASURE=6 などで動かす）：わざと遅くはせず、CPU を何倍も遅くして（6 なら6倍）、遅いスマホに近い速さで、
 * 押してから終わるまでの時間（確かめの横の dur）を測る。このときは「2秒を過ぎたら」の確かめは当てにならない（測るためだけに使う）
 */
export const MEASURE = Number(process.env.WAIT_MEASURE || 0)

/** 遅くする長さ（ミリ秒。0 で元に戻す。測るときは遅くしない） */
export const setSlow = (page, ms) => page.evaluate((ms) => (window.__slowMs = ms), MEASURE ? 0 : ms)

/** 測るとき（MEASURE）だけ、このページの CPU を遅くする */
export const throttle = async (page) => {
  if (MEASURE) await (await page.createCDPSession()).send('Emulation.setCPUThrottlingRate', { rate: MEASURE })
}

/**
 * selector の要素の中（その要素自身でも）に、回る印が出るのを見張る。
 * text：あれば、その言葉を含む要素だけを見る（同じ形のボタンが並ぶとき）
 */
export const watchBusy = (page, selector, text = null) =>
  page.evaluate(
    (selector, text) => {
      window.__busy?.observer.disconnect()
      const w = { t0: null, at: null, disabled: null, label: '', end: null, slowAt: null, slow: '', observer: null }
      window.__busy = w
      document.addEventListener('change', () => (w.t0 ??= performance.now()), { capture: true, once: true })
      // 回る印：ボタンの中の .busy-spin と、ログインの窓の「ドライブの原稿を確かめています…」（.login-spin）
      const spinning = (x) => x.matches('.busy-spin, .login-spin') || !!x.querySelector('.busy-spin, .login-spin')
      const look = () => {
        const all = [...document.querySelectorAll(selector)].filter((el) => !text || el.textContent.includes(text) || spinning(el))
        const el = all.find(spinning)
        if (el && w.at === null) {
          w.at = performance.now()
          const button = el.closest('button') ?? el.querySelector('button')
          w.disabled = button ? button.disabled : null
          w.label = el.textContent.trim()
        }
        if (!el && w.at !== null && w.end === null) w.end = performance.now()
        const slow = [...document.querySelectorAll('.slow-note.on, .wait-toast small, .d-busy .nb')].map((x) => x.textContent).join('|')
        if (slow && w.slowAt === null) {
          w.slowAt = performance.now()
          w.slow = slow
        }
      }
      w.observer = new MutationObserver(look)
      w.observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true })
    },
    selector,
    text,
  )

/** 押した時刻を、いまにする（このあとすぐ押す） */
export const startBusy = (page) => page.evaluate(() => (window.__busy.t0 = performance.now()))

/** selector を押す（押した時刻も記録する。text：その言葉を含むボタン） */
export const clickBusy = (page, selector, text = null) =>
  page.evaluate(
    (selector, text) => {
      const el = [...document.querySelectorAll(selector)].find((x) => !text || x.textContent.includes(text))
      window.__busy.t0 = performance.now()
      el.click()
    },
    selector,
    text,
  )

/**
 * 見張った結果：delay（押してから回る印が出るまで ms。出なければ null）・disabled（そのときボタンが押せないか）・label（ボタンの言葉）・
 * dur（押してから印が消えるまで ms。まだなら、いままで）・slow（2秒を過ぎて出たひとこと）・slowAfter（押してから、そのひとことが出るまで ms）
 */
export const busyResult = (page) =>
  page.evaluate(() => {
    const w = window.__busy
    const round = (v) => (v === null ? null : Math.round(v))
    return {
      delay: w.at === null || w.t0 === null ? null : round(Math.max(0, w.at - w.t0)),
      disabled: w.disabled,
      label: w.label,
      dur: w.t0 === null ? null : round((w.end ?? performance.now()) - w.t0),
      ended: w.end !== null,
      slow: w.slow,
      slowAfter: w.slowAt === null || w.t0 === null ? null : round(w.slowAt - w.t0),
    }
  })

/** 回る印が消える（終わる）まで待つ */
export const busyDone = (page, timeout = 60000) => page.waitForFunction(() => window.__busy?.end !== null && window.__busy?.end !== undefined, { timeout, polling: 50 })
