// docx.mjs の型（単体テストから使うため）

export declare const NS: Record<string, string>
export declare function esc(s: string): string
export declare function rid(name: string): string
export declare function run(text: string): string
export declare function p(...content: string[]): string
export declare function styled(styleId: string, ...content: string[]): string
export declare function numbered(numId: number | string, ilvl: number, text: string): string
export declare const br: string
export declare const pageBreak: string
export declare const tab: string

export interface Crop {
  l?: number
  t?: number
  r?: number
  b?: number
}

export declare function inlineImage(id: string, options?: { cx?: number; cy?: number; crop?: Crop }): string
export declare function floatingImage(id: string, options?: { x?: number; y?: number; cx?: number; cy?: number; crop?: Crop }): string
export declare function textBox(lines: string | string[], options?: { x?: number; y?: number; cx?: number; cy?: number }): string

export type CellSpec = string | { text?: string; images?: string[]; span?: number; vMerge?: 'restart' | 'continue' }
export declare function table(rows: CellSpec[][]): string

export declare function makeDocx(options: { body: string; media?: Record<string, Uint8Array>; styles?: string; numbering?: string; strict?: boolean }): Uint8Array

export declare function png(width: number, height: number, options?: { background?: number[]; figure?: number[]; draw?: (x: number, y: number) => number[] }): Uint8Array
export declare function emfHeader(): Uint8Array
