import { createRoot } from 'react-dom/client'
import '@fontsource/biz-udpgothic/400.css'
import '@fontsource/biz-udpgothic/700.css'
import './driveTest.css'
import { DriveTest } from './DriveTest'

createRoot(document.getElementById('root')!).render(<DriveTest />)
