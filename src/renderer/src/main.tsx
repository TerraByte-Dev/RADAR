import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/app.css'
import { applyTheme } from './lib/theme'
import { useShell } from './store/shell'

// The theme is on <html> before the first paint, so nothing flashes in the other one.
applyTheme(useShell.getState().theme)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
