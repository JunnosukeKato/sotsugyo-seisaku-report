import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { DEFAULT_TOOL_URL } from './src/template/toolUrl'

/**
 * 管理ページに入れる決まり（Content Security Policy）。管理ページの中に開いてよい枠（iframe）は、学生のツールの場所だけ
 * （「ひな形を作る画面を開く」。mockups/v44 案A）。表紙・抄録の見本（srcdoc の枠）は、この決まりに当たらない。
 * ほかの読み込み（Apps Script の google.script.run・Google Fonts など）は変えない
 */
function adminCsp(toolOrigin: string): Plugin {
  return {
    name: 'sotsugyo-admin-csp',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="frame-src ${toolOrigin}" />`)
    },
  }
}

// 管理ページを1つの HTML ファイルにまとめる（Apps Script の HtmlService に載せるため）
export default defineConfig(({ mode }) => {
  // 学生のツールの場所（scripts/build-gas.mjs が VITE_TOOL_URL で渡す。.env の VITE_TOOL_URL でもよい。なければ GitHub Pages）
  const toolUrl = process.env.VITE_TOOL_URL || loadEnv(mode, process.cwd(), 'VITE_').VITE_TOOL_URL || DEFAULT_TOOL_URL
  return {
    plugins: [react(), viteSingleFile(), adminCsp(new URL(toolUrl).origin)],
    define: { 'import.meta.env.VITE_TOOL_URL': JSON.stringify(toolUrl) },
    build: {
      outDir: 'gas-dist/admin-build',
      emptyOutDir: true,
      rollupOptions: { input: 'admin.html' },
    },
  }
})
