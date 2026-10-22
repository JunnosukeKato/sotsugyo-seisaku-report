import { createRoot } from 'react-dom/client'
import './admin.css'
import { AdminApp } from './AdminApp'
import { ConfirmProvider } from './confirm'

createRoot(document.getElementById('root')!).render(
  <ConfirmProvider>
    <AdminApp />
  </ConfirmProvider>,
)
