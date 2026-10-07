import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages などのサブパスや学内サーバーのどこに置いても動くよう相対パスで出力する
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      // 学生用ツールと、Google ドライブの接続テストのページと、PDF を手元で作る試しのページ
      input: { main: 'index.html', driveTest: 'drive-test.html', pdfTest: 'pdf-test.html' },
    },
  },
  test: {
    // 試しや見直しで作ったもの（poc-output、git に入らない）のテストは、単体テストに含めない
    exclude: [...configDefaults.exclude, 'poc-output/**'],
  },
})
