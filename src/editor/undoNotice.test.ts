import { describe, expect, it } from 'vitest'
import { demoReport } from '../model/demoReport'
import type { Report } from '../model/types'
import * as ops from './reportOps'
import { changedPlace, noticeText } from './undoNotice'

describe('削除の知らせの言葉（mockups/v32 ② 案A）', () => {
  it('削除したものごとに「〜を削除しました」、戻したら「〜を戻しました」。作品写真は「外しました」', () => {
    expect(noticeText({ kind: 'removed', what: '段落' })).toBe('段落を削除しました')
    expect(noticeText({ kind: 'removed', what: '大見出し（章）' })).toBe('大見出し（章）を削除しました')
    expect(noticeText({ kind: 'removed', what: '改ページ' })).toBe('改ページを削除しました')
    expect(noticeText({ kind: 'removed', what: '作品写真' })).toBe('作品写真を外しました')
    expect(noticeText({ kind: 'restored', what: '段落' })).toBe('段落を戻しました')
    expect(noticeText({ kind: 'restored', what: '作品写真' })).toBe('作品写真を戻しました')
  })
})

describe('元に戻して変わった所（そこへ移って光らせる）', () => {
  const r = demoReport()
  // 元に戻す前（before）と戻したあと（after）を比べる
  const undoOf = (change: (x: Report) => Report) => changedPlace(change(r), r)

  it('削除した段落・小見出しを戻すと、その段落・見出し', () => {
    expect(undoOf((x) => ops.removeBlock(x, 'p4'))).toEqual({ kind: 'block', id: 'p4' })
    expect(undoOf((x) => ops.removeBlock(x, 's2'))).toEqual({ kind: 'block', id: 's2' })
  })

  it('削除した図・表を戻すと、図のまとまり・表（本文の（図n）も戻るが、光らせるのは図）。並んだ図の1枚だけなら、その図', () => {
    const withRef = ops.setText(r, 'p2', 'デザインを考えた（図1）。')
    expect(changedPlace(ops.removeFigure(withRef, 'f1'), withRef)).toEqual({ kind: 'group', id: 'r1' })
    expect(undoOf((x) => ops.removeTable(x, 't1'))).toEqual({ kind: 'table', id: 't1' })
    const two = ops.addFigureAfter(r, 'f1', { id: 'f9', imageId: '', caption: '型紙' })
    expect(changedPlace(ops.removeBlock(two, 'f9'), two)).toEqual({ kind: 'figure', id: 'f9' })
  })

  it('削除した大見出し（章ごと）を戻すと、その章の見出し', () => {
    expect(undoOf((x) => ops.removeChapter(x, 'c2'))).toEqual({ kind: 'block', id: 'c2' })
  })

  it('足した段落を元に戻すと（段落が消える）、その直前にあったもの', () => {
    const added = ops.paragraphAfter(r, 'f1', 'pn')!.report
    expect(changedPlace(added, r)).toEqual({ kind: 'group', id: 'r1' })
    // 章の最初に足したものは、直後のもの
    const first = ops.insertAfter(r, 'c3', { type: 'paragraph', id: 'p0', content: [{ type: 'text', text: '' }] })
    expect(changedPlace(first, r)).toEqual({ kind: 'block', id: 'p6' })
  })

  it('書いた文を元に戻すと、その段落。表紙の項目・図のタイトルも、その欄', () => {
    expect(undoOf((x) => ops.setText(x, 'p5', '書き直した。'))).toEqual({ kind: 'block', id: 'p5' })
    expect(undoOf((x) => ops.setText(x, 'basic:name', '文化　太郎'))).toEqual({ kind: 'block', id: 'basic:name' })
    expect(undoOf((x) => ops.setText(x, 'f1', '全身'))).toEqual({ kind: 'figure', id: 'f1' })
    expect(undoOf((x) => ops.setText(x, 'a2', '短くした。'))).toEqual({ kind: 'block', id: 'a2' })
  })

  it('外した作品写真を戻すと、その枠。並べ方を戻すと、作品写真のページへ移るだけ', () => {
    const photos: Report = { ...r, workPhotos: { layout: 2, imageIds: ['g1', 'g2'] } }
    expect(changedPlace({ ...photos, workPhotos: { layout: 2, imageIds: ['g1', ''] } }, photos)).toEqual({ kind: 'photo', index: 1 })
    expect(changedPlace({ ...photos, workPhotos: { layout: 4, imageIds: ['g1', 'g2'] } }, photos)).toEqual({ kind: 'area', area: 'photos' })
  })

  it('紙面に見える所が変わらなければ（「このままにする」を戻しただけ）null', () => {
    expect(changedPlace({ ...r, acknowledged: ['x'] }, r)).toBeNull()
    expect(changedPlace(r, r)).toBeNull()
  })
})
