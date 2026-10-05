import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { currentConfig } from '../config'
import { checkReport } from '../checker/reportChecks'
import { backupFileName, BackupFormatError, createBackup, readBackup } from './backup'
import { demoReport } from './demoReport'
import { fitFigureSize, printDpi } from './images'
import { migrateReport, UnsupportedDataError } from './migrate'
import { createReport } from './newReport'
import { listSnapshots, loadReport, putImage, getImage, saveReport, saveSnapshot, usedImageIds } from './storage'
import { DATA_FORMAT_VERSION } from './types'

describe('createReport', () => {
  it('テンプレートの章立てで始まり、未入力の項目をチェックが指摘する', () => {
    const report = createReport(currentConfig)
    expect(report.body.map((c) => c.title)).toEqual(['企画・立案', '制作過程', 'まとめ'])
    // コースが1つだけのときは最初から選ばれている
    expect(report.basicInfo.courseId).toBe('film-stage-costume')
    const ids = checkReport(report, currentConfig).map((f) => f.ruleId)
    expect(ids).toEqual(expect.arrayContaining(['required-field', 'abstract-length', 'swatch-image', 'photos-required']))
    // 使用素材の紹介文は表1を参照している
    expect(ids).not.toContain('table-unreferenced')
  })
})

describe('migrateReport', () => {
  it('欠けている項目を既定値で補う', () => {
    const r = migrateReport({ formatVersion: 1, body: [], basicInfo: { name: '文化 花子' } })
    expect(r.basicInfo).toEqual({ studentId: '', name: '文化 花子', courseId: '', subtitleInput: '' })
    expect(r.workPhotos).toEqual({ layout: 1, imageIds: [] })
  })

  it('新しい版のデータや報告書でないデータは読み込まない', () => {
    expect(() => migrateReport({ formatVersion: DATA_FORMAT_VERSION + 1, body: [] })).toThrow(UnsupportedDataError)
    expect(() => migrateReport({ hello: 1 })).toThrow(UnsupportedDataError)
  })
})

describe('バックアップ', () => {
  it('報告書と写真を書き出して、元どおりに読み込める', async () => {
    const report = demoReport()
    const blob = new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'image/jpeg' })
    const text = await createBackup(report, [{ id: 'img1', blob, widthPx: 10, heightPx: 20 }], '2026-10-05T00:00:00Z')
    const restored = readBackup(text)
    expect(restored.report).toEqual(report)
    expect(restored.savedAt).toBe('2026-10-05T00:00:00Z')
    expect(restored.images[0]).toMatchObject({ id: 'img1', widthPx: 10, heightPx: 20 })
    expect([...new Uint8Array(await restored.images[0].blob.arrayBuffer())]).toEqual([1, 2, 3, 250])
  })

  it('別のファイルは読み込まない', () => {
    expect(() => readBackup('not json')).toThrow(BackupFormatError)
    expect(() => readBackup('{"kind":"other"}')).toThrow(BackupFormatError)
  })

  it('ファイル名に学籍番号と日時が入る', () => {
    expect(backupFileName(demoReport(), new Date(2026, 9, 5, 14, 32))).toBe('卒業制作報告書_バックアップ_23FA0123_20261005-1432.json')
  })
})

describe('自動保存（IndexedDB）', () => {
  it('報告書と写真を保存して読み込める', async () => {
    const report = demoReport()
    await saveReport(report)
    expect(await loadReport()).toEqual(report)
    await putImage({ id: 'x', blob: new Blob(['a']), widthPx: 1, heightPx: 1 })
    expect((await getImage('x'))?.widthPx).toBe(1)
  })

  it('控えは新しい順に最大20件残る', async () => {
    for (let i = 0; i < 22; i++) await saveSnapshot(demoReport(), `2026-10-05T00:00:${String(i).padStart(2, '0')}Z`)
    const snapshots = await listSnapshots()
    expect(snapshots).toHaveLength(20)
    expect(snapshots[0].savedAt).toBe('2026-10-05T00:00:21Z')
  })

  it('報告書で使っている写真の ID を集める', () => {
    const report = { ...demoReport(), workPhotos: { layout: 2 as const, imageIds: ['ph1'] } }
    expect(usedImageIds(report)).toEqual(['ph1'])
  })
})

describe('写真の大きさ', () => {
  it('縦横比を保って 100mm 四方に収める', () => {
    expect(fitFigureSize({ widthPx: 1200, heightPx: 1600 }, 100)).toEqual({ widthMm: 75, heightMm: 100 })
    expect(fitFigureSize({ widthPx: 1600, heightPx: 800 }, 100)).toEqual({ widthMm: 100, heightMm: 50 })
  })

  it('印刷したときの解像度を計算する', () => {
    expect(Math.round(printDpi({ widthPx: 1181, heightPx: 1181 }, 100, 100))).toBe(300)
  })
})
