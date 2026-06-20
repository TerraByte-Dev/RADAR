import React from 'react'
import ReactDOM from 'react-dom/client'
// Brand fonts — bundled locally so the app stays fully offline (strict CSP).
// The UI is all-mono/terminal; Inter (the house body font) is left to the
// system fallback in the `sans` token rather than bundled, since nothing here
// uses long-form proportional text.
import '@fontsource/vt323/400.css'
import '@fontsource/share-tech-mono/400.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import App from './App'
import './styles/index.css'
import { themeBoot } from './lib/theme'

// Apply the stored theme + CRT class to <html> before React paints — no flash of the default skin.
themeBoot()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
