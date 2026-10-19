import { describe, expect, it } from 'vitest'
import { demoReport } from '../model/demoReport'
import type { Report } from '../model/types'
import * as ops from './reportOps'
import { changedPlace, noticeText, undoable } from './undoNotice'

describe('削除の知らせの言葉（mockups/v32 ② 案A）', () => {
  it('削除したものごとに「〜を削除しました」、戻したら「〜を戻しました」。作品写真は「外しました」', () => {
    expect(noticeText({ kind: 'removed', what: '段落' })).toBe('段落を削除しました')
    expect(noticeText({ kind: 'removed', what: '大見出し（章）' })).toBe('大見出し（章）を削除しました')
    expect(noticeText({ kind: 'removed', what: '改ページ' })).toBe('改ページを削除しました')
    expect(noticeText({ kind: 'removed', what: '作品写真' })).toBe('作品写真を外しました')
    expect(noticeText({ kind: 'restored', what: '段落' })).toBe('段落を戻しました')
    expect(noticeText({ kind: 'restored', what: '作品写真' })).toBe('作品写真を戻しました')
  })

  it('コースを変えて下書きを入れ替えたときは「下書きを入れ替えました」、戻したら「下書きを戻しました」', () => {
    expect(noticeText({ kind: 'removed', what: '下書き' })).toBe('下書きを入れ替えました')
    expect(noticeText({ kind: 'restored', what: '下書き' })).toBe('下書きを戻しました')
  })

  it('紙面で選んだ範囲を消した・切り取ったとき（大見出しを残したときは、そう添える）', () => {
    expect(noticeText({ kind: 'removed', what: '選んだ文' })).toBe('選んだ文を削除しました')
    expect(noticeText({ kind: 'removed', what: '切り取り', note: '（大見出しは残しました）' })).toBe('切り取りました（大見出しは残しました）')
    expect(noticeText({ kind: 'restored', what: '選んだ文' })).toBe('選んだ文を戻しました')
    expect(noticeText({ kind: 'restored', what: '切り取り' })).toBe('切り取る前に戻しました')
  })
})

describe('段落を見出しにした知らせの言葉（段落に「Ⅲ．まとめ」のように打った）', () => {
  it('自動で付いた番号の見出しを言う。貼り付けたときは「見出しにnつしました」。どちらも［戻す］を出し、戻したら「見出しにする前に戻しました」', () => {
    expect(noticeText({ kind: 'heading', level: 1, label: 'Ⅲ．まとめ' })).toBe('大見出し「Ⅲ．まとめ」にしました')
    expect(noticeText({ kind: 'heading', level: 2, label: 'ⅱ．袖の刺繍' })).toBe('小見出し「ⅱ．袖の刺繍」にしました')
    expect(noticeText({ kind: 'headings', count: 3 })).toBe('見出しに3つしました')
    expect(noticeText({ kind: 'headings', count: 2, note: '。表は文になりました（表は「表を入れる」で作ります）' })).toBe('見出しに2つしました。表は文になりました（表は「表を入れる」で作ります）')
    expect(noticeText({ kind: 'unheaded' })).toBe('見出しにする前に戻しました')
    expect(undoable({ kind: 'heading', level: 1, label: 'Ⅲ．まとめ' })).toBe(true)
    expect(undoable({ kind: 'headings', count: 1 })).toBe(true)
    expect(undoable({ kind: 'unheaded' })).toBe(false)
  })

  it('見出しにしたのを戻すと、戻した段落を光らせる（大見出しで分けた章が、元の1つの章に戻る）', () => {
    const r = demoReport()
    const typed = ops.setText(r, 'p5', 'Ⅲ．仕上げ')
    const big = ops.paragraphToHeading(typed, 'p5', { level: 1, title: '仕上げ' }, '')!.report
    expect(changedPlace(big, typed)).toEqual({ kind: 'block', id: 'p5' })
    const small = ops.paragraphToHeading(typed, 'p5', { level: 2, title: '仕上げ' })!.report
    expect(changedPlace(small, typed)).toEqual({ kind: 'block', id: 'p5' })
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
    const photos: Report = { ...r, workPhotos: [{ layout: 2, imageIds: ['g1', 'g2'] }] }
    expect(changedPlace({ ...photos, workPhotos: [{ layout: 2, imageIds: ['g1', ''] }] }, photos)).toEqual({ kind: 'photo', page: 0, index: 1 })
    expect(changedPlace({ ...photos, workPhotos: [{ layout: 4, imageIds: ['g1', 'g2'] }] }, photos)).toEqual({ kind: 'area', area: 'photos', page: 0 })
  })

  it('作品写真が何ページかあるとき：変えたページの枠へ。消したページを戻すと、そのページへ移るだけ（mockups/v38 案A）', () => {
    const two: Report = { ...r, workPhotos: [{ layout: 4, imageIds: ['a', 'b', 'c', 'd'] }, { layout: 1, imageIds: ['e'] }] }
    expect(changedPlace({ ...two, workPhotos: [two.workPhotos[0], { layout: 1, imageIds: [''] }] }, two)).toEqual({ kind: 'photo', page: 1, index: 0 })
    // 2ページ目を消した → 戻すと2ページ目
    expect(changedPlace({ ...two, workPhotos: [two.workPhotos[0]] }, two)).toEqual({ kind: 'area', area: 'photos', page: 1 })
    // 足したページを元に戻す → 残ったページの最後
    expect(changedPlace(two, { ...two, workPhotos: [two.workPhotos[0]] })).toEqual({ kind: 'area', area: 'photos', page: 0 })
  })

  it('作品写真のページを消したときの知らせ（写真の枚数を添える）と、戻したときの知らせ', () => {
    expect(noticeText({ kind: 'removed', what: '作品写真のページ', note: '（写真2枚も）' })).toBe('作品写真のページを消しました（写真2枚も）')
    expect(noticeText({ kind: 'removed', what: '作品写真のページ' })).toBe('作品写真のページを消しました')
    expect(noticeText({ kind: 'restored', what: '作品写真のページ' })).toBe('作品写真のページを戻しました')
  })

  it('紙面に見える所が変わらなければ（「このままにする」を戻しただけ）null', () => {
    expect(changedPlace({ ...r, acknowledged: ['x'] }, r)).toBeNull()
    expect(changedPlace(r, r)).toBeNull()
  })
})

describe('抄録を書き始めた知らせ・戻すもののない知らせ', () => {
  it('「抄録を書き始めました」は［戻す］を出し、戻したら「抄録を書き始める前に戻しました」。わけを伝える知らせは、その言葉だけ', () => {
    expect(noticeText({ kind: 'started' })).toBe('抄録を書き始めました')
    expect(undoable({ kind: 'started' })).toBe(true)
    expect(noticeText({ kind: 'unstarted' })).toBe('抄録を書き始める前に戻しました')
    expect(undoable({ kind: 'unstarted' })).toBe(false)
    expect(noticeText({ kind: 'info', text: '表には1列以上が要ります。' })).toBe('表には1列以上が要ります。')
    expect(undoable({ kind: 'info', text: '' })).toBe(false)
    expect(undoable({ kind: 'removed', what: '段落' })).toBe(true)
  })

  it('抄録を書き始めたのを戻すと、抄録のページへ移る', () => {
    const locked: Report = { ...demoReport(), abstract: { ...demoReport().abstract, started: false } }
    const started: Report = { ...locked, abstract: { ...locked.abstract, started: true } }
    expect(changedPlace(started, locked)).toEqual({ kind: 'area', area: 'abstract' })
  })
})
