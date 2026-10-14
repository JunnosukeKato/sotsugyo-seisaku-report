import { createRoot } from 'react-dom/client'
import '@fontsource/biz-udmincho/400.css'
import '@fontsource/biz-udpgothic/400.css'
import '@fontsource/biz-udpgothic/700.css'
import './check.css'
import { CheckApp } from './CheckApp'

// 提出前チェック（Word のひな形で書いている学生が、提出の前に確かめて、1つの PDF にまとめるページ）
createRoot(document.getElementById('root')!).render(<CheckApp />)
