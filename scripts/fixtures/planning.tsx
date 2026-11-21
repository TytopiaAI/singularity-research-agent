import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { PlanningWorkspace } from '../../src/renderer/PlanningWorkspace'
import { PlanningGallery } from '../../src/renderer/PlanningGallery'
import '../../src/renderer/styles.css'
import '../../src/renderer/workspace.css'
import '../../src/renderer/acrylic.css'
import '../../src/renderer/design.css'
import '../../src/renderer/scrollbars'
function Preview(){
  const [gallery,setGallery]=useState(false)
  const theme='warm' as const
  return <div className="app-shell sidebar-open"><aside className="app-sidebar"/><header className="titlebar"/><main className="main-content" data-chat-theme="warm">{gallery?<PlanningGallery onBack={()=>setGallery(false)}/>:<PlanningWorkspace theme={theme} onGallery={()=>setGallery(true)}/>}</main></div>
}
createRoot(document.getElementById('root')!).render(<Preview/> )
