/**
 * 自動テスト（scripts/e2e）から、ツールの部品（原稿の操作・保存・組版など）を読み込む窓口 window.__import('model/storage.ts')。
 * 開発サーバーと、自動テスト用にまとめた版（vite build --mode e2e。scripts/e2e/run.mjs）だけで入れる（公開する版には入らない：main.tsx）。
 * 前はテストが開発サーバーの /src/… を直接読み込んでいたが、まとめた版にはそれがないため、テストで使う部品をここに並べる（足すときは、ここにも）
 */
const modules = import.meta.glob([
  './app/checkSummary.ts',
  './editor/pageView.ts',
  './editor/reportOps.ts',
  './editor/textSpacing.ts',
  './layout/document.ts',
  './model/images.ts',
  './model/storage.ts',
  './model/table.ts',
  './model/template.ts',
  './pdf/exportPdf.ts',
  './pdf/pagesToPdf.ts',
  './template/convert.ts',
])

export function install(): void {
  Object.assign(window, {
    __import: (path: string) => {
      const load = modules[`./${path}`]
      if (!load) throw new Error(`src/testImports.ts に ${path} がありません`)
      return load()
    },
  })
}
