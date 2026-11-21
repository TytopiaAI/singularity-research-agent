import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { Languages, X, Minus, Plus } from 'lucide-react'
import type { DocumentTranslation, TranslationBlock, TranslationScope } from '../shared/document-translation'
import { readableMath } from './readable-math'
import { AcademicText, MathFormula } from './AcademicText'

function SourcePreview({ block, pdf }: { block: TranslationBlock; pdf: PDFDocumentProxy }) {
  const host = useRef<HTMLDivElement>(null), [visible, setVisible] = useState(false), [image, setImage] = useState('')
  const geometry = JSON.stringify([block.parts, block.imageRect])
  useEffect(() => {
    if (!host.current) return
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect() } }, { rootMargin: '400px' })
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    let active = true
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined
    void (async () => {
      const page = await pdf.getPage(block.parts[0].page)
      if (!active) return
      const viewport = page.getViewport({ scale: 2 }), rects = block.imageRect ? [block.imageRect] : block.parts[0].rects
      const paddingY = block.kind === 'formula' ? .0025 : .008
      const left = Math.max(0, Math.min(...rects.map((r) => r.x)) - .006), top = Math.max(0, Math.min(...rects.map((r) => r.y)) - paddingY)
      const right = Math.min(1, Math.max(...rects.map((r) => r.x + r.width)) + .006), bottom = Math.min(1, Math.max(...rects.map((r) => r.y + r.height)) + paddingY)
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil((right - left) * viewport.width); canvas.height = Math.ceil((bottom - top) * viewport.height)
      task = page.render({ canvas, viewport, transform: [1, 0, 0, 1, -left * viewport.width, -top * viewport.height] })
      await task.promise
      if (active) setImage(canvas.toDataURL('image/png'))
    })().catch(() => {})
    return () => { active = false; task?.cancel() }
  }, [visible, pdf, block.id, geometry])
  return <div ref={host} className={block.kind === 'formula' ? 'translation-formula' : block.kind === 'table' ? 'translation-figure translation-table' : 'translation-figure'}>{image ? <img src={image} alt={block.text}/> : <span>{readableMath(block.text)}</span>}{block.kind === 'formula' && <small>公式保留原文</small>}</div>
}

export function DocumentTranslationPanel({ document, scope, pdf, busy, onScope, onStart, onClose, onJump, onLocate }: {
  document: DocumentTranslation | null; scope: TranslationScope; pdf: PDFDocumentProxy | null; busy: boolean
  onScope: (scope: TranslationScope) => void; onStart: () => void; onClose: () => void; onJump: (page: number) => void
  onLocate?: (block: TranslationBlock) => void
}) {
  const [currentId, setCurrentId] = useState(''), [fontSize, setFontSize] = useState(18)
  const blocks = document?.blocks.filter((block) => block.scope === scope) ?? []
  const translatable = blocks.filter((block) => block.kind !== 'formula' && block.text.trim())
  const complete = translatable.filter((block) => document?.translations[block.id]).length
  const running = document?.running.includes(scope)
  const done = !!translatable.length && complete === translatable.length
  const locate = (block: TranslationBlock) => { setCurrentId(block.id); if (onLocate) onLocate(block); else onJump(block.parts[0].page) }
  return <aside className="document-translation-panel" aria-label="全文翻译对照栏">
    <header><Languages size={17}/><strong>{scope === 'body' ? '全文翻译' : '附录翻译'}</strong><button aria-label="关闭全文翻译" onClick={onClose}><X size={16}/></button></header>
    <div className="document-translation-controls"><div role="tablist" aria-label="翻译范围"><button role="tab" aria-selected={scope === 'body'} onClick={() => onScope('body')}>正文</button>{document?.blocks.some((block) => block.scope === 'appendix') && <button role="tab" aria-selected={scope === 'appendix'} onClick={() => onScope('appendix')}>附录</button>}</div><span role="status">{done ? '已保存到本地' : running ? `翻译中 ${complete} / ${translatable.length}` : complete ? `已保存 ${complete} / ${translatable.length}` : '原文 · 译文对照'}</span><div className="translation-font-controls" role="group" aria-label="阅读字号"><button aria-label="减小阅读字号" disabled={fontSize <= 15} onClick={() => setFontSize((size) => size - 1)}><Minus size={12}/></button><span>{fontSize}</span><button aria-label="增大阅读字号" disabled={fontSize >= 24} onClick={() => setFontSize((size) => size + 1)}><Plus size={12}/></button></div><button className="primary" disabled={busy || running || done || !translatable.length} onClick={onStart}>{done ? '翻译完成' : running ? '翻译中…' : complete ? '继续翻译' : scope === 'body' ? '翻译正文' : '翻译附录'}</button></div>
    {document?.errors[scope] && <p className="inline-error" role="alert">{document.errors[scope]}</p>}
    <div className="document-translation-scroll" style={{ fontSize }}>
      {!document && <p role="status">正在整理论文正文与附录…</p>}
      {document && !blocks.length && <p>未识别到可翻译的{scope === 'body' ? '正文' : '附录'}。</p>}
      {blocks.map((block, index) => <article className={`document-translation-block block-${block.kind}`} data-block-id={block.id} data-current={currentId === block.id || undefined} key={block.id}>
        {/* Mark each new source page once, in the margin, instead of labelling every block. */}
        {block.parts[0].page !== blocks[index - 1]?.parts.at(-1)?.page && <button className="translation-source-page" title="定位 PDF 原文" onClick={() => locate(block)}>p.{block.parts[0].page}</button>}
        {/* Tables read caption-first; figures show the graphic before their caption. */}
        {block.imageRect && pdf && block.kind !== 'table' && <SourcePreview block={block} pdf={pdf}/>}
        {block.kind === 'formula' ? <div className="translation-equation" role="button" tabIndex={0} title="定位原文公式" onClick={() => locate(block)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); locate(block) } }}>
          {block.math ? <MathFormula tex={block.math.tex} display/> : pdf ? <SourcePreview block={block} pdf={pdf}/> : <AcademicText text={block.text}/>}{block.math?.label && <span className="translation-equation-label">({block.math.label})</span>}
        </div> : block.text.trim() ? <><p className="document-translation-source"><AcademicText text={block.text}/></p><div role="button" tabIndex={0} aria-label={`定位原文段落，第 ${block.parts[0].page} 页`} title="点击定位左侧原文段落" onClick={() => { if (!window.getSelection()?.toString().trim()) locate(block) }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); locate(block) } }} className={`document-translation-result ${document?.translations[block.id] ? '' : 'waiting'}`}>{document?.translations[block.id] ? <AcademicText text={document.translations[block.id]}/> : running ? '等待翻译…' : '译文将在这里显示'}</div></> : null}
        {block.imageRect && pdf && block.kind === 'table' && <SourcePreview block={block} pdf={pdf}/>}
      </article>)}
    </div>
  </aside>
}
