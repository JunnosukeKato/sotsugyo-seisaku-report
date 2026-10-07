import { createRoot } from 'react-dom/client'
import '@fontsource/biz-udmincho/400.css'
import '@fontsource/biz-udpgothic/400.css'
import '@fontsource/biz-udpgothic/700.css'
import './pdfTest.css'
import { PdfTest } from './PdfTest'

// StrictMode は使わない（組版エンジンを二重に起動しないため。学生用ツールと同じ）
createRoot(document.getElementById('root')!).render(<PdfTest />)

// 開発中だけ、自動の確かめ（poc-output/pdf-poc のスクリプト）から使えるようにする
if (import.meta.env.DEV) void import('./devHooks').then((m) => m.install())
