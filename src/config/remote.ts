import { currentConfig } from '.'
import type { YearConfig } from './types'
import { validateConfig } from './validate'

/**
 * 管理ページで公開された年度設定を読み込む。
 * 配信の窓口（Apps Script のウェブアプリ）の URL は、ビルド時に VITE_CONFIG_API_URL で渡す。
 * 読み込めないときは、前回読み込んだ設定（このブラウザに控えたもの）、それもなければアプリに同梱した初期値で動く。
 */

export type ConfigSource = 'remote' | 'cache' | 'bundled'

const CACHE_KEY = 'sotsugyo-seisaku-report-config'
/** 配信の窓口は、しばらく使われていないと返事に数秒〜10秒ほどかかることがあるため、長めに待ち、1回だけ試し直す */
const TIMEOUT_MS = 15000
const ATTEMPTS = 2

function usable(config: unknown): config is YearConfig {
  if (!config || typeof config !== 'object') return false
  try {
    return validateConfig(config as YearConfig).every((p) => p.severity !== 'error')
  } catch {
    return false
  }
}

function readCache(): YearConfig | null {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null')
    return usable(cached) ? cached : null
  } catch {
    return null
  }
}

export async function loadConfig(apiUrl = import.meta.env.VITE_CONFIG_API_URL as string | undefined): Promise<{ config: YearConfig; source: ConfigSource }> {
  for (let attempt = 0; apiUrl && attempt < ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${apiUrl}?action=config`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      const body = await response.json()
      if (body?.ok && usable(body.config)) {
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(body.config))
        } catch {
          // 控えを残せなくても、今回は読み込んだ設定で動く
        }
        return { config: body.config, source: 'remote' }
      }
    } catch {
      // 通信できないときは試し直し、それでもだめなら控えか初期値を使う
    }
  }
  const cached = readCache()
  if (cached) return { config: cached, source: 'cache' }
  return { config: currentConfig, source: 'bundled' }
}
