import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import { DocumentTranslationPanel } from '../../src/renderer/DocumentTranslationPanel'
import type { DocumentTranslation } from '../../src/shared/document-translation'
import '../../src/renderer/styles.css'
import '../../src/renderer/workspace.css'
import '../../src/renderer/acrylic.css'
import '../../src/renderer/reader-translation.css'
import '../../src/renderer/design.css'

declare global { interface Window { captureTest: { document: DocumentTranslation; worker: string }; setChatTheme?: (theme: string) => void } }
GlobalWorkerOptions.workerSrc = window.captureTest.worker
const noop = () => {}

/** The full-translation panel inside a themed main pane, as in the app. */
function Fixture() {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null), [theme, setTheme] = useState('warm')
  useEffect(() => { window.setChatTheme = setTheme }, [])
  useEffect(() => { const task = getDocument('singularity-layout://paper/document.pdf'); void task.promise.then(setPdf); return () => { void task.destroy() } }, [])
  return <main className="main-content" data-chat-theme={theme} style={{ position: 'fixed', inset: 16, display: 'flex' }}>
    <div style={{ flex: '0 0 760px', display: 'flex', minHeight: 0 }}>
      <DocumentTranslationPanel document={window.captureTest.document} scope="body" pdf={pdf} busy={false} onScope={noop} onStart={noop} onClose={noop} onJump={noop}/>
    </div>
  </main>
}
createRoot(document.getElementById('root')!).render(<Fixture/>)
