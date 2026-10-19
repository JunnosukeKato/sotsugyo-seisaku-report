import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SideMenu } from './SideMenu'

const noop = () => {}

describe('右の欄の「≡ メニュー」（mockups/v37 案C）', () => {
  it('閉じているときは「メニュー」のボタンだけ。読み上げでは、メニューを開くボタンで、閉じていると分かる', () => {
    const html = renderToStaticMarkup(<SideMenu onHelp={noop} onBackup={noop} onWordImport={noop} />)
    expect(html).toMatch(/<button type="button"[^>]*class="menu-btn"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/)
    expect(html).toContain('メニュー')
    expect(html).not.toContain('role="menu"')
    expect(html).not.toContain('aria-controls')
  })

  it('マウスを乗せたときの説明は、中にあるものの名前（手順書は場所があるとき、Word の読み込みは今年度だけ）', () => {
    const title = (html: string) => html.match(/title="([^"]*)"/)?.[1]
    expect(title(renderToStaticMarkup(<SideMenu onHelp={noop} onBackup={noop} onWordImport={noop} />))).toBe('使い方・バックアップ・作り直す・Word の読み込み')
    expect(title(renderToStaticMarkup(<SideMenu handbookUrl="https://example.com/handbook" onHelp={noop} onBackup={noop} />))).toBe('使い方・手順書・バックアップ・作り直す')
  })
})
