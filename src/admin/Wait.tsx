import { Icon } from '../app/icons'
import { SLOW_TEXT } from './useWait'

/**
 * サーバーを待つ間の表示（回る印は、学生用ツールの PDF の窓の「保存の画面を開いています…」と同じ形。admin.css の .spin）。
 * 押したボタンの中身を Waiting に変え、長く待つと SlowNote を出し、終わったら DoneNote を数秒出す（useWait.ts）
 */

/** 待っている間のボタンの中身：回る印と「保存しています…」など */
export function Waiting({ text }: { text: string }) {
  return (
    <>
      <span className="spin" aria-hidden="true" />
      {text}
    </>
  )
}

/** 長く待っているときの1行（「数秒〜十数秒かかることがあります」） */
export function SlowNote({ show }: { show: boolean }) {
  return show ? (
    <span className="slow-note" role="status">
      {SLOW_TEXT}
    </span>
  ) : null
}

/** 最初の読み込み：画面の真ん中に、回る印と「読み込んでいます…」（長くかかるときは、その下に「数秒〜十数秒かかることがあります」） */
export function PageLoading({ slow }: { slow: boolean }) {
  return (
    <div className="admin-loading" aria-busy="true">
      <div className="page-wait" role="status">
        <span className="spin" aria-hidden="true" />
        読み込んでいます…
        {slow && <small>{SLOW_TEXT}</small>}
      </div>
    </div>
  )
}

/** 終わったときの短い知らせ（「✓ 保存しました」など） */
export function DoneNote({ text }: { text: string | null }) {
  return text ? (
    <span className="done-note" role="status">
      {Icon.check}
      {text}
    </span>
  ) : null
}
