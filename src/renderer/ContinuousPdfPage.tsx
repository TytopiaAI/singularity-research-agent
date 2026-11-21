import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react'
import { TextLayer, type PDFDocumentProxy } from 'pdfjs-dist'
import type { PaperArtifact, PaperReview, ReaderCard, ReaderRect, ReviewSectionKey } from '../shared/types'
import { paragraphAt, paragraphKey, translatedParagraphTexts } from './reader-paragraphs'
import type { PageParagraph } from './pdf-document-paragraphs'
import { locateEvidenceQuotes, locateReviewEvidence, type EvidenceRect } from './review-evidence'
import { reviewColors } from './review-colors'
import { defaultNoteColor } from '../shared/note-colors'
import type { SourceBlock } from '../shared/knowledge'
import { readPdfSelection } from './reader-selection'
import { linkIndexAtPoint, type CitationLink } from './citation-links'

export interface PageSelection { page: number; text: string; rects: ReaderRect[]; segments?: Array<{ page: number; rects: ReaderRect[] }> }
export type EvidenceTarget = { kind: 'summary'; page: number; key: ReviewSectionKey; index: number } | { kind: 'answer'; page: number; artifactId: string; index: number }
export type ReaderTool = 'select' | 'highlight' | 'region' | 'erase' | 'figure'
/** A pending citation hop; `token` lets the same spot be hopped to twice. */
export interface CitationJump { page: number; rect: ReaderRect; token: number }

export function ContinuousPdfPage({ pdf, pageNumber, scale, tool, scrollRoot, paragraphs, noteCards, translatedCards, preview, review, visibleReviewKeys, answerArtifacts, evidenceTarget, sourceTarget, citationLinks, jumpTarget, onCitation, onParagraph, onSelection, onRegion, onErase, onError, onEvidenceReached }: {
  sourceTarget?: SourceBlock | null
  pdf: PDFDocumentProxy; pageNumber: number; scale: number; tool: ReaderTool; scrollRoot: React.RefObject<HTMLDivElement | null>; paragraphs: PageParagraph[]
  noteCards: ReaderCard[]; translatedCards: ReaderCard[]; preview: PageSelection | null; review: PaperReview | null; visibleReviewKeys: ReviewSectionKey[]; answerArtifacts: PaperArtifact[]; evidenceTarget: EvidenceTarget | null
  citationLinks?: CitationLink[]; jumpTarget?: CitationJump | null; onCitation?: (link: CitationLink) => void
  onParagraph: (selection: PageSelection) => void; onSelection: (selection: PageSelection) => void; onRegion: (selection: PageSelection) => void; onErase: (card: ReaderCard) => void; onError: (message: string) => void; onEvidenceReached: () => void
}) {
  const wrapper = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [size, setSize] = useState({ width: 600 * scale, height: 800 * scale })
  const [renderEpoch, setRenderEpoch] = useState(0)
  const [renderedScale, setRenderedScale] = useState<number | null>(null)
  const [reviewGeometry, setReviewGeometry] = useState<{ scale: number; epoch: number; rects: EvidenceRect[] } | null>(null)
  const [answerGeometry, setAnswerGeometry] = useState<{ scale: number; epoch: number; rects: Array<EvidenceRect<string> & { color: string }> } | null>(null)
  const reviewEvidenceSignature = review ? JSON.stringify(review.sections.map((section) => [section.key, section.evidence])) : ''
  const answerEvidenceSignature = JSON.stringify(answerArtifacts.map((artifact) => [artifact.id, artifact.answer?.evidence, artifact.answer?.color]))
  const regionStart = useRef<{ x: number; y: number } | null>(null)
  const [regionDraft, setRegionDraft] = useState<ReaderRect | null>(null)
  const reachedSource = useRef<SourceBlock | null>(null)
  const reachedJump = useRef(0)
  const [hotLink, setHotLink] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    void pdf.getPage(pageNumber).then((page) => {
      if (!active) return
      const viewport = page.getViewport({ scale })
      setSize({ width: viewport.width, height: viewport.height })
    }).catch((error) => { if (active) onError(String(error)) })
    return () => { active = false }
  }, [pdf, pageNumber, scale])

  useEffect(() => {
    if (!wrapper.current || !scrollRoot.current) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { root: scrollRoot.current, rootMargin: '900px 0px' })
    observer.observe(wrapper.current)
    return () => observer.disconnect()
  }, [scrollRoot, pageNumber])

  // Indices point into this page's own link list, so a new list or tool must
  // drop whatever was hovered.
  useEffect(() => { setHotLink(null) }, [citationLinks, tool])

  useEffect(() => {
    if (!visible || !canvas.current || !layer.current || !wrapper.current) return
    let active = true
    setRenderedScale(null)
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined
    let textLayer: TextLayer | undefined
    setReviewGeometry(null)
    setAnswerGeometry(null)
    void (async () => {
      const page = await pdf.getPage(pageNumber)
      if (!active || !canvas.current || !layer.current || !wrapper.current) return
      const viewport = page.getViewport({ scale })
      const ratio = window.devicePixelRatio || 1
      const target = canvas.current
      target.width = Math.floor(viewport.width * ratio)
      target.height = Math.floor(viewport.height * ratio)
      target.style.width = `${viewport.width}px`
      target.style.height = `${viewport.height}px`
      setSize({ width: viewport.width, height: viewport.height })
      // Build each text layer separately: a cancelled zoom must never append
      // spans (or leave old font metrics) in the next render's live text layer.
      const textContainer = document.createElement('div')
      textContainer.className = 'textLayer'
      // Lay out selectable text in fixed PDF units, then transform the whole
      // layer with the canvas viewport. Reflowing tiny/large browser fonts at
      // every zoom introduces font-metric rounding into measured highlights.
      const textViewport = page.getViewport({ scale: 1 })
      textContainer.style.setProperty('--scale-factor', '1')
      textContainer.style.setProperty('--user-unit', '1')
      textContainer.style.transform = `scale(${scale * viewport.userUnit})`
      renderTask = page.render({ canvas: target, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] })
      await renderTask.promise
      if (!active || !layer.current || !wrapper.current) return
      const textContent = await page.getTextContent()
      if (!active || !layer.current || !wrapper.current) return
      textLayer = new TextLayer({ textContentSource: textContent, container: textContainer, viewport: textViewport })
      await textLayer.render()
      if (active && layer.current && wrapper.current) {
        layer.current.replaceChildren(textContainer)
        setRenderedScale(scale)
        setRenderEpoch((value) => value + 1)
      }
    })().catch((error) => { if (active && error?.name !== 'RenderingCancelledException') onError(String(error)) })
    return () => { active = false; renderTask?.cancel(); textLayer?.cancel() }
  }, [pdf, pageNumber, scale, visible])

  useLayoutEffect(() => {
    if (!review || !renderEpoch || renderedScale !== scale || !layer.current || !wrapper.current) { setReviewGeometry(null); return }
    setReviewGeometry({ scale, epoch: renderEpoch, rects: locateReviewEvidence(layer.current, wrapper.current, review, pageNumber) })
  }, [reviewEvidenceSignature, renderEpoch, renderedScale, scale, pageNumber])

  useLayoutEffect(() => {
    if (!renderEpoch || renderedScale !== scale || !layer.current || !wrapper.current) { setAnswerGeometry(null); return }
    const entries = answerArtifacts.flatMap((artifact) => artifact.answer?.evidence.map((evidence, index) => ({ key: artifact.id, index, ...evidence })) ?? [])
    const colors = new Map(answerArtifacts.map((artifact) => [artifact.id, artifact.answer?.color ?? '']))
    setAnswerGeometry({ scale, epoch: renderEpoch, rects: locateEvidenceQuotes(layer.current, wrapper.current, entries, pageNumber).map((rect) => ({ ...rect, color: colors.get(rect.key) ?? '' })) })
  }, [answerEvidenceSignature, renderEpoch, renderedScale, scale, pageNumber])

  useEffect(() => {
    if(!sourceTarget || sourceTarget===reachedSource.current || sourceTarget.parts[0].page!==pageNumber || renderedScale!==scale || !wrapper.current || !scrollRoot.current)return
    const rect=sourceTarget.parts[0].rects[0]
    if(!rect)return
    reachedSource.current=sourceTarget
    const sheet=wrapper.current.getBoundingClientRect(),root=scrollRoot.current.getBoundingClientRect()
    scrollRoot.current.scrollBy({top:sheet.top-root.top+rect.y*sheet.height-70,behavior:'smooth'})
  },[sourceTarget,pageNumber,renderedScale,scale,scrollRoot])

  useEffect(() => {
    if (!jumpTarget || jumpTarget.token === reachedJump.current || jumpTarget.page !== pageNumber || renderedScale !== scale || !wrapper.current || !scrollRoot.current) return
    reachedJump.current = jumpTarget.token
    const sheet = wrapper.current.getBoundingClientRect(), root = scrollRoot.current.getBoundingClientRect()
    scrollRoot.current.scrollBy({ top: sheet.top - root.top + jumpTarget.rect.y * sheet.height - 90, behavior: 'smooth' })
  }, [jumpTarget, pageNumber, renderedScale, scale, scrollRoot])

  useEffect(() => {
    if (!evidenceTarget || evidenceTarget.page !== pageNumber || !renderEpoch || !layer.current || !wrapper.current) return
    const answer = evidenceTarget.kind === 'answer' ? answerArtifacts.find((artifact) => artifact.id === evidenceTarget.artifactId)?.answer : null
    const match = evidenceTarget.kind === 'summary'
      ? review && locateReviewEvidence(layer.current, wrapper.current, review, pageNumber).find((item) => item.key === evidenceTarget.key && item.index === evidenceTarget.index)
      : answer && locateEvidenceQuotes(layer.current, wrapper.current, answer.evidence.map((evidence, index) => ({ key: evidenceTarget.artifactId, index, ...evidence })), pageNumber)
        .find((item) => item.index === evidenceTarget.index)
    wrapper.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    if (match && scrollRoot.current) scrollRoot.current.scrollBy({ top: match.y * wrapper.current.clientHeight - 95, behavior: 'smooth' })
    onEvidenceReached()
  }, [evidenceTarget, pageNumber, review, answerEvidenceSignature, renderEpoch, scrollRoot, onEvidenceReached])

  // Citation markers are hit-tested against the sheet instead of being covered
  // by clickable boxes: a box would swallow the mouse-down that starts a text
  // selection across a marker like [12].
  const linkIndexAt = (clientX: number, clientY: number): number => {
    const bounds = wrapper.current?.getBoundingClientRect()
    if (!bounds?.width || !bounds?.height) return -1
    return linkIndexAtPoint(citationLinks, (clientX - bounds.left) / bounds.width, (clientY - bounds.top) / bounds.height, 2 / bounds.width, 1.5 / bounds.height)
  }
  const trackLinkHover = (event: MouseEvent<HTMLDivElement>): void => {
    if (tool !== 'select') { if (hotLink !== null) setHotLink(null); return }
    const index = linkIndexAt(event.clientX, event.clientY)
    if (index !== hotLink) setHotLink(index < 0 ? null : index)
  }
  const captureSelection = (): void => {
    if (tool !== 'select' && tool !== 'highlight') return
    try {
      const selection = scrollRoot.current && readPdfSelection(scrollRoot.current)
      if (selection) onSelection(selection)
    } catch (error) { onError(String(error)) }
  }
  const selectParagraph = (event: MouseEvent<HTMLDivElement>): void => {
    if (tool === 'erase' && wrapper.current) {
      const bounds = wrapper.current.getBoundingClientRect()
      const x = (event.clientX - bounds.left) / bounds.width
      const y = (event.clientY - bounds.top) / bounds.height
      const match = [...anchors].reverse().find((card) => cardRects(card).some((rect) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height))
      if (match) onErase(match)
      return
    }
    if (tool !== 'select') return
    if (!wrapper.current) return
    if (!window.getSelection()?.toString().trim()) {
      const index = linkIndexAt(event.clientX, event.clientY)
      if (index >= 0 && citationLinks?.[index]) { onCitation?.(citationLinks[index]); return }
    }
    const paragraph = paragraphAt(paragraphs, wrapper.current, event.clientX, event.clientY)
    if (paragraph && !translatedTexts.has(paragraphKey(paragraph.text))) onParagraph({ page: paragraph.startPage, text: paragraph.text, rects: paragraph.parts[0].rects, segments: paragraph.parts })
  }
  const point = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) }
  }
  const beginRegion = (event: PointerEvent<HTMLDivElement>): void => {
    if (!['region', 'figure'].includes(tool) || event.button !== 0) return
    event.preventDefault()
    window.getSelection()?.removeAllRanges()
    regionStart.current = point(event)
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveRegion = (event: PointerEvent<HTMLDivElement>): void => {
    if (!regionStart.current) return
    const current = point(event)
    setRegionDraft({ x: Math.min(regionStart.current.x, current.x), y: Math.min(regionStart.current.y, current.y), width: Math.abs(regionStart.current.x - current.x), height: Math.abs(regionStart.current.y - current.y) })
  }
  const endRegion = (event: PointerEvent<HTMLDivElement>): void => {
    if (!regionStart.current) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    const current = point(event)
    const rect = { x: Math.min(regionStart.current.x, current.x), y: Math.min(regionStart.current.y, current.y), width: Math.abs(regionStart.current.x - current.x), height: Math.abs(regionStart.current.y - current.y) }
    regionStart.current = null
    setRegionDraft(null)
    if (rect.width > .008 && rect.height > .008) onRegion({ page: pageNumber, text: '', rects: [rect] })
  }
  const cancelRegion = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    regionStart.current = null
    setRegionDraft(null)
  }
  const cardRects = (card: ReaderCard) => card.segments?.length ? card.segments.filter((part) => part.page === pageNumber).flatMap((part) => part.rects) : card.pageNumber === pageNumber ? card.rects : []
  const anchors = noteCards.filter((card) => card.kind === 'note' && !card.hidden && cardRects(card).length)
  const translatedTexts = translatedParagraphTexts(translatedCards)
  const previewRects = preview?.segments?.find((part) => part.page === pageNumber)?.rects ?? (preview?.page === pageNumber ? preview.rects : [])
  const reviewRects = renderedScale === scale && reviewGeometry?.scale === scale && reviewGeometry.epoch === renderEpoch ? reviewGeometry.rects : []
  const answerRects = renderedScale === scale && answerGeometry?.scale === scale && answerGeometry.epoch === renderEpoch ? answerGeometry.rects : []
  const hot = hotLink !== null ? citationLinks?.[hotLink] : undefined
  return <div className="continuous-page-frame" data-page={pageNumber}>
    <div className="continuous-page-label">{pageNumber} / {pdf.numPages}</div>
    <div ref={wrapper} className={`pdf-sheet continuous-pdf-sheet reader-tool-${tool}`} style={{ width: size.width, height: size.height }} data-citation={hot ? '1' : undefined} onMouseUp={captureSelection} onMouseMove={trackLinkHover} onMouseLeave={() => { if (hotLink !== null) setHotLink(null) }} onClick={selectParagraph} onPointerDown={beginRegion} onPointerMove={moveRegion} onPointerUp={endRegion} onPointerCancel={cancelRegion}>
      <canvas ref={canvas} />
      {hot && <div className="citation-hover" aria-hidden="true"><span style={{ left: `${hot.rect.x * 100}%`, top: `${hot.rect.y * 100}%`, width: `${hot.rect.width * 100}%`, height: `${hot.rect.height * 100}%` }} /></div>}
      {renderedScale === scale && <div className="stable-source-target" aria-hidden="true">{sourceTarget?.parts.filter((part) => part.page === pageNumber).flatMap((part) => part.rects.map((rect, index) => <span key={index} style={{left:`${rect.x*100}%`,top:`${rect.y*100}%`,width:`${rect.width*100}%`,height:`${rect.height*100}%`}}/>))}</div>}
      <div className="paragraph-preview" aria-hidden="true">{previewRects.map((rect, index) => <span key={index} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }} />)}</div>
      <div className="review-highlights" aria-hidden="true">{reviewRects.filter((rect) => visibleReviewKeys.includes(rect.key)).map((rect, index) => <span key={`${rect.key}-${rect.index}-${index}`} data-review-key={rect.key} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`, '--review-tint': reviewColors[rect.key].tint, '--review-color': reviewColors[rect.key].edge } as CSSProperties} />)}</div>
      <div className="answer-highlights" aria-hidden="true">{answerRects.map((rect, index) => <span key={`${rect.key}-${rect.index}-${index}`} data-answer-id={rect.key} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`, '--answer-color': rect.color } as CSSProperties} />)}</div>
      <div className="reader-card-anchors" aria-hidden="true">{anchors.flatMap((card) => cardRects(card).map((rect, index) => <span key={`${card.id}-${index}`} style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`, '--note-color': card.noteColor ?? defaultNoteColor } as CSSProperties} />))}</div>
      {regionDraft && <div className="reader-region-draft" aria-hidden="true" style={{ left: `${regionDraft.x * 100}%`, top: `${regionDraft.y * 100}%`, width: `${regionDraft.width * 100}%`, height: `${regionDraft.height * 100}%` }}/>}
      <div ref={layer} className="pdf-text-layer-host" style={{ visibility: renderedScale === scale ? 'visible' : 'hidden' }} />
    </div>
  </div>
}
