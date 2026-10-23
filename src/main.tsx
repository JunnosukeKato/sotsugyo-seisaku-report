import { createRoot } from 'react-dom/client'
import '@fontsource/biz-udmincho/400.css'
import '@fontsource/biz-udpgothic/400.css'
import '@fontsource/biz-udpgothic/700.css'
import './index.css'
import App from './App.tsx'
import { AskProvider } from './app/ask'
import { trialMode } from './model/scope'
import { startBridge } from './template/bridge'
import { TEMPLATE_PARAM } from './template/protocol'
import { TemplateApp } from './template/TemplateApp'
import { startTrialBridge } from './trial/openTrial'

// ?template=1：管理ページの上に重ねて開く、ひな形を作る画面（mockups/v44 案A）。学生の原稿・ドライブ・この端末の保存には触れない。
// 管理ページからの知らせは、画面を作る前から聞き始める（iframe を読み込んですぐ送られるため）
const templateMode = new URLSearchParams(location.search).has(TEMPLATE_PARAM)
// 開発サーバー・自動テスト用にまとめた版（vite build --mode e2e）では、この端末（localhost）の管理ページの試験版からの知らせも受ける
if (templateMode) startBridge(import.meta.env.DEV || import.meta.env.MODE === 'e2e')
// ?trial=1：先生が見本の原稿で試す、お試しの画面（学生の画面と同じ。保存の名前を変えて、ドライブにはつながない：src/trial/）
else if (trialMode) startTrialBridge(import.meta.env.DEV || import.meta.env.MODE === 'e2e')

// 自動テスト（scripts/e2e）から部品を読み込む窓口（開発サーバーと、自動テスト用にまとめた版だけ。公開する版には入らない）
if (import.meta.env.DEV || import.meta.env.MODE === 'e2e') void import('./testImports').then((m) => m.install())

// StrictMode は使わない（組版エンジンを二重に起動しないため）
// 確認の窓・知らせの窓は、画面の中に出す（app/ask.tsx）
createRoot(document.getElementById('root')!).render(<AskProvider>{templateMode ? <TemplateApp /> : <App />}</AskProvider>)
