import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { configDefaults, defineConfig } from 'vitest/config'

/**
 * ページが読み込んでよい場所・送ってよい場所の決まり（Content Security Policy）。
 * 学生の原稿は、学生のブラウザと、学生本人の Google ドライブにだけ置く。万一ツールのプログラムに誤りや悪いものが
 * 紛れ込んでも、原稿をほかの場所へ送れないよう、送り先を Google（ログイン・ドライブ・学科の Apps Script）だけにする。
 * 開発中だけは、開発サーバーの即時反映（埋め込みのスクリプト・WebSocket）を許す。
 */
function contentSecurityPolicy(dev: boolean): string {
  return [
    "default-src 'self'",
    // Google のログインの部品
    `script-src 'self' https://accounts.google.com/gsi/client${dev ? " 'unsafe-inline'" : ''}`,
    // 組版エンジンと画面の部品が、書体や紙面の見た目を <style> で書き込むため
    "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
    // 写真はブラウザの中（blob:）にあり、紙面の仮の画像などは data: で作る
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    // 送り先：Google のログイン・ドライブ・学科の Apps Script（年度の設定）だけ
    `connect-src 'self' blob: data: https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com https://script.google.com https://script.googleusercontent.com${dev ? ' ws: wss:' : ''}`,
    'frame-src https://accounts.google.com',
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ')
}

/**
 * 提出前チェック（check.html）の決まり。学生のファイル（Word・PDF・作品写真）はブラウザの中だけで読み、どこにも送らない。
 * ログインもドライブも使わないので、Google のログインの部品は読み込まず、送り先は学科の Apps Script（年度の設定を読むだけ）に限る。
 * ページの小さな絵は blob:、PDF を読む部品（pdf.js）の手伝い（worker）は、このページと同じ場所から読む
 */
function checkPagePolicy(dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self'${dev ? " 'unsafe-inline'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    `connect-src 'self' blob: data: https://script.google.com https://script.googleusercontent.com${dev ? ' ws: wss:' : ''}`,
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ')
}

/** 学生用のページ（ツール・提出前チェック・ドライブの接続テスト・PDF の試し）に、上の決まりを書き込む。管理ページ（vite.admin.config.ts）は別 */
function cspPlugin(): Plugin {
  let dev = false
  return {
    name: 'sotsugyo-csp',
    configResolved(config) {
      dev = config.command === 'serve'
    },
    transformIndexHtml(html, ctx) {
      // 開発中に見るデザイン案・試しのページ、管理ページの試験版には入れない
      if (/(^|[\\/])(mockups|poc)[\\/]/.test(ctx.path) || /admin\.html$/.test(ctx.path)) return html
      const policy = /check\.html$/.test(ctx.path) ? checkPagePolicy(dev) : contentSecurityPolicy(dev)
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages などのサブパスや学内サーバーのどこに置いても動くよう相対パスで出力する
  base: './',
  plugins: [react(), cspPlugin()],
  build: {
    rollupOptions: {
      // 学生用ツールと、提出前チェック（Word のひな形で書いている学生が、確かめて1つの PDF にまとめる）と、
      // Google ドライブの接続テストのページと、PDF を手元で作る試しのページ
      input: { main: 'index.html', check: 'check.html', driveTest: 'drive-test.html', pdfTest: 'pdf-test.html' },
    },
  },
  test: {
    // 試しや見直しで作ったもの（poc-output、git に入らない）のテストは、単体テストに含めない
    exclude: [...configDefaults.exclude, 'poc-output/**'],
  },
})
