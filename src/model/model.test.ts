import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { currentConfig, type YearConfig } from '../config'
import { validateConfig } from '../config/validate'
import { checkReport } from '../checker/reportChecks'
import { applyCourseTemplate, bodyFromTemplate, bodyWritten, courseTemplate, DEFAULT_TEMPLATE } from './template'
import { backupFileName, BackupFormatError, createBackup, readBackup } from './backup'
import { demoReport } from './demoReport'
import { fitFigureSize, printDpi } from './images'
import { migrateReport, UnsupportedDataError } from './migrate'
import { createReport } from './newReport'
import { listSnapshots, loadReport, putImage, getImage, saveReport, saveSnapshot, usedImageIds } from './storage'
import { DATA_FORMAT_VERSION } from './types'

describe('createReport', () => {
  it('コースの下書きのひな形で始まり、未入力の項目をチェックが指摘する', () => {
    const report = createReport(currentConfig)
    expect(report.body.map((c) => c.title)).toEqual(['企画・立案', '制作過程', 'まとめ'])
    // コースが1つだけのときは最初から選ばれている
    expect(report.basicInfo.courseId).toBe('film-stage-costume')
    // 書くことの説明・図の枠・素材表がひな形どおりに入る
    const blocks = report.body[0].blocks
    expect(blocks.map((b) => b.type)).toEqual(['subheading', 'paragraph', 'subheading', 'paragraph', 'figureRow', 'subheading', 'paragraph', 'materialTable'])
    expect(blocks[1].type === 'paragraph' && blocks[1].hint).toBe('担当したキャラクターの性格や、物語の中での役割を書く')
    expect(blocks[4].type === 'figureRow' && blocks[4].figures[0]).toMatchObject({ imageId: '', caption: 'デザイン画' })
    expect(report.abstract.paragraphs[0].hint).toContain('本制作報告書は、卒業イベント')
    const ids = checkReport(report, currentConfig).map((f) => f.ruleId)
    expect(ids).toEqual(expect.arrayContaining(['required-field', 'figure-image', 'swatch-image', 'photos-required', 'paragraph-empty']))
    // 抄録は、先生の許可が出てから書く：書き始めるまでは字数を確かめず、まだ書いていないことだけを知らせる
    expect(report.abstract.started).toBe(false)
    expect(ids).toContain('abstract-not-started')
    expect(ids).not.toContain('abstract-length')
    const started = { ...report, abstract: { ...report.abstract, started: true } }
    expect(checkReport(started, currentConfig).map((f) => f.ruleId)).toContain('abstract-length')
  })
})

describe('下書きのひな形', () => {
  const twoCourses: YearConfig = {
    ...currentConfig,
    courses: [
      currentConfig.courses[0],
      { id: 'other', name: 'ほかのコース', advisors: ['文化 太郎'], subtitleTemplate: '―{input}―', template: [{ type: 'chapter', title: '概要' }, { type: 'paragraph', hint: '概要を書く' }] },
      { id: 'plain', name: 'ひな形のないコース', advisors: ['文化 太郎'], subtitleTemplate: '―{input}―' },
    ],
  }

  it('コースが2つ以上なら、コースは未選択で始まる（標準のひな形）', () => {
    const report = createReport(twoCourses)
    expect(report.basicInfo.courseId).toBe('')
    expect(report.body.map((c) => c.title)).toEqual(DEFAULT_TEMPLATE.filter((b) => b.type === 'chapter').map((b) => (b.type === 'chapter' ? b.title : '')))
  })

  it('ひな形のないコースは、標準のひな形を使う', () => {
    expect(courseTemplate(twoCourses, 'plain')).toBe(DEFAULT_TEMPLATE)
    expect(courseTemplate(twoCourses, 'other')).toHaveLength(2)
  })

  it('大見出しより前の部品はまとめ、中身のない大見出しには空の段落を入れる', () => {
    const body = bodyFromTemplate([{ type: 'paragraph', hint: 'はじめに' }, { type: 'chapter', title: 'A' }, { type: 'chapter', title: 'B' }, { type: 'paragraph', hint: 'b' }])
    expect(body.map((c) => [c.title, c.blocks.length])).toEqual([['', 1], ['A', 1], ['B', 1]])
  })

  it('ひな形のままなら「書き始めていない」、書き足したら「書き始めた」とみなす', () => {
    const report = createReport(twoCourses, 'other')
    expect(bodyWritten(report, twoCourses)).toBe(false)
    const p = report.body[0].blocks[0]
    const written = { ...report, body: [{ ...report.body[0], blocks: [{ ...p, content: [{ type: 'text' as const, text: '書いた' }] }] }] }
    expect(bodyWritten(written, twoCourses)).toBe(true)
  })

  it('コースを変えると、本文をそのコースのひな形に入れ替え、表紙と書いた抄録は残す', () => {
    const report = { ...createReport(twoCourses, 'other'), basicInfo: { studentId: '23FA0001', name: '文化　花子', courseId: 'other', subtitleInput: 'X' } }
    const changed = applyCourseTemplate(report, twoCourses, 'film-stage-costume')
    expect(changed.basicInfo).toMatchObject({ studentId: '23FA0001', name: '文化　花子', courseId: 'film-stage-costume' })
    expect(changed.body.map((c) => c.title)).toEqual(['企画・立案', '制作過程', 'まとめ'])
    expect(changed.abstract.paragraphs[0].hint).toContain('卒業イベント')
  })

  it('ひな形の誤り（大見出しから始まらない・名前が空）を、管理ページの入力チェックで指摘する', () => {
    const bad: YearConfig = { ...twoCourses, courses: [{ ...twoCourses.courses[1], template: [{ type: 'subheading', title: '' }] }] }
    const messages = validateConfig(bad).map((p) => p.message)
    expect(messages.some((m) => m.includes('大見出しから始めて'))).toBe(true)
    expect(messages.some((m) => m.includes('名前が空の小見出し'))).toBe(true)
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
