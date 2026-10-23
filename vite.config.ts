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
      // 管理ページの試験版：中に開いてよい枠は、ひな形を作る画面（学生のツール。開発中は同じ開発サーバー）だけ（本番は vite.admin.config.ts）
      if (/admin\.html$/.test(ctx.path)) return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="frame-src 'self'" />`)
      // 開発中に見るデザイン案・試しのページには入れない
      if (/(^|[\\/])(mockups|poc)[\\/]/.test(ctx.path)) return html
      const policy = /check\.html$/.test(ctx.path) ? checkPagePolicy(dev) : contentSecurityPolicy(dev)
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`)
    },
  }
}

/**
 * 版の印（依頼者の選択 2026-10-23：「新しい版があります」を出す。app/newVersion.tsx）。まとめるたびに印を決めて、プログラムに書き込み（__BUILD_ID__）、
 * 同じ印を version.json に出す。印は GitHub で公開するときはコミット、手元ではまとめた時刻。開発サーバー・単体テストでは 'dev'（調べない）
 */
function versionPlugin(): Plugin {
  const id = process.env.GITHUB_SHA?.slice(0, 12) || Date.now().toString(36)
  let build = false
  return {
    name: 'sotsugyo-version',
    config(_, env) {
      build = env.command === 'build'
      return { define: { __BUILD_ID__: JSON.stringify(build ? id : 'dev') } }
    },
    generateBundle() {
      if (build) this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id }) })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // GitHub Pages などのサブパスや学内サーバーのどこに置いても動くよう相対パスで出力する
  base: './',
  plugins: [react(), cspPlugin(), versionPlugin()],
  build: {
    rollupOptions: {
      // 学生用ツールと、提出前チェック（Word のひな形で書いている学生が、確かめて1つの PDF にまとめる）と、
      // Google ドライブの接続テストのページと、PDF を手元で作る試しのページ。
      // 自動テスト用にまとめる版（vite build --mode e2e。scripts/e2e/run.mjs）には、管理ページの試験版（試験用サーバー）も入れる
      input: { main: 'index.html', check: 'check.html', driveTest: 'drive-test.html', pdfTest: 'pdf-test.html', ...(mode === 'e2e' ? { admin: 'admin.html' } : {}) },
    },
  },
  test: {
    // 試しや見直しで作ったもの（poc-output、git に入らない）のテストは、単体テストに含めない
    exclude: [...configDefaults.exclude, 'poc-output/**'],
  },
}))
