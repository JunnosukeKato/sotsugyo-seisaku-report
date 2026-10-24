import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Reference } from '../model/types'
import { referencesChanged } from '../model/references'
import { BackupDialog, CourseChangeDialog } from './dialogs'

const noop = () => {}

describe('引用・参考文献の窓を閉じるとき、書いた内容が反映してある内容と違うか（違えば、閉じる前に聞く）', () => {
  const book = (id: string, author = ''): Reference => ({ type: 'book', id, author, title: '', publisher: '', year: '', pages: '' })
  const web = (id: string, siteTitle = ''): Reference => ({ type: 'web', id, siteTitle, url: '', accessedOn: '2026-10-18' })
  const saved = [book('r1', '浜松隆志')]

  it('何も変えていなければ違わない（すぐ閉じる）', () => {
    expect(referencesChanged(saved, saved)).toBe(false)
    expect(referencesChanged([], [])).toBe(false)
  })

  it('足しただけで何も書いていない文献（Web サイトの参照日だけ入っているものも）は、違いに数えない', () => {
    expect(referencesChanged(saved, [...saved, book('r2'), web('r3')])).toBe(false)
  })

  it('書いた・書き直した・消したときは違う', () => {
    expect(referencesChanged(saved, [...saved, book('r2', '文化花子')])).toBe(true)
    expect(referencesChanged(saved, [book('r1', '浜松')])).toBe(true)
    expect(referencesChanged(saved, [])).toBe(true)
    expect(referencesChanged([], [web('r4', 'クラウン')])).toBe(true)
  })
})

describe('本文を書き始めてからコースを変えるときの窓', () => {
  it('濃いボタン（開いたときに移るボタン）は、本文を残す「コース名だけ変える」。「下書きを入れ替える」は目立たせない', () => {
    const html = renderToStaticMarkup(<CourseChangeDialog courseName="映画・舞台衣装デザイナー" onReplace={noop} onNameOnly={noop} onClose={noop} />)
    expect(html).toMatch(/<button[^>]*class="primary course-keep"[^>]*data-autofocus="true"[^>]*>コース名だけ変える<\/button>/)
    expect(html).toMatch(/<button class="course-replace">下書きを入れ替える<\/button>/)
    expect(html.match(/class="primary/g)).toHaveLength(1)
  })
})
const backup = (driveStopped?: boolean) =>
  renderToStaticMarkup(
    <BackupDialog snapshots={[]} driveStopped={driveStopped} onSaveBackup={noop} onRestoreFile={noop} onRestoreSnapshot={noop} onStartOver={noop} onClose={noop} />,
  )

describe('バックアップ・作り直すの窓（mockups/v34 案A）', () => {
  it('窓の名前は「バックアップ・作り直す」。「最初から作り直す」は、いちばん下に区切って出し、「いまの原稿は自動の控えに残ります」と書く。「閉じる」はその下の行', () => {
    const html = backup()
    expect(html).toContain('aria-label="バックアップ・作り直す"')
    expect(html).toContain('<h2>バックアップ・作り直す</h2>')
    const section = html.indexOf('class="start-over"')
    expect(section).toBeGreaterThan(html.indexOf('自動の控え（'))
    expect(html.slice(section)).toMatch(/<h3[^>]*>最初から作り直す（新しく始める）<\/h3>/)
    expect(html.slice(section)).toContain('<p>いまの原稿は自動の控えに残ります</p>')
    expect(html.slice(section)).toMatch(/<button class="danger"><svg[^]*<\/svg>最初から作り直す<\/button>/)
    // 「閉じる」は、区切りのあとの行（「最初から作り直す」と同じ行には並べない）
    expect(html.indexOf('class="row-buttons close-row"')).toBeGreaterThan(html.indexOf('</section>', section))
    expect(html.slice(html.indexOf('close-row'))).toContain('>閉じる</button>')
  })
})

describe('バックアップと復元の窓', () => {
  it('ドライブ保存を止めていないとき（既定）は、ドライブにも保存されると説明する', () => {
    expect(backup()).toContain('Google ドライブにも保存されます')
  })

  it('ドライブ保存を止めているときは、この端末にだけ保存されると説明する', () => {
    const html = backup(true)
    expect(html).not.toContain('ドライブにも保存されます')
    expect(html).toContain('この端末にだけ保存されます')
  })

  it('「バックアップファイルから復元」は、キーボードで押せるふつうのボタン（ファイルを選ぶ欄は隠しておく）', () => {
    const html = backup()
    expect(html).toMatch(/<button[^>]*class="file-button"[^>]*>バックアップファイルから復元<\/button>/)
    expect(html).toMatch(/<input[^>]*type="file"[^>]*hidden=""/)
    expect(html).not.toContain('<label class="file-button"')
  })
})

describe('自動の控えの一覧', () => {
  it('名前のある控え（Word を読み込む前）は、時刻と並べて札を出し、どの控えにも中身の目安を出す（mockups/v53 ④ 案A）', () => {
    const report = { body: [{ id: 'c', title: '企画', blocks: [{ type: 'paragraph', id: 'p', content: [{ type: 'text', text: '袖を大きくした。' }] }] }], workPhotos: [] } as never
    const html = renderToStaticMarkup(
      <BackupDialog
        snapshots={[
          { savedAt: '2026-10-17T03:00:00.000Z', report, keep: true, label: 'Word を読み込む前' },
          { savedAt: '2026-10-17T02:00:00.000Z', report },
        ]}
        onSaveBackup={noop}
        onRestoreFile={noop}
        onRestoreSnapshot={noop}
        onStartOver={noop}
        onClose={noop}
      />,
    )
    expect(html).toContain('<i class="snap-label">Word を読み込む前</i>')
    expect(html.match(/Word を読み込む前/g)).toHaveLength(1)
    expect(html.match(/本文 8字/g)).toHaveLength(2)
  })
})
