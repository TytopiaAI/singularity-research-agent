import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import { DocumentTranslationPanel } from '../../src/renderer/DocumentTranslationPanel'
import { ReaderCardsPanel } from '../../src/renderer/ReaderCardsPanel'
import type { DocumentTranslation } from '../../src/shared/document-translation'
import type { PaperRecord, ReaderCard } from '../../src/shared/types'
import '../../src/renderer/styles.css'
import '../../src/renderer/workspace.css'
import '../../src/renderer/acrylic.css'
import '../../src/renderer/reader-translation.css'
import '../../src/renderer/design.css'

declare global { interface Window { layoutTest: { document: DocumentTranslation; worker: string } } }
GlobalWorkerOptions.workerSrc = window.layoutTest.worker
Object.assign(window, { singularity: { papers: { noteVersions: async () => [] } } })
const paper = { id: 'layout-fixture', indexStatus: 'ready' } as PaperRecord
const cards: ReaderCard[] = ['problem', 'method', 'innovation'].map((sectionKey, index) => ({
  id: `color-${index}`, paperId: paper.id, kind: 'summary', sectionKey, artifactId: null,
  pageNumber: 4, sourceText: '', content: '卡片背景使用更浅的柔和色彩，边缘保留方向颜色。长段落阅读时，正文与背景之间应保持清晰的对比。',
  rects: [], noteColor: null, hidden: false, included: true, createdAt: '', updatedAt: '',
})) as ReaderCard[]
cards.push({ ...cards[0], id: 'note-color', kind: 'note', sectionKey: null, noteColor: '#F7C5CC', content: '笔记卡片也采用轻浅底色，保持相同的阅读风格。' })
const noop = () => {}, resolved = async () => {}
function Fixture() {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  useEffect(() => { const task = getDocument('singularity-layout://paper/document.pdf'); void task.promise.then(setPdf); return () => { void task.destroy() } }, [])
  return <div className="layout-check" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.65fr) minmax(360px, 1fr)', gap: 20, height: '100vh', padding: 20, boxSizing: 'border-box' }}>
    <style>{`.layout-check { background: radial-gradient(at 95% 45%, #f8dfe5, transparent 60%), #f5f5f3; } :root[data-theme="dark"] .layout-check { background: #202022; }`}</style>
    <DocumentTranslationPanel document={window.layoutTest.document} scope="body" pdf={pdf} busy={false} onScope={noop} onStart={noop} onClose={noop} onJump={noop}/>
    <ReaderCardsPanel paper={paper} cards={cards} artifacts={[]} busy={false} anchor={null} pendingTranslation={null} onNoteFocused={noop} onTranslate={resolved} onCancelTranslation={noop} onSummary={resolved} onQuestion={resolved} onSaveNote={resolved} onState={resolved} onRetry={resolved} onJump={noop} onEvidence={noop} onFinalize={async () => { throw Error('Not exercised') }} onClearAnchor={noop}/>
  </div>
}
createRoot(document.getElementById('root')!).render(<Fixture/>)
