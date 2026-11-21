import { useEffect, useState, type ReactNode } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { ImagePlus, Plus, Sparkles, Trash2 } from 'lucide-react'
import type { CardAnnotation, ContentNature, FigureInsight, ResearchProject, SourceBlock } from '../shared/knowledge'
import { findSource, natureLabels } from '../shared/knowledge'
import type { PaperRecord, ReaderCard } from '../shared/types'
import type { PageSelection } from './ContinuousPdfPage'
import './knowledge.css'

export function ProjectPicker({ paperId, cardId, insightId, sourceId }: { paperId: string; cardId?: string; insightId?: string; sourceId?: string }): ReactNode {
  const [projects, setProjects] = useState<ResearchProject[]>([]), [open, setOpen] = useState(false), [message, setMessage] = useState('')
  useEffect(() => { if (open) void window.singularity.knowledge.projects().then(setProjects).catch((e) => setMessage(String(e))) }, [open])
  const add = async (projectId: string) => {
    try { await window.singularity.knowledge.addMaterial({ projectId, paperId, cardId, insightId, sourceId, category: insightId ? 'method' : 'note' }); setMessage('已加入项目'); setOpen(false) }
    catch (e) { setMessage(String(e)) }
  }
  return <span className="project-picker"><button onClick={() => setOpen(!open)}><Plus size={12} />加入项目</button>{open && <div className="project-picker-menu">{projects.length ? projects.map((item) => <button key={item.id} onClick={() => void add(item.id)}>{item.title}</button>) : <small>请先到“研究项目”创建项目。</small>}</div>}{message && <small role="status">{message}</small>}</span>
}

export function CardProvenance({ card, annotation, sources, onSource, onChange }: { card: ReaderCard; annotation?: CardAnnotation; sources: SourceBlock[]; onSource: (source: SourceBlock) => void; onChange: () => void }): ReactNode {
  const [error, setError] = useState('')
  if (!annotation) return null
  const save = async (nature: ContentNature, sourceIds: string[]) => {
    try { await window.singularity.knowledge.annotate(card.id, nature, sourceIds); setError(''); onChange() } catch (e) { setError(String(e)) }
  }
  return <div className="card-provenance">
    {(card.kind === 'summary' || card.kind === 'note') && <select aria-label="卡片内容性质" value={annotation.nature} onChange={(event) => void save(event.target.value as ContentNature, annotation.sourceIds)}>{Object.entries(natureLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
    {annotation.sourceIds.map((id) => { const block = findSource(sources, id); return block ? <button key={id} title={block.text.slice(0, 150)} onClick={() => onSource(block)}>{block.label}</button> : null })}
    <details className="card-provenance-more"><summary aria-label="更多卡片操作">···</summary><select aria-label="为卡片关联原文" value="" onChange={(event) => { if (event.target.value) void save(annotation.nature, [...new Set([...annotation.sourceIds, event.target.value])]) }}><option value="">关联原文…</option>{sources.map((item) => <option key={item.id} value={item.id}>{item.label} · p.{item.parts[0].page} · {item.text.slice(0, 45)}</option>)}</select>{annotation.sourceIds.map((id) => <button key={id} onClick={() => void save(annotation.nature, annotation.sourceIds.filter((value) => value !== id))}>解除 {sources.find((item) => item.id === id)?.label ?? id}</button>)}<ProjectPicker paperId={card.paperId} cardId={card.id} /></details>
    {error && <small role="alert">{error}</small>}
  </div>
}

export function SourceIndex({ sources, onSource }: { sources: SourceBlock[]; onSource: (source: SourceBlock) => void }): ReactNode {
  const [filter, setFilter] = useState('paragraph')
  return <details className="source-index"><summary>原文定位 · {sources.length} 个内容块</summary><div className="source-filter">{[['paragraph', '段落'], ['figure', '图'], ['table', '表'], ['reference', '参考文献']].map(([kind, label]) => <button key={kind} className={filter === kind ? 'active' : ''} onClick={() => setFilter(kind)}>{label}</button>)}</div><div className="source-index-list">{sources.filter((item) => item.kind === filter).map((source) => <div key={source.id}><button onClick={() => onSource(source)}><strong>{source.label}</strong><small>p.{source.parts.map((part) => part.page).join('–')}</small><span>{source.text.slice(0, 100) || '已框选图表'}</span></button>{source.relatedIds?.length ? <div className="source-relations">{source.relatedIds.map((id) => { const target = sources.find((item) => item.id === id); return target ? <button key={id} onClick={() => onSource(target)}>{target.label}</button> : null })}</div> : null}</div>)}</div><small>编号与 PDF 版本绑定；段落识别为自动结果，图表位置可通过框选修正。</small></details>
}

export function FigureCapture({ pdf, paper, selection, sources, onSaved, onClose }: { pdf: PDFDocumentProxy; paper: PaperRecord; selection: PageSelection; sources: SourceBlock[]; onSaved: () => void; onClose: () => void }): ReactNode {
  const [image, setImage] = useState(''), [caption, setCaption] = useState(selection.text), [label, setLabel] = useState(''), [kind, setKind] = useState<'figure' | 'table'>('figure'), [sourceId, setSourceId] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    void (async () => {
      const page = await pdf.getPage(selection.page), viewport = page.getViewport({ scale: 1.6 })
      const canvas = document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
      await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise
      const rect = selection.rects[0], cropped = document.createElement('canvas')
      cropped.width = Math.max(1, Math.round(rect.width * canvas.width)); cropped.height = Math.max(1, Math.round(rect.height * canvas.height))
      cropped.getContext('2d')!.drawImage(canvas, rect.x * canvas.width, rect.y * canvas.height, rect.width * canvas.width, rect.height * canvas.height, 0, 0, cropped.width, cropped.height)
      if (active) setImage(cropped.toDataURL('image/png'))
    })().catch((e) => { if (active) setError(String(e)) })
    return () => { active = false }
  }, [pdf, selection])
  const save = async () => {
    setBusy(true)
    try { await window.singularity.knowledge.saveFigure({ paperId: paper.id, sourceId: sourceId || undefined, kind, label, text: caption, parts: [{ page: selection.page, rects: selection.rects }], image }); onSaved(); onClose() } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  return <div className="editor-scrim" role="dialog" aria-modal="true" aria-label="保存图表定位"><div className="figure-capture"><h2>保存图表定位</h2>{image && <img src={image} alt="选中的 PDF 图表" />}<label>关联已识别的图表<select value={sourceId} onChange={(event) => { const id = event.target.value; setSourceId(id); const source = sources.find((item) => item.id === id); if (source) { setLabel(source.label); setCaption(source.text); setKind(source.kind as 'figure' | 'table') } }}><option value="">新图表</option>{sources.filter((item) => ['figure', 'table'].includes(item.kind)).map((item) => <option key={item.id} value={item.id}>{item.label} · p.{item.parts[0].page}</option>)}</select></label><div className="knowledge-form-row"><select aria-label="图表类型" value={kind} onChange={(event) => setKind(event.target.value as 'figure' | 'table')}><option value="figure">图</option><option value="table">表</option></select><input aria-label="图表编号" value={label} placeholder="例如 Fig. 2 或 Table 1" onChange={(event) => setLabel(event.target.value)} maxLength={120} /></div><textarea aria-label="图注或表注" value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="图注 / 表注，或手动记录图中可读内容" rows={4} />{error && <p role="alert">{error}</p>}<footer><button onClick={onClose}>取消</button><button className="primary" disabled={!image || !label.trim() || busy} onClick={() => void save()}>保存图表</button></footer></div></div>
}

export function FigureCards({ paper, sources, insights, onSource, onRefresh }: { paper: PaperRecord; sources: SourceBlock[]; insights: FigureInsight[]; onSource: (source: SourceBlock) => void; onRefresh: () => void }): ReactNode {
  const [chosen, setChosen] = useState(''), [observation, setObservation] = useState(''), [vision, setVision] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const figures = sources.filter((source) => ['figure', 'table'].includes(source.kind))
  const interpret = async (id = chosen, useVision = vision) => {
    if (!id) return
    setBusy(true); setError('')
    try { const pending = window.singularity.knowledge.interpret(id, observation, useVision); onRefresh(); await pending; setObservation('') } catch (e) { setError(String(e)) } finally { setBusy(false); onRefresh() }
  }
  const state = async (item: FigureInsight, hidden: boolean, included: boolean) => { try { await window.singularity.knowledge.insightState(item.id, hidden, included); onRefresh() } catch (e) { setError(String(e)) } }
  return <section className="figure-cards"><details><summary><ImagePlus size={14} />图表解读</summary><p className="muted">工具栏“图表框选”可保存图像并修正图表位置。</p><select aria-label="选择图表" value={chosen} onChange={(event) => { setChosen(event.target.value); setVision(false) }}><option value="">选择图或表…</option>{figures.map((item) => <option key={item.id} value={item.id}>{item.label} · p.{item.parts[0].page}</option>)}</select><textarea aria-label="图表观察补充" value={observation} onChange={(event) => setObservation(event.target.value)} placeholder="可补充你观察到的流程、数值或疑问" rows={2} /><label className="knowledge-check"><input type="checkbox" checked={vision} disabled={!sources.find((item) => item.id === chosen)?.image} onChange={(event) => setVision(event.target.checked)} />包含图像分析（需支持图像的模型）</label><button className="primary" disabled={!chosen || busy} onClick={() => void interpret()}><Sparkles size={14} />{busy ? '正在解读…' : '生成解读卡片'}</button></details>{error && <p role="alert" className="inline-error">{error}</p>}
    {insights.filter((item) => !item.hidden).map((insight) => { const source = findSource(sources, insight.sourceId); return <article className="reader-note-card figure-insight-card" key={insight.id}><div className="reader-note-heading"><ImagePlus size={15} /><h3>{insight.title}</h3><button aria-label="移除图表解读" onClick={() => void state(insight, true, insight.included)}><Trash2 size={13} /></button></div>{source?.image && <img className="figure-insight-image" src={source.image} alt={source.label} onClick={() => onSource(source)} />}<small>{insight.scope === 'vision' ? '图像与文字解读' : '图注与上下文解读'} · 研究推演</small>{insight.status === 'running' ? <p role="status">正在解读…</p> : insight.status === 'failed' ? <><p role="alert">{insight.error}</p><button disabled={busy} onClick={() => void interpret(insight.sourceId, insight.scope === 'vision')}>重试</button></> : <p className="reader-card-content">{insight.content.replace(/\[src:[^\]]+\]/g, '')}</p>}<div className="card-provenance">{[...new Set([insight.sourceId, ...insight.evidenceIds])].map((id) => { const block = findSource(sources, id); return block ? <button key={id} onClick={() => onSource(block)}>{block.label}</button> : null })}</div><div className="reader-card-actions"><ProjectPicker paperId={paper.id} insightId={insight.id} /><button disabled={insight.status !== 'complete'} onClick={() => void state(insight, false, !insight.included)}>{insight.included ? '已加入最终笔记' : '加入最终笔记'}</button></div></article> })}
    {insights.some((item) => item.hidden) && <details><summary>已移除图表卡片</summary>{insights.filter((item) => item.hidden).map((item) => <button key={item.id} onClick={() => void state(item, false, item.included)}>恢复 {item.title}</button>)}</details>}
  </section>
}
