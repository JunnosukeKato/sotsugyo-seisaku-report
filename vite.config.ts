import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages などのサブパスや学内サーバーのどこに置いても動くよう相対パスで出力する
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      // 学生用ツールと、Google ドライブの接続テストのページ
      input: { main: 'index.html', driveTest: 'drive-test.html' },
    },
  },
})
