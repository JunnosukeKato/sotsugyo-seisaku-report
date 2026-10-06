const DEVICE_KEY = 'sotsugyo-seisaku-report-device'
/** ブラウザに覚えておけないときの、このタブだけの印 */
const tabId = crypto.randomUUID()

/**
 * この端末（ブラウザ）の印。ドライブの原稿を最後に保存したのがこの端末かを見分ける
 * （送れたのに返事が届かなかったとき、自分の保存を「別の端末の保存」と間違えないように）
 */
export function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch {
    return tabId
  }
}

/** この端末の名前（例：iPhone・Safari）。どの端末で保存した原稿かを見せるのに使う */
export function deviceName(): string {
  const ua = navigator.userAgent
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Macintosh/.test(ua)
            ? 'Mac'
            : 'その他'
  const browser = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'その他'
  return `${device}・${browser}`
}
