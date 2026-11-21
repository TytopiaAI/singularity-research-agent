import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist'
import { ArrowLeft, ChevronLeft, ChevronRight, Eraser, Highlighter, ImagePlus, Languages, Link2, MousePointer2, NotebookPen, PanelRightClose, PanelRightOpen, PenLine, Type, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { ArtifactKind, PaperArtifact, PaperRecord, ReaderCard, ReaderNoteInput, ReaderRect, ReaderSegment, ReviewSectionKey } from '../shared/types'
import { ContinuousPdfPage, type CitationJump, type EvidenceTarget, type PageSelection, type ReaderTool } from './ContinuousPdfPage'
import { buildCitationIndex, readPdfTextRuns, type CitationLink } from './citation-links'
import { ReaderCardsPanel, type ReaderAnchor } from './ReaderCardsPanel'
import { noteColors, type NoteColor } from '../shared/note-colors'
import { paragraphsOnPage, type DocumentParagraph } from './pdf-document-paragraphs'
import { findSource, type SourceBlock, type CardAnnotation, type FigureInsight } from '../shared/knowledge'
import { FigureCapture, FigureCards, SourceIndex } from './KnowledgePanels'
import { isTranslatableParagraph } from '../shared/academic-text'
import { stitchSelections } from './reader-selection'
import { DocumentTranslationPanel } from './DocumentTranslationPanel'
import { ReaderToolbar } from './ReaderToolbar'
import type { DocumentTranslation, TranslationBlock, TranslationScope } from '../shared/document-translation'
import type { ReaderQuestionContext } from '../shared/types'
import { validateQuestionContexts } from '../shared/reader-question-context'

export function ContinuousReadingWorkspace({ paper, onClose, initialNoteOpen = false, initialSourceId }: { paper: PaperRecord; onClose: () => void; initialNoteOpen?: boolean; initialSourceId?: string }) {
  const [page, setPage] = useState(paper.readingPage ?? 1)
  const [scale, setScale] = useState(1)
  const [panel, setPanel] = useState(true)
  const [panelWidth, setPanelWidth] = useState(400)
  const [panelMode, setPanelMode] = useState<'cards' | 'document'>('cards')
  const [translationDocument, setTranslationDocument] = useState<DocumentTranslation | null>(null)
  const [translationScope, setTranslationScope] = useState<TranslationScope>('body')
  const [stitchMode, setStitchMode] = useState(false)
  const [stitches, setStitches] = useState<PageSelection[]>([])
  const [questionContexts, setQuestionContexts] = useState<ReaderQuestionContext[]>([])
  const [questionDraft, setQuestionDraft] = useState('')
  const [questionFocusSignal, setQuestionFocusSignal] = useState(0)
  const [translationStarting, setTranslationStarting] = useState(false)
  const selectionRequests = useRef(new Set<string>())
  const [selectionPosition, setSelectionPosition] = useState({ left: 18, top: 70 })
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [documentParagraphs, setDocumentParagraphs] = useState<DocumentParagraph[]>([])
  const [sources, setSources] = useState<SourceBlock[]>([])
  const [annotations, setAnnotations] = useState<CardAnnotation[]>([])
  const [insights, setInsights] = useState<FigureInsight[]>([])
  const [sourceTarget, setSourceTarget] = useState<SourceBlock | null>(null)
  const [figureSelection, setFigureSelection] = useState<PageSelection | null>(null)
  const [selection, setSelection] = useState<PageSelection | null>(null)
  const [pending, setPending] = useState<PageSelection | null>(null)
  const [preview, setPreview] = useState<PageSelection | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [tool, setTool] = useState<ReaderTool>('select')
  const [toolColor, setToolColor] = useState<NoteColor>(noteColors[0].value)
  const [newNoteSignal, setNewNoteSignal] = useState(0)
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<ReaderAnchor | null>(null)
  const [artifacts, setArtifacts] = useState<PaperArtifact[]>([])
  const [cards, setCards] = useState<ReaderCard[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [summaryStarting, setSummaryStarting] = useState(false)
  const [evidenceTarget, setEvidenceTarget] = useState<EvidenceTarget | null>(null)
  const [citationLinks, setCitationLinks] = useState<CitationLink[]>([])
  const [jumpTarget, setJumpTarget] = useState<CitationJump | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const scrollRoot = useRef<HTMLDivElement>(null)
  const initialLocated = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!body.current) return
    const observer = new ResizeObserver(([entry]) => setPanelWidth((width) => Math.max(240, Math.min(width, entry.contentRect.width * .72))))
    observer.observe(body.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (panelMode !== 'document') return
    let active = true, checking = false
    const check = async () => {
      if (checking) return
      checking = true
      try { const result = await window.singularity.papers.documentTranslation(paper.id); if (active) setTranslationDocument(result) }
      catch (error) { if (active) setError(String(error)) }
      finally { checking = false }
    }
    void check()
    const timer = setInterval(() => void check(), 1500)
    return () => { active = false; clearInterval(timer) }
  }, [paper.id, panelMode])

  useEffect(() => {
    let active = true
    const load = getDocument({ url: `singularity-paper://paper/${paper.id}`, isEvalSupported: false })
    void load.promise.then((document) => { if (active) setPdf(document) }).catch((reason) => { if (active) setError(String(reason)) })
    return () => { active = false; void load.destroy() }
  }, [paper.id])
  useEffect(() => {
    if (!pdf) { setCitationLinks([]); return }
    let active = true
    setCitationLinks([])
    void readPdfTextRuns(pdf, () => active)
      .then((pages) => { if (active) setCitationLinks(buildCitationIndex(pages)) })
      .catch(() => { /* markers are a convenience; a broken index must not block reading */ })
    return () => { active = false }
  }, [pdf])
  useEffect(() => {
    if (!pdf) return
    let active = true
    setDocumentParagraphs([])
    void (async () => {
      const blocks = await window.singularity.knowledge.sources(paper.id)
      if (active) { setSources(blocks); setDocumentParagraphs(blocks.filter((item) => item.kind === 'paragraph').map((item) => ({ id: item.id, text: item.text, startPage: item.parts[0].page, parts: item.parts }))) }
    })().catch((reason) => { if (active) setError(String(reason)) })
    return () => { active = false }
  }, [pdf])
  const pageParagraphs = useMemo(() => Array.from({ length: pdf?.numPages ?? 0 }, (_, index) => paragraphsOnPage(documentParagraphs, index + 1)), [documentParagraphs, pdf])
  // Hit-testing runs on every mouse move, so each page only carries its own links.
  const linksByPage = useMemo(() => {
    const map = new Map<number, CitationLink[]>()
    for (const link of citationLinks) {
      const bucket = map.get(link.page)
      if (bucket) bucket.push(link)
      else map.set(link.page, [link])
    }
    return map
  }, [citationLinks])
  useEffect(() => {
    let active = true
    const check = async () => {
      const [items, readerCards, labels, figures] = await Promise.all([window.singularity.papers.artifacts(paper.id), window.singularity.papers.readerCards(paper.id), window.singularity.knowledge.annotations(paper.id), window.singularity.knowledge.insights(paper.id)])
      if (active) { setArtifacts(items); setCards(readerCards); setAnnotations(labels); setInsights(figures) }
    }
    void check().catch((reason) => { if (active) setError(String(reason)) })
    const timer = setInterval(() => void check().catch(() => {}), 1500)
    return () => { active = false; clearInterval(timer) }
  }, [paper.id])
  useEffect(() => {
    const timer = setTimeout(() => void window.singularity.papers.update(paper.id, { readingPage: page }).catch(() => {}), 350)
    return () => clearTimeout(timer)
  }, [paper.id, page])
  useEffect(() => {
    if (preview && cards.some((card) => card.kind === 'translation' && !card.hidden && card.pageNumber === preview.page && !!card.content.trim() && card.sourceText.replace(/\s+/g, ' ').trim() === preview.text.replace(/\s+/g, ' ').trim())) { setPreview(null); setSourceTarget(null) }
  }, [cards, preview])
  useEffect(() => {
    if (!pdf || page <= 1) return
    const timer = setTimeout(() => scrollRoot.current?.querySelector(`[data-page="${page}"]`)?.scrollIntoView({ block: 'start' }), 120)
    return () => clearTimeout(timer)
    // Restore the saved page only after the document has been mounted.
  }, [pdf])

  const jump = useCallback((target: number) => {
    const number = Math.max(1, Math.min(pdf?.numPages ?? paper.pageCount, target))
    setPage(number)
    scrollRoot.current?.querySelector(`[data-page="${number}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [pdf, paper.pageCount])
  const jumpSource = (source: SourceBlock): void => { setSourceTarget({...source}); jump(source.parts[0].page) }
  const openCitation = useCallback((link: CitationLink): void => {
    setJumpTarget({ page: link.target.page, rect: link.target.rect, token: Date.now() })
    jump(link.target.page)
  }, [jump])
  const locateTranslation = (block: TranslationBlock): void => {
    setSourceTarget({ id: `translation-${block.id}`, paperId: paper.id, checksum: paper.checksum, kind: block.kind === 'figure' || block.kind === 'table' ? block.kind : 'paragraph', label: '译文对应原文', text: block.text, parts: block.parts, image: null, createdAt: '' })
    setPage(block.parts[0].page)
    scrollRoot.current?.querySelector(`[data-page="${block.parts[0].page}"]`)?.scrollIntoView({ block: 'start' })
  }
  useEffect(() => { if(initialLocated.current===initialSourceId)return;const source = findSource(sources, initialSourceId); if (source) { initialLocated.current=initialSourceId;setSourceTarget(source); jump(source.parts[0].page) } }, [initialSourceId, sources, jump])
  const refreshKnowledge = async (): Promise<void> => {
    const [blocks, labels, figures] = await Promise.all([window.singularity.knowledge.sources(paper.id), window.singularity.knowledge.annotations(paper.id), window.singularity.knowledge.insights(paper.id)])
    setSources(blocks); setAnnotations(labels); setInsights(figures)
  }
  const trackPage = () => {
    const root = scrollRoot.current
    if (!root) return
    const edge = root.getBoundingClientRect().top + 105
    const first = Array.from(root.querySelectorAll<HTMLElement>('.continuous-page-frame')).find((item) => item.getBoundingClientRect().bottom > edge)
    if (first) setPage(Number(first.dataset.page) || 1)
  }
  const start = async (kind: ArtifactKind, text?: string, sourcePage = page, rects: ReaderRect[] = [], segments: ReaderSegment[] = [], contexts: ReaderQuestionContext[] = []): Promise<void> => {
    setBusy(true); setError(''); setPanel(true)
    try {
      const artifact = await window.singularity.papers.startArtifact(paper.id, kind, text, sourcePage, rects, segments, contexts)
      setArtifacts((items) => [artifact, ...items])
      setCards(await window.singularity.papers.readerCards(paper.id))
    } catch (reason) { setError(String(reason)); throw reason }
    finally { setBusy(false) }
  }
  const addQuestionContext = (chosen: PageSelection): boolean => {
    try {
      const segments = chosen.segments ?? [{ page: chosen.page, rects: chosen.rects }]
      const duplicate = questionContexts.some(item => item.text === chosen.text.trim() && item.segments.map(part => part.page).join(',') === segments.map(part => part.page).join(','))
      if (!duplicate) setQuestionContexts(validateQuestionContexts([...questionContexts, { id: crypto.randomUUID(), text: chosen.text, page: chosen.page, segments }], paper.pageCount))
      setError(''); setPanel(true); setPanelMode('cards'); setSelection(null); setPaletteOpen(false)
      setQuestionFocusSignal(signal => signal + 1)
      window.getSelection()?.removeAllRanges()
      return true
    } catch (reason) { setError(String(reason)); return false }
  }
  const askQuestion = (question: string): Promise<void> => {
    const first = questionContexts[0]
    return start('question-answer', question, first?.page ?? page, first?.segments[0].rects ?? [], first?.segments ?? [], questionContexts)
  }
  const updateCard = async (card: ReaderCard, hidden: boolean, included: boolean): Promise<void> => {
    const updated = await window.singularity.papers.setReaderCardState(card.id, hidden, included)
    setCards((items) => items.map((item) => item.id === updated.id ? updated : item))
  }
  const saveReaderNote = async (input: ReaderNoteInput): Promise<void> => {
    const saved = await window.singularity.papers.saveReaderNote(input)
    setCards((items) => input.id ? items.map((item) => item.id === saved.id ? saved : item) : [...items, saved])
  }
  const chooseParagraph = (chosen: PageSelection) => {
    if (paper.indexStatus !== 'ready') return
    // A click on an axis label, an equation number or a table cell has no
    // paragraph behind it; say so instead of opening an empty translation card.
    if (!isTranslatableParagraph(chosen.text)) { setError('这里没有可翻译的段落，请点在正文段落上。'); return }
    setSelection(null)
    setPaletteOpen(false)
    const matching = cards.find((card) => card.kind === 'translation' && card.pageNumber === chosen.page && card.sourceText.replace(/\s+/g, ' ').trim() === chosen.text.replace(/\s+/g, ' ').trim())
    setAnchor(chosen)
    const source = sources.find((item) => item.kind === 'paragraph' && item.text === chosen.text)
    if (source) setSourceTarget(source)
    setPanel(true)
    setPanelMode('cards')
    if (matching) {
      setPending(null)
      setPreview(matching.content.trim() ? null : chosen)
      if (matching.hidden) void updateCard(matching, false, matching.included).catch((reason) => setError(String(reason)))
      setTimeout(() => document.getElementById(`reader-card-${matching.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80)
    } else { setPending(chosen); setPreview(chosen); setTimeout(() => document.querySelector('.reader-card-scroll')?.scrollTo({ top: 0, behavior: 'smooth' }), 0) }
  }
  const translateSelection = async (chosen: PageSelection): Promise<void> => {
    const key = `${chosen.page}:${chosen.text.replace(/\s+/g, ' ').trim()}`
    if (selectionRequests.current.has(key)) return
    const matching = cards.find((card) => card.kind === 'translation' && card.pageNumber === chosen.page && card.sourceText.replace(/\s+/g, ' ').trim() === chosen.text.replace(/\s+/g, ' ').trim() && artifacts.find((artifact) => artifact.id === card.artifactId)?.status !== 'failed')
    if (matching) return
    selectionRequests.current.add(key)
    try { await start('selection-translation', chosen.text, chosen.page, chosen.rects, chosen.segments); setPending((current) => current?.text === chosen.text ? null : current) }
    catch (error) { setError(String(error)) }
    finally { selectionRequests.current.delete(key) }
  }
  const handleSelection = (chosen: PageSelection): void => {
    if (tool === 'highlight') { void createHighlightedNote(chosen, toolColor); return }
    setSelection(chosen); setPaletteOpen(false); setPanel(true); setPanelMode('cards')
    const pane = scrollRoot.current?.parentElement?.getBoundingClientRect()
    const rects = Array.from(window.getSelection()?.getRangeAt(0).getClientRects() ?? [])
    const rect = rects.find((rect) => pane && rect.top >= pane.top + 58 && rect.bottom <= pane.bottom)
    if (pane && rect) setSelectionPosition({ left: Math.max(8, Math.min(rect.left - pane.left, pane.width - 330)), top: Math.max(64, rect.top - pane.top - 48) })
    if (stitchMode) {
      if (stitches.some((item) => item.page === chosen.page && item.text === chosen.text)) return
      try { const next = [...stitches, chosen], combined = stitchSelections(next); setStitches(next); setPending(combined); setPreview(combined); setSourceTarget(null) }
      catch (error) { setError(String(error)) }
    } else {
      chooseParagraph(chosen)
      setSelection(chosen)
      if (isTranslatableParagraph(chosen.text)) void translateSelection(chosen)
    }
  }
  const createHighlightedNote = async (chosen: PageSelection, color: NoteColor): Promise<void> => {
    try {
      const saved = await window.singularity.papers.saveReaderNote({ paperId: paper.id, content: '', pageNumber: chosen.page, sourceText: chosen.text, rects: chosen.rects, segments: chosen.segments, noteColor: color })
      setCards((items) => [...items, saved])
      setAnchor(chosen)
      setPending(null)
      setPreview(null)
      setFocusNoteId(saved.id)
      setPanel(true)
      setPanelMode('cards')
      setSelection(null)
      setPaletteOpen(false)
      window.getSelection()?.removeAllRanges()
    } catch (reason) { setError(String(reason)) }
  }
  const eraseHighlight = async (card: ReaderCard): Promise<void> => {
    try {
      const saved = await window.singularity.papers.saveReaderNote({ id: card.id, paperId: paper.id, content: card.content, pageNumber: null, sourceText: card.sourceText, rects: [], segments: [], noteColor: card.noteColor ?? toolColor })
      setCards((items) => items.map((item) => item.id === saved.id ? saved : item))
    } catch (reason) { setError(String(reason)) }
  }
  const beginTranslation = async () => {
    if (!pending?.text.trim()) return
    const chosen = pending
    await start('selection-translation', chosen.text, chosen.page, chosen.rects, chosen.segments)
    setPending(null)
    setStitches([]); setSelection(null)
  }
  const openFullTranslation = (): void => {
    setPanel(true); setPanelMode('document'); setTranslationScope('body')
    setSelection(null); setPaletteOpen(false); setPreview(null); setSourceTarget(null)
    window.getSelection()?.removeAllRanges()
    setPanelWidth(Math.max(340, Math.round((body.current?.clientWidth ?? 1000) * .48)))
    setTranslationStarting(true)
    void window.singularity.papers.translateDocument(paper.id, 'body').then(setTranslationDocument).catch((error) => setError(String(error))).finally(() => setTranslationStarting(false))
  }
  const startFullTranslation = async (): Promise<void> => {
    setTranslationStarting(true); setError('')
    try { setTranslationDocument(await window.singularity.papers.translateDocument(paper.id, translationScope)) }
    catch (error) { setError(String(error)) }
    finally { setTranslationStarting(false) }
  }
  const beginSummary = async (): Promise<void> => {
    setSummaryStarting(true)
    try { await start('summary') }
    finally { setSummaryStarting(false) }
  }
  const currentReviewArtifact = artifacts.find((item) => item.kind === 'summary' && item.status === 'complete' && item.review)
  const currentReview = currentReviewArtifact?.review ?? null
  const visibleReviewKeys = cards.filter((card) => card.kind === 'summary' && card.artifactId === currentReviewArtifact?.id && !card.hidden && card.sectionKey).map((card) => card.sectionKey!) as ReviewSectionKey[]
  const answerArtifacts = artifacts.filter((artifact) => artifact.kind === 'question-answer' && artifact.status === 'complete' && artifact.answer && cards.some((card) => card.kind === 'answer' && !card.hidden && card.artifactId === artifact.id))
  const noteCards = cards.filter((card) => card.kind === 'note' && !card.hidden)
  const translatedCards = cards.filter((card) => card.kind === 'translation' && !card.hidden && isTranslatableParagraph(card.sourceText) && !!card.content.trim())
  return <section className="reading-workspace">
    <header className="reader-header"><button aria-label="返回论文库" onClick={onClose}><ArrowLeft size={18}/></button><strong title={paper.title}>{paper.title}</strong><button className="reader-full-translation" disabled={translationStarting || paper.indexStatus !== 'ready'} onClick={openFullTranslation}><Languages size={16}/>全文翻译</button><button onClick={() => { setPanel(true); setPanelMode('cards') }}>阅读卡片</button><button aria-label={panel ? '隐藏翻译栏' : '显示翻译栏'} onClick={() => setPanel(!panel)}>{panel ? <PanelRightClose size={18}/> : <PanelRightOpen size={18}/>}</button></header>
    {error && <div role="alert" className="inline-error">{error}<button onClick={() => setError('')}><X size={14}/></button></div>}
    <div ref={body} className={`reading-columns ${panel ? '' : 'panel-hidden'}`} style={{ gridTemplateColumns: panel ? `minmax(0,1fr) 8px ${panelWidth}px` : 'minmax(0,1fr)' }}>
      <section className="pdf-pane">
        <ReaderToolbar>
          <div className="reader-toolbar-group" role="group" aria-label="标注工具">
            <button aria-label="选择与段落翻译" title="选择与段落翻译" aria-pressed={tool === 'select'} onClick={() => setTool('select')}><MousePointer2 size={17}/></button>
            <button aria-label="拼接跨页段落" title="拼接模式：依次划选多段文字，完成后一起翻译" aria-pressed={stitchMode} onClick={() => { setStitchMode(!stitchMode); setStitches([]); setPending(null); setPreview(null); setSelection(null); setTool('select'); window.getSelection()?.removeAllRanges() }}><Link2 size={17}/></button>
            <button aria-label="划选高亮并记笔记" title="划选高亮并记笔记" aria-pressed={tool === 'highlight'} onClick={() => setTool('highlight')}><Highlighter size={17}/></button>
            <button aria-label="新建文字笔记" title="新建文字笔记" onClick={() => { setPanel(true); setPanelMode('cards'); setAnchor(null); setNewNoteSignal((value) => value + 1) }}><Type size={18}/></button>
            <button aria-label="框选区域并记笔记" title="框选区域并记笔记" aria-pressed={tool === 'region'} onClick={() => setTool('region')}><PenLine size={17}/></button>
            <button aria-label="图表框选" title="框选图表，保存原文定位与解读卡片" aria-pressed={tool === 'figure'} onClick={() => setTool('figure')}><ImagePlus size={17}/></button>
            <button aria-label="擦除高亮标注" title="擦除高亮标注（保留笔记）" aria-pressed={tool === 'erase'} onClick={() => setTool('erase')}><Eraser size={17}/></button>
          </div>
          <div className="reader-toolbar-group reader-toolbar-colors" role="group" aria-label="高亮颜色">
            {noteColors.map((color) => <button key={color.value} className="reader-toolbar-swatch" title={color.label} aria-label={`高亮颜色${color.label}`} aria-pressed={toolColor.toUpperCase() === color.value} style={{ backgroundColor: color.value }} onClick={() => { setToolColor(color.value); if (tool === 'select' || tool === 'erase') setTool('highlight') }}/>) }
            <label className="reader-toolbar-custom" title="自定义高亮颜色"><input type="color" aria-label="自定义高亮颜色" value={toolColor} onChange={(event) => { setToolColor(event.target.value.toUpperCase()); setTool('highlight') }}/><span>自定义</span></label>
          </div>
          <div className="reader-toolbar-group reader-toolbar-pages" role="group" aria-label="页码导航"><button aria-label="上一页" disabled={page <= 1} onClick={() => jump(page - 1)}><ChevronLeft size={16}/></button><span>第 <input aria-label="页码" type="number" min={1} max={pdf?.numPages ?? paper.pageCount} value={page} onChange={(event) => jump(Number(event.target.value) || 1)}/> / {pdf?.numPages ?? paper.pageCount} 页</span><button aria-label="下一页" disabled={page >= (pdf?.numPages ?? paper.pageCount)} onClick={() => jump(page + 1)}><ChevronRight size={16}/></button></div>
          <div className="reader-toolbar-group reader-toolbar-zoom" role="group" aria-label="缩放"><button aria-label="缩小" onClick={() => setScale(Math.max(.4, scale - .1))}><ZoomOut size={16}/></button><span>{Math.round(scale * 100)}%</span><button aria-label="放大" onClick={() => setScale(Math.min(2.5, scale + .1))}><ZoomIn size={16}/></button></div>
        </ReaderToolbar>
        {paper.indexStatus !== 'ready' && <p className="reader-notice">此 PDF 需要 OCR，暂不支持文字翻译。</p>}
        {stitchMode && <div className="reader-stitch-bar"><Link2 size={14}/><span>拼接模式 · 已选 {stitches.length} 段，继续划选下一页</span><button disabled={!stitches.length || busy} onClick={() => void beginTranslation().catch((error) => setError(String(error)))}>合并翻译</button><button disabled={!stitches.length} onClick={() => { const chosen = stitchSelections(stitches); if (chosen && addQuestionContext(chosen)) { setStitches([]); setPending(null); setPreview(null) } }}>合并添加上下文</button><button disabled={!stitches.length} onClick={() => { const next = stitches.slice(0, -1); setStitches(next); const value = stitchSelections(next); setPending(value); setPreview(value) }}>撤销上一段</button></div>}
        {selection && paper.indexStatus === 'ready' && <div className="selection-tools selection-note-tools" style={selectionPosition} onMouseDown={(event) => event.preventDefault()}><span>{selection.text.slice(0, 55)}…</span><button onClick={() => void navigator.clipboard.writeText(selection.text).catch((error) => setError(String(error)))}>复制</button><button type="button" className="reader-add-question-context" onClick={() => addQuestionContext(selection)}><Link2 size={15}/>添加到提问上下文</button><button aria-expanded={paletteOpen} onClick={() => setPaletteOpen(!paletteOpen)}><NotebookPen size={15}/>高亮并记笔记</button><button aria-label="关闭选区工具" onClick={() => { setSelection(null); setPaletteOpen(false); window.getSelection()?.removeAllRanges() }}><X size={14}/></button>{paletteOpen && <div className="note-color-palette" role="group" aria-label="选择笔记高亮颜色">{noteColors.map((color) => <button key={color.value} className="note-color-swatch" title={color.label} aria-label={`${color.label}高亮并记笔记`} style={{ backgroundColor: color.value }} onClick={() => void createHighlightedNote(selection, color.value)}/>)}</div>}</div>}
        <div ref={scrollRoot} className="canvas-scroll continuous-pdf-scroll" onScroll={trackPage}>
          {pdf && Array.from({ length: pdf.numPages }, (_, index) => <ContinuousPdfPage key={index + 1} pdf={pdf} pageNumber={index + 1} scale={scale} tool={tool} scrollRoot={scrollRoot} sourceTarget={sourceTarget} citationLinks={linksByPage.get(index + 1)} jumpTarget={jumpTarget} onCitation={openCitation} paragraphs={pageParagraphs[index] ?? []} noteCards={noteCards} translatedCards={translatedCards} preview={preview} review={currentReview} visibleReviewKeys={visibleReviewKeys} answerArtifacts={answerArtifacts} evidenceTarget={evidenceTarget} onParagraph={chooseParagraph} onSelection={handleSelection} onRegion={(value) => { if (tool === 'figure') setFigureSelection(value); else void createHighlightedNote(value, toolColor) }} onErase={(card) => void eraseHighlight(card)} onError={setError} onEvidenceReached={() => setEvidenceTarget(null)}/>)}
        </div>
      </section>
      {panel && <><div className="reader-resizer" role="separator" aria-label="调整卡片栏宽度" tabIndex={0} aria-orientation="vertical" onKeyDown={(event) => { if (event.key === 'ArrowLeft') setPanelWidth(Math.min((body.current?.clientWidth ?? 1000) * .72, panelWidth + 20)); if (event.key === 'ArrowRight') setPanelWidth(Math.max(280, panelWidth - 20)) }} onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId) && body.current) setPanelWidth(Math.max(280, Math.min(body.current.clientWidth * .72, body.current.clientWidth - 280, body.current.getBoundingClientRect().right - event.clientX))) }} onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}/>
        {panelMode === 'document' ? <DocumentTranslationPanel document={translationDocument} scope={translationScope} pdf={pdf} busy={translationStarting} onScope={setTranslationScope} onStart={() => void startFullTranslation()} onClose={() => setPanelMode('cards')} onJump={jump} onLocate={locateTranslation}/> : <ReaderCardsPanel paper={paper} cards={cards} artifacts={artifacts} sources={sources} annotations={annotations} onSource={jumpSource} onKnowledgeRefresh={() => void refreshKnowledge().catch((e) => setError(String(e)))} hasFigureNotes={insights.some((item) => !item.hidden && item.included && item.status === 'complete')} extras={<><SourceIndex sources={sources} onSource={jumpSource}/><FigureCards paper={paper} sources={sources} insights={insights} onSource={jumpSource} onRefresh={() => void refreshKnowledge().catch((e) => setError(String(e)))}/></>} busy={busy} summaryStarting={summaryStarting} anchor={anchor} pendingTranslation={pending} focusNoteId={focusNoteId} newNoteSignal={newNoteSignal} newNoteColor={toolColor} onNoteFocused={() => setFocusNoteId(null)} initialNoteOpen={initialNoteOpen}
          onTranslate={beginTranslation} onEditTranslation={(text) => setPending((current) => current ? { ...current, text } : current)} onCancelTranslation={() => { setPending(null); setPreview(null); setSourceTarget(null); setStitches([]) }}
          onSummary={beginSummary} onQuestion={askQuestion} questionContexts={questionContexts} onRemoveQuestionContext={id => { setQuestionContexts(items => items.filter(item => item.id !== id)); setError('') }} onClearQuestionContexts={() => { setQuestionContexts([]); setError('') }} questionFocusSignal={questionFocusSignal} questionDraft={questionDraft} onQuestionDraftChange={setQuestionDraft} onSaveNote={saveReaderNote} onState={updateCard}
          onRetry={async (card) => { await updateCard(card, true, card.included); await start(card.kind === 'answer' ? 'question-answer' : 'selection-translation', card.sourceText, card.pageNumber ?? page, card.rects, card.segments, card.kind === 'answer' ? artifacts.find(item => item.id === card.artifactId)?.questionContexts ?? [] : []) }}
          onJump={jump} onEvidence={(target, key, index) => { setEvidenceTarget({ kind: 'summary', page: target, key, index }); jump(target) }} onAnswerEvidence={(artifactId, target, index) => { setEvidenceTarget({ kind: 'answer', page: target, artifactId, index }); jump(target) }}
          onFinalize={() => window.singularity.papers.finalizeNote(paper.id)} onClearAnchor={() => setAnchor(null)}/>}</>}
    </div>
    {figureSelection && pdf && <FigureCapture pdf={pdf} paper={paper} selection={figureSelection} sources={sources} onSaved={() => void refreshKnowledge().catch((e) => setError(String(e)))} onClose={() => setFigureSelection(null)}/>}
  </section>
}

