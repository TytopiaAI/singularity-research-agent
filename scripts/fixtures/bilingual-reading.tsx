// Actual reader/PDF with isolated, explicitly offline translation samples.
import { createRoot } from 'react-dom/client'
import '../../src/renderer/scrollbars'
import { GlobalWorkerOptions } from 'pdfjs-dist'
import { ContinuousReadingWorkspace } from '../../src/renderer/ContinuousReadingWorkspace'
import type { DocumentTranslation } from '../../src/shared/document-translation'
import type { PaperRecord } from '../../src/shared/types'
import '../../src/renderer/styles.css'
import '../../src/renderer/workspace.css'
import '../../src/renderer/acrylic.css'
import '../../src/renderer/reader-translation.css'
import '../../src/renderer/design.css'

declare global { interface Window { bilingualTest: { document: DocumentTranslation; worker: string; pageCount: number } } }
GlobalWorkerOptions.workerSrc = window.bilingualTest.worker
const paper = { id: 'bilingual-fixture', title: 'Reason Through the Latent! Making Latent Visual Reasoning Necessary', readingPage: 4, pageCount: window.bilingualTest.pageCount, checksum: 'fixture', indexStatus: 'ready' } as PaperRecord
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
Object.assign(window, { singularity: {
  papers: { update: async () => paper, artifacts: async () => [], readerCards: async () => [], noteVersions: async () => [],
    documentTranslation: async () => copy(window.bilingualTest.document), translateDocument: async () => copy(window.bilingualTest.document) },
  knowledge: { sources: async () => [], annotations: async () => [], insights: async () => [] },
} })
createRoot(document.getElementById('root')!).render(<div className="app-shell sidebar-open"><aside className="app-sidebar"/><header className="titlebar"/><main className="main-content" data-chat-theme="transparent"><ContinuousReadingWorkspace paper={paper} onClose={() => {}}/></main></div>)
