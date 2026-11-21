// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaperArtifact, PaperRecord, ReaderCard } from '../shared/types'
import { ReaderCardsPanel } from './ReaderCardsPanel'

const paper: PaperRecord = {
  id: 'paper-1', sourcePath: 'test.pdf', fileName: 'test.pdf', checksum: 'test', size: 100,
  modifiedAt: 0, title: 'Test paper', authors: [], year: 2026, doi: null, language: 'en',
  pageCount: 2, indexStatus: 'ready', missing: false, createdAt: '', updatedAt: '',
}
const translated: ReaderCard = {
  id: 'card-1', paperId: paper.id, kind: 'translation', artifactId: null, sectionKey: null,
  pageNumber: 1, sourceText: 'Original paragraph that should not be shown', content: '这是已经完成的译文。',
  rects: [], noteColor: null, hidden: false, included: false, createdAt: '', updatedAt: '',
}
let host: HTMLDivElement
let root: Root

beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true, configurable: true })
  Object.defineProperty(window, 'singularity', { configurable: true, value: { papers: { noteVersions: vi.fn().mockResolvedValue([]) } } })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

describe('paragraph translation cards', () => {
  it('shows summary startup and failed-task feedback beside the summary action', async () => {
    const onSummary = vi.fn().mockResolvedValue(undefined)
    const props = {
      paper, cards: [], artifacts: [] as PaperArtifact[], busy: false, anchor: null, pendingTranslation: null,
      onNoteFocused: vi.fn(), onTranslate: vi.fn().mockResolvedValue(undefined), onCancelTranslation: vi.fn(),
      onSummary, onQuestion: vi.fn().mockResolvedValue(undefined), onSaveNote: vi.fn().mockResolvedValue(undefined),
      onState: vi.fn().mockResolvedValue(undefined), onRetry: vi.fn().mockResolvedValue(undefined),
      onJump: vi.fn(), onEvidence: vi.fn(), onFinalize: vi.fn().mockResolvedValue({}), onClearAnchor: vi.fn(),
    }
    await act(async () => root.render(<ReaderCardsPanel {...props} summaryStarting />))
    expect(host.querySelector('.reader-summary-status')?.textContent).toContain('正在启动论文总结')
    expect(host.querySelector<HTMLButtonElement>('.reader-card-header button.primary')?.disabled).toBe(true)
    const failed: PaperArtifact = { id: 'summary-failed', paperId: paper.id, sessionId: null, kind: 'summary', status: 'failed', progress: 5,
      markdownPath: '', error: '模型会话没有保存总结', createdAt: '', updatedAt: '' }
    await act(async () => root.render(<ReaderCardsPanel {...props} artifacts={[failed]} />))
    expect(host.querySelector('.reader-summary-status')?.textContent).toContain(failed.error)
    await act(async () => host.querySelector<HTMLButtonElement>('.reader-summary-status button')!.click())
    expect(onSummary).toHaveBeenCalledOnce()
    expect(host.querySelector('.reader-question-dock small')).toBeNull()
    onSummary.mockRejectedValueOnce(new Error('模型服务不可用'))
    await act(async () => host.querySelector<HTMLButtonElement>('.reader-card-header button.primary')!.click())
    expect(host.querySelector('.reader-summary-status')?.textContent).toContain('模型服务不可用')
  })
  it('waits for the translate button and hides the original after translation', async () => {
    const translate = vi.fn().mockResolvedValue(undefined)
    const props = {
      paper, cards: [translated], artifacts: [], busy: false, anchor: null,
      pendingTranslation: { page: 2, text: 'A second paragraph to translate', rects: [] },
      onTranslate: translate, onCancelTranslation: vi.fn(), onSummary: vi.fn().mockResolvedValue(undefined),
      onQuestion: vi.fn().mockResolvedValue(undefined), onSaveNote: vi.fn().mockResolvedValue(undefined),
      onState: vi.fn().mockResolvedValue(undefined), onRetry: vi.fn().mockResolvedValue(undefined),
      onJump: vi.fn(), onEvidence: vi.fn(), onFinalize: vi.fn().mockResolvedValue({}), onClearAnchor: vi.fn(), onNoteFocused: vi.fn(),
    }
    await act(async () => root.render(<ReaderCardsPanel {...props} />))
    expect(host.querySelector('.pending-translation-card')?.textContent).toContain('31 个字符')
    expect(translate).not.toHaveBeenCalled()
    expect(host.querySelector('[data-kind="translation"]')?.textContent).toContain('这是已经完成的译文。')
    const fragment: ReaderCard = { ...translated, id: 'fragment', sourceText: 'MME', content: '[p.1]\n\nMME' }
    await act(async () => root.render(<ReaderCardsPanel {...props} cards={[translated, fragment]} />))
    expect(host.textContent).not.toContain('MME')
    expect(host.querySelector('[data-kind="translation"]')?.textContent).not.toContain(translated.sourceText)
    await act(async () => host.querySelector<HTMLButtonElement>('.pending-translation-card button.primary')!.click())
    expect(translate).toHaveBeenCalledOnce()
  })
  it('renders an anchored note with its saved palette color and an inline editor', async () => {
    const note: ReaderCard = { ...translated, id: 'note-1', kind: 'note', artifactId: null, content: '', sourceText: 'Selected text', rects: [{ x: .1, y: .2, width: .3, height: .04 }], noteColor: '#F7C5CC', included: true }
    const props = {
      paper, cards: [note], artifacts: [], busy: false, anchor: null, pendingTranslation: null,
      focusNoteId: note.id, onNoteFocused: vi.fn(), onTranslate: vi.fn().mockResolvedValue(undefined), onCancelTranslation: vi.fn(),
      onSummary: vi.fn().mockResolvedValue(undefined), onQuestion: vi.fn().mockResolvedValue(undefined),
      onSaveNote: vi.fn().mockResolvedValue(undefined), onState: vi.fn().mockResolvedValue(undefined),
      onRetry: vi.fn().mockResolvedValue(undefined), onJump: vi.fn(), onEvidence: vi.fn(),
      onFinalize: vi.fn().mockResolvedValue({}), onClearAnchor: vi.fn(),
    }
    await act(async () => root.render(<ReaderCardsPanel {...props} />))
    expect(host.querySelector<HTMLElement>('[data-kind="note"]')?.style.getPropertyValue('--note-color')).toBe('#F7C5CC')
    expect(host.querySelector('[data-kind="note"] textarea')).not.toBeNull()
    expect(host.querySelector('[data-kind="note"]')?.textContent).not.toContain(note.sourceText)
    expect(host.querySelector('.note-editor-colors')).toBeNull()
  })
  it('shows grounded summary cards in their matching evidence colors and marks unsupported inferences', async () => {
    const artifact: PaperArtifact = { id: 'summary-1', paperId: paper.id, sessionId: null, kind: 'summary', status: 'complete', progress: 100, markdownPath: '', error: null, createdAt: '', updatedAt: '', review: { version: 1, sections: [
      { key: 'innovation', body: '关键贡献说明', evidence: [{ page: 1, quote: 'This is the key contribution.' }] },
      { key: 'future', body: '进一步验证建议', evidence: [] },
    ] } }
    const summaryCards: ReaderCard[] = [
      { ...translated, id: 'summary-1:innovation', kind: 'summary', artifactId: artifact.id, sectionKey: 'innovation', content: '关键贡献说明', sourceText: 'This is the key contribution.' },
      { ...translated, id: 'summary-1:future', kind: 'summary', artifactId: artifact.id, sectionKey: 'future', content: '进一步验证建议', sourceText: '', pageNumber: null },
    ]
    const onEvidence = vi.fn()
    await act(async () => root.render(<ReaderCardsPanel paper={paper} cards={summaryCards} artifacts={[artifact]} busy={false} anchor={null} pendingTranslation={null}
      onNoteFocused={vi.fn()} onTranslate={vi.fn().mockResolvedValue(undefined)} onCancelTranslation={vi.fn()} onSummary={vi.fn().mockResolvedValue(undefined)}
      onQuestion={vi.fn().mockResolvedValue(undefined)} onSaveNote={vi.fn().mockResolvedValue(undefined)} onState={vi.fn().mockResolvedValue(undefined)}
      onRetry={vi.fn().mockResolvedValue(undefined)} onJump={vi.fn()} onEvidence={onEvidence} onFinalize={vi.fn().mockResolvedValue({})} onClearAnchor={vi.fn()}/>))
    const innovation = host.querySelector<HTMLElement>('[data-review-key="innovation"]')!
    expect(innovation.style.getPropertyValue('--review-tint')).toBe('#FFF5E1')
    expect(innovation.textContent).toContain('关键贡献')
    expect(innovation.textContent).not.toContain('This is the key contribution.')
    expect(innovation.querySelector('.reader-card-pages button')?.textContent).toBe('p.1')
    expect(innovation.textContent).not.toContain('定位原文依据')
    await act(async () => innovation.querySelector<HTMLButtonElement>('.reader-card-pages button')!.click())
    expect(onEvidence).toHaveBeenCalledWith(1, 'innovation', 0)
    expect(host.querySelector('[data-review-key="future"]')?.textContent).toContain('暂无原文定位')
  })
  it('shows a verified Q&A quote in a uniquely colored answer card and navigates to it', async () => {
    const artifact: PaperArtifact = { id: 'answer-1', paperId: paper.id, sessionId: null, kind: 'question-answer', status: 'complete', progress: 100, markdownPath: '', error: null, createdAt: '', updatedAt: '', answer: { version: 1, body: '论文使用透明的方法。[p.1]', evidence: [{ page: 1, quote: 'Scientific evaluation uses transparent methods.' }], color: '#C8E6F6' } }
    const card: ReaderCard = { ...translated, id: artifact.id, kind: 'answer', artifactId: artifact.id, sourceText: '论文采用什么方法？', content: artifact.answer!.body }
    const onAnswerEvidence = vi.fn()
    await act(async () => root.render(<ReaderCardsPanel paper={paper} cards={[card]} artifacts={[artifact]} busy={false} anchor={null} pendingTranslation={null}
      onNoteFocused={vi.fn()} onTranslate={vi.fn().mockResolvedValue(undefined)} onCancelTranslation={vi.fn()} onSummary={vi.fn().mockResolvedValue(undefined)}
      onQuestion={vi.fn().mockResolvedValue(undefined)} onSaveNote={vi.fn().mockResolvedValue(undefined)} onState={vi.fn().mockResolvedValue(undefined)}
      onRetry={vi.fn().mockResolvedValue(undefined)} onJump={vi.fn()} onEvidence={vi.fn()} onAnswerEvidence={onAnswerEvidence}
      onFinalize={vi.fn().mockResolvedValue({})} onClearAnchor={vi.fn()}/>))
    const answer = host.querySelector<HTMLElement>('[data-kind="answer"]')!
    expect(answer.style.getPropertyValue('--answer-color')).toBe('#C8E6F6')
    expect(answer.textContent).toContain('Scientific evaluation uses transparent methods.')
    expect(answer.textContent).not.toContain('已核验')
    await act(async () => answer.querySelector<HTMLButtonElement>('.answer-evidence-list button')!.click())
    expect(onAnswerEvidence).toHaveBeenCalledWith(artifact.id, 1, 0)
  })
})
