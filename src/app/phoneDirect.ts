import { useEffect } from 'react'

/**
 * スマホで紙面に直接書く（Google ドキュメントのアプリのように、下の書く欄を出さずに、紙面の上でそのまま書く）。
 * 2026-10-20 の試作（?direct=1）を依頼者が試して決めた、スマホのふつうの書き方（だれでも、印なしでこうなる）。
 *
 * 予備：リンクの ?direct=0 で、その端末だけ、前の「下から出る書く欄」で書くようにできる（その端末に覚える）。
 * 紙面で直接書くと、うまく動かないスマホ（文字入力・キーボードの癖など）が見つかったときの逃げ道として残しておく。
 * ?direct=1 で、ふつう（紙面で直接書く）に戻す（覚えていたものを消す）。印は、読んだらアドレスから外す
 */

/** ?direct=0 で、下の書く欄で書くことにした端末の覚え（'1'） */
const SHEET_KEY = 'sotsugyo-seisaku-report-phone-sheet'
/**
 * 試作のときの覚え（'1'＝試作を使う。試作をやめた端末にはない）。もう使わない。
 * 試作をやめていた端末が、下の書く欄のままにならないよう、見つけたら消すだけ（下の書く欄にするのは ?direct=0 だけ）
 */
const OLD_KEY = 'sotsugyo-seisaku-report-phone-direct'

/** この端末のスマホで、紙面に直接書くか（アドレスに ?direct=0・?direct=1 があれば、それを覚えてから答える） */
export function readPhoneDirect(): boolean {
  const flag = new URLSearchParams(location.search).get('direct')
  try {
    localStorage.removeItem(OLD_KEY)
  } catch {
    // 覚えを読めない端末（プライベートブラウズなど）
  }
  if (flag === '0' || flag === '1') {
    try {
      if (flag === '0') localStorage.setItem(SHEET_KEY, '1')
      else localStorage.removeItem(SHEET_KEY)
    } catch {
      // 覚えておけなくても、いまの画面では切り替わる
    }
    // ほかの印（?nodrive など）は、書いてあったとおりに残す
    const rest = location.search.slice(1).split('&').filter((part) => part !== '' && part.split('=')[0] !== 'direct')
    history.replaceState(history.state, '', `${location.pathname}${rest.length ? `?${rest.join('&')}` : ''}${location.hash}`)
  }
  try {
    return localStorage.getItem(SHEET_KEY) !== '1'
  } catch {
    // 覚えておけない：このときだけ、アドレスの印で決める
    return flag !== '0'
  }
}

/** iPhone・iPad（Safari）か（iPad は「Mac」と名乗るので、指で触れるかで見分ける） */
function isIos(): boolean {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

/**
 * 紙面で直接書く間、iPhone で、書く欄に入ったときに画面が勝手に拡大されないようにする。
 * iPhone は、16px より小さい字の書く欄に入ると、画面を拡大する。紙面に重ねた書く欄の字は紙面と同じ大きさ（拡大して 10px ほど）なので、
 * 書き始めるたびに画面が拡大され、紙面が画面からはみ出していた。画面の設定（viewport）に maximum-scale=1 を足すと、この拡大は起きない。
 * 紙面を2本の指で広げる拡大は、画面全体ではなく、紙面だけをこのツールが拡大する（editor/pinchZoom.ts）。
 * Android（Chrome）は、書く欄に入っても拡大しないので、変えない
 */
export function useNoFocusZoom(on: boolean): void {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    if (!on || !meta || !isIos()) return
    const before = meta.content
    meta.content = `${before}, maximum-scale=1`
    return () => {
      meta.content = before
    }
  }, [on])
}
