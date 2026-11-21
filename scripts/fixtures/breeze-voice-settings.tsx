import { createRoot } from 'react-dom/client'
import { VoiceWorkspace } from '../../src/renderer/VoiceWorkspace'
import '../../src/renderer/scrollbars'
import '../../src/renderer/styles.css'
import '../../src/renderer/workspace.css'
import '../../src/renderer/acrylic.css'
import '../../src/renderer/design.css'
const root = createRoot(document.getElementById('root')!)
root.render(<div className="app-shell sidebar-open"><aside className="app-sidebar"/><header className="titlebar"/><main className="main-content" data-chat-theme="warm"><VoiceWorkspace/></main></div>)
