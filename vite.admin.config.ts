import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// 管理ページを1つの HTML ファイルにまとめる（Apps Script の HtmlService に載せるため）
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: 'gas-dist/admin-build',
    emptyOutDir: true,
    rollupOptions: { input: 'admin.html' },
  },
})
