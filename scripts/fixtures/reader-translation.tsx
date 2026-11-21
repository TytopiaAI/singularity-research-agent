// Isolated UI verification: production reader + real PDF.js, simulated AI only.
import { createRoot } from 'react-dom/client'
import '../../src/renderer/scrollbars'
import { GlobalWorkerOptions } from 'pdfjs-dist'
import { ContinuousReadingWorkspace } from '../../src/renderer/ContinuousReadingWorkspace'
import type { DocumentTranslation } from '../../src/shared/document-translation'
import type { PaperArtifact, PaperRecord, ReaderCard, ReaderQuestionContext } from '../../src/shared/types'
import '../../src/renderer/styles.css'
import '../../src/renderer/workspace.css'
import '../../src/renderer/acrylic.css'
import '../../src/renderer/reader-translation.css'

declare global { interface Window { readerTest: {
  worker: string; document: DocumentTranslation; requests: Array<{ text: string; segments: unknown[] }>; fullRequests: string[]
  questions: Array<{ question: string; contexts: ReaderQuestionContext[] }>; failQuestion?: boolean
} } }
GlobalWorkerOptions.workerSrc = window.readerTest.worker
const paper: PaperRecord = { id: 'fixture', title: 'Scientific reasoning and reproducible evidence', sourcePath: '', fileName: 'paper.pdf', checksum: 'fixture', size: 1, modifiedAt: 0, authors: [], year: 2026, doi: null, language: 'en', pageCount: 3, indexStatus: 'ready', missing: false, createdAt: '', updatedAt: '' }
let cards: ReaderCard[] = [], artifacts: PaperArtifact[] = []
const document = window.readerTest.document
window.readerTest.questions = []
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
Object.assign(window, { singularity: {
  papers: {
    update: async () => paper, artifacts: async () => copy(artifacts), readerCards: async () => copy(cards), noteVersions: async () => [],
    startArtifact: async (_id: string, _kind: string, text: string, pageNumber: number, rects: ReaderCard['rects'], segments: NonNullable<ReaderCard['segments']>, contexts: ReaderQuestionContext[] = []) => {
      if (_kind === 'question-answer') {
        if (window.readerTest.failQuestion) { window.readerTest.failQuestion = false; throw new Error('模拟问题提交失败') }
        window.readerTest.questions.push({ question: text, contexts: copy(contexts) })
        const id = `question-${window.readerTest.questions.length}`
        const artifact: PaperArtifact = { id, paperId: paper.id, kind: 'question-answer', status: 'complete', progress: 100, markdownPath: '', sessionId: null, error: null, createdAt: new Date().toISOString(), updatedAt: '', selection: text, questionContexts: copy(contexts), answer: { version: 1, body: '这些选段共同说明可复现的实验对可靠推理的重要性。', evidence: [], color: '#C8E6F6' } }
        artifacts.unshift(artifact)
        cards.push({ id, paperId: paper.id, kind: 'answer', artifactId: id, sectionKey: null, pageNumber, sourceText: text, content: artifact.answer!.body, rects, segments, noteColor: null, hidden: false, included: false, createdAt: artifact.createdAt, updatedAt: '' })
        return copy(artifact)
      }
      window.readerTest.requests.push({ text, segments })
      const id = `selection-${window.readerTest.requests.length}`, artifact: PaperArtifact = { id, paperId: paper.id, kind: 'selection-translation', status: 'running', progress: 5, markdownPath: '', sessionId: null, error: null, createdAt: new Date().toISOString(), updatedAt: '' }
      artifacts.unshift(artifact)
      cards.push({ id, paperId: paper.id, kind: 'translation', artifactId: id, sectionKey: null, pageNumber, sourceText: text, content: '', rects, segments, noteColor: null, hidden: false, included: false, createdAt: artifact.createdAt, updatedAt: '' })
      setTimeout(() => { artifact.status = 'complete'; cards.find((card) => card.id === id)!.content = '科学研究应采用透明、可复现的方法，并通过独立实验验证结果。跨页段落可以拼接后完整翻译。' }, 200)
      return copy(artifact)
    },
    documentTranslation: async () => copy(document),
    translateDocument: async (_id: string, scope: 'body' | 'appendix') => {
      const missing = document.blocks.filter((block) => block.scope === scope && block.kind !== 'formula' && !document.translations[block.id])
      if (missing.length) {
        window.readerTest.fullRequests.push(scope)
        document.running.push(scope)
        setTimeout(() => { for (const block of missing) document.translations[block.id] = block.kind === 'heading' ? '研究背景与方法' : '研究通过可复现的实验评估模型，并比较独立基线，以验证方法的可靠性。保留原始数学表达与参考引文。'; document.running = document.running.filter((item) => item !== scope) }, 100)
      }
      return copy(document)
    },
    setReaderCardState: async (id: string, hidden: boolean, included: boolean) => { const card = cards.find((card) => card.id === id)!; Object.assign(card, { hidden, included }); return copy(card) },
  },
  knowledge: { sources: async () => [], annotations: async () => [], insights: async () => [] },
} })
createRoot(globalThis.document.getElementById('root')!).render(<div className="app-shell sidebar-open"><aside className="app-sidebar"/><header className="titlebar"/><main className="main-content" data-chat-theme="transparent"><ContinuousReadingWorkspace paper={paper} onClose={() => {}}/></main></div>)
