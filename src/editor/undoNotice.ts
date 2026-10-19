import type { BodyBlock, Report, WorkPhotoPage } from '../model/types'

/**
 * 削除の「戻す」の知らせと、元に戻した所（mockups/v32 ② 案A）。
 * - 削除したら「段落を削除しました［戻す］」を出す（15秒か、次の操作まで）。戻したら「段落を戻しました」
 * - 元に戻したら（知らせの「戻す」・道具の「元に戻す」・Ctrl+Z・書く欄の「戻す」）、変わった所へ移って少しの間光らせる
 *   （ほかのページの変更を戻しても、何をどこに戻したかが見えるように）
 * ここは原稿のデータだけを見る（紙面の要素は reportEditor.ts が探す）
 */

/**
 * 削除したもの（知らせの言葉に使う）。下書き：コースを変えて、本文の下書きをそのコースのひな形に入れ替えた。
 * 選んだ文：紙面をなぞって選んだ範囲を Delete・Backspace で消した／切り取り：選んだ範囲を Ctrl+X で切り取った（editor/rangeOps.ts）
 */
export type RemovedWhat = '段落' | '小見出し' | '大見出し（章）' | '図' | '表' | '改ページ' | '作品写真' | '作品写真のページ' | '下書き' | '選んだ文' | '切り取り'

/**
 * 画面の下に出す知らせの中身。
 * - removed：削除した（［戻す］を出す）／restored：戻した
 * - started：抄録を書き始めた（「先生の許可が出た」を押した。［戻す］を出す）／unstarted：戻して、書き始める前に戻った
 * - info：戻すもののない、短い知らせ（表の行・列を消せないわけなど。text）
 * - heading：段落に「Ⅲ．まとめ」のように打ったので、見出しにした（［戻す］を出す。label：自動で付いた番号と名前「Ⅲ．まとめ」）
 * - headings：何行かの文を貼り付けて、見出しの形の count 行を見出しにした（［戻す］を出す。note：添える一言）
 * - unheaded：戻して、見出しにする前（打ったままの段落）に戻った
 */
export type NoticeBody =
  | { kind: 'removed' | 'restored'; what: RemovedWhat; note?: string }
  | { kind: 'started' | 'unstarted' }
  | { kind: 'info'; text: string }
  | { kind: 'heading'; level: 1 | 2; label: string }
  | { kind: 'headings'; count: number; note?: string }
  | { kind: 'unheaded' }

/** 画面の下に出す知らせ。id：知らせごとに変わる番号（出しておく時間を、知らせごとに数え直すため） */
export type UndoNotice = NoticeBody & { id: number }

/** ［戻す］を出す知らせか（削除した・抄録を書き始めた・段落を見出しにした） */
export function undoable(notice: NoticeBody): boolean {
  return notice.kind === 'removed' || notice.kind === 'started' || headingNotice(notice)
}

/** 段落を見出しにした知らせか（書いている間も出す。段落で Enter を押して、次の段落を書いているときなど） */
export function headingNotice(notice: NoticeBody): boolean {
  return notice.kind === 'heading' || notice.kind === 'headings'
}

/** 知らせの言葉。作品写真は「外す」なので「外しました」、下書きは「入れ替えました」 */
export function noticeText(notice: NoticeBody): string {
  switch (notice.kind) {
    case 'restored':
      return notice.what === '切り取り' ? '切り取る前に戻しました' : `${notice.what}を戻しました`
    case 'removed': {
      // note：添える一言（選んだ範囲に大見出しがかかったが、大見出しは残した、など）
      const note = notice.note ?? ''
      if (notice.what === '下書き') return '下書きを入れ替えました'
      if (notice.what === '切り取り') return `切り取りました${note}`
      // 作品写真のページ：「消す」（左の道具の「このページを消す」。note は「（写真2枚も）」。mockups/v38 案A）
      if (notice.what === '作品写真のページ') return `作品写真のページを消しました${note}`
      return notice.what === '作品写真' ? '作品写真を外しました' : `${notice.what}を削除しました${note}`
    }
    case 'started':
      return '抄録を書き始めました'
    case 'unstarted':
      return '抄録を書き始める前に戻しました'
    case 'info':
      return notice.text
    case 'heading':
      return `${notice.level === 1 ? '大見出し' : '小見出し'}「${notice.label}」にしました`
    case 'headings':
      return `見出しに${notice.count}つしました${notice.note ?? ''}`
    case 'unheaded':
      return '見出しにする前に戻しました'
  }
}

/** 元に戻して変わった所（紙面で光らせるもの） */
export type ChangedPlace =
  /** 段落・見出し・図や表のタイトル・表のセル・表紙の項目・改ページ（紙面の data-block-id） */
  | { kind: 'block'; id: string }
  /** 図（1枚） */
  | { kind: 'figure'; id: string }
  /** 図のまとまり（並んだ図ごと戻した） */
  | { kind: 'group'; id: string }
  | { kind: 'table'; id: string }
  /** 作品写真の枠（page：何ページ目の作品写真か、index：その中の枠。0 から） */
  | { kind: 'photo'; page: number; index: number }
  /** 光らせる所がない変更（作品写真の並べ方・ページを足した・消した、引用・参考文献、抄録を書き始めたか）：そのページへ移るだけ（page：作品写真の何ページ目か） */
  | { kind: 'area'; area: 'abstract' | 'references' | 'photos'; page?: number }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** 本文のブロックの、光らせる所（並んだ図ごと・表ごと・段落など） */
function blockPlace(b: BodyBlock): ChangedPlace {
  if (b.type === 'figureRow') return { kind: 'group', id: b.id }
  if (b.type === 'table') return { kind: 'table', id: b.id }
  return { kind: 'block', id: b.id }
}

/** 同じ ID のブロックで、中身が変わったときの光らせる所（図のまとまりは、変わった図だけ） */
function changedInBlock(now: BodyBlock, was: BodyBlock): ChangedPlace {
  if (now.type === 'figureRow' && was.type === 'figureRow') {
    const changed = now.figures.find((f) => !same(f, was.figures.find((x) => x.id === f.id)))
    return changed ? { kind: 'figure', id: changed.id } : { kind: 'group', id: now.id }
  }
  return blockPlace(now)
}

/**
 * 元に戻す前の原稿 before と、戻したあとの原稿 after を比べて、変わった所を返す（紙面の上から順に、最初の1か所）。
 * 戻したことで消えたもの（足した段落を元に戻したなど）は、その直前にあったもの（なければ直後・章の見出し）を返す。
 * 何も見える所が変わっていなければ（「このままにする」を戻しただけなど）null
 */
export function changedPlace(before: Report, after: Report): ChangedPlace | null {
  // 表紙の項目
  for (const key of ['courseId', 'studentId', 'name', 'subtitleInput'] as const) {
    if (before.basicInfo[key] !== after.basicInfo[key]) return { kind: 'block', id: key === 'courseId' ? 'basic:course' : `basic:${key}` }
  }
  // 抄録
  if ((before.abstract.started ?? true) !== (after.abstract.started ?? true)) return { kind: 'area', area: 'abstract' }
  const abstract = changedInList(before.abstract.paragraphs, after.abstract.paragraphs, (p) => ({ kind: 'block', id: p.id }))
  if (abstract) return abstract
  if (!same(before.abstract.paragraphs, after.abstract.paragraphs)) return { kind: 'area', area: 'abstract' }
  // 本文
  const body = changedInBody(before, after)
  if (body) return body
  if (!same(before.references, after.references)) return { kind: 'area', area: 'references' }
  // 作品写真：変わった枠（写真・見える位置など、写真ごとに並べて持つ値）。並べ方が変わったときは、そのページへ移るだけ。
  // ページを足した・消した（ページの数が変わった）ときは、変わったページ（なければ最後のページ）へ移るだけ（mockups/v38 案A）
  if (!same(before.workPhotos, after.workPhotos)) {
    const was = before.workPhotos
    const now = after.workPhotos
    if (was.length !== now.length) {
      const k = now.findIndex((p, i) => !same(p, was[i]))
      return { kind: 'area', area: 'photos', page: k < 0 ? now.length - 1 : k }
    }
    const k = now.findIndex((p, i) => !same(p, was[i]))
    const [a, b] = [was[k], now[k]]
    if (a.layout === b.layout && a.columns === b.columns) {
      for (let i = 0; i < b.layout; i++) if (!same(photoSlot(a, i), photoSlot(b, i))) return { kind: 'photo', page: k, index: i }
    }
    return { kind: 'area', area: 'photos', page: k }
  }
  return null
}

/** そのページの index 枚目の写真の値（写真ごとに並べて持つ値を、すべて取り出す） */
function photoSlot(page: WorkPhotoPage, index: number): unknown[] {
  return Object.entries(page)
    .filter(([, v]) => Array.isArray(v))
    .map(([k, v]) => [k, (v as unknown[])[index] ?? null])
}

/**
 * 並び（抄録の段落・章のブロック）の中で、戻したことで増えた最初のもの（なければ、変わった最初のもの）。
 * 削除した図を戻すと、本文の（図n）も戻るが、光らせるのは戻した図の方にする。
 * 増えた・変わったものがなく、消えたものがあれば、その直前（なければ直後）に残っているもの
 */
function changedInList<T extends { id: string }>(was: T[], now: T[], place: (item: T) => ChangedPlace, inner?: (now: T, was: T) => ChangedPlace): ChangedPlace | null {
  const before = new Map(was.map((x) => [x.id, x]))
  const added = now.find((x) => !before.has(x.id))
  if (added) return place(added)
  for (const item of now) {
    const old = before.get(item.id)!
    if (!same(old, item)) return inner ? inner(item, old) : place(item)
  }
  const kept = new Set(now.map((x) => x.id))
  const gone = was.findIndex((x) => !kept.has(x.id))
  if (gone < 0) return null
  const near = was.slice(0, gone).reverse().find((x) => kept.has(x.id)) ?? was.slice(gone).find((x) => kept.has(x.id))
  return near ? place(now.find((x) => x.id === near.id)!) : null
}

function changedInBody(before: Report, after: Report): ChangedPlace | null {
  const was = new Map(before.body.map((c) => [c.id, c]))
  for (const chapter of after.body) {
    const old = was.get(chapter.id)
    // 章ごと戻した：章の見出し
    if (!old || old.title !== chapter.title) return { kind: 'block', id: chapter.id }
    if (same(old.blocks, chapter.blocks)) continue
    // 章の中で消えたものの近くに残っているものがなければ（章の中が空になった）、章の見出し
    return changedInList(old.blocks, chapter.blocks, blockPlace, changedInBlock) ?? { kind: 'block', id: chapter.id }
  }
  // 戻したことで章ごと消えた（足した大見出しを元に戻した）：その前の章の見出し
  const kept = new Set(after.body.map((c) => c.id))
  const gone = before.body.findIndex((c) => !kept.has(c.id))
  if (gone < 0) return null
  const near = before.body.slice(0, gone).reverse().find((c) => kept.has(c.id)) ?? before.body.slice(gone).find((c) => kept.has(c.id))
  return near ? { kind: 'block', id: near.id } : null
}
