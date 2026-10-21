import { useCallback, useEffect, useRef, useState } from 'react'
import type { YearConfig } from '../config'
import type { EditorSnapshot } from '../editor/reportEditor'
import { scoped } from '../model/scope'

/**
 * 今年度だけ：Word のひな形（01_表紙.docx・04_本文.docx）で書き始めた分を、ツールに写す「Wordから読み込む」（mockups/v24）。
 * ここには、出すかどうかと、写したあとの「つぎにすること」（③ 案B）の覚えておき方を置く（画面は WordImport.tsx）
 */

/** 「Wordから読み込む」を出す年度（学科が Word のひな形を配って書き始めさせた年度。ほかの年度の原稿では出さない） */
export const WORD_IMPORT_YEAR = 2026

/** この原稿（年度の設定）で「Wordから読み込む」を出すか */
export const wordImportOffered = (config: YearConfig): boolean => config.fiscalYear === WORD_IMPORT_YEAR

/** 写したあとの「つぎにすること」。閉じる（×）まで、この端末に覚えておく */
export interface WordTodo {
  /** 写した時刻（ISO 8601） */
  at: string
  /** 写す前の原稿の控え（storage の Snapshot.savedAt）。「読み込む前の原稿に戻す」で使う */
  snapshotAt: string | null
  /** 「図1へ」から順に見た図の数（すべて見たら済み） */
  figuresSeen: number
  /** 写したあとに表紙のページを開いた（開いただけでは済みにしない。「確かめた」を押すと coverChecked） */
  coverSeen: boolean
  /** 表紙を見て、学生が「確かめた」を押した */
  coverChecked: boolean
}

const TODO_KEY = scoped('sotsugyo-seisaku-report-word-todo')

function readTodo(): WordTodo | null {
  try {
    const raw = localStorage.getItem(TODO_KEY)
    const t = raw ? (JSON.parse(raw) as Partial<WordTodo>) : null
    return t && typeof t.at === 'string' ? { at: t.at, snapshotAt: t.snapshotAt ?? null, figuresSeen: t.figuresSeen ?? 0, coverSeen: !!t.coverSeen || !!t.coverChecked, coverChecked: !!t.coverChecked } : null
  } catch {
    return null
  }
}

function writeTodo(todo: WordTodo | null): void {
  try {
    if (todo) localStorage.setItem(TODO_KEY, JSON.stringify(todo))
    else localStorage.removeItem(TODO_KEY)
  } catch {
    // 覚えておけなくても、このタブで開いている間は出す
  }
}

/**
 * 「つぎにすること」の中身と、変えるための関数。
 * 写したあと、ページを移って表紙を出したら、「表紙を確かめる」のボタンを「確かめた」にする（写した直後に表紙が出ていただけでは変えない）。
 * 済みにするのは、学生が「確かめた」を押したとき（前は、表紙のページを開いただけで済みにしていたため、コースの違いなどを見ずに済みになっていた）
 */
export function useWordTodo(snap: EditorSnapshot | null): { todo: WordTodo | null; update: (todo: WordTodo | null) => void } {
  const [todo, setTodo] = useState<WordTodo | null>(readTodo)
  const update = useCallback((next: WordTodo | null) => {
    writeTodo(next)
    setTodo(next)
  }, [])
  const page = snap?.layout ? snap.page : null
  const onCover = page !== null && snap?.layout?.kinds[page] === 'cover'
  const prevPage = useRef<number | null>(null)
  useEffect(() => {
    const prev = prevPage.current
    prevPage.current = page
    if (todo && !todo.coverSeen && onCover && prev !== null && prev !== page) update({ ...todo, coverSeen: true })
  }, [page, onCover, todo, update])
  return { todo, update }
}
