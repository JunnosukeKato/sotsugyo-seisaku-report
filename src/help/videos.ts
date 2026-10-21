import type { HelpTopic } from './helpTopics'

/**
 * 使い方の動画（音なし・字幕つき。scripts/video で撮って、public/help/videos/ に置く）。
 * file：ファイルの名前（.mp4 と、はじめに出す絵の .jpg）、seconds：長さ、phone：スマホの回
 */
export interface HelpVideo {
  number: number
  title: string
  file: string
  seconds: number
  phone?: boolean
}

export const HELP_VIDEOS: HelpVideo[] = [
  { number: 1, title: 'はじめ方（ログイン〜表紙）', file: '1-start', seconds: 63 },
  { number: 2, title: '本文を書く・図を入れる', file: '2-body', seconds: 60 },
  { number: 3, title: '表・作品写真', file: '3-table-photos', seconds: 68 },
  { number: 4, title: 'セルフチェックで直す', file: '4-check', seconds: 43 },
  { number: 5, title: 'PDF を書き出す', file: '5-pdf', seconds: 56 },
  { number: 6, title: 'スマホで書く', file: '6-phone', seconds: 60, phone: true },
]

/** その項目の動画（スマホで開いたときは、スマホの回を先に） */
export function topicVideos(topic: HelpTopic, device: string): HelpVideo[] {
  const list = (topic.videos ?? []).map((n) => HELP_VIDEOS.find((v) => v.number === n)).filter((v): v is HelpVideo => !!v)
  const phone = device === 'iphone' || device === 'android'
  return phone ? [...list.filter((v) => v.phone), ...list.filter((v) => !v.phone)] : list
}
