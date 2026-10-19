import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DriveStatus } from '../drive/driveSync'
import { DriveChip, type DriveControls } from './DriveUi'
import { SaveChip } from './SidePanel'
import type { SaveState } from './useAutosave'

const noop = () => {}
/** 見える言葉（読み上げだけの言葉は除く） */
const shown = (html: string) => html.replace(/<span class="sr-only">[^<]*<\/span>/g, '').replace(/<[^>]+>/g, '')
const at = new Date()
const time = at.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
const drive = (status: DriveStatus, local: SaveState = { status: 'idle' }): DriveControls => ({ state: { email: '00zz0123@bunka-wu.ac.jp', status }, local, lastSaved: null, staff: false, onSaveNow: noop, onReload: noop, onWipe: noop, onRelogin: noop })

describe('スマホの上の帯の保存のようす（mockups/v39 案A：「戻す」「やり直す」を置くので短くする）', () => {
  it('ドライブに保存するとき：ふだんの言葉はそのまま、保存できないときは「ドライブ未保存」→「未保存」', () => {
    expect(shown(renderToStaticMarkup(<DriveChip drive={drive({ kind: 'saved', at })} compact />))).toBe(time)
    expect(shown(renderToStaticMarkup(<DriveChip drive={drive({ kind: 'idle' })} compact />))).toBe('ドライブ')
    expect(shown(renderToStaticMarkup(<DriveChip drive={drive({ kind: 'saving' })} compact />))).toBe('保存中')
    expect(shown(renderToStaticMarkup(<DriveChip drive={drive({ kind: 'offline' })} compact />))).toBe('電波なし')
    expect(shown(renderToStaticMarkup(<DriveChip drive={drive({ kind: 'idle' }, { status: 'error', message: 'x' })} compact />))).toBe('保存エラー')
    for (const status of [{ kind: 'expired' }, { kind: 'conflict' }, { kind: 'error', message: 'x' }] as DriveStatus[]) {
      expect(shown(renderToStaticMarkup(<DriveChip drive={drive(status)} compact />))).toBe('未保存')
    }
  })

  it('メニューの中・パソコンの右の欄（compact でない）は、今までどおりくわしい言葉', () => {
    expect(shown(renderToStaticMarkup(<DriveChip drive={drive({ kind: 'expired' })} />))).toContain('ドライブに保存できません')
    expect(shown(renderToStaticMarkup(<DriveChip drive={drive({ kind: 'saved', at })} />))).toBe(`ドライブに保存 ${time}`)
    expect(shown(renderToStaticMarkup(<SaveChip state={{ status: 'saved', at }} />))).toBe(`自動保存 ${time}`)
    expect(shown(renderToStaticMarkup(<SaveChip state={{ status: 'saving' }} />))).toBe('保存しています…')
    expect(shown(renderToStaticMarkup(<SaveChip state={{ status: 'error', message: 'x' }} />))).toBe('保存できません。バックアップを保存してください')
  })

  it('ドライブへの保存を止めているとき（この端末だけ）：時刻だけ（緑の点。読み上げでは「自動保存 13:05」）・「保存中」・「保存エラー」', () => {
    const saved = renderToStaticMarkup(<SaveChip state={{ status: 'saved', at }} compact />)
    expect(shown(saved)).toBe(time)
    expect(saved).toContain('<i class="dot"></i>')
    expect(saved.replace(/<[^>]+>/g, '')).toBe(`自動保存 ${time}`)
    expect(saved).toContain('role="status"')
    expect(shown(renderToStaticMarkup(<SaveChip state={{ status: 'idle' }} compact />))).toBe('自動保存')
    expect(shown(renderToStaticMarkup(<SaveChip state={{ status: 'saving' }} compact />))).toBe('保存中')
    expect(shown(renderToStaticMarkup(<SaveChip state={{ status: 'error', message: 'x' }} compact />))).toBe('保存エラー')
  })
})
