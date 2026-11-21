// Development-only fixture: the production PDF page, real PDF.js, no model/API/data access.
import { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import { ContinuousPdfPage } from '../../src/renderer/ContinuousPdfPage'
import type { PaperArtifact, PaperReview } from '../../src/shared/types'
import '../../src/renderer/styles.css'
import '../../src/renderer/workspace.css'
import '../../src/renderer/acrylic.css'

declare global {
  interface Window {
    pdfHighlightTest: {
      data: number[]; worker: string; errors: string[]
      setScale?: (scale: number) => void
      expected?: Array<{ page: number; text: string; x: number; y: number; width: number; fontSize: number }>
    }
  }
}

const review: PaperReview = { version: 1, sections: [
  { key: 'problem', body: '问题', evidence: [{ page: 1, quote: 'Research methods provide reliable results.' }] },
  { key: 'innovation', body: '贡献', evidence: [{ page: 1, quote: 'transparent methods and reproducible experiments.' }] },
  { key: 'method', body: '方法', evidence: [{ page: 1, quote: 'A larger heading uses different font metrics.' }] },
  { key: 'results', body: '结果', evidence: [{ page: 2, quote: 'External validation needs independent evidence.' }] },
] }
const answers: PaperArtifact[] = [{
  id: 'answer', paperId: 'test', kind: 'question-answer', status: 'complete', progress: 100,
  sessionId: null, markdownPath: '', error: null, createdAt: '', updatedAt: '',
  answer: { version: 1, body: '验证', color: '#C8E6F6', evidence: [{ page: 1, quote: 'controlled experiments' }] },
}]

function Fixture({ pdf }: { pdf: PDFDocumentProxy }) {
  const [scale, setScale] = useState(1)
  window.pdfHighlightTest.setScale = setScale
  const scrollRoot = useRef<HTMLDivElement>(null)
  return <div ref={scrollRoot} style={{ height: '100vh', overflow: 'auto', padding: 16 }}>
    <div style={{ display: 'flex', alignItems: 'start', gap: 24, width: 'max-content' }}>
      {[1, 2].map((pageNumber) => <ContinuousPdfPage key={pageNumber}
        pdf={pdf} pageNumber={pageNumber} scale={scale} tool="select" scrollRoot={scrollRoot}
        paragraphs={[]} noteCards={[]} translatedCards={[]} preview={null} review={review}
        visibleReviewKeys={['problem', 'innovation', 'method', 'results']}
        answerArtifacts={answers} evidenceTarget={null}
        onParagraph={() => {}} onSelection={() => {}} onRegion={() => {}} onErase={() => {}}
        onEvidenceReached={() => {}} onError={(error) => window.pdfHighlightTest.errors.push(error)} />)}
    </div>
  </div>
}

async function main() {
  GlobalWorkerOptions.workerSrc = window.pdfHighlightTest.worker
  const pdf = await getDocument({ data: new Uint8Array(window.pdfHighlightTest.data), isEvalSupported: false }).promise
  const expected = []
  for (const pageNumber of [1, 2]) {
    const page = await pdf.getPage(pageNumber), viewport = page.getViewport({ scale: 1 })
    for (const item of (await page.getTextContent()).items) {
      if (!('str' in item) || !item.str.trim()) continue
      const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
      expected.push({ page: pageNumber, text: item.str, x: x / viewport.width, y: y / viewport.height,
        width: item.width * viewport.userUnit / viewport.width,
        fontSize: Math.hypot(item.transform[2], item.transform[3]) * viewport.userUnit })
    }
  }
  window.pdfHighlightTest.expected = expected
  createRoot(document.getElementById('root')!).render(<Fixture pdf={pdf} />)
}
void main().catch((error) => window.pdfHighlightTest.errors.push(String(error)))
