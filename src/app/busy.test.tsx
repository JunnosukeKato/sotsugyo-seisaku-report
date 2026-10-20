import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { demoReport } from '../model/demoReport'
import { BusyLabel, SlowNote, Spinner, WaitToast } from './Busy'
import { BackupDialog } from './dialogs'
import { ConflictDialog, IdMismatchDialog, WipeDialog } from './DriveUi'

/** 待つ間の表示（依頼者の要望 2026-10-20「保存中に何も表示がなく待たされるので不安になる」） */

const noop = () => {}
/** 見える言葉 */
const shown = (html: string) => html.replace(/<[^>]+>/g, '')

describe('待つ間の部品', () => {
  it('回る印は読み上げない（言葉は、となりに書く）', () => {
    expect(renderToStaticMarkup(<Spinner />)).toBe('<span class="busy-spin" aria-hidden="true"></span>')
  })

  it('ボタンの中身：待つ間は回る印と言葉、ふだんは元の中身', () => {
    expect(renderToStaticMarkup(<BusyLabel busy text="保存しています…">保存</BusyLabel>)).toBe('<span class="busy-spin" aria-hidden="true"></span>保存しています…')
    expect(renderToStaticMarkup(<BusyLabel busy={false} text="保存しています…">保存</BusyLabel>)).toBe('保存')
  })

  it('「数秒かかることがあります」は、はじめは出さない（読み上げ用の枠だけ置く。2秒を過ぎたら出す）', () => {
    expect(renderToStaticMarkup(<SlowNote busy />)).toBe('<span class="slow-note" role="status"></span>')
  })

  it('紙面の上の知らせ：回る印と言葉（読み上げにも伝える）', () => {
    const html = renderToStaticMarkup(<WaitToast text="写真を取り込んでいます…" />)
    expect(html).toContain('role="status"')
    expect(html).toContain('busy-spin')
    expect(shown(html)).toBe('写真を取り込んでいます…')
  })
})

describe('バックアップ・作り直すの窓', () => {
  it('自動の控えを読み込んでいる間も、窓はすぐ開き、一覧の所に「控えを読み込んでいます…」と回る印を出す', () => {
    const html = renderToStaticMarkup(<BackupDialog snapshots={null} onSaveBackup={noop} onRestoreFile={noop} onRestoreSnapshot={noop} onStartOver={noop} onClose={noop} />)
    expect(html).toMatch(/<p class="muted busy-line" role="status"><span class="busy-spin" aria-hidden="true"><\/span>控えを読み込んでいます…<\/p>/)
    expect(html).not.toContain('まだ控えはありません')
  })
})

describe('ドライブの窓（押したボタンに、回る印と言葉）', () => {
  const remote = { fileId: 'f1', modifiedTime: '2026-10-20T01:00:00.000Z', savedAt: '2026-10-20T01:00:00.000Z', device: 'iPhone・Safari', report: demoReport() }

  it('どちらの原稿で続けるか：選んだほうのボタンだけに言葉が出て、どちらも押せない', () => {
    const local = renderToStaticMarkup(<ConflictDialog local={demoReport()} remote={remote} atLogin={false} busy="local" onChooseRemote={noop} onChooseLocal={noop} />)
    expect(local).toContain('<span class="busy-spin" aria-hidden="true"></span>ドライブに保存しています…')
    expect(local).toContain('>ドライブの原稿を開く</button>')
    expect(local.match(/<button[^>]*disabled=""/g)).toHaveLength(2)
    const opening = renderToStaticMarkup(<ConflictDialog local={demoReport()} remote={remote} atLogin={false} busy="remote" onChooseRemote={noop} onChooseLocal={noop} />)
    expect(shown(opening)).toContain('開いています…')
    const idle = renderToStaticMarkup(<ConflictDialog local={demoReport()} remote={remote} atLogin={false} busy={null} onChooseRemote={noop} onChooseLocal={noop} />)
    expect(idle).not.toContain('busy-spin')
    expect(idle).not.toContain('disabled')
  })

  it('この端末から消す：保存している間は「ドライブに保存しています…」と回る印（「×」「やめる」も押せない）', () => {
    const html = renderToStaticMarkup(<WipeDialog lastSaved={null} busy onConfirm={noop} onClose={noop} />)
    expect(html).toContain('<span class="busy-spin" aria-hidden="true"></span>ドライブに保存しています…')
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(3)
  })

  it('学籍番号の違い：「自分の原稿ではない」を選んだら、そのボタンに「準備しています…」', () => {
    const html = renderToStaticMarkup(<IdMismatchDialog coverId="00ZZ555" accountEmail="00zz901@bunka-wu.ac.jp" accountId="00ZZ901" busy onFix={noop} onNotMine={noop} onKeep={noop} />)
    expect(html).toContain('<span class="busy-line"><span class="busy-spin" aria-hidden="true"></span>準備しています…</span>')
  })
})
