/**
 * 学生のツールの場所（ふだん）。管理ページの「ひな形を作る画面を開く」は、ここを ?template=1 で開く（mockups/v44 案A）。
 * 管理ページを Apps Script に載せるときに VITE_TOOL_URL で変えられる（vite.admin.config.ts・scripts/build-gas.mjs）。
 * ほかのものを読み込まない（ビルドの設定からも読むため）
 */
export const DEFAULT_TOOL_URL = 'https://junnosukekato.github.io/sotsugyo-seisaku-report/'
