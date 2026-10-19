import { describe, expect, it } from 'vitest'
import { PANEL_DEFAULTS, readPanelWidths } from './usePanelWidths'

describe('左右の欄の幅（覚えておいた幅を読む。mockups/v37：右の欄の既定の幅は 340px）', () => {
  it('右の欄の既定の幅は 340px、左は 124px', () => {
    expect(PANEL_DEFAULTS).toEqual({ left: 124, right: 340 })
  })

  it('何も覚えていない・読めないときは、どちらの欄も既定の幅', () => {
    expect(readPanelWidths(null)).toEqual({})
    expect(readPanelWidths('こわれた値')).toEqual({})
    expect(readPanelWidths(JSON.stringify({ left: '200', right: null }))).toEqual({})
  })

  it('前の版が開くたびに覚えていた既定の幅（左 124・右 312）は、使う人が決めた幅ではないので、既定の幅（右 340px）にする', () => {
    expect(readPanelWidths(JSON.stringify({ left: 124, right: 312 }))).toEqual({})
  })

  it('使う人が動かして決めた幅は、そのまま使う（決めていない欄は既定の幅）', () => {
    expect(readPanelWidths(JSON.stringify({ left: 124, right: 400 }))).toEqual({ right: 400 })
    expect(readPanelWidths(JSON.stringify({ left: 180, right: 312 }))).toEqual({ left: 180 })
    expect(readPanelWidths(JSON.stringify({ right: 296 }))).toEqual({ right: 296 })
  })

  it('決められる幅の外の値は、決められる幅に収める（右は 260〜540px）', () => {
    expect(readPanelWidths(JSON.stringify({ right: 900 }))).toEqual({ right: 540 })
    expect(readPanelWidths(JSON.stringify({ right: 100 }))).toEqual({ right: 260 })
  })
})
