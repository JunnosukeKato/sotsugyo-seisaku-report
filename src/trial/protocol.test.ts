import { describe, expect, it } from 'vitest'
import { currentConfig, type YearConfig } from '../config'
import { scoped, trialMode } from '../model/scope'
import { FROM_ADMIN, newNonce } from '../template/protocol'
import { DEV_TRIAL_SAMPLE } from './devSample'
import { isTrialMessage, readTrialPayload, readTrialSample, sampleReport, trialToolUrls } from './protocol'

const sample = () => JSON.parse(JSON.stringify(DEV_TRIAL_SAMPLE))

describe('お試し（学生の画面を試す）のやり取り', () => {
  it('お試しで開く URL は、ツールの URL に ?trial=1 だけを付ける（前の ? や # は外す）', () => {
    expect(trialToolUrls('https://example.github.io/tool/?x=1#a')).toEqual({ href: 'https://example.github.io/tool/?trial=1', origin: 'https://example.github.io' })
  })

  it('見本の原稿を確かめる：写真は、決まった形の ID と public/trial/ の .jpg の名前だけ', () => {
    const ok = readTrialSample(sample())
    expect(ok?.report.basicInfo.name).toBe('文化　花子')
    expect(ok?.images).toEqual(DEV_TRIAL_SAMPLE.images)
    for (const file of ['../secret.jpg', 'a/b.jpg', 'photo.png', 'https://evil.example/x.jpg', '']) {
      const bad = sample()
      bad.images[0].file = file
      expect(readTrialSample(bad), file).toBeNull()
    }
    const badId = sample()
    badId.images[0].id = 'g design'
    expect(readTrialSample(badId)).toBeNull()
    // 取り込む大きさが変な値なら、ふつうの大きさ
    const big = sample()
    big.images[0].maxPx = 99999
    expect(readTrialSample(big)?.images[0].maxPx).toBe(1600)
    expect(readTrialSample({ report: 'x', images: [] })).toBeNull()
    expect(readTrialSample(null)).toBeNull()
  })

  it('受け取ったもの：使える年度の設定と、見本の原稿がそろっていれば受け取る', () => {
    expect(readTrialPayload({ config: currentConfig, sample: sample() })?.config.fiscalYear).toBe(currentConfig.fiscalYear)
    expect(readTrialPayload({ config: { ...currentConfig, courses: 'x' }, sample: sample() })).toBeNull()
    expect(readTrialPayload({ config: currentConfig })).toBeNull()
  })

  it('見本の原稿を年度の設定に合わせる：年度・コース（なければ、いちばん上の表示しているコース）。開くたびに新しい写し', () => {
    const payload = readTrialPayload({ config: currentConfig, sample: sample() })!
    const report = sampleReport(payload)
    expect(report.fiscalYear).toBe(currentConfig.fiscalYear)
    expect(report.basicInfo.courseId).toBe('film-stage-costume')
    report.body[0].blocks.length = 0
    expect(sampleReport(payload).body[0].blocks.length).toBeGreaterThan(0)

    const other: YearConfig = { ...currentConfig, courses: [{ ...currentConfig.courses[0], id: 'hidden', hidden: true }, { ...currentConfig.courses[1], id: 'only' }] }
    expect(sampleReport({ ...payload, config: other }).basicInfo.courseId).toBe('only')
  })

  it('ツールが受け取る知らせは、管理ページの印・trial・決まった形の合言葉のものだけ', () => {
    const nonce = newNonce()
    expect(isTrialMessage({ source: FROM_ADMIN, type: 'trial', nonce, payload: {} })).toBe(true)
    expect(isTrialMessage({ source: FROM_ADMIN, type: 'init', nonce, payload: {} })).toBe(false)
    expect(isTrialMessage({ source: 'someone', type: 'trial', nonce, payload: {} })).toBe(false)
    expect(isTrialMessage({ source: FROM_ADMIN, type: 'trial', nonce: 'short', payload: {} })).toBe(false)
  })

  it('ふだん（?trial=1 でない）は、この端末に保存する名前を変えない', () => {
    expect(trialMode).toBe(false)
    expect(scoped('sotsugyo-seisaku-report')).toBe('sotsugyo-seisaku-report')
  })
})
