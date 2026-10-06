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

function readCache(key = CACHE_KEY): YearConfig | null {
  try {
    const cached = JSON.parse(localStorage.getItem(key) ?? 'null')
    return usable(cached) ? cached : null
  } catch {
    return null
  }
}

/** 配信の窓口から読む（year を省くと公開中の年度）。読めて使える設定なら、このブラウザに控える */
async function fetchConfig(apiUrl: string | undefined, year: number | null, cacheKey: string): Promise<YearConfig | null> {
  for (let attempt = 0; apiUrl && attempt < ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${apiUrl}?action=config${year ? `&year=${year}` : ''}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      const body = await response.json()
      if (body?.ok && usable(body.config) && (!year || body.config.fiscalYear === year)) {
        try {
          localStorage.setItem(cacheKey, JSON.stringify(body.config))
        } catch {
          // 控えを残せなくても、今回は読み込んだ設定で動く
        }
        return body.config
      }
    } catch {
      // 通信できないときは試し直し、それでもだめなら控えか初期値を使う
    }
  }
  return null
}

export async function loadConfig(apiUrl = import.meta.env.VITE_CONFIG_API_URL as string | undefined): Promise<{ config: YearConfig; source: ConfigSource }> {
  const remote = await fetchConfig(apiUrl, null, CACHE_KEY)
  if (remote) return { config: remote, source: 'remote' }
  const cached = readCache()
  if (cached) return { config: cached, source: 'cache' }
  return { config: currentConfig, source: 'bundled' }
}

/**
 * 指定した年度の設定（公開中・終了した年度）。原稿は、書き始めた年度の設定で開く（新年度を公開しても、
 * 前年度の学生の表紙が新年度の題目・教員に変わらないように）。読めなければ null
 */
export async function loadYearConfig(year: number, apiUrl = import.meta.env.VITE_CONFIG_API_URL as string | undefined): Promise<YearConfig | null> {
  const key = `${CACHE_KEY}:${year}`
  return (await fetchConfig(apiUrl, year, key)) ?? readCache(key) ?? (currentConfig.fiscalYear === year ? currentConfig : null)
}
