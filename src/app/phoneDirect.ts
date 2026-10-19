import { useEffect } from 'react'

/**
 * 試作：スマホで紙面に直接書く（Google ドキュメントのアプリのように、下の書く欄を出さずに、紙面の上でそのまま書く）。
 * 依頼者が自分のスマホで、今のやり方（下から出る書く欄）と比べるためのもの。学生にはリンクを配らない。
 * - リンクの ?direct=1 で入り、その端末に覚える（読み込み直しても・ホーム画面のアイコンから開いても続く）
 * - ?direct=0、または ≡ のメニューの「下の書く欄に戻す」でやめる
 * 印（?direct=…）は、読んだらアドレスから外す（メニューでやめたあと、読み込み直して、また入らないように）
 */

const KEY = 'sotsugyo-seisaku-report-phone-direct'

/** この端末で試作を使っているか（アドレスに ?direct=1・?direct=0 があれば、それを覚えてから答える） */
export function readPhoneDirect(): boolean {
  const flag = new URLSearchParams(location.search).get('direct')
  if (flag === '1' || flag === '0') {
    rememberPhoneDirect(flag === '1')
    // ほかの印（?nodrive など）は、書いてあったとおりに残す
    const rest = location.search.slice(1).split('&').filter((part) => part !== '' && part.split('=')[0] !== 'direct')
    history.replaceState(history.state, '', `${location.pathname}${rest.length ? `?${rest.join('&')}` : ''}${location.hash}`)
  }
  try {
    const saved = localStorage.getItem(KEY)
    return saved === null ? flag === '1' : saved === '1'
  } catch {
    // 覚えておけない（プライベートブラウズなど）：このときだけ、アドレスの印で決める
    return flag === '1'
  }
}

/** 試作を使う・やめることを、この端末に覚える */
export function rememberPhoneDirect(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // 覚えておけなくても、いまの画面では切り替わる
  }
}

/** iPhone・iPad（Safari）か（iPad は「Mac」と名乗るので、指で触れるかで見分ける） */
function isIos(): boolean {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

/**
 * 試作の間、iPhone で、書く欄に入ったときに画面が勝手に拡大されないようにする。
 * iPhone は、16px より小さい字の書く欄に入ると、画面を拡大する。紙面に重ねた書く欄の字は紙面と同じ大きさ（拡大して 10px ほど）なので、
 * 書き始めるたびに画面が拡大され、紙面が画面からはみ出していた。画面の設定（viewport）に maximum-scale=1 を足すと、この拡大は起きない
 * （iPhone は、指で広げる拡大は、この設定があってもできる）。
 * Android（Chrome）は、書く欄に入っても拡大しないので、変えない（指で広げる拡大を止めないため）
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
