import { currentConfig } from '.'
import type { YearConfig } from './types'
import { repairConfig, validateConfig } from './validate'

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

/**
 * 使える設定にして返す（使えなければ null）。崩れたコースのひな形・お知らせなどは外して使う
 * （1つのコースのひな形が崩れていても、設定全体は捨てない。そのコースは標準のひな形になる）
 */
function usable(config: unknown): YearConfig | null {
  if (!config || typeof config !== 'object') return null
  try {
    const repaired = repairConfig(config as YearConfig)
    return validateConfig(repaired).every((p) => p.severity !== 'error') ? repaired : null
  } catch {
    return null
  }
}

function readCache(key = CACHE_KEY): YearConfig | null {
  try {
    return usable(JSON.parse(localStorage.getItem(key) ?? 'null'))
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
      const config = body?.ok ? usable(body.config) : null
      if (config && (!year || config.fiscalYear === year)) {
        try {
          localStorage.setItem(cacheKey, JSON.stringify(config))
        } catch {
          // 控えを残せなくても、今回は読み込んだ設定で動く
        }
        return config
      }
    } catch {
      // 通信できないときは試し直し、それでもだめなら控えか初期値を使う
    }
  }
  return null
}

/**
 * 設定を読み込み始める（待たずに返す）。cached：このブラウザの控え（前に読み込んだ設定。なければ null）、
 * remote：窓口から読んだ設定（読めなければ null。読めたら控えも新しくする）。year を省くと公開中の年度。
 * 学生用ツールは、2回目からは控えの設定ですぐ開き、窓口の返事はあとで確かめる（窓口の返事には1〜数秒かかり、開くたびに待たせていたため。App.tsx）
 */
export function startConfigLoad(year: number | null = null, apiUrl = import.meta.env.VITE_CONFIG_API_URL as string | undefined): { cached: YearConfig | null; remote: Promise<YearConfig | null> } {
  const key = year ? `${CACHE_KEY}:${year}` : CACHE_KEY
  // 控えは、窓口の返事で書き換わる前に読む
  const cached = readCache(key)
  return { cached, remote: fetchConfig(apiUrl, year, key) }
}

/** 2つの設定が同じか（窓口から読んだ設定が、控えと変わっていないか） */
export function sameConfig(a: YearConfig, b: YearConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
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
