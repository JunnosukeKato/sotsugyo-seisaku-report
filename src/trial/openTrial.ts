import type { YearConfig } from '../config'
import { importImage } from '../model/images'
import { getImage, loadReport, loadValue, putImage, saveReport, saveValue } from '../model/storage'
import type { Report } from '../model/types'
import { isAllowedParentOrigin } from '../template/protocol'
import { FROM_TRIAL, isTrialMessage, readTrialPayload, sampleReport, type TrialAck, type TrialImage, type TrialPayload } from './protocol'

/**
 * お試し（?trial=1）のツールの側（やり取りの決まりは protocol.ts）。
 * 管理ページから受け取った年度の設定と見本の原稿を、このブラウザのお試しの入れ物（src/model/scope.ts）に置き、そこから開く。
 * 2回目から（読み込み直した・あとで開いた）は、置いてあるもので、すぐ開く（管理ページを待たない）
 */

/** 受け取ったものを置く名前（原稿の入れ物の中。原稿とは別の名前） */
const TRIAL_KEY = 'trial'
/** はじめて開いたとき、管理ページから受け取るのを待つ時間 */
const WAIT_MS = 30000

let received: TrialPayload | null = null
const listeners = new Set<(payload: TrialPayload) => void>()

/** お試しが開けない（管理ページから開いていない・受け取れなかった） */
export class TrialMissingError extends Error {
  constructor() {
    super('お試しの画面は、管理ページの「学生の画面を試す」から開いてください')
  }
}

/**
 * 聞き始める（読み込んですぐ：main.tsx。管理ページは、返事があるまで送り直す）。
 * 受け取るのは、このタブを開いた窓が、決まった場所から送った、形の正しい「trial」だけ。受け取ったら、その場所にだけ返事をする
 */
export function startTrialBridge(dev: boolean): void {
  window.addEventListener('message', (e: MessageEvent) => {
    const opener = window.opener as Window | null
    if (!opener || e.source !== opener || !isAllowedParentOrigin(e.origin, dev) || !isTrialMessage(e.data)) return
    const payload = readTrialPayload(e.data.payload)
    if (!payload) return
    opener.postMessage({ source: FROM_TRIAL, type: 'ack', nonce: e.data.nonce } satisfies TrialAck, e.origin)
    // 送り直された同じものは、1回だけ受け取る
    if (received) return
    received = payload
    for (const listener of listeners) listener(payload)
  })
}

/** 管理ページから受け取るのを待つ（管理ページから開いていない・待つ時間を過ぎたら null） */
function waitForPayload(ms: number): Promise<TrialPayload | null> {
  if (received) return Promise.resolve(received)
  if (!window.opener) return Promise.resolve(null)
  return new Promise((resolve) => {
    const done = (payload: TrialPayload | null) => {
      clearTimeout(timer)
      listeners.delete(done)
      resolve(payload)
    }
    const timer = window.setTimeout(() => done(null), ms)
    listeners.add(done)
  })
}

/** 見本の写真を、この入れ物に置く（まだないものだけ。ツールの public/trial/ から読む） */
async function storeImages(images: TrialImage[]): Promise<void> {
  await Promise.all(
    images.map(async ({ id, file, maxPx }) => {
      if (await getImage(id)) return
      const response = await fetch(`${import.meta.env.BASE_URL}trial/${file}`)
      if (!response.ok) throw new Error(`見本の写真（${file}）を読み込めませんでした`)
      await putImage(await importImage(await response.blob(), id, maxPx))
    }),
  )
}

/**
 * お試しを開く準備：受け取った（置いてある）年度の設定を返し、原稿がまだなければ見本の原稿を置く。
 * 年度の設定は、学生のツールの読み込み（config/remote.ts の startConfigLoad）と同じ形で返す。開けなければ TrialMissingError
 */
export async function openTrial(): Promise<{ cached: YearConfig; remote: Promise<YearConfig | null> }> {
  // 置いてあるものも、形を確かめ直す（前の版のツールで置いた原稿も、今の形にする）
  const stored = readTrialPayload(await loadValue(TRIAL_KEY))
  // あとから届いたもの（管理ページから開き直した）は、次に開くときと「見本に戻す」のために置いておく
  listeners.add((payload) => void saveValue(TRIAL_KEY, payload))
  const payload = stored ?? (await waitForPayload(WAIT_MS))
  if (!payload) throw new TrialMissingError()
  if (!stored) await saveValue(TRIAL_KEY, payload)
  await storeImages(payload.sample.images)
  if (!(await loadReport())) await saveReport(sampleReport(payload))
  return { cached: payload.config, remote: Promise.resolve(payload.config) }
}

/** 「見本に戻す」：試した内容を消して、最初の見本の原稿にする（写真も、なければ置き直す） */
export async function freshSample(): Promise<Report> {
  const payload = readTrialPayload(await loadValue(TRIAL_KEY)) ?? received
  if (!payload) throw new TrialMissingError()
  await storeImages(payload.sample.images)
  return sampleReport(payload)
}
