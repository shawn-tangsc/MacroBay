import React from 'react'
import { createRoot } from 'react-dom/client'
import 'antd/dist/reset.css'

import { AppShell } from './shell/AppShell'
import './styles.css'

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>
)
