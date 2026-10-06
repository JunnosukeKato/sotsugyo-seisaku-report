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
