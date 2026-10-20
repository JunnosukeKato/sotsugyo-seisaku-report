import { createRoot } from 'react-dom/client'
import '@fontsource/biz-udmincho/400.css'
import '@fontsource/biz-udpgothic/400.css'
import '@fontsource/biz-udpgothic/700.css'
import './index.css'
import App from './App.tsx'
import { startBridge } from './template/bridge'
import { TEMPLATE_PARAM } from './template/protocol'
import { TemplateApp } from './template/TemplateApp'

// ?template=1：管理ページの上に重ねて開く、ひな形を作る画面（mockups/v44 案A）。学生の原稿・ドライブ・この端末の保存には触れない。
// 管理ページからの知らせは、画面を作る前から聞き始める（iframe を読み込んですぐ送られるため）
const templateMode = new URLSearchParams(location.search).has(TEMPLATE_PARAM)
if (templateMode) startBridge(import.meta.env.DEV)

// StrictMode は使わない（組版エンジンを二重に起動しないため）
createRoot(document.getElementById('root')!).render(templateMode ? <TemplateApp /> : <App />)
