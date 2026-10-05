import { createRoot } from 'react-dom/client'
import '@fontsource/biz-udmincho/400.css'
import '@fontsource/biz-udpgothic/400.css'
import '@fontsource/biz-udpgothic/700.css'
import './index.css'
import App from './App.tsx'

// StrictMode は使わない（組版エンジンを二重に起動しないため）
createRoot(document.getElementById('root')!).render(<App />)
