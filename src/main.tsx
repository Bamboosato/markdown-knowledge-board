import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

import LocalMcpLauncher from './components/LocalMcpLauncher.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <LocalMcpLauncher />
  </StrictMode>,
)
