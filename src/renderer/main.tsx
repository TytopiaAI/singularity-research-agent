import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { DesktopBackdrop } from './DesktopBackdrop'
import './styles.css'
import './workspace.css'
import './acrylic.css'
import './reader-translation.css'
import './startup.css'
import './design.css'
import './scrollbars'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><DesktopBackdrop /><App /></React.StrictMode>,
)
