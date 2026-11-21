import { createRoot } from 'react-dom/client'
import { ResearchExplorer } from '../../src/renderer/ResearchExplorer'
import '../../src/renderer/styles.css'
import '../../src/renderer/workspace.css'
import '../../src/renderer/acrylic.css'
import '../../src/renderer/design.css'
import '../../src/renderer/scrollbars'
import appIcon from '../../build/icon-ui.png'

createRoot(document.getElementById('root')!).render(<div className="app-shell sidebar-open"><aside className="app-sidebar"><div className="sidebar-brand"><div className="brand-mark"><img src={appIcon} alt=""/></div></div><nav className="sidebar-navigation"><button className="nav-button rail-button">⌂</button><button className="nav-button rail-button active">◇</button><button className="nav-button rail-button">▱</button></nav></aside><header className="titlebar"><span>Singularity · 科研发现</span></header><main className="main-content" data-chat-theme="transparent"><section className="page digest-page"><header className="page-header"><div><h1>科研发现</h1></div></header><ResearchExplorer/></section></main></div>)
