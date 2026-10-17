import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BackupDialog } from './dialogs'

const noop = () => {}
const backup = (driveStopped?: boolean) =>
  renderToStaticMarkup(
    <BackupDialog snapshots={[]} driveStopped={driveStopped} onSaveBackup={noop} onRestoreFile={noop} onRestoreSnapshot={noop} onStartOver={noop} onClose={noop} />,
  )

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
  it('名前のある控え（Word を読み込む前）は、時刻と並べて名前を出す', () => {
    const report = {} as never
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
    expect(html).toContain('（Word を読み込む前）')
    expect(html.match(/（Word を読み込む前）/g)).toHaveLength(1)
  })
})
